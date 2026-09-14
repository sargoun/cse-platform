import 'server-only';
import type { LeseKontext } from '@/server/kontext/index';

/**
 * Was die Vergabemappe zeigt (RAD-07, D-07).
 *
 * **Die Zähler kommen aus der Tabelle, nicht aus einem `count` hier.** Sie
 * werden von `trg_mappe_zaehler` geführt; sie hier ein zweites Mal zu rechnen
 * hiesse, zwei Wahrheiten zu haben, die irgendwann auseinanderlaufen — und
 * die falsche steht dann auf der Seite, auf die sich jemand verlässt.
 */

export interface Mappenposition {
  readonly id: string;
  readonly position: number;
  readonly bezeichnung: string;
  readonly kategorie: string | null;
  readonly pflicht: boolean;
  readonly status: string;
  readonly hatDokument: boolean;
  readonly hinweis: string | null;
  readonly quelleDokument: string | null;
  readonly quelleSeite: number | null;
  readonly geprueftVon: string | null;
  readonly geprueftAm: Date | null;
}

export interface QuellDokument {
  readonly id: string;
  readonly bezeichnung: string;
  readonly url: string | null;
  readonly gesperrt: boolean;
}

export interface MappenBlick {
  readonly mappeId: string;
  readonly vorgangId: string;
  readonly ausschreibungId: string;
  readonly titel: string;
  readonly vergabestelle: string | null;
  readonly fristAngebot: Date | null;
  readonly restTage: number | null;
  readonly vorgangStatus: string;
  readonly entschiedenAm: string | null;
  readonly zuschlagswertCent: bigint | null;
  readonly status: string;
  readonly pflichtGesamt: number;
  readonly pflichtErledigt: number;
  readonly lueckenHinweis: string | null;
  readonly freigegebenVon: string | null;
  readonly freigegebenAm: Date | null;
  readonly eingereichtVon: string | null;
  readonly eingereichtAm: Date | null;
  readonly eingereichtUeber: string | null;
  readonly kennzeichen: string | null;
  readonly plattformName: string | null;
  readonly registrierung: string | null;
  readonly positionen: readonly Mappenposition[];
  /** Die mit der Bekanntmachung veröffentlichten Unterlagen — als Herkunft. */
  readonly quellDokumente: readonly QuellDokument[];
}

const BLICK_SQL = `
  select m.id as mappe_id, v.id as vorgang_id, a.id as ausschreibung_id,
         a.titel, a.vergabestelle_name, a.frist_angebot,
         case when a.frist_angebot is null then null
              else floor(extract(epoch from (a.frist_angebot - now())) / 86400)::int end as rest_tage,
         v.status::text as vorgang_status, v.entschieden_am::text as entschieden_am,
         v.zuschlagswert_cent::text as zuschlagswert,
         m.status::text as status,
         m.pflichtpositionen_gesamt, m.pflichtpositionen_erledigt, m.luecken_hinweis,
         fb.name as freigegeben_von, m.freigegeben_am,
         eb.name as eingereicht_von, m.eingereicht_am,
         coalesce(ep.name, m.eingereicht_ueber_text) as eingereicht_ueber,
         m.einreichung_kennzeichen,
         vp.name as plattform_name,
         case when vp.id is null then null
              else coalesce(mpr.status::text, 'unbekannt') end as registrierung
    from vergabemappe m
    join ausschreibung_vorgang v on v.id = m.ausschreibung_vorgang_id and v.mandant_id = m.mandant_id
    join ausschreibung a on a.id = v.ausschreibung_id
    left join benutzer fb on fb.id = m.freigegeben_von
    left join benutzer eb on eb.id = m.eingereicht_von
    left join vergabeplattform ep on ep.id = m.eingereicht_ueber_plattform_id
    left join vergabeplattform vp on vp.id = a.vergabeplattform_id
    left join mandant_plattform_registrierung mpr
           on mpr.vergabeplattform_id = vp.id and mpr.geloescht_am is null
   where m.geloescht_am is null and a.id = $1::uuid`;

export async function leseMappe(
  kontext: LeseKontext, ausschreibungId: string,
): Promise<MappenBlick | null> {
  const [z] = await kontext.abfrage<Record<string, unknown>>(BLICK_SQL, [ausschreibungId]);
  if (z === undefined) return null;
  const mappeId = String(z['mappe_id']);

  const positionen = await kontext.abfrage<Record<string, unknown>>(
    `select p.id, p.position, p.bezeichnung, p.kategorie, p.pflicht, p.status::text as status,
            (p.dokument_id is not null) as hat_dokument, p.luecke_hinweis,
            d.bezeichnung as quelle_dokument, p.quelle_seite,
            b.name as geprueft_von, p.geprueft_am
       from vergabemappe_position p
       left join ausschreibung_dokument d on d.id = p.quelle_ausschreibung_dokument_id
       left join benutzer b on b.id = p.geprueft_von
      where p.vergabemappe_id = $1::uuid
      order by p.position`, [mappeId]);

  const quellDokumente = await kontext.abfrage<Record<string, unknown>>(
    `select d.id, d.bezeichnung, d.quell_url, d.zugriff_gesperrt
       from ausschreibung_dokument d
      where d.ausschreibung_id = $1::uuid
      order by d.bezeichnung`, [ausschreibungId]);

  return {
    mappeId,
    vorgangId: String(z['vorgang_id']),
    ausschreibungId: String(z['ausschreibung_id']),
    titel: String(z['titel']),
    vergabestelle: (z['vergabestelle_name'] as string | null) ?? null,
    fristAngebot: (z['frist_angebot'] as Date | null) ?? null,
    restTage: z['rest_tage'] === null ? null : Number(z['rest_tage']),
    vorgangStatus: String(z['vorgang_status']),
    entschiedenAm: (z['entschieden_am'] as string | null) ?? null,
    zuschlagswertCent: typeof z['zuschlagswert'] === 'string' ? BigInt(z['zuschlagswert']) : null,
    status: String(z['status']),
    pflichtGesamt: Number(z['pflichtpositionen_gesamt']),
    pflichtErledigt: Number(z['pflichtpositionen_erledigt']),
    lueckenHinweis: (z['luecken_hinweis'] as string | null) ?? null,
    freigegebenVon: (z['freigegeben_von'] as string | null) ?? null,
    freigegebenAm: (z['freigegeben_am'] as Date | null) ?? null,
    eingereichtVon: (z['eingereicht_von'] as string | null) ?? null,
    eingereichtAm: (z['eingereicht_am'] as Date | null) ?? null,
    eingereichtUeber: (z['eingereicht_ueber'] as string | null) ?? null,
    kennzeichen: (z['einreichung_kennzeichen'] as string | null) ?? null,
    plattformName: (z['plattform_name'] as string | null) ?? null,
    registrierung: (z['registrierung'] as string | null) ?? null,
    positionen: positionen.map((p) => ({
      id: String(p['id']),
      position: Number(p['position']),
      bezeichnung: String(p['bezeichnung']),
      kategorie: (p['kategorie'] as string | null) ?? null,
      pflicht: p['pflicht'] === true,
      status: String(p['status']),
      hatDokument: p['hat_dokument'] === true,
      hinweis: (p['luecke_hinweis'] as string | null) ?? null,
      quelleDokument: (p['quelle_dokument'] as string | null) ?? null,
      quelleSeite: p['quelle_seite'] === null ? null : Number(p['quelle_seite']),
      geprueftVon: (p['geprueft_von'] as string | null) ?? null,
      geprueftAm: (p['geprueft_am'] as Date | null) ?? null,
    })),
    quellDokumente: quellDokumente.map((d) => ({
      id: String(d['id']),
      bezeichnung: String(d['bezeichnung']),
      url: (d['quell_url'] as string | null) ?? null,
      gesperrt: d['zugriff_gesperrt'] === true,
    })),
  };
}

/** Der Plattformkatalog für das Einreichungsformular — leer, solange O-07 offen ist. */
export async function lesePlattformwahl(
  kontext: LeseKontext,
): Promise<readonly { readonly id: string; readonly name: string }[]> {
  const zeilen = await kontext.abfrage<{ id: string; name: string }>(
    `select id, name from vergabeplattform where archiviert_am is null order by name`);
  return zeilen.map((z) => ({ id: z.id, name: z.name }));
}
