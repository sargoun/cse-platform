-- ===========================================================================
-- 0136 — Der Freigabe-Posteingang: Diff, Quelle, Konfidenz, Schnappschuss
--        (APR-01, APR-02, APR-03, APR-07; K-13, Invariante 7)
-- ===========================================================================
--
-- 0012 hat die Freigabe als VORGANG angelegt: eine Zeile, ein Status, eine
-- verkettete Nutzlast. Das genuegte, solange eine Freigabe „diese Aktion, ja
-- oder nein" hiess.
--
-- Was fehlt, ist alles, was aus einem Klick eine PRUEFUNG macht:
--
--  (1) **Der Posteingang hat keine Ordnung.** `freigabe` traegt `frist` und
--      `risiko` (letzteres als freien Text), aber keine Vorgangsart, keinen
--      Titel, keine Zusammenfassung und keinen Betrag. Eine Liste, die nur
--      Aktionsschluessel zeigt, ist keine, die jemand von oben abarbeitet.
--
--  (2) **Es gibt keinen Diff.** APR-02 sagt: zeige, WAS sich geaendert hat,
--      nicht das ganze Dokument. Ohne `diff` und `vorschau_payload` bleibt
--      dem Menschen das ganze Dokument — und vierzig Positionen liest
--      niemand zweimal.
--
--  (3) **Kein extrahierter Wert nennt seine Quelle.** APR-03 verlangt je
--      Feld Seite, Tabelle, Zelle, Zitat und eine Konfidenz. Ohne sie ist
--      „aus dem Dokument gelesen" eine Behauptung ohne Beleg.
--
--  (4) **Niemand weiss, ob die Freigabe angesehen wurde.** Ohne
--      `freigabe_ansicht` laesst sich eine Entscheidung nicht von einem
--      Reflex unterscheiden — und `pruefdauer_sek` waere nicht berechenbar.
--
--  (5) **Der Schnappschuss bezeugt zu wenig.** Er haelt die Nutzlast fest,
--      aber nicht den Diff, nicht die Feldnachweise, nicht das Ansichtsmodell
--      und nicht das Ergebnis des Tores — also NICHT, was auf dem Schirm
--      stand. Genau das ist der Satz, den APR-07 belegen soll.
--
-- Was hier NICHT gebaut wird und warum:
--
--  * `artefakt_id` und `vergleichsartefakt_id` (§4.2) sind zusammengesetzte
--    Fremdschluessel auf `agent_artefakt`. Diese Tabelle gibt es noch nicht
--    — sie gehoert zu PR 73/75. Eine Spalte ohne ihren Fremdschluessel waere
--    schlechter als keine: sie saehe verbunden aus und traegt jede beliebige
--    Kennung. Der Abdruck `freigabe_snapshot.artefakt_hash` steht dagegen
--    schon hier, weil er in die Hashformel eingeht und sonst nachtraeglich
--    die Kette aendern muesste.
--  * Stapel (APR-04), verzoegerte Freigabe (APR-05), Widerruf-Fenster
--    (APR-06) und die Stempelerkennung (APR-08) sind PR 77. Ihre SPALTEN
--    stehen hier mit ihren Riegeln — eine Tabelle wird einmal deklariert
--    (K-21), und ein nachgereichtes `alter table` auf einer Tabelle mit
--    Unveraenderlichkeitsauslösern ist teurer als eine Spalte, die eine
--    Weile niemand schreibt.

-- ---------------------------------------------------------------------------
-- 1. Vokabular
-- ---------------------------------------------------------------------------

/**
 * `risiko` war in 0012 ein freier `text`. Ein freier Text sortiert nicht: die
 * Ordnung des Posteingangs (APR-01) braucht drei Stufen mit einer Reihenfolge,
 * und „Hoch", „hoch" und „HOCH" waeren drei davon.
 */
create type risiko_stufe as enum ('niedrig', 'mittel', 'hoch');

/** Die fuenf Entscheidungsarten des Schnappschusses (§4.7). */
create type freigabe_art as enum (
  'genehmigt', 'abgelehnt', 'korrektur', 'widerruf', 'automatisch_nach_frist');

/**
 * Die Ausfuehrung ist ein eigener Zustand, nicht eine Folge des Status.
 *
 * Ohne ihn unterscheidet nichts „die genehmigte Mail ist raus" von „der
 * Ausfuehrende ist abgestuerzt" — und das Undo-Fenster begaenne beim
 * Vorschlag statt bei der Handlung, koennte also ablaufen, bevor ueberhaupt
 * etwas geschehen ist (§4.8).
 */
create type ausfuehrung_status as enum (
  'offen', 'laeuft', 'ausgefuehrt', 'fehlgeschlagen', 'zurueckgenommen');

/**
 * Vier weitere Werte fuer `freigabe_status`.
 *
 * `korrigiert` ist der wichtigste: „Freigabe mit Korrektur" ist der NORMALE
 * Ausgang einer echten Pruefung (§4.5), und ohne diesen Wert bliebe einem
 * Menschen, der einen falschen extrahierten Wert entdeckt, nur die Ablehnung.
 */
alter type freigabe_status add value if not exists 'zurueckgezogen';
alter type freigabe_status add value if not exists 'widerrufen';
alter type freigabe_status add value if not exists 'korrigiert';
alter type freigabe_status add value if not exists 'automatisch_freigegeben';

comment on type risiko_stufe is
  'APR-01. Drei Stufen mit einer ORDNUNG — der Posteingang sortiert danach, '
  'und ein freier Text sortiert nicht. Die Einstufung entscheidet Code '
  '(services/freigabe/posteingang.ts), nie ein Modell.';

comment on type freigabe_art is
  'APR-07, §4.7. Was ein Schnappschuss festhaelt. korrektur und widerruf sind '
  'ZUSAETZLICHE Zeilen zu einer bestehenden Entscheidung, nie deren Aenderung.';

-- ---------------------------------------------------------------------------
-- 2. `freigabe` wird zu einem Posteingangseintrag
-- ---------------------------------------------------------------------------

/**
 * `risiko` von `text` auf `risiko_stufe`.
 *
 * Die Umstellung ist heute folgenlos — keine Zeile traegt einen Wert, weil
 * kein Schreiber die Spalte je gefuellt hat (0012 legte sie an, PR 62 ist der
 * erste, der sie braucht). Genau deshalb geschieht sie JETZT: mit Daten darin
 * waere sie eine Wanderung mit einer Abbildungstabelle, die jemand erfinden
 * muesste.
 */
alter table freigabe
  alter column risiko type risiko_stufe using risiko::risiko_stufe;

alter table freigabe
  add column vorgang_typ        agent_vorgang_typ,
  add column titel              text check (titel is null or length(btrim(titel)) > 0),
  add column zusammenfassung    text,
  add column risiko_punkte      integer,
  add column diff               jsonb not null default '[]'::jsonb,
  add column vorschau_payload   jsonb,
  add column payload_hash       text
    check (payload_hash is null or payload_hash ~ '^[0-9a-f]{64}$'),
  add column betrag_cent        bigint,
  add column agent_aufgabe_id   uuid,
  add column agent_id           uuid references agent(id),
  add column richtlinie_id      uuid,
  add column bezug_typ          text,
  add column bezug_id           uuid,
  add column min_konfidenz      numeric(4,3)
    check (min_konfidenz is null or (min_konfidenz >= 0 and min_konfidenz <= 1)),
  add column unsichere_felder_anzahl integer not null default 0
    check (unsichere_felder_anzahl >= 0),
  add column stapel_faehig      boolean not null default false,
  add column stapel_sperre_grund text,
  add column verzoegerte_freigabe_bis timestamptz,
  add column undo_bis           timestamptz,
  add column zugewiesen_an      uuid references benutzer(id),
  add column ausfuehrung_status ausfuehrung_status not null default 'offen',
  add column ausgefuehrt_am     timestamptz,
  add column ausfuehrung_fehler text,
  add column ausfuehrung_versuch integer not null default 0
    check (ausfuehrung_versuch >= 0),
  add column externe_ref        text,
  add column ersetzt_durch_freigabe_id uuid,
  add column erforderliches_recht text;

/**
 * `agent_richtlinie` traegt bisher nur `unique (mandant_id, aktion)`. Ein
 * zusammengesetzter Fremdschluessel braucht aber einen Index ueber genau
 * `(mandant_id, id)` — ohne ihn scheitert die Beziehung unten, und ohne die
 * Beziehung koennte eine Freigabe auf die Richtlinie einer anderen
 * Gesellschaft verweisen.
 */
alter table agent_richtlinie
  add constraint agent_richtlinie_mandant_uk unique (mandant_id, id);

/**
 * **Der zusammengesetzte Selbstbezug** (K-03): eine Korrektur ersetzt eine
 * Freigabe DESSELBEN Mandanten. Ohne `mandant_id` im Schluessel koennte eine
 * Gesellschaft die Freigabe einer anderen als ersetzt markieren — der Weg,
 * auf dem eine Mandantsgrenze nicht durch ein Leck faellt, sondern durch
 * einen Verweis.
 */
alter table freigabe
  add constraint freigabe_ersetzt_fk
    foreign key (mandant_id, ersetzt_durch_freigabe_id) references freigabe (mandant_id, id),
  add constraint freigabe_richtlinie_fk
    foreign key (mandant_id, richtlinie_id) references agent_richtlinie (mandant_id, id),
  add constraint freigabe_aufgabe_fk
    foreign key (mandant_id, agent_aufgabe_id) references agent_aufgabe (mandant_id, id);

/**
 * **Nichts sitzt im Posteingang, was sich nicht pruefen laesst.**
 *
 * Die naheliegende Fassung waere `not null` auf allen fuenf Spalten gewesen.
 * Sie ist falsch, und zwar nicht aus Ruecksicht auf vorhandene Zeilen: eine
 * Freigabe, die ein Dienst in EINEM Schritt erteilt (`erteilen.ts` —
 * Eingangsrechnung buchen, Mahnung freigeben), ist die AUFZEICHNUNG einer
 * Entscheidung, kein wartender Vorschlag. Sie hat keinen Diff, keine
 * Vorschau und keine Vorgangsart, weil es nichts vorzulegen gab; ihr eine
 * `agent_vorgang_typ` zuzuweisen hiesse, eine Abbildung zu ERFINDEN, die
 * niemand bestaetigt hat (`CLAUDE.md`: keine erfundene Geschaeftsregel).
 *
 * Was wirklich gilt, ist die Bedingung darunter: WER WARTET, MUSS LESBAR
 * SEIN. `status = 'offen'` heisst „ein Mensch soll das ansehen", und ohne
 * Titel, Zusammenfassung, Vorschau und Abdruck kann er das nicht.
 */
alter table freigabe
  add constraint freigabe_offen_ist_vorzeigbar check (
    status <> 'offen'
    or (vorgang_typ is not null
        and titel is not null
        and zusammenfassung is not null
        and vorschau_payload is not null
        and payload_hash is not null
        and risiko is not null));

/** APR-04 in der Datenbank: ein unsicheres Feld, und der Vorgang verlaesst den Stapel. */
alter table freigabe
  add constraint freigabe_stapel_nur_ohne_unsichere
    check (unsichere_felder_anzahl = 0 or not stapel_faehig),
  add constraint freigabe_stapel_ohne_sperrgrund
    check (not stapel_faehig or stapel_sperre_grund is null);

/**
 * APR-05 woertlich: verzoegerte Freigabe gilt fuer Handlungen mit NIEDRIGEM
 * Risiko — und die sieben Vorgangsarten unten sind auch dann keine, wenn
 * jemand eine Richtlinie auf `niedrig` stellt.
 *
 * Ohne diesen Riegel liesse sich `externer_versand` mit einer editierbaren
 * Richtlinie auf „laeuft nach zwei Stunden von selbst raus" setzen, und der
 * Fristenwaechter schriebe eine Entscheidung ohne Menschen — ein direkter
 * Bruch von Invariante 7 ueber eine Konfigurationszeile.
 */
alter table freigabe
  add constraint freigabe_verzoegerung_nur_niedrig check (
    verzoegerte_freigabe_bis is null
    or (risiko = 'niedrig'
        and vorgang_typ not in ('externer_versand', 'angebot_erstellen',
                                'nachlass_gewaehren', 'buchung_uebernehmen',
                                'beitrag_veroeffentlichen', 'mahnung_vorschlagen',
                                'stellenanzeige_entwurf')));

/** Das Undo-Fenster haengt an der AUSFUEHRUNG, nie am Vorschlag (§4.8). */
alter table freigabe
  add constraint freigabe_undo_nach_ausfuehrung check (
    undo_bis is null or ausgefuehrt_am is not null),
  add constraint freigabe_ausgefuehrt_hat_zeitpunkt check (
    ausfuehrung_status <> 'ausgefuehrt' or ausgefuehrt_am is not null),
  add constraint freigabe_fehler_hat_grund check (
    ausfuehrung_status <> 'fehlgeschlagen' or ausfuehrung_fehler is not null);

comment on column freigabe.diff is
  'APR-02. Was sich gegenueber dem Vergleichbaren geaendert hat — NICHT das '
  'ganze Dokument. Gerechnet von services/freigabe/diff.ts, in Cent.';
comment on column freigabe.vorschau_payload is
  'Genau das, was bei Freigabe ausgefuehrt wuerde. payload_hash bindet die '
  'Entscheidung daran: wer danach den Text aendert, hat keine Freigabe mehr '
  'fuer das, was er tut.';
comment on column freigabe.erforderliches_recht is
  'K-19. Der Katalogschluessel, den ein Entscheider fuer DIESE Anfrage halten '
  'muss. Von trg_freigabe_recht_gueltig gegen berechtigung.schluessel '
  'geprueft: ein Tippfehler macht hat_recht dauerhaft false und die Anfrage '
  'damit von niemandem entscheidbar — kein Fehler, ein stiller Stillstand.';

-- ---------------------------------------------------------------------------
-- 3. `freigabe_feld` — jedes extrahierte Feld nennt seine Quelle (APR-03)
-- ---------------------------------------------------------------------------

create table freigabe_feld (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  freigabe_id   uuid not null,

  /** JSON-Pointer in `vorschau_payload`, z. B. `/positionen/3/menge`. */
  feld_pfad     text not null check (feld_pfad ~ '^/'),
  bezeichnung   text not null check (length(btrim(bezeichnung)) > 0),

  /** Eine DARSTELLUNG, nie Eingabe einer Rechnung (Invariante 6). */
  wert_vorher   text,
  wert_nachher  text,

  /** Eine Wahrscheinlichkeit — kein Geld, keine Dauer (K-16). */
  konfidenz     numeric(4,3) check (konfidenz is null or (konfidenz between 0 and 1)),
  unsicher      boolean not null default false,
  /** Der kurze Satz neben der Warnpille: „USt-Summe weicht um 0,02 € ab". */
  grund         text,

  quelle_dokument_id uuid,
  quelle_seite       integer check (quelle_seite is null or quelle_seite > 0),
  quelle_tabelle     text,
  quelle_zelle       text,
  /** `{x,y,w,h}` fuer die Hervorhebung im PDF-Betrachter. */
  quelle_bbox        jsonb,
  quelle_zitat       text,
  extraktion_modell  text,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),

  constraint freigabe_feld_mandant_uk unique (mandant_id, id),
  constraint ff_freigabe_fk
    foreign key (mandant_id, freigabe_id) references freigabe (mandant_id, id),
  constraint ff_dokument_fk
    foreign key (mandant_id, quelle_dokument_id) references dokument (mandant_id, id),

  /**
   * **APR-03 als Riegel und nicht als Vorsatz.** Ein extrahierter Wert ohne
   * jede Quellangabe ist eine Behauptung: er sieht aus wie „aus dem Dokument
   * gelesen", und niemand kann nachsehen, woher. Mindestens eine Angabe —
   * Dokument, Zitat — muss stehen.
   *
   * `wissens_chunk_id` fehlt in dieser Aufzaehlung, weil es die Tabelle
   * `wissens_chunk` noch nicht gibt (PR 73). Sie kommt mit ihr, samt dem
   * zusammengesetzten Fremdschluessel, den sie wegen ihrer Partitionierung
   * braucht (K-16(a)).
   */
  constraint ff_hat_eine_quelle check (
    quelle_dokument_id is not null
    or (quelle_zitat is not null and length(btrim(quelle_zitat)) > 0)),

  /** Eine Warnung ohne Grund ist eine, die niemand aufloesen kann. */
  constraint ff_unsicher_hat_grund check (
    not unsicher or (grund is not null and length(btrim(grund)) > 0))
);

create unique index ff_uk on freigabe_feld (freigabe_id, feld_pfad);
create index ff_unsicher_idx on freigabe_feld (freigabe_id) where unsicher;

comment on table freigabe_feld is
  'APR-03. Ein extrahierter Wert je Zeile, mit Quelle und Konfidenz. '
  'Anfuegend: eine Korrektur ist eine NEUE freigabe (§4.5), nie ein update '
  'hier — sonst aenderte sich unter einem Menschen, was er gesehen hat.';

-- ---------------------------------------------------------------------------
-- 4. `freigabe_ansicht` — die Pruefdauer misst der SERVER (APR-08)
-- ---------------------------------------------------------------------------

create table freigabe_ansicht (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  freigabe_id   uuid not null,
  benutzer_id   uuid not null references benutzer(id),

  /**
   * **Nur `now()`.** Es gibt keinen Weg, diese Spalte aus einem Rumpf zu
   * setzen, und das ist der ganze Punkt: eine Stempelerkennung, die einem
   * Zeitstempel des Clients glaubt, wird von genau dem besiegt, auf den sie
   * zielt — und meldet danach eine erfundene Verteilung unter einem
   * signierten Nachweis (K-13).
   */
  geoeffnet_am_server timestamptz not null default now(),
  kanal         text check (kanal is null or kanal in ('web', 'mobil')),

  constraint freigabe_ansicht_mandant_uk unique (mandant_id, id),
  constraint fa_freigabe_fk
    foreign key (mandant_id, freigabe_id) references freigabe (mandant_id, id)
);

create unique index fa_uk
  on freigabe_ansicht (freigabe_id, benutzer_id, geoeffnet_am_server);
create index fa_freigabe_idx on freigabe_ansicht (freigabe_id);

/**
 * Der Riegel hinter der Zusage: die Spalte ist auch dann `now()`, wenn ein
 * Aufrufer etwas anderes schickt. `before insert` setzt sie hart — ein
 * `default` allein liesse `insert … (geoeffnet_am_server) values (…)` durch.
 */
create function kern.freigabe_ansicht_serverzeit() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.geoeffnet_am_server := now();
  return new;
end $$;

create trigger trg_freigabe_ansicht_serverzeit
  before insert on freigabe_ansicht
  for each row execute function kern.freigabe_ansicht_serverzeit();

create function kern.freigabe_ansicht_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception
    'freigabe_ansicht ist anfuegend: eine zweite Ansicht ist eine zweite Zeile (APR-08).'
    using errcode = 'restrict_violation';
end $$;

create trigger trg_freigabe_ansicht_unveraenderlich
  before update on freigabe_ansicht
  for each row execute function kern.freigabe_ansicht_unveraenderlich();

comment on table freigabe_ansicht is
  'APR-08, §4.6. Wer eine Freigabe wann GEOEFFNET hat — vom Server gemessen. '
  'Die Entscheidung wird verweigert, wenn keine Zeile existiert: eine '
  'Freigabe fuer etwas, das niemand aufgemacht hat, ist keine Pruefung.';

-- ---------------------------------------------------------------------------
-- 5. `freigabe_snapshot` bezeugt, was auf dem Schirm stand (APR-07, K-13)
-- ---------------------------------------------------------------------------

/**
 * Elf Bestandteile statt sechs.
 *
 * 0012 verkettete `nutzlast_hash`, `entscheidung`, den Entscheider, den
 * Zeitpunkt, die Kettennummer und den Vorgaenger. Das ist kein kleineres
 * Stueck derselben Kette, sondern eine Kette ueber etwas anderes: sie bezeugt
 * die NUTZLAST, aber nicht den Diff, nicht die Feldnachweise, nicht das
 * Ansichtsmodell und nicht das Ergebnis des Tores — also nichts darueber, WAS
 * auf dem Schirm stand, als jemand „Freigeben" drueckte. Genau das sind
 * APR-02 und APR-03, und genau das ist der Satz, den APR-07 belegen soll.
 *
 * Die neuen Spalten sind `not null` mit Vorgabe: eine Entscheidung ohne
 * Ansichtsmodell soll nicht entstehen koennen. Wo es wirklich keines gibt —
 * eine Ablehnung ohne gerendertes Artefakt —, ist der Bestandteil die LEERE
 * Zeichenkette in der Formel, nie ein fehlender Abschnitt.
 */
alter table freigabe_snapshot
  add column art             freigabe_art,
  add column rolle           text,
  add column artefakt_hash   text
    check (artefakt_hash is null or artefakt_hash ~ '^[0-9a-f]{64}$'),
  add column diff            jsonb not null default '[]'::jsonb,
  add column diff_hash       text,
  add column felder          jsonb not null default '[]'::jsonb,
  add column felder_hash     text,
  add column ansicht_modell  jsonb not null default '{}'::jsonb,
  add column ansicht_modell_hash text,
  add column policy_ergebnis jsonb not null default '{}'::jsonb,
  add column policy_ergebnis_hash text,
  add column richtlinien_version text,
  add column code_version    text,
  add column modell          text,
  add column prompt_version  text,
  add column pruefdauer_sek  integer check (pruefdauer_sek is null or pruefdauer_sek >= 0),
  add column ist_stapel      boolean not null default false,
  add column stapel_id       uuid,
  add column stapel_groesse  integer check (stapel_groesse is null or stapel_groesse > 0),
  add column begruendung     text,
  add column widerruft_snapshot_id uuid,
  add column ip_adresse      inet,
  add column user_agent      text,
  add column entschieden_am  timestamptz not null default now();

alter table freigabe_snapshot
  add constraint freigabe_snapshot_mandant_uk unique (mandant_id, id),
  add constraint fs_widerruft_fk
    foreign key (mandant_id, widerruft_snapshot_id)
    references freigabe_snapshot (mandant_id, id);

/**
 * `art` ergaenzt `entscheidung` und ersetzt es nicht.
 *
 * `entscheidung` traegt `freigabe_status` und kennt nur genehmigt/abgelehnt;
 * `art` unterscheidet zusaetzlich Korrektur, Widerruf und Fristablauf. Die
 * alte Spalte einfach umzudeuten haette die vorhandenen Zeilen umgeschrieben
 * — auf einer anfuegenden Tabelle mit einer Hashkette ist das kein Umbau,
 * sondern ein Bruch. Die Zuordnung steht darum als Riegel da, und der
 * Rueckfuellungsschritt unten setzt sie fuer alles Bestehende.
 */
update freigabe_snapshot set art = case entscheidung
  when 'genehmigt' then 'genehmigt'::freigabe_art
  else 'abgelehnt'::freigabe_art end
 where art is null;

alter table freigabe_snapshot
  alter column art set not null,
  add constraint fs_art_passt_zur_entscheidung check (
    (art = 'genehmigt' and entscheidung = 'genehmigt')
    or (art = 'abgelehnt' and entscheidung = 'abgelehnt')
    or art in ('korrektur', 'widerruf', 'automatisch_nach_frist')),
  /** Invariante 7: nur der Fristablauf steht ohne Menschen da. */
  add constraint fs_entscheider_ausser_bei_frist check (
    art = 'automatisch_nach_frist' or entschieden_von is not null),
  add constraint fs_ablehnung_hat_begruendung check (
    art not in ('abgelehnt', 'widerruf') or begruendung is not null),
  add constraint fs_widerruf_zeigt_auf_etwas check (
    art <> 'widerruf' or widerruft_snapshot_id is not null),
  add constraint fs_stapel_hat_gruppe check (
    not ist_stapel or (stapel_id is not null and stapel_groesse is not null));

/**
 * **Genau EINE erste Entscheidung je Freigabe.** Korrekturen und Widerrufe
 * sind zusaetzliche Zeilen; zwei Genehmigungen derselben Freigabe waeren
 * zwei Kettenglieder ueber denselben Vorgang, und keines von beiden wuesste
 * vom anderen.
 */
create unique index fs_erst_uk on freigabe_snapshot (freigabe_id)
  where art in ('genehmigt', 'abgelehnt', 'automatisch_nach_frist');

create index fs_person_idx
  on freigabe_snapshot (mandant_id, entschieden_von, entschieden_am desc);
create index fs_stapel_idx on freigabe_snapshot (stapel_id) where stapel_id is not null;

/**
 * Die APR-08-Abfrage. Der Index wird vom System gebaut und fragt keine
 * Spaltenrechte — er funktioniert also weiter, obwohl `pruefdauer_sek`
 * unten `cse_app` entzogen wird. Gelesen wird er im Waechter unter `cse_job`.
 */
create index fs_rubberstamp_idx on freigabe_snapshot (entschieden_von, entschieden_am)
  where art = 'genehmigt' and pruefdauer_sek < 3;

-- ---------------------------------------------------------------------------
-- 6. Riegel auf `freigabe`: Einfrieren und Rechtekatalog
-- ---------------------------------------------------------------------------

/**
 * **Was ein Mensch gesehen hat, aendert sich nicht unter ihm.**
 *
 * Sobald eine `freigabe_ansicht` existiert, sind `diff`, `vorschau_payload`
 * und `payload_hash` fest. Ohne diesen Riegel koennte ein Agent den Vorschlag
 * nachbessern, waehrend jemand ihn liest — und die Freigabe traefe einen
 * anderen Text als den gelesenen. Die Kette bezeugte danach brav die neue
 * Fassung.
 *
 * Der Status, die Zuweisung, die Ausfuehrungsspalten und die Zaehler bleiben
 * beweglich: sie sind nicht das, was gelesen wurde, sondern das, was danach
 * geschieht.
 */
create function kern.freigabe_eingefroren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if (new.diff is distinct from old.diff
      or new.vorschau_payload is distinct from old.vorschau_payload
      or new.payload_hash is distinct from old.payload_hash)
     and exists (select 1 from public.freigabe_ansicht a where a.freigabe_id = old.id)
  then
    raise exception
      'Freigabe %: Diff und Vorschau sind fest, seit sie jemand geoeffnet hat (APR-02).',
      old.id
      using errcode = 'restrict_violation',
            hint = 'Eine Korrektur ist eine NEUE Freigabe mit ersetzt_durch_freigabe_id (§4.5).';
  end if;
  return new;
end $$;

create trigger trg_freigabe_eingefroren
  before update on freigabe
  for each row execute function kern.freigabe_eingefroren();

/**
 * **Ein unbekannter Rechteschluessel ist kein Fehler, sondern ein
 * dauerhafter Stillstand** (K-19).
 *
 * `app.hat_recht` antwortet fuer einen Schluessel, den der Katalog nicht
 * kennt, `false` — ohne Ausnahme, ohne Protokollzeile. Ein Tippfehler in
 * `erforderliches_recht` wuerde die Anfrage also nicht ablehnen, sondern sie
 * fuer JEDEN unentscheidbar machen, und niemand saehe warum. Deshalb faellt
 * er hier auf, beim Schreiben.
 */
create function kern.freigabe_recht_gueltig() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.erforderliches_recht is not null
     and not exists (select 1 from public.berechtigung b
                      where b.schluessel = new.erforderliches_recht) then
    raise exception
      'erforderliches_recht %: kein Schluessel im Rechtekatalog (K-19).',
      new.erforderliches_recht
      using errcode = 'foreign_key_violation',
            hint = 'hat_recht antwortet darauf dauerhaft false — die Freigabe waere '
                   'von niemandem entscheidbar.';
  end if;
  return new;
end $$;

create trigger trg_freigabe_recht_gueltig
  before insert or update of erforderliches_recht on freigabe
  for each row execute function kern.freigabe_recht_gueltig();

/**
 * `unsichere_felder_anzahl` und `min_konfidenz` werden GEFUEHRT, nicht
 * gemeldet.
 *
 * Ein Dienst, der die Zahl mitschickt, schickt irgendwann die falsche —
 * und der Riegel `freigabe_stapel_nur_ohne_unsichere` prueft dann gegen
 * eine Behauptung statt gegen die Felder. Hier zaehlt die Datenbank.
 */
create function kern.freigabe_felder_zaehlen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_freigabe uuid := coalesce(new.freigabe_id, old.freigabe_id);
begin
  update public.freigabe f
     set unsichere_felder_anzahl = (select count(*) from public.freigabe_feld ff
                                     where ff.freigabe_id = v_freigabe and ff.unsicher),
         min_konfidenz = (select min(ff.konfidenz) from public.freigabe_feld ff
                           where ff.freigabe_id = v_freigabe),
         /* Ein unsicheres Feld nimmt den Vorgang aus dem Stapel (APR-04). */
         stapel_faehig = case
           when exists (select 1 from public.freigabe_feld ff
                         where ff.freigabe_id = v_freigabe and ff.unsicher)
           then false else f.stapel_faehig end
   where f.id = v_freigabe;
  return null;
end $$;

create trigger trg_freigabe_felder_zaehlen
  after insert or update on freigabe_feld
  for each row execute function kern.freigabe_felder_zaehlen();

-- ---------------------------------------------------------------------------
-- 7. Die Entscheidung — eine Funktion, die den Hash nicht entgegennimmt
-- ---------------------------------------------------------------------------

/**
 * **Die Anwendung liefert die kanonischen BYTES, die Datenbank die Kette.**
 *
 * Genau die Bauform von `fin.rechnung_kette_schreiben` (0077), und aus
 * demselben Grund in beiden Faellen:
 *
 *  - Ein Aufrufer, der einen Hash mitschicken darf, kann ihn auch WAEHLEN —
 *    und die Kette bezeugt danach, was er behauptet hat.
 *  - Ein zweiter Kanonisierer in SQL waere die schlimmere Alternative.
 *    Postgres sortiert `jsonb`-Schluessel nach (Laenge, Bytes), RFC 8785 nach
 *    UTF-16-Codeeinheiten; die beiden stimmen fuer `{"b":1,"ab":2}` bereits
 *    nicht ueberein. Zwei Kanonisierer hiessen: der naechtliche Waechter
 *    meldet jede Nacht an jedem Glied einen Bruch, und der erste, der das
 *    sieht, schaltet ihn ab.
 *
 * Und sie prueft, dass die Bytes zu DIESER Freigabe gehoeren:
 * `nutzlast_hash` muss `freigabe.payload_hash` sein. Ohne diese Pruefung
 * liesse sich die Nutzlast eines anderen Vorgangs einreichen, und der
 * Schnappschuss bezeugte eine Entscheidung ueber etwas, das nie vorlag.
 *
 * Die elf Bestandteile, getrennt durch EIN `0x1F` — dieselbe Formel wie in
 * `services/freigabe/kette.ts`, und der Golden-Vector-Test in
 * `tests/isolation/freigabe-posteingang.test.ts` haelt sie zusammen.
 */
create function app.freigabe_entscheiden(
  p_freigabe        uuid,
  p_art             freigabe_art,
  p_nutzlast        jsonb,
  p_nutzlast_bytes  bytea,
  p_diff            jsonb,
  p_diff_bytes      bytea,
  p_felder          jsonb,
  p_felder_bytes    bytea,
  p_ansicht         jsonb,
  p_ansicht_bytes   bytea,
  p_policy          jsonb,
  p_policy_bytes    bytea,
  p_artefakt_hash   text,
  p_begruendung     text,
  p_ip              inet,
  p_user_agent      text,
  p_code_version    text
) returns table (snapshot_id uuid, kette_nr bigint, hash text)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  f            record;
  v_mandant    uuid := app.aktiver_mandant();
  v_benutzer   uuid := app.aktueller_benutzer();
  v_nr         bigint;
  v_vorher     text;
  v_geoeffnet  timestamptz;
  v_dauer      integer;
  v_jetzt      timestamptz := now();
  v_rolle      text;
  v_hash       text;
  v_id         uuid;
  v_nutzlast_hash text;
  v_recht      text;
begin
  if app.ist_readonly() then
    raise exception 'Die Gruppenansicht entscheidet nicht (Invariante 10).'
      using errcode = '42501';
  end if;

  select * into f from public.freigabe where id = p_freigabe;
  if not found then
    raise exception 'Freigabe % existiert nicht oder ist nicht sichtbar.', p_freigabe
      using errcode = 'no_data_found';
  end if;
  if f.mandant_id is distinct from v_mandant then
    raise exception 'Freigabe % gehoert nicht zum aktiven Mandanten (Invariante 3).',
      p_freigabe using errcode = '42501';
  end if;

  /* Das Recht der ANFRAGE, sonst das Modulrecht (§4.2, K-19). */
  v_recht := coalesce(f.erforderliches_recht, 'freigabe.entscheiden');
  if not app.hat_recht(v_recht, f.mandant_id) then
    raise exception '% fehlt', v_recht using errcode = '42501';
  end if;

  /**
   * **Invariante 7 an der einen Stelle, an der sie zaehlt.** Kein Weg durch
   * diese Funktion setzt `entschieden_von` auf NULL — die einzige Art, die
   * das duerfte, ist `automatisch_nach_frist`, und die schreibt der Waechter,
   * nicht ein Mensch an einem Bildschirm.
   */
  if v_benutzer is null then
    raise exception 'Eine Freigabe braucht einen Menschen (Invariante 7).'
      using errcode = '42501';
  end if;

  if f.status <> 'offen' then
    raise exception 'Freigabe % ist bereits entschieden (%).', p_freigabe, f.status
      using errcode = 'restrict_violation';
  end if;

  /**
   * **Ohne Ansicht keine Entscheidung** (§4.6). Eine Freigabe fuer etwas,
   * das niemand aufgemacht hat, ist kein Vorgang, den APR-08 messen koennte
   * — sie ist der Vorgang, den APR-08 finden soll.
   */
  select min(a.geoeffnet_am_server) into v_geoeffnet
    from public.freigabe_ansicht a
   where a.freigabe_id = p_freigabe and a.benutzer_id = v_benutzer;
  if v_geoeffnet is null then
    raise exception
      'Freigabe %: diese Person hat sie nie geoeffnet (APR-08).', p_freigabe
      using errcode = 'restrict_violation',
            hint = 'GET /api/freigaben/[id] schreibt die Ansicht.';
  end if;
  v_dauer := floor(extract(epoch from (v_jetzt - v_geoeffnet)))::integer;

  v_nutzlast_hash := encode(digest(p_nutzlast_bytes, 'sha256'), 'hex');
  if f.payload_hash is not null and v_nutzlast_hash <> f.payload_hash then
    raise exception
      'Freigabe %: die eingereichte Nutzlast ist nicht die vorgelegte.', p_freigabe
      using errcode = 'restrict_violation',
            hint = 'Wer nach der Vorlage aendert, hat fuer das Geaenderte keine Freigabe.';
  end if;

  if p_art in ('abgelehnt', 'widerruf')
     and (p_begruendung is null or length(btrim(p_begruendung)) = 0) then
    raise exception 'Eine Ablehnung ohne Begruendung ist keine Auskunft.'
      using errcode = 'check_violation';
  end if;

  select coalesce(gr.schluessel, r.schluessel) into v_rolle
    from public.benutzer b
    left join public.rolle gr on gr.id = b.globale_rolle_id
    left join public.benutzer_mandant bm
           on bm.benutzer_id = b.id and bm.mandant_id = f.mandant_id
          and bm.entzogen_am is null
    left join public.rolle r on r.id = bm.rolle_id
   where b.id = v_benutzer;

  select k.kette_nr, k.vorheriger_hash into v_nr, v_vorher
    from app.freigabe_kette_ziehen(f.mandant_id) k;

  /*
   * Die elf Bestandteile. `repeat('0',64)` ist der Genesis von 0012; in der
   * Formel steht dafuer die LEERE Zeichenkette, damit sie mit der
   * TypeScript-Fassung uebereinstimmt (`kette.ts`: vorher_hash ist leer, wenn
   * es keinen Vorgaenger gibt).
   */
  v_hash := encode(digest(concat_ws(
    chr(31),
    v_nutzlast_hash,
    coalesce(p_artefakt_hash, ''),
    encode(digest(p_diff_bytes,    'sha256'), 'hex'),
    encode(digest(p_felder_bytes,  'sha256'), 'hex'),
    encode(digest(p_ansicht_bytes, 'sha256'), 'hex'),
    encode(digest(p_policy_bytes,  'sha256'), 'hex'),
    p_art::text,
    v_benutzer::text,
    to_char(v_jetzt at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    v_nr::text,
    case when v_nr = 1 then '' else v_vorher end
  )::bytea, 'sha256'), 'hex');

  insert into public.freigabe_snapshot
    (mandant_id, freigabe_id, kette_nr, nutzlast, nutzlast_hash, vorheriger_hash, hash,
     entscheidung, entschieden_von, entschieden_am, art, rolle, artefakt_hash,
     diff, diff_hash, felder, felder_hash, ansicht_modell, ansicht_modell_hash,
     policy_ergebnis, policy_ergebnis_hash, pruefdauer_sek, begruendung,
     code_version, ip_adresse, user_agent)
  values
    (f.mandant_id, p_freigabe, v_nr, p_nutzlast, v_nutzlast_hash, v_vorher, v_hash,
     case when p_art = 'genehmigt' then 'genehmigt'::freigabe_status
          else 'abgelehnt'::freigabe_status end,
     v_benutzer, v_jetzt, p_art, v_rolle, p_artefakt_hash,
     p_diff,    encode(digest(p_diff_bytes,    'sha256'), 'hex'),
     p_felder,  encode(digest(p_felder_bytes,  'sha256'), 'hex'),
     p_ansicht, encode(digest(p_ansicht_bytes, 'sha256'), 'hex'),
     p_policy,  encode(digest(p_policy_bytes,  'sha256'), 'hex'),
     v_dauer, p_begruendung, p_code_version, p_ip, p_user_agent)
  returning id into v_id;

  update public.freigabe_kette
     set letzter_hash = v_hash, geaendert_am = v_jetzt
   where mandant_id = f.mandant_id;

  update public.freigabe
     set status = case when p_art = 'genehmigt' then 'genehmigt'::freigabe_status
                       else 'abgelehnt'::freigabe_status end,
         freigegeben_von = v_benutzer,
         freigegeben_am  = v_jetzt,
         begruendung     = coalesce(p_begruendung, begruendung),
         geaendert_am    = v_jetzt
   where id = p_freigabe;

  return query select v_id, v_nr, v_hash;
end $$;

alter function app.freigabe_entscheiden(uuid, freigabe_art, jsonb, bytea, jsonb, bytea,
                                        jsonb, bytea, jsonb, bytea, jsonb, bytea,
                                        text, text, inet, text, text)
  owner to cse_definer;
revoke all on function app.freigabe_entscheiden(uuid, freigabe_art, jsonb, bytea, jsonb, bytea,
                                                jsonb, bytea, jsonb, bytea, jsonb, bytea,
                                                text, text, inet, text, text) from public;
grant execute on function app.freigabe_entscheiden(uuid, freigabe_art, jsonb, bytea, jsonb, bytea,
                                                   jsonb, bytea, jsonb, bytea, jsonb, bytea,
                                                   text, text, inet, text, text) to cse_app;

/** Der Definer liest, was er prueft (D-388, K-05). */
grant select on freigabe, freigabe_ansicht, freigabe_feld, berechtigung to cse_definer;
grant select, insert on freigabe_snapshot to cse_definer;
grant select, update on freigabe, freigabe_kette to cse_definer;

-- ---------------------------------------------------------------------------
-- 8. `pruefdauer_sek` — die eine Spalte, die ein Spaltenrecht nicht schuetzt
-- ---------------------------------------------------------------------------

/**
 * **Ein `grant` gilt einer ROLLE, nicht einer Person.**
 *
 * `grant select (pruefdauer_sek) … to cse_app` gaebe die Spalte JEDER
 * Sitzung — sie sind alle `cse_app`. Ein „hinter `freigabe.pruefdauer_lesen`
 * spaltenweise freigegeben" gibt es in Postgres nicht.
 *
 * Und hier ist die Unterscheidung rechtlich tragend: APR-08 misst, wie
 * schnell ein NAMENTLICH bekannter Beschaeftigter freigibt. Das ist
 * Verhaltens- und Leistungskontrolle im Sinne von § 87 Abs. 1 Nr. 6 BetrVG,
 * und ob und in welcher Form sie zulaessig ist, haengt an O-06 — derselben
 * offenen Frage, die LEG-10 blockiert. „Eingeschraenkt" kann dann nicht
 * „allen gegeben und in der Oberflaeche gefiltert" heissen.
 *
 * Also die K-05-Form, genau wie `agent_schritt.eingabe` (0129): die Spalte
 * ist `cse_app` entzogen und nur ueber eine Definer-Funktion lesbar, die das
 * Recht ERNEUT prueft und den Zugriff protokolliert.
 */
revoke select (pruefdauer_sek) on freigabe_snapshot from cse_app;

create function app.freigabe_pruefdauer_lesen(p_snapshot uuid) returns integer
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v record;
begin
  select s.mandant_id, s.pruefdauer_sek into v
    from public.freigabe_snapshot s where s.id = p_snapshot;
  if not found then return null; end if;
  if v.mandant_id is distinct from app.aktiver_mandant() then return null; end if;
  /*
   * Kein `raise`. Wer das Recht nicht hat, soll nicht erfahren, DASS es
   * einen Wert gibt — eine Ausnahme unterschiede „kein Recht" von „keine
   * Zeile" und waere damit selbst die Auskunft.
   */
  if not app.hat_recht('freigabe.pruefdauer_lesen', v.mandant_id) then return null; end if;
  return v.pruefdauer_sek;
end $$;

alter function app.freigabe_pruefdauer_lesen(uuid) owner to cse_definer;
revoke all on function app.freigabe_pruefdauer_lesen(uuid) from public;
grant execute on function app.freigabe_pruefdauer_lesen(uuid) to cse_app;

comment on function app.freigabe_pruefdauer_lesen(uuid) is
  'APR-08, K-05, § 87 Abs. 1 Nr. 6 BetrVG. Die einzige Lesemoeglichkeit fuer '
  'pruefdauer_sek aus der Anwendung. Ohne das Recht: NULL, ohne Ausnahme — '
  'eine Ausnahme waere selbst die Auskunft. Die personenbezogene Auswertung '
  'bleibt bis zur Antwort auf O-06 aus (§4.9).';

-- ---------------------------------------------------------------------------
-- 9. RLS: die Policies wandern von `versand.*` auf `freigabe.*`
-- ---------------------------------------------------------------------------

/**
 * **0012 hat genau das angekuendigt.** Dort steht woertlich: „Wenn PR 62 die
 * `freigabe.*`-Zeilen in den Katalog bringt, wandern die Policies darauf."
 * Die Katalogzeilen stehen seit 0008 (`freigabe.lesen`,
 * `freigabe.entscheiden`, `freigabe.alle_lesen`, `gruppe.freigabe.lesen`,
 * `freigabe.pruefdauer_lesen`), und hier wandern sie.
 *
 * Bis jetzt las den Posteingang, wer `versand.lesen` hielt. Das ist zu weit
 * UND zu eng zugleich: zu weit, weil eine Buchhaltungsfreigabe kein Versand
 * ist; zu eng, weil `freigabe.entscheiden` in 0008 auch `leitung` traegt,
 * `versand.freigeben` aber nicht.
 *
 * **Und die Portaldecke kommt dazu** (K-04, EMP-13). „Freigaben sind
 * Mandantszeilen" ist keine Policy: ein `mitarbeiter` der Reinigung sitzt
 * INNERHALB des Mandanten `reinigung` und laese sonst jede Freigabe dort —
 * Titel, `betrag_cent`, den Diff mit Kundennamen, Preisen und Margen, und die
 * extrahierten Felder mit dem Dokumentinhalt. Genau das verbietet EMP-13.
 */
drop policy t_mandant on freigabe;
drop policy t_gruppe on freigabe;
drop policy t_snapshot_lesen on freigabe_snapshot;
drop policy t_snapshot_schreiben on freigabe_snapshot;

create policy t_mandant on freigabe for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('freigabe.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('freigabe.entscheiden', app.aktiver_mandant())));

create policy t_gruppe on freigabe for select to cse_app
  using (app.ist_gruppenansicht() and mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('gruppe.freigabe.lesen', mandant_id));

create policy p_intern_ceiling on freigabe as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

create policy t_snapshot_lesen on freigabe_snapshot for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('freigabe.lesen', mandant_id));
/*
 * Die Schreibpolicy wandert mit: `versand.freigeben` → `freigabe.entscheiden`.
 * Sie bleibt bestehen, weil es einen legitimen Direktschreiber gibt — die in
 * EINEM Schritt erteilte Freigabe (`erteilen.ts`, Seed). Der wartende Fall
 * geht ueber `trg_freigabe_snapshot_nur_definer` nicht hier durch.
 */
create policy t_snapshot_schreiben on freigabe_snapshot for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('freigabe.entscheiden', mandant_id));

create policy p_intern_ceiling on freigabe_snapshot as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

/**
 * **Ein WARTENDER Vorgang wird nur ueber den Definer entschieden.**
 *
 * Der erste Entwurf hat `insert` auf `freigabe_snapshot` schlicht entzogen.
 * Das war zu grob und hat etwas Funktionierendes zerbrochen: `erteilen.ts`
 * (PR 54.3) und der Seed legen Freigabe UND Schnappschuss in einem Schritt
 * an — eine Entscheidung, die bereits gefallen ist, aufgezeichnet. Dort gibt
 * es keinen Posteingang, keine Ansicht und keine Wartezeit, und es soll auch
 * keine geben.
 *
 * Was wirklich zu schuetzen ist, ist der ANDERE Fall: eine Freigabe, die auf
 * einen Menschen wartet. Fuer sie haengen an `app.freigabe_entscheiden` die
 * Pruefungen, die sie zu einer Pruefung machen — es gibt eine Ansicht, die
 * Nutzlast ist die vorgelegte, die Kettennummer kommt unter `FOR UPDATE`, und
 * `entschieden_von` ist nie NULL. Ein direkter `insert` daran vorbei liesse
 * genau diese vier weg.
 *
 * `current_user` unterscheidet die beiden: in einer `security definer`
 * -Funktion ist er `cse_definer`, ausserhalb `cse_app`. `session_user` bleibt
 * in beiden Faellen `cse_app` und taugt deshalb NICHT.
 */
/**
 * `art` aus `entscheidung`, wo der Schreiber nur die grobe Fassung kennt.
 *
 * `erteilen.ts` und der Seed schreiben eine Entscheidung, die bereits
 * gefallen ist: genehmigt oder abgelehnt, mehr gibt es dort nicht. Die
 * Verfeinerung — Korrektur, Widerruf, Fristablauf — entsteht erst im
 * Posteingang, und `app.freigabe_entscheiden` setzt sie ausdruecklich.
 *
 * Die Ableitung steht als Trigger und nicht als `default`: ein `default`
 * kann keine andere Spalte lesen. Und sie ueberschreibt nichts — wer `art`
 * angibt, behaelt sie.
 */
create function kern.freigabe_snapshot_art_ableiten() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.art is null then
    new.art := case new.entscheidung
      when 'genehmigt' then 'genehmigt'::freigabe_art
      else 'abgelehnt'::freigabe_art end;
  end if;
  return new;
end $$;

create trigger trg_freigabe_snapshot_art_ableiten
  before insert on freigabe_snapshot
  for each row execute function kern.freigabe_snapshot_art_ableiten();

create function kern.freigabe_snapshot_nur_definer() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_user <> 'cse_definer'
     and exists (select 1 from public.freigabe f
                  where f.id = new.freigabe_id and f.status = 'offen') then
    raise exception
      'Freigabe %: ein wartender Vorgang wird ueber app.freigabe_entscheiden '
      'entschieden, nicht durch einen direkten insert.', new.freigabe_id
      using errcode = '42501',
            hint = 'Sonst faellt die Ansichtspruefung (APR-08), die '
                   'Nutzlastpruefung und die Kettennummer unter den Tisch.';
  end if;
  return new;
end $$;

create trigger trg_freigabe_snapshot_nur_definer
  before insert on freigabe_snapshot
  for each row execute function kern.freigabe_snapshot_nur_definer();

do $$
declare t text;
begin
  foreach t in array array['freigabe_feld', 'freigabe_ansicht'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);

    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('freigabe.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('freigabe.lesen', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;
end $$;

/*
 * `freigabe_ansicht` wird beim LESEN geschrieben (§4.6) — die eine Leseroute
 * mit vorgeschriebener Nebenwirkung. Deshalb genuegt `freigabe.lesen` zum
 * Schreiben: wer die Freigabe oeffnen darf, erzeugt damit die Ansicht.
 * `freigabe.entscheiden` zu verlangen hiesse, dass die Pruefdauer eines
 * Mitlesenden nie gemessen wird.
 */
grant select, insert on freigabe_ansicht to cse_app;
grant select, insert on freigabe_feld to cse_app;

-- ---------------------------------------------------------------------------
-- 10. Indizes des Posteingangs (APR-01)
-- ---------------------------------------------------------------------------

/**
 * Der Posteingangsindex traegt `status` NICHT im Schluessel: das Praedikat
 * legt ihn bereits fest, und eine Spalte, die in jeder Zeile des Index
 * denselben Wert hat, ordnet nichts.
 */
drop index if exists freigabe_offen_idx;
create index freigabe_posteingang_idx
  on freigabe (mandant_id, frist nulls last, risiko desc)
  where status = 'offen';

create index freigabe_stapel_idx on freigabe (mandant_id)
  where stapel_faehig and status = 'offen';
create index freigabe_verzoegert_idx on freigabe (verzoegerte_freigabe_bis)
  where status = 'offen' and verzoegerte_freigabe_bis is not null;
create index freigabe_undo_idx on freigabe (undo_bis) where undo_bis is not null;
create index freigabe_ausfuehrung_idx on freigabe (mandant_id, ausfuehrung_status)
  where ausfuehrung_status in ('offen', 'laeuft', 'fehlgeschlagen');
create index freigabe_bezug_idx on freigabe (bezug_typ, bezug_id)
  where bezug_id is not null;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0136)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- freigabe_feld (append): APR-03, APR-07, K-13. Jede Zeile ist der NACHWEIS, woher ein extrahierter Wert stammt — Seite, Zelle, Zitat, Konfidenz. Sie zu loeschen naehme genau die Spur, auf die sich eine Freigabe beruft, und liesse die Entscheidung als Behauptung zurueck. Eine Korrektur ist eine NEUE freigabe mit ersetzt_durch_freigabe_id, nie ein Entfernen hier.
create trigger trg_freigabe_feld_kein_hard_delete
  before delete on freigabe_feld
  for each row execute function kern.verhindere_loeschung();
create trigger trg_freigabe_feld_kein_truncate
  before truncate on freigabe_feld
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on freigabe_feld from cse_app, cse_anon, cse_checkin, cse_job;

-- freigabe_ansicht (append): APR-08, K-13, LEG-01. Sie bezeugt, dass ein Mensch die Freigabe geoeffnet hat, und ist die einzige Grundlage von pruefdauer_sek. Loeschbar waere sie genau das Werkzeug dessen, den APR-08 finden soll: wer zu schnell entscheidet, raeumte die Messung hinter sich weg, und die Auswertung meldete danach nur noch die Sorgfaeltigen.
create trigger trg_freigabe_ansicht_kein_hard_delete
  before delete on freigabe_ansicht
  for each row execute function kern.verhindere_loeschung();
create trigger trg_freigabe_ansicht_kein_truncate
  before truncate on freigabe_ansicht
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on freigabe_ansicht from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
