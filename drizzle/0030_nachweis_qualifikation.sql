-- ===========================================================================
-- 0030 — Nachweise und Qualifikationen am PERSONENKOPF
--        (SEC-02, SEC-04, EMP-08, LEG-04, D-09)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.16 (qualifikation),
-- §6.17 (nachweis), §6.33 (nachweis_art). Wo dieser Text und eine Konvention
-- (K-nn) auseinandergehen, gilt die Konvention.
--
-- Vier Tabellen, und die Aufteilung ist die ganze Aussage:
--
--   nachweis_art     Der PLATTFORMKATALOG der Nachweisarten ueberhaupt —
--                    einschliesslich der unternehmensbezogenen (§48b EStG),
--                    die an keinem Menschen haengen (§6.33).
--   qualifikation    Der Katalog dessen, was EIN MENSCH nachweisen kann.
--                    `mandant_id` ist nullbar: NULL heisst plattformweit, und
--                    eine §34a-Sachkunde muss in der Reinigung benennbar sein,
--                    nicht nur in der Security (§6.16).
--   nachweis         Der konkrete Nachweis EINES MENSCHEN. Haengt an
--                    `person_id` — nie an `anstellung_id`.
--   nachweis_warnung Das Quittungsbuch des Ablaufwaechters: welche Stufe
--                    (60/30/7) zu welchem Ablaufdatum bereits gemeldet wurde.
--
-- **Warum `nachweis` an der Person haengt und nicht an der Anstellung (D-09).**
-- Fatima Yildiz arbeitet fuer die Reinigung UND fuer die Security. Eine Kopie
-- je Anstellung hiesse zwei Zeilen ueber eine Sachkundepruefung: die eine wird
-- verlaengert, die andere nicht. Der Planer der zweiten Gesellschaft prueft
-- gegen SEINE Kopie, findet sie abgelaufen — oder schlimmer: findet sie
-- gueltig, waehrend die Behoerde sie widerrufen hat — und teilt einen
-- ungeeigneten Wachmann ein. Es gibt hier deshalb KEINE Spalte, an die eine
-- zweite Kopie haengen koennte; das ist keine Konvention, sondern die Form der
-- Tabelle (Invariante 9, Abnahmekriterium 3 von PR 31).
--
-- **Warum die Gueltigkeit gegen das SCHICHTDATUM geprueft wird, nie gegen
-- `now()`.** Ein Nachweis, der am 3. Maerz gueltig war und am 4. Maerz ablief,
-- hat die Schicht vom 3. Maerz gedeckt. Wer gegen `now()` prueft, erklaert
-- rueckwirkend jede vergangene Schicht fuer unzulaessig — und findet in einer
-- Pruefung nichts mehr, womit sie zulaessig war. Der Vergleichstag ist der
-- BERLINER Kalendertag des Schichtbeginns (K-11); die Auswertung selbst steht
-- in `0031`, wo der Einsatzbezug hinzukommt.
--
-- NICHT in dieser Migration: `bewacher_eintrag`, `einsatzanforderung` und das
-- SEC-04-Tor — sie stehen in `0031`, weil das Tor `bewacher_eintrag` liest und
-- eine Funktion nicht vor ihrer Tabelle entstehen kann.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (01-KERN §4)
-- ---------------------------------------------------------------------------

/**
 * Der Lebenslauf eines Nachweises.
 *
 * Das Vokabular ist FESTGELEGT und Teil des Vertrags: `03-GEWERKE.md` §9.3
 * vergleicht im SEC-04-Tor gegen das Literal `'gueltig'`. Eine Personal-Domaene,
 * die den Wert `aktiv` nennte, machte aus dem Tor eine universelle Sperre —
 * jede Zuweisung scheiterte, und zwar lautlos richtig aussehend.
 */
create type nachweis_status as enum
  ('beantragt','gueltig','abgelaufen','widerrufen','abgelehnt');

/**
 * PROVISORISCH (01-KERN §4). SEC-02 nennt nur §34a-Sachkunde und
 * -Unterrichtung; die fuenf Gruppen sind, was ein Nachweisregister zum
 * Sortieren braucht, und keine Rechtsfolge haengt an ihnen.
 * // TODO(client, O-144): Welche Kategorien werden fuer die
 * Nachweisberichterstattung tatsaechlich verwendet?
 */
create type qualifikation_kategorie as enum
  ('gesetzlich','fachlich','fuehrerschein','gesundheit','intern');

-- ---------------------------------------------------------------------------
-- 2. `app.person_sichtbar` — der aeussere Konjunkt jeder Personentatsache
-- ---------------------------------------------------------------------------

/**
 * Darf der Aufrufer diesen MENSCHEN ueberhaupt sehen (01-KERN §3.2)?
 *
 * **`SECURITY INVOKER`, mit Absicht.** Der Entwurf machte die Funktion
 * `SECURITY DEFINER` mit der Begruendung, sonst rekursierten die Policies von
 * `person` und `anstellung`. Das stimmt nicht: die Policy auf `anstellung`
 * nennt `person` nicht. Als Invoker ist das innere `exists` durch die eigenen
 * Policies von `anstellung` gefiltert — und damit beantwortet die Funktion
 * genau die Regel aus D-09 §6 („eine `person` ist fuer jeden Mandanten
 * sichtbar, bei dem sie beschaeftigt ist"), in der Mandanten- wie in der
 * Gruppenansicht, ohne eine einzige `cse_definer`-Policy auf einer
 * Mandantentabelle.
 *
 * **Zwei Disjunkte aus §3.2 fehlen hier noch, und das ist eine Aussage, keine
 * Auslassung:** der Vorgesetztenzweig braucht
 * `anstellung.vorgesetzter_anstellung_id` und der Bootstrap-Anker
 * `person.erfasst_von_mandant_id`. Beide Spalten gibt es in `0002` nicht. Sie
 * hier gegen nicht vorhandene Spalten zu schreiben waere ein Migrationsfehler;
 * sie stillschweigend wegzulassen waere eine engere Sichtbarkeit, als das
 * Dokument zusagt. Also: sie kommen mit ihren Spalten, und diese Notiz sagt,
 * woran man sie erkennt.
 */
create function app.person_sichtbar(p_person uuid) returns boolean
language sql stable as $$
  select p_person is not null
     and (p_person = app.aktuelle_person()
          or app.ist_super_admin()
          -- Durch die Policies von `anstellung` gefiltert — das ist der Punkt.
          or exists (select 1 from public.anstellung a
                      where a.person_id = p_person and a.geloescht_am is null));
$$;

comment on function app.person_sichtbar(uuid) is
  'D-09 §6: ein Mensch ist sichtbar, wo er beschaeftigt ist. SECURITY INVOKER — '
  'das innere exists laeuft durch die Policies von anstellung, in allen vier '
  'Leseumfaengen (K-20).';

-- ---------------------------------------------------------------------------
-- 3. nachweis_art — der Plattformkatalog der Nachweisarten (§6.33)
-- ---------------------------------------------------------------------------

/**
 * Die Obermenge der Nachweisarten — Personen- UND Unternehmensnachweise.
 *
 * Abgrenzung zu `qualifikation`: `qualifikation` ist der Katalog dessen, was
 * ein MENSCH nachweisen kann, und `nachweis` haengt daran. `nachweis_art` ist
 * die Obermenge einschliesslich der unternehmensbezogenen Arten
 * (Freistellungsbescheinigung §48b EStG, Praequalifikation), die an keinem
 * Menschen haengen. Jede `qualifikation` verweist auf ihre `nachweis_art`;
 * nicht jede `nachweis_art` hat eine `qualifikation`.
 *
 * OHNE `mandant_id` — reine Plattformreferenz. K-16 verbietet den Mittelweg:
 * ein Katalog ist entweder gruppenweit oder je Mandant, nie beides.
 */
create table nachweis_art (
  id            uuid primary key default gen_random_uuid(),
  /**
   * Steht in Vergabemappen und Agentenprotokollen, deshalb formgebunden.
   *
   * §6.33 schreibt `^[a-z][a-z0-9_]{2,49}$` — und seedet im selben Abschnitt
   * `34a_sachkunde` und `34a_unterrichtung`, die daran scheitern. Von den
   * beiden gewinnt der SCHLUESSEL: die zwei Namen stehen so in SEC-02 und
   * ebenso als Beispiel in §6.16; das Muster ist eine Formregel desselben
   * Dokuments. Die Ziffer ist deshalb am Anfang zugelassen, alles Uebrige
   * bleibt.
   */
  schluessel    text not null
                  check (schluessel ~ '^[a-z0-9][a-z0-9_]{2,49}$'),
  bezeichnung   text not null,
  -- de/en/ar/tr (EMP-12): Arbeiter sehen die Liste in ihren eigenen Nachweisen.
  bezeichnung_i18n jsonb not null default '{}'::jsonb,
  /**
   * Die beiden Modi von `pruefe_nachweise`. Ein Personennachweis haengt an
   * `person_id` (D-09), ein Unternehmensnachweis am Mandanten.
   */
  subjekt       text not null check (subjekt in ('person','unternehmen')),
  rechtsgrundlage text,
  laeuft_ab     boolean not null default false,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  constraint nachweis_art_key unique (schluessel),
  /**
   * Der Sprachschluessel-CHECK, und warum er nicht so aussieht wie im Dokument.
   *
   * 01-KERN §4 schreibt ihn als `(select bool_and(k in (...)) from
   * jsonb_object_keys(...) k)`. Das ist als CHECK nicht ausfuehrbar: ein CHECK
   * darf keine Unterabfrage enthalten, und `jsonb_object_keys` ist
   * mengenliefernd. Zudem war der vorangestellte Disjunkt `i18n ?& array[]`
   * IMMER wahr (jede Menge enthaelt die leere Menge), der Ausdruck also eine
   * Tautologie. Dieselbe Aussage, unveraenderlich und wirksam: nach Abzug der
   * vier erlaubten Schluessel bleibt nichts uebrig.
   */
  constraint nachweis_art_sprachen
    check (bezeichnung_i18n - array['de','en','ar','tr'] = '{}'::jsonb)
);

create index nachweis_art_subjekt_idx on nachweis_art (subjekt) where archiviert_am is null;

comment on table nachweis_art is
  'Plattformkatalog der Nachweisarten (§6.33). Wird LEER ausgeliefert bis auf '
  'die zwei Arten, die SEC-02 ausdruecklich nennt — O-107.';

/**
 * Der Katalog wird leer ausgeliefert (K-17).
 *
 * Welche Nachweise die Vergabestellen verlangen, auf denen die Gruppe
 * registriert ist, steht in keinem SPEC-Punkt. Bis zur Antwort seedet Phase 1
 * genau die zwei Arten, die SEC-02 benennt.
 * // TODO(client, O-107): Welche Eignungs- und Personennachweise verlangen die
 * Vergabestellen, auf denen die Gruppe registriert ist, und welche
 * Nachweisarten fuehrt die Gruppe intern?
 */
insert into nachweis_art (schluessel, bezeichnung, bezeichnung_i18n, subjekt,
                          rechtsgrundlage, laeuft_ab)
values
  ('34a_sachkunde', 'Sachkundeprüfung nach §34a GewO',
   '{"de":"Sachkundeprüfung nach §34a GewO","en":"§34a GewO competence examination"}'::jsonb,
   'person', '§34a Abs. 1a GewO', false),
  ('34a_unterrichtung', 'Unterrichtung nach §34a GewO',
   '{"de":"Unterrichtung nach §34a GewO","en":"§34a GewO instruction certificate"}'::jsonb,
   'person', '§34a Abs. 1 GewO', false);

-- ---------------------------------------------------------------------------
-- 4. qualifikation — der Katalog dessen, was ein Mensch nachweisen kann (§6.16)
-- ---------------------------------------------------------------------------

create table qualifikation (
  id            uuid primary key default gen_random_uuid(),
  /**
   * NULLBAR, und das ist die eine bewusste Ausnahme von K-16s Katalogregel:
   * NULL heisst plattformweit. §34a gehoert zum MENSCHEN und muss
   * bereichsuebergreifend benennbar sein — sonst kann die Reinigung den
   * Sachkundenachweis eines gemeinsam beschaeftigten Menschen nicht einmal
   * benennen, geschweige denn lesen (§6.16, 03-GEWERKE §2.1).
   */
  mandant_id    uuid references mandant(id),
  schluessel    text not null,
  -- Ordnet die Qualifikation der plattformweiten Nachweisart zu. Nullbar: eine
  -- mandantenspezifische Qualifikation darf existieren, bevor O-107 die
  -- Artenliste bestaetigt hat. Kein CHECK — der Dienst warnt.
  nachweis_art_id uuid references nachweis_art(id),
  bezeichnung   text not null,
  bezeichnung_i18n jsonb not null default '{}'::jsonb,
  beschreibung  text,
  kategorie     qualifikation_kategorie not null default 'fachlich',
  -- Anzeigetext, z. B. „§34a GewO". NIE gematcht: 03-GEWERKE §9.3 hat den
  -- Registerzweig des Tors frueher mit `rechtsgrundlage ilike '%34a%'`
  -- entschieden — „§ 34 a GewO" schaltete die Pruefung lautlos ab.
  rechtsgrundlage text,
  laeuft_ab     boolean not null default false,
  standard_gueltigkeit_monate integer
                  check (standard_gueltigkeit_monate is null
                         or standard_gueltigkeit_monate > 0),
  /**
   * Die Eskalationsstufen des Ablaufwaechters. SPEC §14 nennt genau 60/30/7.
   * Als Spalte und nicht als Konstante, weil eine Qualifikation mit einer
   * anderen Wiederbeschaffungszeit eine andere Vorwarnung braucht.
   */
  warnung_tage  integer[] not null default '{60,30,7}',
  -- `true` = ein abgelaufener Nachweis verhindert die Zuweisung HART (SEC-04).
  blockiert_einsatz boolean not null default false,
  -- Nachweis nur gueltig mit hinterlegtem Dokument (DOC-01).
  erfordert_dokument boolean not null default false,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  /**
   * `NULLS NOT DISTINCT`: ohne das waeren zwei plattformweite Zeilen mit
   * demselben Schluessel erlaubt, weil NULL <> NULL — und `34a_sachkunde`
   * gaebe es dann zweimal, mit zwei verschiedenen `blockiert_einsatz`.
   */
  constraint qualifikation_schluessel_key unique nulls not distinct (mandant_id, schluessel),
  constraint qualifikation_sprachen
    check (bezeichnung_i18n - array['de','en','ar','tr'] = '{}'::jsonb),
  -- Der Waechter laeuft ueber diese Stufen; eine leere oder negative Stufe
  -- hiesse "nie warnen" beziehungsweise "immer warnen".
  constraint qualifikation_warnstufen
    check (array_length(warnung_tage, 1) is null
           or (array_length(warnung_tage, 1) > 0
               and 0 < all (warnung_tage)))
);

-- Die Pruefliste von SEC-04 bei jeder Einsatzzuweisung.
create index qualifikation_blockierend_idx on qualifikation (id)
  where blockiert_einsatz and archiviert_am is null;

comment on table qualifikation is
  'Katalog dessen, was ein MENSCH nachweisen kann (§6.16). mandant_id NULL = '
  'plattformweit — §34a muss in der Reinigung benennbar sein, nicht nur in der '
  'Security.';

comment on column qualifikation.rechtsgrundlage is
  'Anzeigetext. NIE Grundlage einer Entscheidung — die maschinenlesbare Haelfte '
  'von §34a ist einsatzanforderung.bewacherregister_pflicht (0031).';

/** `schluessel` ist unveraenderlich: er steht in Berichten und Exporten. */
create function kern.qualifikation_katalog_schutz() returns trigger
language plpgsql as $$
begin
  if new.schluessel is distinct from old.schluessel then
    raise exception 'qualifikation.schluessel ist unveraenderlich (%→%).',
      old.schluessel, new.schluessel using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger a_qualifikation_katalog_schutz
  before update on qualifikation
  for each row execute function kern.qualifikation_katalog_schutz();

-- ---------------------------------------------------------------------------
-- 5. nachweis — der konkrete Nachweis eines Menschen (§6.17)
-- ---------------------------------------------------------------------------

create table nachweis (
  id            uuid primary key default gen_random_uuid(),
  /**
   * **`person_id`, und es gibt kein `anstellung_id`.**
   *
   * Pro Anstellung gespeichert entstuenden eine gueltige und eine abgelaufene
   * Kopie desselben Nachweises — und ein Planer, der gegen seine eigene Kopie
   * prueft, weist einen ungeeigneten Wachmann zu (D-09, Invariante 9). Die
   * Abwesenheit der Spalte ist die Zusage; ein `insert` mit `anstellung_id`
   * scheitert deshalb an der Tabelle und nicht an einer Regel, die jemand
   * pflegen muesste.
   */
  person_id     uuid not null references person(id),
  qualifikation_id uuid not null references qualifikation(id),
  -- Zeugnis-/Bescheinigungsnummer. Personenbezogen (§15 DSGVO-Inventar).
  nummer        text,
  ausstellende_stelle text,
  ausgestellt_am date,
  /**
   * KEIN Default. Der Entwurf hatte `default current_date`: der
   * Gueltigkeitsbeginn einer Sachkundepruefung ist eine auf dem Dokument
   * GEDRUCKTE Tatsache, nicht „heute" — und weil `gueltig_ab` Teil der
   * Zeilenidentitaet ist (`nachweis_aktiv_uk`), wuerde ein falscher Default
   * Teil des Schluessels.
   */
  gueltig_ab    date not null,
  -- NULL = unbefristet. SEC-04 vergleicht gegen den BERLINER Kalendertag des
  -- Einsatzbeginns (K-11), nie gegen `now()`.
  gueltig_bis   date,
  status        nachweis_status not null default 'gueltig',
  dokument_id   uuid references dokument(id),
  /**
   * WELCHE Entitaet den Nachweis eingereicht hat — Verantwortlichkeit.
   * **Steuert die Sichtbarkeit ausdruecklich NICHT** (§6.17): ein von der
   * Reinigung erfasster §34a-Nachweis muss fuer die Security lesbar sein, sonst
   * prueft sie gegen nichts.
   */
  erfasst_von_mandant_id uuid not null references mandant(id),
  -- Vier-Augen-Pruefung des Originals.
  geprueft_von  uuid references benutzer(id),
  geprueft_am   timestamptz,
  -- Kein Hard Delete: vergangene Einsaetze wurden durch diesen Nachweis
  -- gedeckt, und ein Widerruf loescht diese Deckung nicht rueckwirkend.
  widerrufen_am timestamptz,
  widerruf_grund text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  constraint nachweis_zeitraum
    check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  constraint nachweis_widerruf_begruendet
    check (widerrufen_am is null or btrim(coalesce(widerruf_grund,'')) <> ''),
  -- Der Elternschluessel, den `nachweis_warnung` fuer seinen zusammengesetzten
  -- FK braucht (K-16): die denormalisierte `person_id` kann so nicht driften.
  constraint nachweis_id_person_uk unique (id, person_id)
);

-- „Hat dieser Mensch am Einsatztag einen gueltigen Nachweis X" — das SEC-04-Tor.
create index nachweis_person_idx on nachweis (person_id, qualifikation_id, gueltig_bis desc);
-- Der Ablaufwaechter 60/30/7 (SPEC §14).
create index nachweis_ablauf_idx on nachweis (gueltig_bis)
  where status = 'gueltig' and gueltig_bis is not null;
/**
 * Teilweise eindeutig, weil der Widerruf weich ist (§1.8): derselbe Mensch,
 * dieselbe Qualifikation, derselbe Gueltigkeitsbeginn — hoechstens einmal
 * lebend. Ein widerrufener Nachweis bleibt daneben stehen, sonst waere die
 * Neuerteilung nach einem Widerruf nicht eintragbar.
 */
create unique index nachweis_aktiv_uk on nachweis (person_id, qualifikation_id, gueltig_ab)
  where widerrufen_am is null;

comment on table nachweis is
  'Der Qualifikationsnachweis eines MENSCHEN (§6.17). Haengt an person_id — es '
  'gibt keine Spalte fuer eine Kopie je Anstellung (D-09, Invariante 9).';

/**
 * DOC-01: ist die Qualifikation dokumentpflichtig, gibt es `gueltig` nur mit
 * hinterlegtem Dokument.
 *
 * **`SECURITY DEFINER`, und der Grund ist derselbe wie beim SEC-04-Tor.** Der
 * Ausloeser laeuft sonst als Aufrufer und damit unter FORCE RLS: wer eine
 * mandantenfremde Qualifikation nicht sehen darf, liest hier null Zeilen, der
 * Pflichtwert kaeme als NULL zurueck und die Pflicht faellt LAUTLOS weg. Ein
 * definer ohne Lesepolicy haette dieselbe Wirkung — deshalb `q_definer` unten.
 */
create function kern.nachweis_dokumentpflicht() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_pflicht boolean;
begin
  select q.erfordert_dokument into v_pflicht
    from public.qualifikation q where q.id = new.qualifikation_id;
  if v_pflicht is null then
    raise exception 'Unbekannte Qualifikation % — Dokumentpflicht nicht pruefbar.',
      new.qualifikation_id using errcode = 'P0001';
  end if;
  if v_pflicht and new.status = 'gueltig' and new.dokument_id is null then
    raise exception 'DOC-01: % verlangt ein hinterlegtes Dokument, bevor der '
                    'Nachweis gueltig sein darf.', new.qualifikation_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger a_nachweis_dokumentpflicht
  before insert or update of status, dokument_id, qualifikation_id on nachweis
  for each row execute function kern.nachweis_dokumentpflicht();

-- ---------------------------------------------------------------------------
-- 6. nachweis_warnung — das Quittungsbuch des Ablaufwaechters (SPEC §14)
-- ---------------------------------------------------------------------------

/**
 * Welche Warnstufe zu welchem Ablaufdatum bereits gemeldet wurde.
 *
 * **Ohne Traeger ist „60/30/7 feuert je genau einmal" eine Absichtserklaerung.**
 * Ein Waechter, der taeglich laeuft, sieht denselben Nachweis an 60 aufeinander
 * folgenden Tagen; ohne Gedaechtnis meldet er ihn 60-mal, und wer 60 Meldungen
 * bekommt, liest keine. Der eindeutige Schluessel ist deshalb die Zusage
 * selbst: der zweite Versuch trifft `on conflict do nothing`, egal ob er aus
 * einem Wiederholungslauf oder aus zwei gleichzeitigen Laeufen kommt (K-09 —
 * pruefen-dann-handeln ist ein Wettlauf).
 *
 * **`gueltig_bis` steht IM Schluessel**, nicht daneben. Wird ein Nachweis
 * verlaengert, ist die 30-Tage-Warnung zum NEUEN Ablaufdatum eine andere
 * Tatsache als die zum alten — ohne die Spalte im Schluessel bliebe sie fuer
 * immer aus, und der verlaengerte Nachweis liefe beim zweiten Mal unbemerkt ab.
 */
create table nachweis_warnung (
  id            uuid primary key default gen_random_uuid(),
  nachweis_id   uuid not null references nachweis(id),
  -- Denormalisiert fuer die Policy und die K-04-Decke: eine Policy darf nicht
  -- ueber eine Unterabfrage auf die Elterntabelle entscheiden (K-04, §1.8),
  -- weil diese Unterabfrage selbst der RLS des Elternteils unterliegt.
  person_id     uuid not null references person(id),
  -- Die Stufe in TAGEN, wie sie in `qualifikation.warnung_tage` steht.
  stufe_tage    integer not null check (stufe_tage > 0),
  -- Das Ablaufdatum, auf das sich die Warnung bezieht — Schnappschuss.
  gueltig_bis   date not null,
  -- Serveruhr (Invariante 5): der Zeitpunkt der Meldung ist keine Angabe des
  -- Aufrufers.
  ausgeloest_am timestamptz not null default now(),
  erstellt_am   timestamptz not null default now(),

  constraint nachweis_warnung_einmal unique (nachweis_id, gueltig_bis, stufe_tage),
  constraint nachweis_warnung_person_fk foreign key (nachweis_id, person_id)
    references nachweis (id, person_id)
);

create index nachweis_warnung_nachweis_idx on nachweis_warnung (nachweis_id, stufe_tage);

comment on table nachweis_warnung is
  'Quittungsbuch des 60/30/7-Ablaufwaechters (SPEC §14). Der eindeutige '
  'Schluessel IST die Zusage „je Stufe genau einmal"; angehaengt wird nur.';

-- ---------------------------------------------------------------------------
-- 7. Zeilenschutz — nachweis_art
-- ---------------------------------------------------------------------------

alter table nachweis_art enable row level security;
alter table nachweis_art force  row level security;

/**
 * Jeder darf die ARTEN lesen: eine Nachweisart ist ueber niemanden eine
 * Aussage. Geschrieben wird sie nur plattformweit.
 */
create policy na_lesen on nachweis_art for select to cse_app using (true);
create policy na_verwalten on nachweis_art for all to cse_app
  using (app.ist_super_admin())
  with check (app.ist_super_admin() and not app.ist_readonly());

grant select on nachweis_art to cse_app;
grant insert, update on nachweis_art to cse_app;

-- ---------------------------------------------------------------------------
-- 8. Zeilenschutz — qualifikation
-- ---------------------------------------------------------------------------

alter table qualifikation enable row level security;
alter table qualifikation force  row level security;

/**
 * Lesen: plattformweite Zeilen IMMER, mandantenspezifische in den sichtbaren
 * Bereichen. Ohne den ersten Disjunkt koennte die Reinigung den §34a-Nachweis
 * eines gemeinsam beschaeftigten Menschen nicht einmal benennen (§6.16).
 *
 * Es gibt hier bewusst KEINEN Rechtekonjunkt: der Katalogname ist keine
 * Personentatsache, und ohne ihn waere jede Nachweisliste eine Liste von UUIDs.
 * Die Personentatsache selbst — WER welchen Nachweis hat — steht in `nachweis`
 * und ist dort rechtegebunden.
 */
create policy q_lesen on qualifikation for select to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()));

create policy q_schreiben on qualifikation for insert to cse_app
  with check (not app.ist_readonly()
              and ((mandant_id is not null
                    and (select app.hat_recht('stammdaten.verwalten', mandant_id)))
                   -- Plattformweite Katalogzeilen nur Super-Admin (§6.16).
                   or (mandant_id is null and app.ist_super_admin())));

create policy q_aendern on qualifikation for update to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()))
  with check (not app.ist_readonly()
              and ((mandant_id is not null
                    and (select app.hat_recht('stammdaten.verwalten', mandant_id)))
                   or (mandant_id is null and app.ist_super_admin())));

/**
 * Die eine `cse_definer`-Lesepolicy dieser Migration.
 *
 * `kern.nachweis_dokumentpflicht()` und — in `0031` —
 * `kern.pruefe_qualifikation_mandant()` laufen als `cse_definer`, und
 * `FORCE ROW LEVEL SECURITY` nimmt dem Eigentuemer seine Ausnahme. Ohne diese
 * Zeile liest der definer NULL ZEILEN UND KEINEN FEHLER: die Dokumentpflicht
 * faellt weg und die Mandantenpruefung der Anforderung geht durch. Beides
 * scheitert nach OBEN offen, und kein Test mit normal berechtigtem Aufrufer
 * sieht es (01-KERN §3.5, 03-GEWERKE §1.10).
 */
create policy q_definer on qualifikation for select to cse_definer using (true);

grant select, insert, update on qualifikation to cse_app;
grant select on qualifikation to cse_job;
create policy q_job on qualifikation for select to cse_job using (true);

-- ---------------------------------------------------------------------------
-- 9. Zeilenschutz — nachweis (§6.17)
-- ---------------------------------------------------------------------------

alter table nachweis enable row level security;
alter table nachweis force  row level security;

/**
 * Personenabgeleitet UND rechtegebunden.
 *
 * Der Selbstzugriff (`person_id = app.aktuelle_person()`) bedient EMP-08: der
 * Mensch sieht seine eigenen Zertifikate ueber ALLE Beschaeftigungen hinweg,
 * mit persoenlicher Ablaufwarnung. Weil `nachweis` kein `mandant_id` traegt,
 * entfaellt der Mandantenkonjunkt — das ist die K-18-`t_person`-Lesung, und
 * sie braucht hier keine eigene Policy.
 *
 * K-20: in Gruppen-, Personen- und Kundenansicht ist `app.aktiver_mandant()`
 * NULL, `app.hat_recht(…, NULL)` also `false`. Dort traegt allein der
 * Selbstzugriff — dokumentiert fehlschliessend, nicht zufaellig leer.
 */
create policy n_lesen on nachweis for select to cse_app
  using (app.person_sichtbar(person_id)
         and ((select app.hat_recht('personal.nachweis_lesen', app.aktiver_mandant()))
              or person_id = app.aktuelle_person()));

create policy n_schreiben on nachweis for insert to cse_app
  with check (app.person_sichtbar(person_id)
              and not app.ist_readonly()
              and (select app.hat_recht('personal.nachweis_verwalten', app.aktiver_mandant()))
              -- Wer erfasst, erfasst FUER SEINE Entitaet. Die Spalte traegt die
              -- Verantwortlichkeit, nicht die Sichtbarkeit.
              and erfasst_von_mandant_id = app.aktiver_mandant());

create policy n_aendern on nachweis for update to cse_app
  using (app.person_sichtbar(person_id)
         and (select app.hat_recht('personal.nachweis_verwalten', app.aktiver_mandant())))
  with check (app.person_sichtbar(person_id)
              and not app.ist_readonly()
              and (select app.hat_recht('personal.nachweis_verwalten', app.aktiver_mandant())));

/**
 * K-04: im Mitarbeiterportal hoechstens die eigenen Zeilen. `restrictive`,
 * also zusaetzlich zu allem oben — die Decke sagt „hoechstens deine", die
 * Policy sagt „diese hier".
 */
create policy n_ma_decke on nachweis as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter' or person_id = app.aktuelle_person());
/**
 * Und im Kundenportal gar keine. Die Decke ist entartet, weil ein Nachweis
 * keine `kunde_id` traegt: WER auf einer Schicht qualifiziert ist, ist keine
 * Zeile des Kunden (EMP-13).
 */
create policy n_kunde_decke on nachweis as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * `cse_definer`: das SEC-04-Tor in `0031` liest diese Tabelle. Ohne die Policy
 * antwortet es `'erfuellt': true` fuer JEDE Zuweisung — es faellt nach oben
 * offen, lautlos, und genau darauf ruht LEG-04 (03-GEWERKE §9.3).
 */
create policy n_definer on nachweis for select to cse_definer using (true);

grant select, insert, update on nachweis to cse_app;
grant select on nachweis to cse_job;
create policy n_job on nachweis for select to cse_job using (true);
-- Der naechtliche Statuslauf `gueltig → abgelaufen` (§12.3). Nur diese Spalte:
-- eine Gueltigkeit zu verschieben ist eine Personalentscheidung, kein Nachtlauf.
create policy n_job_status on nachweis for update to cse_job
  using (true) with check (true);
grant update (status, geaendert_am) on nachweis to cse_job;

-- ---------------------------------------------------------------------------
-- 10. Zeilenschutz — nachweis_warnung
-- ---------------------------------------------------------------------------

alter table nachweis_warnung enable row level security;
alter table nachweis_warnung force  row level security;

create policy nw_lesen on nachweis_warnung for select to cse_app
  using (app.person_sichtbar(person_id)
         and ((select app.hat_recht('personal.nachweis_lesen', app.aktiver_mandant()))
              or person_id = app.aktuelle_person()));

create policy nw_schreiben on nachweis_warnung for insert to cse_app
  with check (app.person_sichtbar(person_id)
              and not app.ist_readonly()
              and (select app.hat_recht('personal.nachweis_verwalten', app.aktiver_mandant())));

create policy nw_ma_decke on nachweis_warnung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter' or person_id = app.aktuelle_person());
create policy nw_kunde_decke on nachweis_warnung as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

-- Der Waechter laeuft nachts als `cse_job`, ohne Sitzung: ohne eigene Policy
-- traefe er null Zeilen und schriebe nichts.
create policy nw_job on nachweis_warnung for select to cse_job using (true);
create policy nw_job_melden on nachweis_warnung for insert to cse_job with check (true);

grant select, insert on nachweis_warnung to cse_app;
grant select, insert on nachweis_warnung to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0030)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- nachweis_art (archiv): LEG-04, § 34a GewO. Der Schluessel einer Nachweisart steht in Vergabemappen, Agentenprotokollen und in jeder Qualifikation, die auf ihn zeigt. Ihn zu loeschen macht rueckwirkend unlesbar, WELCHE Eignung einmal verlangt war; sein Ende ist archiviert_am.
create trigger trg_nachweis_art_kein_hard_delete
  before delete on nachweis_art
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachweis_art_kein_truncate
  before truncate on nachweis_art
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachweis_art from cse_app, cse_anon, cse_checkin, cse_job;

-- qualifikation (archiv): LEG-04, § 34a GewO. Gegen diese Katalogzeile hat das SEC-04-Tor jede vergangene Zuweisung entschieden, und der Schnappschuss auf der Zuordnung verweist auf ihre id. Geloescht bliebe von der Entscheidung eine UUID ohne Bedeutung uebrig; abgeloest wird sie durch archiviert_am.
create trigger trg_qualifikation_kein_hard_delete
  before delete on qualifikation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_qualifikation_kein_truncate
  before truncate on qualifikation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on qualifikation from cse_app, cse_anon, cse_checkin, cse_job;

-- nachweis (archiv): LEG-04, D-09, § 34a GewO. Dieser Nachweis hat vergangene Schichten GEDECKT — er ist der Beleg, mit dem sich gegenueber der Behoerde zeigen laesst, dass der Einsatz zulaessig war. Ein Widerruf setzt widerrufen_am und nimmt diese Deckung nicht rueckwirkend weg.
create trigger trg_nachweis_kein_hard_delete
  before delete on nachweis
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachweis_kein_truncate
  before truncate on nachweis
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachweis from cse_app, cse_anon, cse_checkin, cse_job;

-- nachweis_warnung (append): LEG-04, § 34a GewO. Die Quittung, dass die 60/30/7-Stufe gemeldet wurde. Eine loeschbare Quittung ist keine: geloescht meldete der Waechter dieselbe Stufe erneut, und die Zusage "je genau einmal" haette keinen Traeger mehr.
create trigger trg_nachweis_warnung_kein_hard_delete
  before delete on nachweis_warnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachweis_warnung_kein_truncate
  before truncate on nachweis_warnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachweis_warnung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_nachweis_art_geaendert_am
  before update on nachweis_art
  for each row execute function kern.setze_geaendert_am();
create trigger trg_qualifikation_geaendert_am
  before update on qualifikation
  for each row execute function kern.setze_geaendert_am();
create trigger trg_nachweis_geaendert_am
  before update on nachweis
  for each row execute function kern.setze_geaendert_am();

create trigger trg_nachweis_audit
  after insert or update or delete on nachweis
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
