-- ===========================================================================
-- 0075 — Die Ausgangsrechnung: globale Steuerreferenz, rechnung,
--        rechnungsposition, rechnung_zuschlag, rechnung_steuer,
--        rechnung_beziehung
--        (FIN-02, FIN-03, FIN-04, FIN-06, FIN-16, TEN-02, LEG-01,
--         Invarianten 1, 2, 3, 4, 8)
--
-- Vertrag: `docs/architecture/02-datenmodell/05-FINANZEN.md` §1, §2, §3.1,
-- §3.2, §4.1, §4.3, §4.5, §4.8, §13. Wo dieser Text und eine Konvention
-- (K-nn) auseinandergehen, gilt die Konvention.
--
-- Drei Dinge entscheiden die Form dieser Migration, und keines davon ist
-- Geschmack:
--
--  1. **Auf der Rechnungszeile steht nichts, was sich nach dem Festschreiben
--     noch aendert** (K-12). Deshalb gibt es hier keine Spalte `versendet_am`
--     und keine Spalte `storniert_durch_rechnung_id`. Der Versand steht in
--     `rechnung_versand` (PR 52), die Storno-Rueckbeziehung in
--     `rechnung_beziehung` unten. Nur so bleibt der Unveraenderlichkeits-
--     ausloeser in 0076 OHNE Spaltenliste — und eine Spaltenliste in genau
--     diesem Ausloeser liesse Invariante 4 auf Datenbankebene ohne jede
--     Deckung.
--
--  2. **Der Entwurf traegt keine Nummer.** `nummer IS NULL`, erzwungen durch
--     einen CHECK, der `festgeschrieben` ohne Nummer unmoeglich macht. Der
--     Zaehler wird erst in der Festschreibungstransaktion gezogen (0077), und
--     weil das ein `UPDATE` auf einer gesperrten Zeile ist und keine Sequenz,
--     rollt er mit zurueck. Tausend verworfene Entwuerfe hinterlassen deshalb
--     null Luecken — nicht "unwahrscheinlich wenige", sondern null.
--
--  3. **Die Umsatzsteuer wird je Steuergruppe gerechnet, nie aus einer
--     Bruttosumme** (Invariante 1, §14 Abs. 4 Nr. 8 UStG). Dafuer gibt es
--     `rechnung_steuer` als eigene Tabelle und `steuersatz_gruppe` als
--     einzigen Katalog. Es gibt KEINE Tabelle `steuersatz`, keine Spalte
--     `steuersatz_id`, kein `prozent_bp` und kein `hinweistext` (K-21).
--
-- NICHT in dieser Migration, und jeweils mit dem PR, der sie bringt:
--  · `rechnungsposition_quelle` (FIN-07, PR 48) — deshalb fehlt hier der
--    Weg von der Position zum Zeiteintrag.
--  · `abschlagsplan`, `abschlagsrechnung_bezug` (FIN-08, PR 48) — deshalb
--    prueft die aufgeschobene Summenpruefung in 0076 nur zwei der vier
--    Summen des §4.9 und nennt die dritte als offen.
--  · `rechnung_dokument`, `rechnung_versand` (PR 52/53), `bankkonto`
--    (PR 49), `freistellungsbescheinigung` (PR 51). Die zugehoerigen
--    Spalten stehen trotzdem schon hier: die STRUKTUR steht ab der ersten
--    Migration, sonst wird jede spaetere Spalte eine Migration mit
--    Datenwanderung auf einer Tabelle, die per Invariante 4 unveraenderlich
--    ist. Wo der Elterntisch fehlt, fehlt nur der Fremdschluessel, und die
--    Stelle sagt es.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. `app.berlin_heute()` — der Kalendertag, den ein Beleg traegt (K-11, §1.8)
-- ---------------------------------------------------------------------------

/**
 * Jedes `current_date` in dieser Domaene ist durch diesen Aufruf ersetzt.
 *
 * Die Verbindung laeuft auf UTC (Supabase-Vorgabe). Eine Rechnung, die um
 * 00:30 Berliner Zeit festgeschrieben wird, bekaeme mit `current_date` das
 * VORIGE Ausstellungsdatum — §14 Abs. 4 Nr. 3 UStG verlangt das Datum der
 * Ausstellung, und ein um einen Tag zurueckdatierter Beleg ist in der
 * Umsatzsteuervoranmeldung im falschen Monat. Im Sommer betrifft das zwei
 * Stunden jeder Nacht.
 *
 * `stable`, nicht `immutable`: der Wert haengt an `now()`. Er darf deshalb
 * (§1.9) in keinem CHECK und in keinem Indexpraedikat stehen — und steht in
 * dieser Migration auch nirgends dort.
 */
create function app.berlin_heute() returns date
language sql stable as $$
  select (now() at time zone 'Europe/Berlin')::date
$$;

comment on function app.berlin_heute() is
  'K-11/§1.8: der BERLINER Kalendertag. Ersetzt current_date in der Finanzdomaene.';

grant execute on function app.berlin_heute() to cse_app, cse_job, cse_definer;

-- ---------------------------------------------------------------------------
-- 2. Aufzaehlungstypen (§3.1)
-- ---------------------------------------------------------------------------

/**
 * FESTGESCHRIEBEN (§3.1, FIN-02, Invariante 4): **drei** Werte, und genau
 * zwei Uebergaenge — `entwurf→festgeschrieben` und `entwurf→verworfen`.
 *
 * Es gibt bewusst KEIN `storniert`. Ein Storno ist eine eigene Rechnung mit
 * eigener Nummer aus demselben Kreis, zurueckgebunden ueber
 * `rechnung_beziehung`; ein Uebergang `festgeschrieben→storniert` waere ein
 * Weg, den der Unveraenderlichkeitsausloeser anschliessend nur noch
 * abzuweisen haette — gebaut, um verweigert zu werden.
 *
 * `verworfen` gibt es, weil Invariante 8 das Loeschen eines verworfenen
 * Entwurfs verbietet. Der Entwurf verschwindet nicht, er bekommt einen
 * Zustand und einen Grund.
 */
create type rechnung_status as enum ('entwurf', 'festgeschrieben', 'verworfen');

/**
 * FESTGESCHRIEBEN (§3.1). `anzahlung` steht neben `abschlag`, weil
 * §14 Abs. 4 Nr. 6 UStG fuer die Vorauszahlungsrechnung den Zeitpunkt der
 * VEREINNAHMUNG als Alternative zum Leistungszeitpunkt zulaesst — ohne den
 * eigenen Wert liesse sich diese Rechnung gar nicht ausstellen.
 *
 * Bewusst KEIN `gutschrift`: nach §14 Abs. 2 UStG ist eine „Gutschrift" die
 * Abrechnung durch den Leistungsempfaenger, also ein EINGANGSdokument mit
 * unserer Nummer. Eine kaufmaennische Gutschrift ist ein `storno`.
 */
create type rechnungsart as enum ('standard', 'abschlag', 'anzahlung', 'schluss', 'storno');

/**
 * FESTGESCHRIEBEN — UNTDID 5305, die EN-16931-Teilmenge (BT-118, FIN-11).
 * Eine normative Codeliste, keine Erfindung: `AE` Reverse Charge (§13b),
 * `E` steuerfrei nach §4 UStG, `K` innergemeinschaftlich, `G` Ausfuhr,
 * `O` nicht steuerbar.
 */
create type en16931_steuerkategorie as enum ('S', 'AE', 'Z', 'E', 'K', 'G', 'O');

/**
 * FESTGESCHRIEBEN — §13b Abs. 2 Nr. 4 und Nr. 8 UStG.
 *
 * Nr. 8 verlagert die Steuer fuer GEBAEUDEREINIGUNGSleistungen an einen
 * Unternehmer, der selbst solche erbringt. `reinigung` ist eine der vier
 * Gesellschaften und vergibt Reinigung routinemaessig weiter — eine reine
 * Bau-Flagge machte den haeufigsten §13b-Fall dieser Gruppe undarstellbar.
 */
create type bauleistungsart as enum ('bau', 'gebaeudereinigung');

/**
 * ABGELEITET (§3.1): eine Textzeile traegt keine Betraege (§14-Freitext,
 * VOB-Verweise), eine Zwischensumme ist reine Anzeige und faellt aus jeder
 * Summe heraus. Die CHECKs auf `rechnungsposition` machen das erzwingbar
 * statt bloss vereinbart.
 */
create type positionsart as enum ('leistung', 'textzeile', 'zwischensumme');

/** FESTGESCHRIEBEN — EN 16931 BG-20 (Allowance) / BG-21 (Charge). */
create type zuschlag_art as enum ('nachlass', 'zuschlag');

/**
 * FESTGESCHRIEBEN (§3.1, §4.8): die zwei GERICHTETEN Beziehungen zwischen
 * zwei Rechnungen. Die Umkehrlesarten (`storniert_durch`, `schluss_zu`) sind
 * ausdruecklich KEINE Werte — eine Umkehrzeile ist eine zweite Kopie
 * derselben Tatsache, und zwei Kopien driften. „Was hat mich storniert" ist
 * eine Abfrage (`where zu_rechnung_id = $1 and art = 'storno'`), keine Zeile.
 *
 * `abschlag_zu` steht hier ebenfalls nicht: die Beziehung Abschlag →
 * Schlussrechnung traegt Betraege JE STEUERGRUPPE und bleibt deshalb in
 * `abschlagsrechnung_bezug` (§4.7, PR 48).
 */
create type rechnung_beziehung_art as enum ('storno', 'ersetzt');

/**
 * PLATZHALTER-Vokabular (§3.1).
 * // TODO(client, O-178): Ist eine Teilstornierung zulaessig, oder ist jede
 * Korrektur ein Vollstorno mit Neuausstellung? Bitte mit dem Steuerberater
 * klaeren. Bis zur Antwort gibt der Dienst nur `vollstorno` aus; der Wert
 * existiert, damit die Antwort eine Datenaenderung wird und keine Migration.
 */
create type storno_art as enum ('vollstorno', 'teilstorno');

-- ---------------------------------------------------------------------------
-- 3. Die globalen Referenztabellen (§3.2)
-- ---------------------------------------------------------------------------

/**
 * Drei Tabellen tragen Bundesrecht bzw. eine normative Codeliste. Sie sind
 * fuer alle vier Gesellschaften identisch, also traegt keine von ihnen ein
 * `mandant_id`: vier Kopien des §12 UStG waeren vier Gelegenheiten, eine
 * davon zu aendern. K-16 verlangt genau diese Entscheidung ausdruecklich —
 * ein Katalog ist entweder gruppenweit OHNE Mandantenspalte oder je Mandant
 * mit `NOT NULL`, nie „manchmal geteilt".
 *
 * Die zwei uebrigen der fuenf aus §3.2 — `bauabzugsteuer_freigrenze` und
 * `basiszinssatz` — kommen mit den PRs, die sie lesen (§48 EStG bzw. §288
 * BGB). Eine Tabelle ohne Leser haette hier nur eine leere Policy-Menge zu
 * pruefen.
 *
 * Die Policy-Menge steht EINMAL und gilt fuer alle drei. Der Schreibweg ist
 * benannt und nicht impliziert: Migration (`cse_migrator`) oder ein
 * Super-Admin mit `system.referenzdaten_verwalten`. Ohne einen solchen Weg
 * liesse sich zum Beispiel ein neuer Steuersatz nie eintragen, und der
 * Katalog veraltete planmaessig.
 *
 * Der Schluessel ist `system.referenzdaten_verwalten` und NICHT
 * `referenz.verwalten` (das Modul `referenz` ist veroeffentlichter
 * Webseiteninhalt — ein Redakteursrecht oeffnete damit §12 UStG) und auch
 * nicht `system.einstellung_verwalten` (das ist das MANDANTENrecht auf
 * `mandant_einstellung`; diese Tabellen sind keine Mandantendaten).
 */

/**
 * `steuersatz_gruppe` — die Einheit, in der Umsatzsteuer gerechnet und
 * ausgewiesen wird (§14 Abs. 4 Nr. 8 UStG), und der Traeger der
 * EN-16931-Kategorie samt Befreiungsgrund.
 *
 * Der Satz heisst `satz_bp` und ist in BASISPUNKTEN angegeben: `1900` ist
 * 19,00 %. Kein Gleitkomma, kein Prozentbruch — dieselbe Einheit wie in
 * `angebot` und `auftrag_leistung`, damit ein Satz beim Uebergang vom
 * Angebot zur Rechnung nicht umgerechnet werden muss.
 */
create table steuersatz_gruppe (
  id                    uuid primary key default gen_random_uuid(),
  schluessel            text not null,
  bezeichnung           text not null,
  -- Definitorische Schranke, keine Geschaeftsregel: ein Umsatzsteuersatz
  -- kann 100 % nicht ueberschreiten.
  satz_bp               integer not null check (satz_bp between 0 and 10000),
  kategorie             en16931_steuerkategorie not null,
  steuer_kennzeichen    steuer_kennzeichen not null,
  befreiungsgrund_code  text,
  befreiungsgrund_text  text,
  -- Satzgeschichte: den Satz von 16 % im Jahr 2020 hat es gegeben, und eine
  -- Rechnung aus jener Zeit muss mit ihm nachrechenbar bleiben.
  gueltig_von           date not null,
  gueltig_bis           date,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,

  constraint ssg_schluessel_uk unique (schluessel),
  -- Eine Kategorie ausserhalb des Regelsatzes OHNE gedruckten Grund ergibt
  -- eine Rechnung, die an §14 UStG und am KoSIT-Pruefer gleichermassen
  -- scheitert.
  constraint ssg_befreiungsgrund check (kategorie = 'S' or befreiungsgrund_text is not null),
  constraint ssg_gueltig check (gueltig_bis is null or gueltig_bis >= gueltig_von)
);

-- „Der Satz am Leistungsdatum" — genau diese Abfrage.
create index steuersatz_gruppe_gueltig_idx on steuersatz_gruppe (gueltig_von, gueltig_bis);

/**
 * EIN Satz je Schluessel und Tag. Das ist, was „der Satz am 1. Januar" ueber-
 * haupt erst zu einer Frage mit genau einer Antwort macht. Ohne diese
 * Ausschlussbedingung koennen sich zwei Zeilen ueberlappen, und welche gilt,
 * entscheidet dann die Sortierung der Abfrage.
 */
alter table steuersatz_gruppe add constraint ssg_kein_ueberlapp
  exclude using gist (
    schluessel with =,
    daterange(gueltig_von, coalesce(gueltig_bis + 1, 'infinity'::date), '[)') with &&);

/**
 * Nach dem ersten Gebrauch beweglich sind nur Bezeichnung, Gueltigkeitsende
 * und die zwei Befreiungstexte. Ein Satz, auf den eine festgeschriebene
 * Rechnung zeigt, darf sich nicht bewegen — und die Rechnung traegt ihre
 * eigene eingefrorene Kopie ohnehin (§4.5).
 */
create function fin.steuersatz_gruppe_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if (new.schluessel, new.satz_bp, new.kategorie, new.steuer_kennzeichen, new.gueltig_von)
     is distinct from
     (old.schluessel, old.satz_bp, old.kategorie, old.steuer_kennzeichen, old.gueltig_von) then
    raise exception
      'steuersatz_gruppe: Schluessel, Satz, Kategorie und Gueltigkeitsbeginn sind unveraenderlich'
      using errcode = 'restrict_violation',
            hint = 'Ein geaenderter Satz ist eine NEUE Zeile mit eigenem Gueltigkeitsbeginn.';
  end if;
  return new;
end $$;

create trigger trg_steuersatz_gruppe_pruefen
  before update on steuersatz_gruppe
  for each row execute function fin.steuersatz_gruppe_pruefen();

/**
 * `masseinheit` — der UN/ECE-Rec-20-Code hinter einem deutschen
 * Einheitenlabel. **BT-130 ist in EN 16931 Pflicht und muss ein CODE sein**,
 * kein Wort.
 *
 * Ein Freitextlabel laesst sich beim Rendern nicht deterministisch abbilden:
 * „Stk" ist je nach Konvention `H87` oder `C62`, „pauschal" ist `LS`. Also
 * entsteht entweder eine ungueltige XRechnung oder zwei Ausgaben derselben
 * festgeschriebenen Rechnung unterscheiden sich. Die ZUORDNUNG ist das, was
 * niemand bestaetigt hat — deshalb `ist_platzhalter = true` bei jeder
 * gesaeten Zeile, und deshalb darf eine bestaetigte Zeile keinen NULL-Code
 * mehr haben.
 */
create table masseinheit (
  id              uuid primary key default gen_random_uuid(),
  schluessel      text not null,
  bezeichnung     text not null,
  unece_code      text,
  ist_platzhalter boolean not null default true,
  erstellt_am     timestamptz not null default now(),
  geaendert_am    timestamptz,

  constraint masseinheit_schluessel_uk unique (schluessel),
  constraint masseinheit_code_form check (unece_code is null or unece_code ~ '^[A-Z0-9]{2,3}$'),
  -- Eine BESTAETIGTE Zeile traegt einen Code; eine Platzhalterzeile darf
  -- vorerst nur das deutsche Label tragen, damit sich eine Rechnung schon
  -- entwerfen und drucken laesst.
  constraint masseinheit_bestaetigt_hat_code check (ist_platzhalter or unece_code is not null)
);

create index masseinheit_code_idx on masseinheit (unece_code);

/**
 * `kleinbetrag_grenze` — die §33-UStDV-Schwelle, versioniert.
 *
 * Versioniert und nicht als Konstante im Code, weil `ist_kleinbetrag` beim
 * Festschreiben eingefroren wird: gegen eine einkompilierte Zahl geprueft
 * wuerde am Tag einer Gesetzesaenderung jede historische Rechnung neu gegen
 * die neue Schwelle bewertet. `services/finanz/` nimmt das Leistungsdatum
 * als Parameter und liest diese Tabelle.
 */
create table kleinbetrag_grenze (
  id                 uuid primary key default gen_random_uuid(),
  grenze_brutto_cent bigint not null check (grenze_brutto_cent > 0),
  gueltig_von        date not null,
  gueltig_bis        date,
  fundstelle         text not null,
  ist_platzhalter    boolean not null default true,
  erstellt_am        timestamptz not null default now(),

  constraint kleinbetrag_von_uk unique (gueltig_von),
  constraint kleinbetrag_gueltig check (gueltig_bis is null or gueltig_bis >= gueltig_von)
);

-- Die gemeinsame Policy-Menge der Referenztabellen (§3.2), dreimal dieselbe.
do $$
declare t text;
begin
  foreach t in array array['steuersatz_gruppe', 'masseinheit', 'kleinbetrag_grenze'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    -- `using (true)`: JEDER Scope muss einen Steuersatz lesen koennen, sonst
    -- laesst sich einem Kunden die Steuerzeile seiner eigenen Rechnung nicht
    -- zeigen.
    execute format('create policy r_lesen on %I for select to cse_app using (true)', t);
    execute format($p$
      create policy r_pflege on %I for insert to cse_app
        with check (app.ist_super_admin() and not app.ist_readonly()
                    and (select app.hat_recht('system.referenzdaten_verwalten',
                                              app.aktiver_mandant())))$p$, t);
    execute format($p$
      create policy r_pflege_u on %I for update to cse_app
        using (app.ist_super_admin())
        with check (not app.ist_readonly()
                    and (select app.hat_recht('system.referenzdaten_verwalten',
                                              app.aktiver_mandant())))$p$, t);
    execute format('grant select, insert, update on %I to cse_app', t);
    execute format('grant select on %I to cse_definer, cse_job', t);
  end loop;
end $$;

/**
 * Die Saat: §12 UStG und §13b UStG, nicht geraten.
 *
 * 19 % und 7 % stehen im Gesetz; die zwei §13b-Zeilen tragen Satz 0 und den
 * gedruckten Hinweis, den §14a Abs. 5 UStG verlangt. `ust_0_4nr12` ist die
 * steuerfreie Vermietung nach §4 Nr. 12 UStG.
 *
 * `gueltig_von` ist der 1. Januar 2021 — das Ende der befristeten Senkung
 * auf 16 %/5 %, also der Beginn der heute geltenden Saetze. Ein frueheres
 * Datum waere eine Behauptung ueber Saetze, die diese Plattform nie
 * ausgestellt hat.
 */
insert into steuersatz_gruppe
  (schluessel, bezeichnung, satz_bp, kategorie, steuer_kennzeichen,
   befreiungsgrund_code, befreiungsgrund_text, gueltig_von)
values
  ('ust_19', 'Umsatzsteuer 19 %', 1900, 'S', 'regelsatz', null, null, date '2021-01-01'),
  ('ust_07', 'Umsatzsteuer 7 %',   700, 'S', 'ermaessigt', null, null, date '2021-01-01'),
  ('ust_0_13b_bau', 'Bauleistung §13b Abs. 2 Nr. 4 UStG', 0, 'AE', 'reverse_charge_13b',
   'VATEX-EU-AE', 'Steuerschuldnerschaft des Leistungsempfängers (§13b Abs. 2 Nr. 4 UStG)',
   date '2021-01-01'),
  ('ust_0_13b_reinigung', 'Gebäudereinigung §13b Abs. 2 Nr. 8 UStG', 0, 'AE', 'reverse_charge_13b',
   'VATEX-EU-AE', 'Steuerschuldnerschaft des Leistungsempfängers (§13b Abs. 2 Nr. 8 UStG)',
   date '2021-01-01'),
  ('ust_0_4nr12', 'Steuerfreie Vermietung §4 Nr. 12 UStG', 0, 'E', 'steuerfrei',
   'VATEX-EU-79-C', 'Steuerfreie Vermietung nach §4 Nr. 12 UStG', date '2021-01-01');

/**
 * Die Einheiten aus dem gemeinsamen `EINHEITEN`-Satz, jede als PLATZHALTER.
 * // TODO(client, O-174): Bestaetigen Sie die Zuordnung Ihrer Mengeneinheiten
 * zu den UN/ECE-Rec-20-Codes — insbesondere „Stk" (H87 oder C62),
 * „pauschal" (LS) und „Einsatz". Oeffentliche Auftraggeber pruefen BT-130
 * gegen die Codeliste.
 */
insert into masseinheit (schluessel, bezeichnung, unece_code, ist_platzhalter) values
  ('h',     'Std.',      'HUR', true),
  ('m2',    'm²',        'MTK', true),
  ('stk',   'Stk',       'H87', true),
  ('monat', 'Monat',     'MON', true),
  ('psch',  'pauschal',  'LS',  true),
  ('einsatz', 'Einsatz', null,  true);

/**
 * // TODO(client, O-175): Sollen Kleinbetragsrechnungen ueberhaupt
 * ausgestellt werden? Viele gewerbliche Kunden weisen sie zurueck, weil ihnen
 * die Empfaengerangaben fehlen. Die Schwelle steht in §33 UStDV; ob die
 * Gruppe von ihr Gebrauch macht, steht nirgends — deshalb Platzhalter.
 */
insert into kleinbetrag_grenze (grenze_brutto_cent, gueltig_von, fundstelle, ist_platzhalter)
values (25000, date '2017-01-01', '§33 UStDV', true);

-- ---------------------------------------------------------------------------
-- 4. rechnung (§4.1)
-- ---------------------------------------------------------------------------

create table rechnung (
  id                  uuid primary key default gen_random_uuid(),
  mandant_id          uuid not null references mandant(id),

  /**
   * NULLABLE bis zur Festschreibung, und das ist eine Korrektur am Entwurf
   * des Kapitels: der Kreis wird ERST beim Festschreiben aufgeloest, aus dem
   * Rechnungsdatum. Waere die Spalte beim Anlegen Pflicht, referenzierte ein
   * am 30.12.2026 angelegter und am 02.01.2027 festgeschriebener Entwurf
   * einen Kreis und verbrauchte einen anderen.
   */
  nummernkreis_id     uuid,

  rechnungsart        rechnungsart not null default 'standard',
  -- UNTDID 1001 (BT-3), beim Festschreiben abgeleitet und eingefroren.
  rechnungsart_code   text,
  status              rechnung_status not null default 'entwurf',

  -- NULL fuer jeden Entwurf. Der CHECK unten macht das erzwingbar.
  nummer              text,
  nummer_laufend      bigint,

  kunde_id            uuid not null,
  auftrag_id          uuid,
  projekt_id          uuid,
  -- Reinigung und Security rechnen je Gebaeude ab (OPS-01, OPS-02), der
  -- Leistungsort gehoert auf den Beleg, und die Deckungsbeitragsrechnung je
  -- Objekt (REP-05) hat sonst keinen Verbund.
  objekt_id           uuid,

  -- Ausstellungsdatum §14 Abs. 4 Nr. 3; beim Festschreiben aus
  -- app.berlin_heute() gesetzt.
  rechnungsdatum      date,
  leistung_von        date,
  leistung_bis        date,
  -- §14 Abs. 4 Nr. 6 UStG: die Alternative der Anzahlungsrechnung.
  vereinnahmung_geplant_am date,

  waehrung            text not null default 'EUR' check (waehrung = 'EUR'),

  -- Geld ist bigint in Cent (Invariante 1). Kein numeric, kein Gleitkomma.
  netto_gesamt_cent   bigint not null default 0,
  steuer_gesamt_cent  bigint not null default 0,
  brutto_cent         bigint not null default 0,
  abzug_brutto_cent   bigint not null default 0,
  -- EN 16931 BT-115.
  zahlbetrag_cent     bigint not null default 0,

  bauabzugsteuer_pflichtig      boolean not null default false,
  bauabzugsteuer_satz_bp        integer,
  bauabzugsteuer_grundlage_cent bigint,
  einbehalt_bauabzugsteuer_cent bigint not null default 0,
  /**
   * Der Betrag, den die Gesellschaft tatsaechlich erwartet — gedruckt, aber
   * NIE der zahlbare Betrag der XML. EN-16931-Regel BR-CO-16 verlangt
   * `BT-115 = BT-112 − BT-113 + BT-114`; die Bauabzugsteuer ist kein
   * EN-16931-Begriff und hat in BT-113 keinen Platz. In BT-115 gefaltet
   * ergaebe sie ein Dokument, das der KoSIT-Pruefer zurueckweist — und damit
   * keine Rechnung an GIZ, DRV Bund oder einen Berliner Bezirk.
   *
   * Generiert, weil es eine DIFFERENZ zweier gespeicherter Cent-Spalten ist
   * (§1.7): exakt, unveraenderlich, kein Produkt, das beim Neuschreiben der
   * Zeile neu rundet.
   */
  ueberweisungsbetrag_cent bigint not null
    generated always as (zahlbetrag_cent - einbehalt_bauabzugsteuer_cent) stored,
  -- Elterntisch `freistellungsbescheinigung` kommt mit PR 51 (CRM-Domaene);
  -- bis dahin Spalte ohne Fremdschluessel, siehe Kopfkommentar.
  freistellungsbescheinigung_id uuid,

  reverse_charge            boolean not null default false,
  reverse_charge_grundlage  bauleistungsart,
  steuerhinweis             text,

  ist_kleinbetrag     boolean not null default false,

  leitweg_id                   text,
  kaeufer_referenz             text,
  bestellnummer_kunde          text,
  verkaeufer_eadresse          text,
  verkaeufer_eadresse_schema   text,
  kaeufer_eadresse             text,
  kaeufer_eadresse_schema      text,

  -- Elterntisch `bankkonto` kommt mit PR 49.
  bankkonto_id          uuid,
  zahlungsmittel_code   text,
  zahlungsbedingung_text text,
  /**
   * NULLABLE, OHNE DEFAULT — und das ist der Kern von §4.2.
   * `NOT NULL DEFAULT 14` waere kein Platzhalter, sondern ein Produktionswert:
   * er setzte auf jeder Rechnung `faellig_am`, triebe damit den Mahnlauf, die
   * „ueberfaellig > 14 Tage"-Wache und die §288-BGB-Zinsen.
   * // TODO(client, O-66): Standard-Zahlungsziel je Gesellschaft, und gilt es
   * auch fuer oeffentliche Auftraggeber (dort haeufig 30 Tage)?
   */
  zahlungsziel_tage     integer,
  faellig_am            date,
  skonto_bp             integer,
  skonto_tage           integer,

  kopftext              text,
  fusstext              text,
  sprache               text not null default 'de',

  festgeschrieben_am    timestamptz,
  -- Nie `system`, nie `agent`: §14 UStG und Invariante 4 verlangen hier einen
  -- Menschen, und „System" waere an dieser Stelle eine Luege (§1.6).
  festgeschrieben_von   uuid references benutzer(id),

  verworfen_am          timestamptz,
  verworfen_von         uuid references benutzer(id),
  verworfen_grund       text,

  aufbewahrung_klasse   text not null default 'rechnung_ausgang',
  aufbewahrung_bis      date,
  loeschsperre          boolean not null default true,

  -- Auditblock (§1.6). Drei Akteursarten statt eines erfundenen Menschen.
  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint rechnung_mandant_uk unique (mandant_id, id),

  constraint rechnung_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint rechnung_nummernkreis_fk foreign key (mandant_id, nummernkreis_id)
    references nummernkreis (mandant_id, id),
  constraint rechnung_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint rechnung_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  constraint rechnung_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint rechnung_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),

  -- ABNAHME 2: ein Entwurf hat keine Nummer, und zwar erzwungen.
  constraint rechnung_entwurf_ohne_nummer check (
    status <> 'entwurf'
    or (nummer is null and nummer_laufend is null and festgeschrieben_am is null)),

  /**
   * Und die Gegenrichtung, die die Nummernlosigkeit erst zur Sicherung macht:
   * `festgeschrieben` OHNE Nummer ist unmoeglich. Ohne diese Haelfte liesse
   * sich eine Rechnung festschreiben, ohne je den Zaehler beruehrt zu haben —
   * der Entwurf haette dann keine Nummer, die festgeschriebene auch nicht,
   * und die Folge im Rechnungsausgangsbuch waere luecken*frei* nur, weil sie
   * leer ist.
   */
  constraint rechnung_festgeschrieben_vollstaendig check (
    status <> 'festgeschrieben'
    or (nummernkreis_id is not null and nummer is not null and nummer_laufend is not null
        and rechnungsdatum is not null and festgeschrieben_am is not null
        and festgeschrieben_von is not null and rechnungsart_code is not null
        and zahlungsziel_tage is not null and faellig_am is not null)),

  /**
   * §14 Abs. 4 Nr. 6 UStG verlangt den Zeitpunkt der LEISTUNG **oder** den
   * der VEREINNAHMUNG. Eine Vorauszahlungsrechnung geht hinaus, bevor
   * irgendetwas geleistet ist; eine unbedingte Leistungszeitraum-Pflicht
   * machte sie unausstellbar, waehrend FIN-08 Abschlagsrechnungen verlangt.
   */
  constraint rechnung_leistungszeitpunkt check (
    status <> 'festgeschrieben'
    or (leistung_von is not null and leistung_bis is not null)
    or (rechnungsart in ('abschlag', 'anzahlung') and vereinnahmung_geplant_am is not null)),

  constraint rechnung_leistungszeitraum check (
    leistung_bis is null or leistung_von is null or leistung_bis >= leistung_von),

  -- Ein verworfener Entwurf ist ein GoBD-Satz: Zeitpunkt, Mensch, Grund.
  constraint rechnung_verworfen_vollstaendig check (
    status <> 'verworfen'
    or (verworfen_am is not null and verworfen_von is not null and verworfen_grund is not null)),

  constraint rechnung_brutto_stimmig check (brutto_cent = netto_gesamt_cent + steuer_gesamt_cent),
  constraint rechnung_zahlbetrag_stimmig check (zahlbetrag_cent = brutto_cent - abzug_brutto_cent),

  /**
   * VORZEICHENSTIMMIGKEIT statt `>= 0` (review B9).
   *
   * Ein Storno spiegelt das Original, also sind auf ihm alle Betraege
   * negativ. Ein `CHECK (abzug_brutto_cent >= 0)` machte die haeufigste
   * Korrektur im Bau — das Storno einer Schlussrechnung — schlicht
   * unaufschreibbar.
   */
  constraint rechnung_abzug_vorzeichen check (sign(abzug_brutto_cent) in (0, sign(brutto_cent))),
  constraint rechnung_einbehalt_vorzeichen check (
    sign(einbehalt_bauabzugsteuer_cent) in (0, sign(brutto_cent))),
  constraint rechnung_bauabzug_grundlage_vorzeichen check (
    bauabzugsteuer_grundlage_cent is null
    or sign(bauabzugsteuer_grundlage_cent) in (0, sign(brutto_cent))),
  constraint rechnung_nur_storno_negativ check (rechnungsart = 'storno' or brutto_cent >= 0),

  -- BT-120: ein §13b-Beleg OHNE den gedruckten Hinweis ist nach §14a Abs. 5
  -- UStG unvollstaendig.
  constraint rechnung_reverse_charge_hinweis check (not reverse_charge or steuerhinweis is not null)
);

/**
 * §14 Abs. 4 Nr. 4 UStG verlangt eine Nummer, „die zur Identifizierung der
 * Rechnung vom Rechnungsaussteller EINMALIG vergeben wird" — also je
 * AUSSTELLER eindeutig, nicht je Zaehlerzeile. Eine Gesellschaft besitzt
 * legitim mehrere Kreise (ein Nachfolgekreis nach Jahreswechsel ist schon
 * der zweite).
 */
create unique index rechnung_nummer_uk on rechnung (mandant_id, nummer);
-- Der Lueckenbeweis und die Ordnung des Rechnungsausgangsbuchs in einem.
create unique index rechnung_laufend_uk on rechnung (nummernkreis_id, nummer_laufend);

create index rechnung_faellig_idx on rechnung (mandant_id, kunde_id, faellig_am)
  where status = 'festgeschrieben';
create index rechnung_liste_idx on rechnung (mandant_id, status, rechnungsdatum desc);
create index rechnung_auftrag_idx on rechnung (mandant_id, auftrag_id) where auftrag_id is not null;
create index rechnung_objekt_idx on rechnung (mandant_id, objekt_id) where objekt_id is not null;
create index rechnung_entwuerfe_idx on rechnung (mandant_id, erstellt_am desc)
  where status = 'entwurf';
create index rechnung_bauabzug_idx on rechnung (mandant_id, rechnungsdatum)
  where status = 'festgeschrieben' and bauabzugsteuer_pflichtig;

comment on table rechnung is
  'Ausgangsrechnung einer Gesellschaft. Entwurf beweglich, ab dem Festschreiben '
  'unveraenderlich und nummeriert (FIN-02, FIN-03, Invariante 4).';
comment on column rechnung.nummer is
  'NULL fuer jeden Entwurf. Die Nummer entsteht erst in fin.rechnung_nummer_ziehen.';
comment on column rechnung.ueberweisungsbetrag_cent is
  'Gedruckt, nie BT-115: die Bauabzugsteuer hat in EN 16931 keinen Platz (BR-CO-16).';

-- ---------------------------------------------------------------------------
-- 5. rechnungsposition (§4.3)
-- ---------------------------------------------------------------------------

create table rechnungsposition (
  id                  uuid primary key default gen_random_uuid(),
  mandant_id          uuid not null references mandant(id),
  rechnung_id         uuid not null,

  position_nr         integer not null check (position_nr > 0),
  positionsart        positionsart not null default 'leistung',

  auftrag_leistung_id uuid,
  -- Elterntisch `vertrag_abrechnung` kommt mit PR 48 (CRM-Domaene).
  vertrag_abrechnung_id uuid,
  /**
   * Die eingefrorene Kopie der Abrechnungsart. Der ENUM gehoert
   * `02-CRM-OPERATIONS.md` §2 (K-21) und kommt mit PR 48; ihn hier
   * anzulegen schuefe einen zweiten Eigentuemer fuer eine Liste, die noch
   * niemand bestaetigt hat. Bis dahin Text, und ohne Pflicht — die
   * Pflichtbedingung des Kapitels (`positionsart <> 'leistung' OR
   * abrechnungsart IS NOT NULL`) kommt mit dem Katalog, der sie erfuellbar
   * macht.
   * // TODO(client, O-04): Die exakten fuenf Abrechnungsarten und ihre Regeln
   * — Rundung, Mindestabnahme, Nacht- und Sonntagszuschlag, Abruf gegen
   * Monatspauschale.
   */
  abrechnungsart      text,

  leistungskatalog_position_id uuid,
  erloeskonto_schluessel       text,
  lv_position_id               uuid,

  -- handelsuebliche Bezeichnung, §14 Abs. 4 Nr. 5 UStG.
  bezeichnung         text not null,
  beschreibung        text,

  /**
   * NULLABLE — weil eine `textzeile` keine Betraege traegt und eine
   * `zwischensumme` reine Anzeige ist. `NOT NULL` machte zwei der drei
   * Positionsarten uneingebbar.
   *
   * `numeric(12,3)`: eine Menge ist KEIN Geld und deshalb keine Cent-Zahl
   * (K-16).
   */
  menge               numeric(12,3),
  einheit             text,
  masseinheit_id      uuid references masseinheit(id),

  /**
   * BT-149/150: wie sich ein Stueckpreis unterhalb eines Cents ausdruecken
   * laesst, OHNE Bruchteile von Cents zu speichern — „einzelpreis_cent je
   * preis_basismenge Einheiten".
   *
   * Trotz des Namens ist die Spalte eine MENGE und kein Geldbetrag; der Name
   * kommt aus EN 16931. Typ und Name stehen deshalb auf zwei Zeilen: die
   * Geldwache liest zeilenweise und meldete sonst zu Recht „preis" neben
   * „numeric" — hier ist das der eine Fall, in dem das kein Fehler ist.
   */
  preis_basismenge
                      numeric(12,3) not null default 1,
  einzelpreis_cent    bigint,
  rabatt_bp           integer not null default 0 check (rabatt_bp between 0 and 10000),
  netto_cent          bigint,

  /**
   * Der einzige Steuerverweis der Plattform. Einspaltig und nicht
   * zusammengesetzt, weil `steuersatz_gruppe` global ist und gar kein
   * `mandant_id` hat, mit dem sich ein Paar bilden liesse (§13).
   */
  steuersatz_gruppe_id uuid not null references steuersatz_gruppe(id),
  -- Eingefrorene Kopien: eine Rechnung nach einer Satzaenderung
  -- nachzurechnen darf nicht den HEUTIGEN Satz lesen.
  satz_bp             integer not null,
  kategorie           en16931_steuerkategorie not null,

  leistung_von        date,
  leistung_bis        date,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint rp_mandant_uk unique (mandant_id, id),
  constraint rp_position_uk unique (rechnung_id, position_nr),
  constraint rp_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id),
  constraint rp_auftrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint rp_lv_position_fk foreign key (mandant_id, lv_position_id)
    references lv_position (mandant_id, id),

  constraint rp_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  -- Alles, was eine Leistungszeile §14 Abs. 4 Nr. 5 UStG und BT-130 schuldet.
  constraint rp_leistung_vollstaendig check (
    positionsart <> 'leistung'
    or (einzelpreis_cent is not null and netto_cent is not null and menge is not null
        and menge <> 0 and einheit is not null and masseinheit_id is not null)),
  -- Und die Spiegelbedingung: eine Textzeile oder Zwischensumme kann keinen
  -- Betrag und keine Menge in eine Summe schmuggeln.
  constraint rp_ohne_leistung_ohne_betrag check (
    positionsart = 'leistung'
    or (netto_cent is null and einzelpreis_cent is null and menge is null
        and masseinheit_id is null)),

  constraint rp_basismenge_positiv check (preis_basismenge > 0)
);

create index rp_render_idx on rechnungsposition (mandant_id, rechnung_id, position_nr);
create index rp_steuergruppe_idx on rechnungsposition (rechnung_id, steuersatz_gruppe_id);
create index rp_lv_idx on rechnungsposition (mandant_id, lv_position_id)
  where lv_position_id is not null;
create index rp_auftrag_leistung_idx on rechnungsposition (mandant_id, auftrag_leistung_id)
  where auftrag_leistung_id is not null;

-- ---------------------------------------------------------------------------
-- 6. rechnung_zuschlag (§4.3) — BG-20 / BG-21
-- ---------------------------------------------------------------------------

/**
 * Ohne diese Tabelle muesste ein ausgehandelter Gesamtnachlass oder eine
 * Anfahrtspauschale als NEGATIVE Position eingeschmuggelt werden — die
 * braeuchte dann eine handelsuebliche Bezeichnung nach §14 Abs. 4 Nr. 5 und
 * eine Menge, die es nicht gibt.
 *
 * `betrag_cent` ist immer positiv; das Vorzeichen traegt `art`. Eine Spalte,
 * die beides koennte, waere zweimal dieselbe Information und einmal falsch.
 */
create table rechnung_zuschlag (
  id                uuid primary key default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),
  rechnung_id       uuid not null,

  art               zuschlag_art not null,
  bezeichnung       text not null,
  grund_code        text,
  basis_cent        bigint,
  satz_bp           integer,
  betrag_cent       bigint not null check (betrag_cent >= 0),

  -- Ein Nachlass gehoert einer Steuergruppe an, sonst geht die
  -- Steueraufschluesselung nicht auf.
  steuersatz_gruppe_id uuid not null references steuersatz_gruppe(id),
  gruppe_satz_bp    integer not null,
  gruppe_kategorie  en16931_steuerkategorie not null,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint rz_mandant_uk unique (mandant_id, id),
  constraint rz_eindeutig_uk unique (rechnung_id, art, bezeichnung),
  constraint rz_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id),
  constraint rz_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create index rz_rechnung_idx on rechnung_zuschlag (mandant_id, rechnung_id);

-- ---------------------------------------------------------------------------
-- 7. rechnung_steuer (§4.5)
-- ---------------------------------------------------------------------------

/**
 * Die Steueraufschluesselung je Satzgruppe — §14 Abs. 4 Nr. 8 UStG „nach
 * Steuersaetzen aufgeschluesselt", EN 16931 `TaxSubtotal`.
 *
 * `steuer_cent` wird EINMAL JE GRUPPE gerechnet, nicht je Zeile: jede Zeile
 * einzeln zu runden und die Ergebnisse zu addieren driftet gegen die Zahl,
 * die ein Finanzamt nachrechnet, und auf einer Reinigungsrechnung mit
 * zweihundert Positionen ist das eine sichtbare Differenz auf einem Beleg,
 * der sich nicht mehr aendern laesst.
 *
 * `geaendert_am` steht hier, obwohl §4.5 nur `erstellt_am` nennt: die Zeile
 * IST waehrend der Entwurfsbearbeitung beweglich — `berechneSteuer()` laeuft
 * bei jeder Positionsaenderung —, und K-16 verlangt fuer jede bewegliche
 * Tabelle diese Spalte. Wo Kapitel und Konvention auseinandergehen, gilt die
 * Konvention.
 *
 * Neu berechnet wird durch UPSERT, nie durch Loeschen: Invariante 8 kennt in
 * dieser Domaene keinen Hard Delete. Eine Gruppe, die nicht mehr vorkommt,
 * faellt auf `netto_cent = 0` und faellt damit aus jeder Summe heraus.
 */
create table rechnung_steuer (
  id                   uuid primary key default gen_random_uuid(),
  mandant_id           uuid not null references mandant(id),
  rechnung_id          uuid not null,

  steuersatz_gruppe_id uuid not null references steuersatz_gruppe(id),
  satz_bp              integer not null,
  kategorie            en16931_steuerkategorie not null,
  netto_cent           bigint not null,
  steuer_cent          bigint not null,
  befreiungsgrund_code text,
  befreiungsgrund_text text,

  erstellt_am          timestamptz not null default now(),
  geaendert_am         timestamptz,

  constraint rs_mandant_uk unique (mandant_id, id),
  constraint rs_gruppe_uk unique (rechnung_id, steuersatz_gruppe_id),
  constraint rs_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id),
  constraint rs_befreiungsgrund check (kategorie = 'S' or befreiungsgrund_text is not null)
);

create index rs_aggregation_idx on rechnung_steuer (mandant_id, steuersatz_gruppe_id);

-- ---------------------------------------------------------------------------
-- 8. rechnung_beziehung (§4.8) — K-12, K-21
-- ---------------------------------------------------------------------------

/**
 * Die Rueckbindung einer festgeschriebenen Rechnung an eine andere: das
 * Storno, das sie aufhebt, und die Neuausstellung, die sie ersetzt.
 *
 * **Sie kann nicht auf `rechnung` liegen.** Sie entsteht NACH dem
 * Festschreiben, und der Unveraenderlichkeitsausloeser ist unbedingt — eine
 * Spalte `storniert_durch_rechnung_id` auf der Rechnungszeile hiesse, den
 * Ausloeser mit einer Spaltenliste zu versehen, und damit haette Invariante 4
 * auf Datenbankebene keine Deckung mehr (K-12).
 *
 * Die frueher hier gefuehrte Bezeichnung `storno_verweis` ist geloescht
 * (K-21).
 */
create table rechnung_beziehung (
  id               uuid primary key default gen_random_uuid(),
  mandant_id       uuid not null references mandant(id),

  -- Das SPAETERE Dokument: das Storno oder die Neuausstellung.
  von_rechnung_id  uuid not null,
  -- Das Dokument, auf das es sich zurueckbezieht.
  zu_rechnung_id   uuid not null,

  art              rechnung_beziehung_art not null,
  storno_art       storno_art,
  grund            text,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint rb_mandant_uk unique (mandant_id, id),
  constraint rb_von_fk foreign key (mandant_id, von_rechnung_id)
    references rechnung (mandant_id, id),
  constraint rb_zu_fk foreign key (mandant_id, zu_rechnung_id)
    references rechnung (mandant_id, id),
  constraint rb_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint rb_nicht_auf_sich_selbst check (von_rechnung_id <> zu_rechnung_id),
  constraint rb_storno_art check ((art = 'storno') = (storno_art is not null)),
  -- Ein auditfaehiger Grund, nicht „Fehler".
  constraint rb_storno_grund check (art <> 'storno' or length(btrim(grund)) >= 10)
);

-- Ein Storno hebt genau eine Rechnung auf, eine Neuausstellung ersetzt genau
-- eine.
create unique index rb_von_art_uk on rechnung_beziehung (von_rechnung_id, art);
-- Und eine Rechnung wird hoechstens EINMAL vollstorniert.
create unique index rb_vollstorno_uk on rechnung_beziehung (zu_rechnung_id)
  where art = 'storno' and storno_art = 'vollstorno';
-- „Was hat mich storniert" — die Abfrage, die die Umkehrzeile ersetzt.
create index rb_zu_idx on rechnung_beziehung (mandant_id, zu_rechnung_id);

-- ---------------------------------------------------------------------------
-- 9. Aufbewahrung (§1.10)
-- ---------------------------------------------------------------------------

/**
 * `aufbewahrung_bis` ist KEINE generierte Spalte.
 *
 * Der Entwurf hatte
 * `GENERATED ALWAYS AS (make_date(extract(year from erstellt_am at time zone
 * 'Europe/Berlin')::int + 10, 12, 31)) STORED`. Das laesst sich gar nicht
 * anlegen: `timestamptz AT TIME ZONE text` ist `timezone(text, timestamptz)`
 * und in PostgreSQL **stable**, waehrend eine `STORED`-Spalte einen
 * immutablen Ausdruck verlangt — die erste Migration der Phase 6 waere nicht
 * angelaufen.
 *
 * Und die zehn Jahre sind nicht unsere: §147 Abs. 3 AO und §14b Abs. 1 UStG
 * wurden zum 01.01.2025 fuer Buchungsbelege auf acht Jahre verkuerzt,
 * waehrend Buecher und Jahresabschluesse bei zehn bleiben. Eine Zahl fuer
 * alle Tabellen zu waehlen waere eine erfundene Compliance-Grenze (K-17).
 *
 * Gerechnet wird deshalb aus einem reinen `date` (`rechnungsdatum`), gegen
 * die vorhandene Aufbewahrungsregel, und ohne Regel gilt **Sperre**:
 * „keine Regel" heisst nicht „keine Pflicht", es heisst, dass niemand
 * entschieden hat.
 * // TODO(client, O-25): Aufbewahrungsfrist je Belegklasse mit dem
 * Steuerberater bestaetigen — welche Klasse faellt auf acht, welche auf zehn
 * Jahre, und gilt fuer laufende Verfahren eine Ablaufhemmung?
 */
create function fin.setze_aufbewahrung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  r record;
  v_basis date := new.rechnungsdatum;
begin
  if tg_op = 'UPDATE' then
    if old.loeschsperre and not new.loeschsperre then
      raise exception 'Die Loeschsperre einer Rechnung kann nicht aufgehoben werden (LEG-01)'
        using errcode = 'restrict_violation';
    end if;
  end if;

  select * into r from app.aufbewahrung_regel(new.mandant_id, new.aufbewahrung_klasse);

  if not found or r.jahre is null or v_basis is null then
    new.aufbewahrung_bis := null;
    new.loeschsperre := true;
    return new;
  end if;

  new.loeschsperre := r.loeschsperre or r.ist_platzhalter;
  new.aufbewahrung_bis := make_date(extract(year from v_basis)::int + r.jahre, 12, 31);
  return new;
end $$;

create trigger trg_rechnung_aufbewahrung
  before insert or update on rechnung
  for each row execute function fin.setze_aufbewahrung();

-- ---------------------------------------------------------------------------
-- 10. RLS (§1.1, §1.3, §1.4, K-03, K-04, K-18)
-- ---------------------------------------------------------------------------

alter table rechnung enable row level security;
alter table rechnung force  row level security;

/**
 * Die K-03-Standardpolicy — und ihr `WITH CHECK` verlangt zusaetzlich
 * `status = 'entwurf'`.
 *
 * Das ist die eigentliche Aussage dieser Policy: **der Uebergang nach
 * `festgeschrieben` ist ueber ein gewoehnliches UPDATE gar nicht erreichbar.**
 * Er laeuft ausschliesslich durch `fin.rechnung_nummer_ziehen` (0077) unter
 * einer eigenen, engeren Policy fuer `cse_definer`. Der erhoehte Weg ist
 * SCHMALER als der gewoehnliche, nicht breiter.
 */
create policy t_mandant on rechnung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and status = 'entwurf'
              and (select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * Das Verwerfen braucht eine EIGENE Policy, weil `t_mandant` im `WITH CHECK`
 * `status = 'entwurf'` verlangt und ein verworfener Entwurf genau das nicht
 * mehr ist. Ohne sie liesse sich ein Entwurf nur noch loeschen — was
 * Invariante 8 verbietet — oder gar nicht mehr loswerden.
 *
 * Eigenes Recht, nicht `finanzen.schreiben`: der Katalog fuehrt
 * `finanzen.entwurf_verwerfen`, und das Verwerfen ist der Uebergang, der eine
 * Nummer FUER IMMER nicht mehr entstehen laesst.
 */
create policy t_verwerfen on rechnung for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and status = 'entwurf'
              and (select app.hat_recht('finanzen.entwurf_verwerfen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and status = 'verworfen'
              and (select app.hat_recht('finanzen.entwurf_verwerfen', app.aktiver_mandant())));

create policy t_gruppe on rechnung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')));

/** K-18: das Kundenportal. Nie ein Entwurf — ein Kunde sieht kein Konzept. */
create policy t_kunde on rechnung for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden())
         and status = 'festgeschrieben');

/**
 * Die Decke (K-04), RESTRICTIVE und mit zwei Zweigen. Sie kann nur
 * einschraenken, nie gewaehren: `p_intern_ceiling` fuer alles Interne, der
 * Kundenzweig fuer den einen Fall, in dem eine Rechnung nach draussen
 * sichtbar ist. `mitarbeiter` faellt durch beide Zweige — EMP-13: ein
 * Mitarbeiter liest keine Marge.
 */
create policy p_rechnung_decke on rechnung as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id = any (app.aktuelle_kunden())
             and status = 'festgeschrieben'))
  with check (app.portal() = 'intern');

grant select, insert, update on rechnung to cse_app;

/**
 * Die vier Kindtabellen bekommen dieselbe Menge, und der Kundenzweig laeuft
 * jeweils DURCH DIE ELTERNZEILE (review B18). Ohne diesen Weg zeigte das
 * Kundenportal eine Rechnung mit Positionen, aber ohne Steuerzeilen — also
 * Summen, die sich nicht nachrechnen lassen.
 */
do $$
declare t text;
begin
  foreach t in array array['rechnungsposition', 'rechnung_zuschlag',
                           'rechnung_steuer'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);

    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')))$p$, t);

    execute format($p$
      create policy t_kunde on %I for select to cse_app
        using (app.scope() = 'kunde'
               and mandant_id = any (app.sichtbare_mandanten())
               and exists (select 1 from rechnung r
                            where r.mandant_id = %I.mandant_id
                              and r.id = %I.rechnung_id
                              and r.kunde_id = any (app.aktuelle_kunden())
                              and r.status = 'festgeschrieben'))$p$, t, t, t);

    execute format($p$
      create policy p_kind_decke on %I as restrictive for all to cse_app
        using (app.portal() = 'intern'
               or (app.portal() = 'kunde'
                   and exists (select 1 from rechnung r
                                where r.mandant_id = %I.mandant_id
                                  and r.id = %I.rechnung_id
                                  and r.kunde_id = any (app.aktuelle_kunden())
                                  and r.status = 'festgeschrieben')))
        with check (app.portal() = 'intern')$p$, t, t, t);

    execute format('grant select, insert, update on %I to cse_app', t);
  end loop;
end $$;

/**
 * `rechnung_beziehung` steht NICHT in der Schleife oben: sie traegt kein
 * `rechnung_id`, sondern zwei gerichtete Verweise, und der Kundenzweig muss
 * deshalb anders lauten — ein Kunde sieht die Beziehung, wenn ihm EINE der
 * beiden Rechnungen gehoert. Beides zu verlangen verschwiege ihm gerade die
 * Neuausstellung, die seine stornierte Rechnung ersetzt.
 */
alter table rechnung_beziehung enable row level security;
alter table rechnung_beziehung force  row level security;

create policy t_mandant on rechnung_beziehung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('finanzen.stornieren', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on rechnung_beziehung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')));

create policy t_kunde on rechnung_beziehung for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from rechnung r
                      where r.mandant_id = rechnung_beziehung.mandant_id
                        and r.id in (rechnung_beziehung.von_rechnung_id,
                                     rechnung_beziehung.zu_rechnung_id)
                        and r.kunde_id = any (app.aktuelle_kunden())
                        and r.status = 'festgeschrieben'));

create policy p_kind_decke on rechnung_beziehung as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and exists (select 1 from rechnung r
                          where r.mandant_id = rechnung_beziehung.mandant_id
                            and r.id in (rechnung_beziehung.von_rechnung_id,
                                         rechnung_beziehung.zu_rechnung_id)
                            and r.kunde_id = any (app.aktuelle_kunden())
                            and r.status = 'festgeschrieben')))
  with check (app.portal() = 'intern');

grant select, insert on rechnung_beziehung to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0075)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- steuersatz_gruppe (archiv): K-21, §14 Abs. 4 Nr. 8 UStG. Der EINE Steuerkatalog der Plattform. Eine Zeile zu loeschen bricht den Fremdschluessel jeder Rechnungsposition, die auf sie zeigt — und die Rechnung selbst darf sich nicht mehr aendern. Ein Satz laeuft ueber `gueltig_bis` aus; eine Aenderung ist eine NEUE Zeile mit eigenem Gueltigkeitsbeginn.
create trigger trg_steuersatz_gruppe_kein_hard_delete
  before delete on steuersatz_gruppe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_steuersatz_gruppe_kein_truncate
  before truncate on steuersatz_gruppe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on steuersatz_gruppe from cse_app, cse_anon, cse_checkin, cse_job;

-- masseinheit (append): FIN-11, EN 16931 BT-130. Die Einheit einer festgeschriebenen Position wird beim Nachdrucken und beim Export gelesen. Faellt die Zeile weg, laesst sich dieselbe Rechnung nicht mehr zweimal gleich ausgeben.
create trigger trg_masseinheit_kein_hard_delete
  before delete on masseinheit
  for each row execute function kern.verhindere_loeschung();
create trigger trg_masseinheit_kein_truncate
  before truncate on masseinheit
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on masseinheit from cse_app, cse_anon, cse_checkin, cse_job;

-- kleinbetrag_grenze (archiv): FIN-13, §33 UStDV. `ist_kleinbetrag` wird gegen die Schwelle des LEISTUNGSDATUMS eingefroren. Die historische Zeile zu loeschen hiesse, die Entscheidung nicht mehr begruenden zu koennen.
create trigger trg_kleinbetrag_grenze_kein_hard_delete
  before delete on kleinbetrag_grenze
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kleinbetrag_grenze_kein_truncate
  before truncate on kleinbetrag_grenze
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kleinbetrag_grenze from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung (archiv): Invariante 4 und 8, §147 AO, §14b UStG. Eine festgeschriebene Rechnung wird durch STORNO aufgehoben, nie entfernt; ein verworfener Entwurf bekommt `verworfen_am` samt Grund und bleibt stehen — genau er ist die Zeile, die eine Betriebspruefung liest, wenn sie nach der fehlenden Nummer fragt.
create trigger trg_rechnung_kein_hard_delete
  before delete on rechnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_kein_truncate
  before truncate on rechnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnungsposition (append): FIN-01, §14 Abs. 4 Nr. 5 UStG. Die Position IST der Leistungsnachweis auf dem Beleg. Waere sie loeschbar, koennte eine festgeschriebene Rechnung nachtraeglich kuerzer werden, waehrend Kopfsummen und Hash unveraendert stehen bleiben.
create trigger trg_rechnungsposition_kein_hard_delete
  before delete on rechnungsposition
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnungsposition_kein_truncate
  before truncate on rechnungsposition
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnungsposition from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_zuschlag (append): EN 16931 BG-20/BG-21. Ein entfernter Nachlass veraendert die Bemessungsgrundlage einer Steuergruppe, ohne dass der Kopf es zeigt.
create trigger trg_rechnung_zuschlag_kein_hard_delete
  before delete on rechnung_zuschlag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_zuschlag_kein_truncate
  before truncate on rechnung_zuschlag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_zuschlag from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_steuer (append): §14 Abs. 4 Nr. 8 UStG. Die Aufschluesselung nach Steuersaetzen ist der Teil des Belegs, den die Umsatzsteuervoranmeldung uebernimmt. Neu gerechnet wird im Entwurf durch UPSERT; eine Gruppe, die wegfaellt, faellt auf null statt aus der Tabelle.
create trigger trg_rechnung_steuer_kein_hard_delete
  before delete on rechnung_steuer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_steuer_kein_truncate
  before truncate on rechnung_steuer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_steuer from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_beziehung (append): K-12, Invariante 4. Sie IST die Storno-Rueckbeziehung — der einzige Ort, an dem steht, dass eine Rechnung aufgehoben wurde. Sie zu loeschen liesse die aufgehobene Rechnung wieder als gueltige dastehen.
create trigger trg_rechnung_beziehung_kein_hard_delete
  before delete on rechnung_beziehung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_beziehung_kein_truncate
  before truncate on rechnung_beziehung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_beziehung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_steuersatz_gruppe_geaendert_am
  before update on steuersatz_gruppe
  for each row execute function kern.setze_geaendert_am();
create trigger trg_masseinheit_geaendert_am
  before update on masseinheit
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnung_geaendert_am
  before update on rechnung
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnungsposition_geaendert_am
  before update on rechnungsposition
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnung_zuschlag_geaendert_am
  before update on rechnung_zuschlag
  for each row execute function kern.setze_geaendert_am();
create trigger trg_rechnung_steuer_geaendert_am
  before update on rechnung_steuer
  for each row execute function kern.setze_geaendert_am();

create trigger trg_steuersatz_gruppe_audit
  after insert or update or delete on steuersatz_gruppe
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_masseinheit_audit
  after insert or update or delete on masseinheit
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_kleinbetrag_grenze_audit
  after insert or update or delete on kleinbetrag_grenze
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_audit
  after insert or update or delete on rechnung
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnungsposition_audit
  after insert or update or delete on rechnungsposition
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_zuschlag_audit
  after insert or update or delete on rechnung_zuschlag
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_steuer_audit
  after insert or update or delete on rechnung_steuer
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_rechnung_beziehung_audit
  after insert or update or delete on rechnung_beziehung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
