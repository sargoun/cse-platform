-- ===========================================================================
-- 0129 — `app.agent_nutzlast_lesen`: die Nutzlast eines Schrittes SEHEN
-- ===========================================================================
--
-- 0128 haelt `agent_schritt.eingabe` und `agent_schritt.ausgabe` aus dem
-- Spaltengrant fuer `cse_app` heraus (K-05): was ein Agent gelesen und was er
-- einem Modell geschickt hat, traegt regelmaessig Personendaten, und
-- `agent.lesen` ist das Recht, den LAUF zu sehen, nicht seinen Inhalt.
--
-- Damit war die Nutzlast bisher fuer NIEMANDEN lesbar. Das ist eine Haelfte
-- zu wenig: AGT-04 verlangt ein nachvollziehbares Protokoll, und ein Protokoll,
-- dessen entscheidende Spalte niemand oeffnen kann, beantwortet die Frage
-- „warum hat der Agent das getan" nicht. Diese Migration liefert die zweite
-- Haelfte — als benanntes Tor mit eigenem Recht und mit Eintrag im Audit.
--
-- **Dieselbe Bauform wie `app.audit_nutzlast_lesen` (0005)**, und aus
-- demselben Grund: Definer, also nicht dem Spaltengrant unterworfen, und
-- deshalb wiederholt die Funktion das Mandantspraedikat, das fuer sie nicht
-- mehr gilt.

/**
 * Die Nutzlast eines Agentenschrittes, hinter `agent.protokoll_lesen`.
 *
 * **Sie gibt NICHTS zurueck statt zu werfen.** Ein Aufrufer ohne das Recht
 * bekommt eine leere Menge — genau wie bei `app.audit_nutzlast_lesen`. Eine
 * Ausnahme waere hier ein Kanal: „Fehler" hiesse „es gibt diesen Schritt",
 * „leer" hiesse „nicht oder nicht sichtbar", und die Seite kann beides gleich
 * darstellen.
 *
 * **Geschwaerzte Nutzlast bleibt geschwaerzt.** Nach Ablauf der Loeschfrist
 * setzt der Waechter `nutzlast_geloescht_am` und leert die beiden Spalten
 * (LEG-09). Diese Funktion liest, was dasteht — sie hat keinen zweiten Vorrat.
 *
 * **Der Zugriff steht im Audit.** Wer eine Modelleingabe liest, liest
 * Personendaten; SEC-A9 verlangt dafuer eine Spur, und zwar hier und nicht in
 * der Anwendung: eine Spur, die der Aufrufer selbst schreibt, fehlt genau
 * dann, wenn sie interessant waere.
 */
create function app.agent_nutzlast_lesen(p_schritt uuid)
  returns table (eingabe jsonb, ausgabe jsonb, geschwaerzt_am timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid;
begin
  select s.mandant_id into v_mandant
    from public.agent_schritt s where s.id = p_schritt;
  if not found then return; end if;

  if not (v_mandant = any (app.sichtbare_mandanten())) then return; end if;
  if not app.hat_recht('agent.protokoll_lesen', v_mandant) then return; end if;

  perform app.protokolliere('agent.nutzlast_gelesen', 'agent_schritt',
                            p_schritt::text, null, null, v_mandant);

  return query
    select s.eingabe, s.ausgabe, s.nutzlast_geloescht_am
      from public.agent_schritt s where s.id = p_schritt;
end $$;

alter function app.agent_nutzlast_lesen(uuid) owner to cse_definer;
revoke all on function app.agent_nutzlast_lesen(uuid) from public;
grant execute on function app.agent_nutzlast_lesen(uuid) to cse_app;

/**
 * Was der Leser dafuer braucht — die beiden Spalten, die `cse_app` fehlen,
 * und die drei, ueber die er seine Zeile findet (K-05, D-388).
 *
 * `cse_definer` haelt auf `agent_schritt` bisher nichts: 0128 hat der Rolle
 * dort keinen Grant gegeben, weil keine Definer-Funktion die Tabelle anfasste.
 * Ohne diese Zeile scheitert der Leser mit „permission denied" — und zwar
 * NUR fuer den, der das Recht hat, also fuer den einzigen, der es merkt.
 */
grant select (id, mandant_id, eingabe, ausgabe, nutzlast_geloescht_am)
  on agent_schritt to cse_definer;

/**
 * Und die Policy. `agent_schritt` traegt `force row level security`: ohne
 * anwendbare Policy laese die Funktion null Zeilen und meldete „keine
 * Nutzlast" — dieselbe Antwort wie bei fehlendem Recht, nur falsch.
 * `using (true)` ist hier die richtige Verengung, nicht die fehlende: die
 * Mandants- und Rechtepruefung steht im Rumpf der Funktion, und `cse_definer`
 * ist NOLOGIN und nur ueber benannte Funktionen zu betreten (wie 0116).
 */
create policy d_schritt_nutzlast on agent_schritt
  for select to cse_definer using (true);
