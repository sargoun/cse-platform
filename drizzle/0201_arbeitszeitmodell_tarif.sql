-- ===========================================================================
-- 0201 — arbeitszeitmodell und tarifvereinbarung: der KONFIGURIERBARE Teil
--        der Arbeitszeit (EMP-04, TIM-06, TIM-14, LEG-03, O-18, O-50,
--        04-SEITENKARTE §5.24, Invariante 2)
--
-- **Was hier NICHT einstellbar ist.** Die gesetzlichen Grenzen des ArbZG —
-- acht bzw. zehn Stunden (§ 3), 30 bzw. 45 Minuten Pause (§ 4), elf Stunden
-- Ruhezeit (§ 5) — sind KEINE Einstellung (04-SEITENKARTE Z. 1927-1932). Ein
-- Feld, das sie senkt, ist abzuweisen, und zwar nicht in der Oberflaeche,
-- sondern hier: `tv_mindestens_gesetz` laesst einen schwaecheren Wert nicht
-- in die Tabelle. Ein Tarifvertrag kann nur STRENGER sein als das Gesetz;
-- das ist der ganze Sinn von O-50.
--
-- **Zwei offene Geschaeftsfragen, und beide haben Lohnfolge.** O-18
-- (Arbeitszeitmodelle, Sollstundenherleitung, Urlaubsanspruch,
-- Uebertrag/Verfall) und O-50 (kommt aus einem Branchentarif eine strengere
-- Pausen- oder Ruhezeitregel, ab wann) sind unbeantwortet. Deshalb traegt
-- jede Zeile `ist_platzhalter` und die Sollzeitregel den Schluessel `offen`:
-- `services/zeit/sollstunden.ts` antwortet darauf mit `null`, das
-- Stundenkonto fuehrt `soll_minuten = 0`, und 0 heisst dort ausdruecklich
-- „nicht hinterlegt", nicht „nichts geschuldet". Eine geratene Sollzeit
-- faellt nicht auf: das Konto zeigt eine plausible Zahl, jeden Monat,
-- jahrelang.
--
-- **Datiert und ueberschneidungsfrei, wie `anstellung_kondition` (0192).**
-- Eine geaenderte Wochenstundenzahl bewertet sonst stillschweigend jeden
-- abgerechneten Monat neu, in dem das Modell galt. Abgeloest wird eine
-- Fassung von der naechsten, geschlossen ueber `gueltig_bis` — nie durch
-- DELETE (Invariante 8).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. arbeitszeitmodell
-- ---------------------------------------------------------------------------

create table arbeitszeitmodell (
  id         uuid not null default gen_random_uuid(),
  mandant_id uuid not null references mandant(id),

  /**
   * Der Schluessel, auf den `anstellung_kondition.arbeitszeitmodell` (0192)
   * zeigt. **Kein Enum und kein FK**, und beides mit Grund: die Spalte dort
   * ist heute blanker Text mit Default `unbekannt`, und welche Kategorien die
   * Gruppe fuehrt, ist O-18. Ein Enum hier entschied die Frage; ein FK machte
   * jede vorhandene `unbekannt`-Zeile unschreibbar.
   * // TODO(client, O-18): Welche Arbeitszeitmodelle fuehrt die Gruppe je Gesellschaft, und muessen ihre Schluessel den Lohncodes des Lohnsystems (ACC-12) entsprechen?
   */
  schluessel  text not null,
  bezeichnung text not null,

  /** K-16: Mengen sind `numeric(12,3)`. Grundlage der Sollstunden (EMP-04). */
  wochenstunden     numeric(12,3),
  /** Grundlage der Urlaubstagsberechnung (EMP-05, § 3 BUrlG rechnet mit sechs). */
  arbeitstage_woche numeric(12,3),

  /**
   * Welche Umsetzung der `SollstundenRegel`-Schnittstelle gilt
   * (`services/zeit/sollstunden.ts`).
   *
   * `offen` ist die ausgelieferte Regel: sie antwortet `null`. Ein anderer
   * Wert heisst „der Mandant hat eine Regel BENANNT, deren Code noch nicht
   * geschrieben ist" — und genau das soll die Meldung sagen, statt still auf
   * eine Formel zu fallen. Deshalb kein `CHECK` auf ein Vokabular: das
   * Vokabular gehoert O-18, nicht dieser Migration.
   */
  sollzeitregel text not null default 'offen',

  /**
   * Uebertrag und Verfall des Stundenkontos (TIM-13, O-18).
   *
   * `offen` heisst: es wird nichts uebertragen und nichts verfallen gelassen,
   * weil beides eine Entscheidung mit Lohnfolge ist. Eine Verfallsregel, die
   * jemand raet, loescht Ueberstunden — die teuerste Art, eine Annahme zu
   * treffen.
   * // TODO(client, O-18): Werden Stundensalden in den Folgemonat uebertragen, mit welcher Kappung, und nach wie vielen Monaten verfaellt ein Guthaben?
   */
  uebertrag_art            text not null default 'offen',
  /** Kappung des Uebertrags in Minuten. NULL = keine hinterlegt. */
  uebertrag_grenze_minuten integer,
  /** Verfall nach n Monaten. NULL = keiner hinterlegt. */
  verfall_monate           integer,

  /**
   * `true`, solange die Werte nicht bestaetigt sind (O-18). Die Oberflaeche
   * zeigt das mit der Warnmarke aus DESIGN §5 — eine Zahl ohne diese
   * Markierung saehe aus wie eine Entscheidung.
   */
  ist_platzhalter boolean not null default true,

  /** Datiert wie die Kondition (0192): KEIN Default auf „heute". */
  gueltig_ab  date not null,
  gueltig_bis date,

  bestaetigt_am  timestamptz,
  bestaetigt_von uuid references benutzer(id),
  erstellt_am    timestamptz not null default now(),
  erstellt_von   uuid references benutzer(id),
  geaendert_am   timestamptz,
  geaendert_von  uuid references benutzer(id),

  constraint arbeitszeitmodell_pk primary key (id),
  constraint arbeitszeitmodell_mandant_uk unique (mandant_id, id),
  constraint azm_schluessel_nicht_leer check (btrim(schluessel) <> ''),
  constraint azm_bezeichnung_nicht_leer check (btrim(bezeichnung) <> ''),
  constraint azm_zeitraum check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  constraint azm_stunden_plausibel check (
    wochenstunden is null or (wochenstunden >= 0 and wochenstunden <= 168)),
  constraint azm_arbeitstage_plausibel check (
    arbeitstage_woche is null or (arbeitstage_woche >= 0 and arbeitstage_woche <= 7)),
  constraint azm_uebertrag_nicht_negativ check (
    uebertrag_grenze_minuten is null or uebertrag_grenze_minuten >= 0),
  constraint azm_verfall_nicht_negativ check (
    verfall_monate is null or verfall_monate >= 0),
  /**
   * Ein Schluessel, eine gueltige Fassung je Tag. Zwei gleichzeitig gueltige
   * Wochenstundenzahlen sind keine Lage, die ein Mensch gemeint haben kann:
   * jede Sollzeitrechnung muesste raten, und sie wuerde je Abfrage anders
   * raten. Braucht `btree_gist` (0000).
   */
  constraint azm_kein_ueberlapp exclude using gist (
    mandant_id with =,
    schluessel with =,
    daterange(gueltig_ab, gueltig_bis, '[]') with &&),
  /** Bestaetigung ist paarweise — ein Datum ohne Namen belegt nichts. */
  constraint azm_bestaetigung_paarweise check (
    (bestaetigt_am is null) = (bestaetigt_von is null)),
  /**
   * Bestaetigt und Platzhalter schliessen sich aus: die Bestaetigung IST die
   * Antwort auf O-18 fuer diese Zeile.
   */
  constraint azm_bestaetigt_kein_platzhalter check (
    bestaetigt_am is null or not ist_platzhalter)
);

create index arbeitszeitmodell_gueltig_idx
  on arbeitszeitmodell (mandant_id, schluessel, gueltig_ab desc);

comment on table arbeitszeitmodell is
  'EMP-04/TIM-06, O-18: das datierte Arbeitszeitmodell einer Gesellschaft. '
  'Der Schluessel ist das Ziel von anstellung_kondition.arbeitszeitmodell (0192). '
  'Append-only bis auf gueltig_bis, kein DELETE (Invariante 8).';
comment on column arbeitszeitmodell.sollzeitregel is
  'Der Schluessel der SollstundenRegel-Umsetzung (services/zeit/sollstunden.ts). '
  '`offen` antwortet null; ein unbekannter Schluessel wirft mit seinem Namen.';

alter table arbeitszeitmodell enable row level security;
alter table arbeitszeitmodell force  row level security;

/**
 * **Lesen braucht ZWEI Rechte, und das ist kein Versehen.**
 *
 * `stammdaten.verwalten` ist das Recht der Seite (`04-SEITENKARTE` §5.24,
 * `routen.generiert.ts`). `zeit.konto_lesen` ist das Recht dessen, der das
 * Modell BRAUCHT: die Sollzeit eines Monats. Nur das erste zu nehmen hiesse,
 * dass das Stundenkonto das Modell nicht sieht — und dann meldet es
 * „Sollzeit nicht hinterlegt" fuer ein hinterlegtes Modell. Genau dieser
 * stille Fehler (Tor offen, Datenbank leer) ist der Grund, warum Invariante 3
 * RLS als ZWEITE Linie fuehrt und nicht als einzige.
 */
create policy t_azm_lesen on arbeitszeitmodell for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and ((select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant()))
           or (select app.hat_recht('zeit.konto_lesen', app.aktiver_mandant()))));

create policy t_azm_schreiben on arbeitszeitmodell for insert to cse_app
  with check (mandant_id = app.assert_genau_ein_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())));

/** Nur `gueltig_bis` und die Bestaetigung sind aenderbar (Spaltengrant unten). */
create policy t_azm_schliessen on arbeitszeitmodell for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())));

create policy t_azm_gruppe on arbeitszeitmodell for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.personal.lesen')));

/** K-04: das Kundenportal hat mit der Arbeitszeitkonfiguration nichts zu tun. */
create policy p_azm_kunde_decke on arbeitszeitmodell as restrictive for all to cse_app
  using      (app.portal() <> 'kunde')
  with check (app.portal() <> 'kunde');

create policy d_azm_lesen on arbeitszeitmodell for select to cse_definer using (true);

grant select, insert on arbeitszeitmodell to cse_app;
grant update (gueltig_bis, ist_platzhalter, bestaetigt_am, bestaetigt_von,
              geaendert_am, geaendert_von)
      on arbeitszeitmodell to cse_app;
grant select on arbeitszeitmodell to cse_definer;

-- ---------------------------------------------------------------------------
-- 2. tarifvereinbarung — die STRENGERE Regel je Gewerk (O-50)
-- ---------------------------------------------------------------------------

create table tarifvereinbarung (
  id         uuid not null default gen_random_uuid(),
  mandant_id uuid not null references mandant(id),

  /**
   * Das Gewerk, fuer das die Vereinbarung gilt — der Modulschluessel
   * (`reinigung`, `security`, `bau`). Freier Text mit `CHECK`: die drei
   * Gewerke stehen in CLAUDE.md, und ein viertes waere eine
   * Gesellschaftsentscheidung, keine Migration.
   */
  gewerk text not null,
  /**
   * Der Tarifvertrag, auf den sich die Werte berufen — z. B.
   * `Rahmentarifvertrag Gebaeudereinigung`. Ohne Fundstelle ist eine
   * strengere Pause eine Behauptung.
   * // TODO(client, O-50): Welcher Branchentarif gilt je Gesellschaft, welche Pausen- und Ruhezeitregel schreibt er vor, und ab welchem Tag?
   */
  bezeichnung text not null,
  fundstelle  text,

  /**
   * Die Pausen- und Ruhezeitwerte. **Minuten, nicht Stunden** — die Einheit
   * steht im Namen, weil `ruhezeit` als Zahl 11 und als Zahl 660 beide
   * plausibel aussehen.
   *
   * NULL heisst „der Tarif sagt dazu nichts"; dann gilt das Gesetz. Das ist
   * nicht dasselbe wie 0, und 0 waere hier ohnehin abgewiesen.
   */
  pause_ab_6h_minuten integer,
  pause_ab_9h_minuten integer,
  ruhezeit_minuten    integer,

  /** `true`, solange O-50 unbeantwortet ist. */
  ist_platzhalter boolean not null default true,

  gilt_ab  date not null,
  gilt_bis date,

  bestaetigt_am  timestamptz,
  bestaetigt_von uuid references benutzer(id),
  erstellt_am    timestamptz not null default now(),
  erstellt_von   uuid references benutzer(id),
  geaendert_am   timestamptz,
  geaendert_von  uuid references benutzer(id),

  constraint tarifvereinbarung_pk primary key (id),
  constraint tarifvereinbarung_mandant_uk unique (mandant_id, id),
  constraint tv_gewerk check (gewerk in ('reinigung', 'security', 'bau')),
  constraint tv_bezeichnung_nicht_leer check (btrim(bezeichnung) <> ''),
  constraint tv_zeitraum check (gilt_bis is null or gilt_bis >= gilt_ab),

  /**
   * **Der harte Kern dieser Tabelle** (§ 4, § 5 ArbZG, 04-SEITENKARTE
   * Z. 1927-1932).
   *
   * Ein Tarifvertrag darf die gesetzlichen Mindestwerte NUR anheben. Ein
   * eingetragener Wert unter 30 / 45 / 660 Minuten ist kein Tarif, sondern
   * eine Senkung des gesetzlichen Schutzes — und sie wuerde still wirken:
   * `pruefeArbzg` faende dann keinen Verstoss mehr, wo einer ist. Die Zahlen
   * hier sind nicht erfunden, sie stehen im Gesetz.
   */
  constraint tv_mindestens_gesetz check (
    (pause_ab_6h_minuten is null or pause_ab_6h_minuten >= 30)
    and (pause_ab_9h_minuten is null or pause_ab_9h_minuten >= 45)
    and (ruhezeit_minuten is null or ruhezeit_minuten >= 660)),
  /** Eine strengere 6h-Pause darf die 9h-Pause nicht ueberholen. */
  constraint tv_pausen_geordnet check (
    pause_ab_6h_minuten is null or pause_ab_9h_minuten is null
    or pause_ab_9h_minuten >= pause_ab_6h_minuten),
  constraint tv_bestaetigung_paarweise check (
    (bestaetigt_am is null) = (bestaetigt_von is null)),
  constraint tv_bestaetigt_kein_platzhalter check (
    bestaetigt_am is null or not ist_platzhalter),
  /** Eine gueltige Vereinbarung je Gewerk und Tag. */
  constraint tv_kein_ueberlapp exclude using gist (
    mandant_id with =,
    gewerk with =,
    daterange(gilt_ab, gilt_bis, '[]') with &&)
);

create index tarifvereinbarung_gilt_idx
  on tarifvereinbarung (mandant_id, gewerk, gilt_ab desc);

comment on table tarifvereinbarung is
  'O-50, TIM-14, LEG-03: die STRENGERE Pausen- und Ruhezeitregel je Gewerk mit '
  'Geltungsbeginn. tv_mindestens_gesetz laesst keinen Wert unter § 4/§ 5 ArbZG zu — '
  'die gesetzlichen Grenzen sind keine Einstellung (04-SEITENKARTE §5.24).';

alter table tarifvereinbarung enable row level security;
alter table tarifvereinbarung force  row level security;

/**
 * Lesen mit `stammdaten.verwalten` ODER `zeit.lesen`: die ArbZG-Pruefung
 * braucht die strengere Regel, und sie laeuft nicht unter dem Recht der
 * Einstellungsseite. Sonst pruefte der Planer weiter gegen das Gesetz,
 * obwohl ein strengerer Tarif hinterlegt ist — der stille Fall, der auf dem
 * Dienstplan nach „alles in Ordnung" aussieht.
 */
create policy t_tv_lesen on tarifvereinbarung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and ((select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant()))
           or (select app.hat_recht('zeit.lesen', app.aktiver_mandant()))));

create policy t_tv_schreiben on tarifvereinbarung for insert to cse_app
  with check (mandant_id = app.assert_genau_ein_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())));

create policy t_tv_schliessen on tarifvereinbarung for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())));

create policy t_tv_gruppe on tarifvereinbarung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.personal.lesen')));

create policy p_tv_kunde_decke on tarifvereinbarung as restrictive for all to cse_app
  using      (app.portal() <> 'kunde')
  with check (app.portal() <> 'kunde');

create policy d_tv_lesen on tarifvereinbarung for select to cse_definer using (true);

grant select, insert on tarifvereinbarung to cse_app;
grant update (gilt_bis, ist_platzhalter, bestaetigt_am, bestaetigt_von,
              geaendert_am, geaendert_von)
      on tarifvereinbarung to cse_app;
grant select on tarifvereinbarung to cse_definer;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0201)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- arbeitszeitmodell (archiv): EMP-04, TIM-06, LEG-02, O-18. Das Modell ist die Grundlage jeder Sollstunden- und Urlaubsrechnung; eine geloeschte Fassung bewertet stillschweigend jeden Monat neu, in dem sie galt, und der Zeitnachweis nach § 17 MiLoG stimmt danach mit keinem Papier mehr ueberein. Abgeloest wird sie von der naechsten datierten Zeile, geschlossen ueber `gueltig_bis`.
create trigger trg_arbeitszeitmodell_kein_hard_delete
  before delete on arbeitszeitmodell
  for each row execute function kern.verhindere_loeschung();
create trigger trg_arbeitszeitmodell_kein_truncate
  before truncate on arbeitszeitmodell
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on arbeitszeitmodell from cse_app, cse_anon, cse_checkin, cse_job;

-- tarifvereinbarung (archiv): O-50, TIM-14, LEG-03. Die strengere Pausen- und Ruhezeitregel entscheidet, ob eine geplante Schicht rechtmaessig war. Wird die Zeile geloescht, prueft der Planer rueckwirkend gegen das Gesetz statt gegen den Tarif — und jeder frueher gemeldete Verstoss verschwindet, ohne dass sich eine Schicht geaendert hat. Abgeloest wird sie von der naechsten Fassung, geschlossen ueber `gilt_bis`.
create trigger trg_tarifvereinbarung_kein_hard_delete
  before delete on tarifvereinbarung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_tarifvereinbarung_kein_truncate
  before truncate on tarifvereinbarung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on tarifvereinbarung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_arbeitszeitmodell_geaendert_am
  before update on arbeitszeitmodell
  for each row execute function kern.setze_geaendert_am();
create trigger trg_tarifvereinbarung_geaendert_am
  before update on tarifvereinbarung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_arbeitszeitmodell_audit
  after insert or update or delete on arbeitszeitmodell
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_tarifvereinbarung_audit
  after insert or update or delete on tarifvereinbarung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
