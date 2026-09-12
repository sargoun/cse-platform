-- ===========================================================================
-- 0060 — stundenkonto und stundenkonto_bewegung: das Arbeitszeitkonto als
--        BUCHUNGSREIHE, und der einseitige Monatsabschluss
--        (01-KERN.md §6.24/§6.25; EMP-04, EMP-15, TIM-13, LEG-02, ACC-12,
--         04-PLANUNG-ZEIT.md §7.3, §12.2)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.24 und §6.25. Wo
-- dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- **Ein Stundenkonto ist keine Zahl.** Der naheliegende Entwurf ist eine
-- Spalte `saldo_minuten` je Beschaeftigung, die jeder Schreibweg fortschreibt.
-- Der faellt nicht auf, wenn er falsch ist: ein Saldo driftet gegen die
-- Vorgaenge, aus denen er entstanden ist, und die Abweichung wird erst
-- sichtbar, wenn jemand nachrechnet — im Lohnstreit, oder gar nicht. Deshalb
-- ist die BEWEGUNG der Datensatz und das Konto nur ihre Summe: jede Minute auf
-- dem Konto hat eine Zeile mit Herkunft, Datum und Grund, und die Summe laesst
-- sich jederzeit gegen das Journal halten (`stundenkonto_summe` unten,
-- naechtlich `job:stundenkonto_abgleich`).
--
-- **Der Abschluss ist einseitig.** Ein gesperrter Monat aendert sich nie
-- wieder — genau wie eine festgeschriebene Rechnung (FIN-02, Invariante 4).
-- Eine spaetere Korrektur wird nicht rueckwirkend eingerechnet, sondern als
-- Ausgleichsbuchung im ersten OFFENEN Monat sichtbar (§12.2). Der bequeme
-- Gegenentwurf — „entsperren, neu rechnen, wieder sperren" — kostet genau das,
-- wofuer der Monatsabschluss existiert: der Lohnschein, den ein Mensch in der
-- Hand haelt, und die Zahl, die die Plattform heute ausgibt, waeren zwei
-- verschiedene Zahlen fuer denselben Monat, und beide saehen richtig aus.
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **`ist_minuten` ist keine frei beschreibbare Spalte.** Wer sie setzt,
--     muss dasselbe sagen wie das Journal, sonst weist `stundenkonto_summe`
--     ab. Ein stiller Abgleich („wir korrigieren die Summe einfach") waere die
--     Drift, die niemand meldet.
--  2. **`bewegung_sperre_pruefen` weist die Buchung in einen gesperrten Monat
--     ab, statt sie umzuleiten.** Umleiten waere Zauberei im Ausloeser; die
--     Entscheidung, in welchen offenen Monat die Differenz gehoert, trifft ein
--     Dienst und schreibt sie mit `korrektur_fuer_stundenkonto_id` auf.
--  3. **`z_monat_sperren` stempelt `zeiteintrag.gesperrt_am`.** 0034 hat die
--     Spalte angelegt und diesen einen Schreiber benannt. Ohne ihn bliebe sie
--     fuer immer NULL — und dann feuerte `zk_sperre_ausgleich` (0036) nie, eine
--     Korrektur an einem gesperrten Monat entstuende ohne Gegenbuchung, und der
--     ACC-12-Lohnexport waehlte null Zeilen.
--
-- NICHT in dieser Migration: `abwesenheit` (PR 38) — die Spalte
-- `stundenkonto_bewegung.abwesenheit_id` steht hier, ihr Fremdschluessel kommt
-- dort. `urlaubskonto` steht in 0061.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (01-KERN §4)
-- ---------------------------------------------------------------------------

/**
 * PLACEHOLDER (01-KERN §4). EMP-04 sagt nur „locks monthly"; `vorlaeufig` ist
 * eine Zwischenstufe, die die SPEC nicht kennt. Sie steht im Typ, damit ein
 * spaeteres Ja keine Migration an einer Aufzaehlung braucht, und kein Dienst
 * dieses PRs erzeugt sie.
 * // TODO(client, O-143): Gibt es zwischen offen und gesperrt einen
 * vorlaeufigen Zustand — „Zahlen an die Lohnabrechnung gegeben, noch
 * korrigierbar" —, oder geht der Monat direkt von offen auf gesperrt?
 */
create type stundenkonto_status as enum ('offen','vorlaeufig','gesperrt');

/**
 * Woraus eine Minute auf dem Konto entstanden ist (EMP-04).
 * // TODO(client, O-139): Auf welche Lohnarten bildet die Lohnabrechnung diese
 * Bewegungsarten ab (ACC-12)? Ohne die Zuordnung exportiert die Plattform
 * Minuten, keine Lohnzeilen.
 */
create type bewegung_art as enum
  ('arbeitszeit','abwesenheit','feiertag','korrektur','uebertrag',
   'auszahlung','freizeitausgleich');

/** Woher die Buchung kommt — die FIN-07/TIM-12-Rueckverfolgbarkeit. */
create type bewegung_quelle as enum
  ('zeiteintrag','abwesenheit','manuell','import','system');

-- ---------------------------------------------------------------------------
-- 2. stundenkonto (01-KERN §6.24)
-- ---------------------------------------------------------------------------

create table stundenkonto (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  /**
   * D-09 §3: je BESCHAEFTIGUNG, nicht je Mensch. Wer in zwei Gesellschaften
   * arbeitet, hat zwei Konten mit verschiedenen Saetzen und verschiedenen
   * Vereinbarungen. Die kombinierte Zahl (EMP-15) wird fuer die ANZEIGE
   * gerechnet und nirgends gespeichert — eine gespeicherte Summe ueber zwei
   * Gesellschaften waere eine dritte Wahrheit neben zwei Lohnkonten.
   */
  anstellung_id uuid not null,

  jahr          integer not null,
  /**
   * Der BERLINER Kalendermonat (K-11). Die Monatsgrenze ist 23:00Z bzw.
   * 22:00Z, nie UTC-Mitternacht — sonst faellt die erste Haelfte jeder
   * Nachtschicht am Monatsersten in den Vormonat, und der Lohn landet im
   * falschen Abrechnungszeitraum.
   */
  monat         integer not null,

  /**
   * Die Sollzeit dieses Monats. Sie wird NICHT hier hergeleitet: welche
   * Wochenstunden gelten, wie sie auf Arbeitstage fallen und was ein
   * Feiertag daran aendert, ist eine Vertrags- und Tariffrage.
   * `services/zeit/sollstunden.ts` haelt die Schnittstelle und verweigert die
   * Herleitung, solange die Regel offen ist — 0 heisst hier „nicht
   * hinterlegt" und nicht „null Stunden geschuldet".
   * // TODO(client, O-18): Arbeitszeitmodelle, Sollstundenherleitung,
   * Urlaubsanspruch, Uebertragung und Ueberstundenverfall je Entitaet/Tarif?
   */
  soll_minuten  integer not null default 0,
  /** Summe des Journals. Geschrieben ausschliesslich von `bewegung_summe`. */
  ist_minuten   integer not null default 0,
  /** Der Anteil aus `art = 'korrektur'` — in `ist_minuten` enthalten. */
  korrektur_minuten integer not null default 0,
  /** Der Saldo des Vormonats zum SPERRZEITPUNKT (`job:konten_rollover`). */
  saldo_vortrag_minuten integer not null default 0,
  /**
   * Errechnet, nicht gepflegt. Eine zweite Spalte, die jemand fortschreibt,
   * waere die Drift, die dieses Schema vermeidet.
   */
  saldo_minuten integer not null generated always as
    (saldo_vortrag_minuten + ist_minuten - soll_minuten) stored,

  -- Auswertung (EMP-04). Tage, nicht Minuten: eine Abwesenheit wird in Tagen
  -- gewaehrt und in Minuten gutgeschrieben, und beides ist nicht dasselbe.
  urlaub_tage   numeric(12,3) not null default 0,
  krank_tage    numeric(12,3) not null default 0,

  status        stundenkonto_status not null default 'offen',
  gesperrt_am   timestamptz,
  gesperrt_von  uuid references benutzer(id),

  /** Das Monats-PDF (EMP-06). Gepraegt aus `zeitnachweis` (0051, D-152). */
  abrechnung_dokument_id uuid,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint stundenkonto_mandant_uk unique (mandant_id, id),
  -- EIN Konto je Beschaeftigung und Monat. Ein zweites waere eine zweite
  -- Wahrheit ueber denselben Lohnmonat.
  constraint stundenkonto_key unique (anstellung_id, jahr, monat),

  constraint sk_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint sk_dokument_fk foreign key (mandant_id, abrechnung_dokument_id)
    references dokument (mandant_id, id),

  constraint sk_jahr_bereich  check (jahr between 2000 and 2100),
  constraint sk_monat_bereich check (monat between 1 and 12),
  /**
   * Der Zustand und sein Zeitpunkt sagen dasselbe oder gar nichts. Ohne diese
   * Bedingung gaebe es ein `gesperrt` ohne Zeitpunkt — und damit einen
   * gesperrten Monat, von dem niemand sagen kann, seit wann.
   */
  constraint sk_sperre_paarweise check ((status = 'gesperrt') = (gesperrt_am is not null)),
  constraint sk_tage_nicht_negativ check (urlaub_tage >= 0 and krank_tage >= 0),
  constraint sk_soll_nicht_negativ check (soll_minuten >= 0)
);

create index stundenkonto_monat_idx on stundenkonto (mandant_id, jahr, monat, status);
-- Der Sperrlauf und die Suche nach dem ERSTEN OFFENEN Monat (§12.2).
create index stundenkonto_offen_idx on stundenkonto (mandant_id, jahr, monat)
  where status <> 'gesperrt';
/**
 * OHNE `mandant_id`-Praefix, mit Absicht: die kombinierte Personensicht
 * (EMP-15) laeuft ueber alle Beschaeftigungen und kann keinen einzelnen
 * Mandanten nennen.
 */
create index stundenkonto_person_idx on stundenkonto (anstellung_id, jahr desc, monat desc);

comment on table stundenkonto is
  'EMP-04: das Arbeitszeitkonto EINER Beschaeftigung fuer EINEN Berliner '
  'Kalendermonat. Soll, Ist, Vortrag, Saldo — die Summe seines Journals '
  '(stundenkonto_bewegung), nie eine frei gefuehrte Zahl.';
comment on column stundenkonto.soll_minuten is
  '0 heisst „nicht hinterlegt", nicht „nichts geschuldet" (O-18).';
comment on column stundenkonto.ist_minuten is
  'Summe des Journals. Einziger Schreiber: bewegung_summe.';
comment on column stundenkonto.status is
  'offen → vorlaeufig → gesperrt, einbahnig. Entsperren ist kein Vorgang '
  '(EMP-04), sondern eine Korrektur im Folgemonat.';

-- ---------------------------------------------------------------------------
-- 3. stundenkonto_bewegung (01-KERN §6.25)
-- ---------------------------------------------------------------------------

create table stundenkonto_bewegung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  stundenkonto_id uuid not null,

  art           bewegung_art not null,
  /**
   * Vorzeichenbehaftet und GANZZAHLIG (K-16): Minuten sind eine gemessene
   * Groesse. Eine Null waere eine Buchung, die nichts bewegt — sie stuende im
   * Kontoauszug und erklaerte nichts.
   */
  minuten       integer not null,
  /**
   * Der BERLINER Kalendertag (K-11), abgeleitet aus den UTC-Zeitpunkten des
   * Zeiteintrags durch den Dienst — nie `::date` auf einem Zeitstempel, das
   * waere der UTC-Tag und schoebe jede Nachtschicht um einen Tag.
   */
  wirksam_am    date not null,
  quelle        bewegung_quelle not null,

  /** Typisierte Herkunft statt polymorpher `quelle_id` (§6.25, FIN-07). */
  zeiteintrag_id uuid,
  abwesenheit_id uuid,

  begruendung   text,
  /**
   * Zeigt auf den GESPERRTEN Monat, dessen Differenz diese Buchung
   * ausgleicht (§12.2). Das ist es, was „die Korrektur ist im ersten offenen
   * Monat angekommen" beweisbar statt behauptet macht.
   */
  korrektur_fuer_stundenkonto_id uuid,
  /**
   * Diese Zeile ist die Stornobuchung zu jener. Die stornierte Zeile bleibt
   * unangetastet stehen (Invariante 8) — ein Journal, aus dem sich etwas
   * entfernen laesst, ist keins.
   */
  storniert_bewegung_id uuid,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),

  primary key (id),
  constraint stundenkonto_bewegung_mandant_uk unique (mandant_id, id),

  constraint sb_konto_fk foreign key (mandant_id, stundenkonto_id)
    references stundenkonto (mandant_id, id),
  constraint sb_zeiteintrag_fk foreign key (mandant_id, zeiteintrag_id)
    references zeiteintrag (mandant_id, id),
  constraint sb_korrektur_konto_fk foreign key (mandant_id, korrektur_fuer_stundenkonto_id)
    references stundenkonto (mandant_id, id),
  constraint sb_storno_fk foreign key (mandant_id, storniert_bewegung_id)
    references stundenkonto_bewegung (mandant_id, id),

  constraint sb_minuten_nicht_null check (minuten <> 0),
  /**
   * Genau eine typisierte Herkunft — oder keine, wenn die Buchung von Hand,
   * aus einem Import oder vom System kommt. Ohne diese Bedingung entstuende
   * eine Buchung, die BEIDE Quellen nennt, und FIN-07 zeigte auf zwei Belege
   * fuer dieselbe Minute.
   */
  constraint sb_herkunft check (
    num_nonnulls(zeiteintrag_id, abwesenheit_id) =
      case when quelle in ('manuell','system','import') then 0 else 1 end),
  -- Jede manuelle Korrektur traegt ihren Grund (TIM-11).
  constraint sb_korrektur_begruendet check (
    art <> 'korrektur' or (begruendung is not null and btrim(begruendung) <> '')),
  constraint sb_erstellt_von_ausser_system check (
    quelle = 'system' or erstellt_von is not null)
);

create index bewegung_konto_idx on stundenkonto_bewegung
  (stundenkonto_id, wirksam_am, erstellt_am);
create index bewegung_zeiteintrag_idx on stundenkonto_bewegung (zeiteintrag_id)
  where zeiteintrag_id is not null;
create index bewegung_abwesenheit_idx on stundenkonto_bewegung (abwesenheit_id)
  where abwesenheit_id is not null;
create unique index bewegung_storno_key on stundenkonto_bewegung (storniert_bewegung_id)
  where storniert_bewegung_id is not null;
create index bewegung_korrektur_idx on stundenkonto_bewegung (korrektur_fuer_stundenkonto_id)
  where korrektur_fuer_stundenkonto_id is not null;

/**
 * **Die Zusage, die 01-KERN §6.25 nicht als Index fuehrt und die dieser PR
 * braucht: EINE Arbeitszeitbuchung je Zeiteintrag und Konto.**
 *
 * Der Buchungslauf ist wiederholbar — er muss es sein, weil Zeiten
 * nachtraeglich freigegeben werden und niemand sich merkt, welche schon
 * gebucht sind. Ohne diese Eindeutigkeit verdoppelte ein zweiter Lauf den
 * Monat, und zwar unauffaellig: die Zahl bliebe plausibel, das Journal saehe
 * ordentlich aus, und der Fehler faende sich erst im Jahresvergleich.
 * Eine Schicht ueber die Monatsgrenze bleibt erlaubt zweimal gebucht — dann
 * aber auf ZWEI Konten, und das trennt der Schluessel.
 */
create unique index bewegung_arbeitszeit_uk on stundenkonto_bewegung
  (stundenkonto_id, zeiteintrag_id) where art = 'arbeitszeit';

comment on table stundenkonto_bewegung is
  'EMP-04: die einzelne Buchung auf einem Arbeitszeitkonto, mit Herkunft. '
  'Anfuegend — kein UPDATE, kein DELETE, fuer niemanden. Die Bewegungen sind '
  'das Journal, das Konto ist ihre Summe.';
comment on column stundenkonto_bewegung.korrektur_fuer_stundenkonto_id is
  'Der gesperrte Monat, dessen Differenz hier ankommt (EMP-04, §12.2).';

-- ---------------------------------------------------------------------------
-- 4. Ausloeser auf stundenkonto
--
-- **Die Reihenfolge steht in den Namen, weil sie Teil der Regel ist.**
-- Postgres feuert Zeilenausloeser derselben Stufe alphabetisch nach ihrem
-- NAMEN (dieselbe Ueberlegung wie in 0034 §4):
--
--   1 einbahn   entscheidet ueber den Zustandswechsel und stempelt die Sperre
--   2 sperre    weist jede Aenderung an einem GESPERRTEN Monat ab
--   3 summe     haelt Konto und Journal aneinander
--   4 monat     (AFTER) stempelt die Zeiteintraege des gesperrten Monats
-- ---------------------------------------------------------------------------

/**
 * `stundenkonto_status_einbahn` — der Zustand geht vorwaerts, und der
 * Sperrzeitpunkt gehoert dem Server.
 *
 * **Entsperren ist kein Vorgang** (EMP-04, analog FIN-02). Der Grund ist
 * nicht Strenge um ihrer selbst willen: an einem gesperrten Monat haengen ein
 * ausgegebener Stundennachweis, ein Lohnlauf und ein Artefakt mit Digest
 * (`zeitnachweis`, D-152). Ein Monat, der wieder aufginge, koennte danach
 * andere Zahlen zeigen als das Papier in der Hand des Menschen — und beide
 * saehen richtig aus. Die Differenz gehoert in den ersten offenen Monat.
 *
 * `default now()` auf `gesperrt_am` genuegte nicht: ein Default greift nur,
 * wenn die Spalte WEGGELASSEN wird, und ein UPDATE, das den Zeitpunkt
 * mitschickt, setzte einen beliebigen. Der zaehlt hier — er entscheidet,
 * welche Korrektur noch in den Monat fiel und welche nicht mehr.
 */
create function kern.stundenkonto_status_einbahn() returns trigger
language plpgsql as $$
declare
  v_rang constant text[] := array['offen','vorlaeufig','gesperrt'];
  v_alt  integer := array_position(v_rang, old.status::text);
  v_neu  integer := array_position(v_rang, new.status::text);
begin
  if v_neu < v_alt then
    raise exception 'Ein Stundenkonto geht nicht zurueck'
      using errcode = 'check_violation',
            detail  = format('%s → %s.', old.status, new.status),
            hint    = 'Ein gesperrter Monat wird nicht entsperrt (EMP-04); die '
                      || 'Differenz gehoert als Ausgleichsbuchung in den ersten '
                      || 'offenen Monat.';
  end if;

  if new.status = 'gesperrt' and old.status <> 'gesperrt' then
    new.gesperrt_am := now();
  end if;
  return new;
end $$;

create trigger trg_stundenkonto_1_einbahn
  before update on stundenkonto
  for each row execute function kern.stundenkonto_status_einbahn();

/**
 * `stundenkonto_sperre` — was gesperrt ist, aendert sich nicht mehr.
 *
 * Eine Positivliste und keine Negativliste: erlaubt sind das Monats-PDF und
 * die zwei Aenderungsmarken, alles andere ist gesperrt. Andersherum waere jede
 * Spalte, die eine spaetere Migration ergaenzt, standardmaessig aenderbar —
 * und niemand bemerkte es (dieselbe Ueberlegung wie `z_unveraenderlich`, 0034).
 *
 * `abrechnung_dokument_id` ist die eine Ausnahme, und sie ist keine: das PDF
 * entsteht NACH der Sperre aus denselben Zahlen. Es zu hinterlegen aendert
 * nicht, was im Monat steht, sondern haelt fest, wo es nachzulesen ist.
 */
create function kern.stundenkonto_sperre() returns trigger
language plpgsql as $$
declare v_verboten text[] := array[]::text[];
begin
  if old.status <> 'gesperrt' then
    return new;
  end if;

  if new.soll_minuten  is distinct from old.soll_minuten  then
    v_verboten := array_append(v_verboten, 'soll_minuten');
  end if;
  if new.ist_minuten   is distinct from old.ist_minuten   then
    v_verboten := array_append(v_verboten, 'ist_minuten');
  end if;
  if new.korrektur_minuten is distinct from old.korrektur_minuten then
    v_verboten := array_append(v_verboten, 'korrektur_minuten');
  end if;
  if new.saldo_vortrag_minuten is distinct from old.saldo_vortrag_minuten then
    v_verboten := array_append(v_verboten, 'saldo_vortrag_minuten');
  end if;
  if new.urlaub_tage is distinct from old.urlaub_tage then
    v_verboten := array_append(v_verboten, 'urlaub_tage');
  end if;
  if new.krank_tage is distinct from old.krank_tage then
    v_verboten := array_append(v_verboten, 'krank_tage');
  end if;
  if new.status is distinct from old.status then
    v_verboten := array_append(v_verboten, 'status');
  end if;
  if new.gesperrt_am is distinct from old.gesperrt_am then
    v_verboten := array_append(v_verboten, 'gesperrt_am');
  end if;
  if new.gesperrt_von is distinct from old.gesperrt_von then
    v_verboten := array_append(v_verboten, 'gesperrt_von');
  end if;
  if new.anstellung_id is distinct from old.anstellung_id then
    v_verboten := array_append(v_verboten, 'anstellung_id');
  end if;
  if new.jahr is distinct from old.jahr then
    v_verboten := array_append(v_verboten, 'jahr');
  end if;
  if new.monat is distinct from old.monat then
    v_verboten := array_append(v_verboten, 'monat');
  end if;

  if array_length(v_verboten, 1) is not null then
    raise exception 'Der Monat ist gesperrt'
      using errcode = 'check_violation',
            detail  = format('Gesperrte Spalten: %s.', array_to_string(v_verboten, ', ')),
            hint    = 'Eine Korrektur bucht in den ersten offenen Monat '
                      || '(EMP-04, 04-PLANUNG-ZEIT §12.2).';
  end if;
  return new;
end $$;

create trigger trg_stundenkonto_2_sperre
  before update on stundenkonto
  for each row execute function kern.stundenkonto_sperre();

/**
 * `stundenkonto_summe` — das Konto sagt, was sein Journal sagt.
 *
 * **Und es korrigiert nicht still.** Der bequeme Ausloeser waere einer, der
 * `ist_minuten` bei jedem Schreibvorgang aus dem Journal ueberschreibt. Dann
 * verschwindet jede Abweichung in dem Moment, in dem sie entsteht — und mit
 * ihr die Auskunft, dass etwas an dem Konto vorbei gebucht hat. Hier wird
 * stattdessen ABGEWIESEN: wer eine Summe schreibt, die das Journal nicht
 * hergibt, bekommt einen Fehler und keine korrigierte Zahl.
 *
 * Geschrieben werden die beiden Spalten deshalb an genau einer Stelle:
 * `bewegung_summe` unten, unmittelbar nachdem die Buchung in der Tabelle
 * steht. Alles andere ist ein Versuch, den Saldo zu fuehren statt ihn zu
 * rechnen.
 */
create function kern.stundenkonto_summe() returns trigger
language plpgsql as $$
declare v_ist integer; v_korrektur integer;
begin
  select coalesce(sum(b.minuten), 0),
         coalesce(sum(b.minuten) filter (where b.art = 'korrektur'), 0)
    into v_ist, v_korrektur
    from stundenkonto_bewegung b
   where b.stundenkonto_id = new.id;

  if new.ist_minuten <> v_ist or new.korrektur_minuten <> v_korrektur then
    raise exception 'Konto und Journal sagen Verschiedenes'
      using errcode = 'check_violation',
            detail  = format('Konto: ist %s / korrektur %s. Journal: ist %s / korrektur %s.',
                             new.ist_minuten, new.korrektur_minuten, v_ist, v_korrektur),
            hint    = 'ist_minuten und korrektur_minuten sind die Summe der '
                      || 'stundenkonto_bewegung. Wer Minuten bewegen will, bucht '
                      || 'eine Bewegung.';
  end if;
  return new;
end $$;

create trigger trg_stundenkonto_3_summe
  before insert or update on stundenkonto
  for each row execute function kern.stundenkonto_summe();

/**
 * `z_monat_sperren` — der EINE Schreiber von `zeiteintrag.gesperrt_am`
 * (0034 §3, EMP-04).
 *
 * Ohne ihn bliebe die Spalte fuer immer NULL. Die Folgen stehen in 0034 und
 * sind alle drei stumm: `zk_sperre_ausgleich` (0036) feuerte nie, eine
 * Korrektur an einem gesperrten Monat entstuende ohne Gegenbuchung, und der
 * ACC-12-Lohnexport (`freigegeben_am is not null and gesperrt_am is not null`)
 * waehlte null Zeilen — ein leerer Export sieht aus wie „nichts zu tun".
 *
 * **Die Monatsgrenze ist eine Berliner Mitternacht als ZEITPUNKT** (K-11,
 * §7.3): `at time zone 'Europe/Berlin'` auf den Monatsersten, nie
 * `date_trunc` auf einem UTC-Zeitstempel. Sonst faellt die erste Stunde jeder
 * Nachtschicht am Monatsersten in den Vormonat, und die Sperre erwischt die
 * falschen Zeilen.
 *
 * Eine Schicht ueber die Monatsgrenze wird MITGESPERRT, obwohl sie auch dem
 * offenen Folgemonat angehoert. Das ist die vorsichtige Richtung: sie ist Teil
 * eines ausgegebenen Nachweises, und wer sie danach korrigiert, braucht die
 * Gegenbuchung — genau das erzwingt `zk_sperre_ausgleich` dann.
 *
 * `security definer`, weil `zeiteintrag` FORCE RLS traegt und die
 * schreibende Sitzung `zeit.schreiben` nicht halten muss, um einen Monat
 * abzuschliessen: das Recht dafuer heisst `zeit.konto_abschliessen`. Der
 * Eigentuemer ist `cse_definer`, dessen Schreibweg die Policy
 * `z_definer_sperren` unten auf genau diese eine Spalte begrenzt.
 */
create function kern.stundenkonto_monat_sperren() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_beginn timestamptz;
  v_ende   timestamptz;
begin
  if new.status <> 'gesperrt' or old.status = 'gesperrt' then
    return null;
  end if;

  /*
   * `::timestamp` ist hier die ganze Aussage, und ihr Fehlen kostete vier
   * Stunden je Monatsgrenze.
   *
   * `make_date()` liefert `date`. `date at time zone text` loest Postgres
   * ueber den bevorzugten Typ nach `timezone(text, timestamptz)` auf: das
   * Datum wird erst nach UTC-Mitternacht gecastet und dann NACH Berlin
   * gerechnet — heraus kommt 02:00 im Sommer und 01:00 im Winter, als
   * zonenloser Zeitstempel. Die naechste Zeile traf die richtige Ueberladung
   * nur zufaellig, weil `date + interval` bereits einen zonenlosen
   * Zeitstempel ergibt.
   *
   * Wirkung: die Sperre liess die Zeiteintraege des Monatsersten zwischen
   * 00:00 und 02:00 (Winter) bzw. 04:00 (Sommer) ungesperrt — also genau die
   * Nachtschicht, die in den Monat hineinreicht. Gebucht wurden sie, gesperrt
   * nicht; ein abgeschlossener Monat blieb an seinem Rand aenderbar.
   */
  v_beginn := (make_date(new.jahr, new.monat, 1))::timestamp
                at time zone 'Europe/Berlin';
  v_ende   := (make_date(new.jahr, new.monat, 1) + interval '1 month')::timestamp
                at time zone 'Europe/Berlin';

  update zeiteintrag z
     set gesperrt_am = new.gesperrt_am
   where z.mandant_id = new.mandant_id
     and z.anstellung_id = new.anstellung_id
     and z.ende_zeitpunkt is not null
     and z.beginn_zeitpunkt < v_ende
     and z.ende_zeitpunkt   > v_beginn
     and z.gesperrt_am   is null
     and z.storniert_am  is null
     and z.ersetzt_am    is null;
  return null;
end $$;

create trigger trg_stundenkonto_4_monat_sperren
  after update on stundenkonto
  for each row execute function kern.stundenkonto_monat_sperren();

/**
 * Der schmale Schreibweg, den dieser Ausloeser braucht.
 *
 * `z_definer_update` (0034) laesst `cse_definer` nur OFFENE Eintraege
 * schliessen (`ende_zeitpunkt is null`) — richtig so, das ist der
 * Check-out-Pfad. Der Sperrstempel trifft das Gegenteil: abgeschlossene
 * Zeilen. Permissive Policies werden ODER-verknuepft, also kommt eine zweite
 * dazu statt die erste zu weiten, und sie ist so eng wie moeglich: nur
 * abgeschlossene, noch nicht gesperrte, nicht stornierte Zeilen, und das
 * Ergebnis MUSS gesperrt sein. Zeiten kann sie nicht bewegen — das verbietet
 * `z_unveraenderlich` unabhaengig von jeder Policy.
 */
create policy z_definer_sperren on zeiteintrag as permissive for update to cse_definer
  using      (ende_zeitpunkt is not null and gesperrt_am is null
              and storniert_am is null and ersetzt_am is null)
  with check (gesperrt_am is not null);

-- ---------------------------------------------------------------------------
-- 5. Ausloeser auf stundenkonto_bewegung
-- ---------------------------------------------------------------------------

/**
 * `bewegung_sperre_pruefen` — in einen gesperrten Monat wird nicht gebucht.
 *
 * Und sie leitet auch nicht um. Der Ausloeser koennte die Buchung in den
 * ersten offenen Monat verschieben; er tut es ausdruecklich nicht. Welcher
 * Monat der richtige ist, welche Begruendung dransteht und auf welchen
 * gesperrten Monat sie sich bezieht, ist eine fachliche Entscheidung mit einem
 * Beleg dahinter — `services/zeit/stundenkonto.ts` trifft sie sichtbar und
 * schreibt `korrektur_fuer_stundenkonto_id`. Ein Ausloeser, der Zeilen
 * woandershin schreibt als der Aufrufer gesagt hat, ist die Sorte Magie, die
 * man erst bemerkt, wenn die Zahlen nicht mehr zusammenpassen.
 */
create function kern.bewegung_sperre_pruefen() returns trigger
language plpgsql as $$
declare v_status stundenkonto_status; v_jahr integer; v_monat integer;
begin
  select k.status, k.jahr, k.monat into v_status, v_jahr, v_monat
    from stundenkonto k where k.id = new.stundenkonto_id;

  if v_status = 'gesperrt' then
    raise exception 'Der Monat ist gesperrt'
      using errcode = 'check_violation',
            detail  = format('Stundenkonto %s/%s ist abgeschlossen.', v_monat, v_jahr),
            hint    = 'Die Buchung gehoert in den ersten offenen Monat, mit '
                      || 'korrektur_fuer_stundenkonto_id auf diesen (EMP-04, §12.2).';
  end if;

  /**
   * Eine Ausgleichsbuchung nennt ihren gesperrten Monat — und der muss
   * gesperrt sein. Ohne diese Pruefung liesse sich jede beliebige Buchung als
   * „Ausgleich" etikettieren, und `zk_sperre_ausgleich` (0036) haette einen
   * Beleg, der nichts belegt.
   */
  if new.korrektur_fuer_stundenkonto_id is not null then
    if new.korrektur_fuer_stundenkonto_id = new.stundenkonto_id then
      raise exception 'Eine Ausgleichsbuchung gleicht einen ANDEREN Monat aus'
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from stundenkonto k
                    where k.id = new.korrektur_fuer_stundenkonto_id
                      and k.status = 'gesperrt') then
      raise exception 'Ausgeglichen wird ein gesperrter Monat'
        using errcode = 'check_violation',
              hint    = 'Ist der Monat offen, gehoert die Korrektur direkt hinein.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_bewegung_1_sperre
  before insert on stundenkonto_bewegung
  for each row execute function kern.bewegung_sperre_pruefen();

/**
 * `bewegung_unveraenderlich` — anfuegend heisst anfuegend.
 *
 * Der Weg, eine falsche Buchung zurueckzunehmen, ist die Stornobuchung
 * (`storniert_bewegung_id`): sie steht daneben, mit ihrem eigenen Datum und
 * ihrem eigenen Grund. Ein UPDATE loeschte die Tatsache, dass zwischendurch
 * etwas anderes auf dem Konto stand — und genau die ist im Lohnstreit die
 * interessante.
 */
create function kern.bewegung_unveraenderlich() returns trigger
language plpgsql as $$
begin
  raise exception 'stundenkonto_bewegung ist anfuegend (EMP-04, Invariante 8)'
    using errcode = 'check_violation',
          hint    = 'Eine falsche Buchung wird storniert (storniert_bewegung_id), '
                    || 'nicht geaendert.';
end $$;

create trigger trg_bewegung_2_unveraenderlich
  before update or delete on stundenkonto_bewegung
  for each row execute function kern.bewegung_unveraenderlich();

/**
 * `bewegung_summe` — der einzige Schreiber von `ist_minuten` und
 * `korrektur_minuten`.
 *
 * Er rechnet die Summe NEU, statt die neue Zeile aufzuaddieren. Das ist der
 * Unterschied zwischen einem gefuehrten und einem gerechneten Saldo: ein
 * `+= new.minuten` ist einen Rollback, einen doppelten Ausloeser oder eine
 * Nebenlaeufigkeit von der Drift entfernt, und die Drift faellt nicht auf.
 *
 * `security definer`, weil die Sitzung, die eine Bewegung bucht, deswegen
 * noch kein UPDATE-Recht auf dem Konto haben muss — und weil das Konto genau
 * hier, und sonst nirgends, seine Summen bekommt.
 */
create function kern.bewegung_summe() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update stundenkonto k
     set ist_minuten = s.ist, korrektur_minuten = s.korrektur
    from (select coalesce(sum(b.minuten), 0) as ist,
                 coalesce(sum(b.minuten) filter (where b.art = 'korrektur'), 0) as korrektur
            from stundenkonto_bewegung b
           where b.stundenkonto_id = new.stundenkonto_id) s
   where k.id = new.stundenkonto_id;
  return null;
end $$;

create trigger trg_bewegung_3_summe
  after insert on stundenkonto_bewegung
  for each row execute function kern.bewegung_summe();

-- ---------------------------------------------------------------------------
-- 6. Zeilenschutz (01-KERN §6.24/§6.25, K-03, K-04, K-18, K-19)
-- ---------------------------------------------------------------------------

alter table stundenkonto enable row level security;
alter table stundenkonto force  row level security;
alter table stundenkonto_bewegung enable row level security;
alter table stundenkonto_bewegung force  row level security;

/**
 * **Gelesen wird mit `zeit.konto_lesen`, nicht mit `zeit.lesen`** — eine
 * bewusste Abweichung von der K-03-Standardform, und keine Geschmacksfrage.
 *
 * `zeit.lesen` ist im Katalog an die Rolle `kunde` BINDBAR (03-AUTH §12): ein
 * Kunde, der Leistungsnachweise sehen soll, kann es bekommen. Stuende das
 * Konto unter demselben Schluessel, saehe dieser Kunde die Arbeitszeitkonten
 * der Menschen, die bei ihm putzen — mit Sollzeit, Saldo und Ueberstunden.
 * Das ist genau die Vermischung, die EMP-13 verbietet, und sie faellt nicht
 * auf, weil sie wie eine gewaehrte Berechtigung aussieht.
 *
 * Geschrieben wird mit `zeit.schreiben` (K-03), gesperrt mit
 * `zeit.konto_abschliessen`: der Abschluss ist unumkehrbar und deshalb ein
 * eigenes Recht — dieselbe Trennung wie zwischen Rechnung schreiben und
 * Rechnung festschreiben.
 */
create policy t_mandant_lesen on stundenkonto for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.konto_lesen', app.aktiver_mandant())));

create policy t_mandant_anlegen on stundenkonto for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_mandant_aendern on stundenkonto for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.konto_lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant()))
              and (status <> 'gesperrt'
                   or (select app.hat_recht('zeit.konto_abschliessen', app.aktiver_mandant())))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on stundenkonto for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/**
 * Der Mensch sieht seine eigenen Konten — ueber ALLE Beschaeftigungen
 * (EMP-15). Das ist der Grund, warum die Personenansicht existiert: in
 * Mandanten-Scope zeigte dieselbe Abfrage nur eine der beiden Gesellschaften,
 * ohne Fehler und ohne Hinweis (K-18).
 */
create policy t_person on stundenkonto for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from anstellung a
                      where a.mandant_id = stundenkonto.mandant_id
                        and a.id = stundenkonto.anstellung_id
                        and a.person_id = app.aktuelle_person()));

/** Und im Mandanten-Scope dieselben eigenen Zeilen (01-KERN §6.24, EMP-03). */
create policy t_selbst_lesen on stundenkonto for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and exists (select 1 from anstellung a
                      where a.mandant_id = stundenkonto.mandant_id
                        and a.id = stundenkonto.anstellung_id
                        and a.person_id = app.aktuelle_person()));

create policy p_ma_decke on stundenkonto as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
/** Das Arbeitszeitkonto ist eine Beschaeftigungssache, kein Kundendokument (EMP-13). */
create policy p_kunde_decke on stundenkonto as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/** Der naechtliche Abgleich liest — und schreibt nichts (analog FIN-06). */
create policy t_job on stundenkonto for select to cse_job using (true);

/** `bewegung_summe` haelt die Summen; sein Schreibweg ist dieser. */
create policy sk_definer_summe on stundenkonto as permissive for update to cse_definer
  using (status <> 'gesperrt') with check (status <> 'gesperrt');
create policy sk_definer_lesen on stundenkonto for select to cse_definer using (true);

grant select, insert, update on stundenkonto to cse_app;
grant select, update on stundenkonto to cse_definer;
grant select on stundenkonto to cse_job;

-- ---------------------------------------------------------------------------

/**
 * Die Bewegung: lesen wie das Konto, schreiben mit `zeit.schreiben` — und
 * eine KORREKTUR zusaetzlich mit `zeit.konto_korrigieren`.
 *
 * Der Unterschied ist nicht kosmetisch. Eine Arbeitszeitbuchung folgt aus
 * einem freigegebenen Zeiteintrag; eine Korrektur ist eine Entscheidung eines
 * Menschen ueber den Lohn eines anderen, und sie faellt in einem Monat, dessen
 * Zahlen schon ausgegeben sind. Der Katalog bindet
 * `zeit.konto_korrigieren` deshalb nur an `super_admin` und macht sie fuer
 * `admin`/`leitung` bindbar.
 *
 * **Nur `INSERT`.** Kein UPDATE, kein DELETE — weder als Policy noch als
 * Grant. Eine Buchung wird storniert, nicht geaendert.
 */
create policy t_mandant_lesen on stundenkonto_bewegung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.konto_lesen', app.aktiver_mandant())));

create policy t_mandant_buchen on stundenkonto_bewegung for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant()))
              and (art <> 'korrektur'
                   or (select app.hat_recht('zeit.konto_korrigieren', app.aktiver_mandant())))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on stundenkonto_bewegung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/**
 * Der Kontoauszug des Menschen (EMP-03, EMP-04). Ueber das Konto, weil die
 * Bewegung selbst keine `anstellung_id` traegt — sie haengt an einem Konto,
 * und das Konto haengt an einer Beschaeftigung.
 */
create policy t_person on stundenkonto_bewegung for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and stundenkonto_id in (
               select k.id from stundenkonto k
                 join anstellung a on a.id = k.anstellung_id
                where a.person_id = app.aktuelle_person()));

create policy t_selbst_lesen on stundenkonto_bewegung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and stundenkonto_id in (
               select k.id from stundenkonto k
                 join anstellung a on a.id = k.anstellung_id
                where a.person_id = app.aktuelle_person()));

create policy p_ma_decke on stundenkonto_bewegung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or stundenkonto_id in (
              select k.id from stundenkonto k
                join anstellung a on a.id = k.anstellung_id
               where a.person_id = app.aktuelle_person()));
create policy p_kunde_decke on stundenkonto_bewegung as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

create policy t_job on stundenkonto_bewegung for select to cse_job using (true);
create policy sb_definer_lesen on stundenkonto_bewegung for select to cse_definer using (true);

-- Kein UPDATE, kein DELETE — auch nicht als Grant (§6.25).
grant select, insert on stundenkonto_bewegung to cse_app;
grant select on stundenkonto_bewegung to cse_definer;
grant select on stundenkonto_bewegung to cse_job;

-- ---------------------------------------------------------------------------
-- 7. Die Fremdschluessel, die 0036 und 0052 aufgeschoben haben (§14.4, §19)
-- ---------------------------------------------------------------------------

/**
 * 0036 §5 hat ihn woertlich hinterlegt und auf diese Tabelle gewartet. Er ist
 * das, was `zk_sperre_ausgleich` von einer Behauptung zu einem Beleg macht:
 * die Korrektur an einem gesperrten Monat zeigt auf die Buchung, mit der die
 * Differenz im ersten offenen Monat angekommen ist (EMP-04, §12.2).
 */
alter table zeiteintrag_korrektur add constraint zk_ausgleich_fk
  foreign key (mandant_id, ausgleich_bewegung_id)
  references stundenkonto_bewegung (mandant_id, id);

/** Dasselbe fuer den Einwand, dessen Anerkennung einen gesperrten Monat trifft. */
alter table zeit_einwand add constraint ze_korrektur_bewegung_fk
  foreign key (mandant_id, korrektur_bewegung_id)
  references stundenkonto_bewegung (mandant_id, id);

/**
 * NICHT hier: `sb_abwesenheit_fk`. Die Elterntabelle kommt mit PR 38.
 *
 *   alter table stundenkonto_bewegung add constraint sb_abwesenheit_fk
 *     foreign key (mandant_id, abwesenheit_id)
 *     references abwesenheit (mandant_id, id);        -- PR 38, EMP-10
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0060)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- stundenkonto (archiv): EMP-04, LEG-02, ACC-12. Der Monat ist die Bezugsgroesse eines gezahlten Lohns; ein geloeschtes Konto nimmt dem Vortrag des Folgemonats seine Grundlage und dem § 17-Nachweis seinen Rahmen. Beendet wird ein Monat durch `status = gesperrt`, nie durch DELETE.
create trigger trg_stundenkonto_kein_hard_delete
  before delete on stundenkonto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_stundenkonto_kein_truncate
  before truncate on stundenkonto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on stundenkonto from cse_app, cse_anon, cse_checkin, cse_job;

-- stundenkonto_bewegung (append): EMP-04, TIM-11, Invariante 8. Die Bewegungen SIND das Konto — eine geloeschte Buchung ist eine Stunde, die nie stattgefunden hat, und die Summe daneben stimmt danach trotzdem. Eine falsche Buchung wird storniert (`storniert_bewegung_id`), nie entfernt.
create trigger trg_stundenkonto_bewegung_kein_hard_delete
  before delete on stundenkonto_bewegung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_stundenkonto_bewegung_kein_truncate
  before truncate on stundenkonto_bewegung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on stundenkonto_bewegung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_stundenkonto_geaendert_am
  before update on stundenkonto
  for each row execute function kern.setze_geaendert_am();

create trigger trg_stundenkonto_audit
  after insert or update or delete on stundenkonto
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
