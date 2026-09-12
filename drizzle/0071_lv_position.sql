-- ===========================================================================
-- 0071 — Bau A/1: projekt, leistungsverzeichnis, lv_position mit OZ-Hierarchie
--        (BAU-01, 03-GEWERKE.md §7.1, §7.4, §7.5, §10.2)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md`. Wo dieser Text
-- und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- **Warum `projekt` hier entsteht und nicht in 0025.** §7.1 ist eindeutig: ein
-- Bauprojekt ist ein `auftrag` MIT einer Bauerweiterung, nicht ein zweiter
-- kaufmaennischer Kopf — `auftrag_id` ist `not null unique`. 0025 hat den
-- Auftrag gebaut und die Erweiterung offen gelassen; 0028 und 0034 haben ihre
-- Fremdschluessel auf `projekt` woertlich hinterlegt und auf diese Migration
-- gewartet (§14.4 dort). Beide werden unten nachgetragen — eine Spalte
-- `projekt_id` ohne Fremdschluessel ist genau die Luecke, durch die eine
-- Schicht der Reinigung an einem Bauprojekt der Security haengen kann.
--
-- **Die drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:**
--
--  1. **`vertragsgrundlage` hat KEINEN Vorgabewert.** VOB/B und BGB
--     unterscheiden sich bei Nachtrag, Behinderung, Abnahme und
--     Gewaehrleistung — also bei allem, was diese Domaene modelliert. Ein
--     Vorgabewert waere das stille Setzen einer Rechtsfolge (O-154).
--  2. **`sortier_pfad` neben `oz`.** Eine Textsortierung stellt `1.2.10` VOR
--     `1.2.9`. Das ist kein Schoenheitsfehler: in einem LV mit vierhundert
--     Zeilen faellt niemandem auf, dass eine Position an der falschen Stelle
--     steht, und die Titelsumme daneben stimmt trotzdem.
--  3. **Kein gespeichertes Produkt Menge × Einheitspreis** (§10.3). Die
--     Rundungsregel ist eine kaufmaennische Entscheidung und gehoert in eine
--     geprueft Funktion (`services/bau/lv.ts`), nicht in eine generierte
--     Spalte, die drei Jahre spaeter niemand als Rundungsregel erkennt.
--
-- NICHT in dieser Migration: `aufmass*` (0072), `nachtrag`, `behinderung`,
-- `bautagebuch`, `abnahme`, `gewerk` (PR 44/45), GAEB-Import (O-97).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (03-GEWERKE §3.3)
-- ---------------------------------------------------------------------------

/** CLAUDE.md nennt die drei Gewerke der REALTIME Service GmbH woertlich. */
create type projekt_art    as enum ('hochbau','ausbau','rueckbau');
create type projekt_status as enum
  ('geplant','in_arbeit','abgenommen','abgeschlossen','archiviert');

/**
 * NOT NULL, OHNE Vorgabewert. Das Regime wird je Vertrag gewaehlt, nie
 * geerbt.
 * // TODO(client, O-154): Kommen BGB-Bauvertraege vor, oder ausschliesslich
 * VOB/B? Falls beides: woran erkennt die Bauleitung, welches Regime gilt?
 */
create type bau_vertragsgrundlage as enum ('vob_b','bgb');

create type leistungsverzeichnis_art as enum
  ('hauptauftrag','nachtrag','ausschreibung','eigenkalkulation');

/** Die Hierarchiestufen aus GAEB DA XML. */
create type lv_art as enum ('los','titel','untertitel','position','hinweistext');

/**
 * Werte aus GAEB DA XML. PLATZHALTER, was ihre kaufmaennische Wirkung angeht.
 * // TODO(client, O-155): Welche dieser Positionsarten kommen vor, und wie
 * geht jede in die Angebots- bzw. Auftragssumme ein? Bedarfs- und
 * Alternativpositionen zaehlen ueblicherweise NICHT — bis zur Antwort rechnet
 * keine Summenfunktion sie ein (`services/bau/lv.ts#zaehltInSumme`) und die
 * Oberflaeche zeigt sie mit der Pille „Unbestaetigter Wert".
 */
create type lv_positionsart as enum
  ('unbestimmt','normalposition','bedarfsposition','alternativposition',
   'zuschlagsposition','grundposition');

-- ---------------------------------------------------------------------------
-- 2. projekt (§7.1)
-- ---------------------------------------------------------------------------

create table projekt (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  /**
   * §7.1: das Projekt IST der Auftrag, nicht sein Zwilling. Ohne `unique`
   * entstuenden zwei kaufmaennische Koepfe zu einem Vorgang, und FIN-07
   * haette zwei Wege von der Leistung zur Rechnung.
   */
  auftrag_id    uuid not null,
  nummer        text not null,
  bezeichnung   text not null,
  kunde_id      uuid not null,
  objekt_id     uuid,
  art           projekt_art not null,
  status        projekt_status not null default 'geplant',
  vertragsgrundlage bau_vertragsgrundlage not null,
  verantwortlich_benutzer_id uuid references benutzer(id),
  soll_beginn   date,
  soll_ende     date,
  ist_beginn    date,
  ist_ende      date,
  auftragssumme_netto_cent bigint,
  /**
   * In Basispunkten, wie auf `auftrag` (0025) — 250 sind 2,50 %. Ein
   * Prozentsatz als Gleitkommazahl waere die Tuer, durch die eine
   * Nachkommastelle in einen Einbehalt gerat.
   * // TODO(client, O-20): Welcher Sicherheitseinbehalt ist ueblich
   * vereinbart, und wird er durch Buergschaft abgeloest?
   */
  sicherheitseinbehalt_bp integer,
  /**
   * GESPEICHERT, nie berechnet — die Frist haengt am Regime, und das ist offen.
   * // TODO(client, O-68): Gewaehrleistungsfrist je Vertragsart — VOB/B §13
   * Abs. 4 (4 Jahre) vs. BGB §634a (5 Jahre) —, und ab welchem Ereignis laeuft
   * sie?
   */
  gewaehrleistung_bis date,
  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint projekt_mandant_uk unique (mandant_id, id),
  constraint projekt_auftrag_uk unique (mandant_id, auftrag_id),
  constraint projekt_nummer_uk  unique (mandant_id, nummer),
  constraint projekt_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  constraint projekt_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint projekt_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint projekt_nummer_nicht_leer check (btrim(nummer) <> ''),
  constraint projekt_termine check (
    soll_ende is null or soll_beginn is null or soll_ende >= soll_beginn),
  constraint projekt_ist_termine check (
    ist_ende is null or ist_beginn is null or ist_ende >= ist_beginn),
  constraint projekt_einbehalt_bereich check (
    sicherheitseinbehalt_bp is null or sicherheitseinbehalt_bp between 0 and 10000),
  constraint projekt_archiv_paarweise check (
    (archiviert_am is null) = (archiviert_von is null))
);

create index projekt_status_idx on projekt (mandant_id, status, soll_ende)
  where archiviert_am is null;
create index projekt_kunde_idx on projekt (mandant_id, kunde_id);
create index projekt_gewaehrleistung_idx on projekt (mandant_id, gewaehrleistung_bis)
  where gewaehrleistung_bis is not null;

comment on table projekt is
  'BAU: die Bauerweiterung eines Auftrags (§7.1). Ein Projekt IST ein auftrag, '
  'kein zweiter kaufmaennischer Kopf — auftrag_id ist eindeutig.';
comment on column projekt.vertragsgrundlage is
  'VOB/B oder BGB. Ohne Vorgabewert: das Regime entscheidet ueber Nachtrag, '
  'Behinderung, Abnahme und Gewaehrleistung (O-154).';

-- ---------------------------------------------------------------------------
-- 3. leistungsverzeichnis (§7.4)
-- ---------------------------------------------------------------------------

create table leistungsverzeichnis (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  projekt_id    uuid not null,
  /**
   * Die Spalten fuer Nachtrag und Ausschreibung stehen ab der ersten Migration
   * (§19); ihre Fremdschluessel kommen mit PR 44 und dem Radar. Eine Spalte
   * spaeter nachzuruesten hiesse, die Fassung eines Nachtrags-LV nachtraeglich
   * umzuhaengen — und genau das soll die Versionierung verhindern.
   */
  nachtrag_id   uuid,
  ausschreibung_id uuid,
  art           leistungsverzeichnis_art not null,
  bezeichnung   text not null,
  fassung       integer not null default 1,
  quelle_dokument_id uuid,
  gaeb_version  text,
  waehrung      text not null default 'EUR',
  importiert_am timestamptz,
  agent_aufgabe_id uuid,
  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint lv_mandant_uk unique (mandant_id, id),
  constraint lv_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint lv_dokument_fk foreign key (mandant_id, quelle_dokument_id)
    references dokument (mandant_id, id),
  constraint lv_fassung_positiv check (fassung >= 1),
  constraint lv_nachtrag_stimmig check ((art = 'nachtrag') = (nachtrag_id is not null)),
  constraint lv_waehrung check (waehrung = 'EUR'),
  constraint lv_archiv_paarweise check ((archiviert_am is null) = (archiviert_von is null))
);

/**
 * B11: EINE Fassung je (Projekt, Art, Nachtrag) — und beliebig viele
 * nacheinander.
 *
 * Der naheliegende Entwurf („genau ein LV je Nachtrag") macht die Fassung
 * daneben sinnlos: die einzige Art, den Preis eines Nachtrags zu revidieren,
 * waere dann, die Positionen zu ueberschreiben — und damit das Dokument zu
 * vernichten, um das im §2-Abs.-6-Streit gestritten wird.
 */
create unique index lv_fassung_uk on leistungsverzeichnis
  (projekt_id, art,
   coalesce(nachtrag_id, '00000000-0000-0000-0000-000000000000'::uuid),
   fassung);

create unique index lv_nachtrag_aktuell_uk on leistungsverzeichnis (nachtrag_id)
  where nachtrag_id is not null and archiviert_am is null;

create index lv_projekt_idx on leistungsverzeichnis (mandant_id, projekt_id, art);

comment on table leistungsverzeichnis is
  'BAU-01: der Kopf eines Leistungsverzeichnisses mit Herkunft, Fassung und '
  'Waehrung (§7.4). Eine neue Verhandlungsrunde ist eine neue Fassung.';

-- ---------------------------------------------------------------------------
-- 4. lv_position (§7.5) — die OZ-Hierarchie
-- ---------------------------------------------------------------------------

create table lv_position (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  leistungsverzeichnis_id uuid not null,
  /** Vom Kopf abgeleitet (Ausloeser unten) — der Grosselternschluessel (§1.4). */
  projekt_id    uuid not null,
  /**
   * `auftrag_leistung_id`, NICHT `auftrag_id` (02-CRM §3.2): eine LV-Position
   * ist die bauliche Auspraegung einer Auftragszeile. Damit hat FIN-07 einen
   * Weg von der Leistung zur Rechnung und nicht zwei.
   */
  auftrag_leistung_id uuid,
  eltern_id     uuid,

  /** Woertlich wie im LV des Auftraggebers — zeichengleich fuer GAEB-Rueckgabe. */
  oz            text not null,
  /** Materialisierter Pfad der OZ-Stufen, `.`-getrennt (§10.2). */
  pfad          text not null,
  /** Derselbe Pfad, je Stufe auf feste Breite gefuellt — die LV-Ordnung. */
  sortier_pfad  text not null,
  ebene         smallint not null,

  art           lv_art not null,
  positionsart  lv_positionsart not null default 'unbestimmt',
  kurztext      text not null,
  langtext      text,
  einheit       text,
  menge_vertrag numeric(12,3),
  einheitspreis_cent bigint,
  steuer_kennzeichen steuer_kennzeichen,
  gaeb_dp       text,

  /** APR-03: woher der maschinell gelesene Wert stammt, und wie sicher. */
  quelle_seite  integer,
  quelle_bereich jsonb,
  konfidenz     numeric(5,2),
  geprueft_von  uuid references benutzer(id),
  geprueft_am   timestamptz,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint lvp_mandant_uk unique (mandant_id, id),
  /** Der Grosselternschluessel, den `aufmass_zeile` in 0072 braucht (§1.4). */
  constraint lvp_projekt_uk unique (mandant_id, projekt_id, id),
  constraint lvp_kopf_fk foreign key (mandant_id, leistungsverzeichnis_id)
    references leistungsverzeichnis (mandant_id, id),
  constraint lvp_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint lvp_eltern_fk foreign key (mandant_id, eltern_id)
    references lv_position (mandant_id, id),
  constraint lvp_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),

  constraint lvp_oz_nicht_leer check (btrim(oz) <> ''),
  constraint lvp_kurztext_nicht_leer check (btrim(kurztext) <> ''),
  constraint lvp_ebene check (ebene between 1 and 8),
  /** Nur eine Position traegt einen Einzelbetrag — ein Titel rechnet nicht. */
  constraint lvp_preis_nur_position check (art = 'position' or einheitspreis_cent is null),
  constraint lvp_einheit_bei_position check (art <> 'position' or einheit is not null),
  constraint lvp_menge_bei_position check (art <> 'position' or menge_vertrag is not null),
  constraint lvp_konfidenz_bereich check (konfidenz is null or konfidenz between 0 and 100),
  constraint lvp_pruefung_paarweise check ((geprueft_am is null) = (geprueft_von is null)),
  constraint lvp_archiv_paarweise check ((archiviert_am is null) = (archiviert_von is null))
);

create unique index lv_position_oz_uk on lv_position (leistungsverzeichnis_id, oz);
create index lv_position_reihenfolge_idx on lv_position (leistungsverzeichnis_id, sortier_pfad);
create index lv_position_teilbaum_idx
  on lv_position (leistungsverzeichnis_id, pfad text_pattern_ops);
create index lv_position_eltern_idx on lv_position (eltern_id);
/** Die APR-03-Pruefliste: maschinell gelesen und noch von niemandem bestaetigt. */
create index lv_position_pruefung_idx on lv_position (mandant_id, leistungsverzeichnis_id)
  where geprueft_am is null;

comment on table lv_position is
  'BAU-01: eine Zeile des Leistungsverzeichnisses — Los, Titel, Untertitel, '
  'Position oder Hinweistext (§7.5). Kein gespeichertes Produkt aus Menge und '
  'Einheitspreis (§10.3).';
comment on column lv_position.sortier_pfad is
  'Normierter Pfad mit fester Stufenbreite. Ohne ihn stellt jede Textsortierung '
  '1.2.10 vor 1.2.9 — in einem LV mit vierhundert Zeilen faellt das niemandem auf.';

-- ---------------------------------------------------------------------------
-- 5. Die OZ-Ordnung: eine Regel, zwei Fassungen, eine Pruefung
-- ---------------------------------------------------------------------------

/**
 * `1.2.10` → `000001.000002.000010`.
 *
 * **Dieselbe Regel steht in `src/server/services/bau/lv.ts`**
 * (`ozSortierSchluessel`), weil die Datenbank sortiert und die Oberflaeche
 * gruppiert. Zwei Fassungen einer Regel sind eine Fehlerquelle — deshalb
 * vergleicht `tests/isolation/bau-lv.test.ts` beide zeichenweise an denselben
 * Eingaben. Laufen sie auseinander, ist es dieselbe OZ in zwei Ordnungen, und
 * niemand sieht es.
 *
 * Buchstabenzusaetze bleiben stehen und ordnen HINTER ihrer Zahl („0030" vor
 * „0030.A"); Grossschreibung wird fuer die Ordnung eingeebnet, die ANZEIGE
 * bleibt `oz` und damit woertlich.
 *
 * `immutable`, damit ein Ausdrucksindex darauf moeglich waere (K-16: keine
 * volatile Funktion in Bedingung oder Indexpraedikat, §1.13).
 */
create function kern.oz_sortierschluessel(p_oz text) returns text
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(
           (select string_agg(
                     lpad(coalesce(substring(seg from '^[0-9]*'), ''), 6, '0')
                       || lower(coalesce(substring(seg from '^[0-9]*(.*)$'), '')),
                     '.' order by nr)
              from unnest(string_to_array(btrim(coalesce(p_oz, '')), '.'))
                   with ordinality as t(seg, nr)),
           -- Die leere OZ: `string_to_array('', '.')` liefert in Postgres ein
           -- LEERES Feld, in JavaScript ergibt `''.split('.')` dagegen EIN
           -- leeres Segment. Ohne diese Zeile lieferten die beiden Fassungen
           -- der Regel fuer denselben Text zwei Schluessel — und die
           -- Isolationspruefung, die genau das vergleicht, hat es gefunden.
           -- In der Tabelle kann der Fall nicht auftreten (`lvp_oz_nicht_leer`);
           -- eine Funktion, die nur innerhalb ihrer Aufrufer stimmt, ist
           -- trotzdem eine halbe Funktion.
           lpad('', 6, '0'));
$$;

comment on function kern.oz_sortierschluessel(text) is
  'Die LV-Ordnung: jede Stufe auf sechs Stellen gefuellt, damit 1.2.10 hinter '
  '1.2.9 steht. Zwillingsfassung von ozSortierSchluessel in services/bau/lv.ts.';

/**
 * `lvp_pfad_setzen` — Pfad, Sortierpfad, Ebene und Projekt aus dem Elternteil.
 *
 * Drei Dinge, die der Aufrufer NICHT bestimmt, weil sie sonst voneinander
 * abweichen koennten: die Ebene (aus der Tiefe), der Pfad (aus der Kette) und
 * der Mandant/das Projekt (aus dem Kopf).
 *
 * **Der Pfad haengt an der Schreibweise des LV.** Manche Auftraggeber
 * schreiben die volle OZ in jede Stufe („01.02.0030"), andere nur die Stufe
 * selbst („0030"). Traegt die OZ des Kindes den Pfad des Elternteils bereits
 * als Praefix, IST sie der Pfad; sonst wird angehaengt. Beide Schreibweisen
 * ergeben damit einen Pfad, unter dem `pfad like '<eltern>.%'` den Teilbaum
 * findet — und das ist die Eigenschaft, auf der die Titelsumme ruht.
 */
create function kern.lvp_pfad_setzen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_eltern record;
  v_kopf   record;
  v_lauf   uuid;
  v_tiefe  smallint := 0;
begin
  select lv.projekt_id, lv.mandant_id into v_kopf
    from public.leistungsverzeichnis lv
   where lv.id = new.leistungsverzeichnis_id;
  if v_kopf.projekt_id is null then
    raise exception 'Kein Leistungsverzeichnis zu dieser Position'
      using errcode = 'foreign_key_violation';
  end if;
  -- ABGELEITET, nicht uebernommen: sonst waere die Zugehoerigkeit eine Eingabe.
  new.projekt_id := v_kopf.projekt_id;

  if new.eltern_id is null then
    new.pfad  := btrim(new.oz);
    new.ebene := 1;
  else
    select p.id, p.pfad, p.ebene, p.leistungsverzeichnis_id into v_eltern
      from public.lv_position p
     where p.id = new.eltern_id and p.mandant_id = new.mandant_id;
    if v_eltern.id is null then
      raise exception 'Der Elternteil dieser Position gehoert nicht zu dieser Gesellschaft'
        using errcode = 'foreign_key_violation';
    end if;
    if v_eltern.leistungsverzeichnis_id is distinct from new.leistungsverzeichnis_id then
      raise exception 'Eltern- und Kindposition gehoeren zu verschiedenen Verzeichnissen'
        using errcode = 'check_violation',
              hint = 'Eine Hierarchie ueber zwei LV hinweg waere in keiner Ordnung darstellbar.';
    end if;

    /**
     * Ein Zyklus macht den Baum unlesbar UND die Summe unberechenbar — und
     * beides faellt erst auf, wenn eine Abfrage nicht mehr zurueckkommt. Die
     * Kette ist hoechstens acht Stufen lang (`lvp_ebene`), also ist die
     * Schleife endlich.
     */
    v_lauf := new.eltern_id;
    while v_lauf is not null and v_tiefe <= 8 loop
      if v_lauf = new.id then
        raise exception 'Diese Position waere ihr eigener Vorfahr'
          using errcode = 'check_violation';
      end if;
      select p.eltern_id into v_lauf from public.lv_position p where p.id = v_lauf;
      v_tiefe := v_tiefe + 1;
    end loop;

    new.ebene := (v_eltern.ebene + 1)::smallint;
    new.pfad  := case
      when btrim(new.oz) like v_eltern.pfad || '.%' then btrim(new.oz)
      else v_eltern.pfad || '.' || btrim(new.oz)
    end;
  end if;

  new.sortier_pfad := kern.oz_sortierschluessel(new.pfad);
  return new;
end $$;

create trigger trg_lvp_1_pfad
  before insert or update on lv_position
  for each row execute function kern.lvp_pfad_setzen();

/**
 * `lvp_teilbaum_neu` — wird eine Position umgehaengt oder umbenannt, wandert
 * ihr Teilbaum mit.
 *
 * Ohne diesen Ausloeser behielten die Kinder den alten Pfad. Der Baum saehe in
 * der Oberflaeche noch richtig aus (die haengt an `eltern_id`), aber
 * `pfad like '01.02.%'` faende sie nicht mehr — also fehlten sie in der
 * Titelsumme, und die Gesamtsumme stimmte trotzdem. Das ist die
 * unangenehmste Sorte Fehler: zwei Zahlen, beide plausibel, eine falsch.
 *
 * Die Rekursion laeuft ueber den BEFORE-Ausloeser der Kinder und endet an den
 * Blaettern; sie startet nur, wenn sich der Pfad wirklich geaendert hat.
 */
create function kern.lvp_teilbaum_neu() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.pfad is not distinct from old.pfad then
    return null;
  end if;
  update public.lv_position k
     set geaendert_am = now()
   where k.eltern_id = new.id and k.mandant_id = new.mandant_id;
  return null;
end $$;

create trigger trg_lvp_9_teilbaum
  after update on lv_position
  for each row execute function kern.lvp_teilbaum_neu();

-- ---------------------------------------------------------------------------
-- 6. Der Lesepfad des Mitarbeiterportals fuer den Bau (§1.10)
-- ---------------------------------------------------------------------------

/**
 * „Auf welchen PROJEKTEN ist der Aufrufer selbst eingesetzt?"
 *
 * Das Bau-Geschwister von `app.eigene_einsatz_objekte()` (0069) — gleicher
 * Koerper, andere Traegerspalte. §1.10 verlangt es ausdruecklich: die
 * Mitarbeiterdecke auf `lv_position`, `aufmass` und `bautagebuch` haengt am
 * `projekt_id`, und `projekt.objekt_id` ist nullbar — der Objektweg kann sie
 * also gar nicht tragen. Ohne diese Funktion buchte die Kraft vor Ort ihr
 * Aufmass gegen eine LV-Position, die sie nicht lesen darf (BAU-02).
 *
 * **K-20:** loest in allen vier Leseumfaengen auf, haengt NICHT an
 * `app.aktiver_mandant()` — der ist in `person`-Scope NULL. Leeres Array,
 * nie NULL: `= any('{}')` ist falsch, `= any(null)` ist NULL, und eine
 * dreiwertige Decke ist keine.
 */
create function app.eigene_einsatz_projekte()
returns uuid[]
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(array_agg(distinct e.projekt_id), '{}'::uuid[])
    from public.einsatz_zuordnung z
    join public.einsatz e on e.id = z.einsatz_id and e.mandant_id = z.mandant_id
    join public.anstellung a on a.id = z.anstellung_id
   where app.aktuelle_person() is not null
     and a.person_id = app.aktuelle_person()
     and e.projekt_id is not null
     and z.entfernt_am is null
     and z.status <> 'abgesagt'
     and e.storniert_am is null
     and e.ende_zeitpunkt >= now()
     and case app.scope()
           when 'mandant' then e.mandant_id = app.aktiver_mandant()
           when 'person'  then e.mandant_id = any (app.sichtbare_mandanten())
           else false
         end;
$$;

comment on function app.eigene_einsatz_projekte() is
  'Die Bauprojekte der eigenen laufenden und kommenden Einsaetze (§1.10, '
  'BAU-02, BAU-07). Loest in allen vier Leseumfaengen auf (K-20).';

create function app.ist_eingesetzt_auf_projekt(p_projekt uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select p_projekt is not null and p_projekt = any (app.eigene_einsatz_projekte());
$$;

comment on function app.ist_eingesetzt_auf_projekt(uuid) is
  'Ist der Aufrufer auf diesem Bauprojekt eingesetzt (§1.10)? Nie NULL — ein '
  'NULL-Argument ergibt false, sonst vergiftete es die Decke.';

revoke execute on function app.eigene_einsatz_projekte() from public;
revoke execute on function app.ist_eingesetzt_auf_projekt(uuid) from public;
grant execute on function app.eigene_einsatz_projekte() to cse_app, cse_job;
grant execute on function app.ist_eingesetzt_auf_projekt(uuid) to cse_app, cse_job;

/**
 * Der Lesepfad des Definers: unter FORCE RLS liest auch ein
 * `SECURITY DEFINER` nichts, solange der Eigentuemer keine eigene Policy hat —
 * und zwar ohne Fehler. Die Funktion oben gaebe dann fuer jeden ein leeres
 * Array. `einsatz_zuordnung` hat sie seit 0069, `einsatz` seit 0031; hier
 * steht nur die Absicherung fuer den Fall, dass diese Migration vor 0069
 * laeuft.
 */
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'einsatz_zuordnung'
                    and policyname = 'ez_definer') then
    create policy ez_definer on einsatz_zuordnung for select to cse_definer using (true);
    grant select on einsatz_zuordnung to cse_definer;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Zeilenschutz (§1.6, §1.6a, §1.8, K-03)
-- ---------------------------------------------------------------------------

alter table projekt enable row level security;
alter table projekt force  row level security;

create policy t_mandant on projekt for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on projekt for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/** CRM-06: der Kunde sieht seine eigenen Projekte ueber alle Gesellschaften. */
create policy t_kunde on projekt for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden()));

/** Die Kraft vor Ort sieht das Projekt, auf das sie eingeteilt ist (BAU-07). */
create policy t_person on projekt for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and app.ist_eingesetzt_auf_projekt(id));

/**
 * **Und sie sieht es AUCH im Mandanten-Scope, in dem sie ihr Aufmass schreibt.**
 *
 * Der Weg des Formulars laeuft ueber `withTenant` mit genau einem Mandanten
 * (K-18); dort greift `t_person` nicht, und `t_mandant` verlangt `bau.lesen` —
 * ein Recht, das die Rolle `mitarbeiter` ausdruecklich NICHT haelt (§1.7).
 * Ohne diese Policy fände das `insert … select from projekt` des
 * Aufmassdienstes keine Zeile, und die Kraft bekaeme „Projekt nicht gefunden"
 * fuer das Projekt, auf dem sie steht. Das Praedikat ist dasselbe wie in
 * `t_person`: es oeffnet keine Zeile, die dort verschlossen waere.
 */
create policy t_erfassen_lesen on projekt for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
         and app.ist_eingesetzt_auf_projekt(id));

/**
 * EINE Decke mit drei Zweigen, nicht drei Decken (§1.8).
 *
 * Restriktive Policies werden UND-verknuepft: eine Kundendecke neben einer
 * Mitarbeiterdecke ergaebe „Kunde UND Mitarbeiter", also niemanden.
 */
create policy p_portal_decke on projekt as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde' and kunde_id = any (app.aktuelle_kunden()))
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_projekt(id)));

grant select, insert, update on projekt to cse_app;

alter table leistungsverzeichnis enable row level security;
alter table leistungsverzeichnis force  row level security;

create policy t_mandant on leistungsverzeichnis for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on leistungsverzeichnis for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/**
 * §7.4: `p_intern_ceiling`. Das Verzeichnis ist ein internes
 * Kalkulationsdokument — der Kunde sieht sein Angebot und seine Rechnung, nicht
 * die Fassungen dazwischen, und die Kraft vor Ort arbeitet mit der POSITION,
 * nicht mit dem Kopf.
 */
create policy p_intern_decke on leistungsverzeichnis as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on leistungsverzeichnis to cse_app;

alter table lv_position enable row level security;
alter table lv_position force  row level security;

create policy t_mandant on lv_position for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on lv_position for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/**
 * §7.5, §1.8: die Kraft vor Ort MUSS die Position lesen — BAU-02 laesst sie
 * ihre Mengen dagegen buchen. Was sie nicht sieht, ist der Preis, und den
 * haelt der Spalten-GRANT unten zurueck, nicht die Decke. Deshalb kostet es
 * kaufmaennisch nichts, ihr die Zeile zu oeffnen.
 */
create policy t_person on lv_position for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and app.ist_eingesetzt_auf_projekt(projekt_id));

/** Dasselbe eine Ebene tiefer: ohne die Position gaebe es nichts zu buchen. */
create policy t_erfassen_lesen on lv_position for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
         and app.ist_eingesetzt_auf_projekt(projekt_id));

create policy p_portal_decke on lv_position as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_projekt(projekt_id)));

-- ---------------------------------------------------------------------------
-- 8. Spaltenrechte und der Preisleser (K-05, §1.9)
-- ---------------------------------------------------------------------------

/**
 * K-05: **Spalten-GRANT statt Maskierungssicht.** Was hier nicht steht, ist
 * fuer `cse_app` nicht lesbar — auch nicht ueber `select *`, das dann schlicht
 * scheitert. Der Einzelbetrag und sein Steuerkennzeichen fehlen mit Absicht:
 * eine Kraft, die auf der Baustelle Mengen bucht, braucht die Kalkulation des
 * Auftrags nicht, und ein Maskierungsblick gaebe die Spalte trotzdem heraus
 * (K-05: die Sicht liefert den Rohwert daneben mit).
 *
 * Die Liste ist ERSCHOEPFEND — eine Auslassung sieht aus wie eine
 * Entscheidung, solange niemand sie aufschreibt. Also steht sie hier.
 */
revoke select on lv_position from cse_app;
grant  select (id, mandant_id, leistungsverzeichnis_id, projekt_id, auftrag_leistung_id,
               eltern_id, oz, pfad, sortier_pfad, ebene, art, positionsart,
               kurztext, langtext, einheit, menge_vertrag,
               quelle_seite, quelle_bereich, konfidenz, geprueft_von, geprueft_am,
               gaeb_dp, archiviert_am, archiviert_von,
               erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on lv_position to cse_app;   -- OMITTED: einheitspreis_cent, steuer_kennzeichen

grant insert, update on lv_position to cse_app;

/**
 * Der einzige Weg zum Einheitspreis (§1.9).
 *
 * `security definer`, prueft `bau.preis_lesen` UND den aktiven Mandanten noch
 * einmal — die Policy oben gilt fuer einen Definer nicht — und schreibt jeden
 * Zugriff ins `audit_log`.
 *
 * **K-20, ausdruecklich:** ausserhalb des Mandanten-Scopes ist der Leser
 * UNDEFINIERT. In `gruppe`-, `person`- und `kunde`-Scope ist
 * `app.aktiver_mandant()` NULL, die Funktion gibt NULL zurueck und KEINE
 * Policy dieser Domaene ruft sie auf. Die Gruppensicht liest Preise ueber den
 * Berichtsweg der Finanzdomaene, nie hierueber.
 */
create function app.lv_preis_lesen(p_lv_position uuid) returns bigint
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_wert bigint; v_mandant uuid;
begin
  select p.einheitspreis_cent, p.mandant_id into v_wert, v_mandant
    from public.lv_position p where p.id = p_lv_position;
  if v_mandant is null then return null; end if;
  if v_mandant is distinct from app.aktiver_mandant() then return null; end if;
  if not app.hat_recht('bau.preis_lesen', v_mandant) then return null; end if;
  perform app.protokolliere('bau.preis_gelesen', 'lv_position', p_lv_position::text,
                            null, null, v_mandant);
  return v_wert;
end $$;

comment on function app.lv_preis_lesen(uuid) is
  'Der eine Weg zum Einheitspreis einer LV-Position (K-05, §1.9): prueft '
  'bau.preis_lesen und den aktiven Mandanten und protokolliert jeden Zugriff.';

revoke all on function app.lv_preis_lesen(uuid) from public;
grant execute on function app.lv_preis_lesen(uuid) to cse_app;

/** Der Definer selbst muss die Zeile lesen duerfen (§1.10, FORCE RLS). */
create policy lvp_definer on lv_position for select to cse_definer using (true);
grant select on lv_position to cse_definer;

-- ---------------------------------------------------------------------------
-- 9. Die Fremdschluessel, auf die 0028 und 0034 gewartet haben (§14.4)
-- ---------------------------------------------------------------------------

/**
 * Beide Migrationen haben ihre Anweisung woertlich hinterlegt und auf
 * `projekt` gewartet. Ein einspaltiger Fremdschluessel waere nach K-16 ein
 * Pruefungsfehler gewesen — er liesse eine Schicht der Reinigung an einem
 * Bauprojekt der Security haengen. Jetzt gibt es den Elternteil, also gibt es
 * den zusammengesetzten Schluessel.
 */
alter table einsatz add constraint einsatz_projekt_fk
  foreign key (mandant_id, projekt_id) references projekt (mandant_id, id);

alter table zeiteintrag add constraint z_projekt_fk
  foreign key (mandant_id, projekt_id) references projekt (mandant_id, id);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0071)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- projekt (archiv): OPS-05, BAU-01, LEG-01. Am Projekt haengen Leistungsverzeichnis, Aufmass, Abnahme und Rechnungen mit zehnjaehriger Aufbewahrung (§ 147 AO). Ein beendetes Projekt wird abgeschlossen und archiviert; geloescht bliebe eine Schlussrechnung ohne Bauvorhaben stehen.
create trigger trg_projekt_kein_hard_delete
  before delete on projekt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_projekt_kein_truncate
  before truncate on projekt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on projekt from cse_app, cse_anon, cse_checkin, cse_job;

-- leistungsverzeichnis (archiv): BAU-01, BAU-04. Das Verzeichnis ist die Fassung, gegen die abgerechnet wird — und bei einem Nachtrag der Beleg dafuer, was urspruenglich eingereicht wurde (§ 2 Abs. 6 VOB/B). Eine neue Verhandlungsrunde ist eine neue Fassung, nie eine ersetzte Zeile.
create trigger trg_leistungsverzeichnis_kein_hard_delete
  before delete on leistungsverzeichnis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_leistungsverzeichnis_kein_truncate
  before truncate on leistungsverzeichnis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on leistungsverzeichnis from cse_app, cse_anon, cse_checkin, cse_job;

-- lv_position (archiv): BAU-01, BAU-02, FIN-07. Auf der Position stehen Vertragsmenge und Einheitspreis, aus denen jede Einheitspreisrechnung entsteht. Sie zu loeschen macht ein bereits gestelltes Aufmass unlesbar: die Menge bliebe stehen, und niemand wuesste mehr, wofuer sie galt.
create trigger trg_lv_position_kein_hard_delete
  before delete on lv_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lv_position_kein_truncate
  before truncate on lv_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lv_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_projekt_geaendert_am
  before update on projekt
  for each row execute function kern.setze_geaendert_am();
create trigger trg_leistungsverzeichnis_geaendert_am
  before update on leistungsverzeichnis
  for each row execute function kern.setze_geaendert_am();
create trigger trg_lv_position_geaendert_am
  before update on lv_position
  for each row execute function kern.setze_geaendert_am();

create trigger trg_lv_position_audit
  after insert or update or delete on lv_position
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
