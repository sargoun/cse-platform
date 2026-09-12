-- ---------------------------------------------------------------------------
-- 0092 — Das K-08-Register des Check-in-Prinzipals war NICHT geschlossen
-- ---------------------------------------------------------------------------
--
-- `src/server/kontext/checkin.ts` sagt es in zwei Saetzen: „er darf genau eine
-- Funktion ausfuehren" und „`cse_checkin` haelt kein Tabellenrecht, keine
-- Policy und kein `EXECUTE` auf irgendetwas anderem". 0090 schreibt die
-- Zusage noch einmal hin — „`create or replace` behaelt die Rechte der
-- Funktion. Die Zeile steht trotzdem: sie ist die Zusage aus K-08."
--
-- **Die Zusage hatte keine Deckung.** Postgres legt jede Funktion mit
-- `EXECUTE` fuer PUBLIC an, und weder 0035 noch 0042 haben das
-- zurueckgenommen:
--
--     app.checkin_verbrauchen       {=X/postgres, postgres=X/…, cse_checkin=X/…}
--     app.offline_ereignis_annehmen {=X/postgres, postgres=X/…, cse_checkin=X/…}
--
-- Der erste Eintrag ist PUBLIC. Der ausdrueckliche `grant … to cse_checkin`
-- daneben hat also nie etwas hinzugefuegt und nie etwas ausgeschlossen — er
-- las sich wie eine Schranke und war eine Beschriftung.
--
-- Was das gekostet haette: beide Funktionen sind `security definer` und
-- gehoeren `postgres` — Superuser mit `BYPASSRLS`. Ueber PUBLIC konnten sie
-- damit auch `cse_anon` (die Rolle des oeffentlichen Auftritts) und `cse_app`
-- aufrufen. `app.checkin_verbrauchen` legt einen `zeiteintrag` an: genau die
-- Zeile, die im Lohnstreit vorgelegt wird, an jeder Sitzung, jeder Policy und
-- jedem `hat_recht` vorbei. `app.offline_ereignis_annehmen` schreibt in
-- `offline_ereignis`, `zeit_intern.offline_eingang` und `einsatz_medien`.
-- Kein Anwendungspfad tut das heute — beide Aufrufer laufen ausschliesslich in
-- `withCheckin`, also unter `set local role cse_checkin` —, und genau das ist
-- die Form des Fehlers: nichts bricht, nichts meldet sich, und die zweite
-- Verteidigungslinie, auf die sich drei Dateien berufen, gibt es nicht.
--
-- Nachgesehen und nicht vermutet, damit der Widerruf niemandem den Weg nimmt:
--   * `app.checkin_verbrauchen` wird an genau einer Stelle im Anwendungscode
--     gerufen (`services/zeit/checkin.ts`, in `withCheckin`), in den Suiten
--     ausschliesslich als `cse_checkin`.
--   * `app.offline_ereignis_annehmen` ebenso (`services/zeit/offline.ts`), und
--     die Saat geht denselben Weg (`seed/zeit.ts`, „als cse_checkin").
--   * Der ausdrueckliche Grant an `cse_checkin` bleibt stehen; nur PUBLIC
--     faellt. `postgres` behaelt als Eigentuemer sein Recht, also laufen auch
--     die Aufrufe der Suiten weiter, die als Eigentuemer fahren.
--
-- **Was diese Datei NICHT aufraeumt.** Der PUBLIC-Eintrag steht auf rund 45
-- weiteren `security definer`-Funktionen in `app`, `kern` und `zeit_intern`,
-- darunter `app.checkin_ausgeben` und `app.anstellung_entgelt_lesen`. Das
-- pauschal zu widerrufen braucht ein Urteil je Funktion — es gibt welche, auf
-- denen PUBLIC der EINZIGE Grant ist, und deren Aufrufer faellt dann lautlos
-- aus. Diese Arbeit gehoert in dieselbe Pruefrunde wie das Definer-Eigentum
-- (D-300, `tests/isolation/definer-eigentum.test.ts`). Hier faellt nur das
-- Register, das sich selbst als GESCHLOSSEN bezeichnet und es nicht war.
-- ---------------------------------------------------------------------------

revoke all on function
  app.checkin_verbrauchen(text, timestamptz, inet, text, jsonb) from public;
revoke all on function
  app.offline_ereignis_annehmen(text, jsonb, inet) from public;

-- Die beiden Zeilen des Registers — jetzt als die einzigen, die es gibt.
grant execute on function
  app.checkin_verbrauchen(text, timestamptz, inet, text, jsonb) to cse_checkin;
grant execute on function
  app.offline_ereignis_annehmen(text, jsonb, inet) to cse_checkin;

comment on function app.checkin_verbrauchen(text, timestamptz, inet, text, jsonb) is
  'K-08-Register, Rolle cse_checkin — seit 0092 NUR diese Rolle: PUBLIC hielt '
  'bis dahin ebenfalls EXECUTE, womit der Grant daneben nichts ausschloss. '
  'Loest die Marke in EINEM bedingten Schreibvorgang ein und schreibt den '
  'zeiteintrag nur, wenn eine Zeile kam (K-09). Null Zeilen sind die '
  'Ablehnung — ein Ergebnis, kein Orakel.';
