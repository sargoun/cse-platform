import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';

/**
 * **Der Auftragsstatus bewegt sich** (V-081, OPS-05).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `auftrag_status` kennt seit `0025` fünf Zustände — `angelegt`, `aktiv`,
 * `pausiert`, `abgeschlossen`, `storniert`. Geschrieben wurde genau EINER:
 * `abgeschlossen`, vom Abschlussdienst. Jeder Auftrag stand also von seiner
 * Anlage bis zu seinem Ende auf `angelegt`, während die Liste ihn als
 * „Geplant" beschriftete und das Auftragsblatt vier weitere Etiketten kannte,
 * die nie jemand sah.
 *
 * Im Betrieb fehlt damit das, was eine Auftragsliste täglich braucht: läuft
 * dieser Vertrag, ruht er (Objekt geschlossen, Kunde hat unterbrochen), oder
 * ist er storniert worden, bevor er begann.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Wege stehen in der DATENBANK, nicht hier.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kern.auftrag_status_pruefen` (`0389`) trägt die Tabelle der erlaubten
 * Übergänge, und `storniert` ist dort einwegig. Dieser Dienst baut sie nicht
 * nach — er prüft, was ein MENSCH gesagt bekommen soll, bevor er eine
 * Meldung aus der Tiefe liest, und lässt die Wand dahinter die Wand sein.
 * Dieselbe Arbeitsteilung wie beim Abschluss (`0296`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ruhen und Stornieren tragen einen Grund, der Normalweg nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein pausierter Auftrag kostet Umsatz, ein stornierter den ganzen Vertrag —
 * und beide Fragen kommen später: warum ruht der seit März, und wer hat den
 * storniert. `angelegt → aktiv` braucht dagegen nichts: ein Pflichtfeld davor
 * wäre eine Hürde vor dem Regelfall.
 *
 * **Der Grund gehört dem AKTUELLEN Zustand.** Wer einen ruhenden Auftrag
 * wieder aufnimmt, ohne etwas zu schreiben, räumt ihn — die Begründung der
 * Pause gilt dann nicht mehr, und ein stehengebliebener Satz an einem
 * laufenden Auftrag läse sich wie ein Zustand, der nicht mehr besteht. Die
 * Spur bleibt: jeder Wechsel steht mit Vorher und Nachher im Protokoll.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **`abgeschlossen` gibt es hier NICHT.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Abschluss ist ein eigener Vorgang mit eigenem Recht
 * (`auftrag.abschliessen`, OPS-05) und einer eigenen Seite, auf der die
 * FIN-18-Prüfliste steht. Ihn hier als vierte Auswahl anzubieten hiesse, ihn
 * an `auftrag.schreiben` zu binden — genau die Vermischung, die `0296`
 * aufgelöst hat.
 */

export type Auftragszustand = 'aktiv' | 'pausiert' | 'storniert';

export const ZUSTAENDE: readonly Auftragszustand[] = ['aktiv', 'pausiert', 'storniert'];

export type StatusGrund =
  'nicht_gefunden' | 'ohne_begruendung' | 'unbekannter_zustand' | 'kein_weg'
  | 'unveraendert' | 'abgewiesen';

export class AuftragsstatusFehler extends Error {
  constructor(nachricht: string, readonly grund: StatusGrund, readonly status = 400) {
    super(nachricht);
    this.name = 'AuftragsstatusFehler';
  }
}

/** Welcher Weg von wo aus offensteht — WORTGLEICH zu `0389`. */
export const WEGE: Readonly<Record<string, readonly Auftragszustand[]>> = {
  angelegt: ['aktiv', 'pausiert', 'storniert'],
  aktiv: ['pausiert', 'storniert'],
  pausiert: ['aktiv', 'storniert'],
  abgeschlossen: [],
  storniert: [],
};

/** Was der Zustand in der Oberfläche heisst — und was er bedeutet. */
export const ZUSTAND_TEXT: Readonly<Record<Auftragszustand, string>> = {
  aktiv: 'In Arbeit — die Leistung läuft',
  pausiert: 'Ruht — unterbrochen, aber nicht beendet',
  storniert: 'Storniert — dieser Vertrag kommt nicht zustande',
};

interface AuftragRoh {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly status: string;
  readonly status_grund: string | null;
}

export async function setzeAuftragsstatus(
  kontext: SchreibKontext, auftragId: string, ziel: string, grund: string,
): Promise<void> {
  if (!(ZUSTAENDE as readonly string[]).includes(ziel)) {
    throw new AuftragsstatusFehler(
      `„${ziel}" ist kein Zustand, der hier gesetzt wird. Abgeschlossen wird über den `
      + 'Abschlussvorgang mit eigenem Recht (OPS-05).', 'unbekannter_zustand');
  }
  const zustand = ziel as Auftragszustand;
  const text = grund.trim();

  if ((zustand === 'pausiert' || zustand === 'storniert') && text === '') {
    throw new AuftragsstatusFehler(
      zustand === 'pausiert'
        ? 'Warum ruht dieser Auftrag? Der Satz steht später allein da, wenn jemand '
          + 'fragt, seit wann und weshalb hier nichts läuft.'
        : 'Warum wird dieser Auftrag storniert? Das Storno ist die Aussage, dass '
          + 'dieser Vertrag nicht zustande kommt — sie steht in der Kundenakte, und '
          + 'sie ist nicht rücknehmbar.',
      'ohne_begruendung');
  }

  /**
   * **Erst sperren, dann vergleichen** — und die Sperrklausel ist zugleich
   * die Rechteprüfung: Postgres wendet auf `for update` das `using` der
   * UPDATE-Policy an. Eine Sitzung mit `auftrag.lesen`, aber ohne
   * `auftrag.schreiben`, bekommt hier NULL Zeilen, und die Gruppenansicht
   * ebenso. Ohne das stünde weiter unten ein `update`, das null Zeilen trifft
   * und wie ein Erfolg aussieht.
   */
  const [alt] = await kontext.schreibe<AuftragRoh>(
    `select id, auftragsnummer, status::text as status, status_grund
       from auftrag
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
        and archiviert_am is null
      for update`,
    [auftragId]);
  if (alt === undefined) {
    throw new AuftragsstatusFehler(
      'Diesen Auftrag gibt es nicht — oder diese Sitzung darf ihn nicht ändern.',
      'nicht_gefunden', 404);
  }

  if (alt.status === zustand) {
    throw new AuftragsstatusFehler(
      `Der Auftrag steht bereits auf „${zustand}".`, 'unveraendert', 409);
  }

  const offen = WEGE[alt.status] ?? [];
  if (!offen.includes(zustand)) {
    throw new AuftragsstatusFehler(
      alt.status === 'storniert'
        ? 'Ein stornierter Auftrag wird nicht wieder aufgenommen. Wer sich geirrt '
          + 'hat, legt einen neuen an — dieselbe Antwort, die der Abschluss gibt.'
        : alt.status === 'abgeschlossen'
          ? 'Ein abgeschlossener Auftrag wird nicht wieder geöffnet (O-734).'
          : `Von „${alt.status}" nach „${zustand}" führt am Auftrag kein Weg.`,
      'kein_weg', 409);
  }

  /*
   * `status_geaendert_am` setzt der AUSLÖSER aus der Serveruhr (Invariante 5)
   * — hier steht er deshalb nicht in der Spaltenliste. Ein Wert von hier wäre
   * die Uhr des Webservers und damit eine zweite.
   */
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `update auftrag
        set status = $2::auftrag_status,
            status_grund = $3,
            geaendert_von = app.aktueller_benutzer()
      where id = $1::uuid and mandant_id = app.aktiver_mandant()
      returning id`,
    [auftragId, zustand, text === '' ? null : text]);
  if (zeile === undefined) {
    /* Nach der Sperre oben kann das nicht mehr eintreten — bleibt aber stehen:
       ein stilles Null-Zeilen-Update darf nie wie ein Erfolg aussehen. */
    throw new AuftragsstatusFehler(
      'Der Auftragsstatus liess sich nicht setzen.', 'abgewiesen', 409);
  }

  await kontext.schreibe(
    `select app.protokolliere('auftrag.status_gesetzt', 'auftrag', $1, $2::jsonb,
                              $3::jsonb, app.aktiver_mandant())`,
    [auftragId,
      { nummer: alt.auftragsnummer, status: alt.status, grund: alt.status_grund },
      { nummer: alt.auftragsnummer, status: zustand, grund: text === '' ? null : text }]);
}
