-- ===========================================================================
-- 0079 — Die Schluesselverwaltung: schluesselart, schluessel,
--        schluessel_quittung (SEC-05, SEC-07, TIM-08, TIM-09, LEG-01)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §6.2, §6.13,
-- §6.14 und §1.8. Wo dieser Text und eine Konvention (K-nn) auseinandergehen,
-- gilt die Konvention.
--
-- Ein Schluessel ist ein physischer Gegenstand. Genau daraus folgt alles hier:
-- er kann nicht an zwei Orten sein, und „wer hat ihn gerade" muss zu jedem
-- Zeitpunkt beantwortbar sein — auch drei Jahre spaeter, wenn jemand fragt,
-- wer die Tuer aufgeschlossen hat.
--
--   schluesselart      Der Katalog der Schluesselarten (§6.2). LEER
--                      ausgeliefert: SEC-07 nennt keine (O-148).
--   schluessel         Der einzelne Schluessel mit einem STATUS, der aus dem
--                      Journal abgeleitet ist — nie unabhaengig gesetzt.
--   schluessel_quittung Das Journal: Ausgabe, Ruecknahme, Verlust, Sperrung,
--                      Entsperrung, Vernichtung, Wiederauffinden, Inventur —
--                      mit Unterschrift, Serverzeit und unveraenderlichem
--                      Abzug des Quittungstextes.
--
-- Fuenf Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **„Ein Schluessel kann nie an zwei Orten sein" ist ein INDEX, kein
--     Dienst** (Abnahme 4). `schluessel_quittung.offen_schluessel_id` ist eine
--     GENERIERTE Spalte: sie traegt die Schluesselkennung, solange die Ausgabe
--     offen ist, und NULL, sobald sie geschlossen wurde. Darueber liegt ein
--     partieller Eindeutigkeitsindex. Eine zweite Uebergabe ohne Ruecknahme
--     scheitert damit an der Datenbank — auch fuer einen Import, ein Skript
--     oder einen kuenftigen Dienst, der den hier gebauten nicht aufruft.
--     Ein Dienst, der vorher prueft, ist die Hoeflichkeit; der Index ist die
--     Zusage.
--
--  2. **Das Journal ist die EINZIGE Wahrheit ueber den Zustand** (§6.13,
--     review B12). Der Entwurf leitete den Status aus einer zweiwertigen
--     `richtung` ab — damit waren `verloren`, `gesperrt` und `vernichtet`
--     unerreichbar, und ein von Hand gesetzter Status wurde von der naechsten
--     Uebergabe ueberschrieben. SEC-07 geht aber genau darum: dass ein
--     Schluessel VERLOREN ist, ist das Ereignis, das einen
--     Schliessanlagenaustausch und einen Haftungsfall ausloest.
--
--  3. **`entsperrung` stellt den Zustand VOR der Sperre wieder her** und nicht
--     „im Depot" (§6.13). Einen Schluessel zu entsperren, der ausgegeben war,
--     bringt ihn nicht zurueck in den Schrank. Deshalb nennt die
--     Entsperrungszeile die Sperre, die sie aufhebt, und die Ableitung laeuft
--     rueckwaerts weiter.
--
--  4. **`inventur` ist zustandsneutral** (§6.13). Eine Zaehlung ist der
--     Nachweis, dass der Schluessel gesehen wurde, keine Zustandsaenderung.
--     Sie schiebt `letzte_quittung_id` weiter, damit die Spur vollstaendig
--     ist, und laesst den Status stehen.
--
--  5. **Die Unterschrift ist heute ein NAME und eine Kennung, kein Bild.**
--     `unterzeichner_name` ist fuer Ausgabe und Ruecknahme Pflicht;
--     `signatur_medien_id` steht daneben und bleibt leer, solange der
--     Uploadweg (DOC-06, `POST /api/dokumente/upload-ticket`) nicht gebaut
--     ist. Genau dieselbe Linie wie bei der Leistungsnachweis-Unterschrift
--     (0066): lieber eine ehrliche Luecke mit „nicht verbunden" als ein
--     vorgetaeuschter Erfolg.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.2)
-- ---------------------------------------------------------------------------

/**
 * Die ACHT Lebenszyklusereignisse (§3.2, review B12) — nicht zwei Richtungen.
 * Jede Zeile des Journals ist eines davon, und die Abbildung auf die fuenf
 * Zustaende steht in Abschnitt 6 als Funktionsrumpf, nicht als Prosa.
 */
create type schluessel_ereignis_art as enum
  ('ausgabe','ruecknahme','verlustmeldung','wiedergefunden','sperrung','entsperrung',
   'vernichtung','inventur');

create type schluessel_status as enum
  ('im_depot','ausgegeben','verloren','gesperrt','vernichtet');

/** An wen ausgegeben wurde (§6.14). */
create type schluessel_empfaenger_art as enum ('mitarbeiter','kunde','fremdfirma');

-- ---------------------------------------------------------------------------
-- 2. schluesselart — der Katalog (§6.2)
-- ---------------------------------------------------------------------------

/**
 * KATALOGTABELLE, kein Aufzaehlungstyp — dieselbe Entscheidung wie bei
 * `postenart` (0069, §3.2/§1.16): SEC-07 nennt keine Schluesselarten, und wenn
 * der Mandant sie nennt, darf die Antwort keine Migration kosten.
 *
 * Ausgeliefert wird sie LEER. Die Oberflaeche sagt „keine Arten hinterlegt"
 * statt eine plausible Liste zu zeigen, die niemand bestaetigt hat (K-17).
 * // TODO(client, O-148): Welche Schluesselarten werden gefuehrt (mechanisch,
 * Transponder, Chipkarte, Zylindercode), und haengt an der Art eine
 * unterschiedliche Sorgfaltspflicht? (SEC-07)
 */
create table schluesselart (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  schluessel    text not null,
  bezeichnung   text not null,
  bezeichnung_i18n jsonb not null default '{}'::jsonb,
  beschreibung  text,
  sortierung    smallint not null default 0,

  ist_platzhalter boolean not null default true,

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
  constraint schluesselart_mandant_uk unique (mandant_id, id),

  constraint schluesselart_schluessel_gefuellt check (btrim(schluessel) <> ''),
  constraint schluesselart_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint schluesselart_i18n_schluessel
    check (bezeichnung_i18n - array['de','en','ar','tr'] = '{}'::jsonb),
  constraint schluesselart_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create unique index schluesselart_schluessel_uk on schluesselart (mandant_id, schluessel)
  where archiviert_am is null;
create index schluesselart_sortierung_idx on schluesselart (mandant_id, sortierung)
  where archiviert_am is null;

comment on table schluesselart is
  'Katalog der Schluesselarten (§6.2). LEER ausgeliefert (O-148) — eine '
  'geratene Liste saehe bestaetigt aus.';

-- ---------------------------------------------------------------------------
-- 3. schluessel — der einzelne Gegenstand (§6.13)
-- ---------------------------------------------------------------------------

create table schluessel (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  objekt_id     uuid not null,
  schluesselart_id uuid,

  bezeichnung   text not null,
  schluessel_nummer text,
  schliessanlage text,
  -- Voraussetzung fuer die Nachbestellung: ohne Sicherungskarte gibt der
  -- Hersteller keinen Nachschluessel heraus.
  sicherungskarte_nummer text,

  /**
   * ABGELEITET aus dem Journal (§6.13) — nie unabhaengig gesetzt. Der
   * Ausloeser in Abschnitt 7 weist jede direkte Aenderung ab; diese Spalte
   * ist ein Zwischenspeicher ueber `schluessel_quittung`, keine zweite
   * Wahrheit.
   */
  status        schluessel_status not null default 'im_depot',
  aktueller_besitzer_text text,
  letzte_quittung_id uuid,

  verlust_gemeldet_am timestamptz,

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
  constraint schluessel_mandant_uk unique (mandant_id, id),
  -- Ziel des Enkel-Fremdschluessels aus `schluessel_quittung` (§1.4): eine
  -- Quittung darf nicht am Objekt eines anderen Schluessels haengen.
  constraint schluessel_objekt_uk unique (mandant_id, objekt_id, id),

  constraint schluessel_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint schluessel_art_fk foreign key (mandant_id, schluesselart_id)
    references schluesselart (mandant_id, id),

  constraint schluessel_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  /**
   * Jetzt ERREICHBAR, und das ist der Unterschied zum Entwurf (§6.13): der
   * Zustand `verloren` entsteht durch ein Journalereignis, und derselbe
   * Ausloeser stempelt den Zeitpunkt. Vorher bewachte diese Bedingung einen
   * Zustand, in den die Bauart gar nicht kam.
   */
  constraint schluessel_verlust_datiert check (
    status <> 'verloren' or verlust_gemeldet_am is not null),
  constraint schluessel_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * PARTIELL auf `archiviert_am is null` (§1.3, §6.13): eine ersetzte
 * Schliessanlage vergibt dieselben Nummern legitim neu, und der Schluessel
 * „Nr. 7" der alten Anlage darf die Nummer nicht auf Dauer belegen.
 */
create unique index schluessel_nummer_uk on schluessel (objekt_id, schluessel_nummer)
  where archiviert_am is null and schluessel_nummer is not null;
create index schluessel_objekt_idx on schluessel (mandant_id, objekt_id, status)
  where archiviert_am is null;
-- „Welche Schluessel sind draussen" — die eine Frage, die morgens gestellt wird.
create index schluessel_ausgegeben_idx on schluessel (mandant_id, status)
  where status = 'ausgegeben';

comment on table schluessel is
  'Ein Schluessel, Transponder oder Zylindercode eines Objekts (§6.13, '
  'SEC-07). status, aktueller_besitzer_text und letzte_quittung_id sind ein '
  'Zwischenspeicher ueber dem Journal — nie eine unabhaengige Wahrheit.';
comment on column schluessel.status is
  'ABGELEITET aus schluessel_quittung (§6.13). Ein direkter UPDATE wird vom '
  'Ausloeser s_status_abgeleitet abgewiesen.';

-- ---------------------------------------------------------------------------
-- 4. schluessel_quittung — das Journal (§6.14)
-- ---------------------------------------------------------------------------

create table schluessel_quittung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  schluessel_id uuid not null,
  -- Denormalisiert, damit der Wachbuchschluessel objektbezogen sein kann
  -- (§1.4, §6.14). Der Ausloeser fuellt ihn; kein Aufrufer schickt ihn.
  objekt_id     uuid not null,

  art           schluessel_ereignis_art not null,

  /**
   * NUR fuer `entsperrung`: welche Sperre wird aufgehoben (§6.14)? Ohne diesen
   * Verweis muesste die Ableitung raten, welcher Zustand vor der Sperre galt —
   * und „im Depot" waere die falsche Antwort fuer einen Schluessel, der
   * ausgegeben war.
   */
  aufhebt_quittung_id uuid,

  /**
   * Welche AUSGABE diese Zeile schliesst.
   *
   * **Diese Spalte steht nicht im Datenmodell, und sie ist trotzdem die
   * tragende Haelfte von Abnahme 4.** §6.14 beschreibt ein rein anfuegendes
   * Journal; „hoechstens eine offene Ausgabe je Schluessel" ist darin eine
   * Aussage ueber ZWEI Zeilen und damit weder als `CHECK` noch als Index
   * ausdrueckbar. Erst der Verweis von der schliessenden Zeile auf die
   * geschlossene macht den Zustand „offen" zu einer Eigenschaft EINER Zeile —
   * und damit indizierbar (siehe `offen_schluessel_id` unten).
   *
   * Gesetzt wird sie ausschliesslich vom Ausloeser, EINMAL, und nur auf der
   * `ausgabe`-Zeile: `sq_unveraenderlich` laesst genau diese eine Bewegung zu
   * und keine zweite.
   */
  geschlossen_durch_quittung_id uuid,

  /**
   * **Die Spalte, auf der die Eindeutigkeit liegt** (Abnahme 4).
   *
   * GENERIERT, also nicht setzbar und nicht vergessbar: eine offene Ausgabe
   * traegt die Schluesselkennung, alles andere NULL. Der partielle
   * Eindeutigkeitsindex darunter macht daraus „hoechstens eine offene Ausgabe
   * je Schluessel" — geprueft beim INSERT, fuer jede Rolle und jeden Weg,
   * auch fuer einen Import, der den Dienst nicht kennt.
   */
  offen_schluessel_id uuid generated always as (
    case when art = 'ausgabe' and geschlossen_durch_quittung_id is null
         then schluessel_id end) stored,

  empfaenger_art schluessel_empfaenger_art,
  anstellung_id uuid,
  person_id     uuid,
  kunde_id      uuid,
  firma_id      uuid references firma(id),
  -- Namensabzug, unabhaengig von spaeteren Stammdatenaenderungen: wer die
  -- Quittung in drei Jahren liest, soll den Namen sehen, der damals daraufstand.
  empfaenger_name text,

  /**
   * DIE SERVERZEIT (Invariante 5, TIM-08). Der Vorgabewert allein genuegt
   * nicht — er greift nur bei WEGGELASSENER Spalte; der Ausloeser
   * ueberschreibt jeden mitgeschickten Wert.
   */
  quittiert_am  timestamptz not null default now(),
  geraete_zeit  timestamptz,
  zeitabweichung_sek integer,
  nachgetragen  boolean not null default false,

  ausgegeben_von_benutzer_id uuid references benutzer(id),
  geplante_rueckgabe date,

  unterzeichner_name text,
  signatur_medien_id uuid,

  /**
   * Der unveraenderliche Abzug des Quittungstextes — Schluessel, Objekt,
   * Empfaenger, Zeitpunkt, wie angezeigt (§6.14). Er ist der Grund, aus dem
   * eine spaetere Umbenennung des Objekts die Quittung nicht umschreibt.
   */
  snapshot      jsonb not null,
  -- `sha256(kanonisches_json(snapshot))`, hex — derselbe Kanonisierer wie
  -- beim Leistungsnachweis (D-181), damit es nicht zwei Fassungen gibt.
  snapshot_hash text not null,

  wachbuch_eintrag_id uuid,
  bemerkung     text,

  -- §1.14.
  -- // TODO(client, O-25): Wie lange wird eine Schluesselquittung aufbewahrt,
  -- und auf welcher Rechtsgrundlage?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default true,

  -- Auditblock OHNE `geaendert_*` (§6.14): anfuegend.
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint sq_mandant_uk unique (mandant_id, id),

  -- Der ENKEL-Schluessel (§1.4): die Quittung haengt am Schluessel DIESES
  -- Objekts, nicht bloss an einem Schluessel desselben Mandanten.
  constraint sq_schluessel_fk foreign key (mandant_id, objekt_id, schluessel_id)
    references schluessel (mandant_id, objekt_id, id),
  constraint sq_aufhebt_fk foreign key (mandant_id, aufhebt_quittung_id)
    references schluessel_quittung (mandant_id, id),
  constraint sq_geschlossen_fk foreign key (mandant_id, geschlossen_durch_quittung_id)
    references schluessel_quittung (mandant_id, id),
  constraint sq_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint sq_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  constraint sq_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint sq_medien_fk foreign key (mandant_id, signatur_medien_id)
    references einsatz_medien (mandant_id, id),
  -- Der GROSSELTERN-Schluessel: die Schluesselbewegung steht im Wachbuch
  -- DIESES Objekts (§1.4, 0070 `wachbuch_objekt_uk`).
  constraint sq_wachbuch_fk foreign key (mandant_id, objekt_id, wachbuch_eintrag_id)
    references wachbuch_eintrag (mandant_id, objekt_id, id),

  -- `aufhebt_quittung_id` gehoert GENAU zur Entsperrung (§6.14).
  constraint sq_aufhebt_nur_entsperrung check (
    (art = 'entsperrung') = (aufhebt_quittung_id is not null)),
  -- Geschlossen wird nur eine AUSGABE.
  constraint sq_geschlossen_nur_ausgabe check (
    geschlossen_durch_quittung_id is null or art = 'ausgabe'),
  constraint sq_nicht_selbst check (
    geschlossen_durch_quittung_id is distinct from id
    and aufhebt_quittung_id is distinct from id),
  -- Einen Empfaenger haben genau Ausgabe und Ruecknahme (§6.14).
  constraint sq_empfaenger_nur_bewegung check (
    (art in ('ausgabe','ruecknahme')) = (empfaenger_art is not null)),
  constraint sq_empfaenger_mitarbeiter check (
    (empfaenger_art = 'mitarbeiter') = (anstellung_id is not null)),
  constraint sq_empfaenger_kunde check (
    (empfaenger_art = 'kunde') = (kunde_id is not null)),
  constraint sq_empfaenger_fremdfirma check (
    (empfaenger_art = 'fremdfirma') = (firma_id is not null)),
  constraint sq_person_bei_anstellung check (
    (person_id is not null) = (anstellung_id is not null)),
  -- Eine Uebergabe ohne Unterschrift ist keine Quittung (§6.14).
  constraint sq_unterzeichner check (
    art not in ('ausgabe','ruecknahme') or btrim(coalesce(unterzeichner_name,'')) <> ''),
  constraint sq_hash_form check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint sq_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * **DER Index von Abnahme 4** — „ein Schluessel kann nie an zwei Orten sein".
 *
 * Partiell, damit nur die OFFENEN Ausgaben verglichen werden: geschlossene
 * tragen NULL und stehen gar nicht darin. Zwei Uebergaben desselben
 * Schluessels ohne Ruecknahme dazwischen sind damit eine Verletzung der
 * Eindeutigkeit — kein Dienstfehler, sondern ein Datenbankfehler, und zwar
 * auch dann, wenn beide gleichzeitig ankommen.
 */
create unique index sq_offene_ausgabe_uk on schluessel_quittung (offen_schluessel_id)
  where offen_schluessel_id is not null;

/**
 * Eine Ruecknahme schliesst hoechstens EINE Ausgabe: der Rueckverweis ist
 * eindeutig. Ohne diesen Index koennten zwei Ausgaben dieselbe Ruecknahme als
 * Abschluss nennen, und die Historie erzaehlte zwei Vorgaenge als einen.
 */
create unique index sq_schliesst_uk on schluessel_quittung (geschlossen_durch_quittung_id)
  where geschlossen_durch_quittung_id is not null;

-- Historie und Statusableitung.
create index sq_schluessel_idx on schluessel_quittung (schluessel_id, quittiert_am desc);
-- „Welche Schluessel haelt dieser Mensch" — die Abgangs-Checkliste.
create index sq_person_idx on schluessel_quittung (mandant_id, person_id)
  where person_id is not null;
-- Der Waechter `job:schluessel_ueberfaellig`.
create index sq_ueberfaellig_idx on schluessel_quittung (mandant_id, geplante_rueckgabe)
  where art = 'ausgabe' and geplante_rueckgabe is not null;

comment on table schluessel_quittung is
  'Das Schluesseljournal (§6.14, SEC-07): acht Ereignisarten mit '
  'Unterschrift, SERVERZEIT und unveraenderlichem Abzug. Nur anfuegbar — '
  'einzige Ausnahme ist der einmalige Abschlussverweis auf einer Ausgabe.';
comment on column schluessel_quittung.offen_schluessel_id is
  'GENERIERT: die Schluesselkennung, solange die Ausgabe offen ist. Traegt '
  'den partiellen Eindeutigkeitsindex sq_offene_ausgabe_uk (Abnahme 4).';

-- Jetzt, wo es `schluessel` gibt, bekommt der Zwischenspeicher seinen
-- Schluessel — und der Wachbucheintrag den seinen (0070 Abschnitt 8).
alter table schluessel add constraint schluessel_letzte_quittung_fk
  foreign key (mandant_id, letzte_quittung_id)
  references schluessel_quittung (mandant_id, id)
  deferrable initially deferred;

alter table wachbuch_eintrag add constraint wachbuch_schluessel_fk
  foreign key (mandant_id, schluessel_id)
  references schluessel (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 5. Der Einfuegeausloeser des Journals (§6.14)
-- ---------------------------------------------------------------------------

/**
 * Serverzeit, Geraeteabweichung, Objektkopie, Endzustandssperre und die
 * Legalitaet der Ereignisfolge — in EINER Funktion, vor dem Schreiben.
 *
 * **Warum EIN Ausloeser:** PostgreSQL feuert BEFORE-Ausloeser alphabetisch.
 * Getrennt liefe die Zustandspruefung womoeglich vor dem Zeitstempel und
 * vergliche gegen eine Zeit, die es noch nicht gibt (dieselbe Falle wie 0070).
 *
 * **Die Sperre auf dem Schluessel serialisiert.** `select … for update` haelt
 * zwei gleichzeitige Ruecknahmen auseinander; die zweite sieht dann, dass die
 * Ausgabe bereits geschlossen ist. Fuer die Gegenrichtung — zwei gleichzeitige
 * AUSGABEN — traegt `sq_offene_ausgabe_uk` die Zusage, und zwar unabhaengig
 * von dieser Funktion.
 *
 * **Die doppelte Ausgabe wird hier ABSICHTLICH nicht geprueft** (Abnahme 4).
 * Eine Pruefung im Ausloeser waere eine zweite, freundlichere Fassung
 * derselben Regel — und die erste Abweichung zwischen beiden faellt niemandem
 * auf. Der Index weist ab, der Dienst uebersetzt `23505` auf
 * `sq_offene_ausgabe_uk` in eine lesbare Meldung.
 */
create function kern.schluessel_quittung_vorbereiten() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_schluessel schluessel;
  v_offen      uuid;
begin
  select * into v_schluessel from public.schluessel s
   where s.id = new.schluessel_id and s.mandant_id = new.mandant_id
   for update;

  if not found then
    raise exception 'Den Schluessel % gibt es in dieser Gesellschaft nicht',
      new.schluessel_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Die Objektkopie kommt vom Schluessel, NIE vom Aufrufer (§6.14).
  new.objekt_id := v_schluessel.objekt_id;

  -- 1. DIE SERVERUHR (Invariante 5, TIM-08).
  new.quittiert_am := now();
  if new.geraete_zeit is not null then
    -- Geraet MINUS Server, vorzeichenbehaftet, in Sekunden.
    new.zeitabweichung_sek :=
      round(extract(epoch from (new.geraete_zeit - new.quittiert_am)))::integer;
  else
    new.zeitabweichung_sek := null;
  end if;

  /**
   * 2. `vernichtung` ist ENDGUELTIG (§6.13). Danach ist nur noch `inventur`
   *    zulaessig — eine Zaehlung darf auch einen vernichteten Schluessel als
   *    „geprueft, nicht mehr vorhanden" vermerken; alles andere behauptete
   *    einen Vorgang an einem Gegenstand, den es nicht mehr gibt.
   */
  if v_schluessel.status = 'vernichtet' and new.art <> 'inventur' then
    raise exception 'Dieser Schluessel ist vernichtet (SEC-07)'
      using errcode = 'P0001',
            detail  = 'Nach einer Vernichtung traegt das Journal nur noch '
                      || 'Inventurzeilen.',
            hint    = 'Ein Ersatzschluessel ist ein NEUER Schluessel, keine '
                      || 'Fortsetzung dieses Journals.';
  end if;

  -- 3. Eine Ruecknahme braucht eine offene Ausgabe.
  if new.art = 'ruecknahme' then
    select q.id into v_offen from public.schluessel_quittung q
     where q.offen_schluessel_id = new.schluessel_id;
    if v_offen is null then
      raise exception 'Dieser Schluessel ist nicht ausgegeben (SEC-07)'
        using errcode = 'P0001',
              detail  = 'Es gibt keine offene Uebergabe, die eine Ruecknahme '
                        || 'schliessen koennte.',
              hint    = 'Ein Schluessel, der im Depot liegt, wird nicht '
                        || 'zurueckgegeben — er wird gezaehlt (Inventur).';
    end if;
  end if;

  /**
   * 4. Eine Entsperrung hebt eine SPERRE auf, und zwar eine dieses
   *    Schluessels. Ohne diese Pruefung liefe die Ableitung rueckwaerts in
   *    das Journal eines fremden Schluessels.
   */
  if new.art = 'entsperrung' then
    if not exists (select 1 from public.schluessel_quittung q
                    where q.id = new.aufhebt_quittung_id
                      and q.schluessel_id = new.schluessel_id
                      and q.art = 'sperrung') then
      raise exception 'Die aufgehobene Zeile ist keine Sperrung dieses Schluessels'
        using errcode = 'P0001',
              hint = 'aufhebt_quittung_id nennt die Sperrung, die diese Zeile aufhebt.';
    end if;
  end if;

  return new;
end $$;

comment on function kern.schluessel_quittung_vorbereiten() is
  'Serverzeit, Geraeteabweichung, Objektkopie und die Legalitaet der '
  'Ereignisfolge (§6.13, §6.14). Die doppelte Ausgabe prueft der Index '
  'sq_offene_ausgabe_uk, nicht diese Funktion.';

create trigger a_schluessel_quittung_vorbereiten
  before insert on schluessel_quittung
  for each row execute function kern.schluessel_quittung_vorbereiten();

/**
 * Und die andere Haelfte: das Journal ist anfuegend.
 *
 * Beweglich sind GENAU drei Dinge, und jedes aus einem genannten Grund:
 *
 *   geschlossen_durch_quittung_id  einmal, von NULL auf eine Kennung — der
 *                                  Abschlussverweis, auf dem Abnahme 4 ruht.
 *   aufbewahrung_bis, loeschsperre §1.14, geschrieben von `job:aufbewahrung`.
 *
 * Alles andere ist Beweis: **eine falsche Quittung wird durch eine
 * Gegenquittung richtiggestellt, nie ueberschrieben** (§6.14).
 */
create function kern.schluessel_quittung_unveraenderlich() returns trigger
language plpgsql as $$
declare
  v_erlaubt schluessel_quittung;
begin
  if old.geschlossen_durch_quittung_id is not null
     and new.geschlossen_durch_quittung_id is distinct from old.geschlossen_durch_quittung_id then
    raise exception 'Diese Uebergabe ist bereits abgeschlossen (SEC-07)'
      using errcode = 'P0001',
            hint = 'Eine zweite Ruecknahme derselben Ausgabe gibt es nicht.';
  end if;

  v_erlaubt := old;
  v_erlaubt.geschlossen_durch_quittung_id := new.geschlossen_durch_quittung_id;
  v_erlaubt.offen_schluessel_id           := new.offen_schluessel_id;
  v_erlaubt.aufbewahrung_bis              := new.aufbewahrung_bis;
  v_erlaubt.loeschsperre                  := new.loeschsperre;

  if to_jsonb(v_erlaubt) is distinct from to_jsonb(new) then
    raise exception 'Eine Schluesselquittung wird nicht geaendert (SEC-07, LEG-01)'
      using errcode = 'P0001',
            detail  = 'Sie traegt Unterschrift, Serverzeit und einen gehashten '
                      || 'Abzug des Quittungstextes.',
            hint    = 'Richtiggestellt wird durch eine GEGENQUITTUNG — eine '
                      || 'weitere Zeile im Journal.';
  end if;
  return new;
end $$;

create trigger sq_unveraenderlich
  before update on schluessel_quittung
  for each row execute function kern.schluessel_quittung_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 6. Die Ableitung: acht Ereignisse, fuenf Zustaende (§6.13)
-- ---------------------------------------------------------------------------

/**
 * `kern.refresh_schluessel_status()` — DIE Abbildungstabelle aus §6.13, als
 * Funktionsrumpf.
 *
 *   ausgabe        → ausgegeben, Besitzer aus der Quittung
 *   ruecknahme     → im_depot, Besitzer geloescht
 *   verlustmeldung → verloren, verlust_gemeldet_am gestempelt
 *   wiedergefunden → im_depot; eine erneute Ausgabe ist eine NEUE Zeile
 *   sperrung       → gesperrt
 *   entsperrung    → der Zustand VOR der aufgehobenen Sperre (rueckwaerts)
 *   vernichtung    → vernichtet, endgueltig
 *   inventur       → zustandsneutral; nur `letzte_quittung_id` wandert weiter
 *
 * Die Schleife laeuft rueckwaerts und hat eine Obergrenze: eine Kette aus
 * Entsperrungen, die sich im Kreis drehte, brauchte einen von Hand
 * geschriebenen Verweis — und ein Ausloeser, der dann haengt, ist der
 * schlechtere Ausgang als einer, der aufgibt.
 */
create function kern.refresh_schluessel_status() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  r              record;
  v_status       schluessel_status := 'im_depot';
  v_besitzer     text := null;
  v_grenze       timestamptz := 'infinity';
  v_grenze_id    uuid := null;
  v_runden       integer := 0;
  v_letzte       uuid;
  v_verlust      timestamptz;
  v_offen        uuid;
begin
  /**
   * 1. Die Ruecknahme schliesst die offene Ausgabe. Sie steht HIER und nicht
   *    im BEFORE-Ausloeser, weil die schliessende Zeile erst existieren muss,
   *    bevor jemand auf sie zeigen kann — `sq_geschlossen_fk` verlangt sie.
   *
   *    `wiedergefunden` und `vernichtung` schliessen ebenfalls: ein
   *    wiedergefundener Schluessel liegt im Depot, ein vernichteter ist weg —
   *    in beiden Faellen ist die Uebergabe zu Ende, und ohne den Abschluss
   *    verboete `sq_offene_ausgabe_uk` jede spaetere Ausgabe.
   *
   *    `verlustmeldung` schliesst AUSDRUECKLICH NICHT: der Schluessel ist
   *    weiter bei der Person, die ihn genommen hat — das ist ja gerade der
   *    Haftungsfall.
   */
  if new.art in ('ruecknahme','wiedergefunden','vernichtung') then
    select q.id into v_offen from public.schluessel_quittung q
     where q.offen_schluessel_id = new.schluessel_id;
    if v_offen is not null then
      update public.schluessel_quittung
         set geschlossen_durch_quittung_id = new.id
       where id = v_offen;
    end if;
  end if;

  -- 2. Rueckwaerts durch das Journal, bis ein zustandstragendes Ereignis
  --    antwortet.
  loop
    v_runden := v_runden + 1;
    exit when v_runden > 50;

    select q.* into r from public.schluessel_quittung q
     where q.schluessel_id = new.schluessel_id
       and q.art <> 'inventur'
       and (q.quittiert_am < v_grenze
            or (q.quittiert_am = v_grenze and v_grenze_id is not null and q.id < v_grenze_id))
     order by q.quittiert_am desc, q.id desc
     limit 1;

    if not found then
      v_status := 'im_depot';
      v_besitzer := null;
      exit;
    end if;

    if r.art = 'entsperrung' then
      -- Weiter rueckwaerts, und zwar vor die Sperre, die diese Zeile aufhebt.
      select q.quittiert_am, q.id into v_grenze, v_grenze_id
        from public.schluessel_quittung q where q.id = r.aufhebt_quittung_id;
      continue;
    end if;

    v_status := case r.art
                  when 'ausgabe'        then 'ausgegeben'
                  when 'ruecknahme'     then 'im_depot'
                  when 'verlustmeldung' then 'verloren'
                  when 'wiedergefunden' then 'im_depot'
                  when 'sperrung'       then 'gesperrt'
                  when 'vernichtung'    then 'vernichtet'
                end::schluessel_status;
    v_besitzer := case when r.art = 'ausgabe' then r.empfaenger_name else null end;

    /**
     * Ein verlorener oder gesperrter Schluessel, der AUSGEGEBEN war, ist noch
     * immer bei jemandem. Den Besitzer zu loeschen hiesse, die Frage „wer hat
     * ihn zuletzt gehabt" unbeantwortbar zu machen — und das ist im
     * Haftungsfall die erste Frage.
     */
    if r.art in ('verlustmeldung','sperrung') then
      select q.empfaenger_name into v_besitzer
        from public.schluessel_quittung q
       where q.schluessel_id = new.schluessel_id
         and q.art = 'ausgabe'
         and q.quittiert_am <= r.quittiert_am
       order by q.quittiert_am desc, q.id desc
       limit 1;
    end if;
    exit;
  end loop;

  -- 3. `letzte_quittung_id` wandert IMMER weiter — auch bei der Inventur
  --    (§6.13): die Spur soll vollstaendig sein.
  select q.id into v_letzte from public.schluessel_quittung q
   where q.schluessel_id = new.schluessel_id
   order by q.quittiert_am desc, q.id desc limit 1;

  select min(q.quittiert_am) into v_verlust from public.schluessel_quittung q
   where q.schluessel_id = new.schluessel_id and q.art = 'verlustmeldung';

  update public.schluessel
     set status = v_status,
         aktueller_besitzer_text = v_besitzer,
         letzte_quittung_id = v_letzte,
         -- Bleibt stehen, auch wenn der Schluessel wieder auftaucht: dass er
         -- einmal als verloren gemeldet war, ist Teil der Akte.
         verlust_gemeldet_am = coalesce(v_verlust, verlust_gemeldet_am)
   where id = new.schluessel_id;

  return null;
end $$;

comment on function kern.refresh_schluessel_status() is
  'Leitet status, Besitzer und letzte_quittung_id aus dem Journal ab (§6.13). '
  'Inventur ist zustandsneutral, Vernichtung endgueltig, Entsperrung laeuft '
  'rueckwaerts bis vor die aufgehobene Sperre.';

create trigger z_schluessel_status_ableiten
  after insert on schluessel_quittung
  for each row execute function kern.refresh_schluessel_status();

/**
 * Und der Schutz davor, dass jemand den Zwischenspeicher von Hand verstellt.
 *
 * **`pg_trigger_depth()` ist hier der Unterscheider und keine Spielerei.** Die
 * Ableitung oben IST ein `UPDATE` auf `schluessel` — sie laeuft aber aus einem
 * Ausloeser heraus, also auf Tiefe > 1. Ein `UPDATE` aus der Anwendung kommt
 * auf Tiefe 1 an. Genau diese Unterscheidung braucht die Zusage „status ist
 * abgeleitet": ohne sie muesste die Ableitung ihre eigene Sperre umgehen, und
 * jede Umgehung liesse sich auch von aussen benutzen.
 */
create function kern.schluessel_status_abgeleitet() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;

  if new.status is distinct from old.status
     or new.aktueller_besitzer_text is distinct from old.aktueller_besitzer_text
     or new.letzte_quittung_id is distinct from old.letzte_quittung_id
     or new.verlust_gemeldet_am is distinct from old.verlust_gemeldet_am then
    raise exception 'Der Schluesselzustand wird nicht gesetzt, sondern gebucht (SEC-07)'
      using errcode = 'P0001',
            detail  = 'status, aktueller_besitzer_text, letzte_quittung_id und '
                      || 'verlust_gemeldet_am sind aus schluessel_quittung abgeleitet.',
            hint    = 'Eine Zustandsaenderung ist eine Journalzeile: Ausgabe, '
                      || 'Ruecknahme, Verlustmeldung, Sperrung, Entsperrung, '
                      || 'Wiederauffinden oder Vernichtung.';
  end if;
  return new;
end $$;

create trigger s_status_abgeleitet
  before update on schluessel
  for each row execute function kern.schluessel_status_abgeleitet();

create trigger trg_schluesselart_archivierung
  before insert or update on schluesselart
  for each row execute function kern.archivierung_stempeln();
create trigger trg_schluessel_archivierung
  before insert or update on schluessel
  for each row execute function kern.archivierung_stempeln();

-- ---------------------------------------------------------------------------
-- 7. Zeilenschutz (§1.6, §1.7, §1.8)
-- ---------------------------------------------------------------------------

alter table schluesselart enable row level security;
alter table schluesselart force  row level security;

create policy t_mandant on schluesselart for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('schluessel.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('schluessel.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

-- `p_intern_decke` (§6.2): der Katalog ist Bueroarbeit. Die Wache sieht die
-- ART ihres Schluessels auf der Quittung, im Abzug — dort steht sie als Text.
create policy p_intern_decke on schluesselart as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on schluesselart to cse_app;

alter table schluessel enable row level security;
alter table schluessel force  row level security;

/**
 * Modul `schluessel` (§1.7) — und **KEINE `t_gruppe`-Policy**. §1.7 sagt es
 * ausdruecklich: kein Gruppenlesen. Welche Schluessel eines fremden Objekts
 * gerade draussen sind, ist Betriebswissen einer Gesellschaft; der Schluessel
 * `gruppe.schluessel.lesen` existiert im Katalog und wird hier bewusst nicht
 * benutzt.
 */
create policy t_mandant on schluessel for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('schluessel.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('schluessel.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * Die vierte Deckenvariante (§1.8, §6.13): die Wache nimmt den Schluessel des
 * Objekts, auf dem sie eingesetzt ist, und gibt ihn dort zurueck — und sieht,
 * welche Schluessel dieses Objekts gerade draussen sind. Eine reine
 * Interndecke — was der Entwurf trug — schloesse `/portal/mein` fuer das ganze
 * Journal, waehrend §1.7 gleichzeitig `schluessel.schreiben` an `mitarbeiter`
 * bindet; die beiden Haelften widersprachen sich (§6.13).
 */
create policy p_intern_einsatz_decke on schluessel as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_objekt(objekt_id)));

create policy t_person on schluessel for select to cse_app
  using (app.scope() = 'person' and app.ist_eingesetzt_auf_objekt(objekt_id));

/**
 * Der Lesepfad des Definers (§1.10, K-01): `kern.schluessel_quittung_
 * vorbereiten` liest und sperrt den Schluessel, `kern.refresh_schluessel_
 * status` schreibt den Zwischenspeicher. Unter FORCE ROW LEVEL SECURITY liest
 * eine Definer-Funktion ohne eigene Policy NICHTS — und die Uebergabe
 * scheiterte mit „Schluessel gibt es nicht", obwohl es ihn gibt.
 */
create policy s_definer on schluessel for select to cse_definer using (true);
create policy s_definer_status on schluessel for update to cse_definer
  using (true) with check (true);

grant select, insert, update on schluessel to cse_app;
grant select on schluessel to cse_definer;
grant update (status, aktueller_besitzer_text, letzte_quittung_id, verlust_gemeldet_am,
              geaendert_am, geaendert_von, geaendert_von_art)
  on schluessel to cse_definer;

-- Der naechtliche Waechter `job:schluessel_ueberfaellig` liest, mehr nicht.
create policy t_job on schluessel for select to cse_job using (true);
grant select on schluessel to cse_job;

alter table schluessel_quittung enable row level security;
alter table schluessel_quittung force  row level security;

create policy t_mandant on schluessel_quittung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('schluessel.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('schluessel.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * Die Mitarbeiterdecke auf `anstellung_id` (§6.14): die Wache sieht ihre
 * EIGENEN Quittungen. Dass eine Kollegin einen Schluessel hat, ist eine
 * Auskunft ueber eine benannte Person.
 *
 * Ihr SCHREIBWEG laeuft durch `t_mandant`s WITH CHECK, und das geht auf:
 * `schluessel.schreiben` ist der Rolle `mitarbeiter` wirklich gebunden
 * (03-AUTH §12.3), weil SEC-07 die Wache vor Ort quittieren laesst — anders
 * als bei `dienstanweisung.schreiben`, das sie nicht haelt.
 */
create policy p_ma_decke on schluessel_quittung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                              where a.person_id = app.aktuelle_person()));

create policy t_person on schluessel_quittung for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));

create policy sq_definer on schluessel_quittung for select to cse_definer using (true);
create policy sq_definer_abschluss on schluessel_quittung for update to cse_definer
  using (true) with check (true);

/**
 * `select, insert, update` — und das UPDATE ist AUSSCHLIESSLICH der
 * Abschlussverweis. Was sich dabei bewegen darf, entscheidet
 * `sq_unveraenderlich`, nicht dieses Recht: zwei verschiedene Fragen, zwei
 * Mechanismen (0070 hat dieselbe Trennung fuer die Stornospur).
 */
grant select, insert, update on schluessel_quittung to cse_app;
grant select on schluessel_quittung to cse_definer;
grant update (geschlossen_durch_quittung_id) on schluessel_quittung to cse_definer;

create policy t_job on schluessel_quittung for select to cse_job using (true);
grant select on schluessel_quittung to cse_job;

-- ---------------------------------------------------------------------------
-- 8. Nachzutragen in `src/server/db/schema/rls.ts`
-- ---------------------------------------------------------------------------

/**
 * `schluesselart` (archiv), `schluessel` (archiv) und `schluessel_quittung`
 * (append) — alle drei mit Loeschsperre. `GEAENDERT_AM` bekommen die ersten
 * zwei; das Journal ist anfuegend.
 *
 * Die Loeschsperre ist beim Journal die eigentliche Zusage von SEC-07: eine
 * loeschbare Quittung heisst, dass sich „wer hatte den Schluessel" nachtraeglich
 * umschreiben laesst — und genau das ist die Frage, die nach einem Einbruch
 * gestellt wird.
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0079)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- schluesselart (archiv): SEC-07. Der Katalog ist der Bezug jedes Schluessels; geloescht traegt eine zehn Jahre alte Quittung eine Art, die niemand mehr aufloesen kann. Eine nicht mehr gefuehrte Art bekommt `archiviert_am`.
create trigger trg_schluesselart_kein_hard_delete
  before delete on schluesselart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_schluesselart_kein_truncate
  before truncate on schluesselart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on schluesselart from cse_app, cse_anon, cse_checkin, cse_job;

-- schluessel (archiv): SEC-07, LEG-01. Am Schluessel haengt sein Journal. Ihn zu loeschen nimmt dem Journal seinen Gegenstand und macht die Frage „wer hatte Zutritt" unbeantwortbar — die erste Frage nach einem Einbruch. Ein ausgemusterter Schluessel bekommt `archiviert_am` oder eine Vernichtungszeile.
create trigger trg_schluessel_kein_hard_delete
  before delete on schluessel
  for each row execute function kern.verhindere_loeschung();
create trigger trg_schluessel_kein_truncate
  before truncate on schluessel
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on schluessel from cse_app, cse_anon, cse_checkin, cse_job;

-- schluessel_quittung (append): SEC-07, LEG-01. Das Journal ist der Nachweis der Schluesselgewalt und die Grundlage jeder Haftungsfrage nach einem Schliessanlagenaustausch. Eine loeschbare Quittung heisst, dass sich „wer hatte den Schluessel" nachtraeglich umschreiben laesst. Richtiggestellt wird durch eine Gegenquittung.
create trigger trg_schluessel_quittung_kein_hard_delete
  before delete on schluessel_quittung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_schluessel_quittung_kein_truncate
  before truncate on schluessel_quittung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on schluessel_quittung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_schluesselart_geaendert_am
  before update on schluesselart
  for each row execute function kern.setze_geaendert_am();
create trigger trg_schluessel_geaendert_am
  before update on schluessel
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
