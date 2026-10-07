-- 0505 — die Warnschwelle des KI-Budgets meldet sich (V-292, O-195, D-810).
--
-- agent_budget traegt seit 0128 warnschwelle_prozent, den Status 'gewarnt'
-- und gewarnt_am — gesetzt hat beides niemand: die Schwelle stand auf der
-- Budgetseite und wurde beim Speichern geprueft, ein Lauf verglich sie nie
-- mit dem Verbrauch. Voreinstellung zu O-195 (D-784): 80 Prozent.
--
-- (1) app.agent_warnung_vermerken ist der Zwilling von
-- app.agent_stopp_vermerken (0128): ein enger, benannter Schreiber, weil
-- benachrichtigung von cse_app kein insert annimmt. Er vergleicht selbst —
-- Verbrauch gegen Grenze mal Schwelle, in Mikrocent (10 000 je Cent, wie der
-- Hartstopp in app.agent_budget_pruefen und mikrocentNachCent) und numeric
-- gerechnet (Invariante 1) — und schreibt nur, wenn die Zeile in genau diesem
-- Aufruf zur gewarnten wird (gewarnt_am is null). Eine Meldung je Zeile, und
-- eine Zeile ist ein Monat; aendert jemand die Grenze, setzt budget-pflege
-- gewarnt_am zurueck, und die neue Grenze darf wieder warnen. Null Empfaenger
-- ist ein Befund und kein Fehler.
--
-- Der Status wird nur von 'aktiv' auf 'gewarnt' gesetzt: ein gestopptes
-- Budget bleibt gestoppt, und das Urteil (app.agent_budget_pruefen) fragt
-- ohnehin nur nach 'gestoppt'.
--
-- (0) Aufrufen darf beide Schreiber nur die Sitzung, die in dieser
-- Gesellschaft gerade Agentenkosten bucht: p_mandant ist der aktive Mandant,
-- die Sitzung ist intern und schreibend und haelt agent.aufgabe_starten —
-- dieselbe Bedingung, unter der agent_kosten das insert von cse_app annimmt
-- (0128). Kein Job ruft sie (Warnung und Stopp fallen in einer Anfrage an);
-- einer, der es braeuchte, bekaeme einen eigenen Einstieg.
--
-- Als Ziel nehmen sie nur das Budgetblatt der Gesellschaft an
-- (/portal/<slug>/agenten/budget): /api/benachrichtigungen/[id]/oeffnen
-- leitet auf das Ziel weiter, und ein frei gewaehltes Ziel schickte die
-- Empfaenger auf eine beliebige Adresse. Der Stopp darf ohne Ziel melden —
-- sieht der Aufrufer die Budgetzeile nicht, schreibt die Artenregistratur
-- keines, und gestoppt wird trotzdem.
--
-- Empfaenger sind die aktiven Menschenkonten, die agent.budget_verwalten in
-- der Gesellschaft halten, aufgeloest von kern.traeger_des_rechts (0149) —
-- also wie app.hat_recht: Zeile der Gesellschaft vor Plattformvorgabe,
-- globale Rolle, Modulzuweisung, ohne Dienstkonten. app.benutzer_mit_recht
-- (0128, 0169) sah bei der Mitgliedschaft nur Zeilen genau dieser
-- Gesellschaft und verpasste jede Plattformvorgabe: ein Verwalter mit dem
-- Recht aus der Vorgabe bekam nichts, und gewarnt_am verhinderte den zweiten
-- Versuch.
--
-- (2) Der Stopp aus 0128 bekommt dasselbe Tor und dieselben Empfaenger.
-- Sonst erreichte die Warnung einen Verwalter, der Stopp aber nicht — und
-- eine Sitzung koennte das Budget einer anderen Gesellschaft stoppen.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 0. Das gemeinsame Tor der beiden Schreiber
-- ---------------------------------------------------------------------------

create function kern.agent_budget_vermerk_tor(p_mandant uuid)
returns text
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_ziel text;
begin
  if p_mandant is null or p_mandant is distinct from app.aktiver_mandant() then
    raise exception 'Den Budgetvermerk schreibt nur eine Sitzung in genau dieser Gesellschaft.'
      using errcode = '42501', hint = 'Die Gruppenansicht ist lesend (Invariante 10).';
  end if;
  if app.ist_readonly() or app.portal() is distinct from 'intern' then
    raise exception 'Den Budgetvermerk schreibt nur eine interne, schreibende Sitzung.'
      using errcode = '42501';
  end if;
  if not app.hat_recht('agent.aufgabe_starten', p_mandant) then
    raise exception 'Den Budgetvermerk schreibt nur, wer Agentenlaeufe starten darf.'
      using errcode = '42501', hint = 'agent.aufgabe_starten, wie beim Buchen der Kosten (0128).';
  end if;

  select '/portal/' || m.slug || '/agenten/budget' into v_ziel
    from public.mandant m where m.id = p_mandant;
  return v_ziel;
end $$;

comment on function kern.agent_budget_vermerk_tor(uuid) is
  'V-292, D-810: das Tor von app.agent_warnung_vermerken und app.agent_stopp_vermerken — '
  'aktiver Mandant, interne schreibende Sitzung, agent.aufgabe_starten. Gibt das '
  'Budgetblatt der Gesellschaft zurueck, das einzige Ziel, das die beiden annehmen.';

alter function kern.agent_budget_vermerk_tor(uuid) owner to cse_definer;
revoke all on function kern.agent_budget_vermerk_tor(uuid) from public;

-- ---------------------------------------------------------------------------
-- 1. Die Warnung
-- ---------------------------------------------------------------------------

create function app.agent_warnung_vermerken(
  p_mandant uuid, p_budget uuid, p_titel text, p_text text, p_ziel text
) returns table (neu boolean, empfaenger integer)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_zeilen integer;
  v_empfaenger integer := 0;
begin
  if p_ziel is distinct from kern.agent_budget_vermerk_tor(p_mandant) then
    raise exception 'Das Ziel ist das Budgetblatt dieser Gesellschaft' using errcode = '22023';
  end if;

  update public.agent_budget
     set gewarnt_am = now(),
         status = case when status = 'aktiv' then 'gewarnt'::budget_status else status end
   where mandant_id = p_mandant and id = p_budget
     and gewarnt_am is null
     and warnschwelle_prozent is not null
     and budget_cent is not null and budget_cent > 0
     and verbrauch_mikrocent::numeric * 100
         >= budget_cent::numeric * 10000 * warnschwelle_prozent;
  get diagnostics v_zeilen = row_count;

  if v_zeilen = 0 then
    return query select false, 0;
    return;
  end if;

  insert into public.benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  select p_mandant, e.id, 'agent.budget_warnschwelle', p_titel, p_text, p_ziel,
         'agent_budget', p_budget::text, false
    from unnest(kern.traeger_des_rechts(p_mandant, 'agent.budget_verwalten')) as e(id);
  get diagnostics v_empfaenger = row_count;

  return query select true, v_empfaenger;
end $$;

comment on function app.agent_warnung_vermerken(uuid, uuid, text, text, text) is
  'V-292, O-195, D-810: setzt gewarnt_am (und aktiv -> gewarnt), sobald der Verbrauch '
  'die Warnschwelle der Budgetzeile erreicht (10 000 Mikrocent je Cent), und meldet es '
  'einmal je Zeile an alle, die agent.budget_verwalten halten. Nur die buchende Sitzung '
  'der aktiven Gesellschaft. Gibt zurueck, ob die Warnung neu ist und wie viele Empfaenger.';

alter function app.agent_warnung_vermerken(uuid, uuid, text, text, text) owner to cse_definer;
revoke all on function app.agent_warnung_vermerken(uuid, uuid, text, text, text) from public;
grant execute on function app.agent_warnung_vermerken(uuid, uuid, text, text, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 2. Der Stopp: dasselbe Tor, dieselben Empfaenger
-- ---------------------------------------------------------------------------

create or replace function app.agent_stopp_vermerken(
  p_mandant uuid, p_budget uuid, p_titel text, p_text text, p_ziel text
) returns table (neu boolean, empfaenger integer)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_zeilen integer;
  v_empfaenger integer := 0;
  v_ziel text;
begin
  v_ziel := kern.agent_budget_vermerk_tor(p_mandant);
  if p_ziel is not null and p_ziel is distinct from v_ziel then
    raise exception 'Das Ziel ist das Budgetblatt dieser Gesellschaft' using errcode = '22023';
  end if;

  update public.agent_budget
     set status = 'gestoppt', gestoppt_am = coalesce(gestoppt_am, now())
   where mandant_id = p_mandant and id = p_budget and status <> 'gestoppt';
  get diagnostics v_zeilen = row_count;

  if v_zeilen = 0 then
    return query select false, 0;
    return;
  end if;

  insert into public.benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  select p_mandant, e.id, 'agent.budget_erschoepft', p_titel, p_text, p_ziel,
         'agent_budget', p_budget::text, false
    from unnest(kern.traeger_des_rechts(p_mandant, 'agent.budget_verwalten')) as e(id);
  get diagnostics v_empfaenger = row_count;

  -- Null Empfaenger ist ein Befund, kein Fehler (0128): gestoppt wird trotzdem.
  return query select true, v_empfaenger;
end $$;

comment on function app.agent_stopp_vermerken(uuid, uuid, text, text, text) is
  'AGT-05, D-810: setzt den Hartstopp der Budgetzeile und meldet ihn einmal an alle, die '
  'agent.budget_verwalten halten. Nur die buchende Sitzung der aktiven Gesellschaft.';

-- Das Tor verlangt eine Sitzung; der Jobrolle bleibt davon nichts.
revoke execute on function app.agent_stopp_vermerken(uuid, uuid, text, text, text) from cse_job;
