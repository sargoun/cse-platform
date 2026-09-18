# Registereintraege: mitarbeiterportal-rest

**Warteschlange, kein Archiv.** Diese Eintraege sind **noch nicht** im Baum.
Eingetragen heisst geloescht.

## Gebaut

- /portal/mein/dokumente — Liste der der Belegschaft freigegebenen Unterlagen; Filter nach Kategorie und Gesellschaft als LINKS (ohne JavaScript bedienbar), jede Zeile mit Gesellschaft, Kategorie, Ablagedatum, Größe, Objekt; Leerzustand; Obergrenze wird genannt, wenn sie greift (src/app/portal/mein/dokumente/page.tsx)
- /portal/mein/dokumente/[id] — Blatt mit Angaben, Verweis auf das Objekt und dem Abruf über eine signierte Adresse; ohne verbundenen Speicher steht „nicht verbunden" statt eines toten Knopfes; Abruf als <a>, nicht <Link> (kein Vorabruf → keine erfundene Protokollzeile) (src/app/portal/mein/dokumente/[id]/page.tsx)
- /portal/mein/objekte — alle Objekte der eigenen Einteilungen, laufende zuerst, mit Anschrift, nächster/letzter Schicht und Gesellschaft (src/app/portal/mein/objekte/page.tsx)
- /portal/mein/objekte/[id] — Anschrift, Objektnummer, Gebäudetyp, Etagen, ZUTRITTSHINWEIS + Ansprechpartner vor Ort (nur solange eingeteilt), „Meine Schichten hier"; drei unterscheidbare Lagen in Worten: Hinweis vorhanden / nichts hinterlegt / nicht eingeteilt (src/app/portal/mein/objekte/[id]/page.tsx)
- GET /api/mein/dokumente/[id]/datei — PER→M1-Brücke: Zeile im Personen-Scope auflösen, Mandant DARAUS ableiten (K-02), withTenant mit portal='mitarbeiter', Abrufspur in dokument_zugriff VOR der signierten Adresse, 303-Weiterleitung; ohne Speicher 503, fremde Einbettung (Sec-Fetch-Site: cross-site) 403 (src/app/api/mein/dokumente/[id]/datei/route.ts)
- Dienst src/server/services/mitarbeiter/dokumente.ts — listeEigeneDokumente (Filter kategorie/mandantSlug als Parameter, nie als Zeichenkette im SQL), findeEigenesDokument, zaehleEigeneKategorien, groesseText, SIGNATUR_MINUTEN (aus SIGNATUR_SEKUNDEN abgeleitet), MEIN_DOKUMENT_FELDER
- Dienst src/server/services/mitarbeiter/objekte.ts — listeEigeneObjekte, findeEigenesObjekt, leseObjektZugang (über app.mein_objekt_zugang), zugangIstLeer, anschriftZeile, EIGENES_OBJEKT_FELDER, OBJEKT_ZUGANG_FELDER
- listeEigeneSchichtenAufObjekt in src/server/services/mitarbeiter/schichten.ts — DIESELBE Projektion wie Liste/Einzelansicht/„Heute", keine zweite Spaltenauswahl
- 27 neue Oberflächentexte + die neun Dokumentkategorien (DOKUMENT_KATEGORIE_TEXTE, dokumentKategorieText) in de/en/ar/tr in src/lib/i18n/texte.ts
- Verweise auf beide Seiten unter „Weiteres" auf /portal/mein — ohne sie wären sie von nirgends erreichbar (Arbeiterleiste trägt fünf Ziele)
- Seed: objekt.ansprechpartner_id wird gesetzt (Telefon aus dem Demo-Nummernbereich 030 23125 xx), 5 Betriebsanweisungen am Objekt + 3 Notfallnummern-Blätter ohne Objektbezug mit sichtbar_fuer_mitarbeiter = true (src/server/db/seed/operations.ts)

## Migrationen

- drizzle/0360_mein_objekt_zugang.sql — app.mein_objekt_zugang(uuid): vier Texte (zutritt_hinweis, Name/Telefon/Mobil des Ansprechpartners vor Ort) für ein Objekt, auf dem der Aufrufer selbst eingeteilt ist. KEINE neue Sichtbarkeitsregel: Prädikat ist wortgleich app.ist_eingesetzt_auf_objekt (0069), dieselbe Funktion wie in objekt.t_selbst_m1 (0300) und leistungsnachweis.p_portal_decke. Prüft app.portal() selbst (K-04), gibt außerhalb des Mitarbeiterportals null Zeilen, NULL-Argument ergibt keine Zeile. Gehört cse_definer (K-01); dazu `grant select on objekt to cse_definer` (fehlte seit 0304) und die benannte Lesepolicy d_objekt_ansprechpartner. Ausgeschiedene/anonymisierte Kontakte fallen heraus; bemerkung und E-Mail bleiben draußen.
- drizzle/0361_mein_dokument_abrufspur.sql — permissive INSERT-Policy dokument_zugriff.t_selbst_m1: portal='mitarbeiter', nicht readonly, mandant_id = aktiver_mandant, art='abruf', benutzer_id = aktueller_benutzer, und ein EXISTS auf ein freigegebenes, nicht gelöschtes Dokument (Prädikat wie dokument.t_person). Kein neuer Rechteschlüssel (K-19, Begründung wie 0300).

## src/server/db/schema/rls.ts — GEPRÜFT, NICHTS EINZUTRAGEN (18.09.2026)

Nachgemessen und deshalb gestrichen: 0360 legt eine Definer-Funktion samt Lesepfad an,
0361 eine INSERT-Policy auf der bestehenden Tabelle `dokument_zugriff`. Keine neue
Tabelle, also keine neue Zeile. Der Löschschutz von `dokument_zugriff` steht seit 0139
im erzeugten Block und ist nach `pnpm db:triggers` unverändert.

## src/server/registry/navigation.ts — GEPRÜFT, NICHTS NÖTIG (18.09.2026)

Nachgemessen und deshalb gestrichen. Nichts nötig. Das Mitarbeiterportal hat keine Seitenleiste, und die Tab-Leiste trägt nach SEITENKARTE §11.2 genau fünf Ziele. Beide Seiten sind über die Liste „Weiteres" auf /portal/mein erreichbar — diese Zeilen habe ich dort ergänzt (src/app/portal/mein/page.tsx), zusammen mit den vorhandenen sechs. tests/kern/mein-dokumente-objekte.test.ts hält fest, dass die Verweise dort stehen.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen" — ERLEDIGT (18.09.2026)

Eingetragen heisst gelöscht. Die 4 Zeilen dieser Domäne — **O-850** bis **O-853** —
stehen in `docs/DECISIONS.md` unter „Open — ask, do not guess", Unterabschnitt
„Raised while building · die Domänenwelle (Routenbau)", im Block
**Mitarbeiterportal**. Wortgleich übernommen, also auf Englisch — die Zeile des
Auftraggebers wird nicht übersetzt, und der Block trägt ohnehin beide Sprachen.
Nachgemessen vor dem Eintrag (`w_reg`): `dokument` trägt `kunde_id`, `objekt_id`,
`formular_eingang_id` und `sichtbar_fuer_mitarbeiter`, aber **kein** `person_id`
und **kein** `anstellung_id`; `p_ma_ceiling` und `t_person` stehen beide auf
`dokument`; `dokument_kategorie` führt genau neun Werte; `app.mein_objekt_zugang`
und `app.ist_eingesetzt_auf_objekt` gibt es. Hier ist nichts mehr offen.


## Befunde

- BLOCKIEREND (behoben, 0361): Das Mitarbeiterportal konnte die Abrufspur `dokument_zugriff` GAR NICHT schreiben — `t_dokument_zugriff_anlegen` (0139) verlangt `dokument.lesen`, und die Rolle `mitarbeiter` hält dieses Recht nicht. Ein Dateiabruf wäre damit für die Auskunft nach Art. 15 DSGVO unsichtbar gewesen (DOC-03, SEC-A6). Behoben mit einer schmalen INSERT-Policy nach dem Muster von 0300 — kein neuer Rechteschlüssel.
- BLOCKIEREND (behoben, 0360): `objekt.zutritt_hinweis` ist `cse_app` als SPALTE entzogen (0021) und nur über `app.objekt_notiz_lesen` lesbar, das `portal() = 'intern'` UND `objekt.lesen` verlangt; `ansprechpartner` trägt überhaupt keine Personen-Policy. Beide Angaben waren im Mitarbeiterportal unerreichbar — die eine hart (permission denied), die andere STILL (null Zeilen, kein Fehler). Behoben mit einer Definer-Funktion, deren Prädikat wortgleich das der Schichtseiten ist.
- LATENT (behoben, 0360): 0304 legt die Policy `d_nachweis_kopf on objekt to cse_definer` an, das zugehörige `grant select on objekt to cse_definer` fehlte. Heute fällt das nicht auf, weil die Definer aus dieser Zeit `postgres` gehören; die neue Funktion gehört nach K-01 `cse_definer` und wäre an „permission denied for table objekt" gescheitert.
- SEED (behoben): `objekt.ansprechpartner_id` wurde von keinem Seed gesetzt — der Ansprechpartner wäre in jeder Demodatenbank leer geblieben, und niemand hätte die Seite beim Ausprobieren prüfen können. Ebenso trug KEIN Seed-Dokument `sichtbar_fuer_mitarbeiter = true`: `/portal/mein/dokumente` wäre überall leer gewesen, und eine leere Liste beweist nicht, dass die Decke sitzt (K-18).
- KLEIN (vor der Auslieferung behoben): `BigInt('')` ist `0n` und wirft nicht — `groesseText('')` hätte „0 B" gelesen, also eine Aussage über die Datei, die niemand geprüft hat. Jetzt „—"; der Test hält es fest.
- VORABRUF: Next.js holt `<Link>`-Ziele im Voraus. Ein Dateiabruf, der beim RENDERN eine signierte Adresse zöge, hätte Protokollzeilen für Dateien erzeugt, die niemand geöffnet hat. Der Abruf ist deshalb ein schlichtes `<a>` auf eine Route — und die Route weist eine fremde Einbettung (`Sec-Fetch-Site: cross-site`) ab, ohne alte Telefone auszusperren (fehlt der Kopf, geht die Anfrage durch).
- OFFEN, ZENTRAL: tests/kern/mitarbeiter.test.ts ist in zwei Fällen rot, und beide hängen ausschließlich an den zwei Registerdateien, die ich nicht anfassen darf — `route-manifest.ts` (vier fehlende Routen, davon eine von mir) und `registry/dienste.ts` (vier fehlende Dienste, davon zwei von mir). Die Einträge stehen oben als Text.

## NICHT gebaut

- Personenbezogene Dokumentzuordnung (Arbeitsvertrag, Lohnabrechnung, Zeugnis): `dokument` trägt weder person_id noch anstellung_id — offen als O-850. Die Seite ist vollständig gebaut und sagt als SATZ auf dem Bildschirm, dass sie zeigt, was der Belegschaft freigegeben ist, und nicht, was EINEN Menschen betrifft.
- Kategorie-Schranke für die Belegschaftsfreigabe (Gegenstück zu O-736 beim Kunden) — offen als O-851; bis dahin steht die Kategorie groß auf dem Bildschirm, weil dort eine falsche Freigabe auffällt.
- Befristung der Objektliste nach der letzten Schicht — offen als O-852; heute bleibt ein Objekt dauerhaft in der Liste (der Zutritt aber NICHT).
- Umfang der Kontaktangaben (Festnetz/Mobil) — offen als O-853; heute beide, sofern hinterlegt, und nur während der Einteilung.
- Kein Leserecht auf die eigene Abrufspur: t_dokument_zugriff_lesen bleibt unverändert an dokument.lesen gebunden (Art.-15-Auskunft läuft über die Betroffenenauskunft, nicht über das Treppenhaus).

## Notizen

**Der Kern der Aufgabe — die Zugangshinweise — ist über GENAU EINE Regel gebaut.** `app.mein_objekt_zugang` (0360) fragt `app.ist_eingesetzt_auf_objekt` (0069) und sonst nichts. Das ist dieselbe Funktion, die `objekt.t_selbst_m1` (0300) und `leistungsnachweis.p_portal_decke` tragen; es gibt keine zweite Bedingung in der Anwendung, keinen „ist die nächste Schicht heute"-Vergleich in der Seite. Damit kann die Seite nie etwas anderes sagen als das Tor: der Code ist da, solange die Kraft eingeteilt IST, und mit der letzten Schicht weg — der Isolationstest misst genau diesen Wechsel an `now()`.

Die Seite unterscheidet drei Lagen in Worten statt in einem leeren Feld: Hinweis vorhanden · eingeteilt, aber nichts hinterlegt · nicht (mehr) eingeteilt. Die Datenbank trägt den Unterschied (eine Zeile mit NULL gegen gar keine Zeile), und der Test hält beides fest. Ein leeres Feld hätte „ist nichts hinterlegt" gelesen — und damit jemanden vor einer verschlossenen Tür stehen lassen.

**Migrationsnummern:** 0360 und 0361 verbraucht, 0362–0364 frei. Keine vorhandene `drizzle/*.sql` geändert. Geprüft gegen eine eigene Datenbank (`w_mein2`, beide Migrationen sauber angewendet) und gegen eine eigene Isolationsdatenbank (`iso_mein2`, Seed lief durch, 8 der Belegschaft freigegebene Unterlagen).

**O-Nummern:** 850–853 vergeben, 854–859 frei. Jede steht als `// TODO(client, O-NN)` in DERSELBEN Zeile im Code und als Registerzeile oben; O-850 steht zusätzlich als Satz in allen vier Sprachen auf dem Bildschirm.

**Gelaufen:** `npx vitest run tests/kern/mein-dokumente-objekte.test.ts` (32 grün), `npx vitest run tests/kern/mitarbeiter-sprachen.test.ts` (23 grün), `npx vitest run tests/kern/i18n.test.ts` (24 grün), Isolation mit eigener DB (36 grün). Gefilterter Typecheck über `src/app/portal/mein/*`, `src/app/api/mein/dokumente`, `src/server/services/mitarbeiter`, `src/lib/i18n`, `src/server/db/seed` und die beiden neuen Testdateien: leer. `npx eslint` über alle geänderten und neuen Dateien: leer. `npx tsx scripts/guards/run-all.ts`: von meinen Dateien nur die vier `todo-client-nicht-im-register`-Meldungen, die mit den Registerzeilen oben verschwinden. Keine vollen Suiten, kein `pnpm typecheck`, kein `pnpm build`, kein Commit.

**Nicht angefasst:** `src/server/registry/*`, `src/server/auth/route-manifest.ts`, `src/server/db/schema/rls.ts`, `docs/*`, `package.json`, `scripts/guards/*`. Geändert wurden außerhalb meines Bereichs nur: `src/lib/i18n/texte.ts` (27 neue Schlüssel + Kategorientafel, additiv), `src/server/services/mitarbeiter/felder.ts` (drei Listen eingetragen), `src/server/services/mitarbeiter/schichten.ts` (eine neue Lesefunktion, bestehende unverändert), `src/app/portal/mein/page.tsx` (zwei Zeilen unter „Weiteres"), `src/server/db/seed/operations.ts` + `index.ts` (Ansprechpartner und freigegebene Unterlagen), `tests/kern/mitarbeiter.test.ts` (die Liste MEINE_SCHREIBROUTEN beschreibt jetzt den Baum — meine Abrufroute und die Nachrichtenroute der parallelen Arbeit).
