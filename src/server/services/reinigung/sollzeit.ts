/**
 * Die Sollzeit eines Reviers und seiner Räume (CLN-01, OPS-03, OPS-07,
 * K-16(c)).
 *
 * **Der ganze Zweck dieser Datei ist, dass zwischen zwei Trägern derselben
 * Größe nicht zweimal gerundet wird.** `revier.sollzeit_minuten` und
 * `revier_raum.sollzeit_minuten` sind beide `numeric(8,2)` — die eine
 * Abweichung, die K-16(c) dieser Domäne namentlich erlaubt. Der Grund steht in
 * der Konvention: über achtzig Räume summiert sich ein Rundungsfehler von je
 * einer halben Minute auf vierzig Minuten auf, und das ist ein Angebotspreis
 * daneben.
 *
 * **Die Rechnung selbst wird nicht hier erfunden.** Sie steht seit PR 25 in
 * `kalkulation/richtzeit.ts` und hat dort genau EINE benannte Rundungsstelle:
 * `sekundenJeDurchgang` rechnet `3600 s/h × Milli-m² ÷ Milli-m²/h` in ganze
 * Sekunden. Diese Datei ruft sie auf — sie rechnet nicht dasselbe noch einmal.
 * Zwei Umsetzungen derselben Formel sind zwei Preise für denselben Auftrag.
 *
 * **Und deshalb ist die Reihenfolge so und nicht anders:**
 *
 *  1. Die Räume werden nach BELAGSART gruppiert, weil PR 25 so gruppiert. Der
 *     Vergleich „stimmt mit der Kalkulation aus PR 25 für dieselben Räume
 *     überein" ist sonst keiner: drei Räume desselben Belags einzeln gerundet
 *     ergeben bis zu anderthalb Sekunden mehr als ihre Summe.
 *  2. Je Gruppe EINMAL `sekundenJeDurchgang` — das ist die eine Rundung.
 *  3. Die Summe wird EINMAL in Hundertstelminuten umgerechnet. Das ist die
 *     Speichergenauigkeit von `numeric(8,2)`, und mehr als einmal wird nicht
 *     umgerechnet.
 *  4. Die Räume bekommen ihre Anteile durch VERTEILUNG dieser Summe nach
 *     größtem Rest — nicht durch eine eigene Rundung. Damit gilt
 *     `Σ revier_raum.sollzeit_minuten = revier.sollzeit_minuten` exakt, und
 *     zwar konstruktiv und nicht nur meistens.
 *
 * Wer Schritt 4 durch „jeden Raum einzeln auf zwei Nachkommastellen runden"
 * ersetzt, bekommt eine Summe, die in der Regel um ein paar Hundertstel
 * danebenliegt — sichtbar erst, wenn jemand im Streitfall nachaddiert.
 */
import type { MilliMenge } from '../finanz/menge.js';
import {
  RichtzeitFehler, sekundenJeDurchgang, teileHalbAuf,
} from '../kalkulation/richtzeit.js';

export class SollzeitFehler extends Error {
  constructor(nachricht: string, readonly grund: 'ohne_leistungswert' | 'leer' | 'negativ') {
    super(nachricht);
    this.name = 'SollzeitFehler';
  }
}

/** Ein Raum des Reviers, so wie ihn die Kalkulation sieht. */
export interface RaumEingabe {
  readonly raumId: string;
  /** Die Belagsart — der Schlüssel, nach dem PR 25 gruppiert. */
  readonly belagsartId: string;
  readonly belagsartBezeichnung: string;
  /** Bodenfläche in Milli-m². */
  readonly flaeche: MilliMenge;
  /** Leistungswert der Belagsart in Milli-m² je Stunde. */
  readonly leistungswert: MilliMenge;
  /** Glasfläche in Milli-m², als Schnappschuss übernommen (CLN-05). */
  readonly fensterFlaeche?: MilliMenge | null;
  /** Die Laufreihenfolge — auch der Gleichstandsbrecher der Verteilung. */
  readonly reihenfolge: number;
}

/** Was für EINEN Raum in `revier_raum` geschrieben wird. */
export interface RaumSollzeit {
  readonly raumId: string;
  /** Hundertstelminuten. Die Speichereinheit, nicht die Anzeigeeinheit. */
  readonly hundertstelMinuten: bigint;
  /** Dieselbe Zahl als Dezimalzeichenkette für `numeric(8,2)`. */
  readonly sollzeitMinuten: string;
}

export interface RevierSollzeit {
  /** Die Summe in Hundertstelminuten — die Größe, über die verteilt wurde. */
  readonly hundertstelMinuten: bigint;
  readonly sollzeitMinuten: string;
  /**
   * Dieselbe Zeit in ganzen Sekunden, wie PR 25 sie liefert.
   *
   * Sie steht mit im Ergebnis, damit der Abgleich gegen die Kalkulation eine
   * Gleichheit zweier Zahlen ist und keine Umrechnung im Test — eine
   * Umrechnung im Test prüft den Test.
   */
  readonly sekunden: bigint;
  readonly raeume: readonly RaumSollzeit[];
}

/** Hundertstelminuten als Dezimaltext, wie `numeric(8,2)` ihn liest. */
export function alsMinutenText(hundertstel: bigint): string {
  const negativ = hundertstel < 0n;
  const abs = negativ ? -hundertstel : hundertstel;
  return `${negativ ? '-' : ''}${String(abs / 100n)}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Dieselbe Größe in DEUTSCHER Anzeige, mit Komma (DESIGN §5 „Tables"). */
export function formatiereMinuten(hundertstel: bigint): string {
  return alsMinutenText(hundertstel).replace('.', ',');
}

/** Sekunden → Hundertstelminuten, kaufmännisch, GENAU EINMAL angewandt. */
export function hundertstelAusSekunden(sekunden: bigint): bigint {
  return teileHalbAuf(sekunden * 100n, 60n);
}

/**
 * Die Sollzeit eines Reviers und die Anteile seiner Räume.
 *
 * Ein Revier ohne Räume wirft nicht — es hat eine Sollzeit von null und keine
 * Räume. Das ist der Zustand direkt nach dem Anlegen einer Zone, und ein
 * Fehler dafür machte den Normalfall zur Ausnahme. Was wirft, ist ein Raum
 * ohne Leistungswert: daraus entstünde eine unendliche oder eine
 * verschwundene Zeit, und beides wäre ein Preis, den niemand gesetzt hat
 * (O-17).
 */
export function berechneRevierSollzeit(raeume: readonly RaumEingabe[]): RevierSollzeit {
  if (raeume.length === 0) {
    return { hundertstelMinuten: 0n, sollzeitMinuten: '0.00', sekunden: 0n, raeume: [] };
  }

  /**
   * Schritt 1 — gruppieren wie PR 25 gruppiert.
   *
   * `Map` und nicht ein Objektliteral: die Belagsart-id ist eine UUID, und
   * `Object.keys` gäbe sie in einer Reihenfolge zurück, die die Sprache
   * festlegt und nicht wir. Die Verteilung unten muss aber deterministisch
   * sein.
   */
  const gruppen = new Map<string, { posten: RaumEingabe[]; flaeche: bigint }>();
  for (const r of raeume) {
    if (r.flaeche < 0n) {
      throw new SollzeitFehler(`Raum ${r.raumId}: negative Fläche.`, 'negativ');
    }
    if (r.leistungswert <= 0n) {
      throw new SollzeitFehler(
        `Raum ${r.raumId} (${r.belagsartBezeichnung}): kein Leistungswert hinterlegt. `
        + 'Ohne ihn gibt es keine Sollzeit (O-17).',
        'ohne_leistungswert',
      );
    }
    const g = gruppen.get(r.belagsartId) ?? { posten: [], flaeche: 0n };
    g.posten.push(r);
    g.flaeche += r.flaeche;
    gruppen.set(r.belagsartId, g);
  }

  /**
   * Schritt 2 — je Gruppe EINMAL die PR-25-Funktion. Das ist die einzige
   * Rundung des ganzen Wegs.
   */
  let sekunden = 0n;
  for (const [, g] of gruppen) {
    const erster = g.posten[0]!;
    try {
      sekunden += sekundenJeDurchgang({
        belagsartId: erster.belagsartId,
        bezeichnung: erster.belagsartBezeichnung,
        flaeche: g.flaeche as MilliMenge,
        leistungswert: erster.leistungswert,
      });
    } catch (fehler: unknown) {
      if (fehler instanceof RichtzeitFehler) {
        throw new SollzeitFehler(fehler.message, 'ohne_leistungswert');
      }
      throw fehler;
    }
  }

  // Schritt 3 — EINE Umrechnung in die Speichereinheit.
  const gesamt = hundertstelAusSekunden(sekunden);

  /**
   * Schritt 4 — verteilen statt runden.
   *
   * Der Rohanteil eines Raums ist `6000 × Fläche ÷ Leistungswert`
   * Hundertstelminuten; die Tausendstel in Zähler und Nenner kürzen sich weg,
   * wie in PR 25. Genommen wird der GANZZAHLIGE Anteil, verteilt wird die
   * Differenz zur Kopfsumme nach größtem Rest.
   *
   * Verglichen werden die Reste als Brüche `rest_a / lw_a` gegen
   * `rest_b / lw_b` — über Kreuz multipliziert, damit nirgends eine
   * Gleitkommazahl entsteht. Bei Gleichstand entscheidet die Laufreihenfolge
   * und danach die Raum-id: eine Verteilung, die bei gleichen Räumen von der
   * Eingabereihenfolge abhinge, gäbe für dieselbe Zone zwei Ergebnisse.
   */
  const anteile = raeume.map((r) => {
    const zaehler = 6000n * r.flaeche;
    return {
      raum: r,
      ganz: zaehler / r.leistungswert,
      rest: zaehler % r.leistungswert,
      nenner: r.leistungswert as bigint,
    };
  });

  const basis = anteile.reduce((s, a) => s + a.ganz, 0n);
  let uebrig = gesamt - basis;

  const reihenfolge = [...anteile].sort((a, b) => {
    // rest_a / nenner_a  gegen  rest_b / nenner_b, ohne Division.
    const links = a.rest * b.nenner;
    const rechts = b.rest * a.nenner;
    if (links !== rechts) return links > rechts ? -1 : 1;
    if (a.raum.reihenfolge !== b.raum.reihenfolge) return a.raum.reihenfolge - b.raum.reihenfolge;
    return a.raum.raumId.localeCompare(b.raum.raumId);
  });

  const zuschlag = new Map<string, bigint>();
  /**
   * `uebrig` ist normalerweise kleiner als die Anzahl der Räume — es ist die
   * Summe der abgeschnittenen Nachkommateile plus die eine Rundung aus
   * Schritt 3. Die Schleife läuft trotzdem so lange, bis nichts mehr übrig
   * ist: bei negativem `uebrig` (die Kopfrundung ging nach unten) wird
   * abgezogen statt aufgeschlagen, und zwar von hinten — beim kleinsten Rest.
   */
  let i = 0;
  while (uebrig > 0n && reihenfolge.length > 0) {
    const a = reihenfolge[i % reihenfolge.length]!;
    zuschlag.set(a.raum.raumId, (zuschlag.get(a.raum.raumId) ?? 0n) + 1n);
    uebrig -= 1n;
    i += 1;
  }
  i = 0;
  while (uebrig < 0n && reihenfolge.length > 0) {
    const a = reihenfolge[reihenfolge.length - 1 - (i % reihenfolge.length)]!;
    zuschlag.set(a.raum.raumId, (zuschlag.get(a.raum.raumId) ?? 0n) - 1n);
    uebrig += 1n;
    i += 1;
  }

  const ergebnis = anteile.map((a) => {
    const h = a.ganz + (zuschlag.get(a.raum.raumId) ?? 0n);
    return {
      raumId: a.raum.raumId,
      hundertstelMinuten: h,
      sollzeitMinuten: alsMinutenText(h),
    };
  });

  return {
    hundertstelMinuten: gesamt,
    sollzeitMinuten: alsMinutenText(gesamt),
    sekunden,
    raeume: ergebnis,
  };
}

/**
 * Die Gegenprobe, die der Abnahme zugrunde liegt: Σ Räume = Kopf.
 *
 * Sie steht als FUNKTION da und nicht nur als Testzeile, weil der Dienst sie
 * vor dem Schreiben selbst aufruft. Eine Zusage, die nur ein Test prüft, gilt
 * für die Daten, die der Test kennt.
 */
export function summeDerRaeume(zeit: RevierSollzeit): bigint {
  return zeit.raeume.reduce((s, r) => s + r.hundertstelMinuten, 0n);
}
