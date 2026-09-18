import 'server-only';
import {
  GESELLSCHAFT_SPALTEN, GRENZE,
  type Gesellschaft, type GesellschaftRoh, type KundenAbfrage,
} from './basis.js';

/**
 * Nachweise: Leistungsnachweise und gegengezeichnete Aufmasse in EINER Liste
 * (CLN-04, BAU-02, BAU-03, 04-SEITENKARTE §8).
 *
 * **Zwei Quellen, eine Liste, und das ist nicht Bequemlichkeit.** Ein Kunde,
 * der von der Reinigung UND vom Bau beliefert wird (O-52), hat dieselbe
 * Frage fuer beides: „was habe ich unterschrieben, und wann". Zwei Tabs
 * dafuer waeren zwei Orte, an denen man nachsehen muss.
 *
 * ===========================================================================
 * Die Unterschriften bekommen eine EIGENE, schmale Projektion
 * ===========================================================================
 *
 * `ladeSignaturen` (`services/reinigung/leistungsnachweis.ts`) laeuft im
 * Kunden-Scope — aber es fuehrt `breitengrad`, `laengengrad`,
 * `geraete_zeit`, `zeitabweichung_sek`, `ip`, `user_agent`,
 * `unterzeichner_name` und den vollstaendigen `snapshot` mit. Fuer eine
 * Unterschrift der Rolle `auftragnehmer` sind das die Standortkoordinaten,
 * die Geraeteuhr und die IP der eingesetzten Kraft. 04-SEITENKARTE §8
 * verschliesst dem Kunden das ganze `personal`-Modul („no names, no
 * schedules"), und RLS wirkt zeilen-, nicht spaltenweise: die Policy laesst
 * die Zeile zu Recht durch, weil sie zum Nachweis des Kunden gehoert.
 *
 * Deshalb steht hier eine eigene Projektion, und der Name des Unterzeichners
 * kommt NUR bei der Rolle `auftraggeber` mit — das ist der Kunde selbst
 * beziehungsweise seine Objektverantwortliche, und dass die eigene
 * Unterschrift mit Namen erscheint, ist der Sinn einer Gegenzeichnung. Fuer
 * `auftragnehmer` steht „Unterschrift der Gesellschaft" ohne Person.
 *
 * `zeitabweichung_sek` bleibt ebenfalls weg. Sie ist die Differenz zwischen
 * Server- und Geraeteuhr (Invariante 5) und gehoert zur internen
 * Plausibilitaetspruefung — fuer den Kunden ist der Zeitpunkt der
 * Serverzeitpunkt, und nur der steht hier.
 */

export type Nachweisart = 'leistungsnachweis' | 'aufmass';

export interface Kundennachweis extends Gesellschaft {
  readonly id: string;
  readonly art: Nachweisart;
  /**
   * NULLABLE: `leistungsnachweis.nummer` ist es in der Tabelle, und KEINE
   * Constraint erzwingt sie fuer `vorgelegt` oder `signiert` (nachgesehen,
   * nicht vermutet). `aufmass.nummer` ist `not null` — der Union-Zweig
   * bestimmt hier also den weiteren der beiden Typen, und die Seite setzt
   * einen Ersatztext statt einer leeren Zelle.
   */
  readonly nummer: string | null;
  readonly status: string;
  /** Objekt ODER Projekt — beim Leistungsnachweis wie beim Aufmass. */
  readonly bezug: string | null;
  /** Der Zeitraum („01.08.2026 – 31.08.2026") oder das Messdatum. */
  readonly zeitraumLokal: string;
  /** ISO-Datum für die Sortierung über beide Quellen. */
  readonly sortDatum: string;
  readonly gegengezeichnet: boolean;
  readonly unterschriften: number;
  /** Nur beim Aufmass gesetzt: die Zahl der Messzeilen. */
  readonly zeilen: number | null;
  /** Nur beim Aufmass: die Erhebungsart (gemeinsam, einseitig …). */
  readonly erhebungsart: string | null;
  /** Nur beim Aufmass: das Projekt, für den Verweis auf die Projektseite. */
  readonly projektId: string | null;
}

interface NachweisZeile extends GesellschaftRoh {
  readonly id: string;
  readonly art: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly bezug: string | null;
  readonly zeitraum_lokal: string;
  readonly sort_datum: string;
  readonly gegengezeichnet: boolean;
  readonly unterschriften: number;
  readonly zeilen: number | null;
  readonly erhebungsart: string | null;
  readonly projekt_id: string | null;
}

/**
 * **Ein `union all` und nicht zwei Abfragen.**
 *
 * Zwei Abfragen liessen die Zusammenfuehrung und damit die Sortierung in
 * TypeScript entstehen — also eine Reihenfolge, die die Datenbank nicht
 * kennt und ein Test nicht sieht. `order by` ueber die Vereinigung
 * sortiert nach dem ISO-Datum, das beide Zweige liefern; die
 * Anzeigeform daneben ist Berliner Ortszeit und taugt nicht zum Sortieren
 * („01.08.2026" vor „28.02.2026").
 *
 * **Die Statuswerte werden NICHT vereinheitlicht.** `leistungsnachweis`
 * kennt `vorgelegt`/`signiert`, `aufmass` kennt `entwurf`/`vorgelegt`/…;
 * beide Decken lassen dem Kunden ohnehin nur die freigegebenen Zustaende
 * (`p_portal_decke`: Leistungsnachweis nur `vorgelegt`/`signiert` und nicht
 * storniert, Aufmass `status <> 'entwurf'` und nicht storniert). Die Seite
 * bildet sie auf das feste Pillenvokabular ab — hier zu uebersetzen hiesse,
 * die Abbildung zweimal zu haben.
 */
export async function listeKundennachweise(
  kontext: KundenAbfrage,
): Promise<readonly Kundennachweis[]> {
  const zeilen = await kontext.abfrage<NachweisZeile>(
    `select * from (
       select l.id, 'leistungsnachweis' as art, l.nummer, l.status::text as status,
              /*
               * coalesce(Objekt, Projekt) und nicht nur das Objekt: die CHECK
               * ln_ein_anker verlangt EINEN der beiden, nicht das Objekt. Ein
               * am Projekt verankerter Nachweis — der Bau-Fall, den diese
               * Seite ausdruecklich mit abdeckt — zeigte sonst „—" unter der
               * Spalte „Objekt / Projekt", obwohl die Zugehoerigkeit in der
               * Zeile steht.
               */
              coalesce(o.bezeichnung, pr.bezeichnung) as bezug,
              concat_ws(' – ', to_char(l.leistungszeitraum_von, 'DD.MM.YYYY'),
                               to_char(l.leistungszeitraum_bis, 'DD.MM.YYYY')) as zeitraum_lokal,
              to_char(l.leistungszeitraum_bis, 'YYYY-MM-DD') as sort_datum,
              exists (select 1 from leistungsnachweis_signatur s
                       where s.mandant_id = l.mandant_id and s.leistungsnachweis_id = l.id
                         and s.rolle = 'auftraggeber') as gegengezeichnet,
              (select count(*) from leistungsnachweis_signatur s
                where s.mandant_id = l.mandant_id
                  and s.leistungsnachweis_id = l.id)::int as unterschriften,
              null::int as zeilen, null::text as erhebungsart, l.projekt_id,
              ${GESELLSCHAFT_SPALTEN}
         from leistungsnachweis l
         join mandant m on m.id = l.mandant_id
         left join objekt o on o.mandant_id = l.mandant_id and o.id = l.objekt_id
         left join projekt pr on pr.mandant_id = l.mandant_id and pr.id = l.projekt_id
       union all
       select a.id, 'aufmass' as art, a.nummer, a.status::text as status,
              p.bezeichnung as bezug,
              to_char(a.messdatum, 'DD.MM.YYYY') as zeitraum_lokal,
              to_char(a.messdatum, 'YYYY-MM-DD') as sort_datum,
              exists (select 1 from aufmass_signatur s
                       where s.mandant_id = a.mandant_id and s.aufmass_id = a.id
                         and s.rolle = 'auftraggeber') as gegengezeichnet,
              (select count(*) from aufmass_signatur s
                where s.mandant_id = a.mandant_id and s.aufmass_id = a.id)::int as unterschriften,
              (select count(*) from aufmass_zeile z
                where z.mandant_id = a.mandant_id and z.aufmass_id = a.id)::int as zeilen,
              a.erhebungsart::text as erhebungsart, a.projekt_id,
              ${GESELLSCHAFT_SPALTEN}
         from aufmass a
         join mandant m on m.id = a.mandant_id
         join projekt p on p.mandant_id = a.mandant_id and p.id = a.projekt_id
     ) as nachweise
     order by sort_datum desc, nummer desc
     limit ${GRENZE}`,
  );
  return zeilen.map(alsZeile);
}

/** Dieselbe Liste, auf die Aufmasse eines Projekts verengt — für die Projektseite. */
export async function aufmasseZumProjekt(
  kontext: KundenAbfrage, projektId: string,
): Promise<readonly Kundennachweis[]> {
  const zeilen = await kontext.abfrage<NachweisZeile>(
    `select a.id, 'aufmass' as art, a.nummer, a.status::text as status,
            /*
             * a.bezeichnung, nicht p.bezeichnung: diese Abfrage ist auf EIN
             * Projekt verengt (a.projekt_id = $1), und dessen Name steht eine
             * Karte hoeher als Ueberschrift. Jede Zeile haette ihn sonst
             * wiederholt, waehrend aufmass.bezeichnung — not null, mit
             * eigener CHECK gegen den Leerstring — ungelesen blieb: der Kunde
             * saehe nicht, WAS gemessen wurde. Im Sammelzweig oben bleibt
             * p.bezeichnung richtig, dort heisst die Spalte
             * „Objekt / Projekt".
             */
            a.bezeichnung as bezug,
            to_char(a.messdatum, 'DD.MM.YYYY') as zeitraum_lokal,
            to_char(a.messdatum, 'YYYY-MM-DD') as sort_datum,
            exists (select 1 from aufmass_signatur s
                     where s.mandant_id = a.mandant_id and s.aufmass_id = a.id
                       and s.rolle = 'auftraggeber') as gegengezeichnet,
            (select count(*) from aufmass_signatur s
              where s.mandant_id = a.mandant_id and s.aufmass_id = a.id)::int as unterschriften,
            (select count(*) from aufmass_zeile z
              where z.mandant_id = a.mandant_id and z.aufmass_id = a.id)::int as zeilen,
            a.erhebungsart::text as erhebungsart, a.projekt_id,
            ${GESELLSCHAFT_SPALTEN}
       from aufmass a
       join mandant m on m.id = a.mandant_id
       join projekt p on p.mandant_id = a.mandant_id and p.id = a.projekt_id
      where a.projekt_id = $1::uuid
      order by a.messdatum desc, a.nummer desc
      limit ${GRENZE}`,
    [projektId],
  );
  return zeilen.map(alsZeile);
}

/* ---------------------------------------------------------------------------
 * Unterschriften — die schmale Projektion
 * ------------------------------------------------------------------------ */

export interface Kundenunterschrift {
  readonly nachweisId: string;
  readonly rolle: string;
  /** Nur bei `auftraggeber` gesetzt — siehe der Kopfkommentar dieser Datei. */
  readonly name: string | null;
  readonly funktion: string | null;
  /** Serverzeit in Berliner Ortszeit (Invariante 2, Invariante 5). */
  readonly unterzeichnetAmLokal: string;
  /** Nachgetragen, also nicht vor Ort gesetzt — das steht dem Kunden zu. */
  readonly nachgetragen: boolean;
  /** Nur beim Aufmass: ein Vorbehalt bei der Gegenzeichnung (VOB/B). */
  readonly vorbehalt: string | null;
}

interface SignaturZeile {
  readonly nachweis_id: string;
  readonly rolle: string;
  readonly name: string | null;
  readonly funktion: string | null;
  readonly lokal: string;
  /** Nur zum Sortieren in der Datenbank — geht nicht in die Projektion. */
  readonly sort_ts: string;
  readonly nachgetragen: boolean;
  readonly vorbehalt: string | null;
}

/**
 * Die Unterschriften zu einer Menge von Nachweisen — in EINER Abfrage.
 *
 * Eine Abfrage je Zeile waere auf einer Liste mit 200 Eintraegen 200
 * Rundreisen. `= any($1::uuid[])` nimmt die Kennungen als Feld; RLS
 * entscheidet weiterhin je Zeile, eine fremde Kennung im Feld liefert also
 * einfach nichts.
 *
 * **`leistungsnachweis_signatur` traegt kein `vorbehalt`, `aufmass_signatur`
 * schon** (nachgesehen, nicht vermutet). Der erste Zweig liefert deshalb
 * `null::text` — und nicht einen leeren String, der aussieht wie „kein
 * Vorbehalt erklaert", obwohl die Frage dort gar nicht gestellt wird.
 */
export async function kundenUnterschriften(
  kontext: KundenAbfrage, nachweisIds: readonly string[], aufmassIds: readonly string[],
): Promise<readonly Kundenunterschrift[]> {
  if (nachweisIds.length === 0 && aufmassIds.length === 0) return [];
  const zeilen = await kontext.abfrage<SignaturZeile>(
    `select s.leistungsnachweis_id as nachweis_id, s.rolle::text as rolle,
            case when s.rolle = 'auftraggeber' then s.unterzeichner_name end as name,
            case when s.rolle = 'auftraggeber' then s.unterzeichner_funktion end as funktion,
            to_char(s.unterzeichnet_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as lokal,
            s.unterzeichnet_am as sort_ts,
            s.nachgetragen, null::text as vorbehalt
       from leistungsnachweis_signatur s
      where s.leistungsnachweis_id = any ($1::uuid[])
     union all
     select s.aufmass_id as nachweis_id, s.rolle::text as rolle,
            case when s.rolle = 'auftraggeber' then s.unterzeichner_name end as name,
            case when s.rolle = 'auftraggeber' then s.unterzeichner_funktion end as funktion,
            to_char(s.unterzeichnet_am at time zone 'Europe/Berlin',
                    'DD.MM.YYYY HH24:MI') as lokal,
            s.unterzeichnet_am as sort_ts,
            s.nachgetragen, s.vorbehalt
       from aufmass_signatur s
      where s.aufmass_id = any ($2::uuid[])
     /*
      * Nach dem ZEITPUNKT, nicht nach der Anzeigeform. Die Spalte lokal ist
      * DD.MM.YYYY HH24:MI — als Text sortiert steht „01.09.2026" vor
      * „28.08.2026", und die Reihenfolge Auftragnehmer/Auftraggeber, die auf
      * der Projektseite die Aussage traegt, kippt ueber jeden Monats- oder
      * Jahreswechsel. Dieselbe Regel, die listeKundennachweise oben mit
      * sort_datum befolgt.
      */
     order by sort_ts`,
    [[...nachweisIds], [...aufmassIds]],
  );
  return zeilen.map((z) => ({
    nachweisId: z.nachweis_id,
    rolle: z.rolle,
    name: z.name,
    funktion: z.funktion,
    unterzeichnetAmLokal: z.lokal,
    nachgetragen: z.nachgetragen,
    vorbehalt: z.vorbehalt,
  }));
}

function alsZeile(z: NachweisZeile): Kundennachweis {
  return {
    id: z.id,
    art: z.art === 'aufmass' ? 'aufmass' : 'leistungsnachweis',
    nummer: z.nummer,
    status: z.status,
    bezug: z.bezug,
    zeitraumLokal: z.zeitraum_lokal,
    sortDatum: z.sort_datum,
    gegengezeichnet: z.gegengezeichnet,
    unterschriften: Number(z.unterschriften),
    zeilen: z.zeilen === null ? null : Number(z.zeilen),
    erhebungsart: z.erhebungsart,
    projektId: z.projekt_id,
    mandantSlug: z.mandant_slug,
    mandantName: z.mandant_name,
  };
}
