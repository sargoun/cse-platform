import 'server-only';
import { erzeuge, type ErzeugteBenachrichtigung } from '../../benachrichtigung/registry.js';
import { ART_FRIST, ART_TREFFER, FRIST_WARNUNG_TAGE } from './benachrichtigung.js';
import type { SchreibAbfrage } from './import.js';

/**
 * Die zwei Radarwächter (SPEC §14 Zeile 1, RAD-08).
 *
 * **Der Fristenwächter braucht keine Schwelle, die jemand setzen müsste.**
 * SPEC §14 nennt ihn wörtlich: „Tender deadline < 5 days, untouched → notify
 * owner", und dieselben fünf Tage stehen in RAD-06. Er läuft also, solange
 * es Bekanntmachungen und Vorgänge gibt — kein Platzhalter, keine offene
 * Frage.
 *
 * **Die Trefferbenachrichtigung dagegen hat KEINE Vorgabe** (RAD-08, O-15).
 * Ab welcher Punktzahl eine Vergabe eine Meldung wert ist, weiss nur der
 * Betrieb; eine geratene Schwelle wäre entweder Lärm oder Stille, und beides
 * fiele erst auf, wenn eine Ausschreibung verpasst ist. Deshalb steht die
 * Schwelle je Empfänger in `radar_profil_empfaenger.ab_punkte`, sie hat
 * **keinen Vorgabewert**, und ohne sie wird nicht gemeldet — sichtbar, nicht
 * stillschweigend: die Profilseite sagt es.
 *
 * **„Unberührt" heisst `neu` oder `geprueft` — oder gar kein Vorgang.** Wer
 * in Bearbeitung ist, weiss Bescheid; wer verworfen hat, hat entschieden;
 * wer eingereicht hat, ist fertig. Gemeldet wird also genau der Fall, in dem
 * niemand etwas getan hat und die Zeit abläuft.
 */

export interface WarnLage {
  readonly mandantId: string;
  readonly mandantSlug: string;
  readonly empfaengerId: string;
  readonly ausschreibungId: string;
  readonly titel: string;
  readonly fristAngebot: Date | null;
  readonly restTage: number | null;
  readonly stand: string;
}

export interface TrefferLage extends WarnLage {
  readonly punkte: number;
  readonly skalaMax: number;
  readonly abPunkte: number;
  readonly profilName: string;
  readonly begruendung: string;
}

export interface WarnBericht {
  readonly geprueft: number;
  readonly gemeldet: number;
  readonly unzustellbar: number;
}

/**
 * Wer bekommt die Fristwarnung?
 *
 * **Der Verantwortliche, und wenn keiner eingetragen ist, die Empfänger des
 * Profils.** Eine Warnung ohne Adressaten wäre eine Warnung an niemanden;
 * eine Warnung an alle wäre die Sorte Lärm, nach der Leute Regeln im
 * Postfach anlegen. Deshalb erst der Zuständige, ersatzweise die, die sich
 * für dieses Suchprofil eingetragen haben.
 *
 * Die Empfänger des Profils brauchen hier **keine** Punktschwelle: die
 * Schwelle gehört zur Trefferbenachrichtigung (O-15), nicht zur Frist. Wer
 * ein Profil abonniert hat, will wissen, wenn eine Vergabe daraus wegläuft.
 */
const FRIST_SQL = `
  with lage as (
    select v.mandant_id, m.slug as mandant_slug, a.id as ausschreibung_id, a.titel,
           a.frist_angebot, v.status::text as stand, v.radar_profil_id,
           v.verantwortlich_benutzer_id,
           floor(extract(epoch from (a.frist_angebot - now())) / 86400)::int as rest_tage
      from ausschreibung_vorgang v
      join ausschreibung a on a.id = v.ausschreibung_id
      join mandant m on m.id = v.mandant_id
     where v.geloescht_am is null
       and v.status in ('neu', 'geprueft')
       and a.quell_status = 'aktiv'
       and a.frist_angebot is not null
       and a.frist_angebot > now()
       and a.frist_angebot < now() + ($1 || ' days')::interval
  )
  select l.mandant_id, l.mandant_slug, l.ausschreibung_id, l.titel, l.frist_angebot,
         l.rest_tage, l.stand,
         coalesce(l.verantwortlich_benutzer_id, e.benutzer_id) as empfaenger_id
    from lage l
    left join radar_profil_empfaenger e
           on l.verantwortlich_benutzer_id is null
          and e.radar_profil_id = l.radar_profil_id
          and e.mandant_id = l.mandant_id
   where coalesce(l.verantwortlich_benutzer_id, e.benutzer_id) is not null
     and not exists (
       select 1 from radar_warnung w
        where w.ausschreibung_id = l.ausschreibung_id
          and w.empfaenger_id = coalesce(l.verantwortlich_benutzer_id, e.benutzer_id)
          and w.art = 'frist_knapp'
          and coalesce(w.frist_angebot, 'epoch'::timestamptz)
              = coalesce(l.frist_angebot, 'epoch'::timestamptz))
   order by l.frist_angebot, l.ausschreibung_id`;

/**
 * Wer bekommt die Trefferbenachrichtigung?
 *
 * **Nur, wo eine Schwelle GESETZT ist** — und die Schwelle steht an zwei
 * Stellen, mit Absicht: `radar_profil.benachrichtigung_ab_punkte` ist die
 * Regel des Profils, `radar_profil_empfaenger.ab_punkte` die Verschärfung
 * eines Einzelnen. `coalesce` der beiden ist die wirksame Schwelle; ist sie
 * `null`, wird nicht gemeldet. Das ist die ehrliche Antwort auf O-15 — statt
 * einer Vorgabe, die irgendwann jemand für eine Entscheidung des Betriebs
 * hält.
 *
 * **Warum `coalesce` und nicht nur die Empfängerzeile:** die Profilseite
 * zeigt die Profilschwelle prominent an. Sie dort zu setzen und dann nichts
 * zu bekommen, weil die Meldung an einer zweiten, unsichtbaren Zahl hängt,
 * wäre genau die Sorte stiller Ausfall, die niemand sucht.
 *
 * **Ausgeschlossene Bekanntmachungen melden nicht.** Ein Negativ-Stichwort
 * oder eine ausschliessende CPV-Regel hat bereits gesagt, dass diese Vergabe
 * nicht passt; sie trotzdem zu melden hiesse, die eigene Bewertung zu
 * ignorieren.
 */
const TREFFER_SQL = `
  with aktuell as (
    select distinct on (b.ausschreibung_id, b.radar_profil_id)
           b.ausschreibung_id, b.radar_profil_id, b.mandant_id, b.punkte, b.skala_max,
           b.ausgeschlossen, b.begruendung
      from bewertung b
     order by b.ausschreibung_id, b.radar_profil_id, b.berechnet_am desc
  )
  select k.mandant_id, m.slug as mandant_slug, k.ausschreibung_id, a.titel, a.frist_angebot,
         case when a.frist_angebot is null then null
              else floor(extract(epoch from (a.frist_angebot - now())) / 86400)::int end as rest_tage,
         coalesce(v.status::text, 'neu') as stand,
         e.benutzer_id as empfaenger_id,
         coalesce(e.ab_punkte, p.benachrichtigung_ab_punkte) as ab_punkte,
         k.punkte, k.skala_max, k.begruendung, p.name as profil_name
    from aktuell k
    join ausschreibung a on a.id = k.ausschreibung_id
    join mandant m on m.id = k.mandant_id
    join radar_profil p on p.id = k.radar_profil_id
    join radar_profil_empfaenger e
      on e.radar_profil_id = k.radar_profil_id and e.mandant_id = k.mandant_id
     and coalesce(e.ab_punkte, p.benachrichtigung_ab_punkte) is not null
    left join ausschreibung_vorgang v
           on v.ausschreibung_id = k.ausschreibung_id and v.mandant_id = k.mandant_id
          and v.geloescht_am is null
   where not k.ausgeschlossen
     and k.punkte >= coalesce(e.ab_punkte, p.benachrichtigung_ab_punkte)
     and a.quell_status = 'aktiv'
     and (a.frist_angebot is null or a.frist_angebot > now())
     and p.ist_aktiv and p.geloescht_am is null
     and not exists (
       select 1 from radar_warnung w
        where w.ausschreibung_id = k.ausschreibung_id
          and w.empfaenger_id = e.benutzer_id
          and w.art = 'treffer'
          and coalesce(w.frist_angebot, 'epoch'::timestamptz)
              = coalesce(a.frist_angebot, 'epoch'::timestamptz))
   order by k.punkte desc, k.ausschreibung_id`;

interface Meldung {
  readonly benachrichtigung: ErzeugteBenachrichtigung;
  readonly empfaengerId: string;
  readonly ausschreibungId: string;
  readonly mandantId: string;
  readonly art: 'frist_knapp' | 'treffer';
  readonly fristAngebot: Date | null;
  readonly punkte: number | null;
  readonly abPunkte: number | null;
  readonly restTage: number | null;
}

async function meldungen(
  db: SchreibAbfrage, sql: string, werte: readonly unknown[],
  bauen: (z: Record<string, unknown>) => Meldung,
): Promise<{ meldungen: Meldung[]; geprueft: number; unzustellbar: number }> {
  const zeilen = (await db.unsafe(sql, werte)) as readonly Record<string, unknown>[];
  const raus: Meldung[] = [];
  let unzustellbar = 0;
  for (const z of zeilen) {
    try {
      raus.push(bauen(z));
    } catch {
      /*
       * Ein fehlendes Ziel (NOT-03) ist kein Grund, den ganzen Lauf zu
       * verlieren — aber auch keiner, es zu verschweigen: die Zahl steht im
       * Kennzahlensatz des Laufs.
       */
      unzustellbar += 1;
    }
  }
  return { meldungen: raus, geprueft: zeilen.length, unzustellbar };
}

export interface WarnErgebnis extends WarnBericht {
  readonly frist: number;
  readonly treffer: number;
  readonly ohneSchwelle: number;
}

/**
 * Ein Lauf: beide Wächter, eine Quittung je Meldung.
 *
 * Die Quittung wird **vor** der Zustellung geschrieben, und der
 * Eindeutigkeitsindex entscheidet: schlägt er zu, hat ein paralleler Lauf
 * dieselbe Meldung schon erzeugt, und diese hier fällt aus. Andersherum —
 * erst zustellen, dann quittieren — stünde die Meldung bei einem Abbruch
 * zweimal im Posteingang.
 */
export async function pruefeWarnungen(
  db: SchreibAbfrage,
  zustellen: (m: readonly Meldung[]) => Promise<number>,
): Promise<WarnErgebnis> {
  const fristLage = await meldungen(db, FRIST_SQL, [String(FRIST_WARNUNG_TAGE)], (z) => ({
    benachrichtigung: erzeuge(ART_FRIST, {
      mandantId: String(z['mandant_id']),
      mandantSlug: String(z['mandant_slug']),
      objektTyp: 'ausschreibung',
      objektId: String(z['ausschreibung_id']),
      daten: {
        titel: z['titel'], restTage: z['rest_tage'],
        stand: z['stand'] === 'neu' ? 'neu' : 'geprüft',
      },
    }),
    empfaengerId: String(z['empfaenger_id']),
    ausschreibungId: String(z['ausschreibung_id']),
    mandantId: String(z['mandant_id']),
    art: 'frist_knapp',
    fristAngebot: (z['frist_angebot'] as Date | null) ?? null,
    punkte: null,
    abPunkte: null,
    restTage: z['rest_tage'] === null ? null : Number(z['rest_tage']),
  }));

  const trefferLage = await meldungen(db, TREFFER_SQL, [], (z) => ({
    benachrichtigung: erzeuge(ART_TREFFER, {
      mandantId: String(z['mandant_id']),
      mandantSlug: String(z['mandant_slug']),
      objektTyp: 'ausschreibung',
      objektId: String(z['ausschreibung_id']),
      daten: {
        titel: z['titel'], punkte: z['punkte'], skalaMax: z['skala_max'],
        abPunkte: z['ab_punkte'], profil: z['profil_name'], begruendung: z['begruendung'],
      },
    }),
    empfaengerId: String(z['empfaenger_id']),
    ausschreibungId: String(z['ausschreibung_id']),
    mandantId: String(z['mandant_id']),
    art: 'treffer',
    fristAngebot: (z['frist_angebot'] as Date | null) ?? null,
    punkte: Number(z['punkte']),
    abPunkte: Number(z['ab_punkte']),
    restTage: z['rest_tage'] === null ? null : Number(z['rest_tage']),
  }));

  const alle = [...fristLage.meldungen, ...trefferLage.meldungen];
  const quittiert: Meldung[] = [];
  for (const m of alle) {
    const zeilen = (await db.unsafe(
      `insert into radar_warnung
         (mandant_id, ausschreibung_id, empfaenger_id, art, frist_angebot,
          punkte, ab_punkte, rest_tage)
       values ($1::uuid, $2::uuid, $3::uuid, $4::radar_warnung_art, $5::timestamptz,
               $6::integer, $7::integer, $8::integer)
       on conflict do nothing
       returning id`,
      [m.mandantId, m.ausschreibungId, m.empfaengerId, m.art, m.fristAngebot,
        m.punkte, m.abPunkte, m.restTage])) as readonly { id: string }[];
    if (zeilen.length === 1) quittiert.push(m);
  }

  const zugestellt = quittiert.length === 0 ? 0 : await zustellen(quittiert);

  /**
   * **Wie viele Empfänger ohne Schwelle dastehen** — die Zahl, die O-15
   * sichtbar hält. Ein Lauf, der „0 Treffer" meldet, weil niemand eine
   * Schwelle gesetzt hat, sieht aus wie ein ruhiger Tag.
   */
  const [ohne] = (await db.unsafe(
    `select count(*)::int as n from radar_profil_empfaenger e
       join radar_profil p on p.id = e.radar_profil_id
      where coalesce(e.ab_punkte, p.benachrichtigung_ab_punkte) is null
        and p.ist_aktiv and p.geloescht_am is null`,
  )) as readonly { n: number }[];

  return {
    geprueft: fristLage.geprueft + trefferLage.geprueft,
    gemeldet: zugestellt,
    unzustellbar: fristLage.unzustellbar + trefferLage.unzustellbar,
    frist: fristLage.meldungen.length,
    treffer: trefferLage.meldungen.length,
    ohneSchwelle: ohne?.n ?? 0,
  };
}

export type { Meldung };
