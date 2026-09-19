-- 0276 — ein Schluessel gehoert EINER Stufe: Plattformkatalog gegen
--        Mandantenkatalog (`abwesenheitsart`, `antragsart`; K-17, EMP-10,
--        EMP-12, 01-KERN §6.22/§6.28).
--
-- ===========================================================================
-- Der Befund, der diese Migration gebracht hat
-- ===========================================================================
--
-- Beide Kataloge sind zweistufig und tragen
-- `unique nulls not distinct (mandant_id, schluessel)`. Diese Schranke sagt:
-- „ein Schluessel je Stufe" — sie erlaubt `urlaub` also EINMAL plattformweit
-- UND einmal je Gesellschaft.
--
-- Der Leser des Mitarbeiterportals filtert aber nicht nach Stufe:
-- `src/server/services/mitarbeiter/antraege.ts` liest
-- `... where archiviert_am is null order by bezeichnung` und bekommt beide
-- Zeilen. Im Antragsformular stehen daraufhin ZWEI Eintraege „Urlaub", und
-- welcher der beiden die Kette `antrag → abwesenheit` mit welchem
-- `zaehlt_auf_urlaubskonto` und welchem `bezahlt` ausloest, entscheidet die
-- Reihenfolge der Bezeichnungen. Der Mensch waehlt einen von zwei gleich
-- aussehenden Eintraegen; die Lohnfolge unterscheidet sich.
--
-- Das ist kein Bedienfehler, sondern eine Luecke in der Schranke — und sie
-- wird erst sichtbar, sobald die Pflegeseiten (0275) das Anlegen
-- mandanteigener Arten ueberhaupt moeglich machen. Deshalb steht sie hier und
-- nicht spaeter.
--
-- ===========================================================================
-- Warum ein Ausloeser und kein Index
-- ===========================================================================
--
-- Ein partieller Unique-Index kann es nicht ausdruecken: verboten ist nicht
-- „zweimal derselbe Schluessel" (das waere richtig fuer zwei Gesellschaften,
-- die beide eine eigene Art `hitzefrei` fuehren duerfen), sondern „derselbe
-- Schluessel auf BEIDEN Stufen gleichzeitig". Das ist eine Bedingung ueber
-- zwei Zeilen mit VERSCHIEDENEM Schluesselwert in `mandant_id` — dafuer gibt
-- es in Postgres keinen Index, nur eine Pruefung je Zeile.
--
-- `security definer`, Eigentum `cse_definer` (K-01): die Pruefung muss auch
-- die Zeile einer FREMDEN Gesellschaft sehen. Unter der Sitzungs-RLS
-- (`t_katalog`) ist sie unsichtbar, und die Pruefung haette dann genau in dem
-- Fall geschwiegen, in dem ein Super-Admin eine Plattformart anlegt, deren
-- Schluessel eine Gesellschaft schon fuehrt. Lesen darf die Funktion
-- ausschliesslich diese beiden Katalogtabellen, und sie gibt nichts zurueck
-- als „ja" oder eine Meldung.
--
-- Archivierte Zeilen zaehlen NICHT: der Leser des Mitarbeiterportals filtert
-- `archiviert_am is null`, und eine archivierte Art steht in keinem Formular.
-- Wer eine Plattformart archiviert, gibt den Schluessel damit frei.
-- ===========================================================================

/**
 * Die eine Pruefung fuer beide Kataloge.
 *
 * `TG_TABLE_NAME` statt zwei Kopien: die beiden Tabellen tragen dieselben
 * drei Spalten (`mandant_id`, `schluessel`, `archiviert_am`), und zwei
 * wortgleiche Funktionen waeren zwei Stellen, an denen beim naechsten Umbau
 * eine vergessen wird. `format(%I)` mit `TG_TABLE_NAME` ist nicht
 * benutzergesteuert — der Wert kommt von Postgres, nicht aus einer Eingabe.
 */
create function kern.katalog_schluessel_frei() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_andere int;
  v_stufe  text;
begin
  -- Eine archivierte Zeile steht in keinem Formular und belegt nichts.
  if new.archiviert_am is not null then return new; end if;

  if new.mandant_id is null then
    execute format(
      'select count(*) from public.%I
        where schluessel = $1 and mandant_id is not null
          and archiviert_am is null and id <> $2', TG_TABLE_NAME)
      into v_andere using new.schluessel, new.id;
    v_stufe := 'mindestens eine Gesellschaft fuehrt eine eigene Art mit diesem Schluessel';
  else
    execute format(
      'select count(*) from public.%I
        where schluessel = $1 and mandant_id is null
          and archiviert_am is null and id <> $2', TG_TABLE_NAME)
      into v_andere using new.schluessel, new.id;
    v_stufe := 'der Plattformkatalog fuehrt diesen Schluessel schon';
  end if;

  if v_andere > 0 then
    raise exception
      'Der Schluessel % ist auf der anderen Katalogstufe belegt (%): im '
      'Antragsformular stuenden zwei gleich aussehende Eintraege, mit '
      'verschiedener Lohnfolge.', new.schluessel, v_stufe
      using errcode = 'unique_violation';
  end if;
  return new;
end $$;

alter function kern.katalog_schluessel_frei() owner to cse_definer;

comment on function kern.katalog_schluessel_frei() is
  'K-17: derselbe schluessel darf nicht gleichzeitig plattformweit und '
  'mandanteigen aktiv sein. unique nulls not distinct (mandant_id, '
  'schluessel) erlaubt das, der Auswahlleser des Mitarbeiterportals filtert '
  'aber nicht nach Stufe (0276).';

create trigger trg_abwesenheitsart_schluessel_frei
  before insert or update of mandant_id, schluessel, archiviert_am on abwesenheitsart
  for each row execute function kern.katalog_schluessel_frei();

create trigger trg_antragsart_schluessel_frei
  before insert or update of mandant_id, schluessel, archiviert_am on antragsart
  for each row execute function kern.katalog_schluessel_frei();

/**
 * Die fehlende `cse_definer`-Lesepolicy auf `antragsart`.
 *
 * `abwesenheitsart` hat sie seit 0073 (`aa_definer`), `antragsart` nicht —
 * dort war bisher kein Definer im Spiel. Unter `force row level security`
 * gilt „keine Policy" auch fuer den Eigentuemer der Funktion: ohne diese
 * Zeile liest die Pruefung oben NULL ZEILEN UND KEINEN FEHLER, laesst die
 * Kollision durch und behauptet dabei, geprueft zu haben.
 */
create policy at_definer on antragsart for select to cse_definer using (true);
