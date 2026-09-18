# Registereintraege: intern-rest

**Warteschlange, kein Archiv.** Diese Eintraege sind **noch nicht** im Baum.
Eingetragen heisst geloescht.

## Gebaut

- /portal/[mandant]/dokumente/upload — Seite: src/app/portal/[mandant]/dokumente/upload/page.tsx. Formular (Datei, Titel, Kategorie, Beschreibung, Schlagworte, Kunde, Objekt, Sichtbarkeit für Beschäftigte), Auswahllisten unter RLS, „nicht verbunden"-Zustand ohne simulierten Erfolg, plus Tabelle „was die Kategorie bedeutet" (Frist, Löschsperre, Rechtsgrundlage, Platzhalter O-25). Recht laut Manifest: dokument.schreiben.
- POST /api/dokumente/upload — src/app/api/dokumente/upload/route.ts. Ursprungstor, Sitzung, authorize(dokument.schreiben), Dienst, Rückweg. Bereich kommt aus der SITZUNG (Invariante 3), kein `mandant`-Feld im Rumpf.
- Dienst src/server/services/dokument/ablage.ts — `pruefeFelder` (rein), `leseTags` (rein), `legeAb` (DB + Speicher). MIME aus den BYTES über das vorhandene `ladeHoch` (Grösse → Magic Bytes → EXIF → Aufbewahrung), Bezugsprüfung für kunde_id/objekt_id (die tragen keinen FK, 0009), dokument + dokument_version (Version 1 mit SHA-256).
- /portal/[mandant]/freigaben/stapel — Seite: src/app/portal/[mandant]/freigaben/stapel/page.tsx. JEDER Fall einzeln mit seinen geänderten Feldern (vorher / nachher / Konfidenz / unsicher), zwei Abschnitte „Routine" und „Ausgenommen", markierte Fälle ohne Häkchen mit Grund und Weg zur Einzelprüfung, Obergrenzenwarnung vor dem Absenden, Bericht nach der Entscheidung. Recht: freigabe.stapel_entscheiden (nicht freigabe.entscheiden).
- Dienst src/server/services/freigabe/stapel-mappe.ts — `ladeStapelMappe` (Posteingang + freigabe_feld in EINER Abfrage) und `teileStapel` (rein). Schreibt bewusst KEINE Ansichtszeile; den Vermerk mit Kanal `stapel` schreibt weiterhin `entscheideStapel` je entschiedener Zeile (APR-08).
- src/server/services/freigabe/posteingang.ts — neue reine Funktionen `stapelGrund` / `istStapelbar` (StapelLage). Die Regel „wer darf in den Stapel" steht damit an EINER Stelle; `entscheideStapel` benutzt sie jetzt statt einer zweiten Fassung.
- src/app/api/freigaben/stapel/route.ts — minimal erweitert: Formularfeld `ansicht=stapel` wählt zwischen ZWEI festen Rückwegen (Posteingang oder Stapelmappe). Kein freies `zurueck`-Feld, also keine offene Weiterleitung (D-504).
- /portal/[mandant]/personal/anstellungen/neu — Seite: src/app/portal/[mandant]/personal/anstellungen/neu/page.tsx. ZWEI Schritte: 1. Mensch finden (Vorname/Nachname, Trefferliste dieser Gesellschaft über `sucheKandidaten` — dieselbe Suche wie die Zusammenführungsseite) inklusive gruppenweiter Dublettenprobe; 2. Beschäftigung (Personalnummer, Eintritt) entweder auf einer gewählten `person` oder auf einer ausdrücklich neuen. Ohne Suche bleibt Schritt 2 gesperrt.
- POST /api/personal/anstellungen — src/app/api/personal/anstellungen/route.ts über `fuehrePersonalAus` (personal.schreiben). Ein Vorgang, zwei Wege (`modus=bestehend|neu`) in EINER Transaktion — sonst entstünde dazwischen eine `person` ohne Beschäftigung, die von dieser Gesellschaft aus niemand mehr sieht.
- Dienst src/server/services/personal/einstellung.ts — `pruefeEingabe` und `statusFuerEintritt` (rein), `dublettenProbe` (0365) und `stelleEin`. Riegel gegen die Dublette im eigenen Haus über `app.namensform` (dieselbe Vergleichsform wie die DB-Probe), Personalnummernkollision als Satz statt 23505, Kennungen app-seitig erzeugt (RETURNING auf `person` liefe in die SELECT-Policy).
- /portal/[mandant]/zeiten/freigabe — Seite: src/app/portal/[mandant]/zeiten/freigabe/page.tsx. Wochennavigation, Filter (Person, Objekt, nur ohne Auftrag), vier Kennzahlen, Tabelle mit Häkchen je Eintrag, Nachtschicht-Kennzeichnung (+1), Warnungen für abgeschlossene Stundenkonto-Monate und Obergrenze, Leerzustand — und der offene Punkt O-39 sichtbar OBEN statt in einer Fussnote.
- POST /api/zeit/abrechnungsfreigabe — src/app/api/zeit/abrechnungsfreigabe/route.ts. authorize(zeit.abrechnung_freigeben) + Definer + Manifest = dreifache Prüfung.
- Dienst src/server/services/zeit/abrechnungsfreigabe.ts — `ladeFreigabeliste`, `gibFrei`, `summeMinuten` (rein), `ERGEBNIS_TEXT`. Fensterlogik als ÜBERSCHNEIDUNG mit Berliner Tagesgrenze (`::timestamp at time zone`), also fällt die Nachtschicht nicht heraus.
- Navigation zu den vier neuen Seiten, jeweils rechtegeprüft (AUT-06/D-581): „Dokument ablegen" auf /dokumente (dokument.schreiben), „Einstellen" auf /personal/anstellungen (personal.schreiben), „Stapelmappe" auf /freigaben (freigabe.stapel_entscheiden), „Freigabe" auf /zeiten (zeit.abrechnung_freigeben). Der Leerzustandstext der Dokumentenablage sagt jetzt nicht mehr, das Hochladen „komme noch".

## Migrationen

- drizzle/0365_person_dublettenpruefung.sql — `app.namensform(text)` (getrimmt, kleingeschrieben; bewusst KEINE unscharfe Suche) und `app.person_dublettenpruefung(vorname, nachname)`: SECURITY DEFINER, Eigentümer cse_definer, prüft `personal.schreiben`, gibt ZWEI ZAHLEN zurück (`hier` / `fremd`) und protokolliert jede Probe. Nie ein Name, nie eine Kennung, nie eine Gesellschaft (O-860). Dieselbe Linie wie `app.arbzg_belastung`: eine Gesellschaft darf wissen, DASS eine Grenze berührt ist, ohne zu erfahren, WO der Mensch sonst arbeitet.
- drizzle/0366_zeit_abrechnungsfreigabe.sql — `app.zeit_zur_abrechnung_freigeben(uuid[])` (Definer, cse_definer, prüft `zeit.abrechnung_freigeben`, setzt freigegeben_am/freigegeben_von je Zeile, gibt je Kennung ein Ergebnis zurück, protokolliert jede Freigabe) plus die schmale Policy `z_definer_abrechnungsfreigabe` auf `zeiteintrag` (nur abgeschlossene, nicht stornierte, noch nicht freigegebene Zeilen). Die vorhandene `z_definer_update` (0034) trifft nur OFFENE Zeilen — ohne eigene Policy hätte die Funktion unter FORCE RLS lautlos null Zeilen geschrieben.
- drizzle/0367_einstellung_recht.sql — BEFUND: `t_person_schreiben` und `t_anstellung_schreiben` (0004) prüften KEIN Recht. Jede interne Sitzung mit aktivem Bereich konnte einen Menschen und eine Beschäftigung anlegen; die einzige Wache wäre die Route gewesen, die es bis heute nicht gab. Beide Policies verlangen jetzt `personal.schreiben` (Invariante 3). Lesen und Ändern bleiben unverändert.
- drizzle/0368_anstellung_geplant_wird_aktiv.sql — BEFUND: `geplant` hatte keinen Ausgang. 0191 zieht nur `beendet` nach; eine Beschäftigung, die zum Ersten beginnt, wäre für immer `geplant` geblieben und aus jeder Liste „wer arbeitet hier" gefallen. `app.anstellung_status_nachziehen` setzt jetzt auch `geplant → aktiv`, sobald `eintritt <= app.berlin_heute()` (dieselbe Zeitzonenfunktion wie das Austrittsende, Invariante 2). `ruhend` bleibt unberührt.

## src/server/db/schema/rls.ts — GEPRÜFT, NICHTS EINZUTRAGEN (18.09.2026)

Nachgemessen und deshalb gestrichen: 0365–0368 legen keine Tabelle an, sondern zwei
Definer-Funktionen, zwei ersetzte Policies und eine erweiterte Definer-Funktion. Die
berührten Tabellen (`person`, `anstellung`, `zeiteintrag`, `dokument`,
`dokument_version`, `freigabe`) stehen samt Löschsperre schon im Register; `pnpm
db:triggers` schreibt danach keine Zeile um.

Die Anmerkung bleibt hier stehen, weil sie eine Feststellung ist, keine Auslassung:
0367 ersetzt `t_person_schreiben` und `t_anstellung_schreiben` aus 0004 per `drop
policy` + `create policy`; beide verlangen jetzt zusätzlich
`app.hat_recht('personal.schreiben', …)`. `rls.ts` führt keine Policyliste — der
Wortlaut steht an der Policy selbst.

## src/server/registry/navigation.ts — GEPRÜFT, NICHTS NÖTIG (18.09.2026)

Nachgemessen und deshalb gestrichen: die vier Wurzeln `dokumente`
(`dokument.lesen`), `personal` (`personal/anstellungen`, `personal.lesen`),
`zeiten` (`zeit.lesen`) und `freigaben` (`freigabe.lesen`) stehen in
`NAVIGATION`, alle vier mit genau dem Recht, das dieser Abschnitt nennt. Die
Begründung bleibt hier stehen, weil sie eine Feststellung ist, keine
Auslassung:

`NAVIGATION` führt bereits die vier Wurzeln (`dokumente` → dokument.lesen, `personal` → personal.lesen auf `personal/anstellungen`, `zeiten` → zeit.lesen, `freigaben` → freigabe.lesen). Die vier neuen Seiten sind Unterseiten dieser Wurzeln und werden von dort verlinkt — jeweils nur, wenn die Sitzung das Recht der ZIELSEITE hält (AUT-06/D-581, geprüft über `haeltRechte`):

  /dokumente               → „Dokument ablegen"  (dokument.schreiben)
  /personal/anstellungen   → „Einstellen"        (personal.schreiben)
  /freigaben               → „Stapelmappe"       (freigabe.stapel_entscheiden, aus derselben Abfrage wie die Häkchenspalte)
  /zeiten                  → „Freigabe"          (zeit.abrechnung_freigeben)

Der letzte erscheint heute für NIEMANDEN, weil das Recht nicht gebunden ist (O-39) — richtig so: ein Knopf auf ein 404 verrät, was er nicht zeigen darf. `tests/kern/verweis-rechte.test.ts` läuft grün (5/5).

Ein eigener Navigationspunkt wäre für alle vier falsch: sie sind Handlungen an einer Liste, nicht eigene Module, und die Tab-Leiste führt nach SEITENKARTE §11.2 genau fünf Ziele.

## Zeilen fuer docs/DECISIONS.md, Abschnitt „Offen" — ZUR HÄLFTE ERLEDIGT (18.09.2026)

Eingetragen heisst gelöscht. Die 2 O-Zeilen dieser Domäne — **O-860** und
**O-861** — stehen in `docs/DECISIONS.md` unter „Open — ask, do not guess",
Unterabschnitt „Raised while building · die Domänenwelle (Routenbau)": O-860 im
Block **Personal** (hinter O-616), O-861 im Block **Dienstplan und Zeit** (hinter
O-714). Wortgleich übernommen. Nachgemessen vor dem Eintrag (`w_reg`):
`app.person_dublettenpruefung` gibt es (0365), `zeit.abrechnung_freigeben` steht im
Katalog und `rolle_berechtigung` hält dafür **null** Zeilen — das Recht ist also
gebaut und an keine Rolle gebunden.

**Was dabei auffiel und in DECISIONS.md berichtigt wurde:** die Zeile **O-39** sagte
„`zeit.abrechnung_freigeben` is not seeded **and the screen does not ship**". Die
zweite Hälfte stimmt seit dieser Welle nicht mehr — `/portal/[mandant]/zeiten/freigabe`
und `0366` sind ausgeliefert. Die Zeile nennt jetzt beides getrennt und verweist auf
O-861.

### Noch offen in dieser Warteschlange

Der Vorschlag für **zwei D-Einträge** bleibt stehen, weil kein Text geliefert wurde
(„Text, nicht von mir geschrieben"). Wer sie schreibt, schreibt sie neu — geraten
wird hier nichts:

(a) „Die Anlage von `person` und `anstellung` prüfte kein Recht" — Befund, `0367`, und
warum `personal.schreiben` und kein neuer Schlüssel (04-SEITENKARTE §5.12 führt die
Seite darunter; ein eigener `personal.einstellen` beantwortete eine Rechtefrage, die
niemand gestellt hat, K-17).

(b) „Der Bucket schreibt als LETZTES" — warum `dokument/ablage.ts` den Puffer benutzt
statt der Waisen-Rücknahme der fünf älteren Uploadwege, inklusive des Preises
(Übertragung innerhalb der Transaktion).


## Befunde

- **`t_person_schreiben` und `t_anstellung_schreiben` (0004) prüften KEIN Recht.** `with check (app.assert_genau_ein_mandant() is not null and not app.ist_readonly())` — sonst nichts. Jede interne Sitzung mit einem aktiven Bereich konnte einen Menschen und eine Beschäftigung anlegen. Folgenlos, weil es bis heute keine Schreibfläche gab; mit /personal/anstellungen/neu wäre es die erste geworden, und die Route wäre die einzige Wache gewesen (Invariante 3). Behoben in 0367, eingefroren in tests/isolation/einstellung.test.ts.
- **`anstellung.status = 'geplant'` hatte keinen Ausgang.** 0191 zieht nur `beendet` nach. Eine zum Ersten beginnende Beschäftigung wäre für immer `geplant` geblieben — nicht falsch genug, um aufzufallen, und falsch genug, um jede „wer arbeitet hier"-Liste um die neuen Leute zu bringen. Behoben in 0368.
- **Die Dublette bei einer Schwestergesellschaft ist von einer Einstellungsmaske aus strukturell unsichtbar.** `t_person_lesen` zeigt einen Menschen nur dort, wo er beschäftigt ist; `person` trägt keinen Mandanten (D-09). Ohne Gegenmassnahme erzeugt JEDE Einstellung eines schon in der Gruppe Beschäftigten genau die Dublette, gegen die `app.person_zusammenfuehren` (0194) gebaut ist — und die ArbZG-Aggregation (Invariante 9) zählt danach zweimal die Hälfte. Antwort: 0365 gibt zwei ZAHLEN heraus und keinen Namen; was daraus folgen darf, ist O-860.
- **`sichtbar_fuer_mitarbeiter` hatte keinen einzigen Schreiber.** Ausserhalb des Seeds setzt die Spalte niemand — /portal/mein/dokumente wäre damit für jedes selbst abgelegte Dokument leer geblieben. Die Ablage bietet jetzt das Kästchen an (aus, bis jemand es anhakt, DOC-04); die KUNDENsichtbarkeit bleibt auf ihrer eigenen Seite mit ihrem eigenen Recht.
- **`freigegeben_am` hatte zwei Leser und keinen Schreiber.** `bucheFreigegebeneZeiten` (§7.3) und `zeiteintrag_auftrag` (§3.3, FIN-07) filtern darauf; geschrieben hat sie nur der Seed, der das an Ort und Stelle als Demo-Annahme benennt. Ein Tor ohne Tür: die Zeit staut sich davor, das Stundenkonto bleibt leer, und niemand sieht warum. Die Bedeutung der Spalte ist nicht O-39 — offen ist nur, ob der Schritt ein eigener menschlicher Akt ist.
- **Die Stapelregel stand zweimal** (Schleife in `entscheideStapel`, Bedingung in der Häkchenspalte des Posteingangs) und wäre mit der Mappe ein drittes Mal entstanden. Sie steht jetzt einmal in `posteingang.ts`. Nebenbefund: das Schema verbietet „stapelfähig UND unsicher" ohnehin (CHECK in 0136) — die reine Funktion ist der zweite Riegel, nicht der einzige.
- **Wache 14 (`Speicher.entferne` nur über dokument/loeschung.ts) lässt die übliche Waisen-Rücknahme in einem neuen Dienst nicht zu.** Statt die Allowlist zu erweitern, schreibt `legeAb` die Bytes jetzt als LETZTES: `ladeHoch` läuft gegen einen Puffer (Grössenprüfung, Magic Bytes, EXIF, Aufbewahrung, Hash unverändert), die Zeilen entstehen, und erst dann gehen die Bytes hinaus. Scheitert das, nimmt die Transaktion beide Zeilen mit — es entsteht weder eine Waise noch eine Zeile ohne Datei. Preis: die Übertragung liegt innerhalb der Transaktion.
- **Nicht von mir, aber blockierend für `pnpm typecheck`:** `src/server/services/gruppe/radar.ts:249` ist syntaktisch kaputt (`TS1005: ',' expected`, zweimal) — eine neue, noch nicht eingecheckte Datei eines parallel laufenden Agenten. Meine Dateien sind sauber; der gefilterte Typecheck über dokumente/freigaben/personal/zeiten ist leer.

## NICHT gebaut

- `POST /api/dokumente/upload-ticket` (signierte Upload-Adresse in einen Quarantäne-Bucket, 05-API-KARTE §C). Gebaut ist der multipart-Weg, den es hier schon fünfmal gibt — und der einzige, bei dem die MIME-Prüfung wirklich an den BYTES stattfindet: wer den Browser direkt in den Bucket schreiben lässt, prüft danach eine Datei, die schon liegt. Die Abweichung steht im Kopf der Route.
- `sichtbar_fuer_kunde` im Uploadformular. Das Umlegen ist eine eigene Handlung mit eigenem Recht (dokument.kunde_freigeben, DOC-04) auf …/[id]/kundenfreigabe. Ein Häkchen hier hätte den schwächeren Weg zum selben Ergebnis geöffnet.
- Ein Vorschlag für die Personalnummer. Welche Systematik eine Gesellschaft führt, steht in keinem Dokument (K-17) — das Feld ist Pflicht, die Kollision wird als Satz beantwortet.
- Namen, Kennung oder beschäftigende Gesellschaft bei der gruppenweiten Dublettenprobe. Zurück kommt eine ZAHL (O-860).
- Rücknahme einer erteilten Abrechnungsfreigabe (Teil von O-861, Invariante 8).
- `zeit.abrechnung_freigeben` wurde NICHT geseedet und an keine Rolle gebunden — O-39 ist offen (03-AUTH §12.4). Folge: /zeiten/freigabe antwortet heute für jede Sitzung mit 404. Das ist der gewollte Zustand („gebaut, Tor zu"), aber es heisst auch: im Demobetrieb ist die Seite nicht anklickbar, bis jemand das Recht bindet.
- Eine Stapel-Rücknahme oder ein „alle abwählen"-Knopf auf der Stapelmappe (die Portalformulare tragen kein JavaScript).

## Notizen

**Alle vier Routen liefern jetzt ihre Seite statt der Auffangseite.** Gegengeprüft mit `findeRoute`: `/portal/x/dokumente/upload` → `dokument.schreiben`, `/portal/x/freigaben/stapel` → `freigabe.stapel_entscheiden` (schlägt `/freigaben/[id]`, weil das spezifischere Muster gewinnt), `/portal/x/personal/anstellungen/neu` → `personal.schreiben`, `/portal/x/zeiten/freigabe` → `zeit.abrechnung_freigeben`.

**Zu den zwei schärfsten Invarianten.**
- *freigaben/stapel:* Ich habe zuerst `server/agent/policy.ts`-Umfeld, `services/freigabe/stapel.ts`, den Posteingang und `0136/0137/0152` gelesen. Die Häkchenspalte im Posteingang gab es schon (D-472 nennt `/freigaben/stapel` ausdrücklich als „bewusst ohne eigene Seite"); was fehlte, war die Grundlage für eine verantwortete Massengenehmigung. Die Mappe zeigt deshalb je Fall die geänderten FELDER mit Wert vorher/nachher und Konfidenz — Invariante 7 sagt nicht „ein Mensch hat geklickt". Markierte Fälle sind ausgenommen, bleiben aber sichtbar mit Grund und Weg zur Einzelprüfung; der Server bewertet beim Entscheiden neu (Test: eine markierte Zeile, die das Formular mitschickt, bleibt offen). Protokolliert wird unverändert je Fall: eigener Schnappschuss, eigenes Kettenglied, Ansichtszeile mit Kanal `stapel`. Die alte Häkchenspalte bleibt, wo sie ist — „Do not break what works".
- *personal/anstellungen/neu:* Schritt 2 ist gesperrt, bis gesucht wurde. Der Riegel gegen die Dublette im eigenen Haus benutzt `app.namensform` — dieselbe Vergleichsform wie die DB-Probe, damit Probe und Riegel nicht verschiedene Namen finden. Über die Gesellschaftsgrenze kann kein Riegel greifen (die Zeile ist unsichtbar), also warnt die Seite mit einer Zahl und erklärt, was offen ist (O-860), statt zu blockieren; blockieren hiesse, Einstellen unmöglich zu machen.

**Zu O-39.** Die Seite ist vollständig gebaut, aber heute für jede Sitzung 404, weil `zeit.abrechnung_freigeben` nicht geseedet und an keine Rolle gebunden ist. Ich habe das NICHT geändert — das wäre die erfundene Geschäftsregel. Wer sie im Demobetrieb sehen will, bindet das Recht an eine Rolle (eine Zeile in `rolle_berechtigung`); der Weg dahinter ist durch `tests/isolation/zeit-abrechnungsfreigabe.test.ts` mit einer eigens gebundenen Rolle geprüft.

**Geprüft.** Eigene Datenbank `w_int2` (Migrationen 0365–0368 sauber angewendet), Isolation gegen `iso_int2`. Grün: 36 Kernfälle (3 Dateien) + 41 Isolationsfälle (4 Dateien) = meine; zusätzlich zur Regression `freigabe-fenster` (33), `personal-anstellung` (21), `personal-spaltenschutz`, `dokument`, `seed`, `zeiteintrag`, `zeit-auftrag` — zusammen 104 Isolationsfälle grün. `tests/kern/verweis-rechte.test.ts` (5) und `tests/kern/routen-manifest.test.ts` (31) grün. `npx eslint` über alle neuen und berührten Dateien: sauber.

**Zwei rote Punkte, die zentral gehören.**
1. `tests/kern/routen.test.ts` meldet drei fehlende Manifesteinträge — meine drei API-Routen (die zwei weiteren Treffer gehören einem anderen Agenten). Text oben unter `registry_manifest`.
2. Die Merge-Wachen melden `todo-client-nicht-im-register` für O-860 und O-861 (plus elf O-8xx anderer Agenten). Registerzeilen oben unter `decisions_zeilen`. Alle übrigen 14 Wachen sind grün — insbesondere Wache 14 (Speicher/Löschweg), die mich zur besseren Reihenfolge gezwungen hat.

**Nicht von mir:** `src/server/services/gruppe/radar.ts:249` ist syntaktisch kaputt (`TS1005`, zwei Meldungen) — eine neue, noch untracked Datei eines parallel laufenden Agenten. Sie blockiert `pnpm typecheck` als Ganzes; der gefilterte Lauf über `dokumente|freigaben|personal|zeiten` und über meine Dienste ist leer.

**Nicht angefasst:** `src/server/registry/*`, `src/server/auth/route-manifest.ts`, `src/server/db/schema/rls.ts`, `docs/*`, `package.json`, `scripts/guards/*`, `src/server/db/seed/*`. Keine vorhandene `drizzle/*.sql` geändert. Kein Commit, keine volle Suite, kein Build.
