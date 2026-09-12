-- 0094 — `app.arbzg_befund_ueberholen` bekommt den Mandanten gesagt, statt ihn
-- im Nachtlauf wegzulassen.
--
-- **Was offenstand.** Das Praedikat lautete
-- `(v_aufrufer is null or v.mandant_id = v_aufrufer)`. Im Live-Pfad ist
-- `v_aufrufer` der aktive Mandant und die Schranke wirkt. Im Nachtlauf
-- verbindet sich `cse_job` OHNE Mandanten, `v_aufrufer` ist null — und damit
-- ist die linke Seite wahr und die Schranke wirkungslos. Der eigene Kommentar
-- der Funktion sagte „nur im Mandanten des Aufrufers"; fuer den Nachtlauf war
-- das nicht wahr.
--
-- **Warum das heute nicht auffaellt und trotzdem zaehlt.** Der einzige
-- Aufrufer (`detektor.ts`) sammelt die Kennungen aus `planungs_konflikt` EINES
-- Mandanten; die Spalte haengt an `pk_verstoss_fk (mandant_id,
-- arbeitszeit_verstoss_id)`, also stammt sie aus demselben Mandanten. Die
-- Liste `details.belege` daneben ist aber freies `jsonb` ohne Fremdschluessel:
-- was dort steht, hat niemand geprueft. Eine fremde Kennung darin wuerde im
-- Nachtlauf ohne Widerspruch ueberholt — ein ArbZG-Befund einer anderen
-- Gesellschaft verschwaende aus deren Eingang, und niemand bekaeme eine
-- Meldung. Invariante 3 sagt, die Trennung haengt nicht daran, dass der
-- Aufrufer sauber aufraeumt.
--
-- **Die Form.** Der Mandant wird PARAMETER und nicht aus der Sitzung geraten:
-- der Nachtlauf weiss, fuer welche Gesellschaft er gerade laeuft (er
-- iteriert ueber sie), und im Live-Pfad muss er zum aktiven passen, sonst
-- waere er eine zweite Wahrheit neben `app.aktiver_mandant()`.

drop function if exists app.arbzg_befund_ueberholen(uuid[]);

create function app.arbzg_befund_ueberholen(p_ids uuid[], p_mandant uuid)
returns integer
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_aufrufer uuid := app.aktiver_mandant();
        v_ziel     uuid;
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
    /*
     * Ein abweichender Parameter ist ein Programmierfehler und keine
     * Berechtigungsfrage: er hiesse, der Aufrufer meint eine andere
     * Gesellschaft als die, in der er steht. Still den aktiven zu nehmen
     * verstecke den Widerspruch.
     */
    if p_mandant is not null and p_mandant <> v_aufrufer then
      raise exception 'Mandant % ist nicht der aktive %', p_mandant, v_aufrufer
        using errcode = '42501';
    end if;
    v_ziel := v_aufrufer;
  elsif session_user <> 'cse_job' then
    raise exception 'nicht berechtigt' using errcode = '42501';
  else
    /*
     * Ohne Sitzung gibt es keinen Mandanten zu erraten. Den Parameter hier
     * optional zu lassen hiesse, die Schranke wieder wegzulassen — genau der
     * Zustand, den diese Migration behebt.
     */
    if p_mandant is null then
      raise exception 'der Nachtlauf muss den Mandanten nennen'
        using errcode = '22004';
    end if;
    v_ziel := p_mandant;
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
     and v.mandant_id = v_ziel;

  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end $$;

-- K-01: `create function` legt die Funktion unter dem Konto an, das die
-- Migration faehrt — `postgres`, Superuser mit BYPASSRLS. Ohne diese Zeile
-- waere aus einer Reparatur eine neue Altlast geworden.
alter function app.arbzg_befund_ueberholen(uuid[], uuid) owner to cse_definer;

revoke all on function app.arbzg_befund_ueberholen(uuid[], uuid) from public;
-- `cse_app` fuer den Live-Pfad (die Einteilung raeumt mit auf), `cse_job` fuer
-- den Nachtlauf. Einziger Aufrufer: `src/server/services/arbzg/detektor.ts`.
grant execute on function app.arbzg_befund_ueberholen(uuid[], uuid) to cse_app, cse_job;

comment on function app.arbzg_befund_ueberholen(uuid[], uuid) is
  'Setzt hinfaellig_am auf ArbZG-Befunden, die ein erneuter Lauf nicht mehr '
  'findet (§6.7) — nur im GENANNTEN Mandanten, der im Live-Pfad der aktive '
  'sein muss und im Nachtlauf angegeben werden MUSS, nur auf offenen Zeilen, '
  'und nie loeschend (Invariante 8).';
