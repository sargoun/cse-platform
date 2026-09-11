-- ===========================================================================
-- 0081 — Bau B/2: die Behinderungsanzeige nach § 6 VOB/B
--        (BAU-06, 03-GEWERKE.md §7.11, §3.3, §3.5, Invariante 7)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md`. Wo dieser Text
-- und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- **Die drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:**
--
--  1. **`angezeigt_am` wird NICHT beim Anlegen gesetzt.** Eine
--     Behinderungsanzeige ist eine empfangsbeduerftige Erklaerung: sie wirkt,
--     wenn sie beim Auftraggeber ist, nicht wenn sie geschrieben wurde. Das
--     Datum entsteht deshalb erst, wenn ein freigegebener Versand
--     TATSAECHLICH stattgefunden hat (API-KARTE §C: „written only when an
--     approved send actually succeeds"), und der Ausloeser friert es
--     anschliessend zusammen mit Text, Kanal und Empfaenger ein.
--  2. **Die Freigabe steht als Bedingung in der Tabelle.** Invariante 7 ist
--     hier keine Absprache, sondern `check (status <> 'angezeigt' or …
--     freigabe_id is not null)`: ein zusammengebautes UPDATE erzeugt keine
--     angezeigte Behinderung ohne benannten Menschen.
--  3. **Die VORLAGE ist eine Tabelle.** BAU-06 verlangt, dass die Anzeige aus
--     einer Vorlage entsteht; eine Vorlage im Code waere eine, die niemand
--     ohne Deployment aendern kann — und der Wortlaut eines Schreibens an den
--     Auftraggeber ist genau das, was die Bauleitung anpassen will. Die
--     mitgelieferte Zeile nennt die Angaben, die § 6 Abs. 1 VOB/B selbst
--     verlangt, und ist als Platzhalter markiert.
--
-- NICHT in dieser Migration: `bautagebuch` und sein Verweis auf diese Tabelle
-- (PR 45), der Wegfall-Waechter (PR 82), ein Mailversand (es gibt keinen —
-- `MailerPort` ist nicht verbunden, O-116).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.3)
-- ---------------------------------------------------------------------------

/** § 6 Abs. 2 VOB/B kennt genau diese drei Risikosphaeren. */
create type behinderung_grund as enum
  ('risikobereich_ag','streik_aussperrung','hoehere_gewalt');

create type behinderung_status as enum
  ('entwurf','freigegeben','angezeigt','weggefallen','abgeschlossen');

/**
 * Wie die Anzeige hinausgegangen ist. Die Unterscheidung ist Beweisrecht:
 * ein Einschreiben belegt den Zugang, ein Bauleiterprotokoll belegt ihn
 * nicht.
 */
create type behinderung_versandart as enum
  ('e_mail','brief','einschreiben','bote','bauleiterprotokoll','portal');

-- ---------------------------------------------------------------------------
-- 2. behinderung_vorlage — der Textbaustein (BAU-06, K-17)
-- ---------------------------------------------------------------------------

/**
 * Die Vorlage, aus der der Anzeigetext entsteht.
 *
 * Mandantengebunden wie jeder Katalog dieser Domaene (Invariante 3,
 * §3.4-Muster). Die Platzhalter im Rumpf sind geschweifte Namen —
 * `{projekt}`, `{ursache}`, … —, und `services/bau/behinderung.ts` setzt sie
 * ein. Ein unbekannter Platzhalter wird dort ABGEWIESEN und nicht leer
 * gelassen: ein Schreiben mit einer offenen Klammer darin geht an den
 * Auftraggeber und ist peinlich; eines mit einer stillschweigend geleerten
 * Angabe ist gefaehrlich.
 */
create table behinderung_vorlage (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  schluessel    text not null,
  bezeichnung   text not null,
  /** Die Fundstelle woertlich — sie steht in der Zeile, nicht im Gedaechtnis. */
  fundstelle    text not null,
  betreff       text not null,
  rumpf         text not null,

  ist_platzhalter boolean not null default true,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint bv_mandant_uk unique (mandant_id, id),
  constraint bv_schluessel_nicht_leer check (btrim(schluessel) <> ''),
  constraint bv_betreff_nicht_leer check (btrim(betreff) <> ''),
  constraint bv_rumpf_nicht_leer check (btrim(rumpf) <> ''),
  constraint bv_archiv_paarweise check ((archiviert_am is null) = (archiviert_von is null))
);

create unique index behinderung_vorlage_schluessel_uk
  on behinderung_vorlage (mandant_id, schluessel) where archiviert_am is null;

create trigger trg_behinderung_vorlage_archivierung
  before insert or update on behinderung_vorlage
  for each row execute function kern.archivierung_stempeln();

comment on table behinderung_vorlage is
  'BAU-06: der Textbaustein der Behinderungsanzeige (§ 6 Abs. 1 VOB/B). Eine '
  'Tabelle und keine Konstante — der Wortlaut eines Schreibens an den '
  'Auftraggeber wird angepasst, und das darf kein Deployment kosten.';

-- ---------------------------------------------------------------------------
-- 3. behinderung (§7.11)
-- ---------------------------------------------------------------------------

create table behinderung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  projekt_id    uuid not null,

  nummer        text not null,
  status        behinderung_status not null default 'entwurf',
  grund_kategorie behinderung_grund not null,
  ursache       text not null,
  /** Berliner Kalendertage (K-11). */
  beginn_am     date not null,
  ende_am       date,

  /** K-13: die Freigabe wird nicht nachgebaut, nur verwiesen und denormalisiert. */
  freigabe_id   uuid,
  freigegeben_am timestamptz,
  freigegeben_von uuid references benutzer(id),

  /**
   * BAU-06: das dokumentierte Absendedatum. Erst gesetzt, wenn ein
   * freigegebener Versand stattgefunden hat — nie beim Anlegen.
   */
  angezeigt_am  date,
  versandart    behinderung_versandart,
  empfaenger    text,
  /** Das archivierte Schreiben (DOC-01). */
  versand_dokument_id uuid,
  /** § 6 Abs. 3 VOB/B: der Wegfall ist ebenfalls anzuzeigen. */
  wegfall_angezeigt_am date,

  /** Der erzeugte Text, woertlich. Ab dem Versand unveraenderlich. */
  anzeigetext   text,
  vorlage_schluessel text,
  auswirkung_tage integer,
  bauzeit_verlaengerung_bis date,

  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint behinderung_mandant_uk unique (mandant_id, id),
  /** FK-Ziel fuer `bautagebuch.behinderung_id` (§1.4, PR 45). */
  constraint behinderung_projekt_uk unique (mandant_id, projekt_id, id),
  constraint behinderung_nummer_uk unique (projekt_id, nummer),
  constraint behinderung_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint behinderung_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id),
  constraint behinderung_dokument_fk foreign key (mandant_id, versand_dokument_id)
    references dokument (mandant_id, id),
  constraint behinderung_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references behinderung (mandant_id, id),

  constraint behinderung_nummer_nicht_leer check (btrim(nummer) <> ''),
  constraint behinderung_ursache_nicht_leer check (btrim(ursache) <> ''),
  constraint behinderung_zeitraum check (ende_am is null or ende_am >= beginn_am),
  /** Ein Absendedatum ohne Kanal ist kein Nachweis, und umgekehrt auch nicht. */
  constraint behinderung_versand_paarweise check (
    (angezeigt_am is null) = (versandart is null)),
  /**
   * **Invariante 7 auf Datenbankebene.** Eine angezeigte Behinderung ist eine
   * hinausgegangene Rechtserklaerung: ohne Datum, ohne Freigabe und ohne
   * Freigabezeitpunkt gibt es diesen Zustand nicht.
   */
  constraint behinderung_angezeigt_freigegeben check (
    status <> 'angezeigt'
    or (angezeigt_am is not null and freigabe_id is not null and freigegeben_am is not null)),
  constraint behinderung_freigabe_paarweise check (
    (freigegeben_am is null) = (freigegeben_von is null)),
  constraint behinderung_storno_begruendet check (
    storniert_am is null or (storniert_von is not null and btrim(coalesce(storno_grund,'')) <> ''))
);

create index behinderung_projekt_idx on behinderung (mandant_id, projekt_id, beginn_am desc);
/** Laufende Behinderungen — Planung und der Wegfall-Waechter (§ 6 Abs. 3). */
create index behinderung_laufend_idx on behinderung (mandant_id, beginn_am)
  where status = 'angezeigt' and ende_am is null;

comment on table behinderung is
  'BAU-06: die Behinderungsanzeige nach § 6 VOB/B — mit nachweisbarem '
  'Absendedatum, archiviertem Schreiben und der Freigabe, die sie hat '
  'hinausgehen lassen (Invariante 7, K-13).';
comment on column behinderung.angezeigt_am is
  'Das dokumentierte Absendedatum. Wird ausschliesslich gesetzt, wenn ein '
  'freigegebener Versand tatsaechlich stattgefunden hat — nie beim Anlegen.';

-- ---------------------------------------------------------------------------
-- 4. Der Ausloeser, der das Schreiben einfriert (§7.11 `freeze_after_send`)
-- ---------------------------------------------------------------------------

/**
 * Ab dem Absendedatum ist die Anzeige ein Beweisstueck.
 *
 * Beweiskraft haengt an Text, Datum, Kanal, Empfaenger, archiviertem
 * Schreiben und Freigabe — an genau diesen sechs. Wer sie nachtraeglich
 * bewegen kann, hat ein Dokument, dessen heutiger Inhalt nichts ueber den
 * damaligen sagt. Beweglich bleiben deshalb nur: der Zustandswechsel nach
 * `weggefallen`/`abgeschlossen`, `ende_am`, `wegfall_angezeigt_am`, die
 * Aufbewahrung und der Storno.
 */
create function kern.behinderung_einfrieren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.angezeigt_am is null then return new; end if;

  if new.anzeigetext is distinct from old.anzeigetext
     or new.angezeigt_am is distinct from old.angezeigt_am
     or new.versandart is distinct from old.versandart
     or new.empfaenger is distinct from old.empfaenger
     or new.versand_dokument_id is distinct from old.versand_dokument_id
     or new.freigabe_id is distinct from old.freigabe_id
     or new.freigegeben_am is distinct from old.freigegeben_am
     or new.freigegeben_von is distinct from old.freigegeben_von
     or new.vorlage_schluessel is distinct from old.vorlage_schluessel
     or new.grund_kategorie is distinct from old.grund_kategorie
     or new.ursache is distinct from old.ursache
     or new.beginn_am is distinct from old.beginn_am then
    raise exception
      'Die Behinderungsanzeige ist seit dem Versand am % unveraenderlich '
      '(BAU-06, § 6 VOB/B). Eine Korrektur ist eine neue Anzeige, kein UPDATE.',
      old.angezeigt_am
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_behinderung_einfrieren
  before update on behinderung
  for each row execute function kern.behinderung_einfrieren();

/**
 * Der Versandzeitpunkt kommt vom SERVER (Invariante 5, K-11).
 *
 * Das Absendedatum ist der Berliner Kalendertag des Servers und nicht das,
 * was ein Browser mitschickt. Ein um einen Tag zurueckdatiertes
 * Behinderungsschreiben ist genau die Urkundenfaelschung, die im
 * Bauzeitenstreit etwas wert waere.
 */
create function kern.behinderung_versandzeit() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.angezeigt_am is not null
     and (tg_op = 'INSERT' or old.angezeigt_am is null) then
    new.angezeigt_am := app.berlin_heute();
  end if;
  return new;
end $$;

create trigger trg_behinderung_versandzeit
  before insert or update on behinderung
  for each row execute function kern.behinderung_versandzeit();

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz (§1.6, §1.8, K-03)
-- ---------------------------------------------------------------------------

alter table behinderung_vorlage enable row level security;
alter table behinderung_vorlage force  row level security;

create policy t_mandant on behinderung_vorlage for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on behinderung_vorlage for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

create policy p_intern_decke on behinderung_vorlage as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on behinderung_vorlage to cse_app;

alter table behinderung enable row level security;
alter table behinderung force  row level security;

create policy t_mandant on behinderung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on behinderung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/**
 * §7.11: `p_intern_ceiling`. Der Auftraggeber bekommt das SCHREIBEN, nicht
 * die Zeile — und die Kraft vor Ort hat mit der Rechtserklaerung nichts zu
 * tun.
 */
create policy p_intern_decke on behinderung as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on behinderung to cse_app;

-- ---------------------------------------------------------------------------
-- 6. Die Vorlage wird befuellt — heute und bei jeder kuenftigen Gesellschaft
-- ---------------------------------------------------------------------------

/**
 * Der Rumpf nennt die Angaben, die § 6 Abs. 1 VOB/B selbst verlangt: die
 * hindernden Umstaende, ihren Beginn und die voraussichtlichen Auswirkungen.
 * Er erfindet keine Rechtsfolge und keine Frist.
 *
 * // TODO(client, O-23): welchen Wortlaut und welchen Briefkopf verwendet die
 * Gruppe fuer die Behinderungsanzeige, und wer zeichnet sie? Bis zur Antwort
 * ist die Zeile als Platzhalter markiert und die Oberflaeche zeigt daneben
 * die Pille „Unbestaetigter Wert".
 */
create function kern.behinderung_vorlagen_vorbelegen(p_mandant uuid) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into public.behinderung_vorlage
    (mandant_id, schluessel, bezeichnung, fundstelle, betreff, rumpf, ist_platzhalter)
  values
    (p_mandant, 'vob_b_6_1', 'Behinderungsanzeige § 6 Abs. 1 VOB/B', '§ 6 Abs. 1 VOB/B',
     'Behinderungsanzeige zum Bauvorhaben {projekt}',
     'Sehr geehrte Damen und Herren,' || chr(10) || chr(10)
     || 'hiermit zeigen wir Ihnen gemäß § 6 Abs. 1 VOB/B an, dass wir uns in '
     || 'der ordnungsgemäßen Ausführung unserer Leistungen zum Bauvorhaben '
     || '{projekt} behindert sehen.' || chr(10) || chr(10)
     || 'Hindernde Umstände: {ursache}' || chr(10)
     || 'Zuzuordnen: {grund}' || chr(10)
     || 'Beginn der Behinderung: {beginn}' || chr(10)
     || 'Voraussichtliche Auswirkung: {auswirkung}' || chr(10) || chr(10)
     || 'Wir bitten Sie, die hindernden Umstände unverzüglich zu beseitigen. '
     || 'Den Wegfall der Behinderung werden wir Ihnen nach § 6 Abs. 3 VOB/B '
     || 'unverzüglich anzeigen. Unsere Ansprüche auf Verlängerung der '
     || 'Ausführungsfristen bleiben vorbehalten.' || chr(10) || chr(10)
     || 'Mit freundlichen Grüßen' || chr(10)
     || '{absender}',
     true)
  on conflict do nothing;
$$;

select kern.behinderung_vorlagen_vorbelegen(m.id) from mandant m;

create function kern.mandant_behinderung_vorlagen_vorbelegen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform kern.behinderung_vorlagen_vorbelegen(new.id);
  return null;
end $$;

create trigger trg_mandant_behinderung_vorlagen_vorbelegen
  after insert on mandant
  for each row execute function kern.mandant_behinderung_vorlagen_vorbelegen();

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0081)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- behinderung_vorlage (archiv): BAU-06, LEG-01. Die Vorlage ist der Wortlaut, in dem eine hinausgegangene Rechtserklaerung abgefasst wurde. Geloescht liesse sich nicht mehr zeigen, welcher Text damals galt; eine ueberholte bekommt archiviert_am.
create trigger trg_behinderung_vorlage_kein_hard_delete
  before delete on behinderung_vorlage
  for each row execute function kern.verhindere_loeschung();
create trigger trg_behinderung_vorlage_kein_truncate
  before truncate on behinderung_vorlage
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on behinderung_vorlage from cse_app, cse_anon, cse_checkin, cse_job;

-- behinderung (archiv): BAU-06, § 6 VOB/B, LEG-01. Die angezeigte Behinderung ist eine empfangsbeduerftige Erklaerung mit anspruchswahrender Wirkung — sie entscheidet ueber Bauzeitverlaengerung und Schadensersatz. Korrigiert wird durch Storno und eine neue Anzeige, nie durch Entfernen.
create trigger trg_behinderung_kein_hard_delete
  before delete on behinderung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_behinderung_kein_truncate
  before truncate on behinderung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on behinderung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_behinderung_vorlage_geaendert_am
  before update on behinderung_vorlage
  for each row execute function kern.setze_geaendert_am();
create trigger trg_behinderung_geaendert_am
  before update on behinderung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_behinderung_vorlage_audit
  after insert or update or delete on behinderung_vorlage
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_behinderung_audit
  after insert or update or delete on behinderung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
