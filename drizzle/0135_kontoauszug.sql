-- ===========================================================================
-- 0135 — Der Kontoauszug und sein Abgleich (PR 61, ACC-04, FIN-14)
-- ===========================================================================
--
-- **Es gibt keine Bankanbindung, und es wird keine vorgetaeuscht.** Kein
-- PSD2, kein FinTS, keine ausgehende SEPA-Datei, kein Abrufstatus. Die Bank
-- stellt einen CAMT.053-Auszug bereit, ein MENSCH laedt ihn hoch, und diese
-- Tabellen halten fest, was darin stand.
--
-- **Drei Tabellen, und jede hat einen eigenen Grund.**
--
--   `kontoauszug`   — die DATEI. Ihr Pruefwert macht den zweiten Import
--                     derselben Datei zu einem Nichtereignis (Abnahme 1).
--   `kontoumsatz`   — die ZEILE. Sie bleibt, auch wenn niemand sie zuordnen
--                     kann; ein Umsatz, der aus der Ansicht verschwindet,
--                     weil er nicht passt, ist der Fehler, der den Saldo
--                     erklaerungsbeduerftig macht (Abnahme 4).
--   `umsatz_zuordnung` — die BRUECKE zur Zahlung. Sie ist widerrufbar, und
--                     der Widerruf laesst beide Seiten stehen.
--
-- **Der Umsatz ist KEINE Zahlung.** Er ist die Behauptung der Bank, dass Geld
-- geflossen ist. Die `zahlung` entsteht erst, wenn jemand — ein Mensch oder
-- ein eindeutiger Treffer — sie anlegt. Die beiden zu verschmelzen hiesse,
-- dass jeder unzugeordnete Umsatz als Zahlung in der Buchhaltung staende.

create type kontoauszug_status as enum ('eingelesen', 'abgeglichen', 'verworfen');

comment on type kontoauszug_status is
  'ACC-04. eingelesen = die Zeilen stehen. abgeglichen = jede Zeile ist '
  'entschieden (zugeordnet oder ausdruecklich als "gehoert zu keiner '
  'Rechnung" vermerkt). verworfen = die Datei war die falsche; die Zeile '
  'bleibt, weil eine geloeschte eine Luecke waere.';

create type umsatz_zustand as enum (
  /** Frisch eingelesen, noch nicht angesehen. */
  'offen',
  /** Ein eindeutiger Treffer hat eine Zahlung angelegt. */
  'zugeordnet',
  /** Mehrere Kandidaten oder keiner — die Schlange fuer Menschen. */
  'in_klaerung',
  /** Ein Mensch sagt: gehoert zu keiner Rechnung (Gebuehr, Zins, Privat). */
  'ohne_bezug'
);

-- ---------------------------------------------------------------------------
-- 1. kontoauszug — die Datei
-- ---------------------------------------------------------------------------

create table kontoauszug (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  bankkonto_id          uuid not null,

  /** `Stmt/Id` aus der Datei — wie die Bank ihren Auszug nennt. */
  auszug_id             text not null check (length(btrim(auszug_id)) > 0),
  von                   date,
  bis                   date,

  status                kontoauszug_status not null default 'eingelesen',

  /**
   * **Der Pruefwert der DATEI, und darauf steht ein eindeutiger Index.**
   *
   * Das ist Abnahme (1): dieselbe Datei ein zweites Mal einlesen fuegt nichts
   * hinzu. Ueber den Inhalt und nicht ueber `auszug_id`, denn zwei Banken
   * vergeben ihre Auszugsnummern unabhaengig voneinander — und derselbe
   * Zaehlerstand bei zwei Instituten waere sonst ein Duplikat, das keines ist.
   */
  datei_sha256          text not null check (datei_sha256 ~ '^[0-9a-f]{64}$'),
  /** Das abgelegte Dokument. NULL, solange kein Speicher verbunden ist. */
  dokument_id           uuid,

  anfangssaldo_cent     bigint,
  endsaldo_cent         bigint,
  zeilen                integer not null default 0 check (zeilen >= 0),

  verwerfungsgrund      text,

  aufbewahrung_klasse   text not null default 'buchungsbeleg',
  aufbewahrung_bis      date,
  loeschsperre          boolean not null default true,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint kontoauszug_mandant_uk unique (mandant_id, id),
  constraint kontoauszug_spanne check (bis is null or von is null or bis >= von),
  constraint kontoauszug_bankkonto_fk foreign key (mandant_id, bankkonto_id)
    references bankkonto (mandant_id, id),
  constraint kontoauszug_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),
  constraint kontoauszug_verworfen_begruendet check (
    status <> 'verworfen' or length(btrim(coalesce(verwerfungsgrund, ''))) >= 5),
  constraint kontoauszug_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

/** Abnahme (1): derselbe Inhalt kommt genau einmal herein. */
create unique index kontoauszug_datei_uk on kontoauszug (mandant_id, datei_sha256);

create index kontoauszug_konto_idx on kontoauszug (mandant_id, bankkonto_id, von desc);

comment on table kontoauszug is
  'ACC-04. Eine EINGELESENE CAMT.053-Datei. Es gibt keinen Abruf bei der '
  'Bank und keinen Abrufstatus — ein Mensch laedt die Datei hoch.';

-- ---------------------------------------------------------------------------
-- 2. kontoumsatz — die Zeile
-- ---------------------------------------------------------------------------

create table kontoumsatz (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  kontoauszug_id        uuid not null,

  /** Die Reihenfolge in der Datei — damit die Ansicht sie wiedergibt. */
  laufnummer            integer not null check (laufnummer > 0),

  /**
   * Die Richtung steht in der Spalte, NIE im Vorzeichen (wie bei `zahlung`,
   * 0121). `betrag_cent` ist immer positiv.
   */
  richtung              zahlung_richtung not null,
  betrag_cent           bigint not null check (betrag_cent > 0),
  waehrung              text not null default 'EUR' check (waehrung = 'EUR'),

  buchungsdatum         date not null,
  valuta                date,

  referenz              text,
  verwendungszweck      text not null default '',
  gegenpartei           text,
  gegen_iban            text,

  /** `false` bei einer Vormerkung (`PDNG`) — sie wird nicht zugeordnet. */
  gebucht               boolean not null default true,

  zustand               umsatz_zustand not null default 'offen',
  /** Warum er ohne Bezug ist — Pflicht, sonst steht dort nur ein Haken. */
  klaerungsnotiz        text,

  /**
   * Was der Abgleich VORGESCHLAGEN hat, im Klartext. Nicht die Entscheidung,
   * sondern ihre Begruendung — damit in der Schlange steht, warum eine Zeile
   * dort liegt, und nicht nur, dass sie dort liegt.
   */
  vorschlag_art         text,
  vorschlag_text        text,

  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint kontoumsatz_mandant_uk unique (mandant_id, id),
  constraint kontoumsatz_auszug_fk foreign key (mandant_id, kontoauszug_id)
    references kontoauszug (mandant_id, id),
  constraint kontoumsatz_lauf_uk unique (kontoauszug_id, laufnummer),
  /**
   * **Ohne Bezug heisst MIT Grund.** Sonst steht in der Auswertung „37
   * Umsaetze ohne Bezug" und niemand weiss mehr, ob das Bankgebuehren waren
   * oder eine vergessene Rechnung. Dieselbe Ueberlegung wie
   * `zz_differenz_begruendet` (0121).
   */
  constraint kontoumsatz_ohne_bezug_begruendet check (
    zustand <> 'ohne_bezug' or length(btrim(coalesce(klaerungsnotiz, ''))) >= 5)
);

create index kontoumsatz_offen_idx on kontoumsatz (mandant_id, zustand, buchungsdatum)
  where zustand in ('offen', 'in_klaerung');

comment on table kontoumsatz is
  'ACC-04. Eine Zeile aus einem Kontoauszug. Sie ist KEINE Zahlung, sondern '
  'die Behauptung der Bank, dass Geld geflossen ist — die Zahlung entsteht '
  'erst bei der Zuordnung. Ein Umsatz verschwindet nie aus der Ansicht, auch '
  'wenn niemand ihn zuordnen kann.';

-- ---------------------------------------------------------------------------
-- 3. umsatz_zuordnung — die Bruecke, und sie ist widerrufbar
-- ---------------------------------------------------------------------------

create table umsatz_zuordnung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  kontoumsatz_id        uuid not null,
  zahlung_id            uuid not null,

  /**
   * Wer zugeordnet hat: `automatisch` nur bei einem EINDEUTIGEN Treffer
   * (Betrag UND Nummer UND IBAN), sonst `mensch`. Die Spalte ist die
   * Antwort auf „wie kam diese Zuordnung zustande" — und ohne sie liesse
   * sich nach einem Fehlgriff nicht sagen, ob die Regel oder ein Mensch
   * danebenlag.
   */
  automatisch           boolean not null,
  begruendung           text not null check (length(btrim(begruendung)) >= 5),

  widerrufen_am         timestamptz,
  widerrufsgrund        text,
  widerrufen_von        uuid references benutzer(id),

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint uz_mandant_uk unique (mandant_id, id),
  constraint uz_umsatz_fk foreign key (mandant_id, kontoumsatz_id)
    references kontoumsatz (mandant_id, id),
  constraint uz_zahlung_fk foreign key (mandant_id, zahlung_id)
    references zahlung (mandant_id, id),
  constraint uz_widerruf_stimmig check (
    (widerrufen_am is null) = (widerrufsgrund is null)
    and (widerrufsgrund is null or length(btrim(widerrufsgrund)) >= 5)),
  constraint uz_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

/**
 * **Ein Umsatz traegt hoechstens EINE gueltige Zuordnung.**
 *
 * Zwei gleichzeitig hiessen, dass dieselbe Banktransaktion zwei Zahlungen
 * begruendet — und die Rechnung waere doppelt bezahlt. Der Index laesst
 * widerrufene stehen: der Widerruf ist der Weg zur zweiten, und die erste
 * bleibt als Aufzeichnung.
 */
create unique index uz_ein_umsatz_eine_zuordnung on umsatz_zuordnung (kontoumsatz_id)
  where widerrufen_am is null;

comment on table umsatz_zuordnung is
  'ACC-04. Die Bruecke zwischen einer Auszugszeile und einer Zahlung. '
  'Widerrufbar, und der Widerruf laesst beide Seiten stehen — er nimmt nur '
  'die Verbindung zurueck.';

-- ---------------------------------------------------------------------------
-- 4. Unveraenderlichkeit und Zustandswege
-- ---------------------------------------------------------------------------

/**
 * Eine eingelesene Zeile aendert sich nicht mehr — was die Bank gesagt hat,
 * bleibt stehen.
 *
 * Beweglich ist nur, was der MENSCH danach entscheidet: der Zustand, seine
 * Notiz und der Vorschlagstext. Betrag, Datum, Zweck und Gegenpartei sind
 * die Aussage der Bank; sie zu aendern hiesse, den Auszug umzuschreiben.
 */
create function fin.kontoumsatz_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus text[] := array[
    'zustand', 'klaerungsnotiz', 'vorschlag_art', 'vorschlag_text',
    'geaendert_am', 'geaendert_von', 'geaendert_von_art'];
begin
  if (to_jsonb(old) - v_aus) = (to_jsonb(new) - v_aus) then return new; end if;
  raise exception
    'Kontoumsatz %: was die Bank gesagt hat, bleibt stehen (ACC-04).', old.id
    using errcode = 'restrict_violation',
          hint = 'Beweglich sind Zustand und Notiz — nicht Betrag, Datum oder Zweck.';
end $$;

create trigger kontoumsatz_unveraenderlich
  before update on kontoumsatz
  for each row execute function fin.kontoumsatz_unveraenderlich();

create trigger kontoumsatz_geaendert
  before update on kontoumsatz
  for each row execute function kern.setze_geaendert_am();

create trigger kontoauszug_geaendert
  before update on kontoauszug
  for each row execute function kern.setze_geaendert_am();

create trigger kontoauszug_aufbewahrung
  before insert or update on kontoauszug
  for each row execute function fin.aufbewahrung_aus_klasse('bis');

/**
 * **Eine Zuordnung wird WIDERRUFEN, nicht geaendert.**
 *
 * Ohne diesen Riegel liesse sich `zahlung_id` umbiegen, und die
 * Aufzeichnung „dieser Umsatz war einmal jener Zahlung zugeordnet" waere
 * weg — genau die Aufzeichnung, die nach einem Fehlgriff gebraucht wird.
 */
create function fin.uz_nur_widerruf() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus text[] := array['widerrufen_am', 'widerrufsgrund', 'widerrufen_von'];
begin
  if (to_jsonb(old) - v_aus) = (to_jsonb(new) - v_aus) then
    if old.widerrufen_am is not null
       and new.widerrufen_am is distinct from old.widerrufen_am then
      raise exception
        'Zuordnung %: ein Widerruf wird nicht zurueckgenommen.', old.id
        using errcode = 'restrict_violation',
              hint = 'Eine neue Zuordnung ist eine neue Zeile.';
    end if;
    return new;
  end if;
  raise exception
    'Zuordnung %: sie wird widerrufen, nicht geaendert (ACC-04).', old.id
    using errcode = 'restrict_violation',
          hint = 'Umbiegen loeschte die Aufzeichnung, welche Zahlung einmal gemeint war.';
end $$;

create trigger uz_nur_widerruf
  before update on umsatz_zuordnung
  for each row execute function fin.uz_nur_widerruf();

-- ---------------------------------------------------------------------------
-- 5. RLS und Rechte (K-03, K-04, D-388)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['kontoauszug', 'kontoumsatz', 'umsatz_zuordnung'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);

    /*
     * Lesen `buchhaltung.lesen`, schreiben `zahlung.schreiben`: wer den
     * Auszug ansieht, ordnet damit noch keine Zahlung zu. Der Katalog trennt
     * die beiden seit 0008, und hier ist die Stelle, an der die Trennung
     * etwas bedeutet — eine Zuordnung legt eine `zahlung` an.
     */
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('buchhaltung.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('zahlung.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;
end $$;

grant select, insert, update on kontoauszug, kontoumsatz, umsatz_zuordnung to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0135)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- kontoauszug (archiv): ACC-04, ACC-06, LEG-01, GoBD. Der eingelesene Auszug ist der Nachweis, WAS die Bank gemeldet hat — er traegt Anfangs- und Endsaldo und den Pruefwert der Datei. Ihn zu loeschen liesse die Umsaetze auf einen Auszug zeigen, den es nicht mehr gibt, und die Frage, woher eine Zahlung kam, waere nicht mehr zu beantworten. Ein falscher Auszug wird VERWORFEN und neu eingelesen; die Zeile bleibt.
create trigger trg_kontoauszug_kein_hard_delete
  before delete on kontoauszug
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kontoauszug_kein_truncate
  before truncate on kontoauszug
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kontoauszug from cse_app, cse_anon, cse_checkin, cse_job;

-- kontoumsatz (append): ACC-04, LEG-01, GoBD. Eine Auszugszeile verschwindet nicht — auch dann nicht, wenn niemand sie zuordnen kann. Genau das ist die Zusage: ein unzugeordneter Umsatz bleibt sichtbar, statt aus der Ansicht zu fallen und den Saldo unerklaerlich zu machen. Wer ihn fuer gegenstandslos haelt, setzt zustand = ohne_bezug MIT Grund.
create trigger trg_kontoumsatz_kein_hard_delete
  before delete on kontoumsatz
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kontoumsatz_kein_truncate
  before truncate on kontoumsatz
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kontoumsatz from cse_app, cse_anon, cse_checkin, cse_job;

-- umsatz_zuordnung (append): ACC-04, LEG-01. Die Bruecke zwischen Auszugszeile und Zahlung ist widerrufbar, nicht loeschbar: der Widerruf ist selbst die Aufzeichnung, dass hier einmal eine andere Zuordnung stand. Sie zu loeschen naehme genau die Spur, die nach einem Fehlgriff gebraucht wird — und liesse offen, ob eine Regel oder ein Mensch danebenlag.
create trigger trg_umsatz_zuordnung_kein_hard_delete
  before delete on umsatz_zuordnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_umsatz_zuordnung_kein_truncate
  before truncate on umsatz_zuordnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on umsatz_zuordnung from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
