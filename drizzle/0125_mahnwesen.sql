/**
 * 0125 — Das Mahnwesen (FIN-15, ACC-07, APR-07; `05-FINANZEN.md` §3.2, §7.5–§7.7).
 *
 * **Nichts geht hier von selbst hinaus.** Invariante 7 gilt an dieser Stelle
 * besonders scharf: eine Mahnung ist eine Willenserklaerung mit
 * Verzugsfolgen, und §286 BGB knuepft daran Zinsen. Der Lauf erzeugt deshalb
 * einen ENTWURF und nie einen Brief; freigegeben wird von einem Menschen, und
 * erst die Freigabe zieht die Nummer.
 *
 * **Und nichts wird hier erfunden.** Wie viele Stufen es gibt, in welchen
 * Abstaenden, mit welcher Gebuehr und ob ueberhaupt Verzugszinsen erhoben
 * werden — das ist offen (O-19). `mahnstufe.ist_platzhalter` steht deshalb
 * auf `true`, und solange sie es tut, erzeugt der Lauf NICHTS. Ein Brief mit
 * einer geratenen Mahngebuehr geht an einen echten Kunden, und die Gebuehr
 * steht dann in einem Schreiben, das die Gruppe nicht mehr zurueckholt.
 * TODO(client, O-19): Wie viele Mahnstufen, in welchen Abstaenden, mit welcher
 * Gebuehr je Stufe, und werden Verzugszinsen erhoben (§288 BGB: B2B
 * Basiszins + 9 Prozentpunkte, B2C + 5) oder darauf verzichtet?
 *
 * **Zwei Regeln, die der erste Entwurf des Datenmodells still gesetzt hatte
 * und die hier ausdruecklich offen bleiben** (§7.6):
 *
 *   1. **Ab wann laeuft der Verzug?** Der Entwurf rechnete ab Faelligkeit.
 *      §286 BGB verlangt eine Mahnung — oder §286 Abs. 3: dreissig Tage nach
 *      Faelligkeit UND Zugang der Rechnung, gegenueber Verbrauchern nur bei
 *      Hinweis auf diese Folge. Ab Faelligkeit zu rechnen fordert zu viel.
 *   2. **Nach welcher Tageszaehlung?** act/365, act/360 und act/act ergeben
 *      verschiedene Betraege. Das ist eine kaufmaennische Wahl, keine
 *      Selbstverstaendlichkeit.
 *
 * Beide stehen als Spalte AUF der Position — nicht als Einstellung daneben:
 * ein Anspruch muss reproduzierbar bleiben, auch wenn die Einstellung sich
 * spaeter aendert.
 */

-- =========================================================================
-- 1. Die Vokabulare (§3.1)
-- =========================================================================

create type mahnung_status as enum
  ('entwurf', 'freigegeben', 'versendet', 'erledigt', 'verworfen');

create type mahn_zinsberechnung as enum
  ('keine', 'gesetzlich_b2b', 'gesetzlich_b2c', 'vertraglich');

comment on type mahn_zinsberechnung is
  'PLATZHALTER (O-19). §288 BGB unterscheidet B2B (Basiszins + 9 Prozent'
  'punkte) von B2C (+ 5). Ob die Gruppe ueberhaupt Zinsen erhebt, hat '
  'niemand entschieden — die Vorgabe ist deshalb `keine`.';

create type zins_methode as enum ('act_365', 'act_360', 'act_act');

comment on type zins_methode is
  'PLATZHALTER, ohne Vorgabewert (O-19). Die Tageszaehlung aendert den '
  'geforderten Betrag; sie steht auf jeder mahnung_position, damit ein '
  'Anspruch reproduzierbar bleibt.';

create type verzugsbeginn_regel as enum
  ('mit_faelligkeit', 'nach_mahnung', 'dreissig_tage_nach_zugang');

create type mahn_folgeaktion as enum
  ('keine', 'lieferstopp', 'inkasso', 'mahnbescheid');

-- =========================================================================
-- 2. basiszinssatz (§3.2) — global, nicht mandantengebunden
-- =========================================================================

/**
 * Der Basiszinssatz der Bundesbank je Halbjahr.
 *
 * **Kein `CHECK (satz_bp >= 0)`.** Er stand jahrelang bei −88 Basispunkten.
 * Eine Schranke, die den tatsaechlichen Wert verbietet, macht die Tabelle
 * unbefuellbar — und dann rechnet jemand von Hand.
 *
 * **Nicht mandantengebunden, weil er es nicht ist.** Der Satz gilt fuer die
 * Bundesrepublik; ihn je Gesellschaft zu fuehren hiesse, vier Kopien
 * derselben Zahl zu pflegen und drei davon irgendwann falsch zu haben.
 */
create table basiszinssatz (
  id            uuid primary key default gen_random_uuid(),
  gueltig_von   date not null,
  gueltig_bis   date,
  satz_bp       integer not null,
  quelle        text not null default 'Deutsche Bundesbank',
  erstellt_am   timestamptz not null default now(),

  constraint bzs_von_uk unique (gueltig_von),
  constraint bzs_zeitraum check (gueltig_bis is null or gueltig_bis >= gueltig_von),
  /* Zwei Saetze duerfen sich nicht ueberlappen — sonst gilt an einem Tag
     beides, und der Anspruch haengt an der Sortierung. */
  constraint bzs_kein_ueberlapp exclude using gist (
    daterange(gueltig_von, coalesce(gueltig_bis + 1, 'infinity'::date), '[)') with &&)
);

comment on table basiszinssatz is
  'FIN-15, §247 BGB. Aendert sich zum 1. Januar und 1. Juli. Wird nie '
  'abgeleitet und nie von einem Modell vorgeschlagen (Invariante 6, AGT-07); '
  'deckt kein Satz das Mahndatum, wird KEIN Zins berechnet — ein veralteter '
  'Basiszins ergibt einen Anspruch, der falsch ist, und zwar in eine '
  'Richtung, die erst der Empfaenger bemerkt.';

alter table basiszinssatz enable row level security;
alter table basiszinssatz force  row level security;

/** Referenzdaten: jeder Bereich liest, nur `system.referenzdaten_verwalten`
 *  schreibt — dieselbe Menge wie bei `steuersatz_gruppe` (0075). */
create policy r_lesen on basiszinssatz for select to cse_app using (true);
create policy r_pflege on basiszinssatz for insert to cse_app
  with check (app.ist_super_admin() and not app.ist_readonly()
              and (select app.hat_recht('system.referenzdaten_verwalten',
                                        app.aktiver_mandant())));
create policy r_pflege_u on basiszinssatz for update to cse_app
  using (app.ist_super_admin())
  with check (not app.ist_readonly()
              and (select app.hat_recht('system.referenzdaten_verwalten',
                                        app.aktiver_mandant())));
grant select, insert, update on basiszinssatz to cse_app;
grant select on basiszinssatz to cse_definer, cse_job;
create policy r_lesen_definer on basiszinssatz for select to cse_definer using (true);
create policy r_lesen_job on basiszinssatz for select to cse_job using (true);

-- =========================================================================
-- 3. mahnstufe (§3.2)
-- =========================================================================

create table mahnstufe (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  /**
   * `> 0` und keine Obergrenze. Der erste Entwurf schrieb `between 1 and 9`;
   * die untere Grenze ist definitorisch, die obere war eine erfundene
   * Geschaeftsregel.
   */
  stufe                 integer not null check (stufe > 0),
  bezeichnung           text not null check (length(btrim(bezeichnung)) > 0),
  tage_nach_faelligkeit integer not null check (tage_nach_faelligkeit >= 0),

  /** PLATZHALTER 0 (O-19). Eine Gebuehr, die niemand vereinbart hat, ist eine
   *  Forderung ohne Grundlage. */
  gebuehr_cent          bigint not null default 0 check (gebuehr_cent >= 0),
  zinsberechnung        mahn_zinsberechnung not null default 'keine',
  /** Nur bei `vertraglich`; die gesetzlichen 900/500 bp rechnet der Dienst. */
  zins_aufschlag_bp     integer,
  zins_methode          zins_methode,

  textbaustein          text,
  folgeaktion           mahn_folgeaktion not null default 'keine',

  /** Solange `true`, erzeugt der Lauf NICHTS — und die Seite sagt warum. */
  ist_platzhalter       boolean not null default true,

  gueltig_ab            date not null,
  gueltig_bis           date,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint mahnstufe_mandant_uk unique (mandant_id, id),
  constraint mahnstufe_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint mahnstufe_zeitraum check (gueltig_bis is null or gueltig_bis >= gueltig_ab),
  constraint mahnstufe_vertraglich_braucht_satz check (
    zinsberechnung <> 'vertraglich' or zins_aufschlag_bp is not null),
  constraint mahnstufe_zins_braucht_methode check (
    zinsberechnung = 'keine' or zins_methode is not null),

  /**
   * **Eine Stufe gilt an einem Tag genau einmal.**
   *
   * Der Lauf sucht die Stufe zur naechsten Nummer und nimmt die erste, die er
   * findet. Gaebe es zwei gueltige Zeilen fuer dieselbe Stufe — die alte mit
   * Gebuehr 0, die neue mit 5,00 EUR —, haenge der geforderte Betrag an der
   * Sortierung, und beide Antworten saehen richtig aus. Ein Fund, der in der
   * Buchhaltung entstuende und nie im Test.
   *
   * Abgeloest wird deshalb ueber `gueltig_bis`, und diese Schranke erzwingt
   * es: dieselbe Konstruktion wie `bzs_kein_ueberlapp` beim Basiszinssatz,
   * mit `[]` — der Ablauftag gehoert noch zur alten Fassung, der Tag danach
   * ist der erste der neuen.
   */
  constraint mahnstufe_kein_ueberlapp exclude using gist (
    mandant_id with =, stufe with =,
    daterange(gueltig_ab, coalesce(gueltig_bis, 'infinity'::date), '[]') with &&)
);

create unique index mahnstufe_stufe_uk on mahnstufe (mandant_id, stufe, gueltig_ab);
create index mahnstufe_frist_idx on mahnstufe (mandant_id, tage_nach_faelligkeit)
  where gueltig_bis is null;

-- =========================================================================
-- 4. mahnung (§7.5)
-- =========================================================================

create table mahnung (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),

  kunde_id              uuid not null,
  nummernkreis_id       uuid,
  mahnstufe_id          uuid not null,
  /** Eingefrorene Kopie: die Stufe, wie sie galt. */
  stufe                 integer not null check (stufe > 0),

  /** Gezogen bei `freigegeben`; NULL, solange Entwurf. */
  nummer                text,

  mahndatum             date not null,
  zahlbar_bis           date not null,

  forderung_cent        bigint not null default 0 check (forderung_cent >= 0),
  gebuehr_cent          bigint not null default 0 check (gebuehr_cent >= 0),
  zinsen_cent           bigint not null default 0 check (zinsen_cent >= 0),
  gesamt_cent           bigint not null default 0,

  status                mahnung_status not null default 'entwurf',

  freigabe_id           uuid,
  freigegeben_von       uuid references benutzer(id),
  freigegeben_am        timestamptz,
  versendet_am          timestamptz,
  dokument_id           uuid,

  /**
   * **Der gepruefte Stufensprung** — die „audited override" der Abnahme.
   *
   * Die Stufenfolge ist sonst zwingend: der Lauf erzeugt nur
   * `letzte_mahnstufe + 1`, und der Ausloeser unten laesst nichts anderes zu.
   * Eine Gesellschaft kann trotzdem einen Grund haben, eine Stufe zu
   * ueberspringen (ein Kunde, der die Zahlungserinnerung nachweislich hat und
   * nicht reagiert). Dann steht der Grund HIER, und `app.protokolliere`
   * schreibt ihn ins Protokoll — ein Sprung ohne genannten Grund geht nicht.
   */
  stufensprung_grund    text,

  verworfen_grund       text,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  geaendert_am          timestamptz,
  geaendert_von_art     akteur_art,
  geaendert_von         uuid references benutzer(id),

  constraint mahnung_mandant_uk unique (mandant_id, id),
  constraint mahnung_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  constraint mahnung_summe_stimmig check (
    gesamt_cent = forderung_cent + gebuehr_cent + zinsen_cent),

  /**
   * **Nichts verlaesst das Haus ohne einen Menschen** (Invariante 7). Ab
   * `freigegeben` muessen Nummer, Freigebender und Freigabesatz dastehen.
   */
  constraint mahnung_freigabe_vollstaendig check (
    status in ('entwurf', 'verworfen')
    or (nummer is not null and freigegeben_von is not null and freigabe_id is not null)),

  /**
   * **Und die andere Haelfte — ein Entwurf traegt KEINE Nummer.**
   *
   * Die Schranke darueber verbietet nur das eine Versehen: freigegeben ohne
   * Nummer. Sie liess das umgekehrte zu, und das ist das teurere. Eine
   * Nummer auf einem Entwurf heisst, dass der Zaehler gezogen wurde, bevor
   * irgendwer zugestimmt hat: wird der Entwurf dann verworfen, fehlt die
   * Nummer in der Folge, und die Luecke ist genau das, was `0075` fuer die
   * Rechnung mit `rechnung_entwurf_ohne_nummer` ausschliesst. Dieselbe
   * Schranke, derselbe Grund, dieselbe Formulierung.
   *
   * Heute schreibt sie niemand — und genau deshalb steht sie hier: solange
   * nur der Ablauf sie einhaelt, haelt sie der naechste Ablauf vielleicht
   * nicht mehr ein, und auffallen wuerde es erst an einer Luecke im Register.
   */
  constraint mahnung_entwurf_ohne_nummer check (
    status <> 'entwurf'
    or (nummer is null and nummernkreis_id is null
        and freigegeben_am is null and freigegeben_von is null
        and freigabe_id is null)),

  constraint mahnung_verworfen_begruendet check (
    status <> 'verworfen' or length(btrim(coalesce(verworfen_grund, ''))) >= 5),

  constraint mahnung_zahlbar_nach_mahndatum check (zahlbar_bis >= mahndatum),

  constraint mahnung_kunde_fk foreign key (mandant_id, kunde_id) references kunde (mandant_id, id),
  constraint mahnung_kreis_fk foreign key (mandant_id, nummernkreis_id)
    references nummernkreis (mandant_id, id),
  constraint mahnung_stufe_fk foreign key (mandant_id, mahnstufe_id)
    references mahnstufe (mandant_id, id),
  constraint mahnung_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id),
  constraint mahnung_dokument_fk foreign key (mandant_id, dokument_id)
    references dokument (mandant_id, id)
);

create index mahnung_kunde_idx on mahnung (mandant_id, kunde_id, mahndatum desc);
/** Der Freigabeeingang (APR-01). */
create index mahnung_offen_idx on mahnung (mandant_id, status)
  where status in ('entwurf', 'freigegeben');
create unique index mahnung_nummer_uk on mahnung (mandant_id, nummer)
  where nummer is not null;

-- =========================================================================
-- 5. mahnung_position (§7.6)
-- =========================================================================

create table mahnung_position (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  mahnung_id            uuid not null,

  rechnung_id           uuid not null,
  offener_posten_id     uuid not null,

  offener_betrag_cent   bigint not null check (offener_betrag_cent > 0),
  faellig_am            date not null,

  /** Aus `rechnung_versand` (§9.6) — heute nirgends geschrieben, also NULL. */
  zugang_am             date,
  verzugsbeginn_am      date,
  /** Die Regel, WIE SIE ANGEWANDT WURDE — eingefroren. */
  verzugsbeginn_regel   verzugsbeginn_regel not null,
  verzugstage           integer not null default 0 check (verzugstage >= 0),

  zins_bp               integer not null default 0,
  /** Die Tageszaehlung, WIE SIE ANGEWANDT WURDE — eingefroren. */
  zins_methode          zins_methode,
  zins_cent             bigint not null default 0 check (zins_cent >= 0),

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint mp_mandant_uk unique (mandant_id, id),
  constraint mp_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  /**
   * Ein Zins ohne Methode und ohne Verzugsbeginn ist ein Betrag ohne
   * Herleitung — und genau danach fragt der Anwalt des Empfaengers.
   */
  constraint mp_zins_hergeleitet check (
    zins_cent = 0 or (zins_methode is not null and verzugsbeginn_am is not null)),

  constraint mp_mahnung_fk foreign key (mandant_id, mahnung_id) references mahnung (mandant_id, id),
  constraint mp_rechnung_fk foreign key (mandant_id, rechnung_id) references rechnung (mandant_id, id),
  constraint mp_posten_fk foreign key (mandant_id, offener_posten_id)
    references offener_posten (mandant_id, id)
);

create unique index mp_rechnung_uk on mahnung_position (mahnung_id, rechnung_id);
/** Die Mahnhistorie einer Rechnung. */
create index mp_rechnung_idx on mahnung_position (mandant_id, rechnung_id);

-- =========================================================================
-- 6. mahnung_eskalation (§7.7)
-- =========================================================================

/**
 * Die Eskalation ist ein EIGENER genehmigter Akt.
 *
 * `lieferstopp`, `inkasso` und `mahnbescheid` haben Rechtsfolgen und beruehren
 * gegenueber einer natuerlichen Person Art. 22 DSGVO (LEG-12). Den BRIEF
 * freizugeben ist nicht dasselbe wie die Uebergabe an ein Inkassobuero
 * freizugeben — und `services/finanz/mahnung/lauf.ts` fuehrt keine davon
 * automatisch aus.
 * TODO(client, O-181): Wer darf eine Inkasso-Uebergabe oder einen
 * Mahnbescheid freigeben, und ab welcher Stufe bzw. welchem Betrag?
 */
create table mahnung_eskalation (
  id                    uuid primary key default gen_random_uuid(),
  mandant_id            uuid not null references mandant(id),
  mahnung_id            uuid not null,

  aktion                mahn_folgeaktion not null check (aktion <> 'keine'),
  begruendung           text not null check (length(btrim(begruendung)) >= 5),

  freigabe_id           uuid,
  freigegeben_von       uuid references benutzer(id),
  freigegeben_am        timestamptz,
  ausgefuehrt_am        timestamptz,
  widerrufen_am         timestamptz,

  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),

  constraint me_mandant_uk unique (mandant_id, id),
  constraint me_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),
  /** Ausgefuehrt wird nur, was freigegeben ist (Invariante 7). */
  constraint me_ausfuehrung_freigegeben check (
    ausgefuehrt_am is null or (freigabe_id is not null and freigegeben_von is not null)),

  constraint me_mahnung_fk foreign key (mandant_id, mahnung_id) references mahnung (mandant_id, id),
  constraint me_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id)
);

create unique index me_aktion_uk on mahnung_eskalation (mahnung_id, aktion);

-- =========================================================================
-- 7. Die Zustaende — und der Mensch davor (Invariante 7)
-- =========================================================================

/**
 * `entwurf → freigegeben → versendet → erledigt`, dazu `entwurf → verworfen`.
 * Mehr gibt es nicht.
 *
 * **Die Nummer entsteht bei der FREIGABE**, und deshalb kann eine
 * freigegebene Mahnung nicht mehr verworfen werden: sonst risse sie eine
 * Luecke in einen lueckenlosen Kreis. Ein Brief, der doch nicht hinausgehen
 * soll, wird vor der Freigabe verworfen — danach ist er ein Vorgang, den man
 * beantwortet, nicht einer, den man loescht.
 */
create function fin.mahnung_uebergang() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_kreis  record;
  v_nummer bigint;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status in ('versendet', 'erledigt', 'verworfen') then
    raise exception 'Eine Mahnung im Zustand „%" wird nicht mehr umgestellt.', old.status
      using errcode = 'restrict_violation';
  end if;

  if new.status = 'verworfen' then
    if old.status <> 'entwurf' then
      raise exception
        'Nur ein Entwurf wird verworfen — eine freigegebene Mahnung traegt eine Nummer.'
        using errcode = 'restrict_violation';
    end if;
    return new;
  end if;

  if old.status = 'entwurf' and new.status = 'freigegeben' then
    if new.freigabe_id is null then
      raise exception 'Eine Freigabe ohne Freigabesatz gibt es nicht (K-13, Invariante 7).'
        using errcode = 'check_violation';
    end if;
    /*
     * Ueber `app.freigabe_genehmigt` (0123) und nicht mit einem eigenen
     * `select`: die Antwort haengt sonst am Recht `versand.lesen` des
     * Freigebenden, und wem es fehlt, dem sagt die Datenbank „steht nicht
     * auf genehmigt" ueber eine Zeile, die genehmigt ist.
     */
    if not app.freigabe_genehmigt(new.freigabe_id, new.mandant_id) then
      raise exception 'Der genannte Freigabesatz steht nicht auf `genehmigt` (K-13).'
        using errcode = 'check_violation';
    end if;

    select nk.* into v_kreis
      from public.nummernkreis nk
     where nk.mandant_id = new.mandant_id and nk.kreis_typ = 'mahnung'
       and nk.kontext_id is null and nk.geschlossen_am is null
       for update;
    if not found then
      raise exception 'Fuer diese Gesellschaft ist kein Kreis `mahnung` offen.'
        using errcode = 'restrict_violation';
    end if;
    if v_kreis.ist_platzhalter then
      raise exception 'Nummernkreis %: unbestaetigt — er vergibt keine Nummer.',
        v_kreis.bezeichnung using errcode = 'restrict_violation';
    end if;

    v_nummer := v_kreis.naechste_nummer;
    update public.nummernkreis set naechste_nummer = naechste_nummer + 1
     where id = v_kreis.id;

    new.nummernkreis_id  := v_kreis.id;
    new.nummer           := fin.nummer_formatieren(v_kreis.format_maske, v_nummer, v_kreis.jahr);
    new.freigegeben_am   := coalesce(new.freigegeben_am, now());
    new.freigegeben_von  := coalesce(new.freigegeben_von, app.aktueller_benutzer());
    return new;
  end if;

  if old.status = 'freigegeben' and new.status = 'versendet' then
    new.versendet_am := coalesce(new.versendet_am, now());
    return new;
  end if;

  if old.status = 'versendet' and new.status = 'erledigt' then
    return new;
  end if;

  raise exception 'Der Uebergang % → % ist nicht vorgesehen.', old.status, new.status
    using errcode = 'restrict_violation';
end $$;

alter function fin.mahnung_uebergang() owner to cse_definer;

create trigger mahnung_1_uebergang
  before update on mahnung
  for each row execute function fin.mahnung_uebergang();

/**
 * **Keine Stufe wird uebersprungen, und keine zweimal gemahnt.**
 *
 * Der offene Posten traegt `letzte_mahnstufe`. Eine Position darf nur auf
 * einen Posten zeigen, dessen letzte Stufe genau eine unter der dieses
 * Briefes liegt — sonst bekaeme derselbe Beleg dieselbe Stufe zweimal (und
 * mit ihr zweimal dieselbe Gebuehr), oder er spraenge von der
 * Zahlungserinnerung zur letzten Mahnung.
 *
 * Der SPRUNG ist moeglich, aber nur benannt: steht auf der Mahnung ein
 * `stufensprung_grund`, geht er durch und wird protokolliert. Ohne Grund
 * nicht — das ist die „audited override" der Abnahme.
 */
create function fin.mahnung_stufenfolge() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
declare
  v_mahnung record;
  v_posten  record;
begin
  select m.stufe, m.status, m.stufensprung_grund, m.id
    into v_mahnung
    from public.mahnung m
   where m.id = new.mahnung_id and m.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Die Mahnung ist nicht erreichbar.' using errcode = 'foreign_key_violation';
  end if;
  if v_mahnung.status <> 'entwurf' then
    raise exception 'Positionen kommen nur an einen Mahnungsentwurf.'
      using errcode = 'restrict_violation';
  end if;

  select op.letzte_mahnstufe, op.ausgeglichen_am, op.art
    into v_posten
    from public.offener_posten op
   where op.id = new.offener_posten_id and op.mandant_id = new.mandant_id;
  if not found then
    raise exception 'Der offene Posten ist nicht erreichbar.'
      using errcode = 'foreign_key_violation';
  end if;
  if v_posten.art <> 'debitor' then
    raise exception 'Gemahnt wird eine Forderung, kein %.' , v_posten.art
      using errcode = 'check_violation';
  end if;
  if v_posten.ausgeglichen_am is not null then
    raise exception 'Dieser Posten ist ausgeglichen — er wird nicht gemahnt.'
      using errcode = 'check_violation';
  end if;

  if v_mahnung.stufe <= v_posten.letzte_mahnstufe then
    raise exception
      'Stufe % wurde fuer diesen Posten bereits gemahnt (zuletzt Stufe %).',
      v_mahnung.stufe, v_posten.letzte_mahnstufe using errcode = 'restrict_violation';
  end if;

  if v_mahnung.stufe > v_posten.letzte_mahnstufe + 1 then
    if v_mahnung.stufensprung_grund is null
       or length(btrim(v_mahnung.stufensprung_grund)) < 5 then
      raise exception
        'Von Stufe % auf % zu springen verlangt einen genannten Grund auf der Mahnung.',
        v_posten.letzte_mahnstufe, v_mahnung.stufe using errcode = 'restrict_violation';
    end if;
    perform app.protokolliere('mahnung.stufe_uebersprungen', 'mahnung',
                              v_mahnung.id::text, null,
                              jsonb_build_object('von', v_posten.letzte_mahnstufe,
                                                 'auf', v_mahnung.stufe,
                                                 'grund', v_mahnung.stufensprung_grund),
                              new.mandant_id);
  end if;

  return new;
end $$;

alter function fin.mahnung_stufenfolge() owner to cse_definer;

create trigger mahnung_stufenfolge
  before insert on mahnung_position
  for each row execute function fin.mahnung_stufenfolge();

/**
 * Erst der VERSAND schreibt die Stufe fort — nicht die Freigabe.
 *
 * Ein freigegebener, aber nicht versendeter Brief hat den Kunden nicht
 * erreicht; ihn als gemahnt zu fuehren hiesse, die naechste Stufe auf etwas
 * zu stuetzen, das niemand bekommen hat. §286 BGB knuepft an den ZUGANG.
 */
create function fin.mahnung_versand_fortschreiben() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
begin
  if new.status is not distinct from old.status or new.status <> 'versendet' then
    return null;
  end if;

  /**
   * **Der Verzug beginnt mit dem VERSAND, nicht mit dem Entwurfsdatum.**
   *
   * `mahndatum` ist der Tag, an dem der Lauf den Entwurf gebildet hat; er kann
   * Tage vor der Freigabe liegen. Ihn als Verzugsbeginn zu nehmen, verlaengerte
   * die Zinsforderung um genau diese Tage — zu unseren Gunsten und ohne
   * Grundlage.
   *
   * Der Tag, den die Plattform BEWEISEN kann, ist der des Versands. §286 BGB
   * knuepft genau genommen an den ZUGANG an, und der liegt noch spaeter; dass
   * der Verzugsbeginn damit hoechstens zu frueh und nie zu spaet steht, ist
   * die konservative Seite dieser Naeherung. Wann er genau beginnt, ist Teil
   * von O-19.
   *
   * Berliner Kalendertag, nicht UTC (Invariante 2): ein Versand am 31.12. um
   * 23:30 Berliner Zeit ist der 31.12., nicht der 1.1.
   */
  update public.offener_posten op
     set letzte_mahnstufe  = new.stufe,
         letzte_mahnung_am = (new.versendet_am at time zone 'Europe/Berlin')::date
    from public.mahnung_position mp
   where mp.mahnung_id = new.id
     and mp.mandant_id = new.mandant_id
     and op.id = mp.offener_posten_id
     and op.mandant_id = mp.mandant_id;

  return null;
end $$;

alter function fin.mahnung_versand_fortschreiben() owner to cse_definer;

create trigger mahnung_2_versand
  after update on mahnung
  for each row execute function fin.mahnung_versand_fortschreiben();

/**
 * **Eine bezahlte Forderung wird nicht gemahnt — auch nicht, wenn der Brief
 * schon im Freigabekorb liegt.**
 *
 * Genau das ist der Fall, an dem eine Buchhaltung ihr Gesicht verliert: die
 * Zahlung kommt am Montag an, die Mahnung geht am Dienstag hinaus. Wird ein
 * Posten ausgeglichen, verwirft dieser Ausloeser jeden ENTWURF, der ihn
 * enthaelt, mit genanntem Grund. Freigegebene und versendete bleiben stehen —
 * sie sind heraus oder gleich heraus, und ein stiller Widerruf waere eine
 * zweite Unwahrheit.
 *
 * Wird die Zahlung spaeter storniert, oeffnet `fin.zahlung_storniert` (0121)
 * den Posten wieder, und der naechste Lauf erzeugt einen NEUEN Entwurf. Der
 * verworfene bleibt mit seinem Grund stehen (Invariante 8).
 */
create function fin.mahnung_bei_ausgleich_verwerfen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app, fin as $$
begin
  if new.ausgeglichen_am is null or old.ausgeglichen_am is not null then
    return null;
  end if;

  update public.mahnung m
     set status = 'verworfen',
         verworfen_grund = 'Forderung ausgeglichen, bevor die Mahnung freigegeben wurde.',
         geaendert_am = now(), geaendert_von_art = 'system'
   where m.mandant_id = new.mandant_id
     and m.status = 'entwurf'
     and exists (select 1 from public.mahnung_position mp
                  where mp.mahnung_id = m.id and mp.mandant_id = m.mandant_id
                    and mp.offener_posten_id = new.id);

  return null;
end $$;

alter function fin.mahnung_bei_ausgleich_verwerfen() owner to cse_definer;

create trigger mahnung_bei_ausgleich_verwerfen
  after update on offener_posten
  for each row execute function fin.mahnung_bei_ausgleich_verwerfen();

/** Ab `versendet` unveraenderlich — der Brief ist heraus. */
create function fin.mahnung_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_aus text[];
  v_alt jsonb;
  v_neu jsonb;
begin
  if old.status not in ('versendet', 'erledigt') then
    return new;
  end if;

  /* Erzeugte Spalten fallen heraus (D-399); heute hat diese Tabelle keine. */
  select array['geaendert_am', 'geaendert_von', 'geaendert_von_art', 'status', 'dokument_id']
         || coalesce(array_agg(a.attname::text), '{}')
    into v_aus
    from pg_attribute a
   where a.attrelid = 'public.mahnung'::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated <> '';

  v_alt := to_jsonb(old) - v_aus;
  v_neu := to_jsonb(new) - v_aus;
  if v_alt = v_neu then return new; end if;

  raise exception
    'Mahnung %: versendet und damit unveraenderlich (FIN-15, LEG-01).',
    coalesce(old.nummer, old.id::text) using errcode = 'restrict_violation';
end $$;

create trigger mahnung_3_unveraenderlich
  before update on mahnung
  for each row execute function fin.mahnung_unveraenderlich();

-- =========================================================================
-- 8. faellige_forderung (§10) — was der Lauf liest
-- =========================================================================

/**
 * **Die Mahnsperre des Kunden ist eine K-05-Spalte — und bleibt es.**
 *
 * `kunde.mahnsperre_bis` gehoert seit 0020 zum wirtschaftlichen Block
 * (`debitorennummer`, `zahlungsziel_tage`, `mahnsperre_*`): `cse_app` hat
 * darauf KEIN Spaltenrecht, und 0104 nennt das ausdruecklich kein Versehen.
 * Eine `security_invoker`-Sicht, die die Spalte selbst liest, scheitert
 * deshalb mit „permission denied for table kunde" — bei jedem Aufrufer, dem
 * die Sicht sonst alles zeigt.
 *
 * Der naheliegende Ausweg waere der falsche: das Spaltenrecht zu erteilen
 * oeffnete die Sperre samt Datum jedem `crm.lesen`, und `security_invoker`
 * abzuschalten haengte die ganze Sicht an `cse_definer` — also an der
 * Mandantentrennung vorbei (§1.12). Stattdessen steht hier ein enges Tor:
 *
 * * Es gibt **einen Wahrheitswert**, nie das Datum und nie den Grund. Wer
 *   mahnen darf, muss wissen DASS gesperrt ist; bis wann und warum steht im
 *   Kundenblatt und bleibt hinter `crm_entgelt.lesen`.
 * * Es prueft das Recht selbst, weil es nicht unter der Policy laeuft — und
 *   zwar in derselben Dreiteilung wie jede Lesestelle der Plattform:
 *   Nachtlauf (`cse_job`, ohne Benutzer), Gruppenansicht (`gruppe.mahnung.lesen`)
 *   und Mandantensicht (`mahnung.lesen`).
 * * Es **wirft**, statt still `false` zu liefern. Ein stilles `false` hiesse
 *   „nicht gesperrt" — und legte genau den gesperrten Posten zum Mahnen vor.
 */
create function app.kunde_mahnsperre_aktiv(p_kunde uuid, p_mandant uuid)
returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_bis date;
begin
  if session_user = 'cse_job' then
    null;                       -- der Waechter laeuft ohne Benutzer (wie 0088)
  elsif app.ist_gruppenansicht() then
    if not (p_mandant = any (app.rechte_mandanten('gruppe.mahnung.lesen'))) then
      raise exception 'gruppe.mahnung.lesen fehlt' using errcode = '42501';
    end if;
  elsif not app.hat_recht('mahnung.lesen', p_mandant) then
    raise exception 'mahnung.lesen fehlt' using errcode = '42501';
  end if;

  select k.mahnsperre_bis into v_bis
    from public.kunde k
   where k.id = p_kunde and k.mandant_id = p_mandant;

  return v_bis is not null and v_bis >= app.berlin_heute();
end $$;

comment on function app.kunde_mahnsperre_aktiv(uuid, uuid) is
  'K-05-Tor fuer kunde.mahnsperre_bis: liefert NUR, ob die Sperre heute '
  'greift — nie das Datum, nie den Grund. Gelesen von faellige_forderung.';

alter function app.kunde_mahnsperre_aktiv(uuid, uuid) owner to cse_definer;
revoke execute on function app.kunde_mahnsperre_aktiv(uuid, uuid) from public;
grant  execute on function app.kunde_mahnsperre_aktiv(uuid, uuid) to cse_app, cse_job;

/**
 * Was das Tor dafuer braucht — und nur das.
 *
 * `cse_definer` liest `kunde` seit 0104 spaltenweise (Rechnungsanschrift);
 * hier kommt die eine Spalte dazu. Die Policy `d_kunde_pflichtfeld` deckt den
 * Mandanten- und den Jobfall ab (beide binden einen aktiven Mandanten); fuer
 * die Gruppenansicht — in der `app.aktiver_mandant()` null ist — kommt eine
 * zweite, die genau so weit reicht wie das Gruppenrecht des Lesers.
 */
grant select (mahnsperre_bis) on kunde to cse_definer;
grant execute on function app.rechte_mandanten(text) to cse_definer;

create policy d_kunde_mahnsperre_gruppe on kunde for select to cse_definer
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.mahnung.lesen')));

/**
 * Die ueberfaelligen Debitorposten mit ihrer Ueberfaelligkeit, der naechsten
 * Stufe und dem Grund, falls einer sie sperrt.
 *
 * **Die SPERREN stehen in der Sicht, nicht im Lauf.** Ein Lauf, der sie
 * selbst prueft, prueft sie auch nur dort — und die Oberflaeche, die dieselbe
 * Liste zeigt, zeigte dann Posten als mahnbar an, die es nicht sind. Beide
 * lesen dieselbe Spalte `gesperrt_grund`, und damit sagen beide dasselbe.
 *
 * `security_invoker` (§1.12).
 */
create view faellige_forderung with (security_invoker = true) as
select
  op.id                              as offener_posten_id,
  op.mandant_id,
  op.rechnung_id,
  r.nummer                           as rechnungsnummer,
  op.kunde_id,
  k.name                             as kunde_name,
  op.offen_cent,
  op.faellig_am,
  (app.berlin_heute() - op.faellig_am)::integer as ueberfaellig_tage,
  op.letzte_mahnstufe,
  op.letzte_mahnung_am,
  op.letzte_mahnstufe + 1            as naechste_stufe,
  case
    when op.mahnsperre_bis is not null and op.mahnsperre_bis >= app.berlin_heute()
      then 'Mahnsperre auf dem Posten bis ' || op.mahnsperre_bis::text
    when app.kunde_mahnsperre_aktiv(op.kunde_id, op.mandant_id)
      then 'Mahnsperre beim Kunden'
    when exists (select 1 from mahnung m
                  join mahnung_position mp
                    on mp.mahnung_id = m.id and mp.mandant_id = m.mandant_id
                 where mp.offener_posten_id = op.id
                   and m.status in ('entwurf', 'freigegeben'))
      then 'Es liegt bereits ein Mahnungsentwurf vor'
    else null
  end                                as gesperrt_grund
from offener_posten op
join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
join kunde k on k.id = op.kunde_id and k.mandant_id = op.mandant_id
where op.art = 'debitor'
  and op.ausgeglichen_am is null
  and op.offen_cent > 0
  and op.faellig_am < app.berlin_heute();

comment on view faellige_forderung is
  'FIN-15, SPEC §14 („Invoice overdue > 14 days"). Ueberfaellige Forderungen '
  'mit naechster Stufe und Sperrgrund — Lauf und Oberflaeche lesen dieselbe '
  'Zeile, damit beide dasselbe sagen.';

grant select on faellige_forderung to cse_app, cse_job;

-- =========================================================================
-- 9. RLS und Rechte (K-03, K-04, K-05, D-388)
-- =========================================================================

alter table mahnstufe          enable row level security;
alter table mahnstufe          force  row level security;
alter table mahnung            enable row level security;
alter table mahnung            force  row level security;
alter table mahnung_position   enable row level security;
alter table mahnung_position   force  row level security;
alter table mahnung_eskalation enable row level security;
alter table mahnung_eskalation force  row level security;

/**
 * **Rein intern, und hier besonders bewusst.** §7.5 sagt es ausdruecklich:
 * Kunden sehen keine Mahnungsentwuerfe — und im Portal ueberhaupt keine
 * Mahnungen. Der Brief erreicht sie auf dem Weg, den ein Brief nimmt; ein
 * Mahnstand im Kundenportal waere eine zweite, stillere Mahnung.
 */
do $$
declare t text;
begin
  foreach t in array array['mahnstufe', 'mahnung', 'mahnung_position',
                           'mahnung_eskalation'] loop
    execute format($p$
      create policy t_mandant on %I for all to cse_app
        using      (mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('mahnung.lesen', app.aktiver_mandant())))
        with check (mandant_id = app.aktiver_mandant()
                    and not app.ist_readonly()
                    and (select app.hat_recht('mahnung.schreiben', app.aktiver_mandant()))
                    and exists (select 1 from mandant m
                                 where m.id = mandant_id and m.archiviert_am is null))$p$, t);

    execute format($p$
      create policy t_gruppe on %I for select to cse_app
        using (app.ist_gruppenansicht()
               and mandant_id = any (app.rechte_mandanten('gruppe.mahnung.lesen')))$p$, t);

    execute format($p$
      create policy p_intern_ceiling on %I as restrictive for all to cse_app
        using (app.portal() = 'intern') with check (app.portal() = 'intern')$p$, t);
  end loop;
end $$;

grant select, insert, update on mahnstufe, mahnung, mahnung_eskalation to cse_app;
/** Append-only: eine Position wird mit ihrem Entwurf verworfen, nie geaendert. */
grant select, insert on mahnung_position to cse_app;

/**
 * **Und was die Ausloeser brauchen — Recht UND Policy (D-388).**
 *
 * `fin.mahnung_uebergang` liest `freigabe` und zieht die Nummer;
 * `fin.mahnung_stufenfolge` liest `mahnung` und `offener_posten`;
 * `fin.mahnung_versand_fortschreiben` schreibt zwei Spalten auf
 * `offener_posten`; `fin.mahnung_bei_ausgleich_verwerfen` schreibt auf
 * `mahnung` und liest `mahnung_position`.
 *
 * Auf `offener_posten` haelt `cse_definer` Recht und Policies seit 0121; auf
 * `nummernkreis` seit 0070 — es fehlen die Policies fuer den Kreistyp
 * `mahnung`, und die sind wieder eng: ein Definer, der jeden Kreis ziehen
 * darf, zieht beim naechsten Programmfehler den falschen.
 */
grant select on mahnung_position to cse_definer;
grant select, update on mahnung to cse_definer;

create policy d_mahnung_lesen on mahnung for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_mahnung_verwerfen on mahnung for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());
create policy d_mp_lesen on mahnung_position for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

create policy d_mahnkreis_lesen on nummernkreis for select to cse_definer
  using (mandant_id = app.aktiver_mandant() and kreis_typ = 'mahnung');
create policy d_mahnkreis_ziehen on nummernkreis for update to cse_definer
  using      (mandant_id = app.aktiver_mandant() and kreis_typ = 'mahnung'
              and geschlossen_am is null and not ist_platzhalter)
  with check (mandant_id = app.aktiver_mandant() and kreis_typ = 'mahnung');

/**
 * Der Waechter aus SPEC §14 liest die faelligen Forderungen — lesend, ueber
 * die Sicht, mit den Spaltenrechten aus 0121 und den drei hier.
 */
grant select (id, mandant_id, name) on kunde to cse_job;
create policy t_kunde_job_lesen on kunde for select to cse_job
  using (mandant_id = app.aktiver_mandant());
grant select (mandant_id, kunde_id, faellig_am, offen_cent, letzte_mahnstufe,
              letzte_mahnung_am, mahnsperre_bis, art)
  on offener_posten to cse_job;
grant select (mandant_id, mahnung_id, offener_posten_id) on mahnung_position to cse_job;
grant select (id, mandant_id, status) on mahnung to cse_job;
create policy t_mahnung_job_lesen on mahnung for select to cse_job
  using (mandant_id = app.aktiver_mandant());
create policy t_mp_job_lesen on mahnung_position for select to cse_job
  using (mandant_id = app.aktiver_mandant());

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0125)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- mahnstufe (archiv): FIN-15, §288 BGB. Die Stufe traegt Gebuehr, Zinsart und Frist — also die Grundlage jedes Betrags, der je auf einer Mahnung stand. Sie zu loeschen nimmt einem versendeten Brief seine Herleitung. Abgeloest wird ueber `gueltig_bis`.
create trigger trg_mahnstufe_kein_hard_delete
  before delete on mahnstufe
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnstufe_kein_truncate
  before truncate on mahnstufe
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnstufe from cse_app, cse_anon, cse_checkin, cse_job;

-- mahnung (archiv): FIN-15, ACC-07, §286 BGB, LEG-01. Sie IST die Mahnung — der Vorgang, an den der Verzug und damit der Zinsanspruch anknuepft. Ein geloeschter Brief laesst die naechste Stufe ohne Grundlage und den Zinsanspruch ohne Beleg. Nicht Versendetes wird ueber `verworfen` mit Grund beendet.
create trigger trg_mahnung_kein_hard_delete
  before delete on mahnung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnung_kein_truncate
  before truncate on mahnung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnung from cse_app, cse_anon, cse_checkin, cse_job;

-- mahnung_position (append): FIN-15, §288 BGB. Die Zeile traegt, WIE der Zins hergeleitet wurde: Verzugsbeginn, angewandte Regel, Tageszaehlung, Tage und Satz. Sie zu loeschen laesst einen geforderten Betrag ohne Rechenweg zurueck — und genau danach fragt der Anwalt des Empfaengers.
create trigger trg_mahnung_position_kein_hard_delete
  before delete on mahnung_position
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnung_position_kein_truncate
  before truncate on mahnung_position
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnung_position from cse_app, cse_anon, cse_checkin, cse_job;

-- mahnung_eskalation (archiv): FIN-15, APR-07, LEG-12. Eine Inkasso-Uebergabe oder ein Mahnbescheid beruehrt gegenueber einer natuerlichen Person Art. 22 DSGVO; die Zeile ist der Nachweis, WER sie freigegeben hat. Zurueckgenommen wird ueber `widerrufen_am`.
create trigger trg_mahnung_eskalation_kein_hard_delete
  before delete on mahnung_eskalation
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mahnung_eskalation_kein_truncate
  before truncate on mahnung_eskalation
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mahnung_eskalation from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
