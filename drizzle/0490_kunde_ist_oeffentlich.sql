-- 0490 — `app.kunde_ist_oeffentlich`: liest fuer die Faktura, ob ein Kunde
-- oeffentlicher Auftraggeber ist (D-779, O-66). Die Voreinstellung des
-- Zahlungsziels (14 Tage, oeffentliche Auftraggeber 30) braucht das Kennzeichen
-- beim Anlegen und Aendern eines Entwurfs — dort gilt `finanzen.schreiben`,
-- nicht das CRM-Leserecht. Ein Leser ohne `crm.lesen` sieht die `kunde`-Zeile
-- nicht (0020 §Policy), und ein unsichtbarer Kunde darf nicht als „nicht
-- oeffentlich" gelten. Darum SECURITY DEFINER, mandantengebunden, nur das
-- eine Kennzeichen; ohne das Schreibrecht kommt NULL zurueck, kein Fehler.
create function app.kunde_ist_oeffentlich(p_kunde uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select k.ist_oeffentlicher_auftraggeber
    from public.kunde k
   where k.id = p_kunde
     and k.mandant_id = app.aktiver_mandant()
     and app.hat_recht('finanzen.schreiben', app.aktiver_mandant())
$$;

alter function app.kunde_ist_oeffentlich(uuid) owner to cse_definer;
revoke all on function app.kunde_ist_oeffentlich(uuid) from public;
grant execute on function app.kunde_ist_oeffentlich(uuid) to cse_app;
