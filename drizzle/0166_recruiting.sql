-- 0166 — Recruiting (REC-01…REC-09, LEG-11, LEG-12).

/**
 * **Die Einstellung entscheidet ein Mensch. Die Rangfolge ist ein Vorschlag
 * mit sichtbaren Kriterien.**
 *
 * Das ist REC-08, und es ist hier kein Grundsatz, sondern ein Riegel: Art. 22
 * DSGVO verbietet eine Entscheidung, die ausschliesslich auf automatisierter
 * Verarbeitung beruht und dem Menschen gegenueber rechtliche Wirkung entfaltet
 * — eine Absage auf eine Bewerbung ist genau das. Deshalb traegt
 * `einstellungsentscheidung` einen BENANNTEN Menschen als Pflichtfeld, und
 * `entscheidung_ist_menschlich` verlangt, dass es DER ANGEMELDETE ist — keine
 * Entscheidung im Namen eines anderen, kein Eintrag ohne Sitzung. Eine
 * Bewertung darf `agent` als Urheber haben; eine Entscheidung nie.
 *
 * Der Riegel fragt bewusst NICHT `app.akteur_typ`: das ist eine GUC, die der
 * Aufrufer selbst setzt, und ein Weg, der sie einfach nicht auf `agent`
 * setzt, waere durchgekommen, ohne den Zaun zu beruehren. Sie dient dem
 * PROTOKOLL und nichts sonst — `tests/isolation/unveraenderbarkeit.test.ts`
 * haelt diese Trennung fest.
 *
 * **Die Bewertung nennt ihre Kriterien einzeln.** Eine Gesamtpunktzahl ohne
 * die Zeilen, aus denen sie entsteht, ist keine Begruendung — sie ist eine
 * Zahl, der man glauben soll. `bewerbung_bewertung` fuehrt deshalb je Kriterium
 * eine Zeile mit Gewicht, Punkten und einem Satz dazu; die Summe rechnet die
 * ANWENDUNG in einer gepruefen Funktion (Invariante 6), nicht ein Modell.
 *
 * **Bewerberdaten haben eine Uhr** (REC-07, LEG-11). `aufbewahrung_bis` steht
 * an jeder Bewerbung, wird beim Eingang gesetzt und vom Nachtlauf abgeraeumt.
 * Wie lange, weiss der Mandant und nicht diese Datei: die Vorgabe unten ist
 * ein PLATZHALTER (O-373), erkennbar an `ist_vorlaeufig`, und der Loeschlauf
 * schreibt jede Loeschung in `bewerbung_loeschlauf` — eine Loeschung ohne
 * Protokoll ist gegenueber der Aufsicht kein Nachweis.
 *
 * **Eine Stelle geht nur dorthin, wo es einen echten Anschluss gibt**
 * (REC-09, D-02). `stelle_veroeffentlichung` fuehrt je Ziel ein eigenes
 * Ergebnis, und `nicht_verbunden` ist ein ZUSTAND, kein Fehler: keine Zeile
 * behauptet je, etwas sei bei einer Jobboerse erschienen, weil ein Adapter
 * `true` zurueckgegeben hat. Die eigene Karriereseite ist dabei kein Kanal —
 * sie IST das Haus, genau wie die Gesellschaftsseite bei Social (0163).
 */

create type stelle_status as enum (
  'entwurf',
  'freigegeben',
  'veroeffentlicht',
  'geschlossen'
);

create type bewerbung_status as enum (
  'eingegangen',
  'in_pruefung',
  'gespraech',
  'abgelehnt',
  'eingestellt',
  'zurueckgezogen'
);

create type bewerbung_quelle as enum (
  'karriereseite',
  'initiativ',
  'mail',
  'import'
);

create type gespraech_status as enum (
  'geplant',
  'stattgefunden',
  'abgesagt'
);

/** Wohin eine Stelle gehen KANN. Die eigene Seite steht bewusst nicht dabei. */
create type stellenboerse as enum (
  'bundesagentur',
  'indeed',
  'stepstone',
  'linkedin'
);

create type veroeffentlichung_ergebnis as enum (
  'offen',
  'veroeffentlicht',
  'nicht_verbunden',
  'fehlgeschlagen'
);

-- ---------------------------------------------------------------------------
-- Die Stelle
-- ---------------------------------------------------------------------------

create table stelle (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  titel         text not null,
  /** Der Fliesstext der Anzeige. Ein Entwurf darf von der KI kommen (REC-02). */
  beschreibung  text not null,
  /**
   * Was die Stelle verlangt — je Zeile eine Anforderung, weil die Bewertung
   * spaeter GEGEN diese Zeilen laeuft (REC-05). Ein Fliesstext liesse sich
   * nicht als Kriterium ausweisen.
   */
  anforderungen text[] not null default '{}',

  /** Der Ort, an dem gearbeitet wird — frei, weil nicht jede Stelle an einem Objekt haengt. */
  einsatzort    text,
  /** Umfang in Wochenstunden; NULL heisst "nicht festgelegt", nie "null Stunden". */
  wochenstunden numeric(5,2) check (wochenstunden is null or wochenstunden > 0),

  status        stelle_status not null default 'entwurf',
  /** Ab `freigegeben` haengt die Stelle an einer Freigabe (Invariante 7). */
  freigabe_id   uuid,

  veroeffentlicht_am timestamptz,
  bewerbungsfrist    date,
  geschlossen_am     timestamptz,
  geschlossen_grund  text,

  /**
   * **Woher der Entwurf kommt** (REC-02). `ki` heisst: ein Modell hat ihn
   * geschrieben, ein Mensch hat ihn noch nicht bestaetigt. Der Unterschied
   * steht auf dem Bildschirm, damit niemand einen Entwurf fuer eine
   * redigierte Anzeige haelt.
   */
  entwurf_von_art  akteur_art not null default 'mensch',

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint stelle_pk primary key (mandant_id, id),
  constraint stelle_id_uk unique (id),
  constraint stelle_freigabe_fk
    foreign key (mandant_id, freigabe_id) references freigabe (mandant_id, id),

  constraint stelle_titel_nicht_leer check (btrim(titel) <> ''),
  constraint stelle_beschreibung_nicht_leer check (btrim(beschreibung) <> ''),
  /**
   * Ab `freigegeben` haengt jede Stelle an einer Freigabe. Ohne diese
   * Bedingung liesse sich der Status mit einem `update` setzen, und die
   * Freigabe waere Zierde — dieselbe Ueberlegung wie bei `beitrag` in 0163.
   */
  constraint stelle_freigegeben_hat_freigabe check (
    status not in ('freigegeben', 'veroeffentlicht') or freigabe_id is not null),
  constraint stelle_veroeffentlicht_hat_zeitpunkt check (
    status <> 'veroeffentlicht' or veroeffentlicht_am is not null),
  constraint stelle_geschlossen_begruendet check (
    geschlossen_am is null
    or (geschlossen_grund is not null and btrim(geschlossen_grund) <> ''))
);

comment on table stelle is
  'REC-01, REC-02. Die Stellenanzeige. Ihr Weg nach draussen steht in '
  'stelle_veroeffentlichung — je Ziel ein eigenes Ergebnis (REC-09).';

create index stelle_status_idx on stelle (mandant_id, status);

create table stelle_veroeffentlichung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  stelle_id     uuid not null,

  boerse        stellenboerse not null,
  ergebnis      veroeffentlichung_ergebnis not null default 'offen',
  veroeffentlicht_am timestamptz,
  /** Die Kennung auf der fremden Plattform — leer, solange nichts rausging. */
  externe_ref   text,
  /** Warum es nicht ging. Steht auf dem Bildschirm, nicht nur im Protokoll. */
  meldung       text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint stelle_veroeff_pk primary key (mandant_id, id),
  constraint stelle_veroeff_id_uk unique (id),
  constraint stelle_veroeff_stelle_fk
    foreign key (mandant_id, stelle_id) references stelle (mandant_id, id),
  constraint stelle_veroeff_je_boerse unique (stelle_id, boerse),
  constraint stelle_veroeff_erfolg_hat_zeitpunkt check (
    ergebnis <> 'veroeffentlicht' or veroeffentlicht_am is not null)
);

comment on table stelle_veroeffentlichung is
  'REC-09, D-02. Je Jobboerse ein eigenes Ergebnis. `nicht_verbunden` ist ein '
  'Zustand, kein Fehler — und niemals wird eine Zeile veroeffentlicht gefuehrt, '
  'weil ein Adapter true gesagt hat.';

-- ---------------------------------------------------------------------------
-- Die Bewerbung
-- ---------------------------------------------------------------------------

create table bewerbung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  /** NULL heisst Initiativbewerbung — sie gehoert zu keiner Stelle. */
  stelle_id     uuid,

  quelle        bewerbung_quelle not null default 'karriereseite',
  status        bewerbung_status not null default 'eingegangen',

  name          text not null,
  email         text not null,
  telefon       text,
  nachricht     text,

  eingegangen_am timestamptz not null default now(),

  /**
   * **Die Uhr** (REC-07, LEG-11). Gesetzt beim Eingang, abgeraeumt vom
   * Nachtlauf. Die Frist selbst ist ein PLATZHALTER (O-373): sie gehoert dem
   * Mandanten, nicht dieser Datei.
   */
  aufbewahrung_bis date not null,
  geloescht_am     timestamptz,
  /** Warum die Zeile noch steht, obwohl die Frist abgelaufen ist. */
  loeschsperre     text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint bewerbung_pk primary key (mandant_id, id),
  constraint bewerbung_id_uk unique (id),
  constraint bewerbung_stelle_fk
    foreign key (mandant_id, stelle_id) references stelle (mandant_id, id),

  constraint bewerbung_name_nicht_leer check (btrim(name) <> ''),
  constraint bewerbung_email_form check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint bewerbung_initiativ_ohne_stelle check (
    (quelle = 'initiativ') = (stelle_id is null))
);

comment on table bewerbung is
  'REC-03, REC-07. Die Bewerbung, wie sie eingegangen ist. Die strukturierte '
  'Fassung steht in kandidat — und sie ist eine EXTRAKTION, keine Aussage.';

create index bewerbung_status_idx on bewerbung (mandant_id, status);
create index bewerbung_aufbewahrung_idx on bewerbung (aufbewahrung_bis)
  where geloescht_am is null;

create table kandidat (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  bewerbung_id  uuid not null,

  /**
   * **Was aus dem Lebenslauf gelesen wurde — und von wem.**
   *
   * `quelle_art = 'agent'` heisst: ein Modell hat es extrahiert und niemand hat
   * es bestaetigt. Das steht auf dem Bildschirm, weil eine gelesene
   * Qualifikation und eine geprueefte zwei verschiedene Dinge sind (REC-04).
   */
  quelle_art     akteur_art not null default 'agent',
  bestaetigt_am timestamptz,
  bestaetigt_von uuid references benutzer(id),

  qualifikationen text[] not null default '{}',
  sprachen        text[] not null default '{}',
  /** Ganze Jahre; NULL heisst "nicht erkannt", nie "null Jahre". */
  erfahrung_jahre integer check (erfahrung_jahre is null or erfahrung_jahre >= 0),
  notiz           text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint kandidat_pk primary key (mandant_id, id),
  constraint kandidat_id_uk unique (id),
  constraint kandidat_bewerbung_fk
    foreign key (mandant_id, bewerbung_id) references bewerbung (mandant_id, id),
  constraint kandidat_je_bewerbung unique (bewerbung_id),
  constraint kandidat_bestaetigung_vollstaendig check (
    (bestaetigt_am is null) = (bestaetigt_von is null))
);

comment on table kandidat is
  'REC-04. Der aus dem Lebenslauf gelesene Datensatz. quelle_art sagt, ob ihn '
  'ein Mensch oder ein Modell erzeugt hat — der Unterschied steht auf dem Schirm.';

-- ---------------------------------------------------------------------------
-- Bewertung und Entscheidung — die Stelle, an der REC-08 haengt
-- ---------------------------------------------------------------------------

create table bewerbung_bewertung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  bewerbung_id  uuid not null,

  /** Das Kriterium im Klartext — es steht spaeter so auf dem Bildschirm. */
  kriterium     text not null,
  /** Gewicht und Punkte als ganze Zahlen: 0..100 bzw. 0..10. */
  gewicht       integer not null check (gewicht between 0 and 100),
  punkte        integer not null check (punkte between 0 and 10),
  /** Ein Satz, warum. Pflicht: eine Zahl ohne Grund ist keine Begruendung. */
  begruendung   text not null,

  /** `agent` ist hier erlaubt — bei der ENTSCHEIDUNG unten nicht. */
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von  uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),

  constraint bewertung_pk primary key (mandant_id, id),
  constraint bewertung_id_uk unique (id),
  constraint bewertung_bewerbung_fk
    foreign key (mandant_id, bewerbung_id) references bewerbung (mandant_id, id),
  constraint bewertung_kriterium_nicht_leer check (btrim(kriterium) <> ''),
  constraint bewertung_begruendung_nicht_leer check (btrim(begruendung) <> '')
);

comment on table bewerbung_bewertung is
  'REC-05, REC-08. Je Kriterium eine Zeile mit Gewicht, Punkten und einem Satz. '
  'Die Summe rechnet eine geprueefte Funktion der Anwendung, nie ein Modell '
  '(Invariante 6).';

create index bewertung_bewerbung_idx on bewerbung_bewertung (mandant_id, bewerbung_id);

create table einstellungsentscheidung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  bewerbung_id  uuid not null,

  /** `eingestellt` oder `abgelehnt` — mehr gibt es nicht zu entscheiden. */
  ergebnis      bewerbung_status not null,
  begruendung   text not null,

  /**
   * **Der Mensch, der entschieden hat** — Pflichtfeld, und der Ausloeser
   * unten weist alles andere ab (REC-08, Art. 22 DSGVO).
   */
  entschieden_von uuid not null references benutzer(id),
  entschieden_am  timestamptz not null default now(),

  constraint entscheidung_pk primary key (mandant_id, id),
  constraint entscheidung_id_uk unique (id),
  constraint entscheidung_bewerbung_fk
    foreign key (mandant_id, bewerbung_id) references bewerbung (mandant_id, id),
  constraint entscheidung_je_bewerbung unique (bewerbung_id),
  constraint entscheidung_ergebnis_zulaessig check (
    ergebnis in ('eingestellt', 'abgelehnt')),
  constraint entscheidung_begruendung_nicht_leer check (btrim(begruendung) <> '')
);

comment on table einstellungsentscheidung is
  'REC-08, LEG-12, Art. 22 DSGVO. Eine Einstellungsentscheidung traegt immer '
  'einen benannten Menschen. Eine Rangfolge ist ein Vorschlag, keine Entscheidung.';

-- ---------------------------------------------------------------------------
-- Gespraech und Loeschlauf
-- ---------------------------------------------------------------------------

create table gespraech (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  bewerbung_id  uuid not null,

  status        gespraech_status not null default 'geplant',
  /** UTC gespeichert, Europe/Berlin angezeigt (Invariante 2). */
  termin        timestamptz not null,
  dauer_minuten integer not null default 60 check (dauer_minuten > 0),
  ort           text,
  /** Die vorbereiteten Fragen — je Zeile eine (REC-06). */
  fragen        text[] not null default '{}',
  notiz         text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  constraint gespraech_pk primary key (mandant_id, id),
  constraint gespraech_id_uk unique (id),
  constraint gespraech_bewerbung_fk
    foreign key (mandant_id, bewerbung_id) references bewerbung (mandant_id, id)
);

comment on table gespraech is
  'REC-06, CAL-01. Termin und vorbereitete Fragen.';

create index gespraech_termin_idx on gespraech (mandant_id, termin);

create table bewerbung_loeschlauf (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  gelaufen_am   timestamptz not null default now(),
  /** Wie viele Zeilen die Frist ueberschritten hatten und geloescht wurden. */
  geloescht     integer not null default 0 check (geloescht >= 0),
  /** Wie viele stehen blieben, weil eine Loeschsperre daran haengt. */
  gesperrt      integer not null default 0 check (gesperrt >= 0),
  /** Die Kennungen, damit die Aufsicht den Lauf nachvollziehen kann. */
  bewerbungen   uuid[] not null default '{}',

  constraint loeschlauf_pk primary key (mandant_id, id),
  constraint loeschlauf_id_uk unique (id)
);

comment on table bewerbung_loeschlauf is
  'REC-07, LEG-11. Eine Loeschung ohne Protokoll ist gegenueber der Aufsicht '
  'kein Nachweis.';

-- ---------------------------------------------------------------------------
-- Ausloeser
-- ---------------------------------------------------------------------------

create trigger stelle_geaendert before update on stelle
  for each row execute function kern.setze_geaendert_am();
create trigger stelle_veroeff_geaendert before update on stelle_veroeffentlichung
  for each row execute function kern.setze_geaendert_am();
create trigger bewerbung_geaendert before update on bewerbung
  for each row execute function kern.setze_geaendert_am();
create trigger kandidat_geaendert before update on kandidat
  for each row execute function kern.setze_geaendert_am();
create trigger gespraech_geaendert before update on gespraech
  for each row execute function kern.setze_geaendert_am();

/**
 * **REC-08 als Riegel, nicht als Grundsatz.**
 *
 * `entschieden_von` ist schon `not null`; das allein reicht nicht, denn ein
 * Agentenlauf koennte das Konto eines Menschen benutzen. Geprueft wird deshalb
 * die SITZUNG: wer entscheidet, muss als Mensch angemeldet sein
 * (`app.akteur_typ() = 'mensch'`). Ein Agent, der diese Zeile schreiben will,
 * faellt hier — und zwar mit einem Satz, der sagt warum.
 */
/**
 * **Die Entscheidung traegt den Namen dessen, der sie schreibt** (REC-08,
 * Art. 22 DSGVO).
 *
 * **Warum hier NICHT `app.akteur_typ` steht, obwohl es naheliegt.** Die erste
 * Fassung fragte genau das: `akteur_typ <> 'mensch'` -> abweisen. Gefunden hat
 * das `tests/isolation/unveraenderbarkeit.test.ts`, und die Regel dort ist
 * richtig: `app.akteur_typ` ist eine GUC, die der Aufrufer selbst setzt. Sie
 * ist dazu da, zu PROTOKOLLIEREN, wer gehandelt hat, und fuer nichts sonst —
 * ein Weg, der sie schlicht nicht auf `agent` setzt, haette den Riegel
 * durchschritten, ohne ihn zu beruehren. Ein Zaun, den man durch Weglassen
 * uebersteigt, ist keiner; er ist schlimmer als keiner, weil man sich auf ihn
 * beruft.
 *
 * Was die Datenbank WIRKLICH weiss, ist, wer die Sitzung haelt. Geprueft wird
 * deshalb das: `entschieden_von` muss der angemeldete Benutzer sein. Eine
 * Entscheidung im Namen eines anderen gibt es damit nicht — und ein Lauf ohne
 * Sitzung (`cse_job`, ein Agent, ein Skript) hat keinen `app.benutzer_id` und
 * kommt gar nicht erst an der Zeile vorbei.
 *
 * Die Zusage aus Art. 22 ruht damit auf drei Dingen, und keines davon ist eine
 * GUC: dem Recht `recruiting.entscheiden` (03-AUTH), dieser Zeile, und
 * Invariante 7 — kein Agent handelt ohne menschliche Freigabe.
 */
create function kern.entscheidung_ist_menschlich() returns trigger
language plpgsql as $$
declare
  angemeldet uuid := app.aktueller_benutzer();
begin
  if angemeldet is null then
    raise exception 'Eine Einstellungsentscheidung braucht eine angemeldete Person'
      using errcode = 'insufficient_privilege',
            detail  = 'REC-08, Art. 22 DSGVO: eine Absage ist eine Entscheidung '
                      || 'mit rechtlicher Wirkung und darf nicht ausschliesslich '
                      || 'automatisiert ergehen.',
            hint    = 'Die Rangfolge ist ein Vorschlag. Entschieden wird im Portal.';
  end if;
  if new.entschieden_von <> angemeldet then
    raise exception 'Eine Einstellungsentscheidung traegt den Namen dessen, der sie schreibt'
      using errcode = 'insufficient_privilege',
            detail  = 'REC-08: entschieden_von muss der angemeldete Benutzer sein.',
            hint    = 'Im Streit zaehlt, wer entschieden hat — nicht, wer eingetragen wurde.';
  end if;
  return new;
end $$;

create trigger entscheidung_menschlich
  before insert or update on einstellungsentscheidung
  for each row execute function kern.entscheidung_ist_menschlich();

/**
 * Die Entscheidung zieht den Status der Bewerbung nach — in DERSELBEN
 * Transaktion. Zwei Bildschirme mit zwei Antworten ueber denselben Vorgang
 * sind schlimmer als einer ohne Antwort.
 */
create function kern.entscheidung_zieht_bewerbung_nach() returns trigger
language plpgsql as $$
begin
  update bewerbung set status = new.ergebnis, geaendert_am = now()
   where id = new.bewerbung_id and mandant_id = new.mandant_id;
  return new;
end $$;

create trigger entscheidung_zieht_bewerbung_nach
  after insert on einstellungsentscheidung
  for each row execute function kern.entscheidung_zieht_bewerbung_nach();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table stelle                 enable row level security;
alter table stelle                 force  row level security;
alter table stelle_veroeffentlichung enable row level security;
alter table stelle_veroeffentlichung force  row level security;
alter table bewerbung              enable row level security;
alter table bewerbung              force  row level security;
alter table kandidat               enable row level security;
alter table kandidat               force  row level security;
alter table bewerbung_bewertung    enable row level security;
alter table bewerbung_bewertung    force  row level security;
alter table einstellungsentscheidung enable row level security;
alter table einstellungsentscheidung force  row level security;
alter table gespraech              enable row level security;
alter table gespraech              force  row level security;
alter table bewerbung_loeschlauf   enable row level security;
alter table bewerbung_loeschlauf   force  row level security;

/**
 * **Die Karriereseite liest ohne Sitzung** — genau wie die
 * Gesellschaftsseite bei Social (0163). Sie sieht ausschliesslich
 * veroeffentlichte, nicht geschlossene Stellen; ein Entwurf ist hier null
 * Zeilen, und das ist der Unterschied zwischen einer Anzeige und einer Notiz.
 */
create policy t_stelle_oeffentlich on stelle for select to cse_app
  using (status = 'veroeffentlicht' and geschlossen_am is null);

create policy t_stelle_lesen on stelle for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.stelle_lesen', app.aktiver_mandant())));

create policy t_stelle_gruppe on stelle for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.recruiting.lesen')));

create policy t_stelle_schreiben on stelle for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('recruiting.stelle_schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('recruiting.stelle_schreiben', app.aktiver_mandant())));

create policy t_stelle_veroeff_lesen on stelle_veroeffentlichung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.stelle_lesen', app.aktiver_mandant())));

create policy t_stelle_veroeff_schreiben on stelle_veroeffentlichung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('recruiting.stelle_veroeffentlichen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('recruiting.stelle_veroeffentlichen', app.aktiver_mandant())));

/**
 * **Das Bewerbungsformular schreibt ohne Sitzung** (REC-03) — und liest
 * nichts.
 *
 * Eine `with check`-Regel ohne `using` erlaubt genau das: einfuegen ja,
 * sehen nein. Der Formular-Eingang der oeffentlichen Seite arbeitet seit 0015
 * so, und hier gilt derselbe Grund — wer ein Formular abschickt, darf nicht
 * daraufhin die Bewerbungen der anderen lesen.
 *
 * `status`, `quelle` und `aufbewahrung_bis` legt die ANWENDUNG fest; die
 * Bedingung hier sorgt nur dafuer, dass niemand ueber dieses Tor eine
 * Bewerbung in einem fortgeschrittenen Zustand einschleust.
 */
create policy t_bewerbung_eingang on bewerbung for insert to cse_app
  with check (status = 'eingegangen'
              and geloescht_am is null
              /*
               * K-03 gilt auch hier: der Mandant kommt aus dem gebundenen
               * Kontext, nie aus der Anfrage. `withEingang` bindet genau einen
               * — ohne diese Zeile koennte jede Sitzung eine Bewerbung in eine
               * FREMDE Gesellschaft schreiben.
               */
              and mandant_id = app.aktiver_mandant()
              and not app.ist_readonly());

create policy t_bewerbung_lesen on bewerbung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_bewerbung_gruppe on bewerbung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.recruiting.lesen')));

create policy t_bewerbung_schreiben on bewerbung for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_kandidat_lesen on kandidat for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_kandidat_schreiben on kandidat for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_bewertung_lesen on bewerbung_bewertung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_bewertung_schreiben on bewerbung_bewertung for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('recruiting.bewerbung_bewerten', app.aktiver_mandant())));

create policy t_entscheidung_lesen on einstellungsentscheidung for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_entscheidung_schreiben on einstellungsentscheidung for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('recruiting.entscheiden', app.aktiver_mandant())));

create policy t_gespraech_lesen on gespraech for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_gespraech_schreiben on gespraech for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('recruiting.bewerbung_lesen', app.aktiver_mandant())));

create policy t_loeschlauf_lesen on bewerbung_loeschlauf for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('recruiting.daten_loeschen', app.aktiver_mandant())));

/**
 * **Die K-04-Decke gilt fuer das SCHREIBEN, nicht fuer das Lesen der
 * Stellen** — genau wie bei `beitrag` (0163).
 *
 * Die oeffentliche Karriereseite laeuft ohne Sitzung, und `app.portal()`
 * faellt dort auf den fail-closed-Wert `mitarbeiter`. Eine Lesedecke auf
 * `intern` machte die Karriereseite also schweigend leer — der teuerste
 * Bildschirm dieses Moduls, weil er wie eine Gesellschaft ohne offene Stellen
 * aussieht.
 */
create policy p_stelle_decke on stelle as restrictive for all to cse_app
  using (true)
  with check (app.portal() = 'intern');
create policy p_stelle_veroeff_decke on stelle_veroeffentlichung
  as restrictive for all to cse_app
  using (true) with check (app.portal() = 'intern');
create policy p_kandidat_decke on kandidat as restrictive for all to cse_app
  using (true) with check (app.portal() = 'intern');
create policy p_bewertung_decke on bewerbung_bewertung as restrictive for all to cse_app
  using (true) with check (app.portal() = 'intern');
create policy p_entscheidung_decke on einstellungsentscheidung
  as restrictive for all to cse_app
  using (true) with check (app.portal() = 'intern');
create policy p_gespraech_decke on gespraech as restrictive for all to cse_app
  using (true) with check (app.portal() = 'intern');

-- Der Nachtlauf raeumt ab (REC-07) und schreibt sein Protokoll.
create policy j_bewerbung on bewerbung for select to cse_job using (true);
create policy j_bewerbung_loeschen on bewerbung for update to cse_job
  using (true) with check (true);
create policy j_loeschlauf on bewerbung_loeschlauf for all to cse_job
  using (true) with check (true);

/**
 * **Der Nachtlauf raeumt auch die abhaengigen Zeilen ab** (REC-07, Art. 17
 * DSGVO).
 *
 * Gefunden von `tests/isolation/recruiting.test.ts`: die Bewerbung selbst
 * anonymisieren reicht nicht. `bewerbung_bewertung.begruendung` ist ein Satz
 * UEBER einen Menschen, `kandidat` traegt seine Qualifikationen, `gespraech`
 * seine Notizen und `einstellungsentscheidung` die Begruendung der Absage.
 * Bliebe das stehen, waere die Bewerbung geloescht und die Person weiter
 * beschrieben.
 *
 * `for all` und nicht `for delete`: der Lauf liest die Zeilen, bevor er sie
 * entfernt, und `using` gilt fuer beides.
 */
create policy j_bewertung_loeschen on bewerbung_bewertung for all to cse_job
  using (true) with check (true);
create policy j_kandidat_loeschen on kandidat for all to cse_job
  using (true) with check (true);
create policy j_gespraech_loeschen on gespraech for all to cse_job
  using (true) with check (true);
create policy j_entscheidung_loeschen on einstellungsentscheidung for all to cse_job
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

grant select, insert, update on stelle to cse_app;
grant select, insert, update on stelle_veroeffentlichung to cse_app;
/**
 * `insert` fuer das Formular, `update` fuer die Bearbeitung — kein `delete`.
 * Eine Bewerbung verschwindet ueber `geloescht_am` und den Loeschlauf, nie
 * ueber ein `delete` aus der Anwendung (Invariante 8 und REC-07 zugleich:
 * die Loeschung soll protokolliert sein).
 */
grant select, insert, update on bewerbung to cse_app;
grant select, insert, update on kandidat to cse_app;
grant select, insert on bewerbung_bewertung to cse_app;
grant select, insert on einstellungsentscheidung to cse_app;
grant select, insert, update on gespraech to cse_app;
grant select on bewerbung_loeschlauf to cse_app;

/**
 * **Der Nachtlauf ANONYMISIERT die Bewerbung und LOESCHT ihre Nutzlast.**
 *
 * Kein `delete` auf `bewerbung`: die Zeile bleibt als Gerippe stehen, damit
 * die Zahl der Bewerbungen je Stelle stimmt und derselbe Eingang nicht
 * zweimal importiert wird. Was sie ueber einen Menschen sagte, steht danach
 * nicht mehr darin — Name, E-Mail, Telefon und Nachricht sind ueberschrieben,
 * und `geloescht_am` traegt den Zeitpunkt. Das ist Art. 17 DSGVO erfuellt,
 * ohne Invariante 8 fuer die Statistik aufzugeben.
 *
 * Die abhaengigen Tabellen dagegen SIND Nutzlast: eine Bewertungsbegruendung,
 * eine Qualifikationsliste, eine Gespraechsnotiz und die Begruendung einer
 * Absage sagen nichts, wenn der Mensch fehlt — und alles, solange er
 * dasteht. Sie werden geloescht, nicht ueberschrieben.
 *
 * Gefunden hat diese Luecke `tests/isolation/recruiting.test.ts`: der Lauf
 * scheiterte mit `permission denied for table bewerbung_bewertung`. In der
 * Auslieferung waere daraus ein Nachtlauf geworden, der jede Nacht abbricht.
 */
grant select (id, mandant_id, aufbewahrung_bis, geloescht_am, loeschsperre, status)
  on bewerbung to cse_job;
grant update (geloescht_am, name, email, telefon, nachricht, geaendert_am)
  on bewerbung to cse_job;
grant select, delete on bewerbung_bewertung to cse_job;
grant select, delete on kandidat to cse_job;
grant select, delete on gespraech to cse_job;
grant select, delete on einstellungsentscheidung to cse_job;
grant select, insert on bewerbung_loeschlauf to cse_job;

-- ---------------------------------------------------------------------------
-- Die Frist — ein PLATZHALTER, und er sagt es
-- ---------------------------------------------------------------------------

/**
 * **Wie lange Bewerberdaten bleiben, weiss der Mandant** (O-373).
 *
 * Die uebliche Praxis in Deutschland orientiert sich an § 15 Abs. 4 AGG (zwei
 * Monate zur Geltendmachung) plus der dreimonatigen Klagefrist, woraus in der
 * Literatur meist sechs Monate ab Absage werden. Das ist eine ueberwiegende
 * PRAXIS, keine Vorschrift — und eine Frist, die diese Datei erfindet, faellt
 * erst bei der Aufsicht auf. Der Wert steht deshalb als Einstellung mit
 * `ist_vorlaeufig = true`, aenderbar ohne Code.
 */
insert into plattform_einstellung (schluessel, wert, ist_vorlaeufig, beschreibung)
values (
  'recruiting.aufbewahrung_tage', to_jsonb(180), true,
  'REC-07/LEG-11: Tage ab Eingang, nach denen eine Bewerbung geloescht wird. '
  'VORLAEUFIG (O-373) — die Frist gehoert dem Mandanten, nicht der Plattform.'
)
on conflict (schluessel) do nothing;
