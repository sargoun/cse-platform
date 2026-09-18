-- 0015 — Unternehmensprofile und Referenzen (PRO-01..PRO-03, PRO-05).

create table unternehmensprofil (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  -- 3:1 (DESIGN §4.5). Das Verhaeltnis steht im Code, das Bild hier.
  cover_medien_id uuid references medien(id),
  logo_medien_id  uuid references medien(id),
  kurzbeschreibung text not null,
  beschreibung  text,
  gruendung     integer check (gruendung is null or gruendung between 1900 and 2100),
  mitarbeiter_zahl integer check (mitarbeiter_zahl is null or mitarbeiter_zahl >= 0),
  status        seite_status not null default 'entwurf',
  geloescht_am  timestamptz,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint unternehmensprofil_uk unique (mandant_id)
);

/**
 * Eine Referenz erscheint oeffentlich NUR mit Kundenfreigabe (PRO-05).
 *
 * `freigegeben_vom_kunden` hat **kein** `DEFAULT true`. Eine Referenz, die
 * versehentlich angelegt wird, ist unsichtbar — und das ist die richtige
 * Richtung: ein Kundenname auf einer Website ohne dessen Zustimmung ist ein
 * Problem, das man nicht durch Löschen ungeschehen macht.
 */
create table referenz (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  titel         text not null,
  kunde_name    text,
  beschreibung  text,
  jahr          integer check (jahr is null or jahr between 1990 and 2100),
  medien_id     uuid references medien(id),
  freigegeben_vom_kunden boolean not null default false,
  freigabe_am   timestamptz,
  freigabe_beleg text,
  status        seite_status not null default 'entwurf',
  sortierung    integer not null default 0,
  geloescht_am  timestamptz,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint referenz_mandant_id_uk unique (mandant_id, id),
  -- Eine Freigabe ohne Datum ist eine Behauptung. Wer sie erteilt hat und
  -- wann, ist bei einem Kundennamen auf einer Website keine Nebensache.
  constraint referenz_freigabe_belegt check (
    not freigegeben_vom_kunden or freigabe_am is not null)
);

create index referenz_oeffentlich_idx on referenz (mandant_id, sortierung)
  where freigegeben_vom_kunden and status = 'veroeffentlicht' and geloescht_am is null;

alter table unternehmensprofil enable row level security;
alter table unternehmensprofil force  row level security;
alter table referenz           enable row level security;
alter table referenz           force  row level security;

create policy t_profil_oeffentlich on unternehmensprofil for select to cse_app
  using (status = 'veroeffentlicht' and geloescht_am is null);
create policy t_profil_pflege on unternehmensprofil for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('referenz.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('referenz.schreiben', mandant_id));

/**
 * Die oeffentliche Policy traegt die Freigabe SELBST — nicht nur der Dienst.
 *
 * Eine Referenz ohne Kundenfreigabe ist damit auch dann unsichtbar, wenn
 * jemand die Filterbedingung im Code vergisst. Zwei Linien, nicht eine.
 */
create policy t_referenz_oeffentlich on referenz for select to cse_app
  using (freigegeben_vom_kunden and status = 'veroeffentlicht' and geloescht_am is null);

create policy t_referenz_pflege on referenz for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('referenz.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('referenz.kundenfreigabe_erfassen', mandant_id));

grant select, insert, update on unternehmensprofil, referenz to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0015)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

create trigger trg_referenz_geaendert_am
  before update on referenz
  for each row execute function kern.setze_geaendert_am();
create trigger trg_unternehmensprofil_geaendert_am
  before update on unternehmensprofil
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
