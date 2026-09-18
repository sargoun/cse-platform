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
   * (Invariante 1).
   *
   * **Eine gecachte Spalte, kein Zaehler.** Der Ausloeser unten SETZT sie auf
   * die Summe der Quelle und erhoeht sie nie — siehe die Begruendung dort.
   * Von Hand wird sie nicht gepflegt.
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
-- NEU GERECHNET aus der Quelle, nicht fortgeschrieben
-- =========================================================================

/**
 * **Eine addierende Fortschreibung zaehlt doppelt, und diese hier tat es.**
 *
 * Die erste Fassung addierte das Brutto bei jedem Uebergang nach
 * `freigegeben`. Ihre Wache war `if new.status <> 'freigegeben' or old.status
 * = 'freigegeben' then return new`, also feuerte sie bei JEDEM
 * `in_pruefung -> freigegeben`. `fin.eingangsrechnung_uebergang()` erlaubt
 * `freigegeben -> in_pruefung` ausdruecklich („Ruecknahme vor dem Buchen") und
 * danach wieder den Weg nach vorn: eine Ruecknahme zog nichts ab, das zweite
 * Freigeben addierte erneut. Eine direkt als `freigegeben` eingefuegte Zeile
 * wurde ueberhaupt nie gezaehlt — der Ausloeser hing nur am UPDATE.
 *
 * Das ist die Groesse, an der sich die Bagatellgrenze des §48 Abs. 2 EStG
 * messen soll, und die Tabelle ist append-only ohne Korrekturweg: die falsche
 * Zahl waere stehen geblieben und auf `/eingangsrechnungen/[id]/steuer` als
 * „Bereits erbrachte Gegenleistung" erschienen.
 *
 * **Deshalb wird nicht addiert, sondern aus der QUELLE gerechnet.**
 * `gegenleistung_cent` ist eine gecachte Spalte: sie wird auf `sum(brutto_cent)`
 * ueber `eingangsrechnung` GESETZT und nie erhoeht. Damit ist der Ausloeser
 * idempotent — zweimal freigeben, zurueckziehen und wieder freigeben, buchen:
 * jeder dieser Wege endet bei derselben Zahl, weil die Zahl die Quelle
 * abliest, statt eine eigene Geschichte zu erzaehlen.
 *
 * Gezaehlt wird nach dem LEISTUNGSJAHR und nicht nach dem Rechnungsdatum:
 * §48 misst das Kalenderjahr der Bauleistung. Fehlt `leistungsdatum`, gilt
 * `rechnungsdatum` — und das ist keine erfundene Regel, sondern derselbe
 * Rueckfall, den `STICHTAG_QUELLE = 'leistung_bis'` im Dienst benennt.
 *
 * Gezaehlt werden `freigegeben` UND `gebucht`: das Buchen nimmt nichts
 * zurueck, es fuehrt weiter. Nur Rechnungen mit `bauabzugsteuer_pflichtig`
 * zaehlen — die Grenze des §48 Abs. 2 misst Bauleistungen, nicht jeden
 * Einkauf bei derselben Firma.
 *
 * Die Summe muss stehen, BEVOR ueber den Einbehalt entschieden wird; danach
 * waere sie die Begruendung fuer eine Entscheidung, die schon gefallen ist.
 * Der Ausloeser haengt deshalb am Uebergang nach `freigegeben` und nicht am
 * Buchen — und weil er neu rechnet, haengt er zusaetzlich an jedem Uebergang,
 * der die Menge VERKLEINERT.
 */
create function fin.bauleistung_jahressumme_neu_rechnen(
  p_mandant uuid, p_lieferant uuid, p_jahr integer) returns void
language plpgsql set search_path = pg_catalog, public as $$
declare v_summe bigint;
begin
  if p_mandant is null or p_lieferant is null or p_jahr is null then return; end if;
  /*
   * Ausserhalb von 2000..2999 gibt es keine Zeile: der CHECK auf `jahr`
   * wiese den `insert` ab, und das brachte die ganze Freigabe zu Fall — eine
   * Eingangsrechnung mit verdrehtem Leistungsdatum sperrte damit einen
   * Vorgang, der mit der Jahressumme nichts zu tun hat.
   */
  if p_jahr < 2000 or p_jahr > 2999 then return; end if;

  select coalesce(sum(er.brutto_cent), 0) into v_summe
    from public.eingangsrechnung er
   where er.mandant_id = p_mandant
     and er.lieferant_id = p_lieferant
     and er.bauabzugsteuer_pflichtig
     and er.status in ('freigegeben', 'gebucht')
     and extract(year from coalesce(er.leistungsdatum, er.rechnungsdatum))::integer
         = p_jahr;

  /*
   * **Keine Zeile fuer eine Null, die noch nie eine Zahl war.**
   *
   * Der Ausloeser haengt seit dem Umbau auch am INSERT, und eine frisch
   * erfasste Eingangsrechnung steht in `eingegangen` oder `in_pruefung` —
   * gezaehlt wird sie also nicht, und die Summe ist 0. Eine Zeile dafuer
   * anzulegen hiesse, fuer jeden Lieferanten mit einer offenen Rechnung eine
   * Jahressumme von 0,00 € zu behaupten. Steht die Zeile schon, wird sie
   * sehr wohl auf 0 GESETZT: das ist die Ruecknahme, und sie muss sichtbar
   * sein.
   */
  if v_summe = 0 and not exists (
       select 1 from public.bauleistung_jahressumme j
        where j.mandant_id = p_mandant and j.lieferant_id = p_lieferant
          and j.jahr = p_jahr) then
    return;
  end if;

  insert into public.bauleistung_jahressumme
         (mandant_id, lieferant_id, jahr, gegenleistung_cent,
          erstellt_von_art, erstellt_von_dienst)
  values (p_mandant, p_lieferant, p_jahr, v_summe,
          'system', 'fin.bauleistung_jahressumme_neu_rechnen')
  on conflict (mandant_id, lieferant_id, jahr) do update
     set gegenleistung_cent    = v_summe,
         letzte_aktualisierung = now();
end $$;

comment on function fin.bauleistung_jahressumme_neu_rechnen(uuid, uuid, integer) is
  'FIN-10, LEG-06, §48 Abs. 2 EStG. Setzt gegenleistung_cent auf die Summe der '
  'freigegebenen und gebuchten bauabzugsteuerpflichtigen Eingangsrechnungen dieses '
  'Leistungsjahres. SETZEN und nicht addieren: eine addierende Fortschreibung '
  'zaehlte jede erneute Freigabe nach einer Ruecknahme doppelt.';

/**
 * Der Ausloeser deckt INSERT und UPDATE, und beim UPDATE beide betroffenen
 * Jahre.
 *
 * Ein UPDATE kann das Leistungsjahr, den Lieferanten oder die
 * Bauleistungseigenschaft selbst verschieben; dann sind ZWEI (mandant,
 * lieferant, jahr)-Schluessel neu zu rechnen — der alte und der neue. Beide
 * einzeln abzuziehen und aufzuschlagen waere dieselbe Arithmetik, die den
 * Fehler erzeugt hat. Neu gerechnet wird deshalb jeder beruehrte Schluessel
 * ganz.
 */
create function fin.bauleistung_jahressumme_fortschreiben() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_jahr_neu integer;
  v_jahr_alt integer;
begin
  if new.bauabzugsteuer_pflichtig and new.lieferant_id is not null then
    v_jahr_neu := extract(year from coalesce(new.leistungsdatum,
                                             new.rechnungsdatum))::integer;
    perform fin.bauleistung_jahressumme_neu_rechnen(
      new.mandant_id, new.lieferant_id, v_jahr_neu);
  end if;

  if tg_op = 'UPDATE' and old.bauabzugsteuer_pflichtig
     and old.lieferant_id is not null then
    v_jahr_alt := extract(year from coalesce(old.leistungsdatum,
                                             old.rechnungsdatum))::integer;
    /*
     * Derselbe Schluessel zweimal zu rechnen waere harmlos (die Funktion
     * setzt), aber zwei Schreibvorgaenge auf dieselbe Zeile in einer
     * Anweisung sind eine Einladung an den naechsten Leser, den Fall fuer
     * beabsichtigt zu halten.
     */
    if old.lieferant_id is distinct from new.lieferant_id
       or v_jahr_alt is distinct from v_jahr_neu
       or not new.bauabzugsteuer_pflichtig then
      perform fin.bauleistung_jahressumme_neu_rechnen(
        old.mandant_id, old.lieferant_id, v_jahr_alt);
    end if;
  end if;

  return new;
end $$;

create trigger er_9_bauleistung_jahressumme
  after insert or update on eingangsrechnung
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

/**
 * Die rechnende Funktion gehoert demselben Eigentuemer und ist derselbe
 * Definer — sie schreibt in `bauleistung_jahressumme` und LIEST
 * `eingangsrechnung`. `cse_definer` haelt fuer das Lesen `select` und die
 * Policy `d_eingangsrechnung_kennzahlen`; ohne `security definer` liefe sie
 * mit den Rechten dessen, der freigibt, und der haelt `eingang.freigeben` —
 * nicht zwangslaeufig `eingang.lesen` (D-388).
 */
alter function fin.bauleistung_jahressumme_neu_rechnen(uuid, uuid, integer)
  owner to cse_definer;
alter function fin.bauleistung_jahressumme_neu_rechnen(uuid, uuid, integer)
  security definer;
revoke all on function fin.bauleistung_jahressumme_neu_rechnen(uuid, uuid, integer)
  from public;

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
