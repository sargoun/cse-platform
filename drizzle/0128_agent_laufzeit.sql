/**
 * 0128 — Die Agenten-Laufzeit: Aufgabe, Schritt, Kosten, Budget mit Hartstopp
 * (AGT-01, AGT-04, AGT-05, PR 74).
 *
 * `06-RADAR-KI-INHALT.md` §3.1, §3.5–§3.9; `06-AGENTEN-FREIGABEN.md` §2, §4.
 *
 * **Ein Agent ist ab hier eine Zeile, kein Codepfad.** Vier Agenten (D-03)
 * stehen als Referenzzeilen in `agent`; das Agenten-Zentrum zeigt, schaltet
 * und begrenzt sie, ohne dass jemand etwas ausrollt.
 *
 * **Drei Dinge, die diese Migration unmoeglich machen soll:**
 *
 *   1. **Ein Schritt, der nicht protokolliert ist.** `agent_schritt` traegt
 *      Werkzeug, Modell, Ein- und Ausgabe, Tokens, Kosten und Dauer — und die
 *      Tabelle ist anhaengend: keine Aenderung, keine Loeschung, mit genau
 *      einer benannten Ausnahme (die Schwaerzung der Nutzlast nach Frist).
 *      Was nicht protokolliert ist, ist nicht abrechenbar, nicht
 *      wiederholbar und nicht pruefbar.
 *
 *   2. **Ein Ueberschreiten des Monatsbudgets, das nur bremst.** AGT-05
 *      verlangt einen HARTEN Stopp: der naechste Aufruf wird abgelehnt, nicht
 *      verkleinert, nicht gekuerzt und nicht auf ein billigeres Modell
 *      umgelenkt. `app.agent_budget_pruefen` sperrt die Mandantszeile und die
 *      Agentenzeile in FESTER Reihenfolge, prueft BEIDE und gibt ein Urteil
 *      zurueck — **sie wirft nicht**. Ein `raise` in derselben Transaktion
 *      naehme den gesetzten Stoppstatus und die Benachrichtigung mit sich
 *      zurueck; danach stuende nirgends, dass gestoppt wurde, und derselbe
 *      Aufruf liefe endlos in denselben Fehler.
 *
 *   3. **Eine Reservierung, die niemand mehr findet.** Ein abgestuerzter Lauf
 *      darf nicht dauerhaft Budget binden. Jede Reservierung ist eine ZEILE
 *      mit Verfallszeit; ein Waechter gibt abgelaufene frei und meldet, wie
 *      viele — sichtbarer Verlust statt stiller Zuwachs.
 *
 * **Mikrocent, und nur hier** (K-16(b), §1.12). Modelltokens kosten echte
 * Bruchteile eines Cents; auf Cent gerundet je Schritt zerfaellt die
 * AGT-05-Arithmetik. Deshalb rechnet das Agentenbuch in 10⁻⁶ €. Nichts, was
 * fakturiert, gebucht oder exportiert wird, sieht je einen Mikrocent: die
 * Umrechnung geschieht EINMAL an der Anzeigegrenze,
 * `div(Σ kosten_mikrocent + 5000, 10000)`, kaufmaennisch gerundet.
 *
 * **Was hier NICHT steht.** Die neun Werkzeuge und die Autonomiematrix kommen
 * mit PR 75 (`agent_werkzeug`, die reiche Fassung von `agent_richtlinie`), das
 * Agenten-Zentrum mit PR 76, die Belege und Artefakte mit PR 75/78. Diese
 * Migration baut den Boden, auf dem sie stehen.
 */

-- =========================================================================
-- 1. Die Vokabulare (§7 der Datenmodelldoku)
-- =========================================================================

create type agent_kennung as enum ('ceo_assistent', 'akquise', 'backoffice', 'finanzen');

comment on type agent_kennung is
  'D-03. Die vier Agenten als geschlossene Menge. Ein fuenfter Agent ist eine '
  'Migration und eine Entscheidung — kein Konfigurationsversehen.';

/**
 * **Die NEUN Werkzeuge, und nur diese** (AGT-02, K-21).
 *
 * Der Typ steht schon hier, obwohl die Werkzeugtabelle erst mit PR 75 kommt:
 * `agent_schritt.werkzeug` ist damit typisiert, und ein zehntes Werkzeug
 * laesst sich gar nicht erst protokollieren — also auch nicht budgetieren,
 * wiederholen oder pruefen. Eine fehlende Faehigkeit ist eine neue ART eines
 * bestehenden Werkzeugs oder eine Vorpruefung im Dienst, nie ein zehnter Name.
 */
create type agent_werkzeug_name as enum (
  'lies_dokument', 'extrahiere_lv', 'suche_bestand', 'berechne_preis',
  'pruefe_nachweise', 'pruefe_bilder', 'entwirf_text', 'sende_email',
  'erstelle_vorgang');

create type agent_vorgang_typ as enum (
  'ausschreibung_bewerten', 'dokument_abrufen', 'vergabeunterlage_lesen',
  'interner_hinweis', 'termin_bestaetigen', 'anfrage_antwort_entwurf',
  'ersatz_vorschlagen', 'monatsrechnung_entwurf', 'angebot_erstellen',
  'nachlass_gewaehren', 'externer_versand', 'buchung_uebernehmen',
  'beitrag_veroeffentlichen', 'mahnung_vorschlagen', 'stellenanzeige_entwurf',
  'bewerbung_auswerten', 'kandidat_ranking');

create type agent_aufgabe_status as enum (
  'wartend', 'laufend', 'wartet_auf_freigabe', 'abgeschlossen',
  'fehlgeschlagen', 'abgebrochen', 'gestoppt_budget');

create type agent_schritt_status as enum (
  'erfolg', 'fehler', 'abgelehnt_richtlinie', 'uebersprungen');

create type ausloeser as enum ('mensch', 'zeitplan', 'ereignis', 'agent');

create type budget_geltungsbereich as enum ('mandant', 'agent');
create type budget_status as enum ('aktiv', 'gewarnt', 'gestoppt');
create type reservierung_ende as enum ('gebucht', 'abgebrochen', 'verfallen');

create type agent_budget_verdikt as enum ('ok', 'gestoppt', 'budget_fehlt');

comment on type agent_budget_verdikt is
  'AGT-05. Drei Werte und nur drei: diese Pruefung hat keinen Warnpfad und '
  'keinen Rest zu melden. Die Warnung gehoert dem Waechter, der als einziger '
  'agent_budget.status = gewarnt schreibt.';

-- =========================================================================
-- 2. `agent` — die vier Agenten als Referenzzeilen (§3.1)
-- =========================================================================

create table agent (
  id                   uuid primary key default gen_random_uuid(),
  kennung              agent_kennung not null,
  name                 text not null check (length(btrim(name)) > 0),
  beschreibung         text not null check (length(btrim(beschreibung)) > 0),
  /** „Was er NIE tut" — SPEC §17 nennt es je Agent, und es gehoert auf den Schirm. */
  verbot_beschreibung  text not null check (length(btrim(verbot_beschreibung)) > 0),
  modell_standard      text,
  /**
   * Schleifenbremse je Aufgabe. **PLATZHALTER**: eine stille Obergrenze ist
   * das, was man fuer raetselhaft abgeschnittene Ergebnisse verantwortlich
   * macht. NULL heisst: der Wert aus `src/server/agent/limits.platzhalter.ts`.
   * TODO(client, O-196): Wie viele Werkzeugschritte darf ein Agent je Aufgabe
   * ausfuehren, bevor er abbricht und den Vorgang einem Menschen vorlegt?
   */
  max_schritte         integer check (max_schritte is null or max_schritte > 0),
  /** AUS, bis jemand einschaltet. Ein Agent laeuft nicht, weil es ihn gibt. */
  ist_aktiv            boolean not null default false,

  erstellt_am          timestamptz not null default now(),
  geaendert_am         timestamptz,

  constraint agent_kennung_key unique (kennung)
);

comment on table agent is
  'AGT-01, D-03. Referenztabelle: die vier Agenten sind gruppenweite '
  'Definitionen. Ihre Aktivierung, ihr Budget und ihre Richtlinien je Mandant '
  'sind es NICHT — die stehen in agent_budget und agent_richtlinie.';

insert into agent (kennung, name, beschreibung, verbot_beschreibung) values
  ('ceo_assistent', 'CEO-Assistent',
   'Beantwortet Fragen zum Betrieb aus den Daten dieser Plattform: wer arbeitet '
   'heute, welche Auftraege laufen, welche Rechnungen sind offen.',
   'Er erfindet keine Zahl. Was keine Abfrage hergibt, beantwortet er mit '
   '"kann ich aus den Daten nicht beantworten" — und nennt, was fehlt.'),
  ('akquise', 'Akquise-Assistent',
   'Bewertet Ausschreibungen und Anfragen, ordnet sie einem Bereich zu und '
   'entwirft die Antwort.',
   'Er verschickt nichts. Kein Angebot, keine E-Mail, keine Nachricht geht '
   'ohne die Freigabe eines Menschen hinaus (Invariante 7).'),
  ('backoffice', 'Rueckbuero-Assistent',
   'Bereitet wiederkehrende Vorgaenge vor: Termine, Ersatzvorschlaege bei '
   'Ausfaellen, Entwuerfe fuer Monatsrechnungen.',
   'Er entscheidet keinen Dienstplan und keine Abrechnung. Er legt vor.'),
  ('finanzen', 'Finanz-Assistent',
   'Liest Belege, schlaegt Kontierung und Buchung vor und bereitet die '
   'Uebergabe an die Buchhaltung vor.',
   'Er rechnet keinen Betrag und bucht nichts selbst. Jede Zahl kommt aus '
   'einer geprueften Funktion, jede Buchung aus einer Freigabe (Invariante 6).');

-- =========================================================================
-- 3. `agent_preisliste` — Modellpreise als exakte ganze Zahlen (§3.5)
-- =========================================================================

/**
 * Damit sich eine Kostenzeile in fuenf Jahren nachrechnen laesst, muss der
 * Preis von damals noch dastehen — und zwar exakt. Deshalb ganze Mikrocent je
 * Million Token statt eines Gleitkommapreises je Token.
 *
 * Leer geseedet: welche Modelle zu welchem Preis, ist eine Vertragsfrage.
 * TODO(client, O-197): Welche Modelle sollen die Agenten benutzen, und zu
 * welchen Konditionen (EU-Verarbeitung, Zero-Retention)?
 */
create table agent_preisliste (
  id                                    uuid primary key default gen_random_uuid(),
  modell                                text not null check (length(btrim(modell)) > 0),
  gueltig_ab                            date not null,
  gueltig_bis                           date,
  preis_eingabe_je_mio_token_mikrocent  bigint not null check (preis_eingabe_je_mio_token_mikrocent >= 0),
  preis_ausgabe_je_mio_token_mikrocent  bigint not null check (preis_ausgabe_je_mio_token_mikrocent >= 0),
  preis_gedanken_je_mio_token_mikrocent bigint check (preis_gedanken_je_mio_token_mikrocent is null
                                                      or preis_gedanken_je_mio_token_mikrocent >= 0),
  waehrung_original                     char(3) not null default 'USD',
  version                               text not null check (length(btrim(version)) > 0),

  erstellt_am                           timestamptz not null default now(),

  constraint apl_uk unique (modell, gueltig_ab),
  constraint apl_zeitraum check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  constraint apl_kein_ueberlapp exclude using gist (
    modell with =, daterange(gueltig_ab, gueltig_bis, '[]') with &&)
);

-- =========================================================================
-- 4. `agent_budget` — die Obergrenze, und der Stopp (§3.6)
-- =========================================================================

create table agent_budget (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  geltungsbereich       budget_geltungsbereich not null,
  agent_id              uuid references agent(id),

  jahr                  integer not null check (jahr between 2000 and 2100),
  monat                 integer not null check (monat between 1 and 12),

  /**
   * Die einzige Cent-Spalte des Agentenbuchs: eine Obergrenze gibt ein Mensch
   * in Euro ein. **PLATZHALTER** — NULL heisst „kein Budget entschieden", und
   * dann laeuft kein Agent.
   * TODO(client, O-26): Monatsbudget je Gesellschaft und je Agent?
   */
  budget_cent           bigint check (budget_cent is null or budget_cent >= 0),

  verbrauch_mikrocent   bigint not null default 0 check (verbrauch_mikrocent >= 0),
  reserviert_mikrocent  bigint not null default 0 check (reserviert_mikrocent >= 0),

  stopp_bei_ueberschreitung boolean not null default true,

  /**
   * **PLATZHALTER.** AGT-05 nennt eine Obergrenze und einen Hartstopp und
   * sagt zur Warnschwelle nichts; „80 %" waere eine still erfundene
   * Finanzregel.
   * TODO(client, O-195): Ab welchem Anteil des Monatsbudgets soll gewarnt
   * werden?
   */
  warnschwelle_prozent  integer check (warnschwelle_prozent is null
                                        or warnschwelle_prozent between 1 and 100),

  status                budget_status not null default 'aktiv',
  gewarnt_am            timestamptz,
  gestoppt_am           timestamptz,
  ist_platzhalter       boolean not null default true,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint agent_budget_mandant_uk unique (mandant_id, id),
  /**
   * **Ohne diesen CHECK verhindern die beiden partiellen Unique-Indizes
   * nichts**: NULL kollidiert nie mit NULL, also liessen sich beliebig viele
   * Mandantsbudgets desselben Monats anlegen.
   */
  constraint ab_bereich_stimmig check (
        (geltungsbereich = 'agent'   and agent_id is not null)
     or (geltungsbereich = 'mandant' and agent_id is null)),
  constraint ab_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create unique index ab_agent_uk on agent_budget (mandant_id, agent_id, jahr, monat)
  where geltungsbereich = 'agent';
create unique index ab_mandant_uk on agent_budget (mandant_id, jahr, monat)
  where geltungsbereich = 'mandant';
create index ab_gestoppt_idx on agent_budget (mandant_id) where status = 'gestoppt';

create trigger agent_budget_geaendert
  before update on agent_budget
  for each row execute function kern.setze_geaendert_am();

-- =========================================================================
-- 5. `agent_aufgabe` und `agent_schritt` (§3.9)
-- =========================================================================

create table agent_aufgabe (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  agent_id              uuid not null references agent(id),
  vorgang_typ           agent_vorgang_typ not null,
  titel                 text not null check (length(btrim(titel)) > 0),
  status                agent_aufgabe_status not null default 'wartend',

  /** Handles, nie Zahlen (K-10): ein Modell bekommt Verweise, keine Betraege. */
  eingabe               jsonb not null default '{}',
  ergebnis              jsonb,

  /** Polymorph und BEWUSST ohne Fremdschluessel (§7.2). */
  bezug_typ             text,
  bezug_id              uuid,

  idempotenz_schluessel text,
  korrelation_id        uuid not null default gen_random_uuid(),

  angefordert_von       uuid references benutzer(id),
  ausgeloest_durch      ausloeser not null default 'mensch',

  gestartet_am          timestamptz,
  beendet_am            timestamptz,
  dauer_ms              integer check (dauer_ms is null or dauer_ms >= 0),
  schritte_anzahl       integer not null default 0 check (schritte_anzahl >= 0),

  /**
   * **Die K-16(b)-Umrechnungsstelle**: ganze Cent, gebildet aus der Summe der
   * Mikrocent der Kostenzeilen als `div(Σ + 5000, 10000)` — kaufmaennisch,
   * einmal, hier.
   */
  kosten_cent           bigint not null default 0 check (kosten_cent >= 0),
  budget_stopp          boolean not null default false,

  /** Was einen Lauf WIEDERHOLBAR macht: Prompt, Regelwerk, Code. */
  prompt_version        text,
  richtlinien_version   text,
  code_version          text,
  fehler_text           text,

  erstellt_von_art      akteur_art not null default 'system',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint agent_aufgabe_mandant_uk unique (mandant_id, id),
  /** Ein Endzustand ohne Endzeit waere eine Aufgabe, die nie aufgehoert hat. */
  constraint aa_ende_stimmig check (
    status not in ('abgeschlossen', 'fehlgeschlagen', 'abgebrochen', 'gestoppt_budget')
    or beendet_am is not null),
  constraint aa_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null))
);

create unique index aa_idem_uk on agent_aufgabe (mandant_id, idempotenz_schluessel)
  where idempotenz_schluessel is not null;
create index aa_center_idx on agent_aufgabe (mandant_id, status, erstellt_am desc);
create index aa_agent_idx on agent_aufgabe (mandant_id, agent_id, erstellt_am desc);
create index aa_bezug_idx on agent_aufgabe (bezug_typ, bezug_id) where bezug_id is not null;
create index aa_korr_idx on agent_aufgabe (korrelation_id);

create trigger agent_aufgabe_geaendert
  before update on agent_aufgabe
  for each row execute function kern.setze_geaendert_am();

create table agent_schritt (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  agent_aufgabe_id      uuid not null,
  schritt_nr            integer not null check (schritt_nr > 0),

  werkzeug              agent_werkzeug_name,
  modell                text,

  /**
   * **Spaltenweise entzogen** (K-05): Modell-Ein- und -Ausgaben enthalten
   * regelmaessig Personendaten. `cse_app` bekommt sie NICHT; gelesen werden
   * sie ueber `app.agent_nutzlast_lesen` mit `agent.protokoll_lesen`, und
   * dieser Zugriff steht im Audit.
   */
  eingabe               jsonb,
  ausgabe               jsonb,
  /** Ueberleben die Schwaerzung — der Nachweis bleibt, der Inhalt geht. */
  eingabe_hash          text not null check (eingabe_hash ~ '^[0-9a-f]{64}$'),
  ausgabe_hash          text check (ausgabe_hash is null or ausgabe_hash ~ '^[0-9a-f]{64}$'),

  tokens_eingabe        integer not null default 0 check (tokens_eingabe >= 0),
  tokens_ausgabe        integer not null default 0 check (tokens_ausgabe >= 0),
  tokens_gedanken       integer not null default 0 check (tokens_gedanken >= 0),
  kosten_mikrocent      bigint not null default 0 check (kosten_mikrocent >= 0),
  dauer_ms              integer not null check (dauer_ms >= 0),

  status                agent_schritt_status not null default 'erfolg',
  policy_ergebnis       jsonb,
  policy_spur           jsonb,
  quellen               jsonb,
  vertrauen_zusammenfassung jsonb,

  /**
   * Der Eingabetext hat den Injektionsmelder ausgeloest. Gesetzt vom Laeufer,
   * NIE vom Modell: ein `true` schreibt einen Sicherheitsvorfall und bricht
   * den Lauf ab.
   */
  injektionsverdacht    boolean not null default false,

  richtlinie_id         uuid,
  freigabe_id           uuid,

  begonnen_am           timestamptz not null,
  beendet_am            timestamptz not null,

  /** Die Frist, nach der Ein- und Ausgabe geschwaerzt werden (LEG-09). */
  nutzlast_loeschfrist_am date not null,
  nutzlast_geloescht_am   timestamptz,

  erstellt_am           timestamptz not null default now(),

  constraint agent_schritt_mandant_uk unique (mandant_id, id),
  constraint as_uk unique (agent_aufgabe_id, schritt_nr),
  constraint as_zeit check (beendet_am >= begonnen_am),
  constraint as_aufgabe_fk foreign key (mandant_id, agent_aufgabe_id)
    references agent_aufgabe (mandant_id, id),
  constraint as_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id)
);

create index as_brin on agent_schritt using brin (erstellt_am);
create index as_injektion_idx on agent_schritt (mandant_id, begonnen_am desc)
  where injektionsverdacht;
create index as_abgelehnt_idx on agent_schritt (mandant_id, werkzeug)
  where status = 'abgelehnt_richtlinie';
create index as_purge_idx on agent_schritt (nutzlast_loeschfrist_am)
  where nutzlast_geloescht_am is null;

-- =========================================================================
-- 6. `agent_reservierung` — damit ein Absturz kein Budget frisst (§3.7)
-- =========================================================================

create table agent_reservierung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  agent_budget_id       uuid not null,
  agent_aufgabe_id      uuid not null,
  betrag_mikrocent      bigint not null check (betrag_mikrocent >= 0),

  angelegt_am           timestamptz not null default now(),
  verfaellt_am          timestamptz not null,
  freigegeben_am        timestamptz,
  freigabe_grund        reservierung_ende,

  constraint agent_reservierung_mandant_uk unique (mandant_id, id),
  constraint res_aufgabe_uk unique (agent_aufgabe_id, angelegt_am),
  constraint res_ende_stimmig check (
    (freigegeben_am is null and freigabe_grund is null)
    or (freigegeben_am is not null and freigabe_grund is not null)),
  constraint res_budget_fk foreign key (mandant_id, agent_budget_id)
    references agent_budget (mandant_id, id),
  constraint res_aufgabe_fk foreign key (mandant_id, agent_aufgabe_id)
    references agent_aufgabe (mandant_id, id)
);

create index res_offen_idx on agent_reservierung (agent_budget_id)
  where freigegeben_am is null;
create index res_verfall_idx on agent_reservierung (verfaellt_am)
  where freigegeben_am is null;

/**
 * Der Zaehler `agent_budget.reserviert_mikrocent` ist die Summe der OFFENEN
 * Reservierungen — in derselben Transaktion wie das Anlegen oder Freigeben.
 * Ein blosser Zaehler ohne Zeilen war die Vorfassung; jeder abgestuerzte Lauf
 * liess seinen Betrag darauf stehen, und nach Wochen stoppte AGT-05 auf
 * Phantomausgaben, die keine Abfrage widerlegen konnte.
 */
create function app.agent_reservierung_zaehler() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_budget uuid := coalesce(new.agent_budget_id, old.agent_budget_id);
begin
  update public.agent_budget b
     set reserviert_mikrocent = coalesce((
           select sum(r.betrag_mikrocent) from public.agent_reservierung r
            where r.agent_budget_id = v_budget and r.freigegeben_am is null), 0)
   where b.id = v_budget;
  return null;
end $$;

alter function app.agent_reservierung_zaehler() owner to cse_definer;

create trigger trg_reservierung_zaehler
  after insert or update or delete on agent_reservierung
  for each row execute function app.agent_reservierung_zaehler();

-- =========================================================================
-- 7. `agent_kosten` — das Kostenbuch (§3.8)
-- =========================================================================

create table agent_kosten (
  id                     uuid primary key default gen_random_uuid(),
  mandant_id             uuid not null references mandant(id),

  agent_id               uuid not null references agent(id),
  agent_aufgabe_id       uuid,
  agent_budget_id        uuid not null,
  agent_reservierung_id  uuid,

  jahr                   integer not null check (jahr between 2000 and 2100),
  monat                  integer not null check (monat between 1 and 12),

  kosten_mikrocent       bigint not null check (kosten_mikrocent >= 0),
  tokens_eingabe         bigint not null default 0 check (tokens_eingabe >= 0),
  tokens_ausgabe         bigint not null default 0 check (tokens_ausgabe >= 0),
  tokens_gedanken        bigint not null default 0 check (tokens_gedanken >= 0),

  modell                 text,
  agent_preisliste_id    uuid not null references agent_preisliste(id),

  /** Was der Anbieter in SEINER kleinsten Einheit berechnet hat. */
  betrag_original        bigint not null check (betrag_original >= 0),
  waehrung_original      char(3) not null,
  /** Ein Kurs ist kein Geld — deshalb `numeric` und nicht `bigint`. */
  wechselkurs            numeric(12,6) check (wechselkurs is null or wechselkurs > 0),

  gebucht_am             timestamptz not null default now(),

  constraint agent_kosten_mandant_uk unique (mandant_id, id),
  constraint ak_aufgabe_fk foreign key (mandant_id, agent_aufgabe_id)
    references agent_aufgabe (mandant_id, id),
  constraint ak_budget_fk foreign key (mandant_id, agent_budget_id)
    references agent_budget (mandant_id, id),
  constraint ak_reservierung_fk foreign key (mandant_id, agent_reservierung_id)
    references agent_reservierung (mandant_id, id)
);

create index ak_monat_idx on agent_kosten (mandant_id, jahr, monat, agent_id);
create index ak_aufgabe_idx on agent_kosten (agent_aufgabe_id) where agent_aufgabe_id is not null;
create index ak_brin on agent_kosten using brin (gebucht_am);

/**
 * Eine Kostenzeile schreibt den Verbrauch fort UND gibt ihre Reservierung
 * frei — in einer Transaktion. Zwei getrennte Schritte hiessen: ein Absturz
 * dazwischen laesst entweder Budget doppelt gebunden oder Verbrauch
 * ungebucht.
 */
create function app.agent_kosten_fortschreiben() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.agent_budget b
     set verbrauch_mikrocent = b.verbrauch_mikrocent + new.kosten_mikrocent
   where b.id = new.agent_budget_id;

  if new.agent_reservierung_id is not null then
    update public.agent_reservierung r
       set freigegeben_am = now(), freigabe_grund = 'gebucht'
     where r.id = new.agent_reservierung_id and r.freigegeben_am is null;
  end if;

  if new.agent_aufgabe_id is not null then
    /*
     * **Die Umrechnung, an genau einer Stelle** (K-16(b), §1.12): die Summe
     * der Mikrocent dieser Aufgabe, kaufmaennisch auf Cent gerundet. Kein
     * gespeicherter Zwischenwert kann davon abweichen, weil es keinen gibt.
     */
    update public.agent_aufgabe a
       set kosten_cent = (
             select div(coalesce(sum(k.kosten_mikrocent), 0) + 5000, 10000)
               from public.agent_kosten k where k.agent_aufgabe_id = a.id)
     where a.id = new.agent_aufgabe_id;
  end if;
  return null;
end $$;

alter function app.agent_kosten_fortschreiben() owner to cse_definer;

create trigger trg_budget_fortschreiben
  after insert on agent_kosten
  for each row execute function app.agent_kosten_fortschreiben();

-- =========================================================================
-- 8. Anhaengend: keine Aenderung, keine Loeschung (AGT-04, LEG-09)
-- =========================================================================

/**
 * `agent_kosten` ist ein Buch. `agent_schritt` ist ein Protokoll. Beide
 * duerfen wachsen und sonst nichts — mit **einer** benannten Ausnahme: die
 * Schwaerzung setzt `nutzlast_geloescht_am` und leert `eingabe`/`ausgabe`.
 * Ohne diese Ausnahme im Ausloeser waere das Loeschkonzept (LEG-09) nicht
 * durchfuehrbar; ohne den Ausloeser waere das Protokoll nachtraeglich
 * schoenbar.
 */
create function app.agent_schritt_anhaengend() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus text[] := array['eingabe', 'ausgabe', 'nutzlast_geloescht_am'];
  v_alt jsonb;
  v_neu jsonb;
begin
  v_alt := to_jsonb(old) - v_aus;
  v_neu := to_jsonb(new) - v_aus;
  if v_alt <> v_neu then
    raise exception 'Ein Agentenschritt wird nicht geaendert (AGT-04).'
      using errcode = 'restrict_violation',
            hint = 'Die einzige erlaubte Aenderung ist die Schwaerzung der Nutzlast nach Frist.';
  end if;
  if new.nutzlast_geloescht_am is not null
     and (new.eingabe is not null or new.ausgabe is not null) then
    raise exception 'Eine geschwaerzte Nutzlast ist leer — sonst ist sie nicht geschwaerzt.'
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

create trigger as_anhaengend
  before update on agent_schritt
  for each row execute function app.agent_schritt_anhaengend();

create function app.agent_kosten_anhaengend() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'Eine Kostenzeile wird nicht geaendert (AGT-04, AGT-05).'
    using errcode = 'restrict_violation',
          hint = 'Korrigiert wird durch eine zweite Zeile, nie durch Aenderung.';
end $$;

create trigger ak_anhaengend
  before update on agent_kosten
  for each row execute function app.agent_kosten_anhaengend();

-- =========================================================================
-- 9. `app.agent_budget_pruefen` — das Urteil, ohne Ausnahme (§3.6, AGT-05)
-- =========================================================================

/**
 * Sperrt zuerst die MANDANTSZEILE, dann die Agentenzeile, prueft BEIDE und
 * gibt ein Urteil zurueck. Drei Eigenschaften, jede aus einem Befund:
 *
 *   * **Sie wirft nicht.** Ein `raise` in derselben Transaktion nimmt den
 *     Stoppstatus und die Benachrichtigung mit zurueck — der Stopp waere dann
 *     nirgends nachweisbar und wiederholte sich endlos.
 *   * **Sie prueft BEIDE Zeilen.** Die Vorfassung nahm mit
 *     `order by geltungsbereich desc` genau eine Zeile; die Enum-Ordnung
 *     stellte `agent` nach vorn, und ein Mandantsdeckel von 200 € liess vier
 *     Agentendeckel von je 500 € durch.
 *   * **Feste Reihenfolge.** Mandant zuerst, dann Agent — zwei gleichzeitige
 *     Agenten eines Mandanten sperren damit in derselben Reihenfolge und
 *     verklemmen sich nicht.
 *
 * Die Obergrenze wird nach Mikrocent GEWEITET (`* 10000`), nicht der Verbrauch
 * auf Cent verengt: eine Weitung kann nicht runden.
 */
create function app.agent_budget_pruefen(
  p_mandant uuid, p_agent uuid, p_betrag_mikrocent bigint
) returns table (verdikt agent_budget_verdikt, budget_id uuid)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  j integer := extract(year  from (now() at time zone 'Europe/Berlin'));
  m integer := extract(month from (now() at time zone 'Europe/Berlin'));
  b record;
begin
  for b in
    select * from public.agent_budget
     where mandant_id = p_mandant and jahr = j and monat = m
       and (geltungsbereich = 'mandant'
            or (geltungsbereich = 'agent' and agent_id = p_agent))
     order by (geltungsbereich = 'mandant') desc, id
     for update
  loop
    if b.budget_cent is null then
      return query select 'budget_fehlt'::agent_budget_verdikt, b.id;
      return;
    end if;
    if b.stopp_bei_ueberschreitung
       and b.verbrauch_mikrocent + b.reserviert_mikrocent + p_betrag_mikrocent
           > b.budget_cent * 10000
    then
      return query select 'gestoppt'::agent_budget_verdikt, b.id;
      return;
    end if;
  end loop;

  /*
   * Keine Budgetzeile ist NICHT „frei" — es ist „nicht entschieden" (O-26).
   * Ein Agent ohne Budget laeuft nicht; das ist die sichere Richtung.
   */
  if not found then
    return query select 'budget_fehlt'::agent_budget_verdikt, null::uuid;
    return;
  end if;

  return query select 'ok'::agent_budget_verdikt, null::uuid;
end $$;

alter function app.agent_budget_pruefen(uuid, uuid, bigint) owner to cse_definer;
revoke all on function app.agent_budget_pruefen(uuid, uuid, bigint) from public;
grant execute on function app.agent_budget_pruefen(uuid, uuid, bigint) to cse_app, cse_job;

-- =========================================================================
-- 10. RLS und Rechte (§1.1–§1.5, K-03, K-05, D-388)
-- =========================================================================

alter table agent               enable row level security;
alter table agent               force  row level security;
alter table agent_preisliste    enable row level security;
alter table agent_preisliste    force  row level security;
alter table agent_budget        enable row level security;
alter table agent_budget        force  row level security;
alter table agent_aufgabe       enable row level security;
alter table agent_aufgabe       force  row level security;
alter table agent_schritt       enable row level security;
alter table agent_schritt       force  row level security;
alter table agent_reservierung  enable row level security;
alter table agent_reservierung  force  row level security;
alter table agent_kosten        enable row level security;
alter table agent_kosten        force  row level security;

/** Zwei Referenztabellen: jeder interne Leser darf sie sehen, schreiben nur super_admin. */
create policy r_agent_lesen on agent for select to cse_app using (app.portal() = 'intern');
create policy r_agent_schreiben on agent for all to cse_app
  using (app.ist_super_admin()) with check (app.ist_super_admin());
create policy r_preisliste_lesen on agent_preisliste for select to cse_app
  using (app.portal() = 'intern');
create policy r_preisliste_schreiben on agent_preisliste for all to cse_app
  using (app.ist_super_admin()) with check (app.ist_super_admin());

grant select on agent, agent_preisliste to cse_app, cse_job, cse_definer;
grant insert, update on agent, agent_preisliste to cse_app;

create policy j_agent_lesen on agent for select to cse_job using (true);
create policy j_preisliste_lesen on agent_preisliste for select to cse_job using (true);
create policy d_agent_lesen on agent for select to cse_definer using (true);
create policy d_preisliste_lesen on agent_preisliste for select to cse_definer using (true);

/**
 * Die vier mandantsgebundenen Tische: Modul `agent`, interne Decke.
 *
 * **Keine Gruppenpolicy auf `agent_schritt`.** Die Nutzlast eines Schrittes
 * traegt regelmaessig Personendaten; die Gruppenansicht ist eine Auswertung
 * ueber Gesellschaften hinweg und hat daran kein Interesse, das den Zugriff
 * rechtfertigte. Aufgaben, Kosten und Budgets sind dort lesbar, Schritte
 * nicht.
 */
do $$
declare t text;
begin
  foreach t in array array['agent_budget', 'agent_aufgabe', 'agent_reservierung',
                           'agent_kosten', 'agent_schritt'] loop
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('agent.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('agent.aufgabe_starten', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;

  foreach t in array array['agent_budget', 'agent_aufgabe', 'agent_kosten'] loop
    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.agent.lesen')))$p$, t);
  end loop;
end $$;

grant select, insert, update on agent_budget, agent_aufgabe, agent_reservierung to cse_app;
grant select, insert on agent_kosten to cse_app;

/**
 * **K-05 auf `agent_schritt`: die Nutzlast fehlt im Grant.**
 *
 * Ein `GRANT SELECT` auf die Tabelle mit anschliessendem `REVOKE SELECT
 * (eingabe)` wirkt in PostgreSQL NICHT. Die Spalten muessen von vornherein
 * fehlen — gelesen werden sie ueber `app.agent_nutzlast_lesen` (PR 76) mit
 * `agent.protokoll_lesen`, und dieser Zugriff steht im Audit.
 */
grant select (id, mandant_id, agent_aufgabe_id, schritt_nr, werkzeug, modell,
              eingabe_hash, ausgabe_hash, tokens_eingabe, tokens_ausgabe,
              tokens_gedanken, kosten_mikrocent, dauer_ms, status,
              policy_ergebnis, policy_spur, quellen, vertrauen_zusammenfassung,
              injektionsverdacht, richtlinie_id, freigabe_id,
              begonnen_am, beendet_am, nutzlast_loeschfrist_am,
              nutzlast_geloescht_am, erstellt_am)
  on agent_schritt to cse_app;
grant insert on agent_schritt to cse_app;

/** Der Laeufer und die Waechter arbeiten ohne Sitzung. */
grant select, insert, update on agent_budget, agent_aufgabe, agent_reservierung,
                                agent_schritt to cse_job;
grant select, insert on agent_kosten to cse_job;

do $$
declare t text;
begin
  foreach t in array array['agent_budget', 'agent_aufgabe', 'agent_reservierung',
                           'agent_kosten', 'agent_schritt'] loop
    execute format(
      'create policy j_%1$s on %1$I for all to cse_job using (true) with check (true)', t);
  end loop;
end $$;

/** D-388: die Definer-Funktionen lesen und schreiben als `cse_definer`. */
grant select, update on agent_budget to cse_definer;
grant select, update on agent_reservierung to cse_definer;
grant select, update on agent_aufgabe to cse_definer;

/**
 * **Und `agent_kosten` — lesend, ohne dass es jemand sofort sieht.**
 *
 * `app.agent_kosten_fortschreiben` summiert die Mikrocent der Aufgabe, um
 * `kosten_cent` zu setzen. Diese Summe liest `agent_kosten` — die Tabelle, auf
 * deren INSERT der Ausloeser haengt. Ein Ausloeser, der als `cse_definer`
 * laeuft, erbt das Recht des Einfuegenden NICHT: ohne diesen Grant scheitert
 * jede Kostenbuchung mit „permission denied for table agent_kosten", und zwar
 * NACH dem INSERT, im Ausloeser, wo niemand sie sucht. `select` genuegt;
 * schreiben darf `cse_definer` hier nichts.
 */
grant select on agent_kosten to cse_definer;

create policy d_budget on agent_budget for all to cse_definer using (true) with check (true);
create policy d_reservierung on agent_reservierung for all to cse_definer
  using (true) with check (true);
create policy d_aufgabe on agent_aufgabe for all to cse_definer using (true) with check (true);
create policy d_kosten on agent_kosten for select to cse_definer using (true);

-- =========================================================================
-- 11. Wer bekommt die Stoppmeldung? — abgeleitet, nicht erfunden
-- =========================================================================

/**
 * **`app.benutzer_mit_recht` — wer haelt dieses Recht in diesem Mandanten?**
 *
 * AGT-05 verlangt einen Hartstopp MIT Benachrichtigung. Einen Empfaenger zu
 * waehlen hiesse, eine Zustaendigkeit zu erfinden (der Befund aus O-357);
 * abzuleiten, wer das Budget verwalten DARF, heisst dagegen nur, das
 * Rechtemodell zu lesen.
 *
 * **Warum nicht `app.hat_recht`.** Die beantwortet eine andere Frage: „darf
 * DIESE Sitzung das jetzt" — samt Zweitfaktor und Gruppenansicht. Beides sind
 * Eigenschaften der Sitzung, nicht des Menschen. Ein Nachtlauf hat keine
 * Sitzung, und ob jemand gerade mit zweitem Faktor angemeldet ist, aendert
 * nichts daran, wer fuer das Budget zustaendig ist. Diese Funktion loest
 * deshalb NUR die Berechtigung auf: globale Rolle zuerst, dann die
 * Mitgliedschaftsrolle in genau diesem Bereich, mandantenspezifisch vor
 * Plattformvorgabe — dieselbe Rangfolge wie in `app.hat_recht`.
 */
create function app.benutzer_mit_recht(p_schluessel text, p_mandant uuid)
returns setof uuid
language sql stable security definer set search_path = pg_catalog, public, app as $$
  with recht as (
    select b.id, b.nur_global from public.berechtigung b where b.schluessel = p_schluessel
  ),
  global as (
    select bn.id as benutzer_id
      from public.benutzer bn
      join recht r on true
      join public.rolle_berechtigung rb
        on rb.rolle_id = bn.globale_rolle_id and rb.berechtigung_id = r.id
       and rb.mandant_id is not distinct from p_mandant
     where bn.status = 'aktiv' and bn.deaktiviert_am is null and rb.gewaehrt
    union
    select bn.id
      from public.benutzer bn
      join recht r on true
      join public.rolle_berechtigung rb
        on rb.rolle_id = bn.globale_rolle_id and rb.berechtigung_id = r.id
       and rb.mandant_id is null
     where bn.status = 'aktiv' and bn.deaktiviert_am is null and rb.gewaehrt
       and not exists (select 1 from public.rolle_berechtigung rb2
                        where rb2.rolle_id = bn.globale_rolle_id
                          and rb2.berechtigung_id = r.id
                          and rb2.mandant_id = p_mandant)
  ),
  mitglied as (
    select bm.benutzer_id
      from public.benutzer_mandant bm
      join public.benutzer bn on bn.id = bm.benutzer_id
      join recht r on not r.nur_global
      join public.rolle_berechtigung rb
        on rb.rolle_id = bm.rolle_id and rb.berechtigung_id = r.id
       and rb.mandant_id is not distinct from p_mandant
     where bm.mandant_id = p_mandant
       and bm.entzogen_am is null
       and bm.gueltig_ab <= current_date
       and (bm.gueltig_bis is null or bm.gueltig_bis >= current_date)
       and (bm.module is null or split_part(p_schluessel, '.', 1) = any (bm.module))
       and bn.status = 'aktiv' and bn.deaktiviert_am is null
       and rb.gewaehrt
  )
  select benutzer_id from global
  union
  select benutzer_id from mitglied
$$;

alter function app.benutzer_mit_recht(text, uuid) owner to cse_definer;
revoke all on function app.benutzer_mit_recht(text, uuid) from public;
grant execute on function app.benutzer_mit_recht(text, uuid) to cse_app, cse_job;

/**
 * **Was die Funktion dafuer lesen darf — und nur das** (K-05, D-388).
 *
 * `security definer` verleiht die Rolle, nicht die Rechte: `cse_definer` haelt
 * auf diesen vier Tabellen bisher nichts (ausser sechs Spalten von `benutzer`
 * aus 0116). Ohne die folgenden Grants scheitert der Hartstopp mit „permission
 * denied for table benutzer" — im Ausloeser des Stopps, also genau dort, wo
 * niemand hinsieht, wenn das Budget reisst.
 *
 * Die Grants sind **spaltenscharf**: die Funktion braucht Zuordnungen, keine
 * Namen und keine E-Mail-Adressen. `benutzer.globale_rolle_id` kommt zu den
 * sechs Spalten aus 0116 hinzu; mehr nicht.
 */
grant select (globale_rolle_id) on benutzer to cse_definer;
grant select (id, schluessel, nur_global) on berechtigung to cse_definer;
grant select (rolle_id, berechtigung_id, mandant_id, gewaehrt)
  on rolle_berechtigung to cse_definer;
grant select (benutzer_id, mandant_id, rolle_id, module, entzogen_am,
              gueltig_ab, gueltig_bis)
  on benutzer_mandant to cse_definer;

/**
 * **Und die Policies dazu** — alle drei Tabellen tragen `force row level
 * security`. Unter FORCE heisst „keine anwendbare Policy" nicht *alles*,
 * sondern *nichts*: die Funktion haette das Spaltenrecht und laese null
 * Zeilen, also faende sie nie einen Empfaenger und meldete den Stopp an
 * niemanden — lautlos und plausibel. Dieselbe Form wie `d_benutzer_anmeldung`
 * in 0116: die Verengung liegt nicht in der Zeilenbedingung, sondern darin,
 * dass `cse_definer` NOLOGIN ist und nur ueber benannte Funktionen betreten
 * wird.
 */
create policy d_berechtigung_lesen on berechtigung
  for select to cse_definer using (true);
create policy d_rb_lesen on rolle_berechtigung
  for select to cse_definer using (true);
create policy d_bm_lesen on benutzer_mandant
  for select to cse_definer using (true);

-- =========================================================================
-- 12. `app.agent_stopp_vermerken` — den Hartstopp SCHREIBEN (AGT-05)
-- =========================================================================

/**
 * **Warum das nicht die Anwendung selbst tut.**
 *
 * `benachrichtigung` kennt kein `insert` fuer `cse_app` — und das ist Absicht
 * und bleibt so: einen Posteingang fuellen duerfen Systemlaeufe, nicht die
 * Sitzung eines Menschen. Der Hartstopp ist aber genau so ein Systemakt: er
 * faellt in einer Anfrage an, die gerade abgelehnt wird, und er MUSS eine Spur
 * hinterlassen. Ohne diese Funktion war der Ausgang: entweder `cse_app`
 * bekommt ein `insert` auf den Posteingang aller (zu viel), oder der Stopp
 * bleibt still (AGT-05 verletzt). Die dritte Antwort ist diese: ein benannter,
 * enger Schreiber.
 *
 * **Wie eng.** Die Art ist festverdrahtet, das Ziel-Objekt ist die Budgetzeile,
 * die Empfaenger leitet `app.benutzer_mit_recht` ab — und geschrieben wird
 * ueberhaupt nur, wenn der Stopp in DIESEM Aufruf entstanden ist. Ein zweiter
 * abgelehnter Lauf findet `status = 'gestoppt'` vor, aendert nichts und meldet
 * nichts: ein erschoepftes Budget erzeugt eine Meldung, nicht eine je Versuch.
 *
 * **Titel und Text kommen von aussen** — aus der Artenregistratur in
 * `src/server/agent/benachrichtigung.ts`, wo alle Formulierungen stehen
 * (NOT-01/NOT-03). Sie hier zu wiederholen hiesse, zwei Quellen fuer denselben
 * Satz zu haben, von denen eine irgendwann veraltet.
 */
create function app.agent_stopp_vermerken(
  p_mandant uuid, p_budget uuid, p_titel text, p_text text, p_ziel text
) returns table (neu boolean, empfaenger integer)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_zeilen integer;
  v_empfaenger integer := 0;
begin
  update public.agent_budget
     set status = 'gestoppt', gestoppt_am = coalesce(gestoppt_am, now())
   where mandant_id = p_mandant and id = p_budget and status <> 'gestoppt';
  get diagnostics v_zeilen = row_count;

  if v_zeilen = 0 then
    return query select false, 0;
    return;
  end if;

  insert into public.benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  select p_mandant, e.id, 'agent.budget_erschoepft', p_titel, p_text, p_ziel,
         'agent_budget', p_budget::text, false
    from app.benutzer_mit_recht('agent.budget_verwalten', p_mandant) as e(id);
  get diagnostics v_empfaenger = row_count;

  /*
   * Null Empfaenger ist ein BEFUND, kein Fehler: gestoppt wird trotzdem, und
   * der Aufrufer bekommt die Zahl, damit er sie melden kann. Ein `raise` hier
   * naehme den Stopp mit zurueck — derselbe Rollback-Befund wie in
   * `app.agent_budget_pruefen`.
   */
  return query select true, v_empfaenger;
end $$;

alter function app.agent_stopp_vermerken(uuid, uuid, text, text, text) owner to cse_definer;
revoke all on function app.agent_stopp_vermerken(uuid, uuid, text, text, text) from public;
grant execute on function app.agent_stopp_vermerken(uuid, uuid, text, text, text)
  to cse_app, cse_job;

/** Was der Schreiber dafuer braucht — `insert`, sonst nichts. */
grant insert on benachrichtigung to cse_definer;
create policy d_benachrichtigung_anlegen on benachrichtigung
  for insert to cse_definer with check (true);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0128)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- agent_aufgabe (archiv): AGT-04. Was ein Agent getan hat, ist die Antwort auf die Frage, warum etwas im System steht. Eine geloeschte Aufgabe nimmt ihre Schritte mit — und damit die Begruendung eines Entwurfs, den ein Mensch freigegeben hat. Beendet wird mit status, nie durch Loeschen.
create trigger trg_agent_aufgabe_kein_hard_delete
  before delete on agent_aufgabe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_aufgabe_kein_truncate
  before truncate on agent_aufgabe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_aufgabe from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_schritt (append): AGT-04, LEG-09. Das Schrittprotokoll ist der Nachweis, WAS der Agent gelesen und WAS er einem Modell geschickt hat. Die einzige erlaubte Aenderung ist die Schwaerzung der Nutzlast nach Frist — sie leert Spalten und entfernt keine Zeile.
create trigger trg_agent_schritt_kein_hard_delete
  before delete on agent_schritt
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_schritt_kein_truncate
  before truncate on agent_schritt
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_schritt from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_kosten (append): AGT-05. Die Kostenzeilen SIND das Monatsbudget: der Verbrauch ist ihre Summe. Eine geloeschte Zeile senkt den Verbrauch und hebt damit ruecklaufend eine Obergrenze auf, die bereits gegriffen hat. Korrigiert wird durch eine zweite Zeile.
create trigger trg_agent_kosten_kein_hard_delete
  before delete on agent_kosten
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_kosten_kein_truncate
  before truncate on agent_kosten
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_kosten from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_budget (archiv): AGT-05. Die Budgetzeile traegt die Obergrenze UND den Nachweis, dass und wann gestoppt wurde (gestoppt_am). Sie zu loeschen loescht beides und laesst die Agenten im naechsten Aufruf weiterlaufen, als waere nichts gewesen.
create trigger trg_agent_budget_kein_hard_delete
  before delete on agent_budget
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_budget_kein_truncate
  before truncate on agent_budget
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_budget from cse_app, cse_anon, cse_checkin, cse_job;

-- agent_reservierung (archiv): AGT-05. Eine Reservierung ist gebundenes Budget. Wird die Zeile geloescht statt freigegeben, bleibt der Zaehler in agent_budget gebunden und niemand kann mehr sehen, wofuer — geschlossen wird mit freigegeben_am und freigabe_grund.
create trigger trg_agent_reservierung_kein_hard_delete
  before delete on agent_reservierung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_agent_reservierung_kein_truncate
  before truncate on agent_reservierung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on agent_reservierung from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks

