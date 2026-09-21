-- ===========================================================================
-- 0035 — checkin_token und der sitzungslose Einloesepfad
--        (04-PLANUNG-ZEIT.md §5.5 und §9, K-08, K-09; TIM-07, TIM-08,
--         AUT-06, AUT-07, SEC-A6, SEC-A9, EMP-01, LEG-10)
--
-- Eine Einmal-Inhabermarke, mit der eine eingeteilte Kraft von jedem
-- Telefonbrowser ein- und ausstempelt — ohne App, ohne Anmeldung.
--
-- Vier Entscheidungen, an denen der naheliegende Entwurf still falsch waere:
--
--  1. **Gespeichert wird der HASH, nie die Marke** (§16 Nr. 11). Das Geheimnis
--     existiert nur in der ausgelieferten Adresse. Ein Datenbankabzug — oder
--     ein `select *` in einer Fehlersuche — ermoeglicht damit keinen
--     gefaelschten Check-in. `token_hash` ist `cse_app` zusaetzlich per
--     Spalten-Grant ENTZOGEN: eine Planeransicht braucht ihn nie.
--
--  2. **Einloesen ist EIN bedingter Schreibvorgang** (K-09). Lesen und dann
--     schreiben ist ein Wettlauf, und ein doppelt getipptes Feld auf einer
--     langsamen Verbindung ist kein Randfall: ein doppelter `zeiteintrag` ist
--     doppelt abgerechnete Zeit (FIN-07) und ein doppelter § 17-Nachweis.
--     NULL zurueckgegebene Zeilen SIND die Ablehnung.
--
--  3. **Eine Marke je Bein.** TIM-07 sagt „einmal verwendbar". Eine Marke fuer
--     Ein- und Ausstempeln waere eine Inhaberberechtigung, die die ganze
--     Schicht ueber gilt — und ein weitergeleiteter Link waere im
--     § 17-Nachweis nicht mehr feststellbar. Also `zweck ∈ {checkin,
--     checkout}`, zwei Zeilen.
--
--  4. **Das Gueltigkeitsfenster ist keine Eingabe.** Es wird vom Ausloeser aus
--     dem Fenster der ZUORDNUNG abgeleitet und ueberschreibt, was der Aufrufer
--     schickt. Verschiebt sich die Schicht, wird die alte Marke WIDERRUFEN und
--     eine neue ausgegeben — nicht ihr Fenster nachgezogen: der alte Link ist
--     ein Geheimnis, das das Haus bereits verlassen hat.
-- ===========================================================================

create type token_zweck as enum ('checkin','checkout');

-- ---------------------------------------------------------------------------
-- 1. checkin_token (§5.5)
-- ---------------------------------------------------------------------------

create table checkin_token (
  id            uuid not null default gen_random_uuid(),
  -- Serverseitig aus der Schicht abgeleitet, nie eingereicht.
  mandant_id    uuid not null references mandant(id),

  einsatz_id           uuid not null,
  -- Die Marke bezeichnet GENAU EINEN Menschen auf GENAU EINER Schicht.
  einsatz_zuordnung_id uuid not null,
  -- Denormalisiert, damit das Einloesen mit einem Zeilenzugriff auskommt.
  anstellung_id uuid not null,
  person_id     uuid not null,

  zweck         token_zweck not null,

  /**
   * `encode(digest(token,'sha256'),'hex')`. Das Geheimnis selbst steht
   * nirgends — nicht hier, nicht im Protokoll, nicht im Audit.
   */
  token_hash    text not null,

  -- Vom Ausloeser abgeleitet (§9.3). Nie ein Eingabewert.
  gueltig_ab    timestamptz not null,
  gueltig_bis   timestamptz not null,

  /**
   * Welcher Ausgabeadapter die Marke ausgeliefert hat — geprueft gegen die
   * registrierten Adapter, nie gegen eine erfundene Liste. Ein nicht
   * verbundener Kanal zeigt in der Oberflaeche „nicht verbunden" und sendet
   * nichts (CLAUDE.md: keine Schein-Integrationen).
   * **O-93 ist beantwortet — D-618.** Der Token-Link bleibt fuer jeden OHNE
   * Sitzung (QR am Objekt, Link der Planung); wer im Arbeiterportal
   * angemeldet ist, stempelt ueber die Sitzung, und diese Spalte traegt dann
   * `portal`. `sms` bleibt eine Option fuer den Ausnahmefall und ist ohnehin
   * unverbunden (O-82).
   */
  ausgabe_kanal text not null default 'unverbunden',
  ausgegeben_am timestamptz,

  -- Vom bedingten Schreibvorgang in §9.1 gesetzt. Nur einmal, nur vorwaerts.
  eingeloest_am timestamptz,
  eingeloest_zeiteintrag_id uuid,

  -- Fehlversuche an einer Marke, die es GIBT. Das Durchprobieren unbekannter
  -- Hashes zaehlt `app.versuch_protokollieren`, nicht diese Spalte (§9.2) —
  -- eine Zeile, die es nicht gibt, kann keinen Zaehler erhoehen.
  versuche      integer not null default 0,
  letzter_versuch_am timestamptz,

  widerrufen_am timestamptz,
  widerruf_grund text,

  -- Beim Einloesen aufgezeichnet (SEC-A9). Die kurzlebigsten
  -- personenbezogenen Daten dieser Domaene.
  ip_adresse    inet,
  user_agent    text,

  -- §1.13 / §13: Klasse `checkin_token`.
  -- // TODO(client, O-25): Wie lange bleiben IP und User-Agent einer
  -- eingeloesten Check-in-Marke aufbewahrt?
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  /**
   * Anfuegend: KEINE `geaendert_*`-Spalten. Was sich aendern darf, zaehlt
   * `ct_unveraenderlich` einzeln auf — ein `geaendert_von` daneben behauptete,
   * ein Mensch habe die Marke bearbeitet. Das tut niemand; sie wird
   * eingeloest oder widerrufen.
   */
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,

  primary key (id),
  constraint checkin_token_mandant_uk unique (mandant_id, id),

  constraint ct_einsatz_fk foreign key (mandant_id, einsatz_id)
    references einsatz (mandant_id, id),
  constraint ct_zuordnung_fk foreign key (mandant_id, einsatz_zuordnung_id)
    references einsatz_zuordnung (mandant_id, id),
  constraint ct_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),
  constraint ct_person_fk foreign key (anstellung_id, person_id)
    references anstellung (id, person_id),
  constraint ct_eintrag_fk foreign key (mandant_id, eingeloest_zeiteintrag_id)
    references zeiteintrag (mandant_id, id),

  constraint ct_hash_form check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint ct_fenster check (gueltig_bis > gueltig_ab),
  constraint ct_versuche check (versuche >= 0),
  /**
   * „Eingeloest heisst: es gibt einen Zeiteintrag" steht NICHT hier, sondern
   * als aufgeschobener Bedingungsausloeser weiter unten
   * (`ct_einloesung_paarweise`).
   *
   * Als `CHECK` waere die Regel ein Widerspruch zu K-09: der bedingte
   * Schreibvorgang setzt `eingeloest_am` und erfaehrt die `zeiteintrag`-id
   * erst danach — es ist ja genau die Zeile, die aus dem Rueckgabewert
   * entsteht. Ein `CHECK` schluege in dem Moment dazwischen an, und der
   * einzige Ausweg waere, vorher zu lesen und danach zu schreiben. Das ist der
   * Wettlauf, den K-09 entfernt. `CHECK`-Bedingungen sind in Postgres
   * ausserdem nicht aufschiebbar; ein Bedingungsausloeser ist es.
   */
  constraint ct_widerruf_begruendet check (
    widerrufen_am is null or btrim(coalesce(widerruf_grund,'')) <> ''),
  constraint ct_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * Der EINZIGE Lesepfad beim Einloesen — deshalb ein Index und kein Scan.
 *
 * Ein Praefixscan ueber `token_hash` waere ein Zeitorakel: eine Antwort, die
 * fuer einen fast richtigen Hash messbar laenger braucht, verraet den Hash.
 */
create unique index ct_hash_uk on checkin_token (token_hash);

/**
 * Hoechstens EINE lebende Marke je Zuordnung und Bein — partiell, weil eine
 * neu ausgegebene Marke die vorige widerruft und mit ihr nicht kollidieren
 * darf (§1.12). Ein unbedingter Index machte das Neuausgeben unmoeglich, und
 * zwar als `duplicate key` in dem Moment, in dem jemand eine Kraft auf die
 * Schicht bekommen will.
 */
create unique index ct_live_uk on checkin_token (einsatz_zuordnung_id, zweck)
  where eingeloest_am is null and widerrufen_am is null;

-- „Wer hat einen Link, wer hat ihn benutzt" — die Planeransicht.
create index ct_einsatz_idx on checkin_token (mandant_id, einsatz_id);
-- Der Ablaufkehrer alle 15 Minuten (§14.3).
create index ct_ablauf_idx on checkin_token (gueltig_bis)
  where eingeloest_am is null and widerrufen_am is null;
create index ct_aufbewahrung_idx on checkin_token (aufbewahrung_bis)
  where loeschsperre = false and aufbewahrung_bis is not null;

comment on table checkin_token is
  'Einmal verwendbare Inhabermarke fuer den sitzungslosen Check-in (§5.5, '
  'TIM-07). Gespeichert wird nur der SHA-256-Hash; das Geheimnis lebt in der '
  'ausgelieferten Adresse.';
comment on column checkin_token.token_hash is
  'sha256(token) hexadezimal. cse_app haelt auf dieser Spalte KEIN '
  'Leserecht — eine Planeransicht braucht den Nachschlageschluessel nie.';
comment on column checkin_token.versuche is
  'Fehlversuche an einer EXISTIERENDEN Marke. Das Durchprobieren unbekannter '
  'Hashes zaehlt app.versuch_protokollieren (§9.2).';

-- Der Kreis wird hier geschlossen: 0034 hat die Spalten angelegt, die Marke
-- gab es damals noch nicht.
alter table zeiteintrag add constraint z_checkin_token_fk
  foreign key (mandant_id, checkin_token_id) references checkin_token (mandant_id, id);
alter table zeiteintrag add constraint z_checkout_token_fk
  foreign key (mandant_id, checkout_token_id) references checkin_token (mandant_id, id);

-- ---------------------------------------------------------------------------
-- 2. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `ct_fenster_ableiten` — das Fenster kommt aus der ZUORDNUNG, nicht vom
 * Aufrufer, und ueberschreibt, was er geschickt hat.
 *
 * Check-in-Toleranz **±1 h**: das steht so in TIM-07.
 *
 * Der Check-out-Schwanz steht NICHT in TIM-07. Ihn woertlich auf ±1 h zu
 * setzen erfaende die Betriebsregel, dass jemand, der 90 Minuten laenger
 * bleibt, seinen eigenen Datensatz nicht mehr schliessen darf. Er kommt
 * deshalb aus `zeit.checkout_toleranz_minuten`, ausgeliefert mit 60 Minuten
 * passend zur Check-in-Seite, und der dokumentierte Ausweg beim Ueberschreiten
 * ist eine Planerkorrektur mit `quelle_ende = 'planer_entscheidung'` und einer
 * `zeiteintrag_korrektur`-Zeile.
 * // TODO(client, O-164): Wie lange nach Schichtende soll der Check-out-Link
 * gueltig bleiben — und was passiert, wenn jemand deutlich laenger arbeitet
 * als geplant?
 *
 * ZWEIARGUMENTIGE `app.einstellung`: dieser Ausloeser laeuft in einem
 * mandantenlosen Kontext (Nachtlauf, Definerfunktion), und die einargumentige
 * Form lieferte dort NULL — die Einstellung waere unwirksam, ohne Fehler
 * (01-KERN §3.2).
 */
create function kern.checkin_fenster_ableiten() returns trigger
language plpgsql as $$
declare
  z record;
  v_toleranz_ende integer;
begin
  select ez.beginn_zeitpunkt, ez.ende_zeitpunkt, ez.mandant_id, ez.einsatz_id,
         ez.anstellung_id, ez.person_id, ez.entfernt_am
    into z
    from einsatz_zuordnung ez
   where ez.id = new.einsatz_zuordnung_id;

  if not found then
    raise exception 'Zu dieser Zuordnung gibt es keine Zeile'
      using errcode = 'foreign_key_violation';
  end if;
  if z.entfernt_am is not null then
    raise exception 'Fuer eine zurueckgenommene Einteilung wird keine Marke ausgegeben'
      using errcode = 'check_violation';
  end if;

  -- Mandant, Schicht, Beschaeftigung und Mensch kommen aus der Zuordnung —
  -- nie aus der Anfrage (K-08). Der Aufrufer koennte die Marke sonst in die
  -- Portalsicht eines fremden Mandanten schieben.
  new.mandant_id           := z.mandant_id;
  new.einsatz_id           := z.einsatz_id;
  new.anstellung_id        := z.anstellung_id;
  new.person_id            := z.person_id;

  /**
   * BEIDE Beine beginnen bei `beginn_zeitpunkt - toleranz` (§9.3) — die
   * Ausstempelmarke nicht erst bei Schichtbeginn.
   *
   * Der naheliegende Entwurf waere gewesen, sie erst ab Schichtbeginn gelten
   * zu lassen: „ausstempeln kann nur, wer angefangen hat." Genau das nimmt
   * aber dem, der eine Stunde frueher eingestempelt hat, die Moeglichkeit,
   * auch frueher zu schliessen — und diese Stunde ist die, die TIM-07 mit
   * seiner Toleranz ausdruecklich zulaesst. Der Unterschied zwischen den
   * Beinen liegt am ENDE, nicht am Anfang.
   */
  new.gueltig_ab := z.beginn_zeitpunkt - interval '1 hour';

  if new.zweck = 'checkin' then
    -- TIM-07 woertlich: ±1 h um den Schichtbeginn.
    new.gueltig_bis := z.beginn_zeitpunkt + interval '1 hour';
  else
    v_toleranz_ende := coalesce(
      (app.einstellung(z.mandant_id, 'zeit.checkout_toleranz_minuten'))::integer, 60);
    new.gueltig_bis := z.ende_zeitpunkt + make_interval(mins => v_toleranz_ende);
  end if;
  return new;
end $$;

create trigger trg_checkin_fenster_ableiten
  before insert on checkin_token
  for each row execute function kern.checkin_fenster_ableiten();

/**
 * `ct_unveraenderlich` — eine Positivliste dessen, was sich an einer
 * ausgegebenen Marke noch bewegen darf.
 *
 * `eingeloest_am` geht ausschliesslich von NULL auf einen Wert. Zurueck nicht,
 * und auf einen ANDEREN Wert auch nicht: beides machte aus einer einmal
 * verwendbaren Marke eine mehrfach verwendbare, und zwar ohne dass irgendwo
 * ein Fehler entstuende.
 */
create function kern.checkin_token_unveraenderlich() returns trigger
language plpgsql as $$
declare v_verboten text[] := array[]::text[];
begin
  if new.token_hash is distinct from old.token_hash then
    v_verboten := array_append(v_verboten, 'token_hash');
  end if;
  if new.einsatz_zuordnung_id is distinct from old.einsatz_zuordnung_id then
    v_verboten := array_append(v_verboten, 'einsatz_zuordnung_id');
  end if;
  if new.mandant_id is distinct from old.mandant_id then
    v_verboten := array_append(v_verboten, 'mandant_id');
  end if;
  if new.zweck is distinct from old.zweck then
    v_verboten := array_append(v_verboten, 'zweck');
  end if;
  if new.gueltig_ab is distinct from old.gueltig_ab then
    v_verboten := array_append(v_verboten, 'gueltig_ab');
  end if;
  if new.gueltig_bis is distinct from old.gueltig_bis then
    v_verboten := array_append(v_verboten, 'gueltig_bis');
  end if;
  if array_length(v_verboten, 1) is not null then
    raise exception 'Diese Spalten einer ausgegebenen Marke sind unveraenderlich'
      using errcode = 'check_violation',
            detail  = format('Gesperrt: %s.', array_to_string(v_verboten, ', ')),
            hint    = 'Verschobene Schicht: Marke widerrufen und neu ausgeben (§9.3).';
  end if;

  if old.eingeloest_am is not null and new.eingeloest_am is distinct from old.eingeloest_am then
    raise exception 'Eine eingeloeste Marke wird nicht noch einmal eingeloest'
      using errcode = 'check_violation',
            detail  = 'eingeloest_am geht einmal von NULL auf einen Wert — sonst nie.';
  end if;
  return new;
end $$;

create trigger trg_checkin_token_unveraenderlich
  before update on checkin_token
  for each row execute function kern.checkin_token_unveraenderlich();

/**
 * `ct_einloesung_paarweise` — eine eingeloeste Marke hat ihren Zeiteintrag.
 *
 * **Aufgeschoben bis zum Commit, und das ist der ganze Punkt.** K-09 verlangt,
 * dass EINE bedingte Anweisung entscheidet: `eingeloest_am` wird gesetzt, und
 * erst die Zeile, die daraufhin entsteht, liefert die `zeiteintrag`-id. Eine
 * sofort gepruefte Bedingung schluege genau dazwischen an, und der einzige
 * Ausweg waere, erst zu lesen und dann zu schreiben — der Wettlauf, den K-09
 * entfernt. `CHECK`-Bedingungen lassen sich in Postgres nicht aufschieben, ein
 * `CONSTRAINT TRIGGER` schon.
 *
 * Am Ende der Transaktion muss das Paar stimmen. Eine verbrannte Marke ohne
 * § 17-Nachweis kommt damit nicht durch — weder als Fehler noch, schlimmer,
 * als stiller Erfolg.
 */
/**
 * `security definer`, und zwar zwingend: der Ausloeser feuert beim COMMIT, und
 * zwar unter der Rolle, die die Transaktion gefahren hat. Beim Check-in ist das
 * `cse_checkin` — eine Rolle mit NULL Tabellenrechten (K-01, K-08). Ohne
 * Definer scheiterte jeder Check-in mit „permission denied for table
 * checkin_token", und zwar erst beim Commit, also lange hinter der Stelle, an
 * der jemand den Fehler suchen wuerde.
 */
create function kern.checkin_einloesung_paarweise() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare jetzt record;
begin
  /**
   * Gelesen wird die Zeile NEU, nicht `new` benutzt.
   *
   * Ein aufgeschobener Ausloeser bekommt beim Commit den Satz, wie er zum
   * Zeitpunkt SEINER Anweisung aussah — nicht den endgueltigen. `new` traegt
   * hier also noch den Zwischenstand mit gesetztem `eingeloest_am` und leerer
   * id, und die Pruefung schluege genau auf dem Zustand an, dessen
   * Voruebergehen sie zulassen soll. Ein frischer `select` sieht das Ergebnis
   * der Transaktion.
   */
  select eingeloest_am, eingeloest_zeiteintrag_id into jetzt
    from checkin_token where id = new.id;
  -- Zeile in derselben Transaktion wieder verschwunden: nichts zu pruefen.
  if not found then return null; end if;

  if (jetzt.eingeloest_am is null) <> (jetzt.eingeloest_zeiteintrag_id is null) then
    raise exception 'Eine eingeloeste Marke ohne Zeiteintrag (oder umgekehrt)'
      using errcode = 'check_violation',
            detail  = format('eingeloest_am=%s, eingeloest_zeiteintrag_id=%s',
                             jetzt.eingeloest_am, jetzt.eingeloest_zeiteintrag_id),
            hint    = 'Beides entsteht in derselben Transaktion (§9.1).';
  end if;
  return null;
end $$;

create constraint trigger trg_checkin_einloesung_paarweise
  after insert or update on checkin_token
  deferrable initially deferred
  for each row execute function kern.checkin_einloesung_paarweise();

/**
 * `einsatz_token_nachfuehren` / `ct_widerrufen` — eine verschobene, abgesagte
 * oder entzogene Schicht widerruft ihre lebenden Marken (§9.3, B12).
 *
 * `ct_fenster_ableiten` laeuft nur `BEFORE INSERT`. Ohne diesen Ausloeser
 * truege eine bereits ausgelieferte Marke das Fenster von GESTERN: die Kraft
 * koennte zur echten Zeit nicht stempeln — es entstuende kein § 17-Nachweis
 * und der Waechter „Schicht vorbei, kein Zeiteintrag" schluege fuer eine
 * Schicht an, die gearbeitet wurde — oder eine Marke waere in einem Fenster
 * gueltig, in dem es keine Schicht gibt.
 *
 * WIDERRUF statt Nachfuehren, weil der alte Link ein Inhabergeheimnis ist, das
 * das Haus verlassen hat. Die Neuausgabe ist eine bewusste Handlung.
 */
create function kern.checkin_token_widerrufen() returns trigger
language plpgsql as $$
declare v_grund text;
begin
  if tg_table_name = 'einsatz' then
    if new.storniert_am is not null and old.storniert_am is null then
      v_grund := 'einsatz_storniert';
    elsif new.beginn_zeitpunkt is distinct from old.beginn_zeitpunkt
       or new.ende_zeitpunkt is distinct from old.ende_zeitpunkt then
      v_grund := 'einsatz_verschoben';
    else
      return null;
    end if;

    update checkin_token
       set widerrufen_am = now(), widerruf_grund = v_grund
     where einsatz_id = new.id
       and eingeloest_am is null and widerrufen_am is null;
    return null;
  end if;

  -- einsatz_zuordnung: die Einteilung wurde zurueckgenommen.
  if new.entfernt_am is not null and old.entfernt_am is null then
    update checkin_token
       set widerrufen_am = now(), widerruf_grund = 'zuordnung_entfernt'
     where einsatz_zuordnung_id = new.id
       and eingeloest_am is null and widerrufen_am is null;
  end if;
  return null;
end $$;

create trigger trg_einsatz_token_nachfuehren
  after update of beginn_zeitpunkt, ende_zeitpunkt, storniert_am on einsatz
  for each row execute function kern.checkin_token_widerrufen();

create trigger trg_zuordnung_token_widerrufen
  after update of entfernt_am on einsatz_zuordnung
  for each row execute function kern.checkin_token_widerrufen();

-- ---------------------------------------------------------------------------
-- 3. Zeilenschutz — checkin_token (§5.5)
-- ---------------------------------------------------------------------------

alter table checkin_token enable row level security;
alter table checkin_token force  row level security;

/**
 * NUR lesend fuer `cse_app`, und das ist die ganze Policy.
 *
 * Es gibt hier KEINE `INSERT`-, `UPDATE`- oder `DELETE`-Policy fuer die
 * Anwendung: ausgegeben wird ueber `app.checkin_ausgeben`, eingeloest ueber
 * `app.checkin_verbrauchen` (§9). Ein Planer, der eine Marke von Hand
 * einloesen koennte, waere ein Planer, der eine Anwesenheit erzeugen kann.
 */
create policy t_mandant on checkin_token for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.checkin_verwalten', app.aktiver_mandant())));

/**
 * Weder `t_gruppe` noch `t_person` noch `t_kunde`: der Markenspeicher ist
 * weder eine Gruppenkennzahl noch die Zeile des Arbeitnehmers (EMP-13) noch
 * die des Kunden. Wer seine Marke hat, hat sie in der Hand.
 */
create policy p_ma_decke on checkin_token as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on checkin_token as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Die K-08-Definerpolicy. Der Check-in-Pfad hat keine Sitzung, also ist jede
 * K-03-Policy fuer ihn falsch — ohne diese Zeile liest und schreibt er nichts.
 * Breit gehalten und trotzdem eng: nur `app.checkin_verbrauchen` und
 * `app.checkin_ausgeben` halten `EXECUTE`, und `cse_checkin` hat auf dieser
 * Tabelle kein einziges Tabellenrecht.
 */
create policy ct_definer on checkin_token as permissive for all to cse_definer
  using (true) with check (true);

/**
 * Der Spalten-Grant, der `token_hash` ausspart — und zwar von ANFANG an.
 *
 * Ein `grant select on checkin_token` gefolgt von `revoke ... (token_hash)`
 * bewirkt in Postgres NICHTS: das Tabellenrecht bleibt bestehen. Die Spalte
 * darf deshalb nie Teil des Grants sein.
 */
grant select (id, mandant_id, einsatz_id, einsatz_zuordnung_id, anstellung_id,
              person_id, zweck, gueltig_ab, gueltig_bis, ausgabe_kanal,
              ausgegeben_am, eingeloest_am, eingeloest_zeiteintrag_id, versuche,
              letzter_versuch_am, widerrufen_am, widerruf_grund, ip_adresse,
              user_agent, aufbewahrung_bis, loeschsperre, erstellt_am,
              erstellt_von_art, erstellt_von, erstellt_von_person_id,
              erstellt_von_agent_id)
  on checkin_token to cse_app;
grant select, insert, update on checkin_token to cse_definer;

-- Der Ablaufkehrer widerruft abgelaufene, nicht eingeloeste Marken (§14.3).
create policy t_job on checkin_token for select to cse_job using (true);
create policy t_job_ablauf on checkin_token for update to cse_job using (true) with check (true);
grant select on checkin_token to cse_job;
grant update (widerrufen_am, widerruf_grund, aufbewahrung_bis, loeschsperre)
  on checkin_token to cse_job;

-- ---------------------------------------------------------------------------
-- 4. app.checkin_ausgeben — die Marke entsteht (§5.5)
-- ---------------------------------------------------------------------------

/**
 * Gibt die Marke im KLARTEXT zurueck — genau einmal, an den Aufrufer, der sie
 * ausliefert. Danach gibt es sie nirgends mehr.
 *
 * Sie widerruft zuvor eine noch lebende Marke desselben Beins: der Teilindex
 * `ct_live_uk` liesse die zweite sonst nicht entstehen, und der Planer saehe
 * einen `duplicate key`-Fehler statt eines neuen Links.
 */
create function app.checkin_ausgeben(p_zuordnung uuid, p_zweck token_zweck,
                                     p_kanal text default 'unverbunden')
returns text
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  v_klartext text := encode(gen_random_bytes(32), 'hex');
  v_hash     text := encode(digest(v_klartext, 'sha256'), 'hex');
  z          record;
begin
  select ez.mandant_id, ez.einsatz_id, ez.anstellung_id, ez.person_id,
         ez.beginn_zeitpunkt, ez.ende_zeitpunkt
    into z
    from public.einsatz_zuordnung ez
   where ez.id = p_zuordnung and ez.entfernt_am is null;
  if not found then
    raise exception 'Zu dieser Einteilung gibt es keine lebende Zuordnung'
      using errcode = 'foreign_key_violation';
  end if;

  /**
   * Das Recht wird IM MANDANTEN DER ZUORDNUNG geprueft, nicht im aktiven der
   * Sitzung. Beide sind hier normalerweise gleich — aber diese Funktion laeuft
   * als Definer, also traegt sie ihre Pruefung selbst, und ein Aufrufer mit
   * einem anderen aktiven Mandanten duerfte sonst Marken fuer eine fremde
   * Gesellschaft ausgeben.
   */
  if not app.hat_recht('zeit.checkin_verwalten', z.mandant_id) then
    raise exception 'Kein Recht, Check-in-Marken auszugeben'
      using errcode = 'insufficient_privilege';
  end if;

  update public.checkin_token
     set widerrufen_am = now(), widerruf_grund = 'neu_ausgegeben'
   where einsatz_zuordnung_id = p_zuordnung and zweck = p_zweck
     and eingeloest_am is null and widerrufen_am is null;

  /**
   * Die Werte kommen aus der ZUORDNUNG — obwohl `ct_fenster_ableiten` sie
   * gleich noch einmal aus derselben Zeile setzt. Platzhalter hier
   * einzusetzen und sich auf den Ausloeser zu verlassen waere die Bauart, bei
   * der eine spaeter geaenderte Ausloeserbedingung eine Zeile mit
   * Null-UUIDs stehen laesst — und ein Fremdschluessel auf eine Null-UUID
   * bricht nicht, er findet nur nichts.
   */
  insert into public.checkin_token
        (mandant_id, einsatz_id, einsatz_zuordnung_id, anstellung_id, person_id,
         zweck, token_hash, gueltig_ab, gueltig_bis, ausgabe_kanal,
         erstellt_von_art, erstellt_von)
  values (z.mandant_id, z.einsatz_id, p_zuordnung, z.anstellung_id, z.person_id,
          p_zweck, v_hash, z.beginn_zeitpunkt, z.ende_zeitpunkt, p_kanal,
          case when app.aktueller_benutzer() is null then 'system' else 'mensch' end::akteur_art,
          app.aktueller_benutzer());

  perform app.protokolliere('zeit.checkin_marke_ausgegeben', 'einsatz_zuordnung',
                            p_zuordnung::text, null,
                            jsonb_build_object('zweck', p_zweck::text, 'kanal', p_kanal),
                            z.mandant_id);
  return v_klartext;
end $$;

comment on function app.checkin_ausgeben(uuid, token_zweck, text) is
  'Erzeugt eine Check-in-Marke und gibt sie EINMAL im Klartext zurueck; '
  'gespeichert wird nur ihr SHA-256 (§5.5).';

grant execute on function app.checkin_ausgeben(uuid, token_zweck, text) to cse_app;

-- ---------------------------------------------------------------------------
-- 5. app.checkin_verbrauchen — der eine bedingte Schreibvorgang (§9.1, K-09)
-- ---------------------------------------------------------------------------

/**
 * **Fuenf Argumente, und die Stelligkeit ist Teil des K-08-Registereintrags.**
 *
 * Postgres loest Rechte je exakter Signatur auf. Ein `GRANT EXECUTE` gegen
 * eine dreiargumentige Fassung gelaenge gegen NICHTS, und der Check-in-Endpunkt
 * fiele zur Laufzeit mit „function does not exist" geschlossen — ein Fehler,
 * den kein Schematest findet. `p_user_agent` schreibt
 * `checkin_token.user_agent`, `p_geo` die LEG-10-Erfassung; beide haben keine
 * andere Quelle.
 *
 * Der Rueckgabesatz traegt eine Spalte MEHR als §9.1 auffuehrt:
 * `zeitabweichung_sek`. Die Abweichung wird von der Datenbank abgeleitet
 * (`kern.stempel_feldzeit`), und der sitzungslose Aufrufer kann sie nirgends
 * nachlesen — er haelt keine Sitzung, also trifft er auf `zeiteintrag` keine
 * Policy. Sie hier herauszugeben ist additiv und beruehrt genau das nicht, was
 * K-08 festnagelt: die Argumentliste, gegen die ein Grant aufgeloest wird.
 */
create function app.checkin_verbrauchen(p_token_hash text,
                                        p_geraete_zeit timestamptz,
                                        p_ip inet,
                                        p_user_agent text,
                                        p_geo jsonb default null)
returns table (ergebnis text, zeiteintrag_id uuid, objekt text,
               beginn timestamptz, zeitabweichung_sek integer)
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  t          record;
  v_benutzer uuid;
  v_eintrag  uuid;
  v_geo_an   boolean;
  v_objekt   text;
  v_zeit     timestamptz;
  v_abw      integer;
begin
  /**
   * EINE Anweisung entscheidet. Pruefen und dann schreiben ist ein Wettlauf,
   * und ein doppelt getipptes Feld auf einer langsamen Verbindung ist kein
   * Randfall: ein doppelter `zeiteintrag` ist doppelt abgerechnete Zeit
   * (FIN-07, TIM-12) und ein doppelter § 17 MiLoG-Nachweis (K-09).
   *
   * Getroffen wird auf `token_hash`, nicht auf `id`: der Link der Kraft traegt
   * die Marke, und sie erst ueber die id zu suchen fuehrte genau das Lesen vor
   * dem Schreiben wieder ein, das diese Konvention entfernt.
   */
  update public.checkin_token
     set eingeloest_am = now(), ip_adresse = p_ip, user_agent = p_user_agent
   where token_hash = p_token_hash
     and eingeloest_am is null
     and widerrufen_am is null
     and now() between gueltig_ab and gueltig_bis
  returning * into t;

  if not found then
    /**
     * Null Zeilen SIND die Ablehnung — schon benutzt, widerrufen, abgelaufen,
     * zu frueh oder gar nicht vorhanden. EIN Ergebnis, kein Orakel (AUT-06,
     * §9.2): die Antwort unterscheidet die Faelle nicht, weil eine Antwort,
     * die sie unterscheidet, das Durchprobieren von Marken lohnend macht.
     *
     * Das Mitzaehlen laeuft ueber `app.versuch_protokollieren` und damit ueber
     * IP plus Hash-Praefix: `versuche` auf der Zeile zu erhoehen ginge im
     * wichtigsten Fall gar nicht — beim Durchprobieren gibt es keine Zeile.
     */
    perform app.versuch_protokollieren('checkin:' || left(p_token_hash, 16),
                                       p_ip, false, 'checkin', 'checkin');
    update public.checkin_token
       set versuche = versuche + 1, letzter_versuch_am = now()
     where token_hash = p_token_hash;
    return query select 'abgelehnt'::text, null::uuid, null::text,
                        null::timestamptz, null::integer;
    return;
  end if;

  /**
   * Der Handelnde wird ZUERST aufgeloest, in eine Variable, und sein Fehlen
   * ist ein Fehler.
   *
   * Ihn im INSERT selbst zu suchen hiesse: fehlt die Zeile, schreibt der
   * INSERT gar nichts. Die Marke ist durch den bedingten Schreibvorgang oben
   * aber schon verbrannt, `v_eintrag` bliebe NULL, und die Funktion meldete
   * Erfolg — nachdem sie einen einmal verwendbaren Link zerstoert hat, ohne
   * § 17-Nachweis und ohne Fehler irgendwo. „Jeder freigeschaltete
   * Arbeitszugang hat eine `benutzer`-Zeile" deckt den Fall nicht ab, dass
   * jemandem ein Link VOR der Freischaltung geschickt wurde — und das ist
   * genau eine erste Schicht.
   */
  select b.id into v_benutzer
    from public.benutzer b
   where b.person_id = t.person_id and b.deaktiviert_am is null;
  if not found then
    raise exception 'kein Benutzerkonto fuer diese Person'
      using errcode = 'P0003',
            hint = 'Die Transaktion faellt zurueck, die Marke bleibt benutzbar.';
  end if;

  select o.bezeichnung into v_objekt
    from public.einsatz e join public.objekt o on o.id = e.objekt_id
   where e.id = t.einsatz_id;

  /**
   * LEG-10: Koordinaten werden nur BETRACHTET, wenn der Schalter dieser
   * Gesellschaft an ist (§9.5, O-06). Ist er aus, wird `p_geo` verworfen —
   * nicht durchgereicht und vom Ausloeser abgewiesen. Sonst scheiterte ein
   * voellig rechtmaessiger Check-in daran, dass das Telefon ungefragt einen
   * Ort mitgeschickt hat. Der Ausloeser `z_geo_gate` bleibt trotzdem: er ist
   * die bauliche Zusicherung, dass auf keinem ANDEREN Weg ein Punkt entsteht.
   */
  v_geo_an := coalesce((app.einstellung(t.mandant_id, 'zeit.geolokalisierung'))::boolean, false);

  if t.zweck = 'checkin' then
    insert into public.zeiteintrag
          (mandant_id, anstellung_id, person_id, einsatz_id, einsatz_zuordnung_id,
           beginn_zeitpunkt, quelle_beginn, erfassungsart_beginn,
           geraete_zeit_beginn, checkin_token_id, status,
           geo_beginn_lat, geo_beginn_lon, geo_beginn_genauigkeit_m, geo_beginn_status,
           erstellt_von_art, erstellt_von, erstellt_von_person_id)
    values (t.mandant_id, t.anstellung_id, t.person_id, t.einsatz_id, t.einsatz_zuordnung_id,
            -- `now()` — die SERVERUHR, nie das, was das Telefon geschickt hat
            -- (Invariante 5, TIM-08). `kern.stempel_feldzeit()` setzt sie
            -- ohnehin noch einmal; hier zu raten waere die zweite Wahrheit.
            now(), 'server_uhr', 'checkin_token',
            p_geraete_zeit, t.id, 'laufend',
            case when v_geo_an then (p_geo ->> 'lat')::numeric end,
            case when v_geo_an then (p_geo ->> 'lon')::numeric end,
            case when v_geo_an then (p_geo ->> 'genauigkeit_m')::numeric end,
            case when v_geo_an and (p_geo ->> 'lat') is not null then 'erfasst'
                 when v_geo_an then coalesce(p_geo ->> 'status', 'nicht_verfuegbar')
                 else 'deaktiviert' end::geo_status,
            -- Der Handelnde ist DER MENSCH, nicht eine anonyme Markenidentitaet:
            -- als `system` verbucht waere ein Check-in von einem Nachtlauf nicht
            -- zu unterscheiden, und genau die Beweiskraft ist der Zweck.
            'mensch', v_benutzer, t.person_id)
    returning id, beginn_zeitpunkt, zeitabweichung_beginn_sek
      into v_eintrag, v_zeit, v_abw;
  else
    update public.zeiteintrag
       set ende_zeitpunkt = now(), quelle_ende = 'server_uhr',
           erfassungsart_ende = 'checkin_token', geraete_zeit_ende = p_geraete_zeit,
           checkout_token_id = t.id, status = 'abgeschlossen',
           geo_ende_lat = case when v_geo_an then (p_geo ->> 'lat')::numeric end,
           geo_ende_lon = case when v_geo_an then (p_geo ->> 'lon')::numeric end,
           geo_ende_genauigkeit_m = case when v_geo_an then (p_geo ->> 'genauigkeit_m')::numeric end,
           geo_ende_status = case when v_geo_an and (p_geo ->> 'lat') is not null then 'erfasst'
                                  when v_geo_an then coalesce(p_geo ->> 'status', 'nicht_verfuegbar')
                                  else 'deaktiviert' end::geo_status
     where einsatz_zuordnung_id = t.einsatz_zuordnung_id
       and ende_zeitpunkt is null and storniert_am is null and ersetzt_am is null
    returning id, ende_zeitpunkt, zeitabweichung_ende_sek
      into v_eintrag, v_zeit, v_abw;

    -- Eine Ausstempelmarke, die auf nichts trifft, ist derselbe stille Verlust:
    -- der Link waere verbrannt und der Datensatz bliebe offen stehen.
    if v_eintrag is null then
      raise exception 'kein offener Zeiteintrag zu dieser Einteilung'
        using errcode = 'P0004';
    end if;
  end if;

  update public.checkin_token set eingeloest_zeiteintrag_id = v_eintrag where id = t.id;

  perform app.protokolliere(
    -- Die Auditaktion steht IM Aufruf, nicht daneben in einer Variablen: der
    -- Aufruf ist der Zugang zum Auditregister, so wie `app.einstellung(...)`
    -- der zum Einstellungsregister ist — und beide werden vom K-19-Scanner an
    -- genau dieser Form erkannt und uebergangen. Eine Kennung, die vorher in
    -- eine Variable wandert, sieht fuer ihn wieder wie ein Rechteschluessel aus.
    case when t.zweck = 'checkin' then 'zeit.eingestempelt' else 'zeit.ausgestempelt' end,
    'zeiteintrag', v_eintrag::text, null,
    jsonb_build_object('quelle', 'checkin_token', 'ip', p_ip::text),
    t.mandant_id);

  return query select
    case when t.zweck = 'checkin' then 'eingecheckt' else 'ausgecheckt' end::text,
    v_eintrag, v_objekt, v_zeit, v_abw;
end $$;

comment on function app.checkin_verbrauchen(text, timestamptz, inet, text, jsonb) is
  'K-08-Register, Rolle cse_checkin. Loest die Marke in EINEM bedingten '
  'Schreibvorgang ein und schreibt den zeiteintrag nur, wenn eine Zeile kam '
  '(K-09). Null Zeilen sind die Ablehnung — ein Ergebnis, kein Orakel.';

/**
 * `cse_checkin` bekommt `EXECUTE` und sonst nichts — kein Tabellenrecht, keine
 * Policy. `app.versuch_protokollieren` wird von INNEN aufgerufen und laeuft
 * damit als Eigentuemer; `cse_checkin` braucht darauf kein Recht und hat auch
 * keins (K-01, K-08).
 */
grant execute on function app.checkin_verbrauchen(text, timestamptz, inet, text, jsonb)
  to cse_checkin;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0035)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- checkin_token (append): TIM-07, SEC-A9. Die Marke belegt, WER wann von welcher IP eingestempelt hat — der Herkunftsnachweis des zeiteintrags. Geloescht bliebe ein Zeitdatensatz ohne nachvollziehbare Herkunft; abgelaufen oder zurueckgezogen wird sie ueber widerrufen_am.
create trigger trg_checkin_token_kein_hard_delete
  before delete on checkin_token
  for each row execute function kern.verhindere_loeschung();
create trigger trg_checkin_token_kein_truncate
  before truncate on checkin_token
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on checkin_token from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
