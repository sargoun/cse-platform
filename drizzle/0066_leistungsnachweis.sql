-- ===========================================================================
-- 0066 — Der Leistungsnachweis: Kopf, Positionen, Unterschrift
--        (CLN-04, SEC-05, BAU-02, FIN-05, FIN-07, FIN-18, TIM-08, TIM-09,
--         TIM-10, LEG-01, LEG-10, DOC-03, AUT-01, SEC-A9)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §5.6, §5.7, §5.8,
-- §1.8, §1.11, §1.15, §10.4, §13.1. Wo dieser Text und eine Konvention (K-nn)
-- auseinandergehen, gilt die Konvention.
--
-- Das ist das Dokument, das der Kunde vor Ort unterschreibt und aus dem
-- spaeter eine Rechnung abgeleitet wird. Es hat deshalb genau eine Aufgabe:
-- festzuhalten, WAS ANGEZEIGT WURDE, als unterschrieben wurde — nicht, was
-- heute in den Quelltabellen steht.
--
--   leistungsnachweis           Der Kopf: Zeitraum, Bezug, Status, Sperre.
--   leistungsnachweis_position  Die Zeilen mit Rueckverweis auf ihre Quelle,
--                               was FIN-07 aus einer Behauptung einen Join
--                               macht.
--   leistungsnachweis_signatur  Die Unterschrift: Name, SERVERZEIT, Ort, Bild
--                               — und ein unveraenderlicher JSONB-Abzug der
--                               Zeilen samt SHA-256 darueber.
--
-- Fuenf Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **Der Schnappschuss ist eine Kopie, kein Join** (§10.4). Wer die
--     unterschriebenen Zeilen zur Anzeigezeit aus `leistungsnachweis_position`
--     nachlaedt, zeigt den HEUTIGEN Stand — und der Kunde hat einen anderen
--     gesehen. Der Streitfall dreht sich um genau diese Differenz, also wird
--     kopiert, gehasht und nie wieder angefasst.
--
--  2. **`unterzeichnet_am` kommt vom Server, `geraete_zeit` steht daneben**
--     (Invariante 5, TIM-08). Nicht statt — daneben: die Behauptung des
--     Geraets ist selbst Beweismaterial, und ihre Abweichung wird abgeleitet,
--     nie ausgehandelt.
--
--  3. **Die Unterschriftstabelle hat keine UPDATE-Policy und keine
--     `geaendert_*`-Spalten.** Sie ist anfuegend. Ein Ausloeser weist jedes
--     UPDATE zurueck, damit auch der Eigentuemer nicht versehentlich
--     nachbessert.
--
--  4. **Positionen tragen KEINE Zeilensumme** (§10.3). `menge` und
--     `einzelpreis_cent` stehen da; das Produkt entsteht im getesteten Dienst.
--     Eine gespeicherte Summe ist eine zweite Wahrheit, die beim ersten
--     Nachlassrabatt auseinanderlaeuft.
--
--  5. **Der Kopfstatus wird auf die Kinder KOPIERT** (§1.8, §5.7). Die
--     Kundendecke darf nicht per Unterabfrage in den Kopf schauen; ohne die
--     kopierten Spalten saehe der Kunde entweder Entwurfszeilen oder gar
--     nichts.
--
-- NICHT in dieser Migration: der Fremdschluessel auf `sonderleistung` (0067),
-- auf `projekt` und `posten` (Bau- bzw. Security-Domaene) und auf
-- `aufmass_zeile` (Bau). Ein einspaltiger Ersatz waere nach K-16 ein
-- Pruefungsfehler; lieber gar keiner als der falsche.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.1)
-- ---------------------------------------------------------------------------

/**
 * Der Lebenslauf eines Nachweises. FORWARD-ONLY, durchgesetzt von
 * `kern.ln_status_uebergang()` weiter unten.
 *
 * `abgelehnt` ist ein Endzustand und kein Rueckweg nach `entwurf`: ein
 * abgelehnter Nachweis wird durch einen NEUEN ersetzt (`ersetzt_durch_id`),
 * damit die Ablehnung als Tatsache stehen bleibt. Wer stattdessen zurueck in
 * den Entwurf duerfte, koennte die Zeilen aendern, bis der Kunde
 * unterschreibt — und niemand saehe, dass er zweimal abgelehnt hat.
 */
create type leistungsnachweis_status as enum
  ('entwurf','vorgelegt','signiert','abgelehnt','storniert');

/**
 * Woher eine Zeile stammt (FIN-07). Vier Quellen plus `manuell`.
 *
 * `material` steht mit in der Liste, obwohl es die Tabelle
 * `materialverbrauch` noch nicht gibt (§2.2). Der Wert jetzt aufzunehmen
 * kostet nichts; ihn spaeter nachzutragen hiesse `ALTER TYPE` in einer
 * Migration, die sonst nur eine Tabelle anlegt.
 */
create type leistungsnachweis_quelle as enum
  ('zeiteintrag','aufmass_zeile','leistungskatalog','material','manuell');

/**
 * Wer unterschreibt. Zwei Rollen, und die Unterscheidung ist rechtlich:
 *
 * Der `auftraggeber` ist der Kunde — seine Unterschrift ist die Abnahme der
 * Leistung. Der `auftragnehmer` sind wir; seine Unterschrift ist ein
 * BESCHAEFTIGTENDATUM, und nur an ihr haengt die Frage nach §87 Abs. 1 Nr. 6
 * BetrVG (O-06, siehe die Geo-Spalten unten).
 */
create type unterschrift_rolle as enum ('auftraggeber','auftragnehmer');

-- ---------------------------------------------------------------------------
-- 2. leistungsnachweis (§5.6)
-- ---------------------------------------------------------------------------

create table leistungsnachweis (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /**
   * Die Nummer wird beim Uebergang `entwurf → vorgelegt` aus dem
   * Nummernkreis gezogen (§2.1, `05-FINANZEN.md` §5.6) — ein Entwurf traegt
   * keine.
   *
   * LUECKENLOSIGKEIT WIRD HIER NICHT BEHAUPTET. FIN-03 verlangt sie fuer
   * Rechnungen, und nur dort ist sie durch `SELECT … FOR UPDATE` auf der
   * Zaehlerzeile auch erkauft. Ein abgelehnter und neu erstellter Nachweis
   * verbraucht dagegen eine Nummer, und der Kunde saehe nach Nr. 39 die
   * Nr. 41.
   * // TODO(client, O-147): Sollen Leistungsnachweise fortlaufend und
   * lueckenlos nummeriert sein, und ab welchem Schritt — Vorlage oder
   * Unterschrift?
   */
  nummer        text,

  -- Der Bezug. Genau einer der beiden Anker muss stehen (`ln_ein_anker`);
  -- die uebrigen praezisieren ihn.
  objekt_id     uuid,
  projekt_id    uuid,
  revier_id     uuid,
  posten_id     uuid,
  sonderleistung_id uuid,
  auftrag_leistung_id uuid,

  /**
   * Der Kunde steht als SPALTE da, nicht als Unterabfrage ueber `objekt`.
   *
   * Die Kundendecke aus §1.8 keyt auf diese Spalte. Eine Policy, die den
   * Kunden erst ueber den Objektbaum aufloest, laeuft je Zeile und faellt
   * ausserdem in `kunde`-Scope auf die Nase, weil dort `app.aktiver_mandant()`
   * NULL ist.
   */
  kunde_id      uuid not null,

  -- FIN-05: ohne Leistungszeitraum gibt es keine Rechnung. BERLINER
  -- Kalendertage (K-11), einschliessend.
  leistungszeitraum_von date not null,
  leistungszeitraum_bis date not null,

  status        leistungsnachweis_status not null default 'entwurf',
  -- Serverzeit (§1.11). Gestempelt beim Uebergang, nicht per Default.
  vorgelegt_am  timestamptz,
  abgelehnt_grund text,

  /**
   * Ab hier ist die Zeile eingefroren (§1.15). Gesetzt wird sie NICHT von
   * Hand, sondern vom Ausloeser auf `leistungsnachweis_signatur`: die Sperre
   * ist die Folge der Unterschrift, nicht eine Entscheidung daneben.
   */
  gesperrt_am   timestamptz,

  -- §1.14. `loeschsperre` steht auf `true`, weil ein Nachweis GoBD-relevant
  -- ist (LEG-01, Klasse `gobd_10j`, §11).
  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  -- §1.3: die Stornoseite. Korrigiert wird durch ERSETZEN, nie durch Aendern.
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint leistungsnachweis_mandant_uk unique (mandant_id, id),

  constraint ln_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint ln_revier_fk foreign key (mandant_id, revier_id)
    references revier (mandant_id, id),
  constraint ln_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint ln_auftrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint ln_ersetzt_fk foreign key (mandant_id, ersetzt_durch_id)
    references leistungsnachweis (mandant_id, id),

  -- Ein Nachweis ohne Ort ist keiner: er haengt an einem Objekt (Reinigung,
  -- Security) oder an einem Projekt (Bau).
  constraint ln_ein_anker check (objekt_id is not null or projekt_id is not null),
  constraint ln_zeitraum check (leistungszeitraum_bis >= leistungszeitraum_von),
  -- Eine Ablehnung ohne Grund ist keine Ablehnung, sondern ein Klick.
  constraint ln_ablehnung_begruendet check (
    status <> 'abgelehnt' or abgelehnt_grund is not null),
  -- Signiert heisst gesperrt. Die andere Richtung gilt nicht: storniert wird
  -- auch nach der Sperre noch.
  constraint ln_signiert_gesperrt check (status <> 'signiert' or gesperrt_am is not null),
  constraint ln_storno_paarweise check (
    (storniert_am is null) = (storniert_von is null)
    and (storniert_am is null or storno_grund is not null)),
  constraint ln_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- „Welche unterschriebenen Nachweise sind noch nicht abgerechnet?" (FIN-01,
-- FIN-18).
create index ln_abrechnung_idx
  on leistungsnachweis (mandant_id, auftrag_leistung_id, leistungszeitraum_bis)
  where status = 'signiert' and storniert_am is null;
-- Die Objektakte.
create index ln_objekt_zeitraum_idx
  on leistungsnachweis (mandant_id, objekt_id, leistungszeitraum_von desc);
-- Der Wachhund `job:ln_unsigniert`: „vorgelegt und seit X Tagen offen".
create index ln_offen_idx on leistungsnachweis (mandant_id, vorgelegt_am)
  where status = 'vorgelegt';
/**
 * Die Liste des Kundenportals — genau der Ausschnitt, den die Kundendecke
 * beschreibt. Ohne diesen Index laeuft die einzige Abfrage, die ein Kunde je
 * stellt, ueber die ganze Tabelle.
 */
create index ln_kunde_idx
  on leistungsnachweis (mandant_id, kunde_id, leistungszeitraum_bis desc)
  where status in ('vorgelegt','signiert') and storniert_am is null;
create unique index ln_nummer_uk on leistungsnachweis (mandant_id, nummer)
  where nummer is not null;

comment on table leistungsnachweis is
  'Der Leistungsnachweis (§5.6): das Dokument, das der Kunde vor Ort '
  'unterschreibt und aus dem die Abrechnung abgeleitet wird. Friert mit der '
  'Unterschrift ein (gesperrt_am).';
comment on column leistungsnachweis.nummer is
  'Aus dem Nummernkreis bei entwurf → vorgelegt. LUECKENLOSIGKEIT WIRD NICHT '
  'BEHAUPTET (O-147) — FIN-03 verlangt sie nur fuer Rechnungen.';

-- ---------------------------------------------------------------------------
-- 3. leistungsnachweis_position (§5.7)
-- ---------------------------------------------------------------------------

create table leistungsnachweis_position (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  leistungsnachweis_id uuid not null,

  /**
   * Vom Kopf heruntergeschrieben (`kern.ln_kunde_denormalisieren()`), nicht
   * vom Aufrufer gesetzt. Die Kundendecke keyt darauf (§1.8).
   */
  kunde_id      uuid not null,
  /**
   * Der Kopfzustand, KOPIERT (§5.7).
   *
   * §1.8 verbietet der Policy den Blick in den Kopf per Unterabfrage. Ohne
   * diese drei Spalten saehe der Kunde entweder Zeilen eines Nachweises, den
   * niemand vorgelegt hat, oder — wenn man die Bedingung schlicht weglaesst —
   * jede Entwurfszeile.
   */
  kopf_status   leistungsnachweis_status not null default 'entwurf',
  kopf_gesperrt_am timestamptz,
  kopf_storniert_am timestamptz,

  auftrag_leistung_id uuid,

  /**
   * DEFERRABLE INITIALLY IMMEDIATE: das Umsortieren der Zeilen in der
   * Oberflaeche ist EINE Anweisung, kein Tanz um Zwischenwerte. „Immediate"
   * heisst dabei: normal geprueft, aber `set constraints … deferred`
   * innerhalb der Transaktion moeglich.
   */
  reihenfolge   smallint not null,

  -- Der Text, wie er auf dem Dokument steht. Nicht der Katalogtext von heute.
  bezeichnung   text not null,
  menge         numeric(12,3) not null,
  einheit       text not null,
  /**
   * Ganzzahlige Cent (Invariante 1). KEINE Zeilensumme daneben (§10.3): das
   * Produkt rechnet der getestete Dienst, und eine gespeicherte Summe waere
   * eine zweite Wahrheit.
   *
   * Spaltenbeschraenkt (§1.9): der Preis ist nicht jedermanns Sache.
   */
  einzelpreis_cent bigint,

  quelle        leistungsnachweis_quelle not null,
  zeiteintrag_id uuid,
  aufmass_zeile_id uuid,
  leistungskatalog_position_id uuid,
  -- Grenzverweis ohne Fremdschluessel: `materialverbrauch` hat noch keinen
  -- Eigentuemer (§2.2).
  materialverbrauch_id uuid,

  -- Das Ausfuehrungsfenster der Zeile. `timestamptz`, weil es Zeitpunkte
  -- sind und keine Kalendertage.
  leistung_von  timestamptz,
  leistung_bis  timestamptz,
  bemerkung     text,

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint lnp_mandant_uk unique (mandant_id, id),
  constraint lnp_reihenfolge_uk unique (leistungsnachweis_id, reihenfolge)
    deferrable initially immediate,

  constraint lnp_kopf_fk foreign key (mandant_id, leistungsnachweis_id)
    references leistungsnachweis (mandant_id, id),
  constraint lnp_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint lnp_auftrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  /**
   * DREISPALTIG (§1.4): Mandant, Auftragsleistung, Zeiteintrag. Der mittlere
   * Schluesselteil ist der Punkt — er sichert zu, dass die abgerechnete
   * Stunde zu DERSELBEN Auftragszeile gehoert wie die Nachweiszeile. Ohne ihn
   * liesse sich die Stunde eines anderen Auftrags unter diese Position
   * haengen, und FIN-07 waere eine Behauptung.
   */
  constraint lnp_zeiteintrag_fk foreign key (mandant_id, auftrag_leistung_id, zeiteintrag_id)
    references zeiteintrag (mandant_id, auftrag_leistung_id, id),
  constraint lnp_katalog_fk foreign key (mandant_id, leistungskatalog_position_id)
    references leistungskatalog_position (mandant_id, id),

  constraint lnp_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint lnp_einheit_gefuellt check (btrim(einheit) <> ''),
  -- Hoechstens EINE Quelle traegt die Zeile …
  constraint lnp_hoechstens_eine_quelle check (
    num_nonnulls(zeiteintrag_id, aufmass_zeile_id,
                 leistungskatalog_position_id, materialverbrauch_id) <= 1),
  -- … und die Quellenangabe kann nicht luegen.
  constraint lnp_quelle_zeiteintrag check (
    (quelle = 'zeiteintrag') = (zeiteintrag_id is not null)),
  constraint lnp_quelle_aufmass check (
    (quelle = 'aufmass_zeile') = (aufmass_zeile_id is not null)),
  constraint lnp_quelle_katalog check (
    (quelle = 'leistungskatalog') = (leistungskatalog_position_id is not null)),
  constraint lnp_quelle_material check (
    (quelle = 'material') = (materialverbrauch_id is not null)),
  constraint lnp_fenster check (
    leistung_bis is null or leistung_von is null or leistung_bis >= leistung_von),
  constraint lnp_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index lnp_ln_idx on leistungsnachweis_position (leistungsnachweis_id, reihenfolge);
-- „Ist diese Stunde schon nachgewiesen und abgerechnet?" (FIN-07, FIN-18).
create index lnp_zeiteintrag_idx on leistungsnachweis_position (mandant_id, zeiteintrag_id)
  where zeiteintrag_id is not null;
create index lnp_aufmass_idx on leistungsnachweis_position (mandant_id, aufmass_zeile_id)
  where aufmass_zeile_id is not null;

comment on table leistungsnachweis_position is
  'Eine Zeile des Nachweises (§5.7) mit Rueckverweis auf ihre Quelle — was '
  'FIN-07 aus einer Behauptung einen Join macht. Keine Zeilensumme (§10.3).';

-- ---------------------------------------------------------------------------
-- 4. leistungsnachweis_signatur (§5.8)
-- ---------------------------------------------------------------------------

/**
 * Die Unterschrift — und mit ihr der SCHNAPPSCHUSS.
 *
 * ANFUEGEND: kein `geaendert_am`, keine UPDATE-Policy, ein Ausloeser, der
 * jedes UPDATE zurueckweist. Eine Unterschrift, die sich nachtraeglich
 * bearbeiten laesst, ist keine.
 */
create table leistungsnachweis_signatur (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  leistungsnachweis_id uuid not null,
  kunde_id      uuid not null,
  kopf_status   leistungsnachweis_status not null default 'entwurf',
  kopf_gesperrt_am timestamptz,
  kopf_storniert_am timestamptz,

  rolle         unterschrift_rolle not null,
  /**
   * Nur bei `auftragnehmer` gesetzt — und dann traegt die Zeile die
   * Mitarbeiterdecke (§1.8). Der Kunde hat keine Beschaeftigung bei uns; ihm
   * eine anzuhaengen waere die falsche Auskunft in der falschen Spalte.
   */
  anstellung_id uuid,

  unterzeichner_name text not null,
  -- „Objektverantwortliche", „Hausmeister" — die Funktion, in der jemand
  -- zeichnet. Fuer die Frage nach der Vertretungsmacht im Streitfall.
  unterzeichner_funktion text,

  /**
   * SERVERZEIT (Invariante 5, TIM-08). Gestempelt von
   * `kern.ln_signatur_feldzeit()`, nicht per Default: ein Default griffe nur,
   * wenn die Spalte weggelassen wird, und ein INSERT mit mitgeschickter Zeit
   * schriebe einen beliebigen Zeitpunkt.
   */
  unterzeichnet_am timestamptz not null default now(),
  /**
   * Die Behauptung des Geraets — GETRENNT gespeichert, nie statt der
   * Serverzeit (TIM-08, TIM-09). Die Abweichung wird abgeleitet, damit ein
   * um zwei Stunden falsch gehendes Tablet als Tatsache im Protokoll steht
   * und nicht als Zeitangabe im Dokument.
   */
  geraete_zeit  timestamptz,
  zeitabweichung_sek integer,
  nachgetragen  boolean not null default false,

  /**
   * EIN Punkt, nie eine Spur (LEG-10). Gefuellt ausschliesslich, wenn
   * `app.einstellung('geo.erfassung_erlaubt')` wahr ist — und die
   * Unterscheidung ist rechtlich, nicht technisch: der Kundenvertreter, der
   * vor Ort quittiert, erzeugt kein Beschaeftigtendatum; die
   * Gegenzeichnung durch unsere eigene Kraft schon.
   * // TODO(client, O-06): Gibt es einen Betriebsrat? Ein Standortdatum an
   * einer Mitarbeiterunterschrift ist nach §87 Abs. 1 Nr. 6 BetrVG
   * mitbestimmungspflichtig.
   */
  breitengrad   numeric(9,6),
  laengengrad   numeric(9,6),
  geo_genauigkeit_m numeric(8,2),

  /**
   * Das Unterschriftsbild — die Canvas-PNG im PRIVATEN Bucket (DOC-03).
   *
   * Es haengt an `einsatz_medien` (0041) und nicht an `medien`: `medien` ist
   * die Website-Ablage mit oeffentlichen Bildern, `einsatz_medien` ist der
   * private Bucket mit Magic-Byte-Pruefung, EXIF-Entfernung und
   * ausschliesslich signierten Adressen. Ohne Zugangsdaten wird KEINE Zeile
   * angelegt und die Oberflaeche meldet „nicht verbunden" — nie ein
   * vorgetaeuschter Erfolg.
   */
  signatur_medien_id uuid,

  /**
   * Der unveraenderliche Abzug der Zeilen — Kopf, Positionen, Preise,
   * Anzeigetexte und die ANZEIGEZEITZONE, genau wie dargestellt (§5.8,
   * §10.4).
   *
   * Die Zeitzone gehoert dazu, weil `leistung_von`/`leistung_bis` als
   * Zeitpunkte gespeichert sind: ohne die Zone, in der sie angezeigt wurden,
   * laesst sich nicht mehr sagen, welche Uhrzeit auf dem Bildschirm stand.
   */
  snapshot      jsonb not null,
  /**
   * `sha256(kanonisches_json(snapshot))`, hex.
   *
   * Kanonisch heisst: Schluessel sortiert, keine Leerzeichen, alle Zahlen als
   * Zeichenketten. Das ist keine Zierde — `jsonb` sortiert seine Schluessel
   * beim Speichern selbst um, und ein Digest ueber die Bytes, in denen jemand
   * das Objekt gebaut hat, liesse sich nach dem Zurueckladen nicht mehr
   * nachrechnen. Der Kanonisierer steht in
   * `src/server/services/reinigung/schnappschuss.ts` und wird beim Pruefen
   * DERSELBE benutzt.
   */
  snapshot_hash text not null,

  -- SEC-A9: wer von wo aus quittiert hat.
  ip            inet,
  user_agent    text,

  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  -- Auditblock — ANFUEGEND, also OHNE `geaendert_*` (§5.8).
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint ln_signatur_mandant_uk unique (mandant_id, id),

  constraint lns_kopf_fk foreign key (mandant_id, leistungsnachweis_id)
    references leistungsnachweis (mandant_id, id),
  constraint lns_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint lns_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint lns_medien_fk foreign key (mandant_id, signatur_medien_id)
    references einsatz_medien (mandant_id, id),

  constraint lns_name_gefuellt check (btrim(unterzeichner_name) <> ''),
  -- Unsere eigene Gegenzeichnung haengt an einer Beschaeftigung (D-09).
  constraint lns_auftragnehmer_hat_anstellung check (
    rolle <> 'auftragnehmer' or anstellung_id is not null),
  constraint lns_hash_form check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  -- Ein halber Punkt ist kein Punkt.
  constraint lns_geo_paarweise check ((breitengrad is null) = (laengengrad is null)),
  constraint lns_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Je Nachweis EINE Unterschrift je Rolle: Auftraggeber und Auftragnehmer.
create unique index ln_signatur_uk
  on leistungsnachweis_signatur (leistungsnachweis_id, rolle);
-- „Zuletzt unterschriebene Nachweise" auf der Uebersicht (DSH-04).
create index ln_signatur_zeit_idx
  on leistungsnachweis_signatur (mandant_id, unterzeichnet_am desc);

comment on table leistungsnachweis_signatur is
  'Die Unterschrift (§5.8): Name, SERVERZEIT, Ort, Bild — und ein '
  'unveraenderlicher JSONB-Abzug der Zeilen samt SHA-256. Anfuegend: kein '
  'UPDATE, keine geaendert_*-Spalten.';
comment on column leistungsnachweis_signatur.snapshot is
  'Kopie, kein Join (§10.4). Wer die Zeilen zur Anzeigezeit nachlaedt, zeigt '
  'den heutigen Stand — und der Kunde hat einen anderen gesehen.';
comment on column leistungsnachweis_signatur.geraete_zeit is
  'Die Behauptung des Geraets, GETRENNT von der Serverzeit (TIM-08). Nie '
  'statt ihr — die Abweichung ist selbst Beweismaterial.';

-- ---------------------------------------------------------------------------
-- 5. Zusammengesetzte Fremdschluessel dieser Migration (§12)
-- ---------------------------------------------------------------------------

/**
 * Vollstaendig, damit der Schema-Test aus §12 sie findet:
 *
 *   leistungsnachweis (mandant_id, objekt_id)              → objekt
 *   leistungsnachweis (mandant_id, revier_id)              → revier
 *   leistungsnachweis (mandant_id, kunde_id)               → kunde
 *   leistungsnachweis (mandant_id, auftrag_leistung_id)    → auftrag_leistung
 *   leistungsnachweis (mandant_id, ersetzt_durch_id)       → leistungsnachweis
 *   leistungsnachweis_position (mandant_id, leistungsnachweis_id) → leistungsnachweis
 *   leistungsnachweis_position (mandant_id, kunde_id)      → kunde
 *   leistungsnachweis_position (mandant_id, auftrag_leistung_id) → auftrag_leistung
 *   leistungsnachweis_position (mandant_id, auftrag_leistung_id, zeiteintrag_id)
 *                                                          → zeiteintrag
 *   leistungsnachweis_position (mandant_id, leistungskatalog_position_id)
 *                                                          → leistungskatalog_position
 *   leistungsnachweis_signatur (mandant_id, leistungsnachweis_id) → leistungsnachweis
 *   leistungsnachweis_signatur (mandant_id, kunde_id)      → kunde
 *   leistungsnachweis_signatur (mandant_id, anstellung_id) → anstellung
 *   leistungsnachweis_signatur (mandant_id, signatur_medien_id) → einsatz_medien
 *
 * OFFEN, weil die Gegenstelle fehlt — als Schuld notiert, nicht als
 * stillschweigende Auslassung. WOERTLICH NACHZUTRAGEN, wo die Tabelle
 * entsteht:
 *
 *   -- mit `projekt` (Bau-Domaene, §7.1):
 *   alter table leistungsnachweis add constraint ln_projekt_fk
 *     foreign key (mandant_id, projekt_id) references projekt (mandant_id, id);
 *   -- mit `posten` (PR 41, §6.3):
 *   alter table leistungsnachweis add constraint ln_posten_fk
 *     foreign key (mandant_id, posten_id) references posten (mandant_id, id);
 *   -- mit `aufmass_zeile` (Bau-Domaene, §7.7):
 *   alter table leistungsnachweis_position add constraint lnp_aufmass_zeile_fk
 *     foreign key (mandant_id, aufmass_zeile_id)
 *     references aufmass_zeile (mandant_id, id);
 *
 * `sonderleistung_id` holt 0067 ab, weil dessen Tabelle ihrerseits auf den
 * Nachweis zeigt — zwei Tabellen, die aufeinander verweisen, brauchen eine
 * Reihenfolge, und die steht dort.
 */

-- ---------------------------------------------------------------------------
-- 6. Ausloeser (§13.1)
-- ---------------------------------------------------------------------------

/**
 * Der Statuspfad, in EINE Richtung.
 *
 *   entwurf → vorgelegt → signiert | abgelehnt        und  * → storniert
 *
 * Warum in der Datenbank und nicht nur im Dienst: der Dienst ist der Weg,
 * den die Oberflaeche geht, aber er ist nicht der einzige — ein Skript, eine
 * Datenkorrektur, ein spaeterer Import. Ein Nachweis, der aus `signiert`
 * zurueck nach `entwurf` faellt, macht die Unterschrift des Kunden zu einer
 * Unterschrift unter etwas anderem.
 */
create function kern.ln_status_uebergang() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then return new; end if;

  -- Stornieren geht aus jedem Zustand, und aus `storniert` geht nichts mehr.
  if old.status = 'storniert' then
    raise exception 'Ein stornierter Leistungsnachweis aendert seinen Status nicht mehr'
      using errcode = 'restrict_violation',
            hint = 'Ein Ersatz entsteht als NEUE Zeile (ersetzt_durch_id).';
  end if;
  if new.status = 'storniert' then return new; end if;

  if not (   (old.status = 'entwurf'   and new.status = 'vorgelegt')
          or (old.status = 'vorgelegt' and new.status in ('signiert','abgelehnt'))) then
    raise exception 'Unzulaessiger Statuswechsel % → %', old.status, new.status
      using errcode = 'restrict_violation',
            detail  = 'Erlaubt sind entwurf → vorgelegt → signiert | abgelehnt '
                      || 'sowie * → storniert.',
            hint    = 'Ein abgelehnter Nachweis wird ERSETZT, nicht zurueckgesetzt.';
  end if;
  return new;
end $$;

create trigger trg_ln_status_uebergang
  before update of status on leistungsnachweis
  for each row execute function kern.ln_status_uebergang();

/**
 * Serverzeit fuer `vorgelegt_am` und `storniert_am` (§1.11, Invariante 5).
 *
 * `kern.erzwinge_serverzeit()` ist auf die Spalte `eingegangen_am`
 * festgeschrieben und nimmt keinen Spaltennamen als Argument — dieselbe Lage,
 * in der 0017, 0028 und 0029 eigene Funktionen danebengestellt haben.
 *
 * Gestempelt wird nur der UEBERGANG nach „gesetzt". „Seit wann liegt dieser
 * Nachweis beim Kunden" ist im Streit um eine nicht bezahlte Rechnung genau
 * die Frage, und sie darf nicht vom Absender beantwortet werden.
 */
create function kern.ln_zeitstempel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.vorgelegt_am  is not null then new.vorgelegt_am  := now(); end if;
    if new.storniert_am  is not null then new.storniert_am  := now(); end if;
    return new;
  end if;
  if new.vorgelegt_am is not null and old.vorgelegt_am is null then
    new.vorgelegt_am := now();
  end if;
  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;
  return new;
end $$;

create trigger trg_ln_zeitstempel
  before insert or update on leistungsnachweis
  for each row execute function kern.ln_zeitstempel();

/**
 * Ab `gesperrt_am` ist der Kopf eingefroren (§1.15, §5.6).
 *
 * Genau vier Spalten bleiben beweglich, und jede aus einem Grund:
 * `storniert_*` und `ersetzt_durch_id`, weil Korrektur durch Ersetzen laeuft
 * und nicht durch Aendern; `aufbewahrung_bis` und `loeschsperre`, weil
 * `job:aufbewahrung` sie fortschreibt (§1.14).
 *
 * Der Vergleich laeuft ueber `is distinct from`, nicht ueber `<>`: bei NULL
 * ergaebe `<>` NULL, die Bedingung waere nicht wahr, und eine Aenderung von
 * NULL auf einen Wert ginge lautlos durch — also genau der Fall, um den es
 * geht.
 */
create function kern.ln_einfrieren() returns trigger
language plpgsql as $$
begin
  if old.gesperrt_am is null then return new; end if;

  if new.gesperrt_am        is distinct from old.gesperrt_am
     or (new.status is distinct from old.status and new.status <> 'storniert')
     or new.nummer          is distinct from old.nummer
     or new.objekt_id       is distinct from old.objekt_id
     or new.projekt_id      is distinct from old.projekt_id
     or new.revier_id       is distinct from old.revier_id
     or new.posten_id       is distinct from old.posten_id
     or new.sonderleistung_id is distinct from old.sonderleistung_id
     or new.auftrag_leistung_id is distinct from old.auftrag_leistung_id
     or new.kunde_id        is distinct from old.kunde_id
     or new.leistungszeitraum_von is distinct from old.leistungszeitraum_von
     or new.leistungszeitraum_bis is distinct from old.leistungszeitraum_bis
     or new.vorgelegt_am    is distinct from old.vorgelegt_am
     or new.abgelehnt_grund is distinct from old.abgelehnt_grund then
    raise exception 'Ein unterschriebener Leistungsnachweis ist unveraenderlich'
      using errcode = 'restrict_violation',
            detail  = 'Seit ' || old.gesperrt_am || ' gesperrt (§1.15).',
            hint    = 'Korrigiert wird durch Stornieren und einen Ersatz '
                      || '(ersetzt_durch_id), nie durch Aendern.';
  end if;
  return new;
end $$;

create trigger trg_ln_einfrieren
  before update on leistungsnachweis
  for each row execute function kern.ln_einfrieren();

/**
 * Kunde und Kopfzustand auf die Kinder kopieren (§1.8, §5.7).
 *
 * Was der Aufrufer mitschickt, wird VERWORFEN: sonst waere die
 * Kundensichtbarkeit eine Eingabe. Dieselbe Bauart wie
 * `kern.einsatz_medien_bezug_pruefen()` in 0041.
 */
create function kern.ln_kopf_denormalisieren() returns trigger
language plpgsql as $$
declare k record;
begin
  select l.kunde_id, l.status, l.gesperrt_am, l.storniert_am into k
    from leistungsnachweis l
   where l.id = new.leistungsnachweis_id and l.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Zu dieser Zeile gibt es keinen Leistungsnachweis in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;
  new.kunde_id          := k.kunde_id;
  new.kopf_status       := k.status;
  new.kopf_gesperrt_am  := k.gesperrt_am;
  new.kopf_storniert_am := k.storniert_am;
  return new;
end $$;

create trigger trg_lnp_denormalisieren
  before insert or update on leistungsnachweis_position
  for each row execute function kern.ln_kopf_denormalisieren();
create trigger trg_ln_signatur_3_denormalisieren
  before insert on leistungsnachweis_signatur
  for each row execute function kern.ln_kopf_denormalisieren();

/**
 * Und die Gegenrichtung: ein Statuswechsel am Kopf schreibt sich auf die
 * Kinder fort — IN DERSELBEN TRANSAKTION.
 *
 * Ohne sie stuende auf den Zeilen eines soeben vorgelegten Nachweises noch
 * `entwurf`, und der Kunde saehe den Kopf ohne seine Positionen: eine
 * Rechnung ueber nichts.
 */
create function kern.ln_kopfstatus_fortschreiben() returns trigger
/**
 * `security definer`, und zwar zwingend — dieselbe Lage wie bei
 * `kern.einsatz_medien_bezug_pruefen()` in 0041.
 *
 * `leistungsnachweis_signatur` haelt fuer `cse_app` KEINEN UPDATE-Grant und
 * keine UPDATE-Policy: §5.8 macht sie anfuegend, und das ist die Zusage. Ein
 * Ausloeser, der unter der Rolle des Schreibenden liefe, bekaeme genau
 * deshalb „permission denied" — und zwar bei JEDER Unterschrift, weil die
 * Sperre des Kopfes die Fortschreibung ausloest.
 *
 * Erhoeht wird damit nichts, was der Aufrufer nicht ohnehin bewirkt: die
 * Funktion schreibt AUSSCHLIESSLICH die drei Kopfzustandsspalten und
 * ausschliesslich auf Kinder DESSELBEN Kopfes, dessen Zeile der Aufrufer
 * gerade veraendert hat. `search_path` steht woertlich, weil ein
 * unqualifizierter Suchpfad auf einem Definer ein Weg zur Rechteausweitung
 * ist (K-01).
 */
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status is not distinct from old.status
     and new.gesperrt_am is not distinct from old.gesperrt_am
     and new.storniert_am is not distinct from old.storniert_am then
    return null;
  end if;
  update leistungsnachweis_position
     set kopf_status = new.status,
         kopf_gesperrt_am = new.gesperrt_am,
         kopf_storniert_am = new.storniert_am
   where leistungsnachweis_id = new.id;
  /**
   * Die Unterschrift bekommt ihren Kopfzustand ueber eine Anweisung, die der
   * Unveraenderlichkeitsausloeser unten ausdruecklich durchlaesst. Sie ist
   * keine Aenderung AN der Unterschrift, sondern die Sichtbarkeitsspur des
   * Kopfes, auf der die Kundendecke steht.
   */
  update leistungsnachweis_signatur
     set kopf_status = new.status,
         kopf_gesperrt_am = new.gesperrt_am,
         kopf_storniert_am = new.storniert_am
   where leistungsnachweis_id = new.id;
  return null;
end $$;

create trigger trg_ln_kopfstatus_fortschreiben
  after update on leistungsnachweis
  for each row execute function kern.ln_kopfstatus_fortschreiben();

/**
 * Ab der Kopfsperre sind auch die Zeilen eingefroren (§5.7).
 *
 * Geprueft wird gegen die KOPIERTE Sperre der Zeile, nicht gegen eine
 * Unterabfrage in den Kopf: die Kopie ist ohnehin da, und ein Ausloeser, der
 * je Zeile in den Kopf schaut, ist bei einem Import von vierhundert Zeilen
 * vierhundert Abfragen.
 */
create function kern.lnp_einfrieren() returns trigger
language plpgsql as $$
begin
  if old.kopf_gesperrt_am is null then return new; end if;
  -- Der Kopfstatus darf sich fortschreiben (Storno nach der Unterschrift);
  -- der INHALT der Zeile nicht.
  if new.bezeichnung is distinct from old.bezeichnung
     or new.menge is distinct from old.menge
     or new.einheit is distinct from old.einheit
     or new.einzelpreis_cent is distinct from old.einzelpreis_cent
     or new.quelle is distinct from old.quelle
     or new.reihenfolge is distinct from old.reihenfolge
     or new.zeiteintrag_id is distinct from old.zeiteintrag_id
     or new.aufmass_zeile_id is distinct from old.aufmass_zeile_id
     or new.leistungskatalog_position_id is distinct from old.leistungskatalog_position_id
     or new.materialverbrauch_id is distinct from old.materialverbrauch_id
     or new.leistung_von is distinct from old.leistung_von
     or new.leistung_bis is distinct from old.leistung_bis
     or new.bemerkung is distinct from old.bemerkung then
    raise exception 'Die Zeilen eines unterschriebenen Nachweises sind unveraenderlich'
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird durch Stornieren und einen Ersatz.';
  end if;
  return new;
end $$;

create trigger trg_lnp_einfrieren
  before update on leistungsnachweis_position
  for each row execute function kern.lnp_einfrieren();

/**
 * Die Feldzeit der Unterschrift (§1.11, TIM-08, TIM-09).
 *
 * `kern.stempel_feldzeit()` ist auf die Spaltennamen des Zeiteintrags
 * geschrieben; hier heissen sie `unterzeichnet_am` und `geraete_zeit`. Die
 * Abweichung wird IMMER abgeleitet — sie ist die Tatsache, nicht die
 * Auswertung.
 */
create function kern.ln_signatur_feldzeit() returns trigger
language plpgsql as $$
begin
  new.unterzeichnet_am := now();
  if new.geraete_zeit is not null then
    new.zeitabweichung_sek :=
      round(extract(epoch from (new.geraete_zeit - new.unterzeichnet_am)))::integer;
  else
    new.zeitabweichung_sek := null;
  end if;
  return new;
end $$;

/**
 * Unterschrieben wird nur, was VORGELEGT ist — und die Unterschrift setzt
 * den Kopf in einem Zug auf `signiert` und `gesperrt_am` (§5.8).
 *
 * Beides in EINEM Ausloeser, weil es EIN Vorgang ist. Zwei Anweisungen im
 * Dienst hiessen: eine Unterschrift ohne Sperre, wenn zwischen ihnen etwas
 * schiefgeht — also genau die Zeile, die der Kunde spaeter bestreitet.
 *
 * `trg_ln_signatur_1_*` und `_2_*`: die Ausloeser feuern in ALPHABETISCHER
 * Reihenfolge, und die Feldzeit muss vor der Pruefung stehen.
 */
create function kern.ln_signierbar() returns trigger
language plpgsql as $$
declare v_status leistungsnachweis_status;
begin
  select l.status into v_status
    from leistungsnachweis l
   where l.id = new.leistungsnachweis_id and l.mandant_id = new.mandant_id
     for no key update;
  if v_status is null then
    raise exception 'Zu dieser Unterschrift gibt es keinen Leistungsnachweis'
      using errcode = 'foreign_key_violation';
  end if;
  if v_status <> 'vorgelegt' then
    raise exception 'Ein Leistungsnachweis im Zustand % wird nicht unterschrieben', v_status
      using errcode = 'restrict_violation',
            hint = 'Erst vorlegen (entwurf → vorgelegt), dann unterschreiben.';
  end if;

  /**
   * Der Kopf geht in DIESER Anweisung auf `signiert`.
   *
   * `gesperrt_am := now()` ist ein NULL→Wert-Uebergang, und genau deshalb
   * laesst `kern.ln_einfrieren()` ihn zu: die Funktion kehrt sofort zurueck,
   * solange `old.gesperrt_am` NULL ist.
   */
  update leistungsnachweis
     set status = 'signiert', gesperrt_am = now()
   where id = new.leistungsnachweis_id;
  return new;
end $$;

create trigger trg_ln_signatur_1_feldzeit
  before insert on leistungsnachweis_signatur
  for each row execute function kern.ln_signatur_feldzeit();
create trigger trg_ln_signatur_2_signierbar
  before insert on leistungsnachweis_signatur
  for each row execute function kern.ln_signierbar();

/**
 * Eine Unterschrift wird nicht bearbeitet (§5.8).
 *
 * Die drei Kopfzustandsspalten sind die eine Ausnahme, und sie sind keine
 * Aussage UEBER die Unterschrift, sondern die Sichtbarkeitsspur des Kopfes:
 * ohne sie verschwaende ein stornierter Nachweis nicht aus dem Kundenportal.
 * Alles andere — Name, Zeit, Ort, Bild, Schnappschuss, Hash — wirft.
 */
create function kern.ln_signatur_unveraenderlich() returns trigger
language plpgsql as $$
begin
  if new.leistungsnachweis_id is distinct from old.leistungsnachweis_id
     or new.rolle is distinct from old.rolle
     or new.anstellung_id is distinct from old.anstellung_id
     or new.unterzeichner_name is distinct from old.unterzeichner_name
     or new.unterzeichner_funktion is distinct from old.unterzeichner_funktion
     or new.unterzeichnet_am is distinct from old.unterzeichnet_am
     or new.geraete_zeit is distinct from old.geraete_zeit
     or new.zeitabweichung_sek is distinct from old.zeitabweichung_sek
     or new.nachgetragen is distinct from old.nachgetragen
     or new.breitengrad is distinct from old.breitengrad
     or new.laengengrad is distinct from old.laengengrad
     or new.geo_genauigkeit_m is distinct from old.geo_genauigkeit_m
     or new.signatur_medien_id is distinct from old.signatur_medien_id
     or new.snapshot is distinct from old.snapshot
     or new.snapshot_hash is distinct from old.snapshot_hash
     or new.ip is distinct from old.ip
     or new.user_agent is distinct from old.user_agent
     or new.kunde_id is distinct from old.kunde_id then
    raise exception 'Eine Unterschrift wird nicht nachtraeglich geaendert'
      using errcode = 'restrict_violation',
            hint = 'Diese Tabelle ist anfuegend (§5.8).';
  end if;
  return new;
end $$;

create trigger trg_ln_signatur_unveraenderlich
  before update on leistungsnachweis_signatur
  for each row execute function kern.ln_signatur_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 7. Der Lesepfad des Mitarbeiterportals (§1.8)
-- ---------------------------------------------------------------------------

/**
 * „Ist dieser Mensch auf diesem Objekt eingesetzt?"
 *
 * §1.8 nennt `app.ist_eingesetzt_auf_objekt(objekt_id)` als Traeger der
 * Mitarbeiterdecke auf `leistungsnachweis` und `schluessel`. Die Funktion gab
 * es noch nicht — CLN-04 und SEC-05 lassen die Kraft VOR ORT den Nachweis
 * erzeugen, den der Kunde dann unterschreibt, und `nachweis.schreiben` ist
 * einer der fuenf Schluessel, die `mitarbeiter` haelt (§1.7). Ohne Lesepfad
 * waere das ein Bildschirm, auf den man schreiben, aber nichts sehen kann.
 *
 * `security definer`, weil `einsatz_zuordnung` und `einsatz` unter FORCE RLS
 * stehen und ihre eigenen Decken enger sein koennen als diese Frage
 * (§1.10). `stable`, damit der Planer sie je Anweisung und nicht je Zeile
 * aufruft. `search_path` woertlich, weil ein unqualifizierter Suchpfad auf
 * einem Definer ein Weg zur Rechteausweitung ist (K-01).
 *
 * `abgesagt` und `ersetzt` zaehlen NICHT: wer die Schicht nie angetreten hat,
 * hat auf dem Objekt nichts zu lesen.
 *
 * `create or replace`, weil PR 41 dieselbe Funktion fuer `schluessel` und
 * `wachbuch_eintrag` braucht und beide Zweige parallel entstehen. Der Koerper
 * ist derselbe; zwei Fassungen davon waeren zwei Antworten auf eine Frage.
 */
create or replace function app.ist_eingesetzt_auf_objekt(p_objekt uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select exists (
    select 1
      from public.einsatz_zuordnung ez
      join public.einsatz e on e.id = ez.einsatz_id
     where e.objekt_id = p_objekt
       and ez.person_id = app.aktuelle_person()
       and ez.status in ('geplant','zugesagt')
       and ez.entfernt_am is null)
$$;

comment on function app.ist_eingesetzt_auf_objekt(uuid) is
  'Mitarbeiterdecke §1.8: darf dieser Mensch die Zeilen dieses Objekts sehen? '
  'security definer, weil einsatz_zuordnung unter FORCE RLS steht.';

revoke all on function app.ist_eingesetzt_auf_objekt(uuid) from public;
grant execute on function app.ist_eingesetzt_auf_objekt(uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- 8. Zeilenschutz — leistungsnachweis (§1.6, §1.6a, §1.8)
-- ---------------------------------------------------------------------------

alter table leistungsnachweis enable row level security;
alter table leistungsnachweis force  row level security;

create policy t_mandant on leistungsnachweis for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('nachweis.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('nachweis.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on leistungsnachweis for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.nachweis.lesen')));

/**
 * §1.6a: `t_kunde` — der Kundenscope.
 *
 * Ohne sie liest die CRM-06-Historie NICHTS: in `kunde`-Scope ist
 * `app.aktiver_mandant()` NULL, also ist `t_mandant` falsch, und eine Decke
 * allein oeffnet keine Tuer — sie verengt nur.
 *
 * Ein Kunde sieht `vorgelegt` und `signiert`, nie einen Entwurf (AUT-01).
 */
create policy t_kunde on leistungsnachweis for select to cse_app
  using (app.scope() = 'kunde'
         and kunde_id = any (app.aktuelle_kunden())
         and status in ('vorgelegt','signiert')
         and storniert_am is null);

/**
 * §1.8: `t_person` — der Mitarbeiterscope.
 *
 * Die Kraft vor Ort erzeugt den Nachweis (CLN-04, SEC-05); sie sieht die
 * Nachweise der Objekte, auf die sie eingeteilt ist, und keine anderen.
 */
create policy t_person on leistungsnachweis for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and objekt_id is not null
         and app.ist_eingesetzt_auf_objekt(objekt_id));

/**
 * EINE Decke mit ZWEI Zweigen, nicht zwei Decken (§1.8).
 *
 * Restriktive Policies werden UND-verknuepft. Zwei Decken — eine fuers
 * Kundenportal, eine fuers Mitarbeiterportal — ergaeben zusammen „Kunde UND
 * Mitarbeiter", also nichts. Die Zweige stehen deshalb als Disjunktion in
 * EINER Regel, und der `intern`-Zweig steht mit drin, weil eine Decke ohne
 * ihn das Buero aussperrte.
 *
 * Der Bau-Zweig (`ist_eingesetzt_auf_projekt`) fehlt, solange es `projekt`
 * nicht gibt: eine Bedingung auf eine Spalte, die immer NULL ist, ist keine
 * Luecke, sondern der heutige Stand der Domaene.
 */
create policy p_portal_decke on leistungsnachweis as restrictive for all to cse_app
  using (
    app.portal() = 'intern'
    or (app.portal() = 'kunde'
        and kunde_id = any (app.aktuelle_kunden())
        and status in ('vorgelegt','signiert')
        and storniert_am is null)
    or (app.portal() = 'mitarbeiter'
        and objekt_id is not null
        and app.ist_eingesetzt_auf_objekt(objekt_id)));

-- `job:ln_unsigniert` liest „vorgelegt und unsigniert" (§13.2) und schreibt
-- ausserhalb der Aufbewahrungsspalten nichts.
create policy t_job on leistungsnachweis for select to cse_job using (true);
create policy t_job_frist on leistungsnachweis for update to cse_job
  using (true) with check (true);

grant select, insert, update on leistungsnachweis to cse_app;
grant select on leistungsnachweis to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on leistungsnachweis to cse_job;
/**
 * `cse_definer` liest den Kopf, weil `kern.einsatz_medien_bezug_pruefen()`
 * (0041) ihn aufloest, um `kunde_id` abzuleiten — und ein Definer ist unter
 * FORCE RLS NICHT ausgenommen (§1.5). Ohne diese Policy schluege jedes
 * Anhaengen eines Unterschriftsbildes fehl, und zwar mit der Meldung, der
 * Elternteil existiere nicht.
 */
grant select on leistungsnachweis to cse_definer;
create policy d_medien_bezug on leistungsnachweis for select to cse_definer using (true);

-- ---------------------------------------------------------------------------
-- 9. Zeilenschutz — leistungsnachweis_position
-- ---------------------------------------------------------------------------

alter table leistungsnachweis_position enable row level security;
alter table leistungsnachweis_position force  row level security;

create policy t_mandant on leistungsnachweis_position for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('nachweis.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('nachweis.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on leistungsnachweis_position for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.nachweis.lesen')));

/**
 * Kunde und Kopfzustand kommen aus den KOPIERTEN Spalten dieser Zeile, nie
 * aus einer Unterabfrage ueber den Kopf (§1.8). Das ist der ganze Grund,
 * warum es die Spalten gibt.
 */
create policy t_kunde on leistungsnachweis_position for select to cse_app
  using (app.scope() = 'kunde'
         and kunde_id = any (app.aktuelle_kunden())
         and kopf_status in ('vorgelegt','signiert')
         and kopf_storniert_am is null);

create policy p_portal_decke on leistungsnachweis_position as restrictive for all to cse_app
  using (
    app.portal() = 'intern'
    or (app.portal() = 'kunde'
        and kunde_id = any (app.aktuelle_kunden())
        and kopf_status in ('vorgelegt','signiert')
        and kopf_storniert_am is null));

/**
 * K-05-Nachbarschaft: `einzelpreis_cent` ist der Preis, den wir dem Kunden
 * berechnen — kein Lohn, also keine Spaltensperre. Der Grant ist deshalb
 * ungeteilt; was ihn begrenzt, ist die Zeile und nicht die Spalte.
 */
grant select, insert, update on leistungsnachweis_position to cse_app;
grant select on leistungsnachweis_position to cse_job;
create policy t_job on leistungsnachweis_position for select to cse_job using (true);

-- ---------------------------------------------------------------------------
-- 10. Zeilenschutz — leistungsnachweis_signatur
-- ---------------------------------------------------------------------------

alter table leistungsnachweis_signatur enable row level security;
alter table leistungsnachweis_signatur force  row level security;

/**
 * INSERT und SELECT — mehr nicht (§5.8).
 *
 * Kein UPDATE fuer `cse_app`, kein DELETE fuer niemanden. Die eine Anweisung,
 * die den Kopfzustand fortschreibt, laeuft im Ausloeser als Eigentuemer
 * (`trg_ln_kopfstatus_fortschreiben`) und braucht keine Policy.
 */
create policy t_mandant_lesen on leistungsnachweis_signatur for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('nachweis.lesen', app.aktiver_mandant())));

create policy t_mandant_schreiben on leistungsnachweis_signatur for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('nachweis.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on leistungsnachweis_signatur for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.nachweis.lesen')));

create policy t_kunde on leistungsnachweis_signatur for select to cse_app
  using (app.scope() = 'kunde'
         and kunde_id = any (app.aktuelle_kunden())
         and kopf_status in ('vorgelegt','signiert')
         and kopf_storniert_am is null);

/**
 * Die Mitarbeiterdecke keyt auf `anstellung_id` — die eigene Gegenzeichnung
 * (§5.8). Die Unterschrift des KUNDEN traegt keine Anstellung und ist damit
 * im Mitarbeiterportal unsichtbar: sein Name gehoert ihm, nicht der Kraft,
 * die das Tablet gehalten hat.
 */
create policy t_person on leistungsnachweis_signatur for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in (select a.id from anstellung a
                                where a.person_id = app.aktuelle_person()));

create policy p_portal_decke on leistungsnachweis_signatur as restrictive for all to cse_app
  using (
    app.portal() = 'intern'
    or (app.portal() = 'kunde'
        and kunde_id = any (app.aktuelle_kunden())
        and kopf_status in ('vorgelegt','signiert')
        and kopf_storniert_am is null)
    or (app.portal() = 'mitarbeiter'
        and anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person())));

grant select, insert on leistungsnachweis_signatur to cse_app;
grant select on leistungsnachweis_signatur to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on leistungsnachweis_signatur to cse_job;
create policy t_job on leistungsnachweis_signatur for select to cse_job using (true);
create policy t_job_frist on leistungsnachweis_signatur for update to cse_job
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 11. Das Medienregister (0041 §6)
-- ---------------------------------------------------------------------------

/**
 * 0041 hat sein Register mit fuenf offenen Zeilen hinterlassen und die
 * Anweisung dazu woertlich notiert. Zwei davon werden jetzt faellig; die
 * dritte (`qualitaetspruefung`) kommt mit 0068.
 *
 * `modul` ist `nachweis` und nicht `reinigung`, wie 0041 vorgeschlagen hat:
 * die Spalte nennt das Modul, unter dem das Recht am ELTERNTEIL haengt, und
 * das ist bei `leistungsnachweis` ausweislich §1.7 und der Seitenkarte
 * `nachweis.lesen` / `nachweis.schreiben`. 0041 selbst sagt, die Modulnamen
 * seien bei Entstehung der Tabelle zu BESTAETIGEN und nicht dort zu raten —
 * das ist hiermit geschehen.
 *
 * `kunde_pfad = 'kunde_id'`: der Ausloeser leitet die Kundensichtbarkeit des
 * Bildes aus dem Kopf ab, statt sie sich sagen zu lassen.
 */
insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad) values
  ('leistungsnachweis','nachweis','kunde_id');

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0066)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- leistungsnachweis (archiv): CLN-04, LEG-01, § 147 AO. Das ist das Dokument, das der Kunde unterschrieben hat und aus dem eine Rechnung abgeleitet wird — zehn Jahre aufbewahrungspflichtig (Klasse gobd_10j). Geloescht bliebe eine Rechnung ohne Leistungsbeleg stehen; korrigiert wird durch Stornieren und einen Ersatz (ersetzt_durch_id), nie durch Entfernen.
create trigger trg_leistungsnachweis_kein_hard_delete
  before delete on leistungsnachweis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsnachweis_kein_truncate
  before truncate on leistungsnachweis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsnachweis from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungsnachweis_position (append): CLN-04, FIN-07. Die Zeile traegt den Rueckverweis auf ihre Quelle — den Zeiteintrag, die Aufmasszeile, die Katalogposition. Sie zu loeschen macht aus der Nachvollziehbarkeit einer Rechnungsposition eine Behauptung. Eine eigene Lebendigkeitsspalte hat sie nicht: sie lebt und stirbt mit ihrem Kopf, dessen Zustand sie kopiert traegt.
create trigger trg_leistungsnachweis_position_kein_hard_delete
  before delete on leistungsnachweis_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsnachweis_position_kein_truncate
  before truncate on leistungsnachweis_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsnachweis_position from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungsnachweis_signatur (append): CLN-04, LEG-01, SEC-A9. Name, Serverzeit, Ort und der unveraenderliche Abzug dessen, was angezeigt wurde — die Zeile, um die im Streitfall gestritten wird. Sie ist anfuegend bis in die Rechte hinein: kein UPDATE, kein DELETE, keine geaendert_*-Spalten. Eine loeschbare Unterschrift ist keine.
create trigger trg_leistungsnachweis_signatur_kein_hard_delete
  before delete on leistungsnachweis_signatur
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsnachweis_signatur_kein_truncate
  before truncate on leistungsnachweis_signatur
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsnachweis_signatur from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_leistungsnachweis_geaendert_am
  before update on leistungsnachweis
  for each row execute function kern.setze_geaendert_am();
create trigger trg_leistungsnachweis_position_geaendert_am
  before update on leistungsnachweis_position
  for each row execute function kern.setze_geaendert_am();

create trigger trg_leistungsnachweis_audit
  after insert or update or delete on leistungsnachweis
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
