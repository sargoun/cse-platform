-- ===========================================================================
-- 0052 — zeit_einwand: der EINE Schreibweg, den ein Mitarbeitender in der
--        Zeitdomaene besitzt (01-KERN.md §6.27; EMP-07, TIM-11, TIM-13,
--        LEG-02, SEC-A9)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.27. Wo dieser Text
-- und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- **Warum es diese Tabelle gibt, und nicht einfach ein Bearbeitungsrecht.**
-- EMP-07 ist kategorisch: der Mensch aendert seinen Zeiteintrag NIE selbst. Der
-- naheliegende Entwurf — „Mitarbeitende duerfen ihre eigenen Zeiten
-- korrigieren, das spart der Planung Arbeit" — kostet genau das, wofuer der
-- Datensatz existiert: seinen Beweiswert. Ein § 17-MiLoG-Nachweis, den die
-- betroffene Person selbst geschrieben hat, ist im Lohnstreit und vor der
-- Gewerbeaufsicht kein Nachweis mehr, sondern eine Behauptung. Der Einwand ist
-- deshalb ein VORGANG mit Spur — eingereicht, entschieden, begruendet — und
-- keine stille Aenderung.
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **`zeiteintrag_id` ist nullbar** — `art = 'eintrag_fehlt'` ist genau der
--     Fall, in dem es keinen Eintrag gibt. Eine NOT-NULL-Spalte zwaenge den
--     haeufigsten Einwand ueberhaupt („ich habe gearbeitet, es steht nichts
--     da") in eine Form, die er nicht hat.
--  2. **Die behauptete Zeit steht in `behauptet_*`, nie in einer
--     massgeblichen Spalte** (Invariante 5, §1.8). Sie wird erst durch die
--     ENTSCHEIDUNG eines benannten Menschen zu einer Korrektur, und die traegt
--     `zeiteintrag_korrektur`.
--  3. **Kein DELETE.** Ein zurueckgezogener Einwand ist
--     `status = 'zurueckgezogen'` und bleibt stehen: dass jemand etwas gemeldet
--     und wieder zurueckgenommen hat, ist im Streit eine Tatsache und keine
--     Datenpflege.
--
-- NICHT in dieser Migration: `stundenkonto_bewegung` (PR 37) — die Spalte
-- `korrektur_bewegung_id` steht hier, ihr Fremdschluessel kommt dort.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (01-KERN §4)
-- ---------------------------------------------------------------------------

/** Woran sich der Einwand richtet (EMP-07). */
create type einwand_art as enum
  ('eintrag_fehlt','zeit_falsch','pause_falsch','zuordnung_falsch','sonstiges');

/**
 * PLACEHOLDER (01-KERN §4). EMP-07 nennt kein Entscheidungsvokabular; die
 * fuenf Zustaende sind die kleinste Menge, mit der sich ein Vorgang fuehren
 * laesst. `teilweise_anerkannt` steht und faellt mit O-143.
 * // TODO(client, O-143): Darf ein Zeit-Einwand teilweise anerkannt werden,
 * und braucht eine solche Teilentscheidung einen eigenen Zustand?
 */
create type einwand_status as enum
  ('offen','in_pruefung','anerkannt','teilweise_anerkannt','abgelehnt','zurueckgezogen');

-- ---------------------------------------------------------------------------
-- 2. zeit_einwand (01-KERN §6.27)
-- ---------------------------------------------------------------------------

create table zeit_einwand (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  -- D-09: der Einwand betrifft EINE Beschaeftigung. Wer in zwei Gesellschaften
  -- arbeitet, hat zwei Zeitkonten und damit zwei getrennte Einwandwege.
  anstellung_id uuid not null,

  /**
   * NULLBAR, mit Absicht (§6.27): `art = 'eintrag_fehlt'` ist der Fall ohne
   * Eintrag. Die Bedingung unten sorgt dafuer, dass das die EINZIGE Art ist,
   * die ohne Bezug auskommt — ein Einwand gegen nichts waere sonst eine Karte
   * im Eingang, die niemand aufloesen kann.
   */
  zeiteintrag_id uuid,

  art           einwand_art not null,
  -- Der BERLINER Kalendertag (K-11), nie der UTC-Tag: eine Nachtschicht
  -- 22:00–06:00 gehoert sonst zwei Tagen an, von denen einer nicht stattfand.
  betrifft_datum date not null,

  /**
   * Was der Mensch behauptet. UTC gespeichert, Berlin angezeigt
   * (Invariante 2) — und niemals Grundlage einer Buchung ohne Entscheidung
   * (Invariante 5).
   */
  behauptet_beginn        timestamptz,
  behauptet_ende          timestamptz,
  behauptet_pause_minuten integer,

  -- Pflichtfeld, ohne Mindestlaenge: „Krank" ist eine Begruendung, und eine
  -- Zeichenzahl ist keine Qualitaetskontrolle (dieselbe Entscheidung wie auf
  -- `zeiteintrag_korrektur`, 0036).
  begruendung   text not null,

  status        einwand_status not null default 'offen',

  eingereicht_am timestamptz not null default now(),
  /**
   * NOT NULL. Es gibt keinen kontenlosen Schreibpfad in diese Tabelle
   * (01-KERN §2): der Check-in-Pfad hat keine Sitzung und schreibt hier nicht,
   * und ein Einwand ohne Absender waere im Streit wertlos.
   */
  eingereicht_von_benutzer_id uuid not null references benutzer(id),

  entschieden_von uuid references benutzer(id),
  entschieden_am  timestamptz,
  entscheidung_begruendung text,

  /**
   * Die Gegenbuchung, wenn die Entscheidung einen bereits gesperrten Monat
   * betrifft (EMP-04, §12.2). Elterntabelle `stundenkonto_bewegung` kommt mit
   * PR 37; die Spalte steht hier, weil die Struktur ab der ersten Migration
   * steht (§19).
   */
  korrektur_bewegung_id uuid,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  primary key (id),
  constraint zeit_einwand_mandant_uk unique (mandant_id, id),

  constraint ze_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint ze_zeiteintrag_fk foreign key (mandant_id, zeiteintrag_id)
    references zeiteintrag (mandant_id, id),

  /**
   * Ein Einwand ohne Bezug ist nur als `eintrag_fehlt` sinnvoll.
   *
   * Ohne diese Bedingung liesse sich „die Pause ist falsch" ohne Angabe des
   * Eintrags einreichen, dessen Pause gemeint ist — und die Planung haette
   * eine Karte im Eingang, zu der es nichts zu entscheiden gibt.
   */
  constraint ze_bezug_ausser_eintrag_fehlt check (
    zeiteintrag_id is not null or art = 'eintrag_fehlt'),
  constraint ze_fenster check (
    behauptet_ende is null or behauptet_beginn is null
    or behauptet_ende > behauptet_beginn),
  constraint ze_pause_nicht_negativ check (
    behauptet_pause_minuten is null or behauptet_pause_minuten >= 0),
  constraint ze_begruendung_nicht_leer check (btrim(begruendung) <> ''),
  /**
   * Eine Entscheidung ohne Begruendung ist keine (TIM-11). Und sie traegt
   * Zeitpunkt und Urheber — sonst steht im Streit nur, DASS abgelehnt wurde.
   */
  constraint ze_entscheidung_begruendet check (
    status not in ('anerkannt','teilweise_anerkannt','abgelehnt')
    or (entscheidung_begruendung is not null
        and btrim(entscheidung_begruendung) <> ''
        and entschieden_von is not null
        and entschieden_am is not null)),
  constraint ze_entscheidung_paarweise check (
    (entschieden_am is null) = (entschieden_von is null))
);

-- Die Arbeitsliste des Planers — der Grund, warum EMP-07 „reaching the
-- planner" heisst und nicht „gespeichert".
create index einwand_offen_idx on zeit_einwand (mandant_id, status, eingereicht_am)
  where status in ('offen','in_pruefung');
-- Die Portalansicht des Menschen. OHNE `mandant_id`-Praefix, mit Absicht: die
-- kombinierte Sicht (EMP-14) laeuft ueber alle Beschaeftigungen.
create index einwand_anstellung_idx on zeit_einwand (anstellung_id, betrifft_datum desc);
create index einwand_zeiteintrag_idx on zeit_einwand (zeiteintrag_id)
  where zeiteintrag_id is not null;

comment on table zeit_einwand is
  'EMP-07: der Einwand gegen einen Zeiteintrag — die einzige Schreiboperation, '
  'die ein Mitarbeitender in der Zeitdomaene besitzt. Ein Vorgang mit Spur, '
  'keine stille Aenderung.';
comment on column zeit_einwand.behauptet_beginn is
  'Behauptet, nicht massgeblich (Invariante 5). Wird erst durch eine '
  'Entscheidung und eine zeiteintrag_korrektur zu einer Zeit.';

-- ---------------------------------------------------------------------------
-- 3. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `einwand_status_maschine` — Zustaende gehen vorwaerts, Zeitpunkte gehoeren
 * dem Server.
 *
 * Beides in einem Ausloeser, weil es dieselbe Frage ist: was darf sich beim
 * Uebergang bewegen. `DEFAULT now()` genuegt nicht — ein Default greift nur,
 * wenn die Spalte WEGGELASSEN wird, und ein INSERT, der `eingereicht_am`
 * mitschickt, setzte einen beliebigen Zeitpunkt. Der zaehlt hier: er ist die
 * Frist, an der sich „unverzueglich gemeldet" bemisst.
 *
 * **Der Entscheider ist nicht der Betroffene.** Das ist das Geschwister von
 * `zk_nicht_selbst` (0036) und nicht dieselbe Regel an zweiter Stelle: jener
 * Ausloeser verhindert, dass jemand seine eigene KORREKTUR schreibt; dieser
 * verhindert, dass jemand seinen eigenen Einwand ENTSCHEIDET. Ohne ihn liesse
 * sich ein Einwand geraeuschlos selbst ablehnen — es entstuende keine
 * Korrektur, also feuerte `zk_nicht_selbst` nie, und im Eingang der Planung
 * waere die Karte verschwunden.
 */
create function kern.zeit_einwand_status() returns trigger
language plpgsql as $$
declare v_betroffene uuid;
begin
  if tg_op = 'INSERT' then
    new.eingereicht_am := now();
    -- Ein Einwand beginnt offen. Alles andere waere ein Vorgang, der schon
    -- entschieden auf die Welt kommt.
    if new.status not in ('offen','in_pruefung') then
      raise exception 'Ein Einwand wird offen eingereicht'
        using errcode = 'check_violation',
              detail  = format('Status %s ist kein Eingangszustand.', new.status);
    end if;
    if new.entschieden_am is not null then new.entschieden_am := now(); end if;
    return new;
  end if;

  -- Ein Endzustand ist einer. Wer ihn aufheben koennte, koennte eine
  -- Entscheidung ungeschehen machen, nachdem der Lohn gezahlt wurde.
  if old.status in ('anerkannt','teilweise_anerkannt','abgelehnt','zurueckgezogen')
     and new.status is distinct from old.status then
    raise exception 'Ein entschiedener Einwand aendert seinen Zustand nicht mehr'
      using errcode = 'check_violation',
            detail  = format('%s → %s.', old.status, new.status),
            hint    = 'Ein neuer Sachverhalt ist ein neuer Einwand.';
  end if;

  -- Was eingereicht wurde, bleibt eingereicht: die Behauptung des Menschen ist
  -- der Gegenstand des Vorgangs und nicht sein Verhandlungsspielraum.
  if new.anstellung_id  is distinct from old.anstellung_id
     or new.zeiteintrag_id is distinct from old.zeiteintrag_id
     or new.art            is distinct from old.art
     or new.betrifft_datum is distinct from old.betrifft_datum
     or new.behauptet_beginn is distinct from old.behauptet_beginn
     or new.behauptet_ende   is distinct from old.behauptet_ende
     or new.behauptet_pause_minuten is distinct from old.behauptet_pause_minuten
     or new.begruendung    is distinct from old.begruendung
     or new.eingereicht_am is distinct from old.eingereicht_am
     or new.eingereicht_von_benutzer_id is distinct from old.eingereicht_von_benutzer_id then
    raise exception 'Am eingereichten Einwand aendert sich nichts'
      using errcode = 'check_violation',
            hint    = 'Zu entscheiden sind status, entscheidung_begruendung und '
                      || 'korrektur_bewegung_id.';
  end if;

  if new.status in ('anerkannt','teilweise_anerkannt','abgelehnt')
     and old.status not in ('anerkannt','teilweise_anerkannt','abgelehnt') then
    new.entschieden_am := now();
    select a.person_id into v_betroffene
      from anstellung a where a.id = new.anstellung_id;
    if exists (select 1 from benutzer b
                where b.id = new.entschieden_von and b.person_id = v_betroffene) then
      raise exception 'Ueber den eigenen Einwand entscheidet man nicht'
        using errcode = 'check_violation',
              detail  = 'EMP-07: die Aufzeichnung behaelt ihren Beweiswert nur, '
                        || 'wenn die betroffene Person sie nicht selbst bewegt.',
              hint    = 'Die Entscheidung trifft die Planung.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_zeit_einwand_status
  before insert or update on zeit_einwand
  for each row execute function kern.zeit_einwand_status();

-- ---------------------------------------------------------------------------
-- 4. Zeilenschutz (01-KERN §6.27, K-03, K-04, K-18)
-- ---------------------------------------------------------------------------

alter table zeit_einwand enable row level security;
alter table zeit_einwand force  row level security;

/**
 * Lesen mit `zeit.lesen`, schreiben mit `zeit.einwand_entscheiden` — und das
 * ist eine bewusste Abweichung von der K-03-Standardform, die
 * `<modul>.schreiben` nennt.
 *
 * Der Grund steht in 01-KERN §6.27: „Entscheidung erfordert
 * `zeit.einwand_entscheiden`." Wer Zeiten erfassen darf (`zeit.schreiben`),
 * darf damit noch lange nicht ueber den Einwand eines Kollegen befinden; das
 * sind zwei Entscheidungen und zwei Rechte. Der Schreibweg des Mitarbeitenden
 * laeuft nicht ueber diese Policy, sondern ueber `t_selbst_einreichen`.
 */
create policy t_mandant on zeit_einwand for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.einwand_entscheiden', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on zeit_einwand for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/**
 * **Die einzige Schreiboperation eines Mitarbeitenden in dieser Domaene**
 * (EMP-07).
 *
 * Sie ist `INSERT` und hat kein UPDATE-Gegenstueck: einen eingereichten
 * Einwand zurueckzuziehen ist eine Entscheidung der Planung
 * (`status = 'zurueckgezogen'`), nicht ein zweiter Griff des Menschen in
 * seinen eigenen Vorgang.
 *
 * Geschrieben wird im MANDANTEN-Scope, nicht im Personen-Scope: dort ist
 * `app.aktiver_mandant()` NULL und keine Schreibpolicy trifft zu (K-18). Der
 * Dienst betritt `withTenant` mit dem Mandanten der betroffenen Anstellung neu
 * — serverseitig aufgeloest, nie aus der Anfrage (K-02, Invariante 3).
 */
create policy t_selbst_einreichen on zeit_einwand for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and exists (select 1 from anstellung a
                           where a.mandant_id = zeit_einwand.mandant_id
                             and a.id = zeit_einwand.anstellung_id
                             and a.person_id = app.aktuelle_person()));

/** Der Mensch sieht seine eigenen Einwaende, ueber alle Beschaeftigungen. */
create policy t_person on zeit_einwand for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from anstellung a
                      where a.mandant_id = zeit_einwand.mandant_id
                        and a.id = zeit_einwand.anstellung_id
                        and a.person_id = app.aktuelle_person()));

create policy p_ma_decke on zeit_einwand as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
/** Der Einwand ist ein Beschaeftigungsvorgang, kein Kundendokument (EMP-13). */
create policy p_kunde_decke on zeit_einwand as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

grant select, insert, update on zeit_einwand to cse_app;

-- ---------------------------------------------------------------------------
-- 5. EMP-07 als Eigenschaft, nicht als Zusage der Oberflaeche
-- ---------------------------------------------------------------------------

/**
 * **Ein Mitarbeitender aendert einen `zeiteintrag` unter KEINER
 * Rollenkonfiguration.**
 *
 * 0034 traegt auf `zeiteintrag` eine `t_person`-Policy, die nur liest, und die
 * Decke `p_ma_decke`, die auf die eigenen Zeilen begrenzt. Beides genuegt
 * nicht: `t_mandant` ist `for all`, und ein Mandant, der der Rolle
 * `mitarbeiter` einmal `zeit.schreiben` bindet — versehentlich oder mit einer
 * gut gemeinten Begruendung —, oeffnet damit den UPDATE-Weg auf die eigenen
 * Zeilen. Danach steht in der Datenbank ein § 17-Nachweis, den die betroffene
 * Person selbst bewegt hat, und niemandem faellt es auf.
 *
 * Eine RESTRIKTIVE Policy ist der Riegel, der unabhaengig von jeder
 * Rechtevergabe haelt: restriktive Policies werden UND-verknuepft, ein
 * zusaetzliches Recht kann sie nicht ueberstimmen. Der Weg des Menschen ist
 * `zeit_einwand`, und das ist damit keine Zusage der Oberflaeche mehr,
 * sondern eine Eigenschaft des Schemas.
 *
 * INSERT bleibt bewusst aussen vor: der Check-in schreibt ueber `cse_definer`
 * (K-08) und nicht ueber `cse_app`, und die Nacherfassung ist ohnehin ein
 * Planerweg. Wer hier auch INSERT verboete, verboete nichts, was heute
 * moeglich waere — und verdeckte, dass genau EIN Weg gemeint ist.
 */
create policy p_ma_kein_update on zeiteintrag as restrictive for update to cse_app
  using      (app.portal() <> 'mitarbeiter')
  with check (app.portal() <> 'mitarbeiter');

comment on policy p_ma_kein_update on zeiteintrag is
  'EMP-07: kein Bearbeitungsweg fuer Mitarbeitende, unabhaengig von jeder '
  'Rechtevergabe. Der Weg ist zeit_einwand (0052).';

-- ---------------------------------------------------------------------------
-- 6. Der Fremdschluessel, den 0036 aufgeschoben hat (§14.4)
-- ---------------------------------------------------------------------------

/**
 * 0036 §5 hat ihn woertlich hinterlegt und auf diese Tabelle gewartet. Er ist
 * das, was „diese Korrektur beantwortet jenen Einwand" nachweisbar macht statt
 * behauptet — die Bruecke zwischen dem, was der Mensch gemeldet hat, und dem,
 * was die Planung daraufhin geschrieben hat (EMP-07, TIM-11).
 */
alter table zeiteintrag_korrektur add constraint zk_einwand_fk
  foreign key (mandant_id, zeit_einwand_id)
  references zeit_einwand (mandant_id, id);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0052)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeit_einwand (archiv): EMP-07, LEG-02. Dass jemand eine Abweichung gemeldet — und vielleicht zurueckgezogen — hat, ist im Lohnstreit eine Tatsache und keine Datenpflege. Zurueckgenommen wird ueber `status`, nie durch DELETE.
create trigger trg_zeit_einwand_kein_hard_delete
  before delete on zeit_einwand
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeit_einwand_kein_truncate
  before truncate on zeit_einwand
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeit_einwand from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_zeit_einwand_geaendert_am
  before update on zeit_einwand
  for each row execute function kern.setze_geaendert_am();

create trigger trg_zeit_einwand_audit
  after insert or update or delete on zeit_einwand
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
