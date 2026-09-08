/**
 * VAT — invariant 1: computed per tax-rate group, never from a gross total.
 *
 * The catalogue is `steuersatz_gruppe` and it is the only one: there is no
 * `steuersatz` table, no `steuersatz_id`, no `prozent_bp` and no `hinweistext`
 * anywhere in this platform (K-21, `02-datenmodell/05-FINANZEN.md` §0.1).
 *
 * The rate that applies is the one in force **at the service date**, so a
 * group is a dated row and this function takes the resolved row rather than a
 * constant. `1900 = 19,00 %` appears in tests as an illustration of the unit,
 * never as a default in code.
 */
import {
  type BasisPunkte,
  type Cent,
  addiere,
  anteilInBasisPunkten,
} from '../geld.js';

/** One row of `steuersatz_gruppe`, resolved at the service date. */
export interface SteuersatzGruppe {
  /** The stable key of the group, e.g. `regelsatz` or `ermaessigt`. */
  readonly schluessel: string;
  /** The rate in basis points. `1900` is 19,00 %. */
  readonly satzBp: BasisPunkte;
  /** `regelsatz · ermaessigt · steuerfrei · reverse_charge_13b`. */
  readonly kategorie: string;
  /** BT-121, only where the category is an exemption. */
  readonly befreiungsgrundCode: string | null;
  /** BT-120. */
  readonly befreiungsgrundText: string | null;
}

/** One net line entering the VAT computation. */
export interface SteuerZeile {
  readonly nettoCent: Cent;
  readonly gruppe: SteuersatzGruppe;
}

/** One `steuerzeilen[]` entry of the canonical payload (`05-FINANZEN.md` §5.3). */
export interface SteuerSumme {
  readonly steuersatzGruppe: string;
  readonly kategorie: string;
  readonly satzBp: BasisPunkte;
  readonly nettoCent: Cent;
  readonly steuerCent: Cent;
  readonly befreiungsgrundCode: string | null;
  readonly befreiungsgrundText: string | null;
}

export interface SteuerErgebnis {
  readonly zeilen: readonly SteuerSumme[];
  readonly nettoGesamtCent: Cent;
  readonly steuerGesamtCent: Cent;
  readonly bruttoCent: Cent;
}

export class SteuerFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SteuerFehler';
  }
}

/**
 * VAT per tax-rate group.
 *
 * The net amounts of a group are summed **first**, and the rate is applied once
 * to that sum. Rounding each line and adding the results drifts by a cent per
 * line against the figure a tax office recomputes, and on a cleaning invoice
 * with two hundred lines that is a visible discrepancy on a document that must
 * be immutable once finalised.
 *
 * Groups come out in a deterministic order — by `schluessel` — because the
 * result is part of the canonical payload and therefore part of the hash
 * (K-12); an array whose order depended on input order would produce a
 * different digest for the same invoice.
 */
export function berechneSteuer(zeilen: readonly SteuerZeile[]): SteuerErgebnis {
  const proGruppe = new Map<string, { gruppe: SteuersatzGruppe; netto: Cent }>();

  for (const zeile of zeilen) {
    const vorhanden = proGruppe.get(zeile.gruppe.schluessel);
    if (vorhanden === undefined) {
      proGruppe.set(zeile.gruppe.schluessel, {
        gruppe: zeile.gruppe,
        netto: zeile.nettoCent,
      });
      continue;
    }
    if (vorhanden.gruppe.satzBp !== zeile.gruppe.satzBp) {
      throw new SteuerFehler(
        `Gruppe ${zeile.gruppe.schluessel} tritt mit zwei Sätzen auf ` +
          `(${vorhanden.gruppe.satzBp} und ${zeile.gruppe.satzBp}) — ` +
          'der Satz wird am Leistungsdatum aufgelöst, nicht je Zeile',
      );
    }
    vorhanden.netto = addiere(vorhanden.netto, zeile.nettoCent);
  }

  const sortiert = [...proGruppe.values()].sort((a, b) =>
    a.gruppe.schluessel < b.gruppe.schluessel ? -1 : a.gruppe.schluessel > b.gruppe.schluessel ? 1 : 0,
  );

  const summen: SteuerSumme[] = sortiert.map(({ gruppe, netto }) => ({
    steuersatzGruppe: gruppe.schluessel,
    kategorie: gruppe.kategorie,
    satzBp: gruppe.satzBp,
    nettoCent: netto,
    steuerCent: anteilInBasisPunkten(netto, gruppe.satzBp),
    befreiungsgrundCode: gruppe.befreiungsgrundCode,
    befreiungsgrundText: gruppe.befreiungsgrundText,
  }));

  const nettoGesamt = addiere(...summen.map((s) => s.nettoCent));
  const steuerGesamt = addiere(...summen.map((s) => s.steuerCent));

  return {
    zeilen: summen,
    nettoGesamtCent: nettoGesamt,
    steuerGesamtCent: steuerGesamt,
    bruttoCent: addiere(nettoGesamt, steuerGesamt),
  };
}
