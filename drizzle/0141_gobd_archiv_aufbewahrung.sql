-- ===========================================================================
-- 0141 — GoBD-Archiv: der Beginn der Aufbewahrung, die Regeln je
--        Gesellschaft, die gesetzlichen Untergrenzen (PR 64, ACC-06,
--        DOC-07, LEG-01, D-483)
-- ===========================================================================
--
-- **Der Beginn der Frist stand bisher auf der Uhr des Einfuegens.**
-- `kern.setze_aufbewahrung` rechnete `extract(year from now()) + jahre`:
-- das Jahr, in dem die ZEILE entstand. Ein Dezemberbeleg, den der naechtliche
-- Archivlauf im Januar ablegt, bekam damit ein Jahr mehr — in die sichere
-- Richtung, aber falsch, und eine Pruefung fragt nach der richtigen Zahl.
--
-- § 147 Abs. 4 AO und § 257 Abs. 5 HGB sagen, wann die Frist beginnt: mit
-- dem Schluss des KALENDERJAHRS, in dem der Buchungsbeleg entstanden, der
-- Handelsbrief empfangen oder abgesandt, die Buchung gemacht worden ist.
-- Nicht mit dem Wirtschaftsjahr — ein abweichendes Wirtschaftsjahr (O-05)
-- bestimmt, zu welchem Jahrgang ein Beleg gehoert, nicht, wann seine Frist
-- beginnt. Der PR-Plan (08-PR-PLAN §PR 64) sprach vom „fiscal-year end";
-- das Gesetz ist praeziser, und das Gesetz gilt.
--
-- Deshalb traegt `dokument` jetzt `entstanden_am`: den Tag, an dem das
-- Dokument im Sinne des Gesetzes ENTSTAND — Rechnungsdatum, Belegdatum,
-- Datum des Kontoauszugs, sonst der Berliner Tag der Ablage. Die Frist
-- rechnet `app.aufbewahrung_ende` aus diesem Tag; der Ausloeser setzt sie,
-- und niemand tippt sie.
--
-- **Die Regeln je Gesellschaft.** `dokument_aufbewahrung` kannte Zeilen mit
-- `mandant_id`, aber niemand durfte sie schreiben. Jetzt darf es, wer
-- `dokument.aufbewahrung_verwalten` haelt — im aktiven Bereich, nicht
-- lesend, nie an den Plattformzeilen. Und ein Ausloeser haelt die
-- gesetzlichen UNTERGRENZEN: zehn Jahre fuer Rechnungen, Buchungsbelege und
-- Buchhaltungsunterlagen (§ 147 Abs. 3 AO, § 257 Abs. 4 HGB), sechs fuer
-- Handelsbriefe (Vertraege, Angebote, Kundenkorrespondenz — § 257 Abs. 4
-- HGB). Eine Gesellschaft kann laenger aufbewahren, nie kuerzer; und die
-- Loeschsperre der Finanzkategorien laesst sich nicht abwaehlen.
--
-- Eine geaenderte Regel gilt fuer Dokumente, die DANACH entstehen. Was
-- schon liegt, behaelt seine Frist: `aufbewahrung_bis` darf spaeter werden,
-- nie frueher — auch das haelt der Ausloeser.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Entstehungstag
-- ---------------------------------------------------------------------------

alter table dokument add column entstanden_am date;

comment on column dokument.entstanden_am is
  'Der Tag, an dem das Dokument im Sinne von § 147 Abs. 4 AO entstand (Rechnungsdatum, '
  'Belegdatum, Auszugsdatum, sonst der Tag der Ablage). Beginn der Aufbewahrungsfrist ist '
  'der Schluss dieses Kalenderjahrs. Unveraenderlich.';

-- Rueckwirkend: der Berliner Tag der Ablage — die beste Auskunft, die die
-- Zeile ueber sich hat. `dokument` traegt keinen Audit-Ausloeser; die
-- Migration selbst ist der Nachweis der Aenderung.
update dokument
   set entstanden_am = (erstellt_am at time zone 'Europe/Berlin')::date
 where entstanden_am is null;

alter table dokument alter column entstanden_am set not null;

/**
 * Das Ende der Aufbewahrung: der 31.12. des Entstehungsjahrs plus die Jahre
 * der Regel. IMMUTABLE — dieselben Eingaben, dasselbe Datum, ohne Uhr.
 */
create function app.aufbewahrung_ende(p_entstanden date, p_jahre integer)
returns date
language sql immutable strict as $$
  select make_date(extract(year from p_entstanden)::int + p_jahre, 12, 31)
$$;

comment on function app.aufbewahrung_ende(date, integer) is
  '§ 147 Abs. 4 AO, § 257 Abs. 5 HGB: die Frist beginnt mit dem Schluss des Kalenderjahrs, '
  'in dem das Dokument entstand, und endet nach p_jahre Jahren am 31.12. (D-483).';

grant execute on function app.aufbewahrung_ende(date, integer) to cse_app, cse_job, cse_definer;

-- ---------------------------------------------------------------------------
-- 2. Der Ausloeser rechnet aus dem Entstehungstag — und laesst nichts kuerzer
--    werden
-- ---------------------------------------------------------------------------

create or replace function kern.setze_aufbewahrung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare r record;
begin
  if tg_op = 'UPDATE' then
    -- Eine gesetzte Loeschsperre wird nicht wieder geloest.
    if old.loeschsperre and not new.loeschsperre then
      raise exception 'Die Loeschsperre eines Dokuments kann nicht aufgehoben werden (DOC-07)'
        using errcode = 'restrict_violation';
    end if;
    -- Der Entstehungstag ist eine Tatsache, kein Feld.
    if new.entstanden_am is distinct from old.entstanden_am then
      raise exception 'Der Entstehungstag eines Dokuments wird nicht geaendert (§ 147 Abs. 4 AO, D-483)'
        using errcode = 'restrict_violation';
    end if;
    -- Die Frist wird spaeter oder bleibt — nie frueher, nie wieder offen.
    if old.aufbewahrung_bis is not null
       and (new.aufbewahrung_bis is null or new.aufbewahrung_bis < old.aufbewahrung_bis) then
      raise exception 'Die Aufbewahrungsfrist eines Dokuments wird nicht verkuerzt (DOC-07, LEG-01)'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  new.entstanden_am := coalesce(new.entstanden_am, app.berlin_heute());

  select * into r from app.aufbewahrung_regel(new.mandant_id, new.kategorie::text);

  if not found then
    -- Keine Regel heisst nicht "keine Pflicht". Es heisst, dass niemand
    -- entschieden hat — und eine unbekannte Pflicht wird als Pflicht
    -- behandelt (K-17, O-25).
    new.aufbewahrung_bis := null;
    new.loeschsperre := true;
    return new;
  end if;

  new.loeschsperre := r.loeschsperre or r.ist_platzhalter;
  new.aufbewahrung_bis := case
    when r.jahre is null then null
    else app.aufbewahrung_ende(new.entstanden_am, r.jahre)
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Regeln je Gesellschaft — schreibbar unter dem Recht, mit Untergrenzen
-- ---------------------------------------------------------------------------

alter table dokument_aufbewahrung
  add column geaendert_von uuid references benutzer(id);

/**
 * Die gesetzlichen Untergrenzen je Kategorie. Eine Zeile, die darunter
 * liegt, entsteht nicht — auch nicht als Plattformzeile, auch nicht als
 * Eigentuemer. Die Zahlen sind die des Gesetzes, nicht die einer Vorgabe:
 *   10 Jahre — § 147 Abs. 1 Nr. 1, 4 und Abs. 3 AO; § 257 Abs. 1 Nr. 1, 4
 *              und Abs. 4 HGB (Buecher, Buchungsbelege, Rechnungen: § 14b UStG)
 *    6 Jahre — § 147 Abs. 1 Nr. 2, 3 und Abs. 3 AO; § 257 Abs. 1 Nr. 2, 3
 *              und Abs. 4 HGB (empfangene und abgesandte Handelsbriefe)
 * `mitarbeiter`, `projekt`, `unternehmen` haben keine eine Zahl (O-25) und
 * bleiben ohne Untergrenze — dort haelt der Platzhalter die Sperre.
 */
create function kern.aufbewahrung_untergrenze() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_min integer;
begin
  v_min := case new.kategorie
    when 'rechnung' then 10
    when 'buchhaltung' then 10
    when 'beleg' then 10
    when 'vertrag' then 6
    when 'angebot' then 6
    when 'kunde' then 6
    else null
  end;
  if v_min is not null then
    if new.jahre is null or new.jahre < v_min then
      raise exception
        'Aufbewahrung fuer % unter der gesetzlichen Mindestfrist von % Jahren (§ 147 AO, § 257 HGB)',
        new.kategorie, v_min
        using errcode = 'restrict_violation';
    end if;
    if v_min >= 10 and not new.loeschsperre then
      raise exception
        'Die Loeschsperre fuer % ist gesetzlich (§ 147 AO, § 257 HGB) und laesst sich nicht abwaehlen',
        new.kategorie
        using errcode = 'restrict_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.geaendert_am := now();
  end if;
  return new;
end $$;

create trigger trg_aufbewahrung_untergrenze
  before insert or update on dokument_aufbewahrung
  for each row execute function kern.aufbewahrung_untergrenze();

create policy t_aufbewahrung_anlegen on dokument_aufbewahrung for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('dokument.aufbewahrung_verwalten', mandant_id));

create policy t_aufbewahrung_aendern on dokument_aufbewahrung for update to cse_app
  using (mandant_id is not null and mandant_id = app.aktiver_mandant()
         and not app.ist_readonly()
         and app.hat_recht('dokument.aufbewahrung_verwalten', mandant_id))
  with check (mandant_id = app.aktiver_mandant()
              and app.hat_recht('dokument.aufbewahrung_verwalten', mandant_id));

grant insert, update on dokument_aufbewahrung to cse_app;
-- Loeschen gibt es nicht: eine Regel, die es nicht mehr gibt, ist eine
-- Frist, die niemand mehr kennt. Wer zur Plattformvorgabe zurueck will,
-- setzt die Zeile auf deren Werte.
revoke delete, truncate on dokument_aufbewahrung from cse_app, cse_anon, cse_checkin, cse_job;
