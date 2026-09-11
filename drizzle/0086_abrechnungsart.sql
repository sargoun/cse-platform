-- ===========================================================================
-- 0086 — Die fuenf Abrechnungsarten: `abrechnungsart`, `abrechnungsintervall`,
--        `leistungszeitraum_modus` und `vertrag_abrechnung`
--        (FIN-01, FIN-05, FIN-08…FIN-11, O-04)
--
-- Vertrag: `docs/architecture/02-datenmodell/02-CRM-OPERATIONS.md` §2 und §3.2
-- („vertrag_abrechnung"). Der ENUM `abrechnungsart` gehoert diesem Kapitel
-- (K-21); `05-FINANZEN.md` §0.2 verbraucht ihn und legt ihn ausdruecklich
-- NICHT selbst an. Wo dieser Text und eine Konvention (K-nn) auseinandergehen,
-- gilt die Konvention.
--
-- Drei Entscheidungen tragen diese Migration, und keine davon ist Geschmack:
--
--  1. **Die Abrechnungskonfiguration ist eine ZEITLICH GESCHNITTENE Zeile,
--     keine Spaltengruppe auf `auftrag`.** Ein Vertrag, der zum 1. Januar von
--     Stundenlohn auf Monatspauschale wechselt, ergibt zwei Zeilen und keine
--     ueberschriebene. Rechnungen sind unveraenderlich und kettengebunden
--     (FIN-06, K-12) — eine Abrechnungsgrundlage, die sich fuer einen
--     vergangenen Zeitraum nicht mehr rekonstruieren laesst, ist eine
--     dauerhafte Luecke im Pruefpfad.
--
--  2. **`abrechnungsart` steht NICHT im Ausschlussschluessel** (02-CRM §3.2,
--     review B8). Stuende sie dort, koennten `stundenbasiert` und
--     `monatspauschale` am 15. Maerz gleichzeitig fuer denselben Auftrag
--     gelten — das Gegenteil des Zwecks —, und der Abrechnungslauf schluege
--     zwei Rechnungen fuer einen Zeitraum vor. Doppelt fakturiert erreicht das
--     eine festgeschriebene, gehashte, unveraenderliche Rechnung, bevor es
--     jemandem auffaellt.
--
--  3. **Kein DEFAULT auf `leistungszeitraum_modus`, `abrechnungsintervall`
--     und `abrechnungsart`.** FIN-05 nennt den Leistungszeitraum das am
--     haeufigsten fehlende Pflichtfeld und haelt fest, dass sein Fehlen dem
--     Kunden den Vorsteuerabzug kostet. Ein Vorgabewert waehlte diese Regel
--     still — und O-04 ist offen.
--
-- NICHT in dieser Migration, jeweils mit dem PR, der sie bringt:
--  · `abschlagsplan`, `abschlagsrechnung_bezug` (FIN-08, PR 50).
--  · `rechnungsposition_quelle` (FIN-07, PR 49).
--  · die §13b- und §48-Ermittlung selbst (FIN-09/FIN-10, PR 51). Die beiden
--    Flaggen hier sind die VERTRAGLICH vereinbarte Position, nicht der
--    Nachweis; der wird am Leistungsdatum aus `kunde_bauleistender_status`
--    bzw. `freistellungsbescheinigung` gelesen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die drei Aufzaehlungstypen (02-CRM §2)
-- ---------------------------------------------------------------------------

/**
 * PLATZHALTER — abgeleitet aus dem Wortlaut von SPEC FIN-01. Die fuenf NAMEN
 * stehen in der Spezifikation; ihre REGELN stehen nirgends.
 *
 * Der Typ ist trotzdem ein ENUM und kein Freitext: ein Tippfehler in einer
 * Abrechnungsart ist eine Rechnung, die der Abrechnungslauf nie findet, und
 * eine Strategie, die es nicht gibt, soll an der Datenbank scheitern und nicht
 * an einer Kartenabfrage im Dienst. Kommt eine sechste Art hinzu, ist das EIN
 * `alter type … add value`, EINE Klasse und EINE Registerzeile — der
 * Rechnungsdienst bleibt unberuehrt.
 *
 * // TODO(client, O-04): sind dies exakt die fuenf Abrechnungsarten?
 * Bezeichnung, Rundung und Satzbasis je Art bestaetigen.
 */
create type abrechnungsart as enum
  ('stundenbasiert', 'monatspauschale', 'festpreis_los', 'einheitspreis_aufmass', 'einzelabruf');

comment on type abrechnungsart is
  'PLATZHALTER (O-04): die fuenf Abrechnungsarten aus FIN-01. Eigentuemer des '
  'Vokabulars ist 02-CRM-OPERATIONS.md §2 (K-21).';

/**
 * PLATZHALTER — die Rhythmen, in denen abgerechnet wird.
 * // TODO(client, O-73): Abrechnungsrhythmen je Abrechnungsart bestaetigen.
 */
create type abrechnungsintervall as enum
  ('einmalig', 'monatlich', 'quartalsweise', 'halbjaehrlich', 'jaehrlich', 'nach_leistung');

/**
 * Abgeleitet aus SPEC FIN-05 (der Leistungszeitraum ist Pflicht; dies sagt,
 * WIE er hergeleitet wird). OHNE Vorgabewert — siehe Kopfkommentar Punkt 3.
 * // TODO(client, O-54): Wie wird der Leistungszeitraum je Abrechnungsart
 * ermittelt — Kalendermonat, nach Leistungsnachweis oder manuell?
 */
create type leistungszeitraum_modus as enum
  ('kalendermonat', 'nach_leistungsnachweis', 'manuell');

-- ---------------------------------------------------------------------------
-- 2. Zwei Mengeneinheiten, die die Strategien brauchen (§3.2, BT-130)
-- ---------------------------------------------------------------------------

/**
 * `min` und `tag` — und warum sie noetig sind, statt „Stunde" zu genuegen.
 *
 * Eine Stundenlohnzeile ist die Summe erfasster MINUTEN. In Stunden mit drei
 * Nachkommastellen ausgedrueckt ist 100 Minuten `1,667` — und `1,667 × 25,00 €`
 * ist 41,68 €, waehrend `100 × 25,00 € / 60` 41,67 € ergibt. Ein Cent, zweimal
 * im Monat, auf einem Beleg, der sich nicht mehr aendern laesst. Die Zeile
 * fuehrt deshalb MINUTEN als Menge und den Stundensatz ueber
 * `preis_basismenge = 60` (BT-149/150) — dann ist die Zeile exakt und in sich
 * nachrechenbar.
 *
 * `tag` ist derselbe Fall fuer den angebrochenen Monat: 15 von 31 Kalender-
 * tagen sind als Bruchteil eines Monats nicht darstellbar, als `15 Tage je
 * 31 Tage` dagegen exakt.
 *
 * Beide als PLATZHALTER wie die sechs aus `0075`.
 * // TODO(client, O-174): Bestaetigen Sie die Zuordnung Ihrer Mengeneinheiten
 * zu den UN/ECE-Rec-20-Codes — hier „min" (MIN) und „Tag" (DAY).
 */
insert into masseinheit (schluessel, bezeichnung, unece_code, ist_platzhalter) values
  ('min', 'min', 'MIN', true),
  ('tag', 'Tag', 'DAY', true);

-- ---------------------------------------------------------------------------
-- 3. vertrag_abrechnung (02-CRM §3.2)
-- ---------------------------------------------------------------------------

create table vertrag_abrechnung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  auftrag_id    uuid not null,
  /**
   * NULL heisst „der GANZE Auftrag" — siehe die Ausschlussbedingung unten.
   * // TODO(client, O-53): Kann ein Auftrag gleichzeitig unterschiedlich
   * abgerechnete Positionen enthalten (Unterhaltsreinigung als Monatspauschale,
   * Sonderreinigung nach Stunden im selben Vertrag)?
   */
  auftrag_leistung_id uuid,

  abrechnungsart abrechnungsart not null,

  /**
   * Die strategieeigenen Parameter, je Abrechnungsart mit Zod geprueft.
   *
   * **Hier steht KEIN Geldbetrag.** Geld lebt in den getippten Cent-Spalten
   * darunter; ein Betrag in einem jsonb waere eine Zahl ohne Typ, ohne
   * Waehrung und ohne die Wache, die `numeric` von `bigint` unterscheidet
   * (Invariante 1). Was hier steht, sind die offenen REGELN aus O-04 —
   * Minutenrundung, Teilmonatsbehandlung, abrechenbare Aufmasszustaende —,
   * und solange ein Schluessel fehlt, verweigert die Strategie die
   * Festschreibung, statt eine plausible Zahl zu erfinden.
   */
  parameter     jsonb not null default '{}'::jsonb,

  -- Ganze Cent (Invariante 1). Je Art verlangt, siehe die drei CHECKs.
  pauschale_netto_cent   bigint,
  stundensatz_cent       bigint,
  festpreis_netto_cent   bigint,
  -- Eine Menge ist kein Geld (K-16).
  mindestabnahme_stunden numeric(12,3),

  abrechnungsintervall   abrechnungsintervall not null,
  leistungszeitraum_modus leistungszeitraum_modus not null,

  -- Uebersteuert `kunde.zahlungsziel_tage` (§4.2). OHNE Vorgabewert (O-66).
  zahlungsziel_tage      smallint,
  skonto_prozent_bp      integer,
  skonto_tage            smallint,

  /**
   * FIN-09/FIN-10: die vertraglich vereinbarte Position, nicht der Nachweis.
   * Ob tatsaechlich verlagert bzw. einbehalten wird, entscheidet die
   * Finanzschicht am LEISTUNGSDATUM aus `kunde_bauleistender_status` bzw.
   * `freistellungsbescheinigung` (PR 51).
   */
  reverse_charge_13b       boolean not null default false,
  unterliegt_bauabzugsteuer boolean not null default false,

  -- FIN-11: die Uebersteuerung je Vertrag (BT-10 / BT-13).
  leitweg_id    text,
  bestellnummer text,
  kostenstelle  text,

  gueltig_ab    date not null,
  -- EINSCHLIESSLICH (02-CRM §0.5), wie auf `auftrag_leistung`.
  gueltig_bis   date,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint vertrag_abrechnung_mandant_uk unique (mandant_id, id),
  constraint va_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  /**
   * Der ENKEL-Schluessel: die Leistungszeile muss zu DIESEM Auftrag gehoeren.
   * Ohne ihn konfiguriert eine Zeile die Abrechnung einer Leistung aus einem
   * fremden Auftrag — und das faellt erst auf der Rechnung auf, die dann an
   * den falschen Kunden geht.
   */
  constraint va_auftrag_leistung_fk foreign key (mandant_id, auftrag_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, auftrag_id, id),

  constraint va_gueltigkeit check (gueltig_bis is null or gueltig_bis >= gueltig_ab),

  -- Je Art vollstaendig. Was eine Art zum Rechnen braucht, muss dastehen —
  -- sonst rechnet die Strategie mit NULL und liefert null Euro.
  constraint va_monatspauschale_vollstaendig check (
    abrechnungsart <> 'monatspauschale' or pauschale_netto_cent is not null),
  constraint va_stundenbasiert_vollstaendig check (
    abrechnungsart <> 'stundenbasiert' or stundensatz_cent is not null),
  constraint va_festpreis_vollstaendig check (
    abrechnungsart <> 'festpreis_los' or festpreis_netto_cent is not null),
  /**
   * `einheitspreis_aufmass` verlangt bepreiste `auftrag_leistung`- bzw.
   * `lv_position`-Zeilen und `einzelabruf` verlangt nichts — beides spannt
   * ueber Tabellen und wird deshalb in
   * `src/server/services/finanz/abrechnungsart/` geprueft, nicht hier
   * (02-CRM §3.2).
   */

  -- Definitorische Schranken, keine Geschaeftsregeln.
  constraint va_betraege_nicht_negativ check (
    coalesce(pauschale_netto_cent, 0) >= 0
    and coalesce(stundensatz_cent, 0) >= 0
    and coalesce(festpreis_netto_cent, 0) >= 0),
  constraint va_mindestabnahme_nicht_negativ check (
    mindestabnahme_stunden is null or mindestabnahme_stunden >= 0),
  constraint va_zahlungsziel_nicht_negativ check (
    zahlungsziel_tage is null or zahlungsziel_tage >= 0),
  constraint va_skonto_bereich check (
    skonto_prozent_bp is null or skonto_prozent_bp between 0 and 10000),
  -- Die Klammern des Entwurfs schlossen VOR dem Vergleich, der Ausdruck war
  -- damit unvollstaendig (02-CRM §3.2).
  constraint va_skonto_paarweise check (
    (skonto_prozent_bp is null) = (skonto_tage is null)),
  -- Ein jsonb-Skalar oder -Array haette keine Schluessel, die eine Strategie
  -- lesen koennte; `{}` ist die leere Konfiguration, nicht `null`.
  constraint va_parameter_objekt check (jsonb_typeof(parameter) = 'object')
);

/**
 * EINE Konfiguration je Geltungsbereich und Zeitraum.
 *
 * `coalesce(auftrag_leistung_id, '000…0')` faltet „der ganze Auftrag" in den
 * Schluessel: ohne diese Faltung vergleicht GiST zwei NULL nie als gleich, und
 * zwei auftragsweite Konfigurationen koennten sich beliebig ueberlappen.
 */
alter table vertrag_abrechnung add constraint va_kein_ueberlapp
  exclude using gist (
    auftrag_id with =,
    coalesce(auftrag_leistung_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(gueltig_ab, coalesce(gueltig_bis + 1, 'infinity'::date), '[)') with &&);

-- Die aktuelle Abrechnungskonfiguration eines Auftrags.
create index va_auftrag_idx on vertrag_abrechnung (mandant_id, auftrag_id, gueltig_ab desc);
/**
 * Der Abrechnungslauf — und NICHT partiell (review B9). Ein
 * `where gueltig_bis is null` schloss jede zum 15. Maerz beendete
 * Konfiguration aus; die Leistung vom 1. bis 15. Maerz wurde nie berechnet,
 * und das faellt im Jahresabschluss auf, nicht im Maerz.
 */
create index va_lauf_idx on vertrag_abrechnung
  (mandant_id, abrechnungsart, abrechnungsintervall, gueltig_ab, gueltig_bis);
-- Die §48-EStG-Arbeitsliste.
create index va_bauabzug_idx on vertrag_abrechnung (auftrag_id)
  where unterliegt_bauabzugsteuer;

comment on table vertrag_abrechnung is
  'FIN-01: wie dieser Auftrag abgerechnet wird — eine der fuenf Abrechnungs'
  'arten mit ihren Parametern, gueltig fuer einen Zeitraum. PLATZHALTER-'
  'Vokabular bis O-04 beantwortet ist.';
comment on column vertrag_abrechnung.parameter is
  'Strategieeigene Parameter (O-04), je Abrechnungsart Zod-geprueft. Enthaelt '
  'KEINEN Geldbetrag — Geld steht in den getippten Cent-Spalten.';
comment on column vertrag_abrechnung.gueltig_bis is
  'EINSCHLIESSLICH (02-CRM §0.5). Der Abrechnungslauf fragt mit einer '
  'Bereichsueberlappung, nicht mit einem Stichtag.';

-- ---------------------------------------------------------------------------
-- 4. Zeilenschutz (K-03, K-04, K-18)
-- ---------------------------------------------------------------------------

alter table vertrag_abrechnung enable row level security;
alter table vertrag_abrechnung force  row level security;

create policy t_mandant on vertrag_abrechnung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('abrechnung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('abrechnung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on vertrag_abrechnung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.abrechnung.lesen')));

/**
 * KEINE Kundenpolicy und keine Mitarbeiterpolicy (02-CRM §3.2:
 * „internal-only ceiling — billing configuration is not customer-facing").
 * Der Stundensatz, zu dem wir abrechnen, ist die Marge; EMP-13 haelt sie von
 * der Kraft vor Ort fern, und der Kunde sieht das Ergebnis auf der Rechnung,
 * nicht die Regel dahinter.
 */
create policy p_intern_decke on vertrag_abrechnung as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on vertrag_abrechnung to cse_app;
grant select on vertrag_abrechnung to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0086)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- vertrag_abrechnung (archiv): FIN-01, FIN-06, K-12. Die Zeile ist die Grundlage, auf der eine festgeschriebene und gehashte Rechnung entstanden ist. Geloescht liesse sich ein vergangener Abrechnungszeitraum nicht mehr rekonstruieren — eine dauerhafte Luecke im Pruefpfad. Abgeloest wird sie durch gueltig_bis, nie durch DELETE.
create trigger trg_vertrag_abrechnung_kein_hard_delete
  before delete on vertrag_abrechnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_vertrag_abrechnung_kein_truncate
  before truncate on vertrag_abrechnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on vertrag_abrechnung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_vertrag_abrechnung_geaendert_am
  before update on vertrag_abrechnung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_vertrag_abrechnung_audit
  after insert or update or delete on vertrag_abrechnung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
