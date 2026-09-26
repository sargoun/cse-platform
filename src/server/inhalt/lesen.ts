import 'server-only';
import type postgres from 'postgres';
import { db } from '@/server/db/pool';
import { withOeffentlich } from '@/server/kontext/oeffentlich';
import { VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';
import type { LeseKontext } from '@/server/kontext';
import {
  oeffentlicheMarkeAus, type OeffentlicheMarke,
} from '@/server/services/mandant/markenbild';

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
  /**
   * Die Angaben nach § 5 TMG.
   *
   * Sie stehen hier und nicht in einer zweiten Abfrage, weil das Impressum
   * dieselbe Zeile braucht wie der Fussbereich und eine zweite Abfrage die
   * beiden auseinanderlaufen liesse. `null` heisst „noch nicht hinterlegt"
   * und wird als solches ANGEZEIGT — eine weggelassene Zeile im Impressum
   * sieht aus wie eine vollstaendige Auskunft und ist eine unvollstaendige.
   */
  readonly rechtsform: string | null;
  readonly handelsregisterGericht: string | null;
  readonly handelsregisterNummer: string | null;
  readonly geschaeftsfuehrer: readonly string[];
  readonly ustId: string | null;
  /**
   * Hat ein Mensch diese Stammdaten bestaetigt?
   *
   * `false` heisst NICHT „falsch", sondern „ungeprueft" — und die Oberflaeche
   * sagt es, statt eine erfundene Registernummer als Angabe nach § 5 TMG
   * auszugeben (O-353).
   */
  readonly angabenBestaetigt: boolean;
  /**
   * Logo, Avatar und Titelbild — nur aus einer VERÖFFENTLICHTEN Identität
   * (V-100, D-628). Jedes Feld ist `null`, solange nichts hochgeladen oder
   * nichts freigegeben ist; die Website zeigt dann das vorläufige Zeichen
   * aus DESIGN §1 und die Motivtafel, wie bisher.
   */
  readonly marke: OeffentlicheMarke;
}

interface BereichRoh extends Omit<BereichZeile, 'marke'> {
  readonly logo_hell_pfad: string | null;
  readonly logo_dunkel_pfad: string | null;
  readonly logo_alt: string | null;
  readonly avatar_pfad: string | null;
  readonly avatar_alt: string | null;
  readonly cover_pfad: string | null;
  readonly cover_alt: string | null;
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
  /*
   * Die Bilder aus der PROJEKTIONS-View und nur mit `oeffentlich_sichtbar`
   * (V-100): der Renderer ist ein angemeldeter Dienstprinzipal und saehe
   * ueber `t_mi_lesen` auch eine unveroeffentlichte Identitaet. Die Bedingung
   * steht deshalb im `join`, nicht nur in einer Policy.
   */
  const roh = await kontext.abfrage<BereichRoh>(
    `select m.id, m.slug, m.name, m.firma, m.strasse, m.plz, m.ort, m.land,
            m.telefon, m.email,
            m.rechtsform,
            m.handelsregister_gericht as "handelsregisterGericht",
            m.handelsregister_nummer  as "handelsregisterNummer",
            coalesce(m.geschaeftsfuehrer, '{}') as geschaeftsfuehrer,
            m.ust_id                  as "ustId",
            (m.angaben_bestaetigt_am is not null) as "angabenBestaetigt",
            coalesce(p.kurzbeschreibung, d.kurzbeschreibung) as kurzbeschreibung,
            mi.logo_hell_pfad, mi.logo_dunkel_pfad, mi.logo_alt,
            mi.avatar_pfad, mi.avatar_alt, mi.cover_pfad, mi.cover_alt
       from mandant m
       left join mandant_identitaet_oeffentlich mi
              on mi.mandant_id = m.id and mi.oeffentlich_sichtbar
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
  return roh.map(({
    logo_hell_pfad, logo_dunkel_pfad, logo_alt, avatar_pfad, avatar_alt, cover_pfad, cover_alt,
    ...zeile
  }) => ({
    ...zeile,
    marke: oeffentlicheMarkeAus(zeile.id, {
      logo_hell_pfad, logo_dunkel_pfad, logo_alt, avatar_pfad, avatar_alt, cover_pfad, cover_alt,
    }),
  }));
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
