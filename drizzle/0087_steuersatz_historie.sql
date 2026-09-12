-- ---------------------------------------------------------------------------
-- 0087 — Ein Steuersatz hat eine Geschichte; `unique (schluessel)` nahm sie ihm
-- ---------------------------------------------------------------------------
--
-- `steuersatz_gruppe` traegt seit 0075 `gueltig_von`/`gueltig_bis`, dazu den
-- Index `steuersatz_gruppe_gueltig_idx` ("der Satz am Leistungsdatum") und die
-- Ausschlussbedingung `ssg_kein_ueberlapp` (EIN Satz je Schluessel und TAG).
-- Alle drei gibt es nur aus einem Grund: unter demselben Schluessel sollen
-- mehrere datierte Zeilen stehen koennen — `ust_19` mit 19 % ab 2021 und, nach
-- einer Satzaenderung, `ust_19` mit dem neuen Satz ab dem Stichtag.
--
-- Daneben stand jedoch `ssg_schluessel_uk unique (schluessel)`. Die beiden
-- Bedingungen widersprechen sich: die Ausschlussbedingung erlaubt eine Zeile je
-- Schluessel und Tag, die Unique-Bedingung genau eine Zeile je Schluessel,
-- Punkt. Die engere gewinnt immer — die zweite Zeile liess sich nie einfuegen,
-- und die Satzhistorie war eine Zusicherung ohne Deckung.
--
-- Was das gekostet haette: bei der naechsten Satzaenderung bliebe nur der Weg,
-- die BESTEHENDE Zeile zu aendern. Der Trigger `fin.steuersatz_gruppe_pruefen`
-- verbietet das fuer Satz, Kategorie und Gueltigkeitsbeginn — die Aenderung
-- muesste also am Trigger vorbei oder per Migration erzwungen werden, und
-- dann zeigte JEDE Altrechnung ueber `steuersatz_gruppe_id` auf den NEUEN
-- Satz. Die eingefrorenen Kopien in `rechnungsposition.satz_bp` und
-- `rechnung_steuer.satz_bp` blieben zwar richtig, aber jede Auswertung, die
-- ueber die Gruppe joint, rechnete eine Dezember-Leistung mit dem Januarsatz
-- nach — auf Belegen, die nach §14 UStG unveraenderlich sind.
--
-- Die Ausschlussbedingung bleibt und ist ab jetzt die einzige Eindeutigkeit.
-- Sie ist die richtige: sie beantwortet "welcher Satz gilt am 1. Januar" mit
-- genau einer Zeile, ohne die Vergangenheit zu loeschen.
-- ---------------------------------------------------------------------------

alter table steuersatz_gruppe drop constraint ssg_schluessel_uk;

-- Der Ersatz fuer den weggefallenen Unique-Index: die Aufloesung liest
-- IMMER Schluessel plus Stichtag (`rechnung.ts`, Steuergruppe am
-- Leistungsdatum). Die Ausschlussbedingung hat zwar einen GiST-Index auf
-- `schluessel`, aber ein B-Baum ueber beide Spalten bedient genau diese
-- Abfrage und haelt die Zeilen eines Schluessels in Datumsordnung beisammen.
create index steuersatz_gruppe_schluessel_idx
  on steuersatz_gruppe (schluessel, gueltig_von desc);
