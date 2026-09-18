-- 0221 — der strukturierte Entscheidungsnachweis zu Art. 15, 16 und 17
-- (LEG-09, SEC-A9).
--
-- ===========================================================================
-- Warum drei Tabellen und nicht eine Textspalte
-- ===========================================================================
--
-- `betroffenenanfrage.entscheidung` ist EINE Textspalte. Sie ist richtig fuer
-- das, was sie ist — die Mitteilung an die betroffene Person. Sie ist falsch
-- fuer drei andere Dinge, die das Gesetz verlangt:
--
--  * **Art. 15** — was ausgehaendigt wurde, muss belegbar bleiben (SEC-A9).
--    Ein Auskunftsumfang, der ueber zwei Dutzend Tabellen gezogen wird, ist
--    ohne Pruefsumme nicht dasselbe Dokument wie das, was ankam. Streitig ist
--    im Zweifel nicht DASS geantwortet wurde, sondern WAS drinstand.
--  * **Art. 16 + Art. 19** — wer einen falschen Wert bekommen hat, muss die
--    Berichtigung erfahren. Aus „wir haben das korrigiert" laesst sich nicht
--    ableiten, WELCHES Feld von welchem Wert auf welchen ging und wem es
--    vorher mitgeteilt wurde.
--  * **Art. 17 gegen die Aufbewahrungspflicht** — `04-SEITENKARTE` §5.25 sagt
--    ausdruecklich zu: „a decision record naming, PER FIELD and PER TABLE,
--    whether erasure is owed or overridden by a retention obligation". Eine
--    Zusage in Prosa ist Freitext; hier steht eine Zeile je Tabelle.
--
-- **Keine dieser Tabellen loescht etwas.** Die Berichtigung geschieht im
-- zustaendigen Editor (dort sitzen die Schreibrechte und die Pruefungen), die
-- Loeschung durch Anonymisierung. Hier steht die ENTSCHEIDUNG — und was aus
-- ihr noch nicht folgt, steht als offene Frage daneben statt als plausibel
-- gesetztes Ergebnis.

-- ---------------------------------------------------------------------------
-- 1. Art. 15 — das ausgehaendigte Artefakt
-- ---------------------------------------------------------------------------

create type datenschutz_auskunft_format as enum ('md', 'json');

create table datenschutz_auskunft (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  anfrage_id    uuid not null,
  constraint datenschutz_auskunft_anfrage_fk
    foreign key (mandant_id, anfrage_id)
    references betroffenenanfrage (mandant_id, id),

  format        datenschutz_auskunft_format not null,

  /**
   * Der Umfang als Struktur, nicht als Satz: je Abschnitt der Schluessel, die
   * Zeilenzahl und ob er lesbar WAR. Ein Abschnitt, den die erteilenden
   * Rechte nicht oeffnen, ist kein leerer Abschnitt — und genau dieser
   * Unterschied ist der, den ein halb gefuellter Art.-15-Export verwischt.
   */
  umfang        jsonb not null,

  abschnitte    smallint not null check (abschnitte >= 0),
  zeilen        integer  not null check (zeilen >= 0),

  /**
   * **Vollstaendig heisst: kein Abschnitt war gesperrt.** Ein unvollstaendiger
   * Export darf entstehen (fuer die interne Sicht), aber er traegt sein
   * Kennzeichen mit — sonst sieht er aus wie eine Antwort.
   */
  vollstaendig  boolean not null,

  /**
   * SHA-256 ueber den kanonischen Inhalt, ohne Abrufzeit — dieselbe Bauart wie
   * ACC-10 und das Verarbeitungsverzeichnis (D-485, D-589): zwei Abrufe
   * desselben Standes tragen denselben Abdruck, und ein geaenderter Stand
   * einen anderen.
   */
  sha256        char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),

  erzeugt_am    timestamptz not null default now(),
  erzeugt_von   uuid not null references benutzer(id),

  constraint datenschutz_auskunft_mandant_uk unique (mandant_id, id)
);

comment on table datenschutz_auskunft is
  'LEG-09, Art. 15 DSGVO, SEC-A9. WAS ausgehaendigt wurde — mit Umfang, '
  'Pruefsumme und benanntem Menschen. Die Textspalte betroffenenanfrage.'
  'entscheidung ist die MITTEILUNG; das hier ist der Nachweis.';

comment on column datenschutz_auskunft.vollstaendig is
  'false heisst: mindestens ein Abschnitt war mit den erteilten Rechten nicht '
  'lesbar. Ein unvollstaendiger Art.-15-Export ohne Kennzeichen ist schlimmer '
  'als keiner — er sieht aus wie eine Antwort.';

create index datenschutz_auskunft_anfrage_idx
  on datenschutz_auskunft (mandant_id, anfrage_id, erzeugt_am desc);

-- ---------------------------------------------------------------------------
-- 2. Art. 16 — je strittiges Feld eine Zeile
-- ---------------------------------------------------------------------------

create type berichtigung_ergebnis as enum (
  'offen',       -- aufgenommen, noch nicht entschieden
  'berichtigt',  -- der Wert wurde im zustaendigen Editor geaendert
  'abgelehnt',   -- der gespeicherte Wert ist richtig, mit Begruendung
  'ergaenzt');   -- Art. 16 Satz 2: Vervollstaendigung statt Korrektur

create table berichtigung_feld (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  anfrage_id    uuid not null,
  constraint berichtigung_feld_anfrage_fk
    foreign key (mandant_id, anfrage_id)
    references betroffenenanfrage (mandant_id, id),

  /**
   * Tabelle und Feld als TEXT und nicht als Referenz auf einen Katalog.
   *
   * Ein Katalog waere eine zweite Wahrheit ueber das Schema, die beim ersten
   * Umbau veraltet — und eine Berichtigung, deren Feld aus dem Katalog
   * gefallen ist, waere nicht mehr lesbar. Der Nachweis muss den Namen
   * ueberleben, den das Schema ihm zur Zeit der Entscheidung gab.
   */
  tabelle       text not null check (btrim(tabelle) <> ''),
  feld          text not null check (btrim(feld) <> ''),

  /** Was gespeichert IST — zum Zeitpunkt der Aufnahme, als Text. */
  wert_gespeichert text,
  /** Was die Person als richtig angibt. */
  wert_behauptet   text,
  /** Woher der gespeicherte Wert stammt: Arbeitsvertrag, Selbstauskunft, Formular. */
  quelle           text,

  ergebnis      berichtigung_ergebnis not null default 'offen',
  begruendung   text,

  berichtigt_am  timestamptz,
  berichtigt_von uuid references benutzer(id),

  /**
   * Art. 19 DSGVO: der Verantwortliche teilt jedem EMPFAENGER, dem die
   * unrichtigen Daten offengelegt wurden, die Berichtigung mit. Wer das war,
   * weiss die Plattform nicht von sich aus — Lohnbuero, Auftraggeber,
   * Behoerde stehen nicht als Empfaengerliste im System. Also steht hier, wen
   * ein Mensch benannt hat, und ob er unterrichtet wurde.
   */
  art19_empfaenger      text,
  art19_unterrichtet_am timestamptz,

  erfasst_am    timestamptz not null default now(),
  erfasst_von   uuid not null references benutzer(id),
  geaendert_am  timestamptz,

  constraint berichtigung_feld_mandant_uk unique (mandant_id, id),
  constraint berichtigung_feld_je_feld_uk unique (mandant_id, anfrage_id, tabelle, feld),

  /** Berichtigt oder ergaenzt heisst: mit Zeitpunkt und benanntem Menschen. */
  constraint berichtigung_feld_vollzug_belegt check (
    ergebnis not in ('berichtigt', 'ergaenzt')
    or (berichtigt_am is not null and berichtigt_von is not null)),

  /** Abgelehnt heisst: mit Begruendung. Ohne sie ist die Ablehnung keine. */
  constraint berichtigung_feld_ablehnung_begruendet check (
    ergebnis <> 'abgelehnt' or btrim(coalesce(begruendung, '')) <> '')
);

comment on table berichtigung_feld is
  'LEG-09, Art. 16 und Art. 19 DSGVO. Je strittigem Feld: was gespeichert ist, '
  'was die Person als richtig angibt, woher der Wert stammt, und was daraus '
  'wurde. Die Aenderung selbst geschieht im zustaendigen Editor — hier steht '
  'der Nachweis, und die Art.-19-Unterrichtung daneben.';

create index berichtigung_feld_anfrage_idx
  on berichtigung_feld (mandant_id, anfrage_id, tabelle, feld);

-- ---------------------------------------------------------------------------
-- 3. Art. 17 gegen die Aufbewahrungspflicht — je Tabelle und Feld eine Zeile
-- ---------------------------------------------------------------------------

create type loeschentscheidung_ergebnis as enum (
  /** Loeschung ist geschuldet — keine Pflicht steht dagegen. */
  'geschuldet',
  /** Eine Aufbewahrungspflicht ueberlagert sie; das Datum sagt, bis wann. */
  'ueberlagert',
  /** Die Rechtslage ist offen — die Zeile nennt die offene Frage. */
  'offen',
  /** Anonymisierung statt Loeschung: der Beleg bleibt, der Personenbezug faellt. */
  'anonymisierung');

create table loeschentscheidung (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  anfrage_id    uuid not null,
  constraint loeschentscheidung_anfrage_fk
    foreign key (mandant_id, anfrage_id)
    references betroffenenanfrage (mandant_id, id),

  tabelle       text not null check (btrim(tabelle) <> ''),
  /** NULL heisst: die ganze Zeile, nicht ein einzelnes Feld. */
  feld          text,

  /** Wie viele Zeilen es in dieser Tabelle zu dieser Person gibt. */
  zeilen        integer not null default 0 check (zeilen >= 0),

  ergebnis      loeschentscheidung_ergebnis not null,

  /**
   * Die Pflicht, die die Loeschung ueberlagert — als Fundstelle, nicht als
   * Gefuehl. „§ 147 Abs. 1 AO, zehn Jahre", „§ 17 Abs. 2 MiLoG, zwei Jahre",
   * „Unveraenderlichkeit des Protokolls (SEC-A9)", „Hashkette der Rechnungen
   * (Invariante 4)", „§ 7 UWG — der Widerspruch ist der Beweis".
   */
  rechtsgrundlage text,

  /**
   * Der Tag, an dem die Sperre faellt. Ein Datum, keine Dauer: „zehn Jahre"
   * ist ohne Anker keine Frist, und der Anker ist je Zeile ein anderer
   * (Entstehung des Belegs, Ende des Jahres, Austritt).
   */
  sperre_faellt_am date,

  /** Die offene Frage, wenn `ergebnis = 'offen'` — z. B. `O-71`, `O-113`. */
  offene_frage  text,

  bemerkung     text,

  entschieden_am  timestamptz not null default now(),
  entschieden_von uuid not null references benutzer(id),
  geaendert_am    timestamptz,

  constraint loeschentscheidung_mandant_uk unique (mandant_id, id),

  /** Ueberlagert heisst: mit Fundstelle. Ohne sie ist es „wir behalten das". */
  constraint loeschentscheidung_ueberlagerung_begruendet check (
    ergebnis <> 'ueberlagert'
    or btrim(coalesce(rechtsgrundlage, '')) <> ''),

  /** Offen heisst: mit benannter offener Frage, nicht mit Schweigen. */
  constraint loeschentscheidung_offen_benannt check (
    ergebnis <> 'offen' or btrim(coalesce(offene_frage, '')) <> '')
);

comment on table loeschentscheidung is
  'LEG-09, Art. 17 DSGVO gegen LEG-01/LEG-02. Je Tabelle (und Feld) eine '
  'Zeile: geschuldet, ueberlagert, anonymisierung oder offen — mit Fundstelle '
  'und dem Tag, an dem die Sperre faellt. 04-SEITENKARTE §5.25: '
  'datenschutz.loeschung_pruefen LOESCHT NICHT, es entscheidet.';

comment on column loeschentscheidung.sperre_faellt_am is
  'Der ERSTE Tag, an dem geloescht werden darf — nicht der letzte Tag der '
  'Aufbewahrung. Ein Datum, keine Dauer: „Zehn Jahre" ohne Anker ist keine '
  'Frist, und der Anker ist je Zeile ein anderer. Beide Rechenwege in '
  'loeschentscheidung.ts (aoFrist, milogFrist) liefern genau diese Bedeutung; '
  'zwei Bedeutungen in einer Spalte waeren ein Tag Unterschied, den niemand '
  'sieht.';

/**
 * Eine Entscheidung je Tabelle und Feld — als INDEX mit `coalesce`, nicht als
 * UNIQUE-Bedingung.
 *
 * In einem UNIQUE ist NULL von NULL verschieden. `unique (mandant_id,
 * anfrage_id, tabelle, feld)` haette deshalb genau den Fall NICHT gefangen,
 * fuer den es gedacht war: dieselbe Tabelle beliebig oft als „ganze Zeile"
 * (feld is null) entscheiden — vier Zeilen zu `zeiteintrag`, zwei davon
 * widersprechen sich, und welche gilt, sagt die Sortierung.
 */
create unique index loeschentscheidung_je_ort_uk
  on loeschentscheidung (mandant_id, anfrage_id, tabelle, coalesce(feld, ''));

create index loeschentscheidung_anfrage_idx
  on loeschentscheidung (mandant_id, anfrage_id, tabelle);
create index loeschentscheidung_sperre_idx
  on loeschentscheidung (mandant_id, sperre_faellt_am)
  where ergebnis = 'ueberlagert' and sperre_faellt_am is not null;

-- ---------------------------------------------------------------------------
-- Geaendert-Stempel
-- ---------------------------------------------------------------------------
--
-- `datenschutz_auskunft` bekommt KEINEN: ein ausgehaendigtes Artefakt wird
-- nicht geaendert. Wer einen anderen Umfang aushaendigt, haendigt ein zweites
-- aus — mit eigener Pruefsumme, eigener Zeit und eigenem Namen darunter.

create trigger trg_berichtigung_feld_geaendert
  before update on berichtigung_feld
  for each row execute function kern.setze_geaendert_am();

create trigger trg_loeschentscheidung_geaendert
  before update on loeschentscheidung
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- **Lesen: wer den Vorgang sieht, sieht seine Entscheidungen.**
-- `app.darf_betroffenenanfrage()` (0220) ist genau dasselbe Praedikat wie auf
-- `betroffenenanfrage`. Ein engeres Leserecht hier hiesse: die Bearbeiterin
-- sieht den Vorgang und nicht, was an ihm schon entschieden wurde — und
-- entscheidet zweimal.
--
-- **Schreiben: je Artikel sein eigenes Recht.** Das ist der Grund, warum der
-- Katalog drei Rechte fuehrt. Wer berichtigen darf, faellt damit keine
-- Loeschentscheidung, und wer Auskunft erteilt, berichtigt nichts.

alter table datenschutz_auskunft enable row level security;
alter table datenschutz_auskunft force  row level security;

create policy t_datenschutz_auskunft_lesen on datenschutz_auskunft
  for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.darf_betroffenenanfrage()));

create policy t_datenschutz_auskunft_anlegen on datenschutz_auskunft
  for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('datenschutz.auskunft_erstellen',
                                        app.aktiver_mandant())));

grant select, insert on datenschutz_auskunft to cse_app;

alter table berichtigung_feld enable row level security;
alter table berichtigung_feld force  row level security;

create policy t_berichtigung_feld_lesen on berichtigung_feld
  for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.darf_betroffenenanfrage()));

create policy t_berichtigung_feld_anlegen on berichtigung_feld
  for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('datenschutz.berichtigung_bearbeiten',
                                        app.aktiver_mandant())));

create policy t_berichtigung_feld_bearbeiten on berichtigung_feld
  for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('datenschutz.berichtigung_bearbeiten',
                                        app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('datenschutz.berichtigung_bearbeiten',
                                        app.aktiver_mandant())));

grant select, insert, update on berichtigung_feld to cse_app;

alter table loeschentscheidung enable row level security;
alter table loeschentscheidung force  row level security;

create policy t_loeschentscheidung_lesen on loeschentscheidung
  for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.darf_betroffenenanfrage()));

create policy t_loeschentscheidung_anlegen on loeschentscheidung
  for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('datenschutz.loeschung_pruefen',
                                        app.aktiver_mandant())));

create policy t_loeschentscheidung_bearbeiten on loeschentscheidung
  for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('datenschutz.loeschung_pruefen',
                                        app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('datenschutz.loeschung_pruefen',
                                        app.aktiver_mandant())));

grant select, insert, update on loeschentscheidung to cse_app;

-- ---------------------------------------------------------------------------
-- Der Definer-Leseweg fuer die Benachrichtigungen einer FREMDEN Person
-- ---------------------------------------------------------------------------
--
-- **Der Befund, ohne den die Art.-15-Auskunft still unvollstaendig waere.**
-- `benachrichtigung` hat fuer `cse_app` genau eine Lesepolicy:
-- `t_benachrichtigung_eigene` mit `empfaenger_id = app.aktueller_benutzer()`.
-- Die zweite (`t_benachrichtigung_job_lesen`) gehoert `cse_job`. Kein Recht
-- oeffnet das — auch `datenschutz.auskunft_erstellen` nicht.
--
-- Der Abschnitt „Benachrichtigungen" einer Auskunft ueber eine ANDERE Person
-- waere damit immer leer, und leer sieht aus wie „es gibt keine". Genau der
-- Fehler, den ein halb gefuellter Art.-15-Export macht.
--
-- Die Funktion prueft ihr Recht ausdruecklich (als Definer erbt sie keines),
-- bindet den Mandanten selbst und schreibt eine Protokollzeile je Abruf: wer
-- die Benachrichtigungen eines fremden Menschen liest, tut das im Rahmen einer
-- Art.-15-Auskunft, und diese Auskunft ist selbst nachweispflichtig.

/**
 * **`cse_definer` braucht Recht UND Policy, nicht nur das Eigentum** (K-01).
 *
 * `alter function … owner to cse_definer` allein liest null Zeilen: die Rolle
 * haette keinen Grant auf `benachrichtigung` und keine Policy, und eine
 * `SECURITY DEFINER`-Funktion ohne Zeilen schreibt keinen Fehler, sie gibt
 * eine leere Antwort. Genau der Fehler, den `definer-eigentum.test.ts`
 * beschreibt. Also beides, und die Policy so eng wie die Funktion:
 * ausschliesslich der aktive Mandant.
 */
grant select on benachrichtigung to cse_definer;

create policy d_benachrichtigung_auskunft on benachrichtigung
  for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

create function app.benachrichtigung_auskunft(p_person uuid)
returns table (art text, titel text, "text" text, gelesen_am timestamptz,
               erstellt_am timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Die Art.-15-Auskunft ist nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('datenschutz.auskunft_erstellen', app.aktiver_mandant()) then
    raise exception 'datenschutz.auskunft_erstellen fehlt'
      using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere('datenschutz.benachrichtigung_gelesen', 'person',
                            p_person::text, null, null, app.aktiver_mandant());

  return query
    select b.art, b.titel, b.text, b.gelesen_am, b.erstellt_am
      from public.benachrichtigung b
      join public.benutzer u on u.id = b.empfaenger_id
     where u.person_id = p_person
       and b.mandant_id = app.aktiver_mandant()
     order by b.erstellt_am desc;
end $$;

comment on function app.benachrichtigung_auskunft(uuid) is
  'LEG-09, Art. 15 DSGVO. Der EINZIGE Leseweg auf die Benachrichtigungen einer '
  'fremden Person: cse_app liest sonst nur die eigenen '
  '(t_benachrichtigung_eigene). Prueft das Recht selbst und protokolliert '
  'jeden Abruf.';

-- K-01: jede NEUE Definer-Funktion gehoert `cse_definer`, nicht der Rolle,
-- die die Migration ausfuehrt (das ist `postgres`, Superuser mit BYPASSRLS).
-- Sonst laeuft sie an JEDER Policy vorbei, und die Policy oben waere Zierde.
alter function app.benachrichtigung_auskunft(uuid) owner to cse_definer;

grant execute on function app.benachrichtigung_auskunft(uuid) to cse_app;
/*
 * K-08: `create function` erteilt PUBLIC automatisch EXECUTE, und das
 * `grant` darueber FUEGT HINZU — es ersetzt nichts. Ohne diese Zeile haelt
 * jede Rolle das Ausfuehrungsrecht auf einem Leser FREMDER Personendaten,
 * `cse_anon` eingeschlossen. Dieselbe Reihenfolge wie 0031:552, 0040:1070,
 * 0069:636 und 0073:641.
 */
revoke all on function app.benachrichtigung_auskunft(uuid) from public;

-- ---------------------------------------------------------------------------
-- Keine Loeschung (Invariante 8)
-- ---------------------------------------------------------------------------
--
-- Erzeugt aus `src/server/db/schema/rls.ts` — `pnpm db:triggers` schreibt neu.
-- Von Hand gesetzte Ausloeser sind der Weg, auf dem 0172 danebenlag (siehe 0175).

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0221)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- datenschutz_auskunft (append): LEG-09, Art. 15 DSGVO, SEC-A9. Das ausgehaendigte Artefakt mit seiner Pruefsumme. Streitig ist im Zweifel nicht DASS geantwortet wurde, sondern WAS drinstand — eine geloeschte Zeile ist von einer nie erteilten Auskunft nicht zu unterscheiden, und die Beweislast liegt beim Verantwortlichen.
create trigger trg_datenschutz_auskunft_kein_hard_delete
  before delete on datenschutz_auskunft
  for each row execute function kern.verhindere_loeschung();
create trigger trg_datenschutz_auskunft_kein_truncate
  before truncate on datenschutz_auskunft
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on datenschutz_auskunft from cse_app, cse_anon, cse_checkin, cse_job;

-- berichtigung_feld (append): LEG-09, Art. 16 und Art. 19 DSGVO. Je Feld der gespeicherte Wert, der behauptete und die Entscheidung. Der gespeicherte Wert existiert nach der Berichtigung nur noch hier; ohne diese Zeile ist die Art.-19-Unterrichtung nicht belegbar und der alte Wert unwiederbringlich.
create trigger trg_berichtigung_feld_kein_hard_delete
  before delete on berichtigung_feld
  for each row execute function kern.verhindere_loeschung();
create trigger trg_berichtigung_feld_kein_truncate
  before truncate on berichtigung_feld
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on berichtigung_feld from cse_app, cse_anon, cse_checkin, cse_job;

-- loeschentscheidung (append): LEG-09, Art. 17 DSGVO gegen LEG-01/LEG-02. Der Entscheidungsnachweis je Tabelle und Feld, den 04-SEITENKARTE §5.25 zusagt: geschuldet, ueberlagert oder offen, mit Fundstelle. Eine loeschbare Loeschentscheidung ist der Widerspruch in sich selbst.
create trigger trg_loeschentscheidung_kein_hard_delete
  before delete on loeschentscheidung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_loeschentscheidung_kein_truncate
  before truncate on loeschentscheidung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on loeschentscheidung from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
