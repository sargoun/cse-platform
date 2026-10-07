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
-- Geprueft wird beim Anlegen und wenn sich das Ziel aendert — im Ausloeser,
-- nicht als CHECK. Ein CHECK liefe bei JEDEM update der Zeile, auch bei
-- gelesen_am: eine Altzeile mit fremdem Ziel liesse sich dann weder oeffnen
-- noch als gelesen stempeln, und eine einzige ungelesene risse
-- markiereAlleGelesen fuer den ganzen Posteingang mit. Der Bestand wird
-- geprueft, nicht umgeschrieben: eine solche Zeile bleibt stehen (die
-- Mitteilung ist ein Protokoll dessen, was jemandem gesagt wurde), laesst
-- sich lesen und stempeln, und die Route fuehrt sie auf den Start des eigenen
-- Portals. Eine Meldung nennt die Zahl. Seed und Demodaten bestehen die Regel.
--
-- Nur Kommentare mit Doppelstrich.

create function kern.benachrichtigung_ziel_pruefen() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.ziel is not distinct from old.ziel then
    return new;
  end if;
  if new.ziel is null or not (new.ziel ~ '^/[^/\\]' and new.ziel !~ '[[:cntrl:]]') then
    raise exception 'benachrichtigung_ziel_intern: das Ziel ist kein Pfad dieser Plattform'
      using errcode = 'check_violation',
            constraint = 'benachrichtigung_ziel_intern',
            detail  = 'V-394, D-814: ein Schraegstrich, danach weder Schraegstrich noch '
                      || 'Rueckstrich, kein Steuerzeichen.',
            hint    = 'Dieselbe Regel wie istInternesZiel (registry.ts).';
  end if;
  return new;
end $$;

comment on function kern.benachrichtigung_ziel_pruefen() is
  'V-394, D-814: das Ziel einer Benachrichtigung ist ein Pfad dieser Plattform — geprueft '
  'beim Anlegen und bei geaendertem Ziel, nie beim Stempeln einer Altzeile.';

revoke execute on function kern.benachrichtigung_ziel_pruefen() from public;

create trigger trg_benachrichtigung_ziel_intern
  before insert or update of ziel on benachrichtigung
  for each row execute function kern.benachrichtigung_ziel_pruefen();

do $$
declare
  v_fremd bigint;
begin
  select count(*) into v_fremd
    from benachrichtigung
   where not (ziel ~ '^/[^/\\]' and ziel !~ '[[:cntrl:]]');
  if v_fremd > 0 then
    raise notice '0510: % Ziel(e) ausserhalb der Plattform bleiben stehen; die Route fuehrt sie auf den Portalstart', v_fremd;
  end if;
end $$;
