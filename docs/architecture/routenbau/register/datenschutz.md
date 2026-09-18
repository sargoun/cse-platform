# Registereintraege: datenschutz

Diese Eintraege hat der bauende Agent geliefert; sie sind **noch nicht** eingefuegt.
Die gemeinsamen Dateien pflegt EINE Hand, weil acht Agenten gleichzeitig im Baum
arbeiten und sich sonst in dieselbe Zeile schreiben. Ist ein Eintrag eingefuegt,
verschwindet er hier — diese Datei ist eine Warteschlange, kein Archiv.

## Migrationen (alle gegen eine eigene Datenbank gefahren: True)

- /home/user/cse-platform/drizzle/0220_betroffenenanfrage_rechte.sql — app.darf_betroffenenanfrage() + Ersatz der beiden Policies auf betroffenenanfrage (der Rechte-Bruch aus der Kritik), Fremdschluessel fuer ansprechpartner_id (zusammengesetzt, mit Mandant) und bewerbung_id, CHECK 'hoechstens eine Zuordnung', zwei Indizes
- /home/user/cse-platform/drizzle/0221_datenschutz_nachweis.sql — datenschutz_auskunft, berichtigung_feld, loeschentscheidung (je mit RLS/FORCE, Lesen = darf_betroffenenanfrage(), Schreiben = je Artikel sein eigenes Recht), Unique-Index loeschentscheidung_je_ort_uk auf coalesce(feld,''), app.benachrichtigung_auskunft(uuid) als Definer mit cse_definer-Grant und -Policy, Loeschsperrblock. NACH DER PRUEFUNG ergaenzt: `revoke all on function app.benachrichtigung_auskunft(uuid) from public` (K-08) und der Spaltenkommentar auf loeschentscheidung.sperre_faellt_am — sie heisst jetzt ausdruecklich „der ERSTE Tag, an dem geloescht werden darf".
- /home/user/cse-platform/drizzle/0222_werbewiderspruch.sql — werbewiderspruch_token (K-08/K-09, ohne Ablauf, cse_app hat GAR KEIN Recht darauf) und werbewiderspruch (Protokoll), app.darf_widerspruch_lesen(), app.werbewiderspruch_liste(), app.widerspruch_stand(), app.werbewiderspruch_token_ausgeben(), app.werbewiderspruch_token_mandant(), app.werbewiderspruch_einloesen() (bedingt + idempotent), app.werbewiderspruch_formular(), app.widerspruch_verarbeitung_setzen(), cse_definer-Grants und -Policies auf ansprechpartner/kunde, Loeschsperrblock.

  NACH DER PRUEFUNG geaendert, alles in DERSELBEN Datei (Nummernbereich 0220–0229):
  1. sieben `revoke all on function … from public` (K-08) — `definer-eigentum.test.ts` ist damit wieder gruen, nachgemessen gegen eine frisch migrierte w_dsch;
  2. `grant update` auf ansprechpartner/kunde ist SPALTENWEISE (`werbewiderspruch_am`, `widerspruch_am`); das `grant select` bleibt tabellenweit, weil 0246 sich in seinem eigenen Kommentar darauf stuetzt und eine Spaltenliste in 0222 die Spalten spaeterer Migrationen nicht nennen kann — das ist als offene technische Nachziehung unter „Sonstiges" notiert;
  3. `app.werbewiderspruch_formular(text)` → `(text, text)`: prueft jetzt selbst app.portal() (K-04), app.ist_readonly() (Invariante 10), `formular.schreiben` und das Ratenlimit;
  4. NEU `app.werbewiderspruch_drossel(text)` — fuenf tokenlose Widersprueche je IP-Abdruck in 15 Minuten, mandantenuebergreifend, ueber kern.anmeldeversuch (art = 'werbewiderspruch'); der Zaehler von `app.formular_eingang_zaehlen` taugte nicht, weil dieser Weg keine formular_eingang-Zeile anlegt;
  5. NEU `app.werbewiderspruch_token_auskunft(uuid)` — der Art.-15-Leseweg auf werbewiderspruch_token (cse_app hat dort kein Recht), ohne den Abdruck selbst;
  6. `app.widerspruch_stand(uuid, uuid)` gibt zusaetzlich `kunde_id` zurueck (Signaturaenderung der Rueckgabetabelle);
  7. `app.werbewiderspruch_einloesen(text)` hat VIER Staende statt drei: erfasst · verbraucht · ungueltig · unbekannt.

## Gebaute Routen

- `/portal/[mandant]/datenschutz/[id]` — fertig — Die Akte: Selbstauskunft getrennt von dem, was die Plattform weiss; Identitaetsabgleich mit Suche und drei Zielen (person/ansprechpartner/bewerbung, D-09) ueber ordneZu(); die Art.-21-Entscheidung, die die Seitenkarte §2.4 hierher legt und die es vorher NICHT gab (kein .ts nannte widerspruch_am) — unwiderruflich, mit Warnung vor dem Knopf, als variante=danger; Nachweisblock mit erteilten Auskuenften samt SHA-256; Abschluss gegen das bestehende /api/datenschutz/bearbeiten. Art. 18 und Art. 20 sind benannt statt verschwiegen: Art. 20 wird ueber den JSON-Abruf der Art.-15-Auskunft erfuellt, Art. 18 ist offen (O-647), weil das Datenmodell kein Merkmal 'eingeschraenkt' hat. Der Art.-21-Knopf erscheint nur, wenn der Stand wirklich gelesen wurde (extra.stand.length > 0) — 'every' auf einer leeren Liste ist true.
- `/portal/[mandant]/datenschutz/[id]/auskunft` — fertig — 20 Abschnitte, deklarativ, je Abschnitt Zweck (aus registry/verarbeitungen), Quelle, Aufbewahrungsfrist (aus verzeichnis.fristText) und das noetige Recht. Der Kritikpunkt ist geloest: die Rechte werden VOR der ersten Datenabfrage in EINER Abfrage geprueft; ein Abschnitt ohne Recht ist 'gesperrt', nicht leer, und der Abruf gibt 409 mit der Liste der fehlenden Rechte statt einer halben Datei. Der Abschnitt 'Benachrichtigungen' laeuft ueber die neue Definer-Funktion app.benachrichtigung_auskunft (cse_app liest sonst nur die eigenen), 'Rechtsgrundlage/Widersprueche' ueber app.widerspruch_stand (K-05). Agentenprotokolle/Wissens-Chunks/Freigaben stehen als eigener offener Abschnitt (O-113). md + json, protokolliert, Artefakt mit SHA-256 in datenschutz_auskunft.
- `/portal/[mandant]/datenschutz/[id]/berichtigung` — fertig — Der von der Kritik verlangte strukturierte Nachweis existiert jetzt (berichtigung_feld, 0221): je Feld gespeicherter Wert, behaupteter Wert, Herkunft, Ergebnis und die Art.-19-Unterrichtung als eigene Spalte. Der gespeicherte Wert wird bei der AUFNAHME mitgeschrieben — nachher ist er fort. Die Seite aendert fremde Tabellen nicht und verlinkt in den zustaendigen Editor. Das Tor ist datenschutz.berichtigung_bearbeiten, und seit 0220 sieht ein Traeger dieses Rechts den Vorgang auch.
- `/portal/[mandant]/datenschutz/[id]/loeschung` — fertig — 18 Orte mit Zeilenzahl, Loeschart aus rls.ts, Pflicht mit Fundstelle und dem Tag, an dem die Sperre faellt — gerechnet von aoFrist()/milogFrist() im Berliner Kalender (getestet, 17 Faelle). Ein Ort ohne Recht ist 'ungelesen', nicht leer. Der fuenfte Kritikpunkt ist beantwortet, nicht umgangen: es gibt keinen Vollzugsweg (ein loeschender Lauf, keine Anonymisierungsprozedur, kein Codepfad auf anonymisiert_am), deshalb heisst das Ergebnis VORMERKUNG, und VOLLZUG.vorhanden/fehlend steht sichtbar auf der Seite (O-644).
- `/portal/[mandant]/datenschutz/widersprueche` — fertig — Zwei getrennte Listen (§ 7 UWG vs. Art. 21, wie §2.4 verlangt) plus das Protokoll mit Weg, Kanal und ausloesender Nachricht. Der harte Blocker ist geloest: app.werbewiderspruch_liste() (0222) ist der mengenwertige K-05-Leseweg auf ansprechpartner — prueft crm.rechtsgrundlage_lesen und schreibt EINE Protokollzeile je Abruf, nicht eine je Zeile. Kein Zuruecknehmen-Knopf, mit Begruendung. O-640/O-641/O-65 stehen sichtbar als offen.
- `/werbewiderspruch (oeffentlich, tokenlos)` — fertig — NICHT in meinem Plan, aber im Typecheck-Filter genannt und Voraussetzung dafuer, dass das Nachweisblatt je etwas zeigt. Gesellschaftswahl im Formular (vier Verantwortliche), Antwort immer gleich (keine Auskunft ueber den Bestand), Schreibweg ueber den Eingangsprinzipal. ACHTUNG Ueberschneidung: /werbewiderspruch/[token]/page.tsx hat parallel die Domaene aufgaben-nachrichten-oeffentlich gebaut; ihre Seite postet 'token' an genau meine Route, die Staende erfasst|bereits|unbekannt passen zusammen, und ihr TOKEN_FORM (20–200 base64url) passt zu meinem neuerToken() (43 Zeichen). Bitte nur pruefen, nicht doppelt bauen.

## src/server/registry/dienste.ts

/*
 * Phase 7 — die INNERE Haelfte von LEG-09 (0220–0222). Alle vier schreiben,
 * und jeder schreibt genau das, was sein Artikel verlangt: das Artefakt, den
 * Feldnachweis, die Entscheidung, das Widerspruchsprotokoll. Keiner von
 * ihnen loescht oder aendert eine fremde Fachtabelle — die Berichtigung
 * geschieht im zustaendigen Editor, die Loeschung durch Anonymisierung
 * (04-SEITENKARTE §5.25).
 *
 * In der Gruppenansicht laufen sie nicht: jeder Schreibweg verlangt genau
 * EINEN aktiven Mandanten (Invariante 10).
 */
{
  modul: 'datenschutz', pfad: 'datenschutz/auskunft',
  schreibend: true, schreibRecht: 'datenschutz.auskunft_erstellen',
},
{
  modul: 'datenschutz', pfad: 'datenschutz/berichtigung',
  schreibend: true, schreibRecht: 'datenschutz.berichtigung_bearbeiten',
},
{
  modul: 'datenschutz', pfad: 'datenschutz/loeschentscheidung',
  schreibend: true, schreibRecht: 'datenschutz.loeschung_pruefen',
},
/*
 * `werbewiderspruch` hat DREI Schreibwege mit drei Pruefungen, und das
 * Register nennt einen — deshalb steht hier, welcher und warum:
 *
 *  - `setzeVerarbeitungswiderspruch` (Art. 21) ist der einzige, den ein
 *    Mensch im Portal ausloest. Er laeuft auf `M/datenschutz/[id]` (§2.4),
 *    und das Tor dieser Route ist `datenschutz.auskunft_erstellen` — das
 *    steht deshalb unten.
 *  - `gibTokenAus` prueft `crm.kommunikation_versenden` IN
 *    `app.werbewiderspruch_token_ausgeben`: wer senden darf, erzeugt den
 *    Pflichtlink dazu (§ 7 Abs. 3 Nr. 4 UWG).
 *  - `loeseEin` und `erfasseOhneToken` sind die oeffentlichen Pflichtwege.
 *    Sie halten kein Benutzerrecht; ihre Grenze ist der Token bzw. der
 *    Eingangsprinzipal mit `formular.schreiben` — und seit der Pruefrunde
 *    prueft `app.werbewiderspruch_formular` das SELBST (K-04,
 *    `app.ist_readonly()`, `formular.schreiben`) statt es dem Aufrufer zu
 *    glauben. Dazu ein Ratenlimit in derselben Transaktion
 *    (`app.werbewiderspruch_drossel`) und ein Honigtopf in der Seite.
 */
{
  modul: 'datenschutz', pfad: 'datenschutz/werbewiderspruch',
  schreibend: true, schreibRecht: 'datenschutz.auskunft_erstellen',
},

## src/server/auth/route-manifest.ts

// src/server/auth/route-manifest.ts — sechs neue route.ts (nur `route.ts`
// zaehlt tests/kern/routen*.test.ts; oeffentliche Seiten stehen nicht drin).
{
  pfad: 'api/datenschutz/zuordnen',
  recht: 'datenschutz.auskunft_erstellen',
  grund:
    'LEG-09, Art. 12 Abs. 6. Ein EIGENER Weg neben /bearbeiten, weil die Zuordnung das '
    + 'Gegenteil einer Entscheidung ist: sie ist eine Feststellung, sie ist aenderbar, und '
    + 'sie darf keinen Vorgang abschliessen. Am selben Knopf wie „Beantwortet" haette '
    + 'irgendwann ein Vorgang als entschieden gegolten, weil jemand den falschen Menschen '
    + 'gesucht hat. Art und Kennung kommen als EIN Wert (`person:uuid`).',
},
{
  pfad: 'api/datenschutz/auskunft',
  recht: 'datenschutz.auskunft_erstellen',
  grund:
    'LEG-09, Art. 15. Liefert die Auskunft nur AUSGELIEFERT, wenn sie vollstaendig ist — '
    + 'sonst 409 mit den fehlenden Rechten. Eine halbe Art.-15-Auskunft geht an die '
    + 'betroffene Person und sieht aus wie eine Antwort. Jeder Abruf wird protokolliert und '
    + 'mit seiner Pruefsumme in `datenschutz_auskunft` festgehalten (SEC-A9).',
},
{
  pfad: 'api/datenschutz/berichtigung',
  recht: 'datenschutz.berichtigung_bearbeiten',
  grund:
    'LEG-09, Art. 16 und Art. 19. Ausdruecklich NICHT `datenschutz.auskunft_erstellen`: die '
    + 'drei Datenschutzrechte im Katalog sind drei Zustaendigkeiten, und sie hier zu einem '
    + 'zu verschmelzen nahm dem Katalog die Unterscheidung, die er absichtlich trifft.',
},
{
  pfad: 'api/datenschutz/loeschung',
  recht: 'datenschutz.loeschung_pruefen',
  grund:
    'LEG-09, Art. 17 gegen LEG-01/LEG-02. Diese Route LOESCHT NICHTS — sie haelt eine '
    + 'Entscheidung je Tabelle fest (04-SEITENKARTE §5.25). Solange es keinen '
    + 'Anonymisierungsweg gibt, ist das Ergebnis eine Vormerkung (O-644), und die Seite '
    + 'nennt sie so.',
},
{
  pfad: 'api/datenschutz/widerspruch',
  recht: 'datenschutz.auskunft_erstellen',
  grund:
    'LEG-08/LEG-09, Art. 21. Der einzige Schreibweg des Hauses auf `widerspruch_am`; vorher '
    + 'nannte kein `.ts` die Spalte, obwohl die Seitenkarte die Entscheidung '
    + '`M/datenschutz/[id]` zuwies (§2.4). Das Recht ist das der Route und nicht '
    + '`crm.schreiben`: verlangte sie das, waere die Zusage fuer eine '
    + 'Datenschutzbeauftragte ohne CRM-Schreibrecht unerreichbar. Der Betroffene kommt aus '
    + 'der ZUORDNUNG des Vorgangs, nie aus dem Formular — die Wirkung ist unwiderruflich.',
},
{
  pfad: 'api/werbewiderspruch',
  recht: null,
  grund:
    'CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG: der Empfaenger muss „jederzeit" widersprechen '
    + 'koennen, ohne andere Kosten als die der Uebermittlung. Ein Konto davor waere das '
    + 'Gegenteil, und ein Ursprungstest sperrte jeden, der den Link aus seinem '
    + 'E-Mail-Programm oeffnet — den Regelfall. Der Schutz liegt nicht an der Tuer: mit '
    + 'Token entscheidet der bedingte Verbrauch in `app.werbewiderspruch_einloesen` (K-09), '
    + 'ohne Token der Eingangsprinzipal mit `formular.schreiben` und ohne jedes Leserecht. '
    + 'Die Antwort verraet nie, ob eine Adresse im Bestand war.',
},

## src/server/db/schema/rls.ts

// src/server/db/schema/rls.ts — fuenf Eintraege in KEIN_HARD_DELETE, ALLE
// `append`. Die REIHENFOLGE ist wichtig: scripts/generate-triggers.ts erzeugt
// den Block je Migration in der Array-Reihenfolge, und die handgeschriebenen
// Bloecke in 0221/0222 stehen genau so. `pnpm db:triggers --check` ist damit
// nach dem Einfuegen gruen, ohne dass sich eine Datei aendert.
//
// Fuer 0221, in dieser Reihenfolge:
{
  tabelle: 'datenschutz_auskunft',
  art: 'append',
  migration: '0221',
  grund:
    'LEG-09, Art. 15 DSGVO, SEC-A9. Das ausgehaendigte Artefakt mit seiner '
    + 'Pruefsumme. Streitig ist im Zweifel nicht DASS geantwortet wurde, '
    + 'sondern WAS drinstand — eine geloeschte Zeile ist von einer nie '
    + 'erteilten Auskunft nicht zu unterscheiden, und die Beweislast liegt '
    + 'beim Verantwortlichen.',
},
{
  tabelle: 'berichtigung_feld',
  art: 'append',
  migration: '0221',
  grund:
    'LEG-09, Art. 16 und Art. 19 DSGVO. Je Feld der gespeicherte Wert, der '
    + 'behauptete und die Entscheidung. Der gespeicherte Wert existiert nach '
    + 'der Berichtigung nur noch hier; ohne diese Zeile ist die '
    + 'Art.-19-Unterrichtung nicht belegbar und der alte Wert '
    + 'unwiederbringlich.',
},
{
  tabelle: 'loeschentscheidung',
  art: 'append',
  migration: '0221',
  grund:
    'LEG-09, Art. 17 DSGVO gegen LEG-01/LEG-02. Der Entscheidungsnachweis je '
    + 'Tabelle und Feld, den 04-SEITENKARTE §5.25 zusagt: geschuldet, '
    + 'ueberlagert oder offen, mit Fundstelle. Eine loeschbare '
    + 'Loeschentscheidung ist der Widerspruch in sich selbst.',
},
// Fuer 0222, in dieser Reihenfolge (Token ZUERST):
{
  tabelle: 'werbewiderspruch_token',
  art: 'append',
  migration: '0222',
  grund:
    'CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG. Der Abdruck des Pflichtlinks je '
    + 'Werbenachricht — der Beleg, DASS die Nachricht einen wirksamen '
    + 'Widerspruchsweg getragen hat. Geloescht bliebe eine Werbemail ohne '
    + 'nachweisbaren Widerspruchslink; abgelaufen oder zurueckgezogen wird '
    + 'der Token ueber widerrufen_am.',
},
{
  tabelle: 'werbewiderspruch',
  art: 'append',
  migration: '0222',
  grund:
    'CRM-08, LEG-08, § 7 UWG. Das Protokoll des Widerspruchs: Weg, Kanal, '
    + 'Zeitpunkt und ausloesende Nachricht. Es ist der Beweis, mit dem sich '
    + 'eine Abmahnung abwehren laesst — eine geloeschte Zeile nimmt dem '
    + 'Verantwortlichen genau diesen Beweis, und die Beweislast liegt bei ihm.',
},

// KEINE Eintraege in AUDITIERT oder GEAENDERT_AM: die drei `geaendert_am`-
// Ausloeser (berichtigung_feld, loeschentscheidung, werbewiderspruch_token)
// stehen von Hand in der Migration, genau wie 0176 es mit
// trg_betroffenenanfrage_geaendert haelt. `datenschutz_auskunft` bekommt
// keinen: ein ausgehaendigtes Artefakt wird nicht geaendert — wer einen
// anderen Umfang aushaendigt, haendigt ein zweites aus.
//
// DEFINER_ONLY braucht keinen Eintrag: werbewiderspruch_token hat zwar kein
// cse_app-Recht, aber eine cse_definer-Policy — schema-meta.test.ts §5
// verlangt nur „RLS + FORCE + mindestens eine Policy", und die ist da.

## src/server/registry/navigation.ts

Nichts einzufuegen — und das ist geprueft, nicht vergessen.

Alle fuenf Portalrouten stehen bereits in src/server/registry/routen.generiert.ts
(Zeilen 1963–1971 der Seitenkarte: /datenschutz, /[id], /[id]/auskunft,
/[id]/berichtigung, /[id]/loeschung, /widersprueche) mit genau den Rechten, die
ich verwende. Auch /werbewiderspruch und /werbewiderspruch/[token] sind schon
im Register (Zeilen 48–49, Phase 4, bewachung „offen").

navigation.ts und tableiste.ts fuehren ueberhaupt keinen datenschutz-Eintrag:
die Domaene wird ueber den Tab „mehr" erreicht, und genau den setzen meine
Seiten (aktiverTab="mehr", wie die Nachbarseiten verarbeitungsverzeichnis und
loeschkonzept). Die Navigation innerhalb des Vorgangs steht in
Vorgangskopf.tsx und zeigt nur Wege, deren Recht die Sitzung haelt — ein
Menuepunkt auf ein fehlendes Recht fuehrt auf 404 und verraet damit die
Existenz dessen, was er nicht zeigen darf (AUT-06).

kennzahlen.ts: keine neue Kennzahl. Naheliegend waere „offene
Betroffenenanfragen"; sie gehoert aber hinter datenschutz.auskunft_erstellen,
und app.mandant_kennzahlen() filtert nach §6.3 nicht je Modulrecht — eine Zahl
ueber Loeschverlangen im Bereichsumschalter waere genau der Leck-Fall, den die
Seitenkarte dort selbst als offen markiert.

## Sonstiges

1) scripts/generate-triggers.ts — MIGRATIONS_DATEIEN braucht zwei Zeilen,
sonst faellt `pnpm db:triggers --check`, weil MIGRATIONEN (aus rls.ts) die
beiden Nummern kennt und die Datei nicht:

  // Datenschutz (Phase 7): der Entscheidungsnachweis und das
  // Widerspruchsprotokoll. `0220` traegt KEINEN Block — es legt keine
  // Tabelle an, sondern ersetzt zwei Policies auf `betroffenenanfrage`.
  '0221': join(WURZEL, 'drizzle/0221_datenschutz_nachweis.sql'),
  '0222': join(WURZEL, 'drizzle/0222_werbewiderspruch.sql'),

Die generierten Bloecke stehen bereits WORTGLEICH in beiden Dateien (mit den
Sentinels), damit der Baum zwischen meinem PR und dem naechsten
`pnpm db:triggers` nicht ungeschuetzt ist. Nach dem Einfuegen der rls.ts-
Eintraege in der angegebenen Reihenfolge aendert der Generator nichts.

2) src/server/db/seed/index.ts — ich habe hier AUSNAHMSWEISE selbst editiert
(die Datei steht nicht auf der zentralen Liste, und der Plan verlangt
ausdruecklich, dass der Seed mitwaechst). Zwei Stellen: ein Import nach
`seedBenachrichtigungen` und der Aufruf `seedDatenschutz(sql, ids, demodaten)`
unmittelbar VOR dem Rechnungsblock, mit Ausgabezeile. Bitte beim Zusammenfuehren
auf Konflikte pruefen.

3) docs/architecture/02-datenmodell/02-CRM-OPERATIONS.md — die Kritik hat
recht: `werbewiderspruch` steht dort nur als SPALTE, die Protokolltabelle und
der Token sind eine offene Forderung in 04-SEITENKARTE.md:2870 AN dieses
Dokument, und das Dokument ist der normative Vertrag („an implementation that
deviates is wrong until this document is amended first"). Ich habe es NICHT
angefasst. Nachzutragen ist der Stand, wie 0222 ihn baut:

  - `werbewiderspruch_token` (mandant_id, ansprechpartner_id, kunde_id?,
    nachricht_id? → nachricht(id), kanal aus der Fuenferliste von 0020,
    token_hash SHA-256 unique, gueltig_ab/gueltig_bis (bis = NULL, kein
    Ablauf — O-645), ausgegeben_am, eingeloest_am, versuche,
    letzter_versuch_am, widerrufen_am + Grund). cse_app haelt darauf KEIN
    Recht; Ausgabe, Aufloesung und Verbrauch laufen ueber drei
    Definer-Funktionen.
  - `werbewiderspruch` (mandant_id, art ∈ {werbung, verarbeitung},
    ansprechpartner_id?/kunde_id? — mindestens eines, email?, kanal?,
    eingegangen_am, nachricht_id?, quelle ∈ {token, formular, manuell},
    token_id?, bemerkung?, erfasst_von? — Pflicht bei `manuell`).
  - §0.1 Tabellenliste fuer crm.ts um beide ergaenzen.
  - Offen bleiben O-640 (Kanal je Widerspruch oder pauschal) und O-641
    (Gruppenwirkung). Anzumerken ist ausserdem, dass `nachricht_kanal`
    (0231: portal, email, sms) und die CRM-Kanalliste (email, telefon, sms,
    post, whatsapp) zwei verschiedene Vokabulare sind; `werbewiderspruch.kanal`
    haengt bewusst an der CRM-Liste, weil `app.darf_kontaktiert_werden` gegen
    sie prueft.

3b) **NEU nach der Pruefung — 04-SEITENKARTE.md §5.25 und das Routenregister:
das Tor von `/datenschutz` und `/datenschutz/[id]`.** 0220 gibt einem Traeger
von nur `datenschutz.berichtigung_bearbeiten` das LESERECHT auf
`betroffenenanfrage`; erreichbar ist die Seite fuer ihn trotzdem nicht, weil
beide Routen `datenschutz.auskunft_erstellen` verlangen und sonst mit 404
antworten. Derselbe Fall gilt fuer `datenschutz.loeschung_pruefen`.

**Der naheliegende Vorschlag — die `lesen`-Liste um die beiden Rechte
erweitern — waere FALSCH und macht es schlimmer.** `lesen` ist eine
UND-Bedingung: `scripts/seitenkarte/extrahiere.ts` sagt es ausdruecklich
(„mehrere Schluessel bedeuten UND (`a + b` in der Karte)"), und
`src/server/auth/zugang.ts:160-167` laeuft ueber jeden Schluessel und sammelt
jeden fehlenden. Mit drei Rechten in `lesen` kaeme die Datenschutzbeauftragte
mit nur `auskunft_erstellen` ebenfalls nicht mehr durch. Der Schraegstrich
hilft auch nicht: er verschiebt die weiteren Schluessel nach `schreiben`, und
`schreiben` bewacht die Seite gar nicht.

Was es wirklich braucht, ist eine ODER-Schreibweise in der Karte und im
Extraktor (`Bewachung` kennt heute nur `lesen`/`schreiben`) — beides
gemeinsame Dateien. In der Zwischenzeit steht in `Vorgangskopf.tsx` kein
Ruecklink mehr auf einen Posteingang, der 404 gibt: er erscheint nur mit
`datenschutz.auskunft_erstellen`, sonst ein Satz, der das sagt (AUT-06).

3c) **NEU — das Tabellen-SELECT von `cse_definer` auf ansprechpartner/kunde.**
0222 erteilt es weiterhin tabellenweit (das UPDATE ist spaltenweise
nachgezogen). Der Grund steht in der Migration: 0246 stuetzt sich in seinem
eigenen Kommentar ausdruecklich darauf („cse_definer haelt auf dieser Tabelle
ein TABELLEN-select (0222, Zeile 292) und deckt neue Spalten damit von
selbst"), und 0247 liest `aehnliche_leistung`, `einwilligung_kanaele`,
`rechtsgrundlage_quelle`, `rechtsgrundlage_erfasst_am`,
`rechtsgrundlage_beleg_dokument_id` und `aehnliche_leistung_begruendung`. Eine
Spaltenliste in 0222 kann diese Spalten nicht nennen — es gibt sie dort noch
nicht. Der Entzug gehoert deshalb in dieselbe Hand wie 0246/0247: erst deren
eigene Spaltengrants, dann faellt das Tabellen-SELECT. Keine O-Nummer, weil es
keine Geschaeftsregel ist, sondern eine Reihenfolge zwischen zwei Migrationen.

4) docs/architecture/04-SEITENKARTE.md — zwei Zeilen sind jetzt eingeloest
(§2.4 „needs a hashed, revocable objection token per outbound message and a
werbewiderspruch log row") und koennen aus der Tabelle der offenen Forderungen
raus, sobald Punkt 3 erledigt ist.

**Ausserdem fehlen dort zwei /en-Zeilen (D-82).** Die englische Seite ist
GEBAUT (`src/app/(public)/en/werbewiderspruch/page.tsx`, gemeinsame Komponente
`src/app/(public)/werbewiderspruch/Werbewiderspruch.tsx`, Felder ueberlagert
statt verdoppelt — D-83); sie fehlt nur noch im Register. In §2.4 nachzutragen,
in derselben Zeile wie die deutsche Fassung:

  `/en/werbewiderspruch`         — English counterpart, same path (D-82)
  `/en/werbewiderspruch/[token]` — dito; die Seite dazu ist NICHT gebaut

Anmerkung fuer die pflegende Hand: `/en/werbewiderspruch/[token]` habe ich
bewusst NICHT gebaut. Die Tokenseite gehoert der Domaene
aufgaben-nachrichten-oeffentlich, und zwei Agenten an derselben Datei war schon
einmal der Fall. Die tokenlose Fassung ist der Weg, den ein englischsprachiger
Empfaenger findet — die Tokenfassung erreicht er ueber den Link in der
Nachricht.

**Und §2.5 stimmt jetzt wieder**: `AUSGESCHLOSSEN` in
`src/server/services/inhalt/sitemap.ts` fuehrt `/en/werbewiderspruch` mit
(robots + Sitemap). `istAusgeschlossen` vergleicht Praefixe, und `/en/…`
beginnt nicht mit `/werbewiderspruch` — ohne die Zeile waere die Sperrflaeche
in einer Sprache beschrieben und in der anderen offen. Das ist die EINZIGE
Aenderung, die ich ausserhalb meiner Domaene gemacht habe; sie ist additiv.

5) docs/DESIGN.md — nichts zu ergaenzen. Alle Werte kommen aus dem
vorhandenen Vokabular (s1…s7, text-h1/h2/h3/sm/xs/micro, text-text,
text-text-muted, text-text-subtle, text-brand, text-danger, text-warning,
bg-surface/-2, border-line/-strong, rounded-md/-lg, min-h-11, StatusPill,
Hinweis, DataTable, Button). Die Tailwind-Farbwache laeuft sauber durch.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen"

| O-640 | Does a Werbewiderspruch apply per channel (e-mail blocked, post keeps running) or across all channels? Today it is blanket: the block sits in ONE column (`werbewiderspruch_am`, 0020), and `werbewiderspruch.kanal` only describes what triggered it. Note that `nachricht_kanal` (portal/email/sms, 0231) and the CRM channel list (email/telefon/sms/post/whatsapp, 0020) are two different vocabularies. |
| O-641 | Does an advertising objection raised at one entity also bind the other three? Today it does not — the four are separate controllers, and `/werbewiderspruch` asks which one, exactly as `/datenschutz/anfrage` does. |
| O-642 | Does the internal hourly rate (`anstellung.stundensatz_intern`, K-05) belong in an Art. 15 export, or is it the entity's costing data? The Art.-15 section for `anstellung` omits it today and says so. |
| O-643 | Does the absence TYPE (`abwesenheit.abwesenheitsart_id` — health-adjacent, Art. 9) belong in an Art. 15 export, and behind which additional check? It is readable through `app.abwesenheit_grund_lesen` with its own right; the export lists dates and status only. |
| O-644 | Who EXECUTES an erasure decision, and how? There is no anonymisation procedure (`app.person_anonymisieren` is described in 02-CRM-OPERATIONS.md and does not exist), no run that writes `anonymisiert_am`, and no tombstone path for an employee, a customer contact or a company. Until there is one, `M/datenschutz/[id]/loeschung` produces a documented PRE-NOTE, not a release — a signed release for an execution nobody performs is worse than none. |
| O-645 | Should the one-click objection link expire, and after how long? § 7 Abs. 3 Nr. 4 UWG says "jederzeit", so `werbewiderspruch_token.gueltig_bis` is NULL today — the choice that is safe for the data subject, not a decided rule. |
| O-646 | Which recipients under Art. 19 DSGVO exist per data class (payroll office, client, authority), and by which route are they informed? The platform holds no recipient list; `berichtigung_feld.art19_empfaenger` records whoever a human names. |
| O-647 | How is a restriction under Art. 18 DSGVO implemented technically — a per-record restriction flag, or organisationally? The data model carries no "restricted" marker: there is no column that pauses processing without ending it, and a checkbox that blocks nothing would be the worse answer. **The same decision governs an Art. 21 objection raised by an employee or an applicant**: `widerspruch_am` exists only on `ansprechpartner` and `kunde` (the advertising side), so for those groups the objection is today decided by a human, implemented organisationally and recorded in the closing text of the request. `/datenschutz/[id]` says both on the screen. |
| O-648 | Which of the employee branch's derived findings, access records and assignments belong in an Art. 15 export, and which are mechanics? Eleven tables carry `person_id` and are no section of their own today: `arbeitszeit_verstoss`, `planungs_konflikt`, `nachweis_warnung`, `da_pflicht` (derived from data already disclosed in full), `benutzer`, `checkin_token`, `offline_ereignis` (the mechanics of access), `einsatz_zuordnung`, `zeitnachweis`, `team_mitglied`, `bewacher_eintrag`. They are NAMED in the delivered export as an open section rather than left out — the answer decides whether they become sections. (The erasure side of the same list is O-71.) |
| O-649 | Who sends the confirmation of a tokenless advertising objection (`/werbewiderspruch`), and what does it say when the address is not in our records at all? A confirmation that says "removed" would disclose that the address was held; one that says nothing is not a confirmation. No outbound mail is connected today, and the page says so instead of claiming a send. |

## Tests

- /home/user/cse-platform/tests/kern/datenschutz-fristen.test.ts — 17 Faelle, alle gruen (einzeln gelaufen mit vitest.config.ts): § 147 AO ab Ende des Kalenderjahres (nicht 'Datum plus zehn Jahre'), § 17 MiLoG kalendarisch (29.02. faellt auf den 28., nicht auf den 1.3.; nicht 730 Tage), berlinTag ueber Jahreswechsel und DST-Umstellung, alsText (Zeitpunkt in Berlin, reines Datum ohne Zonendrehung), und die Markdown-Ausgabe der Auskunft: Warnung VOR dem ersten Abschnitt, 'gesperrt' vs. 'keine Zeile', offener Abschnitt benannt, Pipe und Zeilenumbruch maskiert
- /home/user/cse-platform/tests/isolation/datenschutz-nachweis.test.ts — 29 Faelle, alle gruen gegen echtes Postgres als cse_app mit RLS+FORCE (gelaufen gegen eine EIGENE Datenbank w_dsch_w1, nie gegen cse_test): §1 der 0220-Befund (Traeger von nur berichtigung_bearbeiten liest die Zeile, vorher 0; ohne eines der drei Rechte nichts; kein Rechte-Uebertrag in fremde Gesellschaft), §2 je Artikel sein Schreibrecht + die drei CHECKs + der coalesce-Unique, §3 der K-05-Leseweg (wirft statt leer zu antworten, EINE Protokollzeile je Abruf, direkter Spaltenzugriff verweigert, benachrichtigung_auskunft oeffnet eine fremde Person), §4 der Token (kein Recht auf der Tabelle, erfasst→bereits→unbekannt, Zeitstempel+Protokoll, rechtsgrundlage unberuehrt, vertragliche Post laeuft weiter), §5 Art. 21 (Begruendung Pflicht, Recht geprueft, rechtsgrundlage='keine', Kanaele fallen mit, Ruecknahme wirft, Protokollzeile), §6 kein DELETE/TRUNCATE auf allen fuenf Tabellen — MIT Zeilenzaehlung davor, weil ein Row-Trigger auf einer leeren Tabelle nicht feuert (genau daran war der erste Entwurf gruen), §7 Mandantengrenze + der neue Fremdschluessel + hoechstens eine Zuordnung

- /home/user/cse-platform/tests/isolation/datenschutz-abdeckung.test.ts — NEU, 8 Faelle, gruen. Die Wache gegen den Hauptbefund: sie stellt JEDE Tabelle des Schemas mit `person_id`, `ansprechpartner_id` oder `bewerbung_id` (nur BASE TABLE, keine Sichten) gegen `ABDECKUNG` aus `auskunft.ts` und aus `loeschentscheidung.ts` — und beide Richtungen, also auch: die Liste nennt keine Tabelle, die es nicht gibt. Die Gegenrichtung hat beim ERSTEN Lauf einen Fehler gefunden, der seit dem Bauschritt drinstand: der offene Abschnitt nannte `agent_lauf`, und diese Tabelle gibt es nicht (sie heisst `agent_aufgabe`/`agent_schritt`, der Freigabe-Snapshot `freigabe_snapshot`).
- /home/user/cse-platform/tests/isolation/datenschutz-dienste.test.ts — NEU, 21 Faelle, gruen. Je Dienstfunktion EIN Aufruf gegen echtes Postgres, fuer ALLE DREI Zuordnungsarten: lade, ladeZuordnung, kandidaten, ordneZu, erstelleAuskunft, halteFest, erteilte, nimmAuf, liste (Berichtigung), matrix, liste (Loeschung), liste/protokoll/stand (Widerspruch). Mit Zusagen ueber Zeilenzahl und Sperrzustand, einem Konto MIT allen Rechten und einem mit nur den drei Datenschutzrechten. Die Fixtur hat dabei zwei Dinge korrigiert, die ich sonst geraten haette: `stelle.beschreibung` und `bewerbung.aufbewahrung_bis` sind NOT NULL, und die Rolle `leitung` traegt `crm.lesen`, `angebot.lesen` und `objekt.lesen` — nicht aber `crm.rechtsgrundlage_lesen`, an dem der Sperrfall haengt.

## NICHT gebaut

- /en/werbewiderspruch/[token] — die englische Fassung der TOKENseite. Die tokenlose `/en/werbewiderspruch` ist inzwischen gebaut (siehe Punkt 4 unter „Sonstiges"); die Tokenseite gehoert der Domaene aufgaben-nachrichten-oeffentlich, und zwei Agenten an derselben Datei war schon einmal der Fall.
- Die Ausfuehrung einer Loeschvormerkung (Anonymisierungsprozedur app.person_anonymisieren, Tombstone, Nachtlauf). Sie fehlt im ganzen System (nachgemessen: ein loeschender Lauf, keine Funktion mit 'anonymisier', kein Codepfad auf anonymisiert_am) und ist eine eigene Domaene — O-644. Die Seite behauptet deshalb keinen Vollzug.
- Die Abwesenheitsart und der interne Stundensatz in der Art.-15-Auskunft: beide sind K-05/Art.-9-nah und haben eigene Definer-Leser (app.abwesenheit_grund_lesen, app.anstellung_entgelt_lesen). Ob sie in eine Art.-15-Auskunft gehoeren, ist O-643/O-642 — die Abschnitte nennen die Luecke statt sie stillschweigend zu lassen.
- Die Bestaetigungs-E-Mail zum tokenlosen Widerspruch (§2.4 nennt sie). Kein Postausgang ist verbunden; die Seite bestaetigt auf dem Bildschirm und behauptet keinen Versand.

## Notizen des Bauenden

MIGRATIONSPRUEFUNG: die volle Kette 0001→0231 laeuft auf einer frisch
angelegten w_dsch bis „Migrationen angewendet." durch — zuletzt nach dem
Einfuegen der Loeschsperrbloecke. Jede Abfrage jedes Dienstes ist einzeln als
`cse_app` mit gebundener Sitzung gegen echtes Postgres geprueft (ein
Pruefskript, das die SQL-Zeichenketten aus der Datei zieht und `explain`
darauf laufen laesst); die Definer-Funktionen zusaetzlich mit echten Daten.
Vier Fixturen-Ueberraschungen aus der Handprobe, die mir Rateschaeden erspart
haben: `kunde_typ` kennt kein 'gewerblich' (firma/behoerde/privat),
`bewerbung_quelle` kein 'formular' (karriereseite/initiativ/mail/import),
`bewerbung_status` kein 'neu' (eingegangen/…), und `nachricht` hat seit 0231
kein `text` mehr, sondern `koerper` + `thread_id` — mein Fremdschluessel auf
`nachricht(id)` haelt trotzdem.

DREI BEFUNDE, die die Kritik ausdruecklich verlangt hat, und wie sie im Code
stehen:
(1) Der Rechte-Bruch ist in 0220 an der POLICY geheilt, nicht am Tor. Die
Gegenrichtung haette die drei Katalogrechte zu einem gemacht. Der
Isolationstest §1 haelt den Befund fest: Traeger von nur
berichtigung_bearbeiten las vorher 0 Zeilen, jetzt 1.
(2) Die still halbe Art.-15-Auskunft: jeder Abschnitt nennt sein Recht, die
Rechte werden vor der ersten Datenabfrage in EINER Abfrage geprueft, ein
Abschnitt ohne Recht ist `gesperrt` (nicht leer), und der Abruf gibt 409.
Die Warnung steht auch IN der Datei, nicht nur auf dem Schirm — dafuer gibt es
einen kern-Test, weil die Datei das ist, was die betroffene Person liest.
(3) Der fehlende Vollzug: statt eine Freigabe zu erfinden, heisst das Ergebnis
Vormerkung, und VOLLZUG.vorhanden/fehlend steht auf der Seite. Das ist die
einzige Stelle, an der ich gegen den Wortlaut der Seitenkarte formuliere — sie
sagt „Execution is anonymisation plus tombstoning", und beides gibt es nicht.

ZWEI ENTSCHEIDUNGEN, die ich getroffen habe und die ein Pruefer sehen soll:
- Eine VIERTE Tabelle ueber die drei zugewiesenen hinaus: `berichtigung_feld`.
  Die Kritik nennt „fehlende_tabellen: []" bei /berichtigung falsch und stellt
  die Alternative klar: entweder derselbe Nachweis wie bei /auskunft und
  /loeschung, oder die Art.-19-Pflicht bleibt Freitext. Ich habe die Tabelle
  gebaut.
- `/werbewiderspruch/[token]` ist NICHT von mir; die Domaene
  aufgaben-nachrichten-oeffentlich hat sie parallel gebaut, waehrend ich an
  derselben Stelle war. Ihre Fassung liegt jetzt auf der Platte, meine wurde
  ueberschrieben, und sie passt zu meiner API-Route (Feld `token`, Staende
  erfasst|bereits|unbekannt, Tokenform 20–200 base64url gegen meine 43
  Zeichen). `src/app/api/werbewiderspruch/route.ts` und
  `/werbewiderspruch/page.tsx` (tokenlos) sind meine. Bitte nicht doppelt
  bauen, sondern nur den Zusammenschluss pruefen.

WAS ICH NICHT ANGEFASST HABE: keine vorhandene drizzle/*.sql, kein Register,
kein DECISIONS.md, kein DESIGN.md, keine Seitenkarte, kein package.json, keine
Wache, kein Triggerverzeichnis. Nicht ausgefuehrt: db:migrate gegen
cse_dev/cse_test, db:triggers, db:seed, test, test:isolation, test:e2e, build,
git. Meine zwei Testdateien habe ich EINZELN laufen lassen (vitest mit der
kern-Konfiguration; die Isolationsdatei mit einer eigenen Konfiguration ohne
global-setup gegen eine selbst angelegte Datenbank w_dsch_w1, die ich danach
wieder verworfen habe) — ein Test, den niemand laufen liess, ist eine
Behauptung. Typecheck auf meine Pfade: sauber. ESLint auf 34 betroffene
Dateien: 0 Probleme. `scripts/guards/run-all.ts` meldet aus meinem Bereich
ausschliesslich `todo-client-nicht-im-register` fuer O-640…O-647 — genau die
acht Zeilen, die in `decisions_zeilen` stehen; danach ist die Wache gruen.

EIN OFFENER RANDFALL, den ich bewusst so gelassen habe: die Art.-15-Auskunft
liest nur den AKTIVEN Mandanten. Ist dieselbe Person in zwei Gesellschaften
angestellt (der D-09-Fall), braucht sie zwei Auskuenfte — eine je
Verantwortlichem. Das ist rechtlich richtig und praktisch unbequem; die Seite
sagt es nicht ausdruecklich. Falls das eine eigene Zeile verdient, waere das
eine neue O-Nummer ausserhalb meines Bereichs.
