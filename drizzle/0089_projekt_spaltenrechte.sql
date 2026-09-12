-- ---------------------------------------------------------------------------
-- 0089 — Auftragssumme und Sicherheitseinbehalt sind Kaufmannsdaten (K-05)
-- ---------------------------------------------------------------------------
--
-- 0071 legt `projekt` an und schliesst den Zeilenschutz mit
--
--     grant select, insert, update on projekt to cse_app;
--
-- also TABELLENWEIT. Zwanzig Zeilen weiter, auf `lv_position`, macht dieselbe
-- Migration es richtig: `revoke select`, danach eine erschoepfende Spaltenliste
-- ohne `einheitspreis_cent`, dazu `app.lv_preis_lesen` als einzigen Weg zum
-- Preis. Auf `projekt` fehlt dieser Schritt — und zwar auf der Tabelle, deren
-- Zeile §1.8 der Baustellenkraft ABSICHTLICH oeffnet.
--
-- Was das kostet: `p_portal_decke` und `t_person` lassen jede Kraft, die auf
-- dem Projekt eingesetzt ist, die Projektzeile lesen — damit sie ihr Aufmass
-- gegen die LV-Position buchen kann (BAU-02). Sie liest dabei bis heute
-- `auftragssumme_netto_cent` und `sicherheitseinbehalt_bp` mit: die
-- Vertragssumme des Kunden und den ausgehandelten Einbehalt nach § 17 VOB/B.
-- 03-GEWERKE §7.1 nennt die Auftragssumme ausdruecklich „column-restricted
-- with `lv_position.einheitspreis_cent` (§1.9)", §7.4 sagt, die Preise seien
-- „withheld by the column grant of §1.9, not by the ceiling", und der Test
-- §14.3 verlangt, dass eine `mitarbeiter`-Sitzung NULL `auftragssumme_netto_cent`
-- liest. Die Decke allein leistet das nicht und war nie dafuer gedacht — sie
-- entscheidet ueber Zeilen, nicht ueber Spalten. EMP-13 („employees never see
-- customer commercials") war damit auf dieser Tabelle eine Zusage ohne
-- Mechanik: nichts bricht, niemand merkt es, und die Kalkulation des Kunden
-- steht im Mitarbeiterportal.
--
-- Der Sicherheitseinbehalt faehrt in derselben Zeile und ist derselbe
-- Gegenstand: ein Prozentsatz, den die Bauleitung mit dem Kunden verhandelt
-- hat. Er wird hier mit entzogen, nicht weil ein Dokument ihn einzeln nennt,
-- sondern weil die Auslassung sonst wie eine Entscheidung aussaehe (§1.9:
-- „an omission is indistinguishable from a decision unless it is written
-- down") — hiermit ist sie aufgeschrieben.
--
-- **Der Postgres-Grund fuer die Reihenfolge** (K-05, wie in 0004 und 0071):
-- ein tabellenweites `GRANT SELECT` mit nachtraeglichem
-- `REVOKE SELECT (spalte)` aendert NICHTS — das Tabellenrecht deckt weiter
-- jede Spalte, und der Widerruf laeuft still ins Leere. Das Tabellenrecht muss
-- erst ganz fallen, danach wird spaltenweise zurueckgegeben.
--
-- Die SCHREIBSEITE bleibt unberuehrt: `insert`/`update` sind eigene
-- Privilegien, das Projektformular traegt die Vertragssumme weiterhin ein und
-- darf sie nur nicht zurueckLESEN — genau die Form, die §11 beschreibt.
--
-- Ein Leser wie `app.lv_preis_lesen` entsteht hier NICHT: heute liest keine
-- einzige Stelle im Anwendungscode diese beiden Spalten (weder Dienst noch
-- Seite noch Saat), also haette er keinen Aufrufer und kein Recht, an dem er
-- sich pruefen liesse. Er gehoert in den PR, der die Vertragssumme erstmals
-- anzeigt — dort mit `bau.preis_lesen`, Mandantenpruefung und `audit_log`,
-- nach dem Muster von 0071.

revoke select on projekt from cse_app;

-- Die Liste ist ERSCHOEPFEND: was hier nicht steht, ist fuer `cse_app` nicht
-- lesbar — auch `select *` scheitert dann, statt still zu maskieren.
grant select (id, mandant_id, auftrag_id, nummer, bezeichnung, kunde_id, objekt_id,
              art, status, vertragsgrundlage, verantwortlich_benutzer_id,
              soll_beginn, soll_ende, ist_beginn, ist_ende,
              gewaehrleistung_bis, wetter_station_id,
              archiviert_am, archiviert_von,
              erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on projekt to cse_app;   -- OMITTED: auftragssumme_netto_cent, sicherheitseinbehalt_bp

-- Unveraendert, und deshalb ausdruecklich: eine Spalte darf schreibbar und
-- unlesbar sein (§11).
grant insert, update on projekt to cse_app;

comment on column projekt.auftragssumme_netto_cent is
  'Ganzzahlige Cent (Invariante 1). Spaltenentzug nach K-05/§1.9: `cse_app` '
  'haelt kein SELECT darauf, weil die Projektzeile selbst der eingesetzten '
  'Kraft offensteht (§1.8, BAU-02) und die Vertragssumme des Kunden sie nichts '
  'angeht (EMP-13).';

comment on column projekt.sicherheitseinbehalt_bp is
  'Basispunkte (250 = 2,50 %), nie Gleitkomma. Spaltenentzug nach K-05/§1.9 '
  'aus demselben Grund wie die Auftragssumme: ein verhandelter Einbehalt nach '
  '§ 17 VOB/B ist eine Kaufmannsangabe des Kunden.';
