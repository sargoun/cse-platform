-- 0180 — `ausgabe_kategorie`, `ausgabe`, `ausgabe_steuer`
-- (05-FINANZEN.md §8.3, §8.5, §1.4, §1.5; FIN-14, FIN-17, ACC-01, ACC-03,
-- REP-05, D-09, EMP-13).
--
-- ===========================================================================
-- Warum diese drei Tabellen zusammen kommen, und was ohne sie haengt
-- ===========================================================================
--
-- Eine Ausgabe ist der Aufwand EINER Gesellschaft, der keine
-- Lieferantenrechnung ist: Barkasse, Tankbeleg, Material fuer einen Auftrag,
-- eine Auslagenerstattung an eine Beschaeftigte. Sie fehlte, und mit ihr
-- fehlten zwei Fremdschluessel, die es im Baum schon gibt:
--
--   rechnungsposition_quelle.ausgabe_id   (0107, quelle_typ = 'material')
--   konto_mapping.ausgabe_kategorie_id    (0126, schluessel_typ = 'aufwand_kategorie')
--
-- Beide Spalten stehen seit ihrer Migration OHNE Fremdschluessel, mit einem
-- ausgeschriebenen Verweis auf „kommt mit PR 54.3b". Die Materialquelle einer
-- Rechnungszeile und die Kontierung eines Aufwands waren damit unverankert:
-- eine Kennung, die auf nichts zeigt, faellt erst dem Buchungsdienst auf.
-- Diese Datei traegt beide nach und hebt die beiden Sperren auf, die bis
-- dahin verhinderten, dass jemand eine solche Zeile ueberhaupt schreibt
-- (`km_typ_hat_eltern`, `bs_herkunft_hat_eltern`).
--
-- ===========================================================================
-- Die Steueraufteilung ist eine eigene Tabelle, und das ist Invariante 1
-- ===========================================================================
--
-- Ein Kassenbeleg mit Kraftstoff zu 19 % und Verpflegung zu 7 % ist der
-- gewoehnliche Fall, nicht die Ausnahme. Mit EINER `steuersatz_gruppe_id` je
-- Ausgabe waere er nicht erfassbar — und die Oberflaeche muesste aus dem
-- Bruttobetrag einen Mischsatz zurueckrechnen. Genau das verbietet
-- Invariante 1: die Umsatzsteuer entsteht je Steuersatzgruppe, nie aus einer
-- Bruttosumme.
--
-- ===========================================================================
-- `anstellung_id` ist die Spalte, um die diese Migration gebaut ist (K-05)
-- ===========================================================================
--
-- Eine Auslagenerstattung ist ein Kostensatz — sie haengt deshalb an der
-- ANSTELLUNG und nie an der Person (D-09, Invariante 9). Damit steht aber
-- Personenbezug in einer Finanztabelle: „wer hat welche Erstattung bekommen"
-- ist etwas anderes als „welche Aufwendungen hatte diese Gesellschaft".
--
-- Vier Schichten halten das auseinander, und keine davon allein genuegt:
--
--   1. `p_ma_ceiling`   — im Mitarbeiterportal nur die eigenen Erstattungen.
--   2. `t_person`       — und erst diese Policy GIBT dem Portal seine Zeilen,
--                         weil `t_mandant` und `t_gruppe` im Personen-Scope
--                         beide falsch sind (K-18).
--   3. `p_gruppe_kein_personenbezug` — in der Gruppenansicht sind
--                         personenbezogene Zeilen unerreichbar, unabhaengig
--                         davon, wie `gruppe.eingang.lesen` gesaet ist.
--   4. Das SPALTENRECHT — `anstellung_id` fehlt im `GRANT`, und gelesen wird
--                         sie nur ueber `app.ausgabe_erstattung_lesen()` mit
--                         `personal.erstattung_lesen`, protokolliert.
--
-- Ein `GRANT SELECT` auf die Tabelle mit anschliessendem `REVOKE SELECT
-- (spalte)` wirkt in PostgreSQL NICHT — das Tabellenrecht deckt weiter jede
-- Spalte. Die Spalte muss von vornherein fehlen; deshalb die ausgeschriebene
-- Liste (wie bei `lieferant` in 0123).

create type ausgabe_status as enum
  ('erfasst', 'freigegeben', 'gebucht', 'abgelehnt');

comment on type ausgabe_status is
  '05-FINANZEN.md §7. Spiegelt eingangsrechnung_status OHNE in_pruefung: eine '
  'Ausgabe wird erfasst und freigegeben, nicht in einem Kreditorenlauf geprueft.';

-- =========================================================================
-- 1. ausgabe_kategorie (§8.5) — der Haken, an dem die Kontierung haengt
-- =========================================================================

create table ausgabe_kategorie (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  schluessel            text not null check (btrim(schluessel) <> ''),
  bezeichnung           text not null check (btrim(bezeichnung) <> ''),

  /**
   * **Der Vorgabewert ist `true`, und das ist keine Vorsicht, sondern O-05.**
   * Welche Aufwandskategorien der Steuerberater erwartet und wie sie auf
   * SKR-Konten abbilden, ist nicht entschieden. Eine Kategorie, die niemand
   * bestaetigt hat, traegt das sichtbar — und die Oberflaeche schreibt es
   * hin, statt ein Konto zu behaupten.
   * TODO(client, O-05): Welche Aufwandskategorien erwartet der Steuerberater,
   * und welches SKR-Konto gilt je Kategorie?
   */
  ist_platzhalter       boolean not null default true,

  /** Aufgeloest wird ueber den Zustand, nie durch Loeschen (Invariante 8). */
  archiviert_am         timestamptz,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint ausgabe_kategorie_mandant_uk unique (mandant_id, id),
  constraint ak_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create unique index ausgabe_kategorie_schluessel_uk
  on ausgabe_kategorie (mandant_id, schluessel) where archiviert_am is null;

comment on table ausgabe_kategorie is
  'ACC-01, FIN-14, FIN-17. Die Aufwandskategorie EINER Gesellschaft. '
  'ist_platzhalter bleibt true, solange O-05 offen ist.';

create trigger trg_ausgabe_kategorie_geaendert
  before update on ausgabe_kategorie
  for each row execute function kern.setze_geaendert_am();

-- =========================================================================
-- 2. ausgabe (§8.5)
-- =========================================================================

create table ausgabe (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  kategorie_id          uuid not null,
  bezeichnung           text not null check (btrim(bezeichnung) <> ''),
  /** Berliner Kalendertag (§1.8) — die Liste sortiert danach. */
  ausgabedatum          date not null,

  /**
   * Geld ist `bigint` Cent (Invariante 1). Die Aufteilung je Steuersatz
   * steht in `ausgabe_steuer`; hier stehen nur die Kopfsummen, und der CHECK
   * verhindert das Trio, das nicht zusammenpasst.
   */
  netto_cent            bigint not null,
  steuer_cent           bigint not null,
  brutto_cent           bigint not null,

  zahlungsmittel        zahlungsmittel not null,
  kasse_id              uuid,

  /**
   * Der Beleg. Nullbar, WEIL die Erfassung mit dem Betrag beginnt und das
   * Dokument nachkommt — aber ab `freigegeben` ist er Pflicht: „keine
   * Buchung ohne Beleg" ist hier erzwungen und nicht behauptet (ACC-03).
   * TODO(client, O-185): Gibt es Ausgaben, fuer die belegfrei gebucht werden
   * darf (Eigenbeleg fuer Trinkgeld oder Parkgebuehr ohne Quittung), und bis
   * zu welchem Betrag?
   */
  beleg_id              uuid,

  /** Gesetzt, wenn die Ausgabe aus einer Lieferantenrechnung stammt. */
  eingangsrechnung_id   uuid,

  /**
   * **D-09: eine Erstattung ist ein Kostensatz, sie haengt an der
   * ANSTELLUNG.** Sie steht nicht im `GRANT` unten und ist nur ueber
   * `app.ausgabe_erstattung_lesen()` lesbar.
   */
  anstellung_id         uuid references anstellung(id),

  /** Die Kostenzuordnung — und der Haken fuer die Weiterberechnung. */
  auftrag_id            uuid,
  projekt_id            uuid,
  objekt_id             uuid,

  /**
   * `true` ⇒ die Ausgabe darf als `quelle_typ = 'material'` auf einer
   * Rechnungszeile erscheinen (FIN-07). Der Teilindex `quelle_ausgabe_uk`
   * aus 0107 sorgt dafuer, dass sie genau EINMAL weiterberechnet wird.
   */
  weiterberechenbar     boolean not null default false,

  status                ausgabe_status not null default 'erfasst',
  freigegeben_von       uuid references benutzer(id),
  freigegeben_am        timestamptz,

  /** Zurueckgewiesen wird mit Grund — nie geloescht (Invariante 8). */
  abgelehnt_grund       text,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint ausgabe_mandant_uk unique (mandant_id, id),

  constraint ausgabe_summe_stimmt check (brutto_cent = netto_cent + steuer_cent),

  /**
   * Bar heisst: aus einer Kasse. Ohne Kasse gaebe es keinen fortgeschriebenen
   * Bestand und damit keine Kassensturzfaehigkeit (GoBD).
   * TODO(client, O-186): Wird eine elektronische Registrierkasse mit TSE nach
   * §146a AO eingesetzt, oder ausschliesslich eine offene Ladenkasse mit
   * Kassenbuch?
   */
  constraint ausgabe_bar_hat_kasse check (zahlungsmittel <> 'bar' or kasse_id is not null),

  /** ACC-03 — keine Buchung ohne Beleg, erzwungen. */
  constraint ausgabe_beleg_ab_freigabe check (
    status not in ('freigegeben', 'gebucht') or beleg_id is not null),

  constraint ausgabe_freigabe_belegt check (
    status not in ('freigegeben', 'gebucht')
    or (freigegeben_von is not null and freigegeben_am is not null)),

  constraint ausgabe_ablehnung_begruendet check (
    status <> 'abgelehnt' or length(btrim(coalesce(abgelehnt_grund, ''))) >= 3),

  constraint ausgabe_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint ausgabe_kategorie_fk foreign key (mandant_id, kategorie_id)
    references ausgabe_kategorie (mandant_id, id),
  constraint ausgabe_beleg_fk foreign key (mandant_id, beleg_id)
    references beleg (mandant_id, id),
  constraint ausgabe_er_fk foreign key (mandant_id, eingangsrechnung_id)
    references eingangsrechnung (mandant_id, id),
  constraint ausgabe_kasse_fk foreign key (mandant_id, kasse_id)
    references kasse (mandant_id, id),
  constraint ausgabe_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  constraint ausgabe_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint ausgabe_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id)
);

comment on table ausgabe is
  'FIN-14, FIN-17, ACC-01, ACC-03, REP-05, D-09, EMP-13. Der Aufwand einer '
  'Gesellschaft, der keine Lieferantenrechnung ist. anstellung_id traegt '
  'Personenbezug und liegt hinter Spaltenrecht und drei Policies (§1.4, §1.5).';

comment on column ausgabe.anstellung_id is
  'D-09, K-05. Eine Erstattung ist ein Kostensatz und haengt an der Anstellung, '
  'nie an der Person. NICHT im GRANT fuer cse_app — lesbar allein ueber '
  'app.ausgabe_erstattung_lesen() mit personal.erstattung_lesen, protokolliert.';

create index ausgabe_datum_idx on ausgabe (mandant_id, ausgabedatum desc);
/** „Was laesst sich noch weiterberechnen" (REP-05, FIN-07). */
create index ausgabe_weiterberechenbar_idx on ausgabe (mandant_id, projekt_id)
  where weiterberechenbar and status = 'freigegeben';
create index ausgabe_offen_idx on ausgabe (mandant_id, status)
  where status in ('erfasst', 'freigegeben');
create index ausgabe_erstattung_idx on ausgabe (mandant_id, anstellung_id)
  where anstellung_id is not null;
create index ausgabe_beleg_idx on ausgabe (mandant_id, beleg_id)
  where beleg_id is not null;
create index ausgabe_kategorie_idx on ausgabe (mandant_id, kategorie_id);

create trigger trg_ausgabe_geaendert
  before update on ausgabe
  for each row execute function kern.setze_geaendert_am();

-- =========================================================================
-- 3. ausgabe_steuer (§8.3)
-- =========================================================================

create table ausgabe_steuer (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  ausgabe_id            uuid not null,

  steuersatz_gruppe_id  uuid not null references steuersatz_gruppe(id),
  /** Eingefrorene Kopien: eine spaetere Satzpflege aendert keinen Beleg. */
  satz_bp               integer not null,
  kategorie             en16931_steuerkategorie not null,

  netto_cent            bigint not null,
  steuer_cent           bigint not null,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint ausgabe_steuer_mandant_uk unique (mandant_id, id),
  constraint as_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),
  constraint as_parent_fk foreign key (mandant_id, ausgabe_id)
    references ausgabe (mandant_id, id)
);

create unique index ausgabe_steuer_gruppe_uk on ausgabe_steuer (ausgabe_id, steuersatz_gruppe_id);
/** Die Vorsteueraggregation. */
create index ausgabe_steuer_gruppe_idx on ausgabe_steuer (mandant_id, steuersatz_gruppe_id);

comment on table ausgabe_steuer is
  'FIN-14, ACC-08, Invariante 1. Die Aufteilung je Steuersatzgruppe — nie ein '
  'Brutto mit einem Mischsatz. Waehrend der Erfassung darf der Kopf noch ohne '
  'Zeilen stehen; ab `gebucht` muessen sie zu ihm passen (Ausloeser unten).';

-- =========================================================================
-- 4. Die Zustaende — und der Schritt, der nicht zurueckgeht
-- =========================================================================

/**
 * Erlaubte Uebergaenge, ausgeschrieben statt implizit:
 *
 *   erfasst      → freigegeben · abgelehnt
 *   freigegeben  → gebucht · abgelehnt
 *   gebucht      → (nichts)
 *   abgelehnt    → (nichts)
 *
 * `gebucht` ist das Ende, weil die Buchung im Journal steht und der
 * Vorsteuerabzug gemeldet ist. Korrigiert wird durch eine Gegenbuchung.
 */
create function fin.ausgabe_uebergang() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status = old.status then return new; end if;

  if old.status in ('gebucht', 'abgelehnt') then
    raise exception
      'Eine Ausgabe im Zustand % wechselt nicht mehr (ACC-06).', old.status
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird durch eine Gegenbuchung, nicht durch Aenderung.';
  end if;

  if not ((old.status = 'erfasst'     and new.status in ('freigegeben', 'abgelehnt'))
       or (old.status = 'freigegeben' and new.status in ('gebucht', 'abgelehnt'))) then
    raise exception 'Uebergang % → % ist nicht vorgesehen.', old.status, new.status
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'freigegeben' and old.status = 'erfasst' then
    new.freigegeben_am := now();
  end if;
  return new;
end $$;

create trigger ausgabe_1_uebergang
  before update on ausgabe
  for each row execute function fin.ausgabe_uebergang();

/**
 * Ab `gebucht` steht die Zeile. Die Erlaubnisliste ist kurz und nennt nur,
 * was NACH der Buchung noch entstehen darf: die Kennung des DATEV-Exports
 * gibt es erst beim Export, und `geaendert_*` ist der Auditblock selbst.
 */
create function fin.ausgabe_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status <> 'gebucht' then return new; end if;
  if new.netto_cent          is distinct from old.netto_cent
  or new.steuer_cent         is distinct from old.steuer_cent
  or new.brutto_cent         is distinct from old.brutto_cent
  or new.ausgabedatum        is distinct from old.ausgabedatum
  or new.kategorie_id        is distinct from old.kategorie_id
  or new.bezeichnung         is distinct from old.bezeichnung
  or new.zahlungsmittel      is distinct from old.zahlungsmittel
  or new.kasse_id            is distinct from old.kasse_id
  or new.beleg_id            is distinct from old.beleg_id
  or new.anstellung_id       is distinct from old.anstellung_id
  or new.eingangsrechnung_id is distinct from old.eingangsrechnung_id
  or new.status              is distinct from old.status then
    raise exception
      'Eine gebuchte Ausgabe ist unveraenderlich (ACC-06, GoBD).'
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird durch eine Gegenbuchung.';
  end if;
  return new;
end $$;

create trigger ausgabe_2_unveraenderlich
  before update on ausgabe
  for each row execute function fin.ausgabe_unveraenderlich();

/**
 * Die Steuerzeilen sind waehrend der Erfassung beweglich und ab `gebucht`
 * fest — dasselbe Muster wie `fin.ers_nach_buchung_fest` in 0123, und aus
 * demselben Grund: die Aufteilung IST der Vorsteuerabzug, und der ist
 * gemeldet.
 */
create function fin.ausgabe_steuer_nach_buchung_fest() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_status ausgabe_status;
begin
  select a.status into v_status
    from public.ausgabe a
   where a.id = coalesce(new.ausgabe_id, old.ausgabe_id);

  if v_status = 'gebucht' then
    raise exception
      'Die Steuerzeilen einer gebuchten Ausgabe stehen fest — sie sind der gemeldete Vorsteuerabzug (§15 UStG).'
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird durch eine Gegenbuchung, nicht durch Aenderung.';
  end if;
  return new;
end $$;

create trigger ausgabe_steuer_nach_buchung_fest
  before insert or update on ausgabe_steuer
  for each row execute function fin.ausgabe_steuer_nach_buchung_fest();

/**
 * Und vor dem Buchen muss die Aufteilung zum Kopf passen.
 *
 * Ein `CONSTRAINT TRIGGER … DEFERRABLE` und kein gewoehnlicher: die
 * Steuerzeilen und der Zustandswechsel kommen in DERSELBEN Transaktion, und
 * in welcher Reihenfolge die Anweisungen darin stehen, soll der Dienst
 * entscheiden duerfen. Geprueft wird am COMMIT.
 */
create function fin.ausgabe_steuer_stimmt() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_netto bigint; v_steuer bigint; v_zeilen integer;
begin
  if new.status <> 'gebucht' then return null; end if;

  select count(*), coalesce(sum(s.netto_cent), 0), coalesce(sum(s.steuer_cent), 0)
    into v_zeilen, v_netto, v_steuer
    from public.ausgabe_steuer s
   where s.ausgabe_id = new.id;

  if v_zeilen = 0 then
    raise exception
      'Eine gebuchte Ausgabe braucht ihre Aufteilung je Steuersatzgruppe (Invariante 1).'
      using errcode = 'restrict_violation',
            hint = 'Ohne sie bliebe ein Brutto, aus dem sich kein Satz mehr ableiten laesst.';
  end if;
  if v_netto <> new.netto_cent or v_steuer <> new.steuer_cent then
    raise exception
      'Die Steuerzeilen ergeben % netto / % Steuer, der Kopf sagt % / %.',
      v_netto, v_steuer, new.netto_cent, new.steuer_cent
      using errcode = 'restrict_violation';
  end if;
  return null;
end $$;

create constraint trigger ausgabe_3_steuer_stimmt
  after insert or update on ausgabe
  deferrable initially deferred
  for each row execute function fin.ausgabe_steuer_stimmt();

-- =========================================================================
-- 5. Die zwei haengenden Spalten, die es seit 0107 und 0126 gibt
-- =========================================================================

/**
 * `rechnungsposition_quelle.ausgabe_id` — der Materialbeleg hinter einer
 * Rechnungszeile (0107, §13). Der Teilindex `quelle_ausgabe_uk` stand schon
 * da und sichert zu, dass eine Ausgabe genau EINMAL weiterberechnet wird;
 * jetzt zeigt die Kennung auch auf eine Zeile, die es gibt.
 */
alter table rechnungsposition_quelle
  add constraint rpq_ausgabe_fk foreign key (mandant_id, ausgabe_id)
    references ausgabe (mandant_id, id);

/**
 * `konto_mapping.ausgabe_kategorie_id` — die Kontierung eines Aufwands
 * (0126, §9.3). `km_typ_hat_eltern` verbot den Typ `aufwand_kategorie`,
 * solange die Elterntabelle fehlte. Sie steht jetzt, also faellt die Sperre
 * und der Fremdschluessel tritt an ihre Stelle.
 */
alter table konto_mapping drop constraint km_typ_hat_eltern;
alter table konto_mapping
  add constraint km_ausgabe_kategorie_fk
    foreign key (mandant_id, ausgabe_kategorie_id)
    references ausgabe_kategorie (mandant_id, id);

/**
 * `buchungssatz.ausgabe_id` — dieselbe Lage in 0127. `kassenbewegung` gibt
 * es weiterhin nicht, deshalb bleibt DIESER Zweig gesperrt: die Sperre wird
 * enger gefasst, nicht aufgehoben.
 */
alter table buchungssatz drop constraint bs_herkunft_hat_eltern;
alter table buchungssatz
  add constraint bs_herkunft_hat_eltern check (herkunft <> 'kassenbewegung');
alter table buchungssatz
  add constraint bs_ausgabe_fk foreign key (mandant_id, ausgabe_id)
    references ausgabe (mandant_id, id);

-- =========================================================================
-- 6. RLS (§1.1–§1.4, K-03, K-04, K-18)
-- =========================================================================

alter table ausgabe_kategorie enable row level security;
alter table ausgabe_kategorie force  row level security;
alter table ausgabe           enable row level security;
alter table ausgabe           force  row level security;
alter table ausgabe_steuer    enable row level security;
alter table ausgabe_steuer    force  row level security;

/** Die K-03-Standardpolicy, dreimal, mit dem Modulrecht `eingang`. */
do $$
declare t text;
begin
  foreach t in array array['ausgabe_kategorie', 'ausgabe', 'ausgabe_steuer'] loop
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('eingang.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('eingang.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.eingang.lesen')))$p$, t);
  end loop;
end $$;

/**
 * Die Kategorie ist rein intern: sie nennt keinen Menschen und keinen Kunden.
 */
create policy p_intern_ceiling on ausgabe_kategorie as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

/**
 * **Die Mitarbeiterdecke (K-04).** Im Mitarbeiterportal genau die eigenen
 * Erstattungen und nie die Aufwendungen der Gesellschaft (EMP-13).
 */
create policy p_ma_ceiling on ausgabe as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));

/**
 * **Auf dem Kind wird die SICHTBARKEIT DES ELTERNTEILS gefragt, nicht seine
 * `anstellung_id`** (§1.4: „through the parent for `ausgabe_steuer`").
 *
 * Zwei Gruende, und der zweite ist der harte. Erstens ist es dieselbe Regel,
 * nur einmal geschrieben: welche Ausgaben ein Mitarbeiterportal sieht,
 * entscheidet `p_ma_ceiling` auf `ausgabe` — und wer die Ausgabe nicht sieht,
 * soll ihre Steueraufteilung nicht sehen. Die Unterabfrage laeuft unter den
 * Policies von `ausgabe`, also entscheidet dort schon dieselbe Decke.
 *
 * Zweitens: `anstellung_id` steht nicht im Spaltenrecht von `cse_app` (§1.5).
 * Eine Policy auf `ausgabe_steuer`, die sie nennt, greift auf eine FREMDE
 * Tabelle zu — und dort prueft PostgreSQL die Spaltenrechte des Aufrufers.
 * Die Fassung mit `a.anstellung_id in (…)` scheiterte deshalb mit
 * `permission denied for table ausgabe` bei JEDEM Lesezugriff auf die
 * Steuerzeilen, auch fuer eine Buchhaltung mit allen Rechten. Nur die eigenen
 * Policies einer Tabelle duerfen ihre gesperrten Spalten lesen.
 */
create policy p_ma_ceiling on ausgabe_steuer as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or exists (select 1 from ausgabe a
                     where a.mandant_id = ausgabe_steuer.mandant_id
                       and a.id = ausgabe_steuer.ausgabe_id));

/**
 * **Die Kundendecke in ihrer entarteten Form** (§1.4): ein Kunde sieht unsere
 * Aufwendungen nie. Sie steht ausgeschrieben da und nicht als „ergibt sich
 * aus `p_ma_ceiling`" — die Aufzaehlungsprobe in `rls.ts` verlangt je Tabelle
 * eine Kunden- ODER eine interne Decke, und „ergibt sich" ist nichts, wogegen
 * sie pruefen kann.
 */
create policy p_kunde_ceiling on ausgabe as restrictive for all to cse_app
  using (app.portal() <> 'kunde') with check (app.portal() <> 'kunde');

create policy p_kunde_ceiling on ausgabe_steuer as restrictive for all to cse_app
  using (app.portal() <> 'kunde') with check (app.portal() <> 'kunde');

/**
 * **Die Gruppendecke auf den Personenbezug** (§1.4, SEC-A3). Eine
 * Gruppensitzung mit jedem `gruppe.*`-Recht liest null Zeilen, die eine
 * `anstellung_id` tragen — unabhaengig davon, wie die Rollenmatrix gesaet
 * ist. `buchungssatz` traegt diese Decke bewusst NICHT: dort frisst sie den
 * Gruppenaufwand, den die Gruppenansicht zeigen soll (§1.4).
 */
create policy p_gruppe_kein_personenbezug on ausgabe as restrictive for all to cse_app
  using (not app.ist_gruppenansicht() or anstellung_id is null);

create policy p_gruppe_kein_personenbezug on ausgabe_steuer
  as restrictive for all to cse_app
  using (not app.ist_gruppenansicht()
         or exists (select 1 from ausgabe a
                     where a.mandant_id = ausgabe_steuer.mandant_id
                       and a.id = ausgabe_steuer.ausgabe_id));

/**
 * **K-18: die Subjektpolicy, die dem Mitarbeiterportal seine Zeilen GIBT.**
 *
 * Im Personen-Scope ist `t_mandant` falsch (es gibt keinen aktiven Mandanten)
 * und `t_gruppe` ebenso (die Person haelt kein `gruppe.*`). Ohne diese dritte,
 * PERMISSIVE Policy lese die Arbeiterin gar nichts — und das waere kein
 * Fehler, den man sieht, sondern eine leere Liste, die nach „keine
 * Erstattungen" aussieht. Nur `select`; es gibt keine Schreibentsprechung.
 */
create policy t_person on ausgabe for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));

/**
 * Auf dem Kind wieder ueber das Elternteil (§1.4) — und aus demselben Grund
 * wie oben: im Personen-Scope gibt `t_person` auf `ausgabe` genau die eigenen
 * Zeilen frei, also ist „das Elternteil ist sichtbar" wortgleich mit „die
 * Ausgabe gehoert mir". Eine zweite Fassung derselben Regel waere die, die
 * beim naechsten Mal abweicht — und sie koennte `anstellung_id` gar nicht
 * lesen (§1.5).
 */
create policy t_person on ausgabe_steuer for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from ausgabe a
                      where a.mandant_id = ausgabe_steuer.mandant_id
                        and a.id = ausgabe_steuer.ausgabe_id));

grant select, insert, update on ausgabe_kategorie to cse_app;
grant select, insert, update on ausgabe_steuer    to cse_app;

-- =========================================================================
-- 7. Das Spaltenrecht auf `ausgabe` (§1.5, K-05)
-- =========================================================================

/**
 * `anstellung_id` FEHLT in dieser Liste, und darin besteht der Schutz. Ein
 * `GRANT SELECT` auf die ganze Tabelle mit nachfolgendem `REVOKE SELECT
 * (anstellung_id)` waere wirkungslos — PostgreSQL laesst das Tabellenrecht
 * weiter jede Spalte decken.
 *
 * `insert`/`update` decken die Spalte weiterhin: eine Erstattung muss
 * ERFASSBAR sein, und wer sie erfasst, kennt den Menschen ohnehin. Gelesen
 * wird sie nur ueber das Tor unten, und der Lesezugriff steht im `audit_log`.
 */
revoke select on ausgabe from cse_app;
grant select (id, mandant_id, kategorie_id, bezeichnung, ausgabedatum,
              netto_cent, steuer_cent, brutto_cent, zahlungsmittel, kasse_id,
              beleg_id, eingangsrechnung_id, auftrag_id, projekt_id, objekt_id,
              weiterberechenbar, status, freigegeben_von, freigegeben_am,
              abgelehnt_grund,
              erstellt_von_art, erstellt_von, erstellt_von_agent_id,
              erstellt_von_dienst, erstellt_am, geaendert_am,
              geaendert_von_art, geaendert_von)
  on ausgabe to cse_app;
grant insert, update on ausgabe to cse_app;

/**
 * Der schmale Leser fuer die Erstattung — ein Definer, der das Recht NOCH
 * EINMAL prueft, weil er nicht unter der Policy laeuft.
 *
 * `personal.erstattung_lesen` und nicht `eingang.lesen`: „welche Beschaeftigte
 * hat welche Erstattung bekommen" ist Personendatum unter D-09 §6, die
 * Ausgabenliste selbst ist es nicht. Der Zugriff wird protokolliert, weil ein
 * Lesezugriff auf Personenbezug nachvollziehbar sein muss (SEC-A9).
 *
 * Die Funktion gibt eine MENGE zurueck und keinen Wert: ohne Recht ist sie
 * leer, und leer heisst dasselbe wie „diese Ausgabe ist keine Erstattung".
 * Genau so soll es sein — ein `null` mit Unterschied waere die Auskunft, die
 * das Recht verweigert (AUT-06).
 */
create function app.ausgabe_erstattung_lesen(p_ausgabe uuid)
returns table (anstellung_id uuid, person_id uuid, personalnummer text)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid; v_anstellung uuid;
begin
  select a.mandant_id, a.anstellung_id into v_mandant, v_anstellung
    from public.ausgabe a where a.id = p_ausgabe;
  if v_mandant is null or v_anstellung is null then return; end if;
  if not (v_mandant = any (app.sichtbare_mandanten())) then return; end if;
  if not app.hat_recht('personal.erstattung_lesen', v_mandant) then return; end if;

  perform app.protokolliere('ausgabe.erstattung_gelesen', 'ausgabe',
                            p_ausgabe::text, null, null, v_mandant);

  return query
    select an.id, an.person_id, an.personalnummer
      from public.anstellung an where an.id = v_anstellung;
end $$;

alter function app.ausgabe_erstattung_lesen(uuid) owner to cse_definer;
revoke execute on function app.ausgabe_erstattung_lesen(uuid) from public;
grant execute on function app.ausgabe_erstattung_lesen(uuid) to cse_app;

/**
 * Und was der Definer dafuer braucht: `ausgabe.anstellung_id` und die
 * Anstellungszeile selbst. `cse_definer` umgeht RLS nicht von sich aus —
 * Recht UND Policy, wie D-388 es festhaelt.
 */
grant select on ausgabe to cse_definer;
create policy d_ausgabe_lesen on ausgabe for select to cse_definer
  using (mandant_id = any (app.sichtbare_mandanten()));

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0180)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- ausgabe_kategorie (archiv): ACC-01, FIN-14, §147 AO. An der Kategorie haengt die Kontierung jeder Ausgabe, die auf sie zeigt; sie zu loeschen macht jede Buchung darauf unlesbar. Aufgeloest wird ueber `archiviert_am`.
create trigger trg_ausgabe_kategorie_kein_hard_delete
  before delete on ausgabe_kategorie
  for each row execute function kern.verhindere_loeschung();
create trigger trg_ausgabe_kategorie_kein_truncate
  before truncate on ausgabe_kategorie
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on ausgabe_kategorie from cse_app, cse_anon, cse_checkin, cse_job;

-- ausgabe (archiv): FIN-14, FIN-17, ACC-03, ACC-06, §147 AO. Die Ausgabe traegt den Vorsteuerabzug und den Aufwand einer Gesellschaft; eine weiterberechnete Ausgabe ist zudem die Quelle einer Rechnungszeile. Sie zu loeschen nimmt der Voranmeldung ihre Grundlage und liesse eine Rechnungszeile ohne Beleg zurueck. Zurueckgewiesen wird ueber `abgelehnt` mit Grund.
create trigger trg_ausgabe_kein_hard_delete
  before delete on ausgabe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_ausgabe_kein_truncate
  before truncate on ausgabe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on ausgabe from cse_app, cse_anon, cse_checkin, cse_job;

-- ausgabe_steuer (append): FIN-14, ACC-08, §15 UStG, Invariante 1. Die Aufteilung nach Steuersaetzen IST der Vorsteuerabzug — ohne sie steht ein Bruttobetrag da, aus dem sich kein Satz mehr ableiten laesst. Sie zu loeschen aenderte die Voranmeldung ohne Spur.
create trigger trg_ausgabe_steuer_kein_hard_delete
  before delete on ausgabe_steuer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_ausgabe_steuer_kein_truncate
  before truncate on ausgabe_steuer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on ausgabe_steuer from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
