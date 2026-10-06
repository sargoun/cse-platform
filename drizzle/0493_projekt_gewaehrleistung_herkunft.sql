-- 0493 — woher die Gewaehrleistungsfrist am Projekt stammt (O-154, D-782).
--
-- `projekt.gewaehrleistung_bis` setzt seit D-782 die wirksame Gesamtabnahme aus
-- der Voreinstellung (vier Jahre VOB/B, fuenf Jahre BGB). Ein vertraglich
-- eingetragenes Datum (`aendereProjekt`) darf davon nicht ueberschrieben
-- werden — und ein Storno darf nur die Frist zuruecknehmen, die die stornierte
-- Abnahme gesetzt hat. Dafuer merkt sich das Projekt, WELCHE Abnahme die Frist
-- gesetzt hat; NULL bei gesetzter Frist heisst: eingetragen, nicht gerechnet.
--
-- Kein Rueckfuellen: eine Frist aus der Zeit vor D-782 ist ein gespeicherter
-- Wert (FRIST_OFFEN rechnete nichts) und bleibt damit eine eingetragene.

alter table projekt
  add column gewaehrleistung_aus_abnahme_id uuid references abnahme(id),
  add constraint projekt_gewaehrleistung_herkunft
    check (gewaehrleistung_aus_abnahme_id is null or gewaehrleistung_bis is not null);

comment on column projekt.gewaehrleistung_aus_abnahme_id is
  'Die wirksame Gesamtabnahme, deren Voreinstellung gewaehrleistung_bis gesetzt hat '
  '(O-154, D-782). NULL bei gesetzter Frist: eingetragen, nicht gerechnet.';

-- 0089 vergibt das Lesen auf projekt spaltenweise und erschoepfend — die neue
-- Spalte braucht ihren eigenen Eintrag, sonst scheitert jedes `returning`.
grant select (gewaehrleistung_aus_abnahme_id) on projekt to cse_app;
