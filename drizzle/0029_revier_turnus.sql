-- ===========================================================================
-- 0029 — Bedarfstraeger der Reinigung: revier, turnus, turnus_ausnahme
--        (CLN-01, CLN-02, CLN-03, CLN-05, TIM-02, TIM-03, OPS-02, OPS-07,
--        FIN-01, FIN-07, TEN-03)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §5.1, §5.3, §5.4
-- und `docs/architecture/02-datenmodell/04-PLANUNG-ZEIT.md` §8.1/§8.2/§8.5.
-- Wo dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die
-- Konvention.
--
-- 0028 hat den Generator gebaut und ihm keine Eingabe gegeben: `planungsserie`
-- verweist auf `turnus`, und die Tabelle gab es nicht. Diese Migration legt die
-- Reinigungsseite der beiden Bedarfstraeger an — den zweiten (`posten`,
-- Security) legt PR 41 an, und der Generator liest beide durch EINE Funktion
-- (§10.7).
--
--   revier           Die Arbeitszone in einem Objekt: die Flaeche, die EINE
--                    Reinigungskraft in EINEM Durchgang schafft, mit
--                    hinterlegter Sollzeit (§5.1). Sie ist die Einheit, die
--                    CLN-01 kalkuliert und gegen die der Dienstplan plant.
--   turnus           Die Wiederholungsregel: welche Leistung in welchem Revier
--                    nach welcher RRULE (§5.3). Der Bedarfstraeger — das
--                    vertraglich Geschuldete, nicht die Ausfuehrung.
--   turnus_ausnahme  Die dokumentierte Abweichung an EINEM Kalendertag:
--                    Ausfall, Zusatz, Verschiebung — jede mit Grund und
--                    Urheber (§5.4).
--
-- Vier Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **`revier_raum` entsteht hier NICHT.** Die Zuordnung Raumbuch → Revier
--     ist PR 40 (zusammen mit `sonderleistung`, `leistungsnachweis*`,
--     `reklamation`, `qualitaetspruefung`). `turnus` braucht sie nicht: die
--     Wiederholungsregel haengt am Revier, nicht an dessen Raeumen — und
--     `revier.sollzeit_minuten` steht als Zielgroesse schon auf dem Revier
--     selbst (§5.1). Sie hier vorzuziehen hiesse, die Kostenrechnung aus
--     OPS-07 ohne ihren Kalkulationsdienst anzulegen.
--
--  2. **`dtstart_lokal` ist `timestamp` OHNE Zeitzone.** Das ist die eine
--     dokumentierte Ausnahme von Invariante 2 (§10.1) und keine Nachlaessigkeit
--     — die Begruendung steht an der Spalte selbst. Wer sie „zurechtkorrigiert"
--     auf `timestamptz`, laesst die Kolonne ein halbes Jahr lang um 05:00 oder
--     07:00 antreten.
--
--  3. **Keine Aufbewahrungsspalten auf diesen drei Tabellen.** §1.14 vergibt
--     `aufbewahrung_bis`/`loeschsperre` an die BEWEISFUEHRENDEN Tabellen dieser
--     Domaene; §5.1/§5.3/§5.4 fuehren sie in ihren Spaltenlisten nicht. Die
--     Klasse `betrieb` (§11) ist offen (O-25). Sie „der Symmetrie mit 0028
--     zuliebe" mitzunehmen behauptete einen Loeschpfad fuer Stammdaten, den
--     kein Dokument beschreibt.
--
--  4. **Keine Ueberschneidungssperre ueber Turnusse eines Reviers.** Zwei
--     Turnusse duerfen dieselbe Zeit im selben Revier belegen — Unterhalts- und
--     Glasreinigung am selben Morgen ist der Normalfall (CLN-05), und TIM-04
--     verlangt beide Schichten einzeln sichtbar. Ueberschneidung wird ERKANNT
--     (04-PLANUNG-ZEIT.md §10.1), nie verhindert.
--
-- NICHT in dieser Migration, weil ihre Gegenstelle noch nicht existiert:
-- der Fremdschluessel auf `auftrag_leistung` (Abschnitt 7), die Zweige fuer
-- `posten` und `veranstaltung` in `app.planungsbedarf` (Abschnitt 9).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.1)
-- ---------------------------------------------------------------------------

/**
 * PROVISORISCH (§3.1). CLN-03 sagt, dass Feiertage ausgenommen sind — es sagt
 * nicht, was mit dem ausgefallenen Durchgang geschieht.
 *
 * Die zwei Werte sind, was der Generator heute unterscheiden muss: die Runde
 * faellt aus, oder sie findet unveraendert statt. `vorziehen`/`nachholen`
 * kaemen per `ALTER TYPE` dazu — sichtbar in einer Migration, und genau
 * deshalb ist das ein Aufzaehlungstyp und kein freier Text (K-17).
 * // TODO(client, O-145): Werden an Feiertagen ausgefallene Turnusse vorgezogen
 * oder nachgeholt, oder entfallen sie ersatzlos?
 */
create type turnus_feiertagsregel as enum ('ausfall','unveraendert');

/**
 * Die drei Arten der Einzelabweichung (§5.4).
 *
 * `ersatz_besetzung` fehlt hier mit Absicht: das ist die VIERTE Art aus
 * 04-PLANUNG-ZEIT.md §8.2 Nr. 3, und sie gehoert `posten_ausnahme` — eine
 * Reinigungsrunde hat keine Sollbesetzung, die man fuer eine Nacht absenken
 * koennte. `posten_ausnahme` (PR 41) benutzt denselben Typ (§6.4); ihn dort
 * ein zweites Mal zu erfinden waere zwei Vokabulare fuer eine Tatsache.
 */
create type turnus_ausnahme_art as enum ('ausfall','zusatz','verschiebung');

-- ---------------------------------------------------------------------------
-- 2. revier (§5.1)
-- ---------------------------------------------------------------------------

/**
 * Die Arbeitszone in einem Objekt.
 *
 * Ein Revier ist das, was EINE Reinigungskraft in EINEM Durchgang abarbeitet.
 * Diese Definition traegt zwei Dinge, die sonst frei erfunden werden muessten:
 * die Sollbesetzung einer Turnusschicht (eins — siehe `app.planungsbedarf`) und
 * die Bedeutung von `sollzeit_minuten` (die Dauer EINES Durchgangs, nicht die
 * eines Monats).
 */
create table revier (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  objekt_id     uuid not null,

  bezeichnung   text not null,
  -- Das Revierkuerzel auf dem ausgedruckten Plan („EG-N", „TH-3").
  kurzzeichen   text,
  beschreibung  text,

  /**
   * Die BERECHNETE Zielzeit eines Durchgangs, `numeric(8,2)` — die einzige
   * K-16(c)-Abweichung, die diese Domaene nimmt, und K-16(c) nennt genau diese
   * Spalte beim Namen.
   *
   * Sie ist `Σ m² ÷ Leistungswert` ueber die Raeume des Reviers. Auf ganze
   * Minuten gerundet summiert sich der Fehler ueber achtzig Raeume sichtbar
   * auf. Eine GEMESSENE Dauer ist dagegen `integer` und nie gebrochen — sie ist
   * Beweismittel (§1.1). Geschrieben wird der Wert vom Kalkulationsdienst
   * (OPS-07), nie von der Datenbank.
   */
  sollzeit_minuten numeric(8,2) not null, -- nicht-geld: Minuten je Durchgang

  -- Objektleiter. Haengt an der BESCHAEFTIGUNG, nicht am Menschen (D-09):
  -- die Verantwortung fuer ein Revier ist die einer bestimmten Gesellschaft.
  verantwortlich_anstellung_id uuid,

  /**
   * Der Abrechnungsanker (FIN-07). SPALTE OHNE FREMDSCHLUESSEL — `auftrag_leistung`
   * existiert noch nicht (Abschnitt 7).
   */
  auftrag_leistung_id uuid,

  -- Vertraglicher Beginn und Ende der Zone. `date`, nicht `timestamptz`: das
  -- sind Berliner Kalendertage, keine Zeitpunkte (K-11).
  aktiv_ab      date not null,
  aktiv_bis     date,

  sortierung    smallint not null default 0,

  -- Die EINE Lebendigkeitsspalte (§1.3). Stammdaten werden archiviert, nie
  -- storniert — und nie beides.
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
  constraint revier_mandant_uk unique (mandant_id, id),

  constraint revier_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint revier_verantwortlich_fk foreign key (mandant_id, verantwortlich_anstellung_id)
    references anstellung (mandant_id, id),

  constraint revier_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint revier_sollzeit_positiv check (sollzeit_minuten > 0),
  -- Einschliessend (§1.1): ein Revier, das am 31.12. endet, ist an diesem Tag
  -- noch zu reinigen.
  constraint revier_aktiv_fenster check (aktiv_bis is null or aktiv_bis >= aktiv_ab),
  constraint revier_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- „Alle lebenden Reviere eines Objekts, in Anzeigereihenfolge" — die
-- Objektakte und der TIM-03-Generator.
create index revier_objekt_idx on revier (mandant_id, objekt_id, sortierung)
  where archiviert_am is null;

/**
 * Eindeutig je Objekt — und PARTIELL (§1.3).
 *
 * Ein archiviertes Revier darf seine Bezeichnung und sein Kuerzel nicht auf
 * Dauer belegen: wird ein Gebaeudeteil neu zugeschnitten, heisst die neue Zone
 * legitim wieder „EG-Nord". Eine unbedingte Eindeutigkeit macht genau diesen
 * Fall uneintragbar.
 */
create unique index revier_bezeichnung_uk on revier (objekt_id, lower(bezeichnung))
  where archiviert_am is null;
create unique index revier_kurzzeichen_uk on revier (objekt_id, kurzzeichen)
  where archiviert_am is null and kurzzeichen is not null;

create index revier_auftrag_idx on revier (mandant_id, auftrag_leistung_id)
  where auftrag_leistung_id is not null;

comment on table revier is
  'Arbeitszone in einem Objekt (§5.1): die Flaeche, die eine Reinigungskraft in '
  'einem Durchgang abarbeitet. Einheit der CLN-01-Kalkulation und Planungsziel '
  'des Dienstplans.';
comment on column revier.sollzeit_minuten is
  'BERECHNETE Zielzeit je Durchgang, numeric(8,2) — die K-16(c)-Abweichung, die '
  'K-16 namentlich erlaubt. Keine gemessene Dauer; die waere integer.';

-- ---------------------------------------------------------------------------
-- 3. turnus (§5.3)
-- ---------------------------------------------------------------------------

/**
 * Der Reinigungsturnus: welche Leistung in welchem Revier nach welcher Regel.
 *
 * Er ist ein BEDARFSTRAEGER — das vertraglich Geschuldete —, nicht die
 * Ausfuehrung. Die Ausfuehrungsspur ist `planungsserie` (0028), und dass beide
 * getrennt sind, ist die Entscheidung aus §2.3 Nr. 3: der Planer bearbeitet die
 * Regel dort, wo der Vertrag liegt, und der Generator protokolliert dort, wo
 * sein Fortschritt steht.
 *
 * Warum `turnus` und `posten` NICHT eine Tabelle sind (§10.7): ein Turnus
 * schuldet eine Frequenz mit einer Leistung und einer Dauer je Durchgang, ein
 * Posten eine besetzte Position mit Soll- und Mindestbesetzung und einer
 * Dienstanweisung. Zusammengelegt traegt jede Zeile vier immer-NULL-Spalten,
 * und die Acht-Wochen-Buchhaltung aus TIM-03 wird mehrdeutig.
 */
create table turnus (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  revier_id     uuid not null,
  -- Glas, Sonderreinigung und Warenraeumung sind KATALOGZEILEN, kein
  -- Aufzaehlungstyp (CLN-05): der Kunde bestellt aus dem Leistungskatalog, und
  -- eine neue Leistungsart darf keine Migration kosten.
  leistungskatalog_position_id uuid not null,

  /**
   * Der Abrechnungsanker (FIN-01, FIN-07). SPALTE OHNE FREMDSCHLUESSEL —
   * `auftrag_leistung` existiert noch nicht (Abschnitt 7).
   *
   * `auftrag_leistung_id`, nicht `auftrag_id`: ein Auftrag traegt mehrere
   * Leistungszeilen mit verschiedenen Abrechnungsarten, und ein Turnus haengt
   * an genau einer davon (02-CRM-OPERATIONS.md §3.2).
   */
  auftrag_leistung_id uuid,

  bezeichnung   text not null,

  /**
   * RFC 5545 RRULE OHNE DTSTART und OHNE TZID, z. B. `FREQ=WEEKLY;BYDAY=MO,WE,FR`
   * (CLN-02). Die Anker stehen in ihren eigenen Spalten darunter.
   *
   * KEIN Formregulaerausdruck `^FREQ=…` (§5.3, §8.2 Nr. 2): RFC 5545 legt die
   * Reihenfolge der Teile nicht fest, `INTERVAL=2;FREQ=WEEKLY;BYDAY=MO` ist
   * gueltig — eine solche Bedingung wiese es zurueck. Vollstaendig geprueft
   * wird die Regel im getesteten Parser `src/lib/datum/rrule.ts`, demselben,
   * den der Generator zum Aufzaehlen benutzt.
   */
  rrule         text not null,

  /**
   * Der Wanduhr-Anker, `timestamp` OHNE Zeitzone. Die dokumentierte Ausnahme
   * von Invariante 2 (§10.1) — und der Grund steht hier, damit sie niemand
   * „korrigiert".
   *
   * Eine Wiederholungsregel ist kein Zeitpunkt, sondern eine Aussage ueber die
   * Wanduhr: „montags um 06:00" bleibt am 30. Maerz 06:00. Speichert man
   * `dtstart` als `timestamptz` und zaehlt die RRULE in UTC auf, ruecken alle
   * Vorkommnisse nach der Umstellung um eine Stunde — die Kolonne tritt ein
   * halbes Jahr lang um 05:00 oder 07:00 an. Im Sommer faellt das niemandem
   * auf, im Winter kostet es Vertragsstrafen.
   *
   * Die ERZEUGTEN Vorkommnisse sind wieder `timestamptz` in UTC
   * (`einsatz.beginn_zeitpunkt`, 0028), und die Dauer ist die Differenz zweier
   * UTC-Zeitpunkte — genau deshalb ergeben die Umstellungsnaechte 420 und 540
   * Minuten (K-11).
   */
  dtstart_lokal timestamp not null,
  -- IANA-Zone, GESPEICHERT statt angenommen: ein Objekt in Brandenburg erbt
  -- Berlin nicht stillschweigend.
  zeitzone      text not null default 'Europe/Berlin',

  -- RFC 5545 DURATION statt DTEND. Eine GEMESSENE Dauer waere das hier nicht —
  -- es ist die geplante Dauer eines Durchgangs, und beide sind `integer`
  -- Minuten (K-16). Geld gibt es in dieser Tabelle nicht.
  dauer_minuten integer not null,

  /**
   * CLN-03, aufgeloest gegen die Tabelle `feiertag` (0028).
   *
   * `default 'ausfall'` ist DOKUMENTIERT (§5.3) und deshalb uebernommen — nicht
   * geraten. Es ist zugleich der Wert, den `planungsserie.feiertage_ueberspringen`
   * fuer einen Turnus liefert; fuer `posten` und `veranstaltung` gibt es
   * bewusst keinen Default (0028, §8.5), weil dort das stille Ueberspringen die
   * Weihnachtsnacht unbesetzt liesse.
   *
   * WELCHES Land den Feiertag stellt, entscheidet diese Spalte nicht: die
   * Aufloesung `objekt.bundesland` → `app.einstellung('zeit.feiertag_bundesland')`
   * → `'BE'` steht bei Anlage der `planungsserie` (§8.5), und `objekt` traegt
   * heute kein `bundesland` (§2.3 Nr. 3). Solange das so ist, faellt ein
   * Turnus an einem Brandenburger Objekt nach BERLINER Kalender aus — am
   * Reformationstag also nicht. Aus der Postleitzahl auf das Land zu schliessen
   * waere eine erfundene Regel (K-17).
   * // TODO(client, O-167): Arbeitet die Gruppe an Objekten ausserhalb Berlins,
   * und in welchen Bundeslaendern? Davon haengt ab, welcher Feiertagskalender
   * einen Turnus ausfallen laesst.
   */
  feiertagsregel turnus_feiertagsregel not null default 'ausfall',

  gueltig_ab    date not null,
  -- Einschliessend: ein Turnus, der am 31.12. endet, wird an diesem Tag noch
  -- geplant.
  gueltig_bis   date,

  /**
   * Generatorbuchhaltung (TIM-03, acht Wochen).
   *
   * ZWEI Dokumente fuehren dieselbe Auskunft: `planungsserie.generiert_bis`
   * (04-PLANUNG-ZEIT.md §5.2, 0028) ist die Ausfuehrungsspur, diese Spalte
   * nennt §5.3 samt dem Index darauf. Beide bleiben stehen, weil beide benannt
   * sind — aber sie sind ZWEI Zaehler fuer eine Tatsache, und der Generator
   * muss sie in derselben Transaktion fortschreiben. Eine davon „der Sauberkeit
   * zuliebe" zu streichen, nimmt der jeweils anderen Seite ihren Index.
   */
  letzte_generierung_bis date,

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
  constraint turnus_mandant_uk unique (mandant_id, id),

  constraint turnus_revier_fk foreign key (mandant_id, revier_id)
    references revier (mandant_id, id),
  constraint turnus_leistung_fk foreign key (mandant_id, leistungskatalog_position_id)
    references leistungskatalog_position (mandant_id, id),

  constraint turnus_dauer_positiv check (dauer_minuten > 0),
  constraint turnus_zeitzone_gefuellt check (zeitzone <> ''),
  -- Anker gehoeren in ihre eigenen Spalten. Eine RRULE mit eingebautem DTSTART
  -- oder TZID traegt eine zweite Zeitrechnung neben `dtstart_lokal`/`zeitzone`
  -- — und der Parser wuesste nicht, welche gilt.
  constraint turnus_rrule_ohne_anker check (
    rrule !~ 'DTSTART' and rrule !~ 'TZID' and rrule !~ 'RRULE:'),
  constraint turnus_gueltig_fenster check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  constraint turnus_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * Die treibende Abfrage des Generators — OHNE `current_date`-Konjunkt.
 *
 * Der Entwurf hatte hier `and (gueltig_bis is null or gueltig_bis >= current_date)`
 * stehen. PostgreSQL weist das rundheraus zurueck („functions in index predicate
 * must be marked IMMUTABLE"), die Migration schluege fehl, und der Index, auf
 * dem der naechtliche Lauf steht, existierte nicht (§1.13, review B7). Er waere
 * auch semantisch falsch: ein Praedikat auf „heute" muesste jede Mitternacht neu
 * gebaut werden.
 *
 * Die Zeitgrenze steht deshalb im `WHERE` von `app.planungsbedarf` (Abschnitt 9),
 * wo eine bewegliche Grenze hingehoert.
 */
create index turnus_generator_idx on turnus (mandant_id, letzte_generierung_bis)
  where archiviert_am is null;

create index turnus_revier_idx on turnus (mandant_id, revier_id)
  where archiviert_am is null;
-- „Wo wird Glas gereinigt?" (CLN-05) — unpartiell, weil auch der beendete
-- Turnus die Frage beantwortet, welche Leistung dort einmal geschuldet war.
create index turnus_leistung_idx on turnus (mandant_id, leistungskatalog_position_id);

comment on table turnus is
  'Reinigungsturnus (§5.3): Leistung, Revier und RFC-5545-Regel. Bedarfstraeger, '
  'nicht Ausfuehrung — die Ausfuehrungsspur ist planungsserie (0028).';
comment on column turnus.dtstart_lokal is
  'Wanduhr-Anker OHNE Zeitzone — die dokumentierte Ausnahme von Invariante 2 '
  '(§10.1). Als timestamptz gespeichert und in UTC aufgezaehlt, arbeitet die '
  'Kolonne nach der Zeitumstellung ein halbes Jahr um eine Stunde versetzt.';
comment on column turnus.letzte_generierung_bis is
  'Generatorbuchhaltung je Bedarfstraeger (§5.3). Zweite Auskunft neben '
  'planungsserie.generiert_bis (§5.2) — beide sind benannt, beide muessen in '
  'derselben Transaktion fortgeschrieben werden.';

-- ---------------------------------------------------------------------------
-- 4. turnus_ausnahme (§5.4)
-- ---------------------------------------------------------------------------

/**
 * Die dokumentierte Abweichung an EINEM Kalendertag.
 *
 * Sie gehoert dem BEDARFSTRAEGER, nicht der Ausfuehrungsspur: `planungsserie_ausnahme`
 * gibt es deshalb nicht (04-PLANUNG-ZEIT.md §0). Zwei Ausnahmetabellen hiessen
 * zwei Antworten auf „ist die Reinigung am 3. Oktober ausgefallen", und der
 * Generator muesste sie versoehnen.
 *
 * KEINE Lebendigkeitsspalte, und das ist keine Auslassung: §5.4 fuehrt in seiner
 * Spaltenliste weder `archiviert_am` noch `storniert_am`, und §1.3 ordnet die
 * Tabelle keiner der beiden Klassen zu. Zusammen mit der Loeschsperre unten
 * heisst das: eine eingetragene Ausnahme bleibt stehen. Eine falsch eingetragene
 * wird korrigiert, indem der Grund fortgeschrieben wird — nicht durch eine
 * Spalte, die kein Dokument beschreibt. (Die Frage, wie eine Ausnahme
 * ZURUECKGENOMMEN wird, ist in den Quellen offen und traegt keine O-Nummer;
 * sie gehoert in die naechste DECISIONS-Runde, nicht in eine erfundene Spalte.)
 */
create table turnus_ausnahme (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  turnus_id     uuid not null,

  -- Der betroffene BERLINER Kalendertag des Vorkommnisses (K-11, §1.12).
  -- Abgeleitet als `(<zeitpunkt> at time zone 'Europe/Berlin')::date`, nie als
  -- `(<zeitpunkt>)::date` — sonst faellt die Nachtschicht auf den Vortag.
  datum         date not null,
  art           turnus_ausnahme_art not null,

  -- Nur bei `verschiebung`. Wanduhr, wie `turnus.dtstart_lokal` und aus
  -- demselben Grund (§10.1).
  ersatz_beginn_lokal timestamp,
  -- Nur bei `zusatz`/`verschiebung`; sonst erbt das Vorkommnis die Dauer des
  -- Turnus. `integer` Minuten (K-16) — Geld gibt es hier nicht.
  dauer_minuten integer,

  -- Ein EXDATE ohne Begruendung ist wertlos: die Frage im Streitfall lautet
  -- nicht „ist ausgefallen", sondern „warum".
  grund         text not null,

  /**
   * NULL heisst UNBEANTWORTET, nicht „nein".
   * // TODO(client, O-146): Wird ein ausgefallener Turnus bei Monatspauschale
   * gutgeschrieben, und mit welchem Betrag? (FIN-01)
   *
   * Solange die Frage offen ist, leitet KEIN Job und kein Dienst aus dieser
   * Spalte eine Gutschrift ab. Ein Default `false` waere die stillschweigende
   * Antwort „es wird nie gutgeschrieben" — eine Geschaeftsentscheidung, die
   * niemand getroffen hat (K-17).
   */
  abrechnungsrelevant boolean,

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
  constraint turnus_ausnahme_mandant_uk unique (mandant_id, id),

  constraint turnus_ausnahme_turnus_fk foreign key (mandant_id, turnus_id)
    references turnus (mandant_id, id),

  constraint turnus_ausnahme_verschiebung_braucht_beginn check (
    art <> 'verschiebung' or ersatz_beginn_lokal is not null),
  -- Dieselbe physikalische Schranke wie auf `turnus.dauer_minuten`; keine
  -- Geschaeftsregel, sondern die Feststellung, dass ein Durchgang von null
  -- Minuten keiner ist.
  constraint turnus_ausnahme_dauer_positiv check (dauer_minuten is null or dauer_minuten > 0),
  constraint turnus_ausnahme_grund_gefuellt check (btrim(grund) <> ''),
  constraint turnus_ausnahme_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * Ein Tag kann EINMAL abgesagt und EINMAL verschoben werden — Zusaetze sind
 * unbegrenzt.
 *
 * Der Entwurf hatte `unique (turnus_id, datum, art)`, was auch nur EINEN
 * `zusatz` je Tag zuliess. Zwei Sonderreinigungen an einem Tag (morgens und
 * abends) sind in der Unterhaltsreinigung der Normalfall; die enge Fassung
 * machte den Normalfall uneintragbar.
 */
create unique index turnus_ausnahme_uk on turnus_ausnahme (turnus_id, datum)
  where art in ('ausfall','verschiebung');

-- Der Generator liest alle Ausnahmen des Fensters in EINEM Durchgang (§8.2
-- Nr. 3), nicht je Turnus einzeln.
create index turnus_ausnahme_datum_idx on turnus_ausnahme (mandant_id, datum);

comment on table turnus_ausnahme is
  'Einzelabweichung eines Turnus an einem Berliner Kalendertag (§5.4). Gehoert '
  'dem Bedarfstraeger, nicht der Ausfuehrungsspur — planungsserie_ausnahme gibt '
  'es deshalb nicht.';
comment on column turnus_ausnahme.abrechnungsrelevant is
  'NULL = unbeantwortet (O-146). Kein Job leitet daraus eine Gutschrift ab; ein '
  'Default false waere die stille Antwort "nie gutschreiben".';

-- ---------------------------------------------------------------------------
-- 5. Fremdschluessel, die 0028 hier abgeholt hat
-- ---------------------------------------------------------------------------

/**
 * 0028 Abschnitt 6 hat zehn Fremdschluessel als Text hinterlegt, weil ihre
 * Elternteile fehlten. DREI davon werden jetzt faellig — genau die, deren
 * Gegenstelle diese Migration anlegt:
 *
 *   `revier`  → einsatz_revier_fk
 *   `turnus`  → ps_turnus_fk, einsatz_turnus_fk
 *
 * Die uebrigen sieben bleiben offen und bleiben in 0028 dokumentiert:
 * `posten` und `veranstaltung` kommen mit PR 41, `sonderleistung` mit PR 40,
 * `projekt` mit der Bau-Domaene, `auftrag_leistung` mit der Luecke aus PR 27
 * (Abschnitt 7). Ein einspaltiger Ersatz-Fremdschluessel waere nach K-16 ein
 * Pruefungsfehler — er liesse eine Schicht der Reinigung an einem Turnus der
 * Security haengen. Lieber gar keiner als der falsche.
 */
alter table planungsserie add constraint ps_turnus_fk
  foreign key (mandant_id, turnus_id) references turnus (mandant_id, id);

alter table einsatz add constraint einsatz_turnus_fk
  foreign key (mandant_id, turnus_id) references turnus (mandant_id, id);

-- `revier_id` steht auf `einsatz` NEBEN dem Gewerketraeger und zaehlt in
-- `einsatz_ein_traeger` nicht mit: eine Turnusschicht nennt zusaetzlich ihre
-- Zone (CLN-01, 0028 §5.3).
alter table einsatz add constraint einsatz_revier_fk
  foreign key (mandant_id, revier_id) references revier (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 6. Zusammengesetzte Fremdschluessel dieser Migration (§12)
-- ---------------------------------------------------------------------------

/**
 * Vollstaendig, damit der Schema-Test aus §12 sie findet:
 *
 *   revier (mandant_id, objekt_id)                    → objekt (mandant_id, id)
 *   revier (mandant_id, verantwortlich_anstellung_id) → anstellung (mandant_id, id)
 *   turnus (mandant_id, revier_id)                    → revier (mandant_id, id)
 *   turnus (mandant_id, leistungskatalog_position_id) → leistungskatalog_position (mandant_id, id)
 *   turnus_ausnahme (mandant_id, turnus_id)           → turnus (mandant_id, id)
 *
 * Jeder ist zusammengesetzt, keiner einspaltig: ein einspaltiger Fremdschluessel
 * in eine Tabelle mit `mandant_id` liesse ein Kind entstehen, das zu einem
 * anderen Mandanten gehoert als sein Elternteil — und RLS faende daran nichts
 * auszusetzen, weil beide Zeilen fuer sich stimmig sind (§1.4).
 */

-- ---------------------------------------------------------------------------
-- 7. Fremdschluessel, die eine spaetere Migration nachtraegt
-- ---------------------------------------------------------------------------

/**
 * `auftrag_leistung` existiert nicht — die Luecke aus PR 27: 0025 legt
 * `auftrag` an, die Leistungszeilen darunter fehlen (02-CRM-OPERATIONS.md §3.2).
 * `revier.auftrag_leistung_id` und `turnus.auftrag_leistung_id` stehen deshalb
 * als Spalte da, ohne Schluessel. Wortwoertlich diese Anweisungen, NACHZUTRAGEN
 * IN DER MIGRATION, DIE `auftrag_leistung` ANLEGT (§12):
 *
 *   alter table revier add constraint revier_auftrag_leistung_fk
 *     foreign key (mandant_id, auftrag_leistung_id)
 *     references auftrag_leistung (mandant_id, id);
 *   alter table turnus add constraint turnus_auftrag_leistung_fk
 *     foreign key (mandant_id, auftrag_leistung_id)
 *     references auftrag_leistung (mandant_id, id);
 *
 * Beide verlangen `unique (mandant_id, id)` auf `auftrag_leistung` (§2.1).
 * Bis dahin gilt: der Abrechnungsanker ist eine Behauptung, die niemand prueft
 * — FIN-07 haengt an ihm, und deshalb steht er hier als Schuld und nicht als
 * stillschweigende Auslassung.
 */

-- ---------------------------------------------------------------------------
-- 8. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * Der Archivierungszeitpunkt gehoert dem Server (Invariante 5, §1.11).
 *
 * §1.11 ordnet `kern.erzwinge_serverzeit()` „jedem `storniert_am` und
 * `archiviert_am"` zu. Die Funktion selbst ist aber auf die Spalte
 * `eingegangen_am` festgeschrieben und nimmt keinen Spaltennamen als Argument —
 * dieselbe Lage, in der 0017 `kern.erzwinge_serverzeit_geschehen()` und 0028
 * `kern.planungsserie_zeitstempel()` danebengestellt haben.
 *
 * EINE Funktion fuer beide Tabellen, nicht zwei: die Spalte heisst hier wie
 * dort `archiviert_am`, und zwei gleiche Koerper driften beim ersten Eingriff
 * auseinander.
 *
 * Gestempelt wird nur der UEBERGANG nach „gesetzt". Ein `DEFAULT now()` griffe
 * nur, wenn die Spalte weggelassen wird; ein INSERT oder UPDATE, der einen Wert
 * mitschickt, schriebe sonst einen beliebigen Zeitpunkt — und die Frage „seit
 * wann ist dieses Revier stillgelegt" ist im Streit um eine nicht erbrachte
 * Leistung genau die Frage.
 */
create function kern.archivierung_stempeln() returns trigger
language plpgsql as $$
begin
  -- Der INSERT-Zweig zuerst, und er kehrt zurueck: `old` ist hier nicht
  -- zugewiesen, und schon eine Bedingung, die ein Feld davon NENNT, wirft —
  -- auch wenn der andere Zweig einer ODER-Verknuepfung sie erledigt haette.
  -- Dieselbe Bauart wie kern.planungsserie_zeitstempel() in 0028.
  if tg_op = 'INSERT' then
    if new.archiviert_am is not null then new.archiviert_am := now(); end if;
    return new;
  end if;

  if new.archiviert_am is not null and old.archiviert_am is null then
    new.archiviert_am := now();
  end if;
  return new;
end $$;

create trigger trg_revier_archivierung
  before insert or update on revier
  for each row execute function kern.archivierung_stempeln();

create trigger trg_turnus_archivierung
  before insert or update on turnus
  for each row execute function kern.archivierung_stempeln();

-- `turnus_ausnahme` bekommt keinen: sie hat keine Lebendigkeitsspalte, die zu
-- stempeln waere (Abschnitt 4).

-- ---------------------------------------------------------------------------
-- 9. Zeilenschutz — revier
-- ---------------------------------------------------------------------------

alter table revier enable row level security;
alter table revier force  row level security;

create policy t_mandant on revier for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('reinigung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('reinigung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on revier for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.reinigung.lesen')));

/**
 * Die Decke aus §1.8: `p_intern_ceiling` — in diesem Baum seit 0021/0022/0023
 * `p_intern_decke` geschrieben, mit demselben Koerper.
 *
 * RESTRICTIVE, weil eine zweite permissive Regel ODER-verknuepft wuerde: ein
 * Loch statt einer Decke.
 *
 * Warum das Revier weder dem Mitarbeiter- noch dem Kundenportal offensteht:
 * `sollzeit_minuten` ist die Kalkulationsgrundlage aus CLN-01. Im Kundenportal
 * ist sie Verhandlungsstoff gegen uns — sie sagt, mit wie viel Zeit wir
 * kalkuliert haben. Im Mitarbeiterportal ist sie eine Leistungsvorgabe je
 * Person, und die waere nach §87 Abs. 1 Nr. 6 BetrVG mitbestimmungspflichtig,
 * bevor sie jemand zu sehen bekommt. Die Reinigungskraft sieht ihre SCHICHT
 * (`einsatz`, 0028), nicht das Muster und nicht dessen Zeitansatz.
 */
create policy p_intern_decke on revier as restrictive for all to cse_app
  using (app.portal() = 'intern');

/**
 * Der naechtliche Generator laeuft als `cse_job`, ohne Sitzung.
 *
 * `FORCE ROW LEVEL SECURITY` gilt auch fuer ihn: ohne eigene Policy liest er
 * null Zeilen — und zwar OHNE Fehler. Der Lauf meldete dann „0 Schichten
 * erzeugt" und saehe aus wie ein Betrieb ohne Reinigungsauftrag.
 *
 * NUR lesend. Ein Revier anzulegen oder stillzulegen ist eine Planungs-
 * entscheidung, kein Nachtlauf.
 */
create policy t_job on revier for select to cse_job using (true);

grant select, insert, update on revier to cse_app;
grant select on revier to cse_job;

-- ---------------------------------------------------------------------------
-- 10. Zeilenschutz — turnus
-- ---------------------------------------------------------------------------

alter table turnus enable row level security;
alter table turnus force  row level security;

create policy t_mandant on turnus for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('reinigung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('reinigung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on turnus for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.reinigung.lesen')));

create policy p_intern_decke on turnus as restrictive for all to cse_app
  using (app.portal() = 'intern');

/**
 * Der Generator liest den Bedarfstraeger und schreibt GENAU EINE Spalte
 * zurueck: seinen eigenen Fortschritt.
 *
 * Der Spalten-Grant darunter ist die eigentliche Schranke — die Policy sagt nur,
 * WELCHE ZEILEN. Ohne ihn duerfte ein Nachtlauf `gueltig_bis` oder `rrule`
 * fortschreiben, also den Vertrag aendern, den er ausfuehren soll.
 */
create policy t_job on turnus for select to cse_job using (true);
create policy t_job_fortschritt on turnus for update to cse_job
  using (true) with check (true);

grant select, insert, update on turnus to cse_app;
grant select on turnus to cse_job;
grant update (letzte_generierung_bis) on turnus to cse_job;

-- ---------------------------------------------------------------------------
-- 11. Zeilenschutz — turnus_ausnahme
-- ---------------------------------------------------------------------------

alter table turnus_ausnahme enable row level security;
alter table turnus_ausnahme force  row level security;

create policy t_mandant on turnus_ausnahme for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('reinigung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('reinigung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on turnus_ausnahme for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.reinigung.lesen')));

create policy p_intern_decke on turnus_ausnahme as restrictive for all to cse_app
  using (app.portal() = 'intern');

/**
 * Lesend fuer den Generator. Er wandelt die Ausnahmen in EXDATE/RDATE der
 * serialisierten VEVENT-Darstellung um (§5.4, §8.2 Nr. 3) — deshalb muss er sie
 * sehen, und deshalb schreibt er sie nicht: eine Ausnahme traegt einen Grund und
 * einen Urheber, und beides hat ein Nachtlauf nicht.
 */
create policy t_job on turnus_ausnahme for select to cse_job using (true);

grant select, insert, update on turnus_ausnahme to cse_app;
grant select on turnus_ausnahme to cse_job;

-- ---------------------------------------------------------------------------
-- 12. Der Lesepfad des Definers (§1.10)
-- ---------------------------------------------------------------------------

/**
 * `app.planungsbedarf` ist `security definer` — und ein Definer ist unter
 * `FORCE ROW LEVEL SECURITY` NICHT ausgenommen (§1.5).
 *
 * §1.10 sagt den Grundsatz: „A definer function must be able to read every
 * table it touches" — ohne Policy liest sie null Zeilen UND MELDET KEINEN
 * FEHLER, der Generator plant nichts, und der Lauf sieht aus wie ein
 * Feiertagsmonat. Die Aufzaehlung der gelesenen Tabellen in §1.10 nennt
 * `turnus`, `revier` und `planungsserie` nicht — eine Luecke im Dokument, denn
 * die Funktion, die dieselbe Tabelle zwei Zeilen weiter oben definiert, liest
 * genau diese drei.
 *
 * Also: der Grundsatz gilt, die drei Policies stehen hier. Sie sind
 * ausschliesslich lesend und ausschliesslich fuer `cse_definer` — kein
 * `BYPASSRLS`, keine Rollenausnahme, kein vierter Mechanismus.
 *
 * `planungsserie` gehoert 04-PLANUNG-ZEIT.md; dessen §1.1 fuehrt eine
 * geschlossene Liste der `cse_definer`-Policies und nennt sie dort noch nicht.
 * Das ist als Nachtrag zu registrieren — der Lesepfad hier ohne Policy zu lassen
 * waere die schlechtere Haelfte der Wahl: still null Zeilen statt eines
 * benannten Widerspruchs.
 */
grant select on revier, turnus, planungsserie to cse_definer;

create policy d_planungsbedarf on revier for select to cse_definer using (true);
create policy d_planungsbedarf on turnus for select to cse_definer using (true);
create policy d_planungsbedarf on planungsserie for select to cse_definer using (true);

-- ---------------------------------------------------------------------------
-- 13. app.planungsbedarf (04-PLANUNG-ZEIT.md §8.1)
-- ---------------------------------------------------------------------------

/**
 * Die EINE Eingabe des Generators ueber beide Bedarfstraeger (§10.7).
 *
 * ZWEI Dokumente nennen zwei Signaturen, und die maszgebliche ist die des
 * Dokuments, dem der Generator gehoert: 04-PLANUNG-ZEIT.md §8.1 mit
 * `(p_mandant, p_von, p_bis)` und siebzehn Rueckgabespalten. 03-GEWERKE.md
 * §1.10 fuehrt eine aeltere Fassung `(p_von, p_bis)` mit neun Spalten, die
 * bereits aufgeloeste Zeitpunkte zurueckgibt — die kann nicht stimmen: das
 * Aufloesen der Ortszeit in Zeitpunkte ist Schritt 5 des Algorithmus (§8.2) und
 * geschieht im getesteten Parser, nicht in SQL.
 *
 * WARUM der Mandant ein ARGUMENT ist und nicht `app.aktiver_mandant()`: um drei
 * Uhr nachts gibt es keine Sitzung. Ein Aufruf, der den Mandanten aus der
 * Sitzung liest, bekaeme NULL, `mandant_id = NULL` ist nie wahr, und der
 * Generator plante lautlos gar nichts.
 *
 * `stable`, damit der Planer sie einmal je Anweisung aufruft und nicht je Zeile.
 * `set search_path` woertlich, weil ein unqualifizierter Suchpfad auf einer
 * Definer-Funktion ein Weg zur Rechteausweitung ist (K-01) — deshalb ist jede
 * Tabelle im Koerper `public.` qualifiziert.
 *
 * VOLLE Spaltenliste ab heute, obwohl nur ein Zweig Zeilen liefert. PR 41
 * ergaenzt dann einen `union all`-Zweig und aendert KEINE Signatur — eine
 * spaeter geaenderte Signatur hiesse `drop function` und `create` in einer
 * Migration, und in dem Moment dazwischen gibt es den Generator nicht.
 */
create function app.planungsbedarf(p_mandant uuid, p_von date, p_bis date)
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
    /**
     * Zweig 1 — `turnus` (CLN-02).
     *
     * `gueltig_bis is null or gueltig_bis >= p_von` steht HIER und nicht im
     * Indexpraedikat: eine bewegliche Grenze im Index waere nicht IMMUTABLE,
     * PostgreSQL lehnte den Index ab, und die Migration schluege fehl (§5.3,
     * §1.13). `gueltig_ab <= p_bis` schneidet umgekehrt die Turnusse ab, die
     * erst nach dem Fenster beginnen.
     *
     * `soll_besetzung`/`min_besetzung` sind 1 — abgeleitet, nicht erfunden:
     * §5.1 definiert das Revier als die Flaeche, die EINE Reinigungskraft in
     * EINEM Durchgang abarbeitet. Eine Besetzungsspalte hat `turnus` deshalb
     * nicht; sie waere die Postenlogik aus SEC-01, in die falsche Domaene
     * kopiert.
     *
     * `planungsserie` ist LEFT gejoint: ein frisch angelegter Turnus hat noch
     * keine Ausfuehrungsspur — der Generator legt sie im selben Lauf an. Ein
     * innerer Join liesse genau die neuen Turnusse aus, und zwar geraeuschlos.
     *
     * KEIN `r.archiviert_am is null`: ob ein stillgelegtes Revier weiter
     * geplant wird, entscheidet der Turnus ueber sein eigenes `archiviert_am`
     * und sein `gueltig_bis`. Die Bedingung hier zu ergaenzen hiesse, die
     * Planung fuer eine Zone still einzustellen, deren Turnus noch laeuft — und
     * das Ausbleiben der Schichten saehe aus wie ein Generatorfehler.
     */
    select ps.id,
           'turnus'::einsatz_quelle,
           t.id,
           r.objekt_id,
           t.revier_id,
           null::uuid,                       -- posten_id
           null::uuid,                       -- veranstaltung_id
           t.auftrag_leistung_id,
           t.rrule,
           t.dtstart_lokal,
           t.zeitzone,
           t.dauer_minuten,
           1::smallint,                      -- soll_besetzung, §5.1
           1::smallint,                      -- min_besetzung, §5.1
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
     * Zweig 2 — `posten` (SEC-01). PLATZHALTER, PR 41.
     *
     * Er steht als `where false` da und nicht als Kommentar, damit die Spalten-
     * liste und ihre Typen schon heute uebersetzt werden: PR 41 ersetzt das
     * `where false` durch `from public.posten p …` und aendert nichts sonst.
     * `min_besetzung` ist die Spalte, die es nur hier gibt — ein Posten darf
     * unter seine Mindestbesetzung nicht fallen, eine Reinigungsrunde kennt
     * den Begriff nicht.
     */
    union all
    select null::uuid, 'posten'::einsatz_quelle, null::uuid,
           null::uuid, null::uuid, null::uuid, null::uuid,
           null::uuid, null::text, null::timestamp, null::text,
           null::integer, null::smallint, null::smallint,
           null::turnus_feiertagsregel, null::date, null::date
     where false

    /**
     * Zweig 3 — `veranstaltung` (SEC-08). PLATZHALTER, PR 41.
     *
     * Eine Veranstaltung ist EIN Fenster, keine Wiederholung: sie tritt mit
     * `rrule = null` in dieselbe Funktion ein (§8.1). Genau deshalb ist `rrule`
     * in der Rueckgabe nullbar und der Generator darf sich nicht darauf
     * verlassen, dass jede Zeile eine Regel traegt.
     */
    union all
    select null::uuid, 'veranstaltung'::einsatz_quelle, null::uuid,
           null::uuid, null::uuid, null::uuid, null::uuid,
           null::uuid, null::text, null::timestamp, null::text,
           null::integer, null::smallint, null::smallint,
           null::turnus_feiertagsregel, null::date, null::date
     where false;
end $$;

/**
 * NUR `cse_job`. Kein `grant execute … to cse_app`, und das ist die eigentliche
 * Schranke der Funktion: sie umgeht als Definer die Zeilenpolitik, also darf sie
 * keine angemeldete Sitzung erreichen. Ein Planer, der denselben Bedarf sehen
 * will, liest `turnus` durch `t_mandant` — mit Recht, Mandant und Decke.
 */
grant execute on function app.planungsbedarf(uuid, date, date) to cse_job;

comment on function app.planungsbedarf(uuid, date, date) is
  'Die eine Eingabe des Generators ueber beide Bedarfstraeger (04-PLANUNG-ZEIT.md '
  '§8.1). Heute liefert nur der turnus-Zweig Zeilen; posten und veranstaltung '
  'stehen als where-false-Zweige bereit, damit PR 41 die Signatur nicht anfasst.';

-- ---------------------------------------------------------------------------
-- 14. Nachzutragen in `src/server/db/schema/rls.ts`
-- ---------------------------------------------------------------------------

/**
 * Der Block darunter ist die Ausgabe von `scripts/generate-triggers.ts` fuer
 * diese Migration. Die Registry, aus der er entsteht, liegt in einer
 * TypeScript-Datei, die dieser Auftrag nicht anfassen darf — deshalb steht er
 * hier von Hand, in genau der Form, die der Generator erzeugt, und die
 * Registrierung ist der eine noch fehlende Handgriff:
 *
 *   `scripts/generate-triggers.ts` → MIGRATIONS_DATEIEN:
 *     '0029': join(WURZEL, 'drizzle/0029_revier_turnus.sql'),
 *
 *   `src/server/db/schema/rls.ts` → KEIN_HARD_DELETE (Reihenfolge wie hier),
 *   je Eintrag `migration: '0029'` und der `grund`, der unten im Kommentar
 *   steht: revier (art 'archiv'), turnus (art 'archiv'),
 *   turnus_ausnahme (art 'append').
 *
 *   `src/server/db/schema/rls.ts` → GEAENDERT_AM: revier, turnus,
 *   turnus_ausnahme, ebenfalls '0029'.
 *
 *   AUDITIERT bleibt unberuehrt: §13.1 fuehrt keine dieser drei Tabellen unter
 *   `app.protokolliere()`. Ein Auditeintrag je Turnusanlage ertraenkte das
 *   Protokoll, auf das sich eine LEG-08-Auskunft stuetzt.
 *
 * Bis die Registrierung nachgezogen ist, schlaegt
 * `tests/isolation/unveraenderbarkeit.test.ts` (4) fehl — „eine Tabelle traegt
 * den Ausloeser, ohne registriert zu sein". Das ist die richtige Haelfte der
 * Wahl: die Alternative waere eine Tabelle der Reinigungsdomaene, die sich in
 * einer Anweisung leeren laesst (Invariante 8, §1.2).
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0029)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- revier (archiv): CLN-01, FIN-07. Das Revier ist der Zuschnitt, auf den Sollzeit, Turnus und Leistungsnachweis zeigen. Es zu loeschen macht jede vergangene Abrechnung unpruefbar, weil niemand mehr sagen kann, welche Flaeche gemeint war; ein aufgeloestes Revier bekommt archiviert_am.
create trigger trg_revier_kein_hard_delete
  before delete on revier
  for each row execute function kern.verhindere_loeschung();
create trigger trg_revier_kein_truncate
  before truncate on revier
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on revier from cse_app, cse_anon, cse_checkin, cse_job;

-- turnus (archiv): CLN-02, LEG-03. Der Turnus ist die vertraglich geschuldete Leistung in ihrer Wiederholung — die Antwort darauf, ob eine Schicht stattfinden musste. Geloescht waere jede von ihm erzeugte Schicht ohne Grundlage; ein beendeter Turnus bekommt gueltig_bis, ein eingestellter archiviert_am.
create trigger trg_turnus_kein_hard_delete
  before delete on turnus
  for each row execute function kern.verhindere_loeschung();
create trigger trg_turnus_kein_truncate
  before truncate on turnus
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on turnus from cse_app, cse_anon, cse_checkin, cse_job;

-- turnus_ausnahme (append): CLN-03, FIN-01. Sie ist die dokumentierte Abweichung samt Grund und Urheber — genau das, was im Streit ueber eine nicht erbrachte Reinigung zaehlt. Eine Ausnahme, die sich loeschen laesst, ist keine Dokumentation. Zurueckgenommen wird sie durch eine Gegenzeile.
create trigger trg_turnus_ausnahme_kein_hard_delete
  before delete on turnus_ausnahme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_turnus_ausnahme_kein_truncate
  before truncate on turnus_ausnahme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on turnus_ausnahme from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_revier_geaendert_am
  before update on revier
  for each row execute function kern.setze_geaendert_am();
create trigger trg_turnus_geaendert_am
  before update on turnus
  for each row execute function kern.setze_geaendert_am();
create trigger trg_turnus_ausnahme_geaendert_am
  before update on turnus_ausnahme
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
