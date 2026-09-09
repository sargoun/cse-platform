# Lighthouse-Budget (PUB-09, PUB-10, LEG-07)

`lighthouserc.json` ist ein **Budget**, keine Momentaufnahme. Es faellt, sobald
eine Seite schlechter wird — das ist der ganze Zweck:

| Kategorie | Schwelle | Warum |
|---|---|---|
| accessibility | **1,00** | BFSG. Ein Punkt weniger ist ein gefundener Verstoss, und ein gefundener Verstoss ist einer zu viel. |
| performance | **0,90** mobil | PUB-10. Gemessen wird das Telefon im Mobilfunknetz, weil dort jemand auf der Baustelle eine Adresse sucht — nicht der Schreibtisch mit Glasfaser. |
| seo | 0,90 | Titel, Beschreibung, `canonical`, Crawlbarkeit. |
| best-practices | 0,90 (Warnung) | Zeigt an, nicht blockiert: die Regeln aendern sich mit jeder Lighthouse-Version, und ein rotes CI durch ein Versionsupdate wird abgeschaltet statt behoben. |

Gemessen werden `/` und `/reinigung` — die Startseite und **ein** Profil. Nicht
alle vier: sie teilen sich Shell, Bilder und Datenpfad, und drei weitere Laeufe
kosten CI-Zeit ohne neue Aussage. Faellt `/reinigung`, faellt die Ursache in der
Regel bei allen an.

Drei Laeufe je Adresse (`numberOfRuns: 3`), weil eine einzelne Messung auf einem
geteilten CI-Runner um mehrere Punkte schwankt und ein Budget, das zufaellig
faellt, nach zwei Wochen ignoriert wird.

## Lokal

```bash
pnpm db:test:up && pnpm db:seed && pnpm content:import
pnpm build
pnpm exec lhci autorun
```

`lhci` startet den Server selbst nicht — er erwartet ihn unter
`http://localhost:3000`. Ohne laufende Datenbank liefert jede oeffentliche
Seite einen Fehler, und Lighthouse misst dann eine Fehlerseite mit
ausgezeichneten Werten.
