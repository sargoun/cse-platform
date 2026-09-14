import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { alsPortalSitzung } from './sitzung.js';
import { kanonisiere, type KanonischerWert } from '../../services/finanz/kanonisch.js';
import { cent, type Cent } from '../../services/finanz/geld.js';
import { milliMenge } from '../../services/finanz/menge.js';
import {
  diffVergleich, type Diff, type Vergleichsmodell, type VergleichsPosition,
} from '../../services/freigabe/diff.js';
import { fuerJsonb, alsKanonischerWert, diffZuJson } from '../../services/freigabe/diff-json.js';
import { OHNE_VERGLEICH, zusammenfassung } from '../../services/freigabe/zusammenfassung.js';
import {
  risikoPunkte, stufeRisikoEin, type RisikoLage, type VorgangTyp,
} from '../../services/freigabe/posteingang.js';
import { konfidenzText } from '../../services/freigabe/konfidenz.js';

/**
 * Der Freigabe-Posteingang im Seed — wartende Vorschlaege, die es zu pruefen
 * gibt (PR 62, APR-01 … APR-03, D-472).
 *
 * **Kein Agent hat sie erzeugt, und der Seed sagt das.** Die vier Agenten
 * laufen erst mit einem Modellzugang (Phase 8); bis dahin braucht der
 * Posteingang trotzdem Zeilen, sonst pruefte niemand die beiden Bildschirme
 * an etwas Echtem. Jeder Vorschlag hier ist so gebaut, wie ein Agent ihn
 * bauen MUESSTE: Diff aus `diffVergleich`, Kopfzeile aus `zusammenfassung`
 * (Vorlage, kein Modell — D-464), Einstufung aus `stufeRisikoEin`, und der
 * `payload_hash` ueber genau die kanonischen Bytes, die die Entscheidung
 * spaeter nachrechnet (`kanonisiere`, D-467).
 *
 * **Wiederholbar** ueber `externe_ref`: der zweite Lauf legt nichts nach —
 * eine Freigabe, die jemand inzwischen entschieden hat, darf kein Seed
 * verdoppeln.
 */
type Sql = postgres.Sql<Record<string, unknown>>;

export interface FreigabenErgebnis {
  readonly vorschlaege: number;
  readonly felder: number;
  readonly vorhanden: number;
}

interface Feld {
  readonly pfad: string;
  readonly bezeichnung: string;
  readonly vorher: string | null;
  readonly nachher: string;
  readonly konfidenz: number;
  readonly unsicher: boolean;
  readonly grund: string | null;
  readonly zitat: string;
  readonly tabelle?: string;
  readonly zelle?: string;
}

interface Vorschlag {
  readonly externeRef: string;
  readonly vorgangTyp: VorgangTyp;
  readonly aktion: string;
  readonly titel: string;
  readonly nutzlast: KanonischerWert;
  readonly diff: Diff | null;
  readonly zusammenfassung: string;
  readonly betragCent: Cent | null;
  readonly fristStunden: number | null;
  readonly felder: readonly Feld[];
  readonly lage: Omit<RisikoLage, 'vorgangTyp' | 'unsichereFelder' | 'diffLeer'>;
}

interface Objekt { readonly id: string; readonly bezeichnung: string }

const LAGE_RUHIG = {
  betragCent: null, wirksameGrenzeCent: null, oeffentlicherAuftraggeber: false,
  neueGegenpartei: false, injektionsverdacht: false, personenbezogeneEntscheidung: false,
  arbzgVerdikt: 'keine', hatVergleich: true,
} as const;

function position(
  objekt: Objekt, bezeichnung: string, katalog: string, mengeMilli: bigint, einheit: string,
  einzelpreisCent: bigint,
): VergleichsPosition {
  const betrag = (mengeMilli * einzelpreisCent) / 1000n;
  return {
    objektId: objekt.id, leistungskatalogId: katalog, bezeichnung,
    menge: milliMenge(mengeMilli), einheit, einzelpreisCent: cent(einzelpreisCent),
    betragCent: cent(betrag), herkunft: [{ art: 'vertrag', id: `vertrag-${objekt.id}` }],
    meta: {},
  };
}

function modell(
  periode: string, zeitraum: { von: string; bis: string },
  positionen: readonly VergleichsPosition[],
): Vergleichsmodell {
  const netto = positionen.reduce((s, p) => s + p.betragCent, 0n);
  const ust = (netto * 19n) / 100n;
  return {
    vorgangTyp: 'monatsrechnung_entwurf', periode, positionen,
    ustGruppen: [{ steuersatzGruppeId: 'ust-19', nettoCent: cent(netto), ustCent: cent(ust) }],
    summeNettoCent: cent(netto), summeBruttoCent: cent(netto + ust), leistungszeitraum: zeitraum,
  };
}

/** Das Vergleichsmodell als Nutzlast — Betraege und Mengen als ganze Zahlen. */
function modellAlsNutzlast(m: Vergleichsmodell): KanonischerWert {
  return alsKanonischerWert({
    vorgangTyp: m.vorgangTyp, periode: m.periode, leistungszeitraum: m.leistungszeitraum,
    positionen: m.positionen.map((p) => ({
      objektId: p.objektId, leistungskatalogId: p.leistungskatalogId, bezeichnung: p.bezeichnung,
      menge: p.menge, einheit: p.einheit, einzelpreisCent: p.einzelpreisCent,
      betragCent: p.betragCent, herkunft: p.herkunft.map((q) => ({ art: q.art, id: q.id })),
      meta: p.meta,
    })),
    ustGruppen: m.ustGruppen.map((g) => ({
      steuersatzGruppeId: g.steuersatzGruppeId, nettoCent: g.nettoCent, ustCent: g.ustCent,
    })),
    summeNettoCent: m.summeNettoCent, summeBruttoCent: m.summeBruttoCent,
  });
}

function euro(betrag: bigint): string {
  const negativ = betrag < 0n;
  const abs = negativ ? -betrag : betrag;
  const ganz = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, '.');
  return `${negativ ? '-' : ''}${ganz},${(abs % 100n).toString().padStart(2, '0')} €`;
}

function vorschlaegeFuer(slug: string, objekte: readonly Objekt[]): readonly Vorschlag[] {
  const objekt = objekte[0];
  if (objekt === undefined) return [];
  const namen = new Map(objekte.map((o) => [o.id, o.bezeichnung]));

  if (slug === 'reinigung') {
    const juli = modell('Juli 2026', { von: '2026-07-01', bis: '2026-07-31' }, [
      position(objekt, 'Unterhaltsreinigung', 'kat-unterhalt', 160_000n, 'h', 2_850n),
      position(objekt, 'Glasreinigung', 'kat-glas', 4_000n, 'Stk', 4_500n),
    ]);
    const august = modell('August 2026', { von: '2026-08-01', bis: '2026-08-31' }, [
      ...juli.positionen,
      position(objekt, 'Nachtstunden', 'kat-nacht', 12_000n, 'h', 3_800n),
    ]);
    const diff = diffVergleich(juli, august);
    return [
      {
        externeRef: 'seed:monatsrechnung-2026-08',
        vorgangTyp: 'monatsrechnung_entwurf',
        aktion: 'rechnung_senden',
        titel: `Monatsrechnung August 2026 — ${objekt.bezeichnung}`,
        nutzlast: modellAlsNutzlast(august),
        diff,
        zusammenfassung: zusammenfassung(diff, 'Juli 2026', namen),
        betragCent: august.summeBruttoCent,
        fristStunden: 48,
        lage: { ...LAGE_RUHIG, betragCent: august.summeBruttoCent },
        felder: [
          {
            pfad: '/leistungszeitraum', bezeichnung: 'Leistungszeitraum',
            vorher: '01.07.2026 – 31.07.2026', nachher: '01.08.2026 – 31.08.2026',
            konfidenz: 1, unsicher: false, grund: null,
            zitat: 'Vertrag, Abschnitt 3: monatliche Abrechnung zum Monatsende',
          },
          {
            pfad: '/positionen/2/menge', bezeichnung: 'Nachtstunden (Menge)',
            vorher: null, nachher: '12 h',
            konfidenz: 0.82, unsicher: true,
            grund: 'Das Stundenkonto weist 10,5 Nachtstunden aus, der Entwurf nennt 12.',
            zitat: 'Zeiteintraege 03.08.–28.08.2026 im Nachtfenster 22–06 Uhr',
            tabelle: 'stundenkonto', zelle: 'nacht_minuten',
          },
          {
            pfad: '/summeNettoCent', bezeichnung: 'Nettosumme',
            vorher: euro(juli.summeNettoCent), nachher: euro(august.summeNettoCent),
            konfidenz: 0.99, unsicher: false, grund: null,
            zitat: 'Summe der Positionen, nachgerechnet aus Menge × Einzelpreis',
          },
        ],
      },
      {
        externeRef: 'seed:hinweis-leistungsnachweis',
        vorgangTyp: 'interner_hinweis',
        aktion: 'interner_hinweis',
        titel: `Leistungsnachweis ${objekt.bezeichnung} seit 9 Tagen ohne Unterschrift`,
        nutzlast: { hinweis: 'Der vorgelegte Leistungsnachweis wurde vom Kunden noch nicht unterschrieben.', objektId: objekt.id, tage: 9, empfehlung: 'Objektleitung erinnert den Kunden.' },
        diff: null,
        zusammenfassung: OHNE_VERGLEICH,
        betragCent: null,
        fristStunden: 3,
        lage: LAGE_RUHIG,
        felder: [],
      },
    ];
  }

  if (slug === 'security') {
    return [{
      externeRef: 'seed:anfrage-antwort-messe',
      vorgangTyp: 'anfrage_antwort_entwurf',
      aktion: 'email_senden',
      titel: 'Antwortentwurf: Anfrage Messeschutz, 4 Kraefte, 2 Tage',
      nutzlast: {
        empfaenger: 'b.beispiel@geheim.test', betreff: 'Ihre Anfrage: Messeschutz Messedamm 22',
        text: 'Sehr geehrte Frau Beispiel, vielen Dank fuer Ihre Anfrage. Fuer den 01.10.2026 koennen wir vier Sicherheitskraefte mit Sachkundenachweis nach § 34a GewO stellen. Ein Angebot mit Stundensatz und Einsatzplan folgt nach Rueckfrage zur Besucherzahl.',
        anfrageId: null,
      },
      diff: null,
      zusammenfassung: OHNE_VERGLEICH,
      betragCent: null,
      fristStunden: 6,
      lage: { ...LAGE_RUHIG, hatVergleich: false, neueGegenpartei: true },
      felder: [],
    }];
  }

  if (slug === 'bau') {
    return [{
      externeRef: 'seed:abnahmetermin',
      vorgangTyp: 'termin_bestaetigen',
      aktion: 'termin_bestaetigen',
      titel: `Abnahmetermin ${objekt.bezeichnung} am 22.09.2026 bestaetigen`,
      nutzlast: { objektId: objekt.id, termin: '2026-09-22T09:00:00+02:00', teilnehmer: ['Bauleitung', 'Auftraggeber'], protokoll: '§ 12 VOB/B' },
      diff: null,
      zusammenfassung: OHNE_VERGLEICH,
      betragCent: null,
      fristStunden: null,
      lage: LAGE_RUHIG,
      felder: [],
    }];
  }
  return [];
}

export async function seedFreigaben(
  sql: Sql, ids: ReadonlyMap<string, string>,
): Promise<FreigabenErgebnis> {
  let vorschlaege = 0;
  let felder = 0;
  let vorhanden = 0;

  for (const slug of ['reinigung', 'security', 'bau']) {
    const mandantId = ids.get(slug);
    if (mandantId === undefined) continue;

    /* Der Entscheider: ein Konto mit Verwaltungsrolle in dieser Gesellschaft. */
    const [entscheider] = await sql<{ id: string }[]>`
      select b.id
        from benutzer b
        join benutzer_mandant bm on bm.benutzer_id = b.id and bm.entzogen_am is null
        join rolle r on r.id = bm.rolle_id
       where bm.mandant_id = ${mandantId} and r.schluessel in ('admin', 'leitung')
       order by case r.schluessel when 'admin' then 0 else 1 end, b.email
       limit 1`;
    if (entscheider === undefined) continue;

    const objekte = await sql<Objekt[]>`
      select id, bezeichnung from objekt
       where mandant_id = ${mandantId} and archiviert_am is null
       order by objektnummer limit 2`;

    for (const v of vorschlaegeFuer(slug, objekte)) {
      const [da] = await sql<{ id: string }[]>`
        select id from freigabe where mandant_id = ${mandantId} and externe_ref = ${v.externeRef}`;
      if (da !== undefined) { vorhanden += 1; continue; }

      const urteil = stufeRisikoEin({
        ...v.lage,
        vorgangTyp: v.vorgangTyp,
        unsichereFelder: v.felder.filter((f) => f.unsicher).length,
        diffLeer: v.diff === null,
      });
      const nutzlastBytes = Buffer.from(kanonisiere(v.nutzlast));
      const payloadHash = createHash('sha256').update(nutzlastBytes).digest('hex');
      const diffJson = v.diff === null ? [] : diffZuJson(v.diff);

      await alsPortalSitzung(sql, mandantId, entscheider.id, async (kontext) => {
        const [neu] = await kontext.schreibe<{ id: string }>(
          `insert into freigabe
             (mandant_id, aktion, status, vorgang_typ, titel, zusammenfassung, risiko,
              risiko_punkte, diff, vorschau_payload, payload_hash, betrag_cent, frist,
              erstellt_von, externe_ref)
           values ($1, $2, 'offen', $3::agent_vorgang_typ, $4, $5, $6::risiko_stufe, $7,
                   $8::jsonb, $9::jsonb, $10, $11, $12::timestamptz, $13, $14)
           returning id`,
          [mandantId, v.aktion, v.vorgangTyp, v.titel, v.zusammenfassung, urteil.risiko,
            risikoPunkte(urteil.risiko), fuerJsonb(diffJson), fuerJsonb(v.nutzlast),
            payloadHash, v.betragCent === null ? null : v.betragCent.toString(),
            v.fristStunden === null
              ? null : new Date(Date.now() + v.fristStunden * 3_600_000).toISOString(),
            entscheider.id, v.externeRef]);
        if (neu === undefined) return;
        vorschlaege += 1;
        for (const f of v.felder) {
          await kontext.schreibe(
            `insert into freigabe_feld
               (mandant_id, freigabe_id, feld_pfad, bezeichnung, wert_vorher, wert_nachher,
                konfidenz, unsicher, grund, quelle_zitat, quelle_tabelle, quelle_zelle,
                extraktion_modell, erstellt_von)
             values ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $12, $13, $14)`,
            [mandantId, neu.id, f.pfad, f.bezeichnung, f.vorher, f.nachher,
              konfidenzText(f.konfidenz), f.unsicher, f.grund, f.zitat, f.tabelle ?? null,
              f.zelle ?? null, 'demo:seed (kein Modell)', entscheider.id]);
          felder += 1;
        }
      });
    }
  }
  return { vorschlaege, felder, vorhanden };
}
