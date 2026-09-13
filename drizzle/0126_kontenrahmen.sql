/**
 * 0126 — Kontenrahmen, DATEV-Stammdaten und die Kontenzuordnung (ACC-01,
 * PR 58).
 *
 * `05-FINANZEN.md` §9.3 (`datev_konfiguration`, `konto_mapping`), §3.1.
 *
 * **Was diese Migration NICHT tut: ein Konto raten.** Sie legt die Brücke
 * zwischen einem Geschäftsvorfall und einem Sachkonto an — und lässt sie
 * LEER. Welcher Kontenrahmen je Gesellschaft gilt (SKR03 oder SKR04), wie
 * lang die Sachkonten sind, welcher Steuerschlüssel zu welchem Satz gehört,
 * welche Beraternummer und welche Mandantennummer: das ist O-05, und O-05 ist
 * offen. Ein plausibel gewähltes Erlöskonto wäre die teuerste Sorte Fehler,
 * die dieses Projekt kennt — er fällt nicht beim Buchen auf, sondern beim
 * Steuerberater, Monate später, auf einem Beleg, der nach §14 UStG nicht mehr
 * geändert werden darf.
 *
 * TODO(client, O-05): Welcher Kontenrahmen gilt je Gesellschaft (SKR03 oder
 * SKR04)? Wie lang sind die Sachkonten? Welche Berater- und Mandantennummer?
 * Welche Steuerschlüsseltabelle? Soll- oder Ist-Versteuerung (§16/§20 UStG)?
 * Ab wann beginnt das Wirtschaftsjahr?
 *
 * **Drei Entscheidungen, die die Gestalt bestimmen:**
 *
 *   1. **SKR03 und SKR04 sind DATEN, kein Code.** Der Kontenrahmen ist eine
 *      Spalte auf der Zuordnung und ein Wert in der Konfiguration; ein Wechsel
 *      SKR03↔SKR04 ist damit ein Zeilenwechsel, keine Änderung am Programm.
 *      Der `KontenrahmenAdapter` im Dienst kennt beide Rahmen als Tabelle.
 *
 *   2. **Eine unbestätigte Zuordnung ist eine Zuordnung mit Platzhalter, kein
 *      fehlender Datensatz.** `ist_platzhalter` steht auf `true`, bis ein
 *      Mensch sie bestätigt; der Buchungsdienst schreibt dann `konto = NULL`
 *      samt `pruefhinweis` und stellt die Zeile in die Arbeitsliste. So ist
 *      sichtbar, WAS fehlt — ein fehlender Datensatz sähe aus wie ein
 *      Geschäftsvorfall, den niemand vorgesehen hat.
 *
 *   3. **Die Vorrangregel steht in der Datenbank, nicht in fünf Abfragen.**
 *      Zwei Zeilen können einander widersprechen; welche gewinnt, darf nicht
 *      davon abhängen, wer gerade fragt. `app.konto_aufloesen` hält die fünf
 *      Stufen aus §9.3 und meldet einen echten Gleichstand als solchen,
 *      statt zu würfeln.
 */

-- =========================================================================
-- 1. Die Vokabulare (§3.1)
-- =========================================================================

create type kontenrahmen as enum ('skr03', 'skr04');

comment on type kontenrahmen is
  'ACC-01. SKR03 (prozessgliedert) oder SKR04 (abschlussgliedert) — welcher je '
  'Gesellschaft gilt, ist O-05 und steht in datev_konfiguration, nicht im Code.';

create type versteuerungsart as enum ('soll', 'ist');

comment on type versteuerungsart is
  'Soll = §16 Abs. 1 UStG (vereinbarte Entgelte), Ist = §20 UStG (vereinnahmte). '
  'Sie aendert das Buchungsdatum und den BU-Schluessel JEDER Ausgangsrechnung — '
  'deshalb ohne Vorgabewert (O-05).';

create type konto_schluessel_typ as enum (
  'erloes_leistung', 'aufwand_kategorie', 'debitor_kunde', 'kreditor_lieferant',
  'geldkonto', 'steuer_gruppe', 'bauabzugsteuer_verbindlichkeit',
  'skonto_aufwand', 'skonto_ertrag', 'mahngebuehr_ertrag', 'zins_ertrag',
  'durchlaufender_posten');

comment on type konto_schluessel_typ is
  'ACC-01. Der Diskriminator der Kontenzuordnung: WORAUF sich die Zeile bezieht. '
  'Die sechs ersten tragen je eine Fremdschluesselspalte, die uebrigen keine — '
  'sie gelten je Mandant und Kontenrahmen genau einmal.';

-- =========================================================================
-- 2. `datev_konfiguration` — die Stammdaten je Gesellschaft (§9.3)
-- =========================================================================

/**
 * Eine Zeile je Mandant, angelegt von der Saat, und **jede fachliche Spalte
 * NULL**. Das ist kein unfertiger Zustand, sondern der einzige ehrliche: die
 * Werte stehen beim Steuerberater, nicht bei uns.
 *
 * `verbunden` bleibt `false`. Die Spalte existiert, damit eine kuenftige
 * Anbindung eine Datenaenderung ist und keine Migration — aber in Phase 7
 * liest kein Pfad `verbunden = true`, und es gibt keinen DATEV-Client.
 * „Keine falschen Integrationen" heisst hier: die Oberflaeche schreibt
 * „DATEV: nicht verbunden", und dabei bleibt es.
 */
create table datev_konfiguration (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  berater_nummer        text check (berater_nummer is null
                                     or berater_nummer ~ '^[0-9]{4,7}$'),
  mandanten_nummer      text check (mandanten_nummer is null
                                     or mandanten_nummer ~ '^[0-9]{1,5}$'),

  kontenrahmen          kontenrahmen,
  sachkontenlaenge      integer check (sachkontenlaenge is null
                                        or (sachkontenlaenge between 4 and 8)),

  /**
   * Zwei Kleinzahlen und kein `date`: ein Wirtschaftsjahresbeginn wiederholt
   * sich jaehrlich. Ein gespeichertes `2026-01-01` waere jeden Januar zu
   * pflegen — und die eingefrorene Kopie auf `datev_export` (PR 60) waere
   * damit sinnlos.
   */
  wj_beginn_monat       smallint check (wj_beginn_monat is null
                                         or (wj_beginn_monat between 1 and 12)),
  wj_beginn_tag         smallint check (wj_beginn_tag is null
                                         or (wj_beginn_tag between 1 and 31)),

  versteuerungsart      versteuerungsart,
  extf_version          text check (extf_version is null or extf_version ~ '^[0-9]{3}$'),

  /** GoBD-Festschreibungskennzeichen im Export. */
  festschreibung_standard boolean not null default true,

  /** IMMER false, solange keine Zugangsdaten existieren (SPEC, „no fake integrations"). */
  verbunden             boolean not null default false,

  /** Solange true, verweigert der Export (PR 60) den Dienst. */
  ist_platzhalter       boolean not null default true,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint datev_konfiguration_mandant_uk unique (mandant_id),
  constraint datev_konfiguration_mandant_id_uk unique (mandant_id, id),
  constraint datev_konfiguration_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

comment on table datev_konfiguration is
  'ACC-02, ACC-09, ACC-10, ACC-11. Die DATEV-Stammdaten je Gesellschaft. Alle '
  'fachlichen Spalten sind bis zur Antwort auf O-05 NULL, und ist_platzhalter '
  'bleibt true — ein Export mit erfundener Beraternummer waere schlimmer als keiner.';

/**
 * **Der Platzhalter faellt erst, wenn nichts mehr fehlt.**
 *
 * Ohne diesen Ausloeser waere `ist_platzhalter = false` eine Behauptung, die
 * ein Klick setzt. Danach liefe der Export los und schriebe eine Datei mit
 * leerer Beraternummer — die der Steuerberater ablehnt, nachdem er sie
 * eingelesen hat.
 */
create function fin.datev_konfiguration_vollstaendig() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_fehlend text[] := '{}';
begin
  if new.ist_platzhalter or new.ist_platzhalter = old.ist_platzhalter then
    return new;
  end if;

  if new.berater_nummer   is null then v_fehlend := v_fehlend || 'Beraternummer'; end if;
  if new.mandanten_nummer is null then v_fehlend := v_fehlend || 'Mandantennummer'; end if;
  if new.kontenrahmen     is null then v_fehlend := v_fehlend || 'Kontenrahmen'; end if;
  if new.sachkontenlaenge is null then v_fehlend := v_fehlend || 'Sachkontenlaenge'; end if;
  if new.wj_beginn_monat  is null then v_fehlend := v_fehlend || 'Wirtschaftsjahr-Beginn (Monat)'; end if;
  if new.wj_beginn_tag    is null then v_fehlend := v_fehlend || 'Wirtschaftsjahr-Beginn (Tag)'; end if;
  if new.versteuerungsart is null then v_fehlend := v_fehlend || 'Versteuerungsart'; end if;
  if new.extf_version     is null then v_fehlend := v_fehlend || 'EXTF-Fassung'; end if;

  if array_length(v_fehlend, 1) is not null then
    raise exception 'Die DATEV-Stammdaten sind unvollstaendig: %', array_to_string(v_fehlend, ', ')
      using errcode = 'check_violation',
            hint = 'Erst eintragen, dann bestaetigen — ein Export mit leeren Stammdaten (O-05) wird abgewiesen.';
  end if;
  return new;
end $$;

create trigger datev_konfiguration_vollstaendig
  before update on datev_konfiguration
  for each row execute function fin.datev_konfiguration_vollstaendig();

create trigger datev_konfiguration_geaendert
  before update on datev_konfiguration
  for each row execute function kern.setze_geaendert_am();

-- =========================================================================
-- 3. `konto_mapping` — die Bruecke vom Geschaeftsvorfall zum Sachkonto (§9.3)
-- =========================================================================

create table konto_mapping (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  kontenrahmen          kontenrahmen not null,
  schluessel_typ        konto_schluessel_typ not null,

  /* --- die sechs mandantengebundenen Diskriminatoren (§13) --- */
  leistungskatalog_position_id uuid,
  /**
   * Die Alternative zur Positionszeile: `auftrag_leistung` und
   * `leistungskatalog_position` tragen laengst ein `erloeskonto_schluessel`
   * als Etikett. Eine Zuordnung darf auf dem Etikett schluesseln statt auf
   * der Zeile — sonst braeuchte jede neue Katalogposition eine eigene Zeile.
   */
  erloeskonto_schluessel text check (erloeskonto_schluessel is null
                                      or length(btrim(erloeskonto_schluessel)) > 0),
  /**
   * TODO(client, O-05): `ausgabe_kategorie` gibt es noch nicht (PR 54.3b).
   * Die Spalte steht hier, weil §9.3 sie nennt und die CHECK-Gestalt sie
   * braucht; der zusammengesetzte Fremdschluessel kommt mit der Elterntabelle.
   * Bis dahin verbietet `km_typ_hat_eltern` den Typ `aufwand_kategorie` —
   * eine Zuordnung auf eine Kategorie, die es nicht gibt, waere eine Zeile,
   * die niemand aufloesen kann.
   */
  ausgabe_kategorie_id  uuid,
  kunde_id              uuid,
  lieferant_id          uuid,
  bankkonto_id          uuid,
  kasse_id              uuid,

  /**
   * EINSPALTIG, und das mit Absicht: `steuersatz_gruppe` ist global und
   * traegt kein `mandant_id` (§3.2) — ein zusammengesetzter Schluessel laesst
   * sich gar nicht bilden. §13 nennt sie als eine der vier bewusst
   * einspaltigen Beziehungen.
   */
  steuersatz_gruppe_id  uuid references steuersatz_gruppe(id),

  /* --- das Ergebnis --- */
  konto                 text not null check (konto ~ '^[0-9]+$'),
  gegenkonto            text check (gegenkonto is null or gegenkonto ~ '^[0-9]+$'),
  /** TODO(client, O-05): Steuerschluesseltabelle vom Steuerberater. */
  bu_schluessel         text check (bu_schluessel is null or bu_schluessel ~ '^[0-9]{1,4}$'),

  prioritaet            integer not null default 100,
  gueltig_von           date not null,
  gueltig_bis           date,

  /**
   * **Der Vorgabewert ist `true`, und das ist der Kern dieser Tabelle.**
   * Eine Zuordnung, die niemand bestaetigt hat, erzeugt eine Buchung OHNE
   * Konto und mit Pruefhinweis — nie eine Buchung auf ein geratenes Konto.
   */
  ist_platzhalter       boolean not null default true,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint konto_mapping_mandant_uk unique (mandant_id, id),
  constraint konto_mapping_zeitraum check (gueltig_bis is null or gueltig_bis >= gueltig_von),

  /**
   * **Genau ein Diskriminator — oder gar keiner.**
   *
   * Die sechs typgebundenen Zeilen tragen genau eine Kennung; die sechs
   * uebrigen Typen (Bauabzugsteuer, Skonto, Mahngebuehr, Zins, durchlaufender
   * Posten) gelten je Mandant und Rahmen einmal und tragen keine.
   *
   * `steuersatz_gruppe_id` zaehlt hier NICHT mit: sie ist bei
   * `steuer_gruppe` der Diskriminator und bei `erloes_leistung` ein
   * zusaetzlicher Qualifizierer (siehe die Vorrangregel unten).
   */
  constraint km_genau_ein_diskriminator check (
    num_nonnulls(leistungskatalog_position_id, erloeskonto_schluessel,
                 ausgabe_kategorie_id, kunde_id, lieferant_id, bankkonto_id,
                 kasse_id, case when schluessel_typ = 'steuer_gruppe'
                                then steuersatz_gruppe_id end)
    = case when schluessel_typ in ('bauabzugsteuer_verbindlichkeit', 'skonto_aufwand',
                                   'skonto_ertrag', 'mahngebuehr_ertrag', 'zins_ertrag',
                                   'durchlaufender_posten')
           then 0 else 1 end),

  /** Und der RICHTIGE Diskriminator zum jeweiligen Typ. */
  constraint km_diskriminator_passt_zum_typ check (
    case schluessel_typ
      when 'erloes_leistung'     then (leistungskatalog_position_id is not null
                                       or erloeskonto_schluessel is not null)
      when 'aufwand_kategorie'   then ausgabe_kategorie_id is not null
      when 'debitor_kunde'       then kunde_id is not null
      when 'kreditor_lieferant'  then lieferant_id is not null
      when 'geldkonto'           then (bankkonto_id is not null or kasse_id is not null)
      when 'steuer_gruppe'       then steuersatz_gruppe_id is not null
      else true
    end),

  /**
   * **Was noch keine Elterntabelle hat, wird auch nicht zugeordnet.**
   * `ausgabe_kategorie` kommt mit PR 54.3b; bis dahin waere eine Zeile dieses
   * Typs ein Verweis ins Leere, den erst der Buchungsdienst bemerkte.
   */
  constraint km_typ_hat_eltern check (schluessel_typ <> 'aufwand_kategorie'),

  constraint konto_mapping_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint km_lkp_fk foreign key (mandant_id, leistungskatalog_position_id)
    references leistungskatalog_position (mandant_id, id),
  constraint km_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint km_lieferant_fk foreign key (mandant_id, lieferant_id)
    references lieferant (mandant_id, id),
  constraint km_bankkonto_fk foreign key (mandant_id, bankkonto_id)
    references bankkonto (mandant_id, id),
  constraint km_kasse_fk foreign key (mandant_id, kasse_id)
    references kasse (mandant_id, id)
);

comment on table konto_mapping is
  'ACC-01, ACC-02, ACC-07. Geschaeftsvorfall -> Sachkonto/Gegenkonto/BU-Schluessel '
  'in EINEM Kontenrahmen, gueltig fuer einen Zeitraum. Leer geseedet (O-05): '
  'ohne bestaetigte Zuordnung entsteht eine Buchung ohne Konto, nie eine geratene.';

/** Die Abfrage des Aufloesers. */
create index km_aufloesen_idx on konto_mapping
  (mandant_id, kontenrahmen, schluessel_typ, prioritaet, gueltig_von desc);
/** Die Arbeitsliste „was ist noch Platzhalter". */
create index km_platzhalter_idx on konto_mapping (mandant_id)
  where ist_platzhalter;

create unique index km_erloes_lkp_uk on konto_mapping
  (mandant_id, kontenrahmen, leistungskatalog_position_id,
   coalesce(steuersatz_gruppe_id, '00000000-0000-0000-0000-000000000000'::uuid), gueltig_von)
  where schluessel_typ = 'erloes_leistung' and leistungskatalog_position_id is not null;
create unique index km_erloes_schluessel_uk on konto_mapping
  (mandant_id, kontenrahmen, erloeskonto_schluessel,
   coalesce(steuersatz_gruppe_id, '00000000-0000-0000-0000-000000000000'::uuid), gueltig_von)
  where schluessel_typ = 'erloes_leistung' and erloeskonto_schluessel is not null;
create unique index km_debitor_uk on konto_mapping
  (mandant_id, kontenrahmen, kunde_id, gueltig_von) where schluessel_typ = 'debitor_kunde';
create unique index km_kreditor_uk on konto_mapping
  (mandant_id, kontenrahmen, lieferant_id, gueltig_von) where schluessel_typ = 'kreditor_lieferant';
create unique index km_geldkonto_bank_uk on konto_mapping
  (mandant_id, kontenrahmen, bankkonto_id, gueltig_von)
  where schluessel_typ = 'geldkonto' and bankkonto_id is not null;
create unique index km_geldkonto_kasse_uk on konto_mapping
  (mandant_id, kontenrahmen, kasse_id, gueltig_von)
  where schluessel_typ = 'geldkonto' and kasse_id is not null;
create unique index km_steuer_uk on konto_mapping
  (mandant_id, kontenrahmen, steuersatz_gruppe_id, gueltig_von)
  where schluessel_typ = 'steuer_gruppe';
/** Die sechs Typen ohne Diskriminator: je Mandant, Rahmen und Beginn einmal. */
create unique index km_ohne_diskriminator_uk on konto_mapping
  (mandant_id, kontenrahmen, schluessel_typ, gueltig_von)
  where schluessel_typ in ('bauabzugsteuer_verbindlichkeit', 'skonto_aufwand',
                           'skonto_ertrag', 'mahngebuehr_ertrag', 'zins_ertrag',
                           'durchlaufender_posten');

create trigger konto_mapping_geaendert
  before update on konto_mapping
  for each row execute function kern.setze_geaendert_am();

-- =========================================================================
-- 4. `app.konto_aufloesen` — die Vorrangregel, an EINER Stelle (§9.3)
-- =========================================================================

create type konto_treffer as (
  konto           text,
  gegenkonto      text,
  bu_schluessel   text,
  mapping_id      uuid,
  ist_platzhalter boolean,
  pruefhinweis    text
);

comment on type konto_treffer is
  'Das Ergebnis von app.konto_aufloesen. konto IS NULL heisst: keine bestaetigte '
  'Zuordnung — pruefhinweis sagt warum, und der Buchungsdienst stellt die Zeile '
  'in die Arbeitsliste, statt ein Konto zu raten.';

/**
 * Loest einen Geschaeftsvorfall in fünf Stufen auf und hoert bei der ersten
 * auf, die trifft (§9.3):
 *
 *   1. Leistung UND Steuergruppe   2. Leistung allein
 *   3. Erloesschluessel UND Gruppe 4. Erloesschluessel allein
 *   5. die Steuergruppenzeile allein (fuer den BU-Schluessel)
 *
 * Innerhalb einer Stufe entscheidet `prioritaet` aufsteigend, dann
 * `gueltig_von` absteigend.
 *
 * **Ein Gleichstand ist ein Konfigurationsfehler und wird als solcher
 * gemeldet — er wirft aber nicht.** §9.3 sagt „der Aufloeser raises"; das
 * waere hier falsch herum gedacht: die Aufloesung laeuft INNERHALB der
 * Festschreibung einer Rechnung, und ein Ausnahmefehler risse den ganzen
 * Beleg mit. Eine einzelne mehrdeutige Zuordnung darf eine Rechnung nicht am
 * Festschreiben hindern; sie muss eine Buchungszeile ohne Konto und mit
 * Hinweis erzeugen, die in der Arbeitsliste steht. Genau das tut diese
 * Funktion — und `periode` laesst sich nicht schliessen, solange eine solche
 * Zeile offen ist (0127). Der Fehler bleibt damit unuebersehbar, ohne die
 * Rechnung zu verlieren. (D-424)
 *
 * **SECURITY DEFINER, und das ist kein Bequemlichkeitsgriff.** Wer bucht,
 * traegt `buchhaltung.schreiben`; die Zuordnung gehoert dem Modul
 * `buchhaltung_konfiguration`, das ein Buchhalter nicht lesen muss. Dieselbe
 * Trennung wie bei `app.kunde_mahnsperre_aktiv` (D-407): die Funktion
 * beantwortet eine enge Frage, statt ein Leserecht auf Stammdaten zu
 * verschenken.
 */
create function app.konto_aufloesen(
  p_mandant                     uuid,
  p_typ                         konto_schluessel_typ,
  p_datum                       date,
  p_leistungskatalog_position   uuid    default null,
  p_erloeskonto_schluessel      text    default null,
  p_steuersatz_gruppe           uuid    default null,
  p_kunde                       uuid    default null,
  p_lieferant                   uuid    default null,
  p_bankkonto                   uuid    default null,
  p_kasse                       uuid    default null
) returns konto_treffer
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  v_rahmen kontenrahmen;
  v_zeile  record;
begin
  /*
   * Das Tor: der Job darf immer, die Gruppenansicht braucht das
   * Gruppenrecht, und sonst genuegt EINES der beiden Modulrechte — wer bucht
   * (`buchhaltung.schreiben`) ebenso wie wer die Zuordnung pflegt.
   */
  if session_user = 'cse_job' then
    null;
  elsif app.ist_gruppenansicht() then
    if not (p_mandant = any (app.rechte_mandanten('gruppe.buchhaltung.lesen'))) then
      raise exception 'gruppe.buchhaltung.lesen fehlt' using errcode = '42501';
    end if;
  elsif not (app.hat_recht('buchhaltung.schreiben', p_mandant)
             or app.hat_recht('buchhaltung.lesen', p_mandant)
             or app.hat_recht('buchhaltung_konfiguration.lesen', p_mandant)) then
    raise exception 'buchhaltung.lesen fehlt' using errcode = '42501';
  end if;

  /*
   * **Zuerst der Rahmen, und zwar mit eigenem Hinweis.** Ohne beantwortetes
   * O-05 steht in `datev_konfiguration.kontenrahmen` NULL; jede Zuordnung
   * liefe dann ins Leere. „Kontenzuordnung fehlt" waere hier die falsche
   * Auskunft — es fehlt nicht die Zeile, es fehlt die Grundeinstellung.
   */
  select dk.kontenrahmen into v_rahmen
    from public.datev_konfiguration dk
   where dk.mandant_id = p_mandant;

  if v_rahmen is null then
    return (null, null, null, null, true,
            'Kontenrahmen nicht festgelegt (O-05)')::konto_treffer;
  end if;

  select k.* into v_zeile from (
    with kandidat as (
      select km.*,
             case
               when km.schluessel_typ = 'erloes_leistung'
                    and km.leistungskatalog_position_id is not null
                    and km.leistungskatalog_position_id = p_leistungskatalog_position
                    and km.steuersatz_gruppe_id is not null
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 1
               when km.schluessel_typ = 'erloes_leistung'
                    and km.leistungskatalog_position_id is not null
                    and km.leistungskatalog_position_id = p_leistungskatalog_position
                    and km.steuersatz_gruppe_id is null                            then 2
               when km.schluessel_typ = 'erloes_leistung'
                    and km.erloeskonto_schluessel is not null
                    and km.erloeskonto_schluessel = p_erloeskonto_schluessel
                    and km.steuersatz_gruppe_id is not null
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 3
               when km.schluessel_typ = 'erloes_leistung'
                    and km.erloeskonto_schluessel is not null
                    and km.erloeskonto_schluessel = p_erloeskonto_schluessel
                    and km.steuersatz_gruppe_id is null                            then 4
               when km.schluessel_typ = 'steuer_gruppe'
                    and km.steuersatz_gruppe_id = p_steuersatz_gruppe              then 5
               when km.schluessel_typ = 'debitor_kunde'      and km.kunde_id     = p_kunde     then 1
               when km.schluessel_typ = 'kreditor_lieferant' and km.lieferant_id = p_lieferant then 1
               when km.schluessel_typ = 'geldkonto'
                    and (km.bankkonto_id = p_bankkonto or km.kasse_id = p_kasse)   then 1
               when km.schluessel_typ in ('bauabzugsteuer_verbindlichkeit', 'skonto_aufwand',
                                          'skonto_ertrag', 'mahngebuehr_ertrag', 'zins_ertrag',
                                          'durchlaufender_posten')                 then 1
               else null
             end as stufe
        from public.konto_mapping km
       where km.mandant_id = p_mandant
         and km.schluessel_typ = p_typ
         and km.kontenrahmen = v_rahmen
         and km.gueltig_von <= p_datum
         and (km.gueltig_bis is null or km.gueltig_bis >= p_datum)
    )
    select ka.id, ka.konto, ka.gegenkonto, ka.bu_schluessel, ka.ist_platzhalter,
           ka.stufe, ka.prioritaet, ka.gueltig_von,
           count(*) over (partition by ka.stufe, ka.prioritaet, ka.gueltig_von) as gleichstand
      from kandidat ka
     where ka.stufe is not null
     order by ka.stufe, ka.prioritaet, ka.gueltig_von desc
     limit 1
  ) k;

  /*
   * Kein Treffer ist KEIN Fehler dieser Funktion: es heisst, dass fuer diesen
   * Geschaeftsvorfall niemand eine Zuordnung hinterlegt hat. Der Hinweis
   * nennt den Typ, damit die Arbeitsliste sagt, WAS zu hinterlegen ist.
   */
  if not found then
    return (null, null, null, null, true,
            format('Kontenzuordnung fehlt (%s)', p_typ))::konto_treffer;
  end if;

  if v_zeile.gleichstand > 1 then
    return (null, null, null, v_zeile.id, true, 'Kontierung mehrdeutig')::konto_treffer;
  end if;

  if v_zeile.ist_platzhalter then
    return (null, null, null, v_zeile.id, true,
            'Kontenzuordnung ist noch ein Platzhalter (O-05)')::konto_treffer;
  end if;

  return (v_zeile.konto, v_zeile.gegenkonto, v_zeile.bu_schluessel,
          v_zeile.id, false, null)::konto_treffer;
end $$;

alter function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text, uuid,
                                   uuid, uuid, uuid, uuid) owner to cse_definer;
revoke all on function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text, uuid,
                                           uuid, uuid, uuid, uuid) from public;
grant execute on function app.konto_aufloesen(uuid, konto_schluessel_typ, date, uuid, text, uuid,
                                              uuid, uuid, uuid, uuid) to cse_app, cse_job;

-- =========================================================================
-- 5. RLS und Rechte (§1.1–§1.5, K-03, K-04, D-388)
-- =========================================================================

alter table datev_konfiguration enable row level security;
alter table datev_konfiguration force  row level security;
alter table konto_mapping       enable row level security;
alter table konto_mapping       force  row level security;

/**
 * Beide Tische sind reine Konfiguration: ein Kunde hat hier nichts zu suchen,
 * und ein Mitarbeiterportal auch nicht — daher `p_intern_ceiling` ohne
 * Kundenzweig.
 *
 * Schreiben verlangt `buchhaltung_konfiguration.verwalten`. Das ist enger als
 * `buchhaltung.schreiben` mit Absicht: wer bucht, ordnet nicht zu.
 */
do $$
declare t text;
begin
  foreach t in array array['datev_konfiguration', 'konto_mapping'] loop
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('buchhaltung_konfiguration.lesen',
                                              app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('buchhaltung_konfiguration.verwalten',
                                              app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.buchhaltung_konfiguration.lesen')))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;
end $$;

grant select, insert, update on datev_konfiguration, konto_mapping to cse_app;

/**
 * **Der Aufloeser liest als `cse_definer` — also braucht ER die Rechte, nicht
 * der Aufrufer** (D-388: Postgres prueft erst das GRANT, dann die Policy).
 * Ohne diese vier Zeilen liefe `app.konto_aufloesen` in „permission denied
 * for table konto_mapping", und zwar erst beim ersten echten Buchungslauf.
 */
grant select on konto_mapping, datev_konfiguration to cse_definer;

create policy d_km_lesen on konto_mapping for select to cse_definer using (true);
create policy d_dk_lesen on datev_konfiguration for select to cse_definer using (true);

/**
 * Die Saat legt je Mandant eine leere Konfiguration an — und der Job liest sie
 * (PR 60 exportiert, PR 58 bucht). `cse_job` bekommt deshalb Lesen, mehr
 * nicht: eine Kontenzuordnung aendert kein Hintergrundlauf.
 */
grant select on konto_mapping, datev_konfiguration to cse_job;

create policy j_km_lesen on konto_mapping for select to cse_job using (true);
create policy j_dk_lesen on datev_konfiguration for select to cse_job using (true);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0126)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- konto_mapping (archiv): ACC-01. Eine geloeschte Kontenzuordnung macht jede Buchung, die auf ihr beruht, unerklaerlich: das Konto steht im buchungssatz, der Grund ist fort. Geschlossen wird mit gueltig_bis.
create trigger trg_konto_mapping_kein_hard_delete
  before delete on konto_mapping
  for each row execute function kern.verhindere_loeschung();
create trigger trg_konto_mapping_kein_truncate
  before truncate on konto_mapping
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on konto_mapping from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

