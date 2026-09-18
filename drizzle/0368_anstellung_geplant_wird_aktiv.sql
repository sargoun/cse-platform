-- ===========================================================================
-- 0368 — `geplant` wird `aktiv`, wenn der erste Arbeitstag da ist
--        (D-09, EMP-14, 01-KERN §6.14, 0002, 0191)
--
-- **Der Zustand `geplant` hatte bisher keinen Ausgang.** 0002 fuehrt
-- `status in ('geplant','aktiv','ruhend','beendet')`, und 0191 zieht genau
-- EINE Richtung nach: ein vergangenes Austrittsdatum setzt `beendet`. Die
-- Gegenrichtung fehlte — eine Beschaeftigung, die zum Ersten des naechsten
-- Monats beginnt, blieb `geplant`, bis ein Mensch sie von Hand umsetzte.
--
-- Bis heute ist das folgenlos geblieben, weil es keinen Weg gab, eine
-- Beschaeftigung anzulegen: der Seed schreibt `aktiv`, und sonst schrieb
-- niemand. Mit `/portal/[mandant]/personal/anstellungen/neu` entsteht der
-- erste — und eine Einstellungsmaske, die den Eintritt ernst nimmt, erzeugt
-- `geplant`-Zeilen. Ohne diese Haelfte waeren sie Zeilen, die nie anfangen:
-- nicht falsch genug, um aufzufallen, und falsch genug, um jede Liste „aktive
-- Beschaeftigungen" um die neuen Leute zu bringen.
--
-- **Keine neue Regel, sondern die fehlende Symmetrie.** Der Kalender
-- entscheidet, nicht der Klick — genau wie bei der Beendigung (§6.14). Die
-- Grenze ist dieselbe Funktion (`app.berlin_heute()`), damit Anfang und Ende
-- nicht in verschiedenen Zeitzonen liegen (Invariante 2).
--
-- `ruhend` bleibt unberuehrt: eine ruhende Beschaeftigung (Elternzeit,
-- unbezahlte Freistellung) wird von einem Menschen beendet oder wieder
-- aufgenommen, nicht von einem Datum.
-- ===========================================================================

create or replace function app.anstellung_status_nachziehen()
returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_beendet integer; v_aktiv integer;
begin
  with faellig as (
    update public.anstellung a
       set status = 'beendet', geaendert_am = now()
     where a.status <> 'beendet'
       and a.austritt is not null
       and a.austritt < app.berlin_heute()
       and a.geloescht_am is null
     returning a.id)
  select count(*)::integer into v_beendet from faellig;

  /*
   * Der Eintritt ist der ERSTE Arbeitstag, also `<=` und nicht `<`: wer heute
   * anfaengt, ist heute beschaeftigt. Beim Austritt steht `<`, weil der
   * Austritt der LETZTE Arbeitstag ist — dieselbe Ueberlegung, andere Seite.
   *
   * Eine Zeile, deren Austritt schon vorbei ist, faellt oben durch und ist
   * hier `beendet`; die Bedingung `status = 'geplant'` schliesst sie damit
   * von selbst aus.
   */
  with angefangen as (
    update public.anstellung a
       set status = 'aktiv', geaendert_am = now()
     where a.status = 'geplant'
       and a.eintritt <= app.berlin_heute()
       and a.geloescht_am is null
     returning a.id)
  select count(*)::integer into v_aktiv from angefangen;

  return v_beendet + v_aktiv;
end $$;

comment on function app.anstellung_status_nachziehen() is
  '§6.14: der Kalender zieht den Status nach — in BEIDE Richtungen. Ein '
  'vergangener Austritt setzt `beendet` (0191), ein erreichter Eintritt setzt '
  '`aktiv` (0368). Laeuft als cse_job, nie als Handlung eines Menschen.';
