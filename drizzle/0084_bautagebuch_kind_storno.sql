-- ===========================================================================
-- 0084 — Der Storno einer Bautagebuchzeile war unmoeglich (BAU-07, LEG-01)
--
-- `kern.bautagebuch_kind_nur_storno()` aus 0082 vergleicht das alte Abbild
-- der Zeile — mit den vier Stornospalten auf die neuen Werte gesetzt — gegen
-- das neue Abbild und wirft bei jedem Unterschied. Der Gedanke ist richtig
-- und stammt aus `kern.wachbuch_nur_storno()` (0070): beweglich sind
-- ausschliesslich `storniert_am`, `storniert_von`, `storno_grund` und
-- `ersetzt_durch_id`.
--
-- **Auf `bautagebuch_mannstunden` schlug er trotzdem immer an.** Die Tabelle
-- traegt eine ERZEUGTE Spalte:
--
--     mannstunden numeric(10,2)
--       generated always as (anzahl_personen::numeric * dauer_minuten / 60.0) stored
--
-- PostgreSQL berechnet erzeugte Spalten NACH den BEFORE-Ausloesern. In einem
-- BEFORE-UPDATE-Ausloeser traegt `OLD.mannstunden` deshalb den gespeicherten
-- Wert und `NEW.mannstunden` ist NULL. Der Vergleich `to_jsonb(v_ms) is
-- distinct from to_jsonb(new)` fand damit bei JEDEM Storno einen Unterschied
-- — naemlich `32.00` gegen `null` — und meldete „Eine Bautagebuchzeile wird
-- nicht geaendert".
--
-- Die Folge ist genau die Art von Ausfall, die die Invarianten benennen:
-- still, spaet, teuer. Die Datenbank lief sauber aus dem Leeren durch, die
-- Bedingungen standen, die Policies standen — und die Korrekturspur, die
-- BAU-07 Abnahme 1 verlangt, liess sich kein einziges Mal beschreiten. Eine
-- falsch eingetragene Mannstundenzahl waere unkorrigierbar gewesen, und der
-- einzige Ausweg der Storno des ganzen Tages.
--
-- **Die Korrektur vergleicht ueber ABBILDER OHNE die beweglichen Spalten.**
-- Beide Seiten werden um dieselben Schluessel erleichtert; was danach
-- verschieden ist, ist eine unerlaubte Aenderung. `mannstunden` faellt mit
-- heraus, und das oeffnet KEINE Luecke: die Spalte ist aus `anzahl_personen`
-- und `dauer_minuten` erzeugt, beide werden weiterhin verglichen, und eine
-- erzeugte Spalte kann von ihren Eingaben nicht abweichen. Eine Zeile, die
-- ihre Mannstunden heimlich aendert, muesste eine der beiden Eingaben
-- aendern — und genau daran scheitert sie.
--
-- `bautagebuch_position` traegt keine erzeugte Spalte; fuer sie ist der
-- Abzug von `mannstunden` folgenlos (`jsonb - 'x'` auf einem fehlenden
-- Schluessel ist eine Nulloperation). Derselbe Ausloeser bleibt damit fuer
-- beide Tabellen zustaendig, statt dass zwei Fassungen auseinanderlaufen.
--
-- Der Rest der Funktion bleibt woertlich: ein Storno wird nicht
-- zurueckgenommen, und die Serveruhr stempelt (§1.11, Invariante 5).
-- ===========================================================================

create or replace function kern.bautagebuch_kind_nur_storno() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_alt jsonb;
  v_neu jsonb;
begin
  /**
   * Die vier beweglichen Spalten UND die erzeugte fallen aus beiden
   * Abbildern. Der Weg ueber `jsonb` statt ueber eine zeilentypisierte
   * Zwischenvariable ist der Punkt: in einer solchen Variablen stuende die
   * erzeugte Spalte mit dem alten Wert, waehrend sie in `new` noch NULL ist.
   */
  v_alt := to_jsonb(old) - 'storniert_am' - 'storniert_von' - 'storno_grund'
           - 'ersetzt_durch_id' - 'mannstunden';
  v_neu := to_jsonb(new) - 'storniert_am' - 'storniert_von' - 'storno_grund'
           - 'ersetzt_durch_id' - 'mannstunden';

  if v_alt is distinct from v_neu then
    raise exception 'Eine Bautagebuchzeile wird nicht geaendert (BAU-07, LEG-01)'
      using errcode = 'P0001',
            detail  = 'Nur storniert_am, storniert_von, storno_grund und '
                      || 'ersetzt_durch_id duerfen sich bewegen.',
            hint    = 'Korrigiert wird durch eine NEUE Zeile, die die alte in '
                      || 'ersetzt_durch_id nennt.';
  end if;

  if old.storniert_am is not null
     and (new.storniert_am is distinct from old.storniert_am
          or new.storno_grund is distinct from old.storno_grund) then
    raise exception 'Ein Storno wird nicht zurueckgenommen (Invariante 8)'
      using errcode = 'P0001';
  end if;

  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;

  return new;
end $$;

comment on function kern.bautagebuch_kind_nur_storno is
  'Die Kindzeilen des Bautagebuchs sind anfuegend: beweglich sind nur die vier '
  'Stornospalten (0082). Der Vergleich laeuft ueber jsonb-Abbilder OHNE die '
  'erzeugte Spalte mannstunden — sie ist in NEW eines BEFORE-Ausloesers NULL '
  'und liess sonst jeden Storno scheitern (0084).';
