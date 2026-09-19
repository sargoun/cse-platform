export const meta = {
  name: 'cse-domaenen-bauen',
  description: 'Baut je Domaene die offenen Routen fertig: Migration, Dienst, Seite, Test — dann Kritik und Behebung',
  phases: [
    { title: 'Bau', detail: 'ein Agent je Domaene: Migrationen, Dienste, Seiten, Tests' },
    { title: 'Kritik', detail: 'adversarieller Pruefer liest, was gebaut wurde' },
    { title: 'Behebung', detail: 'die bestaetigten Befunde beheben' },
  ],
};

const PLAN = '/tmp/claude-0/plan';
const SCHLUESSEL = 'VEVTVC1LRVktTklDSFQtRlVFUi1QUk9EVUtUSU9O';

function regeln(d) {
  return `
## Regeln, an denen hier am meisten scheitert

1. **Nie eine Geschaeftsregel erfinden.** Offen = Schnittstelle + klar bezeichneter Platzhalter
   + \`// TODO(client, O-NN): <die genaue Frage>\` (die O-Nummer in DERSELBEN Zeile — eine Wache
   prueft das) + eine Zeile fuer docs/DECISIONS.md, die du im Ergebnis zurueckgibst.
   **Deine neuen O-Nummern: O-${d.oVon} bis O-${d.oBis}.** Hoechstens drei Ziffern.
   Vorhandene O-Nummern, die dein Plan nennt (O-46, O-183 …), stehen schon im Register — nicht neu anlegen.
2. **Keine erfundenen Gestaltungswerte.** Nur was in docs/DESIGN.md steht: Farben, Abstaende (s1…s7),
   Schriftgroessen, Rundungen. Fehlt etwas, nimm den naechstliegenden vorhandenen Wert und melde es
   in \`notizen\`. Eine Wache prueft Tailwind-Farben.
3. **Keine vorgetaeuschten Integrationen.** Ohne Zugangsdaten: Schnittstelle bauen, in der
   Oberflaeche „nicht verbunden" schreiben, **nie** einen Erfolg simulieren.

Dazu die Invarianten: Geld = \`bigint\` Cent (nie float, USt je Steuersatzgruppe);
Zeit = \`TIMESTAMPTZ\` in UTC gespeichert, \`Europe/Berlin\` angezeigt; jede Mandantentabelle traegt
\`mandant_id\` mit FORCE RLS; keine harten Loeschungen in Finanz-, Zeit- und Auditdomaenen;
Gruppenansicht nur lesend; die KI rechnet nie Geld, Mengen oder Fristen; nichts verlaesst das System
ohne menschliche Freigabe (\`server/agent/policy.ts\`); Oberflaechentexte **deutsch**;
fehlendes Recht → **404**, nicht 403 (AUT-06).

Routenhandler bleiben duenn: autorisieren → Dienst rufen → zurueckgeben. Keine Rechnung in einer Komponente.
`;
}

function bauPrompt(d) {
  return `Du baust die Domaene **${d.name}** der CSE-Plattform fertig — alle offenen Routen darin:
Migrationen, Dienste, Seiten, Tests. Nichts bleibt ein leerer Platzhalter.

## Dein Plan — lies ihn ZUERST vollstaendig

\`${PLAN}/${d.name}.md\`

Darin: je Route der Zustand (platzhalter|fehlt), ob der Dienst und die Tabellen schon da sind, das
noetige Recht, eine **Vorbildseite** und ein ausformulierter Plan. Ganz unten steht die **KRITIK**
eines adversariellen Pruefers mit Korrekturen. **Wo die Kritik dem Plan widerspricht, gilt die Kritik.**
Der Abschnitt „Gemeinsames" oben nennt, was fuer die ganze Domaene gilt.

## Deine Migrationsnummern: ${d.migVon}–${d.migBis}

Keine andere Nummer. **Nie eine vorhandene drizzle/*.sql aendern** — auch nicht, um eine Spalte
nachzutragen; dafuer schreibst du eine neue Datei in deinem Bereich.
Ein neuer Enum-Wert (\`alter type … add value\`) braucht eine EIGENE Datei (Postgres erlaubt ihn
nicht in derselben Transaktion wie seine Benutzung).
${d.eigentum}

## So pruefst du deine SQL — Pflicht, nach jeder Migration

\`\`\`bash
export PGPASSWORD=postgres
psql -h 127.0.0.1 -p 55432 -U postgres -c "drop database if exists w_${d.db}" -c "create database w_${d.db}"
psql -h 127.0.0.1 -p 55432 -U postgres -q -c "alter database w_${d.db} set cse.fenster_schluessel = '${SCHLUESSEL}'"
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/w_${d.db} pnpm db:migrate
\`\`\`

Erst wenn das bis \`Migrationen angewendet.\` durchlaeuft, ist deine Migration fertig.

**Scheitert der Lauf an einer Datei, deren Nummer NICHT in deinem Bereich liegt**, ist das die
halbfertige Arbeit eines anderen Agenten im selben Baum — nicht dein Fehler und nicht deine Datei.
Warte eine Minute und laufe erneut; aendere sie **nie**. Bleibt sie kaputt, schreibe das in
\`notizen\` und pruefe deine eigene SQL stattdessen so: alle Migrationen BIS zu deiner Nummer
anwenden oder wende die Migrationen von Hand mit \`psql -f\` in Namensreihenfolge an und ueberspringe
dabei die fremde Datei einmalig — ohne sie zu veraendern. Gegen
dieselbe Datenbank pruefst du auch deine Abfragen von Hand (\`psql\` oder ein kurzes \`tsx\`-Skript
im Kratzverzeichnis). Eine Abfrage, die nie gegen echtes Postgres lief, ist nicht geprueft —
Spaltennamen und Enum-Werte sind genau da, wo geraten wird.

## Was du NICHT anfassen darfst

Andere Agenten arbeiten gleichzeitig im selben Arbeitsbaum. Diese Dateien pflege **ich** zentral —
gib deine Eintraege **als Text im Ergebnis** zurueck, fertig formuliert zum Einfuegen:

- \`src/server/registry/dienste.ts\`, \`navigation.ts\`, \`tableiste.ts\`, \`modul.ts\`, \`routen.ts\`, \`kennzahlen.ts\`
- \`src/server/auth/route-manifest.ts\`
- \`src/server/db/schema/rls.ts\`  ← auch jede neue Tabelle mit Loeschsperre gehoert hierher
- \`docs/DECISIONS.md\`, \`docs/architecture/04-SEITENKARTE.md\`, \`docs/DESIGN.md\`
- jede \`drizzle/*.sql\` mit \`BLOCK\`-Sentinels darin (generiert) — insbesondere 0005
- \`package.json\`, \`scripts/guards/*\`, \`src/server/db/triggers/*\`

Nicht ausfuehren: \`pnpm db:migrate\` gegen \`cse_dev\`/\`cse_test\`, \`pnpm db:triggers\`, \`pnpm test\`,
\`pnpm test:isolation\`, \`pnpm test:e2e\`, \`pnpm db:seed\`, \`pnpm build\`, \`git commit\`, \`git add\`.
Typecheck nur auf deine eigenen Pfade gefiltert, z. B.
\`npx tsc --noEmit 2>&1 | grep -E '${d.typecheckFilter}'\` — fremde Fehler ignorierst du.
${regeln(d)}
## Bauart

Nimm die im Plan genannte **Vorbildseite** und baue in derselben Bauart: dieselbe Art, den Mandanten
und das Recht zu pruefen, dieselben Komponenten, dieselbe Art von Kopfzeile, Leerzustand und Tabelle.
Eine Seite, die aussieht wie die Nachbarseite, ist fertig; eine, die eigene Muster erfindet, nicht.

Schreibe Tests: \`tests/kern/*\` fuer jede reine Rechenfunktion (Geld, Zeit, Fristen),
\`tests/isolation/*\` fuer jede RLS-Regel und jeden Trigger, den du anlegst. Ein Trigger ohne Test
ist eine Behauptung.

## Wenn eine Route wirklich blockiert ist

Der Plan nennt bei fast jeder Route einen Blocker — meistens eine offene Geschaeftsfrage. **Das ist
kein Grund, die Seite nicht zu bauen.** Die Seite entsteht vollstaendig: Daten, Tabelle, Filter,
Rechte, Leerzustand. Nur die eine unbekannte Regel wird ein klar bezeichneter Platzhalter nach
Regel 1, in der Oberflaeche sichtbar als „offen (O-NN)". Eine leere Seite ist kein Ergebnis.

Arbeite Route fuer Route in der Reihenfolge deines Plans. Nimm dir Zeit; Vollstaendigkeit steht vor Tempo.`;
}

function kritikPrompt(d, bau) {
  return `Du pruefst **adversariell**, was ein anderer Agent gerade fuer die Domaene **${d.name}**
gebaut hat. Deine Aufgabe ist es, Fehler zu FINDEN, nicht die Arbeit zu bestaetigen.

Der Plan, gegen den gebaut wurde: \`${PLAN}/${d.name}.md\`
Der Bericht des Bauenden:

\`\`\`json
${JSON.stringify(bau, null, 1).slice(0, 24000)}
\`\`\`

Lies **jede** genannte Datei wirklich. Pruefe, in dieser Reihenfolge:

1. **Behauptet fertig, ist aber leer.** Traegt die Seite echte Zeilen aus der Datenbank, oder nur
   eine Kopfzeile und einen Text? Wird der Dienst ueberhaupt gerufen?
2. **Spaltennamen und Enum-Werte.** Gegen echtes Postgres pruefen:
   \`psql -h 127.0.0.1 -p 55432 -U postgres -d w_${d.db} -c "\\\\d <tabelle>"\`
   (PGPASSWORD=postgres). Jede Abfrage, jeden Enum-Vergleich. Hier liegt der haeufigste Fehler:
   eine Abfrage mit \`status in ('entwurf','beendet')\`, wo der Enum \`angelegt|aktiv|…\` heisst,
   scheitert erst beim Aufruf — nie beim Typecheck.
3. **Mandantentrennung.** Traegt jede neue Tabelle \`mandant_id\`, \`enable row level security\` UND
   \`force row level security\`? Gibt es eine Policy je Rolle, die wirklich liest? Ist ein
   Definer-Pfad (\`security definer\`) gegen \`public\` abgedichtet (\`revoke all … from public\`)?
4. **Geld und Zeit.** Jede Geldspalte \`bigint\` in Cent? Jeder Zeitstempel \`timestamptz\`? Wird
   Dauer als Differenz von UTC-Instanten gerechnet und nur zur Anzeige nach Europe/Berlin gedreht?
5. **Recht und 404.** Wird das Recht serverseitig geprueft, nicht nur die Navigation ausgeblendet?
   Fehlendes Recht → 404, nicht 403.
6. **Erfundene Geschaeftsregel.** Steht irgendwo eine Zahl, Frist, ein Steuersatz, eine Grenze, die
   niemand entschieden hat — ohne \`TODO(client, O-NN)\` und ohne Registerzeile? Das ist der
   schwerste Befund, den du melden kannst.
7. **Erfundener Gestaltungswert.** Ein Hex-Code, ein \`p-[13px]\`, eine Farbe, die nicht in
   docs/DESIGN.md steht.
8. **Vorgetaeuschte Integration.** Wird irgendwo ein erfolgreicher externer Aufruf simuliert?
9. **Kaputtgemachtes.** Hat er eine vorhandene Datei geaendert und dabei etwas entfernt?
   \`git diff -- <datei>\` zeigt es. Nur Dateien dieser Domaene ansehen — im Baum arbeiten andere.
10. **Tests.** Existieren die behaupteten Tests, und pruefen sie wirklich das Verhalten? Einzelne
    Testdateien darfst du laufen lassen: \`npx vitest run <datei>\`. Die vollen Suiten NICHT.

Melde je Befund: Datei, Schwere (\`blockierend\` = falsches Ergebnis, Datenleck, erfundene
Rechtsregel; \`wichtig\` = unvollstaendig oder unsauber; \`klein\` = Kosmetik), was falsch ist, den
Beleg (Zeile, Ausgabe eines Befehls) und wie es zu beheben ist.

Erfinde keine Befunde. Wenn etwas richtig ist, sag es nicht — melde nur, was zu tun ist.
Aendere **keine** Datei; du pruefst nur.`;
}

function behebPrompt(d, bau, kritik) {
  return `Du behebst die Befunde eines Pruefers in der Domaene **${d.name}** der CSE-Plattform.

Plan: \`${PLAN}/${d.name}.md\`
Eigene Bauarbeit: ${JSON.stringify((bau && bau.gebaut) || []).slice(0, 6000)}
Befunde:

\`\`\`json
${JSON.stringify((kritik && kritik.befunde) || [], null, 1).slice(0, 30000)}
\`\`\`

Arbeite **jeden** Befund ab, blockierende zuerst. Pruefe ihn erst nachvollziehen — ein Pruefer irrt
auch. Stimmt er, behebe ihn wirklich (nicht den Kommentar aendern, sondern die Ursache). Stimmt er
nicht, widerlege ihn mit Beleg und lass den Code, wie er ist.

Dieselben Grenzen wie beim Bau: Migrationsnummern **${d.migVon}–${d.migBis}**, die gemeinsamen
Dateien (\`registry/*\`, \`route-manifest.ts\`, \`schema/rls.ts\`, \`docs/DECISIONS.md\`,
\`04-SEITENKARTE.md\`, generierte Bloecke, \`package.json\`) **nicht** anfassen — Eintraege zurueckgeben.
Migration nach jeder Aenderung wieder gegen die eigene Datenbank pruefen:
\`psql … -c "drop database if exists w_${d.db}" -c "create database w_${d.db}"\`,
\`alter database w_${d.db} set cse.fenster_schluessel = '${SCHLUESSEL}'\`,
\`DATABASE_URL=…/w_${d.db} pnpm db:migrate\`.
Keine vollen Test-Suiten, kein \`git commit\`, kein \`pnpm build\`.
${regeln(d)}
Gib am Ende zurueck, was behoben, was widerlegt und was noch offen ist — und die vollstaendige,
aktuelle Liste der Registereintraege, die ich zentral einfuegen muss (auch die aus dem Bauschritt,
falls sie sich geaendert haben).`;
}

const BAU_SCHEMA = {
  type: 'object',
  properties: {
    domaene: { type: 'string' },
    gebaut: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pfad: { type: 'string' },
          dateien: { type: 'array', items: { type: 'string' } },
          zustand: { type: 'string', description: 'fertig | teilweise | platzhalter-nach-regel-1' },
          bemerkung: { type: 'string' },
        },
        required: ['pfad', 'zustand'],
      },
    },
    migrationen: { type: 'array', items: { type: 'string' } },
    migration_geprueft: { type: 'boolean', description: 'lief pnpm db:migrate auf der eigenen Datenbank bis zum Ende durch?' },
    registry_dienste: { type: 'string', description: 'einzufuegende Eintraege fuer src/server/registry/dienste.ts, wortwoertlich' },
    registry_manifest: { type: 'string' },
    registry_rls: { type: 'string' },
    registry_navigation: { type: 'string' },
    registry_sonstiges: { type: 'string' },
    decisions_zeilen: { type: 'array', items: { type: 'string' }, description: 'Tabellenzeilen fuer docs/DECISIONS.md, Abschnitt Offen' },
    tests: { type: 'array', items: { type: 'string' } },
    nicht_gebaut: { type: 'array', items: { type: 'string' } },
    notizen: { type: 'string' },
  },
  required: ['domaene', 'gebaut', 'migrationen', 'migration_geprueft', 'notizen'],
};

const KRITIK_SCHEMA = {
  type: 'object',
  properties: {
    domaene: { type: 'string' },
    befunde: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          datei: { type: 'string' },
          schwere: { type: 'string', description: 'blockierend | wichtig | klein' },
          befund: { type: 'string' },
          beleg: { type: 'string' },
          behebung: { type: 'string' },
        },
        required: ['datei', 'schwere', 'befund', 'behebung'],
      },
    },
    gelesen: { type: 'array', items: { type: 'string' } },
    urteil: { type: 'string' },
  },
  required: ['domaene', 'befunde', 'urteil'],
};

const BEHEB_SCHEMA = {
  type: 'object',
  properties: {
    domaene: { type: 'string' },
    behoben: { type: 'array', items: { type: 'string' } },
    widerlegt: { type: 'array', items: { type: 'string' } },
    offen: { type: 'array', items: { type: 'string' } },
    migrationen: { type: 'array', items: { type: 'string' } },
    migration_geprueft: { type: 'boolean' },
    registry_dienste: { type: 'string' },
    registry_manifest: { type: 'string' },
    registry_rls: { type: 'string' },
    registry_navigation: { type: 'string' },
    registry_sonstiges: { type: 'string' },
    decisions_zeilen: { type: 'array', items: { type: 'string' } },
    notizen: { type: 'string' },
  },
  required: ['domaene', 'behoben', 'notizen'],
};

const DOMAENEN = [
 {
  "name": "aufgaben-nachrichten-oeffentlich",
  "db": "aufg",
  "migVon": "0230",
  "migBis": "0244",
  "oVon": 650,
  "oBis": 659,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/(aufgaben|nachrichten|team)|app/\\(public\\)|server/services/(aufgabe|nachricht|team))",
  "eigentum": "**Du besitzt** die Tabelle `aufgabe` samt der Enums `aufgabe_status`, `bezug_typ`, `prioritaet`, dazu `team`, `team_mitglied`, alle fehlenden Spalten auf `nachricht` (Richtung, Kanal, Thread, Zustellstatus, Rechtsgrundlage, Freigabebezug, Antwortbezug, Bezug), `nachricht_anhang` und die fehlenden Spalten auf `nachricht_empfaenger`. Zwei andere Domaenen bauen auf dir auf: `crm-rest` braucht `aufgabe` fuer Wiedervorlagen, `kundenportal` haengt seine `t_kunde`-Policies an dein `nachricht`. Lege die Tabellen deshalb so an, dass eine Zeile auch OHNE internen Bezug gueltig ist.\n**Du besitzt NICHT** `werbewiderspruch` und den Token-Speicher je Werbenachricht — die legt die Domaene `datenschutz` in 0220–0229 an, also VOR dir. Nimm an, dass `werbewiderspruch` existiert (Spalten: `mandant_id`, `kontakt_id`, `kanal`, `eingegangen_am`, `quelle`, `nachricht_id`), und verweise darauf; lege sie nicht selbst an. Die `kunde_id`-Spalte und die `t_kunde`-Policy auf `nachricht` gehoeren dem `kundenportal` (0255+) — lass sie weg."
 },
 {
  "name": "datenschutz",
  "db": "dsch",
  "migVon": "0220",
  "migBis": "0229",
  "oVon": 640,
  "oBis": 649,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/datenschutz|app/\\(public\\)/(datenschutz|werbewiderspruch)|server/services/datenschutz)",
  "eigentum": "**Du besitzt** `werbewiderspruch` (das Protokoll: Mandant, Kontakt, Kanal, Zeitpunkt, ausloesende Nachricht, Quelle Token oder Formular), den gehashten Widerspruchstoken je ausgehender Werbenachricht in K-09-Form, `loeschentscheidung` (je Anfrage eine Zeile je Tabelle/Feld: geschuldet oder ueberlagert, mit Rechtsgrundlage und dem Datum, an dem die Sperre faellt) und `datenschutz_auskunft` (das ausgehaendigte Artefakt mit SHA-256).\nDeine Nummern liegen VOR denen der Domaene `aufgaben-nachrichten-oeffentlich` (0230+), die deinen `werbewiderspruch` benutzt. `nachricht_id` darf deshalb noch NICHT auf Spalten zeigen, die erst dort entstehen — ein Fremdschluessel auf `nachricht.id` ist in Ordnung, die Tabelle gibt es schon."
 },
 {
  "name": "finanzen",
  "db": "fin",
  "migVon": "0180",
  "migBis": "0189",
  "oVon": 600,
  "oBis": 609,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/finanzen|app/api/finanzen|server/services/finanz)",
  "eigentum": "**Du besitzt** `ausgabe`, `ausgabe_kategorie`, `ausgabe_steuer`, `rechnung_versand` und, falls dein Plan sie verlangt, `bauleistung_jahressumme`. `rechnungsposition_quelle.ausgabe_id` zeigt heute auf eine Tabelle, die es nicht gibt — mit deiner Migration stimmt der Bezug; pruefe, ob ein Fremdschluessel nachzutragen ist. Die Spalte `anstellung_id` auf `ausgabe` (Auslagenerstattung) muss hinter einem spaltenweisen GRANT und einer Definer-Funktion liegen, nicht offen lesbar."
 },
 {
  "name": "personal",
  "db": "pers",
  "migVon": "0190",
  "migBis": "0199",
  "oVon": 610,
  "oBis": 619,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/personal|app/api/personal|server/services/(personal|person))",
  "eigentum": "**Du besitzt** die fehlenden Spalten auf `person` (`geburtsort`, `staatsangehoerigkeit char(2)`, `zusammengefuehrt_in_person_id`), die Zusammenfuehrung (Definer-Vorgang `app.person_zusammenfuehren`, Aufloeser `app.person_kanonisch`, Trigger gegen Selbstbezug und Ketten), `app.person_stammdaten_lesen` und `anstellung.tarifgruppe`.\n**Du besitzt auch `anstellung_kondition`** (datierte Konditionen mit `gilt_ab`) — die Domaene `einstellungen` (0200+) baut darauf auf, also lege sie vollstaendig an: Mandant, `anstellung_id`, `gilt_ab`, Arbeitszeitmodell, Wochenstunden, Entgelt in Cent, Tarifgruppe, Anlagezeitpunkt und Anleger, keine harte Loeschung."
 },
 {
  "name": "einstellungen",
  "db": "einst",
  "migVon": "0200",
  "migBis": "0209",
  "oVon": 620,
  "oBis": 629,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/einstellungen|app/api/einstellungen|server/services/(einstellung|mandant|migration))",
  "eigentum": "**Du besitzt** `mandant_identitaet` (vollstaendig nach 02-datenmodell/01-KERN.md §6.2), `arbeitszeitmodell` je Mandant, `tarifvereinbarung` (die STRENGERE Pausen- und Ruhezeitregel je Gewerk mit Geltungsbeginn, O-50), `audit_kette` und die Uebernahmeform `migration_lauf` + `migration_zeile`.\n**Du besitzt NICHT `anstellung_kondition`** — die legt `personal` in 0190–0199 an, also VOR dir. Nimm an, dass sie existiert (`mandant_id`, `anstellung_id`, `gilt_ab`, `arbeitszeitmodell`, `wochenstunden`, `entgelt_cent`, `tarifgruppe`), und verweise darauf. Ebenso: `anstellung.tarifgruppe` kommt aus 0190+."
 },
 {
  "name": "bau",
  "db": "bau",
  "migVon": "0210",
  "migBis": "0219",
  "oVon": 630,
  "oBis": 639,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/bau|app/api/bau|server/services/bau)",
  "eigentum": "**Du besitzt** den Enum `bau_abnahme_art` (in EIGENER Datei), `abnahme`, `abnahme_mangel`, `lv_import` und `lv_import_zeile`. Die Abnahme ist der Punkt, an dem Gefahr, Gewaehrleistungsfrist und Faelligkeit umschlagen (VOB/B) — sie ist einmalig und nicht loeschbar; die Frist selbst rechnet ein getesteter Dienst, nie die Datenbank und nie die KI."
 },
 {
  "name": "crm-rest",
  "db": "crm",
  "migVon": "0245",
  "migBis": "0254",
  "oVon": 660,
  "oBis": 669,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/crm|app/api/crm|server/services/crm)",
  "eigentum": "**Du besitzt** `ansprechpartner.aehnliche_leistung`, `kunde.rechnungsformat` samt Enum und `kunde.uebertragungsweg` samt Enum `uebertragungsweg` ('peppol','zre','ozg_re','email','kundenportal','post').\n**Du besitzt NICHT `aufgabe`** — die legt `aufgaben-nachrichten-oeffentlich` in 0230–0244 an, also VOR dir. Nimm an, dass `aufgabe` existiert (`mandant_id`, `titel`, `beschreibung`, `status` aus Enum `aufgabe_status`, `prioritaet`, `faellig_am`, `zustaendig_person_id`, `bezug_typ`, `bezug_id`, `angelegt_am/von`) und schreibe die CRM-04-Wiedervorlage in `aufgabe` UND `kalender_eintrag`."
 },
 {
  "name": "kundenportal",
  "db": "kupo",
  "migVon": "0255",
  "migBis": "0264",
  "oVon": 670,
  "oBis": 679,
  "typecheckFilter": "^src/(app/portal/kunde|app/kundenportal|app/api/kundenportal|server/services/kundenportal)",
  "eigentum": "**Du besitzt** die `kunde_id`-Spalte auf `nachricht`, die `t_kunde`-Policies auf `nachricht` und `nachricht_empfaenger` und die Korrektur der Sichtbarkeit von `rechnung_snapshot` im Kunden-Scope (heute traegt sie `p_intern_ceiling` mit `app.portal() = 'intern'` und liefert im Kundenzugang null Zeilen).\n**Du besitzt NICHT** die uebrige Nachrichtenstruktur: Richtung, Kanal, Thread, Zustellstatus, Anhaenge und die Empfaengerspalten entstehen in 0230–0244 (Domaene `aufgaben-nachrichten-oeffentlich`), also VOR dir. Nimm an, dass sie existieren. Brauchst du eine Funktion im Nachrichtendienst, beschreibe sie in `notizen` und baue deinen Lesepfad in einer eigenen Datei unter `src/server/services/kundenportal/`.\n**Der Kundenzugang ist streng lesend** ausser bei Anfragen und Nachrichten, die der Kunde selbst schreibt; ein Kunde sieht NIE eine andere Kundennummer, nie einen Entwurf, nie einen internen Vermerk."
 },
 {
  "name": "dienstplan-zeit",
  "db": "dpz",
  "migVon": "0265",
  "migBis": "0274",
  "oVon": 710,
  "oBis": 719,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/(dienstplan|zeit)|app/api/(dienstplan|zeit)|server/services/(dienstplan|zeit))",
  "eigentum": "**Du besitzt** den Traeger des Veroeffentlichungsvorgangs (z. B. `dienstplan_veroeffentlichung`: Mandant, Zeitraum von/bis, Umfang, `veroeffentlicht_am`, `veroeffentlicht_von`) und die Benachrichtigungsart `dienstplan.*` fuer NOT-01.\nWICHTIG: `einsatz_status` ist ('geplant','laufend','abgeschlossen','storniert') und ein Wert `veroeffentlicht` fehlt mit ABSICHT (drizzle/0028_dienstplan.sql, K-17). Fuege ihn NICHT hinzu — die Veroeffentlichung ist ein eigener Vorgang ueber einen Zeitraum, nicht ein Zustand je Einsatz. Diese vier Faelle muessen als Test bestehen, bevor eine Planungsoberflaeche gebaut wird: Schicht 22:00–06:00, die Nacht der Zeitumstellung vorwaerts, die Nacht rueckwaerts, zehn Schichten mit demselben Startinstant auf einem Objekt."
 },
 {
  "name": "stammdaten",
  "db": "stamm",
  "migVon": "0275",
  "migBis": "0279",
  "oVon": 690,
  "oBis": 699,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/stammdaten|app/api/stammdaten|server/services/stammdaten)",
  "eigentum": "Dein Plan nennt keine fehlende Tabelle — alle fuenf Routen sind `mittel`: Schreibwege auf vorhandene Tabellen. Brauchst du wider Erwarten doch eine Migration (etwa eine Eindeutigkeitsregel oder eine Loeschsperre), liegt sie in 0275–0279.\n**Das ist der Ort, an dem heute „geht nur direkt in der Datenbank\" steht.** Stammdaten anlegen und aendern ist genau die Luecke: Leistungskatalog, Objekte, Raeume, Kunden-Stammdaten. Baue die Schreibwege wirklich — ein Formular, das nur anzeigt, ist die Luecke, die du schliessen sollst."
 },
 {
  "name": "website-pflege",
  "db": "web",
  "migVon": "0280",
  "migBis": "0284",
  "oVon": 680,
  "oBis": 689,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/(website|inhalt)|app/api/(website|inhalt|seite)|server/services/inhalt)",
  "eigentum": "Dein Plan nennt keine fehlende Tabelle — sieben `mittel`, zwei `klein`. Falls doch eine noetig ist: 0280–0284.\n**D-82 gilt hier streng:** `seite` traegt `sprache`, eine englische Seite ist eine EIGENE Zeile, Formularfelder werden ueberlagert und nie verdoppelt (`formular_definition` bleibt die einzige Quelle der Validierung, D-83). Impressum und Datenschutz sind rechtlich in DEUTSCH verbindlich, und die englische Seite sagt das (D-84). Wer eine Seite veroeffentlicht, veroeffentlicht nach aussen — das laeuft ueber `server/agent/policy.ts` bzw. eine menschliche Freigabe, nie automatisch."
 },
 {
  "name": "reinigung-security-qualitaet",
  "db": "rsq",
  "migVon": "0285",
  "migBis": "0289",
  "oVon": 700,
  "oBis": 709,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/(reinigung|security|qualitaet)|app/api/(reinigung|security|qualitaet)|server/services/(reinigung|security|qualitaet))",
  "eigentum": "Elf Routen, alle `mittel` — kein fehlendes Schema. Falls doch: 0285–0289.\nDrei Gewerke in einem Auftrag: Reinigung (Leistungsnachweis, Revierkontrolle), Security (Wachbuch, Bewacherregister-Pflichten §34a GewO) und Qualitaet (Begehung, Beanstandung, Massnahme). Das Wachbuch ist ein Protokoll: kein hartes Loeschen, keine Rueckdatierung, Serveruhr entscheidet."
 },
 {
  "name": "vertrieb-rest",
  "db": "vtr",
  "migVon": "0295",
  "migBis": "0299",
  "oVon": 730,
  "oBis": 739,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/(vertrieb|angebote|kalkulation)|app/api/(vertrieb|angebot|kalkulation)|server/services/(vertrieb|angebot|kalkulation))",
  "eigentum": "Acht `mittel`, eine `gross`. Deine Nummern: 0295–0299.\nAngebot und Kalkulation rechnen GELD: jeder Betrag `bigint` in Cent, USt je Steuersatzgruppe und nie aus einer Bruttosumme zurueckgerechnet. Jede Rechenfunktion gehoert in `server/services/` mit Test — die KI rechnet hier nichts. Ein Angebot verlaesst das Haus nur nach menschlicher Freigabe."
 },
 {
  "name": "agenten-freigaben-radar",
  "db": "agt",
  "migVon": "0290",
  "migBis": "0294",
  "oVon": 720,
  "oBis": 729,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/(agenten|freigaben|radar|ausschreibungen)|app/api/(agent|freigabe|radar)|server/(agent|services/(radar|ausschreibung)))",
  "eigentum": "Vier `klein`, eine `mittel`, eine `gross`. Deine Nummern: 0290–0294.\n**Hier gelten die beiden schaerfsten Invarianten zugleich:** die KI liest, extrahiert, ordnet ein und entwirft — sie rechnet NIE Geld, Mengen oder Fristen (jede Zahl durch eine getestete Funktion in `server/services/`); und nichts verlaesst das System ohne menschliche Freigabe (`server/agent/policy.ts`). Eine Freigabeseite, die eine Zahl aus einem Modellergebnis anzeigt, muss sie als solche kennzeichnen. Zur Vergabeplattform gibt es KEINE Schnittstelle — die Abgabe ist von Hand, absichtlich."
 },
 {
  "name": "mitarbeiterportal",
  "db": "mapo",
  "migVon": "0300",
  "migBis": "0304",
  "oVon": 740,
  "oBis": 749,
  "typecheckFilter": "^src/(app/portal/\\[mandant\\]/mein|app/mein|app/api/mein|server/services/mitarbeiter)",
  "eigentum": "Drei `mittel`, eine `klein`, zwei `gross`. Deine Nummern: 0300–0304.\n**Das ist die Seite, die der Arbeiter selbst sieht** — Zeiterfassung, eigene Schichten, Abwesenheit, Nachweise. Zwei Regeln entscheiden: die SERVERUHR ist die Quelle der Zeit (die Geraetezeit wird getrennt gespeichert, `zeitabweichung_sek`), und ein Mensch ist keine Anstellungszeile (D-09: Zertifikate und Zugang haengen an `person_id`, kostende Dinge an `anstellung_id`, die ArbZG-Grenzen summieren je PERSON ueber alle Gesellschaften). Arbeiterseiten sind zusaetzlich uebersetzbar (de/en/ar/tr, SPEC §10) — baue die Texte so, dass sie durch die vorhandene Uebersetzungsform gehen, nicht fest verdrahtet."
 }
];
const GEWAEHLT = DOMAENEN.filter((d) => args.nur.includes(d.name));

const ERGEBNIS = await pipeline(
  GEWAEHLT,
  (d) => agent(bauPrompt(d), { label: `bau:${d.name}`, phase: 'Bau', schema: BAU_SCHEMA }),
  (bau, d) => agent(kritikPrompt(d, bau), { label: `kritik:${d.name}`, phase: 'Kritik', schema: KRITIK_SCHEMA })
    .then((k) => ({ bau, kritik: k })),
  (r, d) => {
    const befunde = (r.kritik && r.kritik.befunde) || [];
    if (befunde.length === 0) return { ...r, behebung: null };
    return agent(behebPrompt(d, r.bau, r.kritik), {
      label: `behebung:${d.name}`, phase: 'Behebung', schema: BEHEB_SCHEMA,
    }).then((b) => ({ ...r, behebung: b }));
  },
);

return { domaenen: GEWAEHLT.map((d) => d.name), ergebnis: ERGEBNIS };
