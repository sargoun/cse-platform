-- 0278 — `kern.abwesenheitsart_schutz` prueft jetzt WIRKLICH, ob eine Art
--        benutzt ist (K-01, K-05, Invariante 8; 01-KERN §6.22).
--
-- ===========================================================================
-- Der Befund, der diese Migration gebracht hat
-- ===========================================================================
--
-- Der Ausloeser aus 0073 haelt drei Zusagen: der `schluessel` einer BENUTZTEN
-- Art ist unveraenderlich, `bezahlt` faellt nicht auf „ungeklaert" zurueck,
-- und die Art-9-Einstufung einer BENUTZTEN Art bleibt, wie sie ist. Zwei
-- dieser drei Zusagen haengen an derselben Frage: existiert eine
-- `abwesenheit`, die auf diese Art zeigt?
--
-- Diese Frage stellte der Ausloeser bisher mit den Rechten des AUFRUFERS. Er
-- ist `language plpgsql` ohne `security definer`, laeuft also als `cse_app`,
-- und `abwesenheit` traegt `force row level security` mit
-- `t_mandant … app.hat_recht('zeit.abwesenheit_lesen', …)`. Wer dieses Recht
-- nicht haelt, bekommt bei
--
--     exists (select 1 from abwesenheit a where a.abwesenheitsart_id = old.id)
--
-- ein `false` — nicht, weil es keine Abwesenheit gibt, sondern weil er sie
-- nicht sehen darf. Die Sperre verschwand damit lautlos fuer genau die
-- Sitzung, die sie braucht: `stammdaten.verwalten` und `zeit.abwesenheit_lesen`
-- sind zwei Rechte, und die Pflegeseite `/stammdaten/abwesenheitsarten`
-- verlangt nur das erste. Ein Administrator ohne Abwesenheitsrecht haette den
-- Schluessel einer benutzten Art umbenennen koennen — und damit rueckwirkend
-- die Bedeutung jeder Zeile, die in einem Lohnexport auf ihn zeigt.
--
-- Dass nichts dabei kaputtgeht, ist das Problem: es funktioniert genau so
-- lange gut, bis jemand die Umbenennung vornimmt, die der Ausloeser
-- verhindern sollte.
--
-- ===========================================================================
-- Die Reparatur, und was sie NICHT tut
-- ===========================================================================
--
-- `security definer` mit Eigentum `cse_definer` (K-01) — dasselbe Muster, mit
-- dem `kern.nachweis_dokumentpflicht` und `app.abwesenheit_grund_lesen`
-- arbeiten. Die Voraussetzungen stehen seit 0073 bereit: `cse_definer` hat
-- `select` auf `abwesenheit` UND die Policy `ab_definer`; ohne diese Policy
-- laese der Definer unter erzwungener RLS null Zeilen und schwiege genauso.
--
-- Die Funktion gibt NICHTS zurueck als `new` oder eine Meldung: sie zaehlt
-- nicht, sie nennt keine Person, sie schreibt nichts. Der ART-9-Grund einer
-- einzelnen Abwesenheit bleibt, wo er ist — hinter
-- `app.abwesenheit_grund_lesen`, je Zeile, mit Auditeintrag. Das `exists`
-- beantwortet ausschliesslich „gibt es ueberhaupt eine", und diese Auskunft
-- ueber den KATALOG ist keine Auskunft ueber einen Menschen.
--
-- Der Rumpf ist Zeile fuer Zeile der aus 0073. Geaendert sind nur der Kopf
-- (`security definer`, `set search_path`) und das Eigentum.
-- ===========================================================================

create or replace function kern.abwesenheitsart_schutz() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.schluessel is distinct from old.schluessel
     and exists (select 1 from public.abwesenheit a
                  where a.abwesenheitsart_id = old.id) then
    raise exception 'Der Schluessel einer benutzten Abwesenheitsart bleibt, wie er ist'
      using errcode = 'check_violation';
  end if;
  if old.bezahlt is not null and new.bezahlt is null then
    raise exception 'bezahlt faellt nicht auf ungeklaert zurueck'
      using errcode = 'check_violation';
  end if;
  if new.ist_gesundheitsbezogen is distinct from old.ist_gesundheitsbezogen
     and exists (select 1 from public.abwesenheit a
                  where a.abwesenheitsart_id = old.id) then
    raise exception 'Die Art-9-Einstufung einer benutzten Art bleibt, wie sie ist'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

alter function kern.abwesenheitsart_schutz() owner to cse_definer;

comment on function kern.abwesenheitsart_schutz() is
  'Schluessel und Art-9-Einstufung einer BENUTZTEN Abwesenheitsart sind fest, '
  'bezahlt faellt nicht auf NULL zurueck (0073). security definer seit 0278: '
  'ohne Definer beantwortete die Benutzungsfrage die RLS des Aufrufers, und '
  'wer zeit.abwesenheit_lesen nicht hielt, umging die Sperre lautlos.';
