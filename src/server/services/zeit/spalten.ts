/**
 * Lane packing for the Dienstplan (TIM-04).
 *
 * Ten shifts that start at the same instant on one `objekt` are ten lanes.
 * Not one lane, not "ten overlapping" collapsed into a stack the planner
 * cannot click apart: every assignment stays individually visible, because a
 * shift the planner cannot see is a shift nobody staffs.
 *
 * Pure geometry over instants. It reads no clock — the caller passes the
 * intervals — which is what makes it testable against a fixed fixture.
 */
import { ZeitFehler } from './dauer.js';

export interface Belegung {
  readonly id: string;
  readonly vonUtc: Date;
  readonly bisUtc: Date;
}

export interface BelegungMitSpalte extends Belegung {
  /** Zero-based lane index. */
  readonly spalte: number;
  /** How many lanes the overlapping cluster needs — the render width. */
  readonly spaltenImCluster: number;
}

/**
 * Assign each interval a lane so that no two overlapping intervals share one.
 *
 * Touching intervals do not overlap: a shift ending 14:00 and one starting
 * 14:00 share a lane, which is what a planner expects to see.
 */
export function verteileSpalten(
  belegungen: readonly Belegung[],
): readonly BelegungMitSpalte[] {
  for (const b of belegungen) {
    if (b.bisUtc.getTime() < b.vonUtc.getTime()) {
      throw new ZeitFehler(`Belegung ${b.id} endet vor ihrem Beginn`);
    }
  }

  const sortiert = [...belegungen].sort(
    (a, b) =>
      a.vonUtc.getTime() - b.vonUtc.getTime() ||
      a.bisUtc.getTime() - b.bisUtc.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const ergebnis: { belegung: Belegung; spalte: number; cluster: number }[] = [];
  /** Lane index → the instant that lane is free again. */
  let spaltenEnde: number[] = [];
  let clusterStart = 0;
  let clusterEnde = -Infinity;

  const clusterAbschliessen = (bisIndex: number): void => {
    const breite = spaltenEnde.length;
    for (let i = clusterStart; i < bisIndex; i += 1) {
      const eintrag = ergebnis[i];
      if (eintrag !== undefined) eintrag.cluster = breite;
    }
    spaltenEnde = [];
    clusterStart = bisIndex;
    clusterEnde = -Infinity;
  };

  for (const b of sortiert) {
    const von = b.vonUtc.getTime();
    if (von >= clusterEnde && spaltenEnde.length > 0) {
      clusterAbschliessen(ergebnis.length);
    }

    let spalte = spaltenEnde.findIndex((frei) => frei <= von);
    if (spalte === -1) {
      spalte = spaltenEnde.length;
      spaltenEnde.push(b.bisUtc.getTime());
    } else {
      spaltenEnde[spalte] = b.bisUtc.getTime();
    }

    clusterEnde = Math.max(clusterEnde, b.bisUtc.getTime());
    ergebnis.push({ belegung: b, spalte, cluster: 0 });
  }
  clusterAbschliessen(ergebnis.length);

  return ergebnis.map(({ belegung, spalte, cluster }) => ({
    ...belegung,
    spalte,
    spaltenImCluster: cluster,
  }));
}
