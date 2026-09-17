-- 0265 — Der Veroeffentlichungsvorgang des Dienstplans (TIM-01, NOT-01, O-710…O-713).

/**
 * **Was hier NICHT entsteht: ein Zustand `veroeffentlicht` auf `einsatz`.**
 *
 * `drizzle/0028_dienstplan.sql` sagt es woertlich und
 * `docs/architecture/02-datenmodell/04-PLANUNG-ZEIT.md` §224 wiederholt es
 * (K-17): `einsatz_status` ist ('geplant','laufend','abgeschlossen',
 * 'storniert'), und ein Wert `veroeffentlicht` fehlt mit ABSICHT.
 * `dienstplan.veroeffentlichen` ist ein Recht auf eine HANDLUNG — einen
 * Veroeffentlichungsablauf je Schicht zu modellieren, den die SPEC nicht
 * beschreibt, waere eine erfundene Geschaeftsregel.
 *
 * **Was hier entsteht, ist der Vorgang selbst.** Eine Veroeffentlichung ist
 * ein Ereignis ueber einem ZEITRAUM: jemand hat an einem Zeitpunkt gesagt,
 * dass dieses Fenster nun gilt, und die betroffenen Menschen haben eine
 * Meldung bekommen. Das ist eine Zeile, die stehen bleibt — kein Feld, das
 * sich umschalten laesst. Deshalb `append`: es gibt hier keine
 * Liveness-Spalte und keinen Weg, eine zu schreiben (K-16).
 *
 * **Vier Fragen sind offen, und die Tabelle beantwortet keine davon:**
 *
 *  - O-710: Welcher Zeitraum wird veroeffentlicht — Woche, Monat, freies
 *    Fenster? `umfang` traegt deshalb die drei kandidierenden Werte als
 *    ausdruecklich bezeichneten Platzhalter und KEINEN Aufzaehlungstyp: ein
 *    Enum waere die Behauptung, die Liste sei entschieden.
 *  - O-711: Wer wird benachrichtigt — jede eingeteilte Person, oder auch
 *    Personen mit gestrichener Schicht? `empfaenger_anzahl` zaehlt, WEN diese
 *    Veroeffentlichung erreicht hat, und `umfang_daten` haelt die Abgrenzung
 *    fest, die dabei galt. Die Regel selbst steht nicht hier.
 *  - O-712: Was bedeutet eine AENDERUNG nach der Veroeffentlichung — neue
 *    Meldung, Sperre, gar nichts? Es gibt deshalb keinen Verweis von
 *    `einsatz` hierher und keinen Ausloeser, der eine Aenderung abwiese.
 *  - O-713: Ist eine veroeffentlichte Schicht gegen stille Aenderung
 *    geschuetzt? Nein — und zwar nicht aus Versehen: ein Schutz, den niemand
 *    bestellt hat, waere eine Sperre, die die Disposition am Einsatztag
 *    lahmlegt.
 *
 * Die Zeile ist damit heute genau eines: der BELEG, dass jemand an einem
 * Zeitpunkt einen Zeitraum bekanntgegeben hat, mit Urheber, Serverzeit und
 * Umfang. Das ist weniger, als ein Veroeffentlichungsablauf waere — und mehr,
 * als es vorher gab, naemlich nichts.
 *
 * TODO(client, O-710): Welcher Zeitraum wird veroeffentlicht — die Kalenderwoche, der Kalendermonat oder ein frei gewaehltes Fenster?
 * TODO(client, O-711): Wer wird bei einer Veroeffentlichung benachrichtigt — jede im Zeitraum eingeteilte Person, oder auch Personen, deren Schicht gestrichen wurde?
 * TODO(client, O-712): Was bedeutet eine Aenderung des Plans NACH der Veroeffentlichung — eine neue Meldung an die Betroffenen, eine Sperre, oder gar nichts? Und sperren blockierende Konflikte im Fenster die Veroeffentlichung?
 * TODO(client, O-713): Ist eine veroeffentlichte Schicht gegen stille Aenderung geschuetzt, und wenn ja: wer darf sie danach noch aendern und unter welcher Protokollpflicht?
 */

-- ---------------------------------------------------------------------------
-- 1. Die Tabelle
-- ---------------------------------------------------------------------------

create table dienstplan_veroeffentlichung (
  id                uuid not null default gen_random_uuid(),
  mandant_id        uuid not null references mandant(id),

  /**
   * Der Zeitraum in BERLINER Kalendertagen, beide Grenzen inklusiv (K-11,
   * Invariante 2).
   *
   * Als `date` und nicht als `timestamptz`-Spanne: ein Planer gibt „die Woche
   * vom 21. bis 27." bekannt, nicht ein Instantintervall. Welche Schichten in
   * dieses Fenster fallen, entscheidet die Abfrage in
   * `src/server/services/dienstplan/veroeffentlichung.ts` — und die loest die
   * Tage ueber `at time zone 'Europe/Berlin'` zu Instants auf, damit die
   * Nachtschicht des letzten Tages mitzaehlt.
   */
  zeitraum_von      date not null,
  zeitraum_bis      date not null,

  /**
   * **Platzhalter, O-710.** Welche Zeitraumarten es geben soll, ist
   * unbeantwortet; bis dahin sind es diese drei, und die Oberflaeche bietet
   * `woche` und `freier_zeitraum` an. KEIN Aufzaehlungstyp — ein neuer Wert
   * in einem Enum braucht eine eigene Migration und eine eigene Transaktion,
   * und genau das soll die Antwort auf O-710 nicht kosten.
   */
  umfang            text not null,

  /**
   * Was beim Veroeffentlichen im Fenster STAND — nicht, was heute darin
   * steht.
   *
   * Ohne diese Zahlen waere die Zeile im Streitfall wertlos: „am 14. wurde
   * die Woche veroeffentlicht" beantwortet nicht, ob damals eine Schicht
   * unbesetzt war. Gezaehlt, nicht gerechnet — die Werte kommen aus
   * derselben getesteten Abfrage, die die Vorschau zeigt (Invariante 6).
   */
  schichten_anzahl  integer not null,
  unbesetzt_anzahl  integer not null,
  konflikte_offen   integer not null,
  konflikte_blockierend integer not null,
  /** Wie viele Menschen eine Meldung bekommen haben (NOT-01). */
  empfaenger_anzahl integer not null default 0,
  /**
   * Wie viele KEINE bekommen konnten, weil sie keinen Zugang haben (D-09).
   *
   * Sie steht daneben und wird nicht verschwiegen: eine Veroeffentlichung,
   * die die Haelfte der Kolonne nicht erreicht, ist keine Bekanntgabe, und
   * der Planer muss das sehen, solange er noch anrufen kann.
   */
  ohne_zugang_anzahl integer not null default 0,

  /** Die Abgrenzung, die bei diesem Vorgang galt (O-711) — als Beleg. */
  umfang_daten      jsonb not null default '{}'::jsonb,

  notiz             text,

  /** Serveruhr, nie die des Klienten (Invariante 5). */
  veroeffentlicht_am timestamptz not null default now(),
  veroeffentlicht_von uuid not null references benutzer(id),

  aufbewahrung_bis  date,
  loeschsperre      boolean not null default false,

  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid references agent(id),

  constraint dienstplan_veroeffentlichung_pk primary key (mandant_id, id),
  constraint dienstplan_veroeffentlichung_id_uk unique (id),
  constraint dv_zeitraum_geordnet check (zeitraum_bis >= zeitraum_von),
  /**
   * Hoechstens ein Jahr. Nicht eine Geschaeftsregel, sondern eine Wache gegen
   * den Tippfehler: ein Fenster ueber zehn Jahre erzeugte eine Meldung je
   * Person je Schicht und waere als „Bekanntgabe" nicht wiedergutzumachen.
   */
  constraint dv_zeitraum_begrenzt check (zeitraum_bis - zeitraum_von <= 366),
  constraint dv_umfang_platzhalter
    check (umfang in ('woche', 'monat', 'freier_zeitraum')),
  constraint dv_zahlen_nicht_negativ
    check (schichten_anzahl >= 0 and unbesetzt_anzahl >= 0
           and konflikte_offen >= 0 and konflikte_blockierend >= 0
           and empfaenger_anzahl >= 0 and ohne_zugang_anzahl >= 0)
);

comment on table dienstplan_veroeffentlichung is
  'TIM-01, NOT-01. Der BELEG einer Bekanntgabe: wer hat wann welchen Zeitraum '
  'veroeffentlicht, was stand darin, und wie viele Menschen hat die Meldung erreicht. '
  'Kein Zustand je Schicht (K-17) und kein Einfrieren — O-710 bis O-713 sind offen.';

comment on column dienstplan_veroeffentlichung.umfang is
  'Platzhalter fuer O-710. Drei kandidierende Werte als CHECK, kein Enum — die '
  'Antwort soll keine Enum-Migration kosten.';

comment on column dienstplan_veroeffentlichung.umfang_daten is
  'Die Abgrenzung dieses Vorgangs (O-711) als Beleg — nie als Regel gelesen.';

/**
 * Der Zugriffsweg der Seite: der letzte Vorgang, der einen Tag ueberdeckt.
 *
 * Absteigend nach `veroeffentlicht_am`, weil derselbe Zeitraum mehrfach
 * bekanntgegeben werden darf (eine Aenderung ist eine zweite Bekanntgabe,
 * O-712) und dann die JUENGSTE gilt.
 */
create index dv_zeitraum_idx
  on dienstplan_veroeffentlichung (mandant_id, zeitraum_von, veroeffentlicht_am desc);

-- ---------------------------------------------------------------------------
-- 2. RLS (Invariante 3)
-- ---------------------------------------------------------------------------

alter table dienstplan_veroeffentlichung enable row level security;
alter table dienstplan_veroeffentlichung force  row level security;

/**
 * **Gelesen mit `dienstplan.lesen`, nicht mit `dienstplan.veroeffentlichen`.**
 *
 * Wer den Plan sehen darf, darf sehen, ob er bekanntgegeben ist — sonst
 * stuende auf dem Wochenplan eines Disponenten nicht, ob die Kolonne ihn
 * schon kennt. Bekanntgeben darf er darum nicht.
 */
create policy t_dv_lesen on dienstplan_veroeffentlichung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('dienstplan.lesen', app.aktiver_mandant())));

/**
 * **Kein `for all`, kein UPDATE — nur INSERT.**
 *
 * Eine Bekanntgabe ist ein Ereignis. Sie nachtraeglich zu aendern hiesse, die
 * Aussage „am 14. wurde dieses Fenster veroeffentlicht" umzuschreiben, und
 * genau diese Aussage ist der ganze Wert der Zeile. Korrigiert wird durch
 * eine zweite Bekanntgabe (O-712).
 */
create policy t_dv_anlegen on dienstplan_veroeffentlichung for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('dienstplan.veroeffentlichen',
                                        app.aktiver_mandant())));

/** Lesend in der Gruppenansicht, nie schreibend (Invariante 10). */
create policy t_dv_gruppe on dienstplan_veroeffentlichung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.dienstplan.lesen')));

/**
 * K-04: Der Kundenzugang hat hier nichts zu suchen, und das Mitarbeiterportal
 * auch nicht.
 *
 * Restriktiv, also UND-verknuepft — eine zweite erlaubende Policy waere ein
 * ODER und machte aus der Decke ein Loch. Die Person erfaehrt von der
 * Veroeffentlichung durch ihre BENACHRICHTIGUNG und ihren Plan, nicht durch
 * den Verwaltungsvorgang darueber: dort stehen Zahlen ueber die ganze
 * Kolonne.
 */
create policy p_dv_portal_decke on dienstplan_veroeffentlichung
  as restrictive for all to cse_app
  using      (app.portal() = 'intern')
  with check (app.portal() = 'intern');

/** Der SEC-DEFINER-Schreibweg aus 0266 laeuft als `cse_definer`. */
create policy d_dv_anlegen on dienstplan_veroeffentlichung for insert to cse_definer
  with check (true);
create policy d_dv_lesen on dienstplan_veroeffentlichung for select to cse_definer
  using (true);

grant select, insert on dienstplan_veroeffentlichung to cse_app;
grant select, insert on dienstplan_veroeffentlichung to cse_definer;

-- ---------------------------------------------------------------------------
-- 3. Keine harte Loeschung (Invariante 8) — erzeugt, siehe 0175.
-- ---------------------------------------------------------------------------

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0265)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- dienstplan_veroeffentlichung (append): TIM-01, NOT-01, LEG-03. Sie ist der Beleg, dass ein Zeitraum an einem Zeitpunkt bekanntgegeben wurde — im Streit ueber eine Schicht, von der jemand nichts gewusst haben will, genau die Zeile, die zaehlt. Es gibt nichts, was eine Bekanntgabe beendet: eine Aenderung ist eine zweite Zeile, nie ein Loeschen der ersten.
create trigger trg_dienstplan_veroeffentlichung_kein_hard_delete
  before delete on dienstplan_veroeffentlichung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dienstplan_veroeffentlichung_kein_truncate
  before truncate on dienstplan_veroeffentlichung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dienstplan_veroeffentlichung from cse_app, cse_anon, cse_checkin, cse_job;


-- >>> Ende des generierten Blocks
