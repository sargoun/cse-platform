-- ===========================================================================
-- 0448 — Die WJ-Pruefung des DATEV-Stapels greift beim Erzeugen, nicht beim
--        Vermerk (V-217, ACC-02, D-708; berichtigt 0445)
-- ===========================================================================
-- **Der Befund.** 0445 legte datev_export_ein_wirtschaftsjahr als
-- Pruefbedingung mit not valid an. not valid heisst nur, dass der Bestand
-- beim Anlegen nicht geprueft wird. Bei JEDEM spaeteren UPDATE einer Zeile
-- prueft PostgreSQL die Bedingung trotzdem, auch bei einer alten Zeile und
-- auch dann, wenn die geaenderten Spalten mit ihr nichts zu tun haben.
--
-- Ein Stapel ueber die WJ-Grenze, der vor 0445 erzeugt wurde und noch auf
-- erzeugt steht, liess sich deshalb weder verwerfen noch als uebergeben
-- vermerken: beide Wege (services/buchhaltung/datev/stapel.ts) schreiben
-- status, verworfen_am bzw. uebergeben_am, und die Datenbank antwortete mit
-- 23514 (check_violation). Die Seite zeigte einen Fehler 500, und der Stapel
-- blieb fuer immer erzeugt. Gerade diesen Stapel will man verwerfen
-- (Zeitraum falsch gewaehlt). D-704 Punkt 5 versprach das Gegenteil.
--
-- **Was diese Migration tut.** Die Pruefbedingung geht. An ihre Stelle tritt
-- ein Ausloeser BEFORE INSERT mit derselben Rechnung. Ein Ausloeser fuer
-- UPDATE ist nicht noetig: von, bis, wj_beginn_monat und wj_beginn_tag
-- aendern sich nach dem Erzeugen nie mehr. Dafuer sorgt der Ausloeser
-- datev_export_unveraenderlich (0133), der nur Zustand, Vermerk, Ablage und
-- Aufbewahrung beweglich laesst. Damit gilt die Pruefung fuer jeden NEUEN
-- Stapel, und ein alter Stapel bleibt, wie er ist: er laesst sich verwerfen
-- oder als uebergeben vermerken.
--
-- Die Rechnung ist dieselbe wie in 0445 und wie wirtschaftsjahrVon in
-- src/server/services/buchhaltung/wirtschaftsjahr.ts: das Beginnjahr eines
-- Tages d ist sein Kalenderjahr, minus eins, wenn Monat und Tag von d vor
-- Monat und Tag des WJ-Beginns liegen. Gerechnet ueber extract und nicht
-- ueber make_date, damit ein WJ-Beginn am 30. im Februar nicht in einen
-- Datumsfehler laeuft. Die Meldung nennt den Namen der alten Bedingung und
-- traegt ihn als constraint, damit ein Aufrufer ihn weiter erkennt.
--
-- Die Funktion liest keine Tabelle und braucht keine Rechte ueber die des
-- Aufrufers: kein security definer. Nur Kommentare mit Doppelstrich und keine
-- Backticks: dieselbe Regel wie in 0392 bis 0422.
-- ===========================================================================

alter table datev_export drop constraint datev_export_ein_wirtschaftsjahr;

create function fin.datev_export_ein_wirtschaftsjahr() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_beginn integer := new.wj_beginn_monat * 100 + new.wj_beginn_tag;
  v_von    integer;
  v_bis    integer;
begin
  v_von := extract(year from new.von)::integer
         - case when extract(month from new.von)::integer * 100
                     + extract(day from new.von)::integer < v_beginn
                then 1 else 0 end;
  v_bis := extract(year from new.bis)::integer
         - case when extract(month from new.bis)::integer * 100
                     + extract(day from new.bis)::integer < v_beginn
                then 1 else 0 end;
  if v_von is distinct from v_bis then
    raise exception
      'datev_export_ein_wirtschaftsjahr: der Zeitraum % bis % reicht ueber die Grenze des Wirtschaftsjahres (Beginn %.%.).',
      to_char(new.von, 'DD.MM.YYYY'), to_char(new.bis, 'DD.MM.YYYY'),
      lpad(new.wj_beginn_tag::text, 2, '0'), lpad(new.wj_beginn_monat::text, 2, '0')
      using errcode = 'check_violation',
            constraint = 'datev_export_ein_wirtschaftsjahr',
            hint = 'Den Zeitraum in zwei Stapel teilen, je Wirtschaftsjahr einen (D-704).';
  end if;
  return new;
end $$;

revoke all on function fin.datev_export_ein_wirtschaftsjahr() from public;

comment on function fin.datev_export_ein_wirtschaftsjahr() is
  'V-212, V-217, ACC-02, D-704, D-708. Ein neuer DATEV-Stapel liegt in einem Wirtschaftsjahr '
  '(nach seinen eingefrorenen wj_beginn_monat/wj_beginn_tag). Nur beim Einfuegen: der '
  'Zeitraum aendert sich danach nie (datev_export_unveraenderlich, 0133), und ein alter '
  'Stapel ueber die Grenze bleibt verwerfbar. Ersetzt die Pruefbedingung aus 0445.';

create trigger datev_export_ein_wirtschaftsjahr
  before insert on datev_export
  for each row execute function fin.datev_export_ein_wirtschaftsjahr();
