-- 0520 — Steht eine Zeit in einer Rechnung? (V-351, O-927 (1), O-891, D-827)
--
-- Eine Korrektur aendert im offenen, nicht abgerechneten Monat die Zuordnung
-- eines Zeiteintrags — Objekt und Leistungszeile (Voreinstellung O-927 (1),
-- D-795). Nicht abgerechnet heisst zweierlei: abgerechnet_am ist leer (das
-- setzt das Festschreiben, 0107), und kein Rechnungsentwurf fuehrt die Zeit
-- schon mit der bisherigen Zeile. Den Entwurf sieht die Planung nicht: die
-- Herkunft einer Rechnungsposition liegt hinter den Rechten der Finanzen.
--
-- app.zeit_in_rechnung(zeiteintrag) fragt deshalb als cse_definer
-- (d_quelle_lesen, 0107): steht irgendeine Fassung derselben Kette in einer
-- wirksamen Rechnungsposition, auch im Entwurf? Die Kette und nicht nur die
-- Fassung, weil eine Rechnung eine fruehere Fassung fuehren kann, die eine
-- Korrektur inzwischen abgeloest hat. Nur in der aktiven Gesellschaft, nicht
-- lesend, unter zeit.korrigieren — dem Recht der Korrektur.
--
-- Nur Kommentare mit Doppelstrich.

create function app.zeit_in_rechnung(p_zeiteintrag uuid) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if v_mandant is null or app.ist_readonly()
     or not app.hat_recht('zeit.korrigieren', v_mandant) then
    raise exception 'Ob eine Zeit in einer Rechnung steht, fragt nur, wer Zeiten korrigieren darf'
      using errcode = 'insufficient_privilege';
  end if;
  return exists (
    select 1
      from public.zeiteintrag z
      join public.zeiteintrag k
        on k.mandant_id = z.mandant_id and k.kette_id = z.kette_id
      join public.rechnungsposition_quelle q
        on q.mandant_id = k.mandant_id and q.zeiteintrag_id = k.id
     where z.mandant_id = v_mandant and z.id = p_zeiteintrag
       and q.quelle_typ = 'zeiteintrag' and q.wirksam);
end $$;

comment on function app.zeit_in_rechnung(uuid) is
  'V-351, D-827. Steht eine Fassung der Kette dieses Zeiteintrags in einer '
  'wirksamen Rechnungsposition (auch im Entwurf)? Dann aendert keine Korrektur '
  'ihre Zuordnung.';

alter function app.zeit_in_rechnung(uuid) owner to cse_definer;
revoke execute on function app.zeit_in_rechnung(uuid) from public;
grant execute on function app.zeit_in_rechnung(uuid) to cse_app;
