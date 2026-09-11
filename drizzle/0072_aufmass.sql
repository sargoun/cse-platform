-- ===========================================================================
-- 0072 — Bau A/2: aufmass, aufmass_zeile, aufmass_foto, aufmass_signatur
--        (BAU-02, BAU-03, 03-GEWERKE.md §7.6 – §7.9, §10.3, §10.4)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md`. Wo dieser Text
-- und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- Ein Aufmass nach § 14 VOB/B ist der Beleg, aus dem eine
-- Einheitspreisrechnung entsteht. Vier Eigenschaften machen es zu einem
-- Beweismittel statt zu einer Notiz, und alle vier stehen als Schema da und
-- nicht als Zusage der Oberflaeche:
--
--  1. **Formel UND Ergebnis** stehen nebeneinander (§10.3). Nur den Text zu
--     speichern hiesse, bei jedem Lesen neu zu rechnen — ein Parserfehler
--     aenderte rueckwirkend abgerechnete Mengen. Nur das Ergebnis zu
--     speichern nimmt dem Pruefer die Nachvollziehbarkeit.
--  2. **Das Ergebnis ist eine GANZE ZAHL in fester Skala** —
--     `ergebnis_skaliert` in 10⁻⁴ der Einheit, bei m² also
--     Quadratzentimeter. `menge numeric(12,3)` ist die PROJEKTION dieser
--     einen Zahl (Bedingung `az_menge_projektion`), keine zweite Rechnung:
--     zwei unabhaengig gerundete Mengen an derselben Zeile waeren zwei
--     Antworten auf die Frage, was abgerechnet wird.
--  3. **Ohne Foto und ohne Gegenzeichnung wird nichts festgeschrieben**
--     (BAU-03). Beides sind Ausloeser, nicht Formularpflichtfelder.
--  4. **Ein einseitiges Aufmass ist nicht „gegengezeichnet"** (Review B10).
--     Der Zustand heisst `einseitig_festgestellt` und ist ein eigener. Eine
--     Unterschrift des Auftragnehmers, die im Datensatz aussieht wie die
--     Teilnahme des Auftraggebers, waere eine Falschbeurkundung in einem
--     eingefrorenen, gehashten Dokument.
--
-- NICHT in dieser Migration: Einheitspreisabrechnung (PR 48), Nachtraege
-- (PR 44), GAEB-Rueckgabe, der naechtliche Nachrechnungslauf (PR 45).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.3)
-- ---------------------------------------------------------------------------

create type aufmass_erhebungsart as enum ('gemeinsam','einseitig');   -- §14 VOB/B

/**
 * B10: `einseitig_festgestellt` ist ein EIGENER Endzustand. Er traegt anderes
 * Beweisgewicht im Werklohnprozess als eine gemeinsame Feststellung, und die
 * Rechnung entscheidet einzeln ueber ihn.
 * // TODO(client, O-156): Unter welchen Voraussetzungen wird ein einseitiges
 * Aufmass abgerechnet — Ankuendigungsfrist, Teilnahmeaufforderung,
 * Widerspruchsfrist (§14 Abs. 2 VOB/B)?
 */
create type aufmass_status as enum
  ('entwurf','vorgelegt','gegengezeichnet','einseitig_festgestellt','abgelehnt','storniert');

create type aufmass_foto_zweck as enum ('nachweis','uebersicht','detail');

-- ---------------------------------------------------------------------------
-- 2. aufmass (§7.6)
-- ---------------------------------------------------------------------------

create table aufmass (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  projekt_id    uuid not null,
  /** Denormalisiert vom Projekt — die Kundendecke darf keinen Join brauchen. */
  kunde_id      uuid not null,
  auftrag_leistung_id uuid,
  leistungsverzeichnis_id uuid,

  nummer        text not null,
  bezeichnung   text not null,
  bereich       text,
  /** Der BERLINER Kalendertag der Messung (K-11), nie ein UTC-Tag. */
  messdatum     date not null,
  erhebungsart  aufmass_erhebungsart not null,
  status        aufmass_status not null default 'entwurf',
  /** §14 Abs. 2 VOB/B: ohne Ankuendigung keine einseitige Feststellung. */
  ankuendigung_am date,
  aufgenommen_von_anstellung_id uuid,

  /** Mit der Gegenzeichnung gesetzt — ab hier ist das Blatt eingefroren. */
  gesperrt_am   timestamptz,

  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint aufmass_mandant_uk unique (mandant_id, id),
  constraint aufmass_nummer_uk unique (projekt_id, nummer),
  constraint aufmass_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint aufmass_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint aufmass_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint aufmass_lv_fk foreign key (mandant_id, leistungsverzeichnis_id)
    references leistungsverzeichnis (mandant_id, id),
  constraint aufmass_anstellung_fk foreign key (mandant_id, aufgenommen_von_anstellung_id)
    references anstellung (mandant_id, id),
  constraint aufmass_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references aufmass (mandant_id, id),

  constraint aufmass_nummer_nicht_leer check (btrim(nummer) <> ''),
  constraint aufmass_bezeichnung_nicht_leer check (btrim(bezeichnung) <> ''),
  /** Ein Endzustand ohne Sperrzeitpunkt waere ein Dokument ohne Datum. */
  constraint aufmass_gesperrt_bei_abschluss check (
    status not in ('gegengezeichnet','einseitig_festgestellt') or gesperrt_am is not null),
  constraint aufmass_einseitig_angekuendigt check (
    status <> 'einseitig_festgestellt' or ankuendigung_am is not null),
  constraint aufmass_storno_begruendet check (
    storniert_am is null or (storniert_von is not null and btrim(coalesce(storno_grund,'')) <> ''))
);

create index aufmass_projekt_idx on aufmass (mandant_id, projekt_id, messdatum desc);
/** Die Rechnungsvorbereitung (FIN-01 „Einheitspreis nach Aufmass", FIN-08). */
create index aufmass_abrechenbar_idx on aufmass (mandant_id, projekt_id, status)
  where status in ('gegengezeichnet','einseitig_festgestellt') and storniert_am is null;
/** Die Wache „vorgelegt und seit Tagen nicht gegengezeichnet". */
create index aufmass_offen_idx on aufmass (mandant_id, status) where status = 'vorgelegt';

comment on table aufmass is
  'BAU-02: ein Aufmassblatt nach § 14 VOB/B — die festgestellte Menge eines '
  'Leistungsabschnitts und die Grundlage der Einheitspreisabrechnung.';
comment on column aufmass.status is
  'B10: „gegengezeichnet" heisst, der AUFTRAGGEBER hat unterschrieben. Eine '
  'einseitige Feststellung ist ein eigener Zustand, kein Ersatz dafuer.';

-- ---------------------------------------------------------------------------
-- 3. aufmass_zeile (§7.7) — Rechenansatz und Ergebnis nebeneinander
-- ---------------------------------------------------------------------------

create table aufmass_zeile (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  aufmass_id    uuid not null,
  /** Der Grosselternschluessel (§1.4) — ohne ihn misst man gegen ein fremdes LV. */
  projekt_id    uuid not null,
  kunde_id      uuid not null,
  /** Der Zustand des Kopfes, heruntergeschrieben: Decken duerfen nicht joinen. */
  kopf_status   aufmass_status not null default 'entwurf',
  kopf_gesperrt_am timestamptz,
  kopf_storniert_am timestamptz,
  kopf_aufgenommen_von_anstellung_id uuid,

  lv_position_id uuid,
  nachtrag_id   uuid,
  /** BAU-05: Leistung ausserhalb des Leistungsverzeichnisses. */
  ausserhalb_lv boolean not null default false,
  reihenfolge   smallint not null,
  bezeichnung   text not null,

  /** Woertlich, wie der Polier ihn geschrieben hat (BAU-02, §10.3). */
  rechenansatz  text not null,
  /** Der geparste Baum — der Beleg, dass die Zahl aus DIESER Formel stammt. */
  rechenansatz_ast jsonb,
  /** Welcher Parserbau das Ergebnis erzeugt hat (§10.3). */
  parser_version text,

  /**
   * Das Ergebnis in FESTER SKALA als ganze Zahl: 10⁻⁴ der Einheit, bei m²
   * also Quadratzentimeter. `30,87 m²` steht hier als `308700`.
   *
   * Warum nicht nur `menge`: eine Dezimalspalte laedt dazu ein, mit ihr zu
   * rechnen, und jede Zwischenrechnung rundet dann ein zweites Mal. Die ganze
   * Zahl ist die eine gerundete Groesse, und `menge` ist ihre Projektion.
   */
  ergebnis_skaliert bigint not null,
  /** Die Menge, wie die Domaene sie fuehrt (§1.1, K-16) — projiziert, nie gerechnet. */
  menge         numeric(12,3) not null,
  einheit       text not null,

  /**
   * // TODO(client, O-23): Welche Uebermessungsregeln (ATV je Gewerk, DIN
   * 18299 ff.) sind vereinbart, und werden Oeffnungen unter einer Grenzflaeche
   * uebermessen? Bis zur Antwort wendet der Parser KEINE Abzugsregel an — er
   * rechnet genau das, was der Mensch geschrieben hat — und dieses Feld haelt
   * fest, worauf sich die Beteiligten vor Ort geeinigt haben.
   */
  uebermessung_hinweis text,
  bemerkung     text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint aufmass_zeile_mandant_uk unique (mandant_id, id),
  /** FK-Ziel fuer `aufmass_foto` (§1.4). */
  constraint aufmass_zeile_blatt_uk unique (mandant_id, aufmass_id, id),
  constraint az_kopf_fk foreign key (mandant_id, aufmass_id)
    references aufmass (mandant_id, id),
  constraint az_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  /** §1.4: gegen die LV-Position DIESES Projekts, nie gegen die eines anderen. */
  constraint az_lv_position_fk foreign key (mandant_id, projekt_id, lv_position_id)
    references lv_position (mandant_id, projekt_id, id),
  constraint az_reihenfolge_uk unique (aufmass_id, reihenfolge) deferrable initially immediate,

  constraint az_bezeichnung_nicht_leer check (btrim(bezeichnung) <> ''),
  constraint az_rechenansatz_nicht_leer check (btrim(rechenansatz) <> ''),
  constraint az_einheit_nicht_leer check (btrim(einheit) <> ''),
  /** Eine Zeile haengt an einer LV-Position oder ist ausdruecklich ausserhalb. */
  constraint az_bezug check (lv_position_id is not null or ausserhalb_lv),
  /**
   * `menge` IST die Projektion von `ergebnis_skaliert` — nachgerechnet von der
   * Datenbank. Ohne diese Bedingung koennten Formel, ganze Zahl und Menge drei
   * verschiedene Dinge sagen, und die Rechnung nur eines davon.
   *
   * KEINE Vorzeichenbedingung: Rueckbau- und Abzugszeilen sind negativ (§7.7).
   */
  constraint az_menge_projektion check (
    menge = round(ergebnis_skaliert::numeric / 10000, 3))
);

create index aufmass_zeile_blatt_idx on aufmass_zeile (aufmass_id, reihenfolge);
/** Die aufgelaufene Menge je LV-Position — Mengenmehrung §2 Abs. 3, FIN-08. */
create index aufmass_zeile_lv_idx on aufmass_zeile (mandant_id, lv_position_id)
  where lv_position_id is not null;
/** BAU-05: Leistung ausserhalb des LV, zu der es keinen Nachtrag gibt. */
create index aufmass_zeile_bau05_idx on aufmass_zeile (mandant_id, aufmass_id)
  where ausserhalb_lv and nachtrag_id is null;

comment on column aufmass_zeile.ergebnis_skaliert is
  'Das Ergebnis in fester Skala als ganze Zahl (10⁻⁴ der Einheit; bei m² '
  'Quadratzentimeter). Gerundet wird genau einmal, im Parser, am Ende.';
comment on column aufmass_zeile.rechenansatz is
  'BAU-02: die Formel woertlich, wie sie vor Ort geschrieben wurde. Sie wird '
  'neben dem Ergebnis angezeigt und nie normiert.';

-- ---------------------------------------------------------------------------
-- 4. aufmass_foto (§7.8) — die Fotopflicht aus BAU-03
-- ---------------------------------------------------------------------------

create table aufmass_foto (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  aufmass_id    uuid not null,
  aufmass_zeile_id uuid,
  kunde_id      uuid not null,
  kopf_status   aufmass_status not null default 'entwurf',
  kopf_gesperrt_am timestamptz,
  kopf_storniert_am timestamptz,
  kopf_aufgenommen_von_anstellung_id uuid,

  /**
   * Die Aufnahme liegt in `einsatz_medien` (0041) und nicht in `medien`:
   * `medien` ist die Website-Ablage mit oeffentlichen Bildern, `einsatz_medien`
   * ist der private Bucket mit Magic-Byte-Pruefung, EXIF-Entfernung und
   * ausschliesslich signierten Adressen (DOC-03, DOC-06, TIM-10). Denselben
   * Weg benutzt die Unterschrift des Leistungsnachweises (0066), und ein
   * zweiter Speicherweg fuer dieselbe Art Beweisfoto waere ein zweiter Satz
   * Aufbewahrungsregeln.
   */
  medien_id     uuid not null,
  zweck         aufmass_foto_zweck not null default 'nachweis',
  reihenfolge   smallint not null default 0,
  beschreibung  text,

  /**
   * SERVEREINGANG, nicht Aufnahmezeit (§7.8, Review MINOR): mit der
   * Offline-Warteschlange (TIM-09) liegen beide Stunden auseinander, und ein
   * Beweisfoto darf sich nicht so lesen, als sei es beim Hochladen entstanden.
   */
  empfangen_am  timestamptz not null default now(),
  geraete_zeit  timestamptz,
  zeitabweichung_sek integer,
  nachgetragen  boolean not null default false,

  /**
   * EIN Punkt, nie eine Spur (LEG-10). Er dokumentiert den GEMESSENEN ORT,
   * nicht die Bewegung eines Menschen — und nur, wenn
   * `app.einstellung('geo.erfassung_erlaubt')` wahr ist.
   * // TODO(client, O-06): Gibt es einen Betriebsrat? Ein Standortdatum an
   * einer Aufnahme der eigenen Kraft ist nach §87 Abs. 1 Nr. 6 BetrVG
   * mitbestimmungspflichtig.
   */
  breitengrad   numeric(9,6),
  laengengrad   numeric(9,6),

  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  -- Auditblock — ANFUEGEND, also ohne `geaendert_*`.
  erstellt_am   timestamptz not null default now(),
  erstellt_von_art akteur_art not null default 'mensch',
  erstellt_von  uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id uuid,

  primary key (id),
  constraint aufmass_foto_mandant_uk unique (mandant_id, id),
  constraint af_kopf_fk foreign key (mandant_id, aufmass_id)
    references aufmass (mandant_id, id),
  constraint af_zeile_fk foreign key (mandant_id, aufmass_id, aufmass_zeile_id)
    references aufmass_zeile (mandant_id, aufmass_id, id),
  constraint af_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint af_medien_fk foreign key (mandant_id, medien_id)
    references einsatz_medien (mandant_id, id),
  constraint af_medien_uk unique (aufmass_id, medien_id),
  constraint af_geo_paarweise check ((breitengrad is null) = (laengengrad is null)),
  constraint af_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index aufmass_foto_blatt_idx on aufmass_foto (aufmass_id, reihenfolge);
create index aufmass_foto_zeile_idx on aufmass_foto (aufmass_zeile_id)
  where aufmass_zeile_id is not null;

comment on table aufmass_foto is
  'BAU-03: die bildliche Unterlegung einer Messung. Ohne mindestens eine '
  'Aufnahme mit zweck = nachweis wird kein Blatt vorgelegt.';

-- ---------------------------------------------------------------------------
-- 5. aufmass_signatur (§7.9) — Unterschrift, Serverzeit, Schnappschuss
-- ---------------------------------------------------------------------------

create table aufmass_signatur (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  aufmass_id    uuid not null,
  kunde_id      uuid not null,
  kopf_status   aufmass_status not null default 'entwurf',
  kopf_storniert_am timestamptz,

  rolle         unterschrift_rolle not null,
  /** Nur bei `auftragnehmer` — der Kunde hat keine Beschaeftigung bei uns (D-09). */
  anstellung_id uuid,
  unterzeichner_name text not null,
  unterzeichner_funktion text,

  /** SERVERZEIT (Invariante 5, TIM-08) — gestempelt, nicht per Vorgabewert. */
  unterzeichnet_am timestamptz not null default now(),
  geraete_zeit  timestamptz,
  zeitabweichung_sek integer,
  nachgetragen  boolean not null default false,

  breitengrad   numeric(9,6),
  laengengrad   numeric(9,6),
  signatur_medien_id uuid,

  /** Die Zeilen mit Rechenansaetzen, Mengen und Einheiten wie angezeigt (§10.4). */
  snapshot      jsonb not null,
  snapshot_hash text not null,
  /** „unter Vorbehalt der Pruefung" — rechtlich erheblich, nie nur eine Notiz. */
  vorbehalt     text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von_art akteur_art not null default 'mensch',
  erstellt_von  uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id uuid,

  primary key (id),
  constraint aufmass_signatur_mandant_uk unique (mandant_id, id),
  constraint as_kopf_fk foreign key (mandant_id, aufmass_id)
    references aufmass (mandant_id, id),
  constraint as_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint as_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint as_medien_fk foreign key (mandant_id, signatur_medien_id)
    references einsatz_medien (mandant_id, id),
  /** Je Rolle genau eine Unterschrift — zwei waeren zwei Dokumente. */
  constraint aufmass_signatur_uk unique (aufmass_id, rolle),
  constraint as_name_gefuellt check (btrim(unterzeichner_name) <> ''),
  constraint as_auftragnehmer_hat_anstellung check (
    rolle <> 'auftragnehmer' or anstellung_id is not null),
  constraint as_hash_form check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint as_geo_paarweise check ((breitengrad is null) = (laengengrad is null)),
  constraint as_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index aufmass_signatur_zeit_idx on aufmass_signatur (mandant_id, unterzeichnet_am desc);

-- ---------------------------------------------------------------------------
-- 6. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `aufmass_kind_erben` — Kunde, Projekt und Kopfzustand kommen VOM KOPF.
 *
 * Sie werden abgeleitet und nicht uebernommen. Waeren sie eine Eingabe,
 * koennte eine Zeile behaupten, zu einem anderen Kunden zu gehoeren als ihr
 * Blatt — und genau darauf ruhen die Kundendecke und `t_kunde`, die aus gutem
 * Grund nicht ueber den Elternteil joinen duerfen (§1.8).
 */
create function kern.aufmass_kind_erben() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare k record;
begin
  select a.kunde_id, a.projekt_id, a.status, a.gesperrt_am, a.storniert_am,
         a.aufgenommen_von_anstellung_id
    into k
    from public.aufmass a
   where a.id = new.aufmass_id and a.mandant_id = new.mandant_id;
  if k.kunde_id is null then
    raise exception 'Zu dieser Zeile gibt es kein Aufmassblatt in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;

  new.kunde_id    := k.kunde_id;
  new.kopf_status := k.status;
  new.kopf_storniert_am := k.storniert_am;
  if tg_table_name in ('aufmass_zeile','aufmass_foto') then
    new.kopf_gesperrt_am := k.gesperrt_am;
    new.kopf_aufgenommen_von_anstellung_id := k.aufgenommen_von_anstellung_id;
  end if;
  if tg_table_name = 'aufmass_zeile' then
    new.projekt_id := k.projekt_id;
  end if;
  return new;
end $$;

create trigger trg_az_1_erben
  before insert or update on aufmass_zeile
  for each row execute function kern.aufmass_kind_erben();
create trigger trg_af_1_erben
  before insert or update on aufmass_foto
  for each row execute function kern.aufmass_kind_erben();
create trigger trg_as_1_erben
  before insert or update on aufmass_signatur
  for each row execute function kern.aufmass_kind_erben();

/**
 * `aufmass_kopf_denorm` — aendert sich der Kopf, wandert sein Zustand nach unten.
 *
 * Ohne diesen Ausloeser bliebe `kopf_status` an den Kindern auf `entwurf`
 * stehen, nachdem das Blatt gegengezeichnet wurde: der Kunde saehe seine
 * eigenen, unterschriebenen Zeilen NICHT (die Decke verlangt
 * `kopf_status <> 'entwurf'`), und niemand bekaeme eine Fehlermeldung — nur
 * eine leere Liste.
 */
create function kern.aufmass_kopf_denorm() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status is not distinct from old.status
     and new.gesperrt_am is not distinct from old.gesperrt_am
     and new.storniert_am is not distinct from old.storniert_am
     and new.aufgenommen_von_anstellung_id
         is not distinct from old.aufgenommen_von_anstellung_id then
    return null;
  end if;

  update public.aufmass_zeile z
     set kopf_status = new.status, kopf_gesperrt_am = new.gesperrt_am,
         kopf_storniert_am = new.storniert_am,
         kopf_aufgenommen_von_anstellung_id = new.aufgenommen_von_anstellung_id
   where z.aufmass_id = new.id and z.mandant_id = new.mandant_id;

  update public.aufmass_foto f
     set kopf_status = new.status, kopf_gesperrt_am = new.gesperrt_am,
         kopf_storniert_am = new.storniert_am,
         kopf_aufgenommen_von_anstellung_id = new.aufgenommen_von_anstellung_id
   where f.aufmass_id = new.id and f.mandant_id = new.mandant_id;

  update public.aufmass_signatur s
     set kopf_status = new.status, kopf_storniert_am = new.storniert_am
   where s.aufmass_id = new.id and s.mandant_id = new.mandant_id;
  return null;
end $$;

create trigger trg_aufmass_9_denorm
  after update on aufmass
  for each row execute function kern.aufmass_kopf_denorm();

/**
 * `aufmass_zeile_einheit` — die Einheit der Zeile IST die der LV-Position (§1.4).
 *
 * Eine in `m` gemessene Zeile, gebucht gegen eine in `m²` bepreiste Position,
 * ergibt einen falschen Rechnungsbetrag, der strukturell unsichtbar ist: der
 * Fremdschluessel stimmt, die Zeilenschutzregel stimmt, und der
 * Nachrechnungslauf prueft die FORMEL, nicht ihr Ziel. Umgerechnet wird
 * NICHT — der Faktor zwischen `m` und `m²` ist keine Tatsache, ueber die die
 * Datenbank verfuegt.
 *
 * Zusaetzlich haelt der Ausloeser die maschinell gelesene, ungepruefte
 * Position fern (K-10, APR-03, §7.5): ein Preis, den ein Modell aus einem PDF
 * gelesen hat, darf keine abrechenbare Menge tragen, bevor ein benannter
 * Mensch ihn bestaetigt hat.
 */
create function kern.aufmass_zeile_einheit() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare p record;
begin
  if new.lv_position_id is null then return new; end if;
  select l.einheit, l.oz, l.konfidenz, l.geprueft_am into p
    from public.lv_position l
   where l.id = new.lv_position_id and l.mandant_id = new.mandant_id;
  if p.oz is null then
    raise exception 'Die LV-Position dieser Zeile gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;
  if p.einheit is distinct from new.einheit then
    raise exception 'Einheit % passt nicht zur LV-Position % (%)',
                    new.einheit, p.oz, p.einheit
      using errcode = 'check_violation',
            hint = 'Umgerechnet wird nicht: der Faktor zwischen den Einheiten ist '
                   || 'keine Tatsache, ueber die die Datenbank verfuegt.';
  end if;
  return new;
end $$;

create trigger trg_az_2_einheit
  before insert or update on aufmass_zeile
  for each row execute function kern.aufmass_zeile_einheit();

/**
 * `aufmass_vorlage_pruefen` — BAU-03 und K-10 als Eigenschaft des Schemas.
 *
 * Zwei Tore am selben Uebergang, weil beide dort und nur dort gelten:
 *
 *  - **Fotopflicht** (BAU-03): kein Blatt verlaesst den Entwurf ohne
 *    mindestens eine Aufnahme mit `zweck = 'nachweis'`. Ein Pflichtfeld im
 *    Formular waere eine Bitte an den Browser.
 *  - **Geprueftes LV** (§7.5): keine Zeile darf auf eine maschinell
 *    extrahierte, unbestaetigte LV-Position zeigen. Sonst wanderte eine Zahl,
 *    die ein Modell aus einem PDF gelesen hat, ueber die Aufmassmenge in eine
 *    Rechnung — mit einem gruenen Haken daneben.
 */
create function kern.aufmass_vorlage_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_offen text;
begin
  if old.status <> 'entwurf' or new.status = 'entwurf' then
    return new;
  end if;

  if not exists (select 1 from public.aufmass_foto f
                  where f.aufmass_id = new.id and f.zweck = 'nachweis') then
    raise exception 'Ohne Messfoto wird kein Aufmass vorgelegt (BAU-03)'
      using errcode = 'check_violation',
            hint = 'Mindestens eine Aufnahme mit zweck = nachweis ist Pflicht.';
  end if;

  select string_agg(l.oz, ', ' order by l.sortier_pfad) into v_offen
    from public.aufmass_zeile z
    join public.lv_position l on l.id = z.lv_position_id
   where z.aufmass_id = new.id
     and l.konfidenz is not null and l.geprueft_am is null;

  if v_offen is not null then
    raise exception 'Ungepruefte maschinell gelesene LV-Positionen: %', v_offen
      using errcode = 'check_violation',
            detail = 'APR-03, K-10: eine maschinell gelesene Zahl wird erst '
                     || 'abrechenbar, wenn ein benannter Mensch sie bestaetigt hat.',
            hint = 'Die Positionen im Leistungsverzeichnis pruefen und freigeben.';
  end if;
  return new;
end $$;

create trigger trg_aufmass_2_vorlage
  before update on aufmass
  for each row execute function kern.aufmass_vorlage_pruefen();

/**
 * `aufmass_einfrieren` — ab der Sperre aendert sich nichts mehr (§10.4, LEG-01).
 *
 * Ein gegengezeichnetes Aufmass ist ein Beweismittel. Korrigiert wird es
 * durch Stornieren und ein Ersatzblatt (`ersetzt_durch_id`), nie durch ein
 * UPDATE — ein Dokument, dessen Inhalt sich nach der Unterschrift noch
 * bewegen laesst, belegt nichts.
 *
 * Erlaubt bleiben genau die Spalten, die NACH der Sperre entstehen: die
 * Aufbewahrungsfrist (der Job setzt sie) und der Storno selbst.
 */
create function kern.aufmass_einfrieren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.gesperrt_am is null then return new; end if;

  if new.projekt_id is distinct from old.projekt_id
     or new.kunde_id is distinct from old.kunde_id
     or new.nummer is distinct from old.nummer
     or new.bezeichnung is distinct from old.bezeichnung
     or new.bereich is distinct from old.bereich
     or new.messdatum is distinct from old.messdatum
     or new.erhebungsart is distinct from old.erhebungsart
     or new.ankuendigung_am is distinct from old.ankuendigung_am
     or new.leistungsverzeichnis_id is distinct from old.leistungsverzeichnis_id
     or new.auftrag_leistung_id is distinct from old.auftrag_leistung_id
     or new.aufgenommen_von_anstellung_id is distinct from old.aufgenommen_von_anstellung_id
     or new.gesperrt_am is distinct from old.gesperrt_am
     or (new.status is distinct from old.status and new.status <> 'storniert') then
    raise exception 'Ein gegengezeichnetes Aufmass ist unveraenderlich (§14 VOB/B, LEG-01)'
      using errcode = 'check_violation',
            hint = 'Korrigiert wird durch Storno und ein Ersatzblatt, nie durch Aendern.';
  end if;
  return new;
end $$;

create trigger trg_aufmass_3_einfrieren
  before update on aufmass
  for each row execute function kern.aufmass_einfrieren();

/**
 * `aufmass_zeile_einfrieren` — dasselbe eine Ebene tiefer.
 *
 * Der Kopf traegt die Sperre, die Zeile traegt die Menge. Ohne diesen
 * Ausloeser liesse sich der Rechenansatz einer unterschriebenen Zeile
 * nachtraeglich aendern, waehrend der Schnappschuss der Unterschrift etwas
 * anderes sagt — und beide sind dann unglaubwuerdig.
 */
create function kern.aufmass_zeile_einfrieren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.kopf_gesperrt_am is null then return new; end if;
  if new.rechenansatz is distinct from old.rechenansatz
     or new.ergebnis_skaliert is distinct from old.ergebnis_skaliert
     or new.menge is distinct from old.menge
     or new.einheit is distinct from old.einheit
     or new.lv_position_id is distinct from old.lv_position_id
     or new.bezeichnung is distinct from old.bezeichnung then
    raise exception 'Die Zeile eines gegengezeichneten Aufmasses ist unveraenderlich'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_az_3_einfrieren
  before update on aufmass_zeile
  for each row execute function kern.aufmass_zeile_einfrieren();

/**
 * `aufmass_feldzeit` — Serverzeit auf die massgebliche Spalte, Geraetezeit
 * daneben, Abweichung abgeleitet (Invariante 5, TIM-08).
 *
 * Das Bau-Geschwister von `kern.stempel_feldzeit()` (0034), das an den
 * Spaltennamen des Zeiteintrags haengt. Die Abweichung wird IMMER abgeleitet:
 * dass ein Tablet zwei Stunden falsch geht, ist eine Tatsache des Protokolls
 * und keine Zeitangabe im Dokument.
 */
create function kern.aufmass_feldzeit() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_server timestamptz := now();
begin
  if tg_table_name = 'aufmass_foto' then
    new.empfangen_am := v_server;
  else
    new.unterzeichnet_am := v_server;
  end if;
  if new.geraete_zeit is not null then
    new.zeitabweichung_sek :=
      round(extract(epoch from (new.geraete_zeit - v_server)))::integer;
  end if;
  return new;
end $$;

create trigger trg_af_2_feldzeit
  before insert on aufmass_foto
  for each row execute function kern.aufmass_feldzeit();
create trigger trg_as_2_feldzeit
  before insert on aufmass_signatur
  for each row execute function kern.aufmass_feldzeit();

/**
 * `aufmass_status_setzen` — die Unterschrift bewegt den Kopf, nicht der Aufrufer.
 *
 * **Und ein einseitiges Aufmass wird dabei NICHT „gegengezeichnet" (B10).**
 * Der Entwurf, den dieser Ausloeser ersetzt, hob das Blatt auf
 * `gegengezeichnet`, sobald der AUFTRAGNEHMER unterschrieben hatte und die
 * Erhebungsart `einseitig` war. Der Datensatz behauptete danach eine
 * Teilnahme des Auftraggebers, die es nicht gab, und der Abrechnungsindex
 * reichte solche Blaetter direkt in die Rechnung.
 */
create function kern.aufmass_status_setzen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare k record;
begin
  select a.status, a.erhebungsart, a.ankuendigung_am into k
    from public.aufmass a where a.id = new.aufmass_id;

  if new.rolle = 'auftraggeber' then
    update public.aufmass
       set status = 'gegengezeichnet', gesperrt_am = coalesce(gesperrt_am, now())
     where id = new.aufmass_id and status in ('entwurf','vorgelegt');
    return null;
  end if;

  -- Auftragnehmerunterschrift: nur die EINSEITIGE Feststellung, und nur mit
  -- Ankuendigung (§14 Abs. 2 VOB/B).
  if k.erhebungsart = 'einseitig' and k.ankuendigung_am is not null then
    update public.aufmass
       set status = 'einseitig_festgestellt', gesperrt_am = coalesce(gesperrt_am, now())
     where id = new.aufmass_id and status in ('entwurf','vorgelegt');
  end if;
  return null;
end $$;

create trigger trg_as_9_status
  after insert on aufmass_signatur
  for each row execute function kern.aufmass_status_setzen();

/** Eine Unterschrift wird nicht bearbeitet. Sie ist ein Ereignis. */
create function kern.aufmass_signatur_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE'
     and (new.rolle is distinct from old.rolle
          or new.unterzeichner_name is distinct from old.unterzeichner_name
          or new.snapshot is distinct from old.snapshot
          or new.snapshot_hash is distinct from old.snapshot_hash
          or new.unterzeichnet_am is distinct from old.unterzeichnet_am) then
    raise exception 'Eine Unterschrift wird nicht nachtraeglich geaendert'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_as_3_unveraenderlich
  before update on aufmass_signatur
  for each row execute function kern.aufmass_signatur_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 7. Das Medienregister (0041 §5.8.1)
-- ---------------------------------------------------------------------------

/**
 * `aufmass` wird Bezugstabelle des privaten Medienbuckets.
 *
 * 0041 fuehrt die zulaessigen Elterntabellen als GESCHLOSSENE Liste, weil
 * `kern.einsatz_medien_bezug_pruefen()` den Namen in eine dynamische Anweisung
 * setzt — ein Registereintrag ist damit die einzige Quelle eines
 * Tabellennamens und es gibt keine Einschleusungsflaeche. Die Liste soll
 * wachsen, wenn eine Tabelle entsteht (0041 §14 nennt das ausdruecklich); sie
 * wird deshalb hier erweitert und nicht umgangen.
 *
 * Modul `bau` und `kunde_pfad = 'kunde_id'`: das Recht am Elternteil ist
 * `bau.lesen` / `bau.schreiben` (§1.7), und die Kundensichtbarkeit des Fotos
 * leitet der Ausloeser aus dem Kopf ab, statt sie sich sagen zu lassen.
 */
alter table einsatz_medien_bezug drop constraint mb_bekannt;
alter table einsatz_medien_bezug add constraint mb_bekannt
  check (tabelle in ('zeiteintrag','einsatz','wachbuch_eintrag','bautagebuch',
                     'leistungsnachweis','reklamation','qualitaetspruefung','aufmass'));

insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad)
values ('aufmass','bau','kunde_id')
on conflict (tabelle) do nothing;

/**
 * Und der schmale Schreib- und Lesepfad fuer genau diese Bezugsart.
 *
 * `einsatz_medien` traegt seit 0041 eine `t_mandant`-Policy auf dem Modul
 * `zeit`. Eine Bauleitung haelt `bau.schreiben` und kein einziges Zeitrecht —
 * ohne die beiden Policies hier scheiterte das Anhaengen eines Messfotos
 * daran, dass die Aufnahme dem falschen Modul zugerechnet wird, und BAU-03
 * waere nicht erfuellbar.
 *
 * Beide sind PERMISSIV und auf `bezug_tabelle = 'aufmass'` eingeschnuert:
 * permissive Policies werden ODER-verknuepft, also oeffnen sie genau diese
 * Zeilen und keine anderen. Die restriktiven Decken von 0041 (Mitarbeiter auf
 * die eigenen Aufnahmen, Kunde auf den eigenen Kunden) gelten unveraendert
 * darueber — eine Decke laesst sich durch eine permissive Policy nicht
 * aufheben.
 */
create policy t_bau_medien on einsatz_medien for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and bezug_tabelle = 'aufmass'
              and ((select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
                   or (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))));

create policy t_bau_medien_lesen on einsatz_medien for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and bezug_tabelle = 'aufmass'
         and ((select app.hat_recht('bau.lesen', app.aktiver_mandant()))
              or (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))));

-- ---------------------------------------------------------------------------
-- 8. Zeilenschutz (§1.6, §1.6a, §1.8)
-- ---------------------------------------------------------------------------

alter table aufmass enable row level security;
alter table aufmass force  row level security;

create policy t_mandant on aufmass for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * **Der Schreibweg der Kraft vor Ort** (BAU-02, §1.7).
 *
 * `mitarbeiter` haelt `bau.aufmass_erfassen` und NICHT `bau.schreiben` — das
 * ist einer der fuenf Schluessel, die diese Rolle ueberhaupt besitzt. Ohne
 * diese Policy gaebe es den Bildschirm aus der Seitenkarte
 * (`…/aufmass/neu`, Recht `bau.aufmass_erfassen`) nicht: `t_mandant` verlangt
 * `bau.schreiben`, und daran scheiterte jedes Blatt, das jemand auf der
 * Baustelle aufnimmt.
 *
 * Sie oeffnet genau die Blaetter, die diese Person auf IHREM Projekt
 * aufnimmt, und nur im Entwurf — vorgelegt und gegengezeichnet wird im Buero.
 */
create policy t_erfassen on aufmass for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and status = 'entwurf'
              and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
              and app.ist_eingesetzt_auf_projekt(projekt_id));

/** Und sie sieht, was sie schreibt — ein INSERT … RETURNING braucht SELECT. */
create policy t_erfassen_lesen on aufmass for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
         and (app.ist_eingesetzt_auf_projekt(projekt_id)
              or aufgenommen_von_anstellung_id in
                 (select a.id from anstellung a where a.person_id = app.aktuelle_person())));

create policy t_gruppe on aufmass for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/** CRM-06: der Kunde sieht seine Blaetter — nie einen Entwurf (AUT-01). */
create policy t_kunde on aufmass for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and status <> 'entwurf'
         and storniert_am is null);

/**
 * §1.8, Form A ∪ Form C: das selbst aufgenommene Blatt UND die Blaetter der
 * Baustelle, auf der die Person eingesetzt ist. Form A allein liesse ein
 * Aufmassteam aus zwei Menschen nur die eigene Haelfte sehen.
 */
create policy t_person on aufmass for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and (app.ist_eingesetzt_auf_projekt(projekt_id)
              or aufgenommen_von_anstellung_id in
                 (select a.id from anstellung a where a.person_id = app.aktuelle_person())));

/** EINE Decke mit drei Zweigen — restriktive Policies werden UND-verknuepft. */
create policy p_portal_decke on aufmass as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id = any (app.aktuelle_kunden())
             and status <> 'entwurf' and storniert_am is null)
         or (app.portal() = 'mitarbeiter'
             and (app.ist_eingesetzt_auf_projekt(projekt_id)
                  or aufgenommen_von_anstellung_id in
                     (select a.id from anstellung a where a.person_id = app.aktuelle_person()))));

grant select, insert, update on aufmass to cse_app;

/**
 * `cse_definer` liest den Kopf, weil `kern.einsatz_medien_bezug_pruefen()`
 * (0041) ihn aufloest, um `kunde_id` abzuleiten — und ein Definer ist unter
 * FORCE RLS nicht ausgenommen (§1.5). Ohne diese Policy schluege jedes
 * Anhaengen eines Messfotos fehl, mit der Meldung, das Blatt existiere nicht.
 */
grant select on aufmass to cse_definer;
create policy d_medien_bezug on aufmass for select to cse_definer using (true);

alter table aufmass_zeile enable row level security;
alter table aufmass_zeile force  row level security;

create policy t_mandant on aufmass_zeile for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_erfassen on aufmass_zeile for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and kopf_status = 'entwurf'
              and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
              and app.ist_eingesetzt_auf_projekt(projekt_id));

create policy t_erfassen_lesen on aufmass_zeile for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
         and app.ist_eingesetzt_auf_projekt(projekt_id));

create policy t_gruppe on aufmass_zeile for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

create policy t_kunde on aufmass_zeile for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and kopf_status <> 'entwurf'
         and kopf_storniert_am is null);

create policy t_person on aufmass_zeile for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and (app.ist_eingesetzt_auf_projekt(projekt_id)
              or kopf_aufgenommen_von_anstellung_id in
                 (select a.id from anstellung a where a.person_id = app.aktuelle_person())));

create policy p_portal_decke on aufmass_zeile as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id = any (app.aktuelle_kunden())
             and kopf_status <> 'entwurf' and kopf_storniert_am is null)
         or (app.portal() = 'mitarbeiter'
             and (app.ist_eingesetzt_auf_projekt(projekt_id)
                  or kopf_aufgenommen_von_anstellung_id in
                     (select a.id from anstellung a where a.person_id = app.aktuelle_person()))));

grant select, insert, update on aufmass_zeile to cse_app;

alter table aufmass_foto enable row level security;
alter table aufmass_foto force  row level security;

create policy t_mandant on aufmass_foto for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_erfassen on aufmass_foto for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and kopf_status = 'entwurf'
              and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
              and exists (select 1 from aufmass a
                           where a.id = aufmass_foto.aufmass_id
                             and app.ist_eingesetzt_auf_projekt(a.projekt_id)));

create policy t_erfassen_lesen on aufmass_foto for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('bau.aufmass_erfassen', app.aktiver_mandant()))
         and kopf_aufgenommen_von_anstellung_id in
             (select a.id from anstellung a where a.person_id = app.aktuelle_person()));

create policy t_gruppe on aufmass_foto for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

create policy t_kunde on aufmass_foto for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and kopf_status <> 'entwurf'
         and kopf_storniert_am is null);

create policy t_person on aufmass_foto for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and kopf_aufgenommen_von_anstellung_id in
             (select a.id from anstellung a where a.person_id = app.aktuelle_person()));

create policy p_portal_decke on aufmass_foto as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id = any (app.aktuelle_kunden())
             and kopf_status <> 'entwurf' and kopf_storniert_am is null)
         or (app.portal() = 'mitarbeiter'
             and kopf_aufgenommen_von_anstellung_id in
                 (select a.id from anstellung a where a.person_id = app.aktuelle_person())));

grant select, insert on aufmass_foto to cse_app;
/** `kern.aufmass_kopf_denorm()` schreibt den Kopfzustand nach unten. */
grant update (kopf_status, kopf_gesperrt_am, kopf_storniert_am,
              kopf_aufgenommen_von_anstellung_id) on aufmass_foto to cse_app;

alter table aufmass_signatur enable row level security;
alter table aufmass_signatur force  row level security;

/**
 * Gegenzeichnen ist ein eigenes Recht (`bau.aufmass_freigeben`, Seitenkarte
 * §5.9) und nicht `bau.schreiben`: wer ein Blatt erfasst, stellt damit noch
 * nicht fest, dass der Auftraggeber es anerkannt hat.
 */
create policy t_mandant on aufmass_signatur for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('bau.lesen', app.aktiver_mandant())));

create policy t_freigeben on aufmass_signatur for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.aufmass_freigeben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on aufmass_signatur for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

create policy t_kunde on aufmass_signatur for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and kopf_status <> 'entwurf'
         and kopf_storniert_am is null);

create policy t_person on aufmass_signatur for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in
             (select a.id from anstellung a where a.person_id = app.aktuelle_person()));

create policy p_portal_decke on aufmass_signatur as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id = any (app.aktuelle_kunden())
             and kopf_status <> 'entwurf' and kopf_storniert_am is null)
         or (app.portal() = 'mitarbeiter'
             and anstellung_id in
                 (select a.id from anstellung a where a.person_id = app.aktuelle_person())));

grant select, insert on aufmass_signatur to cse_app;
grant update (kopf_status, kopf_storniert_am) on aufmass_signatur to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0072)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- aufmass (archiv): BAU-02, BAU-03, LEG-01, § 14 VOB/B. Das gegengezeichnete Blatt ist das Beweismittel, aus dem eine Werklohnforderung entsteht. Korrigiert wird durch Storno und ein Ersatzblatt (`ersetzt_durch_id`), nie durch Entfernen — geloescht waere im Werklohnprozess eine Luecke, die niemand mehr erklaeren kann.
create trigger trg_aufmass_kein_hard_delete
  before delete on aufmass
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_kein_truncate
  before truncate on aufmass
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass from cse_app, cse_anon, cse_checkin, cse_job;

-- aufmass_zeile (append): BAU-02, FIN-07. Die Zeile traegt den Rechenansatz WOERTLICH neben dem Ergebnis — genau das, was ein Pruefer nachrechnet. Sie lebt und stirbt mit ihrem Kopf, dessen Zustand sie kopiert traegt, und hat darum keine eigene Lebendigkeitsspalte.
create trigger trg_aufmass_zeile_kein_hard_delete
  before delete on aufmass_zeile
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_zeile_kein_truncate
  before truncate on aufmass_zeile
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass_zeile from cse_app, cse_anon, cse_checkin, cse_job;

-- aufmass_foto (append): BAU-03, DOC-07. Ohne Messfoto wird kein Blatt vorgelegt; ein geloeschtes Foto nimmt der Feststellung nachtraeglich ihre Voraussetzung, waehrend das Blatt gegengezeichnet stehen bleibt.
create trigger trg_aufmass_foto_kein_hard_delete
  before delete on aufmass_foto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_foto_kein_truncate
  before truncate on aufmass_foto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass_foto from cse_app, cse_anon, cse_checkin, cse_job;

-- aufmass_signatur (append): BAU-03, § 14 VOB/B. Die Unterschrift mit ihrem eingefrorenen Schnappschuss IST die Feststellung. Sie zu loeschen liesse ein Blatt zurueck, das gegengezeichnet heisst und niemanden nennt.
create trigger trg_aufmass_signatur_kein_hard_delete
  before delete on aufmass_signatur
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufmass_signatur_kein_truncate
  before truncate on aufmass_signatur
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufmass_signatur from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_aufmass_geaendert_am
  before update on aufmass
  for each row execute function kern.setze_geaendert_am();
create trigger trg_aufmass_zeile_geaendert_am
  before update on aufmass_zeile
  for each row execute function kern.setze_geaendert_am();

create trigger trg_aufmass_audit
  after insert or update or delete on aufmass
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
