/**
 * 0123 — Die Kreditorenseite: Lieferant, Beleg, Eingangsrechnung (FIN-14,
 * ACC-03, ACC-05, PR 54.3).
 *
 * `05-FINANZEN.md` §8.1, §8.2, §8.3, §8.5 (beleg).
 *
 * **Was 0121 offen liess.** Der offene Posten kennt seit 0121 nur Debitoren:
 * `art` traegt `kreditor`, aber die Spalten, die einen Kreditorposten
 * zuordenbar machen, fehlten samt ihren Elterntischen. Diese Migration bringt
 * sie — und hebt damit die Schranke auf, die 0121 ausdruecklich als
 * vorlaeufig benannt hat.
 *
 * **Drei Entscheidungen, die die Gestalt bestimmen:**
 *
 *   1. **Die interne Belegnummer wird beim BUCHEN gezogen, nicht bei der
 *      Freigabe.** Der Kreis `eingangsrechnung_beleg` ist lueckenlos. Zoege
 *      die Freigabe die Nummer, verbrauchte eine freigegebene und danach
 *      abgelehnte Rechnung eine Nummer und liesse sie liegen — genau die
 *      Luecke, deren Unmoeglichkeit §5.5 fuer die Ausgangsrechnung beweist.
 *      Buchen ist der unumkehrbare Schritt, also wird dort gezogen.
 *
 *   2. **Keine Eingangsrechnung ohne Beleg** (ACC-03). `beleg_id` ist NOT
 *      NULL, und `beleg` zeigt auf eine bestimmte DOKUMENTVERSION samt ihrem
 *      SHA-256. Ein Archivdokument, das sich spaeter austauschen laesst,
 *      bezeugt nichts.
 *
 *   3. **Die Vier-Augen-Freigabe ist Einstellung, kein CHECK.** Ein
 *      `CHECK (freigegeben_von <> erstellt_von)` erfaende eine
 *      Organisationsregel; in einem Rueckbuero aus zwei Menschen sperrte sie
 *      jede Freigabe ohne Ausweg. Der Dienst liest
 *      `app.einstellung('eingang.vier_augen_ab_cent')`, und die Saat laesst
 *      sie NULL — kein Vier-Augen-Zwang, bis jemand einen entscheidet.
 *      TODO(client, O-183): Ist eine Vier-Augen-Freigabe fuer
 *      Eingangsrechnungen erforderlich, und ab welchem Betrag? Wer darf im
 *      Vertretungsfall freigeben?
 *
 * **Was hier NICHT steht.** `eingangsrechnung_extraktion` (OCR, §8.4) kommt
 * mit PR 63; `ausgabe`, `ausgabe_steuer` und das Kassenbuch mit PR 54.3b;
 * `bauleistung_jahressumme` und `bauabzug_anmeldung` (§8.6) mit der
 * §48a-Anmeldung. Jede dieser Tabellen kommt mit ihrem eigenen Weg — eine
 * Spalte ohne Schreiber ist der Befund aus PR 52.1.
 */

-- =========================================================================
-- 1. Die Vokabulare (§3.1)
-- =========================================================================

create type eingangsrechnung_status as enum
  ('eingegangen', 'in_pruefung', 'freigegeben', 'gebucht', 'abgelehnt');

comment on type eingangsrechnung_status is
  'FIN-14, ACC-05. Kein `bezahlt`: der Zahlungsstand wird aus offener_posten '
  'abgeleitet und nie ein zweites Mal gespeichert.';

create type beleg_typ as enum
  ('ausgangsrechnung', 'eingangsrechnung', 'gutschrift', 'kassenbeleg',
   'bankbeleg', 'vertrag', 'sonstiges');

create type beleg_quelle as enum ('upload', 'email', 'scan', 'api');

comment on type beleg_quelle is
  'ACC-05. Jeder Eingangsweg muss in der Verfahrensdokumentation stehen '
  '(ACC-10) — deshalb ist er ein Pflichtfeld und kein Freitext.';

-- =========================================================================
-- 2. Die Aufbewahrung fuer Tabellen mit `aufbewahrung_klasse`
-- =========================================================================

/**
 * **Eine Funktion, nicht drei Kopien.**
 *
 * `kern.setze_aufbewahrung` (0009) liest `new.kategorie`, `fin.setze_aufbewahrung`
 * (0075) rechnet aus `rechnungsdatum`. Die Tabellen hier tragen
 * `aufbewahrung_klasse` und je ein eigenes Basisdatum; der Spaltenname kommt
 * deshalb als Ausloeserargument. Drei fast gleiche Funktionen zu schreiben
 * hiesse, denselben Fehler dreimal pflegen zu duerfen.
 *
 * **`to_jsonb(new)` und erzeugte Spalten** — die Falle aus D-399: in einem
 * BEFORE-Ausloeser stehen erzeugte Spalten in `new` auf NULL. Hier ist das
 * harmlos, weil das Basisdatum nie erzeugt ist; wer diese Funktion auf eine
 * Tabelle haengt, deren Basisdatum erzeugt waere, bekaeme still NULL.
 *
 * Ohne Regel gilt SPERRE: „keine Regel" heisst nicht „keine Pflicht", es
 * heisst, dass niemand entschieden hat (K-17).
 * TODO(client, O-25): Aufbewahrungsfrist je Belegklasse mit dem Steuerberater
 * bestaetigen — welche Klasse faellt auf acht, welche auf zehn Jahre?
 */
create function fin.aufbewahrung_aus_klasse() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  r       record;
  v_basis date;
begin
  if tg_op = 'UPDATE' then
    if old.loeschsperre and not new.loeschsperre then
      raise exception 'Die Loeschsperre eines Buchungsbelegs wird nicht aufgehoben (LEG-01, GoBD)'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  v_basis := (to_jsonb(new) ->> tg_argv[0])::date;

  select * into r from app.aufbewahrung_regel(new.mandant_id, new.aufbewahrung_klasse);

  if not found or r.jahre is null or v_basis is null then
    new.aufbewahrung_bis := null;
    new.loeschsperre := true;
    return new;
  end if;

  new.loeschsperre := r.loeschsperre or r.ist_platzhalter;
  new.aufbewahrung_bis := make_date(extract(year from v_basis)::int + r.jahre, 12, 31);
  return new;
end $$;

alter function fin.aufbewahrung_aus_klasse() owner to cse_definer;

/**
 * **Und das Ausfuehrungsrecht auf die Regelabfrage.**
 *
 * `app.aufbewahrung_regel` (0009) ist selbst ein Definer, aber ihr
 * `grant execute` ging bisher nur an `cse_app` — die Ausloeser, die sie
 * aufrufen, liefen unter `cse_app` als Aufrufer. Dieser hier laeuft als
 * `cse_definer` (er liest `mandant`-gebundene Klassen) und lief damit in
 * „permission denied for function aufbewahrung_regel". Gefunden hat es der
 * erste Testlauf; ohne ihn haette die Frist auf jedem Beleg gefehlt, ohne
 * dass irgendwo etwas rot geworden waere — der Ausloeser haette schlicht
 * nicht gefeuert.
 */
grant execute on function app.aufbewahrung_regel(uuid, text) to cse_definer;

-- =========================================================================
-- 3. lieferant (§8.1) — der Kreditorenstamm
-- =========================================================================

create table lieferant (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /**
   * Einspaltig, genau wie `kunde.firma_id` (02-CRM §0.8): die Firma ist die
   * geteilte Identitaet ueber die Gesellschaften hinweg, und ein
   * zusammengesetzter Schluessel machte daraus eine je Gesellschaft eigene.
   * Ein Lieferant, der zugleich Kunde einer anderen Gesellschaft ist, bleibt
   * damit EINE Identitaet, ohne dass eine Seite die Konditionen der anderen
   * saehe.
   */
  firma_id              uuid references firma(id),

  lieferantennummer     text not null check (length(btrim(lieferantennummer)) > 0),
  /** DATEV-Kreditor (ACC-01, ACC-07). Spaltenweise entzogen — siehe unten. */
  kreditorennummer      text,

  name                  text not null check (length(btrim(name)) > 0),
  ust_id                text,
  steuernummer          text,

  strasse               text,
  hausnummer            text,
  plz                   text,
  ort                   text,
  land                  char(2) not null default 'DE',

  email                 text,
  telefon               text,

  /**
   * Die Betrugsflaeche (§1.5): eine geaenderte Lieferanten-IBAN ist das
   * klassische Muster des Rechnungsbetrugs. Gestalt hier, Pruefziffer im
   * Dienst — dieselbe Aufteilung wie bei `bankkonto` (0121).
   */
  iban                  text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic                   text check (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  /** Ohne Vorgabewert (O-66-Muster): ein Zahlungsziel ist eine Vereinbarung. */
  zahlungsziel_tage     integer check (zahlungsziel_tage is null
                                       or (zahlungsziel_tage >= 0 and zahlungsziel_tage <= 3650)),

  /** §13b Abs. 2 Nr. 4 gegen Nr. 8 — welcher Fall, wenn ueberhaupt einer. */
  leistungsart          bauleistungsart,
  /** Der §48-EStG-Ausloeser, DATIERT: er aendert sich. */
  ist_bauleistender_bis date,

  status                text not null default 'aktiv'
                          check (status in ('aktiv', 'gesperrt')),

  /** Art. 18 DSGVO (§16), fuer einen Lieferanten, der eine natuerliche Person ist. */
  verarbeitung_eingeschraenkt boolean not null default false,
  anonymisiert_am       timestamptz,
  archiviert_am         timestamptz,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint lieferant_mandant_uk unique (mandant_id, id),
  constraint lieferant_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create unique index lieferant_nummer_uk on lieferant (mandant_id, lieferantennummer)
  where archiviert_am is null;
create unique index lieferant_kreditor_uk on lieferant (mandant_id, kreditorennummer)
  where kreditorennummer is not null and archiviert_am is null;
create index lieferant_name_trgm on lieferant using gin (name gin_trgm_ops);
create index lieferant_firma_idx on lieferant (firma_id) where firma_id is not null;
/** Die §48-Arbeitsliste. */
create index lieferant_bauleistender_idx on lieferant (mandant_id)
  where ist_bauleistender_bis is not null;

/**
 * **Eine geaenderte Bankverbindung wird LAUT.**
 *
 * Der haeufigste Rechnungsbetrug im Mittelstand ist eine E-Mail mit „unsere
 * Bankverbindung hat sich geaendert". Er funktioniert, weil die Aenderung im
 * Stammsatz aussieht wie jede andere. Hier schreibt sie `vorher`/`nachher`
 * ins `audit_log` — nachweisbar, mit Zeit und Akteur.
 *
 * **Die Benachrichtigung fehlt mit Absicht.** §8.1 verlangt zusaetzlich eine
 * Warnung an die Buchhaltung. `benachrichtigung` braucht einen konkreten
 * `empfaenger_id`; wer das ist, ist genau die Frage, die O-357 offen laesst.
 * Einen Empfaenger zu waehlen hiesse, eine Zustaendigkeit zu erfinden — und
 * eine Warnung an den Falschen ist keine Warnung.
 * TODO(client, O-357): Wer bekommt die Waechter-Meldungen aus SPEC §14 — und
 * wer im Besonderen die Meldung ueber eine geaenderte Lieferanten-IBAN?
 */
create function fin.lieferant_bankdaten_geaendert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
begin
  if new.iban is not distinct from old.iban and new.bic is not distinct from old.bic then
    return new;
  end if;

  perform app.protokolliere(
    'lieferant.bankdaten_geaendert', 'lieferant', new.id::text,
    jsonb_build_object('iban', old.iban, 'bic', old.bic),
    jsonb_build_object('iban', new.iban, 'bic', new.bic),
    new.mandant_id);

  return new;
end $$;

alter function fin.lieferant_bankdaten_geaendert() owner to cse_definer;

create trigger lieferant_bankdaten_geaendert
  before update on lieferant
  for each row execute function fin.lieferant_bankdaten_geaendert();

-- =========================================================================
-- 4. beleg (§8.5) — das Dokument, das mit der Buchungszeile reist
-- =========================================================================

/**
 * **Der zusammengesetzte Schluessel, den `dokument_version` noch nicht hatte.**
 *
 * Jede mandantengebundene Tabelle traegt `UNIQUE (mandant_id, id)`, damit ein
 * Kind ueber BEIDE Spalten verweisen kann und ein Fremdschluessel die
 * Mandantengrenze mittraegt (Invariante 3). `dokument_version` hatte nur
 * `(mandant_id, dokument_id, version)` — ein Beleg haette damit auf eine
 * Version eines FREMDEN Mandanten zeigen koennen, und nichts haette es
 * bemerkt.
 */
alter table dokument_version
  add constraint dokument_version_mandant_uk unique (mandant_id, id);


create table beleg (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  belegnummer           text,
  typ                   beleg_typ not null,
  quelle                beleg_quelle not null,

  /**
   * Auf die VERSION und nicht nur auf das Dokument: `dokument` kann eine
   * neue Fassung bekommen, und dann waere der archivierte Beleg still ein
   * anderer. `datei_sha256` steht daneben, damit die Belegkette (ACC-03)
   * einen Austausch bemerkt, ohne das Dokument zu oeffnen.
   */
  dokument_id           uuid not null,
  dokument_version_id   uuid not null,
  datei_sha256          text not null check (datei_sha256 ~ '^[0-9a-f]{64}$'),

  seiten                integer check (seiten is null or seiten > 0),
  belegdatum            date,
  /** Nur zur Suche. Der gebuchte Betrag steht auf `buchungssatz` (PR 58). */
  betrag_brutto_cent    bigint,

  eingegangen_am        timestamptz not null default now(),

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

  constraint beleg_mandant_uk unique (mandant_id, id),
  constraint beleg_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint beleg_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id),
  constraint beleg_version_fk foreign key (mandant_id, dokument_version_id)
    references dokument_version (mandant_id, id)
);

create unique index beleg_nummer_uk on beleg (mandant_id, belegnummer)
  where belegnummer is not null;
/**
 * **NICHT eindeutig, und das ist die Entscheidung.** Ein eindeutiger Index
 * verboete, dieselbe PDF unter zwei Belegen abzulegen — eine Sammelrechnung,
 * die Beleg fuer zwei Buchungen ist, oder ein Vertrag, der zugleich Anlage
 * einer Rechnung ist, kommt gewoehnlich vor. Die Dublettenerkennung bleibt:
 * der Hochladeweg fragt diesen Index ab und zeigt „liegt bereits als Beleg
 * <nr> vor"; entscheiden tut ein Mensch.
 */
create index beleg_sha_idx on beleg (mandant_id, datei_sha256);
create index beleg_typ_idx on beleg (mandant_id, typ, belegdatum desc);
create index beleg_aufbewahrung_idx on beleg (mandant_id, aufbewahrung_bis)
  where loeschsperre;

create trigger beleg_aufbewahrung
  before insert or update on beleg
  for each row execute function fin.aufbewahrung_aus_klasse('belegdatum');

/** Ein archiviertes Dokument wird nicht ausgetauscht (ACC-03, ACC-06). */
create function fin.beleg_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.dokument_id         is distinct from old.dokument_id
  or new.dokument_version_id is distinct from old.dokument_version_id
  or new.datei_sha256        is distinct from old.datei_sha256 then
    raise exception
      'Der Beleg zeigt auf eine bestimmte Dokumentversion; sie wird nicht ausgetauscht (ACC-03).'
      using errcode = 'restrict_violation',
            hint = 'Ein neues Dokument wird ein NEUER Beleg.';
  end if;
  return new;
end $$;

create trigger beleg_unveraenderlich
  before update on beleg
  for each row execute function fin.beleg_unveraenderlich();


-- =========================================================================
-- 5. eingangsrechnung (§8.2)
-- =========================================================================

create table eingangsrechnung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /** Aus dem Kreis `eingangsrechnung_beleg` — gezogen beim BUCHEN (Kopf, 1). */
  interne_belegnummer   text,
  nummernkreis_id       uuid,

  lieferant_id          uuid,
  rechnungsnummer_lieferant text,

  /**
   * §14 Abs. 2 UStG: eine Gutschrift ist ein Beleg, den WIR ausstellen und
   * nummerieren, und die Umsatzsteuer darin ist die des Leistenden. Im Bau
   * ist die Nachunternehmerabrechnung per Gutschrift ueblich.
   * TODO(client, O-184): Rechnet die Bau-Gesellschaft Nachunternehmer per
   * Gutschrift ab — generell oder je Vertrag, und wer widerspricht einer?
   */
  selbst_abgerechnet    boolean not null default false,
  gutschrift_nummer     text,

  rechnungsdatum        date,
  /** Der Stichtag, an dem FIN-09 und FIN-10 bewertet werden. */
  leistungsdatum        date,
  leistung_von          date,
  leistung_bis          date,
  eingang_am            date not null default (now() at time zone 'Europe/Berlin')::date,

  netto_cent            bigint,
  steuer_cent           bigint,
  brutto_cent           bigint,
  waehrung              text not null default 'EUR' check (waehrung = 'EUR'),

  /** §13b als EMPFAENGER: wir schulden die Steuer. */
  reverse_charge            boolean not null default false,
  reverse_charge_grundlage  bauleistungsart,

  /** §48 EStG als ZAHLENDER: wir behalten ein und fuehren ab. */
  bauabzugsteuer_pflichtig  boolean not null default false,
  bauabzugsteuer_satz_bp    integer,
  bauabzugsteuer_cent       bigint not null default 0 check (bauabzugsteuer_cent >= 0),
  freistellungsbescheinigung_id uuid,
  freistellung_geprueft_am  date,

  faellig_am            date,
  skonto_bp             integer,
  skonto_bis            date,

  status                eingangsrechnung_status not null default 'eingegangen',

  freigabe_id           uuid,
  freigegeben_von       uuid references benutzer(id),
  freigegeben_am        timestamptz,
  gebucht_am            timestamptz,
  abgelehnt_grund       text,

  /** ACC-03: keine Eingangsrechnung ohne ihr Dokument. */
  beleg_id              uuid not null,

  auftrag_id            uuid,
  projekt_id            uuid,
  objekt_id             uuid,
  kostenstelle          text,

  aufbewahrung_klasse   text not null default 'rechnung_eingang',
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

  constraint er_mandant_uk unique (mandant_id, id),
  constraint er_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint er_freigegeben_vollstaendig check (
    status <> 'freigegeben'
    or (lieferant_id is not null and rechnungsdatum is not null
        and leistungsdatum is not null and brutto_cent is not null)),

  /**
   * Beim BUCHEN muss die Faelligkeit dastehen — der offene Posten braucht
   * sie, und die Zahlungslaufliste liest sie. Abgeleitet wird sie NICHT: was
   * vereinbart ist, steht auf der Rechnung des Lieferanten. Sagt sie nichts,
   * ist die Forderung nach §271 BGB sofort faellig, und genau dieses Datum
   * traegt der erfassende Mensch dann ein — eine Angabe, keine Annahme.
   */
  constraint er_gebucht_vollstaendig check (
    status <> 'gebucht'
    or (interne_belegnummer is not null and gebucht_am is not null
        and faellig_am is not null)),

  constraint er_summen_stimmig check (
    brutto_cent is null or netto_cent is null or steuer_cent is null
    or brutto_cent = netto_cent + steuer_cent),

  /** Eine Gutschrift traegt UNSERE Nummer, nie die des Leistenden. */
  constraint er_gutschrift_ohne_fremdnummer check (
    selbst_abgerechnet = false or rechnungsnummer_lieferant is null),

  constraint er_ablehnung_begruendet check (
    status <> 'abgelehnt' or length(btrim(coalesce(abgelehnt_grund, ''))) >= 5),

  constraint er_lieferant_fk foreign key (mandant_id, lieferant_id)
    references lieferant (mandant_id, id),
  constraint er_beleg_fk foreign key (mandant_id, beleg_id)
    references beleg (mandant_id, id),
  constraint er_kreis_fk foreign key (mandant_id, nummernkreis_id)
    references nummernkreis (mandant_id, id),
  constraint er_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id),
  constraint er_fsb_fk foreign key (mandant_id, freistellungsbescheinigung_id)
    references freistellungsbescheinigung (mandant_id, id),
  constraint er_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  constraint er_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint er_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id)
);

/**
 * **Die Dublettensperre — der Riegel gegen die doppelte Zahlung.**
 *
 * Zwei Feinheiten, und beide sind Korrekturen am ersten Entwurf:
 *
 *   `status <> 'abgelehnt'`: eine irrtuemlich abgelehnte Rechnung muss sich
 *   neu erfassen lassen. Ohne diesen Ausschluss blockierte der Irrtum den
 *   richtigen Beleg auf Dauer.
 *
 *   Das JAHR gehoert in den Schluessel: ein Lieferant, der seine Nummern
 *   jeden Januar bei `001` neu beginnt, kollidierte sonst mit sich selbst.
 */
create unique index er_dublette_uk on eingangsrechnung
  (mandant_id, lieferant_id, rechnungsnummer_lieferant, (extract(year from rechnungsdatum)))
  where lieferant_id is not null and rechnungsnummer_lieferant is not null
    and status <> 'abgelehnt';

create unique index er_belegnummer_uk on eingangsrechnung (mandant_id, interne_belegnummer)
  where interne_belegnummer is not null;
create unique index er_gutschrift_uk on eingangsrechnung (mandant_id, gutschrift_nummer)
  where gutschrift_nummer is not null;
/** Der Freigabeeingang (APR-01). */
create index er_status_idx on eingangsrechnung (mandant_id, status, eingang_am desc);
/** Die Zahlungslaufliste. */
create index er_faellig_idx on eingangsrechnung (mandant_id, faellig_am) where status = 'gebucht';
create index er_projekt_idx on eingangsrechnung (mandant_id, projekt_id) where projekt_id is not null;
/** Die §48-Jahressumme je Leistendem. */
create index er_bauabzug_idx on eingangsrechnung (mandant_id, lieferant_id, leistungsdatum)
  where bauabzugsteuer_pflichtig;

create trigger er_aufbewahrung
  before insert or update on eingangsrechnung
  for each row execute function fin.aufbewahrung_aus_klasse('rechnungsdatum');

-- =========================================================================
-- 6. eingangsrechnung_steuer (§8.3)
-- =========================================================================

create table eingangsrechnung_steuer (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  eingangsrechnung_id   uuid not null,

  steuersatz_gruppe_id  uuid not null references steuersatz_gruppe(id),
  /** Eingefrorene Kopien: eine spaetere Satzpflege aendert keinen Beleg. */
  satz_bp               integer not null,
  kategorie             en16931_steuerkategorie not null,

  netto_cent            bigint not null,
  steuer_cent           bigint not null,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint ers_mandant_uk unique (mandant_id, id),
  constraint ers_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),
  constraint ers_parent_fk foreign key (mandant_id, eingangsrechnung_id)
    references eingangsrechnung (mandant_id, id)
);

create unique index ers_gruppe_uk on eingangsrechnung_steuer
  (eingangsrechnung_id, steuersatz_gruppe_id);
/** Die Vorsteueraggregation. */
create index ers_gruppe_idx on eingangsrechnung_steuer (mandant_id, steuersatz_gruppe_id);

comment on table eingangsrechnung_steuer is
  'FIN-14, ACC-08. Die Aufteilung nach Steuersaetzen — nie ein Brutto mit '
  'einem Mischsatz. Der Kopf darf waehrend der Erfassung noch ohne Zeilen '
  'stehen (ACC-05 schlaegt erst den Kopf vor); vor dem Buchen muessen sie '
  'zusammenpassen, und das prueft fin.eingangsrechnung_buchen.';

-- =========================================================================
-- 7. Die Zustaende — und der eine unumkehrbare Schritt
-- =========================================================================

/**
 * **Steht dieser Freigabesatz auf `genehmigt`? — die eine Frage, die jeder
 * Zustandswechsel stellt.**
 *
 * Sie sieht harmlos aus und ist es nicht. Wer sie als `select … from
 * freigabe` in einen Ausloeser schreibt, laesst sie unter den Policies des
 * AUFRUFERS beantworten — und `t_mandant` auf `freigabe` verlangt
 * `versand.lesen`. Ein Mensch mit `eingang.freigeben` (oder
 * `mahnung.freigeben`) ohne dieses fremde Recht bekaeme dann nicht „dir fehlt
 * ein Recht", sondern „der Freigabesatz steht nicht auf genehmigt" — eine
 * Aussage ueber die Freigabe, die falsch ist, ueber eine Zeile, die er nicht
 * sehen darf. Er sucht den Fehler in der Freigabe, und die ist in Ordnung.
 *
 * Die Frage ist STRUKTURELL („gibt es zu dieser Kennung in diesem Mandanten
 * eine genehmigte Zeile"), nicht inhaltlich — sie gibt nichts preis ausser
 * ja/nein zu einer Kennung, die der Aufrufer ohnehin in der Hand hat.
 * Deshalb beantwortet sie ein Definer mit einem eigenen, engen Spaltenrecht
 * (K-01, D-388) und nicht der Aufrufer.
 */
create function app.freigabe_genehmigt(p_freigabe uuid, p_mandant uuid)
returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select exists (
    select 1 from public.freigabe f
     where f.id = p_freigabe and f.mandant_id = p_mandant and f.status = 'genehmigt');
$$;

comment on function app.freigabe_genehmigt(uuid, uuid) is
  'K-13: liegt zu dieser Kennung eine genehmigte Freigabe dieses Mandanten vor? '
  'Strukturell, ja/nein — gerufen von den Zustandsausloesern (0123, 0125).';

alter function app.freigabe_genehmigt(uuid, uuid) owner to cse_definer;
revoke execute on function app.freigabe_genehmigt(uuid, uuid) from public;
grant  execute on function app.freigabe_genehmigt(uuid, uuid) to cse_app, cse_definer;

/** Recht UND Policy — eines allein ist tot (D-388). */
grant select (id, mandant_id, status) on freigabe to cse_definer;
create policy d_freigabe_lesen on freigabe for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

/**
 * Die Uebergangstabelle aus §8.2, als Ausloeser statt als Prosa:
 *
 *   eingegangen                → in_pruefung   `lieferant_id` gesetzt
 *   eingegangen, in_pruefung   → abgelehnt     mit Grund
 *   in_pruefung                → freigegeben   eine K-13-Freigabe liegt vor
 *   freigegeben                → in_pruefung   Ruecknahme vor dem Buchen
 *   freigegeben                → gebucht       zieht die Nummer, oeffnet den Posten
 *   gebucht                    → —             Endzustand
 *
 * **Warum `gebucht` ein Endzustand ist.** Eine gebuchte Eingangsrechnung ist
 * in der Finanzbuchhaltung angekommen; korrigiert wird sie durch eine
 * Gegenbuchung (PR 58), nie durch einen Zustandswechsel. Ein Weg zurueck
 * hiesse, dass die Buchhaltung und dieses System verschiedene Wahrheiten
 * fuehren — und die Steuerberatung merkt es zuerst.
 */
create function fin.eingangsrechnung_uebergang() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'gebucht' then
    raise exception 'Eine gebuchte Eingangsrechnung wird nicht mehr umgestellt — korrigiert wird durch Gegenbuchung.'
      using errcode = 'restrict_violation';
  end if;
  if old.status = 'abgelehnt' then
    raise exception 'Eine abgelehnte Eingangsrechnung wird neu erfasst, nicht wiederbelebt.'
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'abgelehnt' then
    if old.status not in ('eingegangen', 'in_pruefung') then
      raise exception 'Ablehnen geht nur vor der Freigabe (Zustand %).', old.status
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if old.status = 'eingegangen' and new.status = 'in_pruefung' then
    if new.lieferant_id is null then
      raise exception 'Ohne Lieferant laesst sich nichts pruefen.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.status = 'in_pruefung' and new.status = 'freigegeben' then
    if new.freigabe_id is null then
      raise exception 'Eine Freigabe ohne Freigabesatz gibt es nicht (K-13, Invariante 7).'
        using errcode = 'check_violation';
    end if;
    /*
     * `genehmigt` — so heisst der Wert in `freigabe_status` (0012). Der erste
     * Entwurf verglich mit `freigegeben`, und Postgres wies das als
     * ungueltigen Enumwert ab: JEDE Freigabe waere gescheitert. Ein Test hat
     * es beim ersten Lauf gezeigt; im Betrieb waere es der Bildschirm
     * gewesen, an dem die Buchhaltung haengen bleibt.
     */
    if not app.freigabe_genehmigt(new.freigabe_id, new.mandant_id) then
      raise exception 'Der genannte Freigabesatz steht nicht auf `genehmigt` (K-13).'
        using errcode = 'check_violation';
    end if;
    new.freigegeben_am := coalesce(new.freigegeben_am, now());
    new.freigegeben_von := coalesce(new.freigegeben_von, app.aktueller_benutzer());
    return new;
  end if;

  /** Ruecknahme vor dem Buchen — protokolliert, weil sie eine Entscheidung aufhebt. */
  if old.status = 'freigegeben' and new.status = 'in_pruefung' then
    perform app.protokolliere('eingangsrechnung.freigabe_zurueckgenommen',
                              'eingangsrechnung', new.id::text,
                              jsonb_build_object('freigabe_id', old.freigabe_id), null,
                              new.mandant_id);
    new.freigabe_id := null;
    new.freigegeben_am := null;
    new.freigegeben_von := null;
    return new;
  end if;

  if old.status = 'freigegeben' and new.status = 'gebucht' then
    return new;   -- Die Nummer zieht fin.eingangsrechnung_buchen (danach).
  end if;

  raise exception 'Der Uebergang % → % ist nicht vorgesehen.', old.status, new.status
    using errcode = 'restrict_violation';
end $$;

/** `fin.er_1_uebergang`: BEFORE-Ausloeser feuern alphabetisch — dieser zuerst. */
create trigger er_1_uebergang
  before update on eingangsrechnung
  for each row execute function fin.eingangsrechnung_uebergang();

/**
 * **Das Buchen: die Nummer, die Summenprobe und der offene Posten.**
 *
 * `SELECT … FOR UPDATE` auf der Kreiszeile, wie bei der Ausgangsrechnung
 * (§5.6): die Sperre serialisiert den Kreis bis zum COMMIT, und damit ist die
 * Folge lueckenlos, auch wenn zwei Menschen gleichzeitig buchen.
 *
 * **Die Summenprobe steht HIER und nicht in einem CHECK.** Sie vergleicht den
 * Kopf mit den Steuerzeilen, also zwei Tabellen; ein CHECK kann das nicht.
 * Und sie gilt erst beim Buchen: waehrend der Erfassung darf der Kopf allein
 * stehen, weil die Extraktion (ACC-05) zuerst den Kopf vorschlaegt und die
 * Zeilen danach.
 */
create function fin.eingangsrechnung_buchen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_kreis  record;
  v_nummer bigint;
  v_netto  bigint;
  v_steuer bigint;
begin
  if new.status is not distinct from old.status or new.status <> 'gebucht' then
    return new;
  end if;

  select coalesce(sum(s.netto_cent), 0), coalesce(sum(s.steuer_cent), 0)
    into v_netto, v_steuer
    from public.eingangsrechnung_steuer s
   where s.eingangsrechnung_id = new.id and s.mandant_id = new.mandant_id;

  if v_netto = 0 and v_steuer = 0 then
    raise exception 'Ohne Steuerzeilen wird nicht gebucht — das Entgelt ist dann nicht nach Saetzen aufgeschluesselt (§14 Abs. 4 Nr. 8 UStG).'
      using errcode = 'check_violation';
  end if;
  if v_netto <> new.netto_cent or v_steuer <> new.steuer_cent then
    raise exception
      'Kopf und Steuerzeilen weichen ab: Kopf % + %, Zeilen % + %.',
      new.netto_cent, new.steuer_cent, v_netto, v_steuer
      using errcode = 'check_violation';
  end if;

  select nk.* into v_kreis
    from public.nummernkreis nk
   where nk.mandant_id = new.mandant_id
     and nk.kreis_typ = 'eingangsrechnung_beleg'
     and nk.kontext_id is null
     and nk.geschlossen_am is null
     for update;

  if not found then
    raise exception 'Fuer diese Gesellschaft ist kein Kreis `eingangsrechnung_beleg` offen.'
      using errcode = 'restrict_violation';
  end if;
  if v_kreis.ist_platzhalter then
    raise exception 'Nummernkreis %: unbestaetigt (Platzhalter) — er vergibt keine Nummer.',
      v_kreis.bezeichnung using errcode = 'restrict_violation';
  end if;

  v_nummer := v_kreis.naechste_nummer;
  update public.nummernkreis set naechste_nummer = naechste_nummer + 1 where id = v_kreis.id;

  new.nummernkreis_id     := v_kreis.id;
  new.interne_belegnummer := fin.nummer_formatieren(v_kreis.format_maske, v_nummer, v_kreis.jahr);
  new.gebucht_am          := coalesce(new.gebucht_am, now());

  return new;
end $$;

alter function fin.eingangsrechnung_buchen() owner to cse_definer;

create trigger er_2_buchen
  before update on eingangsrechnung
  for each row execute function fin.eingangsrechnung_buchen();

/**
 * Ab `gebucht` unveraenderlich — bis auf die Spalten, die die Aufbewahrung
 * und der Auditblock brauchen.
 *
 * **Erzeugte Spalten fallen aus dem Vergleich** (D-399): in einem
 * BEFORE-Ausloeser stehen sie in `new` auf NULL, und der Vergleich schluege
 * sonst auf JEDER Aenderung an — auch auf einer, die nichts aendert. Diese
 * Tabelle hat heute keine; der Ausschluss steht trotzdem, weil die naechste
 * ihn sonst wieder braeuchte und niemand daran daechte.
 */
create function fin.eingangsrechnung_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus text[];
  v_alt jsonb;
  v_neu jsonb;
  v_feld text;
begin
  if old.status <> 'gebucht' then
    return new;
  end if;

  select array['geaendert_am', 'geaendert_von', 'geaendert_von_art', 'aufbewahrung_bis']
         || coalesce(array_agg(a.attname::text), '{}')
    into v_aus
    from pg_attribute a
   where a.attrelid = 'public.eingangsrechnung'::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

  v_alt := to_jsonb(old) - v_aus;
  v_neu := to_jsonb(new) - v_aus;
  if v_alt = v_neu then return new; end if;

  select k into v_feld from jsonb_object_keys(v_neu) k
   where v_alt -> k is distinct from v_neu -> k order by k limit 1;

  raise exception
    'Eingangsrechnung %: gebucht und damit unveraenderlich — % wurde geaendert (ACC-06, LEG-01)',
    coalesce(old.interne_belegnummer, old.id::text), coalesce(v_feld, '<Spalte entfernt>')
    using errcode = 'restrict_violation',
          hint = 'Korrigiert wird durch eine Gegenbuchung, nicht durch Aenderung.';
end $$;

/** `er_3_…`: nach Uebergang und Buchen — die beiden schreiben die Spalten,
 *  die dieser Vergleich sonst als Aenderung saehe. */
create trigger er_3_unveraenderlich
  before update on eingangsrechnung
  for each row execute function fin.eingangsrechnung_unveraenderlich();

-- =========================================================================
-- 8. Der Kreditorposten — und das Ende der Schranke aus 0121
-- =========================================================================

/**
 * 0121 liess `offener_posten` bewusst nur Debitoren zu und schrieb dazu, dass
 * die Schranke in derselben Migration faellt, die `eingangsrechnung` und
 * `lieferant` bringt. Das ist diese.
 */
alter table offener_posten
  drop constraint op_bis_kreditoren_nur_debitor,
  add column eingangsrechnung_id uuid,
  add column lieferant_id        uuid;

alter table offener_posten
  add constraint op_er_fk foreign key (mandant_id, eingangsrechnung_id)
    references eingangsrechnung (mandant_id, id),
  add constraint op_lieferant_fk foreign key (mandant_id, lieferant_id)
    references lieferant (mandant_id, id),
  add constraint op_ein_beleg check (num_nonnulls(rechnung_id, eingangsrechnung_id) <= 1),
  add constraint op_lieferant_bei_kreditor check (
    (art in ('kreditor', 'kreditor_guthaben')) = (lieferant_id is not null));

create unique index op_er_uk on offener_posten (eingangsrechnung_id)
  where eingangsrechnung_id is not null;
/** Die Arbeitsliste des Zahlungslaufs. */
create index op_lieferant_idx on offener_posten (mandant_id, lieferant_id)
  where ausgeglichen_am is null;

/**
 * Der Kreditorposten entsteht mit dem BUCHEN — an der Tabelle, aus demselben
 * Grund wie beim Debitorposten (D-397): ein zweiter Schreibweg ginge sonst
 * daran vorbei, und die Gesellschaft schuldete Geld, das in keiner Liste
 * steht.
 *
 * **Der Betrag ist das BRUTTO abzueglich des §48-Einbehalts.** Anders als bei
 * der Ausgangsrechnung, wo der Einbehalt eine Zuordnung ist: hier sind WIR
 * der Zahlende. Was wir dem Lieferanten schulden, ist um den Einbehalt
 * geringer — den schulden wir dem Finanzamt, und das ist eine andere
 * Verbindlichkeit mit einem anderen Faelligkeitstag (§48a EStG).
 */
create function fin.op_kreditor_eroeffnen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_betrag bigint;
begin
  if new.status is not distinct from old.status or new.status <> 'gebucht' then
    return null;
  end if;

  v_betrag := coalesce(new.brutto_cent, 0) - new.bauabzugsteuer_cent;
  if v_betrag <= 0 then
    return null;
  end if;

  insert into public.offener_posten
    (mandant_id, art, eingangsrechnung_id, lieferant_id, betrag_cent, faellig_am,
     erstellt_von_art, erstellt_von, erstellt_von_dienst)
  values
    (new.mandant_id, 'kreditor', new.id, new.lieferant_id, v_betrag, new.faellig_am,
     'system', null, 'fin.op_kreditor_eroeffnen');

  return null;
end $$;

alter function fin.op_kreditor_eroeffnen() owner to cse_definer;

create trigger op_kreditor_eroeffnen
  after update on eingangsrechnung
  for each row execute function fin.op_kreditor_eroeffnen();

-- =========================================================================
-- 9. RLS und Rechte (§1.1–§1.5, K-03, K-04, K-05, D-388)
-- =========================================================================

alter table lieferant               enable row level security;
alter table lieferant               force  row level security;
alter table beleg                   enable row level security;
alter table beleg                   force  row level security;
alter table eingangsrechnung        enable row level security;
alter table eingangsrechnung        force  row level security;
alter table eingangsrechnung_steuer enable row level security;
alter table eingangsrechnung_steuer force  row level security;

/**
 * Vier rein interne Tische: ein Kunde sieht weder unsere Lieferanten noch
 * unsere Eingangsrechnungen. Sie tragen deshalb `p_intern_ceiling` ohne
 * Kundenzweig — und dieselbe K-03-Standardpolicy, nur mit dem Modulrecht
 * `eingang` statt `finanzen`.
 */
do $$
declare t text;
begin
  foreach t in array array['lieferant', 'beleg', 'eingangsrechnung',
                           'eingangsrechnung_steuer'] loop
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('eingang.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('eingang.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.eingang.lesen')))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;
end $$;

grant select, insert, update on beleg, eingangsrechnung to cse_app;
/**
 * Die Steuerzeilen sind waehrend der Erfassung BEWEGLICH — und danach nicht
 * mehr.
 *
 * ACC-05 schlaegt zuerst den Kopf vor und die Saetze danach; wer erfasst,
 * korrigiert die Aufteilung, bis sie stimmt. Ein `insert`-only-Recht zwaenge
 * dazu, eine falsche Zeile stehen zu lassen — und `on conflict do update`
 * scheiterte an „permission denied", was der erste Testlauf auch gezeigt hat.
 *
 * Ab `gebucht` steht die Aufteilung fest: sie IST der Vorsteuerabzug, und der
 * ist gemeldet. Das haelt der Ausloeser darunter, nicht das Recht — ein
 * Rechteentzug koennte nicht zwischen „vor" und „nach dem Buchen"
 * unterscheiden.
 */
grant select, insert, update on eingangsrechnung_steuer to cse_app;

create function fin.ers_nach_buchung_fest() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_status eingangsrechnung_status;
begin
  select er.status into v_status
    from public.eingangsrechnung er
   where er.id = coalesce(new.eingangsrechnung_id, old.eingangsrechnung_id);

  if v_status = 'gebucht' then
    raise exception
      'Die Steuerzeilen einer gebuchten Eingangsrechnung stehen fest — sie sind der gemeldete Vorsteuerabzug (§15 UStG).'
      using errcode = 'restrict_violation',
            hint = 'Korrigiert wird durch eine Gegenbuchung, nicht durch Aenderung.';
  end if;
  return new;
end $$;

create trigger ers_nach_buchung_fest
  before insert or update on eingangsrechnung_steuer
  for each row execute function fin.ers_nach_buchung_fest();

/**
 * **K-05 auf `lieferant`: die wirtschaftlichen Spalten fehlen im Grant.**
 *
 * Ein `GRANT SELECT` auf die Tabelle mit anschliessendem `REVOKE SELECT
 * (spalte)` wirkt in PostgreSQL NICHT — das Tabellenrecht deckt weiter jede
 * Spalte. Die Spalte muss von vornherein fehlen, deshalb die ausgeschriebene
 * Liste.
 *
 * Was fehlt: `iban`, `bic` (die Betrugsflaeche), `kreditorennummer` (DATEV)
 * und `zahlungsziel_tage` (die Kondition). Gelesen werden sie ueber
 * `app.lieferant_konditionen`, und der Zugriff steht im `audit_log`.
 */
revoke select on lieferant from cse_app;
grant select (id, mandant_id, firma_id, lieferantennummer, name, ust_id, steuernummer,
              strasse, hausnummer, plz, ort, land, email, telefon,
              leistungsart, ist_bauleistender_bis, status,
              verarbeitung_eingeschraenkt, anonymisiert_am, archiviert_am,
              erstellt_von_art, erstellt_von, erstellt_von_agent_id, erstellt_von_dienst,
              erstellt_am, geaendert_am, geaendert_von_art, geaendert_von)
  on lieferant to cse_app;
grant insert, update on lieferant to cse_app;

/**
 * Der schmale Leser fuer den wirtschaftlichen Block — ein Definer, der das
 * Recht NOCH EINMAL prueft, weil er nicht unter der Policy laeuft.
 *
 * **Warum EIN Tor und nicht drei.** Die Bankverbindung gehoert dem, der zahlt;
 * die Kreditorennummer dem, der bucht; die Kondition dem, der einkauft. Der
 * Rechtekatalog (K-19, `03-AUTH` §12) fuehrt dafuer heute keinen eigenen
 * Schluessel, und einen zu erfinden waere eine Aenderung am Rechtemodell in
 * einer Finanzmigration. Bis dahin gilt der engste vorhandene, der alle drei
 * Faelle deckt: `zahlung.lesen` — wer Zahlungen sieht, sieht auch, an wen sie
 * gehen.
 * TODO(client, O-183): Braucht die Bankverbindung eines Lieferanten ein
 * eigenes Recht — und wer im Haus soll sie aendern duerfen?
 */
create function app.lieferant_konditionen(p_lieferant uuid)
returns table (kreditorennummer text, iban text, bic text, zahlungsziel_tage integer)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid;
begin
  select l.mandant_id into v_mandant from public.lieferant l where l.id = p_lieferant;
  if v_mandant is null then return; end if;
  if not (v_mandant = any (app.sichtbare_mandanten())) then return; end if;
  if not app.hat_recht('zahlung.lesen', v_mandant) then return; end if;

  perform app.protokolliere('lieferant.konditionen_gelesen', 'lieferant',
                            p_lieferant::text, null, null, v_mandant);

  return query
    select l.kreditorennummer, l.iban, l.bic, l.zahlungsziel_tage
      from public.lieferant l where l.id = p_lieferant;
end $$;

alter function app.lieferant_konditionen(uuid) owner to cse_definer;
revoke execute on function app.lieferant_konditionen(uuid) from public;
grant execute on function app.lieferant_konditionen(uuid) to cse_app;

/**
 * **Und was die Ausloeser brauchen — Recht UND Policy (D-388).**
 *
 * `fin.eingangsrechnung_buchen` liest die Steuerzeilen und zieht die Nummer;
 * `fin.op_kreditor_eroeffnen` legt den Posten an (Recht und Policy dafuer
 * stehen seit 0121); `fin.lieferant_bankdaten_geaendert` und
 * `app.lieferant_konditionen` lesen `lieferant`.
 *
 * Auf `nummernkreis` haelt `cse_definer` seit 0070 Grant und Spaltenrecht —
 * es fehlen nur die POLICIES fuer den neuen Kreistyp. Die vorhandenen sind
 * auf `ausgangsrechnung`/`gutschrift` (0077) und `wachbuch` (0070) begrenzt,
 * und das ist kein Versehen: ein Definer, der jeden Kreis ziehen darf, zoege
 * beim naechsten Programmfehler den falschen.
 */
grant select on eingangsrechnung_steuer, lieferant to cse_definer;

create policy d_ers_lesen on eingangsrechnung_steuer for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_lieferant_lesen on lieferant for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

create policy d_eingangskreis_lesen on nummernkreis for select to cse_definer
  using (mandant_id = app.aktiver_mandant()
         and kreis_typ = 'eingangsrechnung_beleg');
create policy d_eingangskreis_ziehen on nummernkreis for update to cse_definer
  using      (mandant_id = app.aktiver_mandant()
              and kreis_typ = 'eingangsrechnung_beleg'
              and geschlossen_am is null
              and not ist_platzhalter)
  with check (mandant_id = app.aktiver_mandant()
              and kreis_typ = 'eingangsrechnung_beleg');

/**
 * Der Definer schreibt auf `eingangsrechnung` NICHTS: `fin.eingangsrechnung_buchen`
 * ist ein BEFORE-Ausloeser und setzt Felder auf `new`, bevor die Zeile
 * geschrieben wird — die Schreibrechte des AUFRUFERS entscheiden. Deshalb
 * steht hier kein Grant, und das ist die Entscheidung, nicht das Vergessene.
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0123)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- lieferant (archiv): FIN-14, ACC-05, ACC-07, §147 AO. Am Lieferanten haengen Eingangsrechnungen mit zehnjaehriger Aufbewahrung und der §48-EStG-Nachweis, wem gegenueber einbehalten wurde. Ihn zu loeschen macht jede Buchung darauf unlesbar; Art. 17 DSGVO wird bei einer natuerlichen Person ueber `anonymisiert_am` erfuellt, aufgeloest wird ueber `archiviert_am`.
create trigger trg_lieferant_kein_hard_delete
  before delete on lieferant
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lieferant_kein_truncate
  before truncate on lieferant
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lieferant from cse_app, cse_anon, cse_checkin, cse_job;

-- beleg (archiv): ACC-03, ACC-06, DOC-08, LEG-01, GoBD. Der Beleg IST der Nachweis zur Buchung — er nennt die Dokumentversion und ihren SHA-256. Ihn zu loeschen liesse eine Buchung ohne Beleg zurueck, und genau das ist der Mangel, den eine Betriebspruefung zuerst feststellt. Das Ausscheiden nach Fristablauf laeuft ueber `aufbewahrung_bis` und `loeschsperre`.
create trigger trg_beleg_kein_hard_delete
  before delete on beleg
  for each row execute function kern.verhindere_loeschung();
create trigger trg_beleg_kein_truncate
  before truncate on beleg
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on beleg from cse_app, cse_anon, cse_checkin, cse_job;

-- eingangsrechnung (archiv): FIN-14, ACC-05, ACC-06, LEG-01, §14b UStG. Sie traegt den Vorsteuerabzug und den §48-EStG-Einbehalt. Eine geloeschte Eingangsrechnung nimmt der Voranmeldung ihre Grundlage, und die interne Belegnummer hinterliesse eine Luecke in einem lueckenlosen Kreis. Zurueckgewiesen wird ueber `abgelehnt` mit Grund.
create trigger trg_eingangsrechnung_kein_hard_delete
  before delete on eingangsrechnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_eingangsrechnung_kein_truncate
  before truncate on eingangsrechnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on eingangsrechnung from cse_app, cse_anon, cse_checkin, cse_job;

-- eingangsrechnung_steuer (append): FIN-14, ACC-08, §15 UStG. Die Aufteilung nach Steuersaetzen IST der Vorsteuerabzug — ohne sie steht ein Bruttobetrag da, aus dem sich kein Satz mehr ableiten laesst. Sie zu loeschen aenderte die Voranmeldung ohne Spur.
create trigger trg_eingangsrechnung_steuer_kein_hard_delete
  before delete on eingangsrechnung_steuer
  for each row execute function kern.verhindere_loeschung();
create trigger trg_eingangsrechnung_steuer_kein_truncate
  before truncate on eingangsrechnung_steuer
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on eingangsrechnung_steuer from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
