-- 0177 — der Meldeweg für Barrieren (LEG-07, BFSG / EU 2019/882).
--
-- ===========================================================================
-- Warum das nicht dieselbe Tabelle ist wie die Betroffenenanfrage
-- ===========================================================================
--
-- Beide sind Formulare auf der öffentlichen Seite, und beide erzeugen eine
-- Antwortpflicht. Sie haben trotzdem verschiedene Rechtsgrundlagen, verschiedene
-- Fristen und verschiedene Empfänger:
--
--   Betroffenenanfrage  Art. 12 Abs. 3 DSGVO, ein Monat, Datenschutz.
--   Barrierebericht     BFSG, keine gesetzliche Frist, Redaktion/Technik.
--
-- Sie zusammenzulegen hiesse, die Monatsfrist auf etwas anzuwenden, für das sie
-- nicht gilt — und eine Barrieremeldung im Datenschutz-Posteingang liegen zu
-- lassen, wo sie niemand beheben kann.
--
-- ===========================================================================
-- Die E-Mail-Adresse ist FREIWILLIG, und das ist keine Nachlässigkeit
-- ===========================================================================
--
-- Der Meldeweg muss offen sein, auch für jemanden, der nichts über sich sagen
-- will. Wer eine Antwort möchte, hinterlässt eine Adresse; wer nur sagen will
-- „diese Tabelle ist mit dem Screenreader nicht lesbar", soll das können. Ein
-- Pflichtfeld hier wäre eine Hürde vor dem Weg, der Hürden melden soll.

create type barrierebericht_status as enum (
  'neu', 'in_bearbeitung', 'behoben', 'kein_mangel');

create table barrierebericht (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /** Wo — die Adresse, auf der es klemmt. Freitext: der Melder kennt keine Routen. */
  seite         text,
  /** Was — die Beschreibung. Das einzige Pflichtfeld. */
  beschreibung  text not null check (btrim(beschreibung) <> ''),
  /**
   * Womit — Screenreader, Vergrösserung, Tastatur, Sprachsteuerung. Freitext
   * und keine Liste: eine geschlossene Auswahl an Hilfsmitteln ist am Tag ihrer
   * Veröffentlichung unvollständig.
   */
  hilfsmittel   text,

  /** FREIWILLIG — siehe oben. NULL heisst: keine Antwort gewünscht oder möglich. */
  email         text check (email is null or email ~ '^[^@]+@[^@]+\.[a-z]{2,}$'),

  status        barrierebericht_status not null default 'neu',
  eingegangen_am timestamptz not null default now(),

  bearbeitet_am timestamptz,
  bearbeitet_von uuid references benutzer(id),
  antwort       text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint barrierebericht_mandant_uk unique (mandant_id, id),
  /**
   * Erledigt heisst: mit Zeitpunkt, mit benanntem Menschen und mit dem, was
   * getan wurde. Ein „behoben" ohne Beschreibung ist im nächsten Audit nichts
   * wert — und die Erklärung nach BFSG muss den Stand nennen.
   */
  constraint barrierebericht_erledigung_belegt check (
    status not in ('behoben', 'kein_mangel')
    or (bearbeitet_am is not null and bearbeitet_von is not null
        and btrim(coalesce(antwort, '')) <> ''))
);

comment on table barrierebericht is
  'LEG-07, BFSG. Der verpflichtende Meldeweg fuer Barrieren. Die E-Mail-Adresse ist '
  'FREIWILLIG: ein Pflichtfeld waere eine Huerde vor dem Weg, der Huerden melden soll.';

create index barrierebericht_offen_idx
  on barrierebericht (mandant_id, eingegangen_am)
  where status in ('neu', 'in_bearbeitung');

create trigger trg_barrierebericht_geaendert
  before update on barrierebericht
  for each row execute function kern.setze_geaendert_am();

alter table barrierebericht enable row level security;
alter table barrierebericht force  row level security;

/**
 * Das Recht ist `referenz.schreiben` — dasselbe, das die Website-Pflege traegt.
 * Wer den Auftritt pflegt, behebt auch seine Barrieren; ein eigener Schluessel
 * waere einer, den man anschliessend derselben Rolle zusaetzlich gibt (K-19).
 */
create policy t_barrierebericht_lesen on barrierebericht for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('referenz.schreiben', app.aktiver_mandant())));

create policy t_barrierebericht_bearbeiten on barrierebericht for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('referenz.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('referenz.schreiben', app.aktiver_mandant())));

/** Der Eingangsprinzipal legt an und liest nicht — wie bei 0176. */
create policy t_barrierebericht_eingang on barrierebericht for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('formular.schreiben', app.aktiver_mandant())));

grant select, update on barrierebericht to cse_app;
grant insert          on barrierebericht to cse_app;

-- ---------------------------------------------------------------------------
-- Keine Loeschung (Invariante 8) — erzeugt, siehe 0175.
-- ---------------------------------------------------------------------------

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0177)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- barrierebericht (archiv): LEG-07, BFSG. Die Barrierefreiheitserklaerung muss den STAND nennen, und der Stand ist die Summe der gemeldeten und behobenen Barrieren. Eine geloeschte Meldung ist eine, die es nie gab — und genau danach fragt eine Marktueberwachungsbehoerde.
create trigger trg_barrierebericht_kein_hard_delete
  before delete on barrierebericht
  for each row execute function kern.verhindere_loeschung();
create trigger trg_barrierebericht_kein_truncate
  before truncate on barrierebericht
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on barrierebericht from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
