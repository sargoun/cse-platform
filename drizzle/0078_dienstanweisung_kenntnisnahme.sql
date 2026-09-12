-- ===========================================================================
-- 0078 — Die versionierte Dienstanweisung und ihre Kenntnisnahme:
--        dienstanweisung, dienstanweisung_version, da_pflicht,
--        da_kenntnisnahme (SEC-06, EMP-09, EMP-12, DOC-05, APR-02, LEG-04)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §6.7, §6.8, §6.9,
-- §6.10, §1.8 und §1.10. Wo dieser Text und eine Konvention (K-nn)
-- auseinandergehen, gilt die Konvention.
--
-- Eine Dienstanweisung ist das Regelwerk, nach dem an einem Objekt bewacht
-- wird. Im Haftungsfall ist sie nur so viel wert, wie sich zeigen laesst,
-- WELCHEN TEXT die Wache gelesen hat — nicht, dass sie irgendwann irgendeine
-- Fassung bestaetigt hat. Deshalb stehen hier vier Tabellen und nicht eine:
--
--   dienstanweisung          der stabile Kopf: Objekt, Posten, Titel, Status
--                            und die Fassung, die GERADE gilt (§6.7).
--   dienstanweisung_version  die Fassung mit Inhalt und `inhalt_hash`, ab der
--                            Veroeffentlichung unveraenderlich (§6.8).
--   da_pflicht               WER bestaetigen muss — eine echte Population und
--                            kein Anti-Join gegen den Dienstplan (§6.9).
--   da_kenntnisnahme         die Bestaetigung EINER Fassung, mit Serverzeit
--                            und einer Kopie des Fassungs-Hashes (§6.10).
--
-- Vier Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **„Veraltet" ist ABGELEITET, nicht geschrieben.** Version 3 zu
--     veroeffentlichen aendert KEINE einzige alte Kenntnisnahme: eine
--     Bestaetigung zeigt auf eine Fassung, und ob sie noch gilt, entscheidet
--     der Vergleich mit `dienstanweisung.aktive_version_id`. Ein Lauf, der
--     alte Zeilen als „veraltet" STEMPELTE, aenderte Beweiszeilen — und die
--     Frage „was hat Fatima am 3. Maerz bestaetigt" waere danach nicht mehr
--     beantwortbar. Abnahme 1 verlangt genau beides: neue Pflicht, alte
--     Zeilen unberuehrt.
--
--  2. **Die Pflicht entsteht aus der EINTEILUNG, nicht aus der Schicht.** Der
--     Entwurf leitete die Pflichtigen aus einem Anti-Join gegen `einsatz` ab:
--     eine neu eingestellte Wache, die einem Objekt zugeordnet, aber noch
--     nicht verplant war, tauchte nie als offen auf — und die Luecke wurde
--     nach der Schicht sichtbar (§6.9, review MISSING). `da_pflicht` ist
--     deshalb eine Tabelle, gepflegt nach dem K-14-Muster: der Ausloeser legt
--     nur an, was fehlt, und beendet nur, was ihm gehoert.
--
--  3. **Die Fassungsnummer entsteht unter einer Sperre auf dem KOPF.** Zwei
--     gleichzeitig angelegte Entwuerfe bekaemen sonst beide `max+1`, und
--     `da_version_uk` liesse den zweiten scheitern — mit einer Meldung, die
--     nach einem Programmfehler aussieht statt nach Gleichzeitigkeit.
--
--  4. **Kein Geodatum an der Kenntnisnahme** (§6.10, LEG-10). Eine Anweisung
--     auf dem Telefon zu bestaetigen braucht keinen Ort, und eine Koordinate
--     auf einer Zeile, die nie geloescht wird, ist ein dauerhaftes
--     Beschaeftigtendatum ohne Zweck (DSGVO Art. 5 Abs. 1 lit. c). Sie sind
--     hier namentlich als NICHT vorhanden vermerkt, damit niemand sie
--     „der Vollstaendigkeit halber" nachtraegt.
--
-- NICHT in dieser Migration: `schluessel`, `schluesselart`,
-- `schluessel_quittung` (0079).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.2)
-- ---------------------------------------------------------------------------

/**
 * FESTGESCHRIEBEN (§3.2). Alle drei stehen woertlich im Datenmodell; keiner
 * ist ein Platzhalter, keiner traegt eine offene Frage.
 */
create type dienstanweisung_status as enum ('entwurf','veroeffentlicht','archiviert');

/**
 * Wie bestaetigt wurde. `portal_klick` ist der Weg aus EMP-09 — ein Tipp auf
 * dem Telefon —, `canvas_signatur` die Unterschrift auf dem Bildschirm,
 * `papier_erfassung` die nachgetragene Unterschrift auf Papier.
 */
create type kenntnisnahme_art as enum ('portal_klick','canvas_signatur','papier_erfassung');

/** Woher die Pflicht kommt (§6.9). */
create type da_pflicht_quelle as enum ('objekt_einsatz','posten','manuell');

-- ---------------------------------------------------------------------------
-- 2. dienstanweisung — der stabile Kopf (§6.7)
-- ---------------------------------------------------------------------------

create table dienstanweisung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /**
   * Objekt ODER Posten ODER keines von beiden (mandantenweit gueltig).
   * Beide nullbar, und das ist §6.7 woertlich — eine Hausordnung gilt fuer
   * das Objekt, eine Postenanweisung fuer den Posten, eine Rahmenanweisung
   * fuer die ganze Gesellschaft.
   */
  objekt_id     uuid,
  posten_id     uuid,

  titel         text not null,
  status        dienstanweisung_status not null default 'entwurf',

  /**
   * Die Fassung, die GERADE gilt.
   *
   * `deferrable initially deferred` ist kein Feinschliff: Kopf und erste
   * Fassung entstehen in EINER Transaktion, und ohne Aufschub scheiterte der
   * Kopf an einer Fassung, die es im selben Moment noch nicht gibt (§6.7).
   */
  aktive_version_id uuid,

  kenntnisnahme_pflicht boolean not null default true,

  /**
   * PLATZHALTER (§1.16, §6.7). Die Vorgabe `true` ist die STRENGE Lesart:
   * eine neue Fassung verlangt eine neue Bestaetigung. Sie ist nicht geraten,
   * sondern die Richtung, in der ein Irrtum billig ist — eine Bestaetigung zu
   * viel kostet einen Tipp, eine zu wenig kostet im Haftungsfall die
   * Beweisfuehrung.
   * // TODO(client, O-153): Muss eine neue Fassung einer Dienstanweisung von
   * allen erneut bestaetigt werden, oder nur bei wesentlicher Aenderung — und
   * wer entscheidet, was wesentlich ist (SEC-06)?
   */
  neue_version_oeffnet_pflicht boolean not null default true,

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
  constraint da_mandant_uk unique (mandant_id, id),
  /**
   * Das Ziel des Enkel-Fremdschluessels aus `dienstanweisung_version` (§1.4):
   * eine Fassung darf nicht am Kopf eines anderen Objekts haengen, und die
   * denormalisierte `objekt_id` der Fassung ist damit keine freie Behauptung.
   *
   * `objekt_id` ist NULLBAR, und in PostgreSQL ist ein zusammengesetzter
   * Fremdschluessel mit einem NULL-Anteil immer erfuellt (MATCH SIMPLE) —
   * genau das wird hier gebraucht: eine mandantenweite Anweisung hat kein
   * Objekt, und ihre Fassungen sollen trotzdem einfuegbar sein.
   */
  constraint da_objekt_uk unique (mandant_id, objekt_id, id),

  constraint da_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint da_posten_fk foreign key (mandant_id, posten_id)
    references posten (mandant_id, id),

  constraint da_titel_gefuellt check (btrim(titel) <> ''),
  /**
   * Eine veroeffentlichte Anweisung OHNE geltende Fassung gibt es nicht
   * (§6.7). Die Bedingung ist SOFORT geprueft und nicht aufgeschoben —
   * PostgreSQL kennt keine aufschiebbare `CHECK` —, und sie stoert dabei
   * nicht: der Kopf entsteht als `entwurf`, und der Ausloeser der
   * Veroeffentlichung setzt `status` und `aktive_version_id` in EINER
   * Anweisung.
   */
  constraint da_veroeffentlicht_hat_version check (
    status <> 'veroeffentlicht' or aktive_version_id is not null),
  constraint da_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);
create index da_objekt_idx on dienstanweisung (mandant_id, objekt_id)
  where archiviert_am is null;
create index da_posten_idx on dienstanweisung (mandant_id, posten_id)
  where posten_id is not null;

comment on table dienstanweisung is
  'Der stabile Kopf einer Dienstanweisung (§6.7, SEC-06). Der Inhalt lebt in '
  'dienstanweisung_version; aktive_version_id nennt die Fassung, die gilt.';
comment on column dienstanweisung.neue_version_oeffnet_pflicht is
  'PLATZHALTER (O-153). true = jede neue Fassung verlangt eine neue '
  'Kenntnisnahme. Die strenge Richtung, bis der Mandant antwortet.';

-- ---------------------------------------------------------------------------
-- 3. dienstanweisung_version — die Fassung (§6.8)
-- ---------------------------------------------------------------------------

create table dienstanweisung_version (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  dienstanweisung_id uuid not null,

  /**
   * Die vom KOPF uebernommene Objektkennung.
   *
   * Sie steht hier, damit `p_intern_einsatz_decke` und `t_person` ohne
   * Verbund auskommen (§6.8). Eine Decke mit einer Unterabfrage auf
   * `dienstanweisung` ist selbst der Zeilenpolitik dieser Tabelle
   * unterworfen — und laese im Mitarbeiterportal null Zeilen, ohne Fehler
   * (review B16). Gepflegt wird sie von Ausloesern, nie vom Aufrufer.
   */
  objekt_id     uuid,

  version       integer not null,

  inhalt        text,
  /**
   * de/en/ar/tr, wo uebersetzt (EMP-12). Die Kenntnisnahme haelt fest, in
   * WELCHER Sprache der Text auf dem Bildschirm stand — ohne das ist
   * „gelesen" fuer einen Menschen, der kein Deutsch spricht, eine
   * Behauptung.
   */
  inhalt_i18n   jsonb,
  dokument_id   uuid,

  /**
   * `sha256(coalesce(inhalt,'') || coalesce(dokument_id::text,''))`, hex.
   *
   * Gesetzt vom Ausloeser, nie vom Aufrufer: ein mitgeschickter Hash waere
   * eine Pruefsumme, die der Geprueftere selbst bestimmt.
   */
  inhalt_hash   text not null,

  aenderungshinweis text,
  gueltig_ab    date not null,

  -- NULL = Entwurfsfassung. Die Serverzeit stempelt der Ausloeser (§1.11).
  veroeffentlicht_am timestamptz,
  veroeffentlicht_von uuid references benutzer(id),

  -- §1.14. `loeschsperre` auf `true`: die Fassung ist der Text, gegen den im
  -- Streitfall bestaetigt wurde.
  -- // TODO(client, O-25): Wie lange wird eine Dienstanweisung aufbewahrt,
  -- und auf welcher Rechtsgrundlage?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default true,

  -- Auditblock OHNE `geaendert_*` (§6.8): nach der Veroeffentlichung
  -- anfuegend. Ein `geaendert_von` daneben behauptete, jemand duerfe eine
  -- veroeffentlichte Fassung bearbeiten.
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint da_version_mandant_uk unique (mandant_id, id),

  -- Der ENKEL-Schluessel (§1.4): die Fassung haengt am Kopf DIESES Objekts.
  constraint da_version_kopf_fk
    foreign key (mandant_id, objekt_id, dienstanweisung_id)
    references dienstanweisung (mandant_id, objekt_id, id),
  constraint da_version_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),

  constraint da_version_positiv check (version >= 1),
  -- Eine Fassung ohne Inhalt und ohne Dokument ist keine (§6.8).
  constraint da_version_hat_inhalt check (inhalt is not null or dokument_id is not null),
  constraint da_version_hash_form check (inhalt_hash ~ '^[0-9a-f]{64}$'),
  constraint da_version_i18n_schluessel
    check (inhalt_i18n is null or inhalt_i18n - array['de','en','ar','tr'] = '{}'::jsonb),
  constraint da_version_veroeffentlicher check (
    veroeffentlicht_am is not null or veroeffentlicht_von is null),
  constraint da_version_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create unique index da_version_uk on dienstanweisung_version (dienstanweisung_id, version);
create index da_version_aktuell_idx
  on dienstanweisung_version (dienstanweisung_id, version desc)
  where veroeffentlicht_am is not null;

-- Der Kopf zeigt auf die Fassung; jetzt, wo es sie gibt, traegt der Verweis
-- einen Schluessel.
alter table dienstanweisung add constraint da_aktive_version_fk
  foreign key (mandant_id, aktive_version_id)
  references dienstanweisung_version (mandant_id, id)
  deferrable initially deferred;

comment on table dienstanweisung_version is
  'Eine Fassung der Dienstanweisung (§6.8). Ab der Veroeffentlichung sind '
  'Inhalt, Sprachfassungen, Dokument, Hash und Nummer unveraenderlich — eine '
  'Kenntnisnahme verweist damit auf einen beweisbaren Text.';

-- ---------------------------------------------------------------------------
-- 4. da_pflicht — wer bestaetigen muss (§6.9)
-- ---------------------------------------------------------------------------

create table da_pflicht (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  dienstanweisung_id uuid not null,

  /**
   * Die Pflicht entsteht aus der BESCHAEFTIGUNG bei dieser Gesellschaft
   * (§10.5, D-09) — der Mensch steht daneben, und der zusammengesetzte
   * Schluessel darunter macht es strukturell unmoeglich, dass eine Zeile
   * einen Menschen nennt, der zu dieser Beschaeftigung nicht gehoert.
   */
  anstellung_id uuid not null,
  person_id     uuid not null,

  quelle        da_pflicht_quelle not null,

  /**
   * K-14-Muster. `true` heisst: diese Zeile gehoert dem Ausloeser. Er legt
   * nur an, was fehlt, und beendet nur, was ihm gehoert — eine von Hand
   * gesetzte Pflicht ueberschreibt er nie, und das Ende einer Einteilung
   * nimmt sie nicht mit.
   */
  aus_zuordnung boolean not null default false,

  zugewiesen_am timestamptz not null default now(),
  /**
   * Die Pflicht ist entfallen — die Zeile BLEIBT (LEG-04): dass jemand
   * einmal verpflichtet war, ist im Streitfall die Auskunft, nicht ihr
   * Fehlen.
   */
  entfallen_am  timestamptz,

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
  constraint da_pflicht_mandant_uk unique (mandant_id, id),

  constraint da_pflicht_kopf_fk foreign key (mandant_id, dienstanweisung_id)
    references dienstanweisung (mandant_id, id),
  constraint da_pflicht_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint da_pflicht_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),

  constraint da_pflicht_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Eine LEBENDE Pflicht je (Anweisung, Beschaeftigung). Partiell, damit eine
-- entfallene und spaeter neu entstandene Pflicht zwei Zeilen sein darf —
-- genau das ist die Spur, die LEG-04 verlangt.
create unique index da_pflicht_uk on da_pflicht (dienstanweisung_id, anstellung_id)
  where entfallen_am is null;
-- „Wer fehlt noch" — der Anti-Join gegen eine ECHTE Population.
create index da_pflicht_offen_idx on da_pflicht (mandant_id, dienstanweisung_id)
  where entfallen_am is null;
create index da_pflicht_person_idx on da_pflicht (person_id)
  where entfallen_am is null;

comment on table da_pflicht is
  'Wer welche Dienstanweisung bestaetigen muss (§6.9, SEC-06). Gepflegt nach '
  'dem K-14-Muster; eine entfallene Pflicht bleibt als Zeile stehen (LEG-04).';

-- ---------------------------------------------------------------------------
-- 5. da_kenntnisnahme — die Bestaetigung EINER Fassung (§6.10)
-- ---------------------------------------------------------------------------

create table da_kenntnisnahme (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  -- FASSUNG, nicht Kopf (§6.10). Das ist der ganze Punkt: eine Bestaetigung
  -- des Kopfes waere eine Bestaetigung von „irgendeinem Text".
  dienstanweisung_version_id uuid not null,
  da_pflicht_id uuid,

  anstellung_id uuid not null,
  person_id     uuid not null,

  /**
   * DIE SERVERZEIT (Invariante 5, TIM-08). Der Vorgabewert allein genuegt
   * nicht — er greift nur bei WEGGELASSENER Spalte. Der Ausloeser
   * ueberschreibt jeden mitgeschickten Wert.
   */
  bestaetigt_am timestamptz not null default now(),
  -- Die Behauptung des Geraets und ihre Abweichung (TIM-08, TIM-09).
  geraete_zeit  timestamptz,
  zeitabweichung_sek integer,
  nachgetragen  boolean not null default false,

  art           kenntnisnahme_art not null default 'portal_klick',
  signatur_medien_id uuid,

  /**
   * Die KOPIE des Fassungs-Hashes zum Zeitpunkt der Bestaetigung (§6.10).
   *
   * Sie steht hier, damit der Beweis ohne Verbund steht: „dieser Mensch hat
   * einen Text mit genau diesem Digest bestaetigt". Gesetzt wird sie vom
   * Ausloeser aus der Fassung — ein mitgeschickter Wert waere die Antwort des
   * Bestaetigenden auf die Frage, was er bestaetigt hat.
   */
  bestaetigter_inhalt_hash text not null,

  sprache       sprache,
  ip            inet,

  -- KEINE Geodatenspalten. Siehe Kopfkommentar Nr. 4 (§6.10, LEG-10).

  -- §1.14.
  -- // TODO(client, O-25): Wie lange wird eine Kenntnisnahme aufbewahrt, und
  -- auf welcher Rechtsgrundlage (LEG-04 nennt die Pflicht, nicht die Frist)?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default true,

  -- Auditblock OHNE `geaendert_*`: anfuegend.
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint da_kenntnis_mandant_uk unique (mandant_id, id),

  constraint da_kenntnis_version_fk foreign key (mandant_id, dienstanweisung_version_id)
    references dienstanweisung_version (mandant_id, id),
  constraint da_kenntnis_pflicht_fk foreign key (mandant_id, da_pflicht_id)
    references da_pflicht (mandant_id, id),
  constraint da_kenntnis_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint da_kenntnis_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  constraint da_kenntnis_medien_fk foreign key (mandant_id, signatur_medien_id)
    references einsatz_medien (mandant_id, id),

  constraint da_kenntnis_signatur_vorhanden check (
    art <> 'canvas_signatur' or signatur_medien_id is not null),
  constraint da_kenntnis_hash_form check (bestaetigter_inhalt_hash ~ '^[0-9a-f]{64}$'),
  constraint da_kenntnis_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * EINE Bestaetigung je (Fassung, Beschaeftigung) — und ausdruecklich NICHT
 * partiell: eine zweite Bestaetigung derselben Fassung waere keine zweite
 * Tatsache, sondern ein zweiter Eintrag ueber dieselbe.
 *
 * Sie ist zugleich der Grund, aus dem der Dienst einen Doppeltipp auf dem
 * Telefon nicht abfangen MUSS — er faengt ihn trotzdem ab, aber die Zusage
 * haengt an dieser Zeile.
 */
create unique index da_kenntnis_uk
  on da_kenntnisnahme (dienstanweisung_version_id, anstellung_id);
-- Das Mitarbeiterportal ueber alle Beschaeftigungen hinweg (EMP-14).
create index da_kenntnis_person_idx on da_kenntnisnahme (person_id, bestaetigt_am desc);

comment on table da_kenntnisnahme is
  'Die Bestaetigung EINER Fassung (§6.10, SEC-06, EMP-09) — mit Serverzeit '
  'und einer Kopie des Fassungs-Hashes. Anfuegend; es gibt keinen Weg, sie '
  'zu aendern oder zu loeschen.';
comment on column da_kenntnisnahme.bestaetigter_inhalt_hash is
  'Kopie von dienstanweisung_version.inhalt_hash zum Bestaetigungszeitpunkt. '
  'Der Beweis steht damit ohne Verbund.';

-- ---------------------------------------------------------------------------
-- 6. Die nachzutragenden Fremdschluessel aus 0069 (§12)
-- ---------------------------------------------------------------------------

/**
 * Woertlich die Anweisungen, die 0069 Abschnitt 5 hinterlassen hat.
 *
 * Bis hierher war `posten.dienstanweisung_id` eine Behauptung, die niemand
 * prueft: ein Posten konnte auf eine Anweisung zeigen, die es nicht gibt —
 * oder auf die eines anderen Mandanten. Ein EINSPALTIGER Schluessel waere
 * nach K-16 der Pruefungsfehler; deshalb beide zusammengesetzt.
 */
alter table posten add constraint posten_dienstanweisung_fk
  foreign key (mandant_id, dienstanweisung_id)
  references dienstanweisung (mandant_id, id);
alter table veranstaltung add constraint veranstaltung_dienstanweisung_fk
  foreign key (mandant_id, dienstanweisung_id)
  references dienstanweisung (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 7. Die Ausloeser der Fassung (§6.8)
-- ---------------------------------------------------------------------------

/** `sha256(inhalt ‖ dokument)`, hex — EINE Fassung dieser Rechnung (§6.8). */
create function kern.da_inhalt_hash(p_inhalt text, p_dokument uuid) returns text
language sql immutable as $$
  select encode(sha256(convert_to(
           coalesce(p_inhalt, '') || coalesce(p_dokument::text, ''), 'UTF8')), 'hex');
$$;

/**
 * Fassungsnummer, Objektkopie und Hash — in EINER Funktion.
 *
 * **Die Sperre auf dem KOPF ist die tragende Haelfte.** `select … for update`
 * serialisiert das Lesen von `max(version)`; ohne sie bekaemen zwei
 * gleichzeitig angelegte Entwuerfe dieselbe Nummer, und der zweite schluege
 * an `da_version_uk` fehl — mit einer Meldung ueber eine Eindeutigkeit statt
 * ueber Gleichzeitigkeit. Dieselbe Bauart wie der Nummernkreis (§2.1).
 *
 * **`security definer`**, weil der Kopf unter der Mitarbeiterdecke steht: eine
 * Fassung darf auch dort entstehen, wo der Schreibende den Kopf selbst nicht
 * liest — und ohne Definer laese `max(version)` null Zeilen und begaenne
 * wieder bei 1, lautlos.
 */
create function kern.da_version_vorbereiten() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_objekt uuid;
  v_max    integer;
begin
  select d.objekt_id into v_objekt
    from public.dienstanweisung d
   where d.id = new.dienstanweisung_id and d.mandant_id = new.mandant_id
   for update;

  if not found then
    raise exception 'Die Dienstanweisung % gibt es in dieser Gesellschaft nicht',
      new.dienstanweisung_id
      using errcode = 'foreign_key_violation',
            hint = 'Eine Fassung entsteht am Kopf, und der Kopf gehoert einem Mandanten.';
  end if;

  -- Die Objektkopie kommt vom Kopf, NIE vom Aufrufer (§6.8).
  new.objekt_id := v_objekt;

  if tg_op = 'INSERT' then
    select coalesce(max(v.version), 0) into v_max
      from public.dienstanweisung_version v
     where v.dienstanweisung_id = new.dienstanweisung_id;
    new.version := v_max + 1;
  end if;

  new.inhalt_hash := kern.da_inhalt_hash(new.inhalt, new.dokument_id);

  /**
   * Die Serveruhr stempelt die Veroeffentlichung (§1.11, Invariante 5).
   * Gestempelt wird nur der UEBERGANG nach „gesetzt": ein bereits
   * veroeffentlichter Zeitpunkt bleibt stehen, und ein mitgeschickter Wert
   * waere die Antwort des Aufrufers auf die Frage, seit wann diese Fassung
   * gilt.
   */
  if new.veroeffentlicht_am is not null
     and (tg_op = 'INSERT' or old.veroeffentlicht_am is null) then
    new.veroeffentlicht_am := now();
  end if;

  return new;
end $$;

comment on function kern.da_version_vorbereiten() is
  'Fassungsnummer unter Kopfsperre, Objektkopie und Inhalts-Hash (§6.8). '
  'Der Name beginnt mit a_, damit dieser Ausloeser vor jedem spaeteren laeuft.';

create trigger a_da_version_vorbereiten
  before insert or update on dienstanweisung_version
  for each row execute function kern.da_version_vorbereiten();

/**
 * Und die andere Haelfte: eine VEROEFFENTLICHTE Fassung ist eingefroren.
 *
 * **Als Vergleich der GANZEN Zeile, nicht als Spaltenliste** — dieselbe
 * Begruendung wie bei `kern.wachbuch_nur_storno` (0070): eine Aufzaehlung der
 * verbotenen Spalten ist beim naechsten `alter table add column`
 * unvollstaendig, und zwar lautlos.
 *
 * Beweglich bleiben genau drei Dinge: die zwei Aufbewahrungsspalten (§1.14,
 * `job:aufbewahrung` schreibt sie) und `objekt_id` — die wird nicht vom
 * Aufrufer bewegt, sondern vom Kopf nachgezogen, wenn eine Anweisung das
 * Objekt wechselt.
 */
create function kern.da_version_eingefroren() returns trigger
language plpgsql as $$
declare
  v_erlaubt dienstanweisung_version;
begin
  if old.veroeffentlicht_am is null then return new; end if;

  v_erlaubt := old;
  v_erlaubt.aufbewahrung_bis := new.aufbewahrung_bis;
  v_erlaubt.loeschsperre     := new.loeschsperre;
  v_erlaubt.objekt_id        := new.objekt_id;

  if to_jsonb(v_erlaubt) is distinct from to_jsonb(new) then
    raise exception
      'Eine veroeffentlichte Fassung wird nicht geaendert (SEC-06, LEG-04)'
      using errcode = 'P0001',
            detail  = 'Inhalt, Sprachfassungen, Dokument, Hash, Nummer, Gueltigkeit '
                      || 'und Veroeffentlichung stehen fest — eine Kenntnisnahme '
                      || 'verweist auf genau diesen Text.',
            hint    = 'Eine Aenderung ist eine NEUE Fassung. Sie bekommt die '
                      || 'naechste Nummer und verlangt eine neue Bestaetigung.';
  end if;
  return new;
end $$;

create trigger da_version_eingefroren
  before update on dienstanweisung_version
  for each row execute function kern.da_version_eingefroren();

-- ---------------------------------------------------------------------------
-- 8. Veroeffentlichen: Kopf fortschreiben und Pflicht oeffnen (§6.7, §6.9)
-- ---------------------------------------------------------------------------

/**
 * `kern.oeffne_kenntnisnahme_pflicht()` — der eine Vorgang, den Abnahme 1
 * beschreibt.
 *
 * Er tut GENAU zwei Dinge, und beide sind nachrechenbar:
 *
 *  1. Er schreibt den Kopf fort: `aktive_version_id` zeigt auf die neue
 *     Fassung, `status` wird `veroeffentlicht`. Damit — und NUR damit — sind
 *     alle frueheren Kenntnisnahmen veraltet: sie zeigen auf eine Fassung,
 *     die nicht mehr die aktive ist. Keine einzige alte Zeile wird angefasst.
 *  2. Er sorgt dafuer, dass die Population vollstaendig ist: wer auf diesem
 *     Objekt eine laufende oder kommende Einteilung hat, bekommt eine
 *     `da_pflicht`, falls er noch keine lebende hat.
 *
 * **Eine aeltere Fassung zu veroeffentlichen schreibt den Kopf NICHT zurueck.**
 * Fassung 2 nach Fassung 3 freizugeben waere sonst eine stille Ruecknahme —
 * und die Wache, die 3 bestaetigt hat, stuende wieder als offen da.
 *
 * **`neue_version_oeffnet_pflicht` steuert NICHT diesen Ausloeser**, sondern
 * die Ableitung beim Lesen (§6.7, O-153): bei `false` zaehlt die Bestaetigung
 * einer beliebigen veroeffentlichten Fassung weiter. Das hier ist die
 * Tatsache „es gibt eine neue aktive Fassung"; was daraus folgt, entscheidet
 * die Einstellung und nicht der Ausloeser.
 */
create function kern.oeffne_kenntnisnahme_pflicht() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_kopf dienstanweisung;
  v_aktiv integer;
begin
  if new.veroeffentlicht_am is null then return null; end if;
  if tg_op = 'UPDATE' and old.veroeffentlicht_am is not null then return null; end if;

  select * into v_kopf from public.dienstanweisung d
   where d.id = new.dienstanweisung_id and d.mandant_id = new.mandant_id
   for update;

  select v.version into v_aktiv
    from public.dienstanweisung_version v
   where v.id = v_kopf.aktive_version_id;

  if v_kopf.aktive_version_id is null or new.version > coalesce(v_aktiv, 0) then
    update public.dienstanweisung
       set aktive_version_id = new.id,
           status = case when status = 'archiviert' then status
                         else 'veroeffentlicht'::dienstanweisung_status end
     where id = new.dienstanweisung_id;
  end if;

  /**
   * Die Population. `objekt_einsatz` als Quelle, `aus_zuordnung = true` als
   * Besitzvermerk (K-14) — eine von Hand angelegte Pflicht bleibt unberuehrt,
   * weil `on conflict … do nothing` auf dem partiellen Eindeutigkeitsindex
   * greift.
   *
   * `app.eigene_einsatz_objekte()` ist hier NICHT benutzbar: sie beantwortet
   * „wo ist der AUFRUFER eingesetzt", und der Aufrufer ist die Leitung, die
   * veroeffentlicht. Gefragt ist die Gegenrichtung.
   */
  if v_kopf.kenntnisnahme_pflicht and v_kopf.objekt_id is not null then
    insert into public.da_pflicht
      (mandant_id, dienstanweisung_id, anstellung_id, person_id, quelle,
       aus_zuordnung, erstellt_von_art)
    /**
     * **Die Aufzaehlungswerte tragen ihren Cast, und das ist nicht Kosmetik.**
     * `INSERT … SELECT DISTINCT 'objekt_einsatz'` loest das untypisierte
     * Literal zu `text` auf, BEVOR die Zielspalte es sieht — DISTINCT braucht
     * einen Gleichheitsoperator und erzwingt die Aufloesung. Ergebnis:
     * „column \"quelle\" is of type da_pflicht_quelle but expression is of
     * type text", und zwar erst dann, wenn es wirklich eine Einteilung auf dem
     * Objekt gibt — also genau im Normalfall und nie im leeren Testlauf.
     * `kern.pflege_da_pflicht` unten hat kein DISTINCT und braucht die Casts
     * deshalb nicht; hier sind sie tragend.
     */
    select distinct v_kopf.mandant_id, v_kopf.id, z.anstellung_id, z.person_id,
           'objekt_einsatz'::da_pflicht_quelle, true, 'system'::akteur_art
      from public.einsatz_zuordnung z
      join public.einsatz e on e.id = z.einsatz_id and e.mandant_id = z.mandant_id
     where e.mandant_id = v_kopf.mandant_id
       and e.objekt_id = v_kopf.objekt_id
       and e.storniert_am is null
       and e.ende_zeitpunkt >= now()
       and z.entfernt_am is null
       and z.status <> 'abgesagt'
    on conflict do nothing;
  end if;

  return null;
end $$;

comment on function kern.oeffne_kenntnisnahme_pflicht() is
  'Veroeffentlichung: Kopf fortschreiben (damit sind alte Kenntnisnahmen '
  'veraltet, ohne dass eine angefasst wird) und die Pflichtpopulation '
  'vervollstaendigen (§6.7, §6.9, SEC-06).';

create trigger z_da_version_veroeffentlichen
  after insert or update on dienstanweisung_version
  for each row execute function kern.oeffne_kenntnisnahme_pflicht();

/**
 * Wechselt der KOPF das Objekt, ziehen die Fassungen nach.
 *
 * Ohne das zeigte `dienstanweisung_version.objekt_id` auf ein Objekt, das der
 * Kopf nicht mehr nennt — und die Decke des Mitarbeiterportals oeffnete die
 * Fassung fuer die falsche Wache. Der Enkel-Fremdschluessel verlangt die
 * Uebereinstimmung ohnehin; dieser Ausloeser ist die Stelle, an der sie
 * hergestellt wird statt an einer Meldung zu scheitern.
 */
create function kern.da_objekt_nachziehen() returns trigger
language plpgsql as $$
begin
  if new.objekt_id is distinct from old.objekt_id then
    update dienstanweisung_version
       set objekt_id = new.objekt_id
     where dienstanweisung_id = new.id;
  end if;
  return null;
end $$;

create trigger z_da_objekt_nachziehen
  after update on dienstanweisung
  for each row execute function kern.da_objekt_nachziehen();

-- ---------------------------------------------------------------------------
-- 9. da_pflicht aus der Einteilung (§6.9, K-14)
-- ---------------------------------------------------------------------------

/**
 * `kern.pflege_da_pflicht()` — die zweite Richtung.
 *
 * Abschnitt 8 fuellt die Population, wenn eine Anweisung erscheint; hier wird
 * sie gefuellt, wenn ein MENSCH erscheint: eine neue Einteilung auf einem
 * Objekt erzeugt die Pflicht fuer jede veroeffentlichte, bestaetigungs-
 * pflichtige Anweisung dieses Objekts — und fuer die des Postens, auf dem die
 * Schicht liegt.
 *
 * **Und sie endet mit der letzten Einteilung, nicht mit der ersten
 * entfernten.** `entfallen_am` wird nur gestempelt, wenn der Mensch auf
 * diesem Objekt keine lebende Einteilung mehr hat — sonst naehme das
 * Streichen EINER Schicht der Wache die Anweisung fuer ihre anderen weg.
 * Und nur auf Zeilen mit `aus_zuordnung = true`: eine von Hand gesetzte
 * Pflicht gehoert dem Ausloeser nicht (K-14).
 */
create function kern.pflege_da_pflicht() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_objekt uuid;
  v_posten uuid;
  v_lebt   boolean;
begin
  select e.objekt_id, e.posten_id into v_objekt, v_posten
    from public.einsatz e
   where e.id = new.einsatz_id and e.mandant_id = new.mandant_id;
  if v_objekt is null then return null; end if;

  v_lebt := new.entfernt_am is null and new.status <> 'abgesagt';

  if v_lebt then
    insert into public.da_pflicht
      (mandant_id, dienstanweisung_id, anstellung_id, person_id, quelle,
       aus_zuordnung, erstellt_von_art)
    select d.mandant_id, d.id, new.anstellung_id, new.person_id,
           case when d.posten_id is not null then 'posten'::da_pflicht_quelle
                else 'objekt_einsatz'::da_pflicht_quelle end,
           true, 'system'
      from public.dienstanweisung d
     where d.mandant_id = new.mandant_id
       and d.archiviert_am is null
       and d.kenntnisnahme_pflicht
       and d.status = 'veroeffentlicht'
       and (d.objekt_id = v_objekt
            or (v_posten is not null and d.posten_id = v_posten))
    on conflict do nothing;
    return null;
  end if;

  -- Die Einteilung ist weg. Hat der Mensch hier noch eine andere?
  if exists (select 1 from public.einsatz_zuordnung z
               join public.einsatz e on e.id = z.einsatz_id and e.mandant_id = z.mandant_id
              where z.mandant_id = new.mandant_id
                and z.anstellung_id = new.anstellung_id
                and z.id <> new.id
                and z.entfernt_am is null
                and z.status <> 'abgesagt'
                and e.storniert_am is null
                and e.objekt_id = v_objekt) then
    return null;
  end if;

  update public.da_pflicht p
     set entfallen_am = now()
   where p.mandant_id = new.mandant_id
     and p.anstellung_id = new.anstellung_id
     and p.entfallen_am is null
     and p.aus_zuordnung
     and exists (select 1 from public.dienstanweisung d
                  where d.id = p.dienstanweisung_id
                    and d.mandant_id = p.mandant_id
                    and (d.objekt_id = v_objekt
                         or (v_posten is not null and d.posten_id = v_posten)));
  return null;
end $$;

comment on function kern.pflege_da_pflicht() is
  'Pflicht aus der Einteilung (§6.9, K-14): legt nur an, was fehlt, und '
  'beendet nur eigene Zeilen — und erst, wenn die letzte Einteilung des '
  'Menschen auf diesem Objekt weg ist.';

create trigger z_da_pflicht_pflegen
  after insert or update on einsatz_zuordnung
  for each row execute function kern.pflege_da_pflicht();

-- ---------------------------------------------------------------------------
-- 10. Der EINE Einfuegeausloeser der Kenntnisnahme (§6.10)
-- ---------------------------------------------------------------------------

/**
 * Serverzeit, Geraeteabweichung, Hashkopie und die Pflicht, die sie erledigt.
 *
 * **Eine Bestaetigung gegen eine unveroeffentlichte Fassung wird abgewiesen**
 * (§6.10). Der Entwurfstext kann sich noch aendern; eine Bestaetigung
 * dagegen waere eine Unterschrift unter ein Blatt, das danach neu geschrieben
 * wird.
 *
 * **`security definer`**, aus demselben Grund wie beim Wachbuch: die
 * bestaetigende Wache haelt `dienstanweisung.lesen` NICHT (03-AUTH §12.3) und
 * liest die Fassung im Mandantenumfang gar nicht — der Ausloeser muss sie
 * trotzdem lesen koennen, sonst haette er keinen Hash zu kopieren und keine
 * Veroeffentlichung zu pruefen.
 */
create function kern.da_kenntnisnahme_vorbereiten() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_version dienstanweisung_version;
begin
  select * into v_version from public.dienstanweisung_version v
   where v.id = new.dienstanweisung_version_id and v.mandant_id = new.mandant_id;

  if not found then
    raise exception 'Die Fassung % gibt es in dieser Gesellschaft nicht',
      new.dienstanweisung_version_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_version.veroeffentlicht_am is null then
    raise exception 'Ein Entwurf wird nicht bestaetigt (SEC-06)'
      using errcode = 'P0001',
            detail  = 'Die Fassung ist nicht veroeffentlicht; ihr Text kann sich '
                      || 'noch aendern.',
            hint    = 'Erst veroeffentlichen, dann bestaetigen lassen.';
  end if;

  -- 1. DIE SERVERUHR (Invariante 5, TIM-08). Der mitgeschickte Wert faellt.
  new.bestaetigt_am := now();
  if new.geraete_zeit is not null then
    -- Geraet MINUS Server, vorzeichenbehaftet, in Sekunden — dieselbe
    -- Richtung wie `zeiteintrag.zeitabweichung_beginn_sek` (0034).
    new.zeitabweichung_sek :=
      round(extract(epoch from (new.geraete_zeit - new.bestaetigt_am)))::integer;
  else
    new.zeitabweichung_sek := null;
  end if;

  -- 2. Die Hashkopie — aus der Fassung, nie aus der Anfrage (§6.10).
  new.bestaetigter_inhalt_hash := v_version.inhalt_hash;

  /**
   * 3. Welche Pflicht wird damit erledigt? Mitgeschickt wird sie selten; wo
   *    sie fehlt, sucht der Ausloeser die lebende Pflicht dieser
   *    Beschaeftigung an diesem Kopf. Ohne diese Aufloesung stuende in der
   *    Auswertung eine Bestaetigung ohne Bezug zu der Pflicht, die sie
   *    erledigt — und „wer fehlt noch" liefe ins Leere.
   */
  if new.da_pflicht_id is null then
    select p.id into new.da_pflicht_id
      from public.da_pflicht p
     where p.mandant_id = new.mandant_id
       and p.anstellung_id = new.anstellung_id
       and p.entfallen_am is null
       and p.dienstanweisung_id = v_version.dienstanweisung_id
     order by p.zugewiesen_am
     limit 1;
  end if;

  return new;
end $$;

comment on function kern.da_kenntnisnahme_vorbereiten() is
  'Serverzeit, Geraeteabweichung, Kopie des Fassungs-Hashes und Aufloesung '
  'der erledigten Pflicht (§6.10). Ein Entwurf wird abgewiesen.';

create trigger a_da_kenntnisnahme_vorbereiten
  before insert on da_kenntnisnahme
  for each row execute function kern.da_kenntnisnahme_vorbereiten();

/**
 * Und der Rest: geaendert wird hier gar nichts.
 *
 * Anders als beim Wachbuch gibt es nicht einmal eine Stornospur — eine
 * irrtuemliche Bestaetigung wird nicht zurueckgenommen, sondern durch die
 * naechste Fassung ueberholt. Beweglich bleiben die zwei
 * Aufbewahrungsspalten, die `job:aufbewahrung` schreibt (§1.14).
 */
create function kern.da_kenntnisnahme_unveraenderlich() returns trigger
language plpgsql as $$
declare
  v_erlaubt da_kenntnisnahme;
begin
  v_erlaubt := old;
  v_erlaubt.aufbewahrung_bis := new.aufbewahrung_bis;
  v_erlaubt.loeschsperre     := new.loeschsperre;

  if to_jsonb(v_erlaubt) is distinct from to_jsonb(new) then
    raise exception 'Eine Kenntnisnahme wird nicht geaendert (SEC-06, LEG-04)'
      using errcode = 'P0001',
            detail  = 'Sie ist der Beweis, dass ein benannter Mensch einen '
                      || 'benannten Text zu einer benannten Zeit bestaetigt hat.',
            hint    = 'Eine neue Fassung veroeffentlichen — sie verlangt eine '
                      || 'neue Bestaetigung und laesst diese Zeile stehen.';
  end if;
  return new;
end $$;

create trigger da_kenntnisnahme_unveraenderlich
  before update on da_kenntnisnahme
  for each row execute function kern.da_kenntnisnahme_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 11. Was hier NICHT steht: die Unterschrift am Bildschirm
-- ---------------------------------------------------------------------------

/**
 * `da_kenntnisnahme.signatur_medien_id` und die Art `canvas_signatur` stehen
 * in §6.10 und stehen deshalb in der Tabelle — BENUTZBAR sind sie heute
 * nicht, und das ist eine Entscheidung.
 *
 * Ein Medium kann nur an einer Elterntabelle haengen, die im geschlossenen
 * Register `einsatz_medien_bezug` steht (0041 §5.8.1), und jede Bezugsart
 * braucht dort ausserdem ihre eigene Schreibpolicy auf `einsatz_medien`
 * (0072 hat das fuer `aufmass` vorgemacht). Beides hier einzutragen, ohne
 * dass ein Bildschirm eine Unterschrift aufnimmt, ergaebe eine Bezugsart, die
 * niemand benutzt — und die naechste Sitzung haelt sie fuer erledigt.
 *
 * EMP-09 verlangt EINEN Tipp, nicht eine Unterschrift: der gebaute Weg ist
 * `portal_klick`. Kommt die Unterschrift auf dem Bildschirm dazu, sind es
 * drei Zeilen (Registerzeile, `mb_bekannt` erweitern, Schreibpolicy) in der
 * Migration, die sie einfuehrt. Die Bedingung
 * `da_kenntnis_signatur_vorhanden` steht schon heute und haelt dann von
 * selbst.
 */

-- ---------------------------------------------------------------------------
-- 12. Zeilenschutz (§1.6, §1.7, §1.8)
-- ---------------------------------------------------------------------------

alter table dienstanweisung enable row level security;
alter table dienstanweisung force  row level security;

create policy t_mandant on dienstanweisung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstanweisung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstanweisung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on dienstanweisung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstanweisung.lesen')));

/**
 * Die vierte Deckenvariante in ihrer VEROEFFENTLICHTEN Form (§1.8, §6.7).
 *
 * Die Wache sieht genau die Anweisungen der Objekte, auf denen sie eingesetzt
 * ist — und nur veroeffentlichte. Ein Entwurf ist ein Text, ueber den noch
 * gestritten wird; ihn im Mitarbeiterportal zu zeigen hiesse, dass jemand
 * danach arbeitet.
 *
 * `app.ist_eingesetzt_auf_objekt` ist eine `SECURITY DEFINER`-Funktion (0069)
 * und ausdruecklich KEINE Unterabfrage auf `einsatz`: eine Unterabfrage in
 * einer Policy ist selbst der Zeilenpolitik der gelesenen Tabelle
 * unterworfen und laese im Mitarbeiterportal null Zeilen (review B16).
 */
create policy p_intern_einsatz_decke on dienstanweisung as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter'
             and status = 'veroeffentlicht'
             and app.ist_eingesetzt_auf_objekt(objekt_id)));

create policy t_person on dienstanweisung for select to cse_app
  using (app.scope() = 'person'
         and status = 'veroeffentlicht'
         and app.ist_eingesetzt_auf_objekt(objekt_id));

/**
 * Der Lesepfad des Definers (§1.10, K-01). `kern.da_kenntnisnahme_vorbereiten`
 * und `kern.pflege_da_pflicht` lesen Kopf und Fassung; unter FORCE ROW LEVEL
 * SECURITY liest eine Definer-Funktion ohne eigene Policy NICHTS — und zwar
 * ohne Fehler. Die Kenntnisnahme schluege dann mit „Fassung gibt es nicht"
 * fehl, an einer Stelle, die mit Rechten nichts zu tun zu haben scheint.
 */
create policy da_definer on dienstanweisung for select to cse_definer using (true);
create policy da_definer_kopf on dienstanweisung for update to cse_definer
  using (true) with check (true);

grant select, insert, update on dienstanweisung to cse_app;
grant select on dienstanweisung to cse_definer;
grant update (aktive_version_id, status, geaendert_am, geaendert_von, geaendert_von_art)
  on dienstanweisung to cse_definer;

alter table dienstanweisung_version enable row level security;
alter table dienstanweisung_version force  row level security;

create policy t_mandant on dienstanweisung_version for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstanweisung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstanweisung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on dienstanweisung_version for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstanweisung.lesen')));

-- Dieselbe Decke wie auf dem Kopf, auf der TRIGGERGEPFLEGTEN Objektkopie
-- (§6.8) — deshalb braucht sie keinen Verbund.
create policy p_intern_einsatz_decke on dienstanweisung_version
  as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter'
             and veroeffentlicht_am is not null
             and app.ist_eingesetzt_auf_objekt(objekt_id)));

create policy t_person on dienstanweisung_version for select to cse_app
  using (app.scope() = 'person'
         and veroeffentlicht_am is not null
         and app.ist_eingesetzt_auf_objekt(objekt_id));

create policy da_version_definer on dienstanweisung_version for select to cse_definer
  using (true);

grant select, insert, update on dienstanweisung_version to cse_app;
grant select on dienstanweisung_version to cse_definer;

alter table da_pflicht enable row level security;
alter table da_pflicht force  row level security;

create policy t_mandant on da_pflicht for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstanweisung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstanweisung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on da_pflicht for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstanweisung.lesen')));

/**
 * Die Mitarbeiterdecke auf `anstellung_id` (§6.9). Die Wache sieht ihre
 * EIGENE Pflicht — dass eine Kollegin eine Anweisung noch nicht bestaetigt
 * hat, ist eine Auskunft ueber eine benannte Person und gehoert der Leitung.
 */
create policy p_ma_decke on da_pflicht as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));

create policy t_person on da_pflicht for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));

create policy da_pflicht_definer on da_pflicht for all to cse_definer
  using (true) with check (true);

grant select, insert, update on da_pflicht to cse_app;
grant select, insert, update on da_pflicht to cse_definer;

alter table da_kenntnisnahme enable row level security;
alter table da_kenntnisnahme force  row level security;

create policy t_mandant on da_kenntnisnahme for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstanweisung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstanweisung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * **Der Weg, auf dem die Wache selbst bestaetigt** — und ohne ihn gaebe es
 * EMP-09 nicht.
 *
 * Die Rolle `mitarbeiter` haelt `dienstanweisung.schreiben` NICHT (03-AUTH
 * §12.3 bindet beide Schluessel an super_admin/admin/leitung), also traegt
 * `t_mandant` ihren Schreibweg nicht. Anders als beim Wachbuch, wo
 * `wachbuch.schreiben` wirklich gebunden ist, waere die Antwort hier ein neuer
 * Rechteschluessel — den K-19 verbietet, und der jeder Mitarbeiterrolle
 * gebunden werden muesste, also nichts pruefte.
 *
 * Dieselbe Bauart wie `t_selbst_einreichen` auf `antrag` (0074): eine
 * permissive INSERT-Policy, die AUSSCHLIESSLICH Zeilen der eigenen
 * Beschaeftigung zulaesst. Was sie oeffnet, ist damit genau ein Vorgang und
 * nicht ein Modul.
 */
create policy t_selbst_bestaetigen on da_kenntnisnahme for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and exists (select 1 from anstellung a
                           where a.mandant_id = da_kenntnisnahme.mandant_id
                             and a.id = da_kenntnisnahme.anstellung_id
                             and a.person_id = app.aktuelle_person()));

create policy t_selbst_lesen on da_kenntnisnahme for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and exists (select 1 from anstellung a
                      where a.mandant_id = da_kenntnisnahme.mandant_id
                        and a.id = da_kenntnisnahme.anstellung_id
                        and a.person_id = app.aktuelle_person()));

/**
 * KEINE `t_gruppe`-Policy. Eine Gruppenleitung liest nicht, wer in einer
 * anderen Gesellschaft welche Anweisung gelesen hat — das ist ein
 * Beschaeftigtendatum und keine Kennzahl. `gruppe.dienstanweisung.lesen`
 * oeffnet den Kopf und die Fassungen, nicht die Namensliste darunter.
 */
create policy p_ma_decke on da_kenntnisnahme as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));

create policy t_person on da_kenntnisnahme for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));

/**
 * Kein UPDATE-Grant und kein DELETE-Grant (§6.10). Der Ausloeser darueber ist
 * die zweite Linie: **„es gibt keine Policy" ist kein Schutz** (§1.2, review
 * B2) — eine fehlende Policy aendert null Zeilen und meldet Erfolg.
 */
grant select, insert on da_kenntnisnahme to cse_app;

-- ---------------------------------------------------------------------------
-- 13. Nachzutragen in `src/server/db/schema/rls.ts`
-- ---------------------------------------------------------------------------

/**
 * `dienstanweisung` (archiv), `dienstanweisung_version` (append),
 * `da_pflicht` (archiv) und `da_kenntnisnahme` (append) — alle vier mit
 * Loeschsperre. `GEAENDERT_AM` bekommen nur die zwei beweglichen: der Kopf
 * und die Pflicht. Fassung und Kenntnisnahme sind anfuegend, und ein
 * `geaendert_am` daneben behauptete, jemand duerfe sie bearbeiten.
 *
 * `AUDITIERT` bleibt unberuehrt: eine Kenntnisnahme ist bereits ihr eigener
 * Beweis (Urheber, Serverzeit, Hashkopie), und ein `audit_log`-Eintrag je
 * Zeile verdoppelte die groesste Tabelle dieser Domaene.
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0078)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- dienstanweisung (archiv): SEC-06, LEG-04. Der Kopf ist der Bezug, auf den jede Fassung und jede Kenntnisnahme zeigt. Geloescht steht die Bestaetigung einer Wache vor einem Regelwerk, das es angeblich nie gab. Eine ausser Kraft gesetzte Anweisung bekommt `archiviert_am`.
create trigger trg_dienstanweisung_kein_hard_delete
  before delete on dienstanweisung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dienstanweisung_kein_truncate
  before truncate on dienstanweisung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dienstanweisung from cse_app, cse_anon, cse_checkin, cse_job;

-- dienstanweisung_version (append): SEC-06, LEG-04, DOC-05. Die Fassung IST der Text, gegen den bestaetigt wurde — `da_kenntnisnahme.bestaetigter_inhalt_hash` ist ihr Digest. Ohne die Zeile laesst sich nicht mehr zeigen, WAS gelesen wurde, und die Kenntnisnahme wird zur Behauptung. Eine Aenderung ist eine neue Fassung.
create trigger trg_dienstanweisung_version_kein_hard_delete
  before delete on dienstanweisung_version
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dienstanweisung_version_kein_truncate
  before truncate on dienstanweisung_version
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dienstanweisung_version from cse_app, cse_anon, cse_checkin, cse_job;

-- da_pflicht (archiv): SEC-06, LEG-04. „Diese Person musste die Anweisung kennen" ist die Auskunft, nicht ihr Fehlen: eine geloeschte Pflichtzeile macht aus einer nicht bestaetigten Anweisung eine, die niemanden betraf. Eine beendete Pflicht bekommt `entfallen_am` und bleibt stehen.
create trigger trg_da_pflicht_kein_hard_delete
  before delete on da_pflicht
  for each row execute function kern.verhindere_loeschung();
create trigger trg_da_pflicht_kein_truncate
  before truncate on da_pflicht
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on da_pflicht from cse_app, cse_anon, cse_checkin, cse_job;

-- da_kenntnisnahme (append): SEC-06, EMP-09, LEG-04. Im Haftungsfall der einzige Beleg, dass die Unterweisung stattgefunden hat — mit Serverzeit, Person und dem Digest des bestaetigten Textes. Ein Irrtum wird durch eine neue Fassung ueberholt, nicht durch Loeschen.
create trigger trg_da_kenntnisnahme_kein_hard_delete
  before delete on da_kenntnisnahme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_da_kenntnisnahme_kein_truncate
  before truncate on da_kenntnisnahme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on da_kenntnisnahme from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_dienstanweisung_geaendert_am
  before update on dienstanweisung
  for each row execute function kern.setze_geaendert_am();
create trigger trg_da_pflicht_geaendert_am
  before update on da_pflicht
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
