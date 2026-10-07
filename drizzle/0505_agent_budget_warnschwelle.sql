-- 0505 — die Warnschwelle des KI-Budgets meldet sich (V-292, O-195, D-810).
--
-- agent_budget traegt seit 0128 warnschwelle_prozent, den Status 'gewarnt'
-- und gewarnt_am — gesetzt hat beides niemand: die Schwelle stand auf der
-- Budgetseite und wurde beim Speichern geprueft, ein Lauf verglich sie nie
-- mit dem Verbrauch. Voreinstellung zu O-195 (D-784): 80 Prozent.
--
-- app.agent_warnung_vermerken ist der Zwilling von app.agent_stopp_vermerken
-- (0128): ein enger, benannter Schreiber, weil benachrichtigung von cse_app
-- kein insert annimmt. Er vergleicht selbst — Verbrauch gegen Grenze mal
-- Schwelle, in Mikrocent und numeric gerechnet (Invariante 1) — und schreibt
-- nur, wenn die Zeile in genau diesem Aufruf zur gewarnten wird
-- (gewarnt_am is null). Eine Meldung je Zeile, und eine Zeile ist ein Monat;
-- aendert jemand die Grenze, setzt budget-pflege gewarnt_am zurueck, und die
-- neue Grenze darf wieder warnen. Empfaenger sind, wie beim Stopp, alle mit
-- agent.budget_verwalten in der Gesellschaft. Null Empfaenger ist ein Befund
-- und kein Fehler.
--
-- Der Status wird nur von 'aktiv' auf 'gewarnt' gesetzt: ein gestopptes
-- Budget bleibt gestoppt, und das Urteil (app.agent_budget_pruefen) fragt
-- ohnehin nur nach 'gestoppt'.
--
-- Nur Kommentare mit Doppelstrich.

create function app.agent_warnung_vermerken(
  p_mandant uuid, p_budget uuid, p_titel text, p_text text, p_ziel text
) returns table (neu boolean, empfaenger integer)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_zeilen integer;
  v_empfaenger integer := 0;
begin
  update public.agent_budget
     set gewarnt_am = now(),
         status = case when status = 'aktiv' then 'gewarnt'::budget_status else status end
   where mandant_id = p_mandant and id = p_budget
     and gewarnt_am is null
     and warnschwelle_prozent is not null
     and budget_cent is not null and budget_cent > 0
     and verbrauch_mikrocent::numeric * 100
         >= budget_cent::numeric * 1000000 * warnschwelle_prozent;
  get diagnostics v_zeilen = row_count;

  if v_zeilen = 0 then
    return query select false, 0;
    return;
  end if;

  insert into public.benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  select p_mandant, e.id, 'agent.budget_warnschwelle', p_titel, p_text, p_ziel,
         'agent_budget', p_budget::text, false
    from app.benutzer_mit_recht('agent.budget_verwalten', p_mandant) as e(id);
  get diagnostics v_empfaenger = row_count;

  return query select true, v_empfaenger;
end $$;

comment on function app.agent_warnung_vermerken(uuid, uuid, text, text, text) is
  'V-292, O-195, D-810: setzt gewarnt_am (und aktiv -> gewarnt), sobald der Verbrauch '
  'die Warnschwelle der Budgetzeile erreicht, und meldet es einmal je Zeile an alle mit '
  'agent.budget_verwalten. Gibt zurueck, ob die Warnung neu ist und wie viele Empfaenger.';

alter function app.agent_warnung_vermerken(uuid, uuid, text, text, text) owner to cse_definer;
revoke all on function app.agent_warnung_vermerken(uuid, uuid, text, text, text) from public;
grant execute on function app.agent_warnung_vermerken(uuid, uuid, text, text, text)
  to cse_app, cse_job;
