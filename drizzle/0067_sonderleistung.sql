-- ===========================================================================
-- 0067 — sonderleistung: der Einzelabruf zwischen Angebot und Nachweis
--        (CLN-05, FIN-01, FIN-07, OPS-05)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §5.5, §12.
-- Wo dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die
-- Konvention.
--
-- Glasreinigung, Sonderreinigung, Warenraeumung, Grundreinigung nach einer
-- Uebergabe: einmalig beauftragte Leistungen, die kein Turnus sind und als
-- `einzelabruf` abgerechnet werden. `01-ORDNERSTRUKTUR.md` §4.9 nennt die
-- Tabelle; im ersten Entwurf des Datenmodells fehlte sie, und ein Abruf hatte
-- zwischen dem Angebot und dem Leistungsnachweis keinen Ort.
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **Keine Preisspalte.** Ein Abruf wird ueber `auftrag_leistung` und den
--     Kalkulationsdienst bepreist, nie auf dem Arbeitsdatensatz (§10.3). Ein
--     `preis_cent` hier waere eine zweite Wahrheit neben der Auftragszeile —
--     und die eine, die niemand pflegt.
--
--  2. **Nicht kundensichtbar.** Der Kunde sieht den `leistungsnachweis`, den
--     er unterschrieben hat, nicht unsere Auftragsverwaltung (§5.5). Deshalb
--     traegt die Tabelle `kunde_id` (der Schluessel, ueber den ein Abruf zu
--     einem Kunden gehoert) und trotzdem keine Kundendecke.
--
--  3. **Diese Migration steht NACH 0066**, obwohl §5.5 vor §5.6 kommt. Der
--     Grund ist ein Ring: `sonderleistung.leistungsnachweis_id` zeigt auf den
--     Nachweis, `leistungsnachweis.sonderleistung_id` zurueck. Einer der
--     beiden Schluessel muss nachgetragen werden; er wird hier nachgetragen,
--     weil dann beide Tabellen existieren und keine von ihnen als Spalte ohne
--     Schluessel stehen bleibt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstyp (§3.1)
-- ---------------------------------------------------------------------------

/**
 * Der Lebenslauf eines Abrufs (§3.1) — sechs Werte, wie das Dokument sie
 * nennt.
 *
 * Kein Uebergangsausloeser wie beim Leistungsnachweis: §5.5 beschreibt keinen
 * gerichteten Pfad, und einen zu erfinden hiesse festzulegen, ob ein
 * abgesagter Abruf wieder beauftragt werden kann. Das ist eine
 * Geschaeftsentscheidung, keine technische (K-17). Was die Reihenfolge
 * SCHUETZT, ist die Stornoseite: `storniert` steht als eigener Wert da und
 * die Zeile bleibt.
 */
create type sonderleistung_status as enum
  ('angefragt','beauftragt','geplant','erbracht','abgerechnet','storniert');

-- ---------------------------------------------------------------------------
-- 2. sonderleistung (§5.5)
-- ---------------------------------------------------------------------------

create table sonderleistung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  objekt_id     uuid not null,
  -- Wo der Abruf zonengebunden ist. NULL heisst „das ganze Objekt".
  revier_id     uuid,
  auftrag_leistung_id uuid,
  -- Glas, Sonderreinigung und Warenraeumung sind KATALOGZEILEN, kein
  -- Aufzaehlungstyp (CLN-05).
  leistungskatalog_position_id uuid not null,
  -- Denormalisiert fuer die Decke (§1.8) — auch wenn die Tabelle heute keine
  -- Kundendecke traegt, ist der Kunde die Frage, mit der eine Abrufliste
  -- gefiltert wird.
  kunde_id      uuid not null,

  bezeichnung   text not null,
  -- Berliner Kalendertag, an dem der Kunde abgerufen hat (K-11).
  beauftragt_am date not null,
  -- Wer auf KUNDENSEITE abgerufen hat. Freitext mit Absicht: das ist der Name
  -- am Telefon, keine Zeile in unserem Ansprechpartnerverzeichnis.
  beauftragt_durch text,

  ausfuehrung_von date,
  ausfuehrung_bis date,

  -- Menge, nicht Geld (§1.1).
  menge         numeric(12,3),
  einheit       text,

  status        sonderleistung_status not null default 'angefragt',
  -- Gesetzt, sobald der Nachweis zu diesem Abruf entsteht.
  leistungsnachweis_id uuid,

  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  -- §1.14, Klasse `gobd_10j` (§11): ein Abruf ist Teil der Abrechnungsspur.
  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint sonderleistung_mandant_uk unique (mandant_id, id),

  constraint sl_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint sl_revier_fk foreign key (mandant_id, revier_id)
    references revier (mandant_id, id),
  constraint sl_auftrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint sl_katalog_fk foreign key (mandant_id, leistungskatalog_position_id)
    references leistungskatalog_position (mandant_id, id),
  constraint sl_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),
  constraint sl_nachweis_fk foreign key (mandant_id, leistungsnachweis_id)
    references leistungsnachweis (mandant_id, id),
  constraint sl_ersetzt_fk foreign key (mandant_id, ersetzt_durch_id)
    references sonderleistung (mandant_id, id),

  constraint sl_bezeichnung_gefuellt check (btrim(bezeichnung) <> ''),
  constraint sl_ausfuehrungsfenster check (
    ausfuehrung_bis is null or ausfuehrung_von is null
    or ausfuehrung_bis >= ausfuehrung_von),
  -- Eine Menge ohne Einheit ist eine Zahl ohne Aussage — und umgekehrt.
  constraint sl_menge_paarweise check ((menge is null) = (einheit is null)),
  constraint sl_storno_paarweise check (
    (storniert_am is null) = (storniert_von is null)
    and (storniert_am is null or storno_grund is not null)),
  constraint sl_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

create index sonderleistung_objekt_idx
  on sonderleistung (mandant_id, objekt_id, beauftragt_am desc);
-- Die Arbeitsliste: was ist abgerufen und noch nicht erbracht?
create index sonderleistung_offen_idx
  on sonderleistung (mandant_id, status, ausfuehrung_von)
  where status in ('beauftragt','geplant');
-- FIN-18: „erbracht, aber noch nicht abgerechnet".
create index sonderleistung_abrechnung_idx
  on sonderleistung (mandant_id, auftrag_leistung_id)
  where status = 'erbracht';

comment on table sonderleistung is
  'Einzelabruf (§5.5): Glas-, Sonder-, Grundreinigung, Warenraeumung — '
  'einmalig beauftragt, als einzelabruf abgerechnet. Keine Preisspalte '
  '(§10.3), nicht kundensichtbar.';

-- ---------------------------------------------------------------------------
-- 3. Serverzeit fuer die Stornoseite (§1.11)
-- ---------------------------------------------------------------------------

/**
 * Wie in 0066: `kern.erzwinge_serverzeit()` ist auf `eingegangen_am`
 * festgeschrieben, also steht hier eine eigene Funktion fuer `storniert_am`.
 * Gestempelt wird nur der UEBERGANG nach „gesetzt".
 */
create function kern.sonderleistung_zeitstempel() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.storniert_am is not null then new.storniert_am := now(); end if;
    return new;
  end if;
  if new.storniert_am is not null and old.storniert_am is null then
    new.storniert_am := now();
  end if;
  return new;
end $$;

create trigger trg_sonderleistung_zeitstempel
  before insert or update on sonderleistung
  for each row execute function kern.sonderleistung_zeitstempel();

-- ---------------------------------------------------------------------------
-- 4. Die zwei Schluessel, die auf diese Tabelle gewartet haben
-- ---------------------------------------------------------------------------

/**
 * 0066 hat `leistungsnachweis.sonderleistung_id` als Spalte ohne Schluessel
 * stehen lassen, 0028 dasselbe mit `einsatz.sonderleistung_id` (dort
 * Abschnitt 6, woertlich notiert). Beide werden jetzt faellig.
 *
 * Zusammengesetzt, nicht einspaltig: ein einspaltiger Schluessel liesse eine
 * Schicht der einen Gesellschaft an einem Abruf der anderen haengen, und RLS
 * faende daran nichts auszusetzen, weil beide Zeilen fuer sich stimmig sind
 * (§1.4, K-16).
 */
alter table leistungsnachweis add constraint ln_sonderleistung_fk
  foreign key (mandant_id, sonderleistung_id) references sonderleistung (mandant_id, id);

alter table einsatz add constraint einsatz_sonderleistung_fk
  foreign key (mandant_id, sonderleistung_id) references sonderleistung (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 5. Zusammengesetzte Fremdschluessel dieser Migration (§12)
-- ---------------------------------------------------------------------------

/**
 *   sonderleistung (mandant_id, objekt_id)                    → objekt
 *   sonderleistung (mandant_id, revier_id)                    → revier
 *   sonderleistung (mandant_id, auftrag_leistung_id)          → auftrag_leistung
 *   sonderleistung (mandant_id, leistungskatalog_position_id) → leistungskatalog_position
 *   sonderleistung (mandant_id, kunde_id)                     → kunde
 *   sonderleistung (mandant_id, leistungsnachweis_id)         → leistungsnachweis
 *   sonderleistung (mandant_id, ersetzt_durch_id)             → sonderleistung
 *   leistungsnachweis (mandant_id, sonderleistung_id)         → sonderleistung
 *   einsatz (mandant_id, sonderleistung_id)                   → sonderleistung
 */

-- ---------------------------------------------------------------------------
-- 6. Zeilenschutz (§1.6, §1.8)
-- ---------------------------------------------------------------------------

alter table sonderleistung enable row level security;
alter table sonderleistung force  row level security;

create policy t_mandant on sonderleistung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('reinigung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('reinigung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on sonderleistung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.reinigung.lesen')));

/**
 * Nur intern (§5.5). Der Kunde sieht den Nachweis, den er unterschrieben
 * hat — nicht die Zeile, mit der wir seinen Anruf verbucht haben.
 */
create policy p_intern_decke on sonderleistung as restrictive for all to cse_app
  using (app.portal() = 'intern');

-- Der Generator liest Abrufe als Bedarfstraeger (`einsatz.quelle =
-- 'sonderleistung'`, 0028) und schreibt sie nicht.
create policy t_job on sonderleistung for select to cse_job using (true);
create policy t_job_frist on sonderleistung for update to cse_job
  using (true) with check (true);

grant select, insert, update on sonderleistung to cse_app;
grant select on sonderleistung to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on sonderleistung to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0067)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- sonderleistung (archiv): CLN-05, FIN-01, FIN-07. Der Einzelabruf ist die Grundlage einer einzelabruf-Abrechnung und Teil der Abrechnungsspur (Klasse gobd_10j). Geloescht stuende die Rechnung ueber eine Sonderreinigung ohne den Beleg da, dass sie beauftragt war; ein zurueckgezogener Abruf bekommt storniert_am.
create trigger trg_sonderleistung_kein_hard_delete
  before delete on sonderleistung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_sonderleistung_kein_truncate
  before truncate on sonderleistung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on sonderleistung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_sonderleistung_geaendert_am
  before update on sonderleistung
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
