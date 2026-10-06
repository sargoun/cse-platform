-- 0492 — das Steuerkennzeichen einer LV-Position lesbar machen (O-632, D-782).
--
-- 0071 entzieht `cse_app` die Spalte `steuer_kennzeichen` zusammen mit dem
-- Einheitspreis (K-05, §1.9). Die Voreinstellung nach der Weisung vom
-- 05.10.2026: das Kennzeichen (§ 13b UStG — bei Bauleistungen der Regelfall)
-- erscheint auf dem Positionsblatt hinter DEMSELBEN Recht wie der Preis,
-- `bau.preis_lesen`, ueber einen gepruegten Leser nach dem Muster von
-- `app.lv_preis_lesen`. Ohne Recht oder ausserhalb des Mandanten-Scopes NULL,
-- nie ein Fehler — die Seite zeigt dann „nicht lesbar", keine Null.
--
-- Kein Eintrag ins `audit_log`: das Kennzeichen ist kein Preis; wer es liest,
-- sieht keine Kalkulation. Der Preisleser protokolliert weiter jeden Zugriff.
-- TODO(client, O-632): Voreinstellung — Steuerkennzeichen hinter bau.preis_lesen; ein eigenes Recht erst, wenn die Buchhaltung eines verlangt.

create function app.lv_steuer_lesen(p_lv_position uuid) returns text
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_wert text; v_mandant uuid;
begin
  select p.steuer_kennzeichen::text, p.mandant_id into v_wert, v_mandant
    from public.lv_position p where p.id = p_lv_position;
  if v_mandant is null then return null; end if;
  if v_mandant is distinct from app.aktiver_mandant() then return null; end if;
  if not app.hat_recht('bau.preis_lesen', v_mandant) then return null; end if;
  return v_wert;
end $$;

comment on function app.lv_steuer_lesen(uuid) is
  'Der eine Weg zum Steuerkennzeichen einer LV-Position (O-632, D-782): prueft '
  'bau.preis_lesen und den aktiven Mandanten; ohne Recht NULL.';

alter function app.lv_steuer_lesen(uuid) owner to cse_definer;
revoke all on function app.lv_steuer_lesen(uuid) from public;
grant execute on function app.lv_steuer_lesen(uuid) to cse_app;
