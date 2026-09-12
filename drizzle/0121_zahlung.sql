/**
 * 0121 — Zahlungen, offene Posten und ihr Ausgleich (FIN-14, PR 54.1).
 *
 * `05-FINANZEN.md` §3.2 (bankkonto, kasse) und §7.1–§7.4.
 *
 * **Was bisher fehlte, und was daran teuer war.** Eine festgeschriebene
 * Rechnung war bisher das Ende der Kette: sie hatte eine Nummer, einen Hash
 * und ein Faelligkeitsdatum — und danach wusste das System nicht, ob sie
 * bezahlt wurde. Ohne diese Tabellen gibt es keine offene Forderung, also
 * keinen Mahnlauf (FIN-15), keine Wache „ueberfaellig > 14 Tage", keine
 * Alterskennzahl und kein Rechnungsausgangsbuch, das sich abstimmen laesst
 * (FIN-16). Deshalb steht dieser Schritt vor jenen und nicht daneben.
 *
 * **Vier Entscheidungen, die die Gestalt bestimmen:**
 *
 *   1. **Kein Cent-Feld traegt ein Vorzeichen.** Die Richtung steht in
 *      `zahlung.richtung` und in `offener_posten.art`. Ein Storno oeffnet
 *      deshalb `debitor_guthaben` mit positivem Betrag und nicht `debitor`
 *      mit negativem: `offen_cent` ist `betrag_cent - bezahlt_cent`, und ein
 *      negativer Posten erreichte die Null nur ueber `bezahlt_cent < 0` —
 *      was `CHECK (bezahlt_cent >= 0)` verbietet. Er stuende dann fuer immer
 *      in der Altersliste (§7.3).
 *
 *   2. **Der offene Posten entsteht an der TABELLE, nicht in der
 *      Festschreibungsfunktion.** Dieselbe Begruendung wie bei
 *      `fin.eadresse_einfrieren` (0120) und `fin.reverse_charge_pruefen`
 *      (0118, D-390): `fin.rechnung_nummer_ziehen` ist heute der eine Weg zum
 *      Festschreiben — aber nur heute. Ein Import oder ein spaeteres Skript
 *      setzt `status` und ginge daran vorbei; die Rechnung waere gestellt und
 *      stuende in keiner Forderungsliste. Genau der Fehler, den niemand
 *      bemerkt, bis das Geld ausbleibt.
 *
 *   3. **Eine Ueberzahlung wird nie stillschweigend geschluckt.** Sie oeffnet
 *      ein `debitor_guthaben` — der Kunde hat etwas gut, und das ist eine
 *      Verbindlichkeit, kein Ertrag. `fin.op_fortschreiben` weist jede
 *      Zuordnung ab, die `bezahlt_cent` ueber `betrag_cent` schoebe; nur eine
 *      ausdrueckliche `differenz` mit Begruendung darf abschliessen.
 *
 *   4. **Die IBAN-Pruefziffer steht NICHT in einem CHECK.** Der CHECK prueft
 *      die Gestalt (Laendercode, zwei Ziffern, alphanumerisch); Modulo 97
 *      rechnet `services/finanz/zahlung/iban.ts` und ein Test daneben. Ein
 *      CHECK mit Modulo-Arithmetik ueber `text` waere unlesbar, nicht
 *      testbar und bei einer neuen IBAN-Laenge eine Migration.
 *
 * **Was hier bewusst NICHT steht.** `camt_umsatz_id` auf `zahlung` (§7.1) und
 * `eingangsrechnung_id`/`lieferant_id` auf `offener_posten` (§7.3) fehlen:
 * ihre Elterntische kommen mit dem Bankimport (PR 61) und der
 * Kreditorenseite (PR 54.3). Eine Spalte ohne Elterntisch, die niemand
 * schreibt, ist genau der Befund aus PR 52.1 — vier E-Adressspalten, die seit
 * 0075 gelesen und nie geschrieben wurden. Sie kommen mit ihren Tischen.
 */

-- =========================================================================
-- 1. Die Vokabulare (§3.1)
-- =========================================================================

create type zahlung_richtung as enum ('eingang', 'ausgang');

comment on type zahlung_richtung is
  'Strukturell. Die Richtung des Geldes — nie ein Vorzeichen auf dem Betrag.';

create type zahlungsmittel as enum
  ('ueberweisung', 'lastschrift', 'bar', 'karte', 'verrechnung');

comment on type zahlungsmittel is
  'Arbeitsvokabular ohne Rechtsfolge. Der normative Code fuer die XRechnung '
  '(BT-81, UNTDID 4461) steht getrennt in rechnung.zahlungsmittel_code.';

create type zahlung_zuordnung_art as enum
  ('zahlung', 'skonto', 'gebuehr', 'differenz', 'mahngebuehr', 'zins',
   'bauabzugsteuer_einbehalt', 'ueberzahlung');

comment on type zahlung_zuordnung_art is
  'Womit ein offener Posten kleiner wird. Zwei Arten bewegen kein Geld: '
  'skonto (§17 UStG) und bauabzugsteuer_einbehalt (§48 EStG) — der Kunde '
  'behaelt ein, fuehrt ans Finanzamt ab, und die Forderung ist trotzdem '
  'erloschen.';

create type offener_posten_art as enum
  ('debitor', 'kreditor', 'debitor_guthaben', 'kreditor_guthaben');

comment on type offener_posten_art is
  'ACC-07. Die beiden guthaben-Werte tragen ein Guthaben als POSITIVEN '
  'Betrag in der Gegenrichtung — deshalb braucht keine Cent-Spalte dieser '
  'Domaene ein Vorzeichen.';

-- =========================================================================
-- 2. bankkonto (§3.2) — der Elterntisch, auf den rechnung.bankkonto_id
--    seit 0075 wartet
-- =========================================================================

create table bankkonto (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  bezeichnung           text not null check (length(btrim(bezeichnung)) > 0),

  /**
   * Gestalt, nicht Pruefziffer (siehe Kopf, Entscheidung 4). Grossbuchstaben
   * und keine Leerzeichen: die IBAN wird vom Dienst normalisiert, bevor sie
   * hier ankommt, damit `DE02 1203 …` und `de021203…` nicht als zwei Konten
   * nebeneinander stehen.
   */
  iban                  text not null
    check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic                   text check (bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),

  /** BT-85. Wird in den Rechnungs-Snapshot eingefroren. */
  kontoinhaber          text not null check (length(btrim(kontoinhaber)) > 0),

  waehrung              text not null default 'EUR' check (waehrung = 'EUR'),

  /** Das Konto, das eine neue Rechnung vorschlaegt. */
  ist_standard          boolean not null default false,

  /**
   * DATEV-Geldkonto. NULL, solange O-05 offen ist — SKR03 oder SKR04 je
   * Gesellschaft ist eine Auskunft des Steuerberaters.
   * TODO(client, O-05): Welcher Kontenrahmen je Gesellschaft, und welches
   * Sachkonto traegt dieses Bankkonto?
   */
  sachkonto             text,

  archiviert_am         timestamptz,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint bankkonto_mandant_uk unique (mandant_id, id),
  constraint bankkonto_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

/**
 * Die IBAN eines GESCHLOSSENEN Kontos muss wieder frei sein: eine Bank
 * vergibt sie nach Jahren neu, und ein Konto, das die Gesellschaft aufloest
 * und spaeter bei derselben Bank wieder eroeffnet, traegt dieselbe.
 */
create unique index bankkonto_iban_uk on bankkonto (mandant_id, iban)
  where archiviert_am is null;

create unique index bankkonto_standard_uk on bankkonto (mandant_id)
  where ist_standard and archiviert_am is null;

/**
 * **Der Elterntisch, auf den `rechnung.bankkonto_id` seit 0075 wartet.**
 *
 * Dort steht seit dem ersten Tag der Kommentar „Elterntisch `bankkonto`
 * kommt mit PR 49" — PR 49 kam und brachte ihn nicht. Die Spalte trug seither
 * einen Verweis ins Leere; sie zu fuellen war unmoeglich, weil es nichts gab,
 * worauf sie zeigen koennte.
 */
alter table rechnung
  add constraint rechnung_bankkonto_fk
    foreign key (mandant_id, bankkonto_id) references bankkonto (mandant_id, id);

/**
 * **Was auf einem Beleg steht, bleibt stehen (K-12).**
 *
 * Sobald eine festgeschriebene Rechnung dieses Konto nennt, sind IBAN, BIC
 * und Kontoinhaber unveraenderlich. Der Snapshot hat eingefroren, was die
 * Rechnung SAGT; aendert man danach den Stammsatz, widersprechen sich
 * Archivbeleg und Stammdaten, ohne dass die Hashkette bricht — der teuerste
 * Fall, weil ihn nichts meldet. Eine Aenderung ist eine NEUE Zeile plus
 * `archiviert_am`.
 *
 * **Warum `status = 'festgeschrieben'` und nicht ein Blick in
 * `rechnung_snapshot`.** Beides beschreibt dieselbe Menge — 0077 laesst keine
 * festgeschriebene Rechnung ohne Snapshot zu. Der Unterschied ist der Zugang:
 * `cse_definer` haelt auf `rechnung` seit 0077 Recht UND Policy, auf
 * `rechnung_snapshot` dagegen nur `insert`. Der Weg ueber den Snapshot
 * verlangte ein zusaetzliches Leserecht auf die Nutzlast jeder Rechnung —
 * mehr Zugriff fuer dieselbe Auskunft (D-388, K-05).
 */
create function fin.bankkonto_eingefroren() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
begin
  if new.iban         is not distinct from old.iban
 and new.bic          is not distinct from old.bic
 and new.kontoinhaber is not distinct from old.kontoinhaber then
    return new;
  end if;

  if exists (select 1 from public.rechnung r
              where r.bankkonto_id = old.id
                and r.mandant_id   = old.mandant_id
                and r.status       = 'festgeschrieben') then
    raise exception
      'Bankkonto %: IBAN, BIC und Kontoinhaber stehen auf einer festgeschriebenen Rechnung und sind unveraenderlich (K-12).',
      old.bezeichnung
      using errcode = 'restrict_violation',
            hint = 'Neues Konto anlegen und dieses archivieren.';
  end if;

  return new;
end
$$;

alter function fin.bankkonto_eingefroren() owner to cse_definer;

create trigger bankkonto_eingefroren
  before update on bankkonto
  for each row execute function fin.bankkonto_eingefroren();

-- =========================================================================
-- 3. kasse (§3.2)
-- =========================================================================

/**
 * **Warum die Kasse hier steht und das Kassenbuch nicht.**
 *
 * `zahlungsmittel` traegt `bar`, und §7.1 verlangt `CHECK (zahlungsmittel <>
 * 'bar' OR kasse_id IS NOT NULL)`. Ohne diesen Tisch waere `bar` ein Wert,
 * den niemand eintragen kann — eine Sackgasse im Vokabular.
 *
 * `kassenbewegung` — das Kassenbuch mit fortgeschriebenem Bestand und der
 * Kassensturzfaehigkeit nach GoBD — kommt dagegen mit `beleg` (PR 54.3):
 * §3.2 verlangt dort `beleg_id NOT NULL` („keine Kassenbuchung ohne Beleg"),
 * und ein Kassenbuch mit einer optionalen Belegspalte waere kein Kassenbuch.
 * Solange kein Mensch eine Kasse anlegt, ist `bar` nicht waehlbar; die Saat
 * legt keine an, weil niemand gesagt hat, dass eine existiert.
 */
create table kasse (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  bezeichnung           text not null check (length(btrim(bezeichnung)) > 0),
  standort              text,
  /** TODO(client, O-05): Welches Sachkonto traegt diese Kasse? */
  sachkonto             text,
  archiviert_am         timestamptz,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint kasse_mandant_uk unique (mandant_id, id),
  constraint kasse_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create unique index kasse_bezeichnung_uk on kasse (mandant_id, bezeichnung)
  where archiviert_am is null;

comment on table kasse is
  'Eine Barkasse einer Gesellschaft. Das Kassenbuch (kassenbewegung, §3.2) '
  'kommt mit beleg in PR 54.3 — es verlangt zu jeder Bewegung einen Beleg.';

-- =========================================================================
-- 4. offener_posten (§7.3) — die gefuehrte Projektion
-- =========================================================================

create table offener_posten (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  art                   offener_posten_art not null,

  rechnung_id           uuid,
  kunde_id              uuid,

  /**
   * `abs(zahlbetrag_cent)` beim Festschreiben — EINSCHLIESSLICH eines
   * §48-EStG-Einbehalts (§4.1). Der Einbehalt loescht die Forderung, aber er
   * kommt nicht als Geld: der Kunde fuehrt ihn ans Finanzamt ab. Er wird
   * deshalb als Zuordnung `bauabzugsteuer_einbehalt` gebucht und nicht vorab
   * vom Posten abgezogen — sonst stuende in der Forderungsliste ein Betrag,
   * den keine Rechnung ausweist.
   */
  betrag_cent           bigint not null check (betrag_cent > 0),
  bezahlt_cent          bigint not null default 0 check (bezahlt_cent >= 0),
  offen_cent            bigint not null
    generated always as (betrag_cent - bezahlt_cent) stored,

  faellig_am            date not null,

  letzte_mahnstufe      integer not null default 0 check (letzte_mahnstufe >= 0),
  letzte_mahnung_am     date,
  /** Eine Sperre je Posten, zusaetzlich zu `kunde.mahnsperre_bis`. */
  mahnsperre_bis        date,

  ausgeglichen_am       date,

  /**
   * Wann die naechtliche Abstimmung diese Zeile zuletzt gegen die Ableitung
   * (`offener_posten_berechnet`, §10) gehalten hat. Geschrieben von
   * `cse_job` — und NUR diese eine Spalte: ein Pruefer, der repariert, kann
   * anschliessend nichts mehr bezeugen (§5.7, dieselbe Regel wie beim
   * Kettenlauf).
   */
  neu_berechnet_am      timestamptz,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint op_mandant_uk unique (mandant_id, id),
  constraint op_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  /**
   * **Bis die Kreditorenseite kommt, gibt es nur Debitoren.**
   *
   * `art` traegt `kreditor` und `kreditor_guthaben`, weil das Vokabular
   * normativ aus §3.1 stammt. Die Spalten, die einen Kreditorposten
   * zuordenbar machen — `eingangsrechnung_id` und `lieferant_id` — kommen
   * mit ihren Elterntischen in PR 54.3. Bis dahin waere ein `kreditor` eine
   * Verbindlichkeit ohne Glaeubiger. Diese Schranke faellt in derselben
   * Migration, in der die beiden Spalten dazukommen.
   */
  constraint op_bis_kreditoren_nur_debitor check (art in ('debitor', 'debitor_guthaben')),

  constraint op_kunde_bei_debitor check ((art in ('debitor', 'debitor_guthaben')) = (kunde_id is not null)),
  constraint op_ausgleich_stimmig check ((ausgeglichen_am is not null) = (betrag_cent - bezahlt_cent = 0)),

  constraint op_rechnung_fk foreign key (mandant_id, rechnung_id) references rechnung (mandant_id, id),
  constraint op_kunde_fk    foreign key (mandant_id, kunde_id)    references kunde (mandant_id, id)
);

/** Eine Rechnung oeffnet genau EINEN Posten — auch bei zwei Schreibwegen. */
create unique index op_rechnung_uk on offener_posten (rechnung_id)
  where rechnung_id is not null;

/** Der Mahnlauf und die Wache „ueberfaellig > 14 Tage". */
create index op_faellig_idx on offener_posten (mandant_id, art, faellig_am)
  where ausgeglichen_am is null;

/** Die offenen Posten eines Kunden (DSH-04). */
create index op_kunde_idx on offener_posten (mandant_id, kunde_id)
  where ausgeglichen_am is null;

comment on table offener_posten is
  'ACC-07. Eine GEFUEHRTE PROJEKTION, keine Quelle der Wahrheit: der '
  'naechtliche Abgleich haelt jede Zeile gegen offener_posten_berechnet und '
  'meldet Abweichung. Gespeichert, weil der Mahnlauf sich erinnern muss, was '
  'er gemahnt hat, und eine Altersliste nachtraeglich reproduzierbar bleiben '
  'muss.';

-- =========================================================================
-- 5. zahlung (§7.1)
-- =========================================================================

create table zahlung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  richtung              zahlung_richtung not null,
  /** Die Richtung steht in `richtung`, nie im Vorzeichen (Kopf, Punkt 1). */
  betrag_cent           bigint not null check (betrag_cent > 0),
  waehrung              text not null default 'EUR' check (waehrung = 'EUR'),

  /** Buchungstag — Berliner Kalendertag (K-11, §1.8). */
  zahlungsdatum         date not null,
  /** Wertstellung. NULL, solange der Auszug sie nicht nennt. */
  valuta                date,

  zahlungsmittel        zahlungsmittel not null,
  bankkonto_id          uuid,
  kasse_id              uuid,

  /** End-to-End-Referenz oder Quittungsnummer. */
  referenz              text,
  notiz                 text,

  storniert_am          timestamptz,
  storno_grund          text,
  storniert_durch_id    uuid,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint zahlung_mandant_uk unique (mandant_id, id),
  constraint zahlung_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint zahlung_ein_geldkonto check (num_nonnulls(bankkonto_id, kasse_id) <= 1),
  constraint zahlung_bar_braucht_kasse check (zahlungsmittel <> 'bar' or kasse_id is not null),
  constraint zahlung_storno_stimmig check (
    (storniert_am is null) = (storno_grund is null)
    and (storno_grund is null or length(btrim(storno_grund)) >= 5)),

  constraint zahlung_bankkonto_fk foreign key (mandant_id, bankkonto_id) references bankkonto (mandant_id, id),
  constraint zahlung_kasse_fk     foreign key (mandant_id, kasse_id)     references kasse (mandant_id, id),
  constraint zahlung_storno_fk    foreign key (mandant_id, storniert_durch_id) references zahlung (mandant_id, id)
);

/** Die Kassensicht (DSH-01). */
create index zahlung_datum_idx on zahlung (mandant_id, zahlungsdatum desc);
create index zahlung_bankkonto_idx on zahlung (mandant_id, bankkonto_id, zahlungsdatum)
  where bankkonto_id is not null;

comment on table zahlung is
  'FIN-14. Ein ERFASSTES Zahlungsereignis. Die Plattform erfasst Zahlungen; '
  'sie loest keine aus — es gibt keine Bankanbindung, und ein Auslesestatus '
  'waere eine Luege im Schema (keine erfundenen Integrationen).';

-- =========================================================================
-- 6. zahlung_zuordnung (§7.2)
-- =========================================================================

create table zahlung_zuordnung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /**
   * NULL bei den beiden Arten, die kein Geld bewegen: `skonto` (§17 UStG) und
   * `bauabzugsteuer_einbehalt` (§48 EStG).
   */
  zahlung_id            uuid,
  /** Die Zuordnung zielt auf den POSTEN, nicht auf das Dokument. */
  offener_posten_id     uuid not null,

  art                   zahlung_zuordnung_art not null,
  betrag_cent           bigint not null check (betrag_cent > 0),

  /** Beim Skonto Pflicht: die §17-Korrektur gilt je Steuersatzgruppe. */
  steuersatz_gruppe_id  uuid references steuersatz_gruppe(id),
  skonto_netto_cent     bigint,
  skonto_steuer_cent    bigint,

  notiz                 text,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint zz_mandant_uk unique (mandant_id, id),
  constraint zz_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  /**
   * Ein abgeschriebener Rest sagt, warum. Ohne diese Pflicht steht in der
   * Auswertung „Differenz 340,00 EUR" und niemand weiss mehr, ob das eine
   * Bankgebuehr, ein Streitfall oder ein Tippfehler war.
   */
  constraint zz_differenz_begruendet check (art <> 'differenz' or length(btrim(coalesce(notiz, ''))) >= 5),

  constraint zz_skonto_vollstaendig check (
    art <> 'skonto'
    or (steuersatz_gruppe_id is not null
        and skonto_netto_cent is not null and skonto_steuer_cent is not null
        and skonto_netto_cent + skonto_steuer_cent = betrag_cent)),

  constraint zz_geldlos_nur_zwei check (
    art in ('skonto', 'bauabzugsteuer_einbehalt') or zahlung_id is not null),

  constraint zz_zahlung_fk foreign key (mandant_id, zahlung_id) references zahlung (mandant_id, id),
  constraint zz_posten_fk  foreign key (mandant_id, offener_posten_id) references offener_posten (mandant_id, id)
);

create index zz_zahlung_idx on zahlung_zuordnung (zahlung_id) where zahlung_id is not null;
create index zz_posten_idx  on zahlung_zuordnung (mandant_id, offener_posten_id);
/** Der Abschreibungsbericht. */
create index zz_differenz_idx on zahlung_zuordnung (mandant_id, art) where art = 'differenz';

-- =========================================================================
-- 7. op_ausgleich (§7.4)
-- =========================================================================

/**
 * Posten gegen Posten, ohne eine Zahlung zu erfinden.
 *
 * Ohne diesen Tisch endet die gewoehnliche Korrekturfolge — festschreiben,
 * Kunde widerspricht, Storno, neu ausstellen — mit zwei offenen Posten, die
 * sich nur schliessen liessen, indem jemand eine Zahlung erfasst, die nie
 * stattgefunden hat. Die Altersliste waere dauerhaft falsch, und die Wache
 * mahnte eine stornierte Rechnung an.
 */
create table op_ausgleich (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /** Der Posten, der kleiner wird. */
  op_soll_id            uuid not null,
  /** Der Posten, der ihn kleiner macht. */
  op_haben_id           uuid not null,
  betrag_cent           bigint not null check (betrag_cent > 0),

  grund                 text not null check (length(btrim(grund)) >= 5),
  rechnung_beziehung_id uuid,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint opa_mandant_uk unique (mandant_id, id),
  constraint opa_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint opa_nicht_auf_sich_selbst check (op_soll_id <> op_haben_id),

  constraint opa_soll_fk  foreign key (mandant_id, op_soll_id)  references offener_posten (mandant_id, id),
  constraint opa_haben_fk foreign key (mandant_id, op_haben_id) references offener_posten (mandant_id, id),
  constraint opa_beziehung_fk foreign key (mandant_id, rechnung_beziehung_id)
    references rechnung_beziehung (mandant_id, id)
);

create index opa_soll_idx  on op_ausgleich (mandant_id, op_soll_id);
create index opa_haben_idx on op_ausgleich (mandant_id, op_haben_id);

-- =========================================================================
-- 8. Der offene Posten entsteht mit der Festschreibung (§7.3)
-- =========================================================================

/**
 * **Warum AFTER UPDATE auf `rechnung` und nicht in
 * `fin.rechnung_nummer_ziehen`.** Siehe Kopf, Entscheidung 2. Ein zweiter
 * Schreibweg ginge an der Funktion vorbei; an der Tabelle geht nichts vorbei.
 *
 * **Warum ein Betrag von 0 keinen Posten oeffnet.** Eine Rechnung ueber
 * 0,00 EUR — eine Schlussrechnung, deren Abschlaege sie vollstaendig
 * aufzehren — fordert nichts. Ein Posten mit `betrag_cent = 0` verstiesse
 * ohnehin gegen `CHECK (betrag_cent > 0)`, und ein Posten, der schon bei der
 * Geburt ausgeglichen ist, sagt niemandem etwas.
 *
 * **Der Akteur ist `system` und das ist keine Bequemlichkeit.** Der Mensch
 * hat die RECHNUNG festgeschrieben; den Posten hat niemand angelegt, er folgt
 * aus dem Beleg. Ihn dem Festschreibenden zuzuschreiben behauptete eine
 * Entscheidung, die er nicht getroffen hat (§1.6).
 */
create function fin.op_eroeffnen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_art offener_posten_art;
begin
  if new.status is not distinct from old.status or new.status <> 'festgeschrieben' then
    return null;
  end if;

  if new.zahlbetrag_cent = 0 then
    return null;
  end if;

  v_art := case when new.zahlbetrag_cent > 0 then 'debitor' else 'debitor_guthaben' end;

  insert into public.offener_posten
    (mandant_id, art, rechnung_id, kunde_id, betrag_cent, faellig_am,
     erstellt_von_art, erstellt_von, erstellt_von_dienst)
  values
    (new.mandant_id, v_art, new.id, new.kunde_id, abs(new.zahlbetrag_cent), new.faellig_am,
     'system', null, 'fin.op_eroeffnen');

  return null;
end
$$;

alter function fin.op_eroeffnen() owner to cse_definer;

create trigger op_eroeffnen
  after update on rechnung
  for each row execute function fin.op_eroeffnen();

-- =========================================================================
-- 9. Die Fortschreibung (§7.2, §7.4)
-- =========================================================================

/**
 * Eine Zuordnung macht einen Posten kleiner — oder sie wird abgewiesen.
 *
 * **Drei Faelle, und jeder davon ist ein Fehler, den sonst niemand bemerkt:**
 *
 *   (a) Eine Zuordnung, die `bezahlt_cent` ueber `betrag_cent` schoebe, wird
 *       ABGEWIESEN. Ohne diesen Riegel verschwindet eine Ueberzahlung
 *       geraeuschlos in einem Posten, der dann „mehr als bezahlt" ist — und
 *       der Kunde bekommt sein Geld nie zurueck, weil es niemand sieht.
 *       Ausnahme ist `differenz`: eine ausdrueckliche Abschreibung mit
 *       Begruendung, und auch die nur bis zur Hoehe des Restes.
 *
 *   (b) `ueberzahlung` beruehrt `bezahlt_cent` NICHT. Diese Zeile ERZEUGT
 *       das Guthaben, sie gleicht es nicht aus: der Kunde hat etwas gut, und
 *       ein Guthaben, das im selben Atemzug als bezahlt gilt, waere keines.
 *       Sie darf nur auf einem `*_guthaben`-Posten stehen, und die Summe
 *       ihrer Zeilen darf dessen Betrag nicht uebersteigen.
 *
 *   (c) Die Summe der Zuordnungen einer Zahlung darf die Zahlung nicht
 *       uebersteigen. Sonst verteilt ein Mensch 1.200 EUR auf drei Rechnungen
 *       zu je 500 EUR, und die Buchhaltung stimmt an keiner Stelle mehr.
 *
 * Die Zeile wird mit `for update` gesperrt: zwei gleichzeitige Zuordnungen
 * auf denselben Posten lesen sonst beide denselben Stand und schreiben beide
 * dieselbe Summe.
 */
create function fin.op_fortschreiben() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_op        record;
  v_neu       bigint;
  v_summe     bigint;
  v_zahlung   record;
begin
  select * into v_op from public.offener_posten
   where id = new.offener_posten_id and mandant_id = new.mandant_id
     for update;
  if not found then
    raise exception 'Offener Posten % ist nicht erreichbar — die Zuordnung schriebe ins Leere.',
      new.offener_posten_id using errcode = 'foreign_key_violation';
  end if;

  /**
   * (c) Die Zahlung deckt, was von ihr abgeht — und NUR das.
   *
   * **Vier der acht Arten bewegen kein Geld**, und sie duerfen die Summe
   * deshalb nicht belasten: `skonto` (§17 UStG) und
   * `bauabzugsteuer_einbehalt` (§48 EStG) tragen gar keine Zahlung;
   * `differenz` und `gebuehr` haengen an einer, beschreiben aber genau das
   * Geld, das NICHT ankam — die abgeschriebene Restforderung und die
   * Bankgebuehr, die der Ueberweisung unterwegs abgezogen wurde.
   *
   * Zaehlte man sie mit, waere der haeufigste Alltagsfall unbuchbar: 1.189,00
   * EUR kommen auf eine Rechnung ueber 1.190,00 EUR, der eine Euro wird
   * abgeschrieben — Summe der Zuordnungen 1.190,00 EUR, Zahlung 1.189,00 EUR,
   * und der Riegel wiese die Buchung ab, die richtig ist. Die erste Fassung
   * tat genau das; ein Test hat es gezeigt.
   *
   * Die Sperre steht trotzdem vor der Fallunterscheidung: sie serialisiert
   * die Zahlung, damit zwei gleichzeitige Zuordnungen nicht beide denselben
   * Stand lesen.
   */
  if new.zahlung_id is not null then
    select * into v_zahlung from public.zahlung
     where id = new.zahlung_id and mandant_id = new.mandant_id
       for update;
    if not found then
      raise exception 'Zahlung % ist nicht erreichbar.', new.zahlung_id
        using errcode = 'foreign_key_violation';
    end if;
    if v_zahlung.storniert_am is not null then
      raise exception 'Zahlung % ist storniert und traegt keine Zuordnung mehr.', new.zahlung_id
        using errcode = 'check_violation';
    end if;
    if new.art in ('zahlung', 'mahngebuehr', 'zins', 'ueberzahlung') then
      select coalesce(sum(z.betrag_cent), 0) into v_summe
        from public.zahlung_zuordnung z
       where z.zahlung_id = new.zahlung_id
         and z.art in ('zahlung', 'mahngebuehr', 'zins', 'ueberzahlung');
      if v_summe > v_zahlung.betrag_cent then
        raise exception
          'Die Zuordnungen dieser Zahlung ergeben % Cent, die Zahlung betraegt % Cent.',
          v_summe, v_zahlung.betrag_cent using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- (b) Das Guthaben entsteht, es wird nicht ausgeglichen.
  if new.art = 'ueberzahlung' then
    if v_op.art not in ('debitor_guthaben', 'kreditor_guthaben') then
      raise exception
        'Eine Ueberzahlung gehoert auf einen Guthabenposten, nicht auf einen %.', v_op.art
        using errcode = 'check_violation';
    end if;
    select coalesce(sum(z.betrag_cent), 0) into v_summe
      from public.zahlung_zuordnung z
     where z.offener_posten_id = new.offener_posten_id and z.art = 'ueberzahlung';
    if v_summe > v_op.betrag_cent then
      raise exception
        'Die Ueberzahlungen auf diesem Guthaben ergeben % Cent, das Guthaben betraegt % Cent.',
        v_summe, v_op.betrag_cent using errcode = 'check_violation';
    end if;
    return null;
  end if;

  -- (a) Kein Posten wird ueberzahlt.
  v_neu := v_op.bezahlt_cent + new.betrag_cent;
  if v_neu > v_op.betrag_cent then
    raise exception
      'Zuordnung ueber % Cent auf einen Posten mit % Cent Rest. Eine Ueberzahlung wird als Guthaben gefuehrt, nicht eingerechnet.',
      new.betrag_cent, v_op.betrag_cent - v_op.bezahlt_cent
      using errcode = 'check_violation',
            hint = 'Den Rest der Zahlung als art = ueberzahlung auf einen Guthabenposten buchen.';
  end if;

  update public.offener_posten
     set bezahlt_cent    = v_neu,
         ausgeglichen_am = case when v_neu = betrag_cent then app.berlin_heute() else null end
   where id = v_op.id;

  return null;
end
$$;

alter function fin.op_fortschreiben() owner to cse_definer;

create trigger op_fortschreiben
  after insert on zahlung_zuordnung
  for each row execute function fin.op_fortschreiben();

/**
 * Ein Ausgleich wirkt auf BEIDE Posten — und genau deshalb sind beide Betraege
 * positiv (§7.4). Ein negativer Posten liesse sich von keiner Seite auf null
 * bringen.
 *
 * Die Sperrreihenfolge ist nach `id` sortiert und nicht Soll-vor-Haben: zwei
 * gleichzeitige Ausgleiche ueber dieselben zwei Posten, einmal in jeder
 * Richtung gebucht, ergaeben sonst eine Verklemmung.
 */
create function fin.op_ausgleich_fortschreiben() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_erst  record;
  v_zweit record;
  v_soll  record;
  v_haben record;
begin
  select * into v_erst from public.offener_posten
   where mandant_id = new.mandant_id
     and id = least(new.op_soll_id, new.op_haben_id) for update;
  select * into v_zweit from public.offener_posten
   where mandant_id = new.mandant_id
     and id = greatest(new.op_soll_id, new.op_haben_id) for update;

  if v_erst is null or v_zweit is null then
    raise exception 'Ein Ausgleich verlangt zwei erreichbare Posten desselben Mandanten.'
      using errcode = 'foreign_key_violation';
  end if;

  if new.op_soll_id = v_erst.id then
    v_soll := v_erst; v_haben := v_zweit;
  else
    v_soll := v_zweit; v_haben := v_erst;
  end if;

  if new.betrag_cent > v_soll.betrag_cent - v_soll.bezahlt_cent then
    raise exception 'Ausgleich ueber % Cent, der Sollposten hat nur % Cent offen.',
      new.betrag_cent, v_soll.betrag_cent - v_soll.bezahlt_cent using errcode = 'check_violation';
  end if;
  if new.betrag_cent > v_haben.betrag_cent - v_haben.bezahlt_cent then
    raise exception 'Ausgleich ueber % Cent, der Habenposten hat nur % Cent offen.',
      new.betrag_cent, v_haben.betrag_cent - v_haben.bezahlt_cent using errcode = 'check_violation';
  end if;

  /**
   * Bei einem Storno-Ausgleich muessen beide Posten demselben Kunden
   * gehoeren. Ohne diese Pruefung liesse sich die Gutschrift des einen Kunden
   * gegen die Forderung eines anderen verrechnen — ein Vorgang, den §387 BGB
   * nicht deckt und den O-182 fuer den gewollten Fall erst noch klaeren muss.
   */
  if new.rechnung_beziehung_id is not null
     and v_soll.kunde_id is distinct from v_haben.kunde_id then
    raise exception 'Ein Storno-Ausgleich laeuft zwischen Posten DESSELBEN Kunden.'
      using errcode = 'check_violation';
  end if;

  update public.offener_posten
     set bezahlt_cent    = bezahlt_cent + new.betrag_cent,
         ausgeglichen_am = case when bezahlt_cent + new.betrag_cent = betrag_cent
                                then app.berlin_heute() else null end
   where mandant_id = new.mandant_id and id in (new.op_soll_id, new.op_haben_id);

  return null;
end
$$;

alter function fin.op_ausgleich_fortschreiben() owner to cse_definer;

create trigger op_ausgleich_fortschreiben
  after insert on op_ausgleich
  for each row execute function fin.op_ausgleich_fortschreiben();

/**
 * **Die Rueckabwicklung: eine stornierte Zahlung gibt ihre Posten frei.**
 *
 * §7.2 kennt keine geloeschte Zuordnung — eine falsche Zuordnung wird
 * zurueckgenommen, indem die ZAHLUNG storniert wird. Ohne diesen Ausloeser
 * bliebe der Posten ausgeglichen, obwohl das Geld zurueckgebucht wurde: eine
 * Forderung, die niemand mehr mahnt, weil sie als bezahlt gilt.
 *
 * `ueberzahlung`-Zeilen sind ausgenommen, weil sie `bezahlt_cent` nie erhoeht
 * haben (siehe `fin.op_fortschreiben`, Fall b).
 */
create function fin.zahlung_storniert() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_zeile record;
begin
  if old.storniert_am is not null or new.storniert_am is null then
    return null;
  end if;

  for v_zeile in
    select z.offener_posten_id as posten, sum(z.betrag_cent) as summe
      from public.zahlung_zuordnung z
     where z.zahlung_id = new.id and z.art <> 'ueberzahlung'
     group by z.offener_posten_id
     order by z.offener_posten_id
  loop
    update public.offener_posten
       set bezahlt_cent    = bezahlt_cent - v_zeile.summe,
           ausgeglichen_am = case when bezahlt_cent - v_zeile.summe = betrag_cent
                                  then app.berlin_heute() else null end
     where mandant_id = new.mandant_id and id = v_zeile.posten;
  end loop;

  return null;
end
$$;

alter function fin.zahlung_storniert() owner to cse_definer;

create trigger zahlung_storniert
  after update on zahlung
  for each row execute function fin.zahlung_storniert();

/**
 * Eine gebundene Zahlung wird nicht mehr umgeschrieben (§7.1).
 *
 * Sobald eine Zuordnung existiert, sind Betrag, Richtung, Datum, Geldkonto
 * und Zahlungsmittel fest. Aenderbar bleiben `notiz` und die drei
 * `storno_*`-Spalten — der eine Weg, eine falsche Erfassung
 * zurueckzunehmen, ohne eine Zeile zu verlieren (Invariante 8).
 */
create function fin.zahlung_gebunden() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
begin
  if not exists (select 1 from public.zahlung_zuordnung z where z.zahlung_id = old.id) then
    return new;
  end if;

  if new.richtung        is distinct from old.richtung
  or new.betrag_cent     is distinct from old.betrag_cent
  or new.waehrung        is distinct from old.waehrung
  or new.zahlungsdatum   is distinct from old.zahlungsdatum
  or new.valuta          is distinct from old.valuta
  or new.zahlungsmittel  is distinct from old.zahlungsmittel
  or new.bankkonto_id    is distinct from old.bankkonto_id
  or new.kasse_id        is distinct from old.kasse_id
  or new.referenz        is distinct from old.referenz then
    raise exception
      'Diese Zahlung ist bereits zugeordnet. Aenderbar sind nur die Notiz und die Stornierung.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end
$$;

alter function fin.zahlung_gebunden() owner to cse_definer;

create trigger zahlung_gebunden
  before update on zahlung
  for each row execute function fin.zahlung_gebunden();

/**
 * Was auf dem Posten aus dem Beleg stammt, bleibt aus dem Beleg.
 *
 * `betrag_cent`, `art`, `faellig_am` und die beiden Verweise sind eingefroren:
 * sie sind der Beleg, nicht die Buchhaltung darum herum. Beweglich sind nur
 * die Spalten, die den FORTSCHRITT tragen — und die schreibt der Ausloeser.
 */
create function fin.op_unveraenderlich() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
begin
  if new.art          is distinct from old.art
  or new.rechnung_id  is distinct from old.rechnung_id
  or new.kunde_id     is distinct from old.kunde_id
  or new.betrag_cent  is distinct from old.betrag_cent
  or new.faellig_am   is distinct from old.faellig_am
  or new.mandant_id   is distinct from old.mandant_id then
    raise exception
      'Betrag, Art, Faelligkeit und Bezug eines offenen Postens stammen vom Beleg und sind unveraenderlich.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end
$$;

alter function fin.op_unveraenderlich() owner to cse_definer;

create trigger op_unveraenderlich
  before update on offener_posten
  for each row execute function fin.op_unveraenderlich();

-- =========================================================================
-- 10. Die Ableitung, gegen die der naechtliche Lauf prueft (§7.3, §10)
-- =========================================================================

/**
 * **Warum es diese Sicht gibt, obwohl die Tabelle die Zahlen schon traegt.**
 *
 * `offener_posten` ist eine GEFUEHRTE Projektion: die Ausloeser schreiben
 * `bezahlt_cent` fort, damit der Mahnlauf sich erinnern kann und eine
 * Altersliste nachtraeglich reproduzierbar bleibt. Eine fortgeschriebene Zahl
 * ist aber nur so richtig wie der Ausloeser, der sie schreibt — und ein
 * Rechenfehler dort faellt sonst erst beim Jahresabschluss auf, wenn niemand
 * mehr weiss, welche Buchung ihn erzeugt hat.
 *
 * Diese Sicht rechnet dieselbe Zahl NOCH EINMAL, aus den Belegzeilen. Der
 * naechtliche Lauf haelt beide gegeneinander und meldet die Abweichung
 * namentlich. Dieselbe Bauart wie beim Kettenlauf (§5.7): zwei Wege zu
 * derselben Zahl, mit Absicht.
 *
 * `security_invoker` (§1.12): die Sicht sieht genau so viel wie der, der sie
 * liest — sonst waere sie ein Loch in der Mandantentrennung.
 */
create view offener_posten_berechnet with (security_invoker = true) as
select
  op.id,
  op.mandant_id,
  op.betrag_cent,
  op.bezahlt_cent as bezahlt_gefuehrt_cent,
  coalesce(zz.summe, 0) + coalesce(aus.summe, 0) as bezahlt_berechnet_cent,
  op.bezahlt_cent - (coalesce(zz.summe, 0) + coalesce(aus.summe, 0)) as abweichung_cent,
  op.ausgeglichen_am
from offener_posten op
left join lateral (
  /**
   * `ueberzahlung` zaehlt NICHT mit: diese Zeile erzeugt das Guthaben, sie
   * gleicht es nicht aus (§7.2). Zaehlte sie mit, meldete der Lauf auf jedem
   * Guthabenposten eine Abweichung — und eine Wache, die jede Nacht dasselbe
   * falsch meldet, wird abgeschaltet.
   *
   * Zuordnungen einer STORNIERTEN Zahlung zaehlen ebenfalls nicht: der
   * Ausloeser `fin.zahlung_storniert` hat sie aus `bezahlt_cent`
   * herausgerechnet, und die Ableitung muss dieselbe Menge sehen.
   */
  select sum(z.betrag_cent) as summe
    from zahlung_zuordnung z
    left join zahlung za on za.id = z.zahlung_id and za.mandant_id = z.mandant_id
   where z.offener_posten_id = op.id
     and z.mandant_id        = op.mandant_id
     and z.art <> 'ueberzahlung'
     and (z.zahlung_id is null or za.storniert_am is null)
) zz on true
left join lateral (
  select sum(a.betrag_cent) as summe
    from op_ausgleich a
   where a.mandant_id = op.mandant_id
     and op.id in (a.op_soll_id, a.op_haben_id)
) aus on true;

comment on view offener_posten_berechnet is
  'ACC-07. Die unabhaengige Nachrechnung von offener_posten.bezahlt_cent aus '
  'den Belegzeilen. abweichung_cent <> 0 ist ein Befund, den der naechtliche '
  'Lauf meldet — er repariert nicht.';

-- =========================================================================
-- 11. RLS und Rechte (§1.1–§1.5, K-03, K-04, K-05, D-388)
-- =========================================================================

alter table bankkonto        enable row level security;
alter table bankkonto        force  row level security;
alter table kasse            enable row level security;
alter table kasse            force  row level security;
alter table zahlung          enable row level security;
alter table zahlung          force  row level security;
alter table offener_posten   enable row level security;
alter table offener_posten   force  row level security;
alter table zahlung_zuordnung enable row level security;
alter table zahlung_zuordnung force  row level security;
alter table op_ausgleich     enable row level security;
alter table op_ausgleich     force  row level security;

/**
 * **Die vier internen Tische: derselbe Satz, geschrieben durch eine Schleife.**
 *
 * `bankkonto`, `kasse`, `zahlung` und `op_ausgleich` sind rein intern — ein
 * Kunde sieht weder das Bankkonto der Gesellschaft noch eine Verrechnung
 * zwischen zwei Posten. Sie tragen deshalb `p_intern_ceiling` ohne
 * Kundenzweig; `offener_posten` und `zahlung_zuordnung` bekommen ihre Policies
 * einzeln, weil dort ein Kunde in genau einem Fall etwas sehen darf.
 */
do $$
declare t text;
begin
  foreach t in array array['bankkonto', 'kasse', 'zahlung', 'op_ausgleich'] loop
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('zahlung.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('zahlung.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.zahlung.lesen')))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;
end $$;

grant select, insert, update on bankkonto, kasse, zahlung to cse_app;
/** Append-only (§7.4): ein Ausgleich wird nicht umgeschrieben. */
grant select, insert on op_ausgleich to cse_app;

/**
 * **`offener_posten` — lesen darf das Portal, schreiben duerfen die Ausloeser.**
 *
 * Es gibt KEINE INSERT-Policy fuer `cse_app`. Ein offener Posten entsteht aus
 * einem Beleg und aus nichts sonst; ein von Hand angelegter waere eine
 * Forderung ohne Rechnung — und die mahnte der Lauf anschliessend an.
 *
 * Beweglich ist genau eine Spalte: `mahnsperre_bis`. Sie ist eine
 * Mahnentscheidung und verlangt deshalb `mahnung.schreiben`, nicht
 * `zahlung.schreiben`. Das Spaltenrecht (K-05) macht die Policy scharf: auch
 * wer sie haelt, kann `betrag_cent` nicht anfassen.
 */
create policy t_mandant_lesen on offener_posten for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zahlung.lesen', app.aktiver_mandant())));

create policy t_mahnsperre on offener_posten for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('mahnung.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('mahnung.schreiben', app.aktiver_mandant())));

create policy t_gruppe on offener_posten for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zahlung.lesen')));

/**
 * K-18: das Kundenportal sieht die eigene offene Forderung — und nur die
 * Forderung. Ein Guthaben, eine Mahnstufe oder eine Mahnsperre gehen den
 * Kunden nichts an; sie stehen in Spalten, die er nicht liest (K-05).
 */
create policy t_kunde on offener_posten for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and art = 'debitor'
         and kunde_id = any (app.aktuelle_kunden()));

create policy p_op_decke on offener_posten as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and art = 'debitor'
             and kunde_id = any (app.aktuelle_kunden())))
  with check (app.portal() = 'intern');

grant select on offener_posten to cse_app;
grant update (mahnsperre_bis) on offener_posten to cse_app;

/**
 * `zahlung_zuordnung` — der Kundenzweig laeuft DURCH DEN POSTEN (review B18,
 * wie bei den Kindtabellen der Rechnung). Ohne ihn zeigte das Kundenportal
 * eine Rechnung als „teilweise bezahlt" ohne die Zeilen, aus denen sich das
 * ergibt: genau der Bildschirm, nach dem ein Kunde anruft.
 *
 * Der Kunde sieht dabei NICHT, warum ein Rest abgeschrieben wurde — `notiz`
 * ist kein Kundenfeld. Die Spaltenrechte bleiben trotzdem grob, weil eine
 * zweite Spaltenliste je Rolle hier mehr Fehler erzeugte als sie verhindert;
 * die Sicht des Kundenportals waehlt die Spalten aus, die sie zeigt.
 */
create policy t_mandant on zahlung_zuordnung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zahlung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zahlung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on zahlung_zuordnung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zahlung.lesen')));

create policy t_kunde on zahlung_zuordnung for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from offener_posten op
                      where op.mandant_id = zahlung_zuordnung.mandant_id
                        and op.id         = zahlung_zuordnung.offener_posten_id
                        and op.art        = 'debitor'
                        and op.kunde_id   = any (app.aktuelle_kunden())));

create policy p_zz_decke on zahlung_zuordnung as restrictive for all to cse_app
  using (app.portal() = 'intern'
         or (app.portal() = 'kunde'
             and exists (select 1 from offener_posten op
                          where op.mandant_id = zahlung_zuordnung.mandant_id
                            and op.id         = zahlung_zuordnung.offener_posten_id
                            and op.art        = 'debitor'
                            and op.kunde_id   = any (app.aktuelle_kunden()))))
  with check (app.portal() = 'intern');

/** Append-only (§7.2): eine falsche Zuordnung wird ueber den Zahlungsstorno
 *  zurueckgenommen, nie umgeschrieben. */
grant select, insert on zahlung_zuordnung to cse_app;

/**
 * **Und was die Ausloeser brauchen — Recht UND Policy, sonst lesen sie null
 * Zeilen und schreiben still nichts (D-388).**
 *
 * Postgres prueft erst das GRANT, dann die Policy. Ein Ausloeser ohne beides
 * ist ein Riegel, der aussieht wie einer und keiner ist — der teuerste
 * Befund aus PR 51.
 */
grant select, insert, update on offener_posten to cse_definer;
grant select on zahlung_zuordnung, op_ausgleich to cse_definer;

create policy d_op_lesen on offener_posten for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_op_anlegen on offener_posten for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant());
create policy d_op_fortschreiben on offener_posten for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

create policy d_zz_lesen on zahlung_zuordnung for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_opa_lesen on op_ausgleich for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

/**
 * **Die Zahlung: lesen, sperren — und ausdruecklich nicht schreiben.**
 *
 * `fin.op_fortschreiben` sperrt die Zahlungszeile mit `select … for update`,
 * damit zwei gleichzeitige Zuordnungen derselben Zahlung nicht beide denselben
 * Stand lesen und zusammen mehr verteilen, als eingegangen ist. Eine
 * Sperrklausel verlangt in Postgres ein Schreibrecht, also steht `update` im
 * Grant — der `WITH CHECK (false)` daneben sagt, was damit NICHT gemeint ist:
 * kein Definer schreibt je eine Zahlung. Die Sperre prueft nur `USING`.
 */
grant select, update on zahlung to cse_definer;

create policy d_zahlung_lesen on zahlung for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_zahlung_sperren on zahlung for update to cse_definer
  using (mandant_id = app.aktiver_mandant()) with check (false);

/**
 * Der naechtliche Abgleich (§7.3). Er liest die Belegzeilen und die
 * Projektion und schreibt GENAU EINE Spalte: `neu_berechnet_am`, den Stempel
 * „geprueft am". Ein Pruefer, der repariert, kann anschliessend nicht mehr
 * bezeugen, dass nichts geaendert wurde (§5.7).
 */
/**
 * **Spalten, nicht Tabellen (K-05), und die Policy bindet den Mandanten
 * (0108).** Der Abgleich braucht vier Zahlen und eine Kennung je Tabelle; er
 * braucht keine Notiz, keine Referenz, keinen Kunden und keine Mahnstufe.
 *
 * Die Policies stehen auf `app.aktiver_mandant()` und nicht auf `using
 * (true)`: `alsJobSitzung` bindet den Mandanten, und damit steht die Wand in
 * der DATENBANK statt in der Abfrage. Wer den Lauf ohne Binder registriert,
 * sieht null Zeilen — und ein Test sagt ihm das, statt ihn „keine
 * Abweichung" melden zu lassen.
 *
 * **Und der Lauf schreibt GENAU eine Spalte.** `neu_berechnet_am` ist der
 * Stempel „geprueft am", keine Reparatur. Dass er nichts anderes anfassen
 * kann, steht nicht in einer Zusage, sondern im Spaltenrecht: auch in einer
 * schreibenden Sitzung ist `bezahlt_cent` fuer `cse_job` unerreichbar.
 */
grant select (id, mandant_id, rechnung_id, betrag_cent, bezahlt_cent,
              ausgeglichen_am, neu_berechnet_am)
  on offener_posten to cse_job;
grant update (neu_berechnet_am) on offener_posten to cse_job;
grant select (id, mandant_id, storniert_am) on zahlung to cse_job;
grant select (mandant_id, zahlung_id, offener_posten_id, art, betrag_cent)
  on zahlung_zuordnung to cse_job;
grant select (mandant_id, op_soll_id, op_haben_id, betrag_cent)
  on op_ausgleich to cse_job;

create policy t_op_job_lesen on offener_posten for select to cse_job
  using (mandant_id = app.aktiver_mandant());
create policy t_op_job_stempeln on offener_posten for update to cse_job
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());
create policy t_zahlung_job_lesen on zahlung for select to cse_job
  using (mandant_id = app.aktiver_mandant());
create policy t_zz_job_lesen on zahlung_zuordnung for select to cse_job
  using (mandant_id = app.aktiver_mandant());
create policy t_opa_job_lesen on op_ausgleich for select to cse_job
  using (mandant_id = app.aktiver_mandant());

/**
 * Die Sicht braucht ein EIGENES Recht — dass der Leser die Tische darunter
 * sehen darf, genuegt nicht. `security_invoker` sorgt dafuer, dass sie nicht
 * mehr zeigt als er ohnehin sehen duerfte.
 */
grant select on offener_posten_berechnet to cse_app, cse_job;



-- =========================================================================
-- 12. Der eine Weg, ein Guthaben zu eroeffnen
-- =========================================================================

/**
 * **Warum eine Funktion und keine INSERT-Policy fuer `cse_app`.**
 *
 * Ein Guthaben entsteht in genau zwei Faellen: eine Ueberzahlung, und ein
 * Storno (der ueber `fin.op_eroeffnen` laeuft). Gaebe man dem Portal ein
 * INSERT-Recht auf `offener_posten`, liesse sich ein Guthaben von Hand
 * anlegen — eine Verbindlichkeit gegenueber einem Kunden, die auf keinem
 * Beleg steht. Diese Funktion ist der eine Weg, und sie prueft, was eine
 * Policy nicht pruefen kann: dass der Kunde zum aktiven Mandanten gehoert.
 *
 * **`faellig_am` ist heute.** Die Spalte ist NOT NULL, weil jeder Debitor- und
 * Kreditorposten eine Faelligkeit hat. Ein Guthaben ist ab dem Tag geschuldet,
 * an dem es entsteht — es gibt kein Zahlungsziel, das der Gesellschaft Zeit
 * liesse. Das ist keine erfundene Geschaeftsregel, sondern die einzige
 * Lesart, die zu einer Verbindlichkeit passt.
 */
create function fin.op_guthaben_eroeffnen(p_kunde_id uuid, p_betrag_cent bigint)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_id      uuid;
begin
  if v_mandant is null then
    raise exception 'Ohne genau einen aktiven Mandanten entsteht kein Guthaben (Invariante 10).'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('zahlung.schreiben', v_mandant) then
    raise exception 'zahlung.schreiben fehlt' using errcode = 'insufficient_privilege';
  end if;
  if app.ist_readonly() then
    raise exception 'Die Sitzung ist lesend.' using errcode = 'insufficient_privilege';
  end if;
  if p_betrag_cent is null or p_betrag_cent <= 0 then
    raise exception 'Ein Guthaben ueber % Cent ergibt keinen Posten.', p_betrag_cent
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.kunde k
                  where k.id = p_kunde_id and k.mandant_id = v_mandant) then
    raise exception 'Kunde % gehoert nicht zum aktiven Mandanten.', p_kunde_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.offener_posten
    (mandant_id, art, kunde_id, betrag_cent, faellig_am,
     erstellt_von_art, erstellt_von)
  values
    (v_mandant, 'debitor_guthaben', p_kunde_id, p_betrag_cent, app.berlin_heute(),
     'mensch', app.aktueller_benutzer())
  returning id into v_id;

  perform app.protokolliere('offener_posten.guthaben_eroeffnet', 'offener_posten',
                            v_id::text, null,
                            jsonb_build_object('kunde_id', p_kunde_id,
                                               'betrag_cent', p_betrag_cent),
                            v_mandant);
  return v_id;
end
$$;

alter function fin.op_guthaben_eroeffnen(uuid, bigint) owner to cse_definer;
revoke execute on function fin.op_guthaben_eroeffnen(uuid, bigint) from public;
grant execute on function fin.op_guthaben_eroeffnen(uuid, bigint) to cse_app;

comment on function fin.op_guthaben_eroeffnen(uuid, bigint) is
  'Eroeffnet einen debitor_guthaben-Posten. Der eine Weg — offener_posten '
  'traegt fuer cse_app keine INSERT-Policy (§7.3).';

/** Die Funktion liest `kunde`; Recht und Policy stehen seit 0104 (D-388). */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0121)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- bankkonto (archiv): ACC-01, ACC-04, FIN-11, K-12. Die IBAN und der Kontoinhaber stehen im Snapshot jeder Rechnung, die dieses Konto genannt hat, und in der XRechnung (BT-84, BT-85). Das Konto zu loeschen liesse die Belege auf einen Empfaenger zeigen, den es nie gab — und der Bankimport (PR 61) ordnet einen Auszug ueber die IBAN zu. Ein geschlossenes Konto traegt `archiviert_am`; seine IBAN wird damit wieder verwendbar.
create trigger trg_bankkonto_kein_hard_delete
  before delete on bankkonto
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bankkonto_kein_truncate
  before truncate on bankkonto
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bankkonto from cse_app, cse_anon, cse_checkin, cse_job;

-- kasse (archiv): FIN-14, ACC-06, GoBD. An der Kasse haengen Barzahlungen und spaeter das Kassenbuch mit fortgeschriebenem Bestand. Eine geloeschte Kasse nimmt den Bewegungen ihren Ort und macht die Kassensturzfaehigkeit unpruefbar. Aufgeloest wird sie ueber `archiviert_am`.
create trigger trg_kasse_kein_hard_delete
  before delete on kasse
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kasse_kein_truncate
  before truncate on kasse
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kasse from cse_app, cse_anon, cse_checkin, cse_job;

-- zahlung (archiv): FIN-14, ACC-04, ACC-07, Invariante 8. Sie ist der Nachweis, dass Geld geflossen ist — und die Gegenprobe zu jedem ausgeglichenen Posten. Eine geloeschte Zahlung liesse eine bezahlte Forderung als bezahlt stehen, ohne dass irgendwo stuende, wodurch. Zurueckgenommen wird ueber `storniert_am`, und der Ausloeser gibt die Posten wieder frei.
create trigger trg_zahlung_kein_hard_delete
  before delete on zahlung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zahlung_kein_truncate
  before truncate on zahlung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zahlung from cse_app, cse_anon, cse_checkin, cse_job;

-- offener_posten (archiv): ACC-07, FIN-15, FIN-17. Die Zeile traegt, was gemahnt wurde und wann — der Mahnlauf und die Altersliste lesen genau das. Sie zu loeschen entfernte eine Forderung aus jeder Auswertung, ohne dass ein Beleg sich aendert: die Rechnung stuende weiter im Ausgangsbuch, aber niemand erwartete noch Geld dafuer. Abgeschlossen wird ueber `ausgeglichen_am`.
create trigger trg_offener_posten_kein_hard_delete
  before delete on offener_posten
  for each row execute function kern.verhindere_loeschung();
create trigger trg_offener_posten_kein_truncate
  before truncate on offener_posten
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on offener_posten from cse_app, cse_anon, cse_checkin, cse_job;

-- zahlung_zuordnung (append): FIN-14, ACC-04, ACC-07, §146 Abs. 4 AO. Jede Zeile ist eine Buchung: wieviel dieser Zahlung auf welchen Posten entfaellt, und warum (Skonto, Bauabzugsteuer, abgeschriebene Differenz). Sie zu loeschen aenderte den Stand eines Postens ohne Spur. Eine falsche Zuordnung wird zurueckgenommen, indem die ZAHLUNG storniert wird.
create trigger trg_zahlung_zuordnung_kein_hard_delete
  before delete on zahlung_zuordnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_zahlung_zuordnung_kein_truncate
  before truncate on zahlung_zuordnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on zahlung_zuordnung from cse_app, cse_anon, cse_checkin, cse_job;

-- op_ausgleich (append): FIN-15, ACC-07, §14 UStG (Invariante 4). Der Ausgleich ist der Vorgang, der eine stornierte Rechnung und ihre Gutschrift gegeneinander schliesst, ohne eine Zahlung zu erfinden. Ihn zu loeschen oeffnete beide Posten wieder und liesse die Wache eine stornierte Rechnung anmahnen.
create trigger trg_op_ausgleich_kein_hard_delete
  before delete on op_ausgleich
  for each row execute function kern.verhindere_loeschung();
create trigger trg_op_ausgleich_kein_truncate
  before truncate on op_ausgleich
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on op_ausgleich from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
