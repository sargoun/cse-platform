# PLAN aufgaben-nachrichten-oeffentlich
## Gemeinsames
Die neun Routen zerfallen in drei Buendel, und jedes Buendel teilt genau eine Sache.

**1. Aufgaben und Nachrichten teilen eine fehlende Migration — die „Kern\"-Gruppe aus `02-datenmodell/06-RADAR-KI-INHALT.md` §7.** Von den neun dort beschriebenen Tabellen (`team`, `team_mitglied`, `kalender_eintrag`, `kalender_teilnehmer`, `aufgabe`, `benachrichtigung`, `benachrichtigung_praeferenz`, `nachricht`, `nachricht_anhang`, `nachricht_empfaenger`) leben nur vier, und `nachricht`/`nachricht_empfaenger` in der Minimalfassung von `drizzle/0011_benachrichtigung.sql`, die weder Faeden noch polymorphe Empfaenger kennt. `team`/`team_mitglied` werden von BEIDEN gebraucht: `aufgabe.zugewiesen_team_id` und die restriktive Policy `p_zustaendig` haengen daran. Eine einzige Migration „Kern: Teams, Aufgaben, Nachrichtenfaeden\" bedient alle vier Portalrouten; vier getrennte Migrationen wuerden `team` dreimal erfinden. Beide Domaenen liegen ausserdem im selben Abschnitt der Karte (§5.17) und teilen sich mit `/portal/[mandant]/benachrichtigungen` die Huelle, das Tor (`mandantTor` aus `src/app/portal/unterseite.tsx`) und die Darstellung (`PortalRahmen` + `DataTable` + `StatusPill`). Beide sind heute Platzhalter ueber die Auffangroute `src/app/portal/[mandant]/[...rest]/page.tsx`, und der Reiter „Nachrichten\" (`registry/tableiste.ts:127`) fuehrt sichtbar dorthin.

**2. `/leistungen/[slug]`, `/news/[slug]` und `/projekte/[slug]` teilen eine Huelle und eine ungeklaerte Kanonik.** Technisch sind sie fast fertig: `seite`/`abschnitt`, `beitrag` und `referenz` tragen alle ihren URL-Schluessel, die Aufloeser (`ladeSeite`, `oeffentlicherBeitragNachSlug`, `ReferenzAusTabelle.nachSlug`) und die Darstellungen (`OeffentlicheSeite`, `BeitragDetail`, `ProjektDetail`) sind gebaut und werden von den Gesellschaftsprofilen benutzt. Es fehlt dreimal dieselbe duenne Seite — Gruppenebene statt `[bereich]`, feste Gesellschaft `operations`, oeffentliche Huelle statt `ProfilRahmen`, plus der englische Zwilling (D-82). Und dreimal dieselbe Entscheidung: Seitenkarte §2.2 verlangt EINE kanonische Adresse je Zeile unter `/unternehmen/<bereich>/…`, waehrend diese Routen dieselben `operations`-Zeilen noch einmal auslieferten. Sie muessen `rel=canonical` auf die Gesellschaftsadresse setzen und duerfen nicht in die Sitemap — sonst kehrt genau die Doppelung zurueck, wegen der die kurzen Adressen geloescht wurden. Am besten in EINEM PR mit einer gemeinsamen Hilfsfunktion und einem Test, der fuer alle drei prueft, dass die kanonische Adresse gesetzt ist.

**3. `/.well-known/security.txt` und `/werbewiderspruch/[token]` teilen dasselbe Prinzip: keine vorgetaeuschte Verbindung.** Beide haengen an einer Kundenfrage (O-35: welches Postfach liest Sicherheitsmeldungen; O-34: der UWG-Wortlaut und die Ausgangsmatrix), und bei beiden waere die naheliegende Abkuerzung — eine ausgedachte Kontaktadresse, ein selbstformulierter Widerspruchshinweis — schlimmer als das Fehlen. Gebaut wird deshalb jeweils die Schnittstelle mit einem sichtbaren Platzhalter: `security.txt` antwortet 404, solange keine Adresse konfiguriert ist; der Widerspruchstext bleibt als Platzhalter markiert. Beide brauchen eine Zeile unter „Open\" in docs/DECISIONS.md und ein `// TODO(client, O-35)` bzw. `// TODO(client, O-34)`.

**Ein Befund quer zu allem, der nicht zu einer Route gehoert:** `src/server/registry/routen.generiert.ts:55` fuehrt `/.well-known/security.txt` als `{\"art\":\"sitzung\"}`. Das kommt aus `scripts/seitenkarte/extrahiere.ts:158`, wo die Regex `/sitzung|authenticated|otp|route handler/iu` auf das Wort „route handler\" in der Implementierungsspalte trifft. Eine `.well-known`-Datei hinter einer Anmeldung erfuellt ihren Zweck nicht, und die Rollenprobe (`tests/isolation/rollen.test.ts`) laeuft ueber genau diese Liste. Zu korrigieren ist der Extraktor, nicht die erzeugte Datei — dieselbe Regex trifft moeglicherweise weitere Zeilen mit „route handler\" in der Karte.
## Routen

### /portal/[mandant]/aufgaben
- zustand: platzhalter
- dienst_vorhanden: keiner. Es gibt keinen Dienst fuer `aufgabe` — weder `src/server/services/kern/aufgabe.ts` noch etwas anderes; ein grep ueber `src/server/services/` findet nur `agent_aufgabe` (Agentenlaeufe, andere Tabelle, andere Bedeutung) und `lead_aktivitaet.faellig_am` (nur CRM-04-Wiedervorlagen). Naechstverwandt gebaut: `src/server/benachrichtigung/posteingang.ts` (`ladePosteingang`, `zaehleJeArt`) — das ist `benachrichtigung`, nicht `aufgabe`.
- tabellen_vorhanden: False
- recht: aufgabe.lesen (lesen) / aufgabe.schreiben (schreiben); daneben aufgabe.zuweisen und gruppe.aufgabe.lesen
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/portal/[mandant]/crm/leads/page.tsx
- aufwand: gross
- fehlende_tabellen:
  - aufgabe
  - team
  - team_mitglied
  - enum aufgabe_status
  - enum prioritaet
  - enum bezug_typ
- blocker: Die Tabelle `aufgabe` existiert in der lebenden Datenbank NICHT (`to_regclass('public.aufgabe')` ist leer, kein `create table aufgabe` in drizzle/*.sql). Spezifiziert ist sie in `docs/architecture/02-datenmodell/06-RADAR-KI-INHALT.md` §7.7 und dort mit `zugewiesen_team_id` → `team` und einer restriktiven Policy `p_zustaendig`, die `team_mitglied` joint — es fehlen also drei Tabellen, nicht eine. Von den vier benoetigten Enums existiert nur `ausloeser`; `aufgabe_status`, `prioritaet` und `bezug_typ` fehlen. Keine offene Geschaeftsfrage (keine O-Nummer), keine Integration — reine Migrationsarbeit. Nebenbefund: DSH-01 verlangt „upcoming tasks" auf dem Dashboard; die Kachel kann es ohne diese Tabelle nicht geben.

**Plan**

Migration: Enums `aufgabe_status`, `prioritaet`, `bezug_typ`, dann `team`/`team_mitglied` und `aufgabe` nach §7.7 (inkl. `aufgabe_job_uk UNIQUE NULLS NOT DISTINCT` gegen die Wachhund-Dubletten, RLS S5 Modul `aufgabe`, restriktive `p_zustaendig`, kein harter Loeschpfad — `geloescht_am`). Dienst `src/server/services/kern/aufgabe.ts` mit `listeAufgaben(kontext, filter)`, `ladeAufgabe`, `legeAn`, `weiseZu`, `erledige`, `brichAb` — die Fristenlogik (ueberfaellig / faellig heute) rechnet der Dienst in Europe/Berlin aus UTC, nie die Seite. Die Liste zeigt Titel, Status-Pille, Prioritaet, Faelligkeit mit Ueberfaellig-Markierung, Zustaendige(r) bzw. Team und den Bezug (Auftrag, Objekt, Lead) als Link; sortiert nach Frist, nicht nach Eingang, offene zuerst — wie die Leadliste. Filter ueber searchParams: nur meine, nur offene, nach Bezug. Gebaut wird nach dem `mandantTor`-Muster aus `benachrichtigungen/page.tsx`, dargestellt mit `PortalRahmen` + `DataTable` + `StatusPill`. Seed: je Gesellschaft ein paar Aufgaben an bestehenden `auftrag`- und `lead`-Zeilen.

### /portal/[mandant]/aufgaben/[id]
- zustand: platzhalter
- dienst_vorhanden: keiner — dieselbe Lage wie die Liste.
- tabellen_vorhanden: False
- recht: aufgabe.lesen (lesen) / aufgabe.schreiben (schreiben); Zuweisung zusaetzlich aufgabe.zuweisen
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/portal/[mandant]/crm/leads/[id]/page.tsx
- aufwand: gross
- fehlende_tabellen:
  - aufgabe
  - team
  - team_mitglied
  - enum aufgabe_status
  - enum prioritaet
  - enum bezug_typ
- blocker: Identisch zur Liste: `aufgabe`, `team`, `team_mitglied` und drei Enums fehlen. Zusaetzlich zu klaeren beim Bau: `bezug_typ`/`bezug_id` ist polymorph (§7.2) — die Aufloesung eines Bezugs auf seinen Titel braucht je Typ eine Abfrage, und ein Typ ohne Aufloeser darf keine tote Zeile ergeben.

**Plan**

Kopfzeile mit Titel, Status-Pille, Prioritaet und Faelligkeit (UTC gespeichert, Europe/Berlin angezeigt), darunter Beschreibung, Zustaendige(r)/Team, Herkunft (`quelle`, `quelle_job`, `job_lauf_id` — eine vom Wachhund erzeugte Aufgabe sagt, welcher Lauf sie schrieb) und der aufgeloeste Bezug als Link auf Auftrag, Objekt oder Lead. Aktionen als POST-Formulare an Server Actions bzw. `/api`: Status setzen, zuweisen (nur mit `aufgabe.zuweisen`), erledigen (stempelt `erledigt_am`/`erledigt_von` serverseitig), abbrechen mit Pflichtgrund. Erledigt und abgebrochen sind Zustaende, keine Loeschung — die Zeile bleibt. Eine unbekannte oder fremde id gibt 404, nie 403 (AUT-06).

### /portal/[mandant]/nachrichten
- zustand: platzhalter
- dienst_vorhanden: keiner. Kein einziger Dienst und keine Seite liest oder schreibt `nachricht` / `nachricht_empfaenger` — die Tabellen liegen seit `drizzle/0011_benachrichtigung.sql` unberuehrt in der Datenbank. Achtung Verwechslungsgefahr: `src/app/portal/mein/nachrichten/page.tsx` heisst so, rendert aber `benachrichtigung` ueber `ladePosteingang` (`src/server/benachrichtigung/posteingang.ts`) — das ist der Meldungs-Posteingang, nicht der Nachrichtenfaden.
- tabellen_vorhanden: False
- recht: nachricht.lesen (lesen) / nachricht.versenden (schreiben); Gruppenlesung gruppe.nachricht.lesen
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/portal/[mandant]/benachrichtigungen/page.tsx
- aufwand: gross
- fehlende_tabellen:
  - nachricht_anhang
  - nachricht.thread_id
  - nachricht.antwortet_auf_id
  - nachricht.richtung
  - nachricht.kanal
  - nachricht.bezug_typ/bezug_id
  - nachricht.rechtsgrundlage (+ rechtsgrundlage_kontakt_id)
  - nachricht.freigabe_id
  - nachricht.zustell_status/zustell_fehler
  - nachricht_empfaenger.empfaenger_typ/empfaenger_id/art/zugestellt_am
- blocker: Die Karte nennt die Route „the staff-side thread inbox" — die gelieferte Tabelle kennt keine Faeden. `nachricht` traegt heute nur id, mandant_id, absender_id, betreff, text, gesendet_am, erstellt_am; es fehlen `thread_id` (mit `trg_thread_id` BEFORE INSERT), `antwortet_auf_id`, `richtung` (intern/eingehend/ausgehend), `kanal`, `bezug_typ/bezug_id`, `rechtsgrundlage`, `freigabe_id` und `zustell_status` (02-datenmodell/06-RADAR-KI-INHALT.md §7.9). `nachricht_empfaenger` ist auf `person_id` verdrahtet statt polymorph (`empfaenger_typ`/`empfaenger_id`), kann also Kunden-Ansprechpartner gar nicht adressieren — womit der Kundenfaden aus `/portal/kunde/nachrichten` hier nicht ankommen kann. `nachricht_anhang` fehlt ganz. Ausserdem fehlen die beiden CHECKs, die §7 UWG und Invariante 7 zu Datenbankbedingungen machen (ausgehend ohne Rechtsgrundlage nicht speicherbar; Agent ausgehend nur mit `freigabe_id`). Offene Fragen, die den Versand betreffen, nicht das Lesen: O-34 (Ausgangsmatrix/UWG-Wortlaut) und O-74 (ob ein Kunde ueberhaupt schreiben darf — die Kundenseite ist bis dahin nur lesend). Lebender Nebenschaden: `src/server/registry/tableiste.ts:127` bietet den Reiter „Nachrichten" im Mandantenportal bereits an — er fuehrt heute auf „wird noch gebaut".

**Plan**

Migration, die `nachricht`/`nachricht_empfaenger` auf die §7.9-Form bringt (Spalten additiv, `thread_id` per BEFORE-INSERT-Trigger auf die eigene id, Empfaenger polymorph mit Ruecksicherung der vorhandenen `person_id`-Zeilen), `nachricht_anhang` mit zusammengesetztem FK auf `dokument` anlegen, `p_beteiligt` je Empfaengertyp als restriktive Policy, und die beiden CHECKs setzen. Dienst `src/server/services/kern/nachricht.ts`: `listeFaeden(kontext, filter)` (ein Fadenkopf je `thread_id`, letzte Nachricht, Zahl ungelesener, Bezug), `ladeFaden(kontext, threadId)`, `antworte(...)`. Die Liste zeigt Betreff, Gegenueber, Richtung, letzte Aktivitaet in Europe/Berlin und eine Ungelesen-Pille; Filter: ungelesen, Richtung, Bezug. Aeusseres Senden laeuft zwingend ueber `server/agent/policy.ts` und `freigabe` (Invariante 7); bis O-34 beantwortet ist, bleibt `richtung = 'ausgehend'` mit `zweck = 'werbung'` gesperrt, interne Faeden funktionieren. Ein `// TODO(client, O-34)` an der Versandstelle und eine Zeile unter „Open" in docs/DECISIONS.md.

### /portal/[mandant]/nachrichten/[id]
- zustand: platzhalter
- dienst_vorhanden: keiner — dieselbe Lage wie die Liste.
- tabellen_vorhanden: False
- recht: nachricht.lesen (lesen) / nachricht.versenden (antworten)
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/portal/[mandant]/crm/leads/[id]/page.tsx
- aufwand: gross
- fehlende_tabellen:
  - nachricht_anhang
  - nachricht.thread_id
  - nachricht.antwortet_auf_id
  - nachricht.richtung
  - nachricht.kanal
  - nachricht.freigabe_id
  - nachricht.zustell_status
  - nachricht_empfaenger.empfaenger_typ/empfaenger_id/art/zugestellt_am
- blocker: Ohne `thread_id` gibt es keinen Faden, den `[id]` oeffnen koennte — die Detailseite ist von derselben Migration abhaengig wie die Liste. Antworten nach aussen haengt zusaetzlich an O-34 (UWG-Ausgangsmatrix) und, fuer den Kundenfaden, an O-74. `/[id]` ist die `thread_id`, nicht die `nachricht.id`; das muss die Route festlegen, sonst zeigen zwei Adressen denselben Faden.

**Plan**

Der Faden in Zeitfolge: je Nachricht Absender (Benutzer, Agent oder extern), Richtung, Kanal, Zeitpunkt in Europe/Berlin, Text und Anhaenge aus `nachricht_anhang` ueber signierte URLs. Bei ausgehenden Nachrichten stehen die mitgeschriebene `rechtsgrundlage` und — wo ein Agent schrieb — die `freigabe_id` als Beleg sichtbar an der Zeile, denn genau das ist der UWG-Nachweis. Antwortfeld als POST; Senden geht durch den Dienst und die Freigabekette, nie direkt. Oeffnen stempelt `gelesen_am` auf der eigenen Empfaengerzeile (POST, kein GET — ein Vorauslader wuerde den Posteingang sonst von allein leeren, D-504). Keine Loeschung, nur Faden schliessen.

### /.well-known/security.txt
- zustand: fehlt
- dienst_vorhanden: keiner fuer security.txt selbst. Die Bauart gibt es schon zweimal: `src/app/robots.ts` und `src/app/llms.txt/route.ts` mit `src/server/services/inhalt/llms.ts` und `src/server/services/inhalt/nap.ts` als Datenquelle.
- tabellen_vorhanden: True
- recht: — (offene Maschinenoberflaeche). Achtung: `routen.generiert.ts:55` fuehrt die Route als `{"art":"sitzung"}`
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/llms.txt/route.ts
- aufwand: klein
- blocker: O-35 — welches Postfach empfaengt Sicherheitsmeldungen und wer liest es? Die Seitenkarte §2.5 ist hier nicht weich, sondern verbietet die Veroeffentlichung: „`/.well-known/security.txt` ships only with a monitored mailbox behind it; a contact address nobody reads is worse than no file at all." Eine erfundene Adresse waere genau die vorgetaeuschte Integration, die CLAUDE.md ausschliesst. Zweiter Befund, unabhaengig davon: die Bewachung `sitzung` im erzeugten Register ist ein Extraktionsfehler — `scripts/seitenkarte/extrahiere.ts:158` trifft auf das Wort „route handler" in der Implementierungsspalte und stuft die Route als sitzungspflichtig ein. Eine `.well-known`-Datei hinter einer Anmeldung erfuellt ihren Zweck nicht; die Zeile gehoert auf `infrastruktur` (wie sitemap/robots/llms) und dazu eine Korrektur im Extraktor, nicht von Hand im erzeugten File.

**Plan**

`src/app/.well-known/security.txt/route.ts` als Handler mit `text/plain`, gespeist von `src/server/services/inhalt/sicherheit-txt.ts`. Der Dienst liest die Kontaktadresse aus einer klar benannten Konfiguration (`registry`/ENV) und gibt `null` zurueck, solange keine gesetzt ist; der Handler antwortet dann mit 404 — die Datei erscheint erst, wenn ein Postfach benannt ist. Ist eine gesetzt, schreibt er RFC 9116: `Contact`, `Expires` (Pflichtfeld, Serveruhr + 12 Monate), `Preferred-Languages: de, en`, `Canonical` aus derselben Hostquelle wie sitemap und robots (O-08). `robots.txt` bleibt unveraendert — `.well-known` ist dort nicht gesperrt. Dazu ein `// TODO(client, O-35)` am Dienst und die Korrektur des Extraktors samt neu erzeugtem `routen.generiert.ts`.

### /leistungen/[slug]
- zustand: fehlt
- dienst_vorhanden: `ladeSeite` und `pruefeSeite` in `src/server/services/inhalt/seite.ts`, `seitenDaten`/`ansprueche` in `src/server/inhalt/seiten-daten.ts`, `oeffentlichLesen` in `src/server/inhalt/lesen.ts`, die JSON-LD-Bausteine `localBusinessId`, `services`, `leistungenAus` in `src/server/services/inhalt/jsonld.ts`, und die fertige Huelle `src/app/(public)/OeffentlicheSeite.tsx`. Alles adressiert ueber `seite.pfad` — genau so, wie die Karte §1.6 es verlangt.
- tabellen_vorhanden: True
- recht: —
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/(public)/[seite]/page.tsx
- aufwand: mittel
- blocker: Keine fehlende Tabelle: `seite` traegt `pfad` mit `CHECK (pfad ~ '^/[a-z0-9/-]*$')`, also sind mehrsegmentige Pfade erlaubt, und `abschnitt` kennt die Art `leistungen`. Es fehlen die ZEILEN: die Datenbank enthaelt genau dreizehn `seite`-Pfade je Sprache, alle einsegmentig, keiner unter `/leistungen/`. Zwei Punkte sind zu entscheiden und keiner davon darf geraten werden: (a) WELCHE Leistungen eine eigene Seite bekommen und wie sie heissen — das ist Redaktion, kein Code; (b) wem die Seite gehoert. Die Karte §2.2 sagt, die Gruppenadresse traegt nur, was `operations` gehoert, alles andere ist unter `/unternehmen/<bereich>/leistungen` kanonisch; die dreizehn vorhandenen Zeilen haben aber alle `mandant_id = NULL` (Gruppenseiten). Fuer `Service.provider` braucht die JSON-LD-Ausgabe eine Gesellschaft — ohne geklaerte Zuordnung gibt es kein `@id`. Zusaetzlich beruehrt es `tests/invariants/reservierte-slugs.test.ts`, das die Ebene `src/app/(public)/leistungen/` begeht und heute leer findet.

**Plan**

Ordner `src/app/(public)/leistungen/[slug]/page.tsx` (und der englische Zwilling unter `/en/leistungen/[slug]`, D-82), duenn wie `[seite]/page.tsx`: Pfad zusammensetzen, `istAusgeschlossen` pruefen, `OeffentlicheSeite pfad={`/leistungen/${slug}`}` rendern, unbekannt → `notFound()` (nie leere Seite, die wird indexiert). `OEFFENTLICHE_ROUTEN` in `src/server/services/inhalt/routen.ts` bleibt die Liste der festen Seiten; die Detailseiten kommen zusaetzlich aus `seite` und muessen in `src/app/sitemap.ts` aufgenommen werden. JSON-LD: `Service` mit `provider` → `localBusinessId(basis, slug)` der besitzenden Gesellschaft, im Servercomponent inline unter der Nonce, nie per Fremdskript. Bis die Redaktionsfrage beantwortet ist, legt der Seed pro Gesellschaft eine klar als Demonstrationsbestand gekennzeichnete Leistungsseite an, mit `// TODO(client, O-NN)` und einer Zeile unter „Open" in docs/DECISIONS.md — welche Leistungen eine eigene Seite tragen und welche Gesellschaft sie verantwortet.

### /news/[slug]
- zustand: fehlt
- dienst_vorhanden: `oeffentlicherBeitragNachSlug(kontext, mandantId, slug)` (src/server/services/social/dienst.ts:832), `oeffentlicheNeuigkeiten` (:817), `neuigkeitenDerGruppe` (:858) und die Konstante `NEUIGKEITS_ARTEN` (:807); dazu die Zugriffshuelle `oeffentlichLesen` und die fertige Darstellung `BeitragDetail` (verwendet in `src/app/(public)/unternehmen/[bereich]/_profil/seiten.tsx:227 BeitragDetailSeite`). Es fehlt nur ein Aufloeser, der statt eines `[bereich]` fest `operations` nimmt.
- tabellen_vorhanden: True
- recht: —
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/(public)/unternehmen/[bereich]/news/[slug]/page.tsx
- aufwand: klein
- blocker: Keine Tabelle fehlt: `beitrag` traegt `slug` mit `beitrag_slug_uk (mandant_id, slug)` und `trg_beitrag_slug`, und der Seed hat fuer `operations` einen veroeffentlichten Beitrag (`zeiterfassung-nach-17-milog`). Offen ist die KANONISCHE Adresse: Seitenkarte §2.2 sagt einerseits „`/news/[slug]` exists only for items whose owning mandant is `operations`", legt andererseits als Regel fest, dass jede Meldung genau EINE kanonische Adresse unter `/unternehmen/<bereich>/news/<slug>` hat — und diese Seite ist fuer `operations` bereits gebaut. Wird `/news/<slug>` ohne `rel=canonical` ausgeliefert, entsteht genau die Doppelung, wegen der die kurzen Adressen abgeschafft wurden. Zweiter, kleiner Punkt: `BeitragDetail` wird heute in `ProfilRahmen` (Profilcover + Reiterleiste) gerendert; auf Gruppenebene gibt es diesen Rahmen nicht, die Seite braucht die oeffentliche Huelle.

**Plan**

`src/app/(public)/news/[slug]/page.tsx` plus englischer Zwilling: Gesellschaft `operations` ueber `ladeBereich`/`seiten-daten` aufloesen, `oeffentlicherBeitragNachSlug(kontext, operationsId, slug)` rufen, `null` → `notFound()` (ein Entwurf und ein nicht vorhandener Beitrag sehen von aussen gleich aus, und das ist richtig so), sonst `BeitragDetail` in der oeffentlichen Huelle statt in `ProfilRahmen`. `generateMetadata` setzt `alternates.canonical` auf `/unternehmen/operations/news/<slug>` — dieselbe Regel, die `GruppenNeuigkeiten` auf der Liste `/news` schon anwendet. `NewsArticle`-JSON-LD nur an der kanonischen Adresse. `src/app/sitemap.ts` fuehrt die kanonische Adresse, nicht diese. Die Entscheidung „kanonisch bleibt die Gesellschaftsadresse" gehoert als Zeile nach docs/DECISIONS.md.

### /projekte/[slug]
- zustand: fehlt
- dienst_vorhanden: `ReferenzAusTabelle` in `src/server/services/inhalt/referenz.ts` mit `nachSlug(mandantId, slug)` (:105), `fuerMandant` (:62) und `fuerGruppe` (von `/projekte` schon benutzt); Darstellung `ProjektDetail`, eingebunden ueber `ProjektDetailSeite`/`ProjektDetailInhalt` in `src/app/(public)/unternehmen/[bereich]/_profil/seiten.tsx:133`. Die Gruppenliste `/projekte` liest ueber `OeffentlicheSeite` bereits echte `referenz`-Zeilen.
- tabellen_vorhanden: True
- recht: —
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/(public)/unternehmen/[bereich]/projekte/[slug]/page.tsx
- aufwand: klein
- blocker: Keine Tabelle fehlt: `referenz` traegt `slug` (`referenz_slug_uk`, `trg_referenz_slug`) und die Policy `t_referenz_oeffentlich` laesst nur `freigegeben_vom_kunden AND status='veroeffentlicht' AND geloescht_am IS NULL` durch — die PRO-05-Freigabe haengt also an der Zeile und nicht an der Seite. Der Seed hat fuer `operations` genau eine Referenz (`digitale-betriebsplattform`). Derselbe Kanonik-Punkt wie bei `/news/[slug]`: `/unternehmen/operations/projekte/<slug>` ist gebaut, eine zweite indexierbare Adresse fuer denselben Text waere die Doppelung, die §2.2 ausschliesst.

**Plan**

`src/app/(public)/projekte/[slug]/page.tsx` plus englischer Zwilling: `operations` aufloesen, `new ReferenzAusTabelle(...).nachSlug(operationsId, slug)`, `null` → `notFound()` — eine Referenz ohne Kundenfreigabe und eine nicht vorhandene muessen von aussen gleich aussehen, sonst verraet der Unterschied, dass es sie gibt und der Kunde nur nicht zugestimmt hat. Gerendert wird `ProjektDetail` (Titel, Ort/Jahr, Beschreibung, freigegebene Fotos) in der oeffentlichen Huelle; niemals Auftragswert, `kunde_id` oder Anschrift — die traegt `referenz` bewusst nicht. `generateMetadata` setzt `alternates.canonical` auf `/unternehmen/operations/projekte/<slug>`; `BreadcrumbList`- und `ImageObject`-JSON-LD nur dort. Sitemap fuehrt die kanonische Adresse.

### /werbewiderspruch/[token]
- zustand: fehlt
- dienst_vorhanden: keiner. In `src/` kommt `werbewiderspruch` nur als Lesefeld vor: `src/app/portal/[mandant]/crm/kunden/page.tsx:72` und `.../kunden/[id]/page.tsx:99` zeigen eine Pille, wenn `widerspruch_am` oder `werbewiderspruch_am` gesetzt ist. Es gibt keinen Dienst, der einen Widerspruch entgegennimmt, und keinen, der einen Token ausstellt. Naechstverwandt gebaut ist der andere oeffentliche Pflichtweg: `src/server/services/datenschutz/anfrage.ts` mit `src/app/(public)/datenschutz/anfrage/`.
- tabellen_vorhanden: False
- recht: — (oeffentlich, der Token ist die Wache; Register fuehrt {"art":"offen"})
- recht_im_katalog: True
- vorbildseite: /home/user/cse-platform/src/app/(public)/datenschutz/anfrage/page.tsx
- aufwand: gross
- fehlende_tabellen:
  - werbewiderspruch (Protokollzeile: Kontakt, Kanal, Zeitpunkt, Quellnachricht)
  - Tokenspeicher je ausgehender Werbenachricht (gehashter, widerrufbarer Token nach K-09-Form)
- blocker: Drei Dinge stehen im Weg. (1) Es fehlt beides, was `02-datenmodell/02-CRM-OPERATIONS.md` §5 verlangt: ein gehashter, widerrufbarer Widerspruchstoken je ausgehender Nachricht und eine `werbewiderspruch`-Protokollzeile. Vorhanden sind nur die Zielspalten `ansprechpartner.werbewiderspruch_am` und `kunde.werbewiderspruch_am`; `lead_aktivitaet` (traegt `zweck kommunikationszweck` und `rechtsgrundlage_snapshot`) und `versand` fuehren KEINE Tokenspalte, es gibt also heute nichts, woraus der Link entstehen koennte. Als Vorbild fuer die Tokenform taugt `checkin_token` (`token_hash`, `token_zweck`). (2) O-34 — die anwaltliche Pruefung der Ausgangsmatrix und der exakte Wortlaut des Hinweises nach §7 Abs. 3 Nr. 4 UWG. Der auf dieser Seite gedruckte Satz ist Rechtstext; ihn zu erfinden verstiesse gegen „Never invent a business rule". (3) Der tokenlose Zwilling `/werbewiderspruch` bestaetigt laut Karte per E-Mail — dafuer ist kein Versender verbunden (O-36). Fachlich noch wichtig und leicht falsch zu bauen: die Route setzt NUR `werbewiderspruch_am` und fasst `rechtsgrundlage` nicht an. Ein frueherer Entwurf der Karte wollte `rechtsgrundlage='keine'` — das haette Rechnungen, Leistungsnachweise und Mahnungen desselben Kunden gestoppt. `rechtsgrundlage='keine'` erzwingt allein der Ausloeser `kern.erzwinge_widerspruch()` aus `widerspruch_am`, dem anderen, selteneren Art.-21-Widerspruch.

**Plan**

Migration: Tokentabelle nach `checkin_token`-Vorbild (nur `token_hash`, Zweck `werbewiderspruch`, Bezug auf die ausgehende Nachricht, `widerrufen_am`) und `werbewiderspruch` als Protokoll (Mandant, Ansprechpartner bzw. Kunde, Kanal, Zeitpunkt der Serveruhr, Quellnachricht) — beides ohne harten Loeschpfad, denn es ist der §7-UWG-Nachweis, und beide Zielspalten sind schreib-einmalig und nicht loeschbar. Dienst `src/server/services/crm/werbewiderspruch.ts`: `loeseTokenAuf(hash)`, `erfasseWiderspruch(...)` — setzt `ansprechpartner.werbewiderspruch_am`, bei Erfassung auf Firmenebene zusaetzlich `kunde.werbewiderspruch_am`, schreibt die Protokollzeile, ruehrt `rechtsgrundlage` nicht an. Idempotent nach Entwurf: der zweite Klick sagt „ist bereits erfasst", nie ein Fehler. Die Seite selbst ist bewusst arm — ein Satz, welcher Kontakt betroffen ist (ohne weitere Personendaten preiszugeben), ein Bestaetigungsknopf als POST (kein GET, sonst loest ein Mailscanner den Widerspruch aus), danach eine Bestaetigung mit dem Zeitpunkt in Europe/Berlin und dem Hinweis, dass vertragliche Post weiter zugestellt wird. Ein unbekannter Token gibt dieselbe neutrale Antwort wie ein bereits benutzter — sonst ist die Seite ein Existenzorakel fuer E-Mail-Adressen. Der UWG-Hinweistext bleibt bis O-34 ein klar gekennzeichneter Platzhalter hinter einer Schnittstelle, mit `// TODO(client, O-34)` und einer Zeile unter „Open" in docs/DECISIONS.md; `robots.txt` sperrt `/werbewiderspruch/` bereits.

## KRITIK (9 geprueft, 7 Korrekturen)

- **pfad**: /werbewiderspruch/[token] | **behauptet**: "`robots.txt` sperrt `/werbewiderspruch/` bereits" — der Plan setzt die Sperre als vorhanden voraus und fuehrt sie nicht als Arbeit. | **wirklich**: Sie ist NICHT gesperrt. `robots.ts` bildet ausschliesslich die Konstante `AUSGESCHLOSSEN` ab, und die enthaelt fuenf Praefixe: `/dev`, `/api`, `/portal`, `/auth`, `/check-in`. `/werbewiderspruch` fehlt. Die Seitenkarte verlangt es ausdruecklich ('robots.txt disallows /api/, /portal/, /auth/, /check-in/ and /werbewiderspruch/'). Das ist ein LEBENDER Defekt, unabhaengig von dieser Route: die Sperre fehlt schon heute, und `AUSGESCHLOSSEN` ist zugleich der Sitemap-Filter — die Tokenadressen entstehen also in einer Flaeche, die als gesperrt beschrieben, aber nicht gesperrt ist. Zusatzbefund zugunsten des Plans: dass beide Zielspalten schreib-einmalig sind, muss die Migration NICHT herstellen — `kern.erzwinge_widerspruch()` weist das Zuruecknehmen von `werbewiderspruch_am` und `widerspruch_am` bereits mit `restrict_violation` ab. | **beleg**: src/server/services/inhalt/sitemap.ts:28 (`AUSGESCHLOSSEN = ['/dev','/api','/portal','/auth','/check-in']`) · src/app/robots.ts:20 (`disallow: AUSGESCHLOSSEN.map(p => `${p}/`)`) · docs/architecture/04-SEITENKARTE.md:590-591 · psql: `select pg_get_functiondef(oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='kern' and proname='erzwinge_widerspruch'` zeigt die beiden Ruecknahme-Sperren | **aufwand_korrigiert**: gross (unveraendert) + ein eigener kleiner Posten: `/werbewiderspruch` in `AUSGESCHLOSSEN` aufnehmen, mit Test. Der Plan darf die Sperre nicht als erledigt annehmen.

- **pfad**: /leistungen/[slug] | **behauptet**: "Zusaetzlich beruehrt es `tests/invariants/reservierte-slugs.test.ts`, das die Ebene `src/app/(public)/leistungen/` begeht und heute leer findet." | **wirklich**: Diese Datei existiert im Repo nicht — es gibt kein Verzeichnis `tests/invariants/` ueberhaupt. Der einzige verwandte Test ist `tests/kern/routen-reserviert.test.ts`, und der begeht keinen Dateibaum: er prueft ueber `familie()`/`findeRoute()`, dass `gruppe|mein|kunde|konto` nicht auf `/portal/[mandant]` treffen. Der Ebenen-Waechter ist laut Seitenkarte eine noch OFFENE Verpflichtung ('until it is met `tests/invariants/reservierte-slugs.test.ts` cannot be written for the /karriere/ level at all'). Es gibt also nichts, was ein statisches Geschwister unter `/leistungen/` fangen wuerde. Nebenbei falsch: 'die Datenbank enthaelt genau dreizehn `seite`-Pfade je Sprache, alle einsegmentig' — vier davon sind zweisegmentig (`/unternehmen/{bau,operations,reinigung,security}`). | **beleg**: `ls tests/` → compliance, design, e2e, fixtures, isolation, kern, stubs (kein invariants) · `find . -name '*reservier*'` → nur ./tests/kern/routen-reserviert.test.ts · docs/architecture/04-SEITENKARTE.md:245-252 und :272-274 · psql: `select pfad, sprache from seite order by 1` → 26 Zeilen, darunter /unternehmen/bau, /unternehmen/operations, /unternehmen/reinigung, /unternehmen/security | **aufwand_korrigiert**: mittel (Seite selbst bleibt duenn) + klein/mittel, falls der Ebenen-Test wirklich existieren soll — er ist zu SCHREIBEN, nicht anzupassen.

- **pfad**: /leistungen/[slug] | **behauptet**: "die Detailseiten kommen zusaetzlich aus `seite` und muessen in `src/app/sitemap.ts` aufgenommen werden" und "JSON-LD: `Service` mit `provider` → `localBusinessId(basis, slug)` … im Servercomponent inline unter der Nonce". | **wirklich**: Beides sitzt an der falschen Stelle. (a) Die Sitemap braucht KEINE Ergaenzung: `sitemapEintraege` liest `select pfad, sprache … from seite where status='veroeffentlicht' and geloescht_am is null` — jede neue `seite`-Zeile unter `/leistungen/<slug>` erscheint automatisch, inklusive `alternates`. (b) Der JSON-LD-Aufbau darf nicht in die Seite: `seitenDaten()` baut die Bloecke zentral und sagt im Kommentar, warum ('Der JSON-LD-Aufbau steht hier und nicht in der Seitenkomponente, weil sonst jede neue Seite ihn neu zusammensetzt und die vierte ihn vergisst'). Fuer Pfade ohne Bereichstreffer (`eigener === undefined`) entsteht heute NUR ein `breadcrumb` — ein `Service`-Block mit `provider` muss also in `src/server/inhalt/seiten-daten.ts` entstehen, und dort ist auch der Ort, an dem die ungeklaerte Gesellschafts-Zuordnung wirklich weh tut. | **beleg**: src/app/sitemap.ts:22-44 (nur `sitemapEintraege` + /barrierefreiheit) · src/server/services/inhalt/sitemap.ts:42-56 (Abfrage ueber alle veroeffentlichten `seite`-Zeilen) · src/server/inhalt/seiten-daten.ts:47-52 (Begruendung) und :80-96 (`eigener === undefined` → nur breadcrumb; `services()` nur im else-Zweig) | **aufwand_korrigiert**: mittel (unveraendert), aber die Arbeit liegt in `seiten-daten.ts`, nicht in der Seite — und der Sitemap-Posten faellt weg.

- **pfad**: /news/[slug] | **behauptet**: "`src/app/sitemap.ts` fuehrt die kanonische Adresse, nicht diese." | **wirklich**: Die Sitemap fuehrt KEINE von beiden. `sitemap.ts` liest ausschliesslich `seite`-Zeilen plus `/barrierefreiheit` — `beitrag`, `referenz` und `stelle` kommen nirgends vor. `/unternehmen/operations/news/zeiterfassung-nach-17-milog` steht also heute in keiner Sitemap, obwohl die Seitenkarte §2.5 sie ausdruecklich verlangt ('every published seite, referenz, social_post, news and open stelle row'). Der Plan stuetzt seine Kanonik-Entscheidung damit auf eine Fuehrung, die nicht existiert — und uebersieht eine lebende PUB-10-Luecke. | **beleg**: src/app/sitemap.ts (vollstaendig; keine Erwaehnung von beitrag/referenz/stelle) · src/server/services/inhalt/sitemap.ts:42-48 · docs/architecture/04-SEITENKARTE.md:588-589 · psql: `select m.slug, b.slug, b.status from beitrag b join mandant m on m.id=b.mandant_id where m.slug='operations'` → zeiterfassung-nach-17-milog, veroeffentlicht | **aufwand_korrigiert**: klein fuer die Seite — plus ein eigener mittlerer Posten: die kanonischen Detailadressen (news, projekte, karriere) ueberhaupt in die Sitemap bringen. Nicht im Preis von 'klein' enthalten.

- **pfad**: /projekte/[slug] | **behauptet**: "Sitemap fuehrt die kanonische Adresse." | **wirklich**: Gleiche Lage wie bei `/news/[slug]`: `src/app/sitemap.ts` kennt nur `seite`-Zeilen. `/unternehmen/operations/projekte/digitale-betriebsplattform` ist in keiner Sitemap. Alles andere an dieser Route haelt der Pruefung stand: `referenz_slug_uk`, `trg_referenz_slug` und die Policy `t_referenz_oeffentlich` (`freigegeben_vom_kunden AND status='veroeffentlicht' AND geloescht_am IS NULL`) existieren genau wie beschrieben, und `ReferenzAusTabelle.nachSlug` liegt auf Zeile 105. | **beleg**: src/app/sitemap.ts:22-44 · psql: `select conname from pg_constraint where conrelid='referenz'::regclass and conname like '%slug%'` → referenz_slug_form, referenz_slug_uk · `select polname, pg_get_expr(polqual,polrelid) from pg_policy where polrelid='referenz'::regclass` → t_referenz_oeffentlich wie behauptet · src/server/services/inhalt/referenz.ts:105 | **aufwand_korrigiert**: klein fuer die Seite; der Sitemap-Posten ist zusaetzlich und gemeinsam mit /news/[slug] zu erledigen.

- **pfad**: /portal/[mandant]/nachrichten | **behauptet**: "Lebender Nebenschaden: `src/server/registry/tableiste.ts:127` bietet den Reiter „Nachrichten" im Mandantenportal bereits an — er fuehrt heute auf „wird noch gebaut"." | **wirklich**: Zeile 127 liegt im Block `{ schluessel: 'kunde', familie: 'kunde' }` (Zeilen 119-129) — der Reiter gehoert dem KUNDENPORTAL und fuehrt auf `/portal/kunde/nachrichten`. Die Leiste des Mandantenportals ist `{ schluessel: 'intern_leitung', familie: 'mandant' }` (Zeilen 96-106) und bietet Uebersicht, Dienstplan, Zeiten, Auftraege, Mehr — kein Nachrichten. Auch `src/server/registry/navigation.ts` enthaelt weder 'Nachrichten' noch 'Aufgaben'. Die interne Route ist heute also ueber KEIN Menue erreichbar, nur per Adresse. Der tote Reiter existiert wirklich — aber im Kundenportal (`src/app/portal/kunde/` hat nur `page.tsx` und `[...rest]`), und dort haengt Schreiben zusaetzlich an O-74. Die zweite Leiste mit 'Nachrichten' (Zeile 115, `familie: 'mein'`) fuehrt auf die GEBAUTE Seite `src/app/portal/mein/nachrichten/page.tsx`. | **beleg**: src/server/registry/tableiste.ts:119-129 (kunde-Block, Reiter auf Zeile 127) gegen :96-106 (intern_leitung) und :108-118 (mein) · `grep -rn 'Aufgaben|Nachrichten' src/server/registry/navigation.ts` → kein Treffer · `ls src/app/portal/kunde/` → [...rest], page.tsx | **aufwand_korrigiert**: gross (unveraendert). Aber die Dringlichkeitsbegruendung gehoert zu `/portal/kunde/nachrichten`, nicht hierher — und zur internen Route gehoert ein zusaetzlicher kleiner Posten: Menueeintrag in `navigation.ts`, sonst ist die fertige Seite unerreichbar.

- **pfad**: /portal/[mandant]/aufgaben | **behauptet**: "ein grep ueber `src/server/services/` findet nur `agent_aufgabe` (Agentenlaeufe, andere Tabelle, andere Bedeutung) und `lead_aktivitaet.faellig_am`". | **wirklich**: `grep -rl aufgabe src/server/services/` findet GAR NICHTS — das Wort kommt in diesem Baum nicht vor. `agent_aufgabe` liegt in `src/server/agent/` (orchestrator.ts, laufzeit.ts, budget.ts) und in `src/server/db/schema/rls.ts`, nicht unter `services/`. Die Kernaussage bleibt richtig und wird durch die Gegenprobe sogar haerter: `src/server/services/kern/` existiert nicht, es gibt keinen `aufgabe`-Dienst, `to_regclass('public.aufgabe')` ist leer, `team`/`team_mitglied` fehlen, und von den benoetigten Enums existiert nur `ausloeser` (`aufgabe_status`, `prioritaet`, `bezug_typ`, `zustell_status` fehlen alle). Auch richtig: keine O-Nummer blockiert diese Route, und DSH-01 nennt 'upcoming tasks'. Falsch ist nur der Beleg. Nebenbefund zur Bündelung: die Route steht in der Karte in §5.6 (Auftraege), nicht in §5.17 — dort steht nur `/nachrichten` und `/kalender`. | **beleg**: `grep -rl aufgabe src/server/services/` → leer · `grep -rln agent_aufgabe src/server/` → src/server/agent/{orchestrator,laufzeit,budget}.ts, src/server/db/schema/rls.ts · psql: `select to_regclass('public.aufgabe'), to_regclass('public.team'), to_regclass('public.team_mitglied')` → alle leer; `select typname from pg_type where typtype='e' and typname in ('aufgabe_status','prioritaet','bezug_typ')` → 0 Zeilen · docs/architecture/04-SEITENKARTE.md:1070 (§5.6) vs :1622-1628 (§5.17) · src/server/registry/routen.generiert.ts:111 (abschnitt: '5.6 Auftraege') | **aufwand_korrigiert**: gross (unveraendert) — die Einschaetzung stimmt, nur die Beweiszeile ist erfunden.
