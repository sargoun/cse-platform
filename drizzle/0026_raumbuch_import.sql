-- ===========================================================================
-- 0026 — Raumbuch-Import mit Vorschau (OPS-04)
--
-- Ein hochgeladenes Raumbuch beruehrt NICHTS, bevor ein Mensch die Vorschau
-- gesehen hat. Das ist der ganze Zweck dieser drei Tabellen: die Datei landet
-- in einem Zwischenzustand, jede Zeile wird geprueft und bekommt eine
-- Absicht (anlegen, aktualisieren, unveraendert, ignorieren), und erst die
-- Uebernahme schreibt in `raum`.
--
-- Warum das kein Luxus ist: ein Import, der direkt schreibt, macht aus einem
-- vertauschten Spaltenkopf tausend falsche Quadratmeter — und die tauchen
-- erst im Angebotspreis wieder auf, wo sie plausibel aussehen.
--
-- **`dokument_id` ist hier NULLBAR**, anders als im Entwurf. Der Grund steht
-- in `storage/adapter.ts`: ohne Zugangsdaten ist der Speicher NICHT
-- verbunden, und er tut auch nicht so. Eine `dokument`-Zeile ohne Datei
-- dahinter waere genau die vorgetaeuschte Ablage, die CLAUDE.md verbietet.
-- Die Nachweiskette bleibt trotzdem geschlossen: `dateiname` steht am Kopf,
-- und JEDE Zeile traegt ihre unveraenderten `rohdaten`.
-- ===========================================================================

create type raumbuch_import_status as enum
  ('hochgeladen','geprueft','uebernommen','verworfen','fehler');

create type raumbuch_zeile_aktion as enum
  ('anlegen','aktualisieren','unveraendert','ignorieren');

create table raumbuch_import (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  objekt_id     uuid not null,
  -- Die abgelegte Datei — NULL, solange kein Speicher verbunden ist.
  dokument_id   uuid,
  dateiname     text not null,
  status        raumbuch_import_status not null default 'hochgeladen',
  -- Welche Quellspalte auf welches Zielfeld zeigt; in der Vorschau gewaehlt.
  spalten_zuordnung jsonb not null default '{}'::jsonb,
  -- Welche Spalte den stabilen Schluessel liefert. NULL heisst:
  -- (Etage, Raumnummer) ist der Schluessel — derselbe wie im Raumbuch selbst.
  schluessel_spalte text,
  zeilen_gesamt integer not null default 0,
  zeilen_gueltig integer not null default 0,
  zeilen_fehler integer not null default 0,
  fehler_bericht jsonb,
  geprueft_am   timestamptz,
  geprueft_von  uuid,
  uebernommen_am timestamptz,
  uebernommen_von uuid,
  verworfen_am  timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,

  primary key (id),
  constraint rbi_mandant_uk unique (mandant_id, id),
  constraint rbi_objekt_fk foreign key (mandant_id, objekt_id) references objekt (mandant_id, id),
  constraint rbi_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),
  -- Eine Uebernahme hat immer einen benannten Menschen.
  constraint rbi_uebernahme_benannt check (
    status <> 'uebernommen' or (uebernommen_am is not null and uebernommen_von is not null)),
  constraint rbi_zaehler_stimmig check (
    zeilen_gueltig >= 0 and zeilen_fehler >= 0 and zeilen_gesamt >= zeilen_gueltig)
);

create index rbi_verlauf_idx on raumbuch_import (mandant_id, objekt_id, erstellt_am desc);
create index rbi_wartend_idx on raumbuch_import (mandant_id, status)
  where status in ('hochgeladen','geprueft');

create table raumbuch_import_zeile (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  import_id     uuid not null,
  zeilennummer  integer not null,
  -- Die unveraenderte Quellzeile. Sie ist der Nachweis darueber, WAS
  -- hochgeladen wurde — unabhaengig davon, wie der Importeur sie gelesen hat.
  rohdaten      jsonb not null,
  quell_schluessel text,
  raumnummer    text,
  bezeichnung   text,
  etage         text,
  nutzungsart   text,
  -- Mit deutschem Dezimalkomma gelesen: "12,5" ist 12.5, nicht 125.
  flaeche_qm    numeric(12,3),
  fenster_flaeche_qm numeric(12,3),
  belagsart_code text,
  reinigungsklasse_code text,
  belagsart_id  uuid,
  reinigungsklasse_id uuid,
  ist_gueltig   boolean not null default false,
  fehler        text[] not null default '{}',
  aktion        raumbuch_zeile_aktion not null default 'anlegen',
  raum_id       uuid,
  erstellt_am   timestamptz not null default now(),

  primary key (id),
  constraint rbz_mandant_uk unique (mandant_id, id),
  constraint rbz_import_fk foreign key (mandant_id, import_id)
    references raumbuch_import (mandant_id, id),
  constraint rbz_belagsart_fk foreign key (mandant_id, belagsart_id)
    references belagsart (mandant_id, id),
  constraint rbz_reinigungsklasse_fk foreign key (mandant_id, reinigungsklasse_id)
    references reinigungsklasse (mandant_id, id),
  constraint rbz_raum_fk foreign key (mandant_id, raum_id) references raum (mandant_id, id),
  -- Aktualisieren ohne Ziel waere Anlegen unter falschem Namen.
  constraint rbz_aktualisieren_mit_ziel check (aktion <> 'aktualisieren' or raum_id is not null)
);

create unique index rbz_zeile_uk on raumbuch_import_zeile (import_id, zeilennummer);
create index rbz_vorschau_idx on raumbuch_import_zeile (import_id, ist_gueltig, zeilennummer);
create index rbz_raum_idx on raumbuch_import_zeile (raum_id) where raum_id is not null;

/**
 * Welche Importe diesen Raum beruehrt haben, in Reihenfolge.
 *
 * Ein einzelnes `raum.import_id` verlaere die Herkunft jedes frueheren
 * Imports, sobald ein zweiter laeuft — und OPS-04 unter GoBD ist genau die
 * Frage, WIE das heutige Raumbuch entstanden ist.
 *
 * `import_zeile_id` traegt mit Absicht KEINEN Fremdschluessel: die
 * Zwischenzeilen werden irgendwann geraeumt, und ein Fremdschluessel
 * verhinderte diese Raeumung fuer jede Zeile, die tatsaechlich etwas bewirkt
 * hat — also nach jedem ERFOLGREICHEN Import. Deshalb stehen `vorher` und
 * `nachher` hier als Kopie und nicht als Verbindung.
 */
create table raum_import_historie (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  raum_id       uuid not null,
  import_id     uuid not null,
  import_zeile_id uuid,
  aktion        raumbuch_zeile_aktion not null,
  vorher        jsonb,
  nachher       jsonb,
  erstellt_am   timestamptz not null default now(),

  primary key (id),
  constraint rih_mandant_uk unique (mandant_id, id),
  constraint rih_raum_fk foreign key (mandant_id, raum_id) references raum (mandant_id, id),
  constraint rih_import_fk foreign key (mandant_id, import_id)
    references raumbuch_import (mandant_id, id),
  constraint rih_import_raum_uk unique (import_id, raum_id)
);

create index rih_raum_idx on raum_import_historie (raum_id, erstellt_am desc);
create index rih_import_idx on raum_import_historie (import_id);
create index rih_zeile_idx on raum_import_historie (import_zeile_id)
  where import_zeile_id is not null;

-- ---------------------------------------------------------------------------
-- Serverzeit BEIM EREIGNIS — nicht beim Einfuegen.
-- ---------------------------------------------------------------------------

/**
 * Alle drei Zeitstempel sind NULL, bis das Ereignis eintritt. Ein
 * unbedingter Stempel beim INSERT legte jeden Import zugleich als geprueft,
 * uebernommen UND verworfen an — geraeuschlos, weil die Bedingungen darueber
 * nur in der anderen Richtung feuern.
 */
create function kern.raumbuch_import_stempeln() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.geprueft_am is not null and old.geprueft_am is null then
      new.geprueft_am := now();
    end if;
    if new.uebernommen_am is not null and old.uebernommen_am is null then
      new.uebernommen_am := now();
    end if;
    if new.verworfen_am is not null and old.verworfen_am is null then
      new.verworfen_am := now();
    end if;
    -- Nach der Uebernahme steht die Auslegung fest: eine andere
    -- Spaltenzuordnung waere die Behauptung, die Zeilen seien anders gelesen
    -- worden, als sie geschrieben wurden.
    if old.status = 'uebernommen' then
      if new.spalten_zuordnung is distinct from old.spalten_zuordnung
         or new.schluessel_spalte is distinct from old.schluessel_spalte
         or new.dokument_id is distinct from old.dokument_id then
        raise exception 'Ein uebernommener Import ist in seiner Auslegung unveraenderlich'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger rbi_stempeln before insert or update on raumbuch_import
  for each row execute function kern.raumbuch_import_stempeln();

-- ---------------------------------------------------------------------------
-- Zeilenschutz — Modul `objekt_import`, interne Decke.
-- ---------------------------------------------------------------------------

alter table raumbuch_import       enable row level security;
alter table raumbuch_import       force  row level security;
alter table raumbuch_import_zeile enable row level security;
alter table raumbuch_import_zeile force  row level security;
alter table raum_import_historie  enable row level security;
alter table raum_import_historie  force  row level security;

create policy t_mandant on raumbuch_import for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('objekt_import.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('objekt_import.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy p_intern_decke on raumbuch_import as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy t_mandant on raumbuch_import_zeile for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('objekt_import.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('objekt_import.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy p_intern_decke on raumbuch_import_zeile as restrictive for all to cse_app
  using (app.portal() = 'intern');

-- Die Historie liest, wer das Objekt liest; geschrieben wird sie nur bei der
-- Uebernahme, und geaendert nie (append-only).
create policy t_mandant on raum_import_historie for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('objekt.lesen', app.aktiver_mandant())));

create policy t_schreiben on raum_import_historie for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('objekt_import.schreiben', app.aktiver_mandant())));

create policy p_intern_decke on raum_import_historie as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on raumbuch_import, raumbuch_import_zeile to cse_app;
grant select, insert on raum_import_historie to cse_app;
/**
 * Die Zwischenzeilen sind die eine Tabelle dieser Domaene, die GERAEUMT
 * werden darf (§1.8) — deshalb traegt sie keine Loeschsperre und `cse_job`
 * ein DELETE. Ohne diese Ausnahme wuechse die Zwischenablage jedes Imports
 * fuer immer mit.
 */
grant delete on raumbuch_import_zeile to cse_job;

create policy t_job_raeumen on raumbuch_import_zeile for delete to cse_job
  using (exists (select 1 from raumbuch_import i
                  where i.id = raumbuch_import_zeile.import_id
                    and i.status in ('uebernommen','verworfen')));

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0026)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- raumbuch_import (archiv): OPS-04, LEG-01. Der Importkopf dokumentiert, WIE das heutige Raumbuch entstanden ist — eine GoBD-Frage. Er bleibt, auch wenn seine Zwischenzeilen geraeumt sind; sein Ende ist verworfen_am.
create trigger trg_raumbuch_import_kein_hard_delete
  before delete on raumbuch_import
  for each row execute function kern.verhindere_loeschung();
create trigger trg_raumbuch_import_kein_truncate
  before truncate on raumbuch_import
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on raumbuch_import from cse_app, cse_anon, cse_checkin, cse_job;

-- raum_import_historie (append): OPS-04, SEC-A9. Welcher Import welchen Raum wie veraendert hat, mit Vorher und Nachher. Eine Herkunftsspur mit Loeschpfad ist keine.
create trigger trg_raum_import_historie_kein_hard_delete
  before delete on raum_import_historie
  for each row execute function kern.verhindere_loeschung();
create trigger trg_raum_import_historie_kein_truncate
  before truncate on raum_import_historie
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on raum_import_historie from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_raumbuch_import_geaendert_am
  before update on raumbuch_import
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
