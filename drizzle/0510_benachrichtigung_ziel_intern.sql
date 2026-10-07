-- 0510 — das Ziel einer Benachrichtigung ist ein Pfad dieser Plattform
--        (V-394, NOT-03, D-814).
--
-- benachrichtigung.ziel prueft seit 0011 nur length(ziel) > 1, und
-- /api/benachrichtigungen/[id]/oeffnen leitet auf das Ziel weiter. Jeder
-- Schreibweg, der ein Ziel durchreicht — ein Definer mit p_ziel, ein Job, der
-- es aus Daten baut —, haette eine fremde Adresse speichern koennen: eine
-- offene Weiterleitung hinter einer echten Anmeldung. Der Kommentar der Route
-- behauptete einen CHECK auf den fuehrenden Schraegstrich, den es nie gab.
--
-- Die Regel ist dieselbe wie istInternesZiel in
-- src/server/benachrichtigung/registry.ts: ein Schraegstrich, danach weder
-- Schraegstrich noch Rueckstrich (fuer den Browser beides der Anfang einer
-- Adresse auf einem fremden Wirt), und kein Steuerzeichen (Tabulator und
-- Zeilenumbruch streicht der URL-Parser, bevor er liest).
--
-- Der Bestand wird geprueft, nicht umgeschrieben: eine Zeile, die gegen die
-- Regel verstiesse, bliebe stehen (die Mitteilung ist ein Protokoll dessen,
-- was jemandem gesagt wurde), und die Route fuehrt sie auf den Start des
-- eigenen Portals. Validiert wird der CHECK nur, wenn der Bestand ihn
-- besteht; sonst gilt er fuer jede neue und jede geaenderte Zeile, und eine
-- Meldung nennt die Zahl. Seed und Demodaten bestehen ihn.
--
-- Nur Kommentare mit Doppelstrich.

alter table benachrichtigung add constraint benachrichtigung_ziel_intern
  check (ziel ~ '^/[^/\\]' and ziel !~ '[[:cntrl:]]') not valid;

do $$
declare
  v_fremd bigint;
begin
  select count(*) into v_fremd
    from benachrichtigung
   where not (ziel ~ '^/[^/\\]' and ziel !~ '[[:cntrl:]]');
  if v_fremd = 0 then
    alter table benachrichtigung validate constraint benachrichtigung_ziel_intern;
  else
    raise notice '0510: % Ziel(e) ausserhalb der Plattform, CHECK gilt fuer neue Zeilen', v_fremd;
  end if;
end $$;

comment on constraint benachrichtigung_ziel_intern on benachrichtigung is
  'V-394, D-814: das Ziel ist ein Pfad dieser Plattform — ein Schraegstrich, danach weder '
  'Schraegstrich noch Rueckstrich, kein Steuerzeichen. Dieselbe Regel wie istInternesZiel '
  '(registry.ts); /api/benachrichtigungen/[id]/oeffnen prueft sie noch einmal.';
