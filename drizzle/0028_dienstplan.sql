-- ===========================================================================
-- 0028 — Dienstplan-Grundlage: feiertag, planungsserie, einsatz,
--        einsatz_zuordnung  (TIM-01..TIM-05, CLN-01..CLN-03, SEC-01, SEC-08,
--        EMP-02, EMP-14, LEG-03)
--
-- Vertrag: `docs/architecture/02-datenmodell/04-PLANUNG-ZEIT.md` §5.1 bis §5.4.
-- Wo dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die
-- Konvention.
--
-- Vier Tabellen, vier Rollen:
--
--   feiertag           Referenzdatum eines Bundeslandes. OHNE mandant_id — ein
--                      gesetzlicher Feiertag ist fuer alle vier Gesellschaften
--                      derselbe Tag (§5.1).
--   planungsserie      Das AUSFUEHRUNGSPROTOKOLL des Generators zu genau einem
--                      Bedarfstraeger. Keine Wiederholungsregel, keine Uhrzeit:
--                      die stehen auf `turnus`/`posten`/`veranstaltung`, wo der
--                      Planer sie bearbeitet und wo der Vertrag liegt, der die
--                      Leistung schuldet (§5.2).
--   einsatz            EINE konkrete Schicht an einem Ort in einem Zeitfenster.
--   einsatz_zuordnung  WER auf dieser Schicht geplant ist — je Zeile eine
--                      `anstellung`, nie eine `person` (D-09).
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **Keine Ueberschneidungssperre auf `einsatz`.** Kein `EXCLUDE USING gist`
--     ueber (objekt_id, Zeitraum), kein `unique (objekt_id, beginn_zeitpunkt)`.
--     TIM-04 verlangt, dass zehn Schichten zur selben Sekunde an einem Objekt
--     nebeneinander existieren UND einzeln sichtbar bleiben. Ueberschneidung
--     wird ERKANNT und gemeldet (§10.1), nie verhindert. Eine solche Sperre
--     nachtraeglich einzuziehen ist ein blockierender Defekt (§16).
--
--  2. **`besetzt_anzahl` ist eine gefuehrte Zahl, kein zweiter Wahrheitsstand.**
--     Sie existiert nur, damit die Waechterabfrage "morgen unbesetzt" ein
--     Indexscan ist. `unbesetzt` ist deshalb KEIN Status: zwei Quellen fuer
--     dieselbe Aussage driften innerhalb eines Sprints. Der naechtliche
--     Abgleich MELDET Drift, er repariert sie nicht still (§14.3).
--
--  3. **`feiertage_ueberspringen` hat keinen Default.** Ein Default hier waere
--     eine Reinigungsregel (CLN-03), die still auf einen 24/7-Sicherheitsposten
--     angewendet wird — und die Weihnachtsnacht unbesetzt laesst. Jeder
--     Schreiber muss den Wert nennen (§8.5).
--
-- NICHT in dieser Migration, weil ihre Tabellen noch nicht existieren:
-- `checkin_token`, `zeiteintrag`, `medien`, `planungs_konflikt`,
-- `arbeitszeit_verstoss`, `zeit_intern.arbeitszeit_fenster`. Die Ausloeser, die
-- an ihnen haengen (`einsatz_token_nachfuehren`, `einsatz_unveraenderlich_nach_ist`,
-- `*_fenster_projizieren`, die SEC-04-Paarung aus `03-GEWERKE.md` §9.3), kommen
-- mit ihnen — jeder in der Migration, die seine Gegenstelle anlegt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.1, §3.2)
-- ---------------------------------------------------------------------------

/**
 * Lebenslauf einer geplanten Schicht.
 *
 * `unbesetzt` ist mit Absicht KEIN Wert: die Besetzung ergibt sich aus
 * `besetzt_anzahl` gegen `soll_besetzung`. `veroeffentlicht` ebenso wenig —
 * `dienstplan.veroeffentlichen` ist ein Recht auf die HANDLUNG (Route und
 * Dienst), kein Zustand der Zeile; einen Veroeffentlichungsablauf zu
 * modellieren, den die SPEC nicht beschreibt, waere eine erfundene
 * Geschaeftsregel (K-17, §1.3).
 */
create type einsatz_status as enum ('geplant','laufend','abgeschlossen','storniert');

/**
 * Woraufhin geplant wurde. Genau ein Traeger je Einsatz (§5.3) — die Spalten
 * darunter sind einzeln nullbar, aber `num_nonnulls(...) <= 1` haelt sie
 * auseinander.
 */
create type einsatz_quelle as enum
  ('turnus','posten','veranstaltung','sonderleistung','projekt','manuell');

/**
 * Die zwei krankhaften Ortszeiten des Jahres, vom Materialisierer eingetragen
 * (§7.2).
 *
 * `dst_luecke`  — die Ortszeit existiert nicht (Vorstellungsnacht).
 * `dst_doppelt` — die Ortszeit existiert zweimal (Rueckstellungsnacht).
 *
 * Die Werte sind dieselben und in derselben Reihenfolge wie `ZEITANOMALIEN` in
 * `src/server/services/zeit/rrule.ts`; zwei Vokabulare fuer eine Tatsache
 * waeren zwei Antworten auf die Frage, wie lang die Schicht war.
 */
create type zeitanomalie as enum ('keine','dst_luecke','dst_doppelt');

/**
 * PROVISORISCH (§3.2). Die SPEC nennt kein Vokabular fuer den Zustand einer
 * Zuordnung; diese fuenf sind, was der Dienstplan zeichnen muss und was der
 * Tauschablauf aus EMP-10 erzeugt.
 * // TODO(client, O-170): Welche Zustaende braucht eine Einsatzzuordnung
 * zwischen Planung und Ausfuehrung (zugesagt, abgesagt, getauscht, nicht
 * erschienen), und wer darf sie setzen?
 */
create type zuordnung_status as enum
  ('geplant','zugesagt','abgesagt','ersetzt','nicht_erschienen');

-- ---------------------------------------------------------------------------
-- 2. feiertag (§5.1)
-- ---------------------------------------------------------------------------

/**
 * Der gesetzliche Feiertag eines Bundeslandes.
 *
 * OHNE `mandant_id`, und das ist keine Auslassung: der 3. Oktober ist fuer die
 * Reinigung derselbe Tag wie fuer die Security. Eine Kopie je Gesellschaft
 * hiesse vier Wahrheiten ueber einen Kalendertag — und K-16 verbietet den
 * Mittelweg (`mandant_id` nullbar) ausdruecklich: ein Katalog ist entweder
 * gruppenweit ODER je Mandant, nie beides.
 *
 * `datum` ist `date`, nicht `timestamptz`. Ein Feiertag IST ein Kalendertag der
 * Berliner Wanduhr (K-11); ihn als Zeitpunkt zu speichern hiesse, ihn um
 * Mitternacht UTC beginnen zu lassen, also um 01:00 beziehungsweise 02:00
 * Berliner Zeit.
 */
create table feiertag (
  -- Surrogat, weil `einsatz.feiertag_id` hierher zeigt: ein natuerlicher
  -- Schluessel (bundesland, datum) schoebe zwei Spalten in jede verweisende
  -- Tabelle.
  id            uuid primary key default gen_random_uuid(),
  bundesland    char(2) not null,
  datum         date not null,
  bezeichnung   text not null,
  /**
   * `false` fuer Tage, die nicht gesetzlich sind und trotzdem besonders
   * behandelt werden (24.12., 31.12.). Hier wird nur FESTGEHALTEN, dass sie es
   * sind — wie sie behandelt werden, entscheidet diese Tabelle nicht.
   * // TODO(client, O-167): Gelten der 24. und der 31. Dezember im Betrieb
   * als Feiertage, und aus welcher Quelle kommt die Feiertagsliste?
   */
  gesetzlich    boolean not null default true,
  quelle        text not null default 'berechnet',
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint feiertag_bundesland_form check (bundesland ~ '^[A-Z]{2}$'),
  constraint feiertag_quelle_bekannt check (quelle in ('berechnet','import'))
);

-- Die Sonde des Generators: "faellt dieses Vorkommnis auf einen Feiertag?"
create unique index feiertag_uk on feiertag (bundesland, datum);
-- Und die Gegenrichtung: "welche Laender haben an diesem Tag frei?"
create index feiertag_datum_idx on feiertag (datum);

comment on table feiertag is
  'Feiertage je Bundesland. OHNE mandant_id — ein Landesfeiertag ist fuer alle '
  'vier Gesellschaften derselbe Tag (§5.1). Gepflegt von job:feiertage_pflegen, '
  'gesaet aus src/lib/datum/feiertage-berlin.ts.';
comment on column feiertag.gesetzlich is
  'false = kein gesetzlicher Feiertag, aber betrieblich besonders (24.12., '
  '31.12.). Die Behandlung entscheidet O-167, nicht diese Spalte.';

alter table feiertag enable row level security;
alter table feiertag force  row level security;

/**
 * Lesbar fuer jede angemeldete Sitzung, ohne Rechteschluessel.
 *
 * Ein Rechtekonjunkt waere hier nicht die zweite Verteidigungslinie, sondern
 * eine Sperre ohne Schutzgut: der Kalender ist oeffentlich bekannt, und jede
 * Ansicht des Dienstplans braucht ihn. Was er NICHT traegt, ist irgendein
 * Personenbezug — deshalb gibt es nichts, das ein Recht schuetzen koennte.
 */
create policy f_lesen on feiertag for select to cse_app using (true);

/**
 * Geschrieben wird ausschliesslich von `job:feiertage_pflegen` als `cse_job`.
 * Keine INSERT/UPDATE-Policy fuer `cse_app`: ein Feiertag ist kein
 * Stammdatensatz, den ein Planer anlegt, sondern eine Tatsache des
 * Landesrechts.
 */
create policy f_job on feiertag for all to cse_job using (true) with check (true);

grant select on feiertag to cse_app;
grant select, insert, update on feiertag to cse_job;

-- ---------------------------------------------------------------------------
-- 3. planungsserie (§5.2)
-- ---------------------------------------------------------------------------

/**
 * Das Ausfuehrungsprotokoll des Generators zu EINEM Bedarfstraeger.
 *
 * Sie haelt keine Wiederholungsregel und keine Uhrzeit. Beides steht auf
 * `turnus` / `posten` / `veranstaltung` — dort bearbeitet der Planer es, und
 * dort liegt der Vertrag, der die Leistung schuldet. Eine zweite Kopie hier
 * hiesse zwei Antworten auf "wann wird gereinigt", und der Generator muesste
 * sie versoehnen.
 *
 * `planungsserie_ausnahme` gibt es aus demselben Grund nicht: Einzelabweichungen
 * gehoeren zum Bedarfstraeger (`turnus_ausnahme`, `posten_ausnahme`), nicht in
 * die Ausfuehrungsspur.
 */
create table planungsserie (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  -- Genau EIN Traeger. Die zusammengesetzten Fremdschluessel auf
  -- turnus/posten/veranstaltung traegt die Migration nach, die diese Tabellen
  -- anlegt (03-GEWERKE.md) — siehe Abschnitt 6 am Dateiende.
  turnus_id         uuid,
  posten_id         uuid,
  veranstaltung_id  uuid,
  -- Spiegelt, welcher Traeger gesetzt ist, damit der Generator verzweigen kann,
  -- ohne drei IS-NULL-Proben zu schreiben.
  quelle            einsatz_quelle not null,

  /**
   * Vom Traeger UEBERNOMMEN, nicht angenommen. Ein Objekt in Brandenburg darf
   * Berlin nicht stillschweigend erben — und wenn die Zone spaeter am Traeger
   * geaendert wird, aendert das nicht rueckwirkend, in welcher Zone diese Serie
   * materialisiert wurde.
   */
  zeitzone          text not null default 'Europe/Berlin',

  /**
   * NOT NULL und OHNE Default (§8.5).
   *
   * `turnus` liefert den Wert aus `feiertagsregel`; fuer `posten` und
   * `veranstaltung` liest der anlegende Dienst
   * `app.einstellung('zeit.feiertage_ueberspringen_posten')`, ausgeliefert mit
   * `false`. Die sichere Richtung ist "eine geplante Schicht niemals still
   * entfernen".
   * // TODO(client, O-167): Werden Schichtposten und Veranstaltungsdienste an
   * gesetzlichen Feiertagen regulaer besetzt?
   */
  feiertage_ueberspringen boolean not null,

  /**
   * Bei Anlage aufgeloest: `objekt.bundesland` → `app.einstellung(
   * 'zeit.feiertag_bundesland')` → `'BE'`. GESPEICHERT, damit eine spaetere
   * Stammdatenpflege die Historie nicht neu datiert.
   */
  feiertag_bundesland char(2) not null,

  -- TIM-03: acht Wochen. Gespeichert, damit eine einzelne Serie verlaengert
  -- werden kann, ohne dass jemand Code anfasst.
  horizont_tage     integer not null default 56,
  generiert_bis     date,
  -- Serverzeit, gesetzt von kern.planungsserie_zeitstempel().
  letzte_generierung_am timestamptz,
  letzter_job_lauf_id   uuid references job_lauf(id),
  /**
   * Was der letzte Lauf NICHT anwenden konnte (§8.4). `'{}'` heisst "nichts
   * offen", nicht "nie gelaufen" — dafuer steht `letzte_generierung_am`. Ein
   * stiller Rest waere ein Plan, der von seinem Muster abweicht, ohne dass es
   * jemand erfaehrt.
   */
  letzte_meldung    jsonb not null default '{}'::jsonb,

  -- Die EINE Lebendigkeitsspalte: eine pausierte Serie materialisiert nicht
  -- weiter und laesst ihre Historie unberuehrt.
  archiviert_am     timestamptz,
  archiviert_von    uuid references benutzer(id),

  -- §1.13 / §13: Klasse `dienstplan`. Geschrieben von job:aufbewahrung, nie per
  -- DEFAULT — und `loeschsperre` ist ein AKTIVER Halt, kein Geburtszustand.
  -- // TODO(client, O-25): Wie lange werden Planungsdaten aufbewahrt?
  -- Planung ist Beweismittel in einer ArbZG-Pruefung und im Lohnstreit.
  aufbewahrung_bis  date,
  loeschsperre      boolean not null default false,

  -- Auditblock (§1.6)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint planungsserie_mandant_uk unique (mandant_id, id),

  constraint planungsserie_ein_traeger check (
    num_nonnulls(turnus_id, posten_id, veranstaltung_id) = 1),
  -- Die drei Aequivalenzen halten `quelle` und Traegerspalte zusammen. Sie
  -- schliessen zugleich die drei uebrigen Werte von `einsatz_quelle` aus: bei
  -- `manuell` muessten alle drei Spalten NULL sein, was die Bedingung darueber
  -- verbietet.
  constraint planungsserie_quelle_turnus check (
    (quelle = 'turnus') = (turnus_id is not null)),
  constraint planungsserie_quelle_posten check (
    (quelle = 'posten') = (posten_id is not null)),
  constraint planungsserie_quelle_veranstaltung check (
    (quelle = 'veranstaltung') = (veranstaltung_id is not null)),
  constraint planungsserie_horizont_bereich check (horizont_tage between 1 and 400),
  constraint planungsserie_bundesland_form check (feiertag_bundesland ~ '^[A-Z]{2}$'),
  constraint planungsserie_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * Die treibende Abfrage des Generators — OHNE `current_date`-Konjunkt.
 *
 * `current_date` ist `STABLE`, nicht `IMMUTABLE`; PostgreSQL weist es in einem
 * Index-Praedikat rundheraus zurueck, und die Migration schluege fehl (§1.10).
 * Die Zeitgrenze steht im `WHERE` der Abfrage, wo sie hingehoert.
 */
create index ps_generator_idx on planungsserie (mandant_id, generiert_bis)
  where archiviert_am is null;

-- EIN lebendes Ausfuehrungsprotokoll je Bedarfstraeger. Zwei waeren zwei
-- Generatoren auf demselben Muster — und damit doppelte Schichten.
create unique index ps_carrier_uk
  on planungsserie ((coalesce(turnus_id, posten_id, veranstaltung_id)))
  where archiviert_am is null;

create index ps_lauf_idx on planungsserie (letzter_job_lauf_id);

comment on table planungsserie is
  'Ausfuehrungsprotokoll des Generators je Bedarfstraeger (§5.2). Haelt KEINE '
  'Wiederholungsregel und keine Uhrzeit — die stehen auf turnus/posten/'
  'veranstaltung, wo der Planer sie bearbeitet.';
comment on column planungsserie.feiertage_ueberspringen is
  'Ohne Default mit Absicht (§8.5): ein Default waere eine Reinigungsregel, '
  'still angewandt auf einen 24/7-Posten.';

-- ---------------------------------------------------------------------------
-- 4. einsatz (§5.3)
-- ---------------------------------------------------------------------------

/**
 * Eine konkrete Schicht: ein Ort, ein Zeitfenster, ein Sollbestand.
 *
 * Die Zeitpunkte sind `timestamptz`, gespeichert UTC, angezeigt Europe/Berlin
 * (Invariante 2). Die Dauer ist die Differenz zweier UTC-Zeitpunkte — nie die
 * Differenz zweier Ortszeiten, sonst sind die beiden Umstellungsnaechte um eine
 * Stunde falsch (K-11).
 *
 * `beginn_lokal`/`ende_lokal` stehen DANEBEN, nicht dafuer: sie sind der
 * Wanduhr-Schnappschuss dessen, was geplant wurde — das, was auf dem
 * ausgedruckten Plan steht und worueber im Streitfall gesprochen wird. Sie sind
 * `time` ohne Zone; eine zweite Zeitzonendarstellung desselben Zeitpunkts waere
 * eine zweite Wahrheit.
 */
create table einsatz (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  planungsserie_id uuid,
  quelle        einsatz_quelle not null default 'manuell',

  -- Hoechstens EIN Gewerketraeger. `revier_id` steht daneben und zaehlt nicht
  -- mit: eine Turnusschicht nennt ihr Revier (CLN-01).
  turnus_id         uuid,
  posten_id         uuid,
  veranstaltung_id  uuid,
  sonderleistung_id uuid,
  projekt_id        uuid,
  revier_id         uuid,

  /**
   * Der Idempotenzschluessel des Generators (§8.3).
   *
   * Er nennt die HERKUNFT des Vorkommnisses, nicht seine heutige Lage:
   * `serie:<planungsserie_id>:<urspruengliches plan_datum>:<HHMM>`. Deshalb
   * erzeugt eine Verschiebung keine zweite Schicht, und zwei Serien, die
   * zufaellig zur selben Sekunde am selben Objekt planen, bekommen zwei
   * Schluessel und bleiben zwei sichtbare Zeilen (TIM-04).
   */
  quell_schluessel text not null,

  -- Der BERLINER Kalendertag, zu dem die Schicht zaehlt (ihr Starttag). Traegt
  -- die Spalte des Dienstplans, nie eine Dauer.
  plan_datum    date not null,

  beginn_zeitpunkt timestamptz not null,
  ende_zeitpunkt   timestamptz not null,
  zeitzone         text not null default 'Europe/Berlin',
  beginn_lokal     time not null,
  ende_lokal       time not null,
  -- Die Nachtschicht 22:00–06:00 setzt das. Ohne die Spalte waere `ende_lokal <
  -- beginn_lokal` von einem Tippfehler nicht zu unterscheiden.
  endet_am_folgetag boolean not null default false,
  zeitanomalie     zeitanomalie not null default 'keine',
  pause_geplant_minuten integer not null default 0,

  objekt_id     uuid not null,
  /**
   * Denormalisiert aus `objekt`, gesetzt von kern.einsatz_kunde_setzen().
   *
   * Sie existiert, weil die Kundendecke und die K-18-Policy `t_kunde` auf einer
   * SPALTE DIESER ZEILE stehen muessen: eine Unterabfrage ueber `objekt`
   * unterliegt selbst der RLS von `objekt` und trifft null Zeilen, sobald diese
   * Tabelle einer Kundensitzung korrekt verschlossen ist.
   */
  kunde_id      uuid not null,
  auftrag_id    uuid,
  auftrag_leistung_id uuid,

  soll_besetzung smallint not null default 1,
  min_besetzung  smallint not null default 1,
  /**
   * Gefuehrte Zahl lebender Zuordnungen — nur damit der Waechter "morgen
   * unbesetzt" ein Indexscan ist. Der naechtliche Abgleich MELDET Drift als
   * `warnung` im audit_log; er repariert sie nicht still, denn eine stille
   * Reparatur macht die Ursache unauffindbar (§14.3).
   */
  besetzt_anzahl smallint not null default 0,

  /**
   * Die zur Materialisierung aufgeloeste Anforderungsmenge (§11):
   * `[{qualifikation_id, zwingend, geltung, mindestanzahl, rechtsgrundlage}]`.
   * SEC-04 wird an dem gemessen, was DAMALS verlangt war — ein spaeter
   * geaenderter Anforderungskatalog darf eine vergangene Schicht nicht
   * rueckwirkend rechtswidrig machen. `'{}'` heisst: noch nicht aufgeloest.
   */
  anforderung_snapshot jsonb not null default '{}'::jsonb,
  -- NULL = noch nicht bewertet. Trennt "unbesetzt" von "mit der falschen
  -- Qualifikationsmischung besetzt" — zwei verschiedene Meldungen.
  anforderung_erfuellt boolean,

  -- Gesetzt, wenn das Vorkommnis auf einen Feiertag faellt und TROTZDEM geplant
  -- wurde: die Spur zur Frage "warum wurde am 3. Oktober gereinigt".
  -- Einspaltiger Fremdschluessel, und das ist die in §14.4 benannte Ausnahme:
  -- `feiertag` ist mandantenfreie Referenz und hat kein (mandant_id, id).
  feiertag_id   uuid references feiertag(id),

  status        einsatz_status not null default 'geplant',
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  -- Planernotiz. Nie ein Preis, nie ein Satz — diese Domaene fuehrt keine
  -- Geldspalte (§1.5).
  notiz         text,
  -- Welcher naechtliche Lauf diese Zeile erzeugt hat. Einspaltig, weil
  -- `job_lauf` ein Plattformprotokoll OHNE mandant_id ist (K-21).
  generator_lauf_id uuid references job_lauf(id),

  -- §1.13 / §13: Klasse `dienstplan`.
  -- // TODO(client, O-25): Aufbewahrungsfrist fuer Planungsdaten?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  -- Auditblock (§1.6) — 'system' fuer die Zeilen des Generators.
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint einsatz_mandant_uk unique (mandant_id, id),
  -- Fuer die Kindtabellen, die an (Mandant, Objekt, Einsatz) haengen
  -- (03-GEWERKE.md §2.1).
  constraint einsatz_objekt_id_uk unique (mandant_id, objekt_id, id),

  constraint einsatz_serie_fk foreign key (mandant_id, planungsserie_id)
    references planungsserie (mandant_id, id),
  constraint einsatz_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint einsatz_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint einsatz_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),

  constraint einsatz_ein_traeger check (
    num_nonnulls(turnus_id, posten_id, veranstaltung_id, sonderleistung_id, projekt_id) <= 1),
  constraint einsatz_quell_schluessel_laenge check (
    length(quell_schluessel) between 8 and 200),
  constraint einsatz_fenster check (ende_zeitpunkt > beginn_zeitpunkt),
  constraint einsatz_folgetag check (endet_am_folgetag or ende_lokal > beginn_lokal),
  constraint einsatz_pause_nicht_negativ check (pause_geplant_minuten >= 0),
  constraint einsatz_soll_besetzung check (soll_besetzung >= 1),
  constraint einsatz_min_besetzung check (min_besetzung >= 1 and min_besetzung <= soll_besetzung),
  constraint einsatz_besetzt_nicht_negativ check (besetzt_anzahl >= 0),
  -- Eine Stornierung ohne Grund ist im Lohnstreit keine Auskunft.
  constraint einsatz_storno_begruendet check (
    status <> 'storniert'
    or (storniert_am is not null and btrim(coalesce(storno_grund,'')) <> '')),
  -- Ein Auftragsbezug beginnt beim Auftrag: eine Leistungszeile ohne ihren
  -- Auftrag koennte kein Enkel-Fremdschluessel mehr binden.
  constraint einsatz_leistung_braucht_auftrag check (
    auftrag_leistung_id is null or auftrag_id is not null),
  constraint einsatz_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * KEIN `EXCLUDE USING gist` und kein `unique (objekt_id, beginn_zeitpunkt)`.
 *
 * TIM-04 verlangt zehn gleichzeitige Schichten an einem Objekt, jede einzeln
 * sichtbar. Ueberschneidung ist ein BEFUND (§10.1), keine Sperre. Wer hier eine
 * Ausschlussbedingung ergaenzt, macht aus einem sichtbaren Konflikt einen
 * `duplicate key`-Fehler in dem Moment, in dem jemand versucht, eine Schicht zu
 * besetzen.
 */

-- Idempotenz des Generators und Inferenzziel des ON CONFLICT (§8.3). Partiell,
-- weil eine stornierte Zeile ihre Spur behaelt und dasselbe Vorkommnis danach
-- neu entstehen darf (§1.12).
create unique index einsatz_quelle_uk on einsatz (mandant_id, quell_schluessel)
  where storniert_am is null;

create index einsatz_plan_idx on einsatz (mandant_id, beginn_zeitpunkt);
create index einsatz_objekt_tag_idx on einsatz (mandant_id, objekt_id, beginn_zeitpunkt);
create index einsatz_serie_idx on einsatz (planungsserie_id, plan_datum);
-- Der Waechter um 18:00 und die Besetzungsanforderung aus REC-01.
create index einsatz_unterbesetzt_idx on einsatz (mandant_id, beginn_zeitpunkt)
  where besetzt_anzahl < soll_besetzung and status in ('geplant','laufend');
-- Der stuendliche Waechter "Schicht vorbei, kein Zeiteintrag", kombiniert mit
-- einem NOT EXISTS.
create index einsatz_ohne_zeit_idx on einsatz (mandant_id, ende_zeitpunkt)
  where status = 'geplant';
create index einsatz_auftrag_idx on einsatz (mandant_id, auftrag_leistung_id, beginn_zeitpunkt)
  where auftrag_leistung_id is not null;
/**
 * OHNE `mandant_id` als Praefix, mit Absicht.
 *
 * Die persoenliche Abfrage ueber alle Beschaeftigungen (EMP-14) und der
 * iCal-Feed haben keinen einzelnen Mandanten zu nennen — in `person`-Scope ist
 * `app.aktiver_mandant()` NULL. Ein Index mit Mandantenpraefix waere fuer genau
 * diese Abfrage nutzlos.
 */
create index einsatz_zeit_idx on einsatz (beginn_zeitpunkt);

comment on table einsatz is
  'Eine konkrete Schicht (§5.3). Zeitpunkte timestamptz/UTC, Anzeige Berlin '
  '(Invariante 2); beginn_lokal/ende_lokal sind der Wanduhr-Schnappschuss des '
  'Geplanten, keine zweite Zeitrechnung.';
comment on column einsatz.besetzt_anzahl is
  'Gefuehrte Zahl lebender Zuordnungen — nur fuer den Waechterindex. KEIN '
  'Status `unbesetzt`: zwei Quellen fuer eine Aussage driften.';
comment on column einsatz.kunde_id is
  'Denormalisiert aus objekt (kern.einsatz_kunde_setzen). Traegt die Kundendecke '
  'und t_kunde — eine Unterabfrage ueber objekt traefe dort null Zeilen.';

-- ---------------------------------------------------------------------------
-- 5. einsatz_zuordnung (§5.4)
-- ---------------------------------------------------------------------------

/**
 * Wer auf der Schicht geplant ist — je Zeile genau eine `anstellung`.
 *
 * D-09: alles Kostenrelevante haengt an der Beschaeftigung, nicht am Menschen.
 * Die Zuordnung ist kostenrelevant und gehoert zu genau einer Gesellschaft.
 *
 * ABWEICHUNG von D-09s Beispieltabelle, aufgeschrieben statt stillschweigend
 * (§5.4): D-09 fuehrt `einsatz` unter "haengt an anstellung_id". Hier haengt die
 * kostenrelevante Verbindung an der ZUORDNUNG. SEC-01 verlangt mehrere Personen
 * auf einer Schicht und TIM-04 jede davon als eigene Zeile; ein `anstellung_id`
 * auf `einsatz` machte aus einem 24/7-Posten mit drei Wachen entweder drei
 * Schichten oder eine Schicht mit zwei unsichtbaren Wachen. Die REGEL von D-09
 * ist eingehalten.
 *
 * `person_id` steht denormalisiert daneben — und der zusammengesetzte
 * Fremdschluessel `(anstellung_id, person_id) → anstellung (id, person_id)`
 * macht Drift strukturell unmoeglich. Ohne diese Spalte muesste die
 * EMP-14-Selbstauskunft und die K-06-Projektion ueber eine mandantengebundene
 * Tabelle joinen, um an den Menschen zu kommen — was in `person`-Scope null
 * Zeilen liefert.
 */
create table einsatz_zuordnung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  einsatz_id    uuid not null,
  anstellung_id uuid not null,
  person_id     uuid not null,

  -- Das EIGENE Fenster der Zuordnung: eine Wache deckt 22:00–02:00 eines
  -- 22:00–06:00-Postens. Wird vom Ausloeser aus der Schicht vorbelegt.
  beginn_zeitpunkt timestamptz not null,
  ende_zeitpunkt   timestamptz not null,

  /**
   * Rolle auf der Schicht — bewusst KEIN Aufzaehlungstyp, solange niemand die
   * Liste bestaetigt hat.
   * // TODO(client, O-170): Welche Funktionen gibt es auf einer Schicht
   * (Objektleiter, Vorarbeiter, Springer, Sicherheitsmitarbeiter)?
   */
  funktion      text,
  status        zuordnung_status not null default 'geplant',

  -- Die zwei Beweisspalten, die die SEC-04-Paarung aus 03-GEWERKE.md §9.3
  -- beschreibt. Diese Migration legt sie an; die Ausloeser kommen mit den
  -- Qualifikationstabellen (PR 31) — vorher gaebe es nichts zu pruefen.
  qualifikation_geprueft_am timestamptz,
  qualifikation_snapshot    jsonb not null default '{}'::jsonb,

  -- Die Ersatzkette bei Tausch oder Krankheitsvertretung (EMP-10).
  ersetzt_durch_zuordnung_id uuid,
  -- Gesetzt, wenn die Zeile aus einem GENEHMIGTEN Agentenvorschlag stammt. Der
  -- Vorschlag selbst schreibt nie (Invariante 7).
  agent_aufgabe_id uuid,

  zugesagt_am   timestamptz,
  abgesagt_am   timestamptz,
  absage_grund  text,

  -- Weiche Entfernung: eine Zuordnung, die es gab und die zurueckgenommen
  -- wurde, ist Teil des Planungsprotokolls und des ArbZG-Beweises.
  entfernt_am   timestamptz,
  entfernt_von  uuid references benutzer(id),

  -- §1.13 / §13: Klasse `dienstplan`.
  -- // TODO(client, O-25): Aufbewahrungsfrist fuer Planungsdaten?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  -- Auditblock (§1.6)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint einsatz_zuordnung_mandant_uk unique (mandant_id, id),

  constraint ez_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),
  constraint ez_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  -- Der Schluessel, der die denormalisierte person_id festnagelt (§2.3 Nr. 8).
  constraint ez_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  constraint ez_ersatz_fk foreign key (mandant_id, ersetzt_durch_zuordnung_id)
    references einsatz_zuordnung (mandant_id, id),

  constraint ez_fenster check (ende_zeitpunkt > beginn_zeitpunkt),
  constraint ez_absage_begruendet check (
    status <> 'abgesagt'
    or (abgesagt_am is not null and btrim(coalesce(absage_grund,'')) <> '')),
  constraint ez_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Eine Beschaeftigung hoechstens einmal je Schicht. Das beschraenkt PARALLELE
-- Schichten nicht: die haben andere einsatz_id (TIM-04). Partiell, weil eine
-- entfernte Zuordnung wieder anlegbar sein muss (§1.12).
create unique index ez_einsatz_anstellung_uk on einsatz_zuordnung (einsatz_id, anstellung_id)
  where entfernt_am is null;

/**
 * DER Index fuer "meine Schichten naechste Woche" (EMP-02, EMP-14) und fuer die
 * K-06-Projektion — bewusst OHNE mandant_id-Praefix.
 *
 * Die Abfrage laeuft in `person`-Scope ueber alle Beschaeftigungen eines
 * Menschen; einen einzelnen Mandanten kann sie nicht nennen.
 */
create index ez_person_zeit_idx on einsatz_zuordnung (person_id, beginn_zeitpunkt)
  where entfernt_am is null;

create index ez_mandant_anstellung_idx
  on einsatz_zuordnung (mandant_id, anstellung_id, beginn_zeitpunkt);
create index ez_einsatz_idx on einsatz_zuordnung (einsatz_id) where entfernt_am is null;
-- Auswertung, und sie ist nach §1.15 gesperrt, solange O-172 offen ist: die
-- Zahl wird ERFASST, ausgewertet wird sie nicht.
create index ez_nichterschienen_idx on einsatz_zuordnung (mandant_id, status)
  where status = 'nicht_erschienen';

comment on table einsatz_zuordnung is
  'Wer auf der Schicht geplant ist — je Zeile eine anstellung (D-09). person_id '
  'denormalisiert und per (anstellung_id, person_id)-FK festgenagelt.';
comment on column einsatz_zuordnung.entfernt_am is
  'Weiche Entfernung. Eine zurueckgenommene Zuordnung bleibt Teil des '
  'Planungsprotokolls und des ArbZG-Beweises (Invariante 8).';

-- ---------------------------------------------------------------------------
-- 6. Fremdschluessel, die eine spaetere Migration nachtraegt
-- ---------------------------------------------------------------------------

/**
 * Sieben Elternteile existieren heute noch nicht — `turnus`, `posten`,
 * `veranstaltung`, `sonderleistung`, `projekt`, `revier` (alle 03-GEWERKE.md)
 * und `auftrag_leistung` (02-CRM-OPERATIONS.md).
 *
 * Die Spalten stehen hier, die Fremdschluessel NICHT. Ein einspaltiger
 * Fremdschluessel auf eine Tabelle mit `mandant_id` ist nach K-16 ein
 * Pruefungsfehler — er liesse eine Schicht der Reinigung an einen Turnus der
 * Security haengen. Lieber gar keiner als der falsche; die Migration, die den
 * Elternteil anlegt, traegt ihn nach. Wortwoertlich diese Anweisungen (§14.4):
 *
 *   alter table planungsserie add constraint ps_turnus_fk
 *     foreign key (mandant_id, turnus_id) references turnus (mandant_id, id);
 *   alter table planungsserie add constraint ps_posten_fk
 *     foreign key (mandant_id, posten_id) references posten (mandant_id, id);
 *   alter table planungsserie add constraint ps_veranstaltung_fk
 *     foreign key (mandant_id, veranstaltung_id) references veranstaltung (mandant_id, id);
 *   alter table einsatz add constraint einsatz_turnus_fk
 *     foreign key (mandant_id, turnus_id) references turnus (mandant_id, id);
 *   alter table einsatz add constraint einsatz_posten_fk
 *     foreign key (mandant_id, posten_id) references posten (mandant_id, id);
 *   alter table einsatz add constraint einsatz_veranstaltung_fk
 *     foreign key (mandant_id, veranstaltung_id) references veranstaltung (mandant_id, id);
 *   alter table einsatz add constraint einsatz_sonderleistung_fk
 *     foreign key (mandant_id, sonderleistung_id) references sonderleistung (mandant_id, id);
 *   alter table einsatz add constraint einsatz_projekt_fk
 *     foreign key (mandant_id, projekt_id) references projekt (mandant_id, id);
 *   alter table einsatz add constraint einsatz_revier_fk
 *     foreign key (mandant_id, revier_id) references revier (mandant_id, id);
 *   alter table einsatz add constraint einsatz_leistung_fk
 *     foreign key (mandant_id, auftrag_id, auftrag_leistung_id)
 *     references auftrag_leistung (mandant_id, auftrag_id, id);
 *
 * Der letzte ist der ENKEL-Schluessel: er ist das, was verhindert, dass eine
 * Schicht auf die Leistungszeile eines ANDEREN Auftrags gebucht wird (FIN-07) —
 * und er verlangt `unique (mandant_id, auftrag_id, id)` auf `auftrag_leistung`
 * (§2.3 Nr. 9). Bis dahin haelt hier nur `einsatz_auftrag_fk` plus die
 * Bedingung `einsatz_leistung_braucht_auftrag`.
 */

-- ---------------------------------------------------------------------------
-- 7. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * Ereigniszeitpunkte gehoeren dem Server (Invariante 5, §1.8).
 *
 * `DEFAULT now()` greift nur, wenn die Spalte WEGGELASSEN wird; ein INSERT oder
 * UPDATE, der einen Wert mitschickt, schreibt einen beliebigen Zeitpunkt — und
 * die Unveraenderlichkeitsregeln machen ihn danach dauerhaft.
 *
 * Eigene Funktionen je Tabelle, weil `kern.erzwinge_serverzeit()` auf
 * `eingegangen_am` festgeschrieben ist und ein Ausloeser keine Spaltennamen als
 * Argument nimmt — dieselbe Begruendung, mit der 0017
 * `kern.erzwinge_serverzeit_geschehen()` daneben gestellt hat.
 *
 * Gestempelt wird nur der UEBERGANG nach "gesetzt". Das Zuruecknehmen eines
 * Stempels bleibt hier unberuehrt: was daran zulaessig ist, entscheidet die
 * Unveraenderlichkeitsregel der jeweiligen Tabelle, nicht die Uhr.
 */
create function kern.planungsserie_zeitstempel() returns trigger
language plpgsql as $$
begin
  -- Der INSERT-Zweig zuerst, und er kehrt zurueck: `old` ist hier nicht
  -- zugewiesen, und schon eine Bedingung, die ein Feld davon NENNT, wirft —
  -- auch wenn der andere Zweig einer ODER-Verknuepfung sie erledigt haette.
  -- Dieselbe Bauart wie kern.auftrag_freigabe_stempeln() in 0025.
  if tg_op = 'INSERT' then
    if new.archiviert_am is not null then new.archiviert_am := now(); end if;
    if new.letzte_generierung_am is not null then new.letzte_generierung_am := now(); end if;
    return new;
  end if;

  if new.archiviert_am is not null and old.archiviert_am is null then
    new.archiviert_am := now();
  end if;
  if new.letzte_generierung_am is not null
     and new.letzte_generierung_am is distinct from old.letzte_generierung_am then
    new.letzte_generierung_am := now();
  end if;
  return new;
end $$;

create trigger trg_planungsserie_zeitstempel
  before insert or update on planungsserie
  for each row execute function kern.planungsserie_zeitstempel();

create function kern.einsatz_zeitstempel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.storniert_am is not null then new.storniert_am := now(); end if;
    return new;
  end if;
  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;
  return new;
end $$;

create trigger trg_einsatz_zeitstempel
  before insert or update on einsatz
  for each row execute function kern.einsatz_zeitstempel();

create function kern.einsatz_zuordnung_zeitstempel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.entfernt_am is not null then new.entfernt_am := now(); end if;
    if new.zugesagt_am is not null then new.zugesagt_am := now(); end if;
    if new.abgesagt_am is not null then new.abgesagt_am := now(); end if;
    return new;
  end if;

  if new.entfernt_am is not null and old.entfernt_am is null then
    new.entfernt_am := now();
  end if;
  if new.zugesagt_am is not null and old.zugesagt_am is null then
    new.zugesagt_am := now();
  end if;
  if new.abgesagt_am is not null and old.abgesagt_am is null then
    new.abgesagt_am := now();
  end if;
  return new;
end $$;

create trigger trg_einsatz_zuordnung_zeitstempel
  before insert or update on einsatz_zuordnung
  for each row execute function kern.einsatz_zuordnung_zeitstempel();

/**
 * Der Idempotenzschluessel entsteht auch dann, wenn ihn niemand mitliefert.
 *
 * Der Dienst erzeugt die `id` in der Anwendung und setzt beides selbst (§8.3) —
 * ein `DEFAULT gen_random_uuid()` laesst sich im selben INSERT nicht
 * referenzieren. Diese Fuellung ist das Netz darunter: eine von Hand
 * geschriebene Anweisung kann keine schluessellose Zeile hinterlassen, und eine
 * schluessellose Zeile waere fuer den naechsten Generatorlauf unsichtbar — er
 * legte sie ein zweites Mal an.
 */
create function kern.einsatz_quell_schluessel_setzen() returns trigger
language plpgsql as $$
begin
  if new.quell_schluessel is null or btrim(new.quell_schluessel) = '' then
    new.quell_schluessel := 'manuell:' || new.id::text;
  end if;
  return new;
end $$;

create trigger trg_einsatz_quell_schluessel
  before insert on einsatz
  for each row execute function kern.einsatz_quell_schluessel_setzen();

/**
 * `kunde_id` wird aus dem Objekt abgeleitet, nicht vom Aufrufer geglaubt.
 *
 * Auf dieser Spalte stehen die Kundendecke und `t_kunde`. Duerfte der Aufrufer
 * sie frei setzen, koennte er eine Schicht in die Portalsicht eines fremden
 * Kunden schieben — und die Ableitung koennte von dem Objekt abdriften, aus dem
 * sie stammt.
 *
 * ZWEI Dokumente widersprechen sich hier, und die Aufloesung steht bewusst im
 * Klartext: `04-PLANUNG-ZEIT.md` §5.3 verlangt `kunde_id NOT NULL`, waehrend
 * `objekt.kunde_id` (0021, O-70) nullbar ist — dasselbe Gebaeude kann fuer zwei
 * Kunden betreut werden, und ein Veranstaltungsort existiert, bevor es einen
 * Kundenstamm gibt. "Ueberschreibe immer" naehme einem Veranstaltungsdienst
 * (SEC-08), dessen Kunde an der `veranstaltung` haengt, seinen Kunden wieder
 * weg. Also: nennt das Objekt einen Kunden, gewinnt das Objekt; nennt es
 * keinen, muss der Aufrufer einen nennen. Beide Absichten bleiben erhalten, und
 * keine Zeile entsteht ohne den Schluessel, auf dem die Kundensicht steht.
 * // TODO(client, O-70): Wird ein Gebaeude, das fuer zwei Kunden derselben
 * Gesellschaft betreut wird, als ein Objekt oder als zwei gefuehrt? Eine Antwort
 * "zwei Objekte" macht `objekt.kunde_id` verpflichtend und diesen zweiten Zweig
 * ueberfluessig.
 */
create function kern.einsatz_kunde_setzen() returns trigger
language plpgsql as $$
declare
  v_kunde uuid;
begin
  select o.kunde_id into v_kunde
    from objekt o
   where o.id = new.objekt_id and o.mandant_id = new.mandant_id;

  if not found then
    raise exception 'Das Objekt der Schicht gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation',
            detail  = 'einsatz.objekt_id zeigt auf kein objekt dieses Mandanten.',
            hint    = 'Objekt und Einsatz muessen denselben mandant_id tragen.';
  end if;

  if v_kunde is not null then
    new.kunde_id := v_kunde;
  elsif new.kunde_id is null then
    raise exception 'Das Objekt nennt keinen Kunden, und die Schicht auch nicht'
      using errcode = 'not_null_violation',
            detail  = 'objekt.kunde_id ist NULL (O-70), also muss einsatz.kunde_id '
                      || 'aus dem Bedarfstraeger kommen — bei einer Veranstaltung '
                      || 'aus veranstaltung.kunde_id.',
            hint    = 'Kunde am Objekt hinterlegen oder beim Anlegen mitgeben.';
  end if;
  return new;
end $$;

create trigger trg_einsatz_kunde_setzen
  before insert or update of objekt_id on einsatz
  for each row execute function kern.einsatz_kunde_setzen();

/**
 * Das Fenster der Zuordnung liegt IM Fenster der Schicht.
 *
 * Vorbelegt wird aus der Schicht, wenn der Aufrufer nichts sagt — das ist der
 * Normalfall. Genannt wird es, wenn eine Wache nur einen Teil des Postens
 * deckt. Ausserhalb liegen darf es nie: eine Zuordnung, die vor ihrer Schicht
 * beginnt, erzeugt ArbZG-Fenster (K-06) fuer Zeit, die niemand geplant hat.
 */
create function kern.ez_fenster_pruefen() returns trigger
language plpgsql as $$
declare
  v_beginn timestamptz;
  v_ende   timestamptz;
begin
  select e.beginn_zeitpunkt, e.ende_zeitpunkt into v_beginn, v_ende
    from einsatz e
   where e.id = new.einsatz_id and e.mandant_id = new.mandant_id;

  if not found then
    raise exception 'Die Schicht dieser Zuordnung gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;

  if new.beginn_zeitpunkt is null then new.beginn_zeitpunkt := v_beginn; end if;
  if new.ende_zeitpunkt   is null then new.ende_zeitpunkt   := v_ende;   end if;

  if new.beginn_zeitpunkt < v_beginn or new.ende_zeitpunkt > v_ende then
    raise exception 'Das Fenster der Zuordnung liegt ausserhalb der Schicht'
      using errcode = 'check_violation',
            detail  = format('Schicht %s bis %s, Zuordnung %s bis %s.',
                             v_beginn, v_ende, new.beginn_zeitpunkt, new.ende_zeitpunkt),
            hint    = 'Schicht verlaengern oder die Zuordnung ins Fenster legen.';
  end if;
  return new;
end $$;

create trigger trg_ez_fenster_pruefen
  before insert or update on einsatz_zuordnung
  for each row execute function kern.ez_fenster_pruefen();

/**
 * `besetzt_anzahl` wird gezaehlt, nicht fortgeschrieben.
 *
 * Neu gezaehlt statt `+1`/`-1`: ein Zaehler, der Ereignisse addiert, driftet bei
 * jedem verlorenen Ereignis dauerhaft, und die Drift ist von einer echten
 * Unterbesetzung nicht zu unterscheiden.
 *
 * Gezaehlt wird, was LEBT — `entfernt_am is null`. Ob eine Absage oder ein
 * Nichterscheinen die Besetzung mindert, ist keine Frage, die diese Migration
 * beantworten darf: das Zustandsvokabular selbst ist provisorisch.
 * // TODO(client, O-170): Mindert eine Absage (`abgesagt`) oder ein
 * Nichterscheinen die Besetzung einer Schicht sofort, oder bleibt die Zuordnung
 * bis zur Ersatzplanung besetzt?
 *
 * Der Ausloeser feuert auf `entfernt_am` und `status` (§14.1) und zaehlt
 * dennoch beide Seiten neu: das Umhaengen einer Zuordnung auf eine andere
 * Schicht ist kein modellierter Vorgang (entfernen und neu anlegen, §1.6), und
 * wenn es doch einmal geschieht, bleibt keine Zahl falsch zurueck.
 */
create function kern.einsatz_besetzung_zaehlen() returns trigger
language plpgsql as $$
declare
  v_einsaetze uuid[] := array[new.einsatz_id];
  v_einsatz   uuid;
begin
  -- `old` wird NUR im UPDATE-Zweig beruehrt, und in einer GESCHACHTELTEN
  -- Bedingung: im INSERT-Ausloeser ist der Satz nicht zugewiesen, und schon
  -- eine Bedingung, die ein Feld davon nennt, wirft — auch dann, wenn der
  -- erste Teil einer UND-Verknuepfung sie erledigt haette.
  if tg_op = 'UPDATE' then
    if old.einsatz_id is distinct from new.einsatz_id then
      v_einsaetze := v_einsaetze || old.einsatz_id;
    end if;
  end if;

  foreach v_einsatz in array v_einsaetze loop
    update einsatz e
       set besetzt_anzahl = (select count(*)
                               from einsatz_zuordnung z
                              where z.einsatz_id = v_einsatz
                                and z.entfernt_am is null)
     where e.id = v_einsatz;
  end loop;
  return null;
end $$;

create trigger trg_einsatz_besetzung_zaehlen
  after insert or update of entfernt_am, status on einsatz_zuordnung
  for each row execute function kern.einsatz_besetzung_zaehlen();

-- ---------------------------------------------------------------------------
-- 8. Zeilenschutz — planungsserie
-- ---------------------------------------------------------------------------

alter table planungsserie enable row level security;
alter table planungsserie force  row level security;

create policy t_mandant on planungsserie for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstplan.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstplan.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on planungsserie for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstplan.lesen')));

/**
 * KEINE Selbstauskunft fuer Mitarbeitende, und das ist eine Entscheidung.
 *
 * Ein Arbeitnehmer sieht seine SCHICHTEN, nicht das Muster dahinter und nicht
 * dessen Abrechnungsanker (EMP-13). Die Decke ist deshalb entartet: im
 * Mitarbeiterportal trifft diese Tabelle null Zeilen.
 */
create policy p_ma_decke on planungsserie as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on planungsserie as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Der naechtliche Generator laeuft als `cse_job`, ohne Sitzung.
 *
 * Um drei Uhr nachts gibt es keinen angemeldeten Menschen, dessen Rechte man
 * pruefen koennte — und `FORCE ROW LEVEL SECURITY` gilt auch fuer ihn: ohne
 * eigene Policy liest er null Zeilen und schreibt nichts.
 *
 * Die Policy sagt, WELCHE ZEILEN — hier alle, denn `job:aufbewahrung` muss auch
 * an einer pausierten Serie eine Frist eintragen koennen. Was er SCHREIBEN darf,
 * sagt der Spalten-Grant darunter: seinen eigenen Fortschritt und die Frist,
 * nicht den Bedarfstraeger und nicht `archiviert_am`. Eine Serie zu pausieren
 * ist eine Planungsentscheidung, kein Nachtlauf.
 */
create policy t_job on planungsserie for select to cse_job using (true);
create policy t_job_fortschritt on planungsserie for update to cse_job
  using (true) with check (true);

grant select, insert, update on planungsserie to cse_app;
grant select on planungsserie to cse_job;
grant update (generiert_bis, letzte_generierung_am, letzter_job_lauf_id,
              letzte_meldung, aufbewahrung_bis, loeschsperre)
      on planungsserie to cse_job;

-- ---------------------------------------------------------------------------
-- 9. Zeilenschutz — einsatz
-- ---------------------------------------------------------------------------

alter table einsatz enable row level security;
alter table einsatz force  row level security;

create policy t_mandant on einsatz for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstplan.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstplan.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on einsatz for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstplan.lesen')));

/**
 * /portal/mein, Scope `person` (EMP-02, EMP-14).
 *
 * `einsatz` traegt keine `person_id`, also loest das Subjektpraedikat ueber die
 * Zuordnung auf — die ihrerseits eine eigene `t_person`-Policy hat, sodass die
 * Kette das Subjekt nie verlaesst.
 *
 * Warum nicht einfach ein `or person_id = …` an `t_mandant`: weil in
 * `person`-Scope `app.aktiver_mandant()` NULL ist und die andere Haelfte
 * derselben Policy einmandantig waere. K-18 gibt dem Portal einen eigenen
 * Scope, damit beide in der Pruefung nicht verwechselt werden koennen. Und
 * genau deshalb hat diese Policy kein Schreib-Gegenstueck: jedes `WITH CHECK`
 * von `t_mandant` ist hier falsch, die Datenbank weist den Schreibversuch ab.
 */
create policy t_person on einsatz for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from einsatz_zuordnung z
                      where z.einsatz_id = einsatz.id
                        and z.person_id  = app.aktuelle_person()
                        and z.entfernt_am is null));

/**
 * /portal/kunde, Scope `kunde` (CRM-06) — auf der EIGENEN Spalte dieser Zeile.
 *
 * Nie ueber eine Unterabfrage auf `objekt`: die unterliegt der RLS von
 * `objekt`, und eine Kundensitzung sieht dort nur, was ihr gehoert — was sich
 * mit einer korrekt verschlossenen Objekttabelle zu null Zeilen aufloest.
 * `app.aktuelle_kunden()` ist die ARRAY-Form (K-20): die skalare
 * `app.aktueller_kunde()` loest ueber `app.aktiver_mandant()` auf, und der ist
 * in Kundensicht NULL.
 */
create policy t_kunde on einsatz for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and status <> 'storniert');

/**
 * Die K-04-Decken. RESTRICTIVE, weil eine permissive zweite Regel ODER-
 * verknuepft wuerde — ein Loch statt einer Decke.
 *
 * `einsatz` steht in K-04s Aufzaehlung, obwohl es kein `anstellung_id` traegt.
 * Ohne diese Decke waere die Selbstauskunft oben die EINZIGE Schranke dessen,
 * was eine Mitarbeitersitzung hier liest, und genau das nennt §16 einen
 * blockierenden Defekt. Sie schluesselt deshalb auf die Existenz einer eigenen
 * lebenden Zuordnung.
 */
create policy p_ma_decke on einsatz as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or exists (select 1 from einsatz_zuordnung z
                     where z.einsatz_id = einsatz.id
                       and z.person_id  = app.aktuelle_person()
                       and z.entfernt_am is null));

create policy p_kunde_decke on einsatz as restrictive for all to cse_app
  using (app.portal() <> 'kunde' or kunde_id = any (app.aktuelle_kunden()));

-- Der Generator legt Schichten an und schreibt sie fort (§14.3); die Waechter
/**
 * Der Generator legt Schichten an und schreibt sie fort (§14.3); die Waechter
 * lesen sie; `job:aufbewahrung` traegt Fristen ein — auch an STORNIERTEN
 * Zeilen, denn gerade sie sind die, deren Frist einmal ablaeuft. Deshalb hier
 * keine Zeilenschranke: eine, die Storniertes aussperrt, liesse den Fristenlauf
 * genau diese Zeilen ueberspringen, und zwar lautlos als "null Zeilen
 * betroffen".
 *
 * Dass ein Nachtlauf eine abgesagte Schicht nicht versehentlich wiederbelebt,
 * haelt an anderer Stelle: `einsatz_quelle_uk` ist PARTIELL auf
 * `storniert_am is null`, also ist die stornierte Zeile fuer das ON CONFLICT
 * des Generators unsichtbar — er legt eine neue an, statt die alte anzufassen.
 */
create policy t_job on einsatz for select to cse_job using (true);
create policy t_job_anlegen on einsatz for insert to cse_job with check (true);
create policy t_job_fortschreiben on einsatz for update to cse_job
  using (true) with check (true);

grant select, insert, update on einsatz to cse_app;
grant select, insert, update on einsatz to cse_job;

-- ---------------------------------------------------------------------------
-- 10. Zeilenschutz — einsatz_zuordnung
-- ---------------------------------------------------------------------------

alter table einsatz_zuordnung enable row level security;
alter table einsatz_zuordnung force  row level security;

create policy t_mandant on einsatz_zuordnung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstplan.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstplan.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on einsatz_zuordnung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstplan.lesen')));

-- EMP-14: die eigenen Zuordnungen in JEDER Gesellschaft, fuer die man arbeitet.
-- Nie die eines anderen, und nie ein Entgelt — hier steht keines (§1.5).
create policy t_person on einsatz_zuordnung for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and person_id = app.aktuelle_person());

/**
 * Kein `t_kunde`: WELCHE benannte Person auf einer Schicht steht, ist nicht die
 * Zeile des Kunden (EMP-13). Er sieht die Schicht, nicht ihre Besetzungsliste.
 */
create policy p_ma_decke on einsatz_zuordnung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
create policy p_kunde_decke on einsatz_zuordnung as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Lesend fuer die Waechter (Besetzungsabgleich, ArbZG-Detektor).
 *
 * Und genau ZWEI Spalten schreibend: die Aufbewahrungsfrist. Ohne sie kaeme
 * `job:aufbewahrung` an diese Tabelle nicht heran und §13 haette fuer sie
 * keinen Schreiber — die Frist bliebe fuer immer NULL, und weil der
 * Raeumungspfad nur Zeilen mit gesetzter Frist betrachtet, faellt das nie auf.
 * Wer auf einer Schicht steht, entscheidet dagegen ein Mensch: dafuer gibt es
 * hier kein Recht und keinen Grant.
 */
create policy t_job on einsatz_zuordnung for select to cse_job using (true);
create policy t_job_frist on einsatz_zuordnung for update to cse_job
  using (true) with check (true);

grant select, insert, update on einsatz_zuordnung to cse_app;
grant select on einsatz_zuordnung to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on einsatz_zuordnung to cse_job;

-- ---------------------------------------------------------------------------
-- 11. Was 0021 und 0025 hier abgeholt haben
-- ---------------------------------------------------------------------------

/**
 * Die Mitarbeitersicht auf `objekt` — 0021 hat sie ausdruecklich hierher
 * verwiesen: "Die Policy `t_person` kommt mit `einsatz`, in derselben
 * Migration."
 *
 * Ohne sie sieht die Reinigungskraft im Portal ihre Schicht, aber nicht die
 * Adresse des Objekts, an dem sie stattfindet — und zwar als leeres Feld, nicht
 * als Fehler. Das Praedikat laeuft ueber die eigene lebende Zuordnung und
 * verlaesst damit das Subjekt nicht. Der Zutrittshinweis bleibt auch damit
 * verschlossen: 0021 entzieht die Spalte `cse_app` ganz und gibt sie nur ueber
 * `app.objekt_notiz_lesen()` heraus.
 */
create policy t_person on objekt for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1
                       from einsatz e
                       join einsatz_zuordnung z
                         on z.einsatz_id = e.id and z.mandant_id = e.mandant_id
                      where e.objekt_id = objekt.id
                        and e.mandant_id = objekt.mandant_id
                        and z.person_id = app.aktuelle_person()
                        and z.entfernt_am is null));

/**
 * Und der Lesezugriff des Generators auf `objekt`.
 *
 * `kern.einsatz_kunde_setzen()` laeuft als die AUFRUFENDE Rolle — es kann nicht
 * `security definer` sein, denn §1.1 fuehrt eine geschlossene Liste der
 * `cse_definer`-Policies, und `objekt` steht nicht darauf. Der naechtliche
 * Generator ist `cse_job` und traefe dort sonst null Zeilen: jede erzeugte
 * Schicht schluege mit "Objekt gehoert nicht zu dieser Gesellschaft" fehl,
 * obwohl sie es tut.
 *
 * Deshalb ein SPALTEN-Grant: drei Spalten, mehr braucht die Ableitung nicht.
 * Zutrittshinweise, Bemerkungen und Geokoordinaten bleiben dem Nachtlauf
 * verschlossen.
 */
create policy t_job on objekt for select to cse_job using (true);
grant select (id, mandant_id, kunde_id) on objekt to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0028)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- feiertag (append): LEG-03, § 9 ArbZG. Der Feiertagskalender ist die Grundlage dafuer, ob an einem Tag geplant werden durfte und welche Zuschlaege galten. Ein geloeschter Feiertag macht jede vergangene Schicht an diesem Tag unpruefbar — korrigiert wird er durch eine neue Zeile, nie durch DELETE.
create trigger trg_feiertag_kein_hard_delete
  before delete on feiertag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_feiertag_kein_truncate
  before truncate on feiertag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on feiertag from cse_app, cse_anon, cse_checkin, cse_job;

-- planungsserie (archiv): LEG-03, LEG-01. Sie beantwortet, WORAUS ein Plan entstanden ist — die erste Frage einer ArbZG-Pruefung zu einer Schicht, die es nicht haette geben duerfen. Eine pausierte Serie bekommt archiviert_am; sie zu loeschen macht jede von ihr erzeugte Schicht herrenlos.
create trigger trg_planungsserie_kein_hard_delete
  before delete on planungsserie
  for each row execute function kern.verhindere_loeschung();
create trigger trg_planungsserie_kein_truncate
  before truncate on planungsserie
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on planungsserie from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatz (archiv): LEG-02, LEG-03. Die geplante Schicht ist die Gegenprobe zum § 17 MiLoG-Nachweis und zur ArbZG-Auswertung: geplant gegen geleistet. Eine abgesagte Schicht bekommt storniert_am mit Grund — geloescht waere sie im Lohnstreit eine Luecke, die niemand mehr erklaeren kann.
create trigger trg_einsatz_kein_hard_delete
  before delete on einsatz
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_kein_truncate
  before truncate on einsatz
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatz_zuordnung (archiv): LEG-03, D-09. Wer wann fuer WELCHE Gesellschaft eingeteilt war, ist der Beweis, aus dem die entitaetsuebergreifende ArbZG-Belastung entsteht. Eine zurueckgenommene Einteilung bekommt entfernt_am und bleibt Teil des Planungsprotokolls.
create trigger trg_einsatz_zuordnung_kein_hard_delete
  before delete on einsatz_zuordnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_zuordnung_kein_truncate
  before truncate on einsatz_zuordnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz_zuordnung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_feiertag_geaendert_am
  before update on feiertag
  for each row execute function kern.setze_geaendert_am();
create trigger trg_planungsserie_geaendert_am
  before update on planungsserie
  for each row execute function kern.setze_geaendert_am();
create trigger trg_einsatz_geaendert_am
  before update on einsatz
  for each row execute function kern.setze_geaendert_am();
create trigger trg_einsatz_zuordnung_geaendert_am
  before update on einsatz_zuordnung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_einsatz_audit
  after insert or update or delete on einsatz
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_einsatz_zuordnung_audit
  after insert or update or delete on einsatz_zuordnung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
