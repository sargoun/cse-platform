/**
 * Eine Check-in-Marke von Hand widerrufen (TIM-07).
 *
 * **Der Befund, der diese Migration nötig machte.** Die Einlösung der Marke
 * ist seit 0035 vollständig gebaut — Stempeluhr, Route, Offline-Warteschlange,
 * Schichtfoto. Die AUSGABE hatte dagegen genau einen Aufrufer: den Seed.
 * `04-SEITENKARTE.md` führt `/portal/[mandant]/zeiten/checkin-links` als
 * Phase-5-Lieferung mit „issue, re-issue, revoke" — die Seite gab es nicht,
 * und ohne sie kann in einer Auslieferung **niemand** eine Marke ausgeben.
 * Eine Zeiterfassung, deren einziger Weg nach TIM-07 verschlossen ist, ist
 * keine.
 *
 * Diese Datei liefert das fehlende Drittel: den Widerruf.
 *
 * **Warum ein Definer und kein Schreibrecht.** `cse_app` hat auf
 * `checkin_token` bis heute NUR `select` (0035:493 gibt `insert, update` allein
 * an `cse_definer`). Das ist richtig so: wer eine Marke ändern darf, könnte
 * auch `token_hash`, `gueltig_bis` oder `eingeloest_am` ändern — und damit
 * eine Zeiterfassung, die vor Gericht etwas bezeugen soll. Der Widerruf
 * bekommt deshalb dieselbe Bauart wie die Ausgabe: eine Funktion, die genau
 * eine Spaltengruppe setzt und ihr Recht selbst prüft.
 *
 * **Das Recht wird im Mandanten der MARKE geprüft**, nicht im aktiven der
 * Sitzung — wortgleich die Begründung aus `app.checkin_ausgeben`: die Funktion
 * läuft als Definer, also trägt sie ihre Prüfung selbst, und ein Aufrufer mit
 * einem anderen aktiven Mandanten dürfte sonst fremde Marken widerrufen.
 *
 * **Eine eingelöste Marke wird nicht widerrufen.** Sie hat gewirkt; der
 * Zeiteintrag steht. Ein Widerruf danach änderte nichts an der Wirkung und
 * behauptete im Protokoll das Gegenteil.
 */
create function app.checkin_widerrufen(p_token uuid, p_grund text)
returns boolean
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  v_mandant uuid;
  v_grund   text := btrim(coalesce(p_grund, ''));
begin
  /*
   * Ein Widerruf ohne Grund ist keine Auskunft — er steht im Protokoll, und
   * jemand wird danach fragen. Der CHECK auf der Tabelle (0035:145) verlangt
   * ihn ohnehin; hier kommt er mit einer Meldung, die jemand lesen kann.
   */
  if v_grund = '' then
    raise exception 'Ein Widerruf braucht einen Grund'
      using errcode = 'check_violation';
  end if;

  select ct.mandant_id into v_mandant
    from public.checkin_token ct
   where ct.id = p_token;
  if not found then
    -- AUT-06: dass es die Marke nicht gibt, ist dieselbe Antwort wie
    -- „nicht fuer Sie". Der Aufrufer bekommt `false` und kein Orakel.
    return false;
  end if;

  if not app.hat_recht('zeit.checkin_verwalten', v_mandant) then
    raise exception 'Kein Recht, Check-in-Marken zu widerrufen'
      using errcode = 'insufficient_privilege';
  end if;

  update public.checkin_token
     set widerrufen_am = now(), widerruf_grund = v_grund
   where id = p_token
     and eingeloest_am is null and widerrufen_am is null;

  if not found then
    -- Schon eingeloest oder schon widerrufen: kein Fehler, nur nichts zu tun.
    return false;
  end if;

  perform app.protokolliere('zeit.checkin_marke_widerrufen', 'checkin_token',
                            p_token::text, null,
                            jsonb_build_object('grund', v_grund), v_mandant);
  return true;
end $$;

comment on function app.checkin_widerrufen(uuid, text) is
  'Widerruft eine noch nicht eingeloeste Check-in-Marke; prueft '
  'zeit.checkin_verwalten im Mandanten der Marke (TIM-07).';

revoke execute on function app.checkin_widerrufen(uuid, text) from public;
grant execute on function app.checkin_widerrufen(uuid, text) to cse_app;
