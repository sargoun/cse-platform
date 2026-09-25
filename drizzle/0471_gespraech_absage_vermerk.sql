-- ===========================================================================
-- 0471 — Ein Gespraech laesst sich absagen, verschieben und als gefuehrt
--        vermerken (REC-06, CAL-01, V-220, D-714)
-- ===========================================================================
-- **Der Befund.** gespraech.status kennt seit 0166 geplant, stattgefunden und
-- abgesagt. Geschrieben wurde nur der erste: ein Gespraech liess sich
-- anlegen und blieb danach fuer immer geplant. Der Kalender und der
-- iCal-Ausgang werten abgesagt aus (Durchstreichung, STATUS:CANCELLED) —
-- einen Zustand, den kein Weg setzte. Ein abgesagter Termin stand damit als
-- lebender Termin im Kalender jedes Menschen, der ihn abonniert hatte.
--
-- **Was diese Migration bringt.**
--   1. Wer abgesagt hat, wann und warum — und wer das Gespraech als gefuehrt
--      vermerkt hat, wann. Die Zeitpunkte setzt der Dienst mit now() der
--      DATENBANK (Invariante 5), nie eine Uhr aus dem Browser.
--   2. Die Pflicht zum Grund einer Absage steht als CHECK an der Zeile, wie
--      bei kalender_eintrag (ke_absage_begruendet, 0160).
--   3. Der Weg ist einseitig: aus abgesagt und stattgefunden fuehrt keiner
--      zurueck, und ein entschiedenes Gespraech aendert weder Termin noch
--      Dauer. Die Notiz bleibt offen — sie haelt fest, was im Gespraech war.
--      Geloescht wird nichts (Invariante 8); den Loeschlauf der Bewerbung
--      (REC-07) beruehrt das nicht, er loescht die Zeile als cse_job.
--
-- Kein SECURITY DEFINER: der Ausloeser prueft nur OLD und NEW derselben Zeile.
-- Kommentare nur mit --, keine Backticks.
-- ===========================================================================

alter table gespraech
  add column abgesagt_am      timestamptz,
  add column abgesagt_grund   text,
  add column abgesagt_von     uuid references benutzer(id),
  add column stattgefunden_vermerkt_am  timestamptz,
  add column stattgefunden_vermerkt_von uuid references benutzer(id);

comment on column gespraech.abgesagt_am is
  'REC-06, V-220. Wann abgesagt wurde — now() der Datenbank, nie die Uhr des Geraets.';
comment on column gespraech.stattgefunden_vermerkt_am is
  'REC-06, V-220. Wann ein Mensch vermerkt hat, dass das Gespraech gefuehrt wurde.';

alter table gespraech
  add constraint gespraech_absage_vollstaendig check (
    (status = 'abgesagt') = (abgesagt_am is not null)
    and (abgesagt_am is null
         or (abgesagt_grund is not null and btrim(abgesagt_grund) <> ''))),
  add constraint gespraech_vermerk_vollstaendig check (
    (status = 'stattgefunden') = (stattgefunden_vermerkt_am is not null));

create function kern.gespraech_weg() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status <> 'geplant'
     and (new.status is distinct from old.status
          or new.termin is distinct from old.termin
          or new.dauer_minuten is distinct from old.dauer_minuten) then
    raise exception
      'Gespraech %: es ist % und aendert weder Zustand noch Termin (REC-06)',
      old.id, old.status
      using errcode = 'check_violation',
            hint = 'Ein neuer Termin ist ein neues Gespraech.';
  end if;
  return new;
end $$;

comment on function kern.gespraech_weg() is
  'REC-06, V-220, D-714. Aus abgesagt und stattgefunden fuehrt kein Weg zurueck; ein '
  'entschiedenes Gespraech aendert weder Termin noch Dauer.';

create trigger gespraech_weg
  before update on gespraech
  for each row execute function kern.gespraech_weg();
