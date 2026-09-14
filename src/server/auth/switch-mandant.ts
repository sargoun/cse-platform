import 'server-only';
import { bindeAnfrage, type Sitzung, type Transaktion } from '../kontext/index.js';

/**
 * Der Mandantenwechsel — der EINZIGE Schreiber des aktiven Bereichs
 * (03-AUTH-BERECHTIGUNGEN.md §4.4).
 *
 * **Ein GET wechselt nichts.** Koennte er es, WAERE die URL der
 * Mandantenzustand, und ein weitergeleiteter Link versetzte eine Leitung
 * lautlos in eine andere GmbH. D-10 und DESIGN §6 bestehen genau deshalb.
 * Der Wechsel ist ein POST, er kommt aus einem Formular mit sichtbarem Knopf,
 * und er hinterlaesst zwei Spiegelzeilen im `audit_log` (TEN-09) — die
 * schreibt der Ausloeser `kern.sitzung_wechsel_audit`, nicht dieser Code.
 *
 * **Das Portal wird hier NICHT geschrieben.** Es gibt keine Spalte dafuer:
 * `app.sitzung_aufloesen` leitet es bei jeder Anfrage neu aus der Rolle der
 * dann aktiven Mitgliedschaft ab (K-04). Ein hier gespeichertes Portal waere
 * eine zweite Wahrheit, die veraltet, sobald jemandem eine Rolle entzogen
 * wird.
 */

export type Wechselziel =
  | { readonly art: 'mandant'; readonly slug: string }
  | { readonly art: 'gruppe' };

export type Wechsel =
  | { readonly art: 'gewechselt'; readonly ziel: Wechselziel }
  /**
   * Unbekannter Slug, keine Mitgliedschaft, oder die Gruppenansicht steht
   * dieser Anmeldung nicht offen — DIESELBE Antwort fuer alle drei, weil jede
   * Unterscheidung bestaetigte, dass es die Sache gibt (AUT-06, SEC-A3).
   */
  | { readonly art: 'unbekannt' };

/**
 * Fuehrt den Wechsel aus. Setzt voraus, dass `tx` schreiben darf.
 *
 * Die Pruefung liegt in der Datenbank (`app.mandant_fuer_wechsel`,
 * `app.darf_gruppenansicht`) und nicht hier: der Trigger
 * `kern.sitzung_mandant_pruefen` weist einen fremden Bereich ohnehin ab, und
 * zwei Pruefungen, die auseinanderlaufen koennen, sind schlechter als eine.
 */
export async function wechsleMandant(
  tx: Transaktion, sitzung: Sitzung, ziel: Wechselziel,
): Promise<Wechsel> {
  await bindeAnfrage(tx, sitzung);
  // Der Wechsel ist ein Schreibvorgang auf der EIGENEN Sitzungszeile.
  // `bindeAnfrage` setzt `app.readonly = on`; `t_sitzung_eigene_schreiben`
  // prueft das nicht, aber ein Schreibpfad soll nicht als Lesepfad getarnt
  // laufen.
  await tx.unsafe(`select set_config('app.readonly', 'off', true)`);

  if (ziel.art === 'gruppe') {
    const [z] = (await tx.unsafe(
      `select app.darf_gruppenansicht() as ok`,
    )) as { ok: boolean }[];
    if (z?.ok !== true) return { art: 'unbekannt' };

    await tx.unsafe(
      `update benutzer_sitzung
          set aktiver_mandant_id = null, ansicht = 'gruppe'
        where id = $1 and beendet_am is null`,
      [sitzung.sitzungId],
    );
    return { art: 'gewechselt', ziel };
  }

  const [m] = (await tx.unsafe(
    `select app.mandant_fuer_wechsel($1) as id`, [ziel.slug],
  )) as { id: string | null }[];
  if (m?.id === null || m?.id === undefined) return { art: 'unbekannt' };

  await tx.unsafe(
    `update benutzer_sitzung
        set aktiver_mandant_id = $2, ansicht = 'mandant'
      where id = $1 and beendet_am is null`,
    [sitzung.sitzungId, m.id],
  );
  return { art: 'gewechselt', ziel };
}

/**
 * Der Rueckweg nach dem Wechsel — nur, wenn er IM Ziel liegt.
 *
 * `zurueck` kommt aus dem Formular des Wechselblatts, also vom Aufrufer.
 * Angenommen wird ein Pfad, der mit `/portal/<ziel>` beginnt, nichts sonst:
 * kein absoluter Verweis (der die Basis ignorierte), kein `//host`, kein
 * `..`-Segment (das `new URL` still aufloeste — `/portal/reinigung/../mein`
 * ist `/portal/mein`), kein Backslash, kein anderer Bereich. Wer nach dem
 * Wechsel in die Reinigung auf einer Bau-Seite landete, haette den Wechsel
 * nicht gelesen, den er bestaetigt hat.
 *
 * `null` heisst: Standardziel, die Wurzel des Bereichs. Kein Fehler — ein
 * praeparierter Wert soll dem Angreifer nichts sagen (dieselbe Haltung wie
 * `internesZiel`).
 */
const RUECKWEG = /^\/portal\/([a-z0-9-]+)(?:\/[A-Za-z0-9._~-]+)*(?:\?[A-Za-z0-9=&._~%-]*)?$/u;

export function rueckwegImBereich(zurueck: unknown, ziel: Wechselziel): string | null {
  if (typeof zurueck !== 'string' || zurueck === '' || zurueck.length > 512) return null;
  const treffer = RUECKWEG.exec(zurueck);
  if (treffer === null) return null;
  if (zurueck.split('?')[0]!.split('/').some((segment) => /^\.+$/u.test(segment))) return null;
  const erwartet = ziel.art === 'gruppe' ? 'gruppe' : ziel.slug;
  return treffer[1] === erwartet ? zurueck : null;
}
