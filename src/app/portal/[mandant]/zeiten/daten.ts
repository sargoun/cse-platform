import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import type { Sitzung } from '@/server/kontext/index';
import { leseNachweis, summeDerEintraege, type MiLoGNachweis }
  from '@/server/services/zeit/milog';

/**
 * Die Daten des Zeitbereichs (TIM-08, TIM-11, TIM-12, TIM-13, LEG-02).
 *
 * **Jede Zeitangabe kommt fertig aus der Datenbank** — als Zeichenkette in
 * Berliner Ortszeit, gerechnet von `at time zone`. Der Node-Prozess rechnet
 * keine Zone um: seine Zonendatenbank ist nicht die des Servers, und `TZ` der
 * Laufzeit soll eine Nachtschicht nicht um eine Stunde verschieben können
 * (Invariante 2, §7.2).
 *
 * **Und die laufende Dauer kommt aus `now()` der Datenbank**, nicht aus
 * `Date.now()` im Browser oder im Server-Prozess. Ein Gerät, das falsch geht,
 * ändert keine angezeigte Zeit (Invariante 5) — der ESLint-Wächter
 * `cse/no-client-clock` hält das offen.
 */

/** Ein Merkmal, nach dem die Liste gefiltert werden kann — ein GESCHLOSSENER Satz. */
export type Merkmal =
  | 'laufend' | 'abgeschlossen' | 'offen_nacherfassung' | 'storniert'
  | 'nacherfasst' | 'ohne_auftrag' | 'freigegeben';

export const MERKMALE: readonly Merkmal[] = [
  'laufend', 'abgeschlossen', 'offen_nacherfassung', 'storniert',
  'nacherfasst', 'ohne_auftrag', 'freigegeben',
];

export const MERKMAL_TEXT: Readonly<Record<Merkmal, string>> = {
  laufend: 'Läuft',
  abgeschlossen: 'Abgeschlossen',
  offen_nacherfassung: 'Nacherfassung offen',
  storniert: 'Storniert',
  nacherfasst: 'Nacherfasst',
  ohne_auftrag: 'Ohne Auftrag',
  freigegeben: 'Freigegeben',
};

export function istMerkmal(wert: unknown): wert is Merkmal {
  return typeof wert === 'string' && (MERKMALE as readonly string[]).includes(wert);
}

export interface ZeitFilter {
  /** Berliner Kalendertag, einschliesslich. */
  readonly von: string;
  /** Berliner Kalendertag, einschliesslich. */
  readonly bis: string;
  readonly personId: string | null;
  readonly objektId: string | null;
  readonly merkmal: Merkmal | null;
}

export interface ZeitZeile {
  readonly id: string;
  readonly ketteId: string;
  readonly version: number;
  readonly person: string;
  readonly personId: string;
  readonly objekt: string | null;
  readonly objektId: string | null;
  readonly auftragsnummer: string | null;
  readonly leistung: string | null;
  readonly beginnLokal: string;
  readonly endeLokal: string | null;
  readonly endeFolgetag: boolean;
  readonly pauseMinuten: number;
  readonly bruttoMinuten: number | null;
  readonly nettoMinuten: number | null;
  /** Nur bei laufenden Einträgen: Minuten seit dem Beginn, aus `now()`. */
  readonly laufendMinuten: number | null;
  readonly status: string;
  readonly nacherfasst: boolean;
  readonly ohneAuftrag: boolean;
  readonly storniert: boolean;
  readonly freigegeben: boolean;
  readonly abgerechnet: boolean;
  readonly gesperrt: boolean;
}

interface ZeitZeileRoh {
  readonly id: string;
  readonly kette_id: string;
  readonly version: number;
  readonly person: string;
  readonly person_id: string;
  readonly objekt: string | null;
  readonly objekt_id: string | null;
  readonly auftragsnummer: string | null;
  readonly leistung: string | null;
  readonly beginn_lokal: string;
  readonly ende_lokal: string | null;
  readonly ende_folgetag: boolean;
  readonly pause_minuten: number;
  readonly brutto_minuten: number | null;
  readonly netto_minuten: number | null;
  readonly laufend_minuten: number | null;
  readonly status: string;
  readonly nacherfasst: boolean;
  readonly ohne_auftrag: boolean;
  readonly storniert: boolean;
  readonly freigegeben: boolean;
  readonly abgerechnet: boolean;
  readonly gesperrt: boolean;
}

function zeile(z: ZeitZeileRoh): ZeitZeile {
  return {
    id: z.id,
    ketteId: z.kette_id,
    version: Number(z.version),
    person: z.person,
    personId: z.person_id,
    objekt: z.objekt,
    objektId: z.objekt_id,
    auftragsnummer: z.auftragsnummer,
    leistung: z.leistung,
    beginnLokal: z.beginn_lokal,
    endeLokal: z.ende_lokal,
    endeFolgetag: z.ende_folgetag,
    pauseMinuten: Number(z.pause_minuten),
    bruttoMinuten: z.brutto_minuten === null ? null : Number(z.brutto_minuten),
    nettoMinuten: z.netto_minuten === null ? null : Number(z.netto_minuten),
    laufendMinuten: z.laufend_minuten === null ? null : Number(z.laufend_minuten),
    status: z.status,
    nacherfasst: z.nacherfasst,
    ohneAuftrag: z.ohne_auftrag,
    storniert: z.storniert,
    freigegeben: z.freigegeben,
    abgerechnet: z.abgerechnet,
    gesperrt: z.gesperrt,
  };
}

/**
 * Die Auswahl, die der Filter anbietet — und zwar NUR, was im Fenster
 * vorkommt.
 *
 * Ein Filter, der jede Person der Gesellschaft anbietet, führt bei jedem
 * dritten Klick auf eine leere Liste; einer, der die Namen des Fensters
 * anbietet, kann das nicht.
 */
export interface FilterAuswahl {
  readonly personen: readonly { readonly id: string; readonly name: string }[];
  readonly objekte: readonly { readonly id: string; readonly name: string }[];
}

export interface Zeitfenster {
  readonly zeilen: readonly ZeitZeile[];
  readonly auswahl: FilterAuswahl;
}

/** Die gemeinsamen Spalten der Liste und der Einzelansicht. */
const ZEILE_SPALTEN = `
         z.id, z.kette_id, z.version,
         (p.vorname || ' ' || p.nachname)                    as person,
         z.person_id,
         o.bezeichnung                                       as objekt,
         z.objekt_id,
         a.auftragsnummer,
         al.bezeichnung                                      as leistung,
         to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM. HH24:MI')
                                                             as beginn_lokal,
         to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'HH24:MI')
                                                             as ende_lokal,
         coalesce(
           (z.ende_zeitpunkt at time zone 'Europe/Berlin')::date
           > (z.beginn_zeitpunkt at time zone 'Europe/Berlin')::date, false)
                                                             as ende_folgetag,
         z.pause_minuten,
         z.dauer_brutto_minuten                              as brutto_minuten,
         z.dauer_netto_minuten                               as netto_minuten,
         case when z.ende_zeitpunkt is null
              then floor(extract(epoch from (now() - z.beginn_zeitpunkt)) / 60)::int
         end                                                 as laufend_minuten,
         z.status::text                                      as status,
         z.nacherfasst,
         (z.auftrag_leistung_id is null)                     as ohne_auftrag,
         (z.storniert_am   is not null)                      as storniert,
         (z.freigegeben_am is not null)                      as freigegeben,
         (z.abgerechnet_am is not null)                      as abgerechnet,
         (z.gesperrt_am    is not null)                      as gesperrt`;

/** Die gemeinsame Herkunft dieser Spalten. */
const ZEILE_QUELLE = `
    from zeiteintrag z
    join person p on p.id = z.person_id
    left join objekt o on o.mandant_id = z.mandant_id and o.id = z.objekt_id
    left join auftrag_leistung al
           on al.mandant_id = z.mandant_id and al.id = z.auftrag_leistung_id
    left join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id`;

/** Die `where`-Zeilen des Merkmalsfilters — je Merkmal genau eine Bedingung. */
function merkmalsBedingung(merkmal: Merkmal): string {
  switch (merkmal) {
    case 'nacherfasst': return 'z.nacherfasst';
    case 'ohne_auftrag': return 'z.auftrag_leistung_id is null';
    case 'freigegeben': return 'z.freigegeben_am is not null';
    default: return `z.status = '${merkmal}'::zeiteintrag_status`;
  }
}

export async function ladeZeitfenster(
  sitzung: Sitzung, filter: ZeitFilter,
): Promise<Zeitfenster> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const werte: unknown[] = [filter.von, filter.bis];
      const teile: string[] = [
        /**
         * Die ÜBERSCHNEIDUNG, nicht `beginn::date between …`. Sonst fehlte
         * die Nachtschicht vom Sonntag auf den Montag im Fenster des Montags
         * — sichtbar leer, und niemand vermisst sie.
         *
         * Ein laufender Eintrag hat kein Ende; sein Intervall ist nach oben
         * offen und überschneidet damit jedes Fenster, das nach seinem Beginn
         * liegt. Das ist gewollt: eine vergessene Abmeldung soll auffallen.
         */
        `z.beginn_zeitpunkt < (($2::date + 1)::timestamp) at time zone 'Europe/Berlin'`,
        `(z.ende_zeitpunkt is null`
        + ` or z.ende_zeitpunkt > ($1::date::timestamp) at time zone 'Europe/Berlin')`,
        // Nur die aktuelle Fassung jeder Kette. Die älteren stehen in der
        // Korrekturspur des Eintrags, nicht als zweite Zeile in der Liste.
        'z.ersetzt_am is null',
      ];
      if (filter.personId !== null) {
        werte.push(filter.personId);
        teile.push(`z.person_id = $${String(werte.length)}::uuid`);
      }
      if (filter.objektId !== null) {
        werte.push(filter.objektId);
        teile.push(`z.objekt_id = $${String(werte.length)}::uuid`);
      }
      if (filter.merkmal !== null) teile.push(merkmalsBedingung(filter.merkmal));

      const roh = await kontext.abfrage<ZeitZeileRoh>(
        `select ${ZEILE_SPALTEN} ${ZEILE_QUELLE}
          where ${teile.join(' and ')}
          order by z.beginn_zeitpunkt desc, z.id`,
        werte,
      );

      /**
       * Die Auswahl liest DASSELBE Fenster, aber ohne Personen- und
       * Objektfilter: sonst böte der Filter nach dem ersten Klick nur noch
       * sich selbst an, und der Weg zurück wäre die Adresszeile.
       */
      const fenster = `z.beginn_zeitpunkt < (($2::date + 1)::timestamp) at time zone 'Europe/Berlin'
        and (z.ende_zeitpunkt is null
             or z.ende_zeitpunkt > ($1::date::timestamp) at time zone 'Europe/Berlin')
        and z.ersetzt_am is null`;

      const personen = await kontext.abfrage<{ id: string; name: string }>(
        `select distinct p.id, (p.vorname || ' ' || p.nachname) as name
           from zeiteintrag z join person p on p.id = z.person_id
          where ${fenster}
          order by name`,
        [filter.von, filter.bis],
      );
      const objekte = await kontext.abfrage<{ id: string; name: string }>(
        `select distinct o.id, o.bezeichnung as name
           from zeiteintrag z
           join objekt o on o.mandant_id = z.mandant_id and o.id = z.objekt_id
          where ${fenster}
          order by name`,
        [filter.von, filter.bis],
      );

      return { zeilen: roh.map(zeile), auswahl: { personen, objekte } };
    })) as Promise<Zeitfenster>;
}

/** Eine Zeile des Live-Bretts (DSH-05). */
export interface LaufendeZeile {
  readonly id: string;
  readonly person: string;
  readonly objekt: string | null;
  readonly seitLokal: string;
  readonly minuten: number;
  readonly erfassungsart: string;
}

/**
 * „Aktuell im Einsatz" — aus DERSELBEN Sicht wie die Kachel des Dashboards.
 *
 * `zeiteintrag_offen` ist die eine Bedingung; eine zweite `where`-Zeile an
 * dieser Stelle wäre die zweite Wahrheit, gegen die
 * `tests/isolation/zeiteintrag.test.ts` prüft. Die Namen kommen dazu, die
 * Auswahl nicht.
 */
export interface LiveBrett {
  /** Der Zeitpunkt, auf den sich die Minutenzahlen beziehen — Berliner Ortszeit. */
  readonly standLokal: string;
  readonly zeilen: readonly LaufendeZeile[];
}

export async function ladeLaufende(sitzung: Sitzung): Promise<LiveBrett> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const roh = await kontext.abfrage<{
        id: string; person: string; objekt: string | null;
        seit_lokal: string; minuten: number; erfassungsart: string;
      }>(
        `select v.id,
                (p.vorname || ' ' || p.nachname) as person,
                o.bezeichnung                    as objekt,
                to_char(v.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM. HH24:MI')
                                                 as seit_lokal,
                floor(extract(epoch from (now() - v.beginn_zeitpunkt)) / 60)::int
                                                 as minuten,
                v.erfassungsart_beginn::text     as erfassungsart
           from zeiteintrag_offen v
           join person p on p.id = v.person_id
           left join objekt o on o.mandant_id = v.mandant_id and o.id = v.objekt_id
          order by v.beginn_zeitpunkt`,
      );
      /**
       * Der Stand steht dabei — und zwar aus DERSELBEN Transaktion, in der die
       * Minuten gerechnet wurden. Eine Seite, die „läuft seit 3:12 h" sagt und
       * seit zwanzig Minuten im Browser steht, sagt etwas Falsches; mit dem
       * Stand daneben sagt sie etwas Wahres über einen vergangenen Zeitpunkt.
       */
      const [jetzt] = await kontext.abfrage<{ stand: string }>(
        `select to_char(now() at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') as stand`,
      );

      return {
        standLokal: jetzt?.stand ?? '',
        zeilen: roh.map((z) => ({
          id: z.id,
          person: z.person,
          objekt: z.objekt,
          seitLokal: z.seit_lokal,
          minuten: Number(z.minuten),
          erfassungsart: z.erfassungsart,
        })),
      };
    })) as Promise<LiveBrett>;
}

/** Ein Medium, das an einem Eintrag hängt (TIM-10, DOC-06). */
export interface MediumZeile {
  readonly id: string;
  readonly art: string;
  readonly mimeTyp: string;
  readonly groesseBytes: number;
  readonly beschreibung: string | null;
  readonly hochgeladenLokal: string;
  readonly entfernt: boolean;
}

/** Eine Zeile der Korrekturspur (TIM-11). */
export interface SpurZeile {
  readonly id: string;
  readonly art: string;
  readonly grund: string;
  readonly begruendung: string;
  readonly amLokal: string;
  /** `null`, wenn die Sitzung `system.benutzer_lesen` nicht hält. */
  readonly durchVon: string | null;
  readonly ursprungId: string;
  readonly ersatzId: string | null;
}

/** Der einzelne Eintrag — alles, was TIM-08 bis TIM-11 sichtbar verlangen. */
export interface Zeiteintrag extends ZeitZeile {
  readonly mandantId: string;
  readonly einsatzId: string | null;
  readonly beginnVollLokal: string;
  readonly endeVollLokal: string | null;
  readonly erfassungsartBeginn: string;
  readonly erfassungsartEnde: string | null;
  readonly quelleBeginn: string;
  readonly quelleEnde: string | null;
  readonly geraeteZeitBeginnLokal: string | null;
  readonly geraeteZeitEndeLokal: string | null;
  readonly abweichungBeginnSek: number | null;
  readonly abweichungEndeSek: number | null;
  readonly geoBeginnStatus: string | null;
  readonly geoEndeStatus: string | null;
  readonly geoBeginn: string | null;
  readonly geoEnde: string | null;
  readonly geoBeginnGenauigkeitM: number | null;
  readonly geoEndeGenauigkeitM: number | null;
  readonly behauptetBeginnLokal: string | null;
  readonly behauptetEndeLokal: string | null;
  readonly behauptetPauseMinuten: number | null;
  readonly nacherfassungVerzoegerungSek: number | null;
  readonly ausOfflineWarteschlange: boolean;
  readonly notiz: string | null;
  readonly stornoGrund: string | null;
  readonly ersetztDurchId: string | null;
  readonly ersetztZeiteintragId: string | null;
  readonly spur: readonly SpurZeile[];
  readonly medien: readonly MediumZeile[];
}

export async function ladeZeiteintrag(
  sitzung: Sitzung, id: string,
): Promise<Zeiteintrag | null> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [roh] = await kontext.abfrage<ZeitZeileRoh & {
        mandant_id: string;
        einsatz_id: string | null;
        beginn_voll_lokal: string;
        ende_voll_lokal: string | null;
        erfassungsart_beginn: string;
        erfassungsart_ende: string | null;
        quelle_beginn: string;
        quelle_ende: string | null;
        geraete_zeit_beginn_lokal: string | null;
        geraete_zeit_ende_lokal: string | null;
        abweichung_beginn_sek: number | null;
        abweichung_ende_sek: number | null;
        geo_beginn_status: string | null;
        geo_ende_status: string | null;
        geo_beginn: string | null;
        geo_ende: string | null;
        geo_beginn_genauigkeit_m: number | null;
        geo_ende_genauigkeit_m: number | null;
        behauptet_beginn_lokal: string | null;
        behauptet_ende_lokal: string | null;
        behauptet_pause_minuten: number | null;
        nacherfassung_verzoegerung_sek: number | null;
        aus_offline: boolean;
        notiz: string | null;
        storno_grund: string | null;
        ersetzt_durch_zeiteintrag_id: string | null;
        ersetzt_zeiteintrag_id: string | null;
      }>(
        `select ${ZEILE_SPALTEN},
                z.mandant_id, z.einsatz_id,
                to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                            as beginn_voll_lokal,
                to_char(z.ende_zeitpunkt   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                            as ende_voll_lokal,
                z.erfassungsart_beginn::text                as erfassungsart_beginn,
                z.erfassungsart_ende::text                  as erfassungsart_ende,
                z.quelle_beginn::text                       as quelle_beginn,
                z.quelle_ende::text                         as quelle_ende,
                to_char(z.geraete_zeit_beginn at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS')
                                                            as geraete_zeit_beginn_lokal,
                to_char(z.geraete_zeit_ende   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI:SS')
                                                            as geraete_zeit_ende_lokal,
                z.zeitabweichung_beginn_sek                 as abweichung_beginn_sek,
                z.zeitabweichung_ende_sek                   as abweichung_ende_sek,
                z.geo_beginn_status::text                   as geo_beginn_status,
                z.geo_ende_status::text                     as geo_ende_status,
                case when z.geo_beginn_lat is not null
                     then z.geo_beginn_lat::text || ', ' || z.geo_beginn_lon::text end
                                                            as geo_beginn,
                case when z.geo_ende_lat is not null
                     then z.geo_ende_lat::text || ', ' || z.geo_ende_lon::text end
                                                            as geo_ende,
                z.geo_beginn_genauigkeit_m, z.geo_ende_genauigkeit_m,
                to_char(z.behauptet_beginn at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                            as behauptet_beginn_lokal,
                to_char(z.behauptet_ende   at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                            as behauptet_ende_lokal,
                z.behauptet_pause_minuten,
                z.nacherfassung_verzoegerung_sek,
                (z.offline_ereignis_id is not null)         as aus_offline,
                z.notiz, z.storno_grund,
                z.ersetzt_durch_zeiteintrag_id, z.ersetzt_zeiteintrag_id
         ${ZEILE_QUELLE}
          where z.id = $1::uuid`,
        [id],
      );
      if (roh === undefined) return null;

      /**
       * Die Spur liest die KETTE, nicht die Zeile: eine Korrektur erzeugt eine
       * neue Fassung, und die Geschichte gehört allen Fassungen gemeinsam
       * (TIM-11). `zk_kette_idx` bedient genau diesen Zugriff.
       *
       * Der Name des Korrigierenden kommt aus `benutzer` und damit durch die
       * RLS dieser Tabelle: wer `system.benutzer_lesen` nicht hält, sieht
       * `null`. Das steht so in der Anzeige — eine erfundene Beschriftung wäre
       * die schlechtere Antwort.
       */
      const spur = await kontext.abfrage<{
        id: string; art: string; grund: string; begruendung: string;
        am_lokal: string; durch_von: string | null;
        ursprung_id: string; ersatz_id: string | null;
      }>(
        `select k.id, k.art::text as art, k.grund_kategorie::text as grund,
                k.begruendung,
                to_char(k.durchgefuehrt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                     as am_lokal,
                b.name                               as durch_von,
                k.ursprung_zeiteintrag_id            as ursprung_id,
                k.ersatz_zeiteintrag_id              as ersatz_id
           from zeiteintrag_korrektur k
           left join benutzer b on b.id = k.durchgefuehrt_von
          where k.kette_id = $1::uuid
          order by k.durchgefuehrt_am`,
        [roh.kette_id],
      );

      const medien = await kontext.abfrage<{
        id: string; art: string; mime_typ: string; groesse_bytes: string;
        beschreibung: string | null; hochgeladen_lokal: string; entfernt: boolean;
      }>(
        `select m.id, m.art::text as art, m.mime_typ, m.groesse_bytes::text,
                m.beschreibung,
                to_char(m.erstellt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                       as hochgeladen_lokal,
                (m.storage_geloescht_am is not null)    as entfernt
           from einsatz_medien m
          where m.zeiteintrag_id = $1::uuid
          order by m.erstellt_am`,
        [id],
      );

      return {
        ...zeile(roh),
        mandantId: roh.mandant_id,
        einsatzId: roh.einsatz_id,
        beginnVollLokal: roh.beginn_voll_lokal,
        endeVollLokal: roh.ende_voll_lokal,
        erfassungsartBeginn: roh.erfassungsart_beginn,
        erfassungsartEnde: roh.erfassungsart_ende,
        quelleBeginn: roh.quelle_beginn,
        quelleEnde: roh.quelle_ende,
        geraeteZeitBeginnLokal: roh.geraete_zeit_beginn_lokal,
        geraeteZeitEndeLokal: roh.geraete_zeit_ende_lokal,
        abweichungBeginnSek: roh.abweichung_beginn_sek === null
          ? null : Number(roh.abweichung_beginn_sek),
        abweichungEndeSek: roh.abweichung_ende_sek === null
          ? null : Number(roh.abweichung_ende_sek),
        geoBeginnStatus: roh.geo_beginn_status,
        geoEndeStatus: roh.geo_ende_status,
        geoBeginn: roh.geo_beginn,
        geoEnde: roh.geo_ende,
        geoBeginnGenauigkeitM: roh.geo_beginn_genauigkeit_m === null
          ? null : Number(roh.geo_beginn_genauigkeit_m),
        geoEndeGenauigkeitM: roh.geo_ende_genauigkeit_m === null
          ? null : Number(roh.geo_ende_genauigkeit_m),
        behauptetBeginnLokal: roh.behauptet_beginn_lokal,
        behauptetEndeLokal: roh.behauptet_ende_lokal,
        behauptetPauseMinuten: roh.behauptet_pause_minuten === null
          ? null : Number(roh.behauptet_pause_minuten),
        nacherfassungVerzoegerungSek: roh.nacherfassung_verzoegerung_sek === null
          ? null : Number(roh.nacherfassung_verzoegerung_sek),
        ausOfflineWarteschlange: roh.aus_offline,
        notiz: roh.notiz,
        stornoGrund: roh.storno_grund,
        ersetztDurchId: roh.ersetzt_durch_zeiteintrag_id,
        ersetztZeiteintragId: roh.ersetzt_zeiteintrag_id,
        spur: spur.map((s) => ({
          id: s.id,
          art: s.art,
          grund: s.grund,
          begruendung: s.begruendung,
          amLokal: s.am_lokal,
          durchVon: s.durch_von,
          ursprungId: s.ursprung_id,
          ersatzId: s.ersatz_id,
        })),
        medien: medien.map((m) => ({
          id: m.id,
          art: m.art,
          mimeTyp: m.mime_typ,
          groesseBytes: Number(m.groesse_bytes),
          beschreibung: m.beschreibung,
          hochgeladenLokal: m.hochgeladen_lokal,
          entfernt: m.entfernt,
        })),
      };
    })) as Promise<Zeiteintrag | null>;
}

/** Eine Zeile des Korrekturbuchs — dieselbe Spur, quer über alle Einträge. */
export interface KorrekturbuchZeile extends SpurZeile {
  readonly person: string;
  readonly betrifftLokal: string;
}

/**
 * Das Korrekturbuch eines Fensters (TIM-11, LEG-01, SEC-A9).
 *
 * Gefiltert wird nach dem Tag der KORREKTUR, nicht nach dem der Schicht: wer
 * fragt „was wurde diese Woche geändert?", meint die Änderung. Der betroffene
 * Zeitraum steht daneben, damit die Frage „an welcher Schicht?" ohne einen
 * zweiten Klick beantwortet ist.
 */
export async function ladeKorrekturbuch(
  sitzung: Sitzung, von: string, bis: string,
): Promise<readonly KorrekturbuchZeile[]> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const roh = await kontext.abfrage<{
        id: string; art: string; grund: string; begruendung: string;
        am_lokal: string; durch_von: string | null;
        ursprung_id: string; ersatz_id: string | null;
        person: string; betrifft_lokal: string;
      }>(
        `select k.id, k.art::text as art, k.grund_kategorie::text as grund,
                k.begruendung,
                to_char(k.durchgefuehrt_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                  as am_lokal,
                b.name                            as durch_von,
                k.ursprung_zeiteintrag_id         as ursprung_id,
                k.ersatz_zeiteintrag_id           as ersatz_id,
                (p.vorname || ' ' || p.nachname)  as person,
                to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                                  as betrifft_lokal
           from zeiteintrag_korrektur k
           join zeiteintrag z
             on z.mandant_id = k.mandant_id and z.id = k.ursprung_zeiteintrag_id
           join person p on p.id = z.person_id
           left join benutzer b on b.id = k.durchgefuehrt_von
          where k.durchgefuehrt_am >= ($1::date::timestamp) at time zone 'Europe/Berlin'
            and k.durchgefuehrt_am <  (($2::date + 1)::timestamp) at time zone 'Europe/Berlin'
          order by k.durchgefuehrt_am desc`,
        [von, bis],
      );
      return roh.map((k) => ({
        id: k.id,
        art: k.art,
        grund: k.grund,
        begruendung: k.begruendung,
        amLokal: k.am_lokal,
        durchVon: k.durch_von,
        ursprungId: k.ursprung_id,
        ersatzId: k.ersatz_id,
        person: k.person,
        betrifftLokal: k.betrifft_lokal,
      }));
    })) as Promise<readonly KorrekturbuchZeile[]>;
}

/** Eine Anstellung, wie die MiLoG-Auswahl sie anbietet. */
export interface AnstellungsZeile {
  readonly id: string;
  readonly person: string;
  readonly personalnummer: string | null;
}

/**
 * Die Anstellungen mit erfasster Zeit in diesem Monat.
 *
 * Nicht alle Anstellungen des Bereichs: eine Auswahl, die Namen ohne einen
 * einzigen Eintrag anbietet, führt auf eine leere Aufzeichnung, und eine leere
 * Aufzeichnung sieht aus wie ein Fehler.
 *
 * **Ohne `stundensatz_intern`** — die Spalte ist durch GRANT geschützt (K-05),
 * und diese Seite hat mit Lohn nichts zu tun.
 */
export async function ladeAnstellungenMitZeit(
  sitzung: Sitzung, monat: string,
): Promise<readonly AnstellungsZeile[]> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<AnstellungsZeile>(
      `select distinct an.id,
              (p.vorname || ' ' || p.nachname) as person,
              an.personalnummer
         from milog_aufzeichnung m
         join anstellung an on an.mandant_id = m.mandant_id and an.id = m.anstellung_id
         join person p on p.id = an.person_id
        where m.monat = $1::date
        order by person`,
      [monat],
    ))) as Promise<readonly AnstellungsZeile[]>;
}

/**
 * Die Aufzeichnung eines Monats — der Dienst rechnet, diese Datei reicht durch.
 *
 * Die Gegenprobe (`summeDerEintraege`) läuft in DERSELBEN Transaktion und
 * damit auf demselben Schnappschuss: zwei Zahlen, die aus zwei Momenten
 * stammen, wären als Gegenprobe wertlos.
 */
export async function ladeNachweis(
  sitzung: Sitzung, anstellungId: string, monat: string,
): Promise<{
  readonly nachweis: MiLoGNachweis;
  readonly gegenprobe: { readonly bruttoMinuten: number; readonly nettoMinuten: number };
}> {
  return db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const eingabe = { anstellungId, monat };
      const nachweis = await leseNachweis(kontext, eingabe);
      const gegenprobe = await summeDerEintraege(kontext, eingabe);
      return { nachweis, gegenprobe };
    })) as Promise<{
      readonly nachweis: MiLoGNachweis;
      readonly gegenprobe: { readonly bruttoMinuten: number; readonly nettoMinuten: number };
    }>;
}

/**
 * Darf DIESE Sitzung DIESEN Zeiteintrag korrigieren (TIM-11, EMP-07)?
 *
 * Zwei Fragen in einem Zugriff, weil beide Antworten zusammen gehören:
 *
 *  - `recht` — hält die Sitzung `zeit.korrigieren` in dieser Gesellschaft?
 *    Ein Knopf, der auf 404 führt, verrät die Existenz dessen, was er nicht
 *    zeigen darf (AUT-06).
 *  - `eigener` — ist das der eigene Zeiteintrag? Gefragt über
 *    `benutzer.person_id`, genau wie `kern.korrektur_nicht_selbst` (0036): ein
 *    Mensch mit zwei Beschäftigungen hat EINEN Login, und die Frage ist, wessen
 *    Zeitdatensatz das ist — nicht, mit welchem Konto jemand angemeldet war.
 *    Die Sitzung trägt zwar eine `personId`, aber im internen Portal ist sie
 *    nicht immer belegt; die Datenbank ist hier die Quelle.
 *
 * Getrennt gefragt wäre es ein zweiter Rundgang für eine Auskunft, die nur
 * zusammen etwas aussagt: das Recht ohne die Selbstprüfung zeigt ein Formular,
 * das die Datenbank sicher abweist.
 */
export interface Korrekturbefugnis {
  readonly recht: boolean;
  readonly eigener: boolean;
}

export async function darfKorrigieren(
  sitzung: Sitzung, personId: string,
): Promise<Korrekturbefugnis> {
  const [zeile] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, (kontext) => kontext.abfrage<Korrekturbefugnis>(
      `select app.hat_recht('zeit.korrigieren', app.aktiver_mandant()) as recht,
              exists (select 1 from benutzer b
                       where b.id = app.aktueller_benutzer()
                         and b.person_id = $1::uuid)                  as eigener`,
      [personId],
    ))) as Promise<readonly Korrekturbefugnis[]>);
  return zeile ?? { recht: false, eigener: false };
}
