-- ---------------------------------------------------------------------------
-- 0021 — Objekte, Raumbuch und die zwei Kataloge dahinter (OPS-01..04).
--
-- **Diese Migration ist die Grundlage der Reinigungspreise.** `raum` und
-- `belagsart` zusammen sind alles, was OPS-02/03 braucht:
--
--     Σ (m² ÷ Leistungswert) × Frequenzfaktor
--
-- Zwei Entscheidungen darin sind nicht offensichtlich und kosten Geld, wenn
-- man sie falsch trifft:
--
--  1. **Der natuerliche Schluessel eines Raums ist (Objekt, Etage, Nummer)**,
--     nicht (Objekt, Nummer). "101" im Untergeschoss und "101" im ersten Stock
--     sind zwei Raeume. Faellt der zweite weg, fehlen seine m² in der Summe —
--     und heraus kommt ein systematisch ZU BILLIGES Angebot, das kein Test
--     bemerkt, weil die Rechnung an sich stimmt.
--
--  2. **Der Leistungswert ist ZEITLICH versioniert.** Wer ihn ueberschreibt,
--     rechnet ein unterschriebenes Angebot rueckwirkend neu. Ein neuer Wert
--     schliesst den alten (`gueltig_bis`) und legt eine Zeile an; ein
--     GiST-Ausschluss sorgt dafuer, dass "der Wert am Tag X" auch am
--     Wechseltag genau eine Antwort hat.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- belagsart — der Katalog, der aus Quadratmetern einen Preis macht.
-- ---------------------------------------------------------------------------

create table belagsart (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  code          text not null,
  bezeichnung   text not null,
  beschreibung  text,
  -- Kein Geldbetrag, sondern eine Flaechenleistung: wie viele Quadratmeter
  -- eine Kraft in einer Stunde schafft. Der Preis entsteht erst in
  -- server/services, aus Stunden mal Stundensatz in ganzen Cent.
  leistungswert_qm_pro_stunde numeric(10,3) not null, -- nicht-geld: m²/h
  -- Ein Leistungswert ohne genannte Quelle laesst sich im Preisstreit nicht
  -- verteidigen. Deshalb `not null`.
  quelle        text not null,
  -- // TODO(client, O-17): Leistungswerte (m²/h) je Belagsart — aus welcher
  -- Quelle stammen sie, und gelten sie je Gesellschaft unterschiedlich?
  ist_platzhalter boolean not null default true,
  gueltig_ab    date not null,
  gueltig_bis   date,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint belagsart_mandant_uk unique (mandant_id, id),
  constraint belagsart_leistungswert_positiv check (leistungswert_qm_pro_stunde > 0),
  constraint belagsart_zeitraum_stimmig check (gueltig_bis is null or gueltig_bis >= gueltig_ab),

  /**
   * Genau EIN gueltiger Wert je Code und Tag — auch am Wechseltag.
   *
   * `gueltig_bis` ist EINSCHLIESSLICH (§0.7), der Bereich also
   * `[gueltig_ab, gueltig_bis + 1)`. Ohne diesen Ausschluss haette "der
   * Leistungswert am 1. Maerz" zwei Antworten, sobald jemand den neuen Satz
   * am selben Tag beginnen laesst, an dem der alte endet — und welche die
   * Kalkulation nimmt, entschiede die Zeilenreihenfolge.
   */
  constraint belagsart_zeitraum_eindeutig exclude using gist (
    mandant_id with =, code with =,
    daterange(gueltig_ab, coalesce(gueltig_bis + 1, 'infinity'::date), '[)') with &&)
);

create unique index belagsart_code_uk on belagsart (mandant_id, code)
  where gueltig_bis is null;
create index belagsart_historie_idx on belagsart (mandant_id, code, gueltig_ab desc);
create index belagsart_platzhalter_idx on belagsart (mandant_id) where ist_platzhalter;

-- ---------------------------------------------------------------------------
-- reinigungsklasse — ein Katalog, KEIN Enum.
-- ---------------------------------------------------------------------------

/**
 * Sie traegt ausdruecklich KEINEN Frequenzfaktor und KEINE Preiswirkung.
 *
 * Einen anzuhaengen hiesse, eine Preisregel zu erfinden (K-17). Wenn der
 * Mandant O-55 beantwortet, kommt der Faktor hierher — mit eigenem
 * `gueltig_ab`/`gueltig_bis` — und die Kalkulation liest ihn. Bis dahin ist
 * die Klasse eine Beschreibung dessen, was zu tun ist, und nichts weiter.
 */
create table reinigungsklasse (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  code          text not null,
  bezeichnung   text not null,
  beschreibung  text,
  sortierung    integer not null default 0,
  -- // TODO(client, O-55): Welche Reinigungsklassen werden verwendet (DIN
  -- 77400, eigenes Schema, kundenspezifisch)? Steuern sie Frequenz, Preis,
  -- beides oder nichts?
  ist_platzhalter boolean not null default true,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint reinigungsklasse_mandant_uk unique (mandant_id, id)
);

create unique index reinigungsklasse_code_uk on reinigungsklasse (mandant_id, code)
  where archiviert_am is null;
create index reinigungsklasse_sortierung_idx on reinigungsklasse (mandant_id, sortierung)
  where archiviert_am is null;

-- ---------------------------------------------------------------------------
-- objekt — ein Gebaeude oder Gelaende.
-- ---------------------------------------------------------------------------

create table objekt (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  /**
   * Nullbar mit Absicht: dasselbe Gebaeude wird zu Recht von zwei Kunden
   * derselben Gesellschaft beauftragt (Eigentuemer und Mieter), und ein
   * Veranstaltungsort (REQ-03) existiert, bevor es einen Kundenstamm gibt.
   * Ein Objekt ist ein ORT; die kaufmaennische Beziehung haengt am Auftrag.
   * // TODO(client, O-70): Wird ein Gebaeude, das fuer zwei Kunden derselben
   * Gesellschaft betreut wird, als ein Objekt oder als zwei gefuehrt?
   */
  kunde_id      uuid,
  objektnummer  text not null,
  bezeichnung   text not null,
  -- // TODO(client, O-69): Kontrolliertes Vokabular fuer Gebaeudetyp? Bis
  -- dahin freier Text, damit keine falsche Liste einbetoniert wird.
  gebaeudetyp   text,
  strasse       text not null,
  hausnummer    text,
  adresszusatz  text,
  plz           text not null,
  ort           text not null,
  land          char(2) not null default 'DE',
  geo_lat       numeric(9,6),
  geo_lon       numeric(9,6),
  ansprechpartner_id uuid,
  etagen_anzahl smallint,
  zutritt_hinweis text,
  bemerkung     text,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint objekt_mandant_uk unique (mandant_id, id),
  constraint objekt_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  /**
   * Der Ansprechpartner haengt am (Mandant, KUNDE, Kontakt) — nicht nur am
   * Mandanten. Das ist es, was einen Vor-Ort-Kontakt eines ANDEREN Kunden
   * nicht einfuegbar macht.
   */
  constraint objekt_ansprechpartner_fk
    foreign key (mandant_id, kunde_id, ansprechpartner_id)
    references ansprechpartner (mandant_id, kunde_id, id),
  constraint objekt_geo_vollstaendig check ((geo_lat is null) = (geo_lon is null)),
  constraint objekt_geo_lat_bereich check (geo_lat is null or geo_lat between -90 and 90),
  constraint objekt_geo_lon_bereich check (geo_lon is null or geo_lon between -180 and 180)
);

create unique index objekt_nummer_uk on objekt (mandant_id, objektnummer)
  where archiviert_am is null;
create index objekt_kunde_idx on objekt (mandant_id, kunde_id) where archiviert_am is null;
create index objekt_bezeichnung_trgm on objekt using gin (bezeichnung gin_trgm_ops);
create index objekt_ort_idx on objekt (mandant_id, plz, ort);
create index objekt_ohne_geo_idx on objekt (mandant_id)
  where geo_lat is null and archiviert_am is null;

-- ---------------------------------------------------------------------------
-- raum — eine Zeile des Raumbuchs.
-- ---------------------------------------------------------------------------

create table raum (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  objekt_id     uuid not null,
  /**
   * Nullbar: ein echtes Raumbuch enthaelt Flur, Treppenhaus, Aufzugsvorraum
   * und WC-Vorraum ohne Tuernummer. `NOT NULL` zwaenge den Importeur, eine zu
   * erfinden — und eine erfundene Nummer ist eine, die beim naechsten Import
   * anders erfunden wird.
   */
  raumnummer    text,
  bezeichnung   text,
  -- Text, nicht Zahl: "UG", "EG", "1", "ZG".
  etage         text,
  nutzungsart   text,
  flaeche_qm    numeric(12,3) not null,
  belagsart_id  uuid,
  reinigungsklasse_id uuid,
  -- CLN-05: Glasreinigung wird auf GLASflaeche gerechnet, nicht auf Bodenflaeche.
  fenster_flaeche_qm numeric(12,3),
  -- Der stabile Schluessel des Importeurs. Getrennt von der Tuernummer, damit
  -- Idempotenz nicht an einer Nummer haengt, die es nicht ueberall gibt.
  quell_schluessel text,
  bemerkung     text,
  sortierung    integer not null default 0,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint raum_mandant_uk unique (mandant_id, id),
  constraint raum_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint raum_belagsart_fk foreign key (mandant_id, belagsart_id)
    references belagsart (mandant_id, id),
  constraint raum_reinigungsklasse_fk foreign key (mandant_id, reinigungsklasse_id)
    references reinigungsklasse (mandant_id, id),
  constraint raum_flaeche_positiv check (flaeche_qm > 0),
  constraint raum_fensterflaeche_nicht_negativ
    check (fenster_flaeche_qm is null or fenster_flaeche_qm >= 0)
);

/**
 * (Objekt, Etage, Raumnummer) — und genau hier liegt der teure Fehler.
 *
 * `UNIQUE (objekt_id, raumnummer)` faellt "101" im UG mit "101" im 1. OG
 * zusammen. Jeder so verschmolzene Raum verliert seine m² aus
 * `Σ m² ÷ Leistungswert`, und heraus kommt ein systematisch zu billiges
 * Angebot — mit korrekter Rechnung, weshalb es niemandem auffaellt.
 */
create unique index raum_natuerlich_uk
  on raum (objekt_id, coalesce(etage, ''), raumnummer)
  where archiviert_am is null and raumnummer is not null;

/**
 * Und der Raum OHNE Nummer — die Luecke, durch die Dubletten kamen.
 *
 * Ein Flur, ein Treppenhaus, ein WC-Vorraum: viele Raumbuecher fuehren sie
 * mit Bezeichnung und ohne Nummer. Fuer die griff bisher KEIN Schluessel —
 * `raum_natuerlich_uk` verlangt eine Nummer, `raum_quelle_uk` einen
 * Quellschluessel. Zwei getrennte Vorschauen derselben Datei entschieden
 * darum beide auf „anlegen“, und die zweite Uebernahme legte den Flur ein
 * zweites Mal an. Ab da zaehlt seine Flaeche doppelt in jede Kalkulation.
 *
 * Verglichen wird die Bezeichnung in Kleinschreibung und ohne Randleerzeichen
 * — „Flur Nord“ und „flur nord “ sind derselbe Raum, und ein Import, der das
 * anders sieht, hat dasselbe Problem unter anderem Namen.
 */
create unique index raum_bezeichnung_uk
  on raum (objekt_id, coalesce(etage, ''), lower(btrim(bezeichnung)))
  where archiviert_am is null and raumnummer is null and bezeichnung is not null;
create unique index raum_quelle_uk on raum (objekt_id, quell_schluessel)
  where quell_schluessel is not null and archiviert_am is null;
create index raum_liste_idx on raum (mandant_id, objekt_id, sortierung);
-- DIE Kalkulationsabfrage: Flaeche je Belagsart fuer ein Objekt.
create index raum_kalkulation_idx on raum (objekt_id, belagsart_id)
  include (flaeche_qm, fenster_flaeche_qm) where archiviert_am is null;
-- "Welche Raeume wuerde eine Aenderung dieses Leistungswerts neu bepreisen?"
create index raum_belagsart_idx on raum (belagsart_id);
create index raum_reinigungsklasse_idx on raum (mandant_id, reinigungsklasse_id);

-- ===========================================================================
-- Zeilenschutz (K-03), Spaltenschutz (K-05), Ausloeser.
-- ===========================================================================

alter table belagsart         enable row level security;
alter table belagsart         force  row level security;
alter table reinigungsklasse  enable row level security;
alter table reinigungsklasse  force  row level security;
alter table objekt            enable row level security;
alter table objekt            force  row level security;
alter table raum              enable row level security;
alter table raum              force  row level security;

/**
 * belagsart und reinigungsklasse sind INTERNE Kataloge.
 *
 * Gelesen werden sie mit `objekt.lesen` — ohne sie zeigt das Raumbuch
 * Zahlen ohne Bedeutung. Gepflegt werden sie mit `stammdaten.verwalten`:
 * wer einen Leistungswert aendert, bepreist jedes kuenftige Angebot neu.
 *
 * Die restriktive Decke haelt sie aus dem Kundenportal heraus. Der Katalog
 * ist die Kalkulationsgrundlage; welcher Belag in welcher Klasse liegt und
 * mit welchem Wert gerechnet wird, ist Verhandlungsstoff — im Kundenportal
 * ist er es gegen uns.
 */
create policy t_mandant on belagsart for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('objekt.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on belagsart for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.stammdaten.lesen')));

create policy p_intern_decke on belagsart as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy t_mandant on reinigungsklasse for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('objekt.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on reinigungsklasse for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.stammdaten.lesen')));

create policy p_intern_decke on reinigungsklasse as restrictive for all to cse_app
  using (app.portal() = 'intern');

-- objekt: der Standardsatz (K-03) plus die Kundensicht (K-18, Scope 4).
create policy t_mandant on objekt for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('objekt.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('objekt.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on objekt for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.objekt.lesen')));

/**
 * Der Kunde sieht SEINE Objekte — und `kunde_id` ist nullbar, weshalb ein
 * Objekt ohne Kundenbezug hier durch `= any(...)` von selbst herausfaellt.
 * Genau so soll es sein: ein Veranstaltungsort ohne Kundenstamm gehoert
 * niemandem, also sieht ihn im Kundenportal auch niemand.
 */
create policy t_kunde on objekt for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden()));

create policy p_kunde_decke on objekt as restrictive for all to cse_app
  using (app.portal() <> 'kunde' or kunde_id = any (app.aktuelle_kunden()));

/**
 * Die MITARBEITER-Sicht (Scope PER, 03-AUTH §8.5) fehlt hier mit Absicht:
 * ihr Praedikat laeuft ueber `einsatz`/`einsatz_zuordnung`, und diese
 * Tabellen entstehen erst in Phase 5. Bis dahin trifft eine Mitarbeiter-
 * Sitzung auf `objekt` NULL Zeilen — fehlgeschlossen, nicht offen (K-19).
 * Die Policy `t_person` kommt mit `einsatz`, in derselben Migration.
 */

-- raum: haengt am Objekt, und erbt dessen Sichtbarkeit ueber genau dieses
-- `exists` — nicht ueber eine zweite, spaeter abweichende Bedingung.
create policy t_mandant on raum for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('objekt.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('objekt.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on raum for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.objekt.lesen')));

create policy t_kunde on raum for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from objekt o
                      where o.id = raum.objekt_id
                        and o.kunde_id = any (app.aktuelle_kunden())));

create policy p_kunde_decke on raum as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or exists (select 1 from objekt o
                     where o.id = raum.objekt_id
                       and o.kunde_id = any (app.aktuelle_kunden())));

-- ---------------------------------------------------------------------------
-- K-05: Spalten, die die Zeile mitbringt, aber nicht jede Sitzung lesen darf.
-- ---------------------------------------------------------------------------

grant select, insert, update on belagsart, reinigungsklasse, objekt, raum to cse_app;

/**
 * `leistungswert_qm_pro_stunde` ist die Marge in einer Spalte.
 *
 * Aus ihr und der Flaeche entsteht der Preis; wer sie kennt, rechnet jedes
 * Angebot nach. Das SELECT-Recht wird deshalb entzogen — INSERT und UPDATE
 * bleiben, denn wer den Katalog pflegen darf, setzt sie, und die Policy
 * entscheidet, ob er das darf. Ein `WHERE leistungswert > 3` scheitert
 * ebenfalls: eine Bedingung ueber eine Spalte braucht deren SELECT-Recht.
 */
revoke select on belagsart from cse_app;
grant  select (id, mandant_id, code, bezeichnung, beschreibung, quelle,
               ist_platzhalter, gueltig_ab, gueltig_bis,
               erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on belagsart to cse_app;

/**
 * `bemerkung` und `zutritt_hinweis` sind INTERNE Notizen an einem Ort, den
 * der Kunde selbst im Portal sieht. In der einen steht, wo der Schluessel
 * liegt, in der anderen, was intern ueber diesen Auftrag gesagt wird.
 */
revoke select on objekt from cse_app;
grant  select (id, mandant_id, kunde_id, objektnummer, bezeichnung, gebaeudetyp,
               strasse, hausnummer, adresszusatz, plz, ort, land,
               geo_lat, geo_lon, ansprechpartner_id, etagen_anzahl,
               archiviert_am, erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on objekt to cse_app;

revoke select on raum from cse_app;
grant  select (id, mandant_id, objekt_id, raumnummer, bezeichnung, etage,
               nutzungsart, flaeche_qm, belagsart_id, reinigungsklasse_id,
               fenster_flaeche_qm, quell_schluessel, sortierung,
               archiviert_am, erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on raum to cse_app;

/**
 * Der K-05-Leser fuer den Leistungswert.
 *
 * Er gibt den KATALOG zurueck, nicht eine Zeile: das Raumbuch braucht alle
 * Werte eines Mandanten auf einmal, und ein Leser je Zeile waere N Aufrufe
 * fuer dieselbe Antwort. Er prueft Bereich UND Recht ausdruecklich — als
 * Definer erbt er beides nicht.
 *
 * Anders als `app.rechtsgrundlage_lesen` schreibt er NICHT ins Audit: ein
 * Leistungswert ist ein Geschaeftsgeheimnis, kein personenbezogenes Datum,
 * und ein Eintrag je Raumbuch-Ansicht ertraenkte genau das Protokoll, auf
 * das sich eine LEG-08-Auskunft stuetzt.
 */
create function app.leistungswerte_lesen(p_stichtag date default current_date)
returns table (belagsart_id uuid, code text, bezeichnung text,
               leistungswert_qm_pro_stunde numeric, ist_platzhalter boolean, quelle text) -- nicht-geld: m²/h
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Leistungswerte sind ausserhalb des internen Portals nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('objekt.lesen', app.aktiver_mandant()) then
    raise exception 'objekt.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select b.id, b.code, b.bezeichnung, b.leistungswert_qm_pro_stunde,
           b.ist_platzhalter, b.quelle
      from public.belagsart b
     where b.mandant_id = app.aktiver_mandant()
       and b.gueltig_ab <= p_stichtag
       and (b.gueltig_bis is null or b.gueltig_bis >= p_stichtag)
     order by b.code;
end $$;

grant execute on function app.leistungswerte_lesen(date) to cse_app;

/** Der K-05-Leser fuer die internen Notizen eines Objekts. */
create function app.objekt_notiz_lesen(p_objekt uuid)
returns table (bemerkung text, zutritt_hinweis text)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Interne Objektnotizen sind hier nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('objekt.lesen', app.aktiver_mandant()) then
    raise exception 'objekt.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select o.bemerkung, o.zutritt_hinweis
      from public.objekt o
     where o.id = p_objekt and o.mandant_id = app.aktiver_mandant();
end $$;

grant execute on function app.objekt_notiz_lesen(uuid) to cse_app;

/** Dieselbe Auskunft fuer das Raumbuch — ein Aufruf je Objekt, nicht je Raum. */
create function app.raum_notizen_lesen(p_objekt uuid)
returns table (raum_id uuid, bemerkung text)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Interne Raumnotizen sind hier nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('objekt.lesen', app.aktiver_mandant()) then
    raise exception 'objekt.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  return query
    select r.id, r.bemerkung
      from public.raum r
     where r.objekt_id = p_objekt
       and r.mandant_id = app.aktiver_mandant()
       and r.bemerkung is not null;
end $$;

grant execute on function app.raum_notizen_lesen(uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- Ausloeser: `geaendert_am`, Loeschsperren und das Audit auf `belagsart`
-- stehen im Register (`src/server/db/schema/rls.ts`) und werden von
-- `pnpm db:triggers` in den Block am Dateiende geschrieben — von Hand
-- geschrieben hiessen sie anders, und der Test, der Register und Datenbank
-- in BEIDE Richtungen vergleicht, faende die Abweichung erst spaeter.
-- ---------------------------------------------------------------------------

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0021)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- belagsart (archiv): OPS-03. Der Leistungswert ist die Zahl, aus der ein Angebotspreis entstanden ist. Faellt die Zeile weg, laesst sich ein bereits abgegebenes Angebot nicht mehr nachrechnen; abgeloest wird sie durch gueltig_bis, nicht durch DELETE.
create trigger trg_belagsart_kein_hard_delete
  before delete on belagsart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_belagsart_kein_truncate
  before truncate on belagsart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on belagsart from cse_app, cse_anon, cse_checkin, cse_job;

-- reinigungsklasse (archiv): OPS-02. Die Klasse steht im Leistungsverzeichnis eines laufenden Auftrags. Sie zu loeschen macht die vereinbarte Leistung unlesbar; das Ende einer Klasse ist archiviert_am.
create trigger trg_reinigungsklasse_kein_hard_delete
  before delete on reinigungsklasse
  for each row execute function kern.verhindere_loeschung();
create trigger trg_reinigungsklasse_kein_truncate
  before truncate on reinigungsklasse
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on reinigungsklasse from cse_app, cse_anon, cse_checkin, cse_job;

-- objekt (archiv): OPS-01. An einem Objekt haengen Auftraege, Einsaetze, Nachweise und Rechnungen mit zehnjaehriger Aufbewahrung. Ein beendetes Objekt wird archiviert, nie entfernt.
create trigger trg_objekt_kein_hard_delete
  before delete on objekt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_objekt_kein_truncate
  before truncate on objekt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on objekt from cse_app, cse_anon, cse_checkin, cse_job;

-- raum (archiv): OPS-02. Die Quadratmeter dieser Zeile sind die Grundlage einer Kalkulation, die in ein Angebot und von dort in eine Rechnung gewandert ist. Ein geloeschter Raum macht die Rechnung unpruefbar — ein entfallener Raum bekommt archiviert_am.
create trigger trg_raum_kein_hard_delete
  before delete on raum
  for each row execute function kern.verhindere_loeschung();
create trigger trg_raum_kein_truncate
  before truncate on raum
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on raum from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_belagsart_geaendert_am
  before update on belagsart
  for each row execute function kern.setze_geaendert_am();
create trigger trg_reinigungsklasse_geaendert_am
  before update on reinigungsklasse
  for each row execute function kern.setze_geaendert_am();
create trigger trg_objekt_geaendert_am
  before update on objekt
  for each row execute function kern.setze_geaendert_am();
create trigger trg_raum_geaendert_am
  before update on raum
  for each row execute function kern.setze_geaendert_am();

create trigger trg_belagsart_audit
  after insert or update or delete on belagsart
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
