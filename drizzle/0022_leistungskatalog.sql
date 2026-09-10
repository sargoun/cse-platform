-- ===========================================================================
-- 0022 — Leistungskatalog (OPS-06)
--
-- Der Katalog eines Gewerks als VERSIONIERTES, veroeffentlichbares Ganzes.
-- Reinigung, Sicherheit und Bau fuehren je einen eigenen; "je Gewerk" ist
-- hier "je Mandant" (TEN-01), weil die drei Gewerke drei Gesellschaften sind.
--
-- Zwei Dinge, die spaeter teuer werden, wenn sie hier fehlen:
--
--  1. **Eine Katalogposition wird nie geloescht, sondern geschlossen.** An ihr
--     haengen `kalkulation_position` und `angebotsposition`; eine geloeschte
--     Position macht ein abgegebenes Angebot unlesbar. `gueltig_bis` ist der
--     Weg, `DELETE` ist keiner.
--  2. **Die Hierarchie ist eine Ordnungszahl, kein Zufall.** Titel, Los und
--     Position bilden dieselbe OZ-Struktur, die ein VOB-Leistungsverzeichnis
--     mitbringt (BAU-01) — ein Elternteil in einem ANDEREN Katalog waere ein
--     Baum, der sich beim Import in zwei Kataloge aufspannt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Vokabulare (§2). STATED kommt aus der SPEC, PLACEHOLDER ist gekennzeichnet
-- und aenderbar nur als geprueft Migration — nicht als stille Datenaenderung.
-- ---------------------------------------------------------------------------

-- STATED — SPEC OPS-07 ("labour + material + equipment + overhead + risk/profit")
create type kostenart as enum ('lohn','material','geraet','gemeinkosten','wagnis_gewinn');

-- PLACEHOLDER — Katalog-Lebenszyklus.
-- // TODO(client, O-73): Katalog-Lebenszyklus bestaetigen — genuegen Entwurf,
-- aktiv und archiviert, oder gibt es eine Freigabestufe dazwischen?
create type katalog_status as enum ('entwurf','aktiv','archiviert');

-- PROVISORISCH — kanonisch gehoert es der Finanzdomaene (FIN-09); es steht
-- hier, weil `leistungskatalog_position` es von der ersten Migration an
-- tragen muss.
-- // TODO(client, O-60): Kommen innergemeinschaftliche Lieferungen oder die
-- Kleinunternehmerregelung (§19 UStG) in einer der drei Gesellschaften vor?
create type steuer_kennzeichen as enum
  ('regelsatz','ermaessigt','steuerfrei','reverse_charge_13b');

-- ---------------------------------------------------------------------------
-- leistungskatalog
-- ---------------------------------------------------------------------------

create table leistungskatalog (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  schluessel    text not null,
  bezeichnung   text not null,
  beschreibung  text,
  version       integer not null default 1,
  -- Die EINE Lebendigkeitsspalte dieser Zeile (§0.5). Kein archiviert_am
  -- daneben: zwei Spalten fuer denselben Zustand widersprechen sich irgendwann.
  status        katalog_status not null default 'entwurf',
  gueltig_ab    date not null,
  gueltig_bis   date,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint leistungskatalog_mandant_uk unique (mandant_id, id),
  constraint leistungskatalog_version_uk unique (mandant_id, schluessel, version),
  constraint leistungskatalog_version_positiv check (version >= 1),
  constraint leistungskatalog_zeitraum_stimmig
    check (gueltig_bis is null or gueltig_bis >= gueltig_ab)
);

-- Genau EINE aktive Fassung je Schluessel. Zwei aktive Kataloge desselben
-- Gewerks hiessen: zwei Listenpreise fuer dieselbe Leistung, und welcher gilt,
-- entschiede die Sortierung der Abfrage.
create unique index leistungskatalog_aktiv_uk on leistungskatalog (mandant_id, schluessel)
  where status = 'aktiv';
create index leistungskatalog_status_idx on leistungskatalog (mandant_id, status);

-- ---------------------------------------------------------------------------
-- leistungskatalog_position
-- ---------------------------------------------------------------------------

create table leistungskatalog_position (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  katalog_id    uuid not null,
  parent_id     uuid,
  -- Ordnungszahl, z. B. 01.02.030 — dieselbe Struktur wie im VOB-LV.
  oz            text not null,
  kurztext      text not null,
  langtext      text,
  -- Freitext, in Zod gegen EINHEITEN geprueft (§0.11): ein LV-Import bringt
  -- Einheiten mit, die keine Liste vorhersieht, und darf daran nicht scheitern.
  einheit       text not null,
  -- Minuten je Einheit (OPS-06 "time values").
  zeitwert_minuten numeric(10,3), -- nicht-geld: Minuten je Einheit
  -- Alternative Basis fuer flaechenbepreiste Leistungen — dieselbe Groesse wie
  -- in `belagsart`, hier je Katalogposition.
  leistungswert_qm_pro_stunde numeric(10,3), -- nicht-geld: m²/h
  standard_einzelpreis_cent bigint,
  kostenart     kostenart,
  steuer_kennzeichen steuer_kennzeichen not null default 'regelsatz',
  -- §14 Abs. 4 Nr. 8 UStG: eine steuerfreie Zeile muss ihren Grund drucken.
  steuerbefreiung_grund text,
  -- // TODO(client, O-05): Erloeskonto je Leistungsart (SKR03 oder SKR04)?
  erloeskonto_schluessel text,
  -- // TODO(client, O-59): Zeitwerte und Listenpreise je Leistung — bestaetigen
  -- oder liefern. Bis dahin ist jede Zeile ein Platzhalter und sagt es.
  ist_platzhalter boolean not null default true,
  gueltig_ab    date not null,
  gueltig_bis   date,
  sortierung    integer not null default 0,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint lkp_mandant_uk unique (mandant_id, id),
  constraint lkp_katalog_fk foreign key (mandant_id, katalog_id)
    references leistungskatalog (mandant_id, id),
  constraint lkp_parent_fk foreign key (mandant_id, parent_id)
    references leistungskatalog_position (mandant_id, id),
  constraint lkp_kein_selbstelternteil check (parent_id is null or parent_id <> id),
  constraint lkp_zeitwert_positiv
    check (zeitwert_minuten is null or zeitwert_minuten > 0),
  constraint lkp_leistungswert_positiv
    check (leistungswert_qm_pro_stunde is null or leistungswert_qm_pro_stunde > 0),
  /**
   * Eine Position ohne Zeitwert, ohne Leistungswert UND ohne Listenpreis
   * laesst sich nicht kalkulieren. Sie waere eine Zeile, die im Angebot
   * erscheint und im Preis fehlt.
   */
  constraint lkp_kalkulierbar check (
    zeitwert_minuten is not null
    or leistungswert_qm_pro_stunde is not null
    or standard_einzelpreis_cent is not null),
  constraint lkp_steuerfrei_mit_grund check (
    steuer_kennzeichen <> 'steuerfrei' or steuerbefreiung_grund is not null),
  constraint lkp_zeitraum_stimmig check (gueltig_bis is null or gueltig_bis >= gueltig_ab)
);

-- `gueltig_bis is null` ist die offene Position; geschlossene duerfen ihre OZ
-- an die Nachfolgerin abgeben.
create unique index lkp_oz_uk on leistungskatalog_position (katalog_id, oz)
  where gueltig_bis is null;
create index lkp_liste_idx on leistungskatalog_position (mandant_id, katalog_id, sortierung);
create index lkp_parent_idx on leistungskatalog_position (parent_id);
-- Die Positionssuche im Angebotseditor.
create index lkp_kurztext_trgm on leistungskatalog_position using gin (kurztext gin_trgm_ops);
-- Der Platzhalterbericht (§8): welche Zeilen warten auf eine Antwort?
create index lkp_platzhalter_idx on leistungskatalog_position (mandant_id)
  where ist_platzhalter;

-- ---------------------------------------------------------------------------
-- Hierarchie: kein Zyklus, kein Elternteil in einem fremden Katalog.
-- ---------------------------------------------------------------------------

create function kern.pruefe_katalog_hierarchie() returns trigger
language plpgsql as $$
declare
  v_lauf uuid := new.parent_id;
  v_tiefe integer := 0;
  v_eltern_katalog uuid;
begin
  if new.parent_id is null then return new; end if;

  select katalog_id into v_eltern_katalog
    from public.leistungskatalog_position where id = new.parent_id;
  if v_eltern_katalog is distinct from new.katalog_id then
    raise exception 'Elternposition gehoert zu einem anderen Katalog'
      using errcode = 'foreign_key_violation';
  end if;

  /**
   * Der Zyklus wird GEGANGEN, nicht geraten.
   *
   * Eine Tiefenbegrenzung allein faende den Zyklus auch — aber erst nach 64
   * Schritten und mit einer Fehlermeldung ueber die Tiefe statt ueber den
   * Zyklus. Hier bricht die Schleife ab, sobald sie bei der eigenen Zeile
   * ankommt, und sagt das auch.
   */
  while v_lauf is not null loop
    if v_lauf = new.id then
      raise exception 'Zyklus in der Kataloghierarchie' using errcode = 'check_violation';
    end if;
    v_tiefe := v_tiefe + 1;
    if v_tiefe > 64 then
      raise exception 'Kataloghierarchie tiefer als 64 Stufen' using errcode = 'check_violation';
    end if;
    select parent_id into v_lauf from public.leistungskatalog_position where id = v_lauf;
  end loop;
  return new;
end $$;

create trigger lkp_hierarchie before insert or update of parent_id, katalog_id
  on leistungskatalog_position
  for each row execute function kern.pruefe_katalog_hierarchie();

/**
 * Ein archivierter Katalog nimmt keine Positionen mehr auf und laesst seine
 * bestehenden in Ruhe. Ohne das waere "archiviert" eine Beschriftung.
 */
create function kern.pruefe_katalog_offen() returns trigger
language plpgsql as $$
declare v_status katalog_status;
begin
  select status into v_status from public.leistungskatalog
   where id = coalesce(new.katalog_id, old.katalog_id);
  if v_status = 'archiviert' then
    raise exception 'Der Katalog ist archiviert — Positionen sind unveraenderlich'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger lkp_katalog_offen before insert or update on leistungskatalog_position
  for each row execute function kern.pruefe_katalog_offen();

-- ---------------------------------------------------------------------------
-- Zeilenschutz (K-03) — Modul `katalog`, INTERNE Decke.
-- ---------------------------------------------------------------------------

alter table leistungskatalog          enable row level security;
alter table leistungskatalog          force  row level security;
alter table leistungskatalog_position enable row level security;
alter table leistungskatalog_position force  row level security;

create policy t_mandant on leistungskatalog for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('katalog.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('katalog.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on leistungskatalog for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.stammdaten.lesen')));

/**
 * Der Katalog traegt Listenpreise und Zeitwerte — die Kalkulationsgrundlage.
 * Im Kundenportal ist er Verhandlungsstoff gegen uns; im Mitarbeiterportal
 * hat er keinen Zweck.
 */
create policy p_intern_decke on leistungskatalog as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy t_mandant on leistungskatalog_position for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('katalog.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('katalog.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on leistungskatalog_position for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.stammdaten.lesen')));

create policy p_intern_decke on leistungskatalog_position as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on leistungskatalog, leistungskatalog_position to cse_app;

-- ---------------------------------------------------------------------------
-- Ein Leser fuer die offene Fassung — die Abfrage, die der Angebotseditor
-- sonst an drei Stellen selbst zusammensetzte.
-- ---------------------------------------------------------------------------

create function app.katalog_positionen(p_schluessel text, p_stichtag date default current_date)
returns table (id uuid, oz text, kurztext text, langtext text, einheit text,
               zeitwert_minuten numeric, leistungswert_qm_pro_stunde numeric, -- nicht-geld: m²/h
               standard_einzelpreis_cent bigint, kostenart kostenart,
               steuer_kennzeichen steuer_kennzeichen, ist_platzhalter boolean)
language sql stable security invoker set search_path = pg_catalog, public, app as $$
  select p.id, p.oz, p.kurztext, p.langtext, p.einheit,
         p.zeitwert_minuten, p.leistungswert_qm_pro_stunde,
         p.standard_einzelpreis_cent, p.kostenart, p.steuer_kennzeichen, p.ist_platzhalter
    from public.leistungskatalog_position p
    join public.leistungskatalog k on k.id = p.katalog_id
   where k.schluessel = p_schluessel
     and k.status = 'aktiv'
     and p.gueltig_ab <= p_stichtag
     and (p.gueltig_bis is null or p.gueltig_bis >= p_stichtag)
   order by p.sortierung, p.oz
$$;

grant execute on function app.katalog_positionen(text, date) to cse_app;

-- ---------------------------------------------------------------------------
-- geaendert_am und die Loeschsperren stehen im Register
-- (`src/server/db/schema/rls.ts`) und werden von `pnpm db:triggers` in den
-- Block am Dateiende geschrieben.
-- ---------------------------------------------------------------------------

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0022)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- leistungskatalog (archiv): OPS-06. Der Katalog ist die Fassung, aus der ein abgegebenes Angebot seine Texte und Listenpreise genommen hat. Ein geloeschter Katalog macht dieses Angebot unlesbar; sein Ende ist status = archiviert.
create trigger trg_leistungskatalog_kein_hard_delete
  before delete on leistungskatalog
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungskatalog_kein_truncate
  before truncate on leistungskatalog
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungskatalog from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungskatalog_position (archiv): OPS-06. An der Position haengen kalkulation_position und angebotsposition. Sie zu loeschen bricht die Spur vom Preis zur Leistung; abgeloest wird sie durch gueltig_bis.
create trigger trg_leistungskatalog_position_kein_hard_delete
  before delete on leistungskatalog_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungskatalog_position_kein_truncate
  before truncate on leistungskatalog_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungskatalog_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_leistungskatalog_geaendert_am
  before update on leistungskatalog
  for each row execute function kern.setze_geaendert_am();
create trigger trg_leistungskatalog_position_geaendert_am
  before update on leistungskatalog_position
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
