import 'server-only';
import type { LeseKontext } from '@/server/kontext/index';

/**
 * Was die Radarseiten lesen (RAD-05 … RAD-09).
 *
 * **Die Liste zeigt die JÜNGSTE Bewertung je Bekanntmachung und Profil.**
 * `bewertung` ist anhängend: zu einer Bekanntmachung liegen mehrere Zeilen
 * vor, eine je Profilfassung. Ohne `distinct on` stünde dieselbe Vergabe
 * mehrfach da, mit Punktzahlen aus verschiedenen Zeitpunkten nebeneinander —
 * und niemand wüsste, welche gilt.
 *
 * **Die Plattformprüfung (RAD-09) steht in der LISTE, nicht nur im Detail.**
 * Eine Bekanntmachung auf einer Plattform, auf der diese Gesellschaft nicht
 * registriert ist, ist am Abgabetag verloren: die Freischaltung dauert Tage
 * bis Wochen. Wer das erst beim Öffnen sieht, sieht es zu spät.
 */

export interface RadarZeile {
  readonly bewertungId: string;
  readonly ausschreibungId: string;
  readonly titel: string;
  readonly vergabestelle: string | null;
  readonly ort: string | null;
  readonly cpvHaupt: string | null;
  readonly quelle: string;
  readonly quellStatus: string;
  readonly wertCent: bigint | null;
  readonly waehrung: string | null;
  readonly fristAngebot: Date | null;
  /** Ganze Tage bis zur Abgabe, aus der DATENBANK gerechnet (Invariante 5). */
  readonly restTage: number | null;
  readonly punkte: number;
  readonly skalaMax: number;
  readonly ausgeschlossen: boolean;
  readonly wertKriterium: string;
  readonly begruendung: string;
  readonly profilName: string;
  readonly profilId: string;
  readonly istPlatzhalterProfil: boolean;
  readonly plattformName: string | null;
  readonly plattformHinweis: string | null;
  /** `null` = keine Plattform zugeordnet; sonst der Registrierungsstand dieser Gesellschaft. */
  readonly registrierung: string | null;
  readonly vorgangStatus: string | null;
}

const ZEILEN_SQL = `
  with aktuell as (
    select distinct on (b.ausschreibung_id, b.radar_profil_id)
           b.id, b.ausschreibung_id, b.radar_profil_id, b.punkte, b.skala_max,
           b.ausgeschlossen, b.wert_kriterium, b.begruendung, b.berechnet_am
      from bewertung b
     order by b.ausschreibung_id, b.radar_profil_id, b.berechnet_am desc
  )
  select k.id as bewertung_id, a.id as ausschreibung_id, a.titel,
         a.vergabestelle_name, a.vergabestelle_ort, a.cpv_haupt,
         a.quelle::text as quelle, a.quell_status::text as quell_status,
         a.wert_geschaetzt_cent::text as wert_cent, a.waehrung, a.frist_angebot,
         case when a.frist_angebot is null then null
              else floor(extract(epoch from (a.frist_angebot - now())) / 86400)::int end as rest_tage,
         k.punkte, k.skala_max, k.ausgeschlossen, k.wert_kriterium::text as wert_kriterium,
         k.begruendung, p.name as profil_name, p.id as profil_id, p.ist_platzhalter,
         vp.name as plattform_name, a.plattform_hinweis,
         mpr.status::text as registrierung,
         v.status::text as vorgang_status
    from aktuell k
    join ausschreibung a on a.id = k.ausschreibung_id
    join radar_profil p on p.id = k.radar_profil_id
    left join vergabeplattform vp on vp.id = a.vergabeplattform_id
    left join mandant_plattform_registrierung mpr
           on mpr.vergabeplattform_id = a.vergabeplattform_id and mpr.geloescht_am is null
    left join ausschreibung_vorgang v
           on v.ausschreibung_id = a.id and v.geloescht_am is null`;

function alsZeile(z: Record<string, unknown>): RadarZeile {
  const wert = z['wert_cent'];
  return {
    bewertungId: String(z['bewertung_id']),
    ausschreibungId: String(z['ausschreibung_id']),
    titel: String(z['titel']),
    vergabestelle: (z['vergabestelle_name'] as string | null) ?? null,
    ort: (z['vergabestelle_ort'] as string | null) ?? null,
    cpvHaupt: (z['cpv_haupt'] as string | null) ?? null,
    quelle: String(z['quelle']),
    quellStatus: String(z['quell_status']),
    wertCent: typeof wert === 'string' ? BigInt(wert) : null,
    waehrung: (z['waehrung'] as string | null) ?? null,
    fristAngebot: (z['frist_angebot'] as Date | null) ?? null,
    restTage: (z['rest_tage'] as number | null) ?? null,
    punkte: Number(z['punkte']),
    skalaMax: Number(z['skala_max']),
    ausgeschlossen: z['ausgeschlossen'] === true,
    wertKriterium: String(z['wert_kriterium']),
    begruendung: String(z['begruendung']),
    profilName: String(z['profil_name']),
    profilId: String(z['profil_id']),
    istPlatzhalterProfil: z['ist_platzhalter'] === true,
    plattformName: (z['plattform_name'] as string | null) ?? null,
    plattformHinweis: (z['plattform_hinweis'] as string | null) ?? null,
    registrierung: (z['registrierung'] as string | null) ?? null,
    vorgangStatus: (z['vorgang_status'] as string | null) ?? null,
  };
}

/**
 * Die Liste. Sortiert nach Punkten, aber **abgelaufene Fristen nach unten**:
 * eine Bekanntmachung, deren Abgabe vorbei ist, kann noch so gut passen.
 */
export async function leseRadarListe(
  kontext: LeseKontext, optionen: { nurOffene?: boolean; grenze?: number } = {},
): Promise<readonly RadarZeile[]> {
  const zeilen = await kontext.abfrage<Record<string, unknown>>(
    `${ZEILEN_SQL}
     where a.quell_status = 'aktiv'
       and (not $1::boolean or a.frist_angebot is null or a.frist_angebot > now())
     order by (a.frist_angebot is not null and a.frist_angebot <= now()),
              k.ausgeschlossen, k.punkte desc, a.frist_angebot asc nulls last
     limit $2::integer`,
    [optionen.nurOffene ?? false, optionen.grenze ?? 200]);
  return zeilen.map(alsZeile);
}

export async function leseRadarZeile(
  kontext: LeseKontext, ausschreibungId: string,
): Promise<readonly RadarZeile[]> {
  const zeilen = await kontext.abfrage<Record<string, unknown>>(
    `${ZEILEN_SQL} where a.id = $1::uuid order by k.punkte desc`, [ausschreibungId]);
  return zeilen.map(alsZeile);
}

export interface RadarKennzahlen {
  readonly bekanntmachungen: number;
  readonly offeneFristen: number;
  readonly unter5Tage: number;
  readonly ohneRegistrierung: number;
  readonly profile: number;
  readonly letzterLauf: { readonly quelle: string; readonly status: string; readonly am: Date | null } | null;
}

export async function leseRadarKennzahlen(kontext: LeseKontext): Promise<RadarKennzahlen> {
  const [z] = await kontext.abfrage<Record<string, unknown>>(
    `select
       (select count(*) from ausschreibung where quell_status = 'aktiv')::int as bekanntmachungen,
       (select count(*) from ausschreibung
         where quell_status = 'aktiv' and frist_angebot > now())::int as offene,
       (select count(*) from ausschreibung
         where quell_status = 'aktiv' and frist_angebot > now()
           and frist_angebot <= now() + interval '5 days')::int as knapp,
       (select count(*) from ausschreibung a
          join vergabeplattform vp on vp.id = a.vergabeplattform_id
          left join mandant_plattform_registrierung m
                 on m.vergabeplattform_id = vp.id and m.geloescht_am is null
         where a.quell_status = 'aktiv' and a.frist_angebot > now()
           and coalesce(m.status::text, 'unbekannt') <> 'registriert')::int as ohne_registrierung,
       (select count(*) from radar_profil where ist_aktiv and geloescht_am is null)::int as profile`);
  const [lauf] = await kontext.abfrage<{ quelle: string; status: string; am: Date | null }>(
    `select quelle::text as quelle, status::text as status, coalesce(beendet_am, gestartet_am) as am
       from radar_ingest_lauf order by gestartet_am desc limit 1`);
  return {
    bekanntmachungen: Number(z?.['bekanntmachungen'] ?? 0),
    offeneFristen: Number(z?.['offene'] ?? 0),
    unter5Tage: Number(z?.['knapp'] ?? 0),
    ohneRegistrierung: Number(z?.['ohne_registrierung'] ?? 0),
    profile: Number(z?.['profile'] ?? 0),
    letzterLauf: lauf === undefined ? null : { quelle: lauf.quelle, status: lauf.status, am: lauf.am },
  };
}

export interface ProfilZeile {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly istAktiv: boolean;
  readonly istPlatzhalter: boolean;
  readonly nutsPraefixe: readonly string[];
  readonly positivKeywords: readonly string[];
  readonly negativKeywords: readonly string[];
  readonly negativWirkung: string;
  readonly wertMinCent: bigint | null;
  readonly wertMaxCent: bigint | null;
  readonly skalaMax: number;
  readonly schwelle: number | null;
  readonly cpv: readonly { readonly code: string; readonly laenge: number; readonly wirkung: string }[];
  readonly bewertungen: number;
  /** Wer benachrichtigt wird — und ab welcher Punktzahl WIRKLICH (RAD-08). */
  readonly empfaenger: readonly {
    readonly name: string; readonly abPunkte: number | null;
  }[];
}

export async function leseProfile(kontext: LeseKontext): Promise<readonly ProfilZeile[]> {
  const zeilen = await kontext.abfrage<Record<string, unknown>>(
    `select p.id, p.name, p.version, p.ist_aktiv, p.ist_platzhalter, p.nuts_praefixe,
            p.positiv_keywords, p.negativ_keywords, p.negativ_wirkung::text as negativ_wirkung,
            p.wert_min_cent::text as wert_min, p.wert_max_cent::text as wert_max,
            p.skala_max, p.benachrichtigung_ab_punkte,
            coalesce(json_agg(json_build_object('code', c.cpv_code, 'laenge', c.praefix_laenge,
                                                'wirkung', c.wirkung)
                              order by c.cpv_code) filter (where c.id is not null), '[]') as cpv,
            (select count(*) from bewertung b where b.radar_profil_id = p.id)::int as bewertungen,
            coalesce((select json_agg(json_build_object(
                        'name', u.name,
                        /* Die WIRKSAME Schwelle: die des Empfaengers, sonst die des Profils. */
                        'abPunkte', coalesce(e.ab_punkte, p.benachrichtigung_ab_punkte))
                      order by u.name)
                        from radar_profil_empfaenger e
                        join benutzer u on u.id = e.benutzer_id
                       where e.radar_profil_id = p.id), '[]') as empfaenger
       from radar_profil p
       left join radar_profil_cpv c on c.radar_profil_id = p.id
      where p.geloescht_am is null
      group by p.id
      order by p.ist_aktiv desc, p.name`);
  return zeilen.map((z) => ({
    id: String(z['id']),
    name: String(z['name']),
    version: Number(z['version']),
    istAktiv: z['ist_aktiv'] === true,
    istPlatzhalter: z['ist_platzhalter'] === true,
    nutsPraefixe: (z['nuts_praefixe'] as string[] | null) ?? [],
    positivKeywords: (z['positiv_keywords'] as string[] | null) ?? [],
    negativKeywords: (z['negativ_keywords'] as string[] | null) ?? [],
    negativWirkung: String(z['negativ_wirkung']),
    wertMinCent: typeof z['wert_min'] === 'string' ? BigInt(z['wert_min']) : null,
    wertMaxCent: typeof z['wert_max'] === 'string' ? BigInt(z['wert_max']) : null,
    skalaMax: Number(z['skala_max']),
    schwelle: z['benachrichtigung_ab_punkte'] === null ? null : Number(z['benachrichtigung_ab_punkte']),
    cpv: (z['cpv'] as { code: string; laenge: number; wirkung: string }[] | null ?? []).map((c) => ({
      code: c.code, laenge: c.laenge, wirkung: c.wirkung,
    })),
    bewertungen: Number(z['bewertungen']),
    empfaenger: (z['empfaenger'] as { name: string; abPunkte: number | null }[] | null ?? [])
      .map((e) => ({ name: e.name, abPunkte: e.abPunkte })),
  }));
}

export interface PlattformZeile {
  readonly id: string;
  readonly name: string;
  readonly betreiber: string | null;
  readonly istPlatzhalter: boolean;
  readonly registrierung: string;
  readonly registriertAm: string | null;
  readonly gueltigBis: string | null;
  readonly benutzerkennung: string | null;
  readonly hinweis: string | null;
  readonly offeneBekanntmachungen: number;
}

export async function lesePlattformen(kontext: LeseKontext): Promise<readonly PlattformZeile[]> {
  const zeilen = await kontext.abfrage<Record<string, unknown>>(
    `select vp.id, vp.name, vp.betreiber, vp.ist_platzhalter,
            vp.registrierung_dauer_hinweis,
            coalesce(m.status::text, 'unbekannt') as registrierung,
            m.registriert_am::text as registriert_am, m.gueltig_bis::text as gueltig_bis,
            m.benutzerkennung,
            (select count(*) from ausschreibung a
              where a.vergabeplattform_id = vp.id and a.quell_status = 'aktiv'
                and a.frist_angebot > now())::int as offene
       from vergabeplattform vp
       left join mandant_plattform_registrierung m
              on m.vergabeplattform_id = vp.id and m.geloescht_am is null
      where vp.archiviert_am is null
      order by vp.name`);
  return zeilen.map((z) => ({
    id: String(z['id']),
    name: String(z['name']),
    betreiber: (z['betreiber'] as string | null) ?? null,
    istPlatzhalter: z['ist_platzhalter'] === true,
    registrierung: String(z['registrierung']),
    registriertAm: (z['registriert_am'] as string | null) ?? null,
    gueltigBis: (z['gueltig_bis'] as string | null) ?? null,
    benutzerkennung: (z['benutzerkennung'] as string | null) ?? null,
    hinweis: (z['registrierung_dauer_hinweis'] as string | null) ?? null,
    offeneBekanntmachungen: Number(z['offene']),
  }));
}
