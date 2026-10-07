-- 0499 — die eigene Schicht traegt bis Schichtende plus Ausstempeltoleranz
-- (V-326, O-740, D-789, D-808).
--
-- `app.eigene_einsatz_objekte` (0069) und `app.eigene_einsatz_projekte` (0071)
-- verlangten `ende_zeitpunkt >= now()`. Mit der Minute des Schichtendes fiel
-- das Objekt aus dem M1-Scope: Wachbuch, Fotos, Leistungsnachweis und
-- Bautagebuch wiesen ab — genau dann, wenn CLN-04 den Kunden am Ende der
-- Schicht unterschreiben laesst und das Ausstempeln noch eine Stunde offen ist.
--
-- Die Voreinstellung zu O-740 (D-789): dieselbe Toleranz wie beim Ausstempeln,
-- `zeit.checkout_toleranz_minuten` der Gesellschaft (ausgeliefert 60,
-- `kern.checkin_fenster_ableiten`, 0035). Ein Wert, der keine ganze Zahl von
-- Minuten ist, gilt als nicht gesetzt — sonst risse eine verstellte
-- Einstellung jede M1-Policy der Gesellschaft mit einem Typfehler mit.
--
-- `create or replace`: Eigentum und Rechte bleiben, wie sie sind. Beide
-- Funktionen stehen in der Altlastliste von `definer-eigentum.test.ts`; sie
-- dort herauszuholen ist eine eigene Pruefrunde (D-300), nicht diese.

create or replace function app.eigene_einsatz_objekte()
returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct e.objekt_id), '{}'::uuid[])
    from public.einsatz_zuordnung z
    join public.einsatz e on e.id = z.einsatz_id and e.mandant_id = z.mandant_id
    join public.anstellung a on a.id = z.anstellung_id
    cross join lateral (
      select app.einstellung(e.mandant_id, 'zeit.checkout_toleranz_minuten') #>> '{}' as roh
    ) t
   where app.aktuelle_person() is not null
     and a.person_id = app.aktuelle_person()
     and z.entfernt_am is null
     and z.status <> 'abgesagt'
     and e.storniert_am is null
     and e.ende_zeitpunkt + make_interval(mins => case
           when t.roh ~ '^[0-9]{1,4}$' then t.roh::int else 60 end) >= now()
     and case app.scope()
           when 'mandant' then e.mandant_id = app.aktiver_mandant()
           when 'person'  then e.mandant_id = any (app.sichtbare_mandanten())
           else false
         end;
$$;

comment on function app.eigene_einsatz_objekte() is
  'Die Objekte der eigenen laufenden und kommenden Einsaetze (§1.10) — bis '
  'Schichtende plus zeit.checkout_toleranz_minuten (V-326). Loest in allen vier '
  'Leseumfaengen auf (K-20); in gruppe und kunde LEER, nicht NULL.';

create or replace function app.eigene_einsatz_projekte()
returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct e.projekt_id), '{}'::uuid[])
    from public.einsatz_zuordnung z
    join public.einsatz e on e.id = z.einsatz_id and e.mandant_id = z.mandant_id
    join public.anstellung a on a.id = z.anstellung_id
    cross join lateral (
      select app.einstellung(e.mandant_id, 'zeit.checkout_toleranz_minuten') #>> '{}' as roh
    ) t
   where app.aktuelle_person() is not null
     and a.person_id = app.aktuelle_person()
     and e.projekt_id is not null
     and z.entfernt_am is null
     and z.status <> 'abgesagt'
     and e.storniert_am is null
     and e.ende_zeitpunkt + make_interval(mins => case
           when t.roh ~ '^[0-9]{1,4}$' then t.roh::int else 60 end) >= now()
     and case app.scope()
           when 'mandant' then e.mandant_id = app.aktiver_mandant()
           when 'person'  then e.mandant_id = any (app.sichtbare_mandanten())
           else false
         end;
$$;

comment on function app.eigene_einsatz_projekte() is
  'Die Bauprojekte der eigenen laufenden und kommenden Einsaetze (§1.10, '
  'BAU-02, BAU-07) — bis Schichtende plus zeit.checkout_toleranz_minuten '
  '(V-326). Loest in allen vier Leseumfaengen auf (K-20).';
