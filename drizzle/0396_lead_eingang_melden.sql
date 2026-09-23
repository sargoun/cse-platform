-- ===========================================================================
-- 0396 — Ein neuer Web-Lead meldet sich bei seinem Besitzer (V-137, REQ-05,
--        NOT-01)
-- ===========================================================================
-- **Der Befund.** Die Benachrichtigungsart crm.neuer_lead ist seit PR 18
-- registriert — und entstand nur im Seed. Die Annahme laeuft als
-- Eingangs-Prinzipal unter cse_app, und cse_app darf keine Benachrichtigung
-- anlegen (0011): das ist richtig, sonst koennte jede Sitzung jedem Konto
-- Meldungen in den Posteingang legen. Also kam keine an. Wer ein Formular
-- betreute, erfuhr von einer neuen Anfrage erst, wenn er zufaellig in die
-- Liste sah — und die SLA-Uhr lief seit der Einsendung.
--
-- **Der Weg, eng geschnitten.** app.lead_eingang_melden legt GENAU EINE
-- Meldung an, und nur:
--   - fuer einen Lead des aktiven Mandanten,
--   - der aus einem Webformular kommt,
--   - der IN DIESER TRANSAKTION entstanden ist (erstellt_am = now()),
--   - an seinen Besitzer, den der Aufrufer nicht waehlen kann.
-- Titel und Text reicht der Aufrufer herein, weil die Arten in TypeScript
-- beschrieben sind (services/lead/benachrichtigung.ts) und es keine zweite
-- Fassung in SQL geben soll. Das Ziel muss auf genau diesen Lead zeigen.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0395.
-- ===========================================================================

grant select (id, mandant_id, quelle, besitzer_benutzer_id, ansprechpartner_id,
               erstellt_am, archiviert_am)
      on lead to cse_definer;
grant update (ansprechpartner_id) on lead to cse_definer;
grant insert (id, mandant_id, kunde_id, nachname, email, telefon, rechtsgrundlage,
              rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, erstellt_von)
      on ansprechpartner to cse_definer;

create policy d_lead_annahme_lesen on lead for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_lead_annahme_kontakt on lead for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());
create policy d_ansprechpartner_aus_anfrage on ansprechpartner for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant());

-- ---------------------------------------------------------------------------
-- 1. Der Anfragende wird Ansprechpartner — mit der Grundlage, die er gab.
-- ---------------------------------------------------------------------------
-- **Warum.** Die SLA-Uhr eines Leads steht erst, wenn eine AUSGEHENDE
-- Aktivitaet geschrieben wird (0017, kern.setze_erste_reaktion). Eine
-- ausgehende E-Mail oder ein Anruf verlangt am UWG-Tor (0020,
-- kern.uwg_sendetor) einen Ansprechpartner — und die Annahme legte keinen
-- an. Niemand konnte die erste Reaktion belegen, und jeder Web-Lead
-- eskalierte stuendlich ohne Ende.
--
-- **Die Grundlage ist anfrage, nie einwilligung.** Wer um ein Angebot bittet,
-- darf darauf eine Antwort bekommen (Zweck vertraglich); Werbung begruendet
-- das nicht. Das freiwillige Werbe-Haekchen des Formulars nennt keinen Kanal,
-- und eine Einwilligung ohne Kanal ist nach 0020 eine in nichts — es steht
-- deshalb am Eingang und in der Einsendung, und ein Mensch entscheidet.
--
-- **Ein Mensch, ein Kontakt.** Gibt es im Mandanten schon einen Kontakt mit
-- dieser E-Mail, wird DER verknuepft (ansprechpartner_email_uk, 0020): zehn
-- Einsendungen derselben Adresse sind ein Mensch, und ein Widerspruch soll
-- fuer ihn gelten, nicht fuer einen von zehn Zwillingen. Ein anonymisierter
-- Kontakt zaehlt nicht mehr — dann entsteht ein neuer.
--
-- Nur der Eingangs-Prinzipal ruft das, und er darf Kontakte weder lesen noch
-- zurueckholen: deshalb sucht die Funktion, nicht er.
create function app.lead_kontakt_aus_anfrage(
  p_lead uuid, p_name text, p_email text, p_telefon text, p_quelle text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid;
  v_kontakt uuid;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_email   text := nullif(btrim(coalesce(p_email, '')), '');
begin
  select l.mandant_id into v_mandant
    from public.lead l
   where l.id = p_lead
     and l.mandant_id = app.aktiver_mandant()
     and l.quelle = 'webformular'
     and l.ansprechpartner_id is null
     and l.erstellt_am = now();
  if not found then return false; end if;
  if v_name is null and v_email is null then return false; end if;

  if v_email is not null then
    select a.id into v_kontakt
      from public.ansprechpartner a
     where a.mandant_id = v_mandant
       and lower(a.email) = lower(v_email)
       and a.archiviert_am is null
       and a.anonymisiert_am is null
     order by (a.kunde_id is null), a.erstellt_am desc
     limit 1;
  end if;

  if v_kontakt is null then
    v_kontakt := gen_random_uuid();
    insert into public.ansprechpartner
      (id, mandant_id, kunde_id, nachname, email, telefon, rechtsgrundlage,
       rechtsgrundlage_quelle, rechtsgrundlage_erfasst_am, erstellt_von)
    values (v_kontakt, v_mandant, null, coalesce(v_name, v_email), v_email,
            nullif(btrim(coalesce(p_telefon, '')), ''), 'anfrage',
            coalesce(nullif(btrim(coalesce(p_quelle, '')), ''), 'Webformular'),
            now(), app.aktueller_benutzer());
  end if;

  update public.lead set ansprechpartner_id = v_kontakt where id = p_lead;
  return true;
end $$;

comment on function app.lead_kontakt_aus_anfrage(uuid, text, text, text, text) is
  'V-137: der Anfragende eines in dieser Transaktion angenommenen Web-Leads wird '
  'Ansprechpartner (Grundlage anfrage) oder, bei gleicher E-Mail, der vorhandene verknuepft.';

alter function app.lead_kontakt_aus_anfrage(uuid, text, text, text, text) owner to cse_definer;
revoke execute on function app.lead_kontakt_aus_anfrage(uuid, text, text, text, text) from public;
grant execute on function app.lead_kontakt_aus_anfrage(uuid, text, text, text, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 2. Die Meldung an den Besitzer.
-- ---------------------------------------------------------------------------

create function app.lead_eingang_melden(
  p_lead uuid, p_titel text, p_text text, p_ziel text
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant  uuid;
  v_besitzer uuid;
begin
  select l.mandant_id, l.besitzer_benutzer_id into v_mandant, v_besitzer
    from public.lead l
   where l.id = p_lead
     and l.mandant_id = app.aktiver_mandant()
     and l.quelle = 'webformular'
     and l.archiviert_am is null
     and l.erstellt_am = now();
  if not found or v_besitzer is null then return false; end if;

  -- Das Ziel zeigt auf genau diesen Lead, nirgendwo sonst hin.
  if p_ziel is null or p_ziel !~ ('^/portal/[a-z0-9-]+/crm/leads/' || p_lead::text || '$') then
    raise exception 'Das Ziel einer Lead-Meldung zeigt auf den Lead selbst (V-137)'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.benutzer b
                  where b.id = v_besitzer and b.status = 'aktiv'
                    and b.deaktiviert_am is null) then
    return false;
  end if;

  insert into public.benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  values (v_mandant, v_besitzer, 'crm.neuer_lead', p_titel, p_text, p_ziel,
          'lead', p_lead::text, true);
  return true;
end $$;

comment on function app.lead_eingang_melden(uuid, text, text, text) is
  'V-137, REQ-05: meldet einen in dieser Transaktion angenommenen Web-Lead seinem '
  'Besitzer. Kein frei waehlbarer Empfaenger, kein fremder Lead.';

alter function app.lead_eingang_melden(uuid, text, text, text) owner to cse_definer;
revoke execute on function app.lead_eingang_melden(uuid, text, text, text) from public;
grant execute on function app.lead_eingang_melden(uuid, text, text, text) to cse_app;
