-- 0145 · Der Vergaberadar: Quellen, Profile, Bekanntmachungen, Bewertung
--        (RAD-01 … RAD-09, D-07, Phase 8, PR 68)
--
-- **Was hier entsteht und was mit Absicht nicht.** Der Radar ist der stärkste
-- Akquisekanal dieses Betriebs und zugleich der rechtlich harmloseste: eine
-- Bekanntmachung ist eine öffentliche Tatsache, kein Kontakt, den jemand
-- angeschrieben hätte. Diese Migration legt die Tabellen an, in denen sie
-- lebt; die Einreichung bleibt Handarbeit (D-07: die deutschen
-- Vergabeplattformen bieten keine Einreichungsschnittstelle an, Konten
-- hängen an natürlichen Personen, manche verlangen eine Signatur).
--
-- **Fuenf Tabellen tragen KEINEN Mandanten** — `vergabeplattform`,
-- `ausschreibung`, `ausschreibung_nuts`, `ausschreibung_rohdaten` und
-- `radar_ingest_lauf` (ein Einlesevorgang gehoert keiner Gesellschaft). Eine
-- Bekanntmachung auf oeffentlichevergabe.de gehört keiner GmbH. Trüge sie
-- `mandant_id`, müsste `quell_id` je Mandant eindeutig sein, dieselbe
-- Bekanntmachung stünde viermal im System, und RAD-03 („idempotente
-- Wiedereinspielung") wäre nicht mehr formulierbar: eine Korrektur müsste
-- viermal greifen und könnte dreimal scheitern. Alles Mandantsspezifische —
-- Punktzahl, Vorgang, Registrierung — hängt daneben und trägt RLS.
--
-- **Was der Radar NICHT tut:** er rankt nicht mit einem Modell (RAD-05).
-- `bewertung.verfahren` ist auf `deterministisch` festgenagelt; ein
-- LLM-Pfad käme an dieser Spalte nicht vorbei, ohne dass jemand eine
-- Migration schreibt und jemand sie liest.
--
-- **Offene Fragen, die hier als Platzhalter stehen und nicht als Tatsache:**
-- O-07 (auf welchen Plattformen ist welche Gesellschaft registriert),
-- O-15 (Punkteskala, Gewichtung, Benachrichtigungsschwelle),
-- O-98 (CPV-Listen gegen die amtliche Liste bestätigen),
-- O-191 (Wirkung eines Negativ-Stichworts; Mindestrestfrist),
-- O-192 (wann sind eine nationale und eine TED-Bekanntmachung dieselbe),
-- O-47 (Umrechnungsquelle für eine Fremdwährung — bis dahin: nicht bewertet,
-- niemals umgerechnet).

create type ausschreibung_quelle as enum ('oeffentlichevergabe', 'ted');
create type quell_status         as enum ('aktiv', 'aufgehoben', 'verschwunden');
create type radar_lauf_status    as enum ('laeuft', 'erfolg', 'teilweise', 'fehler', 'uebersprungen');
create type keyword_wirkung      as enum ('abzug', 'ausschluss');
create type cpv_wirkung          as enum ('positiv', 'abzug', 'ausschluss');
create type scoring_verfahren    as enum ('deterministisch');
create type wert_kriterium_status as enum ('bewertet', 'ohne_wert', 'fremdwaehrung');
create type plattform_registrierung_status as enum
  ('unbekannt', 'nicht_registriert', 'beantragt', 'registriert', 'abgelaufen');
create type plattform_pruefung   as enum
  ('unbekannt', 'registriert', 'nicht_registriert', 'keine_plattform');
create type ausschreibung_status as enum
  ('neu', 'geprueft', 'verworfen', 'in_bearbeitung', 'eingereicht',
   'zuschlag', 'nicht_beruecksichtigt', 'verfahren_aufgehoben');

comment on type ausschreibung_status is
  'RAD-07 plus die Ausgaenge eines deutschen Vergabeverfahrens (REP-06): ohne Zuschlag, '
  'Nichtberuecksichtigung und Aufhebung liesse sich „gefunden · geprueft · geboten · gewonnen" '
  'nicht berichten.';

-- ---------------------------------------------------------------------------
-- (1) Die Plattformen — und die Frage, ob wir dort überhaupt bieten dürfen
-- ---------------------------------------------------------------------------

/**
 * Der Katalog der Vergabeplattformen (DTVP, Vergabemarktplatz Berlin,
 * e-Vergabe des Bundes). Er kommt LEER in die Auslieferung: welche Plattform
 * hier gilt, ist O-07, und ein erfundener Eintrag wäre eine Behauptung über
 * die Konten des Mandanten.
 */
create table vergabeplattform (
  id                          uuid primary key default gen_random_uuid(),
  slug                        text not null check (slug ~ '^[a-z0-9_-]{2,60}$'),
  name                        text not null check (length(btrim(name)) > 0),
  betreiber                   text,
  basis_url                   text,

  /** Hostnamen, über die eine Bekanntmachung beim Einlesen ihrer Plattform zugeordnet wird. */
  host_muster                 text[] not null default '{}',

  registrierung_erforderlich  boolean not null default true,
  /** Freitext („Freischaltung 3–10 Werktage") — RAD-09 lebt von dieser Zahl. */
  registrierung_dauer_hinweis text,

  ist_platzhalter             boolean not null default true,
  archiviert_am               timestamptz,
  erstellt_am                 timestamptz not null default now(),
  geaendert_am                timestamptz,

  constraint vergabeplattform_slug_uk unique (slug)
);

create index vergabeplattform_host_idx on vergabeplattform using gin (host_muster);

comment on table vergabeplattform is
  'RAD-09. Katalog der Vergabeplattformen — Referenzdaten ohne Mandant. Leer bis O-07 '
  'beantwortet ist; jede Zeile traegt ist_platzhalter, bis ein Mensch sie bestaetigt.';

/**
 * Ob und seit wann EINE Gesellschaft auf EINER Plattform registriert und
 * freigeschaltet ist — die Tatsache, deren Fehlen am Abgabetag die Chance
 * kostet (RAD-09).
 *
 * **Vorgabe `unbekannt`, nicht `nicht_registriert`.** O-07 ist offen; die
 * Oberfläche soll „unbekannt" sagen und keine Tatsache behaupten, die
 * niemand geprüft hat.
 *
 * **Niemals ein Kennwort.** `benutzerkennung` ist die Anmeldekennung,
 * `credential_ref` der NAME eines Geheimnisses im Vault (SEC-A5) — nie das
 * Geheimnis. Ein Kennwort in einer Zeile, die vier Rollen lesen dürfen,
 * wäre ein Vorfall mit Ansage.
 */
create table mandant_plattform_registrierung (
  id                        uuid primary key default gen_random_uuid(),
  mandant_id                uuid not null references mandant(id),
  vergabeplattform_id       uuid not null references vergabeplattform(id),

  status                    plattform_registrierung_status not null default 'unbekannt',
  benutzerkennung           text,
  credential_ref            text,
  registriert_am            date,
  gueltig_bis               date,
  verantwortlich_benutzer_id uuid references benutzer(id),
  zuletzt_bestaetigt_am     timestamptz,
  notiz                     text,

  erstellt_von_art          akteur_art not null default 'mensch',
  erstellt_von              uuid references benutzer(id),
  erstellt_von_agent_id     uuid,
  erstellt_am               timestamptz not null default now(),
  geaendert_am              timestamptz,
  geaendert_von             uuid references benutzer(id),
  geloescht_am              timestamptz,
  geloescht_von             uuid references benutzer(id),

  constraint mpr_mandant_uk unique (mandant_id, id),
  constraint mpr_registriert_datum check (status <> 'registriert' or registriert_am is not null),
  constraint mpr_gueltig_nach_start check (
    gueltig_bis is null or registriert_am is null or gueltig_bis >= registriert_am)
);

create unique index mpr_uk on mandant_plattform_registrierung (mandant_id, vergabeplattform_id)
  where geloescht_am is null;
create index mpr_status_idx on mandant_plattform_registrierung (mandant_id, status);

comment on table mandant_plattform_registrierung is
  'RAD-09, D-07, SEC-A5. Registrierungsstand je Gesellschaft und Plattform. Kein Kennwort — '
  'credential_ref nennt nur den Schluesselnamen im Vault.';

-- ---------------------------------------------------------------------------
-- (2) Die Suchprofile — was diesen Betrieb an einer Bekanntmachung interessiert
-- ---------------------------------------------------------------------------

/**
 * Ein Profil je Bereich (RAD-04). Was es „interessant" nennt, ist DATEN und
 * kein Code: CPV-Codes, Regionen, Stichwörter, Wertgrenzen.
 *
 * **Fast jede Zahl darin ist ein Platzhalter, und das steht auch so da.**
 * Die Punkteskala, die Gewichte und die Benachrichtigungsschwelle sind O-15;
 * die Wirkung eines Negativ-Stichworts ist O-191. Ein „plausibler" Wert wäre
 * hier eine erfundene Geschäftsregel — und sie würde still Chancen
 * verwerfen, die nie ein Mensch gesehen hat. Vorgabe ist deshalb `abzug`,
 * nicht `ausschluss`.
 *
 * **`version` zählt jede Änderung**, auch die an den CPV- und
 * Empfängerzeilen, und geht in `bewertung.eingaben_hash` ein: eine
 * nachgeschärfte Suche erzeugt eine NEUE Bewertung statt die alte
 * stillschweigend zu ersetzen.
 */
create table radar_profil (
  id                        uuid primary key default gen_random_uuid(),
  mandant_id                uuid not null references mandant(id),

  name                      text not null check (length(btrim(name)) > 0),
  version                   integer not null default 1 check (version >= 1),

  /** `{DE3}` / `{DE300}` — Präfixvergleich gegen `ausschreibung_nuts`. */
  nuts_praefixe             text[] not null default '{}',
  positiv_keywords          text[] not null default '{}',
  negativ_keywords          text[] not null default '{}',
  negativ_wirkung           keyword_wirkung not null default 'abzug',

  wert_min_cent             bigint check (wert_min_cent is null or wert_min_cent >= 0),
  wert_max_cent             bigint check (wert_max_cent is null or wert_max_cent >= 0),
  waehrung                  char(3) not null default 'EUR',

  frist_min_tage            integer check (frist_min_tage is null or frist_min_tage >= 0),
  oberhalb_schwellenwert    boolean,

  regel_version             text not null default 'v0-platzhalter',
  skala_max                 integer not null default 100 check (skala_max > 0),
  gewichtung                jsonb not null default '{}',
  benachrichtigung_ab_punkte integer,

  ist_platzhalter           boolean not null default true,
  ist_aktiv                 boolean not null default true,

  erstellt_von_art          akteur_art not null default 'mensch',
  erstellt_von              uuid references benutzer(id),
  erstellt_von_agent_id     uuid,
  erstellt_am               timestamptz not null default now(),
  geaendert_am              timestamptz,
  geaendert_von             uuid references benutzer(id),
  geloescht_am              timestamptz,
  geloescht_von             uuid references benutzer(id),

  constraint radar_profil_mandant_uk unique (mandant_id, id),
  constraint radar_profil_wertgrenzen check (
    wert_max_cent is null or wert_min_cent is null or wert_max_cent >= wert_min_cent),
  constraint radar_profil_schwelle check (
    benachrichtigung_ab_punkte is null
    or benachrichtigung_ab_punkte between 0 and skala_max)
);

create index radar_profil_aktiv_idx on radar_profil (mandant_id)
  where ist_aktiv and geloescht_am is null;
create index radar_profil_nuts_idx on radar_profil using gin (nuts_praefixe);
create index radar_profil_positiv_idx on radar_profil using gin (positiv_keywords);

comment on table radar_profil is
  'RAD-04, RAD-05, RAD-08. Ein Suchprofil je Bereich. Skala, Gewichte und Schwelle sind '
  'Platzhalter (O-15), die Wirkung eines Negativ-Stichworts ist O-191.';

/** Ein CPV-Code oder -Präfix eines Profils. `text`, weil führende Nullen Bedeutung tragen. */
create table radar_profil_cpv (
  id               uuid primary key default gen_random_uuid(),
  mandant_id       uuid not null references mandant(id),
  radar_profil_id  uuid not null,

  cpv_code         text not null check (cpv_code ~ '^[0-9]{8}(-[0-9])?$'),
  praefix_laenge   smallint not null default 8 check (praefix_laenge between 2 and 8),
  gewichtung       integer not null default 100,
  wirkung          cpv_wirkung not null default 'positiv',
  bezeichnung      text,
  /** Die im SPEC genannten Codes sind ausdrücklich „verify against the official list" (O-98). */
  ist_platzhalter  boolean not null default true,

  erstellt_am      timestamptz not null default now(),

  constraint rpc_mandant_uk unique (mandant_id, id),
  constraint rpc_profil_fk foreign key (mandant_id, radar_profil_id)
    references radar_profil (mandant_id, id) on delete cascade,
  constraint rpc_uk unique (radar_profil_id, cpv_code, praefix_laenge)
);

create index rpc_praefix_idx on radar_profil_cpv (left(cpv_code, 2));
create index rpc_pattern_idx on radar_profil_cpv (cpv_code text_pattern_ops);

comment on table radar_profil_cpv is
  'RAD-04, O-98. CPV-Code oder -Praefix eines Profils. Gewicht und Wirkung sind Platzhalter (O-15).';

/**
 * Wer benachrichtigt wird, wenn eine Bekanntmachung die Schwelle reißt
 * (RAD-08). **Eine Tabelle, kein `uuid[]`:** ein Array trägt keinen
 * Fremdschlüssel, und dann könnte RAD-08 eine Benutzerin eines anderen
 * Mandanten benachrichtigen, ohne dass im Schema etwas dagegen stünde.
 */
create table radar_profil_empfaenger (
  id              uuid primary key default gen_random_uuid(),
  mandant_id      uuid not null references mandant(id),
  radar_profil_id uuid not null,
  benutzer_id     uuid not null references benutzer(id),
  ab_punkte       integer,
  erstellt_am     timestamptz not null default now(),

  constraint rpe_mandant_uk unique (mandant_id, id),
  constraint rpe_profil_fk foreign key (mandant_id, radar_profil_id)
    references radar_profil (mandant_id, id) on delete cascade,
  constraint rpe_uk unique (radar_profil_id, benutzer_id)
);

comment on table radar_profil_empfaenger is
  'RAD-08, NOT-01. Empfaenger einer Radar-Benachrichtigung — mit Fremdschluessel, damit '
  'niemand aus einem fremden Mandanten benachrichtigt werden kann.';

-- ---------------------------------------------------------------------------
-- (3) Der Einlesevorgang — der Beweis, dass der Radar überhaupt lief
-- ---------------------------------------------------------------------------

/**
 * Eine Zeile je Quelle und Lauf. **Das Einzige, was eine still gescheiterte
 * Quelle von „heute gab es keine Ausschreibungen" unterscheidet.** Ohne diese
 * Tabelle sieht ein abgeschalteter Zugang genauso aus wie ein ruhiger Markt —
 * wochenlang.
 */
create table radar_ingest_lauf (
  id                   uuid primary key default gen_random_uuid(),
  job_lauf_id          uuid references job_lauf(id),
  quelle               ausschreibung_quelle not null,
  status               radar_lauf_status not null default 'laeuft',

  gestartet_am         timestamptz not null default now(),
  beendet_am           timestamptz,

  fenster_von          timestamptz,
  fenster_bis          timestamptz,
  saetze_gelesen       integer not null default 0 check (saetze_gelesen >= 0),
  saetze_neu           integer not null default 0 check (saetze_neu >= 0),
  saetze_geaendert     integer not null default 0 check (saetze_geaendert >= 0),
  saetze_unveraendert  integer not null default 0 check (saetze_unveraendert >= 0),
  saetze_verschwunden  integer not null default 0 check (saetze_verschwunden >= 0),
  fehler_text          text,

  constraint ril_ende_nach_start check (beendet_am is null or beendet_am >= gestartet_am)
);

create index ril_quelle_idx on radar_ingest_lauf (quelle, gestartet_am desc);

comment on table radar_ingest_lauf is
  'RAD-01, RAD-02. Ein Lauf je Quelle — die Evidenz, dass der Radar lief. Eine leere Quelle '
  'ist ein Ausschlag in saetze_gelesen, kein Schweigen.';

-- ---------------------------------------------------------------------------
-- (4) Die Bekanntmachung selbst — öffentliche Tatsache, kein Mandantsdatum
-- ---------------------------------------------------------------------------

create table ausschreibung (
  id                      uuid primary key default gen_random_uuid(),

  quelle                  ausschreibung_quelle not null,
  /** OCID oder TED-Veröffentlichungsnummer. */
  quell_id                text not null check (length(btrim(quell_id)) > 0),
  quell_url               text,

  titel                   text not null check (length(btrim(titel)) > 0),
  beschreibung            text,
  /** Die Sprache, die die Quelle angibt — TED liefert auch nicht-deutsche Bekanntmachungen. */
  sprache                 char(2) not null default 'de',
  /**
   * `regconfig`, nicht `text`: die erzeugte Spalte darunter muss unveränderlich
   * sein, und `to_tsvector(text, text)` ist es nicht.
   */
  ts_konfiguration        regconfig not null default 'german',
  /** Stichwortsuche läuft in der Datenbank, in der Sprache der Bekanntmachung. */
  such_text               tsvector generated always as (
    to_tsvector(ts_konfiguration, coalesce(titel, '') || ' ' || coalesce(beschreibung, ''))
  ) stored,

  vergabestelle_name      text,
  vergabestelle_ort       text,
  vergabestelle_plz       text,

  cpv_haupt               text check (cpv_haupt is null or cpv_haupt ~ '^[0-9]{8}(-[0-9])?$'),
  cpv_weitere             text[] not null default '{}',

  /** Der Wortlaut der Quelle. VOB/A, VgV und UVgO sprechen verschieden — keine erfundene Vereinheitlichung. */
  verfahrensart_roh       text,
  /** Aus der Quelle, nie gerechnet: die Schwellenwerte ändern sich alle zwei Jahre. */
  oberhalb_schwellenwert  boolean,

  wert_geschaetzt_cent    bigint check (wert_geschaetzt_cent is null or wert_geschaetzt_cent >= 0),
  waehrung                char(3),

  veroeffentlicht_am      timestamptz,
  frist_teilnahme         timestamptz,
  frist_angebot           timestamptz,
  frist_fragen            timestamptz,
  bindefrist_bis          date,
  lose_anzahl             integer check (lose_anzahl is null or lose_anzahl >= 0),

  vergabeplattform_id     uuid references vergabeplattform(id),
  plattform_hinweis       text,

  quell_status            quell_status not null default 'aktiv',
  ist_berichtigung        boolean not null default false,
  ersetzt_ausschreibung_id uuid references ausschreibung(id),

  /** Quellenübergreifendes Duplikat — O-192: bis zur Antwort wird vorgeschlagen, nie zusammengeführt. */
  ist_duplikat_von        uuid references ausschreibung(id),
  duplikat_konfidenz      numeric(4,3) check (duplikat_konfidenz is null or duplikat_konfidenz between 0 and 1),
  duplikat_bestaetigt_von uuid references benutzer(id),

  zuletzt_gesehen_am      timestamptz not null default now(),
  rohdaten_hash           text not null,

  erstellt_am             timestamptz not null default now(),
  geaendert_am            timestamptz,

  constraint ausschreibung_quelle_uk unique (quelle, quell_id),
  constraint ausschreibung_waehrung_bei_wert check (
    wert_geschaetzt_cent is null or waehrung is not null),
  constraint ausschreibung_frist_nach_veroeffentlichung check (
    frist_angebot is null or veroeffentlicht_am is null or frist_angebot > veroeffentlicht_am),
  constraint ausschreibung_duplikat_stimmig check (
    ist_duplikat_von is null or ist_duplikat_von <> id)
);

create index ausschreibung_such_idx on ausschreibung using gin (such_text);
create index ausschreibung_cpv_weitere_idx on ausschreibung using gin (cpv_weitere);
create index ausschreibung_cpv_idx on ausschreibung (cpv_haupt text_pattern_ops);
/** Ohne `> now()` im Index (§1.9): der Zeitvergleich gehört in die Abfrage, nicht in den Index. */
create index ausschreibung_frist_idx on ausschreibung (frist_angebot) where frist_angebot is not null;
create index ausschreibung_plattform_idx on ausschreibung (vergabeplattform_id);
create index ausschreibung_gesehen_idx on ausschreibung (zuletzt_gesehen_am) where quell_status = 'aktiv';
create index ausschreibung_dup_idx on ausschreibung (ist_duplikat_von) where ist_duplikat_von is not null;

comment on table ausschreibung is
  'RAD-01, RAD-02, RAD-03, RAD-06, RAD-09. Eine oeffentliche Bekanntmachung — Referenzdaten ohne '
  'Mandant. Der Eindeutigkeitsindex (quelle, quell_id) TRAEGT die idempotente Wiedereinspielung.';

/** Eine NUTS-Zeile je Bekanntmachung, mit materialisierten Präfixen — RAD-04 wird damit ein Indexzugriff. */
create table ausschreibung_nuts (
  id               uuid primary key default gen_random_uuid(),
  ausschreibung_id uuid not null references ausschreibung(id) on delete cascade,
  nuts_code        text not null check (nuts_code ~ '^[A-Z]{2}[0-9A-Z]{0,3}$'),
  nuts_1           text generated always as (left(nuts_code, 3)) stored,
  nuts_2           text generated always as (left(nuts_code, 4)) stored,
  nuts_3           text generated always as (left(nuts_code, 5)) stored,
  erstellt_am      timestamptz not null default now(),

  constraint an_uk unique (ausschreibung_id, nuts_code)
);

create index an_1_idx on ausschreibung_nuts (nuts_1);
create index an_2_idx on ausschreibung_nuts (nuts_2);
create index an_3_idx on ausschreibung_nuts (nuts_3);

comment on table ausschreibung_nuts is
  'RAD-04. NUTS-Codes mit materialisierten Praefixen: „{DE3}" ist damit ein Gleichheitszugriff '
  'und kein sequentieller Lauf ueber den ganzen Bestand.';

/**
 * Die unveränderte Antwort der Quelle — die Beweiskette hinter jedem
 * normalisierten Feld (RAD-03).
 *
 * **`text`, nicht `jsonb`.** `jsonb` sortiert Schlüssel um und wirft
 * Doppelte weg; danach ist es keine wortgetreue Kopie mehr. Die geparste
 * Form steht daneben, nur zum Abfragen.
 */
create table ausschreibung_rohdaten (
  id                   uuid primary key default gen_random_uuid(),
  ausschreibung_id     uuid not null references ausschreibung(id),
  radar_ingest_lauf_id uuid references radar_ingest_lauf(id),
  quelle               ausschreibung_quelle not null,
  quell_id             text not null,

  nutzlast_roh         text not null,
  nutzlast             jsonb,
  nutzlast_hash        text not null,
  inhaltstyp           text not null default 'application/json',
  abgerufen_am         timestamptz not null default now(),

  constraint arh_uk unique (quelle, quell_id, nutzlast_hash)
);

create index arh_verlauf_idx on ausschreibung_rohdaten (ausschreibung_id, abgerufen_am desc);
create index arh_zeit_idx on ausschreibung_rohdaten using brin (abgerufen_am);

comment on table ausschreibung_rohdaten is
  'RAD-03. Die wortgetreue Antwort der Quelle, eine Zeile je Abruf. Anhaengend, nie geaendert.';

-- ---------------------------------------------------------------------------
-- (5) Die Bewertung — deterministisch, nachrechenbar, ohne Modell
-- ---------------------------------------------------------------------------

/**
 * Das Ergebnis EINES Profils gegen EINE Bekanntmachung: Punkte, die einzelnen
 * Regeltreffer und ein deutscher Satz, der sagt warum (RAD-05).
 *
 * **`verfahren` ist auf `deterministisch` festgenagelt.** Ein Modellpfad
 * käme an diesem CHECK nicht vorbei, ohne dass jemand eine Migration
 * schreibt — und genau das ist der Zweck: „no LLM in ranking" steht damit im
 * Schema und nicht nur im Vorsatz.
 *
 * **Der Eindeutigkeitsschlüssel enthält `eingaben_hash`, und der Einfügefall
 * ist `do nothing`.** Ohne ihn stünde hier die Falle, an der der Radar beim
 * ersten Nachschärfen eines Profils stehen bliebe: gleiche Bekanntmachung,
 * gleiche Codeversion, geändertes Profil — der Index wies die Zeile ab, die
 * Anhäng-Regel verbot ein `do update`, und der Lauf starb an der ersten
 * schon bewerteten Bekanntmachung. Mit den Eingaben im Schlüssel ist eine
 * unveränderte Eingabe ein Nichts und eine geänderte eine neue Zeile; die
 * alte bleibt als Aufzeichnung stehen.
 */
create table bewertung (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),

  ausschreibung_id  uuid not null references ausschreibung(id),
  radar_profil_id   uuid not null,

  regel_version     text not null,
  profil_version    integer not null,
  verfahren         scoring_verfahren not null default 'deterministisch',

  punkte            integer not null,
  skala_max         integer not null check (skala_max > 0),
  ausgeschlossen    boolean not null default false,
  ausschluss_grund  text,
  wert_kriterium    wert_kriterium_status not null default 'bewertet',

  /** `[{regel, treffer, roh_wert, gewicht, punkte}]` — jede Zeile steht so in der Oberfläche. */
  aufschluesselung  jsonb not null default '[]',
  /** Deutscher Klartext, VOM CODE erzeugt (RAD-05) — nie von einem Modell. */
  begruendung       text not null check (length(btrim(begruendung)) > 0),
  /** SHA-256 über Bekanntmachungsfelder + Profilfelder + Profilversion + Regelversion. */
  eingaben_hash     text not null,

  berechnet_am      timestamptz not null default now(),
  dauer_ms          integer check (dauer_ms is null or dauer_ms >= 0),

  constraint bewertung_mandant_uk unique (mandant_id, id),
  constraint bewertung_profil_fk foreign key (mandant_id, radar_profil_id)
    references radar_profil (mandant_id, id),
  constraint bewertung_verfahren_deterministisch check (verfahren = 'deterministisch'),
  constraint bewertung_punkte_in_skala check (punkte between 0 and skala_max),
  constraint bewertung_ausschluss_begruendet check (
    not ausgeschlossen or ausschluss_grund is not null),
  constraint bewertung_uk unique (ausschreibung_id, radar_profil_id, regel_version, eingaben_hash)
);

create index bewertung_liste_idx on bewertung (mandant_id, punkte desc, berechnet_am desc)
  where not ausgeschlossen;
create index bewertung_profil_idx on bewertung (radar_profil_id, berechnet_am desc);

comment on table bewertung is
  'RAD-05, RAD-08, REP-06. Deterministisch berechnet, mit Aufschluesselung und deutschem Satz. '
  'verfahren ist auf deterministisch festgenagelt — kein Modell rankt hier.';

/**
 * Der Vorgang EINES Mandanten zu EINER Bekanntmachung — der Status aus
 * RAD-07 und die Ausgänge, die REP-06 berichten muss.
 *
 * **Ohne Ausgang kein Bericht.** „gefunden · geprüft · geboten · gewonnen"
 * braucht `zuschlag`, ein Entscheidungsdatum, einen Zuschlagswert und die
 * Brücke zum Auftrag — sonst könnte die Plattform den stärksten Akquisekanal
 * dieses Betriebs nicht mit einem einzigen Euro belegen.
 *
 * **`frist_angebot_snapshot` ist KEINE Spiegelung.** Die geltende Frist steht
 * in `ausschreibung` und wird von dort gelesen; der Schnappschuss hält fest,
 * welche Frist galt, als der Vorgang eröffnet wurde. Weicht beides
 * voneinander ab, ist das eine Änderungsbekanntmachung — und die ist ein
 * Ereignis, das jemand sehen muss (PR 69), kein stiller Zahlenwechsel.
 */
create table ausschreibung_vorgang (
  id                       uuid primary key default gen_random_uuid(),
  mandant_id               uuid not null references mandant(id),

  ausschreibung_id         uuid not null references ausschreibung(id),
  radar_profil_id          uuid,
  bewertung_id             uuid,

  status                   ausschreibung_status not null default 'neu',
  verworfen_grund          text,
  verantwortlich_benutzer_id uuid references benutzer(id),

  plattform_pruefung       plattform_pruefung not null default 'unbekannt',
  plattform_geprueft_am    timestamptz,

  frist_angebot_snapshot   timestamptz,
  frist_abweichung_seit    timestamptz,

  entschieden_am           date,
  zuschlagswert_cent       bigint check (zuschlagswert_cent is null or zuschlagswert_cent >= 0),
  auftrag_id               uuid,

  status_geaendert_am      timestamptz,
  status_geaendert_von     uuid references benutzer(id),
  notiz                    text,

  erstellt_von_art         akteur_art not null default 'mensch',
  erstellt_von             uuid references benutzer(id),
  erstellt_von_agent_id    uuid,
  erstellt_am              timestamptz not null default now(),
  geaendert_am             timestamptz,
  geaendert_von            uuid references benutzer(id),
  geloescht_am             timestamptz,
  geloescht_von            uuid references benutzer(id),

  constraint av_mandant_uk unique (mandant_id, id),
  constraint av_profil_fk foreign key (mandant_id, radar_profil_id)
    references radar_profil (mandant_id, id),
  constraint av_bewertung_fk foreign key (mandant_id, bewertung_id)
    references bewertung (mandant_id, id),
  constraint av_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  /** RAD-07 verlangt einen Grund — und zwar einen, den ein Mensch lesen kann. */
  constraint av_verworfen_begruendet check (
    status <> 'verworfen' or (verworfen_grund is not null and length(btrim(verworfen_grund)) >= 5)),
  constraint av_zuschlag_datiert check (status <> 'zuschlag' or entschieden_am is not null),
  constraint av_auftrag_nur_bei_zuschlag check (auftrag_id is null or status = 'zuschlag')
);

create unique index av_uk on ausschreibung_vorgang (mandant_id, ausschreibung_id)
  where geloescht_am is null;
create index av_arbeit_idx on ausschreibung_vorgang (mandant_id, status);
/** Genau die RAD-09-Warnliste: „wo dürfen wir gar nicht bieten?" */
create index av_unregistriert_idx on ausschreibung_vorgang (mandant_id)
  where plattform_pruefung = 'nicht_registriert';
create index av_auftrag_idx on ausschreibung_vorgang (auftrag_id) where auftrag_id is not null;

comment on table ausschreibung_vorgang is
  'RAD-07, RAD-09, REP-03, REP-06, D-07. Der Vorgang eines Mandanten zu einer Bekanntmachung — '
  'mit den Ausgaengen eines deutschen Vergabeverfahrens, damit die Pipeline berichtbar ist.';

-- ---------------------------------------------------------------------------
-- (6) Zuordnung der Plattform beim Einlesen — aus dem Host, überschreibbar
-- ---------------------------------------------------------------------------

/**
 * Die URL einer Bekanntmachung nennt die Plattform, über die sie läuft.
 * Passt kein `host_muster`, bleibt `vergabeplattform_id` leer und der rohe
 * Wert steht in `plattform_hinweis` — die Oberfläche sagt dann „Plattform
 * unbekannt" statt eine falsche zu behaupten.
 *
 * Ein Mensch, der die Zuordnung setzt, wird nicht überschrieben: der Trigger
 * greift nur, solange die Spalte leer ist.
 */
create function app.ausschreibung_plattform_zuordnen() returns trigger
language plpgsql as $$
declare
  v_host text;
  v_id   uuid;
begin
  if new.vergabeplattform_id is not null or new.quell_url is null then
    return new;
  end if;
  v_host := lower(split_part(split_part(regexp_replace(new.quell_url, '^[a-z]+://', ''), '/', 1), ':', 1));
  if v_host = '' then
    return new;
  end if;
  select p.id into v_id
    from public.vergabeplattform p
   where p.archiviert_am is null
     and exists (select 1 from unnest(p.host_muster) m
                  where v_host = lower(m) or v_host like '%.' || lower(m))
   order by p.slug
   limit 1;
  if v_id is null then
    new.plattform_hinweis := coalesce(new.plattform_hinweis, v_host);
  else
    new.vergabeplattform_id := v_id;
  end if;
  return new;
end $$;

create trigger trg_plattform_zuordnen before insert or update of quell_url on ausschreibung
  for each row execute function app.ausschreibung_plattform_zuordnen();

/**
 * Die Textsuchkonfiguration folgt der Sprache der Bekanntmachung.
 *
 * **Warum nicht einfach `'german'`.** TED liefert Bekanntmachungen aus der
 * ganzen Union. Eine franzoesische Ausschreibung mit deutschem Stemmer
 * indiziert Woerter, die es so nicht gibt — und sie waere ueber ihre eigenen
 * Begriffe nicht auffindbar. Postgres bringt eine feste Menge
 * Konfigurationen mit; fuer alles andere ist `simple` die ehrliche Antwort:
 * keine Stammformen, aber auffindbare Woerter.
 */
create function app.radar_textsuche(p_sprache text) returns regconfig
language sql immutable as $$
  select case lower(coalesce(p_sprache, 'de'))
           when 'de' then 'german'::regconfig
           when 'en' then 'english'::regconfig
           when 'fr' then 'french'::regconfig
           when 'nl' then 'dutch'::regconfig
           when 'it' then 'italian'::regconfig
           when 'es' then 'spanish'::regconfig
           when 'pt' then 'portuguese'::regconfig
           when 'da' then 'danish'::regconfig
           when 'sv' then 'swedish'::regconfig
           when 'fi' then 'finnish'::regconfig
           when 'hu' then 'hungarian'::regconfig
           when 'el' then 'greek'::regconfig
           else 'simple'::regconfig
         end
$$;

create function app.ausschreibung_textsuche_setzen() returns trigger
language plpgsql as $$
begin
  new.ts_konfiguration := app.radar_textsuche(new.sprache);
  return new;
end $$;

create trigger trg_ausschreibung_textsuche before insert or update of sprache on ausschreibung
  for each row execute function app.ausschreibung_textsuche_setzen();

-- ---------------------------------------------------------------------------
-- (7) Profilversion — einmal je Anweisung, nicht einmal je Zeile
-- ---------------------------------------------------------------------------

/**
 * Die naive Form — Zeilentrigger auf den Kindtabellen, die den Elternsatz
 * hochzählen — ruft sich selbst wieder auf: der Kindtrigger ändert das
 * Profil, das feuert den Profiltrigger, und eine Massenänderung von achtzig
 * CPV-Zeilen zählt einundachtzigmal. Deshalb: die Kinder zählen
 * ANWEISUNGSWEISE und setzen dabei eine Transaktionsmarke, an der der
 * Elterntrigger erkennt, dass er gerade nicht gemeint ist.
 */
create function app.radar_profil_version_bump() returns trigger
language plpgsql as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(distinct radar_profil_id) into v_ids from alt;
  elsif tg_op = 'INSERT' then
    select array_agg(distinct radar_profil_id) into v_ids from neu;
  else
    select array_agg(distinct id) into v_ids from (
      select radar_profil_id as id from neu
      union select radar_profil_id from alt) x;
  end if;
  if v_ids is null or cardinality(v_ids) = 0 then
    return null;
  end if;
  perform set_config('app.radar_version_laeuft', 'on', true);
  update public.radar_profil set version = version + 1, geaendert_am = now()
   where id = any (v_ids);
  perform set_config('app.radar_version_laeuft', 'off', true);
  return null;
end $$;

create function app.radar_profil_version_setzen() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

create trigger trg_radar_profil_version before update on radar_profil
  for each row
  when (coalesce(nullif(current_setting('app.radar_version_laeuft', true), ''), 'off') = 'off'
        and (old.* is distinct from new.*))
  execute function app.radar_profil_version_setzen();

create trigger trg_rpc_version_ins after insert on radar_profil_cpv
  referencing new table as neu
  for each statement execute function app.radar_profil_version_bump();
create trigger trg_rpc_version_upd after update on radar_profil_cpv
  referencing new table as neu old table as alt
  for each statement execute function app.radar_profil_version_bump();
create trigger trg_rpc_version_del after delete on radar_profil_cpv
  referencing old table as alt
  for each statement execute function app.radar_profil_version_bump();

create trigger trg_rpe_version_ins after insert on radar_profil_empfaenger
  referencing new table as neu
  for each statement execute function app.radar_profil_version_bump();
create trigger trg_rpe_version_del after delete on radar_profil_empfaenger
  referencing old table as alt
  for each statement execute function app.radar_profil_version_bump();

-- ---------------------------------------------------------------------------
-- (8) Anhängende Tabellen: Rohdaten und Bewertungen werden nie geändert
-- ---------------------------------------------------------------------------

/**
 * Eine Beweiskette, die sich ändern lässt, ist keine. Rohdaten und
 * Bewertungen werden geschrieben und gelesen — sonst nichts. Eine
 * Korrektur ist eine neue Zeile, und die alte bleibt daneben stehen.
 */
create function app.radar_nur_anhaengen() returns trigger
language plpgsql as $$
begin
  raise exception 'Die Tabelle % ist anhaengend: Aendern und Loeschen sind nicht vorgesehen (RAD-03, RAD-05).',
    tg_table_name using errcode = 'restrict_violation';
end $$;

create trigger trg_arh_anhaengend before update or delete on ausschreibung_rohdaten
  for each row execute function app.radar_nur_anhaengen();
create trigger trg_bewertung_anhaengend before update or delete on bewertung
  for each row execute function app.radar_nur_anhaengen();

-- ---------------------------------------------------------------------------
-- (9) Rechte und Riegel
-- ---------------------------------------------------------------------------

alter table vergabeplattform                enable row level security;
alter table vergabeplattform                force  row level security;
alter table ausschreibung                   enable row level security;
alter table ausschreibung                   force  row level security;
alter table ausschreibung_nuts              enable row level security;
alter table ausschreibung_nuts              force  row level security;
alter table ausschreibung_rohdaten          enable row level security;
alter table ausschreibung_rohdaten          force  row level security;
alter table radar_ingest_lauf               enable row level security;
alter table radar_ingest_lauf               force  row level security;
alter table mandant_plattform_registrierung enable row level security;
alter table mandant_plattform_registrierung force  row level security;
alter table radar_profil                    enable row level security;
alter table radar_profil                    force  row level security;
alter table radar_profil_cpv                enable row level security;
alter table radar_profil_cpv                force  row level security;
alter table radar_profil_empfaenger         enable row level security;
alter table radar_profil_empfaenger         force  row level security;
alter table bewertung                       enable row level security;
alter table bewertung                       force  row level security;
alter table ausschreibung_vorgang           enable row level security;
alter table ausschreibung_vorgang           force  row level security;

/**
 * **Die fünf Referenztische** — Plattformkatalog, Bekanntmachung, ihre NUTS,
 * ihre Rohdaten und die Laufprotokolle. Sie tragen keinen Mandanten, also
 * trägt die Policy das Recht: wer den Radar lesen darf, liest sie, und zwar
 * nur aus dem internen Portal. Geschrieben wird ausschliesslich vom
 * Einlesejob (`cse_job`); den Plattformkatalog pflegt zusätzlich die
 * Super-Administration, weil er eine gruppenweite Liste ist und kein
 * Mandantsdatum.
 */
create policy r_plattform_lesen on vergabeplattform for select to cse_app
  using (app.portal() = 'intern' and app.aktiver_mandant() is not null
         and app.hat_recht('radar.lesen', app.aktiver_mandant()));
create policy r_plattform_schreiben on vergabeplattform for all to cse_app
  using (app.ist_super_admin() and not app.ist_readonly())
  with check (app.ist_super_admin() and not app.ist_readonly());

create policy r_ausschreibung_lesen on ausschreibung for select to cse_app
  using (app.portal() = 'intern' and app.aktiver_mandant() is not null
         and app.hat_recht('radar.lesen', app.aktiver_mandant()));
create policy r_nuts_lesen on ausschreibung_nuts for select to cse_app
  using (app.portal() = 'intern' and app.aktiver_mandant() is not null
         and app.hat_recht('radar.lesen', app.aktiver_mandant()));
create policy r_rohdaten_lesen on ausschreibung_rohdaten for select to cse_app
  using (app.portal() = 'intern' and app.aktiver_mandant() is not null
         and app.hat_recht('radar.lesen', app.aktiver_mandant()));
create policy r_ingest_lesen on radar_ingest_lauf for select to cse_app
  using (app.portal() = 'intern' and app.aktiver_mandant() is not null
         and app.hat_recht('radar.lesen', app.aktiver_mandant()));

create policy j_plattform on vergabeplattform for all to cse_job using (true) with check (true);
create policy j_ausschreibung on ausschreibung for all to cse_job using (true) with check (true);
create policy j_nuts on ausschreibung_nuts for all to cse_job using (true) with check (true);
create policy j_rohdaten on ausschreibung_rohdaten for all to cse_job using (true) with check (true);
create policy j_ingest on radar_ingest_lauf for all to cse_job using (true) with check (true);

grant select on vergabeplattform, ausschreibung, ausschreibung_nuts,
                ausschreibung_rohdaten, radar_ingest_lauf to cse_app;
grant insert, update on vergabeplattform to cse_app;
grant select, insert, update on vergabeplattform, ausschreibung, ausschreibung_nuts,
                                radar_ingest_lauf to cse_job;
/** Rohdaten: der Job schreibt sie an, niemand ändert sie — auch der Job nicht. */
grant select, insert on ausschreibung_rohdaten to cse_job;
/**
 * **Und NUTS-Zeilen darf der Job löschen.** Sie sind abgeleitete Angaben, kein
 * Vorgang: nennt eine Berichtigung einen Ort nicht mehr, muss er verschwinden,
 * sonst bewertet die Region gegen eine Stelle, an der nicht mehr gearbeitet
 * wird. Das ist der Unterschied zu `ausschreibung_rohdaten`, wo genau deshalb
 * kein Löschrecht steht.
 */
grant delete on ausschreibung_nuts to cse_job;

/**
 * **Die sechs Mandantstische** — Registrierung, Profil, CPV, Empfänger,
 * Bewertung, Vorgang. Lesen unter `radar.lesen`, schreiben unter dem Recht,
 * das die Sache trägt; darüber die interne Decke (K-04): ein `mitarbeiter`
 * sitzt innerhalb des Mandanten und hat mit der Vergabepipeline nichts zu
 * tun.
 */
do $$
declare t text;
begin
  foreach t in array array['mandant_plattform_registrierung', 'radar_profil', 'radar_profil_cpv',
                           'radar_profil_empfaenger', 'bewertung', 'ausschreibung_vorgang']
  loop
    execute format($p$
      create policy t_lesen on %I for select to cse_app
        using (mandant_id = app.aktiver_mandant()
               and (select app.hat_recht('radar.lesen', app.aktiver_mandant())))$p$, t);
    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.radar.lesen')))$p$, t);
    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
    execute format('grant select on %I to cse_app, cse_job', t);
    execute format('create policy j_%1$s on %1$I for all to cse_job using (true) with check (true)', t);
  end loop;
end $$;

/** Profile und CPV-Zeilen schreibt, wer Profile schreiben darf (RAD-04). */
create policy t_profil_schreiben on radar_profil for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.profil_schreiben', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.profil_schreiben', app.aktiver_mandant()));
create policy t_cpv_schreiben on radar_profil_cpv for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.profil_schreiben', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.profil_schreiben', app.aktiver_mandant()));
create policy t_empfaenger_schreiben on radar_profil_empfaenger for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.profil_schreiben', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.profil_schreiben', app.aktiver_mandant()));

/** Der Registrierungsstand ist eine eigene Verwaltung (RAD-09). */
create policy t_registrierung_schreiben on mandant_plattform_registrierung for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.plattform_verwalten', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.plattform_verwalten', app.aktiver_mandant()));

/** Der Vorgang: Status setzen ist das Recht, das RAD-07 nennt. */
create policy t_vorgang_schreiben on ausschreibung_vorgang for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.status_setzen', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('radar.status_setzen', app.aktiver_mandant()));

grant insert, update on mandant_plattform_registrierung, radar_profil, radar_profil_cpv,
                        radar_profil_empfaenger, ausschreibung_vorgang to cse_app;
/**
 * **Bewertungen schreibt `cse_app` NICHT.** Sie entstehen im Lauf des
 * Bewertungsjobs; ein Schreibrecht in der Anwendungsrolle wäre die Tür, durch
 * die eine Punktzahl von Hand entstehen könnte — und RAD-05 lebt davon, dass
 * sie das nie tut.
 */
grant insert on bewertung to cse_job;
