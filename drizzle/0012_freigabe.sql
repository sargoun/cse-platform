-- 0012 — Freigabe-Kern und Ausgangs-Gate (Invariante 7, APR-07, AGT-03, LEG-08).

create type freigabe_status as enum ('offen','genehmigt','abgelehnt','abgelaufen');

/**
 * Der Kettenkopf je Mandant — dieselbe Mechanik wie `nummernkreis`, und aus
 * demselben Grund.
 *
 * Ohne serialisierte Gesamtordnung gabeln zwei gleichzeitige Freigebende die
 * Kette, und die naechtliche Verifikation meldet an jedem geschaeftigen Tag
 * einen Bruch. Die Nummer wird deshalb unter `SELECT … FOR UPDATE` gezogen,
 * genau wie eine Rechnungsnummer (K-13, FIN-03).
 */
create table freigabe_kette (
  mandant_id   uuid primary key references mandant(id),
  naechste_nr  bigint not null default 1 check (naechste_nr >= 1),
  letzter_hash text check (letzter_hash is null or letzter_hash ~ '^[0-9a-f]{64}$'),
  geaendert_am timestamptz
);

/** Die Zeile, deren STATUS sich aendert. */
create table freigabe (
  id             uuid primary key default gen_random_uuid(),
  mandant_id     uuid not null references mandant(id),
  aktion         text not null,
  status         freigabe_status not null default 'offen',
  -- Wer freigegeben hat. NOT NULL sobald genehmigt — Invariante 7 verlangt
  -- einen MENSCHEN, nicht einen Zustand.
  freigegeben_von uuid references benutzer(id),
  freigegeben_am timestamptz,
  begruendung    text,
  frist          timestamptz,
  risiko         text,
  erstellt_am    timestamptz not null default now(),
  erstellt_von   uuid references benutzer(id),
  geaendert_am   timestamptz,

  constraint freigabe_mandant_id_uk unique (mandant_id, id),
  constraint freigabe_genehmigt_hat_menschen check (
    status <> 'genehmigt' or (freigegeben_von is not null and freigegeben_am is not null))
);

/**
 * Der unveraenderliche Schnappschuss — und das EINZIGE, was verkettet wird
 * (K-13).
 *
 * Die `freigabe` aendert ihren Status; eine Kette ueber eine veraenderliche
 * Zeile bewiese nichts. Der Schnappschuss haelt fest, WAS zum Zeitpunkt der
 * Entscheidung vorlag, und genau darueber laeuft die Kette.
 */
create table freigabe_snapshot (
  id             uuid primary key default gen_random_uuid(),
  mandant_id     uuid not null references mandant(id),
  freigabe_id    uuid not null,
  kette_nr       bigint not null,
  nutzlast       jsonb not null,
  nutzlast_hash  text not null check (nutzlast_hash ~ '^[0-9a-f]{64}$'),
  vorheriger_hash text not null check (vorheriger_hash ~ '^[0-9a-f]{64}$'),
  hash           text not null check (hash ~ '^[0-9a-f]{64}$'),
  algorithmus    text not null default 'sha256-jcs-v1',
  entscheidung   freigabe_status not null,
  entschieden_von uuid references benutzer(id),
  erstellt_am    timestamptz not null default now(),

  constraint freigabe_snapshot_fk
    foreign key (mandant_id, freigabe_id) references freigabe (mandant_id, id),
  constraint freigabe_snapshot_kette_uk unique (mandant_id, kette_nr)
);

create index freigabe_offen_idx on freigabe (mandant_id, frist nulls last)
  where status = 'offen';
create index freigabe_snapshot_kette_idx on freigabe_snapshot (mandant_id, kette_nr desc);

/** Die Richtlinien-Konfiguration (AGT-03). */
create table agent_richtlinie (
  id              uuid primary key default gen_random_uuid(),
  mandant_id      uuid not null references mandant(id),
  aktion          text not null,
  -- Kein DEFAULT true. Eine Zeile, die versehentlich angelegt wird, erlaubt
  -- nichts.
  auto_erlaubt    boolean not null default false,
  max_betrag_cent bigint check (max_betrag_cent is null or max_betrag_cent >= 0),
  ist_aktiv       boolean not null default true,
  begruendung     text,
  erstellt_am     timestamptz not null default now(),
  erstellt_von    uuid references benutzer(id),
  geaendert_am    timestamptz,

  constraint agent_richtlinie_uk unique (mandant_id, aktion),
  /**
   * Ein Angebot geht NIE automatisch raus — auf Datenbankebene, nicht nur im
   * Code. Ein Angebot ist ein bindendes Vertragsangebot (§ 145 BGB); der
   * Betrag ist dabei nicht das Kriterium, denn eine Schwelle laedt dazu ein,
   * sie zu erhoehen, bis sie nichts mehr bedeutet.
   */
  constraint agent_richtlinie_kein_auto_angebot check (
    aktion <> 'angebot_senden' or not auto_erlaubt)
);

/** Der einzige Ausgang. Jeder Versand traegt seine Freigabe. */
create table versand (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  freigabe_id   uuid,
  aktion        text not null,
  kanal         text not null,
  empfaenger    text not null,
  nutzlast_hash text not null check (nutzlast_hash ~ '^[0-9a-f]{64}$'),
  gesendet_am   timestamptz,
  ergebnis      text,
  erstellt_am   timestamptz not null default now(),

  constraint versand_mandant_id_uk unique (mandant_id, id),
  constraint versand_freigabe_fk
    foreign key (mandant_id, freigabe_id) references freigabe (mandant_id, id)
);

-- ---------------------------------------------------------------------------
-- Die Kettennummer, unter FOR UPDATE.
-- ---------------------------------------------------------------------------
create function app.freigabe_kette_ziehen(p_mandant uuid)
returns table (kette_nr bigint, vorheriger_hash text)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_nr bigint; v_hash text;
begin
  insert into public.freigabe_kette (mandant_id) values (p_mandant)
    on conflict (mandant_id) do nothing;

  select k.naechste_nr, coalesce(k.letzter_hash, repeat('0', 64))
    into v_nr, v_hash
    from public.freigabe_kette k where k.mandant_id = p_mandant for update;

  update public.freigabe_kette set naechste_nr = naechste_nr + 1, geaendert_am = now()
   where mandant_id = p_mandant;

  return query select v_nr, v_hash;
end $$;

grant execute on function app.freigabe_kette_ziehen(uuid) to cse_app;

/** Ein Snapshot ist unveraenderlich. */
create function kern.freigabe_snapshot_eingefroren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'freigabe_snapshot ist unveraenderlich (K-13, Invariante 7)'
    using errcode = 'restrict_violation';
end $$;

create trigger trg_freigabe_snapshot_eingefroren
  before update on freigabe_snapshot
  for each row execute function kern.freigabe_snapshot_eingefroren();

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table freigabe          enable row level security;
alter table freigabe          force  row level security;
alter table freigabe_snapshot enable row level security;
alter table freigabe_snapshot force  row level security;
alter table freigabe_kette    enable row level security;
alter table freigabe_kette    force  row level security;
alter table agent_richtlinie  enable row level security;
alter table agent_richtlinie  force  row level security;
alter table versand           enable row level security;
alter table versand           force  row level security;

/**
 * Die Rechte sind `versand.*`, nicht `freigabe.*` — und das ist kein
 * Kompromiss, sondern K-19.
 *
 * Das Modul `freigabe` steht in §7.4, aber die Matrix in §12 fuehrt fuer es
 * **keine Zeile**: die Schluessel des Freigabe-Posteingangs kommen mit PR 62,
 * der ihn baut. Ein hier erfundenes `freigabe.lesen` haette keine
 * Katalogzeile, `app.hat_recht` antwortete dauerhaft false, und der
 * Posteingang laese fuer immer null Zeilen — still.
 *
 * `versand.lesen` und `versand.freigeben` existieren und benennen genau das,
 * worum es hier geht: den Ausgang und seine Freigabe. Wenn PR 62 die
 * `freigabe.*`-Zeilen in den Katalog bringt, wandern die Policies darauf.
 */
create policy t_mandant on freigabe for all to cse_app
  using (mandant_id = app.aktiver_mandant() and app.hat_recht('versand.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('versand.freigeben', mandant_id));

create policy t_gruppe on freigabe for select to cse_app
  using (app.ist_gruppenansicht() and mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('gruppe.freigabe.lesen', mandant_id));

create policy t_snapshot_lesen on freigabe_snapshot for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('versand.lesen', mandant_id));
create policy t_snapshot_schreiben on freigabe_snapshot for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('versand.freigeben', mandant_id));

create policy t_richtlinie_lesen on agent_richtlinie for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('versand.lesen', mandant_id));
-- Die Richtlinie zu aendern heisst zu entscheiden, was ohne Menschen rausgeht.
-- Das ist dasselbe Recht wie die Freigabe selbst, nicht ein schwaecheres.
create policy t_richtlinie_schreiben on agent_richtlinie for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('versand.freigeben', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('versand.freigeben', mandant_id));

create policy t_versand_lesen on versand for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('versand.lesen', mandant_id));

-- Der Kettenkopf wird nur ueber die Definer-Funktion bewegt.
grant select, insert, update on freigabe to cse_app;
grant select, insert on freigabe_snapshot to cse_app;
grant select, insert, update on agent_richtlinie to cse_app;
grant select on versand to cse_app;
grant select, insert, update on versand to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0012)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- freigabe_snapshot (append): Invariante 7, APR-07, K-13. Der Schnappschuss bezeugt, WAS zum Zeitpunkt der Entscheidung vorlag, und traegt das einzige verkettete Glied. Ihn zu loeschen entfernt den Beweis, dass die uebrigen Entscheidungen unveraendert sind.
create trigger trg_freigabe_snapshot_kein_hard_delete
  before delete on freigabe_snapshot
  for each row execute function kern.verhindere_loeschung();
create trigger trg_freigabe_snapshot_kein_truncate
  before truncate on freigabe_snapshot
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on freigabe_snapshot from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
