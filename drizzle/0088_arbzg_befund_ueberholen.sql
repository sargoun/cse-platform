-- ---------------------------------------------------------------------------
-- 0088 — `arbeitszeit_verstoss.hinfaellig_am` bekommt seinen Schreiber
-- ---------------------------------------------------------------------------
--
-- Die Spalte gab es seit 0040, und NIEMAND hat sie je gesetzt. Der Detektor
-- ueberholte die Konfliktkarte (`planungs_konflikt.hinfaellig_am`), den BELEG
-- dahinter aber nicht: die Karte verschwand aus dem Eingang, waehrend der
-- Befund in `arbeitszeit_verstoss` fuer immer `offen` stehen blieb.
--
-- Was das gekostet haette, steht in zwei Zeilen:
--
--  * 04-PLANUNG-ZEIT.md §6.7 sagt ausdruecklich, derselbe Dienst markiere
--    Befunde `hinfaellig`, sobald ein erneuter Lauf ueber Person und Tag
--    keinen Verstoss mehr findet. Er tat es nicht — eine Gewerbeaufsicht las
--    in `arbeitszeit_verstoss` also offene Verstoesse, die die Gruppe laengst
--    umgeplant hatte, und die Zeile, die BEWEISEN soll, dass jemand hingesehen
--    hat, behauptete das Gegenteil.
--  * `av_fingerprint_uk` ist partiell auf `hinfaellig_am is null`. Ein Befund,
--    der nie hinfaellig wird, haelt seinen Abdruck fuer immer besetzt, und
--    jeder spaetere Lauf schreibt per `on conflict … do update` in dieselbe
--    alte Zeile — inklusive ihres `erkannt_am` von damals.
--
-- Warum eine Definer-Funktion und kein UPDATE im Dienst: `arbeitszeit_verstoss`
-- hat fuer `cse_app` KEINE Update-Policy und kein Update-Recht (K-06, §6.6) —
-- ein Befund ueber zwei Gesellschaften liegt in beiden, und eine auf Mandant A
-- verengte Verbindung darf in B nichts anfassen. Diese Funktion fasst deshalb
-- ausschliesslich Zeilen des AUFRUFENDEN Mandanten an; die gespiegelte Zeile
-- in der anderen Gesellschaft ueberholt deren eigener Nachtlauf.
-- ---------------------------------------------------------------------------

create function app.arbzg_befund_ueberholen(p_ids uuid[])
returns integer
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_aufrufer uuid := app.aktiver_mandant();
        v_anzahl   integer := 0;
begin
  -- Eine leere Liste ist kein Fehler, sondern der Normalfall eines Laufs, der
  -- nichts aufzuraeumen fand.
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  /*
   * Dasselbe Tor wie in `app.arbzg_befund_schreiben`: der Live-Pfad laeuft mit
   * aktivem Mandanten und braucht das Pruefrecht, der Nachtlauf laeuft ohne
   * und muss `cse_job` SEIN. `session_user` ist von `SECURITY DEFINER`
   * unberuehrt und nennt die Rolle, die sich wirklich verbunden hat.
   *
   * In der Gruppenansicht ist `app.aktiver_mandant()` null und die Rolle
   * `cse_app` — der Aufruf hebt also, und Invariante 10 bleibt gewahrt.
   */
  if v_aufrufer is not null then
    if not app.hat_recht('dienstplan.arbzg_pruefen', v_aufrufer) or app.ist_readonly()
    then raise exception 'nicht berechtigt' using errcode = '42501'; end if;
  elsif session_user <> 'cse_job' then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  /*
   * `status = 'offen'`: eine QUITTIERTE Zeile bleibt stehen. Die Quittierung
   * ist die Aussage „wir haben es bemerkt und Folgendes entschieden"; sie
   * nachtraeglich zu ueberholen loeschte genau die Begruendung, wegen der sie
   * geschrieben wurde.
   *
   * Der Zeitpunkt kommt von der Serveruhr, nie vom Aufrufer (Invariante 5).
   */
  update public.arbeitszeit_verstoss v
     set hinfaellig_am     = now(),
         geaendert_von_art = 'system'
   where v.id = any (p_ids)
     and v.hinfaellig_am is null
     and v.status = 'offen'
     and (v_aufrufer is null or v.mandant_id = v_aufrufer);

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end $$;

-- K-01: eine NEU angelegte Funktion gehoert der Rolle, die die Migration
-- faehrt — also `postgres`. `security definer` machte sie damit zu einer
-- Funktion, die als Superuser an JEDER RLS vorbeilaeuft; die Mandantenpruefung
-- unten waere die einzige verbliebene Schranke gewesen. `create or replace`
-- der Nachbarmigrationen erbt den Eigentuemer und braucht die Zeile deshalb
-- nicht — eine neue Funktion sehr wohl. Die Isolationssuite hat es gefangen.
alter function app.arbzg_befund_ueberholen(uuid[]) owner to cse_definer;

revoke all on function app.arbzg_befund_ueberholen(uuid[]) from public;
-- `cse_app` fuer den Live-Pfad (die Einteilung raeumt mit auf), `cse_job` fuer
-- den Nachtlauf. Einziger Aufrufer: `src/server/services/arbzg/detektor.ts`.
grant execute on function app.arbzg_befund_ueberholen(uuid[]) to cse_app, cse_job;

comment on function app.arbzg_befund_ueberholen(uuid[]) is
  'Setzt hinfaellig_am auf ArbZG-Befunden, die ein erneuter Lauf nicht mehr '
  'findet (§6.7) — nur im Mandanten des Aufrufers, nur auf offenen Zeilen, und '
  'nie loeschend (Invariante 8).';
