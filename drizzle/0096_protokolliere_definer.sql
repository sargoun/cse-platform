-- 0096 — `cse_definer` darf `app.protokolliere` wieder aufrufen.
--
-- **Was 0093 gebrochen hat.** Der Entzug des PUBLIC-Eintrags war richtig, die
-- Annahme dahinter nicht: „jede betroffene Funktion traegt bereits einen
-- ausdruecklichen `cse_*`-Grant, also nimmt der Entzug keinem benannten
-- Aufrufer etwas." Das stimmt fuer die Rolle, die sich VERBINDET — und
-- uebersieht die, die INNERHALB einer `security definer`-Funktion gilt.
--
-- `fin.rechnung_nummer_ziehen` gehoert `cse_definer` (eine der drei Funktionen,
-- bei denen K-01 von Anfang an eingehalten wurde). In ihrem Rumpf ist
-- `current_user` deshalb `cse_definer` und nicht `cse_app`, und dort steht
-- `perform app.protokolliere(…)`. `app.protokolliere` war an `cse_app`
-- vergeben; gedeckt war `cse_definer` allein durch PUBLIC. Mit dem Entzug
-- antwortete das Festschreiben JEDER Rechnung mit
-- `permission denied for function protokolliere` — gefunden von der
-- Browsersuite in CI, nicht von der Isolationssuite: dort laeuft die Fixtur
-- als `postgres`, und ein Superuser unterliegt keiner Rechtepruefung.
--
-- **Die Regel dahinter**, jetzt als Pruefung festgehalten
-- (`tests/isolation/spaltenrechte.test.ts`): wer eine Funktion aufruft, ist
-- nicht, wer sich verbunden hat, sondern der EIGENTUEMER der umgebenden
-- `security definer`-Funktion. Solange 95 von 98 davon `postgres` gehoeren
-- (D-300), faellt das nicht auf — ein Superuser wird nie geprueft. Genau
-- deshalb faellt es an der einen Stelle auf, an der die Konvention eingehalten
-- ist, und genau deshalb wird es beim Abarbeiten von D-300 noch oefter
-- auffallen.

grant execute on function
  app.protokolliere(text, text, text, jsonb, jsonb, uuid) to cse_definer;
