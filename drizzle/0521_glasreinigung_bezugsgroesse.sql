-- 0521 — Ein Glasreinigungsrevier rechnet auf die Glasflaeche (V-358, O-349, D-830)
--
-- Unterhaltsreinigung und Glasreinigung sind zwei Reviere ueber denselben
-- Raeumen (CLN-05). Bis hierher rechnete jede Zone auf die Bodenflaeche und
-- den Leistungswert der Belagsart ihrer Raeume; die Glasflaeche reiste nur als
-- Schnappschuss mit (revier_raum.fenster_flaeche_qm) und ging in keine Zeit
-- ein. Die Voreinstellung (O-349, D-796): eine Glaszone rechnet auf die
-- Glasflaeche mit einem eigenen Leistungswert je m2 Glas aus dem
-- Belagsartenkatalog.
--
-- 1. revier.bezugsgroesse — boden (wie bisher; der Bestand bleibt so) oder
--    glas. Gerechnet wird in reinigung/sollzeit.ts (eingabeNachBezug), nicht
--    hier.
-- 2. Die Katalogzeile GLAS fuer jede Gesellschaft, die einen
--    Belagsartenkatalog fuehrt und noch keine solche Zeile hat: 50 m2/h,
--    als Voreinstellung markiert (ist_platzhalter, die Quelle nennt O-17 und
--    O-349). Bestaetigt oder neu datiert wird sie unter Stammdaten >
--    Belagsarten, wie jede andere Zeile des Katalogs. Gueltig ab dem
--    Berliner Tag der Migration.
--
-- Nur Kommentare mit Doppelstrich.

alter table revier add column bezugsgroesse text not null default 'boden';

alter table revier add constraint revier_bezugsgroesse_bekannt
  check (bezugsgroesse in ('boden', 'glas'));

comment on column revier.bezugsgroesse is
  'V-358, O-349, D-830. Worauf die Zone ihre Sollzeit rechnet: boden (Bodenflaeche und '
  'Leistungswert der Belagsart je Raum) oder glas (Glasflaeche der Raeume und '
  'Leistungswert der Belagsart GLAS).';

insert into belagsart (mandant_id, code, bezeichnung, beschreibung,
                       leistungswert_qm_pro_stunde, quelle, ist_platzhalter, gueltig_ab)
select k.mandant_id, 'GLAS', 'Glas (Fenster und Glasflächen)',
       'Glasreinigung; gerechnet auf die Glasfläche der Räume einer Glaszone (V-358).',
       50.000,
       'Branchenübliche Größenordnung — nicht bestätigt (O-17, O-349)',
       true, app.berlin_heute()
  from (select distinct mandant_id from belagsart) k
 where not exists (
   select 1 from belagsart g where g.mandant_id = k.mandant_id and g.code = 'GLAS');
