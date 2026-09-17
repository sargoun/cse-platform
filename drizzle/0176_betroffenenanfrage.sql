-- 0176 — die Betroffenenanfrage (LEG-09, Art. 12 Abs. 3 DSGVO).
--
-- ===========================================================================
-- Warum diese Tabelle vor der Seite kommt
-- ===========================================================================
--
-- `/datenschutz/anfrage` ist eine oeffentliche Adresse, die die Seitenkarte
-- seit Phase 2 zusagt und die heute mit 404 antwortet. Sie zu bauen, ohne dass
-- die Anfrage IRGENDWO landet, waere schlimmer als die 404:
--
--   „Ein oeffentliches Formular, das eine Pflicht nach Art. 12 Abs. 3
--    erzeugt und keinen internen Empfaenger hat, ist eine versaeumte
--    gesetzliche Frist mit einem Zeitstempel darauf."
--    (04-SEITENKARTE.md §2.4)
--
-- Deshalb zuerst der Empfaenger, dann das Formular.
--
-- ===========================================================================
-- Die Frist rechnet die Datenbank, nicht die Oberflaeche
-- ===========================================================================
--
-- Art. 12 Abs. 3 DSGVO: „unverzueglich, in jedem Fall aber innerhalb eines
-- Monats nach Eingang des Antrags". Ein Monat, nicht dreissig Tage — der
-- Unterschied sind im Februar drei Tage, und drei Tage sind der Unterschied
-- zwischen fristgerecht und nicht. `+ interval '1 month'` rechnet
-- kalendarisch; `+ 30` haette im Februar zu frueh und im Juli zu spaet
-- gewarnt.
--
-- Sie steht als GENERIERTE Spalte da und nicht als Berechnung in einer
-- Abfrage: eine Frist, die jede Seite selbst rechnet, rechnet jede Seite
-- irgendwann anders.

create type betroffenenanfrage_art as enum (
  'auskunft',       -- Art. 15
  'berichtigung',   -- Art. 16
  'loeschung',      -- Art. 17
  'einschraenkung', -- Art. 18
  'uebertragbarkeit', -- Art. 20
  'widerspruch');   -- Art. 21

create type betroffenenanfrage_status as enum (
  'neu', 'identitaet_offen', 'in_bearbeitung', 'beantwortet', 'abgelehnt');

create table betroffenenanfrage (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  art           betroffenenanfrage_art not null,
  status        betroffenenanfrage_status not null default 'neu',

  /**
   * Was der Anfragende ueber sich sagt — NICHT, was die Plattform ueber ihn
   * weiss. Die Zuordnung zu einer `person`, einem `ansprechpartner` oder einer
   * `bewerbung` trifft ein Mensch und traegt sie unten ein.
   *
   * **Und genau deshalb steht hier so wenig.** Ein Formular, das nach
   * Geburtsdatum und Anschrift fragt, um „die Identitaet zu pruefen", sammelt
   * bei jedem Auskunftsersuchen mehr Daten ein, als es herausgibt. Art. 12
   * Abs. 6 erlaubt die Nachfrage NUR bei begruendeten Zweifeln — also
   * hinterher, im Einzelfall, und nicht im Formular.
   */
  name          text not null check (btrim(name) <> ''),
  email         text not null check (email ~ '^[^@]+@[^@]+\.[a-z]{2,}$'),
  nachricht     text,

  /**
   * Als was sich die Person bezeichnet — Beschaeftigte, Bewerberin, Kundin,
   * Besucherin. Eine geschlossene Liste waere hier falsch: wer sich in keiner
   * Schublade wiederfindet, fuellt das Formular nicht aus.
   */
  rolle_angabe  text,

  eingegangen_am timestamptz not null default now(),

  /**
   * Die Monatsfrist — kalendarisch, in EINER Funktion, nicht in jeder Abfrage.
   *
   * **Sie ist keine generierte Spalte, und das ist kein Schoenheitsfehler.**
   * Der erste Entwurf schrieb `generated always as (eingegangen_am + interval
   * '1 month') stored`, und Postgres wies ihn ab: „generation expression is
   * not immutable". Zu Recht — `timestamptz + interval '1 month'` haengt an
   * der Zeitzone der Sitzung, und welcher Kalendertag einen Monat spaeter ist,
   * ist in Berlin etwas anderes als in UTC. Genau der DST-Fall, den
   * Invariante 2 meint.
   *
   * Sie wird deshalb von einem Ausloeser gesetzt, der die Zone AUSSCHREIBT.
   * Der Wert steht danach fest: eine Frist, die sich mit der Zeitzone des
   * Lesers aendert, ist keine.
   */
  frist_am      timestamptz not null default now() + interval '30 days',

  /**
   * Art. 12 Abs. 3 Satz 3: die Frist kann um ZWEI Monate verlaengert werden,
   * wenn der Antrag komplex ist — aber nur, wenn die Person binnen eines
   * Monats darueber UND ueber die Gruende unterrichtet wird. Die Spalte haelt
   * beides zusammen: ohne Grund keine Verlaengerung.
   */
  verlaengert_bis timestamptz,
  verlaengert_grund text,

  /** Wer zugeordnet wurde — von einem Menschen, nicht von einem Abgleich. */
  person_id     uuid references person(id),
  ansprechpartner_id uuid,
  bewerbung_id  uuid,

  beantwortet_am timestamptz,
  beantwortet_von uuid references benutzer(id),
  entscheidung  text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint betroffenenanfrage_mandant_uk unique (mandant_id, id),

  constraint betroffenenanfrage_verlaengerung_begruendet check (
    verlaengert_bis is null or btrim(coalesce(verlaengert_grund, '')) <> ''),
  constraint betroffenenanfrage_verlaengerung_hoechstens_zwei_monate check (
    verlaengert_bis is null
    or verlaengert_bis <= eingegangen_am + interval '3 months'),

  /**
   * Beantwortet heisst: mit Zeitpunkt, mit benanntem Menschen und mit
   * Entscheidung. Alle drei oder keines — eine Auskunft, von der niemand sagen
   * kann, wer sie erteilt hat, ist im Streitfall keine.
   */
  constraint betroffenenanfrage_beantwortung_belegt check (
    status not in ('beantwortet', 'abgelehnt')
    or (beantwortet_am is not null and beantwortet_von is not null
        and btrim(coalesce(entscheidung, '')) <> ''))
);

comment on table betroffenenanfrage is
  'LEG-09, Art. 12 Abs. 3 DSGVO. Der EMPFAENGER des oeffentlichen Formulars '
  '/datenschutz/anfrage. Die Monatsfrist ist eine generierte Spalte, keine '
  'Rechnung in einer Abfrage.';

comment on column betroffenenanfrage.frist_am is
  'Art. 12 Abs. 3: ein MONAT, kalendarisch — nicht 30 Tage. Im Februar sind das '
  'drei Tage Unterschied, und drei Tage entscheiden ueber fristgerecht.';

/** Die Arbeitsliste: was laeuft, nach Frist. */
create index betroffenenanfrage_offen_idx
  on betroffenenanfrage (mandant_id, frist_am)
  where status in ('neu', 'identitaet_offen', 'in_bearbeitung');

/**
 * Die Frist setzt die DATENBANK, nicht der Aufrufer (Invariante 5).
 *
 * `at time zone 'Europe/Berlin'` steht ausgeschrieben da und haengt nicht an
 * der Sitzungszone: der Eingangszeitpunkt wird nach Berlin gerechnet, ein
 * Monat kalendarisch addiert und das Ergebnis wieder als `timestamptz`
 * gelesen. Damit ist die Frist derselbe Zeitpunkt, gleich wer sie liest.
 *
 * Ein `default` in der Spalte (30 Tage) gibt es trotzdem — als Netz, falls
 * jemand den Ausloeser je entfernt. Er ist FALSCH (Art. 12 Abs. 3 nennt einen
 * Monat, keine 30 Tage), aber er ist NICHT NULL, und eine zu fruehe Frist
 * warnt zu frueh statt gar nicht.
 */
create function kern.betroffenenanfrage_frist() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.frist_am :=
    ((new.eingegangen_am at time zone 'Europe/Berlin') + interval '1 month')
      at time zone 'Europe/Berlin';
  return new;
end $$;

comment on function kern.betroffenenanfrage_frist() is
  'Art. 12 Abs. 3 DSGVO: ein MONAT kalendarisch, in Berliner Ortszeit gerechnet. '
  'Eine generierte Spalte geht nicht — timestamptz + interval ist nicht immutable.';

create trigger trg_betroffenenanfrage_frist
  before insert or update of eingegangen_am on betroffenenanfrage
  for each row execute function kern.betroffenenanfrage_frist();

create trigger trg_betroffenenanfrage_geaendert
  before update on betroffenenanfrage
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table betroffenenanfrage enable row level security;
alter table betroffenenanfrage force  row level security;

/**
 * **Lesen darf nur, wer Auskuenfte erteilt.** Nicht `system.einstellung_lesen`
 * und nicht `crm.lesen`: in dieser Tabelle steht, wer sich beschwert hat und
 * worueber. Eine Objektleitung, die das liest, erfaehrt von einem
 * Loeschverlangen ihrer eigenen Mitarbeiterin.
 */
create policy t_betroffenenanfrage_lesen on betroffenenanfrage for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('datenschutz.auskunft_erstellen',
                                   app.aktiver_mandant())));

create policy t_betroffenenanfrage_bearbeiten on betroffenenanfrage for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('datenschutz.auskunft_erstellen',
                                        app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('datenschutz.auskunft_erstellen',
                                        app.aktiver_mandant())));

/**
 * **Der Eingangsprinzipal darf ANLEGEN und nicht lesen.**
 *
 * Genau wie bei `formular_eingang` (0016): er nimmt entgegen und kann nichts
 * zurueckholen. Eine Uebernahme der oeffentlichen Flaeche liefert damit keinen
 * Lesezugriff auf die Liste derer, die eine Auskunft verlangt haben — und das
 * ist die Liste, die am meisten verraet.
 *
 * Das Recht ist `formular.schreiben`, dasselbe, das der Prinzipal fuer die
 * Angebotsanfrage haelt. Ein eigenes waere eines, das man ihm anschliessend
 * zusaetzlich gibt: er ist der einzige, der es je braeuchte (K-19).
 */
create policy t_betroffenenanfrage_eingang on betroffenenanfrage for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('formular.schreiben', app.aktiver_mandant())));

grant select, update on betroffenenanfrage to cse_app;
grant insert          on betroffenenanfrage to cse_app;

-- ---------------------------------------------------------------------------
-- Keine Loeschung (Invariante 8)
-- ---------------------------------------------------------------------------
--
-- Erzeugt aus `src/server/db/schema/rls.ts` — `pnpm db:triggers` schreibt neu.
-- Von Hand gesetzte Ausloeser sind der Weg, auf dem 0172 danebenlag (siehe 0175).

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0176)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- betroffenenanfrage (archiv): LEG-09, Art. 12 Abs. 3 DSGVO. Der Nachweis, DASS eine Anfrage einging und wann, ist genau das, was eine Aufsichtsbehoerde sehen will. Eine geloeschte Auskunftsanfrage ist von einer nie gestellten nicht zu unterscheiden — und die Beweislast liegt beim Verantwortlichen.
create trigger trg_betroffenenanfrage_kein_hard_delete
  before delete on betroffenenanfrage
  for each row execute function kern.verhindere_loeschung();
create trigger trg_betroffenenanfrage_kein_truncate
  before truncate on betroffenenanfrage
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on betroffenenanfrage from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
