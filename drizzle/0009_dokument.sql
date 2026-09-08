-- 0009 — Dokumente, Versionen und Aufbewahrung (DOC-01..DOC-08, SEC-A6, LEG-01).
--
-- Immer im privaten Bucket, immer ueber eine kurzlebige signierte URL, nie
-- ueber einen oeffentlichen Pfad. **Es gibt keinen oeffentlichen Bucket** —
-- der CHECK unten laesst nur die zwei privaten zu, und damit ist "versehentlich
-- oeffentlich" kein Zustand, den dieses Schema kennt.

-- SPEC DOC-01, die neun Kategorien woertlich.
create type dokument_kategorie as enum
  ('kunde','vertrag','angebot','rechnung','beleg','mitarbeiter','projekt','buchhaltung','unternehmen');

/**
 * Die Aufbewahrungsregel je Kategorie (DOC-07).
 *
 * Eine Tabelle und keine Konstante im Code: die Fristen sind je Gesellschaft
 * einstellbar, sobald O-25 beantwortet ist, und eine Frist zu aendern darf
 * kein Deployment kosten.
 */
create table dokument_aufbewahrung (
  id              uuid primary key default gen_random_uuid(),
  mandant_id      uuid references mandant(id),
  kategorie       text not null,
  jahre           integer check (jahre is null or jahre between 0 and 30),
  loeschsperre    boolean not null,
  grundlage       text not null,
  -- K-17: solange die Dauer nicht bestaetigt ist, ist die Zeile ein
  -- Platzhalter — und `app.aufbewahrung_regel` behandelt sie als Pflicht.
  ist_platzhalter boolean not null default true,
  erstellt_am     timestamptz not null default now(),
  geaendert_am    timestamptz,

  constraint dokument_aufbewahrung_key unique (mandant_id, kategorie)
);

create table dokument (
  id                        uuid primary key default gen_random_uuid(),
  mandant_id                uuid not null references mandant(id),
  kategorie                 dokument_kategorie not null,
  titel                     text not null,
  beschreibung              text,
  -- Die Ziele kommen mit Phase 4 (`kunde`, `objekt`, `formular_eingang`).
  -- Bis dahin ohne Fremdschluessel — eine Spalte ohne FK ist ehrlicher als
  -- ein FK auf eine Tabelle, die es nicht gibt.
  kunde_id                  uuid,
  objekt_id                 uuid,
  formular_eingang_id       uuid,
  -- DOC-04: unsichtbar ist der Vorgabewert, in beide Richtungen. Ein Dokument
  -- wird durch eine ausdrueckliche Handlung sichtbar, nie durch Unterlassung.
  sichtbar_fuer_kunde       boolean not null default false,
  sichtbar_fuer_mitarbeiter boolean not null default false,
  bucket                    text not null default 'dokumente'
                              check (bucket in ('dokumente','archiv')),
  objekt_schluessel         text not null,
  -- Der VERIFIZIERTE Typ aus der Magic-Byte-Pruefung, nie die Behauptung des
  -- Browsers.
  mime_typ                  text not null,
  -- CHECK ohne DEFAULT: ein Default, den der CHECK ablehnt, macht aus einer
  -- vergessenen Spalte einen Constraint-Fehler statt eines stillen `false`.
  mime_verifiziert          boolean not null check (mime_verifiziert),
  groesse_bytes             bigint not null
                              check (groesse_bytes > 0 and groesse_bytes <= 268435456),
  -- TIM-10 verlangt Foto UND Video; PDFs tragen ebenfalls Geraete- und
  -- Standortdaten.
  exif_entfernt             boolean not null default false,
  tags                      text[] not null default '{}',
  aufbewahrung_bis          date,
  loeschsperre              boolean not null default false,
  geloescht_am              timestamptz,
  geloescht_von             uuid,
  loeschgrund               text,
  erstellt_am               timestamptz not null default now(),
  erstellt_von              uuid,
  geaendert_am              timestamptz,
  geaendert_von             uuid,

  constraint dokument_mandant_id_uk unique (mandant_id, id),
  -- Benannt, damit die Fehlermeldung sagt WELCHE Regel gegriffen hat. Ein
  -- anonymer CHECK meldet nur, dass irgendeiner verletzt wurde.
  constraint dokument_exif_entfernt check (
    exif_entfernt
    or (mime_typ not like 'image/%'
        and mime_typ not like 'video/%'
        and mime_typ <> 'application/pdf'))
);

-- `sha256` steht NICHT hier, sondern auf der Version: zwei Kopien desselben
-- Hashes ohne etwas, das sie gleich haelt, driften — und zwar in genau dem
-- Feld, auf dem die GoBD-Integritaet ruht.
create table dokument_version (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  dokument_id   uuid not null,
  version       integer not null check (version >= 1),
  objekt_schluessel text not null,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  groesse_bytes bigint not null check (groesse_bytes > 0),
  mime_typ      text not null,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,

  constraint dokument_version_fk
    foreign key (mandant_id, dokument_id) references dokument (mandant_id, id),
  constraint dokument_version_key unique (mandant_id, dokument_id, version)
);

create index dokument_liste_idx on dokument (mandant_id, kategorie, erstellt_am desc)
  where geloescht_am is null;
create index dokument_kunde_idx on dokument (mandant_id, kunde_id)
  where kunde_id is not null and geloescht_am is null;
create index dokument_objekt_idx on dokument (mandant_id, objekt_id)
  where objekt_id is not null and geloescht_am is null;
create index dokument_tags_idx on dokument using gin (tags);
create index dokument_titel_idx on dokument using gin (titel gin_trgm_ops);
create index dokument_aufbewahrung_idx on dokument (mandant_id, aufbewahrung_bis)
  where geloescht_am is null and aufbewahrung_bis is not null;
create index dokument_mitarbeiter_idx on dokument (mandant_id, kategorie, erstellt_am desc)
  where sichtbar_fuer_mitarbeiter and geloescht_am is null;
create index dokument_version_idx on dokument_version (mandant_id, dokument_id, version desc);

-- ---------------------------------------------------------------------------
-- Die Aufbewahrung wird aufgeloest, nie getippt.
-- ---------------------------------------------------------------------------

/**
 * Muss ein DEFINER sein, und der Grund ist konkret: der Trigger laeuft als der
 * Aufrufer, und der Aufrufer darf `dokument.schreiben` halten ohne
 * `dokument.lesen` — das Eingangsprinzip fuer Formular-Uploads ist genau das.
 * Ein direkter Lesezugriff auf `dokument_aufbewahrung` traefe dann null Zeilen,
 * und das Dokument laege ohne Aufbewahrungsdatum und ohne Loeschsperre im
 * Bucket. Still.
 */
create function app.aufbewahrung_regel(p_mandant uuid, p_kategorie text)
returns table (jahre integer, loeschsperre boolean, ist_platzhalter boolean)
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select a.jahre, a.loeschsperre, a.ist_platzhalter
    from public.dokument_aufbewahrung a
   where a.kategorie = p_kategorie
     and a.mandant_id is not distinct from p_mandant
   union all
  select a.jahre, a.loeschsperre, a.ist_platzhalter
    from public.dokument_aufbewahrung a
   where a.kategorie = p_kategorie and a.mandant_id is null
   limit 1
$$;

grant execute on function app.aufbewahrung_regel(uuid, text) to cse_app;

create function kern.setze_aufbewahrung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare r record;
begin
  if tg_op = 'UPDATE' then
    -- Eine gesetzte Loeschsperre wird nicht wieder geloest.
    if old.loeschsperre and not new.loeschsperre then
      raise exception 'Die Loeschsperre eines Dokuments kann nicht aufgehoben werden (DOC-07)'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  select * into r from app.aufbewahrung_regel(new.mandant_id, new.kategorie::text);

  if not found then
    -- Keine Regel heisst nicht "keine Pflicht". Es heisst, dass niemand
    -- entschieden hat — und eine unbekannte Pflicht wird als Pflicht
    -- behandelt (K-17, O-25).
    new.aufbewahrung_bis := null;
    new.loeschsperre := true;
    return new;
  end if;

  new.loeschsperre := r.loeschsperre or r.ist_platzhalter;
  new.aufbewahrung_bis := case
    when r.jahre is null then null
    else make_date(extract(year from now())::int + r.jahre, 12, 31)
  end;
  return new;
end $$;

create trigger trg_dokument_aufbewahrung
  before insert or update on dokument
  for each row execute function kern.setze_aufbewahrung();

/** Ein Dokument mit Loeschsperre wird auch nicht soft-geloescht. */
create function kern.dokument_loeschsperre() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.geloescht_am is not null and old.geloescht_am is null and new.loeschsperre then
    raise exception
      'Dokument % steht unter Aufbewahrungspflicht und kann nicht geloescht werden (DOC-07, LEG-01)',
      new.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger trg_dokument_loeschsperre
  before update on dokument
  for each row execute function kern.dokument_loeschsperre();

-- ---------------------------------------------------------------------------
-- RLS. Modul `dokument`, plus die Mitarbeiter- und Kundendecke (K-04, K-18).
-- ---------------------------------------------------------------------------
alter table dokument              enable row level security;
alter table dokument              force  row level security;
alter table dokument_version      enable row level security;
alter table dokument_version      force  row level security;
alter table dokument_aufbewahrung enable row level security;
alter table dokument_aufbewahrung force  row level security;

create policy t_mandant on dokument for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('dokument.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('dokument.schreiben', mandant_id));

create policy t_gruppe on dokument for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('gruppe.dokument.lesen', mandant_id));

/**
 * Die Mitarbeiterdecke. RESTRICTIVE, weil eine permissive Regel ODER-verknuepft
 * wuerde und damit ein Loch waere statt einer Decke: im Mitarbeiterportal ist
 * ausschliesslich sichtbar, was ausdruecklich freigegeben wurde.
 */
create policy p_ma_ceiling on dokument as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or (sichtbar_fuer_mitarbeiter and geloescht_am is null));

/**
 * Und die GEWAEHRENDE Policy dazu (K-18).
 *
 * Die Decke oben ist `restrictive` — sie schneidet weg und gewaehrt nie. Ohne
 * diese permissive Policy sieht das Mitarbeiterportal **null** Dokumente,
 * auch die ausdruecklich freigegebenen: `t_mandant` verlangt
 * `dokument.lesen`, und das haelt die Rolle `mitarbeiter` nicht — was richtig
 * ist, denn sie soll nicht die Rechnungsablage sehen, sondern ihre
 * Dienstanweisung.
 *
 * Der Zugang ist deshalb kein Recht, sondern ein SUBJEKTPRAEDIKAT: freigegeben
 * und nicht geloescht. Beide Policies muessen passen — die Decke und diese.
 */
create policy t_person on dokument for select to cse_app
  using (app.portal() = 'mitarbeiter'
         and mandant_id = any (app.sichtbare_mandanten())
         and sichtbar_fuer_mitarbeiter
         and geloescht_am is null);

create policy p_kunde_ceiling on dokument as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or (sichtbar_fuer_kunde and geloescht_am is null));

create policy t_version_lesen on dokument_version for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('dokument.lesen', mandant_id));
create policy t_version_schreiben on dokument_version for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('dokument.schreiben', mandant_id));

create policy t_aufbewahrung_lesen on dokument_aufbewahrung for select to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()));

grant select, insert, update on dokument to cse_app;
grant select, insert on dokument_version to cse_app;
grant select on dokument_aufbewahrung to cse_app;

-- Die Plattform-Vorgaben. Erzeugt aus `services/dokument/kategorie.ts`, das
-- die Rechtsgrundlage je Zeile traegt.
-- TODO(client): O-25 — Aufbewahrungsfristen je Dokumentkategorie ueber das
-- gesetzliche Minimum hinaus?
insert into dokument_aufbewahrung (mandant_id, kategorie, jahre, loeschsperre, grundlage, ist_platzhalter) values
  (null, 'rechnung',    10,   true,  '§ 147 AO, § 14b UStG — 10 Jahre', false),
  (null, 'buchhaltung', 10,   true,  '§ 147 AO, § 257 HGB — 10 Jahre', false),
  (null, 'beleg',       10,   true,  '§ 147 AO — Buchungsbelege, 10 Jahre', false),
  (null, 'vertrag',     10,   true,  '§ 257 HGB — Handelsbriefe, mit Rechnungsbezug 10 Jahre', false),
  (null, 'angebot',      6,   false, '§ 257 HGB — empfangene Handelsbriefe, 6 Jahre', false),
  (null, 'kunde',        6,   false, '§ 257 HGB — Handelskorrespondenz, 6 Jahre', false),
  (null, 'mitarbeiter', null, true,  'offen — je Unterlage verschieden (O-25)', true),
  (null, 'projekt',     null, true,  'offen — VOB/B-Gewaehrleistung je Vertrag (O-25)', true),
  (null, 'unternehmen', null, true,  'offen — Gesellschaftsunterlagen (O-25)', true);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0009)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- dokument (soft): DOC-07, LEG-01, § 147 AO. Rechnungen und Buchungsbelege stehen zehn Jahre unter Aufbewahrungspflicht; `loeschsperre` verhindert zusaetzlich das Soft-Loeschen, solange die Frist laeuft oder unbekannt ist.
create trigger trg_dokument_kein_hard_delete
  before delete on dokument
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dokument_kein_truncate
  before truncate on dokument
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dokument from cse_app, cse_anon, cse_checkin, cse_job;

-- dokument_version (append): DOC-06, LEG-01. Die Versionskette traegt den SHA-256 der gespeicherten Bytes — die Grundlage der GoBD-Integritaet. Eine Version zu loeschen entfernt den Beweis, dass die uebrigen unveraendert sind.
create trigger trg_dokument_version_kein_hard_delete
  before delete on dokument_version
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dokument_version_kein_truncate
  before truncate on dokument_version
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dokument_version from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
