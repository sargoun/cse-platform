-- 0385 · Das Agentenbudget hat ein eigenes Recht — und einen Schreibweg
--        (V-015, AGT-05, K-05, O-26, O-195).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Befund 1 — wer einen Agenten starten darf, durfte sein Budget setzen.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `0128` legt die fuenf Agententabellen in EINER Schleife an und gibt allen
-- dieselbe Schreibbedingung: `app.hat_recht('agent.aufgabe_starten')`. Fuer
-- `agent_aufgabe`, `agent_reservierung`, `agent_kosten` und `agent_schritt`
-- ist das richtig — sie entstehen beim Starten einer Aufgabe.
--
-- **Fuer `agent_budget` ist es die Aufhebung der Grenze, die es zieht.**
-- `agent.aufgabe_starten` haelt `super_admin`, `admin` UND `leitung`; wer
-- also einen Agenten laufen lassen darf, konnte seine eigene Obergrenze
-- heraufsetzen. AGT-05 verlangt eine Obergrenze und einen Hartstopp — eine
-- Obergrenze, die der Begrenzte selbst verstellt, ist keine.
--
-- **Und das Recht dafuer gibt es seit `0008`.** `agent.budget_verwalten`
-- steht im Katalog, gebunden an `super_admin`, bindbar fuer `admin` — es war
-- nur an keine Policy und an keinen Code gebunden. Ein Schluessel, den
-- niemand prueft, ist derselbe Fehler wie ein fehlender, nur schwerer zu
-- sehen.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- **Befund 2 — es gab ueberhaupt keinen Schreibweg.**
-- ═══════════════════════════════════════════════════════════════════════════
--
-- `/portal/[mandant]/agenten/budget` liest `agent_budget` und
-- `agent_reservierung` und zeigt beides sauber an. Angelegt hat eine
-- Budgetzeile nur der Seed — mit `budget_cent is null`, was „kein Budget
-- entschieden" heisst, und dann laeuft **kein Agent**. Die Plattform hatte
-- eine Agentenlaufzeit, eine Kostenrechnung, einen Hartstopp und eine
-- Stoppmeldung; sie hatte keinen Weg, die eine Zahl einzutragen, ohne die
-- nichts davon je anspringt. Der Weg kommt mit
-- `services/agent/budget-pflege.ts` und `POST /api/agenten/budget`.
--
-- **Was hier NICHT entschieden wird:** die HOEHE des Budgets (O-26) und die
-- Warnschwelle (O-195). Beide bleiben offen und beide bleiben leer, bis ein
-- Mensch sie eintraegt; die Maske gibt keinen Vorschlagswert, weil ein
-- Vorschlag in einer Finanzmaske wie eine Abstimmung aussieht.

/**
 * **Nur `agent_budget`, und nur der `with check`.**
 *
 * Gelesen wird weiter unter `agent.lesen`: wer den Verbrauch seiner
 * Gesellschaft sehen darf, soll auch die Grenze sehen, gegen die gerechnet
 * wird — eine Obergrenze, die man nicht kennt, ist als Grenze wertlos. Die
 * restriktive Deckenpolicy `p_intern_ceiling` bleibt unberuehrt; sie steht
 * daneben und faellt nicht mit.
 */
drop policy t_mandant on agent_budget;

create policy t_mandant on agent_budget for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('agent.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('agent.budget_verwalten', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

comment on column agent_budget.budget_cent is
  'Die Obergrenze in ganzen Cent (Invariante 1). NULL heisst „kein Budget entschieden" — '
  'dann laeuft kein Agent. Gesetzt wird sie von einem Menschen unter agent.budget_verwalten '
  '(0385); die Hoehe bleibt eine Frage an den Mandanten (O-26).';

comment on column agent_budget.ist_platzhalter is
  'true, solange die Zeile aus dem Seed stammt und niemand ueber sie entschieden hat. Der '
  'erste menschliche Schreibvorgang setzt sie auf false (0385) — die Oberflaeche faerbt '
  'danach nicht mehr als geraten (§1.16).';
