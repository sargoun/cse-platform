import type { LeseKontext } from '../../kontext/index.js';
import { cent, NULL_CENT, type Cent } from '../finanz/geld.js';
import { rechteJeBereich } from './uebersicht.js';

/**
 * Die Vergabepipeline über alle Gesellschaften (RAD-07, REP-06, TEN-05).
 *
 * **Die Gruppe fasst zusammen — sie bewertet nicht noch einmal.** Eine
 * Punktzahl entsteht in `bewertung`, gegen das Suchprofil GENAU EINER
 * Gesellschaft, aus `server/services/radar/bewertung.ts`. Diese Datei liest
 * sie und stellt sie nebeneinander; sie bildet keinen Mittelwert, keine
 * „Gruppenpunktzahl" und keine zweite Rangfolge. Eine Zahl, die aussähe wie
 * eine Bewertung, aber keine wäre, ist genau die Art erfundene
 * Geschäftsregel, die RAD-05 („der Code begründet jede Punktzahl in
 * deutschem Klartext") unmöglich machen soll.
 *
 * **Was die Gruppe sieht, das der Bereich nicht sehen kann.** Eine
 * Bekanntmachung, die in ZWEI Gesellschaften im Blick ist. Die Reinigung
 * weiss nicht, dass die Security dieselbe Vergabe bewertet hat; nebeneinander
 * ist es eine Zeile mit zwei Zellen. Was daraus folgt — wer bietet, ob
 * gemeinsam, ob einer zurücktritt — steht NICHT hier: das ist eine
 * Geschäftsregel, die der Auftraggeber setzt (O-870).
 *
 * **Die Bekanntmachung ist öffentlich, die Bewertung nicht.** `ausschreibung`
 * und `vergabeplattform` tragen keinen Mandanten (0146: `r_gruppe_lesen`,
 * sichtbar sobald `gruppe.radar.lesen` in IRGENDEINEM Bereich gilt);
 * `bewertung`, `ausschreibung_vorgang`, `radar_profil` und
 * `mandant_plattform_registrierung` tragen ihn und werden je Bereich
 * gefiltert (0145: `t_gruppe`). Deshalb: die Liste der Bekanntmachungen ist
 * für die ganze Gruppe dieselbe, die ZELLEN darin sind es nicht.
 *
 * **Eine Zelle ohne Recht ist `null` und nicht 0** — dieselbe Regel wie in
 * `gruppe/finanzen.ts`. RLS gäbe in einem Bereich ohne `gruppe.radar.lesen`
 * eine 0 zurück, und die sähe aus wie „dort ist gerade nichts los".
 */
export const RADAR_RECHT = 'gruppe.radar.lesen';

/**
 * Die Schwelle aus RAD-06 wird ÜBERGEBEN, nicht hier noch einmal
 * hingeschrieben: `app/portal/[mandant]/radar/frist.ts` hält sie als
 * `KNAPP_TAGE`, und zwei Abschriften einer Schwelle laufen auseinander.
 */
export interface RadarOptionen {
  /** RAD-06: ab hier ist die Abgabe knapp. */
  readonly knappTage: number;
  /** Auch Bekanntmachungen mit abgelaufener Frist zeigen. */
  readonly auchAbgelaufene?: boolean;
  /** Nur diese Bereiche — die Auswahl der Filterleiste. */
  readonly mandantIds?: readonly string[];
  readonly grenze?: number;
}

export interface BereichRadar {
  readonly mandantId: string;
  readonly slug: string;
  readonly name: string;
  /** Aktive Bekanntmachungen, die DIESER Bereich bewertet hat. */
  readonly bewertet: number | null;
  readonly offeneFristen: number | null;
  /** Offene Fristen unter `knappTage` Tagen (RAD-06). */
  readonly knapp: number | null;
  /** Offene Fristen auf einer Plattform ohne Freischaltung dieses Bereichs (RAD-09). */
  readonly ohneFreischaltung: number | null;
  readonly profileAktiv: number | null;
  /** Davon Platzhalterprofile — unbestätigte Gewichte (O-98). */
  readonly profilePlatzhalter: number | null;
  readonly inBearbeitung: number | null;
  readonly eingereicht: number | null;
  readonly zuschlag: number | null;
  readonly verworfen: number | null;
  readonly zuschlagswertCent: Cent | null;
}

/** Was ein Bereich zu EINER Bekanntmachung sagt — oder nicht sagt. */
export interface RadarZelle {
  readonly mandantId: string;
  readonly slug: string;
  readonly name: string;
  /** `false` heisst: kein `gruppe.radar.lesen` in diesem Bereich — kein Wert, keine Null. */
  readonly sichtbar: boolean;
  readonly punkte: number | null;
  readonly skalaMax: number | null;
  readonly ausgeschlossen: boolean;
  readonly begruendung: string | null;
  readonly profilName: string | null;
  readonly istPlatzhalterProfil: boolean;
  readonly vorgangStatus: string | null;
  readonly vorgangId: string | null;
  /** Der Freischaltungsstand DIESES Bereichs auf der Plattform der Vergabe (RAD-09). */
  readonly registrierung: string | null;
}

export interface GruppenRadarZeile {
  readonly ausschreibungId: string;
  readonly titel: string;
  readonly vergabestelle: string | null;
  readonly ort: string | null;
  readonly cpvHaupt: string | null;
  readonly fristAngebot: Date | null;
  /** Ganze Tage bis zur Abgabe — aus der DATENBANK gerechnet (Invariante 5). */
  readonly restTage: number | null;
  readonly wertCent: bigint | null;
  readonly waehrung: string | null;
  /** `true` = Fremdwährung, NICHT umgerechnet (O-47). */
  readonly fremdwaehrung: boolean;
  readonly oberhalbSchwellenwert: boolean | null;
  readonly plattformName: string | null;
  readonly plattformHinweis: string | null;
  /** Je Bereich, in der Reihenfolge von `bereiche`. */
  readonly zellen: readonly RadarZelle[];
  /** Die Bereiche mit einer nicht ausgeschlossenen Bewertung — Slugs. */
  readonly imBlick: readonly string[];
  /** Mehr als ein Bereich hat sie im Blick (O-870). */
  readonly mehrfach: boolean;
  /** Die höchste Punktzahl über alle Bereiche — zum Sortieren, nicht als Bewertung. */
  readonly besteQuote: number;
}

export interface GruppenRadarSumme {
  /** Bekanntmachungen, die mindestens ein Bereich im Blick hat. */
  readonly imBlick: number;
  readonly offeneFristen: number;
  readonly knapp: number;
  readonly ohneFreischaltung: number;
  readonly mehrfach: number;
  readonly inBearbeitung: number;
  readonly eingereicht: number;
  readonly zuschlag: number;
  readonly zuschlagswertCent: Cent;
  /** Über wie viele Bereiche diese Summen gehen — der Rest fehlt mangels Recht. */
  readonly bereiche: number;
}

export interface GruppenRadar {
  readonly bereiche: readonly BereichRadar[];
  readonly zeilen: readonly GruppenRadarZeile[];
  readonly summe: GruppenRadarSumme;
  /** Wurden abgelaufene Fristen mitgezeigt? Die Seite beschriftet danach. */
  readonly auchAbgelaufene: boolean;
}

const zahl = (roh: unknown): number => Number(roh ?? 0);

/**
 * Die Kennzahlen je Bereich.
 *
 * **`interval` aus einer Zahl, nicht aus einer Zeichenkette.**
 * `make_interval(days => $n)` nimmt den Wert als Parameter; `'$1 days'`
 * wäre eine Verkettung im SQL-Text und damit genau die Stelle, an der ein
 * Wert aus einer Anfrage in einer Abfrage landet.
 */
const BEREICHE_SQL = `
  select m.id as mandant_id, m.slug, m.name,
         (select count(distinct b.ausschreibung_id) from bewertung b
            join ausschreibung a on a.id = b.ausschreibung_id
           where b.mandant_id = m.id and a.quell_status = 'aktiv')::int as bewertet,
         (select count(distinct b.ausschreibung_id) from bewertung b
            join ausschreibung a on a.id = b.ausschreibung_id
           where b.mandant_id = m.id and a.quell_status = 'aktiv'
             and a.frist_angebot > now())::int as offene_fristen,
         (select count(distinct b.ausschreibung_id) from bewertung b
            join ausschreibung a on a.id = b.ausschreibung_id
           where b.mandant_id = m.id and a.quell_status = 'aktiv'
             and a.frist_angebot > now()
             and a.frist_angebot <= now() + make_interval(days => $1::int))::int as knapp,
         (select count(distinct a.id) from bewertung b
            join ausschreibung a on a.id = b.ausschreibung_id
            join vergabeplattform vp on vp.id = a.vergabeplattform_id
            left join mandant_plattform_registrierung r
                   on r.vergabeplattform_id = vp.id and r.mandant_id = m.id
                  and r.geloescht_am is null
           where b.mandant_id = m.id and a.quell_status = 'aktiv'
             and a.frist_angebot > now()
             and coalesce(r.status::text, 'unbekannt') <> 'registriert')::int
           as ohne_freischaltung,
         (select count(*) from radar_profil p
           where p.mandant_id = m.id and p.ist_aktiv and p.geloescht_am is null)::int
           as profile_aktiv,
         (select count(*) from radar_profil p
           where p.mandant_id = m.id and p.ist_aktiv and p.geloescht_am is null
             and p.ist_platzhalter)::int as profile_platzhalter,
         (select count(*) from ausschreibung_vorgang v
           where v.mandant_id = m.id and v.geloescht_am is null
             and v.status = 'in_bearbeitung')::int as in_bearbeitung,
         (select count(*) from ausschreibung_vorgang v
           where v.mandant_id = m.id and v.geloescht_am is null
             and v.status in ('eingereicht', 'zuschlag', 'nicht_beruecksichtigt'))::int
           as eingereicht,
         (select count(*) from ausschreibung_vorgang v
           where v.mandant_id = m.id and v.geloescht_am is null
             and v.status = 'zuschlag')::int as zuschlag,
         (select count(*) from ausschreibung_vorgang v
           where v.mandant_id = m.id and v.geloescht_am is null
             and v.status = 'verworfen')::int as verworfen,
         (select coalesce(sum(v.zuschlagswert_cent), 0)::text from ausschreibung_vorgang v
           where v.mandant_id = m.id and v.geloescht_am is null
             and v.status = 'zuschlag') as zuschlagswert_cent
    from mandant m
   order by m.sortierung, m.slug`;

/**
 * Der gemeinsame Kopf der Matrix- und der Summenabfrage.
 *
 * **Warum `bezug` eine Vereinigung ist.** Ein Bereich hat eine Vergabe im
 * Blick, sobald er sie BEWERTET hat — oder sobald jemand dort einen Vorgang
 * eröffnet hat. Das zweite geht ohne das erste: `setzeVorgangsstand` legt den
 * Vorgang an, auch wenn die Bewertung aus einer früheren Profilfassung
 * stammt und inzwischen gelöscht wäre. Nur über `bewertung` zu joinen hiesse,
 * genau die Vorgänge zu verlieren, an denen gerade gearbeitet wird.
 *
 * **`distinct on` zweimal, und beide Male aus demselben Grund wie in
 * `radar/daten.ts`:** `bewertung` ist anhängend — je Profilfassung eine
 * Zeile. Ohne den ersten Schnitt stünde dieselbe Vergabe mit Punktzahlen aus
 * verschiedenen Zeitpunkten nebeneinander; ohne den zweiten mit einer Zeile je
 * Profil desselben Bereichs.
 *
 * **Er steht EINMAL da, weil die Zählung und die Liste dieselbe Menge meinen
 * müssen.** Eine Kennzahl „drei unter fünf Tagen" über einer Liste, die vier
 * zeigt, ist schlimmer als keine Kennzahl — und genau das passiert, wenn zwei
 * Abfragen dieselbe Menge zweimal beschreiben und eine davon gepflegt wird.
 */
const BEZUG_CTE = `
  with je_profil as (
    select distinct on (b.mandant_id, b.ausschreibung_id, b.radar_profil_id)
           b.mandant_id, b.ausschreibung_id, b.radar_profil_id, b.punkte, b.skala_max,
           b.ausgeschlossen, b.begruendung
      from bewertung b
     order by b.mandant_id, b.ausschreibung_id, b.radar_profil_id, b.berechnet_am desc
  ),
  je_bereich as (
    select distinct on (k.mandant_id, k.ausschreibung_id)
           k.mandant_id, k.ausschreibung_id, k.radar_profil_id, k.punkte, k.skala_max,
           k.ausgeschlossen, k.begruendung
      from je_profil k
     order by k.mandant_id, k.ausschreibung_id, k.ausgeschlossen, k.punkte desc
  ),
  bezug as (
    select mandant_id, ausschreibung_id from je_bereich
    union
    select v.mandant_id, v.ausschreibung_id from ausschreibung_vorgang v
     where v.geloescht_am is null
  ),
  sichtbar as (
    select z.mandant_id, z.ausschreibung_id
      from bezug z
      join ausschreibung a on a.id = z.ausschreibung_id
     where a.quell_status = 'aktiv'
       and (not $1::boolean or a.frist_angebot is null or a.frist_angebot > now())
       and z.mandant_id = any ($2::uuid[])
  )`;

/**
 * Die Matrix: eine Zeile je Bekanntmachung, eine Rohzeile je (Bekanntmachung,
 * Bereich).
 */
const MATRIX_SQL = `${BEZUG_CTE},
  /*
   * Die Grenze zaehlt BEKANNTMACHUNGEN, nicht Rohzeilen: mit vier Bereichen
   * haette ein LIMIT auf der Verbundmenge sonst eine Zeile in der Mitte
   * halbiert und die letzte Gesellschaft der letzten Vergabe verschluckt.
   */
  ausgewaehlt as (
    select a.id
      from ausschreibung a
     where a.id in (select ausschreibung_id from sichtbar)
     order by (a.frist_angebot is not null and a.frist_angebot <= now()),
              a.frist_angebot asc nulls last, a.titel
     limit $3::integer
  )
  select a.id as ausschreibung_id, a.titel,
         a.vergabestelle_name, a.vergabestelle_ort, a.cpv_haupt,
         a.frist_angebot, a.oberhalb_schwellenwert,
         case when a.frist_angebot is null then null
              else floor(extract(epoch from (a.frist_angebot - now())) / 86400)::int
         end as rest_tage,
         a.wert_geschaetzt_cent::text as wert_cent, a.waehrung,
         vp.name as plattform_name, a.plattform_hinweis,
         m.id as mandant_id, m.slug, m.name as bereich_name,
         j.punkte, j.skala_max, j.ausgeschlossen, j.begruendung,
         p.name as profil_name, p.ist_platzhalter,
         v.id::text as vorgang_id, v.status::text as vorgang_status,
         r.status::text as registrierung
    from sichtbar s
    join ausgewaehlt g on g.id = s.ausschreibung_id
    join ausschreibung a on a.id = s.ausschreibung_id
    join mandant m on m.id = s.mandant_id
    left join je_bereich j
           on j.mandant_id = s.mandant_id and j.ausschreibung_id = s.ausschreibung_id
    left join radar_profil p
           on p.mandant_id = j.mandant_id and p.id = j.radar_profil_id
    left join vergabeplattform vp on vp.id = a.vergabeplattform_id
    left join ausschreibung_vorgang v
           on v.mandant_id = s.mandant_id and v.ausschreibung_id = s.ausschreibung_id
          and v.geloescht_am is null
    left join mandant_plattform_registrierung r
           on r.mandant_id = s.mandant_id and r.vergabeplattform_id = a.vergabeplattform_id
          and r.geloescht_am is null
   order by (a.frist_angebot is not null and a.frist_angebot <= now()),
            a.frist_angebot asc nulls last, a.titel, m.sortierung, m.slug`;

/**
 * Die Kennzahlen über die GANZE Auswahl — ohne die Anzeigegrenze.
 *
 * Eine Zeile „unter fünf Tagen: 3" über einer Liste, die bei 200 abschneidet,
 * müsste sonst „3 der ersten 200" heissen. RAD-06 zählt aber alle: eine
 * verpasste Frist ist verpasst, ob sie auf Seite eins stand oder nicht.
 */
const SUMME_SQL = `${BEZUG_CTE},
  je_vergabe as (
    select s.ausschreibung_id,
           count(*) filter (
             where (j.punkte is not null and not j.ausgeschlossen)
                or (v.status is not null and v.status <> 'verworfen'))::int as im_blick
      from sichtbar s
      left join je_bereich j
             on j.mandant_id = s.mandant_id and j.ausschreibung_id = s.ausschreibung_id
      left join ausschreibung_vorgang v
             on v.mandant_id = s.mandant_id and v.ausschreibung_id = s.ausschreibung_id
            and v.geloescht_am is null
     group by s.ausschreibung_id
  )
  select count(*)::int as gesamt,
         count(*) filter (where g.im_blick > 0)::int as im_blick,
         count(*) filter (where g.im_blick > 1)::int as mehrfach,
         count(*) filter (where a.frist_angebot is not null
                            and a.frist_angebot > now())::int as offene_fristen,
         count(*) filter (where a.frist_angebot is not null and a.frist_angebot > now()
                            and a.frist_angebot <= now()
                                + make_interval(days => $3::int))::int as knapp
    from je_vergabe g
    join ausschreibung a on a.id = g.ausschreibung_id`;

interface SummeRoh {
  readonly gesamt: number;
  readonly im_blick: number;
  readonly mehrfach: number;
  readonly offene_fristen: number;
  readonly knapp: number;
}

interface MatrixRoh {
  readonly ausschreibung_id: string;
  readonly titel: string;
  readonly vergabestelle_name: string | null;
  readonly vergabestelle_ort: string | null;
  readonly cpv_haupt: string | null;
  readonly frist_angebot: Date | null;
  readonly oberhalb_schwellenwert: boolean | null;
  readonly rest_tage: number | null;
  readonly wert_cent: string | null;
  readonly waehrung: string | null;
  readonly plattform_name: string | null;
  readonly plattform_hinweis: string | null;
  readonly mandant_id: string;
  readonly slug: string;
  readonly bereich_name: string;
  readonly punkte: number | null;
  readonly skala_max: number | null;
  readonly ausgeschlossen: boolean | null;
  readonly begruendung: string | null;
  readonly profil_name: string | null;
  readonly ist_platzhalter: boolean | null;
  readonly vorgang_id: string | null;
  readonly vorgang_status: string | null;
  readonly registrierung: string | null;
}

interface BereichRoh {
  readonly mandant_id: string;
  readonly slug: string;
  readonly name: string;
  readonly bewertet: number;
  readonly offene_fristen: number;
  readonly knapp: number;
  readonly ohne_freischaltung: number;
  readonly profile_aktiv: number;
  readonly profile_platzhalter: number;
  readonly in_bearbeitung: number;
  readonly eingereicht: number;
  readonly zuschlag: number;
  readonly verworfen: number;
  readonly zuschlagswert_cent: string;
}

export async function gruppenRadar(
  kontext: LeseKontext, optionen: RadarOptionen,
): Promise<GruppenRadar> {
  const rechte = await rechteJeBereich(kontext, [RADAR_RECHT]);
  const darf = (mandantId: string): boolean =>
    rechte.get(mandantId)?.has(RADAR_RECHT) === true;

  const roh = await kontext.abfrage<BereichRoh>(BEREICHE_SQL, [optionen.knappTage]);
  const bereiche: readonly BereichRadar[] = roh.map((b) => {
    const ok = darf(b.mandant_id);
    return {
      mandantId: b.mandant_id,
      slug: b.slug,
      name: b.name,
      bewertet: ok ? zahl(b.bewertet) : null,
      offeneFristen: ok ? zahl(b.offene_fristen) : null,
      knapp: ok ? zahl(b.knapp) : null,
      ohneFreischaltung: ok ? zahl(b.ohne_freischaltung) : null,
      profileAktiv: ok ? zahl(b.profile_aktiv) : null,
      profilePlatzhalter: ok ? zahl(b.profile_platzhalter) : null,
      inBearbeitung: ok ? zahl(b.in_bearbeitung) : null,
      eingereicht: ok ? zahl(b.eingereicht) : null,
      zuschlag: ok ? zahl(b.zuschlag) : null,
      verworfen: ok ? zahl(b.verworfen) : null,
      zuschlagswertCent: ok ? cent(BigInt(b.zuschlagswert_cent ?? '0')) : null,
    };
  });

  const gewaehlt = optionen.mandantIds ?? kontext.mandantIds;
  const zeilenRoh = await kontext.abfrage<MatrixRoh>(MATRIX_SQL, [
    optionen.auchAbgelaufene !== true,
    [...gewaehlt],
    optionen.grenze ?? 200,
  ]);

  /*
   * Gefaltet wird in DIESER Reihenfolge: die Abfrage liefert je Vergabe die
   * Bereichszeilen hintereinander, und `Map` haelt die Einfuegereihenfolge —
   * die Sortierung der Abfrage bleibt damit erhalten, ohne ein zweites Mal
   * sortiert zu werden.
   */
  const gefaltet = new Map<string, { kopf: MatrixRoh; zellen: Map<string, MatrixRoh> }>();
  for (const z of zeilenRoh) {
    const vorhanden = gefaltet.get(z.ausschreibung_id);
    if (vorhanden === undefined) {
      gefaltet.set(z.ausschreibung_id, { kopf: z, zellen: new Map([[z.mandant_id, z]]) });
    } else {
      vorhanden.zellen.set(z.mandant_id, z);
    }
  }

  const gezeigteBereiche = bereiche.filter((b) => gewaehlt.includes(b.mandantId));

  const zeilen: readonly GruppenRadarZeile[] = [...gefaltet.values()].map(({ kopf, zellen }) => {
    const zellenListe: readonly RadarZelle[] = gezeigteBereiche.map((b) => {
      const z = zellen.get(b.mandantId);
      const sichtbar = darf(b.mandantId);
      if (z === undefined || !sichtbar) {
        return {
          mandantId: b.mandantId, slug: b.slug, name: b.name, sichtbar,
          punkte: null, skalaMax: null, ausgeschlossen: false, begruendung: null,
          profilName: null, istPlatzhalterProfil: false,
          vorgangStatus: null, vorgangId: null, registrierung: null,
        };
      }
      return {
        mandantId: b.mandantId,
        slug: b.slug,
        name: b.name,
        sichtbar: true,
        punkte: z.punkte === null ? null : Number(z.punkte),
        skalaMax: z.skala_max === null ? null : Number(z.skala_max),
        ausgeschlossen: z.ausgeschlossen === true,
        begruendung: z.begruendung,
        profilName: z.profil_name,
        istPlatzhalterProfil: z.ist_platzhalter === true,
        vorgangStatus: z.vorgang_status,
        vorgangId: z.vorgang_id,
        registrierung: z.registrierung,
      };
    });

    /*
     * „Im Blick" heisst: bewertet und NICHT ausgeschlossen, oder ein Vorgang,
     * der nicht verworfen ist. Ein Ausschluss ist eine Absage des Profils, und
     * ein verworfener Vorgang eine Absage eines Menschen — beides ist das
     * Gegenteil von „im Blick".
     */
    const imBlick = zellenListe
      .filter((z) => z.sichtbar
        && ((z.punkte !== null && !z.ausgeschlossen)
            || (z.vorgangStatus !== null && z.vorgangStatus !== 'verworfen')))
      .map((z) => z.slug);

    /*
     * Die hoechste ANTEILIGE Punktzahl, nicht die hoechste rohe: zwei
     * Bereiche koennen verschiedene Skalen fuehren (`skala_max` steht je
     * Profil), und 7 von 10 ist mehr als 8 von 20. Sie sortiert nur — sie
     * steht auf keiner Oberflaeche und ist keine Bewertung (RAD-05).
     */
    const besteQuote = zellenListe.reduce((hoechste, z) => {
      if (z.punkte === null || z.skalaMax === null || z.skalaMax === 0 || z.ausgeschlossen) {
        return hoechste;
      }
      const quote = z.punkte / z.skalaMax;
      return quote > hoechste ? quote : hoechste;
    }, 0);

    return {
      ausschreibungId: kopf.ausschreibung_id,
      titel: kopf.titel,
      vergabestelle: kopf.vergabestelle_name,
      ort: kopf.vergabestelle_ort,
      cpvHaupt: kopf.cpv_haupt,
      fristAngebot: kopf.frist_angebot,
      restTage: kopf.rest_tage,
      wertCent: kopf.wert_cent === null ? null : BigInt(kopf.wert_cent),
      waehrung: kopf.waehrung,
      // O-47: eine Fremdwaehrung wird NICHT umgerechnet — es gibt keinen
      // hinterlegten Kurs, und einen zu erfinden waere eine Zahl ohne Deckung.
      fremdwaehrung: kopf.waehrung !== null && kopf.waehrung !== 'EUR',
      oberhalbSchwellenwert: kopf.oberhalb_schwellenwert,
      plattformName: kopf.plattform_name,
      plattformHinweis: kopf.plattform_hinweis,
      zellen: zellenListe,
      imBlick,
      mehrfach: imBlick.length > 1,
      besteQuote,
    };
  });

  /*
   * **Summiert wird ueber die GEWAEHLTEN Bereiche mit Recht.** Ein Bereich
   * ohne `gruppe.radar.lesen` traegt nichts bei — und die Zahl daneben sagt,
   * ueber wie viele Gesellschaften die Summe geht. Ohne diese Angabe sieht
   * eine Summe ueber zwei von vier Bereichen aus wie eine ueber alle vier.
   */
  const mitRecht = gezeigteBereiche.filter((b) => b.bewertet !== null);
  const summiere = (nimm: (b: BereichRadar) => number | null): number =>
    mitRecht.reduce((s, b) => s + (nimm(b) ?? 0), 0);

  const [summeRoh] = await kontext.abfrage<SummeRoh>(SUMME_SQL, [
    optionen.auchAbgelaufene !== true,
    [...gewaehlt],
    optionen.knappTage,
  ]);

  return {
    bereiche,
    zeilen,
    auchAbgelaufene: optionen.auchAbgelaufene === true,
    summe: {
      /*
       * `imBlick` und `mehrfach` zaehlen BEKANNTMACHUNGEN, nicht
       * Bereichszeilen: dieselbe Vergabe in zwei Gesellschaften ist EINE
       * Vergabe, und eine Summe ueber die Bereiche zaehlte sie zweimal.
       */
      imBlick: zahl(summeRoh?.im_blick),
      offeneFristen: zahl(summeRoh?.offene_fristen),
      knapp: zahl(summeRoh?.knapp),
      mehrfach: zahl(summeRoh?.mehrfach),
      ohneFreischaltung: summiere((b) => b.ohneFreischaltung),
      inBearbeitung: summiere((b) => b.inBearbeitung),
      eingereicht: summiere((b) => b.eingereicht),
      zuschlag: summiere((b) => b.zuschlag),
      zuschlagswertCent: mitRecht.reduce(
        (s, b) => cent(s + (b.zuschlagswertCent ?? NULL_CENT)), NULL_CENT),
      bereiche: mitRecht.length,
    },
  };
}
