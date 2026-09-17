-- 0231 — Nachrichtenfäden, Anhänge und das UWG-Tor am Ausgang
--         (EMP-11, CRM-03, CRM-08, LEG-08, NOT-03, Invariante 7, D-01).

/**
 * **Die Tabelle gab es, den Faden nicht.**
 *
 * `0011` legte `nachricht` in der kleinsten denkbaren Fassung an: Absender,
 * Betreff, Text, Zeitpunkt. `04-SEITENKARTE.md` §5.17 nennt
 * `/portal/[mandant]/nachrichten` aber den „thread inbox" — und ein
 * Posteingang ohne Faden ist eine Liste einzelner Zettel: die Antwort steht
 * neben der Frage, nach Datum sortiert, und wer den Vorgang lesen will,
 * sortiert im Kopf. Es fehlten `thread_id`, `antwortet_auf_id`, `richtung`,
 * `kanal`, der Bezug, die Rechtsgrundlage, der Freigabebezug und der
 * Zustellstand (06-RADAR-KI-INHALT.md §7.9). `nachricht_empfaenger` war auf
 * `person_id` verdrahtet und konnte einen Kundenansprechpartner gar nicht
 * adressieren; `nachricht_anhang` fehlte ganz.
 *
 * **Zwei CHECKs machen § 7 UWG und Invariante 7 zu Datenbankbedingungen.**
 * Eine ausgehende Nachricht OHNE aufgezeichnete Rechtsgrundlage ist nicht
 * speicherbar — also erst recht nicht sendbar. Und ein Agent sendet nie ohne
 * Freigabe: `richtung='ausgehend'` mit `akteur_art='agent'` verlangt eine
 * `freigabe_id`. Das ist der Unterschied zwischen einer Regel im Dienst (die
 * ein zweiter Schreibweg umgeht) und einer Zusage der Datenbank.
 *
 * **Was hier NICHT entstehen durfte.** Kein Versand: der Mailversender ist
 * `nicht_verbunden` (O-36, `registry/integrationen.ts`), und eine Zeile, die
 * `zustell_status='gesendet'` behauptet, ohne dass etwas gesendet wurde, ist
 * die vorgetäuschte Anbindung, die CLAUDE.md ausschliesst. `ausstehend` ist
 * deshalb der Vorgabewert und bleibt es, solange niemand verbunden ist.
 */

-- ---------------------------------------------------------------------------
-- 1. Die Aufzaehlungen (§7.9, §10)
-- ---------------------------------------------------------------------------

create type nachricht_richtung as enum ('intern', 'eingehend', 'ausgehend');

comment on type nachricht_richtung is
  '§7.9. `ausgehend` ist der Zustand, an dem § 7 UWG haengt — die beiden CHECKs auf '
  '`nachricht` pruefen genau diesen Wert.';

create type nachricht_kanal as enum ('portal', 'email', 'sms');

create type nachricht_empfaenger_typ as enum (
  'benutzer', 'person', 'ansprechpartner', 'kandidat', 'extern'
);

comment on type nachricht_empfaenger_typ is
  '§7.9, B11. `benutzer` ist eine Anmeldung, `person` ein Mensch — und beides sind '
  'verschiedene Ids. Eine an `person` adressierte Nachricht gegen die Anmelde-Id zu '
  'pruefen macht sie fuer den Empfaenger unsichtbar (D-09, EMP-11).';

create type empfaenger_art as enum ('an', 'kopie');

create type zustell_status as enum (
  'ausstehend', 'gesendet', 'zugestellt', 'fehlgeschlagen', 'unterdrueckt'
);

comment on type zustell_status is
  '§7.8, §7.9. `ausstehend` heisst: noch nicht hinaus. Solange kein Versender verbunden '
  'ist (O-36), ist das der Endzustand — und das steht auf dem Bildschirm.';

-- ---------------------------------------------------------------------------
-- 2. `nachricht` auf die §7.9-Form bringen — additiv
-- ---------------------------------------------------------------------------

/**
 * Zwei Umbenennungen, und beide sind Praezisierungen.
 *
 * `absender_id` sagt nicht, WESSEN Id: es gibt drei Absenderarten (Benutzer,
 * Agent, extern), und die Spalte trug die erste. `text` als Spaltenname ist
 * ausserdem der Name eines Typs — `n.text` liest sich in jeder Abfrage wie
 * eine Umwandlung. Kein Dienst und keine Seite liest die beiden heute
 * (nachgemessen), die Umbenennung kostet also nichts und erspart die
 * Doppelspalte.
 */
alter table nachricht rename column absender_id to absender_benutzer_id;
alter table nachricht rename column text        to koerper;

/** Ein Betreff ist nicht immer da — eine Antwort in einem Faden traegt keinen. */
alter table nachricht alter column betreff drop not null;

/**
 * `gesendet_am` verliert seinen Vorgabewert.
 *
 * `default now()` hiess: jede Zeile behauptet, in diesem Moment gesendet
 * worden zu sein — auch der Entwurf, auch die eingehende Nachricht, auch die,
 * fuer die kein Versender verbunden ist. Der Zeitpunkt wird gesetzt, wenn
 * etwas WIRKLICH hinausgeht (Invariante 5: Serveruhr, und nur dann).
 */
alter table nachricht alter column gesendet_am drop not null;
alter table nachricht alter column gesendet_am drop default;

alter table nachricht
  add column thread_id          uuid,
  add column antwortet_auf_id   uuid,
  add column richtung           nachricht_richtung not null default 'intern',
  add column kanal              nachricht_kanal    not null default 'portal',
  add column akteur_art         akteur_art         not null default 'mensch',
  add column absender_agent_id  uuid references agent(id),
  add column absender_extern    text,
  add column bezug_typ          bezug_typ,
  add column bezug_id           uuid,
  add column rechtsgrundlage             rechtsgrundlage,
  add column rechtsgrundlage_kontakt_id  uuid,
  add column zweck              kommunikationszweck,
  add column freigabe_id        uuid,
  add column zustell_status     zustell_status not null default 'ausstehend',
  add column zustell_fehler     text,
  /** Ein Faden wird GESCHLOSSEN, nicht geloescht — und nur an seiner Wurzel. */
  add column geschlossen_am     timestamptz,
  add column geschlossen_von    uuid references benutzer(id),
  add column erstellt_von       uuid references benutzer(id),
  add column geaendert_am       timestamptz,
  add column geaendert_von      uuid references benutzer(id),
  add column geloescht_am       timestamptz,
  add column geloescht_von      uuid references benutzer(id);

/** Bestandszeilen sind ihre eigene Fadenwurzel. Danach ist die Spalte Pflicht. */
update nachricht set thread_id = id where thread_id is null;
alter table nachricht alter column thread_id set not null;

/**
 * `richtung` verliert seinen Vorgabewert, `kanal` behaelt ihn.
 *
 * Die Richtung ist die Entscheidung, an der das UWG-Tor haengt; ein
 * Vorgabewert hiesse, dass ein vergessenes Feld die harmlose Variante waehlt
 * und das Tor nie beruehrt. Der Kanal hat dagegen eine wahre Vorgabe: was
 * nirgendwo hingeschickt wird, liegt im `portal`.
 */
alter table nachricht alter column richtung drop default;

alter table nachricht
  add constraint nachricht_thread_fk foreign key (mandant_id, thread_id)
    references nachricht (mandant_id, id),
  add constraint nachricht_antwort_fk foreign key (mandant_id, antwortet_auf_id)
    references nachricht (mandant_id, id),
  add constraint nachricht_kontakt_fk foreign key (mandant_id, rechtsgrundlage_kontakt_id)
    references ansprechpartner (mandant_id, id),
  add constraint nachricht_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id),

  /**
   * **§ 7 UWG / LEG-08 / CRM-08 als Datenbankbedingung.**
   *
   * Eine ausgehende Nachricht ohne aufgezeichnete Rechtsgrundlage laesst sich
   * nicht speichern. Die Aufzeichnung ist eine KOPIE des Wertes zum
   * Sendezeitpunkt und kein Verweis: was beim Kontakt heute steht, sagt
   * nichts darueber, was vor einem Jahr gegolten hat — und genau danach
   * fragt eine Abmahnung.
   */
  add constraint nachricht_ausgehend_grundlage check (
    richtung <> 'ausgehend'
    or (rechtsgrundlage is not null and rechtsgrundlage <> 'keine')),

  /**
   * **Invariante 7: kein Agent sendet ohne Freigabe.**
   *
   * Nicht „der Dienst prueft es", sondern: die Zeile existiert nicht. Ein
   * zweiter Schreibweg, der die Freigabekette nicht kennt, scheitert hier.
   */
  add constraint nachricht_agent_braucht_freigabe check (
    richtung <> 'ausgehend' or akteur_art <> 'agent' or freigabe_id is not null),

  /** Ein Agent als Absender muss BENANNT sein — „ein Agent" ist kein Absender. */
  add constraint nachricht_agent_benannt check (
    akteur_art <> 'agent' or absender_agent_id is not null),

  add constraint nachricht_bezug_paarweise check ((bezug_typ is null) = (bezug_id is null)),

  /** Geschlossen wird der FADEN, also seine Wurzel — nicht eine Antwort darin. */
  add constraint nachricht_schliessen_nur_wurzel check (
    geschlossen_am is null or id = thread_id),

  add constraint nachricht_koerper_nicht_leer check (btrim(koerper) <> '');

create index nachricht_thread_idx    on nachricht (mandant_id, thread_id, erstellt_am);
create index nachricht_richtung_idx  on nachricht (mandant_id, richtung, gesendet_am desc);
create index nachricht_bezug_idx     on nachricht (bezug_typ, bezug_id);
create index nachricht_versand_idx   on nachricht (zustell_status)
  where zustell_status = 'ausstehend';

comment on column nachricht.thread_id is
  '§7.9. Wurzel des Vorgangs. `trg_thread_id` setzt sie BEFORE INSERT — eine Spalte kann '
  'ihren eigenen Vorgabewert in derselben Anweisung nicht lesen.';
comment on column nachricht.rechtsgrundlage is
  'CRM-08. KOPIE des Kontaktwertes zum Sendezeitpunkt, gezogen von kern.nachricht_sendetor(). '
  'Ein Verweis wuerde die Vergangenheit mit dem heutigen Stand beantworten.';

/**
 * **`trg_thread_id` — die Wurzel, bevor die Zeile existiert.**
 *
 * Eine Antwort gehoert in den Faden ihres Elternteils, nicht in einen neuen.
 * Die Aufloesung laeuft ueber einen Definer, und zwar aus einem Grund, der
 * sich erst in Phase 6 zeigen wuerde: der Kundenfaden bekommt seinen Lesepfad
 * spaeter (`t_kunde` auf `nachricht`, 0255+). Faende der Ausloeser den
 * Elternteil unter RLS nicht, fiele die Antwort still in einen eigenen Faden
 * — und ein Vorgang waere in zwei Haelften geteilt, ohne Fehlermeldung.
 */
create function kern.nachricht_thread_wurzel(p_mandant uuid, p_eltern uuid)
returns uuid
language sql stable security definer
set search_path = pg_catalog, public as $$
  select n.thread_id from public.nachricht n
   where n.mandant_id = p_mandant and n.id = p_eltern;
$$;

comment on function kern.nachricht_thread_wurzel(uuid, uuid) is
  '§7.9. Die Fadenwurzel des Elternteils — fuer trg_thread_id. Gibt eine Id heraus, '
  'nie einen Inhalt.';

alter function kern.nachricht_thread_wurzel(uuid, uuid) owner to cse_definer;
revoke execute on function kern.nachricht_thread_wurzel(uuid, uuid) from public;
grant execute on function kern.nachricht_thread_wurzel(uuid, uuid) to cse_app, cse_job;

/**
 * **Der Definer bekommt DREI Spalten, nicht die Tabelle** (K-05).
 *
 * `security definer` heisst: die Funktion laeuft mit den Rechten ihres
 * Eigentuemers, und `cse_definer` traegt hier absichtlich nur einen
 * Spalten-Grant. Selbst wenn eine kuenftige Definer-Funktion dieselbe
 * Eigentuemerschaft benutzt, kommt sie an `koerper`, `betreff` und
 * `rechtsgrundlage` nicht heran — ein Grant auf die ganze Tabelle waere ein
 * zweiter Lesepfad auf Nachrichtentexte neben RLS, und der erste, den eine
 * Policy-Aenderung vergisst.
 */
grant select (mandant_id, id, thread_id) on nachricht to cse_definer;
create policy d_nachricht_faden on nachricht for select to cse_definer using (true);

create function kern.setze_thread_id()
returns trigger
language plpgsql
set search_path = pg_catalog, public, kern as $$
begin
  if new.thread_id is null and new.antwortet_auf_id is not null then
    new.thread_id := kern.nachricht_thread_wurzel(new.mandant_id, new.antwortet_auf_id);
    if new.thread_id is null then
      raise exception 'Die Nachricht, auf die geantwortet wird, ist kein Faden dieses Bereichs'
        using errcode = 'foreign_key_violation';
    end if;
  end if;
  new.thread_id := coalesce(new.thread_id, new.id);
  return new;
end
$$;

create trigger trg_thread_id before insert on nachricht
  for each row execute function kern.setze_thread_id();

/**
 * **Das UWG-Tor am Ausgang — dieselbe Pruefung wie auf `lead_aktivitaet`.**
 *
 * `kern.uwg_sendetor()` (0020) sitzt auf der Aktivitaet und kann hier nicht
 * wiederverwendet werden: es liest `new.typ` und `new.ansprechpartner_id`,
 * Spalten, die `nachricht` nicht traegt. Die ENTSCHEIDUNG wird deshalb nicht
 * kopiert, sondern derselbe Torwaechter gefragt —
 * `app.darf_kontaktiert_werden` und `app.rechtsgrundlage_von`. Zwei Fassungen
 * derselben Rechtsfrage sind zwei Gelegenheiten, eine davon zu lockern.
 *
 * **Die Rechtsgrundlage wird HIER gezogen, nicht vom Aufrufer uebernommen.**
 * Was der Dienst Minuten vorher gelesen hat, gilt in diesem Moment
 * vielleicht nicht mehr — ein Widerspruch wirkt sofort.
 */
create function kern.nachricht_sendetor()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app as $$
declare
  v_grundlage rechtsgrundlage;
begin
  if new.richtung <> 'ausgehend' then return new; end if;

  /*
   * Ein Faden im Portal geht nicht „hinaus": der Empfaenger liest ihn
   * angemeldet, auf derselben Plattform. § 7 UWG spricht von elektronischer
   * Post; `portal` ist keine. Die Rechtsgrundlage verlangt der CHECK
   * trotzdem — sie ist der Nachweis, nicht die Erlaubnis.
   */
  if new.kanal = 'portal' then return new; end if;

  if new.rechtsgrundlage_kontakt_id is null then
    raise exception 'Eine ausgehende Nachricht ueber % ohne Ansprechpartner ist nicht belegbar (§ 7 UWG)',
      new.kanal using errcode = 'check_violation',
                     hint = 'rechtsgrundlage_kontakt_id setzen.';
  end if;

  /*
   * `intern` ist kein Zweck fuer etwas, das das Haus verlaesst.
   * `app.darf_kontaktiert_werden` beantwortet `intern` mit `true` und
   * ueberspringt dabei Einwilligung, Widerspruch und Kundenstatus — richtig
   * fuer eine Notiz an einen Kollegen, ein offenes Tor an einer E-Mail.
   */
  if new.zweck is null or new.zweck = 'intern' then
    raise exception 'Eine ausgehende Nachricht ueber % traegt einen Zweck, und nie ''intern'' (§ 7 UWG)',
      new.kanal using errcode = 'check_violation',
                     hint = 'Zweck vertraglich, transaktional oder werbung waehlen.';
  end if;

  if not app.darf_kontaktiert_werden(new.rechtsgrundlage_kontakt_id,
                                     new.kanal::text, new.zweck::text) then
    raise exception 'Kontakt nach § 7 UWG / Art. 21 DSGVO nicht zulaessig (Kanal %, Zweck %)',
      new.kanal, new.zweck using errcode = 'insufficient_privilege';
  end if;

  v_grundlage := app.rechtsgrundlage_von(new.rechtsgrundlage_kontakt_id, new.mandant_id);
  new.rechtsgrundlage := coalesce(v_grundlage, 'keine');
  return new;
end
$$;

comment on function kern.nachricht_sendetor() is
  'CRM-08, LEG-08, § 7 UWG. Fragt denselben Torwaechter wie kern.uwg_sendetor() und '
  'schreibt die Rechtsgrundlage selbst — was der Aufrufer vorher las, gilt vielleicht nicht mehr.';

create trigger trg_nachricht_sendetor before insert or update on nachricht
  for each row execute function kern.nachricht_sendetor();

create trigger trg_nachricht_geaendert before update on nachricht
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- 3. `nachricht_empfaenger` polymorph (§7.9, B11)
-- ---------------------------------------------------------------------------

/**
 * `erstellt_am` fehlte — S1 verlangt es auf JEDER Tabelle, und hier kostet das
 * Fehlen konkret etwas: ohne es gibt es keine Reihenfolge der Empfaenger, und
 * „an" vor „kopie" allein ist keine.
 */
alter table nachricht_empfaenger
  add column empfaenger_typ nachricht_empfaenger_typ,
  add column empfaenger_id  uuid,
  add column extern_email   text,
  add column art            empfaenger_art not null default 'an',
  add column zugestellt_am  timestamptz,
  add column erstellt_am    timestamptz not null default now(),
  add column erstellt_von   uuid references benutzer(id);

/** Bestandszeilen waren alle Personen — die Ruecksicherung, bevor `person_id` geht. */
update nachricht_empfaenger
   set empfaenger_typ = 'person', empfaenger_id = person_id
 where empfaenger_typ is null;

alter table nachricht_empfaenger alter column empfaenger_typ set not null;

/**
 * `person_id` geht, und die Policy, die daran hing, mit ihr.
 *
 * Sie war der Grund, warum diese Tabelle einen Kundenansprechpartner nicht
 * adressieren konnte — und warum der Kundenfaden aus `/portal/kunde/…` hier
 * nie ankam. `empfaenger_typ`/`empfaenger_id` sagen dasselbe fuer fuenf
 * Arten statt fuer eine.
 */
drop policy t_empfaenger_person on nachricht_empfaenger;
alter table nachricht_empfaenger drop constraint nachricht_empfaenger_uk;
drop index if exists nachricht_empfaenger_idx;
alter table nachricht_empfaenger drop column person_id;

alter table nachricht_empfaenger
  /** `extern` traegt keine Id, alles andere traegt eine (§7.9). */
  add constraint ne_id_oder_extern check (
    empfaenger_typ = 'extern' or empfaenger_id is not null),
  /** Und `extern` ohne Adresse ist ein Empfaenger, den niemand erreicht. */
  add constraint ne_extern_braucht_adresse check (
    empfaenger_typ <> 'extern' or extern_email is not null);

create unique index ne_uk on nachricht_empfaenger (nachricht_id, empfaenger_typ, empfaenger_id)
  where empfaenger_id is not null;
/**
 * Ohne `mandant_id`-Praefix und mit `nulls first`: die Frage ist „was habe
 * ICH ungelesen", und sie laeuft im Mitarbeiter- wie im Kundenportal ueber
 * mehrere Gesellschaften.
 */
create index ne_empfaenger_idx
  on nachricht_empfaenger (empfaenger_typ, empfaenger_id, gelesen_am nulls first);

comment on table nachricht_empfaenger is
  '§7.9. Wer die Nachricht bekommt — polymorph ueber fuenf Arten. Anfuegend, ausser '
  '`zugestellt_am` und `gelesen_am`.';

-- ---------------------------------------------------------------------------
-- 4. `nachricht_anhang` (§7.9)
-- ---------------------------------------------------------------------------

/**
 * **Ein Kindtabelle statt eines uuid-Arrays, und der Grund ist der Fehlversand.**
 *
 * Der Entwurf trug `anhang_dokument_ids uuid[]` ohne Fremdschluessel. Ein
 * Anhang ist der klassische Fehlversandweg — die Kalkulation der einen
 * Gesellschaft an den Kunden der anderen —, und mit einem Array gab es keine
 * Moeglichkeit zu erzwingen, dass das Dokument derselben Gesellschaft gehoert
 * wie die Nachricht. Mit einer Kindtabelle tut das der zusammengesetzte
 * Fremdschluessel.
 */
create table nachricht_anhang (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  nachricht_id  uuid not null,
  dokument_id   uuid not null,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),

  constraint nachricht_anhang_pk primary key (mandant_id, id),
  constraint nachricht_anhang_id_uk unique (id),
  constraint na_nachricht_fk foreign key (mandant_id, nachricht_id)
    references nachricht (mandant_id, id),
  constraint na_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),
  constraint na_uk unique (nachricht_id, dokument_id)
);

create index na_nachricht_idx on nachricht_anhang (mandant_id, nachricht_id);

comment on table nachricht_anhang is
  '§7.9. Anhaenge als Kindzeilen — der zusammengesetzte FK auf `dokument` erzwingt, dass '
  'Anhang und Nachricht derselben Gesellschaft gehoeren.';

alter table nachricht_anhang enable row level security;
alter table nachricht_anhang force  row level security;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

/**
 * **`p_beteiligt` — die restriktive Decke, je Empfaengerart geschrieben**
 * (§7.9, B11).
 *
 * `auth.uid()` ist eine Anmelde-Id, `person.id` ist es nicht. Ein Mensch
 * meldet sich nach D-09 einmal ueber `mitarbeiter_zugang` an, das an
 * `person_id` haengt — eine an `empfaenger_typ='person'` adressierte
 * Nachricht gegen die Anmelde-Id zu pruefen macht sie fuer genau den
 * Menschen unsichtbar, dem sie geschickt wurde. EMP-11 funktionierte damit
 * nicht, waehrend die Verengung fuer die anderen Arten nichts tat.
 *
 * Restriktiv, also UND: eine zweite erlaubende Policy waere ein ODER, und so
 * wird aus einer Decke ein Loch. Und NICHT als `app.portal() = 'intern'`
 * formuliert, damit sie sich mit allem Uebrigen zusammensetzt (§1.4).
 */
create policy p_beteiligt on nachricht_empfaenger as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (empfaenger_typ = 'benutzer'        and empfaenger_id = app.aktueller_benutzer())
         or (empfaenger_typ = 'person'          and empfaenger_id = app.aktuelle_person())
         or (empfaenger_typ = 'ansprechpartner' and empfaenger_id in
               (select a.id from ansprechpartner a
                 where a.kunde_id = any (app.aktuelle_kunden()))));

/** Die eigene Zustellung sieht der Mensch dahinter, ohne Recht (K-18, Form B). */
create policy t_empfaenger_eigene on nachricht_empfaenger for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and ((empfaenger_typ = 'person'   and empfaenger_id = app.aktuelle_person())
              or (empfaenger_typ = 'benutzer' and empfaenger_id = app.aktueller_benutzer())));

/** Und er darf seine eigene Zeile stempeln — gelesen, nicht mehr. */
create policy t_empfaenger_eigene_stempeln on nachricht_empfaenger for update to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and ((empfaenger_typ = 'person'   and empfaenger_id = app.aktuelle_person())
              or (empfaenger_typ = 'benutzer' and empfaenger_id = app.aktueller_benutzer())))
  with check (mandant_id = any (app.sichtbare_mandanten()));

/**
 * **Der eigene Faden im Mitarbeiterportal** (EMP-11).
 *
 * `t_nachricht_mandant` (0011) verlangt `app.aktiver_mandant()`, und in
 * `person`-Scope ist der NULL. Ohne diese Zeile saehe eine Reinigungskraft
 * die Nachricht nicht, die ihr geschrieben wurde — die Tabelle waere fuer
 * genau den Fall gebaut, in dem sie nicht funktioniert.
 */
create policy t_nachricht_eigene on nachricht for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and (absender_benutzer_id = app.aktueller_benutzer()
              or exists (select 1 from nachricht_empfaenger e
                          where e.mandant_id = nachricht.mandant_id
                            and e.nachricht_id = nachricht.id)));

/**
 * Aendern darf die interne Seite, was sich aendern KANN: Zustellstand,
 * Abschluss des Fadens, weiche Loeschung. `0011` gab nur `insert` — ein
 * Zustellversuch konnte sein Ergebnis nicht zurueckschreiben.
 */
create policy t_nachricht_aendern on nachricht for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('nachricht.versenden', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('nachricht.versenden', app.aktiver_mandant())));

create policy p_beteiligt on nachricht as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or absender_benutzer_id = app.aktueller_benutzer()
         or exists (select 1 from nachricht_empfaenger e
                     where e.mandant_id = nachricht.mandant_id
                       and e.nachricht_id = nachricht.id));

create policy t_anhang_lesen on nachricht_anhang for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('nachricht.lesen', app.aktiver_mandant())));

create policy t_anhang_eigene on nachricht_anhang for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from nachricht n
                      where n.mandant_id = nachricht_anhang.mandant_id
                        and n.id = nachricht_anhang.nachricht_id));

create policy t_anhang_schreiben on nachricht_anhang for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('nachricht.versenden', app.aktiver_mandant())));

/** Der Anhang traegt dieselbe Decke wie sein Elternteil, ueber das Elternteil. */
create policy p_beteiligt on nachricht_anhang as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or exists (select 1 from nachricht n
                     where n.mandant_id = nachricht_anhang.mandant_id
                       and n.id = nachricht_anhang.nachricht_id));

/**
 * **Der Zustellversuch laeuft als `cse_job`** — und es gibt ihn heute nicht.
 *
 * Kein Versender ist verbunden (O-36). Die Policy steht trotzdem, weil sie
 * sagt, was der Job DARF, wenn er kommt: den Zustellstand fortschreiben, und
 * nichts sonst. Der Spalten-Grant darunter ist die eigentliche Zusage.
 */
create policy t_job_nachricht on nachricht for select to cse_job using (true);
create policy t_job_nachricht_zustellen on nachricht for update to cse_job
  using (true) with check (true);
create policy t_job_empfaenger on nachricht_empfaenger for select to cse_job using (true);
create policy t_job_empfaenger_zustellen on nachricht_empfaenger for update to cse_job
  using (true) with check (true);
create policy t_job_anhang on nachricht_anhang for select to cse_job using (true);

/**
 * **`p_gruppe_kein_personenbezug` steht hier NICHT — und das ist gemeldet,
 * nicht vergessen.**
 *
 * `06-RADAR-KI-INHALT.md` §1.4 fuehrt `nachricht`, `nachricht_anhang` und
 * `nachricht_empfaenger` in der Liste der Tabellen, die in der
 * Gruppenansicht null Zeilen liefern sollen: TEN-05 gibt der Gruppe Zahlen,
 * nicht den Vertragstext einer Schwestergesellschaft. `0011` hat aber
 * `t_nachricht_gruppe` mit `gruppe.nachricht.lesen` angelegt, und der
 * Schluessel steht im Rechtekatalog. Beides gleichzeitig ist ein
 * Widerspruch: die restriktive Decke machte die vorhandene Policy und den
 * vorhandenen Schluessel wirkungslos — still, ohne Fehlermeldung.
 *
 * Deshalb bleibt es, wie es ist, und die Frage geht zurueck an den Kunden,
 * statt hier entschieden zu werden.
 * // TODO(client, O-651): Darf die Gruppenleitung Nachrichtenfaeden der vier
 * Gesellschaften lesen (`gruppe.nachricht.lesen`, so gebaut seit 0011), oder
 * gilt §1.4 und die Gruppenansicht sieht dort nichts?
 */

grant select, insert, update on nachricht to cse_app;
grant select, insert, update on nachricht_empfaenger to cse_app;
grant select, insert on nachricht_anhang to cse_app;
grant select on nachricht, nachricht_empfaenger, nachricht_anhang to cse_job;
grant update (zustell_status, zustell_fehler, gesendet_am, geaendert_am)
      on nachricht to cse_job;
grant update (zugestellt_am) on nachricht_empfaenger to cse_job;

-- ---------------------------------------------------------------------------
-- 6. Keine harte Loeschung (Invariante 8) — erzeugt, siehe 0175.
-- ---------------------------------------------------------------------------

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0231)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- nachricht (soft): § 7 UWG, LEG-08, CRM-08. Die ausgehende Nachricht IST der Nachweis, auf welcher Rechtsgrundlage jemand kontaktiert wurde — und bei einem Agentenentwurf zusaetzlich, wer ihn freigegeben hat. Eine geloeschte Zeile ist gegenueber einer Abmahnung kein Nachweis. Ein Faden wird mit `geschlossen_am` beendet, eine Zeile mit `geloescht_am` aus der Liste genommen.
create trigger trg_nachricht_kein_hard_delete
  before delete on nachricht
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachricht_kein_truncate
  before truncate on nachricht
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachricht from cse_app, cse_anon, cse_checkin, cse_job;

-- nachricht_empfaenger (append): § 7 UWG. WEM etwas geschickt wurde, ist die Haelfte des Nachweises; die andere steht in `nachricht`. Eine Empfaengerzeile zu loeschen hiesse, die Werbemail zu behalten und den Empfaenger zu vergessen. Anfuegend, ausser `zugestellt_am` und `gelesen_am`.
create trigger trg_nachricht_empfaenger_kein_hard_delete
  before delete on nachricht_empfaenger
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachricht_empfaenger_kein_truncate
  before truncate on nachricht_empfaenger
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachricht_empfaenger from cse_app, cse_anon, cse_checkin, cse_job;

-- nachricht_anhang (append): DOC-03, § 7 UWG. Ein Anhang ist der klassische Fehlversandweg; welche Datei mit welcher Nachricht hinausgegangen ist, muss belegbar bleiben. Die Datei selbst haengt an `dokument` und hat dort ihre eigene Aufbewahrung.
create trigger trg_nachricht_anhang_kein_hard_delete
  before delete on nachricht_anhang
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachricht_anhang_kein_truncate
  before truncate on nachricht_anhang
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachricht_anhang from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
