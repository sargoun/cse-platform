-- ===========================================================================
-- 0133 — Der DATEV-Buchungsstapel als Vorgang (PR 60, ACC-02, GoBD)
-- ===========================================================================
--
-- 0126 hat die Stammdaten angelegt und LEER gelassen (O-05). 0127 hat auf
-- `periode` und `buchungssatz` je eine Spalte `datev_export_id` vorgesehen und
-- mit `periode_export_noch_leer` festgehalten, dass sie NULL bleibt, bis die
-- Elterntabelle existiert. Hier entsteht sie.
--
-- **Ein Export ist ein Vorgang, keine Datei.** Die Datei ist sein Ergebnis;
-- was ihn ausmacht, steht in der Zeile: welcher Zeitraum, mit welchen
-- Stammdaten, wie viele Zeilen, welche Summen, welcher Pruefwert. Genau danach
-- fragt eine Betriebspruefung — nicht nach der Datei, die auf einem Rechner
-- des Steuerberaters liegt.
--
-- **Die Stammdaten werden EINGEFROREN, nicht verwiesen.** Eine Beraternummer
-- aendert sich, wenn das Buero wechselt. Zeigte der Vorgang nur auf
-- `datev_konfiguration`, saehe ein drei Jahre alter Export danach aus, als
-- waere er mit der neuen Nummer erzeugt worden — und die Datei beim
-- Steuerberater traegt die alte. Dieselbe Ueberlegung wie beim
-- Rechnungs-Snapshot (K-12).

create type datev_export_status as enum ('erzeugt', 'uebergeben', 'verworfen');

comment on type datev_export_status is
  'ACC-02. erzeugt = die Datei liegt. uebergeben = ein MENSCH hat sie dem '
  'Steuerberater gegeben und das hier vermerkt — es gibt keine Uebertragung '
  'und keine wird vorgetaeuscht. verworfen = die Datei war falsch; die Zeile '
  'bleibt, weil eine geloeschte Zeile eine Luecke waere.';

create table datev_export (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /** Der Zeitraum. Berliner Kalendertage (K-11), Grenzen eingeschlossen. */
  von                   date not null,
  bis                   date not null,

  status                datev_export_status not null default 'erzeugt',

  -- -------------------------------------------------------------------------
  -- Die eingefrorenen Stammdaten (§9.3, O-05)
  -- -------------------------------------------------------------------------
  berater_nummer        text not null check (berater_nummer ~ '^[0-9]{4,7}$'),
  mandanten_nummer      text not null check (mandanten_nummer ~ '^[0-9]{1,5}$'),
  kontenrahmen          kontenrahmen not null,
  sachkontenlaenge      integer not null check (sachkontenlaenge between 4 and 8),
  wj_beginn_monat       smallint not null check (wj_beginn_monat between 1 and 12),
  wj_beginn_tag         smallint not null check (wj_beginn_tag between 1 and 31),
  versteuerungsart      versteuerungsart not null,
  extf_version          text not null check (extf_version ~ '^[0-9]{3}$'),
  festschreibung        boolean not null,

  -- -------------------------------------------------------------------------
  -- Was in der Datei steht — als Zahl, nicht als Behauptung
  -- -------------------------------------------------------------------------
  zeilen                integer not null check (zeilen >= 0),
  summe_soll_cent       bigint not null,
  summe_haben_cent      bigint not null,

  /** SHA-256 der ERZEUGTEN BYTES. Der Rueckweg zur Datei (Abnahme 3). */
  datei_sha256          text check (datei_sha256 ~ '^[0-9a-f]{64}$'),
  /** Das abgelegte Dokument. NULL, solange kein Speicher verbunden ist. */
  dokument_id           uuid,

  /**
   * **⚑ Das Format ist spezifikationsabgeleitet, nicht kundengeprueft.**
   *
   * Steht auf JEDER Zeile und nicht in einer Einstellung: wer in drei Jahren
   * eine alte Exportzeile ansieht, muss erkennen, ob sie aus der Zeit vor der
   * Musterdatei stammt. Eine globale Fahne saehe rueckwirkend anders aus.
   */
  format_ungeprueft     boolean not null default true,

  uebergeben_am         timestamptz,
  uebergeben_notiz      text,
  verworfen_am          timestamptz,
  verwerfungsgrund      text,

  aufbewahrung_klasse   text not null default 'buchungsbeleg',
  aufbewahrung_bis      date,
  loeschsperre          boolean not null default true,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint datev_export_mandant_uk unique (mandant_id, id),
  constraint datev_export_spanne check (bis >= von),
  constraint datev_export_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  /** Eine Buchung geht auf — also auch ihr Stapel. */
  constraint datev_export_geht_auf check (summe_soll_cent = summe_haben_cent),

  constraint datev_export_status_stimmig check (
        (status = 'erzeugt'    and uebergeben_am is null and verworfen_am is null)
     or (status = 'uebergeben' and uebergeben_am is not null and verworfen_am is null)
     or (status = 'verworfen'  and verworfen_am is not null
         and verwerfungsgrund is not null and length(btrim(verwerfungsgrund)) >= 5)),

  constraint datev_export_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id)
);

comment on table datev_export is
  'ACC-02. Ein erzeugter Buchungsstapel mit den Stammdaten, die zu SEINEM '
  'Zeitpunkt galten. Es gibt keine Uebertragung an DATEV und es wird keine '
  'vorgetaeuscht: uebergeben setzt ein Mensch.';

create index datev_export_zeitraum_idx on datev_export (mandant_id, von desc, bis desc);

-- ---------------------------------------------------------------------------
-- Die beiden Fremdschluessel, die 0127 angekuendigt hat
-- ---------------------------------------------------------------------------

/**
 * `periode_export_noch_leer` hat die Spalte leer gehalten, bis es eine
 * Elterntabelle gab. Jetzt gibt es eine; der Platzhalter geht, der echte
 * Fremdschluessel kommt. Beide zugleich stehen zu lassen hiesse, dass die
 * Spalte fuer immer NULL bleibt und der Fremdschluessel nie greift.
 */
alter table periode drop constraint periode_export_noch_leer;

alter table periode add constraint periode_datev_export_fk
  foreign key (mandant_id, datev_export_id) references datev_export (mandant_id, id);

alter table buchungssatz add constraint bs_datev_export_fk
  foreign key (mandant_id, datev_export_id) references datev_export (mandant_id, id);

create index bs_datev_export_idx on buchungssatz (mandant_id, datev_export_id)
  where datev_export_id is not null;

-- ---------------------------------------------------------------------------
-- Unveraenderlichkeit
-- ---------------------------------------------------------------------------

/**
 * Ein erzeugter Stapel aendert sich nicht mehr.
 *
 * Was sich aendern darf, ist der ZUSTAND — uebergeben, verworfen — und die
 * Ablage des Dokuments, die nachtraeglich erfolgt, wenn der Speicher wieder
 * antwortet. Alles andere ist die Aussage, welche Datei mit welchen Summen den
 * Betrieb verlassen hat; sie zu korrigieren hiesse, eine zweite Wahrheit
 * darueber anzulegen.
 */
create function fin.datev_export_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus text[] := array[
    'status', 'uebergeben_am', 'uebergeben_notiz', 'verworfen_am',
    'verwerfungsgrund', 'dokument_id', 'datei_sha256',
    'aufbewahrung_bis', 'loeschsperre',
    'geaendert_am', 'geaendert_von', 'geaendert_von_art'];
begin
  if (to_jsonb(old) - v_aus) = (to_jsonb(new) - v_aus) then return new; end if;
  raise exception
    'DATEV-Export %: der erzeugte Stapel ist unveraenderlich (GoBD, ACC-02).', old.id
    using errcode = 'restrict_violation',
          hint = 'Ein falscher Stapel wird VERWORFEN und neu erzeugt, nie umgeschrieben.';
end $$;

create trigger datev_export_unveraenderlich
  before update on datev_export
  for each row execute function fin.datev_export_unveraenderlich();

create trigger datev_export_geaendert
  before update on datev_export
  for each row execute function kern.setze_geaendert_am();

create trigger datev_export_aufbewahrung
  before insert or update on datev_export
  for each row execute function fin.aufbewahrung_aus_klasse('bis');

-- ---------------------------------------------------------------------------
-- RLS und Rechte (K-03, K-04, D-388)
-- ---------------------------------------------------------------------------

alter table datev_export enable row level security;
alter table datev_export force  row level security;

/**
 * **Lesen `buchhaltung.lesen`, schreiben `buchhaltung.exportieren`.**
 *
 * Die beiden auseinanderzuhalten ist hier keine Feinheit: wer das Hauptbuch
 * liest, erzeugt damit noch keine Datei, die das Haus verlaesst. Der Katalog
 * fuehrt `buchhaltung.exportieren` seit 0008 genau dafuer und bindet es an
 * `super_admin` und `admin`.
 *
 * **Keine Gruppendecke.** Ein Stapel gehoert genau einer Gesellschaft, und
 * die Gruppenansicht erzeugt keinen (Invariante 10) — der `with check` haelt
 * das ueber `app.ist_readonly()` zusaetzlich fest. Lesend waere eine
 * Gruppensicht denkbar; sie kommt, wenn eine Seite sie braucht, und nicht
 * vorsorglich.
 */
create policy t_mandant on datev_export for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('buchhaltung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('buchhaltung.exportieren', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy p_intern_ceiling on datev_export as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

grant select, insert, update on datev_export to cse_app;

-- ---------------------------------------------------------------------------
-- Die Stammdaten pruefen — vor der Datei, nicht danach
-- ---------------------------------------------------------------------------

/**
 * **Es entsteht keine halbrichtige Datei.**
 *
 * Solange `datev_konfiguration.ist_platzhalter` steht oder ein Pflichtfeld
 * fehlt, verweigert diese Funktion — und nennt jedes fehlende Feld auf
 * Deutsch. Der Knopf im Portal ist dann aus; diese Pruefung ist die zweite
 * Linie, denn ein ausgegrauter Knopf ist eine Bitte und kein Riegel.
 *
 * Gibt die Stammdaten ZURUECK, statt sie nur zu pruefen: der Aufrufer friert
 * genau die Werte ein, gegen die geprueft wurde. Zwei getrennte Schritte
 * — erst pruefen, dann lesen — liessen dazwischen eine Aenderung zu.
 */
create function app.datev_stammdaten(p_mandant uuid) returns table (
  berater_nummer text, mandanten_nummer text, kontenrahmen kontenrahmen,
  sachkontenlaenge integer, wj_beginn_monat smallint, wj_beginn_tag smallint,
  versteuerungsart versteuerungsart, extf_version text, festschreibung boolean
)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  k public.datev_konfiguration%rowtype;
  v_fehlend text[] := '{}';
begin
  if not app.hat_recht('buchhaltung.lesen', p_mandant) then
    raise exception 'buchhaltung.lesen fehlt' using errcode = '42501';
  end if;

  select * into k from public.datev_konfiguration where mandant_id = p_mandant;
  if not found then
    raise exception
      'Fuer diese Gesellschaft sind keine DATEV-Stammdaten hinterlegt (O-05).'
      using errcode = 'check_violation',
            hint = 'Portal → Buchhaltung → DATEV → Stammdaten.';
  end if;

  if k.berater_nummer   is null then v_fehlend := v_fehlend || 'Beraternummer'::text; end if;
  if k.mandanten_nummer is null then v_fehlend := v_fehlend || 'Mandantennummer'::text; end if;
  if k.kontenrahmen     is null then v_fehlend := v_fehlend || 'Kontenrahmen'::text; end if;
  if k.sachkontenlaenge is null then v_fehlend := v_fehlend || 'Sachkontenlaenge'::text; end if;
  if k.wj_beginn_monat  is null then v_fehlend := v_fehlend || 'Wirtschaftsjahr-Beginn (Monat)'::text; end if;
  if k.wj_beginn_tag    is null then v_fehlend := v_fehlend || 'Wirtschaftsjahr-Beginn (Tag)'::text; end if;
  if k.versteuerungsart is null then v_fehlend := v_fehlend || 'Versteuerungsart'::text; end if;
  if k.extf_version     is null then v_fehlend := v_fehlend || 'EXTF-Fassung'::text; end if;

  if array_length(v_fehlend, 1) is not null then
    raise exception
      'Die DATEV-Stammdaten sind unvollstaendig: %. Es entsteht keine Datei.',
      array_to_string(v_fehlend, ', ')
      using errcode = 'check_violation',
            hint = 'Eine Exportdatei mit leerer Beraternummer wird vom '
                   'Steuerberater abgewiesen, nachdem er sie eingelesen hat (O-05).';
  end if;

  if k.ist_platzhalter then
    raise exception
      'Die DATEV-Stammdaten stehen als PLATZHALTER (O-05). Es entsteht keine Datei.'
      using errcode = 'check_violation',
            hint = 'Erst bestaetigen (Portal → Buchhaltung → DATEV), dann exportieren.';
  end if;

  return query select k.berater_nummer, k.mandanten_nummer, k.kontenrahmen,
                      k.sachkontenlaenge, k.wj_beginn_monat, k.wj_beginn_tag,
                      k.versteuerungsart, k.extf_version, k.festschreibung_standard;
end $$;

alter function app.datev_stammdaten(uuid) owner to cse_definer;
revoke all on function app.datev_stammdaten(uuid) from public;
grant execute on function app.datev_stammdaten(uuid) to cse_app;

/** Was der Definer dafuer liest (K-05, D-388). */
grant select on datev_konfiguration to cse_definer;
create policy d_datev_konfiguration on datev_konfiguration for select to cse_definer
  using (true);

-- ---------------------------------------------------------------------------
-- Die Zeilen an den Stapel binden
-- ---------------------------------------------------------------------------

/**
 * Stempelt die exportierten Zeilen mit ihrem Stapel.
 *
 * **Nur Zeilen, die noch keinen tragen.** Eine Zeile zweimal zu exportieren
 * waere ein doppelter Umsatz beim Steuerberater; das `where` sorgt dafuer,
 * dass ein zweiter Lauf ueber denselben Zeitraum null Zeilen findet und der
 * Aufrufer das an der Zahl merkt.
 *
 * `datev_export_id` steht in der Ausnahmeliste von
 * `fin.buchungssatz_unveraenderlich` (0127) — der Stempel darf deshalb auch
 * auf einer festgeschriebenen Zeile gesetzt werden. Genau dafuer steht er
 * dort.
 */
create function app.datev_zeilen_stempeln(
  p_mandant uuid, p_export uuid, p_von date, p_bis date
) returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_zeilen integer;
begin
  if not app.hat_recht('buchhaltung.exportieren', p_mandant) then
    raise exception 'buchhaltung.exportieren fehlt' using errcode = '42501';
  end if;
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht exportiert nicht (Invariante 10).'
      using errcode = '42501';
  end if;

  update public.buchungssatz
     set datev_export_id = p_export
   where mandant_id = p_mandant
     and belegdatum between p_von and p_bis
     and datev_export_id is null;
  get diagnostics v_zeilen = row_count;
  return v_zeilen;
end $$;

alter function app.datev_zeilen_stempeln(uuid, uuid, date, date) owner to cse_definer;
revoke all on function app.datev_zeilen_stempeln(uuid, uuid, date, date) from public;
grant execute on function app.datev_zeilen_stempeln(uuid, uuid, date, date) to cse_app;

grant update (datev_export_id) on buchungssatz to cse_definer;


-- ---------------------------------------------------------------------------
-- Derselbe Fehler eine Datei frueher: `text[] || text` ohne Cast
-- ---------------------------------------------------------------------------

/**
 * **Der Befund.** `fin.datev_konfiguration_vollstaendig` (0126) baut seine
 * Liste fehlender Felder mit `v_fehlend := v_fehlend || 'Beraternummer';`.
 * Postgres kann das auf zwei Arten lesen — `anyarray || anyelement` und
 * `anyarray || anyarray` — und entscheidet sich beim unqualifizierten
 * Stringliteral fuer die zweite. Es versucht dann, `'Beraternummer'` als
 * Array-Literal zu parsen, und wirft `malformed array literal`.
 *
 * **Warum es nie auffiel.** Der Ausloeser erreicht die Zeile nur, wenn
 * jemand `ist_platzhalter` auf false setzt UND ein Feld fehlt. Genau dann
 * bekam er statt der hilfreichen Liste einen Parserfehler — im einzigen
 * Moment, in dem die Meldung gebraucht wird. Ein Test hat es hier zum ersten
 * Mal ausgeloest.
 *
 * Der Rumpf ist im Uebrigen woertlich der aus 0126, mit `::text` an acht
 * Stellen.
 */
create or replace function fin.datev_konfiguration_vollstaendig() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_fehlend text[] := '{}';
begin
  if new.ist_platzhalter or new.ist_platzhalter = old.ist_platzhalter then
    return new;
  end if;

  if new.berater_nummer   is null then v_fehlend := v_fehlend || 'Beraternummer'::text; end if;
  if new.mandanten_nummer is null then v_fehlend := v_fehlend || 'Mandantennummer'::text; end if;
  if new.kontenrahmen     is null then v_fehlend := v_fehlend || 'Kontenrahmen'::text; end if;
  if new.sachkontenlaenge is null then v_fehlend := v_fehlend || 'Sachkontenlaenge'::text; end if;
  if new.wj_beginn_monat  is null then v_fehlend := v_fehlend || 'Wirtschaftsjahr-Beginn (Monat)'::text; end if;
  if new.wj_beginn_tag    is null then v_fehlend := v_fehlend || 'Wirtschaftsjahr-Beginn (Tag)'::text; end if;
  if new.versteuerungsart is null then v_fehlend := v_fehlend || 'Versteuerungsart'::text; end if;
  if new.extf_version     is null then v_fehlend := v_fehlend || 'EXTF-Fassung'::text; end if;

  if array_length(v_fehlend, 1) is not null then
    raise exception 'Die DATEV-Stammdaten sind unvollstaendig: %', array_to_string(v_fehlend, ', ')
      using errcode = 'check_violation',
            hint = 'Erst eintragen, dann bestaetigen — ein Export mit leeren Stammdaten (O-05) wird abgewiesen.';
  end if;
  return new;
end $$;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0133)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- datev_export (archiv): ACC-02, ACC-06, LEG-01, GoBD. Der Exportvorgang bezeugt, WELCHE Zeilen mit welchen Summen und welchen Stammdaten das Haus verlassen haben. Ihn zu loeschen liesse die gestempelten Buchungszeilen auf einen Stapel zeigen, den es nicht mehr gibt — und die Frage, was der Steuerberater bekommen hat, waere nicht mehr zu beantworten. Ein falscher Stapel wird VERWORFEN und neu erzeugt; die Zeile bleibt.
create trigger trg_datev_export_kein_hard_delete
  before delete on datev_export
  for each row execute function kern.verhindere_loeschung();
create trigger trg_datev_export_kein_truncate
  before truncate on datev_export
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on datev_export from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
