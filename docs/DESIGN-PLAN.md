# Gestaltungsplan — die Oberfläche neu ordnen

**Stand: 18.09.2026.** Dieses Dokument ist der Auftrag für die Gestaltungsrunde.
`docs/DESIGN.md` bleibt die **Autorität** für jeden Farbwert, jeden Abstand und jede
Komponente; dieser Plan sagt, **was dort ergänzt und was in der Oberfläche umgebaut
werden muss** — und in welcher Reihenfolge.

Die Regel aus CLAUDE.md gilt unverändert und ist hier besonders leicht zu verletzen:
**erst DESIGN.md ergänzen, dann benutzen.** Kein Hex-Code, kein `p-[13px]`, keine neue
Komponente in einer Seitendatei. Wer beim Umbau einen Wert braucht, den DESIGN.md nicht
führt, trägt ihn dort ein — mit Begründung — und benutzt ihn danach.

---

## 1. Was der Mandant gesehen hat

Nicht aus einem Test, sondern beim Benutzen. Das ist die verlässlichste Quelle, die
dieses Projekt hat, und jeder Punkt unten ist nachgemessen.

**„Alles ist ineinander, nichts ist klar."** Die Seitenleiste einer Gesellschaft führt
**32 Einträge in EINER flachen Liste** — Übersicht, CRM, Objekte, Dienstplan, Zeiten,
Personal, Angebote, Leistungskatalog, Aufträge, Aufgaben, Rechnungen, Zahlungen,
Eingangsrechnungen, Ausgangsbuch, Mahnungen, Buchungen, Bank, DATEV, Dokumente,
Nachrichten, Agenten, Freigaben, Social Media, Website, Recruiting, Bau, Security,
Reinigung, Qualität, Dienstanweisungen, Schlüssel, Einstellungen. `NAVIGATION` in
`src/server/registry/navigation.ts` hat **kein Feld für eine Gruppe**. 32 gleichrangige
Zeilen sind keine Navigation, sondern eine Inhaltsangabe.

**„Die wichtigsten Punkte sind am Rand."** Im Mitarbeiterportal trägt die untere Leiste
fünf Ziele, und **acht weitere stehen in einer Liste „Mehr"**: meine Stunden, Urlaub,
Anträge, Nachweise, Dienstanweisungen, Monatsnachweis, Dokumente, meine Objekte. „Meine
Stunden" ist das, was eine Reinigungskraft am häufigsten braucht — und es liegt hinter
einem zweiten Antippen.

**„Die Sprache schaltet nicht um."** Auf Englisch wird die Seitenleiste englisch
(Overview, CRM, Sites, Schedule…), der Seiteninhalt bleibt deutsch (Zahlungen, Offene
Forderungen, Zahlungseingang erfassen, Betrag in Euro, Buchungstag, Überweisung…). Der
Grund ist mechanisch: die Navigation läuft über `INTERN_BESCHRIFTUNGEN` (je Schlüssel
zwei Sprachen), **die Seitenrümpfe tragen deutsche Zeichenketten fest verdrahtet**. Es
ist kein Gestaltungsfehler, sondern eine halbe Umsetzung — und sie steht als offene
Aufgabe im Verlauf.

**„Es gibt keinen Weg, einen Mitarbeiter einzustellen."** Den Weg gibt es:
`/portal/[mandant]/personal/anstellungen/neu`. Er ist nur nicht zu finden — unter
„Personal" liegt eine Liste, und die Anlage ist ein Knopf darin. Eine Funktion, die
niemand findet, ist für den Benutzer nicht vorhanden. Das ist derselbe Befund wie bei
`/portal/gruppe/radar`, nur eine Ebene höher.

**„Die Startseite ist nicht schön — die Gesellschaften stehen unten im Bild."** Die
vier Gewerkekarten liegen unter dem Bildschirmrand. Wer die Seite öffnet, sieht ein
Panorama, eine Überschrift und zwei Knöpfe; **wer die Gruppe ist, erfährt er erst nach
dem Scrollen.** Bei einem Gruppenauftritt, dessen ganzes Versprechen „vier Gewerke,
eine Gruppe" ist, steht damit der Beweis unter dem Falz.

---

## 2. Was NICHT das Problem ist

Damit die Runde nicht am falschen Ende anfängt.

**Die Farben, Abstände und Typografie in DESIGN.md sind in Ordnung.** Vier
Bereichstöne, eine Abstandsleiter `s1…s7`, eine Schriftskala, geprüfte Kontraste. Das
ist eine tragfähige Grundlage, und sie wird **nicht** ersetzt.

**Die Dichte ist nicht das Problem.** Eine Verwaltung, die Schichten plant und
Rechnungen schreibt, braucht Tabellen mit vielen Spalten. Wer daraus grosszügige Kacheln
macht, macht die Arbeit langsamer und die Oberfläche hübscher. Das ist kein Tausch, den
dieses Projekt machen soll.

**Das Problem ist die ORDNUNG, nicht die Optik.** 32 gleichrangige Einträge,
Beschriftungen, die das Datenmodell benennen statt die Arbeit, und die wichtigsten
Handgriffe hinter einem zweiten Klick. Eine schönere Farbe an derselben Struktur ändert
daran nichts.

---

## 3. Fünf Grundsätze

**(1) Die Navigation folgt dem Arbeitstag, nicht dem Datenmodell.** Heute ist je
Tabellenfamilie ein Eintrag da. Ein Mensch denkt aber nicht „ich gehe in
`eingangsrechnungen`", sondern „ich muss die Lieferantenrechnung freigeben". Die
Gliederung entsteht aus Tätigkeiten.

**(2) Was heute zu entscheiden ist, steht vor dem, was man nachsehen kann.** Jede
Rolle hat eine Handvoll Dinge, die auf sie warten: Freigaben, überfällige Posten,
unbesetzte Schichten, unbeantwortete Anfragen. Die gehören auf den ersten Bildschirm —
mit einer Zahl daneben, die stimmt.

**(3) Eine Gesellschaft zeigt nur ihr Gewerk.** Die Modulbuchung
(`mandant.module`) entscheidet das schon in der Datenbank — wie beim
Bewacherregister, das in der Reinigung für niemanden existiert (D-377). Die
Seitenleiste muss dasselbe tun: eine Reinigungsgesellschaft zeigt keinen Bau-Eintrag.
Allein das nimmt der Liste je Gesellschaft mehrere Zeilen.

**(4) Jeder sichtbare Weg führt irgendwohin.** Das ist keine Absicht, sondern eine
geprüfte Eigenschaft: `tests/e2e/verweise.spec.ts` öffnet mit jeder Rolle jede Seite
und folgt jedem gezeigten Verweis. Ein Menüpunkt, den eine Rolle sieht und nicht öffnen
kann, bricht den Lauf. Die neue Gliederung erbt diese Zusage.

**(5) Vertrauen entsteht aus Genauigkeit, nicht aus Schmuck.** Der Eindruck, den ein
Auftraggeber von dieser Plattform bekommen soll, kommt von richtigen Zahlen, ehrlichen
Leerzuständen und Sätzen, die sagen, was gilt — nicht von Verläufen und Schatten. Wo
etwas offen ist (`O-NN`), steht das da. Ein „nicht verbunden" ist glaubwürdiger als ein
vorgetäuschter Erfolg.

---

## 4. Die neue Gliederung der Gesellschaftsleiste

Aus 32 flachen Einträgen werden **sieben Gruppen**. Die Zuordnung unten ist der
Vorschlag; die Namen sind Arbeitsbegriffe der Gewerke, nicht Modulnamen.

| Gruppe | Einträge | Warum zusammen |
|---|---|---|
| **Heute** | Übersicht · Aufgaben · Freigaben · Nachrichten | Was auf mich wartet |
| **Kunden & Aufträge** | CRM · Angebote · Aufträge · Leistungskatalog · Objekte | Der Weg von der Anfrage zum Auftrag |
| **Einsatz** | Dienstplan · Zeiten · Reinigung · Security · Bau · Qualität · Dienstanweisungen · Schlüssel | Die Leistung am Objekt — **je Gesellschaft nur ihr Gewerk** |
| **Personal** | Personal · Recruiting | Menschen und Beschäftigungen |
| **Geld** | Rechnungen · Zahlungen · Mahnungen · Eingangsrechnungen · Ausgangsbuch · Buchungen · Bank · DATEV | Der Rechnungskreis, in seiner Reihenfolge |
| **Aussenauftritt** | Website · Social Media | Was nach draussen geht |
| **Werkzeuge** | Agenten · Radar · Dokumente · Berichte · Einstellungen | Selten, aber nicht versteckt |

**Was das mechanisch braucht:** ein Feld `gruppe` in `NAVIGATION`
(`src/server/registry/navigation.ts`) und eine Gruppenreihenfolge. Die Beschriftungen
der Gruppen gehören in `INTERN_BESCHRIFTUNGEN` (`src/lib/i18n/intern.ts`) — in **beiden**
Sprachen, sonst entsteht genau der Zustand, der jetzt schon zu sehen ist.

**Zugeklappt oder offen?** Offen für die Gruppe, in der man steht; zugeklappt für die
anderen, mit Merken je Benutzer. Eine Gruppe, die man zum Arbeiten jedes Mal aufklappen
muss, ist ein zweiter Klick auf dem häufigsten Weg — genau der Fehler, der im
Mitarbeiterportal schon gemacht wurde.

**Und die Zahl daneben.** „Heute" trägt je Eintrag eine Zahl (offene Freigaben,
überfällige Aufgaben, ungelesene Nachrichten). Die Daten dafür sind da — der
CEO-Assistent liest sie schon über einen geschlossenen Katalog
(`src/server/agent/tools/suche-bestand.ts`). **Keine Zahl, die nicht aus einer
geprüften Abfrage kommt.** Eine falsche Zahl auf dem ersten Bildschirm kostet mehr
Vertrauen als eine fehlende.

---

## 5. Je Oberfläche

### 5.1 Die Gesellschaft (Verwaltung)

Neben der Gruppierung aus §4:

**Die Anlagewege gehören sichtbar an ihre Liste.** „Mitarbeiter einstellen", „Kunde
anlegen", „Angebot schreiben", „Objekt aufnehmen" — jeder als Knopf oben rechts auf
seiner Liste, mit demselben Aussehen an jeder Stelle. Wer eine Liste sieht, muss sehen,
wie man etwas hinzufügt, ohne zu suchen.

**Ein Seitenkopf, überall gleich.** Titel, darunter eine Zeile, die sagt, was die Seite
ist, rechts die Handlung. Heute tragen manche Seiten einen Titel, manche eine
Statuspille, manche einen Filter direkt unter der Überschrift. Dieselbe Sache muss
überall gleich aussehen, sonst muss man jede Seite neu lesen.

**Die Filterzeile ist eine Komponente, nicht eine Wiederholung.** Sie ist gerade an
zwei Stellen über den Rand gelaufen (D-609), und zwar aus demselben Grund, weil sie an
jeder Stelle neu geschrieben ist. Eine Komponente in DESIGN.md §5, einmal richtig
gebaut, nimmt diese Klasse von Fehlern weg.

### 5.2 Das Mitarbeiterportal (Telefon, im Treppenhaus)

**Die fünf Ziele der unteren Leiste müssen die fünf HÄUFIGSTEN sein.** Heute liegen
„meine Stunden", „Urlaub" und „Anträge" in „Mehr". Der Vorschlag: **Heute · Stunden ·
Schichten · Anträge · Mehr**. Was tatsächlich am häufigsten gebraucht wird, weiss der
Mandant besser als wir — das ist eine Frage an ihn, keine Erfindung.

**Berührungsziele mindestens 44 px, alles ohne JavaScript bedienbar.** Die Geräte sind
alte Diensttelefone. Das steht schon in DESIGN.md §8/§9 und ist beim Umbau leicht zu
verlieren.

**Vier Sprachen, nicht zwei.** Arbeiterseiten sind de/en/ar/tr (SPEC §10) — und
Arabisch und Türkisch heissen: **die Oberfläche muss von rechts nach links** laufen
können. Der Bildschirm, den der Mandant geschickt hat, zeigt die arabische Fassung
schon rechtsbündig; das gehört in DESIGN.md als eigener Punkt, samt Spiegelung von
Abständen, Pfeilen und Tabellenausrichtung.

### 5.3 Das Kundenportal

Es ist die Oberfläche, die ein **Auftraggeber** sieht — der Eindruck, den sie macht,
ist Teil des Angebots. Sie ist streng lesend (ausser eigenen Anfragen und Nachrichten),
sie zeigt nie eine andere Kundennummer und nie einen internen Vermerk. Wenige, ruhige
Seiten; jede beantwortet eine Frage („was habe ich offen", „was wurde geleistet").

### 5.4 Der öffentliche Auftritt

**Die vier Gesellschaften müssen ohne Scrollen zu sehen sein.** Das Versprechen der
Startseite ist „vier Gewerke, eine Gruppe" — und der Beweis dafür steht derzeit unter
dem Falz. Entweder wandert das Panorama in die Höhe eines Streifens, oder die vier
Karten wandern hinein. Beides ist eine Entscheidung über DESIGN.md §4 (Photography) und
gehört dort begründet.

**Zweisprachig heisst vollständig** (D-82/D-84): deutsch unter `/`, englisch unter
`/en/…`, dieselben Pfade, und Impressum und Datenschutz sind auf Deutsch verbindlich —
die englische Seite sagt das.

---

## 6. Die Reihenfolge

Sie ist nicht beliebig: jeder Schritt macht den nächsten billiger.

1. **Die Zweisprachigkeit zuerst fertig machen.** Sie ist ein Defekt, kein
   Gestaltungsthema — und sie berührt jede Seitendatei. Wer erst umbaut und dann
   übersetzt, fasst jede Datei zweimal an. Der Weg steht in `src/lib/i18n/intern.ts`;
   die Seitenrümpfe müssen ihre deutschen Zeichenketten dorthin abgeben.
2. **`gruppe` in `NAVIGATION` einführen**, die sieben Gruppen füllen, Gruppennamen in
   beiden Sprachen, Modulbuchung anwenden. Danach ist die Leiste kurz, und jeder
   folgende Schritt sieht, was er verändert.
3. **DESIGN.md ergänzen** — die Punkte, die heute fehlen: Seitenkopf, Filterzeile,
   Anlageknopf, Gruppennavigation, Zahl-am-Eintrag, RTL. **Erst dort, dann in der
   Oberfläche.**
4. **Seitenkopf und Filterzeile als Komponenten** und überall einsetzen. Das ist die
   Runde, die die meisten Dateien berührt und am wenigsten Entscheidungen braucht.
5. **„Heute" bauen** — je Rolle der erste Bildschirm, mit geprüften Zahlen.
6. **Mitarbeiterportal: die fünf Ziele neu belegen**, nach Rückfrage beim Mandanten.
7. **Startseite und öffentlicher Auftritt.**

Nach **jedem** Schritt die volle Kette, in dieser Folge:
`guards · typecheck · eslint · test · test:isolation · e2e:db · test:e2e`.
Die Browsersuite ist hier keine Formalität — `tests/e2e/abmessungen.spec.ts` misst jede
Seite auf 390 px und 1440 px, und `verweise.spec.ts` folgt jedem Verweis mit jeder
Rolle. Beide finden genau die Fehler, die ein Umbau der Navigation macht.

---

## 7. Was sich nicht ändern darf

Ein Umbau der Oberfläche ist die Gelegenheit, an der solche Zusagen still verloren
gehen. Diese hier nicht:

- **Fehlendes Recht → 404, nicht 403** (AUT-06). Ein Menüpunkt, den eine Rolle nicht
  halten darf, wird nicht ausgegraut — er ist nicht da.
- **Die Gruppenansicht ist nur lesend** (Invariante 10). Kein Anlegeknopf, kein
  Freigabeweg, auch nicht „nur zur Ansicht".
- **Gruppenansicht ohne Personenbezug**, wo die Mandantengrenze ihn schützt.
- **Kein Wert ausserhalb von DESIGN.md.** Die Wache `tailwind-farben` prüft es; die
  Abstände prüft sie nicht — dort hilft nur Disziplin.
- **Die Oberflächentexte der Verwaltung bleiben fachlich deutsch**, weil die Begriffe
  Rechtsbedeutung tragen (`mandant`, `anstellung`, `leistungsnachweis`, `wachbuch`).
  Englisch ist die Übersetzung, nicht die Quelle.
- **Nichts vortäuschen.** Ein Zähler ohne Abfrage, ein Diagramm mit Beispieldaten, ein
  „verbunden", wo nichts verbunden ist — das kostet genau das Vertrauen, das dieser
  Umbau gewinnen soll.

---

## 8. Die offenen Fragen, die der Mandant entscheidet

Nicht erfinden — fragen. Jede davon ändert die Gliederung:

1. **Welche fünf Ziele braucht eine Kraft am häufigsten?** (untere Leiste, §5.2)
2. **Welche Gruppennamen benutzt die Gruppe im Haus?** „Einsatz" oder „Objektbetrieb"?
   „Geld" oder „Buchhaltung"? Die Beschriftung soll klingen wie das, was die Leute
   sagen.
3. **Welche Zahlen gehören auf „Heute"** — je Rolle drei bis fünf, nicht zehn.
4. **Startseite: Panorama kleiner oder Karten höher?** (§5.4)
5. **Braucht die Verwaltung Arabisch und Türkisch**, oder bleiben die beiden auf den
   Arbeiterseiten?

---

## 9. Wo die Wahrheit steht

- `docs/DESIGN.md` — **die Autorität.** Farbe, Typografie, Abstand, Komponente, Bewegung,
  Zugänglichkeit. Was dort nicht steht, gibt es nicht.
- `docs/architecture/04-SEITENKARTE.md` — welche Adresse es gibt und was sie zeigt.
- `src/server/registry/navigation.ts` · `tableiste.ts` · `modul.ts` — was in der
  Oberfläche erscheint, mit dem Recht daneben.
- `src/lib/i18n/intern.ts` — die Beschriftungen, je Schlüssel zwei Sprachen.
- `docs/DECISIONS.md` — warum etwas so ist. **D-420, D-594 und D-609** sind für diesen
  Plan die wichtigsten drei: dreimal dieselbe Ursache
  (`min-width: auto` an einem Flex-Element) an drei Stellen, und jedes Mal hat sie eine
  Seite über den Rand geschoben. Wer eine neue Zeile aus Marken, Zahlen und Text baut,
  liest sie vorher.
