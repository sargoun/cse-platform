-- ===========================================================================
-- 0202 — migration_lauf und migration_zeile: die Uebernahmeform fuer
--        Altsysteme (ROADMAP Phase 10, 07-INTEGRATIONEN §25.3
--        `MigrationImportPort`, OPS-04-Muster, O-128)
--
-- **Die FORM steht hier, der PARSER nicht.** O-128 ist unbeantwortet: in
-- welchem Format Aplano, Lexware und die bestehenden Excel-Dateien
-- exportieren, welcher Zeitraum uebernommen wird, und ob die historischen
-- Daten revisionssicher ins GoBD-Archiv muessen. Ohne Format gibt es keinen
-- Parser — und ein geratener Parser ist bei § 17-MiLoG-Zeitnachweisen und
-- GoBD-Rechnungen kein Komfortfehler, sondern ein Compliance-Fehler. Diese
-- Migration legt deshalb genau das an, was formatunabhaengig ist: den LAUF
-- mit seinem Zustand und seiner Pruefsumme, und die ROHZEILE, an der eine
-- Vorschau vor der Uebernahme haengt.
--
-- **Warum nicht `raumbuch_import` (0026).** Die Tabelle hat genau diese Form
-- — Vorschau, Spaltenzuordnung, Fehlerbericht, Uebernahme —, ist aber an
-- `objekt_id` gebunden. Ein Zeitnachweis aus Aplano gehoert zu keinem Objekt,
-- eine Lexware-Rechnung auch nicht. Die Bindung zu loesen hiesse, die
-- Raumbuchuebernahme umzubauen; eine eigene Tabelle kostet weniger und
-- riskiert nichts.
--
-- **Zwei Regeln, die vor dem Parser schon feststehen** und die deshalb hier
-- als Kommentar stehen, nicht erst im Dienst:
--  - Uebernommene Zeiten sind HISTORISCHE Zeilen mit `quelle = 'migration'`
--    und ohne Serveruhr-Anspruch (Invariante 5). Die Serveruhr war 2024 nicht
--    dabei; zu behaupten, sie sei es gewesen, waere eine Faelschung.
--  - Uebernommene Rechnungen kommen als BELEG und nie in einen
--    `nummernkreis` und nie in die Hashkette (`extern_abgeschlossen`). Eine
--    Lexware-Nummer in den eigenen Kreis zu ziehen erzeugte Luecken oder
--    Doppelnummern — beides ist ein GoBD-Befund.
--
-- **Kein `DELETE`** (Invariante 8): ein Uebernahmelauf ist der Nachweis,
-- WOHER ein historischer Datensatz kommt. Verworfen wird er, nicht geloescht.
-- ===========================================================================

create table migration_lauf (
  id         uuid not null default gen_random_uuid(),
  mandant_id uuid not null references mandant(id),

  /**
   * Das Altsystem. `CHECK` und kein Enum: ein Enum-Wert waere in einer
   * eigenen Migration nachzutragen (Postgres erlaubt `add value` nicht in
   * derselben Transaktion wie seine Benutzung), und die drei Quellen stehen
   * in der ROADMAP.
   */
  quelle text not null,

  datei_name         text not null,
  /** SHA-256 der hochgeladenen Datei — die Wiederholungserkennung (D-467-Muster). */
  datei_sha256       text not null,
  datei_groesse_bytes bigint not null,

  /**
   * Der Zustand. `entwurf` → `geprueft` → `uebernommen` ist der Weg,
   * `verworfen` der Ausgang. **Vorschau VOR Uebernahme**, wie beim Raumbuch
   * (`services/raumbuch/import.ts`: `pruefe()` dann `uebernimm()`) — nicht
   * wie beim Bankauszug, der sofort bucht.
   */
  status text not null default 'entwurf',

  zeilen_gesamt     integer not null default 0,
  zeilen_gueltig    integer not null default 0,
  zeilen_fehlerhaft integer not null default 0,
  /** Der Fehlerbericht je Lauf, wie `raumbuch_import` ihn fuehrt. */
  fehlerbericht     jsonb,

  /**
   * Warum der Lauf nicht weitergeht — im Regelfall der Satz zu O-128. Ein
   * Lauf, der ohne Grund stehen bleibt, sieht aus wie ein Fehler in der
   * Software.
   */
  bemerkung text,

  geprueft_am     timestamptz,
  geprueft_von    uuid references benutzer(id),
  uebernommen_am  timestamptz,
  uebernommen_von uuid references benutzer(id),
  verworfen_am    timestamptz,
  verworfen_von   uuid references benutzer(id),
  erstellt_am     timestamptz not null default now(),
  erstellt_von    uuid references benutzer(id),
  geaendert_am    timestamptz,
  geaendert_von   uuid references benutzer(id),

  constraint migration_lauf_pk primary key (id),
  constraint migration_lauf_mandant_uk unique (mandant_id, id),
  constraint ml_quelle check (quelle in ('aplano', 'lexware', 'excel')),
  constraint ml_status check (status in ('entwurf', 'geprueft', 'uebernommen', 'verworfen')),
  constraint ml_datei_nicht_leer check (btrim(datei_name) <> ''),
  constraint ml_sha256 check (datei_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ml_groesse_positiv check (datei_groesse_bytes > 0),
  constraint ml_zaehler_nicht_negativ check (
    zeilen_gesamt >= 0 and zeilen_gueltig >= 0 and zeilen_fehlerhaft >= 0),
  /** Die Zaehler muessen aufgehen — sonst ist der Bericht eine Behauptung. */
  constraint ml_zaehler_summe check (zeilen_gueltig + zeilen_fehlerhaft <= zeilen_gesamt),
  constraint ml_geprueft_paarweise check ((geprueft_am is null) = (geprueft_von is null)),
  constraint ml_uebernommen_paarweise check (
    (uebernommen_am is null) = (uebernommen_von is null)),
  constraint ml_verworfen_paarweise check ((verworfen_am is null) = (verworfen_von is null)),
  /**
   * Der Zustand und seine Spuren muessen zusammenpassen. Ein `uebernommen`
   * ohne Namen und Zeitpunkt ist genau die Zeile, die spaeter niemand
   * zuordnen kann — und eine Uebernahme historischer Lohn- und Buchdaten
   * ohne benannten Menschen ist ein GoBD-Befund.
   */
  constraint ml_status_belegt check (
    (status <> 'uebernommen' or uebernommen_am is not null)
    and (status <> 'verworfen' or verworfen_am is not null)
    and (status not in ('geprueft', 'uebernommen') or geprueft_am is not null)),
  /** Dieselbe Datei zweimal in denselben Bereich ist ein Nichtereignis. */
  constraint migration_lauf_datei_uk unique (mandant_id, quelle, datei_sha256)
);

create index migration_lauf_status_idx
  on migration_lauf (mandant_id, status, erstellt_am desc);

comment on table migration_lauf is
  'ROADMAP Phase 10, O-128: ein Uebernahmelauf aus einem Altsystem — Datei, '
  'Pruefsumme, Zustand, Fehlerbericht. Vorschau vor Uebernahme; kein DELETE.';
comment on column migration_lauf.status is
  'entwurf -> geprueft -> uebernommen, oder verworfen. Der Uebergang gehoert dem '
  'Dienst; ml_status_belegt haelt fest, dass jeder Zustand seinen Menschen hat.';

alter table migration_lauf enable row level security;
alter table migration_lauf force  row level security;

create policy t_ml_lesen on migration_lauf for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())));

create policy t_ml_schreiben on migration_lauf for insert to cse_app
  with check (mandant_id = app.assert_genau_ein_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())));

create policy t_ml_fortschreiben on migration_lauf for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())));

/** K-04: Uebernahmelaeufe sind Verwaltung — weder Arbeiter- noch Kundenportal. */
create policy p_ml_intern_decke on migration_lauf as restrictive for all to cse_app
  using      (app.portal() = 'intern')
  with check (app.portal() = 'intern');

create policy d_ml_lesen on migration_lauf for select to cse_definer using (true);

grant select, insert on migration_lauf to cse_app;
grant update (status, zeilen_gesamt, zeilen_gueltig, zeilen_fehlerhaft, fehlerbericht,
              bemerkung, geprueft_am, geprueft_von, uebernommen_am, uebernommen_von,
              verworfen_am, verworfen_von, geaendert_am, geaendert_von)
      on migration_lauf to cse_app;
grant select on migration_lauf to cse_definer;

-- ---------------------------------------------------------------------------
-- 2. migration_zeile — die Rohzeile, an der die Vorschau haengt
-- ---------------------------------------------------------------------------

create table migration_zeile (
  id         uuid not null default gen_random_uuid(),
  mandant_id uuid not null references mandant(id),
  lauf_id    uuid not null,

  /** Die Zeilennummer in der Quelldatei — der Bezug, den ein Mensch sucht. */
  zeilennummer integer not null,
  /**
   * Die Rohzeile, so wie sie in der Datei stand.
   *
   * `jsonb` und nicht getippte Spalten: welche Felder ein Aplano- oder
   * Lexware-Export traegt, ist O-128. Getippte Spalten hier waeren eine
   * Entscheidung ueber ein Format, das niemand gesehen hat — und beim ersten
   * echten Export waeren sie falsch.
   */
  roh jsonb not null,
  /** Die Befunde dieser Zeile. Leer heisst „gueltig", NULL heisst „nicht geprueft". */
  fehler jsonb,
  /** Wurde diese Zeile uebernommen, und wohin? */
  uebernommen_am  timestamptz,
  ziel_tabelle    text,
  ziel_id         text,

  erstellt_am timestamptz not null default now(),

  constraint migration_zeile_pk primary key (id),
  constraint migration_zeile_mandant_uk unique (mandant_id, id),
  /** Zusammengesetzt (K-16): eine Zeile zu einem Lauf einer ANDEREN Gesellschaft
      ist strukturell ausgeschlossen, nicht nur durch RLS. */
  constraint mz_lauf_fk foreign key (mandant_id, lauf_id)
    references migration_lauf (mandant_id, id),
  constraint migration_zeile_uk unique (lauf_id, zeilennummer),
  constraint mz_zeilennummer_positiv check (zeilennummer > 0),
  constraint mz_ziel_paarweise check (
    (uebernommen_am is null) = (ziel_tabelle is null)
    and (ziel_tabelle is null) = (ziel_id is null))
);

create index migration_zeile_lauf_idx on migration_zeile (lauf_id, zeilennummer);

comment on table migration_zeile is
  'Die Rohzeile eines Uebernahmelaufs, fuer die Vorschau vor der Uebernahme. '
  'roh ist jsonb, weil das Quellformat O-128 ist; kein DELETE (Invariante 8).';

alter table migration_zeile enable row level security;
alter table migration_zeile force  row level security;

create policy t_mz_lesen on migration_zeile for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())));

create policy t_mz_schreiben on migration_zeile for insert to cse_app
  with check (mandant_id = app.assert_genau_ein_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())));

create policy t_mz_fortschreiben on migration_zeile for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant())));

create policy p_mz_intern_decke on migration_zeile as restrictive for all to cse_app
  using      (app.portal() = 'intern')
  with check (app.portal() = 'intern');

create policy d_mz_lesen on migration_zeile for select to cse_definer using (true);

grant select, insert on migration_zeile to cse_app;
grant update (fehler, uebernommen_am, ziel_tabelle, ziel_id) on migration_zeile to cse_app;
grant select on migration_zeile to cse_definer;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0202)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- migration_lauf (archiv): ROADMAP Phase 10, LEG-01, ACC-06. Der Lauf ist der Nachweis, WOHER ein historischer Zeit- oder Buchungsdatensatz kommt — Datei, Pruefsumme, wer geprueft und wer uebernommen hat. Ohne ihn ist eine uebernommene Zeile eine Behauptung ueber die Vergangenheit. Verworfen wird ein Lauf ueber `status`, nie durch DELETE.
create trigger trg_migration_lauf_kein_hard_delete
  before delete on migration_lauf
  for each row execute function kern.verhindere_loeschung();
create trigger trg_migration_lauf_kein_truncate
  before truncate on migration_lauf
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on migration_lauf from cse_app, cse_anon, cse_checkin, cse_job;

-- migration_zeile (append): ROADMAP Phase 10, LEG-01. Die Rohzeile belegt, was in der Quelldatei stand, als jemand die Uebernahme freigab. Wird sie geloescht, laesst sich ein uebernommener Zeitnachweis nach § 17 MiLoG nicht mehr gegen seine Quelle halten.
create trigger trg_migration_zeile_kein_hard_delete
  before delete on migration_zeile
  for each row execute function kern.verhindere_loeschung();
create trigger trg_migration_zeile_kein_truncate
  before truncate on migration_zeile
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on migration_zeile from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_migration_lauf_geaendert_am
  before update on migration_lauf
  for each row execute function kern.setze_geaendert_am();

create trigger trg_migration_lauf_audit
  after insert or update or delete on migration_lauf
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
