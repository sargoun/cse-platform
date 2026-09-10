-- ===========================================================================
-- 0024 — Angebot, Angebotsposition, Angebotssteuer (OPS-08)
--
-- Das Angebot, wie der Kunde es sieht: eine Identitaet, ein Kunde,
-- Positionen, eine Bindefrist. Entwuerfe tragen KEINE Nummer; die Nummer
-- entsteht, wenn das Angebot das Haus verlaesst.
--
-- Der Versand ist der Kern dieser Datei, und er ist drei Ausloeser in FESTER
-- Reihenfolge — die Namen tragen die Reihenfolge, weil Postgres gleichartige
-- Ausloeser in Namensreihenfolge feuert:
--
--   1. `angebot_10_versand_pruefen`       — verweigert den Versand, solange
--      eine angehaengte Kalkulation auf Platzhaltern steht.
--   2. `angebot_20_versand_stempeln`      — Serverzeit und Angebotsnummer.
--   3. `angebot_30_versand_festschreiben` — schreibt die Steuerzeilen und
--      friert die Kalkulation ein.
--
-- Ohne die Reihenfolge wiesen sich zwei von ihnen gegenseitig ab: die Sperre
-- verbietet das Schreiben einer `angebot_steuer`-Zeile, sobald `versendet_am`
-- steht — und Schritt 3 schreibt genau so eine Zeile in derselben Anweisung,
-- die `versendet_am` setzt.
-- ===========================================================================

-- PLACEHOLDER  // TODO(client, O-73): Angebots-Lebenszyklus — ist
-- "in_pruefung" der interne Vier-Augen-Schritt oder die Pruefung beim Kunden?
create type angebot_status as enum
  ('entwurf','in_pruefung','versendet','angenommen','abgelehnt','zurueckgezogen','abgelaufen');

-- PLACEHOLDER — VOB-Positionsarten.
-- // TODO(client, O-73): Werden Bedarfs-/Eventual- und Alternativpositionen
-- im Leistungsverzeichnis verwendet?
create type angebotsposition_typ as enum
  ('leistung','alternativ','eventual','text','zwischensumme');

create table angebot (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  -- NULL bis zum Versand. Gezogen aus `nummernkreis`.
  angebotsnummer text,
  kunde_id      uuid not null,
  ansprechpartner_id uuid,
  objekt_id     uuid,
  lead_id       uuid,
  titel         text not null,
  einleitungstext text,
  schlusstext   text,
  status        angebot_status not null default 'entwurf',
  version       integer not null default 1,
  ersetzt_angebot_id uuid,
  gueltig_bis   date,
  waehrung      text not null default 'EUR',
  -- Ausloeser-gepflegte Summe der `typ = 'leistung'`-Positionen.
  netto_cent    bigint not null default 0,
  leistungszeitraum_von date,
  leistungszeitraum_bis date,
  freigegeben_am timestamptz,
  freigegeben_von uuid references benutzer(id),
  versendet_am  timestamptz,
  versendet_von uuid references benutzer(id),
  entschieden_am timestamptz,
  entscheidung_notiz text,
  akteur_art    akteur_art not null default 'mensch',
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint angebot_mandant_uk unique (mandant_id, id),
  constraint angebot_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint angebot_ansprechpartner_fk
    foreign key (mandant_id, kunde_id, ansprechpartner_id)
    references ansprechpartner (mandant_id, kunde_id, id),
  constraint angebot_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint angebot_lead_fk foreign key (mandant_id, lead_id) references lead (mandant_id, id),
  constraint angebot_vorgaenger_fk foreign key (mandant_id, ersetzt_angebot_id)
    references angebot (mandant_id, id),
  constraint angebot_waehrung_eur check (waehrung = 'EUR'),
  constraint angebot_version_positiv check (version >= 1),
  constraint angebot_kein_selbstersatz
    check (ersetzt_angebot_id is null or ersetzt_angebot_id <> id),
  /**
   * Nummer und Versand sind DASSELBE Ereignis.
   *
   * Auf den STATUS gekeyt waere `in_pruefung` unerreichbar: ein Angebot in
   * der internen Vier-Augen-Pruefung ist nicht versendet, hat also keine
   * Nummer — und die Bedingung wiese genau den Zustand ab, auf dem
   * Invariante 7 beruht.
   */
  constraint angebot_nummer_bei_versand
    check ((angebotsnummer is null) = (versendet_am is null)),
  /**
   * Invariante 7 in der Datenbank: nichts verlaesst das System ohne benannte
   * menschliche Freigabe. Ein Agent erreicht `in_pruefung` und keinen Schritt
   * weiter — bei jedem Betrag.
   */
  constraint angebot_freigabe_vor_versand check (
    status in ('entwurf','in_pruefung','zurueckgezogen')
    or (freigegeben_von is not null and versendet_am is not null)),
  constraint angebot_rueckzug_ehrlich check (
    status <> 'zurueckgezogen' or versendet_am is null or freigegeben_von is not null),
  constraint angebot_leistungszeitraum_stimmig check (
    leistungszeitraum_bis is null or leistungszeitraum_von is null
    or leistungszeitraum_bis >= leistungszeitraum_von)
);

create unique index angebot_nummer_uk on angebot (mandant_id, angebotsnummer)
  where angebotsnummer is not null;
-- Ein Nachfolger je Vorgaenger: zwei v2 auf demselben v1 waeren zwei
-- gueltige Fassungen desselben Angebots.
create unique index angebot_nachfolger_uk on angebot (ersetzt_angebot_id)
  where ersetzt_angebot_id is not null;
create index angebot_offen_idx on angebot (mandant_id, status, gueltig_bis);
create index angebot_kunde_idx on angebot (mandant_id, kunde_id, erstellt_am desc);
create index angebot_lead_idx on angebot (lead_id) where lead_id is not null;
create index angebot_ablauf_idx on angebot (mandant_id, gueltig_bis) where status = 'versendet';

create table angebotsposition (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  angebot_id    uuid not null,
  position_nr   integer not null,
  oz            text,
  typ           angebotsposition_typ not null default 'leistung',
  leistungskatalog_position_id uuid,
  objekt_id     uuid,
  raum_id       uuid,
  kurztext      text not null,
  langtext      text,
  menge         numeric(12,3),
  einheit       text,
  -- Ganze Cent; darf fuer eine Nachlasszeile negativ sein.
  einzelpreis_cent bigint,
  -- Kaufmaennische Rundung in exakter numerischer Arithmetik — NIE in
  -- JavaScript, wo aus 0,1 × 3 nicht 0,3 wird.
  gesamtpreis_cent bigint generated always as
    (round(coalesce(menge, 0) * coalesce(einzelpreis_cent, 0))::bigint) stored,
  steuersatz_bp integer not null,
  steuer_kennzeichen steuer_kennzeichen not null default 'regelsatz',
  steuerbefreiung_grund text,
  erloeskonto_schluessel text,
  akteur_art    akteur_art not null default 'mensch',
  sortierung    integer not null default 0,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,

  primary key (id),
  constraint ap_mandant_uk unique (mandant_id, id),
  constraint ap_angebot_fk foreign key (mandant_id, angebot_id)
    references angebot (mandant_id, id),
  constraint ap_lkp_fk foreign key (mandant_id, leistungskatalog_position_id)
    references leistungskatalog_position (mandant_id, id),
  constraint ap_objekt_fk foreign key (mandant_id, objekt_id) references objekt (mandant_id, id),
  constraint ap_raum_fk foreign key (mandant_id, raum_id) references raum (mandant_id, id),
  constraint ap_steuersatz_bereich check (steuersatz_bp between 0 and 10000),
  constraint ap_leistung_vollstaendig check (
    typ <> 'leistung'
    or (menge is not null and einheit is not null and einzelpreis_cent is not null)),
  -- Eine Bedarfsposition mit Menge 0 ist im VOB-LV legitim; eine
  -- LEISTUNGSposition mit Menge 0 waere eine Zeile ohne Wirkung.
  constraint ap_leistung_menge_nicht_null check (typ <> 'leistung' or menge <> 0),
  constraint ap_text_ohne_preis check (
    typ not in ('text','zwischensumme') or (menge is null and einzelpreis_cent is null)),
  -- §13b heisst: keine Umsatzsteuer ausgewiesen. Eine Reverse-Charge-Zeile
  -- mit 19 % ist ein Fehler, kein Sonderfall.
  constraint ap_reverse_charge_ohne_steuer check (
    steuer_kennzeichen <> 'reverse_charge_13b' or steuersatz_bp = 0),
  constraint ap_steuerfrei_mit_grund check (
    steuer_kennzeichen <> 'steuerfrei'
    or (steuersatz_bp = 0 and steuerbefreiung_grund is not null))
);

create unique index ap_position_uk on angebotsposition (angebot_id, position_nr);
create index ap_liste_idx on angebotsposition (mandant_id, angebot_id, sortierung);
create index ap_lkp_idx on angebotsposition (leistungskatalog_position_id)
  where leistungskatalog_position_id is not null;
create index ap_raum_idx on angebotsposition (raum_id) where raum_id is not null;

/**
 * Die Steuerzeilen eines VERSENDETEN Angebots — einmal geschrieben, nie
 * nachgerechnet. Dieselbe Bauart, die K-12 von der kanonischen Nutzlast einer
 * Rechnung verlangt, einen Schritt frueher.
 *
 * Es gibt bewusst KEIN `brutto_cent` auf dem Angebot: §0.6 verbietet, die
 * Umsatzsteuer aus einer Bruttosumme abzuleiten, und eine zweite gepflegte
 * Summe neben dieser Tabelle waere genau das — zwei Wahrheiten fuer eine Zahl.
 */
create table angebot_steuer (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  angebot_id    uuid not null,
  steuersatz_bp integer not null,
  steuer_kennzeichen steuer_kennzeichen not null,
  netto_cent    bigint not null,
  steuer_cent   bigint not null,
  hinweistext   text,
  erstellt_am   timestamptz not null default now(),

  primary key (id),
  constraint as_mandant_uk unique (mandant_id, id),
  constraint as_angebot_fk foreign key (mandant_id, angebot_id)
    references angebot (mandant_id, id),
  constraint as_gruppe_uk unique (angebot_id, steuersatz_bp, steuer_kennzeichen)
);

create index as_angebot_idx on angebot_steuer (mandant_id, angebot_id);

-- Der Fremdschluessel, den 0023 noch nicht setzen konnte.
alter table kalkulation add constraint kalkulation_angebot_fk
  foreign key (mandant_id, angebot_id) references angebot (mandant_id, id);
alter table kalkulation_position add constraint kp_angebotsposition_fk
  foreign key (mandant_id, angebotsposition_id) references angebotsposition (mandant_id, id);

-- ---------------------------------------------------------------------------
-- Die Summe der Positionen.
-- ---------------------------------------------------------------------------

create function kern.aktualisiere_angebot_summen() returns trigger
language plpgsql as $$
declare v_id uuid := coalesce(new.angebot_id, old.angebot_id);
begin
  update public.angebot a
     set netto_cent = coalesce((select sum(gesamtpreis_cent)
                                  from public.angebotsposition
                                 where angebot_id = v_id and typ = 'leistung'), 0)
   where a.id = v_id;
  return null;
end $$;

create trigger ap_summen after insert or update or delete on angebotsposition
  for each row execute function kern.aktualisiere_angebot_summen();

-- ---------------------------------------------------------------------------
-- Der Versand: drei Ausloeser, benannte Reihenfolge.
-- ---------------------------------------------------------------------------

create function kern.angebot_versand_pruefen() returns trigger
language plpgsql as $$
begin
  if old.versendet_am is null and new.versendet_am is not null then
    if exists (select 1 from public.kalkulation_platzhalter kp
                where kp.angebot_id = new.id) then
      raise exception 'Kalkulation enthaelt unbestaetigte Werte — Versand nicht moeglich'
        using errcode = 'CSE01',
              detail = 'Offene Werte: Stundenverrechnungssatz, Gemeinkostenbasis, '
                       || 'Gemeinkosten- und Wagnis-/Gewinnzuschlag (O-16).',
              hint = 'Werte bestaetigen oder die Kalkulation vom Angebot loesen.';
    end if;
  end if;
  return new;
end $$;

/**
 * Serverzeit — und die Pruefung, dass die Nummer mitgekommen ist.
 *
 * Die Zeit kommt vom Server, nie vom Aufrufer (Invariante 5).
 *
 * Die NUMMER zieht der Ausloeser bewusst NICHT. Die lueckenlose Vergabe steht
 * in `server/services/finanz/nummernkreis.ts`: `SELECT … FOR UPDATE` auf der
 * Zaehlerzeile, mit benannten Fehlern fuer den fehlenden, den geschlossenen
 * und den Platzhalterkreis — und mit den Tests, die genau diese Faelle
 * pruefen. Eine zweite Fassung in SQL waere eine zweite Wahrheit ueber die
 * Frage, ob eine Rechnungsnummernfolge Luecken haben darf.
 *
 * Der Dienst zieht die Nummer also und schreibt sie in DERSELBEN Anweisung,
 * die `versendet_am` setzt. Fehlt sie, wird hier abgewiesen — mit einem Satz
 * statt mit dem `23514` der Bedingung, die dasselbe sagt.
 */
create function kern.angebot_versand_stempeln() returns trigger
language plpgsql as $$
begin
  if old.versendet_am is null and new.versendet_am is not null then
    new.versendet_am := now();
    if new.angebotsnummer is null then
      raise exception 'Versand ohne Angebotsnummer'
        using errcode = 'CSE02',
              detail = 'Die Nummer wird vom Dienst aus dem Nummernkreis gezogen '
                       || '(vergebeNummer) und im selben UPDATE gesetzt.',
              hint = 'Fehlt ein Angebotskreis fuer diese Gesellschaft?';
    end if;
  end if;
  return new;
end $$;

/**
 * Die Steuerzeilen und das Einfrieren der Kalkulation.
 *
 * Der transaktionslokale Waechter traegt die ID DIESES Angebots, nicht ein
 * blosses Ja/Nein: ein Schalter taute jedes versendete Angebot fuer den Rest
 * der Transaktion wieder auf, und ein Stapelversand oeffnete sie damit alle.
 */
create function kern.angebot_versand_festschreiben() returns trigger
language plpgsql as $$
begin
  if old.versendet_am is null and new.versendet_am is not null then
    perform set_config('app.angebot_versand', new.id::text, true);

    insert into public.angebot_steuer
      (mandant_id, angebot_id, steuersatz_bp, steuer_kennzeichen, netto_cent, steuer_cent,
       hinweistext)
    select new.mandant_id, new.id, p.steuersatz_bp, p.steuer_kennzeichen,
           sum(p.gesamtpreis_cent),
           round(sum(p.gesamtpreis_cent) * p.steuersatz_bp / 10000.0)::bigint,
           max(p.steuerbefreiung_grund)
      from public.angebotsposition p
     where p.angebot_id = new.id and p.typ = 'leistung'
     group by p.steuersatz_bp, p.steuer_kennzeichen;

    update public.kalkulation
       set status = 'festgeschrieben',
           festgeschrieben_am = now(),
           festgeschrieben_von = new.versendet_von
     where angebot_id = new.id and status = 'entwurf';

    perform set_config('app.angebot_versand', '', true);
  end if;
  return new;
end $$;

/**
 * Die Sperre nach dem Versand.
 *
 * Ein geaendertes Angebot ist eine neue `version` mit Rueckverweis — dieselbe
 * Disziplin wie FIN-02, ohne den rechtlichen Anspruch der Rechnung zu
 * behaupten.
 */
create function kern.angebot_nach_versand_unveraenderlich() returns trigger
language plpgsql as $$
declare
  v_versendet timestamptz;
  v_waechter uuid := nullif(current_setting('app.angebot_versand', true), '')::uuid;
begin
  if tg_table_name = 'angebot' then
    if tg_op = 'UPDATE' and old.versendet_am is not null then
      if new.netto_cent is distinct from old.netto_cent
         or new.leistungszeitraum_von is distinct from old.leistungszeitraum_von
         or new.leistungszeitraum_bis is distinct from old.leistungszeitraum_bis
         or new.gueltig_bis is distinct from old.gueltig_bis
         or new.waehrung is distinct from old.waehrung
         or new.angebotsnummer is distinct from old.angebotsnummer
         or new.versendet_am is distinct from old.versendet_am
         or new.kunde_id is distinct from old.kunde_id
         or new.titel is distinct from old.titel then
        raise exception 'Versendetes Angebot ist unveraenderlich — eine Aenderung ist eine neue Version'
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'angebot_steuer' then
    -- INSERT nur waehrend des Versands DIESES Angebots; UPDATE und DELETE nie.
    if tg_op = 'INSERT' then
      if v_waechter is distinct from new.angebot_id then
        raise exception 'Steuerzeilen entstehen nur beim Versand'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;
    raise exception 'Steuerzeilen eines Angebots sind unveraenderlich'
      using errcode = 'check_violation';
  end if;

  select versendet_am into v_versendet from public.angebot
   where id = coalesce(new.angebot_id, old.angebot_id);
  if v_versendet is not null and v_waechter is distinct from coalesce(new.angebot_id, old.angebot_id) then
    raise exception 'Positionen eines versendeten Angebots sind unveraenderlich'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger angebot_10_versand_pruefen before update on angebot
  for each row execute function kern.angebot_versand_pruefen();
create trigger angebot_20_versand_stempeln before update on angebot
  for each row execute function kern.angebot_versand_stempeln();
create trigger angebot_30_versand_festschreiben after update on angebot
  for each row execute function kern.angebot_versand_festschreiben();
create trigger angebot_40_unveraenderlich before update on angebot
  for each row execute function kern.angebot_nach_versand_unveraenderlich();
create trigger ap_unveraenderlich before insert or update or delete on angebotsposition
  for each row execute function kern.angebot_nach_versand_unveraenderlich();
create trigger as_unveraenderlich before insert or update or delete on angebot_steuer
  for each row execute function kern.angebot_nach_versand_unveraenderlich();

-- ---------------------------------------------------------------------------
-- Zeilenschutz — Modul `angebot`, plus die Kundensicht (K-18).
-- ---------------------------------------------------------------------------

alter table angebot          enable row level security;
alter table angebot          force  row level security;
alter table angebotsposition enable row level security;
alter table angebotsposition force  row level security;
alter table angebot_steuer   enable row level security;
alter table angebot_steuer   force  row level security;

create policy t_mandant on angebot for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('angebot.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('angebot.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on angebot for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.angebot.lesen')));

-- Ein Kunde sieht ein Angebot, sobald es VERSENDET ist — nie einen Entwurf.
create policy t_kunde on angebot for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and versendet_am is not null);

create policy p_kunde_decke on angebot as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or (kunde_id = any (app.aktuelle_kunden()) and versendet_am is not null));

create policy t_mandant on angebotsposition for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('angebot.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('angebot.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on angebotsposition for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.angebot.lesen')));

create policy t_kunde on angebotsposition for select to cse_app
  using (app.scope() = 'kunde'
         and exists (select 1 from angebot a
                      where a.id = angebotsposition.angebot_id
                        and a.kunde_id = any (app.aktuelle_kunden())
                        and a.versendet_am is not null));

create policy p_kunde_decke on angebotsposition as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or exists (select 1 from angebot a
                     where a.id = angebotsposition.angebot_id
                       and a.kunde_id = any (app.aktuelle_kunden())
                       and a.versendet_am is not null));

create policy t_mandant on angebot_steuer for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('angebot.lesen', app.aktiver_mandant())));

/**
 * Geschrieben wird sie NUR im Versand — und das erzwingt der Ausloeser, nicht
 * das fehlende Recht.
 *
 * Der Versandausloeser laeuft als der AUFRUFENDE Rolle (kein `security
 * definer`), also braucht `cse_app` hier ein INSERT. Das ist keine Luecke:
 * `angebot_nach_versand_unveraenderlich()` laesst ein INSERT ausschliesslich
 * durch, solange der transaktionslokale Waechter die id genau dieses Angebots
 * traegt — also innerhalb des Versands und sonst nie. UPDATE und DELETE sind
 * unbedingt verboten.
 *
 * Die Alternative waere ein `security definer`-Ausloeser gewesen. Der haette
 * unter FORCE RLS als Eigentuemer wiederum keine Policy getroffen und die
 * Zeile ebenso wenig geschrieben — nur waere der Grund dann versteckt.
 */
create policy t_versand_schreiben on angebot_steuer for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('angebot.versenden', app.aktiver_mandant())));

/**
 * Die Gruppenansicht liest die Steuerzeile mit — unter demselben Recht wie
 * den Kopf und die Positionen.
 *
 * Ohne sie waere der Fehler leise: die Gruppensicht zeigte das Angebot samt
 * Positionen und darunter eine LEERE Steueraufstellung. Das liest sich wie
 * „keine Umsatzsteuer“ und ist in Wahrheit „hier fehlt eine Policy“ — die
 * Sorte Fehler, die erst auffaellt, wenn jemand die Summe nachrechnet.
 *
 * Ausgeweitet wird dabei nichts: `angebotsposition` traegt bereits dieselbe
 * Policy und fuehrt dieselben Betraege und denselben Steuersatz. Die
 * Steuerzeile fasst nur zusammen, was diese Sicht ohnehin sehen darf.
 */
create policy t_gruppe on angebot_steuer for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.angebot.lesen')));

create policy t_kunde on angebot_steuer for select to cse_app
  using (app.scope() = 'kunde'
         and exists (select 1 from angebot a
                      where a.id = angebot_steuer.angebot_id
                        and a.kunde_id = any (app.aktuelle_kunden())
                        and a.versendet_am is not null));

create policy p_kunde_decke on angebot_steuer as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or exists (select 1 from angebot a
                     where a.id = angebot_steuer.angebot_id
                       and a.kunde_id = any (app.aktuelle_kunden())
                       and a.versendet_am is not null));

grant select, insert, update on angebot, angebotsposition to cse_app;
grant select, insert on angebot_steuer to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0024)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- angebot (archiv): OPS-08. Ein versendetes Angebot ist ein abgegebenes Vertragsangebot; es zu loeschen entfernt den Beleg fuer das, was zugesagt wurde. Eine Aenderung ist eine neue Version mit Rueckverweis.
create trigger trg_angebot_kein_hard_delete
  before delete on angebot
  for each row execute function kern.verhindere_loeschung();
create trigger trg_angebot_kein_truncate
  before truncate on angebot
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on angebot from cse_app, cse_anon, cse_checkin, cse_job;

-- angebotsposition (archiv): OPS-08, FIN-07. Die Position ist die Zeile, die spaeter zur Rechnungszeile wird. Ohne sie laesst sich nicht mehr zeigen, wofuer der Preis galt.
create trigger trg_angebotsposition_kein_hard_delete
  before delete on angebotsposition
  for each row execute function kern.verhindere_loeschung();
create trigger trg_angebotsposition_kein_truncate
  before truncate on angebotsposition
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on angebotsposition from cse_app, cse_anon, cse_checkin, cse_job;

-- angebot_steuer (append): OPS-08, FIN-09. Die Steuerzeilen entstehen EINMAL beim Versand und werden nie nachgerechnet — dieselbe Bauart, die K-12 von der kanonischen Nutzlast einer Rechnung verlangt.
create trigger trg_angebot_steuer_kein_hard_delete
  before delete on angebot_steuer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_angebot_steuer_kein_truncate
  before truncate on angebot_steuer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on angebot_steuer from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_angebot_geaendert_am
  before update on angebot
  for each row execute function kern.setze_geaendert_am();
create trigger trg_angebotsposition_geaendert_am
  before update on angebotsposition
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
