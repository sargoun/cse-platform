-- ===========================================================================
-- 0082 — Das Bautagebuch: gewerk, bautagebuch, bautagebuch_mannstunden,
--        bautagebuch_position (BAU-07, REP-05, TIM-12, LEG-01)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §7.12 – §7.15,
-- §1.2, §1.3, §1.4, §1.8, §3.3. Wo dieser Text und eine Konvention (K-nn)
-- auseinandergehen, gilt die Konvention.
--
-- Das Bautagebuch ist die laufende Beweisfuehrung einer Baustelle: wer wie
-- lange mit wie vielen Leuten in welchem Gewerk gearbeitet hat, welches Geraet
-- stand, was geliefert wurde und was vorgefallen ist. Im Bauprozess wird
-- daraus die Bauzeit, die Behinderung und der Mehrverguetungsanspruch
-- abgeleitet — und es ist nur so viel wert, wie sich zeigen laesst, dass
-- niemand eine Seite nachtraeglich geglaettet hat. Deshalb drei Dinge, und
-- keines davon ist Zierrat:
--
--  1. **Die Kinder sind ANFUEGEND** — `bautagebuch_mannstunden` und
--     `bautagebuch_position` kennen kein inhaltliches UPDATE, auch nicht im
--     Entwurf. Eine falsch eingetragene Mannstundenzeile wird STORNIERT und
--     durch eine neue ersetzt, die sie nennt (`ersetzt_durch_id`). Genau das
--     Muster von `wachbuch_eintrag` (0070): die falsche Zeile bleibt lesbar
--     stehen, denn dass sie erst falsch dastand, gehoert zur Wahrheit des
--     Tages. §1.3 gibt `bautagebuch*` — mit Stern, also samt Kindern — die
--     vier Stornospalten; sie ergeben nur unter dieser Regel einen Sinn.
--  2. **Der Kopf friert mit `abgeschlossen_am` ein.** Bis dahin ist er ein
--     Entwurf, den die Bauleitung ueber den Tag fuellt (§7.12: „immutable
--     after the day is closed"); danach bewegen sich ausser der
--     Gegenzeichnung, dem Storno und den Aufbewahrungsspalten keine Werte
--     mehr — und auch keine Kindzeile kommt hinzu.
--  3. **Kein hartes Loeschen, nirgends** (Invariante 8, LEG-01). Der
--     Ausloeser steht unabhaengig von RLS, weil „es gibt keine DELETE-Policy"
--     keine Loeschsperre ist: ein DELETE ohne passende Policy loescht null
--     Zeilen und meldet Erfolg.
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  a. **`bautagebuch_tag_uk` ist PARTIELL** (`where storniert_am is null`).
--     §7.12 nennt `unique (projekt_id, datum)` unbedingt; §1.3 verlangt fuer
--     jede stornierbare Zeile die partielle Form, und §1.3 gewinnt — sonst
--     widerspricht das Dokument sich selbst: ein stornierter Tag reservierte
--     sein Datum fuer immer, und die Korrektur, die dieselbe Migration
--     vorschreibt (Storno + Ersatztag), waere nicht eintragbar. Der
--     Widerspruch ist in `docs/DECISIONS.md` vermerkt.
--  b. **`behinderung_id` traegt KEINEN Fremdschluessel.** `behinderung`
--     entsteht mit PR 44, der parallel laeuft. Dieselbe Lage wie
--     `wachbuch_eintrag.schluessel_id` in 0070: die Spalte steht, der
--     Schluessel kommt mit seiner Tabelle. PR 44 haengt ihn nach —
--     `(mandant_id, projekt_id, behinderung_id) → behinderung
--     (mandant_id, projekt_id, id)` (§1.4) —, und der Grosselternschluessel
--     findet hier bereits sein Ziel (`bautagebuch_projekt_uk`).
--  c. **Die Wetterspalten stehen NICHT hier, sondern in 0083.** Sie zeigen
--     mit einem Fremdschluessel auf `wetter_beobachtung`, und ein
--     Fremdschluessel kann seinem Ziel nicht vorausgehen. Die Migrationen
--     laufen in Dateinamenreihenfolge; 0083 legt die beiden Wettertabellen an
--     und haengt die Spalten hier an. Dass ein Tageseintrag ohne Wetter
--     existieren kann, ist dabei keine Luecke, sondern die Zusage aus BAU-08:
--     ist das Wetter nicht zu bekommen, wird der Tag trotzdem gespeichert.
--
-- Die Mannstunden werden gegen `zeiteintrag` desselben Tages und derselben
-- Baustelle abgeglichen — als BERICHT (`server/services/bau/bautagebuch.ts`),
-- nie als Bedingung. §7.13 ist darin ausdruecklich, und der Grund steht in
-- der Sache: das Tagebuch zaehlt auch Nachunternehmer, und die schreiben
-- keinen `zeiteintrag`. Eine Bedingung daraus zu machen hiesse, die Zeile
-- eines Nachunternehmers unspeicherbar zu machen.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.3)
-- ---------------------------------------------------------------------------

/**
 * Drei Zustaende, und der dritte ist kein Schmuck: `gegengezeichnet` heisst,
 * die BAULEITUNG DES AUFTRAGGEBERS hat den Tag anerkannt. Das ist im
 * Werklohnprozess etwas anderes als ein vom Auftragnehmer abgeschlossener Tag,
 * und beide in einem Wert zu fuehren waere dieselbe Falschbeurkundung, die
 * `aufmass_status` bei der einseitigen Feststellung vermeidet (0072, B10).
 */
create type bautagebuch_status as enum ('entwurf','abgeschlossen','gegengezeichnet');

/** BAU-07 benennt genau diese drei: Geraet, Lieferung, Vorkommnis. */
create type bautagebuch_position_art as enum ('geraet','lieferung','vorkommnis');

/**
 * Eigene Kraft oder Nachunternehmer — die Unterscheidung traegt den Abgleich.
 * Nur `eigen` erzeugt einen `zeiteintrag`; wer beide Herkuenfte in eine Summe
 * legt, meldet jeden Tag mit Nachunternehmern als Abweichung und bringt damit
 * genau die Meldung zum Verstummen, um die es geht.
 */
create type mannstunden_herkunft as enum ('eigen','nachunternehmer');

-- ---------------------------------------------------------------------------
-- 2. gewerk — der Gewerkekatalog des Mandanten (§7.15)
-- ---------------------------------------------------------------------------

/**
 * Bewusst KEINE Aufzaehlung, sondern eine Tabelle (§7.15): die Gewerkeliste
 * wechselt mit dem Projektportfolio, und eine Migration je neuem Gewerk ist
 * die Art von Reibung, nach der jemand anfaengt, „Sonstiges" zu benutzen.
 *
 * Der Katalog wird LEER ausgeliefert und die Oberflaeche sagt „keine Gewerke
 * hinterlegt". Ihn mit Rohbau/Ausbau/Elektro zu fuellen waere geraten:
 * // TODO(client, O-159): Welche Gewerke werden im Bautagebuch gefuehrt, und
 * richtet sich die Liste nach STLB-Bau-Leistungsbereichen?
 */
create table gewerk (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  code          text not null,
  bezeichnung   text not null,
  /** de/en/ar/tr (EMP-12) — dieselbe Form wie in den anderen Katalogen. */
  bezeichnung_i18n jsonb not null default '{}'::jsonb,
  /** STLB-Bau-Leistungsbereich, wo einer benutzt wird. */
  leistungsbereich text,
  sortierung    smallint not null default 0,
  /** K-17, §1.16: bis O-159 beantwortet ist, ist jede Zeile unbestaetigt. */
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
  constraint gewerk_mandant_uk unique (mandant_id, id),
  constraint gewerk_code_nicht_leer check (btrim(code) <> ''),
  constraint gewerk_bezeichnung_nicht_leer check (btrim(bezeichnung) <> ''),
  constraint gewerk_archiv_paarweise check ((archiviert_am is null) = (archiviert_von is null)),
  constraint gewerk_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * PARTIELL (§1.3): ein archiviertes Gewerk darf seinen Code nicht auf Dauer
 * reservieren. Wird „ELT" nach einer Umbenennung wieder gebraucht, muss es
 * eintragbar sein.
 */
create unique index gewerk_code_uk on gewerk (mandant_id, code)
  where archiviert_am is null;
create index gewerk_liste_idx on gewerk (mandant_id, sortierung)
  where archiviert_am is null;

comment on table gewerk is
  'BAU-07, §7.15: der Gewerkekatalog des Mandanten — der Bezug der Mannstunden '
  'und der Tagebuchzeilen. Wird leer ausgeliefert (O-159).';

-- ---------------------------------------------------------------------------
-- 3. bautagebuch — der Tageskopf (§7.12)
-- ---------------------------------------------------------------------------

create table bautagebuch (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  projekt_id    uuid not null,

  /**
   * Der BERLINER Kalendertag (K-11), nie ein Zeitpunkt und nie ein UTC-Tag.
   * Ein Bautag ist eine Beschriftung: „der 14. September" bleibt der
   * 14. September, auch wenn die Nachtschicht bis 06:00 des Folgetags lief.
   * // TODO(client, O-157): Wird ein Bautagebuch je Baustelle oder je
   * Bauabschnitt gefuehrt? Bei Bauabschnitten braucht der Schluessel eine
   * dritte Spalte.
   */
  datum         date not null,

  /** UTC-Zeitpunkte, angezeigt in Europe/Berlin (Invariante 2). */
  arbeitsbeginn timestamptz,
  arbeitsende   timestamptz,

  status        bautagebuch_status not null default 'entwurf',

  besondere_vorkommnisse text,
  bemerkungen   text,

  /**
   * Die Behinderung, auf die sich der Tag beruft (BAU-06). SPALTE OHNE
   * FREMDSCHLUESSEL — `behinderung` entsteht mit PR 44 (Kopfkommentar b).
   */
  behinderung_id uuid,

  /** Bauleiter des Auftraggebers — mit Serverzeit gestempelt (§1.11). */
  gegengezeichnet_von_name text,
  gegengezeichnet_am timestamptz,

  /** Der Riegel. Ab hier ist der Tag ein Dokument und kein Formular mehr. */
  abgeschlossen_am timestamptz,

  -- §1.14. `loeschsperre` steht auf `true`: nichts ist versehentlich loeschbar,
  -- und `aufbewahrung_bis` schreibt der Aufbewahrungslauf aus seiner Klasse,
  -- nie ein Vorgabewert.
  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  /** §1.3 — die Korrekturspur. Ein Storno wird nicht zurueckgenommen. */
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

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
  constraint bautagebuch_mandant_uk unique (mandant_id, id),
  /**
   * Ziel des Grosselternschluessels der Kinder UND der Behinderung aus PR 44
   * (§1.4): eine Kindzeile darf nicht zu einem Tagebuch eines anderen
   * Projekts gehoeren, auch nicht innerhalb desselben Mandanten.
   */
  constraint bautagebuch_projekt_uk unique (mandant_id, projekt_id, id),

  constraint bautagebuch_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint bautagebuch_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references bautagebuch (mandant_id, id),

  constraint bautagebuch_arbeitszeit check (
    arbeitsende is null or arbeitsbeginn is null or arbeitsende > arbeitsbeginn),
  /** Ein abgeschlossener Tag ohne Abschlusszeitpunkt waere ein Dokument ohne Datum. */
  constraint bautagebuch_abschluss_gestempelt check (
    status = 'entwurf' or abgeschlossen_am is not null),
  /** Gegengezeichnet heisst: es gibt einen Namen und einen Zeitpunkt dazu. */
  constraint bautagebuch_gegenzeichnung_paarweise check (
    (gegengezeichnet_am is null) = (gegengezeichnet_von_name is null)),
  constraint bautagebuch_gegenzeichnung_vollstaendig check (
    status <> 'gegengezeichnet' or gegengezeichnet_am is not null),
  constraint bautagebuch_storno_begruendet check (
    (storniert_am is null and storno_grund is null and storniert_von is null)
    or (storniert_am is not null and storniert_von is not null
        and btrim(coalesce(storno_grund,'')) <> '')),
  constraint bautagebuch_ersatz_nicht_selbst check (ersetzt_durch_id is distinct from id),
  constraint bautagebuch_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/** Ein LEBENDER Tag je Projekt und Kalendertag — siehe Kopfkommentar a. */
create unique index bautagebuch_tag_uk on bautagebuch (projekt_id, datum)
  where storniert_am is null;

create index bautagebuch_projekt_idx on bautagebuch (mandant_id, projekt_id, datum desc);
/** Die Wache „Tagebuch nicht abgeschlossen" (REP-05). */
create index bautagebuch_offen_idx on bautagebuch (mandant_id, datum)
  where status = 'entwurf';

comment on table bautagebuch is
  'BAU-07, §7.12: ein Tag einer Baustelle — Wetter, Mannstunden je Gewerk, '
  'Geraete, Lieferungen, Vorkommnisse und Fotos. Mit abgeschlossen_am '
  'unveraenderlich; korrigiert wird durch Storno und Ersatztag.';
comment on column bautagebuch.datum is
  'Berliner Kalendertag (K-11) — eine Beschriftung, kein Zeitpunkt. Die '
  'Zeitpunkte daneben sind timestamptz in UTC.';
comment on column bautagebuch.behinderung_id is
  'BAU-06. Spalte ohne Fremdschluessel: behinderung entsteht mit PR 44 und '
  'haengt ihn nach — (mandant_id, projekt_id, behinderung_id).';

-- ---------------------------------------------------------------------------
-- 4. bautagebuch_mannstunden — die Stunden des Tages je Gewerk (§7.13)
-- ---------------------------------------------------------------------------

create table bautagebuch_mannstunden (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  bautagebuch_id uuid not null,
  /**
   * Vom Kopf ABGELEITET, nicht uebernommen (`kern.bautagebuch_kind_erben`).
   * §1.8 verbietet einer Policy, den Kopf per Unterabfrage zu lesen — die
   * Mitarbeiterdecke und `t_person` haengen beide an genau dieser Spalte.
   */
  projekt_id    uuid not null,

  gewerk_id     uuid not null,
  herkunft      mannstunden_herkunft not null,
  /** CRM-Firma, nicht mandantengebunden (§7.13). */
  nachunternehmer_firma_id uuid references firma(id),
  nachunternehmer_name text,

  anzahl_personen smallint not null,
  /**
   * Eine GEMESSENE Dauer, also `integer` Minuten mit der Einheit im Namen
   * (K-16, K-16(c)). Die Schranke 0…1440 ist eine Plausibilitaetsgrenze der
   * Eingabe — ein Kalendertag hat 1440 Minuten — und AUSDRUECKLICH keine
   * ArbZG-Regel: die 8/10-Stunden-Grenze gilt je PERSON ueber alle
   * Gesellschaften und wird von `app.arbzg_belastung` geprueft, nie von einer
   * Spaltenbedingung auf einer Kolonnenzahl, die legitim zehn Leute zaehlt.
   */
  dauer_minuten integer not null,
  /**
   * Personenstunden als MENGE (§1.1) — weder Dauer noch Geld. Erzeugt, damit
   * sie von ihren Eingaben nicht abweichen kann.
   */
  mannstunden   numeric(10,2)
    generated always as (anzahl_personen::numeric * dauer_minuten / 60.0) stored,

  taetigkeit    text,
  bereich       text,

  /** §1.3 — anfuegend heisst: korrigiert wird durch Storno und neue Zeile. */
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  -- Auditblock OHNE `geaendert_*` (§1.2): die Tabelle ist anfuegend.
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint btb_mannstunden_mandant_uk unique (mandant_id, id),
  constraint btb_mannstunden_kopf_fk foreign key (mandant_id, bautagebuch_id)
    references bautagebuch (mandant_id, id),
  /** §1.4: der Grosselternschluessel — das Tagebuch DIESES Projekts. */
  constraint btb_mannstunden_projekt_fk
    foreign key (mandant_id, projekt_id, bautagebuch_id)
    references bautagebuch (mandant_id, projekt_id, id),
  constraint btb_mannstunden_gewerk_fk foreign key (mandant_id, gewerk_id)
    references gewerk (mandant_id, id),
  constraint btb_mannstunden_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references bautagebuch_mannstunden (mandant_id, id),

  constraint btb_mannstunden_personen check (anzahl_personen > 0),
  constraint btb_mannstunden_dauer check (dauer_minuten >= 0 and dauer_minuten <= 1440),
  /** Ein Nachunternehmer ohne Namen ist keiner — und ein eigener hat keinen. */
  constraint btb_mannstunden_nu_genannt check (
    (herkunft = 'nachunternehmer')
    = (nachunternehmer_firma_id is not null
       or btrim(coalesce(nachunternehmer_name,'')) <> '')),
  constraint btb_mannstunden_storno_begruendet check (
    (storniert_am is null and storno_grund is null and storniert_von is null)
    or (storniert_am is not null and storniert_von is not null
        and btrim(coalesce(storno_grund,'')) <> '')),
  constraint btb_mannstunden_ersatz_nicht_selbst check (ersetzt_durch_id is distinct from id),
  constraint btb_mannstunden_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index btb_mannstunden_kopf_idx on bautagebuch_mannstunden (bautagebuch_id);
/** Stunden je Gewerk ueber das Projekt (REP-05). */
create index btb_mannstunden_gewerk_idx on bautagebuch_mannstunden (mandant_id, gewerk_id);
create index btb_mannstunden_nu_idx
  on bautagebuch_mannstunden (mandant_id, nachunternehmer_firma_id)
  where herkunft = 'nachunternehmer';

comment on table bautagebuch_mannstunden is
  'BAU-07, §7.13: die Stunden des Tages je Gewerk und Herkunft. Anfuegend — '
  'eine falsche Zeile wird storniert und ersetzt, nie geaendert.';
comment on column bautagebuch_mannstunden.dauer_minuten is
  'Gemessene Dauer in ganzen Minuten (K-16). Die Schranke 0…1440 ist eine '
  'Eingabeplausibilitaet, keine ArbZG-Grenze — die gilt je Person.';

-- ---------------------------------------------------------------------------
-- 5. bautagebuch_position — Geraet, Lieferung, Vorkommnis (§7.14)
-- ---------------------------------------------------------------------------

/**
 * Eine Zeile je Sache, statt eines Fliesstextfelds: „3 t Bewehrung, Lieferung
 * 4711" bleibt auswertbar (Abgleich mit der Eingangsrechnung, ACC-04), waehrend
 * derselbe Satz in `bemerkungen` nur noch lesbar ist.
 */
create table bautagebuch_position (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  bautagebuch_id uuid not null,
  projekt_id    uuid not null,

  art           bautagebuch_position_art not null,
  reihenfolge   smallint not null default 0,
  bezeichnung   text not null,

  /** Menge als MENGE (§1.1, K-16) — Stueck, t, m³. Nie Geld. */
  menge         numeric(12,3),
  einheit       text,

  lieferant_firma_id uuid references firma(id),
  lieferschein_nummer text,
  gewerk_id     uuid,
  /** Wann das Vorkommnis geschah — UTC, angezeigt in Berlin (Invariante 2). */
  zeitpunkt     timestamptz,
  beschreibung  text,

  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  -- Auditblock OHNE `geaendert_*` — anfuegend wie §7.13.
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint btb_position_mandant_uk unique (mandant_id, id),
  constraint btb_position_kopf_fk foreign key (mandant_id, bautagebuch_id)
    references bautagebuch (mandant_id, id),
  constraint btb_position_projekt_fk
    foreign key (mandant_id, projekt_id, bautagebuch_id)
    references bautagebuch (mandant_id, projekt_id, id),
  constraint btb_position_gewerk_fk foreign key (mandant_id, gewerk_id)
    references gewerk (mandant_id, id),
  constraint btb_position_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references bautagebuch_position (mandant_id, id),

  constraint btb_position_bezeichnung_nicht_leer check (btrim(bezeichnung) <> ''),
  /** Eine Zahl ohne Einheit ist keine Menge; eine Einheit ohne Zahl auch nicht. */
  constraint btb_position_menge_paarweise check ((menge is null) = (einheit is null)),
  /** Ein Vorkommnis ohne Beschreibung dokumentiert nichts. */
  constraint btb_position_vorkommnis_beschrieben check (
    art <> 'vorkommnis' or btrim(coalesce(beschreibung,'')) <> ''),
  constraint btb_position_storno_begruendet check (
    (storniert_am is null and storno_grund is null and storniert_von is null)
    or (storniert_am is not null and storniert_von is not null
        and btrim(coalesce(storno_grund,'')) <> '')),
  constraint btb_position_ersatz_nicht_selbst check (ersetzt_durch_id is distinct from id),
  constraint btb_position_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index btb_position_kopf_idx on bautagebuch_position (bautagebuch_id, art, reihenfolge);
create index btb_position_lieferung_idx
  on bautagebuch_position (mandant_id, lieferant_firma_id)
  where art = 'lieferung';

comment on table bautagebuch_position is
  'BAU-07, §7.14: Geraet, Lieferung und Vorkommnis des Tages — eine Zeile je '
  'Sache, damit sie auswertbar bleibt. Anfuegend.';

-- ---------------------------------------------------------------------------
-- 6. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `bautagebuch_kind_erben` — Projekt UND Tagessperre kommen VOM KOPF.
 *
 * Das Projekt wird ABGELEITET und nicht uebernommen: waere es eine Eingabe,
 * koennte eine Mannstundenzeile behaupten, zu einem anderen Projekt zu
 * gehoeren als ihr Tag — und genau darauf ruhen die Mitarbeiterdecke und
 * `t_person`, die nach §1.8 nicht ueber den Elternteil joinen duerfen.
 *
 * Gleichzeitig faellt hier das Tor „nach Abschluss kommt nichts mehr hinzu".
 * Ohne es waere der Riegel am Kopf halb: die Kopfzeilen stuenden fest,
 * waehrend sich der Tag ueber neue Kindzeilen weiter veraendern liesse.
 */
create function kern.bautagebuch_kind_erben() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare k record;
begin
  select b.projekt_id, b.abgeschlossen_am, b.storniert_am into k
    from public.bautagebuch b
   where b.id = new.bautagebuch_id and b.mandant_id = new.mandant_id;

  if k.projekt_id is null then
    raise exception 'Zu dieser Zeile gibt es kein Bautagebuch in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;

  new.projekt_id := k.projekt_id;

  if tg_op = 'INSERT' and k.abgeschlossen_am is not null then
    raise exception 'Der Bautag ist abgeschlossen — es kommt nichts mehr hinzu (BAU-07, LEG-01)'
      using errcode = 'check_violation',
            hint = 'Korrigiert wird durch Storno des Tages und einen Ersatztag.';
  end if;

  if tg_op = 'INSERT' and k.storniert_am is not null then
    raise exception 'Zu einem stornierten Bautag wird nichts mehr erfasst'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_btb_mannstunden_1_erben
  before insert or update on bautagebuch_mannstunden
  for each row execute function kern.bautagebuch_kind_erben();
create trigger trg_btb_position_1_erben
  before insert or update on bautagebuch_position
  for each row execute function kern.bautagebuch_kind_erben();

/**
 * `bautagebuch_kind_nur_storno` — die Kindzeilen sind ANFUEGEND.
 *
 * Dasselbe Muster wie `kern.wachbuch_nur_storno()` (0070) und aus demselben
 * Grund: eine Mannstundenzahl, die sich nachtraeglich bewegen laesst, belegt
 * nichts. Beweglich sind ausschliesslich die vier Stornospalten — und ein
 * gesetztes Storno wird nicht zurueckgenommen, denn ein Storno, das
 * verschwinden kann, ist keine Spur.
 *
 * Die Serveruhr stempelt auch hier (§1.11): wann jemand den Fehler bemerkt
 * hat, ist keine Angabe des Aufrufers.
 */
create function kern.bautagebuch_kind_nur_storno() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_ms  bautagebuch_mannstunden;
  v_pos bautagebuch_position;
  v_abweichung boolean;
begin
  if tg_table_name = 'bautagebuch_mannstunden' then
    v_ms := old;
    v_ms.storniert_am     := new.storniert_am;
    v_ms.storniert_von    := new.storniert_von;
    v_ms.storno_grund     := new.storno_grund;
    v_ms.ersetzt_durch_id := new.ersetzt_durch_id;
    v_abweichung := to_jsonb(v_ms) is distinct from to_jsonb(new);
  else
    v_pos := old;
    v_pos.storniert_am     := new.storniert_am;
    v_pos.storniert_von    := new.storniert_von;
    v_pos.storno_grund     := new.storno_grund;
    v_pos.ersetzt_durch_id := new.ersetzt_durch_id;
    v_abweichung := to_jsonb(v_pos) is distinct from to_jsonb(new);
  end if;

  if v_abweichung then
    raise exception 'Eine Bautagebuchzeile wird nicht geaendert (BAU-07, LEG-01)'
      using errcode = 'P0001',
            detail  = 'Nur storniert_am, storniert_von, storno_grund und '
                      || 'ersetzt_durch_id duerfen sich bewegen.',
            hint    = 'Korrigiert wird durch eine NEUE Zeile, die die alte in '
                      || 'ersetzt_durch_id nennt.';
  end if;

  if old.storniert_am is not null
     and (new.storniert_am is distinct from old.storniert_am
          or new.storno_grund is distinct from old.storno_grund) then
    raise exception 'Ein Storno wird nicht zurueckgenommen (Invariante 8)'
      using errcode = 'P0001';
  end if;

  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;

  return new;
end $$;

create trigger trg_btb_mannstunden_2_nur_storno
  before update on bautagebuch_mannstunden
  for each row execute function kern.bautagebuch_kind_nur_storno();
create trigger trg_btb_position_2_nur_storno
  before update on bautagebuch_position
  for each row execute function kern.bautagebuch_kind_nur_storno();

/**
 * `bautagebuch_einfrieren` — ab `abgeschlossen_am` bewegt sich nichts mehr.
 *
 * Erlaubt bleiben genau die Spalten, die NACH dem Abschluss entstehen: die
 * Gegenzeichnung des Auftraggebers, der Storno samt Ersatztag und die
 * Aufbewahrungsspalten, die ein Job setzt. Alles andere ist der Tag selbst.
 *
 * Der Statuswechsel `abgeschlossen → gegengezeichnet` bleibt moeglich — er
 * BESCHREIBT die Gegenzeichnung und aendert keinen Inhalt.
 */
create function kern.bautagebuch_einfrieren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.abgeschlossen_am is null then return new; end if;

  if new.projekt_id is distinct from old.projekt_id
     or new.datum is distinct from old.datum
     or new.arbeitsbeginn is distinct from old.arbeitsbeginn
     or new.arbeitsende is distinct from old.arbeitsende
     or new.besondere_vorkommnisse is distinct from old.besondere_vorkommnisse
     or new.bemerkungen is distinct from old.bemerkungen
     or new.behinderung_id is distinct from old.behinderung_id
     or new.abgeschlossen_am is distinct from old.abgeschlossen_am then
    raise exception 'Ein abgeschlossener Bautag ist unveraenderlich (BAU-07, LEG-01)'
      using errcode = 'check_violation',
            hint = 'Korrigiert wird durch Storno und einen Ersatztag, nie durch Aendern.';
  end if;

  if new.status is distinct from old.status
     and new.status not in ('gegengezeichnet','abgeschlossen') then
    raise exception 'Ein abgeschlossener Bautag faellt nicht in den Entwurf zurueck'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

/**
 * `bautagebuch_stempeln` — die Serverzeit auf Abschluss, Gegenzeichnung und
 * Storno (Invariante 5, §1.11).
 *
 * Ein mitgeschickter Zeitpunkt waere die Antwort auf „wann wurde der Tag
 * geschlossen", und die gehoert nicht dem Aufrufer: mit ihr liesse sich ein
 * Tagebuch drei Wochen spaeter schreiben und auf den Tag zurueckdatieren.
 * Ein Storno wird auch hier nicht zurueckgenommen.
 */
create function kern.bautagebuch_stempeln() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    if new.abgeschlossen_am is not null then new.abgeschlossen_am := now(); end if;
    if new.gegengezeichnet_am is not null then new.gegengezeichnet_am := now(); end if;
    if new.storniert_am is not null then new.storniert_am := now(); end if;
    return new;
  end if;

  if old.storniert_am is not null
     and (new.storniert_am is distinct from old.storniert_am
          or new.storno_grund is distinct from old.storno_grund) then
    raise exception 'Ein Storno wird nicht zurueckgenommen (Invariante 8)'
      using errcode = 'P0001';
  end if;

  if new.abgeschlossen_am is not null and old.abgeschlossen_am is null then
    new.abgeschlossen_am := now();
  end if;
  if new.gegengezeichnet_am is not null and old.gegengezeichnet_am is null then
    new.gegengezeichnet_am := now();
  end if;
  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;
  return new;
end $$;

create trigger trg_bautagebuch_1_stempeln
  before insert or update on bautagebuch
  for each row execute function kern.bautagebuch_stempeln();
create trigger trg_bautagebuch_2_einfrieren
  before update on bautagebuch
  for each row execute function kern.bautagebuch_einfrieren();

-- ---------------------------------------------------------------------------
-- 7. Medien: das Bautagebuch wird Bezugstabelle des privaten Buckets
-- ---------------------------------------------------------------------------

/**
 * Die Registerzeile, die 0041 §5.8.1 fuer PR 45 ausdruecklich vorgesehen hat.
 * `bautagebuch` steht dort bereits in der geschlossenen Liste; was fehlte, war
 * die Zeile — und ohne sie weist `kern.einsatz_medien_bezug_pruefen()` jedes
 * Tagebuchfoto ab.
 *
 * `kunde_pfad = null`: das Bautagebuch traegt kein `kunde_id`. Das ist keine
 * Auslassung — §7.12 gibt ihm keine Kundendecke, und die Fotos einer Baustelle
 * (Kolonne, Geraet, Schadstelle) sind kein Kundenbestand. Der Kunde sieht das
 * Projekt und das Aufmass, nicht das Tagebuch.
 */
insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad)
values ('bautagebuch', 'bau', null)
on conflict (tabelle) do nothing;

/**
 * Und der schmale Weg fuer genau diese Bezugsart — dieselbe Lage wie beim
 * Aufmass (0072): `einsatz_medien` traegt seit 0041 eine Policy auf dem Modul
 * `zeit`, und eine Bauleitung haelt `bau.schreiben` und kein Zeitrecht. Ohne
 * die beiden Policies scheiterte jedes Tagebuchfoto daran, dass die Aufnahme
 * dem falschen Modul zugerechnet wird.
 *
 * Beide sind PERMISSIV und auf `bezug_tabelle = 'bautagebuch'` eingeschnuert;
 * die restriktiven Decken aus 0041 gelten unveraendert darueber.
 */
create policy t_bau_tagebuch_medien on einsatz_medien for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and bezug_tabelle = 'bautagebuch'
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant())));

create policy t_bau_tagebuch_medien_lesen on einsatz_medien for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and bezug_tabelle = 'bautagebuch'
         and (select app.hat_recht('bau.lesen', app.aktiver_mandant())));

-- ---------------------------------------------------------------------------
-- 8. RLS (§1.5, §1.6, §1.6a, §1.8)
-- ---------------------------------------------------------------------------

alter table gewerk enable row level security;
alter table gewerk force  row level security;

create policy t_mandant on gewerk for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on gewerk for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/** §1.8: `p_intern_ceiling` — der Gewerkekatalog ist eine interne Stammliste. */
create policy p_intern_decke on gewerk as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on gewerk to cse_app;

alter table bautagebuch enable row level security;
alter table bautagebuch force  row level security;

create policy t_mandant on bautagebuch for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on bautagebuch for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/**
 * §1.6a, §1.8: die Kolonne liest den Tag IHRER Baustelle (BAU-07), und zwar
 * ueber die Definer-Hilfe statt ueber eine Unterabfrage auf `einsatz` —
 * `einsatz` ist eine Tabelle, aus der dieselbe Sitzung ausgesperrt sein kann,
 * und die Unterabfrage lieferte dann null Zeilen ohne Fehlermeldung (B16).
 *
 * **Nur SELECT.** Ein Schreibweg im Personen-Scope existiert in dieser Domaene
 * nirgends (§1.8, letzter Absatz): `app.aktiver_mandant()` ist dort NULL, also
 * ist jedes `with check` von `t_mandant` falsch und die Datenbank weist den
 * Schreibvorgang ab.
 */
create policy t_person on bautagebuch for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and app.ist_eingesetzt_auf_projekt(projekt_id));

/** §1.8, vierte Form: intern, plus die auf der Baustelle eingesetzte Kraft. */
create policy p_intern_einsatz_decke on bautagebuch as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_projekt(projekt_id)));

grant select, insert, update on bautagebuch to cse_app;

/**
 * `cse_definer` liest den Kopf, weil `kern.einsatz_medien_bezug_pruefen()`
 * (0041) und `kern.einsatz_medien_loeschsperre()` ihn aufloesen — und ein
 * Definer ist unter FORCE RLS nicht ausgenommen (§1.5). Ohne diese Policy
 * schluege jedes Tagebuchfoto mit „der Elternteil existiert nicht" fehl.
 */
grant select on bautagebuch to cse_definer;
create policy d_medien_bezug on bautagebuch for select to cse_definer using (true);

alter table bautagebuch_mannstunden enable row level security;
alter table bautagebuch_mannstunden force  row level security;

create policy t_mandant on bautagebuch_mannstunden for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on bautagebuch_mannstunden for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

create policy t_person on bautagebuch_mannstunden for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and app.ist_eingesetzt_auf_projekt(projekt_id));

create policy p_intern_einsatz_decke on bautagebuch_mannstunden
  as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_projekt(projekt_id)));

/** UPDATE nur fuer den Storno — der Ausloeser laesst nichts anderes durch. */
grant select, insert, update on bautagebuch_mannstunden to cse_app;

alter table bautagebuch_position enable row level security;
alter table bautagebuch_position force  row level security;

create policy t_mandant on bautagebuch_position for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on bautagebuch_position for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

create policy t_person on bautagebuch_position for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and app.ist_eingesetzt_auf_projekt(projekt_id));

create policy p_intern_einsatz_decke on bautagebuch_position
  as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'mitarbeiter' and app.ist_eingesetzt_auf_projekt(projekt_id)));

grant select, insert, update on bautagebuch_position to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0082)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- gewerk (archiv): BAU-07, REP-05. Der Katalogeintrag ist der Bezug jeder Mannstundenzeile. Geloescht traegt eine abgeschlossene Tagesseite eine Gewerkekennung, zu der es nichts mehr gibt — und die Auswertung „Stunden je Gewerk" verliert rueckwirkend Zeilen. Ein aufgegebenes Gewerk bekommt archiviert_am und verschwindet aus der Auswahl, nicht aus der Historie.
create trigger trg_gewerk_kein_hard_delete
  before delete on gewerk
  for each row execute function kern.verhindere_loeschung();
create trigger trg_gewerk_kein_truncate
  before truncate on gewerk
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on gewerk from cse_app, cse_anon, cse_checkin, cse_job;

-- bautagebuch (archiv): BAU-07, LEG-01. Der Bautag traegt Bauzeit, Behinderung und Mehrverguetungsanspruch. Ein abgeschlossener Tag ist unveraenderlich; korrigiert wird durch Storno und einen Ersatztag (ersetzt_durch_id). Geloescht bliebe eine Luecke in der Bauzeit, die niemand mehr erklaeren kann — und genau daraus wird im Prozess ein Anspruch hergeleitet.
create trigger trg_bautagebuch_kein_hard_delete
  before delete on bautagebuch
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bautagebuch_kein_truncate
  before truncate on bautagebuch
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bautagebuch from cse_app, cse_anon, cse_checkin, cse_job;

-- bautagebuch_mannstunden (append): BAU-07, TIM-12, REP-05. Die Zeile IST die Mannstundenangabe des Tages — die Zahl, gegen die der Abgleich mit dem zeiteintrag laeuft und aus der ein Bauzeitnachtrag gerechnet wird. Sie ist anfuegend: eine falsche Zeile wird storniert und ersetzt, damit sichtbar bleibt, dass zuerst etwas anderes dastand.
create trigger trg_bautagebuch_mannstunden_kein_hard_delete
  before delete on bautagebuch_mannstunden
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bautagebuch_mannstunden_kein_truncate
  before truncate on bautagebuch_mannstunden
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bautagebuch_mannstunden from cse_app, cse_anon, cse_checkin, cse_job;

-- bautagebuch_position (append): BAU-07, LEG-01. Geraet, Lieferung und Vorkommnis des Tages. Ein geloeschtes Vorkommnis ist genau die Seite, die im Streit fehlt; eine irrtuemliche Zeile wird storniert und ersetzt.
create trigger trg_bautagebuch_position_kein_hard_delete
  before delete on bautagebuch_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bautagebuch_position_kein_truncate
  before truncate on bautagebuch_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bautagebuch_position from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_gewerk_geaendert_am
  before update on gewerk
  for each row execute function kern.setze_geaendert_am();
create trigger trg_bautagebuch_geaendert_am
  before update on bautagebuch
  for each row execute function kern.setze_geaendert_am();

create trigger trg_bautagebuch_audit
  after insert or update or delete on bautagebuch
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
