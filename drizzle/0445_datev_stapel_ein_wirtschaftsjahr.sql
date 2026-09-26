-- ===========================================================================
-- 0445 — Ein DATEV-Stapel umfasst hoechstens ein Wirtschaftsjahr (V-212, ACC-02, D-704)
-- ===========================================================================
-- **Der Befund.** Das Belegdatum steht in jeder Zeile des EXTF-Stapels als
-- TTMM; das Jahr kommt aus dem WJ-Beginn im Kopf, und der wurde nur aus von
-- abgeleitet. Weder Formular noch Route, Dienst oder Tabelle verhinderten einen
-- Zeitraum ueber die Grenze: 01.12.2025 bis 31.01.2026 bei Kalender-WJ schrieb
-- eine Buchung vom 15.01.2026 als 1501 unter den WJ-Beginn 2025, also als
-- 15.01.2025. DATEV nimmt einen Stapel ueber zwei Wirtschaftsjahre nicht an,
-- und die Zeilen waren da schon als exportiert gestempelt. Die Tabelle kannte
-- nur check (bis >= von) aus 0133.
--
-- **Was diese Migration anlegt.** Eine Pruefbedingung an datev_export, die
-- aus den EINGEFRORENEN Stammdaten der Zeile (wj_beginn_monat, wj_beginn_tag,
-- seit 0133 auf jeder Zeile) das Beginnjahr des Wirtschaftsjahres von von und
-- von bis bestimmt und Gleichheit verlangt. Das Beginnjahr eines Tages d ist
-- sein Kalenderjahr, minus eins, wenn Monat und Tag von d vor Monat und Tag
-- des WJ-Beginns liegen. Das ist dieselbe Rechnung wie wirtschaftsjahrVon in
-- src/server/services/buchhaltung/wirtschaftsjahr.ts. Gerechnet ueber
-- extract und nicht ueber make_date: ein WJ-Beginn am 30. eines Monats, den
-- es im Februar nicht gibt, darf die Pruefung nicht in einen Datumsfehler
-- laufen lassen.
--
-- Der Dienst (erzeugeDatevExport) prueft dasselbe VOR dem Paket und sagt es
-- in einem Satz; diese Bedingung ist die zweite Linie fuer jeden Weg, der am
-- Dienst vorbei schreibt.
--
-- **not valid.** Ein Stapel, der vor dieser Migration ueber die Grenze
-- erzeugt wurde, ist ein Beleg dafuer, was damals uebergeben wurde, und wird
-- nicht geloescht und nicht umgeschrieben (keine Hard-Deletes in Finanzen).
-- Die Bedingung gilt fuer jede neue und jede geaenderte Zeile.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0422.
-- ===========================================================================

alter table datev_export
  add constraint datev_export_ein_wirtschaftsjahr check (
      (extract(year from von)::integer
         - case when extract(month from von)::integer * 100 + extract(day from von)::integer
                   < wj_beginn_monat * 100 + wj_beginn_tag
                then 1 else 0 end)
    = (extract(year from bis)::integer
         - case when extract(month from bis)::integer * 100 + extract(day from bis)::integer
                   < wj_beginn_monat * 100 + wj_beginn_tag
                then 1 else 0 end)
  ) not valid;

comment on constraint datev_export_ein_wirtschaftsjahr on datev_export is
  'V-212, ACC-02, D-704. von und bis liegen im selben Wirtschaftsjahr (nach den eingefrorenen '
  'wj_beginn_monat/wj_beginn_tag der Zeile). Das Belegdatum steht im Stapel ohne Jahr.';
