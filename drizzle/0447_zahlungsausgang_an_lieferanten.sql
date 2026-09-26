-- ===========================================================================
-- 0447 — Der Zahlungsausgang an Lieferanten (V-216, FIN-14, ACC-04, ACC-07, D-707)
-- ===========================================================================
-- **Der Befund.** Wird eine Eingangsrechnung gebucht, eroeffnet
-- fin.op_kreditor_eroeffnen (0123) einen Kreditorposten. Ausgeglichen wird
-- ein Posten nur ueber zahlung_zuordnung - und fuer Kreditoren gab es keinen
-- Weg dorthin: die Zahlungsroute kannte nur den Eingang auf eine Rechnung,
-- der Bankabgleich wies jeden Ausgang ab, und erfasseZahlung wurde nur mit
-- richtung = eingang gerufen. Jede gebuchte Eingangsrechnung stand damit fuer
-- immer als unbezahlt in Offene Posten, Altersstruktur, Gruppensumme
-- Kreditoren offen und Jahrespaket.
--
-- **Was diese Migration anlegt.**
--
--   1. fin.op_kreditor_guthaben_eroeffnen - das Gegenstueck zu
--      fin.op_guthaben_eroeffnen (0121) fuer die Lieferantenseite. Zahlt die
--      Gesellschaft mehr, als die Rechnung offen hat, wird der Rest NICHT
--      auf die Rechnung gebucht (der Ausloeser op_fortschreiben weist das ab)
--      und nicht weggeworfen, sondern als kreditor_guthaben gefuehrt: eine
--      Forderung gegen den Lieferanten, bis sie verrechnet oder erstattet
--      ist. offener_posten traegt fuer cse_app keine INSERT-Policy (0121
--      Paragraph 7.3), also braucht es einen Definer. Er prueft
--      zahlung.schreiben, die lesende Sitzung und dass der Lieferant zum
--      aktiven Mandanten gehoert, und protokolliert.
--
--   2. Nichts sonst. Dass ein Eingang keine Verbindlichkeit und ein Ausgang
--      keine Forderung tilgt, prueft seit 0130 fin.zuordnung_richtung_pruefen
--      vor jeder Zuordnung, und ein Ueberzahlungsrest darf dort nur mit einem
--      Ausgang auf einem kreditor_guthaben stehen - genau der Weg, den
--      verbucheZahlungsausgang geht.
--
-- Die Funktion liest und schreibt unter den bestehenden Definer-Policies
-- d_op_anlegen (0121) und d_lieferant_lesen (0123) mit den Tabellenrechten aus
-- 0121 und 0123; neue Policies braucht es nicht.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0446.
-- ===========================================================================

create function fin.op_kreditor_guthaben_eroeffnen(p_lieferant_id uuid, p_betrag_cent bigint)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_id      uuid;
begin
  if v_mandant is null then
    raise exception 'Ohne genau einen aktiven Mandanten entsteht kein Guthaben (Invariante 10).'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('zahlung.schreiben', v_mandant) then
    raise exception 'zahlung.schreiben fehlt' using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'Die Sitzung ist lesend.' using errcode = 'insufficient_privilege';
  end if;
  if p_betrag_cent is null or p_betrag_cent <= 0 then
    raise exception 'Ein Guthaben ueber % Cent ergibt keinen Posten.', p_betrag_cent
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.lieferant l
                  where l.id = p_lieferant_id and l.mandant_id = v_mandant) then
    raise exception 'Lieferant % gehoert nicht zum aktiven Mandanten.', p_lieferant_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.offener_posten
    (mandant_id, art, lieferant_id, betrag_cent, faellig_am,
     erstellt_von_art, erstellt_von)
  values
    (v_mandant, 'kreditor_guthaben', p_lieferant_id, p_betrag_cent, app.berlin_heute(),
     'mensch', app.aktueller_benutzer())
  returning id into v_id;

  perform app.protokolliere('offener_posten.guthaben_eroeffnet', 'offener_posten',
                            v_id::text, null,
                            jsonb_build_object('lieferant_id', p_lieferant_id,
                                               'betrag_cent', p_betrag_cent),
                            v_mandant);
  return v_id;
end
$$;

alter function fin.op_kreditor_guthaben_eroeffnen(uuid, bigint) owner to cse_definer;
revoke all on function fin.op_kreditor_guthaben_eroeffnen(uuid, bigint) from public;
grant execute on function fin.op_kreditor_guthaben_eroeffnen(uuid, bigint) to cse_app;

comment on function fin.op_kreditor_guthaben_eroeffnen(uuid, bigint) is
  'V-216, D-707. Eroeffnet einen kreditor_guthaben-Posten: der Teil eines Zahlungsausgangs, der '
  'ueber den offenen Betrag der Eingangsrechnung hinausgeht - eine Forderung gegen den Lieferanten.';
