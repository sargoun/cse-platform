# Was wir angenommen haben — und was Sie entscheiden müssen

> **Diese Datei wird erzeugt.** Sie entsteht aus `src/lib/annahmen.ts`,
> also aus dem, was die Anwendung wirklich tut. Bitte hier nicht
> direkt ändern — sonst stimmt das Dokument und die Software nicht.

Damit Sie das Projekt ansehen können, bevor alle Fragen beantwortet
sind, hat jede offene Stelle einen **vorläufigen Wert**. Keiner davon
ist geraten und dann vergessen worden: jeder steht hier, mit der Frage
daneben, die ihn ersetzt.

Wenn Sie antworten, ändert sich **eine Datei** — nicht dreissig
Stellen im Code, von denen man siebenundzwanzig findet.

## Die 11 vorläufigen Werte

### Texte und Inhalte

#### O-207

**Angenommen:** Alle Seitentexte sind ENTWURFSTEXTE: sie beschreiben sachlich, was die vier Gesellschaften laut Unternehmensangaben tun, und enthalten keine Zahlen, Auszeichnungen, Kundennamen oder Versprechen, die niemand geprüft hat.

**Ihre Entscheidung:** Bitte die Texte durchgehen und korrigieren — besonders alles, was eine Zusage an einen Kunden ist. Ein Werbetext, den niemand geprüft hat, steht später in einem Angebot.

**Wirkt sich aus auf:** alle 14 öffentlichen Seiten

**Wenn es anders ist:** Texte oder Daten müssen nachgezogen werden.

### Formulare

#### O-62

**Angenommen:** Auswahllisten aus den branchenüblichen Kategorien: Gebäudetypen (Bürogebäude, Wohnanlage, Praxis/Klinik, Einzelhandel, Industrie/Lager, Schule/Kita, Hotel/Gastronomie), Reinigungsfrequenzen (täglich bis einmalig) und Gewerke (Hochbau, Ausbau, Rückbau, Sanierung, Maler, Boden).

**Ihre Entscheidung:** Welche Gebäudetypen betreuen Sie tatsächlich, und in welchen Frequenzen? Welche Gewerke bieten Sie an? Was hier nicht steht, kann ein Kunde nicht anfragen.

**Wirkt sich aus auf:** Angebotsanfrage Reinigung · Angebotsanfrage Bau · Auswertung nach Objektart

**Wenn es anders ist:** Ein Wert wird geändert, sonst nichts.

#### O-61

**Angenommen:** CSE Operations fragt nach Anliegen (Prozessanalyse, Software-Einführung, KI-Automatisierung, Datenmigration, Schulung), Anzahl Mitarbeitender, eingesetzten Systemen und gewünschtem Zeitrahmen.

**Ihre Entscheidung:** Was verkauft CSE Operations an externe Kunden — und was braucht Ihr Team, um dafür ein Angebot zu rechnen?

**Wirkt sich aus auf:** Angebotsanfrage Operations

**Wenn es anders ist:** Texte oder Daten müssen nachgezogen werden.

### Fristen und Abläufe

#### O-14

**Angenommen:** Reaktionszeit auf eine Angebotsanfrage: 24 Stunden, in KALENDERSTUNDEN gerechnet — eine Anfrage am Freitag um 17 Uhr ist also am Samstag um 17 Uhr überfällig. Eskalation stündlich an dieselbe Person, die den Lead besitzt.

**Ihre Entscheidung:** Wie schnell wollen Sie auf eine Anfrage antworten — und zählen Wochenenden mit? Wer soll benachrichtigt werden, wenn die Frist verstreicht: der Bereichsleiter oder die Geschäftsführung?

**Wirkt sich aus auf:** Lead-Posteingang · Eskalations-Job · Eingangsbestätigung an den Kunden

**Wenn es anders ist:** Ein Wert wird geändert, sonst nichts.

### Marke und Auftritt

#### O-206

**Angenommen:** "CSE Gruppe" ist ein AUFTRITTSNAME über vier eigenständigen Gesellschaften, kein eigener Rechtsträger. In den strukturierten Daten erscheinen deshalb vier vollständige Unternehmenseinträge und kein Dach.

**Ihre Entscheidung:** Gibt es eine Holding oder Dachgesellschaft mit eigenem Handelsregister-eintrag? Falls ja: Name, Anschrift und Registernummer.

**Wirkt sich aus auf:** Kopfzeile · Fussbereich · strukturierte Daten · Impressum

**Wenn es anders ist:** Ein Wert wird geändert, sonst nichts.

#### O-12

**Angenommen:** Das CSE-Rot ist `#E30613`, und die vier Bereichsfarben stehen in DESIGN.md. Die Logos sind erkennbar markierte Platzhalter.

**Ihre Entscheidung:** Bitte das Original-Logo als SVG für alle vier Marken und den exakten Rotwert aus Ihrem Logo — ein um zwei Prozent abweichendes Rot fällt neben dem gedruckten Briefpapier auf.

**Wirkt sich aus auf:** gesamter Auftritt · PDF-Vorlagen · Portal

**Wenn es anders ist:** Ein Wert wird geändert, sonst nichts.

#### O-13

**Angenommen:** Alle Bilder sind sichtbar markierte Platzhalter. Es wurde KEIN Bildmaterial erfunden und keines aus fremden Quellen übernommen.

**Ihre Entscheidung:** Bitte eigene Aufnahmen von Teams, Objekten und abgeschlossenen Projekten liefern — mit schriftlicher Einwilligung der abgebildeten Personen. Das ist der einzige Punkt, den kein Programmierer lösen kann.

**Wirkt sich aus auf:** Startseite · Unternehmensprofile · Referenzen

**Wenn es anders ist:** Texte oder Daten müssen nachgezogen werden.

### Technik

#### O-80

**Angenommen:** Anmeldeversuche: 10 je Kennung und 50 je IP-Adresse in 15 Minuten, danach 30 Minuten Sperre. Formulareinsendungen: 5 je Verbindung in 15 Minuten.

**Ihre Entscheidung:** Sind diese Grenzen für Ihren Betrieb passend? Zu streng heisst: ein Mitarbeiter mit vergessenem Passwort sperrt sich aus.

**Wirkt sich aus auf:** Anmeldung · Angebotsanfrage-Formular

**Wenn es anders ist:** Ein Wert wird geändert, sonst nichts.

#### O-08

**Angenommen:** EINE Gruppendomain mit Pfaden je Bereich: `/reinigung`, `/security`, `/bau`, `/operations`. Der Host steht in der Umgebungsvariablen `CSE_KANONISCHE_BASIS` und ist bis zur Entscheidung der Host der Anfrage.

**Ihre Entscheidung:** Eine gemeinsame Domain oder vier eigene? Vier eigene bauen vier getrennte Sichtbarkeiten in der Suche auf, eine gemeinsame eine starke. Der Wechsel ist später möglich, kostet aber die aufgebaute Sichtbarkeit.

**Wirkt sich aus auf:** Sitemap · kanonische Adressen · strukturierte Daten

**Wenn es anders ist:** Texte oder Daten müssen nachgezogen werden.

### Rechtliches

#### O-25

**Angenommen:** Aufbewahrung nach dem gesetzlichen MINIMUM: Rechnungen und Buchhaltung 10 Jahre, Verträge 10 Jahre, Personalakten offen mit Löschsperre. Wo keine Frist feststeht, gilt die Sperre — es wird nichts gelöscht.

**Ihre Entscheidung:** Wollen Sie länger aufbewahren als gesetzlich nötig? Und wie lange sollen Anfragen aufbewahrt werden, aus denen kein Auftrag wurde?

**Wirkt sich aus auf:** Dokumentenablage · Lösch-Jobs

**Wenn es anders ist:** Ein Wert wird geändert, sonst nichts.

#### O-63

**Angenommen:** Das Pflichthäkchen im Formular BESTÄTIGT, dass die Datenschutzhinweise gezeigt wurden (Art. 6 Abs. 1 lit. b/f DSGVO) — es ist keine Einwilligung. Nur das zweite, freiwillige Häkchen ist eine Einwilligung, und nur es erlaubt spätere Werbung.

**Ihre Entscheidung:** Bestätigen lassen oder als Einwilligung erheben? Der Unterschied entscheidet, ob Sie eine Anfrage ohne Häkchen überhaupt bearbeiten dürfen. Empfehlung des Rechtsrahmens: bestätigen — eine Einwilligung, die man nicht verweigern kann, ist keine.

**Wirkt sich aus auf:** alle Angebotsanfrage-Formulare · Werbe-Sperre nach § 7 UWG

**Wenn es anders ist:** Ein Wert wird geändert, sonst nichts.

---

## Was wir bewusst NICHT vorbelegt haben

Diese Punkte lassen sich nicht zurücknehmen, wenn die Annahme falsch
war. Ein vorläufiger Wert wäre hier kein Platzhalter, sondern ein
Schaden, den man nachträglich nicht wegräumt. Sie bleiben sichtbar
offen, und die betroffene Funktion bleibt gesperrt.

- **O-134** — Rechnungsnummernkreis je Gesellschaft. Eine festgeschriebene Rechnung ist unveränderlich (Invariante 4) — eine mit geratener Nummer bekommt man nicht zurück. Der Kreis bleibt ein Platzhalter und vergibt keine Nummer, bis die Maske bestätigt ist.
- **O-01** — Ist CSE Operations eine GmbH oder eine Abteilung? Davon hängt ab, ob sie überhaupt eigene Rechnungen stellen darf (§ 14 UStG). Die Spalte bleibt NULL — jeder andere Wert wäre eine Behauptung über eine Rechtsform.
- **O-205** — Konformitätsstatus der Barrierefreiheitserklärung. Er setzt eine tatsächliche Prüfung voraus; ihn zu behaupten wäre eine falsche Zusage an genau die Menschen, die sich darauf verlassen.
- **O-05** — DATEV-Kontenrahmen, Beraternummer und Steuerschlüssel. Ein falsch gebuchter Beleg fällt beim Jahresabschluss auf, nicht vorher.
- **O-06** — Gibt es einen Betriebsrat? § 87 Abs. 1 Nr. 6 BetrVG regelt die Standorterfassung mit. Ohne Antwort bleibt die Standorterfassung AUS.

---

## So geht es weiter

1. Sie gehen diese Liste durch und antworten — auch ein „passt so" ist
   eine Antwort, und dann ist der Wert keine Annahme mehr, sondern
   eine Entscheidung.
2. Wir tragen die Antworten in `src/lib/annahmen.ts` ein.
3. Für die gesperrten Punkte oben wird die jeweilige Funktion
   freigeschaltet — Rechnungen zum Beispiel erst, wenn der
   Nummernkreis bestätigt ist.

