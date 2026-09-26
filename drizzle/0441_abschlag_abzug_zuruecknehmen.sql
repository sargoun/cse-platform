-- 0441 — ein Abzug laesst sich immer zuruecknehmen (FIN-08, V-207, V-209, D-700, D-702).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- fin.abschlag_pruefen (0117) haengt als BEFORE INSERT OR UPDATE an
-- abschlagsrechnung_bezug und prueft bei JEDER Anweisung, ob der Abzug
-- gueltig ENTSTEHEN darf: Schlussrechnung, festgeschriebener Abschlag,
-- derselbe Kunde, derselbe Auftrag, kein Storno des Abschlags. Genau so
-- prueft sie auch die Anweisung, die einen Abzug ZURUECKNIMMT
-- (set wirksam = false). Zwei Wege tun das:
--
--   1. aendereEntwurfKopf (finanz/entwurf.ts, V-204): wechselt eine
--      Schlussrechnung Art oder Auftrag, faellt der Abzug.
--   2. verwerfe (finanz/rechnung.ts, seit V-207): ein verworfener
--      Schlussrechnungsentwurf gibt seine Abschlaege frei.
--
-- Ist der abgezogene Abschlag inzwischen storniert, weist die Pruefung die
-- Ruecknahme ab ("Abschlag ... ist storniert und kann nicht abgezogen
-- werden") — eine rohe Postgres-Ausnahme, im Browser eine 500. Der Entwurf
-- haengt dann an einem Abzug fest, den niemand mehr will und den die
-- Datenbank nicht loslaesst.
--
-- ===========================================================================
-- Die Regel
-- ===========================================================================
--
-- Eine REINE Ruecknahme — wirksam faellt von true auf false, sonst aendert
-- sich keine Spalte — gibt nichts, sie nimmt etwas weg. Sie wird nicht gegen
-- die Bedingungen des Entstehens geprueft. Alles andere laeuft wie in 0117:
-- ein neuer Abzug, ein wiederbelebter (schreibeVerrechnung setzt wirksam
-- wieder auf true), ein geaenderter Betrag.
--
-- Der Rumpf ist sonst WOERTLICH der aus 0117 — create or replace ersetzt die
-- Funktion ganz, und was 0117 prueft, bleibt geprueft. Keine andere Migration
-- definiert diese Funktion (grep ueber drizzle: nur 0117).

create or replace function fin.abschlag_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_schluss record;
  v_abschlag record;
begin
  -- 0441: eine reine Ruecknahme prueft nichts, was nur fuer das Entstehen gilt.
  if tg_op = 'UPDATE' and old.wirksam and not new.wirksam
     and (to_jsonb(new) - 'wirksam') = (to_jsonb(old) - 'wirksam') then
    return new;
  end if;

  select rechnungsart, status, kunde_id, auftrag_id, mandant_id
    into v_schluss from public.rechnung where id = new.schluss_rechnung_id;
  select rechnungsart, status, kunde_id, auftrag_id, mandant_id, nummer
    into v_abschlag from public.rechnung where id = new.abschlag_rechnung_id;

  if v_schluss is null or v_abschlag is null then
    raise exception 'Abschlagsbezug auf eine Rechnung, die es nicht gibt.'
      using errcode = 'foreign_key_violation';
  end if;

  if v_schluss.rechnungsart <> 'schluss' then
    raise exception 'Abschläge werden nur von einer Schlussrechnung abgezogen (%, nicht schluss).',
      v_schluss.rechnungsart using errcode = 'check_violation';
  end if;

  if v_abschlag.rechnungsart not in ('abschlag', 'anzahlung') then
    raise exception 'Rechnung % ist eine %, kein Abschlag und keine Anzahlung.',
      coalesce(v_abschlag.nummer, '(Entwurf)'), v_abschlag.rechnungsart
      using errcode = 'check_violation';
  end if;

  if v_abschlag.status <> 'festgeschrieben' then
    raise exception 'Ein Abschlag im Zustand „%" hat keine Nummer und kann nicht abgezogen werden.',
      v_abschlag.status using errcode = 'check_violation';
  end if;

  if v_abschlag.kunde_id <> v_schluss.kunde_id then
    raise exception 'Abschlag % gehört einem anderen Kunden.',
      v_abschlag.nummer using errcode = 'check_violation';
  end if;

  if v_abschlag.auftrag_id is distinct from v_schluss.auftrag_id then
    raise exception 'Abschlag % gehört zu einem anderen Auftrag.',
      v_abschlag.nummer using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.rechnung_beziehung b
              where b.zu_rechnung_id = new.abschlag_rechnung_id and b.art = 'storno') then
    raise exception 'Abschlag % ist storniert und kann nicht abgezogen werden.',
      v_abschlag.nummer using errcode = 'check_violation';
  end if;

  return new;
end
$$;

alter function fin.abschlag_pruefen() owner to cse_definer;
revoke all on function fin.abschlag_pruefen() from public;

comment on function fin.abschlag_pruefen() is
  'FIN-08 (0117, 0441): ein Abzug entsteht nur von einer Schlussrechnung, fuer einen '
  'festgeschriebenen, nicht stornierten Abschlag desselben Kunden und Auftrags. Eine '
  'reine Ruecknahme (wirksam true -> false, sonst unveraendert) prueft das nicht.';
