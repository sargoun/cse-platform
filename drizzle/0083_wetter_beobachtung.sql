-- ===========================================================================
-- 0083 — Das Wetter am Bautag: wetter_station, wetter_beobachtung und die
--        Wetterspalten des Bautagebuchs (BAU-08, OPS-01)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §7.16, §7.17 und
-- §7.12 (die Wetterspalten des Kopfes); `07-INTEGRATIONEN.md` §16.
--
-- Warum das Wetter ueberhaupt in der Datenbank steht und nicht beim Anzeigen
-- geholt wird: ein Bautagebuch ist ein BEWEISMITTEL. Was am 14. September auf
-- der Baustelle gemessen wurde, muss in zwei Jahren noch dasselbe sagen — und
-- der DWD revidiert Messwerte nachtraeglich (darum das Qualitaetsniveau je
-- Beobachtung und der Schnappschuss am Tag). Eine Anzeige, die live abfragt,
-- zeigt im Streitfall die heutige Fassung neben einer Unterschrift von damals.
--
-- Drei Zusagen, und alle drei stehen als Eigenschaft des Schemas, nicht als
-- Absicht des Dienstes:
--
--  1. **Beobachtungszeit UND Station gehoeren zum Wert.** „3 °C" ohne beides
--     ist keine Aussage ueber diese Baustelle: die naechste Station kann
--     40 km entfernt liegen, und das ist ein anderes Beweisgewicht als 3 km.
--     `wetter_beobachtung` traegt `station_id` und `zeitpunkt` als
--     Eindeutigkeitsschluessel, und der Schnappschuss am Tag muss beide
--     nennen (`bautagebuch_wetter_schnappschuss_vollstaendig`).
--  2. **Ohne Quelle keine Zahl.** Steht `wetter_quelle` auf `keine`, sind
--     saemtliche Wetterspalten NULL — geprueft von der Datenbank. Es gibt
--     damit keinen Weg, „0 °C" hinzuschreiben, weil der DWD nicht erreichbar
--     war; die Oberflaeche sagt „Wetterdaten nicht verfuegbar", und der
--     Tageseintrag speichert trotzdem (BAU-08).
--  3. **Eine Beobachtung verschwindet nicht.** `kern.verhindere_loeschung()`
--     auch hier: eine Revision des DWD ist eine NEUE Zeile mit hoeherem
--     Qualitaetsniveau, und der Schnappschuss am Tagebuch haelt fest, was zum
--     Zeitpunkt der Anheftung galt (Invariante 8).
--
-- Keine der beiden Tabellen traegt `mandant_id` (§1.1, §7.16): es sind
-- oeffentliche Referenzdaten des Deutschen Wetterdienstes ohne jede Beziehung
-- zu einer Gesellschaft. Eine Kopie je Mandant waere reine Redundanz — und
-- eine nullbare Mandantenspalte waere die Ausnahme, die K-16(d) allein
-- `audit_log` zugesteht. Die Mandantenbeziehung entsteht erst ueber
-- `bautagebuch.wetter_*_id` und den Schnappschuss.
--
-- Namensnennung (§16): jede Anzeige mit DWD-Werten traegt „Quelle: Deutscher
-- Wetterdienst". Das ist Bedingung der Nutzung der offenen Daten, keine
-- Hoeflichkeit.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.3)
-- ---------------------------------------------------------------------------

/**
 * Zwei Typen statt eines, weil eine Station mit `quelle = 'keine'` nichts
 * bedeutet (§3.3): der Tag sagt, WOHER sein Wetter kommt — auch „gar nicht" —,
 * die Beobachtung sagt, wer gemessen hat, und eine Beobachtung ohne Messung
 * gibt es nicht.
 */
create type bautagebuch_wetter_quelle as enum ('dwd','manuell','keine');
create type messwert_quelle           as enum ('dwd','manuell');

-- ---------------------------------------------------------------------------
-- 2. wetter_station (§7.16)
-- ---------------------------------------------------------------------------

create table wetter_station (
  /**
   * Die DWD-Stationskennung („00433") als PRIMAERSCHLUESSEL — die eine
   * begruendete Ausnahme von der uuid-Regel (§1.1, §7.16): sie ist extern
   * vergeben, stabil, lesbar, und sie macht den Import ueber `on conflict`
   * wiederholbar. Eine uuid daneben waere ein zweiter Schluessel fuer dieselbe
   * Sache, und der Import muesste bei jedem Lauf erst nachschlagen.
   */
  id            text not null,
  name          text not null,
  bundesland    text,
  breitengrad   numeric(9,6) not null,
  laengengrad   numeric(9,6) not null,
  hoehe_m       integer,
  /** Stationen werden stillgelegt — ein Tag von 2019 haengt an einer alten. */
  aktiv_von     date,
  aktiv_bis     date,
  archiviert_am timestamptz,

  /**
   * §1.2 ohne die `*_von`-Spalten: hier schreibt ausschliesslich der Import,
   * und sein Akteur ist `system`. Eine `erstellt_von`-Spalte, die immer NULL
   * ist, behauptete eine Person, die es nie gab.
   */
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  primary key (id),
  constraint wetter_station_name_nicht_leer check (btrim(name) <> ''),
  constraint wetter_station_geo_bereich check (
    breitengrad between -90 and 90 and laengengrad between -180 and 180),
  constraint wetter_station_aktiv_reihenfolge check (
    aktiv_bis is null or aktiv_von is null or aktiv_bis >= aktiv_von)
);

/** Die Suche nach der naechsten Station zu den Koordinaten der Baustelle. */
create index wetter_station_geo_idx on wetter_station (breitengrad, laengengrad)
  where archiviert_am is null;

comment on table wetter_station is
  'DWD-Messstation mit Koordinaten und Betriebszeitraum (§7.16). Oeffentliche '
  'Referenzdaten ohne mandant_id; geschrieben wird ausschliesslich vom Import.';

-- ---------------------------------------------------------------------------
-- 3. wetter_beobachtung (§7.17)
-- ---------------------------------------------------------------------------

create table wetter_beobachtung (
  id            uuid not null default gen_random_uuid(),
  station_id    text not null references wetter_station(id),
  /** Der UTC-Zeitpunkt der Messung (Invariante 2), angezeigt in Berlin. */
  zeitpunkt     timestamptz not null,

  temperatur_c  numeric(4,1),
  niederschlag_mm numeric(6,2),
  windgeschwindigkeit_ms numeric(5,2),
  windboe_ms    numeric(5,2),
  luftfeuchte_prozent numeric(5,2),
  sonnenscheindauer_min smallint,
  schneehoehe_cm numeric(6,2),
  bewoelkung_achtel smallint,
  /** Der DWD revidiert; das Niveau gehoert zum Beweis (§7.17). */
  dwd_qualitaetsniveau smallint,

  quelle        messwert_quelle not null default 'dwd',
  /** Der Rohsatz, unveraendert — das RAD-03-Muster. */
  roh           jsonb,
  abgerufen_am  timestamptz not null default now(),
  erstellt_am   timestamptz not null default now(),

  primary key (id),
  /**
   * Der Schluessel, der den Import wiederholbar macht UND die Abfrage traegt,
   * die das Tagebuch tatsaechlich stellt: eine Station, ein Tag. Der BRIN-Index
   * des Entwurfs auf `zeitpunkt` faellt weg (§7.17) — BRIN setzt physische
   * Zeitkorrelation voraus, die ein stationsweiser Nachlauf zerstoert.
   */
  constraint wetter_beobachtung_uk unique (station_id, zeitpunkt),
  constraint wetter_beobachtung_luftfeuchte check (
    luftfeuchte_prozent is null or luftfeuchte_prozent between 0 and 100),
  constraint wetter_beobachtung_bewoelkung check (
    bewoelkung_achtel is null or bewoelkung_achtel between 0 and 8),
  constraint wetter_beobachtung_sonne check (
    sonnenscheindauer_min is null or sonnenscheindauer_min >= 0)
);

comment on table wetter_beobachtung is
  'Eine DWD-Beobachtung einer Station zu einem Zeitpunkt (§7.17) — die Quelle, '
  'aus der das Bautagebuch sein Wetter zieht. Anfuegend; eine Revision ist eine '
  'neue Zeile mit hoeherem Qualitaetsniveau.';
comment on column wetter_beobachtung.zeitpunkt is
  'Die BEOBACHTUNGSZEIT in UTC — nicht der Abrufzeitpunkt. Beides zu '
  'verwechseln datiert eine Messung auf den Moment ihres Herunterladens.';

-- ---------------------------------------------------------------------------
-- 4. Die Wetterspalten des Bautagebuchs (§7.12) und die Station am Projekt
-- ---------------------------------------------------------------------------

/**
 * Sie stehen hier und nicht in 0082, weil ein Fremdschluessel seinem Ziel
 * nicht vorausgehen kann und die Migrationen in Dateinamenreihenfolge laufen
 * (0082, Kopfkommentar c).
 */
alter table bautagebuch
  add column wetter_quelle bautagebuch_wetter_quelle not null default 'keine',
  add column wetter_frueh_id  uuid references wetter_beobachtung(id),
  add column wetter_mittag_id uuid references wetter_beobachtung(id),
  add column wetter_abend_id  uuid references wetter_beobachtung(id),
  /** Die Werte, WIE ANGEHEFTET — samt Station, Beobachtungszeit und Niveau. */
  add column wetter_snapshot jsonb,
  add column temperatur_min_c numeric(4,1),
  add column temperatur_max_c numeric(4,1),
  add column niederschlag_mm numeric(6,2),
  /** Die Beobachtung des Menschen daneben — sie ersetzt keine Messung. */
  add column wetter_notiz text,
  /**
   * AUSSCHLIESSLICH manuell gesetzt. Kein Job leitet dieses Feld ab:
   * // TODO(client, O-158): Ab welchem Schwellenwert gilt Witterung als
   * arbeitsbehindernd — Temperatur, Niederschlag, Windstaerke, je Gewerk?
   */
  add column arbeitsbehindernde_witterung boolean;

/**
 * „DWD" heisst: es gibt eine Beobachtung und einen Schnappschuss dazu.
 *
 * Ohne diese Bedingung liesse sich ein Tag als DWD-belegt markieren, dessen
 * Werte jemand eingetippt hat — genau die Verwechslung, die BAU-08 ausschliesst.
 */
alter table bautagebuch add constraint bautagebuch_wetter_dwd_belegt check (
  wetter_quelle <> 'dwd'
  or (wetter_snapshot is not null
      and (wetter_frueh_id is not null or wetter_mittag_id is not null
           or wetter_abend_id is not null)));

/**
 * „keine" heisst: KEINE Zahl. Das ist die Zusage aus BAU-08 als Bedingung —
 * ist der DWD nicht erreichbar, steht im Feld „Wetterdaten nicht verfuegbar",
 * und es steht dort nichts anderes. `wetter_notiz` bleibt erlaubt: ein Satz
 * eines Menschen („den ganzen Tag Regen") ist eine Beobachtung mit Urheber und
 * keine erfundene Messung.
 */
alter table bautagebuch add constraint bautagebuch_ohne_quelle_ohne_wert check (
  wetter_quelle <> 'keine'
  or (wetter_snapshot is null and temperatur_min_c is null and temperatur_max_c is null
      and niederschlag_mm is null and wetter_frueh_id is null
      and wetter_mittag_id is null and wetter_abend_id is null));

/**
 * Der Schnappschuss nennt Station UND Beobachtungszeit — sonst ist er keiner.
 *
 * Nebenbei faengt diese Bedingung den Fehler ab, der `jsonb` am haeufigsten
 * kaputtmacht: wer `JSON.stringify(obj)` in einen `$n::jsonb`-Parameter gibt,
 * legt eine JSON-ZEICHENKETTE in die Spalte, und `->>` liefert danach NULL.
 * Hier faellt das beim Schreiben auf statt beim Lesen in zwei Jahren.
 */
alter table bautagebuch add constraint bautagebuch_wetter_schnappschuss_vollstaendig check (
  wetter_snapshot is null
  or (jsonb_typeof(wetter_snapshot) = 'object'
      and wetter_snapshot ->> 'station_id' is not null
      and wetter_snapshot ->> 'beobachtet_am' is not null));

alter table bautagebuch add constraint bautagebuch_temperaturfolge check (
  temperatur_min_c is null or temperatur_max_c is null
  or temperatur_max_c >= temperatur_min_c);

/** Witterungsbelege fuer die Behinderungsanzeige (BAU-06). */
create index bautagebuch_witterung_idx on bautagebuch (mandant_id, projekt_id, datum)
  where arbeitsbehindernde_witterung;

comment on column bautagebuch.wetter_snapshot is
  'Die Werte, wie sie angeheftet wurden — mit Station, Beobachtungszeit, '
  'Entfernung und DWD-Qualitaetsniveau. Der DWD revidiert; der Beweis nicht.';
comment on column bautagebuch.wetter_quelle is
  'dwd | manuell | keine. Bei „keine" sind alle Wetterwerte NULL — die '
  'Datenbank laesst nichts anderes zu (BAU-08).';

/**
 * Die einmal aufgeloeste Station am Projekt (§7.1): damit BAU-08
 * nachvollziehbar bleibt. Ohne sie kann derselbe Bautag beim naechsten Lauf an
 * einer anderen Station haengen, weil eine naehere in Betrieb ging — und zwei
 * Tage desselben Projekts waeren nicht mehr vergleichbar.
 */
alter table projekt add column wetter_station_id text references wetter_station(id);

comment on column projekt.wetter_station_id is
  'Die einmal aufgeloeste DWD-Station der Baustelle (§7.1, BAU-08). Ohne '
  'Koordinaten am Objekt bleibt sie NULL, und das ist ein EIGENER Grund — '
  'nicht „der DWD hatte keine Daten".';

-- ---------------------------------------------------------------------------
-- 5. Der Schreibweg (§7.16, §7.17)
-- ---------------------------------------------------------------------------

/**
 * `app.wetter_beobachtung_uebernehmen` — die EINE Tuer, durch die eine
 * Beobachtung in die Datenbank kommt.
 *
 * §7.16/§7.17 geben den beiden Tabellen einen Schreibweg fuer `cse_job` (den
 * naechtlichen Import). Die Anheftung eines Tages geschieht aber auch aus
 * einer SITZUNG heraus — die Bauleitung drueckt „Wetter nachtragen", weil der
 * Lauf um 06:30 den DWD nicht erreicht hat. Ohne diese Funktion muesste dafuer
 * `cse_app` auf beiden Tabellen schreiben duerfen, und damit koennte jede
 * angemeldete Sitzung Messwerte erfinden.
 *
 * Die Funktion nimmt deshalb genau das entgegen, was ein Adapter aus einer
 * Quelle gelesen hat, schreibt idempotent (`on conflict`) und gibt die
 * Kennung zurueck. Sie erfindet nichts: ohne Station und ohne Zeitpunkt gibt
 * es keine Zeile.
 */
create function app.wetter_beobachtung_uebernehmen(
  p_station_id text,
  p_name text,
  p_breitengrad numeric,
  p_laengengrad numeric,
  p_zeitpunkt timestamptz,
  p_temperatur_c numeric,
  p_niederschlag_mm numeric,
  p_wind_ms numeric,
  p_qualitaetsniveau smallint,
  p_roh jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid;
begin
  if p_station_id is null or btrim(p_station_id) = '' or p_zeitpunkt is null then
    raise exception 'Eine Beobachtung ohne Station und ohne Zeitpunkt ist keine'
      using errcode = 'check_violation';
  end if;

  insert into public.wetter_station (id, name, breitengrad, laengengrad)
  values (p_station_id, coalesce(nullif(btrim(p_name), ''), p_station_id),
          p_breitengrad, p_laengengrad)
  on conflict (id) do nothing;

  insert into public.wetter_beobachtung
    (station_id, zeitpunkt, temperatur_c, niederschlag_mm, windgeschwindigkeit_ms,
     dwd_qualitaetsniveau, quelle, roh)
  values
    (p_station_id, p_zeitpunkt, p_temperatur_c, p_niederschlag_mm, p_wind_ms,
     p_qualitaetsniveau, 'dwd', p_roh)
  on conflict (station_id, zeitpunkt) do nothing
  returning id into v_id;

  if v_id is null then
    select b.id into v_id from public.wetter_beobachtung b
     where b.station_id = p_station_id and b.zeitpunkt = p_zeitpunkt;
  end if;
  return v_id;
end $$;

comment on function app.wetter_beobachtung_uebernehmen is
  'Nimmt eine gelesene Beobachtung idempotent auf (BAU-08). security definer, '
  'weil cse_app auf wetter_beobachtung sonst schreiben duerfte — und damit '
  'Messwerte erfinden koennte.';

revoke execute on function app.wetter_beobachtung_uebernehmen(
  text, text, numeric, numeric, timestamptz, numeric, numeric, numeric, smallint, jsonb)
  from public;
grant execute on function app.wetter_beobachtung_uebernehmen(
  text, text, numeric, numeric, timestamptz, numeric, numeric, numeric, smallint, jsonb)
  to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- 6. RLS (§7.16, §7.17)
-- ---------------------------------------------------------------------------

/**
 * Nicht mandantengebunden — es gibt hier nichts zu isolieren. Gelesen wird von
 * jeder angemeldeten Sitzung, geschrieben vom Import (`cse_job`) und von der
 * Definer-Funktion oben. FORCE steht trotzdem, weil der Eigentuemer sonst von
 * seinen eigenen Policies ausgenommen waere (K-01).
 */
alter table wetter_station enable row level security;
alter table wetter_station force  row level security;

create policy t_lesen on wetter_station for select to cse_app using (true);
create policy j_import on wetter_station for all to cse_job using (true) with check (true);
create policy d_uebernahme on wetter_station for all to cse_definer
  using (true) with check (true);

grant select on wetter_station to cse_app;
grant select, insert, update on wetter_station to cse_job, cse_definer;

alter table wetter_beobachtung enable row level security;
alter table wetter_beobachtung force  row level security;

create policy t_lesen on wetter_beobachtung for select to cse_app using (true);
create policy j_import on wetter_beobachtung for all to cse_job using (true) with check (true);
create policy d_uebernahme on wetter_beobachtung for all to cse_definer
  using (true) with check (true);

grant select on wetter_beobachtung to cse_app;
grant select, insert on wetter_beobachtung to cse_job, cse_definer;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0083)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- wetter_station (archiv): BAU-08. An der Station haengt jede Beobachtung, und an der Beobachtung der Wetterbeleg eines Bautags. Eine stillgelegte Station bekommt archiviert_am — geloescht verloeren alle Tage, die auf sie zeigen, ihren Messort, und „3 °C" ohne Ort ist keine Aussage.
create trigger trg_wetter_station_kein_hard_delete
  before delete on wetter_station
  for each row execute function kern.verhindere_loeschung();
create trigger trg_wetter_station_kein_truncate
  before truncate on wetter_station
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on wetter_station from cse_app, cse_anon, cse_checkin, cse_job;

-- wetter_beobachtung (append): BAU-07, BAU-08, LEG-01. Die Messung, auf die sich ein Bautagebuch beruft. Der DWD revidiert Werte — eine Revision ist eine NEUE Zeile mit hoeherem Qualitaetsniveau, nie ein Ersetzen der alten. Geloescht zeigte der Tag auf nichts, und der Schnappschuss daneben liesse sich nicht mehr gegenpruefen.
create trigger trg_wetter_beobachtung_kein_hard_delete
  before delete on wetter_beobachtung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_wetter_beobachtung_kein_truncate
  before truncate on wetter_beobachtung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on wetter_beobachtung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_wetter_station_geaendert_am
  before update on wetter_station
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
