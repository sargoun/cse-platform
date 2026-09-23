-- ===========================================================================
-- 0387 — Zwei nächtliche Statusläufe bekommen ihre Rechte (V-085, V-089)
-- ===========================================================================
--
-- **Der Befund.** Zwei Zustände beschreiben etwas, das mit dem Kalender
-- eintritt, und niemand setzte sie:
--
--  · `angebot.status = 'abgelaufen'` — `0024` legt eigens den Teilindex
--    `angebot_ablauf_idx on angebot (mandant_id, gueltig_bis) where status =
--    'versendet'` an. Ein Index für eine Abfrage, die niemand stellt. Ein
--    versendetes Angebot mit abgelaufener Frist stand für immer als offen in
--    der Liste, und die Vertriebspipeline zählte es mit.
--
--  · `nachweis.status = 'abgelaufen'` — `0030` schreibt die Policy dafür
--    wörtlich hin: „Der naechtliche Statuslauf `gueltig → abgelaufen`
--    (§12.3)". Die Policy gibt es, den Lauf nicht. Für den Nachweis war die
--    Wirkung geringer als es aussieht, weil `decktStichtag` das Datum ohnehin
--    prüft — aber jede Liste, die nach `status` filtert, sah einen gültigen
--    Nachweis, der seit Monaten abgelaufen war.
--
-- **Warum das eine Migration braucht.** Für `nachweis` steht alles schon da
-- (`n_job_status`, `grant update (status, geaendert_am) … to cse_job`). Für
-- `angebot` hat `cse_job` bis hierher ÜBERHAUPT KEIN Recht: kein SELECT, kein
-- UPDATE, keine Policy. Ein Lauf ohne diese Zeilen läse null Angebote und
-- meldete „nichts abgelaufen" — die schlechteste Art von Fehler, weil sie wie
-- ein ruhiger Betrieb aussieht.
--
-- **Nur `status`, und das ist die ganze Aussage.** `grant update (…)` nennt
-- zwei Spalten. Eine Gültigkeitsfrist zu verschieben ist eine kaufmännische
-- Entscheidung und kein Nachtlauf; ein Angebot zu versenden erst recht nicht.
-- Was dieser Job darf, ist einen Zustand nachziehen, der aus dem Datum folgt.
--
-- `kern.angebot_nach_versand_unveraenderlich` (0024) lässt `status`
-- ausdrücklich beweglich und friert alles andere ein — der Auslöser bleibt
-- also die zweite Linie und wird von diesem Recht nicht umgangen.

create policy j_angebot_lesen on angebot for select to cse_job using (true);

/**
 * Der Statuslauf — mit `using`/`with check` auf `true`, weil die SPALTEN die
 * Grenze sind und nicht die Zeilen.
 *
 * Eine Bedingung wie `status = 'versendet'` im `using` sähe strenger aus und
 * wäre es nicht: der Job schreibt ohnehin nur dort, und eine Policy, die
 * dieselbe Bedingung noch einmal führt, muss bei jeder Änderung an zwei
 * Stellen nachgezogen werden. Was hier wirklich schützt, ist das
 * Spaltenrecht darunter.
 */
create policy j_angebot_ablauf on angebot for update to cse_job
  using (true) with check (true);

grant select on angebot to cse_job;
grant update (status, geaendert_am) on angebot to cse_job;

comment on policy j_angebot_ablauf on angebot is
  'V-085: der naechtliche Lauf versendet -> abgelaufen. Nur die Spalte status; '
  'eine Frist zu verschieben ist eine kaufmaennische Entscheidung.';
