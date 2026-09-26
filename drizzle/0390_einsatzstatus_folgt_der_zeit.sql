-- ===========================================================================
-- 0390 — Der Einsatzstatus folgt der erfassten Zeit (V-082, TIM-01, TIM-07)
-- ===========================================================================
--
-- **Der Befund.** `einsatz_status` kennt seit `0028` vier Werte:
-- `geplant`, `laufend`, `abgeschlossen`, `storniert`. Geschrieben wurden
-- ZWEI — `geplant` beim Anlegen und `storniert` beim Absagen
-- (`services/dienstplan/einzelschicht.ts`, `serie-pflege.ts`). `laufend` und
-- `abgeschlossen` setzte nichts, und trotzdem beschriften beide Oberflaechen
-- sie: das Schichtblatt der Disposition mit „In Arbeit" und „Abgeschlossen",
-- die Serienseite mit einer eigenen Zeile. Eine Schicht, die vor drei Wochen
-- gelaufen und abgerechnet ist, stand als „Geplant" da.
--
-- ---------------------------------------------------------------------------
-- Was die beiden Werte BEDEUTEN, sagt das Datenmodell — nicht diese Datei
-- ---------------------------------------------------------------------------
--
-- `04-PLANUNG-ZEIT.md` fuehrt den Index
--
--   einsatz_ohne_zeit_idx on (mandant_id, ende_zeitpunkt) where status = 'geplant'
--
-- und nennt seinen Zweck: „the hourly 'shift ended, no zeiteintrag' watchdog".
-- Eine Schicht verlaesst `geplant` also, sobald Zeit zu ihr erfasst ist —
-- das ist keine erfundene Regel, sondern die, fuer die der Index gebaut wurde.
-- Daraus folgt der Rest von selbst: laeuft ein Eintrag, laeuft die Schicht;
-- ist sie vorbei und steht kein Eintrag mehr offen, ist sie abgeschlossen.
--
-- ---------------------------------------------------------------------------
-- ABGELEITET, nicht fortgeschrieben — und warum das der Unterschied ist
-- ---------------------------------------------------------------------------
--
-- Derselbe Abschnitt des Datenmodells warnt an `einsatz_status` woertlich:
-- „'unbesetzt' is NEVER a status value: staffing is derived from
-- besetzt_anzahl vs soll_besetzung, and two sources of truth would drift
-- within one sprint."
--
-- Genau deshalb schreibt dieser Ausloeser den Zustand nicht FORT, sondern
-- rechnet ihn jedes Mal neu aus den Zeiteintraegen dieser Schicht. Ein
-- storniertes Stempelpaar, eine zurueckgenommene Nacherfassung, ein Eintrag,
-- der einer anderen Schicht zugeordnet wird: jedes davon korrigiert den
-- Zustand von selbst. Ein Zaehler, der nur vorwaerts geht, waere nach dem
-- ersten Storno falsch — und niemand saehe es.
--
-- **`storniert` ruehrt er nie an.** Eine abgesagte Schicht bleibt abgesagt,
-- auch wenn jemand Zeit darauf erfasst hat; das ist dann ein Befund fuer die
-- Disposition und keiner, den ein Ausloeser stillschweigend wegraeumt.
--
-- **Und `geplant` kommt zurueck**, wenn die letzte Zeit storniert wurde. Das
-- ist kein Rueckschritt, sondern dieselbe Ableitung: es ist wieder eine
-- Schicht, zu der nichts erfasst ist, und die stuendliche Wache soll sie
-- wieder sehen.

/**
 * Den Zustand EINER Schicht aus ihren Zeiteinträgen ableiten.
 *
 * `security definer`: der Auslöser hängt an `zeiteintrag`, und dort stempelt
 * eine Arbeiterin — die hält `dienstplan.schreiben` nicht und käme an
 * `einsatz` unter `t_mandant` nicht heran. Ohne Definer bliebe der Zustand
 * genau in dem Fall stehen, für den er gedacht ist.
 *
 * Zurückgegeben wird nichts, und gelesen wird nur diese eine Schicht: die
 * Funktion gibt keine Auskunft, die der Aufrufer nicht ohnehin hätte.
 */
create function kern.einsatz_status_ableiten(p_einsatz uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_status text;
  v_ende   timestamptz;
  v_offen  integer;
  v_alle   integer;
  v_neu    text;
begin
  if p_einsatz is null then return; end if;

  select e.status::text, e.ende_zeitpunkt into v_status, v_ende
    from public.einsatz e where e.id = p_einsatz;
  if not found then return; end if;

  -- Eine abgesagte Schicht bleibt abgesagt (siehe Kopf).
  if v_status = 'storniert' then return; end if;

  select count(*) filter (
           where z.storniert_am is null and z.status = 'laufend'
             and z.ende_zeitpunkt is null),
         count(*) filter (
           where z.storniert_am is null and z.status <> 'storniert')
    into v_offen, v_alle
    from public.zeiteintrag z
   where z.einsatz_id = p_einsatz;

  v_neu := case
    when v_alle = 0            then 'geplant'
    when v_offen > 0           then 'laufend'
    when now() < v_ende        then 'laufend'
    else 'abgeschlossen'
  end;

  if v_neu is distinct from v_status then
    update public.einsatz set status = v_neu::einsatz_status where id = p_einsatz;
  end if;
end $$;

comment on function kern.einsatz_status_ableiten(uuid) is
  'V-082, TIM-01. Leitet einsatz.status aus den Zeiteintraegen dieser Schicht ab — '
  'nie fortgeschrieben, immer neu gerechnet (zwei Wahrheiten driften). '
  'storniert bleibt unberuehrt.';

alter function kern.einsatz_status_ableiten(uuid) owner to cse_definer;
revoke all on function kern.einsatz_status_ableiten(uuid) from public;
grant execute on function kern.einsatz_status_ableiten(uuid) to cse_app, cse_job, cse_checkin;

/**
 * Der Auslöser an `zeiteintrag` — AFTER, und für beide Schichten.
 *
 * `after`, weil er die abgeschlossene Zeile lesen muss: ein `before` sähe den
 * eigenen Eintrag noch nicht in der Tabelle und zählte ihn nicht mit.
 *
 * **Beide Schichten**, weil ein Eintrag die Schicht wechseln kann (Korrektur,
 * Nacherfassung auf die richtige Zeile). Wird nur die neue nachgezogen,
 * bleibt die alte auf `laufend` stehen, obwohl dort nichts mehr erfasst ist.
 */
create function kern.zeiteintrag_einsatz_nachziehen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op <> 'INSERT' and old.einsatz_id is not null
     and old.einsatz_id is distinct from new.einsatz_id then
    perform kern.einsatz_status_ableiten(old.einsatz_id);
  end if;
  perform kern.einsatz_status_ableiten(new.einsatz_id);
  return null;
end $$;

comment on function kern.zeiteintrag_einsatz_nachziehen() is
  'V-082. Zieht den Einsatzstatus nach jedem Stempeln, Beenden, Stornieren und '
  'Nacherfassen nach — beide Schichten, falls der Eintrag die Zeile gewechselt hat.';

create trigger trg_zeiteintrag_9_einsatz_status
  after insert or update on zeiteintrag
  for each row execute function kern.zeiteintrag_einsatz_nachziehen();

-- ---------------------------------------------------------------------------
-- Der Lauf für den Schwanz: die Uhr, die über das Schichtende läuft
-- ---------------------------------------------------------------------------
--
-- Wer um 11:00 aus einer Schicht bis 14:00 aussteigt, laesst eine Schicht
-- zurueck, die keinen offenen Eintrag mehr hat und deren Ende noch bevorsteht
-- — sie bleibt `laufend`, und danach stempelt niemand mehr, also feuert auch
-- kein Ausloeser mehr. Genau dieses eine Fenster schliesst ein Lauf.
-- Er rechnet nichts Eigenes: er ruft dieselbe Ableitung fuer die Schichten,
-- deren Ende gerade vorbeigegangen ist.

/**
 * **Das Schreibrecht ist auf EINE Spalte beschnitten** — dieselbe Form wie
 * `0374` für `besetzt_anzahl`, und aus demselben Grund: ein blankes `grant
 * update on einsatz` öffnete jeder künftigen Definer-Funktion den ganzen
 * Dienstplan, und zwar still. `beginn_zeitpunkt`, `objekt_id` und
 * `storniert_am` bleiben für diese Funktion unerreichbar.
 *
 * Die Policy daneben ist offen (`using true`), und das ist die Arbeitsteilung:
 * eine Policy kann nicht sagen, WELCHE Spalte geschrieben wird — das kann nur
 * das Spaltenrecht. Sie muss trotzdem stehen, weil `einsatz`
 * `FORCE ROW LEVEL SECURITY` fährt und ohne passende Policy auch der
 * Eigentümer nicht schreibt.
 *
 * `select` hält `cse_definer` bereits aus `0040`.
 */
grant update (status) on public.einsatz to cse_definer;

create policy e_definer_status on public.einsatz
  for update to cse_definer
  using (true)
  with check (true);
