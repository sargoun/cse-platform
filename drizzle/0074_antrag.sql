-- ===========================================================================
-- 0074 — antragsart und antrag: der Weg, auf dem ein Mensch etwas beantragt
--        (01-KERN.md §6.28 und §6.29; EMP-10, EMP-11, EMP-12, NOT-01, NOT-03,
--        D-09)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.28/§6.29.
--
-- **Der Antrag bleibt stehen, auch wenn er genehmigt ist.** Die Genehmigung
-- erzeugt den Folgesatz — die `abwesenheit` —, und der Antrag ist danach der
-- Beleg: wer wann was beantragt hat, wer entschieden hat und mit welchem Wort.
-- Der naheliegende Entwurf loescht ihn nach der Umsetzung („die Abwesenheit
-- steht ja"), und damit verschwindet genau die Spur, die im Streit zaehlt.
--
-- **Eine Katalogtabelle statt eines Enums** (§6.28): der Entwurf mischte das
-- SPEC-Vokabular (`urlaub`, `krankmeldung`, `schichttausch` — EMP-10) mit
-- erfundenen Bequemlichkeiten. Was ein Antrag mitbringen MUSS, steht deshalb
-- als Spalte am Katalog und nicht als `CASE` ueber Enum-Namen — der Kunde legt
-- weitere Arten in der Oberflaeche an, ohne Migration (K-17).
--
-- **Die Beziehung gibt es genau einmal**: `abwesenheit.antrag_id`. Der Entwurf
-- hatte zusaetzlich `antrag.resultat_abwesenheit_id` — dieselbe Beziehung
-- zweimal, in zwei Anweisungen herzustellen und auf zwei Arten uneinig zu
-- werden.
--
-- **Ueber Gesellschaftsgrenzen wird nicht getauscht** (D-09): der
-- Tauschpartner haengt an einem zusammengesetzten Fremdschluessel, damit ein
-- Tausch zwischen zwei Gesellschaften strukturell unmoeglich ist — nicht nur
-- „wird nicht angeboten".
-- ===========================================================================

create type antrag_status as enum
  ('eingereicht','in_pruefung','genehmigt','abgelehnt','zurueckgezogen','storniert');

-- ---------------------------------------------------------------------------
-- 1. antragsart (01-KERN §6.28)
-- ---------------------------------------------------------------------------

create table antragsart (
  id                        uuid not null default gen_random_uuid(),
  mandant_id                uuid references mandant(id),
  schluessel                text not null,
  bezeichnung               text not null,
  bezeichnung_i18n          jsonb not null default '{}'::jsonb,

  -- Was die Art verlangt. Spalten statt eines CASE ueber Enum-Namen: der
  -- Ausloeser unten liest sie, und der Kunde kann eine Art anlegen, ohne dass
  -- jemand Code aendert.
  erfordert_zeitraum        boolean not null default false,
  erfordert_abwesenheitsart boolean not null default false,
  erfordert_einsatz         boolean not null default false,
  erfordert_tauschpartner   boolean not null default false,
  erzeugt_abwesenheit       boolean not null default false,
  ist_stammdatenaenderung   boolean not null default false,
  -- Die drei, die EMP-10 nennt. Sie sind nicht loeschbar und nicht umbenennbar.
  ist_system                boolean not null default false,

  archiviert_am             timestamptz,
  erstellt_am               timestamptz not null default now(),
  geaendert_am              timestamptz,
  erstellt_von              uuid references benutzer(id),
  geaendert_von             uuid references benutzer(id),

  primary key (id),
  constraint antragsart_key unique nulls not distinct (mandant_id, schluessel),
  constraint at_schluessel_form check (schluessel ~ '^[a-z][a-z0-9_]{1,40}$')
);

create index antragsart_aktiv_idx on antragsart (mandant_id) where archiviert_am is null;

comment on table antragsart is
  'K-17: der bearbeitbare Katalog der Antragsarten. Was eine Art verlangt, '
  'steht als Spalte — nicht als CASE ueber Enum-Namen.';

/**
 * Die drei Arten aus EMP-10. Alles Weitere legt der Kunde selbst an.
 * // TODO(client, O-142): Welche weiteren Antragsarten fuehrt die Gruppe — unbezahlte Freistellung, Freizeitausgleich, Schichtabgabe, Stammdatenaenderung?
 */
insert into antragsart
  (mandant_id, schluessel, bezeichnung, bezeichnung_i18n,
   erfordert_zeitraum, erfordert_abwesenheitsart, erfordert_einsatz,
   erfordert_tauschpartner, erzeugt_abwesenheit, ist_system)
values
  (null, 'urlaub', 'Urlaubsantrag',
   '{"de":"Urlaubsantrag","en":"Leave request","ar":"طلب إجازة","tr":"İzin talebi"}'::jsonb,
   true, true, false, false, true, true),
  (null, 'krankmeldung', 'Krankmeldung',
   '{"de":"Krankmeldung","en":"Sick note","ar":"إشعار مرض","tr":"Hastalık bildirimi"}'::jsonb,
   true, true, false, false, true, true),
  (null, 'schichttausch', 'Schichttausch',
   '{"de":"Schichttausch","en":"Shift swap","ar":"تبادل الورديات","tr":"Vardiya değişimi"}'::jsonb,
   false, false, true, true, false, true);

-- ---------------------------------------------------------------------------
-- 2. antrag (01-KERN §6.29)
-- ---------------------------------------------------------------------------

create table antrag (
  id                  uuid not null default gen_random_uuid(),
  mandant_id          uuid not null references mandant(id),
  -- D-09: ein Antrag betrifft EINE Beschaeftigung. Wer zwei hat, stellt zwei —
  -- es entscheiden zwei Vorgesetzte.
  anstellung_id       uuid not null,
  antragsart_id       uuid not null references antragsart(id),

  status              antrag_status not null default 'eingereicht',

  von_datum           date,
  bis_datum           date,
  abwesenheitsart_id  uuid references abwesenheitsart(id),
  einsatz_id          uuid,
  tausch_partner_anstellung_id uuid,

  /**
   * Der Inhalt einer Stammdatenaenderung als `{feld: neuer_wert}`. Ohne diese
   * Spalte gaebe es die Antragsart, aber keinen Ort fuer ihren Inhalt — der
   * Antrag waere weder pruefbar noch anwendbar. Welche Felder erlaubt sind,
   * entscheidet der Dienst; die Datenbank verlangt nur ein Objekt.
   */
  aenderungswunsch    jsonb,
  nachricht           text,
  anhang_dokument_id  uuid,

  eingereicht_am      timestamptz not null default now(),
  -- NOT NULL: es gibt keinen kontenlosen Schreibweg in diese Tabelle. Ein
  -- Antrag ohne Absender waere im Streit wertlos.
  eingereicht_von_benutzer_id uuid not null references benutzer(id),

  entschieden_von     uuid references benutzer(id),
  entschieden_am      timestamptz,
  entscheidung_kommentar text,
  storniert_am        timestamptz,

  erstellt_am         timestamptz not null default now(),
  geaendert_am        timestamptz,

  primary key (id),
  constraint antrag_mandant_uk unique (mandant_id, id),
  constraint an_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint an_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),
  constraint an_tausch_fk foreign key (mandant_id, tausch_partner_anstellung_id)
    references anstellung (mandant_id, id),

  constraint an_zeitraum check (
    bis_datum is null or von_datum is null or bis_datum >= von_datum),
  constraint an_aenderungswunsch_objekt check (
    aenderungswunsch is null or jsonb_typeof(aenderungswunsch) = 'object'),
  -- Eine Ablehnung ohne Wort ist keine Entscheidung, sondern ein Klick.
  constraint an_ablehnung_begruendet check (
    status <> 'abgelehnt'
    or (entscheidung_kommentar is not null and btrim(entscheidung_kommentar) <> '')),
  constraint an_entscheidung_paarweise check (
    (entschieden_am is null) = (entschieden_von is null)),
  -- Der Tauschpartner ist nicht die antragstellende Person selbst.
  constraint an_tausch_nicht_selbst check (
    tausch_partner_anstellung_id is null
    or tausch_partner_anstellung_id <> anstellung_id)
);

-- Der Genehmigungsposteingang (NOT-01).
create index antrag_offen_idx on antrag (mandant_id, status, eingereicht_am)
  where status in ('eingereicht','in_pruefung');
-- „Meine Antraege" (EMP-10) — ohne Mandantenpraefix, weil die kombinierte
-- Sicht ueber beide Beschaeftigungen laeuft.
create index antrag_anstellung_idx on antrag (anstellung_id, eingereicht_am desc);
create index antrag_einsatz_idx on antrag (einsatz_id) where einsatz_id is not null;

comment on table antrag is
  'EMP-10: der Mitarbeiterantrag. Die Genehmigung erzeugt den Folgesatz; der '
  'Antrag selbst bleibt als Beleg stehen.';

-- Jetzt erst der Fremdschluessel von `abwesenheit.antrag_id` — die Tabelle
-- `antrag` gab es in 0073 noch nicht (§19: die Struktur steht ab der ersten
-- Migration, der Schluessel folgt, sobald das Gegenueber existiert).
alter table abwesenheit
  add constraint ab_antrag_fk foreign key (mandant_id, antrag_id)
    references antrag (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 3. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `antrag_status_maschine` — und die Zeitpunkte gehoeren dem Server.
 *
 * `eingereicht → in_pruefung → genehmigt | abgelehnt`; `zurueckgezogen` nur
 * VOR der Entscheidung — danach waere es eine stille Ruecknahme einer
 * getroffenen Entscheidung; `storniert` nur aus `genehmigt`.
 */
create function kern.antrag_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.eingereicht_am := now();
    if new.status <> 'eingereicht' then
      raise exception 'Ein Antrag entsteht als eingereicht'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'eingereicht' and new.status in ('in_pruefung','genehmigt','abgelehnt','zurueckgezogen'))
      or (old.status = 'in_pruefung' and new.status in ('genehmigt','abgelehnt','zurueckgezogen'))
      or (old.status = 'genehmigt' and new.status = 'storniert')
    ) then
      raise exception 'Uebergang % → % ist nicht vorgesehen', old.status, new.status
        using errcode = 'check_violation';
    end if;
    if new.status in ('genehmigt','abgelehnt') then
      new.entschieden_am := now();
    end if;
    if new.status = 'storniert' then new.storniert_am := now(); end if;
  end if;

  new.eingereicht_am := old.eingereicht_am;
  return new;
end $$;

create trigger trg_antrag_status
  before insert or update on antrag
  for each row execute function kern.antrag_status();

/**
 * `antrag_pflichtfelder` — was die Art verlangt, muss dastehen.
 *
 * Die Pruefung liegt in der Datenbank und nicht nur im Dienst, weil ein Antrag
 * ohne Zeitraum, der spaeter eine Abwesenheit erzeugen soll, dort mit einem
 * NOT-NULL-Fehler scheitert — an einer Stelle, an der niemand mehr weiss,
 * welches Feld im Formular gefehlt hat.
 */
create function kern.antrag_pflichtfelder() returns trigger
language plpgsql as $$
declare v record;
begin
  select * into v from antragsart where id = new.antragsart_id;
  if v.erfordert_zeitraum and (new.von_datum is null or new.bis_datum is null) then
    raise exception 'Diese Antragsart verlangt einen Zeitraum'
      using errcode = 'check_violation', hint = 'Fehlendes Feld: von_datum';
  end if;
  if v.erfordert_abwesenheitsart and new.abwesenheitsart_id is null then
    raise exception 'Diese Antragsart verlangt eine Abwesenheitsart'
      using errcode = 'check_violation', hint = 'Fehlendes Feld: abwesenheitsart_id';
  end if;
  if v.erfordert_einsatz and new.einsatz_id is null then
    raise exception 'Diese Antragsart verlangt eine Schicht'
      using errcode = 'check_violation', hint = 'Fehlendes Feld: einsatz_id';
  end if;
  if v.erfordert_tauschpartner and new.tausch_partner_anstellung_id is null then
    raise exception 'Diese Antragsart verlangt einen Tauschpartner'
      using errcode = 'check_violation', hint = 'Fehlendes Feld: tausch_partner_anstellung_id';
  end if;
  if new.aenderungswunsch is not null and not v.ist_stammdatenaenderung then
    raise exception 'Diese Antragsart kennt keinen Aenderungswunsch'
      using errcode = 'check_violation', hint = 'Fehlendes Feld: aenderungswunsch';
  end if;
  return new;
end $$;

create trigger trg_antrag_pflichtfelder
  before insert or update on antrag
  for each row execute function kern.antrag_pflichtfelder();

/**
 * `antrag_erzeugt_abwesenheit` — die Genehmigung legt den Folgesatz an.
 *
 * `security definer`, weil der Genehmigende `zeit.abwesenheit_melden` nicht
 * halten muss: er entscheidet ueber einen Antrag. Ohne Definer scheiterte die
 * Genehmigung an einer Policy, die mit dem Vorgang nichts zu tun hat.
 *
 * **Die Tage rechnet der Ausloeser NICHT.** `tage_angerechnet` ist eine
 * Arbeitstagsrechnung mit Feiertagen und Halbtagen (CLN-03), sie gehoert in
 * den Dienst, und ein hier erfundener Wert waere eine Zahl, die niemand
 * geprueft hat. Der Ausloeser uebernimmt, was der Dienst am Antrag hinterlegt
 * hat: `antrag.aenderungswunsch->>'tage_angerechnet'` ist dafuer NICHT
 * vorgesehen — der Dienst schreibt die Abwesenheit deshalb SELBST und setzt
 * den Antrag danach auf genehmigt. Dieser Ausloeser faengt nur den Fall ab,
 * dass jemand den Antrag an ihm vorbei genehmigt: dann entsteht die
 * Abwesenheit im Status `beantragt` und ohne Tage, und die Planung sieht sie
 * in ihrer Liste — statt dass die Genehmigung spurlos verpufft.
 */
create function kern.antrag_erzeugt_abwesenheit() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_erzeugt boolean;
begin
  if new.status <> 'genehmigt' or old.status = 'genehmigt' then return new; end if;
  select erzeugt_abwesenheit into v_erzeugt from public.antragsart
   where id = new.antragsart_id;
  if not coalesce(v_erzeugt, false) then return new; end if;

  -- Hat der Dienst die Abwesenheit schon geschrieben, ist hier nichts zu tun.
  if exists (select 1 from public.abwesenheit a where a.antrag_id = new.id) then
    return new;
  end if;

  begin
    insert into public.abwesenheit
      (mandant_id, anstellung_id, abwesenheitsart_id, von, bis, status, antrag_id,
       erstellt_von)
    values (new.mandant_id, new.anstellung_id, new.abwesenheitsart_id,
            new.von_datum, new.bis_datum, 'beantragt', new.id, new.entschieden_von);
  exception when exclusion_violation then
    -- Fachlich, nicht als Constraint-Name: der Genehmigende soll lesen, WAS
    -- kollidiert, und nicht `ab_keine_dublette`.
    raise exception 'Für diesen Zeitraum ist bereits dieselbe Abwesenheit erfasst'
      using errcode = 'unique_violation',
            hint = 'Zeitraum prüfen oder die vorhandene Abwesenheit stornieren.';
  end;
  return new;
end $$;

create trigger trg_antrag_erzeugt_abwesenheit
  after update on antrag
  for each row execute function kern.antrag_erzeugt_abwesenheit();

-- ---------------------------------------------------------------------------
-- 4. Zeilenschutz (K-03, K-04, K-18)
-- ---------------------------------------------------------------------------

alter table antragsart enable row level security;
alter table antragsart force  row level security;

create policy t_katalog on antragsart for select to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()));
create policy t_katalog_pflege on antragsart for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and not ist_system
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())));
create policy t_job on antragsart for select to cse_job using (true);

alter table antrag enable row level security;
alter table antrag force  row level security;

create policy t_mandant on antrag for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.abwesenheit_lesen', app.aktiver_mandant())));

create policy t_mandant_entscheiden on antrag for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.antrag_entscheiden', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.antrag_entscheiden', app.aktiver_mandant())));

/**
 * **Der Schreibweg des Menschen** (EMP-10) — einreichen, und zwar nur fuer die
 * eigene Beschaeftigung. Kein UPDATE-Gegenstueck: zurueckziehen ist ein
 * Statuswechsel und laeuft ueber den Dienst, der dieselbe Bedingung prueft.
 */
create policy t_selbst_einreichen on antrag for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and exists (select 1 from anstellung a
                           where a.mandant_id = antrag.mandant_id
                             and a.id = antrag.anstellung_id
                             and a.person_id = app.aktuelle_person()));

create policy t_selbst_lesen on antrag for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and exists (select 1 from anstellung a
                      where a.mandant_id = antrag.mandant_id
                        and a.id = antrag.anstellung_id
                        and a.person_id = app.aktuelle_person()));

create policy t_person on antrag for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from anstellung a
                      where a.mandant_id = antrag.mandant_id
                        and a.id = antrag.anstellung_id
                        and a.person_id = app.aktuelle_person()));

create policy t_gruppe on antrag for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

create policy p_ma_decke on antrag as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
create policy p_kunde_decke on antrag as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

create policy t_job on antrag for select to cse_job using (true);
create policy an_definer on antrag for select to cse_definer using (true);

grant select, insert, update on antrag to cse_app;
grant select on antragsart to cse_app;
grant insert, update on antragsart to cse_app;
grant select on antrag to cse_job;
grant select on antragsart to cse_job;
grant select on antrag to cse_definer;
grant select on antragsart to cse_definer;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0074)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- antrag (archiv): EMP-10, NOT-01. Der Antrag ist der BELEG der Entscheidung: wer wann was beantragt und wer mit welchem Wort entschieden hat. Genau diese Spur verschwaende, wenn man ihn nach der Umsetzung aufraeumte.
create trigger trg_antrag_kein_hard_delete
  before delete on antrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_antrag_kein_truncate
  before truncate on antrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on antrag from cse_app, cse_anon, cse_checkin, cse_job;

-- antragsart (archiv): EMP-10, K-17. Wie `abwesenheitsart`: der Katalog gibt jedem Antrag seine Bedeutung, und die drei Systemarten aus EMP-10 sind nicht entfernbar.
create trigger trg_antragsart_kein_hard_delete
  before delete on antragsart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_antragsart_kein_truncate
  before truncate on antragsart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on antragsart from cse_app, cse_anon, cse_checkin, cse_job;


create trigger trg_antrag_audit
  after insert or update or delete on antrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
