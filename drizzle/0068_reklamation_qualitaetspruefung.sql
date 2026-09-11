-- ===========================================================================
-- 0068 — Qualitaet: pruefverfahren, reklamation, qualitaetspruefung,
--        qualitaetspruefung_position
--        (OPS-11, CRM-03, CRM-06, NOT-01, REP-05, CLN-01, CLN-04, SEC-05,
--         BAU-01, PRO-05, TIM-10, SPEC §22)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §3.4, §8.1–§8.4,
-- §11, §12, §17. Wo dieser Text und eine Konvention (K-nn) auseinandergehen,
-- gilt die Konvention.
--
-- Diese vier Tabellen sind GEWERKEUEBERGREIFEND und heissen deshalb Modul
-- `qualitaet` und nicht `reinigung`: eine Beschwerde ueber einen Wachmann ist
-- dieselbe Zeile wie eine ueber eine Reinigungsrunde, und sie unter
-- `reinigung` abzulegen hiesse, die Reklamationen der SSE Security im Modul
-- einer anderen Gesellschaft zu fuehren (04-SEITENKARTE.md §5.6).
--
--   pruefverfahren             Der KATALOG der Pruefmethoden — eine Tabelle
--                              und kein Aufzaehlungstyp, weil die Antwort des
--                              Kunden keine Migration kosten darf (§3.4).
--   reklamation                Die Beanstandung, mit Verursacher, Frist und
--                              dokumentierter Abstellmassnahme.
--   qualitaetspruefung         Der Rundgang mit protokolliertem Ergebnis.
--   qualitaetspruefung_position Ein Befund darin — Raum, Kriterium, io/nio.
--
-- Vier Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **`bestanden` wird NICHT berechnet.** Die Schwelle ist eine
--     vertragliche Regel, keine technische. Solange O-29 offen ist, bleibt
--     `pruefverfahren.bestehensschwelle_prozent` NULL, `bestanden` bleibt NULL
--     und kein Bildschirm zeigt eine Bestanden-Pille. Einen plausiblen Wert
--     wie 90 % einzusetzen waere eine erfundene Geschaeftsregel (K-17).
--
--  2. **`reklamation` bekommt KEINE Geraetezeit** und darum auch keinen
--     Feldzeit-Ausloeser (§8.2, review B15): eine Beschwerde kommt per
--     Telefon, Mail oder Portal beim SERVER an — es gibt kein Erfassungsgeraet,
--     dessen Uhr abweichen koennte. Der Entwurf hatte hier denselben
--     Ausloeser stehen wie auf der Pruefung; sein Rumpf nennt
--     `NEW.geraete_zeit`, und das wirft `42703` bei JEDEM Insert. Eine
--     Reklamation waere nicht anlegbar gewesen.
--
--  3. **`faellig_am` wird von keinem Ausloeser und keinem Job gesetzt.** Die
--     SLA je Prioritaet ist offen (O-14); bis zur Antwort schreibt der
--     SLA-Dienst die Spalte, oder sie bleibt NULL. Eine Frist, die die
--     Datenbank aus der Prioritaet ableitet, waere ein Versprechen an den
--     Kunden, das niemand gegeben hat.
--
--  4. **`erfuellungsgrad_prozent` ist generiert, `punkte` nicht.** Das
--     Verhaeltnis ist deterministisch und kein Geld; die Punkte kommen aus dem
--     Bewertungsdienst. Eine generierte Punktesumme haette die Rechnung in die
--     Datenbank verlegt, wo sie nicht getestet wird (Invariante 6).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.4)
-- ---------------------------------------------------------------------------

-- Woher eine Beanstandung kommt. Die Quelle entscheidet, wem geantwortet wird.
create type reklamation_quelle as enum
  ('kunde','eigenkontrolle','qualitaetspruefung','mitarbeiter');

create type reklamation_status as enum
  ('offen','in_arbeit','behoben','abgelehnt','geschlossen');

/**
 * PROVISORISCH (§3.4). Die Leiter existiert, damit die Oberflaeche sortieren
 * kann; sie steuert nichts, solange die SLA unbekannt ist.
 * // TODO(client, O-14): Welche Reaktions- und Behebungsfrist gilt je
 * Prioritaet — Vertrags-SLA je Auftrag oder je Gesellschaft? Bis zur Antwort
 * setzt kein Job `faellig_am`.
 */
create type reklamation_prioritaet as enum ('niedrig','mittel','hoch');

-- Drei Ergebnisse, und `nicht_pruefbar` ist eines davon: ein verschlossener
-- Raum ist kein „in Ordnung".
create type pruefergebnis as enum ('io','nio','nicht_pruefbar');

-- ---------------------------------------------------------------------------
-- 2. pruefverfahren (§8.1)
-- ---------------------------------------------------------------------------

/**
 * Der Katalog der Pruefmethoden — eine TABELLE, kein Aufzaehlungstyp.
 *
 * Dasselbe Argument wie bei `gewerk` und `postenart`: die Liste darf keine
 * Migration erfordern. SPEC nennt kein Verfahren, der Kunde wird eines nennen,
 * und dann muss die Antwort eintragbar sein und nicht deploybar.
 *
 * // TODO(client, O-29): Welches Pruefverfahren wird verwendet — DIN 13549
 * Annahmestichprobe, eigene Checkliste oder Kundenprotokoll —, und welcher
 * Erfuellungsgrad gilt als bestanden?
 */
create table pruefverfahren (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  schluessel    text not null,
  bezeichnung   text not null,
  -- EMP-12: die Arbeiterbildschirme uebersetzen, die Rechtsbegriffe nicht.
  bezeichnung_i18n jsonb not null default '{}'::jsonb,
  beschreibung  text,

  -- Die Skala der Checkliste. KEINE Schwellenspalte daneben — die steht
  -- darunter und ist offen.
  max_punkte    numeric(8,2),
  /**
   * NULL heisst UNBEANTWORTET, nicht „0 %".
   * // TODO(client, O-29): Welcher Erfuellungsgrad gilt als bestanden, und ist
   * er vertraglich je Kunde vereinbart?
   *
   * Solange sie NULL ist, bleibt `qualitaetspruefung.bestanden` NULL, und
   * `QualitaetsBewertung` (der Dienst) gibt „unbestimmt" zurueck. Ein Default
   * waere die stillschweigende Antwort auf eine Vertragsfrage.
   */
  bestehensschwelle_prozent numeric(5,2),

  -- §1.16: die Zeile sagt selbst, dass sie ein Platzhalter ist, und die
  -- Oberflaeche zeigt daneben die Pille „Unbestaetigter Wert".
  ist_platzhalter boolean not null default true,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint pruefverfahren_mandant_uk unique (mandant_id, id),

  constraint pv_schluessel_gefuellt check (btrim(schluessel) <> ''),
  constraint pv_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint pv_max_punkte_positiv check (max_punkte is null or max_punkte > 0),
  constraint pv_schwelle_bereich check (
    bestehensschwelle_prozent is null
    or (bestehensschwelle_prozent >= 0 and bestehensschwelle_prozent <= 100)),
  constraint pv_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Partiell (§1.3): ein archiviertes Verfahren belegt seinen Schluessel nicht
-- auf Dauer.
create unique index pruefverfahren_schluessel_uk on pruefverfahren (mandant_id, schluessel)
  where archiviert_am is null;

create trigger trg_pruefverfahren_archivierung
  before insert or update on pruefverfahren
  for each row execute function kern.archivierung_stempeln();

comment on table pruefverfahren is
  'Katalog der Pruefmethoden (§8.1) — Tabelle statt Aufzaehlungstyp, damit die '
  'Antwort des Kunden keine Migration kostet. Liefert mit einer '
  'Platzhalterzeile aus (O-29).';

-- ---------------------------------------------------------------------------
-- 3. reklamation (§8.2)
-- ---------------------------------------------------------------------------

create table reklamation (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /**
   * Die Vorgangsnummer. `not null`, weil eine Beschwerde ohne Aktenzeichen im
   * Telefonat nicht auffindbar ist.
   *
   * KEINE Luecken-Zusage und kein Nummernkreis: `nummernkreis_typ` fuehrt
   * `reklamation` nicht, und §8.2 verlangt nur Eindeutigkeit. Vergeben wird
   * sie vom Dienst; der eindeutige Index unten ist die Schranke.
   */
  nummer        text not null,

  -- Der Bezug. Mindestens Objekt ODER Projekt (`rk_ein_anker`).
  objekt_id     uuid,
  projekt_id    uuid,
  revier_id     uuid,
  posten_id     uuid,
  veranstaltung_id uuid,
  auftrag_leistung_id uuid,
  kunde_id      uuid,

  /**
   * DER Nachweis, den die Beanstandung bestreitet (Abnahmekriterium 4).
   *
   * Ohne diese Spalte waere „der Kunde hat am 30.06. unterschrieben und
   * beschwert sich am 02.07. ueber denselben Zeitraum" ein Vorgang, den
   * niemand verknuepfen kann — und genau die Verknuepfung entscheidet, ob eine
   * Rechnung berechtigt ist.
   */
  leistungsnachweis_id uuid,
  qualitaetspruefung_position_id uuid,
  -- Bau: der Mangel aus einer foermlichen Abnahme (§7.3). Spalte ohne
  -- Schluessel — `abnahme_mangel` gibt es noch nicht.
  abnahme_mangel_id uuid,

  quelle        reklamation_quelle not null,
  prioritaet    reklamation_prioritaet not null default 'mittel',
  status        reklamation_status not null default 'offen',

  -- Serverzeit (§1.11) — siehe die Vorbemerkung Nr. 2 oben.
  eingang_am    timestamptz not null default now(),
  -- Wer sich beschwert hat, auf Kundenseite. Freitext: das ist der Name am
  -- Telefon.
  gemeldet_von_name text,

  beschreibung  text not null,
  ursache       text,
  -- Behoben ohne Massnahme ist nicht behoben, sondern vergessen.
  massnahme     text,

  verantwortlich_benutzer_id uuid references benutzer(id),
  /**
   * Geschrieben vom SLA-Dienst, nie in der Datenbank gerechnet, und NULL
   * solange O-14 offen ist (§3.4).
   */
  faellig_am    timestamptz,
  behoben_am    timestamptz,
  geschlossen_am timestamptz,

  /**
   * Die Schicht, die nacharbeitet (Abnahmekriterium 4).
   *
   * `einsatz`, nicht `einsatz_zuordnung`: verantwortlich ist die SCHICHT auf
   * dem Objekt, nicht die einzelne Person darin. Wer nacharbeitet, kann
   * wechseln; dass an diesem Tag auf diesem Objekt nachgearbeitet wurde,
   * bleibt.
   */
  nacharbeit_einsatz_id uuid,
  -- Der Wiederholungsfall: dieselbe Beanstandung zum zweiten Mal.
  wiederholung_von_id uuid,

  -- §1.14, Klasse `betrieb` (§11). Eine Beschwerde ist kein Finanzbeleg, aber
  -- Gewaehrleistungsbeweis.
  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint reklamation_mandant_uk unique (mandant_id, id),
  constraint reklamation_nummer_uk unique (mandant_id, nummer),

  constraint rk_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint rk_revier_fk foreign key (mandant_id, revier_id)
    references revier (mandant_id, id),
  constraint rk_auftrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint rk_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint rk_nachweis_fk foreign key (mandant_id, leistungsnachweis_id)
    references leistungsnachweis (mandant_id, id),
  constraint rk_nacharbeit_fk foreign key (mandant_id, nacharbeit_einsatz_id)
    references einsatz (mandant_id, id),
  constraint rk_wiederholung_fk foreign key (mandant_id, wiederholung_von_id)
    references reklamation (mandant_id, id),

  constraint rk_ein_anker check (num_nonnulls(objekt_id, projekt_id) >= 1),
  constraint rk_beschreibung_gefuellt check (btrim(beschreibung) <> ''),
  constraint rk_behoben_hat_massnahme check (status <> 'behoben' or massnahme is not null),
  constraint rk_behoben_hat_zeitpunkt check (status <> 'behoben' or behoben_am is not null),
  constraint rk_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Die Arbeitsliste und die Ueberfaelligkeitsansicht.
create index reklamation_offen_idx on reklamation (mandant_id, status, faellig_am)
  where status in ('offen','in_arbeit');
create index reklamation_objekt_idx on reklamation (mandant_id, objekt_id, eingang_am desc);
-- Kundenhistorie (CRM-06).
create index reklamation_kunde_idx on reklamation (mandant_id, kunde_id, eingang_am desc);
-- Der Wiederholungsfall — die Traversierung, fuer die es die Spalte gibt.
create index reklamation_wiederholung_idx on reklamation (wiederholung_von_id)
  where wiederholung_von_id is not null;
-- „Welche Beanstandungen bestreiten diesen Nachweis?" — die Frage, die vor
-- jeder Rechnungsfreigabe gestellt wird (FIN-18).
create index reklamation_nachweis_idx on reklamation (mandant_id, leistungsnachweis_id)
  where leistungsnachweis_id is not null;

comment on table reklamation is
  'Beanstandung (§8.2) mit Verursacher, Frist und Abstellmassnahme. '
  'Gewerkeuebergreifend im Modul qualitaet, nicht unter reinigung.';
comment on column reklamation.faellig_am is
  'Vom SLA-Dienst geschrieben, nie in der Datenbank gerechnet. NULL, solange '
  'O-14 offen ist — eine abgeleitete Frist waere ein Versprechen, das niemand '
  'gegeben hat.';

/**
 * Serverzeit fuer `eingang_am` (§1.11) — und AUSDRUECKLICH keine Feldzeit.
 *
 * Der Zeitpunkt, an dem eine Beschwerde eingeht, bestimmt jede Frist, die
 * danach laeuft. Ein Default `now()` griffe nur, wenn die Spalte weggelassen
 * wird; ein INSERT mit mitgeschickter Zeit schriebe einen beliebigen
 * Zeitpunkt — und der Absender bestimmte, wann seine eigene Frist beginnt.
 */
create function kern.reklamation_zeitstempel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.eingang_am := now();
    if new.behoben_am is not null then new.behoben_am := now(); end if;
    if new.geschlossen_am is not null then new.geschlossen_am := now(); end if;
    return new;
  end if;
  -- `eingang_am` ist ab dem Insert unveraenderlich: sie ist der Fristbeginn.
  if new.eingang_am is distinct from old.eingang_am then
    raise exception 'Der Eingangszeitpunkt einer Reklamation aendert sich nicht'
      using errcode = 'restrict_violation',
            hint = 'An ihm haengt jede Frist, die danach laeuft.';
  end if;
  if new.behoben_am is not null and old.behoben_am is null then
    new.behoben_am := now();
  end if;
  if new.geschlossen_am is not null and old.geschlossen_am is null then
    new.geschlossen_am := now();
  end if;
  return new;
end $$;

create trigger trg_reklamation_zeitstempel
  before insert or update on reklamation
  for each row execute function kern.reklamation_zeitstempel();

create trigger trg_reklamation_archivierung
  before insert or update on reklamation
  for each row execute function kern.archivierung_stempeln();

-- ---------------------------------------------------------------------------
-- 4. qualitaetspruefung (§8.3)
-- ---------------------------------------------------------------------------

create table qualitaetspruefung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  nummer        text not null,

  objekt_id     uuid,
  revier_id     uuid,
  projekt_id    uuid,
  posten_id     uuid,
  /**
   * Der Kunde als SPALTE, nicht als Unterabfrage ueber `objekt` (review B16).
   * Unter korrigierter RLS haette die Unterabfrage nichts geliefert — der
   * Kunde saehe im Portal keine einzige Pruefung, an der er selbst
   * teilgenommen hat.
   */
  kunde_id      uuid,

  pruefverfahren_id uuid not null,

  -- Feldzeit: eine Pruefung wird VOR ORT auf einem Geraet erfasst (§1.11).
  geprueft_am   timestamptz not null default now(),
  geraete_zeit  timestamptz,
  zeitabweichung_sek integer,
  nachgetragen  boolean not null default false,

  pruefer_anstellung_id uuid,
  -- Der Kundenvertreter auf dem gemeinsamen Rundgang. Freitext, weil er keine
  -- Beschaeftigung bei uns hat.
  pruefer_extern_name text,
  mit_kunde     boolean not null default false,

  -- Vom Bewertungsdienst geschrieben, nicht von der Datenbank gerechnet
  -- (Invariante 6).
  punkte        numeric(8,2),
  max_punkte    numeric(8,2),
  /**
   * Ein VERHAELTNIS, deterministisch und kein Geld — deshalb darf es generiert
   * sein. Die Punkte selbst kommen aus dem Dienst; wer auch sie generierte,
   * verlegte die Rechnung dorthin, wo kein Test sie erreicht.
   */
  erfuellungsgrad_prozent numeric(5,2)
    generated always as (round(punkte / nullif(max_punkte, 0) * 100, 2)) stored,
  /**
   * NICHT berechnet. Die Schwelle ist eine vertragliche Regel (§8.1), und
   * solange `pruefverfahren.bestehensschwelle_prozent` NULL ist, bleibt diese
   * Spalte NULL und keine Oberflaeche zeigt eine Bestanden-Pille.
   * // TODO(client, O-29): Welcher Erfuellungsgrad gilt als bestanden?
   */
  bestanden     boolean,

  bemerkung     text,
  -- Das Protokoll-PDF.
  dokument_id   uuid,

  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint qualitaetspruefung_mandant_uk unique (mandant_id, id),
  constraint qp_nummer_uk unique (mandant_id, nummer),

  constraint qp_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint qp_revier_fk foreign key (mandant_id, revier_id)
    references revier (mandant_id, id),
  constraint qp_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint qp_verfahren_fk foreign key (mandant_id, pruefverfahren_id)
    references pruefverfahren (mandant_id, id),
  constraint qp_pruefer_fk foreign key (mandant_id, pruefer_anstellung_id)
    references anstellung (mandant_id, id),
  constraint qp_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),

  constraint qp_ein_anker check (num_nonnulls(objekt_id, projekt_id) >= 1),
  -- Punkte ohne Skala sind eine Zahl ohne Aussage.
  constraint qp_punkte_brauchen_skala check (punkte is null or max_punkte is not null),
  constraint qp_punkte_nicht_negativ check (punkte is null or punkte >= 0),
  constraint qp_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index qp_objekt_idx on qualitaetspruefung (mandant_id, objekt_id, geprueft_am desc);
create index qp_revier_idx on qualitaetspruefung (mandant_id, revier_id, geprueft_am desc)
  where revier_id is not null;
-- Eskalation und Nachpruefung.
create index qp_durchgefallen_idx on qualitaetspruefung (mandant_id, geprueft_am desc)
  where bestanden is false;

/**
 * Die Feldzeit der Pruefung (§1.11, TIM-08). Eigene Funktion, weil
 * `kern.stempel_feldzeit()` auf die Spaltennamen des Zeiteintrags
 * geschrieben ist.
 */
create function kern.qualitaetspruefung_feldzeit() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.geprueft_am := now();
  end if;
  if new.geraete_zeit is not null then
    new.zeitabweichung_sek :=
      round(extract(epoch from (new.geraete_zeit - new.geprueft_am)))::integer;
  else
    new.zeitabweichung_sek := null;
  end if;
  return new;
end $$;

create trigger trg_qualitaetspruefung_feldzeit
  before insert or update on qualitaetspruefung
  for each row execute function kern.qualitaetspruefung_feldzeit();

create trigger trg_qualitaetspruefung_archivierung
  before insert or update on qualitaetspruefung
  for each row execute function kern.archivierung_stempeln();

comment on table qualitaetspruefung is
  'Der Qualitaetsrundgang (§8.3) mit protokolliertem Ergebnis. `bestanden` '
  'bleibt NULL, solange die Bestehensschwelle offen ist (O-29).';

-- ---------------------------------------------------------------------------
-- 5. qualitaetspruefung_position (§8.4)
-- ---------------------------------------------------------------------------

create table qualitaetspruefung_position (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  qualitaetspruefung_id uuid not null,
  -- Vom Kopf heruntergeschrieben; traegt die Kundendecke (§1.8).
  kunde_id      uuid,
  -- Ebenfalls vom Kopf, damit der `revier_raum`-Schluessel revierbezogen sein
  -- kann.
  revier_id     uuid,

  raum_id       uuid,
  revier_raum_id uuid,
  -- Bau: die Abnahmepruefung gegen eine LV-Position. Spalte ohne Schluessel —
  -- `lv_position` gibt es noch nicht (§2.2).
  lv_position_id uuid,

  reihenfolge   smallint not null default 0,
  kriterium     text not null,
  ergebnis      pruefergebnis not null,
  /**
   * Gebrochen und nicht `smallint` — der Kopf addiert diese Spalte auf, und
   * eine Ganzzahl in eine gebrochene Addition zu geben lud zu einem stillen
   * Typwechsel ein.
   */
  punkte        numeric(8,2),

  -- „Nicht in Ordnung" ohne Beschreibung ist kein Befund.
  mangel_beschreibung text,
  frist_am      date,
  -- Das Befundfoto (TIM-10, DOC-03) im privaten Bucket.
  medien_id     uuid,

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint qpp_mandant_uk unique (mandant_id, id),
  constraint qpp_reihenfolge_uk unique (qualitaetspruefung_id, reihenfolge)
    deferrable initially immediate,

  constraint qpp_kopf_fk foreign key (mandant_id, qualitaetspruefung_id)
    references qualitaetspruefung (mandant_id, id),
  constraint qpp_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint qpp_raum_fk foreign key (mandant_id, raum_id)
    references raum (mandant_id, id),
  -- Dreispaltig: der Raum der Position gehoert in DAS Revier des Kopfes.
  constraint qpp_revier_raum_fk foreign key (mandant_id, revier_id, revier_raum_id)
    references revier_raum (mandant_id, revier_id, id),
  constraint qpp_medien_fk foreign key (mandant_id, medien_id)
    references einsatz_medien (mandant_id, id),

  constraint qpp_kriterium_gefuellt check (btrim(kriterium) <> ''),
  constraint qpp_punkte_nicht_negativ check (punkte is null or punkte >= 0),
  constraint qpp_nio_beschrieben check (
    ergebnis <> 'nio' or mangel_beschreibung is not null),
  constraint qpp_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index qpp_kopf_idx on qualitaetspruefung_position (qualitaetspruefung_id, reihenfolge);
/**
 * Die Mangelliste nach Frist. `ergebnis` steht NICHT im Schluessel: eine
 * Spalte, die im Praedikat konstant ist, ist auf jedem Schreibvorgang totes
 * Gewicht.
 */
create index qpp_mangel_idx on qualitaetspruefung_position (mandant_id, frist_am)
  where ergebnis = 'nio';
-- Wiederholt auffaellige Raeume.
create index qpp_raum_idx on qualitaetspruefung_position (mandant_id, raum_id)
  where raum_id is not null;

/**
 * Kunde und Revier vom Kopf herunterschreiben (§1.8, §8.4).
 *
 * Was der Aufrufer mitschickt, wird verworfen — sonst waere die
 * Kundensichtbarkeit eine Eingabe.
 */
create function kern.qpp_kopf_denormalisieren() returns trigger
language plpgsql as $$
declare k record;
begin
  select q.kunde_id, q.revier_id into k
    from qualitaetspruefung q
   where q.id = new.qualitaetspruefung_id and q.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Zu dieser Position gibt es keine Pruefung in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;
  new.kunde_id  := k.kunde_id;
  new.revier_id := k.revier_id;
  return new;
end $$;

create trigger trg_qpp_denormalisieren
  before insert or update on qualitaetspruefung_position
  for each row execute function kern.qpp_kopf_denormalisieren();

comment on table qualitaetspruefung_position is
  'Ein Befund innerhalb einer Pruefung (§8.4): Raum, Kriterium, io/nio/nicht '
  'pruefbar — mit Mangelbeschreibung und Frist, wo nio.';

-- ---------------------------------------------------------------------------
-- 6. Zusammengesetzte Fremdschluessel dieser Migration (§12)
-- ---------------------------------------------------------------------------

/**
 *   reklamation (mandant_id, objekt_id | revier_id | auftrag_leistung_id
 *                | kunde_id | leistungsnachweis_id | nacharbeit_einsatz_id
 *                | wiederholung_von_id)                    → je Elternteil
 *   qualitaetspruefung (mandant_id, objekt_id | revier_id | kunde_id
 *                | pruefverfahren_id | pruefer_anstellung_id | dokument_id)
 *   qualitaetspruefung_position (mandant_id, qualitaetspruefung_id | kunde_id
 *                | raum_id | medien_id)
 *   qualitaetspruefung_position (mandant_id, revier_id, revier_raum_id)
 *                                                          → revier_raum
 *
 * OFFEN, weil die Gegenstelle fehlt — WOERTLICH NACHZUTRAGEN, wo sie entsteht:
 *
 *   -- mit `projekt` (Bau-Domaene, §7.1):
 *   alter table reklamation add constraint rk_projekt_fk
 *     foreign key (mandant_id, projekt_id) references projekt (mandant_id, id);
 *   alter table qualitaetspruefung add constraint qp_projekt_fk
 *     foreign key (mandant_id, projekt_id) references projekt (mandant_id, id);
 *   -- mit `posten` und `veranstaltung` (PR 41, §6.3/§6.5):
 *   alter table reklamation add constraint rk_posten_fk
 *     foreign key (mandant_id, posten_id) references posten (mandant_id, id);
 *   alter table reklamation add constraint rk_veranstaltung_fk
 *     foreign key (mandant_id, veranstaltung_id)
 *     references veranstaltung (mandant_id, id);
 *   alter table qualitaetspruefung add constraint qp_posten_fk
 *     foreign key (mandant_id, posten_id) references posten (mandant_id, id);
 *   -- mit `abnahme_mangel` (Bau-Domaene, §7.3):
 *   alter table reklamation add constraint rk_abnahme_mangel_fk
 *     foreign key (mandant_id, abnahme_mangel_id)
 *     references abnahme_mangel (mandant_id, id);
 *   -- mit `lv_position` (Bau-Domaene, §7.5):
 *   alter table qualitaetspruefung_position add constraint qpp_lv_fk
 *     foreign key (mandant_id, lv_position_id)
 *     references lv_position (mandant_id, id);
 *
 * `reklamation.qualitaetspruefung_position_id` steht ohne Schluessel da,
 * obwohl beide Tabellen in DIESER Migration entstehen — die Reihenfolge ist
 * der Grund: `reklamation` steht vor `qualitaetspruefung_position`, weil
 * dessen Kopf wiederum auf `revier_raum` zeigt. Der Schluessel wird darum
 * unten nachgetragen, sobald beide da sind.
 */
alter table reklamation add constraint rk_qpp_fk
  foreign key (mandant_id, qualitaetspruefung_position_id)
  references qualitaetspruefung_position (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 7. Zeilenschutz (§1.6, §1.6a, §1.8)
-- ---------------------------------------------------------------------------

alter table pruefverfahren enable row level security;
alter table pruefverfahren force  row level security;

create policy t_mandant on pruefverfahren for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('qualitaet.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('qualitaet.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on pruefverfahren for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.qualitaet.lesen')));

create policy p_intern_decke on pruefverfahren as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on pruefverfahren to cse_app;

alter table reklamation enable row level security;
alter table reklamation force  row level security;

create policy t_mandant on reklamation for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('qualitaet.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('qualitaet.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on reklamation for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.qualitaet.lesen')));

/**
 * §1.6a: der Kundenscope. `/portal/kunde/reklamationen` ist LESEND — das
 * Melden durch den Kunden selbst haengt an O-74 (04-SEITENKARTE.md §8), und
 * bis dahin gibt es hier keine Schreibpolicy fuer den Kundenscope.
 */
create policy t_kunde on reklamation for select to cse_app
  using (app.scope() = 'kunde'
         and kunde_id is not null
         and kunde_id = any (app.aktuelle_kunden()));

create policy p_portal_decke on reklamation as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id is not null
             and kunde_id = any (app.aktuelle_kunden())));

grant select, insert, update on reklamation to cse_app;
grant select on reklamation to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on reklamation to cse_job;
create policy t_job on reklamation for select to cse_job using (true);
create policy t_job_frist on reklamation for update to cse_job
  using (true) with check (true);

alter table qualitaetspruefung enable row level security;
alter table qualitaetspruefung force  row level security;

create policy t_mandant on qualitaetspruefung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('qualitaet.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('qualitaet.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on qualitaetspruefung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.qualitaet.lesen')));

/**
 * Der Kunde sieht die Pruefungen, an denen er TEILGENOMMEN hat (`mit_kunde`),
 * nicht unsere Eigenkontrolle. Der Unterschied ist der zwischen einem
 * gemeinsamen Protokoll und unserem internen Befund.
 */
create policy t_kunde on qualitaetspruefung for select to cse_app
  using (app.scope() = 'kunde'
         and kunde_id is not null
         and kunde_id = any (app.aktuelle_kunden())
         and mit_kunde);

create policy p_portal_decke on qualitaetspruefung as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id is not null
             and kunde_id = any (app.aktuelle_kunden())
             and mit_kunde)
         -- Die eigene Pruefung, im Mitarbeiterportal (§8.3, p_ma_ceiling).
         or (app.portal() = 'mitarbeiter'
             and pruefer_anstellung_id in (select a.id from anstellung a
                                            where a.person_id = app.aktuelle_person())));

grant select, insert, update on qualitaetspruefung to cse_app;
grant select on qualitaetspruefung to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on qualitaetspruefung to cse_job;
create policy t_job on qualitaetspruefung for select to cse_job using (true);
create policy t_job_frist on qualitaetspruefung for update to cse_job
  using (true) with check (true);
grant select on qualitaetspruefung to cse_definer;
create policy d_medien_bezug on qualitaetspruefung for select to cse_definer using (true);

alter table qualitaetspruefung_position enable row level security;
alter table qualitaetspruefung_position force  row level security;

create policy t_mandant on qualitaetspruefung_position for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('qualitaet.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('qualitaet.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on qualitaetspruefung_position for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.qualitaet.lesen')));

create policy t_kunde on qualitaetspruefung_position for select to cse_app
  using (app.scope() = 'kunde'
         and kunde_id is not null
         and kunde_id = any (app.aktuelle_kunden()));

create policy p_portal_decke on qualitaetspruefung_position as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and kunde_id is not null
             and kunde_id = any (app.aktuelle_kunden())));

grant select, insert, update on qualitaetspruefung_position to cse_app;

-- ---------------------------------------------------------------------------
-- 8. Das Medienregister (0041 §6)
-- ---------------------------------------------------------------------------

/**
 * Die zwei verbleibenden Registerzeilen aus 0041 §6, die zu PR 40 gehoeren.
 * `leistungsnachweis` steht bereits in 0066.
 *
 * `modul` bestaetigt wie dort am Elternteil: die Beanstandung und die Pruefung
 * haengen beide am Modul `qualitaet` (04-SEITENKARTE.md §5.6), nicht an
 * `reinigung` — sie sind gewerkeuebergreifend.
 */
insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad) values
  ('reklamation','qualitaet','kunde_id'),
  ('qualitaetspruefung','qualitaet','kunde_id');

-- ---------------------------------------------------------------------------
-- 9. Die Platzhalterzeile des Katalogs (§8.1, §15)
-- ---------------------------------------------------------------------------

/**
 * Ein Verfahren `unbestimmt` je Gesellschaft, `ist_platzhalter = true`.
 *
 * Ohne diese Zeile liesse sich keine Pruefung anlegen — `pruefverfahren_id`
 * ist `not null`. Mit ihr laeuft die Oberflaeche, zeigt daneben die Pille
 * „Unbestaetigter Wert" und faellt niemandem als richtiger Wert zur Last
 * (§1.16, K-17).
 *
 * `erstellt_von_art = 'system'`, weil keine Person sie eingetragen hat.
 */
insert into pruefverfahren (mandant_id, schluessel, bezeichnung, beschreibung,
                            ist_platzhalter, erstellt_von_art)
select m.id, 'unbestimmt', 'Unbestimmtes Prüfverfahren',
       'Platzhalter, bis O-29 beantwortet ist: Welches Prüfverfahren wird '
       || 'verwendet, und welcher Erfüllungsgrad gilt als bestanden?',
       true, 'system'
  from mandant m;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0068)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- pruefverfahren (archiv): OPS-11. Das Verfahren ist die Messvorschrift, nach der eine vergangene Pruefung bewertet wurde — samt der Bestehensschwelle, die damals galt. Geloescht liesse sich ein Protokoll nicht mehr lesen: die Punktzahl bliebe stehen und niemand wuesste, wogegen sie gemessen wurde. Abgeloest wird es durch archiviert_am.
create trigger trg_pruefverfahren_kein_hard_delete
  before delete on pruefverfahren
  for each row execute function kern.verhindere_loeschung();
create trigger trg_pruefverfahren_kein_truncate
  before truncate on pruefverfahren
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on pruefverfahren from cse_app, cse_anon, cse_checkin, cse_job;

-- reklamation (archiv): OPS-11, CRM-06, REP-05. Die Beanstandung ist Gewaehrleistungsbeweis: sie zeigt, was wann geruegt und wie abgestellt wurde, und der Wiederholungsfall (wiederholung_von_id) haengt an ihr. Geloescht ist die dritte Beschwerde ueber denselben Mangel die erste; eine erledigte bekommt geschlossen_am, eine gegenstandslose archiviert_am.
create trigger trg_reklamation_kein_hard_delete
  before delete on reklamation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_reklamation_kein_truncate
  before truncate on reklamation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on reklamation from cse_app, cse_anon, cse_checkin, cse_job;

-- qualitaetspruefung (archiv): OPS-11, PRO-05, REP-05. Das Pruefprotokoll ist die Grundlage des Kundengespraechs und der Nachschulung — und im Streit um eine Vertragsstrafe der Beleg, dass kontrolliert wurde. Geloescht bliebe nur die Behauptung; eine gegenstandslose Pruefung bekommt archiviert_am.
create trigger trg_qualitaetspruefung_kein_hard_delete
  before delete on qualitaetspruefung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_qualitaetspruefung_kein_truncate
  before truncate on qualitaetspruefung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on qualitaetspruefung from cse_app, cse_anon, cse_checkin, cse_job;

-- qualitaetspruefung_position (append): OPS-11, TIM-10. Der einzelne Befund samt Foto und Frist. Er zu loeschen liesse die Kopfsumme stehen und ihre Herleitung verschwinden — und der Mangel, aus dem eine Reklamation entstanden ist, zeigte auf nichts mehr. Eine eigene Lebendigkeitsspalte hat sie nicht: sie lebt mit ihrem Kopf.
create trigger trg_qualitaetspruefung_position_kein_hard_delete
  before delete on qualitaetspruefung_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_qualitaetspruefung_position_kein_truncate
  before truncate on qualitaetspruefung_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on qualitaetspruefung_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_pruefverfahren_geaendert_am
  before update on pruefverfahren
  for each row execute function kern.setze_geaendert_am();
create trigger trg_reklamation_geaendert_am
  before update on reklamation
  for each row execute function kern.setze_geaendert_am();
create trigger trg_qualitaetspruefung_geaendert_am
  before update on qualitaetspruefung
  for each row execute function kern.setze_geaendert_am();
create trigger trg_qualitaetspruefung_position_geaendert_am
  before update on qualitaetspruefung_position
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
