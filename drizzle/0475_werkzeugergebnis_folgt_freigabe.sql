-- 0475 — Ein zurückgehaltenes Werkzeugergebnis folgt seiner Freigabe
--        (AGT-02, AGT-03, Invariante 7, V-270, D-763).
--
-- `agent_werkzeug.erfordert_freigabe` war eine Anzeige: das Agentenblatt schrieb
-- „in dieser Gesellschaft: nur mit Freigabe", und der CEO-Assistent zeigte jede
-- Antwort sofort. Seit V-270 legt die Laufzeit ein solches Ergebnis als
-- `freigabe` mit der Aktion `werkzeug_ergebnis` in den Posteingang; die Aufgabe
-- steht auf `wartet_auf_freigabe`, und ausgeliefert wird die Antwort nur durch
-- das Tor in `server/agent/policy.ts` (`gateWerkzeugErgebnis`).
--
-- Diese Datei zieht die AUFGABE nach, wenn ein Mensch entscheidet — auf jedem
-- Weg, auf dem eine Freigabe ihren Stand ändert (Einzelentscheidung, Stapel,
-- Fensterlauf). Sie liefert NICHTS aus: die Antwort steht nicht in der Aufgabe,
-- sondern in der Freigabe, und die Anwendung liest sie nur über das Tor.

/**
 * Dasselbe Muster wie `app.antwort_folgt_freigabe` (0174) und
 * `app.stelle_folgt_freigabe` (0167), und aus demselben Grund: eine ABLEHNUNG
 * sieht kein Ausführer. Wer den Stand nur bei `genehmigt` nachzöge, liesse
 * eine abgelehnte Antwort auf ewig „In Prüfung" stehen.
 *
 *  - `genehmigt`: die Aufgabe ist abgeschlossen. Ob die Antwort herausgeht,
 *    entscheidet trotzdem erst das Tor beim Lesen — gegen den Abdruck der
 *    entschiedenen Nutzlast (`freigabe_snapshot.nutzlast_hash`).
 *  - jeder andere Endstand (abgelehnt, abgelaufen, zurückgezogen, widerrufen,
 *    durch Korrektur ersetzt, automatisch nach Frist): die Aufgabe ist
 *    abgebrochen, mit dem Satz, warum. Eine Freigabe ohne benannten Menschen
 *    ist keine — das Tor liefert dann nicht aus, also endet auch die Aufgabe.
 *
 * Nur Zeilen, die noch warten: eine schon beendete Aufgabe wird nicht
 * umgeschrieben.
 */
create function app.werkzeug_ergebnis_folgt_freigabe() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.status = old.status then return new; end if;
  if new.aktion is distinct from 'werkzeug_ergebnis' or new.agent_aufgabe_id is null then
    return new;
  end if;

  if new.status = 'genehmigt' then
    update public.agent_aufgabe
       set status = 'abgeschlossen',
           beendet_am = coalesce(beendet_am, now())
     where id = new.agent_aufgabe_id and mandant_id = new.mandant_id
       and status = 'wartet_auf_freigabe';
  elsif new.status in ('abgelehnt', 'abgelaufen', 'zurueckgezogen', 'widerrufen',
                       'korrigiert', 'automatisch_freigegeben') then
    update public.agent_aufgabe
       set status = 'abgebrochen',
           beendet_am = coalesce(beendet_am, now()),
           fehler_text = 'Die Freigabe dieser Antwort wurde nicht erteilt — sie geht '
                         || 'nicht an die fragende Person.'
     where id = new.agent_aufgabe_id and mandant_id = new.mandant_id
       and status = 'wartet_auf_freigabe';
  end if;

  return new;
end;
$$;

comment on function app.werkzeug_ergebnis_folgt_freigabe() is
  'AGT-02, Invariante 7, V-270. Zieht die Aufgabe eines zurueckgehaltenen Werkzeugergebnisses '
  'nach, auch bei einer ABLEHNUNG. Liefert nichts aus — das tut nur das Tor in policy.ts.';

alter function app.werkzeug_ergebnis_folgt_freigabe() owner to cse_definer;
revoke all on function app.werkzeug_ergebnis_folgt_freigabe() from public;

/**
 * Zuteilung und Policy stehen schon: `cse_definer` hält `select, update` auf
 * `agent_aufgabe` und die Policy `d_aufgabe` (0128). Die Funktion liest nichts
 * ausser der Zeile, die der Auslöser ihr gibt.
 */
create trigger freigabe_zieht_werkzeugergebnis_nach
  after update of status on freigabe
  for each row execute function app.werkzeug_ergebnis_folgt_freigabe();
