-- 0504 — wer vom Ablauf eines Nachweises erfaehrt (V-380, O-31, D-810).
--
-- Der Ablaufwaechter meldete nur der Beschaeftigten selbst
-- (nachweis.ablauf_60/30/7). Voreinstellung zu O-31 (D-800): ab 30 Tagen
-- zusaetzlich die Personalstelle, ab 7 Tagen die Leitung der Gesellschaft.
--
-- Personalstelle: wer in der erfassenden Gesellschaft personal.nachweis_lesen
-- haelt — kern.traeger_des_rechts, ohne Dienstkonten. Leitung: wer dort die
-- Systemrolle leitung mit gueltiger Mitgliedschaft hat — gueltig am Berliner
-- Tag (app.berlin_heute(), 0169), nie am Tag der Sitzungszeitzone. Jedes Konto steht
-- hoechstens einmal in der Antwort: wer beides ist, steht ab der 7-Tage-Stufe
-- als Leitung darin, sonst als Personalstelle. Die Konten der Person selbst
-- stehen nie darin — sie hat ihre eigene Warnung.
--
-- Auch die Leitung nur, wenn sie personal.nachweis_lesen haelt: die Meldung
-- nennt Mensch und Nachweis und zeigt auf das Nachweisregister, das genau
-- dieses Recht verlangt (NOT-03). Nach der Rechtematrix haelt die Leitung es;
-- nimmt eine Gesellschaft es ihr, bekommt sie auch die Meldung nicht.
--
-- Ein Definer, weil der Waechter unter cse_job laeuft und die Tests ihn unter
-- einer Planungssitzung rufen: die Mitgliedschaften fremder Konten sieht keine
-- der beiden Rollen, und eine Empfaengerliste, die davon abhaengt, wer fragt,
-- waere still unvollstaendig. Er liest nur Kennungen und schreibt nichts.
--
-- Nur Kommentare mit Doppelstrich.

create function kern.nachweis_ablauf_empfaenger(
  p_mandant uuid, p_person uuid, p_mit_leitung boolean
) returns table (benutzer_id uuid, als text)
language sql stable security definer
set search_path = pg_catalog, public, app as $$
  with eigene as (
    select b.id from public.benutzer b where b.person_id = p_person
  ),
  lesende as (
    select unnest(kern.traeger_des_rechts(p_mandant, 'personal.nachweis_lesen')) as id
  ),
  leitung as (
    select distinct bm.benutzer_id as id
      from public.benutzer_mandant bm
      join public.rolle r on r.id = bm.rolle_id
                         and r.mandant_id is null and r.schluessel = 'leitung'
      join public.benutzer b on b.id = bm.benutzer_id
     where p_mit_leitung
       and bm.mandant_id = p_mandant
       and bm.entzogen_am is null
       and bm.gueltig_ab <= app.berlin_heute()
       and (bm.gueltig_bis is null or bm.gueltig_bis >= app.berlin_heute())
       and b.status = 'aktiv' and b.deaktiviert_am is null and not b.ist_dienstkonto
       and b.id not in (select id from eigene)
       and b.id in (select id from lesende)
  )
  select l.id, 'leitung' from leitung l
  union all
  select p.id, 'personalstelle' from lesende p
   where p.id not in (select id from eigene)
     and p.id not in (select id from leitung)
$$;

comment on function kern.nachweis_ablauf_empfaenger(uuid, uuid, boolean) is
  'V-380, O-31, D-810: Empfaenger der Ablaufmeldung eines Nachweises in der erfassenden '
  'Gesellschaft — Personalstelle (personal.nachweis_lesen) und, wenn p_mit_leitung, die '
  'Leitung (Rolle leitung, ebenfalls mit personal.nachweis_lesen); jedes Konto einmal, '
  'nie das der Person selbst.';

alter function kern.nachweis_ablauf_empfaenger(uuid, uuid, boolean) owner to cse_definer;
revoke execute on function kern.nachweis_ablauf_empfaenger(uuid, uuid, boolean) from public;
grant execute on function kern.nachweis_ablauf_empfaenger(uuid, uuid, boolean)
  to cse_app, cse_job;
