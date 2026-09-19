-- 0277 — `app.belagsart_historie_lesen()`: der Katalog MIT seiner Geschichte
--        (OPS-03, K-05, O-17, 04-SEITENKARTE §5.13).
--
-- ===========================================================================
-- Der Befund, der diese Migration gebracht hat
-- ===========================================================================
--
-- `/portal/[mandant]/stammdaten/belagsarten` pflegt die Leistungswerte. Die
-- Seite muss dafuer zeigen, welcher Wert WANN galt — eine Aenderung ist hier
-- kein Update, sondern das Schliessen der alten Zeile (`gueltig_bis`) und eine
-- neue ab dem gewaehlten Tag. Ohne die Vorgeschichte auf dem Bildschirm ist
-- nicht erkennbar, welche Kalkulationen der neue Wert NICHT mehr beruehrt.
--
-- Lesen kann sie sie nicht:
--
--  1. `leistungswert_qm_pro_stunde` ist `cse_app` spaltenweise ENTZOGEN
--     (K-05, 0021: `revoke select on belagsart`, danach ein Grant ohne diese
--     Spalte). Sie steht in keinem `select`, in keinem `where` und in keinem
--     `order by` — der Versuch endet mit `42501`.
--  2. `app.leistungswerte_lesen(date)` (0021) gibt genau die zu EINEM
--     Stichtag gueltige Scheibe zurueck. Fuer das Raumbuch ist das richtig;
--     fuer die Pflegeseite ist es die eine Zeile, die sie nicht braucht.
--
-- ===========================================================================
-- Das Recht: `stammdaten.verwalten`, nicht `objekt.lesen`
-- ===========================================================================
--
-- `app.leistungswerte_lesen` prueft `objekt.lesen` — richtig fuer das
-- Raumbuch, das den Wert zum RECHNEN liest. Diese Funktion ist der Leser der
-- PFLEGESEITE, und die oeffnet nach dem Routenregister mit
-- `stammdaten.verwalten`. Die beiden Rechtemengen sind nicht dieselben:
-- `objekt.lesen` haengt auch an `kunde` (Katalog), `stammdaten.verwalten` nur
-- an `super_admin`, `admin`, `leitung`.
--
-- Haette diese Funktion `objekt.lesen` geprueft, saehe ein Kundenzugang mit
-- dem Recht die vollstaendige Preisgeschichte unserer Kalkulationsgrundlage —
-- die restriktive Decke `p_intern_decke` auf der Tabelle steht genau dagegen.
-- Deshalb prueft sie das Pflegerecht UND das interne Portal.
--
-- **Die Tabellen-RLS bleibt, wie sie ist.** `t_mandant` auf `belagsart` liest
-- weiter mit `objekt.lesen`; wer also SCHREIBEN will (das laeuft ueber die
-- normale Policy und nicht durch einen Definer), braucht beide Rechte. Das
-- steht auf der Seite als Satz, damit eine Rolle mit nur einem der beiden
-- nicht vor einem Formular sitzt, das die Datenbank abweist.
-- ===========================================================================

/**
 * Der ganze Katalog eines Mandanten, jede Fassung, absteigend nach Beginn.
 *
 * Kein Stichtag: die Seite bildet die Gegenwart selbst ab, indem sie
 * `gueltig_bis is null` hervorhebt. Ein Vorgabestichtag hier haette sie
 * gezwungen, fuer die Historie ein zweites Mal zu fragen.
 *
 * Schreibt NICHT ins Audit — wie `app.leistungswerte_lesen` und aus demselben
 * Grund: ein Leistungswert ist ein Geschaeftsgeheimnis, kein
 * personenbezogenes Datum, und eine Zeile je Seitenaufruf ertraenkte genau
 * das Protokoll, auf das sich eine LEG-08-Auskunft stuetzt. Die AENDERUNG
 * dagegen steht im Audit: `trg_belagsart_audit` (0021) schreibt sie mit
 * Vorher und Nachher.
 */
create function app.belagsart_historie_lesen()
returns table (
  belagsart_id uuid,
  code         text,
  bezeichnung  text,
  beschreibung text,
  leistungswert_qm_pro_stunde numeric, -- nicht-geld: m²/h
  quelle       text,
  ist_platzhalter boolean,
  gueltig_ab   date,
  gueltig_bis  date,
  geaendert_am timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Der Belagsartenkatalog ist nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('stammdaten.verwalten', app.aktiver_mandant()) then
    raise exception 'stammdaten.verwalten fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select b.id, b.code, b.bezeichnung, b.beschreibung,
           b.leistungswert_qm_pro_stunde, b.quelle, b.ist_platzhalter,
           b.gueltig_ab, b.gueltig_bis, b.geaendert_am
      from public.belagsart b
     where b.mandant_id = app.aktiver_mandant()
     order by b.code, b.gueltig_ab desc;
end $$;

alter function app.belagsart_historie_lesen() owner to cse_definer;
revoke execute on function app.belagsart_historie_lesen() from public;
grant execute on function app.belagsart_historie_lesen() to cse_app;

comment on function app.belagsart_historie_lesen() is
  'OPS-03: der Belagsartenkatalog MIT Historie fuer die Pflegeseite. Prueft '
  'stammdaten.verwalten (nicht objekt.lesen wie app.leistungswerte_lesen) und '
  'das interne Portal. Protokolliert den Abruf nicht — der Wert ist ein '
  'Geschaeftsgeheimnis, kein personenbezogenes Datum (0277).';

/**
 * Was der Funktion sonst fehlte: Eigentum UND Zeilenschutz.
 *
 * K-01 verlangt `cse_definer` als Eigentuemer (oben). Damit gilt fuer die
 * Funktion die `cse_definer`-Sicht auf `belagsart` — und die gab es nicht:
 * kein Tabellenrecht und keine Policy. Unter `force row level security` heisst
 * „keine Policy" auch fuer den Eigentuemer der Funktion NULL ZEILEN UND KEIN
 * FEHLER: die Seite haette einen leeren Katalog gezeigt und behauptet, es gebe
 * keinen.
 */
grant select on belagsart to cse_definer;
create policy b_definer on belagsart for select to cse_definer using (true);
