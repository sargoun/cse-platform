-- 0491 — Abwesenheitsarten: die Plattformzeilen aus 0073 bekommen eine
-- Voreinstellung für `bezahlt`, den Lohnartenschlüssel und die Nachweispflicht
-- (O-139, D-781), nach der Weisung des Auftraggebers vom 05.10.2026. Bis hier
-- stand `bezahlt` auf NULL — und eine Abwesenheitsmeldung mit einer solchen Art
-- wurde abgewiesen; die Belegschaft konnte sich nicht krankmelden.
--
--   bezahlt: Urlaub, Krankheit (Entgeltfortzahlung bis 6 Wochen, § 3 EFZG),
--            Fortbildung, Freizeitausgleich.
--   unbezahlt: Unbezahlte Freistellung, Kind krank (Kinderkrankengeld der
--            Kasse, § 45 SGB V — kein Entgelt des Arbeitgebers), Sonstige
--            (unbezahlt, bis die Buchhaltung die Art einordnet).
--   Nachweis: Krankheit ab dem 4. Kalendertag (§ 5 Abs. 1 EFZG), Kind krank
--            ab dem 1. Tag (Bescheinigung des Arztes für die Kasse).
--   Lohnartenschlüssel: sprechende Startwerte; das Lohnsystem (O-27) bekommt
--            seine Nummern von der Buchhaltung.
--
-- Nur Plattformzeilen (mandant_id IS NULL) und nur, wo `bezahlt` noch NULL ist —
-- eine Gesellschaft, die ihre Arten schon eingeordnet hat, bleibt unberührt.
-- TODO(client, O-139): Voreinstellung wie oben; Pflege unter Stammdaten › Abwesenheitsarten.

update abwesenheitsart set bezahlt = true,  lohnart_schluessel = coalesce(lohnart_schluessel, 'URLAUB')
 where mandant_id is null and schluessel = 'urlaub' and bezahlt is null;
update abwesenheitsart set bezahlt = true,  lohnart_schluessel = coalesce(lohnart_schluessel, 'KRANK'),
       nachweis_pflicht_ab_tagen = coalesce(nachweis_pflicht_ab_tagen, 4)
 where mandant_id is null and schluessel = 'krankheit' and bezahlt is null;
update abwesenheitsart set bezahlt = false, lohnart_schluessel = coalesce(lohnart_schluessel, 'KINDKRANK'),
       nachweis_pflicht_ab_tagen = coalesce(nachweis_pflicht_ab_tagen, 1)
 where mandant_id is null and schluessel = 'kind_krank' and bezahlt is null;
update abwesenheitsart set bezahlt = false, lohnart_schluessel = coalesce(lohnart_schluessel, 'UNBEZAHLT')
 where mandant_id is null and schluessel = 'unbezahlt' and bezahlt is null;
update abwesenheitsart set bezahlt = true,  lohnart_schluessel = coalesce(lohnart_schluessel, 'FORTBILDUNG')
 where mandant_id is null and schluessel = 'fortbildung' and bezahlt is null;
update abwesenheitsart set bezahlt = true,  lohnart_schluessel = coalesce(lohnart_schluessel, 'FZA')
 where mandant_id is null and schluessel = 'freizeitausgleich' and bezahlt is null;
update abwesenheitsart set bezahlt = false, lohnart_schluessel = coalesce(lohnart_schluessel, 'SONSTIGE')
 where mandant_id is null and schluessel = 'sonstige' and bezahlt is null;
