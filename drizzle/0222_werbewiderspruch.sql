-- 0222 — das Widerspruchsprotokoll und der Widerspruchstoken
-- (CRM-08, LEG-08, § 7 UWG, Art. 21 DSGVO).
--
-- ===========================================================================
-- Was heute fehlt und was es kostet
-- ===========================================================================
--
-- `0020` haelt den Widerspruch als ZWEI Zeitstempel je Zeile:
-- `ansprechpartner.werbewiderspruch_am` (§ 7 UWG, sperrt nur
-- `zweck = 'werbung'`) und `.widerspruch_am` (Art. 21, zwingt ueber
-- `kern.erzwinge_widerspruch()` `rechtsgrundlage = 'keine'`). Beide sind
-- schreibbar-einmal und nicht raeumbar — das ist richtig und bleibt.
--
-- Was ein Zeitstempel NICHT sagt: auf welchem Weg der Widerspruch kam, welche
-- Nachricht ihn ausgeloest hat, und ob er ueberhaupt von der betroffenen
-- Person stammt. Vor einem Gericht ist das die Haelfte, auf die es ankommt:
-- die Abmahnung behauptet, es sei nach dem Widerspruch weiter geworben worden,
-- und der Zeitstempel allein beantwortet nicht, WELCHE Nachricht der Anlass
-- war. `04-SEITENKARTE.md` §2.4 verlangt deshalb ausdruecklich beides:
-- „a hashed, revocable objection token per outbound message and a
-- werbewiderspruch log row".
--
-- **Die Form ist hier neu und nicht abgeleitet.** In
-- `02-datenmodell/02-CRM-OPERATIONS.md` kommt `werbewiderspruch` nur als
-- SPALTE vor; die Protokolltabelle steht dort nicht, sondern als offene
-- Forderung in `04-SEITENKARTE.md`. Welcher Kanalbegriff gilt und wie weit ein
-- Widerspruch reicht, ist damit nicht spezifiziert — beides steht unten als
-- klar bezeichnete offene Frage (O-640, O-641, O-645) und nicht als still
-- gesetzte Regel.
--
-- **Der Token ist nach K-09 gebaut und trotzdem idempotent.** §2.4: „a second
-- click on the same link says 'already recorded', never an error". Der
-- bedingte Schreibvorgang trifft beim zweiten Klick null Zeilen — und null
-- Zeilen sind hier nicht der 409, sondern die Antwort „schon erfasst". Das ist
-- kein Bruch der Konvention: K-09 verlangt, dass das Ergebnis EINMAL entsteht,
-- nicht dass der zweite Versuch einen Fehler bekommt.

create type widerspruch_art as enum (
  /** § 7 UWG: sperrt `zweck = 'werbung'`. Rechnungen laufen weiter. */
  'werbung',
  /** Art. 21 DSGVO: der seltenere, staerkere Fall. Grundlage faellt auf `keine`. */
  'verarbeitung');

create type widerspruch_quelle as enum (
  /** Der Ein-Klick-Link aus einer ausgehenden Werbenachricht. */
  'token',
  /** Das tokenlose Formular `/werbewiderspruch`, auf E-Mail-Adresse. */
  'formular',
  /** Von einem Menschen erfasst — Telefon, Brief, oder Art. 21 im Vorgang. */
  'manuell');

-- ---------------------------------------------------------------------------
-- 1. Der Token je ausgehender Werbenachricht
-- ---------------------------------------------------------------------------

create table werbewiderspruch_token (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  ansprechpartner_id uuid not null,
  constraint wwt_ansprechpartner_fk
    foreign key (mandant_id, ansprechpartner_id)
    references ansprechpartner (mandant_id, id),

  /** Gesetzt, wenn der Widerspruch auf Firmenebene mitwirken soll (§2.4). */
  kunde_id      uuid,
  constraint wwt_kunde_fk
    foreign key (mandant_id, kunde_id) references kunde (mandant_id, id),

  /** Die Nachricht, die den Link getragen hat — der Anlassnachweis. */
  nachricht_id  uuid references nachricht(id),

  /**
   * Der Kanal der ausgehenden Nachricht.
   *
   * Die Liste ist die des Hauses: `ansprechpartner.einwilligung_kanaele` und
   * `app.darf_kontaktiert_werden` kennen genau diese fuenf (0020). Ein
   * sechster Kanal waere dort ohnehin unwirksam.
   */
  kanal         text not null
    check (kanal in ('email', 'telefon', 'sms', 'post', 'whatsapp')),

  /**
   * Nur der Abdruck, nie der Token (K-08/K-09).
   *
   * Ein gespeicherter Klartext-Token ist ein Schluessel, mit dem sich der
   * Widerspruch eines FREMDEN Kontakts erklaeren liesse — und die Tabelle, in
   * der er stuende, ist genau die, die eine Aufsicht liest.
   */
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),

  gueltig_ab    timestamptz not null default now(),
  /**
   * NULL heisst: kein Ablauf. § 7 Abs. 3 Nr. 4 UWG verlangt, dass der
   * Empfaenger der Verwendung „jederzeit" widersprechen kann, ohne andere
   * Kosten als die der Uebermittlung. Ein Link, der nach 30 Tagen 404 gibt,
   * nimmt ihm genau das — und zwar still.
   *
   * Dass hier gar kein Ablauf steht, ist die fuer den Betroffenen SICHERE
   * Wahl, nicht eine entschiedene Regel: ob ein Ablauf gewuenscht ist und wie
   * lange, ist offen.
   * -- TODO(client, O-645): Soll der Widerspruchslink ablaufen? § 7 Abs. 3 Nr. 4 UWG sagt „jederzeit" — heute laeuft er nie ab.
   */
  gueltig_bis   timestamptz
    check (gueltig_bis is null or gueltig_bis > gueltig_ab),

  ausgegeben_am timestamptz not null default now(),

  /** Der K-09-Verbrauch. Zweiter Klick: null Zeilen, also „schon erfasst". */
  eingeloest_am timestamptz,

  versuche      integer not null default 0 check (versuche >= 0),
  letzter_versuch_am timestamptz,

  widerrufen_am timestamptz,
  widerruf_grund text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint werbewiderspruch_token_mandant_uk unique (mandant_id, id),
  constraint wwt_widerruf_begruendet check (
    widerrufen_am is null or btrim(coalesce(widerruf_grund, '')) <> '')
);

comment on table werbewiderspruch_token is
  'CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG. Der Ein-Klick-Widerspruchslink je '
  'ausgehender Werbenachricht — gehasht (K-08), bedingt verbraucht (K-09) und '
  'ohne Ablauf, weil „jederzeit" im Gesetz steht.';

comment on column werbewiderspruch_token.token_hash is
  'SHA-256 des Tokens in Kleinbuchstaben. Der Klartext verlaesst den '
  'Sendeweg nie und steht nirgends in der Datenbank (K-08).';

create index wwt_offen_idx on werbewiderspruch_token (mandant_id, ansprechpartner_id)
  where eingeloest_am is null and widerrufen_am is null;

-- ---------------------------------------------------------------------------
-- 2. Das Protokoll
-- ---------------------------------------------------------------------------

create table werbewiderspruch (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  art           widerspruch_art not null,

  /**
   * Der Betroffene: ein Kontakt, eine Firma — oder beides, wenn der
   * Widerspruch auf beiden Ebenen wirkt (§2.4). Keines von beiden ist kein
   * Widerspruch, sondern eine Notiz.
   */
  ansprechpartner_id uuid,
  constraint ww_ansprechpartner_fk
    foreign key (mandant_id, ansprechpartner_id)
    references ansprechpartner (mandant_id, id),
  kunde_id      uuid,
  constraint ww_kunde_fk
    foreign key (mandant_id, kunde_id) references kunde (mandant_id, id),

  /** Was die Person angegeben hat (tokenloses Formular) — als Beleg. */
  email         text,

  /**
   * Der Kanal, auf dem der Anlass kam. Er BESCHREIBT und wirkt nicht: die
   * Sperre sitzt in EINER Spalte (`werbewiderspruch_am`) und ist damit
   * kanalunabhaengig — so hat `0020` das Modell entschieden.
   * -- TODO(client, O-640): Soll ein Werbewiderspruch je Kanal gelten (nur E-Mail, Post laeuft weiter) oder pauschal wie heute?
   */
  kanal         text
    check (kanal is null
           or kanal in ('email', 'telefon', 'sms', 'post', 'whatsapp')),

  eingegangen_am timestamptz not null default now(),

  /** Die ausloesende Nachricht — der Anlassnachweis der Abmahnung. */
  nachricht_id  uuid references nachricht(id),

  quelle        widerspruch_quelle not null,
  token_id      uuid references werbewiderspruch_token(id),

  bemerkung     text,

  /** NULL auf den oeffentlichen Wegen: dort handelt kein Mensch des Hauses. */
  erfasst_von   uuid references benutzer(id),

  erstellt_am   timestamptz not null default now(),

  constraint werbewiderspruch_mandant_uk unique (mandant_id, id),

  constraint ww_betroffener_benannt check (
    ansprechpartner_id is not null or kunde_id is not null),
  constraint ww_token_belegt check (
    quelle <> 'token' or token_id is not null),
  constraint ww_formular_belegt check (
    quelle <> 'formular' or btrim(coalesce(email, '')) <> ''),
  constraint ww_manuell_benannt check (
    quelle <> 'manuell' or erfasst_von is not null)
);

comment on table werbewiderspruch is
  'CRM-08, LEG-08. Das PROTOKOLL zu den beiden Zeitstempeln aus 0020: wer '
  'wann auf welchem Weg widersprochen hat und welche Nachricht der Anlass war. '
  'Die Wirkung sitzt weiter in ansprechpartner/kunde — hier steht der Beweis.';

comment on column werbewiderspruch.art is
  '„werbung" sperrt nur zweck=werbung (§ 7 UWG); „verarbeitung" ist Art. 21 '
  'und zwingt rechtsgrundlage=keine. Ein Blatt, das beide vermischt, laedt '
  'dazu ein, einem Kunden versehentlich die Rechnungen abzustellen.';

create index ww_zeit_idx on werbewiderspruch (mandant_id, eingegangen_am desc);
create index ww_ansprechpartner_idx on werbewiderspruch (mandant_id, ansprechpartner_id)
  where ansprechpartner_id is not null;

create trigger trg_werbewiderspruch_token_geaendert
  before update on werbewiderspruch_token
  for each row execute function kern.setze_geaendert_am();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- **Lesen: `crm.rechtsgrundlage_lesen` — oder die Datenschutzzustaendigkeit.**
-- Die erste ist das Recht der Route `/datenschutz/widersprueche`; die zweite
-- braucht die Vorgangsakte `/datenschutz/[id]`, die den Art.-21-Stand zeigen
-- muss, den sie selbst setzt. Zwei Rechte fuer dieselbe Auskunft sind hier
-- kein Loch, sondern zwei Zustaendigkeiten fuer denselben Nachweis.
--
-- **Schreiben: nur ueber die Definer-Funktionen unten.** `cse_app` bekommt
-- kein INSERT. Der Grund ist nicht Misstrauen, sondern Kopplung: eine
-- Protokollzeile ohne den zugehoerigen Zeitstempel in `ansprechpartner` waere
-- ein Widerspruch, der dokumentiert und nicht wirksam ist — die
-- gefaehrlichste der drei moeglichen Haelften. Die Funktionen schreiben
-- beides oder nichts.

create function app.darf_widerspruch_lesen() returns boolean
language sql stable security invoker set search_path = pg_catalog, public, app as $$
  select app.hat_recht('crm.rechtsgrundlage_lesen', app.aktiver_mandant())
      or app.hat_recht('datenschutz.auskunft_erstellen', app.aktiver_mandant());
$$;

comment on function app.darf_widerspruch_lesen() is
  'LEG-08 / LEG-09. Das Widerspruchsprotokoll liest, wer das Nachweisblatt '
  'fuehrt (crm.rechtsgrundlage_lesen) oder den Betroffenenvorgang bearbeitet '
  '(datenschutz.auskunft_erstellen).';

grant execute on function app.darf_widerspruch_lesen() to cse_app;

alter table werbewiderspruch enable row level security;
alter table werbewiderspruch force  row level security;

create policy t_werbewiderspruch_lesen on werbewiderspruch for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.darf_widerspruch_lesen()));

create policy d_werbewiderspruch_schreiben on werbewiderspruch for all to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

grant select on werbewiderspruch to cse_app;
grant select, insert on werbewiderspruch to cse_definer;

alter table werbewiderspruch_token enable row level security;
alter table werbewiderspruch_token force  row level security;

/**
 * **`cse_app` bekommt auf dieser Tabelle GAR KEIN Recht** — kein Lesen, kein
 * Schreiben.
 *
 * Eine Lesepolicy gaebe die Liste derer, die eine Werbenachricht bekommen
 * haben. Eine Schreibpolicy klaenge harmlos, braeuchte aber fuer ein
 * `insert … returning id` auch SELECT auf die Spalte — und damit stuende die
 * Tuer auf, die die Lesepolicy zuhalten sollte. Beides laeuft deshalb ueber
 * Definer-Funktionen, die ihr Recht selbst pruefen: ausgeben, aufloesen,
 * verbrauchen.
 */
create policy d_werbewiderspruch_token on werbewiderspruch_token for all to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

grant select, insert, update on werbewiderspruch_token to cse_definer;

-- ---------------------------------------------------------------------------
-- Die Definer-Wege: `cse_definer` braucht Recht UND Policy (K-01)
-- ---------------------------------------------------------------------------
--
-- `alter function … owner to cse_definer` allein liest und schreibt null
-- Zeilen. Die Policies sind so eng wie die Funktionen: ausschliesslich der
-- aktive Mandant — der Definer soll die Gesellschaftsgrenze nicht
-- ueberschreiten, nur die Spaltenrechte (K-05).

grant select, update on ansprechpartner to cse_definer;
grant select, update on kunde           to cse_definer;

create policy d_ansprechpartner_widerspruch on ansprechpartner for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_ansprechpartner_widerspruch_setzen on ansprechpartner
  for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

create policy d_kunde_widerspruch_setzen on kunde for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

/**
 * Der mengenwertige K-05-Leser fuer das Nachweisblatt.
 *
 * **Warum es ihn braucht.** `cse_app` hat auf
 * `ansprechpartner.werbewiderspruch_am`, `.widerspruch_am` und
 * `.rechtsgrundlage` nur INSERT und UPDATE, kein SELECT (K-05-Block in 0020).
 * `app.rechtsgrundlage_lesen(uuid)` liest EINEN Kontakt pro Aufruf und
 * schreibt eine Protokollzeile je Aufruf — fuer eine Liste hiesse das N
 * Protokollzeilen fuer EINEN Seitenaufruf, und das Pruefprotokoll fuellte sich
 * mit Aufrufen statt mit Vorgaengen.
 *
 * Deshalb diese Form: EIN Abruf, EINE Protokollzeile, und nur die Kontakte und
 * Firmen, die wirklich widersprochen haben. Wer nicht widersprochen hat, steht
 * nicht drin — das Blatt ist ein Nachweis, kein Verzeichnis.
 */
create function app.werbewiderspruch_liste()
returns table (ebene text, betroffener_id uuid, name text, kunde_name text,
               email text, werbewiderspruch_am timestamptz,
               widerspruch_am timestamptz, rechtsgrundlage text)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Das Widerspruchsprotokoll ist nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('crm.rechtsgrundlage_lesen', app.aktiver_mandant()) then
    raise exception 'crm.rechtsgrundlage_lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere('crm.widerspruch_liste_gelesen', 'mandant',
                            app.aktiver_mandant()::text, null, null,
                            app.aktiver_mandant());

  return query
    select 'ansprechpartner'::text, ap.id,
           btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname),
           k.name, ap.email, ap.werbewiderspruch_am, ap.widerspruch_am,
           ap.rechtsgrundlage::text
      from public.ansprechpartner ap
      left join public.kunde k
        on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
     where ap.mandant_id = app.aktiver_mandant()
       and (ap.werbewiderspruch_am is not null or ap.widerspruch_am is not null)
    union all
    select 'kunde'::text, k.id, k.name, k.name, k.email_zentral,
           k.werbewiderspruch_am, k.widerspruch_am, k.rechtsgrundlage::text
      from public.kunde k
     where k.mandant_id = app.aktiver_mandant()
       and (k.werbewiderspruch_am is not null or k.widerspruch_am is not null)
     order by 6 desc nulls last, 7 desc nulls last, 3;
end $$;

comment on function app.werbewiderspruch_liste() is
  'LEG-08, CRM-08. Der EINZIGE mengenwertige Leseweg auf die K-05-Spalten von '
  'ansprechpartner. Prueft crm.rechtsgrundlage_lesen und schreibt EINE '
  'Protokollzeile je Abruf — nicht eine je Zeile.';

alter function app.werbewiderspruch_liste() owner to cse_definer;
grant execute on function app.werbewiderspruch_liste() to cse_app;

/**
 * Der Stand EINES Betroffenen — fuer die Vorgangsakte.
 *
 * `/datenschutz/[id]` entscheidet den Art.-21-Widerspruch (§2.4) und muss
 * deshalb anzeigen koennen, was es setzt. Es haelt aber
 * `datenschutz.auskunft_erstellen` und nicht zwingend `crm.lesen`, das
 * `app.rechtsgrundlage_lesen` verlangt.
 */
create function app.widerspruch_stand(p_ansprechpartner uuid, p_kunde uuid)
returns table (ebene text, betroffener_id uuid, name text,
               werbewiderspruch_am timestamptz, widerspruch_am timestamptz,
               rechtsgrundlage text)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.portal() <> 'intern' then
    raise exception 'Der Widerspruchsstand ist nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.darf_widerspruch_lesen() then
    raise exception 'crm.rechtsgrundlage_lesen oder datenschutz.auskunft_erstellen fehlt'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select 'ansprechpartner'::text, ap.id,
           btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname),
           ap.werbewiderspruch_am, ap.widerspruch_am, ap.rechtsgrundlage::text
      from public.ansprechpartner ap
     where ap.mandant_id = app.aktiver_mandant() and ap.id = p_ansprechpartner
    union all
    select 'kunde'::text, k.id, k.name,
           k.werbewiderspruch_am, k.widerspruch_am, k.rechtsgrundlage::text
      from public.kunde k
     where k.mandant_id = app.aktiver_mandant() and k.id = p_kunde;
end $$;

comment on function app.widerspruch_stand(uuid, uuid) is
  'LEG-08 / LEG-09. Der Widerspruchsstand eines Kontakts oder einer Firma fuer '
  'die Vorgangsakte — ohne crm.lesen, das app.rechtsgrundlage_lesen verlangt.';

alter function app.widerspruch_stand(uuid, uuid) owner to cse_definer;
grant execute on function app.widerspruch_stand(uuid, uuid) to cse_app;

/**
 * Den Pflichtlink ausgeben — EIN Token je ausgehender Werbenachricht.
 *
 * Das Recht ist `crm.kommunikation_versenden`: wer senden darf, darf den
 * Pflichtlink dazu erzeugen. Ein eigenes Recht waere eines, das man dem
 * Sendeweg anschliessend zusaetzlich gibt, und ohne das er § 7 Abs. 3 Nr. 4
 * UWG verletzte — also kein Recht, sondern eine Fussangel.
 *
 * **Sie nimmt den HASH, nie den Token.** Der Klartext entsteht im Sendeweg,
 * geht in die Nachricht und wird dort vergessen (K-08).
 */
create function app.werbewiderspruch_token_ausgeben(
  p_ansprechpartner uuid, p_kunde uuid, p_kanal text, p_nachricht uuid,
  p_token_hash text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_id uuid;
begin
  if app.ist_readonly() then
    raise exception 'In der Gruppenansicht wird nichts versendet (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('crm.kommunikation_versenden', app.aktiver_mandant()) then
    raise exception 'crm.kommunikation_versenden fehlt'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.werbewiderspruch_token
    (mandant_id, ansprechpartner_id, kunde_id, nachricht_id, kanal, token_hash)
  values (app.aktiver_mandant(), p_ansprechpartner, p_kunde, p_nachricht,
          p_kanal, lower(p_token_hash))
  returning id into v_id;

  return v_id;
end $$;

comment on function app.werbewiderspruch_token_ausgeben(uuid, uuid, text, uuid, text) is
  'CRM-08, § 7 Abs. 3 Nr. 4 UWG. Der Pflichtlink je Werbenachricht. Nimmt den '
  'SHA-256, nie den Token (K-08). Recht: crm.kommunikation_versenden.';

alter function app.werbewiderspruch_token_ausgeben(uuid, uuid, text, uuid, text)
  owner to cse_definer;
grant execute on function
  app.werbewiderspruch_token_ausgeben(uuid, uuid, text, uuid, text) to cse_app;

/**
 * Welche Gesellschaft gehoert zu diesem Token?
 *
 * Der oeffentliche Weg hat keine Sitzung und muss den Eingangsprinzipal an
 * EINE Gesellschaft binden, bevor er schreiben kann (K-03). Welche es ist,
 * sagt der Token — nicht ein Parameter der Adresse.
 *
 * **Sie verraet nichts.** Wer den Token nicht hat, bekommt NULL; wer ihn hat,
 * erfaehrt nur, welche der vier Gesellschaften ihm geschrieben hat, und das
 * stand im Absender der Nachricht.
 */
create function app.werbewiderspruch_token_mandant(p_token_hash text)
returns uuid
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select t.mandant_id from public.werbewiderspruch_token t
   where t.token_hash = lower(p_token_hash);
$$;

comment on function app.werbewiderspruch_token_mandant(text) is
  'CRM-08. Bindet den oeffentlichen Widerspruchsweg an EINE Gesellschaft. '
  'Ohne Token: NULL.';

alter function app.werbewiderspruch_token_mandant(text) owner to cse_definer;
grant execute on function app.werbewiderspruch_token_mandant(text) to cse_app;

/**
 * Der Ein-Klick-Widerspruch — bedingter Schreibvorgang nach K-09, idempotent.
 *
 * **Reihenfolge und Grund:**
 *  1. Der Token wird bedingt verbraucht (`eingeloest_am is null`). Null Zeilen
 *     heissen hier nicht 409, sondern `bereits` oder `unbekannt` — §2.4 sagt
 *     ausdruecklich: „a second click … says 'already recorded', never an
 *     error". Eine Fehlerseite auf dem Pflichtweg des § 7 UWG waere ein
 *     Widerspruch, der nicht ankam.
 *  2. Die Zeitstempel werden gesetzt — `werbewiderspruch_am`, und beim
 *     Kontakt, auf dem der Token sass, IMMER; auf der Firma nur, wenn der
 *     Token sie benannt hat. `coalesce` laesst einen frueheren Widerspruch
 *     stehen: der frueheste Zeitpunkt ist der, der zaehlt, und
 *     `kern.erzwinge_widerspruch()` wirft bei einer Ruecknahme ohnehin.
 *  3. Die Protokollzeile entsteht in derselben Transaktion. Ein Zeitstempel
 *     ohne Protokoll waere wirksam und nicht belegt; ein Protokoll ohne
 *     Zeitstempel belegt und nicht wirksam.
 *
 * Sie beruehrt `rechtsgrundlage` NICHT. §2.4 korrigiert das ausdruecklich: ein
 * Werbewiderspruch, der alles abstellte, stoppte die Rechnungen des Kunden.
 */
create function app.werbewiderspruch_einloesen(p_token_hash text)
returns table (zustand text, kanal text, kontakt text)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_t record;
begin
  update public.werbewiderspruch_token t
     set eingeloest_am = now(),
         versuche = t.versuche + 1,
         letzter_versuch_am = now()
   where t.token_hash = lower(p_token_hash)
     and t.mandant_id = app.aktiver_mandant()
     and t.eingeloest_am is null
     and t.widerrufen_am is null
     and (t.gueltig_bis is null or now() <= t.gueltig_bis)
     and now() >= t.gueltig_ab
  returning t.* into v_t;

  if v_t.id is null then
    /*
     * Kein Verbrauch. Drei Lagen, und die Antwort unterscheidet nur zwei:
     * den Token gibt es (dann ist er eingeloest, widerrufen oder abgelaufen)
     * oder nicht. Feiner zu antworten hiesse, einem Fremden zu sagen, welche
     * Tokens existieren.
     */
    if exists (select 1 from public.werbewiderspruch_token t
                where t.token_hash = lower(p_token_hash)
                  and t.mandant_id = app.aktiver_mandant()) then
      update public.werbewiderspruch_token t
         set versuche = t.versuche + 1, letzter_versuch_am = now()
       where t.token_hash = lower(p_token_hash)
         and t.mandant_id = app.aktiver_mandant();
      return query select 'bereits'::text, null::text, null::text;
      return;
    end if;
    return query select 'unbekannt'::text, null::text, null::text;
    return;
  end if;

  update public.ansprechpartner ap
     set werbewiderspruch_am = coalesce(ap.werbewiderspruch_am, now())
   where ap.mandant_id = v_t.mandant_id and ap.id = v_t.ansprechpartner_id;

  if v_t.kunde_id is not null then
    update public.kunde k
       set werbewiderspruch_am = coalesce(k.werbewiderspruch_am, now())
     where k.mandant_id = v_t.mandant_id and k.id = v_t.kunde_id;
  end if;

  insert into public.werbewiderspruch
    (mandant_id, art, ansprechpartner_id, kunde_id, kanal, nachricht_id,
     quelle, token_id)
  values (v_t.mandant_id, 'werbung', v_t.ansprechpartner_id, v_t.kunde_id,
          v_t.kanal, v_t.nachricht_id, 'token', v_t.id);

  perform app.protokolliere('crm.werbewiderspruch_erfasst', 'ansprechpartner',
                            v_t.ansprechpartner_id::text, null,
                            jsonb_build_object('quelle', 'token',
                                               'kanal', v_t.kanal),
                            v_t.mandant_id);

  return query
    select 'erfasst'::text, v_t.kanal,
           (select btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname)
              from public.ansprechpartner ap
             where ap.mandant_id = v_t.mandant_id
               and ap.id = v_t.ansprechpartner_id);
end $$;

comment on function app.werbewiderspruch_einloesen(text) is
  'CRM-08, § 7 Abs. 3 Nr. 4 UWG, K-09. Bedingter Verbrauch, dann Zeitstempel '
  'und Protokollzeile in EINER Transaktion. Zweiter Klick: „bereits", nie ein '
  'Fehler (04-SEITENKARTE §2.4).';

alter function app.werbewiderspruch_einloesen(text) owner to cse_definer;
grant execute on function app.werbewiderspruch_einloesen(text) to cse_app;

/**
 * Der tokenlose Weg — auf E-Mail-Adresse, in EINER Gesellschaft.
 *
 * §2.4: „The tokenless form exists because a forwarded message is not a
 * reason to make objection impossible; it matches on e-mail address."
 *
 * **Sie wirkt in genau der gewaehlten Gesellschaft.** Die vier sind
 * verschiedene juristische Personen, jede fuer ihre Werbung selbst
 * verantwortlich — dieselbe Begruendung, aus der `/datenschutz/anfrage` die
 * Gesellschaft im Formular fuehrt. Ob ein Widerspruch fuer die Gruppe wirken
 * SOLL, ist eine Entscheidung der Geschaeftsfuehrung und keine des Codes.
 * -- TODO(client, O-641): Wirkt ein Werbewiderspruch bei einer Gesellschaft auch fuer die drei anderen der Gruppe?
 *
 * **Sie sagt nicht, ob sie jemanden gefunden hat** — die Zahl geht in das
 * Protokoll, nicht in die Antwort. „Zu dieser Adresse haben wir 3 Kontakte"
 * waere eine Auskunft ueber einen fremden Datenbestand an jeden, der eine
 * Adresse errät.
 */
create function app.werbewiderspruch_formular(p_email text)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_anzahl integer := 0;
  v_id uuid;
begin
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    raise exception 'Keine gueltige E-Mail-Adresse' using errcode = 'check_violation';
  end if;

  for v_id in
    select ap.id from public.ansprechpartner ap
     where ap.mandant_id = app.aktiver_mandant()
       and lower(ap.email) = v_email
       and ap.anonymisiert_am is null
  loop
    update public.ansprechpartner ap
       set werbewiderspruch_am = coalesce(ap.werbewiderspruch_am, now())
     where ap.mandant_id = app.aktiver_mandant() and ap.id = v_id;

    insert into public.werbewiderspruch
      (mandant_id, art, ansprechpartner_id, email, quelle)
    values (app.aktiver_mandant(), 'werbung', v_id, v_email, 'formular');

    v_anzahl := v_anzahl + 1;
  end loop;

  for v_id in
    select k.id from public.kunde k
     where k.mandant_id = app.aktiver_mandant()
       and lower(k.email_zentral) = v_email
       and k.anonymisiert_am is null
  loop
    update public.kunde k
       set werbewiderspruch_am = coalesce(k.werbewiderspruch_am, now())
     where k.mandant_id = app.aktiver_mandant() and k.id = v_id;

    insert into public.werbewiderspruch
      (mandant_id, art, kunde_id, email, quelle)
    values (app.aktiver_mandant(), 'werbung', v_id, v_email, 'formular');

    v_anzahl := v_anzahl + 1;
  end loop;

  perform app.protokolliere('crm.werbewiderspruch_formular', 'mandant',
                            app.aktiver_mandant()::text, null,
                            jsonb_build_object('treffer', v_anzahl),
                            app.aktiver_mandant());
  return v_anzahl;
end $$;

comment on function app.werbewiderspruch_formular(text) is
  'CRM-08, LEG-08. Der tokenlose Widerspruch auf E-Mail-Adresse, in EINER '
  'Gesellschaft. Die Trefferzahl geht ins Protokoll, nicht in die Antwort.';

alter function app.werbewiderspruch_formular(text) owner to cse_definer;
grant execute on function app.werbewiderspruch_formular(text) to cse_app;

/**
 * Der Art.-21-Widerspruch — im Vorgang entschieden, von einem Menschen.
 *
 * `04-SEITENKARTE.md` §2.4 legt diese Entscheidung auf
 * `M/datenschutz/[id]`, und das Tor dieser Route ist
 * `datenschutz.auskunft_erstellen`. Genau dieses Recht prueft die Funktion —
 * nicht `crm.schreiben`: verlangte sie das, waere die Zusage der Seitenkarte
 * fuer eine Datenschutzbeauftragte ohne CRM-Schreibrecht unerreichbar, und
 * die Entscheidung wanderte dorthin, wo sie nicht hingehoert.
 *
 * **Sie ist unwiderruflich, und das steht in der Datenbank, nicht in der
 * Oberflaeche**: `kern.erzwinge_widerspruch()` (0020) zwingt
 * `rechtsgrundlage = 'keine'`, nullt Quelle, Erfassungszeitpunkt und
 * Einwilligungskanaele und wirft bei jedem Versuch, den Widerspruch
 * zurueckzunehmen.
 */
create function app.widerspruch_verarbeitung_setzen(
  p_ansprechpartner uuid, p_kunde uuid, p_bemerkung text)
returns integer
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_anzahl integer := 0;
begin
  if app.portal() <> 'intern' then
    raise exception 'Der Art.-21-Widerspruch wird nur im internen Portal entschieden (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'In der Gruppenansicht wird nichts entschieden (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('datenschutz.auskunft_erstellen', app.aktiver_mandant()) then
    raise exception 'datenschutz.auskunft_erstellen fehlt'
      using errcode = 'insufficient_privilege';
  end if;
  if p_ansprechpartner is null and p_kunde is null then
    raise exception 'Ohne Betroffenen gibt es keinen Widerspruch'
      using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_bemerkung, '')) = '' then
    raise exception 'Ein Art.-21-Widerspruch wird begruendet festgehalten — er ist '
                    'unwiderruflich' using errcode = 'check_violation';
  end if;

  if p_ansprechpartner is not null then
    update public.ansprechpartner ap
       set widerspruch_am = coalesce(ap.widerspruch_am, now())
     where ap.mandant_id = app.aktiver_mandant() and ap.id = p_ansprechpartner;
    if not found then
      raise exception 'Diesen Kontakt gibt es in dieser Gesellschaft nicht'
        using errcode = 'no_data_found';
    end if;
    v_anzahl := v_anzahl + 1;
  end if;

  if p_kunde is not null then
    update public.kunde k
       set widerspruch_am = coalesce(k.widerspruch_am, now())
     where k.mandant_id = app.aktiver_mandant() and k.id = p_kunde;
    if not found then
      raise exception 'Diese Firma gibt es in dieser Gesellschaft nicht'
        using errcode = 'no_data_found';
    end if;
    v_anzahl := v_anzahl + 1;
  end if;

  insert into public.werbewiderspruch
    (mandant_id, art, ansprechpartner_id, kunde_id, quelle, bemerkung, erfasst_von)
  values (app.aktiver_mandant(), 'verarbeitung', p_ansprechpartner, p_kunde,
          'manuell', btrim(p_bemerkung), app.aktueller_benutzer());

  perform app.protokolliere('crm.widerspruch_verarbeitung_gesetzt',
                            case when p_ansprechpartner is null
                                 then 'kunde' else 'ansprechpartner' end,
                            coalesce(p_ansprechpartner, p_kunde)::text, null,
                            jsonb_build_object('art', 'verarbeitung'),
                            app.aktiver_mandant());
  return v_anzahl;
end $$;

comment on function app.widerspruch_verarbeitung_setzen(uuid, uuid, text) is
  'LEG-09, Art. 21 DSGVO. Entschieden auf M/datenschutz/[id] (04-SEITENKARTE '
  '§2.4), deshalb gegen datenschutz.auskunft_erstellen und nicht gegen '
  'crm.schreiben. kern.erzwinge_widerspruch() macht sie unwiderruflich.';

alter function app.widerspruch_verarbeitung_setzen(uuid, uuid, text)
  owner to cse_definer;
grant execute on function app.widerspruch_verarbeitung_setzen(uuid, uuid, text)
  to cse_app;

-- ---------------------------------------------------------------------------
-- Keine Loeschung (Invariante 8)
-- ---------------------------------------------------------------------------
--
-- Erzeugt aus `src/server/db/schema/rls.ts` — `pnpm db:triggers` schreibt neu.

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0222)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- werbewiderspruch_token (append): CRM-08, LEG-08, § 7 Abs. 3 Nr. 4 UWG. Der Abdruck des Pflichtlinks je Werbenachricht — der Beleg, DASS die Nachricht einen wirksamen Widerspruchsweg getragen hat. Geloescht bliebe eine Werbemail ohne nachweisbaren Widerspruchslink; abgelaufen oder zurueckgezogen wird der Token ueber widerrufen_am.
create trigger trg_werbewiderspruch_token_kein_hard_delete
  before delete on werbewiderspruch_token
  for each row execute function kern.verhindere_loeschung();
create trigger trg_werbewiderspruch_token_kein_truncate
  before truncate on werbewiderspruch_token
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on werbewiderspruch_token from cse_app, cse_anon, cse_checkin, cse_job;

-- werbewiderspruch (append): CRM-08, LEG-08, § 7 UWG. Das Protokoll des Widerspruchs: Weg, Kanal, Zeitpunkt und ausloesende Nachricht. Es ist der Beweis, mit dem sich eine Abmahnung abwehren laesst — eine geloeschte Zeile nimmt dem Verantwortlichen genau diesen Beweis, und die Beweislast liegt bei ihm.
create trigger trg_werbewiderspruch_kein_hard_delete
  before delete on werbewiderspruch
  for each row execute function kern.verhindere_loeschung();
create trigger trg_werbewiderspruch_kein_truncate
  before truncate on werbewiderspruch
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on werbewiderspruch from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
