/**
 * Die Minderung der Monatspauschale bei Turnusausfall — und der Zusatztermin
 * (V-327, O-146, O-700, D-783, D-789, D-850, CLN-02, FIN-01).
 *
 * **Warum es sie braucht.** `turnus_ausnahme.abrechnungsrelevant` ist „ja"
 * vorbelegt (O-700, D-783): ein Ausfall mindert die Pauschale, ein
 * Zusatztermin wird berechnet. Bis V-327 las die Monatspauschale die
 * Ausnahmen nicht — die Rechnung verlangte die volle Pauschale auch für
 * Termine, die ausgefallen waren.
 *
 * // TODO(client, O-146): Voreinstellung — ein abrechnungsrelevanter Ausfall mindert die Pauschale um Pauschale ÷ Regeltermine des Monats, ein abrechnungsrelevanter Zusatztermin kommt zum selben Satz als eigene Zeile dazu; Regeltermine sind die Termine der Regel nach ihrer Feiertagsregel (Berliner Feiertage, O-167), vor den Ausnahmen; eine Verschiebung ändert nichts, eine Ausnahme ohne Angabe zur Abrechnungsrelevanz auch nicht. D-789, D-850.
 *
 * **Rein bis auf den Lader.** Die Regeltermine entfaltet dieselbe Funktion,
 * die das Turnusblatt zeigt (`turnusVorschau`); die Feiertage sind die
 * Berliner (wie bei den Arbeitstagen der Pauschale, D-843 — bis ein Objekt
 * sein Land trägt, V-396). Gezählt wird je Turnus; der Nenner sind die
 * Regeltermine des GANZEN Monats, auch wenn der Abschnitt angebrochen ist —
 * ein Termin ist so viel wert, wie der Monat Termine hat.
 */
import type { Abfrage } from '../rechnung.js';
import type { Periode, VertragAbrechnung } from './typen.js';
import { turnusVorschau } from '../../reinigung/turnusvorschau.js';
import { feiertageBerlin } from '../../../../lib/datum/feiertage-berlin.js';

export interface AbrechnungsTurnus {
  readonly id: string;
  readonly rrule: string;
  readonly ankerDatum: string;
  readonly ankerStunde: number;
  readonly ankerMinute: number;
  readonly dauerMinuten: number;
  readonly feiertagsregel: 'ausfall' | 'unveraendert';
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
}

export interface AbrechnungsAusnahme {
  readonly id: string;
  readonly turnusId: string;
  readonly datum: string;
  readonly art: 'ausfall' | 'zusatz' | 'verschiebung';
  readonly abrechnungsrelevant: boolean | null;
}

export interface TurnusDaten {
  readonly turnusse: readonly AbrechnungsTurnus[];
  readonly ausnahmen: readonly AbrechnungsAusnahme[];
}

/** Was die Turnusse in einem Abschnitt für die Pauschale bedeuten. */
export interface TurnusAbschnitt {
  /** Die Regeltermine des GANZEN Monats — der Nenner. */
  readonly termine: number;
  /** Je ausgefallenem Regeltermin im Abschnitt sein Tag (abrechnungsrelevant). */
  readonly ausfaelle: readonly string[];
  /** Je Zusatztermin im Abschnitt sein Tag (abrechnungsrelevant). */
  readonly zusaetze: readonly string[];
  /** Ausnahmen im Abschnitt ohne Angabe zur Abrechnungsrelevanz — nicht gerechnet. */
  readonly ohneAngabe: number;
}

/** Die gesetzlichen Berliner Feiertage des Monats, Tag → Name. */
function feiertageImMonat(monat: Periode): ReadonlyMap<string, string> {
  const karte = new Map<string, string>();
  for (const f of feiertageBerlin(Number(monat.von.slice(0, 4)))) {
    if (f.gesetzlich && f.datum >= monat.von && f.datum <= monat.bis) karte.set(f.datum, f.bezeichnung);
  }
  return karte;
}

/**
 * Rein: Regeltermine des Monats, Ausfälle und Zusatztermine des Abschnitts.
 *
 * Ein Ausfall zählt nur an einem Tag, an dem die Regel einen Termin vorsah
 * — ein Ausfall am Feiertag, den die Feiertagsregel ohnehin streicht, mindert
 * nichts; an einem Tag mit zwei Regelterminen fallen beide aus, wie im
 * Generator. Je Turnus und Tag zählt ein Ausfall einmal; jeder Zusatztermin
 * zählt für sich.
 */
export function turnusImAbschnitt(
  daten: TurnusDaten, monat: Periode, abschnitt: Periode,
): TurnusAbschnitt {
  const feiertage = feiertageImMonat(monat);
  let termine = 0;
  const ausfaelle: string[] = [];
  const zusaetze: string[] = [];
  let ohneAngabe = 0;

  for (const t of daten.turnusse) {
    const geplant = new Map<string, number>();
    for (const termin of turnusVorschau(
      {
        rrule: t.rrule,
        dtstartLokal: { datum: t.ankerDatum, stunde: t.ankerStunde, minute: t.ankerMinute },
        dauerMinuten: t.dauerMinuten,
        feiertagsregel: t.feiertagsregel,
        gueltigAb: t.gueltigAb,
        gueltigBis: t.gueltigBis,
      },
      [], feiertage, { vonDatum: monat.von, bisDatum: monat.bis },
    )) {
      if (termin.ausfall !== null || termin.art !== 'regel') continue;
      termine += 1;
      geplant.set(termin.planDatum, (geplant.get(termin.planDatum) ?? 0) + 1);
    }

    const schonAusgefallen = new Set<string>();
    for (const a of daten.ausnahmen) {
      if (a.turnusId !== t.id || a.datum < abschnitt.von || a.datum > abschnitt.bis) continue;
      if (a.art === 'verschiebung') continue;
      if (a.art === 'ausfall' && (!geplant.has(a.datum) || schonAusgefallen.has(a.datum))) continue;
      if (a.abrechnungsrelevant === null) {
        ohneAngabe += 1;
        continue;
      }
      if (!a.abrechnungsrelevant) continue;
      if (a.art === 'ausfall') {
        schonAusgefallen.add(a.datum);
        for (let i = 0; i < (geplant.get(a.datum) ?? 0); i += 1) ausfaelle.push(a.datum);
      } else {
        zusaetze.push(a.datum);
      }
    }
  }
  return {
    termine, ausfaelle: ausfaelle.sort(), zusaetze: zusaetze.sort(), ohneAngabe,
  };
}

interface Roh {
  readonly turnusse: readonly {
    id: string; rrule: string; anker_datum: string; anker_stunde: number; anker_minute: number;
    dauer_minuten: number; feiertagsregel: string; gueltig_ab: string; gueltig_bis: string | null;
  }[];
  readonly ausnahmen: readonly {
    id: string; turnus_id: string; datum: string; art: string; abrechnungsrelevant: boolean | null;
  }[];
}

/**
 * Die Turnusse der Vereinbarung und ihre Ausnahmen im Zeitraum — über
 * `fin.turnusse_der_abrechnung` (0534): wer abrechnet, hält
 * `abrechnung.lesen`, nicht unbedingt `reinigung.lesen`, und RLS filterte
 * sonst still.
 */
export async function ladeTurnusDaten(
  db: Abfrage, konfiguration: VertragAbrechnung, zeitraum: Periode,
): Promise<TurnusDaten> {
  const [z] = await db.abfrage<{ daten: Roh }>(
    `select fin.turnusse_der_abrechnung($1::uuid, $2::date, $3::date) as daten`,
    [konfiguration.id, zeitraum.von, zeitraum.bis]);
  const roh = z?.daten ?? { turnusse: [], ausnahmen: [] };
  return {
    turnusse: roh.turnusse.map((t) => ({
      id: t.id, rrule: t.rrule, ankerDatum: t.anker_datum, ankerStunde: t.anker_stunde,
      ankerMinute: t.anker_minute, dauerMinuten: t.dauer_minuten,
      feiertagsregel: t.feiertagsregel === 'unveraendert' ? 'unveraendert' : 'ausfall',
      gueltigAb: t.gueltig_ab, gueltigBis: t.gueltig_bis,
    })),
    ausnahmen: roh.ausnahmen.map((a) => ({
      id: a.id, turnusId: a.turnus_id, datum: a.datum,
      art: a.art === 'zusatz' ? 'zusatz' : a.art === 'verschiebung' ? 'verschiebung' : 'ausfall',
      abrechnungsrelevant: a.abrechnungsrelevant,
    })),
  };
}
