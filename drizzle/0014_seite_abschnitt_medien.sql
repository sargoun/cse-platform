-- 0014 — das Inhaltsmodell der oeffentlichen Seite (PUB-07).
--
-- **Keine fest verdrahtete Kopie.** Jeder Satz auf der Website steht in einer
-- Zeile; eine Textaenderung ist ein UPDATE und kein Deployment. Das ist PUB-07
-- woertlich, und es ist der Unterschied zwischen einer Website, die die
-- Gruppe pflegt, und einer, fuer die sie jedes Mal anrufen muss.

create type seite_status as enum ('entwurf','veroeffentlicht','archiviert');
create type abschnitt_art as enum
  ('hero','text','markenkarten','leistungen','projekte','kontakt','zahlen','zitat');

create table seite (
  id            uuid primary key default gen_random_uuid(),
  -- NULL = Gruppenseite (Startseite, Impressum). Gesetzt = Bereichsseite.
  mandant_id    uuid references mandant(id),
  pfad          text not null check (pfad ~ '^/[a-z0-9/-]*$'),
  sprache       text not null default 'de' check (sprache in ('de','en','ar','tr')),
  titel         text not null,
  beschreibung  text,
  status        seite_status not null default 'entwurf',
  sortierung    integer not null default 0,
  veroeffentlicht_am timestamptz,
  geloescht_am  timestamptz,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid,
  geaendert_von uuid,

  constraint seite_status_stimmig check (
    (status = 'veroeffentlicht') = (veroeffentlicht_am is not null))
);

-- Ein Pfad je Sprache, und nur eine veroeffentlichte Fassung davon.
create unique index seite_pfad_uk on seite (pfad, sprache) where geloescht_am is null;

create table abschnitt (
  id           uuid primary key default gen_random_uuid(),
  seite_id     uuid not null references seite(id),
  art          abschnitt_art not null,
  reihenfolge  integer not null,
  ueberschrift text,
  -- Das eine rote Akzentwort aus DESIGN §2. Getrennt gespeichert, damit es
  -- nicht als Markup im Fliesstext landet und dort zweimal vorkommt.
  akzent_wort  text,
  text         text,
  medien_id    uuid,
  daten        jsonb not null default '{}',
  geloescht_am timestamptz,
  erstellt_am  timestamptz not null default now(),
  geaendert_am timestamptz,

  constraint abschnitt_reihenfolge_uk unique (seite_id, reihenfolge)
);

create index abschnitt_seite_idx on abschnitt (seite_id, reihenfolge)
  where geloescht_am is null;

create table medien (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid references mandant(id),
  pfad          text not null,
  -- PFLICHT. DESIGN §4.6 und WCAG: ein Bild ohne Alternativtext ist fuer
  -- einen Screenreader kein Bild, sondern eine Luecke.
  alt_text      text not null check (length(alt_text) > 2),
  breite        integer check (breite is null or breite > 0),
  hoehe         integer check (hoehe is null or hoehe > 0),
  -- DESIGN §4.1: Platzhalterbilder sind IM CODE als solche markiert. Hier
  -- ebenso, damit die Seite es anzeigen kann statt es zu verschweigen.
  ist_platzhalter boolean not null default true,
  quelle        text,
  erstellt_am   timestamptz not null default now()
);

alter table abschnitt add constraint abschnitt_medien_fk
  foreign key (medien_id) references medien(id);

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Die oeffentliche Seite wird serverseitig in einer gewoehnlichen
-- withTenant-Transaktion als `cse_app` OHNE Prinzipal gerendert — kein
-- sechster K-08-Weg und kein anon-Grant. Deshalb liest die Policy
-- veroeffentlichte Seiten ohne Recht.
-- ---------------------------------------------------------------------------
alter table seite     enable row level security;
alter table seite     force  row level security;
alter table abschnitt enable row level security;
alter table abschnitt force  row level security;
alter table medien    enable row level security;
alter table medien    force  row level security;

create policy t_seite_oeffentlich on seite for select to cse_app
  using (status = 'veroeffentlicht' and geloescht_am is null);

create policy t_seite_pflege on seite for all to cse_app
  using (mandant_id is not distinct from app.aktiver_mandant()
         and app.hat_recht('referenz.lesen', app.aktiver_mandant()))
  with check (mandant_id is not distinct from app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('referenz.schreiben', app.aktiver_mandant()));

create policy t_abschnitt_oeffentlich on abschnitt for select to cse_app
  using (geloescht_am is null
         and exists (select 1 from seite s
                      where s.id = abschnitt.seite_id
                        and s.status = 'veroeffentlicht' and s.geloescht_am is null));

create policy t_abschnitt_pflege on abschnitt for all to cse_app
  using (app.hat_recht('referenz.lesen', app.aktiver_mandant()))
  with check (not app.ist_readonly()
              and app.hat_recht('referenz.schreiben', app.aktiver_mandant()));

create policy t_medien_oeffentlich on medien for select to cse_app using (true);
create policy t_medien_pflege on medien for all to cse_app
  using (app.hat_recht('referenz.schreiben', app.aktiver_mandant()))
  with check (not app.ist_readonly()
              and app.hat_recht('referenz.schreiben', app.aktiver_mandant()));

grant select, insert, update on seite, abschnitt, medien to cse_app;
