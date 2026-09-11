-- ===========================================================================
-- 0069 — Der zweite Bedarfstraeger: postenart, posten, posten_ausnahme,
--        veranstaltung (SEC-01, SEC-04, SEC-08, TIM-02, TIM-04, TEN-08,
--        REQ-03, FIN-07)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §6.1, §6.3, §6.4,
-- §6.5 und §1.10; `04-PLANUNG-ZEIT.md` §8.1 fuer die Generatoreingabe. Wo
-- dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- 0029 hat die Reinigungsseite der Bedarfstraeger angelegt und die
-- Sicherheitsseite ausdruecklich dieser Migration ueberlassen — bis dahin
-- stehen `einsatz.posten_id`, `einsatz.veranstaltung_id`,
-- `planungsserie.posten_id`, `planungsserie.veranstaltung_id` und
-- `einsatzanforderung.posten_id`/`veranstaltung_id` als Spalten OHNE
-- Fremdschluessel da. Abschnitt 5 traegt sie woertlich nach.
--
--   postenart        Der Katalog der Postenarten (§6.1). LEER ausgeliefert:
--                    SEC-01 nennt keine, und eine geratene Liste saehe
--                    bestaetigt aus (O-148).
--   posten           Die zu besetzende Wachposition an einem Objekt, mit
--                    Mindest- und Sollbesetzung, Abdeckungsregel und
--                    Qualifikationsanforderungen (§6.3).
--   posten_ausnahme  Die Einzelabweichung an EINEM Kalendertag — TIM-02
--                    verlangt Ausnahmen auf wiederkehrenden Serien, und der
--                    Entwurf gab sie nur `turnus` (§6.4).
--   veranstaltung    Der Eventdienst (SEC-08): ein Fenster, ein Kunde, eine
--                    Sollbesetzung — keine Wiederholung (§6.5).
--
-- Fuenf Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **Die Mindestbesetzung ist KEINE Datenbankbedingung** (§6.3). Ein
--     unterbesetzter Plan muss speicherbar sein, sonst kann niemand planen:
--     der Generator legt acht Wochen Postenschichten an, BEVOR jemand
--     eingeteilt ist, TIM-04 zeichnet genau diese offenen Spalten, und der
--     Waechter „morgen unbesetzt" braucht die unbesetzte Zeile, um sie zu
--     finden. Sichtbar wird die Unterbesetzung durch die Sicht
--     `posten_unterbesetzung` (Abschnitt 10) und durch den Dienst, der die
--     Veroeffentlichung abweist — nicht durch einen Constraint, der das
--     Planen unmoeglich macht.
--
--  2. **`dtstart_lokal` ist `timestamp` OHNE Zeitzone** — dieselbe
--     dokumentierte Ausnahme von Invariante 2 wie auf `turnus` (§10.1). Eine
--     Abdeckungsregel ist eine Aussage ueber die Wanduhr: die Nachtwache
--     tritt am 30. Maerz um 22:00 an, nicht um 21:00.
--
--  3. **`veranstaltung.beginn`/`ende` sind dagegen `timestamptz`** (§6.5) —
--     eine einzelne Veranstaltung IST ein Zeitpunktpaar und keine Regel. Wer
--     hier eine RRULE-Mechanik nachbaute, traegt vier immer-NULL-Spalten und
--     eine zweite Zeitrechnung.
--
--  4. **`posten.ist_veranstaltung` gibt es nicht.** Der Entwurf hatte die
--     Flagge; §6.3 streicht sie: eine Veranstaltung hat Kunde, Ort, Fenster
--     und Besucherzahl, wofuer ein Dauerposten keine Spalte hat. Zwei
--     Tabellen, ein Tor (§10.7).
--
--  5. **Keine Aufbewahrungsspalten.** §1.14 vergibt `aufbewahrung_bis` /
--     `loeschsperre` an die BEWEISFUEHRENDEN Tabellen; §11 fuehrt diese vier
--     unter `betrieb` bzw. `stammdaten`, und beide Klassen sind offen (O-25).
--     Sie „der Symmetrie zuliebe" mitzunehmen behauptete einen Loeschpfad,
--     den kein Dokument beschreibt.
--
-- NICHT in dieser Migration: `wachbuch_eintrag` und `kontrollpunkt` (0070),
-- `dienstanweisung*`, `schluessel*` (PR 42). Der Fremdschluessel
-- `posten.dienstanweisung_id` steht deshalb als Spalte ohne Schluessel da,
-- mit der nachzutragenden Anweisung in Abschnitt 5.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. postenart — der Katalog (§6.1)
-- ---------------------------------------------------------------------------

/**
 * KATALOGTABELLE, kein Aufzaehlungstyp — und das ist die Entscheidung aus
 * §3.2/§1.16: SEC-01 nennt keine Postenarten, und wenn der Mandant sie nennt,
 * darf die Antwort keine Migration kosten.
 *
 * Ausgeliefert wird sie LEER. Die Oberflaeche sagt „keine Arten hinterlegt"
 * statt eine plausible Liste zu zeigen, die niemand bestaetigt hat (K-17).
 * // TODO(client, O-148): Welche Postenarten werden gefuehrt (Objektschutz,
 * Empfang, Streife, Revierdienst, Veranstaltungsdienst, …)? (SEC-01)
 */
create table postenart (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  schluessel    text not null,
  bezeichnung   text not null,
  /**
   * Die Wache liest die Postenart in ihrem Portal, und das spricht vier
   * Sprachen (EMP-12, SPEC §10). Derselbe Zuschnitt wie `nachweis_art` und
   * `qualifikation` (0030): genau die vier Schluessel, nichts sonst.
   */
  bezeichnung_i18n jsonb not null default '{}'::jsonb,
  beschreibung  text,
  sortierung    smallint not null default 0,

  -- §1.16: eine geratene Zeile faerbt ihre Anzeige. Vorgabe `true`, weil eine
  -- Zeile ohne Antwort des Mandanten unbestaetigt IST.
  ist_platzhalter boolean not null default true,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint postenart_mandant_uk unique (mandant_id, id),

  constraint postenart_schluessel_gefuellt check (btrim(schluessel) <> ''),
  constraint postenart_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint postenart_i18n_schluessel
    check (bezeichnung_i18n - array['de','en','ar','tr'] = '{}'::jsonb),
  constraint postenart_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- PARTIELL (§1.3): eine archivierte Art darf ihren Schluessel nicht auf Dauer
-- belegen — wird „Empfang" neu zugeschnitten, heisst die neue Zeile legitim
-- wieder `empfang`.
create unique index postenart_schluessel_uk on postenart (mandant_id, schluessel)
  where archiviert_am is null;
create index postenart_sortierung_idx on postenart (mandant_id, sortierung)
  where archiviert_am is null;

comment on table postenart is
  'Katalog der Postenarten (§6.1). LEER ausgeliefert (O-148) — eine geratene '
  'Liste saehe bestaetigt aus.';

-- ---------------------------------------------------------------------------
-- 2. posten — die zu besetzende Wachposition (§6.3)
-- ---------------------------------------------------------------------------

/**
 * Der zweite Bedarfstraeger neben `turnus` (§10.7).
 *
 * Ein Posten schuldet eine BESETZTE POSITION — Empfang, Streife, 24/7-
 * Objektschutz —, ein Turnus eine Frequenz. Der Unterschied steht in genau den
 * Spalten, die es hier zusaetzlich gibt: `min_besetzung`, `soll_besetzung` und
 * die Dienstanweisung. Zusammengelegt traegt jede Turnuszeile vier
 * immer-NULL-Spalten und die Acht-Wochen-Buchhaltung aus TIM-03 wird
 * mehrdeutig.
 *
 * KEINE Beschraenkung auf den Security-Mandanten (§6.3): TEN-08 sagt zu, dass
 * ein fuenfter Bereich eine Datenbankzeile kostet und keine Codeaenderung. Ein
 * `check (mandant_id = <security>)` waere genau die Codeaenderung.
 */
create table posten (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  objekt_id     uuid not null,
  -- Der Abrechnungsanker (FIN-07): ein Auftrag traegt mehrere Leistungszeilen
  -- mit verschiedenen Abrechnungsarten, ein Posten haengt an genau einer.
  auftrag_leistung_id uuid,
  postenart_id  uuid,

  bezeichnung   text not null,
  -- Das Postenkuerzel auf dem ausgedruckten Plan („EG-Empfang", „NW-1").
  kurzzeichen   text,

  /**
   * Die zwei Besetzungszahlen, und sie sind NICHT dasselbe.
   *
   * `min_besetzung` ist die Untergrenze, unter der der Posten als NICHT
   * besetzt gilt — die Zahl, an der die Dringlichkeitsabfrage haengt.
   * `soll_besetzung` ist die geplante Staerke. Zwei Wachen geplant, eine
   * zwingend: das ist der Normalfall eines Nachtpostens, und mit nur einer
   * Zahl waere er nicht darstellbar.
   *
   * Als CHECK stehen hier nur die zwei Aussagen, die keine Geschaeftsregel
   * sind: eine Position wird von mindestens einem Menschen besetzt, und die
   * Sollstaerke liegt nicht unter der Mindeststaerke.
   */
  min_besetzung  smallint not null default 1,
  soll_besetzung smallint not null default 1,

  /**
   * RFC 5545 RRULE OHNE DTSTART und OHNE TZID — dieselbe Form wie auf
   * `turnus` (0029) und aus demselben Grund geprueft: vollstaendig im
   * getesteten Parser `src/lib/datum/rrule.ts`, nicht in einem
   * Formregulaerausdruck, den `INTERVAL=2;FREQ=WEEKLY` verletzt, obwohl er
   * gueltig ist.
   *
   * NULL heisst DURCHGEHEND (§6.3): ein 24/7-Objektschutz hat keine
   * Wiederholungsregel, er hat keine Luecke.
   */
  abdeckung_rrule text,
  /**
   * Der Wanduhr-Anker, `timestamp` OHNE Zeitzone — die dokumentierte Ausnahme
   * von Invariante 2 (§10.1). Als `timestamptz` gespeichert und in UTC
   * aufgezaehlt, tritt die Nachtwache ein halbes Jahr lang um 21:00 oder
   * 23:00 an.
   */
  dtstart_lokal timestamp,
  zeitzone      text not null default 'Europe/Berlin',
  -- Schichtlaenge. GEPLANTE Dauer, `integer` Minuten (K-16, §1.1) — eine
  -- gemessene stuende in `zeiteintrag`.
  dauer_minuten integer,

  /**
   * Die Dienstanweisung des Postens (SEC-06). SPALTE OHNE FREMDSCHLUESSEL —
   * `dienstanweisung` entsteht erst mit PR 42 (Abschnitt 5).
   */
  dienstanweisung_id uuid,

  gueltig_ab    date not null,
  -- Einschliessend: ein Posten, der am 31.12. endet, wird an diesem Tag noch
  -- besetzt.
  gueltig_bis   date,

  -- Generatorbuchhaltung (TIM-03), dieselbe Spalte wie auf `turnus`.
  letzte_generierung_bis date,

  -- Die EINE Lebendigkeitsspalte (§1.3). Stammdaten werden archiviert.
  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint posten_mandant_uk unique (mandant_id, id),

  constraint posten_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint posten_postenart_fk foreign key (mandant_id, postenart_id)
    references postenart (mandant_id, id),
  constraint posten_auftrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),

  constraint posten_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint posten_min_besetzung check (min_besetzung >= 1),
  constraint posten_soll_besetzung check (soll_besetzung >= min_besetzung),
  -- Anker und Regel gehoeren zusammen: eine Regel ohne Startpunkt zaehlt
  -- nichts auf, ein Startpunkt ohne Regel ist ein durchgehender Posten mit
  -- einer Uhrzeit, die nichts bedeutet.
  constraint posten_rrule_braucht_anker check (
    (abdeckung_rrule is null) = (dtstart_lokal is null)),
  constraint posten_rrule_ohne_anker check (
    abdeckung_rrule is null
    or (abdeckung_rrule !~ 'DTSTART' and abdeckung_rrule !~ 'TZID'
        and abdeckung_rrule !~ 'RRULE:')),
  constraint posten_dauer_positiv check (dauer_minuten is null or dauer_minuten > 0),
  constraint posten_zeitzone_gefuellt check (zeitzone <> ''),
  constraint posten_gueltig_fenster check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  constraint posten_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Objektakte und die Parallelspalten des Dienstplans (TIM-04).
create index posten_objekt_idx on posten (mandant_id, objekt_id)
  where archiviert_am is null;
/**
 * Die treibende Abfrage des Generators — OHNE `current_date`-Konjunkt.
 *
 * Ein bewegliches Praedikat im Indexvorbehalt ist nicht IMMUTABLE, PostgreSQL
 * weist den Index rundheraus zurueck, und die Migration schluege fehl (§1.13,
 * review B7). Die Zeitgrenze steht im `WHERE` von `app.planungsbedarf`.
 */
create index posten_generator_idx on posten (mandant_id, gueltig_ab, gueltig_bis)
  where archiviert_am is null;
create unique index posten_kurzzeichen_uk on posten (objekt_id, kurzzeichen)
  where archiviert_am is null and kurzzeichen is not null;
create index posten_auftrag_idx on posten (mandant_id, auftrag_leistung_id)
  where auftrag_leistung_id is not null;

comment on table posten is
  'Zu besetzende Wachposition an einem Objekt (§6.3). Mindestbesetzung ist '
  'ABSICHTLICH keine Datenbankbedingung — ein unterbesetzter Plan muss '
  'speicherbar sein; sichtbar wird sie durch posten_unterbesetzung.';
comment on column posten.min_besetzung is
  'Untergrenze, unter der der Posten als nicht besetzt gilt (SEC-01). Traegt '
  'die Dringlichkeitsabfrage und die Veroeffentlichungssperre im Dienst.';
comment on column posten.dtstart_lokal is
  'Wanduhr-Anker OHNE Zeitzone — die dokumentierte Ausnahme von Invariante 2 '
  '(§10.1). NULL zusammen mit abdeckung_rrule heisst: durchgehend besetzt.';

-- ---------------------------------------------------------------------------
-- 3. posten_ausnahme — die Abweichung an EINEM Tag (§6.4)
-- ---------------------------------------------------------------------------

/**
 * TIM-02 verlangt Einzelabweichungen auf wiederkehrenden Serien; der Entwurf
 * gab sie nur `turnus`, sodass eine Postenschicht fuer EINE Nacht gar nicht
 * abgesagt werden konnte (§6.4, review MISSING).
 *
 * Gleiche Bauart wie `turnus_ausnahme` (0029) und mit demselben
 * Aufzaehlungstyp — ihn hier ein zweites Mal zu erfinden waeren zwei
 * Vokabulare fuer eine Tatsache. Die eine zusaetzliche Spalte ist
 * `ersatz_besetzung`: eine Nacht in reduzierter Staerke ist die vierte Art
 * aus 04-PLANUNG-ZEIT.md §8.2, und eine Reinigungsrunde kennt sie nicht.
 */
create table posten_ausnahme (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  posten_id     uuid not null,

  -- Der betroffene BERLINER Kalendertag (K-11, §1.12).
  datum         date not null,
  art           turnus_ausnahme_art not null,

  ersatz_beginn_lokal timestamp,
  dauer_minuten integer,
  /**
   * Die Nacht laeuft, aber mit weniger Wachen (§6.4). NULL heisst: die
   * Sollbesetzung des Postens gilt unveraendert — nicht „null Wachen".
   */
  ersatz_besetzung smallint,

  -- Ein EXDATE ohne Begruendung ist wertlos: im Streit lautet die Frage nicht
  -- „ist ausgefallen", sondern „warum".
  grund         text not null,

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint posten_ausnahme_mandant_uk unique (mandant_id, id),

  constraint posten_ausnahme_posten_fk foreign key (mandant_id, posten_id)
    references posten (mandant_id, id),

  constraint posten_ausnahme_verschiebung_braucht_beginn check (
    art <> 'verschiebung' or ersatz_beginn_lokal is not null),
  constraint posten_ausnahme_dauer_positiv check (
    dauer_minuten is null or dauer_minuten > 0),
  -- Eine reduzierte Besetzung von null waere ein Ausfall, und dafuer gibt es
  -- `art = 'ausfall'`. Zwei Schreibweisen fuer eine Tatsache sind eine zu viel.
  constraint posten_ausnahme_ersatz_besetzung check (
    ersatz_besetzung is null or ersatz_besetzung >= 1),
  constraint posten_ausnahme_grund_gefuellt check (btrim(grund) <> ''),
  constraint posten_ausnahme_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Eine Ausnahme je Posten und Tag: zwei Zeilen fuer denselben Tag hiessen
-- „ausgefallen UND zusaetzlich", und der Generator muesste raten.
create unique index posten_ausnahme_uk on posten_ausnahme (posten_id, datum);
create index posten_ausnahme_posten_idx on posten_ausnahme (mandant_id, posten_id, datum);

comment on table posten_ausnahme is
  'Dokumentierte Einzelabweichung eines Postens an einem Berliner Kalendertag '
  '(§6.4, TIM-02): Ausfall, Zusatz, Verschiebung — oder reduzierte Staerke.';

-- ---------------------------------------------------------------------------
-- 4. veranstaltung — der Eventdienst (§6.5, SEC-08)
-- ---------------------------------------------------------------------------

/**
 * Kurzfristige Besetzung an einem Ort, an dem kein Dauerposten steht.
 *
 * Sie fehlte im Entwurf — und genau das liess das SEC-04-Tor umgehbar
 * aussehen (§9, review B5): wer Wachen gegen ein blosses Objekt buchte, hatte
 * keinen Traeger, an dem eine Anforderung haengen koennte. Mit dieser Tabelle
 * traegt der Geltungsbereich `veranstaltung` aus `einsatzanforderung` (0031)
 * endlich sein Gegenstueck.
 *
 * `beginn`/`ende` sind `timestamptz` und keine Wanduhr: eine Veranstaltung ist
 * EIN Fenster, keine Regel (§6.5). Der Generator sieht sie deshalb mit
 * `rrule = null` (04-PLANUNG-ZEIT.md §8.1) — die kurzfristige Besetzung selbst
 * laeuft aber nicht ueber den Nachtlauf, sondern ueber den Dienst
 * `services/security/eventbesetzung.ts`, der die Schichten sofort anlegt.
 */
create table veranstaltung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /**
   * Der Ort. ENTWEDER ein bekanntes Objekt ODER Freitext (§6.5) — ein
   * Veranstaltungsort existiert oft, bevor es eine Objektakte gibt.
   *
   * ACHTUNG, und es steht hier, weil es sonst erst beim ersten Eventdienst
   * auffiele: `einsatz.objekt_id` ist NOT NULL (0028). Eine Veranstaltung
   * OHNE `objekt_id` laesst sich also anlegen, aber nicht mit Schichten
   * besetzen — der Dienst weist das mit einer benannten Meldung ab, statt
   * eine Objektzeile zu erfinden.
   */
  objekt_id     uuid,
  veranstaltungsort_text text,

  kunde_id      uuid not null,
  auftrag_leistung_id uuid,

  bezeichnung   text not null,
  -- REQ-03: der Anlass, den die Anfrage nennt.
  anlass        text,

  beginn        timestamptz not null,
  ende          timestamptz not null,

  -- REQ-03. Keine Geldspalte, keine abgeleitete Besetzung: wie viele Wachen
  -- eine Besucherzahl verlangt, ist eine Geschaeftsregel, die niemand genannt
  -- hat (K-17) — deshalb rechnet hier nichts.
  erwartete_besucher integer,
  soll_besetzung smallint not null default 1,

  -- Die Einsatzleitung. Haengt an der BESCHAEFTIGUNG, nicht am Menschen
  -- (D-09): die Verantwortung fuer einen Eventdienst ist die einer
  -- bestimmten Gesellschaft.
  leitung_anstellung_id uuid,
  -- SPALTE OHNE FREMDSCHLUESSEL — `dienstanweisung` kommt mit PR 42.
  dienstanweisung_id uuid,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint veranstaltung_mandant_uk unique (mandant_id, id),

  constraint veranstaltung_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint veranstaltung_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint veranstaltung_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint veranstaltung_leitung_fk foreign key (mandant_id, leitung_anstellung_id)
    references anstellung (mandant_id, id),

  constraint veranstaltung_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint veranstaltung_ort_genannt check (
    objekt_id is not null or btrim(coalesce(veranstaltungsort_text,'')) <> ''),
  constraint veranstaltung_fenster check (ende > beginn),
  constraint veranstaltung_soll_besetzung check (soll_besetzung >= 1),
  constraint veranstaltung_besucher check (
    erwartete_besucher is null or erwartete_besucher >= 0),
  constraint veranstaltung_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Das Brett der kurzfristigen Besetzung: „was steht als naechstes an".
create index veranstaltung_zeit_idx on veranstaltung (mandant_id, beginn)
  where archiviert_am is null;
create index veranstaltung_kunde_idx on veranstaltung (mandant_id, kunde_id, beginn desc);

comment on table veranstaltung is
  'Eventdienst (§6.5, SEC-08): ein Fenster, ein Kunde, eine Sollbesetzung. '
  'Traeger des Geltungsbereichs veranstaltung in einsatzanforderung — ohne ihn '
  'war das SEC-04-Tor fuer Eventbesetzungen umgehbar.';

-- ---------------------------------------------------------------------------
-- 5. Die nachzutragenden Fremdschluessel (0028 §6, 0031 §3)
-- ---------------------------------------------------------------------------

/**
 * Woertlich die Anweisungen, die 0028 und 0031 hinterlassen haben.
 *
 * Sie standen dort als Schuld und nicht als stillschweigende Auslassung: ein
 * EINSPALTIGER Fremdschluessel auf eine Mandantentabelle ist nach K-16 ein
 * Pruefungsfehler — er liesse eine Schicht der Reinigung an einem Posten der
 * Security haengen. Lieber gar keiner als der falsche; die Migration, die den
 * Elternteil anlegt, traegt ihn nach. Das ist diese.
 */
alter table planungsserie add constraint ps_posten_fk
  foreign key (mandant_id, posten_id) references posten (mandant_id, id);
alter table planungsserie add constraint ps_veranstaltung_fk
  foreign key (mandant_id, veranstaltung_id) references veranstaltung (mandant_id, id);

alter table einsatz add constraint einsatz_posten_fk
  foreign key (mandant_id, posten_id) references posten (mandant_id, id);
alter table einsatz add constraint einsatz_veranstaltung_fk
  foreign key (mandant_id, veranstaltung_id) references veranstaltung (mandant_id, id);

/**
 * Und die zwei aus 0031: `einsatzanforderung.posten_id` /
 * `veranstaltung_id` standen als Spalten da, weil der Aufloeser in §9.2 sie
 * liest und `einsatz` sie bereits trug.
 *
 * Ohne diese beiden Schluessel kann eine Anforderung auf einen Posten zeigen,
 * den es nicht gibt — und das Tor findet dann KEINE Anforderung und meldet
 * `erfuellt`. Ein Tor, das an einer Zeigerleiche still durchlaesst, ist kein
 * Tor (§9.5).
 */
alter table einsatzanforderung add constraint ea_posten_fk
  foreign key (mandant_id, posten_id) references posten (mandant_id, id);
alter table einsatzanforderung add constraint ea_veranstaltung_fk
  foreign key (mandant_id, veranstaltung_id) references veranstaltung (mandant_id, id);

/**
 * NACHZUTRAGEN IN PR 42, in der Migration, die `dienstanweisung` anlegt —
 * woertlich diese Anweisungen (§12):
 *
 *   alter table posten add constraint posten_dienstanweisung_fk
 *     foreign key (mandant_id, dienstanweisung_id)
 *     references dienstanweisung (mandant_id, id);
 *   alter table veranstaltung add constraint veranstaltung_dienstanweisung_fk
 *     foreign key (mandant_id, dienstanweisung_id)
 *     references dienstanweisung (mandant_id, id);
 *
 * Beide verlangen `unique (mandant_id, id)` auf `dienstanweisung` (§2.1). Bis
 * dahin ist der Verweis eine Behauptung, die niemand prueft — und deshalb
 * steht er hier als Schuld.
 */

-- ---------------------------------------------------------------------------
-- 6. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * Der Archivierungszeitpunkt gehoert dem Server (Invariante 5, §1.11) —
 * dieselbe Funktion, die 0029 fuer `revier` und `turnus` danebengestellt hat.
 * Gestempelt wird nur der UEBERGANG nach „gesetzt": ein `DEFAULT now()` griffe
 * nur bei WEGGELASSENER Spalte, und ein UPDATE, der einen Wert mitschickt,
 * schriebe sonst einen beliebigen Zeitpunkt in die Frage „seit wann ist dieser
 * Posten stillgelegt".
 */
create trigger trg_postenart_archivierung
  before insert or update on postenart
  for each row execute function kern.archivierung_stempeln();
create trigger trg_posten_archivierung
  before insert or update on posten
  for each row execute function kern.archivierung_stempeln();
create trigger trg_veranstaltung_archivierung
  before insert or update on veranstaltung
  for each row execute function kern.archivierung_stempeln();
-- `posten_ausnahme` bekommt keinen: sie hat keine Lebendigkeitsspalte (§6.4,
-- wie `turnus_ausnahme`).

-- ---------------------------------------------------------------------------
-- 7. Die zwei Definer-Helfer aus §1.10
-- ---------------------------------------------------------------------------

/**
 * „Auf welchen Objekten ist der Aufrufer selbst eingesetzt?"
 *
 * Sie traegt die vierte Deckenvariante (`p_intern_einsatz_ceiling`, §1.8) und
 * die `t_person`-Policies des Mitarbeiterportals. Ohne sie liest eine Wache im
 * eigenen Portal weder ihren Posten noch die Kontrollpunkte des Objekts, das
 * sie bewacht (EMP-09, SEC-05).
 *
 * **K-20, und hier ist es keine Formalie.** Die Funktion loest in ALLEN VIER
 * Leseumfaengen auf und haengt NICHT an `app.aktiver_mandant()`: der ist in
 * `person`-Scope NULL, und ein Praedikat darauf waere dort falsch — das ganze
 * Mitarbeiterportal laese null Zeilen, ohne Fehler. Also:
 *
 *   mandant : eingeschraenkt auf den aktiven Mandanten
 *   person  : ueber `app.sichtbare_mandanten()`, also genau die Gesellschaften,
 *             in denen der Mensch beschaeftigt ist
 *   gruppe  : LEER — eine Leitung liest die Gruppensicht ueber `t_gruppe`
 *   kunde   : LEER — ein Kunde hat keine Beschaeftigung
 *
 * Ein LEERES ARRAY, kein NULL: `= any('{}')` ist `false`, `= any(null)` ist
 * NULL, und eine dreiwertige Decke ist keine.
 *
 * **Das Zeitfenster.** §1.10 sagt „within the SEC-06 lookahead window" und
 * KEIN Dokument nennt seine Laenge. Statt eine Zahl zu erfinden (K-17) gilt
 * hier die Grenze, die sich aus den Daten selbst ergibt: eine Schicht, die
 * noch nicht zu Ende ist. Damit sieht die Wache das Objekt ihrer laufenden und
 * ihrer kommenden Einsaetze und verliert den Zugriff, sobald der letzte
 * vorbei ist.
 * // TODO(client, O-211): Wie weit im Voraus soll eine Wache die
 * Kontrollpunkte und die Dienstanweisung ihres naechsten Objekts sehen — und
 * wie lange nach der letzten Schicht noch (SEC-05, SEC-06, EMP-09)?
 */
create or replace function app.eigene_einsatz_objekte()
returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct e.objekt_id), '{}'::uuid[])
    from public.einsatz_zuordnung z
    join public.einsatz e on e.id = z.einsatz_id and e.mandant_id = z.mandant_id
    join public.anstellung a on a.id = z.anstellung_id
   where app.aktuelle_person() is not null
     and a.person_id = app.aktuelle_person()
     and z.entfernt_am is null
     and z.status <> 'abgesagt'
     and e.storniert_am is null
     and e.ende_zeitpunkt >= now()
     and case app.scope()
           when 'mandant' then e.mandant_id = app.aktiver_mandant()
           when 'person'  then e.mandant_id = any (app.sichtbare_mandanten())
           else false
         end;
$$;

comment on function app.eigene_einsatz_objekte() is
  'Die Objekte der eigenen laufenden und kommenden Einsaetze (§1.10). Loest in '
  'allen vier Leseumfaengen auf (K-20); in gruppe und kunde LEER, nicht NULL.';

/**
 * Das Praedikat, das in den Decken steht.
 *
 * `p_objekt is not null` ist nicht Kosmetik: mehrere Traegerspalten sind
 * nullbar, und ein dreiwertiges NULL in einer ODER-Verknuepfung vergiftet die
 * ganze Decke (§1.10).
 */
create or replace function app.ist_eingesetzt_auf_objekt(p_objekt uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select p_objekt is not null and p_objekt = any (app.eigene_einsatz_objekte());
$$;

comment on function app.ist_eingesetzt_auf_objekt(uuid) is
  'Ist der Aufrufer auf diesem Objekt eingesetzt (§1.10, EMP-09)? Nie NULL — '
  'ein NULL-Argument ergibt false.';

revoke execute on function app.eigene_einsatz_objekte() from public;
revoke execute on function app.ist_eingesetzt_auf_objekt(uuid) from public;
grant execute on function app.eigene_einsatz_objekte() to cse_app, cse_job;
grant execute on function app.ist_eingesetzt_auf_objekt(uuid) to cse_app, cse_job;

/**
 * Der Lesepfad des Definers (§1.10): eine `SECURITY DEFINER`-Funktion liest
 * unter FORCE ROW LEVEL SECURITY NICHTS, solange der Eigentuemer keine eigene
 * Policy hat — und zwar ohne Fehler. `app.eigene_einsatz_objekte()` gaebe dann
 * fuer jeden ein leeres Array zurueck, und das Mitarbeiterportal saehe aus wie
 * eines ohne Einsaetze.
 *
 * `einsatz` und `anstellung` haben ihre Definer-Policies seit 0031;
 * `einsatz_zuordnung` fehlt in dem Register (§2.3 Nr. 1 verlangt sie
 * ausdruecklich). Sie wird hier BEDINGT angelegt: PR 40 und PR 43 brauchen
 * denselben Lesepfad fuer `leistungsnachweis` und `aufmass`, und ein
 * unbedingtes `create policy` liesse die zweite Migration an einer Policy
 * scheitern, die bereits genau richtig dasteht.
 */
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'einsatz_zuordnung'
                    and policyname = 'ez_definer') then
    create policy ez_definer on einsatz_zuordnung for select to cse_definer using (true);
  end if;
end $$;

grant select on einsatz_zuordnung to cse_definer;

-- ---------------------------------------------------------------------------
-- 8. Zeilenschutz (§1.6, §1.8)
-- ---------------------------------------------------------------------------

alter table postenart enable row level security;
alter table postenart force  row level security;

create policy t_mandant on postenart for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('security.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('security.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on postenart for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.security.lesen')));

/**
 * `p_nicht_kunde_decke` — die fuenfte Variante aus §1.8, und §6.1 nennt sie
 * fuer genau diese Tabelle: eine Wache mit `security.lesen` sieht die Art
 * ihres eigenen Postens, ein Kunde hat mit dem Postenkatalog nichts zu tun.
 *
 * In diesem Baum heissen die Decken `p_*_decke` (0021 ff.) — derselbe Koerper,
 * der deutsche Name.
 */
create policy p_nicht_kunde_decke on postenart as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Der Katalog ist in `person`-Scope ueber die sichtbaren Mandanten lesbar —
 * wie die KERN-Kataloge (01-KERN §1.12) und aus demselben Grund: er ist eine
 * Zeile ueber niemanden. Die Kundendecke oben gilt weiter.
 */
create policy t_person on postenart for select to cse_app
  using (app.scope() = 'person' and mandant_id = any (app.sichtbare_mandanten()));

grant select, insert, update on postenart to cse_app;

alter table posten enable row level security;
alter table posten force  row level security;

create policy t_mandant on posten for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('security.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('security.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on posten for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.security.lesen')));

/**
 * **§1.8 widerspricht sich hier, und die Aufloesung steht im Klartext.**
 *
 * Die Deckentabelle gibt `posten` die reine `p_intern_decke`; die Tabelle der
 * Subjektumfaenge zwei Absaetze weiter fuehrt `posten` unter `t_person` mit
 * `ist_eingesetzt_auf_objekt(objekt_id)`. Beides zusammen ist unmoeglich:
 * `portal() = 'intern'` ist RESTRICTIVE, also wird es mit der
 * `t_person`-Policy UND-verknuepft — die Wache im eigenen Portal laese null
 * Zeilen, ohne Fehler und ohne dass es jemandem auffiele.
 *
 * §1.8 nennt die Regel selbst, an der das zu entscheiden ist: die Bauprobe
 * schlaegt fehl, wenn „a table on the `t_person` list carries no worker
 * disjunct in its ceiling, or vice versa — the two lists must agree table for
 * table". Also gilt die vierte Variante, `p_intern_einsatz_decke`, wie bei
 * `kontrollpunkt`. Sie ist auch die einzige Lesart, die §6.1 traegt: dass eine
 * Wache „die Art ihres eigenen Postens" sieht, ist wertlos, wenn ihr der
 * Posten selbst verschlossen ist.
 */
create policy p_intern_einsatz_decke on posten as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_objekt(objekt_id)));

create policy t_person on posten for select to cse_app
  using (app.scope() = 'person' and app.ist_eingesetzt_auf_objekt(objekt_id));

/**
 * Der naechtliche Generator laeuft als `cse_job`, ohne Sitzung — und
 * `FORCE ROW LEVEL SECURITY` gilt auch fuer ihn. Ohne Policy liest er null
 * Zeilen OHNE Fehler, meldet „0 Schichten erzeugt" und saehe aus wie ein
 * Betrieb ohne Wachauftrag. Nur lesend, plus die eine Spalte seiner eigenen
 * Buchhaltung — der Spalten-Grant ist die eigentliche Schranke: ein Nachtlauf
 * darf `gueltig_bis` oder `abdeckung_rrule` nicht fortschreiben, also nicht
 * den Vertrag aendern, den er ausfuehrt.
 */
create policy t_job on posten for select to cse_job using (true);
create policy t_job_fortschritt on posten for update to cse_job
  using (true) with check (true);

grant select, insert, update on posten to cse_app;
grant select on posten to cse_job;
grant update (letzte_generierung_bis) on posten to cse_job;

alter table posten_ausnahme enable row level security;
alter table posten_ausnahme force  row level security;

create policy t_mandant on posten_ausnahme for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('security.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('security.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on posten_ausnahme for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.security.lesen')));

create policy p_intern_decke on posten_ausnahme as restrictive for all to cse_app
  using (app.portal() = 'intern');

-- Lesend fuer den Generator: er wandelt die Ausnahmen in EXDATE/RDATE um.
-- Schreiben darf er sie nicht — eine Ausnahme traegt Grund und Urheber, und
-- beides hat ein Nachtlauf nicht.
create policy t_job on posten_ausnahme for select to cse_job using (true);

grant select, insert, update on posten_ausnahme to cse_app;
grant select on posten_ausnahme to cse_job;

alter table veranstaltung enable row level security;
alter table veranstaltung force  row level security;

create policy t_mandant on veranstaltung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('security.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('security.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on veranstaltung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.security.lesen')));

/**
 * `p_intern_decke` (§1.8) — und sie ist hier strenger als beim Posten mit
 * Absicht: eine Veranstaltung traegt `kunde_id`, `erwartete_besucher` und den
 * Anlass. Das ist Auftraggeberwissen, kein Arbeitsplatz. Die Wache sieht ihre
 * SCHICHT (`einsatz`, 0028) und im Wachbuch ihr Objekt.
 */
create policy p_intern_decke on veranstaltung as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy t_job on veranstaltung for select to cse_job using (true);

grant select, insert, update on veranstaltung to cse_app;
grant select on veranstaltung to cse_job;

-- ---------------------------------------------------------------------------
-- 9. app.planungsbedarf — Zweig 2 (04-PLANUNG-ZEIT.md §8.1, 0029 Abschnitt 13)
-- ---------------------------------------------------------------------------

/**
 * 0029 hat den `posten`-Zweig als `where false` hinterlassen, damit die
 * Spaltenliste und ihre Typen schon uebersetzt werden und PR 41 nur den Rumpf
 * einsetzt. Genau das geschieht hier — die SIGNATUR bleibt unberuehrt.
 *
 * `min_besetzung` ist die Spalte, die es nur auf diesem Zweig gibt: ein Posten
 * darf unter seine Mindestbesetzung nicht fallen, eine Reinigungsrunde kennt
 * den Begriff nicht.
 *
 * Der `veranstaltung`-Zweig bleibt `where false`, und das ist eine
 * Entscheidung: eine Veranstaltung ist EIN Fenster ohne RRULE, und der
 * Generator (`src/server/services/dienstplan/generator.ts`) zaehlt Regeln auf.
 * Sie hier einzuhaengen hiesse, dem Nachtlauf eine Zeile ohne Regel zu geben
 * und darauf zu hoffen, dass er sie versteht. SEC-08 laeuft stattdessen ueber
 * `services/security/eventbesetzung.ts`, der die Schichten SOFORT anlegt —
 * kurzfristig heisst kurzfristig, nicht „heute Nacht um drei".
 */
create or replace function app.planungsbedarf(p_mandant uuid, p_von date, p_bis date)
returns table (planungsserie_id uuid, quelle einsatz_quelle, carrier_id uuid,
               objekt_id uuid, revier_id uuid, posten_id uuid, veranstaltung_id uuid,
               auftrag_leistung_id uuid, rrule text, dtstart_lokal timestamp, zeitzone text,
               dauer_minuten integer, soll_besetzung smallint, min_besetzung smallint,
               feiertagsregel turnus_feiertagsregel, gueltig_ab date, gueltig_bis date)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if p_mandant is null then
    raise exception 'app.planungsbedarf ohne Mandant aufgerufen'
      using errcode = 'null_value_not_allowed',
            detail  = 'Der Generator laeuft je Mandant; ohne ihn waere die Antwort '
                      || 'mandantenuebergreifend.',
            hint    = 'job:turnus_generator ruft je Mandant einmal auf.';
  end if;
  if p_von is null or p_bis is null or p_bis < p_von then
    raise exception 'Das Planungsfenster ist leer oder verkehrt herum'
      using errcode = 'invalid_parameter_value',
            detail  = format('p_von = %s, p_bis = %s.', p_von, p_bis),
            hint    = 'p_bis muss auf oder nach p_von liegen.';
  end if;

  return query
    -- Zweig 1 — `turnus` (CLN-02), woertlich aus 0029.
    select ps.id,
           'turnus'::einsatz_quelle,
           t.id,
           r.objekt_id,
           t.revier_id,
           null::uuid,
           null::uuid,
           t.auftrag_leistung_id,
           t.rrule,
           t.dtstart_lokal,
           t.zeitzone,
           t.dauer_minuten,
           1::smallint,
           1::smallint,
           t.feiertagsregel,
           t.gueltig_ab,
           t.gueltig_bis
      from public.turnus t
      join public.revier r
        on r.id = t.revier_id
       and r.mandant_id = t.mandant_id
      left join public.planungsserie ps
        on ps.turnus_id = t.id
       and ps.mandant_id = t.mandant_id
       and ps.archiviert_am is null
     where t.mandant_id = p_mandant
       and t.archiviert_am is null
       and t.gueltig_ab <= p_bis
       and (t.gueltig_bis is null or t.gueltig_bis >= p_von)

    /**
     * Zweig 2 — `posten` (SEC-01). Der Rumpf, den 0029 angekuendigt hat.
     *
     * KEINE `feiertagsregel`: sie ist NULL und nicht `'ausfall'`. 0028 §8.5
     * sagt es ausdruecklich — fuer Posten und Veranstaltungen gibt es
     * bewusst keinen Vorgabewert, weil das stille Ueberspringen eines
     * Feiertags die Weihnachtsnacht UNBESETZT liesse. Die anlegende Seite
     * liest `app.einstellung('zeit.feiertage_ueberspringen_posten')`.
     *
     * Ein Posten OHNE `abdeckung_rrule` ist durchgehend besetzt (§6.3); er
     * kommt mit `rrule = null` und `dtstart_lokal = null` hier durch, und der
     * Generator entscheidet, was er daraus macht. Ihn hier auszufiltern
     * hiesse, den 24/7-Objektschutz aus der Planung zu nehmen — lautlos.
     */
    union all
    select ps.id,
           'posten'::einsatz_quelle,
           p.id,
           p.objekt_id,
           null::uuid,
           p.id,
           null::uuid,
           p.auftrag_leistung_id,
           p.abdeckung_rrule,
           p.dtstart_lokal,
           p.zeitzone,
           p.dauer_minuten,
           p.soll_besetzung,
           p.min_besetzung,
           null::turnus_feiertagsregel,
           p.gueltig_ab,
           p.gueltig_bis
      from public.posten p
      left join public.planungsserie ps
        on ps.posten_id = p.id
       and ps.mandant_id = p.mandant_id
       and ps.archiviert_am is null
     where p.mandant_id = p_mandant
       and p.archiviert_am is null
       and p.gueltig_ab <= p_bis
       and (p.gueltig_bis is null or p.gueltig_bis >= p_von)

    /**
     * Zweig 3 — `veranstaltung` (SEC-08). BLEIBT Platzhalter, siehe oben.
     * Die Spaltenliste steht, damit die Typen uebersetzt werden.
     */
    union all
    select null::uuid, 'veranstaltung'::einsatz_quelle, null::uuid,
           null::uuid, null::uuid, null::uuid, null::uuid,
           null::uuid, null::text, null::timestamp, null::text,
           null::integer, null::smallint, null::smallint,
           null::turnus_feiertagsregel, null::date, null::date
     where false;
end $$;

-- Der Zugriff bleibt, wie 0029 ihn gesetzt hat: NUR `cse_job`. Kein
-- `grant execute … to cse_app` — sie umgeht als Definer die Zeilenpolitik.
grant execute on function app.planungsbedarf(uuid, date, date) to cse_job;

comment on function app.planungsbedarf(uuid, date, date) is
  'Die eine Eingabe des Generators ueber beide Bedarfstraeger (04-PLANUNG-ZEIT.md '
  '§8.1). Seit 0069 liefern turnus UND posten Zeilen; veranstaltung bleibt '
  'where-false — SEC-08 legt seine Schichten sofort an, nicht im Nachtlauf.';

-- ---------------------------------------------------------------------------
-- 10. posten_unterbesetzung — die Dringlichkeitsabfrage (§6.3, SPEC §14)
-- ---------------------------------------------------------------------------

/**
 * Die eine Quelle fuer „dieser Posten ist nicht besetzt".
 *
 * §6.3 begruendet, warum die Mindestbesetzung KEINE Bedingung ist, und nennt
 * diese Sicht als die Stelle, an der sie sichtbar wird. Sie ist damit beides:
 * die Dringlichkeitsabfrage des Waechters (PR 82 haengt sich daran) UND die
 * Grundlage der Veroeffentlichungssperre im Dienst
 * (`services/security/posten.ts`). Zwei Abfragen fuer eine Aussage wuerden
 * beim ersten Eingriff auseinanderlaufen — und dann meldete der Waechter
 * etwas anderes als der Knopf, den der Planer drueckt.
 *
 * **`security_invoker = true`, und das ist keine Kosmetik.** Ohne dieses
 * Attribut laeuft eine Sicht mit den Rechten ihres EIGENTUEMERS: sie zeigte
 * jedem Aufrufer die Posten jeder Gesellschaft, und die Zeilenpolitik der
 * Basistabellen waere geraeuschlos ausgehebelt.
 *
 * Gezaehlt wird `einsatz.besetzt_anzahl` gegen `einsatz.min_besetzung` — die
 * Werte, die BEI DER PLANUNG galten, nicht die heutigen des Postens. Ein
 * spaeter angehobenes Minimum macht eine damals rechtmaessig besetzte Nacht
 * nicht rueckwirkend unterbesetzt; dieselbe Regel wie beim
 * Anforderungsschnappschuss (§9).
 */
create view posten_unterbesetzung with (security_invoker = true) as
  select e.mandant_id,
         e.id                as einsatz_id,
         e.posten_id,
         p.bezeichnung       as posten_bezeichnung,
         e.objekt_id,
         e.beginn_zeitpunkt,
         e.ende_zeitpunkt,
         e.min_besetzung,
         e.soll_besetzung,
         e.besetzt_anzahl,
         (e.min_besetzung - e.besetzt_anzahl)::smallint as fehlend
    from einsatz e
    join posten p on p.id = e.posten_id and p.mandant_id = e.mandant_id
   where e.posten_id is not null
     and e.storniert_am is null
     and e.status in ('geplant','laufend')
     and e.besetzt_anzahl < e.min_besetzung;

comment on view posten_unterbesetzung is
  'Postenschichten unter ihrer Mindestbesetzung (§6.3, SEC-01, SPEC §14). Eine '
  'Quelle fuer den Waechter UND fuer die Veroeffentlichungssperre; '
  'security_invoker, damit die Zeilenpolitik der Basistabellen gilt.';

grant select on posten_unterbesetzung to cse_app;
grant select on posten_unterbesetzung to cse_job;

-- ---------------------------------------------------------------------------
-- 11. Nachzutragen in `src/server/db/schema/rls.ts`
-- ---------------------------------------------------------------------------

/**
 * Der Block darunter ist die Ausgabe von `scripts/generate-triggers.ts` fuer
 * diese Migration; die Registrierung in `rls.ts` und in `MIGRATIONS_DATEIEN`
 * gehoert dazu. Ohne sie schlaegt `tests/kern/loeschsperre.test.ts` fehl —
 * und das ist die richtige Haelfte der Wahl: die Alternative waere eine
 * Tabelle dieser Domaene, die sich in einer Anweisung leeren laesst
 * (Invariante 8, §1.2).
 *
 * `AUDITIERT` bleibt fuer alle vier unberuehrt: §13.1 fuehrt keine von ihnen
 * unter `app.protokolliere()`. Ein Auditeintrag je Postenanlage ertraenkte
 * das Protokoll, auf das sich eine LEG-08-Auskunft stuetzt.
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0069)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- postenart (archiv): SEC-01, LEG-04. Die Postenart sagt, WOFUER ein Mensch eingeteilt war — Empfang, Streife, Objektschutz. Geloescht liesse sich einer vergangenen Besetzung nicht mehr ansehen, welche Taetigkeit sie war, und genau daran misst eine Aufsicht die Qualifikation. Eine aufgegebene Art bekommt `archiviert_am`.
create trigger trg_postenart_kein_hard_delete
  before delete on postenart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_postenart_kein_truncate
  before truncate on postenart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on postenart from cse_app, cse_anon, cse_checkin, cse_job;

-- posten (archiv): SEC-01, LEG-04, TIM-04. Der Posten ist das vertraglich Geschuldete: die Antwort darauf, ob eine Wachschicht stattfinden musste und mit welcher Mindestbesetzung. Geloescht stuende jede von ihm erzeugte Schicht ohne Grundlage da; ein beendeter Posten bekommt `gueltig_bis`, ein aufgegebener `archiviert_am`.
create trigger trg_posten_kein_hard_delete
  before delete on posten
  for each row execute function kern.verhindere_loeschung();
create trigger trg_posten_kein_truncate
  before truncate on posten
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on posten from cse_app, cse_anon, cse_checkin, cse_job;

-- posten_ausnahme (append): SEC-01, TIM-02, LEG-04. Sie ist die dokumentierte Abweichung samt Grund und Urheber — im Streit ueber eine unbesetzte Nacht genau die Zeile, die zaehlt. Eine Ausnahme, die sich loeschen laesst, ist keine Dokumentation; zurueckgenommen wird sie durch eine Gegenzeile.
create trigger trg_posten_ausnahme_kein_hard_delete
  before delete on posten_ausnahme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_posten_ausnahme_kein_truncate
  before truncate on posten_ausnahme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on posten_ausnahme from cse_app, cse_anon, cse_checkin, cse_job;

-- veranstaltung (archiv): SEC-08, LEG-04. Der Eventdienst traegt Kunde, Ort und Fenster einer kurzfristigen Bewachung; er ist der Traeger, an dem die § 34a-Anforderung fuer Einsaetze ohne festen Posten haengt. Geloescht saehe eine damals gepruefte Besetzung so aus, als habe nie eine Anforderung bestanden. Abgesagt heisst `archiviert_am`.
create trigger trg_veranstaltung_kein_hard_delete
  before delete on veranstaltung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_veranstaltung_kein_truncate
  before truncate on veranstaltung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on veranstaltung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_postenart_geaendert_am
  before update on postenart
  for each row execute function kern.setze_geaendert_am();
create trigger trg_posten_geaendert_am
  before update on posten
  for each row execute function kern.setze_geaendert_am();
create trigger trg_posten_ausnahme_geaendert_am
  before update on posten_ausnahme
  for each row execute function kern.setze_geaendert_am();
create trigger trg_veranstaltung_geaendert_am
  before update on veranstaltung
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
