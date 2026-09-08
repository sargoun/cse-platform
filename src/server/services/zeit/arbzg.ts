/**
 * ArbZG — §3 daily limits, §4 breaks, §5 rest period. TIM-14, LEG-03, D-09.
 *
 * **Keyed by `person_id`, across employments.** This is the whole point and
 * the reason K-06 exists: a human who cleans six hours for one entity and
 * guards five for another has worked eleven hours, and checking each
 * employment separately reports no breach at all. That failure is silent — the
 * scheduler passes its own check and books an unlawful day — which is why the
 * cross-entity case is a test here before it is a screen anywhere.
 *
 * The verdict vocabulary is not this module's to choose. It is the six
 * `arbzg_regel` values and the three `verstoss_schwere` values that
 * `02-datenmodell/04-PLANUNG-ZEIT.md` §3 owns, because
 * `app.arbzg_befund_schreiben(p_regel arbzg_regel, p_schwere verstoss_schwere, …)`
 * is the only writer: a finding that does not map onto those values cannot be
 * persisted at all.
 */
import { berlinKalendertag, dauerMinuten, ZeitFehler } from './dauer.js';

/** `02-datenmodell/04-PLANUNG-ZEIT.md` §3 — the enum, mirrored value for value. */
export const ARBZG_REGELN = [
  'tagesarbeitszeit_ueber_8h',
  'tagesarbeitszeit_ueber_10h',
  'ruhezeit_unter_11h',
  'pause_fehlt_ueber_6h',
  'pause_fehlt_ueber_9h',
  'ausgleichszeitraum_ueberschritten',
] as const;
export type ArbzgRegel = (typeof ARBZG_REGELN)[number];

export const VERSTOSS_SCHWEREN = ['hinweis', 'warnung', 'verstoss'] as const;
export type VerstossSchwere = (typeof VERSTOSS_SCHWEREN)[number];

/**
 * One worked or planned interval belonging to one human.
 *
 * `mandantId` is carried so a finding can be mirrored into both entities, and
 * is **never** part of the aggregation key — that is the D-09 rule.
 */
export interface Schicht {
  readonly id: string;
  readonly personId: string;
  readonly mandantId: string;
  readonly vonUtc: Date;
  readonly bisUtc: Date;
  /** Recorded break total. Never invented — a missing break is a finding. */
  readonly pauseMinuten: number;
}

export interface ArbzgBefund {
  readonly regel: ArbzgRegel;
  readonly schwere: VerstossSchwere;
  readonly personId: string;
  /** Berlin calendar day, or the day the rest period was measured from. */
  readonly kalendertag: string;
  /** Minutes the finding is about — worked minutes, or rest minutes. */
  readonly minuten: number;
  /** Every shift that contributed, so the finding can be mirrored per entity. */
  readonly beteiligteSchichten: readonly string[];
  /** True when more than one entity contributed — the K-06 case. */
  readonly ueberMandanten: boolean;
  readonly begruendung: string;
}

export interface ArbzgOptionen {
  /**
   * Whether the §3 Satz 2 extension to ten hours is in use.
   *
   * §3 ArbZG: the working day may not exceed eight hours; it *may* be extended
   * to ten **if** the average over six calendar months or 24 weeks stays at
   * eight. So exceeding eight hours is not automatically unlawful — but it is
   * always a **fact the compensation calculation needs**, which is why this
   * flag changes the *severity* of the eight-hour finding and never suppresses
   * it. Suppressing it would delete the input to
   * `ausgleichszeitraum_ueberschritten` and make the exception unverifiable:
   * the platform would report nothing while the average quietly drifted above
   * eight hours, which is the silent failure this whole module exists to stop.
   *
   * Default `false` — the restrictive reading — until the client answers.
   *
   * `// TODO(client): O-18 — is the 10h ArbZG exception in use, and over which
   * compensation window (§3 Satz 2: six calendar months or 24 weeks)?`
   */
  readonly zehnStundenAusnahme?: boolean;
}

const ACHT_STUNDEN = 8 * 60;
const ZEHN_STUNDEN = 10 * 60;
const RUHEZEIT_MINUTEN = 11 * 60;
const PAUSE_AB_6H = 30;
const PAUSE_AB_9H = 45;

function pruefePersonenSchluessel(schichten: readonly Schicht[]): string {
  const personen = new Set(schichten.map((s) => s.personId));
  if (personen.size > 1) {
    throw new ZeitFehler(
      `pruefeArbzg nimmt die Schichten genau EINER Person; erhalten: ${[...personen].join(', ')}. ` +
        'Die Aggregation ist personenbezogen (D-09), nicht anstellungsbezogen.',
    );
  }
  const erste = schichten[0];
  if (erste === undefined) throw new ZeitFehler('Keine Schichten übergeben');
  return erste.personId;
}

/**
 * The daily aggregation is on the **Berlin calendar day the shift starts**.
 *
 * Which reading of "werktäglich" applies to a shift crossing midnight is not
 * settled by the statute and is not invented here — the reading is named in
 * every finding's `begruendung` so a reviewer can see which one produced it.
 */
export function pruefeArbzg(
  schichten: readonly Schicht[],
  optionen: ArbzgOptionen = {},
): readonly ArbzgBefund[] {
  if (schichten.length === 0) return [];
  const personId = pruefePersonenSchluessel(schichten);
  const ausnahme = optionen.zehnStundenAusnahme ?? false;

  const befunde: ArbzgBefund[] = [];
  const sortiert = [...schichten].sort((a, b) => a.vonUtc.getTime() - b.vonUtc.getTime());

  // --- §3 daily working time, and §4 breaks, per Berlin calendar day ---------
  const proTag = new Map<string, Schicht[]>();
  for (const s of sortiert) {
    const tag = berlinKalendertag(s.vonUtc);
    const liste = proTag.get(tag);
    if (liste === undefined) proTag.set(tag, [s]);
    else liste.push(s);
  }

  for (const [tag, tagesSchichten] of [...proTag.entries()].sort()) {
    const brutto = tagesSchichten.reduce((m, s) => m + dauerMinuten(s.vonUtc, s.bisUtc), 0);
    const pause = tagesSchichten.reduce((m, s) => m + s.pauseMinuten, 0);
    const netto = brutto - pause;
    const ids = tagesSchichten.map((s) => s.id);
    const mandanten = new Set(tagesSchichten.map((s) => s.mandantId));
    const ueber = mandanten.size > 1;
    const quelle = ueber
      ? `${mandanten.size} Gesellschaften, Zuordnung nach Schichtbeginn (Berlin)`
      : 'Zuordnung nach Schichtbeginn (Berlin)';

    // §3: the two limits are separate rules on the two STATUTORY thresholds.
    // Collapsing them into one makes the 10h finding unpersistable, because
    // the enum has no combined value.
    if (netto > ACHT_STUNDEN) {
      befunde.push({
        regel: 'tagesarbeitszeit_ueber_8h',
        // With the §3 Satz 2 extension configured, exceeding eight hours is
        // permitted subject to compensation — a warning that feeds the
        // averaging, not a breach. Without it, eight hours is the limit.
        schwere: ausnahme ? (netto > ZEHN_STUNDEN ? 'verstoss' : 'warnung') : 'verstoss',
        personId,
        kalendertag: tag,
        minuten: netto,
        beteiligteSchichten: ids,
        ueberMandanten: ueber,
        begruendung:
          `${netto} min Arbeitszeit über der Regelgrenze von ${ACHT_STUNDEN} min (§3 Satz 1 ArbZG)` +
          (ausnahme
            ? ' — Verlängerung nach §3 Satz 2 konfiguriert, ausgleichspflichtig'
            : ' — keine Verlängerung nach §3 Satz 2 konfiguriert (O-18)') +
          ` — ${quelle}`,
      });
    }
    if (netto > ZEHN_STUNDEN) {
      befunde.push({
        regel: 'tagesarbeitszeit_ueber_10h',
        schwere: 'verstoss',
        personId,
        kalendertag: tag,
        minuten: netto,
        beteiligteSchichten: ids,
        ueberMandanten: ueber,
        begruendung: `${netto} min Arbeitszeit über der absoluten Höchstgrenze von 600 min (§3 ArbZG) — ${quelle}`,
      });
    }

    // §4: 30 min above 6 h, 45 min above 9 h. The recorded total is read; a
    // missing break is reported, never invented (§3.4, O-168).
    if (netto > 9 * 60 && pause < PAUSE_AB_9H) {
      befunde.push({
        regel: 'pause_fehlt_ueber_9h',
        schwere: 'verstoss',
        personId,
        kalendertag: tag,
        minuten: pause,
        beteiligteSchichten: ids,
        ueberMandanten: ueber,
        begruendung: `${pause} min Pause bei ${netto} min Arbeitszeit; §4 ArbZG verlangt ${PAUSE_AB_9H} min — ${quelle}`,
      });
    } else if (netto > 6 * 60 && pause < PAUSE_AB_6H) {
      befunde.push({
        regel: 'pause_fehlt_ueber_6h',
        schwere: 'verstoss',
        personId,
        kalendertag: tag,
        minuten: pause,
        beteiligteSchichten: ids,
        ueberMandanten: ueber,
        begruendung: `${pause} min Pause bei ${netto} min Arbeitszeit; §4 ArbZG verlangt ${PAUSE_AB_6H} min — ${quelle}`,
      });
    }
  }

  // --- §5 rest period: 11 h between the end of one shift and the next start --
  for (let i = 1; i < sortiert.length; i += 1) {
    const vorige = sortiert[i - 1];
    const naechste = sortiert[i];
    if (vorige === undefined || naechste === undefined) continue;
    if (naechste.vonUtc.getTime() < vorige.bisUtc.getTime()) continue; // overlap, not a rest gap
    const ruhe = dauerMinuten(vorige.bisUtc, naechste.vonUtc);
    if (ruhe < RUHEZEIT_MINUTEN) {
      const ueber = vorige.mandantId !== naechste.mandantId;
      befunde.push({
        regel: 'ruhezeit_unter_11h',
        schwere: 'verstoss',
        personId,
        kalendertag: berlinKalendertag(naechste.vonUtc),
        minuten: ruhe,
        beteiligteSchichten: [vorige.id, naechste.id],
        ueberMandanten: ueber,
        begruendung:
          `${ruhe} min Ruhezeit zwischen Schichtende und nächstem Beginn; ` +
          `§5 ArbZG verlangt ${RUHEZEIT_MINUTEN} min` +
          (ueber ? ' — die Schichten liegen in zwei Gesellschaften' : ''),
      });
    }
  }

  return befunde;
}
