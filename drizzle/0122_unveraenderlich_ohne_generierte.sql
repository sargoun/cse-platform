/**
 * 0122 — Der Aenderungsschutz der Rechnung sperrte AUCH, was er freigeben
 * sollte (Invariante 4, LEG-01, PR 54.1).
 *
 * **Der Befund.** `fin.rechnung_unveraenderlich` (0076) vergleicht
 * `to_jsonb(old)` mit `to_jsonb(new)` und nimmt vier Spalten aus:
 * `geaendert_am`, `geaendert_von`, `geaendert_von_art` — und
 * `aufbewahrung_bis`. Die vierte steht dort mit Absicht: der
 * Aufbewahrungslauf muss die Frist auf einem festgeschriebenen Beleg setzen
 * koennen, sonst hat die wichtigste Belegklasse des Hauses kein GoBD-Datum.
 *
 * Diese Ausnahme war TOT. `rechnung.ueberweisungsbetrag_cent` ist eine
 * ERZEUGTE Spalte (`generated always as … stored`, 0075), und PostgreSQL
 * berechnet erzeugte Spalten ERST NACH den BEFORE-Ausloesern: in `new` steht
 * dort NULL, in `old` der Wert. Die beiden Abbilder waren damit auf JEDER
 * Aenderung verschieden — auch auf einer, die gar nichts aendert.
 *
 * Die Folge, nachgestellt und bestaetigt:
 *
 *     update rechnung set aufbewahrung_bis = date '2036-12-31' where id = …;
 *     ERROR: Rechnung RE-00001: festgeschriebene und verworfene Belege sind
 *            unveraenderlich — ueberweisungsbetrag_cent wurde geaendert
 *
 * Zwei Schaeden, und der zweite ist der groessere:
 *
 *   1. Der Aufbewahrungslauf kommt an keine festgeschriebene Rechnung heran.
 *      Die Frist bleibt NULL, und der Loeschbericht sieht eine Belegklasse
 *      ohne Ende.
 *   2. Die Meldung nennt die falsche Spalte. Wer sie liest, sucht einen
 *      Schreibzugriff auf `ueberweisungsbetrag_cent`, den es nicht gibt.
 *      Ein Riegel, der mit einer erfundenen Begruendung schliesst, kostet
 *      beim naechsten Mal einen halben Tag.
 *
 * **Warum der Vergleich aus dem KATALOG kommt und nicht aus einer Liste.**
 * `0084` (`kern.bautagebuch_kind_nur_storno`) kennt dieselbe Falle und loest
 * sie, indem es `- 'mannstunden'` schreibt. Das ist dort richtig und hier zu
 * wenig: 0076 begruendet den `to_jsonb`-Vergleich ausdruecklich damit, dass
 * eine SPAETER hinzukommende Spalte automatisch geschuetzt sein soll. Eine
 * ausgeschriebene Ausnahmeliste waere am Tag der naechsten erzeugten Spalte
 * wieder falsch — und zwar wieder still.
 *
 * Deshalb liest die Funktion `pg_attribute.attgenerated` und nimmt jede
 * erzeugte Spalte heraus. **Das verliert nichts:** eine erzeugte Spalte ist
 * eine Funktion ihrer Quellspalten, und die stehen im Vergleich. Wer den Wert
 * bewegen will, muss eine Quelle bewegen, und die faellt auf.
 *
 * Der Rumpf ist im Uebrigen woertlich der aus 0076.
 */
create or replace function fin.rechnung_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus  text[];
  v_alt  jsonb;
  v_neu  jsonb;
  v_feld text;
begin
  if old.status = 'entwurf' then
    return new;
  end if;

  /**
   * Die vier beweglichen Spalten und jede ERZEUGTE. `attgenerated <> ''`
   * trifft genau die `GENERATED ALWAYS AS`-Spalten; `attnum > 0` laesst die
   * Systemspalten aus, `not attisdropped` die geloeschten, deren Eintraege in
   * `pg_attribute` stehen bleiben.
   */
  select array['geaendert_am', 'geaendert_von', 'geaendert_von_art', 'aufbewahrung_bis']
         || coalesce(array_agg(a.attname::text), '{}')
    into v_aus
    from pg_attribute a
   where a.attrelid = 'public.rechnung'::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

  v_alt := to_jsonb(old) - v_aus;
  v_neu := to_jsonb(new) - v_aus;

  if v_alt = v_neu then
    return new;
  end if;

  -- Das ERSTE abweichende Feld benennen. „Die Rechnung ist unveraenderlich"
  -- allein laesst den Aufrufer raten, welcher seiner Werte der verbotene war.
  select k into v_feld
    from jsonb_object_keys(v_neu) k
   where v_alt -> k is distinct from v_neu -> k
   order by k
   limit 1;

  raise exception
    'Rechnung %: festgeschriebene und verworfene Belege sind unveraenderlich — % wurde geaendert (Invariante 4, LEG-01)',
    coalesce(old.nummer, old.id::text), coalesce(v_feld, '<Spalte entfernt>')
    using errcode = 'restrict_violation',
          hint = 'Korrigiert wird durch STORNO und Neuausstellung (rechnung_beziehung), '
                 'nie durch Aenderung. Der Versand steht in rechnung_versand.';
end $$;
