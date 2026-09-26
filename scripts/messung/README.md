# Messläufe — die Aufträge, nicht die Ergebnisse

Zwei Messungen wurden am 21.09.2026 formuliert und beim Abbruch der Sitzung
gestoppt, bevor sie Ergebnisse lieferten. **Die Aufträge selbst sind die
Arbeit** — sie zu formulieren hat gekostet, sie auszuführen ist billig. Deshalb
liegen sie hier im Repository und nicht nur in einer Sitzungsniederschrift, die
mit ihrem Container verschwindet.

| Datei | Was sie misst |
|---|---|
| `anlegewege-r1.js` | Vier fehlende Anlegewege (V-002 Revier, V-003 Bauprojekt, V-004 Veranstaltung, V-017 Kunde ändern): Tabelle, Pflichtfelder, Enums, Constraints, Trigger, RLS, Rechte — und in der zweiten Stufe die **Fehlerkette, die ein Insert an der echten Datenbank wirklich wirft** |
| `abgleich-masterspec.js` | Die 33 Abschnitte der Master-Spezifikation gegen den gemessenen Bestand, mit Gegenprobe auf **Erreichbarkeit** und **Schreibweg** |

**Warum die zweite Stufe die wichtigere ist.** Beim Objekt-Weg kosteten fünf
Fallen je einen Anlauf, und **keine davon stand im Migrationstext** — sie waren
nur an der laufenden Datenbank sichtbar: `einsatz_quelle` kennt `manuell` statt
`serie`; `beginn_lokal` ist `NOT NULL`, obwohl `beginn_zeitpunkt` gesetzt war;
`einsatz_akteur_stimmig` verlangt `'system'`, wo kein Benutzer in der Sitzung
steht; `einsatz_folgetag` schlug zu, weil die Testschicht über Mitternacht lief;
ein Trigger verlangte einen Kunden am Objekt **oder** an der Schicht. Ein
Messlauf, der den Insert wirklich versucht und zurückrollt, findet so etwas in
einem Durchgang statt in sechs.

Beide Skripte sind für das `Workflow`-Werkzeug geschrieben und lesen nur — sie
ändern keine Datei und rollen jede Transaktion zurück.
