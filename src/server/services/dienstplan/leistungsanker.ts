/**
 * Der Abrechnungsanker einer Schicht — die Leistungszeile des Auftrags, an
 * der ihre Zeit hängt (TIM-12, FIN-07, V-191, V-192).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, der diese Datei gebaut hat.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Zeiteintrag hängt über `auftrag_leistung_id` am Auftrag, und er erbt
 * diese Spalte beim Anlegen AUSSCHLIESSLICH von seiner Schicht (`z_erben`,
 * 0034). Die Schicht bekommt sie vom Träger (Turnus, Posten, Veranstaltung)
 * oder — bei einer Einzelschicht — beim Anlegen. Weder die Turnus- noch die
 * Posten-Anlage noch die Einzelschicht schrieben eine; nur der Seed tat es.
 * Jede Stunde aus einer über die Oberfläche geplanten Schicht landete damit
 * dauerhaft in `zeiteintrag_ohne_auftrag`, und die Stundenabrechnung fand sie
 * nie — nach dem Schliessen ist die Spalte am Eintrag unveränderlich.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Datei entscheidet, und was nicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sie bietet die LEBENDEN Leistungszeilen laufender Aufträge an und prüft
 * einen gewählten Anker, bevor er geschrieben wird — mit einem Satz statt
 * eines Fremdschlüsselfehlers. Den Auftrag leitet die Datenbank aus der
 * Zeile ab (`kern.einsatz_auftrag_ableiten`, 0050, seit 0430 als
 * `cse_definer`), und dass Zeile und Auftrag zusammengehören, prüft der
 * Enkel-Schlüssel `einsatz_leistung_fk`. Welche Zeile zu welcher Schicht
 * gehört, entscheidet ein Mensch; die Datei schlägt nichts vor. Damit er es
 * entscheiden kann, nennt jede Zeile Kunde und Objekt ihres Auftrags (V-192).
 * OB der Kunde des Auftrags der des Objekts sein muss, fragt O-927 — die
 * Datei prüft es nicht.
 *
 * Gelesen wird unter der RLS des Aufrufers: Leistungszeilen sieht, wer
 * `auftrag.lesen` hält. Wer das nicht hält, bekommt keine Auswahl — und kein
 * Feld, das beim Speichern einen Anker still löschte.
 */
import type { LeseKontext } from '../../kontext/index.js';

/** Die Zustände eines Auftrags (0025, 0389). */
export type AuftragStatus = 'angelegt' | 'aktiv' | 'pausiert' | 'abgeschlossen' | 'storniert';

/**
 * PLATZHALTER — in welchen Zuständen ein Auftrag NEUE Zeit an eine seiner
 * Leistungszeilen bekommt (V-192, O-927).
 *
 * `storniert` nie: der Vertrag kommt nicht zustande, und der Zustand ist
 * einwegig (0389). `abgeschlossen` nicht, solange O-734 offen ist: der
 * Abschluss ist einwegig und stellt die FIN-18-Warnung scharf (0296, D-366);
 * Zeit, die danach an ihm hinge, fände keine Rechnung mehr. OFFEN sind
 * `angelegt` (heute steht ein neuer Auftrag dort, bis jemand ihn aktiviert)
 * und `pausiert`. Bis zur Antwort gilt dieselbe Menge wie in der
 * Auftragsauswahl der Einzelschicht (`dienstplan/einsatz/neu`, V-013) —
 * EINE Stelle für beide Felder derselben Maske, die vorher auseinandergingen
 * (die Zeile nahm auch `angelegt` und `abgeschlossen`). Die Antwort ersetzt
 * nur diese Liste.
 *
 * TODO(client, O-927): In welchen Zuständen nimmt ein Auftrag neue Zeit an — auch `angelegt` (noch nicht aktiviert) und `pausiert`?
 */
export const ANKERBARE_AUFTRAGSZUSTAENDE: readonly AuftragStatus[] = ['aktiv', 'pausiert'];

export interface AnkerbareLeistung {
  readonly id: string;
  readonly auftragId: string;
  readonly auftragsnummer: string;
  readonly positionNr: number;
  readonly bezeichnung: string;
  /**
   * Der Kunde des Auftrags — `null`, wenn der Betrachter Kunden nicht lesen
   * darf (`crm.lesen`). Er steht in der Auswahl, damit niemand die Zeile eines
   * fremden Kunden wählt, ohne es zu sehen (V-192).
   */
  readonly kunde: string | null;
  /** Das Objekt der Zeile, sonst das des Auftrags — `null` ohne eines oder ohne `objekt.lesen`. */
  readonly objekt: string | null;
  /**
   * `false`: beendet, oder ihr Auftrag läuft nicht (`ANKERBARE_AUFTRAGSZUSTAENDE`)
   * — nur als bisheriger Anker gezeigt, nie neu wählbar.
   */
  readonly lebt: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Die Länge einer Auswahlliste, keine Fachregel. */
export const ANKERBARE_LEISTUNGEN_HOECHSTENS = 300;

/**
 * Lebt die Zeile? Ihr Auftrag steht in einem ankerbaren Zustand (der
 * Parameter `zustaende`), und sie gilt am heutigen Berliner Tag
 * (`gueltig_bis` einschliesslich, 0050). EIN Ausdruck für Liste und Prüfung —
 * zwei Fassungen gingen auseinander.
 */
function lebt(zustaende: string): string {
  return `(a.status::text = any(${zustaende}::text[])
           and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute()))`;
}

/**
 * Die Leistungszeilen, die sich als Anker wählen lassen — lebend (`lebt`).
 * `bisher` kommt IMMER mit, auch wenn die Zeile nicht mehr lebt: eine
 * Pflegemaske, die den bisherigen Anker nicht anbietet, löschte ihn beim
 * nächsten Speichern.
 *
 * **„Immer" heisst: auch jenseits der Obergrenze** (V-192). Die erste Fassung
 * hängte `or al.id = $2` in dieselbe Abfrage und kappte DANACH mit `limit`.
 * Bei mehr als {@link ANKERBARE_LEISTUNGEN_HOECHSTENS} lebenden Zeilen fiel
 * der bisherige Anker damit aus der Liste — sortiert nach Auftragsnummer
 * absteigend traf das gerade die alten, lange laufenden Verträge —, die Maske
 * wählte „ohne", und das nächste Speichern einer Uhrzeit löste ihn; der
 * Generator trug das auf jede künftige Schicht. Deshalb zwei Teile: die
 * gekappte Liste der lebenden Zeilen und, UNGEKAPPT daneben, die bisherige.
 *
 * Kunde und Objekt kommen über einen äusseren Verbund: ohne `crm.lesen` bzw.
 * `objekt.lesen` bleibt die Angabe leer, die Zeile verschwindet nicht.
 *
 * `hoechstens` ist die Obergrenze der lebenden Zeilen; die Vorgabe genügt
 * jeder Maske, die Angabe gibt es für die Prüfung der Kappung.
 */
export async function listeAnkerbareLeistungen(
  kontext: LeseKontext, bisher: string | null = null,
  hoechstens: number = ANKERBARE_LEISTUNGEN_HOECHSTENS,
): Promise<readonly AnkerbareLeistung[]> {
  const spalten = `al.id, al.auftrag_id, a.auftragsnummer, al.position_nr, al.bezeichnung,
              k.name as kunde, coalesce(ol.bezeichnung, oa.bezeichnung) as objekt`;
  const quelle = `auftrag_leistung al
         join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
         left join kunde k on k.mandant_id = a.mandant_id and k.id = a.kunde_id
         left join objekt ol on ol.mandant_id = al.mandant_id and ol.id = al.objekt_id
         left join objekt oa on oa.mandant_id = a.mandant_id and oa.id = a.objekt_id`;
  const zeilen = await kontext.abfrage<{
    id: string; auftrag_id: string; auftragsnummer: string; position_nr: number;
    bezeichnung: string; kunde: string | null; objekt: string | null; lebt: boolean;
  }>(
    `with lebend as (
       select ${spalten}, true as lebt
         from ${quelle}
        where ${lebt('$3')}
        order by a.auftragsnummer desc, al.position_nr
        limit $1::int
     ), bisherig as (
       select ${spalten}, ${lebt('$3')} as lebt
         from ${quelle}
        where al.id = $2::uuid
     )
     select * from lebend
     union
     select * from bisherig
     order by auftragsnummer desc, position_nr`,
    [Math.max(0, Math.trunc(hoechstens)), bisher, [...ANKERBARE_AUFTRAGSZUSTAENDE]],
  );
  return zeilen.map((z) => ({
    id: z.id,
    auftragId: z.auftrag_id,
    auftragsnummer: z.auftragsnummer,
    positionNr: Number(z.position_nr),
    bezeichnung: z.bezeichnung,
    kunde: z.kunde,
    objekt: z.objekt,
    lebt: z.lebt,
  }));
}

export type LeistungsankerGrund =
  | 'leistung_unbekannt' | 'leistung_beendet' | 'leistung_anderer_auftrag';

/**
 * Der deutsche Satz je Grund — die Meldung des Fehlers. Die Masken schlagen
 * den `grund` in ihrer Sprache nach (`LEISTUNGSANKER_TEXTE`); in die Adresse
 * reist nur der Schlüssel (V-192).
 */
const SATZ: Readonly<Record<LeistungsankerGrund, string>> = {
  leistung_unbekannt:
    'Diese Leistungszeile gibt es in dieser Gesellschaft nicht — oder sie ist für Sie '
    + 'nicht sichtbar, weil das Recht fehlt, Aufträge zu lesen.',
  leistung_beendet:
    'Diese Leistungszeile gilt nicht mehr, oder ihr Auftrag läuft nicht. Neue Schichten '
    + 'hängen nur an einer Position eines laufenden Auftrags, die heute vereinbart ist.',
  leistung_anderer_auftrag:
    'Diese Leistungszeile gehört zu einem anderen Auftrag als dem, den die Schicht von Hand nennt.',
};

/**
 * Ein Anker, der so nicht geschrieben wird — mit dem Grund als Schlüssel,
 * den die Masken in ihrer Sprache nachschlagen.
 */
export class LeistungsankerFehler extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 422;
  constructor(readonly grund: LeistungsankerGrund) {
    super(SATZ[grund]);
    this.name = 'LeistungsankerFehler';
  }
}

/**
 * Prüft einen gewählten Anker, BEVOR er geschrieben wird.
 *
 * - `leistung_unbekannt`: die Zeile gibt es in dieser Gesellschaft nicht —
 *   oder der Aufrufer sieht sie nicht (`auftrag.lesen`). Beides ist für ihn
 *   dasselbe (AUT-06).
 * - `leistung_beendet`: die Zeile lebt heute nicht mehr, oder ihr Auftrag
 *   steht in keinem ankerbaren Zustand (`ANKERBARE_AUFTRAGSZUSTAENDE`). Eine
 *   NEUE Schicht an eine solche Zeile zu hängen, hiesse, Zeit auf eine
 *   Position zu buchen, die nicht vereinbart ist oder nicht mehr läuft.
 * - `leistung_anderer_auftrag`: die Schicht nennt einen Auftrag von Hand, und
 *   die Zeile gehört zu einem anderen. Der Enkel-Schlüssel wiese das ebenfalls
 *   ab — hier kommt es als Satz.
 *
 * Gibt den Auftrag der Zeile zurück.
 */
export async function pruefeLeistungsanker(
  kontext: LeseKontext, auftragLeistungId: string, auftragId: string | null = null,
): Promise<string> {
  // Eine Kennung, die keine ist, erreicht den `::uuid`-Cast nicht (sonst 500).
  if (!UUID.test(auftragLeistungId)) throw new LeistungsankerFehler('leistung_unbekannt');
  const [z] = await kontext.abfrage<{ auftrag_id: string; lebt: boolean }>(
    `select al.auftrag_id, ${lebt('$2')} as lebt
       from auftrag_leistung al
       join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
      where al.id = $1::uuid`,
    [auftragLeistungId, [...ANKERBARE_AUFTRAGSZUSTAENDE]],
  );
  if (z === undefined) throw new LeistungsankerFehler('leistung_unbekannt');
  if (!z.lebt) throw new LeistungsankerFehler('leistung_beendet');
  if (auftragId !== null && auftragId !== z.auftrag_id) {
    throw new LeistungsankerFehler('leistung_anderer_auftrag');
  }
  return z.auftrag_id;
}
