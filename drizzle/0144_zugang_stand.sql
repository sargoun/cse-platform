-- 0144 · Der Zugangsstand einer Person — sichtbar, bevor jemand raet (EMP-01, D-488)
--
-- **Der Befund des Nutzers, zu Ende gedacht.** „Ich tippe den Code ein, und
-- es passiert nichts." Drei Ursachen fuehren zu genau diesem Bild, und keine
-- davon war irgendwo abzulesen:
--
--   1. Die Person hat KEINEN Zugang (keine Nummer hinterlegt) — dann gibt es
--      auch keinen Code, und die Anmeldeseite schweigt darueber mit Absicht
--      (0114: kein Orakel fuer den, der Nummern durchprobiert).
--   2. Die Person hat einen Zugang, aber KEIN benutzbares Konto. Dann loest
--      `app.zugang_code_einloesen` den Code ein — und
--      `app.mitarbeiter_sitzung_ausstellen` gibt `null` (0115). Der Code war
--      richtig, verbraucht ist er trotzdem, und die Seite sagte „falscher
--      Code". Wer das dreimal macht, steht danach vor der Bremse.
--   3. Drei offene Codes: die Bremse (0130) haelt, und die Ausstellung
--      scheitert lautlos fuer den, der die Zahl nicht sieht.
--
-- Die Einsatzleitung sieht diesen Stand jetzt, statt ihn zu erraten. Die
-- Nummer verlaesst die Funktion nicht (nur die letzten drei Ziffern), und die
-- Auskunft gibt es nur unter `personal.zugang_verwalten` und nur fuer
-- Beschaeftigte der aktiven Gesellschaft — dieselbe Schranke wie bei der
-- Ausstellung (0143). `cse_app` hat auf `mitarbeiter_zugang` kein Recht und
-- bekommt hier auch keines: die Funktion antwortet, sie oeffnet nicht.

-- **Ein Spaltenrecht kommt dazu, und nur dieses.** `cse_definer` darf
-- `mitarbeiter_zugang.letzter_login_am` seit 0116 SCHREIBEN (jede Anmeldung
-- setzt es), aber nicht lesen. Die Frage „hat sich dieser Mensch ueberhaupt
-- schon einmal angemeldet?" ist genau die, mit der die Einsatzleitung einen
-- Zugangsfall aufloest — und sie an der Spalte vorbei zu raten, ist die
-- Alternative. Kein Recht fuer `cse_app`: die Anwendungsrolle liest diese
-- Tabelle weiterhin gar nicht.
grant select (letzter_login_am) on mitarbeiter_zugang to cse_definer;

create function app.zugang_stand(p_person uuid)
returns table (
  hat_anstellung   boolean,
  hat_zugang       boolean,
  gesperrt         boolean,
  telefon_maskiert text,
  hat_konto        boolean,
  offene_codes     integer,
  letzte_anmeldung timestamptz
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_zugang  uuid;
  v_telefon text;
  v_gesperrt timestamptz;
  v_letzter timestamptz;
begin
  if v_mandant is null or not app.hat_recht('personal.zugang_verwalten', v_mandant) then
    raise insufficient_privilege using message =
      'Den Zugangsstand liest, wer Zugänge verwaltet (personal.zugang_verwalten).';
  end if;

  if not exists (
    select 1 from public.anstellung a
     where a.person_id = p_person and a.mandant_id = v_mandant and a.geloescht_am is null
  ) then
    return query select false, false, false, null::text, false, 0, null::timestamptz;
    return;
  end if;

  select z.id, z.telefon_e164, z.gesperrt_am, z.letzter_login_am
    into v_zugang, v_telefon, v_gesperrt, v_letzter
    from public.mitarbeiter_zugang z
   where z.person_id = p_person;

  return query
    select
      true,
      v_zugang is not null,
      v_gesperrt is not null,
      case when v_telefon is null then null else '…' || right(v_telefon, 3) end,
      /* Dieselben Ausschluesse wie in app.mitarbeiter_sitzung_ausstellen (0115) —
         sonst sagt diese Auskunft „Konto vorhanden", und die Anmeldung sagt Nein. */
      exists (
        select 1 from public.benutzer b
         where b.person_id = p_person
           and b.status = 'aktiv'
           and b.deaktiviert_am is null
           and not b.ist_dienstkonto
           and (b.gesperrt_bis is null or b.gesperrt_bis <= now())
      ),
      (select count(*)::integer from public.mitarbeiter_einmalcode c
        where c.zugang_id = v_zugang and c.verbraucht_am is null and c.gueltig_bis > now()),
      v_letzter;
end $$;

comment on function app.zugang_stand(uuid) is
  'Zugangsstand einer Person fuer die Einsatzleitung: Zugang, Sperre, Konto, offene Codes, '
  'letzte Anmeldung — ohne die Nummer. Nur unter personal.zugang_verwalten und nur fuer '
  'Beschaeftigte der aktiven Gesellschaft (D-488).';

alter function app.zugang_stand(uuid) owner to cse_definer;
revoke execute on function app.zugang_stand(uuid) from public;
grant execute on function app.zugang_stand(uuid) to cse_app;
