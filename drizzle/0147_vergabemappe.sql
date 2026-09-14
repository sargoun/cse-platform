-- 0147 · Die Vergabemappe — was vor der Frist hochgeladen sein muss, und der
--        Beweis, dass ein MENSCH es hochgeladen hat (RAD-07, D-07, REP-06)
--
-- **Warum diese Tabellen und nicht ein Textfeld am Vorgang.** Eine deutsche
-- Ausschreibung verlangt nicht „Unterlagen", sondern benannte Formblätter:
-- Eigenerklärung zur Eignung, Verzeichnis der Nachunternehmer, Referenzen,
-- Preisblatt, Tariftreueerklärung. Fehlt EINES davon am Abgabetag, wird das
-- Angebot nach § 57 VgV ausgeschlossen, ohne dass jemand den Preis ansieht.
-- Eine Liste mit Zeilen kann zählen, was fehlt; ein Freitextfeld kann es
-- nicht — und genau dieses Zählen ist der ganze Zweck der Mappe.
--
-- **D-07 steht in der Datenbank, nicht nur im Text.** Die Plattform reicht
-- nichts ein: `eingereicht_am` ohne `eingereicht_von` ist per CHECK unmöglich,
-- und `cse_app` hat auf den Einreichungsspalten ÜBERHAUPT KEIN Schreibrecht —
-- der einzige Weg dorthin ist `app.mappe_einreichung_erfassen`, die den
-- Menschen aus der Sitzung nimmt und nicht aus dem Formular. Damit kann auch
-- kein Agent und kein Fehlgriff behaupten, es sei abgegeben worden.
--
-- **`ausschreibung_dokument` kommt hier dazu**, weil die Prüfliste aus den
-- Vergabeunterlagen kommt: eine Position soll sagen können, WOHER die
-- Forderung stammt (welches Dokument, welche Seite). Die Tabelle hält nur die
-- öffentlichen Angaben der Quelle — Bezeichnung und Adresse. Heruntergeladen
-- wird nichts: das ist `ausschreibung_dokument_abruf` und braucht den
-- Abrufweg, den dieser Zweig nicht öffnet.

-- ---------------------------------------------------------------------------
-- (1) Die Dokumente, die mit der Bekanntmachung veröffentlicht wurden
-- ---------------------------------------------------------------------------

/**
 * Eine Referenztabelle wie `ausschreibung` selbst — ohne `mandant_id`.
 *
 * Dieselbe Vergabeunterlage gilt für alle vier Gesellschaften; sie viermal zu
 * führen hiesse, dieselbe Adresse viermal zu korrigieren. Was je Gesellschaft
 * verschieden ist — ob sie das Dokument geholt, gespeichert und ausgewertet
 * hat — gehört in `ausschreibung_dokument_abruf` und kommt mit dem Abrufweg.
 */
create table ausschreibung_dokument (
  id               uuid primary key default gen_random_uuid(),
  ausschreibung_id uuid not null references ausschreibung(id),

  bezeichnung      text not null check (length(btrim(bezeichnung)) > 0),
  quell_url        text,
  dateiname        text,
  mime_typ         text,
  groesse_bytes    bigint check (groesse_bytes is null or groesse_bytes > 0),
  /** SHA-256 — ein erneuter Abruf derselben Datei ist dann ein Nichts. */
  datei_hash       text,
  seiten_anzahl    integer check (seiten_anzahl is null or seiten_anzahl > 0),
  /**
   * Die Plattform verlangt eine Anmeldung. Das ist der unmittelbarste Beleg
   * für RAD-09: wer hier nicht registriert ist, kommt an die Unterlagen gar
   * nicht heran — und merkt es sonst am Abgabetag.
   */
  zugriff_gesperrt boolean not null default false,

  sprache          text,
  veroeffentlicht_am timestamptz,
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz
);

/**
 * Ohne Adresse ist ein Dokument nicht unterscheidbar — zwei Zeilen „Anlage 1"
 * ohne URL wären zwei Zeilen oder eine, je nach Laune des Einlesers. Deshalb
 * trägt der Schlüssel `coalesce(quell_url, bezeichnung)`: mit Adresse gilt
 * die Adresse, ohne Adresse der Name.
 */
create unique index ad_uk on ausschreibung_dokument
  (ausschreibung_id, coalesce(quell_url, bezeichnung));
create index ad_gesperrt_idx on ausschreibung_dokument (ausschreibung_id)
  where zugriff_gesperrt;

comment on table ausschreibung_dokument is
  'RAD-01, RAD-09, DOC-06. Ein mit der Bekanntmachung veroeffentlichtes Dokument — nur die '
  'oeffentlichen Angaben. Der Abruf je Gesellschaft ist eine andere Tabelle.';
comment on column ausschreibung_dokument.zugriff_gesperrt is
  'Die Quelle sagt, dass eine Anmeldung noetig ist — der direkte Beleg fuer RAD-09.';

create trigger trg_ad_geaendert before update on ausschreibung_dokument
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- (2) Die Mappe und ihre Zeilen
-- ---------------------------------------------------------------------------

create type vergabemappe_status as enum
  ('offen', 'in_arbeit', 'vollstaendig', 'freigegeben', 'eingereicht', 'verworfen');

comment on type vergabemappe_status is
  'RAD-07. offen → in_arbeit → vollstaendig → freigegeben → eingereicht; verworfen jederzeit.';

create type mappe_position_status as enum
  ('offen', 'vorhanden', 'geprueft', 'nicht_zutreffend');

comment on type mappe_position_status is
  'RAD-07. vorhanden = die Datei liegt bei; geprueft = ein Mensch hat bestaetigt, dass es die '
  'richtige ist; nicht_zutreffend = die Forderung gilt fuer uns nicht (mit Begruendung).';

create table vergabemappe (
  id                      uuid primary key default gen_random_uuid(),
  mandant_id              uuid not null references mandant(id),

  ausschreibung_vorgang_id uuid not null,

  status                  vergabemappe_status not null default 'offen',

  /** Gepflegt von `trg_mappe_zaehler` — von Hand schreibt sie niemand. */
  pflichtpositionen_gesamt   integer not null default 0 check (pflichtpositionen_gesamt >= 0),
  pflichtpositionen_erledigt integer not null default 0 check (pflichtpositionen_erledigt >= 0),

  /** „Was fehlt" im Klartext — der eigentliche Beitrag eines Agenten (D-07). */
  luecken_hinweis         text,

  freigegeben_von         uuid references benutzer(id),
  freigegeben_am          timestamptz,

  export_dokument_id      uuid,
  exportiert_am           timestamptz,

  /**
   * Die drei Einreichungsspalten. `cse_app` darf sie NICHT schreiben — siehe
   * den Spaltenschnitt weiter unten. Der Weg ist `app.mappe_einreichung_erfassen`.
   */
  eingereicht_von         uuid references benutzer(id),
  eingereicht_am          timestamptz,
  einreichung_beleg_dokument_id uuid,
  /**
   * **Über welche Plattform.** Die Seitenkarte verlangt für `eingereicht` drei
   * Angaben: den Menschen, den Zeitpunkt und die benutzte Plattform. Der
   * Plattformkatalog ist aber mit Absicht leer (O-07) — ein Pflicht-
   * fremdschlüssel machte das Erfassen also unmöglich. Deshalb beides: der
   * Verweis, wenn die Plattform im Katalog steht, sonst ihr Name im Klartext.
   * Eines von beiden muss stehen, sobald eingereicht ist.
   */
  eingereicht_ueber_plattform_id uuid references vergabeplattform(id),
  eingereicht_ueber_text  text,
  /** Das Aktenzeichen der Plattform aus der Eingangsbestaetigung. */
  einreichung_kennzeichen text,

  erstellt_von_art        akteur_art not null default 'mensch',
  erstellt_von            uuid references benutzer(id),
  erstellt_von_agent_id   uuid,
  erstellt_am             timestamptz not null default now(),
  geaendert_am            timestamptz,
  geaendert_von           uuid references benutzer(id),
  geloescht_am            timestamptz,
  geloescht_von           uuid references benutzer(id),

  constraint vm_mandant_uk unique (mandant_id, id),
  constraint vm_vorgang_fk foreign key (mandant_id, ausschreibung_vorgang_id)
    references ausschreibung_vorgang (mandant_id, id),
  constraint vm_export_dokument_fk foreign key (mandant_id, export_dokument_id)
    references dokument (mandant_id, id),
  constraint vm_beleg_dokument_fk foreign key (mandant_id, einreichung_beleg_dokument_id)
    references dokument (mandant_id, id),

  /**
   * **D-07 als Zusicherung der Datenbank.** Ein Einreichungszeitpunkt ohne
   * den Menschen daneben gibt es nicht — die Plattform reicht nichts ein und
   * kann es auch nicht behaupten.
   */
  constraint vm_einreichung_hat_menschen check (
    eingereicht_am is null or eingereicht_von is not null),
  constraint vm_einreichung_nennt_plattform check (
    eingereicht_am is null
    or eingereicht_ueber_plattform_id is not null
    or (eingereicht_ueber_text is not null and length(btrim(eingereicht_ueber_text)) > 0)),
  constraint vm_freigabe_vollstaendig check (
    status <> 'freigegeben' or (freigegeben_von is not null and freigegeben_am is not null)),
  constraint vm_eingereicht_datiert check (
    status <> 'eingereicht' or eingereicht_am is not null),
  constraint vm_export_datiert check (
    (export_dokument_id is null) = (exportiert_am is null)),
  constraint vm_erledigt_hoechstens_gesamt check (
    pflichtpositionen_erledigt <= pflichtpositionen_gesamt)
);

create unique index vm_uk on vergabemappe (mandant_id, ausschreibung_vorgang_id)
  where geloescht_am is null;
create index vm_status_idx on vergabemappe (mandant_id, status);

comment on table vergabemappe is
  'RAD-07, D-07, AGT-01. Die Bietermappe eines Vorgangs: was vor der Frist hochgeladen sein '
  'muss, und der Beleg, dass ein Mensch es getan hat.';
comment on column vergabemappe.pflichtpositionen_erledigt is
  'Pflichtzeilen in geprueft ODER nicht_zutreffend. vorhanden zaehlt NICHT: eine beigelegte, '
  'aber ungeprueefte Datei ist der haeufigste Ausschlussgrund (D-492).';

create trigger trg_vm_geaendert before update on vergabemappe
  for each row execute function kern.setze_geaendert_am();
/* Die Loeschsperre setzt der Generator aus `rls.ts` — siehe den Block am Ende. */

-- ---------------------------------------------------------------------------

create table vergabemappe_position (
  id               uuid primary key default gen_random_uuid(),
  mandant_id       uuid not null references mandant(id),
  vergabemappe_id  uuid not null,

  position         integer not null check (position > 0),
  bezeichnung      text not null check (length(btrim(bezeichnung)) > 0),
  /**
   * **Mit Absicht `text` und kein Enum.** Welche Unterlagen je Plattform und
   * Verfahrensart gefordert sind, steht in keiner Liste, die wir hätten —
   * ein Enum aus fünf geratenen Werten wäre eine erfundene Regel mit
   * Datenbankgewalt dahinter.
   */
  -- TODO(client) [O-194]: Katalog der geforderten Unterlagen je Plattform und Verfahrensart
  kategorie        text,
  pflicht          boolean not null default true,
  status           mappe_position_status not null default 'offen',

  dokument_id      uuid,
  /** Woher die Forderung stammt: welches Dokument, welche Seite. */
  quelle_ausschreibung_dokument_id uuid references ausschreibung_dokument(id),
  quelle_seite     integer check (quelle_seite is null or quelle_seite > 0),
  luecke_hinweis   text,

  geprueft_von     uuid references benutzer(id),
  geprueft_am      timestamptz,

  erstellt_von_art akteur_art not null default 'mensch',
  erstellt_von     uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_am      timestamptz not null default now(),
  geaendert_am     timestamptz,
  geaendert_von    uuid references benutzer(id),

  constraint vmp_mandant_uk unique (mandant_id, id),
  constraint vmp_mappe_fk foreign key (mandant_id, vergabemappe_id)
    references vergabemappe (mandant_id, id),
  constraint vmp_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),

  constraint vmp_beigelegt_hat_datei check (
    status not in ('vorhanden', 'geprueft') or dokument_id is not null),
  /** Nur ein Mensch prüft — und er steht mit Namen daneben. */
  constraint vmp_geprueft_hat_pruefer check (
    status <> 'geprueft' or (geprueft_von is not null and geprueft_am is not null)),
  /** „Gilt für uns nicht" ohne Begründung ist eine Lücke mit Haken davor. */
  constraint vmp_nicht_zutreffend_begruendet check (
    status <> 'nicht_zutreffend'
    or (luecke_hinweis is not null and length(btrim(luecke_hinweis)) >= 5))
);

/**
 * `deferrable initially deferred`, damit sich Zeilen innerhalb EINER
 * Transaktion umsortieren lassen — ohne das müsste jede Umstellung über eine
 * Zwischennummer laufen.
 */
alter table vergabemappe_position
  add constraint vmp_position_uk unique (vergabemappe_id, position)
  deferrable initially deferred;

create index vmp_pflicht_idx on vergabemappe_position (vergabemappe_id, status)
  where pflicht;

comment on table vergabemappe_position is
  'RAD-07, D-07. Eine Zeile der Abgabe-Pruefliste: ein gefordertes Formblatt, ein Nachweis '
  'oder ein Preisblatt mit seinem Stand.';

create trigger trg_vmp_geaendert before update on vergabemappe_position
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- (3) Die Zähler — gerechnet, nie getippt
-- ---------------------------------------------------------------------------

/**
 * Anweisungsebene mit Übergangstabellen: eine Mappe mit dreissig Zeilen wird
 * einmal nachgezählt und nicht dreissigmal.
 *
 * **`vorhanden` zählt nicht als erledigt** (D-492). Eine beigelegte, aber von
 * niemandem geprüfte Datei ist der häufigste Ausschlussgrund überhaupt — das
 * falsche Formblatt, die abgelaufene Unbedenklichkeitsbescheinigung, die
 * Referenzliste des Vorjahres. Die Mappe darf „vollständig" erst sagen, wenn
 * ein Mensch hingesehen hat. Die Richtung ist die sichere: sie meldet zu
 * wenig fertig, nie zu viel.
 *
 * `security definer`, weil die Zählerspalten der Anwendungsrolle mit Absicht
 * entzogen sind — sonst könnte eine Mappe sich selbst für vollständig
 * erklären, ohne dass eine einzige Zeile abgehakt ist.
 */
create function app.mappe_zaehler_nachfuehren() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct vergabemappe_id) into v_ids from neu;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct vergabemappe_id) into v_ids from alt;
  else
    select array_agg(distinct m) into v_ids
      from (select vergabemappe_id as m from neu
            union
            select vergabemappe_id from alt) s;
  end if;
  if v_ids is null then return null; end if;

  update public.vergabemappe m
     set pflichtpositionen_gesamt   = z.gesamt,
         pflichtpositionen_erledigt = z.erledigt
    from (
      select k.id,
             count(p.id) filter (where p.pflicht)::integer as gesamt,
             count(p.id) filter (
               where p.pflicht and p.status in ('geprueft', 'nicht_zutreffend')
             )::integer as erledigt
        from unnest(v_ids) as k(id)
        left join public.vergabemappe_position p on p.vergabemappe_id = k.id
       group by k.id
    ) z
   where m.id = z.id
     and (m.pflichtpositionen_gesamt, m.pflichtpositionen_erledigt)
         is distinct from (z.gesamt, z.erledigt);
  return null;
end $$;

comment on function app.mappe_zaehler_nachfuehren() is
  'Haelt pflichtpositionen_gesamt/_erledigt an vergabemappe nach. vorhanden zaehlt NICHT '
  'als erledigt (D-492) — erst geprueft oder nicht_zutreffend.';

alter function app.mappe_zaehler_nachfuehren() owner to cse_definer;
/**
 * **K-08: PUBLIC haelt kein EXECUTE.** Eine Triggerfunktion wird beim
 * Ausloesen nicht auf EXECUTE geprueft — das Recht braucht nur, wer den
 * Trigger ANLEGT. Ein `security definer` ohne Entzug stuende dagegen jedem
 * Aufrufer offen, und dieser hier darf die Zaehlerspalten schreiben, die der
 * Anwendungsrolle mit Absicht entzogen sind.
 */
revoke execute on function app.mappe_zaehler_nachfuehren() from public;

create trigger trg_mappe_zaehler_ins after insert on vergabemappe_position
  referencing new table as neu
  for each statement execute function app.mappe_zaehler_nachfuehren();
create trigger trg_mappe_zaehler_upd after update on vergabemappe_position
  referencing new table as neu old table as alt
  for each statement execute function app.mappe_zaehler_nachfuehren();
create trigger trg_mappe_zaehler_del after delete on vergabemappe_position
  referencing old table as alt
  for each statement execute function app.mappe_zaehler_nachfuehren();

-- ---------------------------------------------------------------------------
-- (4) Eine Unterschrift trägt den Namen dessen, der unterschreibt
-- ---------------------------------------------------------------------------

/**
 * Die Auswahlliste im Formular ist keine Grenze — derselbe Gedanke wie in
 * 0146, eine Stufe schärfer: bei einer Freigabe, einer Prüfung und einer
 * Einreichung reicht „gehört zu dieser Gesellschaft" nicht. Wer unterschreibt,
 * ist die angemeldete Person und niemand sonst; alles andere wäre eine
 * Unterschrift, die jemand für einen Kollegen setzt.
 */
create function kern.unterschrift_ist_die_eigene() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
declare
  v_neu uuid;
  v_alt uuid;
  v_ich uuid;
begin
  execute format('select ($1).%I', tg_argv[0]) into v_neu using new;
  if v_neu is null then return new; end if;
  if tg_op = 'UPDATE' then
    execute format('select ($1).%I', tg_argv[0]) into v_alt using old;
    if v_alt is not distinct from v_neu then return new; end if;
  end if;

  v_ich := app.aktueller_benutzer();
  if v_ich is null then
    raise exception 'Diese Eintragung braucht einen angemeldeten Menschen'
      using errcode = 'check_violation',
            detail  = format('%I.%I wurde ohne Sitzung gesetzt.', tg_table_name, tg_argv[0]),
            hint    = 'Weder Job noch Agent tragen hier einen Namen ein (D-07).';
  end if;
  if v_neu <> v_ich then
    raise exception 'Eine Unterschrift traegt den Namen dessen, der sie leistet'
      using errcode = 'check_violation',
            detail  = format('%I.%I zeigt auf ein anderes Konto als die Sitzung.',
                             tg_table_name, tg_argv[0]),
            hint    = 'Wer freigibt, prueft oder einreicht, muss selbst angemeldet sein.';
  end if;
  return new;
end $$;

create trigger trg_vm_freigabe_eigene before insert or update on vergabemappe
  for each row execute function kern.unterschrift_ist_die_eigene('freigegeben_von');
create trigger trg_vm_einreichung_eigene before insert or update on vergabemappe
  for each row execute function kern.unterschrift_ist_die_eigene('eingereicht_von');
create trigger trg_vmp_pruefer_eigene before insert or update on vergabemappe_position
  for each row execute function kern.unterschrift_ist_die_eigene('geprueft_von');

-- ---------------------------------------------------------------------------
-- (5) Der Vorgang darf nicht weiter sein als seine Mappe
-- ---------------------------------------------------------------------------

/**
 * Zwei Zusagen der Seitenkarte, die bisher nur dort standen:
 * `in_bearbeitung` setzt eine Mappe voraus, `eingereicht` eine eingereichte.
 *
 * Ein Trigger und kein CHECK — ein CHECK darf keine Unterabfrage enthalten.
 * Und `security definer`: die Prüfung liest die Mappe des eigenen Mandanten,
 * darf dabei aber nicht davon abhängen, ob die schreibende Sitzung zufällig
 * auch `vergabe.lesen` hält.
 */
create function app.vorgang_braucht_mappe() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_stand vergabemappe_status;
begin
  if new.status not in ('in_bearbeitung', 'eingereicht') then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;

  select m.status into v_stand
    from public.vergabemappe m
   where m.mandant_id = new.mandant_id
     and m.ausschreibung_vorgang_id = new.id
     and m.geloescht_am is null;

  if v_stand is null then
    raise exception 'Ohne Vergabemappe gibt es kein "in Bearbeitung"'
      using errcode = 'check_violation',
            detail  = 'Der Vorgang hat keine Vergabemappe.',
            hint    = 'Die Mappe wird beim Uebergang nach in_bearbeitung angelegt.';
  end if;
  if new.status = 'eingereicht' and v_stand <> 'eingereicht' then
    raise exception 'Eingereicht wird die Mappe, nicht der Vorgang'
      using errcode = 'check_violation',
            detail  = format('Die Vergabemappe steht auf %s.', v_stand),
            hint    = 'Erst app.mappe_einreichung_erfassen, dann steht der Vorgang nach.';
  end if;
  return new;
end $$;

alter function app.vorgang_braucht_mappe() owner to cse_definer;
/** K-08, wie oben: eine Triggerfunktion braucht kein oeffentliches EXECUTE. */
revoke execute on function app.vorgang_braucht_mappe() from public;

create trigger trg_vorgang_braucht_mappe before insert or update of status
  on ausschreibung_vorgang
  for each row execute function app.vorgang_braucht_mappe();

-- ---------------------------------------------------------------------------
-- (6) Einreichen erfassen — der einzige Weg an die drei Spalten
-- ---------------------------------------------------------------------------

/**
 * **Warum eine Funktion und keine Policy.** RLS ist zeilenweise; das hier ist
 * spaltenweise. `vergabe.schreiben` soll die Mappe füllen dürfen, aber nicht
 * behaupten dürfen, sie sei abgegeben — dafür gibt es ein eigenes Recht
 * (`vergabe.einreichung_erfassen`), und der einzige Weg dorthin ist diese
 * Funktion. Der Anwendungsrolle sind die drei Spalten entzogen.
 *
 * **Der Mensch kommt aus der Sitzung, nicht aus dem Formular.** Deshalb hat
 * die Funktion keinen Parameter dafür. Und der Zeitpunkt kommt aus `now()`
 * der Datenbank (Invariante 5) — ein Gerät, das um zwei Stunden falsch geht,
 * würde sonst eine Abgabe vor der Frist bezeugen, die nach ihr lag.
 *
 * **Sie steuert keine Plattform.** Sie hält fest, was ein Mensch getan hat
 * (D-07). Deshalb nimmt sie die Abgabe auch aus einer unvollständigen Mappe
 * entgegen: wer trotz Lücke abgegeben hat, hat abgegeben — die Lücke bleibt
 * in den Zählern sichtbar. Eine Plattform, die eine Tatsache nicht aufnimmt,
 * weil ihr die Reihenfolge nicht gefällt, wird nebenher in Excel geführt.
 */
create function app.mappe_einreichung_erfassen(
  p_mappe       uuid,
  p_plattform   uuid    default null,
  p_plattform_text text default null,
  p_kennzeichen text    default null,
  p_beleg       uuid    default null
) returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_ich     uuid := app.aktueller_benutzer();
  v_stand   vergabemappe_status;
  v_vorgang uuid;
  v_jetzt   timestamptz;
  v_text    text := nullif(btrim(coalesce(p_plattform_text, '')), '');
begin
  if v_mandant is null or v_ich is null then
    raise insufficient_privilege using message =
      'Eine Einreichung erfasst ein angemeldeter Mensch in einer Gesellschaft.';
  end if;
  if app.portal() <> 'intern' then
    raise insufficient_privilege using message =
      'Die Vergabemappe gehoert ins interne Portal.';
  end if;
  if app.ist_readonly() or not app.hat_recht('vergabe.einreichung_erfassen', v_mandant) then
    raise insufficient_privilege using message =
      'Das Erfassen einer Einreichung braucht vergabe.einreichung_erfassen.';
  end if;
  if p_plattform is null and v_text is null then
    raise exception 'Zu einer Einreichung gehoert die benutzte Plattform'
      using errcode = 'check_violation',
            hint = 'Entweder eine Plattform aus dem Katalog oder ihr Name im Klartext.';
  end if;

  select m.status, m.ausschreibung_vorgang_id into v_stand, v_vorgang
    from public.vergabemappe m
   where m.id = p_mappe and m.mandant_id = v_mandant and m.geloescht_am is null
     for update;

  if v_stand is null then
    -- AUT-06: nicht gefunden, nicht „verboten" — sonst verraet die Antwort, dass es sie gibt.
    raise exception 'Vergabemappe nicht gefunden' using errcode = 'no_data_found';
  end if;
  if v_stand = 'eingereicht' then
    raise exception 'Diese Mappe ist bereits als eingereicht erfasst'
      using errcode = 'check_violation',
            hint = 'Eine zweite Erfassung wuerde die erste ueberschreiben.';
  end if;
  if v_stand = 'verworfen' then
    raise exception 'Eine verworfene Mappe wird nicht eingereicht'
      using errcode = 'check_violation';
  end if;

  v_jetzt := now();

  update public.vergabemappe
     set status = 'eingereicht',
         eingereicht_von = v_ich,
         eingereicht_am  = v_jetzt,
         eingereicht_ueber_plattform_id = p_plattform,
         eingereicht_ueber_text = v_text,
         einreichung_kennzeichen = nullif(btrim(coalesce(p_kennzeichen, '')), ''),
         einreichung_beleg_dokument_id = p_beleg,
         geaendert_am = v_jetzt,
         geaendert_von = v_ich
   where id = p_mappe and mandant_id = v_mandant;

  update public.ausschreibung_vorgang
     set status = 'eingereicht',
         status_geaendert_am = v_jetzt,
         status_geaendert_von = v_ich,
         geaendert_am = v_jetzt,
         geaendert_von = v_ich
   where id = v_vorgang and mandant_id = v_mandant;

  perform app.protokolliere('vergabe.eingereicht', 'vergabemappe', p_mappe::text,
                            jsonb_build_object('status', v_stand),
                            jsonb_build_object('status', 'eingereicht',
                                               'kennzeichen', p_kennzeichen is not null,
                                               'beleg', p_beleg is not null),
                            v_mandant);
  return v_jetzt;
end $$;

comment on function app.mappe_einreichung_erfassen(uuid, uuid, text, text, uuid) is
  'RAD-07, D-07. Haelt fest, dass ein MENSCH eingereicht hat — Person aus der Sitzung, '
  'Zeitpunkt aus der Datenbank. Der einzige Schreibweg auf die Einreichungsspalten.';

alter function app.mappe_einreichung_erfassen(uuid, uuid, text, text, uuid) owner to cse_definer;
revoke execute on function app.mappe_einreichung_erfassen(uuid, uuid, text, text, uuid) from public;
grant execute on function app.mappe_einreichung_erfassen(uuid, uuid, text, text, uuid) to cse_app;

-- ---------------------------------------------------------------------------
-- (7) RLS und Rechte
-- ---------------------------------------------------------------------------

alter table ausschreibung_dokument    enable row level security;
alter table ausschreibung_dokument    force  row level security;
alter table vergabemappe              enable row level security;
alter table vergabemappe              force  row level security;
alter table vergabemappe_position     enable row level security;
alter table vergabemappe_position     force  row level security;

/**
 * Das Dokument einer Bekanntmachung ist so öffentlich wie die Bekanntmachung
 * selbst — dieselben zwei Lesewege wie in 0145/0146: die eigene Gesellschaft
 * unter `radar.lesen`, die Gruppenansicht unter `gruppe.radar.lesen`.
 */
create policy r_dokument_lesen on ausschreibung_dokument for select to cse_app
  using (app.portal() = 'intern'
         and app.aktiver_mandant() is not null
         and app.hat_recht('radar.lesen', app.aktiver_mandant()));
create policy r_dokument_gruppe on ausschreibung_dokument for select to cse_app
  using (app.portal() = 'intern'
         and app.ist_gruppenansicht()
         and cardinality(app.rechte_mandanten('gruppe.radar.lesen')) > 0);
create policy p_intern_ceiling on ausschreibung_dokument as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');
create policy j_ausschreibung_dokument on ausschreibung_dokument for all to cse_job
  using (true) with check (true);

grant select on ausschreibung_dokument to cse_app, cse_job;
grant insert, update on ausschreibung_dokument to cse_job;

/** Die Mappe: lesen unter `vergabe.lesen`, schreiben unter `vergabe.schreiben`. */
create policy t_mappe_lesen on vergabemappe for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('vergabe.lesen', app.aktiver_mandant()));
create policy t_mappe_schreiben on vergabemappe for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('vergabe.schreiben', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('vergabe.schreiben', app.aktiver_mandant()));
create policy t_mappe_gruppe on vergabemappe for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.vergabe.lesen')));
create policy p_intern_ceiling on vergabemappe as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

create policy t_position_lesen on vergabemappe_position for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('vergabe.lesen', app.aktiver_mandant()));
create policy t_position_schreiben on vergabemappe_position for all to cse_app
  using      (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('vergabe.schreiben', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('vergabe.schreiben', app.aktiver_mandant()));
create policy t_position_gruppe on vergabemappe_position for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.vergabe.lesen')));
create policy p_intern_ceiling on vergabemappe_position as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

/**
 * **Der Spaltenschnitt.** `cse_app` bekommt `insert` und `update` NUR auf den
 * Spalten, die ein Mensch mit `vergabe.schreiben` führen darf. Die vier
 * Einreichungsspalten und die beiden Zähler fehlen hier mit Absicht: die
 * Einreichung geht über `app.mappe_einreichung_erfassen`, die Zähler über
 * den Trigger. Ein `update … set eingereicht_am = …` scheitert dann an der
 * Berechtigung und nicht an einer Absprache.
 */
grant select on vergabemappe, vergabemappe_position to cse_app;
grant insert (mandant_id, ausschreibung_vorgang_id, status, luecken_hinweis,
              freigegeben_von, freigegeben_am, export_dokument_id, exportiert_am,
              erstellt_von_art, erstellt_von, erstellt_von_agent_id)
  on vergabemappe to cse_app;
grant update (status, luecken_hinweis, freigegeben_von, freigegeben_am,
              export_dokument_id, exportiert_am, geaendert_am, geaendert_von,
              geloescht_am, geloescht_von)
  on vergabemappe to cse_app;
grant insert, update, delete on vergabemappe_position to cse_app;

/** Der Definer liest die Mappe für `app.vorgang_braucht_mappe` und schreibt
 *  in `app.mappe_einreichung_erfassen`; die Zählerfunktion aktualisiert. */
create policy d_mappe on vergabemappe for all to cse_definer using (true) with check (true);
create policy d_position on vergabemappe_position for select to cse_definer using (true);
create policy d_vorgang_einreichung on ausschreibung_vorgang for all to cse_definer
  using (true) with check (true);
grant select, update on vergabemappe to cse_definer;
grant select on vergabemappe_position to cse_definer;
grant select, update on ausschreibung_vorgang to cse_definer;

/** Der Wächter aus SPEC §14 liest Mappen und Vorgänge. */
create policy j_vergabemappe on vergabemappe for select to cse_job using (true);
create policy j_vergabemappe_position on vergabemappe_position for select to cse_job using (true);
grant select on vergabemappe, vergabemappe_position to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0147)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- vergabemappe (soft): RAD-07, D-07, REP-06. Die Mappe ist der Beleg der Abgabe: Mensch, Zeitpunkt, Plattform, Kennzeichen. Sie zu loeschen nimmt dem Vorgang seinen Nachweis — und dem Bericht „gefunden · geprueft · geboten · gewonnen" seine Grundlage.
create trigger trg_vergabemappe_kein_hard_delete
  before delete on vergabemappe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_vergabemappe_kein_truncate
  before truncate on vergabemappe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on vergabemappe from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
