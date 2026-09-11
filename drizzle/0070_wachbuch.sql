-- ===========================================================================
-- 0070 — Das Wachbuch: kontrollpunkt, wachbuch_eintrag (SEC-05, SEC-07,
--        TIM-08, TIM-09, TIM-10, LEG-01, LEG-10, EMP-13, SEC-A9)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §6.11, §6.12,
-- §1.10, §1.11, §1.15. Wo dieser Text und eine Konvention (K-nn)
-- auseinandergehen, gilt die Konvention.
--
-- Das Wachbuch ist die einzige laufende Beweisfuehrung, die eine Bewachung
-- fuehrt: Rundgang, Vorkommnis, Uebergabe, Schluesselbewegung, Alarm. Vor
-- Gericht ist es nur so viel wert, wie sich zeigen laesst, dass niemand eine
-- Seite eingeschoben, geaendert oder entfernt hat. Deshalb stehen hier drei
-- Dinge zusammen, und keines davon ist Zierrat:
--
--  1. **Die Serveruhr schreibt `erfasst_am`** (Invariante 5, TIM-08). Die
--     Geraetezeit steht DANEBEN, mit ihrer Abweichung — nie an ihrer Stelle.
--     Eine verstellte Telefonuhr aendert damit keine aufgezeichnete Zeit.
--  2. **Kein UPDATE ausser Storno, kein DELETE** — beides auf DATENBANKEBENE,
--     nicht im Dienst. Eine Korrektur ist ein NEUER Eintrag, der den alten
--     nennt (`ersetzt_durch_id`).
--  3. **Eine Hashkette je (Mandant, Objekt)**, ohne Jahresschnitt. Der Entwurf
--     liess sie am 1. Januar unverankert neu beginnen — dann laesst sich ein
--     ganzes Vorjahr neu erzeugen und neu hashen, ohne dass ein ueberlebendes
--     Glied widerspricht. Die Kontrolle verschwaende genau an der Grenze, an
--     der eine Aufsicht prueft.
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  a. **Keine Koordinatenspalten** (§6.12, review B8). Eine Wache schreibt in
--     einer Nachtschicht zehn bis zwanzig Rundgangseintraege; mit
--     Breiten- und Laengengrad waere das ein Bewegungsprofil eines
--     benannten Menschen in einer Tabelle, die nie geloescht wird. LEG-10
--     erlaubt EINEN Punkt bei Beginn und Ende einer Schicht und nichts
--     Laufendes, und § 87 Abs. 1 Nr. 6 BetrVG macht eine Rundgangsspur zu
--     einer mitbestimmungspflichtigen Ueberwachungseinrichtung. Der
--     Praesenznachweis ist `kontrollpunkt_id` + `praesenz_bestaetigt`: „war
--     an Punkt 4", nie „war um 03:14 bei 52.5013, 13.3300".
--
--  b. **`eintragstext`, nicht `text`.** Eine Spalte, die wie ein Typ heisst,
--     ist ein dauerhafter Anfuehrungszeichen- und Abbildungsfallstrick und
--     kostet nichts, wenn man ihn vermeidet (§6.12, review MINOR).
--
--  c. **EIN Ausloeser vor dem Einfuegen, nicht drei.** PostgreSQL feuert
--     BEFORE-Ausloeser in ALPHABETISCHER Reihenfolge des Namens. Der Entwurf
--     hatte `assign_wachbuch_laufnummer` und `stamp_server_time` getrennt —
--     der erste lief zuerst und leitete `jahr` aus einer noch ungestempelten
--     `erfasst_am` ab. Serverzeit, Jahr, Laufnummer und Kettenglied entstehen
--     deshalb in EINER Funktion und EINER Transaktion (§6.12).
--
-- NICHT in dieser Migration: `schluessel` und `schluessel_quittung` (PR 42).
-- `wachbuch_eintrag.schluessel_id` steht deshalb als Spalte ohne
-- Fremdschluessel da, mit der nachzutragenden Anweisung in Abschnitt 8.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.2)
-- ---------------------------------------------------------------------------

/**
 * FESTGESCHRIEBEN (§3.2): SPEC SEC-05 nennt genau diese fuenf Eintragsarten.
 * Kein Platzhalter, keine offene Frage — sie stehen in der Anforderung.
 */
create type wachbuch_art as enum ('rundgang','vorkommnis','uebergabe','schluessel','alarm');

/**
 * PLATZHALTER-Vokabular (§3.2). LEG-10 erlaubt einen einzelnen Punkt bei
 * Beginn und Ende, nichts Laufendes; WELCHE Form ein Praesenznachweis am
 * Kontrollpunkt hat, sagt kein Dokument.
 *
 * `unbestimmt` ist die Vorgabe und heisst: es ist keiner vereinbart. Bis zur
 * Antwort bleibt der Katalog leer, und kein Eintrag verlangt einen Nachweis.
 * // TODO(client, O-152): Fordert ein Auftraggebervertrag einen
 * Praesenznachweis je Rundgang, in welcher Form (NFC-Tag, QR, Barcode), und
 * ist der Betriebsrat beteiligt (SEC-05, LEG-10; Betriebsrat selbst ist O-06)?
 */
create type kontrollpunkt_nachweisart as enum ('nfc','qr','barcode','manuell','unbestimmt');

-- ---------------------------------------------------------------------------
-- 2. kontrollpunkt — der registrierte Rundgangspunkt (§6.11)
-- ---------------------------------------------------------------------------

/**
 * Er existiert, damit sich „die Wache war an Punkt 4" aufschreiben laesst,
 * OHNE aufzuschreiben, wo die Wache war (§6.11, review B8).
 *
 * `tag_kennung_hash` und nicht die rohe Seriennummer: ein NFC-Tag ist
 * kopierbar, und seine Kennung im Klartext in einer nie geloeschten Tabelle
 * ist ein Geheimnis, das niemand mehr aendern kann.
 */
create table kontrollpunkt (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  objekt_id     uuid not null,

  bezeichnung   text not null,
  kurzzeichen   text,

  nachweisart   kontrollpunkt_nachweisart not null default 'unbestimmt',
  -- Der HASH der Tagkennung, nie die Kennung selbst.
  tag_kennung_hash text,

  -- Die gedachte Rundgangsreihenfolge. Keine Vorgabe, keine Pflicht: ob ein
  -- Rundgang in fester Folge zu laufen ist, sagt kein Dokument.
  reihenfolge   smallint not null default 0,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

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
  constraint kontrollpunkt_mandant_uk unique (mandant_id, id),
  -- Das Ziel des Enkel-Fremdschluessels aus `wachbuch_eintrag` (§1.4): ein
  -- Kontrollpunkt eines ANDEREN Objekts darf in diesem Wachbuch nicht
  -- auftauchen, auch nicht innerhalb desselben Mandanten.
  constraint kontrollpunkt_objekt_uk unique (mandant_id, objekt_id, id),

  constraint kontrollpunkt_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),

  constraint kontrollpunkt_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint kontrollpunkt_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index kontrollpunkt_objekt_idx on kontrollpunkt (mandant_id, objekt_id, reihenfolge)
  where archiviert_am is null;
-- PARTIELL (§1.3): ein abgebauter Punkt darf sein Kuerzel nicht auf Dauer
-- belegen — der neue Tag am selben Treppenhaus heisst legitim wieder „TH-3".
create unique index kontrollpunkt_kurzzeichen_uk on kontrollpunkt (objekt_id, kurzzeichen)
  where archiviert_am is null and kurzzeichen is not null;

comment on table kontrollpunkt is
  'Registrierter Rundgangspunkt (§6.11, SEC-05, LEG-10). Er traegt den '
  'Praesenznachweis STATT einer Koordinate: „war an Punkt 4", nie „war bei '
  '52.5013, 13.3300".';

-- ---------------------------------------------------------------------------
-- 3. wachbuch_eintrag (§6.12)
-- ---------------------------------------------------------------------------

create table wachbuch_eintrag (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  objekt_id     uuid not null,
  -- Der Anlass, wo es einen gibt. Alle drei nullbar: eine Uebergabe gehoert
  -- zum Objekt und nicht zwingend zu einer Schicht.
  posten_id     uuid,
  veranstaltung_id uuid,
  einsatz_id    uuid,

  /**
   * Der Urheber — an der BESCHAEFTIGUNG, mit dem Menschen daneben (§10.5).
   *
   * Die Pflicht entsteht aus der Beschaeftigung bei EINER Gesellschaft
   * (Mandantenumfang, Haftung genau dieser GmbH); die Portalsicht ist
   * personenbasiert ueber alle Beschaeftigungen (EMP-14, ein Zugang je
   * Mensch). Der zusammengesetzte Fremdschluessel darunter macht es
   * strukturell unmoeglich, dass eine Zeile einen Menschen nennt, der zu
   * dieser Beschaeftigung nicht gehoert.
   */
  anstellung_id uuid not null,
  person_id     uuid not null,

  /**
   * NUR Anzeigeschluessel (§6.12): das Jahr der laufenden Nummer, abgeleitet
   * aus `erfasst_am` in `Europe/Berlin` (K-11) — nie als `(erfasst_am)::date`,
   * das waere der UTC-Tag und laege in der Silvesternacht um ein JAHR daneben.
   * Die Kette kennt kein Jahr; sie laeuft durch.
   */
  jahr          smallint not null,
  -- Fortlaufend je (Mandant, Objekt, Jahr), gezogen aus `nummernkreis` unter
  -- `select … for update` (§2.1, FIN-03-Bauart).
  laufnummer    bigint not null,

  art           wachbuch_art not null,

  /**
   * DIE SERVERZEIT (Invariante 5, TIM-08). Der Vorgabewert allein genuegt
   * nicht: `default now()` greift nur bei WEGGELASSENER Spalte, und ein
   * INSERT, der einen Wert mitschickt, schriebe einen beliebigen Zeitpunkt —
   * den die Kette darunter dann unveraenderlich macht. Der Ausloeser in
   * Abschnitt 5 ueberschreibt ihn IMMER.
   */
  erfasst_am    timestamptz not null default now(),
  -- Die Behauptung des Geraets und ihre Abweichung (TIM-08). Sie stehen
  -- DANEBEN, nie an der Stelle der Serverzeit.
  geraete_zeit  timestamptz,
  zeitabweichung_sek integer,
  -- TIM-09: die Seite lag in der Warteschlange und kam spaeter an. Nicht
  -- dasselbe wie eine Abweichung der Uhr — wer beides in eine Spalte legt,
  -- kann eine um 14:00 verfasste und um 22:00 uebertragene Seite nicht mehr
  -- von einer um 22:00 verfassten unterscheiden.
  nachgetragen  boolean not null default false,

  betreff       text not null,
  eintragstext  text not null,

  -- Der Praesenznachweis STATT einer Koordinate (§6.12, Absatz a oben).
  kontrollpunkt_id uuid,
  praesenz_bestaetigt boolean not null default false,

  /**
   * Die Schluesselbewegung (SEC-07). SPALTE OHNE FREMDSCHLUESSEL —
   * `schluessel` entsteht mit PR 42 (Abschnitt 8).
   */
  schluessel_id uuid,

  polizei_informiert boolean not null default false,

  /**
   * Das Kettenglied. `vorheriger_hash` ist NULL AUSSCHLIESSLICH beim ersten
   * Eintrag der Kette eines Objekts — und weil das so ist, muss auch dieser
   * eine Anker eindeutig sein (siehe `wachbuch_kette_uk`).
   */
  vorheriger_hash text,
  hash          text not null,

  -- §1.14. `loeschsperre` steht auf `true`: nichts ist versehentlich loeschbar,
  -- und `aufbewahrung_bis` schreibt `job:aufbewahrung` aus der Klasse
  -- `sicherheitsnachweis` (§11) — nie ein Vorgabewert.
  -- // TODO(client, O-25): Wie lange wird ein Wachbuch aufbewahrt, und auf
  -- welcher Rechtsgrundlage (Abmeldung aus dem Bewacherregister plus Frist)?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default true,

  /**
   * Die Storno-Spalten (§1.3) — die EINZIGEN, die ein UPDATE beruehren darf.
   * Eine Korrektur ist ein NEUER Eintrag, der auf diesen zeigt; diese Zeile
   * bleibt lesbar stehen, denn genau das ist die Beweisfuehrung.
   */
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  /**
   * Auditblock OHNE `geaendert_*` (§1.2): die Tabelle ist anfuegend. Ein
   * `geaendert_von` daneben behauptete, jemand duerfe eine Wachbuchseite
   * bearbeiten.
   */
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint wachbuch_mandant_uk unique (mandant_id, id),
  -- Ziel des Enkel-Fremdschluessels aus `schluessel_quittung` (§1.4, PR 42):
  -- eine Schluesselbewegung darf nicht im Wachbuch eines anderen Objekts
  -- stehen.
  constraint wachbuch_objekt_uk unique (mandant_id, objekt_id, id),

  constraint wachbuch_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint wachbuch_posten_fk foreign key (mandant_id, posten_id)
    references posten (mandant_id, id),
  constraint wachbuch_veranstaltung_fk foreign key (mandant_id, veranstaltung_id)
    references veranstaltung (mandant_id, id),
  constraint wachbuch_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),
  constraint wachbuch_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  -- Der Schluessel, der `person_id` von einer frei erfindbaren
  -- Denormalisierung zu einer Tatsache macht (§10.5).
  constraint wachbuch_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  -- Der GROSSELTERN-Schluessel (§1.4): der Kontrollpunkt gehoert zum Objekt
  -- DIESES Eintrags, nicht bloss zu diesem Mandanten.
  constraint wachbuch_kontrollpunkt_fk
    foreign key (mandant_id, objekt_id, kontrollpunkt_id)
    references kontrollpunkt (mandant_id, objekt_id, id),
  constraint wachbuch_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references wachbuch_eintrag (mandant_id, id),

  constraint wachbuch_betreff_gefuellt check (btrim(betreff) <> ''),
  constraint wachbuch_text_gefuellt check (btrim(eintragstext) <> ''),
  constraint wachbuch_laufnummer_positiv check (laufnummer >= 1),
  constraint wachbuch_jahr_plausibel check (jahr between 2000 and 2100),
  constraint wachbuch_hash_form check (hash ~ '^[0-9a-f]{64}$'),
  constraint wachbuch_vorheriger_hash_form check (
    vorheriger_hash is null or vorheriger_hash ~ '^[0-9a-f]{64}$'),
  -- SEC-07: eine Schluesselbewegung ohne Schluessel ist keine.
  constraint wachbuch_schluessel_genannt check (
    art <> 'schluessel' or schluessel_id is not null),
  -- Ein Praesenznachweis ohne Punkt ist eine Behauptung ueber nichts.
  constraint wachbuch_praesenz_braucht_punkt check (
    not praesenz_bestaetigt or kontrollpunkt_id is not null),
  -- Ein Storno ohne Grund ist im Streit keine Auskunft; und ein Grund ohne
  -- Storno ist eine Behauptung ohne Vorgang.
  constraint wachbuch_storno_begruendet check (
    (storniert_am is null and storno_grund is null)
    or (storniert_am is not null and btrim(coalesce(storno_grund,'')) <> '')),
  constraint wachbuch_ersatz_nicht_selbst check (ersetzt_durch_id is distinct from id),
  constraint wachbuch_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * Die laufende Nummer ist je (Mandant, Objekt, Jahr) eindeutig — das ist die
 * menschenlesbare Seite. Die Kette daneben ist die maschinenlesbare.
 */
create unique index wachbuch_lfd_uk
  on wachbuch_eintrag (mandant_id, objekt_id, jahr, laufnummer);

/**
 * **`nulls not distinct` ist die tragende Haelfte** (§6.12, review B9).
 *
 * Ohne die Bedingung koennen zwei Zeilen denselben Vorgaenger nennen und die
 * Kette gabeln — genau so versteckt sich eine eingeschobene Seite. Und in
 * einem gewoehnlichen eindeutigen Index sind NULL-Werte VERSCHIEDEN: der
 * Anker einer Kette (`vorheriger_hash is null`) waere damit beliebig oft
 * eintragbar, und zwar an der einen Stelle, die keinen Vorgaengerhash hat,
 * der widersprechen koennte.
 */
create unique index wachbuch_kette_uk
  on wachbuch_eintrag (mandant_id, objekt_id, vorheriger_hash) nulls not distinct;

-- Das Buch selbst und die Uebergabe: „was ist an diesem Objekt zuletzt
-- passiert".
create index wachbuch_objekt_zeit_idx
  on wachbuch_eintrag (mandant_id, objekt_id, erfasst_am desc);
-- Der Vorkommnisbericht.
create index wachbuch_art_idx on wachbuch_eintrag (mandant_id, art, erfasst_am desc)
  where art in ('vorkommnis','alarm');
/**
 * Die Mitarbeiterdecke filtert auf `anstellung_id`, auf der groessten Tabelle
 * dieser Domaene. Ohne diesen Index ist die Eigenansicht im Portal ein
 * sequentieller Durchlauf unter einer Policy, die je Zeile ausgewertet wird
 * (§6.12, review MISSING).
 */
create index wachbuch_anstellung_idx
  on wachbuch_eintrag (mandant_id, anstellung_id, erfasst_am desc);
/**
 * Der Kettenpruefer. §6.12 nennt ihn `(mandant_id, objekt_id, laufnummer desc)`
 * — das kann die Kette nicht ordnen, denn `laufnummer` beginnt am 1. Januar
 * wieder bei 1, waehrend die Kette ausdruecklich DURCHLAEUFT (§6.12 Nr. 1).
 * Nach Laufnummer allein sortiert stuende der erste Eintrag des neuen Jahres
 * vor dem letzten des alten, und der Pruefer meldete jeden Jahreswechsel als
 * Bruch. `jahr` steht deshalb davor.
 */
create index wachbuch_kettenpruef_idx
  on wachbuch_eintrag (mandant_id, objekt_id, jahr desc, laufnummer desc);

comment on table wachbuch_eintrag is
  'Das Wachbuch (§6.12, SEC-05): Rundgang, Vorkommnis, Uebergabe, Schluessel, '
  'Alarm — mit SERVERZEIT, fortlaufender Nummer und einer Hashkette je '
  '(Mandant, Objekt), die keinen Jahresschnitt kennt. Nur anfuegbar.';
comment on column wachbuch_eintrag.erfasst_am is
  'SERVERZEIT (Invariante 5, TIM-08). Der Ausloeser ueberschreibt jeden '
  'mitgeschickten Wert; die Geraetezeit steht daneben in geraete_zeit.';
comment on column wachbuch_eintrag.jahr is
  'Nur Anzeigeschluessel der laufenden Nummer, abgeleitet in Europe/Berlin '
  '(K-11). Die Kette laeuft ueber den Jahreswechsel durch.';

-- ---------------------------------------------------------------------------
-- 4. Die kanonische Nutzlast — EINE Fassung, zwei Leser (§1.15, §6.12)
-- ---------------------------------------------------------------------------

/**
 * Was gehasht wird, und in welcher Reihenfolge.
 *
 * **Ein Hash ueber eine unbestimmte Nutzlast ist von niemandem pruefbar**,
 * auch nicht vom naechtlichen Lauf. §6.12 zaehlt die achtzehn Felder in ihrer
 * Reihenfolge auf; diese Funktion ist diese Aufzaehlung, und sie ist die
 * EINZIGE Fassung davon — der Einfuegeausloeser und der Kettenpruefer rufen
 * beide sie. Eine zweite Fassung in TypeScript waere eine zweite Wahrheit, und
 * die erste Abweichung im Umgang mit Sonderzeichen meldete einen Bruch, den es
 * nicht gibt.
 *
 * **Ein ARRAY, kein Objekt** — und das ist eine bewusste Praezisierung von
 * §6.12s „JCS-canonical JSON". JCS ordnet Objektschluessel nach UTF-16-
 * Codeeinheiten; PostgreSQLs `jsonb` ordnet sie nach LAENGE und dann nach
 * Bytes. Ein `jsonb_build_object` liefert also nicht JCS, und die Abweichung
 * faellt niemandem auf, weil beide Fassungen wie kanonisches JSON aussehen.
 * Ein Array in der aufgezaehlten Reihenfolge hat gar keine Schluessel, die
 * jemand sortieren koennte — dieselbe Eigenschaft, ohne die Falle.
 *
 * **Die Storno-Spalten sind NICHT enthalten** (§6.12): sie werden nach dem
 * Hashen geschrieben, und waeren sie Teil der Nutzlast, braeche jedes Storno
 * die Kette.
 *
 * `immutable`: derselbe Satz ergibt immer dieselbe Zeichenkette. Die
 * Zeitformate sind ausgeschrieben (RFC 3339, UTC, Millisekunden) und haengen
 * damit an keiner Sitzungseinstellung — `to_char` ohne Zone laese `TimeZone`
 * des Aufrufers, und derselbe Eintrag ergaebe in Berlin und in London zwei
 * verschiedene Hashes.
 */
create function kern.wachbuch_nutzlast(p wachbuch_eintrag) returns text
language sql immutable as $$
  select json_build_array(
           p.objekt_id::text,
           p.anstellung_id::text,
           p.person_id::text,
           p.art::text,
           to_char(p.erfasst_am at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           p.jahr,
           p.laufnummer,
           p.betreff,
           p.eintragstext,
           p.kontrollpunkt_id::text,
           p.praesenz_bestaetigt,
           p.schluessel_id::text,
           p.einsatz_id::text,
           p.posten_id::text,
           p.veranstaltung_id::text,
           p.polizei_informiert,
           to_char(p.geraete_zeit at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           p.nachgetragen)::text;
$$;

comment on function kern.wachbuch_nutzlast(wachbuch_eintrag) is
  'Die kanonische Nutzlast eines Wachbucheintrags (§6.12): achtzehn Felder in '
  'der Reihenfolge des Vertrags, als JSON-Array. Einzige Fassung — Ausloeser '
  'und Kettenpruefer benutzen sie beide.';

/** `sha256(Nutzlast ‖ Vorgaengerhash)`, hexadezimal (§1.15 Nr. 2, FIN-06-Bauart). */
create function kern.wachbuch_hash(p_nutzlast text, p_vorher text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(p_nutzlast || coalesce(p_vorher, ''), 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- 5. Der EINE Einfuegeausloeser (§6.12)
-- ---------------------------------------------------------------------------

/**
 * Serverzeit, Jahr, Laufnummer, Kettenkopf und Hash — in dieser Reihenfolge,
 * in einer Funktion, in einer Transaktion.
 *
 * **Warum nicht vier Ausloeser:** PostgreSQL feuert BEFORE-Ausloeser
 * alphabetisch. Getrennt lief die Nummernvergabe vor dem Zeitstempel und
 * leitete `jahr` aus einer noch ungestempelten `erfasst_am` ab — in der
 * Silvesternacht aus der falschen. Der Name beginnt trotzdem mit `a_`, damit
 * dieser Ausloeser vor jedem spaeter hinzukommenden laeuft.
 *
 * **`security definer`, und zwar aus einem konkreten Grund:** der Zaehler
 * steht in `nummernkreis`, und dort haelt `cse_app` weder ein INSERT-Recht
 * noch eine INSERT-Policy (0006). Ein Kreis je (Mandant, Objekt, Jahr) laesst
 * sich also nicht von der Anwendung anlegen — und ohne Kreis gaebe es keinen
 * ersten Wachbucheintrag an einem neuen Objekt. Der Definer legt ihn an; was
 * er darf, steht in Abschnitt 6 als Policy und als Spalten-Grant, damit die
 * Ausnahme reviewbar ist statt implizit.
 *
 * **Die Sperre serialisiert.** `select … for update` auf der Zaehlerzeile ist
 * dieselbe Bauart wie FIN-03 und hat hier eine zweite Aufgabe: sie
 * serialisiert auch das Lesen des KETTENKOPFES. Zwei gleichzeitige Eintraege
 * am selben Objekt bekommen damit zwei verschiedene Vorgaenger. Ueber die
 * Jahresgrenze hinweg (zwei Kreise, zwei Sperren) faengt sie
 * `wachbuch_kette_uk` — deshalb gibt es beides.
 */
create function kern.wachbuch_eintrag_vorbereiten() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_jahr    smallint;
  v_kreis   uuid;
  v_nummer  bigint;
  v_vorher  text;
begin
  /**
   * 1. DIE SERVERUHR. Der mitgeschickte Wert wird verworfen — immer, ohne
   *    Ausnahme und ohne Recht, das ihn erlaubte (Invariante 5, TIM-08).
   */
  new.erfasst_am := now();
  if new.geraete_zeit is not null then
    -- Geraet MINUS Server, vorzeichenbehaftet, in Sekunden — dieselbe
    -- Richtung wie `zeiteintrag.zeitabweichung_beginn_sek` (0034).
    new.zeitabweichung_sek :=
      round(extract(epoch from (new.geraete_zeit - new.erfasst_am)))::integer;
  else
    -- Keine Geraetezeit heisst keine Abweichung. Einen mitgeschickten Wert
    -- stehen zu lassen hiesse, eine Abweichung ohne Messung zu behaupten.
    new.zeitabweichung_sek := null;
  end if;

  -- 2. Das Jahr der laufenden Nummer, BERLINER Kalender (K-11).
  v_jahr := extract(year from (new.erfasst_am at time zone 'Europe/Berlin'))::smallint;
  new.jahr := v_jahr;

  /**
   * 3. Der Zaehler je (Mandant, Objekt, Jahr) — §2.3 Nr. 4 verlangt genau
   *    diesen Geltungsbereich vom Nummernkreis.
   */
  select nk.id into v_kreis
    from public.nummernkreis nk
   where nk.mandant_id = new.mandant_id
     and nk.kreis_typ = 'wachbuch'
     and nk.kontext_id = new.objekt_id
     and nk.jahr = v_jahr
   for update;

  if v_kreis is null then
    /**
     * Der erste Eintrag eines Objekts in einem Jahr legt seinen Kreis an.
     *
     * `zuruecksetzung = 'jaehrlich'` ist nicht geraten: §6.12 sagt, die
     * Laufnummer laeuft je (Mandant, Objekt, JAHR) — das IST die jaehrliche
     * Ruecksetzung, und der Schluessel des Kreises traegt das Jahr ohnehin.
     * `lueckenlos = true` ebenso wenig: ein Wachbuch mit Luecken ist der Fall,
     * gegen den die Kette daneben geschrieben ist.
     *
     * `format_maske` ist die einzige Spalte, die hier nichts entscheidet:
     * `wachbuch_eintrag` speichert `jahr` und `laufnummer` als Zahlen und
     * rendert NIE durch die Maske — anders als eine Rechnungsnummer, die als
     * TEXT auf einem Dokument steht. Sie steht trotzdem, weil die Tabelle sie
     * verlangt, und sie traegt `{jahr}`, weil `nk_jahresmaske` das bei
     * jaehrlicher Ruecksetzung verlangt.
     *
     * `ist_platzhalter = false`: ein Platzhalterkreis gibt keine Nummer heraus
     * (0006, `d_kreis_ziehen`), und dann gaebe es ueberhaupt kein Wachbuch.
     * Bestaetigt wird damit nur, was ohnehin feststeht — der Geltungsbereich
     * und die Ruecksetzung —, nicht eine Zahl, die jemand haette nennen
     * muessen. O-134 betrifft die RECHNUNGSnummer und bleibt unberuehrt.
     */
    insert into public.nummernkreis
      (mandant_id, kreis_typ, kontext_id, jahr, bezeichnung, lueckenlos,
       format_maske, zuruecksetzung, naechste_nummer, geoeffnet_am,
       ist_platzhalter, erstellt_von_art, erstellt_von_dienst)
    values
      (new.mandant_id, 'wachbuch', new.objekt_id, v_jahr,
       format('Wachbuch %s', v_jahr), true,
       '{jahr}/{nr:4}', 'jaehrlich', 1,
       (now() at time zone 'Europe/Berlin')::date,
       false, 'system', 'kern.wachbuch_eintrag_vorbereiten')
    returning id into v_kreis;
  end if;

  update public.nummernkreis
     set naechste_nummer = naechste_nummer + 1
   where id = v_kreis
   returning naechste_nummer - 1 into v_nummer;

  new.laufnummer := v_nummer;

  /**
   * 4. Der Kettenkopf — je (Mandant, Objekt), OHNE Jahresschnitt (§6.12
   *    Nr. 1). Sortiert wird nach (jahr, laufnummer): die Laufnummer allein
   *    faengt am 1. Januar wieder bei 1 an, und der erste Eintrag des neuen
   *    Jahres nennte sonst den falschen Vorgaenger.
   *
   *    Ein STORNIERTER Eintrag bleibt Teil der Kette. Er ist nicht entfernt
   *    worden, er ist als falsch gekennzeichnet — und eine Kette, die
   *    stornierte Glieder ueberspringt, laesst sich durch Stornieren
   *    umschreiben.
   */
  select w.hash into v_vorher
    from public.wachbuch_eintrag w
   where w.mandant_id = new.mandant_id
     and w.objekt_id = new.objekt_id
   order by w.jahr desc, w.laufnummer desc
   limit 1;

  new.vorheriger_hash := v_vorher;
  new.hash := kern.wachbuch_hash(kern.wachbuch_nutzlast(new), v_vorher);

  return new;
end $$;

create trigger a_wachbuch_eintrag_vorbereiten
  before insert on wachbuch_eintrag
  for each row execute function kern.wachbuch_eintrag_vorbereiten();

comment on function kern.wachbuch_eintrag_vorbereiten() is
  'Der EINE BEFORE-INSERT-Ausloeser des Wachbuchs (§6.12): Serverzeit, Jahr in '
  'Europe/Berlin, Laufnummer unter Zaehlersperre, Kettenkopf und Hash — in '
  'dieser Reihenfolge, in einer Funktion.';

/**
 * Und die andere Haelfte: ein UPDATE darf AUSSCHLIESSLICH die Storno-Spalten
 * und die zwei Aufbewahrungsspalten beruehren.
 *
 * **Als Vergleich der GANZEN Zeile und nicht als Spaltenliste.** Eine
 * Aufzaehlung der verbotenen Spalten ist beim naechsten `alter table add
 * column` unvollstaendig, und zwar lautlos: die neue Spalte waere aenderbar,
 * ohne dass jemand es entschieden haette. Hier ist die Vorgabe „nichts darf
 * sich aendern", und die vier Ausnahmen stehen namentlich da.
 *
 * Die Storno-Spalten selbst sind EINMALSCHREIBUNG: ein zurueckgenommenes
 * Storno waere eine zweite Wahrheit ueber denselben Vorgang.
 */
create function kern.wachbuch_nur_storno() returns trigger
language plpgsql as $$
declare
  v_erlaubt wachbuch_eintrag;
begin
  v_erlaubt := old;
  v_erlaubt.storniert_am     := new.storniert_am;
  v_erlaubt.storniert_von    := new.storniert_von;
  v_erlaubt.storno_grund     := new.storno_grund;
  v_erlaubt.ersetzt_durch_id := new.ersetzt_durch_id;
  v_erlaubt.aufbewahrung_bis := new.aufbewahrung_bis;
  v_erlaubt.loeschsperre     := new.loeschsperre;

  if to_jsonb(v_erlaubt) is distinct from to_jsonb(new) then
    raise exception 'Ein Wachbucheintrag wird nicht geaendert (SEC-05, LEG-01)'
      using errcode = 'P0001',
            detail  = 'Nur storniert_am, storniert_von, storno_grund, '
                      || 'ersetzt_durch_id und die Aufbewahrungsspalten duerfen '
                      || 'sich bewegen — der Rest ist gehasht und Teil der Kette.',
            hint    = 'Korrigiert wird durch einen NEUEN Eintrag, der den alten '
                      || 'in ersetzt_durch_id nennt.';
  end if;

  if old.storniert_am is not null
     and (new.storniert_am is distinct from old.storniert_am
          or new.storno_grund is distinct from old.storno_grund) then
    raise exception 'Ein Storno wird nicht zurueckgenommen (SEC-05, Invariante 8)'
      using errcode = 'P0001',
            hint    = 'Ein irrtuemliches Storno wird durch einen neuen Eintrag '
                      || 'richtiggestellt, nicht durch Loeschen der Spur.';
  end if;

  -- Die Serveruhr stempelt auch das Storno (§1.11): ein mitgeschickter
  -- Zeitpunkt waere die Antwort auf „wann wurde das bemerkt", und die gehoert
  -- nicht dem Aufrufer.
  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;

  return new;
end $$;

create trigger w_nur_storno
  before update on wachbuch_eintrag
  for each row execute function kern.wachbuch_nur_storno();

-- ---------------------------------------------------------------------------
-- 6. Was der Definer auf `nummernkreis` darf (0006, K-01)
-- ---------------------------------------------------------------------------

/**
 * `kern.wachbuch_eintrag_vorbereiten` ist die einzige Stelle, die einen
 * Wachbuchkreis anlegt und zieht. Damit sie das auch in einer Auslieferung
 * kann, in der Definer-Funktionen `cse_definer` gehoeren (K-01), bekommt diese
 * Rolle genau darauf ein Recht — auf den Kreistyp `wachbuch` und auf nichts
 * sonst.
 *
 * Die Spaltenliste beim UPDATE ist die eigentliche Schranke: bewegen darf sich
 * der Zaehler, nicht die Maske, nicht `geschlossen_am`, nicht `lueckenlos`.
 */
create policy nk_wachbuch_definer on nummernkreis for select to cse_definer
  using (kreis_typ = 'wachbuch');
create policy nk_wachbuch_definer_anlegen on nummernkreis for insert to cse_definer
  with check (kreis_typ = 'wachbuch');
create policy nk_wachbuch_definer_ziehen on nummernkreis for update to cse_definer
  using (kreis_typ = 'wachbuch' and geschlossen_am is null)
  with check (kreis_typ = 'wachbuch' and geschlossen_am is null);

grant select, insert on nummernkreis to cse_definer;
grant update (naechste_nummer, geaendert_am, geaendert_von, geaendert_von_art)
  on nummernkreis to cse_definer;

-- ---------------------------------------------------------------------------
-- 7. Uebergabefenster und Kettenpruefung (§1.10, §6.12)
-- ---------------------------------------------------------------------------

/**
 * Wie weit zurueck darf die FOLGESCHICHT die Eintraege der vorigen sehen?
 *
 * **Der Entwurf hatte `interval '24 hours'` fest in einer RLS-Policy stehen**
 * — eine Zugriffsregel mit datenschutzrechtlicher Folge (eine Wache liest die
 * Vorkommnismeldungen einer namentlich benannten Kollegin), die keine
 * SPEC-Zeile nennt (§6.12, review INVENTED RULE). Sie ist deshalb
 * Konfiguration, und die Vorgabe ist NULL: solange der Mandant nichts
 * hinterlegt, gewaehrt der Uebergabezweig gar nichts.
 * // TODO(client, O-151): Welche Wachbuch-Eintraege darf die Folgeschicht zur
 * Uebergabe sehen, fuer welchen Zeitraum, und ist der Betriebsrat beteiligt
 * (SEC-05, EMP-13; Betriebsrat selbst ist O-06)?
 *
 * Ein unlesbarer Wert (Tippfehler in der Einstellung) laesst den Aufruf
 * SCHEITERN statt still auf null zurueckzufallen: eine Einstellung, die
 * jemand gesetzt hat und die wirkungslos bleibt, ist der schlimmere Ausgang.
 */
create function app.uebergabe_fenster() returns interval
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((app.einstellung('wachbuch.uebergabe_fenster')->>'interval')::interval,
                  interval '0');
$$;

/**
 * Der Uebergabezweig der Mitarbeiterdecke (§1.10).
 *
 * Beide Bedingungen zusammen: der Leser ist auf DIESEM Objekt eingesetzt, UND
 * der Eintrag liegt im Fenster. Mit dem Fenster `interval '0'` ist die zweite
 * nie wahr — also ist die Vorgabe „keine Uebergabe", und das ist die
 * geschlossene Richtung.
 */
create function app.uebergabe_sichtbar(p_objekt uuid, p_erfasst_am timestamptz)
returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select app.ist_eingesetzt_auf_objekt(p_objekt)
     and p_erfasst_am is not null
     and p_erfasst_am > now() - app.uebergabe_fenster();
$$;

revoke execute on function app.uebergabe_fenster() from public;
revoke execute on function app.uebergabe_sichtbar(uuid, timestamptz) from public;
grant execute on function app.uebergabe_fenster() to cse_app, cse_job;
grant execute on function app.uebergabe_sichtbar(uuid, timestamptz) to cse_app, cse_job;

/**
 * Die Kettenpruefung — der Leser des naechtlichen Laufs `job:wachbuch_kette`
 * (§13.2) und des Dienstes `services/security/wachbuch.ts`.
 *
 * **`security invoker`, mit Absicht.** Sie prueft, was der Aufrufer sehen
 * darf; als Definer waere sie ein Leseweg an der Zeilenpolitik vorbei, und
 * eine Wache koennte ueber die Betreffzeilen eines fremden Objekts spekulieren.
 * Der naechtliche Lauf laeuft als `cse_job` und traegt seine eigene Policy.
 *
 * Sie meldet ZWEI verschiedene Brueche, und die Unterscheidung ist der Punkt:
 * `hash_falsch` heisst, der Inhalt der Zeile passt nicht mehr zu ihrem Hash —
 * jemand hat an der Datenbank vorbeigeschrieben. `kette_falsch` heisst, die
 * Zeile nennt einen anderen Vorgaenger als den, der tatsaechlich vor ihr
 * steht — eine Seite wurde eingeschoben oder entfernt.
 */
create function app.wachbuch_kette_pruefen(p_objekt uuid)
returns table (eintrag_id uuid, jahr smallint, laufnummer bigint, befund text)
language sql stable set search_path = pg_catalog, public as $$
  with geordnet as (
    /**
     * `w as zeile` traegt die GANZE Zeile als Verbundwert mit — die Nutzlast
     * braucht sie, und `w.*` daneben gaebe einen Satz mit zwei zusaetzlichen
     * Fensterspalten, der sich nicht mehr nach `wachbuch_eintrag` wandeln
     * laesst („cannot cast type record", 42846).
     */
    select w as zeile, w.id, w.jahr, w.laufnummer, w.hash, w.vorheriger_hash,
           lag(w.hash) over (order by w.jahr, w.laufnummer) as tatsaechlicher_vorgaenger,
           row_number() over (order by w.jahr, w.laufnummer)        as pos
      from public.wachbuch_eintrag w
     where w.objekt_id = p_objekt
  )
  select g.id, g.jahr, g.laufnummer,
         case
           when g.hash <> kern.wachbuch_hash(kern.wachbuch_nutzlast(g.zeile),
                                             g.vorheriger_hash)
             then 'hash_falsch'
           when g.pos = 1 and g.vorheriger_hash is not null then 'kette_falsch'
           when g.pos > 1 and g.vorheriger_hash is distinct from g.tatsaechlicher_vorgaenger
             then 'kette_falsch'
           else 'intakt'
         end
    from geordnet g
   order by g.jahr, g.laufnummer;
$$;

comment on function app.wachbuch_kette_pruefen(uuid) is
  'Prueft die Hashkette eines Objekts (§6.12, §1.15). security INVOKER — sie '
  'zeigt nur, was der Aufrufer ohnehin lesen darf. Unterscheidet hash_falsch '
  '(Inhalt veraendert) von kette_falsch (Seite eingeschoben oder entfernt).';

grant execute on function app.wachbuch_kette_pruefen(uuid) to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- 8. Der nachzutragende Fremdschluessel (PR 42)
-- ---------------------------------------------------------------------------

/**
 * NACHZUTRAGEN IN PR 42, in der Migration, die `schluessel` anlegt —
 * woertlich diese Anweisung (§12):
 *
 *   alter table wachbuch_eintrag add constraint wachbuch_schluessel_fk
 *     foreign key (mandant_id, schluessel_id)
 *     references schluessel (mandant_id, id);
 *
 * Sie verlangt `unique (mandant_id, id)` auf `schluessel` (§2.1). Bis dahin
 * gilt: `art = 'schluessel'` verlangt zwar eine Kennung
 * (`wachbuch_schluessel_genannt`), aber niemand prueft, dass es sie gibt —
 * deshalb weist der Dienst `services/security/wachbuch.ts` diese Art bis PR 42
 * mit einer benannten Meldung ab, statt eine Kennung ins Leere zu schreiben.
 *
 * Ebenfalls in PR 42: `schluessel_quittung.wachbuch_eintrag_id` als
 * Enkel-Schluessel `(mandant_id, objekt_id, wachbuch_eintrag_id)` gegen
 * `wachbuch_objekt_uk` oben (§1.4).
 */

-- ---------------------------------------------------------------------------
-- 9. Medien am Wachbucheintrag (§5.8.1 von 04-PLANUNG-ZEIT.md, D-140)
-- ---------------------------------------------------------------------------

/**
 * EINE Registerzeile — genau der Weg, den 0041 dafuer vorgesehen hat: „ein
 * sechster Elternteil ist EINE Registerzeile". Die Bedingung `mb_bekannt`
 * dort fuehrt `wachbuch_eintrag` bereits namentlich; ohne diese Zeile weist
 * `me_bezug_pruefen` jedes Foto an einem Wachbucheintrag ab, und SEC-05s
 * „mit Fotos" waere unbaubar.
 *
 * `kunde_pfad` ist NULL wie bei `zeiteintrag`: ein Wachbucheintrag traegt
 * keinen Kunden, und NULL ist in der Kundensicht unsichtbar — die
 * geschlossene Richtung, solange O-78 (darf ein Kunde ein Wachbuch sehen?)
 * unbeantwortet ist.
 */
insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad)
values ('wachbuch_eintrag', 'wachbuch', null);

-- ---------------------------------------------------------------------------
-- 10. Zeilenschutz (§1.6, §1.7, §1.8)
-- ---------------------------------------------------------------------------

alter table kontrollpunkt enable row level security;
alter table kontrollpunkt force  row level security;

create policy t_mandant on kontrollpunkt for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('security.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('security.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on kontrollpunkt for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.security.lesen')));

-- Die vierte Deckenvariante (§1.8, §6.11): eine Wache muss die Kontrollpunkte
-- des Objekts sehen, das sie abgeht — und die von niemandem sonst.
create policy p_intern_einsatz_decke on kontrollpunkt as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_objekt(objekt_id)));

create policy t_person on kontrollpunkt for select to cse_app
  using (app.scope() = 'person' and app.ist_eingesetzt_auf_objekt(objekt_id));

grant select, insert, update on kontrollpunkt to cse_app;

alter table wachbuch_eintrag enable row level security;
alter table wachbuch_eintrag force  row level security;

/**
 * Modul `wachbuch` (§1.7) — und **KEINE `t_gruppe`-Policy**. §1.7 sagt es
 * ausdruecklich: „no group read". Eine Gruppenleitung liest keine
 * Vorkommnismeldungen einer anderen Gesellschaft; die Zusammenfassung, die
 * TEN-05 verlangt, ist eine Kennzahl und kein Buch.
 *
 * `for all` und trotzdem unaenderbar: das UPDATE, das diese Policy zulaesst,
 * ist die Stornospur — was sich dabei bewegen darf, entscheidet
 * `w_nur_storno`, nicht die Policy. Zwei verschiedene Fragen, zwei Mechanismen.
 */
create policy t_mandant on wachbuch_eintrag for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('wachbuch.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('wachbuch.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * Die Mitarbeiterdecke in ihrer GEWEITETEN Form (§6.12).
 *
 * Eigene Eintraege immer; fremde nur ueber den Uebergabezweig, und der ist mit
 * dem Fenster `interval '0'` heute geschlossen (O-151).
 *
 * **Warum die Wache in `mandant`-Scope ueberhaupt schreibt und nicht liest:**
 * `wachbuch.schreiben` ist der Rolle `mitarbeiter` zugeteilt, `wachbuch.lesen`
 * nicht (03-AUTH §12.7). Der Schreibweg der Wache laeuft also durch
 * `t_mandant`s WITH CHECK, der Leseweg im eigenen Portal durch `t_person`
 * darunter — das ist die K-18-Trennung und kein Versehen.
 */
create policy p_ma_decke on wachbuch_eintrag as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select id from anstellung
                              where person_id = app.aktuelle_person())
         or app.uebergabe_sichtbar(objekt_id, erfasst_am));

/**
 * Und die Kundendecke — solange O-78 offen ist, ist sie eine SPERRE.
 *
 * `04-SEITENKARTE.md` fuehrt „darf ein Wachbucheintrag einem Kunden gezeigt
 * werden?" als offene Frage und setzt beide Kundenrouten auf `—`. Eine Tabelle
 * ohne Kundendecke waere die stillschweigende Antwort „ja, sobald jemand das
 * Recht vergibt". Sie steht auf einem ANDEREN Portal als `p_ma_decke`, also
 * verletzt sie §1.8s Regel „nie zwei restriktive Policies fuer dasselbe
 * Portal" nicht.
 */
create policy p_nicht_kunde_decke on wachbuch_eintrag as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Das Mitarbeiterportal (K-18, §1.6a): die Wache liest ihre eigenen Seiten
 * ueber alle ihre Beschaeftigungen hinweg — OHNE Modulrecht, denn `t_person`
 * traegt keinen `hat_recht`-Konjunkt. Genau das laesst SEC-05 funktionieren,
 * ohne jeder Reinigungskraft der Gruppe `wachbuch.lesen` zu geben.
 */
create policy t_person on wachbuch_eintrag for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in (select id from anstellung
                               where person_id = app.aktuelle_person()));

/**
 * Kein DELETE-Grant, und der Ausloeser aus dem generierten Block darunter
 * daneben. **„Es gibt keine DELETE-Policy" ist KEIN Loeschschutz** (§1.2,
 * review B2): eine fehlende Policy loescht null Zeilen und meldet Erfolg, und
 * eine Verbindung, die nicht `cse_app` ist, fragt die Policy nie.
 */
grant select, insert, update on wachbuch_eintrag to cse_app;
-- Der naechtliche Kettenpruefer liest, mehr nicht.
create policy t_job on wachbuch_eintrag for select to cse_job using (true);
grant select on wachbuch_eintrag to cse_job;

-- ---------------------------------------------------------------------------
-- 11. Nachzutragen in `src/server/db/schema/rls.ts`
-- ---------------------------------------------------------------------------

/**
 * `kontrollpunkt` (archiv) und `wachbuch_eintrag` (archiv) — beide mit
 * Loeschsperre; `GEAENDERT_AM` bekommt NUR `kontrollpunkt`. Der
 * Wachbucheintrag ist anfuegend: ein `geaendert_am` daneben behauptete, jemand
 * habe die Seite bearbeitet, und `w_nur_storno` laesst genau das nicht zu.
 *
 * `AUDITIERT` bleibt unberuehrt. Ein `audit_log`-Eintrag je Wachbuchzeile
 * verdoppelte die groesste Tabelle dieser Domaene, und die Zeile ist bereits
 * ihr eigener Beweis: Urheber, Serverzeit, Hash und Vorgaengerhash.
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0070)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- kontrollpunkt (archiv): SEC-05, LEG-10. Der Kontrollpunkt ist der Bezug, auf den sich ein Praesenznachweis im Wachbuch beruft („war an Punkt 4"). Geloescht zeigt jeder Rundgangseintrag auf nichts mehr, und der Nachweis gegen den Auftraggeber ist wertlos. Ein abgebauter Punkt bekommt `archiviert_am`.
create trigger trg_kontrollpunkt_kein_hard_delete
  before delete on kontrollpunkt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kontrollpunkt_kein_truncate
  before truncate on kontrollpunkt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kontrollpunkt from cse_app, cse_anon, cse_checkin, cse_job;

-- wachbuch_eintrag (archiv): SEC-05, LEG-01, § 34a GewO. Das Wachbuch ist die einzige laufende Beweisfuehrung der Bewachung — Rundgang, Vorkommnis, Uebergabe, Alarm. Eine loeschbare Seite macht die Hashkette daneben zur Behauptung: fehlt ein Glied, laesst sich nicht mehr zeigen, dass nichts entfernt wurde. Korrigiert wird durch einen NEUEN, verknuepften Eintrag; die falsche Zeile bekommt `storniert_am` und `ersetzt_durch_id`.
create trigger trg_wachbuch_eintrag_kein_hard_delete
  before delete on wachbuch_eintrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_wachbuch_eintrag_kein_truncate
  before truncate on wachbuch_eintrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on wachbuch_eintrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_kontrollpunkt_geaendert_am
  before update on kontrollpunkt
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
