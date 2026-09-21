export const meta = {
  name: 'cse-abgleich-masterspec',
  description: 'Die 33 Abschnitte der Masterspezifikation gegen den gemessenen Bestand — jede Zusage mit Datei und Zeile, jede Luecke benannt',
  phases: [
    { title: 'Messen', detail: 'Je Spezifikationsblock: was ist gebaut, was fehlt, was ist bewusst anders' },
    { title: 'Gegenprobe', detail: 'Jede Behauptung „gebaut" auf ERREICHBARKEIT und SCHREIBWEG pruefen' },
  ],
}

const RAHMEN = `
DU MISST EINEN BESTEHENDEN, WEIT FORTGESCHRITTENEN BESTAND — du baust nichts.
Das Repository liegt in /home/user/cse-platform. 374 Migrationen, 441 Routen,
3641 Unit- und 2982 Isolationstests. Aendere KEINE Datei.

DEINE AUFGABE: die Zusagen EINES Blocks der Master-Spezifikation gegen den
gemessenen Bestand halten. Jede Aussage MUSS an Datei und Zeile belegt sein
oder an einer Befehlsausgabe. Vermutungen sind wertlos.

VIER URTEILE, und nur diese:
  gebaut          — vorhanden UND vom Portal aus erreichbar UND es gibt einen Schreibweg,
                    wo die Zusage einen verlangt. Beleg: Datei:Zeile.
  teilweise       — vorhanden, aber unvollstaendig. Sage GENAU, was fehlt.
  fehlt           — nicht vorhanden. Beleg: der grep, der nichts findet.
  bewusst_anders  — die Plattform macht es absichtlich anders, mit Begruendung
                    in docs/DECISIONS.md oder CLAUDE.md. Nenne die Fundstelle.

„VORHANDEN" IST NICHT „GEBAUT". Der Bestand hat ein gemessenes Muster: 21 fertige
Bildschirme waren aus keiner Navigation erreichbar, und 16 Tabellen hatten
ausser dem Seed keinen einzigen Schreibweg. Pruefe deshalb IMMER beides:
  1. Fuehrt ein Weg hin? (src/server/registry/navigation.ts, tableiste.ts,
     Verweise anderer Seiten)
  2. Gibt es einen Schreibweg ausserhalb von src/server/db/seed/?
     (grep nach 'insert into <tabelle>' ausserhalb von seed/)
docs/VOLLSTAENDIGKEIT.md fuehrt 136 schon bekannte Luecken als V-001..V-102.
Wenn dein Befund dort schon steht, NENNE DIE NUMMER statt ihn neu zu erfinden.

WAS BEWUSST NICHT GEBAUT WIRD (CLAUDE.md, Abschnitt „Out of scope"):
  - Kaltakquise an gescrapte Kontakte: § 7 UWG verbietet unaufgeforderte
    elektronische Werbung ohne vorherige ausdrueckliche Einwilligung, auch B2B.
    Ausgehende Nachrichten gibt es NUR an Kontakte mit erfasster Rechtsgrundlage.
  - Scraping von Indeed/StepStone: AGB-Verstoss und DSGVO-Risiko.
    Recruiting laeuft ueber EINGEHENDE Bewerbungen.
  - Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuereinreichung.
  - Automatische Einreichung bei Vergabeplattformen (es gibt keine API).
Wo die Spezifikation eines davon verlangt, ist das Urteil 'bewusst_anders' —
NICHT 'fehlt'. Nenne die Begruendung und WAS STATTDESSEN da ist.

NUETZLICHE MESSPUNKTE:
  docs/SPEC.md, docs/DECISIONS.md, docs/VOLLSTAENDIGKEIT.md, docs/DESIGN.md,
  docs/architecture/04-SEITENKARTE.md (die Seitenkarte),
  src/server/registry/routen.generiert.ts (alle 441 Routen mit Recht und Phase),
  src/server/registry/navigation.ts (was in der Seitenleiste steht),
  src/server/registry/dienste.ts (jeder Dienst und ob er schreibt),
  src/server/auth/katalog.generiert.ts (alle Rechte je Rolle),
  src/server/auth/route-manifest.ts (jede api-Route mit ihrem Recht),
  src/server/registry/integrationen.ts (was verbunden ist und was nicht),
  drizzle/ (374 Migrationen), src/app/ (die Seiten), tests/
  Datenbank: PGPASSWORD=postgres psql -h 127.0.0.1 -p 55432 -U postgres -d postgres
`

const BLOECKE = [
  {
    key: 'website',
    titel: '§1 Geschaeftsstruktur und §2 oeffentliche Website',
    zusagen: `§1 Vier Geschaeftsbereiche unter EINER Plattform, jeder mit eigener Identitaet,
Profil, Leistungen, Projekten, Bildern, Inhalten: CSE Dienstleistungen (Reinigung),
CSE Security, REALTIME Service GmbH (Bau), CSE Operations (Digital/KI/Steuerung).
§2 Oeffentliche Website mit GENAU diesen Seiten — pruefe jede einzeln:
Home · Unternehmen · CSE Dienstleistungen · CSE Security · REALTIME Service GmbH ·
CSE Operations · Leistungen · Projekte · Ueber uns · News/Beitraege · Kontakt ·
Angebot anfragen · Login.
Startseite muss sofort vermitteln, dass CSE mehrere Dienste unter einer Gruppe buendelt.
Die vier Bereiche als grosse visuelle Profilkarten. Viele hochwertige Bilder.
Kein Science-Fiction-Look, sondern serioeses modernes deutsches Unternehmen.
Bestehende Website https://www.cse-dienstleistungen.de/ als Ausgangspunkt,
nuetzliche Firmen-/Leistungsinformationen uebernehmen.`,
  },
  {
    key: 'profile',
    titel: '§3 Firmenprofile (Instagram-inspiriert)',
    zusagen: `Jeder Geschaeftsbereich hat ein eigenes Profil mit: Logo · Profil-/Firmenbild ·
Beschreibung · Leistungen · Bilder · Projekte · Beitraege · News · Kontakt ·
Angebot anfragen · Firmendaten.
Nutzer muessen zwischen den Firmen blaettern und leicht wechseln koennen.
Instagram-inspiriert, aber es bleibt eine professionelle Geschaeftsplattform.
Pruefe besonders: LASSEN sich Logo, Avatar und Titelbild ueberhaupt SETZEN?
Gibt es einen Behaelter (Storage-Bucket) und ein Feld dafuer?`,
  },
  {
    key: 'auth-rollen',
    titel: '§4 Authentifizierung, §5 Super Admin, §6 Admin, §7 Leitung',
    zusagen: `§4 Echtes Anmeldesystem mit fuenf Rollen: SUPER ADMIN · ADMIN · MANAGEMENT/LEITUNG ·
EMPLOYEE/MITARBEITER · CUSTOMER/KUNDE.
§5 Super Admin erreicht ALLE vier Bereiche und verwaltet: Firmen · Benutzer ·
Mitarbeiter · Leitung · Kunden · Leads · CRM · Projekte · Auftraege · Angebote ·
Rechnungen · Umsatz · Ausgaben · Gewinn · Dokumente · Kalender · Social Media ·
KI-Agenten · Berichte · Einstellungen · Berechtigungen.
§6 Admin verwaltet die ihm zugewiesenen Bereiche: Kunden · Mitarbeiter · Projekte ·
Auftraege · Dokumente · Angebote · Aufgaben · Berichte. Berechtigungen KONFIGURIERBAR.
§7 Leitung sieht NUR den ihr zugewiesenen Bereich und die ihr zugewiesenen Teams;
kann Mitarbeiter verwalten, Plaene sehen, Mitarbeiter einteilen, Projekte und
Auftraege verwalten, Kunden sehen, Aufgaben verwalten, Antraege genehmigen.
Pruefe je Punkt: gibt es die Seite, haelt die Rolle das Recht, ist sie erreichbar?
Pruefe ausdruecklich: sind Berechtigungen KONFIGURIERBAR (eine Oberflaeche, die
rolle_berechtigung schreibt) — oder nur anzeigbar?`,
  },
  {
    key: 'portale',
    titel: '§8 Mitarbeiterportal und §9 Kundenportal',
    zusagen: `§8 Mitarbeiter: sehr einfache Oberflaeche, nur was die Arbeit betrifft —
Meine Einsaetze · Mein Plan · Meine Projekte · Arbeitszeiten · Dokumente ·
Aufgaben · Nachrichten · Urlaub/Antraege. KEINE vertraulichen Firmendaten.
§9 Kunden: eigenes Portal, NUR die eigenen — Projekte · Auftraege · Angebote ·
Dokumente · Rechnungen · Nachrichten · Anfragen.
Pruefe fuer beide: welche Seiten existieren, welche sind ERREICHBAR (Navigation!),
und welche Funktion fehlt. Beachte: die Kundennavigation ist gebaut, wird aber
moeglicherweise von keiner Komponente gerendert (V-043) — pruefe das nach.`,
  },
  {
    key: 'dashboard',
    titel: '§10 Haupt-Dashboard und §26 Berichte',
    zusagen: `§10 Super-Admin-Dashboard zeigt: aktive Auftraege · aktive Projekte · Mitarbeiter ·
aktuell arbeitende Mitarbeiter · neue Leads · offene Angebote · offene Rechnungen ·
Umsatz · Ausgaben · Gewinn · Benachrichtigungen · anstehende Aufgaben ·
letzte Aktivitaet. Filter: alle Firmen / je Firma. Auf einen Blick verstaendlich.
§26 Berichte fuer: Umsatz · Ausgaben · Gewinn · Auftraege · Leads · Conversion ·
Mitarbeiter · Projekte · Leistung je Geschaeftsbereich.
Pruefe JEDE Kachel einzeln. Beachte V-072: die Kachel „Aktuell im Einsatz" (DSH-05)
soll fehlen, obwohl ihr Dienst fertig ist — bestaetige oder widerlege das.`,
  },
  {
    key: 'crm-vertrieb',
    titel: '§11 CRM, §12 KI-Vertriebsagent, §13 KI-Ansprache',
    zusagen: `§11 Vollstaendiges CRM: Firmen · Kontakte · Leads · Lead-Score · Lead-Status ·
Notizen · Kommunikationshistorie · Wiedervorlagen · Angebote · Auftraege · Kundenhistorie.
§12 (AUSDRUECKLICH HOECHSTE PRIORITAET) KI-Vertriebsagent findet moegliche Kunden:
Hausverwaltungen, Immobilienfirmen, Hotels, Bueros, Baufirmen, Eventfirmen,
Gewerbeimmobilien, Facility Management, Betriebe mit Reinigungs-, Sicherheits- oder
Baubedarf, passende Ausschreibungen soweit technisch und rechtlich moeglich.
Leaddatenbank je Lead: Firma · Branche · Ort · Website · Kontaktdaten soweit
rechtlich verfuegbar · moegliche CSE-Leistung · Relevanzgrund · Lead-Score ·
Prioritaet · Status · letzter Kontakt · naechste Handlung.
Die KI soll die Firma analysieren und den passenden Geschaeftsbereich bestimmen.
§13 Ansprachekette: FINDEN → ANALYSIEREN → BEDARF ERKENNEN → BEREICH WAEHLEN →
PERSONALISIERTE NACHRICHT → MENSCHLICHE PRUEFUNG → BEARBEITEN → FREIGEBEN →
SENDEN → ANTWORT VERFOLGEN → NACHFASSEN → ANGEBOT → AUFTRAG.
Die KI darf NIE ohne menschliche Freigabe senden.
WICHTIG: § 7 UWG steht dieser Zusage teilweise entgegen (siehe Rahmen oben).
Miss GENAU, was gebaut ist, was bewusst anders ist und WARUM — und was
tatsaechlich fehlt. Beachte V-101 (sendeNachAussen ohne Aufrufer), V-077
(Lead-Status nicht setzbar), V-079 (Wiedervorlage niemandem zuweisbar).`,
  },
  {
    key: 'recruiting',
    titel: '§14 Recruiting-Agent',
    zusagen: `Helfen beim Finden von Mitarbeitern: Personalbedarf erkennen · Stellenbeschreibungen
erstellen · Stellenanzeigen vorbereiten · Bewerbungen organisieren · Bewerberdaten
extrahieren · Bewerber gegen Anforderungen abgleichen · Bewerber ranken ·
Interviewfragen vorbereiten · Termine planen helfen.
Genannte Plattformen: Indeed, StepStone, weitere.
Einstellungsentscheidungen bleiben beim Menschen. Keine vorgetaeuschten Integrationen.
WICHTIG: Scraping von Indeed/StepStone ist bewusst ausgeschlossen (siehe Rahmen).
Miss, was ueber EINGEHENDE Bewerbungen gebaut ist, und beurteile jeden Punkt
einzeln. Beachte V-037/V-094: die Antwort an eine Bewerberin (§ 22 AGG) soll
keinen Ausloeser haben.`,
  },
  {
    key: 'operations',
    titel: '§15 Operations, §16 Mitarbeiterverwaltung, §24 Kalender',
    zusagen: `§15 Auftraege · Projekte · Standorte · Mitarbeiter · Teams · Einteilungen ·
Plaene · Aufgaben · Fristen · Status · Dokumente.
Beispiel aus der Spezifikation: ein neuer Reinigungsvertrag entsteht; das System soll
helfen zu bestimmen: Standort · benoetigte Mitarbeiter · benoetigte Stunden ·
benoetigte Ausruestung · Startdatum · verantwortliche Leitung.
PRUEFE DIESES BEISPIEL DURCH — es ist der Kern der Zusage.
§16 Mitarbeiterprofile: Name · Kontakt · Rolle · Geschaeftsbereich · Qualifikationen ·
zugewiesene Projekte · Arbeitszeiten · Plan · Dokumente · Status.
Sensible Daten nur fuer Berechtigte.
§24 Zentraler Kalender fuer: Projekte · Mitarbeitereinsaetze · Besprechungen ·
Kundentermine · Fristen · Wiedervorlagen · Vorstellungsgespraeche.`,
  },
  {
    key: 'social-dokumente',
    titel: '§17 Social-Media-Center, §23 Dokumentencenter, §25 Benachrichtigungen',
    zusagen: `§17 Vier Profile aus EINEM System verwalten: Beitraege · Bilder · Projekte ·
News · Updates. Spaeter Instagram, Facebook, LinkedIn, TikTok, YouTube.
Keine vorgetaeuschten Integrationen; Architektur so, dass echte APIs anschliessbar sind.
§23 Zentrale Dokumentenverwaltung, Kategorien: Kundendokumente · Vertraege ·
Angebote · Rechnungen · Belege · Mitarbeiterdokumente · Projektdokumente ·
Buchhaltungsdokumente · Firmendokumente.
Funktionen: Hochladen · Suchen · Filtern · sichere Ablage · Zugriffssteuerung ·
Versionierung wo sinnvoll.
§25 Benachrichtigungen bei: neuem Lead · Kundenantwort · neuem Auftrag · neuer
Bewerbung · fehlendem Dokument · faelliger Rechnung · wichtiger Frist ·
KI-Freigabeanfrage · Planaenderung fuer Mitarbeiter. PRUEFE JEDEN DER NEUN ANLAESSE.`,
  },
  {
    key: 'finanzen',
    titel: '§18 Finanzcenter, §19 KI-Finanzagent, §20 DATEV',
    zusagen: `§18 Eingangsrechnungen · Ausgangsrechnungen · Belege · Ausgaben · Umsatz ·
Zahlungen · offene Rechnungen · Finanzberichte · Buchhaltungsunterlagen.
§19 Beleg hochladen, KI extrahiert: Lieferant · Rechnungsnummer · Datum ·
Nettobetrag · USt · Bruttobetrag · Kategorie · zugeordnete Firma.
Kette: HOCHLADEN → KI-EXTRAKTION → VALIDIERUNG → MENSCHLICHE PRUEFUNG →
FREIGABE → BUCHHALTUNG/DATEV.
§20 Architektur fuer eine ECHTE DATEV-Anbindung; KEINE vorgetaeuschte DATEV-API.
Beachte Invariante 6 aus CLAUDE.md: die KI rechnet NIE Geld — sie liest,
extrahiert, klassifiziert, entwirft. Pruefe, ob das eingehalten ist.
Beachte V-006 (Lieferant nicht anlegbar), V-007 (Bankkonto nicht anlegbar),
V-011 (Ausgabe nicht erfassbar), V-027 (DATEV-Stapel nicht quittierbar).`,
  },
  {
    key: 'ki-agenten',
    titel: '§21 CEO-KI-Assistent und §22 KI-Agenten-Center',
    zusagen: `§21 Zentraler Assistent fuer den Super Admin. Er muss diese Fragen aus der
ECHTEN Datenbank beantworten koennen — pruefe jede einzeln gegen die vorhandenen
Werkzeuge des Agenten:
  „Wie viele Mitarbeiter arbeiten heute?"
  „Wie viele aktive Auftraege haben wir?"
  „Welche Leads sollten wir heute kontaktieren?"
  „Welche Kunden haben nicht geantwortet?"
  „Wie viel Umsatz hat die Reinigung diesen Monat gemacht?"
  „Welche Rechnungen sind unbezahlt?"
  „Welche Projekte brauchen Mitarbeiter?"
  „Was sind die wichtigsten Dinge, die ich heute erledigen muss?"
Keine erfundenen Datenbankinhalte.
§22 Agenten-Center mit ACHT Agenten: CEO-Assistent · Vertrieb/Auftragsakquise ·
Recruiting · Finanzen · Operations · Social Media · Analytics · Kundensupport.
Je Agent: Name · Beschreibung · Status · Aufgaben · Aktivitaet · Protokolle ·
Berechtigungen · verbundene Werkzeuge · Freigabepflichten.
PRUEFE, WELCHE DER ACHT TATSAECHLICH EXISTIEREN. Beachte V-015: ein Agentenbudget
soll nicht setzbar sein, und ohne Budget laeuft kein Agent — pruefe das nach.`,
  },
  {
    key: 'technik',
    titel: '§27 Technologie, §28 Datenbank, §29 Sicherheit',
    zusagen: `§27 Next.js · TypeScript · Tailwind · Supabase · PostgreSQL · Supabase Auth ·
Supabase Storage · OpenAI · n8n wo sinnvoll · GitHub · Vercel. Modular und skalierbar.
§28 Relationale Datenbank mit mindestens diesen Entitaeten — pruefe JEDE einzeln
und nenne die tatsaechliche Tabelle (die Plattform benennt fachlich deutsch):
users · roles · permissions · companies · employees · customers · contacts · leads ·
projects · orders · offers · invoices · expenses · payments · documents · schedules ·
tasks · messages · notifications · social_posts · ai_agents · ai_runs · activity_logs.
Ordentliche Beziehungen und Constraints.
§29 Sicherheit: Authentifizierung · rollenbasierte Zugriffssteuerung ·
Autorisierung auf DATENBANKEBENE · geschuetzte Routen · sichere API-Routen ·
Eingabevalidierung · Audit-Logs · sicherer Dokumentenzugriff · Umgebungsvariablen ·
keine API-Schluessel im Frontend. Niemals nur Frontend-Sichtbarkeit als Schutz.
Belege §29 mit den RLS-Policies und dem Rechtekatalog, nicht mit Behauptungen.`,
  },
  {
    key: 'design-mobil',
    titel: '§30 Design, §31 Mobil, §32 Entwicklungsregel',
    zusagen: `§30 Professionell · modern · hochwertig · klar · vertrauenswuerdig · leicht zu
bedienen · bildstark · responsiv · deutscher Geschaeftsstil. Rot, Schwarz, Weiss,
Grau. NICHT uebertrieben futuristisch.
§31 Muss richtig laufen auf iPhone, Android, Tablet, Desktop. Mitarbeiter muessen
die wichtigsten Funktionen vom Telefon aus nutzen koennen.
§32 Keine vorgetaeuschte Funktionalitaet. Wo eine externe API fehlt:
Architektur bauen, Schnittstelle anlegen, KLAR kennzeichnen, was Zugangsdaten
braucht, den Rest lauffaehig halten. Bestehendes nie kaputtmachen.
Pruefe §32 HART: suche nach vorgetaeuschten Integrationen im ganzen Baum.
src/server/registry/integrationen.ts ist der Ausgangspunkt. Pruefe auch, ob
die Oberflaeche „nicht verbunden" tatsaechlich ANZEIGT.
Fuer §31: miss die Tap-Ziele (DESIGN §8 verlangt 44px) und die Telefonleiste
(src/server/registry/tableiste.ts).`,
  },
]

const MESSUNG = {
  type: 'object',
  properties: {
    abschnitt: { type: 'string' },
    punkte: {
      type: 'array',
      description: 'Ein Eintrag je EINZELNER Zusage des Blocks — lieber zu fein als zu grob',
      items: {
        type: 'object',
        properties: {
          anforderung: { type: 'string', description: 'Die Zusage, in einem Satz' },
          zustand: { type: 'string', enum: ['gebaut', 'teilweise', 'fehlt', 'bewusst_anders'] },
          beleg: { type: 'string', description: 'Datei:Zeile oder Befehlsausgabe — ohne Beleg zaehlt der Punkt nicht' },
          erreichbar: { type: 'string', description: 'Fuehrt ein Weg aus dem Portal hin? Woher? Oder: nein, und warum' },
          schreibweg: { type: 'string', description: 'Gibt es einen Schreibweg ausserhalb von db/seed/? Welchen?' },
          luecke: { type: 'string', description: 'Was genau fehlt, wenn nicht gebaut' },
          vNummer: { type: 'string', description: 'Die V-Nummer aus docs/VOLLSTAENDIGKEIT.md, falls die Luecke dort schon steht' },
        },
        required: ['anforderung', 'zustand', 'beleg'],
      },
    },
    gesamturteil: { type: 'string', description: 'Zwei bis vier Saetze: wie steht dieser Block insgesamt da' },
    schwerste: { type: 'array', items: { type: 'string' }, description: 'Die drei schwersten Luecken dieses Blocks' },
  },
  required: ['abschnitt', 'punkte', 'gesamturteil'],
}

const PRUEFUNG = {
  type: 'object',
  properties: {
    widerlegt: {
      type: 'array',
      description: 'Punkte, die als „gebaut" gemeldet wurden und es NICHT sind',
      items: {
        type: 'object',
        properties: {
          anforderung: { type: 'string' },
          behauptet: { type: 'string' },
          tatsaechlich: { type: 'string' },
          beleg: { type: 'string' },
          neuerZustand: { type: 'string', enum: ['gebaut', 'teilweise', 'fehlt', 'bewusst_anders'] },
        },
        required: ['anforderung', 'tatsaechlich', 'beleg', 'neuerZustand'],
      },
    },
    bestaetigt: { type: 'array', items: { type: 'string' }, description: 'Punkte, deren „gebaut" die Gegenprobe ueberstanden hat' },
    zusaetzlich: {
      type: 'array',
      description: 'Luecken, die der Messung entgangen sind',
      items: {
        type: 'object',
        properties: { anforderung: { type: 'string' }, luecke: { type: 'string' }, beleg: { type: 'string' } },
        required: ['luecke', 'beleg'],
      },
    },
    urteil: { type: 'string' },
  },
  required: ['widerlegt', 'bestaetigt', 'urteil'],
}

const ergebnisse = await pipeline(
  BLOECKE,
  (b) => agent(
    `${RAHMEN}

BLOCK: ${b.titel}

DIE ZUSAGEN DER SPEZIFIKATION:
${b.zusagen}

Gehe JEDE einzelne Zusage durch — nicht den Block als Ganzes. Eine Aufzaehlung
mit zwoelf Punkten ergibt zwoelf Eintraege, nicht einen. Belege jeden mit
Datei:Zeile oder Befehlsausgabe, und pruefe bei jedem „gebaut" ZUSAETZLICH,
ob ein Weg hinfuehrt und ob es einen Schreibweg ausserhalb des Seeds gibt.`,
    { label: `messen:${b.key}`, phase: 'Messen', schema: MESSUNG },
  ),
  (messung, b) => agent(
    `${RAHMEN}

BLOCK: ${b.titel}

GEGENPROBE. Eine andere Stimme hat gemessen und dies gemeldet:
${JSON.stringify(messung, null, 1)}

Deine Aufgabe ist NICHT zu bestaetigen, sondern zu WIDERLEGEN. Nimm dir jeden
Punkt vor, der als 'gebaut' gilt, und versuche zu zeigen, dass er es nicht ist:

  1. ERREICHBARKEIT. Steht die Seite in navigation.ts oder tableiste.ts?
     Verlinkt sie irgendeine andere Seite? Fuehre den grep wirklich aus.
     Eine Seite, die es gibt und zu der kein Weg fuehrt, ist NICHT gebaut.
  2. SCHREIBWEG. Gibt es 'insert into <tabelle>' ausserhalb von src/server/db/seed/?
     Eine Flaeche, die nur zeigt, was der Seed angelegt hat, ist NICHT gebaut.
  3. RECHT. Haelt die Rolle, die die Zusage nennt, das Recht ueberhaupt?
     Pruefe src/server/auth/katalog.generiert.ts.
  4. VORGETAEUSCHT. Behauptet die Flaeche eine Verbindung, die es nicht gibt?
     Oder — genauso wichtig — sagt sie ehrlich „nicht verbunden"?
  5. HALBE UEBERSETZUNG. Die Verwaltung soll zweisprachig sein (D-82). Steht der
     Seitenrumpf in scripts/guards/uebersetzung-ausnahmen.ts? Dann bleibt er
     beim Sprachwechsel deutsch.

Melde zusaetzlich jede Luecke, die der Messung entgangen ist.
Sei streng. Ein falsches „gebaut" in diesem Bericht ist schlimmer als zehn
offene Punkte, weil es dem Auftraggeber sagt, er koenne etwas testen, was es nicht gibt.`,
    { label: `gegenprobe:${b.key}`, phase: 'Gegenprobe', schema: PRUEFUNG },
  ),
)

return BLOECKE.map((b, i) => ({ block: b.key, titel: b.titel, gegenprobe: ergebnisse[i] }))
