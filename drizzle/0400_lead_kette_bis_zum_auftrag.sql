-- ===========================================================================
-- 0400 — Die Kette Lead, Angebot, Auftrag haelt in der Datenbank
--        (V-138, V-139, CRM-05, CRM-07, REQ-07, REP-03)
-- ===========================================================================
-- **Der Befund.** angebot.lead_id (0024) und auftrag.lead_id (0025) standen
-- mit Fremdschluessel und Index da, und kein Weg der Anwendung schrieb sie.
-- Der Herkunftsbericht (REP-03) zaehlt Auftraege ueber auftrag.lead_id und
-- zeigte deshalb fuer jeden Kanal null Auftraege, auch im Seed. Dazu hatten
-- die vier Verweise des Leads, die 0017 ohne Fremdschluessel anlegte, nie
-- einen bekommen: kunde_id, empfehlung_von_kunde_id, ansprechpartner_id und
-- ausschreibung_id. 0017 begruendete das mit Tabellen, die es damals noch
-- nicht gab; sie kamen mit 0020 und 0145, die Schluessel nie. Ein Lead
-- konnte damit auf einen Kunden einer anderen Gesellschaft zeigen.
--
-- **Was diese Migration festhaelt.**
--   1. Die vier Fremdschluessel des Leads, zusammengesetzt mit mandant_id,
--      wo die Zieltabelle einem Mandanten gehoert.
--   2. Eine Bekanntmachung wird je Gesellschaft hoechstens EINMAL zum Lead.
--   3. Ein Angebot oder Auftrag mit Lead gehoert DEMSELBEN Kunden wie der
--      Lead, und ein Lead, an dem schon ein Angebot oder Auftrag haengt,
--      wechselt seinen Kunden nicht mehr.
--   4. Der Stand des Leads folgt der Kette: ein versendetes Angebot stellt
--      einen offenen Lead auf angebot, ein Auftrag stellt ihn auf gewonnen.
--      Beides schreibt eine Systemzeile in den Verlauf.
--
-- **Warum Definer-Ausloeser und nicht der Dienst.** Den Versand macht, wer
-- angebot.versenden haelt, den Auftrag, wer angebot.annahme_erfassen oder
-- auftrag.schreiben haelt. Keines davon ist crm.schreiben, und die
-- Schreibpolicy auf lead verlangt genau das. Als cse_app geschrieben haette
-- die Nachfuehrung den Versand einer Rolle ohne CRM-Recht abgebrochen oder
-- still nichts getan. Die Ausloeser laufen als cse_definer, sehen nur den
-- aktiven Mandanten und duerfen an lead genau zwei Spalten schreiben.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0396.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die Verweise des Leads bekommen ihre Fremdschluessel.
-- ---------------------------------------------------------------------------
-- MATCH SIMPLE: ein leerer Verweis wird nicht geprueft, ein gesetzter muss
-- in DERSELBEN Gesellschaft stehen. ausschreibung ist gruppenweit (0145) und
-- hat keinen Mandanten, deshalb dort der einfache Schluessel.
alter table lead
  add constraint lead_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  add constraint lead_empfehlung_fk foreign key (mandant_id, empfehlung_von_kunde_id)
    references kunde (mandant_id, id),
  add constraint lead_ansprechpartner_fk foreign key (mandant_id, ansprechpartner_id)
    references ansprechpartner (mandant_id, id),
  add constraint lead_ausschreibung_fk foreign key (ausschreibung_id)
    references ausschreibung (id);

create index lead_kunde_idx on lead (mandant_id, kunde_id) where kunde_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Eine Bekanntmachung, ein Lead je Gesellschaft (CRM-07).
-- ---------------------------------------------------------------------------
-- Zwei Menschen, die gleichzeitig auf Als Lead uebernehmen klicken, legten
-- sonst zwei Leads zu derselben Vergabe an, und zwei Vertriebler bereiteten
-- dasselbe Angebot vor. Eine andere Gesellschaft darf dieselbe Bekanntmachung
-- sehr wohl uebernehmen: sie bietet selbst.
create unique index lead_ausschreibung_uk on lead (mandant_id, ausschreibung_id)
  where ausschreibung_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Was die Definer sehen und schreiben duerfen, eng geschnitten.
-- ---------------------------------------------------------------------------
-- 0396 gab cse_definer an lead: id, mandant_id, quelle, besitzer_benutzer_id,
-- ansprechpartner_id, erstellt_am, archiviert_am (lesen) und
-- ansprechpartner_id (schreiben). Hier kommen die Spalten der Kette dazu.
grant select (kunde_id, status, konvertiert_am) on lead to cse_definer;
grant update (status, konvertiert_am) on lead to cse_definer;
grant select (id, mandant_id, lead_id) on angebot to cse_definer;
grant insert (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff, inhalt,
              akteur_art, benutzer_id, rechtsgrundlage_snapshot)
      on lead_aktivitaet to cse_definer;

create policy d_lead_kette_lesen on lead for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_lead_kette_folgen on lead for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());
create policy d_angebot_lead_lesen on angebot for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
-- Nur die Systemzeile der Kette, nichts Ausgehendes: eine ausgehende Zeile
-- stoppte die Reaktionsuhr (0017) und liefe durch das UWG-Tor (0020).
create policy d_lead_aktivitaet_kette on lead_aktivitaet for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant()
              and typ = 'system' and richtung = 'intern' and zweck = 'intern');

-- ---------------------------------------------------------------------------
-- 4. Angebot und Auftrag gehoeren dem Kunden ihres Leads.
-- ---------------------------------------------------------------------------
-- Der Dienst prueft das vorher und sagt es in einem Satz
-- (services/crm/lead-kette.ts). Hier steht es ein zweites Mal, fuer jeden
-- Weg, der am Dienst vorbeischreibt: eine Anfrage der Hausverwaltung A, deren
-- Auftrag beim Kunden B steht, zaehlte im Herkunftsbericht einen Kanal fuer
-- einen Umsatz, den er nicht gebracht hat.
create function kern.lead_bezug_stimmt() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_kunde uuid;
begin
  if new.lead_id is null then return new; end if;
  select l.kunde_id into v_kunde
    from public.lead l
   where l.id = new.lead_id and l.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Diese Anfrage ist in dieser Gesellschaft nicht bekannt'
      using errcode = 'foreign_key_violation';
  end if;
  if v_kunde is null then
    raise exception 'Die Anfrage hat noch keinen Kunden; erst den Kunden zuordnen'
      using errcode = 'check_violation';
  end if;
  if v_kunde <> new.kunde_id then
    raise exception 'Die Anfrage gehoert einem anderen Kunden als dieser Vorgang'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function kern.lead_bezug_stimmt() is
  'V-138, D-632: ein Angebot oder Auftrag mit lead_id gehoert dem Kunden seines Leads.';

alter function kern.lead_bezug_stimmt() owner to cse_definer;
revoke execute on function kern.lead_bezug_stimmt() from public;

create trigger trg_angebot_lead_bezug
  before insert or update of lead_id, kunde_id on angebot
  for each row execute function kern.lead_bezug_stimmt();
create trigger trg_auftrag_lead_bezug
  before insert or update of lead_id, kunde_id on auftrag
  for each row execute function kern.lead_bezug_stimmt();

-- Und der Lead wechselt seinen Kunden nicht mehr, sobald ein Vorgang an ihm
-- haengt. Der erste Kunde darf gesetzt werden, ein falsch zugeordneter
-- korrigiert, solange noch nichts daran haengt. Danach waere es eine
-- Umschreibung der Herkunft eines Angebots, das schon beim anderen steht.
create function kern.lead_kunde_bleibt() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
begin
  if old.kunde_id is null or new.kunde_id is not distinct from old.kunde_id then
    return new;
  end if;
  if exists (select 1 from public.angebot a
              where a.lead_id = new.id and a.mandant_id = new.mandant_id)
     or exists (select 1 from public.auftrag t
                 where t.lead_id = new.id and t.mandant_id = new.mandant_id) then
    raise exception 'An dieser Anfrage haengt schon ein Angebot oder Auftrag; ihr Kunde bleibt'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function kern.lead_kunde_bleibt() is
  'V-138, D-632: der Kunde eines Leads bleibt, sobald ein Angebot oder Auftrag an ihm haengt.';

alter function kern.lead_kunde_bleibt() owner to cse_definer;
revoke execute on function kern.lead_kunde_bleibt() from public;

create trigger trg_lead_kunde_bleibt
  before update of kunde_id on lead
  for each row execute function kern.lead_kunde_bleibt();

-- ---------------------------------------------------------------------------
-- 5. Der Stand des Leads folgt der Kette.
-- ---------------------------------------------------------------------------
-- Versendet heisst: die Anfrage hat ein Angebot bekommen. Nur ein OFFENER
-- Lead (neu, in_bearbeitung) wird dabei weitergestellt; ein gewonnener oder
-- verlorener bleibt, was ein Mensch festgestellt hat. Die Verlaufszeile
-- entsteht in jedem Fall, damit das Leadblatt sagt, was geschah.
create function kern.lead_folgt_angebot() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
begin
  if new.lead_id is null or new.status <> 'versendet'
     or old.status is not distinct from new.status then
    return null;
  end if;
  update public.lead l
     set status = 'angebot'
   where l.id = new.lead_id and l.mandant_id = new.mandant_id
     and l.status in ('neu', 'in_bearbeitung') and l.archiviert_am is null;
  insert into public.lead_aktivitaet
    (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff, inhalt,
     akteur_art, benutzer_id, rechtsgrundlage_snapshot)
  values (new.mandant_id, new.lead_id, 'system', 'intern', 'intern', 'portal',
          'Angebot ' || coalesce(new.angebotsnummer, '') || ' versendet', new.titel,
          'system', app.aktueller_benutzer(), 'keine');
  return null;
end $$;

comment on function kern.lead_folgt_angebot() is
  'V-138, D-632: ein versendetes Angebot stellt seinen offenen Lead auf angebot '
  'und schreibt eine Systemzeile in den Verlauf.';

alter function kern.lead_folgt_angebot() owner to cse_definer;
revoke execute on function kern.lead_folgt_angebot() from public;

create trigger trg_angebot_lead_folgt
  after update of status on angebot
  for each row execute function kern.lead_folgt_angebot();

-- Ein Auftrag ist die unterschriebene Zusage (REP-03: channel to SIGNED
-- order). Er stellt den Lead auf gewonnen, auch einen, den jemand vorher
-- verloren gegeben hatte: der Auftrag ist die spaetere und staerkere
-- Tatsache. Der Verlustgrund bleibt stehen, und der Verlauf nennt den
-- Auftrag. konvertiert_am wird nur gesetzt, wenn es noch leer ist.
create function kern.lead_folgt_auftrag() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
begin
  if new.lead_id is null then return null; end if;
  update public.lead l
     set status = 'gewonnen',
         konvertiert_am = coalesce(l.konvertiert_am, now())
   where l.id = new.lead_id and l.mandant_id = new.mandant_id
     and l.status <> 'gewonnen' and l.archiviert_am is null;
  insert into public.lead_aktivitaet
    (mandant_id, lead_id, typ, richtung, zweck, kanal, betreff, inhalt,
     akteur_art, benutzer_id, rechtsgrundlage_snapshot)
  values (new.mandant_id, new.lead_id, 'system', 'intern', 'intern', 'portal',
          'Auftrag ' || new.auftragsnummer || ' angelegt', new.bezeichnung,
          'system', app.aktueller_benutzer(), 'keine');
  return null;
end $$;

comment on function kern.lead_folgt_auftrag() is
  'V-138, D-632: ein Auftrag mit lead_id stellt seinen Lead auf gewonnen '
  'und schreibt eine Systemzeile in den Verlauf.';

alter function kern.lead_folgt_auftrag() owner to cse_definer;
revoke execute on function kern.lead_folgt_auftrag() from public;

create trigger trg_auftrag_lead_folgt
  after insert on auftrag
  for each row execute function kern.lead_folgt_auftrag();
