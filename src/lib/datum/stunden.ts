/**
 * Minuten als Stundenangabe — EINE Umsetzung, überall dieselbe.
 *
 * Die Zeile stand vorher dreimal im Baum (Wochenraster, Konfliktliste,
 * Serienliste), und drei Umsetzungen derselben Rundung sind zwei zu viel:
 * sobald eine davon `toFixed(1)` schreibt, zeigen zwei Bildschirme
 * verschiedene Zahlen für dieselbe Schicht, und der Unterschied fällt
 * niemandem auf, weil beide plausibel aussehen.
 *
 * **Deutsches Zahlenformat** (DESIGN §12): Komma als Dezimaltrenner. Zwei
 * Nachkommastellen, weil eine Viertelstunde sonst als „7,3 h" erschiene und
 * damit falsch gerundet aussähe.
 *
 * Die Dauer selbst wird hier NICHT gerechnet — sie kommt als Minutenzahl
 * herein, gemessen als Abstand zweier Instants (Invariante 2). Diese Funktion
 * formatiert nur.
 */
export function stundenAusMinuten(minuten: number): string {
  return `${(minuten / 60).toFixed(2).replace('.', ',')} h`;
}

/**
 * Dieselbe Dauer als `H:MM` — für Zeilen, in denen die Minute zählt.
 *
 * `7,50 h` und `7:30 h` sind dieselbe Dauer; die erste Form addiert sich im
 * Kopf, die zweite vergleicht sich mit der Stechuhr. Beide stehen deshalb
 * hier, damit keine Seite sich eine dritte ausdenkt.
 *
 * Negative Werte gibt es nicht: eine Dauer ist der Abstand zweier Instants in
 * dieser Reihenfolge. Käme doch einer herein, stünde das Minus vorn und die
 * Zahl bliebe lesbar — stiller Betrag wäre die schlechtere Antwort.
 */
export function stundenMinutenText(minuten: number): string {
  const zeichen = minuten < 0 ? '-' : '';
  const ganz = Math.abs(Math.trunc(minuten));
  const stunden = Math.floor(ganz / 60);
  const rest = ganz % 60;
  return `${zeichen}${String(stunden)}:${String(rest).padStart(2, '0')} h`;
}
