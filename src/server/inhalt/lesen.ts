import 'server-only';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import type { LeseKontext } from '@/server/kontext';

/**
 * Der eine Einstieg, ueber den eine oeffentliche Seite liest.
 *
 * Eine Transaktion je Anfrage, `cse_app`, `app.readonly = 'on'` — und ein
 * Kontext ohne `schreibe`. Dass jede oeffentliche Seite durch DIESE Funktion
 * geht, ist der Grund, warum die Zusicherungen aus `withOeffentlich` fuer alle
 * gelten und nicht je Seite wiederholt werden muessen.
 */
export async function oeffentlichLesen<T>(
  fn: (kontext: LeseKontext) => Promise<T>,
): Promise<T> {
  return db().begin((tx: postgres.TransactionSql) =>
    withOeffentlich(tx, fn)) as Promise<T>;
}

export interface BereichZeile {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly firma: string;
  readonly strasse: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly land: string;
  readonly telefon: string | null;
  readonly email: string | null;
  readonly kurzbeschreibung: string | null;
}

/**
 * Die vier Bereiche in Anzeigereihenfolge.
 *
 * Sichtbar sind sie nur, weil der Renderer ein Dienstprinzipal mit
 * `benutzer_mandant`-Zeilen ist: `t_mandant_lesen` gibt frei, was
 * `app.sichtbare_mandanten()` nennt. Ein `where`-Filter auf `archiviert_am`
 * steht trotzdem hier — eine abgewickelte Gesellschaft gehoert nicht in die
 * Navigation, auch wenn die Policy sie durchliesse.
 */
export async function bereicheLesen(
  kontext: LeseKontext, sprache: Sprache = VORGABE_SPRACHE,
): Promise<readonly BereichZeile[]> {
  /**
   * Der Kurztext in der Sprache der Seite — mit Rueckfall auf Deutsch.
   *
   * **Der Rueckfall ist Absicht und keine Nachlaessigkeit.** Fehlt die
   * englische Zeile, ist der deutsche Satz die schlechtere von zwei
   * Auskuenften; eine LEERE Karte waere die schlechteste: sie liest sich wie
   * "ueber diese Gesellschaft gibt es nichts zu sagen". `unternehmensprofil`
   * traegt seit 0019 eine `sprache`, genau wie `seite` — eine Zeile je
   * Sprache, kein Spaltenpaar.
   */
  return kontext.abfrage<BereichZeile>(
    `select m.id, m.slug, m.name, m.firma, m.strasse, m.plz, m.ort, m.land,
            m.telefon, m.email,
            coalesce(p.kurzbeschreibung, d.kurzbeschreibung) as kurzbeschreibung
       from mandant m
       left join unternehmensprofil p
              on p.mandant_id = m.id and p.sprache = $1
             and p.status = 'veroeffentlicht' and p.geloescht_am is null
       left join unternehmensprofil d
              on d.mandant_id = m.id and d.sprache = 'de'
             and d.status = 'veroeffentlicht' and d.geloescht_am is null
      where m.archiviert_am is null
      order by m.sortierung, m.slug`,
    [sprache],
  );
}

/**
 * Eine Plattform-Einstellung, oder `null`.
 *
 * Eine fehlende Zeile ist kein Fehler, sondern eine Antwort: "nicht
 * entschieden". Der Aufrufer entscheidet, was das bedeutet — und bei
 * strukturierten Daten heisst es: den Block nicht ausgeben.
 */
export async function einstellungLesen(
  kontext: LeseKontext, schluessel: string,
): Promise<unknown | null> {
  const zeilen = await kontext.abfrage<{ wert: unknown }>(
    `select wert from plattform_einstellung where schluessel = $1`, [schluessel],
  );
  return zeilen[0]?.wert ?? null;
}
