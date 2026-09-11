-- ===========================================================================
-- 0088 — Positionsherkunft: `rechnungsposition_quelle`, die Doppel-
--        abrechnungssperre und ihr Spiegel auf der Quellseite
--        (FIN-07, FIN-18, TIM-12, BAU-02, BAU-04, CLN-04, CRM-05, DSH-04,
--         Invarianten 1, 3, 4, 8)
--
-- Vertrag: `docs/architecture/02-datenmodell/05-FINANZEN.md` §4.4, §2.2,
-- §2.3 Punkt 5 und 6, §5.6 Schritt 6. Wo dieser Text und eine Konvention
-- (K-nn) auseinandergehen, gilt die Konvention.
--
-- Der PR-Plan nennt `0071_position_herkunft`. `0071` ist an `lv_position`
-- vergeben, `0078`–`0087` liegen bei den parallelen Sitzungen — deshalb 0088.
--
-- Vier Entscheidungen tragen diese Datei, und keine davon ist Geschmack:
--
--  1. **Die Zeile ohne Beleg gibt es nicht, und zwar auf DATENBANKEBENE.**
--     Eine Pruefung im Dienst waere eine Zusage, die jeder zweite Schreibweg
--     — Storno, Neuausstellung, ein spaeterer Import — einzeln wiederholen
--     muesste. Der aufgeschobene Ausloeser `rp_hat_quelle` prueft beim COMMIT,
--     also NACH dem Einfuegen der Quellzeilen, und ist damit die einzige
--     Formulierung, die „jede Leistungszeile hat einen Beleg" sagen kann,
--     ohne die Reihenfolge der Einfuegungen vorzuschreiben.
--
--  2. **`zeiteintrag` wird EXKLUSIV beansprucht, `aufmass` ausdruecklich
--     nicht.** Fuer die Stunde ist der partielle Unique-Index der Anspruch;
--     fuer das Aufmassblatt waere er falsch, weil § 16 VOB/B dasselbe Blatt
--     ueber mehrere Abschlagsrechnungen und noch einmal in der Schluss-
--     rechnung abrechnet. Dort ist der Schutz eine aufgeschobene SUMME ueber
--     `menge_anteil` (review B11, §4.4). Ein Unique-Index an dieser Stelle
--     machte FIN-08 auf gemessener Leistung — also auf der einzigen Art, die
--     Bau ueberhaupt produziert — unausfuehrbar.
--
--  3. **Der Spiegel auf der Quellseite ist kein Ersatz fuer den Index.**
--     `zeiteintrag.abgerechnet_am` beantwortet „ist diese Stunde schon
--     abgerechnet?" ohne Join und treibt die Arbeitsliste; der Unique-Index
--     verhindert die zweite Abrechnung auch dann, wenn die Liste falsch
--     gelesen wurde. Beide existieren; keiner ersetzt den anderen (§4.4).
--
--  4. **`wirksam` ist die einzige Spalte, die sich nach dem Festschreiben
--     noch bewegt** — und nur von `true` nach `false`. Das ist die Stelle,
--     an der ein Storno die Quelle wieder freigibt. Ohne sie waere eine
--     stornierte Rechnung eine dauerhafte Sperre auf Stunden, die niemand
--     mehr in Rechnung gestellt hat.
--
-- NICHT in dieser Migration:
--  · `ausgabe` (§8.5, PR 54) — deshalb steht `ausgabe_id` hier OHNE
--    Fremdschluessel, und die Stelle sagt es. Die STRUKTUR steht trotzdem
--    schon: eine spaetere Spalte auf einer Tabelle, deren Zeilen per
--    Invariante 4 unveraenderlich sind, waere eine Migration mit
--    Datenwanderung.
--  · `abschlagsrechnung_bezug` (FIN-08, PR 50) — die Zwei-Raten-Pruefung
--    unten kommt deshalb ohne Abschlagsplan aus und prueft genau das, was
--    §4.4 verlangt: die Summe der Anteile gegen die gemessene Menge.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Der Diskriminator (§3.1)
-- ---------------------------------------------------------------------------

/**
 * FESTGESCHRIEBEN (§3.1): FIN-07 nennt die ersten vier woertlich —
 * Zeiteintrag, Aufmass, Vertrag, Material. `leistungsnachweis` und `nachtrag`
 * verlangt `03-GEWERKE.md` §2.2.
 *
 * `manuell` ist der Wert, der diese Liste erst vollstaendig macht: eine von
 * Hand getippte Zeile ist damit AUSDRUECKLICH beleglos, mit Pflichtbegruendung
 * — statt still ohne Herkunft zu stehen und in jeder Auswertung wie eine
 * belegte Zeile auszusehen.
 */
create type quelle_typ as enum
  ('zeiteintrag', 'aufmass', 'vertrag', 'material', 'leistungsnachweis', 'nachtrag', 'manuell');

comment on type quelle_typ is
  'FIN-07 §4.4: woher eine Rechnungszeile stammt. `manuell` ist der beleglose '
  'Fall MIT Pflichtbegruendung, nicht das Fehlen einer Angabe.';

-- ---------------------------------------------------------------------------
-- 2. `aufmass.abgerechnet_menge` (§2.3 Punkt 5)
-- ---------------------------------------------------------------------------

/**
 * Die aufgelaufene Menge, die dieses Blatt schon in Rechnung gestellt hat.
 *
 * Sie steht auf dem BLATT und nicht in der Finanzdomaene, weil die Frage
 * „wieviel ist von diesem Aufmass noch offen?" eine Frage der Bauleitung ist
 * und beim Blatt beantwortet werden muss — ohne Leserecht auf Rechnungen.
 * Geschrieben wird sie ausschliesslich vom aufgeschobenen Ausloeser unten
 * (§4.4), nie von Hand.
 *
 * `numeric(12,3)` wie jede Menge in dieser Plattform (K-16) — eine Menge ist
 * kein Geld und deshalb keine Cent-Zahl.
 */
alter table aufmass
  add column abgerechnet_menge numeric(12,3) not null default 0;

comment on column aufmass.abgerechnet_menge is
  '§4.4/§2.3 Punkt 5: die ueber alle wirksamen Rechnungszeilen aufgelaufene '
  'Menge dieses Blattes. Vom Ausloeser fin.pruefe_aufmass_menge gepflegt.';

/**
 * Der Definer-Schreibweg auf genau DIESE eine Spalte (§1.1, K-01).
 *
 * `kern.aufmass_einfrieren()` laesst sie zu — sie steht nicht auf seiner
 * Verbotsliste, und das ist richtig: sie entsteht NACH der Gegenzeichnung,
 * wie `aufbewahrung_bis` und der Storno. Was fehlte, war der Weg unter FORCE
 * RLS: `cse_definer` hielt auf `aufmass` nur `select`. Ein UPDATE ohne
 * passende Policy trifft null Zeilen — geraeuschlos —, und die aufgelaufene
 * Menge bliebe fuer immer 0, waehrend die Summenpruefung weiter „alles frei"
 * meldete.
 */
grant update (abgerechnet_menge) on aufmass to cse_definer;

create policy d_aufmass_abrechnung on aufmass for update to cse_definer
  using      (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 2b. Die Leserechte der vier neuen Definer-Funktionen (§1.1, K-01)
-- ---------------------------------------------------------------------------

/**
 * **Ein Definer ist unter FORCE RLS NICHT ausgenommen** (K-01, §1.1). Er
 * braucht deshalb ZWEIMAL eine Erlaubnis: den GRANT und eine Policy. Fehlt
 * der Grant, wirft er „permission denied"; fehlt die Policy, liest er NULL
 * ZEILEN — und das ist der schlimmere der beiden Fehler, weil er still ist.
 *
 * **Und deshalb sind nur ZWEI der fuenf Funktionen dieser Migration
 * `SECURITY DEFINER`.** Die anderen drei — `fin.quelle_elternzeile()`,
 * `fin.quelle_unveraenderlich()` und `fin.position_hat_quelle()` — laufen als
 * AUFRUFER, weil sie ausschliesslich Tabellen lesen, die nur `cse_app`
 * beschreibt: `rechnungsposition` und `rechnungsposition_quelle` werden im
 * ENTWURF bestueckt und nirgends von einem Definer. Ein aufgeschobener
 * Ausloeser feuert im Sicherheitskontext der ausloesenden Anweisung, und die
 * ist hier immer eine des Anwendungsrollen-Pfades. Sie zu Definern zu machen
 * haette eine zweite, breitere Lesepolicy auf `rechnungsposition` verlangt —
 * neben der, die `0085` fuer den §14-Ausloeser schon haelt.
 *
 * Die zwei, die es sein MUESSEN, und warum:
 *
 *   · `fin.pruefe_aufmass_menge()` — sie SCHREIBT `aufmass.abgerechnet_menge`
 *     zurueck, und eine Buchhaltung haelt kein `bau.schreiben`.
 *   · `fin.auftrag_erfasste_minuten()` — sie zaehlt Zeiteintraege, und eine
 *     Buchhaltung haelt kein `zeit.lesen` (das ist ihr ganzer Zweck).
 *
 * Beide brauchen Grant UND Policy auf das, was sie lesen. `zeiteintrag`
 * (`z_definer_lesen`, 0034), `aufmass` (`d_medien_bezug`, 0072) und
 * `rechnungsposition_quelle` (unten) haben sie schon; die drei hier fehlten.
 */
grant select on aufmass_zeile to cse_definer;
create policy d_aufmass_zeile_lesen on aufmass_zeile for select to cse_definer using (true);

grant select on auftrag, auftrag_leistung to cse_definer;
create policy d_auftrag_lesen on auftrag for select to cse_definer using (true);
create policy d_auftrag_leistung_lesen on auftrag_leistung for select to cse_definer
  using (true);

-- ---------------------------------------------------------------------------
-- 3. rechnungsposition_quelle (§4.4)
-- ---------------------------------------------------------------------------

create table rechnungsposition_quelle (
  id                   uuid primary key default gen_random_uuid(),
  mandant_id           uuid not null references mandant(id),

  rechnungsposition_id uuid not null,
  /**
   * Denormalisiert, und mit Absicht: „ist dieser Zeiteintrag abgerechnet, und
   * auf welchem Beleg?" ist die haeufigste Abfrage dieser Tabelle, und sie
   * soll ohne Join auf `rechnungsposition` auskommen (§4.4). Der Ausloeser
   * unten nagelt die Spalte an die Elternzeile — zwei Wahrheiten waeren hier
   * schlimmer als ein Join.
   */
  rechnung_id          uuid not null,

  quelle_typ           quelle_typ not null,

  zeiteintrag_id       uuid,
  aufmass_id           uuid,
  auftrag_leistung_id  uuid,
  -- Elterntisch `ausgabe` kommt mit PR 54 (§8.5); bis dahin Spalte ohne
  -- Fremdschluessel. Der partielle Unique-Index unten gilt trotzdem schon.
  ausgabe_id           uuid,
  leistungsnachweis_id uuid,
  nachtrag_id          uuid,

  /**
   * Die aus der Quelle entnommene Menge. NULL heisst „die ganze Quelle".
   *
   * `numeric(12,3)`, nicht Cent: das ist eine MENGE (K-16). Fuer
   * `quelle_typ = 'aufmass'` ist sie Pflicht — dort IST sie der Schutz gegen
   * die zweite Abrechnung, und ein NULL hiesse dort „das ganze Blatt", also
   * genau die Aussage, die § 16 VOB/B fuer eine Abschlagsrechnung verbietet.
   */
  menge_anteil         numeric(12,3),

  notiz                text,

  /**
   * `false`, sobald die Rechnung storniert oder der Entwurf verworfen ist —
   * dann ist die Quelle wieder frei. Der partielle Unique-Index haengt an
   * dieser Spalte, und das ist der ganze Mechanismus: die Sperre verschwindet
   * mit dem Anspruch, nicht mit der Zeile (Invariante 8).
   */
  wirksam              boolean not null default true,

  -- Auditblock (§1.6). Drei Akteursarten statt eines erfundenen Menschen.
  erstellt_von_art      akteur_art not null default 'mensch',
  erstellt_von          uuid references benutzer(id),
  erstellt_von_agent_id uuid,
  erstellt_von_dienst   text,
  erstellt_am           timestamptz not null default now(),
  /**
   * §4.4 nennt den Auditblock „insert only" und fuehrt zugleich `wirksam` als
   * veraenderlich. Beides zusammen geht nur mit dieser Spalte, und K-16
   * verlangt sie fuer jede bewegliche Tabelle — dieselbe Abwaegung wie bei
   * `rechnung_steuer` (D-213). Wo Kapitel und Konvention auseinandergehen,
   * gilt die Konvention.
   */
  geaendert_am          timestamptz,

  constraint rpq_mandant_uk unique (mandant_id, id),

  constraint rpq_position_fk foreign key (mandant_id, rechnungsposition_id)
    references rechnungsposition (mandant_id, id),
  constraint rpq_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id),
  constraint rpq_zeiteintrag_fk foreign key (mandant_id, zeiteintrag_id)
    references zeiteintrag (mandant_id, id),
  constraint rpq_aufmass_fk foreign key (mandant_id, aufmass_id)
    references aufmass (mandant_id, id),
  constraint rpq_auftrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint rpq_leistungsnachweis_fk foreign key (mandant_id, leistungsnachweis_id)
    references leistungsnachweis (mandant_id, id),
  constraint rpq_nachtrag_fk foreign key (mandant_id, nachtrag_id)
    references nachtrag (mandant_id, id),

  constraint rpq_akteur_stimmig check (
        (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
     or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
     or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_dienst is not null)),

  /**
   * GENAU EIN Quellschluessel — ausser bei `manuell`, wo es keiner ist.
   *
   * Ohne diese Bedingung koennte eine Zeile zwei Quellen zugleich nennen, und
   * dann entschiede die Abfrage, welche gilt. Der Diskriminator waere dann
   * Dekoration.
   */
  constraint rpq_genau_eine_quelle check (
    num_nonnulls(zeiteintrag_id, aufmass_id, auftrag_leistung_id, ausgabe_id,
                 leistungsnachweis_id, nachtrag_id)
    = case quelle_typ when 'manuell' then 0 else 1 end),

  /** Und die passende: der Diskriminator nennt die Spalte, die gefuellt ist. */
  constraint rpq_diskriminator check (
    case quelle_typ
      when 'zeiteintrag'       then zeiteintrag_id is not null
      when 'aufmass'           then aufmass_id is not null
      when 'vertrag'           then auftrag_leistung_id is not null
      when 'material'          then ausgabe_id is not null
      when 'leistungsnachweis' then leistungsnachweis_id is not null
      when 'nachtrag'          then nachtrag_id is not null
      when 'manuell'           then true
    end),

  -- Eine beleglose Zeile traegt einen GRUND. „Manuell" allein ist keiner.
  constraint rpq_manuell_begruendet check (
    quelle_typ <> 'manuell' or length(btrim(coalesce(notiz, ''))) >= 3),

  /**
   * §4.4: `menge_anteil` ist fuer `aufmass` PFLICHT, weil dort die Summe und
   * nicht ein Unique-Index der Schutz ist. Eine Aufmasszeile ohne Anteil
   * liesse sich gegen nichts pruefen.
   */
  constraint rpq_aufmass_anteil check (quelle_typ <> 'aufmass' or menge_anteil is not null),

  -- Ein Anteil von null ist keine Entnahme, sondern ein Tippfehler.
  constraint rpq_anteil_nicht_null check (menge_anteil is null or menge_anteil <> 0)
);

comment on table rechnungsposition_quelle is
  'FIN-07 §4.4: der Beleg hinter einer Rechnungszeile — Zeiteintrag, Aufmass, '
  'Vertragszeile, Ausgabe, Leistungsnachweis oder Nachtrag — und die '
  'Doppelabrechnungssperre.';
comment on column rechnungsposition_quelle.wirksam is
  'Der ANSPRUCH auf die Quelle. Faellt mit dem Storno auf false und gibt sie '
  'damit wieder frei; die Zeile bleibt stehen (Invariante 8).';
comment on column rechnungsposition_quelle.ausgabe_id is
  'Ohne Fremdschluessel: `ausgabe` kommt mit PR 54 (§8.5). Der partielle '
  'Unique-Index gilt trotzdem.';

/**
 * **Der Anspruch auf eine Stunde — der partielle Unique-Index (§4.4).**
 *
 * Er ist die Sicherung, die auch dann greift, wenn jemand die Arbeitsliste
 * falsch gelesen hat: eine zweite WIRKSAME Zeile auf denselben Zeiteintrag
 * ist ein Constraint-Bruch und keine stille zweite Rechnung. Der Spiegel auf
 * der Quellseite (`zeiteintrag.abgerechnet_am`) beantwortet dieselbe Frage
 * ohne Join — beide existieren, keiner ersetzt den anderen.
 */
create unique index quelle_zeiteintrag_uk on rechnungsposition_quelle (zeiteintrag_id)
  where quelle_typ = 'zeiteintrag' and wirksam;

/** Eine weiterberechnete Ausgabe wird EINMAL weiterberechnet. */
create unique index quelle_ausgabe_uk on rechnungsposition_quelle (ausgabe_id)
  where quelle_typ = 'material' and wirksam;

/** Und ein unterschriebener Leistungsnachweis belegt genau eine Zeile. */
create unique index quelle_leistungsnachweis_uk on rechnungsposition_quelle (leistungsnachweis_id)
  where quelle_typ = 'leistungsnachweis' and wirksam;

/**
 * **KEIN Unique-Index auf `aufmass_id`** (review B11) und keiner auf
 * `auftrag_leistung_id`. Beide waeren falsch: ein Aufmassblatt wird nach
 * § 16 VOB/B anteilig ueber mehrere Abschlagsrechnungen und erneut in der
 * Schlussrechnung abgerechnet, und eine Vertragszeile traegt jeden Monat
 * eine neue Rechnung. Der Schutz steht weiter unten und ist eine SUMME.
 */
create index quelle_aufmass_idx on rechnungsposition_quelle (mandant_id, aufmass_id)
  where wirksam;
/** „Zeig mir die 87 Zeiteintraege hinter dieser Zeile" (DSH-04). */
create index quelle_position_idx on rechnungsposition_quelle (rechnungsposition_id);
create index quelle_rechnung_idx on rechnungsposition_quelle (mandant_id, rechnung_id);
create index quelle_nachtrag_idx on rechnungsposition_quelle (mandant_id, nachtrag_id)
  where nachtrag_id is not null;
create index quelle_vertrag_idx on rechnungsposition_quelle (mandant_id, auftrag_leistung_id)
  where auftrag_leistung_id is not null;

-- ---------------------------------------------------------------------------
-- 4. `zeiteintrag.abrechnung_referenz` — der Fremdschluessel aus `0034` (§19)
-- ---------------------------------------------------------------------------

/**
 * `0034` legte die Spalte an und schrieb daneben: „Der Fremdschluessel auf
 * `rechnungsposition` kommt mit der Finanzmigration." Hier ist er.
 *
 * Ohne ihn koennte `abrechnung_referenz` auf eine Position zeigen, die es
 * nicht gibt oder die einer anderen Gesellschaft gehoert — und genau diese
 * Spalte ist es, die einem Menschen sagt, WELCHE Rechnung seine Stunde
 * verbraucht hat.
 */
alter table zeiteintrag
  add constraint z_abrechnung_referenz_fk
  foreign key (mandant_id, abrechnung_referenz)
  references rechnungsposition (mandant_id, id);

/**
 * **Der schmale UPDATE-Weg der Finanzdomaene auf `zeiteintrag`** (§2.2, §2.3
 * Punkt 6).
 *
 * `t_mandant` verlangt im `WITH CHECK` `zeit.schreiben`. Eine Buchhaltung
 * haelt das nicht — und muss es nicht halten, um eine Rechnung
 * festzuschreiben. Ohne diese Policy traefe der UPDATE aus
 * `markiereQuellenAbgerechnet()` unter FORCE RLS null Zeilen, die
 * Festschreibung liefe trotzdem durch, und der Spiegel auf der Quellseite
 * bliebe fuer immer leer. Genau dieser Ausfall ist geraeuschlos.
 *
 * Die Policy ist SCHMALER als der gewoehnliche Weg, nicht breiter: sie trifft
 * nur Eintraege, die noch nicht abgerechnet sind (`USING`), und laesst nur
 * einen Stand durch, in dem sie es SIND (`WITH CHECK`). Ein UPDATE auf
 * Beginn, Ende oder Zuordnung passt durch sie ebenso wenig wie durch
 * `kern.zeiteintrag_unveraenderlich()`.
 */
create policy z_finanz_abrechnung on zeiteintrag for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and abgerechnet_am is null
              and (select app.hat_recht('finanzen.festschreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and abgerechnet_am is not null
              and abrechnung_referenz is not null
              and (select app.hat_recht('finanzen.festschreiben', app.aktiver_mandant())));

/**
 * Und die Gegenrichtung, die der Storno braucht: eine abgerechnete Stunde
 * wird wieder frei, wenn die Rechnung aufgehoben ist. Sie verlangt
 * `finanzen.stornieren` — ein Recht, das `03-AUTH-BERECHTIGUNGEN.md` §12
 * ohnehin enger vergibt als `finanzen.schreiben`.
 */
create policy z_finanz_freigabe on zeiteintrag for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and abgerechnet_am is not null
              and (select app.hat_recht('finanzen.stornieren', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and abgerechnet_am is null
              and abrechnung_referenz is null
              and (select app.hat_recht('finanzen.stornieren', app.aktiver_mandant())));

-- ---------------------------------------------------------------------------
-- 5. Die Elternzeile nageln, und die Unveraenderlichkeit (§4.3, §4.4)
-- ---------------------------------------------------------------------------

/**
 * `rechnung_id` IST die Rechnung der Position — nicht irgendeine.
 *
 * Die denormalisierte Spalte existiert, damit die Doppelabrechnungsfrage
 * ohne Join auskommt. Ohne diesen Ausloeser waere sie eine zweite, frei
 * beschreibbare Wahrheit, und die Auswertung „welche Stunden stecken in
 * Rechnung X" gaebe eine andere Antwort als die Rechnung selbst.
 *
 * INVOKER, nicht Definer (siehe Abschnitt 2b): `rechnungsposition_quelle` wird
 * ausschliesslich von `cse_app` beschrieben, und `cse_app` liest
 * `rechnungsposition` ueber `t_mandant`. Trifft der Blick keine Zeile, wird
 * das ABGEWIESEN und nicht durchgelassen — die stille Variante waere hier der
 * teure Fehler.
 */
create function fin.quelle_elternzeile() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_rechnung uuid;
begin
  select p.rechnung_id into v_rechnung
    from public.rechnungsposition p
   where p.id = new.rechnungsposition_id and p.mandant_id = new.mandant_id;

  if not found then
    raise exception 'rechnungsposition_quelle: Position % gehoert nicht zu Mandant %',
      new.rechnungsposition_id, new.mandant_id
      using errcode = 'foreign_key_violation';
  end if;
  if new.rechnung_id is distinct from v_rechnung then
    raise exception
      'rechnungsposition_quelle: rechnung_id ist %, die Position haengt an % (§4.4)',
      new.rechnung_id, v_rechnung
      using errcode = 'restrict_violation',
            hint = 'Die Spalte ist denormalisiert, nicht frei: sie muss die Rechnung '
                   'der Position nennen.';
  end if;
  return new;
end $$;

create trigger trg_rpq_1_elternzeile
  before insert or update on rechnungsposition_quelle
  for each row execute function fin.quelle_elternzeile();

/**
 * **Nach dem Festschreiben bewegt sich genau `wirksam`, und nur nach unten.**
 *
 * `fin.kind_unveraenderlich()` (0076) laesst an einer festgeschriebenen
 * Rechnung gar nichts mehr zu — richtig fuer Position, Zuschlag und
 * Steuerzeile, falsch fuer diese Tabelle: die Quelle MUSS beim Storno wieder
 * frei werden, sonst sperrt eine aufgehobene Rechnung die Stunden dauerhaft,
 * die niemand mehr berechnet hat.
 *
 * Deshalb ein eigener Ausloeser mit genau einer Ausnahme. Verglichen wird
 * ueber `to_jsonb`, nicht Spalte fuer Spalte — eine spaeter hinzukommende
 * Spalte ist damit automatisch geschuetzt (dieselbe Ueberlegung wie in 0076).
 */
create function fin.quelle_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_status rechnung_status;
  v_nummer text;
  v_alt    jsonb;
  v_neu    jsonb;
  v_feld   text;
begin
  select r.status, r.nummer into v_status, v_nummer
    from public.rechnung r where r.id = coalesce(new.rechnung_id, old.rechnung_id);

  if v_status is null then
    raise exception 'Rechnung % existiert nicht', coalesce(new.rechnung_id, old.rechnung_id)
      using errcode = 'foreign_key_violation';
  end if;

  if tg_op = 'INSERT' then
    if v_status = 'entwurf' then return new; end if;
    raise exception
      'Rechnung %: eine Herkunftszeile entsteht im Entwurf, nicht an einem %en Beleg (Invariante 4)',
      coalesce(v_nummer, new.rechnung_id::text), v_status
      using errcode = 'restrict_violation';
  end if;

  if v_status = 'entwurf' then return new; end if;

  -- Ab hier: festgeschrieben oder verworfen. Genau `wirksam` darf fallen.
  v_alt := to_jsonb(old) - 'wirksam' - 'geaendert_am';
  v_neu := to_jsonb(new) - 'wirksam' - 'geaendert_am';

  if v_alt <> v_neu then
    select k into v_feld
      from jsonb_object_keys(v_neu) k
     where v_alt -> k is distinct from v_neu -> k
     order by k limit 1;
    raise exception
      'Rechnung %: die Herkunft eines %en Belegs ist unveraenderlich — % wurde geaendert (Invariante 4)',
      coalesce(v_nummer, new.rechnung_id::text), v_status, coalesce(v_feld, '<Spalte entfernt>')
      using errcode = 'restrict_violation',
            hint = 'Nur `wirksam` faellt — und nur von true nach false, wenn der Beleg '
                   'storniert oder verworfen wird.';
  end if;

  if old.wirksam and not new.wirksam then return new; end if;
  if old.wirksam = new.wirksam then return new; end if;

  raise exception
    'Rechnung %: ein erloschener Herkunftsanspruch lebt nicht wieder auf (§4.4)',
    coalesce(v_nummer, new.rechnung_id::text)
    using errcode = 'restrict_violation',
          hint = 'Eine wieder benoetigte Quelle wird auf einer NEUEN Rechnung neu '
                 'beansprucht, nicht auf der aufgehobenen.';
end $$;

create trigger trg_rpq_2_unveraenderlich
  before insert or update on rechnungsposition_quelle
  for each row execute function fin.quelle_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 6. Keine Leistungszeile ohne Beleg (§4.4, FIN-07) — aufgeschoben
-- ---------------------------------------------------------------------------

/**
 * **Aufgeschoben, weil die Quellzeilen NACH der Position entstehen.**
 *
 * Ein sofortiger Ausloeser wiese jede Position zurueck, deren Beleg eine
 * Anweisung spaeter folgt — also jede. Aufgeschoben prueft er beim COMMIT
 * und sagt damit genau das, was FIN-07 meint: am Ende der Transaktion traegt
 * jede Leistungszeile ihren Beleg.
 *
 * **Nur `leistung`.** Eine `textzeile` traegt keine Menge und keinen Betrag
 * (0075), eine `zwischensumme` ist reine Anzeige und faellt aus jeder Summe
 * heraus. Von ihnen einen Beleg zu verlangen hiesse, fuer einen VOB-Verweis
 * eine Quellzeile zu erfinden.
 */
create function fin.position_hat_quelle() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_p record;
  v_r record;
begin
  select p.* into v_p from public.rechnungsposition p where p.id = new.id;
  /**
   * **Nicht gefunden heisst hier NICHT „nichts zu tun".**
   *
   * `rechnungsposition` kennt keinen Hard Delete (0075), die Zeile ist also
   * da. Sie NICHT zu sehen hiesse, dass dieser Ausloeser unter einer Rolle
   * laeuft, die keine Policy auf sie haelt — und dann prueft er nichts mehr,
   * geraeuschlos. Genau dieser Ausfall waere die teuerste Art, FIN-07 zu
   * verlieren.
   */
  if not found then
    raise exception
      'rechnungsposition %: fuer die Herkunftspruefung nicht sichtbar (FIN-07)', new.id
      using errcode = 'insufficient_privilege',
            hint = 'Der Ausloeser laeuft als Aufrufer und braucht eine Lesepolicy auf '
                   'rechnungsposition.';
  end if;
  if v_p.positionsart <> 'leistung' then return null; end if;

  /**
   * Gefragt ist die EXISTENZ eines Belegs, nicht ein lebender Anspruch.
   *
   * `and q.wirksam` waere hier falsch, und zwar auf die teure Art: die
   * Stornorechnung uebernimmt den Beleg des Originals ausdruecklich
   * UNWIRKSAM (sie bezeugt, was aufgehoben wurde, und beansprucht nichts).
   * Mit `wirksam` in dieser Bedingung waere ausgerechnet die Korrektur die
   * eine Buchung, die sich nicht schreiben laesst.
   */
  if exists (select 1 from public.rechnungsposition_quelle q
              where q.rechnungsposition_id = v_p.id) then
    return null;
  end if;

  select r.nummer, r.status into v_r from public.rechnung r where r.id = v_p.rechnung_id;

  raise exception
    'Rechnung %, Position %: keine Herkunft hinterlegt (FIN-07, §4.4)',
    coalesce(v_r.nummer, v_p.rechnung_id::text), v_p.position_nr
    using errcode = 'restrict_violation',
          hint = 'Jede Leistungszeile nennt ihren Beleg — Zeiteintrag, Aufmass, '
                 'Vertragszeile, Ausgabe, Leistungsnachweis oder Nachtrag. Eine von '
                 'Hand getippte Zeile traegt quelle_typ = ''manuell'' MIT Begruendung.';
end $$;

create constraint trigger rp_hat_quelle
  after insert or update on rechnungsposition
  deferrable initially deferred
  for each row execute function fin.position_hat_quelle();

comment on function fin.position_hat_quelle() is
  'FIN-07 §4.4: beim COMMIT traegt jede Leistungszeile mindestens eine wirksame '
  'Herkunftszeile. Aufgeschoben, weil der Beleg nach der Zeile geschrieben wird.';

-- ---------------------------------------------------------------------------
-- 7. Der Aufmass-Schutz: eine SUMME, kein Unique-Index (§4.4, § 16 VOB/B)
-- ---------------------------------------------------------------------------

/**
 * **Warum hier eine Summe steht und kein zweiter Unique-Index.**
 *
 * § 16 VOB/B rechnet ein Aufmassblatt anteilig ueber aufeinanderfolgende
 * Abschlagsrechnungen ab und noch einmal, abzueglich der Abschlaege, in der
 * Schlussrechnung. Teilmengen eines Blattes sind der Normalfall und nicht die
 * Ausnahme. Ein partieller Unique-Index auf `aufmass_id` machte die ZWEITE
 * Bezugnahme zu einem Constraint-Bruch — FIN-08 waere auf gemessener
 * Leistung unausfuehrbar, und `menge_anteil`, das genau fuer die Teilentnahme
 * existiert, unbenutzbar.
 *
 * Die Obergrenze ist die GEMESSENE Menge des Blattes, also die Summe seiner
 * Zeilen. `aufmass` traegt selbst keine `menge` — §4.4 nennt eine, `0072`
 * legt sie nicht an, und die Menge steht dort, wo sie gemessen wird: auf
 * `aufmass_zeile`. Abzugszeilen sind negativ (§7.7 GEWERKE), also ist die
 * Summe die richtige Groesse und nicht etwa die Summe der Betraege.
 *
 * // TODO(client, O-340): Darf ein Aufmassblatt Zeilen in VERSCHIEDENEN
 * Einheiten tragen (m², m, Stk auf einem Blatt)? Falls ja, ist die Obergrenze
 * je Einheit — oder je LV-Position — zu bilden, und die Summe ueber das ganze
 * Blatt waere eine Addition von Aepfeln und Birnen. Bis zur Antwort prueft
 * dieser Ausloeser gegen die Blattsumme und die Oberflaeche sagt es dazu.
 *
 * Aufgeschoben, weil eine Rechnung mehrere Anteile desselben Blattes in einer
 * Transaktion schreiben darf; sofort geprueft schluege sie zwischendurch an.
 */
create function fin.pruefe_aufmass_menge() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_aufmass   uuid := coalesce(new.aufmass_id, old.aufmass_id);
  v_gemessen  numeric(12,3);
  v_verbraucht numeric(12,3);
  v_nummer    text;
begin
  if v_aufmass is null then return null; end if;

  select a.nummer into v_nummer from public.aufmass a where a.id = v_aufmass;
  if not found then return null; end if;

  select coalesce(sum(z.menge), 0) into v_gemessen
    from public.aufmass_zeile z where z.aufmass_id = v_aufmass;

  select coalesce(sum(q.menge_anteil), 0) into v_verbraucht
    from public.rechnungsposition_quelle q
   where q.aufmass_id = v_aufmass and q.quelle_typ = 'aufmass' and q.wirksam;

  /**
   * Verglichen wird in BETRAEGEN, nicht mit `>`: ein Rueckbaublatt misst
   * negativ, und `-40 > -30` waere dort die falsche Richtung. Die Frage ist
   * „mehr entnommen als gemessen", und das ist eine Frage der Groesse.
   */
  if abs(v_verbraucht) > abs(v_gemessen) then
    raise exception
      'Aufmass %: abgerechnet waeren % von gemessenen % (§ 16 VOB/B, §4.4)',
      coalesce(v_nummer, v_aufmass::text), v_verbraucht, v_gemessen
      using errcode = 'restrict_violation',
            hint = 'Ein Aufmassblatt wird anteilig abgerechnet — in der Summe aber nie '
                   'mehr, als gemessen wurde.';
  end if;

  -- Der Rueckschreibweg auf das Blatt (§2.3 Punkt 5). Er laeuft durch
  -- `d_aufmass_abrechnung`; ohne Policy traefe er null Zeilen.
  update public.aufmass set abgerechnet_menge = v_verbraucht where id = v_aufmass;

  return null;
end $$;

alter function fin.pruefe_aufmass_menge() owner to cse_definer;

create constraint trigger quelle_aufmass_menge
  after insert or update on rechnungsposition_quelle
  deferrable initially deferred
  for each row
  when (new.quelle_typ = 'aufmass')
  execute function fin.pruefe_aufmass_menge();

/**
 * Und die Gegenrichtung: faellt `wirksam`, sinkt die aufgelaufene Menge. Ohne
 * diesen zweiten Ausloeser bliebe `abgerechnet_menge` nach einem Storno auf
 * dem alten Stand stehen, und das Blatt gaelte als abgerechnet, obwohl seine
 * Rechnung aufgehoben ist. `when` kann `old` nur in einem eigenen Ausloeser
 * pruefen — deshalb zwei.
 */
create constraint trigger quelle_aufmass_menge_frei
  after update on rechnungsposition_quelle
  deferrable initially deferred
  for each row
  when (old.quelle_typ = 'aufmass' and old.wirksam and not new.wirksam)
  execute function fin.pruefe_aufmass_menge();

comment on function fin.pruefe_aufmass_menge() is
  '§4.4/review B11: die Summe der wirksamen Anteile eines Aufmassblattes '
  'ueberschreitet die gemessene Menge nicht — und wird auf das Blatt '
  'zurueckgeschrieben. Kein Unique-Index: § 16 VOB/B rechnet anteilig ab.';

-- ---------------------------------------------------------------------------
-- 8. FIN-18: die erfassten Minuten eines Auftrags — als ZAHL, nicht als Liste
-- ---------------------------------------------------------------------------

/**
 * **Warum das eine Definer-Funktion ist und keine Abfrage im Dienst.**
 *
 * Die FIN-18-Warnung muss VOR der Nummernvergabe fallen, und sie laeuft in der
 * Sitzung dessen, der festschreibt. Eine Buchhaltung haelt `finanzen.*`; sie
 * haelt nicht `zeit.lesen`. Die Sicht `zeiteintrag_auftrag` laeuft mit
 * `security_invoker` (0051, §1.11) — eine Zaehlung darueber gaebe fuer genau
 * diese Rolle NULL zurueck, und die Warnung schluege dann bei JEDEM Auftrag
 * an, auch bei denen mit tausend erfassten Stunden. Eine fail-closed
 * Fehlmeldung, die man nur noch wegklickt, ist schlimmer als keine: nach der
 * dritten uebergeht man sie ohne hinzusehen, und dann ist die eine echte
 * Warnung auch weg.
 *
 * Die Funktion gibt deshalb GENAU EINE ZAHL zurueck und keine Zeile: keinen
 * Namen, keine Schicht, keine Beschaeftigung. Damit erfaehrt die Buchhaltung,
 * DASS Zeit erfasst wurde, und nicht, wer sie erfasst hat (EMP-13).
 *
 * Sie prueft Mandant und Recht ausdruecklich gegen die Sitzungs-GUCs — ein
 * Definer, der sich auf den Aufrufer verlaesst, prueft nichts (01-KERN §3.2).
 * `z_definer_lesen` (0034) ist die Policy, durch die sie liest; unter FORCE
 * RLS ist auch sie nicht ausgenommen (K-01).
 */
create function fin.auftrag_erfasste_minuten(p_auftrag uuid)
returns bigint
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_gehoert uuid;
  v_minuten bigint;
begin
  select a.mandant_id into v_gehoert from public.auftrag a where a.id = p_auftrag;
  if not found then
    raise exception 'Auftrag % existiert nicht', p_auftrag using errcode = 'no_data_found';
  end if;
  if v_gehoert is distinct from v_mandant then
    raise exception 'Auftrag % gehoert nicht zum aktiven Mandanten (Invariante 3)', p_auftrag
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('finanzen.festschreiben', v_gehoert) then
    raise exception 'finanzen.festschreiben fehlt' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(z.dauer_netto_minuten), 0) into v_minuten
    from public.zeiteintrag z
    join public.auftrag_leistung al
      on al.mandant_id = z.mandant_id and al.id = z.auftrag_leistung_id
   where al.auftrag_id = p_auftrag
     and z.storniert_am is null
     and z.ersetzt_am is null;

  return v_minuten;
end $$;

alter function fin.auftrag_erfasste_minuten(uuid) owner to cse_definer;
revoke execute on function fin.auftrag_erfasste_minuten(uuid) from public;
grant execute on function fin.auftrag_erfasste_minuten(uuid) to cse_app;

comment on function fin.auftrag_erfasste_minuten(uuid) is
  'FIN-18: die Summe der erfassten Nettominuten eines Auftrags — eine ZAHL, '
  'keine Zeile. Die Festschreibung fragt sie, bevor eine Nummer gezogen wird.';

-- ---------------------------------------------------------------------------
-- 9. RLS (§1.3, §1.4, K-03, K-04) — INTERN, ohne Kundenzweig
-- ---------------------------------------------------------------------------

/**
 * **Diese Tabelle ist INTERN, obwohl ihre Elternzeile es nicht ist** (§1.4).
 *
 * Sie nennt die `zeiteintrag`-Zeilen hinter einer Rechnungsposition, also
 * WER WELCHE STUNDEN gearbeitet hat. DSH-04 („jede Zahl fuehrt auf die Sätze
 * dahinter") ist eine Forderung an die INTERNEN Auswertungen; ein Kunde
 * bekommt die Rechnungszeile, den Leistungsnachweis und das Aufmassblatt
 * ueber seine eigenen Dokumente — nie den Dienstplan.
 *
 * Deshalb: kein `t_kunde`, und die Decke hat genau EINEN Zweig.
 */
alter table rechnungsposition_quelle enable row level security;
alter table rechnungsposition_quelle force  row level security;

create policy t_mandant on rechnungsposition_quelle for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              /**
               * `finanzen.stornieren` steht daneben, weil das Erloeschen von
               * `wirksam` ein UPDATE ist und die Storno-Rolle nicht zwingend
               * `finanzen.schreiben` haelt (§12.5). Ohne diesen Zweig liesse
               * sich eine Rechnung stornieren, ohne ihre Quellen freizugeben
               * — und die Stunden blieben fuer immer gesperrt.
               */
              and ((select app.hat_recht('finanzen.schreiben', app.aktiver_mandant()))
                   or (select app.hat_recht('finanzen.stornieren', app.aktiver_mandant())))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on rechnungsposition_quelle for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')));

create policy p_intern_ceiling on rechnungsposition_quelle as restrictive for all to cse_app
  using      (app.portal() = 'intern')
  with check (app.portal() = 'intern');

grant select, insert, update on rechnungsposition_quelle to cse_app;
grant select on rechnungsposition_quelle to cse_definer;

/**
 * `cse_definer` liest, weil `fin.rechnung_kette_schreiben` die Nutzlast
 * gegen die gespeicherte Zeile haelt und die Herkunft Teil der Nutzlast ist
 * (§5.3). Ein Definer ist unter FORCE RLS nicht ausgenommen (K-01) — ohne
 * Policy traefe sein `select` null Zeilen, und die Kette bezeugte eine
 * Rechnung ohne Herkunft, obwohl eine da ist.
 */
create policy d_quelle_lesen on rechnungsposition_quelle for select to cse_definer
  using (true);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0088)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- rechnungsposition_quelle (archiv): FIN-07, §4.4, Invariante 8. Sie IST der Beleg, dass eine abgerechnete Stunde abgerechnet ist. Waere sie loeschbar, liesse sich die Doppelabrechnungssperre durch ein DELETE aufheben — und derselbe Zeiteintrag stuende auf zwei Rechnungen, ohne dass irgendwo eine Zeile fehlte. Ein erloschener Anspruch faellt auf `wirksam = false` und bleibt stehen.
create trigger trg_rechnungsposition_quelle_kein_hard_delete
  before delete on rechnungsposition_quelle
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnungsposition_quelle_kein_truncate
  before truncate on rechnungsposition_quelle
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnungsposition_quelle from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_rechnungsposition_quelle_geaendert_am
  before update on rechnungsposition_quelle
  for each row execute function kern.setze_geaendert_am();

create trigger trg_rechnungsposition_quelle_audit
  after insert or update or delete on rechnungsposition_quelle
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
