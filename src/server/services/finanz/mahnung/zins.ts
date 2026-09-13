import { cent, type Cent } from '../geld.js';

/**
 * Verzugszinsen — §288 BGB, und die Tageszählung, die niemand für
 * selbstverständlich halten darf.
 *
 * **Drei Konventionen, drei Beträge.** `act/365`, `act/360` und `act/act`
 * ergeben auf dieselbe Forderung verschiedene Zinsen; welche gilt, ist eine
 * kaufmännische Wahl und keine Rechenregel. Sie steht deshalb auf jeder
 * `mahnung_position` — nicht als Einstellung daneben, sondern auf der Zeile:
 * ein Anspruch muss reproduzierbar bleiben, auch wenn die Einstellung sich
 * später ändert.
 *
 * **Gerundet wird EINMAL, ganz am Ende.** Bei `act/act` läuft ein Zeitraum
 * über zwei Jahre mit verschiedenen Nennern (365 und 366). Jeden Teil einzeln
 * zu runden verschiebt den Betrag um bis zu einen Cent je Jahresgrenze — und
 * eine Zinsforderung, die sich nicht nachrechnen lässt, ist eine, die der
 * Empfänger bestreitet. Gerechnet wird deshalb über einen gemeinsamen Nenner
 * in `bigint`, und die einzige Rundung ist die letzte.
 *
 * **Was hier NICHT entschieden wird:** ob überhaupt Zinsen erhoben werden und
 * ab wann der Verzug läuft. Das erste ist O-19, das zweite §286 BGB und
 * ebenfalls offen — beides steht in `stufen.platzhalter.ts` und auf der
 * Position, nicht in dieser Funktion. Sie rechnet, wenn man ihr sagt, was.
 */

export type ZinsMethode = 'act_365' | 'act_360' | 'act_act';

export class ZinsFehler extends Error {
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'ZinsFehler';
  }
}

/** `365 · 366` — beide Jahreslängen sind teilerfremd, also ihr kgV. */
const GEMEINSAM = 365n * 366n;

function istSchaltjahr(jahr: number): boolean {
  return (jahr % 4 === 0 && jahr % 100 !== 0) || jahr % 400 === 0;
}

/**
 * `YYYY-MM-DD` → Tage seit der Epoche, ohne Zeitzone und ohne Sommerzeit.
 *
 * **Die Form allein genuegt nicht.** `2026-02-30` hat die richtige Form, und
 * `Date.UTC` normalisiert es klaglos auf den 2. Maerz. Aus einem unmoeglichen
 * Datum wird so ein moegliches, und die Verzugstage stehen auf einem anderen
 * Zeitraum als dem, den jemand eingegeben hat — ohne Fehler, ohne Meldung,
 * und der Zinsbetrag auf der Mahnung ist um zwei Tage daneben.
 *
 * Deshalb der Rueckvergleich: was `Date.UTC` gebaut hat, muss Jahr, Monat und
 * Tag der Eingabe tragen. Er kostet drei Vergleiche und faengt jeden
 * 31. Februar, jeden 31. April und jeden 29. Februar eines Nicht-Schaltjahres.
 */
function alsTag(datum: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(datum)) {
    throw new ZinsFehler(`Kein Datum in der Form YYYY-MM-DD: ${JSON.stringify(datum)}`);
  }
  const jahr = Number(datum.slice(0, 4));
  const monat = Number(datum.slice(5, 7));
  const tag = Number(datum.slice(8, 10));
  const wert = Date.UTC(jahr, monat - 1, tag);
  const gebaut = new Date(wert);
  if (gebaut.getUTCFullYear() !== jahr
      || gebaut.getUTCMonth() + 1 !== monat
      || gebaut.getUTCDate() !== tag) {
    throw new ZinsFehler(
      `Diesen Tag gibt es nicht: ${JSON.stringify(datum)}. `
      + 'Ein normalisiertes Datum verschoebe die Verzugstage still.',
    );
  }
  return Math.round(wert / 86_400_000);
}

/**
 * Die Verzugstage: `bis − von`, beide als Kalendertag.
 *
 * **UTC-Mitternacht und nicht die lokale Zeit** (Invariante 2): eine
 * Differenz zweier Kalendertage darf nicht davon abhängen, ob dazwischen die
 * Sommerzeit umgestellt wurde. Der Zeitzonenwechsel gehört zur ANZEIGE, nicht
 * zur Tageszählung.
 */
export function verzugstage(von: string, bis: string): number {
  const tage = alsTag(bis) - alsTag(von);
  return tage > 0 ? tage : 0;
}

export interface ZinsEingabe {
  readonly betragCent: Cent;
  /** Basiszins + gesetzlicher Aufschlag, in Basispunkten. `900` sind 9,00 %. */
  readonly zinsBp: number;
  /** Erster Tag des Verzugs, `YYYY-MM-DD`. */
  readonly von: string;
  /** Stichtag der Berechnung, `YYYY-MM-DD`. */
  readonly bis: string;
  readonly methode: ZinsMethode;
}

/**
 * Der Zähler über dem gemeinsamen Nenner `365 · 366`.
 *
 * `act/365` und `act/360` sind ein Bruch mit festem Nenner; `act/act` zerlegt
 * den Zeitraum in Kalenderjahre und zählt jedes mit seiner eigenen Länge.
 */
function zaehler(von: string, bis: string, methode: ZinsMethode): bigint {
  const tage = BigInt(verzugstage(von, bis));
  if (methode === 'act_365') return tage * (GEMEINSAM / 365n);
  if (methode === 'act_360') return (tage * GEMEINSAM) / 360n;

  let summe = 0n;
  let anfang = alsTag(von);
  const ende = alsTag(bis);
  while (anfang < ende) {
    const jahr = new Date(anfang * 86_400_000).getUTCFullYear();
    const jahresEnde = alsTag(`${String(jahr + 1)}-01-01`);
    const stueck = BigInt(Math.min(ende, jahresEnde) - anfang);
    summe += stueck * (GEMEINSAM / BigInt(istSchaltjahr(jahr) ? 366 : 365));
    anfang = Math.min(ende, jahresEnde);
  }
  return summe;
}

/** Half-up auf einen nicht-negativen Wert. */
function rundeHalbAuf(zaehlerWert: bigint, nenner: bigint): bigint {
  return (zaehlerWert * 2n + nenner) / (nenner * 2n);
}

/**
 * Der Zins in Cent — half-up, und die Rundungsregel steht hier, weil hier
 * gerundet wird (K-16).
 */
export function berechneVerzugszins(eingabe: ZinsEingabe): Cent {
  if (eingabe.betragCent < 0n) {
    throw new ZinsFehler('Auf eine negative Forderung fällt kein Verzugszins an.');
  }
  if (!Number.isInteger(eingabe.zinsBp) || eingabe.zinsBp < 0) {
    throw new ZinsFehler(`Zinssatz in Basispunkten, ganzzahlig und nicht negativ: ${eingabe.zinsBp}`);
  }
  const z = zaehler(eingabe.von, eingabe.bis, eingabe.methode);
  if (z === 0n || eingabe.zinsBp === 0) return cent(0n);

  return cent(rundeHalbAuf(
    eingabe.betragCent * BigInt(eingabe.zinsBp) * z,
    10_000n * GEMEINSAM));
}
