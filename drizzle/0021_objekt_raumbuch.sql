-- ---------------------------------------------------------------------------
-- 0021 — Objekte, Raumbuch und die zwei Kataloge dahinter (OPS-01..04).
--
-- **Diese Migration ist die Grundlage der Reinigungspreise.** `raum` und
-- `belagsart` zusammen sind alles, was OPS-02/03 braucht:
--
--     Σ (m² ÷ Leistungswert) × Frequenzfaktor
--
-- Zwei Entscheidungen darin sind nicht offensichtlich und kosten Geld, wenn
-- man sie falsch trifft:
--
--  1. **Der natuerliche Schluessel eines Raums ist (Objekt, Etage, Nummer)**,
--     nicht (Objekt, Nummer). "101" im Untergeschoss und "101" im ersten Stock
--     sind zwei Raeume. Faellt der zweite weg, fehlen seine m² in der Summe —
--     und heraus kommt ein systematisch ZU BILLIGES Angebot, das kein Test
--     bemerkt, weil die Rechnung an sich stimmt.
--
--  2. **Der Leistungswert ist ZEITLICH versioniert.** Wer ihn ueberschreibt,
--     rechnet ein unterschriebenes Angebot rueckwirkend neu. Ein neuer Wert
--     schliesst den alten (`gueltig_bis`) und legt eine Zeile an; ein
--     GiST-Ausschluss sorgt dafuer, dass "der Wert am Tag X" auch am
--     Wechseltag genau eine Antwort hat.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- belagsart — der Katalog, der aus Quadratmetern einen Preis macht.
-- ---------------------------------------------------------------------------

create table belagsart (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  code          text not null,
  bezeichnung   text not null,
  beschreibung  text,
  leistungswert_qm_pro_stunde numeric(10,3) not null,
  -- Ein Leistungswert ohne genannte Quelle laesst sich im Preisstreit nicht
  -- verteidigen. Deshalb `not null`.
  quelle        text not null,
  -- // TODO(client, O-17): Leistungswerte (m²/h) je Belagsart — aus welcher
  -- Quelle stammen sie, und gelten sie je Gesellschaft unterschiedlich?
  ist_platzhalter boolean not null default true,
  gueltig_ab    date not null,
  gueltig_bis   date,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint belagsart_mandant_uk unique (mandant_id, id),
  constraint belagsart_leistungswert_positiv check (leistungswert_qm_pro_stunde > 0),
  constraint belagsart_zeitraum_stimmig check (gueltig_bis is null or gueltig_bis >= gueltig_ab),

  /**
   * Genau EIN gueltiger Wert je Code und Tag — auch am Wechseltag.
   *
   * `gueltig_bis` ist EINSCHLIESSLICH (§0.7), der Bereich also
   * `[gueltig_ab, gueltig_bis + 1)`. Ohne diesen Ausschluss haette "der
   * Leistungswert am 1. Maerz" zwei Antworten, sobald jemand den neuen Satz
   * am selben Tag beginnen laesst, an dem der alte endet — und welche die
   * Kalkulation nimmt, entschiede die Zeilenreihenfolge.
   */
  constraint belagsart_zeitraum_eindeutig exclude using gist (
    mandant_id with =, code with =,
    daterange(gueltig_ab, coalesce(gueltig_bis + 1, 'infinity'::date), '[)') with &&)
);

create unique index belagsart_code_uk on belagsart (mandant_id, code)
  where gueltig_bis is null;
create index belagsart_historie_idx on belagsart (mandant_id, code, gueltig_ab desc);
create index belagsart_platzhalter_idx on belagsart (mandant_id) where ist_platzhalter;

-- ---------------------------------------------------------------------------
-- reinigungsklasse — ein Katalog, KEIN Enum.
-- ---------------------------------------------------------------------------

/**
 * Sie traegt ausdruecklich KEINEN Frequenzfaktor und KEINE Preiswirkung.
 *
 * Einen anzuhaengen hiesse, eine Preisregel zu erfinden (K-17). Wenn der
 * Mandant O-55 beantwortet, kommt der Faktor hierher — mit eigenem
 * `gueltig_ab`/`gueltig_bis` — und die Kalkulation liest ihn. Bis dahin ist
 * die Klasse eine Beschreibung dessen, was zu tun ist, und nichts weiter.
 */
create table reinigungsklasse (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  code          text not null,
  bezeichnung   text not null,
  beschreibung  text,
  sortierung    integer not null default 0,
  -- // TODO(client, O-55): Welche Reinigungsklassen werden verwendet (DIN
  -- 77400, eigenes Schema, kundenspezifisch)? Steuern sie Frequenz, Preis,
  -- beides oder nichts?
  ist_platzhalter boolean not null default true,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint reinigungsklasse_mandant_uk unique (mandant_id, id)
);

create unique index reinigungsklasse_code_uk on reinigungsklasse (mandant_id, code)
  where archiviert_am is null;
create index reinigungsklasse_sortierung_idx on reinigungsklasse (mandant_id, sortierung)
  where archiviert_am is null;

-- ---------------------------------------------------------------------------
-- objekt — ein Gebaeude oder Gelaende.
-- ---------------------------------------------------------------------------

create table objekt (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  /**
   * Nullbar mit Absicht: dasselbe Gebaeude wird zu Recht von zwei Kunden
   * derselben Gesellschaft beauftragt (Eigentuemer und Mieter), und ein
   * Veranstaltungsort (REQ-03) existiert, bevor es einen Kundenstamm gibt.
   * Ein Objekt ist ein ORT; die kaufmaennische Beziehung haengt am Auftrag.
   * // TODO(client, O-70): Wird ein Gebaeude, das fuer zwei Kunden derselben
   * Gesellschaft betreut wird, als ein Objekt oder als zwei gefuehrt?
   */
  kunde_id      uuid,
  objektnummer  text not null,
  bezeichnung   text not null,
  -- // TODO(client, O-69): Kontrolliertes Vokabular fuer Gebaeudetyp? Bis
  -- dahin freier Text, damit keine falsche Liste einbetoniert wird.
  gebaeudetyp   text,
  strasse       text not null,
  hausnummer    text,
  adresszusatz  text,
  plz           text not null,
  ort           text not null,
  land          char(2) not null default 'DE',
  geo_lat       numeric(9,6),
  geo_lon       numeric(9,6),
  ansprechpartner_id uuid,
  etagen_anzahl smallint,
  zutritt_hinweis text,
  bemerkung     text,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint objekt_mandant_uk unique (mandant_id, id),
  constraint objekt_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  /**
   * Der Ansprechpartner haengt am (Mandant, KUNDE, Kontakt) — nicht nur am
   * Mandanten. Das ist es, was einen Vor-Ort-Kontakt eines ANDEREN Kunden
   * nicht einfuegbar macht.
   */
  constraint objekt_ansprechpartner_fk
    foreign key (mandant_id, kunde_id, ansprechpartner_id)
    references ansprechpartner (mandant_id, kunde_id, id),
  constraint objekt_geo_vollstaendig check ((geo_lat is null) = (geo_lon is null)),
  constraint objekt_geo_lat_bereich check (geo_lat is null or geo_lat between -90 and 90),
  constraint objekt_geo_lon_bereich check (geo_lon is null or geo_lon between -180 and 180)
);

create unique index objekt_nummer_uk on objekt (mandant_id, objektnummer)
  where archiviert_am is null;
create index objekt_kunde_idx on objekt (mandant_id, kunde_id) where archiviert_am is null;
create index objekt_bezeichnung_trgm on objekt using gin (bezeichnung gin_trgm_ops);
create index objekt_ort_idx on objekt (mandant_id, plz, ort);
create index objekt_ohne_geo_idx on objekt (mandant_id)
  where geo_lat is null and archiviert_am is null;

-- ---------------------------------------------------------------------------
-- raum — eine Zeile des Raumbuchs.
-- ---------------------------------------------------------------------------

create table raum (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  objekt_id     uuid not null,
  /**
   * Nullbar: ein echtes Raumbuch enthaelt Flur, Treppenhaus, Aufzugsvorraum
   * und WC-Vorraum ohne Tuernummer. `NOT NULL` zwaenge den Importeur, eine zu
   * erfinden — und eine erfundene Nummer ist eine, die beim naechsten Import
   * anders erfunden wird.
   */
  raumnummer    text,
  bezeichnung   text,
  -- Text, nicht Zahl: "UG", "EG", "1", "ZG".
  etage         text,
  nutzungsart   text,
  flaeche_qm    numeric(12,3) not null,
  belagsart_id  uuid,
  reinigungsklasse_id uuid,
  -- CLN-05: Glasreinigung wird auf GLASflaeche gerechnet, nicht auf Bodenflaeche.
  fenster_flaeche_qm numeric(12,3),
  -- Der stabile Schluessel des Importeurs. Getrennt von der Tuernummer, damit
  -- Idempotenz nicht an einer Nummer haengt, die es nicht ueberall gibt.
  quell_schluessel text,
  bemerkung     text,
  sortierung    integer not null default 0,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint raum_mandant_uk unique (mandant_id, id),
  constraint raum_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint raum_belagsart_fk foreign key (mandant_id, belagsart_id)
    references belagsart (mandant_id, id),
  constraint raum_reinigungsklasse_fk foreign key (mandant_id, reinigungsklasse_id)
    references reinigungsklasse (mandant_id, id),
  constraint raum_flaeche_positiv check (flaeche_qm > 0),
  constraint raum_fensterflaeche_nicht_negativ
    check (fenster_flaeche_qm is null or fenster_flaeche_qm >= 0)
);

/**
 * (Objekt, Etage, Raumnummer) — und genau hier liegt der teure Fehler.
 *
 * `UNIQUE (objekt_id, raumnummer)` faellt "101" im UG mit "101" im 1. OG
 * zusammen. Jeder so verschmolzene Raum verliert seine m² aus
 * `Σ m² ÷ Leistungswert`, und heraus kommt ein systematisch zu billiges
 * Angebot — mit korrekter Rechnung, weshalb es niemandem auffaellt.
 */
create unique index raum_natuerlich_uk on raum (objekt_id, etage, raumnummer)
  where archiviert_am is null and raumnummer is not null;
create unique index raum_quelle_uk on raum (objekt_id, quell_schluessel)
  where quell_schluessel is not null and archiviert_am is null;
create index raum_liste_idx on raum (mandant_id, objekt_id, sortierung);
-- DIE Kalkulationsabfrage: Flaeche je Belagsart fuer ein Objekt.
create index raum_kalkulation_idx on raum (objekt_id, belagsart_id)
  include (flaeche_qm, fenster_flaeche_qm) where archiviert_am is null;
-- "Welche Raeume wuerde eine Aenderung dieses Leistungswerts neu bepreisen?"
create index raum_belagsart_idx on raum (belagsart_id);
create index raum_reinigungsklasse_idx on raum (mandant_id, reinigungsklasse_id);
