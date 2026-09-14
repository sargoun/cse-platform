import 'server-only';
import type { SchreibKontext } from '../../kontext/index.js';
import { AusfuehrungAbgewiesen, fuehreAus } from './ausfuehrung.js';
import { FreigabeAbgewiesen, entscheideFreigabe } from './entscheiden.js';
import { EINSPRUCH_MINUTEN, RUECKNAHME_MINUTEN, istUmkehrbar } from './fenster.platzhalter.js';

/**
 * Stapelfreigabe, Einspruch und Rücknahme (APR-04, APR-05, APR-06).
 *
 * **Warum der Stapel kein `update … where id = any(...)` ist.** Jede Freigabe
 * bekommt ihren eigenen Schnappschuss und ihr eigenes Kettenglied (APR-07) —
 * das ist der Beweis, WAS zum Zeitpunkt der Entscheidung vorlag, und er ist
 * je Vorgang verschieden. Ein Sammelupdate schriebe einen Stand für zehn
 * verschiedene Sachverhalte. Der Stapel ist deshalb eine Schleife über
 * `entscheideFreigabe`, und der einzige Unterschied zum Einzelfall ist, dass
 * ein Mensch zehnmal dasselbe geklickt hätte.
 *
 * **Und der Stapel FÜHRT AUS, wie es die Einzelprüfung tut** (§4.8). Zehn
 * Häkchen dürfen nicht weniger bewirken als zehnmal derselbe Klick — sonst
 * stünden die Vorgänge genehmigt, aber ungetan da, und niemand sähe den
 * Unterschied. Weil eine Ausführung scheitern kann, bekommt jede Zeile ihren
 * eigenen SAVEPOINT: die gescheiterte rollt allein zurück und steht wieder
 * offen; die neun anderen bleiben entschieden.
 *
 * **Markierte Vorgänge fallen heraus, sie scheitern nicht.** APR-04 sagt:
 * „flagged items forced to individual review". Ein Stapel, der an der ersten
 * unsicheren Zeile abbricht, erzieht dazu, den Stapel nicht zu benutzen; ein
 * Stapel, der sie stillschweigend mitnimmt, hebelt APR-03 aus. Also: die
 * übrigen gehen durch, die markierten stehen einzeln im Bericht, mit Grund.
 */

export interface StapelErgebnis {
  readonly genehmigt: number;
  readonly uebersprungen: readonly {
    readonly freigabeId: string; readonly grund: string;
  }[];
  readonly verzoegert: number;
  /** Wie viele davon ihre Handlung gleich getan haben (§4.8). */
  readonly ausgefuehrt: number;
}

export class StapelFehler extends Error {
  readonly code: 'leer' | 'zu_gross' | 'kein_recht';
  readonly status = 400;
  constructor(code: 'leer' | 'zu_gross' | 'kein_recht', nachricht: string) {
    super(nachricht);
    this.code = code;
    this.name = 'StapelFehler';
  }
}

/**
 * Wie viele auf einmal.
 *
 * **Eine Obergrenze, keine Bequemlichkeit.** Ein Stapel über zweihundert
 * Vorgänge ist keine Prüfung mehr, sondern ein Häkchen bei „alle" — und
 * genau das ist das Verhalten, das APR-08 aufspüren soll. Fünfzig sind so
 * viele, wie ein Mensch an einem Morgen durchsieht.
 */
export const STAPEL_HOECHSTZAHL = 50;

export async function entscheideStapel(
  kontext: SchreibKontext,
  ids: readonly string[],
  metadaten: { readonly ip: string | null; readonly userAgent: string | null;
    readonly codeVersion: string },
): Promise<StapelErgebnis> {
  if (ids.length === 0) {
    throw new StapelFehler('leer', 'Es war nichts ausgewählt.');
  }
  if (ids.length > STAPEL_HOECHSTZAHL) {
    throw new StapelFehler('zu_gross',
      `Höchstens ${String(STAPEL_HOECHSTZAHL)} auf einmal — darüber ist es keine Prüfung mehr.`);
  }

  /**
   * **Erst fragen, ob dieser Mensch überhaupt stapeln darf** (O-367).
   *
   * Der Katalog führt `freigabe.stapel_entscheiden` als eigenes, an `admin`
   * und `leitung` BINDBARES Recht: wer einzeln entscheiden darf, darf damit
   * nicht schon fünfzig auf einmal. Die Frage steht hier vorn und nicht
   * hinten — fünfzig Zeilen zu genehmigen und danach zu erfahren, dass man
   * nicht stapeln darf, ist die Reihenfolge verkehrt herum. Die Definer-
   * Funktion prüft es ein zweites Mal; das Tor der Route ein drittes.
   */
  const [recht] = await kontext.abfrage<{ hat: boolean }>(
    `select app.hat_recht('freigabe.stapel_entscheiden', app.aktiver_mandant()) as hat`);
  if (recht?.hat !== true) {
    throw new StapelFehler('kein_recht',
      'Stapelweise zu genehmigen ist eine eigene Befugnis — dieses Konto hält sie nicht.');
  }

  /**
   * **Erst fragen, welche überhaupt in den Stapel dürfen.** `stapel_faehig`
   * setzt der Dienst, der die Freigabe erzeugt hat; `stapel_sperre_grund`
   * sagt, warum nicht. Beides hier zu ignorieren und auf den Fehler zu
   * warten, hiesse, die Begründung wegzuwerfen, die der Mensch sehen soll.
   */
  const zeilen = await kontext.abfrage<{
    id: string; stapel_faehig: boolean; stapel_sperre_grund: string | null;
    status: string; unsichere_felder_anzahl: number; risiko: string; aktion: string;
  }>(
    `select id, stapel_faehig, stapel_sperre_grund, status::text as status,
            unsichere_felder_anzahl, risiko::text as risiko, aktion::text as aktion
       from freigabe where id = any ($1::uuid[])`,
    [ids]);

  const uebersprungen: { freigabeId: string; grund: string }[] = [];
  let genehmigt = 0;
  let verzoegert = 0;
  let ausgefuehrt = 0;
  let nummer = 0;

  for (const id of ids) {
    const z = zeilen.find((x) => x.id === id);
    if (z === undefined) {
      uebersprungen.push({ freigabeId: id, grund: 'nicht gefunden oder nicht sichtbar' });
      continue;
    }
    if (z.status !== 'offen') {
      uebersprungen.push({ freigabeId: id, grund: `bereits entschieden (${z.status})` });
      continue;
    }
    if (!z.stapel_faehig) {
      uebersprungen.push({
        freigabeId: id,
        grund: z.stapel_sperre_grund ?? 'im Stapel nicht zugelassen — einzeln prüfen (APR-04)',
      });
      continue;
    }
    if (z.unsichere_felder_anzahl > 0) {
      uebersprungen.push({
        freigabeId: id,
        grund: `${String(z.unsichere_felder_anzahl)} unsichere(s) Feld(er) — einzeln prüfen (APR-03)`,
      });
      continue;
    }

    /**
     * **Ein SAVEPOINT je Zeile** — der Grund, warum eine gescheiterte
     * Ausführung den Stapel nicht mitnimmt. Ohne ihn stünde am Ende alles
     * oder nichts: neunundvierzig geprüfte Entscheidungen zurückgerollt,
     * weil die fünfzigste Buchung auf eine gesperrte Periode traf.
     */
    nummer += 1;
    const punkt = `stapel_${String(nummer)}`;
    await kontext.schreibe(`savepoint ${punkt}`);
    try {
      /**
       * **Gesehen wurde die LISTE — und das wird so aufgeschrieben** (APR-08).
       *
       * `app.freigabe_entscheiden` weist eine Entscheidung ab, die dieser
       * Mensch nie geöffnet hat. Wer fünfzig Routinezeilen aus dem Posteingang
       * genehmigt, hat keine fünfzig Detailseiten geöffnet — aber er hat je
       * Zeile gesehen, was APR-02 verlangt: Kopfzeile, Einstufung, Frist,
       * Betrag. Das ist eine Ansicht, nur eine andere, und sie bekommt deshalb
       * ihren eigenen Kanal statt eines `web`, das nicht stimmt. Den Zeitpunkt
       * setzt die Datenbank (K-13), nicht diese Zeile.
       */
      await kontext.schreibe(
        `insert into freigabe_ansicht (mandant_id, freigabe_id, benutzer_id, kanal)
         values ($1::uuid, $2::uuid, $3::uuid, 'stapel')`,
        [kontext.aktiverMandantId, id, kontext.benutzerId]);

      await entscheideFreigabe(kontext, {
        freigabeId: id, art: 'genehmigt', begruendung: null,
        ip: metadaten.ip, userAgent: metadaten.userAgent, codeVersion: metadaten.codeVersion,
      });

      /**
       * **Nur risikoarme Vorgänge bekommen ein Einspruchsfenster** (APR-05).
       * Bei allem darüber löst ein Mensch aus, nicht eine Uhr — das ist
       * dieselbe Grenze, die die Datenbankfunktion noch einmal prüft.
       *
       * **NULL heisst: kein Fenster, und das ist kein Fehler.** Sieben
       * Vorgangsarten sind von der verzögerten Auslösung ausgenommen (0136);
       * sie sind damit sofort gültig, wie jede Genehmigung vor APR-05 es war.
       */
      let fenster: Date | null = null;
      if (z.risiko === 'niedrig') {
        const [bis] = await kontext.schreibe<{ bis: Date | null }>(
          `select app.freigabe_verzoegern($1::uuid, $2::integer) as bis`,
          [id, EINSPRUCH_MINUTEN]);
        fenster = bis?.bis ?? null;
      }

      /**
       * **Fenster ODER Ausführung, nie beides.** Ein laufendes Fenster heisst
       * gerade: noch nicht ausgeführt — sonst wäre der Einspruch ein Undo,
       * und das ist ein anderer Vorgang (APR-06). Wo kein Fenster armiert
       * wurde, geschieht dasselbe wie bei der Einzelentscheidung.
       */
      if (fenster !== null) {
        verzoegert += 1;
      } else if ((await fuehreAus(kontext, id, z.aktion)).art !== 'keine') {
        ausgefuehrt += 1;
      }
      await kontext.schreibe(`release savepoint ${punkt}`);
    } catch (fehler) {
      await kontext.schreibe(`rollback to savepoint ${punkt}`);
      if (fehler instanceof FreigabeAbgewiesen || fehler instanceof AusfuehrungAbgewiesen) {
        uebersprungen.push({ freigabeId: id, grund: fehler.message });
        continue;
      }
      throw fehler;
    }
    genehmigt += 1;
  }

  return { genehmigt, uebersprungen, verzoegert, ausgefuehrt };
}

export class FensterFehler extends Error {
  readonly status = 409;
  constructor(nachricht: string) { super(nachricht); this.name = 'FensterFehler'; }
}

/** Der Einspruch innerhalb des Fensters (APR-05). */
export async function erhebeEinspruch(
  kontext: SchreibKontext, freigabeId: string, grund: string,
): Promise<void> {
  try {
    await kontext.schreibe(`select app.freigabe_einspruch($1::uuid, $2)`, [freigabeId, grund]);
  } catch (fehler) {
    throw new FensterFehler(fehler instanceof Error ? fehler.message : 'Einspruch abgewiesen.');
  }
}

/** Die Rücknahme innerhalb des Fensters (APR-06). */
export async function nimmZurueck(
  kontext: SchreibKontext, freigabeId: string, grund: string,
): Promise<void> {
  try {
    await kontext.schreibe(`select app.freigabe_ruecknahme($1::uuid, $2)`, [freigabeId, grund]);
  } catch (fehler) {
    throw new FensterFehler(fehler instanceof Error ? fehler.message : 'Rücknahme abgewiesen.');
  }
}

/**
 * Armiert das Rücknahmefenster nach einer Ausführung — **nur wo umkehrbar**.
 *
 * Wo nicht, passiert nichts und die Seite zeigt kein Fenster. Ein Knopf
 * „rückgängig", der bei einem versendeten E-Mail nichts tut, ist schlimmer
 * als keiner: jemand drückt ihn und glaubt, es sei zurückgeholt.
 */
export async function armiereRuecknahme(
  kontext: SchreibKontext, freigabeId: string, vorgangTyp: string,
): Promise<boolean> {
  if (!istUmkehrbar(vorgangTyp)) return false;
  await kontext.schreibe(
    `select app.freigabe_ruecknahme_fenster($1::uuid, $2::integer)`,
    [freigabeId, RUECKNAHME_MINUTEN]);
  return true;
}
