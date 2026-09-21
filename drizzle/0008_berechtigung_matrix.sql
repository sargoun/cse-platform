-- 0008 — der Rechtekatalog und die Rollenbindungen (AUT-01, AUT-03, AUT-05, K-19).
--
-- Der Katalog sind DATENSÄTZE, keine Konstanten im Code: sonst ist jede
-- Rechteänderung ein Deployment, und AUT-03 verlangt einen Editor.
--
-- Die Seed-Zeilen unten sind aus `03-AUTH-BERECHTIGUNGEN.md` §12 **erzeugt**
-- (`pnpm katalog`), nicht abgetippt. Eine abgetippte zweite Fassung gewinnt
-- beim ersten Widerspruch mit dem Dokument, ohne dass jemand den Widerspruch
-- sieht — und ein falscher Schlüssel ist unter K-19 kein Fehler, sondern ein
-- dauerhaft leerer Bildschirm.

create type berechtigung_risiko as enum ('niedrig','mittel','hoch');

-- Das Aktionsvokabular aus §7.2. Die LISTE ist die Definition; die Zahl (42)
-- ist nur ihre Prüfsumme — ein früherer Entwurf fixierte 27 und schrieb den
-- Katalog gegen ein breiteres Vokabular, worauf 25 Schlüssel eine Aktion
-- trugen, die der Enum nicht halten konnte: nicht einfügbar, also `hat_recht`
-- dauerhaft false, still.
create type berechtigung_aktion as enum (
  'lesen','erstellen','aendern','schreiben','loeschen','exportieren','importieren','zuweisen',
  'freigeben','genehmigen','entscheiden','verwalten','pruefen','melden','planen','veroeffentlichen',
  'versenden','festschreiben','stornieren','korrigieren','quittieren','uebersteuern','verbinden',
  'einreichen','anmelden','widerrufen','ziehen','abschliessen','archivieren','bearbeiten','beenden',
  'bewerten','erfassen','erheben','herunterladen','pflegen','rueckgaengig','setzen','starten',
  'verwerfen','zuruecksetzen','zusammenfuehren'
);

create table berechtigung (
  id            uuid primary key default gen_random_uuid(),
  -- Zwei ODER DREI Segmente: die Gruppenschlüssel aus K-03 tragen drei.
  schluessel    text not null unique check (schluessel ~ '^[a-z_]+(\.[a-z_]+){1,2}$'),
  modul         text not null,
  objekt        text not null,
  aktion        berechtigung_aktion not null,
  bezeichnung   text not null,
  beschreibung  text,
  -- Nur an eine globale Rolle bindbar, z. B. system.mandant_verwalten.
  nur_global    boolean not null default false,
  erfordert_2fa boolean not null default false,
  risiko        berechtigung_risiko not null default 'niedrig',
  ist_system    boolean not null default true,
  sortierung    integer not null default 0,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint berechtigung_modul_objekt_aktion_uk unique (modul, objekt, aktion),
  -- Das erste Segment IST das Modul, ausnahmslos (K-19/K-21). Ein Modul, das
  -- im Katalog nicht existiert, macht jedes Recht darin unauflösbar.
  constraint berechtigung_modul_ist_erstes_segment
    check (modul = split_part(schluessel, '.', 1))
);

create index berechtigung_modul_idx on berechtigung (modul, sortierung);

/**
 * Die Bindung: welche Rolle hält welches Recht — je Mandant.
 *
 * `mandant_id IS NULL` ist die **Plattform-Vorgabe** aus §12. Eine Zeile mit
 * gesetztem `mandant_id` übersteuert sie für genau diese Gesellschaft, und das
 * ist AUT-03: `finanzen.lesen` der `leitung` in `bau` zu entziehen darf in
 * `reinigung` nichts ändern — und kein Deployment kosten.
 *
 * `gewaehrt` ist ein BOOLEAN und nicht die blosse Existenz der Zeile: ein
 * Entzug muss sich von "nie etwas eingestellt" unterscheiden lassen, sonst
 * kann eine Vorgabe je Mandant nur erweitert, nie eingeschränkt werden.
 */
create table rolle_berechtigung (
  id              uuid primary key default gen_random_uuid(),
  rolle_id        uuid not null references rolle(id),
  berechtigung_id uuid not null references berechtigung(id),
  mandant_id      uuid references mandant(id),
  gewaehrt        boolean not null default true,
  erstellt_am     timestamptz not null default now(),
  geaendert_am    timestamptz,
  erstellt_von    uuid references benutzer(id),
  geaendert_von   uuid references benutzer(id)
);

create unique index rolle_berechtigung_key
  on rolle_berechtigung (rolle_id, berechtigung_id, mandant_id) nulls not distinct;
create index rolle_berechtigung_aufloesung_idx
  on rolle_berechtigung (rolle_id, mandant_id) where gewaehrt;

-- <<< generiert aus docs §12 via `pnpm katalog` — nicht von Hand ändern

insert into berechtigung (schluessel, modul, objekt, aktion, bezeichnung, nur_global, sortierung) values
  ('abrechnung.freistellung_pflegen', 'abrechnung', 'freistellung', 'pflegen'::berechtigung_aktion, 'abrechnung.freistellung_pflegen', false, 0),
  ('abrechnung.lesen', 'abrechnung', 'abrechnung', 'lesen'::berechtigung_aktion, 'abrechnung.lesen', false, 1),
  ('abrechnung.schreiben', 'abrechnung', 'abrechnung', 'schreiben'::berechtigung_aktion, 'abrechnung.schreiben', false, 2),
  ('agent.aufgabe_starten', 'agent', 'aufgabe', 'starten'::berechtigung_aktion, 'agent.aufgabe_starten', false, 3),
  ('agent.autonomie_setzen', 'agent', 'autonomie', 'setzen'::berechtigung_aktion, 'agent.autonomie_setzen', false, 4),
  ('agent.budget_verwalten', 'agent', 'budget', 'verwalten'::berechtigung_aktion, 'agent.budget_verwalten', false, 5),
  ('agent.lesen', 'agent', 'agent', 'lesen'::berechtigung_aktion, 'agent.lesen', false, 6),
  ('agent.protokoll_lesen', 'agent', 'protokoll', 'lesen'::berechtigung_aktion, 'agent.protokoll_lesen', false, 7),
  ('agent.richtlinie_verwalten', 'agent', 'richtlinie', 'verwalten'::berechtigung_aktion, 'agent.richtlinie_verwalten', false, 8),
  ('agent.werkzeug_verbinden', 'agent', 'werkzeug', 'verbinden'::berechtigung_aktion, 'agent.werkzeug_verbinden', false, 9),
  ('angebot.annahme_erfassen', 'angebot', 'annahme', 'erfassen'::berechtigung_aktion, 'angebot.annahme_erfassen', false, 10),
  ('angebot.lesen', 'angebot', 'angebot', 'lesen'::berechtigung_aktion, 'angebot.lesen', false, 11),
  ('angebot.preis_freigeben', 'angebot', 'preis', 'freigeben'::berechtigung_aktion, 'angebot.preis_freigeben', false, 12),
  ('angebot.schreiben', 'angebot', 'angebot', 'schreiben'::berechtigung_aktion, 'angebot.schreiben', false, 13),
  ('angebot.versenden', 'angebot', 'angebot', 'versenden'::berechtigung_aktion, 'angebot.versenden', false, 14),
  ('aufgabe.lesen', 'aufgabe', 'aufgabe', 'lesen'::berechtigung_aktion, 'aufgabe.lesen', false, 15),
  ('aufgabe.schreiben', 'aufgabe', 'aufgabe', 'schreiben'::berechtigung_aktion, 'aufgabe.schreiben', false, 16),
  ('aufgabe.zuweisen', 'aufgabe', 'aufgabe', 'zuweisen'::berechtigung_aktion, 'aufgabe.zuweisen', false, 17),
  ('auftrag.abschliessen', 'auftrag', 'auftrag', 'abschliessen'::berechtigung_aktion, 'auftrag.abschliessen', false, 18),
  ('auftrag.lesen', 'auftrag', 'auftrag', 'lesen'::berechtigung_aktion, 'auftrag.lesen', false, 19),
  ('auftrag.schreiben', 'auftrag', 'auftrag', 'schreiben'::berechtigung_aktion, 'auftrag.schreiben', false, 20),
  ('bau.aufmass_erfassen', 'bau', 'aufmass', 'erfassen'::berechtigung_aktion, 'bau.aufmass_erfassen', false, 21),
  ('bau.aufmass_freigeben', 'bau', 'aufmass', 'freigeben'::berechtigung_aktion, 'bau.aufmass_freigeben', false, 22),
  ('bau.behinderung_erstellen', 'bau', 'behinderung', 'erstellen'::berechtigung_aktion, 'bau.behinderung_erstellen', false, 23),
  ('bau.lesen', 'bau', 'bau', 'lesen'::berechtigung_aktion, 'bau.lesen', false, 24),
  ('bau.nachtrag_anmelden', 'bau', 'nachtrag', 'anmelden'::berechtigung_aktion, 'bau.nachtrag_anmelden', false, 25),
  ('bau.nachtrag_einreichen', 'bau', 'nachtrag', 'einreichen'::berechtigung_aktion, 'bau.nachtrag_einreichen', false, 26),
  ('bau.preis_lesen', 'bau', 'preis', 'lesen'::berechtigung_aktion, 'bau.preis_lesen', false, 27),
  ('bau.schreiben', 'bau', 'bau', 'schreiben'::berechtigung_aktion, 'bau.schreiben', false, 28),
  ('bericht.dashboard_lesen', 'bericht', 'dashboard', 'lesen'::berechtigung_aktion, 'bericht.dashboard_lesen', false, 29),
  ('bericht.exportieren', 'bericht', 'bericht', 'exportieren'::berechtigung_aktion, 'bericht.exportieren', false, 30),
  ('bericht.lesen', 'bericht', 'bericht', 'lesen'::berechtigung_aktion, 'bericht.lesen', false, 31),
  ('buchhaltung_konfiguration.lesen', 'buchhaltung_konfiguration', 'buchhaltung_konfiguration', 'lesen'::berechtigung_aktion, 'buchhaltung_konfiguration.lesen', false, 32),
  ('buchhaltung_konfiguration.verwalten', 'buchhaltung_konfiguration', 'buchhaltung_konfiguration', 'verwalten'::berechtigung_aktion, 'buchhaltung_konfiguration.verwalten', false, 33),
  ('buchhaltung.exportieren', 'buchhaltung', 'buchhaltung', 'exportieren'::berechtigung_aktion, 'buchhaltung.exportieren', false, 34),
  ('buchhaltung.festschreiben', 'buchhaltung', 'buchhaltung', 'festschreiben'::berechtigung_aktion, 'buchhaltung.festschreiben', false, 35),
  ('buchhaltung.lesen', 'buchhaltung', 'buchhaltung', 'lesen'::berechtigung_aktion, 'buchhaltung.lesen', false, 36),
  ('buchhaltung.schreiben', 'buchhaltung', 'buchhaltung', 'schreiben'::berechtigung_aktion, 'buchhaltung.schreiben', false, 37),
  ('crm_entgelt.lesen', 'crm_entgelt', 'crm_entgelt', 'lesen'::berechtigung_aktion, 'crm_entgelt.lesen', false, 38),
  ('crm.exportieren', 'crm', 'crm', 'exportieren'::berechtigung_aktion, 'crm.exportieren', false, 39),
  ('crm.kommunikation_versenden', 'crm', 'kommunikation', 'versenden'::berechtigung_aktion, 'crm.kommunikation_versenden', false, 40),
  ('crm.lesen', 'crm', 'crm', 'lesen'::berechtigung_aktion, 'crm.lesen', false, 41),
  ('crm.rechtsgrundlage_lesen', 'crm', 'rechtsgrundlage', 'lesen'::berechtigung_aktion, 'crm.rechtsgrundlage_lesen', false, 42),
  ('crm.rechtsgrundlage_setzen', 'crm', 'rechtsgrundlage', 'setzen'::berechtigung_aktion, 'crm.rechtsgrundlage_setzen', false, 43),
  ('crm.schreiben', 'crm', 'crm', 'schreiben'::berechtigung_aktion, 'crm.schreiben', false, 44),
  ('datenschutz.auskunft_erstellen', 'datenschutz', 'auskunft', 'erstellen'::berechtigung_aktion, 'datenschutz.auskunft_erstellen', false, 45),
  ('datenschutz.berichtigung_bearbeiten', 'datenschutz', 'berichtigung', 'bearbeiten'::berechtigung_aktion, 'datenschutz.berichtigung_bearbeiten', false, 46),
  ('datenschutz.loeschung_pruefen', 'datenschutz', 'loeschung', 'pruefen'::berechtigung_aktion, 'datenschutz.loeschung_pruefen', false, 47),
  ('dienstanweisung.lesen', 'dienstanweisung', 'dienstanweisung', 'lesen'::berechtigung_aktion, 'dienstanweisung.lesen', false, 48),
  ('dienstanweisung.schreiben', 'dienstanweisung', 'dienstanweisung', 'schreiben'::berechtigung_aktion, 'dienstanweisung.schreiben', false, 49),
  ('dienstplan.arbzg_lesen', 'dienstplan', 'arbzg', 'lesen'::berechtigung_aktion, 'dienstplan.arbzg_lesen', false, 50),
  ('dienstplan.arbzg_pruefen', 'dienstplan', 'arbzg', 'pruefen'::berechtigung_aktion, 'dienstplan.arbzg_pruefen', false, 51),
  ('dienstplan.arbzg_uebersteuern', 'dienstplan', 'arbzg', 'uebersteuern'::berechtigung_aktion, 'dienstplan.arbzg_uebersteuern', false, 52),
  ('dienstplan.konflikt_quittieren', 'dienstplan', 'konflikt', 'quittieren'::berechtigung_aktion, 'dienstplan.konflikt_quittieren', false, 53),
  ('dienstplan.lesen', 'dienstplan', 'dienstplan', 'lesen'::berechtigung_aktion, 'dienstplan.lesen', false, 54),
  ('dienstplan.schreiben', 'dienstplan', 'dienstplan', 'schreiben'::berechtigung_aktion, 'dienstplan.schreiben', false, 55),
  ('dienstplan.veroeffentlichen', 'dienstplan', 'dienstplan', 'veroeffentlichen'::berechtigung_aktion, 'dienstplan.veroeffentlichen', false, 56),
  ('dokument.archivieren', 'dokument', 'dokument', 'archivieren'::berechtigung_aktion, 'dokument.archivieren', false, 57),
  ('dokument.aufbewahrung_verwalten', 'dokument', 'aufbewahrung', 'verwalten'::berechtigung_aktion, 'dokument.aufbewahrung_verwalten', false, 58),
  ('dokument.buendel_exportieren', 'dokument', 'buendel', 'exportieren'::berechtigung_aktion, 'dokument.buendel_exportieren', false, 59),
  ('dokument.kunde_freigeben', 'dokument', 'kunde', 'freigeben'::berechtigung_aktion, 'dokument.kunde_freigeben', false, 60),
  ('dokument.lesen', 'dokument', 'dokument', 'lesen'::berechtigung_aktion, 'dokument.lesen', false, 61),
  ('dokument.schreiben', 'dokument', 'dokument', 'schreiben'::berechtigung_aktion, 'dokument.schreiben', false, 62),
  ('eingang.freigeben', 'eingang', 'eingang', 'freigeben'::berechtigung_aktion, 'eingang.freigeben', false, 63),
  ('eingang.lesen', 'eingang', 'eingang', 'lesen'::berechtigung_aktion, 'eingang.lesen', false, 64),
  ('eingang.schreiben', 'eingang', 'eingang', 'schreiben'::berechtigung_aktion, 'eingang.schreiben', false, 65),
  ('finanzen.entwurf_verwerfen', 'finanzen', 'entwurf', 'verwerfen'::berechtigung_aktion, 'finanzen.entwurf_verwerfen', false, 66),
  ('finanzen.festschreiben', 'finanzen', 'finanzen', 'festschreiben'::berechtigung_aktion, 'finanzen.festschreiben', false, 67),
  ('finanzen.herunterladen', 'finanzen', 'finanzen', 'herunterladen'::berechtigung_aktion, 'finanzen.herunterladen', false, 68),
  ('finanzen.lesen', 'finanzen', 'finanzen', 'lesen'::berechtigung_aktion, 'finanzen.lesen', false, 69),
  ('finanzen.schreiben', 'finanzen', 'finanzen', 'schreiben'::berechtigung_aktion, 'finanzen.schreiben', false, 70),
  ('finanzen.steuerfall_uebersteuern', 'finanzen', 'steuerfall', 'uebersteuern'::berechtigung_aktion, 'finanzen.steuerfall_uebersteuern', false, 71),
  ('finanzen.stornieren', 'finanzen', 'finanzen', 'stornieren'::berechtigung_aktion, 'finanzen.stornieren', false, 72),
  ('formular.lesen', 'formular', 'formular', 'lesen'::berechtigung_aktion, 'formular.lesen', false, 73),
  ('formular.schreiben', 'formular', 'formular', 'schreiben'::berechtigung_aktion, 'formular.schreiben', false, 74),
  ('freigabe.alle_lesen', 'freigabe', 'alle', 'lesen'::berechtigung_aktion, 'freigabe.alle_lesen', false, 75),
  ('freigabe.einspruch_erheben', 'freigabe', 'einspruch', 'erheben'::berechtigung_aktion, 'freigabe.einspruch_erheben', false, 76),
  ('freigabe.entscheiden', 'freigabe', 'freigabe', 'entscheiden'::berechtigung_aktion, 'freigabe.entscheiden', false, 77),
  ('freigabe.lesen', 'freigabe', 'freigabe', 'lesen'::berechtigung_aktion, 'freigabe.lesen', false, 78),
  ('freigabe.pruefdauer_lesen', 'freigabe', 'pruefdauer', 'lesen'::berechtigung_aktion, 'freigabe.pruefdauer_lesen', false, 79),
  ('freigabe.rueckgaengig', 'freigabe', 'freigabe', 'rueckgaengig'::berechtigung_aktion, 'freigabe.rueckgaengig', false, 80),
  ('freigabe.stapel_entscheiden', 'freigabe', 'stapel', 'entscheiden'::berechtigung_aktion, 'freigabe.stapel_entscheiden', false, 81),
  ('gruppe.abrechnung.lesen', 'gruppe', 'abrechnung', 'lesen'::berechtigung_aktion, 'gruppe.abrechnung.lesen', false, 82),
  ('gruppe.agent.lesen', 'gruppe', 'agent', 'lesen'::berechtigung_aktion, 'gruppe.agent.lesen', false, 83),
  ('gruppe.angebot.lesen', 'gruppe', 'angebot', 'lesen'::berechtigung_aktion, 'gruppe.angebot.lesen', false, 84),
  ('gruppe.aufgabe.lesen', 'gruppe', 'aufgabe', 'lesen'::berechtigung_aktion, 'gruppe.aufgabe.lesen', false, 85),
  ('gruppe.auftrag.lesen', 'gruppe', 'auftrag', 'lesen'::berechtigung_aktion, 'gruppe.auftrag.lesen', false, 86),
  ('gruppe.bau.lesen', 'gruppe', 'bau', 'lesen'::berechtigung_aktion, 'gruppe.bau.lesen', false, 87),
  ('gruppe.bericht.lesen', 'gruppe', 'bericht', 'lesen'::berechtigung_aktion, 'gruppe.bericht.lesen', false, 88),
  ('gruppe.buchhaltung_konfiguration.lesen', 'gruppe', 'buchhaltung_konfiguration', 'lesen'::berechtigung_aktion, 'gruppe.buchhaltung_konfiguration.lesen', false, 89),
  ('gruppe.buchhaltung.lesen', 'gruppe', 'buchhaltung', 'lesen'::berechtigung_aktion, 'gruppe.buchhaltung.lesen', false, 90),
  ('gruppe.crm_entgelt.lesen', 'gruppe', 'crm_entgelt', 'lesen'::berechtigung_aktion, 'gruppe.crm_entgelt.lesen', false, 91),
  ('gruppe.crm.lesen', 'gruppe', 'crm', 'lesen'::berechtigung_aktion, 'gruppe.crm.lesen', false, 92),
  ('gruppe.datenschutz.lesen', 'gruppe', 'datenschutz', 'lesen'::berechtigung_aktion, 'gruppe.datenschutz.lesen', false, 93),
  ('gruppe.dienstanweisung.lesen', 'gruppe', 'dienstanweisung', 'lesen'::berechtigung_aktion, 'gruppe.dienstanweisung.lesen', false, 94),
  ('gruppe.dienstplan.arbzg_lesen', 'gruppe', 'dienstplan_arbzg', 'lesen'::berechtigung_aktion, 'gruppe.dienstplan.arbzg_lesen', false, 95),
  ('gruppe.dienstplan.lesen', 'gruppe', 'dienstplan', 'lesen'::berechtigung_aktion, 'gruppe.dienstplan.lesen', false, 96),
  ('gruppe.dokument.lesen', 'gruppe', 'dokument', 'lesen'::berechtigung_aktion, 'gruppe.dokument.lesen', false, 97),
  ('gruppe.eingang.lesen', 'gruppe', 'eingang', 'lesen'::berechtigung_aktion, 'gruppe.eingang.lesen', false, 98),
  ('gruppe.finanzen.lesen', 'gruppe', 'finanzen', 'lesen'::berechtigung_aktion, 'gruppe.finanzen.lesen', false, 99),
  ('gruppe.formular.lesen', 'gruppe', 'formular', 'lesen'::berechtigung_aktion, 'gruppe.formular.lesen', false, 100),
  ('gruppe.freigabe.lesen', 'gruppe', 'freigabe', 'lesen'::berechtigung_aktion, 'gruppe.freigabe.lesen', false, 101),
  ('gruppe.kalender.lesen', 'gruppe', 'kalender', 'lesen'::berechtigung_aktion, 'gruppe.kalender.lesen', false, 102),
  ('gruppe.kalkulation.lesen', 'gruppe', 'kalkulation', 'lesen'::berechtigung_aktion, 'gruppe.kalkulation.lesen', false, 103),
  ('gruppe.katalog.lesen', 'gruppe', 'katalog', 'lesen'::berechtigung_aktion, 'gruppe.katalog.lesen', false, 104),
  ('gruppe.mahnung.lesen', 'gruppe', 'mahnung', 'lesen'::berechtigung_aktion, 'gruppe.mahnung.lesen', false, 105),
  ('gruppe.nachricht.lesen', 'gruppe', 'nachricht', 'lesen'::berechtigung_aktion, 'gruppe.nachricht.lesen', false, 106),
  ('gruppe.nachweis.lesen', 'gruppe', 'nachweis', 'lesen'::berechtigung_aktion, 'gruppe.nachweis.lesen', false, 107),
  ('gruppe.nummernkreis.lesen', 'gruppe', 'nummernkreis', 'lesen'::berechtigung_aktion, 'gruppe.nummernkreis.lesen', false, 108),
  ('gruppe.objekt_import.lesen', 'gruppe', 'objekt_import', 'lesen'::berechtigung_aktion, 'gruppe.objekt_import.lesen', false, 109),
  ('gruppe.objekt.lesen', 'gruppe', 'objekt', 'lesen'::berechtigung_aktion, 'gruppe.objekt.lesen', false, 110),
  ('gruppe.oeffentlich.lesen', 'gruppe', 'oeffentlich', 'lesen'::berechtigung_aktion, 'gruppe.oeffentlich.lesen', false, 111),
  ('gruppe.personal.lesen', 'gruppe', 'personal', 'lesen'::berechtigung_aktion, 'gruppe.personal.lesen', false, 112),
  ('gruppe.qualitaet.lesen', 'gruppe', 'qualitaet', 'lesen'::berechtigung_aktion, 'gruppe.qualitaet.lesen', false, 113),
  ('gruppe.radar.lesen', 'gruppe', 'radar', 'lesen'::berechtigung_aktion, 'gruppe.radar.lesen', false, 114),
  ('gruppe.recruiting.lesen', 'gruppe', 'recruiting', 'lesen'::berechtigung_aktion, 'gruppe.recruiting.lesen', false, 115),
  ('gruppe.referenz.lesen', 'gruppe', 'referenz', 'lesen'::berechtigung_aktion, 'gruppe.referenz.lesen', false, 116),
  ('gruppe.reinigung.lesen', 'gruppe', 'reinigung', 'lesen'::berechtigung_aktion, 'gruppe.reinigung.lesen', false, 117),
  ('gruppe.schluessel.lesen', 'gruppe', 'schluessel', 'lesen'::berechtigung_aktion, 'gruppe.schluessel.lesen', false, 118),
  ('gruppe.security.lesen', 'gruppe', 'security', 'lesen'::berechtigung_aktion, 'gruppe.security.lesen', false, 119),
  ('gruppe.social.lesen', 'gruppe', 'social', 'lesen'::berechtigung_aktion, 'gruppe.social.lesen', false, 120),
  ('gruppe.stammdaten.lesen', 'gruppe', 'stammdaten', 'lesen'::berechtigung_aktion, 'gruppe.stammdaten.lesen', false, 121),
  ('gruppe.system.audit_lesen', 'gruppe', 'system_audit', 'lesen'::berechtigung_aktion, 'gruppe.system.audit_lesen', false, 122),
  ('gruppe.system.lesen', 'gruppe', 'system', 'lesen'::berechtigung_aktion, 'gruppe.system.lesen', false, 123),
  ('gruppe.vergabe.lesen', 'gruppe', 'vergabe', 'lesen'::berechtigung_aktion, 'gruppe.vergabe.lesen', false, 124),
  ('gruppe.versand.lesen', 'gruppe', 'versand', 'lesen'::berechtigung_aktion, 'gruppe.versand.lesen', false, 125),
  ('gruppe.wachbuch.lesen', 'gruppe', 'wachbuch', 'lesen'::berechtigung_aktion, 'gruppe.wachbuch.lesen', false, 126),
  ('gruppe.wissen.lesen', 'gruppe', 'wissen', 'lesen'::berechtigung_aktion, 'gruppe.wissen.lesen', false, 127),
  ('gruppe.zahlung.lesen', 'gruppe', 'zahlung', 'lesen'::berechtigung_aktion, 'gruppe.zahlung.lesen', false, 128),
  ('gruppe.zeit.lesen', 'gruppe', 'zeit', 'lesen'::berechtigung_aktion, 'gruppe.zeit.lesen', false, 129),
  ('kalender.lesen', 'kalender', 'kalender', 'lesen'::berechtigung_aktion, 'kalender.lesen', false, 130),
  ('kalender.schreiben', 'kalender', 'kalender', 'schreiben'::berechtigung_aktion, 'kalender.schreiben', false, 131),
  ('kalkulation.lesen', 'kalkulation', 'kalkulation', 'lesen'::berechtigung_aktion, 'kalkulation.lesen', false, 132),
  ('kalkulation.schreiben', 'kalkulation', 'kalkulation', 'schreiben'::berechtigung_aktion, 'kalkulation.schreiben', false, 133),
  ('katalog.lesen', 'katalog', 'katalog', 'lesen'::berechtigung_aktion, 'katalog.lesen', false, 134),
  ('katalog.schreiben', 'katalog', 'katalog', 'schreiben'::berechtigung_aktion, 'katalog.schreiben', false, 135),
  ('mahnung.freigeben', 'mahnung', 'mahnung', 'freigeben'::berechtigung_aktion, 'mahnung.freigeben', false, 136),
  ('mahnung.lesen', 'mahnung', 'mahnung', 'lesen'::berechtigung_aktion, 'mahnung.lesen', false, 137),
  ('mahnung.schreiben', 'mahnung', 'mahnung', 'schreiben'::berechtigung_aktion, 'mahnung.schreiben', false, 138),
  ('nachricht.lesen', 'nachricht', 'nachricht', 'lesen'::berechtigung_aktion, 'nachricht.lesen', false, 139),
  ('nachricht.versenden', 'nachricht', 'nachricht', 'versenden'::berechtigung_aktion, 'nachricht.versenden', false, 140),
  ('nachweis.lesen', 'nachweis', 'nachweis', 'lesen'::berechtigung_aktion, 'nachweis.lesen', false, 141),
  ('nachweis.preis_lesen', 'nachweis', 'preis', 'lesen'::berechtigung_aktion, 'nachweis.preis_lesen', false, 142),
  ('nachweis.schreiben', 'nachweis', 'nachweis', 'schreiben'::berechtigung_aktion, 'nachweis.schreiben', false, 143),
  ('nummernkreis.lesen', 'nummernkreis', 'nummernkreis', 'lesen'::berechtigung_aktion, 'nummernkreis.lesen', false, 144),
  ('nummernkreis.verwalten', 'nummernkreis', 'nummernkreis', 'verwalten'::berechtigung_aktion, 'nummernkreis.verwalten', false, 145),
  ('nummernkreis.ziehen', 'nummernkreis', 'nummernkreis', 'ziehen'::berechtigung_aktion, 'nummernkreis.ziehen', false, 146),
  ('objekt_import.lesen', 'objekt_import', 'objekt_import', 'lesen'::berechtigung_aktion, 'objekt_import.lesen', false, 147),
  ('objekt_import.schreiben', 'objekt_import', 'objekt_import', 'schreiben'::berechtigung_aktion, 'objekt_import.schreiben', false, 148),
  ('objekt.lesen', 'objekt', 'objekt', 'lesen'::berechtigung_aktion, 'objekt.lesen', false, 149),
  ('objekt.schreiben', 'objekt', 'objekt', 'schreiben'::berechtigung_aktion, 'objekt.schreiben', false, 150),
  ('oeffentlich.lesen', 'oeffentlich', 'oeffentlich', 'lesen'::berechtigung_aktion, 'oeffentlich.lesen', false, 151),
  ('personal.aendern', 'personal', 'personal', 'aendern'::berechtigung_aktion, 'personal.aendern', false, 152),
  ('personal.anstellung_beenden', 'personal', 'anstellung', 'beenden'::berechtigung_aktion, 'personal.anstellung_beenden', false, 153),
  ('personal.bewacher_verwalten', 'personal', 'bewacher', 'verwalten'::berechtigung_aktion, 'personal.bewacher_verwalten', false, 154),
  ('personal.entgelt_lesen', 'personal', 'entgelt', 'lesen'::berechtigung_aktion, 'personal.entgelt_lesen', false, 155),
  ('personal.entgelt_schreiben', 'personal', 'entgelt', 'schreiben'::berechtigung_aktion, 'personal.entgelt_schreiben', false, 156),
  ('personal.erstattung_lesen', 'personal', 'erstattung', 'lesen'::berechtigung_aktion, 'personal.erstattung_lesen', false, 157),
  ('personal.erstellen', 'personal', 'personal', 'erstellen'::berechtigung_aktion, 'personal.erstellen', false, 158),
  ('personal.lesen', 'personal', 'personal', 'lesen'::berechtigung_aktion, 'personal.lesen', false, 159),
  ('personal.nachweis_lesen', 'personal', 'nachweis', 'lesen'::berechtigung_aktion, 'personal.nachweis_lesen', false, 160),
  ('personal.nachweis_verwalten', 'personal', 'nachweis', 'verwalten'::berechtigung_aktion, 'personal.nachweis_verwalten', false, 161),
  ('personal.schreiben', 'personal', 'personal', 'schreiben'::berechtigung_aktion, 'personal.schreiben', false, 162),
  ('personal.stammdaten_lesen', 'personal', 'stammdaten', 'lesen'::berechtigung_aktion, 'personal.stammdaten_lesen', false, 163),
  ('personal.zugang_verwalten', 'personal', 'zugang', 'verwalten'::berechtigung_aktion, 'personal.zugang_verwalten', false, 164),
  ('personal.zusammenfuehren', 'personal', 'personal', 'zusammenfuehren'::berechtigung_aktion, 'personal.zusammenfuehren', false, 165),
  ('qualitaet.lesen', 'qualitaet', 'qualitaet', 'lesen'::berechtigung_aktion, 'qualitaet.lesen', false, 166),
  ('qualitaet.schreiben', 'qualitaet', 'qualitaet', 'schreiben'::berechtigung_aktion, 'qualitaet.schreiben', false, 167),
  ('radar.lesen', 'radar', 'radar', 'lesen'::berechtigung_aktion, 'radar.lesen', false, 168),
  ('radar.plattform_verwalten', 'radar', 'plattform', 'verwalten'::berechtigung_aktion, 'radar.plattform_verwalten', false, 169),
  ('radar.profil_schreiben', 'radar', 'profil', 'schreiben'::berechtigung_aktion, 'radar.profil_schreiben', false, 170),
  ('radar.status_setzen', 'radar', 'status', 'setzen'::berechtigung_aktion, 'radar.status_setzen', false, 171),
  ('recruiting.bewerbung_bewerten', 'recruiting', 'bewerbung', 'bewerten'::berechtigung_aktion, 'recruiting.bewerbung_bewerten', false, 172),
  ('recruiting.bewerbung_lesen', 'recruiting', 'bewerbung', 'lesen'::berechtigung_aktion, 'recruiting.bewerbung_lesen', false, 173),
  ('recruiting.daten_loeschen', 'recruiting', 'daten', 'loeschen'::berechtigung_aktion, 'recruiting.daten_loeschen', false, 174),
  ('recruiting.entscheiden', 'recruiting', 'recruiting', 'entscheiden'::berechtigung_aktion, 'recruiting.entscheiden', false, 175),
  ('recruiting.stelle_lesen', 'recruiting', 'stelle', 'lesen'::berechtigung_aktion, 'recruiting.stelle_lesen', false, 176),
  ('recruiting.stelle_schreiben', 'recruiting', 'stelle', 'schreiben'::berechtigung_aktion, 'recruiting.stelle_schreiben', false, 177),
  ('recruiting.stelle_veroeffentlichen', 'recruiting', 'stelle', 'veroeffentlichen'::berechtigung_aktion, 'recruiting.stelle_veroeffentlichen', false, 178),
  ('referenz.kundenfreigabe_erfassen', 'referenz', 'kundenfreigabe', 'erfassen'::berechtigung_aktion, 'referenz.kundenfreigabe_erfassen', false, 179),
  ('referenz.lesen', 'referenz', 'referenz', 'lesen'::berechtigung_aktion, 'referenz.lesen', false, 180),
  ('referenz.schreiben', 'referenz', 'referenz', 'schreiben'::berechtigung_aktion, 'referenz.schreiben', false, 181),
  ('referenz.veroeffentlichen', 'referenz', 'referenz', 'veroeffentlichen'::berechtigung_aktion, 'referenz.veroeffentlichen', false, 182),
  ('reinigung.lesen', 'reinigung', 'reinigung', 'lesen'::berechtigung_aktion, 'reinigung.lesen', false, 183),
  ('reinigung.schreiben', 'reinigung', 'reinigung', 'schreiben'::berechtigung_aktion, 'reinigung.schreiben', false, 184),
  ('schluessel.lesen', 'schluessel', 'schluessel', 'lesen'::berechtigung_aktion, 'schluessel.lesen', false, 185),
  ('schluessel.schreiben', 'schluessel', 'schluessel', 'schreiben'::berechtigung_aktion, 'schluessel.schreiben', false, 186),
  ('security.lesen', 'security', 'security', 'lesen'::berechtigung_aktion, 'security.lesen', false, 187),
  ('security.schreiben', 'security', 'security', 'schreiben'::berechtigung_aktion, 'security.schreiben', false, 188),
  ('social.freigeben', 'social', 'social', 'freigeben'::berechtigung_aktion, 'social.freigeben', false, 189),
  ('social.kanal_verbinden', 'social', 'kanal', 'verbinden'::berechtigung_aktion, 'social.kanal_verbinden', false, 190),
  ('social.lesen', 'social', 'social', 'lesen'::berechtigung_aktion, 'social.lesen', false, 191),
  ('social.planen', 'social', 'social', 'planen'::berechtigung_aktion, 'social.planen', false, 192),
  ('social.schreiben', 'social', 'social', 'schreiben'::berechtigung_aktion, 'social.schreiben', false, 193),
  ('stammdaten.verwalten', 'stammdaten', 'stammdaten', 'verwalten'::berechtigung_aktion, 'stammdaten.verwalten', false, 194),
  ('system.audit_exportieren', 'system', 'audit', 'exportieren'::berechtigung_aktion, 'system.audit_exportieren', false, 195),
  ('system.audit_lesen', 'system', 'audit', 'lesen'::berechtigung_aktion, 'system.audit_lesen', false, 196),
  ('system.audit_sensitiv_lesen', 'system', 'audit_sensitiv', 'lesen'::berechtigung_aktion, 'system.audit_sensitiv_lesen', false, 197),
  ('system.benutzer_lesen', 'system', 'benutzer', 'lesen'::berechtigung_aktion, 'system.benutzer_lesen', false, 198),
  ('system.benutzer_verwalten', 'system', 'benutzer', 'verwalten'::berechtigung_aktion, 'system.benutzer_verwalten', false, 199),
  ('system.betrieb_lesen', 'system', 'betrieb', 'lesen'::berechtigung_aktion, 'system.betrieb_lesen', false, 200),
  ('system.einstellung_lesen', 'system', 'einstellung', 'lesen'::berechtigung_aktion, 'system.einstellung_lesen', false, 201),
  ('system.einstellung_verwalten', 'system', 'einstellung', 'verwalten'::berechtigung_aktion, 'system.einstellung_verwalten', false, 202),
  ('system.feed_token_widerrufen', 'system', 'feed_token', 'widerrufen'::berechtigung_aktion, 'system.feed_token_widerrufen', false, 203),
  ('system.identitaet_verwalten', 'system', 'identitaet', 'verwalten'::berechtigung_aktion, 'system.identitaet_verwalten', false, 204),
  ('system.mandant_lesen', 'system', 'mandant', 'lesen'::berechtigung_aktion, 'system.mandant_lesen', false, 205),
  ('system.mandant_verwalten', 'system', 'mandant', 'verwalten'::berechtigung_aktion, 'system.mandant_verwalten', true, 206),
  ('system.module_zuweisen', 'system', 'module', 'zuweisen'::berechtigung_aktion, 'system.module_zuweisen', false, 207),
  ('system.protokoll_lesen', 'system', 'protokoll', 'lesen'::berechtigung_aktion, 'system.protokoll_lesen', false, 208),
  ('system.referenzdaten_verwalten', 'system', 'referenzdaten', 'verwalten'::berechtigung_aktion, 'system.referenzdaten_verwalten', false, 209),
  ('system.rolle_lesen', 'system', 'rolle', 'lesen'::berechtigung_aktion, 'system.rolle_lesen', false, 210),
  ('system.rolle_verwalten', 'system', 'rolle', 'verwalten'::berechtigung_aktion, 'system.rolle_verwalten', false, 211),
  ('system.sitzung_lesen', 'system', 'sitzung', 'lesen'::berechtigung_aktion, 'system.sitzung_lesen', false, 212),
  ('system.sitzung_widerrufen', 'system', 'sitzung', 'widerrufen'::berechtigung_aktion, 'system.sitzung_widerrufen', false, 213),
  ('system.verwaltungskonto_erstellen', 'system', 'verwaltungskonto', 'erstellen'::berechtigung_aktion, 'system.verwaltungskonto_erstellen', true, 214),
  ('system.zwei_faktor_zuruecksetzen', 'system', 'zwei_faktor', 'zuruecksetzen'::berechtigung_aktion, 'system.zwei_faktor_zuruecksetzen', true, 215),
  ('vergabe.einreichung_erfassen', 'vergabe', 'einreichung', 'erfassen'::berechtigung_aktion, 'vergabe.einreichung_erfassen', false, 216),
  ('vergabe.lesen', 'vergabe', 'vergabe', 'lesen'::berechtigung_aktion, 'vergabe.lesen', false, 217),
  ('vergabe.schreiben', 'vergabe', 'vergabe', 'schreiben'::berechtigung_aktion, 'vergabe.schreiben', false, 218),
  ('versand.freigeben', 'versand', 'versand', 'freigeben'::berechtigung_aktion, 'versand.freigeben', false, 219),
  ('versand.lesen', 'versand', 'versand', 'lesen'::berechtigung_aktion, 'versand.lesen', false, 220),
  ('wachbuch.lesen', 'wachbuch', 'wachbuch', 'lesen'::berechtigung_aktion, 'wachbuch.lesen', false, 221),
  ('wachbuch.schreiben', 'wachbuch', 'wachbuch', 'schreiben'::berechtigung_aktion, 'wachbuch.schreiben', false, 222),
  ('wissen.lesen', 'wissen', 'wissen', 'lesen'::berechtigung_aktion, 'wissen.lesen', false, 223),
  ('wissen.vertraulich_lesen', 'wissen', 'vertraulich', 'lesen'::berechtigung_aktion, 'wissen.vertraulich_lesen', false, 224),
  ('zahlung.lesen', 'zahlung', 'zahlung', 'lesen'::berechtigung_aktion, 'zahlung.lesen', false, 225),
  ('zahlung.schreiben', 'zahlung', 'zahlung', 'schreiben'::berechtigung_aktion, 'zahlung.schreiben', false, 226),
  ('zeit.abrechnung_freigeben', 'zeit', 'abrechnung', 'freigeben'::berechtigung_aktion, 'zeit.abrechnung_freigeben', false, 227),
  ('zeit.abwesenheit_genehmigen', 'zeit', 'abwesenheit', 'genehmigen'::berechtigung_aktion, 'zeit.abwesenheit_genehmigen', false, 228),
  ('zeit.abwesenheit_grund_lesen', 'zeit', 'abwesenheit_grund', 'lesen'::berechtigung_aktion, 'zeit.abwesenheit_grund_lesen', false, 229),
  ('zeit.abwesenheit_lesen', 'zeit', 'abwesenheit', 'lesen'::berechtigung_aktion, 'zeit.abwesenheit_lesen', false, 230),
  ('zeit.abwesenheit_melden', 'zeit', 'abwesenheit', 'melden'::berechtigung_aktion, 'zeit.abwesenheit_melden', false, 231),
  ('zeit.antrag_entscheiden', 'zeit', 'antrag', 'entscheiden'::berechtigung_aktion, 'zeit.antrag_entscheiden', false, 232),
  ('zeit.checkin_verwalten', 'zeit', 'checkin', 'verwalten'::berechtigung_aktion, 'zeit.checkin_verwalten', false, 233),
  ('zeit.einwand_entscheiden', 'zeit', 'einwand', 'entscheiden'::berechtigung_aktion, 'zeit.einwand_entscheiden', false, 234),
  ('zeit.exportieren', 'zeit', 'zeit', 'exportieren'::berechtigung_aktion, 'zeit.exportieren', false, 235),
  ('zeit.konto_abschliessen', 'zeit', 'konto', 'abschliessen'::berechtigung_aktion, 'zeit.konto_abschliessen', false, 236),
  ('zeit.konto_korrigieren', 'zeit', 'konto', 'korrigieren'::berechtigung_aktion, 'zeit.konto_korrigieren', false, 237),
  ('zeit.konto_lesen', 'zeit', 'konto', 'lesen'::berechtigung_aktion, 'zeit.konto_lesen', false, 238),
  ('zeit.korrigieren', 'zeit', 'zeit', 'korrigieren'::berechtigung_aktion, 'zeit.korrigieren', false, 239),
  ('zeit.lesen', 'zeit', 'zeit', 'lesen'::berechtigung_aktion, 'zeit.lesen', false, 240),
  ('zeit.nacherfassung_pruefen', 'zeit', 'nacherfassung', 'pruefen'::berechtigung_aktion, 'zeit.nacherfassung_pruefen', false, 241),
  ('zeit.schreiben', 'zeit', 'zeit', 'schreiben'::berechtigung_aktion, 'zeit.schreiben', false, 242);

insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
select r.id, b.id, null, true from (values
  ('super_admin', 'abrechnung.freistellung_pflegen'),
  ('admin', 'abrechnung.freistellung_pflegen'),
  ('super_admin', 'abrechnung.lesen'),
  ('admin', 'abrechnung.lesen'),
  ('super_admin', 'abrechnung.schreiben'),
  ('admin', 'abrechnung.schreiben'),
  ('super_admin', 'agent.aufgabe_starten'),
  ('admin', 'agent.aufgabe_starten'),
  ('leitung', 'agent.aufgabe_starten'),
  ('super_admin', 'agent.autonomie_setzen'),
  ('super_admin', 'agent.budget_verwalten'),
  ('super_admin', 'agent.lesen'),
  ('admin', 'agent.lesen'),
  ('leitung', 'agent.lesen'),
  ('super_admin', 'agent.protokoll_lesen'),
  ('super_admin', 'agent.richtlinie_verwalten'),
  ('super_admin', 'agent.werkzeug_verbinden'),
  ('super_admin', 'angebot.annahme_erfassen'),
  ('admin', 'angebot.annahme_erfassen'),
  ('leitung', 'angebot.annahme_erfassen'),
  ('super_admin', 'angebot.lesen'),
  ('admin', 'angebot.lesen'),
  ('leitung', 'angebot.lesen'),
  ('kunde', 'angebot.lesen'),
  ('super_admin', 'angebot.preis_freigeben'),
  ('leitung', 'angebot.preis_freigeben'),
  ('super_admin', 'angebot.schreiben'),
  ('admin', 'angebot.schreiben'),
  ('leitung', 'angebot.schreiben'),
  ('super_admin', 'angebot.versenden'),
  ('admin', 'angebot.versenden'),
  ('leitung', 'angebot.versenden'),
  ('super_admin', 'aufgabe.lesen'),
  ('admin', 'aufgabe.lesen'),
  ('leitung', 'aufgabe.lesen'),
  ('super_admin', 'aufgabe.schreiben'),
  ('admin', 'aufgabe.schreiben'),
  ('leitung', 'aufgabe.schreiben'),
  ('mitarbeiter', 'aufgabe.schreiben'),
  ('super_admin', 'aufgabe.zuweisen'),
  ('admin', 'aufgabe.zuweisen'),
  ('leitung', 'aufgabe.zuweisen'),
  ('super_admin', 'auftrag.abschliessen'),
  ('admin', 'auftrag.abschliessen'),
  ('leitung', 'auftrag.abschliessen'),
  ('super_admin', 'auftrag.lesen'),
  ('admin', 'auftrag.lesen'),
  ('leitung', 'auftrag.lesen'),
  ('kunde', 'auftrag.lesen'),
  ('super_admin', 'auftrag.schreiben'),
  ('admin', 'auftrag.schreiben'),
  ('leitung', 'auftrag.schreiben'),
  ('super_admin', 'bau.aufmass_erfassen'),
  ('admin', 'bau.aufmass_erfassen'),
  ('leitung', 'bau.aufmass_erfassen'),
  ('mitarbeiter', 'bau.aufmass_erfassen'),
  ('super_admin', 'bau.aufmass_freigeben'),
  ('admin', 'bau.aufmass_freigeben'),
  ('leitung', 'bau.aufmass_freigeben'),
  ('super_admin', 'bau.behinderung_erstellen'),
  ('admin', 'bau.behinderung_erstellen'),
  ('leitung', 'bau.behinderung_erstellen'),
  ('super_admin', 'bau.lesen'),
  ('admin', 'bau.lesen'),
  ('leitung', 'bau.lesen'),
  ('kunde', 'bau.lesen'),
  ('super_admin', 'bau.nachtrag_anmelden'),
  ('admin', 'bau.nachtrag_anmelden'),
  ('leitung', 'bau.nachtrag_anmelden'),
  ('super_admin', 'bau.nachtrag_einreichen'),
  ('admin', 'bau.nachtrag_einreichen'),
  ('leitung', 'bau.nachtrag_einreichen'),
  ('super_admin', 'bau.preis_lesen'),
  ('admin', 'bau.preis_lesen'),
  ('super_admin', 'bau.schreiben'),
  ('admin', 'bau.schreiben'),
  ('leitung', 'bau.schreiben'),
  ('super_admin', 'bericht.dashboard_lesen'),
  ('admin', 'bericht.dashboard_lesen'),
  ('leitung', 'bericht.dashboard_lesen'),
  ('kunde', 'bericht.dashboard_lesen'),
  ('super_admin', 'bericht.exportieren'),
  ('admin', 'bericht.exportieren'),
  ('super_admin', 'bericht.lesen'),
  ('admin', 'bericht.lesen'),
  ('leitung', 'bericht.lesen'),
  ('super_admin', 'buchhaltung_konfiguration.lesen'),
  ('admin', 'buchhaltung_konfiguration.lesen'),
  ('super_admin', 'buchhaltung_konfiguration.verwalten'),
  ('super_admin', 'buchhaltung.exportieren'),
  ('admin', 'buchhaltung.exportieren'),
  ('super_admin', 'buchhaltung.festschreiben'),
  ('admin', 'buchhaltung.festschreiben'),
  ('super_admin', 'buchhaltung.lesen'),
  ('admin', 'buchhaltung.lesen'),
  ('super_admin', 'buchhaltung.schreiben'),
  ('admin', 'buchhaltung.schreiben'),
  ('super_admin', 'crm_entgelt.lesen'),
  ('admin', 'crm_entgelt.lesen'),
  ('super_admin', 'crm.exportieren'),
  ('super_admin', 'crm.kommunikation_versenden'),
  ('admin', 'crm.kommunikation_versenden'),
  ('leitung', 'crm.kommunikation_versenden'),
  ('super_admin', 'crm.lesen'),
  ('admin', 'crm.lesen'),
  ('leitung', 'crm.lesen'),
  ('super_admin', 'crm.rechtsgrundlage_lesen'),
  ('admin', 'crm.rechtsgrundlage_lesen'),
  ('super_admin', 'crm.rechtsgrundlage_setzen'),
  ('admin', 'crm.rechtsgrundlage_setzen'),
  ('super_admin', 'crm.schreiben'),
  ('admin', 'crm.schreiben'),
  ('leitung', 'crm.schreiben'),
  ('super_admin', 'datenschutz.auskunft_erstellen'),
  ('super_admin', 'datenschutz.berichtigung_bearbeiten'),
  ('super_admin', 'datenschutz.loeschung_pruefen'),
  ('super_admin', 'dienstanweisung.lesen'),
  ('admin', 'dienstanweisung.lesen'),
  ('leitung', 'dienstanweisung.lesen'),
  ('super_admin', 'dienstanweisung.schreiben'),
  ('admin', 'dienstanweisung.schreiben'),
  ('leitung', 'dienstanweisung.schreiben'),
  ('super_admin', 'dienstplan.arbzg_lesen'),
  ('admin', 'dienstplan.arbzg_lesen'),
  ('leitung', 'dienstplan.arbzg_lesen'),
  ('super_admin', 'dienstplan.arbzg_pruefen'),
  ('admin', 'dienstplan.arbzg_pruefen'),
  ('leitung', 'dienstplan.arbzg_pruefen'),
  ('super_admin', 'dienstplan.arbzg_uebersteuern'),
  ('super_admin', 'dienstplan.konflikt_quittieren'),
  ('admin', 'dienstplan.konflikt_quittieren'),
  ('leitung', 'dienstplan.konflikt_quittieren'),
  ('super_admin', 'dienstplan.lesen'),
  ('admin', 'dienstplan.lesen'),
  ('leitung', 'dienstplan.lesen'),
  ('super_admin', 'dienstplan.schreiben'),
  ('admin', 'dienstplan.schreiben'),
  ('leitung', 'dienstplan.schreiben'),
  ('super_admin', 'dienstplan.veroeffentlichen'),
  ('admin', 'dienstplan.veroeffentlichen'),
  ('leitung', 'dienstplan.veroeffentlichen'),
  ('super_admin', 'dokument.archivieren'),
  ('admin', 'dokument.archivieren'),
  ('leitung', 'dokument.archivieren'),
  ('super_admin', 'dokument.aufbewahrung_verwalten'),
  ('super_admin', 'dokument.buendel_exportieren'),
  ('admin', 'dokument.buendel_exportieren'),
  ('super_admin', 'dokument.kunde_freigeben'),
  ('admin', 'dokument.kunde_freigeben'),
  ('leitung', 'dokument.kunde_freigeben'),
  ('super_admin', 'dokument.lesen'),
  ('admin', 'dokument.lesen'),
  ('leitung', 'dokument.lesen'),
  ('kunde', 'dokument.lesen'),
  ('super_admin', 'dokument.schreiben'),
  ('admin', 'dokument.schreiben'),
  ('leitung', 'dokument.schreiben'),
  ('mitarbeiter', 'dokument.schreiben'),
  ('super_admin', 'eingang.freigeben'),
  ('admin', 'eingang.freigeben'),
  ('super_admin', 'eingang.lesen'),
  ('admin', 'eingang.lesen'),
  ('super_admin', 'eingang.schreiben'),
  ('admin', 'eingang.schreiben'),
  ('leitung', 'eingang.schreiben'),
  ('super_admin', 'finanzen.entwurf_verwerfen'),
  ('admin', 'finanzen.entwurf_verwerfen'),
  ('super_admin', 'finanzen.festschreiben'),
  ('admin', 'finanzen.festschreiben'),
  ('super_admin', 'finanzen.herunterladen'),
  ('admin', 'finanzen.herunterladen'),
  ('leitung', 'finanzen.herunterladen'),
  ('kunde', 'finanzen.herunterladen'),
  ('super_admin', 'finanzen.lesen'),
  ('admin', 'finanzen.lesen'),
  ('leitung', 'finanzen.lesen'),
  ('kunde', 'finanzen.lesen'),
  ('super_admin', 'finanzen.schreiben'),
  ('admin', 'finanzen.schreiben'),
  ('super_admin', 'finanzen.steuerfall_uebersteuern'),
  ('super_admin', 'finanzen.stornieren'),
  ('super_admin', 'formular.lesen'),
  ('admin', 'formular.lesen'),
  ('leitung', 'formular.lesen'),
  ('super_admin', 'formular.schreiben'),
  ('admin', 'formular.schreiben'),
  ('leitung', 'formular.schreiben'),
  ('super_admin', 'freigabe.alle_lesen'),
  ('super_admin', 'freigabe.einspruch_erheben'),
  ('super_admin', 'freigabe.entscheiden'),
  ('admin', 'freigabe.entscheiden'),
  ('leitung', 'freigabe.entscheiden'),
  ('super_admin', 'freigabe.lesen'),
  ('admin', 'freigabe.lesen'),
  ('leitung', 'freigabe.lesen'),
  ('super_admin', 'freigabe.pruefdauer_lesen'),
  ('super_admin', 'freigabe.rueckgaengig'),
  ('super_admin', 'freigabe.stapel_entscheiden'),
  ('super_admin', 'gruppe.abrechnung.lesen'),
  ('super_admin', 'gruppe.agent.lesen'),
  ('super_admin', 'gruppe.angebot.lesen'),
  ('super_admin', 'gruppe.aufgabe.lesen'),
  ('super_admin', 'gruppe.auftrag.lesen'),
  ('super_admin', 'gruppe.bau.lesen'),
  ('super_admin', 'gruppe.bericht.lesen'),
  ('super_admin', 'gruppe.buchhaltung_konfiguration.lesen'),
  ('super_admin', 'gruppe.buchhaltung.lesen'),
  ('super_admin', 'gruppe.crm_entgelt.lesen'),
  ('super_admin', 'gruppe.crm.lesen'),
  ('super_admin', 'gruppe.datenschutz.lesen'),
  ('super_admin', 'gruppe.dienstanweisung.lesen'),
  ('super_admin', 'gruppe.dienstplan.arbzg_lesen'),
  ('super_admin', 'gruppe.dienstplan.lesen'),
  ('super_admin', 'gruppe.dokument.lesen'),
  ('super_admin', 'gruppe.eingang.lesen'),
  ('super_admin', 'gruppe.finanzen.lesen'),
  ('super_admin', 'gruppe.formular.lesen'),
  ('super_admin', 'gruppe.freigabe.lesen'),
  ('super_admin', 'gruppe.kalender.lesen'),
  ('super_admin', 'gruppe.kalkulation.lesen'),
  ('super_admin', 'gruppe.katalog.lesen'),
  ('super_admin', 'gruppe.mahnung.lesen'),
  ('super_admin', 'gruppe.nachricht.lesen'),
  ('super_admin', 'gruppe.nachweis.lesen'),
  ('super_admin', 'gruppe.nummernkreis.lesen'),
  ('super_admin', 'gruppe.objekt_import.lesen'),
  ('super_admin', 'gruppe.objekt.lesen'),
  ('super_admin', 'gruppe.oeffentlich.lesen'),
  ('super_admin', 'gruppe.personal.lesen'),
  ('super_admin', 'gruppe.qualitaet.lesen'),
  ('super_admin', 'gruppe.radar.lesen'),
  ('super_admin', 'gruppe.recruiting.lesen'),
  ('super_admin', 'gruppe.referenz.lesen'),
  ('super_admin', 'gruppe.reinigung.lesen'),
  ('super_admin', 'gruppe.schluessel.lesen'),
  ('super_admin', 'gruppe.security.lesen'),
  ('super_admin', 'gruppe.social.lesen'),
  ('super_admin', 'gruppe.stammdaten.lesen'),
  ('super_admin', 'gruppe.system.audit_lesen'),
  ('super_admin', 'gruppe.system.lesen'),
  ('super_admin', 'gruppe.vergabe.lesen'),
  ('super_admin', 'gruppe.versand.lesen'),
  ('super_admin', 'gruppe.wachbuch.lesen'),
  ('super_admin', 'gruppe.wissen.lesen'),
  ('super_admin', 'gruppe.zahlung.lesen'),
  ('super_admin', 'gruppe.zeit.lesen'),
  ('super_admin', 'kalender.lesen'),
  ('admin', 'kalender.lesen'),
  ('leitung', 'kalender.lesen'),
  ('super_admin', 'kalender.schreiben'),
  ('admin', 'kalender.schreiben'),
  ('leitung', 'kalender.schreiben'),
  ('super_admin', 'kalkulation.lesen'),
  ('admin', 'kalkulation.lesen'),
  ('leitung', 'kalkulation.lesen'),
  ('super_admin', 'kalkulation.schreiben'),
  ('admin', 'kalkulation.schreiben'),
  ('leitung', 'kalkulation.schreiben'),
  ('super_admin', 'katalog.lesen'),
  ('admin', 'katalog.lesen'),
  ('leitung', 'katalog.lesen'),
  ('super_admin', 'katalog.schreiben'),
  ('admin', 'katalog.schreiben'),
  ('super_admin', 'mahnung.freigeben'),
  ('admin', 'mahnung.freigeben'),
  ('super_admin', 'mahnung.lesen'),
  ('admin', 'mahnung.lesen'),
  ('leitung', 'mahnung.lesen'),
  ('kunde', 'mahnung.lesen'),
  ('super_admin', 'mahnung.schreiben'),
  ('admin', 'mahnung.schreiben'),
  ('super_admin', 'nachricht.lesen'),
  ('admin', 'nachricht.lesen'),
  ('leitung', 'nachricht.lesen'),
  ('kunde', 'nachricht.lesen'),
  ('super_admin', 'nachricht.versenden'),
  ('admin', 'nachricht.versenden'),
  ('leitung', 'nachricht.versenden'),
  ('mitarbeiter', 'nachricht.versenden'),
  ('super_admin', 'nachweis.lesen'),
  ('admin', 'nachweis.lesen'),
  ('leitung', 'nachweis.lesen'),
  ('kunde', 'nachweis.lesen'),
  ('super_admin', 'nachweis.preis_lesen'),
  ('admin', 'nachweis.preis_lesen'),
  ('super_admin', 'nachweis.schreiben'),
  ('admin', 'nachweis.schreiben'),
  ('leitung', 'nachweis.schreiben'),
  ('mitarbeiter', 'nachweis.schreiben'),
  ('super_admin', 'nummernkreis.lesen'),
  ('admin', 'nummernkreis.lesen'),
  ('leitung', 'nummernkreis.lesen'),
  ('super_admin', 'nummernkreis.verwalten'),
  ('super_admin', 'nummernkreis.ziehen'),
  ('admin', 'nummernkreis.ziehen'),
  ('leitung', 'nummernkreis.ziehen'),
  ('super_admin', 'objekt_import.lesen'),
  ('admin', 'objekt_import.lesen'),
  ('leitung', 'objekt_import.lesen'),
  ('super_admin', 'objekt_import.schreiben'),
  ('admin', 'objekt_import.schreiben'),
  ('leitung', 'objekt_import.schreiben'),
  ('super_admin', 'objekt.lesen'),
  ('admin', 'objekt.lesen'),
  ('leitung', 'objekt.lesen'),
  ('kunde', 'objekt.lesen'),
  ('super_admin', 'objekt.schreiben'),
  ('admin', 'objekt.schreiben'),
  ('leitung', 'objekt.schreiben'),
  ('super_admin', 'oeffentlich.lesen'),
  ('super_admin', 'personal.aendern'),
  ('admin', 'personal.aendern'),
  ('leitung', 'personal.aendern'),
  ('super_admin', 'personal.anstellung_beenden'),
  ('admin', 'personal.anstellung_beenden'),
  ('leitung', 'personal.anstellung_beenden'),
  ('super_admin', 'personal.bewacher_verwalten'),
  ('admin', 'personal.bewacher_verwalten'),
  ('leitung', 'personal.bewacher_verwalten'),
  ('super_admin', 'personal.entgelt_lesen'),
  ('super_admin', 'personal.entgelt_schreiben'),
  ('super_admin', 'personal.erstattung_lesen'),
  ('admin', 'personal.erstattung_lesen'),
  ('super_admin', 'personal.erstellen'),
  ('admin', 'personal.erstellen'),
  ('leitung', 'personal.erstellen'),
  ('super_admin', 'personal.lesen'),
  ('admin', 'personal.lesen'),
  ('leitung', 'personal.lesen'),
  ('super_admin', 'personal.nachweis_lesen'),
  ('admin', 'personal.nachweis_lesen'),
  ('leitung', 'personal.nachweis_lesen'),
  ('super_admin', 'personal.nachweis_verwalten'),
  ('admin', 'personal.nachweis_verwalten'),
  ('leitung', 'personal.nachweis_verwalten'),
  ('super_admin', 'personal.schreiben'),
  ('admin', 'personal.schreiben'),
  ('leitung', 'personal.schreiben'),
  ('super_admin', 'personal.stammdaten_lesen'),
  ('admin', 'personal.stammdaten_lesen'),
  ('super_admin', 'personal.zugang_verwalten'),
  ('admin', 'personal.zugang_verwalten'),
  ('super_admin', 'personal.zusammenfuehren'),
  ('super_admin', 'qualitaet.lesen'),
  ('admin', 'qualitaet.lesen'),
  ('leitung', 'qualitaet.lesen'),
  ('kunde', 'qualitaet.lesen'),
  ('super_admin', 'qualitaet.schreiben'),
  ('admin', 'qualitaet.schreiben'),
  ('leitung', 'qualitaet.schreiben'),
  ('super_admin', 'radar.lesen'),
  ('admin', 'radar.lesen'),
  ('leitung', 'radar.lesen'),
  ('super_admin', 'radar.plattform_verwalten'),
  ('admin', 'radar.plattform_verwalten'),
  ('super_admin', 'radar.profil_schreiben'),
  ('admin', 'radar.profil_schreiben'),
  ('leitung', 'radar.profil_schreiben'),
  ('super_admin', 'radar.status_setzen'),
  ('admin', 'radar.status_setzen'),
  ('leitung', 'radar.status_setzen'),
  ('super_admin', 'recruiting.bewerbung_bewerten'),
  ('admin', 'recruiting.bewerbung_bewerten'),
  ('leitung', 'recruiting.bewerbung_bewerten'),
  ('super_admin', 'recruiting.bewerbung_lesen'),
  ('admin', 'recruiting.bewerbung_lesen'),
  ('leitung', 'recruiting.bewerbung_lesen'),
  ('super_admin', 'recruiting.daten_loeschen'),
  ('admin', 'recruiting.daten_loeschen'),
  ('super_admin', 'recruiting.entscheiden'),
  ('admin', 'recruiting.entscheiden'),
  ('leitung', 'recruiting.entscheiden'),
  ('super_admin', 'recruiting.stelle_lesen'),
  ('admin', 'recruiting.stelle_lesen'),
  ('leitung', 'recruiting.stelle_lesen'),
  ('super_admin', 'recruiting.stelle_schreiben'),
  ('admin', 'recruiting.stelle_schreiben'),
  ('leitung', 'recruiting.stelle_schreiben'),
  ('super_admin', 'recruiting.stelle_veroeffentlichen'),
  ('admin', 'recruiting.stelle_veroeffentlichen'),
  ('super_admin', 'referenz.kundenfreigabe_erfassen'),
  ('admin', 'referenz.kundenfreigabe_erfassen'),
  ('leitung', 'referenz.kundenfreigabe_erfassen'),
  ('super_admin', 'referenz.lesen'),
  ('admin', 'referenz.lesen'),
  ('leitung', 'referenz.lesen'),
  ('super_admin', 'referenz.schreiben'),
  ('admin', 'referenz.schreiben'),
  ('super_admin', 'referenz.veroeffentlichen'),
  ('super_admin', 'reinigung.lesen'),
  ('admin', 'reinigung.lesen'),
  ('leitung', 'reinigung.lesen'),
  ('super_admin', 'reinigung.schreiben'),
  ('admin', 'reinigung.schreiben'),
  ('leitung', 'reinigung.schreiben'),
  ('super_admin', 'schluessel.lesen'),
  ('admin', 'schluessel.lesen'),
  ('leitung', 'schluessel.lesen'),
  ('super_admin', 'schluessel.schreiben'),
  ('admin', 'schluessel.schreiben'),
  ('leitung', 'schluessel.schreiben'),
  ('mitarbeiter', 'schluessel.schreiben'),
  ('super_admin', 'security.lesen'),
  ('admin', 'security.lesen'),
  ('leitung', 'security.lesen'),
  ('super_admin', 'security.schreiben'),
  ('admin', 'security.schreiben'),
  ('leitung', 'security.schreiben'),
  ('super_admin', 'social.freigeben'),
  ('admin', 'social.freigeben'),
  ('super_admin', 'social.kanal_verbinden'),
  ('super_admin', 'social.lesen'),
  ('admin', 'social.lesen'),
  ('leitung', 'social.lesen'),
  ('super_admin', 'social.planen'),
  ('admin', 'social.planen'),
  ('super_admin', 'social.schreiben'),
  ('admin', 'social.schreiben'),
  ('leitung', 'social.schreiben'),
  ('super_admin', 'stammdaten.verwalten'),
  ('admin', 'stammdaten.verwalten'),
  ('leitung', 'stammdaten.verwalten'),
  ('super_admin', 'system.audit_exportieren'),
  ('super_admin', 'system.audit_lesen'),
  ('super_admin', 'system.audit_sensitiv_lesen'),
  ('super_admin', 'system.benutzer_lesen'),
  ('admin', 'system.benutzer_lesen'),
  ('leitung', 'system.benutzer_lesen'),
  ('super_admin', 'system.benutzer_verwalten'),
  ('admin', 'system.benutzer_verwalten'),
  ('super_admin', 'system.betrieb_lesen'),
  ('admin', 'system.betrieb_lesen'),
  ('super_admin', 'system.einstellung_lesen'),
  ('super_admin', 'system.einstellung_verwalten'),
  ('super_admin', 'system.feed_token_widerrufen'),
  ('admin', 'system.feed_token_widerrufen'),
  ('super_admin', 'system.identitaet_verwalten'),
  ('super_admin', 'system.mandant_lesen'),
  ('admin', 'system.mandant_lesen'),
  ('leitung', 'system.mandant_lesen'),
  ('super_admin', 'system.mandant_verwalten'),
  ('super_admin', 'system.module_zuweisen'),
  ('super_admin', 'system.protokoll_lesen'),
  ('admin', 'system.protokoll_lesen'),
  ('super_admin', 'system.referenzdaten_verwalten'),
  ('super_admin', 'system.rolle_lesen'),
  ('super_admin', 'system.rolle_verwalten'),
  ('super_admin', 'system.sitzung_lesen'),
  ('admin', 'system.sitzung_lesen'),
  ('super_admin', 'system.sitzung_widerrufen'),
  ('admin', 'system.sitzung_widerrufen'),
  ('super_admin', 'system.verwaltungskonto_erstellen'),
  ('super_admin', 'system.zwei_faktor_zuruecksetzen'),
  ('super_admin', 'vergabe.einreichung_erfassen'),
  ('admin', 'vergabe.einreichung_erfassen'),
  ('leitung', 'vergabe.einreichung_erfassen'),
  ('super_admin', 'vergabe.lesen'),
  ('admin', 'vergabe.lesen'),
  ('leitung', 'vergabe.lesen'),
  ('super_admin', 'vergabe.schreiben'),
  ('admin', 'vergabe.schreiben'),
  ('leitung', 'vergabe.schreiben'),
  ('super_admin', 'versand.freigeben'),
  ('admin', 'versand.freigeben'),
  ('super_admin', 'versand.lesen'),
  ('admin', 'versand.lesen'),
  ('leitung', 'versand.lesen'),
  ('super_admin', 'wachbuch.lesen'),
  ('admin', 'wachbuch.lesen'),
  ('leitung', 'wachbuch.lesen'),
  ('super_admin', 'wachbuch.schreiben'),
  ('leitung', 'wachbuch.schreiben'),
  ('mitarbeiter', 'wachbuch.schreiben'),
  ('super_admin', 'wissen.lesen'),
  ('admin', 'wissen.lesen'),
  ('leitung', 'wissen.lesen'),
  ('super_admin', 'wissen.vertraulich_lesen'),
  ('super_admin', 'zahlung.lesen'),
  ('admin', 'zahlung.lesen'),
  ('leitung', 'zahlung.lesen'),
  ('kunde', 'zahlung.lesen'),
  ('super_admin', 'zahlung.schreiben'),
  ('admin', 'zahlung.schreiben'),
  ('super_admin', 'zeit.abrechnung_freigeben'),
  ('admin', 'zeit.abrechnung_freigeben'),
  ('super_admin', 'zeit.abwesenheit_genehmigen'),
  ('admin', 'zeit.abwesenheit_genehmigen'),
  ('leitung', 'zeit.abwesenheit_genehmigen'),
  ('super_admin', 'zeit.abwesenheit_grund_lesen'),
  ('admin', 'zeit.abwesenheit_grund_lesen'),
  ('super_admin', 'zeit.abwesenheit_lesen'),
  ('admin', 'zeit.abwesenheit_lesen'),
  ('leitung', 'zeit.abwesenheit_lesen'),
  ('super_admin', 'zeit.abwesenheit_melden'),
  ('admin', 'zeit.abwesenheit_melden'),
  ('leitung', 'zeit.abwesenheit_melden'),
  ('mitarbeiter', 'zeit.abwesenheit_melden'),
  ('super_admin', 'zeit.antrag_entscheiden'),
  ('admin', 'zeit.antrag_entscheiden'),
  ('leitung', 'zeit.antrag_entscheiden'),
  ('super_admin', 'zeit.checkin_verwalten'),
  ('admin', 'zeit.checkin_verwalten'),
  ('leitung', 'zeit.checkin_verwalten'),
  ('super_admin', 'zeit.einwand_entscheiden'),
  ('admin', 'zeit.einwand_entscheiden'),
  ('leitung', 'zeit.einwand_entscheiden'),
  ('super_admin', 'zeit.exportieren'),
  ('admin', 'zeit.exportieren'),
  ('super_admin', 'zeit.konto_abschliessen'),
  ('admin', 'zeit.konto_abschliessen'),
  ('leitung', 'zeit.konto_abschliessen'),
  ('super_admin', 'zeit.konto_korrigieren'),
  ('super_admin', 'zeit.konto_lesen'),
  ('admin', 'zeit.konto_lesen'),
  ('leitung', 'zeit.konto_lesen'),
  ('super_admin', 'zeit.korrigieren'),
  ('admin', 'zeit.korrigieren'),
  ('leitung', 'zeit.korrigieren'),
  ('super_admin', 'zeit.lesen'),
  ('admin', 'zeit.lesen'),
  ('leitung', 'zeit.lesen'),
  ('super_admin', 'zeit.nacherfassung_pruefen'),
  ('admin', 'zeit.nacherfassung_pruefen'),
  ('leitung', 'zeit.nacherfassung_pruefen'),
  ('super_admin', 'zeit.schreiben'),
  ('admin', 'zeit.schreiben'),
  ('leitung', 'zeit.schreiben')
) as v(rolle, schluessel)
join rolle r on r.schluessel = v.rolle and r.mandant_id is null
join berechtigung b on b.schluessel = v.schluessel;

-- >>> Ende des generierten Katalogs

-- ---------------------------------------------------------------------------
-- app.hat_recht — jetzt echt. Bis hierher antwortete sie auf jeden Schlüssel
-- `false` (D-23, fail closed); ab hier löst sie gegen den Katalog auf.
-- ---------------------------------------------------------------------------

/**
 * Hält der angemeldete Benutzer `p_schluessel` in `p_mandant`?
 *
 * Die Auflösung in Reihenfolge, und jede Stufe hat einen Grund:
 *
 *  1. **Unbekannter Schlüssel → false** (K-19, D-17). Ein Tippfehler ist ein
 *     dauerhaft leerer Bildschirm und keine Ausnahme. Das ist unbequem und
 *     Absicht: die Alternative wäre, dass ein falsch geschriebener Schlüssel
 *     irgendwo `true` ergibt.
 *  2. **`erfordert_2fa` → `app.aal()` muss `aal2` sein** (AUT-02). Der zweite
 *     Faktor gehört der Sitzung, nicht dem Konto.
 *  3. **Gruppenansicht: nur `lesen` und `exportieren`** (Invariante 10). Kein
 *     Schreibpfad läuft ohne genau einen aktiven Mandanten, und die
 *     Gruppenansicht hat per Konstruktion keinen.
 *  4. **`nur_global` → nur über die globale Rolle.**
 *  5. Die Bindung, **mandantenspezifisch vor Plattform-Vorgabe**: eine Zeile
 *     mit gesetztem `mandant_id` übersteuert die mit NULL. Das ist AUT-03 und
 *     der Grund, warum `gewaehrt` ein Boolean ist statt blosser Existenz —
 *     sonst liesse sich eine Vorgabe je Mandant nur erweitern, nie entziehen.
 */
create or replace function app.hat_recht(p_schluessel text, p_mandant uuid) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  v_recht     record;
  v_rolle     uuid;
  v_benutzer  uuid := app.aktueller_benutzer();
  v_gewaehrt  boolean;
begin
  if v_benutzer is null then return false; end if;

  select b.id, b.aktion, b.nur_global, b.erfordert_2fa into v_recht
    from public.berechtigung b where b.schluessel = p_schluessel;
  if not found then return false; end if;                    -- (1)

  if v_recht.erfordert_2fa and app.aal() <> 'aal2' then       -- (2)
    return false;
  end if;

  if app.ist_gruppenansicht()                                  -- (3)
     and v_recht.aktion not in ('lesen','exportieren') then
    return false;
  end if;

  -- Die globale Rolle: sie gilt in jedem Bereich, ohne Zuweisungszeile (TEN-08).
  select b.globale_rolle_id into v_rolle
    from public.benutzer b
   where b.id = v_benutzer and b.deaktiviert_am is null and b.status = 'aktiv';

  if v_rolle is not null then
    select rb.gewaehrt into v_gewaehrt
      from public.rolle_berechtigung rb
     where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id
       and rb.mandant_id is not distinct from p_mandant
     order by rb.mandant_id nulls last limit 1;
    if v_gewaehrt is null then
      select rb.gewaehrt into v_gewaehrt
        from public.rolle_berechtigung rb
       where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id and rb.mandant_id is null;
    end if;
    if v_gewaehrt then return true; end if;
  end if;

  if v_recht.nur_global then return false; end if;             -- (4)
  if p_mandant is null then return false; end if;

  -- Die Mitgliedschaftsrolle in genau diesem Bereich.
  select bm.rolle_id into v_rolle
    from public.benutzer_mandant bm
   where bm.benutzer_id = v_benutzer and bm.mandant_id = p_mandant
     and bm.entzogen_am is null
     and bm.gueltig_ab <= current_date
     and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
     -- AUT-01: eine Modulbeschränkung ist eine SCHNITTMENGE, kein Zusatz.
     and (bm.module is null or split_part(p_schluessel, '.', 1) = any (bm.module))
   limit 1;
  if v_rolle is null then return false; end if;

  -- (5) mandantenspezifisch schlägt Plattform-Vorgabe.
  select rb.gewaehrt into v_gewaehrt
    from public.rolle_berechtigung rb
   where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id
     and rb.mandant_id = p_mandant;
  if v_gewaehrt is not null then return v_gewaehrt; end if;

  select rb.gewaehrt into v_gewaehrt
    from public.rolle_berechtigung rb
   where rb.rolle_id = v_rolle and rb.berechtigung_id = v_recht.id and rb.mandant_id is null;

  return coalesce(v_gewaehrt, false);
end $$;

/** Die einstellige Form: gegen den aktiven Mandanten. */
create or replace function app.hat_recht(p_schluessel text) returns boolean
language sql stable as $$ select app.hat_recht(p_schluessel, app.aktiver_mandant()) $$;

grant execute on function app.hat_recht(text, uuid) to cse_app;
grant execute on function app.hat_recht(text) to cse_app;

-- ---------------------------------------------------------------------------
-- SEC-A3 / AUT-03 — der Editor darf nie mehr vergeben, als er selbst hält.
-- ---------------------------------------------------------------------------

/**
 * Eine Bindung anzulegen verlangt (a) `system.rolle_verwalten` in genau
 * diesem Bereich und (b) dass der Vergebende das Recht selbst hält.
 *
 * Ohne (b) ist der Editor eine Rechteerweiterung: wer Rechte verwalten darf,
 * gäbe sich damit jedes andere Recht — und AUT-03 wäre eine Hintertür statt
 * einer Verwaltung.
 */
create function kern.rolle_berechtigung_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_schluessel text; v_rolle text; v_anzahl int;
begin
  select b.schluessel into v_schluessel
    from public.berechtigung b where b.id = new.berechtigung_id;
  select r.schluessel into v_rolle from public.rolle r where r.id = new.rolle_id;

  /**
   * ZUERST der Aussperrschutz, und zwar auf JEDEM Weg — auch auf dem einer
   * Migration. `super_admin` ist die Rolle, über die Rechte überhaupt vergeben
   * werden; ihr eines zu entziehen ist dieselbe Aussperrung wie das Konto zu
   * deaktivieren, nur durch die andere Tür. Ein Seed, der das täte, wäre kein
   * Sonderfall, sondern derselbe Ausfall mit besserer Ausrede.
   */
  if not new.gewaehrt and v_rolle = 'super_admin' then
    raise exception 'Der super_admin kann sich Rechte nicht entziehen'
      using errcode = 'insufficient_privilege';
  end if;

  /**
   * Danach erst die Rechteprüfung — und die gilt nur für HANDELNDE. Ohne
   * angemeldeten Benutzer läuft kein Editor, sondern eine Migration oder ein
   * Seed; die haben keine Rolle, deren Rechte man prüfen könnte, und würden
   * an einer Prüfung gegen `app.hat_recht` immer scheitern.
   */
  if app.aktueller_benutzer() is null then
    return new;
  end if;

  if not app.hat_recht('system.rolle_verwalten', new.mandant_id) then
    raise exception 'Rechteverwaltung: system.rolle_verwalten fehlt in diesem Bereich'
      using errcode = 'insufficient_privilege';
  end if;

  if new.gewaehrt and not app.hat_recht(v_schluessel, new.mandant_id) then
    raise exception
      'Rechteverwaltung: % kann nicht vergeben werden — der Vergebende hält es selbst nicht (SEC-A3)',
      v_schluessel
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

create trigger trg_rolle_berechtigung_pruefen
  before insert or update on rolle_berechtigung
  for each row execute function kern.rolle_berechtigung_pruefen();

/**
 * Der letzte `super_admin` kann nicht ausgesperrt werden (PR 7 Akzeptanz 5).
 *
 * Die Sperre greift auf dem Weg, auf dem sie tatsächlich passieren würde:
 * jemand deaktiviert das letzte Konto mit globaler Super-Admin-Rolle, oder
 * nimmt ihm die Rolle. Danach kann niemand mehr Rechte vergeben — auch nicht,
 * um den Fehler rückgängig zu machen, denn genau dafür braucht es die Rolle.
 */
create function kern.letzter_super_admin_schutz() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_uebrig int; v_sa uuid;
begin
  select r.id into v_sa from public.rolle r
   where r.schluessel = 'super_admin' and r.geltungsbereich = 'global';

  -- Dreiwertige Logik, sauber getrennt: `old.globale_rolle_id = v_sa` ist
  -- NULL, wenn die Spalte NULL ist — und `if not (NULL)` ist NULL, also nicht
  -- wahr, also läuft die Funktion weiter und sperrt ein Konto, das mit
  -- Super-Admin nie etwas zu tun hatte. `is distinct from` kennt kein NULL.
  if old.globale_rolle_id is distinct from v_sa then
    return new;
  end if;

  -- Sie ist Super-Admin. Verliert sie es durch dieses UPDATE?
  if new.globale_rolle_id is not distinct from v_sa
     and new.deaktiviert_am is null
     and new.status = 'aktiv' then
    return new;
  end if;

  select count(*) into v_uebrig from public.benutzer b
   where b.globale_rolle_id = v_sa and b.deaktiviert_am is null
     and b.status = 'aktiv' and b.id <> old.id;

  if v_uebrig = 0 then
    raise exception
      'Der letzte super_admin kann nicht deaktiviert oder entrollt werden — '
      'danach könnte niemand mehr Rechte vergeben, auch nicht, um es zurückzunehmen.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_letzter_super_admin
  before update on benutzer
  for each row execute function kern.letzter_super_admin_schutz();

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table berechtigung        enable row level security;
alter table berechtigung        force  row level security;
alter table rolle_berechtigung  enable row level security;
alter table rolle_berechtigung  force  row level security;

-- Der Katalog ist lesbar: der Rechte-Editor muss zeigen können, was es gibt.
create policy t_berechtigung_lesen on berechtigung for select to cse_app using (true);

create policy t_rb_lesen on rolle_berechtigung for select to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()));

create policy t_rb_schreiben on rolle_berechtigung for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and not app.ist_gruppenansicht()
              and app.hat_recht('system.rolle_verwalten', mandant_id));

create policy t_rb_aendern on rolle_berechtigung for update to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('system.rolle_verwalten', mandant_id))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('system.rolle_verwalten', mandant_id));

-- Der Schreibpfad trägt das aal2-Gate, restriktiv (K-15).
create policy p_rb_aal2 on rolle_berechtigung as restrictive for all to cse_app
  using (true) with check (app.aal() = 'aal2');

grant select on berechtigung to cse_app;
grant select, insert, update on rolle_berechtigung to cse_app;
