-- ===========================================================================
-- 0023 — Kalkulation und Kalkulationsposition (OPS-07)
--
-- Eine Kalkulation ist die VERSION einer Preisbegruendung: Lohn, Material,
-- Geraet, Gemeinkosten, Wagnis und Gewinn — festgeschrieben, wenn das Angebot
-- hinausgeht, damit ein Preis auch in zwei Jahren noch erklaerbar ist.
--
-- Drei Entscheidungen, die hier fest verdrahtet sind:
--
--  1. **Die drei offenen Saetze duerfen NULL sein** (O-16). `NOT NULL` ohne
--     Vorgabewert zwaenge jeden Entwurf, einen Stundenverrechnungssatz zu
--     nennen — also einen zu erfinden. Genau das verbietet CLAUDE.md.
--  2. **Festgeschrieben werden kann nur, was vollstaendig ist.** Die
--     Bedingung dazu steht als CHECK: eine eingefrorene, pruefbare
--     Kalkulation kann nicht auf drei unbeantworteten Fragen ruhen.
--  3. **Jede Position traegt ihre Herleitung dreifach** — als Rechenansatz
--     (BAU-02, lesbar), als `operanden` (nachrechenbar) und als
--     `berechnungsweg` (menschenlesbar mit Einheiten). Ein freier Text allein
--     laesst sich nicht nachpruefen; die Operanden lassen es zu, und ein Test
--     rechnet jede Zeile der Demodaten daraus nach.
-- ===========================================================================

create type kalkulation_status as enum ('entwurf','festgeschrieben');

-- PLACEHOLDER — worauf der Gemeinkostenzuschlag rechnet.
-- // TODO(client, O-16): Gemeinkosten auf Lohnkosten, auf Selbstkosten oder je
-- Kostenart getrennt? In der Gebaeudereinigung haeufig Lohn, im Bau haeufig
-- getrennt — beides ist verbreitet, deshalb wird hier NICHT gewaehlt.
create type gemeinkosten_basis as enum ('lohn','selbstkosten','je_kostenart');

create table kalkulation (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  -- Genau EIN Eigentuemer: ein Angebot (Vorkalkulation) oder ein Auftrag
  -- (Nachkalkulation). `angebot_id` bekommt seinen Fremdschluessel in 0024,
  -- `auftrag_id` in 0025 — die Tabellen entstehen dort.
  angebot_id    uuid,
  auftrag_id    uuid,
  version       integer not null default 1,
  status        kalkulation_status not null default 'entwurf',
  -- Das Raumbuch, aus dem sie abgeleitet wurde, und wann es gelesen wurde.
  basis_objekt_id uuid,
  basis_stand_am  timestamptz,
  -- // TODO(client, O-16): Kalkulatorischer Stundenverrechnungssatz je Bereich
  -- und Lohngruppe — bitte die Tarifgrundlage liefern (Gebaeudereinigung,
  -- Sicherheit, Bau).
  stundenverrechnungssatz_cent bigint,
  gemeinkosten_basis gemeinkosten_basis,
  gemeinkosten_bp integer,
  wagnis_gewinn_bp integer,
  ist_platzhalter boolean not null default true,
  summe_lohn_cent          bigint not null default 0,
  summe_material_cent      bigint not null default 0,
  summe_geraet_cent        bigint not null default 0,
  summe_gemeinkosten_cent  bigint not null default 0,
  summe_wagnis_gewinn_cent bigint not null default 0,
  selbstkosten_cent        bigint not null default 0,
  angebotssumme_netto_cent bigint not null default 0,
  bemerkung     text,
  festgeschrieben_am  timestamptz,
  festgeschrieben_von uuid,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint kalkulation_mandant_uk unique (mandant_id, id),
  constraint kalkulation_objekt_fk foreign key (mandant_id, basis_objekt_id)
    references objekt (mandant_id, id),
  constraint kalkulation_ein_eigentuemer
    check (num_nonnulls(angebot_id, auftrag_id) = 1),
  constraint kalkulation_version_positiv check (version >= 1),
  constraint kalkulation_gemeinkosten_bereich
    check (gemeinkosten_bp is null or gemeinkosten_bp between 0 and 100000),
  constraint kalkulation_wagnis_bereich
    check (wagnis_gewinn_bp is null or wagnis_gewinn_bp between 0 and 100000),
  /**
   * Der Kern von OPS-07: festgeschrieben heisst vollstaendig.
   *
   * Ohne diese Bedingung entstuende ein Datensatz, der aussieht wie eine
   * pruefbare Kalkulation und im Preisstreit nichts belegt — weil drei seiner
   * vier Eingangsgroessen nie jemand bestaetigt hat.
   */
  constraint kalkulation_festschreibung_vollstaendig check (
    status <> 'festgeschrieben' or (
      festgeschrieben_am is not null and festgeschrieben_von is not null
      and ist_platzhalter = false
      and stundenverrechnungssatz_cent is not null
      and gemeinkosten_basis is not null
      and gemeinkosten_bp is not null
      and wagnis_gewinn_bp is not null))
);

create unique index kalkulation_angebot_version_uk on kalkulation (angebot_id, version)
  where angebot_id is not null;
create unique index kalkulation_auftrag_version_uk on kalkulation (auftrag_id, version)
  where auftrag_id is not null;
create index kalkulation_status_idx on kalkulation (mandant_id, status);
create index kalkulation_basis_idx on kalkulation (basis_objekt_id)
  where basis_objekt_id is not null;
create index kalkulation_offen_idx on kalkulation (mandant_id)
  where ist_platzhalter and status = 'entwurf';

create table kalkulation_position (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  kalkulation_id uuid not null,
  position_nr   integer not null,
  kostenart     kostenart not null,
  bezeichnung   text not null,
  -- `angebotsposition_id` bekommt seinen Fremdschluessel in 0024.
  angebotsposition_id uuid,
  leistungskatalog_position_id uuid,
  raum_id       uuid,
  belagsart_id  uuid,
  menge         numeric(12,3),
  einheit       text,
  einzelbetrag_cent bigint,
  satz_bp       integer,
  basis_bezugsbetrag_cent bigint,
  betrag_cent   bigint not null,
  -- Schnappschuesse JEDER benutzten Eingangsgroesse — als Werte, nicht als
  -- Verbindungen. Ein Join zeigt den heutigen Wert; hier steht der von damals.
  leistungswert_qm_pro_stunde numeric(10,3), -- nicht-geld: m²/h
  frequenz_faktor numeric(10,4),
  stundensatz_cent bigint,
  zeitwert_minuten numeric(10,3), -- nicht-geld: Minuten je Einheit
  -- Die Herleitung, dreifach: lesbar, nachrechenbar, erklaert.
  rechenansatz  text not null,
  operanden     jsonb not null default '{}'::jsonb,
  berechnungsweg text not null,
  sortierung    integer not null default 0,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,

  primary key (id),
  constraint kp_mandant_uk unique (mandant_id, id),
  constraint kp_kalkulation_fk foreign key (mandant_id, kalkulation_id)
    references kalkulation (mandant_id, id),
  constraint kp_lkp_fk foreign key (mandant_id, leistungskatalog_position_id)
    references leistungskatalog_position (mandant_id, id),
  constraint kp_raum_fk foreign key (mandant_id, raum_id) references raum (mandant_id, id),
  constraint kp_belagsart_fk foreign key (mandant_id, belagsart_id)
    references belagsart (mandant_id, id),
  constraint kp_zuschlag_vollstaendig check (
    kostenart not in ('gemeinkosten','wagnis_gewinn')
    or (satz_bp is not null and basis_bezugsbetrag_cent is not null)),
  constraint kp_menge_vollstaendig check (
    kostenart in ('gemeinkosten','wagnis_gewinn')
    or (menge is not null and einzelbetrag_cent is not null)),
  -- Eine Lohnzeile ohne festgehaltenen Satz laesst sich nicht reproduzieren.
  constraint kp_lohn_mit_satz check (
    kostenart <> 'lohn' or stundensatz_cent is not null),
  constraint kp_herleitung_vorhanden check (
    length(rechenansatz) > 0 and length(berechnungsweg) > 0
    and jsonb_typeof(operanden) = 'object')
);

create unique index kp_position_uk on kalkulation_position (kalkulation_id, position_nr);
create index kp_block_idx on kalkulation_position (mandant_id, kalkulation_id, kostenart, sortierung);
create index kp_angebotsposition_idx on kalkulation_position (angebotsposition_id)
  where angebotsposition_id is not null;
create index kp_raum_idx on kalkulation_position (raum_id) where raum_id is not null;

-- ---------------------------------------------------------------------------
-- Die EINE Definition von "steht noch auf Platzhaltern" (§6).
-- ---------------------------------------------------------------------------

/**
 * Sie sieht auch die Platzhalter, die NICHT auf der Kalkulation selbst
 * stehen: ein bestaetigter Zuschlagssatz auf einem unbestaetigten
 * Leistungswert ergibt keine bestaetigte Kalkulation.
 */
create view kalkulation_platzhalter with (security_invoker = true) as
  select k.id as kalkulation_id, k.mandant_id, k.angebot_id, k.auftrag_id,
         (k.ist_platzhalter
          or k.stundenverrechnungssatz_cent is null
          or k.gemeinkosten_basis is null
          or k.gemeinkosten_bp is null
          or k.wagnis_gewinn_bp is null)                    as kopf_offen,
         exists (select 1 from kalkulation_position p
                   left join belagsart b on b.id = p.belagsart_id
                   left join leistungskatalog_position lp
                          on lp.id = p.leistungskatalog_position_id
                  where p.kalkulation_id = k.id
                    and (b.ist_platzhalter or lp.ist_platzhalter))  as grundlage_offen
    from kalkulation k
   where k.ist_platzhalter
      or k.stundenverrechnungssatz_cent is null
      or k.gemeinkosten_basis is null
      or k.gemeinkosten_bp is null
      or k.wagnis_gewinn_bp is null
      or exists (select 1 from kalkulation_position p
                   left join belagsart b on b.id = p.belagsart_id
                   left join leistungskatalog_position lp
                          on lp.id = p.leistungskatalog_position_id
                  where p.kalkulation_id = k.id
                    and (b.ist_platzhalter or lp.ist_platzhalter));

grant select on kalkulation_platzhalter to cse_app;

-- ---------------------------------------------------------------------------
-- Summen: EINE Anweisung je Aenderung, nicht eine je Zeile.
-- ---------------------------------------------------------------------------

/**
 * Die Summen liegen materialisiert und nicht als Sicht, weil der
 * Angebotseditor sie bei jedem Tastendruck liest — und weil das Einfrieren
 * ein Auseinanderlaufen nach dem einzigen Zeitpunkt, an dem es zaehlte,
 * unmoeglich macht.
 *
 * `selbstkosten_cent` haengt von `gemeinkosten_basis` ab und wird deshalb vom
 * DIENST gesetzt, nicht von einer festen Formel hier: welche Bloecke
 * hineingehoeren, ist genau die offene Frage O-16.
 */
create function kern.aktualisiere_kalkulation_summen() returns trigger
language plpgsql as $$
declare v_id uuid := coalesce(new.kalkulation_id, old.kalkulation_id);
begin
  update public.kalkulation k
     set summe_lohn_cent = s.lohn,
         summe_material_cent = s.material,
         summe_geraet_cent = s.geraet,
         summe_gemeinkosten_cent = s.gemeinkosten,
         summe_wagnis_gewinn_cent = s.wagnis,
         angebotssumme_netto_cent =
           s.lohn + s.material + s.geraet + s.gemeinkosten + s.wagnis
    from (select
            coalesce(sum(betrag_cent) filter (where kostenart = 'lohn'), 0)          as lohn,
            coalesce(sum(betrag_cent) filter (where kostenart = 'material'), 0)      as material,
            coalesce(sum(betrag_cent) filter (where kostenart = 'geraet'), 0)        as geraet,
            coalesce(sum(betrag_cent) filter (where kostenart = 'gemeinkosten'), 0)  as gemeinkosten,
            coalesce(sum(betrag_cent) filter (where kostenart = 'wagnis_gewinn'), 0) as wagnis
          from public.kalkulation_position where kalkulation_id = v_id) s
   where k.id = v_id;
  return null;
end $$;

create trigger kp_summen after insert or update or delete on kalkulation_position
  for each row execute function kern.aktualisiere_kalkulation_summen();

-- ---------------------------------------------------------------------------
-- Das Einfrieren.
-- ---------------------------------------------------------------------------

/**
 * Festgeschrieben heisst festgeschrieben: alles ausser `bemerkung` steht.
 *
 * Eine geaenderte Kalkulation ist eine neue VERSION. Ohne diese Sperre waere
 * "festgeschrieben" ein Wort auf einer Zeile, die sich weiter aendern laesst
 * — und damit genau der auditierbar AUSSEHENDE Datensatz, den §4.5 nicht
 * haben will.
 */
create function kern.kalkulation_eingefroren() returns trigger
language plpgsql as $$
declare v_status kalkulation_status;
begin
  if tg_table_name = 'kalkulation' then
    if tg_op = 'UPDATE' and old.status = 'festgeschrieben' then
      -- Der Uebergang selbst darf noch schreiben; danach nur noch `bemerkung`.
      if new.status <> old.status
         or new.stundenverrechnungssatz_cent is distinct from old.stundenverrechnungssatz_cent
         or new.gemeinkosten_basis is distinct from old.gemeinkosten_basis
         or new.gemeinkosten_bp is distinct from old.gemeinkosten_bp
         or new.wagnis_gewinn_bp is distinct from old.wagnis_gewinn_bp
         or new.ist_platzhalter is distinct from old.ist_platzhalter
         or new.version is distinct from old.version
         or new.angebot_id is distinct from old.angebot_id
         or new.auftrag_id is distinct from old.auftrag_id
         or new.basis_objekt_id is distinct from old.basis_objekt_id
         or new.summe_lohn_cent is distinct from old.summe_lohn_cent
         or new.summe_material_cent is distinct from old.summe_material_cent
         or new.summe_geraet_cent is distinct from old.summe_geraet_cent
         or new.summe_gemeinkosten_cent is distinct from old.summe_gemeinkosten_cent
         or new.summe_wagnis_gewinn_cent is distinct from old.summe_wagnis_gewinn_cent
         or new.selbstkosten_cent is distinct from old.selbstkosten_cent
         or new.angebotssumme_netto_cent is distinct from old.angebotssumme_netto_cent
         or new.festgeschrieben_am is distinct from old.festgeschrieben_am
         or new.festgeschrieben_von is distinct from old.festgeschrieben_von then
        raise exception 'Festgeschriebene Kalkulation: nur die Bemerkung ist noch aenderbar'
          using errcode = 'check_violation',
                hint = 'Eine geaenderte Kalkulation ist eine neue Version.';
      end if;
    end if;
    return new;
  end if;

  select status into v_status from public.kalkulation
   where id = coalesce(new.kalkulation_id, old.kalkulation_id);
  if v_status = 'festgeschrieben' then
    raise exception 'Positionen einer festgeschriebenen Kalkulation sind unveraenderlich'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger kalkulation_eingefroren before update on kalkulation
  for each row execute function kern.kalkulation_eingefroren();
create trigger kp_eingefroren before insert or update or delete on kalkulation_position
  for each row execute function kern.kalkulation_eingefroren();

-- ---------------------------------------------------------------------------
-- Zeilenschutz — Modul `kalkulation`, INTERNE Decke.
-- ---------------------------------------------------------------------------

alter table kalkulation           enable row level security;
alter table kalkulation           force  row level security;
alter table kalkulation_position  enable row level security;
alter table kalkulation_position  force  row level security;

create policy t_mandant on kalkulation for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('kalkulation.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('kalkulation.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * KEINE Gruppenpolicy und KEINE Kundenpolicy.
 *
 * Die interne Kostenstruktur erreicht weder eine Kundensitzung noch eine
 * Mitarbeitersitzung (EMP-13) — dieselbe Regel, die Lohnsaetze innerhalb
 * einer Gesellschaft haelt (D-09 §6, K-05). Die Gruppenansicht sieht Umsatz,
 * nicht Marge.
 */
create policy p_intern_decke on kalkulation as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy t_mandant on kalkulation_position for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('kalkulation.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('kalkulation.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy p_intern_decke on kalkulation_position as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on kalkulation, kalkulation_position to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0023)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- kalkulation (archiv): OPS-07. Die Kalkulation ist die Begruendung eines abgegebenen Preises. Sie zu loeschen nimmt einem Preisstreit seine Grundlage; eine geaenderte Kalkulation ist eine neue Version, keine ersetzte Zeile.
create trigger trg_kalkulation_kein_hard_delete
  before delete on kalkulation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kalkulation_kein_truncate
  before truncate on kalkulation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kalkulation from cse_app, cse_anon, cse_checkin, cse_job;

-- kalkulation_position (archiv): OPS-07, BAU-02. Auf der Position stehen die Schnappschuesse jeder Eingangsgroesse und der Rechenansatz. Ohne sie laesst sich der Betrag nicht mehr nachrechnen, nur noch glauben.
create trigger trg_kalkulation_position_kein_hard_delete
  before delete on kalkulation_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kalkulation_position_kein_truncate
  before truncate on kalkulation_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kalkulation_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_kalkulation_geaendert_am
  before update on kalkulation
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
