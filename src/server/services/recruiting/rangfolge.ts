/**
 * Die Rangfolge — und warum sie ein VORSCHLAG ist (REC-05, REC-08, LEG-12).
 *
 * **Die Zahl rechnet diese Datei, nie ein Modell.** Invariante 6 sagt es für
 * Geld, Mengen und Fristen; hier geht es um etwas, das genauso wenig geraten
 * werden darf: die Reihenfolge, in der Menschen einer Einladung näherkommen.
 * Ein Modell darf ein Kriterium VORSCHLAGEN und einen Satz dazu schreiben —
 * die Punkte zusammenzuzählen ist Arithmetik, und Arithmetik gehört in eine
 * geprüfte Funktion.
 *
 * **Und eine Rangfolge ist keine Entscheidung.** Art. 22 DSGVO verbietet eine
 * Entscheidung, die ausschliesslich auf automatisierter Verarbeitung beruht
 * und rechtliche Wirkung entfaltet — eine Absage ist genau das. Deshalb gibt
 * diese Datei eine Liste mit Gründen zurück und niemals ein Urteil; der Riegel
 * dazu steht in `0166` (`entscheidung_ist_menschlich`).
 *
 * **Jedes Kriterium trägt seinen Satz mit.** Eine Gesamtpunktzahl ohne die
 * Zeilen, aus denen sie entsteht, ist keine Begründung, sondern eine Zahl, der
 * man glauben soll. Wer eine Absage erklären muss — und im Streit nach dem AGG
 * muss man das —, braucht die Zeilen.
 */

export interface Kriterium {
  /** Im Klartext, denn genau so steht es später auf dem Bildschirm. */
  readonly kriterium: string;
  /** 0…100. Die Gewichte einer Bewerbung müssen sich nicht zu 100 summieren. */
  readonly gewicht: number;
  /** 0…10. */
  readonly punkte: number;
  readonly begruendung: string;
}

export class BewertungFehler extends Error {
  readonly code = 'unbrauchbare_bewertung';
  readonly status = 400;
  constructor(meldung: string) {
    super(meldung);
    this.name = 'BewertungFehler';
  }
}

/**
 * Die gewichtete Punktzahl in ZEHNTELN eines Punktes — eine ganze Zahl.
 *
 * **Warum Zehntel und kein `number` mit Nachkomma.** Dieselbe Überlegung wie
 * bei Geld (Invariante 1): eine Gleitkommazahl, die zwischen zwei Bewerbungen
 * um `0.30000000000000004` abweicht, erzeugt eine Reihenfolge, die niemand
 * erklären kann. Gerundet wird EINMAL, hier, kaufmännisch.
 *
 * `0` Gesamtgewicht ergibt `0` und keinen Fehler: eine Bewerbung ohne
 * gewichtetes Kriterium ist unbewertet, nicht schlecht bewertet. Der
 * Unterschied steht auf dem Bildschirm.
 */
export function punktzahlZehntel(kriterien: readonly Kriterium[]): number {
  let summeGewicht = 0;
  let summeProdukt = 0;
  for (const k of kriterien) {
    if (!Number.isInteger(k.gewicht) || k.gewicht < 0 || k.gewicht > 100) {
      throw new BewertungFehler(
        `Gewicht ${String(k.gewicht)} liegt ausserhalb von 0…100 (${k.kriterium}).`);
    }
    if (!Number.isInteger(k.punkte) || k.punkte < 0 || k.punkte > 10) {
      throw new BewertungFehler(
        `Punkte ${String(k.punkte)} liegen ausserhalb von 0…10 (${k.kriterium}).`);
    }
    if (k.begruendung.trim() === '') {
      throw new BewertungFehler(
        `Das Kriterium „${k.kriterium}" hat keine Begründung — eine Zahl ohne Grund `
        + 'ist im AGG-Streit nichts wert.');
    }
    summeGewicht += k.gewicht;
    summeProdukt += k.gewicht * k.punkte;
  }
  if (summeGewicht === 0) return 0;
  /*
   * `* 10` fuer die Zehntel, dann kaufmaennisch runden. `Math.round` rundet
   * bei exakt .5 zur groesseren Zahl — was bei Punkten die richtige Richtung
   * ist: im Zweifel fuer die Einladung.
   */
  return Math.round((summeProdukt * 10) / summeGewicht);
}

/** `73` → `7,3` — für den Bildschirm, mit deutschem Komma. */
export function punkteText(zehntel: number): string {
  const ganz = Math.trunc(zehntel / 10);
  const rest = Math.abs(zehntel % 10);
  return `${String(ganz)},${String(rest)}`;
}

export interface Rangzeile<T> {
  readonly eintrag: T;
  readonly punktzahlZehntel: number;
  readonly kriterien: readonly Kriterium[];
  /** 1-basiert. Gleiche Punktzahl heisst gleicher Rang (1, 2, 2, 4). */
  readonly rang: number;
}

/**
 * Sortiert absteigend nach Punktzahl und vergibt Ränge.
 *
 * **Gleichstand bekommt denselben Rang**, und der nächste Rang überspringt
 * entsprechend (1, 2, 2, 4). Zwei Bewerbungen mit derselben Punktzahl
 * künstlich zu trennen hiesse, eine Reihenfolge zu erfinden, die die
 * Kriterien nicht hergeben — und genau die müsste man im Streit erklären.
 *
 * Die Sortierung ist STABIL: bei Gleichstand bleibt die Reihenfolge des
 * Eingangs erhalten. `Array.prototype.sort` sichert das seit ES2019 zu, und
 * der Eingang ist die einzige Ordnung, die hier nichts behauptet.
 */
export function rangfolge<T>(
  zeilen: readonly { readonly eintrag: T; readonly kriterien: readonly Kriterium[] }[],
): readonly Rangzeile<T>[] {
  const bewertet = zeilen.map((z) => ({
    eintrag: z.eintrag,
    kriterien: z.kriterien,
    punktzahlZehntel: punktzahlZehntel(z.kriterien),
  }));
  const sortiert = [...bewertet].sort((a, b) => b.punktzahlZehntel - a.punktzahlZehntel);

  const mitRang: Rangzeile<T>[] = [];
  let letzte: number | null = null;
  let letzterRang = 0;
  for (const [i, z] of sortiert.entries()) {
    const rang = letzte !== null && z.punktzahlZehntel === letzte ? letzterRang : i + 1;
    letzte = z.punktzahlZehntel;
    letzterRang = rang;
    mitRang.push({ ...z, rang });
  }
  return mitRang;
}
