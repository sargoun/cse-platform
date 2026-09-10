-- ===========================================================================
-- 0050 — auftrag_leistung: die Leistungszeile, an der Zeit haengt
--        (02-CRM-OPERATIONS.md §3.2; 05-FINANZEN.md §2.1; PR 36, Luecke aus
--         PR 27)
--
-- Vertrag: `docs/architecture/02-datenmodell/02-CRM-OPERATIONS.md` §3.2
-- („auftrag_leistung"). Wo dieser Text und eine Konvention (K-nn)
-- auseinandergehen, gilt die Konvention.
--
-- **Warum diese Tabelle in einem Zeit-PR entsteht.** 0025 legt `auftrag` an,
-- die Leistungszeilen darunter fehlten — und vier Migrationen tragen seither
-- Spalten, die auf sie zeigen, ohne Fremdschluessel: `einsatz` (0028),
-- `revier` und `turnus` (0029) und `zeiteintrag` (0034). Jede von ihnen hat
-- ihre Anweisung woertlich als Kommentar hinterlegt und den Schluessel der
-- Migration ueberlassen, die den Elternteil anlegt. TIM-12 („Zeit haengt am
-- Auftrag, keine manuelle Uebertragung") und FIN-07 („jede Rechnungszeile ist
-- auf ihren Ursprung zurueckfuehrbar") haengen genau an diesem Elternteil:
-- ohne ihn ist der Abrechnungsanker eine Behauptung, die niemand prueft. Ein
-- `zeiteintrag.auftrag_leistung_id`, der auf nichts zeigt, faellt nicht auf —
-- er erzeugt eine Abrechnungsabfrage, die still null Stunden liefert.
--
-- Zwei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **`gueltig_bis` ist EINSCHLIESSLICH** (02-CRM §0.5, review B18). Die
--     naheliegende Halboffenheit `daterange(gueltig_ab, gueltig_bis)` und die
--     uebliche Dienstabfrage `gueltig_ab <= :stichtag and (gueltig_bis is null
--     or gueltig_bis >= :stichtag)` widersprechen sich am Wechseltag: dort
--     liefert die Abfrage BEIDE Zeilen, die abgeloeste und die neue. Das ist
--     kein falsches Etikett, sondern ein falscher Preis, und zwar genau an dem
--     einen Tag, an dem es darauf ankommt.
--  2. **Kein hartes Loeschen.** Ein `zeiteintrag`, ein `aufmass` oder eine
--     `lv_position` kann bereits hierher zeigen (TIM-12, BAU-01/02).
--     Beendet wird eine Zeile durch `gueltig_bis`, nicht durch DELETE.
--
-- NICHT in dieser Migration: `vertrag_abrechnung` (die fuenf Abrechnungsarten,
-- O-04, Phase 6), `rechnungsposition` (Phase 6), `lv_position` und `aufmass`
-- (PR 43). Deren Fremdschluessel kommen mit ihren eigenen Tabellen.
-- ===========================================================================

create table auftrag_leistung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  auftrag_id    uuid not null,
  position_nr   integer not null,

  -- Woher die Zeile stammt (OPS-09) und was sie im Katalog war. Beides
  -- nullbar: eine nachtraeglich vereinbarte Leistung hat kein Angebot.
  angebotsposition_id uuid,
  leistungskatalog_position_id uuid,
  /**
   * Der Ort DIESER Zeile. Nullbar, weil `auftrag.objekt_id` es auch ist: ein
   * Rahmenvertrag ueber mehrere Liegenschaften traegt seine Standorte hier
   * und nicht im Kopf.
   */
  objekt_id     uuid,

  bezeichnung   text not null,
  beschreibung  text,

  -- Menge ist KEIN Geld (K-16): `numeric(12,3)`, nie Cent.
  menge         numeric(12,3),
  /**
   * Freier Text und kein Aufzaehlungstyp — dieselbe Entscheidung wie in
   * 02-CRM §3.2: ein VOB-Leistungsverzeichnis bringt Einheiten mit, die keine
   * Liste vorhersieht („psch", „Wo", „St/Mon"). Ein Enum zwaenge den Import,
   * still auf den naechsten bekannten Wert zu runden.
   */
  einheit       text,

  -- Ganze Cent (Invariante 1); darf fuer eine Nachlasszeile negativ sein.
  einzelpreis_cent bigint,
  -- Kaufmaennische Rundung in exakter numerischer Arithmetik — NIE in
  -- JavaScript, wo aus 0,1 × 3 nicht 0,3 wird. Wie `angebotsposition` (0024).
  gesamtpreis_cent bigint generated always as
    (round(coalesce(menge, 0) * coalesce(einzelpreis_cent, 0))::bigint) stored,

  /**
   * Der Steuersatz in Basispunkten und sein Kennzeichen — je Zeile, nie aus
   * einer Bruttosumme zurueckgerechnet (Invariante 1). Die Umsatzsteuer wird
   * JE STEUERSATZGRUPPE gebildet; deshalb traegt die Zeile den Satz und nicht
   * der Kopf.
   */
  steuersatz_bp integer not null,
  steuer_kennzeichen steuer_kennzeichen not null default 'regelsatz',
  steuerbefreiung_grund text,
  -- ACC-01 traegt hier nur die Spalte; die Kontenzuordnung ist offen.
  -- // TODO(client, O-05): SKR03 oder SKR04, Sachkontenlaenge,
  -- Steuerschluesseltabelle und Erloeskonto je Leistungsart.
  erloeskonto_schluessel text,

  /**
   * Die Frequenz als SATZ fuer den Menschen („2× woechentlich"). Der
   * maschinenlesbare Plan ist `turnus` (CLN-02), der auf diese Zeile zeigt —
   * die beiden duerfen auseinandergehen, und deshalb steht der Satz hier als
   * Text und nicht als zweite Regelquelle.
   */
  leistungsfrequenz_text text,

  gueltig_ab    date not null,
  -- EINSCHLIESSLICH (§0.5). Die einzige Lebendigkeitsspalte dieser Tabelle.
  gueltig_bis   date,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  /**
   * ZWEI Eltern-Eindeutigkeiten, und beide werden gebraucht.
   *
   * `(mandant_id, id)` ist der gewoehnliche K-16-Schluessel, den
   * `zeiteintrag`, `revier` und `turnus` verlangen. `(mandant_id, auftrag_id,
   * id)` ist der ENKEL-Schluessel, den `einsatz` verlangt (0028 §6): er
   * verhindert, dass eine Schicht auf die Leistungszeile eines ANDEREN
   * Auftrags gebucht wird — was ohne ihn eine Rechnung an den falschen Kunden
   * ergaebe, ohne dass irgendeine Bedingung dagegen spricht.
   */
  constraint auftrag_leistung_mandant_uk unique (mandant_id, id),
  constraint auftrag_leistung_auftrag_uk unique (mandant_id, auftrag_id, id),
  constraint auftrag_leistung_position_uk unique (auftrag_id, position_nr),

  constraint al_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  constraint al_angebotsposition_fk foreign key (mandant_id, angebotsposition_id)
    references angebotsposition (mandant_id, id),
  constraint al_katalog_fk foreign key (mandant_id, leistungskatalog_position_id)
    references leistungskatalog_position (mandant_id, id),
  constraint al_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),

  constraint al_gueltigkeit check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  constraint al_steuersatz_bereich check (steuersatz_bp between 0 and 10000),
  -- Dieselben zwei Bedingungen wie auf `angebotsposition` (0024): ein
  -- Kennzeichen ohne den passenden Satz ist eine Rechnung, die die
  -- Betriebspruefung aufmacht.
  constraint al_reverse_charge_ohne_steuer check (
    steuer_kennzeichen <> 'reverse_charge_13b' or steuersatz_bp = 0),
  constraint al_steuerfrei_mit_grund check (
    steuer_kennzeichen <> 'steuerfrei'
    or (steuersatz_bp = 0 and steuerbefreiung_grund is not null)),
  constraint al_position_nr_positiv check (position_nr >= 1)
);

create index al_liste_idx on auftrag_leistung (mandant_id, auftrag_id, position_nr);
-- „Was ist an diesem Standort geschuldet" — der Einstieg der Planung.
create index al_objekt_idx on auftrag_leistung (mandant_id, objekt_id)
  where objekt_id is not null;
-- FIN-07-Rueckverfolgung bis ins Angebot.
create index al_angebot_idx on auftrag_leistung (angebotsposition_id)
  where angebotsposition_id is not null;
-- Die lebenden Zeilen zum Stichtag. OHNE `now()` im Praedikat (§1.10) — das
-- waere eine nicht-immutable Funktion in einem Index und wird abgewiesen.
create index al_lebend_idx on auftrag_leistung (mandant_id, gueltig_bis)
  where gueltig_bis is null;

comment on table auftrag_leistung is
  'Eine vereinbarte Leistungszeile des Auftrags — der Anker, auf den Turnus, '
  'Einsatz, Zeiteintrag, Aufmass, LV-Position und Rechnungszeile zeigen '
  '(FIN-07, TIM-12).';
comment on column auftrag_leistung.gueltig_bis is
  'EINSCHLIESSLICH (02-CRM §0.5). Halboffen gelesen liefert die uebliche '
  'Stichtagsabfrage am Wechseltag zwei Preise fuer eine Leistung.';

-- ---------------------------------------------------------------------------
-- Zeilenschutz — Modul `auftrag`, plus die Kundensicht ueber den Elternteil.
-- ---------------------------------------------------------------------------

alter table auftrag_leistung enable row level security;
alter table auftrag_leistung force  row level security;

create policy t_mandant on auftrag_leistung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('auftrag.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('auftrag.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on auftrag_leistung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.auftrag.lesen')));

/**
 * Der Kunde sieht die Zeilen SEINER Auftraege — ueber den Elternteil.
 *
 * Diese Tabelle traegt kein `kunde_id`, und sie bekommt auch keines: der
 * Auftrag ist die kaufmaennische Beziehung, die Zeile ist ihr Inhalt. Die
 * Unterabfrage ist hier unbedenklich, obwohl eine Unterabfrage ueber eine
 * fremde Mandantentabelle sonst genau die Falle ist (04-PLANUNG-ZEIT §16
 * Nr. 18): `auftrag` traegt selbst eine `t_kunde`-Policy, die Zeile ist im
 * Kunden-Scope also SICHTBAR — die Unterabfrage liefert genau die eigenen
 * Auftraege und nicht null Zeilen.
 *
 * `app.aktuelle_kunden()` in der ARRAY-Form, nie der Skalar (K-20): der
 * Skalar loest ueber `app.aktiver_mandant()` auf, der im Kunden-Scope NULL
 * ist, und liefert dann eine von mehreren Bindungen willkuerlich — also
 * plausible Zeilen statt gar keiner.
 */
create policy t_kunde on auftrag_leistung for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from auftrag a
                      where a.mandant_id = auftrag_leistung.mandant_id
                        and a.id = auftrag_leistung.auftrag_id
                        and a.kunde_id = any (app.aktuelle_kunden())));

create policy p_kunde_decke on auftrag_leistung as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or exists (select 1 from auftrag a
                     where a.mandant_id = auftrag_leistung.mandant_id
                       and a.id = auftrag_leistung.auftrag_id
                       and a.kunde_id = any (app.aktuelle_kunden())));

/**
 * Die Mitarbeiterdecke: eine Leistungszeile traegt den PREIS, den der Kunde
 * zahlt. EMP-13 sagt, dass ein Mitarbeitender ihn nirgends sieht — hier ist
 * das eine Policy und keine Zusage der Oberflaeche.
 */
create policy p_ma_decke on auftrag_leistung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');

grant select, insert, update on auftrag_leistung to cse_app;

-- ---------------------------------------------------------------------------
-- Die aufgeschobenen Fremdschluessel — jetzt einloesbar (§14.4)
-- ---------------------------------------------------------------------------

/**
 * Vier Migrationen haben ihre Anweisung woertlich hinterlegt und auf diesen
 * Elternteil gewartet. Sie stehen hier in derselben Reihenfolge, jede mit der
 * Zeile, warum sie dort aufgeschoben wurde.
 *
 * Ein einspaltiger Fremdschluessel waere in jedem der vier Faelle der falsche
 * gewesen (K-16): er liesse eine Schicht der Reinigung auf die Leistungszeile
 * der Security zeigen, und RLS faende daran nichts auszusetzen, weil beide
 * Zeilen fuer sich stimmig sind. Deshalb ist jeder zusammengesetzt.
 */

-- 0028 §6 — der ENKEL-Schluessel: die Schicht haengt an der Leistungszeile
-- GENAU DIESES Auftrags. Ohne ihn liesse sich auf die Zeile eines fremden
-- Auftrags buchen, und die Rechnung ginge an den falschen Kunden (FIN-07).
alter table einsatz add constraint einsatz_leistung_fk
  foreign key (mandant_id, auftrag_id, auftrag_leistung_id)
  references auftrag_leistung (mandant_id, auftrag_id, id);

-- 0029 §7 — der Abrechnungsanker des Reinigungsreviers und seines Turnus
-- (CLN-02, FIN-07). Bis hierher war er „eine Behauptung, die niemand prueft".
alter table revier add constraint revier_auftrag_leistung_fk
  foreign key (mandant_id, auftrag_leistung_id)
  references auftrag_leistung (mandant_id, id);
alter table turnus add constraint turnus_auftrag_leistung_fk
  foreign key (mandant_id, auftrag_leistung_id)
  references auftrag_leistung (mandant_id, id);

-- 0034 §6 — der Schluessel, auf dem TIM-12 ruht: Zeit haengt an der
-- LEISTUNGSZEILE, nicht am Auftrag. Der Auftrag ist einen Join entfernt.
alter table zeiteintrag add constraint z_leistung_fk
  foreign key (mandant_id, auftrag_leistung_id)
  references auftrag_leistung (mandant_id, id);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0050)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- auftrag_leistung (archiv): FIN-07, TIM-12. Auf eine Leistungszeile zeigen bereits Zeiteintraege, Einsaetze, Reviere und Turnusse — spaeter Aufmasse, LV-Positionen und Rechnungszeilen. Sie zu loeschen risse genau die Kette, auf der die Rueckverfolgbarkeit jeder stundenbasierten Rechnungszeile beruht. Beendet wird sie durch `gueltig_bis`, das einschliesslich gilt.
create trigger trg_auftrag_leistung_kein_hard_delete
  before delete on auftrag_leistung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_auftrag_leistung_kein_truncate
  before truncate on auftrag_leistung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on auftrag_leistung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_auftrag_leistung_geaendert_am
  before update on auftrag_leistung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_auftrag_leistung_audit
  after insert or update or delete on auftrag_leistung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
