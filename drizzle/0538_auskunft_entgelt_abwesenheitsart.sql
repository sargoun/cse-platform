-- 0538 — Die Art.-15-Auskunft liest den internen Stundensatz und die Art der
--        Abwesenheiten (V-332, O-642, O-643, D-791, D-855, LEG-09, Art. 15 DSGVO)
--
-- Der Befund: zwei Angaben ueber den Menschen fehlten still in der Auskunft.
--   * anstellung.stundensatz_intern und die datierten Saetze in
--     anstellung_kondition sind cse_app entzogen (K-05); der Abschnitt
--     „Anstellungen" liess sie aus. Voreinstellung (O-642, D-791): der Satz
--     gehoert hinein — ein Satz an einer Beschaeftigung ist ein Datum ueber
--     den Menschen —, gelesen ueber einen beschraenkten Leser mit
--     personal.entgelt_lesen.
--   * abwesenheit.abwesenheitsart_id, AU-Tatsache und Bemerkung sind
--     Art.-9-Daten und cse_app entzogen (0073); der Abschnitt „Abwesenheiten"
--     nannte Daten und Status. Voreinstellung (O-643, D-791): die Art gehoert
--     in die Auskunft (Art. 15 kennt keine Ausnahme fuer Art.-9-Daten), aber
--     als eigener Abschnitt hinter eigenem Recht, nur auf ausdrueckliche
--     Mitgabe — nie im Standardexport.
--
-- Zwei Definer, je ein Abschnitt, beide nur
--   * in einer Gesellschaft (die aktive), angemeldet;
--   * mit datenschutz.auskunft_erstellen UND dem Fachrecht des Abschnitts
--     (personal.entgelt_lesen bzw. zeit.abwesenheit_grund_lesen);
--   * fuer EINE Person, ueber ihre Beschaeftigungen in dieser Gesellschaft;
--   * mit EINER Protokollzeile je Abruf (dieselben Aktionen wie die
--     Einzelleser: entgelt.gelesen, personal.abwesenheitsgrund_gelesen) —
--     Zweck Art. 15, die Zahl der Zeilen; kein Wert im Protokoll.
-- Ohne das Fachrecht werfen sie 42501; die Auskunft fragt das Recht vorher
-- und fuehrt den Abschnitt als gesperrt, nicht als leer.
--
-- Beide sind volatile, nicht stable: sie schreiben die Protokollzeile (ueber
-- app.protokolliere), und den Aufruf einer stable Funktion darf der Planer
-- zusammenfassen oder auslassen, wenn ihr Ergebnis nicht gebraucht wird — ein
-- Zugriffsprotokoll, dessen Eintrag vom Abfrageplan abhaengt, ist keines
-- (dieselbe Regel wie app.ausgabe_erstattung_lesen, 0184).
--
-- Nur Kommentare mit Doppelstrich.

create function app.auskunft_entgelt(p_person uuid)
returns table (
  personalnummer text, gilt_ab date, gilt_bis date, stundensatz_cent bigint, quelle text
)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_zeilen  integer;
begin
  if v_mandant is null or app.aktueller_benutzer() is null then
    raise exception 'Auskunft: nur in einer Gesellschaft und angemeldet'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('datenschutz.auskunft_erstellen', v_mandant)
     or not app.hat_recht('personal.entgelt_lesen', v_mandant) then
    raise exception 'nicht berechtigt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select a.personalnummer::text, k.gilt_ab, k.gilt_bis, k.stundensatz_intern_cent,
           'kondition'::text
      from public.anstellung a
      join public.anstellung_kondition k
        on k.anstellung_id = a.id and k.mandant_id = a.mandant_id
     where a.person_id = p_person and a.mandant_id = v_mandant and a.geloescht_am is null
    union all
    -- Der Bestand vor 0192: eine Beschaeftigung ohne jede Kondition traegt
    -- ihren Satz nur am Spiegel (dieselbe Regel wie app.entgelt_lesen).
    select a.personalnummer::text, a.eintritt, a.austritt, a.stundensatz_intern,
           'spiegel'::text
      from public.anstellung a
     where a.person_id = p_person and a.mandant_id = v_mandant and a.geloescht_am is null
       and a.stundensatz_intern is not null
       and not exists (select 1 from public.anstellung_kondition k where k.anstellung_id = a.id)
     order by 1, 2;
  get diagnostics v_zeilen = row_count;

  perform app.protokolliere(
    'entgelt.gelesen', 'person', p_person::text, null,
    jsonb_build_object('zweck', 'Art. 15 DSGVO', 'zeilen', v_zeilen), v_mandant);
end $$;

comment on function app.auskunft_entgelt(uuid) is
  'V-332, O-642, D-855: die internen Stundensaetze einer Person (datiert, sonst der Spiegel '
  'vor 0192) fuer die Art.-15-Auskunft — mit datenschutz.auskunft_erstellen und '
  'personal.entgelt_lesen, eine Protokollzeile je Abruf.';

alter function app.auskunft_entgelt(uuid) owner to cse_definer;
revoke all on function app.auskunft_entgelt(uuid) from public;
grant execute on function app.auskunft_entgelt(uuid) to cse_app;

create function app.auskunft_abwesenheitsgruende(p_person uuid)
returns table (
  von date, bis date, status text, art text, gesundheitsbezogen boolean,
  au_bescheinigung_vorliegt boolean, au_bis date, bemerkung text,
  urlaub_gutgeschrieben_tage numeric
)
language plpgsql volatile security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_zeilen  integer;
begin
  if v_mandant is null or app.aktueller_benutzer() is null then
    raise exception 'Auskunft: nur in einer Gesellschaft und angemeldet'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('datenschutz.auskunft_erstellen', v_mandant)
     or not app.hat_recht('zeit.abwesenheit_grund_lesen', v_mandant) then
    raise exception 'nicht berechtigt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select ab.von, ab.bis, ab.status::text, art.bezeichnung, art.ist_gesundheitsbezogen,
           ab.au_bescheinigung_vorliegt, ab.au_bis, ab.bemerkung, ab.urlaub_gutgeschrieben_tage
      from public.abwesenheit ab
      join public.anstellung an on an.id = ab.anstellung_id and an.mandant_id = ab.mandant_id
      join public.abwesenheitsart art on art.id = ab.abwesenheitsart_id
     where an.person_id = p_person and ab.mandant_id = v_mandant
     order by ab.von desc, ab.bis desc;
  get diagnostics v_zeilen = row_count;

  perform app.protokolliere(
    'personal.abwesenheitsgrund_gelesen', 'person', p_person::text, null,
    jsonb_build_object('rechtsgrundlage', 'Art. 15 DSGVO', 'zeilen', v_zeilen), v_mandant);
end $$;

comment on function app.auskunft_abwesenheitsgruende(uuid) is
  'V-332, O-643, D-855: Art, AU-Tatsache, Bemerkung und Gutschrift der Abwesenheiten einer '
  'Person (Art. 9 DSGVO) fuer die Art.-15-Auskunft, nur auf ausdrueckliche Mitgabe — mit '
  'datenschutz.auskunft_erstellen und zeit.abwesenheit_grund_lesen, eine Protokollzeile je Abruf.';

alter function app.auskunft_abwesenheitsgruende(uuid) owner to cse_definer;
revoke all on function app.auskunft_abwesenheitsgruende(uuid) from public;
grant execute on function app.auskunft_abwesenheitsgruende(uuid) to cse_app;

-- Die Lesepfade des Definers stehen schon: anstellung (a_definer 0031, Tabellenrecht
-- 0069), abwesenheit (ab_definer, 0073), abwesenheitsart (aa_definer, 0073) und
-- anstellung_kondition (d_kondition, 0192).
