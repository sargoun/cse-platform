-- ===========================================================================
-- 0040 — Konflikt- und ArbZG-Pruefung ueber Entitaeten hinweg
--        (K-06, TIM-05, TIM-06, TIM-14, LEG-03, LEG-04, D-09, SEC-A3, SEC-A9)
--
-- Vertrag: `docs/architecture/02-datenmodell/04-PLANUNG-ZEIT.md` §3, §5.10,
-- §5.11, §5.12 und §6 ganz; `00-KONVENTIONEN.md` K-06 (die EINE erlaubte
-- Mandantenueberschreitung), K-01, K-03, K-04, K-16, K-18/K-20, K-19.
-- Wo dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die
-- Konvention.
--
-- WORUM ES GEHT, in einem Satz: ein Mensch mit einer 6-Stunden-Reinigungs- und
-- einer 5-Stunden-Sicherheitsschicht am selben Berliner Kalendertag hat elf
-- Stunden gearbeitet, und die Plattform muss das MERKEN — obwohl die beiden
-- Zeilen in zwei Gesellschaften liegen, die einander nach K-03 nicht sehen
-- duerfen.
--
-- Die naheliegende Abfrage ist hier die gefaehrliche (§6.1): unter RLS liefert
-- `select … from einsatz where person_id = X` nur die Schichten des aktiven
-- Mandanten, der Detektor findet 6 Stunden, meldet „kein Konflikt" — und die
-- Plattform liefert eine gesetzlich verlangte Pruefung aus, die IMMER besteht.
-- Niemandem faellt es auf, denn eine Pruefung, die nichts findet, sieht aus wie
-- ein sauberer Plan. Deshalb gibt es genau EINE sanktionierte Ueberschreitung,
-- und sie ist eng, protokolliert und getestet (K-06).
--
--   zeit_intern.arbeitszeit_fenster   Die eine bewusst mandantenuebergreifende
--                                     Relation der Plattform: je Zuordnung eine
--                                     Zeile aus Beginn, Ende, Pause, Person —
--                                     KEIN Objekt, KEIN Kunde, KEIN Entgelt,
--                                     KEIN Freitext. Diese Abwesenheit IST die
--                                     Sicherheitsmassnahme: was die Tabelle
--                                     nicht traegt, kann auch ein Fehler im
--                                     Leser nicht verraten (§5.12).
--   arbeitszeit_verstoss              Der ArbZG-Befund, je beteiligter
--                                     Gesellschaft einmal gespiegelt (§5.11).
--   planungs_konflikt                 Die zwei mandantenlokalen Klassen aus
--                                     TIM-05 plus die §17-MiLoG-Frist (§5.10).
--   app.arbzg_belastung(…)            Der Leser. Gibt DAUERN UND GRENZEN
--                                     zurueck und sonst nichts (§6.3).
--   app.arbzg_befund_schreiben(…)     Der einzige Schreiber der Befunde (§6.6).
--
-- Fuenf Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **`zeit_intern.arbeitszeit_fenster` hat KEINE Policy fuer `cse_app` und
--     KEIN `GRANT SELECT`** — und das ist kein Versehen, das jemand nachtragen
--     soll. Die Tabelle ist der einzige Ort der Plattform, an dem die Zeiten
--     aller vier Gesellschaften nebeneinander liegen. Sie ist ueber genau zwei
--     Tueren erreichbar: die Definer-Ausloeser der Projektion und die Leser aus
--     §6.3/§6.4. Eine „nur lesende" Policy fuer `cse_app` waere die
--     Ueberschreitung, gegen die K-06 geschrieben wurde — und sie liesse sich
--     aus keinem Testergebnis erkennen, weil sie NICHTS kaputt macht.
--
--  2. **`zuordnung_quelle_id` bekommt niemals einen Fremdschluessel.** Die
--     Haelfte seiner Werte sind `zeiteintrag`-Ids (ungeplante Arbeit hat keine
--     Zuordnung, §6.2), ein BEDINGTER Fremdschluessel existiert in Postgres
--     nicht, und einen zuzusagen hiesse, eine Migration zu hinterlassen, die
--     nicht laeuft. Die Integritaet haelt stattdessen `job:arbzg_fenster_abgleich`
--     (§14.3): er leitet die Projektion naechtlich neu her und MELDET ein
--     Fenster, dessen Quelle verschwunden ist, als Fehler — er repariert nie
--     still.
--
--  3. **`arbeitszeit_verstoss` hat KEINE INSERT-Policy fuer `cse_app`.** Ein
--     Befund ueber zwei Gesellschaften muss in BEIDEN stehen, damit ihn beide
--     Planungen sehen; eine auf Mandant A verengte Anfrage kann in Mandant B
--     nichts schreiben. Der Standard-`WITH CHECK` aus K-03 machte die
--     Vorzeigeanforderung TIM-14 unbaubar. Geschrieben wird nur ueber
--     `app.arbzg_befund_schreiben` (§6.6).
--
--  4. **`fenster_ende_idx` traegt KEIN `and ende_utc is not null`.** Der
--     Entwurf hatte es; §5.12 streicht es ausdruecklich. Eine Kraft, die seit
--     gestern eingestempelt ist, waere fuer die Ruhezeitpruefung nach §5 ArbZG
--     unsichtbar gewesen — und das ist die eine Richtung, die niemals ein
--     sauberes Ergebnis vortaeuschen darf.
--
--  5. **Fensterzeilen werden ENTWERTET, nie geloescht** (`aktiv = false`). Eine
--     Wartungspanne soll als VERALTETES Fenster sichtbar werden — falsch, aber
--     auffaellig — und nicht als fehlendes, das niemand vermisst.
--
-- NICHT in dieser Migration, weil ihre Gegenstelle noch nicht existiert:
-- `zeiteintrag` (PR 34) und damit der dritte Projektionsausloeser
-- `z_fenster_projizieren`, die `ist`-Seite der Supersede-Regel, die
-- zusammengesetzten Fremdschluessel auf `zeiteintrag` und
-- `zeit_intern.offline_eingang` (§5.13). Sie stehen als auskommentierte
-- Bloecke in Abschnitt 6 und 16, jeder mit der Migration benannt, die ihn
-- nachtraegt — dieselbe Form, in der 0028 seine offenen Fremdschluessel
-- hinterlassen hat.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Schema `zeit_intern` und wer es ueberhaupt betreten darf
-- ---------------------------------------------------------------------------

/**
 * `01-KERN.md` §0 legt das Schema bereits an (0000_baseline). Die Zeile steht
 * trotzdem hier: diese Migration ist die erste, die etwas HINEIN legt, und ein
 * `if not exists` kostet nichts, waehrend eine fehlende Zeile die ganze
 * Migration an einer Umgebung scheitern liesse, in der 0000 aelter ist.
 */
create schema if not exists zeit_intern;

/**
 * USAGE bekommen `cse_definer` und `cse_job` — und sonst NIEMAND.
 *
 * 0001 vergibt `usage on schema public, app, kern` an alle fuenf
 * Anwendungsrollen und laesst `zeit_intern` bewusst aus. Das bleibt so:
 * `cse_app` darf dieses Schema nicht einmal betreten, sonst koennte es
 * `zeit_intern.fenster_setzen(…)` mit frei gewaehlten Argumenten aufrufen und
 * sich ArbZG-Fenster ERFINDEN — die Manipulation, gegen die die ganze
 * Konstruktion steht. Genau deshalb sind die Projektionsausloeser unten
 * `security definer`: so braucht die schreibende Sitzung hier kein Recht.
 *
 * `cse_job` braucht USAGE fuer `zeit_intern.arbzg_belastung_job` (§6.4) und
 * fuer `job:arbzg_fenster_abgleich` (§14.3).
 */
grant usage on schema zeit_intern to cse_definer, cse_job;

-- ---------------------------------------------------------------------------
-- 2. Aufzaehlungstypen (§3.1)
-- ---------------------------------------------------------------------------

/**
 * K-06 legt diese zwei Werte und ihre Bedeutung fest.
 *
 * `plan` — was geplant ist (aus `einsatz_zuordnung`).
 * `ist`  — was gearbeitet wurde (aus `zeiteintrag`, PR 34).
 *
 * Beide Zeilen tragen dieselbe `zuordnung_quelle_id`; das ist es, was die
 * Supersede-Regel aus §6.2 ueberhaupt adressierbar macht.
 */
create type fenster_quelle as enum ('plan','ist');

/**
 * Die sechs Regeln des Arbeitszeitgesetzes, die diese Plattform prueft.
 *
 * §3 ArbZG (8 h Regel, 10 h Ausnahme), §4 ArbZG (30 min ueber 6 h, 45 min
 * ueber 9 h), §5 ArbZG (11 h Ruhezeit), §3 Satz 2 (Ausgleichszeitraum).
 *
 * Die Werte sind ZEICHENGLEICH mit `ARBZG_REGELN` in
 * `src/server/services/zeit/arbzg.ts` — dem reinen Pruefer aus PR 1, der die
 * Befunde bildet. Zwei Vokabulare waeren hier nicht bloss unschoen: der Pruefer
 * bildet einen Befund, `app.arbzg_befund_schreiben` nimmt ihn als
 * `arbzg_regel`, und ein Wert, den der Typ nicht kennt, liesse den Befund
 * GAR NICHT speichern — die Verletzung ist erkannt und verschwindet trotzdem.
 *
 * `ausgleichszeitraum_ueberschritten` ist nur im Nachtlauf berechenbar (§6.4,
 * §6.7) und bleibt abgeschaltet, solange der Ausgleichszeitraum nicht benannt
 * ist: ueber einen unbekannten Zeitraum zu mitteln hiesse, die Regel zu
 * erfinden, die das Gesetz dem Tarifvertrag ueberlaesst.
 * // TODO(client, O-18): Wird die Verlaengerung auf zehn Stunden nach §3 Satz 2
 * ArbZG genutzt, und ueber welchen Ausgleichszeitraum — sechs Kalendermonate
 * oder 24 Wochen?
 */
create type arbzg_regel as enum ('tagesarbeitszeit_ueber_8h','tagesarbeitszeit_ueber_10h',
                                 'ruhezeit_unter_11h','pause_fehlt_ueber_6h','pause_fehlt_ueber_9h',
                                 'ausgleichszeitraum_ueberschritten');

/**
 * Drei Schweregrade, zeichengleich mit `VERSTOSS_SCHWEREN` in
 * `src/server/services/zeit/arbzg.ts` — aus demselben Grund wie oben.
 *
 * Der Unterschied ist rechtlich und nicht kosmetisch: eine Ueberschreitung der
 * acht Stunden IST bei konfigurierter Verlaengerung nach §3 Satz 2 keine
 * Zuwiderhandlung, sondern eine ausgleichspflichtige Tatsache — `warnung`.
 * Ohne Verlaengerung ist dieselbe Zahl ein `verstoss`.
 */
create type verstoss_schwere as enum ('hinweis','warnung','verstoss');

/**
 * TIM-05 nennt genau drei Konfliktklassen; die vierte ist die
 * Aufzeichnungsfrist aus §17 MiLoG (§10.4).
 *
 * `arbzg` ist hier ein ZEIGER, keine Kopie: der Befund selbst liegt in
 * `arbeitszeit_verstoss`, weil er ueber Gesellschaften gespiegelt werden muss
 * und deshalb einen anderen Schreibpfad braucht als ein Konflikt, der diese
 * Gesellschaft nie verlassen darf.
 */
create type konflikt_art as enum ('ueberschneidung','qualifikation_entfallen','arbzg',
                                  'aufzeichnungsfrist');

/**
 * Ein Konflikt wird QUITTIERT oder er wird HINFAELLIG — geloescht wird er nie
 * (Invariante 8). `hinfaellig` ist der Zustand, in den ihn eine Planaenderung
 * versetzt, die ihn aufgeloest hat.
 *
 * `arbeitszeit_verstoss` teilt dieses Vokabular, damit EIN Abzeichen-Bauteil
 * beide zeichnet (§5.11).
 */
create type konflikt_status as enum ('offen','quittiert','behoben','hinfaellig');

/**
 * Woher der Befund kommt. `planung_live` ist der Pfad, der den Planer WARNT,
 * bevor er speichert (§6.5); `detektor_job` ist der Nachtlauf, ueber den eine
 * Aenderung in Gesellschaft A ueberhaupt erst in den Plan von B gelangt, ohne
 * dass A von B weiss (§6.4).
 *
 * Der Entwurfswert `plan_uebernahme` auf `zeitquelle` ist geloescht (§3.2):
 * einen geplanten Zeitpunkt in einen Arbeitszeitnachweis zu kopieren ist genau
 * das, was Invariante 5 verbietet.
 */
create type erkennung_quelle as enum ('planung_live','detektor_job','import');

-- ---------------------------------------------------------------------------
-- 3. zeit_intern.arbeitszeit_fenster (§5.12, K-06)
-- ---------------------------------------------------------------------------

/**
 * Die eine bewusst mandantenuebergreifende Relation der Plattform.
 *
 * Der Schluessel ist `person_id`, und das ist keine Optimierung (K-06): ArbZG
 * aggregiert je MENSCH ueber Gesellschaften hinweg (D-09). Der naheliegende
 * Weg — Person → `anstellung` → `einsatz_zuordnung` innerhalb der
 * Definer-Funktion aufzuloesen — erreicht ein `ist`-Fenster, das aus einem
 * `zeiteintrag` OHNE Zuordnung entstanden ist, ueberhaupt nicht und zaehlt
 * geleistete Zeit still zu niedrig. Das ist die K-06-Fehlerart selbst: die
 * Pruefung meldet „kein Konflikt", und ein unzulaessiger Tag wird geplant.
 */
create table zeit_intern.arbeitszeit_fenster (
  id uuid primary key default gen_random_uuid(),

  /**
   * Die `einsatz_zuordnung`, aus der dieses Fenster stammt — getragen von der
   * `plan`-Zeile UND von der `ist`-Zeile. Genau das macht die Supersede-Regel
   * adressierbar.
   *
   * KEIN FREMDSCHLUESSEL, NIE (§5.12, §6.2, §19). Bei ungeplanter Arbeit gibt
   * es keine Zuordnung; §6.2 fuellt die Spalte dann mit der `zeiteintrag.id` —
   * der eigenen Identitaet —, damit der Deduplizierungsschluessel in JEDEM Fall
   * total ist. Ein Fremdschluessel auf `einsatz_zuordnung` waere in dem Moment
   * nicht mehr anlegbar, in dem der erste Ruf-Einsatz erfasst wird, und einen
   * BEDINGTEN Fremdschluessel gibt es in Postgres nicht. Die Integritaet
   * behauptet stattdessen `job:arbzg_fenster_abgleich` (§14.3), der ein
   * Fenster ohne aufloesbare Quelle als Fehler MELDET.
   */
  zuordnung_quelle_id uuid not null,

  quelle    fenster_quelle not null,

  /**
   * Die `einsatz_zuordnung.id` oder `zeiteintrag.id`, die diese Zeile spiegelt.
   * `unique (quelle, quelle_id)` macht den Wartungsausloeser zu einem schlichten
   * `on conflict … do update` ohne Ersatzschluesselsuche.
   */
  quelle_id uuid not null,

  /**
   * Die `ist`-Zeile entwertet ihre `plan`-Zeile in DERSELBEN Anweisung (K-06,
   * §6.2). Ebenfalls `false`, wenn die Quelle storniert, entfernt oder ersetzt
   * wurde.
   */
  aktiv boolean not null default true,

  -- Der Abfrageschluessel. `person`, nicht `anstellung` — D-09.
  person_id uuid not null references person(id),

  /**
   * Aus welcher Gesellschaft das Fenster stammt. Wird AUSSCHLIESSLICH benutzt,
   * um „eigene Schicht oder fremde" zu beantworten, und NIE zurueckgegeben
   * (§6.3). Das ist es, was die Ueberschreitung eng haelt.
   */
  mandant_id uuid not null references mandant(id),

  -- Nie an einen Aufrufer aus einer anderen Gesellschaft zurueckgegeben.
  anstellung_id uuid not null,

  /**
   * K-06 benennt diese zwei Spalten woertlich `beginn_utc`/`ende_utc` — anders
   * als die Mandantentabellen, die nach `03-GEWERKE.md` §2.1
   * `beginn_zeitpunkt`/`ende_zeitpunkt` heissen (§0.4). Zwei Schemata treffen
   * hier aufeinander, beide von aussen gesetzt; ein drittes zu erfinden
   * garantierte, dass eines von dreien in jedem spaeter geschriebenen Join
   * falsch ist.
   *
   * `ende_utc` ist NULL, solange ein Zeiteintrag laeuft. §6.7 sagt, wie ein
   * offenes Fenster zu behandeln ist: fuer die Tagesregeln auf `now()` gekappt,
   * fuer die Ruhezeitregel bedeutet es „die Ruhezeit hat noch nicht begonnen" —
   * ein `hinweis`, niemals ein sauberes Bestehen.
   */
  beginn_utc timestamptz not null,
  ende_utc   timestamptz,

  pause_minuten integer not null default 0,

  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz,

  /**
   * Die Beschaeftigung gehoert zu der Gesellschaft, die diese Zeile nennt.
   * Zusammengesetzt und nicht einspaltig (K-16): ein einspaltiger Verweis
   * liesse ein Fenster der Reinigung eine Beschaeftigung der Security nennen,
   * und die Provenienz, wegen der die Spalte ueberhaupt existiert, waere
   * wertlos.
   */
  constraint fenster_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),

  constraint fenster_pause_nicht_negativ check (pause_minuten >= 0),

  /**
   * `>=` und nicht `>`: eine Zeile mit gleichem Beginn und Ende ist moeglich
   * (sofortiges Aus- nach Einstempeln) und ist Beweis, den die Datenbank nicht
   * zurueckweisen darf. Abgewiesen wird nur das Unmoegliche — ein Ende VOR dem
   * Beginn. Negative Dauern faengt der Leser ohnehin mit `greatest(0, …)` (§6.3).
   */
  constraint fenster_ende_nach_beginn check (ende_utc is null or ende_utc >= beginn_utc)
);

-- Der Schluessel, auf dem `on conflict … do update` in §6.2 steht.
create unique index fenster_quelle_uk
  on zeit_intern.arbeitszeit_fenster (quelle, quelle_id);

/**
 * DER Index. Die ganze Frage des Detektors lautet „alle Fenster der Person X
 * zwischen t1 und t2" — OHNE Mandantenpraedikat —, und dieser Index beantwortet
 * sie mit einem Bereichsscan, gleichgueltig fuer wie viele Gesellschaften der
 * Mensch arbeitet.
 */
create index fenster_person_idx
  on zeit_intern.arbeitszeit_fenster (person_id, beginn_utc) where aktiv;

/**
 * Der Rueckblick fuer die Ruhezeit nach §5 ArbZG.
 *
 * BEWUSST OHNE `and ende_utc is not null`. Der Entwurf hatte den Zusatz; §5.12
 * streicht ihn und nennt den Grund: eine Kraft, die seit gestern eingestempelt
 * ist, waere fuer die Ruhezeitpruefung unsichtbar gewesen — der eine Fehler,
 * der ein sauberes Bestehen VORTAEUSCHT statt eines falschen Alarms.
 */
create index fenster_ende_idx
  on zeit_intern.arbeitszeit_fenster (person_id, ende_utc) where aktiv;

-- Die Supersede-Suche aus §6.2.
create index fenster_zuordnung_idx
  on zeit_intern.arbeitszeit_fenster (zuordnung_quelle_id, quelle);

-- Wartung und naechtlicher Abgleich (§14.3).
create index fenster_mandant_idx
  on zeit_intern.arbeitszeit_fenster (mandant_id, quelle, quelle_id);

comment on table zeit_intern.arbeitszeit_fenster is
  'K-06: die eine bewusst mandantenuebergreifende Relation. Kein Objekt, kein '
  'Kunde, kein Entgelt, kein Freitext — diese Abwesenheit ist die '
  'Sicherheitsmassnahme. Keine Policy und kein Grant fuer cse_app.';
comment on column zeit_intern.arbeitszeit_fenster.zuordnung_quelle_id is
  'Deduplizierungsschluessel. Bekommt NIE einen Fremdschluessel: die Haelfte '
  'seiner Werte sind zeiteintrag-Ids (ungeplante Arbeit), und einen bedingten '
  'Fremdschluessel gibt es in Postgres nicht (§5.12, §19).';
comment on column zeit_intern.arbeitszeit_fenster.aktiv is
  'Zeilen werden entwertet, nie geloescht: eine Wartungspanne soll als '
  'veraltetes Fenster auffallen, nicht als fehlendes verschwinden.';

/**
 * FORCE, auch und gerade hier (§1.1).
 *
 * Der Entwurf nahm die Fenstertabelle von `FORCE` aus — das falsche Werkzeug:
 * ohne `FORCE` ist der EIGENTUEMER ausgenommen, und jede Verbindung, die
 * zufaellig als Eigentuemer laeuft, liest die Stunden jedes Menschen ueber alle
 * vier Gesellschaften.
 *
 * Geschuetzt ist die Tabelle stattdessen dreifach: sie liegt in einem Schema,
 * das PostgREST nicht ausliefert (§2.3 Nr. 10 — eine
 * Auslieferungskonfiguration, die es doch taete, machte die Ueberschreitung
 * ohne eine Zeile Code zu einem HTTP-Endpunkt); sie hat keine Policy fuer
 * `cse_app` oder `cse_anon`; und sie traegt keine Spalte, die eine Schicht
 * identifizieren koennte.
 */
alter table zeit_intern.arbeitszeit_fenster enable row level security;
alter table zeit_intern.arbeitszeit_fenster force  row level security;

/**
 * Die eine Policy aus §1.1. Ein `SECURITY DEFINER` laeuft als `cse_definer`,
 * und unter `FORCE ROW LEVEL SECURITY` ist auch der nicht ausgenommen: ohne
 * benannte Policy liest er null Zeilen und schreibt nichts — lautlos. Kein
 * `BYPASSRLS`, keine Rollenausnahme, kein vierter Mechanismus.
 */
create policy fenster_definer on zeit_intern.arbeitszeit_fenster
  as permissive for all to cse_definer using (true) with check (true);

/**
 * `job:arbzg_fenster_abgleich` leitet die Projektion naechtlich neu her und
 * MELDET Drift (§14.3). Er laeuft als `cse_job`, hat keine Sitzung und traefe
 * ohne eigene Policy null Zeilen — der Abgleich meldete dann „keine Drift",
 * was von „alles in Ordnung" nicht zu unterscheiden ist.
 */
create policy fenster_job on zeit_intern.arbeitszeit_fenster
  as permissive for select to cse_job using (true);
create policy fenster_job_entwerten on zeit_intern.arbeitszeit_fenster
  as permissive for update to cse_job using (true) with check (true);

/**
 * KEIN `grant select … to cse_app`, und das ist die Zeile, die diese Migration
 * am ehesten „vergessen" aussieht. Sie fehlt mit Absicht (§5.12). Isolationsfall
 * 6 aus §6.8: `select * from zeit_intern.arbeitszeit_fenster` als `cse_app`
 * liefert in JEDEM Sitzungszustand null Zeilen, auch im ungesetzten.
 */
grant select, insert, update on zeit_intern.arbeitszeit_fenster to cse_definer;
grant select, update            on zeit_intern.arbeitszeit_fenster to cse_job;

/**
 * Kein hartes Loeschen (Invariante 8, §1.6). Der Ausloeser steht hier von Hand
 * und nicht im generierten Block am Dateiende: `scripts/generate-triggers.ts`
 * schreibt `before delete on <tabelle>` ohne Schemaqualifizierung, was fuer
 * `zeit_intern` auf die falsche Relation zeigte. Was daran nachzuziehen ist,
 * steht in Abschnitt 18.
 */
create trigger trg_arbeitszeit_fenster_kein_hard_delete
  before delete on zeit_intern.arbeitszeit_fenster
  for each row execute function kern.verhindere_loeschung();
create trigger trg_arbeitszeit_fenster_kein_truncate
  before truncate on zeit_intern.arbeitszeit_fenster
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zeit_intern.arbeitszeit_fenster
  from cse_app, cse_anon, cse_checkin, cse_job;

-- ---------------------------------------------------------------------------
-- 4. zeit_intern.fenster_setzen — die Supersede-Regel (§6.2, woertlich)
-- ---------------------------------------------------------------------------

/**
 * Der Entwurf projizierte eine `plan`-Zeile aus der Zuordnung und eine
 * `ist`-Zeile aus dem Zeiteintrag und entwertete KEINE von beiden. Der Detektor
 * summierte danach beide fuer dieselbe gearbeitete Schicht und meldete zwoelf
 * Stunden fuer einen Sechs-Stunden-Tag.
 *
 * Und dieser Fehler liess sich nicht nachtraeglich herausfiltern: weil der
 * Leser die Identifikatoren abstreift, ist ein Plan/Ist-Paar einer FREMDEN
 * Gesellschaft von zwei echten aufeinanderfolgenden Schichten nicht zu
 * unterscheiden. Die Pruefung waere in beide Richtungen falsch gewesen — falsche
 * Verstoesse im eigenen Mandanten, unzuverlaessige Aggregation ueber ihn hinaus
 * (Review B3).
 *
 * K-06 legt die Aufloesung fest, und dieser Koerper setzt sie woertlich um.
 * Diese Funktion wird deshalb NICHT „verbessert": jede Erweiterung gehoert in
 * den Aufrufer, nicht hierher (siehe Abschnitt 6).
 *
 * `security definer` mit gepinntem `search_path` (K-01): ein unqualifizierter
 * `search_path` auf einer Definer-Funktion ist ein Weg zur Rechteausweitung.
 */
create function zeit_intern.fenster_setzen(
    p_quelle              fenster_quelle,
    p_quelle_id           uuid,
    p_zuordnung_quelle_id uuid,
    p_person              uuid,
    p_mandant             uuid,
    p_anstellung          uuid,
    p_beginn              timestamptz,
    p_ende                timestamptz,
    p_pause               integer,
    p_aktiv               boolean)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into zeit_intern.arbeitszeit_fenster
        (quelle, quelle_id, zuordnung_quelle_id, person_id, mandant_id, anstellung_id,
         beginn_utc, ende_utc, pause_minuten, aktiv)
  values (p_quelle, p_quelle_id, p_zuordnung_quelle_id, p_person, p_mandant, p_anstellung,
          p_beginn, p_ende, coalesce(p_pause, 0), p_aktiv)
  on conflict (quelle, quelle_id) do update
     set beginn_utc = excluded.beginn_utc, ende_utc = excluded.ende_utc,
         pause_minuten = excluded.pause_minuten, aktiv = excluded.aktiv,
         zuordnung_quelle_id = excluded.zuordnung_quelle_id,
         geaendert_am = now();

  -- K-06: the ist row supersedes its plan row IN THE SAME STATEMENT.
  if p_quelle = 'ist' and p_aktiv and p_zuordnung_quelle_id is not null then
    update zeit_intern.arbeitszeit_fenster
       set aktiv = false, geaendert_am = now()
     where quelle = 'plan'
       and zuordnung_quelle_id = p_zuordnung_quelle_id
       and aktiv;
  end if;
end $$;

comment on function zeit_intern.fenster_setzen(fenster_quelle, uuid, uuid, uuid, uuid, uuid,
                                               timestamptz, timestamptz, integer, boolean) is
  'K-06/§6.2 woertlich. Ein Fenster je Zuordnung; die ist-Zeile entwertet ihre '
  'plan-Zeile in derselben Anweisung. Ohne sie meldet der Detektor 12 h fuer '
  'einen 6-Stunden-Tag.';

/**
 * `zeit_intern`, nicht `zeit` (§0.3). Es gibt kein Schema `zeit`, und ein
 * frueherer Entwurf erfand eines: `01-KERN.md` §0 legt genau drei an — `app`,
 * `kern`, `zeit_intern` —, die Klassenkarten-Metapruefung scannt
 * `['public','kern','zeit_intern']`, und ein `create function` in einem
 * vierten Schema laesst die Migration scheitern.
 */
revoke all on function zeit_intern.fenster_setzen(fenster_quelle, uuid, uuid, uuid, uuid, uuid,
                                                  timestamptz, timestamptz, integer, boolean)
  from public;
grant execute on function zeit_intern.fenster_setzen(fenster_quelle, uuid, uuid, uuid, uuid, uuid,
                                                     timestamptz, timestamptz, integer, boolean)
  to cse_definer;

-- ---------------------------------------------------------------------------
-- 5. Die Lesepfade des Definers (§1.1)
-- ---------------------------------------------------------------------------

/**
 * Die Projektionsausloeser und die Leser aus §6 muessen `einsatz`,
 * `einsatz_zuordnung` und `anstellung` lesen — als `cse_definer`, unter
 * `FORCE RLS`, also mit benannter Policy oder gar nicht.
 *
 * Warum ueberhaupt `security definer`, wenn der schreibende Planer die Zeilen
 * doch selbst sieht: weil der ALTERNATIVE Entwurf `cse_app` USAGE auf
 * `zeit_intern` und EXECUTE auf `fenster_setzen` geben muesste — und damit die
 * Moeglichkeit, Fenster mit frei gewaehlten Argumenten zu erfinden. Der Umweg
 * ueber den Definer ist genau der Preis dafuer, dass die Anwendungsrolle das
 * Schema nie betritt.
 *
 * Die Policies stehen unter einer Existenzpruefung, weil PR 31 (0031) dieselben
 * Namen fuer `einsatz` und `anstellung` anlegt und beide Migrationen in
 * beliebiger Reihenfolge auf eine Datenbank treffen koennen. Ein doppelter
 * Policy-Name bricht die GESAMTE Migration ab; die Pruefung nimmt die
 * vorhandene Policy hin, statt sie zu ueberschreiben — die vorsichtige
 * Richtung, denn eine fremde Policy koennte enger sein als diese.
 */
do $$ begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'einsatz' and policyname = 'e_definer') then
    create policy e_definer on einsatz for select to cse_definer using (true);
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'einsatz_zuordnung' and policyname = 'ez_definer') then
    create policy ez_definer on einsatz_zuordnung for select to cse_definer using (true);
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'anstellung' and policyname = 'a_definer') then
    create policy a_definer on anstellung for select to cse_definer using (true);
  end if;
end $$;

-- Spaltenweise waere hier Theater: die Projektion braucht die Zeitfenster, die
-- Schluessel und die Lebendigkeitsspalten, also faktisch die Zeile.
grant select on einsatz, einsatz_zuordnung to cse_definer;
-- `anstellung`: NUR die Spalten, die die Vorbedingung aus §6.3 braucht. Der
-- Stundensatz bleibt auch dem Definer verschlossen (K-05).
grant select (id, mandant_id, person_id, geloescht_am, status) on anstellung to cse_definer;

-- ---------------------------------------------------------------------------
-- 6. Die Projektionsausloeser (§14.1)
-- ---------------------------------------------------------------------------

/**
 * Aus einer Zuordnung wird ein `plan`-Fenster.
 *
 * DREI Entscheidungen, die im naheliegenden Entwurf still falsch gewesen
 * waeren:
 *
 * 1. **Die geplante Pause wird nur gutgeschrieben, wenn die Zuordnung die
 *    GANZE Schicht deckt.** Eine Wache deckt 22:00–02:00 eines
 *    22:00–06:00-Postens (§5.4); schriebe man ihr die volle geplante Pause der
 *    Schicht gut — und der zweiten Wache noch einmal —, zaehlte der Detektor
 *    Pausen, die es nur einmal gab, und meldete den §4-Verstoss NICHT. Das ist
 *    die stille Richtung. Umgekehrt entsteht hoechstens ein Befund zu viel, und
 *    der ist sichtbar und quittierbar.
 *    // TODO(client, O-168): Zaehlt eine GEPLANTE Pause fuer die
 *    ArbZG-Planpruefung als Pause, und wie verteilt sie sich, wenn mehrere
 *    Zuordnungen eine Schicht in Abschnitte teilen?
 *
 * 2. **Eine `plan`-Zeile darf eine bereits entwertete `plan`-Zeile nicht
 *    wiederbeleben.** Sobald PR 34 die `ist`-Projektion nachtraegt, gilt: die
 *    Kraft stempelt ein, die `ist`-Zeile entwertet die `plan`-Zeile (§6.2) —
 *    und wenn der Planer danach IRGENDETWAS an der Zuordnung anfasst (Status
 *    auf `zugesagt`, eine Funktion nachtragen), setzte dieser Ausloeser
 *    `aktiv = true` zurueck. Beide Fenster waeren aktiv, und der Detektor
 *    meldete zwoelf Stunden fuer einen Sechs-Stunden-Tag: genau der Fehler, den
 *    §6.2 beseitigt, durch die Hintertuer wieder herein. Die Sperre steht HIER
 *    und nicht in `fenster_setzen`, weil dessen Koerper von K-06 woertlich
 *    vorgegeben ist.
 *
 * 3. **`nicht_erschienen` entwertet das Fenster NICHT.** Ob ein Nichterscheinen
 *    die Belastung mindert, ist keine Frage, die eine Migration beantworten
 *    darf — das Zustandsvokabular selbst ist provisorisch. Aktiv zu lassen
 *    ueberzeichnet die Belastung (sichtbarer Fehlalarm), zu entwerten
 *    unterzeichnet sie (stilles Bestehen).
 *    // TODO(client, O-170): Mindert `abgesagt` oder `nicht_erschienen` die
 *    ArbZG-Belastung sofort, oder erst mit der Ersatzplanung?
 */
create function zeit_intern.ez_fenster_projizieren() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_e_beginn   timestamptz;
  v_e_ende     timestamptz;
  v_e_pause    integer;
  v_storniert  timestamptz;
  v_pause      integer := 0;
  v_aktiv      boolean;
begin
  select e.beginn_zeitpunkt, e.ende_zeitpunkt, e.pause_geplant_minuten, e.storniert_am
    into v_e_beginn, v_e_ende, v_e_pause, v_storniert
    from public.einsatz e
   where e.id = new.einsatz_id and e.mandant_id = new.mandant_id;

  if not found then
    -- Kann nur eintreten, wenn der zusammengesetzte Fremdschluessel aus 0028
    -- fehlt. Dann ist die Zeile ohnehin kaputt, und lautlos kein Fenster zu
    -- schreiben waere die schlechtere Haelfte der Wahl.
    raise exception 'Die Schicht dieser Zuordnung gehoert nicht zu dieser Gesellschaft'
      using errcode = 'foreign_key_violation',
            detail  = 'zeit_intern.ez_fenster_projizieren: einsatz_id/mandant_id passen nicht.';
  end if;

  if new.beginn_zeitpunkt <= v_e_beginn and new.ende_zeitpunkt >= v_e_ende then
    v_pause := coalesce(v_e_pause, 0);
  end if;

  v_aktiv := new.entfernt_am is null
             and new.status not in ('abgesagt','ersetzt')
             and v_storniert is null
             and not exists (select 1
                               from zeit_intern.arbeitszeit_fenster f
                              where f.zuordnung_quelle_id = new.id
                                and f.quelle = 'ist'
                                and f.aktiv);

  perform zeit_intern.fenster_setzen(
    'plan'::fenster_quelle,
    new.id,                 -- quelle_id: die Zuordnung spiegelt sich selbst
    new.id,                 -- zuordnung_quelle_id: dieselbe Zeile, siehe §6.2
    new.person_id, new.mandant_id, new.anstellung_id,
    new.beginn_zeitpunkt, new.ende_zeitpunkt, v_pause, v_aktiv);

  return null;
end $$;

/**
 * Die Spaltenliste ist die vollstaendige Eingabe der Projektion — sie ist
 * aufgezaehlt und nicht weggelassen, damit ein Leser sie gegen den
 * Funktionskoerper pruefen kann. Eine fehlende Spalte hiesse: ein Fenster, das
 * nicht mehr stimmt, und niemand merkt es. `mandant_id` steht mit darauf,
 * obwohl ein Mandantenwechsel einer Zuordnung kein modellierter Vorgang ist.
 */
create trigger trg_ez_fenster_projizieren
  after insert or update of einsatz_id, anstellung_id, person_id, mandant_id,
                            beginn_zeitpunkt, ende_zeitpunkt, entfernt_am, status
  on einsatz_zuordnung
  for each row execute function zeit_intern.ez_fenster_projizieren();

/**
 * Verschiebt oder storniert jemand die SCHICHT, muessen alle ihre Fenster
 * nachziehen — der Ausloeser oben feuert dabei nicht, denn die Zuordnungszeilen
 * bleiben unberuehrt.
 *
 * Nur `after update`: beim INSERT einer Schicht gibt es noch keine Zuordnung,
 * ueber die zu faechern waere.
 *
 * Gefaechert wird ueber die LEBENDEN Zuordnungen (§5.12). Die bereits
 * entfernten sind entwertet und bleiben es; sie erneut zu beruehren erzeugte
 * nur Schreiblast.
 */
create function zeit_intern.einsatz_fenster_projizieren() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  z      record;
  v_pause integer;
  v_aktiv boolean;
begin
  for z in select ez.id, ez.person_id, ez.mandant_id, ez.anstellung_id,
                  ez.beginn_zeitpunkt, ez.ende_zeitpunkt, ez.status, ez.entfernt_am
             from public.einsatz_zuordnung ez
            where ez.einsatz_id = new.id
              and ez.mandant_id = new.mandant_id
              and ez.entfernt_am is null
  loop
    v_pause := 0;
    if z.beginn_zeitpunkt <= new.beginn_zeitpunkt and z.ende_zeitpunkt >= new.ende_zeitpunkt then
      v_pause := coalesce(new.pause_geplant_minuten, 0);
    end if;

    v_aktiv := z.status not in ('abgesagt','ersetzt')
               and new.storniert_am is null
               and not exists (select 1
                                 from zeit_intern.arbeitszeit_fenster f
                                where f.zuordnung_quelle_id = z.id
                                  and f.quelle = 'ist'
                                  and f.aktiv);

    perform zeit_intern.fenster_setzen(
      'plan'::fenster_quelle, z.id, z.id,
      z.person_id, z.mandant_id, z.anstellung_id,
      z.beginn_zeitpunkt, z.ende_zeitpunkt, v_pause, v_aktiv);
  end loop;

  return null;
end $$;

create trigger trg_einsatz_fenster_projizieren
  after update of beginn_zeitpunkt, ende_zeitpunkt, pause_geplant_minuten, storniert_am, status
  on einsatz
  for each row execute function zeit_intern.einsatz_fenster_projizieren();

/**
 * DER DRITTE AUSLOESER FEHLT HIER, UND ZWAR ABSICHTLICH.
 *
 * `z_fenster_projizieren` haengt an `zeiteintrag`, und diese Tabelle gehoert
 * PR 34. Ihn hier zu schreiben hiesse, eine Migration zu hinterlassen, die auf
 * einem Zweig ohne PR 34 nicht laeuft — dieselbe Form, in der 0028 seine
 * offenen Fremdschluessel hinterlegt hat.
 *
 * Er gehoert woertlich in die Migration, die `zeiteintrag` anlegt; ist die
 * bereits angewendet, in die naechste danach. Bis dahin ist die `ist`-Haelfte
 * der Supersede-Regel unbenutzt — nicht kaputt: `fenster_setzen` wartet schon
 * auf sie, und die Sperre gegen das Wiederaufleben einer entwerteten
 * `plan`-Zeile steht in beiden Projektionen oben:
 *
 *   create function zeit_intern.z_fenster_projizieren() returns trigger
 *   language plpgsql security definer set search_path = pg_catalog, public as $fn$
 *   begin
 *     perform zeit_intern.fenster_setzen(
 *       'ist'::fenster_quelle,
 *       new.id,
 *       -- Ungeplante Arbeit hat keine Zuordnung; dann traegt das Fenster die
 *       -- EIGENE Identitaet, damit der Deduplizierungsschluessel total bleibt
 *       -- (§6.2). Genau deshalb hat die Spalte keinen Fremdschluessel.
 *       coalesce(new.einsatz_zuordnung_id, new.id),
 *       new.person_id, new.mandant_id, new.anstellung_id,
 *       new.beginn_zeitpunkt, new.ende_zeitpunkt, coalesce(new.pause_minuten, 0),
 *       new.storniert_am is null and new.ersetzt_am is null);
 *     return null;
 *   end $fn$;
 *
 *   create trigger trg_z_fenster_projizieren
 *     after insert or update of beginn_zeitpunkt, ende_zeitpunkt, pause_minuten,
 *                               einsatz_zuordnung_id, storniert_am, ersetzt_am
 *     on zeiteintrag
 *     for each row execute function zeit_intern.z_fenster_projizieren();
 *
 * Solange er fehlt, traegt die Fenstertabelle ausschliesslich `plan`-Zeilen.
 * Das ist kein halber Zustand, sondern der richtige: ein `ist`-Fenster ohne
 * `zeiteintrag` gaebe es nicht.
 */

-- ---------------------------------------------------------------------------
-- 7. arbeitszeit_verstoss (§5.11)
-- ---------------------------------------------------------------------------

/**
 * Der erkannte ArbZG-Befund — zu langer Tag, zu kurze Ruhezeit, fehlende Pause
 * (TIM-06, TIM-14, LEG-03).
 *
 * Ein Befund ueber zwei Gesellschaften wird EINMAL JE BETEILIGTEM MANDANTEN
 * geschrieben, damit jede Planung ihn im eigenen Plan sieht — ohne dass eine
 * von beiden einen Abfragepfad in die Daten der anderen bekommt. Das ist der
 * Grund, warum diese Tabelle keine INSERT-Policy fuer `cse_app` hat (§6.6).
 */
create table arbeitszeit_verstoss (
  id         uuid not null default gen_random_uuid(),
  -- Der Mandant, in dem der Befund ANGEZEIGT wird — nicht notwendig der, in dem
  -- die ursaechliche Schicht liegt.
  mandant_id uuid not null references mandant(id),
  -- Das Subjekt. Die Grenze gehoert dem Menschen (D-09), nicht der Anstellung.
  person_id     uuid not null references person(id),
  anstellung_id uuid not null,

  regel   arbzg_regel      not null,
  schwere verstoss_schwere not null,

  zeitraum_beginn timestamptz not null,
  zeitraum_ende   timestamptz not null,

  -- Gemessener Wert und gesetzliche Grenze, in ganzen Minuten. Integer, nie
  -- Fliesskomma (K-16); eine gemessene Dauer ist Beweis (§1.7).
  ist_minuten       integer not null,
  grenzwert_minuten integer not null,

  -- Wahr, sobald ein Fenster aus einer anderen Gesellschaft der Gruppe
  -- beigetragen hat (TIM-14). Traegt das bewusst neutrale Etikett „Anderer
  -- Bereich" (§3.6) — der Name der Gesellschaft steht hier NICHT.
  betrifft_fremden_mandant boolean not null default false,
  -- NULL, wenn Plan UND Ist beigetragen haben.
  quelle_art fenster_quelle,

  -- Die Zeile in DIESEM Mandanten, an der die Erkennung haengt.
  einsatz_id     uuid,
  zeiteintrag_id uuid,

  /**
   * Die beitragenden Fenster als `[{eigen, fenster_gruppe, beginn, ende,
   * minuten}]`. Fuer ein fremdes Fenster ist `eigen = false`, die Quell-Id
   * FEHLT, und `mandant_id` ist NIE enthalten: der Aufrufer erfaehrt, DASS der
   * Mensch anderweitig gebunden ist, nie WO (K-06, §6.3). Reduziert wird in
   * `zeit_intern.ursache_fuer_mandant` (Abschnitt 12).
   */
  ursache jsonb not null,

  /**
   * `sha256(mandant_id ‖ person_id ‖ regel ‖ berlin_tag)` (§6.7).
   *
   * Auf dem BERLINER TAG, nicht auf den Zeitpunkten. Der Entwurf hashte
   * `zeitraum_beginn/ende`: eine Schicht um eine Minute zu verschieben praegte
   * dann einen neuen Befund, waehrend der alte fuer immer `offen` stehen blieb.
   */
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),

  status konflikt_status not null default 'offen',

  quittiert_von           uuid references benutzer(id),
  quittiert_am            timestamptz,
  quittierung_begruendung text,

  -- Befunde werden hinfaellig, sie verschwinden nicht (Invariante 8, §6.7).
  hinfaellig_am timestamptz,

  erkannt_am    timestamptz      not null default now(),
  erkannt_durch erkennung_quelle not null,

  -- §1.13: Klasse `zeiterfassung`. Die Frist schreibt `job:aufbewahrung`, nie
  -- ein DEFAULT — eine Spalten-Vorgabe kann in Postgres keine andere Spalte
  -- lesen, und der Fristbeginn nach §17 MiLoG ist offen.
  -- // TODO(client, O-25): Aufbewahrungsfrist fuer ArbZG-Befunde ueber die zwei
  -- SPEC-genannten Fristen hinaus?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  -- Auditblock (§1.6). Detektorzeilen sind `system`.
  erstellt_am            timestamptz not null default now(),
  erstellt_von_art       akteur_art  not null default 'mensch',
  erstellt_von           uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am           timestamptz,
  geaendert_von_art      akteur_art,
  geaendert_von          uuid references benutzer(id),

  primary key (id),
  constraint arbeitszeit_verstoss_mandant_uk unique (mandant_id, id),

  constraint av_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint av_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),

  constraint av_zeitraum check (zeitraum_ende > zeitraum_beginn),
  constraint av_minuten_nicht_negativ check (ist_minuten >= 0 and grenzwert_minuten >= 0),
  -- Ein quittierter Befund ohne genannten Grund ist bei einer Pruefung wertlos.
  constraint av_quittierung_begruendet check (
    status <> 'quittiert' or btrim(coalesce(quittierung_begruendung,'')) <> ''),
  constraint av_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * Der Schluessel, gegen den `app.arbzg_befund_schreiben` hochlaedt.
 * PARTIELL auf `hinfaellig_am is null` (§1.12): ein ueberholter Befund darf die
 * erneute Erkennung nicht blockieren.
 */
create unique index av_fingerprint_uk on arbeitszeit_verstoss (mandant_id, fingerprint)
  where hinfaellig_am is null;

create index av_offen_idx on arbeitszeit_verstoss (mandant_id, status, zeitraum_beginn)
  where status = 'offen';
create index av_person_idx on arbeitszeit_verstoss (mandant_id, person_id, zeitraum_beginn);
create index av_einsatz_idx on arbeitszeit_verstoss (mandant_id, einsatz_id)
  where einsatz_id is not null;
-- Die entitaetsuebergreifenden Faelle — was eine Leitung am dringendsten sehen
-- muss (TIM-14).
create index av_fremd_idx on arbeitszeit_verstoss (mandant_id, zeitraum_beginn)
  where betrifft_fremden_mandant;

comment on table arbeitszeit_verstoss is
  'ArbZG-Befund, je beteiligter Gesellschaft einmal gespiegelt. Keine INSERT- '
  'und keine UPDATE-Policy fuer cse_app: geschrieben wird nur ueber '
  'app.arbzg_befund_schreiben, quittiert nur ueber app.arbzg_befund_quittieren (K-06).';
comment on column arbeitszeit_verstoss.ursache is
  'Beitragende Fenster, fuer fremde Gesellschaften auf Dauer und Grenzen '
  'reduziert: kein mandant_id, keine Quell-Id, kein Objekt, kein Kunde.';

-- ---------------------------------------------------------------------------
-- 8. planungs_konflikt (§5.10)
-- ---------------------------------------------------------------------------

/**
 * TIM-05 nennt drei Konfliktklassen, und der Entwurf hatte eine Tabelle fuer
 * EINE davon: `arbzg_regel` hat keinen Wert fuer eine Doppelbuchung und keinen
 * Platz fuer „das Zeugnis, auf dem diese Zuordnung beruhte, ist inzwischen
 * abgelaufen". Zwei der drei Klassen hatten nirgends zu wohnen.
 *
 * Diese Tabelle traegt die zwei mandantenlokalen Klassen plus die
 * §17-MiLoG-Aufzeichnungsfrist. Die entitaetsuebergreifenden ArbZG-Befunde
 * bleiben in `arbeitszeit_verstoss` — nicht aus Ordnungsliebe: ein Befund, der
 * in eine ANDERE Gesellschaft gespiegelt werden muss, kann sich den Schreibpfad
 * nicht mit einem teilen, der diese Gesellschaft nie verlassen darf.
 */
create table planungs_konflikt (
  id         uuid not null default gen_random_uuid(),
  mandant_id uuid not null references mandant(id),

  art konflikt_art not null,

  person_id     uuid not null references person(id),
  anstellung_id uuid not null,

  einsatz_id           uuid,
  einsatz_zuordnung_id uuid,
  zeiteintrag_id       uuid,

  /**
   * Bei `ueberschneidung` die ANDERE Zuordnung — und NULL, sobald die andere
   * Seite in einer fremden Gesellschaft liegt. Dann traegt
   * `betrifft_fremden_mandant` die Tatsache, und kein Identifikator wandert
   * hinueber (§6.3).
   */
  gegen_zuordnung_id uuid,

  betrifft_fremden_mandant boolean not null default false,

  -- Bei `qualifikation_entfallen`: welche Anforderung nicht mehr erfuellt ist
  -- (§11.2). Der Fremdschluessel kommt mit `qualifikation` — siehe Abschnitt 16.
  qualifikation_id uuid,

  -- Bei `art = 'arbzg'`: das Abzeichen auf der Schicht ZEIGT auf den Befund,
  -- statt ihn zu verdoppeln.
  arbeitszeit_verstoss_id uuid,

  zeitraum_beginn timestamptz not null,
  zeitraum_ende   timestamptz not null,

  schwere verstoss_schwere not null,

  /**
   * Ob dieser Befund die Planungshandlung BLOCKIERT hat.
   *
   * PLATZHALTER. TIM-06 spricht von „Warnungen", nicht von Blockaden, und
   * SEC-04 von einer harten Sperre ausschliesslich fuer Zeugnisse. Gespeist aus
   * `app.einstellung('zeit.konflikt_blockiert')` je `art`; ausgeliefert wird
   * `false` ausser bei `qualifikation_entfallen`, wo SEC-04 es auf `true`
   * stellt. Ein Default `true` hier waere eine erfundene Geschaeftsregel, die
   * den Dienstplan lahmlegt; ein blockierender Befund ist ueberdies durch KEIN
   * Recht uebersteuerbar (§6.5).
   * // TODO(client, O-166): Welche Konflikte sollen das Speichern verhindern
   * und welche nur warnen?
   */
  blockiert boolean not null default false,

  -- Die beitragenden Intervalle, fuer eine fremde Gesellschaft auf Dauern und
  -- Grenzen reduziert.
  details jsonb not null default '{}'::jsonb,

  /**
   * Die KOERNUNG haengt an der `art`, und die beiden Faelle sind verschiedene
   * Fragen (§5.10):
   *
   *   `arbzg` / `aufzeichnungsfrist`
   *     sha256(mandant_id ‖ person_id ‖ art ‖ berlin_tag)
   *     — eine Tagesgrenze verletzt man einmal am Tag, gleichgueltig wie viele
   *       Schichten beigetragen haben (§6.7).
   *
   *   `ueberschneidung` / `qualifikation_entfallen`
   *     sha256(… ‖ coalesce(einsatz_zuordnung_id, einsatz_id))
   *     — die Tagesform faltete ZWEI Schichten an einem Tag, die je eine
   *       Qualifikation verloren haben, in EINE Zeile mit EINER einsatz_id: der
   *       Planer sieht ein Abzeichen, repariert eine Schicht, und die andere
   *       bleibt unbesetzt oder unzulaessig besetzt, ohne dass irgendetwas auf
   *       dem Schirm es sagt.
   *
   * Der Ausdruck steht im Dienst (`src/server/services/arbzg/`), nicht im
   * Index: der Index weiss nur, dass gleiche Fingerabdruecke kollidieren.
   */
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),

  status konflikt_status not null default 'offen',

  quittiert_von           uuid references benutzer(id),
  quittiert_am            timestamptz,
  quittierung_begruendung text,

  -- Gesetzt, wenn die zugrunde liegende Planung sich geaendert hat. Befunde
  -- werden ueberholt, nie geloescht (Invariante 8).
  hinfaellig_am timestamptz,

  erkannt_am    timestamptz      not null default now(),
  erkannt_durch erkennung_quelle not null,

  -- // TODO(client, O-25): Aufbewahrungsfrist fuer Planungskonflikte?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  -- Auditblock (§1.6)
  erstellt_am            timestamptz not null default now(),
  erstellt_von_art       akteur_art  not null default 'mensch',
  erstellt_von           uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am           timestamptz,
  geaendert_von_art      akteur_art,
  geaendert_von          uuid references benutzer(id),

  primary key (id),
  constraint planungs_konflikt_mandant_uk unique (mandant_id, id),

  constraint pk_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint pk_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),
  constraint pk_zuordnung_fk foreign key (mandant_id, einsatz_zuordnung_id)
    references einsatz_zuordnung (mandant_id, id),
  constraint pk_gegen_zuordnung_fk foreign key (mandant_id, gegen_zuordnung_id)
    references einsatz_zuordnung (mandant_id, id),
  constraint pk_verstoss_fk foreign key (mandant_id, arbeitszeit_verstoss_id)
    references arbeitszeit_verstoss (mandant_id, id),

  -- Ein Konflikt ohne Anker ist nicht darstellbar und nicht reparierbar.
  constraint pk_anker check (
    num_nonnulls(einsatz_id, einsatz_zuordnung_id, zeiteintrag_id) >= 1),
  constraint pk_zeitraum check (zeitraum_ende > zeitraum_beginn),
  constraint pk_quittierung_begruendet check (
    status <> 'quittiert' or btrim(coalesce(quittierung_begruendung,'')) <> ''),
  constraint pk_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create unique index pk_fingerprint_uk on planungs_konflikt (mandant_id, fingerprint)
  where hinfaellig_am is null;

-- Die Konfliktliste des Planers und die Abzeichenzahl im Dienstplan.
create index pk_offen_idx on planungs_konflikt (mandant_id, status, zeitraum_beginn)
  where status = 'offen';
-- Das Zeichen an der Schicht (TIM-05).
create index pk_einsatz_idx on planungs_konflikt (mandant_id, einsatz_id)
  where einsatz_id is not null;
create index pk_person_idx on planungs_konflikt (mandant_id, person_id, zeitraum_beginn);

comment on table planungs_konflikt is
  'Die zwei mandantenlokalen TIM-05-Klassen plus die §17-MiLoG-Frist. Die '
  'entitaetsuebergreifenden ArbZG-Befunde liegen in arbeitszeit_verstoss, weil '
  'ein zu spiegelnder Befund einen anderen Schreibpfad braucht (K-06).';
comment on column planungs_konflikt.gegen_zuordnung_id is
  'NULL, wenn die andere Seite in einer fremden Gesellschaft liegt — dann traegt '
  'betrifft_fremden_mandant die Tatsache und kein Identifikator kreuzt (§6.3).';

-- ---------------------------------------------------------------------------
-- 9. app.fenster_schluessel (§6.3)
-- ---------------------------------------------------------------------------

/**
 * Der installationsweite HMAC-Schluessel hinter `fenster_gruppe`.
 *
 * Er wird bei der Auslieferung als Datenbankeinstellung injiziert
 * (`07-INTEGRATIONEN.md` besitzt die Auslieferung) und steht in KEINER Tabelle,
 * damit ein Datenbankabzug seinem Halter nicht erlaubt, `fenster_gruppe`-Werte
 * auf Zuordnungen zurueckzurechnen.
 *
 * Drei Eigenschaften sind tragend, und jede ist ein Test:
 *
 *  - **`STABLE`, niemals `IMMUTABLE`.** Eine unveraenderliche Funktion, die
 *    `current_setting` liest, darf in einen Index oder einen zwischengespeicherten
 *    Plan gefaltet werden — der Schluessel ueberlebte seine Rotation dann INNERHALB
 *    eines Abfrageplans.
 *  - **Ausfuehrbar nur fuer `cse_definer`.** Wer den HMAC berechnen kann, kann
 *    ueber die Zuordnungs-Ids, die er ohnehin sieht, eine Regenbogentabelle
 *    bauen und jede `fenster_gruppe` deanonymisieren, die der Leser ihm gibt.
 *  - **`current_setting` OHNE zweites Argument.** Eine Auslieferung, die den
 *    Schluessel vergessen hat, WIRFT — statt still unter leerem Schluessel zu
 *    hashen, was die `fenster_gruppe`-Werte jeder Installation mit denen jeder
 *    anderen vergleichbar machte.
 *
 * BETRIEBSHINWEIS: `cse.fenster_schluessel` muss gesetzt sein, bevor
 * `app.arbzg_belastung` das erste Mal laeuft (`alter database … set
 * cse.fenster_schluessel = '<base64>'` oder das Sitzungsaequivalent im Test).
 * Diese Migration setzt ihn NICHT — ein Schluessel im Repository ist keiner.
 */
create function app.fenster_schluessel() returns bytea
language sql stable
security definer set search_path = pg_catalog, public as $$
  select decode(current_setting('cse.fenster_schluessel'), 'base64');
$$;

revoke all on function app.fenster_schluessel() from public;
grant execute on function app.fenster_schluessel() to cse_definer;   -- and to no other role

comment on function app.fenster_schluessel() is
  'Der installationsweite HMAC-Schluessel hinter fenster_gruppe. STABLE (nicht '
  'IMMUTABLE, sonst ueberlebt er eine Rotation im Plan), nur fuer cse_definer.';

-- ---------------------------------------------------------------------------
-- 10. app.arbzg_belastung — die K-06-Signatur woertlich (§6.3)
-- ---------------------------------------------------------------------------

/**
 * Der Leser. Er gibt DAUERN UND INTERVALLGRENZEN zurueck und sonst nichts.
 *
 * Was er NICHT zurueckgibt: `mandant_id`, den Namen der Gesellschaft,
 * `anstellung_id`, die Quell-Id, `objekt`, `kunde`, `personalnummer`,
 * `stundensatz_intern`. Eine Reinigungsplanung erfaehrt „dieser Mensch ist von
 * 22:00 bis 06:00 irgendwo in der Gruppe gebunden" und keinen Deut mehr — genau
 * das, was §2 ArbZG einem Arbeitgeber aufgibt festzustellen, und nicht mehr.
 *
 * DREI Abweichungen vom woertlichen Text des Dokuments, alle drei erzwungen,
 * alle drei nachgeprueft und hier benannt — der Rest ist zeichengetreu:
 *
 *  1. `a.archiviert_am` heisst in `anstellung` `geloescht_am` (0002). Die
 *     Spalte `archiviert_am` gibt es dort nicht; die Vorbedingung waere nicht
 *     kompilierbar. Zur Nachfuehrung siehe Abschnitt 18.
 *  2. `app.protokolliere` nimmt `p_objekt_id text`; `p_person` ist `uuid`, und
 *     Postgres kennt dorthin keine implizite Umwandlung — der Aufruf im
 *     Dokument wuerde nicht anlegen. Die Nutzlast steht ausserdem im Feld
 *     `nachher` statt `vorher`, wie es die Hausform fuer Leseereignisse tut
 *     (0007, 0020); der Mandant loest sich ueber den Standardwert auf denselben
 *     `app.aktiver_mandant()` auf.
 *  3. Der HMAC-Ausdruck, siehe den Kommentar an der Stelle selbst.
 */
create function app.arbzg_belastung(p_person uuid, p_von timestamptz, p_bis timestamptz)
returns table (fenster_gruppe text,          -- opaque hash, for deduplication only
               beginn_utc timestamptz, ende_utc timestamptz,
               minuten integer, fremd boolean)
language plpgsql
volatile                                     -- NOT stable: it writes audit_log (review B6)
security definer
set search_path = pg_catalog, public
as $$
declare v_mandant uuid := app.aktiver_mandant();
        v_zeilen  integer;
        v_fremde  integer;
begin
  -- Vorbedingungen, als EXPLIZITE Praedikate gegen die Sitzungs-GUCs des
  -- Aufrufers geschrieben.
  --
  -- Ein Aufruf eines Invoker-Helfers wie `app.person_sichtbar()` wuerde HIER
  -- als `cse_definer` ausgewertet und fuer JEDE Person der Plattform `true`
  -- ergeben (`01-KERN.md` §3.2) — die Vorbedingung waere vorhanden, lesbar,
  -- plausibel und wirkungslos. `app.hat_recht()` ist unproblematisch: sie
  -- schluesselt auf `app.benutzer_id` aus der Sitzung, nicht auf die laufende
  -- Rolle.
  if v_mandant is null
     or not app.hat_recht('dienstplan.arbzg_pruefen', v_mandant)
     or not exists (select 1 from public.anstellung a
                     where a.person_id  = p_person
                       and a.mandant_id = v_mandant
                       and a.geloescht_am is null)
  then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  if p_bis - p_von > interval '35 days' then
    raise exception 'Fenster zu gross' using errcode = '22023';   -- a planner tool, not an export
  end if;

  -- Die Auditzeile wird VOR dem Ergebnis geschrieben, und sie zaehlt die
  -- fremden Fenster ausdruecklich. `get diagnostics … row_count` nach einem
  -- RETURN QUERY zaehlt zwar die Zeilen jener einen Anweisung, weiss aber
  -- nichts darueber, aus welchem Mandanten sie kamen — eine daraus gebaute
  -- Nutzlast koennte Fall 5 aus §6.8 nicht erfuellen („ein Aufruf, der ein
  -- fremdes Fenster liefert, hinterlaesst einen Eintrag, der das sagt",
  -- SEC-A9, LEG-09). Zuerst zu schreiben heisst ausserdem: auch ein
  -- abgebrochener oder nur teilweise gelesener Zugriff hinterlaesst seine Spur.
  select count(*), count(*) filter (where f.mandant_id <> v_mandant)
    into v_zeilen, v_fremde
    from zeit_intern.arbeitszeit_fenster f
   where f.person_id = p_person
     and f.aktiv
     and f.beginn_utc < p_bis
     and (f.ende_utc is null or f.ende_utc > p_von);

  perform app.protokolliere('arbzg.aggregat_gelesen', 'person', p_person::text,
            null,
            jsonb_build_object('von', p_von, 'bis', p_bis,
                               'zeilen', v_zeilen, 'fremde_zeilen', v_fremde));

  return query
  -- `convert_to(…, 'UTF8')`, nicht der woertliche `::text` aus §6.3: pgcrypto
  -- kennt nur `hmac(bytea, bytea, text)` und `hmac(text, text, text)`, und
  -- `app.fenster_schluessel()` liefert `bytea` — die Fassung des Dokuments legt
  -- NICHT an („function hmac(text, bytea, unknown) does not exist"). Die
  -- Kodierung wird ausdruecklich genannt: ein HMAC ueber Bytes, deren Kodierung
  -- niemand festlegt, ist zwischen zwei Installationen nicht derselbe Wert.
  select encode(hmac(convert_to(f.zuordnung_quelle_id::text, 'UTF8'),
                     app.fenster_schluessel(), 'sha256'), 'hex'),
         f.beginn_utc,
         f.ende_utc,
         greatest(0, (extract(epoch from (coalesce(f.ende_utc, now()) - f.beginn_utc)) / 60)::int
                     - f.pause_minuten),
         f.mandant_id <> v_mandant
    from zeit_intern.arbeitszeit_fenster f
   where f.person_id = p_person
     and f.aktiv
     and f.beginn_utc < p_bis
     and (f.ende_utc is null or f.ende_utc > p_von);
end $$;

revoke all on function app.arbzg_belastung(uuid, timestamptz, timestamptz) from public;
grant execute on function app.arbzg_belastung(uuid, timestamptz, timestamptz) to cse_app;

comment on function app.arbzg_belastung(uuid, timestamptz, timestamptz) is
  'K-06: Dauern und Intervallgrenzen, sonst nichts. Nie mandant_id, nie Name, '
  'Objekt, Kunde, Personalnummer oder Stundensatz. Jeder Aufruf schreibt '
  'audit_log mit aktion = arbzg.aggregat_gelesen.';

-- ---------------------------------------------------------------------------
-- 11. Der Nachtlauf hat keine Sitzung (§6.4)
-- ---------------------------------------------------------------------------

/**
 * `app.arbzg_belastung` beginnt mit `app.aktiver_mandant()` und einer
 * Rechtepruefung, und ein Supabase-Cronlauf hat weder das eine noch das andere.
 * Ohne zweite Tuer koennte der Nachtlauf ueberhaupt nicht laufen — und er ist
 * der EINZIGE Mechanismus, durch den eine Aenderung in Gesellschaft A im Plan
 * von B auftaucht, ohne dass A von B weiss. TIM-14 verkaeme sonst auf das, was
 * der Live-Pfad zufaellig mitbekommt.
 *
 * Die Tuer ist eng, und sie ist von HTTP aus nicht erreichbar. Vier
 * Eigenschaften machen sie hinnehmbar: sie liegt in `zeit_intern`, das
 * PostgREST nicht ausliefert (ein frueherer Entwurf legte sie in `zeit` und
 * begruendete sie mit dem Schutz von `zeit_intern` — der ganze Schutz haette
 * dann an einem einzigen EXECUTE-Grant gehangen); sie ist nur fuer `cse_job`
 * ausfuehrbar; sie schreibt bei jedem Aufruf `audit_log`; und die
 * Routenkarten-Pruefung aus K-08 stellt sicher, dass keine HTTP-Route sie
 * erreicht.
 *
 * Sie gibt `mandant_id` zurueck, weil der Schreiber aus §6.6 wissen muss, in
 * welche Gesellschaften ein Befund zu spiegeln ist. Dieser Wert verlaesst den
 * Jobprozess nicht, und die Zeilen, die er schreibt, tragen nur, was §5.11
 * erlaubt.
 *
 * KEINE 35-Tage-Grenze: §6.7 braucht sechs Monate fuer den Ausgleichszeitraum.
 * Die Grenze im Leser ist eine Schranke gegen Massenabzug, keine fachliche.
 */
create function zeit_intern.arbzg_belastung_job(p_person uuid, p_von timestamptz, p_bis timestamptz)
returns table (fenster_gruppe text, beginn_utc timestamptz, ende_utc timestamptz,
               minuten integer, mandant_id uuid)
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
begin
  perform app.protokolliere('arbzg.job_aggregat_gelesen', 'person', p_person::text,
            null, jsonb_build_object('von', p_von, 'bis', p_bis));

  return query
  -- `convert_to(…, 'UTF8')`, nicht der woertliche `::text` aus §6.3: pgcrypto
  -- kennt nur `hmac(bytea, bytea, text)` und `hmac(text, text, text)`, und
  -- `app.fenster_schluessel()` liefert `bytea` — die Fassung des Dokuments legt
  -- NICHT an („function hmac(text, bytea, unknown) does not exist"). Die
  -- Kodierung wird ausdruecklich genannt: ein HMAC ueber Bytes, deren Kodierung
  -- niemand festlegt, ist zwischen zwei Installationen nicht derselbe Wert.
  select encode(hmac(convert_to(f.zuordnung_quelle_id::text, 'UTF8'),
                     app.fenster_schluessel(), 'sha256'), 'hex'),
         f.beginn_utc,
         f.ende_utc,
         greatest(0, (extract(epoch from (coalesce(f.ende_utc, now()) - f.beginn_utc)) / 60)::int
                     - f.pause_minuten),
         f.mandant_id
    from zeit_intern.arbeitszeit_fenster f
   where f.person_id = p_person
     and f.aktiv
     and f.beginn_utc < p_bis
     and (f.ende_utc is null or f.ende_utc > p_von);
end $$;

revoke all on function zeit_intern.arbzg_belastung_job(uuid, timestamptz, timestamptz) from public;
grant execute on function zeit_intern.arbzg_belastung_job(uuid, timestamptz, timestamptz) to cse_job;

-- ---------------------------------------------------------------------------
-- 12. Die Reduktion, die ein fremdes Fenster unkenntlich macht (§5.11, §6.6)
-- ---------------------------------------------------------------------------

/**
 * Baut `arbeitszeit_verstoss.ursache` fuer GENAU EINEN Zielmandanten.
 *
 * `04-PLANUNG-ZEIT.md` §6.6 nennt sie `zeit.ursache_fuer_mandant` — und §0.3
 * desselben Dokuments haelt fest, dass es kein Schema `zeit` gibt und ein
 * frueherer Entwurf es erfunden hat. Zwei Stellen desselben Dokuments
 * widersprechen sich; aufgeloest wird es wie §0.3 die beiden anderen Faelle
 * aufloest — die Funktion wandert in ein Schema, das existiert, und zwar in
 * `zeit_intern`: sie ist ausschliesslich Innenteil des Definer-Schreibers, und
 * `zeit_intern` ist das Schema, das PostgREST nicht ausliefert.
 *
 * Die Regel: fuer ein Fenster, das NICHT aus dem Zielmandanten stammt, bleiben
 * `fenster_gruppe`, `beginn`, `ende`, `minuten` — und sonst nichts. `mandant_id`
 * faellt IN BEIDEN FAELLEN weg; die Quell-Id ueberlebt nur beim eigenen Fenster.
 *
 * Aufgebaut wird die Ausgabe aus einer WEISSEN LISTE, nie durch Entfernen von
 * Schluesseln aus der Eingabe. Der naheliegende Entwurf `elem - 'mandant_id'`
 * laesst jedes Feld durch, das ein spaeterer Aufrufer zusaetzlich mitgibt — und
 * das Leck entstuende dann in einer anderen Datei, ohne dass hier eine Zeile
 * angefasst wurde.
 */
create function zeit_intern.ursache_fuer_mandant(p_ursache jsonb, p_mandant uuid)
returns jsonb
language sql immutable set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(
           case when (elem ->> 'mandant_id') is not distinct from p_mandant::text then
             jsonb_build_object(
               'eigen',          true,
               'fenster_gruppe', elem -> 'fenster_gruppe',
               'beginn',         elem -> 'beginn',
               'ende',           elem -> 'ende',
               'minuten',        elem -> 'minuten')
             -- Nur das EIGENE Fenster behaelt seine Quell-Id, und den Schluessel
             -- gibt es nur, wenn der Aufrufer ihn mitgegeben hat: ein
             -- `"quelle_id": null` waere eine Aussage ueber ein Fenster, ueber
             -- das nichts ausgesagt werden sollte.
             || case when elem ? 'quelle_id'
                     then jsonb_build_object('quelle_id', elem -> 'quelle_id')
                     else '{}'::jsonb end
           else
             jsonb_build_object(
               'eigen',          false,
               'fenster_gruppe', elem -> 'fenster_gruppe',
               'beginn',         elem -> 'beginn',
               'ende',           elem -> 'ende',
               'minuten',        elem -> 'minuten')
           end
           order by ordinalitaet), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_ursache, '[]'::jsonb))
         with ordinality as t(elem, ordinalitaet);
$$;

revoke all on function zeit_intern.ursache_fuer_mandant(jsonb, uuid) from public;
grant execute on function zeit_intern.ursache_fuer_mandant(jsonb, uuid) to cse_definer;

comment on function zeit_intern.ursache_fuer_mandant(jsonb, uuid) is
  'K-06-Reduktion: fremde Fenster behalten fenster_gruppe, Grenzen und Minuten. '
  'mandant_id faellt immer weg. Weisse Liste, kein Entfernen von Schluesseln.';

-- ---------------------------------------------------------------------------
-- 13. app.arbzg_befund_schreiben — der einzige Schreiber (§6.6)
-- ---------------------------------------------------------------------------

/**
 * `arbeitszeit_verstoss` hat keine INSERT-Policy fuer `cse_app` (§5.11): eine
 * auf Mandant A verengte Anfrage kann die Spiegelzeile in Mandant B nicht
 * schreiben, und der Standard-`WITH CHECK (mandant_id = app.aktiver_mandant())`
 * machte die Vorzeigeanforderung TIM-14 wie entworfen unbaubar.
 *
 * `SESSION_USER`, nicht `CURRENT_USER`. In einem `SECURITY DEFINER`-Koerper,
 * der `cse_definer` gehoert (K-01), IST `current_user` gleich `cse_definer` —
 * fuer jeden Aufrufer. `current_user <> 'cse_job'` waere also immer wahr, der
 * `elsif`-Zweig wuerfe immer 42501, und der naechtliche Detektor koennte NIE
 * einen Befund schreiben. Er scheiterte genau in dem Moment, in dem ein
 * entitaetsuebergreifender Verstoss erkannt wurde, ausschliesslich im
 * Produktions-Cron, und in keinem sitzungsgestuetzten Test.
 * `SESSION_USER` ist von `SECURITY DEFINER` unberuehrt und nennt die Rolle, die
 * sich tatsaechlich verbunden hat.
 *
 * ZWEI Abweichungen vom woertlichen Text, beide erzwungen:
 *  1. `a.archiviert_am` → `a.geloescht_am` (siehe Abschnitt 10).
 *  2. Der `case`-Ausdruck fuer `erkannt_durch` braucht eine ausdrueckliche
 *     Umwandlung. Zwei unbekannt typisierte Zeichenketten in einem `case`
 *     loesen sich zu `text` auf, und in einem `insert … select` gibt es dorthin
 *     keine Zuweisungsumwandlung: der Koerper aus dem Dokument legt NICHT an
 *     („column erkannt_durch is of type erkennung_quelle but expression is of
 *     type text"). Nachgeprueft, nicht vermutet.
 */
create function app.arbzg_befund_schreiben(
    p_person       uuid,
    p_regel        arbzg_regel,
    p_schwere      verstoss_schwere,
    p_beginn       timestamptz,
    p_ende         timestamptz,
    p_ist_minuten  integer,
    p_grenzwert    integer,
    p_ursache      jsonb,
    p_mandanten    uuid[])                 -- every entity that contributed a window
returns setof uuid
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_aufrufer uuid := app.aktiver_mandant();
        v_m uuid;
begin
  if v_aufrufer is not null then
    if not app.hat_recht('dienstplan.arbzg_pruefen', v_aufrufer)
       or not exists (select 1 from public.anstellung a
                       where a.person_id = p_person and a.mandant_id = v_aufrufer
                         and a.geloescht_am is null)
    then raise exception 'nicht berechtigt' using errcode = '42501'; end if;
  elsif session_user <> 'cse_job' then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  foreach v_m in array p_mandanten loop
    return query
    insert into public.arbeitszeit_verstoss
          (mandant_id, person_id, anstellung_id, regel, schwere,
           zeitraum_beginn, zeitraum_ende, ist_minuten, grenzwert_minuten,
           betrifft_fremden_mandant, ursache, fingerprint, erkannt_durch, erstellt_von_art)
    select v_m, p_person, a.id, p_regel, p_schwere, p_beginn, p_ende, p_ist_minuten, p_grenzwert,
           array_length(p_mandanten, 1) > 1,
           zeit_intern.ursache_fuer_mandant(p_ursache, v_m),   -- foreign windows reduced, §5.11
           encode(digest(v_m::text || p_person::text || p_regel::text ||
                         (p_beginn at time zone 'Europe/Berlin')::date::text, 'sha256'), 'hex'),
           (case when v_aufrufer is null then 'detektor_job' else 'planung_live' end)::erkennung_quelle,
           'system'
      from public.anstellung a
     where a.person_id = p_person and a.mandant_id = v_m and a.geloescht_am is null
     limit 1
    on conflict (mandant_id, fingerprint) where hinfaellig_am is null
    do update set ist_minuten = excluded.ist_minuten, ursache = excluded.ursache,
                  zeitraum_beginn = excluded.zeitraum_beginn, zeitraum_ende = excluded.zeitraum_ende,
                  geaendert_am = now()
    returning id;
  end loop;

  perform app.protokolliere('arbzg.befund_geschrieben', 'person', p_person::text,
            null, jsonb_build_object('regel', p_regel, 'mandanten', p_mandanten));
end $$;

revoke all on function app.arbzg_befund_schreiben(uuid, arbzg_regel, verstoss_schwere, timestamptz,
                                                  timestamptz, integer, integer, jsonb, uuid[])
  from public;
-- `cse_app` fuer den Live-Pfad (§6.5), `cse_job` fuer den Nachtlauf (§6.4).
-- Und sonst nichts. Einziger Aufrufer: `src/server/services/arbzg/`.
grant execute on function app.arbzg_befund_schreiben(uuid, arbzg_regel, verstoss_schwere, timestamptz,
                                                     timestamptz, integer, integer, jsonb, uuid[])
  to cse_app, cse_job;

comment on function app.arbzg_befund_schreiben(uuid, arbzg_regel, verstoss_schwere, timestamptz,
                                               timestamptz, integer, integer, jsonb, uuid[]) is
  'Der EINZIGE Schreiber von arbeitszeit_verstoss (K-06/§6.6). Spiegelt den '
  'Befund in jede beteiligte Gesellschaft; prueft vorher, dass der Aufrufer im '
  'aktiven Mandanten fuer diese Person zustaendig war. session_user, nie '
  'current_user — sonst kann der Nachtlauf nie schreiben.';

/**
 * Das eine Feld, das ein Planer an einem Befund aendert (§5.11).
 *
 * Es braucht eine eigene Tuer, weil die Tabelle auch keine UPDATE-Policy fuer
 * `cse_app` hat. Ohne sie waere ein Befund nicht quittierbar — und ein
 * Konfliktbrett, das sich nicht abarbeiten laesst, wird ignoriert, was schlimmer
 * ist als eines, das nichts anzeigt.
 *
 * Geprueft wird `dienstplan.arbzg_lesen` IM MANDANTEN DES BEFUNDS, nicht im
 * aktiven: die gespiegelte Zeile liegt eventuell in der anderen Gesellschaft,
 * und ein Planer quittiert nur, was seine eigene Gesellschaft angeht.
 */
create function app.arbzg_befund_quittieren(p_id uuid, p_begruendung text)
returns void
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_mandant uuid;
begin
  select v.mandant_id into v_mandant
    from public.arbeitszeit_verstoss v where v.id = p_id;

  -- Kein Unterschied zwischen „gibt es nicht" und „darf ich nicht": ein
  -- unterscheidbarer Fehler bestaetigte die Existenz der Zeile (AUT-06).
  if v_mandant is null
     or v_mandant is distinct from app.aktiver_mandant()
     or not app.hat_recht('dienstplan.arbzg_lesen', v_mandant)
     or app.ist_readonly()
  then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  if btrim(coalesce(p_begruendung, '')) = '' then
    raise exception 'Eine Quittierung ohne genannten Grund ist bei einer Pruefung wertlos'
      using errcode = 'check_violation';
  end if;

  update public.arbeitszeit_verstoss v
     set status                  = 'quittiert',
         quittierung_begruendung = p_begruendung,
         quittiert_von           = app.aktueller_benutzer(),
         quittiert_am            = now(),          -- Serveruhr, nie die des Klienten
         geaendert_von_art       = 'mensch',
         geaendert_von           = app.aktueller_benutzer()
   where v.id = p_id and v.hinfaellig_am is null;

  perform app.protokolliere('arbzg.befund_quittiert', 'arbeitszeit_verstoss', p_id::text,
            null, jsonb_build_object('begruendung', p_begruendung), v_mandant);
end $$;

revoke all on function app.arbzg_befund_quittieren(uuid, text) from public;
grant execute on function app.arbzg_befund_quittieren(uuid, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 14. Zeilenschutz — arbeitszeit_verstoss (§1.3, §5.11)
-- ---------------------------------------------------------------------------

alter table arbeitszeit_verstoss enable row level security;
alter table arbeitszeit_verstoss force  row level security;

/**
 * LESEN unter `dienstplan.arbzg_lesen` — und KEIN Schreib-Gegenstueck.
 *
 * Die Policy ist `for select`, nicht `for all`: ein `for all` mit `WITH CHECK`
 * waere genau der Standardfall, den §6.6 als unbaubar nachweist. Wer sie
 * spaeter „der Symmetrie zuliebe" auf `for all` erweitert, macht TIM-14 wieder
 * kaputt — der Befund landete dann nur noch in der Gesellschaft des Aufrufers,
 * und die andere Planung erfuehre nichts.
 */
create policy t_mandant on arbeitszeit_verstoss for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('dienstplan.arbzg_lesen', app.aktiver_mandant())));

/**
 * Gruppensicht unter EIGENEM Schluessel: `gruppe.dienstplan.arbzg_lesen`, nicht
 * `gruppe.dienstplan.lesen`.
 *
 * Die Trennung ist der Punkt (K-06). Ein ArbZG-Befund ist die eine Zeile dieser
 * Domaene, die ueber Gesellschaften hinweg von einem MENSCHEN handelt (D-09);
 * ihn an den gewoehnlichen Modul-Gruppenschluessel zu binden gaebe jedem, der
 * einen Gruppendienstplan sehen darf, die entitaetsuebergreifenden
 * Arbeitszeitbefunde jedes Beschaeftigten — also genau die Aggregation, die
 * §6.3 auf eine Definer-Funktion mit Dauern und Grenzen einschraenkt.
 *
 * Der Schluessel ist ausdrueckbar: `03-AUTH-BERECHTIGUNGEN.md` §7.2 hat die
 * Gruppengrammatik auf `gruppe.<modul>.[<objekt> '_'] <aktion>` erweitert,
 * gerade damit er und `gruppe.system.audit_lesen` existieren koennen
 * (objekt = `dienstplan_arbzg`, aktion = `lesen`). 0008 fuehrt die Zeile.
 */
create policy t_gruppe on arbeitszeit_verstoss for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstplan.arbzg_lesen')));

/**
 * KEINE Selbstauskunft fuer Mitarbeitende und keine fuer Kunden (EMP-13, §1.3).
 *
 * Ein Arbeitnehmer sieht seine Schichten, nicht die Bewertung des Arbeitgebers
 * darueber; ein Kunde sieht die Besetzungsliste ohnehin nicht. Die K-04-Decke
 * ist deshalb entartet: in beiden Portalen trifft diese Tabelle null Zeilen.
 * Sie steht trotzdem da — eine Tabelle, die an `person_id`/`anstellung_id`
 * haengt und KEINE Decke traegt, ist nach K-04 ein Aufbaufehler, und der
 * Unterschied zwischen „bewusst entartet" und „vergessen" ist der ganze Punkt.
 */
create policy p_ma_decke on arbeitszeit_verstoss as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on arbeitszeit_verstoss as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

-- Die Definer-Policies aus §1.1. Schreiben und Quittieren laufen
-- ausschliesslich hierueber.
create policy verstoss_definer_write on arbeitszeit_verstoss
  as permissive for insert to cse_definer with check (true);
create policy verstoss_definer_update on arbeitszeit_verstoss
  as permissive for update to cse_definer using (true) with check (true);
create policy verstoss_definer_read on arbeitszeit_verstoss
  as permissive for select to cse_definer using (true);

-- `job:aufbewahrung` traegt Fristen ein (§13); der Detektor liest zur
-- Ueberholung (§6.7). Beides ohne Zeilenschranke: eine, die hinfaellige Zeilen
-- aussperrte, liesse den Fristenlauf genau sie ueberspringen — lautlos als
-- „null Zeilen betroffen".
create policy t_job on arbeitszeit_verstoss for select to cse_job using (true);
create policy t_job_frist on arbeitszeit_verstoss for update to cse_job
  using (true) with check (true);

-- NUR `select` fuer `cse_app`. Kein `insert`, kein `update` — die zwei Rechte,
-- deren Fehlen K-06 ausdruecklich verlangt.
grant select on arbeitszeit_verstoss to cse_app;
grant select, insert, update on arbeitszeit_verstoss to cse_definer;
grant select on arbeitszeit_verstoss to cse_job;
grant update (aufbewahrung_bis, loeschsperre, hinfaellig_am, status) on arbeitszeit_verstoss to cse_job;

-- ---------------------------------------------------------------------------
-- 15. Zeilenschutz — planungs_konflikt (§1.3, §5.10)
-- ---------------------------------------------------------------------------

alter table planungs_konflikt enable row level security;
alter table planungs_konflikt force  row level security;

create policy t_mandant on planungs_konflikt for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('dienstplan.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstplan.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on planungs_konflikt for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstplan.lesen')));

-- Wie oben: keine Selbstauskunft (EMP-13), die Decke bleibt und ist entartet.
create policy p_ma_decke on planungs_konflikt as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on planungs_konflikt as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Die Nachtlaeufe schreiben hier wirklich: `job:arbzg_detektor` setzt den
 * `arbzg`-Zeiger, `job:qualifikation_revalidieren` die entfallene
 * Qualifikation, `job:aufzeichnungsfrist` die §17-MiLoG-Frist (§14.3). Ohne
 * eigene Policy traefen sie unter `FORCE RLS` null Zeilen — und ein Detektor,
 * der nichts schreibt, sieht aus wie ein sauberer Plan.
 */
create policy t_job on planungs_konflikt for select to cse_job using (true);
create policy t_job_anlegen on planungs_konflikt for insert to cse_job with check (true);
create policy t_job_fortschreiben on planungs_konflikt for update to cse_job
  using (true) with check (true);

grant select, insert, update on planungs_konflikt to cse_app;
grant select, insert, update on planungs_konflikt to cse_job;

/**
 * Quittieren verlangt ein eigenes Recht und die Serveruhr (§5.10).
 *
 * `dienstplan.lesen` reicht zum Sehen; das Wegklicken eines Konflikts ist eine
 * andere Handlung — bei einer Gewerbeaufsichtspruefung ist die Quittierung die
 * Aussage „wir haben es bemerkt und Folgendes entschieden".
 *
 * Der Zeitpunkt kommt vom Server, nicht vom Aufrufer: `DEFAULT now()` greift
 * nur bei WEGGELASSENER Spalte, und ein UPDATE, der einen Wert mitschickt,
 * schriebe einen beliebigen Zeitpunkt (Invariante 5, §1.8).
 */
create function kern.planungs_konflikt_quittierung() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status = 'quittiert' and old.status is distinct from 'quittiert' then
    if not app.hat_recht('dienstplan.konflikt_quittieren', new.mandant_id) then
      raise exception 'dienstplan.konflikt_quittieren fehlt'
        using errcode = 'insufficient_privilege';
    end if;
    new.quittiert_am  := now();
    new.quittiert_von := coalesce(new.quittiert_von, app.aktueller_benutzer());
  end if;

  -- Ueberholung ist ebenfalls ein Serverereignis.
  if new.hinfaellig_am is not null and old.hinfaellig_am is null then
    new.hinfaellig_am := now();
  end if;
  return new;
end $$;

create trigger trg_pk_quittierung
  before update on planungs_konflikt
  for each row execute function kern.planungs_konflikt_quittierung();

-- ---------------------------------------------------------------------------
-- 16. Fremdschluessel und Ausloeser, die eine spaetere Migration nachtraegt
-- ---------------------------------------------------------------------------

/**
 * Zwei Elternteile existieren heute noch nicht.
 *
 * Die Spalten stehen oben, die Fremdschluessel NICHT. Ein einspaltiger
 * Fremdschluessel auf eine Tabelle mit `mandant_id` ist nach K-16 ein
 * Pruefungsfehler — er liesse einen Konflikt der Reinigung auf einen
 * Zeiteintrag der Security zeigen. Lieber gar keiner als der falsche; die
 * Migration, die den Elternteil anlegt, traegt ihn nach. Woertlich diese
 * Anweisungen (§14.4):
 *
 *   -- mit `zeiteintrag` (PR 34):
 *   alter table planungs_konflikt add constraint pk_zeiteintrag_fk
 *     foreign key (mandant_id, zeiteintrag_id) references zeiteintrag (mandant_id, id);
 *   alter table arbeitszeit_verstoss add constraint av_zeiteintrag_fk
 *     foreign key (mandant_id, zeiteintrag_id) references zeiteintrag (mandant_id, id);
 *   -- und der dritte Projektionsausloeser, dessen Koerper in Abschnitt 6 steht.
 *
 *   -- mit `qualifikation` (PR 31, 0030):
 *   alter table planungs_konflikt add constraint pk_qualifikation_fk
 *     foreign key (qualifikation_id) references qualifikation (id);
 *
 * Der letzte ist EINSPALTIG, und das ist hier die richtige Form und keine
 * Nachlaessigkeit: `qualifikation` ist ein Katalog, dessen `mandant_id` nullbar
 * ist — gruppenweite Zeilen haben keinen Mandanten, den ein zusammengesetzter
 * Schluessel nennen koennte. Aufgefuehrt, damit die Schema-Pruefung („kein
 * einspaltiger Verweis auf eine Tabelle mit mandant_id") weiss, dass dies die
 * beabsichtigte Ausnahme ist — dieselbe, die 0028 fuer `feiertag_id` und
 * `job_lauf_id` benannt hat.
 */

-- ---------------------------------------------------------------------------
-- 17. Rechteschluessel (K-19) — abgeglichen, nichts nachzutragen
-- ---------------------------------------------------------------------------

/**
 * `app.hat_recht()` antwortet auf einen Schluessel, den der Katalog nicht
 * kennt, dauerhaft `false` — fehlerfrei, ohne Logzeile, als Bildschirm, der
 * immer leer bleibt. Deshalb wird hier nicht vermutet, sondern nachgesehen.
 *
 * Die vier Schluessel, die diese Migration schreibt —
 * `dienstplan.arbzg_pruefen` (Abschnitte 10 und 13),
 * `dienstplan.arbzg_lesen` (Abschnitte 13 und 14),
 * `gruppe.dienstplan.arbzg_lesen` (Abschnitt 14),
 * `dienstplan.konflikt_quittieren` (Abschnitt 15) —
 * sowie `dienstplan.lesen` und `dienstplan.schreiben` stehen bereits als
 * Katalogzeilen in 0008_berechtigung_matrix.sql; ebenso alle sechzehn, die
 * §1.3/§2.3 Nr. 5 fuer diese Domaene aufzaehlen. Diese Migration legt deshalb
 * KEINE Katalogzeile an — eine zweite Zeile fuer denselben Schluessel waere ein
 * Schluesselkonflikt, und eine „sicherheitshalber" eingefuegte
 * `on conflict do nothing`-Zeile verschleierte den Fall, in dem der Katalog
 * tatsaechlich abweicht.
 *
 * Nachgesehen wurde gegen `docs/architecture/03-AUTH-BERECHTIGUNGEN.md` §12.4
 * und gegen die Rollenzuweisungen in 0008: `dienstplan.arbzg_lesen` und
 * `dienstplan.arbzg_pruefen` liegen bei `super_admin`, `admin` und `leitung`;
 * `gruppe.dienstplan.arbzg_lesen` allein bei `super_admin`.
 */

-- ---------------------------------------------------------------------------
-- 18. Nachzutragen in `src/server/db/schema/rls.ts`
-- ---------------------------------------------------------------------------

/**
 * Der Block darunter ist die Ausgabe von `scripts/generate-triggers.ts` fuer
 * diese Migration. Die Registry, aus der er entsteht, liegt in einer
 * TypeScript-Datei, die dieser Auftrag nicht anfassen darf — deshalb steht er
 * hier von Hand, in genau der Form, die der Generator erzeugt, und die
 * Registrierung ist der noch fehlende Handgriff:
 *
 *   `scripts/generate-triggers.ts` → MIGRATIONS_DATEIEN:
 *     '0040': join(WURZEL, 'drizzle/0040_arbzg_konflikt.sql'),
 *
 *   `src/server/db/schema/rls.ts` → KEIN_HARD_DELETE (Reihenfolge wie unten),
 *   je Eintrag `migration: '0040'` und der `grund`, der unten im Kommentar
 *   steht: arbeitszeit_verstoss (art 'archiv'), planungs_konflikt (art 'archiv').
 *
 *   `src/server/db/schema/rls.ts` → GEAENDERT_AM: arbeitszeit_verstoss,
 *   planungs_konflikt, ebenfalls '0040'.
 *
 *   `src/server/db/schema/rls.ts` → AUDITIERT: arbeitszeit_verstoss,
 *   planungs_konflikt (§14.1 fuehrt beide unter `app.protokolliere()`; die
 *   Ausloeser stehen im Block unten).
 *
 *   `src/server/db/schema/rls.ts` → NUR_UEBER_DEFINER:
 *   `zeit_intern.arbeitszeit_fenster`, zugang
 *   `zeit_intern.fenster_setzen / app.arbzg_belastung`, mit dem K-06-Grund.
 *   Dieser Eintrag ist der wichtigste von allen: eine Tabelle, die einfach
 *   keine Policy hat, sieht genauso aus wie eine, bei der jemand sie vergessen
 *   hat — und der Unterschied ist hier der ganze Sicherheitsentwurf.
 *
 * `zeit_intern.arbeitszeit_fenster` steht NICHT im Block unten: der Generator
 * schreibt `before delete on <tabelle>` ohne Schemaqualifizierung, was fuer ein
 * Schema ausserhalb von `public` auf die falsche Relation zeigte. Ihre
 * Loeschsperre steht deshalb von Hand in Abschnitt 3, und die Registry braucht
 * ein Schemafeld, bevor sie sie aufnehmen kann.
 *
 * Bis die Registrierung nachgezogen ist, schlaegt
 * `tests/isolation/unveraenderbarkeit.test.ts` (4) fehl — „eine Tabelle traegt
 * den Ausloeser, ohne registriert zu sein". Das ist die richtige Haelfte der
 * Wahl: die Alternative waere ein ArbZG-Befund, der sich in einer Anweisung
 * loeschen laesst (Invariante 8).
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0040)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- arbeitszeit_verstoss (archiv): LEG-03, TIM-14, § 16 Abs. 2 ArbZG. Der Befund ist der Nachweis, dass die Gruppe eine Ueberschreitung BEMERKT hat — bei einer Gewerbeaufsicht die entscheidende Zeile. Geloescht waere er die Behauptung, es habe ihn nie gegeben; aufgeloest bekommt er hinfaellig_am, bearbeitet quittiert_am.
create trigger trg_arbeitszeit_verstoss_kein_hard_delete
  before delete on arbeitszeit_verstoss
  for each row execute function kern.verhindere_loeschung();
create trigger trg_arbeitszeit_verstoss_kein_truncate
  before truncate on arbeitszeit_verstoss
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on arbeitszeit_verstoss from cse_app, cse_anon, cse_checkin, cse_job;

-- planungs_konflikt (archiv): TIM-05, TIM-06. Ein quittierter Konflikt ist die Spur der Entscheidung, trotzdem zu planen — samt Begruendung und Urheber. Ihn zu loeschen macht aus einer bewussten Abweichung eine, die nie jemand gesehen hat.
create trigger trg_planungs_konflikt_kein_hard_delete
  before delete on planungs_konflikt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_planungs_konflikt_kein_truncate
  before truncate on planungs_konflikt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on planungs_konflikt from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_arbeitszeit_verstoss_geaendert_am
  before update on arbeitszeit_verstoss
  for each row execute function kern.setze_geaendert_am();
create trigger trg_planungs_konflikt_geaendert_am
  before update on planungs_konflikt
  for each row execute function kern.setze_geaendert_am();

create trigger trg_arbeitszeit_verstoss_audit
  after insert or update or delete on arbeitszeit_verstoss
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_planungs_konflikt_audit
  after insert or update or delete on planungs_konflikt
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
