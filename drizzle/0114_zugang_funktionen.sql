/**
 * Die beiden Funktionen, über die eine Anmeldung mit Telefon und Einmalcode
 * läuft (EMP-01, PR 20).
 *
 * **Warum SECURITY DEFINER und nicht die Anwendung.** Wer sich anmeldet, hat
 * noch keine Sitzung: `app.aktueller_benutzer()` ist NULL, `cse_app` sieht
 * unter RLS nichts, und es gibt auch keinen Mandanten zu binden. Die Anmeldung
 * ist damit der eine Weg, der VOR der Autorisierung liegt und trotzdem in die
 * Datenbank greifen muss. Genau dafür gibt es `cse_definer`.
 *
 * **Und deshalb ist der Schnitt hier eng.** Die Anwendung bekommt zwei
 * Funktionen und sonst nichts: eine, die einen Code ausgibt, und eine, die
 * einen Code einlöst. Sie sieht den Hash nie, sie sieht die Codetabelle nie,
 * und sie kann keinen Zugang zu einem Telefon erfragen, das sie nicht schon
 * kennt. Jede Rückgabe ist so schmal wie die Entscheidung, die sie trägt.
 */

/**
 * Einen Einmalcode anfordern.
 *
 * **Die Rückgabe verrät NICHT, ob es die Nummer gibt.** Ein `true` für eine
 * bekannte und ein `false` für eine unbekannte Nummer wäre ein Orakel: wer
 * Nummern durchprobiert, erfährt, welche Menschen bei dieser Gruppe arbeiten.
 * Dieselbe Regel wie AUT-06 (404 statt 403), eine Ebene früher. Die Funktion
 * gibt deshalb IMMER dieselbe Form zurück; ob eine SMS rausgeht, entscheidet
 * sie still.
 *
 * Der Code selbst wird NICHT hier erzeugt: er kommt vom Aufrufer, der ihn
 * versendet, und kommt hier nur als Hash an. Sonst müsste die Funktion ihn
 * zurückgeben, und damit stünde er in jedem Log, das SQL mitschreibt.
 */
create function app.zugang_code_anfordern(
  p_telefon_e164 text,
  p_code_hash    text,
  p_gueltig_bis  timestamptz,
  p_ip           inet default null
) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare
  v_zugang uuid;
  v_offen  integer;
begin
  select z.id into v_zugang
    from public.mitarbeiter_zugang z
   where z.telefon_e164 = p_telefon_e164
     and z.gesperrt_am is null;

  -- Unbekannt oder gesperrt: nach aussen nicht unterscheidbar von "geht raus".
  if v_zugang is null then
    return false;
  end if;

  /**
   * **Die Bremse sitzt HIER und nicht in der Anwendung.**
   *
   * Drei noch gültige, unverbrauchte Codes je Zugang genügen. Ohne diese
   * Zeile könnte jemand mit der Nummer eines Kollegen dessen Telefon in
   * Sekunden mit SMS fluten — und das kostet nicht nur Ruhe, sondern Geld
   * (O-82 nennt ausdrücklich einen Ausgabendeckel). Eine Bremse in der
   * Route wäre eine, die der nächste Aufrufer umgeht.
   */
  select count(*) into v_offen
    from public.mitarbeiter_einmalcode c
   where c.zugang_id = v_zugang
     and c.verbraucht_am is null
     and c.gueltig_bis > now();

  if v_offen >= 3 then
    return false;
  end if;

  insert into public.mitarbeiter_einmalcode (zugang_id, code_hash, gueltig_bis, ip)
  values (v_zugang, p_code_hash, p_gueltig_bis, p_ip);

  return true;
end
$$;

comment on function app.zugang_code_anfordern(text, text, timestamptz, inet) is
  'Legt einen Einmalcode an. Gibt NICHT preis, ob es die Nummer gibt.';

/**
 * Einen Einmalcode einlösen.
 *
 * Gibt die `person_id` zurück, wenn der Code stimmt — sonst NULL. Kein
 * Unterschied zwischen "Nummer unbekannt", "Code falsch", "Code abgelaufen"
 * und "Code schon benutzt": jede dieser Auskünfte wäre ein Hinweis für den,
 * der rät.
 *
 * **Verbraucht wird IM SELBEN Aufruf**, nicht danach. Stünde das Setzen von
 * `verbraucht_am` in der Anwendung, gäbe es ein Fenster zwischen Prüfen und
 * Verbrauchen, in dem derselbe Code zweimal gilt — und genau das ist ein
 * Wiedereinlöse-Angriff. `for update` hält die Zeile für die Dauer der
 * Transaktion; zwei gleichzeitige Einlösungen serialisieren, und die zweite
 * sieht `verbraucht_am` gesetzt.
 */
create function app.zugang_code_einloesen(
  p_telefon_e164 text,
  p_code_hash    text
) returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, public, app, kern as $$
declare
  v_zugang uuid;
  v_person uuid;
  v_code   uuid;
begin
  select z.id, z.person_id into v_zugang, v_person
    from public.mitarbeiter_zugang z
   where z.telefon_e164 = p_telefon_e164
     and z.gesperrt_am is null;

  if v_zugang is null then
    return null;
  end if;

  /**
   * Der JÜNGSTE noch gültige Code — und nur der.
   *
   * Wer zweimal anfordert, bekommt zwei SMS; gültig ist die letzte. Ein
   * älterer, noch nicht abgelaufener Code, der weiter funktionierte, wäre
   * genau der Zettel, den dieses Verfahren vermeiden soll.
   */
  select c.id into v_code
    from public.mitarbeiter_einmalcode c
   where c.zugang_id = v_zugang
     and c.verbraucht_am is null
     and c.gueltig_bis > now()
     and c.fehlversuche < 5
   order by c.erstellt_am desc
   limit 1
     for update;

  if v_code is null then
    return null;
  end if;

  -- Falscher Code: Fehlversuch zählen und schweigen.
  if not exists (select 1 from public.mitarbeiter_einmalcode c
                  where c.id = v_code and c.code_hash = p_code_hash) then
    update public.mitarbeiter_einmalcode
       set fehlversuche = fehlversuche + 1
     where id = v_code;
    return null;
  end if;

  update public.mitarbeiter_einmalcode set verbraucht_am = now() where id = v_code;
  update public.mitarbeiter_zugang     set letzter_login_am = now() where id = v_zugang;

  return v_person;
end
$$;

comment on function app.zugang_code_einloesen(text, text) is
  'Löst einen Einmalcode ein und verbraucht ihn im selben Aufruf. NULL bei jedem Fehlschlag.';

/**
 * `cse_anon` darf beides — und NUR beides.
 *
 * Die anmeldende Person ist noch niemand; ihre Verbindung läuft unter
 * `cse_anon`. Ohne dieses Recht müsste die Anmeldung als `postgres` laufen,
 * und dann wäre jeder Fehler in ihr ein Vollzugriff.
 */
grant execute on function app.zugang_code_anfordern(text, text, timestamptz, inet) to cse_anon, cse_app;
grant execute on function app.zugang_code_einloesen(text, text) to cse_anon, cse_app;
