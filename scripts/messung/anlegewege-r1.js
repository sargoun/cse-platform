export const meta = {
  name: 'cse-anlegewege-r1',
  description: 'Fuer vier fehlende Anlegewege: Tabelle, Zwaenge, Trigger, Rechte — und die Fehlerkette, die ein Insert wirklich wirft',
  phases: [
    { title: 'Erkunden', detail: 'Tabelle, Pflichtfelder, Enums, RLS, Rechte, vorhandene Dienste und Seiten' },
    { title: 'Fallen', detail: 'Insert von Hand gegen die echte DB, jeder Fehler mit seiner Loesung' },
  ],
}

const REFERENZ = `
ALS VORBILD dient der Weg, der gerade FERTIG gebaut wurde — lies ihn zuerst, er ist das Muster:
  src/server/services/objekt/anlegen.ts     (Dienst: legeObjektAn / aendereObjekt / archiviereObjekt)
  src/app/api/objekt/route.ts               (eine Route, drei Handlungen ueber das Feld 'aktion')
  src/app/portal/[mandant]/objekte/neu/page.tsx
  src/app/portal/[mandant]/objekte/[id]/bearbeiten/page.tsx
  src/app/portal/[mandant]/objekte/ObjektFormular.tsx
  src/lib/i18n/verwaltung/objekte.ts        (de + en; Fachbegriffe bleiben deutsch, Erklaerung daneben)
  tests/isolation/objekt-anlegen.test.ts
Ebenso src/server/services/crm/anlegen.ts (Nummernbildung im selben INSERT).

DATENBANK (nur lesen bzw. in einer Transaktion, die du ZURUECKROLLST):
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 55432 -U postgres -d postgres

REGISTER, die ein neuer Weg beruehrt:
  src/server/registry/dienste.ts            (jeder Dienst unter services/ MUSS hier stehen)
  src/server/auth/route-manifest.ts         (jede api/-Route mit ihrem Recht)
  src/server/registry/routen.generiert.ts   (generiert aus docs/architecture/04-SEITENKARTE.md via 'pnpm seitenkarte')
  src/server/auth/katalog.generiert.ts      (die Rechte; das Aktionsvokabular ist GESCHLOSSEN)
  src/server/registry/navigation.ts, src/server/registry/modul.ts
EINGEFRORENE LISTEN, die nur SCHRUMPFEN duerfen:
  tests/kern/mandanten-tor.test.ts  OHNE_EIGENES_TOR
  scripts/guards/uebersetzung-ausnahmen.ts  UEBERSETZUNG_AUSNAHMEN
  tests/kern/verweis-rechte.test.ts  OHNE_BEDINGUNG
WACHEN, die einen neuen Weg abweisen:
  pnpm guards  ->  seite-ohne-uebersetzung (neue Seiten MUESSEN de+en koennen),
                   todo-client-nicht-im-register (jedes TODO(client, O-NN) braucht eine Zeile in docs/DECISIONS.md)
  tests/kern/verweis-rechte.test.ts erkennt eine Bewachung NUR am Literal
  darf['recht.x'] bzw. haeltRechte(..., 'recht.x') — eine Konstante ist dort unsichtbar.

Antworte NUR mit Tatsachen, die du an Datei und Zeile oder an einer psql-Ausgabe belegt hast.
Aendere KEINE Datei im Repository.
`

const BEREICHE = [
  {
    key: 'revier',
    titel: 'V-002 — ein Revier (Reinigungsflaeche) anlegen und archivieren',
    hinweis: `Belege: src/app/portal/[mandant]/reinigung/reviere/neu/page.tsx ist ein Platzhalter;
src/server/services/reinigung/revier.ts:42 nennt "anlegen" und "archivieren" als Loesung — beide gibt es nicht.
Kernfragen: Welche Tabelle(n)? Wie haengen Revier, Raum und Objekt zusammen (revier_raum?)?
Was ist beim Umschneiden die Regel, auf die revier.ts:42 sich beruft? Welche Nummer/Bezeichnung traegt ein Revier?
Welches Recht? Was passiert mit Einsaetzen, die auf ein Revier zeigen (einsatz.revier_id existiert)?`,
  },
  {
    key: 'bauprojekt',
    titel: 'V-003 — ein Bauprojekt anlegen',
    hinweis: `Belege: src/server/db/seed/bau.ts:564 ist der einzige Erzeuger; src/app/api/auftrag/route.ts:126 kennt keinen Anlegezweig.
Zwanzig gebaute Projektseiten sind fuer neue Vorhaben unerreichbar.
Kernfragen: Tabelle 'projekt' — Pflichtfelder, Projektnummer, Bezug zu auftrag/kunde/objekt?
Braucht ein Projekt zwingend einen Auftrag? Welches Recht (bau.schreiben?)? Welche Seite waere der Ort fuer den Knopf?`,
  },
  {
    key: 'veranstaltung',
    titel: 'V-004 — eine Veranstaltung (Security) anlegen',
    hinweis: `Belege: src/server/db/seed/security.ts:356 ist der einzige Erzeuger. Die Veranstaltung ist der DRITTE Ursprung eines Einsatzes
(neben Turnus und Posten) und damit heute tot. Auch: src/app/portal/[mandant]/security/veranstaltungen/[id] ist von nirgends verlinkt (V-045).
Kernfragen: Tabelle, Pflichtfelder, Zeitfelder (TIMESTAMPTZ + *_lokal? endet_am_folgetag?), Bezug zu objekt/kunde,
wie der Besetzungsdienst daran haengt, welches Recht.`,
  },
  {
    key: 'kunde-aendern',
    titel: 'V-017/V-018/V-019 — Kundenstammdaten aendern, Kunde archivieren, Ansprechpartner pflegen',
    hinweis: `Belege: src/server/services/crm/anlegen.ts:77 hat KEINE Aenderungsfunktion — Stammdaten sind nach dem Anlegen unveraenderlich.
drizzle/0020_crm_identitaet.sql:176 (kunde.archiviert_am schreibt nichts) und :261 (Ansprechpartner: nur die Rechtsgrundlage ist aenderbar).
Kernfragen: Welche Spalten von 'kunde' sind cse_app SPALTENWEISE entzogen (Debitorennummer, Zahlungsziel, Mahnsperre — K-05)?
Welche duerfen also gar nicht blind ersetzt werden? Wie aendert man die Rechtsgrundlage heute (welcher Dienst)?
Welche Seite traegt schon ein Formular, an das sich anknuepfen laesst (crm/kunden/[id])? Was verlangt kunde.status='gesperrt' (UWG-Sperre, V-087)?`,
  },
]

const FUND = {
  type: 'object',
  properties: {
    tabelle: { type: 'string', description: 'Die Zieltabelle(n), mit Migrationsdatei und Zeile' },
    pflichtfelder: {
      type: 'array',
      items: {
        type: 'object',
        properties: { spalte: { type: 'string' }, typ: { type: 'string' }, grund: { type: 'string' } },
        required: ['spalte', 'typ'],
      },
    },
    enums: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, werte: { type: 'array', items: { type: 'string' } } },
        required: ['name', 'werte'],
      },
    },
    constraints: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, definition: { type: 'string' }, bedeutung: { type: 'string' } },
        required: ['name', 'definition'],
      },
    },
    trigger: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, wirkung: { type: 'string' } },
        required: ['name', 'wirkung'],
      },
    },
    rls: { type: 'string', description: 'Die Policies auf der Tabelle und was ihr with-check verlangt' },
    recht: { type: 'string', description: 'Der Rechteschluessel aus katalog.generiert.ts, mit Zeile' },
    nummernkreis: { type: 'string', description: 'Traegt die Zeile eine Nummer? Woraus entsteht sie heute?' },
    vorhandeneDienste: { type: 'array', items: { type: 'string' } },
    vorhandeneSeiten: { type: 'array', items: { type: 'string' } },
    platzhalter: { type: 'string' },
    seitenkarte: { type: 'array', items: { type: 'string' }, description: 'Zeilen aus 04-SEITENKARTE.md, die dieser Bereich schon fuehrt' },
    apiRouten: { type: 'array', items: { type: 'string' } },
    knopfOrt: { type: 'string', description: 'Die Datei und Stelle, an der der Knopf sitzen muesste' },
    offeneFragen: { type: 'array', items: { type: 'string' }, description: 'Was NUR der Auftraggeber entscheiden kann — als TODO(client, O-NN) Kandidat' },
    empfehlung: { type: 'string', description: 'Der konkrete Bauplan in Saetzen: welche Dateien, welche Funktionen, welche Reihenfolge' },
  },
  required: ['tabelle', 'pflichtfelder', 'recht', 'empfehlung'],
}

const FALLEN = {
  type: 'object',
  properties: {
    fehlerkette: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          versuch: { type: 'string' },
          fehler: { type: 'string', description: 'Die WOERTLICHE Postgres-Meldung' },
          loesung: { type: 'string' },
        },
        required: ['fehler', 'loesung'],
      },
    },
    funktionierenderInsert: { type: 'string', description: 'Das vollstaendige INSERT, das am Ende durchlief' },
    wachen: { type: 'array', items: { type: 'string' }, description: 'Welche guards/Tests der neue Weg ausloesen wird, und was sie verlangen' },
    eingefroreneListen: { type: 'array', items: { type: 'string' }, description: 'Welche Zeile aus welcher eingefrorenen Liste GESTRICHEN werden muss' },
    warnungen: { type: 'array', items: { type: 'string' } },
  },
  required: ['funktionierenderInsert', 'fehlerkette'],
}

const ergebnisse = await pipeline(
  BEREICHE,
  (b) => agent(
    `${REFERENZ}

AUFGABE — ${b.titel}

${b.hinweis}

Erkunde vollstaendig und belege jede Aussage. Arbeite dich durch:
1. Die Migration(en): Tabellendefinition, jede NOT-NULL-Spalte, jeder CHECK, jeder UNIQUE-Index (auch Teilindizes!), jeder FOREIGN KEY.
2. Die Datenbank selbst: alle Enum-Wertebereiche (enum_range), alle Constraints (pg_get_constraintdef), alle Trigger auf der Tabelle.
3. Die RLS-Policies: welche Rolle darf einfuegen, was verlangt das with-check.
4. Das Recht in katalog.generiert.ts (exakter Schluessel und Zeile).
5. Welche Dienste, Routen und Seiten es zu diesem Bereich SCHON gibt.
6. Wo der Knopf sitzen muesste, und ob die Seitenkarte die Zieladresse schon fuehrt.
7. Was NUR der Auftraggeber entscheiden kann (Nummernkreise, Pflichtfelder mit Rechtsbezug) — das wird ein TODO(client, O-NN), nie eine stille Annahme.`,
    { label: `erkunden:${b.key}`, phase: 'Erkunden', schema: FUND },
  ),
  (fund, b) => agent(
    `${REFERENZ}

AUFGABE — ${b.titel}: DIE FALLEN FINDEN, BEVOR SIE ZUSCHNAPPEN.

Die Erkundung hat ergeben:
${JSON.stringify(fund, null, 1)}

Beim Objekt-Weg kosteten genau solche Fallen SECHS Anlaeufe, und JEDE davon war
erst an der echten Datenbank sichtbar — nicht im Migrationstext:
  - einsatz_quelle kennt 'manuell', nicht 'serie'
  - beginn_lokal ist NOT NULL, obwohl beginn_zeitpunkt gesetzt war
  - einsatz_akteur_stimmig verlangt erstellt_von_art='system', wenn kein Benutzer da ist
  - einsatz_folgetag schlug zu, weil now()+8h ueber Mitternacht lief
  - ein Trigger verlangte einen Kunden am Objekt ODER an der Schicht

Mach jetzt dasselbe fuer DIESEN Bereich, und zwar AN DER ECHTEN DATENBANK:
oeffne eine Transaktion, versuche den minimalen INSERT, lies den Fehler, ergaenze,
versuche erneut — bis die Zeile durchlaeuft. Dann ROLLBACK. Protokolliere JEDEN
Zwischenfehler woertlich mit seiner Loesung.

Beispiel des Vorgehens:
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 55432 -U postgres -d postgres <<'SQL'
  begin;
  insert into <tabelle> (...) values (...);
  rollback;
  SQL

Pruefe ausserdem:
  - Welche der eingefrorenen Listen eine Zeile VERLIERT, wenn dieser Weg gebaut wird
    (OHNE_EIGENES_TOR, UEBERSETZUNG_AUSNAHMEN, OHNE_BEDINGUNG) — nenne die exakte Zeile.
  - Welche Tests der Weg beruehrt (grep in tests/kern und tests/isolation).
  - Ob die Zieladresse in 04-SEITENKARTE.md schon steht, oder ob eine Zeile dazu muss.
  - Ob das Aktionsvokabular (berechtigung_aktion) das noetige Recht ueberhaupt hergibt.`,
    { label: `fallen:${b.key}`, phase: 'Fallen', schema: FALLEN },
  ),
)

return BEREICHE.map((b, i) => ({ bereich: b.key, titel: b.titel, fallen: ergebnisse[i] }))
