/**
 * Die Zahlen der Moduluebersicht Bau (BAU-04, BAU-06, BAU-07, Seitenkarte
 * §5.9).
 *
 * **Warum es diese Datei gibt und nicht nur die Listen.** Die Uebersicht
 * beantwortet drei Fragen, und jede ist eine ZAHL: wie viele Nachtraege liegen
 * angemeldet und nicht eingereicht, wie viele Behinderungen laufen ohne
 * dokumentierten Wegfall, wie viele Bautage stehen im Entwurf. Die
 * vorhandenen Dienste liefern dafuer volle Zeilen — `listeNachtraege` holt je
 * Nachtrag zwoelf Spalten samt Grundlage und Projektnamen. Zweihundert Zeilen
 * zu laden, um sie zu zaehlen, ist auf einem Baustellentelefon der
 * Unterschied zwischen einer Seite und einer Wartezeit.
 *
 * **Jede Zahl ist ein WEG.** Ohne Ziel ist eine Kachel eine Sackgasse
 * (DSH-04): die Zahl fuehrt zu den Zeilen, aus denen sie entstanden ist.
 *
 * **Die Tagesdifferenzen rechnet Postgres**, gegen `app.berlin_heute()`. Der
 * Kalendertag ist der BERLINER (K-11); ein Node-Prozess in UTC saehe um 00:30
 * Berliner Zeit noch den Vortag, und die Wachfrist waere dann jede Nacht
 * einen Tag zu lang.
 *
 * Der Dienst LIEST und zaehlt; er schreibt nichts und rechnet kein Geld.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { NACHTRAG_WACHFRIST_TAGE } from './nachtrag.js';

export interface BauKennzahlen {
  readonly projekte: number;
  readonly projekte_laufend: number;
  /** § 2 VOB/B: angemeldet und nicht eingereicht (BAU-04). */
  readonly nachtraege_offen: number;
  /** Davon laenger als {@link NACHTRAG_WACHFRIST_TAGE} Tage. */
  readonly nachtraege_ueberfaellig: number;
  /** § 6 VOB/B: angezeigt und ohne dokumentierten Wegfall (BAU-06). */
  readonly behinderungen_laufend: number;
  /** Behinderungen im Entwurf — angezeigt ist noch keine davon. */
  readonly behinderungen_entwurf: number;
  /** § 14 VOB/B: vorgelegt und auf Gegenzeichnung wartend (BAU-03). */
  readonly aufmasse_vorgelegt: number;
  readonly bautage_entwurf: number;
  /** § 12 VOB/B: protokollierte Abnahmen, ohne die stornierten. */
  readonly abnahmen: number;
}

/**
 * Alle Zahlen der Uebersicht in EINER Abfrage.
 *
 * Neun Unterabfragen in einem `select` und nicht neun Aufrufe: jeder eigene
 * Aufruf waere eine weitere Umdrehung durch die Verbindung, und alle neun
 * gehoeren ohnehin in denselben Schnappschuss — eine Uebersicht, deren
 * Kacheln aus verschiedenen Zeitpunkten stammen, widerspricht sich in dem
 * Moment, in dem jemand gerade etwas einreicht.
 */
export async function ladeBauKennzahlen(kontext: LeseKontext): Promise<BauKennzahlen> {
  const [zeile] = await kontext.abfrage<BauKennzahlen>(
    `select
       (select count(*) from projekt p where p.archiviert_am is null)::int as projekte,
       (select count(*) from projekt p
         where p.archiviert_am is null
           and p.status in ('geplant','in_arbeit'))::int as projekte_laufend,
       (select count(*) from nachtrag n
         where n.status = 'angemeldet' and n.eingereicht_am is null
           and n.storniert_am is null)::int as nachtraege_offen,
       (select count(*) from nachtrag n
         where n.status = 'angemeldet' and n.eingereicht_am is null
           and n.storniert_am is null
           and n.angemeldet_am <= app.berlin_heute() - $1::int)::int
         as nachtraege_ueberfaellig,
       (select count(*) from behinderung b
         where b.storniert_am is null and b.wegfall_angezeigt_am is null
           and b.status in ('freigegeben','angezeigt'))::int as behinderungen_laufend,
       (select count(*) from behinderung b
         where b.storniert_am is null and b.status = 'entwurf')::int
         as behinderungen_entwurf,
       (select count(*) from aufmass a
         where a.storniert_am is null and a.status = 'vorgelegt')::int
         as aufmasse_vorgelegt,
       (select count(*) from bautagebuch b
         where b.storniert_am is null and b.status = 'entwurf')::int as bautage_entwurf,
       (select count(*) from abnahme a where a.storniert_am is null)::int as abnahmen`,
    [NACHTRAG_WACHFRIST_TAGE],
  );
  return zeile ?? {
    projekte: 0, projekte_laufend: 0, nachtraege_offen: 0, nachtraege_ueberfaellig: 0,
    behinderungen_laufend: 0, behinderungen_entwurf: 0, aufmasse_vorgelegt: 0,
    bautage_entwurf: 0, abnahmen: 0,
  };
}

export interface FehlenderBautag {
  readonly projekt_id: string;
  readonly projekt: string;
  readonly projekt_nummer: string;
  /** `JJJJ-MM-TT` — der BERLINER Kalendertag (K-11). */
  readonly datum: string;
  readonly datum_lokal: string;
  /** Deutscher Wochentagsname, aus Postgres — nie aus einer Node-Locale. */
  readonly wochentag: string;
}

/**
 * Wie viele Tage rueckwaerts die Uebersicht nach Luecken sieht.
 *
 * Sieben, und das ist eine ANZEIGEENTSCHEIDUNG und keine Rechtsfrage: eine
 * Woche ist der Zeitraum, den eine Bauleitung montags nachtraegt. Welche Tage
 * darin ueberhaupt einen Eintrag ERWARTEN, ist offen — siehe
 * {@link tageOhneBautagebuch}.
 */
export const BAUTAGEBUCH_LUECKE_TAGE = 7;

/**
 * Die Tage der letzten Woche, an denen ein laufendes Projekt KEINEN
 * Bautagebucheintrag hat (BAU-07).
 *
 * **Die Luecke ist der eigentliche Befund.** Ein Bautagebuch beweist im
 * Streit ueber Behinderung, Bauzeit und Mannstunden, WAS an einem Tag war —
 * und der Tag, an dem niemand etwas geschrieben hat, ist genau der, um den
 * gestritten wird. Eine Liste der vorhandenen Tage zeigt ihn nicht.
 *
 * **Welche Tage einen Eintrag erwarten, ist NICHT entschieden.** Diese
 * Funktion nennt jeden Kalendertag im Projektzeitraum ohne Eintrag — auch
 * Samstag, Sonntag und Feiertag. Das ist absichtlich die weite Auslegung: sie
 * nennt zu viel und nichts zu wenig, und die Oberflaeche sagt daneben, dass
 * die Erwartung offen ist. Eine Filterung auf „Werktage" waere eine erfundene
 * Regel — auf einer Berliner Baustelle wird samstags gearbeitet, und ob der
 * Bauzeitenplan oder der Kalender bestimmt, was fehlt, entscheidet der Kunde.
 * // TODO(client, O-630): An welchen Tagen wird ein Bautagebucheintrag
 * erwartet — an jedem Kalendertag, an jedem Werktag oder nach Bauzeitenplan?
 */
export async function tageOhneBautagebuch(
  kontext: LeseKontext,
  filter: { readonly projektId?: string | null; readonly tage?: number } = {},
): Promise<readonly FehlenderBautag[]> {
  return kontext.abfrage<FehlenderBautag>(
    `with tage as (
       select d::date as datum
         from generate_series(app.berlin_heute() - ($2::int - 1),
                              app.berlin_heute(), interval '1 day') d
     )
     select p.id as projekt_id, p.bezeichnung as projekt, p.nummer as projekt_nummer,
            to_char(t.datum, 'YYYY-MM-DD') as datum,
            to_char(t.datum, 'DD.MM.YYYY') as datum_lokal,
            case extract(isodow from t.datum)
              when 1 then 'Montag' when 2 then 'Dienstag' when 3 then 'Mittwoch'
              when 4 then 'Donnerstag' when 5 then 'Freitag' when 6 then 'Samstag'
              else 'Sonntag' end as wochentag
       from projekt p
       cross join tage t
      where p.archiviert_am is null
        and p.status in ('geplant','in_arbeit')
        and ($1::uuid is null or p.id = $1::uuid)
        -- Vor dem Baubeginn und nach dem Ende fehlt nichts.
        and (p.ist_beginn is null or t.datum >= p.ist_beginn)
        and (p.soll_beginn is null or t.datum >= p.soll_beginn)
        and (p.ist_ende is null or t.datum <= p.ist_ende)
        and not exists (
              select 1 from bautagebuch b
               where b.projekt_id = p.id and b.datum = t.datum
                 and b.storniert_am is null)
      order by t.datum desc, p.nummer`,
    [filter.projektId ?? null, filter.tage ?? BAUTAGEBUCH_LUECKE_TAGE],
  );
}

export interface ProjektMarge {
  /** Cent als Text — nie `number` (Invariante 1). */
  readonly auftragssumme_cent: string;
  readonly berechnet_cent: string;
  readonly lohn_cent: string;
  readonly fremd_cent: string;
}

/**
 * Die Kostenseite eines Projekts — NUR mit `kalkulation.lesen`.
 *
 * **Diese Funktion wird bedingt aufgerufen, nicht ausprobiert.**
 * `app.projekt_kennzahlen` wirft `insufficient_privilege`, wenn
 * `kalkulation.lesen` fehlt oder das Portal nicht `intern` ist — und eine
 * Ausnahme innerhalb der EINEN gebundenen Transaktion einer Seite bricht die
 * ganze Seite ab, statt einen Hinweis zu zeigen. Der Aufrufer fragt das Recht
 * deshalb VORHER in SQL ab (`findeProjektDetail` gibt
 * `darf_kalkulation_lesen` zurueck) und ruft diese Funktion nur dann. Dasselbe
 * Muster steht in `angebote/[id]/page.tsx`.
 *
 * **`null, null` als Zeitraum ist Absicht.** Die Funktion nimmt zwei Daten und
 * verwendet sie nicht: die Auftragssumme IST die ganze Laufzeit — sie laesst
 * sich nicht auf ein Jahr schneiden —, und dasselbe gilt fuer Berechnetes und
 * Fremdleistung (D-522). Auf einer Projektseite gibt es ausserdem keinen
 * Zeitraum, den der Betrachter gewaehlt haette.
 *
 * Gerechnet wird hier NICHTS: die vier Zahlen kommen als Text heraus und
 * gehen durch `finanz/geld.ts`, wo die Marge entsteht.
 */
export async function ladeProjektMarge(
  kontext: LeseKontext, projektId: string,
): Promise<ProjektMarge | null> {
  const [zeile] = await kontext.abfrage<ProjektMarge>(
    `select kz.auftragssumme_cent::text as auftragssumme_cent,
            kz.berechnet_cent::text as berechnet_cent,
            kz.lohn_cent::text as lohn_cent,
            kz.fremd_cent::text as fremd_cent
       from app.projekt_kennzahlen(null, null) kz
      where kz.projekt_id = $1`,
    [projektId],
  );
  return zeile ?? null;
}
