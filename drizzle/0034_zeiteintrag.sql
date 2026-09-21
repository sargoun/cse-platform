-- ===========================================================================
-- 0034 — zeiteintrag: der § 17 MiLoG-Nachweis
--        (04-PLANUNG-ZEIT.md §5.6, §7.1, §7.3; TIM-08, TIM-11, TIM-12,
--         TIM-13, DSH-05, LEG-02, LEG-10, EMP-03, EMP-07, EMP-14)
--
-- Vertrag: `docs/architecture/02-datenmodell/04-PLANUNG-ZEIT.md` §5.6. Wo
-- dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- Das ist die Zeile, die im Lohnstreit vorgelegt wird, aus der jede
-- stundenbasierte Rechnungszeile stammt und an der eine Gewerbeaufsicht die
-- ArbZG-Belastung misst. Vier Dinge stehen deshalb hier bewusst NICHT so, wie
-- es naheliegend waere:
--
--  1. **Die Geraetezeit ist niemals der massgebliche Zeitpunkt** (Invariante 5,
--     TIM-08). Sie steht DANEBEN, in `geraete_zeit_*`, und die Differenz zur
--     Serveruhr in `zeitabweichung_*_sek`. Der naheliegende Entwurf — die
--     behauptete Zeit in die massgebliche Spalte schreiben und ueber einen
--     Status „ungeprueft" aus der Abrechnung halten — macht Invariante 5
--     abhaengig davon, wie der Kunde eine offene Frage beantwortet (O-39).
--     Antwortet er „kein Freigabeschritt", flieszt eine von einem
--     unauthentifizierten Telefon behauptete Dauer in den § 17-Nachweis, in
--     das Stundenkonto und auf eine Rechnung.
--
--  2. **Korrekturen sind neue Zeilen, kein UPDATE** (TIM-11, §15.6). Ein
--     UPDATE mit Auditzeile daneben verliert genau das, worauf es ankommt: den
--     Datensatz, der GALT, als der Lohn gezahlt wurde. `kette_id` haelt die
--     logische Identitaet zusammen, `version` zaehlt, `ersetzt_am is null`
--     bedeutet „aktuell".
--
--  3. **Die Dauer ist die Differenz zweier UTC-Zeitpunkte** — nie eine
--     Wanduhr-Subtraktion und nie „Beginn plus gespeicherte Dauer". Sonst sind
--     die beiden Umstellungsnaechte um eine Stunde falsch (K-11: 480/420/540).
--
--  4. **Keine Geldspalte, in keiner Form** (§1.5). Bewertet werden Stunden in
--     `src/server/services/`; der Satz haengt an `anstellung_kondition` hinter
--     den Spaltenrechten von K-05. Eine Geldspalte hier waere ein blockierender
--     Defekt (§16 Nr. 1), weil die EMP-14-Selbstauskunft dieser Tabelle sonst
--     einem Menschen den Satz seines Kollegen zeigte.
--
-- NICHT in dieser Migration: `checkin_token` (0035), `zeiteintrag_korrektur`
-- (0036), `offline_ereignis` und die Medienerfassung (PR 35), `stundenkonto`
-- und sein Sperrausloeser `z_monat_sperren` (PR 37), `zeit_einwand` (PR 36).
-- Die Spalten, an denen sie haengen, stehen hier; die Fremdschluessel kommen
-- mit ihren Elterntabellen (§19).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.1, §3.2)
-- ---------------------------------------------------------------------------

/**
 * Welche Uhr einen MASSGEBLICHEN Zeitpunkt erzeugt hat.
 *
 * `geraet_behauptet` fehlt mit Absicht (§1.8). Es gaebe genau drei Quellen —
 * die Serveruhr, die Entscheidung eines benannten Menschen und den Import
 * historischer Daten — und ein Telefon ist keine davon. Wer den Wert
 * ergaenzt, hebt Invariante 5 auf, ohne eine Zeile Code zu aendern.
 */
create type zeitquelle as enum ('server_uhr','planer_entscheidung','import');

/** Wie der Datensatz entstanden ist — die Erfassungsart, nicht die Uhr. */
create type erfassungs_art as enum
  ('checkin_token','portal','planer_manuell','nacherfassung','import');

/**
 * PROVISORISCH (§3.2), mit einer Ausnahme: dass ein Freigabeschritt
 * DARSTELLBAR sein muss, steht fest — FIN-07 darf keinen ungeprueften
 * Datensatz abrechnen. Das TOR selbst ist aber eine SPALTE (`freigegeben_am`)
 * und kein Wert dieses Typs: ein Teilindex auf `status = 'freigegeben'` traefe
 * null Zeilen, wenn der Kunde „kein Freigabeschritt" antwortet, und die
 * Abrechnungsabfrage lieferte still null Stunden statt zu scheitern (§3.3).
 * **O-39 ist beantwortet (D-611)** und die Wahl von damals hat gehalten: ja,
 * es gibt den Freigabeschritt, ein Mensch erteilt ihn woechentlich vor der
 * Fakturierung — und weil das Tor eine SPALTE ist und kein Wert dieses Typs,
 * hat die Antwort an diesem Enum nichts geaendert. Gebunden wird das Recht in
 * `0371`; was offen bleibt, ist die EINHEIT der Freigabe (O-861, siehe 0366).
 */
create type zeiteintrag_status as enum
  ('laufend','abgeschlossen','offen_nacherfassung','storniert');

/**
 * LEG-10, gesperrt auf O-06 (§1.15, §9.5).
 *
 * Vier Werte, weil „kein Punkt" vier verschiedene Dinge heisst und ein NULL
 * sie zu einem zusammenzoege: die Erfassung ist abgeschaltet, der Mensch hat
 * sie verweigert, das Geraet konnte nicht orten — oder es gibt einen Punkt.
 */
create type geo_status as enum ('erfasst','deaktiviert','verweigert','nicht_verfuegbar');

-- ---------------------------------------------------------------------------
-- 2. Die eine Dauerrechnung in SQL (§7.1, K-11)
-- ---------------------------------------------------------------------------

/**
 * Minuten zwischen zwei Zeitpunkten — die Differenz zweier UTC-Instants.
 *
 * Sie steht hier, weil ein Ausloeser kein TypeScript aufrufen kann; sie ist
 * das SQL-Gegenstueck zu `dauerMinuten` in `src/server/services/zeit/dauer.ts`
 * und KEINE zweite Zeitrechnung: beide subtrahieren Instants, beide werden in
 * `tests/isolation/zeiteintrag.test.ts` gegen dieselbe K-11-Tabelle gehalten
 * (480 / 420 / 540). Genau deshalb ist sie eine benannte Funktion und keine
 * Formel im Ausloeserrumpf: eine Formel in einer DDL-Anweisung kann kein Test
 * erreichen.
 *
 * Ein `GENERATED ALWAYS AS … STORED` waere das Naheliegende und geht nicht:
 * `extract(epoch from …)` ist nicht `IMMUTABLE`, Postgres weist die Spalte ab.
 */
create function app.dauer_minuten(p_von timestamptz, p_bis timestamptz)
returns integer
language sql
immutable
parallel safe
as $$
  select case when p_von is null or p_bis is null then null
              else (extract(epoch from (p_bis - p_von)) / 60)::integer end;
$$;

comment on function app.dauer_minuten(timestamptz, timestamptz) is
  'Dauer in Minuten als Differenz zweier UTC-Zeitpunkte (§7.1, K-11). Das '
  'SQL-Gegenstueck zu services/zeit/dauer.ts — nicht eine zweite Rechnung, '
  'sondern dieselbe, dort wo ein Ausloeser sie braucht.';

grant execute on function app.dauer_minuten(timestamptz, timestamptz)
  to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- 3. zeiteintrag (§5.6)
-- ---------------------------------------------------------------------------

create table zeiteintrag (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /**
   * Die stabile Identitaet des LOGISCHEN Eintrags ueber alle Korrekturen
   * hinweg. Eine neue Fassung erbt sie; deshalb liest sich „die Geschichte
   * dieser Schicht" als EIN indizierter Zugriff und nicht als Rekursion ueber
   * `ersetzt_zeiteintrag_id`.
   */
  kette_id      uuid not null default gen_random_uuid(),
  version       integer not null default 1,
  ersetzt_zeiteintrag_id uuid,
  -- Gesetzt auf der ALTEN Zeile, wenn sie abgeloest wurde. Aktuell ⇔ NULL.
  ersetzt_am    timestamptz,
  ersetzt_durch_zeiteintrag_id uuid,

  -- D-09: kostenrelevant ⇒ Beschaeftigung. `person_id` steht denormalisiert
  -- daneben und ist durch den zusammengesetzten Schluessel festgenagelt —
  -- ohne sie muesste die EMP-14-Selbstauskunft ueber eine mandantengebundene
  -- Tabelle joinen und traefe in `person`-Scope null Zeilen (§15.3).
  anstellung_id uuid not null,
  person_id     uuid not null,

  -- NULL fuer ungeplante Arbeit: Abruf, Notdiensteinsatz.
  einsatz_id            uuid,
  einsatz_zuordnung_id  uuid,
  objekt_id             uuid,
  /**
   * NICHT `auftrag_id`: Zeit haengt an der LEISTUNGSZEILE (FIN-07). Der
   * Auftrag ist einen Join entfernt. Der Elternteil `auftrag_leistung`
   * existiert noch nicht — der zusammengesetzte Fremdschluessel kommt mit ihm
   * (§6, §19).
   */
  auftrag_leistung_id   uuid,
  -- Ohne diese drei kann CLN-01 Soll gegen Ist nicht vergleichen, SEC-01 keine
  -- Stunden je Posten melden und BAU-07 keine Mannstunden fuer ungeplante Zeit
  -- ausweisen. `posten` und `projekt` gibt es noch nicht (§6).
  revier_id             uuid,
  posten_id             uuid,
  projekt_id            uuid,

  /**
   * Der massgebliche Beginn. Woher er stammt, sagt `quelle_beginn` — und ein
   * Geraet ist keine der drei erlaubten Quellen (§1.8).
   */
  beginn_zeitpunkt timestamptz not null,
  -- NULL ⇔ laeuft noch. Das ist die DSH-05-Bedingung, kein Statuswert.
  ende_zeitpunkt   timestamptz,
  pause_minuten    integer not null default 0,

  -- Vom Ausloeser gerechnet, nie vom Aufrufer geschrieben (§7.1).
  dauer_brutto_minuten integer,
  dauer_netto_minuten  integer,

  erfassungsart_beginn erfassungs_art not null,
  erfassungsart_ende   erfassungs_art,
  quelle_beginn        zeitquelle not null,
  quelle_ende          zeitquelle,

  -- Die Uhr des Telefons. Getrennt gespeichert, nie massgeblich (TIM-08).
  geraete_zeit_beginn  timestamptz,
  geraete_zeit_ende    timestamptz,
  /**
   * Vorzeichenbehaftet, Geraet MINUS Server, in Sekunden — abgeleitet von
   * `kern.stempel_feldzeit()`.
   *
   * Invariante 5 nennt EINE Spalte `zeitabweichung_sek`; hier sind es zwei,
   * je Ereignis eine. Der Grund: Beginn und Ende werden Stunden auseinander
   * erfasst, oft auf verschiedenen Geraeten, und eine gemeinsame Spalte
   * ueberschriebe die erste Messung mit der zweiten — die Abweichung beim
   * Einstempeln waere dann nicht mehr feststellbar. Aufgeschrieben in
   * DECISIONS.md, damit eine Konformitaetspruefung, die nach dem woertlichen
   * Namen sucht, den Grund findet (§5.6).
   */
  zeitabweichung_beginn_sek integer,
  zeitabweichung_ende_sek   integer,

  -- Was der Mensch BEHAUPTET (TIM-09). Nie ohne `zeiteintrag_korrektur` in
  -- eine massgebliche Spalte kopiert (§1.8).
  behauptet_beginn        timestamptz,
  behauptet_ende          timestamptz,
  behauptet_pause_minuten integer,
  nacherfasst             boolean not null default false,
  -- Servereingang minus behaupteter Beginn; die § 17-Aufzeichnungsfrist liest
  -- sie (§10.4).
  nacherfassung_verzoegerung_sek integer,
  -- Aus welchem Offline-Anspruch diese Zeile befoerdert wurde. Elternteil und
  -- Fremdschluessel kommen mit PR 35 (§6).
  offline_ereignis_id     uuid,

  -- Welche Marken diese Zeile geoeffnet und geschlossen haben (0035, §6).
  checkin_token_id  uuid,
  checkout_token_id uuid,

  /**
   * LEG-10 — EIN Punkt bei Beginn, EIN Punkt bei Ende.
   *
   * Es gibt mit Absicht KEINE Tabelle, in der ein dritter Punkt stehen
   * koennte. Diese Abwesenheit IST die Durchsetzung von „keine
   * Bewegungsverfolgung": eine `position`-Tabelle machte daraus eine
   * einzeilige Erweiterung, und eine `check`-Bedingung auf die Zeilenzahl
   * ueberlebte die erste Migration nicht, die „nur einen Punkt mehr" braucht.
   * `numeric(9,6)` wie `objekt.geo_lat` — nie `float`.
   */
  geo_beginn_lat          numeric(9,6),
  geo_beginn_lon          numeric(9,6),
  geo_beginn_genauigkeit_m numeric(12,3),
  geo_beginn_status       geo_status not null default 'deaktiviert',
  geo_ende_lat            numeric(9,6),
  geo_ende_lon            numeric(9,6),
  geo_ende_genauigkeit_m  numeric(12,3),
  geo_ende_status         geo_status not null default 'deaktiviert',

  status        zeiteintrag_status not null default 'laufend',

  /**
   * Das Tor zu Stundenkonto und Abrechnung (§3.3) — eine SPALTE, damit die
   * Abrechnungsabfrage unter BEIDEN Antworten auf O-39 richtig bleibt.
   */
  freigegeben_am  timestamptz,
  freigegeben_von uuid references benutzer(id),
  /**
   * Gesetzt, wenn der Stundenkonto-Monat dieser Beschaeftigung sperrt
   * (EMP-04). EIN Schreiber: `z_monat_sperren`, ein Ausloeser auf
   * `stundenkonto`, den PR 37 mitbringt. Ohne ihn bliebe die Spalte fuer immer
   * NULL, `zk_sperre_ausgleich` feuerte nie, eine Korrektur an einem
   * gesperrten Monat entstuende ohne Gegenbuchung, und der ACC-12-Lohnexport
   * (`freigegeben_am is not null and gesperrt_am is not null`) waehlte null
   * Zeilen. Deshalb steht der Schreiber hier benannt, obwohl er noch fehlt.
   */
  gesperrt_am     timestamptz,

  -- Doppelabrechnungssperre. Der Fremdschluessel auf `rechnungsposition` kommt
  -- mit der Finanzmigration (§19, Phase 6).
  abgerechnet_am      timestamptz,
  abrechnung_referenz uuid,

  -- §1.13 / §13: Klasse `zeiterfassung`, nach Abrechnung zusaetzlich GoBD.
  -- // TODO(client, O-25): Aufbewahrungsfrist fuer Zeiterfassungsdaten —
  -- ab wann laeuft die zweijaehrige Frist nach § 17 Abs. 1 MiLoG?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  -- Stornierung statt Loeschung (Invariante 8).
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  notiz         text,

  -- Auditblock (§1.6). `erstellt_am` IST der Servereingang und damit
  -- massgeblich fuer die TIM-09-Verspaetung.
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint zeiteintrag_mandant_uk unique (mandant_id, id),
  /**
   * Damit `leistungsnachweis_position` (03-GEWERKE §1.4) keine Stunde
   * abrechnen kann, die auf einer ANDEREN Auftragszeile erfasst wurde.
   */
  constraint zeiteintrag_leistung_uk unique (mandant_id, auftrag_leistung_id, id),
  constraint zeiteintrag_kette_uk unique (kette_id, version),

  constraint z_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  -- Der Schluessel, der die denormalisierte person_id festnagelt (§15.3).
  constraint z_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  constraint z_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),
  constraint z_zuordnung_fk foreign key (mandant_id, einsatz_zuordnung_id)
    references einsatz_zuordnung (mandant_id, id),
  constraint z_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint z_revier_fk foreign key (mandant_id, revier_id)
    references revier (mandant_id, id),
  constraint z_vorgaenger_fk foreign key (mandant_id, ersetzt_zeiteintrag_id)
    references zeiteintrag (mandant_id, id),
  constraint z_nachfolger_fk foreign key (mandant_id, ersetzt_durch_zeiteintrag_id)
    references zeiteintrag (mandant_id, id),

  constraint z_version check (version >= 1),
  constraint z_fenster check (ende_zeitpunkt is null or ende_zeitpunkt > beginn_zeitpunkt),
  constraint z_pause_nicht_negativ check (pause_minuten >= 0),
  constraint z_netto_nicht_negativ check (
    dauer_netto_minuten is null or dauer_netto_minuten >= 0),
  /**
   * Eine behauptete Zeit darf nur mit Nacherfassungsflagge massgeblich
   * werden — und zwar auf BEIDEN Seiten.
   *
   * Der Entwurf hatte die Bedingung nur auf dem Beginn. Damit liesse sich ein
   * behauptetes ENDE als unmarkierter Datensatz durchreichen: der haeufigste
   * Fall ueberhaupt (jemand vergisst auszustempeln) waere unauffindbar.
   */
  constraint z_quelle_beginn_belegt check (quelle_beginn <> 'planer_entscheidung' or nacherfasst),
  constraint z_quelle_ende_belegt check (
    quelle_ende is null or quelle_ende <> 'planer_entscheidung' or nacherfasst),
  /**
   * Die Anspruchsbedingung ist JE EREIGNIS, nicht je Zeile.
   *
   * „Nacherfasst braucht einen behaupteten Beginn" plus „ein Planerende
   * erzwingt nacherfasst" ergibt zusammen eine Regel, die im haeufigsten
   * Korrekturfall nur unehrlich erfuellbar ist: die Wache stempelt per Marke
   * ein und vergisst auszustempeln, die Planung schliesst den Eintrag,
   * `quelle_ende = 'planer_entscheidung'` erzwingt `nacherfasst`, und
   * `nacherfasst` verlangte dann einen Beginn, den niemand behauptet hat — die
   * Planung muesste einen erfinden, um eine echte Korrektur aufzuschreiben.
   */
  constraint z_anspruch_je_ereignis check (
    not nacherfasst or behauptet_beginn is not null or behauptet_ende is not null),
  constraint z_behauptete_pause check (
    behauptet_pause_minuten is null or behauptet_pause_minuten >= 0),
  constraint z_freigabe_paarweise check (
    (freigegeben_am is null) = (freigegeben_von is null)),
  constraint z_storno_begruendet check (
    status <> 'storniert'
    or (storniert_am is not null and btrim(coalesce(storno_grund,'')) <> '')),
  /**
   * Geokoordinaten kommen paarweise oder gar nicht, und ein Punkt ohne Status
   * `erfasst` ist ein Punkt, den niemand erklaeren kann.
   */
  constraint z_geo_beginn_paarweise check (
    (geo_beginn_lat is null) = (geo_beginn_lon is null)
    and (geo_beginn_lat is not null) = (geo_beginn_status = 'erfasst')),
  constraint z_geo_ende_paarweise check (
    (geo_ende_lat is null) = (geo_ende_lon is null)
    and (geo_ende_lat is not null) = (geo_ende_status = 'erfasst')),
  constraint z_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * EIN offener Eintrag je Beschaeftigung.
 *
 * Zwei gleichzeitig offene Eintraege in einer Gesellschaft sind kein
 * berechtigtes Duplikat: sie zaehlen DSH-05 doppelt und lassen einen
 * Datensatz stehen, den die Ausstempelmarke nie schliessen kann — sie
 * schliesst den einen, den sie findet. Der ENTITAETSUEBERGREIFENDE Fall laesst
 * sich nicht so beschraenken (zwei Beschaeftigungen, zwei Zeilen) und wird
 * stattdessen erkannt (§10.1).
 */
create unique index z_offen_uk on zeiteintrag (anstellung_id)
  where ende_zeitpunkt is null and storniert_am is null and ersetzt_am is null;

create index z_plan_idx on zeiteintrag (mandant_id, beginn_zeitpunkt);
create index z_anstellung_idx on zeiteintrag (mandant_id, anstellung_id, beginn_zeitpunkt)
  where ersetzt_am is null and storniert_am is null;
/**
 * OHNE `mandant_id`-Praefix, mit Absicht: die kombinierte Portalansicht
 * (EMP-14/15) und die K-06-Projektion laufen ueber alle Beschaeftigungen eines
 * Menschen und koennen keinen einzelnen Mandanten nennen.
 */
create index z_person_idx on zeiteintrag (person_id, beginn_zeitpunkt)
  where ersetzt_am is null and storniert_am is null;
-- „Aktuell im Einsatz", auf jedem Dashboard und live (DSH-01, DSH-05).
create index z_laufend_idx on zeiteintrag (mandant_id)
  where ende_zeitpunkt is null and storniert_am is null and status = 'laufend';
create index z_einsatz_idx on zeiteintrag (mandant_id, einsatz_id);
-- Der Abrechnungslauf und FIN-18 (§3.3) — auf der SPALTE, nicht auf einem
-- vorlaeufigen Statuswert.
create index z_abrechnung_idx
  on zeiteintrag (mandant_id, auftrag_leistung_id, beginn_zeitpunkt)
  where freigegeben_am is not null and abgerechnet_am is null
    and storniert_am is null and ersetzt_am is null;
create index z_pruefliste_idx on zeiteintrag (mandant_id, erstellt_am)
  where freigegeben_am is null and storniert_am is null and ersetzt_am is null;
create index z_ende_idx on zeiteintrag (mandant_id, ende_zeitpunkt)
  where ende_zeitpunkt is not null;
create index z_kette_idx on zeiteintrag (kette_id, version);
create index z_aufbewahrung_idx on zeiteintrag (aufbewahrung_bis)
  where loeschsperre = false and aufbewahrung_bis is not null;

comment on table zeiteintrag is
  'Der geleistete Zeitdatensatz: § 17 MiLoG-Nachweis, Quelle von „aktuell im '
  'Einsatz" und Ursprung jeder stundenbasierten Rechnungszeile. Anfuegend; '
  'Korrekturen sind neue Fassungen (§15.6).';
comment on column zeiteintrag.geraete_zeit_beginn is
  'Die Uhr des Geraets. Getrennt gespeichert und NIE der massgebliche '
  'Zeitpunkt (Invariante 5, TIM-08).';
comment on column zeiteintrag.zeitabweichung_beginn_sek is
  'Geraet minus Server in Sekunden. Wird IMMER gespeichert — auch bei '
  'abgeschalteter zeit.abweichungsauswertung (§1.15): eine Tatsache zu '
  'speichern und sie als Leistungsmass auszuwerten sind zwei Handlungen, und '
  'nur die zweite ist mitbestimmungspflichtig.';
comment on column zeiteintrag.gesperrt_am is
  'Einziger Schreiber: z_monat_sperren auf stundenkonto (PR 37, EMP-04).';

-- ---------------------------------------------------------------------------
-- 4. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * **Die Reihenfolge steht in den Namen, weil sie Teil der Regel ist.**
 *
 * Postgres feuert Zeilenausloeser derselben Stufe alphabetisch nach ihrem
 * NAMEN. Ohne die Ziffern lief `..._dauer` vor `..._unveraenderlich`, und ein
 * verbotener UPDATE auf einem geschlossenen Eintrag scheiterte dann mit „Die
 * Pause ist laenger als die Schicht" statt mit „unveraenderlich". Beides weist
 * ab, also ist nichts falsch gespeichert — aber die Meldung fuehrt auf die
 * falsche Faehrte, und der naechste Leser sucht eine Stunde am falschen Ende.
 *
 *   1 unveraenderlich  weist ab, BEVOR gerechnet wird (nur UPDATE)
 *   2 feldzeit         setzt die massgeblichen Zeitpunkte
 *   3 erben            uebernimmt Objekt und Auftragszeile (nur INSERT)
 *   4 dauer            rechnet auf den fertigen Zeitpunkten
 *   5 geo_tor          unabhaengig, aber nach der Zeit
 *   6 zeitstempel      stempelt Storno-, Freigabe- und Abloesemarken
 */

/**
 * `kern.stempel_feldzeit()` — die Serveruhr setzt, das Geraet wird notiert.
 *
 * `DEFAULT now()` genuegt nicht: ein Default greift nur, wenn die Spalte
 * WEGGELASSEN wird. Ein INSERT, der einen Wert mitschickt, schriebe einen
 * beliebigen Zeitpunkt — und die Unveraenderlichkeitsregel darunter machte
 * ihn danach dauerhaft. Deshalb wird bei `quelle = 'server_uhr'` der
 * mitgeschickte Wert VERWORFEN und durch `now()` ersetzt.
 *
 * Bei `planer_entscheidung` und `import` bleibt der Wert stehen: dort IST die
 * Entscheidung eines benannten Menschen die Quelle, und sie ist durch eine
 * `zeiteintrag_korrektur`-Zeile belegt (§1.8) — die Bedingung
 * `z_quelle_*_belegt` erzwingt zumindest die Nacherfassungsflagge schon hier.
 *
 * Gestempelt wird nur der UEBERGANG nach „gesetzt". Ein bereits gesetzter
 * Beginn bleibt beim UPDATE unberuehrt; ihn erneut auf `now()` zu ziehen
 * hiesse, dass jede Aenderung an einer Notiz die Schicht verschiebt.
 *
 * **Und gestempelt wird nur die ERSTE Fassung einer Kette** (`version = 1`).
 * Eine Korrektur ist eine Kopie mit geaenderten Feldern, kein zweites
 * Ereignis: die zweite Fassung einer Zeile, an der nur die Pause richtig
 * gestellt wurde, traegt denselben Beginn wie die erste — und der kam damals
 * von der Serveruhr, das aendert die Korrektur nicht. Ohne diese Unterscheidung
 * zoege jede Pausenkorrektur den Schichtbeginn auf den Zeitpunkt der Korrektur,
 * also womoeglich Wochen nach vorn, und der § 17-Nachweis waere danach falsch —
 * lautlos, denn beide Werte sehen plausibel aus.
 */
create function kern.stempel_feldzeit() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.version = 1 and new.quelle_beginn = 'server_uhr' then
      new.beginn_zeitpunkt := now();
    end if;
    if new.version = 1 and new.ende_zeitpunkt is not null
       and new.quelle_ende = 'server_uhr' then
      new.ende_zeitpunkt := now();
    end if;
  else
    -- `old` wird ausschliesslich im UPDATE-Zweig beruehrt: im INSERT-Ausloeser
    -- ist der Satz nicht zugewiesen, und schon eine Bedingung, die ein Feld
    -- davon NENNT, wirft — auch wenn der andere Teil sie erledigt haette.
    if new.ende_zeitpunkt is not null and old.ende_zeitpunkt is null
       and new.quelle_ende = 'server_uhr' then
      new.ende_zeitpunkt := now();
    end if;
  end if;

  /**
   * Die Abweichung ist Geraet MINUS Server, vorzeichenbehaftet, in Sekunden.
   *
   * Sie wird IMMER abgeleitet — Invariante 5 verlangt die Tatsache, und
   * `zeit.abweichungsauswertung` entscheidet nur, ob sie je Person AUSGEWERTET
   * werden darf (§1.15). Wer die Ableitung an den Schalter haengte, verloere
   * die Tatsache und koennte sie nicht nachtraeglich herstellen.
   */
  if new.geraete_zeit_beginn is not null then
    new.zeitabweichung_beginn_sek :=
      round(extract(epoch from (new.geraete_zeit_beginn - new.beginn_zeitpunkt)))::integer;
  end if;
  if new.geraete_zeit_ende is not null and new.ende_zeitpunkt is not null then
    new.zeitabweichung_ende_sek :=
      round(extract(epoch from (new.geraete_zeit_ende - new.ende_zeitpunkt)))::integer;
  end if;

  -- Servereingang minus behaupteter Beginn — was TIM-09 „verspaetet" nennt.
  if new.behauptet_beginn is not null then
    new.nacherfassung_verzoegerung_sek :=
      round(extract(epoch from (coalesce(new.erstellt_am, now()) - new.behauptet_beginn)))::integer;
  end if;
  return new;
end $$;

comment on function kern.stempel_feldzeit() is
  'Serverzeit auf die massgebliche Spalte, Geraetezeit daneben, Abweichung '
  'abgeleitet (Invariante 5, TIM-08). Das Geschwister von '
  'kern.erzwinge_serverzeit() fuer die Tabellen mit Geraetespalten.';

create trigger trg_zeiteintrag_2_feldzeit
  before insert or update on zeiteintrag
  for each row execute function kern.stempel_feldzeit();

/**
 * `z_dauer_berechnen` — Brutto und Netto aus den beiden UTC-Zeitpunkten.
 *
 * Ausdruecklich ein Ausloeser und keine generierte Spalte: `extract(epoch
 * from …)` ist nicht `IMMUTABLE`, Postgres weist eine `GENERATED`-Spalte ab,
 * und die Arithmetik von Hand in die DDL zu schreiben legte die
 * DST-entscheidende Rechnung dorthin, wo kein Test sie erreicht. Er ruft
 * `app.dauer_minuten` — dieselbe Funktion, gegen die die Referenzfaelle
 * pruefen.
 *
 * Die Beziehung „Pause hoechstens so lang wie die Schicht" ist hier und nicht
 * als `CHECK`: sie spannt ueber eine gerechnete Spalte.
 */
create function kern.zeiteintrag_dauer_berechnen() returns trigger
language plpgsql as $$
begin
  new.dauer_brutto_minuten := app.dauer_minuten(new.beginn_zeitpunkt, new.ende_zeitpunkt);
  if new.dauer_brutto_minuten is null then
    new.dauer_netto_minuten := null;
    return new;
  end if;
  if new.pause_minuten > new.dauer_brutto_minuten then
    raise exception 'Die Pause ist laenger als die Schicht'
      using errcode = 'check_violation',
            detail  = format('Dauer %s Minuten, Pause %s Minuten.',
                             new.dauer_brutto_minuten, new.pause_minuten),
            hint    = 'Pause korrigieren oder das Schichtende pruefen.';
  end if;
  new.dauer_netto_minuten := new.dauer_brutto_minuten - new.pause_minuten;
  return new;
end $$;

create trigger trg_zeiteintrag_4_dauer
  before insert or update on zeiteintrag
  for each row execute function kern.zeiteintrag_dauer_berechnen();

/**
 * `z_erben` — Objekt, Auftragszeile, Revier, Posten und Projekt kommen von der
 * Schicht, wenn der Aufrufer sie nicht nennt (TIM-12).
 *
 * Ohne diese Vererbung braeuchte es eine manuelle Uebertragung von der Zeit
 * zur Abrechnung — genau das, was FIN-07 nicht haben will.
 */
create function kern.zeiteintrag_erben() returns trigger
language plpgsql as $$
declare e record;
begin
  if new.einsatz_id is null then return new; end if;
  select objekt_id, auftrag_leistung_id, revier_id, posten_id, projekt_id
    into e
    from einsatz
   where id = new.einsatz_id and mandant_id = new.mandant_id;
  if not found then
    raise exception 'Die Schicht dieses Zeiteintrags gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;
  new.objekt_id           := coalesce(new.objekt_id, e.objekt_id);
  new.auftrag_leistung_id := coalesce(new.auftrag_leistung_id, e.auftrag_leistung_id);
  new.revier_id           := coalesce(new.revier_id, e.revier_id);
  new.posten_id           := coalesce(new.posten_id, e.posten_id);
  new.projekt_id          := coalesce(new.projekt_id, e.projekt_id);
  return new;
end $$;

create trigger trg_zeiteintrag_3_erben
  before insert on zeiteintrag
  for each row execute function kern.zeiteintrag_erben();

/**
 * `z_geo_gate` — LEG-10, gesperrt auf O-06 (§1.15, §9.5).
 *
 * Solange `zeit.geolokalisierung` nicht ausdruecklich `true` ist, muessen alle
 * sechs Koordinatenspalten NULL und beide Statusspalten `deaktiviert` sein;
 * andernfalls wirft der Ausloeser. Das Schema WEIGERT sich also, Ortsdaten
 * anzusammeln, solange die Mitbestimmungsfrage offen ist — es genuegt nicht,
 * sie in der Oberflaeche nicht abzufragen.
 *
 * **Gelesen wird die ZWEIARGUMENTIGE Form**, und das ist eine bewusste
 * Aufloesung eines Widerspruchs: `04-PLANUNG-ZEIT.md` §5.6 schreibt
 * `app.einstellung('zeit.geolokalisierung')`, `01-KERN.md` §3.2 — der
 * Eigentuemer der Funktion — verbietet die einargumentige Form ausdruecklich
 * in Ausloesern und mandantenlosen Kontexten. Genau so einer ist dieser: der
 * Check-in-Pfad hat keine Sitzung, `app.aktiver_mandant()` ist dort NULL, die
 * einargumentige Form lieferte NULL, und die Einstellung waere fuer den
 * einzigen Pfad, der Punkte erfassen kann, dauerhaft unwirksam. Wo Dokument
 * und Konvention auseinandergehen, gilt die Konvention (§0).
 */
create function kern.zeiteintrag_geo_tor() returns trigger
language plpgsql as $$
declare v_an boolean := coalesce(
  (app.einstellung(new.mandant_id, 'zeit.geolokalisierung'))::boolean, false);
begin
  if v_an then return new; end if;

  if new.geo_beginn_lat is not null or new.geo_beginn_lon is not null
     or new.geo_beginn_genauigkeit_m is not null
     or new.geo_ende_lat is not null or new.geo_ende_lon is not null
     or new.geo_ende_genauigkeit_m is not null
     or new.geo_beginn_status <> 'deaktiviert'
     or new.geo_ende_status <> 'deaktiviert' then
    raise exception 'Geolokalisierung ist fuer diese Gesellschaft nicht eingeschaltet'
      using errcode = 'check_violation',
            detail  = 'LEG-10 haengt an O-06 (§ 87 Abs. 1 Nr. 6 BetrVG); '
                      || 'Der Schluessel zeit.geolokalisierung in mandant_einstellung steht auf false.',
            hint    = 'Ohne Schalter werden keine Koordinaten gespeichert — '
                      || 'auch nicht mit Status verweigert oder nicht_verfuegbar.';
  end if;
  return new;
end $$;

create trigger trg_zeiteintrag_5_geo_tor
  before insert or update on zeiteintrag
  for each row execute function kern.zeiteintrag_geo_tor();

/**
 * `z_unveraenderlich` — sobald der Eintrag nicht mehr `laufend` ist, aendert
 * sich keine Zeit, keine Pause, keine Person und kein Auftragsbezug mehr
 * (TIM-11, Invariante 8, §16 Nr. 5).
 *
 * Eine Positivliste und keine Negativliste: eine Spalte, die eine spaetere
 * Migration ergaenzt, ist damit standardmaessig GESPERRT. Andersherum waere
 * jede neue Spalte standardmaessig aenderbar, und niemand bemerkte es.
 */
create function kern.zeiteintrag_unveraenderlich() returns trigger
language plpgsql as $$
declare
  -- Was sich an einem geschlossenen Eintrag noch bewegen darf: die
  -- Ablosekette, der Status vorwaerts, die vier Verwaltungsmarken und die
  -- Stornospur. KEINE Zeit, KEINE Pause, KEINE Zuordnung.
  v_verboten text[] := array[]::text[];
begin
  if old.status = 'laufend' then
    return new;
  end if;

  if new.beginn_zeitpunkt is distinct from old.beginn_zeitpunkt then
    v_verboten := array_append(v_verboten, 'beginn_zeitpunkt');
  end if;
  if new.ende_zeitpunkt is distinct from old.ende_zeitpunkt then
    v_verboten := array_append(v_verboten, 'ende_zeitpunkt');
  end if;
  if new.pause_minuten is distinct from old.pause_minuten then
    v_verboten := array_append(v_verboten, 'pause_minuten');
  end if;
  if new.anstellung_id is distinct from old.anstellung_id then
    v_verboten := array_append(v_verboten, 'anstellung_id');
  end if;
  if new.person_id is distinct from old.person_id then
    v_verboten := array_append(v_verboten, 'person_id');
  end if;
  if new.einsatz_id is distinct from old.einsatz_id then
    v_verboten := array_append(v_verboten, 'einsatz_id');
  end if;
  if new.einsatz_zuordnung_id is distinct from old.einsatz_zuordnung_id then
    v_verboten := array_append(v_verboten, 'einsatz_zuordnung_id');
  end if;
  if new.objekt_id is distinct from old.objekt_id then
    v_verboten := array_append(v_verboten, 'objekt_id');
  end if;
  if new.auftrag_leistung_id is distinct from old.auftrag_leistung_id then
    v_verboten := array_append(v_verboten, 'auftrag_leistung_id');
  end if;
  if new.geraete_zeit_beginn is distinct from old.geraete_zeit_beginn then
    v_verboten := array_append(v_verboten, 'geraete_zeit_beginn');
  end if;
  if new.geraete_zeit_ende is distinct from old.geraete_zeit_ende then
    v_verboten := array_append(v_verboten, 'geraete_zeit_ende');
  end if;
  if new.kette_id is distinct from old.kette_id then
    v_verboten := array_append(v_verboten, 'kette_id');
  end if;
  if new.version is distinct from old.version then
    v_verboten := array_append(v_verboten, 'version');
  end if;

  if array_length(v_verboten, 1) is not null then
    raise exception 'Ein abgeschlossener Zeiteintrag ist unveraenderlich'
      using errcode = 'check_violation',
            detail  = format('Gesperrte Spalten: %s.', array_to_string(v_verboten, ', ')),
            hint    = 'Korrektur ist eine NEUE Fassung mit zeiteintrag_korrektur '
                      || '(TIM-11), kein UPDATE am Beleg.';
  end if;

  -- Ein Status geht nur vorwaerts. `abgeschlossen` → `laufend` waere ein
  -- geschlossener Eintrag, der wieder offen ist — und der z_offen_uk-Index
  -- liesse dann eine zweite offene Zeile derselben Beschaeftigung zu.
  if old.status <> 'laufend' and new.status = 'laufend' then
    raise exception 'Ein Zeiteintrag wird nicht wieder laufend'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_zeiteintrag_1_unveraenderlich
  before update on zeiteintrag
  for each row execute function kern.zeiteintrag_unveraenderlich();

/**
 * Ereigniszeitpunkte gehoeren dem Server (Invariante 5). Eigene Funktion je
 * Tabelle, weil `kern.erzwinge_serverzeit()` auf `eingegangen_am`
 * festgeschrieben ist und ein Ausloeser keine Spaltennamen als Argument nimmt.
 */
create function kern.zeiteintrag_zeitstempel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.storniert_am is not null then new.storniert_am := now(); end if;
    if new.freigegeben_am is not null then new.freigegeben_am := now(); end if;
    return new;
  end if;
  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;
  if new.freigegeben_am is not null and old.freigegeben_am is null then
    new.freigegeben_am := now();
  end if;
  if new.ersetzt_am is not null and old.ersetzt_am is null then
    new.ersetzt_am := now();
  end if;
  return new;
end $$;

create trigger trg_zeiteintrag_6_zeitstempel
  before insert or update on zeiteintrag
  for each row execute function kern.zeiteintrag_zeitstempel();

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz — zeiteintrag (§1.3, §1.4)
-- ---------------------------------------------------------------------------

alter table zeiteintrag enable row level security;
alter table zeiteintrag force  row level security;

create policy t_mandant on zeiteintrag for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on zeiteintrag for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/**
 * /portal/mein, Scope `person` (EMP-03, EMP-14, EMP-15) — NUR lesend.
 *
 * Vier Eigenschaften machen das sicher, und alle vier sind baulich statt
 * versprochen: die Policy kennt kein Schreib-Gegenstueck; sie trifft nur
 * Zeilen, deren Subjekt der Aufrufer IST (`app.person_id` ist eine
 * serverseitig gesetzte GUC, K-02); diese Tabelle traegt keine einzige
 * Geldspalte (§1.5); und die K-04-Decke gilt zusaetzlich obendrauf.
 *
 * EMP-07 ist kategorisch: der Mensch schreibt NIE seinen eigenen Zeiteintrag,
 * auch nicht seinen eigenen. Er schreibt einen `zeit_einwand` (PR 36) — und
 * dieser Policy laesst sich kein Schreibzweig hinzufuegen, ohne dass es
 * jemandem auffaellt.
 */
create policy t_person on zeiteintrag for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and person_id = app.aktuelle_person());

/**
 * KEIN `t_kunde`: Stunden sind ein Beschaeftigungsdatensatz, kein
 * Kundendokument (EMP-13).
 */
create policy p_ma_decke on zeiteintrag as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
create policy p_kunde_decke on zeiteintrag as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Die zwei K-08-Definerpolicies, und sie sind SCHMAL (§1.1).
 *
 * Der Check-in-Pfad hat keine Sitzung, also keine GUCs, also ist jede
 * K-03-Policy fuer ihn falsch — ohne eigene Policy schriebe er nichts. Die
 * `WITH CHECK` sagen, WAS er schreiben darf: eine Zeile OEFFNEN, nie eine
 * schliessen, und beim Schliessen nur mit Serverzeit. Damit kann eine
 * Marke keinen nacherfassten Datensatz erzeugen, und eine
 * Nacherfassungsfunktion keinen Markenstempel vortaeuschen.
 */
create policy z_definer_insert on zeiteintrag as permissive for insert to cse_definer
  with check (erfassungsart_beginn = 'checkin_token'
              and quelle_beginn = 'server_uhr'
              and ende_zeitpunkt is null);

create policy z_definer_update on zeiteintrag as permissive for update to cse_definer
  using      (ende_zeitpunkt is null and storniert_am is null and ersetzt_am is null)
  with check (quelle_ende = 'server_uhr' and erfassungsart_ende = 'checkin_token');

create policy z_definer_lesen on zeiteintrag for select to cse_definer using (true);

/**
 * Die Waechter lesen (stuendlich „Schicht vorbei, kein Zeiteintrag"), und
 * `job:aufbewahrung` traegt Fristen ein — auch an stornierten Zeilen, denn
 * gerade deren Frist laeuft einmal ab. Wer wie lange gearbeitet hat,
 * entscheidet dagegen kein Nachtlauf: dafuer gibt es hier keinen Grant.
 */
create policy t_job on zeiteintrag for select to cse_job using (true);
create policy t_job_frist on zeiteintrag for update to cse_job using (true) with check (true);

grant select, insert, update on zeiteintrag to cse_app;
grant select, insert, update on zeiteintrag to cse_definer;
grant select on zeiteintrag to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on zeiteintrag to cse_job;

-- ---------------------------------------------------------------------------
-- 6. Fremdschluessel, die eine spaetere Migration nachtraegt (§19)
-- ---------------------------------------------------------------------------

/**
 * Fuenf Elternteile existieren heute nicht: `auftrag_leistung`
 * (02-CRM-OPERATIONS), `posten` und `projekt` (03-GEWERKE), `offline_ereignis`
 * (PR 35) und `rechnungsposition` (Phase 6). Die SPALTEN stehen oben, die
 * Fremdschluessel nicht — ein einspaltiger Fremdschluessel auf eine Tabelle
 * mit `mandant_id` ist nach K-16 ein Pruefungsfehler, und lieber gar keiner
 * als der falsche. Wortwoertlich diese Anweisungen (§14.4):
 *
 *   alter table zeiteintrag add constraint z_leistung_fk
 *     foreign key (mandant_id, auftrag_leistung_id)
 *     references auftrag_leistung (mandant_id, id);
 *   alter table zeiteintrag add constraint z_posten_fk
 *     foreign key (mandant_id, posten_id) references posten (mandant_id, id);
 *   alter table zeiteintrag add constraint z_projekt_fk
 *     foreign key (mandant_id, projekt_id) references projekt (mandant_id, id);
 *   alter table zeiteintrag add constraint z_offline_fk
 *     foreign key (mandant_id, offline_ereignis_id)
 *     references offline_ereignis (mandant_id, id);
 *
 * `abrechnung_referenz` bekommt seinen Fremdschluessel in Phase 6 (§19).
 * `checkin_token_id` / `checkout_token_id` bekommen ihn in 0035, sobald die
 * Marke existiert — dieselbe Migration schliesst den Kreis in beide
 * Richtungen.
 */

-- ---------------------------------------------------------------------------
-- 7. Sicht: „Aktuell im Einsatz" (DSH-05, §14.2)
-- ---------------------------------------------------------------------------

/**
 * `security_invoker = true`, und das ist nicht Kosmetik (§1.11, §16 Nr. 8).
 *
 * Eine Sicht laeuft sonst mit den Rechten IHRES EIGENTUEMERS und dessen
 * RLS-Befreiung — hier waere das ein vollstaendiger mandantenuebergreifender
 * Durchgriff auf die Stunden aller vier Gesellschaften, durch genau den
 * Mechanismus, den diese Domaene sonst muehsam verschliesst.
 *
 * Die Kachel zaehlt diese Sicht, und der Test vergleicht ihre Zahl mit einem
 * direkten `count(*)` ueber dieselbe Bedingung: zwei Quellen fuer eine Aussage
 * driften, und eine Kachel, die etwas anderes sagt als die Liste darunter,
 * ist schlimmer als keine.
 */
create view zeiteintrag_offen with (security_invoker = true) as
select z.id, z.mandant_id, z.anstellung_id, z.person_id,
       z.einsatz_id, z.objekt_id, z.beginn_zeitpunkt,
       z.erfassungsart_beginn, z.quelle_beginn
  from zeiteintrag z
 where z.ende_zeitpunkt is null
   and z.storniert_am is null
   and z.ersetzt_am is null
   and z.status = 'laufend';

comment on view zeiteintrag_offen is
  'DSH-05 „Aktuell im Einsatz". security_invoker, damit die Sicht die RLS des '
  'Aufrufers erbt und nicht die Befreiung ihres Eigentuemers (§1.11).';

grant select on zeiteintrag_offen to cse_app;

-- ---------------------------------------------------------------------------
-- 8. app.einsatz_hat_zeiterfassung — der Rumpf aus 0032 wird ersetzt
-- ---------------------------------------------------------------------------

/**
 * 0032 hat diese Funktion mit dem Rumpf `select false` angelegt und die
 * Ersetzung ausdruecklich hierher verwiesen: „PR 34 ersetzt den Rumpf in
 * derselben Migration, die `zeiteintrag` anlegt — und ein Test dort haelt
 * fest, dass sie es tat."
 *
 * Der Generator fragt sie, bevor er eine Schicht veraendert (§8.2 Schritt 7).
 * Bliebe der Rumpf stehen, liefe der Generator weiter, meldete keinen Fehler —
 * und ueberschriebe eine Schicht, auf der bereits jemand gearbeitet hat.
 * Genau deshalb war der Rumpf eine Funktion und keine weggelassene Bedingung:
 * eine weggelassene Bedingung haette niemand wiedergefunden.
 *
 * `stable` und nicht `immutable`: sie liest eine Tabelle.
 *
 * **Und `security definer`, obwohl 0032 sie ohne angelegt hat.** Ohne wuerde
 * sie unter der RLS des Aufrufers laufen — und eine Rolle, die auf
 * `zeiteintrag` keine Policy trifft, bekaeme `false` zurueck. Das ist die
 * falsche Richtung: `false` heisst „darfst du ueberschreiben". Ein Waechter,
 * der bei fehlender Sicht mit „alles frei" antwortet, ist schlimmer als
 * keiner. Sie sieht deshalb alle Zeilen und gibt nur einen BOOLEAN heraus —
 * kein Mandant, keine Person, keine Zeit.
 */
create or replace function app.einsatz_hat_zeiterfassung(p_einsatz uuid)
returns boolean
language sql
stable
parallel safe
security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.zeiteintrag t
                  where t.einsatz_id = p_einsatz and t.storniert_am is null);
$$;

comment on function app.einsatz_hat_zeiterfassung(uuid) is
  'Haengt an dieser Schicht eine nicht stornierte Zeiterfassung? Seit 0034 die '
  'echte Abfrage — 0032 hielt die Signatur mit einem Rumpf offen, der ein '
  'Fakt war (es gab keine Tabelle), keine Annahme.';

grant execute on function app.einsatz_hat_zeiterfassung(uuid) to cse_app, cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0034)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- zeiteintrag (archiv): LEG-02, § 17 MiLoG, GoBD. Das ist der Nachweis der geleisteten Zeit — die Zeile, die im Lohnstreit vorgelegt und aus der die Rechnung abgeleitet wird. Ein geloeschter Zeiteintrag ist eine Stunde, die niemand mehr belegen oder widerlegen kann; zurueckgenommen wird er durch storniert_am mit Grund, korrigiert durch eine neue Fassung.
create trigger trg_zeiteintrag_kein_hard_delete
  before delete on zeiteintrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zeiteintrag_kein_truncate
  before truncate on zeiteintrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeiteintrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_zeiteintrag_geaendert_am
  before update on zeiteintrag
  for each row execute function kern.setze_geaendert_am();

create trigger trg_zeiteintrag_audit
  after insert or update or delete on zeiteintrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
