-- ===========================================================================
-- 0073 — abwesenheitsart und abwesenheit: „nicht verfuegbar" ohne „warum"
--        (01-KERN.md §6.22 und §6.23; EMP-05, EMP-10, TIM-05, LEG-09,
--        Art. 9 DSGVO, CLN-03, D-09)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.22/§6.23. Wo
-- dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die
-- Konvention.
--
-- **Die eine Entscheidung, um die sich alles hier dreht: der Dienstplan zeigt
-- „abwesend", nie „krank".** Eine Krankmeldung ist ein Gesundheitsdatum nach
-- Art. 9 DSGVO. Der Planer braucht fuer TIM-05 genau eine Auskunft — ist diese
-- Person an diesem Tag verfuegbar —, und die traegt kein einziges Bit ueber
-- die Ursache. Der naheliegende Entwurf legt die Art daneben und blendet sie
-- in der Oberflaeche aus; damit steht sie in jeder API-Antwort, in jedem
-- Zwischenspeicher und in jedem Fehlerbericht. Deshalb liegt die Trennung
-- HIER, im Spaltenrecht: `cse_app` bekommt `abwesenheitsart_id`,
-- `au_bescheinigung_vorliegt`, `au_bis`, `dokument_id`, `bemerkung` und
-- `ablehnungsgrund` gar nicht erst zu lesen. Wer sie braucht — die
-- Personalstelle —, holt sie ueber `app.abwesenheit_grund_lesen`, und jeder
-- solche Zugriff steht im Auditlog.
--
-- **`bezahlt` hat KEINEN Default** (§6.22). Der Entwurf trug `not null default
-- true` mit einem TODO daneben — ein Default beantwortet die Frage aber
-- trotzdem, nur eben falsch und still: jede vor der Rueckmeldung angelegte Art
-- gaelte als bezahlt, und die Sollzeitgutschrift liefe. NULL heisst
-- ungeklaert, und der Dienst verweigert die Verwendung einer ungeklaerten Art
-- mit einer Meldung, die den Grund nennt.
--
-- **Die Ueberlappungssperre ist eng gefasst** (§6.23, B11): verboten ist nur
-- die echte Dublette — dieselbe Art, ganze Tage. Krankheit WAEHREND genehmigten
-- Urlaubs muss aufzeichenbar bleiben (§ 9 BUrlG), und halbe Tage
-- (`von_halbtags`) sind der zweite Fall, den eine breite Exclusion unmoeglich
-- machte.
--
-- NICHT in dieser Migration: `antrag`/`antragsart` (0074) und die
-- Stundenkonto-Buchung. Die zweite gehoert bewusst in den DIENST und nicht in
-- einen Ausloeser: ist der Zielmonat gesperrt, muss sie in den ersten offenen
-- Monat mit Rueckverweis laufen (EMP-04, §12.2), und diese Entscheidung
-- braucht mehr als einen Satz SQL.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstyp (01-KERN §4)
-- ---------------------------------------------------------------------------

/**
 * `erfasst` neben `genehmigt`: eine Krankmeldung wird nicht genehmigt, sie
 * wird zur Kenntnis genommen. Ohne diesen Wert muesste die Planung eine
 * Tatsache „genehmigen", die sie nicht zu genehmigen hat.
 */
create type abwesenheit_status as enum
  ('beantragt','genehmigt','abgelehnt','storniert','erfasst');

-- ---------------------------------------------------------------------------
-- 2. abwesenheitsart (01-KERN §6.22)
-- ---------------------------------------------------------------------------

create table abwesenheitsart (
  id                       uuid not null default gen_random_uuid(),
  -- NULL = gruppenweit gueltige Art (K-17: zweistufiger Katalog).
  mandant_id               uuid references mandant(id),
  schluessel               text not null,
  bezeichnung              text not null,
  -- Der Antragsdialog ist worker-facing (EMP-10, EMP-12): de/en/ar/tr.
  bezeichnung_i18n         jsonb not null default '{}'::jsonb,

  /**
   * NULLBAR UND OHNE DEFAULT — siehe Kopf.
   * // TODO(client, O-139): Welche Abwesenheitsarten sind bezahlt, welche nicht,
   * und unter welchem Lohnartenschluessel laufen sie in die Lohnabrechnung?
   */
  bezahlt                  boolean,

  zaehlt_auf_urlaubskonto  boolean not null default false,
  erzeugt_stundenkonto_bewegung boolean not null default false,
  /**
   * Steuert die Redaktion im Auditlog und die Spaltensperre unten. Eine Art,
   * die als gesundheitsbezogen markiert ist, faerbt jede Zeile, die auf sie
   * zeigt — deshalb ist sie selbst unveraenderlich, sobald eine Abwesenheit
   * darauf verweist (Ausloeser weiter unten).
   */
  ist_gesundheitsbezogen   boolean not null default false,
  -- z. B. AU ab Tag 3. // TODO(client, O-139): Ab welchem Tag verlangt die Gruppe einen Nachweis je Abwesenheitsart?
  nachweis_pflicht_ab_tagen integer,
  -- Exportcode fuer ACC-12. // TODO(client, O-139): Welcher Lohnartenschluessel gilt je Abwesenheitsart?
  lohnart_schluessel       text,

  /**
   * TOKEN, kein Hex. DESIGN.md kennt keine Abwesenheitspalette; bis eine dort
   * steht, sind nur die semantischen Tokens erlaubt. Ein Hexwert hier waere
   * eine Gestaltungsentscheidung an der falschen Stelle (CLAUDE.md: erst
   * DESIGN.md, dann verwenden).
   */
  farbe_token              text,

  archiviert_am            timestamptz,
  erstellt_am              timestamptz not null default now(),
  geaendert_am             timestamptz,
  erstellt_von             uuid references benutzer(id),
  geaendert_von            uuid references benutzer(id),

  primary key (id),
  constraint abwesenheitsart_key unique nulls not distinct (mandant_id, schluessel),
  constraint aa_schluessel_form check (schluessel ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint aa_nachweis_tage check (
    nachweis_pflicht_ab_tagen is null or nachweis_pflicht_ab_tagen >= 0),
  constraint aa_farbe_token check (
    farbe_token is null
    or farbe_token in ('success','warning','danger','info','neutral'))
);

create index abwesenheitsart_aktiv_idx on abwesenheitsart (mandant_id)
  where archiviert_am is null;

comment on table abwesenheitsart is
  'K-17: der bearbeitbare Katalog der Abwesenheitsgruende. Kein Enum, weil das '
  'Vokabular lohnwirksam ist und der Kunde es aendern koennen muss.';
comment on column abwesenheitsart.bezahlt is
  'NULL = ungeklaert (O-139). Der Dienst verweigert die Verwendung einer Art '
  'mit bezahlt IS NULL — ein Default waere eine erfundene Lohnregel.';

/**
 * Die sieben Platzhalter aus §6.22 — mit `bezahlt = null`, also bewusst
 * unbeantwortet. Sie stehen hier und nicht im Seed, weil ein Katalog, den die
 * Anwendung braucht, mit dem Schema kommen muss: ein leerer Katalog liesse
 * jeden Antrag an einem Fremdschluessel scheitern, und der Fehler saehe nach
 * einem Programmfehler aus.
 */
insert into abwesenheitsart
  (mandant_id, schluessel, bezeichnung, bezeichnung_i18n,
   zaehlt_auf_urlaubskonto, erzeugt_stundenkonto_bewegung,
   ist_gesundheitsbezogen, farbe_token)
values
  (null, 'urlaub', 'Urlaub',
   '{"de":"Urlaub","en":"Annual leave","ar":"إجازة","tr":"İzin"}'::jsonb,
   true,  true,  false, 'info'),
  (null, 'krankheit', 'Krankheit',
   '{"de":"Krankheit","en":"Sick leave","ar":"مرض","tr":"Hastalık"}'::jsonb,
   false, true,  true,  'warning'),
  (null, 'kind_krank', 'Kind krank',
   '{"de":"Kind krank","en":"Child sick","ar":"مرض الطفل","tr":"Çocuk hastalığı"}'::jsonb,
   false, true,  true,  'warning'),
  (null, 'unbezahlt', 'Unbezahlte Freistellung',
   '{"de":"Unbezahlte Freistellung","en":"Unpaid leave","ar":"إجازة بدون أجر","tr":"Ücretsiz izin"}'::jsonb,
   false, false, false, 'neutral'),
  (null, 'fortbildung', 'Fortbildung',
   '{"de":"Fortbildung","en":"Training","ar":"تدريب","tr":"Eğitim"}'::jsonb,
   false, true,  false, 'info'),
  (null, 'freizeitausgleich', 'Freizeitausgleich',
   '{"de":"Freizeitausgleich","en":"Time off in lieu","ar":"تعويض وقت","tr":"Serbest zaman"}'::jsonb,
   false, false, false, 'success'),
  (null, 'sonstige', 'Sonstige',
   '{"de":"Sonstige","en":"Other","ar":"أخرى","tr":"Diğer"}'::jsonb,
   false, false, false, 'neutral');

-- ---------------------------------------------------------------------------
-- 3. abwesenheit (01-KERN §6.23)
-- ---------------------------------------------------------------------------

create table abwesenheit (
  id                  uuid not null default gen_random_uuid(),
  mandant_id          uuid not null references mandant(id),
  -- D-09: die Abwesenheit haengt an EINER Beschaeftigung. Wer in zwei
  -- Gesellschaften arbeitet, meldet sich zweimal ab — es entscheiden zwei
  -- Vorgesetzte, und die Lohnwirkung faellt in zwei Abrechnungen.
  anstellung_id       uuid not null,
  abwesenheitsart_id  uuid not null references abwesenheitsart(id),

  -- Kalendertage, keine Zeitpunkte (Invariante 2): „Urlaub am 3. Oktober" ist
  -- eine Aussage ueber den Kalender und nicht ueber eine Sekunde.
  von                 date not null,
  bis                 date not null,
  von_halbtags        boolean not null default false,
  bis_halbtags        boolean not null default false,

  /**
   * Vom Dienst gerechnet: Arbeitstage abzueglich Berliner Feiertagen (CLN-03).
   * Nie im Frontend, nie durch ein Modell (Invariante 6, K-10).
   */
  tage_angerechnet    numeric(12,3),

  status              abwesenheit_status not null default 'beantragt',
  -- Der Antrag, aus dem sie entstanden ist. Die einzige Richtung (§6.29):
  -- das Kind zeigt auf seine Ursache.
  antrag_id           uuid,

  -- Nur die TATSACHE einer Arbeitsunfaehigkeit, nie eine Diagnose (Art. 9).
  au_bescheinigung_vorliegt boolean not null default false,
  au_bis              date,
  dokument_id         uuid,

  -- Serverzeit: der Zeitpunkt der Krankmeldung ist die Frist, an der sich
  -- „unverzueglich" bemisst (§ 5 EntgFG). Ein Ausloeser ueberschreibt jeden
  -- mitgelieferten Wert (Invariante 5).
  gemeldet_am         timestamptz not null default now(),

  genehmigt_von       uuid references benutzer(id),
  genehmigt_am        timestamptz,
  ablehnungsgrund     text,
  storniert_am        timestamptz,
  storniert_von       uuid references benutzer(id),
  bemerkung           text,

  erstellt_am         timestamptz not null default now(),
  geaendert_am        timestamptz,
  erstellt_von        uuid references benutzer(id),
  geaendert_von       uuid references benutzer(id),

  primary key (id),
  constraint abwesenheit_mandant_uk unique (mandant_id, id),
  constraint ab_anstellung_fk foreign key (mandant_id, anstellung_id)
    references anstellung (mandant_id, id),

  constraint ab_zeitraum check (bis >= von),
  constraint ab_au_bis check (au_bis is null or au_bis >= von),
  constraint ab_tage_nicht_negativ check (
    tage_angerechnet is null or tage_angerechnet >= 0),
  /**
   * Eine Genehmigung ohne gerechnete Tage bucht NULL auf das Urlaubskonto —
   * und `rest_tage` ist dort eine erzeugte Spalte, die damit fuer das ganze
   * Jahr NULL wuerde. Ein Fehler, der sich als leere Anzeige zeigt und dessen
   * Ursache ein Jahr zurueckliegt.
   */
  constraint ab_genehmigt_hat_tage check (
    status <> 'genehmigt' or tage_angerechnet is not null),
  constraint ab_ablehnung_begruendet check (
    status <> 'abgelehnt'
    or (ablehnungsgrund is not null and btrim(ablehnungsgrund) <> '')),
  constraint ab_genehmigung_paarweise check (
    (genehmigt_am is null) = (genehmigt_von is null)),
  constraint ab_storno_paarweise check (
    (storniert_am is null) = (storniert_von is null)),

  /**
   * Die ENGE Ueberlappungssperre (B11).
   *
   * Verboten ist nur die echte Dublette: dieselbe Person, dieselbe Art, ganze
   * Tage. Was eine breite Sperre kaputt machte:
   *  - Krankheit im genehmigten Urlaub — § 9 BUrlG verlangt, dass die Tage
   *    nachgewiesener Arbeitsunfaehigkeit NICHT auf den Urlaub angerechnet
   *    werden, also muessen beide Zeilen nebeneinander stehen koennen.
   *  - Halbe Tage — vormittags Urlaub, nachmittags Fortbildung ist genau der
   *    Fall, fuer den `von_halbtags` existiert.
   */
  constraint ab_keine_dublette exclude using gist (
    anstellung_id with =, abwesenheitsart_id with =,
    daterange(von, bis, '[]') with &&
  ) where (status in ('beantragt','genehmigt','erfasst')
           and not von_halbtags and not bis_halbtags)
);

-- Personalakte und Portalansicht. Ohne `mandant_id`-Praefix: die kombinierte
-- Sicht des Menschen laeuft ueber alle Beschaeftigungen (EMP-15).
create index abwesenheit_anstellung_idx on abwesenheit (anstellung_id, von desc);
-- Die Dienstplanfrage „ist diese Person am Einsatztag abwesend" (TIM-05).
create index abwesenheit_zeitraum_idx on abwesenheit
  using gist (mandant_id, daterange(von, bis, '[]'));
create index abwesenheit_offen_idx on abwesenheit (mandant_id, status)
  where status = 'beantragt';
create index abwesenheit_antrag_idx on abwesenheit (antrag_id)
  where antrag_id is not null;

comment on table abwesenheit is
  'EMP-10: die konkrete Abwesenheit einer Beschaeftigung. Der Dienstplan liest '
  'daraus „nicht verfuegbar" — der Grund haengt an einem eigenen Recht '
  '(Art. 9 DSGVO, LEG-09).';
comment on column abwesenheit.au_bescheinigung_vorliegt is
  'Nur die Tatsache einer AU, nie eine Diagnose. Es gibt hier bewusst keine '
  'Diagnosespalte (Art. 9 DSGVO).';

-- ---------------------------------------------------------------------------
-- 4. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `abwesenheit_status_maschine` — vorwaerts, und die Zeitpunkte gehoeren dem
 * Server.
 *
 * `beantragt → genehmigt | abgelehnt`, `genehmigt → storniert`, und aus
 * `abgelehnt` oder `storniert` fuehrt kein Weg zurueck. `erfasst` ist der
 * Endzustand der Krankmeldung: sie wird nicht genehmigt, sie wird zur Kenntnis
 * genommen — und laesst sich stornieren, wenn sie falsch war.
 *
 * Warum die Zeitpunkte hier und nicht per DEFAULT: ein Default greift nur,
 * wenn die Spalte weggelassen wird. Ein INSERT, der `gemeldet_am` mitschickt,
 * setzte sonst einen beliebigen Zeitpunkt — und genau dieser Zeitpunkt ist die
 * Frist, an der „unverzueglich gemeldet" gemessen wird.
 */
create function kern.abwesenheit_status() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.gemeldet_am := now();
    if new.status not in ('beantragt','erfasst','genehmigt') then
      raise exception 'Eine Abwesenheit entsteht als beantragt, erfasst oder genehmigt'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'beantragt' and new.status in ('genehmigt','abgelehnt','storniert'))
      or (old.status = 'genehmigt' and new.status = 'storniert')
      or (old.status = 'erfasst'   and new.status = 'storniert')
    ) then
      raise exception 'Uebergang % → % ist nicht vorgesehen', old.status, new.status
        using errcode = 'check_violation',
              hint = 'Aus abgelehnt und storniert fuehrt kein Weg zurueck.';
    end if;
  end if;

  -- Die Meldung bleibt, was sie war: sie ist die Frist.
  new.gemeldet_am := old.gemeldet_am;
  if new.status = 'genehmigt' and old.status <> 'genehmigt' then
    new.genehmigt_am := now();
  end if;
  if new.status = 'storniert' and old.status <> 'storniert' then
    new.storniert_am := now();
  end if;
  return new;
end $$;

create trigger trg_abwesenheit_status
  before insert or update on abwesenheit
  for each row execute function kern.abwesenheit_status();

/**
 * `abwesenheit_urlaubskonto` — die Genehmigung bucht, die Stornierung bucht
 * zurueck (EMP-05).
 *
 * `security definer`, weil `urlaubskonto` unter erzwungener RLS steht und der
 * Genehmigende dort kein Schreibrecht hat: er entscheidet ueber eine
 * Abwesenheit, nicht ueber ein Konto. Ohne Definer scheiterte jede Genehmigung
 * mit „permission denied for table urlaubskonto" — und zwar an einer Stelle,
 * an der niemand ein Konto vermutet.
 *
 * Fehlt das Konto des Jahres, wird NICHT stillschweigend eines angelegt: der
 * Anspruch ist offen (O-18), und ein Konto mit `anspruch_tage = 0`, das
 * unbemerkt entsteht, sieht spaeter aus wie „kein Urlaub zugesagt". Der Dienst
 * eroeffnet es sichtbar, bevor er genehmigt.
 */
create function kern.abwesenheit_urlaubskonto() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_zaehlt boolean; v_jahr integer; v_treffer integer;
        v_alt public.abwesenheit_status;
begin
  select a.zaehlt_auf_urlaubskonto into v_zaehlt
    from public.abwesenheitsart a where a.id = new.abwesenheitsart_id;
  if not coalesce(v_zaehlt, false) then return new; end if;

  /**
   * `old` gibt es beim INSERT nicht — und der Fall ist nicht theoretisch: der
   * Antragsdienst legt die Abwesenheit fertig genehmigt an, weil er die Tage
   * vorher gerechnet hat. Nur auf UPDATE zu hoeren hiesse, dass genau dieser
   * Weg das Urlaubskonto NICHT bucht: der Urlaub steht im Plan, und das Konto
   * sagt, es sei keiner genommen worden.
   */
  v_alt := case when tg_op = 'INSERT' then null else old.status end;

  -- Das Jahr des BEGINNS. Ein Urlaub ueber den Jahreswechsel gehoert dem Jahr,
  -- in dem er beginnt — welche Regel die Gruppe fuer den Uebertrag anwendet,
  -- ist offen (O-18) und wird hier nicht erfunden.
  v_jahr := extract(year from new.von)::integer;

  /**
   * Die Tuer, die `0061` ausdruecklich fuer diese Migration offengelassen hat.
   *
   * `kern.urlaubskonto_tage_quelle` weist jede Aenderung an `genommen_tage`
   * ab — „nicht von Hand gebucht, der Schreibweg entsteht mit PR 38". Hier ist
   * er. Die Freigabe ist transaktionslokal und wird unmittelbar wieder
   * zurueckgenommen: ein dauerhafter Schalter waere genau das Schlupfloch, das
   * die Wache verhindern soll.
   */
  perform set_config('cse.urlaubsbuchung', 'an', true);

  if new.status = 'genehmigt' and v_alt is distinct from 'genehmigt' then
    update public.urlaubskonto
       set genommen_tage = genommen_tage + coalesce(new.tage_angerechnet, 0),
           geaendert_am = now()
     where anstellung_id = new.anstellung_id and jahr = v_jahr
       and abgeschlossen_am is null;
    get diagnostics v_treffer = row_count;
    if v_treffer = 0 then
      raise exception 'Kein offenes Urlaubskonto % fuer diese Beschaeftigung', v_jahr
        using errcode = 'no_data_found',
              hint = 'Das Konto wird eroeffnet, bevor Urlaub genehmigt wird (O-18).';
    end if;
  elsif new.status = 'storniert' and v_alt = 'genehmigt' then
    update public.urlaubskonto
       set genommen_tage = greatest(genommen_tage - coalesce(old.tage_angerechnet, 0), 0),
           geaendert_am = now()
     where anstellung_id = new.anstellung_id and jahr = v_jahr
       and abgeschlossen_am is null;
    -- Ein abgeschlossenes Jahr wird NICHT rueckwirkend veraendert; die
    -- Gutschrift gehoert dann ins laufende Jahr und ist eine Entscheidung des
    -- Dienstes, keine stille Korrektur hier.
  end if;

  perform set_config('cse.urlaubsbuchung', 'aus', true);
  return new;
end $$;

create trigger trg_abwesenheit_urlaubskonto
  after insert or update on abwesenheit
  for each row execute function kern.abwesenheit_urlaubskonto();

/**
 * Und die Wache aus `0061` bekommt ihre Ausnahme — genau eine.
 *
 * Der Rumpf ist der von `0061`; neu ist die erste Bedingung. Ohne sie kann der
 * Ausloeser darueber sein eigenes Ziel nicht schreiben, und eine Genehmigung
 * scheiterte mit „Genommene und verplante Tage folgen aus Abwesenheiten" —
 * einer Meldung, die genau das behauptet, was gerade passiert.
 *
 * Die Ausnahme haengt an einem TRANSAKTIONSLOKALEN Schalter, den nur
 * `kern.abwesenheit_urlaubskonto` setzt. Ein Recht oder eine Rolle taete es
 * nicht: der Genehmigende ist derselbe Mensch, der den Wert von Hand nicht
 * setzen darf.
 */
create or replace function kern.urlaubskonto_tage_quelle() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('cse.urlaubsbuchung', true), 'aus') = 'an' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.genommen_tage <> 0 or new.verplant_tage <> 0 then
      raise exception 'Genommene und verplante Tage folgen aus Abwesenheiten'
        using errcode = 'check_violation',
              hint    = 'Ein neues Urlaubskonto beginnt bei 0 (EMP-05, PR 38).';
    end if;
    return new;
  end if;

  if new.genommen_tage is distinct from old.genommen_tage
     or new.verplant_tage is distinct from old.verplant_tage then
    raise exception 'Genommene und verplante Tage folgen aus Abwesenheiten'
      using errcode = 'check_violation',
            detail  = 'Sie werden aus genehmigten abwesenheit-Zeilen '
                      || 'fortgeschrieben (01-KERN §6.26), nicht von Hand gebucht.',
            hint    = 'Der Weg dorthin ist eine genehmigte Abwesenheit (0073).';
  end if;
  return new;
end $$;

/**
 * `abwesenheitsart_schutz` — der Schluessel einer benutzten Art ist
 * unveraenderlich, und `bezahlt` faellt nicht auf NULL zurueck.
 *
 * Der Schluessel steht in Exporten und in Lohnzuordnungen; ihn nachtraeglich
 * umzubenennen aendert rueckwirkend die Bedeutung jeder Zeile, die auf ihn
 * zeigt. Und eine einmal beantwortete Lohnfrage zurueck auf „ungeklaert" zu
 * setzen hiesse, eine Antwort zu verlieren, die jemand gegeben hat.
 */
create function kern.abwesenheitsart_schutz() returns trigger
language plpgsql as $$
begin
  if new.schluessel is distinct from old.schluessel
     and exists (select 1 from abwesenheit a where a.abwesenheitsart_id = old.id) then
    raise exception 'Der Schluessel einer benutzten Abwesenheitsart bleibt, wie er ist'
      using errcode = 'check_violation';
  end if;
  if old.bezahlt is not null and new.bezahlt is null then
    raise exception 'bezahlt faellt nicht auf ungeklaert zurueck'
      using errcode = 'check_violation';
  end if;
  if new.ist_gesundheitsbezogen is distinct from old.ist_gesundheitsbezogen
     and exists (select 1 from abwesenheit a where a.abwesenheitsart_id = old.id) then
    raise exception 'Die Art-9-Einstufung einer benutzten Art bleibt, wie sie ist'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_abwesenheitsart_schutz
  before update on abwesenheitsart
  for each row execute function kern.abwesenheitsart_schutz();

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz (K-03, K-04, K-18)
-- ---------------------------------------------------------------------------

alter table abwesenheitsart enable row level security;
alter table abwesenheitsart force  row level security;

create policy t_katalog on abwesenheitsart for select to cse_app
  using (mandant_id is null or mandant_id = any (app.sichtbare_mandanten()));
create policy t_katalog_pflege on abwesenheitsart for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('stammdaten.verwalten', app.aktiver_mandant())));
create policy t_job on abwesenheitsart for select to cse_job using (true);
/**
 * Der Katalog muss auch fuer den DEFINER lesbar sein: `app.abwesenheit_grund_lesen`
 * joint auf ihn, und unter erzwungener RLS gilt „keine Policy" auch fuer den
 * Eigentuemer der Funktion. Ohne diese Zeile gibt die Funktion eine leere
 * Antwort — sie wirft nicht, sie schweigt, und die Personalstelle sieht ein
 * leeres Feld statt einer Diagnosefrage.
 */
create policy aa_definer on abwesenheitsart for select to cse_definer using (true);

alter table abwesenheit enable row level security;
alter table abwesenheit force  row level security;

/**
 * Lesen mit `zeit.abwesenheit_lesen`, schreiben mit `zeit.abwesenheit_melden`,
 * entscheiden mit `zeit.abwesenheit_genehmigen` — drei Rechte, weil es drei
 * Entscheidungen sind. Wer eine Krankmeldung aufnehmen darf, darf darum noch
 * keinen Urlaub genehmigen.
 */
create policy t_mandant on abwesenheit for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('zeit.abwesenheit_lesen', app.aktiver_mandant())));

create policy t_mandant_schreiben on abwesenheit for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.abwesenheit_melden', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_mandant_entscheiden on abwesenheit for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.abwesenheit_genehmigen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.abwesenheit_genehmigen', app.aktiver_mandant())));

create policy t_gruppe on abwesenheit for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/** Der Mensch sieht seine eigenen Abwesenheiten — in beiden Scopes. */
create policy t_selbst_lesen on abwesenheit for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and exists (select 1 from anstellung a
                      where a.mandant_id = abwesenheit.mandant_id
                        and a.id = abwesenheit.anstellung_id
                        and a.person_id = app.aktuelle_person()));

create policy t_person on abwesenheit for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and exists (select 1 from anstellung a
                      where a.mandant_id = abwesenheit.mandant_id
                        and a.id = abwesenheit.anstellung_id
                        and a.person_id = app.aktuelle_person()));

/** K-04: das Mitarbeiterportal sieht nur die eigenen Zeilen, das Kundenportal keine. */
create policy p_ma_decke on abwesenheit as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or anstellung_id in (select a.id from anstellung a
                               where a.person_id = app.aktuelle_person()));
create policy p_kunde_decke on abwesenheit as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

create policy t_job on abwesenheit for select to cse_job using (true);
create policy ab_definer on abwesenheit for select to cse_definer using (true);

-- ---------------------------------------------------------------------------
-- 6. Spaltenrechte (K-05-Muster, Art. 9 DSGVO)
-- ---------------------------------------------------------------------------

/**
 * Der Grund wird ENTZOGEN, indem er nicht gewaehrt wird.
 *
 * Ein `grant select` auf die Tabelle mit anschliessendem `revoke select
 * (spalte)` wirkt in Postgres NICHT — das Tabellenrecht deckt weiter jede
 * Spalte. Die Spalte muss von vornherein fehlen, und eine Schemaprobe stellt
 * sicher, dass sie fehlt.
 *
 * `grant insert` ist davon unabhaengig: einfuegen muss die Anwendung alle
 * Spalten koennen (der Antrag traegt die Art), lesen darf sie sie nicht.
 */
grant select (
  id, mandant_id, anstellung_id, von, bis, von_halbtags, bis_halbtags,
  tage_angerechnet, status, antrag_id, gemeldet_am,
  genehmigt_von, genehmigt_am, storniert_am, storniert_von,
  erstellt_am, geaendert_am, erstellt_von, geaendert_von
) on abwesenheit to cse_app;
grant insert, update on abwesenheit to cse_app;
grant select on abwesenheitsart to cse_app;
grant insert, update on abwesenheitsart to cse_app;
grant select on abwesenheit to cse_job;
grant select on abwesenheitsart to cse_job;
grant select, insert, update on abwesenheit to cse_definer;
grant select on abwesenheitsart to cse_definer;

/**
 * `app.abwesenheit_grund_lesen` — der eine Weg zum Grund.
 *
 * Er prueft das eigene Recht (`zeit.abwesenheit_grund_lesen`) im aktiven
 * Mandanten, gibt genau die gesperrten Felder zurueck und schreibt eine
 * Auditzeile. Damit ist jeder Zugriff auf ein Gesundheitsdatum belegt — und
 * das ist keine Formalie: Art. 9 DSGVO verlangt, dass der Kreis der
 * Zugreifenden eng und nachweisbar ist.
 */
create function app.abwesenheit_grund_lesen(p_abwesenheit uuid)
returns table (
  abwesenheitsart_id uuid,
  abwesenheitsart text,
  ist_gesundheitsbezogen boolean,
  au_bescheinigung_vorliegt boolean,
  au_bis date,
  dokument_id uuid,
  bemerkung text,
  ablehnungsgrund text
)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid;
begin
  select a.mandant_id into v_mandant from public.abwesenheit a where a.id = p_abwesenheit;
  -- Keine Zeile ist keine Zeile — und niemals ein „verboten", das die Existenz
  -- bestaetigt (AUT-06).
  if v_mandant is null then return; end if;

  if v_mandant is distinct from app.aktiver_mandant()
     or not app.hat_recht('zeit.abwesenheit_grund_lesen', v_mandant) then
    raise exception 'nicht berechtigt' using errcode = '42501';
  end if;

  perform app.protokolliere(
    'personal.abwesenheitsgrund_gelesen', 'abwesenheit', p_abwesenheit::text,
    null, jsonb_build_object('rechtsgrundlage', 'Art. 9 Abs. 2 lit. b DSGVO'));

  return query
    select a.abwesenheitsart_id, art.bezeichnung, art.ist_gesundheitsbezogen,
           a.au_bescheinigung_vorliegt, a.au_bis, a.dokument_id,
           a.bemerkung, a.ablehnungsgrund
      from public.abwesenheit a
      join public.abwesenheitsart art on art.id = a.abwesenheitsart_id
     where a.id = p_abwesenheit;
end $$;

alter function app.abwesenheit_grund_lesen(uuid) owner to cse_definer;
revoke execute on function app.abwesenheit_grund_lesen(uuid) from public;
grant execute on function app.abwesenheit_grund_lesen(uuid) to cse_app;

comment on function app.abwesenheit_grund_lesen(uuid) is
  'LEG-09, Art. 9 DSGVO: der einzige Weg zu Art, AU-Tatsache und Bemerkung '
  'einer Abwesenheit. Prueft zeit.abwesenheit_grund_lesen und schreibt eine '
  'Auditzeile.';

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0073)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- abwesenheit (archiv): EMP-10, LEG-09, Invariante 8. Dass jemand krank gemeldet war oder Urlaub hatte, ist die Grundlage von Lohnfortzahlung und Urlaubskonto — und im Streit die Tatsache selbst. Zurueckgenommen wird ueber `status = storniert`, nie durch DELETE.
create trigger trg_abwesenheit_kein_hard_delete
  before delete on abwesenheit
  for each row execute function kern.verhindere_loeschung();
create trigger trg_abwesenheit_kein_truncate
  before truncate on abwesenheit
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on abwesenheit from cse_app, cse_anon, cse_checkin, cse_job;

-- abwesenheitsart (archiv): EMP-05, ACC-12, K-17. Der Katalog traegt die Lohnwirkung; eine geloeschte Art nimmt jeder Abwesenheit, die auf sie zeigt, ihre Bedeutung. Ausser Gebrauch kommt sie ueber `archiviert_am`.
create trigger trg_abwesenheitsart_kein_hard_delete
  before delete on abwesenheitsart
  for each row execute function kern.verhindere_loeschung();
create trigger trg_abwesenheitsart_kein_truncate
  before truncate on abwesenheitsart
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on abwesenheitsart from cse_app, cse_anon, cse_checkin, cse_job;


create trigger trg_abwesenheit_audit
  after insert or update or delete on abwesenheit
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
