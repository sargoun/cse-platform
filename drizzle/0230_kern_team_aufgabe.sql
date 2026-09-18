-- 0230 — Teams und Aufgaben (OPS-11, CAL-01, DSH-01, NOT-01, SPEC §14).

/**
 * **Die Aufgabe hat gefehlt, und zwar als Tabelle.**
 *
 * `04-SEITENKARTE.md` §5.6 fuehrt `/portal/[mandant]/aufgaben` und
 * `/aufgaben/[id]`, DSH-01 verlangt „anstehende Aufgaben" auf der Uebersicht,
 * und SPEC §14 laesst sieben Waechter naechtlich Befunde schreiben, die
 * jemand abarbeiten soll. Die Tabelle dafuer gab es nicht — also gab es die
 * Befunde als Benachrichtigung (eine Zeile, die man wegklickt) und nicht als
 * Aufgabe (eine Zeile, die offen BLEIBT, bis jemand sie schliesst). Das ist
 * der ganze Unterschied zwischen einer Meldung und einer Pflicht.
 *
 * **Drei Tabellen, nicht eine.** `aufgabe.zugewiesen_team_id` zeigt auf ein
 * TEAM, und der Entwurf des Datenmodells trug dort Freitext. Freitextnamen
 * laufen am ersten Tag auseinander („Reinigung Nord" gegen „reinigung-nord"),
 * und der Filter liefert danach Teilmengen ohne Fehlermeldung
 * (06-RADAR-KI-INHALT.md §7.5). Deshalb `team` und `team_mitglied`, und
 * deshalb hier: beide werden auch vom Kalender gebraucht, aber niemand hat
 * sie angelegt.
 *
 * **Eine Zeile ist auch OHNE internen Bezug gueltig.** Vier Waechter aus
 * SPEC §14 melden etwas ueber einen JOB und nicht ueber eine Zeile
 * (`postfach_stumm`, `job_ausfall`); ihre Aufgabe traegt weder `auftrag_id`
 * noch `bezug_typ`. Wer diese Tabelle als „Anhaengsel eines Auftrags" baut,
 * verliert genau die Befunde, die am meisten wehtun.
 */

-- ---------------------------------------------------------------------------
-- 1. Die Aufzaehlungen (06-RADAR-KI-INHALT.md §10, wortwoertlich)
-- ---------------------------------------------------------------------------

create type aufgabe_status as enum (
  'offen',
  'in_arbeit',
  'wartend',
  'erledigt',
  'abgebrochen'
);

comment on type aufgabe_status is
  'OPS-11. `erledigt` und `abgebrochen` sind ZUSTAENDE, keine Loeschung — die Zeile bleibt.';

create type prioritaet as enum ('niedrig', 'normal', 'hoch', 'dringend');

comment on type prioritaet is
  'Geteilt mit benachrichtigung und benachrichtigung_praeferenz (§7.8). `dringend` ist '
  'die Stufe, die keine Ruhezeit unterdrueckt.';

/**
 * **Der polymorphe Bezug — ohne Fremdschluessel, und das ist begruendet**
 * (§7.2).
 *
 * `bezug_typ`/`bezug_id` zeigen je Typ auf eine andere Tabelle. Getragen wird
 * die Verlaesslichkeit von (a) dieser Aufzaehlung, (b) `mandant_id` auf
 * beiden Seiten unter derselben RLS, (c) dem Dienst, der beim Schreiben
 * prueft, und (d) einer Nachtwache, die Waisen meldet. Erlaubt ist das NUR,
 * weil daran nichts haengt als eine Anzeige und ein Verweis: kein Betrag,
 * keine Bedingung, kein Recht. Wo eine Rechnung daran haengt, steht ein
 * zusammengesetzter Fremdschluessel — deshalb traegt `aufgabe` `auftrag_id`,
 * `objekt_id` und `lead_id` EINZELN und richtig verschluesselt.
 */
create type bezug_typ as enum (
  'lead', 'angebot', 'auftrag', 'projekt', 'rechnung', 'eingangsrechnung',
  'objekt', 'einsatz', 'zeiteintrag', 'nachtrag', 'ausschreibung',
  'ausschreibung_vorgang', 'vergabemappe', 'bewerbung', 'kandidat',
  'gespraech', 'stelle', 'social_post', 'referenz', 'seite', 'person',
  'anstellung', 'kunde', 'freigabe', 'dokument', 'agent_aufgabe'
);

comment on type bezug_typ is
  '§7.2. Polymorpher Anzeige- und Navigationsbezug — bewusst ohne Fremdschluessel. '
  'Ein Typ ohne Aufloeser im Dienst ergibt eine Zeile ohne Verweis, nie einen Fehler.';

-- ---------------------------------------------------------------------------
-- 2. team und team_mitglied (§7.5)
-- ---------------------------------------------------------------------------

create table team (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  name          text not null,
  /**
   * Das Gewerk, dem das Team zugeordnet ist — Freitext und bewusst kein
   * Aufzaehlungstyp: ein Team kann „Objektbetreuung Mitte" heissen und zu
   * keinem der vier Bereiche gehoeren.
   */
  bereich       text,
  leitung_benutzer_id uuid references benutzer(id),

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),
  geloescht_am  timestamptz,
  geloescht_von uuid references benutzer(id),

  constraint team_pk primary key (mandant_id, id),
  constraint team_id_uk unique (id),
  constraint team_name_nicht_leer check (btrim(name) <> '')
);

/**
 * Ein Name je Gesellschaft, klein geschrieben verglichen — und PARTIELL.
 *
 * Ohne `lower()` sind „Nordteam" und „nordteam" zwei Teams, und der Filter
 * nach dem einen findet die Haelfte. Ohne `where geloescht_am is null` waere
 * ein aufgeloestes Team der Grund, warum der Name nie wieder vergeben werden
 * kann.
 */
create unique index team_name_uk on team (mandant_id, lower(name))
  where geloescht_am is null;

comment on table team is
  'CAL-02, §7.5. Die benannte Gruppe, an die eine Aufgabe oder ein Termin gehen kann. '
  'Ein Team gehoert genau einer Gesellschaft.';

/**
 * **Eine Mitgliedschaft haengt an einer BESCHAEFTIGUNG, nicht am Menschen**
 * (D-09).
 *
 * Fatima ist bei der Reinigung und bei der Security angestellt — ein Mensch,
 * zwei `anstellung`-Zeilen. Ihre Mitgliedschaft im Reinigungsteam sagt nichts
 * ueber die Security, und ein `person_id` als Schluessel machte daraus
 * dasselbe. `person_id` steht trotzdem daneben, denormalisiert und durch den
 * zusammengesetzten Fremdschluessel `(anstellung_id, person_id) → anstellung
 * (id, person_id)` festgenagelt: die restriktive Decke auf `aufgabe` muss im
 * Mitarbeiterportal die Teams DIESES Menschen kennen, und ein Join ueber eine
 * mandantengebundene Tabelle liefert in `person`-Scope null Zeilen (derselbe
 * Grund wie bei `einsatz_zuordnung`, 0028 §2.3).
 */
create table team_mitglied (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  team_id       uuid not null,
  anstellung_id uuid not null,
  person_id     uuid not null,

  /**
   * Die Rolle im Team — Freitext, solange niemand die Liste bestaetigt hat.
   * // TODO(client, O-650): Welche Rollen gibt es in einem Team (Leitung,
   * Stellvertretung, Mitglied, Springer)?
   */
  rolle         text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),

  constraint team_mitglied_pk primary key (mandant_id, id),
  constraint team_mitglied_id_uk unique (id),
  constraint tm_team_fk foreign key (mandant_id, team_id)
    references team (mandant_id, id),
  constraint tm_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  -- Der Schluessel, der die denormalisierte person_id festnagelt.
  constraint tm_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  constraint tm_uk unique (team_id, anstellung_id)
);

create index tm_team_idx on team_mitglied (mandant_id, team_id);
/** Ohne `mandant_id`-Praefix: die Decke fragt ueber alle Beschaeftigungen. */
create index tm_person_idx on team_mitglied (person_id);

comment on table team_mitglied is
  '§7.5, D-09. Eine Mitgliedschaft je anstellung; person_id denormalisiert und per '
  '(anstellung_id, person_id)-FK festgenagelt.';

-- ---------------------------------------------------------------------------
-- 3. aufgabe (§7.7)
-- ---------------------------------------------------------------------------

create table aufgabe (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  titel         text not null,
  beschreibung  text,

  status        aufgabe_status not null default 'offen',
  prioritaet    prioritaet     not null default 'normal',

  /**
   * **Zwei Fristen, und genau eine davon ist gesetzt** (§7.1 sinngemaess).
   *
   * `faellig_am` ist ein Zeitpunkt in UTC („heute 16:00, vor Dienstschluss"),
   * `faellig_datum` ein Tag („bis Freitag"). Ein Tag ist kein Zeitpunkt: er
   * beginnt nicht um 00:00 UTC und wandert nicht mit der Sommerzeit. Beide
   * gleichzeitig zu setzen hiesse zwei Wahrheiten ueber dieselbe Frist, und
   * die Ueberfaelligkeitspruefung wuerde eine davon waehlen.
   */
  faellig_am    timestamptz,
  faellig_datum date,

  zugewiesen_an      uuid references benutzer(id),
  zugewiesen_team_id uuid,

  /**
   * Die drei Bezuege, an denen im Betrieb wirklich etwas haengt — als
   * ZUSAMMENGESETZTE Fremdschluessel (K-16). Ein einspaltiger Schluessel auf
   * eine Tabelle mit `mandant_id` ist ein Existenzorakel: die Pruefung laeuft
   * an RLS vorbei, eine geratene uuid gelingt, wenn die Zeile IRGENDEINER
   * Gesellschaft gehoert, und scheitert sonst — genau die Auskunft, die
   * AUT-06 verweigert.
   */
  auftrag_id    uuid,
  objekt_id     uuid,
  lead_id       uuid,

  -- Alles andere (§7.2).
  bezug_typ     bezug_typ,
  bezug_id      uuid,

  /** Woher sie kommt: Mensch, Zeitplan, Ereignis oder Agent. */
  quelle        ausloeser not null default 'mensch',
  /**
   * **Der JOBNAME, nicht der Lauf** — und darin steckt eine Korrektur.
   *
   * Der Entwurf verschluesselte die Doppelungssperre auf die Lauf-ID, und
   * die ist jede Nacht neu: „ein Waechter erzeugt nicht zweimal dieselbe
   * Aufgabe" war damit nicht erreicht, sondern nur behauptet. Die Waechter
   * aus SPEC §14 laufen taeglich, also entstand jede Nacht eine weitere
   * identische Zeile, bis die Ursache wegfiel. Dreissig gleiche Aufgaben je
   * Befund sind genau der Ermuedungseffekt, vor dem SPEC §17 warnt.
   */
  quelle_job    text,
  /** Herkunft des Laufs, der sie schrieb. Einspaltig, weil `job_lauf` KEIN
   *  `mandant_id` traegt (K-21, §1.11 — benannte Ausnahme). */
  job_lauf_id   uuid references job_lauf(id),

  erledigt_am   timestamptz,
  erledigt_von  uuid references benutzer(id),
  abgebrochen_grund text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),
  /** Weiche Loeschung. Erledigt und abgebrochen sind etwas anderes: ein
   *  Zustand. Geloescht heisst „gehoert nicht in die Liste", nie „ist fertig". */
  geloescht_am  timestamptz,
  geloescht_von uuid references benutzer(id),

  constraint aufgabe_pk primary key (mandant_id, id),
  constraint aufgabe_id_uk unique (id),

  constraint aufgabe_team_fk foreign key (mandant_id, zugewiesen_team_id)
    references team (mandant_id, id),
  constraint aufgabe_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  constraint aufgabe_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint aufgabe_lead_fk foreign key (mandant_id, lead_id)
    references lead (mandant_id, id),

  constraint aufgabe_titel_nicht_leer check (btrim(titel) <> ''),
  /**
   * `erledigt` ohne Zeitpunkt und ohne Menschen waere eine Behauptung. Wer
   * eine Aufgabe schliesst, steht in der Zeile — das ist die Frage, die eine
   * Woche spaeter gestellt wird.
   */
  constraint aufgabe_erledigt_belegt check (
    status <> 'erledigt' or (erledigt_am is not null and erledigt_von is not null)),
  /**
   * Abbrechen braucht einen Grund. Eine Aufgabe, die ohne Begruendung
   * verschwindet, ist von einer erledigten nicht zu unterscheiden — und
   * genau das ist der Unterschied, der zaehlt.
   */
  constraint aufgabe_abbruch_begruendet check (
    status <> 'abgebrochen'
    or (abgebrochen_grund is not null and btrim(abgebrochen_grund) <> '')),
  constraint aufgabe_eine_frist check (faellig_am is null or faellig_datum is null),
  /** Ein Bezug ist ein PAAR. Ein Typ ohne Id zeigt nirgendwohin, eine Id
   *  ohne Typ weiss nicht, welche Tabelle gemeint ist. */
  constraint aufgabe_bezug_paarweise check (
    (bezug_typ is null) = (bezug_id is null))
);

create index aufgabe_meine_idx on aufgabe (mandant_id, zugewiesen_an, status, faellig_am)
  where geloescht_am is null;
/** DSH-01: die Kachel „anstehende Aufgaben" fragt genau das. */
create index aufgabe_dash_idx on aufgabe (mandant_id, status, faellig_am)
  where status in ('offen', 'in_arbeit');
create index aufgabe_bezug_idx on aufgabe (bezug_typ, bezug_id);
create index aufgabe_team_idx on aufgabe (mandant_id, zugewiesen_team_id, status)
  where zugewiesen_team_id is not null and geloescht_am is null;

/**
 * **Die Doppelungssperre — und sie ist `NULLS NOT DISTINCT`.**
 *
 * In einem gewoehnlichen Unique-Index stossen `NULL`s nie zusammen, und
 * `bezug_typ`/`bezug_id` sind nullbar. Die Sperre haette also fuer
 * `watchdog:ausschreibung_frist` gehalten (dort gibt es eine Zeile, auf die
 * man zeigen kann) und fuer `watchdog:postfach_stumm` und
 * `watchdog:job_ausfall` still versagt — also fuer genau die Befunde, die
 * ueber einen JOB und nicht ueber eine Zeile sprechen. `NULLS NOT
 * DISTINCT` laesst die beiden `NULL`s kollidieren; damit bleibt ein
 * gegenstandsloser Befund je Job und Gesellschaft genau einmal offen.
 *
 * Der Job fuegt mit `on conflict do nothing` ein: ein Index, der WIRFT,
 * beendet den Nachtlauf beim zweiten Vorkommen, statt es zu unterdruecken.
 */
create unique index aufgabe_job_uk
  on aufgabe (mandant_id, quelle_job, bezug_typ, bezug_id)
  nulls not distinct
  where quelle_job is not null and status in ('offen', 'in_arbeit');

comment on table aufgabe is
  'OPS-11, DSH-01, SPEC §14. Die offene Pflicht — von einem Menschen angelegt oder von '
  'einem Waechter gemeldet. Wird geschlossen, nie geloescht.';
comment on column aufgabe.quelle_job is
  'Der Jobname als Doppelungsschluessel (§7.7). Nicht die Lauf-ID: die ist jede Nacht neu.';

create trigger trg_team_geaendert before update on team
  for each row execute function kern.setze_geaendert_am();
create trigger trg_aufgabe_geaendert before update on aufgabe
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- 4. RLS (S5, Modul `aufgabe` bzw. `kalender`)
-- ---------------------------------------------------------------------------

alter table team          enable row level security;
alter table team          force  row level security;
alter table team_mitglied enable row level security;
alter table team_mitglied force  row level security;
alter table aufgabe       enable row level security;
alter table aufgabe       force  row level security;

/**
 * Teams gehoeren dem Kalendermodul (§7.5) — CAL-02 filtert nach ihnen, und
 * `aufgabe` benutzt sie mit. Das Recht ist deshalb `kalender.lesen` und nicht
 * `aufgabe.lesen`: wer Termine sieht, sieht die Teams, nach denen er filtert.
 */
create policy t_team_lesen on team for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('kalender.lesen', app.aktiver_mandant())));

create policy t_team_schreiben on team for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('kalender.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('kalender.schreiben', app.aktiver_mandant())));

create policy t_team_gruppe on team for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.kalender.lesen')));

/**
 * **Das eigene Team sieht der Mensch dahinter, ohne Modulrecht** (K-18,
 * Form B).
 *
 * Ohne diese Zeile waere die Decke auf `aufgabe` im Mitarbeiterportal
 * wirkungslos: sie fragt nach den Teams DIESER Person, und ohne Lesezugriff
 * auf `team_mitglied` antwortet die Unterabfrage mit der leeren Menge. Eine
 * Teamaufgabe erreichte dann niemanden ausser der Leitung — also genau die
 * Person nicht, fuer die sie gedacht war.
 */
create policy t_tm_eigene on team_mitglied for select to cse_app
  using (person_id = app.aktuelle_person()
         and mandant_id = any (app.sichtbare_mandanten()));

create policy t_tm_lesen on team_mitglied for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('kalender.lesen', app.aktiver_mandant())));

create policy t_tm_schreiben on team_mitglied for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('kalender.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('kalender.schreiben', app.aktiver_mandant())));

/**
 * K-04 auf `team_mitglied`: im Mitarbeiterportal die EIGENE Mitgliedschaft
 * und keine fremde. Die Zeile traegt eine `anstellung_id`, und darunter liegt
 * der Lohn — dass hier nur der Teamname steht, ist kein Grund, die Decke
 * weglassen zu duerfen (`p_ma_ceiling` auf `anstellung`, 0004).
 */
create policy p_tm_ma_decke on team_mitglied as restrictive for all to cse_app
  using      (app.portal() <> 'mitarbeiter' or person_id = app.aktuelle_person())
  with check (app.portal() <> 'mitarbeiter' or person_id = app.aktuelle_person());

create policy p_team_kunde_decke on team as restrictive for all to cse_app
  using (app.portal() <> 'kunde');
create policy p_tm_kunde_decke on team_mitglied as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

-- ---------------------------------------------------------------------------

create policy t_aufgabe_lesen on aufgabe for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('aufgabe.lesen', app.aktiver_mandant())));

create policy t_aufgabe_schreiben on aufgabe for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('aufgabe.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('aufgabe.schreiben', app.aktiver_mandant())));

/** In der Gruppenansicht lesbar, nie schreibbar (Invariante 10). */
create policy t_aufgabe_gruppe on aufgabe for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.aufgabe.lesen')));

/**
 * **Die eigene Aufgabe sieht auch ein Mitarbeiterkonto** (EMP-11 sinngemaess).
 *
 * `aufgabe.lesen` ist ein internes Recht, das eine Reinigungskraft nie haelt.
 * Ohne diese Zeile waere „dir ist etwas zugewiesen" eine Auskunft, die nur
 * die Leitung lesen darf — und die Zuweisung damit sinnlos.
 */
create policy t_aufgabe_eigene on aufgabe for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and (zugewiesen_an = app.aktueller_benutzer()
              or erstellt_von = app.aktueller_benutzer()
              or (zugewiesen_team_id is not null
                  and zugewiesen_team_id in (select tm.team_id from team_mitglied tm
                                              where tm.person_id = app.aktuelle_person()))));

/**
 * **`p_zustaendig` — die restriktive Decke** (§7.7, §1.4).
 *
 * Restriktiv, also UND-verknuepft: eine zweite erlaubende Policy waere ein
 * ODER, und so wird aus einer Decke ein Loch. Sie sagt: ausserhalb des
 * internen Portals sieht man, was einem zugewiesen ist, was man selbst
 * angelegt hat, oder was an einem eigenen Team haengt. Sonst nichts.
 *
 * Sie ist NICHT als `app.portal() = 'intern'` geschrieben und laesst deshalb
 * `t_person`-artigen Pfaden Platz (§1.4).
 */
create policy p_zustaendig on aufgabe as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or zugewiesen_an = app.aktueller_benutzer()
         or erstellt_von = app.aktueller_benutzer()
         or (zugewiesen_team_id is not null
             and zugewiesen_team_id in (select tm.team_id from team_mitglied tm
                                         where tm.person_id = app.aktuelle_person())));

/**
 * Der Kundenzugang hat in der Aufgabenliste nichts zu suchen (K-04).
 *
 * `p_zustaendig` allein liesse eine Aufgabe durch, die einem Kundenkonto
 * zugewiesen waere — eine Zuordnung, die es nicht geben soll und die niemand
 * beabsichtigt. Die Decke sagt es ausdruecklich, statt sich darauf zu
 * verlassen, dass es nie passiert.
 *
 * **Die WITH-CHECK-Seite lautet `<> 'kunde'`, nicht `= 'intern'.`** Das war
 * einmal anders und war falsch: eine restriktive WITH-CHECK-Bedingung muss
 * bei JEDEM Schreibvorgang wahr sein, und `app.portal()` liefert im
 * `person`-Scope fest `mitarbeiter` und im Mandanten-Scope das Portal der
 * Mitgliedschaft — fuer die Rolle `mitarbeiter` also ebenfalls
 * `mitarbeiter`. `= 'intern'` hat damit jedes Erledigen einer zugewiesenen
 * Aufgabe abgewiesen, obwohl 03-AUTH-BERECHTIGUNGEN.md §2441 der Rolle
 * `mitarbeiter` genau `aufgabe.schreiben` gibt („completing an assigned
 * task"). Die Verengung auf das Zugewiesene leistet `p_zustaendig`: dessen
 * `using` gilt bei einer `for all`-Policy ohne eigenes `with check` auch als
 * WITH CHECK. Dieselbe Form tragen 0192 und 0201.
 */
create policy p_aufgabe_kunde_decke on aufgabe as restrictive for all to cse_app
  using      (app.portal() <> 'kunde')
  with check (app.portal() <> 'kunde');

/**
 * Die Waechter aus SPEC §14 laufen als `cse_job`, ohne Sitzung — und
 * `FORCE ROW LEVEL SECURITY` gilt auch fuer sie: ohne eigene Policy schreiben
 * sie nichts. Sie duerfen anlegen und ihre eigene Zeile fortschreiben,
 * niemals eine fremde Entscheidung setzen.
 */
create policy t_job_aufgabe on aufgabe for select to cse_job using (true);
create policy t_job_aufgabe_anlegen on aufgabe for insert to cse_job with check (true);
create policy t_job_aufgabe_fortschreiben on aufgabe for update to cse_job
  using (true) with check (true);
create policy t_job_team on team for select to cse_job using (true);
create policy t_job_tm on team_mitglied for select to cse_job using (true);

grant select, insert, update on team          to cse_app;
grant select, insert, update, delete on team_mitglied to cse_app;
grant select, insert, update on aufgabe       to cse_app;
grant select on team, team_mitglied to cse_job;
grant select, insert on aufgabe to cse_job;
grant update (status, erledigt_am, erledigt_von, abgebrochen_grund, geaendert_am)
      on aufgabe to cse_job;

-- ---------------------------------------------------------------------------
-- 5. Keine harte Loeschung (Invariante 8) — erzeugt, siehe 0175.
-- ---------------------------------------------------------------------------

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0230)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- team (soft): §7.5. Ein aufgeloestes Team ist die Antwort auf die Frage, wer eine Aufgabe oder einen Termin damals bekommen hat. Geloescht waere es ein Verweis ins Leere in jeder Zeile, die darauf zeigt — und `aufgabe.zugewiesen_team_id` zeigt darauf. `geloescht_am` loest es auf.
create trigger trg_team_kein_hard_delete
  before delete on team
  for each row execute function kern.verhindere_loeschung();
create trigger trg_team_kein_truncate
  before truncate on team
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on team from cse_app, cse_anon, cse_checkin, cse_job;

-- aufgabe (soft): OPS-11, SPEC §14. Eine Aufgabe ist die Aufzeichnung einer Pflicht: wer sie wann bekam, wer sie schloss, und mit welcher Begruendung sie abgebrochen wurde. Sie zu loeschen hiesse, den Nachweis zu entfernen, dass ein Waechterbefund je offen war. Beendet wird mit `status`, entfernt mit `geloescht_am`.
create trigger trg_aufgabe_kein_hard_delete
  before delete on aufgabe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_aufgabe_kein_truncate
  before truncate on aufgabe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on aufgabe from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
