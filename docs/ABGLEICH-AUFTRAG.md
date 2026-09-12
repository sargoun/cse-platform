# Abgleich: Auftragsbeschreibung des Kunden gegen das gebaute System

Der Kunde hat die vollständige Auftragsbeschreibung in 34 Abschnitten geliefert.
Dieses Dokument hält Punkt für Punkt fest, was davon **gebaut**, **teilweise**
gebaut, **nicht** gebaut oder **bewusst anders** entschieden ist — jeder Punkt mit
Beleg aus dem Quelltext oder aus der Datenbank, keiner aus dem Gedächtnis.

**Wie gemessen wurde.** Acht Schnitte durch die Beschreibung, je ein Prüfer je
Schnitt, danach eine Gegenprobe: jede Behauptung „ist gebaut" musste einen
Widerlegungsversuch überstehen. Von 46 tragenden „gebaut" hielten 4 uneingeschränkt;
42 waren in ihrer Allgemeinheit zu weit gefasst und stehen unten als *teilweise*.
Das ist kein Schönheitsfehler der Messung, sondern ihr Ergebnis: was niemand
zu widerlegen versucht hat, ist nicht geprüft.

> **Stichtag und Messbaum.** Gemessen wurde der Stand von
> `claude/phase-5-dienstplan-zeit` (der Zweig, der zu diesem Zeitpunkt in
> `/home/user/cse-platform` ausgecheckt war), **nicht** der offene Zweig
> `claude/phase-5-abschluss`. Ein Teil der hier aufgeführten Lücken ist dort
> bereits geschlossen — nachweisbar zum Beispiel der rote Knopf „Angebot
> anfragen" im Kopf (`OeffentlicheShell.tsx:244`, `data-cse="angebot-anfragen"`),
> der unten noch als „fehlt_ganz" steht. **Jeder Punkt ist vor der Umsetzung
> gegen den aktuellen Zweig nachzuprüfen.** Ein Befund, der schon erledigt ist,
> und ein Befund, der nie stimmte, sehen aus der Ferne gleich aus — und beide
> kosten einen Tag, wenn man sie ungeprüft übernimmt.

## Zahlen

| | Punkte |
|---|---|
| geprüfte Punkte | 315 |
| gebaut und gegen die Gegenprobe bestätigt | 86 |
| teilweise gebaut | 99 |
| fehlt | 77 |
| bewusst anders entschieden | 40 |

Nach Gewicht über die drei offenen Kategorien:

- **tragend**: 117
- **wichtig**: 81
- **klein**: 18

---

## Öffentlicher Auftritt (Abschnitte 1–4, 30)

### tragend

#### 2 Oeffentlicher Auftritt — Weg zum Angebotsformular in der Navigation

**Stand:** fehlt_ganz · **Phase:** 2

*Beleg:* OeffentlicheShell.tsx HAUPT = unternehmen/leistungen/projekte/kontakt (Zeile 35–40); Fussbereich fuehrt nur Gesellschaften + Impressum/Datenschutz/Barrierefreiheit. grep nach '/angebot' in src/components/oeffentlich/: einziger Treffer Kontaktwege.tsx:110.

*Was fehlt / was stattdessen möglich ist:* 'Angebot anfragen' ist nur ueber /kontakt oder die direkte Adresse erreichbar. DESIGN §5 Navigation verlangt es als roten Knopf rechts im Kopf.

#### 2 Oeffentlicher Auftritt — Login als oeffentliche Seite

**Stand:** fehlt_ganz · **Phase:** PR 20 (offen, Telefon + Einmalcode)

*Beleg:* Manifest src/server/registry/routen.generiert.ts:56 fuehrt /auth/login (Phase 1). Im Dateisystem existiert nur src/app/auth/bereich/page.tsx — git ls-files 'src/app/auth*' gibt genau eine Datei. Der Kopf zeigt 'Anmelden' nur, wenn CSE_DEV_FLAECHEN an ist, und dann auf /dev/anmelden (layout.tsx:46).

*Was fehlt / was stattdessen möglich ist:* Die zwoelfte vom Mandanten genannte Seite existiert nicht. In einem Produktionsbau steht der Anmeldepunkt gar nicht da — bewusst, siehe Kommentar OeffentlicheShell.tsx:60, aber der Mandant hat eine Login-Seite bestellt.

#### 3 Firmenprofile — Logo je Gesellschaft (PRO-01)

**Stand:** fehlt_ganz · **Phase:** 2 (haengt an O-12)

*Beleg:* unternehmensprofil.logo_medien_id ist in allen 8 Zeilen NULL; Tabelle medien hat 0 Zeilen; das Verzeichnis public/brand/ existiert nicht, obwohl src/lib/placeholder-assets.ts:22–30 vier Dateien dort fuehrt. BereichsAvatar (src/components/ui/AreaBadge.tsx:47) rendert die Initiale plus Ring.

*Was fehlt / was stattdessen möglich ist:* Es gibt kein Logo — weder echt noch als Datei. O-12 ist offen. Der Ring in der Bereichsfarbe steht stellvertretend.

#### 3 Firmenprofile — Profilbild / Coverbild (PRO-01)

**Stand:** fehlt_ganz · **Phase:** 2

*Beleg:* unternehmensprofil.cover_medien_id in allen 8 Zeilen NULL. Kein Leser: bereicheLesen (src/server/inhalt/lesen.ts:70–88) waehlt nur kurzbeschreibung; cover_medien_id kommt in keiner Abfrage vor.

*Was fehlt / was stattdessen möglich ist:* Die Spalte existiert, aber keine Zeile im Code liest sie. Ein gepflegtes Cover wuerde heute nirgends erscheinen. DESIGN §4.5 nennt fuer das Profilcover 3:1 — kein Bauteil setzt das um.

#### 3 Firmenprofile — Kontakt auf dem Profil (PRO-02)

**Stand:** fehlt_ganz · **Phase:** 2

*Beleg:* OeffentlicheSeite.tsx:60 haengt Kontaktwege NUR bei pfad === '/kontakt' an; Gesellschaften NUR bei '/impressum'. Auf /unternehmen/<slug> steht weder Telefon noch E-Mail.

*Was fehlt / was stattdessen möglich ist:* Wer auf dem Profil einer Gesellschaft steht, findet dort keine Kontaktdaten dieser Gesellschaft — obwohl sie in mandant liegen und im Fussbereich einzeilig durchlaufen.

#### 3 Firmenprofile — Angebotsanfrage vom Profil aus (PRO-02)

**Stand:** fehlt_ganz · **Phase:** 2

*Beleg:* grep '/angebot' in src/components/oeffentlich/ und src/app/(public)/unternehmen/: kein Treffer im Profilpfad. Die Angebotsauswahl ist eine eigene Seite.

*Was fehlt / was stattdessen möglich ist:* Vom Profil einer Gesellschaft fuehrt kein Weg zu ihrem Formular /angebot/<slug> — obwohl der Pfad existiert und funktioniert.

#### 3 Firmenprofile — Pflegeoberflaeche fuer Website und Profile (/portal/[mandant]/website/*)

**Stand:** fehlt_ganz · **Phase:** 2 laut Manifest, nicht gebaut

*Beleg:* 12 Routen im Manifest routen.generiert.ts:311–323, alle 'phase: 2' — profil, seiten, seiten/[id], leistungen, leistungen/[id], referenzen, referenzen/[id], referenzen/[id]/veroeffentlichen, news, news/[id], galerie, formulare. Im Dateisystem existiert kein src/app/portal/[mandant]/website/. Jeder Aufruf faellt in src/app/portal/[mandant]/[...rest]/page.tsx → MandantUnterseite → NochNichtGebaut (src/app/portal/unterseite.tsx:108).

*Was fehlt / was stattdessen möglich ist:* Das ist die Falle Nr. 1 in Reinform: zwoelf Adressen im Manifest, null gebaute Seiten. Ohne sie kann der Mandant keinen Text, kein Bild, keine Referenz und kein Profil aendern — jede Inhaltsaenderung ist heute ein SQL-UPDATE von Hand.

#### 31 Mobil — Hauptnavigation auf dem Telefon (DESIGN §5: Vollbild-Overlay-Menue)

**Stand:** fehlt_ganz · **Phase:** 2

*Beleg:* OeffentlicheShell.tsx:42 — nav className='ml-auto hidden gap-s4 md:flex'. Kein Menueknopf, kein Overlay: grep nach overlay/menue/burger in src/components/oeffentlich/ und src/app/(public)/ ergibt keinen Treffer.

*Was fehlt / was stattdessen möglich ist:* Unter 768 px sind Unternehmen, Leistungen, Projekte und Kontakt aus dem Kopf VERSCHWUNDEN — und der Fussbereich fuehrt nur die vier Gesellschaften plus Impressum/Datenschutz/Barrierefreiheit. Auf dem Telefon gibt es damit keinen Weg zu /leistungen, /projekte oder /kontakt ausser ueber die Adresszeile. Dasselbe Geraet, auf dem laut PUB-06 und DESIGN §8 mobil-zuerst gilt.

#### 2 Oeffentlicher Auftritt — Vier Gesellschaftsseiten /unternehmen/{reinigung,security,bau,operations}

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* src/app/(public)/unternehmen/[bereich]/page.tsx; je 2 Abschnitte in der DB (hero + leistungen, operations: hero + text)

*Was fehlt / was stattdessen möglich ist:* Die Route existiert und rendert, aber sie ist eine gewoehnliche Inhaltsseite — kein Profilaufbau. Siehe Abschnitt 3.

#### 2 Oeffentlicher Auftritt — Projekte

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* seite '/projekte' hat 2 Abschnitte: hero + text 'Hier stehen bald Referenzen'. Tabelle referenz: 0 Zeilen. Abschnittsart 'projekte' existiert im Enum abschnitt_art, wird von Abschnitte.tsx:95 aber nicht behandelt (default → Text).

*Was fehlt / was stattdessen möglich ist:* Die Seite ist heute LEER. Es fehlen: Renderer fuer die Abschnittsart 'projekte', Referenzdaten, und die Pflegeoberflaeche /portal/[mandant]/website/referenzen.

#### 3 Firmenprofile — Projekte / Referenzen auf dem Profil (PRO-02, PRO-05)

**Stand:** TEILWEISE · **Phase:** 2 laut Manifest, nicht gebaut

*Beleg:* Tabelle referenz existiert vollstaendig — freigegeben_vom_kunden, freigabe_am, referenz_freigabe_belegt CHECK, Teilindex referenz_oeffentlich_idx, RLS t_referenz_oeffentlich. Zeilen: 0. Kein Renderer, keine Pflegeseite (/portal/[mandant]/website/referenzen nicht gebaut).

*Was fehlt / was stattdessen möglich ist:* Das Schema haelt PRO-05 sauber durch (nur freigegebene Referenzen sind oeffentlich lesbar). Es fehlt der ganze Weg des Menschen: Auftrag → Freigabe erfassen → Referenz → Seite.

#### 30 Gestaltung — „Serioeses deutsches Unternehmen, nicht Science-Fiction“ (PUB-05)

**Stand:** TEILWEISE · **Phase:** 2, freigegeben durch O-13

*Beleg:* Tokenseite stimmt: tiefes Schwarz #08080A, ein rotes Akzentwort, keine Leuchteffekte, keine Schatten ausser --shadow-pop, kein Parallax/Autoplay (DESIGN §7 verbietet sie, kein Bauteil verwendet sie). Was gegen den Anspruch steht, ist NICHT die Anmutung der Bauteile, sondern das Bildmaterial: neun gezeichnete SVG-Szenen in public/platzhalter/, jede mit sichtbarem Etikett 'Platzhalterbild' (Hero.tsx:56, MarkenKarte.tsx:65).

*Was fehlt / was stattdessen möglich ist:* DESIGN §4.1 verlangt echte Aufnahmen der eigenen Crews und Objekte; §4.2 verbietet KI-erzeugte Menschen als Belegschaft. Solange die Illustrationen stehen, sieht die Seite gezeichnet aus — genau das, was der Mandant „kartoonisch“ nennt. Der Platzhalterzustand ist absichtlich sichtbar (D-62) und der Produktionsbau bricht darauf ab (assertKeinePlatzhalter, placeholder-assets.ts:57).

#### 30 Gestaltung — Bilderfrage: fuehrt der Weg vom Hochladen bis auf die Seite — Weg fuer ein ECHTES Bild ohne Codeaenderung

**Stand:** TEILWEISE · **Phase:** 2 laut Manifest, nicht gebaut

*Beleg:* Der Lesepfad steht: seite.ts:62 joint medien ueber abschnitt.medien_id und liefert pfad/alt_text/ist_platzhalter; Abschnitte.tsx:34 nimmt es, sobald es da ist; pruefeSeite() erzwingt einen Alternativtext (seite.ts:120). RLS t_medien_pflege und t_abschnitt_pflege lassen referenz.schreiben schreiben, und admin/leitung/super_admin haben das Recht.

*Was fehlt / was stattdessen möglich ist:* Der Weg endet an DREI Stellen. (1) KEINE Oberflaeche: /portal/[mandant]/website/galerie und /website/seiten sind Manifestzeilen ohne page.tsx — nur ein SQL-INSERT in medien plus UPDATE auf abschnitt.medien_id bringt ein Bild auf die Seite. (2) KEIN Hochladeweg: es gibt keine API-Route, die in medien schreibt; /api/medien/[id] gehoert zu einsatz_medien (Schichtfotos, Recht zeit.lesen) und nicht zur Website. (3) medien.pfad geht direkt als src in next/image (Abschnitte.tsx:36) und next.config.ts setzt keine images.remotePatterns — die Datei muss also unter public/ im Repository liegen. Damit ist selbst der SQL-Weg keine Aenderung ohne Deployment. Die Markenkarten (Abschnitte.tsx:122) fragen ueberhaupt nie nach einem Medium und blieben auch dann gezeichnet.

#### 30 Gestaltung — Bilderfrage: was am nicht verbundenen Speicher haengt — Supabase Storage ist nicht verbunden — und hat gar keinen Website-Bucket

**Stand:** TEILWEISE · **Phase:** nicht terminiert

*Beleg:* src/server/storage/adapter.ts:60–70: SupabaseSpeicher.verbunden = (SUPABASE_URL !== '' && SUPABASE_SERVICE_ROLE_KEY !== ''); ohne Zugangsdaten wirft jeder Aufruf NichtVerbundenFehler — kein simulierter Erfolg (CLAUDE.md „no fake integrations“). BUCKETS = ['dokumente','archiv','einsatz-medien'] (Zeile 33), alle privat, Zugriff nur ueber signierte Adressen mit 15 Minuten Gueltigkeit (SIGNATUR_SEKUNDEN, Zeile 42, DOC-03).

*Was fehlt / was stattdessen möglich ist:* Fuer Website-Bilder fehlt mehr als die Verbindung: es gibt keinen Bucket dafuer, und der Entwurf laesst bewusst keinen oeffentlichen zu. Ein Websitebild muss aber oeffentlich und dauerhaft erreichbar sein — eine 15-Minuten-Signatur taugt dafuer nicht (Suchmaschinen, Cache, next/image). Damit die Fotos morgen stehen koennen, braucht es: (a) eine Entscheidung ueber einen oeffentlichen Bildbucket oder einen Ablagepfad unter public/, (b) SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, (c) eine Hochladeroute, die medien-Zeilen mit Pflicht-Alternativtext anlegt, (d) die Seite /portal/[mandant]/website/galerie, (e) images.remotePatterns in next.config.ts, falls die Datei nicht im Repository liegt, (f) Lesen von unternehmensprofil.logo_medien_id/cover_medien_id, (g) die Markenkarten an medien haengen statt an platzhalterBild(). Erst dann loest O-13 wirklich auf.

#### Ausserhalb des Auftrags — Kaltakquise — Kaltakquise an gescrapte Kontakte

**Stand:** WIDERSPRUCH · **Phase:** keine

*Beleg:* § 7 UWG; CLAUDE.md „Out of scope“; SPEC §23. Im Code nicht gebaut und aktiv verhindert: lead, kunde und ansprechpartner tragen rechtsgrundlage, rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, rechtsgrundlage_beleg_dokument_id, einwilligung_werbung und einwilligung_kanaele (information_schema).

*Was fehlt / was stattdessen möglich ist:* Nicht gebaut — richtig so. STATTDESSEN moeglich: der eingebaute Weg. Jedes Angebotsformular traegt ein separates, nicht vorangekreuztes Feld 'Ich moechte Informationen zu weiteren Leistungen erhalten' (formular_definition, Schluessel einwilligung_werbung, pflicht: false) neben der pflichtigen Datenschutzbestaetigung. Das ist die vorherige ausdrueckliche Einwilligung, die § 7 Abs. 2 UWG verlangt, mit Beleg und Zeitpunkt in der Zeile. Werbung geht an diese Kontakte, an sonst niemanden.

### wichtig

#### 3 Firmenprofile — Bildergalerie auf dem Profil (PRO-02)

**Stand:** fehlt_ganz · **Phase:** 2 laut Manifest, nicht gebaut

*Beleg:* Kein Galerie-Bauteil in src/components/oeffentlich/ (Abschnitte, AnfrageFormular, Gesellschaften, Hero, JsonLd, Kontaktwege, MarkenKarte, OeffentlicheShell). Manifest-Route /portal/[mandant]/website/galerie (routen.generiert.ts:321, Phase 2) hat keine page.tsx.

*Was fehlt / was stattdessen möglich ist:* Weder oeffentliche Anzeige noch Pflege.

#### 3 Firmenprofile — News auf dem Profil (PRO-02)

**Stand:** fehlt_ganz · **Phase:** 9 / Manifest Phase 2

*Beleg:* Wie /news: kein Datenmodell. Profilseiten haben nur hero + leistungen.

#### 3 Firmenprofile — Firmendaten auf dem Profil (PRO-02)

**Stand:** fehlt_ganz · **Phase:** 2

*Beleg:* src/components/oeffentlich/Gesellschaften.tsx wird nur auf /impressum gerendert (OeffentlicheSeite.tsx:52)

*Was fehlt / was stattdessen möglich ist:* Handelsregister, USt-IdNr., Geschaeftsfuehrung stehen in mandant und nur im Impressum.

#### 30 Gestaltung — Die eine Schreibschrift als Akzent (DESIGN Direction + §2)

**Stand:** fehlt_ganz · **Phase:** 0 (DESIGN als Code)

*Beleg:* --font-script: 'Caveat' ist in src/styles/globals.css:54 und src/lib/design/theme.ts:191 definiert. grep nach 'font-script' in allen .tsx: kein einziger Treffer. Hero.tsx rendert nur text-h1/text-base.

*Was fehlt / was stattdessen möglich ist:* Der handschriftliche Akzent, den DESIGN als eines von vier Merkmalen der Richtung nennt, erscheint auf keiner Seite. pruefeSeite() setzt zwar 'hoechstens einmal' durch — gerendert wird er nie.

#### 30 Gestaltung — Inter und Caveat geladen (ROADMAP Phase 0)

**Stand:** fehlt_ganz · **Phase:** 0

*Beleg:* Kein next/font, kein @font-face, kein fonts.googleapis (grep in src/). public/fonts/ existiert nicht; placeholder-assets.ts:47 vermerkt es. PUB-13/D-61 verbietet Drittanbieter, und website.spec.ts:14 zaehlt jede Fremdanfrage auf 0.

*Was fehlt / was stattdessen möglich ist:* Beide Schriften fallen auf system-ui zurueck. Die Typografie, die DESIGN §2 beschreibt, ist heute die Systemschrift des Besuchers. Selbsthosten ist der einzige Weg, der D-61 nicht bricht.

#### 2 Oeffentlicher Auftritt — News / Aktuelles

**Stand:** TEILWEISE · **Phase:** 9 (social), Website-Pflege laut Manifest Phase 2

*Beleg:* seite '/news' hat 2 Abschnitte: hero + text 'Noch keine Beitraege'. Im Schema gibt es KEINE Tabelle fuer Beitraege oder News (pg_tables: kein beitrag/news/social/post).

*Was fehlt / was stattdessen möglich ist:* Die Seite ist eine Huelle. Ohne Datenmodell fuer Beitraege gibt es nichts, was sie zeigen koennte. Die zugehoerigen Routen /portal/[mandant]/website/news und /social/posts stehen im Manifest, sind aber nicht gebaut.

#### 2 Oeffentlicher Auftritt — Inhaltsuebernahme von cse-dienstleistungen.de (PUB-08)

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* src/lib/weiterleitungen.ts: 9 Alt-URLs → 308, in next.config.ts:36 wirklich verdrahtet. Aber docs/ANNAHMEN.md O-207: alle Seitentexte sind ENTWURFSTEXTE.

*Was fehlt / was stattdessen möglich ist:* Kein Text stammt von der alten Seite; die Liste der Alt-URLs traegt selbst ein TODO(client). Alle 14 oeffentlichen Seiten warten auf Freigabe der Texte.

#### 3 Firmenprofile — Beschreibung, Gruendungsjahr, Mitarbeiterzahl (PRO-01/PRO-02 Firmendaten)

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* unternehmensprofil hat beschreibung/gruendung/mitarbeiter_zahl — in allen 8 Zeilen NULL. Gelesen wird nur kurzbeschreibung (lesen.ts:87), und die nur fuer die Markenkarten (seiten-daten.ts:112 ansprueche()).

*Was fehlt / was stattdessen möglich ist:* Die langen Profiltexte und die Firmenkennzahlen werden von nichts gelesen und von nichts gepflegt.

#### 3 Firmenprofile — Bequemer Wechsel zwischen den Profilen (PRO-03, PUB-14)

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* Vier runde Markenavatare in OeffentlicheShell.tsx:196–207 — im FUSSBEREICH. PUB-14 (SPEC §2) und DESIGN §6 letzter Absatz verlangen die Reihe UNTER DEM HERO. Der e2e-Test tests/e2e/website.spec.ts:101 heisst selbst 'die Markenavatar-Reihe steht im Fussbereich' — der Test wurde an die Umsetzung angepasst, nicht an die Zusage.

*Was fehlt / was stattdessen möglich ist:* Der Wechsel existiert, aber an der Stelle, an der ihn niemand sieht, ohne zu scrollen. Die Markenkarten auf / und /unternehmen leisten den Wechsel zusaetzlich.

#### 30 Gestaltung — Oeffentlicher Kopf nach DESIGN §5 Navigation

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* OeffentlicheShell.tsx: Hoehe 72px und backdrop-blur stimmen. Aber: links steht der Textname aus plattform_einstellung statt eines Logos; die Navigation steht rechts ('ml-auto hidden md:flex', Zeile 42) statt mittig; ein roter 'Angebot anfragen'-Knopf fehlt ganz; 'Anmelden' ist nur mit CSE_DEV_FLAECHEN da.

*Was fehlt / was stattdessen möglich ist:* Drei von vier Elementen des Kopfes aus DESIGN §5 fehlen oder stehen anders.

#### 31 Mobil — Tap-Ziele ≥ 44×44 px (DESIGN §8)

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* min-h-11 / min-w-11 im Kopf (OeffentlicheShell.tsx:88, 106, 165), in Kontaktwege.tsx:110; Portal geprueft in tests/e2e/portal-rollen.spec.ts:137

*Was fehlt / was stattdessen möglich ist:* Fuer die oeffentlichen Seiten gibt es keine Zusicherung, die alle Tippziele misst — die Markenkarten, die Leistungskacheln und die Fussverweise sind ungeprueft.

#### 2/3 Zweisprachigkeit — Deutscher Text auf der englischen Seite

**Stand:** WIDERSPRUCH · **Phase:** 2

*Beleg:* src/components/oeffentlich/MarkenKarte.tsx:53 — <span …>Mehr erfahren →</span> als Literal. Die Markenkarten erscheinen auf / und /unternehmen, also auch auf /en und /en/unternehmen (Abschnitte.tsx:110–126).

*Was fehlt / was stattdessen möglich ist:* Acht Aufrufe auf der englischen Seite tragen deutschen Text. D-82 sagt: eine englische Seite ist eine eigene Zeile — hier steht der Text aber im Quelltext und nicht in der Zeile. Gehoert nach src/lib/i18n/texte.ts.

#### Ausserhalb des Auftrags — Scraping — Scraping von Indeed/StepStone und aehnlichen

**Stand:** WIDERSPRUCH · **Phase:** keine (Recruiting Phase 9)

*Beleg:* CLAUDE.md „Out of scope“; SPEC §23. Kein Scraper im Repository; Recruiting ist in ROADMAP Phase 9 ausdruecklich auf eingehende Bewerbungen begrenzt.

*Was fehlt / was stattdessen möglich ist:* Nicht gebaut — richtig so (AGB-Verstoss, DSGVO-Risiko). STATTDESSEN moeglich: eine eigene Stellenseite unter dem oeffentlichen Auftritt, aus seite/abschnitt gepflegt wie jede andere, mit demselben Formularweg wie die Angebotsanfrage (formular_definition → formular_eingang → lead/Bewerbung). Der Kanal liegt dann bei der Gruppe und nicht bei einem Portal.

### klein

#### 2 Oeffentlicher Auftritt — JSON-LD (PUB-11)

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* src/server/inhalt/seiten-daten.ts:70–105: WebSite + 4× LocalBusiness auf '/', Breadcrumb sonst, Service + FAQPage auf Profilseiten

*Was fehlt / was stattdessen möglich ist:* Kein Organization-Block: plattform_einstellung enthaelt website.rechtstraeger nicht (nur gruppenname, renderer_benutzer, eingang_benutzer). Bewusst — O-206 offen —, aber offen.

#### 31 Mobil — Lighthouse mobil gruen (ROADMAP Phase 2)

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* lighthouserc.json und docs/LIGHTHOUSE.md liegen im Repository

*Was fehlt / was stattdessen möglich ist:* Nicht gemessen in dieser Pruefung — und Bilder sind gezeichnete SVG, deren Gewicht sich mit echten Fotos aendert.

#### Ausserhalb des Auftrags — Finanzen — Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklaerung

**Stand:** WIDERSPRUCH · **Phase:** 7

*Beleg:* CLAUDE.md „Out of scope“; ROADMAP Phase 7 „the platform prepares and exports“. Beruehrt die Abschnitte 2/3/30/31 nicht — im oeffentlichen Auftritt wird nichts davon behauptet.

*Was fehlt / was stattdessen möglich ist:* Nicht gebaut — richtig so. STATTDESSEN: Aufbereitung und Export (DATEV EXTF, Zeitexport fuer die Lohnbuchhaltung), die Abrechnung selbst macht das Lohnsystem und der Steuerberater.

#### Ausserhalb des Auftrags — Vergabe — Automatische Einreichung auf Vergabeplattformen

**Stand:** WIDERSPRUCH · **Phase:** 8

*Beleg:* CLAUDE.md „Out of scope“; ROADMAP Phase 8. Kein Einreichweg im Code; betrifft die vier geprueften Abschnitte nicht.

*Was fehlt / was stattdessen möglich ist:* Nicht gebaut — richtig so (keine Schnittstelle existiert). STATTDESSEN: Radar mit Fristenzaehler, Bewertung mit Begruendungstext und Statusverfolgung; die Abgabe bleibt ein Mensch.

---

## Rollen, Portale und Zugang (5–9, 29)

### tragend

#### 4 Anmeldung — Konto mit Passwort — Eine echte Anmeldung (Kennung + Passwort) existiert nicht. Sitzungen werden ausschliesslich ueber /dev/anmelden ausgestellt, hinter dem Schalter CSE_DEV_FLAECHEN.

**Stand:** fehlt_ganz · **Phase:** Phase 1 (PR 6 — docs/architecture/08-PR-PLAN.md:126), Mitarbeiterzugang Phase 3 (PR 20, 08-PR-PLAN.md:249). Beide unerledigt; ROADMAP.md:38 "Supabase Auth; 2FA" ist unabgehakt.

*Beleg:* src/app/dev/anmelden/page.tsx:9-21 ("die einzige Abkuerzung im ganzen Zugangsweg"); src/server/auth/sitzung.ts:86 DevAnmeldungAusFehler, :140 devSitzungAusstellen; unter src/app/auth/ existiert genau eine Datei: auth/bereich/page.tsx; package.json dependencies enthaelt kein @supabase/* und kein Passwort-Hash-Paket (nur drizzle-orm, next, postgres, react, server-only, zod); auth.users ist ein Stub mit zwei Spalten (id, email) — drizzle/0007_benutzer_auth.sql:21, keine Passwortspalte

*Was fehlt / was stattdessen möglich ist:* /auth/login, /auth/passwort-vergessen, /auth/passwort-neu, /auth/einladung/[token], /auth/callback stehen als Zeilen 56-68 im Manifest routen.generiert.ts, keine davon hat ein page.tsx. Ohne Anmeldung ist kein Deployment moeglich: ohne CSE_DEV_FLAECHEN liefert /dev/anmelden 404 und es gibt keinen anderen Einstieg.

#### 4 Anmeldung — zweiter Faktor — Der Mechanismus fuer den zweiten Faktor steht vollstaendig; das Einrichten und Vorzeigen fehlt.

**Stand:** TEILWEISE · **Phase:** Phase 1 (PR 6)

*Beleg:* rolle.erfordert_2fa = true fuer admin und super_admin (Tabelle rolle); app.hat_recht prueft erfordert_2fa gegen app.aal() (drizzle/0008_berechtigung_matrix.sql, Funktionsrumpf (2)); authorize() wirft ZweiterFaktorFehler (src/server/auth/authorize.ts:64); pruefeZugang kennt {art:'zweiter_faktor'} (src/server/auth/zugang.ts:139); Policies p_rb_aal2 und p_bm_aal2 erzwingen aal2 auf dem Schreibpfad; Trigger trg_benutzer_2fa_pflicht und trg_letzter_super_admin auf benutzer; D-33 begruendet die Live-Lesung aus auth.mfa_factors statt einer Spiegelspalte

*Was fehlt / was stattdessen möglich ist:* auth.mfa_factors ist ein Stub mit drei Spalten (id, user_id, status) und 4 Seedzeilen. devSitzungAusstellen schreibt jede Sitzung hart als 'aal2' (sitzung.ts:167) — der Faktor wird nie vorgezeigt. /auth/zwei-faktor/einrichten, /pruefen, /wiederherstellung (Manifest 57-59) sind nicht gebaut. Nur 3 der 432 Routen verlangen ueberhaupt aal2, alle drei unter einstellungen/ und keine davon gebaut.

#### 5 SUPER ADMIN — Sieht und verwaltet alles, ueber alle Gesellschaften.

**Stand:** TEILWEISE · **Phase:** Einstellungen Phase 1 (9 der 19 Routen), Rest Phase 2-10

*Beleg:* geltungsbereich='global', getragen ueber benutzer.globale_rolle_id ohne Zuweisungszeile (app.hat_recht, Zweig "Die globale Rolle"); 241 von 242 Rechten gebunden; app.ist_super_admin() verlangt zusaetzlich aal2 (D-33); Aussperrschutz trg_letzter_super_admin auf benutzer und im Editor-Trigger kern.rolle_berechtigung_pruefen (D-39); Seedkonto admin@cse-gruppe.de ohne Mitgliedschaft, Ansicht 'gruppe'

*Was fehlt / was stattdessen möglich ist:* Die Bildschirme, die ihm allein gehoeren, sind nicht gebaut: alle 19 Routen unter /portal/[mandant]/einstellungen/ (Manifest 346-364) und /portal/gruppe/protokoll (396) fallen in die Auffangroute und rendern NochNichtGebaut. Das eine Recht, das ihm fehlt, ist wachbuch.schreiben.

#### 6 ADMIN — verwaltet die ihm zugewiesenen Bereiche — Die Zuweisung je Bereich ist im Modell da; es gibt keinen Weg, sie zu setzen oder zu entziehen.

**Stand:** TEILWEISE · **Phase:** Phase 1 (PR 7)

*Beleg:* benutzer_mandant (benutzer_id, mandant_id, rolle_id, module text[], gueltig_ab/bis, entzogen_am) — mehrere Zeilen je Mensch sind moeglich und im Seed belegt (Fatima Yildiz in reinigung und security). app.hat_recht loest die Mitgliedschaftsrolle genau fuer den gefragten Mandanten auf und schneidet sie mit benutzer_mandant.module. Policy t_bm_schreiben verlangt system.benutzer_verwalten + aktiver Mandant + aal2.

*Was fehlt / was stattdessen möglich ist:* (1) Keine Oberflaeche: /portal/[mandant]/einstellungen/benutzer und /benutzer/[id] (Manifest 349-350, Phase 1) sind nicht gebaut. (2) Kein Entzugsweg: benutzer_mandant hat GRANT UPDATE fuer cse_app, aber nur eine SELECT- und eine INSERT-Policy — ein UPDATE, das entzogen_am setzt, trifft unter FORCE ROW LEVEL SECURITY null Zeilen und meldet nichts. (3) Im Seed hat kein einziger Benutzer eine module-Beschraenkung gesetzt (alle NULL), die AUT-01-Schnittmenge ist also nirgends in Betrieb; /einstellungen/module (Manifest 353) ist nicht gebaut.

#### 6/7 Was ADMIN und LEITUNG heute TATSAECHLICH unterscheidet — Der Unterschied ist in den Daten gross und auf dem Bildschirm heute null.

**Stand:** TEILWEISE · **Phase:** Die Differenz wird erst in Phase 6 (Finanzen) und 7 (Buchhaltung) sichtbar

*Beleg:* Gezaehlt in der laufenden Datenbank: admin haelt 152 gewaehrte Rechte, leitung 111; 109 teilen sie sich, 43 hat nur admin, 2 hat nur leitung — angebot.preis_freigeben und wachbuch.schreiben. Die 43 sind im Kern Geld und Verwaltung: buchhaltung.* (5), finanzen.schreiben/festschreiben/entwurf_verwerfen/stornieren, eingang.* (2), mahnung.* (2), abrechnung.* (3), zahlung.schreiben, system.* (6), personal.stammdaten_lesen/zugang_verwalten/erstattung_lesen, crm.rechtsgrundlage_lesen/_setzen, crm_entgelt.lesen, bau.preis_lesen, nachweis.preis_lesen, zeit.exportieren, social.*, recruiting.*, referenz.schreiben.

*Was fehlt / was stattdessen möglich ist:* Auf dem Bildschirm zeigt sich davon nichts. Alle 17 Rechte der Seitennavigation (src/server/registry/navigation.ts) haelt leitung genauso wie admin; der einzige Punkt, den keiner von beiden sieht, ist "Einstellungen" (verlangt system.einstellung_lesen — nur super_admin). Von den 56 Routen, die nur admin sehen darf, sind genau ZWEI als Seite gebaut: /portal/[mandant]/zeiten/milog und /portal/[mandant]/finanzen/rechnungen/neu. Die uebrigen 54 liegen in Phase 6-9 (Buchhaltung, Eingangsrechnungen, Mahnwesen, Social, Recruiting, Radar) oder sind Unterseiten, die es nicht gibt. Kein Browsertest prueft einen Unterschied zwischen den beiden Rollen — tests/e2e/portal-rollen.spec.ts prueft nur, dass jede Rolle in ihrem Portal landet und dass leitung/bau auf security 404 bekommt.

#### 8 MITARBEITER — Rolle, Portal und Selbstzugriff sind gebaut; der Zugang dorthin nicht.

**Stand:** TEILWEISE · **Phase:** Phase 3, PR 20 (08-PR-PLAN.md:249) — Telefon + sechsstelliger Code, ein Login je person_id

*Beleg:* Rolle mitarbeiter, Portal 'mitarbeiter', Familien mein/konto/checkin (zugang.ts:47); 8 gewaehrte Rechte, alle schreibend auf eigene Sachen (aufgabe.schreiben, bau.aufmass_erfassen, dokument.schreiben, nachricht.versenden, nachweis.schreiben, schluessel.schreiben, wachbuch.schreiben, zeit.abwesenheit_melden); Selbstzugriff als eigene Bewachungsart 'selbst' ueber app.person_id, ohne Recht auch fuer super_admin (zugang.ts:131); 15 gebaute Seiten unter /portal/mein plus Auffangroute; Check-in ueber Token ohne Sitzung (api/check-in/[token], Prinzipal cse_checkin ohne Tabellenrecht)

*Was fehlt / was stattdessen möglich ist:* Es fuehrt kein Weg hinein: /auth/mitarbeiter und /auth/mitarbeiter/code (Manifest 64-65, Phase 3) sind nicht gebaut, mitarbeiter_zugang existiert nicht als Tabelle. Der Mensch kommt heute nur ueber /dev/anmelden in sein Portal.

#### 29 "Permissions must be configurable" — Datenmodell, Recht und Schutz der Rechteverwaltung sind vollstaendig gebaut. Eine Oberflaeche dafuer gibt es nicht.

**Stand:** TEILWEISE · **Phase:** Phase 1, PR 7 "Rollen- und Berechtigungsmatrix mit Editor" (08-PR-PLAN.md) — der Migrations- und Policyteil ist geliefert, der Editor nicht

*Beleg:* DA: berechtigung mit 242 Zeilen (drizzle/0008_berechtigung_matrix.sql, erzeugt aus 03-AUTH §12 via `pnpm katalog`, nicht abgetippt); rolle_berechtigung mit mandant_id-Uebersteuerung und gewaehrt BOOLEAN, damit ein Entzug sich von "nie eingestellt" unterscheidet; Policy t_rb_aendern (mandant_id = app.aktiver_mandant() AND app.hat_recht('system.rolle_verwalten', mandant_id)); Policy p_rb_aal2; Trigger kern.rolle_berechtigung_pruefen mit Aussperrschutz VOR der Rechtepruefung und der Regel "was der Vergebende selbst nicht haelt, kann er nicht vergeben" (D-38, D-39). Das erfuellt AUT-03 im Kern: ein Recht laesst sich je Gesellschaft ohne Deployment aendern. NICHT DA: src/app/portal/[mandant]/einstellungen/rollen/page.tsx existiert nicht — das Verzeichnis src/app/portal/[mandant]/einstellungen/ gibt es ueberhaupt nicht.

*Was fehlt / was stattdessen möglich ist:* Die Antwort auf die Frage des Mandanten lautet: nur der Katalog, keine Oberflaeche. Die Routen /einstellungen/rollen und /einstellungen/rollen/[rolle] (Manifest 351-352, aal2, Phase 1) fallen in [...rest] und rendern NochNichtGebaut. ROADMAP.md:39 "Five roles with configurable permissions, editable in the UI" ist unabgehakt. Gestellt wird die Rechteaenderung heute per INSERT/UPDATE auf rolle_berechtigung.

#### Ausserhalb des Auftrags — Kaltakquise an gescrapte Kontakte — Wird nicht gebaut, und die Sperre steht in der Datenbank statt in einem Absatz.

**Stand:** WIDERSPRUCH · **Phase:** keine — bewusst entfernt

*Beleg:* § 7 UWG verbietet unaufgeforderte elektronische Werbung ohne vorherige ausdrueckliche Einwilligung, auch B2B — CLAUDE.md "Out of scope", docs/SPEC.md:635. Gebaut ist das Gegenteil einer Scraping-Funktion: app.darf_kontaktiert_werden(uuid, text, text) (drizzle/0020_crm_identitaet.sql:562) mit Ausloeser auf dem Sendepfad, geprueft in tests/isolation/uwg.test.ts ("was nicht aufgezeichnet werden kann, kann nicht gesendet werden"); die Rechte crm.rechtsgrundlage_lesen und _setzen halten nur super_admin und admin.

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN moeglich: Versand ausschliesslich an Kontakte mit aufgezeichneter Rechtsgrundlage (Bestandskunde, Einwilligung, Vertrag) samt Quelle und Erfassungsdatum, mit Werbewiderspruch je Kontakt und Kanal. Wer Neukunden ansprechen will, tut das ueber Inbound (Angebotsanfrage, Formular) oder auf einem Kanal ausserhalb § 7 UWG — Post, Telefon im gesetzlichen Rahmen.

#### Ausserhalb des Auftrags — Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklaerung — Wird nicht gebaut; die Plattform bereitet vor und exportiert.

**Stand:** WIDERSPRUCH · **Phase:** Export in Phase 7 — die Berechnung in keiner

*Beleg:* docs/SPEC.md:637-638; CLAUDE.md "Out of scope". Was es gibt, ist ausschliesslich Export: /portal/[mandant]/buchhaltung/lohnexport (Manifest 265, Recht zeit.exportieren, Phase 7, nicht gebaut), /buchhaltung/datev und /jahrespaket (Phase 7). Die Zeitseite, die die Grundlage liefert, ist gebaut: /portal/[mandant]/zeiten/milog (§ 17 MiLoG).

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN moeglich: geprueftes Zeit- und Stundenkonto je anstellung_id als Exportdatei fuer das Lohnsystem, DATEV-Export der Belege, Jahrespaket fuer den Steuerberater. Die Berechnung von Lohn, Beitraegen und Bilanz bleibt beim Lohnsystem und beim Steuerberater.

### wichtig

#### 4 Anmeldung — Ratenlimit und Sperre (AUT-07) — Ratenlimit und Kontosperre auf den Anmeldewegen.

**Stand:** fehlt_ganz · **Phase:** Phase 1 (PR 6, Akzeptanz 3: elf Fehlversuche sperren und schreiben elf Auditzeilen)

*Beleg:* Die Tabelle kern.anmeldeversuch existiert (drizzle/0007_benutzer_auth.sql, begruendet in D-34) und hat 0 Zeilen; kein einziger Treffer fuer "anmeldeversuch" in src/. benutzer.gesperrt_bis existiert als Spalte, wird nirgends geschrieben.

*Was fehlt / was stattdessen möglich ist:* Ein Ratenlimit gibt es nur fuer das oeffentliche Formular: app.formular_eingang_zaehlen (drizzle/0016_formular.sql:370) ueber ip_hash. Fuer die Anmeldung gibt es nichts zu begrenzen, weil es die Anmeldung nicht gibt.

#### 7 LEITUNG — nur die ihr zugewiesenen Teams — Eine Team-Ebene unterhalb der Gesellschaft gibt es nirgends.

**Stand:** fehlt_ganz · **Phase:** keine — in keiner Phase des ROADMAP eingeplant

*Beleg:* Keine Tabelle mit "team" oder "abteilung" im Schema (information_schema-Abfrage leer); kein Feld, keine Route im 432er-Manifest, keine Zeile im Seed. In docs/SPEC.md kommt "team" genau einmal vor: Zeile 371, CAL-02 "Filter by area, team, person".

*Was fehlt / was stattdessen möglich ist:* Die Sichtbarkeitsgrenze einer Leitung ist heute die Gesellschaft, nicht das Team. Wer in einer Gesellschaft leitung ist, sieht alle Personen, Dienstplaene und Objekte dieser Gesellschaft. Das ist eine bewusst offene Frage und nirgends als TODO(client) erfasst.

#### 29 CSP, HSTS, X-Frame-Options (SEC-A7) — Keine Sicherheitskoepfe.

**Stand:** fehlt_ganz · **Phase:** Phase 10 (Hardening) — in ROADMAP nicht namentlich gefuehrt

*Beleg:* Kein Treffer fuer Content-Security-Policy, Strict-Transport-Security oder X-Frame-Options in src/ oder next.config.*. src/middleware.ts setzt ausschliesslich zwei Sprachkoepfe auf der ANFRAGE (KOPF_SPRACHE, KOPF_PFAD) und nichts auf der Antwort.

*Was fehlt / was stattdessen möglich ist:* Das oeffentliche, unangemeldete Angebot laeuft heute ohne CSP und ohne Clickjacking-Schutz.

#### 9 KUNDE — Rolle, Bindung und Decke stehen; das Kundenportal ist eine ehrliche leere Seite.

**Stand:** TEILWEISE · **Phase:** Phase 4 (CRM) fuer den Ausstellungsweg; die Portalinhalte Phase 6+

*Beleg:* Rolle kunde (Portal 'kunde') mit 13 reinen Leserechten; kunde_zugang (mandant_id, kunde_id, benutzer_id, entzogen_am) mit zwei Policies — t_eigener_zugang und t_zugang_verwalten (verlangt system.benutzer_verwalten), 1 Seedzeile; withKundeScope loest ueber kunde_zugang auf, nie ueber aktiver_mandant(); src/app/portal/kunde/page.tsx sagt ausdruecklich, dass die Daten noch nicht da sind, statt leere Listen zu zeigen (KeinKundenzugangFehler)

*Was fehlt / was stattdessen möglich ist:* Keine einzige Unterseite gebaut — /portal/kunde/[...rest] faengt alles ab. /portal/[mandant]/crm/kunden/[id]/zugang (Manifest 81, Phase 3, Recht system.benutzer_verwalten) — "issue, re-issue and revoke" — ist nicht gebaut; Ausstellen und Entziehen eines Kundenzugangs geht heute nur per SQL.

#### 29 Rechtevergabe — der Deckel aus der Matrix wird nicht erzwungen — Die Matrix unterscheidet gebunden (haelt das Recht) von bindbar (darf es bekommen). Nur die erste Haelfte steht in der Datenbank.

**Stand:** TEILWEISE · **Phase:** Phase 1 (PR 7, Akzeptanz 4)

*Beleg:* src/server/auth/katalog.generiert.ts fuehrt je Schluessel gebunden:[...] UND bindbar:[...] (z. B. Zeile 85: finanzen.stornieren, gebunden super_admin, bindbar admin+leitung). Die Datei wird ausschliesslich von Tests gelesen (tests/kern/katalog.test.ts, tests/isolation/harness.ts u. a.). Der Trigger kern.rolle_berechtigung_pruefen prueft den Deckel nicht.

*Was fehlt / was stattdessen möglich ist:* Nichts hindert heute daran, einer Rolle ein Recht zu binden, das die Matrix fuer sie gar nicht vorsieht — etwa mitarbeiter finanzen.festschreiben. Der Editor, wenn er gebaut wird, muss das entweder in der UI oder besser im Trigger durchsetzen; sonst ist der Unterschied zwischen ✔ und ○ nur ein Kommentar.

#### 29 Eingabepruefung (SEC-A4: Zod an jeder Grenze) — Zod steht an drei Stellen, nicht an jeder Grenze.

**Stand:** TEILWEISE · **Phase:** keine benannte — PR 6 fuehrt SEC-A4 im Scope, ist aber nicht gebaut

*Beleg:* Genau drei Dateien importieren zod: src/server/env.ts, src/lib/formular/schema.ts (die oeffentliche Angebotsanfrage, gegen die Formularversion validiert), src/server/services/inhalt/jsonld.ts. Die Portal-API-Routen lesen anfrage.formData() und pruefen von Hand; die eigentliche Absicherung sind die CHECK-Constraints, Enums und Trigger der Datenbank plus die Abweisungslisten der Handler (z. B. ABWEISUNGEN in api/rechnungen/festschreiben/route.ts).

*Was fehlt / was stattdessen möglich ist:* SEC-A4 sagt "at every boundary". Dass die Datenbank haelt, ist die zweite Linie; eine getippte Zahl in einem Formular erzeugt heute je nach Feld eine 409 aus Postgres statt einer benannten Feldmeldung.

#### 29 Audit-Log — Der Trail steht und ist unloeschbar; die Anmeldeereignisse fehlen, weil es keine Anmeldung gibt, und es gibt keinen Bildschirm, der ihn zeigt.

**Stand:** TEILWEISE · **Phase:** Protokollseiten Phase 1; Export Phase 7

*Beleg:* audit_log mit ebene, akteur_typ (mensch/agent/system), akteur_id, agent_id, aktion, objekt_typ/-id, vorher, nachher, geaenderte_felder, ip, sitzung_id (drizzle/0003_audit_log.sql, 0005_immutability_audit.sql). 43 Audit-Trigger auf Fachtabellen; trg_audit_log_kein_hard_delete und _kein_truncate; Lesepolicy t_audit_lesen ueber app.sichtbare_mandanten(). kern.sitzung_wechsel_audit schreibt jeden Bereichs- und Ansichtswechsel (TEN-09, begruendet in D-34).

*Was fehlt / was stattdessen möglich ist:* (1) AUT-08 "all auth events" ist leer: 0 Zeilen mit objekt_typ='benutzer_sitzung', keine Anmeldung, keine Abmeldung, keine Fehlversuche im Log. (2) Kein Leseweg: /portal/[mandant]/einstellungen/protokoll (Manifest 362, Phase 1, Recht system.audit_lesen) und /portal/gruppe/protokoll (396) sind nicht gebaut. system.audit_lesen haelt ausserdem nur super_admin — ein admin kann das Protokoll seiner eigenen Gesellschaft nicht lesen.

#### 29 Sicherer Dokumentenzugriff — Signierte Adressen sind gebaut und ohne Ausweichweg; genutzt werden sie bisher an einer Stelle.

**Stand:** TEILWEISE · **Phase:** Dokumentenmodul Phase 7

*Beleg:* src/server/storage/adapter.ts:107 signierteUrl — wenn das Signieren scheitert, wird geworfen und NICHT auf einen oeffentlichen Pfad ausgewichen (:122). src/app/api/medien/[id]/route.ts: Sitzung, dann authorize(), dann die Zeile ueber die SITZUNG gelesen (nicht als Definer), dann 15 Minuten gueltige Adresse; null Zeilen ergeben 404, nie 403. EXIF-Bereinigung in src/server/storage/exif.ts, HEIC wird abgelehnt statt zerstoert (D-306).

*Was fehlt / was stattdessen möglich ist:* Genau ein Aufrufer: src/server/services/zeit/medien.ts:287. Dokumentbuendel-Export (/portal/[mandant]/dokumente/buendel, Phase 7) und die Dokumentenablage insgesamt sind nicht gebaut. Ohne konfigurierten Speicher wirft der Adapter NichtVerbundenFehler — die Route sagt das, statt eine Datei zu erfinden.

#### Ausserhalb des Auftrags — Scraping von Indeed/StepStone — Wird nicht gebaut.

**Stand:** WIDERSPRUCH · **Phase:** Recruiting Phase 9 — und auch dort nur inbound

*Beleg:* AGB-Verstoss und DSGVO-Risiko auf Bewerberdaten — CLAUDE.md "Out of scope", docs/SPEC.md:411 "Scope: inbound applications. No scraping of job boards" und :636. Im Schema gibt es keine Tabelle und im Manifest keine Route fuer eine Boersenabfrage; recruiting.* fuehrt nur stelle_veroeffentlichen und daten_loeschen.

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN moeglich: eigene Stellenseite auf der oeffentlichen Website, Eingangsbewerbung ueber das Formularsystem, und eine Veroeffentlichungs-Schnittstelle je Boerse, die bei fehlenden Zugangsdaten in der Oberflaeche "nicht verbunden" anzeigt statt einen Erfolg zu simulieren.

#### Ausserhalb des Auftrags — automatische Einreichung auf Vergabeplattformen — Wird nicht gebaut; die Einreichung wird protokolliert, nicht ausgeloest.

**Stand:** WIDERSPRUCH · **Phase:** Phase 8

*Beleg:* docs/SPEC.md:639 "No API exists; submission is manual by design"; CLAUDE.md "Out of scope". Die einzige zugehoerige Manifestzeile ist 281: /portal/[mandant]/radar/[id]/mappe/einreichung — Beschreibung woertlich "record that a human submitted, with when and by whom", Recht vergabe.einreichung_erfassen, Phase 8. Keine ausgehende Schnittstelle zu einem Vergabeportal im Repository.

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN moeglich: Fristenwaechter, vollstaendige Angebotsmappe als Paket zum Herunterladen, und ein Nachweis, WER wann eingereicht hat — das ist die Zeile, die in einer Ruege spaeter zaehlt.

---

## Dashboards, CRM und Vertrieb (10–14)

### tragend

#### 10 Hauptübersicht — Aktive Aufträge als Kachel

**Stand:** fehlt_ganz · **Phase:** keine — Voraussetzungen liegen seit Phase 4/5 vor

*Beleg:* src/server/services/bericht/kacheln.ts (12 Kacheln, keine für auftrag); Tabelle auftrag = 3 Zeilen, davon 2 status='aktiv'; Seite src/app/portal/[mandant]/auftraege/page.tsx ist gebaut

*Was fehlt / was stattdessen möglich ist:* Tabelle, Recht (auftrag.lesen), Liste und Seed sind da — nur die Kachel wurde nie registriert. Die Zahl ist heute schreibbar.

#### 10 Hauptübersicht — Aktive Projekte als Kachel

**Stand:** fehlt_ganz · **Phase:** keine

*Beleg:* kacheln.ts kennt kein Modul 'bau'; Tabelle projekt = 1 Zeile status='in_arbeit'; Seiten src/app/portal/[mandant]/bau/projekte/** gebaut

*Was fehlt / was stattdessen möglich ist:* Keine einzige Bau-Kachel existiert, obwohl das Bau-Modul (Projekte, LV, Aufmaß, Nachträge, Bautagebuch, Behinderungen) gebaut ist.

#### 10 Hauptübersicht — Offene Rechnungen

**Stand:** fehlt_ganz · **Phase:** keine

*Beleg:* kacheln.ts Kopfkommentar Z. 5–11 begründet die Auslassung damit, das Modul komme „in Phase 7"; tests/kern/kennzahlen.test.ts verbietet ausdrücklich ein Modul 'finanzen' in belegteModule()

*Was fehlt / was stattdessen möglich ist:* Die Begründung ist überholt: rechnung hat 10 Seed-Zeilen (5 festgeschrieben, faellig_am gesetzt), src/server/services/finanz/* und /portal/[mandant]/finanzen/rechnungen/* sind gebaut, Nav-Punkt „Rechnungen" existiert (registry/navigation.ts). Der Test hält eine Aussage über den Bauzustand fest, die nicht mehr stimmt.

#### 10 Hauptübersicht — Ausgaben

**Stand:** fehlt_ganz · **Phase:** 6 (Erfassung), 9 (Bericht)

*Beleg:* 137 Tabellen in cse_p5; keine heisst ausgabe, beleg, eingangsrechnung, zahlung oder mahnung (geprüft per pg_tables). 'posten' ist der Wachposten der Security, kein Kostenposten

*Was fehlt / was stattdessen möglich ist:* Ohne Eingangsrechnungen/Zahlungen gibt es keine Datenquelle. Vor Phase 6 („Incoming invoices, expenses, payments, dunning", ROADMAP Phase 6) ist die Zahl nicht berechenbar.

#### 10 Hauptübersicht — Gewinn

**Stand:** fehlt_ganz · **Phase:** 6 + 9

*Beleg:* folgt aus Umsatz und Ausgaben; keine Kachel, kein Dienst, keine Tabelle für die Ausgabenseite

*Was fehlt / was stattdessen möglich ist:* Nicht vor der Ausgabenerfassung möglich. Eine Gewinnkachel, die nur Umsatz kennt, wäre eine falsche Zahl — nicht eine fehlende.

#### 11 CRM — Kundenhistorie über alle vier Gesellschaften (CRM-06)

**Stand:** fehlt_ganz · **Phase:** keine benannte; die Gruppenseiten sind an kein Phasenziel gebunden

*Beleg:* 04-SEITENKARTE.md §5.2 legt sie ausdrücklich auf /portal/gruppe/kunden; diese Route steht im Manifest (routen.generiert.ts) und hat keine Seite → src/app/portal/gruppe/[...rest]/page.tsx → NochNichtGebaut. crm/kunden/[id] liest unter withTenant nur den aktiven Mandanten

*Was fehlt / was stattdessen möglich ist:* Genau die Frage, für die es die Gruppenansicht gibt — ob ein Kunde bei zwei Gesellschaften liegt — wird heute nirgends beantwortet. Ausserdem fehlen auf der Kundenseite Angebote und Rechnungen ganz.

#### 10/11 Module — mandant.module ist bei allen vier Gesellschaften leer und wird nirgends gelesen

**Stand:** fehlt_ganz · **Phase:** 1 — überfällig

*Beleg:* Spalte mandant.module text[] NOT NULL DEFAULT '{}'; select in cse_p5 zeigt {} für reinigung, security, bau, operations; src/server/db/seed/index.ts:122/128 schreibt den Wert hart als '{}'; grep über src findet ausser der Rechtezeile system.module_zuweisen (katalog.generiert.ts:220) und Beschreibungstexten in routen.generiert.ts keinen Leser

*Was fehlt / was stattdessen möglich ist:* 04-SEITENKARTE.md §1.7 verspricht zwei Tore, beide fehlen: (a) „read once in the [mandant] layout" — es gibt kein src/app/portal/[mandant]/layout.tsx (find über src/app liefert nur app/, (public)/, dev/); (b) „intersected again inside app.hat_recht (stage 4)" — die Funktion schneidet gegen benutzer_mandant.module, nicht gegen mandant.module, und diese Spalte ist in allen 18 Seed-Zeilen NULL, also auch dort ein No-op. Die Pflegeseite /portal/[mandant]/einstellungen/module steht im Manifest als phase: 1 (routen.generiert.ts:353) und ist nicht gebaut.

#### 10 Hauptübersicht — Gerade arbeitende Mitarbeiter (DSH-05)

**Stand:** TEILWEISE · **Phase:** keine

*Beleg:* Seite src/app/portal/[mandant]/zeiten/live/page.tsx gebaut, liest die Sicht zeiteintrag_offen über src/server/services/zeit/live.ts:35; in kacheln.ts gibt es KEINE Kachel dafür

*Was fehlt / was stattdessen möglich ist:* Auf der Übersicht selbst steht die Zahl nicht. zeiten/live/page.tsx:15 beruft sich wörtlich auf „dieselbe Sicht wie die Kachel des Dashboards (zeiteintrag_offen)" — diese Kachel existiert nicht; zeiteintrag_offen ist eine Datenbanksicht.

#### 10 Hauptübersicht — Filter über alle Gesellschaften und je Gesellschaft (DSH-02)

**Stand:** TEILWEISE · **Phase:** keine — die Gruppenkacheln sind an kein Phasenziel gebunden

*Beleg:* src/app/portal/gruppe/page.tsx rendert KEINE Kachel, nur die Namensliste der vier mandant-Zeilen plus den Satz „Kennzahlen über alle Gesellschaften erscheinen hier, sobald die Module gemergt sind"; der einzige funktionierende Bereichsfilter liegt in src/app/dev/dashboard/page.tsx hinter devFlaechenAn() (src/app/dev/layout.tsx:31)

*Was fehlt / was stattdessen möglich ist:* Je Gesellschaft: ja, aber fix durch die Sitzung, ohne Umschalter — so auch bewusst entschieden (04-SEITENKARTE.md §5.1: „There is no all-areas toggle on a tenant dashboard"). Über alle Gesellschaften: gar nicht, weil die Gruppenübersicht keine Kacheln hat. Die Zusage steht nur im Entwicklungsbaum, den ein Deployment nicht ausliefert.

#### 10 Hauptübersicht — Jede Zahl führt zu ihren Datensätzen (DSH-04)

**Stand:** TEILWEISE · **Phase:** keine

*Beleg:* kennzahlen.ts erzwingt ein Ziel bei der Registrierung; aber kacheln.ts:167 'offene_wiedervorlagen' zielt auf /portal/<slug>/crm/wiedervorlagen und kacheln.ts:86 'benutzer_aktiv' auf /portal/<slug>/einstellungen/benutzer — beide Seiten gibt es nicht und fallen auf src/app/portal/[mandant]/[...rest]/page.tsx → NochNichtGebaut

*Was fehlt / was stattdessen möglich ist:* 2 von 12 Kacheln enden auf „noch nicht gebaut". In der Gruppenansicht zielen alle auf /portal/gruppe/<x> — keine dieser Seiten ist gebaut. Der e2e-Beweis (tests/e2e/dashboard.spec.ts) läuft ausschliesslich gegen /dev/dashboard und /dev/kennzahl, nicht gegen das angemeldete Portal.

#### 11 CRM — Kontakte (Ansprechpartner)

**Stand:** TEILWEISE · **Phase:** 4 — überfällig

*Beleg:* Tabelle ansprechpartner, 4 Seed-Zeilen; sichtbar auf src/app/portal/[mandant]/crm/kunden/[id]/page.tsx inkl. app.darf_kontaktiert_werden je Kontakt. Die eigenen Routen crm/kontakte, crm/kontakte/[id], crm/kontakte/[id]/rechtsgrundlage stehen im Manifest (Phase 4) und sind NICHT gebaut

*Was fehlt / was stattdessen möglich ist:* Es gibt keine Kontaktliste über Kunden hinweg und keinen Weg, die Rechtsgrundlage in der Oberfläche zu setzen — obwohl die CRM-Übersicht genau das zählt und meldet („N Ansprechpartner dürfen nicht beworben werden", crm/page.tsx). Sinngemäss derselbe Befund wie D-101: wer den Versand sperrt, muss einen Weg heraus bauen.

#### 11 CRM — Lead-Score

**Stand:** TEILWEISE · **Phase:** keine benannte

*Beleg:* Spalten lead.punktzahl, punktzahl_begruendung, punktzahl_berechnet_am vorhanden und in crm/leads/page.tsx mit Begründung als title angezeigt. Kein Dienst berechnet sie: grep 'punktzahl' über src/server/services und src/app/api liefert nichts; src/server/services/lead/ enthält annahme, benachrichtigung, bestaetigung, eskalation, sla

*Was fehlt / was stattdessen möglich ist:* Der Seed schreibt „Platzhalter: Flaeche und Frequenz bekannt, Budget unbestaetigt (O-73)" mit fixem Wert 72 für beide Leads. Ein Lead aus dem Webformular (services/lead/annahme.ts:223) bekommt gar keine Punktzahl — die Spalte „Punkte" steht dann auf „—".

#### 11 CRM — Wiedervorlagen

**Stand:** TEILWEISE · **Phase:** 4 — überfällig

*Beleg:* Spalten lead_aktivitaet.faellig_am, erinnerung_am, zustaendig_benutzer_id, erledigt_am plus Index lead_aktivitaet_wiedervorlage_idx; Kachel kacheln.ts:167 zählt sie. Kein Schreibweg setzt sie: api/lead/route.ts schreibt nur typ/betreff/inhalt und lead.naechste_aktion_*; die Seite crm/wiedervorlagen (Manifest, Phase 4) ist nicht gebaut

*Was fehlt / was stattdessen möglich ist:* Schema, Index und Kachel sind da, der Mensch hat keinen Weg dorthin. Die Kachel steht damit dauerhaft auf 0 und ihr Ziel ist eine NochNichtGebaut-Seite. Eine Erinnerung wird nirgends versendet.

#### 10/11 Module — Was das für die Hochbau-Gesellschaft (REALTIME Service) bedeutet

**Stand:** WIDERSPRUCH · **Phase:** 1 (Modultor) und keine (Bau-Kacheln)

*Beleg:* src/server/registry/navigation.ts filtert ausschliesslich nach Recht; die Plattformrollen admin/leitung/super_admin halten reinigung.lesen, security.lesen, wachbuch.lesen, dienstanweisung.lesen, schluessel.lesen mit rolle.mandant_id IS NULL, also in JEDEM Bereich (select über rolle_berechtigung bestätigt); die Seiten selbst prüfen kein Modul (z. B. reinigung/reviere/page.tsx ruft nur portalZugang)

*Was fehlt / was stattdessen möglich ist:* Der Hochbau-Admin bekommt Sidebar-Punkte „Reinigung", „Security", „Dienstanweisungen", „Schlüssel" und erreicht /portal/bau/reinigung/reviere und /portal/bau/security/wachbuch mit 200 statt des von §1.7 versprochenen notFound(). Umgekehrt zeigen die zwölf Kacheln für bau: 3 Personen, 3 Beschäftigungen — und sonst Nullen (lead 0, einsatz 0, antrag 0, abwesenheit 0, planungs_konflikt 0, lead_aktivitaet 0), obwohl 1 Projekt, 1 Nachtrag, 1 Aufmass und 1 Auftrag tatsächlich in der Datenbank stehen. Neun von zwölf Kacheln zeigen 0, und keine einzige zeigt, was diese Gesellschaft tut.

#### Out of scope — ausdrücklich geprüft — Kaltakquise an gescrapte Kontakte

**Stand:** WIDERSPRUCH · **Phase:** nie

*Beleg:* D-01 (§ 7 UWG, auch B2B) und SPEC §23. Gebaut ist das Gegenteil: Trigger trg_lead_aktivitaet_uwg_sendetor → kern.uwg_sendetor() auf jedem INSERT in lead_aktivitaet; app.darf_kontaktiert_werden wird von crm/page.tsx und crm/kunden/[id]/page.tsx gefragt; ansprechpartner.rechtsgrundlage ist der Rolle cse_app entzogen (K-05); enum rechtsgrundlage mit einwilligung/bestandskunde/anfrage/keine

*Was fehlt / was stattdessen möglich ist:* Wird nicht gebaut und darf nicht gebaut werden. STATTDESSEN möglich und vorhanden: Eingangsformulare der Website (formular_eingang, src/app/api/anfrage/route.ts), Vergabe-Radar (Phase 8), Empfehlung, manuelle Erfassung — enum lead_quelle führt genau diese vier. Fehlt noch: ein Weg, die Rechtsgrundlage in der Oberfläche zu setzen.

#### Out of scope — ausdrücklich geprüft — Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklärung

**Stand:** WIDERSPRUCH · **Phase:** nie

*Beleg:* D-06 und SPEC §23 (drei Branchentarife plus SOKA-Bau; Jahresabschluss beim Steuerberater). Gebaut ist die Vorbereitung: zeitnachweis, stundenkonto, stundenkonto_bewegung, urlaubskonto, Monatsabschluss (/personal/stundenkonten/abschluss), § 17 MiLoG unter /zeiten/milog

*Was fehlt / was stattdessen möglich ist:* Wird nicht gebaut. STATTDESSEN: die Plattform bereitet auf und exportiert — Stunden, Zuschläge, Abwesenheiten je Beschäftigung — und ein Lohnsystem sowie der Steuerberater rechnen. DATEV-Export ist Phase 7 und ebenfalls nur Export.

### wichtig

#### 10 Hauptübersicht — Offene Angebote

**Stand:** fehlt_ganz · **Phase:** keine

*Beleg:* keine Kachel in kacheln.ts; Tabelle angebot = 2 Zeilen (1 entwurf, 1 angenommen); Seiten /portal/[mandant]/angebote, /angebote/[id], /kalkulation, /pdf gebaut

*Was fehlt / was stattdessen möglich ist:* Modul, Recht (angebot.lesen) und Nav-Punkt „Angebote" sind da; nur die Kachel fehlt.

#### 10 Hauptübersicht — Benachrichtigungen

**Stand:** fehlt_ganz · **Phase:** 9 (NOT-*)

*Beleg:* Tabellen benachrichtigung und benachrichtigung_praeferenz existieren, beide 0 Seed-Zeilen; grep über src/app findet keine Seite und keine Route, die sie liest; kein Nav-Punkt in src/server/registry/navigation.ts; keine Kachel

*Was fehlt / was stattdessen möglich ist:* Klassischer Fall „Tabelle ist kein Modul": es gibt kein Postfach, keinen Dienst, keinen Zusteller, keine Zeile im Seed.

#### 10 Hauptübersicht — Anstehende Aufgaben

**Stand:** TEILWEISE · **Phase:** keine für die Teilmengen; eine echte Aufgabenverwaltung ist in keiner Phase benannt

*Beleg:* kacheln.ts:252 'antraege_offen', :167 'offene_wiedervorlagen', :225 'konflikte_offen', :193 'schichten_unbesetzt', :330 'nachweise_abgelaufen'; eine Tabelle 'aufgabe' gibt es nicht (pg_tables geprüft)

*Was fehlt / was stattdessen möglich ist:* Es gibt fünf Teilmengen, aber keine Aufgabe als eigene Sache und keine zusammengeführte Liste. lead_aktivitaet.typ kennt den Wert 'aufgabe', wird aber nirgends als Aufgabenliste gezeigt.

#### 10 Hauptübersicht — Letzte Aktivität

**Stand:** TEILWEISE · **Phase:** keine

*Beleg:* kacheln.ts:150 'letzte_aktivitaet' zählt lead_aktivitaet der letzten 7 Tage; Seed hat 0 Zeilen in lead_aktivitaet; audit_log hat 756 Zeilen und wird nirgends angezeigt (/portal/gruppe/protokoll nicht gebaut)

*Was fehlt / was stattdessen möglich ist:* Die Kachel zeigt heute in allen vier Gesellschaften dauerhaft 0 und meint nur CRM-Aktivität, nicht Plattformaktivität. Ihr Ziel ist /crm/kunden — nicht die Liste hinter der Zahl, damit ein DSH-04-Bruch im Kleinen.

#### 11 CRM — Kommunikationshistorie

**Stand:** TEILWEISE · **Phase:** 4 — überfällig

*Beleg:* lead_aktivitaet trägt typ, richtung, zweck, kanal, rechtsgrundlage_snapshot, akteur_art und den UWG-Trigger trg_lead_aktivitaet_uwg_sendetor; angezeigt als „Verlauf" auf crm/leads/[id]. Die Kundenseite crm/kunden/[id]/page.tsx liest sie NICHT (Abschnitte dort: Ansprechpartner, Objekte, Aufträge)

*Was fehlt / was stattdessen möglich ist:* Der Kommunikations-Tab aus 04-SEITENKARTE.md §5.2 fehlt. Seed: 0 Zeilen in lead_aktivitaet — die Historie ist nirgends im Demodatenbestand ausgeübt.

#### 26 Berichte — Kanalattribution (REP-03) — welcher Kanal brachte den unterschriebenen Auftrag

**Stand:** TEILWEISE · **Phase:** 9

*Beleg:* lead.quelle (enum lead_quelle: webformular, vergabe_radar, manuell, empfehlung), lead.utm_quelle/utm_medium/utm_kampagne/utm_begriff/utm_inhalt, lead.referrer, lead.konvertiert_am, lead.empfehlung_von_kunde_id, lead.ausschreibung_id

*Was fehlt / was stattdessen möglich ist:* Die Rohdaten werden bereits erhoben, ausgewertet wird nichts. Im Seed hat jeder Lead quelle='manuell', formular_eingang ist leer (0 Zeilen) — die anderen drei Kanäle sind nie geübt.

#### Out of scope — ausdrücklich geprüft — Scraping von Indeed/StepStone

**Stand:** WIDERSPRUCH · **Phase:** nie

*Beleg:* D-02 (AGB-Verstoss, DSGVO-Risiko über Bewerberdaten) und SPEC §23. Im Repository existiert kein Recruiting überhaupt: keine Tabelle bewerbung/stelle (pg_tables geprüft), kein Dienst, keine Route

*Was fehlt / was stattdessen möglich ist:* Wird nicht gebaut. STATTDESSEN: Recruiting auf eingehenden Bewerbungen; Veröffentlichung einer Stelle nur über eine echte API mit echten Zugangsdaten, sonst in der Oberfläche als „nicht verbunden" markiert (Phase 9).

#### Out of scope — ausdrücklich geprüft — Automatische Einreichung auf Vergabeplattformen

**Stand:** WIDERSPRUCH · **Phase:** nie (Einreichung); 8 (Radar)

*Beleg:* D-07 und SPEC §23 („No API exists; submission is manual by design"). Im Repository gibt es keine Tabelle ausschreibung und keinen Radar-Dienst; lead.ausschreibung_id steht als Spalte bereit, Radar ist ROADMAP Phase 8

*Was fehlt / was stattdessen möglich ist:* Wird nicht gebaut. STATTDESSEN: der Radar liest oeffentlichevergabe.de (OCDS) und TED, bewertet deterministisch ohne LLM (RAD-05) mit lesbarer Begründung, zeigt die Fristen mit Countdown — und ein Mensch reicht ein.

### klein

#### 26 Berichte — Export nach CSV und PDF (REP-07)

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* keine Berichtsseite und kein Exportdienst; das einzige PDF ist /portal/[mandant]/angebote/[id]/pdf

#### 11 CRM — Firmen

**Stand:** TEILWEISE · **Phase:** keine

*Beleg:* Tabelle firma existiert (2 Zeilen), aber nur als Dublettenanker: referenziert von kunde.firma_id, bautagebuch_position.lieferant_firma_id, bautagebuch_mannstunden.nachunternehmer_firma_id. Keine Route /portal/[mandant]/crm/firmen im Manifest, keine Seite

*Was fehlt / was stattdessen möglich ist:* Bewusst so: 04-SEITENKARTE.md §5.2 entscheidet, dass „Companies" (CRM-01) und „customers" (OPS-01) EINE Tabelle sind — kunde. Wer eine eigene Firmenverwaltung erwartet, findet sie unter „Kunden". Kein Defekt, aber eine Begriffsverschiebung gegenüber der Beschreibung.

---

## KI-Agenten und Automatisierung (15–19)

### tragend

#### 12 AI Sales Agent — Personalisierte Ansprache durch den Agenten (Textentwurf, Kampagne, Empfängerauswahl)

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* src/server/agent/ enthält genau eine Datei: policy.ts (286 Zeilen). Kein entwirf_text, kein Orchestrator, keine agent_aufgabe/agent_schritt-Tabelle (geprüft gegen information_schema: 0 von 25 gesuchten Agenten-/Radar-/Social-/Recruiting-Tabellen existieren)

*Was fehlt / was stattdessen möglich ist:* Werkzeuge (AGT-02), Orchestrator, Protokoll — nichts davon existiert als Code.

#### 14 CEO Assistant — Fragen aus der ECHTEN Datenbank beantworten (AGT-07)

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Keine Route /portal/[mandant]/agenten/assistent als Datei (Manifest src/server/registry/routen.generiert.ts:295, Phase 8). Kein suche_bestand, kein Abfragenkatalog, kein Chat-Endpunkt unter src/app/api (51 Routen, keine davon KI). pgvector ist in der Datenbank NICHT installiert (pg_extension: plpgsql, pgcrypto, btree_gist, pg_trgm, unaccent) — AGT-06 fehlt

*Was fehlt / was stattdessen möglich ist:* Der Agent selbst fehlt vollständig. Die Datengrundlage, die er lesen müsste, ist dagegen da und geprüft: Kennzahlen-Dienste (tests/kern/kennzahlen.test.ts), src/server/db/heute.ts, die Live-Ansicht der gerade Arbeitenden unter src/app/portal/[mandant]/zeiten/live/page.tsx (DSH-05). Die Frage „wie viele Mitarbeiter arbeiten heute" ist heute als Seite beantwortbar, nicht als Frage an einen Assistenten.

#### 21/22 KI-Agenten und Agenten-Center — Agenten-Center mit Name, Beschreibung, Status, Aufgaben, Aktivität, Protokoll, Rechten, verbundenen Werkzeugen und Freigabepflicht (AGT-01)

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Manifest src/server/registry/routen.generiert.ts:285-295 — 11 Routen /portal/[mandant]/agenten* plus :388 /portal/gruppe/agenten, alle Phase 8. Keine davon existiert als src/app/**/page.tsx (127 Seiten gebaut, keine unter agenten/). Sie rendern src/components/portal/NochNichtGebaut.tsx („Dieses Modul wird noch gebaut … entsteht in Phase 8")

*Was fehlt / was stattdessen möglich ist:* Das Zentrum, das der Mandant als Oberfläche meint, gibt es als Adresse und nicht als Seite.

#### 21/22 KI-Agenten und Agenten-Center — Werkzeuge des Agenten (AGT-02: lies_dokument, extrahiere_lv, suche_bestand, berechne_preis, pruefe_nachweise, pruefe_bilder, entwirf_text, sende_email, erstelle_vorgang)

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* src/server/agent/ enthält nur policy.ts. Kein Werkzeugregister, keine Zod-Schemata, kein Enum agent_werkzeug_name in der Datenbank. Entworfen sind sie in docs/architecture/06-AGENTEN-FREIGABEN.md §5.4 und im PR-Plan docs/architecture/08-PR-PLAN.md:707

*Was fehlt / was stattdessen möglich ist:* Neun Werkzeuge geplant, null gebaut.

#### 21/22 KI-Agenten und Agenten-Center — Protokoll je Schritt mit Werkzeug, Eingabe, Ausgabe, Modell, Token, Kosten, Dauer (AGT-04) und Monatsbudget mit hartem Stopp (AGT-05)

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Tabellen agent_aufgabe, agent_schritt, agent_budget, wissens_chunk existieren nicht (information_schema-Abfrage). Vorbereitet ist nur die Beweisschicht: audit_log.akteur_typ kennt die Werte mensch · agent · system und audit_log.agent_id ist vorhanden (ohne Fremdschlüssel, das Ziel gibt es nicht)

*Was fehlt / was stattdessen möglich ist:* Ohne Schrittprotokoll gibt es keine Kostengrenze, keine Wiederholbarkeit und keine Prüfspur eines Agentenlaufs.

#### 21/22 KI-Agenten und Agenten-Center — Ist irgendwo ein Modell angebunden — genügt ein Schlüssel?

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Nein, und ein Schlüssel genügt NICHT. package.json dependencies: drizzle-orm, next, postgres, react, react-dom, server-only, zod — kein openai, kein KI-SDK. Volltextsuche nach „openai" über src/: null Treffer. src/server/env.ts validiert genau drei Variablen (NODE_ENV, DATABASE_URL, SUPABASE_REGION mit Regex /^eu-/) — kein OPENAI_API_KEY, kein OPENAI_DATA_RESIDENCY. Kein Verzeichnis src/server/integrations oder /integrationen. Keine Typen LlmPort, EmbeddingPort, VisionPort, kein modell_register als Tabelle oder Code

*Was fehlt / was stattdessen möglich ist:* Die STELLE ist entworfen, aber nicht gebaut: docs/architecture/07-INTEGRATIONEN.md:1114-1128 (§8) benennt die Zugangsdaten (OPENAI_API_KEY, OPENAI_BASE_URL als EU-Endpunkt, OPENAI_PROJECT_ID, OPENAI_ORG_ID, OPENAI_DATA_RESIDENCY=eu), die Bedingung „der Adapter geht nicht live, solange OPENAI_DATA_RESIDENCY nicht eu ist", den Nachweis von EU-Verarbeitung und Zero-Retention JE MODELL im modell_register, Zeitgrenze 60 s und einen Versuch. Der AV-Vertrag steht in der Verarbeiterliste (:1984) auf „offen". Um einen Schlüssel zu benutzen, müssten heute erst entstehen: die Port-Schnittstelle, der Adapter unter dem einen erlaubten Ausgang, das Modellregister, das Schrittprotokoll und die Budgetreservierung. Offene Frage dazu: O-121 (docs/DECISIONS.md:3022) — was gilt, wenn für eine Fähigkeit kein Modell mit EU-Verarbeitung und Zero-Retention angeboten wird.

#### 12 AI Sales Agent — Menschliche Freigabe vor jedem Versand (Invariante 7)

**Stand:** TEILWEISE · **Phase:** 8 (APR-01…APR-08)

*Beleg:* src/server/agent/policy.ts:147 gate() — fail-closed (keine Richtlinie = keine Erlaubnis), Hash-Bindung der Nutzlast an die Freigabe, Codesperren für angebot_senden, nachtrag_einreichen, behinderung_senden. Drei echte Aufrufer: src/server/services/bau/behinderung.ts:481, src/server/services/bau/nachtrag.ts:427, src/server/services/lead/bestaetigung.ts:98. DB: agent_richtlinie mit CHECK agent_richtlinie_kein_auto_angebot; freigabe mit CHECK freigabe_genehmigt_hat_menschen; freigabe_snapshot als unveränderliche Hash-Kette (Trigger gegen UPDATE/DELETE/TRUNCATE). 18 Fälle in tests/kern/gate.test.ts, 10 in tests/isolation/freigabe.test.ts

*Was fehlt / was stattdessen möglich ist:* Das Tor prüft Freigaben, aber NICHTS im Repository erzeugt oder genehmigt eine — ausdrücklich festgehalten in docs/DECISIONS.md:3773 (D-250): „Kein Modul dieses Repositoriums erzeugt Freigaben." Die einzige freigabe-Zeile der Datenbank kommt aus src/server/db/seed/bau.ts:680. Der Freigabe-Posteingang (/portal/[mandant]/freigaben, 8 Routen, Manifest Zeilen 296-303) ist Phase 8. Praktisch heißt das: ein Mensch kann heute im laufenden Betrieb keine Freigabe erteilen; die beiden Versandwege verlangen eine Freigabe-Kennung, die nur der Seed liefert.

#### 21/22 KI-Agenten und Agenten-Center — Freigabe-Posteingang: eine Liste, Diff-Prüfung, Quellenangabe je Feld, Stapelfreigabe, Einspruchsfenster, Rückgängig, unveränderlicher Schnappschuss (APR-01…APR-08)

**Stand:** TEILWEISE · **Phase:** 8

*Beleg:* Unterbau gebaut und geprüft: Tabellen freigabe, freigabe_snapshot (nutzlast + nutzlast_hash + vorheriger_hash + hash, Algorithmus sha256-jcs-v1, Trigger trg_freigabe_snapshot_eingefroren gegen UPDATE und trg_freigabe_snapshot_kein_hard_delete gegen DELETE/TRUNCATE) und freigabe_kette als Zähler je Mandant; tests/isolation/freigabe.test.ts mit 10 Fällen, darunter „200 gleichzeitige Zuege ergeben 200 Nummern, lueckenlos" und „eine Richtlinie mit auto_erlaubt fuer Angebote ist auf DATENBANKEBENE unmoeglich". Die 8 Oberflächen-Routen (Manifest :296-303) sind ungebaut

*Was fehlt / was stattdessen möglich ist:* Der Schnappschuss (APR-07) trägt, die Prüfoberfläche (APR-01…APR-06, APR-08) fehlt ganz. Damit fehlt genau der Teil, an dem sich entscheidet, ob die Freigabe eine echte Prüfung oder ein Klick ist.

#### 21/22 KI-Agenten und Agenten-Center — Erzwingt das Gate Invariante 7 heute wirklich — und für welche Aktionen?

**Stand:** TEILWEISE · **Phase:** laufend, Vollbild in 8

*Beleg:* Ja, für die Wege, die es gibt, und diese Wege sind vollständig eingefasst: die Merge-Wache „ein-ausgang" in scripts/guards/run-all.ts:428-437 bricht den Build bei natives fetch oder einem Mailtransport-Import außerhalb von src/server/versand/. src/server/versand/ enthält heute genau eine Datei: dwd.ts (lesend, nicht verbunden). Gedeckt sind drei Aufrufer: Behinderungsanzeige (behinderung.ts:481, Kanäle e_mail und portal werden als nicht verbunden abgewiesen), Nachtragseinreichung (nachtrag.ts:427) und Eingangsbestätigung (bestaetigung.ts:98). Angebot, Nachtrag und Behinderung sind zusätzlich im Code gesperrt, unabhängig von jeder Richtlinie

*Was fehlt / was stattdessen möglich ist:* Die Reichweite ist klein: rechnung_senden, mahnung_senden, social_veroeffentlichen und bewerbung_antworten stehen im Typ AKTIONEN (policy.ts:43), haben aber keinen einzigen Aufrufer — die dazugehörigen Module gibt es nicht. Das Tor ist scharf, es steht nur vor drei Türen statt vor acht. Historischer Befund im Code selbst dokumentiert: der Zweig für nachtrag_einreichen FEHLTE, unter auto_erlaubt=true wäre ein Nachtrag über vierzigtausend Euro ohne Menschen hinausgegangen (Kommentar in policy.ts vor dem nachtrag_einreichen-Zweig); zugleich fehlte die Aktion im Register AKTIONEN und war damit von der erschöpfenden Prüfung ausgenommen.

#### 12 AI Sales Agent — Kaltakquise: gescrapte Firmenkontakte anschreiben

**Stand:** WIDERSPRUCH · **Phase:** keine

*Beleg:* docs/DECISIONS.md:12 (D-01), CLAUDE.md „Out of scope", SPEC §23. Gegenmaßnahme im Code: drizzle/0020_crm_identitaet.sql:166 — kunde.rechtsgrundlage NOT NULL DEFAULT 'keine' plus CHECK (Zeile 187), und src/server/agent/policy.ts:147 gate() weist rechtsgrundlage='keine' VOR jeder Freigabe ab (RechtsgrundlageFehlt), getestet in tests/kern/gate.test.ts

*Was fehlt / was stattdessen möglich ist:* § 7 UWG verbietet unaufgeforderte elektronische Werbung ohne vorherige ausdrückliche Einwilligung, auch B2B; Listenaufbau durch Scraping kommt als DSGVO-Problem dazu. STATTDESSEN möglich und teils gebaut: (a) Einwilligung erfassen — rechtsgrundlage 'einwilligung' mit Quelle, Datum und Belegdokument (Spalten rechtsgrundlage_quelle/_erfasst_am/_beleg_dokument_id sind da); (b) Bestandskunden nach § 7 Abs. 3 UWG für eigene ähnliche Leistungen, mit Widerspruchshinweis — die Routen /werbewiderspruch und /werbewiderspruch/[token] stehen im Manifest (Phase 4), gebaut sind sie nicht; (c) eingehende Anfragen — gebaut, /angebot/[bereich] → lead; (d) Vergabeportale als Akquisekanal (offene Daten, keine Werbung) — Phase 8; (e) öffentliche Register (Handelsregister, Unternehmensregister) dürfen als Datenquelle für Stammdaten dienen, sie erzeugen aber KEINE Rechtsgrundlage für Werbung — der Eintrag im Register ist keine Einwilligung.

#### 13 AI Recruiting Agent (Indeed, StepStone) — Automatisches Auslesen von Indeed / StepStone

**Stand:** WIDERSPRUCH · **Phase:** keine

*Beleg:* docs/DECISIONS.md:31 (D-02), CLAUDE.md „Out of scope", SPEC §16 Kopfzeile und §23

*Was fehlt / was stattdessen möglich ist:* AGB-Verstoß der Portale und DSGVO-Risiko über Bewerberdaten. STATTDESSEN möglich: (a) eingehende Bewerbungen über eine eigene Karriereseite und ein überwachtes Postfach (REC-03) — im Manifest als /karriere, /karriere/[stelle]/bewerbung, /karriere/initiativbewerbung (Zeilen 25-29), Phase 9, nicht gebaut; (b) VERÖFFENTLICHEN auf einem Jobboard über dessen echte API mit echten Zugangsdaten (REC-09) — das ist erlaubt, das Auslesen nicht; (c) Lebenslauf-Parsing und ein Ranking mit sichtbaren Kriterien auf den eigenen Bewerbungen (REC-04/REC-05), wobei die Entscheidung beim Menschen bleibt (REC-08, Art. 22 DSGVO); (d) Bedarf aus unbesetzten Schichten ableiten (REC-01) — die Datengrundlage dafür steht bereits (einsatz, einsatz_zuordnung, posten, posten_unterbesetzung)

### wichtig

#### 12 AI Sales Agent — Lead-Bewertung (Score) mit nachvollziehbarer Begründung

**Stand:** TEILWEISE · **Phase:** 8 (RAD-05/CRM-02), heute in keiner Phase angefangen

*Beleg:* Spalten lead.punktzahl / punktzahl_begruendung / punktzahl_berechnet_am vorhanden und angezeigt (src/app/portal/[mandant]/crm/leads/page.tsx:149-154, Begründung als title-Attribut); aber kein Dienst unter src/server/services/lead/ berechnet sie (dort nur annahme, benachrichtigung, bestaetigung, eskalation, sla). DB-Abfrage: beide Seed-Leads tragen punktzahl 72 mit Begründung „Platzhalter: Flaeche und Frequenz bekannt, Budget unbestaetigt (O-73)"

*Was fehlt / was stattdessen möglich ist:* Die Zahl wird von Hand geseedet, nie gerechnet. Es fehlt die Bewertungsfunktion und die offene Regel dahinter (O-73: nach welchen Kriterien wird bewertet).

#### 21/22 KI-Agenten und Agenten-Center — Policy-Gate aus der Datenbank, in der Oberfläche ohne Code änderbar (AGT-03)

**Stand:** TEILWEISE · **Phase:** 8

*Beleg:* Tabelle agent_richtlinie existiert mit RLS (Lesen: versand.lesen; Schreiben: versand.freigeben, nicht in der Gruppenansicht), CHECK agent_richtlinie_kein_auto_angebot, Spalten auto_erlaubt/max_betrag_cent/ist_aktiv/begruendung. Gelesen wird sie in src/server/services/bau/nachtrag.ts:422. Geschrieben wird sie NUR von src/server/db/seed/index.ts:663 — 12 Zeilen, alle auto_erlaubt=false

*Was fehlt / was stattdessen möglich ist:* Die Richtlinie ist in der Datenbank, aber nicht in der Oberfläche: /portal/[mandant]/einstellungen/agent-richtlinien (Manifest Zeile 358) und /portal/[mandant]/agenten/richtlinien (:291-292) sind Phase 8 und ungebaut. Nur 3 der 8 Aktionen haben überhaupt eine Zeile (email_senden, mahnung_senden, social_veroeffentlichen) — die übrigen sind damit fail-closed, was richtig ist, aber niemand kann das heute ändern.

#### 21/22 KI-Agenten und Agenten-Center — Wachhund-Jobs ohne KI (SPEC §14: acht Wächter)

**Stand:** TEILWEISE · **Phase:** 8/9 für die übrigen; der Kettenlauf gehört zu 6 und ist gebaut, aber unaufgerufen

*Beleg:* Registriert sind drei: src/server/jobs/einsaetzeGenerieren.ts:27, konflikteErkennen.ts:47, lead-sla.ts:20. Das Register selbst (src/server/jobs/registry.ts) erzwingt Mandantenbezug, 5-Feld-Cron in UTC und eine endliche Zahl Versuche

*Was fehlt / was stattdessen möglich ist:* Fünf der acht Wächter fehlen: Ausschreibungsfrist < 5 Tage, Schicht beendet ohne Zeiteintrag, morgen unbesetzte Schicht, Rechnung > 14 Tage überfällig, Nachtrag nach 14 Tagen nicht eingereicht. Besonders auffällig: der nächtliche Prüflauf der Rechnungs-Hashkette (FIN-06, SPEC §14 „Invoice hash chain broken → nightly") existiert als getesteter Dienst src/server/services/finanz/kettenlauf.ts, wird aber von genau einem Aufrufer benutzt — tests/isolation/rechnung-kette.test.ts:23. Kein registriere(), keine Cron-Route. Der Wächter läuft nur im Test.

#### 21/22 KI-Agenten und Agenten-Center — Acht Agenten, wie der Mandant sie benennt

**Stand:** WIDERSPRUCH · **Phase:** 8

*Beleg:* docs/DECISIONS.md:38 (D-03): auf vier zusammengelegt — CEO Assistant, Acquisition, Back-office, Finance; Operations, Analytics, Social und Support waren dieselbe Maschinerie unter anderem Namen. SPEC §17 und §23 führen die Zusammenlegung als bewusste Streichung

*Was fehlt / was stattdessen möglich ist:* Kein Rechts-, sondern ein Zuschnittswiderspruch: Der Mandant bekommt die Funktionen, aber nicht die acht Kacheln. Das gehört ihm gesagt, bevor er das Agenten-Center aufmacht und vier statt acht Einträge sieht. STATTDESSEN: agent-Zeilen sind als Daten geplant (docs/architecture/02-datenmodell/06-RADAR-KI-INHALT.md:1445), acht benannte Profile über vier Maschinen wären ohne Codeänderung möglich — das ist aber heute nicht entschieden.

#### Out of scope, ausdrücklich mitgeprüft — Automatische Einreichung auf Vergabeplattformen

**Stand:** WIDERSPRUCH · **Phase:** keine

*Beleg:* docs/DECISIONS.md:69 (D-07), CLAUDE.md, SPEC §23. Im Manifest spiegelt sich das: /portal/[mandant]/radar/[id]/mappe/einreichung (Zeile 281) ist die Mappe zur Übergabe, kein Einreichungsendpunkt

*Was fehlt / was stattdessen möglich ist:* Deutsche Vergabeplattformen bieten keine Einreichungs-API; Konten hängen an natürlichen Personen, teils mit elektronischer Signatur. STATTDESSEN: der Agent stellt die Vergabemappe vollständig zusammen, benennt fehlende Unterlagen und prüft die Plattformregistrierung im Voraus (RAD-09) — ein Mensch lädt hoch. Der Wert liegt in der garantierten Vollständigkeit vor dem Absenden, nicht im Absenden.

#### Out of scope, ausdrücklich mitgeprüft — Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklärung

**Stand:** WIDERSPRUCH · **Phase:** 7 für die Vorbereitung; die Abrechnung selbst nie

*Beleg:* docs/DECISIONS.md:63 (D-06), CLAUDE.md, SPEC §12 („Not in scope") und §23. Im Code konsequent: es gibt stundenkonto, stundenkonto_bewegung, zeitnachweis und den Monatsabschluss (src/app/portal/[mandant]/personal/stundenkonten/abschluss/page.tsx), aber keine Lohnart, keinen Beitragssatz, keine SOKA-Bau-Berechnung

*Was fehlt / was stattdessen möglich ist:* Drei Branchentarife plus SOKA-Bau machen die Lohnabrechnung zu einem Fachsystem; Jahresabschluss und E-Bilanz gehören dem Steuerberater. STATTDESSEN: die Plattform BEREITET VOR und EXPORTIERT — Zeitdaten an ein Lohnsystem (ACC-12), DATEV-EXTF mit Belegverknüpfung (ACC-02/ACC-03), Z3-Export für die Prüfung (ACC-09), Jahrespaket (ACC-11). Alles davon ist Phase 7 und heute ungebaut: weder datev_export noch konto_mapping noch eingangsrechnung existieren als Tabelle.

---

## Betrieb: Objekte, Planung, Zeit (20–24)

### tragend

#### 15 Betrieb — Standort/Objekt anlegen

**Stand:** fehlt_ganz · **Phase:** 4

*Beleg:* kein `insert into objekt` in src/ ausserhalb src/server/db/seed; Route /portal/[mandant]/objekte/neu steht im Manifest (routen.generiert.ts, Phase 4) ohne page.tsx und faellt auf src/components/portal/NochNichtGebaut.tsx

*Was fehlt / was stattdessen möglich ist:* Objektliste, Objektblatt, Raumbuch und Raumbuch-Import sind gebaut — nur entstehen kann ein Objekt nicht. Die Kette beginnt damit bei einem Glied, das nur der Seed legt.

#### 15 Betrieb — Turnus mit RRULE (RFC 5545) und Berliner Feiertagsregel (CLN-02, CLN-03)

**Stand:** fehlt_ganz · **Phase:** 5

*Beleg:* Tabelle turnus mit rrule, dtstart_lokal, dauer_minuten, feiertagsregel und CHECK turnus_rrule_ohne_anker existiert (drizzle/0029); Routen /reinigung/turnus, /turnus/neu, /turnus/[id] (Manifest Z. 121-123, Phase 5) haben KEIN page.tsx; kein `insert into turnus` in src/

*Was fehlt / was stattdessen möglich ist:* Das ist das fehlende Glied im Beispiel des Mandanten. Objekt, Revier und Auftrag koennte man sich noch beschaffen — ohne Turnus entsteht aus einem Reinigungsvertrag nie ein wiederkehrender Termin. Die Tabelle ist da, die Rechenlogik in services/dienstplan/vorkommnisse.ts ist da; der Weg des Menschen dorthin fehlt vollstaendig.

#### 15 Betrieb — Planungsserie — der Traeger, aus dem der Generator Einsaetze materialisiert

**Stand:** fehlt_ganz · **Phase:** 5

*Beleg:* Tabelle planungsserie mit horizont_tage=56, generiert_bis, ps_carrier_uk; kein `insert into planungsserie` irgendwo in src/; Routen dienstplan/serien/neu und serien/[id] (Manifest Z. 174-175, Phase 5) ungebaut — nur die Liste dienstplan/serien/page.tsx steht

*Was fehlt / was stattdessen möglich ist:* Auch der gebaute Weg security/posten/neu hilft nicht: src/server/services/security/posten.ts:305 legt NUR posten an, keine Serie. Ein im Produkt angelegter Wachposten erzeugt deshalb null Schichten. 7 Serien stehen im Seed, keine kann hinzukommen.

#### 15 Betrieb — Aufgaben und Fristen an Auftrag und Projekt (OPS-11)

**Stand:** fehlt_ganz · **Phase:** 4

*Beleg:* keine Tabelle aufgabe/frist/termin unter den 137 Tabellen in cse_p5; Rechte aufgabe.lesen/schreiben/zuweisen stehen im Katalog (src/server/auth/katalog.generiert.ts:28-30); Routen /portal/[mandant]/aufgaben und /aufgaben/[id] (Manifest Z. 108-109, Phase 4) ungebaut

*Was fehlt / was stattdessen möglich ist:* Nichts davon existiert ausser den Rechten. Die Rechte laufen ins Leere — es gibt kein Objekt, auf das sie sich beziehen. Auch der ROADMAP-Abschnitt Phase 4 zaehlt OPS-11 nicht unter seinen Punkten auf.

#### 16 Personal — Personal anlegen, aendern, Vertrag, Entgelt, Beschaeftigung beenden, Zugang, Zusammenfuehren

**Stand:** fehlt_ganz · **Phase:** 3

*Beleg:* kein `insert into person` und kein `insert into anstellung` in src/ ausserhalb des Seeds; ungebaut sind personal/anstellungen/neu, /[id], /[id]/vertrag, /[id]/entgelt, /[id]/beenden, personen/[id]/stammdaten, personen/[id]/zugang, personal/zusammenfuehren — alle im Manifest (Z. 193-212) als Phase 3 bzw. 5 gefuehrt

*Was fehlt / was stattdessen möglich ist:* Die Personalstelle kann Personal LESEN und nicht pflegen. Die Rechte dafuer stehen vollstaendig im Katalog (personal.erstellen, .aendern, .entgelt_schreiben, .anstellung_beenden, .zugang_verwalten, .zusammenfuehren, katalog.generiert.ts:165-178) und haben keinen Weg, auf dem jemand sie ausuebt. Das ist die groesste Einzelluecke in Abschnitt 16.

#### 16 Personal — Teams

**Stand:** fehlt_ganz · **Phase:** keine

*Beleg:* keine Tabelle mit "team" im Namen unter den 137 Tabellen; kein Recht mit Modul team im Katalog; keine der 432 Routen heisst so. Der einzige Treffer im ganzen Manifest ist der Beschreibungstext von /portal/gruppe/kalender: "filter by area, team, person" (routen.generiert.ts Z. 386)

*Was fehlt / was stattdessen möglich ist:* Teams sind weder gebaut noch geplant noch als offene Frage notiert. Der Mandant nennt sie ausdruecklich; im Repository existiert das Wort nur als Filterversprechen einer Seite, die es auch nicht gibt. Gruppierung von Menschen geschieht heute allein ueber anstellung.mandant_id und einsatz_zuordnung.

#### 25 Benachrichtigungen — Zustellung — dass eine Benachrichtigung einen Menschen erreicht

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* `insert into benachrichtigung` kommt im ganzen Repository nur in tests/isolation/benachrichtigung.test.ts:36 und :121 vor, in src/ nirgends. erzeuge() (registry.ts:104) gibt ein Objekt zurueck; der einzige Produktivaufrufer, src/server/services/nachweis/ablauf.ts:138, legt es in einen Bericht und laesst es dort liegen. Tabellen benachrichtigung und benachrichtigung_praeferenz: 0 Zeilen nach Seed

*Was fehlt / was stattdessen möglich ist:* Kein Posteingang: /portal/[mandant]/benachrichtigungen steht im Manifest (Z. 276) als Phase 2 — der fruehesten Phase von allem Ungebauten — und hat kein page.tsx. Keine Glocke in src/components/portal/PortalRahmen.tsx. Keine Einstellungsseite (/portal/konto/benachrichtigungen, Phase 9). Kein E-Mail-Versand: Tabelle versand hat 0 Zeilen, es gibt keinen Absender. Das Modul ist vollstaendig gedacht und an keiner Stelle angeschlossen.

#### 15 Betrieb — Angebot -> Auftrag in einer Handlung (OPS-09) traegt die Positionen mit

**Stand:** TEILWEISE · **Phase:** 4

*Beleg:* src/server/services/angebot/index.ts:384 legt den Auftrag an und setzt das Angebot auf angenommen (Z. 411) — es gibt in der ganzen Datei kein auftrag_leistung; `grep -rn "insert into auftrag_leistung" src/` ausserhalb des Seeds: null Treffer

*Was fehlt / was stattdessen möglich ist:* Ein gewandelter Auftrag hat KEINE Leistungspositionen. einsatz.auftrag_leistung_id ist der einzige Weg vom Dienstplan zum Auftrag (FK einsatz_leistung_fk) und zur Abrechnung (TIM-12). Ein heute im Produkt entstandener Auftrag ist deshalb weder planbar noch abrechenbar. Im Seed traegt er sie (63 von 82 Einsaetzen), im Betrieb nie.

#### 15 Betrieb — Revier (CLN-01) anlegen und mit Raeumen belegen

**Stand:** TEILWEISE · **Phase:** 5

*Beleg:* Tabellen revier, revier_raum (drizzle/0029_revier_turnus.sql, 0065_revier_raum.sql); Seiten reinigung/reviere und reviere/[id]/raeume gebaut; src/server/services/reinigung/revier.ts:249 insert into revier_raum

*Was fehlt / was stattdessen möglich ist:* `insert into revier` gibt es in src/ nicht. Route /portal/[mandant]/reinigung/reviere/neu (Manifest Z. 118, Phase 5) ohne page.tsx. Ein Revier laesst sich fuellen, aber nicht anlegen.

#### 15 Betrieb — Generatorlauf fuellt acht Wochen voraus, naechtlich erneuert (TIM-03)

**Stand:** TEILWEISE · **Phase:** 5

*Beleg:* src/server/jobs/einsaetzeGenerieren.ts (zeitplan '15 2 * * *'), src/server/services/dienstplan/generator.ts mit Upsert auf einsatz_quelle_uk, Stornierung verwaister Schichten, Schutz gebuchter Zeiten

*Was fehlt / was stattdessen möglich ist:* Nichts fuehrt den Job aus. Kein pg_cron in drizzle/, kein Eintrag in supabase/config.toml, keine /api-Route, kein package.json-Skript; registriereEinsatzGenerator wird ausser in tests/ nirgends aufgerufen. Tabelle job_lauf: 0 Zeilen nach Migration+Seed. Dasselbe gilt fuer konflikte_erkennen und lead_sla_eskalation. Der Befund aus Commit 0189f91 ("der Nachtlauf durfte Befunde JEDER Gesellschaft ueberholen") ist behoben an einem Lauf, den niemand ausloest.

#### 15 Betrieb — Zeiterfassung ueber Einmal-Link ohne App und ohne Login (TIM-07)

**Stand:** TEILWEISE · **Phase:** 5

*Beleg:* Einloesung gebaut: src/app/api/check-in/[token]/route.ts, /medien, /offline; Tabelle checkin_token; Serverzeit massgeblich und zeitabweichung_sek getrennt (drizzle/0035_checkin_token.sql)

*Was fehlt / was stattdessen möglich ist:* Die Ausgabe fehlt: gibCheckinAus in src/server/services/zeit/checkin.ts:223 hat als einzige Aufrufer src/server/db/seed/zeit.ts:36 und tests/. Kein `insert into checkin_token` in src/ ausserhalb des Dienstes, keine API, und /portal/[mandant]/zeiten/checkin-links (Manifest Phase 5) ist nicht gebaut. Ein Planer kann heute keinen Link ausgeben — das letzte Glied der Kette haengt am Seed.

#### 15 Betrieb — Dokumentenablage mit Kategorien, Suche, Filter, Versionen, Zugriffsschutz (DOC-01..DOC-08)

**Stand:** TEILWEISE · **Phase:** 4

*Beleg:* Tabellen dokument, dokument_version, dokument_aufbewahrung (drizzle/0009_dokument.sql); src/server/services/dokument/upload.ts mit MIME-Pruefung; src/server/storage/signatur.ts:70

*Was fehlt / was stattdessen möglich ist:* Der Dienst wird nur von src/app/api/anfrage/route.ts und services/bau/behinderung.ts benutzt. ALLE sechs Routen /portal/[mandant]/dokumente* (Manifest Z. 266-271, Phase 4/7) sind ungebaut, ebenso /portal/mein/dokumente und /portal/kunde/dokumente. Tabelle dokument: 0 Zeilen im Seed. Es gibt keine Dokumentenablage, nur einen Uploadpfad fuer zwei Formulare.

#### 15 Betrieb — Projekte (Bau) mit Vertragsgrundlage, Leitung, Terminen, LV, Aufmass, Bautagebuch, Nachtraegen

**Stand:** TEILWEISE · **Phase:** 5

*Beleg:* Tabelle projekt (drizzle/0082 u.a.); Seiten bau/projekte, .../[id]/lv, /aufmass, /bautagebuch, /nachtraege, /behinderungen; Dienste services/bau/*.ts

*Was fehlt / was stattdessen möglich ist:* Kein /bau/projekte/neu im Manifest und kein `insert into projekt` in src/ — ein Projekt entsteht nur ueber den Seed (1 Zeile). Der gesamte Bauzweig haengt an einem Projekt, das niemand anlegen kann.

#### 25 Benachrichtigungen — Waechter-Jobs (SPEC §14 nennt acht)

**Stand:** TEILWEISE · **Phase:** 5

*Beleg:* drei registriert: einsaetze_generieren ('15 2 * * *'), konflikte_erkennen ('45 2 * * *'), lead_sla_eskalation ('0 * * * *') in src/server/jobs/; Registry mit Pflichtangabe des Mandantenbezugs (registry.ts), Runner mit Idempotenz, Backoff und Alarm (runner.ts)

*Was fehlt / was stattdessen möglich ist:* Fuenf fehlen ganz: Schicht beendet ohne zeiteintrag, morgige Schicht unbesetzt, Rechnung ueber 14 Tage faellig, Nachtrag nach 14 Tagen nicht eingereicht, Hashkette gebrochen (src/server/services/finanz/kettenlauf.ts existiert, wird nirgends als Job registriert). Die Ablaufwarnung 60/30/7 hat einen fertigen Dienst (services/nachweis/ablauf.ts) und keine Registrierung. Und keiner der drei vorhandenen laeuft: kein Planer, job_lauf ist leer.

#### 16 Personal — was der Mandant nicht bekommen darf — Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklaerung

**Stand:** WIDERSPRUCH · **Phase:** 7

*Beleg:* DECISIONS.md:63 (D-06 "Not built: payroll, annual accounts, tax filing"); CLAUDE.md "Out of scope"; kein Lohncode in src/ — die Treffer sind ausschliesslich Kommentare, die die Grenze benennen (services/mitarbeiter/felder.ts:23, abwesenheit/index.ts:20, zeit/dauer.ts:194)

*Was fehlt / was stattdessen möglich ist:* BENANNT, nicht gebaut, und das ist richtig: drei Branchentarife plus SOKA-Bau machen Lohn zu einem Spezialsystem; Jahresabschluss und E-Bilanz gehoeren dem Steuerberater. MOEGLICH IST STATTDESSEN: die Plattform bereitet vor und exportiert — /portal/[mandant]/buchhaltung/lohnexport (Manifest Z. 265, Phase 7, ACC-12/TIM-13) gibt die Zeitdaten an das Lohnsystem; stundenkonto und §17-MiLoG-Nachweise (Seite zeiten/milog) sind die Grundlage. Der eigene Stundensatz steht bewusst auch dem Mitarbeiter nicht im Portal (felder.ts:21-27) — ihn dort zu zeigen verlangte, cse_app die Spalte zu oeffnen und damit K-05 zu brechen.

#### 25 Benachrichtigungen — was der Mandant nicht bekommen darf — Kaltakquise an gescrapte Kontakte

**Stand:** WIDERSPRUCH · **Phase:** 4

*Beleg:* DECISIONS.md:12 (D-01 "Removed: cold outreach to scraped contacts", §7 UWG ab Z. 17), DECISIONS.md:917 ("§ 7 UWG ist nicht etwas, das ein Mensch per Klick ausser Kraft setzt"), D-99 (Z. 1616, das UWG-Sendetor); kein Treffer fuer scrape/Kaltakquise in src/

*Was fehlt / was stattdessen möglich ist:* BENANNT. § 7 UWG verbietet unaufgeforderte elektronische Werbung ohne vorherige ausdrueckliche Einwilligung, auch B2B; Folge sind Abmahnung, Kosten, Unterlassung. Wichtig fuer diesen Abschnitt: ein Benachrichtigungssystem ist genau der Ort, an dem diese Grenze verwischt. MOEGLICH IST STATTDESSEN: kunde.rechtsgrundlage mit Quelle und Beleg-Dokument je Kontakt, kunde.werbewiderspruch_am, und die beiden oeffentlichen Widerspruchswege /werbewiderspruch/[token] und /werbewiderspruch (Manifest, Phase 4). Ausgehendes geht nur an Kontakte mit erfasster Rechtsgrundlage und passiert src/server/agent/policy.ts (Invariante 7). Offen und zu klaeren: O-34 und O-95 in DECISIONS.md.

### wichtig

#### 15 Betrieb — Auftragsblatt zeigt Status, Dokumente, verbundene Vorgaenge

**Stand:** TEILWEISE · **Phase:** 4

*Beleg:* src/app/portal/[mandant]/auftraege/[id]/page.tsx — die Abfrage (Z. 61-78) holt Kopf, Kunde, Objekt, Leitung, Termine, Personalbedarf, Wochenstunden, Wert, Angebotsnummer, Referenzfreigabe; StatusPill Z. 146

*Was fehlt / was stattdessen möglich ist:* Auf dem Blatt stehen nur Ausstattung und Beschreibung als Abschnitte. Keine Einsaetze, keine Leistungspositionen, keine Rechnungen, keine Aufgaben, keine Fristen, keine Dokumente. Ein Auftrag ist heute ein Datenblatt, kein Vorgang.

#### 16 Personal — Personenblatt: Kontakt, Qualifikationen, Status, Beschaeftigungen

**Stand:** TEILWEISE · **Phase:** 3

*Beleg:* src/app/portal/[mandant]/personal/personen/[id]/page.tsx — Telefon (Z. 92), Sprache, Nachweisregister (Z. 112), Nachweise (Z. 178), Bewacher-ID und -Status (Z. 232), Beschaeftigungen mit Arbeitszeit (Z. 148) und Status (Z. 155)

*Was fehlt / was stattdessen möglich ist:* Es fehlen vier der geforderten Angaben: Rolle, Bereich als eigene Angabe, zugeordnete Projekte/Objekte, der Dienstplan dieser Person und ihre Dokumente. person traegt ueberdies weder E-Mail noch Anschrift als Spalte — "Kontakt" ist heute genau eine Telefonnummer.

#### 16 Personal — Abwesenheiten und Antraege (EMP-10)

**Stand:** TEILWEISE · **Phase:** 5

*Beleg:* Tabellen abwesenheit, abwesenheitsart, antrag, antragsart (drizzle/0073, 0074); Listen personal/abwesenheiten und personal/antraege gebaut; Mitarbeiterwege mein/abwesenheit/neu, mein/antraege/neu mit APIs api/mein/abwesenheit, api/abwesenheiten/[id], api/antraege/[id]

*Was fehlt / was stattdessen möglich ist:* Die Entscheidungsblaetter personal/abwesenheiten/[id] und personal/antraege/[id] (Manifest Z. 206, 208, Phase 5) sind nicht gebaut. Die Liste zaehlt offene Antraege und verlinkt auf eine Seite, die NochNichtGebaut rendert.

#### 16 Personal — Interne Nachrichten und Dokumente an den Mitarbeiter (EMP-11)

**Stand:** TEILWEISE · **Phase:** 3

*Beleg:* Tabellen nachricht, nachricht_empfaenger und versand existieren, alle 0 Zeilen im Seed; Rechte nachricht.lesen/versenden im Katalog (Z. 152-153); Routen /portal/[mandant]/nachrichten, /nachrichten/[id], /portal/mein/nachrichten, /portal/mein/dokumente (Manifest, Phase 3) — keine davon gebaut

*Was fehlt / was stattdessen möglich ist:* Schema und Recht ohne Seite und ohne Dienst. Ein Mitarbeiter erreicht heute keine Nachricht und kein Dokument.

#### 16 Personal — was der Mandant nicht bekommen darf — Scraping von Indeed, StepStone und aehnlichen Boersen

**Stand:** WIDERSPRUCH · **Phase:** 9

*Beleg:* DECISIONS.md:31 (D-02 "Removed: scraping job boards"); kein Treffer fuer indeed/stepstone/scraping in src/

*Was fehlt / was stattdessen möglich ist:* BENANNT. AGB-Verstoss und DSGVO-Risiko. MOEGLICH IST STATTDESSEN: Recruiting auf eingehende Bewerbungen — /karriere, /karriere/[stelle], /karriere/[stelle]/bewerbung, /karriere/initiativbewerbung stehen im Manifest (Phase 9) mit LEG-11/LEG-12 (Loeschfristen) und /portal/[mandant]/recruiting/bedarf leitet den Bedarf aus unbesetzten Schichten ab (REC-01/TIM-05) statt aus fremden Datenbestaenden.

### klein

#### 24 Kalender — iCal-Feed je Benutzer, nur lesend (CAL-03)

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* kein Treffer fuer ical/ics/VEVENT in src/; Route /portal/konto/kalender-feed (Manifest Z. 445, Phase 9, "the tokenised read-only iCal URL: show once, rotate, revoke") ungebaut

#### 15 Betrieb — was der Mandant nicht bekommen darf — Automatische Einreichung auf Vergabeplattformen

**Stand:** WIDERSPRUCH · **Phase:** 8

*Beleg:* CLAUDE.md "Out of scope"; kein Treffer fuer vergabeplattform/evergabe/dtvp in src/ (die beiden Treffer auf "vergabe" sind "Rechtevergabe")

*Was fehlt / was stattdessen möglich ist:* BENANNT. Es gibt keine API dafuer; die Einreichung ist bewusst manuell. MOEGLICH IST STATTDESSEN: das Ausschreibungsradar bereitet vor — Fund, Frist, Unterlagen, Zustaendigkeit, und die Frist als Waechter (SPEC §14: "Tender deadline < 5 days, untouched"). Offen: O-07 in DECISIONS.md fragt, auf welchen Plattformen die Gruppe unter welcher Kennung registriert ist. Alles davon ist Phase 8 und heute nicht gebaut.

---

## Finanzen, Ausschreibungen, Nachweise (25–28)

### tragend

#### 18 Finanzen — §14-UStG-Vorabprüfung, die die Festschreibung blockiert (FIN-04)

**Stand:** fehlt_ganz · **Phase:** Phase 6, PR 47

*Beleg:* src/server/services/finanz/rechnung.ts:74 REGELWERK_VERSION = 'ustg14-nicht-gebaut'; :75-83 offenerBericht() schreibt geprueft:false, grund:'Die §14-UStG-Vorabpruefung wird mit PR 47 gebaut (FIN-04).'; :870 wird genau dieser Bericht in fin.rechnung_nummer_ziehen und in den Kettensatz gegeben. Route /finanzen/rechnungen/[id]/pruefung (Manifest Z. 223) ist nicht gebaut. docs/architecture/PHASE-5-STAND.md:223 nennt auch die Wache 'validator-nicht-uebersprungen' als auf dem anderen Zweig liegend

*Was fehlt / was stattdessen möglich ist:* Es gibt heute keine Prüfung auf die Pflichtangaben nach §14 Abs. 4 UStG. Geprüft wird nur: mindestens eine Leistungsposition (rechnung.ts:857), ein Zahlungsziel (O-66) und der Leistungszeitraum bzw. bei Abschlag/Anzahlung das vereinnahmung_geplant_am — letzteres allerdings als CHECK in der DB (rechnung_leistungszeitpunkt), nicht als lesbarer Befundbericht. Der Snapshot bezeugt ehrlich, dass nicht geprüft wurde — das ist die richtige Form der Lücke, aber es bleibt eine.

#### 18 Finanzen — Fünf Abrechnungsarten hinter einer Schnittstelle (FIN-01)

**Stand:** fehlt_ganz · **Phase:** Phase 6, PR 48 (Migration 0086_abrechnungsart liegt auf claude/phase-5-dienstplan-zeit, PHASE-5-STAND.md:179)

*Beleg:* rechnungsposition trägt die Spalten vertrag_abrechnung_id und abrechnungsart, aber die Tabelle vertrag_abrechnung existiert nicht (\dt, 137 Tabellen); kein FK darauf. rechnung.ts:130-140 benennt die fehlende Stufe ausdrücklich: '// TODO(client, O-04): Die fuenf Abrechnungsarten und ihre Parameter'. fuegePositionHinzu (rechnung.ts:217-305) setzt weder vertrag_abrechnung_id noch abrechnungsart

*Was fehlt / was stattdessen möglich ist:* Stundenlohn · Monatspauschale · Festpreislos · Einheitspreis nach Aufmaß · Einzelabruf gibt es als Begriffe im SPEC, nicht als Code. O-04 ist unbeantwortet; nach der Arbeitsregel ist das korrekt offengelassen, nicht geraten.

#### 18 Finanzen — XRechnung (UBL, EN 16931) mit Leitweg-ID, KoSIT-validiert in CI (FIN-11)

**Stand:** fehlt_ganz · **Phase:** Phase 6

*Beleg:* Vorbereitet sind nur Felder: rechnung.leitweg_id, .kaeufer_referenz, .bestellnummer_kunde, .verkaeufer_eadresse(_schema), .kaeufer_eadresse(_schema), .zahlungsmittel_code; en16931_steuerkategorie auf der Position. Kein UBL-Erzeuger: grep XRechnung in src findet nur Kommentare (rls.ts:1153, kanonisch.ts:175). Keine KoSIT-Prüfung in .github/. Routen /finanzen/rechnungen/[id]/xrechnung und /versand (Manifest Z. 228-229) nicht gebaut

*Was fehlt / was stattdessen möglich ist:* SPEC §11 sagt: ohne XRechnung kann die Gruppe öffentliche Auftraggeber (GIZ, DRV Bund, Berliner Bezirksämter) gar nicht abrechnen. Das ist heute der Fall.

#### 18 Finanzen — Eingangsrechnungen, Belege, Ausgaben (FIN-14)

**Stand:** fehlt_ganz · **Phase:** Phase 6

*Beleg:* Keine Tabelle eingangsrechnung, beleg oder ausgabe in der Datenbank (\dt, 137 Tabellen). Kein Dienst unter src/server/services/finanz/. Die Routen /finanzen/eingangsrechnungen(/neu/[id]/freigabe), /finanzen/belege(/[id]), /finanzen/ausgaben(/[id]) stehen im Manifest (routen.generiert.ts Z. 233-241) und fallen sämtlich auf die Auffangseite src/app/portal/[mandant]/[...rest]/page.tsx → NochNichtGebaut. Die Rechte eingang.lesen/schreiben/freigeben existieren bereits in berechtigung

*Was fehlt / was stattdessen möglich ist:* Der gesamte Eingangsstrom fehlt. Damit fehlt auch die Grundlage des Finanz-Agenten (Abschnitt 19): es gibt nichts, worin ein extrahierter Beleg landen könnte.

#### 18 Finanzen — Zahlungen und offene Posten

**Stand:** fehlt_ganz · **Phase:** Phase 6 (Zahlung) / Phase 7 (offene Posten, ACC-07)

*Beleg:* Keine Tabelle zahlung, offener_posten oder bankkonto (\dt). rechnung.bankkonto_id hat keinen Fremdschlüssel; rechnung.ts:799 'bankkonto: null // kommt mit PR 49'. rechnung.ts:912-919 benennt den fehlenden Schritt 6 der Festschreibung ausdrücklich: offener_posten, buchungssatz, periode und markiereQuellenAbgerechnet 'kommen mit PR 48 bis PR 50'. Routen /finanzen/zahlungen(/[id]) (Z. 242-243) und /buchhaltung/offene-posten (Z. 259) nicht gebaut

*Was fehlt / was stattdessen möglich ist:* Eine festgeschriebene Rechnung erzeugt heute keinen offenen Posten. Der Kommentar im Code sagt richtig, warum das in DIESELBE Transaktion gehört und nicht in einen Nachlauf — gebaut ist es nicht.

#### 18 Finanzen — Umsatz, Ausgaben, Gewinn je Bereich und Gruppe (FIN-17)

**Stand:** fehlt_ganz · **Phase:** Phase 6 (Bereichs- und Gruppenfinanzen) / Phase 9 (Berichte)

*Beleg:* src/server/services/bericht/kacheln.ts registriert ~12 Kacheln — grep 'Umsatz|umsatz|finanz' darin: null Treffer. Die Seiten /portal/[mandant]/finanzen (Manifest Z. 218), /portal/gruppe/finanzen (Z. 373), /portal/gruppe/rechnungen (Z. 374) und /berichte/umsatz (Z. 340) sind nicht gebaut; find src/app/portal -name page.tsx zeigt unter finanzen/ nur rechnungen/{,neu,[id]}

*Was fehlt / was stattdessen möglich ist:* Es gibt heute keine einzige Zahl zu Umsatz oder Ergebnis — weder je Gesellschaft noch in der Gruppenansicht. Die Gruppenansicht selbst ist gebaut und lesend (portal/gruppe/page.tsx), sie hat nur keinen Finanzinhalt.

#### 19 Finanz-Agent — Beleg hochladen → Lieferant, Rechnungsnummer, Datum, Netto, USt, Brutto, Kategorie, Gesellschaft extrahieren (ACC-05)

**Stand:** fehlt_ganz · **Phase:** Phase 7

*Beleg:* src/server/agent/ enthält genau EINE Datei: policy.ts (286 Z.). Kein tools/, kein orchestrator/, kein OCR, kein Modellaufruf — grep 'OCR|openai' in src findet keinen Extraktionscode. Keine Zieltabelle (kein eingangsrechnung, kein beleg). Route /finanzen/eingangsrechnungen/[id] 'extracted fields with source and confidence' (Manifest Z. 235) nicht gebaut

*Was fehlt / was stattdessen möglich ist:* Der Agent existiert in keiner Form. ROADMAP.md ordnet ihn Phase 7 zu ('Incoming-invoice OCR → extraction → proposal → approval').

#### 20 DATEV — EXTF-Export, Kontenrahmen SKR03/04, Buchungssätze, Belegverknüpfung, CAMT.053, Monatszahlen, Z3, Verfahrensdokumentation, Jahrespaket, Lohnexport (ACC-01…ACC-12)

**Stand:** fehlt_ganz · **Phase:** Phase 7

*Beleg:* Keine Tabelle konto, buchungssatz, periode, datev_export oder bankauszug (\dt). Kein Dienst src/server/services/buchhaltung/. Die 18 Routen unter /portal/[mandant]/buchhaltung/** (routen.generiert.ts Z. 248-265) fallen sämtlich auf die Auffangseite; find src/app/portal zeigt kein Verzeichnis buchhaltung. Die Rechte buchhaltung.* und buchhaltung_konfiguration.* existieren bereits in berechtigung (10 Schlüssel)

*Was fehlt / was stattdessen möglich ist:* Abschnitt 20 steht heute zu null Prozent im Code.

#### 23 Dokumentenzentrale — Suche, Filter, Tags (DOC-02)

**Stand:** fehlt_ganz · **Phase:** Phase 4 (Grundseiten) / Phase 7 (Bündel)

*Beleg:* Die Indizes sind da — dokument_titel_idx (gin, titel gin_trgm_ops), dokument_tags_idx (gin, tags), dokument_liste_idx, dokument_kunde_idx, dokument_objekt_idx — aber kein Dienst liest sie: src/server/services/dokument/ enthält nur kategorie.ts, pdf.ts, upload.ts. Keine Seite /portal/[mandant]/dokumente (Manifest Z. 266), keine /portal/gruppe/dokumente (Z. 385), keine /portal/mein/dokumente (Z. 417), keine /portal/kunde/dokumente (Z. 436) — alle vier fallen auf die Auffangseite

*Was fehlt / was stattdessen möglich ist:* Die Dokumentenzentrale hat null Seiten. Die Tabelle ist ein Ablageort für zwei Systemwege, kein Modul.

#### 18 Finanzen — O-134 (Rechnungsnummern-Maske) ist offen — Folge für heute

**Stand:** TEILWEISE · **Phase:** Antwort des Mandanten, nicht Code — dann Phase 6

*Beleg:* docs/DECISIONS.md:2806 („no invoice may be finalised anywhere until this is answered"); src/server/db/seed/index.ts:598-616 legt je Rechtseinheit den Kreis ausgangsrechnung mit ist_platzhalter=true an; DB bestätigt: select … from nummernkreis → alle drei ausgangsrechnung-Kreise ist_platzhalter=t, angebot/auftrag/leistungsnachweis/wachbuch=f; nummernkreis.ts:207 wirft NummernkreisFehler('platzhalter'); Warnhinweis vor dem Formular in finanzen/rechnungen/neu/page.tsx:88-100

*Was fehlt / was stattdessen möglich ist:* Eine Rechnung kann heute ENTSTEHEN (Entwurf, Positionen, Steueraufschlüsselung, Summen), aber in keiner der drei Gesellschaften FESTGESCHRIEBEN werden — der Platzhalterkreis vergibt keine Nummer. Das ist gewollt und geprüft (tests/isolation/rechnung.test.ts:661, nummernkreis.test.ts:106), aber es heisst: bis der Mandant die Maske und die Rücksetzung bestätigt, geht kein Beleg hinaus. Der Seed enthält folgerichtig 0 Zeilen in rechnung und 0 in rechnung_hash. Zusätzlich blockieren O-01 (Operations hat keinen Rechnungskreis) und O-66 (kein Zahlungsziel-Standard gesät).

#### 18 Finanzen — Nächtlicher Kettenprüflauf (FIN-06, SPEC §14 Wachdienst)

**Stand:** TEILWEISE · **Phase:** Phase 6

*Beleg:* Der Dienst existiert und ist geprüft: src/server/services/finanz/kettenlauf.ts. Aber er ist NICHT als Job registriert — grep 'registriere(' findet nur src/server/jobs/einsaetzeGenerieren.ts:26, konflikteErkennen.ts:46, lead-sla.ts:19; src/server/jobs/ enthält keine Kettendatei, supabase/ enthält nur config.toml, keine cron-Definition

*Was fehlt / was stattdessen möglich ist:* Es gibt keinen Auslöser, der den Lauf nachts startet, und keine Seite /portal/[mandant]/finanzen/hashkette (Manifest Z. 232). Eine gebrochene Kette würde heute niemandem gemeldet. Da noch keine Rechnung festgeschrieben werden kann, ist der Schaden heute null — aber die Wache muss VOR der ersten Festschreibung hängen.

#### 18 Finanzen — Jede Rechnungszeile auf ihre Quelle zurückführbar (FIN-07)

**Stand:** TEILWEISE · **Phase:** Phase 6, PR 49

*Beleg:* Das Schema trägt die Herkunftsspalten: rechnungsposition.auftrag_leistung_id, .lv_position_id, .leistungskatalog_position_id, .erloeskonto_schluessel, mit Teilindizes rp_auftrag_leistung_idx und rp_lv_idx. Der Dienst füllt keine davon: fuegePositionHinzu (rechnung.ts:217-305) setzt nur bezeichnung, menge, einheit, preis, rabatt, netto, Steuergruppe, Kategorie — grep auf auftrag_leistung_id/lv_position_id in rechnung.ts findet null Treffer

*Was fehlt / was stattdessen möglich ist:* Eine Position entsteht heute nur von Hand; kein Weg von Zeiteintrag, Aufmaß, Leistungsnachweis oder LV-Position in die Rechnung. Die Spalten sind vorbereitet, der Weg des Menschen fehlt.

#### 18 Finanzen — Abschlags- und Schlussrechnung mit automatischem Abzug der Vorauszahlungen (FIN-08)

**Stand:** TEILWEISE · **Phase:** Phase 6, PR 48

*Beleg:* Enum rechnungsart kennt standard|abschlag|anzahlung|schluss|storno; rechnung trägt abzug_brutto_cent, zahlbetrag_cent (CHECK rechnung_zahlbetrag_stimmig) und vereinnahmung_geplant_am. Aber: Enum rechnung_beziehung_art kennt nur storno|ersetzt — keine Abschlagsverknüpfung; rechnung.ts:780 'abzuege: [] // FIN-08 kommt mit PR 48'

*Was fehlt / was stattdessen möglich ist:* Es gibt keine Verknüpfung Abschlag→Schlussrechnung und keinen Abzug. Die Festschreibung einer Schlussrechnung wird NICHT blockiert, wenn frühere Abschläge nicht abgezogen sind — das ist die teure Hälfte der Anforderung. Route /finanzen/rechnungen/[id]/abschlaege (Manifest Z. 227) nicht gebaut.

#### 18 Finanzen — §48 EStG Bauabzugsteuer, 15 % einbehalten ohne gültige Freistellungsbescheinigung AM LEISTUNGSDATUM (FIN-10)

**Stand:** TEILWEISE · **Phase:** Phase 6 (PR 51)

*Beleg:* rechnung.bauabzugsteuer_pflichtig, .bauabzugsteuer_satz_bp, .bauabzugsteuer_grundlage_cent, .einbehalt_bauabzugsteuer_cent, .freistellungsbescheinigung_id und die generierte Spalte ueberweisungsbetrag_cent = zahlbetrag_cent − einbehalt_bauabzugsteuer_cent; kanonisch.ts:496-502 hat die Nutzlastform der Bescheinigung

*Was fehlt / was stattdessen möglich ist:* Die Tabelle freistellungsbescheinigung EXISTIERT NICHT (\dt); rechnung.freistellungsbescheinigung_id hat keinen Fremdschlüssel und zeigt ins Leere. rechnung.ts:795 schreibt 'freistellungsbescheinigung: null' fest in die kanonische Nutzlast, mit Kommentar 'PR 51 loest die Bescheinigung auf'. Es gibt also keine Gültigkeitsprüfung zum Leistungsdatum — genau den Punkt, den die Anforderung betont. Route /finanzen/eingangsrechnungen/[id]/steuer (Manifest Z. 236) nicht gebaut.

#### 19 Finanz-Agent — Prüfung und menschliche Freigabe vor jeder Wirkung (Invariante 6 und 7)

**Stand:** TEILWEISE · **Phase:** Phase 7 (Finanz-Agent) / Phase 8 (Agenten allgemein)

*Beleg:* Das Gerüst steht: src/server/agent/policy.ts (Aktionen, Rechtsgrundlage nach §7 UWG, nutzlastHash, gate(), FreigabeErforderlich, RechtsgrundlageFehlt); Tabellen freigabe, freigabe_kette, freigabe_snapshot, agent_richtlinie; Seed setzt jede Zeile in agent_richtlinie auf auto_erlaubt=false (src/server/db/seed/index.ts:659-668, 'Fail-closed'); rechnung und rechnung_beziehung tragen erstellt_von_art mit akteur_art='agent' und CHECK rechnung_akteur_stimmig, ein Agent ist also im Beleg unterscheidbar

*Was fehlt / was stattdessen möglich ist:* Es gibt keine Freigabe-Oberfläche und keinen Vorschlag, der darin landen könnte: keine Seite unter /portal/[mandant]/freigaben, kein Aufrufer von gate() ausserhalb der Tests. Invariante 6 (der Agent rechnet kein Geld) ist heute trivial erfüllt, weil es den Agenten nicht gibt — nicht, weil eine Grenze gezogen wurde.

#### 20 DATEV — Kann die Architektur eine echte DATEV-Schnittstelle später aufnehmen — und was fehlt dafür heute?

**Stand:** TEILWEISE · **Phase:** Phase 7

*Beleg:* Tragfähig vorbereitet ist: Geld als bigint-Cent (geld.ts) statt Gleitkomma — eine Komma-Dezimaltrennung in Windows-1252 ist daraus verlustfrei erzeugbar; die USt je steuersatz_gruppe mit Historie (0087_steuersatz_historie.sql) und en16931_steuerkategorie je Position — der Steuerschlüssel hängt sich daran; rechnungsposition.erloeskonto_schluessel als vorgesehener Haken für das Erlöskonto; leistungskatalog_position.kostenart und .steuer_kennzeichen; der unveränderliche Beleg mit kanonischem Snapshot und Hash (rechnung_snapshot, rechnung_hash) — ein Export kann aus dem Snapshot erzeugt werden statt aus lebenden Stammdaten (rls.ts:1153 begründet genau das); dokument + dokument_version als Träger der Belegverknüpfung; nummernkreis als Zeile statt Code

*Was fehlt / was stattdessen möglich ist:* Für einen echten Export fehlen heute: (1) die Antwort des Mandanten auf O-05 — Beraternummer und Mandantennummer je Gesellschaft, SKR03 oder SKR04, Sachkontenlänge, Steuerschlüsseltabelle, Beginn des Wirtschaftsjahrs; (2) ein echtes EXTF-Muster vom Steuerberater, das SPEC §12 ausdrücklich VOR dem Bau verlangt; (3) die Tabellen konto, buchungssatz, periode und die Zuordnung Erlöskonto ↔ Leistungsart; (4) der Schritt 6 der Festschreibung, der den Buchungssatz in DERSELBEN Transaktion erzeugt (heute nur als Kommentar, rechnung.ts:912-919); (5) erloeskonto_schluessel wird vom Dienst nie gesetzt.

#### 23 Dokumentenzentrale — Upload mit echter MIME-Prüfung, Grössenbegrenzung, EXIF-Entfernung (DOC-06)

**Stand:** TEILWEISE · **Phase:** Phase 4 laut Manifest — übersprungen, bis heute nicht nachgeholt

*Beleg:* src/server/services/dokument/upload.ts:52 ladeHoch — Reihenfolge Grösse → Magic Bytes (storage/mime.ts) → Metadaten entfernen (storage/exif.ts) → Frist auflösen → speichern; DB erzwingt es mit CHECK dokument_mime_verifiziert_check und dokument_exif_entfernt und groesse_bytes ≤ 268435456

*Was fehlt / was stattdessen möglich ist:* Kein Mensch kann etwas hochladen: /portal/[mandant]/dokumente/upload (Manifest Z. 267) ist nicht gebaut, und es gibt keine API-Route dafür (find src/app/api zeigt keine dokument-Route). ladeHoch wird an genau EINER Stelle gerufen: services/bau/behinderung.ts:534 (erzeugte Behinderungsanzeige). Ein zweiter Systemweg schreibt direkt in dokument: src/app/api/anfrage/route.ts:232.

#### Out of scope — Kaltakquise an gescrapte Kontakte (der Mandant wünschte einen AI Sales Agent, der Firmen findet und anschreibt)

**Stand:** WIDERSPRUCH · **Phase:** keine — bewusst entfernt

*Beleg:* docs/DECISIONS.md:12-29 D-01; CLAUDE.md „Out of scope". Im Code gehalten: src/server/agent/policy.ts:54-57 Rechtsgrundlage = einwilligung | bestandskunde | anfrage, :98 RechtsgrundlageFehlt ('§ 7 UWG, LEG-08'), :15 'abgewiesen, ungeachtet jeder Freigabe — § 7 UWG ist nicht etwas, das ein Mensch per Klick ausser Kraft setzt'; D-99 (DECISIONS.md:1616) schliesst zwei Umgehungen. Es gibt keinen Scraper und keine Adressbeschaffung im Baum

*Was fehlt / was stattdessen möglich ist:* § 7 UWG verbietet unaufgeforderte elektronische Werbung ohne vorherige ausdrückliche Einwilligung — auch B2B. STATTDESSEN möglich und teils gebaut: Anfrageformulare der öffentlichen Seite mit Lead-Erzeugung und SLA (src/app/api/anfrage/route.ts, services/lead/*, Tabellen lead/lead_aktivitaet), der Ausschreibungsradar (Phase 8), Empfehlungen und manuelle CRM-Erfassung; Outbound nur an Kontakte mit aufgezeichneter rechtsgrundlage. Wer Kaltakquise dennoch will, entscheidet das mit seinem Anwalt, nicht im Code.

#### Out of scope (berührt 18 und 20) — Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklärung

**Stand:** WIDERSPRUCH · **Phase:** Phase 7 für die Exporte; die Berechnung selbst nie

*Beleg:* docs/DECISIONS.md:64-69 D-06; SPEC.md §12 'Not in scope: payroll calculation, Jahresabschluss, E-Bilanz, tax filing submission'; DECISIONS.md:3436 hält fest, dass Vergütung in Arbeitsvertrag und Lohnabrechnung eines Lohnsystems steht. Im Baum gibt es weder Lohnlogik noch Abschlusslogik

*Was fehlt / was stattdessen möglich ist:* Drei Branchentarife plus SOKA-Bau machen Lohn zu einem Spezialsystem; Abschluss und E-Bilanz gehören dem Steuerberater. STATTDESSEN vorgesehen: Zeitdatenexport an das Lohnsystem (ACC-12, Route /buchhaltung/lohnexport), DATEV-EXTF-Export (ACC-02), Jahrespaket für den Steuerberater (ACC-11), Z3-Export für die Betriebsprüfung (ACC-09) — alle vier heute NICHT gebaut, Phase 7.

### wichtig

#### 18 Finanzen — ZUGFeRD 2.x PDF/A-3 (FIN-12)

**Stand:** fehlt_ganz · **Phase:** Phase 6

*Beleg:* src/server/services/dokument/pdf.ts erzeugt nur ein einfaches Text-PDF (WinAnsi, 216 Z.) für Behinderungsanzeigen; kein PDF/A-3, keine XML-Einbettung. Route /finanzen/rechnungen/[id]/zugferd (Manifest Z. 230) nicht gebaut

*Was fehlt / was stattdessen möglich ist:* Kein Rechnungs-PDF überhaupt — auch kein einfaches. Der Kundenportal-Pfad /portal/kunde/rechnungen (Manifest Z. 430) ist ebenfalls nicht gebaut.

#### 18 Finanzen — Mahnwesen mit Stufen, Gebühren, Zinsen (FIN-15)

**Stand:** fehlt_ganz · **Phase:** Phase 6 (Mahnlauf) / Phase 8 (Agentenvorschläge)

*Beleg:* Keine Tabelle mahnung. Rechte mahnung.lesen/schreiben/freigeben existieren; Nummernkreistyp 'mahnung' ist in nummernkreis.ts:44 vorgesehen, im Seed aber nicht angelegt. Routen /finanzen/mahnungen(/[id]) (Z. 244-245) nicht gebaut; /finanzen/mahnungen/vorschlaege ist Phase 8

#### 18/23 — Seed — Der Seed übt Finanzen und Dokumente nicht aus

**Stand:** fehlt_ganz · **Phase:** Phase 6 (Rechnung, nach O-134) / Phase 4 (Dokumente)

*Beleg:* In cse_p5 (frisch migriert und geseedet): select status,count(*) from rechnung → 0 Zeilen; select count(*) from rechnung_hash → 0; select count(*) from dokument → 0. Zum Vergleich sind Angebots-, Auftrags-, Nachweis- und Wachbuchkreise gefüllt (naechste_nummer 2 bis 5)

*Was fehlt / was stattdessen möglich ist:* CLAUDE.md verlangt unter „Definition of done": 'seed data exercises it'. Für die Rechnung ist das aus gutem Grund nicht erfüllt (O-134 — eine geseedete Rechnung trüge eine erfundene Nummer); für das Dokumentenmodul gibt es diesen Grund nicht.

#### 18 Finanzen — §13b UStG Reverse Charge (FIN-09)

**Stand:** TEILWEISE · **Phase:** Phase 6

*Beleg:* rechnung.reverse_charge, .reverse_charge_grundlage (Enum bauleistungsart), CHECK rechnung_reverse_charge_hinweis (ohne steuerhinweis kein reverse_charge); steuersatz_gruppe kennt die Kategorie reverse_charge_13b (services/finanz/steuer/satz.ts:27); Positionen tragen en16931_steuerkategorie

*Was fehlt / was stattdessen möglich ist:* Kein Dienst entscheidet den Fall. grep '13b' in src/server/services findet nur angebot/index.ts:66 als offene Frage. Die Spalten müssen heute von Hand gesetzt werden; es gibt kein UI-Feld dafür (finanzen/rechnungen/neu/page.tsx kennt es nicht) und kein Recht wird geprüft, obwohl finanzen.steuerfall_uebersteuern in berechtigung existiert.

#### 18 Finanzen — Rechnungsausgangsbuch je Nummernkreis (FIN-16)

**Stand:** TEILWEISE · **Phase:** Phase 6

*Beleg:* Die Daten trügen es: rechnung.nummer_laufend mit UNIQUE (nummernkreis_id, nummer_laufend), rechnung_hash.kette_position, nummernkreis.letzter_hash/genesis_hash. Die Seite fehlt: /finanzen/ausgangsbuch (Manifest Z. 231) → Auffangseite. Auch /finanzen/nummernkreise (Z. 247) fehlt

*Was fehlt / was stattdessen möglich ist:* Ohne diese Seite gibt es keinen Ort, an dem ein Prüfer die Lückenlosigkeit und den Kettenzustand sieht. Der Rechnungslistenfilter aus FIN-16 (Entwurf · Festgeschrieben · Bezahlt · Storniert · Verworfen) existiert ebenfalls nicht — finanzen/rechnungen/page.tsx listet ohne Statusfilter, und 'Bezahlt' gäbe es mangels Zahlungen ohnehin nicht.

#### 23 Dokumentenzentrale — Aufbewahrung und Löschsperre je Kategorie (DOC-07), keine Hard Deletes

**Stand:** TEILWEISE · **Phase:** Phase 7 (Oberfläche) · O-25 ist eine Mandantenfrage

*Beleg:* Tabelle dokument_aufbewahrung; Trigger trg_dokument_aufbewahrung (kern.setze_aufbewahrung), trg_dokument_loeschsperre (kern.dokument_loeschsperre), trg_dokument_kein_hard_delete und _kein_truncate (kern.verhindere_loeschung); drizzle/0009_dokument.sql:133-172 und :274; upload.ts:95 behandelt eine unbekannte Frist als Sperre, nicht als deren Abwesenheit

*Was fehlt / was stattdessen möglich ist:* Die Fristen sind Platzhalter: dokument_aufbewahrung.ist_platzhalter, kategorie.ts:33 '// TODO(client): O-25 — Aufbewahrungsfristen je Dokumentkategorie'. Die Seite /dokumente/aufbewahrung (Manifest Z. 271) ist nicht gebaut.

#### 23 Dokumentenzentrale — Versionierung (DOC-05)

**Stand:** TEILWEISE · **Phase:** Phase 4

*Beleg:* Tabelle dokument_version (version, objekt_schluessel, sha256, groesse_bytes, mime_typ) mit FK auf (mandant_id, dokument_id). Geschrieben wird sie an zwei Stellen, beide nur mit Version 1: src/server/services/bau/behinderung.ts:572 und src/app/api/anfrage/route.ts:244

*Was fehlt / was stattdessen möglich ist:* Kein Dienst legt eine zweite Fassung an, keine Oberfläche zeigt Fassungen. Route /dokumente/[id] 'metadata, versions, access log' (Manifest Z. 268) nicht gebaut. Ein Zugriffsprotokoll je Dokument gibt es nicht.

#### 23 Dokumentenzentrale — Private Buckets, nur signierte URLs mit kurzer Frist (DOC-03)

**Stand:** TEILWEISE · **Phase:** Phase 4

*Beleg:* src/server/storage/adapter.ts:56/:107 signierteUrl(bucket, schluessel, sekunden); dokument.bucket ist auf 'dokumente'|'archiv' beschränkt; src/server/storage/signatur.ts führt ein Zweckvokabular ('anzeigen', 'herunterladen', 'drucken', 'pruefbericht', 'datev_beleg', 'dsgvo_auskunft')

*Was fehlt / was stattdessen möglich ist:* Der Adapter wird für Dokumente nirgends benutzt — der einzige Aufrufer ist src/server/services/zeit/medien.ts:287 (Einsatzmedien). Es gibt keinen Weg, ein Dokument herunterzuladen.

#### Out of scope — Scraping von Indeed / StepStone

**Stand:** WIDERSPRUCH · **Phase:** keine — bewusst entfernt

*Beleg:* docs/DECISIONS.md:31-37 D-02; CLAUDE.md „Out of scope". Kein Scraper im Baum (kein HTTP-Ausgang ausser services/versand/dwd.ts für Wetterdaten; die Wache 'ein-ausgang' prüft genau das, PHASE-5-STAND.md „Wachen")

*Was fehlt / was stattdessen möglich ist:* AGB-Verstoss der Portale plus DSGVO-Risiko über Bewerberdaten. STATTDESSEN: Recruiting auf eingehenden Bewerbungen; eine Veröffentlichung auf einem Jobboard nur über dessen echte API mit echten Zugangsdaten.

#### Out of scope — Automatische Einreichung auf Vergabeplattformen

**Stand:** WIDERSPRUCH · **Phase:** Phase 8 (Radar/Mappe), Einreichung nie

*Beleg:* docs/DECISIONS.md:70-79 D-07; CLAUDE.md „Out of scope". Kein Einreichungscode im Baum

*Was fehlt / was stattdessen möglich ist:* Die deutschen Vergabeplattformen stellen keine Einreichungs-API bereit; Konten hängen an natürlichen Personen, teils mit elektronischer Signatur. STATTDESSEN: der Agent stellt die vollständige Angebotsmappe zusammen und prüft die Vollständigkeit, ein Mensch lädt hoch. Vergaberecht ist formalistisch — ein fehlendes Dokument bedeutet Ausschluss ohne Prüfung; der Wert liegt in der Vollständigkeitsprüfung, nicht im Absenden.

### klein

#### 18 Finanzen — Warnung: abgeschlossener Auftrag ohne erfasste Zeit vor der Rechnung (FIN-18)

**Stand:** fehlt_ganz · **Phase:** Phase 6

*Beleg:* Route /finanzen/pruefungen (Manifest Z. 219) nicht gebaut; kein Dienst dazu in src/server/services/

#### 23 Dokumentenzentrale — Ein-Klick-Bündel für Prüfung oder Kontrolle (DOC-08)

**Stand:** fehlt_ganz · **Phase:** Phase 7

*Beleg:* Recht dokument.buendel_exportieren existiert; Route /dokumente/buendel (Manifest Z. 270, Phase 7) nicht gebaut, kein Dienst

#### 18 Finanzen — Kleinbetragsrechnung unter 250 € (FIN-13)

**Stand:** TEILWEISE · **Phase:** Phase 6

*Beleg:* Tabelle kleinbetrag_grenze (grenze_brutto_cent, gueltig_von/bis, fundstelle, ist_platzhalter) mit Historie und Audit-Trigger; rechnung.ist_kleinbetrag

*Was fehlt / was stattdessen möglich ist:* rechnung.ts:809 setzt 'kleinbetragGrenzeCent: null' — die Grenze wird nirgends aufgelöst, ist_kleinbetrag nirgends berechnet. Die Tabelle ist im Seed nicht gefüllt (ist_platzhalter defaultet auf true).

---

## Social Media, Daten, Schnittstellen (31–33)

### tragend

#### 17 Social-Media-Zentrale — SOC-01 — vier Profile aus einem System verwalten

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* Keine Tabelle `social_post`/`social_channel`/`kanal_statistik` in der Datenbank (137 Tabellen, \dt auf cse_p5); kein Dienst unter src/server/services/; keine Seite unter src/app/**. Vorhanden sind nur: sechs Rechteschluessel (drizzle/0008_berechtigung_matrix.sql:276-280, 207) und sieben Manifestzeilen (src/server/registry/routen.generiert.ts:304-310, phase 9).

*Was fehlt / was stattdessen möglich ist:* Alles: Schema, Dienst, Seite, Seed. Es gibt Rechte, die auf nichts zeigen — super_admin/admin/leitung tragen social.lesen/schreiben/planen/freigeben (rolle_berechtigung, 30 Zeilen), und keine dieser Rollen kann damit irgendetwas aufrufen.

#### 17 Social-Media-Zentrale — SOC-02 — Beitraege, Bilder, Projekte, News, Updates

**Stand:** fehlt_ganz · **Phase:** 9 (Profilunterseiten laut Manifest schon 2)

*Beleg:* `referenz` 0 Zeilen, `medien` 0 Zeilen (select count(*)). Die oeffentlichen Seiten `/news` und `/projekte` sind CMS-Zeilen in `seite` (26 Zeilen) mit statischem `abschnitt`-Text, keine Datensaetze. `/unternehmen/[bereich]/beitraege`, `/galerie`, `/projekte`, `/news` stehen im Manifest, haben aber keine page.tsx und unter `(public)` gibt es keinen Sammler — also 404, nicht NochNichtGebaut.

*Was fehlt / was stattdessen möglich ist:* Beitragsentitaet fehlt vollstaendig. Die vier Profilunterseiten, die der Mandant als Kern beschreibt, sind aus dem Netz nicht erreichbar.

#### 17 Social-Media-Zentrale — SOC-05 — Veroeffentlichen auf den CSE-Profilen der eigenen Website „funktioniert sofort“

**Stand:** fehlt_ganz · **Phase:** 2 laut Manifest / 9 laut ROADMAP

*Beleg:* Die dreizehn Routen `/portal/[mandant]/website/*` (routen.generiert.ts:311-323, phase 2) haben keine einzige page.tsx. `unternehmensprofil` existiert (8 Zeilen) und wird nur fuer Kurztexte gelesen (src/server/inhalt/lesen.ts:92-95, src/server/inhalt/seiten-daten.ts:107) — Logo, Cover, Leistungen, Bilder, Projekte, Beitraege werden nirgends gerendert.

*Was fehlt / was stattdessen möglich ist:* Es gibt keinen Weg, auf dem ein Mensch einen Beitrag auf ein Profil bringt — weder Pflege- noch Anzeigeseite. Diese Routen sind laut Manifest Phase 2 und damit ueberfaellig, nicht spaeter.

#### 27 Technik — Supabase Auth — Supabase Auth, 2FA fuer Adminrollen

**Stand:** fehlt_ganz · **Phase:** 1 (PR 20, offen)

*Beleg:* Keine Auth-Anbindung im Code. Sitzungen sind eine eigene Tabelle `benutzer_sitzung` mit `app.sitzung_aufloesen` (drizzle/0007_benutzer_auth.sql; src/server/auth/sitzung.ts:55-80). Von den elf `/auth/*`-Routen des Manifests (login, callback, zwei-faktor/einrichten, /pruefen, /wiederherstellung, passwort-vergessen, einladung/[token], abmelden, kein-zugriff — alle phase 1) ist keine gebaut; unter src/app/auth/ liegt nur `bereich/`. Angemeldet wird ueber src/app/dev/anmelden/page.tsx hinter `CSE_DEV_FLAECHEN` (src/lib/dev-flaechen.ts).

*Was fehlt / was stattdessen möglich ist:* In einem Produktionsbau ist `/dev/**` ein 404 (D-20) — dann ist das ganze Portal unerreichbar. Ehrlich gesagt wird es: src/app/portal/Anmeldung.tsx zeigt „kein Formular, das so aussaehe, als wuerde es etwas tun“, ROADMAP.md:32-38 nennt es als die eine benannte Ausnahme. Aber es ist die tragende Luecke der Abgabe.

#### 27 Technik — OpenAI — OpenAI-Anbindung

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Null Treffer fuer `openai` in src/, scripts/ und package.json. Unter src/server/agent/ liegt genau eine Datei: policy.ts (das Ausgangstor). Keine Werkzeuge (AGT-02), kein Orchestrator, kein `pgvector`, keine Tabellen `agent_aufgabe`/`agent_schritt`/`agent_budget`/`wissens_chunk`. Vorhanden ist nur `agent_richtlinie` (12 Zeilen, alle `auto_erlaubt = false`).

*Was fehlt / was stattdessen möglich ist:* Vollstaendig. Die Stelle, die es sagt: docs/architecture/07-INTEGRATIONEN.md §5 — „OpenAI | LlmPort EmbeddingPort VisionPort | Nicht verbunden | O-121 (EU per model)“. D-04 und die EU-/Zero-Retention-Zusage sind damit noch nicht eingeloest, nur aufgeschrieben.

#### 27 Technik — Ausgang — Mail- und SMS-Versand

**Stand:** fehlt_ganz · **Phase:** 9/10

*Beleg:* Kein Transport im Repo: grep ueber nodemailer/smtp/sendgrid/postmark/mailgun/resend/twilio findet nichts in src/, scripts/, package.json. src/server/versand/ enthaelt genau eine Datei — dwd.ts (Wetter). Die Wache `ein-ausgang` (scripts/guards/run-all.ts:402) haelt es so.

*Was fehlt / was stattdessen möglich ist:* „Nicht verbunden“ steht in docs/architecture/07-INTEGRATIONEN.md §5: MailerPort (O-116), SmsPort (O-82), MailboxPort (O-28/O-131). Folge: keine Eingangsbestaetigung, keine Benachrichtigung, kein Einmalcode. Siehe auch die zwei Befunde unter Abschnitt 32.

#### 28 Datenmodell — social_posts — `social_post` / `social_channel` / `kanal_statistik`

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* Keine der drei Tabellen existiert. Siehe Abschnitt 17.

*Was fehlt / was stattdessen möglich ist:* Vollstaendig.

#### 28 Datenmodell — ai_agents — `ai_agents` (dt. `agent_aufgabe`, `agent_budget`, `wissens_chunk`)

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Nur `agent_richtlinie` existiert (12 Zeilen, 2 FK, 2 CHECK, RLS) — die RICHTLINIE, nicht der Agent. Keine Agententabelle, kein Budget, kein pgvector-Index. src/server/agent/ enthaelt genau policy.ts.

*Was fehlt / was stattdessen möglich ist:* Das Agentenzentrum (AGT-01: Name, Status, Aufgaben, Aktivitaet, Protokolle, Rechte, verbundene Werkzeuge, Freigabepflichten) existiert nicht. D-03 hat acht Agenten auf vier reduziert; gebaut ist keiner davon.

#### 27 Technik — Jobs — Supabase cron + Edge Functions — die naechtlichen Laeufe

**Stand:** TEILWEISE · **Phase:** 10 (Betrieb)

*Beleg:* Register und Runner sind gebaut und getestet: src/server/jobs/registry.ts (Registrierung wirft beim Registrieren, nicht um drei Uhr nachts), runner.ts (Idempotenz, Backoff, Alarm), drei Jobs mit Cron-Ausdruecken — einsaetzeGenerieren.ts:29 `15 2 * * *`, konflikteErkennen.ts:53 `45 2 * * *`, lead-sla.ts:23 `0 * * * *`. **`fuehreAus` wird ausserhalb von tests/ nirgends aufgerufen** (grep): kein `/api/cron/*`, keine pg_cron-Migration in den 80 SQL-Dateien, kein supabase/functions-Verzeichnis.

*Was fehlt / was stattdessen möglich ist:* Der Zeitplan ist eine Zeichenkette in einem Objekt. So ausgeliefert laufen die naechtliche Schichterzeugung, die ArbZG-Konflikterkennung und die SLA-Eskalation des Leads NIE. Benannt ist es in docs/architecture/07-INTEGRATIONEN.md §5 Zeile 784 („Supabase cron (pg_cron + pg_net) | SchedulerPort | Nicht verbunden (no project)“) — aber PHASE-5-STAND.md fuehrt PR 30 als „Generator + naechtlicher Job“ fertig, und ROADMAP Phase 2 nennt den Eskalationsjob als Abnahmekriterium. Zwei Dokumente, zwei Aussagen.

#### 28 Datenmodell — invoices — `rechnung` (+ `rechnungsposition`, `rechnung_steuer`, `rechnung_hash`, `rechnung_snapshot`, `nummernkreis`)

**Stand:** TEILWEISE · **Phase:** 6

*Beleg:* RLS, 10 FK, 14 CHECK — die dichteste Tabelle im Bestand. Einbahnstrasse und Unveraenderlichkeit in 0076, Hashkette in 0077, Nummernkreis mit `SELECT … FOR UPDATE` in 0006 (D-28). Dienst: src/server/services/finanz/rechnung.ts; Routen /api/rechnungen{,/festschreiben,/storno,/verwerfen}; Seiten /finanzen/rechnungen{,/neu,/[id]}.

*Was fehlt / was stattdessen möglich ist:* 0 Rechnungen im Seed, und das mit Absicht: der Ausgangsrechnungskreis steht auf `ist_platzhalter = true`, solange O-134 (Nummernformat je Gesellschaft) offen ist — kein Nummernzug aus einem unbestaetigten Kreis. Phase 6 laeuft damit schon im Phase-5-Zweig (ROADMAP.md:40-50).

#### 28 Datenmodell — Bilanz der Liste — Was von den 23 genannten Entitaeten ganz fehlt

**Stand:** TEILWEISE · **Phase:** 6-9 fuer die sechs abwesenden

*Beleg:* Vorhanden und tragend: benutzer, rolle, berechtigung, mandant, person/anstellung, kunde, ansprechpartner, lead, projekt, auftrag, angebot, rechnung, dokument, planungsserie/einsatz, audit_log (15). Tabelle da, Modul nicht: nachricht, benachrichtigung (2). Ganz abwesend: ausgabe, zahlung, aufgabe, social_post, ai_agents, ai_runs (6).

*Was fehlt / was stattdessen möglich ist:* Dafuer traegt das Schema 137 Tabellen statt der 23 genannten — die Gewerke (aufmass, nachtrag, behinderung, bautagebuch, wachbuch_eintrag, dienstanweisung, schluessel, revier, turnus, leistungsnachweis), die Zeit (zeiteintrag, stundenkonto, urlaubskonto, zeit_einwand, arbeitszeit_verstoss) und die Rechtsschicht (freigabe, versand, job_lauf, dokument_aufbewahrung) stehen in der Liste des Mandanten gar nicht.

#### 27 Technik — Supabase Auth — Zweiter Faktor (AAL2) wird tatsaechlich geprueft

**Stand:** WIDERSPRUCH · **Phase:** 1

*Beleg:* src/server/auth/sitzung.ts:173 — `devSitzungAusstellen` schreibt `aal = 'aal2'` fest in jede ausgestellte Sitzung, ohne dass je ein Faktor geprueft wurde; die Begruendung steht daneben (Zeile 112: sonst blieben Rechte mit `erfordert_2fa` still leer). Die RLS-Decke `p_rb_aal2` auf `rolle_berechtigung` und jedes `aal2: true` im Routenmanifest laufen damit gegen eine Behauptung.

*Was fehlt / was stattdessen möglich ist:* Solange PR 20 fehlt, ist „2FA fuer super_admin und admin“ (CLAUDE.md, Phase 1) im Code als erfuellt markiert und in der Sache nicht vorhanden. Hinter `CSE_DEV_FLAECHEN` und dokumentiert — aber es ist genau die Sorte Zusage, die spaeter niemand mehr nachprueft.

#### 32 Entwicklungsregel — „Angebot versenden“ versendet nichts

**Stand:** WIDERSPRUCH · **Phase:** keine — es ist gebaut und falsch benannt

*Beleg:* Der Knopf: src/app/portal/[mandant]/angebote/[id]/page.tsx:330-345 (`data-cse="versenden"`, Beschriftung „Angebot versenden“). Was er tut: src/server/services/angebot/index.ts:257-304 — Nummer ziehen, `status = 'versendet'`, `versendet_am = now()`, `freigegeben_von = <der Klickende>`. Kein `gate()`-Aufruf, keine `versand`-Zeile, kein Empfaenger. Die Aktion `angebot_senden` steht in src/server/agent/policy.ts:23,44 und wird von keiner Zeile im Code benutzt (grep).

*Was fehlt / was stattdessen möglich ist:* Der Kunde bekommt nichts. Das Wort „versendet“ steht danach als Status in Liste, Detail und PDF, und `angebot_rueckzug_ehrlich` haengt daran. Was wirklich geschah, ist „freigegeben und nummeriert“. Entweder die Beschriftung sagt das (z. B. „Angebot freigeben und nummerieren“, danach „Angebotsdokument“ zum Herunterladen) — oder der Weg geht durch `gate('angebot_senden')` und schreibt eine `versand`-Zeile, sobald ein MailerPort existiert. D-55 verspricht ausdruecklich beides zusammen: „im Code UND in der Datenbank“ — die Datenbank haelt es (`angebot_freigabe_vor_versand`), der Code umgeht das Tor.

#### 32 Entwicklungsregel — `bestaetige()` wuerde „gesendet“ stempeln, ohne dass ein Versandweg existiert

**Stand:** WIDERSPRUCH · **Phase:** 9 fuer den Transport

*Beleg:* src/server/services/lead/bestaetigung.ts:100-120: `gesendet_am = case when $6 then now() else null end`, `ergebnis = 'gesendet (richtlinie)'`, Rueckgabe `gesendet: true` — allein aus dem Ergebnis von `gate()`. Es gibt keinen MailerPort (src/server/versand/ enthaelt nur dwd.ts). Heute faellt es nicht auf, weil der Aufrufer `gate` mit `(null, null)` fuettert (src/app/api/anfrage/route.ts:285-291) und alle 12 `agent_richtlinie`-Zeilen auf `auto_erlaubt = false` stehen: die einzige `versand`-Zeile im Bestand traegt `gesendet_am = NULL` und den Verweigerungsgrund.

*Was fehlt / was stattdessen möglich ist:* Latent, nicht aktiv — aber scharf gestellt: sobald jemand eine Richtlinie fuer `email_senden` auf `true` setzt (AGT-03 verspricht genau das aus der UI heraus), protokolliert die Plattform „gesendet“ fuer eine Mail, die es nicht gibt, und niemand bemerkt es. Die Erlaubnis des Tores ist nicht dasselbe wie eine Zustellung; `gesendet_am` gehoert vom Transport gesetzt, nicht von der Richtlinie.

#### Ausdruecklich zu benennen — Kaltakquise an gescrapte Kontakte

**Stand:** WIDERSPRUCH · **Phase:** keine — bleibt draussen

*Beleg:* Nicht gebaut und ausdruecklich entfernt: docs/DECISIONS.md:12-29 (D-01), docs/SPEC.md §23. Im Code hart durchgesetzt: src/server/agent/policy.ts:97-106 `RechtsgrundlageFehlt` — „ein hartes Tor: auch eine erteilte Freigabe hebt es nicht auf“, geprueft VOR Freigabe und Richtlinie (D-56). Kein Scraper, kein Adresskauf, kein Massenversand im Repo.

*Was fehlt / was stattdessen möglich ist:* § 7 UWG verbietet unaufgeforderte elektronische Werbung ohne vorherige ausdrueckliche Einwilligung — auch B2B. Folge waeren Abmahnung, Kosten, Unterlassung, dazu DSGVO-Risiko aus der Listenbeschaffung. STATTDESSEN moeglich, und teils gebaut: eingehende Formularanfragen mit Herkunft, UTM und SLA (`lead`, `formular_eingang`, `lead_aktivitaet`); Vergaberadar als Auftragsquelle (Phase 8); Empfehlungen; manuelle CRM-Pflege. Ausgehend darf jeder Kontakt angesprochen werden, der eine aufgezeichnete `rechtsgrundlage` traegt — Einwilligung, Vertrag, Bestandskunde, eigene Anfrage.

#### Ausdruecklich zu benennen — Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklaerung

**Stand:** WIDERSPRUCH · **Phase:** 7 fuer Export und Uebergabe

*Beleg:* Nicht gebaut. docs/DECISIONS.md:63-67 (D-06), SPEC §23. Im Code als Grenze sichtbar: src/server/services/mitarbeiter/felder.ts:23 haelt den Entgeltsatz aus der Mitarbeiteransicht heraus, weil der Beleg dafuer aus einem Lohnsystem kommt (D-06); docs/DECISIONS.md:3437-3439 begruendet dieselbe Grenze gegen K-05/D-09. `stundensatz_intern` bleibt fuer sechs Beschaeftigungen NULL, statt einen Satz zu erfinden (O-347).

*Was fehlt / was stattdessen möglich ist:* Drei Branchentarife plus SOKA-Bau; Jahresabschluss und E-Bilanz gehoeren dem Steuerberater. STATTDESSEN: die Plattform BEREITET VOR und EXPORTIERT — Zeiten nach § 17 MiLoG revisionssicher, Stunden- und Urlaubskonten mit Monatsabschluss als Einbahnstrasse, Abwesenheiten, spaeter der DATEV-EXTF-Export und die Uebergabedatei ans Lohnsystem (`PayrollExportPort`, 07-INTEGRATIONEN §5, „Nicht verbunden | O-27“). Rechnen und Einreichen tun Lohnsystem und Steuerberater.

### wichtig

#### 17 Social-Media-Zentrale — SOC-03 — Entwurf → Pruefung → Freigabe → Planung → Veroeffentlichung

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* Kein Statusfeld, kein Planungsdatum, keine Seite. Die Maschinerie dafuer steht aber: `freigabe`/`freigabe_kette`/`freigabe_snapshot` (drizzle/0012_freigabe.sql) und src/server/agent/policy.ts mit der Aktion `social_veroeffentlichen` (policy.ts:23,44).

*Was fehlt / was stattdessen möglich ist:* Der Ablauf selbst. Das Tor ist da, das Ding, das hindurchginge, nicht.

#### 28 Datenmodell — expenses — `ausgabe` / `beleg` / `eingangsrechnung`

**Stand:** fehlt_ganz · **Phase:** 7

*Beleg:* Keine der drei Tabellen existiert (Abfrage ueber pg_class nach zahlung|ausgabe|beleg|eingangs|datev|konto_map — ein einziger Treffer, und das ist `agent_richtlinie`). SPEC §22 fuehrt sie, docs/ beschreibt sie, das Schema kennt sie nicht.

*Was fehlt / was stattdessen möglich ist:* Vollstaendig. Die Routen `/portal/[mandant]/buchhaltung/**` (routen.generiert.ts:248-263) stehen im Manifest als Phase 7.

#### 28 Datenmodell — payments — `zahlung` / `mahnung`

**Stand:** fehlt_ganz · **Phase:** 6/7

*Beleg:* Keine Tabelle. Das Recht `zahlung.schreiben` existiert bereits im Katalog und wird von Manifestzeilen 256-258 (`buchhaltung/bank`) verlangt — ein Recht auf eine Tabelle, die es nicht gibt. `mahnung_senden` ist als Gate-Aktion vorhanden (policy.ts:44) und im Seed fail-closed gesetzt.

*Was fehlt / was stattdessen möglich ist:* Vollstaendig. Ohne `zahlung` gibt es keinen offenen Posten und keinen Mahnlauf.

#### 28 Datenmodell — tasks — `aufgabe`

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* Keine Tabelle, kein Dienst, keine Seite, kein Recht. SPEC §22 fuehrt `aufgabe` neben `kalender_eintrag`; scripts/katalog/extrahiere.ts:29 nennt das Modul in der Wortliste — mehr gibt es nicht.

*Was fehlt / was stattdessen möglich ist:* Vollstaendig. Auch `kalender_eintrag` (zentraler Kalender, iCal-Feed) fehlt ganz.

#### 28 Datenmodell — ai_runs — `ai_runs` (dt. `agent_schritt`)

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Keine Tabelle. AGT-04 verlangt je Schritt Werkzeug, Eingabe, Ausgabe, Modell, Tokens, Kosten, Dauer — nichts davon ist im Schema.

*Was fehlt / was stattdessen möglich ist:* Vollstaendig. Ohne sie gibt es auch keine Budgetgrenze (AGT-05).

#### 17 Social-Media-Zentrale — SOC-07 — nicht verbundene Kanaele zeigen „nicht verbunden“ und werden nie simuliert

**Stand:** TEILWEISE · **Phase:** 2 laut Manifest

*Beleg:* Nicht simuliert: ja — es gibt keinen Zeile Code, der einen Kanal nachstellt (grep social ueber src/ findet nur Rechte, Manifest, Gate-Aktion). Angezeigt: nein — `/portal/[mandant]/einstellungen/integrationen`, die Seite mit „verbunden / nicht verbunden“ je Dienst (routen.generiert.ts:360, phase 2), ist nicht gebaut.

*Was fehlt / was stattdessen möglich ist:* Der Mandant hat im Produkt keine Stelle, an der er den Verbindungsstand sieht. Er steht nur in docs/architecture/07-INTEGRATIONEN.md §5.

#### 27 Technik — Supabase Postgres — Supabase Postgres als Datenhaltung, EU Frankfurt

**Stand:** TEILWEISE · **Phase:** 0 / 10

*Beleg:* Die Anwendung spricht mit blankem Postgres ueber den `postgres`-Treiber (package.json; src/server/db/pool.ts, `DATABASE_URL`), nicht ueber ein Supabase-SDK — `@supabase/supabase-js` steht in keiner Abhaengigkeit. `supabase/config.toml` ist die einzige Supabase-Datei im Repo und enthaelt nur Absicht: `region = "eu-central-1"`, von der Wache `wacheEuRegion` (run-all.ts:443-450) geprueft. src/server/env.ts:16 erzwingt `SUPABASE_REGION` auf `^eu-`.

*Was fehlt / was stattdessen möglich ist:* Kein angelegtes Projekt. docs/architecture/07-INTEGRATIONEN.md §5, Zeile 781: „Supabase Postgres / Auth / Storage — not yet provisioned; the application does not boot without it | O-11“ und §5 Kopf: „nothing is Verbunden today“. 80 Migrationen laufen gegen jedes Postgres — der Wechsel ist also billig, aber er ist nicht vollzogen.

#### 27 Technik — Supabase Storage — Supabase Storage, private Buckets, signierte URLs

**Stand:** TEILWEISE · **Phase:** 10

*Beleg:* Echter Adapter gegen `storage/v1` per fetch: src/server/storage/adapter.ts:60-125. Drei private Buckets, kein oeffentlicher (Zeile 33), Signatur 15 Minuten als Codekonstante (Zeile 41). Ohne `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` wirft er `NichtVerbundenFehler` (Zeile 71) — kein simulierter Erfolg; die Route antwortet 503 (src/app/api/anfrage/route.ts:305-307).

*Was fehlt / was stattdessen möglich ist:* Nicht verbunden. Sichtbar daran, dass `medien` und `dokument` im geseedeten Bestand 0 Zeilen haben. Der Vertrag steht, der Speicher dahinter nicht.

#### 27 Technik — Vercel — Vercel, EU-Funktionsregion

**Stand:** TEILWEISE · **Phase:** 10

*Beleg:* Absicht im Repo: next.config.ts:8-9 setzt `VERCEL_REGION` auf `fra1` als Vorgabe, src/app/healthz/route.ts:11-12 gibt Build und Region zurueck. Kein `vercel.json`, kein Deployment.

*Was fehlt / was stattdessen möglich ist:* docs/architecture/07-INTEGRATIONEN.md §5: „Vercel | hosting — no port | not yet provisioned | O-11“. Die Regionzusage ist heute eine Voreinstellung in einer Konfigurationsdatei, keine Eigenschaft einer laufenden Umgebung.

#### 28 Datenmodell — companies — `mandant` (die Gesellschaft) — nicht `firma`

**Stand:** TEILWEISE · **Phase:** keine (offene Frage O-353)

*Beleg:* `mandant`: 4 Zeilen, 5 CHECK, RLS an. Daneben `firma` (2 Zeilen) — das ist die KUNDENseitige juristische Person, nicht die eigene (Spalten ust_id, handelsregister_*, zusammengefuehrt_in_firma_id).

*Was fehlt / was stattdessen möglich ist:* Die Stammdaten in `mandant` sind ERFUNDEN und als solche markiert: `angaben_bestaetigt_am = NULL` seit Migration 0097, offene Frage O-353 (docs/DECISIONS.md:5082). Das Impressum sagt es sichtbar vor den Angaben. Anschrift, HRB und USt-IdNr. der vier Gesellschaften fehlen also wirklich.

#### 28 Datenmodell — documents — `dokument` (+ `dokument_version`, `dokument_aufbewahrung`)

**Stand:** TEILWEISE · **Phase:** 4

*Beleg:* Tabelle vorhanden mit RLS, 4 CHECK; drizzle/0009_dokument.sql. Dienste: services/dokument/{upload,pdf,kategorie}.ts, EXIF-Bereinigung in storage/exif.ts, signierte URLs (D-45, D-46, D-47). Eine unbekannte Aufbewahrungsfrist ist eine PFLICHT, keine Abwesenheit (D-49).

*Was fehlt / was stattdessen möglich ist:* Keine Seite: `/portal/[mandant]/dokumente` (Manifest 266, phase 4) ist nicht gebaut — und steht trotzdem als Punkt in der Sidebar (src/server/registry/navigation.ts, Eintrag `dokumente`). 0 Zeilen im Seed. Hochgeladen wird heute nur ueber das oeffentliche Anfrageformular, und auch das nur mit verbundenem Speicher.

#### 28 Datenmodell — messages — `nachricht` + `nachricht_empfaenger`

**Stand:** TEILWEISE · **Phase:** 3

*Beleg:* Beide Tabellen existieren mit RLS und `mandant_id` (2 bzw. 3 FK) — **aber 0 CHECK-Bedingungen**, als einzige der geprueften Kerntabellen. 0 Zeilen. Gelesen oder geschrieben wird sie nirgends: grep findet `nachricht` nur in services/lead/annahme.ts, db/seed/formulare.ts und api/mein/antraege/route.ts, und dort als Wortbestandteil, nicht als Tabellenzugriff.

*Was fehlt / was stattdessen möglich ist:* Die Seiten `/portal/[mandant]/nachrichten` und `/nachrichten/[id]` (phase 3) sind nicht gebaut. Eine Tabelle ohne Schreiber, ohne Leser und ohne Bedingung — das ist der Lehrbuchfall „Tabelle ist kein Modul“.

#### 28 Datenmodell — notifications — `benachrichtigung` + `benachrichtigung_praeferenz`

**Stand:** TEILWEISE · **Phase:** 9

*Beleg:* Tabellen vorhanden (drizzle/0011_benachrichtigung.sql), RLS an, 2 FK, 2 CHECK. Register mit Arten, Kanaelen und Praeferenz: src/server/benachrichtigung/registry.ts; Arten registriert fuer Leads (services/lead/benachrichtigung.ts) und Nachweise (services/nachweis/benachrichtigung.ts).

*Was fehlt / was stattdessen möglich ist:* **Es gibt kein `insert into benachrichtigung` im ganzen Code** (grep). `erzeuge()` (registry.ts:105-128) baut ein Objekt im Speicher und gibt es zurueck; der Ablaufwaechter schreibt `nachweis_warnung`, nicht die Benachrichtigung (services/nachweis/ablauf.ts:124,138). 0 Zeilen. Kein Posteingang: `/portal/[mandant]/benachrichtigungen` (phase 2) nicht gebaut. D-53 („Eine Benachrichtigung ohne Ziel entsteht gar nicht“) liest sich wie eine Regel fuer etwas Laufendes.

#### 32 Entwicklungsregel — Gebaute Module ohne Demodaten

**Stand:** TEILWEISE · **Phase:** keine

*Beleg:* `schluessel` 0 Zeilen und `dienstanweisung` 0 Zeilen — beide Module sind gebaut (drizzle/0078, 0079; sieben Seiten unter /security/**) und beide haben einen eigenen Sidebar-Punkt (navigation.ts). Ebenso leer: `dokument` 0, `medien` 0, `referenz` 0, `nachricht` 0, `benachrichtigung` 0, `rechnung` 0.

*Was fehlt / was stattdessen möglich ist:* CLAUDE.md, Definition of done: „seed data exercises it“. Wer `Schluessel` oder `Dienstanweisungen` anklickt, bekommt eine leere Liste — und eine leere Liste ist genau die Aussage, die NochNichtGebaut ausdruecklich vermeiden will („liest sich wie ‚es gibt nichts‘“). Bei `rechnung` ist die Leere begruendet (O-134, Platzhalterkreis); bei den anderen fuenf nicht.

#### 32 Entwicklungsregel — Manifestzeile ist nicht gleich gebaute Seite — die Zahl

**Stand:** TEILWEISE · **Phase:** 2 und 9

*Beleg:* 432 Adressen im Manifest (src/server/registry/routen.generiert.ts), 127 Dateien `src/app/**/page.tsx`. Gegengerechnet: rund 109 Manifestadressen haben eine eigene Seitendatei (robots/sitemap/llms.txt kommen ueber Next-Konventionen dazu). Der Rest faellt auf NochNichtGebaut — oder, ausserhalb von `/portal`, auf 404.

*Was fehlt / was stattdessen möglich ist:* Beim oeffentlichen Teil ist das nicht abgefedert: `(public)` hat keinen Sammler. `/unternehmen/[bereich]/beitraege|galerie|projekte|news|leistungen|kontakt|unternehmensdaten` (Manifest phase 2) sind 404, nicht „wird noch gebaut“ — also genau die Auskunft, die NochNichtGebaut fuer das Portal verwirft.

#### Ausdruecklich zu benennen — Scraping von Indeed / StepStone

**Stand:** WIDERSPRUCH · **Phase:** 9 fuer den erlaubten Teil

*Beleg:* Nicht gebaut; grep ueber src/ nach scrap|indeed|stepstone: null Treffer. Entschieden in docs/DECISIONS.md:31-36 (D-02) und SPEC §16 („Scope: inbound applications“). Das Manifest fuehrt `/recruiting/stellen/[id]/veroeffentlichung` mit dem ausdruecklichen Zusatz „‚nicht verbunden‘ where no API exists“ (routen.generiert.ts:329, phase 9); 07-INTEGRATIONEN §5: „Job boards | JobBoardPort | Nicht verbunden | O-10“.

*Was fehlt / was stattdessen möglich ist:* AGB-Verstoss der Portale und DSGVO-Risiko ueber Bewerberdaten. STATTDESSEN: Bewerbung ueber die eigene Karriereseite und ein ueberwachtes Postfach (REC-03), Lebenslauf-Auswertung zu einem strukturierten Datensatz, Rangliste mit sichtbaren Kriterien als VORSCHLAG (REC-08, Art. 22 DSGVO), Veroeffentlichung auf einem Jobboard nur ueber eine echte API mit echten Zugangsdaten, gestuetzte Loeschfristen (REC-07).

#### Ausdruecklich zu benennen — Automatische Einreichung auf Vergabeplattformen

**Stand:** WIDERSPRUCH · **Phase:** 8

*Beleg:* Nicht gebaut; kein Einreichungspfad im Code. docs/DECISIONS.md:69-77 (D-07), SPEC §23 und §17 („Acquisition Agent … Never does: Sends or submits anything“). Die Autonomiematrix in SPEC §17 fuehrt jeden Ausgang als freigabepflichtig.

*Was fehlt / was stattdessen möglich ist:* Die deutschen Plattformen bieten bewusst keine Einreichungs-API; Konten haengen an natuerlichen Personen, teils mit elektronischer Signatur. STATTDESSEN: Radar liest oeffentlichevergabe.de (OCDS) und TED v3 — beide sind als „Verbindbar (public)“ gefuehrt —, bewertet nachvollziehbar mit Begruendungstext, zaehlt die Frist herunter, liest die Vergabeunterlagen aus und stellt die Vergabemappe VOLLSTAENDIG zusammen; hochgeladen wird von einem Menschen. Der Wert liegt in der garantierten Vollstaendigkeit vor dem Absenden — Vergaberecht ist formalistisch, ein fehlendes Dokument fuehrt zum Ausschluss ohne Pruefung.

### klein

#### 27 Technik — n8n — n8n nur als Kleber fuer externe Systeme

**Stand:** fehlt_ganz · **Phase:** keine (Bedarf offen)

*Beleg:* Ein einziger Treffer im ganzen Code, und der ist ein Kommentar: src/server/jobs/registry.ts:9 („n8n fuehrt hier keine Geschaeftslogik aus“). Kein Webhook, kein Dienstkonto-Token, kein Aufrufpfad.

*Was fehlt / was stattdessen möglich ist:* Nicht verbunden — benannt in docs/architecture/07-INTEGRATIONEN.md §5: „n8n | inbound webhook + service token | Nicht verbunden | O-123“. Die Regel steht, das Ding nicht — was hier richtig herum ist.

#### 27 Technik — Tailwind — Tailwind (+ shadcn/ui laut CLAUDE.md-Stack)

**Stand:** TEILWEISE · **Phase:** keine

*Beleg:* Tailwind: tailwind.config.ts vorhanden, und die Merge-Wache `wacheTailwindFarben` (scripts/guards/run-all.ts:468 ff.) prueft jede Farbklasse gegen das echte Thema. shadcn/ui: null Treffer in package.json und src/ (grep -i shadcn).

*Was fehlt / was stattdessen möglich ist:* shadcn/ui ist im gesperrten Stack (CLAUDE.md) genannt und nicht eingesetzt; die Komponenten unter src/components sind handgeschrieben gegen docs/DESIGN.md. Das ist nirgends als Abweichung entschieden — kein D-Eintrag dazu in docs/DECISIONS.md.

#### 32 Entwicklungsregel — Zwei Sidebar-Punkte fuehren auf „wird noch gebaut“

**Stand:** TEILWEISE · **Phase:** 1 bzw. 4

*Beleg:* src/server/registry/navigation.ts fuehrt `dokumente` → `/portal/[mandant]/dokumente` (Manifest phase 4) und `einstellungen` → `/portal/[mandant]/einstellungen` (Manifest phase 1). Keine der beiden Adressen hat eine page.tsx; beide fallen auf src/app/portal/[mandant]/[...rest]/page.tsx und damit auf NochNichtGebaut.

*Was fehlt / was stattdessen möglich ist:* Bei `einstellungen` sagt die Seite „entsteht in Phase 1“ — einer Phase, die laut PHASE-5-STAND.md abgeschlossen ist. Die Auskunft ist damit nicht falsch, aber sie klingt wie ein Versehen. Die uebrigen Navigationspunkte wurden genau deswegen schon auf Unterseiten mit Inhalt umgebogen (Kommentare in navigation.ts zu dienstplan, bau, security, reinigung); diese zwei sind uebrig geblieben.

---

## Reihenfolge, Abnahme und Betriebsreife (34)

### tragend

#### 2 Login, Rollen, Rechte — Anmeldung — Echte Anmeldung mit Supabase Auth

**Stand:** fehlt_ganz · **Phase:** 1 (PR 20)

*Beleg:* Kein einziger Supabase-Aufruf in `src/server` (grep „supabase" über src/server: 0 Treffer). Sitzungen werden nur von src/app/dev/anmelden/page.tsx ausgestellt, hinter `CSE_DEV_FLAECHEN`; src/server/auth/sitzung.ts:16 „Das AUSSTELLEN einer Sitzung … wird von PR 20 durch Telefon + SMS ersetzt". `auth.users` und `auth.mfa_factors` sind lokale Stellvertretertabellen aus drizzle/0007_benutzer_auth.sql:21,307.

*Was fehlt / was stattdessen möglich ist:* Es gibt keine Anmeldeseite, kein Passwort, keinen Einmalcode, keine Abmeldung im Produktionsbetrieb. Ohne `CSE_DEV_FLAECHEN=1` kommt niemand ins Portal. Das ist Phase 1 des Mandanten — sie ist offen, während Phase 5 fertig ist.

#### 14 KI-Agenten — Agentenzentrale, Werkzeuge, Protokoll, Budget — Agent Center, Werkzeugsatz, Schritt-für-Schritt-Protokoll mit Kosten, Monatsbudget mit hartem Stopp, pgvector-Index

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* src/server/agent enthält GENAU EINE Datei: policy.ts. Kein OpenAI-Client (grep „openai" über src/: 0 Treffer), kein `pgvector` (0 Treffer), keine Tabelle `agent_lauf`/`agent_schritt`, keine Seite unter /portal/**/agenten.

*Was fehlt / was stattdessen möglich ist:* Vorhanden sind nur das Ausgangs-Gate (policy.ts, 286 Zeilen), `agent_richtlinie` (12 Zeilen im Seed) und das Freigabegerüst (`freigabe`, `freigabe_kette`, `freigabe_snapshot`, 1 Zeile). Die Zusage „die KI rechnet nie Geld" ist damit heute trivial erfüllt.

#### 24 Buchhaltung und DATEV — SKR03/04-Kontenzuordnung, EXTF-Export, Belegverknüpfung, CAMT.053-Import, OCR für Eingangsrechnungen, GoBD-Archiv

**Stand:** fehlt_ganz · **Phase:** 7

*Beleg:* „DATEV" erscheint in genau drei Dateien und in keiner davon als Funktion: src/server/storage/signatur.ts (Zweck `datev_beleg` einer signierten URL), das Routen-Manifest und src/lib/annahmen.ts. Keine Tabelle `buchung`, kein Export.

*Was fehlt / was stattdessen möglich ist:* Richtig so, solange die Voraussetzung fehlt: Beraternummer, Mandantennummer je Gesellschaft, Kontenrahmen, Sachkontenlänge, Steuerschlüssel und ein ECHTES Beispiel-EXTF vom Steuerberater sind offene Fragen. Die Regel „keine Schein-DATEV-Anbindung" ist eingehalten.

#### 26 Vergabe-Radar — Tägliche Aufnahme von oeffentlichevergabe.de (OCDS) und TED, Profile je Bereich, nachvollziehbare Bewertung, Fristen-Countdown, Plattformregistrierungen

**Stand:** fehlt_ganz · **Phase:** 8

*Beleg:* Keine Tabelle `ausschreibung`/`radar_profil` in cse_p5 (144 Tabellen geprüft), kein OCDS-Import, keine Seite. Der Tabeintrag `radar` der Gruppenleiste (tableiste.ts:123) fällt auf die Auffangseite.

*Was fehlt / was stattdessen möglich ist:* Das ist der Baustein, der D-01 ersetzen soll — der legale Weg zu neuen Aufträgen. Er steht in Phase 8 und ist noch nicht angefangen.

#### 2 Login, Rollen, Rechte — 2FA für Admin-Rollen — Zweiter Faktor für `super_admin` und `admin`

**Stand:** TEILWEISE · **Phase:** 1

*Beleg:* Datenbankseite steht: `app.hat_zweiten_faktor`, `app.aal()`, `benutzer_sitzung.aal`, Trigger `benutzer_2fa_pflicht` (drizzle/0007_benutzer_auth.sql:313; D-33).

*Was fehlt / was stattdessen möglich ist:* Kein Enrolment, keine Challenge, keine Oberfläche — das Gate prüft eine Tatsache, die keine Anwendung je herstellt. Hängt vollständig an der fehlenden Anmeldung.

#### 3 Öffentliche Website — Impressum/Datenschutz — Rechtlich bindende Pflichtangaben nach § 5 TMG

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* Commit 52d7c05: die Registernummern im Seed sind erfunden (`HRB 200000`, `DE100000000`); 0097/0098 führen `mandant.angaben_bestaetigt_am` ein, der Auftritt kennzeichnet unbestätigte Angaben (src/server/inhalt/lesen.ts:89). Alle vier Mandanten haben `angaben_bestaetigt_am = NULL`.

*Was fehlt / was stattdessen möglich ist:* Die echten Firmendaten (Anschrift, Telefon, HRB, USt-IdNr., Geschäftsführer — `geschaeftsfuehrer` ist bei allen vier leer) müssen vom Mandanten kommen, sonst darf die Seite nicht online.

#### 10 Angebote, Kalkulation, Auftrag — Leistungskatalog, Kalkulationsmaschine (Σ m² ÷ Leistungswert × Frequenz), Angebots-PDF je Gesellschaft, Angebot → Auftrag

**Stand:** TEILWEISE · **Phase:** 4

*Beleg:* src/server/services/kalkulation/{index,richtzeit,tarif,raumbuch}.ts; `kalkulation` 11, `angebot` 11, `auftrag` 7; Seiten angebote/[id]/kalkulation und /pdf; tests/kern/kalkulation.test.ts, tests/isolation/angebot.test.ts

*Was fehlt / was stattdessen möglich ist:* `leistungskatalog` hat 1 Zeile, `sonderleistung` 0. Tarife und Frequenzen sind ausgewiesene Platzhalter (`istPlatzhalter`, O-Nummern) — ein Angebot rechnet heute mit einem Lohnsatz, den niemand bestätigt hat.

#### 11 Dienstplan — Berliner Feiertage — Feiertage werden aus der Planung ausgenommen

**Stand:** TEILWEISE · **Phase:** 5

*Beleg:* Rechenweg und Tests vorhanden: src/lib/datum/feiertage-berlin.ts, tests/kern/feiertage.test.ts (15 Fälle). Der Generator liest sie aus der Tabelle: src/server/services/dienstplan/generator.ts:186 `from feiertag`.

*Was fehlt / was stattdessen möglich ist:* `feiertag` ist in der migrierten und geseedeten Datenbank LEER, und der in drizzle/0028_dienstplan.sql:149 genannte Job `job:feiertage_pflegen` existiert nicht — src/server/jobs kennt nur `einsaetze_generieren`, `konflikte_erkennen`, `lead_sla_eskalation`. Der Generator plant damit heute am 1. Mai wie an jedem Werktag.

#### 22 XRechnung / ZUGFeRD — XRechnung mit Leitweg-ID, KoSIT-validiert; ZUGFeRD 2.x als PDF/A-3

**Stand:** TEILWEISE · **Phase:** 6

*Beleg:* Nur die Kopffelder existieren: `rechnung.leitweg_id`, `kaeufer_referenz`, `verkaeufer_eadresse(_schema)`, `zahlungsmittel_code` (drizzle/0075_rechnung.sql)

*Was fehlt / was stattdessen möglich ist:* Kein XML-Erzeuger, keine KoSIT-Prüfung in CI, kein PDF/A-3. Ohne das kann an öffentliche Auftraggeber nicht fakturiert werden.

#### 30 Benachrichtigungen — Ereignisse erreichen Menschen, mit Einstellungen je Person und Kanal

**Stand:** TEILWEISE · **Phase:** 9

*Beleg:* `benachrichtigung` + `benachrichtigung_praeferenz`, Register src/server/benachrichtigung/registry.ts (eine Art ohne Vorgabekanal wird beim Registrieren abgelehnt, D-53); Erzeuger nur für Leads und ablaufende Nachweise (services/lead/benachrichtigung.ts, services/nachweis/benachrichtigung.ts)

*Was fehlt / was stattdessen möglich ist:* `benachrichtigung` hat 0 Zeilen. Es gibt KEINEN Versandkanal: kein Mailtransport im Repository (nodemailer/resend/sendgrid/smtp: 0 Treffer), kein Push, kein SMS. Kein Posteingang als Seite — `nachrichten` steht in drei Tableisten und fällt überall auf die Auffangseite. Keine Einstellungsseite.

#### 33 Phasenreihenfolge — Mandant gegen ROADMAP — Zehn Mandantenphasen gegen die elf der Roadmap (0–10)

**Stand:** TEILWEISE · **Phase:** —

*Beleg:* docs/ROADMAP.md gegen die Vorgabe. Deckungsgleich: Mandant 1 = Roadmap 1 (mit vorgeschalteter Phase 0 Analyse/Architektur, die der Mandant ausdrücklich verlangt hat), 2 = 2, 3 = 3, 4 = 4, 5 = 5, 10 = 10. Abweichend: Mandant 6 „KI-Agenten" steht in der Roadmap als Phase 8 HINTER Finanzen und Buchhaltung; Mandant 7 „Finanzen/DATEV" ist in Roadmap 6 (Finanzen) und 7 (Buchhaltung/DATEV) GETEILT; Mandant 8 „Social" und 9 „Benachrichtigungen/Berichte" sind zu Roadmap 9 ZUSAMMENGEZOGEN.

*Was fehlt / was stattdessen möglich ist:* Die Teilung 6/7 ist begründet (D-06, Phase-7-Abnahme „der Steuerberater akzeptiert ein echtes EXTF"). Das Vorziehen der Benachrichtigungen (NOT-01…03 schon in PR 11) ist unschädlich. NICHT als Entscheidung festgehalten ist die Verschiebung der KI-Agenten von Platz 6 auf Platz 8: die Begründung steht nur als Halbsatz in docs/ROADMAP.md:218 („Radar first — the agents operate on its output") und hat keine D-Nummer. Für den Mandanten heisst das: sein Phase-6-Wunsch kommt zwei Phasen später als gedacht.

#### 34 Gesamtstand — nachgezählt — Wo das Projekt heute steht

**Stand:** TEILWEISE · **Phase:** —

*Beleg:* 151 Commits (`git log --oneline main..HEAD | wc -l`). 81 Migrationsdateien in drizzle/, davon 80 in cse_p5 angewandt (`__drizzle_migrations`) — eine Datei ist neuer als die Datenbank. 127 `page.tsx`, davon 6 Auffangseiten; 122 konkrete Seiten bedienen **140 von 432** Manifestrouten (32 %) — je Phase: P1 2/25, P2 16/48, P3 9/30, P4 27/55, P5 81/123, P6 4/42, P7 0/29, P8 0/32, P9 1/46, P10 0/2. 144 Tabellen, 136 mit RLS. Drei Suiten mit zusammen 1.924 `it(`-Fällen in 55 Kern-, 55 Isolations- und 28 Browserdateien; CI (.github/workflows/ci.yml) fährt Wachen, Annahmen-, Katalog- und Manifestprüfung, eslint, tsc, Unit, Isolation gegen echtes Postgres und e2e. 217 offene Mandantenfragen im Abschnitt „Open" von docs/DECISIONS.md, 70 `TODO(client)` im Quelltext, 256 getroffene Entscheidungen.

#### 34 Gesamtstand — was bis zur Inbetriebnahme fehlt — Die fünf Dinge, ohne die die Plattform nicht in Betrieb geht

**Stand:** TEILWEISE · **Phase:** —

*Beleg:* (1) ANMELDUNG: src/server/auth/sitzung.ts:16 — Sitzungen gibt es nur über `/dev/anmelden` hinter `CSE_DEV_FLAECHEN`; ohne PR 20 kommt kein Mitarbeiter und kein Kunde ins System, und 2FA hat nichts, worauf es aufsetzt. (2) JOBSTEUERUNG: es gibt keinen Zeitplan — keine `vercel.json`, supabase/ enthält nur config.toml, „cron" kommt im Repository nicht vor; Schichtgenerator, Konflikterkennung und Lead-Eskalation sind geschrieben und laufen nie, der Kettenlauf ist nicht einmal als Job registriert. (3) AUSGANG: kein Mailtransport im Repository — Angebote, Eingangsbestätigungen, Behinderungsanzeigen und Benachrichtigungen entstehen, aber gehen nicht hinaus; `versand` protokolliert einen Versand, den niemand ausführt. (4) FIRMEN- UND PREISDATEN: alle vier `mandant`-Zeilen tragen erfundene HRB-/USt-Nummern und `angaben_bestaetigt_am = NULL`, `geschaeftsfuehrer` ist leer, Tarife und Leistungswerte sind ausgewiesene Platzhalter, `feiertag` ist leer, `leistungskatalog` hat eine Zeile. (5) RECHNUNGSFÄHIGKEIT: § 14-UStG-Validator, die fünf Abrechnungsarten und die Positionsherkunft liegen auf einem anderen Zweig, XRechnung existiert nur als Kopffeld — bis O-134 (die fünf Abrechnungsarten) beantwortet ist, wird bewusst keine Nummer gezogen.

*Was fehlt / was stattdessen möglich ist:* Dazu als sechster, nicht betriebsverhindernder, aber sicherheitsrelevanter Posten: D-300 — 94 von 99 `SECURITY DEFINER`-Funktionen gehören `postgres` statt `cse_definer` und laufen damit an jeder RLS vorbei; tests/isolation/definer-eigentum.test.ts friert die Altlast ein, repariert ist sie nicht.

#### 12 AI Sales Agent — Firmen finden und anschreiben — Agent, der Unternehmen recherchiert und ihnen personalisierte Nachrichten schickt

**Stand:** WIDERSPRUCH · **Phase:** keine

*Beleg:* D-01 in docs/DECISIONS.md:12 — ausdrücklich ENTFERNT. § 7 UWG verbietet unaufgeforderte elektronische Werbung ohne vorherige ausdrückliche Einwilligung, auch im B2B; Listenaufbau durch Scraping kommt als DSGVO-Problem dazu. Durchgesetzt in src/server/agent/policy.ts (hartes Tor) und tests/isolation/uwg.test.ts.

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN möglich und gebaut: Leads aus den Website-Formularen, Empfehlungen, manuelle CRM-Erfassung — und Ausgang an jeden Kontakt mit hinterlegter `rechtsgrundlage` (Einwilligung, Bestandskunde, eigene Anfrage). Der Vergabe-Radar (Abschnitt 20) ist der legale Ersatz für Neukundenzugang; er ist noch nicht gebaut.

#### 33 Phasenreihenfolge — „Phasen sind sequenziell" — Keine Phase beginnt, bevor die vorige ihre Abnahme erfüllt

**Stand:** WIDERSPRUCH · **Phase:** 1 / 6

*Beleg:* Die eigene Regel am Kopf von docs/ROADMAP.md ist zweifach verletzt, beides bewusst: (a) Phase 6 läuft mit — PR 46 (Rechnungen) liegt in diesem Phase-5-Zweig (0075–0077), PR 47–49 auf `claude/phase-5-dienstplan-zeit`; (b) Phase 1 ist NICHT abgenommen — es gibt keine Anmeldung und kein 2FA, während Phase 5 abgeschlossen gemeldet ist.

*Was fehlt / was stattdessen möglich ist:* (a) ist in DECISIONS unter „PHASE 6, NICHT IN DIESEM ZWEIG" festgehalten und hat einen bekannten Preis: die Migrationsnummern 0085, 0087, 0088 sind auf beiden Zweigen DOPPELT vergeben und 0086 ist reserviert (PHASE-5-STAND „Wo Phase 6 anfaengt"). (b) ist benannt, aber nicht begründet — eine Plattform ohne Login ist keine abgeschlossene Phase 1.

### wichtig

#### 23 Eingangsrechnungen, Zahlungen, Mahnwesen, Rechnungsausgangsbuch — Belegerfassung, Zahlungsabgleich, Mahnstufen, Ausgangsbuch

**Stand:** fehlt_ganz · **Phase:** 6

*Beleg:* Keine Tabellen `eingangsrechnung`, `zahlung`, `mahnung`; „mahnung" kommt nur als Rechteschlüssel und als Gate-Aktion vor (src/server/agent/policy.ts, katalog.generiert.ts)

#### 28 Social Media Center — Beiträge entwerfen, freigeben, planen, auf die Profile und nach aussen veröffentlichen

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* Keine Tabelle `social_post`/`beitrag`, kein Dienst, keine Seite; „instagram"/„linkedin" nur je ein Treffer in Dokumentation bzw. Integrationsliste. Die Gate-Aktion `social_veroeffentlichen` existiert in policy.ts — mehr nicht.

*Was fehlt / was stattdessen möglich ist:* Damit ist auch PRO-04 („Beiträge kommen aus dem Social Media Center") auf den Profilseiten leer.

#### 29 Recruiting — Stellenanzeigen, Bewerbungseingang, Lebenslauf-Auswertung, Ranking, Terminplanung, DSGVO-Löschung

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* Keine Tabelle `stelle`/`bewerbung`; „bewerbung" nur als Rechteschlüssel und Gate-Aktion. Die fünf `/karriere*`-Routen des Manifests haben keine Seite.

#### 1 Unternehmensstruktur — Gruppenansicht — Gruppenansicht aggregiert alle Bereiche, ausschliesslich lesend

**Stand:** TEILWEISE · **Phase:** 6-9

*Beleg:* src/app/portal/gruppe/page.tsx (withGroupScope liefert `LeseKontext`, Schreiben ist Compilerfehler — D-41); tests/isolation/gruppenansicht.test.ts

*Was fehlt / was stattdessen möglich ist:* Nur die Übersichtsseite existiert. Die vier Tabziele der Gruppenleiste — `gruppe/finanzen`, `gruppe/auftraege`, `gruppe/radar`, `gruppe/berichte` (src/server/registry/tableiste.ts:120-124) — landen auf der Auffangseite `portal/gruppe/[...rest]/page.tsx` und sagen „noch nicht gebaut".

#### 2 Login, Rollen, Rechte — Rechtemodell — Fünf Rollen mit konfigurierbaren Rechten, in der Oberfläche editierbar

**Stand:** TEILWEISE · **Phase:** 8

*Beleg:* `rolle` 7 Zeilen, `berechtigung` 242, `rolle_berechtigung` 532; Katalog wird aus dem Architekturdokument ERZEUGT (src/server/auth/katalog.generiert.ts, D-36); `app.hat_recht` durchgehend geprüft.

*Was fehlt / was stattdessen möglich ist:* Kein Editor: der Navigationspunkt `einstellungen` steht in tests/kern/tableiste.test.ts:214 ausdrücklich auf der Liste NUR_AUFFANGSEITE. Rechte ändert man heute nur per SQL.

#### 3 Öffentliche Website — Alle Seiten aus der Datenbank, deutsch und englisch, responsiv, ohne Tracker

**Stand:** TEILWEISE · **Phase:** 2 / 9

*Beleg:* `seite` 26 Zeilen (13 de + 13 en), `abschnitt` 64; src/app/(public)/[seite]/page.tsx und /en/[seite]; tests/e2e/website.spec.ts, sprachen.spec.ts, a11y.spec.ts, seo.spec.ts; JSON-LD in tests/kern/jsonld.test.ts

*Was fehlt / was stattdessen möglich ist:* `/karriere*` (5 Routen des Manifests) fehlt — Phase 9. Die Inhalte pflegt niemand über eine Oberfläche: sie kommen aus scripts/content-import.ts, ein Redaktionsbereich existiert nicht. Bilder: `medien` 0 Zeilen, nur Platzhalterszenen.

#### 4 Unternehmensprofile (Instagram-artig) — Profil je Bereich mit Logo, Cover, Leistungen, Bildern, Projekten, Beiträgen

**Stand:** TEILWEISE · **Phase:** 2

*Beleg:* `unternehmensprofil` 8 Zeilen, src/app/(public)/unternehmen/[bereich]/page.tsx, tests/isolation/profil.test.ts

*Was fehlt / was stattdessen möglich ist:* Von den 14 Profil-Unterrouten des Manifests (galerie, projekte, beitraege, news, kontakt, unternehmensdaten je Bereich) ist nur die Profilwurzel gebaut. `referenz` hat **0 Zeilen** — PRO-05 („Referenz = abgeschlossener Auftrag mit Kundenfreigabe") ist als Tabelle da, aber nie gefüllt und nirgends sichtbar.

#### 6 Dashboards je Rolle — Super-Admin-, Admin-, Leitungs-, Mitarbeiter- und Kundendashboard, jede Zahl verlinkt

**Stand:** TEILWEISE · **Phase:** 3 / 6

*Beleg:* src/app/portal/[mandant]/page.tsx — eine Route, Kacheln nach Recht gefiltert; 12 Kacheln in src/server/services/bericht/kacheln.ts (Leads, SLA, Personen, Anstellungen, unbesetzte Schichten, Konflikte, Anträge, Abwesende, abgelaufene Nachweise); tests/isolation/kennzahlen.test.ts

*Was fehlt / was stattdessen möglich ist:* Keine einzige Finanzkachel (Umsatz, offene Posten, Forderungen) — DSH-02 ist damit leer. Das Kundendashboard zeigt heute nur einen Zugangshinweis.

#### 7 Kundenportal — Eigene Projekte, Aufträge, Angebote, Rechnungen, Dokumente, Nachrichten

**Stand:** TEILWEISE · **Phase:** 3

*Beleg:* src/app/portal/kunde/page.tsx; `kunde_zugang` 1 Zeile im Seed; Scope `kunde` in allen vier Lesewegen (D-14)

*Was fehlt / was stattdessen möglich ist:* Die vier Tabziele der Kundenleiste (auftraege, rechnungen, nachweise, nachrichten — tableiste.ts:108-111) haben keine Seite und fallen auf die Auffangseite.

#### 25 Dokumentenverwaltung — Zentrale Ablage mit Kategorien, Versionen, Aufbewahrung, Löschsperre, signierte Adressen

**Stand:** TEILWEISE · **Phase:** 7 (PR 58)

*Beleg:* `dokument`, `dokument_version`, `dokument_aufbewahrung`; src/server/services/dokument/{upload,pdf,kategorie}.ts; src/server/storage/adapter.ts (nur private Buckets, Supabase-Speicher wirft ohne Zugangsdaten `NichtVerbundenFehler`); tests/isolation/dokument.test.ts, tests/kern/loeschsperre.test.ts

*Was fehlt / was stattdessen möglich ist:* Kein Bildschirm: `dokumente` steht in tests/kern/tableiste.test.ts:214 auf der Liste NUR_AUFFANGSEITE. `dokument` hat 0 Zeilen im Seed. Der Speicher ist nicht verbunden.

#### 31 Berichte und Auswertungen — Umsatz, Kosten, Ergebnis, Aufträge, Leads, Conversion, Kanalattribution, Mitarbeitende, Projekte, Vergabe-Pipeline

**Stand:** TEILWEISE · **Phase:** 9

*Beleg:* src/server/services/bericht/ enthält nur dashboard.ts und kacheln.ts — 12 operative Kacheln

*Was fehlt / was stattdessen möglich ist:* Keiner der sieben REP-Berichte existiert als Auswertung oder Export; der Tabeintrag `berichte` der Gruppenleiste fällt auf die Auffangseite.

#### 32 Lohnabrechnung, Jahresabschluss, E-Bilanz, Steuererklärung — Abrechnung und Abschluss in der Plattform

**Stand:** WIDERSPRUCH · **Phase:** 7

*Beleg:* D-06: drei Branchentarife plus SOKA-Bau machen Lohn zur Spezialsoftware; Abschluss und E-Bilanz gehören dem Steuerberater.

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN: die Plattform BEREITET VOR und exportiert — Zeitdaten je Anstellung, § 17 MiLoG-Aufzeichnung, später DATEV-Export. Der Lohnzeit-Export selbst steht noch aus (Phase 7).

### klein

#### 32 Zentraler Kalender mit iCal-Feed — Termine aller Bereiche in einem Kalender, abonnierbar

**Stand:** fehlt_ganz · **Phase:** 9

*Beleg:* Kein iCal/VCALENDAR im Quelltext, keine Tabelle, keine Seite (die „kalender"-Treffer sind Kalenderwoche/Kalendertag in der Zeitrechnung)

#### 13 Acht KI-Agenten (Operations, Analytics, Social, Support …) — Acht Agenten mit eigenen Aufgaben

**Stand:** WIDERSPRUCH · **Phase:** 8

*Beleg:* D-03: auf VIER zusammengelegt (CEO-Assistent, Akquise, Backoffice, Finanzen) — die übrigen vier waren dieselbe Maschinerie unter anderem Namen; docs/SPEC.md:432

*Was fehlt / was stattdessen möglich ist:* Kein Einwand gegen das Ziel, nur gegen die Zahl. Gebaut ist von den vieren bisher keiner.

#### 27 Automatische Einreichung auf Vergabeplattformen — Angebote automatisch auf die Plattform hochladen

**Stand:** WIDERSPRUCH · **Phase:** 8

*Beleg:* D-07: die deutschen Vergabeplattformen bieten bewusst keine Einreichungs-API, Konten hängen an natürlichen Personen, teils mit qualifizierter Signatur.

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN: der Agent stellt die vollständige Angebotsmappe zusammen und weist Lücken aus; ein Mensch lädt hoch. Beides ist noch nicht gebaut (Phase 8).

#### 29 Recruiting — Scraping von Indeed/StepStone — Kandidaten von Jobbörsen automatisch abziehen

**Stand:** WIDERSPRUCH · **Phase:** 9

*Beleg:* D-02: AGB-Verstoss der Portale plus DSGVO-Risiko über Bewerberdaten.

*Was fehlt / was stattdessen möglich ist:* STATTDESSEN: Recruiting arbeitet auf EINGEHENDEN Bewerbungen; eine Veröffentlichung auf einem Portal geht nur über dessen echte API mit echten Zugangsdaten. Noch nicht gebaut.

---

## Behauptungen, die der Gegenprobe nicht standhielten

Diese Punkte galten als „gebaut" und sind es nur eingeschränkt. Sie stehen hier,
damit niemand sie ein zweites Mal für erledigt hält.

#### 2 Oeffentlicher Auftritt — Angebot anfragen — Auswahlseite + vier Formulare

**Wirklich:** teilweise

Was die Behauptung richtig sagt: die Auswahlseite existiert (src/app/(public)/angebot/page.tsx:28 -> Auswahl.tsx:21, echte Karten aus `mandant`, kein NochNichtGebaut), sie ist verlinkt (OeffentlicheShell.tsx:173 und :210, Kontaktwege.tsx:110), die vier Formularseiten rendern echte Felder aus der veroeffentlichten Definition (Angebot.tsx:27-39, :84), und die DB traegt vier veroeffentlichte Zeilen (formular_definition: angebot_reinigung/security/bau/operations, veroeffentlicht_am gesetzt, zurueckgezogen_am null). Die Feldmengen decken REQ-02 (gebaeudetyp, flaeche_qm, anzahl_objekte, frequenz, wunsch_start), REQ-03 (anlass, einsatz_von, einsatz_bis, erwartete_besucher, anzahl_kraefte, veranstaltungsort) und REQ-04 (gewerk, volumen, fertigstellung_bis, lv_datei) tatsaechlich ab.

WARUM TROTZDEM NICHT "GEBAUT":

1. Der Mensch landet nach dem Absenden auf rohem JSON. AnfrageFormular.tsx:156-163 ist ein reines `<form method="post" action="/api/anfrage">`; die Komponente hat kein `use client`, keinen onSubmit, keinen fetch (grep "use client" in src/components/oeffentlich/ und src/app/(public)/angebot/: null Treffer). src/app/api/anfrage/route.ts antwortet in JEDEM Zweig `NextResponse.json(...)` (Zeile 43, 86, 297) — kein 303, keine Weiterleitung, keine Content-Negotiation. Der Browser navigiert also nach /api/anfrage und zeigt `{"ok":true,"meldung":...,"leadnummer":...}`. Die im Manifest zugesagte Danke-Seite /angebot/[bereich]/danke (routen.generiert.ts:43, spec REQ-05/REQ-06) existiert im Dateisystem NICHT — unter src/app/(public)/angebot liegen nur page.tsx, Auswahl.tsx, [bereich]/page.tsx, [bereich]/Angebot.tsx; kein Catch-all deckt sie. Das Repo gibt es selbst zu: tests/kern/routen-manifest.test.ts:361-363 fuehrt '/angebot/[bereich]/danke' in der eingefrorenen Offen-Liste mit dem Kommentar "Die Annahme antwortet heute JSON (PR 17); eine eigene Seite ist der Weg fuer ein Formular ohne JavaScript."

2. Ein Eingabefehler verliert alles. /api/anfrage gibt bei FormularFehler 400 als JSON zurueck (route.ts:309-321). AnfrageFormular hat zwar Props `fehler` und `meldung` (AnfrageFormular.tsx:27-28, :149-154, :122-124), aber KEIN Aufrufer uebergibt sie: einziger Nutzungsort ist Angebot.tsx:85-87 mit bereich/titel/felder/sprache. Die Fehleranzeige ist toter Code; wer ein Pflichtfeld vergisst, sieht JSON und muss alles neu tippen.

3. Der Pruefpunkt prueft die Sache nicht. tests/e2e/angebot.spec.ts:47-51 wartet auf die POST-Antwort und prueft Status 200, danach `page.goto('/dev/leads')` (Zeile 55). Der Test sieht nie, was dem Menschen danach im Browser steht — er wiederholt den Irrtum des Codes. Belegt ist "die API nimmt an und legt einen Lead an", nicht "das Formular ist benutzbar". Zudem ist /dev/leads eine Dev-Seite (src/app/dev/leads/page.tsx); die echte Ansicht waere /portal/[mandant]/crm/leads.

4. REQ-04 (LV-Upload) ist heute nicht benutzbar und sagt es dem Kunden nicht. Ohne SUPABASE_URL/SERVICE_ROLE_KEY wirft SupabaseSpeicher NichtVerbundenFehler (src/server/storage/adapter.ts:60-72); route.ts:306-308 macht daraus 503. Der eigene e2e-Test bestaetigt das (angebot.spec.ts:102-123). Ehrlich im Sinne von CLAUDE.md "keine Schein-Integrationen", aber das Feld traegt in der Definition nur den Hilfetext "PDF oder XLSX, bis 20 MB" und keinen "nicht verbunden"-Hinweis — ein Bauinteressent mit LV verliert seine ganze Anfrage auf einer JSON-Seite.

Nebenbefund (Doku-Lage, kein Widerspruch): docs/DECISIONS.md:1196-1199 behauptet weiterhin "CSE Operations hat kein Formular (O-61)" und "/anfrage/operations ist 404" — die DB widerlegt das; O-61 und O-62 stehen zugleich noch als offene Fragen (DECISIONS.md:2835-2836). Die Platzhalter sind nicht mehr im Label gekennzeichnet, sondern gebuendelt (src/server/db/seed/formulare.ts:15-18 TODO(client), :27-33) — vertretbar, aber die vierte Feldmenge ist eine abgeleitete Annahme, kein bestaetigter Auftragsinhalt.

Kein Verstoss gegen die Out-of-scope-Regeln in diesem Abschnitt: Pflicht-Bestaetigung `datenschutz_hinweis` und freiwillige `einwilligung_werbung` sind getrennt (DECISIONS.md:1203-1208, § 7 UWG / Art. 6 DSGVO), der Honigtopf ersetzt ein CAPTCHA (AnfrageFormular.tsx:194-208).

Richtiger Stand: TEILWEISE — Auswahlseite und vier Formulare stehen und rendern, der Weg danach (Bestaetigungsseite, Fehlerrueckgabe ins Formular, LV-Upload) fehlt.

#### 2 Oeffentlicher Auftritt — Inhalte kommen aus der Datenbank, nicht aus dem Quelltext (PUB-07)

**Wirklich:** teilweise

Der Lesepfad stimmt, die Behauptung in ihrer Allgemeinheit nicht.

BESTAETIGT (der Kern): Der Weg Seite -> Datenbank ist vollstaendig und ohne Attrappe. src/app/(public)/page.tsx, [seite]/page.tsx, unternehmen/[bereich]/page.tsx und die vier en/-Dateien rufen alle OeffentlicheSeite (src/app/(public)/OeffentlicheSeite.tsx:20) -> seitenDaten (src/server/inhalt/seiten-daten.ts:52) -> ladeSeite (src/server/services/inhalt/seite.ts:51, ein select auf seite/abschnitt/medien mit status='veroeffentlicht'). Kein NochNichtGebaut im (public)-Baum (das Modul existiert nur fuer src/app/portal/unterseite.tsx). Auch Titel/description/canonical kommen aus derselben Zeile (src/app/(public)/metadaten.ts:26). DB bestaetigt 26 Zeilen, 13 de + 13 en, alle 'veroeffentlicht', jede mit 2-4 abschnitt-Zeilen.

WIDERLEGT 1 - Inhalt liegt in der Datenbank und erreicht den Menschen trotzdem nicht. Sechs abschnitt-Zeilen (/unternehmen/reinigung, /security, /bau, je de+en) haben art='leistungen' und tragen in daten sowohl leistungen ALS AUCH faq. src/components/oeffentlich/Abschnitte.tsx:139 leitet art='leistungen' an die Komponente Leistungen (Zeile 72) weiter, und die liest nur leistungenAus(a.daten); faqAus wird ausschliesslich im Text-Zweig (Zeile 53) benutzt. Die gepflegten Fragen ("Was brauchen Sie fuer ein Angebot?", "Arbeiten Sie nach VOB?", "§ 34a GewO") stehen also auf keiner Seite. Gleichzeitig erzeugt seiten-daten.ts:98-100 fuer genau diese Seiten einen FAQPage-JSON-LD-Block aus denselben Daten: die Suchmaschine bekommt Frage/Antwort, der Besucher nicht — was der Sichtbarkeitsanforderung fuer FAQ-Markup zuwiderlaeuft. Keine Pruefung faengt das: in tests/e2e kommt "faq" kein einziges Mal vor, tests/kern/jsonld.test.ts prueft nur die Form von faqPage()/faqAus() — die Pruefung wiederholt den Irrtum des Codes, statt ihn zu treffen.

WIDERLEGT 2 - "nicht aus dem Quelltext" gilt nicht fuer alle oeffentlichen Seiten. /barrierefreiheit und /en/barrierefreiheit rendern ihren gesamten Fliesstext aus BARRIERE_TEXTE in src/lib/i18n/texte.ts:154 (src/app/(public)/barrierefreiheit/Erklaerung.tsx:4) — begruendet und dokumentiert (LEG-07/PUB-09, O-205 offen), aber es ist Quelltext. Ebenso /angebot und /en/angebot (AUSWAHL_TEXTE, texte.ts:300) und die Shell mit SHELL_TEXTE plus den fest verdrahteten Navigationslisten HAUPT/RECHTLICH (src/components/oeffentlich/OeffentlicheShell.tsx:29-41). Diese Pfade haben keine seite-Zeile: 13 Routen in OEFFENTLICHE_ROUTEN, /barrierefreiheit und /angebot* stehen nicht darin.

WIDERLEGT 3 - der Weg des Menschen fehlt. Es gibt keine Redaktionsoberflaeche: kein page.tsx unter src/app, das seite/abschnitt schreibt (Suche nach inhalt/redakt/cms liefert nur die beiden [seite]-Sammler). Der einzige Aenderungsweg ist heute: Literale in src/server/db/seed/inhalt.ts bzw. inhalt-en.ts aendern und scripts/content-import.ts (pnpm content:import) laufen lassen — also ein Quelltexteingriff plus Skript. Der Kommentar in src/app/(public)/layout.tsx:16 ("ein Textwechsel ist ein UPDATE und kein Deployment") gilt fuer den Lesepfad, nicht fuer den Arbeitsablauf. Der Test tests/isolation/inhalt.test.ts:35 belegt genau diesen halben Sachverhalt: er macht ein UPDATE per SQL und ruft ladeSeite — er prueft den Dienst, nicht eine gerenderte Seite und keine Redaktion.

WIDERLEGT 4 - zwei der 13 Seiten tragen nur Platzhalterzeilen: /news = "Noch keine Beitraege", /projekte = "Hier stehen bald Referenzen" (DB-Abfrage abschnitt). Aus der Datenbank, ja — aber es gibt kein News-/referenz-Modul, das sie fuellt.

Kein Widerspruch zu "Out of scope" in diesem Abschnitt: die oeffentlichen Seiten enthalten kein Newsletter-/Opt-in-Feld und keinen Kontaktabgriff (grep auf newsletter/einwilligung/opt-in im (public)-Baum: leer), also keine § 7-UWG-Flaeche; /angebot ist rein eingehend.

Fazit: GEBAUT ist der datenbankgespeiste Lesepfad fuer 13 Routen in zwei Sprachen. TEILWEISE ist der Satz "Inhalte kommen aus der Datenbank, nicht aus dem Quelltext": drei oeffentliche Seitentypen und die gesamte Shell kommen aus texte.ts, sechs gepflegte FAQ-Bloecke werden verschluckt und stattdessen nur als Markup ausgeliefert, und pflegen kann den Inhalt heute niemand ohne Quelltextzugriff.

#### 30 Gestaltung — Bilderfrage: wo werden die neun SVG benutzt — Verwendungsstellen der Platzhalterbilder

**Wirklich:** teilweise

Die Behauptung haelt nicht stand. Sie nennt die falsche Funktion, falsche Zeilen, die falsche Anzahl — und beantwortet die gestellte Frage („wo werden die SVG benutzt") gerade nicht.

1) FALSCHE FUNKTION. Keine der beiden Stellen ruft `platzhalterBild`. Beide rufen `bildFuerMotiv` aus /home/user/phase5-e2e/src/server/inhalt/bilder.ts:89 — und das ist eine DREIstufige Aufloesung, nicht „setzt platzhalterBild": Stufe 1 `abschnitt.medium` (Abschnitte.tsx:47-49), Stufe 2 eine Datei `public/bilder/<motiv>.{avif,webp,jpg,jpeg,png}` (bilder.ts:47-61), erst Stufe 3 `platzhalterBild(motiv)` (bilder.ts:91). Das SVG ist der letzte Ausweg, nicht das, was die Aufrufstelle setzt. Der Unterschied ist nicht kosmetisch: liegt eine Datei in `public/bilder/`, kommt `platzhalter: false` zurueck (bilder.ts:92) und die sichtbare Kennzeichnung in Hero.tsx:57 bzw. MarkenKarte.tsx:70 verschwindet. `public/bilder/` enthaelt heute nur LIESMICH.md — deshalb faellt es nicht auf.

2) ALLE ZEILENANGABEN FALSCH. `bildVon` steht in src/components/oeffentlich/Abschnitte.tsx:46 (nicht 34), der MarkenKarte-Aufruf in Zeile 137 (nicht 122), `motivFuerPfad` in Zeile 28 (nicht 27). Das Register `PLATZHALTER_MOTIVE` steht in src/lib/placeholder-assets.ts:108-117; die genannten Zeilen 88-97 sind Kommentartext.

3) ES SIND ACHT, NICHT NEUN. `find public -name '*.svg'` liefert genau acht Dateien unter public/platzhalter/ (bau, hero, objekt, operations, projekt, reinigung, security, team), erzeugt von scripts/platzhalter-motive.py:878-881 (`SZENEN`, acht Schluessel). Das Register hat acht Eintraege.

4) DER EIGENTLICHE BEFUND, DEN DIE BEHAUPTUNG VERDECKT: drei der acht SVG werden NIRGENDS benutzt. `objekt.svg`, `projekt.svg`, `team.svg` kommen ausserhalb des Registers (placeholder-assets.ts:114-116) in keiner Datei vor. Beweisweg: die zwei Aufrufstellen koennen diese Motive gar nicht erzeugen. Zeile 137 uebergibt `motivFuerBereich(b.bereich)`, und `b.bereich` ist `BereichSchluessel` (OeffentlicheShell.tsx:17) = Schluessel von `FARBEN_BEREICH` in src/lib/design/theme.ts:208 — genau vier: reinigung, security, bau, operations. Zeile 120 uebergibt `motivFuerPfad(seite.pfad)`, das entweder dieselben vier oder `gruppe` liefert (Abschnitte.tsx:28-31). Erreichbar sind also fuenf Motive; drei SVG sind tote Dateien. „Genau zwei Aufrufstellen" als vollstaendige Antwort auf „wo werden die SVG benutzt" ist damit die falsche Antwort.

5) ZUSAETZLICH TOT: `PLATZHALTER_BILD` (placeholder-assets.ts:80-84) hat keinen einzigen Konsumenten im ganzen Repo — grep ueber *.ts/*.tsx findet nur die Definition.

6) DIE PRUEFUNG WIEDERHOLT DEN IRRTUM. Einzige Pruefung ist tests/e2e/website.spec.ts:93-98: sie laedt nur `/` und zaehlt `[data-cse="platzhalter-marke"] > 0`. Sie prueft kein Motiv, besucht keine `/unternehmen/*`-Seite und bemerkt die drei unbenutzten SVG nicht. Sie belegt also nur, dass IRGENDEIN Platzhalter markiert ist.

7) EIN MANGEL, DEN DIE BEHAUPTUNG ALS RICHTIG DARSTELLT: dass Zeile 137 „OHNE ueberhaupt nach einem Medium zu fragen" setzt, ist zwar zutreffend beschrieben, aber es ist ein Defekt, kein Merkmal — ein `markenkarten`-Abschnitt mit gepflegtem `medien_id` wuerde weiterhin den Platzhalter zeigen. Nicht auffaellig, weil im Seed jede Zeile `medien_id` NULL traegt (Abfrage auf cse_p5: alle abschnitt-Zeilen, de und en, medien_id leer).

WAS TATSAECHLICH STEHT: Der menschliche Weg existiert. src/app/(public)/page.tsx und (public)/[seite]/page.tsx bzw. (public)/unternehmen/[bereich]/page.tsx rendern ueber OeffentlicheSeite.tsx:28 die `Abschnitte`; der Seed traegt hero-Abschnitte fuer /, /impressum, /kontakt, /leistungen, /news, /projekte, /ueber-uns, /unternehmen und /unternehmen/{bau,operations,reinigung,security} in de und en. Fuenf der acht SVG sind heute sichtbar, markiert (Hero.tsx:57, MarkenKarte.tsx:70), im Einklang mit DESIGN §4.1/§4.2 und O-13. Drei sind es nicht. Damit: TEILWEISE.

Kein Widerspruch zu „Out of scope" (Kaltakquise, Scraping, Lohnabrechnung, automatische Vergabe-Einreichung) in diesem Abschnitt — die Bilderfrage beruehrt keine dieser Grenzen.

#### 5 Fuenf Rollen — SUPER ADMIN, ADMIN, LEITUNG, MITARBEITER, KUNDE existieren als Datensaetze, je mit Portal, Geltungsbereich und 2FA-Pflicht.

**Wirklich:** teilweise

Die Datensaetze stimmen, der Weg des Menschen nicht. (1) Falscher Beleg: drizzle/0001_rollen_und_mandant.sql enthaelt weder die Tabelle rolle noch einen Rollen-Insert — es legt sechs Postgres-Cluster-Rollen (cse_migrator, cse_definer, cse_app, cse_anon, cse_checkin, cse_job) und die Tabelle mandant an. Tabelle und die fuenf Zeilen stehen in drizzle/0007_benutzer_auth.sql:109 bzw. :136. (2) Es gibt keine Anmeldung: src/app/auth/ enthaelt genau eine Datei (bereich/page.tsx). /auth/login und die drei /auth/zwei-faktor/*-Routen sind Phase-1-Zeilen des Manifests ohne page.tsx und ohne Catch-all unter /auth — also hartes 404. Der einzige Sitzungsweg ist src/app/dev/anmelden/page.tsx hinter CSE_DEV_FLAECHEN, und devSitzungAusstellen (src/server/auth/sitzung.ts:173) schreibt aal fest auf 'aal2'. Die behauptete 2FA-Pflicht ist damit fuer keinen Menschen ausloesbar: der einzige Sitzungsaussteller vergibt aal2 ohne Faktor. src/app/portal/Anmeldung.tsx:10 sagt es selbst ('kommt mit PR 20'); Aufgabe 2 der Liste ist offen. (3) Keine Rollenverwaltung: ROADMAP Phase 1 verlangt 'Five roles with configurable permissions, editable in the UI'. /portal/[mandant]/einstellungen/rollen und /einstellungen/benutzer stehen als Phase-1-Zeilen im Manifest (routen.generiert.ts:349-352), ein Verzeichnis src/app/portal/[mandant]/einstellungen existiert nicht, ebenso keine API-Route und kein Dienst in src/server/services/. Beide fallen ueber [...rest] auf NochNichtGebaut. Rollen werden ausschliesslich in src/server/db/seed/index.ts zugewiesen; auch die beiden Vergabeseiten personal/personen/[id]/zugang und crm/kunden/[id]/zugang (Phase 3) fehlen. (4) KUNDE hat Rolle und Seed-Konto (kunde.demo@example.test, eine kunde_zugang-Zeile), aber als Portal nur src/app/portal/kunde/page.tsx; von 19 Manifestzeilen (423-441) sind 18 NochNichtGebaut, darunter Phase-3-Zeilen (auftraege, projekte, nachrichten), und die eine gebaute Seite zeigt entweder 'kein Kundenzugang hinterlegt' oder den Platzhaltersatz 'Ihre Auftraege, Rechnungen und Nachweise erscheinen hier.'. Richtig gebaut ist dagegen MITARBEITER (src/app/portal/mein/**) und der interne Bereich (127 page.tsx). Substanz: Zeilen, Portalspalte, Geltungsbereich, RLS-Policy und die doppelte 2FA-Wache (Trigger kern.benutzer_2fa_pflicht in 0007:578, Gate in 0008:901) existieren wirklich — aber Anmeldung, 2FA-Einrichtung und Rollenpflege fehlen, also kann heute niemand ausserhalb des Dev-Schalters eine dieser Rollen benutzen oder vergeben. Das ist TEILWEISE, nicht GEBAUT.

#### 7 LEITUNG — nur der zugewiesene Bereich — Die Bereichsdecke haelt und ist bewiesen.

**Wirklich:** teilweise

Die Decke selbst konnte ich nicht brechen — der BEWEIS, den die Behauptung anführt, trägt aber nicht, und der Abschnitt als Ganzes ist nicht gebaut.

WAS HÄLT (konzediert, dreifach belegt):
1. Slug-Wache: alle 86 page.tsx unter src/app/portal/[mandant]/ rufen slugTor auf (geprüft, keine Ausnahme), und keine ruft sie nach einem db().begin — die Wache steht vor jeder Abfrage. Die 216 nicht gebauten Manifestrouten laufen über src/app/portal/[mandant]/[...rest]/page.tsx → MandantUnterseite → ebenfalls slugTor.
2. app.mandant_fuer_wechsel → app.switcher_mandanten() prüft Mitgliedschaft in benutzer_mandant; POST /api/sitzung/mandant ist der einzige Schreiber, Origin-geprüft, 404 statt 403.
3. Der Trigger kern.sitzung_mandant_pruefen auf benutzer_sitzung feuert BEFORE INSERT OR UPDATE und wirft insufficient_privilege (TEN-04) — selbst die Dev-Anmeldung (src/app/dev/anmelden/page.tsx, devSitzungAusstellen fügt benutzerId/mandantId ungeprüft ein) kann leitung.bau nicht an security binden. Seed: leitung.bau@cse-gruppe.de hat genau eine Zeile, mandant bau. darf_gruppenansicht() verlangt >= 2 Mitgliedschaften, also auch kein Ausweg über /portal/gruppe. 608 Policies stimmt (602 public + 6 zeit_intern).

WAS NICHT HÄLT:
A) „tests/isolation/rollen.test.ts läuft über alle 432 Manifestzeilen" beweist die Slug-Wache NICHT. pruefeZugang liest den [mandant]-Pfadabschnitt nie an: src/server/auth/zugang.ts:159 `const mandantId = sitzung.aktiverMandantId;` — danach nur hatRecht(schluessel, mandantId). Die Testhilfe konkret() (tests/isolation/rollen.test.ts:101) setzt den Slug zwar in den Pfad, für die Entscheidung ist er dekorativ. Die einzige Stelle, die den fremden Bereich anspricht (Zeilen 204–207), tauscht die SITZUNG (`...leitungBau(), aktiverMandantId: ids.get('security')`), nicht den Pfad — sie prüft K-03 (Recht je Mandant), nicht die Decke. Für eine bau-Sitzung auf /portal/security/auftraege antwortet pruefeZugang „erlaubt"; nur slugTor hält sie auf. Und slugTor kommt in tests/ kein einziges Mal vor (grep über tests/: kein Treffer). Die 432 Zeilen wiederholen also genau den Irrtum, den die Behauptung als Beweis anführt.

B) Die Decke ist 86 Handkopien ohne strukturelle Zusage. eslint-rules/ enthält nur no-client-clock.js, no-float-money.js, no-raw-color.js — keine Regel, die slugTor erzwingt; kein Test zählt die page.tsx-Dateien ab. Seite 87 vergisst sie lautlos, und alle genannten Prüfungen bleiben grün, weil keine den Slug prüft.

C) Der e2e-Beleg ist eine einzige Zusage auf der WURZEL. tests/e2e/portal-rollen.spec.ts:100 holt `/portal/security` — nicht einen einzigen tiefen gebauten Pfad (z. B. /portal/security/finanzen/rechnungen, /portal/security/personal/personen). Für 85 weitere gebaute Seiten gibt es keine Zusage.

D) Abschnitt 7 ist inhaltlich nicht gebaut. SPEC.md:111 definiert Leitung als „own business area only: employees, schedules, projects, orders, customers, tasks, approvals". Von 301 /portal/[mandant]/…-Routen im Manifest haben 85 eine echte page.tsx; 216 rendern NochNichtGebaut. Es fehlen komplett: /portal/[mandant]/freigaben samt [id], /einspruch, /rueckgaengig, /erledigt, /laufend, /pruefdauer, /stapel (approvals — das Kerngeschäft der Leitung), /portal/[mandant]/aufgaben und /aufgaben/[id] (tasks), /zeiten/freigabe, /portal/[mandant]/bau/projekte/[id] (die Projektseite selbst — nur Liste und Unterseiten stehen), /personal/anstellungen/[id] mit entgelt/vertrag/beenden, /dienstplan/veroeffentlichung, /dienstplan/offene-schichten. docs/ROADMAP.md:116 führt „Admin, Leitung, Employee, Customer dashboards, each scoped" weiter als `- [ ]`.

E) Nebenbefund: freigabe_kette hat relrowsecurity=t und relforcerowsecurity=t, aber NULL Policies (pg_policies) — fail-closed, aber die Tabelle ist damit für cse_app unlesbar; sie zählt zu den „608" nicht mit.

Fazit: die Bereichsdecke greift heute, aber sie ist nicht bewiesen, sondern an 86 Stellen von Hand wiederholt und an genau einer Adresse geprüft; und „nur der zugewiesene Bereich" ist als Abschnitt teilweise gebaut — die Decke steht, der Raum darunter zu gut zwei Dritteln nicht.

WIDERSPRUCH (ausdrücklich mitgeprüft, hier nicht verletzt): in diesem Abschnitt wird nichts gebaut, was CLAUDE.md „Out of scope" untersagt — keine Kaltakquise an gescrapte Kontakte (§ 7 UWG), kein Indeed/StepStone-Scraping, keine Lohnabrechnung/Jahresabschluss/E-Bilanz, keine automatische Vergabe-Einreichung. tests/isolation/uwg.test.ts existiert als Wache dafür.

#### 29 Autorisierung AUF DER DATENBANK — Die zweite Linie ist vollstaendig und die Rechtefrage wird von derselben Funktion beantwortet wie in der Anwendung.

**Wirklich:** teilweise

BESTAETIGT (alle Zahlen stimmen, nachgemessen):
- 136/137 public-Tabellen rowsecurity, einzige ohne: __drizzle_migrations. 136/136 davon relforcerowsecurity.
- 608 Policies (602 public + 6 zeit_intern). 125 davon RESTRICTIVE.
- pg_roles: nur postgres traegt rolbypassrls; cse_migrator/definer/app/anon/checkin/job existieren, alle ohne BYPASSRLS.
- app.hat_recht(text,uuid) ist SECURITY DEFINER, SET search_path = pg_catalog, public, app. Die Pruefreihenfolge im Funktionskoerper entspricht der Behauptung wortgenau (unbekannter Schluessel -> false; erfordert_2fa vs app.aal(); Gruppenansicht nur lesen/exportieren; globale Rolle ohne Zuweisungszeile; nur_global; Mitgliedschaftsrolle geschnitten mit bm.module; mandantenspezifisch vor Plattform-Vorgabe).
- Die Anwendung fragt wirklich dieselbe Funktion: src/server/auth/zugang.ts, rechtepruefer() setzt `select app.hat_recht($1,$2::uuid)` bzw. gegen app.sichtbare_mandanten(); und sie laeuft entrechtet — src/server/kontext/index.ts:61 `set local role cse_app`.

WIDERLEGT wird das Wort "vollstaendig" und der 2FA-Teilsatz:

1) Der erfordert_2fa-Zweig ist im ausgelieferten Katalog TOT. `select count(*) filter (where erfordert_2fa) from berechtigung` = 0 von 242. Empirisch (Transaktion, zurueckgerollt, cse_app, app.aal='aal1', Benutzer admin@cse-gruppe.de/super_admin): app.hat_recht('system.rolle_verwalten', reinigung) = TRUE, ebenso system.rolle_lesen und system.module_zuweisen. Genau die drei Schluessel, fuer die die Anwendung aal2 verlangt (routen.generiert.ts:351-353, `"aal2":true` — 3 von 432 Routen), gibt die Datenbankfunktion in einer aal1-Sitzung heraus. Die zweite Linie traegt die 2FA-Forderung also NICHT ueber hat_recht, sondern ueber zwei getrennte RESTRICTIVE-Policies (p_rb_aal2 auf rolle_berechtigung, p_bm_aal2 auf benutzer_mandant) — die einzigen 2 von 602 Policies, die app.aal() ueberhaupt erwaehnen. Dazu kommt als dritte Quelle rolle.erfordert_2fa (admin, super_admin) fuer die Kontoeinrichtung. Drei Mechanismen, nicht eine Funktion: an dieser Stelle beantworten Anwendung und Datenbank die Rechtefrage gerade nicht gleich. Der einzige Test dazu (tests/isolation/berechtigung.test.ts:259-268) setzt `update berechtigung set erfordert_2fa = true` selbst, bevor er prueft — er belegt den Zweig, nicht den Katalog.

2) Die Modul-Schnittmenge (AUT-01) hat keine Daten und keinen Menschenweg. benutzer_mandant: 18 Zeilen, 0 mit module (alle NULL). Kein Dienst schreibt die Spalte; `system.module_zuweisen` existiert nur als Katalogzeile (src/server/auth/katalog.generiert.ts:220). Der Test (berechtigung.test.ts:235) legt seine Zeile selbst an. Der Zweig `bm.module is null or split_part(...) = any(bm.module)` laeuft heute bei jeder Anfrage in den NULL-Fall.

3) Fuer die Rechteverwaltung gibt es keine Seite. `find src/app -path "*einstellungen*" -name page.tsx` liefert nichts; es existiert kein Verzeichnis src/app/portal/[mandant]/einstellungen. Die drei Routen mit der Rechtematrix stehen nur im Manifest. Insgesamt 127 page.tsx gegen 432 Manifestrouten, Rest faellt auf src/app/portal/unterseite.tsx -> NochNichtGebaut. Ein Mensch kann heute kein Recht sehen, erteilen oder entziehen — nur was der Seed schrieb (532 rolle_berechtigung-Zeilen). Die Policies t_rb_schreiben/t_rb_aendern und p_rb_aal2 bewachen damit einen Schreibweg, den keine Oberflaeche beschreitet.

4) freigabe_kette: RLS an und FORCE, aber NULL Policies und keine Grants fuer cse_app (Eigentuemer postgres) — vollstaendig zu, erreichbar nur ueber app.freigabe_kette_ziehen (SECURITY DEFINER). Es ist die einzige Tabelle mit mandant_id, deren Policies kein mandant-Praedikat tragen (weil es keine gibt). Kein Leck, aber die Zahl "136 tragen rowsecurity" enthaelt eine Tabelle ohne jede Rechtepruefung.

5) Nur 169 von 602 public-Policies rufen hat_recht ueberhaupt auf; die uebrigen tragen Mandanten-, Selbst- oder Job-Praedikate. 11 Policies enthalten app.ist_super_admin() als Nebenweg. Das ist vertretbar, aber "die Rechtefrage" wird in rund 28 % der Policies von dieser Funktion beantwortet, nicht durchgehend.

Kein Widerspruch zu den Out-of-scope-Punkten in diesem Abschnitt. Angrenzend positiv: app.darf_kontaktiert_werden(ansprechpartner, kanal, zweck) und app.rechtsgrundlage_von(...) setzen die § 7 UWG-Linie als Datenbankpraedikat um (Einwilligung/Rechtsgrundlage je Kontakt), statt Kaltakquise zu ermoeglichen.

Fazit: Die zweite Linie steht als Infrastruktur und traegt — RLS, FORCE, entrechtete Rolle, dieselbe Funktion im Routentor. "Vollstaendig" ist sie nicht: die 2FA-Bedingung ist im Katalog leer und wird an zwei Tabellen von Ersatzpolicies getragen, die Modulschnittmenge ist unbelegt, und die Rechteverwaltung, die diese Daten pflegen muesste, ist nicht gebaut. TEILWEISE.

#### 29 Geschuetzte Routen — Die Zugangsentscheidung faellt gegen das Manifest, nicht gegen eine Fallliste, und antwortet 404 statt 403.

**Wirklich:** teilweise

Die Behauptung hält in ihrem Kern (Portalseiten entscheiden wirklich gegen `routen.generiert.ts` und antworten 404), aber drei ihrer vier Aussagen sind nachweislich zu weit gefasst.

**1. „nicht gegen eine Fallliste" — stimmt nur für /portal/**.**
Das 432er-Manifest enthält NULL API-Routen (Familienzählung über `src/server/registry/routen.generiert.ts`: oeffentlich 41, auth 13, checkin 2, mandant 301, gruppe 25, mein 26, kunde 19, konto 5 — api 0). Die 51 Route-Handler unter `src/app/api/**` laufen gar nicht durch `pruefeZugang`, sondern durch `src/server/auth/authorize.ts` gegen `src/server/auth/route-manifest.ts` — 53 handgepflegte Einträge, also genau die Fallliste, die die Behauptung bestreitet. `ERLAUBTE_FAMILIEN` in `zugang.ts:46-48` führt `'api'` als Familie, es gibt aber keine einzige api-Zeile im Manifest: toter Zweig.

**2. „antwortet 404 statt 403" — nicht einheitlich.**
`src/app/portal/zugang.ts:191-199` macht aus `unbekannt`/`kein_recht`/`zweiter_faktor` tatsächlich `notFound()`. `authorize.ts:68-73` wirft für denselben 2FA-Fall bewusst `ZweiterFaktorFehler` (403). Zwei Tore, zwei Antworten auf dieselbe Bedingung. Ausserdem: `/auth/kein-zugriff` steht als Phase-1-Zeile im Manifest („signed in, permission missing") — die Seite existiert nicht (`src/app/auth` enthält nur `bereich/`), und das Tor zielt nie dorthin.

**3. „prueft ALLE 432 Zeilen" — falsch.**
`tests/isolation/rollen.test.ts:94-97` bildet nur INTERN(301)+GRUPPE(25)+KUNDE(19)+MEIN(26); dazu oeffentlich(41) in Prüfung (5), Zeile 343. Nie aufgezählt: 13 auth-, 2 check-in-, 5 konto-Zeilen = 20 von 432. Das sind ausgerechnet die Familien, die `zugang.ts:45-49` JEDEM Portal öffnet — die ungeprüfte Erlaubnis. Dazu schneiden mehrere Zusagen ab: `INTERN.slice(0, 40)` (Zeile 262), `.slice(0, 60)` (303), `.slice(0, 50)` (324). Und für `admin`/`leitung` wird kein Pfad einzeln erwartet, sondern nur `a > l` (Zeile 297) — eine Zählung, keine Rollenprobe. Vollständig über 301 Routen geprüft ist genau EINE Sitzung (Fatima).

**4. Der Mensch kommt heute nicht hin.**
Es gibt keine Anmeldung. `/auth/login` ist Phase-1-Manifestzeile ohne `page.tsx`. Einziger Aussteller des Sitzungskekses ist `src/app/dev/anmelden/page.tsx:69` hinter `devFlaechenAn()` (aus im Production-Build, `src/lib/dev-flaechen.ts`). Ohne Sitzung rendert jede Portalseite `AnmeldungNoetig` („wird gerade gebaut (PR 20)", HTTP 200) — nicht 404, nicht Weiterleitung. Die Entscheidungen `erlaubt`/`kein_recht` sind in einem Production-Build unerreichbar.

**5. Der 2FA-Zweig prüft einen Zustand, den das System nicht erzeugen kann.**
`devSitzungAusstellen` schreibt `aal` hart als `'aal2'` (`src/server/auth/sitzung.ts:173`). Es kann keine aal1-Sitzung geben. `rollen.test.ts:313` baut sie als TypeScript-Literal — der Test belegt die Verzweigung der Funktion, nicht das Verhalten des Systems. `/auth/zwei-faktor/pruefen|einrichten|wiederherstellung` haben keine Seiten.

**6. Reihenfolge ungenau.** Tatsächlich (`zugang.ts:114-169`): unbekannt → oeffentlich/offen → token → anmeldung → falsches_portal → sitzung/selbst (sofort `erlaubt`) → infrastruktur → aal2 → Rechte. `sitzung`/`selbst` kehren VOR der aal2-Prüfung zurück; `/portal/konto/sicherheit` (2FA-Einrichtung, aktive Sitzungen) ist damit mit jeder Sitzung ohne zweiten Faktor offen.

**Was stimmt:** Das Tor ist real verdrahtet (`src/app/portal/zugang.ts:111`), alle 107 Portalseiten erreichen es direkt oder über `unterseite.tsx:86,111` bzw. `mein/rahmen.tsx:63`; keine gebaute Portalseite fehlt im Manifest (dateisystem-gegen-Manifest geprüft); die an `portalZugang` übergebenen Pfade stimmen ausnahmslos mit dem Dateipfad überein. Eine zentrale Erzwingung fehlt aber: `src/middleware.ts` setzt nur Sprachköpfe, unter `src/app/portal` gibt es kein `layout.tsx` (nur `src/app/layout.tsx`, `(public)`, `dev`), und kein Test prüft, dass eine neue `page.tsx` das Tor überhaupt ruft — entgegen dem eigenen Kommentar „AUT-04 verlangt die Pruefung im Layout".

**Bestand:** 107 `page.tsx` unter `src/app/portal` gegen 376 Portal-Manifestzeilen; der Rest antwortet über die `[...rest]`-Catch-alls mit `NochNichtGebaut` (`src/app/portal/unterseite.tsx:92,121`). Bewacht ja — gebaut nein.

#### 29 Geschuetzte API-Routen — Jeder Handler ist im Manifest gefuehrt und ruft authorize(); bewusst offene Routen tragen eine unterschriebene Begruendung.

**Wirklich:** teilweise

WAS DER BEHAUPTUNG STANDHAELT (nachgeprueft, nicht uebernommen):

- 51 route.ts unter src/app/api, dazu src/app/healthz/route.ts und src/app/llms.txt/route.ts = 53. Das Manifest src/server/auth/route-manifest.ts fuehrt exakt 53 Eintraege. 1:1, keine Luecke in beide Richtungen.
- Die Aufzaehlungspruefung ist echt: tests/kern/routen.test.ts:60-75 liest das DATEISYSTEM (routenDateien(), Scan ueber src/app, nicht nur src/app/api) und prueft beide Richtungen. Eine neue Route bricht die Suite. Die Datei liegt unter tests/**, vitest.config.ts include: ['tests/**/*.test.ts'] — sie laeuft also wirklich.
- 7 Handler rufen kein authorize(): api/abmelden, api/anfrage, api/check-in/[token], api/check-in/[token]/medien, api/check-in/[token]/offline, api/mein/antraege, api/mein/dienstanweisungen/[id]/kenntnisnahme, api/sitzung/mandant, api/zeit/einwand. ALLE tragen recht:null + grund; routen.test.ts:77-82 erzwingt grund > 40 Zeichen. Keine stillschweigend offene Route.
- authorize.ts:74-77 erzwingt Invariante 10, :81-86 antwortet auf fremden Mandanten mit NichtGefundenFehler (404), :89-93 ebenfalls 404 bei fehlendem Recht. Das Beispiel stimmt: src/app/api/rechnungen/festschreiben/route.ts:52 istGleicherUrsprung, :55 aktuelleSitzung, :69-71 authorize({recht:'finanzen.festschreiben', schreibend:true}).
- Server Actions sind mitgeprueft (routen.test.ts:97-127), mit genau EINER Ausnahme (tests/kern/serveraction-ausnahmen.ts: dev/anmelden, Wache devFlaechenAn), und die Ausnahme muss ihre Wache nennen UND im Code aufrufen.

WORAN DIE BEHAUPTUNG BRICHT:

1. „Das Manifest fuehrt jede mit Recht" ist fuer api/angebot FALSCH. route-manifest.ts:101-102 sagt recht:'angebot.versenden', und der Docstring :92-99 argumentiert ausdruecklich „Das Recht ist angebot.versenden und NICHT angebot.schreiben". Der Handler src/app/api/angebot/route.ts:49-56 verteilt ueber rechtFuer() DREI Rechte: 'angebot.schreiben' (aktion=aus_raumbuch), 'angebot.versenden' (versenden), 'angebot.annahme_erfassen' (in_auftrag). Der Handler-Kommentar :36-47 sagt selbst, die eine Pruefung auf angebot.versenden sei ein behobener Defekt gewesen — das Manifest wurde dabei nie nachgezogen und behauptet heute das Gegenteil des Codes. Wer das Manifest liest, glaubt, POST /api/angebot verlange angebot.versenden; tatsaechlich kommt ein Prinzipal mit nur angebot.schreiben durch. Live-Schaden heute gering: select auf rolle_berechtigung/berechtigung (cse_p5) zeigt super_admin, admin und leitung halten alle drei angebot-Rechte, also eskaliert derzeit niemand. Aber das Manifest ist laut eigenem Kopfkommentar („von aussen auf Vollstaendigkeit pruefbar") genau die Pruefflaeche — und fuer diese Route ist es unrichtig.

2. Die Pruefung wiederholt den Irrtum, statt ihn zu finden. tests/kern/routen.test.ts:84-95 prueft nur readFileSync(datei).toMatch(/\bauthorize\s*\(/u) — reine TEXTSUCHE auf Anwesenheit. Sie vergleicht NIE das Recht im Manifest mit dem Recht, das an authorize() uebergeben wird. Die Drift aus (1) ist fuer die gruene Suite unsichtbar, und jeder kuenftige Handler koennte ein schwaecheres oder ganz anderes Recht pruefen, waehrend Manifest und Suite das Gegenteil versichern.

3. Das zweite genannte Beispiel stimmt im Detail nicht. src/app/api/medien/[id]/route.ts hat KEIN istGleicherUrsprung — nur aktuelleSitzung (:38) und authorize (:47, recht:'zeit.lesen', schreibend:false). „ebenso" trifft nicht zu. Insgesamt ohne Ursprungspruefung: api/abmelden, api/anfrage, api/check-in/[token] (+ /medien, /offline), api/bau/nachtrag-warnungen, api/medien/[id]. Bei GET vertretbar; bei api/abmelden (POST) beruft sich der Manifest-Grund :44-51 ausdruecklich allein auf die Methode POST — ein fremdes Formular kann damit eine Abmeldung ausloesen (geringer Schaden, aber die Begruendung traegt nicht so weit, wie sie behauptet).

4. Das Manifest wirkt zur LAUFZEIT nicht. src/middleware.ts (34 Zeilen) liest es nicht; GESCHUETZTE_ROUTEN (route-manifest.ts:685) ist exportiert und wird nirgends benutzt (grep ueber src/, tests/, scripts/). Der Schutz haengt vollstaendig am Aufruf im jeweiligen Handler — das Manifest ist Dokumentation plus Testfixture. Das ist so auch dokumentiert, widerspricht aber der Lesart „im Manifest gefuehrt" als Absicherung.

NEBENBEFUND (andere Sektion, gleiche Route): versendeAngebot (src/server/services/angebot/index.ts:257) laeuft nicht ueber src/server/agent/policy.ts; es speichert nur einen benannten Freigeber. Den Gate benutzen nur api/bau/behinderungen/[id]/versenden, services/bau/behinderung.ts, services/bau/nachtrag.ts, services/lead/bestaetigung.ts. Invariante 7 ist damit fuer den Angebotsversand nicht ueber denselben Weg abgesichert.

WIDERSPRUCH ZUM AUSGESCHLOSSENEN: In dieser Sektion keiner. Unter den 53 Routen gibt es keine fuer Kaltakquise an gescrapte Kontakte (§7 UWG), kein Scraping von Indeed/StepStone, keine Lohnabrechnung/Jahresabschluss/E-Bilanz/Steuererklaerung und keine automatische Einreichung auf Vergabeplattformen. api/anfrage und api/lead sind eingehende Wege (Anfrage ohne Konto, CRM-Notiz), nicht ausgehende Werbung — das ist die zulaessige Alternative: Kontaktaufnahme nur zu Kontakten mit erfasster Rechtsgrundlage, Recruiting ueber eingehende Bewerbungen, Vergabe-Einreichung manuell.

FAZIT: Der Mechanismus ist gebaut und maschinell erzwungen — die Vollstaendigkeit der Aufzaehlung und die unterschriebenen offenen Routen halten der Pruefung stand. „Stand: GEBAUT" haelt trotzdem nicht, weil der behauptete Kern („das Manifest fuehrt jede mit Recht") fuer api/angebot nachweisbar falsch ist und die Pruefung, die das verhindern soll, nur Anwesenheit statt Identitaet prueft. TEILWEISE.

#### 12 AI Sales Agent — Lead-Datenbank mit Quelle, Status, Priorität, Besitzer, nächster Aktion, SLA-Frist und Kommunikationshistorie

**Wirklich:** teilweise

Widerlegung gelungen. Tabellen (drizzle/0017_lead.sql, 0020_crm_identitaet.sql), beide Seiten (src/app/portal/[mandant]/crm/leads/page.tsx, .../leads/[id]/page.tsx) und der Navigationspunkt (src/server/registry/navigation.ts:29) existieren wirklich, kein NochNichtGebaut. Aber von den sieben behaupteten Merkmalen ist die Haelfte fuer einen Menschen nicht benutzbar:

1) Quelle und Prioritaet werden nie gerendert. Beide Seiten selektieren sie (leads/page.tsx:72-74, [id]/page.tsx:90), zeigen sie aber nirgends an; die Tabellenspalten sind Nr., Anfrage, Frist, Punkte, Wert, Naechster Schritt, Zustaendig, Status (leads/page.tsx:127-176), das Detail zeigt nur Nummer, Firma, Erste Reaktion, Wert ([id]/page.tsx:141-172).

2) Status, Prioritaet, Besitzer sind durch keinen Pfad aenderbar. Einziger Schreibpfad ist POST /api/lead (src/app/api/lead/route.ts:78-105): eine lead_aktivitaet plus naechste_aktion_text/_am. Kein Dienst setzt lead.status, prioritaet, besitzer_benutzer_id oder konvertiert_am; grep "update lead" findet nur services/lead/eskalation.ts:84 (Eskalationsstufe). 'in_bearbeitung' in der DB stammt allein aus dem Seed (src/server/db/seed/operations.ts:382-386). /portal/[mandant]/crm/leads/neu steht im Manifest (routen.generiert.ts:74), hat aber keine page.tsx - manuelle Erfassung unmoeglich. Fuer quelle 'vergabe_radar' und 'empfehlung' erzeugt kein Code je einen Lead.

3) Die SLA-Uhr laesst sich durch keinen Anwendungspfad anhalten. erste_reaktion_am stempelt nur der Trigger kern.setze_erste_reaktion() bei richtung='ausgehend' (drizzle/0017_lead.sql). Alle drei INSERTs in lead_aktivitaet schreiben etwas anderes: annahme.ts:249 'eingehend', eskalation.ts:99 'intern', api/lead/route.ts:81 fest 'intern' - auch wenn der Benutzer "E-Mail" oder "Anruf" waehlt. Wer den Kunden anruft und es festhaelt, stoppt die Frist nicht; entscheideEskalation (services/lead/sla.ts:69-86) eskaliert weiter, stuendlich, ohne Stufendeckel. DB-Beleg: L-2026-0002 hat eine Notiz und erste_reaktion_am IS NULL.

4) Die Pruefung wiederholt den Irrtum: tests/isolation/lead.test.ts:283 fuegt die 'ausgehend'-Zeile per rohem SQL selbst ein (Zeile 308) - geprueft wird der Trigger, nicht der Weg des Menschen.

5) Der Eskalationsjob laeuft nirgends. registriereLeadSlaJob (src/server/jobs/lead-sla.ts:18) wird im gesamten Repo nie aufgerufen; fuehreAus (src/server/jobs/runner.ts:52) nur in tests/isolation/jobs.test.ts. Kein vercel.json, kein Cron in supabase/config.toml, keine ausloesende Route. DB-Beleg: keine Zeile mit eskalationsstufe > 0, obwohl L-2026-0001 seit 11.09. ueberfaellig ist. ROADMAP Zeile 100 ("escalation job") unabgehakt.

6) Kommunikationshistorie ist ein internes Notizbuch: nichts geht von einem Lead hinaus. crm.kommunikation_versenden existiert im Katalog (katalog.generiert.ts:53) und im Dienstregister (registry/dienste.ts:290), wird aber von keinem Code geprueft oder benutzt.

Nebenbefund: beide Seiten mappen einen Status 'qualifiziert' (leads/page.tsx:32, [id]/page.tsx:33), den das Enum lead_status nicht kennt.

Korrekt am Bestand: Punktzahl kommt nicht aus einem Modell (Invariante 6), sondern als Platzhalter mit Begruendung aus dem Seed, Kriterien offen als O-15; SLA-Stundenregel offen als O-14 mit TODO(client) in sla.ts:16; firma/ansprechpartner/kunde existieren (2/4/4 Zeilen); Seed traegt wie behauptet 2 Lead-Zeilen (die weiteren 9 stammen aus e2e-Laeufen, "Testfirma ...").

Kein Rechtswiderspruch in diesem Punkt: das CRM sendet nichts, app.darf_kontaktiert_werden sitzt vor jeder Werbung (crm/page.tsx:57), lead_aktivitaet fuehrt zweck und rechtsgrundlage_snapshot. Kaltakquise an gescrapte Kontakte ist weder gebaut noch vorbereitet und darf es nach § 7 UWG (auch B2B) und CLAUDE.md "Out of scope" nicht werden - moeglich ist stattdessen nur Ansprache mit erfasster Rechtsgrundlage (einwilligung, bestandskunde, anfrage), was das Schema genau so abbildet.

#### Out of scope, ausdrücklich mitgeprüft — § 7 UWG als hartes Tor, das auch eine erteilte Freigabe nicht aufhebt

**Wirklich:** teilweise

Die zitierten Stellen existieren (Schritt 1 steht in /home/user/phase5-e2e/src/server/agent/policy.ts:153, nicht 147; CHECK und DEFAULT in drizzle/0020_crm_identitaet.sql:166-190; Rechte in 0008:439-441 bestaetigt). Trotzdem ist „GEBAUT" falsch — an fuenf Punkten:

1. DAS TOR SIEHT NIE EINE ECHTE RECHTSGRUNDLAGE. gate() hat genau drei Aufrufer: services/lead/bestaetigung.ts:66 und services/bau/behinderung.ts:386 setzen beide das Feld als HARTKODIERTES Literal 'vertrag'; services/bau/nachtrag.ts:336-350 (nachtragNutzlast) laesst es ganz weg. Kein einziger Produktionspfad liest kunde.rechtsgrundlage oder ansprechpartner.rechtsgrundlage und reicht den Wert an gate() weiter (grep ueber src/: die Spalte wird nur vom Seed db/seed/operations.ts:224-247 geschrieben und von zwei CRM-Seiten ueber app.darf_kontaktiert_werden angezeigt). Der Wert 'keine' — genau der DEFAULT, auf den sich die Behauptung beruft — kann zur Laufzeit nie bei gate() ankommen. Schritt 1 ist ausserhalb von tests/kern/gate.test.ts toter Code.

2. DIE PRUEFUNG IST FAIL-OPEN, NICHT HART. policy.ts:62 deklariert empfaengerRechtsgrundlage als OPTIONAL; :153 vergleicht strikt auf === 'keine'. undefined laeuft durch. Genau das produziert nachtragNutzlast. Der Rest der Datei ist bewusst fail-closed (fehlende Richtlinie = nein) — diese eine Stelle nicht. Kein Test deckt den ausgelassenen Fall ab: gate.test.ts:24/67/77/174 setzt immer einen expliziten Wert. Ein Nachtrag ueber vierzigtausend Euro passiert LEG-08 also ungeprueft.

3. „EIN WERBEWIDERSPRUCH SETZT DIE GRUNDLAGE ZWINGEND ZURUECK" IST SCHLICHT FALSCH. Der CHECK kunde_widerspruch_sperrt (in der laufenden DB verifiziert) deckt nur widerspruch_am — den Verarbeitungswiderspruch nach Art. 21 DSGVO. Auch der Trigger kern.erzwinge_widerspruch (0020:620-656) erzwingt rechtsgrundlage := 'keine' ausschliesslich bei widerspruch_am. werbewiderspruch_am laesst die Grundlage absichtlich unberuehrt — der Migrationskopf 0020:13-21 sagt das woertlich und zu Recht (eine Rechnung muss zustellbar bleiben). Der Behauptende hat die beiden Widersprueche verwechselt, also genau den Fehler gemacht, vor dem die Migration warnt. Der Werbewiderspruch greift an ganz anderer Stelle, naemlich in app.darf_kontaktiert_werden (0020:562-608) — die die Behauptung nicht nennt und die gate() nie aufruft.

4. ES GIBT KEINEN MENSCHLICHEN WEG. Im Dateisystem fehlen: /werbewiderspruch und /werbewiderspruch/[token] (Manifest routen.generiert.ts:48-49, die oeffentlichen §7-Pflichtseiten) — kein page.tsx; /portal/[mandant]/crm/kontakte/[id]/rechtsgrundlage („set, with evidence and date", Manifest :84, bewacht mit crm.rechtsgrundlage_setzen) — keine Seite, keine API-Route; /portal/[mandant]/datenschutz/widersprueche (Manifest :371) — keine Seite. src/app/portal/[mandant]/crm/ enthaelt nur page.tsx, kunden/, leads/. Das Recht crm.rechtsgrundlage_setzen ist an super_admin und admin vergeben, aber an einen Bildschirm, den es nicht gibt: niemand kann im laufenden System eine Rechtsgrundlage eintragen, aendern oder einen Werbewiderspruch erfassen.

5. DER SEED ZEIGT NICHTS. Live-Abfrage: alle 4 kunde- und alle 4 ansprechpartner-Zeilen stehen auf 'bestandskunde', werbewiderspruch_am = 0, widerspruch_am = 0. Es existiert keine Zeile mit 'keine' und kein Widerspruch — kein Datensatz, an dem ein Mensch das Tor zuschnappen sehen koennte.

GEBAUT ist damit: die reine Funktion mit ihrer Reihenfolge, die Fehlerklasse samt Wortlaut, das Enum, der sperrende DEFAULT 'keine', der Beleg-CHECK, der Art.-21-CHECK, der Write-once-Trigger und app.darf_kontaktiert_werden (sauber fail-closed, mandantengebunden, mit getrenntem Kanal- und Zweckzweig) — letztere allerdings nur LESEND auf zwei CRM-Seiten zur Anzeige „darf nicht kontaktiert werden" (crm/page.tsx:59, crm/kunden/[id]/page.tsx:109). FEHLT: die Verbindung zwischen Datenbank und Tor, die Pflichtfeld-Semantik statt optionalem Feld, die Erfassungs- und Widerspruchsseiten, der Test fuer den ausgelassenen Fall und Seed-Daten, die den Sperrfall zeigen. Ein Mensch koennte das heute nicht benutzen — die Sperre existiert als Satz im Code und als Vorgabe im Schema, aber nirgends dazwischen.

#### 16 Personal — ArbZG-Grenzen rechnen je MENSCH ueber alle Gesellschaften zusammen (TIM-14, K-06)

**Wirklich:** teilweise

Der Kern stimmt, die Zusage "GEBAUT" nicht. Bestaetigt: zeit_intern.arbeitszeit_fenster haengt wirklich an person_id (Indizes fenster_person_idx, fenster_ende_idx auf person_id, mandant_id nur Beiwerk); beide Leser existieren in der laufenden DB und sind prosecdef=t (app.arbzg_belastung mit fremd boolean, zeit_intern.arbzg_belastung_job mit mandant_id uuid); arbeitszeit_verstoss existiert samt Spalte betrifft_fremden_mandant; Migrationen 0040/0064/0085/0088/0094 und Commit 0189f91 sind vorhanden; der Live-Weg greift (src/app/api/einsaetze/[id]/besetzen/route.ts:111 gibt 422 mit fehler 'arbzg_warnung'); dienstplan/konflikte/page.tsx rendert kein NochNichtGebaut und zeigt in Zeile 229 "ueber Gesellschaften hinweg"; und der Test ist substanziell, kein Nachbeten des Codes (tests/isolation/arbzg-uebergreifend.test.ts:94-107 legt 6h Reinigung in Mandant A und 5h Security in Mandant B auf dieselbe Person, erwartet 660 Minuten und ueberGesellschaften===true, mit Gegenprobe 110-119, die bei nur einer Schicht befunde:[] verlangt).

Drei Punkte widerlegen "GEBAUT":

1. Der als Beleg genannte Nachtlauf laeuft nicht. registriereKonfliktDetektor (src/server/jobs/konflikteErkennen.ts:45) wird im gesamten Repository kein einziges Mal aufgerufen; kein Bootstrap registriert irgendeinen Job; select count(*) from job_lauf ergibt 0. Genau der Zweig, den Commit 0189f91 repariert hat (alsJob -> zeit_intern.arbzg_belastung_job), ist im Betrieb toter Code und nur aus Tests erreichbar. Der zweite der beiden zitierten Leser traegt produktiv nichts bei. Ein Verstoss, der nach der Buchung entsteht (Schicht in der Schwestergesellschaft nachgetragen, Zeiteintrag laeuft ueber), wird von niemandem entdeckt.

2. Der Seed zeigt den Fall nirgends. Genau ein Mensch (93988b48-9a4e-4ba5-a0ce-f7f26b770559) hat Anstellungen in zwei Mandanten, aber seine Fenster liegen weit auseinander (25.08. Ende 14:00 UTC, 26.08. Beginn 03:56 UTC, rund 13,9 h Ruhe). Alle Zeilen in planungs_konflikt (2x arbzg, 1x qualifikation_entfallen) haben betrifft_fremden_mandant = false; die einzige Zeile in arbeitszeit_verstoss (ruhezeit_unter_11h, 240 statt 660 Minuten) gehoert einer anderen Person (925c4b5c-7681-4e26-96ef-14dbfe262017) und ebenfalls false. Das Label in konflikte/page.tsx:229 rendert auf Seed-Daten also nie. CLAUDE.md, Definition of done ("seed data exercises it") ist nicht erfuellt.

3. Ausgerechnet Abschnitt "16 Personal", unter dem die Behauptung abgelegt ist, tut es ausdruecklich nicht. src/app/portal/[mandant]/personal/personen/[id]/page.tsx:33 vermerkt die ArbZG-Belastung als offene Frage O-220; Zeile 241 sagt woertlich "Beschaeftigungen in anderen Gesellschaften der Gruppe stehen hier nicht". docs/DECISIONS.md:3042 fuehrt O-220 als offen: es fehlt die Rechtsgrundlage (Paragraf 26 BDSG, gemeinsame Verantwortlichkeit), und K-06 laesst genau eine Tuer durch die Mandantenwand zu. Der Mechanismus lebt im Dienstplan, nicht im Personal.

Kein Widerspruch zur Out-of-scope-Liste: die gesellschaftsuebergreifende Zusammenrechnung ist nach Paragraf 2 Abs. 1 ArbZG zwingend und ist keine Lohnabrechnung.

Fuer "GEBAUT" fehlt: den Detektor-Job im Job-Register verdrahten (ein Aufruf von registriereKonfliktDetektor) und eine Seed-Zeile, die fuer den Menschen mit zwei Anstellungen eine echte Ueberschreitung erzeugt, damit betrifft_fremden_mandant = true einmal sichtbar wird.

#### 16 Personal — Sensible Daten nur fuer Befugte — als Spaltenrecht, nicht als Oberflaechen-Ausblendung (K-05)

**Wirklich:** teilweise

Die Sperr-Haelfte der Behauptung haelt der Pruefung stand, die Zugangs-Haelfte nicht. Deshalb TEILWEISE, nicht GEBAUT.

BESTAETIGT (Sperre ist echt und live):
- Nicht nur information_schema, sondern gefahren: "begin; set local role cse_app; select stundensatz_intern from anstellung" -> ERROR: permission denied for table anstellung; ebenso "select abwesenheitsart_id from abwesenheit" und "select * from abwesenheit". has_column_privilege unter cse_app = f fuer anstellung.stundensatz_intern, abwesenheit.{abwesenheitsart_id,bemerkung,au_bis,dokument_id}, kunde.{debitorennummer,zahlungsziel_tage}, lv_position.einheitspreis_cent. kunde.mahnsperre_bis/mahnsperre_grund existieren wie behauptet.
- Umgehungen zu: cse_app ist weder superuser noch bypassrls, ohne Rollenmitgliedschaft (pg_auth_members kennt nur pg_monitor); alle 7 Views in public tragen {security_invoker=true}, laufen also NICHT mit Eigentuemerrecht; die Anwendung verbindet als postgres und schaltet in jedem Kontext per "set local role cse_app" um (src/server/kontext/index.ts:61, eingang.ts:43, oeffentlich.ts:52).
- app.abwesenheit_grund_lesen ist tatsaechlich SECURITY DEFINER, prueft app.hat_recht('zeit.abwesenheit_grund_lesen') plus Mandantengleichheit und schreibt app.protokolliere('personal.abwesenheitsgrund_gelesen', ... 'Art. 9 Abs. 2 lit. b DSGVO').
- Die Seite ist echt, kein Stub: src/app/portal/[mandant]/personal/abwesenheiten/page.tsx, 253 Zeilen, withTenant, kein NochNichtGebaut (das Wort steht nur in src/app/portal/unterseite.tsx). Seed traegt 7 abwesenheit-Zeilen mit Art, 3 mit Bemerkung, 7 abwesenheitsart.
- Die Tests pruefen die Sache, nicht den Irrtum des Codes: tests/isolation/abwesenheit.test.ts:333-362 erwartet echtes "permission denied" fuer die Planungsrolle, liest den Grund ueber leseGrund als Personalstelle und zaehlt die Auditzeile; tests/isolation/mandanten-trennung.test.ts:70-72 dasselbe fuer stundensatz_intern. src/server/services/mitarbeiter/felder.ts wird von tests/kern/mitarbeiter.test.ts:180-183 und tests/isolation/mitarbeiter.test.ts:574 tatsaechlich gegen jede Nutzlast gefahren, nicht nur deklariert.

WIDERLEGT (der Befugte hat heute keinen Weg):
- leseGrund (src/server/services/abwesenheit/index.ts:322) hat KEINEN Aufrufer in src/app. grep ueber src/ und tests/ trifft nur den Dienst selbst, zwei Kommentare (src/server/services/mitarbeiter/antraege.ts:87, src/app/portal/mein/antraege/page.tsx:25) und die Tests (tests/isolation/abwesenheit.test.ts:352,372). Es existiert keine Seite und keine Route, auf der eine berechtigte Personalstelle den Abwesenheitsgrund einsehen kann. Die Route /api/abwesenheiten/[id]/route.ts kann nur genehmigen/ablehnen/stornieren.
- Beim Entgelt ist die Luecke groesser: app.anstellung_entgelt_lesen existiert in der DB (prosecdef=t), wird in src/ NIRGENDS aufgerufen — nur in Tests (mandanten-trennung.test.ts:77,80,242; definer-eigentum.test.ts) und in einem Kommentar (felder.ts:17). Es gibt auch keinen Dienst-Wrapper.
- Falle 1 greift hier woertlich: src/server/registry/routen.generiert.ts:197 fuehrt /portal/[mandant]/personal/anstellungen/[id]/entgelt (Phase 3, bewacht mit personal.entgelt_lesen), aber src/app/portal/[mandant]/personal/anstellungen/ enthaelt nur page.tsx — kein [id]-Verzeichnis, kein entgelt/page.tsx. Die Adresse existiert im Manifest, die Seite nicht.
- Das Repository raeumt es selbst ein: personal.entgelt_lesen steht in tests/kern/katalog-unbenutzt.ts:156, der eingefrorenen Liste "Katalogschluessel, die heute noch kein Code prueft".
- Rechtevergabe im Seed passt dazu, bleibt aber folgenlos: personal.entgelt_lesen haelt nur super_admin, zeit.abwesenheit_grund_lesen nur super_admin und admin (rolle_berechtigung). Ohne Oberflaeche ist die Vergabe nicht benutzbar.

NEBENBEFUND (Zusage ohne Gegenstand): src/server/services/mitarbeiter/felder.ts:16 behauptet, anstellung.tarifgruppe sei cse_app nicht gegrantet. Die Spalte existiert gar nicht ("column tarifgruppe of relation anstellung does not exist"). Kein Sicherheitsmangel, aber ein Beleg, der ins Leere zeigt. Ferner tragen nur 6 von 22 anstellung-Zeilen ueberhaupt einen stundensatz_intern — bewusst so (DECISIONS O-347), aber der Seed zeigt die Schutzwirkung dadurch nur an einem Teil der Zeilen.

FAZIT: Nach dem Massstab "GEBAUT gilt nur, wenn ein Mensch es heute benutzen koennte" ist die Verweigerung heute benutzbar (die Planerin sieht den Grund wirklich nicht, und das ist Spaltenrecht, keine Oberflaechen-Ausblendung — insofern ist der Kern von K-05 korrekt belegt), der berechtigte Zugriff dagegen nicht: weder fuer den Abwesenheitsgrund noch fuer das Entgelt fuehrt ein Weg von einer Seite zur Definer-Funktion. Der Satz "Sensible Daten nur fuer Befugte" ist erst zur Haelfte eingeloest.

#### 16 Personal — Arbeitszeiten, Stundenkonto, Monatsabschluss (EMP-03, EMP-04, EMP-15)

**Wirklich:** teilweise

Die Belege der Behauptung stimmen einzeln, tragen aber „GEBAUT" nicht. Der Kern von EMP-04 fehlt.

WAS STIMMT (nicht widerlegbar)
- Alle fuenf genannten Seiten existieren als echte Seiten, keine rendert `NochNichtGebaut`: /home/user/phase5-e2e/src/app/portal/[mandant]/personal/stundenkonten/page.tsx (268 Z.), /[anstellungId]/page.tsx (342 Z.), /abschluss/page.tsx (229 Z.), src/app/portal/mein/stundenkonto/page.tsx (191 Z.), src/app/portal/mein/monatsnachweis/page.tsx (258 Z.). `NochNichtGebaut` kommt in ganz src/app nur in src/app/portal/unterseite.tsx vor.
- Tabellen stundenkonto, stundenkonto_bewegung, urlaubskonto liegen in der DB (drizzle/0060_stundenkonto.sql, 0061_urlaubskonto.sql).
- Der Weg des Menschen ist vorhanden: src/server/registry/tableiste.ts:98 verlinkt `stundenkonto` in der Mitarbeiterleiste; src/app/portal/mein/stundenkonto/page.tsx:174-183 verlinkt den Monatsnachweis.
- src/app/api/stundenkonto/[id]/monat-abschliessen/route.ts ist sauber: Same-Origin, `zeit.konto_abschliessen` mit `erfordert2fa: true`, Monat/Anstellung aus dem KONTO statt aus dem Formular. Reihenfolge im Dienst (stundenkonto.ts:605ff): verweigern → buchen → sperren → praegen.
- Tests existieren: tests/kern/zeit-stundenkonto.test.ts (9), tests/kern/zeit-monatsanteil.test.ts (14), tests/isolation/stundenkonto.test.ts (21).

WARUM TROTZDEM NUR TEILWEISE
1. Die Sache selbst — „Soll gegen Ist, Ueberstundensaldo" (SPEC.md:270, EMP-04) — ist heute fuer KEIN Konto verfuegbar. Die ausgelieferte Regel SOLLSTUNDEN_OFFEN liefert `null` (src/server/services/zeit/sollstunden.ts:70-75, `// TODO(client, O-18)`). `stundenkonto.ts:324` schreibt `eingabe.sollMinuten ?? 0`. Entscheidend: ein grep ueber ganz src/ findet KEINEN Pfad, der je ein soll_minuten ungleich 0 schreibt — nur Lesen und Anzeigen. Es ist also nicht „ungeseedet", sondern strukturell unerreichbar. In der DB: alle 16 Zeilen soll_minuten = 0. Beide Oberflaechen zeigen darum bei Soll UND Saldo „nicht hinterlegt" (mein/stundenkonto/page.tsx:112,118; personal/stundenkonten/page.tsx:182-184,199,241-247). Ein Mensch sieht heute Ist-Stunden — kein Soll, keinen Saldo. Das ist ehrlich gebaut (und genau die CLAUDE.md-Regel „Never invent a business rule"), aber es ist nicht EMP-04.
2. Der Monatsabschluss ist im Seed nie vollzogen: `select count(*) filter (where status='gesperrt') from stundenkonto` = 0. Keine Zeile zeigt einen geschlossenen Monat, keinen §17-Nachweis-Hash, keinen gesperrten Zeiteintrag. Der Weg ist nicht vorgefuehrt.
3. schliesseMonatAb verweigert bei fehlender Sollzeit NICHT — es sperrt unumkehrbar mit soll=0 und praegt den Nachweis darauf (stundenkonto.ts:605-658). `sollMinutenOderFehler` wird in stundenkonto.ts nirgends aufgerufen.
4. urlaubskonto wird als Beleg genannt, traegt aber 1 Zeile bei 22 anstellungen.
5. EMP-15/Monatsnachweis: das Manifest (src/server/registry/routen.generiert.ts:408) verspricht „the monthly hours statement as PDF"; gebaut ist HTML mit `@media print` (monatsnachweis/page.tsx:15-25,157) — begruendet dokumentiert, aber die Zusage ist offen.
6. Die Pruefung wiederholt hier den Stand, statt ihn zu decken: tests/kern/zeit-stundenkonto.test.ts:69-91 prueft, dass die Sollzeit NICHT geraten wird — sie bestaetigt die Luecke. Kein Test schliesst einen Monat mit echter Sollzeit ab.

Nebenbefund: /portal/[mandant]/personal/stundenkonten steht in keiner Tab-Leiste (tableiste.ts kennt keinen Eintrag „personal"); erreichbar nur ueber „Mehr"/Sidebar.

Widerspruch zu „Out of scope": keiner. Abschnitt 16 beruehrt weder Kaltakquise (§7 UWG), Scraping, Vergabe-Einreichung noch Lohnabrechnung — der Monatsabschluss bereitet auf und rechnet ausdruecklich keinen Lohn, was die Ausschlussliste in CLAUDE.md korrekt einhaelt.

Hinweis zur Messung: die Zeilenzahlen schwankten waehrend der Pruefung (stundenkonto 29 → 16), weil die parallele Runde neu seedet. Der qualitative Befund (soll_minuten ausnahmslos 0, kein gesperrter Monat) ist davon unberuehrt.

#### 18 Finanzen — Ausgangsrechnung: Lebenszyklus Entwurf → festgeschrieben, Storno und Korrektur

**Wirklich:** teilweise

Der Mechanismus steht, der Weg ist heute nicht begehbar. Die benannten Belege existieren alle (drizzle/0075–0077, rechnung.ts:153/474/839/1028/1188, vier API-Routen, drei echte Seiten ohne NochNichtGebaut — neu/page.tsx traegt ein vollstaendiges Formular, [id]/page.tsx:395/417/463 die Knoepfe Festschreiben, Verwerfen, Storno). Trotzdem ist „GEBAUT" falsch, aus vier unabhaengig pruefbaren Gruenden.

1. FESTSCHREIBEN IST IM AUSGELIEFERTEN ZUSTAND UNMOEGLICH. In der frisch migrierten und geseedeten DB tragen ALLE drei Nummernkreise vom Typ `ausgangsrechnung` (bau, reinigung, security) `ist_platzhalter = true` (select auf `nummernkreis`). `src/server/services/finanz/nummernkreis.ts:204` weist daraufhin jede Nummernvergabe mit Code `platzhalter` ab; `finalisiere()` (rechnung.ts:839) zieht die Nummer ueber `fin.rechnung_nummer_ziehen` und scheitert. Offene Frage O-134 (fortlaufend oder jaehrlich, welche Maske). Entwurf → festgeschrieben laesst sich heute in keiner der drei Gesellschaften gehen. Die Seite sagt das selbst an (neu/page.tsx:96-101: „Bis jemand sie bestaetigt, wird keine Nummer daraus vergeben").

2. STORNO UND KORREKTUR SIND FUER NIEMANDEN ERREICHBAR. `finanzen.stornieren` ist im Katalog nur an `super_admin` gebunden (src/server/auth/katalog.generiert.ts:85, in der DB bestaetigt: genau eine Rolle haelt das Recht). Die Tabelle `benutzer_mandant` enthaelt keinen einzigen super_admin — geseedet sind admin/leitung/mitarbeiter/kunde/formular_eingang/website_renderer. `src/app/api/rechnungen/storno/route.ts:76` verlangt genau dieses Recht. Offene Frage O-77 (wer darf stornieren). Beide Formen — „nur Storno" und „Storno mit Neuausstellung", also `korrigiere()` — sind damit fuer jedes geseedete Konto gesperrt.

3. DER SEED TRAEGT KEINE EINZIGE RECHNUNG. `select status, count(*) from rechnung group by status` liefert 0 Zeilen. Weder Entwurf noch festgeschriebener Beleg noch Storno. Das Rechnungsausgangsbuch ist leer; es gibt keine Zeile, an der ein Mensch den Lebenszyklus sehen koennte. CLAUDE.md „Definition of done: seed data exercises it" ist nicht erfuellt.

4. DIE PRUEFUNG BELEGT DEN CODEPFAD, NICHT DEN ZUSTAND. `tests/e2e/rechnung.spec.ts` baut sich in `beforeAll` beides selbst weg: Zeile 93 `update nummernkreis set ist_platzhalter = false, zuruecksetzung = 'jaehrlich'`, davor ein `insert into rolle_berechtigung`, das `admin` das Recht `finanzen.stornieren` gibt. Der Kommentar der Datei sagt es woertlich: „es gibt in dieser Gesellschaft keine festschreibbare Rechnung, und damit prueft der ganze Block darunter nichts" (Zeile 44f.). Die gruene Suite beweist, dass der Weg FUNKTIONIERT, wenn man zwei offene Client-Entscheidungen vorwegnimmt — nicht, dass er heute offen steht.

ZUSAETZLICHE LUECKEN INNERHALB DES BEHAUPTETEN UMFANGS: (a) `REGELWERK_VERSION = 'ustg14-nicht-gebaut'` (rechnung.ts:74) — die §14-UStG-Vorabpruefung ist nicht gebaut (FIN-04, vertagt auf PR 47); jeder Snapshot traegt `geprueft: false`. Festgeschrieben wird ohne Pflichtfeldpruefung. (b) Schritt 6 der Finalisierung — `offener_posten`, `buchungssatz`, `periode`, `markiereQuellenAbgerechnet` (§5.6) — steht nur als Kommentar in rechnung.ts (~910); keine dieser Tabellen existiert in der DB (`\dt` zeigt unter rechnung* nur rechnung, _beziehung, _hash, _snapshot, _steuer, _zuschlag, rechnungsposition). Eine festgeschriebene Rechnung erzeugt heute also keinen offenen Posten und keinen Buchungssatz.

Das Ehrliche an dem Stand: die Sperren sind RICHTIG. Eine Nummer aus einem unbestaetigten Kreis waere erfunden, und wer stornieren darf, ist eine Rechtsfrage des Mandanten. Der Code raet nicht — er verweigert und benennt O-134 und O-77. Das ist gute Arbeit, aber es ist TEILWEISE: gebaut ist der Mechanismus (Schema, Hashkette nach Invariante 4, Einbahnstrasse, Storno-statt-Aenderung, Zuschlagskopie in korrigiere()), nicht der benutzbare Vorgang. Fuer „GEBAUT" fehlen genau zwei Antworten des Mandanten plus ein Seed-Handgriff.

WIDERSPRUCH: keiner in diesem Abschnitt. Die vier Out-of-scope-Punkte (Kaltakquise §7 UWG, Scraping Indeed/StepStone, Lohnabrechnung/Jahresabschluss/E-Bilanz/Steuererklaerung, automatische Vergabe-Einreichung) werden hier nicht beruehrt; das Fehlen von Buchungssatz/Periode ist Vertagung, nicht Grenzverletzung — die Plattform bereitet auf und exportiert, Jahresabschluss macht der Steuerberater.

#### 18 Finanzen — Invariante 4: entwurf → festgeschrieben ist EINSEITIG

**Wirklich:** teilweise

Die DB-Belege der Behauptung stimmen wörtlich — ich konnte an ihnen nichts widerlegen:

BESTÄTIGT (live in cse_p5 nachgesehen, nicht nur im Code):
- `\d public.rechnung` zeigt beide CHECKs: `rechnung_entwurf_ohne_nummer` (status<>'entwurf' OR nummer IS NULL AND nummer_laufend IS NULL AND festgeschrieben_am IS NULL) und `rechnung_festgeschrieben_vollstaendig` (9 Pflichtfelder).
- Trigger `trg_rechnung_status_uebergang` und `trg_rechnung_unveraenderlich` sind installiert (drizzle/0076_rechnung_unveraenderlich.sql, Abschnitt 1 und 2). Der Übergangs-Trigger lässt ausschliesslich entwurf→festgeschrieben und entwurf→verworfen zu; der Unveränderlichkeits-Trigger vergleicht über `to_jsonb(old) = to_jsonb(new)` OHNE Spaltenliste, ausgenommen nur geaendert_am/geaendert_von/geaendert_von_art/aufbewahrung_bis. Eine Erlaubnisliste, die stillschweigend wächst, gibt es also wirklich nicht.
- Policy `d_rechnung_festschreiben` FOR UPDATE TO cse_definer: USING status='entwurf', WITH CHECK status='festgeschrieben' — exakt wie behauptet. `t_mandant` WITH CHECK erzwingt für cse_app status='entwurf', `t_verwerfen` nur →'verworfen'. Enum `rechnung_status` = entwurf|festgeschrieben|verworfen, kein Rückweg-Zustand.
- Auch der von der Behauptung nicht genannte Umgehungsweg ist zu: ein direktes INSERT mit status='festgeschrieben' (der Übergangs-Trigger ist nur BEFORE UPDATE) scheitert am deferred Constraint-Trigger `rechnung_verkettet` (drizzle/0077_rechnung_hash.sql:813-845), der Snapshot und Kettenglied verlangt.
- Die Tests prüfen die Sache, nicht den Irrtum: tests/isolation/rechnung.test.ts:152/:162 und der Block ab :379 fahren die UPDATEs als Tabelleneigentümer über `sql.unsafe` — also an RLS vorbei. Das ist der richtige Hebel, denn BEFORE-Trigger feuern auch für den Eigentümer. :495 zählt die sechs cse_definer-Policies.

WIDERLEGT wird trotzdem das Wort „GEBAUT" — am Weg des Menschen:
1. Der Seed trägt NULL Rechnungen: `select status,count(*) from rechnung` → 0 Zeilen. Ebenso rechnungsposition = 0, rechnung_hash = 0, rechnung_snapshot = 0. Es gibt heute keine einzige Zeile, an der man den Übergang sehen könnte.
2. Und es kann heute auch keine geben. Alle drei geseedeten Ausgangsrechnungs-Nummernkreise stehen auf `ist_platzhalter = true` (`select kreis_typ,count(*),count(*) filter (where ist_platzhalter) from nummernkreis where kreis_typ='ausgangsrechnung'` → 3 / 3). src/server/db/seed/index.ts:605-613 setzt das absichtlich so. src/server/services/finanz/nummernkreis.ts:204-210 weist daraufhin jede Nummernziehung mit `NummernkreisFehler('platzhalter', … O-134)` ab. docs/DECISIONS.md:2806 (O-134) sagt es ausdrücklich: „no invoice may be finalised anywhere until this is answered."
3. Es gibt keinen Weg, einen Kreis zu bestätigen: weder Seite noch Route noch Dienst setzt `ist_platzhalter = false` für ausgangsrechnung — `find src/app -ipath "*nummernkreis*"` liefert nichts, und in src/server/services/finanz/nummernkreis.ts kommt kein „bestaetig" vor. Die Tests umgehen genau das mit rohem Owner-SQL in `macheFakturierfaehig` (tests/isolation/rechnung.test.ts:60-79, `ist_platzhalter` → false). Die grüne Suite beweist also die Regel, nicht die Benutzbarkeit.
4. Die Oberfläche selbst ist echt und kein Stub: src/app/portal/[mandant]/finanzen/rechnungen/{page.tsx, neu/page.tsx, [id]/page.tsx} (499 Zeilen), kein `NochNichtGebaut`, Formulare auf /api/rechnungen/festschreiben (Zeile 395-414), /verwerfen (417-435), /storno (463). Der Knopf „Rechnung festschreiben" ist aktiv, sobald eine Position existiert — und läuft dann in den 409 „Platzhalter (O-134)" der Route (src/app/api/rechnungen/festschreiben/route.ts, ABWEISUNGEN). Die Warnung vor dem Platzhalterkreis steht nur auf .../rechnungen/neu/page.tsx:93-101, NICHT auf der Detailseite: wer direkt auf einem Entwurf landet, sieht einen fertig aussehenden Knopf und erfährt erst nach dem Klick, dass der Übergang gesperrt ist.

Kurz: die Einseitigkeit ist gebaut und mehrfach abgesichert — der Übergang, den sie einseitig macht, ist heute für keinen Menschen ausführbar. Nach dem Massstab „gebaut gilt nur, wenn ein Mensch es heute benutzen könnte" ist das TEILWEISE: Regel und Recht stehen, entwurf→verworfen ist begehbar (eigene Policy t_verwerfen, eigene Route), entwurf→festgeschrieben ist bis zur Beantwortung von O-134 bewusst gesperrt. Das ist kein Mangel, sondern die Arbeitsregel „niemals stillschweigend einen plausiblen Wert für eine Rechtsfrage wählen" — aber es ist auch nicht „GEBAUT".

Kein Widerspruch zu „Out of scope" in diesem Abschnitt: Lohnabrechnung/Jahresabschluss/E-Bilanz/Steuererklärung finden sich hier nirgends; die Plattform bereitet Belege vor und exportiert, mehr nicht.

#### 18 Finanzen — Invariante 4: die Nummer entsteht erst beim Festschreiben, per SELECT … FOR UPDATE, lückenlos

**Wirklich:** teilweise

Der Mechanismus stimmt, die Behauptung "GEBAUT" nicht. Ein Mensch kann heute in keiner der drei Gesellschaften eine Rechnung festschreiben.

WAS STIMMT (nachgeprüft, nicht nachgelesen):
- drizzle/0077_rechnung_hash.sql:405-660: `fin.rechnung_nummer_ziehen(uuid, jsonb)`, plpgsql, SECURITY DEFINER, search_path gesetzt. DB bestätigt: Eigentümer `cse_definer`, prosecdef = t; grant nur an `cse_app`. Kreissuche wirklich auf `geschlossen_am is null` (kein Jahresfilter); Sperre `select nk.* … where nk.id = v_kreis_id for update` NACH der Diagnose, Zähler danach `+1`, kein `nextval`. `nummernkreis_offen_key` (UNIQUE, partial WHERE geschlossen_am IS NULL) hält genau einen offenen Kreis je Geltungsbereich — sonst wäre das `select … into` ein Zufall.
- rechnung.ts:839-880 ruft beide Definer in EINER Transaktion, prüft `kopf === undefined`.
- Die zitierten Tests wiederholen den Irrtum des Codes nicht: 1.000 verworfene Entwürfe → Folge 1..10 (rechnung.test.ts:182ff), Rollback bewegt den Zähler nicht (:256), 50 echt gleichzeitige Festschreibungen über eigenen Pool (:278), zwei Mandanten getrennt (:323). Das sind Falsifikationen, keine Bestätigungen.

WORAN ES SCHEITERT:
1. Der Seed trägt keinen benutzbaren Rechnungskreis. `select … from nummernkreis`: alle drei `ausgangsrechnung`-Kreise heissen "Ausgangsrechnungen (unbestätigt)", `ist_platzhalter = t`, `zuruecksetzung = NULL`. Die Funktion bricht an genau dieser Stelle ab (0077:501-507, errcode restrict_violation) — VOR der Sperre. Es wird also heute in keiner Gesellschaft je eine Nummer gezogen.
2. Es gibt keinen Weg, den Platzhalter zu bestätigen. `/portal/[mandant]/finanzen/nummernkreise` steht im Manifest (src/server/registry/routen.generiert.ts:247, Phase 6) — im Dateisystem existiert sie nicht (`ls src/app/portal/[mandant]/finanzen/` → nur `rechnungen`; `find src/app -iname '*nummernkreis*'` → leer). Der Hinweistext der Datenbank ("Anzulegen unter Finanzen → Nummernkreise") schickt den Menschen auf eine Seite, die es nicht gibt. Klassische Falle 1.
3. Der Seed trägt keine einzige Rechnung: `select count(*) from rechnung` = 0, `rechnungsposition` = 0. Es gibt nichts, woran man die Lückenlosigkeit heute sehen könnte.
4. Der sichtbare Weg endet in rohem JSON. Die Seite src/app/portal/[mandant]/finanzen/rechnungen/[id]/page.tsx (499 Zeilen, kein NochNichtGebaut) zeigt "Rechnung festschreiben" (:397-413), aktiv sobald eine Position existiert — sie warnt NICHT vor dem Platzhalterkreis. POST → src/app/api/rechnungen/festschreiben/route.ts:97 gibt 409 als NextResponse.json zurück, während der Erfolgsfall ein 303-Redirect ist. Der Nutzer landet also auf einer JSON-Sackgasse mit "noch ein Platzhalter".
5. Die Tests setzen die Voraussetzung selbst, die weder Seed noch Oberfläche herstellen kann: tests/isolation/rechnung.test.ts:58-78 `macheFakturierfaehig()` legt per Eigentümer-SQL einen eigenen Kreis mit `ist_platzhalter = false`, `zuruecksetzung = 'nie'`, `jahr = 0`, Maske `RE-{nr:5}` an (daher erwartet der Test `RE-00001`, nicht die Seed-Maske `RE-{jahr}-{nr:5}`) und flippt `mandant.eigener_nummernkreis`. Die Tests beweisen den Mechanismus — nicht die Benutzbarkeit.
6. Das ist kein Versehen, sondern eine bewusst offene Entscheidung: docs/DECISIONS.md:2806 O-134 sagt wörtlich "no invoice may be finalised anywhere until this is answered". Und O-352 (DECISIONS.md:5081) lässt den Jahreswechsel offen: 0077:539-548 weist einen `jaehrlich`-Kreis am 1.1.2027 benannt ab, und den Nachfolgekreis eröffnet nichts im Code — Lückenlosigkeit über die Jahresgrenze ist damit heute unbelegt, nicht widerlegt.

NEBENBEI ZWEI UNGENAUIGKEITEN IM BELEG:
- src/server/services/finanz/nummernkreis.ts ist NICHT der Beleg für die Rechnungsnummer: `DEFINER_KREISE` (Zeile 55) schliesst `ausgangsrechnung`/`gutschrift` aus, `vergebeNummer` wirft dort `definer_kreis`. Das Modul trägt Angebot/Auftrag/Leistungsnachweis/Wachbuch, nicht die Rechnung.
- Latente Lücke: `nk_bestaetigt_hat_ruecksetzung` erzwingt `zuruecksetzung IS NOT NULL` nur für bestätigte Kreise; die Funktion prüft `= 'nie'` / `= 'jaehrlich'`. Ein Kreis, bei dem jemand nur `ist_platzhalter` umlegt, ohne `zuruecksetzung` zu setzen, fiele durch beide Prüfungen — der CHECK fängt das ab, solange der Weg über die (fehlende) Verwaltungsseite läuft. Solange es die Seite nicht gibt, ist das ungetestet.

Stand: TEILWEISE. Gebaut ist der Zug der Nummer samt Sperre und Beweis. Nicht gebaut ist alles, was einen Menschen dorthin bringt: Verwaltungsseite für Nummernkreise, ein bestätigter Kreis im Seed, eine einzige festgeschriebene Rechnung, der Jahreswechsel. Widerspruch zu einer Entscheidung oder zum Recht liegt nicht vor — im Gegenteil, die Sperre ist die ausdrücklich gewollte Vorsicht aus O-134.

#### 18 Finanzen — Hash-Kette über festgeschriebene Rechnungen (FIN-06)

**Wirklich:** teilweise

Die Kettenmaschinerie existiert und ist echt geprüft, aber FIN-06 ist nicht vollständig und im ausgelieferten Zustand für keinen Menschen erreichbar.

BELEGT RICHTIG: drizzle/0077_rechnung_hash.sql legt rechnung_snapshot (Z.66) und rechnung_hash (Z.107) an, fin.rechnung_kette_schreiben (Z.679, security definer; in der laufenden DB pg_proc.prosecdef = t) und fin.kette_unveraenderlich (Z.162) mit trg_rh_unveraenderlich / trg_rsn_unveraenderlich. hash-chain.ts 209 Z., kanonisch.ts 542 Z., kettenlauf.ts 491 Z. Der Isolationstest ist keine Tautologie: er schreibt über den echten Weg (finalisiere -> fin.rechnung_kette_schreiben) und rechnet mit verifyChain unabhängig in TS nach.

WIDERLEGT:
1) Der nächtliche Lauf existiert nicht. docs/SPEC.md:299 definiert FIN-06 als "Hash chain ... + nightly verification job". src/server/jobs/registry.ts kennt nur einsaetze_generieren, konflikte_erkennen, lead_sla_eskalation. pruefeKette (kettenlauf.ts:361) wird ausserhalb von tests/isolation/rechnung-kette.test.ts nirgends aufgerufen — kein Cron, keine Edge Function, keine Route, keine Seite. Die einzige UI mit Kettenprüfung ist src/app/portal/[mandant]/security/wachbuch/[id]/page.tsx (Wachbuch, nicht Rechnung). kettenlauf steht nur als Lesedienst in src/server/registry/dienste.ts:520.
2) Die frisch geseedete DB (cse_p5) enthält 0 Zeilen in rechnung, rechnung_hash und rechnung_snapshot. Nichts anzusehen. (Nebenbei: die Tabellen liegen in public, nicht in fin, wie die Behauptung suggeriert.)
3) Ein Mensch könnte heute auch keine erzeugen: der Seed legt den ausgangsrechnung-Kreis mit ist_platzhalter = true an (src/server/db/seed/index.ts:606-613), nummernkreis.ts:204 wirft dann 'platzhalter' vor der Sperre; docs/DECISIONS.md:2806 (O-134): "no invoice may be finalised anywhere until this is answered"; der Seed endet mit "OFFEN, bevor eine Rechnung entstehen kann: O-134" (index.ts:1035). Der Isolationstest läuft nur, weil sein beforeEach sich selbst einen Kreis mit ist_platzhalter = false einfügt (tests/isolation/rechnung-kette.test.ts:71-78).
4) Der Festschreibeweg selbst ist unfertig, und die gehashte Nutzlast trägt das: offenerBericht() in src/server/services/finanz/rechnung.ts:76-84 liefert geprueft:false ("§14-UStG-Vorabpruefung wird mit PR 47 gebaut"); Schritt 6 (offener Posten, Buchungssatz) steht als Kommentar (rechnung.ts:910-915).

Die Sperre unter 3 ist kein Widerspruch, sondern die richtige Zurückhaltung nach der Regel "nie eine Rechtsregel stillschweigend erfinden" — sie gehört aber in den Status, weil sie "Maschinerie steht" von "benutzbar" trennt. Möglich ist stattdessen: O-134 beantworten lassen, ist_platzhalter auf false setzen und den Prüflauf als Job registrieren; danach ist FIN-06 vollständig.

#### 18 Finanzen — Geld als Integer-Cent, USt je Steuersatzgruppe statt aus dem Brutto (Invariante 1)

**Wirklich:** teilweise

Der Kern der Behauptung ist belegt, drei ihrer Belege tragen aber nicht, was sie tragen sollen.

BESTAETIGT (nachgeprueft, nicht uebernommen):
- src/server/services/finanz/geld.ts (151 Z.), menge.ts (98 Z.), steuer/satz.ts (124 Z.) existieren mit den genannten Zeilenzahlen; `Cent` und `BasisPunkte` sind gebrandete Typen, es gibt kein `toNumber`, nur `assertSafeCents` (geld.ts:145). Die Lint-Regel `cse/no-float-money` ist real (eslint.config.js:34, eslint-rules/no-float-money.js) und hat eine Fixtur (tests/fixtures/lint/geld-als-number.ts).
- „alle Geldspalten bigint" haelt: `select … where data_type in ('double precision','real','money','numeric')` in cse_p5 liefert KEINE Geldspalte — `numeric` nur fuer Mengen (12,3), Geo (9,6), Prozent-/Punktwerte. Dazu Schema-Wachen tests/fixtures/wachen/geld-numeric.sql.
- CHECK `rechnung_brutto_stimmig` steht in drizzle/0075_rechnung.sql:588.
- `schreibeSummen` steht tatsaechlich bei rechnung.ts:327, gruppiert per SQL `group by g.id …`, ruft `berechneSteuer` und schreibt per UPSERT — nirgends wird aus einem Brutto zurueckgerechnet. Ich habe den ganzen Dienstbaum nach einer Brutto→Netto-Ableitung durchsucht: es gibt keine.
- Der Ausloeser `fin.rechnung_summen_stimmig` (0076:321/438) ist `deferrable initially deferred`, liest die Zeile NEU statt aus `NEW`, und prueft ausdruecklich AUCH JE GRUPPE (0076:399-415) — nicht nur `brutto = netto + steuer`. Test tests/isolation/rechnung.test.ts:675 existiert und trifft die Sache.
- tests/kern/geld.test.ts:87-157 enthaelt zwei echte Gegenproben („CONTROL: a blended rate on the total DIFFERS", „CONTROL: working VAT back out of a gross total DIFFERS") — die Pruefung wiederholt hier den Irrtum NICHT.
- Der Menschenweg existiert: src/app/portal/[mandant]/finanzen/rechnungen/{page.tsx,[id]/page.tsx,neu/page.tsx}, keine davon rendert `NochNichtGebaut` (das Bauteil wird nur von src/app/portal/unterseite.tsx benutzt); [id]/page.tsx:282-300 zeigt „Umsatzsteuer je Steuergruppe … §14 Abs. 4 Nr. 8 UStG"; Navigationseintrag src/server/registry/navigation.ts:48; Seed traegt 5 festgeschriebene Rechnungen (RE-2026-00001…00005, eine davon Storno) mit je einer `rechnung_steuer`-Zeile.

WAS NICHT TRAEGT:
1. „drizzle/0087_steuersatz_historie.sql datiert die Saetze" — die Migration entfernt zwar `ssg_schluessel_uk`, aber die Datierung ist heute wirkungslos UND selbstblockierend. In cse_p5 steht je Schluessel genau EINE Zeile (ust_19, ust_07, ust_0_13b_bau, ust_0_13b_reinigung, ust_0_4nr12), alle `gueltig_von = 2021-01-01`, alle `gueltig_bis NULL`. Und rechnung.ts:373-402 sagt selbst: sobald ein Schluessel zwei datierte Zeilen auf EINEM Beleg hat, wirft `schreibeSummen` `mehrdeutige_steuergruppe` — die Rechnung laesst sich dann gar nicht mehr summieren. Der Kommentar nennt die Ursache offen: aufgeloest wird am KOPF-Stichtag (rechnung.ts:258-270: leistung_bis → leistung_von → vereinnahmung_geplant_am → berlin_heute), nicht „je Position am Leistungsdatum DER POSITION", und das gehoert laut Code „an der Wurzel" behoben. D-374 schreibt die Stichtagsreihenfolge fest, diese Luecke aber steht in DECISIONS nicht unter „Offen". Zum ersten echten Satzwechsel bricht der Schreibweg, statt zu rechnen.
2. „USt je Steuersatzgruppe statt aus dem Brutto" ist im Seed nicht sichtbar. Alle 5 `rechnung_steuer`-Zeilen tragen 1900/S, jede Rechnung genau eine Gruppe, jede 10000/1900/11900 Cent. Bei EINER Gruppe sind „je Gruppe gerechnet" und „aus dem Brutto zurueckgerechnet" zahlenmaessig ununterscheidbar — kein Beleg im Seed zeigt 7 %, §13b-Reverse-Charge oder §4 Nr. 12, obwohl alle vier Gruppen in der Tabelle stehen. CLAUDE.md, Definition of done: „seed data exercises it" — hier tut er es nicht; nur die Unit-Tests tun es.
3. Ein zweiter Geldweg haelt die Zusage gar nicht: src/server/services/angebot/index.ts:70 `export const REGELSATZ_BP = 1900` — ein Satz-Literal im TypeScript, nicht aus `steuersatz_gruppe` zum Leistungsdatum, mit offenem `// TODO(client, O-60)` fuer ermaessigte, steuerfreie und §13b-Faelle (Z. 63-69). Alle 66 geseedeten `angebotsposition` tragen genau einen `steuersatz_bp`. Die Tabelle `angebot_steuer` wird von keinem Dienst geschrieben (Treffer nur in src/server/db/schema/rls.ts:198 und :1546 sowie im Seed, 5 Zeilen) — die Gruppen-Aufschluesselung existiert nur auf der Rechnungsseite.

Nebenbefund (Tiefe, kein Widerspruch): `rechnung_summen_stimmig` haengt nur an `rechnung` (insert/update). Auf `rechnungsposition`/`rechnung_steuer` liegen nur Audit-, Kein-Hard-Delete- und Unveraenderlich-Ausloeser. Eine Position, die ohne Kopf-Update eingefuegt wird, laeuft an der Nachrechnung vorbei; der Dienst fasst den Kopf zwar immer an, die zweite Verteidigungslinie greift an dieser Stelle also nur ueber den Dienst.

Zu den ausdruecklich zu pruefenden Widerspruechen: in diesem Abschnitt entsteht keiner. Keine Lohnabrechnung, kein Jahresabschluss, keine E-Bilanz, keine Steuererklaerung und kein DATEV-Einreichweg sind gebaut — `find src/app -ipath "*lohn*" -o -ipath "*bilanz*" -o -ipath "*datev*"` ist leer, die Begriffe kommen nur als Abgrenzung in src/lib/annahmen.ts und Zeit-/Abwesenheitsdiensten vor. Das ist korrekt so (CLAUDE.md „Out of scope"): die Plattform bereitet auf und exportiert, Lohnsystem und Steuerberater rechnen. Moeglich bleibt stattdessen der Export — und genau der (`/finanzen/rechnungen/[id]/xrechnung`, `/versand`) ist im Manifest Phase 6 und im Dateisystem noch nicht als Seite vorhanden.

Verdikt: Invariante 1 haelt dort, wohin der staerkste Beleg zeigt (Rechnung), aber nicht in der Breite, die die Behauptung beansprucht. TEILWEISE.

#### 20 DATEV — Keine gefälschte Schnittstelle

**Wirklich:** teilweise

Die Behauptung haelt in ihrem harten Kern (es gibt keinen simulierten DATEV-Aufruf), aber „GEBAUT" stimmt nicht, und zwei Belege der Behauptung sind falsch.

1) FALSCHER BELEG: „src/lib/annahmen.ts:25/:247 (offene Annahme O-05, dem Nutzer angezeigt)". O-05 wird keinem Nutzer angezeigt. `grep -rn "annahmen" src/ scripts/ package.json` findet als einzigen Verbraucher von `src/lib/annahmen.ts` die Datei `scripts/annahmen.ts:15`, die daraus `docs/ANNAHMEN.md` erzeugt (package.json:29 `"annahmen": "tsx scripts/annahmen.ts"`). Kein Import in `src/app/**` oder `src/components/**`. O-05 steht in `docs/ANNAHMEN.md:151` — ein Dokument, kein Beleg.

2) HALBE REGEL. CLAUDE.md „No fake integrations" verlangt zweierlei: nicht simulieren UND „build the interface, mark it clearly in the UI as 'not connected'"; ROADMAP.md:212 ebenso: „Interface only until credentials exist". Teil eins haelt. Teil zwei existiert nirgends: kein Dienst, keine Tabelle, kein Status. `find src/app -ipath '*buchhaltung*' -o -ipath '*einstellung*'` ergibt NICHTS (127 `page.tsx` gesamt, keine davon). In der DB (`cse_p5`, 141 Tabellen) gibt es keine Buchhaltungs-, Export- oder Integrationstabelle; `erloeskonto_schluessel` ist in `leistungskatalog_position` (0 von 1), `angebotsposition` (0 von 66), `rechnungsposition` (0 von 5) und `auftrag_leistung` ueberall NULL — korrekt offen, siehe `drizzle/0022_leistungskatalog.sql:103` und `drizzle/0050_auftrag_leistung.sql:87` `// TODO(client, O-05)`. Wie das Haus es sonst macht, sieht man an `src/server/services/bau/wetter.ts:45` (`'nicht_verbunden'`) und `src/server/services/bau/behinderung.ts:94` (`KanalNichtVerbundenFehler`) — fuer DATEV gibt es kein Gegenstueck.

3) WAS EIN MENSCH HEUTE SIEHT. Ein Admin haelt `buchhaltung.exportieren` (rolle_berechtigung: admin, super_admin). Ruft er `/portal/<slug>/buchhaltung/datev` (routen.generiert.ts:253, „export list + connection status", phase 7), faengt ihn `src/app/portal/[mandant]/[...rest]/page.tsx` → `src/app/portal/unterseite.tsx:113` → `src/components/portal/NochNichtGebaut.tsx:53`: „Dieses Modul wird noch gebaut … in Phase 7". Ehrlich und richtig — aber das ist GEPLANT-UND-NOCH-NICHT-DRAN (ROADMAP Phase 7 ist unangehakt), nicht GEBAUT. Nebenbefund: `routen.generiert.ts:360` fuehrt `/portal/[mandant]/einstellungen/integrationen` („DATEV · social · … each verbunden / nicht verbunden") als **phase 2** — genau die Flaeche, die „nicht verbunden" anzeigen soll, ist nominell seit drei Phasen faellig, ungebaut, und das Platzhalterblatt sagt dem Nutzer „entsteht in Phase 2", waehrend der Zweig Phase 5 abschliesst.

4) KEINE PRUEFUNG. Kein Test prueft die Regel. Die scheinbaren Treffer in `tests/` sind die Zeichenfolge „extf" in „Textfeld"/„Freitextfeld". Der einzige echte Treffer ist `tests/kern/dokument.test.ts:211`, und der wiederholt nur die Konstante aus `src/server/storage/signatur.ts:18` — er prueft das Vokabular gegen sich selbst, nicht die Sache. Der Beleg der Behauptung ist ein heute von Hand gelaufenes grep, keine Wache: ein spaeterer Attrappen-Aufruf faellt durch nichts auf.

5) LOSES ENDE. `'datev_beleg'` in `src/server/storage/signatur.ts:18` ist totes Vokabular — in `src/` und `drizzle/` gibt es weder Erzeuger noch Verbraucher. Der einzige Ort, an dem der Code schon ein DATEV-Artefakt behauptet.

Kein Widerspruch zu „Out of scope": Lohnabrechnung/Jahresabschluss/E-Bilanz werden nicht gebaut; `/buchhaltung/lohnexport` (routen.generiert.ts:265) ist ausdruecklich Zeit-EXPORT fuer ein Lohnsystem, ungebaut, Phase 7 — das ist die zulaessige Vorbereitung, nicht die Abrechnung.

Richtige Formulierung: „Es wurde nichts Gefaelschtes gebaut" — nicht „gebaut". Fuer GEBAUT fehlt die Schnittstelle mit sichtbarem „nicht verbunden" und ein Test, der das Simulieren verhindert statt es nur heute nicht vorzufinden.

#### 23 Dokumentenzentrale — Zugriffskontrolle nach Rolle und Mandant (DOC-04)

**Wirklich:** teilweise

Die Behauptung ist in ihren DB-Aussagen korrekt, aber sie belegt nicht, was sie behauptet: ein Mensch kann DOC-04 heute nicht benutzen.

WAS STIMMT (nachgeprueft, nicht uebernommen):
- `dokument` hat relrowsecurity=t UND relforcerowsecurity=t; genau die fuenf genannten Policies existieren mit den genannten Ausdruecken (pg_policy): t_mandant (ALL, permissive, USING mandant_id=app.aktiver_mandant() AND app.hat_recht('dokument.lesen'), WITH CHECK ...'dokument.schreiben' AND NOT app.ist_readonly()), p_kunde_ceiling und p_ma_ceiling (polpermissive=f, also echt RESTRICTIVE), t_person (SELECT), t_gruppe (SELECT, gruppe.dokument.lesen).
- Alle sieben Rechte liegen in `berechtigung` und sind in `rolle_berechtigung` an Rollen vergeben (admin/leitung/super_admin/kunde/mitarbeiter/formular_eingang).
- tests/isolation/dokument.test.ts (208 Zeilen) prueft echt gegen die Policies via `alsApp` und wiederholt nicht bloss den Code.

WARUM „GEBAUT" TROTZDEM FALSCH IST:
1. Es gibt keine einzige Seite. `find src/app -name page.tsx | grep -i dokument` = leer (127 Seiten insgesamt, keine davon Dokumente). Alle elf Dokument-Routen im Manifest (src/server/registry/routen.generiert.ts Z. 266–271, 385, 417–418, 436–437) fallen in die Catch-alls `src/app/portal/[mandant]/[...rest]/page.tsx`, `portal/mein/[...rest]`, `portal/kunde/[...rest]`, `portal/gruppe/[...rest]` und rendern `NochNichtGebaut` (src/app/portal/unterseite.tsx Z. 88–99: "gebaut sind die von Phase 3"; Dokumente ist phase 4 bzw. 7). Genau Falle 1 der Pruefanweisung.
2. Der Verweis fuehrt ins Leere, nicht ins Nichts: src/server/registry/navigation.ts Z. 49 zeigt jedem mit `dokument.lesen` einen Tab „Dokumente" → /portal/[mandant]/dokumente → NochNichtGebaut.
3. Der Seed traegt keine einzige Zeile: `select count(*) from dokument` = 0, `dokument_version` = 0 (nur `dokument_aufbewahrung` hat 9 Regelzeilen). Es gibt also nichts, woran ein Mensch die Zugriffskontrolle sehen koennte — die Policies sind heute nur gegen die leere Menge wirksam.
4. Kein Lesepfad in Produktion: keine API-Route beruehrt `dokument` (52 route.ts, keine Dokument-Route; `api/medien/[id]` ist einsatz-medien). `erzeugeSignatur`/`pruefeSignatur` aus src/server/storage/signatur.ts werden in src/** NIRGENDS aufgerufen — nur im Test. Der einzige Produktivpfad, der je ein Dokument erzeugt, ist der oeffentliche LV-Upload in src/app/api/anfrage/route.ts Z. 205 (`ladeHoch`, Kategorie 'angebot') — Schreiben ohne jeden Weg zurueck zum Lesen.
5. Die Pruefung hat eine Luecke an genau der behaupteten Stelle: „nach Rolle" wird nicht getestet. Der Test nutzt nur Rollen, die `dokument.lesen` haben (leitung) bzw. das Mitarbeiterportal; es gibt keinen Fall „Benutzer im richtigen Mandanten, aber OHNE dokument.lesen sieht 0". Grep nach `hat_recht`/`dokument.lesen` in tests/isolation/dokument.test.ts: kein Treffer. Getestet ist die Mandantentrennung (Akzeptanz 4) und die Loeschsperre (5), nicht die Rechtestufe.
6. Zwei inhaltliche Unstimmigkeiten, die der Behauptung widersprechen: (a) Rolle `mitarbeiter` hat `dokument.schreiben`, aber NICHT `dokument.lesen` — unter t_mandant darf sie im Portal 'intern' einfuegen und das Eingefuegte nie wiedersehen. (b) t_person scopet gar nicht auf die Person: USING ist portal='mitarbeiter' AND mandant_id = ANY(sichtbare_mandanten) AND sichtbar_fuer_mitarbeiter — kein person_id/anstellung_id. Das Manifest verspricht fuer /portal/mein/dokumente aber "documents relevant to me" (Z. 417). „Nach Rolle und Mandant" trifft zu, „nach Person" nicht.
7. DOC-05 (Zugriffsprotokoll), das die Route /portal/[mandant]/dokumente/[id] mitfuehrt, existiert nicht: `information_schema.tables` mit '%zugriff%' = 0 Treffer.

Richtiger Stand: Schema- und Policy-Schicht fuer DOC-04 steht und ist geprueft; Modul, Seiten, Dienst-Lesepfad, Seed und Rechte-Test fehlen. Das ist TEILWEISE — und liegt roadmap-konform noch vor der Reihe (Phase 4/7, Branch ist Phase-5-Abschluss), also GEPLANT-UND-NOCH-NICHT-DRAN fuer den Modulteil, kein Widerspruch zu einer Entscheidung oder zum Recht. Redlich waere: „DB-Zugriffskontrolle gebaut und getestet, Dokumentenzentrale selbst nicht."

#### 17 Social-Media-Zentrale — „Do not fake integrations“ im Social-Bereich

**Wirklich:** fehlt_ganz

Die Behauptung haelt nicht. Sie belegt ein Hausmuster aus DREI FREMDEN Domaenen und erklaert damit den Social-Bereich fuer gebaut — dort existiert aber nichts, was faelschen oder nicht-faelschen koennte.

1) Keine Seite. `find src/app -ipath "*social*"` ist leer. Die sieben Manifest-Adressen (src/server/registry/routen.generiert.ts:304-310: /portal/[mandant]/social, /social/posts, /social/posts/neu, /social/posts/[id], /social/posts/[id]/planung, /social/kanaele, /social/statistik) tragen alle `phase: 9` und fallen in den Catch-all src/app/portal/[mandant]/[...rest]/page.tsx -> src/app/portal/unterseite.tsx -> src/components/portal/NochNichtGebaut.tsx:50 ("Dieses Modul wird noch gebaut ... in Phase 9"). Nach der Vorgabe der Pruefung ist das TEILWEISE, nie GEBAUT. Insbesondere /social/kanaele — genau die Seite, die SOC-07 "nicht verbunden" anzeigen muesste — rendert den Platzhalter. Ebenso fehlt /portal/[mandant]/einstellungen/integrationen (routen.generiert.ts:360, fuehrt ACC-02, SOC-06, SOC-07 ausdruecklich): das Verzeichnis src/app/portal/[mandant]/einstellungen existiert nicht.

2) Kein Dienst, kein Interface. `find src/server -ipath "*social*"` ist leer; `grep -rn "SocialChannel"` ueber src/ hat keinen Treffer. SOC-06 verlangt Instagram/Facebook/LinkedIn/TikTok/YouTube hinter einem `SocialChannel`-Interface — es gibt weder Interface noch Implementierung noch einen Fehlertyp fuer einen nicht verbundenen Social-Kanal.

3) Keine Tabelle, kein Enum, kein Seed. 144 Tabellen in cse_p5, darunter kein social_post und kein social_kanal. Die einzigen Kanal-Enums sind behinderung_versandart (portal, bote, bauleiterprotokoll, e_mail, brief, einschreiben) und benachrichtigung_kanal (email, app). tests/kern/routen-manifest.test.ts:384 sagt es selbst: Module, "die es noch nicht gibt: ... `social_post`".

4) Kein Recht in Benutzung. social.lesen, social.schreiben, social.freigeben, social.planen, social.kanal_verbinden und gruppe.social.lesen stehen alle sechs auf der eingefrorenen Warteliste tests/kern/katalog-unbenutzt.ts:126,186-190 — "Katalogschluessel, die heute noch kein Code prueft".

5) Keine Pruefung. `grep -rn -i social tests/` findet nur diese Warteliste und einen Kommentar. Es gibt keinen Test, der einen nicht verbundenen Social-Kanal abweist — die Sache wird also nicht geprueft.

6) Die zitierten Belege gehoeren woanders hin: src/server/storage/adapter.ts:59-71 ist Supabase Storage, src/server/versand/dwd.ts:245-252 der Wetterdienst, src/server/services/bau/behinderung.ts:94-103 der VOB/B-Versandweg (Brief, Einschreiben, Bote, E-Mail, Portal). Alle drei sind echt und korrekt — sie belegen ein Hausmuster, nicht dessen Anwendung im Social-Bereich. Das ist genau Falle 3 (ein Muster anderswo ist kein Beleg hier) und Falle 2 (Manifestzeile plus Recht ist kein Modul).

7) docs/ROADMAP.md:243-244 fuehrt "[ ] Social Media Center ..." und "[ ] External channels behind an interface, marked 'not connected'" beide unabgehakt unter Phase 9; der Branch steht in Phase 5.

Was tatsaechlich existiert, und nur das: src/server/agent/policy.ts:23,44 fuehrt die Aktion `social_veroeffentlichen`, und src/server/db/seed/index.ts:661 legt je Mandant eine agent_richtlinie an — die DB bestaetigt 4 Zeilen mit auto_erlaubt = false. Das erfuellt SOC-08 / Invariante 7 (nichts geht ohne menschliche Freigabe raus), nicht SOC-07 (Kanaele zeigen "nicht verbunden" und werden nie simuliert). Zwei verschiedene Anforderungen; die Behauptung verwechselt sie.

Es wird im Social-Bereich zwar nichts simuliert — aber nur, weil es dort nichts gibt. "Kein simulierter Kanal" ist hier eine leere Wahrheit und kein gebautes Verhalten. Ein Mensch kann heute keinen Kanal verbinden, keinen Verbindungsstatus sehen und keinen Beitrag entwerfen. Richtiger Stand fuer SOC-06/SOC-07: fehlt ganz (geplant, Phase 9). Kein Widerspruch zu Recht oder Entscheidung — die UWG-Substanz haengt anderswo (docs/DECISIONS.md:17,917, D-99 Zeile 1616, kern.uwg_sendetor()).

#### 27 Technik — Next.js — Next.js 15 App Router

**Wirklich:** teilweise

Der Kern haelt, die Belege nicht — und die Datei, die als Beleg genannt wird, ist unvollstaendig.

WAS STIMMT (nachgeprueft, nicht nachgesprochen):
- App Router ist echt in Betrieb, nicht nur deklariert. /home/user/phase5-e2e/.next/routes-manifest.json (Build vom 12.09. 02:46, BUILD_ID bEmGQzf1LEHPDtLvgmukD) fuehrt 30 staticRoutes + 122 dynamicRoutes. src/middleware.ts setzt KOPF_SPRACHE/KOPF_PFAD auf die Anfrage; src/app/layout.tsx, verschachtelte Layouts, Server Components und 53 route.ts sind echter App-Router-Code.
- Die 308er sind KEINE tote Konfiguration mehr: routes-manifest.json enthaelt 31 redirects mit statusCode 308, u.a. /index.html -> /. Das ist der Build-Artefakt-Beleg, nicht nur die Tabelle in src/lib/weiterleitungen.ts.
- Die oeffentlichen Seiten fehlen nicht, obwohl es im Dateibaum so aussieht: /leistungen, /news, /projekte, /ueber-uns, /kontakt, /unternehmen/* werden von src/app/(public)/[seite]/page.tsx aus der DB bedient — Tabelle `seite` traegt 26 Zeilen (13 de + 13 en). Geprueft per psql.

WAS NICHT STIMMT — drei Fehler im Beleg:

1. `next: ^15.1.6` ist nicht die laufende Version, und sie KANN es nicht sein. pnpm-lock.yaml:1673 und node_modules/next/package.json: 15.5.25. Das ist nicht kosmetisch: next.config.ts:6 nutzt `typedRoutes` als TOP-LEVEL-Schluessel und Zeile 63 `allowedDevOrigins` — beides gibt es erst ab Next 15.3. Unter einem echten 15.1.6 waere `typedRoutes: true` ein unbekannter Schluessel, Next wuerde warnen und typisierte Routen NICHT einschalten. Der Behauptende zitiert also eine Version, unter der sein zweiter Beleg nicht funktionieren wuerde.

2. `51 route.ts` ist falsch: es sind 53 (`git ls-files 'src/app/**/route.ts' | wc -l` = 53, `find` = 53).

3. `127 Dateien src/app/**/page.tsx` zaehlt fuenf Platzhalter mit. src/app/portal/[mandant]/[...rest]/page.tsx, portal/gruppe/[...rest], portal/kunde/[...rest], portal/mein/[...rest] und portal/konto/[[...rest]] rendern ueber src/app/portal/unterseite.tsx die Komponente src/components/portal/NochNichtGebaut.tsx. Der Kommentar in unterseite.tsx sagt es selbst: „432 Routen; gebaut sind die von Phase 3." Von 376 Portal-Routen im Manifest haben rund 102 eine eigene Seite; der Rest faellt auf diese fuenf Dateien. Eine Zahl, die 5 Catch-alls wie 5 Seiten zaehlt, taugt nicht als Umfangsbeleg.

DER EIGENTLICHE BEFUND — next.config.ts wird als Beleg genannt und ist luecken haft:
docs/architecture/01-ORDNERSTRUKTUR.md:3269 legt genau fuer diese Datei fest: EU-Region (D-04), typedRoutes, `images.remotePatterns` auf den Marketing-Host begrenzt, und die Sicherheitskoepfe ausser CSP — HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy (SEC-A7) — plus `experimental.serverActions.allowedOrigins`. docs/SPEC.md:552 fuehrt SEC-A7, docs/architecture/03-AUTH-BERECHTIGUNGEN.md:494 buchstabiert HSTS (2 Jahre, includeSubDomains, preload) aus.
Vorhanden ist davon nur D-04 (env VERCEL_REGION 'fra1') und typedRoutes. `grep -rn "Strict-Transport-Security|X-Frame-Options|Referrer-Policy|X-Content-Type-Options|remotePatterns|serverActions"` ueber src und next.config.ts: null Treffer. Bestaetigt am Build-Artefakt: .next/routes-manifest.json `headers` ist ein leeres Array. Auch der CSP-Nonce, den 04-SEITENKARTE.md:605 und LEG-07 in middleware.ts verlangen, ist dort nicht — src/middleware.ts setzt nur Sprache und Pfad.
Das ist kein Doku-Versprechen ohne Code, sondern das Gegenteil: Code, dem eine Zusage aus SPEC und Architektur fehlt, in genau der Datei, die als Nachweis dient.

Keine Pruefung deckt das ab: docs/architecture/01-ORDNERSTRUKTUR.md:3019 sieht `tests/e2e/security/headers.spec.ts` vor („CSP + HSTS present") — die Datei existiert in tests/e2e/ nicht. Fuer die 308er gibt es ebenfalls keine Probe, die eine echte Antwort misst; tests/isolation/inhalt-import.test.ts:154 liest nur die Tabelle auf gueltige Ziele. Die 308er stehen trotzdem, weil das Build-Manifest sie traegt.

Kein Widerspruch zu CLAUDE.md „Out of scope" in diesem Abschnitt: Next.js beruehrt weder Kaltakquise (§7 UWG), Jobboard-Scraping, Lohnabrechnung noch automatische Vergabe-Einreichung.

EINSTUFUNG: TEILWEISE. Der App Router selbst ist benutzbar und gebaut — ein Mensch kann heute damit arbeiten. Aber „GEBAUT" mit diesen drei Belegen haelt nicht: die Versionsangabe widerspricht der genutzten Konfiguration, die Routenzahl ist falsch, die Seitenzahl zaehlt Platzhalter mit, und next.config.ts — der dritte Beleg — fehlt SEC-A7 vollstaendig.

#### 28 Datenmodell — users — `benutzer`

**Wirklich:** teilweise

Die Zahlen der Behauptung stimmen alle — und tragen trotzdem nicht bis „GEBAUT".

NACHGEPRUEFT UND RICHTIG
- `\d benutzer` in cse_p5: Tabelle da, 3 ausgehende FK (`id`→`auth.users` ON DELETE RESTRICT, `person_id`→`person`, `globale_rolle_id`→`rolle`), genau 3 CHECK (`benutzer_kennung`, `benutzer_dienstkonto_ohne_mensch`, `benutzer_status_stimmig`), RLS nicht nur `enable`, sondern `force` (pg_class.relforcerowsecurity = t), 12 Zeilen. Quelle `drizzle/0007_benutzer_auth.sql`.
- Kein `mandant_id`, Zuordnung ueber `benutzer_mandant` — stimmt und ist richtig: `benutzer_mandant(benutzer_id, mandant_id, rolle_id, ist_standard, gueltig_ab/bis, entzogen_am)`, Unique je (benutzer, mandant) und genau ein `ist_standard` je Benutzer, Trigger `trg_bm_rolle_pruefen`, kein Hard-Delete, 17 Seed-Zeilen ueber alle vier Gesellschaften. Deckt sich mit D-33/K-04.

WARUM TROTZDEM NICHT „GEBAUT" — ein Mensch kann es heute nicht benutzen
1. Es gibt keine Anmeldung. `src/app/portal/Anmeldung.tsx:10-12` und `:20-23` sagen es selbst: Telefon + Einmalcode kommt mit PR 20. Einziger Sitzungsaussteller ist `/dev/anmelden` hinter `CSE_DEV_FLAECHEN` (`src/app/dev/anmelden/page.tsx:9-14`, `notFound()` in Zeile 50). `docs/ROADMAP.md` Z. 31-38 schreibt es wortgleich fest; Aufgabe „PR 20 bauen" steht offen. Ein Konto, an dem sich niemand anmelden kann, ist ein Datensatz, kein Zugang.
2. Die Verwaltungsseite existiert nicht — Falle 1 in Reinform. Manifest `src/server/registry/routen.generiert.ts:349-350` fuehrt `/portal/[mandant]/einstellungen/benutzer` (+ `/[id]`) als Phase 1, „users of this mandant, invitations, session list, 2FA state". Im Dateisystem gibt es `src/app/portal/[mandant]/einstellungen` nicht; die Adresse faellt in den Catch-all `src/app/portal/[mandant]/[...rest]/page.tsx` → `src/app/portal/unterseite.tsx` → `NochNichtGebaut`. Also: Adresse ja, Seite nein.
3. Kein Schreibweg ausser dem Seed. `insert into benutzer` steht ausschliesslich in `src/server/db/seed/index.ts:241, 289, 363, 803`. `system.benutzer_verwalten` kommt in `src/` nur im generierten Manifest und in der Policy `t_bm_schreiben` vor — kein Dienst, keine Route, kein Formular. Folge: die Enum-Werte `eingeladen`, `gesperrt`, `deaktiviert` sind unerreichbar, alle 12 Seed-Zeilen stehen auf `aktiv`.
4. Tote Spalten. `letzter_login_am` ist in 0 von 12 Zeilen gefuellt; `letzte_ip` und `gesperrt_bis` schreibt nur `app.versuch_protokollieren` (0007, Z. 379-424). Aufrufer davon: `tests/isolation/auth.test.ts:199, 222, 244` und die Eigentumsliste in `tests/isolation/definer-eigentum.test.ts:61` — kein Produktionscode. `kern.anmeldeversuch` hat 0 Zeilen. Sperre und Rate-Limit (AUT-07) sind in SQL da und in SQL geprueft; der Test prueft die Funktion, nicht den Weg — Falle 3.
5. „2FA state" ist gesetzt, nicht erzwungen. `src/server/auth/sitzung.ts:173` schreibt `aal` fest als `'aal2'` beim Ausstellen der Dev-Sitzung; in der DB steht folglich nur `aal2`. `auth.mfa_factors` ist der lokale Shim aus 0007 mit 4 geseedeten Zeilen, ohne Einrichtungspfad. D-33 („der zweite Faktor ist eine Eigenschaft der Anmeldung") beschreibt damit einen Zustand, den dieser Build nicht herstellt: er ist Eigenschaft des Seeds. `trg_benutzer_2fa_pflicht` und `p_bm_aal2` (RESTRICTIVE, INSERT, `app.aal()='aal2'`) laufen darum immer ins Wahre.
6. Kein Drizzle-Modell. CLAUDE.md legt Drizzle als ORM fest, `src/server/db/schema/` enthaelt nur `rls.ts`, und unter `src/server/db/` gibt es kein einziges `pgTable`. „Datenmodell — users" ist als SQL-Migration gebaut, als Modell der festgelegten Schicht nicht.

WIDERSPRUCH: keiner. Das Benutzermodell beruehrt weder Kaltakquise (§ 7 UWG), noch Scraping, noch Lohnabrechnung, noch automatische Vergabe-Einreichung.

EINSTUFUNG: Tabelle und Rechtemodell GEBAUT; Anmeldung, Einladung, Benutzerverwaltung und zweiter Faktor FEHLEN. Damit insgesamt TEILWEISE. Belastbar waere: „Schema und RLS stehen (0007), der Zugangsweg nicht — PR 20 offen, `einstellungen/benutzer` rendert NochNichtGebaut."

#### 28 Datenmodell — roles — `rolle`

**Wirklich:** teilweise

Die Zahlen stimmen, der Beleg und die Kernaussage nicht.

1) Falsche Migration. `rolle` wird NICHT in `drizzle/0001_rollen_und_mandant.sql` angelegt, sondern in `/home/user/phase5-e2e/drizzle/0007_benutzer_auth.sql:109` (`create table rolle`). 0001 legt die sechs Postgres-CLUSTER-Rollen an (cse_migrator, cse_definer, cse_app, cse_anon, cse_checkin, cse_job) und die Tabelle `mandant` — keine Tabelle `rolle`. Der Dateiname „rollen" meint dort Datenbankrollen. Auch das Repo selbst weiss es besser: `src/server/db/schema/rls.ts:1482` fuehrt `{ tabelle: 'rolle', migration: '0007' }`. Die Behauptung hat den Dateinamen gelesen, nicht die Datei.

2) „Rollen je Mandant konfigurierbar" ist nicht gebaut — auf keiner der vier Ebenen.
   - Kein Weg des Menschen: `src/app/portal/[mandant]/` hat gar kein Verzeichnis `einstellungen` (vorhanden nur: angebote, auftraege, bau, crm, dienstplan, finanzen, objekte, personal, qualitaet, reinigung, security, zeiten, `[...rest]`). Die Manifestrouten `/portal/[mandant]/einstellungen/rollen` und `/[rolle]` (`src/server/registry/routen.generiert.ts:351-352`, Beschreibung „the permission matrix, editable per mandant") fallen auf `src/app/portal/[mandant]/[...rest]/page.tsx` → `MandantUnterseite` → `NochNichtGebaut` (`src/app/portal/unterseite.tsx:6`). Genau Falle 1 der Pruefanweisung.
   - Kein Dienst, keine API: kein Treffer unter `src/app/api/**` fuer rolle/einstellungen; in `src/server/services/` kommt „rolle" nur als Unterschrifts-Rolle (aufmass, leistungsnachweis) vor, nie als Rollenverwaltung.
   - Kein Recht in der DB: `grant select on rolle to cse_app` (0007:711) ist der einzige Grant; information_schema bestaetigt fuer cse_app ausschliesslich SELECT. Die einzige Policy ist `t_rolle_lesen FOR SELECT`. Ein Anlegen oder Aendern einer Mandantenrolle durch die Anwendung ist heute nicht nur ungebaut, sondern technisch ausgeschlossen. Die Rechte `system.rolle_lesen` / `system.rolle_verwalten` existieren zwar (`src/server/auth/katalog.generiert.ts:223-224`), haben aber keinen Verbraucher ausser der Routenwache.
   - Keine Zeile im Seed: `select count(*) filter (where mandant_id is not null) from rolle` → **0**. Alle 7 Zeilen haben `mandant_id = NULL` und `ist_system = true`; die beiden vom Seed ergaenzten (`website_renderer`, `formular_eingang`, `src/server/db/seed/index.ts:272,336`) werden ebenfalls ohne `mandant_id` eingefuegt. Auch `rolle_berechtigung`: 532 Zeilen, davon 0 mit `mandant_id`. Der mandantenspezifische Zuschnitt ist im ganzen System nirgends exemplarisch vorhanden.

3) Keine Pruefung deckt die Aussage. `tests/isolation/rollen.test.ts` laeuft ueber das 432-Zeilen-Routenmanifest und prueft Zugangsentscheidungen gegen die Seed-Sitzungen; es legt keine Rolle mit `mandant_id` an und prueft die Konfigurierbarkeit nicht. Der Test wiederholt damit den Stand des Codes, er widerlegt ihn nicht.

Was tatsaechlich haelt: Tabelle existiert (0007:109), RLS an und erzwungen (`relrowsecurity`/`relforcerowsecurity` beide `t`), 1 FK (`mandant_id → mandant`), 2 CHECKs (`rolle_portal_check`, `rolle_schluessel_check`), 7 Zeilen; dazu — in der Behauptung unerwaehnt — ein partieller Unique-Index `rolle_schluessel_key (mandant_id, schluessel) nulls not distinct`, Hard-Delete- und Truncate-Sperre (`rls.ts:435`, art `archiv`, Begruendung AUT-03/SEC-A9) und der `geaendert_am`-Trigger.

Fazit: Die Spalte `rolle.mandant_id` ist vorbereitet und kommentiert („NULL = Plattformrolle; gesetzt = eigener Zuschnitt eines Mandanten (AUT-03)", 0007:110), aber nichts kann sie heute setzen und nichts zeigt sie vor. Das ist genau Falle 2: eine Spalte ist kein Modul. Stand: TEILWEISE — Schema gebaut, Verwaltung (Seite, Dienst, Schreibrecht, Seed) fehlt. Ein Widerspruch zu „Out of scope" oder zu einer DECISIONS-Nummer liegt hier nicht vor.

#### 28 Datenmodell — employees — `person` + `anstellung` (D-09)

**Wirklich:** teilweise

Schema und Recht halten stand, die Benutzbarkeit nicht. STIMMT: drizzle/0002_person_anstellung.sql legt `person` ohne mandant_id an und `anstellung` mit mandant_id plus den Composite-Uniques (mandant_id,id) und (id,person_id); pg_class zeigt fuer beide relrowsecurity UND relforcerowsecurity = t; `app.arbzg_belastung` (SECURITY DEFINER) filtert zeit_intern.arbeitszeit_fenster ohne mandant_id-Praedikat, gibt nur fenster_gruppe/beginn/ende/minuten/fremd zurueck und protokolliert `fremde_zeilen` VOR dem Ergebnis; 0064 leitet bei p_mandanten=null die Gesellschaften selbst ab und hebt bei leerer Ableitung statt still durchzulaufen; der Seed traegt den Fall wirklich (Fatima Yildiz: eine person-Zeile, zwei anstellung-Zeilen in b3d7f729 und 45df89fc, Arbeitszeitfenster in BEIDEN: 16 + 6); tests/isolation/arbzg-uebergreifend.test.ts baut die zwei Mandanten ueber rohes SQL selbst auf und behauptet 660 Minuten plus Kontrollfall, Feld-fuer-Feld-Leckliste und 42501 — es wiederholt den Irrtum des Codes nicht. cse_app hat auf stundensatz_intern INSERT/UPDATE, aber kein SELECT (K-05 greift). WIDERLEGT dennoch „GEBAUT": (1) Von 10 Routen des Abschnitts 5.12 im Manifest (routen.generiert.ts:193-202, alle als Phase 3 gefuehrt, also zwei Phasen ueberfaellig) existieren im Dateisystem nur drei page.tsx: personal/personen, personal/personen/[id], personal/anstellungen. Es fehlen anstellungen/neu, anstellungen/[id], /vertrag, /entgelt, /beenden, personen/[id]/stammdaten, personen/[id]/zugang. (2) Es gibt ueberhaupt keinen Schreibweg: grep ueber src/server und src/app findet `insert into anstellung`/`insert into person` nur im Seed und in src/app/dev/anmelden/page.tsx; services/mitarbeiter/person.ts ist rein lesend. Einstellen, Beenden, Vertrag aendern geht heute nur per SQL. (3) `person` hat unter force row security gar keine UPDATE-Policy (pg_policies: nur t_person_lesen SELECT und t_person_schreiben INSERT) — Stammdaten sind fuer cse_app unveraenderbar, eine gebaute Maske liefe ins Leere. (4) personen/[id]/page.tsx Zeile 30 verweist auf personen/[id]/stammdaten, das es nicht gibt. (5) D-09s dritte person-gebundene Tabelle fehlt ganz: to_regclass('public.mitarbeiter_zugang') ist null (nachweis, bewacher_eintrag, urlaubskonto existieren) — der Login des Arbeiters, offene Aufgabe „PR 20". (6) Der gesellschaftsuebergreifende Befund ist im Seed nicht sichtbar: arbeitszeit_verstoss hat genau 1 Zeile mit betrifft_fremden_mandant = f; der K-06-Fall lebt nur im Test. (7) Die genannten Zahlen stimmen nicht: live person = 12, anstellung = 13, nicht 11/12 — die Differenz ist E2E-Rueckstand im Seed-Stand („Konto Abschlussprobe E2E-049904-0" mit eigener anstellung und 8 Arbeitszeitfenstern). Kein NochNichtGebaut im Repo (0 Treffer bei 127 page.tsx) — die Luecke sind fehlende Dateien, keine Platzhalterseiten. Kein Widerspruch zu „Out of scope" in diesem Abschnitt (keine Lohnabrechnung; stundensatz_intern ist interner Kostensatz und fuer cse_app nicht lesbar).

#### 28 Datenmodell — leads — `lead` (+ `lead_aktivitaet`, `formular_eingang`)

**Wirklich:** teilweise

Die Behauptung "GEBAUT — ganzer Weg vorhanden" haelt nicht. Der Weg bricht an drei Stellen ab, und zwar genau dort, wo der Abschnitt seinen Wert hat (SLA + Eskalation).

WAS WIRKLICH STEHT
- Schema: drizzle/0017_lead.sql. `lead`, `lead_aktivitaet`, `formular_eingang` mit RLS an (pg_class.relrowsecurity = t) und 5 Policies auf `lead` (p_intern_lead, t_lead_lesen, t_lead_schreiben, t_lead_job, t_lead_job_update). 7 CHECK, 3 FK, kein Hard-Delete (trg_lead_kein_hard_delete / _kein_truncate), Audit-Trigger, `kern.uwg_sendetor` vor jedem INSERT in `lead_aktivitaet`.
- Oeffentlicher Eingang: src/app/(public)/angebot/[bereich]/Angebot.tsx (+ /en/angebot/...), verlinkt aus src/components/oeffentlich/Kontaktwege.tsx:110 → POST src/app/api/anfrage/route.ts → src/server/services/lead/annahme.ts (Honigtopf, Ratenlimit, Validierung gegen Formularversion, SLA-Frist via sla.ts). 3 `formular_eingang`-Zeilen, alle mit Lead verknuepft, Status `verarbeitet`.
- Seiten: /portal/[mandant]/crm, /crm/leads, /crm/leads/[id] sind echte Seiten, kein `NochNichtGebaut`. e2e deckt Liste, Detail, Notiz ab (tests/e2e/crm.spec.ts:65-105).

WAS NICHT STIMMT
1. Die SLA-Uhr laesst sich durch die gebaute Oberflaeche NIE anhalten. `erste_reaktion_am` wird ausschliesslich vom Trigger `trg_lead_erste_reaktion` gestempelt, und nur bei einer AUSGEHENDEN Aktivitaet (drizzle/0017_lead.sql:252-273). Der einzige Schreibpfad der Anwendung, POST /api/lead, setzt fest `richtung 'intern'`, `zweck 'intern'`, ohne `kanal` und ohne `ansprechpartner_id` (src/app/api/lead/route.ts:81-88). Es gibt keine Route, die eine ausgehende Antwort erfasst. Folge: jeder Lead bleibt "offen — Frist ..." und bleibt dauerhaft eskalationsfaehig, egal was der Mensch tut. Der Test, der das Gegenteil zu zeigen scheint (tests/isolation/lead.test.ts:284-315), baut die ausgehende Aktivitaet per rohem SQL und legt den Ansprechpartner selbst an — er prueft den Trigger, nicht den Weg, den die Anwendung anbietet. Genau der blinde Fleck des Codes.
2. Der Eskalationsjob laeuft nirgends. src/server/jobs/lead-sla.ts registriert `lead_sla_eskalation` (stuendlich, je_mandant) — aber kein einziges Modul importiert diese Datei (grep ueber src/, scripts/, tests/); es gibt kein pg_cron (supabase/ enthaelt nur config.toml), keine vercel.json, keine Job-Route unter src/app/api. `job_lauf` in der frisch geseedeten DB: 0 Zeilen. `eskaliereFaellige` wird nur aus einem Test heraus aufgerufen.
3. Niemand wird benachrichtigt. `registriereLeadArten()` (src/server/services/lead/benachrichtigung.ts:14) wird von keinem Produktionspfad gerufen; `erzeuge(...)` aus benachrichtigung/registry.ts nutzt nur nachweis/ablauf.ts:138. Tabelle `benachrichtigung`: 0 Zeilen. Eine Eskalation endet als interne `lead_aktivitaet`-Zeile, die niemand zugestellt bekommt.
4. Der Lead kann sich nicht bewegen. Das einzige `update lead` im Anwendungscode setzt `naechste_aktion_text/_am` (src/app/api/lead/route.ts:94). Fuer `status`, `prioritaet`, `besitzer_benutzer_id`, `punktzahl`, `kunde_id`, `verloren_grund`, `konvertiert_am` existiert kein Schreibpfad — Qualifizieren, Verlieren, Konvertieren zu Kunde/Angebot (CRM-02, CRM-05) ist nicht benutzbar. Die Detailseite zeigt Status und Punktzahl nur an.
5. Routen aus der Seitenkarte, die es als Seite nicht gibt: `/portal/[mandant]/crm/leads/neu` (routen.generiert.ts:74) — kein page.tsx, ein Lead laesst sich also von Hand ueberhaupt nicht anlegen, nur ueber das Webformular; `/portal/[mandant]/crm/wiedervorlagen` (Zeile 85) — nicht gebaut, die "naechste Aktion", die das Formular schreibt, erscheint in keiner Liste; `/portal/gruppe/leads` (Zeile 377) faellt auf src/app/portal/gruppe/[...rest]/page.tsx → `NochNichtGebaut`. Die Detailseite verspricht laut Manifest Tabs "Uebersicht · Verlauf · Aufgaben · Angebote · Dokumente"; gebaut ist Verlauf.
6. Seed traegt den Fall nur fuer einen Mandanten. `lead`: 5 Zeilen, alle `reinigung` — davon 2 aus dem Seed (L-2026-0001 'neu', L-2026-0002 'in_bearbeitung'), die drei uebrigen (L-1239E9BAB1, L-5BF2A7F8ED, L-C04C726D03, quelle `webformular`, Frist heute) sind Rueckstand aus Testlaeufen, nicht Seed. security, bau, operations: 0 Leads — dort sieht ein Mensch ein leeres CRM. `lead_aktivitaet`: 1 Seed-Zeile.
7. Nebenbefund zur "3 FK": die 3 FK sind mandant_id, besitzer_benutzer_id, formular_eingang_id. `kunde_id`, `ansprechpartner_id`, `ausschreibung_id`, `empfehlung_von_kunde_id`, `agent_aufgabe_id` tragen KEINEN Fremdschluessel, obwohl `kunde` und `ansprechpartner` existieren (0020_crm_identitaet.sql). Die Zahl belegt also keine Vollstaendigkeit.

WIDERSPRUECHE (nicht gebaut, richtig so, ausdruecklich benannt)
- Kaltakquise an gescrapte Kontakte ist nicht moeglich und darf es nicht sein (§ 7 UWG, auch B2B). Der Code haelt das durch: `kern.uwg_sendetor` als BEFORE-INSERT-Trigger auf `lead_aktivitaet` und `app.darf_kontaktiert_werden(...)`, abgefragt auf src/app/portal/[mandant]/crm/page.tsx. Eine ausgehende Nachricht braucht Kanal, Empfaenger und belegte Rechtsgrundlage. Stattdessen moeglich: Kontakte mit Rechtsgrundlage `anfrage` (aus dem Webformular, CRM-08) oder `einwilligung`, erfasst mit Quelle und Datum.
- Scraping von Indeed/StepStone, Lohnabrechnung/Jahresabschluss/E-Bilanz/Steuererklaerung und automatische Einreichung auf Vergabeplattformen beruehrt dieser Abschnitt nicht und enthaelt davon nichts — korrekt gemaess CLAUDE.md "Out of scope".

FAZIT: Datenmodell, Recht und der oeffentliche Eingang stehen. Was ein Mensch heute tun kann: Liste lesen, Detail lesen, eine interne Notiz festhalten, einen naechsten Schritt setzen. Was er nicht kann: antworten und damit die Uhr anhalten, den Lead qualifizieren, verlieren oder konvertieren, ihn von Hand anlegen, Wiedervorlagen sehen, Leads gruppenweit sehen. Und die Eskalation, die den Abschnitt traegt, laeuft in keiner Umgebung. TEILWEISE.

#### 28 Datenmodell — projects — `projekt` (Bau) — plus `objekt` als Ort

**Wirklich:** teilweise

Die Behauptung haelt nicht — Schema stimmt, aber "GEBAUT" ueberdehnt; mehrere Belegzahlen sind falsch und die zentrale Projektseite fehlt.

WAS STIMMT (nachgeprueft)
- `projekt` existiert real: RLS `relrowsecurity`+`relforcerowsecurity` = t, 6 Policies (`t_mandant`, `t_gruppe`, `t_kunde`, `t_person`, `t_erfassen_lesen`, RESTRICTIVE `p_portal_decke`), 9 FK, 5 CHECK, no-hard-delete-Trigger (`trg_projekt_kein_hard_delete`/`_kein_truncate`), `auftragssumme_netto_cent bigint` (Invariante 1), alle Zeitstempel TIMESTAMPTZ.
- Angelegt wird `projekt` in `drizzle/0071_lv_position.sql` (nicht in einer Datei ihres Namens); Spaltenrechte in `drizzle/0089_projekt_spaltenrechte.sql` (revoke table-wide, danach erschoepfende Spaltenliste ohne `auftragssumme_netto_cent`/`sicherheitseinbehalt_bp`) — korrekt und in der richtigen Postgres-Reihenfolge.
- 17 echte `page.tsx` unter `src/app/portal/[mandant]/bau/**` (nicht dreizehn), KEINE davon rendert `NochNichtGebaut`.
- Erreichbar: `src/server/registry/navigation.ts:57` `{ schluessel: 'bau', pfad: 'bau/projekte', recht: 'bau.lesen' }`. Gegenzeichnung ist inline verdrahtet (`…/aufmass/[aufmassId]/page.tsx:262` → `/api/bau/aufmasse/{id}/gegenzeichnung`, Recht `bau.aufmass_freigeben`, `src/server/auth/route-manifest.ts:429`).

WAS NICHT STIMMT
1. Die Projektseite selbst fehlt. `/portal/[mandant]/bau/projekte/[id]` steht im Manifest (`routen.generiert.ts:149`), hat aber KEIN `page.tsx` — es gibt nur `projekte/[id]/{lv,aufmass,nachtraege,behinderungen,bautagebuch}`. Die Adresse faellt in `src/app/portal/[mandant]/[...rest]/page.tsx` → `src/app/portal/unterseite.tsx:92/121` → `NochNichtGebaut`. Es gibt heute keinen Bildschirm, der EIN Projekt zeigt. `projekte/page.tsx:94-174` verlinkt bewusst nur die Unterseiten, nie `/[id]`. Genau Falle 1.
2. Weitere Manifestrouten des Abschnitts ohne Seite, ebenfalls `NochNichtGebaut`: `/portal/[mandant]/bau` (Modulübersicht, Zeile 147 — `navigation.ts:51-56` gibt schriftlich zu, dass der Menüpunkt sie umgeht), `…/lv/[ozId]` (151), `…/lv/import` (152), `…/aufmass/[aufmassId]/freigabe` (156), `…/abnahme` (165). 6 von 22 Bau-Routen.
3. `abnahme` (§12 VOB/B) gibt es gar nicht: `information_schema.tables like '%abnahme%'` = 0 Zeilen, kein Dienst, keine Seite. Damit haengt `projekt.gewaehrleistung_bis` an einem Ereignis, das die Plattform nicht kennt.
4. Die Belegzahlen sind falsch. Frisch geseedete DB `cse_p5`: `projekt` = 2 (nicht 1), `aufmass` = 3 (nicht 7; `aufmass_zeile` = 5), `behinderung` = 0. `lv_position` 27 und `nachtrag` 1 stimmen; `bautagebuch` 3.
5. `behinderung` wird als Beleg genannt, traegt aber KEINE Saatzeile (nur 4 `behinderung_vorlage`). `src/server/db/seed/bau.ts` enthaelt kein `insert into behinderung`. Die drei Behinderungsseiten zeigen einem Menschen heute eine leere Liste — Falle 2.
6. Von den 2 `projekt`-Zeilen ist eine ein E2E-Artefakt: `P-E2E-AUFMASS / "Rohbau Ost"`, `objekt_id` NULL, `auftragssumme_netto_cent` NULL. Die Behauptung "plus `objekt` als Ort" traegt damit nur fuer 1 Zeile (`AU-2026-00001`, Objekt gesetzt); `objekt_id` ist nullable.
7. Der kaufmaennische Kern ist gespeichert, aber nirgends sichtbar — 0089 sagt es selbst: "heute liest keine einzige Stelle im Anwendungscode diese beiden Spalten (weder Dienst noch Seite noch Saat)". Auftragssumme und Sicherheitseinbehalt stehen in der Tabelle und in keiner Oberflaeche. Das ist die Bestaetigung von Punkt 1 aus dem Code heraus — Falle 3.

WIDERSPRUCH: in diesem Abschnitt keiner. `projekt`/`objekt` beruehren weder Kaltakquise (§7 UWG), Scraping von Indeed/StepStone, Lohnabrechnung/Jahresabschluss/E-Bilanz noch automatische Vergabe-Einreichung. Es ist auch nichts davon still gebaut: kein `abnahme`- und kein Einreichungs-Pfad existiert; die Einreichung bleibt manuell, wie CLAUDE.md "Out of scope" verlangt.

FAZIT: Datenmodell `projekt` = gebaut. Der Weg des Menschen zum Projekt = teilweise: man kommt ueber die Liste in LV, Aufmass, Nachtraege, Bautagebuch (dort mit Daten), aber nicht auf das Projekt selbst, nicht in die Abnahme, und Behinderungen sind leer. Insgesamt TEILWEISE.

#### 28 Datenmodell — orders — `auftrag` (+ `auftrag_leistung`)

**Wirklich:** teilweise

Der Auftrags-KOPF haelt, die Zeile "(+ auftrag_leistung)" haelt nicht, und die Zusage "Zeiteintrag haengt am Auftrag" gilt nur fuer Zeilen, die der Seed selbst gelegt hat.

WAS STIMMT
- Die drei Seiten existieren wirklich und rendern kein NochNichtGebaut: src/app/portal/[mandant]/auftraege/page.tsx (128 Z.), .../neu/page.tsx (209 Z.), .../[id]/page.tsx (183 Z.). Pfad ist allerdings /portal/[mandant]/auftraege, nicht "/auftraege" wie behauptet.
- Der Weg fuehrt hin: src/server/registry/tableiste.ts:63,74,87,108 und navigation.ts:45 ({schluessel:'auftraege', recht:'auftrag.lesen'}).
- Schreibweg src/app/api/auftrag/route.ts existiert, autorisiert ('auftrag.schreiben'), zieht die Nummer ueber vergebeNummer.
- Zahlen der Behauptung zu `auftrag` stimmen: RLS forced, 7 FK, 8 CHECK (\d auftrag).
- tests/e2e/auftrag.spec.ts geht den Menschenweg durch den Assistenten.

WAS NICHT STIMMT
1. auftrag_leistung hat KEINEN Menschenweg. Einziger Schreiber im ganzen Repo ist der Seed: src/server/db/seed/auftrag.ts:182 ("insert into auftrag_leistung"). Kein API-Handler, kein Dienst in src/server/services/ legt je eine Leistungszeile an. Gegenprobe: grep "into auftrag_leistung" ueber src/ scripts/ trifft nur diese eine Stelle.
2. Die Detailseite ZEIGT die Leistungszeilen nicht einmal. Die Abfrage in .../[id]/page.tsx:61-77 liest ausschliesslich den Kopf (auftrag join kunde/objekt/benutzer/angebot); auftrag_leistung kommt in src/app/** nur in zeiten/daten.ts:192 und im Bau-Nachtrag vor, nie auf der Auftragsseite. Ein Auftrag hat in der Oberflaeche keine Positionen — weder lesend noch schreibend.
3. Folge: ein ueber /auftraege/neu angelegter Auftrag ist eine Sackgasse. zeiteintrag, einsatz, rechnungsposition, aufmass, turnus, leistungsnachweis, revier haengen alle an auftrag_leistung_id (siehe "Referenced by" bei \d auftrag_leistung). Ohne Leistungszeile kann an so einem Auftrag nie Zeit, nie eine Rechnung, nie ein Aufmass haengen.
4. Auch der Angebotsweg erzeugt einen leeren Auftrag: src/server/services/angebot/index.ts:387 fuegt den Kopf inkl. auftragswert_netto_cent ein, aber keine Position. Die DB belegt es: AU-2026-00002 und AU-2026-00003 tragen angebot_id und haben 0 Leistungszeilen.
5. Der Datenstand widerlegt "3 Zeilen": auftrag hat 7 Zeilen, auftrag_leistung 2 — und beide haengen an EINEM einzigen Auftrag (56a3a8cf, der geseedete Reinigungs-Rahmenvertrag). 6 von 7 Auftraegen haben keine einzige Position.
6. "Zeiteintrag haengt am Auftrag (0051)" ist ungenau: zeiteintrag hat gar keine Spalte auftrag_id (select ... where auftrag_id is not null -> ERROR: column does not exist). Die Bindung laeuft ueber zeiteintrag.auftrag_leistung_id und die Sicht zeiteintrag_auftrag aus 0051. 28 von 40 Zeiteintraegen loesen auf — alle aus dem Seed, weil kein Bedienweg eine Leistungszeile erzeugen kann, an die ein neuer Eintrag erben koennte.
7. Es gibt ueberhaupt keinen UPDATE-Weg auf auftrag in der Anwendung (grep "update auftrag" trifft nur src/server/db/seed/bau.ts:565). Daraus folgt: status bleibt fuer alles selbst Angelegte auf 'angelegt' — die StatusPill-Tabelle in page.tsx:20-23 kennt aktiv/pausiert/abgeschlossen, erreichbar ist keiner; auftragswert_netto_cent bleibt NULL, die Detailseite zeigt dauerhaft "offen"; archiviert_am wird nie gesetzt, obwohl die Liste darauf filtert; und die Referenzfreigabe PRO-05 (freigegeben_vom_kunden) kann niemand erteilen, obwohl src/server/services/inhalt/referenz.ts:42 genau dieses Flag liest, um Referenzen oeffentlich zu stellen. Die Detailseite sagt dazu nur den Satz "Ohne schriftliche Freigabe ... erscheint kein Auftrag auf der Website" — und es gibt keinen Knopf, der das jemals aendert.
8. Die Pruefungen wiederholen den Irrtum, statt ihn zu fangen. tests/isolation/zeit-auftrag.test.ts sagt im Kopfkommentar selbst: "Der Test legt seine Stammdaten selbst an (Kunde, Objekt, Auftrag, Leistungszeile, Einsatz, Zuordnung), weil der Seed sie in dieser Form nicht kennt" — er baut die Leistungszeile per Roh-SQL und prueft damit die Sicht, nicht den Bedienweg. tests/e2e/auftrag.spec.ts prueft Kopffelder, Nummernformat und Barrierefreiheit; kein Fall behauptet eine Position, einen Wert oder einen Statuswechsel.
9. docs/DECISIONS.md D-150 sagt es selbst: auftrag_leistung wurde in PR 36 vorgezogen, "obwohl sie 02-CRM-OPERATIONS gehoert — deren Eigentum sie bleibt". Die Tabelle wurde als Anker fuer die Zeitkette gebaut, das Modul dazu ist dort geplant und hier nicht gebaut. Das ist geplant-und-noch-nicht-dran, nicht gebaut.

WIDERSPRUCH ZU OUT-OF-SCOPE: keiner in diesem Abschnitt. Der Auftragsassistent raet weder Personalbedarf noch Wochenstunden (route.ts:38-52 meldet 'keine_zahl' statt still NULL), die Auftragsnummer behauptet ausdruecklich KEINE Lueckenlosigkeit (Kommentar in drizzle/0025_auftrag.sql) — Lueckenlosigkeit ist eine Anforderung an die Rechnung, nicht an den Auftrag; das ist richtig so.

EINSTUFUNG: auftrag = GEBAUT (Kopf, lesend + anlegend, ohne jeden Aenderungsweg). auftrag_leistung = TEILWEISE, genauer: Schema und RLS stehen, Modul fehlt ganz — keine Seite, kein Dienst, kein Formular, ein einziger Seed-Schreiber. Zusammen also TEILWEISE: ein Mensch kann heute einen Auftragskopf anlegen und ansehen, aber keine Leistung daran haengen, keinen Status setzen, keinen Wert erfassen und keine Referenz freigeben — und damit fuehrt von einem selbst angelegten Auftrag kein Weg in Zeit oder Abrechnung.

#### 28 Datenmodell — offers — `angebot` (+ `angebotsposition`, `angebot_steuer`, `kalkulation`)

**Wirklich:** teilweise

Die Tabellen existieren wie behauptet (drizzle/0024_angebot.sql: angebot mit 8 FK und 7 CHECK, angebotsposition, angebot_steuer, RLS + FORCE RLS, Kein-Hard-Delete-Trigger; kalkulation in 0023). Zwei der drei Kernaussagen der Behauptung halten der Pruefung aber nicht stand, und der Mensch kann das Modul heute nur zur Haelfte benutzen.

1) „ein Versand nur mit benanntem Freigeber" steht so NICHT im CHECK. `angebot_freigabe_vor_versand` (0024_angebot.sql, Zeile ~104) lautet: `status in ('entwurf','in_pruefung','zurueckgezogen') or (freigegeben_von is not null and versendet_am is not null)`. Eine Zeile mit status='entwurf' oder 'in_pruefung', gesetztem `versendet_am` UND gesetzter `angebotsnummer` erfuellt beide CHECKs (`angebot_nummer_bei_versand` prueft nur die Aequivalenz null/null) und passiert beide Vor-Trigger: `angebot_versand_pruefen` prueft nur Platzhalter, `angebot_versand_stempeln` nur die Nummer. Der After-Trigger schreibt dann sogar die `angebot_steuer`-Zeilen und friert die Kalkulation ein (mit `festgeschrieben_von = versendet_von`, also ggf. NULL), und die Kundenpolicy `t_kunde` (`versendet_am is not null`) gaebe das Angebot frei — ohne dass je ein Freigeber benannt wurde. Nur der Dienst verhindert das, nicht die Datenbank.
2) Die Pruefung wiederholt genau diesen Irrtum: tests/isolation/angebot.test.ts:279–287 setzt im selben UPDATE `status='versendet'` und erwartet `angebot_freigabe_vor_versand`. Der Fall „versendet_am ohne Statuswechsel" wird nirgends geprueft.
3) Auch im Dienst ist der „benannte Freigeber" der Absender selbst: src/server/services/angebot/index.ts:288–296 schreibt `freigegeben_von = versendet_von = $3`, und src/app/api/angebot/route.ts:185 uebergibt `sitzung.benutzerId`. Der getrennte Freigabeschritt, den die Seitenkarte fuehrt (`/portal/[mandant]/angebote/[id]/freigabe`, Recht `angebot.preis_freigeben`, routen.generiert.ts:91), ist nicht gebaut — es gibt keine Datei, und das Recht steht als unbenutzt eingefroren in tests/kern/katalog-unbenutzt.ts:37. Vier Augen gibt es nicht.

Menschlicher Weg — nur teilweise: von 9 Angebots-Routen im Manifest (routen.generiert.ts:86–93, 428–429) liegen 4 Seiten im Dateisystem (angebote/page.tsx, [id]/page.tsx, [id]/kalkulation, [id]/pdf). `/angebote/neu` und `/[id]/freigabe` fallen in `src/app/portal/[mandant]/[...rest]` und rendern `NochNichtGebaut` (src/app/portal/unterseite.tsx:92). Versenden und Annahme sind immerhin als POST-Formulare in [id]/page.tsx:335 und :350 erreichbar. `/portal/kunde/angebote` ist ebenfalls NochNichtGebaut (src/app/portal/kunde/[...rest]/page.tsx) — die vier K-18-Kundenpolicies auf angebot/angebotsposition/angebot_steuer haben heute keine Seite.

Entstehen kann ein Angebot nur an EINER Stelle: dem Raumbuch eines Reinigungsobjekts (src/app/portal/[mandant]/objekte/[id]/raumbuch/page.tsx:376–393, `aktion=aus_raumbuch`). Positionen entstehen ausschliesslich in `uebernimmKalkulation` mit `REGELSATZ_BP = 1900` (services/angebot/index.ts:70); es gibt keine freie Angebotserfassung, kein Bearbeiten von Positionen, Texten, Bindefrist oder Steuerkennzeichen. Entsprechend der Seed (ueber die echten Dienste, src/server/db/seed/vertrieb.ts:239–290): 11 angebot / 66 angebotsposition / 5 angebot_steuer — ALLE im Mandanten `reinigung`, null in `security` und `bau`. Die Behauptung „2 Zeilen" trifft den Seed ohnehin nicht.

Weiter nur Huelle: `angebotsposition_typ` ('alternativ','eventual','text','zwischensumme') und die Status 'abgelehnt','zurueckgezogen','abgelaufen' werden von keiner Codezeile geschrieben — kein Ablaufjob (src/server/jobs/ kennt kein Angebot, `angebot_ablauf_idx` liegt ungenutzt); die VOB-Positionsarten leben in `lv_position` (0071), nicht hier. Beides ist in der Migration selbst als PLACEHOLDER/TODO(client, O-73) ausgewiesen — ehrlich, aber eben nicht gebaut.

Und der „Versand" versendet nichts: `versendeAngebot` setzt nur Nummer und Zeitstempel, ruft weder eine Zustellung noch den Policy-Gate `src/server/agent/policy.ts` (der `angebot_senden` kennt, Zeile 216–221). Der Kunde bekommt heute weder Mail noch Portalseite; das PDF ist bewusst eine druckbare HTML-Seite ([id]/pdf/page.tsx, dort begruendet).

Was haelt: D-95 ist belegt (docs/DECISIONS.md:1534–1558), die Kalkulation rechnet ganzzahlig (keine Gleitkomma-Operation in services/kalkulation/index.ts; menge.ts/geld.ts als Milli-/Cent-Typen), nennt ihre Platzhalter (6 Zeilen in kalkulation_platzhalter) und `kern.angebot_versand_pruefen` verweigert den Versand auf Platzhaltern. Die Rundung sitzt in der Datenbank (`gesamtpreis_cent` generated, numerisch), die Steuer wird je Satzgruppe aus dem Netto gerechnet — Invariante 1 gewahrt.

Kein Widerspruch zu „Out of scope" in diesem Abschnitt: nichts sendet automatisch, keine Einreichung auf Vergabeplattformen, keine Kaltakquise. Der Versand bleibt eine POST-Handlung eines Menschen — was fehlt, ist die zweite Person (Preisfreigabe) und die tatsaechliche Zustellung, nicht eine verbotene Automatik.

#### 28 Datenmodell — schedules — `planungsserie` + `einsatz` + `einsatz_zuordnung` (+ `turnus`, `feiertag`, `planungs_konflikt`)

**Wirklich:** teilweise

Das Schema und der Besetzungsweg stehen; vier Aussagen der Behauptung halten nicht.

1) DER GENERATOR LAEUFT NIE. `src/server/jobs/einsaetzeGenerieren.ts:25` exportiert `registriereEinsatzGenerator` — ein `grep` ueber `src/` und `tests/` findet KEINEN Aufrufer. Ebenso `registriereKonfliktDetektor`. `fuehreAus` (`src/server/jobs/runner.ts:52`) wird ausschliesslich aus `tests/isolation/jobs.test.ts` und `tests/kern/jobs.test.ts` gerufen. Es gibt keine `vercel.json`, keinen Cron-Eintrag, keine API-Route, die den Generator anstoesst (`find src/app/api -iname '*serie*|*generator*'` leer). Die einzigen `insert into planungsserie` stehen in `src/server/db/seed/dienstplan.ts:140` und `src/server/db/seed/security.ts:151`. Praktisch: die 99 `einsatz`-Zeilen in der Datenbank hat der Seed geschrieben, nicht der Dienstplan. Die Serie materialisiert sich im Betrieb nicht.

2) KEIN MENSCHLICHER SCHREIBWEG IN DIE PLANUNG. `/dienstplan/serien/page.tsx` ist eine reine Liste — kein `form`, kein `action`, kein "Neue Serie"-Link irgendwo im Repo. `turnus_ausnahme` kommt in keiner Seite und in keinem Dienst ausser dem Leser des Generators vor. Ein Disponent kann heute eine Schicht BESETZEN und ABSAGEN, aber keine Serie, keinen Turnus und keine Ausnahme anlegen oder aendern. Das ist der Unterschied zwischen "Plan lesbar" und "Plan planbar".

3) `feiertag` IST EINE TABELLE OHNE MODUL (Falle 2). In der frisch geseedeten `cse_p5`: `select count(*) from feiertag` = 0. Kein Seed, kein Job, keine Seite, keine API schreibt hinein — die einzigen Inserts stehen in `tests/isolation/dienstplan-generator.test.ts:212,227`. Folge: `ladeFeiertage` (`generator.ts:186 from feiertag`) liefert immer leer, alle 99 `einsatz`-Zeilen haben `feiertag_id is null`, und jede Serie mit `feiertage_ueberspringen = true` (Seed setzt das fuer zwei Reinigungsturnusse, `seed/dienstplan.ts:144`) plant still durch den Feiertag. Dazu zwei Feiertagswahrheiten: der Urlaubsrechner nimmt `src/lib/datum/feiertage-berlin.ts` (`services/abwesenheit/tage.ts:28,96`), der Dienstplan die leere Tabelle. Der Kommentar `services/abwesenheit/tage.ts:14` ("derselben Quelle, die auch der Dienstplan benutzt (CLN-03), damit ein Feiertag nicht in der Planung gilt und im Urlaubskonto nicht") ist damit sachlich falsch — genau dieser Zustand liegt vor. O-167 (`docs/DECISIONS.md`) ist dazu noch offen.

4) "ORTSZEIT LOEST GENAU EINE FUNKTION IN POSTGRES AUF" IST FALSCH. Es gibt einen zweiten, vollstaendigen Wanduhr-zu-Instant-Aufloeser in Node: `berlinInstant` (`src/server/services/zeit/dauer.ts:106`, Offset per `Intl`, Korrekturschritt) mit eigener DST-Klassifikation in `loeseAuf` (`src/lib/datum/rrule.ts:463-481`, `dst_luecke`/`dst_doppelt`). Er wird von der Serienentfaltung selbst benutzt (`rrule.ts:287,469`) sowie von `src/server/versand/dwd.ts:203`, `src/app/api/lead/route.ts:106`, `src/server/db/seed/bau.ts:370`. Das widerspricht dem Kommentar der Migration selbst: `drizzle/0032_ortszeit.sql:171-174` "Die einzige Umrechnung dieser Art in der Plattform; der Node-Prozess rechnet keine Zone um." Der GESPEICHERTE Instant kommt zwar aus Postgres (`generator.ts:212` uebergibt `$12::date, $13::time` an `app.loese_ortszeit`) — die Invariante haelt also dort, wo sie am meisten zaehlt —, aber "genau eine Funktion" stimmt nicht, und die zweite Zonendatenbank ist genau das Risiko, gegen das 0032 geschrieben wurde. Zusaetzlich ist der Rueckstellungsfall ausdruecklich unentschieden: `0032_ortszeit.sql` ~Z.148 `zeitpunkt := v_kandidat;  -- der fruehere, noch Sommerzeit (PLATZHALTER, O-163)`, O-163 offen in `docs/DECISIONS.md:2878`.

5) SEED TRAEGT NUR ZWEI VON VIER MANDANTEN. `reinigung` 82 Einsaetze / 6 Serien, `security` 17 / 1, `bau` 0 / 0, `operations` 0 / 0. Alle 99 Einsaetze `status = 'geplant'` — kein besetzt, kein storniert; die CHECK `einsatz_storno_begruendet` und der `besetzt_anzahl`-Pfad sind im Seed unbelegt. `planungs_konflikt` traegt 3 Zeilen (arbzg offen/quittiert, qualifikation_entfallen offen) — dafuer ist die e2e-Pruefung echt.

6) ZAHLEN DER BEHAUPTUNG SIND VERTAUSCHT. "planungsserie 7 Zeilen (9 FK)": 7 ist die Seed-Zeilenzahl, die Tabelle hat 26 Spalten (9 FK, 7 CHECK). "einsatz 82 Zeilen": die Tabelle hat 46 Spalten, der Seed 99 Zeilen; 82 ist nur der Reinigungs-Anteil. FK/CHECK-Zahlen (einsatz 18/11) stimmen.

WAS TRAEGT: Schema samt RLS (einsatz 10 Policies, einsatz_zuordnung 8, planungsserie 7, turnus 6, planungs_konflikt 7), Migrationen 0028/0029/0032, sechs echte Seiten (keine rendert `NochNichtGebaut` — das tut allein `src/app/portal/unterseite.tsx`), der Besetzungs-/Absageweg ueber `services/dienstplan/einteilung.ts` mit Recht `dienstplan.schreiben` (`registry/dienste.ts:237`), und `tests/e2e/dienstplan.spec.ts` prueft die vier von CLAUDE.md geforderten Faelle tatsaechlich an der Oberflaeche (10 Schichten = 10 Spalten mit Breite; Nachtschicht 8,00 h an beiden Tagen mit Pfeilen; Vorstellungsnacht 7,00 h; Rueckstellungsnacht 9,00 h; Browser-Zone New York aendert nichts).

OUT-OF-SCOPE: In diesem Abschnitt wird keiner der vier verbotenen Punkte beruehrt — keine Kaltakquise, kein Scraping, keine automatische Vergabe-Einreichung. Lohnabrechnung wird korrekt NICHT gerechnet: die Verguetungsfrage der beiden Umstellungsnaechte bleibt als O-163 offen stehen, statt einen Satz zu erfinden. Das ist richtig so; die Plattform darf die Stunden belegen (Dauer = Differenz der UTC-Instants) und exportieren, die Bewertung macht das Lohnsystem.

#### 28 Datenmodell — activity_logs — `audit_log`

**Wirklich:** teilweise

Das Schema stimmt, das Modul fehlt. Richtig an der Behauptung: audit_log existiert (drizzle/0003_audit_log.sql), relrowsecurity und relforcerowsecurity beide t, Policy t_audit_lesen, genau 1 FK (audit_log_mandant_id_fkey), genau 1 CHECK (audit_ebene_stimmt), mandant_id nullbar (K-16d); Unveraenderlichkeit inkl. TRUNCATE-Trigger und revoke delete,truncate in drizzle/0005_immutability_audit.sql (D-21, DECISIONS.md:328); Spaltenrecht ohne vorher/nachher ebenda (D-22, DECISIONS.md:351); Definer-Grant in drizzle/0096_protokolliere_definer.sql.

Widerlegt:
(1) Zahl falsch — select count(*) from audit_log im frisch geseedeten cse_p5 ergibt 832, nicht 845.
(2) Keine Seite. src/app/portal/[mandant]/einstellungen/ existiert nicht; find src/app -type d -name protokoll ist leer. Das Manifest fuehrt drei Adressen — routen.generiert.ts:362 /portal/[mandant]/einstellungen/protokoll (Phase 1), :363 .../protokoll/export (Phase 7), :396 /portal/gruppe/protokoll (Phase 1). Alle drei landen im Auffangzweig src/app/portal/[mandant]/[...rest] ueber src/app/portal/unterseite.tsx in src/components/portal/NochNichtGebaut.tsx. Das ist Falle 1 woertlich.
(3) Kein Weg des Menschen. Keine API-Route mit Audit-Bezug unter src/app/api, kein Navigationsverweis auf einstellungen/protokoll oder gruppe/protokoll ausserhalb der generierten Registry, kein Lesezugriff in src/server/services/**. grep -rn audit_log src/ trifft nur Kommentare und db/schema/rls.ts. Es existieren nur Schreiber (Trigger kern.protokolliere_aenderung -> app.protokolliere).
(4) Das Repo bescheinigt es selbst: system.audit_lesen, system.audit_exportieren und gruppe.system.audit_lesen stehen auf der eingefrorenen Liste der Schluessel, die kein Code prueft — tests/kern/katalog-unbenutzt.ts:128,192,193.
(5) Die Pruefung wiederholt den Irrtum. Einziger Test des Nutzlast-Zugriffs ist tests/isolation/unveraenderbarkeit.test.ts:217-222 mit expect(durch).toEqual([]) — er beweist nur die verweigernde Haelfte. Sein Kommentar (denies everyone while the rights catalogue is unseeded, K-19) ist veraltet: drizzle/0008_berechtigung_matrix.sql:284,756 seedet system.audit_sensitiv_lesen, und app.hat_recht ist laengst die echte Katalogabfrage statt des select false aus 0005. Kein Test zeigt, dass ein super_admin vorher/nachher je zu sehen bekommt.
(6) Zugesagte Spalten sind tot. routen.generiert.ts:362 verspricht actor (human/agent/system) und IP. In allen 832 Zeilen: ip NULL (0), agent_id NULL (0), akteur_typ='agent' 0. Grund im einzigen Schreiber app.protokolliere: app.guc('app.ip') wird nirgends gesetzt (grep -rn "app\.ip" src/ leer; nur app.akteur_typ wird in src/server/kontext/*.ts gesetzt), und agent_id steht gar nicht in der INSERT-Liste.
(7) Abdeckung: 40 von 137 Public-Tabellen tragen kern.protokolliere_aenderung; 97 schreiben nichts ins audit_log.

Kein Widerspruch zu Out-of-scope: audit_log beruehrt weder Kaltakquise (§7 UWG) noch Scraping, Lohnabrechnung/Jahresabschluss oder automatische Vergabe-Einreichung.

Fazit: Schreibpfad, Unveraenderlichkeit und Spaltenrecht stehen. Das, was der Mandant unter activity_logs bestellt hat — eine Seite, auf der jemand sieht, wer was wann geaendert hat — gibt es nicht. Heute kommt kein Mensch an diese 832 Zeilen heran. Also TEILWEISE, nicht GEBAUT.

#### 32 Entwicklungsregel — Grundhaltung: keine vorgetaeuschte Funktion

**Wirklich:** teilweise

Die drei genannten Dateien existieren und sagen, was behauptet wird. Widerlegt ist trotzdem, dass das Muster „durchgehalten und an drei Stellen erzwungen" ist.

1) Der Platzhalter selbst macht eine falsche Aussage. src/components/portal/NochNichtGebaut.tsx:52-54 rendert woertlich „die Seite dahinter entsteht in Phase ${phase}", wobei `phase` aus dem Manifest kommt (src/app/portal/unterseite.tsx:96, :123 → `route?.phase`). Abgleich Manifest gegen Dateisystem (src/server/registry/routen.generiert.ts gegen `find src/app -name page.tsx`): von 231 Portalrouten mit Phase ≤ 5 haben 132 keine Seite. Auf Branch `claude/phase-5-abschluss` liest ein Mensch also z. B. unter /portal/[mandant]/einstellungen/rollen „entsteht in Phase 1", unter /portal/[mandant]/website/seiten „entsteht in Phase 2", unter /portal/[mandant]/personal/anstellungen/neu „entsteht in Phase 3". Das ist eine Zukunftszusage fuer abgeschlossene Phasen — genau die Klasse Aussage, die die Regel verhindern soll. Passend dazu steht im Kopf von unterseite.tsx:17 noch „gebaut sind die von Phase 3".

2) „An drei Stellen erzwungen" stimmt nicht. Erzwungen ist genau eine: die Wache (package.json:15-16 `lint` ruft `guards`, .github/workflows/ci.yml:43). Und die erzwingt Invariante 7 (ein Ausgang), nicht „keine vorgetaeuschte Funktion". NochNichtGebaut.tsx und Anmeldung.tsx sind Konventionen in je einer Datei ohne jede Pruefung: `grep -n "^function wache" scripts/guards/run-all.ts` listet elf Waechter (geld-nie-numeric, zeit-immer-tz, route-ohne-db, todo-client, datum-zone, sql-backtick, ein-ausgang, eu-region, tailwind-farbe, anzeige-berlin, konfig-adresse) — keiner davon prueft auf leere Handler, tote Knoepfe oder erfundene Daten.

3) Die als Beleg (3) genannte Verschaerfung ist unbelegt. tests/kern/gate.test.ts:225-248 ist das einzige Fixture der Wache und legt ausschliesslich `import nodemailer from 'nodemailer'` ab; geprueft wird `/ein-ausgang/` und `/nodemailer/`. Der nackte-`fetch`-Zweig (run-all.ts:425-431) hat KEIN Fixture. D-57 („gegen ein Fixture verifiziert, das genau das tut", DECISIONS.md:938-944) deckt damit nur den Importpfad. Zwei reale Loecher bleiben ungetestet: die Importregel `/(?:from|require\()\s*['"]…/` (run-all.ts:432) sieht `await import('nodemailer')` nicht, und `mussLesen('src', …)` (run-all.ts:404) liest nur `src` — supabase/, scripts/ und tests/ sind ausserhalb.

4) Die Kernzusage des Platzhalters ist nirgends geprueft. Kein Test besucht eine ungebaute Manifestroute und behauptet 200 + „wird noch gebaut" statt 404. Der einzige Treffer ist die Gegenprobe tests/e2e/portal-ausgang.spec.ts:66 (`[data-cse="noch-nicht"]` toHaveCount(0)) — sie prueft, dass eine GEBAUTE Seite nicht der Platzhalter ist. Dass der Next-Catch-all (src/app/portal/[mandant]/[...rest]/page.tsx) auch unter bereits bestehenden Teilbaeumen wie personal/anstellungen/ greift, ist eine Annahme ohne Beleg.

5) „Ein Mensch koennte es heute benutzen" trifft fuer keinen dieser Bildschirme zu: Anmeldung.tsx:22-24 sagt selbst, die Anmeldung (Telefon + Einmalcode) werde erst mit PR 20 gebaut; erreichbar ist das Portal nur ueber /dev/anmelden hinter `devFlaechenAn()` (Anmeldung.tsx:1, :25). Das ist ehrlich — aber es macht die Regel zu einer, die produktiv noch von niemandem gesehen wird.

Unwiderlegt geblieben ist der Rest: die Platzhalterwerte der Kalkulation tragen ihren Zustand sichtbar (raumbuch/page.tsx:243-250, `data-cse="platzhalter-hinweis"`), der Speicheradapter simuliert keinen Erfolg (src/server/storage/adapter.ts:7-20, NichtVerbundenFehler), Wetter erfindet nichts (src/server/services/bau/wetter.ts:13-20), das Anfrageformular meldet keinen falschen Erfolg (src/app/api/anfrage/route.ts:304), und es gibt keinen toten Knopf (`onClick={() => {}}`, `href="#"` je 0 Treffer). D-62 steht allerdings nur in docs/DECISIONS.md:993 — in src gibt es keine Referenz darauf, der Beleg fuer Platzhalterbilder ist also Dokument, nicht Code.

Kein Widerspruch zu „Out of scope" in diesem Abschnitt: die Regel selbst ist das Gegenteil von Kaltakquise/Scraping/Lohnabrechnung/automatischer Vergabeeinreichung.

#### 1 Unternehmensstruktur — vier Bereiche, getrennte Gesellschaften, eine Gruppe — Vier Mandanten als Datenzeilen, je eigener Nummernkreis, fünfter Bereich ohne Codeänderung

**Wirklich:** teilweise

Die Datenzeilen stimmen, die drei Folgerungen daraus nicht. Kein einziger der drei Zusatz-Ansprueche ("je eigener Nummernkreis", "fuenfter Bereich ohne Codeaenderung", "Test belegt es") haelt der Pruefung stand.

1) VIER MANDANTEN ALS ZEILEN — stimmt, aber einer ist leer.
`select * from mandant`: 4 Zeilen (reinigung/security/bau/operations), `ist_rechtseinheit` t/t/t/NULL, `eigener_nummernkreis` t/t/t/f. Seed: src/server/db/seed/index.ts:54ff (hart kodiert). Die Trennung ist auf DB-Ebene echt belegt: CHECK `mandant_kreis_nur_rechtseinheit`, RLS auf allen Mandantentabellen, Spaltenrecht auf `anstellung.stundensatz_intern` (tests/isolation/mandanten-trennung.test.ts:19-123 prueft das als `cse_app`, ohne Dienstschicht — das ist der belastbare Teil).
ABER: `operations` traegt im Seed 0 anstellung, 0 objekt, 0 angebot (nur 2 benutzer_mandant-Zeilen). Der vierte Bereich ist eine Huelle, an der ein Mensch heute nichts sehen kann.

2) „JE EIGENER NUMMERNKREIS" — falsch formuliert und funktional tot.
- Es sind 3 von 4, nicht 4 von 4: `operations` hat 0 nummernkreis-Zeilen (richtig so, keine Rechtseinheit — aber die Behauptung sagt etwas anderes).
- Die 13 Zeilen enthalten je Gesellschaft genau EINEN `ausgangsrechnung`-Kreis, und alle drei stehen auf `ist_platzhalter = true`. drizzle/0006_nummernkreis.sql:53-55 im Klartext: „Solange true, verweigert fin.rechnung_nummer_ziehen." Heute kann in KEINER Gesellschaft eine Rechnungsnummer gezogen werden. `select … from rechnung` liefert 0 Zeilen — der Kreis hat nie eine Nummer vergeben.
- Es gibt keinen Weg, einen Kreis zu bestaetigen: `grep bestaetig src/server/services/finanz/nummernkreis.ts` → nichts. Die Manifestroute `/portal/[mandant]/finanzen/nummernkreise` (src/server/registry/routen.generiert.ts:247, Phase 6) hat keine Seite; unter src/app/portal/[mandant]/finanzen/ liegt nur `rechnungen/`. Auch `/portal/[mandant]/einstellungen/*` (Manifest 347-364, teils Phase 1) existiert nicht als Verzeichnis — alles faellt auf `[...rest]` → `Unterseite` → `NochNichtGebaut` (src/app/portal/unterseite.tsx). Falle 1, genau hier.
- `mandant.angaben_bestaetigt_am` ist NULL fuer alle vier, `iban` leer, `operations` ohne UStG-14-Daten.

3) „FUENFTER BEREICH OHNE CODEAENDERUNG" — widerlegt, an fuenf Stellen.
- src/lib/design/theme.ts:47-52 `FARBEN_BEREICH` ist ein 4-Schluessel-Literal; Zeile 208: `export type BereichSchluessel = keyof typeof FARBEN_BEREICH`. Ein fuenfter Slug ist kein gueltiger Typ.
- src/app/portal/unterseite.tsx:28 und src/app/portal/mein/bausteine.tsx:27: `const BEREICHE = new Set(['reinigung','security','bau','operations'])` — hart, zweimal.
- src/components/oeffentlich/Kontaktwege.tsx:48: `MIT_ANGEBOT = new Set(['reinigung','security','bau'])`.
- Oeffentliches Profil: src/server/services/inhalt/routen.ts:25-39 `OEFFENTLICHE_ROUTEN` ist eine Literalliste; src/app/(public)/unternehmen/[bereich]/page.tsx:16-23 ruft `notFound()` fuer alles, was nicht drinsteht. `/unternehmen/logistik` ist 404.
- Rechte: src/server/auth/katalog.generiert.ts fuehrt `reinigung.lesen`, `security.*`, `bau.*` als Literale (kein `operations.*`). Nach D-17 ist ein nicht registrierter Rechteschluessel dauerhafte, stille Verweigerung. Auch src/server/registry/navigation.ts:82 kodiert `reinigung` fest.
- Der Mechanismus, der das datengetrieben machen wuerde, ist tot: Spalte `mandant.module text[] not null default '{}'` ist bei ALLEN VIER Zeilen leer und wird in src/ nirgends gelesen (`grep` findet nur den ungenutzten Rechteschluessel `system.module_zuweisen`). routen.generiert.ts:98 verspricht „each tab rendered only where its module is enabled" — nicht implementiert. `/portal/[mandant]/einstellungen/module` (Manifest 353) ist ungebaut.
- Es gibt ueberhaupt keinen menschlichen Weg, einen Mandanten anzulegen: `/portal/[mandant]/einstellungen/mandant` (Manifest 347, Phase 1) hat keine Seite. Neue Mandanten entstehen nur durch Editieren von seed/index.ts oder durch SQL.

4) DER ZITIERTE TEST WIEDERHOLT DEN IRRTUM (Falle 3).
tests/isolation/mandanten-trennung.test.ts:125-152, `describe('(4) a fifth area is a row, not a code change (TEN-08)')`: der Test legt den fuenften Mandanten mit `sql.unsafe(...)` an — also als Eigentuemerrolle, an der Anwendung vorbei — und prueft danach genau eine Sache: dass RLS auf `anstellung` die Zeile weiterhin korrekt trennt. Er gibt dem neuen Mandanten KEINEN Nummernkreis (`eigener_nummernkreis` bleibt default false), keinen Farbtoken, keine Rechte, keine Navigation, keine oeffentliche Seite — und prueft auch nichts davon. Er belegt, dass die SQL-Schicht generisch ist. Fuer „ohne Codeaenderung" auf Produktebene ist er kein Beleg.

WAS WIRKLICH STEHT: mandant-Tabelle mit Rechtsform-/Registerdaten, RLS + Spaltenrechte mandantenscharf und getestet; Mandantenwechsel; Gruppenansicht lesend (src/app/portal/gruppe/page.tsx, `withGroupScope` liefert `LeseKontext` — Schreiben ist Compilerfehler, D-41, Invariante 10); oeffentliche Gesellschaftsprofile de+en fuer die vier FESTEN Bereiche.

WIDERSPRUCH: In diesem Abschnitt beruehrt nichts die Out-of-scope-Punkte (§7 UWG / Scraping / Lohnabrechnung / Vergabe-Einreichung). Kein Widerspruch zu melden — aber auch kein Freibrief: die Gruppenansicht bleibt lesend, und `operations` darf gerade deshalb keinen Rechnungskreis bekommen (CHECK `mandant_kreis_nur_rechtseinheit`, D-25).

Richtiger Stand: TEILWEISE. Gebaut ist die Mandantentrennung. Nicht gebaut sind der benutzbare Nummernkreis (Platzhalter, keine Seite, keine Bestaetigung, 0 Rechnungen) und die Erweiterbarkeit um einen fuenften Bereich (mindestens 6 Codestellen plus DESIGN.md-Token).

#### 1 Unternehmensstruktur — Mandantentrennung — `mandant_id` + RLS auf jeder Mandantentabelle, aktiver Mandant nur aus der Server-Sitzung

**Wirklich:** teilweise

Der harte Kern stimmt und ist nachgemessen — die Behauptung als Ganzes ("Stand: GEBAUT") haelt trotzdem nicht.

WAS ICH BESTAETIGEN KANN
- 137 Tabellen in `public`, 136 mit `relrowsecurity` UND `relforcerowsecurity` (nur `__drizzle_migrations` ohne). FORCE ist gesetzt, kein Anwendungsrolle hat BYPASSRLS (`pg_roles`: nur `postgres`).
- Eigene Lesesonde (BEGIN/ROLLBACK, `set local role cse_app`, GUCs wie `bindeSitzung` sie setzt, Sitzung = geseedeter `admin.reinigung`): ueber ALLE ~110 Tabellen mit `mandant_id` gezaehlt, wie viele Zeilen mit fremdem `mandant_id` sichtbar sind. Ergebnis: 0 — mit genau einer Ausnahme (unten). Das ist mehr als die Tests zeigen.
- Der aktive Mandant kommt aus der Sitzung: `src/server/auth/anfrage-sitzung.ts` (Cookie -> `app.sitzung_aufloesen`), `src/server/kontext/index.ts:56-75` bindet die GUCs, `withTenant` wirft ohne genau einen Mandanten. Die API-Routen lesen `?mandant=` NUR als Redirect-Ziel, nie als Filter (`src/app/api/rechnungen/route.ts:31-35`, `src/app/api/angebot/route.ts:222-226`, `src/app/api/raumbuch-import/route.ts:41`). Der Wechsel ist POST-only und prueft die Mitgliedschaft in der DB (`app.mandant_fuer_wechsel`, `drizzle/0018_mandantenwechsel.sql:28-34`).

WAS DIE BEHAUPTUNG NICHT TRAEGT
1. Die zweite Linie ist NICHT unabhaengig — und die Migration behauptet das Gegenteil. `app.sichtbare_mandanten()` liefert im Mandanten-Scope schlicht `array[app.aktiver_mandant()]`, also den GUC (drizzle/0004_rls_baseline.sql:88-89). Der Kommentar darueber (Zeile 83: "if the application ever set a mandant the caller does not belong to, the database still returns nothing") ist widerlegt: mit `benutzer_id` = admin.reinigung, `app.mandant_id` = bau, `app.portal` = intern las meine Sonde 3 `anstellung`- und 3 `person`-Zeilen der REALTIME Service GmbH — obwohl `app.hat_recht('personal.lesen', bau)` in derselben Transaktion `false` ergab. `t_anstellung_lesen`/`t_person_lesen` pruefen kein Recht, nur den GUC. Die Trennung haengt damit an zwei von der Anwendung gesetzten Werten (`app.mandant_id` + `app.portal`), nicht an einer Ableitung in der Datenbank.
2. Der Schutzwall dahinter hat eine Luecke. Die Verteidigung steht ausdruecklich in tests/isolation/rollen.test.ts:210-246: eine Sitzung mit fremdem Mandanten UND `portal='intern'` koenne gar nicht entstehen, weil `sitzung_aufloesen` das Portal aus der Mitgliedschaft ableitet. Diese Ableitung prueft aber nur `bm.entzogen_am is null` (drizzle/0007_benutzer_auth.sql:474-478), waehrend `app.hat_recht` und `app.switcher_mandanten` zusaetzlich `gueltig_ab <= current_date` und `gueltig_bis >= current_date` verlangen (0006_nummernkreis.sql:132ff, 0007:360-362). Eine ABGELAUFENE (nicht entzogene) Mitgliedschaft ergibt also weiterhin `portal='intern'` — und damit greift `p_ma_ceiling` nicht mehr und Punkt 1 wird ohne Anwendungsfehler erreichbar. Kein Test deckt das ab; `mandanten-trennung.test.ts` setzt den GUC nie auf einen Mandanten, zu dem der Benutzer nicht gehoert.
3. Gemessenes Uebergreifen: `unternehmensprofil` — 6 Zeilen fremder Mandanten sind in einer reinigung-Sitzung lesbar. Ursache: `t_profil_oeffentlich` (drizzle/0015_profil_referenz.sql:61) ist eine PERMISSIVE Select-Policy fuer `cse_app` ohne Mandantenpraedikat. Fuer veroeffentlichte Profile der oeffentlichen Website ist das vertretbar, aber es widerlegt die pauschale Form "RLS auf jeder Mandantentabelle" = Trennung auf jeder Mandantentabelle.
4. Der Beleg "136 von 137" misst das falsche. `relrowsecurity` sagt nichts ueber ein Mandantenpraedikat: 20 Tabellen tragen nur 1-2 Policies, `freigabe_kette` hat gar keine und kein Tabellenrecht (Zugriff nur ueber den Definer `app.freigabe_kette_ziehen`, 0012_freigabe.sql:139/160 — so gewollt, aber eben kein Nachweis fuer Mandantentrennung).

WAS EIN MENSCH HEUTE TUN KOENNTE
5. Niemand kann sich in einem Deployment anmelden. Die einzige Anmeldung ist `/dev/anmelden` (src/app/dev/anmelden/page.tsx), sie stellt eine Sitzung OHNE Anmeldedaten aus und haengt an `devFlaechenAn()` (src/lib/dev-flaechen.ts:21-24: aus, sobald `NODE_ENV=production` und `CSE_DEV_FLAECHEN` nicht 1). Eine echte Anmeldung (Telefon + Einmalcode) ist offen. `devSitzungAusstellen` (src/server/auth/sitzung.ts:139-176) schreibt `aktiver_mandant_id` ungeprueft aus dem Formular — in einem Nicht-Produktionsbuild ist damit Punkt 1 direkt ausloesbar. Die Trennung ist also heute nur im Entwicklungsbuild vorfuehrbar.
6. Die Belegkette "rollen.test.ts laeuft ueber alle 432 Manifestrouten" prueft `pruefeZugang(pfad, …)`, also das Tor, nicht die Seite. Im Dateisystem stehen 127 `page.tsx` gegenueber 432 Manifestrouten; der Rest faellt auf `src/app/portal/unterseite.tsx:92/121` -> `NochNichtGebaut`. Der Test zaehlt Adressen, keine gebauten Seiten.
7. Seed-Deckung: `rechnung`, `dokument`, `medien` haben 0 Zeilen. Fuer die Finanz- und Dokumentendomaene gibt es also keine einzige Zeile, an der ein Mensch die Mandantentrennung heute sehen koennte.

Widerspruch zu "Out of scope" (CLAUDE.md): keiner in diesem Abschnitt. Kaltakquise, Scraping, Lohnabrechnung und automatische Vergabeeinreichung sind hier nicht beruehrt; `tests/isolation/uwg.test.ts` existiert und haelt die UWG-Grenze fest.

Empfehlung in einem Satz: `app.sichtbare_mandanten()` im Mandanten-Scope aus `benutzer_mandant` ableiten (wie `switcher_mandanten` es tut) statt aus dem GUC, und die Portalableitung in `sitzung_aufloesen` um `gueltig_ab`/`gueltig_bis` ergaenzen — erst dann stimmt der Satz "RLS ist die zweite Linie".

#### 8 CRM — Rechtsgrundlage je Kontakt — `rechtsgrundlage` auf jedem Kontakt, Ausgang gesperrt wenn `keine`

**Wirklich:** teilweise

Was steht (unbestritten): `ansprechpartner.rechtsgrundlage` und `kunde.rechtsgrundlage` sind `not null default 'keine'` mit den CHECKs `ansprechpartner_grundlage_belegt`, `_widerspruch_sperrt`, `_kanaele_nur_bei_einwilligung`. Ein echtes fail-closed Tor existiert — aber in der Datenbank: Trigger `trg_lead_aktivitaet_uwg_sendetor` BEFORE INSERT auf `lead_aktivitaet`, Funktion `kern.uwg_sendetor()`, die `app.darf_kontaktiert_werden()` fragt und den Beleg selbst zieht statt ihn vom Aufrufer zu uebernehmen. Zwei Leseseiten zeigen den Zustand und rufen dieselbe Funktion (src/app/portal/[mandant]/crm/kunden/page.tsx:71,137; .../kunden/[id]/page.tsx:109).

Fuenf Gruende, warum „GEBAUT" nicht traegt:

1. Der genannte Beleg ist der falsche. `gate()` prueft `nutzlast.empfaengerRechtsgrundlage === 'keine'` (src/server/agent/policy.ts:153), und das Feld ist OPTIONAL (policy.ts:62, `readonly empfaengerRechtsgrundlage?:`) — `undefined` faellt durch das „harte Tor" hindurch. Kein einziger Produktionsaufrufer laedt die gespeicherte Grundlage eines Kontakts: die einzigen zwei setzen sie fest verdrahtet auf `'vertrag'` (src/server/services/lead/bestaetigung.ts:66; src/server/services/bau/behinderung.ts:386). Die Spalte am Kontakt erreicht policy.ts nie.

2. Vokabular-Drift macht das Fuettern unmoeglich. DB-Enum `rechtsgrundlage` = {einwilligung, bestandskunde, anfrage, keine}. TS-Typ (policy.ts:57-58) = {einwilligung, vertrag, berechtigtes_interesse, bestandskunde, keine}. `vertrag` und `berechtigtes_interesse` kennt die Datenbank nicht; `anfrage` — der Wert, den die einzige geseedete Aktivitaet traegt — kennt das Gate nicht. Ein aus `ansprechpartner.rechtsgrundlage` gelesener Wert ist ohne Uebersetzung nicht uebergabefaehig, und eine Uebersetzung gibt es nirgends. behinderung.ts:380 traegt dazu offen `// TODO(client, O-65)`: fuer welche Nachrichtenarten die Schranke ueberhaupt gilt, ist unentschieden.

3. Das echte Tor erreicht heute kein Mensch. `kern.uwg_sendetor()` kehrt in Zeile 1 zurueck, wenn `richtung <> 'ausgehend'`. Jeder INSERT im Produkt ist `'intern'` (src/app/api/lead/route.ts:85; src/server/services/lead/eskalation.ts:101) oder `'eingehend'` (src/server/services/lead/annahme.ts:252). Es gibt keine Seite, keinen Route-Handler und keinen Dienst, der eine ausgehende E-Mail/Telefon-Aktivitaet an einen `ansprechpartner` anlegt.

4. Es gibt keinen Weg, die Grundlage zu setzen oder zu aendern. Ausserhalb von src/server/db/seed/ existiert kein einziges `insert into ansprechpartner|kunde` oder `update` darauf; `find src/app/api -type d | grep -iE 'crm|kunde|ansprech'` ist leer. Die beiden CRM-Seiten sind reine Anzeige. Ein Kontakt, der am Telefon widerspricht, kann nicht erfasst werden.

5. Der Seed zeigt den gesperrten Fall nicht. Alle 4 `kunde`- und alle 4 `ansprechpartner`-Zeilen stehen auf `bestandskunde`; keine Zeile mit `keine`, kein `werbewiderspruch_am`, kein `widerspruch_am`, keine `einwilligung_kanaele`. Der `keine`→PillZustand `'Fehler'`-Zweig (kunden/page.tsx:33) und die Widerspruchsanzeige (Zeile 140) sind auf dem Seed tot. Einzige `lead_aktivitaet`-Zeile: eingehend/portal/vertraglich.

Zu tests/isolation/uwg.test.ts: die Gruppen sind echt und pruefen nicht den Irrtum des Codes nach — Gruppe (6) schreibt bewusst gegen das INSERT statt gegen `app.darf_kontaktiert_werden` (Kommentar Zeile 245-252: die Funktion haing vorher „an kein Ereignis"). Aber `schreibe()` (Zeile 253-269) baut das SQL von Hand, weil es keinen Dienst gibt, den sie rufen koennte. Der Test belegt den Trigger, nicht das Produkt.

Zum Widerspruch: Kaltakquise an gescrapte Kontakte ist hier korrekt NICHT gebaut — Default `keine` plus fail-closed Trigger ist genau die Sperre, die CLAUDE.md („Out of scope", § 7 UWG auch B2B) verlangt. Moeglich bleibt stattdessen: Ausgang nur an Kontakte mit aufgezeichneter, belegter Grundlage (`rechtsgrundlage_quelle` + `_erfasst_am` erzwungen durch CHECK) — dafuer fehlen aber genau die Teile aus Punkt 3 und 4, also der ausgehende Kanal und die Erfassungsmaske.

Stand: TEILWEISE. Schema und DB-Tor sind belastbar; „Ausgang gesperrt" ist heute unbenutzbar, weil es weder einen Ausgang noch eine Pflege der Grundlage gibt, und der behauptete Beleg (policy.ts) sperrt in Wahrheit nichts, was aus dem CRM kommt.

#### 11 Dienstplan — Serien (RRULE), Generator über acht Wochen, Wochen-/Tages-/Monatsansicht, Konflikt- und ArbZG-Erkennung, Einteilung

**Wirklich:** teilweise

Kern stimmt, drei tragende Teile der Behauptung nicht. Was steht: alle sechs Seiten existieren und rendern echte Abfragen, keine rendert `NochNichtGebaut` (/home/user/phase5-e2e/src/app/portal/[mandant]/dienstplan/{woche,tag,monat,serien,konflikte}/page.tsx, einsatz/[id]/page.tsx, 95–653 Zeilen); Einteilung ist ein echter Weg (einsatz/[id]/page.tsx:328+362 Formular -> /api/einsaetze/[id]/besetzen -> besetzeEinsatz, einteilung.ts:604ff mit Qualifikationssperre, Abwesenheit, Überschneidung, ArbZG-Projektion über Gesellschaften); Konfliktquittung funktioniert mit Pflichtbegründung (konflikte/page.tsx:264, api/konflikt/route.ts, MINDESTLAENGE 10); Navigation zeigt auf dienstplan/woche (registry/navigation.ts:40); die Tests prüfen die Sache, nicht den Irrtum (dienstplan-generator.test.ts: acht Einsätze, Zeitumstellung 420/540 min, Feiertag, zehn Serien zur selben Sekunde; einteilung.test.ts: ohne Bestätigung kein Schreiben; e2e dienstplan.spec.ts prüft zehn sichtbare Spalten, 22:00–06:00 an beiden Tagen, beide DST-Nächte, Browser in New York).

WIDERLEGT 1 — „Serien (RRULE)" kann heute niemand anlegen oder ändern. `dienstplan/serien/page.tsx` ist eine reine Leseliste. Die Routen /dienstplan/serien/neu, /serien/[id] (routen.generiert.ts:174–175) und der eigentliche RRULE-Builder /portal/[mandant]/reinigung/turnus{,/neu,/[id]} (routen.generiert.ts:121–123) haben KEINE page.tsx — `find src/app -path '*turnus*' -name page.tsx` ist leer. `insert into turnus` und `insert into planungsserie` stehen ausschliesslich in src/server/db/seed/{dienstplan,security}.ts; es gibt weder einen Dienst noch eine API-Route dafür. Auch security/posten/neu/page.tsx schreibt nur `posten`, keine planungsserie — ein in der Oberfläche angelegter Posten erzeugt also keine Schicht. Serien entstehen heute nur aus dem Seed.

WIDERLEGT 2 — „Generator über acht Wochen" läuft in keinem laufenden System. jobs/einsaetzeGenerieren.ts:29 `zeitplan: '15 2 * * *'` ist eine Zeichenkette, die ausser der Formatprüfung in jobs/registry.ts:65 niemand liest; `fuehreAus` (jobs/runner.ts:52) wird ausserhalb von tests/ nirgends aufgerufen, es gibt kein pg_cron/cron.schedule, keine Job-Seite und keine Job-Route. Das Repo sagt es selbst: tests/isolation/spaltenrechte.test.ts:112 „weil bisher auch kein Planer den Job faehrt … die Anbindung an Supabase Cron kommt spaeter". Folge in der frisch geseedeten DB: alle 7 planungsserie haben horizont_tage 56, aber generiert_bis 2026-10-11 bei current_date 2026-09-12 — der Plan reicht 29 Tage voraus, nicht 56, und schrumpft jeden Tag weiter (Seed ruft den Generator mit heute = Montag−21, seed/dienstplan.ts:108+182). Die acht Wochen sind in horizontEnde (generator.ts:100) korrekt und im Isolationstest bewiesen, aber nichts führt sie fort.

WIDERLEGT 3 — die genannten Zahlen stimmen nicht. Ist-Stand: einsatz 82 (nicht 98), einsatz_zuordnung 54 (nicht 55), planungs_konflikt 1 (nicht 3), planungsserie 7 (stimmt). Der eine Konflikt ist art=arbzg, schwere=verstoss, offen, erkannt_durch=detektor_job, und er liegt nur bei `reinigung`; der Konflikteingang von `security` ist leer, und von den vier Arten des Enums (ueberschneidung, qualifikation_entfallen, arbzg, aufzeichnungsfrist) trägt der Seed genau eine. `bau` und `operations` haben 0 Einsätze und 0 Serien — Dienstplan ist für zwei der vier Bereiche leer. Die e2e-Konfliktfälle („Gesperrt"/„Warnung") baut die Suite selbst, sie stehen nicht im Seed.

Kleiner, nachrangig: einen einzelnen Einsatz von Hand anlegen geht auch nicht (kein /dienstplan/einsatz/neu; `insert into einsatz` nur in generator.ts, security/eventbesetzung.ts, seed/zeit.ts — quelle='manuell' hat genau 1 Zeile aus dem Seed). Das Übersteuern einer ArbZG-Warnung beim Planen ist nur ein Häkchen `bestaetigt=1` (api/einsaetze/[id]/besetzen/route.ts:55) ohne Begründung im selben Schritt; die Begründung kommt erst später im Eingang, falls jemand hingeht — die Manifestroute /konflikte/[id]/uebersteuern (routen.generiert.ts:179) existiert als Seite nicht.

Recht: dieser Abschnitt berührt keinen der Out-of-scope-Punkte (keine Kaltakquise, kein Jobbörsen-Scraping, keine Lohnabrechnung, keine automatische Vergabeeinreichung) — kein Widerspruch zu CLAUDE.md „Out of scope". ROADMAP.md:145–149 führt die Punkte selbst noch ungehakt.

#### 11 Dienstplan — ArbZG über Gesellschaftsgrenzen — Arbeitszeitgrenzen aggregieren je PERSON über alle Anstellungen

**Wirklich:** teilweise

Der Kern der Behauptung trägt, die Einstufung „GEBAUT" nicht. Was wirklich steht: `zeit_intern.arbeitszeit_fenster` (drizzle/0040_arbzg_konflikt.sql:216) mit Projektionstriggern aus `einsatz_zuordnung`, `einsatz` und — entgegen dem Kommentar in 0040:693 inzwischen doch — `zeiteintrag` (in der DB: trg_z_fenster_projizieren); `app.arbzg_belastung` (0040:1104) als einzige K-06-Tür, die nur Dauern/Grenzen und `fremd` zurückgibt; `pruefeEinsatz`/`leseBelastung`, `detektor.ts`; ein echter Menschenweg: /portal/[mandant]/dienstplan/einsatz/[id]/page.tsx:588-610 rendert die ArbZG-Vorschau (kein NochNichtGebaut, 653 Zeilen), /api/einsaetze/[id]/besetzen/route.ts:109 wirft 422 `arbzg_warnung`, konflikte/page.tsx:229 zeigt „· über Gesellschaften hinweg"; die Rechte `dienstplan.arbzg_pruefen`/`_lesen` sind für admin/leitung geseedet. Der genannte Test existiert und prüft die Sache, nicht den Irrtum.

Vier Befunde widerlegen „GEBAUT":

1. Der Nachtlauf läuft nie. `registriereKonfliktDetektor` (src/server/jobs/konflikteErkennen.ts:45) hat NULL Aufrufer — ebenso `registriereEinsatzGenerator` und `registriereLeadSlaJob`. Kein `cron.schedule` in drizzle/, supabase/ enthält nur config.toml, `jobs/runner.ts` wird nirgends aufgerufen. Die Datei sagt selbst (Zeile ~/0040:1195 ff. und der Job-Docstring): der Nachtlauf ist „der EINZIGE Mechanismus, durch den eine Aenderung in Gesellschaft A im Plan von B auftaucht". Geprüft wird also nur synchron im Moment des Einteilens — wer zuerst plant, erfährt nichts von der später gesetzten Schicht der Schwestergesellschaft.

2. Der Befund erreicht die andere Gesellschaft, aber nicht ihre Oberfläche. `app.arbzg_befund_schreiben` (0040:1343) schreibt `arbeitszeit_verstoss` für JEDE beteiligte Gesellschaft; `planungs_konflikt` wird jedoch nur für den handelnden Mandanten geschrieben (detektor.ts:245, `mandant_id = $1`; einteilung.ts:694 ruft `erkenneKonflikte` mit `kontext.aktiverMandantId`). Die Konfliktseite liest ausschließlich `planungs_konflikt` (konflikte/page.tsx:131), und keine einzige Seite in src/app/ liest `arbeitszeit_verstoss` eigenständig. Der Verstoß der Schwestergesellschaft ist damit gespeichert und unsichtbar.

3. Die erfasste Zeit wird nicht aggregiert — und der Seed zeigt genau den Schaden. `ladeKandidaten` (detektor.ts:193-202) liest `einsatz_zuordnung`, nie `zeiteintrag`; D-305 (docs/DECISIONS.md:4570) benennt das ausdrücklich als offene Lücke gegen § 16 Abs. 2 ArbZG. In der geseedeten DB hat Fatima Yildiz (f4d6f294…, die EINZIGE Person mit Anstellungen in zwei Mandanten) zwei gleichzeitig laufende Zeiteinträge — CSE Dienstleistung seit 2026-09-12 01:06:39 und SSE Security seit 01:06:40, beide `laufend`, beide als aktive `ist`-Fenster projiziert. `arbeitszeit_verstoss` enthält dazu null Zeilen.

4. Der Seed trägt den Abnahmefall nicht. `arbeitszeit_verstoss` hat genau 1 Zeile: Silke Neumann, `ruhezeit_unter_11h`, `betrifft_fremden_mandant = f`, beide Belege `eigen: true` — ein einzelgesellschaftlicher Fall. `planungs_konflikt`: 1 Zeile, dieselbe. Die ROADMAP-Abnahme „6 h Reinigung + 5 h Security triggert einen ArbZG-Verstoß" (docs/ROADMAP.md:166-167) ist im Seed nirgends nachvollziehbar, und ROADMAP.md:150 „ArbZG aggregated per person across entities (TIM-14)" steht unverändert auf `[ ]`.

Nicht als Mangel zu werten: `ausgleichszeitraum_ueberschritten` ist im Enum angelegt und bewusst abgeschaltet, mit TODO(client, O-18) — regelkonform offen statt erfunden.

Kein Widerspruch zu den vier Out-of-scope-Punkten (Kaltakquise/§ 7 UWG, Scraping, Lohnabrechnung, automatische Vergabeeinreichung) berührt diesen Abschnitt; insbesondere wird hier keine Lohnwirkung berechnet — die ArbZG-Prüfung bleibt Warnung und Protokoll, die Lohnrechnung bleibt beim externen System.

Fazit: TEILWEISE. Gebaut ist die Aggregation über Gesellschaftsgrenzen im Moment des Einteilens, für den handelnden Mandanten, aus geplanten Schichten. Nicht gebaut: der laufende Wächter (Job unverdrahtet), die Sichtbarkeit beim betroffenen Zweitmandanten und die Prüfung der tatsächlich erfassten Zeit.

#### 15 Nichts verlässt das System ohne Freigabe — Jeder Ausgang (Mail, Angebot, Beitrag, Mahnung) durch ein Richtlinien-Gate

**Wirklich:** teilweise

Das Gate selbst ist gebaut und gut (src/server/agent/policy.ts: LEG-08 Z.152, fail-closed Z.186, Hash-Bindung Z.171, Sperren fuer angebot_senden Z.216 / nachtrag_einreichen Z.262 / behinderung_senden Z.274; DB-CHECK agent_richtlinie_kein_auto_angebot, freigabe_genehmigt_hat_menschen, Hash-Kette in freigabe_snapshot). Es ist aber nicht "jeder Ausgang". (1) Der Kronzeuge D-55 stimmt nicht: src/server/services/angebot/index.ts:257 versendeAngebot() setzt status='versendet', freigegeben_von=Sitzungsbenutzer, versendet_am=now() OHNE gate(), ohne freigabe, ohne Richtlinie, ohne Rechtsgrundlage, ohne versand-Zeile. Die Aktion 'angebot_senden' kommt im ganzen Repo nur in policy.ts vor. Der Knopf existiert und ist heute klickbar: src/app/portal/[mandant]/angebote/[id]/page.tsx:335-343 -> src/app/api/angebot/route.ts:184, gesichert nur durch das Recht angebot.versenden (Z.52); danach ist das Angebot per RLS-Policy t_kunde (versendet_am is not null) im Kundenportal sichtbar. Der DB-Trigger kern.angebot_versand_pruefen prueft nur Kalkulations-Platzhalter, keinen Menschen. (2) gate() hat genau vier Aufrufer: services/bau/behinderung.ts:481, services/bau/nachtrag.ts:427, services/lead/bestaetigung.ts:98, tests/kern/lead.test.ts:206. Mahnung: kein Dienst, keine Route, keine Seite (mahnung nur in nummernkreis.ts, Rechtekatalog, Routenmanifest, crm/kunden/page.tsx). Beitrag/social_veroeffentlichen: kein Modul, keine Tabelle, keine Seite. Mail: einziger Pfad ist die Anfrage-Eingangsbestaetigung, und die wird immer abgewiesen (api/anfrage/route.ts:277 uebergibt Freigabe und Richtlinie als null). (3) Kein Mensch kann heute eine Freigabe erteilen. docs/DECISIONS.md D-250 Z.3785 woertlich: "Kein Modul dieses Repositoriums erzeugt Freigaben." Bestaetigt: 'insert into freigabe' nur in src/server/db/seed/bau.ts:680. Der Freigabe-Posteingang steht achtmal im Manifest (routen.generiert.ts:296-303, APR-01..APR-08) mit phase:8; im Dateisystem gibt es src/app/portal/[mandant]/freigaben NICHT, ebensowenig angebote/[id]/freigabe (Manifest Z.91). Die beiden gate-gedeckten Formulare verlangen die UUID einer bereits genehmigten Freigabe als Formularfeld (api/bau/behinderungen/[id]/versenden/route.ts:82-86); offener Punkt O-260. Seed: freigabe=1 Zeile, versand=1 Zeile, agent_richtlinie=12 Zeilen fuer nur 3 von 8 Aktionen. (4) Die Wache 'ein-ausgang' (scripts/guards/run-all.ts:402-440) ist echt (Import-Liste + natives fetch), scannt aber nur mussLesen('src', ...) und bewacht einen leeren Raum: src/server/versand/ enthaelt allein dwd.ts, einen lesenden, laut eigenem Kopf 'nicht verbundenen' Wetterabruf; im Repo existiert ueberhaupt kein Mailtransport. (5) Die genannten Tests pruefen die Sache nicht: tests/kern/gate.test.ts ist ein Unit-Test ueber gate(), tests/isolation/freigabe.test.ts prueft Kette, CHECKs und RLS; keiner prueft, dass ein Versanddienst das Gate ruft. tests/isolation/angebot-dienst.test.ts ruft versendeAngebot rund zwanzigmal auf, ohne eine einzige Freigabe — die Pruefung wiederholt den Irrtum des Codes. Randbefund: services/lead/bestaetigung.ts:108 setzt bei Erlaubnis gesendet_am=now() und ergebnis='gesendet (...)', obwohl kein Transport existiert. Kein Out-of-scope-Verstoss gefunden (kein Scraping, keine Kaltakquise, keine Lohn-/E-Bilanz-/Vergabe-Einreichung); LEG-08 deckt Paragraf 7 UWG aber nur dort, wo das Gate auch gerufen wird — der Angebotsversand prueft keine Rechtsgrundlage.

#### 16 Zeiterfassung — Check-in per Token ohne App und ohne Login, Serverzeit massgeblich, Geräteabweichung getrennt gespeichert, Korrekturspur, Offline-Warteschlange, Foto/Video

**Wirklich:** teilweise

Die Behauptung haelt in drei Punkten nicht. Was steht (unbestritten): /check-in/[token] ist eine echte Seite, kein NochNichtGebaut — src/app/check-in/[token]/page.tsx + Stempeluhr.tsx (ein Knopf, loest die Marke bewusst nicht auf, AUT-06); Serverzeit massgeblich und Geraeteabweichung getrennt: zeiteintrag fuehrt geraete_zeit_beginn/_ende und zeitabweichung_beginn_sek/zeitabweichung_ende_sek (nicht, wie behauptet, ein Feld `zeitabweichung_sek`), gesetzt in app.checkin_verbrauchen / kern.stempel_feldzeit (drizzle/0034, 0035); Korrekturspur: Tabelle zeiteintrag_korrektur (0036) plus Dienst src/server/services/zeit/korrektur.ts und Seiten /portal/[mandant]/zeiten/korrekturen und /zeiten/[id]; Offline-Warteschlange: warteschlange.ts (localStorage, client_ereignis_id beim Anlegen, Gruppierung je Marke), api/check-in/[token]/offline, Tabelle offline_ereignis (0042, 0090), Entscheidungsseite /zeiten/nacherfassung -> POST /api/offline-ereignis/[id]. Die DB-Tests sind echt und pruefen die Sache (tests/isolation/zeiteintrag.test.ts: nachgehende Telefonuhr wird gespeichert, nie uebernommen; acht gleichzeitige Anfragen = EIN Eintrag; Korrektur = Fassung 2 mit unveraenderter Fassung 1; offline-warteschlange.test.ts: kein Zeiteintrag ohne Menschenentscheid, Deduplizierung, Vorbereich von aussen unerreichbar).

WIDERLEGT:
1. „Foto/Video" ist NICHT gebaut, sondern nur Schnittstelle. In src/app/check-in/ kommt kein einziges Mal foto/video/kamera/aufnahme/upload vor (grep leer), kein <input type="file">, kein capture-Attribut — auch nicht im Mitarbeiterportal (kein type="file" unter src/app/portal/mein/**). Es gibt die Route api/check-in/[token]/medien/route.ts, den Dienst services/zeit/medien.ts (Magic Bytes, entferneMetadaten, MedienArt foto|video) und die ANZEIGE in /zeiten/[id] („Oeffnen (signierte Adresse, 15 Minuten)") — aber keinen Weg, auf dem ein Mensch heute eine Aufnahme macht. Dazu: SupabaseSpeicher wirft ohne SUPABASE_URL/SERVICE_ROLE_KEY NichtVerbundenFehler (src/server/storage/adapter.ts:60-70), der Bucket ist also nicht verbunden. TIM-10 = TEILWEISE.
2. „Check-in per Token ohne App und ohne Login" ist als Weg des Menschen nicht geschlossen: die Marke kann niemand im Portal ausgeben. gibCheckinAus (services/zeit/checkin.ts:223) hat genau EINEN Aufrufer im ganzen Repo — src/server/db/seed/zeit.ts:234. Keine Portalseite, keine API-Route, kein Job stellt eine Marke aus oder zeigt den Link; ausgabe_kanal steht per Default auf 'unverbunden', und der Versandweg ist ausdruecklich offen (TODO(client, O-93) im Dienst; DECISIONS.md O-93: „How does the check-in link reach the worker"). Ohne Seed gibt es heute keinen benutzbaren Link.
3. Der angefuehrte E2E-Beleg belegt den Check-in nicht. tests/e2e/checkin.spec.ts faehrt ausschliesslich eine ERFUNDENE Marke ('aaaabbbb…7777') und prueft Layout 375x812, ein Tippziel >=44px, axe und die grundlose Ablehnung; ein erfolgreicher Stempel, Serverzeit oder Abweichung kommen darin nicht vor. Der Nachweis dafuer steht in den DB-Tests, nicht im E2E.

Weitere Belege gegen „gebaut":
- Der Seed traegt keine Zeile, an der man Korrekturspur oder Aufnahmen sehen koennte: select count(*) in cse_p5 ergibt zeiteintrag 32, checkin_token 1, offline_ereignis 1 (art=checkin, status=empfangen), zeiteintrag_korrektur 0, einsatz_medien 0.
- /check-in/abgelaufen steht im Manifest (src/server/registry/routen.generiert.ts:70), hat aber kein page.tsx (src/app/check-in/ enthaelt nur [token]/) — die Adresse laeuft ins 404.
- docs/ROADMAP.md:152-154 fuehrt „Tokenised check-in link", „Server-authoritative time" und „Offline queue, photo/video capture, correction trail" weiterhin als offene Kaesten.

Kein Widerspruch zu „Out of scope" in diesem Abschnitt: Kaltakquise, Scraping, Lohnabrechnung und Vergabe-Einreichung werden hier nicht beruehrt. Erwaehnenswert positiv: Geolokalisierung wird bewusst NICHT erhoben, solange O-06 (Betriebsrat, §87 Abs.1 Nr.6 BetrVG) offen ist — die Datenbank weist einen Punkt bei ausgeschaltetem Schalter ab (zeiteintrag.test.ts (5)), also keine stille Umsetzung eines mitbestimmungspflichtigen Wunsches.

Was stattdessen moeglich waere, um auf GEBAUT zu kommen: (a) eine Ausgabeflaeche am Einsatz (/portal/[mandant]/dienstplan/einsatz/[id]) die gibCheckinAus aufruft und den Link EINMAL im Klartext zeigt bzw. als QR-Aushang am Objekt druckt — das umgeht O-93, ohne einen SMS-Anbieter zu praejudizieren; (b) ein Aufnahmeknopf mit <input type="file" accept="image/*,video/*" capture> in der Stempeluhr, der die vorhandene medien-Route bedient und bei nicht verbundenem Speicher sichtbar „nicht verbunden" sagt; (c) je eine Seed-Zeile in zeiteintrag_korrektur und einsatz_medien; (d) ein E2E, der mit einer im Test ausgegebenen Marke einstempelt und die Serverzeit gegen die verstellte Geraetezeit prueft.

#### 16 Zeiterfassung — die vier Pflichtfälle — 22:00–06:00, Umstellungsnacht vor, Umstellungsnacht zurück, zehn gleichzeitige Schichten

**Wirklich:** gebaut

Die Sache steht, die Beleglage nicht. Drei Einwaende, einer davon durchschlagend.

1) DER BELEG FUER FALL (4) ZEIGT AUF TOTEN CODE. Zitiert wird tests/kern/zeit.test.ts:121, also `verteileSpalten` aus src/server/services/zeit/spalten.ts. Dieses Modul wird von NICHTS in src/ importiert:
  grep -rn "zeit/spalten" --include=*.ts --include=*.tsx .
  -> src/server/registry/dienste.ts:77 (nur Registereintrag) und tests/kern/zeit.test.ts:19 (der Test selbst).
Die Spurenrechnung, die ein Planer tatsaechlich sieht, ist eine ZWEITE, unabhaengige Fassung: `verspure` in src/server/services/dienstplan/wochenraster.ts:51, benutzt von src/components/portal/Wochenplan.tsx:161. Der zitierte Test prueft eine Parallelimplementierung, die niemand ausfuehrt. Der Registereintrag dienste.ts:77 laesst sie benutzt aussehen, was den Irrtum stuetzt.
Der Fall ist trotzdem gedeckt, nur woanders: tests/kern/wochenraster.test.ts:14-31 (zehn Spuren ueber `verspure`) und tests/e2e/dienstplan.spec.ts:192-218 — zehn Schichten zur selben Sekunde, geprueft an zehn verschiedenen x-Positionen mit Ueberlappungsprobe im Browser.

2) DIE BEIDEN ZITATE SIND NICHT EIN LAUF. tests/isolation/ortszeit.test.ts ist in vitest.config.ts aus `pnpm test` ausgeschlossen (exclude: tests/isolation/**) und laeuft nur unter `pnpm test:isolation` (package.json:32) gegen ein laufendes Postgres. Das Zitat suggeriert eine Suite.

3) DER SEED TRAEGT KEINE ZEILE, AN DER MAN ES SAEHE. select min/max(plan_datum), count(*) from einsatz -> 2026-08-17 … 2026-10-10, 82 Zeilen. Keine Zeile auf 2026-03-28/29 oder 2026-10-24/25. Dauern nur 210/480/180/240 Minuten — kein 420, kein 540. Und `group by objekt_id, beginn_zeitpunkt having count(*)>1` liefert NULL Zeilen: nirgends teilen sich zwei Schichten Objekt und Anfangsinstant. Die e2e-Fixtures legen ihre eigenen Zeilen in 2028 an (tests/e2e/dienstplan.spec.ts:161-170). Wer heute den geseedeten Plan oeffnet, sieht keinen der vier Faelle.

WAS STANDHAELT: Die Fixtures in tests/kern/zeit.test.ts:24-46 sind richtig gewaehlt (2026-03-29 und 2026-10-25 sind die deutschen Umstellungssonntage; 21:00Z->04:00Z = 420, 20:00Z->05:00Z = 540), und die Wanduhrprobe in Zeile 44-49 belegt, dass die Instants wirklich 22:00/06:00 Berlin lesen. app.loese_ortszeit existiert (drizzle/0032_ortszeit.sql:108) und ist in der laufenden DB vorhanden; die beiden pathologischen Ortszeiten werden gegen die nicht-naheliegende Antwort geprueft (01:00Z statt 01:30Z, 00:30Z statt 01:30Z). dauerMinuten (src/server/services/zeit/dauer.ts) ist die reine Instantdifferenz, stundenText in wochenraster.ts:150 ebenso — die Umstellungsnacht liest darum in der Oberflaeche wirklich 7,00 h bzw. 9,00 h, und tests/e2e/dienstplan.spec.ts:237-258 prueft genau das an der gerenderten Seite. Die Seite selbst ist gebaut, nicht NochNichtGebaut, und aus der Seitenleiste erreichbar (src/app/portal/[mandant]/dienstplan/woche/page.tsx).

Daher: wirklicher Stand `gebaut`, aber die Behauptung in der zitierten Form haelt nicht — Fall (4) ist mit dem falschen Artefakt belegt. Richtig zu zitieren waere tests/kern/wochenraster.test.ts:14-31 plus tests/e2e/dienstplan.spec.ts:192. Offen bleibt als echter Mangel die tote Zweitfassung src/server/services/zeit/spalten.ts samt ihrem Registereintrag dienste.ts:77 sowie der Seed, der keinen der vier Faelle zeigt.

Keiner der vier Ausschluesse aus CLAUDE.md („Out of scope") wird von diesem Abschnitt beruehrt — kein Widerspruch festzustellen.

#### 17 Mitarbeiterportal — Stunden je Tag/Woche/Monat, Stundenkonto, Urlaubskonto, Monatsnachweis als PDF, Einwand, Nachweise, Anträge, mehrsprachig

**Wirklich:** teilweise

Die Behauptung haelt nicht. Die Seiten existieren, aber „ein Mensch koennte es heute benutzen" ist an mehreren Stellen falsch, und drei der genannten Seed-Zahlen sind schlicht unzutreffend.

1) ES GIBT KEINE ANMELDUNG. `find src/app -path '*auth*' -name page.tsx` liefert genau eine Datei: /home/user/phase5-e2e/src/app/auth/bereich/page.tsx (Bereichswechsel). Kein /auth/anmelden, keine Login-Route unter src/app/api (nur /api/sitzung/mandant), `benutzer` hat keine Passwort-Spalte (psql \d benutzer), kein OTP-/Credential-Schema (grep passwort|einmalcode|otp in src/server/db/schema/ = 0 Treffer). Der einzige Weg zu einer Sitzung ist /home/user/phase5-e2e/src/app/dev/anmelden/page.tsx hinter `CSE_DEV_FLAECHEN`; deren Kopf sagt selbst „PR 20 ersetzt genau diese Seite durch Telefon + Einmalcode" (Zeile 15), und src/app/portal/Anmeldung.tsx:19 zeigt dem Arbeiter „Die Anmeldung mit Telefonnummer und Einmalcode wird gerade gebaut (PR 20)". Ohne Dev-Flag erreicht keine Reinigungskraft eine einzige dieser 15 Seiten.

2) „Monatsnachweis als PDF" ist nicht gebaut. src/app/portal/mein/monatsnachweis/page.tsx:15 sagt ausdruecklich „Warum HTML und kein erzeugtes PDF" — es ist ein Druck-HTML-Blatt (@media print, Zeile 157), kein PDF-Renderer, keine Datei. Das ist sauber begruendet (CLAUDE.md „No fake integrations"), aber es ist nicht das Zugesagte. Zusatz: das Blatt bleibt deutsch, nur die Kopfzeile ist uebersetzt (O-51, Zeile ~165) — der § 17-MiLoG-Nachweis selbst ist einsprachig.

3) „Mehrsprachig" ist eine Tabelle, kein benutzbarer Weg. de/en/ar/tr sind in src/lib/i18n/texte.ts:338 ff. vollstaendig und echt uebersetzt (ar mit RTL). Aber die Sprache kommt ausschliesslich aus `person.sprache`, und src/app/portal/mein/rahmen.tsx:29 sagt: geaendert wird sie „an genau einer Stelle, /portal/konto/profil". Diese Seite gibt es nicht — unter src/app/portal/konto/ existiert nur [[...rest]]/page.tsx, das auf `Unterseite` → `NochNichtGebaut` faellt („Dieses Modul wird noch gebaut"), obwohl das Manifest sie fuehrt (src/server/registry/routen.generiert.ts:442, Phase 1, „name, contact, language de/en/ar/tr"). Kein Arbeiter kann seine Sprache heute waehlen. Im Seed haben ausserdem nur zwei Menschen ein `benutzer`-Konto: Fatima Yildiz (de) und Amir Haddad (ar). Marta Kowalski (tr) und Kwame Mensah (en) haben KEIN Login — Tuerkisch und Englisch sind im Portal heute von niemandem erreichbar.

4) Die Seed-Zahlen stimmen nicht (psql cse_p5, als postgres, also ohne RLS): `stundenkonto` = 16, nicht 18. `abwesenheit` = 1, nicht 3. `zeit_einwand` = 0, nicht 1 — „Meine Meldungen" auf /portal/mein/zeiten/[id]/einwand ist fuer jeden leer. `antrag` = 1, und die Zeile gehoert Jonas Berger, der kein Benutzerkonto hat — beide anmeldbaren Arbeiter sehen eine leere Antragsliste. `urlaubskonto` = 1 Zeile, ebenfalls Jonas Berger: Fatima und Amir haben null Urlaubskonten, /portal/mein/urlaub zeigt ihnen nach eigener O-18-Regel „nicht hinterlegt" statt Anspruch/Rest. Das „Urlaubskonto" ist heute von keinem anmeldbaren Menschen zu sehen.

5) Auch das Stundenkonto zeigt nur die halbe Sache: alle 16 Zeilen haben `soll_minuten = 0`. Nach der in src/app/portal/mein/stundenkonto/page.tsx dokumentierten O-18-Regel wird dann weder Soll noch Saldo angezeigt — der Bildschirm ist faktisch eine Ist-Stundenliste, kein Konto. Der e2e-Test bestaetigt genau das (tests/e2e/mitarbeiter.spec.ts:235 „ohne hinterlegte Sollzeit steht ‚nicht hinterlegt'").

6) Zwei weitere Luecken, im Code selbst vermerkt: „Zurueckziehen" eines Antrags ist nicht angeboten (src/app/portal/mein/antraege/page.tsx:28) — `zieheAntragZurueck` existiert, aber `antrag` traegt keine UPDATE-Policy fuer app.aktuelle_person(); der Textschluessel `zurueckziehen` steht ungenutzt in texte.ts. Und /portal/mein/nachweise hat kein Formular und keinen Upload (grep form|upload|input = 0 Treffer) — nur Lesen; Nachweise pflegt jemand anders.

7) Die genannten Pruefungen decken das nicht ab: tests/kern/mitarbeiter-sprachen.test.ts prueft die Vollstaendigkeit des `Record` und per Regex, dass rahmen.tsx `dir`/`lang` aus den Tabellen setzt — es kann nicht sehen, dass die einzige Stelle zum Umstellen der Sprache nicht gebaut ist. tests/e2e/mitarbeiter.spec.ts meldet sich ueber /dev/anmelden an (Zeile 44 ff.) und beweist damit die Seiten, nicht den Zugang. Der Weg des Menschen ist also genau an der Stelle nicht geprueft, an der er heute abbricht.

Was wirklich steht: 15 echte Seiten unter /home/user/phase5-e2e/src/app/portal/mein/** (keine rendert NochNichtGebaut; nur die Catch-all-Route [...rest]/page.tsx tut das), dazu die Schreibwege /api/mein/antraege, /api/mein/abwesenheit, /api/mein/dienstanweisungen/[id]/kenntnisnahme und /api/zeit/einwand, Stunden je Tag/Woche/Monat, Einwand statt Bearbeiten, Dienstanweisungen mit Kenntnisnahme. Was fehlt: der Zugang selbst (PR 20), die Sprachwahl (/portal/konto/profil), das PDF, ein sichtbares Urlaubskonto, Sollzeiten, das Zurueckziehen, der Nachweis-Upload — und Seed-Zeilen an den Menschen, die sich anmelden koennen.

Zu den vier Ausschluessen: in diesem Abschnitt liegt kein Widerspruch. Kaltakquise, Scraping von Indeed/StepStone, Lohnabrechnung und automatische Vergabe-Einreichung werden vom Mitarbeiterportal nicht beruehrt; insbesondere rechnet es keinen Lohn — es bereitet den § 17-MiLoG-Nachweis auf und exportiert, wie CLAUDE.md („Out of scope") es vorsieht, und tests/e2e/mitarbeiter.spec.ts:452 prueft ausdruecklich, dass auf keinem dieser Bildschirme ein Lohnsatz oder Kundenpreis steht (K-05, EMP-13).

#### 21 Rechnungen — Lebenszyklus — Entwurf → festgeschrieben als Einbahnstrasse, Nummer erst bei Festschreibung, lückenlos, unveränderlich, Storno, Hash-Kette

**Wirklich:** teilweise

Der MECHANISMUS steht und ist ungewoehnlich sauber. Widerlegt ist das Wort „GEBAUT": ein Mensch kann heute in keiner der vier Gesellschaften eine Rechnung festschreiben oder stornieren.

1) Der Seed traegt keine einzige Rechnung. In `cse_p5`: `rechnung` 0 Zeilen, `rechnungsposition` 0, `rechnung_steuer` 0, `rechnung_beziehung` 0. Es gibt nichts, woran man Nummer, Kette oder Storno sehen koennte.

2) Festschreiben ist im ausgelieferten Zustand unmoeglich. Alle drei `ausgangsrechnung`-Kreise stehen auf `ist_platzhalter = t`, `naechste_nummer = 1`, `letzter_hash` null (Maske `RE-{jahr}-{nr:5}`, `zuruecksetzung` null). `fin.rechnung_nummer_ziehen` und `nummernkreis.ts:204` verweigern daraufhin jede Nummer. Das ist Absicht, nicht Versehen: `src/lib/annahmen.ts:18-22` („Der Rechnungsnummernkreis bleibt `ist_platzhalter` (O-134)") und `docs/DECISIONS.md:2806` — O-134: „**no invoice may be finalised anywhere until this is answered**". Der Zustand ist also GEPLANT-UND-BEWUSST-OFFEN, nicht betriebsfaehig.

3) Storno ist fuer keinen Seed-Zugang erreichbar. `finanzen.stornieren` haengt in `rolle_berechtigung` nur an `super_admin`; in `benutzer_mandant` ist kein `super_admin` an einen Mandanten gebunden (bau/reinigung/security/operations tragen admin, leitung, mitarbeiter, kunde, formular_eingang, website_renderer). Die Detailseite zeigt dann den Zweig „dieses Konto haelt das Recht nicht" (`src/app/portal/[mandant]/finanzen/rechnungen/[id]/page.tsx:455`, TODO(client, O-77) Zeile 162).

4) Die gruenen Tests beweisen den Weg, nicht den Auslieferungsstand — und sagen das selbst. `tests/e2e/rechnung.spec.ts:34-57`: „es gibt in dieser Gesellschaft keine festschreibbare Rechnung, und damit prueft der ganze Block darunter nichts. Drei Faelle standen deshalb rot." Das `beforeAll` (Zeilen 84-108) setzt fuer die Testdatenbank `ist_platzhalter = false`, `zuruecksetzung = 'jaehrlich'` und verleiht `admin` zusaetzlich `finanzen.stornieren`. Dasselbe in `tests/isolation/rechnung.test.ts` (`macheFakturierfaehig()`). Zwei Vorrichtungen, die im Betrieb nicht existieren.

5) Ein Belegfehler in der Behauptung selbst: die Rechnungsnummer wird NICHT bei `nummernkreis.ts:220` gezogen. `vergebeNummer()` weist `ausgangsrechnung` ausdruecklich ab (`src/server/services/finanz/nummernkreis.ts:157-166`, `DEFINER_KREISE`: „cse_app haelt auf diesem Kreis keine UPDATE-Policy"). Das massgebliche `for update` steht in `drizzle/0077_rechnung_hash.sql:572` innerhalb der SECURITY-DEFINER-Funktion `fin.rechnung_nummer_ziehen` (ab Zeile 405), aufgerufen in `rechnung.ts:873-877`. Bestaetigt durch `tests/isolation/nummernkreis.test.ts:356-366`. Zeile 220 ist der Pfad fuer Angebot/Auftrag/Leistungsnachweis/Wachbuch.

6) Die Festschreibung erfuellt ihren eigenen Vertrag noch nicht. `rechnung.ts:76-84` (`offenerBericht()`) liefert `geprueft: false` — die §14-UStG-Vorabpruefung ist ein Platzhalter („wird mit PR 47 gebaut"), und dieser Bericht wird in Kette und Snapshot mitgehasht. `rechnung.ts:912-919`: `offener_posten`, `buchungssatz`, `periode` und `markiereQuellenAbgerechnet` sind ein Kommentar („kommen mit PR 48 bis PR 50") — eine festgeschriebene Rechnung erzeugt heute keinen offenen Posten und keinen Buchungssatz.

7) Von 11 Rechnungsrouten der Seitenkarte (`src/server/registry/routen.generiert.ts:220-230`, alle `phase: 6`) existieren drei `page.tsx`: Liste, `neu`, `[id]`. Es fehlen `/[id]/pruefung` (§14-Vorabbericht), `/abschlaege`, `/versand`, `/xrechnung`, `/zugferd`. Festschreiben/Verwerfen/Storno sind statt eigener Seiten POST-Formulare auf der Detailseite — legitim; die uebrigen fuenf fehlen ganz.

8) Kleine Ungenauigkeit: nicht `preis_basismenge` allein ist `numeric`, auch `rechnungsposition.menge`. Beide sind Mengen, Invariante 1 ist nicht verletzt — alle Geldspalten sind `bigint` Cent; aber „einzige Ausnahme" stimmt nicht.

Was tatsaechlich traegt (nicht bestritten): `rechnung_entwurf_ohne_nummer` und `rechnung_festgeschrieben_vollstaendig` (0075:550, 562); `fin.rechnung_status_uebergang` mit genau zwei Uebergaengen und der Unveraenderlichkeits-Ausloeser OHNE Spaltenliste (0076); `rechnung_snapshot` + `rechnung_hash` + drei Definer-Funktionen (0077); die genannten Testfaelle existieren wirklich — `rechnung.test.ts:181` (1.000 Entwuerfe, Folge exakt 1..10), `:277` (fuenfzig gleichzeitige Festschreibungen), `:401` (Aenderung scheitert auch als Eigentuemer), `rechnung-kette.test.ts:107ff` (naechtlicher Kettenlauf benennt die erste kaputte Nummer).

Widerspruch nach „Out of scope": in diesem Abschnitt keiner. Kaltakquise, Jobboard-Scraping, Lohnabrechnung/Jahresabschluss und automatische Vergabe-Einreichung werden hier nicht beruehrt; die Rechnung bereitet auf und exportiert (XRechnung/ZUGFeRD sind als Routen vorgesehen, aber nicht gebaut), sie bucht nicht ab.

Fazit: TEILWEISE. Fuer GEBAUT fehlen drei Handgriffe, von denen zwei Entscheidungen des Mandanten sind: O-134 (Maske und Ruecksetzung des Rechnungskreises) beantworten und den Kreis bestaetigen, O-77 (wer darf stornieren) beantworten und das Recht binden — und der Seed braucht mindestens eine festgeschriebene Rechnung mit Kettenglied und ein Storno, sonst ist der Lebenszyklus nur im Testcode sichtbar.

---

## Was beim Messen auffiel, ohne dass jemand danach gefragt hatte

- Die Tabelle `medien` hat NULL Zeilen, und KEIN `abschnitt` traegt eine `medien_id` (26 Seiten, 32+32 Abschnitte, mit_medium = 0 auf jeder). Der gesamte Bildweg der Website ist also noch nie benutzt worden — er ist gebaut, aber unerprobt. Das ist ein Unterschied zu „funktioniert nicht“: er koennte funktionieren, nur hat es niemand einmal durchgespielt, auch nicht im Seed.
- Die Markenkarten (`Abschnitte.tsx:122`) rufen `platzhalterBild()` FEST auf und fragen gar nicht erst nach `abschnitt.medium`. Selbst wenn der Mandant morgen Fotos hochlaedt und ein Redaktionssystem existierte, blieben die vier grossen Karten auf der Startseite gezeichnet. Das ist die eine Stelle, an der der Bildweg nicht endet, sondern gar nicht erst beginnt.
- Der e2e-Test tests/e2e/website.spec.ts:101 heisst woertlich „die Markenavatar-Reihe steht im Fussbereich (PUB-14)“ — obwohl PUB-14 in SPEC §2 und DESIGN §6 die Reihe UNTER DEM HERO verlangen. Hier wurde die Zusicherung an die Umsetzung angepasst und mit der Spec-Nummer beschriftet. Ein gruener Test, der die falsche Sache misst, ist schwerer zu finden als ein roter.
- Auf dem Telefon (< 768 px) sind Unternehmen, Leistungen, Projekte und Kontakt aus dem Kopf verschwunden und stehen nirgends sonst. Vier der zwoelf bestellten Seiten sind auf dem Geraet, fuer das mobil-zuerst gilt, nur ueber die Adresszeile erreichbar. Der Kopf ist im Detail sorgfaeltig auf 375 px gerechnet — Sprachkuerzel, truncate, min-w-0 — und die Navigation selbst ist dabei stillschweigend weggefallen.
- CSE Operations hat ein vollstaendiges, veroeffentlichtes Angebotsformular (`formular_definition.angebot_operations`, elf Felder), und `FORMULAR_SCHLUESSEL` fuehrt es. Die Kontaktseite blendet es aber aus: `MIT_ANGEBOT` in Kontaktwege.tsx:48 nennt nur reinigung/security/bau, mit der Begruendung, Operations verkaufe nichts. Auf `/angebot` erscheint es hingegen. Zwei Stellen, zwei Antworten auf dieselbe Frage.
- `--font-script` (Caveat) steht in globals.css, in theme.ts, in DESIGN als eines von vier Richtungsmerkmalen und wird von `pruefeSeite()` sogar auf einmal je Seite begrenzt — aber kein einziges .tsx verwendet die Klasse. Eine Regel, die etwas begrenzt, was es nicht gibt.
- Weder Inter noch Caveat werden geladen: kein next/font, kein @font-face, kein public/fonts/. Da D-61 jede Fremdanfrage verbietet und ein Test sie auf null zaehlt, laeuft die Seite heute vollstaendig in der Systemschrift des Besuchers. Die gesamte Typografieskala aus DESIGN §2 sitzt damit auf einer Schrift, die niemand gewaehlt hat.
- Der Speicher hat drei Buckets — dokumente, archiv, einsatz-medien — und alle drei sind bewusst privat mit 15-Minuten-Signaturen. Fuer Websitebilder gibt es keinen, und ein oeffentlicher wird im Kommentar ausdruecklich abgelehnt. Die Bilderfrage ist damit nicht nur „Zugangsdaten fehlen“, sondern eine unbeantwortete Entscheidung: wohin gehoert ein Foto, das absichtlich jeder sehen darf.
- `/auth/login` steht als Phase-1-Route im Manifest, aber `git ls-files src/app/auth*` gibt genau eine Datei zurueck — `auth/bereich/page.tsx`. Die Anmeldung, die der Mandant als eine der zwoelf Seiten nennt, ist nicht nur ungebaut, sie ist als Phase-1-Schuld in einem Phase-5-Abschluss stehen geblieben.
- Positiv und niemand hat danach gefragt: PRO-05 ist im Schema schaerfer durchgesetzt, als die Spec verlangt. `referenz` hat einen CHECK `referenz_freigabe_belegt` (keine Kundenfreigabe ohne Datum), einen Teilindex nur auf freigegebene veroeffentlichte Zeilen, und die RLS-Policy `t_referenz_oeffentlich` laesst oeffentlich ausschliesslich `freigegeben_vom_kunden = true` lesen. Eine Marketingzeile von Hand kann gar nicht oeffentlich werden. Es fehlt nur der Weg des Menschen dorthin.
- Ebenfalls unbestellt und richtig: `/barrierefreiheit` existiert als eigene oeffentliche Seite mit eigener Komponente (`(public)/barrierefreiheit/Erklaerung.tsx`) und steht in der Fussnavigation neben Impressum und Datenschutz. Der Mandant hat zwoelf Seiten genannt; das BFSG verlangt diese dreizehnte.
- Die laufende Datenbank weicht von den Migrationen ab, und zwar genau im Rechtebereich: admin haelt finanzen.stornieren (rolle_berechtigung, mandant_id NULL, erstellt_am 2026-09-12 01:33 — 16 Minuten nach allen uebrigen Seedzeilen), obwohl drizzle/0008_berechtigung_matrix.sql:512 den Schluessel nur an super_admin bindet, src/server/auth/katalog.generiert.ts:85 ihn fuer admin als bindbar (nicht gebunden) fuehrt und drei Stellen im Code ausdruecklich kommentieren "finanzen.stornieren haelt heute nur super_admin" (src/app/portal/[mandant]/finanzen/rechnungen/[id]/page.tsx:150, tests/e2e/rechnung.spec.ts:64). Weder Seed noch Migration schreibt diese Zeile — sie stammt aus dem parallel laufenden Durchgang. Alle Rechtezahlen in diesem Bericht sind deshalb ein Schnappschuss dieser Minute; das Positive daran: es ist der erste praktische Beleg, dass AUT-03 im Datenmodell wirklich ohne Deployment traegt.
- benutzer_mandant hat GRANT UPDATE fuer cse_app, aber KEINE UPDATE-Policy — nur t_bm_lesen (SELECT) und t_bm_schreiben (INSERT). Unter FORCE ROW LEVEL SECURITY trifft ein UPDATE, das entzogen_am setzt, damit null Zeilen und meldet nichts. Der Entzug einer Mitgliedschaft — die Sache, die man am Tag einer Kuendigung braucht — ist heute weder ueber eine Oberflaeche noch ueber die Anwendungsrolle moeglich. Dasselbe Muster bei kunde_zugang ist dagegen richtig geloest (t_zugang_verwalten deckt ALL ab).
- rolle hat ueberhaupt keine Schreibpolicy, nur t_rolle_lesen. docs/architecture/03-AUTH-BERECHTIGUNGEN.md:245 verspricht "Additional mandant-specific roles may be created in the UI (rolle.mandant_id set)" — das ist an der Datenbank unmoeglich, und der PR-Plan sagt fuer PR 7 das Gegenteil ("NOT: role creation (five are fixed)"). Zwei Dokumente widersprechen sich; die Datenbank folgt dem PR-Plan.
- Der Navigationspunkt "Einstellungen" verlangt system.einstellung_lesen (src/server/registry/navigation.ts:111) — das haelt nur super_admin. Die Route /portal/[mandant]/einstellungen dahinter verlangt system.mandant_lesen (Manifest 346) — das halten admin und leitung. Wer als admin die Adresse tippt, kommt durch; ueber das Menue findet er sie nie. Wache und Menue beantworten dieselbe Frage verschieden.
- Die beiden einzigen Rechte, die leitung hat und admin nicht, sind angebot.preis_freigeben und wachbuch.schreiben. Die Preisfreigabe liegt also bewusst bei der Leitung und nicht bei der Verwaltung — das ist eine inhaltliche Entscheidung, die in der Beschreibung des Mandanten nicht vorkommt und die jemand bestaetigen sollte.
- Es gibt zwei Rollen mehr, als der Mandant genannt hat: formular_eingang (5 Rechte — oeffentlich.lesen, formular.schreiben, dokument.schreiben, crm.schreiben, crm.kommunikation_versenden, und ausdruecklich NICHT crm.lesen, damit der zum Internet offene Prinzipal die Vertriebspipeline nicht lesen kann) und website_renderer (2 Rechte, nur lesend). Beide sind Dienstkonten mit ist_dienstkonto = true, dokumentiert in 03-AUTH §14.3 und im Seed src/server/db/seed/index.ts:250-360. Das ist gut gemacht, aber der Mandant weiss noch nichts davon.
- Unter src/app/portal/[mandant]/einstellungen/ existiert kein einziges Verzeichnis. Alle 19 Einstellungsrouten des Manifests (Zeilen 346-364) laufen in die Auffangroute — darunter NEUN aus Phase 1: einstellungen, /mandant, /identitaet, /benutzer, /benutzer/[id], /rollen, /rollen/[rolle], /module, /protokoll. Das ist die groesste geschlossene Luecke, die Phase 1 hinterlassen hat, und sie steht dem Wunsch "Permissions must be configurable" direkt im Weg.
- NochNichtGebaut nennt dem Benutzer die Phase aus dem Manifest. Fuer /einstellungen/rollen liest sich das damit als "die Seite dahinter entsteht in Phase 5" — auf einem Stand, der Phase 5 gerade abschliesst. Die Ehrlichkeit der Seite ist richtig; die Phasenangabe wird ab jetzt jeden Leser in die Irre fuehren, solange Phase-1-Routen ungebaut bleiben.
- Nur 3 der 432 Routen verlangen ueberhaupt einen zweiten Faktor (einstellungen/rollen, rollen/[rolle], module), und alle drei sind ungebaut. Der aal2-Zwang existiert praktisch also nur auf dem Schreibpfad der Datenbank (p_rb_aal2, p_bm_aal2) — und dort haelt er, weil D-33 bewusst KEIN aal2-Gate auf das SELECT von benutzer_mandant gelegt hat, was sonst die ganze Plattform fuer jeden Nicht-Admin schwarz gemacht haette.
- Die Übersicht behauptet in einem Kommentar eine Kachel, die es nicht gibt: src/app/portal/[mandant]/zeiten/live/page.tsx:15 schreibt „Dieselbe Sicht wie die Kachel des Dashboards (zeiteintrag_offen)". zeiteintrag_offen ist eine Datenbanksicht, keine Kachel — in kacheln.ts steht keine. DSH-05 ist als Seite gebaut und auf der Übersicht abwesend.
- Der Bereichsfilter (DSH-02) und der DSH-04-Beweis „Zahl = Zeilen der verlinkten Liste" leben ausschliesslich in /dev/dashboard und /dev/kennzahl/[schluessel], hinter devFlaechenAn() (src/app/dev/layout.tsx:31). tests/e2e/dashboard.spec.ts prüft nur dort. Im angemeldeten Portal ist keines von beidem geprüft — und zwei der zwölf Kachelziele landen dort auf NochNichtGebaut.
- kacheln.ts begründet die fehlende Rechnungskachel damit, das Modul komme „in Phase 7", und tests/kern/kennzahlen.test.ts hält das fest, indem es 'finanzen' in belegteModule() verbietet. Auf diesem Zweig stehen src/server/services/finanz/*, /portal/[mandant]/finanzen/rechnungen/*, 10 geseedete Rechnungen (5 festgeschrieben) und ein Nav-Punkt „Rechnungen". Ein Test hält eine überholte Aussage über den Bauzustand fest.
- lead_aktivitaet hat 0 Seed-Zeilen. Zwei der zwölf Kacheln — letzte_aktivitaet und offene_wiedervorlagen — zeigen damit in jeder Gesellschaft dauerhaft 0. Genau die Verwechslung, vor der der Kopfkommentar derselben Datei warnt: „0 heisst es gibt keine, nicht das Modul kommt später".
- Niemand berechnet lead.punktzahl. Beide Seed-Leads tragen den fixen Wert 72 mit der Begründung „Platzhalter … (O-73)"; die Liste zeigt ihn als Tooltip, als wäre er gerechnet. Ein Lead aus dem Webformular (services/lead/annahme.ts:223 setzt punktzahl nicht) kommt ohne Punktzahl an — die Spalte zeigt dann „—".
- Die CRM-Übersicht zählt und meldet, wie viele Ansprechpartner nicht beworben werden dürfen — aber die Route, mit der man eine Rechtsgrundlage erfasst (crm/kontakte/[id]/rechtsgrundlage, Manifest Phase 4), ist nicht gebaut, und die Spalte ist cse_app entzogen. Die Sperre ist richtig; der Weg heraus fehlt. Sinngemäss derselbe Befund, den D-101 für das Angebot schon einmal gemacht hat.
- benutzer_mandant.module ist in allen 18 Seed-Zeilen NULL. Der eine Modulschnitt, den app.hat_recht tatsächlich ausführt (Zeile: „and (bm.module is null or split_part(p_schluessel,'.',1) = any (bm.module))"), ist damit im gesamten Demobestand wirkungslos. Die Modulbeschränkung existiert als Code und wird von keiner Zeile benutzt.
- Die Bau-Gesellschaft hat gebaute Module (Projekte, LV, Aufmass, Nachträge, Bautagebuch, Behinderungen) und Daten dazu, aber keine einzige Kachel. Das Register kennt nur bericht, crm, dienstplan, personal, system, zeit (dashboard.ts belegteModule()). Die Regel „ein nicht gemergtes Modul hat keine Kachel" ist sauber durchgezogen; die Umkehrung — ein gemergtes Modul bekommt eine — wird von nichts erzwungen, und drei Module (bau, reinigung, security) sind ohne Kachel geblieben.
- Es gibt keine Tabelle für Aufgaben, Ausgaben, Zahlungen, Mahnungen, Eingangsrechnungen, Benachrichtigungsversand, Ausschreibungen, Social-Posts oder Bewerbungen — geprüft über pg_tables (137 Tabellen). Fünf der dreizehn gewünschten Übersichtszahlen scheitern nicht an einer fehlenden Kachel, sondern an einer fehlenden Datenquelle.
- Die ursprüngliche, nummerierte Auftragsbeschreibung liegt NICHT im Repository. Der älteste Commit mit Dokumenten (2577717 „Add files via upload") bringt nur CLAUDE.md, DECISIONS.md, DESIGN.md, ROADMAP.md und SPEC.md — SPEC.md ist bereits die zusammengeführte Fassung („Merged from the client's master build specification"). Die Abschnittsnummern 12/13/14/21/22 lassen sich damit nicht gegen ein Originaldokument im Repo prüfen; die Zuordnung stammt aus dem Prüfauftrag. Wer die Beschreibung des Mandanten Zeile für Zeile gegenhalten will, braucht sie als Datei — sonst prüft jede Runde gegen eine Erinnerung.
- Es gibt in dieser Anwendung überhaupt keinen Versand. src/server/versand/ enthält genau eine Datei, und die ist lesend (dwd.ts, Wetter, nicht verbunden). Trotzdem schreibt src/server/services/lead/bestaetigung.ts bei erlaubtem Tor `gesendet_am = now()` und `ergebnis = 'gesendet (richtlinie)'` in versand — ein Beleg über einen Versand, den niemand ausgeführt hat. Heute tritt das nicht ein, weil alle 12 Seed-Richtlinien auf auto_erlaubt=false stehen und das Tor dann eine Freigabe verlangt, die es nicht gibt. Eine einzige Zeile `auto_erlaubt = true` erzeugt jedoch ab sofort Versandbelege ohne Versand. Das ist der einzige Ort im Repository, an dem ein Erfolg behauptet wird, den es nicht gibt — an allen anderen Stellen (DWD, Speicher, E-Mail-Kanal der Behinderungsanzeige) wird „nicht verbunden" sauber geworfen.
- Die Zusage aus ROADMAP Phase 8 — „ein 25.000-€-Angebot kann unter keiner Konfiguration automatisch hinausgehen" — ist bereits heute doppelt gesichert und erschöpfend getestet, obwohl es noch keinen Agenten gibt: im Code (policy.ts, eigener Zweig vor jeder Betragsprüfung, mit § 145 BGB begründet) und in der Datenbank (CHECK agent_richtlinie_kein_auto_angebot). tests/kern/gate.test.ts zählt dafür bewusst über das Register AKTIONEN, nicht über Beispiele.
- Umgekehrt war Invariante 7 an einer Stelle real gebrochen und ist im Code dokumentiert nachgebessert worden: der Zweig für nachtrag_einreichen fehlte in gate(), und die Aktion fehlte zugleich im Register AKTIONEN — dadurch war sie aus der erschöpfenden Prüfung ausgenommen. Ein Typ, der mehr Werte kennt als sein Register, macht genau diese Lücke unsichtbar. Das lohnt sich als Muster für die restlichen Register.
- lead.ausschreibung_id und lead.agent_aufgabe_id stehen als Spalten in der Tabelle, aber ohne Fremdschlüssel — die Zieltabellen ausschreibung und agent_aufgabe gibt es nicht. Dasselbe bei audit_log.agent_id. Das ist sauber vorausgedacht, aber es sind heute Spalten, die nichts referenzieren; eine spätere Migration muss die Fremdschlüssel nachziehen, sonst bleiben sie für immer freie Textfelder.
- audit_log führt akteur_typ mit den Werten mensch · agent · system (SEC-A9) und eine eigene agent_id — die Beweisschicht ist auf Agenten vorbereitet, bevor der erste existiert. Das ist die richtige Reihenfolge und im Vergleich zu vielen Projekten ungewöhnlich.
- Von den 432 Routen des Manifests sind 127 als Seite gebaut. Die Lücke ist nicht versteckt: src/components/portal/NochNichtGebaut.tsx nennt die Adresse und die Phase, und die Zugangsprüfung läuft davor vollständig ab (eine Route ohne Recht fällt weiter auf 404). Das ist die ehrlichste Variante — man sollte sie dem Mandanten aber ausdrücklich erklären, sonst liest er eine vollständige Navigation als vollständiges Produkt.
- pgvector (AGT-06) ist nicht installiert; installiert sind plpgsql, pgcrypto, btree_gist, pg_trgm und unaccent. Für die Wissenssuche des CEO-Assistenten fehlt damit nicht nur die Tabelle wissens_chunk, sondern die Erweiterung selbst — das ist in einer verwalteten Supabase-Instanz ein Administrationsschritt, kein Codeschritt, und gehört rechtzeitig vor Phase 8 geklärt.
- Der nächtliche Prüflauf der Rechnungs-Hashkette (FIN-06) ist vollständig gebaut und getestet — und wird von keinem Produktivpfad aufgerufen. Einziger Aufrufer ist tests/isolation/rechnung-kette.test.ts. Ein Wächter, der nur im Test läuft, meldet im Betrieb nie etwas; das ist genau die Sorte Ausfall, die erst bei der Betriebsprüfung auffällt.
- Der Mandant verlangt in 12 ausdrücklich „personalisierte Ansprache". Das Gate weist Kontakte ohne Rechtsgrundlage hart ab, aber es gibt heute keine Oberfläche, in der jemand eine Einwilligung ERFASST: /werbewiderspruch und /werbewiderspruch/[token] stehen als Phase-4-Routen im Manifest und sind ungebaut, und die Felder rechtsgrundlage_quelle/_erfasst_am/_beleg_dokument_id werden von keinem Formular gefüllt. Der legale Weg ist damit versperrt, solange der illegale gesperrt ist — beides zusammen heißt: heute geht gar kein Outbound. Das gehört als Erstes gebaut, wenn der Mandant Akquise will.
- Die Kette des Mandantenbeispiels bricht nicht an einer, sondern an SECHS Stellen — und alle sechs liegen auf der Schreibseite. Objekt, Revier, Turnus, Planungsserie, Person und Anstellung haben in src/ kein einziges `insert into`. Lesen, Auswerten, Pruefen und Sperren sind ueberall gebaut; Anlegen fast nirgends. Die Plattform kann heute mit dem Seed alles, was der Mandant beschreibt, und ohne ihn kaum etwas davon.
- Angebot -> Auftrag verliert stillschweigend die Positionen. services/angebot/index.ts:384 legt den Auftrag an, setzt das Angebot auf 'angenommen' — und schreibt keine Zeile nach auftrag_leistung. Da einsatz.auftrag_leistung_id und zeiteintrag.auftrag_leistung_id die einzigen Bruecken zum Auftrag sind (TIM-12), ist jeder im Produkt entstandene Auftrag weder planbar noch abrechenbar. Es faellt nicht auf, weil der Seed die Verknuepfung setzt: 63 von 82 Einsaetzen und 24 von 32 Zeiteintraegen tragen sie.
- Es gibt keinen Planer. Drei Jobs sind sorgfaeltig gebaut, mit Idempotenz, Backoff, Alarm und Mandantenbezug als Pflichtangabe — und nichts ruft sie auf: kein pg_cron in drizzle/, nichts in supabase/config.toml, keine API-Route, kein Skript; die registriere*-Funktionen haben ausser tests/ keinen Aufrufer, job_lauf hat 0 Zeilen. Commit 0189f91 behebt einen echten Fehler in einem Nachtlauf, den niemand ausloest — die Begruendung dieses Commits ("ein Waechter, der jede Nacht abgewiesen wird, sieht von aussen aus wie einer, der nichts findet") gilt eine Ebene hoeher unveraendert weiter.
- gibCheckinAus — die Funktion, die den Einmal-Link fuer die Zeiterfassung ausgibt — ist Produktivcode, dessen einzige Nicht-Test-Aufrufer der Seed ist (src/server/db/seed/zeit.ts:36). Die Einloesung ist vollstaendig gebaut, inklusive Offline-Warteschlange und Medien. Nur kommt niemand an den Link.
- Teams gibt es im ganzen Repository nicht — keine Tabelle, keine Route unter 432, kein Recht, keine offene Frage in DECISIONS.md. Das einzige Vorkommen des Wortes ist der Beschreibungstext von /portal/gruppe/kalender. Der Mandant nennt Teams in Abschnitt 16 UND verlangt in Abschnitt 24 einen Filter danach; beide Stellen zeigen auf ein Nichts. Das ist die einzige geforderte Sache, die nicht einmal geplant ist.
- /portal/[mandant]/benachrichtigungen traegt im Manifest Phase 2 — es ist die einzige ungebaute Route mit einer so fruehen Phasennummer. Drei Phasen sind darueber hinweggegangen. Daneben: die Benachrichtigung ist das einzige Modul im Repo, dessen Datenbankseite (Zielzwang als CHECK, RLS auf den Empfaenger, App-Kanal nicht abschaltbar) und dessen Typenregister vollstaendig durchdacht sind, waehrend die Verbindung zwischen beiden fehlt — erzeuge() baut ein Objekt, das niemand speichert.
- person.geburtsdatum ist die einzige sensible Spalte, die den K-05-Schnitt nicht bekommen hat: cse_app hat SELECT darauf. Bei abwesenheit sind sechs Spalten entzogen (Art. 9 DSGVO), bei anstellung der Stundensatz, bei kunde drei kaufmaennische, bei lv_position der Einheitspreis. Das Geburtsdatum haengt allein am Routenrecht personal.stammdaten_lesen — dessen Seite nicht gebaut ist. Heute ist es dadurch faktisch unerreichbar; sobald jemand das Personenblatt erweitert, ist es offen.
- Der Einsatzplan hat einen angebotenen Ausweg, der ins Leere fuehrt: dienstplan/einsatz/[id]/page.tsx sagt dem Planer bei einem ArbZG-Befund woertlich, im Konflikteingang sei "mit Begruendung zu quittieren" — die Seiten konflikte/[id]/quittung und konflikte/[id]/uebersteuern gibt es nicht. Das ist derselbe Fehlertyp, den Commit 83a64b0 ("vier angebotene Wege fuehrten ins Leere") schon einmal behoben hat.
- einsatzanforderung hat 0 Zeilen im Seed, obwohl einsatz.anforderung_snapshot und die harte Qualifikationssperre (SEC-04) gebaut und getestet sind. Der Seed uebt die Sperre ueber diesen Weg also nie aus. Ebenso duenn: 1 posten, 0 veranstaltungen, 1 projekt — die Security- und Bauzweige haengen an Einzelzeilen, waehrend Reinigung mit 6 Revieren, 6 Turnussen und 48 Revier-Raeumen realistisch gefuellt ist.
- dokument hat 0 Zeilen, nachricht hat 0 Zeilen, versand hat 0 Zeilen. Drei Tabellen, die in SPEC §13, EMP-11 und NOT-02 tragende Rollen haben, sind Schema ohne jede Beruehrung — und genau der Fall, vor dem die Pruefanweisung warnt: eine Tabelle ist kein Modul.
- Die Route ist im Manifest, die Seite fehlt — in genau dem Verhältnis, das die Falle beschreibt: routen.generiert.ts führt 432 Adressen, im Dateisystem liegen 127 page.tsx. Für meine vier Abschnitte heisst das konkret: von den 31 Finanz-, Buchhaltungs- und Dokumentenrouten (Manifest Z. 218-271) sind DREI gebaut (finanzen/rechnungen, /neu, /[id]). Alle anderen laufen über src/app/portal/[mandant]/[...rest]/page.tsx und rendern NochNichtGebaut. Die Auffangseite ist gut gemacht — sie hält die Wache (portalZugang), gibt bei unbekannter Route weiter 404 und ersetzt nur die falsche Auskunft durch die wahre — aber sie ist kein Modul.
- Der nächtliche Kettenprüflauf (FIN-06) ist der schärfst geprüfte Dienst des Baums und läuft trotzdem nie: kettenlauf.ts hat 491 Zeilen und zwei eigene Testdateien, ist aber nicht registriert (grep 'registriere(' findet nur einsaetzeGenerieren, konflikteErkennen, lead-sla), und supabase/ enthält keine cron-Definition. Das ist genau das Muster, das der jüngste Commit d46b3cb für den ArbZG-Lauf repariert hat („der Nachtlauf lief nie") — beim Finanz-Lauf steht es noch offen. Heute schadet es nicht, weil O-134 jede Festschreibung blockiert; die Wache muss aber VOR der ersten festgeschriebenen Rechnung hängen, sonst ist die erste Meldung die, die niemand bekommt.
- Der Code sagt an drei Stellen selbst, dass er nicht geprüft hat — und schreibt das in den Hash. REGELWERK_VERSION = 'ustg14-nicht-gebaut' (rechnung.ts:74) und offenerBericht() mit geprueft:false wandern in fin.rechnung_nummer_ziehen UND in den Kettensatz. Dasselbe bei rechnung.ts:795 'freistellungsbescheinigung: null — NULL ist hier die Tatsache, nicht eine Auslassung, und sie steht ausgeschrieben im Hash.' Das ist die seltene Form: ein Beleg, dem man später ansieht, dass er vor dem Validator entstanden ist. Wer Phase 6 abschliesst, muss diese Konstante ändern — sonst tragen auch geprüfte Belege die Zeichenkette 'nicht-gebaut'.
- rechnung.freistellungsbescheinigung_id und rechnung.bankkonto_id sind uuid-Spalten OHNE Fremdschlüssel, weil die Zieltabellen (freistellungsbescheinigung, bankkonto) nicht existieren. Beide sind in der Tabellenliste nicht vorhanden. Das hält die spätere Migration offen, heisst aber auch: eine hineingeschriebene uuid zeigt ins Nichts und niemand merkt es. §48 EStG — 15 % einbehalten, wenn die Bescheinigung am Leistungsdatum nicht gültig ist — ist damit Schema ohne Prüfung, und das ist der Punkt, an dem die Haftung sitzt.
- Die Anforderung sagt 'fin-Tabellen'. Es gibt sie nicht als Tabellen: `fin` ist ein FUNKTIONSschema (15 Funktionen: rechnung_nummer_ziehen, rechnung_kette_schreiben, und dreizehn Trigger), die Tabellen liegen alle in `public` (rechnung, rechnungsposition, rechnung_steuer, rechnung_hash, rechnung_snapshot, rechnung_beziehung, rechnung_zuschlag, nummernkreis, steuersatz_gruppe, kleinbetrag_grenze). Wer nach fin.* sucht, findet die Daten nicht.
- Die Steuerzeilen-Domäne ist strenger gebaut als verlangt: en16931_steuerkategorie liegt auf JEDER Position, satz_bp wird auf der Position eingefroren (nicht live gelesen), steuersatz_gruppe ist datiert (0087_steuersatz_historie) und trägt Befreiungsgrund-Code und -Text (BT-120/BT-121 aus EN 16931). Das heisst: die XRechnung-Felder sind schon da, obwohl der XRechnung-Erzeuger fehlt. Ein späterer UBL-Export müsste das Schema nicht anfassen — nur den Snapshot lesen.
- Umgekehrt überrascht die Lücke bei der Nummernkreisverwaltung: O-352 (DECISIONS.md:5081) hält fest, dass niemand benannt ist, der den Jahreswechsel des Rechnungskreises ausführt — das Öffnen des Nachfolgekreises schliesst den Vorgänger, kopiert letzter_hash nach genesis_hash und trägt den Vorgänger ein. Der Vorgang ist in der Kette vorgesehen und getestet (rechnung-kette.test.ts:393-432 prüft den Kreisübergang), aber es gibt keine Rolle und keine Seite, die ihn auslöst. Beim ersten 1. Januar nach der ersten festgeschriebenen Rechnung wird das akut.
- Positiv und ungefragt: die Gruppenansicht ist an der Rechnung tatsächlich lesend erzwungen, nicht nur versprochen — die Policy t_mandant auf rechnung trägt NOT app.ist_readonly() im WITH CHECK, und der Festschreibungsweg läuft ausschliesslich über eine cse_definer-Policy, die von der Anwendungsrolle gar nicht erreichbar ist (tests/isolation/rechnung.test.ts:162). Invariante 10 ist hier also nicht Konvention, sondern Datenbankrecht.
- Ein stilles Risiko ausserhalb meiner vier Abschnitte, das sie aber trägt: PHASE-5-STAND.md nennt drei Migrationskollisionen zwischen diesem Zweig und claude/phase-5-dienstplan-zeit (0085, 0087, 0088 heissen dort anders) und eine reservierte Lücke bei 0086. Drizzle nummeriert nicht, es sortiert — zwei Dateien mit derselben Nummer sind keine Fehlermeldung, sondern zwei Migrationen in unbestimmter Reihenfolge. Genau die betroffenen Migrationen sind die Finanz-Migrationen der Phase 6 (0085_rechnung_pflichtfelder, 0087_rechnungsposition_typ, 0088_position_herkunft). Wer Phase 6 hereinholt, ohne vorher umzubenennen, bekommt eine Rechnungstabelle in unbestimmter Reihenfolge.
- docs/ROADMAP.md widerspricht sich selbst und sagt es offen: 'Phases are sequential. Do not start one before its predecessor meets its acceptance criteria' — und dann Z. 44: 'Phase 6 hat bereits begonnen, gegen die Regel oben.' Zusätzlich ist Phase 1 nicht fertig: es gibt keinen Login (PR 20 fehlt, Sitzungen kommen aus /dev/anmelden hinter CSE_DEV_FLAECHEN). Für Abschnitt 18 heisst das: der Rechnungs-Lebenszyklus prüft Rechte und Zwei-Faktor-Stufen (finanzen.festschreiben, aal2) gegen eine Sitzung, die heute niemand auf dem regulären Weg bekommt.
- Der naechtliche Betrieb hat keinen Ausloeser. `src/server/jobs/` traegt Register, Runner, Idempotenz, Backoff und Alarm — vollstaendig getestet — und drei Jobs mit Cron-Ausdruecken. `fuehreAus` wird ausserhalb von tests/ nirgends aufgerufen: kein `/api/cron/*`, keine pg_cron-Zeile in 80 Migrationen, kein supabase/functions-Verzeichnis. So ausgeliefert erzeugt niemand Schichten, erkennt niemand ArbZG-Konflikte und eskaliert niemand eine ueberschrittene Lead-Frist. 07-INTEGRATIONEN §5 nennt es korrekt „Nicht verbunden“; PHASE-5-STAND.md fuehrt denselben Job unter PR 30 als fertig. Zwei Dokumente, zwei Aussagen — und die Sitzung, die nur das zweite liest, haelt den Betrieb fuer laufend.
- Der Knopf „Angebot versenden“ ist die eine Stelle, an der das Haus seine eigene Regel bricht. Er zieht eine Rechnungs-... Angebotsnummer, stempelt `versendet_am` und setzt `freigegeben_von` auf den Klickenden — ohne `gate()`, ohne `versand`-Zeile, ohne Empfaenger. Die Aktion `angebot_senden` steht in policy.ts und wird von keiner einzigen Codezeile benutzt. Ausgerechnet bei einem bindenden Vertragsangebot nach § 145 BGB, fuer das D-55 eine doppelte Sperre in Code UND Datenbank verspricht.
- `benachrichtigung` hat keinen Schreiber. Es gibt eine Tabelle, eine Praeferenztabelle, ein Artenregister mit Sammelbarkeit und Kanaelen, zwei Domaenen, die Arten registrieren, und eine Entscheidung (D-53) darueber, wann eine Benachrichtigung gar nicht erst entsteht. Was es nicht gibt, ist ein `insert into benachrichtigung` — `erzeuge()` baut ein Objekt und gibt es zurueck, der Ablaufwaechter schreibt `nachweis_warnung` daneben. Das vollstaendigste Beispiel fuer „eine Tabelle ist kein Modul“ im ganzen Bestand.
- Jede ausgestellte Sitzung behauptet einen zweiten Faktor. `devSitzungAusstellen` schreibt `aal = 'aal2'` fest (sitzung.ts:173), die Begruendung steht ehrlich daneben. Folge: die RLS-Decke `p_rb_aal2` und jedes `aal2: true` im Routenmanifest sind nie gegen ein echtes Nein gelaufen — sie sind gegen ein hartkodiertes Ja gelaufen. Wenn PR 20 kommt, ist das die Stelle, an der sich zeigt, ob die Decke haelt.
- Das Repo prueft sich an Stellen selbst, nach denen niemand gefragt hat. Der Rechtekatalog wird aus dem Architekturdokument ERZEUGT und in CI gegengeprueft (`pnpm katalog:check`), ebenso das 432-Zeilen-Routenmanifest aus der Seitenkarte (`pnpm seitenkarte --check`). Die Wache `ein-ausgang` faellt seit einer Nacharbeit auch auf nacktes `fetch(` herein, nicht nur auf Importnamen — vorher war Invariante 7 eine Zusage ueber die package.json, nicht ueber den Code.
- Das Impressum sagt von sich selbst, dass es keine gueltige Auskunft nach § 5 TMG ist. Die Anschriften, HRB- und USt-IdNr. der vier Gesellschaften in `mandant` sind erfunden und fortlaufend hochgezaehlt; seit Migration 0097 traegt jede Zeile `angaben_bestaetigt_am = NULL`, und der Hinweis steht VOR den Angaben (O-353). Weglassen ging nicht, weil `mandant_ustg14_vollstaendig` Anschrift und Steuernummer von jeder abrechnenden Gesellschaft verlangt. Das ist die sauberste Loesung, die ich in dieser Klemme gesehen habe — und zugleich eine Zeile, die vor dem Livegang beantwortet sein muss.
- Das Schema ist fuenfmal groesser als die Liste des Mandanten: 137 Tabellen gegen 23 genannte Entitaeten. Sechs der 23 fehlen ganz (ausgabe, zahlung, aufgabe, social_post, ai_agents, ai_runs); dafuer traegt es die ganze Rechtsschicht, nach der niemand gefragt hatte — `freigabe_kette` mit Snapshot-Verkettung, `rechnung_hash`, `dokument_aufbewahrung`, `arbeitszeit_verstoss`, `zeiteintrag_korrektur`, `offline_ereignis`. Die Liste des Mandanten beschreibt ein CRM; gebaut wurde ein Betriebsbuch mit Beweisketten.
- `referenz` und `medien` sind beide leer. Die Profile der vier Gesellschaften bestehen im geseedeten Bestand aus Kurztext und Markenkarten — kein Bild, kein Projekt, kein Beitrag. Das ist konsistent mit D-62 (kein Platzhalterfoto, das jemand fuer echt haelt) und mit den offenen Fragen O-10/O-11 zur Bildlieferung, aber es heisst: der sichtbarste Teil des Auftrags, die Aussendarstellung, ist heute Text auf Weiss.
- Es gibt keinen Scheduler. Drei Jobs sind sauber geschrieben und registriert (`einsaetze_generieren`, `konflikte_erkennen`, `lead_sla_eskalation`), aber nichts ruft sie: keine vercel.json, supabase/ enthält nur config.toml, „cron" kommt im ganzen Repository nicht vor. Der Schichtgenerator füllt die acht Wochen nur, wenn ein Mensch ihn von Hand anstösst. Der nächtliche Hash-Kettenlauf (services/finanz/kettenlauf.ts) ist nicht einmal als Job registriert — die Zusage „Manipulation fällt über Nacht auf" ist heute unbelegt.
- `feiertag` hat null Zeilen. Die Berliner Feiertage sind vollständig berechnet und mit 15 Fällen getestet (src/lib/datum/feiertage-berlin.ts), der Generator liest sie aus der Tabelle — aber der in drizzle/0028_dienstplan.sql:149 genannte Job `job:feiertage_pflegen` existiert nicht. Ein Modul, das in jedem Test besteht und im Betrieb nie greift.
- Es gibt überhaupt keinen Mailversand. Das Ausgangs-Gate ist die am sorgfältigsten gebaute Stelle des Systems (fail-closed, § 7 UWG als hartes Tor, Freigabe-Hash an die Nutzlast gebunden, Repo-Wache gegen jeden zweiten Ausgang) — dahinter hängt kein Transport. `versand` schreibt Zeilen über Sendungen, die niemand versendet.
- Der frühere Stand wies im Impressum erfundene Handelsregister- und USt-Nummern als Angaben nach § 5 TMG aus (Commit 52d7c05). Das ist bemerkt und repariert worden (0097/0098, sichtbare Kennzeichnung unbestätigter Angaben) — der Befund bleibt lehrreich: Seeddaten werden rechtlich bindend, sobald eine Pflichtseite sie zeigt.
- D-300: 94 von 99 `SECURITY DEFINER`-Funktionen gehören `postgres` statt `cse_definer` und laufen damit an jeder RLS vorbei. Die Konvention K-01 gilt also faktisch nicht. Die Schuld ist benannt, eingefroren (tests/isolation/definer-eigentum.test.ts) und beschrieben — aber offen.
- Phase 6 ist zweigeteilt und die Migrationsnummern kollidieren: 0085, 0087 und 0088 sind auf diesem und auf `claude/phase-5-dienstplan-zeit` DOPPELT vergeben, 0086 ist reserviert. Drizzle nummeriert nicht, es sortiert nur — beim Zusammenführen meldet sich das nicht von selbst.
- Die Mehrsprachigkeit steht auf dem Kopf: das Mitarbeiterportal kann de/en/ar/tr und die öffentliche Website de/en, aber die INTERNE Oberfläche (Tableisten, Navigation, Portalseiten) ist fest deutsch verdrahtet (src/server/registry/tableiste.ts, navigation.ts).
- Der Seed ist an den Rändern dünn, und zwar dort, wo der Mandant zuerst hinsieht: `referenz` 0 (also keine einzige Kundenreferenz auf den Profilseiten), `medien` 0, `dokument` 0, `benachrichtigung` 0, `schluessel` 0, `dienstanweisung` 0, `sonderleistung` 0, `leistungskatalog` 1 — und 7 Rechnungen mit zusammen genau 1 Position.
- Die Dokumentation ist an mehreren Stellen ehrlicher als üblich: docs/ROADMAP.md warnt im Kopf ausdrücklich, dass seine eigenen Kästchen nie abgehakt wurden und als Statusbrett falsch gelesen werden; PHASE-5-STAND.md nimmt eigene Zahlen zurück, die gegen die Datenbank nicht standhielten. Das ist der Grund, warum diese Prüfung überhaupt am Code messen konnte.
- Der Routen-Manifest-Trick funktioniert, aber er verdeckt die Lücke gut: 432 Adressen sind bewacht und rollengeprüft (tests/isolation/rollen.test.ts), doch nur 140 davon führen auf eine echte Seite. Wer das Manifest für den Bauzustand hält, überschätzt das Projekt um den Faktor drei.

