-- ===========================================================================
-- 0061 — urlaubskonto: Anspruch, Uebertrag, genommene und verplante Tage
--        (01-KERN.md §6.26; EMP-05, EMP-10, LEG-09, D-09)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.26. Wo dieser Text
-- und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- **Der Urlaubsanspruch ist eine Geschaeftsregel, keine Rechnung.** Er steht
-- nicht in der SPEC, und er laesst sich auch nicht herleiten: gesetzlich sind
-- es 24 Werktage bei Sechstagewoche (§ 3 BUrlG), tariflich und vertraglich ist
-- es fast immer mehr, Teilzeit rechnet anders, das Eintrittsjahr rechnet
-- anders (§ 5 BUrlG), und ob und wann ein Uebertrag verfaellt, ist eine
-- betriebliche Regelung. Jede dieser Zahlen hier zu setzen, waere eine
-- Behauptung ueber einen Anspruch, den ein Mensch einklagen kann.
--
-- Deshalb: `anspruch_tage` startet bei 0 und wird EINGETRAGEN, nicht
-- gerechnet; `uebertrag_verfaellt_am` bleibt NULL, bis jemand die Frist nennt;
-- `services/zeit/urlaubskonto.ts` haelt die Schnittstelle und VERWEIGERT die
-- Herleitung, statt eine plausible Zahl zu liefern (K-17, O-18).
-- 0 heisst hier „nicht hinterlegt", nicht „kein Urlaub".
--
-- **`genommen_tage` und `verplant_tage` sind abgeleitet.** Sie kommen aus
-- genehmigten `abwesenheit`-Zeilen (PR 38) und aus nichts anderem. Bis es die
-- Tabelle gibt, gibt es keinen rechtmaessigen Schreiber — und statt das
-- offenzulassen, weist `urlaubskonto_tage_quelle` unten jede Buchung von Hand
-- ab. Eine Spalte, die zwischen zwei PRs von Hand beschreibbar ist, traegt
-- danach Zahlen, die niemand mehr einer Abwesenheit zuordnen kann.
--
-- NICHT in dieser Migration: `abwesenheit`, `abwesenheitsart`, `antrag`
-- (PR 38) und mit ihnen der Ausloeser `urlaubskonto_saldo`, der die beiden
-- abgeleiteten Spalten dann fortschreibt.
-- ===========================================================================

create table urlaubskonto (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  -- D-09: je Beschaeftigung. Zwei Gesellschaften, zwei Urlaubsansprueche —
  -- eine Summe darueber gaebe es nur, wenn ein Arbeitsverhaeltnis sie haette.
  anstellung_id uuid not null,
  jahr          integer not null,

  /**
   * PLATZHALTER, unbelegt (K-17).
   * // TODO(client, O-18): Anspruchsregel je Entitaet und Beschaeftigungsart
   * — gesetzlich 24 Werktage (§ 3 BUrlG), tariflich oder vertraglich? Wie
   * rechnet Teilzeit, wie das Eintritts- und das Austrittsjahr?
   */
  anspruch_tage numeric(12,3) not null default 0,
  /** Resttage aus dem Vorjahr. Uebertragen wird gebucht, nie gerechnet. */
  uebertrag_tage numeric(12,3) not null default 0,
  /**
   * NULL heisst „keine Frist hinterlegt", nicht „verfaellt nie".
   * // TODO(client, O-18): Verfallsdatum des Uebertrags — haeufig der 31.03.,
   * aber das ist eine betriebliche oder tarifliche Regelung und keine
   * Voreinstellung.
   */
  uebertrag_verfaellt_am date,
  /**
   * Zusatzurlaub. **Kein Grundfeld** — der Grund waere in aller Regel eine
   * Gesundheitsangabe (Schwerbehinderung, § 208 SGB IX) und damit Art. 9
   * DSGVO. Die Tage stehen hier, der Grund nirgends.
   */
  zusatz_tage   numeric(12,3) not null default 0,   -- nicht-geld: Tage

  /** Abgeleitet aus genehmigten, bereits vergangenen Abwesenheiten (PR 38). */
  genommen_tage numeric(12,3) not null default 0,
  /** Abgeleitet aus genehmigten Abwesenheiten in der Zukunft (PR 38). */
  verplant_tage numeric(12,3) not null default 0,

  /**
   * Errechnet, nicht gepflegt (EMP-05). Dieselbe Ueberlegung wie bei
   * `stundenkonto.saldo_minuten`: eine zweite Spalte, die jemand
   * fortschreibt, ist die Drift von morgen.
   */
  rest_tage     numeric(12,3) not null generated always as
    (anspruch_tage + uebertrag_tage + zusatz_tage - genommen_tage - verplant_tage) stored,

  /** Jahresabschluss; danach nur noch Korrektur ueber das Folgejahr. */
  abgeschlossen_am timestamptz,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint urlaubskonto_mandant_uk unique (mandant_id, id),
  constraint urlaubskonto_key unique (anstellung_id, jahr),

  constraint uk_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),

  constraint uk_jahr_bereich check (jahr between 2000 and 2100),
  constraint uk_tage_nicht_negativ check (
    anspruch_tage >= 0 and uebertrag_tage >= 0 and zusatz_tage >= 0
    and genommen_tage >= 0 and verplant_tage >= 0)
);

create index urlaubskonto_jahr_idx on urlaubskonto (mandant_id, jahr);
-- OHNE `mandant_id`-Praefix: die Portalansicht des Menschen laeuft ueber alle
-- Beschaeftigungen (EMP-14).
create index urlaubskonto_person_idx on urlaubskonto (anstellung_id, jahr desc);

comment on table urlaubskonto is
  'EMP-05: das Urlaubskonto EINER Beschaeftigung fuer EIN Kalenderjahr. '
  'anspruch_tage = 0 heisst „nicht hinterlegt" (O-18), nicht „kein Urlaub".';
comment on column urlaubskonto.genommen_tage is
  'Abgeleitet aus abwesenheit (PR 38) — heute gibt es keinen Schreiber, und '
  'urlaubskonto_tage_quelle weist jede Buchung von Hand ab.';

-- ---------------------------------------------------------------------------
-- Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `urlaubskonto_abschluss` — ein abgeschlossenes Jahr aendert sich nicht mehr.
 *
 * Dieselbe Einbahn wie beim Stundenkonto und aus demselben Grund: der
 * Resturlaub eines Jahres ist der Uebertrag des naechsten, und wer ihn
 * nachtraeglich bewegt, verschiebt einen Anspruch, ueber den vielleicht schon
 * gesprochen wurde. Der Weg ist eine Korrektur IM FOLGEJAHR.
 */
create function kern.urlaubskonto_abschluss() returns trigger
language plpgsql as $$
begin
  if old.abgeschlossen_am is null then
    if new.abgeschlossen_am is not null then new.abgeschlossen_am := now(); end if;
    return new;
  end if;

  raise exception 'Das Urlaubsjahr ist abgeschlossen'
    using errcode = 'check_violation',
          detail  = format('Abgeschlossen am %s.', old.abgeschlossen_am),
          hint    = 'Eine Korrektur laeuft ueber das Folgejahr (uebertrag_tage).';
end $$;

create trigger trg_urlaubskonto_1_abschluss
  before update on urlaubskonto
  for each row execute function kern.urlaubskonto_abschluss();

/**
 * `urlaubskonto_tage_quelle` — die abgeleiteten Tage haben heute keinen
 * rechtmaessigen Schreiber, also haben sie gar keinen.
 *
 * `genommen_tage` und `verplant_tage` folgen aus genehmigten Abwesenheiten
 * (§6.26). Die Tabelle dafuer kommt mit PR 38. Bis dahin waeren beide Spalten
 * von jedem Schreibpfad aus frei setzbar — und danach stuenden dort Zahlen,
 * zu denen sich keine Abwesenheit finden laesst. Ein Resturlaub, den niemand
 * belegen kann, ist im Streit die schlechtere Haelfte.
 *
 * PR 38 ersetzt diese Funktion durch `urlaubskonto_saldo`, das aus
 * `abwesenheit` fortschreibt; `job:urlaub_abgleich` rechnet dann naechtlich
 * gegen.
 */
create function kern.urlaubskonto_tage_quelle() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.genommen_tage <> 0 or new.verplant_tage <> 0 then
      raise exception 'Genommene und verplante Tage folgen aus Abwesenheiten'
        using errcode = 'check_violation',
              hint    = 'Ein neues Urlaubskonto beginnt bei 0 (EMP-05, PR 38).';
    end if;
    return new;
  end if;

  if new.genommen_tage is distinct from old.genommen_tage
     or new.verplant_tage is distinct from old.verplant_tage then
    raise exception 'Genommene und verplante Tage folgen aus Abwesenheiten'
      using errcode = 'check_violation',
            detail  = 'Sie werden aus genehmigten abwesenheit-Zeilen '
                      || 'fortgeschrieben (01-KERN §6.26), nicht von Hand gebucht.',
            hint    = 'Der Schreibweg entsteht mit PR 38.';
  end if;
  return new;
end $$;

create trigger trg_urlaubskonto_2_tage_quelle
  before insert or update on urlaubskonto
  for each row execute function kern.urlaubskonto_tage_quelle();

-- ---------------------------------------------------------------------------
-- Zeilenschutz (01-KERN §6.26, K-03, K-04, K-18, K-19)
-- ---------------------------------------------------------------------------

alter table urlaubskonto enable row level security;
alter table urlaubskonto force  row level security;

/**
 * Dieselbe Rechteaufteilung wie beim Stundenkonto (0060) und aus demselben
 * Grund: `zeit.lesen` ist an die Rolle `kunde` bindbar, `zeit.konto_lesen`
 * nicht. Der Resturlaub der Reinigungskraft geht den Auftraggeber nichts an
 * (EMP-13).
 */
create policy t_mandant_lesen on urlaubskonto for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.konto_lesen', app.aktiver_mandant())));

create policy t_mandant_schreiben on urlaubskonto for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_mandant_aendern on urlaubskonto for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.konto_lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant()))
              and (abgeschlossen_am is null
                   or (select app.hat_recht('zeit.konto_abschliessen', app.aktiver_mandant())))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on urlaubskonto for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/** Der Mensch sieht seinen eigenen Resturlaub, ueber alle Beschaeftigungen. */
create policy t_person on urlaubskonto for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from anstellung a
                      where a.mandant_id = urlaubskonto.mandant_id
                        and a.id = urlaubskonto.anstellung_id
                        and a.person_id = app.aktuelle_person()));

create policy t_selbst_lesen on urlaubskonto for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and exists (select 1 from anstellung a
                      where a.mandant_id = urlaubskonto.mandant_id
                        and a.id = urlaubskonto.anstellung_id
                        and a.person_id = app.aktuelle_person()));

create policy p_ma_decke on urlaubskonto as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
create policy p_kunde_decke on urlaubskonto as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/** `job:urlaub_abgleich` liest und meldet; korrigiert wird von Hand. */
create policy t_job on urlaubskonto for select to cse_job using (true);

-- Kein DELETE (§6.26).
grant select, insert, update on urlaubskonto to cse_app;
grant select on urlaubskonto to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0061)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- urlaubskonto (archiv): EMP-05, LEG-09. Anspruch, Uebertrag und genommene Tage sind der Nachweis nach § 7 BUrlG; sie zu loeschen macht einen Streit ueber Resturlaub unentscheidbar. Ein abgelaufenes Jahr traegt `abgeschlossen_am`.
create trigger trg_urlaubskonto_kein_hard_delete
  before delete on urlaubskonto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_urlaubskonto_kein_truncate
  before truncate on urlaubskonto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on urlaubskonto from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_urlaubskonto_geaendert_am
  before update on urlaubskonto
  for each row execute function kern.setze_geaendert_am();

create trigger trg_urlaubskonto_audit
  after insert or update or delete on urlaubskonto
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
