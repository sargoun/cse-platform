-- 0182 — `bauleistung_jahressumme` (05-FINANZEN.md §8.6; FIN-10, LEG-06,
-- §48 Abs. 2 EStG).
--
-- ===========================================================================
-- §48 EStG hat DREI Ausgaenge, nicht zwei
-- ===========================================================================
--
--   1. Es liegt eine am Leistungsdatum gueltige Freistellungsbescheinigung
--      nach §48b vor  →  kein Einbehalt.
--   2. Die Gegenleistung an DIESEN Leistenden bleibt im Kalenderjahr unter
--      der Bagatellgrenze des §48 Abs. 2  →  kein Einbehalt.
--   3. Sonst  →  15 % Einbehalt.
--
-- Der MITTLERE Ausgang war ohne diese Tabelle nicht darstellbar: die Grenze
-- misst sich an der Jahressumme je Leistungsempfaenger, und die liess sich
-- nirgends ablesen. Ein Abzugsbildschirm mit zwei Ausgaengen sieht
-- vollstaendig aus und ist es nicht — er verschweigt den einen Fall, in dem
-- ein Einbehalt rechtswidrig waere.
--
-- **Die Grenze selbst ist NICHT entschieden** (O-21). `BAGATELLGRENZE_PLATZHALTER`
-- in `services/finanz/estg48/grenzen.platzhalter.ts` traegt `grenzeCent: null`,
-- und solange das so ist, wird IMMER einbehalten — die haftungsfreie Richtung.
-- Dieser Zweig wird also heute nie erreicht. Er wird trotzdem jetzt gebaut,
-- weil die Summe LAUFEND entstehen muss: eine Tabelle, die erst angelegt wird,
-- wenn die Antwort kommt, hat am Tag der Antwort keine Vergangenheit, und die
-- Grenze misst ein Kalenderjahr.

create table bauleistung_jahressumme (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  lieferant_id          uuid not null,
  jahr                  integer not null check (jahr between 2000 and 2999),

  /**
   * Die bereits erbrachte Gegenleistung dieses Kalenderjahres, in Cent
   * (Invariante 1). Fortgeschrieben vom Ausloeser unten, nicht von Hand.
   */
  gegenleistung_cent    bigint not null default 0 check (gegenleistung_cent >= 0),

  /**
   * Die ERWARTETE Jahresgegenleistung, wo der Vertrag eine nennt — §48 Abs. 1
   * knuepft an das an, was voraussichtlich zu zahlen ist, nicht allein an das
   * schon Gezahlte. **Von einem Menschen eingetragen und nie geschaetzt:** ein
   * abgeleiteter Wert waere eine Prognose, die die Plattform behauptet und
   * niemand verantwortet.
   */
  prognose_cent         bigint check (prognose_cent is null or prognose_cent >= 0),
  prognose_grundlage    text,

  letzte_aktualisierung timestamptz not null default now(),

  erstellt_von_art      akteur_art not null default 'system',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text not null default 'fin.bauleistung_jahressumme',
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint bauleistung_jahressumme_mandant_uk unique (mandant_id, id),
  constraint blj_schluessel_uk unique (mandant_id, lieferant_id, jahr),
  constraint blj_prognose_begruendet check (
    prognose_cent is null or length(btrim(coalesce(prognose_grundlage, ''))) >= 3),
  constraint blj_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),
  constraint blj_lieferant_fk foreign key (mandant_id, lieferant_id)
    references lieferant (mandant_id, id)
);

comment on table bauleistung_jahressumme is
  'FIN-10, LEG-06, §48 Abs. 2 EStG. Die laufende Gegenleistung je Kalenderjahr und '
  'Leistendem — die Groesse, an der sich die Bagatellgrenze misst. Die Grenze selbst '
  'ist offen (O-21); solange sie null ist, wird immer einbehalten.';

comment on column bauleistung_jahressumme.prognose_cent is
  '§48 Abs. 1 EStG knuepft an die VORAUSSICHTLICHE Gegenleistung an. Von einem '
  'Menschen eingetragen, nie abgeleitet.';

create index blj_jahr_idx on bauleistung_jahressumme (mandant_id, jahr);

create trigger trg_blj_geaendert
  before update on bauleistung_jahressumme
  for each row execute function kern.setze_geaendert_am();

-- =========================================================================
-- Fortgeschrieben beim Uebergang nach `freigegeben` — VOR der Abzugsentscheidung
-- =========================================================================

/**
 * Die Summe muss stehen, BEVOR ueber den Einbehalt entschieden wird; danach
 * waere sie die Begruendung fuer eine Entscheidung, die schon gefallen ist.
 * Der Ausloeser haengt deshalb am Uebergang nach `freigegeben` und nicht am
 * Buchen.
 *
 * Gezaehlt wird nach dem LEISTUNGSJAHR und nicht nach dem Rechnungsdatum:
 * §48 misst das Kalenderjahr der Bauleistung. Fehlt `leistungsdatum`, gilt
 * `rechnungsdatum` — und das ist keine erfundene Regel, sondern derselbe
 * Rueckfall, den `STICHTAG_QUELLE = 'leistung_bis'` im Dienst benennt.
 *
 * Nur Rechnungen, die `bauabzugsteuer_pflichtig` tragen, zaehlen: die Grenze
 * des §48 Abs. 2 misst Bauleistungen, nicht jeden Einkauf bei derselben Firma.
 */
create function fin.bauleistung_jahressumme_fortschreiben() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_jahr integer;
begin
  if new.status <> 'freigegeben' or old.status = 'freigegeben' then return new; end if;
  if not new.bauabzugsteuer_pflichtig then return new; end if;
  if new.lieferant_id is null then return new; end if;

  v_jahr := extract(year from coalesce(new.leistungsdatum, new.rechnungsdatum))::integer;
  if v_jahr is null then return new; end if;

  insert into public.bauleistung_jahressumme
         (mandant_id, lieferant_id, jahr, gegenleistung_cent,
          erstellt_von_art, erstellt_von_dienst)
  values (new.mandant_id, new.lieferant_id, v_jahr, coalesce(new.brutto_cent, 0),
          'system', 'fin.bauleistung_jahressumme_fortschreiben')
  on conflict (mandant_id, lieferant_id, jahr) do update
     set gegenleistung_cent = public.bauleistung_jahressumme.gegenleistung_cent
                            + coalesce(new.brutto_cent, 0),
         letzte_aktualisierung = now();
  return new;
end $$;

create trigger er_9_bauleistung_jahressumme
  after update on eingangsrechnung
  for each row execute function fin.bauleistung_jahressumme_fortschreiben();

-- =========================================================================
-- RLS — Modul `eingang`, rein intern
-- =========================================================================

alter table bauleistung_jahressumme enable row level security;
alter table bauleistung_jahressumme force  row level security;

create policy t_mandant on bauleistung_jahressumme for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('eingang.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('eingang.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on bauleistung_jahressumme for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.eingang.lesen')));

create policy p_intern_ceiling on bauleistung_jahressumme
  as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

grant select, insert, update on bauleistung_jahressumme to cse_app;

/**
 * Der Ausloeser laeuft mit den Rechten DESSEN, der die Eingangsrechnung
 * freigibt — also mit `eingang.freigeben`, nicht zwangslaeufig mit
 * `eingang.schreiben`. Damit der `insert` unter der Policy oben durchgeht,
 * braucht `cse_definer` hier Grant und Policy (D-388), und die Funktion
 * gehoert ihm.
 */
grant select, insert, update on bauleistung_jahressumme to cse_definer;
create policy d_blj_schreiben on bauleistung_jahressumme for all to cse_definer
  using      (mandant_id = any (app.sichtbare_mandanten()))
  with check (mandant_id = any (app.sichtbare_mandanten()));

alter function fin.bauleistung_jahressumme_fortschreiben() owner to cse_definer;
alter function fin.bauleistung_jahressumme_fortschreiben() security definer;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0182)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- bauleistung_jahressumme (append): FIN-10, LEG-06, §48 Abs. 2 EStG. Die Jahressumme ist der Nachweis, WARUM einbehalten oder nicht einbehalten wurde. Sie zu loeschen nimmt jeder Abzugsentscheidung dieses Jahres ihre Grundlage — und der Leistende haftet mit.
create trigger trg_bauleistung_jahressumme_kein_hard_delete
  before delete on bauleistung_jahressumme
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bauleistung_jahressumme_kein_truncate
  before truncate on bauleistung_jahressumme
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bauleistung_jahressumme from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
