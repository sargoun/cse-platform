-- 0160 — Der zentrale Kalender und sein iCal-Ausgang (CAL-01, CAL-02, CAL-03).

/**
 * **Der Kalender SAMMELT, er kopiert nicht.**
 *
 * Die Versuchung wäre eine Tabelle, in die jede Schicht, jeder Projekttermin
 * und jede Frist als Kalenderzeile hineingeschrieben wird. Sie wäre falsch,
 * und zwar auf die teure Art: Dienstplan und Kalender hätten dann je eine
 * eigene Wahrheit über dieselbe Schicht, und beim ersten Verschieben
 * unterscheiden sie sich. Wer danach fragt, wann jemand arbeitet, bekommt
 * zwei Antworten und keinen Hinweis, welche gilt.
 *
 * Deshalb steht hier nur, was der Kalender SELBST besitzt: Besprechungen,
 * Kundentermine, Wiedervorlagen, Bewerbungsgespräche. Alles andere — Einsätze
 * (`einsatz`), Projekttermine (`projekt.soll_ende`, `ist_ende`),
 * Vergabefristen (`ausschreibung.frist_angebot`), Lead-Fristen
 * (`lead.sla_frist_am`), Freigabefristen (`freigabe.frist`) — liest der Dienst
 * aus seiner Quelle und reicht es durch. Eine Verschiebung im Dienstplan ist
 * im Kalender sofort sichtbar, weil es dieselbe Zeile ist.
 *
 * Was folgt daraus für das Schreiben: **eine Schicht ändert man im
 * Dienstplan.** Der Kalender zeigt sie und verlinkt sie; er hat keinen
 * Schreibpfad auf fremde Zeilen, und das ist keine Lücke.
 */

create type kalender_art as enum (
  'besprechung',
  'kundentermin',
  'wiedervorlage',
  'bewerbungsgespraech',
  'sonstiges'
);

comment on type kalender_art is
  'CAL-01. Nur, was der Kalender SELBST besitzt. Schichten, Projekttermine und Fristen '
  'sind keine Arten hier — sie stehen in ihrer eigenen Tabelle und werden gelesen.';

create table kalender_eintrag (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  art           kalender_art not null default 'besprechung',
  titel         text not null,
  beschreibung  text,
  ort           text,

  /**
   * **Zwei Zeitpunkte in UTC, angezeigt in Europe/Berlin** (Invariante 2).
   * Ein Termin, der über die Zeitumstellung läuft, ist genauso lang wie
   * vorher — die Differenz zweier Instants ändert sich nicht, wenn eine
   * Uhrzeit sich ändert.
   */
  beginn        timestamptz not null,
  ende          timestamptz not null,
  /**
   * Ganztägig ist kein Termin von 00:00 bis 23:59, sondern eine eigene
   * Aussage: iCal schreibt dafür `VALUE=DATE`, und ein Kalender zeigt es
   * anders an. Ohne diese Spalte wäre jeder ganztägige Termin nach dem
   * Export ein Balken, der um Mitternacht anfängt.
   */
  ganztaegig    boolean not null default false,

  /** Wer den Termin führt, und wer eingeladen ist. */
  besitzer_benutzer_id uuid references benutzer(id),
  teilnehmer    uuid[] not null default '{}',

  /** Woran er hängt — Objekt, Projekt, Lead, Bewerbung. Alles optional. */
  bezug_typ     text,
  bezug_id      uuid,

  abgesagt_am   timestamptz,
  abgesagt_grund text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint kalender_eintrag_pk primary key (mandant_id, id),
  constraint ke_titel_nicht_leer check (btrim(titel) <> ''),
  /**
   * **Ende nach Beginn, ohne Ausnahme für ganztägig.** Ein Termin, der endet,
   * bevor er beginnt, ist in jedem Kalender ein Anzeigefehler; bei einem
   * ganztägigen ist das Ende der Tag nach dem letzten (iCal ist dort
   * exklusiv), also ist es dort erst recht später.
   */
  constraint ke_ende_nach_beginn check (ende > beginn),
  constraint ke_absage_begruendet check (
    abgesagt_am is null or (abgesagt_grund is not null and btrim(abgesagt_grund) <> ''))
);

create index ke_zeitraum_idx on kalender_eintrag (mandant_id, beginn);
create index ke_besitzer_idx on kalender_eintrag (mandant_id, besitzer_benutzer_id, beginn);

comment on table kalender_eintrag is
  'CAL-01. Was der Kalender selbst besitzt. Einsaetze, Projekttermine und Fristen stehen '
  'NICHT hier — sie werden aus ihrer Quelle gelesen, damit es eine Wahrheit gibt.';

create trigger trg_ke_geaendert before update on kalender_eintrag
  for each row execute function kern.setze_geaendert_am();

alter table kalender_eintrag enable row level security;
alter table kalender_eintrag force  row level security;

create policy t_kalender_lesen on kalender_eintrag for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('kalender.lesen', app.aktiver_mandant())));

/**
 * **In der Gruppenansicht lesbar, nie schreibbar** (Invariante 10, TEN-05).
 * Ein Termin ist keine Zahl, die man aufteilt — aber wer die Gruppe führt,
 * muss sehen, wann in welcher Gesellschaft was ansteht.
 */
create policy t_kalender_gruppe on kalender_eintrag for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.kalender.lesen')));

/**
 * **Der eigene Termin ist auch im Mitarbeiterportal sichtbar.**
 *
 * Ohne diese Zeile sähe ein Mitarbeiterkonto seinen eigenen Termin nicht:
 * `kalender.lesen` ist ein internes Recht, und die K-04-Decke unten schliesst
 * das Mitarbeiterportal ohnehin aus. Sichtbar ist genau das, worin dieser
 * Mensch Teilnehmer oder Besitzer ist — nichts sonst.
 */
create policy t_kalender_eigene on kalender_eintrag for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and (besitzer_benutzer_id = app.aktueller_benutzer()
              or app.aktueller_benutzer() = any (teilnehmer)));

create policy t_kalender_schreiben on kalender_eintrag for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('kalender.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('kalender.schreiben', app.aktiver_mandant())));

/** Der Kundenzugang hat im Kalender nichts zu suchen (K-04). */
create policy p_kalender_decke on kalender_eintrag as restrictive for all to cse_app
  using      (app.portal() in ('intern', 'mitarbeiter'))
  with check (app.portal() = 'intern');

create policy j_kalender on kalender_eintrag for all to cse_job using (true) with check (true);

grant select, insert, update, delete on kalender_eintrag to cse_app;
grant select, insert, update, delete on kalender_eintrag to cse_job;


/**
 * **Der iCal-Ausgang: ein Token je Mensch, kein Kennwort** (CAL-03).
 *
 * Ein Kalenderprogramm holt den Feed ohne Sitzung — es kann sich nicht
 * anmelden und keinen zweiten Faktor führen. Der Zugang ist deshalb ein
 * langer Zufallswert in der Adresse, und daraus folgt alles Weitere:
 *
 *  · **Nur LESEN.** Wer die Adresse hat, sieht Termine. Ändern kann er
 *    nichts — es gibt keinen Schreibweg über diesen Token.
 *  · **Gespeichert wird der HASH, nicht der Token.** Wer die Datenbank liest,
 *    bekommt keinen Kalenderzugang. Derselbe Grund wie beim Kennwort.
 *  · **Einmal zeigen, danach nie wieder.** Die Seite zeigt die Adresse bei der
 *    Ausgabe; danach steht dort, wann sie ausgegeben wurde, und der einzige
 *    Weg zu einer neuen ist eine neue.
 *  · **Widerrufbar und drehbar**, und ein Widerruf wirkt sofort.
 *
 * `letzter_abruf_am` steht hier, weil ein Feed, den seit einem Jahr niemand
 * abgeholt hat, ein Token ist, das nur noch ein Risiko ist.
 */
create table kalender_feed (
  id              uuid primary key default gen_random_uuid(),
  benutzer_id     uuid not null references benutzer(id),
  token_hash      text not null,
  bezeichnung     text not null default 'Mein Kalender',
  erstellt_am     timestamptz not null default now(),
  letzter_abruf_am timestamptz,
  abrufe          integer not null default 0,
  widerrufen_am   timestamptz,

  constraint kf_token_hash_uk unique (token_hash),
  constraint kf_hash_ist_sha256 check (token_hash ~ '^[0-9a-f]{64}$')
);

comment on table kalender_feed is
  'CAL-03. Ein lesender iCal-Zugang je Mensch. Gespeichert wird der SHA-256 des Tokens; '
  'die Adresse selbst gibt es genau einmal, bei der Ausgabe.';

create index kf_benutzer_idx on kalender_feed (benutzer_id) where widerrufen_am is null;

alter table kalender_feed enable row level security;
alter table kalender_feed force  row level security;

/** Jeder sieht nur seine eigenen Feeds — auch die Administration. */
create policy t_feed_eigene on kalender_feed for all to cse_app
  using      (benutzer_id = app.aktueller_benutzer())
  with check (benutzer_id = app.aktueller_benutzer() and not app.ist_readonly());

grant select, insert, update on kalender_feed to cse_app;

/**
 * **Der Abruf läuft ohne Sitzung — also über einen Definer.**
 *
 * `app.kalender_feed_aufloesen` nimmt den Hash, findet den Benutzer und
 * zählt den Abruf. Sie gibt NICHT die Termine heraus: das tut die Anwendung
 * danach in einer Sitzung, die sie für genau diesen Menschen bindet. Ein
 * Definer, der gleich die Termine mitgäbe, wäre ein zweiter Lesepfad neben
 * RLS — und der erste, der bei einer Policy-Änderung vergessen wird.
 */
create function app.kalender_feed_aufloesen(p_hash text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_benutzer uuid;
begin
  update public.kalender_feed
     set letzter_abruf_am = now(), abrufe = abrufe + 1
   where token_hash = p_hash
     and widerrufen_am is null
  returning benutzer_id into v_benutzer;

  return v_benutzer;
end
$$;

comment on function app.kalender_feed_aufloesen(text) is
  'CAL-03. Loest einen Feed-Token auf und zaehlt den Abruf. Gibt nur die Benutzer-ID '
  'heraus, nie Termine — die liest die Anwendung in einer gebundenen Sitzung.';

alter function app.kalender_feed_aufloesen(text) owner to cse_definer;
revoke execute on function app.kalender_feed_aufloesen(text) from public;
grant execute on function app.kalender_feed_aufloesen(text) to cse_app;

grant select, update on public.kalender_feed to cse_definer;
create policy d_feed_aufloesen on kalender_feed for select to cse_definer using (true);
create policy d_feed_zaehlen on kalender_feed for update to cse_definer
  using (widerrufen_am is null) with check (true);
