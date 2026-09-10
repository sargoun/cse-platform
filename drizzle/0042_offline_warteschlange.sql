-- ===========================================================================
-- 0042 — die Offline-Warteschlange: offline_ereignis, der Vorbereich
--        zeit_intern.offline_eingang, ihre Aufnahme ueber die Marke und die
--        Uebernahme durch einen Menschen
--        (04-PLANUNG-ZEIT.md §5.9, §5.13, §9.4, §14.4; K-08 Registerzeile 4,
--         K-09; TIM-08, TIM-09, TIM-10, TIM-11, LEG-02, SEC-A3, SEC-A9)
--
-- Ein Telefon im Funkloch merkt sich, was jemand getippt hat, und schickt es
-- nach, sobald es wieder Netz hat. Was dabei ankommt, ist eine BEHAUPTUNG —
-- und diese Migration ist im Kern die Weigerung, sie fuer eine Messung zu
-- halten.
--
-- Fuenf Entscheidungen, an denen der naheliegende Entwurf still falsch waere:
--
--  1. **Eine Nacherfassung erzeugt KEINEN Zeiteintrag** (§9.4, B11). Der
--     naheliegende Entwurf schriebe den behaupteten Zeitpunkt in
--     `beginn_zeitpunkt` und verliesse sich auf einen vorlaeufigen Status, um
--     ihn aus der Abrechnung zu halten. Damit haengt Invariante 5 daran, wie
--     der Kunde eine noch offene Frage beantwortet — und lautet die Antwort
--     „kein Freigabeschritt", fliesst eine ungeprueft vom Telefon behauptete
--     Dauer in den § 17-Nachweis, das Stundenkonto und eine Rechnung. Ein
--     Datensatz, den eine Planung aus der schriftlichen Behauptung einer Kraft
--     angelegt hat, ist im Lohnstreit verteidigbar; einer, dessen Beginn die
--     Plattform von einem unangemeldeten Telefon uebernommen hat, nicht.
--
--  2. **Die Wiedergabe ist DIESELBE Vertrauensgrenze wie der Check-in, nur
--     spaeter** (K-08). Dieselbe Marke, dieselbe Rolle `cse_checkin`, dieselbe
--     bedingte Schreibdisziplin. Ein zweiter, laxerer Weg waere kein zweiter
--     Weg, sondern ein Umgehungsweg — und er waere der bequemere.
--
--  3. **Ein doppelt eingespieltes Ereignis ergibt EINE Zeile.** Die
--     Warteschlange eines Telefons wird nach einem Funkloch mehrfach gesendet;
--     das ist kein Randfall, sondern der Normalfall. Zwei Zeilen waeren zwei
--     Anspruchsgrundlagen fuer dieselbe Stunde.
--
--  4. **Eine Einreichung, deren Marke nicht aufloest, wird trotzdem
--     AUFGEHOBEN** (§5.13). Sie kann nicht in `offline_ereignis` stehen, denn
--     dort ist `mandant_id NOT NULL` und es gibt keinen Mandanten. Sie
--     verschwinden zu lassen hiesse, genau den strittigen Fall zu vernichten —
--     „ich habe mit dem Link gestempelt, den ihr mir geschickt habt" —, um den
--     im Lohnstreit gestritten wird. Also liegt sie in einem Schema, in dem
--     Mandantenschaft gar nicht gilt.
--
--  5. **Die Serverzeit misst die Verspaetung, die Geraetezeit steht daneben.**
--     `empfangen_am` ist der Eingang, `behauptete_zeit` die Behauptung,
--     `verzoegerung_sek` ihre Differenz — und die traegt KEINE Bedingung
--     `>= 0`: eine vorgehende Telefonuhr ergibt einen negativen Wert, und
--     genau der soll sichtbar sein statt abgewiesen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.1)
-- ---------------------------------------------------------------------------

/**
 * `pause` traegt eine MINUTENSUMME in der Nutzlast, keinen Start und kein Ende.
 *
 * Der Entwurf fuehrte `pause_start`/`pause_ende`, waehrend das Schema nur
 * `zeiteintrag.pause_minuten` kennt — es haette also Einreichungen gegeben, die
 * der Bearbeiter nur ablehnen kann. Ein Vokabular, das etwas beschreibt, wofuer
 * es keinen Platz gibt, erzeugt Muell, den niemand einordnen kann (§3.4).
 * // TODO(client, O-168): Werden Pausen gestempelt (Start/Ende) oder als
 * Minutensumme je Schicht erfasst? Gestempelte Pausen brauchen eine eigene
 * Tabelle und aendern die ArbZG-Auswertung.
 */
create type offline_ereignis_art as enum ('checkin','checkout','pause','foto','nacherfassung');

create type offline_status as enum ('empfangen','zugeordnet','uebernommen','abgelehnt',
                                    'dupliziert','manuelle_pruefung');

create type ablehnung_grund as enum ('token_ungueltig','ausserhalb_fenster','bereits_eingeloest',
                                     'einsatz_storniert','zuordnung_entfernt','unplausibel',
                                     'sonstiges');

-- ---------------------------------------------------------------------------
-- 2. zeit_intern.offline_eingang — der Vorbereich ohne Mandanten (§5.13)
-- ---------------------------------------------------------------------------

/**
 * Warum diese Zeile nicht in `offline_ereignis` mit nullbarem `mandant_id`
 * steht: K-16(d) laesst genau EINE mandantennahe Tabelle mit nullbarem
 * Mandanten zu, `audit_log`, und ein Domaenendokument kann sich keine fuenfte
 * Abweichung selbst genehmigen (§16 Nr. 16). Und ein Platzhalter-Mandant
 * „unbekannt" waere schlimmer: er schoebe unzuordenbare Einreichungen in das
 * Mandantenmodell und in jede Gruppenauswertung, die Zeilen je Gesellschaft
 * zaehlt — und erfaende eine juristische Person, die es nicht gibt (TEN-01).
 *
 * Die Zeile sagt stattdessen, was wahr ist: diese Einreichung hat NOCH keinen
 * Mandanten.
 */
create table zeit_intern.offline_eingang (
  id            uuid not null default gen_random_uuid(),

  -- Serveruhr, von `kern.offline_feldzeit()` gesetzt. Massgeblich fuer die
  -- Verspaetung (Invariante 5).
  empfangen_am  timestamptz not null default now(),

  geraet_id     text not null,
  client_ereignis_id uuid not null,

  /**
   * Der HASH, der praesentiert wurde — nie die Marke selbst (§5.5). Auch hier
   * nicht: ein Vorbereich, der Klartextmarken sammelt, waere die bequemste
   * Stelle der Plattform, um an gueltige Inhaberberechtigungen zu kommen.
   */
  praesentierter_token_hash text not null,

  art           offline_ereignis_art not null,
  behauptete_zeit timestamptz not null,
  geraete_zeit_bei_uebertragung timestamptz not null,
  zeitabweichung_sek integer not null,
  verzoegerung_sek   integer not null,

  -- Byte-treu, plus Hash. `jsonb` ordnet Schluessel um, verwirft Doppelte und
  -- normalisiert Zahlen — eine `jsonb`-Kopie ist deshalb kein Beweis (§5.9).
  nutzlast_roh    text not null,
  nutzlast_sha256 text not null,

  grund         ablehnung_grund not null,

  uebernommen_in_ereignis_id uuid,
  entschieden_am  timestamptz,
  entschieden_von uuid references benutzer(id),

  ip_adresse    inet,
  user_agent    text,

  -- §1.13 / §13: Klasse `offline_ereignis`.
  -- // TODO(client, O-25): Wie lange bleibt eine nicht aufloesbare Einreichung
  -- samt IP, User-Agent und Geraetekennung aufbewahrt? Sie ist Beweismittel im
  -- Lohnstreit und zugleich das kurzlebigste personenbezogene Datum dieser
  -- Domaene.
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  -- Anfuegend. Ausser den Entscheidungsspalten bewegt sich hier nichts.
  erstellt_am   timestamptz not null default now(),

  primary key (id),
  constraint eingang_hash_form check (praesentierter_token_hash ~ '^[0-9a-f]{64}$'),
  constraint eingang_nutzlast_sha check (nutzlast_sha256 ~ '^[0-9a-f]{64}$'),
  constraint eingang_entscheidung_paarweise check (
    (entschieden_am is null) = (entschieden_von is null))
);

/**
 * **Es gibt hier KEINE Koordinatenspalte, und das ist die Durchsetzung** (§5.13).
 *
 * Das LEG-10-Tor liest `app.einstellung(mandant, 'zeit.geolokalisierung')` —
 * eine Zeile ohne Mandanten hat keine Einstellung, die man lesen koennte. Der
 * Ausweg ist nicht, das Tor zu lockern, sondern gar keinen Ort zu speichern.
 * Ein Punkt, der zufaellig in `nutzlast_roh` steht, ist unberuehrter Beweis
 * dessen, was das Geraet geschickt hat; er wird nie indiziert, nie abgefragt,
 * nie aggregiert und bei einer Loeschung durch eine reine Hashmarke ersetzt.
 */
comment on table zeit_intern.offline_eingang is
  'Vorbereich: eine Einreichung, deren Marke nicht aufloest (§5.13). Kein '
  'Mandant, kein Ort, keine Policy fuer cse_app — zwei Tueren, beide '
  'security definer.';

/**
 * §5.9 nennt `(geraet_id, client_ereignis_id)` als Schluessel gegen die
 * Doppeleinspielung — OHNE `mandant_id`-Praefix, damit eine Wiedergabe ueber
 * alle Gesellschaften hinweg dedupliziert, in denen der Mensch beschaeftigt
 * ist (B13).
 */
create unique index eingang_idem_uk
  on zeit_intern.offline_eingang (geraet_id, client_ereignis_id);
/**
 * **Und der Schluessel, der die Zusage TATSAECHLICH traegt.**
 *
 * §1.15 sagt: solange `zeit.geraetekennung` aus ist, ist `geraet_id` ein
 * ZUFALLSWERT JE EINREICHUNG. Dann ist der zusammengesetzte Schluessel oben
 * bei jeder Wiedergabe ein anderer — dasselbe Ereignis kaeme zweimal durch,
 * und zwar genau in der Voreinstellung, mit der die Plattform ausgeliefert
 * wird. Die Doppeleinspielung ist der Normalfall nach einem Funkloch, und zwei
 * Zeilen sind zwei Anspruchsgrundlagen fuer dieselbe Stunde.
 *
 * `client_ereignis_id` ist eine vom Geraet gepraegte UUID und allein
 * ausreichend eindeutig. Beide Indizes stehen, weil §5.9 den ersten benennt
 * und erst der zweite ihn unter der ausgelieferten Einstellung wirksam macht.
 */
create unique index eingang_client_uk
  on zeit_intern.offline_eingang (client_ereignis_id);
-- Die Warteschlange des Betriebs: was liegt hier und wartet auf einen Menschen?
create index eingang_offen_idx on zeit_intern.offline_eingang (empfangen_am)
  where uebernommen_in_ereignis_id is null and entschieden_am is null;
-- „Ist dieser Link jemals praesentiert worden" — die Frage, die ein Streit
-- tatsaechlich stellt.
create index eingang_token_idx
  on zeit_intern.offline_eingang (praesentierter_token_hash);
create index eingang_aufbewahrung_idx on zeit_intern.offline_eingang (aufbewahrung_bis)
  where loeschsperre = false and aufbewahrung_bis is not null;

alter table zeit_intern.offline_eingang enable row level security;
alter table zeit_intern.offline_eingang force  row level security;

/**
 * `FORCE` auch hier, obwohl es keine Policy fuer `cse_app` gibt. Ohne `FORCE`
 * ist der EIGENTUEMER ausgenommen, und jede Verbindung, die zufaellig als
 * Eigentuemer laeuft, liest den ganzen Vorbereich. Die eine Definerpolicy ist
 * die einzige Tuer.
 */
create policy eingang_definer on zeit_intern.offline_eingang
  as permissive for all to cse_definer using (true) with check (true);

grant select, insert, update on zeit_intern.offline_eingang to cse_definer;
-- `job:offline_altbestand` meldet Tiefe und Alter der Warteschlange (§14.3).
create policy t_job on zeit_intern.offline_eingang for select to cse_job using (true);
create policy t_job_frist on zeit_intern.offline_eingang
  for update to cse_job using (true) with check (true);
grant select on zeit_intern.offline_eingang to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on zeit_intern.offline_eingang to cse_job;

/**
 * Die Loeschsperre steht hier VON HAND und nicht im erzeugten Block unten.
 *
 * `scripts/generate-triggers.ts` schreibt `before delete on <tabelle>` ohne
 * Schemaqualifizierung; fuer ein Schema ausserhalb von `public` zeigte das auf
 * die falsche Relation — oder auf gar keine. Dieselbe Entscheidung hat 0040
 * fuer `zeit_intern.arbeitszeit_fenster` getroffen, und sie bleibt, bis die
 * Registry ein Schemafeld hat.
 */
create trigger trg_offline_eingang_kein_hard_delete
  before delete on zeit_intern.offline_eingang
  for each row execute function kern.verhindere_loeschung();
create trigger trg_offline_eingang_kein_truncate
  before truncate on zeit_intern.offline_eingang
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeit_intern.offline_eingang
  from cse_app, cse_anon, cse_checkin, cse_job;

-- ---------------------------------------------------------------------------
-- 3. offline_ereignis — der Landeplatz mit Mandant (§5.9)
-- ---------------------------------------------------------------------------

create table offline_ereignis (
  id            uuid not null default gen_random_uuid(),
  -- Serverseitig AUS DER MARKE abgeleitet, nie eingereicht (K-08).
  mandant_id    uuid not null references mandant(id),

  -- Die Kennung, die das GERAET fuer dieses Ereignis gepraegt hat.
  client_ereignis_id uuid not null,
  /**
   * Pseudonyme Installationskennung, solange `zeit.geraetekennung` an ist —
   * sonst ein Zufallswert je Einreichung (§1.15). Sie dient der Doppel- und
   * Fremdgeraeteerkennung und ist ausdruecklich KEIN Bewegungsmelder (LEG-10).
   */
  geraet_id     text not null,

  -- Gesetzt, wenn diese Zeile aus dem Vorbereich HERAUFGEHOLT wurde (§5.13).
  eingang_id    uuid references zeit_intern.offline_eingang(id),

  /**
   * Alle fuenf bleiben nullbar, obwohl die Marke Mandant und Einteilung
   * aufloest: eine Einreichung kann ein Ereignis nennen, das die Einteilung
   * nicht mehr traegt — eine zurueckgenommene Zuordnung, eine abgesagte
   * Schicht. Das wird AUFGESCHRIEBEN und abgelehnt, nicht am Fremdschluessel
   * abgewiesen. Am Fremdschluessel abgewiesen hiesse: der Beweis geht verloren.
   */
  checkin_token_id     uuid,
  einsatz_id           uuid,
  einsatz_zuordnung_id uuid,
  anstellung_id        uuid,
  person_id            uuid,

  art           offline_ereignis_art not null,

  -- Die Behauptung. Nie fuer sich genommen ein massgeblicher Zeitpunkt (§1.8).
  behauptete_zeit timestamptz not null,
  geraete_zeit_bei_uebertragung timestamptz not null,
  -- Die Serveruhr. Sie misst, was „verspaetet" heisst (Invariante 5).
  empfangen_am  timestamptz not null default now(),

  zeitabweichung_sek integer not null,
  /**
   * `empfangen_am` minus `behauptete_zeit`. **Keine Bedingung `>= 0`**: eine
   * vorgehende Geraeteuhr ergibt einen negativen Wert, und diese Tatsache muss
   * sichtbar sein statt abgewiesen. Eine Bedingung machte aus einer
   * verstellten Uhr eine fehlgeschlagene Uebertragung.
   */
  verzoegerung_sek   integer not null,

  nutzlast_roh    text not null,
  nutzlast_sha256 text not null,
  -- Die geparste Bequemlichkeitskopie. Nie Eingabe fuer eine Entscheidung.
  nutzlast        jsonb not null default '{}'::jsonb,

  geo_lat            numeric(9,6),
  geo_lon            numeric(9,6),
  geo_genauigkeit_m  numeric(12,3),
  geo_status         geo_status not null default 'deaktiviert',

  status        offline_status not null default 'empfangen',
  ablehnungsgrund ablehnung_grund,

  -- Wozu ein Mensch sie befoerdert hat.
  zeiteintrag_id uuid,
  medien_id      uuid,

  entschieden_am  timestamptz,
  entschieden_von uuid references benutzer(id),

  ip_adresse    inet,
  user_agent    text,

  -- §1.13 / §13: Klasse `offline_ereignis`.
  -- // TODO(client, O-25): Aufbewahrungsfrist der Nacherfassungsansprueche —
  -- eine abgelehnte Behauptung ist Beweismittel im Lohnstreit, IP und
  -- Geraetekennung darin sind das kurzlebigste personenbezogene Datum.
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  /**
   * Anfuegend: keine `geaendert_*`-Spalten. Was sich noch bewegen darf, ist
   * der Status samt seinen Entscheidungsspalten, und `oe_unveraenderlich`
   * zaehlt das einzeln auf. Ein `geaendert_von` daneben behauptete, jemand
   * habe die BEHAUPTUNG bearbeitet — das darf niemand.
   */
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint offline_ereignis_mandant_uk unique (mandant_id, id),

  constraint oe_token_fk foreign key (mandant_id, checkin_token_id)
    references checkin_token (mandant_id, id),
  constraint oe_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),
  constraint oe_zuordnung_fk foreign key (mandant_id, einsatz_zuordnung_id)
    references einsatz_zuordnung (mandant_id, id),
  constraint oe_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint oe_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  constraint oe_zeiteintrag_fk foreign key (mandant_id, zeiteintrag_id)
    references zeiteintrag (mandant_id, id),
  constraint oe_medien_fk foreign key (mandant_id, medien_id)
    references einsatz_medien (mandant_id, id),

  constraint oe_nutzlast_sha check (nutzlast_sha256 ~ '^[0-9a-f]{64}$'),
  constraint oe_ablehnung_begruendet check (
    status <> 'abgelehnt' or ablehnungsgrund is not null),
  constraint oe_uebernahme_belegt check (
    status <> 'uebernommen' or zeiteintrag_id is not null),
  /**
   * Eine Uebernahme hat IMMER einen Entscheider; eine Ablehnung nicht
   * zwingend, denn eine unplausible Einreichung kann automatisch abgelehnt
   * werden und hat dann keinen Menschen hinter sich (§5.9).
   */
  constraint oe_entscheider check (
    status <> 'uebernommen' or entschieden_von is not null),
  constraint oe_geo_paarweise check (
    (geo_lat is null) = (geo_lon is null)
    and (geo_lat is not null) = (geo_status = 'erfasst')),
  constraint oe_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * §5.9 woertlich: OHNE `mandant_id`-Praefix. Eine Kraft mit zwei
 * Beschaeftigungen traegt ein Telefon, und eine Wiedergabe soll ueber alle
 * Gesellschaften hinweg deduplizieren (B13).
 */
create unique index oe_idem_uk on offline_ereignis (geraet_id, client_ereignis_id);
/**
 * Und derselbe zweite Schluessel wie im Vorbereich, aus demselben Grund: mit
 * ausgeschalteter `zeit.geraetekennung` — der AUSGELIEFERTEN Einstellung — ist
 * `geraet_id` je Einreichung zufaellig, und der Schluessel oben traefe nie
 * zweimal zu. Die Zusage aus Abnahmekriterium (2) haengt an diesem Index.
 */
create unique index oe_client_uk on offline_ereignis (client_ereignis_id);
create unique index oe_eingang_uk on offline_ereignis (eingang_id)
  where eingang_id is not null;
-- Die Warteschlangen des Bearbeiters und der Planung.
create index oe_queue_idx on offline_ereignis (mandant_id, status, empfangen_am)
  where status in ('empfangen','zugeordnet','manuelle_pruefung');
-- „Was hat dieser Mensch nachgereicht" — die Rekonstruktion im Streitfall.
create index oe_person_idx on offline_ereignis (person_id, behauptete_zeit)
  where person_id is not null;
create index oe_geraet_idx on offline_ereignis (geraet_id, empfangen_am);
create index oe_aufbewahrung_idx on offline_ereignis (aufbewahrung_bis)
  where loeschsperre = false and aufbewahrung_bis is not null;

comment on table offline_ereignis is
  'Die nachgereichte Behauptung eines Geraets (TIM-09): was behauptet wurde, '
  'wann es WIRKLICH ankam, und was ein Mensch darueber entschieden hat. Sie '
  'erzeugt fuer sich genommen keinen Zeiteintrag.';
comment on column offline_ereignis.behauptete_zeit is
  'Die Behauptung des Geraets. Wird NIE ohne menschliche Entscheidung zu einem '
  'massgeblichen Zeitpunkt (§1.8, Invariante 5).';
comment on column offline_ereignis.verzoegerung_sek is
  'empfangen_am minus behauptete_zeit, vorzeichenbehaftet. Ohne check(>=0): '
  'eine vorgehende Geraeteuhr ergibt negativ, und das soll man sehen.';
comment on column offline_ereignis.nutzlast_roh is
  'Der Rumpf BYTE-TREU. jsonb ordnet um, verwirft Doppelte und normalisiert '
  'Zahlen — eine jsonb-Kopie ist kein Beweis.';

-- Der Kreis aus 0034 §6 wird geschlossen: die Spalte stand schon, der
-- Elternteil fehlte.
alter table zeiteintrag add constraint z_offline_fk
  foreign key (mandant_id, offline_ereignis_id)
  references offline_ereignis (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 4. Ausloeser auf offline_ereignis und offline_eingang
-- ---------------------------------------------------------------------------

/**
 * `kern.offline_feldzeit()` — die Serveruhr stempelt, die Geraeteuhr steht
 * daneben, und beide Differenzen werden ABGELEITET (§1.8, TIM-08, TIM-09).
 *
 * Eine eigene Funktion neben `kern.stempel_feldzeit()`, weil ein Ausloeser
 * keine Spaltennamen als Argument nimmt und jene auf `zeiteintrag`s
 * `beginn_zeitpunkt`/`geraete_zeit_beginn` festgeschrieben ist — dieselbe
 * Entscheidung, die 0034 fuer `kern.zeiteintrag_zeitstempel()` und 0036 fuer
 * `kern.korrektur_serverzeit()` getroffen hat.
 *
 * `DEFAULT now()` genuegt nicht: ein Vorgabewert greift nur bei WEGGELASSENER
 * Spalte, und eine Einreichung, die `empfangen_am` mitschickt, behauptete sonst
 * ihren eigenen Eingangszeitpunkt — womit „verspaetet" der Absender bestimmte.
 *
 * Die beiden Differenzen werden IMMER abgeleitet, auch bei ausgeschalteter
 * `zeit.abweichungsauswertung`: Invariante 5 verlangt die Tatsache, und §1.15
 * gates nur ihre AUSWERTUNG je Person. Wer die Ableitung an den Schalter
 * haengte, verloere die Tatsache unwiederbringlich.
 */
create function kern.offline_feldzeit() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.empfangen_am := now();
  end if;
  new.zeitabweichung_sek :=
    round(extract(epoch from (new.geraete_zeit_bei_uebertragung - new.empfangen_am)))::integer;
  new.verzoegerung_sek :=
    round(extract(epoch from (new.empfangen_am - new.behauptete_zeit)))::integer;
  return new;
end $$;

comment on function kern.offline_feldzeit() is
  'Serverzeit auf empfangen_am, Geraetezeit daneben, beide Differenzen '
  'abgeleitet (Invariante 5, TIM-08). Geschwister von kern.stempel_feldzeit().';

create trigger trg_offline_ereignis_1_feldzeit
  before insert or update on offline_ereignis
  for each row execute function kern.offline_feldzeit();

create trigger trg_offline_eingang_1_feldzeit
  before insert or update on zeit_intern.offline_eingang
  for each row execute function kern.offline_feldzeit();

/**
 * `oe_geo_tor` — dasselbe LEG-10-Tor wie auf `zeiteintrag` (§9.5, O-06).
 *
 * Nicht „dieselbe Funktion": `kern.zeiteintrag_geo_tor()` prueft sechs
 * Spalten mit anderen Namen. Was hier zaehlt, ist die Regel, nicht die Zeile —
 * und die Regel lautet: solange `zeit.geolokalisierung` nicht ausdruecklich
 * `true` ist, WEIGERT SICH DAS SCHEMA, einen Ort anzunehmen. Es genuegt nicht,
 * ihn in der Oberflaeche nicht abzufragen: ein Telefon schickt einen Punkt
 * auch ungefragt mit.
 *
 * ZWEIARGUMENTIGE `app.einstellung`: der Aufnahmepfad hat keine Sitzung, also
 * ist `app.aktiver_mandant()` dort NULL und die einargumentige Form lieferte
 * NULL — die Einstellung waere fuer den einzigen Pfad, der Punkte erzeugen
 * kann, dauerhaft unwirksam (D-130).
 */
create function kern.offline_geo_tor() returns trigger
language plpgsql as $$
declare v_an boolean := coalesce(
  (app.einstellung(new.mandant_id, 'zeit.geolokalisierung'))::boolean, false);
begin
  if v_an then return new; end if;
  if new.geo_lat is not null or new.geo_lon is not null
     or new.geo_genauigkeit_m is not null or new.geo_status <> 'deaktiviert' then
    raise exception 'Geolokalisierung ist fuer diese Gesellschaft nicht eingeschaltet'
      using errcode = 'check_violation',
            detail  = 'LEG-10 haengt an O-06 (§ 87 Abs. 1 Nr. 6 BetrVG); der Schluessel '
                      || 'zeit.geolokalisierung in mandant_einstellung steht auf false.',
            hint    = 'Ohne Schalter wird kein Ort gespeichert — auch nicht mit Status '
                      || 'verweigert oder nicht_verfuegbar.';
  end if;
  return new;
end $$;

create trigger trg_offline_ereignis_2_geo_tor
  before insert or update on offline_ereignis
  for each row execute function kern.offline_geo_tor();

/**
 * `oe_unveraenderlich` — die BEHAUPTUNG ist unveraenderlich, die ENTSCHEIDUNG
 * darueber bewegt sich.
 *
 * Eine Positivliste dessen, was sich bewegen darf, und keine Negativliste:
 * eine Spalte, die eine spaetere Migration ergaenzt, ist damit standardmaessig
 * gesperrt. Andersherum waere jede neue Spalte standardmaessig aenderbar, und
 * niemandem fiele es auf.
 *
 * Der Kern: `behauptete_zeit`, `nutzlast_roh` und ihr Hash sind Beweis. Liesse
 * sich die behauptete Zeit nachtraeglich verschieben, waere die ganze Tabelle
 * wertlos — und zwar unauffaellig, denn der neue Wert saehe genauso plausibel
 * aus wie der alte.
 */
create function kern.offline_unveraenderlich() returns trigger
language plpgsql as $$
declare v_verboten text[] := array[]::text[];
begin
  if new.behauptete_zeit is distinct from old.behauptete_zeit then
    v_verboten := array_append(v_verboten, 'behauptete_zeit');
  end if;
  if new.nutzlast_roh is distinct from old.nutzlast_roh
     and new.nutzlast_roh <> 'geloescht:' || old.nutzlast_sha256 then
    -- Die eine erlaubte Aenderung: die DSGVO-Loeschung ersetzt den Rumpf durch
    -- eine reine Hashmarke (§13, LEG-09). Der Hash bleibt und belegt weiterhin,
    -- WAS dagestanden hat, ohne es noch zu enthalten.
    v_verboten := array_append(v_verboten, 'nutzlast_roh');
  end if;
  if new.nutzlast_sha256 is distinct from old.nutzlast_sha256 then
    v_verboten := array_append(v_verboten, 'nutzlast_sha256');
  end if;
  if new.client_ereignis_id is distinct from old.client_ereignis_id then
    v_verboten := array_append(v_verboten, 'client_ereignis_id');
  end if;
  if new.mandant_id is distinct from old.mandant_id then
    v_verboten := array_append(v_verboten, 'mandant_id');
  end if;
  if new.empfangen_am is distinct from old.empfangen_am then
    v_verboten := array_append(v_verboten, 'empfangen_am');
  end if;
  if new.art is distinct from old.art then
    v_verboten := array_append(v_verboten, 'art');
  end if;

  if array_length(v_verboten, 1) is not null then
    raise exception 'Die nachgereichte Behauptung ist unveraenderlich'
      using errcode = 'check_violation',
            detail  = format('Gesperrt: %s.', array_to_string(v_verboten, ', ')),
            hint    = 'Entschieden wird ueber die Behauptung, nicht an ihr (§5.9).';
  end if;

  -- Eine Entscheidung wird nicht zurueckgenommen. Sonst waere eine Uebernahme
  -- reversibel, waehrend der Zeiteintrag dahinter bestehen bliebe.
  if old.status in ('uebernommen','abgelehnt') and new.status <> old.status then
    raise exception 'Ueber diese Einreichung ist bereits entschieden'
      using errcode = 'check_violation',
            detail  = format('Status %s bleibt.', old.status);
  end if;

  if new.entschieden_am is not null and old.entschieden_am is null then
    -- Der Zeitpunkt der Entscheidung gehoert dem Server (Invariante 5).
    new.entschieden_am := now();
  end if;
  return new;
end $$;

create trigger trg_offline_ereignis_3_unveraenderlich
  before update on offline_ereignis
  for each row execute function kern.offline_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz — offline_ereignis (§5.9, K-03, K-04)
-- ---------------------------------------------------------------------------

alter table offline_ereignis enable row level security;
alter table offline_ereignis force  row level security;

/**
 * Lesen ja, SCHREIBEN nein — und das ist der ganze Entwurf.
 *
 * Es gibt keine `INSERT`- und keine `UPDATE`-Policy fuer `cse_app`: geschrieben
 * wird ausschliesslich ueber `app.offline_ereignis_annehmen` (Aufnahme) und
 * `app.offline_uebernehmen` / `app.offline_ablehnen` (Entscheidung), und jede
 * dieser Funktionen bringt ihre eigene Rechtepruefung mit. Ein Bearbeiter, der
 * eine Behauptung von Hand anlegen koennte, waere ein Bearbeiter, der eine
 * Anwesenheit erfinden kann.
 *
 * `zeit.nacherfassung_pruefen` und nicht `zeit.lesen`: die Warteschlange der
 * strittigen Ansprueche ist etwas anderes als der Blick auf erfasste Zeiten,
 * und wer das eine darf, darf darum nicht automatisch das andere.
 */
create policy t_mandant on offline_ereignis for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.nacherfassung_pruefen', app.aktiver_mandant())));

create policy t_gruppe on offline_ereignis for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/**
 * WEDER `t_person` NOCH `t_kunde`: ein Anspruch unter Pruefung ist keine
 * Portalzeile (EMP-13). Der Mensch sieht seinen ZEITEINTRAG, wenn einer
 * entsteht — nicht die Verwaltungszeile darueber, in der eine Ablehnung samt
 * Grund steht.
 */
create policy p_ma_decke on offline_ereignis as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on offline_ereignis as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Die Definerpolicy (§1.1, woertlich). Sie ist breit und trotzdem eng: nur die
 * vier Funktionen dieser Migration halten `EXECUTE`, und `cse_checkin` hat auf
 * dieser Tabelle kein einziges Tabellenrecht.
 */
create policy oe_definer on offline_ereignis as permissive for all to cse_definer
  using (true) with check (true);

grant select on offline_ereignis to cse_app;
grant select, insert, update on offline_ereignis to cse_definer;

/**
 * `job:offline_altbestand` schiebt ueberfaellige Ansprueche auf
 * `manuelle_pruefung` — nie in den Papierkorb (§14.3).
 */
create policy t_job on offline_ereignis for select to cse_job using (true);
create policy t_job_altbestand on offline_ereignis
  for update to cse_job using (true) with check (true);
grant select on offline_ereignis to cse_job;
grant update (status, aufbewahrung_bis, loeschsperre) on offline_ereignis to cse_job;

-- ---------------------------------------------------------------------------
-- 6. z_definer_nacherfassung — die zweite schmale Definerpolicy (§1.1, §9.4)
-- ---------------------------------------------------------------------------

/**
 * **Ohne diese Zeile gibt es TIM-09s einzigen rechtmaessigen Weg von einer
 * Behauptung zu einem Datensatz nicht** (§9.4).
 *
 * `app.offline_uebernehmen` MUSS als `cse_definer` laufen: `offline_ereignis`
 * traegt keine `UPDATE`-Policy fuer `cse_app`, der Statuswechsel ist dem
 * Aufrufer also nicht moeglich. Als `cse_definer` trifft ihr
 * `zeiteintrag`-INSERT aber nicht `z_definer_insert` aus 0034 — dessen
 * `WITH CHECK` verlangt `erfassungsart_beginn = 'checkin_token'` und
 * `quelle_beginn = 'server_uhr'`, also genau das Gegenteil dessen, was eine
 * Uebernahme schreibt. Der ganze Pfad waere von der Datenbank abgewiesen, und
 * zwar mit „new row violates row-level security policy" — einer Meldung, die
 * niemanden zur Ursache fuehrt.
 *
 * Genauso eng wie ihre Schwester: eine Marke kann auf diesem Weg keinen
 * nacherfassten Datensatz erzeugen, und eine Nacherfassung keinen Markenstempel
 * vortaeuschen.
 */
create policy z_definer_nacherfassung on zeiteintrag as permissive for insert to cse_definer
  with check (nacherfasst
              and erfassungsart_beginn = 'nacherfassung'
              and quelle_beginn        = 'planer_entscheidung'
              and (quelle_ende is null or quelle_ende = 'planer_entscheidung'));

-- ---------------------------------------------------------------------------
-- 7. z_fenster_projizieren — die `ist`-Haelfte der K-06-Supersede-Regel
-- ---------------------------------------------------------------------------

/**
 * 0040 hat diesen Ausloeser als auskommentierten Block hinterlassen, weil
 * `zeiteintrag` damals nicht existierte, und die Migration benannt, die ihn
 * nachtraegt: „die, die `zeiteintrag` anlegt; ist die bereits angewendet, in
 * die naechste danach." PR 34 hat ihn nicht nachgezogen, also gehoert er
 * hierher — und hierher ohnehin, denn erst mit der Offline-Uebernahme entstehen
 * `ist`-Fenster in Menge.
 *
 * **Was ohne ihn still falsch ist:** die Fenstertabelle traegt nur `plan`-Zeilen.
 * Der ArbZG-Detektor prueft dann die GEPLANTE Belastung und nie die
 * tatsaechliche — eine Kraft, die sechs Stunden laenger geblieben ist, bleibt
 * unauffaellig, und eine gesetzlich vorgeschriebene Pruefung, die immer still
 * besteht, ist schlimmer als keine, weil sie als vorhanden dokumentiert ist
 * (§15.1).
 *
 * Der Koerper ist woertlich der aus 0040 Abschnitt 6.
 */
create function zeit_intern.z_fenster_projizieren() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $fn$
begin
  perform zeit_intern.fenster_setzen(
    'ist'::fenster_quelle,
    new.id,
    /**
     * Ungeplante Arbeit hat keine Zuordnung; dann traegt das Fenster die
     * EIGENE Identitaet, damit der Deduplizierungsschluessel total bleibt
     * (§6.2). Genau deshalb hat die Spalte keinen Fremdschluessel: ein
     * bedingter Fremdschluessel existiert in Postgres nicht, und ein
     * unbedingter waere beim ersten Rufeinsatz nicht anlegbar.
     */
    coalesce(new.einsatz_zuordnung_id, new.id),
    new.person_id, new.mandant_id, new.anstellung_id,
    new.beginn_zeitpunkt, new.ende_zeitpunkt, coalesce(new.pause_minuten, 0),
    new.storniert_am is null and new.ersetzt_am is null);
  return null;
end $fn$;

create trigger trg_z_fenster_projizieren
  after insert or update of beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
                            einsatz_zuordnung_id, storniert_am, ersetzt_am
  on zeiteintrag
  for each row execute function zeit_intern.z_fenster_projizieren();

comment on function zeit_intern.z_fenster_projizieren() is
  'K-06 §6.2: die ist-Seite der Projektion. Sie entwertet in derselben '
  'Anweisung ihre plan-Zeile — ohne das meldet der Detektor 12 h fuer einen '
  '6-Stunden-Tag.';

-- ---------------------------------------------------------------------------
-- 8. Die Kettenpruefung kennt jetzt die Nacherfassung ohne Vorgaenger
-- ---------------------------------------------------------------------------

/**
 * **Der Widerspruch, den dieser Block aufloest.**
 *
 * §9.4 verlangt, dass eine Uebernahme in derselben Transaktion eine
 * `zeiteintrag_korrektur`-Zeile mit `art = 'nacherfassung'` schreibt — das ist
 * der Beleg, der einen `quelle_beginn = 'planer_entscheidung'` ueberhaupt
 * rechtmaessig macht (§1.8). §5.7 gibt derselben Tabelle aber
 * `ursprung_zeiteintrag_id NOT NULL` und eine Kettenpruefung, die eine
 * VORGAENGERFASSUNG voraussetzt und den Ursprung als abgeloest markiert.
 *
 * Eine Nacherfassung hat keinen Vorgaenger: sie legt den Datensatz erst an.
 * Beide Regeln zusammen machen den einzigen rechtmaessigen Weg unbaubar — und
 * zwar nicht sichtbar, sondern als `check_violation` tief in einem Ausloeser.
 *
 * Aufgeloest wird es mit dem MINIMALEN Schnitt: die Korrekturzeile nennt den
 * neu entstandenen Eintrag als Ursprung UND als Ersatz. Damit ist
 * `zk_ersatz_ausser_storno` erfuellt, `vorher` traegt die Behauptung des
 * Geraets und `nachher` den angelegten Datensatz — was genau die Frage
 * beantwortet, um die es in §1.8 geht: worin unterscheidet sich, was das
 * Telefon behauptet hat, von dem, was ein Mensch aufgeschrieben hat.
 *
 * Der Zweig ist eng: `art = 'nacherfassung'`, Ursprung gleich Ersatz, Fassung 1
 * und `nacherfasst` gesetzt. Und er ueberspringt das Ablosen — den neuen
 * Eintrag als „von sich selbst abgeloest" zu markieren waere eine Zeile, die
 * jede Auswertung sofort wieder ausschliesst.
 *
 * Alle bestehenden Pfade laufen unveraendert weiter: der Rest des Koerpers ist
 * Zeichen fuer Zeichen der aus 0036.
 */
create or replace function kern.korrektur_kette_pruefen() returns trigger
language plpgsql as $$
declare u record; e record;
begin
  select z.kette_id, z.version, z.ersetzt_am, z.mandant_id, z.status, z.gesperrt_am,
         z.nacherfasst
    into u
    from zeiteintrag z
   where z.id = new.ursprung_zeiteintrag_id and z.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Der korrigierte Zeiteintrag gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;

  if u.ersetzt_am is not null then
    raise exception 'Dieser Zeiteintrag wurde bereits abgeloest'
      using errcode = 'check_violation',
            detail  = 'Korrigiert wird immer die AKTUELLE Fassung der Kette.',
            hint    = 'Die Fassung mit ersetzt_am is null waehlen.';
  end if;

  if new.kette_id is distinct from u.kette_id then
    raise exception 'Die Korrektur nennt eine andere Kette als ihr Ursprung'
      using errcode = 'check_violation';
  end if;

  /**
   * Die Nacherfassung ohne Vorgaenger (§9.4). Vier Bedingungen, und alle vier
   * sind noetig — ohne sie waere dieser Zweig ein Weg, eine beliebige
   * Korrektur als „Nacherfassung" am Ablosen vorbeizuschieben.
   */
  if new.art = 'nacherfassung'
     and new.ersatz_zeiteintrag_id = new.ursprung_zeiteintrag_id then
    if u.version <> 1 or not u.nacherfasst then
      raise exception 'Eine Nacherfassung ohne Vorgaenger ist Fassung 1 und traegt nacherfasst'
        using errcode = 'check_violation',
              detail  = format('Fassung %s, nacherfasst %s.', u.version, u.nacherfasst);
    end if;
    -- KEIN Ablosen: der Eintrag ist gerade erst entstanden.
    return new;
  end if;

  if new.ersatz_zeiteintrag_id is not null then
    select z.kette_id, z.version, z.mandant_id into e
      from zeiteintrag z
     where z.id = new.ersatz_zeiteintrag_id and z.mandant_id = new.mandant_id;
    if not found then
      raise exception 'Die Ersatzfassung gehoert nicht zu dieser Gesellschaft'
        using errcode = 'foreign_key_violation';
    end if;
    if e.kette_id is distinct from u.kette_id then
      raise exception 'Die Ersatzfassung haengt an einer anderen Kette'
        using errcode = 'check_violation';
    end if;
    if e.version is distinct from u.version + 1 then
      raise exception 'Die Ersatzfassung ist nicht die naechste Fassung'
        using errcode = 'check_violation',
              detail  = format('Ursprung Fassung %s, Ersatz Fassung %s.', u.version, e.version);
    end if;
  end if;

  update zeiteintrag
     set ersetzt_am = now(),
         ersetzt_durch_zeiteintrag_id = new.ersatz_zeiteintrag_id,
         status        = case when new.art = 'storno' then 'storniert' else status end,
         storniert_am  = case when new.art = 'storno' then now() else storniert_am end,
         storniert_von = case when new.art = 'storno' then new.durchgefuehrt_von
                              else storniert_von end,
         storno_grund  = case when new.art = 'storno' then new.begruendung
                              else storno_grund end
   where id = new.ursprung_zeiteintrag_id;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 9. app.offline_ereignis_annehmen — K-08 Registerzeile 4 (§9.4)
-- ---------------------------------------------------------------------------

/**
 * **Drei Argumente, und die Stelligkeit ist Teil des K-08-Registereintrags.**
 *
 * Postgres loest Rechte je exakter Signatur auf; ein `GRANT EXECUTE` gegen eine
 * andere Fassung gelaenge gegen NICHTS, und der Endpunkt fiele zur Laufzeit mit
 * „function does not exist" geschlossen — ein Fehler, den kein Schematest
 * findet.
 *
 * `p_ereignisse` ist eine ARRAY von Ereignisobjekten: die Warteschlange eines
 * Telefons wird am Stueck geleert, und eine Anweisung je Ereignis waere eine
 * Anweisung je Ereignis, die auf halbem Weg abbrechen kann.
 *
 * **Der User-Agent reist IM Ereignis, nicht als viertes Argument** — die Route
 * setzt ihn dort aus dem Kopf der Anfrage ein, nicht der Rumpf. Ein viertes
 * Argument waere eine andere Signatur als die, die K-08 nennt, und die Arity
 * ist dort Teil der Zusage. Der Weg ueber die Nutzlast ist derselbe Grad von
 * Vertrauenswuerdigkeit wie die IP: beides kommt von der Route, nicht vom
 * Geraet.
 *
 * **Es gibt EINE Antwort fuer jede angenommene Einreichung.** Ob eine Marke
 * aufgeloest hat oder nicht, steht NICHT darin: eine Antwort, die das
 * unterscheidet, beantwortet jedem Durchprobierenden genau die Frage, die er
 * stellt (AUT-06, §9.2). Die Einreichung wurde entgegengenommen und liegt in
 * einem der beiden Buecher — welches, geht den Absender nichts an.
 */
create function app.offline_ereignis_annehmen(p_token_hash text,
                                              p_ereignisse jsonb,
                                              p_ip inet)
/**
 * **Die Rueckgabespalten heissen `ereignis_kennung` und `ergebnis`, nicht
 * `client_ereignis_id` und `status`** — und das ist kein Geschmack.
 *
 * In plpgsql sind OUT-Parameter Variablen, und Postgres setzt sie ueberall
 * dort ein, wo ein Bezeichner sonst eine Spalte waere. Hiessen sie wie die
 * Spalten, schluege `on conflict (client_ereignis_id)` mit „column reference
 * is ambiguous" fehl — und zwar erst zur Laufzeit, beim ersten
 * Wiedereinspielen, also genau an der Stelle, die diese Funktion absichert.
 */
returns table (ereignis_kennung uuid, vorgang_id uuid, ergebnis text)
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  t            record;
  ev           jsonb;
  v_client     uuid;
  v_geraet     text;
  v_ua         text;
  v_art        offline_ereignis_art;
  v_behauptet  timestamptz;
  v_geraetezeit timestamptz;
  v_roh        text;
  v_sha        text;
  v_geo_an     boolean := false;
  v_geo        jsonb;
  v_grund      ablehnung_grund;
  v_benutzer   uuid;
  v_id         uuid;
  v_status     offline_status;
  v_fenster    integer;
  v_medien     uuid;
  v_bezug_tab  text;
  v_bezug_id   uuid;
begin
  if jsonb_typeof(p_ereignisse) <> 'array' then
    raise exception 'p_ereignisse ist eine Liste von Ereignissen'
      using errcode = 'invalid_parameter_value';
  end if;

  /**
   * Die Marke wird GELESEN, nicht eingeloest — und das ist der Unterschied zu
   * K-09.
   *
   * Eine Nacherfassung darf ausserhalb des Gueltigkeitsfensters ankommen; sie
   * ist ja gerade deshalb spaet, weil kein Netz da war. Sie am Fenster
   * abzuweisen hiesse, die Stunden zu verlieren, um die es geht — der Fehler,
   * den B11 im ersten Entwurf gefunden hat. Was zaehlt, ist, dass die Marke
   * EXISTIERT und nicht WIDERRUFEN ist; alles andere entscheidet ein Mensch.
   */
  select ct.id, ct.mandant_id, ct.einsatz_id, ct.einsatz_zuordnung_id,
         ct.anstellung_id, ct.person_id, ct.zweck, ct.eingeloest_am, ct.widerrufen_am,
         ez.entfernt_am
    into t
    from public.checkin_token ct
    left join public.einsatz_zuordnung ez on ez.id = ct.einsatz_zuordnung_id
   where ct.token_hash = p_token_hash;

  if found and t.widerrufen_am is null and t.entfernt_am is null then
    v_grund := null;
    v_geo_an := coalesce(
      (app.einstellung(t.mandant_id, 'zeit.geolokalisierung'))::boolean, false);
    v_fenster := coalesce(
      (app.einstellung(t.mandant_id, 'zeit.nacherfassung_fenster_tage'))::integer, 7);
    select b.id into v_benutzer
      from public.benutzer b
     where b.person_id = t.person_id and b.deaktiviert_am is null;
  elsif found and t.widerrufen_am is not null then
    v_grund := 'token_ungueltig';
  elsif found then
    v_grund := 'zuordnung_entfernt';
  else
    v_grund := 'token_ungueltig';
  end if;

  for ev in select * from jsonb_array_elements(p_ereignisse)
  loop
    v_client      := (ev ->> 'client_ereignis_id')::uuid;
    v_art         := (ev ->> 'art')::offline_ereignis_art;
    v_behauptet   := (ev ->> 'behauptete_zeit')::timestamptz;
    v_geraetezeit := coalesce((ev ->> 'geraete_zeit')::timestamptz, now());
    v_ua          := ev ->> 'user_agent';
    v_roh         := ev ->> 'roh';
    v_sha         := encode(digest(coalesce(v_roh, ''), 'sha256'), 'hex');
    v_geo         := ev -> 'geo';

    /**
     * `geraet_id` ist nur dann die Kennung des Geraets, wenn die Gesellschaft
     * das eingeschaltet hat (§1.15). Sonst ein Zufallswert je Einreichung —
     * das Feld bleibt gefuellt (die Spalte ist `not null`), taugt aber nicht
     * mehr, ein Telefon ueber Wochen wiederzuerkennen. Genau deshalb traegt
     * die Deduplizierung `client_ereignis_id` als eigenen Schluessel.
     */
    if v_grund is null and coalesce(
         (app.einstellung(t.mandant_id, 'zeit.geraetekennung'))::boolean, false) then
      v_geraet := coalesce(ev ->> 'geraet_id', gen_random_uuid()::text);
    else
      v_geraet := gen_random_uuid()::text;
    end if;

    if v_client is null or v_art is null or v_behauptet is null or v_roh is null then
      raise exception 'Ein Ereignis braucht client_ereignis_id, art, behauptete_zeit und roh'
        using errcode = 'invalid_parameter_value';
    end if;

    if v_grund is not null then
      -- Der Vorbereich (§5.13). Kein Mandant, kein Ort, aber der Beweis bleibt.
      insert into zeit_intern.offline_eingang
            (geraet_id, client_ereignis_id, praesentierter_token_hash, art,
             behauptete_zeit, geraete_zeit_bei_uebertragung,
             zeitabweichung_sek, verzoegerung_sek, nutzlast_roh, nutzlast_sha256,
             grund, ip_adresse, user_agent)
      values (v_geraet, v_client, p_token_hash, v_art,
              v_behauptet, v_geraetezeit, 0, 0, v_roh, v_sha,
              v_grund, p_ip, v_ua)
      on conflict (client_ereignis_id) do nothing
      returning id into v_id;

      if v_id is null then
        select e.id into v_id from zeit_intern.offline_eingang e
         where e.client_ereignis_id = v_client;
      end if;

      ereignis_kennung := v_client;
      vorgang_id := v_id;
      ergebnis := 'empfangen';
      return next;
      continue;
    end if;

    /**
     * Eine Einreichung, die aelter ist als das Nacherfassungsfenster, wird
     * NICHT verworfen — sie geht auf `manuelle_pruefung`. § 17 Abs. 1 MiLoG
     * setzt sieben Kalendertage als gesetzliche Hoechstfrist; das ist die
     * Vorgabe, nicht eine gewaehlte Betriebsregel.
     * // TODO(client, O-165): Welche interne Frist gilt fuer die
     * Nacherfassung, unterhalb der gesetzlichen Hoechstfrist von sieben
     * Kalendertagen, und wer wird beim Ueberschreiten informiert?
     *
     * Ebenso `manuelle_pruefung`, wenn die Marke BEREITS EINGELOEST ist: dann
     * gibt es zu diesem Bein schon einen serverseitig erfassten Datensatz, und
     * die nachgereichte Behauptung darf ihn unter keinen Umstaenden
     * ueberschreiben (Abnahmekriterium 3). Sie kann es auch nicht — von hier
     * fuehrt kein Pfad zu einem bestehenden `zeiteintrag` —, aber sie soll
     * einem Menschen auffallen statt still in der Warteschlange zu liegen.
     */
    v_status := case
      when t.eingeloest_am is not null then 'manuelle_pruefung'
      when now() - v_behauptet > make_interval(days => v_fenster) then 'manuelle_pruefung'
      else 'empfangen' end::offline_status;

    insert into public.offline_ereignis
          (mandant_id, client_ereignis_id, geraet_id,
           checkin_token_id, einsatz_id, einsatz_zuordnung_id, anstellung_id, person_id,
           art, behauptete_zeit, geraete_zeit_bei_uebertragung,
           zeitabweichung_sek, verzoegerung_sek,
           nutzlast_roh, nutzlast_sha256, nutzlast,
           geo_lat, geo_lon, geo_genauigkeit_m, geo_status,
           status, ip_adresse, user_agent,
           erstellt_von_art, erstellt_von, erstellt_von_person_id)
    values (t.mandant_id, v_client, v_geraet,
            t.id, t.einsatz_id, t.einsatz_zuordnung_id, t.anstellung_id, t.person_id,
            v_art, v_behauptet, v_geraetezeit,
            0, 0,
            v_roh, v_sha, coalesce(ev, '{}'::jsonb),
            case when v_geo_an then (v_geo ->> 'lat')::numeric end,
            case when v_geo_an then (v_geo ->> 'lon')::numeric end,
            case when v_geo_an then (v_geo ->> 'genauigkeit_m')::numeric end,
            case when v_geo_an and (v_geo ->> 'lat') is not null then 'erfasst'
                 when v_geo_an then coalesce(v_geo ->> 'status', 'nicht_verfuegbar')
                 else 'deaktiviert' end::geo_status,
            v_status, p_ip, v_ua,
            /**
             * Anders als beim Check-in ist ein fehlendes Benutzerkonto hier
             * KEIN Abbruch. Der Check-in muss abbrechen, weil er sonst eine
             * einmal verwendbare Marke verbrennt; hier gibt es nichts zu
             * verbrennen, und die Behauptung einer Kraft, die vor ihrer
             * Freischaltung eine erste Schicht gearbeitet hat, ist genau der
             * strittige Fall, den diese Tabelle aufheben soll.
             */
            case when v_benutzer is null then 'system' else 'mensch' end::akteur_art,
            v_benutzer, t.person_id)
    on conflict (client_ereignis_id) do nothing
    returning id into v_id;

    if v_id is null then
      -- Schon da: dieselbe Zeile, derselbe Ausgang. Die Warteschlange eines
      -- Telefons wird nach einem Funkloch mehrfach gesendet (K-09).
      select o.id into v_id from public.offline_ereignis o
       where o.client_ereignis_id = v_client;
      ereignis_kennung := v_client;
      vorgang_id := v_id;
      ergebnis := 'empfangen';
      return next;
      continue;
    end if;

    /**
     * Das Medium haengt an dem, was es belegt: am laufenden Zeiteintrag der
     * Einteilung, wenn es einen gibt, sonst an der Schicht selbst. Beides sind
     * registrierte Elternteile (§5.8.1).
     *
     * An die Schicht zu haengen, wenn ein Eintrag existiert, waere die
     * bequemere Wahl und die schlechtere: die Mitarbeiterdecke und die
     * `t_person`-Policy setzen auf `zeiteintrag_id` auf, und ein Foto, das
     * daran vorbei an der Schicht haengt, ist fuer den Menschen, der es
     * gemacht hat, unsichtbar.
     */
    if v_art = 'foto' and ev ? 'medium' then
      if v_benutzer is null then
        raise exception 'kein Benutzerkonto fuer diese Person'
          using errcode = 'P0003',
                hint = 'Ein Medium traegt immer einen Menschen (me_definer_insert).';
      end if;

      select z.id into v_bezug_id
        from public.zeiteintrag z
       where z.einsatz_zuordnung_id = t.einsatz_zuordnung_id
         and z.storniert_am is null and z.ersetzt_am is null
       order by z.beginn_zeitpunkt desc
       limit 1;
      v_bezug_tab := case when v_bezug_id is null then 'einsatz' else 'zeiteintrag' end;
      v_bezug_id  := coalesce(v_bezug_id, t.einsatz_id);

      insert into public.einsatz_medien
            (mandant_id, bezug_tabelle, bezug_id, art, bucket, pfad,
             mime_typ, groesse_bytes, sha256, breite, hoehe, dauer_sek,
             exif_entfernt, aufgenommen_am_geraet, beschreibung,
             erstellt_von_art, erstellt_von, erstellt_von_person_id)
      values (t.mandant_id, v_bezug_tab, v_bezug_id,
              ((ev -> 'medium') ->> 'art')::medien_art,
              coalesce((ev -> 'medium') ->> 'bucket', 'einsatz-medien'),
              (ev -> 'medium') ->> 'pfad',
              (ev -> 'medium') ->> 'mime_typ',
              ((ev -> 'medium') ->> 'groesse_bytes')::bigint,
              (ev -> 'medium') ->> 'sha256',
              ((ev -> 'medium') ->> 'breite')::integer,
              ((ev -> 'medium') ->> 'hoehe')::integer,
              ((ev -> 'medium') ->> 'dauer_sek')::integer,
              /**
               * Der Dienst hat bereinigt, BEVOR das Objekt im Bucket landete.
               * Was hier steht, ist die Bestaetigung — und `me_exif` laesst die
               * Zeile ohnehin nicht entstehen, wenn sie fehlt.
               */
              coalesce(((ev -> 'medium') ->> 'exif_entfernt')::boolean, false),
              ((ev -> 'medium') ->> 'aufgenommen_am_geraet')::timestamptz,
              (ev -> 'medium') ->> 'beschreibung',
              'mensch', v_benutzer, t.person_id)
      returning id into v_medien;

      update public.offline_ereignis set medien_id = v_medien where id = v_id;
    end if;

    perform app.protokolliere('zeit.offline_empfangen', 'offline_ereignis', v_id::text, null,
                              jsonb_build_object('art', v_art::text,
                                                 'status', v_status::text,
                                                 'ip', p_ip::text),
                              t.mandant_id);

    ereignis_kennung := v_client;
    vorgang_id := v_id;
    ergebnis := 'empfangen';
    return next;
  end loop;
end $$;

comment on function app.offline_ereignis_annehmen(text, jsonb, inet) is
  'K-08-Register Zeile 4, Rolle cse_checkin. Nimmt die Warteschlange eines '
  'Geraets entgegen und schreibt Behauptungen — nie einen Zeiteintrag (§9.4). '
  'Eine Antwort fuer jeden Fall, damit die Adresse kein Orakel ist.';

/**
 * `cse_checkin` bekommt `EXECUTE` und sonst nichts — kein Tabellenrecht, keine
 * Policy. Dieselbe Rolle wie beim Check-in, weil es dieselbe Vertrauensgrenze
 * ist, nur spaeter (K-08).
 */
grant execute on function app.offline_ereignis_annehmen(text, jsonb, inet) to cse_checkin;

-- ---------------------------------------------------------------------------
-- 10. app.offline_uebernehmen — aus einer Behauptung wird ein Datensatz (§9.4)
-- ---------------------------------------------------------------------------

/**
 * Das Recht wird IM MANDANTEN DER ZEILE geprueft, nicht im aktiven der
 * Sitzung. Beide sind normalerweise gleich — aber diese Funktion laeuft als
 * Definer, traegt ihre Pruefung also selbst, und ein Aufrufer mit einem
 * anderen aktiven Mandanten duerfte sonst Ansprueche einer fremden
 * Gesellschaft befoerdern.
 *
 * KEINE K-08-Funktion: sie laeuft in einer gewoehnlichen `withTenant`-
 * Transaktion mit voller Sitzung dahinter.
 */
create function app.offline_uebernehmen(p_ereignis uuid,
                                        p_beginn timestamptz,
                                        p_ende timestamptz,
                                        p_begruendung text)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  o        record;
  v_eintrag uuid;
  v_benutzer uuid := app.aktueller_benutzer();
  v_kette  uuid := gen_random_uuid();
  v_neu    jsonb;
begin
  select * into o from public.offline_ereignis where id = p_ereignis;
  if not found then
    raise exception 'Diese Einreichung gibt es nicht' using errcode = 'no_data_found';
  end if;
  if not app.hat_recht('zeit.nacherfassung_pruefen', o.mandant_id) then
    raise exception 'Kein Recht, Nacherfassungen zu pruefen'
      using errcode = 'insufficient_privilege';
  end if;
  if o.status in ('uebernommen','abgelehnt') then
    raise exception 'Ueber diese Einreichung ist bereits entschieden'
      using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_begruendung, '')) = '' then
    raise exception 'Eine Uebernahme braucht eine Begruendung'
      using errcode = 'check_violation',
            hint = 'Sie ist der Beleg, der den Datensatz rechtmaessig macht (§1.8).';
  end if;
  if o.anstellung_id is null or o.person_id is null then
    raise exception 'Diese Einreichung nennt keine Beschaeftigung'
      using errcode = 'check_violation',
            hint = 'Erst zuordnen, dann uebernehmen.';
  end if;
  if v_benutzer is null then
    raise exception 'Eine Uebernahme braucht einen benannten Benutzer'
      using errcode = 'insufficient_privilege';
  end if;

  /**
   * **Der Zeitpunkt kommt vom MENSCHEN, nicht aus `behauptete_zeit`.**
   *
   * Der naheliegende Entwurf setzte `p_beginn := o.behauptete_zeit` als
   * Vorgabewert — bequem, und genau die Waesche, die §1.8 verbietet: die
   * Behauptung des Geraets truege danach `quelle_beginn =
   * 'planer_entscheidung'` und waere von einer echten Entscheidung nicht mehr
   * zu unterscheiden. Der Aufrufer MUSS den Wert nennen; dass er dabei auf die
   * Behauptung schaut, ist in Ordnung — dass die Datenbank sie fuer ihn
   * einsetzt, nicht.
   */
  if p_beginn is null then
    raise exception 'Der Beginn ist die Entscheidung eines Menschen und wird genannt'
      using errcode = 'check_violation';
  end if;

  insert into public.zeiteintrag
        (mandant_id, kette_id, version, anstellung_id, person_id,
         einsatz_id, einsatz_zuordnung_id,
         beginn_zeitpunkt, ende_zeitpunkt,
         quelle_beginn, erfassungsart_beginn,
         quelle_ende, erfassungsart_ende,
         behauptet_beginn, nacherfasst, offline_ereignis_id,
         status, erstellt_von_art, erstellt_von, erstellt_von_person_id)
  values (o.mandant_id, v_kette, 1, o.anstellung_id, o.person_id,
          o.einsatz_id, o.einsatz_zuordnung_id,
          p_beginn, p_ende,
          'planer_entscheidung', 'nacherfassung',
          case when p_ende is null then null else 'planer_entscheidung' end::zeitquelle,
          case when p_ende is null then null else 'nacherfassung' end::erfassungs_art,
          o.behauptete_zeit, true, o.id,
          case when p_ende is null then 'laufend' else 'abgeschlossen' end::zeiteintrag_status,
          'mensch', v_benutzer, o.person_id)
  returning id into v_eintrag;

  select to_jsonb(z) into v_neu from public.zeiteintrag z where z.id = v_eintrag;

  /**
   * Die Korrekturzeile ist der Beleg, ohne den `quelle_beginn =
   * 'planer_entscheidung'` nicht rechtmaessig ist (§1.8, TIM-11).
   *
   * `vorher` traegt die BEHAUPTUNG, `nachher` den angelegten Datensatz. Damit
   * beantwortet die Zeile genau die Frage, um die es geht: worin unterscheidet
   * sich, was das Telefon gemeldet hat, von dem, was ein Mensch aufgeschrieben
   * hat — und wer war dieser Mensch.
   */
  insert into public.zeiteintrag_korrektur
        (mandant_id, kette_id, ursprung_zeiteintrag_id, ersatz_zeiteintrag_id,
         art, grund_kategorie, begruendung, vorher, nachher,
         durchgefuehrt_von, erstellt_von_art, erstellt_von, erstellt_von_person_id)
  values (o.mandant_id, v_kette, v_eintrag, v_eintrag,
          'nacherfassung', 'nachtrag_offline', p_begruendung,
          jsonb_build_object('quelle', 'offline_ereignis',
                             'offline_ereignis_id', o.id,
                             'behauptete_zeit', o.behauptete_zeit,
                             'empfangen_am', o.empfangen_am,
                             'verzoegerung_sek', o.verzoegerung_sek,
                             'zeitabweichung_sek', o.zeitabweichung_sek,
                             'nutzlast_sha256', o.nutzlast_sha256),
          v_neu,
          v_benutzer, 'mensch', v_benutzer, o.person_id);

  update public.offline_ereignis
     set status = 'uebernommen', zeiteintrag_id = v_eintrag,
         entschieden_am = now(), entschieden_von = v_benutzer
   where id = o.id;

  perform app.protokolliere('zeit.offline_uebernommen', 'offline_ereignis', o.id::text, null,
                            jsonb_build_object('zeiteintrag_id', v_eintrag::text),
                            o.mandant_id);
  return v_eintrag;
end $$;

comment on function app.offline_uebernehmen(uuid, timestamptz, timestamptz, text) is
  'TIM-09/TIM-11: aus einer Behauptung wird ein Datensatz — mit benanntem '
  'Menschen, Begruendung und Korrekturzeile. Der Zeitpunkt kommt vom Menschen, '
  'nie aus behauptete_zeit (§1.8).';

grant execute on function app.offline_uebernehmen(uuid, timestamptz, timestamptz, text)
  to cse_app;

-- ---------------------------------------------------------------------------
-- 11. app.offline_ablehnen — die andere Haelfte der Entscheidung
-- ---------------------------------------------------------------------------

/**
 * Eine Ablehnung ist eine Entscheidung und braucht dieselbe Spur wie eine
 * Uebernahme: wer, wann, warum. Sie loescht nichts — die Behauptung bleibt
 * stehen, mit ihrem Grund daneben, und ist damit im Lohnstreit vorlegbar
 * (LEG-02, Invariante 8).
 */
create function app.offline_ablehnen(p_ereignis uuid,
                                     p_grund ablehnung_grund,
                                     p_begruendung text)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare o record; v_benutzer uuid := app.aktueller_benutzer();
begin
  select * into o from public.offline_ereignis where id = p_ereignis;
  if not found then
    raise exception 'Diese Einreichung gibt es nicht' using errcode = 'no_data_found';
  end if;
  if not app.hat_recht('zeit.nacherfassung_pruefen', o.mandant_id) then
    raise exception 'Kein Recht, Nacherfassungen zu pruefen'
      using errcode = 'insufficient_privilege';
  end if;
  if o.status in ('uebernommen','abgelehnt') then
    raise exception 'Ueber diese Einreichung ist bereits entschieden'
      using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_begruendung, '')) = '' then
    raise exception 'Eine Ablehnung braucht eine Begruendung'
      using errcode = 'check_violation';
  end if;

  update public.offline_ereignis
     set status = 'abgelehnt', ablehnungsgrund = p_grund,
         entschieden_am = now(), entschieden_von = v_benutzer
   where id = o.id;

  perform app.protokolliere('zeit.offline_abgelehnt', 'offline_ereignis', o.id::text, null,
                            jsonb_build_object('grund', p_grund::text,
                                               'begruendung', p_begruendung),
                            o.mandant_id);
end $$;

grant execute on function app.offline_ablehnen(uuid, ablehnung_grund, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 12. Die zwei Tueren in den Vorbereich (§5.13)
-- ---------------------------------------------------------------------------

/**
 * Lesen darf, wer den Betrieb sieht — und jeder Aufruf wird protokolliert.
 *
 * `system.betrieb_lesen` und nicht `zeit.nacherfassung_pruefen`: die Zeilen
 * hier haben KEINEN Mandanten, es gibt also keinen Bereich, in dem man ein
 * Zeitrecht pruefen koennte. Wer sie sieht, sieht Einreichungen aller
 * Gesellschaften; das ist eine Betriebs-, keine Fachaufgabe.
 */
create function app.offline_unzugeordnet_lesen()
returns table (id uuid, empfangen_am timestamptz, art offline_ereignis_art,
               behauptete_zeit timestamptz, grund ablehnung_grund,
               praesentierter_token_hash text, verzoegerung_sek integer)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  if not app.hat_recht('system.betrieb_lesen', app.aktiver_mandant()) then
    raise exception 'Kein Recht, den Betrieb zu lesen'
      using errcode = 'insufficient_privilege';
  end if;
  perform app.protokolliere('system.offline_vorbereich_gelesen', 'offline_eingang', 'liste');
  return query
    select e.id, e.empfangen_am, e.art, e.behauptete_zeit, e.grund,
           e.praesentierter_token_hash, e.verzoegerung_sek
      from zeit_intern.offline_eingang e
     where e.uebernommen_in_ereignis_id is null and e.entschieden_am is null
     order by e.empfangen_am;
end $$;

grant execute on function app.offline_unzugeordnet_lesen() to cse_app;

/**
 * Die Befoerderung aus dem Vorbereich in einen Mandanten.
 *
 * Das Recht wird IM MANDANTEN DER GENANNTEN EINTEILUNG geprueft — dort
 * entsteht die Zeile, und dort muss der Aufrufer schreiben duerfen. Es gibt
 * keinen anderen Weg, einer mandantenlosen Zeile einen Mandanten zu geben, und
 * `uebernommen_in_ereignis_id` ist eindeutig: eine Einreichung wird nicht
 * zweimal befoerdert.
 */
create function app.offline_eingang_zuordnen(p_eingang uuid,
                                             p_einsatz_zuordnung uuid,
                                             p_begruendung text)
returns uuid
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare e record; z record; v_id uuid; v_benutzer uuid := app.aktueller_benutzer();
begin
  select * into e from zeit_intern.offline_eingang where id = p_eingang;
  if not found then
    raise exception 'Diese Einreichung gibt es nicht' using errcode = 'no_data_found';
  end if;
  if e.uebernommen_in_ereignis_id is not null then
    raise exception 'Diese Einreichung wurde bereits zugeordnet'
      using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_begruendung, '')) = '' then
    raise exception 'Eine Zuordnung braucht eine Begruendung' using errcode = 'check_violation';
  end if;

  select ez.mandant_id, ez.einsatz_id, ez.anstellung_id, ez.person_id
    into z
    from public.einsatz_zuordnung ez where ez.id = p_einsatz_zuordnung;
  if not found then
    raise exception 'Diese Einteilung gibt es nicht' using errcode = 'foreign_key_violation';
  end if;
  if not app.hat_recht('zeit.nacherfassung_pruefen', z.mandant_id) then
    raise exception 'Kein Recht, Nacherfassungen dieser Gesellschaft zu pruefen'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.offline_ereignis
        (mandant_id, client_ereignis_id, geraet_id, eingang_id,
         einsatz_id, einsatz_zuordnung_id, anstellung_id, person_id,
         art, behauptete_zeit, geraete_zeit_bei_uebertragung,
         zeitabweichung_sek, verzoegerung_sek,
         nutzlast_roh, nutzlast_sha256, status, ip_adresse, user_agent,
         erstellt_von_art, erstellt_von, erstellt_von_person_id)
  values (z.mandant_id, e.client_ereignis_id, e.geraet_id, e.id,
          z.einsatz_id, p_einsatz_zuordnung, z.anstellung_id, z.person_id,
          e.art, e.behauptete_zeit, e.geraete_zeit_bei_uebertragung,
          0, 0,
          e.nutzlast_roh, e.nutzlast_sha256, 'zugeordnet', e.ip_adresse, e.user_agent,
          'mensch', v_benutzer, z.person_id)
  returning id into v_id;

  update zeit_intern.offline_eingang
     set uebernommen_in_ereignis_id = v_id,
         entschieden_am = now(), entschieden_von = v_benutzer
   where id = e.id;

  perform app.protokolliere('zeit.offline_zugeordnet', 'offline_ereignis', v_id::text, null,
                            jsonb_build_object('eingang_id', e.id::text,
                                               'begruendung', p_begruendung),
                            z.mandant_id);
  return v_id;
end $$;

grant execute on function app.offline_eingang_zuordnen(uuid, uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 13. Rechteschluessel (K-19) — abgeglichen, nichts nachzutragen
-- ---------------------------------------------------------------------------

/**
 * `app.hat_recht()` antwortet auf einen Schluessel, den der Katalog nicht
 * kennt, dauerhaft `false` — fehlerfrei, ohne Logzeile, als Bildschirm, der
 * immer leer bleibt. Deshalb wird hier nicht vermutet, sondern nachgesehen.
 *
 * Die vier Schluessel dieser Migration — `zeit.nacherfassung_pruefen`
 * (Abschnitte 5, 10, 11, 12), `zeit.lesen` und `zeit.schreiben` (0041),
 * `gruppe.zeit.lesen` (Abschnitt 5) und `system.betrieb_lesen` (Abschnitt 12) —
 * stehen bereits als Katalogzeilen in 0008_berechtigung_matrix.sql. Diese
 * Migration legt deshalb KEINE Katalogzeile an; eine zweite Zeile fuer
 * denselben Schluessel waere ein Schluesselkonflikt, und ein
 * „sicherheitshalber" eingefuegtes `on conflict do nothing` verschleierte den
 * Fall, in dem der Katalog tatsaechlich abweicht.
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0042)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- offline_ereignis (append): TIM-09, LEG-02, § 17 MiLoG. Auf dieser Zeile steht, was eine Kraft behauptet hat und was ein Mensch darueber entschieden hat — samt Grund einer Ablehnung. Genau die abgelehnte Behauptung ist im Lohnstreit das Beweismittel; sie zu loeschen hiesse, die eine Seite des Streits zu entfernen. Entschieden wird ueber sie, nie an ihr.
create trigger trg_offline_ereignis_kein_hard_delete
  before delete on offline_ereignis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_offline_ereignis_kein_truncate
  before truncate on offline_ereignis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on offline_ereignis from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
