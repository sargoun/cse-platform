-- 0507 — wer vom Bruch der Rechnungs-Hashkette erfaehrt (V-286, O-357, D-811).
--
-- Der naechtliche Kettenpruefer (kette_pruefen, FIN-06) warf bei einem Bruch,
-- der Runner schrieb den Befund in job_lauf_mandant und ProtokollAlarm eine
-- Zeile nach stderr — zugestellt wurde nichts. Voreinstellung zu O-357
-- (D-779): die Meldung geht an Buchhaltung und Geschaeftsfuehrung der
-- Gesellschaft.
--
-- Empfaenger sind nur Mitglieder der Gesellschaft (gueltige Mitgliedschaft am
-- Berliner Tag, app.berlin_heute(), 0169; aktives Menschenkonto): ein Konto
-- ohne Mitgliedschaft — etwa die globale Super-Administration — hat dort
-- keinen Posteingang, und waechter_meldung nimmt es nicht an
-- (kern.radar_benutzer_im_mandant, 0146/0149). Unter den
-- Mitgliedern ist Buchhaltung, wer buchhaltung.lesen haelt
-- (kern.traeger_des_rechts; finanzen.lesen waere zu weit, das Recht haelt auch
-- die Rolle kunde), und Geschaeftsfuehrung, wer die Systemrolle leitung hat.
-- Jedes Konto steht hoechstens einmal in der Antwort, als Buchhaltung, wenn
-- es beides ist.
--
-- Beide nur, wenn sie finanzen.lesen halten: die Meldung zeigt auf den
-- Pruefbericht der Kette, und der oeffnet mit genau diesem Recht (NOT-03).
-- Nach der Rechtematrix halten es Administration und Leitung; nimmt eine
-- Gesellschaft es einer Rolle, bekommt sie auch die Meldung nicht.
--
-- Ein Definer wie 0504: der Pruefer laeuft nachts als Job, und welche
-- Mitgliedschaften fremder Konten eine Rolle sieht, darf die Empfaengerliste
-- nicht still verkuerzen. Er liest nur Kennungen und schreibt nichts.
--
-- Nur Kommentare mit Doppelstrich.

create function kern.kette_meldung_empfaenger(p_mandant uuid)
returns table (benutzer_id uuid, als text)
language sql stable security definer
set search_path = pg_catalog, public, app as $$
  with mitglieder as (
    select bm.benutzer_id as id,
           bool_or(r.mandant_id is null and r.schluessel = 'leitung') as leitung
      from public.benutzer_mandant bm
      join public.rolle r on r.id = bm.rolle_id
      join public.benutzer b on b.id = bm.benutzer_id
     where bm.mandant_id = p_mandant
       and bm.entzogen_am is null
       and bm.gueltig_ab <= app.berlin_heute()
       and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())
       and b.status = 'aktiv' and b.deaktiviert_am is null and not b.ist_dienstkonto
     group by bm.benutzer_id
  ),
  buchhaltung as (
    select unnest(kern.traeger_des_rechts(p_mandant, 'buchhaltung.lesen')) as id
  ),
  lesende as (
    select unnest(kern.traeger_des_rechts(p_mandant, 'finanzen.lesen')) as id
  )
  select m.id,
         case when m.id in (select id from buchhaltung) then 'buchhaltung' else 'leitung' end
    from mitglieder m
   where (m.id in (select id from buchhaltung) or m.leitung)
     and m.id in (select id from lesende)
$$;

comment on function kern.kette_meldung_empfaenger(uuid) is
  'V-286, O-357, D-811: Empfaenger der Meldung „Hashkette gebrochen" in einer Gesellschaft — '
  'ihre Mitglieder mit buchhaltung.lesen (Buchhaltung) oder der Rolle leitung '
  '(Geschaeftsfuehrung), beide mit finanzen.lesen (das Ziel); jedes Konto einmal.';

alter function kern.kette_meldung_empfaenger(uuid) owner to cse_definer;
revoke execute on function kern.kette_meldung_empfaenger(uuid) from public;
grant execute on function kern.kette_meldung_empfaenger(uuid) to cse_app, cse_job;
