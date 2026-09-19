-- 0184 — `app.ausgabe_ist_erstattung()`: das Ja/Nein ohne Protokolleintrag
--        (K-05, SEC-A9, FIN-14).
--
-- ===========================================================================
-- Der Befund: ein Zugriffsprotokoll, das sich selbst unlesbar macht
-- ===========================================================================
--
-- `app.ausgabe_erstattung_lesen()` (0180) ist der protokollierte Weg zur
-- PERSON hinter einer Erstattung: sie prueft `personal.erstattung_lesen`,
-- schreibt `ausgabe.erstattung_gelesen` ins `audit_log` und gibt dann
-- Anstellung, Person und Personalnummer heraus. Das ist richtig, und es soll
-- so bleiben.
--
-- Falsch war, WER sie rief. `services/finanz/ausgabe.ts` fuehrte in seiner
-- Spaltenliste
--
--     exists (select 1 from app.ausgabe_erstattung_lesen(a.id)) as ist_erstattung
--
-- und diese Liste benutzen `ausgaben()` UND `leseAusgabe()`. Folge: die
-- Ausgabenliste schrieb bei JEDEM Seitenaufruf eine `audit_log`-Zeile je
-- Erstattungsausgabe, obwohl sie nur ein Ja/Nein anzeigt; die Einzelseite
-- schrieb zwei (einmal aus `leseAusgabe`, einmal aus `erstattung`).
--
-- Dass eine `stable` Funktion, die eine volatile Definer-Funktion mit `insert`
-- ruft, wirklich schreibt, ist nachgeprueft: PostgreSQL wendet die
-- Volatilitaetsschranke auf die Anweisungen IN der Funktion an, nicht auf die
-- gerufene. Der `insert` steht in `app.protokolliere` und laeuft.
--
-- **Ein ueberlaufendes Zugriffsprotokoll auf Personenbezug ist kein
-- Kosmetikproblem.** Es macht den echten Zugriff nicht mehr auffindbar
-- (SEC-A9) — und der ist der Grund, warum das Protokoll existiert. Der
-- Kommentar auf `ausgaben/[id]/page.tsx` behauptete genau das zu vermeiden
-- („ein Protokolleintrag fuer jede Ausgabenseite machte das Protokoll
-- unlesbar").
--
-- ===========================================================================
-- Zwei Wege, zwei Auskuenfte
-- ===========================================================================
--
--   app.ausgabe_ist_erstattung(uuid) -> boolean
--       Haengt an dieser Ausgabe eine Anstellung? Kein Name, keine
--       Personalnummer, keine Kennung — ein Bit. Kein Protokolleintrag, weil
--       es keinen Personenbezug herausgibt: WER es ist, sagt dieses Bit
--       nicht.
--
--   app.ausgabe_erstattung_lesen(uuid) -> table(...)
--       Die Person. Prueft `personal.erstattung_lesen` und protokolliert.
--       Gerufen ausschliesslich von `erstattung()`, also genau dort, wo
--       jemand die Person sehen will.
--
-- Die Spalte `anstellung_id` bleibt in beiden Faellen aussen: sie steht nicht
-- im `GRANT` (0180 §4), und ein `is not null` darauf waere derselbe
-- `permission denied` wie ein `select`.

create function app.ausgabe_ist_erstattung(p_ausgabe uuid) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
declare v_mandant uuid; v_anstellung uuid;
begin
  select a.mandant_id, a.anstellung_id into v_mandant, v_anstellung
    from public.ausgabe a where a.id = p_ausgabe;

  /*
   * Keine Zeile ist keine Zeile, und eine fremde Gesellschaft ist ein
   * `false` — nie ein „verboten", das die Existenz bestaetigt (AUT-06).
   */
  if v_mandant is null then return false; end if;
  if not (v_mandant = any (app.sichtbare_mandanten())) then return false; end if;

  return v_anstellung is not null;
end $$;

comment on function app.ausgabe_ist_erstattung(uuid) is
  'K-05, SEC-A9. Das Ja/Nein fuer die Ausgabenliste: haengt an dieser Ausgabe '
  'eine Anstellung? Gibt KEINEN Personenbezug heraus und protokolliert deshalb '
  'nicht. Der Weg zur Person ist app.ausgabe_erstattung_lesen() — die prueft '
  'personal.erstattung_lesen und schreibt einen audit_log-Eintrag.';

alter function app.ausgabe_ist_erstattung(uuid) owner to cse_definer;
revoke all on function app.ausgabe_ist_erstattung(uuid) from public;
grant execute on function app.ausgabe_ist_erstattung(uuid) to cse_app;

/**
 * **`app.ausgabe_erstattung_lesen` wird `volatile`.**
 *
 * Sie war `stable` und schrieb trotzdem — der `insert` steckt in
 * `app.protokolliere`, und PostgreSQL prueft die Schranke nicht ueber
 * Funktionsgrenzen. Das lief, war aber eine Zusicherung auf Zufall: der
 * Planer darf den Aufruf einer `stable` Funktion zusammenfassen oder
 * wegoptimieren, wenn das Ergebnis nicht gebraucht wird. Ein
 * Zugriffsprotokoll, dessen Eintrag vom Abfrageplan abhaengt, ist keines.
 * `volatile` heisst: dieser Aufruf laeuft, und zwar je Zeile.
 */
alter function app.ausgabe_erstattung_lesen(uuid) volatile;
