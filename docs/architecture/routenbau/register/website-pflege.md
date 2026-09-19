# Registereinträge: website-pflege

**Warteschlange, kein Archiv.** Diese Einträge sind **noch nicht** im Baum. Die
gemeinsamen Dateien pflegt EINE Hand, weil mehrere Agenten gleichzeitig arbeiten
und sich sonst in dieselbe Zeile schreiben. Ist ein Abschnitt eingetragen, wird
er hier gelöscht — solange er hier steht, fehlt er dort.

**Die Einträge des Behebungsschritts gelten.** Er lief zuletzt und hatte den
Auftrag, die vollständige aktuelle Liste zu liefern — auch das, was sich seit
dem Bauschritt geändert hat.

## Stand

- Bau: fertig
- Kritik: 13 Befunde
- Behebung: 12 behoben, 3 widerlegt, 7 offen

## Gebaute Adressen

- `/portal/[mandant]/website/formulare` — fertig
  - Tabelle aller formular_definition-Zeilen: Schluessel, Version, Feldzahl, Zustand (Ableitung aus veroeffentlicht_am + zurueckgezogen_am), Datenschutzhinweis-Version, Zustaendigkeit, Reaktionszeit, Eingaenge. Kein Loeschknopf. Kritik umgesetzt: '24 Stunden - vorlaeufig (O-14)', nicht 'noch nicht festgelegt' (D-75).
- `/portal/[mandant]/website/formulare/[id]` — fertig
  - Kopf und Zustaendigkeit aenderbar; Felder nur lesbar MIT englischem Gegenstueck je Feld und Warnung, wo es fehlt; Veroeffentlichen/Zurueckziehen; 'Neue Version anlegen' kopiert Felder und Zustaendigkeit. Veroeffentlichen zieht die bisher lebende Version im gleichen Schritt zurueck (live_uk) und der Knopf nennt das. Feldbearbeitung bewusst nicht gebaut (O-680, Platzhalter nach Regel 1).
- `/portal/[mandant]/website/leistungen` — fertig
  - Liste der Bereichsprofilseiten je Sprache (nicht der Abschnitte) - sonst waere operations unerreichbar. Je Karte: Sprache, Seitenstatus, Zahl der Eintraege wie der LESER sie zaehlt, Verweis aufs Detail. Fehlt der Abschnitt, entsteht er hier mit dem ersten Eintrag. Der vom Plan geforderte Hinweistext 'Eintraege fehlen' ist ersatzlos entfallen - er war nachweislich falsch (bau 4, reinigung 10, security 10; nur operations hat keinen Abschnitt).
- `/portal/[mandant]/website/leistungen/[id]` — fertig
  - Alle Eintraege in EINEM Formular ohne JavaScript, je Zeile Name/Beschreibung plus 'Entfernen' (schickt die Zeilennummer, nie ein leeres Feld als Loeschbefehl), dazu eine Anhaengzeile. setzeLeistungen prueft gegen dasselbe Zod-Schema, das jsonld.ts liest, und weist leeren sowie doppelten Namen ab. jsonb_set laesst daten->'faq' stehen.
- `/portal/[mandant]/website/news` — fertig
  - beitrag-Zeilen mit art in NEUIGKEITS_ARTEN, Statusfilter ueber die Adresse wie /social/posts. Spalten: Titel mit Slug und kanonischer Adresse, Art, Stand, geplant/oeffentlich in Europe/Berlin. listeBeitraege hat dafuer einen neuen, rueckwaertskompatiblen arten-Filter bekommen. Hinweis auf die fehlende Sprachspalte in beitrag (O-681).
- `/portal/[mandant]/website/news/[id]` — fertig
  - Die vom Plan offengelassene Entwurfsfrage ist entschieden: WEDER zweiter Editor NOCH blosse Weiterleitung. Die Seite ist die Vorschau des oeffentlichen Auftritts - Titel, Text, Art, Stand, Slug, kanonische Adresse (verlinkt, wenn draussen), moegliche Schritte aus weg.ts, Hinweis auf 404 bei Entwurf/Rueckzug - und verweist zum Bearbeiten auf /social/posts/[id], nur wo das Recht den Verweis oeffnet.
- `/portal/[mandant]/website/profil` — teilweise
  - Zwei Karten de/en mit Kurzbeschreibung, Beschreibung, Gruendungsjahr, Mitarbeiterzahl und je Sprache eigenem Veroeffentlichen-Knopf (D-82). Der Bildteil ist nach der Kritik ein benannter Platzhalterblock statt eines Auswahlfeldes: es gibt genau eine medien-Zeile je Mandant, sie ist Platzhalter, alle acht Profile tragen logo/cover NULL, und einen Upload gibt es im Portal nicht (O-13). Verweis auf die Galerie. Deshalb 'teilweise'.
- `/portal/[mandant]/website/referenzen/[id]` — fertig
  - Titel, Slug (Form geprueft, leer = Vorschlag ueber app.slug_aus_titel), Kundenname, Beschreibung, Jahr, Sortierung, Bild NUR aus den medien dieses Mandanten (t_medien_oeffentlich liest mit using(true), also filtert der Dienst selbst). Kundenfreigabe als eigener, abgesetzter Block mit Haekchen, Datum und Beleg; Datum wird als Berliner Mitternacht gespeichert. Kanonische Adresse sichtbar mit dem Satz, dass ein geaenderter Slug Verweise bricht.
- `/portal/[mandant]/website/referenzen/[id]/veroeffentlichen` — fertig
  - Entscheidungsseite: was oeffentlich wuerde (Adresse, Projekt, Kunde, Jahr, Bild mit Platzhaltermarke, Beschreibung), darunter der Stand der Kundenfreigabe. Nutzt die BESTEHENDE Route /api/website/referenzen, kein zweiter Weg. Knopf nur mit haeltRechte('referenz.veroeffentlichen'); ohne Freigabe steht kein Knopf, sondern der Satz, was fehlt und wo es eingetragen wird. Die Kritik hatte recht: 'blocker: keiner' war falsch.
- `/portal/[mandant]/website/referenzen (bestehende Liste, korrigiert)` — fertig
  - Zwei von der Kritik gemeldete Fehler behoben: (1) der Veroeffentlichen-Knopf stand ohne Rechtepruefung, obwohl referenz.veroeffentlichen nur super_admin haelt - ein admin druckte ihn und bekam einen 500. Jetzt gegen haeltRechte gegattert. (2) /api/website/referenzen fing nur RedaktionFehler, NichtGefundenFehler flog durch; jetzt ueber autorisierungsAntwort auf 404 abgebildet. Dazu ein Verweis vom Projekttitel auf die neue Detailseite.

## src/server/db/schema/rls.ts — NOCH OFFEN: `referenz` in AUDITIERT

**Teilweise eingetragen (18.09., beim Leeren der Warteschlange).** Die vier
`GEAENDERT_AM`-Zeilen STEHEN jetzt in `src/server/db/schema/rls.ts` — `seite` (0014),
`abschnitt` (0014), `referenz` (0015), `unternehmensprofil` (0015), gegen die Tabellen
geprueft statt uebernommen: alle vier tragen die Spalte `geaendert_am` und trugen bis
heute keinen Ausloeser, der sie setzt. `pnpm db:triggers` hat daraus die Bloecke in
`drizzle/0014_seite_abschnitt_medien.sql` und `drizzle/0015_profil_referenz.sql`
erzeugt (beide Dateien trugen vorher gar keinen Block); eine frisch migrierte Datenbank
hat danach `trg_seite_geaendert_am`, `trg_abschnitt_geaendert_am`,
`trg_referenz_geaendert_am` und `trg_unternehmensprofil_geaendert_am`. Damit haengt der
Zeitstempel nicht mehr am Aufrufer in `services/inhalt/redaktion.ts`.

NICHT eingetragen: **`referenz` in AUDITIERT** und die Zeile in KEIN_HARD_DELETE, die
`tests/kern/loeschsperre.test.ts` („an audited table is delete-locked") dann verlangt.
Drei Gruende, jeder gegen die Wirklichkeit gemessen:

1. **`referenz` hat kein `geloescht_von`.** `\d referenz` zeigt nur `geloescht_am`,
   waehrend `dokument`, `person`, `anstellung`, `vergabemappe`, `team`, `aufgabe` und
   `nachricht` beide Spalten tragen. `Loeschart = 'soft'` ist im Kopf von `rls.ts`
   ausdruecklich als „`geloescht_am` / `geloescht_von`" definiert, und
   `baueSoftDelete('referenz')` (`src/server/db/soft-delete.ts`) erzeugte damit ein
   `update … set geloescht_von = app.aktueller_benutzer()` gegen eine Spalte, die es
   nicht gibt. Heute ruft das niemand — mit dem Registereintrag stuende der Weg offen
   und saehe richtig aus. **Voraussetzung ist eine Migration, die
   `referenz.geloescht_von` nachtraegt.**
2. Dieser Abschnitt lieferte keinen `grund`-Text, und `loeschsperre.test.ts` verlangt
   darin einen pruefbaren Anker aus seiner Liste. `PRO-05` — der Anker, den die
   Begruendung hier nennt — steht nicht darin; ein Text musste also erfunden werden,
   und das ist bei einer Loeschsperre genau das Falsche.
3. `SOFT_DELETE` ist aus `KEIN_HARD_DELETE` ABGELEITET und in
   `tests/isolation/unveraenderbarkeit.test.ts:146` eingefroren. Heute lautet die Liste
   `['dokument','person','anstellung','vergabemappe','team','aufgabe','nachricht']`;
   mit `referenz` kaeme sie ans Ende.

Reihenfolge fuer den, der weitermacht: Migration mit `referenz.geloescht_von`
→ `{ tabelle: 'referenz', art: 'soft', migration: '0015', grund: … }` in
KEIN_HARD_DELETE UND `{ tabelle: 'referenz', migration: '0015' }` in AUDITIERT (dieselbe
Migrationsnummer, sonst faellt „an audited table is delete-locked")
→ `pnpm db:triggers` → die eingefrorene Liste in `unveraenderbarkeit.test.ts:146`
nachziehen.

## Sonstiges

// (1) docs/architecture/04-SEITENKARTE.md — die Rechte der drei Zeilen aendern,
// DANN `npx tsx scripts/seitenkarte/extrahiere.ts` laufen lassen (nur so
// stimmen Karte und src/server/registry/routen.generiert.ts wieder ueberein).
//
//   /portal/[mandant]/website/news        lesen: social.lesen   schreiben: social.schreiben
//   /portal/[mandant]/website/news/[id]   lesen: social.lesen   schreiben: social.schreiben
//
//     Begruendung fuer die Karte: beide Seiten lesen `beitrag` und sonst
//     nichts. Die Tabelle haengt an `social.lesen` (`t_beitrag_lesen`) und
//     `social.schreiben` (`t_beitrag_schreiben`); `referenz.schreiben` oeffnet
//     hier eine Seite, deren Daten es gar nicht freischaltet. Heute haelt
//     jede Rolle mit `referenz.schreiben` auch `social.lesen`, die Liste kommt
//     also gefuellt zurueck — die Gegenrichtung stimmt aber nicht: `leitung`
//     haelt social.* und kommt gar nicht erst auf die Seite. Bearbeitet wird
//     weiterhin unter /social/posts/[id]; diese beiden Seiten sind die
//     Vorschau des oeffentlichen Auftritts.
//
//   /portal/[mandant]/website/profil      lesen: referenz.schreiben
//
//     Begruendung: `system.identitaet_verwalten` streichen. `lesen` ist eine
//     UND-Verknuepfung (src/server/auth/zugang.ts:161-167 sammelt JEDEN
//     fehlenden Schluessel), und das Recht haelt nur `super_admin` — die Seite
//     ist damit fuer `admin` und `leitung` ein 404. Was sie tut, ist Texte je
//     Sprachfassung aendern und je Sprache veroeffentlichen; die Policy dazu
//     ist `t_profil_pflege` mit `referenz.schreiben`. Der Bildteil, fuer den
//     `system.identitaet_verwalten` gedacht war, ist ein benannter
//     Platzhalterblock (O-13) und laedt nichts hoch. Kommt der Upload, kommt
//     das Recht mit ihm zurueck — an der Handlung, nicht an der Seite.
//
// (2) Der Menuepunkt „Website" bleibt auf `referenz.schreiben` und auf
// `website/seiten`. Ihn auf ein schmaleres Recht zu ziehen, wuerde `leitung`
// den Tab zeigen und hinter dem Ziel einen 404 liefern — genau das, was
// D-567 verbietet. Die eigentliche Frage („darf leitung den oeffentlichen
// Auftritt pflegen?") ist O-683 und gehoert dem Auftraggeber.

## Zeilen für docs/DECISIONS.md, Abschnitt „Offen“ — ERLEDIGT (18.09.2026)

Eingetragen heisst gelöscht. Die 4 Zeilen dieser Domäne stehen in
`docs/DECISIONS.md` unter „Open — ask, do not guess“, Unterabschnitt
„Raised while building · die Domänenwelle (Routenbau)“. Hier ist nichts mehr offen.

## Befunde des Prüfers (13)

- **blockierend** · `/home/user/cse-platform/src/app/portal/[mandant]/website/news/page.tsx` — Die Neuigkeitenliste zeigt die veroeffentlichten Beitraege ALLER VIER Gesellschaften, nicht nur die des aktiven Mandanten (Invariante 3). `listeBeitraege` (services/social/dienst.ts:109-125) hat keinen `mandant_id`-Filter und verlaesst sich auf RLS — aber `beitrag` traegt neben `t_beitrag_lesen` (mandant_id = aktiver_mandant) die PERMISSIVE Policy `t_beitrag_oeffentlich FOR SELECT TO cse_app USING (status='veroeffentlicht' AND zurueckgezogen_am IS NULL)` OHNE jede Mandantenbedingung und ohne Rechtepruefung. Permissive Policies werden ver-ODER-t, eine RESTRICTIVE SELECT-Policy gibt es nicht (nur `p_beitrag_decke_*` fuer INSERT/UPDATE). Dasselbe gilt fuer `ladeBeitrag` (dienst.ts:124-130: `select … from beitrag b where b.id = $1::uuid`), also auch fuer /website/news/[id]. Die Seite druckt dann zu einer fremden Zeile die Adresse `/unternehmen/<aktiver mandant>/news/<slug>` (page.tsx:120) — eine Adresse, die oeffentlich 404 antwortet, weil `oeffentlicherBeitragNachSlug` nach mandant filtert — und verlinkt auf `/portal/<aktiver mandant>/social/posts/<fremde id>`. Der Kommentar in news/[id]/page.tsx:77-82 behauptet ausdruecklich das Gegenteil ('die Kennung kann zu einer anderen Gesellschaft gehoeren (`t_beitrag_lesen` gibt dann null Zeilen)') — fuer veroeffentlichte Beitraege ist das falsch. Keiner der 33 Isolationstests prueft die Mandantengrenze von `beitrag`.
  - Behebung: In `listeBeitraege` und `ladeBeitrag` (src/server/services/social/dienst.ts) `and b.mandant_id = app.aktiver_mandant()` in die Abfrage aufnehmen — so wie `listeFormulare`/`listeProfile` es tun und aus demselben Grund (RLS ist die zweite Linie, nie die einzige). Dazu einen Isolationstest 'eine Neuigkeit einer fremden Gesellschaft steht nicht in dieser Liste und ist ueber ihre Kennung nicht ladbar'. Achtung: /portal/[mandant]/social/posts und /social/posts/[id] haengen an denselben zwei Funktionen und sind damit heute ebenso betroffen.
- **wichtig** · `/home/user/cse-platform/src/server/services/inhalt/redaktion.ts` — `aendereReferenz` prueft die FORM des Slugs (SLUG_FORM), aber nicht seine EINDEUTIGKEIT je Mandant, obwohl der Plan sie ausdruecklich verlangt ('Slug … eindeutig je Mandant'). `referenz_slug_uk` ist `unique (mandant_id, slug)` OHNE Teilbedingung auf `geloescht_am`. Ein kollidierender Slug endet als roher PostgresError (23505), nicht als RedaktionFehler; `fuehreWebsiteAus` faengt nur RedaktionFehler und Autorisierungsfehler ab und wirft weiter → 500 statt eines Satzes. Der Weg ist nicht konstruiert: laesst der Bediener das Slug-Feld leer, bildet die Route den Slug ueber `slugVorschlag` → `app.slug_aus_titel(titel)`, und bei zwei aehnlichen Projekttiteln ist das genau der schon vergebene Slug. Zusaetzlich sperrt eine weich geloeschte Referenz ihren Slug, ist aber ueber `ladeReferenzZurPflege` (filtert `geloescht_am is null`) gar nicht sichtbar — der Mensch sieht nicht, wer den Slug haelt.
  - Behebung: In `aendereReferenz` vor dem `update` `select exists (select 1 from referenz where mandant_id = app.aktiver_mandant() and slug = $2 and id <> $1)` pruefen und mit einem eigenen Grund ('slug_vergeben') abweisen, den referenzen/[id]/page.tsx in FEHLER uebersetzt; beim leeren Feld den Vorschlag bei Kollision durchnummerieren (wie `app.slug_fuellen` es beim Anlegen tut) oder den Konflikt melden. Isolationstest ergaenzen.
- **wichtig** · `/home/user/cse-platform/src/server/services/inhalt/redaktion.ts` — `erfasseKundenfreigabe` prueft nur, DASS ein Freigabedatum da ist (`am === null || am === ''`), nicht, dass es ein Datum IST. Weil der Parameter im SQL als `$3::date` steht, serialisiert postgres.js ihn als Datum (`new Date(wert).toISOString()`); ein nicht parsbarer Wert wirft schon im Treiber einen `RangeError: Invalid time value`, also weder RedaktionFehler noch PostgresError — `fuehreWebsiteAus` wirft ihn weiter und der Bediener bekommt einen 500. Der Weg ist realistisch: das Feld ist ein `<input type="date">` ohne `required`, und ein Browser, der den Typ nicht umsetzt, schickt freien Text ('29.03.2026'); ein handgebauter POST erst recht.
  - Behebung: In `erfasseKundenfreigabe` das Datum vor dem Schreiben gegen `^\d{4}-\d{2}-\d{2}$` pruefen (und auf Existenz des Kalendertags) und mit einem eigenen Grund ('freigabe_datum_form') als RedaktionFehler abweisen; Satz dazu in FEHLER von referenzen/[id]/page.tsx.
- **wichtig** · `/home/user/cse-platform/src/app/portal/[mandant]/website/formulare/page.tsx` — Sechs der neun neuen Seiten sind aus dem Portal heraus mit keinem einzigen Klick erreichbar: /website/formulare (und damit auch /website/formulare/[id]), /website/leistungen (+/[id]), /website/news (+/[id]) und /website/profil. Der Menuepunkt 'Website' zeigt auf `website/seiten` (navigation.ts:183), und weder `website/seiten/page.tsx` noch eine andere Datei verweist auf die neuen Adressen. Genau diesen Zustand beschreibt navigation.ts:165-171 als Fehler ('drei Bildschirme, die niemand oeffnen kann, sind genauso gut nicht gebaut') und behauptet in Zeile 176-177 eine 'Sprungzeile', die 'nur zeigt, was diese Sitzung oeffnen darf' — im Modul `website` gibt es keine (kein `rahmen.tsx`, anders als bei `recruiting`). Nur die beiden Referenzseiten sind angebunden, weil die bestehende Referenzliste korrigiert wurde.
  - Behebung: Eine `website/rahmen.tsx` nach dem Muster von `recruiting/rahmen.tsx` bauen: eine Sprungzeile ueber Seiten · Profil · Leistungen · Referenzen · Neuigkeiten · Galerie · Formulare, jedes Ziel gegen sein Recht aus dem Routenmanifest gegattert (AUT-06, D-567), und alle neun Seiten hindurchziehen. Anders bleiben die Seiten nur ueber die Adresszeile erreichbar.
- **wichtig** · `/home/user/cse-platform/src/server/registry/routen.generiert.ts` — Die Routenrechte sind unveraendert geblieben, obwohl der Bericht sie als Vorbedingung benennt — die Seiten sind fuer ihre Zielgruppe heute nicht zu oeffnen. (a) /portal/[mandant]/website/news und /website/news/[id] tragen `lesen: [referenz.schreiben]` (Zeilen 322-323); `referenz.schreiben` halten nur `admin` und `super_admin`, `leitung` — die Rolle, die unter /social/posts die Beitraege pflegt — bekommt 404 und sieht den Tab 'Website' gar nicht (navigation.ts:183 traegt dasselbe Recht). (b) /portal/[mandant]/website/profil traegt `lesen: [referenz.schreiben, system.identitaet_verwalten]` (Zeile 314), UND-verknuepft (zugang.ts:349 'some und nicht every: mehrere Leserechte sind eine UND-Verknuepfung'); `system.identitaet_verwalten` haelt nur `super_admin`, also ist die neue Profilseite fuer admin und leitung ein 404. Beides steht nur als Text im Bericht, nicht im Baum: 04-SEITENKARTE.md ist unveraendert, `scripts/seitenkarte/extrahiere.ts` nicht neu gelaufen.
  - Behebung: Entscheiden und in 04-SEITENKARTE.md eintragen, dann extrahiere.ts laufen lassen: news/news/[id] auf `lesen: [social.lesen]`, `schreiben: [social.schreiben]`; bei profil entweder `system.identitaet_verwalten` streichen oder die Entscheidung in der Karte begruenden; und den Menuepunkt 'Website' auf das schmalste Recht der Unterseiten ziehen, sonst sieht `leitung` den Tab weiterhin nicht.
- **wichtig** · `/home/user/cse-platform/src/server/auth/route-manifest.ts` — Die vier neuen POST-Routen (api/website/formular, api/website/leistungen, api/website/profil, api/website/referenz) stehen nicht im Routenmanifest, und `inhalt/formular` steht nicht im Dienstregister. Zwei zentrale Tests fallen deshalb heute. Zusaetzlich fehlen O-680, O-681 und O-682 in docs/DECISIONS.md, obwohl der Code die TODO(client)-Zeilen traegt — die Merge-Wache meldet sie.
  - Behebung: Die im Bericht mitgelieferten Bloecke `registry_manifest` (vier Zeilen) und `registry_dienste` (ein Eintrag `{ modul: 'formular', pfad: 'inhalt/formular', schreibend: true, schreibRecht: 'formular.schreiben' }`) einfuegen und die drei Zeilen aus `decisions_zeilen` in docs/DECISIONS.md unter 'Open' eintragen, dann die beiden Tests und die Wache erneut laufen lassen.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/website/formulare/[id]/page.tsx` — Der Zweig `daten.benutzer.length === 0` (Hinweis 'Die Mitgliederliste ist dieser Sitzung nicht lesbar') kann nie eintreten: `t_benutzer_lesen` laesst jede Sitzung ihre EIGENE Zeile durch, also enthaelt `waehlbareBenutzer` fuer ein angemeldetes Mitglied immer mindestens den Benutzer selbst. Eine Sitzung ohne `system.benutzer_lesen` sieht deshalb ein Auswahlfeld mit genau einem Namen — dem eigenen — und keinen Hinweis, dass die Liste beschnitten ist. Der eigene Isolationstest beweist genau das.
  - Behebung: Die Bedingung an das Recht haengen statt an die Laenge: `haeltRechte(zugang.sitzung, 'system.benutzer_lesen')` mitabfragen und den Hinweis zeigen, sobald das Recht fehlt — dann stimmt der Satz auch, wenn genau ein Name in der Liste steht.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/website/news/[id]/page.tsx` — Zeile 86 setzt die oeffentliche Adresse fest auf `/unternehmen/<mandant>/news/<slug>`, obwohl `beitragSegment(art)` aus demselben Modul (services/social/dienst.ts:837) entscheidet, ob `news` oder `beitraege` die KANONISCHE Adresse traegt. Die Seite behandelt den Fall `!istNeuigkeit` ausdruecklich (Zeile 121-131) und druckt trotzdem weiter die news-Adresse — bei einer `projektschau` also die nicht-kanonische, die sie bei `draussen` sogar verlinkt. Sitemap und `generateMetadata` (_profil/kanonik.ts:46) nehmen dieselbe Funktion; nur diese Seite nicht.
  - Behebung: `beitragSegment` importieren und `\`/unternehmen/${mandant}/${beitragSegment(b.art)}/${b.slug}\`` bilden — eine Regel, eine Adresse.
- **klein** · `/home/user/cse-platform/src/app/portal/[mandant]/website/leistungen/page.tsx` — Vier der neuen Listenseiten uebergeben `aktiverTab` nicht an `PortalRahmen`, obwohl der Plan es fordert ('dann PortalRahmen mit aktiverTab="website"') und alle sechs neuen Detailseiten es setzen. Der Tab 'Website' bleibt auf diesen Seiten unmarkiert. Betroffen: leistungen/page.tsx (Zeile 83-92), formulare/page.tsx (146-155), news/page.tsx (150-158), profil/page.tsx (100-108).
  - Behebung: `aktiverTab="website"` in den vier Listenseiten ergaenzen (und bei der Gelegenheit in den aelteren seiten/galerie/referenzen-Listen, die es ebenfalls nicht setzen).
- **klein** · `/home/user/cse-platform/src/server/services/inhalt/redaktion.ts` — `EIGENE_PROFILSEITE` bindet nur den ERSTEN Zweig nicht an den Pfad: `s.mandant_id = app.aktiver_mandant()` trifft jede Seite dieser Gesellschaft, nicht nur `/unternehmen/<slug>`. Heute folgenlos (alle `seite`-Zeilen tragen `mandant_id is null`), aber genau an dem Tag, an dem O-49 beantwortet und `seite.mandant_id` gefuellt wird — den der Kommentar selbst als 'greift dann von selbst' ankuendigt — listet `listeProfilseiten` JEDE Seite der Gesellschaft als 'Bereichsprofilseite' und bietet auf ihr 'Leistungsabschnitt anlegen' an (z. B. auf einem Impressum). Auch `ladeLeistungsAbschnitt` und `setzeLeistungen` weiten sich damit auf alle Seiten der Gesellschaft aus.
  - Behebung: Den Pfad in beide Zweige ziehen: `s.pfad = '/unternehmen/' || (select m.slug from mandant m where m.id = app.aktiver_mandant()) and (s.mandant_id = app.aktiver_mandant() or s.mandant_id is null)` — dann bleibt die Liste das, was ihr Name sagt, egal wie O-49 ausgeht.
- **klein** · `/home/user/cse-platform/src/server/services/inhalt/formular.ts` — `veroeffentlicheFormular` setzt `veroeffentlicht_am = now()`, aber `kern.erzwinge_serverzeit_veroeffentlichung` FRIERT den Wert ein, sobald er einmal stand (`elsif tg_op='UPDATE' and old.veroeffentlicht_am is not null then new.veroeffentlicht_am := old.veroeffentlicht_am`). Eine zurueckgezogene und danach wieder live gestellte Version behaelt damit ihren ERSTEN Veroeffentlichungszeitpunkt; die Liste und die Detailseite zeigen unter 'Veroeffentlicht' ein Datum von vor dem Rueckzug. Der Kommentar ueber der Funktion nennt nur den Fall 'nicht null' und nicht diese Wirkung.
  - Behebung: Entweder die Wirkung im Kommentar und auf der Seite benennen ('erstmals veroeffentlicht am …'), oder das Wiederveroeffentlichen einer zurueckgezogenen Version gar nicht anbieten und stattdessen auf 'Neue Version anlegen' fuehren — das ist ohnehin die Regel, die `formular_eingang` schuetzt.
- **klein** · `/home/user/cse-platform/src/server/registry/navigation.ts` — Der Kommentar in Zeile 173-177 ist weiterhin falsch: er sagt 'zwoelf der dreizehn website-Routen' (es sind zehn) und nennt nur zwei der drei Ausnahmen — `website/referenzen/[id]/veroeffentlichen` mit `referenz.veroeffentlichen` fehlt. Der Bericht liefert den Ersatztext unter `registry_navigation`, geaendert wurde die Datei nicht. Falsche Zahlen in Kommentaren werden hier nachweislich abgeschrieben (der Plan hat genau diese Zahl von hier uebernommen).
  - Behebung: Den Block aus `registry_navigation` des Berichts einsetzen.
- **klein** · `/home/user/cse-platform/src/server/services/inhalt/redaktion.ts` — Die neuen Schreibwege setzen `geaendert_am` nicht, obwohl die Spalten existieren und diese Tabellen — anders als `formular_definition` — KEINEN `setze_geaendert_am`-Trigger haben. Betroffen: `setzeLeistungen`/`legeLeistungsAbschnittAn` (abschnitt.geaendert_am), `aendereProfil`/`setzeProfilStatus` (unternehmensprofil.geaendert_am), `aendereReferenz`/`erfasseKundenfreigabe` (referenz.geaendert_am). Diese drei Tabellen tragen auch keinen Audit-Trigger, also bleibt nach einer Aenderung keinerlei Spur — insbesondere nicht bei der Kundenfreigabe, deren Beleg spaeter die Frage beim Anruf des Kunden ist.
  - Behebung: `geaendert_am = now()` in die sechs `update`/`insert`-Anweisungen aufnehmen (die aelteren Funktionen `aendereAbschnitt`, `setzeSeitenStatus`, `setzeReferenzStatus` gleich mit) — oder, besser, `kern.setze_geaendert_am` per Migration auf abschnitt, referenz und unternehmensprofil legen, damit es nicht am Aufrufer haengt.

**Urteil:** Handwerklich ueberdurchschnittlich: alle Abfragen gehen gegen echtes Postgres durch (jede einzelne mit `prepare` gegen cse_test geprueft, kein falscher Spaltenname, kein falscher Enum-Wert), die Mandantenbindung der Leistungen ueber EIGENE_PROFILSEITE wirkt (Reinigung aendert Bau nicht — funktional nachgefahren), jsonb_set laesst die FAQ stehen, die Kundenfreigabe landet als Berliner Mitternacht in UTC (2026-03-29 -> 2026-03-28T23:00Z), das Dienstkonto wird fail-closed abgewiesen, keine erfundene Geschaeftsregel, kein erfundener Gestaltungswert, keine vorgetaeuschte Integration, `tsc --noEmit` und eslint sauber, tests/kern/website-pflege.test.ts 18/18 gruen, die 33 Isolationspruefungen existieren und pruefen echtes Verhalten. Die beiden von der Kritik gemeldeten Altfehler (Veroeffentlichen-Knopf ohne Rechtepruefung, NichtGefundenFehler als 500) sind wirklich behoben.

ABER: ein blockierender Befund. /portal/[mandant]/website/news und die Detailseite zeigen die veroeffentlichten Beitraege ALLER VIER Gesellschaften — `listeBeitraege` und `ladeBeitrag` haben keinen mandant_id-Filter, und `t_beitrag_oeffentlich` ist eine permissive SELECT-Policy ohne Mandantenbedingung. Nachgefahren gegen echtes Postgres als cse_app. Die Seite druckt zu einer fremden Zeile die Adresse der eigenen Gesellschaft; der Kommentar der Detailseite behauptet ausdruecklich das Gegenteil. Kein Isolationstest deckt die Mandantengrenze von `beitrag` ab — die 33 Pruefungen behandeln Leistungen, Formulare, Referenzen und Profil, Neuigkeiten gar nicht.

Dazu zwei Wege, die statt eines Satzes einen 500 liefern (doppelter Referenz-Slug — vom Plan ausdruecklich als 'eindeutig je Mandant' gefordert und nicht gebaut; unlesbares Freigabedatum, das postgres.js schon im Treiber als RangeError wirft), und zwei Dinge, die den Bau praktisch folgenlos lassen: sechs der neun Seiten haengen an keinem Link (die vom Menuepunkt behauptete Sprungzeile gibt es im Modul website nicht), und die Routenrechte sind unveraendert, also bleibt /website/news fuer `leitung` und /website/profil fuer admin und leitung ein 404.

Hinweis zur Pruefbarkeit: die Isolationssuite laesst sich derzeit im Baum gar nicht starten — `tests/isolation/global-setup.ts` bricht im Seed mit 'new row violates row-level security policy for table \"leistungskatalog_position\"' ab. Das gehoert einer anderen Domaene (leistungskatalog), nicht dieser; die Behauptung '33 Pruefungen gruen' konnte ich deshalb nicht nachfahren und habe die Dienste stattdessen einzeln gegen eine eigene, migrierte Datenbank laufen lassen (wieder geloescht).

## Vom Behebenden WIDERLEGT (Befund war falsch)

- Teilwiderlegung zum Slug-Befund: die Behebungsempfehlung „beim leeren Feld den Vorschlag bei Kollision durchnummerieren (wie `app.slug_fuellen` es beim Anlegen tut)" stimmt in der Klammer nicht. `app.slug_fuellen` nummeriert NICHT — der ganze Rumpf ist `if new.slug is null then new.slug := app.slug_aus_titel(new.titel); end if;` (nachgesehen mit `\sf app.slug_fuellen`). Es gibt also kein bestehendes Durchnummerier-Verfahren, dem man folgen koennte, und eines zu erfinden hiesse, eine oeffentliche Adresse zu vergeben, die niemand gewaehlt hat. Umgesetzt ist deshalb die andere Haelfte derselben Empfehlung: den Konflikt melden.
- Teilwiderlegung zum aktiverTab-Befund: betroffen sind SECHS Seiten, nicht vier. Der Pruefer nennt leistungen, formulare, news, profil; `website/referenzen/page.tsx` fehlte es ebenfalls (sein eigener grep zeigt es, die Aufzaehlung im Befundtext laesst es aus). Alle sechs sind versorgt.
- Kein Defekt: die Adresse `/unternehmen/<mandant>/news/<slug>` in der LISTE (news/page.tsx:120) ist richtig und bleibt. Die Liste ist ueber `arten: NEUIGKEITS_ARTEN` gefiltert, also ist `news` dort immer das kanonische Segment. Der Befund nennt sie nur als Folge der fehlenden Mandantengrenze — und die ist behoben.

## Nach der Behebung noch offen

- Routenrechte (Befund 5) — `src/server/registry/routen.generiert.ts` und `docs/architecture/04-SEITENKARTE.md` sind gesperrte Dateien, der Befund ist aber bestaetigt: `lesen` ist eine UND-Verknuepfung (src/server/auth/zugang.ts:161-167 laeuft ueber ALLE Schluessel und sammelt jeden fehlenden), `referenz.schreiben` ist gebunden an super_admin+admin (bindbar leitung), `system.identitaet_verwalten` nur an super_admin (katalog.generiert.ts:194/217). /website/profil ist damit fuer admin und leitung heute ein 404, /website/news fuer leitung ebenso. Vorschlag steht in registry_sonstiges; erst 04-SEITENKARTE.md eintragen, dann scripts/seitenkarte/extrahiere.ts laufen lassen.
- Routenmanifest und Dienstregister (Befund 6) — beide Dateien gesperrt. `npx vitest run tests/kern/routen.test.ts` und `tests/kern/portal-shell.test.ts` fallen weiterhin; die Fehllisten enthalten meine vier api/website-Routen und `inhalt/formular` (neben Eintraegen anderer Domaenen). Bloecke stehen in registry_manifest und registry_dienste.
- docs/DECISIONS.md (Befund 6, zweiter Teil) — gesperrt. Die Wache `todo-client-nicht-im-register` meldet weiterhin formular.ts:33 (O-680), formular.ts:265 (O-682), news/page.tsx:40 (O-681) und jetzt zusaetzlich spruenge.tsx (O-683). Zeilen stehen in decisions_zeilen.
- Navigationskommentar (Befund 12) — `src/server/registry/navigation.ts` gesperrt. Ersatztext steht in registry_navigation; die Zahl ist zehn von dreizehn, und die dritte Ausnahme (`website/referenzen/[id]/veroeffentlichen` mit `referenz.veroeffentlichen`) fehlt heute im Text.
- `geaendert_am` als AUSLOESER statt als Aufruferpflicht — `src/server/db/schema/rls.ts` und die daraus erzeugten Migrationsbloecke sind gesperrt. Der Symptomteil ist behoben (alle acht updates setzen den Wert), die dauerhafte Loesung steht in registry_rls. Solange sie fehlt, traegt kein Audit-Eintrag die Kundenfreigabe einer Referenz — genau die Zeile, die beim Anruf des Kunden die Frage ist.
- O-683 neu angelegt (spruenge.tsx): Soll `leitung` den oeffentlichen Auftritt pflegen duerfen? Solange `referenz.schreiben` fuer sie nur `bindbar` und nicht `gebunden` ist, sieht sie den Tab „Website" nicht — und auch die Sprungzeile kann das nicht heilen, weil sie keine Rechte vergibt. Das ist eine Entscheidung ueber die Rollenmatrix und gehoert dem Auftraggeber.
- `tests/isolation/profil-unterseiten.test.ts` konnte ich nicht fahren. Es setzt die GROSSE Seed-Datenbank voraus, und `pnpm db:seed` scheitert derzeit domaenenfremd: „new row violates row-level security policy for table leistungskatalog_position", nach der Zeile „4 Einzelabrufe … 2 Qualitaetspruefungen" — also im Reinigungs-/Qualitaetsteil (src/server/db/seed/reinigung.ts ist im Arbeitsbaum geaendert, nicht von mir). Das blockiert den global-setup der ganzen Isolationssuite und gehoert zur Domaene reinigung-security-qualitaet.

## NICHT gebaut, mit Grund

- Feldbearbeitung in formular_definition (Felder anlegen, aendern, entfernen): bewusst nicht gebaut, weil die englische Fassung eines Feldes CODE ist (src/lib/i18n/formular-en.ts) und ein im Portal angelegtes Feld auf /en/angebot deutsch dastuende - D-82/D-83 gebrochen, ohne dass ein Test anschlaegt. Braucht eine Uebersetzungstabelle und damit eine Migration. Siehe O-680; die Seite sagt es sichtbar.
- Logo- und Coverbildauswahl im Unternehmensprofil: nicht baubar, solange es keinen Upload-Weg fuer medien gibt und je Mandant genau ein Platzhalterbild existiert. Benannter Platzhalterblock statt Auswahlfeld (O-13).
- Zweiter Beitragseditor unter /website/news/[id]: absichtlich nicht gebaut - eine Regel (services/social/weg.ts), eine Oberflaeche. Gebaut ist die Vorschau des oeffentlichen Auftritts.
- Anlegen einer neuen Referenz oder eines neuen Beitrags von dieser Domaene aus: die Plan-Routen umfassen nur die Detail- und Listenseiten; das Anlegen bleibt, wo es ist (/social/posts/neu bzw. der Auftragsweg nach O-13).

## Notizen des Bauender

## Migration
Keine. Der Plan nannte keine fehlende Tabelle, und es blieb dabei: alle neun Seiten arbeiten auf vorhandenen, geseedeten Tabellen. Meine Nummern 0280-0284 sind unbenutzt. `pnpm db:migrate` lief auf meiner eigenen Datenbank (`w_web`, frisch angelegt, Fensterschluessel gesetzt) zweimal bis `Migrationen angewendet.` durch — vor und nach meiner Arbeit. Keine fremde Datei angefasst. Alle Abfragen wurden gegen echtes Postgres geprueft (Klon von `cse_test` als `w_webd`/`w_wsuite_w1`); die Hilfsdatenbanken sind wieder geloescht.

## Der Fehler, der den Prueflauf gerechtfertigt hat
`setzeLeistungen` und `legeLeistungsAbschnittAn` uebergaben ihre Liste zuerst als `JSON.stringify(...)` an einen `::jsonb`-Parameter. In psql geht das; **ueber postgres.js nicht** — dort landet eine JSON-ZEICHENKETTE in der Spalte, `jsonb_typeof(daten->'leistungen')` ist dann `string`, `leistungenAus` liest eine leere Liste, und die oeffentliche Seite sagt „noch keine Leistungen hinterlegt". Kein Fehler, keine Meldung, die Zeile sieht vollstaendig aus. Dieselbe Falle ist in `services/arbzg/detektor.ts` dokumentiert. Gefunden hat es der Isolationstest, nicht der psql-Lauf. Behoben: es wird das OBJEKT uebergeben, in der Huelle `{ liste: … }` (ein JS-Array kann postgres.js auch als POSTGRES-Array senden; ein Objekt ist eindeutig JSON), ausgepackt im SQL. Gegen echtes Postgres in fuenf Varianten nachgemessen.

## Der zweite Befund, den kein Plan nannte
Eine `with check`-Bedingung **wirft**, sie filtert nicht. Die Regel dieses Moduls — „null geaenderte Zeilen sind ein Fehler mit Grund" — greift dort deshalb gar nicht: die Zeile ist ueber `using` sichtbar (dort genuegt `referenz.lesen`), das `update` setzt an, und Postgres antwortet `42501 new row violates row-level security policy`. Wer `referenz.kundenfreigabe_erfassen` nicht haelt, bekaeme also einen **500** und nicht den Satz, den der Plan verlangt. `aendereReferenz` und `erfasseKundenfreigabe` pruefen das Recht jetzt VOR dem `update` (`pruefeFreigaberecht`, Grund `kein_freigaberecht`); die Route prueft es nicht doppelt.

## Weitere Korrekturen an Plan und Kritik (mit Beleg)
- **Kritik bestaetigt** bei /leistungen: bau 4, reinigung 10, security 10 Eintraege in beiden Sprachen; nur `/unternehmen/operations` hat ueberhaupt keinen `leistungen`-Abschnitt. Der geplante Hinweistext ist ersatzlos entfallen, und der Anlegeweg ist gebaut — die Liste haengt an den SEITEN, nicht an den Abschnitten, sonst waere operations unerreichbar.
- **Kritik bestaetigt** bei der Reaktionszeit: alle vier Zeilen tragen `sla_stunden = 24`. Anzeige: „24 Stunden — vorlaeufig (O-14)"; der Nullfall heisst „offen (O-14)". Ein kern-Test verbietet ausdruecklich den Text „nicht festgelegt".
- **Kritik praezisiert** bei /formulare: `t_formular_schreiben` ist `FOR ALL`, also liest `formular.schreiben` die Definitionen MIT. Nicht lesbar sind `formular_zustaendigkeit` und `formular_eingang` (beide `formular.lesen`). Die Seite schreibt deshalb „nicht lesbar" und nicht „0 Anfragen" — eine falsche Null ist hier eine beruhigende Auskunft.
- **Neuer Befund:** der Besitzer aller vier geseedeten Formulare ist die Gruppen-Administration, ein `super_admin` OHNE `benutzer_mandant`-Zeile. `t_benutzer_lesen` verbirgt ihn vor einer `admin`-Sitzung, der Name kommt also leer zurueck, obwohl die Zuständigkeit dasteht. Unterschieden wird jetzt „nicht gesetzt" von „nicht lesbar"; `setzeZustaendigkeit` prueft einen unveraenderten Wert nicht neu, damit eine Sitzung ohne `system.benutzer_lesen` die Frist trotzdem eintragen kann.
- **Neuer Befund, sicherheitsrelevant:** die Rolle `formular_eingang` (zum Internet offen, `ist_dienstkonto`) haelt `formular.schreiben`. Meine Route ist der erste Schreibweg im Portal auf `formular_definition` — sie haette ihm das Zurueckziehen eines lebenden oeffentlichen Formulars mitgebracht. Fail-closed geloest (O-682), mit Isolationstest.
- **Zwei Fehler in Bestandscode behoben** (beide von der Kritik gemeldet): der Veroeffentlichen-Knopf in `/website/referenzen` stand ohne `haeltRechte('referenz.veroeffentlichen')`, und `/api/website/referenzen` fing nur `RedaktionFehler`, sodass `NichtGefundenFehler` als 500 durchflog.

## Entscheidung, die der Plan offengelassen hat
`/website/news/[id]` ist **weder** ein zweiter Editor **noch** eine Weiterleitung, sondern die Vorschau des oeffentlichen Auftritts: Titel, Text, Art, Stand, Slug, kanonische Adresse (verlinkt nur, wenn der Beitrag wirklich draussen ist), die von `weg.ts` erlaubten Schritte als Auskunft, und ein rechtegattertes Weiter zu `/social/posts/[id]`. Grund: zwei Oberflaechen auf einer Regel laufen auseinander; eine blosse Weiterleitung waere keine Seite, obwohl die Seitenkarte die Adresse fuehrt und die Redaktion eine Frage hat, die die Social-Seite nicht beantwortet (wie sieht das auf unserer Seite aus, unter welcher Adresse). Das gehoert als D-Zeile in DECISIONS.md, wenn ihr sie vergeben wollt.

## Kleinigkeit fuer DESIGN.md
Nichts gefehlt. Ein einziger Punkt am Rande: ein `leistungen`-Abschnitt ohne Eintraege rendert auf `/unternehmen/<slug>` einen leeren Block (`components/oeffentlich/Abschnitte.tsx`). Ich habe die oeffentliche Komponente NICHT angefasst; stattdessen verlangt der Anlegeweg den ersten Eintrag, und die Pflegeseite sagt, was ein leerer Abschnitt oeffentlich bedeutet.

## Neue O-Nummern
O-680, O-681, O-682 (aus meinem Bereich 680-689). Vorhandene benutzt und nicht neu angelegt: O-13, O-14, O-49, O-548.

## Notizen des Behebender

GEPRUEFT, NICHT GEGLAUBT. Jeder Befund wurde am Code oder an einer echten Datenbank nachvollzogen, bevor etwas geaendert wurde. Eigene Arbeitsdatenbanken: `w_web` (Migrationspruefung, frisch gebaut, `pnpm db:migrate` laeuft bis 0304 durch) und `w_webiso` (Isolationsbasis).

KEINE MIGRATION GESCHRIEBEN. Die Nummern 0280-0284 blieben unbenutzt. Der einzige Kandidat waere der `kern.setze_geaendert_am`-Trigger auf abschnitt/referenz/unternehmensprofil gewesen — der entsteht in diesem Repo aber aus dem Register `src/server/db/schema/rls.ts` und wird von `scripts/generate-triggers.ts` in die Migration der jeweiligen Tabelle geschrieben. Ein handgeschriebener Trigger in 0280 waere eine zweite Quelle neben dem Register gewesen, und `tests/kern/loeschsperre.test.ts` haelt ausdruecklich fest, dass es nur eine gibt. Deshalb: Symptom im Dienst geschlossen, Registereintrag zurueckgegeben.

EINE FREMDE TESTDATEI GEAENDERT: `tests/isolation/social-job.test.ts`. Die Mandantengrenze in `ladeBeitrag` laesst den Riegel eine Stufe frueher schliessen — ohne gebundenen Mandanten findet der Lauf den Beitrag gar nicht mehr, statt erst am Auslöser `app.beitrag_braucht_genehmigung` zu scheitern (`j_beitrag` liess `cse_job` sonst jede Zeile lesen). Die Zusage des Tests ist dieselbe geblieben: nichts geht hinaus, der Stand bleibt `geplant`. Nur die erwartete Meldung wandert mit, und der Kommentar sagt warum. 81 Tests in website-pflege + social + social-job gruen.

DESIGN: keine neuen Werte. `spruenge.tsx` uebernimmt die Klassen von `recruiting/rahmen.tsx` Zeichen fuer Zeichen; die Farbwache in `scripts/guards/run-all.ts` meldet zu keiner meiner Dateien etwas.

ISOLATIONSSUITE LAEUFT DERZEIT NICHT AUF DER GEMEINSAMEN BASIS. `tests/isolation/global-setup.ts` baut die Vorlagen neu, sobald sich `src`/`scripts`/`drizzle` aendern, und ruft dabei `pnpm db:seed` — der scheitert im Arbeitsbaum mit „new row violates row-level security policy for table leistungskatalog_position", direkt nach der Seed-Zeile „4 Einzelabrufe … 2 Qualitaetspruefungen". Das ist keine Folge meiner Aenderungen (ich fasse `leistungskatalog_position` nirgends an; `src/server/db/seed/reinigung.ts` ist im Baum geaendert) und blockiert jede Isolationsdatei, auch fremde. Ich bin darum auf eine eigene Basis ausgewichen: `w_webiso` + gestempelte Vorlagen, sodass der Seed uebersprungen wird — die Isolationstests brauchen ihn ohnehin nicht, `harness.seed()` raeumt die Datenbank vorher leer. Einzige Ausnahme: `tests/isolation/profil-unterseiten.test.ts` liest die Seed-Mandanten und konnte deshalb nicht laufen; es gehoert nicht zu dieser Domaene. An der gemeinsamen `cse_test` und ihren Vorlagen habe ich nichts veraendert.

ZWEI FREMDE SEITEN MITGEHEILT: `/portal/[mandant]/social/posts` und `/social/posts/[id]` haengen an denselben zwei Funktionen wie die Neuigkeitenseiten und zeigten dieselben fremden Zeilen. Der Pruefer hat das richtig vorhergesagt.

STAND DER ZENTRALEN PRUEFUNGEN: `npx tsc --noEmit` sauber, `npx eslint` auf allen beruehrten Dateien sauber. `tests/kern/routen.test.ts` und `tests/kern/portal-shell.test.ts` fallen weiterhin — genau um die Eintraege, die ich nicht einsetzen darf (vier api/website-Routen, `inhalt/formular`); die Bloecke liegen bei. `tests/kern/website-pflege.test.ts` und `tests/kern/oeffentliche-detailwege.test.ts`: 31 Tests gruen.
