/**
 * 0127 — Die Periode und der Buchungssatz (ACC-01, ACC-03, ACC-06, ACC-08,
 * LEG-01, PR 58).
 *
 * `05-FINANZEN.md` §9.1 (`periode`), §9.2 (`buchungssatz`), §3.1.
 *
 * **Der Buchungssatz ist die Zeile, die spaeter im EXTF-Stapel steht** — und
 * die Zeile, auf die sich ein Betriebspruefer stuetzt. Alles an dieser
 * Migration folgt daraus:
 *
 *   1. **Eine Buchung geht auf.** Nicht die Datei, nicht der Monat: JEDE
 *      wirtschaftliche Buchung. Eine Rechnung mit zwei Steuersaetzen ergibt
 *      drei oder mehr Zeilen; sie teilen sich `buchung_id`, und ein
 *      aufgeschobener Constraint-Ausloeser prueft am Ende der Transaktion,
 *      dass Soll gleich Haben ist. Ein Ungleichgewicht erst in der fertigen
 *      Exportdatei zu finden, hiesse: es ist nicht mehr zuzuordnen.
 *
 *   2. **`konto` darf NULL sein — auf einer FESTGESCHRIEBENEN Zeile nicht.**
 *      Das ist der Platz, an dem eine fehlende Kontenzuordnung (O-05)
 *      sichtbar bleibt, ohne dass die Rechnung am Festschreiben scheitert.
 *      Aber eine Zeile ohne Konto darf nie in eine Exportdatei geraten:
 *      geliefert, unbrauchbar, und Monate spaeter beim Steuerberater
 *      entdeckt. Der Ausfuhrindex schliesst sie deshalb aus, der CHECK
 *      verbietet die Festschreibung, und die Periode laesst sich nicht
 *      schliessen, solange eine offen ist.
 *
 *   3. **Kein hartes Loeschen, keine Aenderung nach der Festschreibung**
 *      (Invariante 8, GoBD). Korrigiert wird durch Gegenbuchung —
 *      `storniert_durch_id` zeigt darauf.
 *
 * **Was hier NICHT steht.** `datev_export` und die beiden Zeilentabellen
 * kommen mit PR 60, `beleg_verknuepfung` mit PR 59, `ausgabe` und
 * `kassenbewegung` mit PR 54.3b. Die Spalten, die auf diese Tabellen zeigen,
 * stehen schon hier — mit CHECKs, die ihren Gebrauch bis dahin verbieten,
 * genau wie `km_typ_hat_eltern` in 0126. Eine Spalte ohne Elterntabelle ist
 * sonst ein Verweis ins Leere, den erst der erste echte Lauf bemerkt
 * (der Befund aus PR 52.1).
 */

-- =========================================================================
-- 1. Die Vokabulare (§3.1)
-- =========================================================================

create type periode_status as enum ('offen', 'vorlaeufig_geschlossen', 'geschlossen');
create type soll_haben     as enum ('soll', 'haben');
create type buchung_herkunft as enum
  ('rechnung', 'eingangsrechnung', 'zahlung', 'ausgabe', 'kassenbewegung', 'manuell');

comment on type soll_haben is
  'Das Vorzeichen lebt HIER und nicht im Betrag: DATEV kennt nur positive '
  'Umsaetze mit einem Soll-/Haben-Kennzeichen. Ein negativer Betrag waere eine '
  'zweite Schreibweise fuer dieselbe Sache — und die erste, die jemand vergisst.';

-- =========================================================================
-- 2. `periode` — der Monat und sein Schloss (§9.1)
-- =========================================================================

create table periode (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  jahr                  integer not null check (jahr between 2000 and 2100),
  monat                 smallint not null check (monat between 1 and 12),

  /**
   * Berliner Kalendergrenzen (K-11), gespeichert statt gerechnet: ein
   * Wirtschaftsjahr, das nicht im Januar beginnt, ergibt sonst Monate, die
   * niemand nachvollziehen kann.
   */
  beginn_am             date not null,
  ende_am               date not null,

  status                periode_status not null default 'offen',
  vorlaeufig_geschlossen_am timestamptz,
  geschlossen_am        timestamptz,
  /** Nie `system`: einen Monat schliesst ein Mensch. */
  geschlossen_von       uuid references benutzer(id),

  /** Die eingefrorenen Monatszahlen, geschrieben beim Schliessen (ACC-08). */
  umsatz_erloes_cent    bigint,
  aufwand_cent          bigint,
  ergebnis_cent         bigint,

  /**
   * TODO(client, O-05): `datev_export` kommt mit PR 60; bis dahin bleibt die
   * Spalte NULL, und `periode_export_noch_leer` haelt das fest. Der
   * zusammengesetzte Fremdschluessel folgt mit der Elterntabelle.
   */
  datev_export_id       uuid,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint periode_mandant_uk unique (mandant_id, id),
  constraint periode_monat_uk unique (mandant_id, jahr, monat),
  constraint periode_spanne check (ende_am >= beginn_am),
  constraint periode_export_noch_leer check (datev_export_id is null),
  constraint periode_geschlossen_stimmig check (
        (status = 'offen' and geschlossen_am is null and vorlaeufig_geschlossen_am is null)
     or (status = 'vorlaeufig_geschlossen' and vorlaeufig_geschlossen_am is not null
         and geschlossen_am is null)
     or (status = 'geschlossen' and geschlossen_am is not null
         and geschlossen_von is not null)),
  constraint periode_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

comment on table periode is
  'ACC-08, ACC-11, LEG-01, REP-01. Der Buchungsmonat einer Gesellschaft und sein '
  'Schloss. Zeilen entstehen durch services/buchhaltung/periode.ts::sicherePeriode '
  'vor der ersten Buchung des Monats — nie implizit.';

create index periode_status_idx on periode (mandant_id, status);

create trigger periode_geaendert
  before update on periode
  for each row execute function kern.setze_geaendert_am();

create trigger trg_periode_kein_hard_delete
  before delete on periode
  for each row execute function kern.verhindere_loeschung();
create trigger trg_periode_kein_truncate
  before truncate on periode
  for each statement execute function kern.verhindere_loeschung();

-- =========================================================================
-- 3. `buchungssatz` — die Zeile (§9.2)
-- =========================================================================

create table buchungssatz (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /**
   * **Das wirtschaftliche Ereignis, zu dem diese Zeile gehoert.** Eine
   * Rechnung mit zwei Steuersaetzen ergibt vier Zeilen mit EINER
   * `buchung_id`; der Ausgleich wird ueber diese Klammer geprueft, nicht
   * ueber die Datei.
   */
  buchung_id            uuid not null,

  buchungsdatum         date not null,
  belegdatum            date not null,
  periode_id            uuid not null,

  /** Invariante 1: ganze Cent, und in DATEV immer POSITIV. */
  umsatz_cent           bigint not null check (umsatz_cent > 0),
  soll_haben            soll_haben not null,

  /**
   * NULL heisst: keine bestaetigte Kontenzuordnung (0126). Dann steht der
   * Grund in `pruefhinweis`, und die Zeile ist Arbeitsliste statt Export.
   */
  konto                 text check (konto is null or konto ~ '^[0-9]+$'),
  gegenkonto            text check (gegenkonto is null or gegenkonto ~ '^[0-9]+$'),
  /** TODO(client, O-05): Steuerschluesseltabelle vom Steuerberater. */
  bu_schluessel         text check (bu_schluessel is null or bu_schluessel ~ '^[0-9]{1,4}$'),
  steuersatz_gruppe_id  uuid references steuersatz_gruppe(id),

  /** Die EXTF-Feldbreiten, hier schon durchgesetzt (§9.2). */
  buchungstext          text not null check (length(buchungstext) between 1 and 60),
  belegfeld1            text check (belegfeld1 is null or length(belegfeld1) <= 36),
  belegfeld2            text check (belegfeld2 is null or length(belegfeld2) <= 12),
  kostenstelle          text check (kostenstelle is null or length(kostenstelle) <= 36),
  kostentraeger         text check (kostentraeger is null or length(kostentraeger) <= 36),

  /** Belegverknuepfung (ACC-03) — den Pflichtfall bringt PR 59. */
  beleg_id              uuid,

  herkunft              buchung_herkunft not null,
  rechnung_id           uuid,
  eingangsrechnung_id   uuid,
  zahlung_id            uuid,
  /**
   * TODO(client, O-05): `ausgabe` und `kassenbewegung` kommen mit PR 54.3b.
   * Bis dahin verbietet `bs_herkunft_hat_eltern` die beiden Herkuenfte, und
   * die Spalten bleiben leer — dieselbe Regel wie `km_typ_hat_eltern` (0126).
   */
  ausgabe_id            uuid,
  kassenbewegung_id     uuid,

  festgeschrieben       boolean not null default false,
  festgeschrieben_am    timestamptz,
  festgeschrieben_von   uuid references benutzer(id),

  /** Korrektur NUR durch Gegenbuchung (Invariante 4, GoBD). */
  storniert_durch_id    uuid,

  /** TODO: PR 60 haengt hier den zusammengesetzten Fremdschluessel an. */
  datev_export_id       uuid,

  pruefhinweis          text,

  aufbewahrung_klasse   text not null default 'buchungsbeleg',
  aufbewahrung_bis      date,
  loeschsperre          boolean not null default true,

  erstellt_von_art      akteur_art not null default 'system',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint buchungssatz_mandant_uk unique (mandant_id, id),

  /**
   * **Festgeschrieben heisst: kontiert.** Ohne diesen CHECK koennte eine
   * Zeile ohne Konto festgeschrieben werden und in einen Export geraten —
   * geliefert, unbrauchbar, spaet entdeckt.
   *
   * **Nur `konto`, nicht auch `gegenkonto` — und das weicht von §9.2 ab
   * (D-417).** Die beiden Zusagen des Modells widersprechen einander: der
   * Ausgleichsausloeser prueft Soll gegen Haben JE `buchung_id`, und das hat
   * nur Sinn, wenn eine Zeile EINE Kontenbewegung ist. Traege jede Zeile
   * Konto UND Gegenkonto (die DATEV-Schreibweise), waere sie in sich
   * ausgeglichen, und der Ausloeser koennte nie anschlagen — eine Wache, die
   * nichts bewacht. Diese Migration entscheidet sich fuer die einseitige
   * Zeile: sie macht den Ausgleich pruefbar. `gegenkonto` bleibt als Spalte,
   * weil eine Zuordnung ein festes Gegenkonto mitbringen kann; die Paarung
   * zur DATEV-Zeile macht der EXTF-Schreiber in PR 60.
   */
  constraint bs_fest_nur_kontiert check (not festgeschrieben or konto is not null),
  constraint bs_fest_stimmig check (
    (not festgeschrieben and festgeschrieben_am is null and festgeschrieben_von is null)
    or (festgeschrieben and festgeschrieben_am is not null)),

  constraint bs_genau_eine_herkunft check (
    num_nonnulls(rechnung_id, eingangsrechnung_id, zahlung_id, ausgabe_id, kassenbewegung_id)
    = case when herkunft = 'manuell' then 0 else 1 end),
  constraint bs_herkunft_passt check (
    case herkunft
      when 'rechnung'         then rechnung_id is not null
      when 'eingangsrechnung' then eingangsrechnung_id is not null
      when 'zahlung'          then zahlung_id is not null
      when 'ausgabe'          then ausgabe_id is not null
      when 'kassenbewegung'   then kassenbewegung_id is not null
      else true
    end),
  constraint bs_herkunft_hat_eltern check (herkunft not in ('ausgabe', 'kassenbewegung')),

  /** Eine manuelle Buchung ohne Beleg traegt ihren Hinweis selbst (ACC-03). */
  constraint bs_kein_beleg_ohne_hinweis check (
    not festgeschrieben or beleg_id is not null or herkunft = 'manuell'),

  constraint bs_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint bs_periode_fk foreign key (mandant_id, periode_id)
    references periode (mandant_id, id),
  constraint bs_beleg_fk foreign key (mandant_id, beleg_id)
    references beleg (mandant_id, id),
  constraint bs_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id),
  constraint bs_eingangsrechnung_fk foreign key (mandant_id, eingangsrechnung_id)
    references eingangsrechnung (mandant_id, id),
  constraint bs_zahlung_fk foreign key (mandant_id, zahlung_id)
    references zahlung (mandant_id, id),
  constraint bs_storno_fk foreign key (mandant_id, storniert_durch_id)
    references buchungssatz (mandant_id, id)
);

comment on table buchungssatz is
  'ACC-01, ACC-02, ACC-03, ACC-06, ACC-08, ACC-09, LEG-01. Eine Zeile des '
  'spaeteren EXTF-Stapels. Zeilen eines wirtschaftlichen Ereignisses teilen '
  'buchung_id und muessen zusammen ausgeglichen sein.';

/** Der Ausfuhrindex — und er schliesst unkontierte Zeilen AUS (§9.2). */
create index bs_export_idx on buchungssatz (mandant_id, buchungsdatum)
  where datev_export_id is null and festgeschrieben and konto is not null;
/** Der schlichte Zeitraumscan, den Z3 (ACC-09) und das Jahrespaket brauchen. */
create index bs_zeitraum_idx on buchungssatz (mandant_id, buchungsdatum);
create index bs_buchung_idx on buchungssatz (buchung_id);
/** Kontenblatt und BWA (ACC-08). */
create index bs_konto_idx on buchungssatz (mandant_id, konto, buchungsdatum);
create index bs_rechnung_idx on buchungssatz (mandant_id, rechnung_id) where rechnung_id is not null;
create index bs_eingangsrechnung_idx on buchungssatz (mandant_id, eingangsrechnung_id)
  where eingangsrechnung_id is not null;
/** Die Arbeitsliste: was ist noch nicht kontiert. */
create index bs_ohne_konto_idx on buchungssatz (mandant_id) where konto is null;

-- =========================================================================
-- 4. Der Ausgleich je `buchung_id` (§9.2, review MISSING)
-- =========================================================================

/**
 * **Aufgeschoben, und das ist der ganze Punkt.** Die Zeilen einer Buchung
 * entstehen nacheinander; nach der ersten ist die Buchung immer unausgeglichen.
 * Ein sofort pruefender Ausloeser verboete damit jede mehrzeilige Buchung.
 * `deferrable initially deferred` prueft am Ende der Transaktion — also dann,
 * wenn die Buchung vollstaendig ist.
 */
create function fin.pruefe_buchung_ausgeglichen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_soll  bigint;
  v_haben bigint;
begin
  select coalesce(sum(b.umsatz_cent) filter (where b.soll_haben = 'soll'), 0),
         coalesce(sum(b.umsatz_cent) filter (where b.soll_haben = 'haben'), 0)
    into v_soll, v_haben
    from public.buchungssatz b
   where b.buchung_id = new.buchung_id;

  if v_soll <> v_haben then
    raise exception
      'Buchung % geht nicht auf: Soll % Cent, Haben % Cent (Differenz % Cent).',
      new.buchung_id, v_soll, v_haben, v_soll - v_haben
      using errcode = 'check_violation',
            hint = 'Jede Zeile eines Ereignisses traegt dieselbe buchung_id, und zusammen muessen sie ausgeglichen sein.';
  end if;
  return null;
end $$;

create constraint trigger buchung_ausgeglichen
  after insert or update on buchungssatz
  deferrable initially deferred
  for each row execute function fin.pruefe_buchung_ausgeglichen();

-- =========================================================================
-- 5. Das Periodenschloss (§9.1)
-- =========================================================================

/**
 * Eine Buchung in einen geschlossenen Monat ist keine Buchung, sondern eine
 * nachtraegliche Aenderung an etwas, das der Steuerberater schon hat.
 * In einen vorlaeufig geschlossenen Monat darf, wer festschreiben darf.
 */
create function fin.periode_gesperrt() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare v_status periode_status;
begin
  select p.status into v_status
    from public.periode p
   where p.mandant_id = new.mandant_id
     and new.buchungsdatum between p.beginn_am and p.ende_am;

  if v_status is null then
    return new;
  end if;

  if v_status = 'geschlossen' then
    raise exception 'Der Monat zum % ist geschlossen — er nimmt keine Buchung mehr auf (GoBD).',
      new.buchungsdatum
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird im offenen Monat durch Gegenbuchung.';
  end if;

  if v_status = 'vorlaeufig_geschlossen'
     and session_user <> 'cse_job'
     and not app.hat_recht('buchhaltung.festschreiben', new.mandant_id) then
    raise exception 'Der Monat zum % ist vorlaeufig geschlossen — dafuer fehlt buchhaltung.festschreiben.',
      new.buchungsdatum using errcode = '42501';
  end if;

  return new;
end $$;

alter function fin.periode_gesperrt() owner to cse_definer;

create trigger bs_periode_gesperrt
  before insert or update on buchungssatz
  for each row execute function fin.periode_gesperrt();

/**
 * **Ein Monat schliesst nicht ueber einer offenen Baustelle.**
 *
 * Zwei Zustaende machen einen Export beim Steuerberater unbrauchbar: eine
 * Zeile ohne Konto und eine Buchung, die nicht aufgeht. Beide sind vor dem
 * Schliessen zu beheben — danach ist der Monat zu, und die Korrektur kostet
 * eine Gegenbuchung im Folgemonat.
 */
create function fin.periode_schliessen_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_ohne_konto integer;
  v_schief     integer;
begin
  if new.status = old.status or new.status = 'offen' then
    return new;
  end if;

  select count(*) into v_ohne_konto
    from public.buchungssatz b
   where b.mandant_id = new.mandant_id
     and b.periode_id = new.id
     and b.konto is null;

  if v_ohne_konto > 0 then
    raise exception
      'Der Monat %/% traegt % Buchungszeile(n) ohne Konto — erst kontieren, dann schliessen.',
      new.monat, new.jahr, v_ohne_konto
      using errcode = 'restrict_violation',
            hint = 'Die Arbeitsliste steht unter Finanzen > Buchungen.';
  end if;

  select count(*) into v_schief from (
    select b.buchung_id
      from public.buchungssatz b
     where b.mandant_id = new.mandant_id and b.periode_id = new.id
     group by b.buchung_id
    having coalesce(sum(b.umsatz_cent) filter (where b.soll_haben = 'soll'), 0)
        <> coalesce(sum(b.umsatz_cent) filter (where b.soll_haben = 'haben'), 0)
  ) s;

  if v_schief > 0 then
    raise exception 'Der Monat %/% traegt % Buchung(en), die nicht aufgehen.',
      new.monat, new.jahr, v_schief using errcode = 'restrict_violation';
  end if;

  return new;
end $$;

create trigger periode_schliessen_pruefen
  before update on periode
  for each row execute function fin.periode_schliessen_pruefen();

-- =========================================================================
-- 6. Unveraenderlichkeit, Aufbewahrung, kein Loeschen (Invariante 8, GoBD)
-- =========================================================================

/**
 * Ab `festgeschrieben` steht die Zeile. Erlaubt bleiben genau zwei Spalten:
 * `datev_export_id` (welche Datei hat sie mitgenommen) und
 * `storniert_durch_id` (welche Gegenbuchung hebt sie auf) — beides sind
 * Tatsachen, die NACH der Festschreibung entstehen und die Zeile selbst nicht
 * beruehren. Dazu die Aufbewahrungsspalten, aus demselben Grund wie bei der
 * Rechnung (D-399/0122): der Aufbewahrungslauf muss die Frist auch auf einem
 * festgeschriebenen Beleg setzen koennen.
 */
create function fin.buchungssatz_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus text[];
  v_alt jsonb;
  v_neu jsonb;
begin
  if not old.festgeschrieben then return new; end if;

  select array['geaendert_am', 'geaendert_von', 'geaendert_von_art',
               'datev_export_id', 'storniert_durch_id',
               'aufbewahrung_bis', 'loeschsperre']
         || coalesce(array_agg(a.attname::text), '{}')
    into v_aus
    from pg_attribute a
   where a.attrelid = 'public.buchungssatz'::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

  v_alt := to_jsonb(old) - v_aus;
  v_neu := to_jsonb(new) - v_aus;
  if v_alt = v_neu then return new; end if;

  raise exception
    'Buchungssatz %: festgeschrieben und damit unveraenderlich (GoBD, LEG-01).', old.id
    using errcode = 'restrict_violation',
          hint = 'Korrigiert wird durch Gegenbuchung; storniert_durch_id zeigt darauf.';
end $$;

create trigger bs_unveraenderlich
  before update on buchungssatz
  for each row execute function fin.buchungssatz_unveraenderlich();

create trigger bs_geaendert
  before update on buchungssatz
  for each row execute function kern.setze_geaendert_am();

create trigger bs_aufbewahrung
  before insert or update on buchungssatz
  for each row execute function fin.aufbewahrung_aus_klasse('belegdatum');

create trigger trg_buchungssatz_kein_hard_delete
  before delete on buchungssatz
  for each row execute function kern.verhindere_loeschung();
create trigger trg_buchungssatz_kein_truncate
  before truncate on buchungssatz
  for each statement execute function kern.verhindere_loeschung();

-- =========================================================================
-- 7. RLS und Rechte (§1.1–§1.5, K-03, K-04, D-388)
-- =========================================================================

alter table periode      enable row level security;
alter table periode      force  row level security;
alter table buchungssatz enable row level security;
alter table buchungssatz force  row level security;

/**
 * Modul `buchhaltung`, interne Decke, und **keine Gruppendecke auf
 * `buchungssatz`** — §1.4 begruendet, warum eine solche Decke die eigenen
 * Gruppenzahlen still kleiner machte, ohne etwas zu schuetzen, das diese
 * Zeile ueberhaupt preisgibt.
 */
do $$
declare t text;
begin
  foreach t in array array['periode', 'buchungssatz'] loop
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('buchhaltung.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('buchhaltung.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.buchhaltung.lesen')))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;
end $$;

grant select, insert, update on periode, buchungssatz to cse_app;

/**
 * Der Monatslauf (`periodenVorlauf`, §11) oeffnet Perioden im Voraus, und der
 * Buchungslauf schreibt Zeilen — beides `cse_job`, beides ohne Sitzung.
 */
grant select, insert, update on periode, buchungssatz to cse_job;

create policy j_periode on periode for all to cse_job using (true) with check (true);
create policy j_buchungssatz on buchungssatz for all to cse_job using (true) with check (true);

-- =========================================================================
-- 8. Zwei Tore statt eines neuen Rechts (D-418)
-- =========================================================================

/**
 * **Wer eine Rechnung festschreibt, wird dadurch nicht Buchhalter.**
 *
 * Der Buchungssatz entsteht INNERHALB von `finalisiere()` (§5.6 Schritt 6).
 * Liefe der INSERT als der Aufrufer, braeuchte jede Abrechnungskraft
 * `buchhaltung.schreiben` — ein Recht, das ihr niemand geben wollte, und ohne
 * das die Rechnung ploetzlich an „permission denied" scheiterte. Die Buchung
 * ist keine Handlung des Menschen, sondern die Folge seiner Handlung.
 *
 * Deshalb zwei enge Tore mit `SECURITY DEFINER`: sie verlangen das Recht, das
 * zur HANDLUNG gehoert (`finanzen.schreiben` — oder `buchhaltung.schreiben`
 * fuer den, der ohnehin bucht), und sie tun genau eine Sache. Dieselbe
 * Trennung wie bei `app.konto_aufloesen` (0126) und `app.kunde_mahnsperre_aktiv`
 * (D-407).
 */
create function app.buchen_erlaubt(p_mandant uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if session_user = 'cse_job' then return; end if;
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht bucht nicht (Invariante 10).' using errcode = '42501';
  end if;
  if not (app.hat_recht('finanzen.schreiben', p_mandant)
          or app.hat_recht('buchhaltung.schreiben', p_mandant)) then
    raise exception 'finanzen.schreiben oder buchhaltung.schreiben fehlt' using errcode = '42501';
  end if;
end $$;

alter function app.buchen_erlaubt(uuid) owner to cse_definer;

create function app.periode_sichern(p_mandant uuid, p_datum date) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_id uuid;
begin
  perform app.buchen_erlaubt(p_mandant);

  insert into public.periode (mandant_id, jahr, monat, beginn_am, ende_am,
                              erstellt_von_art, erstellt_von_dienst)
  select p_mandant,
         extract(year  from p_datum)::integer,
         extract(month from p_datum)::smallint,
         date_trunc('month', p_datum)::date,
         (date_trunc('month', p_datum) + interval '1 month - 1 day')::date,
         'system', 'dienst:buchhaltung-periode'
  on conflict (mandant_id, jahr, monat) do nothing;

  select p.id into v_id from public.periode p
   where p.mandant_id = p_mandant and p_datum between p.beginn_am and p.ende_am;
  return v_id;
end $$;

alter function app.periode_sichern(uuid, date) owner to cse_definer;

create function app.buchungssatz_schreiben(
  p_mandant     uuid,
  p_buchung     uuid,
  p_datum       date,
  p_periode     uuid,
  p_umsatz_cent bigint,
  p_soll_haben  soll_haben,
  p_konto       text,
  p_gegenkonto  text,
  p_bu          text,
  p_gruppe      uuid,
  p_text        text,
  p_belegfeld1  text,
  p_herkunft    buchung_herkunft,
  p_rechnung    uuid,
  p_hinweis     text,
  p_dienst      text
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_id uuid;
begin
  perform app.buchen_erlaubt(p_mandant);

  insert into public.buchungssatz
    (mandant_id, buchung_id, buchungsdatum, belegdatum, periode_id, umsatz_cent,
     soll_haben, konto, gegenkonto, bu_schluessel, steuersatz_gruppe_id,
     buchungstext, belegfeld1, herkunft, rechnung_id, pruefhinweis,
     erstellt_von_art, erstellt_von_dienst)
  values (p_mandant, p_buchung, p_datum, p_datum, p_periode, p_umsatz_cent,
          p_soll_haben, p_konto, p_gegenkonto, p_bu, p_gruppe,
          p_text, p_belegfeld1, p_herkunft, p_rechnung, p_hinweis,
          'system', p_dienst)
  returning id into v_id;
  return v_id;
end $$;

alter function app.buchungssatz_schreiben(uuid, uuid, date, uuid, bigint, soll_haben, text,
                                          text, text, uuid, text, text, buchung_herkunft,
                                          uuid, text, text) owner to cse_definer;

/** Die Gegenbuchung setzt den Verweis — mehr darf sie an der Zeile nicht. */
create function app.buchungssatz_storniert(
  p_mandant uuid, p_zeile uuid, p_gegen uuid
) returns void
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  perform app.buchen_erlaubt(p_mandant);
  update public.buchungssatz set storniert_durch_id = p_gegen
   where mandant_id = p_mandant and id = p_zeile;
end $$;

alter function app.buchungssatz_storniert(uuid, uuid, uuid) owner to cse_definer;

/** D-388: der Definer braucht eigene Rechte und eigene Policies. */
grant select, insert, update on periode, buchungssatz to cse_definer;

create policy d_periode on periode for all to cse_definer using (true) with check (true);
create policy d_buchungssatz on buchungssatz for all to cse_definer using (true) with check (true);

revoke all on function app.periode_sichern(uuid, date) from public;
revoke all on function app.buchungssatz_storniert(uuid, uuid, uuid) from public;
revoke all on function app.buchen_erlaubt(uuid) from public;
/**
 * **Diese Zeile fehlte, und die K-08-Wache hat sie gefunden** — nicht ich.
 * Eine `SECURITY DEFINER`-Funktion traegt das Standardrecht `EXECUTE` fuer
 * PUBLIC, solange es niemand entzieht: jede Rolle der Datenbank haette
 * Buchungszeilen schreiben koennen, am Rechtetor `app.buchen_erlaubt`
 * vorbei? Nein — das Tor greift auch dann. Aber PUBLIC-Rechte auf einer
 * Definer-Funktion sind genau die Flaeche, die K-08 ausschliesst, und
 * eine Ausnahme fuer diese eine waere eine Ausnahme fuer die naechste.
 */
revoke all on function app.buchungssatz_schreiben(uuid, uuid, date, uuid, bigint,
                                                  soll_haben, text, text, text, uuid,
                                                  text, text, buchung_herkunft, uuid,
                                                  text, text) from public;
grant execute on function app.periode_sichern(uuid, date) to cse_app, cse_job;
grant execute on function app.buchungssatz_storniert(uuid, uuid, uuid) to cse_app, cse_job;
grant execute on function app.buchungssatz_schreiben(uuid, uuid, date, uuid, bigint, soll_haben,
                                                     text, text, text, uuid, text, text,
                                                     buchung_herkunft, uuid, text, text)
  to cse_app, cse_job;
