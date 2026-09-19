# Die Verwaltung zweisprachig machen

**Stand: 19.09.2026.** Werkbank, kein Archiv — wie `routenbau/`. Was hier steht,
gehört in den Baum und verschwindet, sobald es dort ist.

## Der Befund

Der Mandant hat die Sprache auf Englisch gestellt. Die **Seitenleiste** wurde
englisch (Overview, CRM, Sites, Schedule, Time, Staff…), der **Seiteninhalt** blieb
deutsch (Zahlungen, Offene Forderungen, Zahlungseingang erfassen, Betrag in Euro,
Buchungstag, Überweisung).

Das ist kein Gestaltungsfehler und keine halbe Übersetzung — es ist eine halbe
**Umsetzung**, und sie ist gemessen:

| Fläche | Seiten | mit Übersetzungsform |
|---|---|---|
| `portal/[mandant]` (Verwaltung) | 309 | **0** |
| `portal/kunde` (Kundenportal) | 20 | **0** |
| `portal/gruppe` (Gruppenansicht) | 26 | **0** |
| `portal/konto` | 4 | **0** |
| `portal/mein` (Arbeiterportal) | 27 | **26** ✓ |

Die Navigation läuft über `INTERN_BESCHRIFTUNGEN` (je Schlüssel zwei Sprachen) —
deshalb schaltet sie um. Die **Seitenrümpfe tragen ihre deutschen Zeichenketten fest
verdrahtet**, deshalb tun sie es nicht.

## Das Vorbild steht schon im Baum

`portal/mein` ist zu 26 von 27 fertig und in **vier** Sprachen (de/en/ar/tr, SPEC §10).
Die Bauart: `meinTexte(sprache)` liefert ein `MeinTexte`-Objekt, der Rahmen reicht es
als `basis.texte` durch, die Seite schreibt `t.nachrichten` statt `"Nachrichten"`. Die
Sprache kommt aus `person.sprache`, nicht aus dem Pfad.

**Diese Bauart wird nicht neu erfunden, sondern auf die Verwaltung ausgedehnt.**

## Die Reihenfolge — und warum sie so ist

1. **Die Form** — ein `verwaltungTexte(sprache)` nach dem Muster von `meinTexte`,
   durchgereicht von `PortalRahmen` als `basis.texte`. Ohne sie ist jede Seite eine
   Einzelentscheidung.
2. **Die Sperrklinke** — eine Wache `seite-ohne-uebersetzung`, die jede `page.tsx`
   unter `portal/` mit deutschen Zeichenketten meldet, mit einer **eingefrorenen
   Ausnahmeliste der heute 359 Seiten**. Die Liste darf **schrumpfen, nie wachsen**.
   Das ist der Punkt, an dem die Arbeit unumkehrbar wird: ab hier kann keine neue
   Seite mehr auf Deutsch festgenagelt werden, auch wenn die Umstellung Monate dauert.
3. **Domäne für Domäne umstellen.** Je Domäne: Texte in die Textdatei, Seiten auf
   `t.…` umstellen, Eintrag aus der Ausnahmeliste streichen, volle Kette fahren,
   committen. Eine fertige Domäne ist fertig; eine halbe ist keine.

**Warum die Sperrklinke VOR der Umstellung kommt:** die Umstellung dauert länger als
eine Sitzung. Ohne sie wächst die Liste während der Arbeit weiter, und der Rückstand
wird nie kleiner.

## Die Reihenfolge der Domänen

Nach Nutzung, nicht nach Grösse — was ein Mensch am häufigsten sieht, zuerst:

1. `finanzen` (Rechnungen, Zahlungen, Mahnungen) — die Fläche aus dem Bildschirmfoto
2. `crm` · `angebote` · `auftraege`
3. `dienstplan` · `zeiten` · `personal`
4. `portal/kunde` — der AUFTRAGGEBER sieht sie; ein halb deutscher Kundenbildschirm
   ist ein Eindruck, den man nicht zurücknimmt
5. `portal/gruppe` · `portal/konto`
6. der Rest von `[mandant]`

## Was dabei nicht verloren gehen darf

- **Die Fachbegriffe bleiben deutsch, auch im englischen Text.** `Mandant`,
  `Anstellung`, `Leistungsnachweis`, `Wachbuch`, `Aufmass`, `Nachtrag` tragen
  Rechtsbedeutung (VOB, GoBD, UStG, GewO). Englisch ist die Übersetzung der
  **Oberfläche**, nicht der Begriffe. Wo ein Begriff stehen bleibt, gehört eine
  Erklärung daneben — nicht eine erfundene Entsprechung.
- **Zahlen, Daten und Beträge folgen weiter `Europe/Berlin` und der deutschen
  Schreibweise**, wo sie rechtlich gelten (Rechnung, Nachweis). Die Sprache der
  Oberfläche ändert die Formatierung eines Rechnungsbetrags nicht.
- **Arabisch und Türkisch sind mehr als Wörter.** Beide laufen von rechts nach links;
  das betrifft Abstände, Pfeile, Tabellenausrichtung und die Seitenleiste. Solange die
  Verwaltung zweisprachig bleibt (de/en), stellt sich die Frage nicht — sobald sie es
  nicht mehr ist, gehört RTL in DESIGN.md, bevor eine Zeile davon gebaut wird.
  Siehe `docs/DESIGN-PLAN.md` §5.2 und die offene Frage dort.
