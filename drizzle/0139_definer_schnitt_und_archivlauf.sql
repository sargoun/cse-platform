-- ===========================================================================
-- 0139 — Zwei Definer-Policies bekommen ihren Mandantenschnitt; der
--        Archivlauf darf als `cse_job` schreiben, was er schreiben muss
-- ===========================================================================
--
-- **Befund 1 (Copilot, PR 12, `0134`).** 0134 hat die vier Definer-Policies
-- aus 0132 auf den aktiven Mandanten geschnitten — und `d_buchungssatz`
-- sowie `d_periode` aus 0127 daneben stehen lassen, beide `for all … using
-- (true) with check (true)`. Permissive Policies werden ODER-verknuepft: der
-- Schnitt aus 0134 galt fuer `cse_definer` damit an keiner Stelle, denn die
-- breite Policy daneben liess jede Zeile durch. Genau die Falle, die der
-- Kommentar in 0134 benennt („eine Verbreiterung, die wie eine Ergaenzung
-- aussieht") — nur eine Migration frueher.
--
-- Die Definer-Funktionen, die diese Policies brauchen
-- (`app.buchungssatz_schreiben`, `app.buchungssatz_storniert`,
-- `app.periode_sichern`, `app.buchen_erlaubt`), laufen alle in einer Sitzung
-- mit gebundenem Mandanten — aus `withTenant` oder aus `alsJobSitzung`. Der
-- Schnitt kostet sie nichts; er nimmt ihnen nur, was sie nie brauchen
-- durften: die Zeile einer anderen Gesellschaft.
--
-- **Befund 2 (Copilot, PR 12, `jobs/belegarchiv.ts`).** Der Archivlauf
-- bindet den Mandanten unter `set local role cse_job` und schreibt dann
-- `dokument`, `dokument_version` und `beleg` — Tabellen, auf denen `cse_job`
-- weder ein Recht noch eine Policy hatte. Solange kein Speicher verbunden
-- ist, kam der Lauf nie bis dorthin (`NichtVerbundenFehler` vor der
-- Schleife); am ersten Tag mit Speicher haette jede Rechnung mit
-- „permission denied" in `fehler` gezaehlt, und der Lauf haette „ok"
-- gemeldet. Hier bekommt der Job genau die vier Schreibwege, die der
-- Dienst `archiviereRechnungsbeleg` benutzt — je Mandant geschnitten und
-- nur ausserhalb des Lesemodus. Ein Isolationstest laeuft den Weg als
-- `cse_job` ab (`tests/isolation/belegarchiv-job.test.ts`).

-- ---------------------------------------------------------------------------
-- 1. Der Mandantenschnitt der beiden verbliebenen Definer-Policies
-- ---------------------------------------------------------------------------

drop policy d_buchungssatz on buchungssatz;
drop policy d_periode on periode;

/**
 * **Der Loeschriegel darf nicht blind werden.** `fin.dokument_haengt_an_buchung`
 * (0132) laeuft als `cse_definer` VOR dem weichen Loeschen eines Dokuments und
 * sucht die Buchungszeile, die sich darauf beruft — auch dann, wenn niemand
 * einen Mandanten gebunden hat (Wartung als Tabelleneigentuemer, ein Test).
 * Mit dem reinen Schnitt saehe er dann nichts und liesse das Dokument gehen:
 * ein Riegel, der ohne Sitzung faellt statt haelt.
 *
 * Deshalb der zweite Zweig: OHNE Sitzung sieht der Definer genau den
 * Mandanten, den der Riegel fuer die Dauer seiner Abfrage in
 * `app.riegel_mandant` setzt — den der zu loeschenden Zeile. In einer
 * gebundenen Sitzung ist `app.aktiver_mandant()` nie NULL, und der Zweig ist
 * tot; schreiben (`with check`) kann er ohnehin nichts.
 */
create policy d_buchungssatz on buchungssatz for all to cse_definer
  using      (mandant_id = app.aktiver_mandant()
              or (app.aktiver_mandant() is null
                  and mandant_id = nullif(current_setting('app.riegel_mandant', true), '')::uuid))
  with check (mandant_id = app.aktiver_mandant());

create or replace function fin.dokument_haengt_an_buchung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, fin as $$
declare v_zeile uuid;
begin
  if new.geloescht_am is null or old.geloescht_am is not null then return new; end if;

  /* Der Riegel nennt den Mandanten der Zeile — und nur fuer seine Abfrage. */
  perform set_config('app.riegel_mandant', old.mandant_id::text, true);
  select bs.id into v_zeile
    from public.beleg b
    join public.buchungssatz bs
      on bs.beleg_id = b.id and bs.mandant_id = b.mandant_id
   where b.dokument_id = old.id and b.mandant_id = old.mandant_id
   limit 1;
  perform set_config('app.riegel_mandant', '', true);

  if v_zeile is not null then
    raise exception
      'Dokument %: eine Buchungszeile (%) beruft sich darauf. Es bleibt, '
      'solange die Buchung steht (ACC-03, § 147 AO).', old.id, v_zeile
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird die BUCHUNG durch Gegenbuchung, nie der Beleg '
                   'durch Loeschen.';
  end if;
  return new;
end $$;

create policy d_periode on periode for all to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

-- ---------------------------------------------------------------------------
-- 2. Der Archivlauf als `cse_job`
-- ---------------------------------------------------------------------------

grant select, insert on dokument, dokument_version, beleg to cse_job;
grant select on rechnung_snapshot to cse_job;
/*
 * 0108 gab dem Job SPALTEN der Rechnung, nicht die Tabelle — und das bleibt
 * so. Der Archivlauf liest vier weitere: das Datum (fuer das Archivjahr),
 * den Kunden (fuer die Dokumentzeile), den Beleg (ist sie schon archiviert?)
 * und die Art (Storno oder Rechnung). Betraege bekommt er weiterhin nicht.
 */
grant select (rechnungsdatum, kunde_id, beleg_id, rechnungsart) on rechnung to cse_job;
/*
 * Die PDF entsteht aus dem Snapshot; ob die Leitweg-ID Pflicht ist, steht am
 * Kunden (0125 gab dem Job dort id, mandant_id und name). Zwei Merkmale mehr,
 * keine Anschrift, keine Kontakte.
 */
grant select (xrechnung_pflicht, ist_oeffentlicher_auftraggeber) on kunde to cse_job;

create policy j_dokument_lesen on dokument for select to cse_job
  using (mandant_id = app.aktiver_mandant());
create policy j_dokument_anlegen on dokument for insert to cse_job
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly());

create policy j_dokument_version_lesen on dokument_version for select to cse_job
  using (mandant_id = app.aktiver_mandant());
create policy j_dokument_version_anlegen on dokument_version for insert to cse_job
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly());

create policy j_beleg_lesen on beleg for select to cse_job
  using (mandant_id = app.aktiver_mandant());
create policy j_beleg_anlegen on beleg for insert to cse_job
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly());

create policy j_rechnung_snapshot_lesen on rechnung_snapshot for select to cse_job
  using (mandant_id = app.aktiver_mandant());

comment on policy j_dokument_anlegen on dokument is
  'ACC-03. Der naechtliche Archivlauf legt die PDF einer festgeschriebenen '
  'Rechnung als Dokument ab — nur im eigenen Mandanten, nur schreibend '
  'gebunden. Ohne diese Policy scheiterte der Lauf am ersten Tag mit '
  'verbundenem Speicher (0139).';

-- ---------------------------------------------------------------------------
-- 3. `dokument_zugriff` — die Spur eines Dateiabrufs (DOC-03, SEC-A6)
-- ---------------------------------------------------------------------------

/**
 * **Befund 3 (Copilot, PR 12, `dokumente/[id]`).** Das Dokumentblatt sagte:
 * „der Abruf steht mit dem Zugriffsprotokoll bereit" — und es gab weder
 * einen Abruf noch ein Protokoll. Jetzt gibt es beides: die Route
 * `GET /api/dokumente/[id]/datei` und diese Tabelle, in die sie VOR der
 * signierten Adresse schreibt. Wer eine Datei abruft, hinterlaesst eine
 * Zeile; wer wissen will, wer eine Personalakte gesehen hat (Art. 15 DSGVO),
 * findet sie hier.
 *
 * Anfuegend wie `freigabe_ansicht`: eine Zeile je Abruf, keine Aenderung,
 * kein Loeschen. Die Serverzeit setzt ein Trigger — ein Zeitstempel aus dem
 * Aufrufer waere hier derselbe Fehler wie bei APR-08.
 */
create table dokument_zugriff (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  dokument_id   uuid not null,
  benutzer_id   uuid references benutzer(id),
  art           text not null check (art in ('abruf', 'vorschau')),
  erstellt_am   timestamptz not null default now(),

  constraint dokument_zugriff_mandant_uk unique (mandant_id, id),
  constraint dz_dokument_fk
    foreign key (mandant_id, dokument_id) references dokument (mandant_id, id)
);

create index dz_dokument_idx on dokument_zugriff (dokument_id, erstellt_am desc);
create index dz_benutzer_idx on dokument_zugriff (benutzer_id, erstellt_am desc)
  where benutzer_id is not null;

create function kern.dokument_zugriff_serverzeit() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.erstellt_am := now();
  return new;
end $$;

create trigger trg_dokument_zugriff_serverzeit
  before insert on dokument_zugriff
  for each row execute function kern.dokument_zugriff_serverzeit();

create function kern.dokument_zugriff_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception
    'dokument_zugriff ist anfuegend: ein zweiter Abruf ist eine zweite Zeile (DOC-03).'
    using errcode = 'restrict_violation';
end $$;

create trigger trg_dokument_zugriff_unveraenderlich
  before update on dokument_zugriff
  for each row execute function kern.dokument_zugriff_unveraenderlich();

alter table dokument_zugriff enable row level security;
alter table dokument_zugriff force row level security;

/* Wer das Dokument lesen darf, hinterlaesst die Spur — und darf sie lesen. */
create policy t_dokument_zugriff_lesen on dokument_zugriff for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('dokument.lesen', mandant_id));
create policy t_dokument_zugriff_anlegen on dokument_zugriff for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and app.hat_recht('dokument.lesen', mandant_id));

grant select, insert on dokument_zugriff to cse_app;

comment on table dokument_zugriff is
  'DOC-03, SEC-A6, Art. 15 DSGVO. Eine Zeile je Abruf einer Datei aus der '
  'Ablage — geschrieben von der Abrufroute VOR der signierten Adresse, in '
  'derselben Transaktion. Anfuegend: kein Update, kein Delete (0139).';

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0139)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- dokument_zugriff (append): DOC-03, SEC-A6, Art. 15 DSGVO. Eine Zeile je Abruf einer Datei aus der Ablage. Sie ist die Antwort auf die Frage, wer eine Personalakte oder einen Beleg gesehen hat — loeschbar waere sie das Werkzeug dessen, der nicht gesehen werden will.
create trigger trg_dokument_zugriff_kein_hard_delete
  before delete on dokument_zugriff
  for each row execute function kern.verhindere_loeschung();
create trigger trg_dokument_zugriff_kein_truncate
  before truncate on dokument_zugriff
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on dokument_zugriff from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

-- ---------------------------------------------------------------------------
-- 4. `app.buchen_erlaubt` erkennt die Jobsitzung an der ROLLE, nicht am Login
-- ---------------------------------------------------------------------------

/**
 * 0131 prueft `session_user = 'cse_job'`. `session_user` ist die Rolle der
 * VERBINDUNG; die Jobsitzung (`alsJobSitzung`, D-4xx) bindet `cse_job` aber
 * mit `set local role` auf der gemeinsamen Verbindung — `session_user` bleibt
 * die Pool-Rolle, und der Archivlauf fiel in `app.rechnung_beleg_setzen` an
 * „finanzen.schreiben … fehlt": ein Nachtlauf hat keinen Benutzer und damit
 * kein Recht. Innerhalb eines Definers ist `current_user` der Eigentuemer;
 * was die gesetzte Rolle noch verraet, ist die Einstellung `role`. Sie
 * gilt, wenn die Verbindung selbst `cse_job` ist, ebenso wie nach
 * `set local role cse_job` — und eine `cse_app`-Sitzung kann sie nicht
 * annehmen, weil `cse_app` kein Mitglied von `cse_job` ist.
 */
create or replace function app.buchen_erlaubt(p_mandant uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if session_user = 'cse_job' or current_setting('role', true) = 'cse_job' then return; end if;
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht bucht nicht (Invariante 10).' using errcode = '42501';
  end if;
  if not (app.hat_recht('finanzen.schreiben', p_mandant)
          or app.hat_recht('buchhaltung.schreiben', p_mandant)
          or app.hat_recht('eingang.freigeben', p_mandant)) then
    raise exception
      'finanzen.schreiben, buchhaltung.schreiben oder eingang.freigeben fehlt'
      using errcode = '42501';
  end if;
end $$;
