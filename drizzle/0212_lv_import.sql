-- ===========================================================================
-- 0212 — LV-Import mit Vorschau (BAU-01, REQ-04, nach dem Muster von OPS-04)
-- ===========================================================================
--
-- **Zwischen Hochladen und Uebernehmen muss etwas SERVERSEITIG liegen**, und
-- genau das fehlte. `leistungsverzeichnis` traegt `quelle_dokument_id`,
-- `gaeb_version` und `importiert_am` — aber keinen Platz fuer eine noch nicht
-- uebernommene Fassung. Die naheliegende Abkuerzung waere, die Vorschau im
-- Browser zu halten und beim Uebernehmen zurueckzuschicken; das ist genau der
-- Weg, den K-12 verbietet: dann uebernimmt der Server, was der Browser
-- behauptet, und nicht, was er selbst gelesen hat.
--
-- Warum das bei einem LV noch teurer ist als bei einem Raumbuch (0026): ein
-- vertauschter Spaltenkopf macht aus tausend Quadratmetern tausend Euro
-- Einheitspreis. Der Fehler faellt erst in der Schlussrechnung auf, wo er
-- plausibel aussieht — und bis dahin haengen Aufmasse an den falschen
-- Positionen.
--
-- **Das Austauschformat ist OFFEN (O-41, wortgleich O-97).** GAEB DA XML
-- (X83/X84), GAEB D8x, Excel oder PDF — das ist nicht raten-bar, und ein
-- halbfertiger Leser fuer GAEB liest die erste Ebene, uebersieht die
-- Zuschlagspositionen und meldet trotzdem Erfolg. Deshalb:
--
--  - `lv_import_format` nennt die Formate, die zur Frage gehoeren, und die
--    Spalte HAELT FEST, in welchem Format tatsaechlich hochgeladen wurde.
--    Eine Spalte, die nur „csv" kann, muesste beim ersten GAEB-Lauf
--    migriert werden — und dann waere nicht mehr feststellbar, wie die
--    Altbestaende gelesen wurden.
--  - Implementiert ist GENAU EINES (`csv_semikolon`). Welches, entscheidet
--    nicht diese Migration, sondern `src/server/services/bau/lv-quelle.ts`;
--    die Oberflaeche schreibt „nicht implementiert" an die anderen, statt
--    einen Erfolg vorzutaeuschen.
--
-- **Der Einheitspreis ist auch im Zwischenspeicher der Einheitspreis** (K-05,
-- §1.9). Waere `lv_import_zeile.einheitspreis_cent` fuer `cse_app` lesbar,
-- waere die Importvorschau der Umweg um den Spaltenentzug auf
-- `lv_position.einheitspreis_cent` — dieselbe Zahl, dieselbe Kalkulation,
-- eine Tabelle weiter. Der Entzug gilt hier genauso, und
-- `app.lv_import_preis_lesen` ist der einzige Weg dorthin.

-- ---------------------------------------------------------------------------
-- 1. Die Aufzaehlungen
-- ---------------------------------------------------------------------------

create type lv_import_status as enum
  ('hochgeladen', 'geprueft', 'uebernommen', 'verworfen', 'fehler');

comment on type lv_import_status is
  'Wie in 0026 (OPS-04): `geprueft` ist der Zustand MIT Vorschau und ohne '
  'Wirkung. Erst `uebernommen` hat ein Leistungsverzeichnis geschrieben.';

create type lv_import_zeile_aktion as enum
  ('anlegen', 'aktualisieren', 'unveraendert', 'ignorieren');

comment on type lv_import_zeile_aktion is
  'Was die Uebernahme mit dieser Zeile tun WUERDE — in der Vorschau sichtbar, '
  'bevor sie etwas tut (OPS-04-Muster).';

create type lv_import_format as enum
  ('csv_semikolon', 'gaeb_da_xml', 'gaeb_d83', 'gaeb_d84', 'excel', 'pdf');

comment on type lv_import_format is
  'Die Formate, um die O-41/O-97 fragt. Die Spalte haelt fest, WIE eine '
  'Fassung gelesen wurde; implementiert ist zum Zeitpunkt dieser Migration '
  'ausschliesslich csv_semikolon (siehe src/server/services/bau/lv-quelle.ts). '
  'Ein nicht implementiertes Format wird abgewiesen, nie simuliert.';

-- ---------------------------------------------------------------------------
-- 2. Der Importkopf
-- ---------------------------------------------------------------------------

create table lv_import (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  projekt_id    uuid not null,
  /** Die abgelegte Datei — NULL, solange kein Speicher verbunden ist (0026). */
  quelle_dokument_id uuid,
  dateiname     text not null,
  format        lv_import_format not null,
  status        lv_import_status not null default 'hochgeladen',

  /** Welche Bezeichnung das entstehende Verzeichnis tragen soll. */
  bezeichnung   text not null,
  /** Nach der Uebernahme: das Verzeichnis, das dabei entstanden ist. */
  leistungsverzeichnis_id uuid,

  zeilen_gesamt integer not null default 0,
  zeilen_gueltig integer not null default 0,
  zeilen_fehler integer not null default 0,
  /** Was am GANZEN Lauf nicht stimmte — Kopfzeilen, Kodierung, leere Datei. */
  fehler_bericht jsonb,

  geprueft_am   timestamptz,
  geprueft_von  uuid references benutzer(id),
  uebernommen_am timestamptz,
  uebernommen_von uuid references benutzer(id),
  verworfen_am  timestamptz,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint lvi_mandant_uk unique (mandant_id, id),
  constraint lvi_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint lvi_dokument_fk foreign key (mandant_id, quelle_dokument_id)
    references dokument (mandant_id, id),
  constraint lvi_lv_fk foreign key (mandant_id, leistungsverzeichnis_id)
    references leistungsverzeichnis (mandant_id, id),
  constraint lvi_dateiname_gefuellt check (btrim(dateiname) <> ''),
  constraint lvi_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  /** Eine Uebernahme hat immer einen benannten Menschen und ein Ergebnis. */
  constraint lvi_uebernahme_benannt check (
    status <> 'uebernommen'
    or (uebernommen_am is not null and uebernommen_von is not null
        and leistungsverzeichnis_id is not null)),
  constraint lvi_zaehler_stimmig check (
    zeilen_gueltig >= 0 and zeilen_fehler >= 0 and zeilen_gesamt >= zeilen_gueltig)
);

create index lvi_verlauf_idx on lv_import (mandant_id, projekt_id, erstellt_am desc);
create index lvi_wartend_idx on lv_import (mandant_id, status)
  where status in ('hochgeladen', 'geprueft');

comment on table lv_import is
  'BAU-01/REQ-04, Muster OPS-04 (0026): der Zwischenzustand zwischen '
  'Hochladen und Uebernehmen. Ohne ihn muesste die Vorschau aus dem Browser '
  'zurueckkommen, und der Server uebernaehme, was der Browser behauptet (K-12).';

-- ---------------------------------------------------------------------------
-- 3. Die Zwischenzeilen
-- ---------------------------------------------------------------------------

create table lv_import_zeile (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  import_id     uuid not null,
  zeilennummer  integer not null,

  /**
   * Die unveraenderte Quellzeile — der Nachweis darueber, WAS hochgeladen
   * wurde, unabhaengig davon, wie der Importeur sie gelesen hat (0026).
   *
   * **Sie ist fuer `cse_app` nicht lesbar**, und das ist kein Versehen: in
   * ihr steht der Einheitspreis im Klartext, also faellt sie unter denselben
   * Spaltenentzug wie `einheitspreis_cent` (K-05, §1.9). Gelesen wird sie
   * ueber `app.lv_import_preis_lesen`, das `bau.preis_lesen` prueft und jeden
   * Zugriff protokolliert.
   */
  rohdaten      jsonb not null,

  oz            text,
  art           lv_art,
  positionsart  lv_positionsart not null default 'unbestimmt',
  kurztext      text,
  langtext      text,
  einheit       text,
  /** Mit deutschem Dezimalkomma gelesen: „12,5" ist 12.5, nicht 125. */
  menge         numeric(12,3),
  /** Ganzzahlige Cent (Invariante 1) — nie Gleitkomma, auch nicht im Entwurf. */
  einheitspreis_cent bigint,
  /**
   * APR-03: wie sicher der Leser war. Bei einem maschinell gelesenen PDF
   * kommt sie aus dem Modell; bei einer CSV-Spalte, die woertlich dasteht,
   * bleibt sie NULL — eine erfundene 100 waere die Behauptung, ein Modell
   * habe geprueft.
   */
  konfidenz     numeric(5,2),

  ist_gueltig   boolean not null default false,
  fehler        text[] not null default '{}',
  aktion        lv_import_zeile_aktion not null default 'anlegen',
  /** Bei `aktualisieren`: die Position, die ersetzt wird. */
  lv_position_id uuid,

  erstellt_am   timestamptz not null default now(),

  primary key (id),
  constraint lviz_mandant_uk unique (mandant_id, id),
  constraint lviz_import_fk foreign key (mandant_id, import_id)
    references lv_import (mandant_id, id),
  constraint lviz_position_fk foreign key (mandant_id, lv_position_id)
    references lv_position (mandant_id, id),
  /** Aktualisieren ohne Ziel waere Anlegen unter falschem Namen (0026). */
  constraint lviz_aktualisieren_mit_ziel check (
    aktion <> 'aktualisieren' or lv_position_id is not null),
  constraint lviz_konfidenz_bereich check (
    konfidenz is null or (konfidenz >= 0 and konfidenz <= 100)),
  /** Eine gueltige Zeile traegt OZ und Kurztext — sonst ist sie keine Zeile. */
  constraint lviz_gueltig_vollstaendig check (
    not ist_gueltig
    or (oz is not null and btrim(oz) <> '' and kurztext is not null
        and btrim(kurztext) <> '' and art is not null)),
  constraint lviz_rohdaten_objekt check (jsonb_typeof(rohdaten) = 'object')
);

create unique index lviz_zeile_uk on lv_import_zeile (import_id, zeilennummer);
create index lviz_vorschau_idx on lv_import_zeile (import_id, zeilennummer);
create index lviz_position_idx on lv_import_zeile (lv_position_id)
  where lv_position_id is not null;

comment on column lv_import_zeile.einheitspreis_cent is
  'Ganzzahlige Cent (Invariante 1). Spaltenentzug nach K-05/§1.9 wie auf '
  'lv_position: waere er hier lesbar, waere die Importvorschau der Umweg um '
  'den Entzug eine Tabelle weiter. app.lv_import_preis_lesen ist der Weg.';

-- ---------------------------------------------------------------------------
-- 4. Serverzeit BEIM EREIGNIS — nicht beim Einfuegen (0026 woertlich)
-- ---------------------------------------------------------------------------

/**
 * Alle drei Zeitstempel sind NULL, bis das Ereignis eintritt. Ein
 * unbedingter Stempel beim INSERT legte jeden Import zugleich als geprueft,
 * uebernommen UND verworfen an — geraeuschlos, weil die Bedingungen darueber
 * nur in der anderen Richtung feuern.
 *
 * Und nach der Uebernahme steht die Auslegung fest: ein anderes Format oder
 * ein anderes Zielverzeichnis waere die Behauptung, die Zeilen seien anders
 * gelesen worden, als sie geschrieben wurden.
 */
create function kern.lv_import_stempeln() returns trigger
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
    if old.status = 'uebernommen' then
      if new.format is distinct from old.format
         or new.leistungsverzeichnis_id is distinct from old.leistungsverzeichnis_id
         or new.quelle_dokument_id is distinct from old.quelle_dokument_id
         or new.zeilen_gesamt is distinct from old.zeilen_gesamt then
        raise exception 'Ein uebernommener LV-Import ist in seiner Auslegung unveraenderlich'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger lvi_stempeln before insert or update on lv_import
  for each row execute function kern.lv_import_stempeln();

/**
 * Eine Zwischenzeile gehoert zu ihrem Kopf — und ihr Mandant ist dessen.
 *
 * Ohne diese Pruefung antwortete der zusammengesetzte Fremdschluessel mit
 * einer Verletzungsmeldung, und ein fremder Import saehe anders aus als ein
 * nicht vorhandener (AUT-06). Ausserdem nimmt ein UEBERNOMMENER Import keine
 * Zeile mehr auf: sein Verzeichnis ist geschrieben, eine Zeile danach stuende
 * in der Vorschau und nicht im Ergebnis.
 */
create function kern.lv_import_zeile_kopf() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare k record;
begin
  select i.status::text as status into k
    from public.lv_import i
   where i.id = new.import_id and i.mandant_id = new.mandant_id;
  if k.status is null then
    raise exception 'Zu dieser Zeile gibt es keinen LV-Import in dieser Gesellschaft'
      using errcode = 'foreign_key_violation';
  end if;
  if tg_op = 'INSERT' and k.status in ('uebernommen', 'verworfen') then
    raise exception 'Ein abgeschlossener LV-Import nimmt keine Zeile mehr auf'
      using errcode = 'restrict_violation',
            hint    = 'Eine neue Fassung entsteht durch einen neuen Import.';
  end if;
  return new;
end $$;

create trigger lviz_kopf before insert or update on lv_import_zeile
  for each row execute function kern.lv_import_zeile_kopf();

-- ---------------------------------------------------------------------------
-- 5. Der eine Weg zum Preis der Zwischenzeile (K-05, §1.9)
-- ---------------------------------------------------------------------------

/**
 * `app.lv_import_preis_lesen` — wie `app.lv_preis_lesen` (0071), eine
 * Tabelle weiter.
 *
 * Sie gibt NULL zurueck und wirft nicht: die Vorschau laedt ihre Zeilen in
 * EINER gebundenen Transaktion, und eine Ausnahme darin brach die ganze
 * Seite ab, statt die Spalte leer zu lassen. Wer `bau.preis_lesen` nicht
 * haelt, sieht die Mengen und keine Betraege — und die Seite sagt das.
 */
create function app.lv_import_preis_lesen(p_zeile uuid) returns bigint
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_wert bigint; v_mandant uuid;
begin
  select z.einheitspreis_cent, z.mandant_id into v_wert, v_mandant
    from public.lv_import_zeile z where z.id = p_zeile;
  if v_mandant is null then return null; end if;
  if v_mandant is distinct from app.aktiver_mandant() then return null; end if;
  if not app.hat_recht('bau.preis_lesen', v_mandant) then return null; end if;
  perform app.protokolliere('bau.preis_gelesen', 'lv_import_zeile', p_zeile::text,
                            null, null, v_mandant);
  return v_wert;
end $$;

comment on function app.lv_import_preis_lesen(uuid) is
  'Der eine Weg zum Einheitspreis einer LV-Importzeile (K-05, §1.9): prueft '
  'bau.preis_lesen und den aktiven Mandanten und protokolliert jeden Zugriff.';

/**
 * **`owner to cse_definer`** (K-01): eine `security definer`-Funktion laeuft
 * mit den Rechten ihres Eigentuemers, und das ist ohne diese Zeile die
 * Migrationsrolle — Superuser mit `BYPASSRLS`. Dann liefe sie an jeder Policy
 * vorbei, und die Policy `lviz_definer` darunter waere Zierde.
 */
alter function app.lv_import_preis_lesen(uuid) owner to cse_definer;
revoke all on function app.lv_import_preis_lesen(uuid) from public;
grant execute on function app.lv_import_preis_lesen(uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- 6. Zeilenschutz — Modul `bau`, interne Decke
-- ---------------------------------------------------------------------------

alter table lv_import       enable row level security;
alter table lv_import       force  row level security;
alter table lv_import_zeile enable row level security;
alter table lv_import_zeile force  row level security;

create policy t_mandant on lv_import for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_mandant on lv_import_zeile for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * **Nur intern.** Ein Importlauf ist kein Vorgang des Kunden und keiner der
 * Baustelle: er traegt die Kalkulation des Auftraggebers in Rohform. Weder
 * Kundenportal noch Mitarbeiterportal haben hier etwas zu sehen.
 */
create policy p_intern_decke on lv_import as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy p_intern_decke on lv_import_zeile as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on lv_import to cse_app;

/**
 * **Die Spaltenliste ist ERSCHOEPFEND** — und sie entsteht ohne
 * vorangehendes Tabellenrecht. Ein tabellenweites `grant select` mit
 * nachtraeglichem `revoke select (spalte)` aendert in Postgres NICHTS: das
 * Tabellenrecht deckt weiter jede Spalte, und der Widerruf laeuft still ins
 * Leere (K-05, wie in 0004, 0071 und 0089).
 */
grant select (id, mandant_id, import_id, zeilennummer, oz, art, positionsart,
              kurztext, langtext, einheit, menge, konfidenz,
              ist_gueltig, fehler, aktion, lv_position_id, erstellt_am)
      on lv_import_zeile to cse_app;   -- OMITTED: einheitspreis_cent, rohdaten
grant insert, update on lv_import_zeile to cse_app;

/** Der Definer selbst muss die Zeile lesen duerfen (§1.10, FORCE RLS). */
grant select on lv_import_zeile to cse_definer;
create policy lviz_definer on lv_import_zeile for select to cse_definer using (true);

/**
 * Die Zwischenzeilen sind die eine Tabelle dieses Imports, die GERAEUMT
 * werden darf (§1.8, wie `raumbuch_import_zeile` in 0026) — deshalb traegt
 * sie keine Loeschsperre und `cse_job` ein DELETE. Ohne diese Ausnahme wuechse
 * die Zwischenablage jedes Imports fuer immer mit.
 */
grant delete on lv_import_zeile to cse_job;
grant select on lv_import_zeile to cse_job;

create policy t_job_lesen on lv_import_zeile for select to cse_job using (true);
create policy t_job_raeumen on lv_import_zeile for delete to cse_job
  using (exists (select 1 from lv_import i
                  where i.id = lv_import_zeile.import_id
                    and i.status in ('uebernommen', 'verworfen')));

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0212)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- lv_import (archiv): BAU-01, REQ-04, LEG-01. Der Importkopf dokumentiert, WIE das heutige Leistungsverzeichnis entstanden ist — in welchem Format, aus welcher Datei, von wem uebernommen. Er bleibt, auch wenn seine Zwischenzeilen geraeumt sind; sein Ende ist verworfen_am.
create trigger trg_lv_import_kein_hard_delete
  before delete on lv_import
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lv_import_kein_truncate
  before truncate on lv_import
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lv_import from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_lv_import_geaendert_am
  before update on lv_import
  for each row execute function kern.setze_geaendert_am();

-- >>> Ende des generierten Blocks
