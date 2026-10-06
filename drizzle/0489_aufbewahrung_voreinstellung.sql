-- 0489 — Aufbewahrungsfristen: die drei bisher fristlosen Plattformklassen
-- erhalten eine Voreinstellung (O-25, D-779), nach der Weisung des
-- Auftraggebers vom 05.10.2026 (CLAUDE.md, „Voreinstellung statt offener
-- Frage"). `ist_platzhalter` bleibt `true` — „Voreinstellung, von der
-- Buchhaltung noch nicht bestätigt": der Trigger `kern.setze_aufbewahrung`
-- hält solche Dokumente weiter unter Löschsperre, und der Nachtlauf schlägt
-- nach Fristablauf nur vor (O-894).
--
--   mitarbeiter   6 Jahre — Lohnunterlagen § 41 Abs. 1 EStG, Beitragsnachweise
--                 § 28f SGB IV; die Personalakte verjährt nach 3 Jahren
--                 (§ 195 BGB), die Klasse behält die längere Frist.
--   projekt      10 Jahre — Abrechnungsunterlagen § 147 AO; die VOB/B-
--                 Gewährleistung (§ 13, 4 Jahre) liegt darunter.
--   unternehmen  10 Jahre — Bücher, Abschlüsse, Gesellschaftsunterlagen
--                 § 257 Abs. 4 HGB.
--
-- Eine Gesellschaft überschreibt jede Klasse mit einer eigenen Zeile
-- (`dokument_aufbewahrung.mandant_id`), auch zurück auf „keine Frist".
-- Bestehende Dokumente behalten ihr `aufbewahrung_bis` (null): der Trigger
-- setzt es beim Einfügen; eine rückwirkende Befristung wäre eine Entscheidung
-- über bereits abgelegte Unterlagen und bleibt der Buchhaltung.
--
-- TODO(client, O-25): Voreinstellung 6 / 10 / 10 Jahre (mitarbeiter / projekt / unternehmen).

update dokument_aufbewahrung
   set jahre = 6,
       grundlage = 'Voreinstellung — § 41 EStG Lohnunterlagen, § 28f SGB IV: 6 Jahre (O-25)',
       geaendert_am = now()
 where mandant_id is null and kategorie = 'mitarbeiter' and jahre is null;

update dokument_aufbewahrung
   set jahre = 10,
       grundlage = 'Voreinstellung — § 147 AO Abrechnungsunterlagen, VOB/B § 13 Gewährleistung: 10 Jahre (O-25)',
       geaendert_am = now()
 where mandant_id is null and kategorie = 'projekt' and jahre is null;

update dokument_aufbewahrung
   set jahre = 10,
       grundlage = 'Voreinstellung — § 257 HGB Gesellschaftsunterlagen: 10 Jahre (O-25)',
       geaendert_am = now()
 where mandant_id is null and kategorie = 'unternehmen' and jahre is null;
