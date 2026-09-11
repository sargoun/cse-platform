-- ===========================================================================
-- 0077 — Die Festschreibung: rechnung_snapshot, rechnung_hash und die zwei
--        SECURITY-DEFINER-Funktionen, durch die sie entstehen
--        (FIN-03, FIN-06, FIN-16, LEG-01, TEN-02, Invariante 4, K-01, O-01)
--
-- Vertrag: `docs/architecture/02-datenmodell/05-FINANZEN.md` §1.1, §5.1, §5.2,
-- §5.3, §5.4, §5.5, §5.6, §5.7, §14.
--
-- Vier Entscheidungen tragen diese Datei:
--
--  1. **Die Nummer entsteht unter `SELECT … FOR UPDATE`, nie aus einer
--     Sequenz.** Eine Sequenz ist ausdruecklich nicht transaktional:
--     `nextval` ueberlebt ein ROLLBACK. Sie faelschte damit genau die Luecke,
--     nach der eine GoBD-Pruefung fragt — unsichtbar und Monate, bevor
--     jemand hinsieht. Die Zeilensperre macht die Vergabe transaktional; der
--     Preis ist Serialisierung, und der Preis ist der Punkt.
--
--  2. **Zwei Definer-Aufrufe, nicht einer.** Die Nutzlast, die gehasht wird,
--     traegt `nummer` und `kette_position` — sie kann also erst NACH dem Zug
--     gebaut werden. Gebaut wird sie von `buildKanonischePayload`, dem einen
--     RFC-8785-Kanonisierer der Plattform (TypeScript). Eine plpgsql-Kopie
--     waere ein zweiter Kanonisierer, und zwei Kanonisierer heissen: eine
--     Kette, die gegen keinen von beiden verifiziert. Geteilt wird deshalb
--     genau an dieser Naht — **die Anwendung liefert das Dokument, die
--     Datenbank liefert die Kette.** Aufruf B rechnet beide Digests selbst,
--     aus den uebergebenen Bytes und dem Kettenkopf, den er noch gesperrt
--     haelt.
--
--  3. **Der Definer ist von FORCE RLS NICHT ausgenommen** (K-01, §1.1). Er
--     schreibt durch SCHMALE POLICIES, nicht an RLS vorbei. Der erste Entwurf
--     des Kapitels liess ihn `nummernkreis` und `rechnung` aktualisieren,
--     waehrend §1.1 behauptete, es gebe keinen solchen Schreibweg — unter
--     FORCE RLS haette der Zaehler-UPDATE keine Policy getroffen, null Zeilen
--     beruehrt und **keine Rechnung waere je festgeschrieben worden**. Die
--     naheliegende Feldkorrektur (den Definer zum Eigentuemer machen oder ihm
--     BYPASSRLS geben) bricht K-01 geraeuschlos.
--
--  4. **Eine festgeschriebene Rechnung ohne Kettenglied ist unmoeglich, nicht
--     bloss unwahrscheinlich.** Ein Aufrufer koennte nach Aufruf A aufhoeren.
--     Ein aufgeschobener Constraint-Ausloeser prueft beim COMMIT, dass jede
--     festgeschriebene Zeile genau einen Snapshot und genau ein Kettenglied
--     hat — also gibt es zwei Ausgaenge und keinen dritten: eine vollstaendig
--     verkettete Rechnung, oder gar keine.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. rechnung_snapshot (§5.1)
-- ---------------------------------------------------------------------------

/**
 * Das eingefrorene Dokument, byte-genau so, wie es festgeschrieben wurde —
 * das, was gehasht, nachgedruckt, exportiert und einem Pruefer vorgelegt
 * wird.
 *
 * `nutzlast_bytes` ist MASSGEBLICH, `nutzlast` nur zum Suchen: `jsonb`
 * sortiert Schluessel um und formatiert Zahlen neu, kann also niemals die
 * Hasheingabe sein. Beide stehen trotzdem da, weil eine Pruefungssuche
 * („jede Rechnung mit Leitweg-ID X") sonst ueber Bytes laufen muesste.
 *
 * PK ist `id`, nicht `rechnung_id`. Der erste Entwurf nannte das eine
 * begruendete Ausnahme von der uuid-PK-Regel; K-16 fuehrt aber eine
 * GESCHLOSSENE Liste erlaubter Abweichungen, und „eine Zeile je Elternzeile"
 * steht nicht darauf. Verloren geht nichts — `unique (rechnung_id)` sagt
 * dasselbe.
 */
create table rechnung_snapshot (
  id                   uuid primary key default gen_random_uuid(),
  rechnung_id          uuid not null,
  mandant_id           uuid not null references mandant(id),

  -- Die Gestalt der Nutzlast. Sie wird erhoeht, BEVOR eine Rechnung damit
  -- festgeschrieben wird, nie danach: eine Gestalt, die sich unter
  -- bestehenden Gliedern aendert, ist keine Gestalt. Der Pruefer waehlt den
  -- Kanonisierer nach diesem Feld.
  schema_version       text not null,
  -- Die kanonischen UTF-8-Bytes, die gehasht wurden.
  nutzlast_bytes       bytea not null,
  -- Derselbe Inhalt, nur zum Abfragen.
  nutzlast             jsonb not null,
  -- Der §14-UStG-Pflichtfeldbericht, wie er beim Festschreiben stand.
  pflichtfeld_pruefung jsonb not null,
  regelwerk_version    text not null,

  erzeugt_am           timestamptz not null default now(),
  -- NOT NULL und ein MENSCH (§1.6): die Zeile kann vor der Handlung nicht
  -- existieren, und „System" waere hier eine Luege.
  erzeugt_von          uuid not null references benutzer(id),

  aufbewahrung_klasse  text not null default 'rechnung_ausgang',
  aufbewahrung_bis     date,
  loeschsperre         boolean not null default true,

  constraint rsn_mandant_uk unique (mandant_id, id),
  constraint rsn_rechnung_uk unique (rechnung_id),
  constraint rsn_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id)
);

create index rsn_zeitraum_idx on rechnung_snapshot (mandant_id, erzeugt_am);
-- Pruefungssuche ueber den Inhalt.
create index rsn_nutzlast_idx on rechnung_snapshot using gin (nutzlast jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 2. rechnung_hash (§5.2)
-- ---------------------------------------------------------------------------

create table rechnung_hash (
  id               uuid primary key default gen_random_uuid(),
  rechnung_id      uuid not null,
  mandant_id       uuid not null references mandant(id),
  nummernkreis_id  uuid not null,

  kette_position   bigint not null check (kette_position > 0),
  -- Nie NULL: der Genesis ist 64 Nullen, kein fehlender Wert. Ein NULL-Genesis
  -- ergaebe fuer denselben Satz einen ANDEREN Digest als die TypeScript-Seite.
  vorheriger_hash  text not null,
  -- SHA-256 der Nutzlast ALLEIN — damit sich eine Nutzlast pruefen laesst,
  -- ohne die ganze Kette zu laufen.
  nutzlast_sha256  text not null,
  hash             text not null,
  -- Benennt Digest UND Kanonisierung. „sha256" allein sagte nichts darueber,
  -- WELCHE Bytes gehasht wurden.
  algorithmus      text not null default 'sha256-jcs-v1',
  erstellt_am      timestamptz not null default now(),

  constraint rh_mandant_uk unique (mandant_id, id),
  constraint rh_rechnung_uk unique (rechnung_id),
  constraint rh_rechnung_fk foreign key (mandant_id, rechnung_id)
    references rechnung (mandant_id, id),
  constraint rh_nummernkreis_fk foreign key (mandant_id, nummernkreis_id)
    references nummernkreis (mandant_id, id),

  -- Hex-64 als `text` mit CHECK, nicht `char(64)`: `char(n)` fuellt beim
  -- Vergleich auf, und ein aufgefuellter Hash vergleicht sich unter
  -- bpchar-Semantik gleich mit einem kuerzeren (§1.7).
  constraint rh_hex_vorher check (vorheriger_hash ~ '^[0-9a-f]{64}$'),
  constraint rh_hex_nutzlast check (nutzlast_sha256 ~ '^[0-9a-f]{64}$'),
  constraint rh_hex_hash check (hash ~ '^[0-9a-f]{64}$')
);

-- Der naechtliche Lauf und die Lueckenlosigkeitspruefung in einem Index.
create unique index rh_kette_uk on rechnung_hash (nummernkreis_id, kette_position);
/**
 * **Macht eine Gabelung unmoeglich.** Zwei Rechnungen koennen nicht denselben
 * Vorgaenger beanspruchen — ein Nebenlaeufigkeitsfehler ist damit eine
 * Eindeutigkeitsverletzung statt eines stillen Astes, den erst der
 * naechtliche Lauf Wochen spaeter findet.
 */
create unique index rh_vorgaenger_uk on rechnung_hash (nummernkreis_id, vorheriger_hash);
create unique index rh_hash_uk on rechnung_hash (mandant_id, hash);

-- ---------------------------------------------------------------------------
-- 3. Kein UPDATE, kein DELETE auf den Kettentabellen
-- ---------------------------------------------------------------------------

/**
 * Ein UPDATE auf einem Kettenglied ist kein Grenzfall, es ist der Angriff:
 * wer Nutzlast und Hash gemeinsam neu schreibt, bekommt eine Kette, die
 * verifiziert und etwas anderes bezeugt. Deshalb hier unbedingt, ohne
 * Zustandsabfrage und ohne Ausnahme.
 */
create function fin.kette_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception '%: Kettensaetze werden geschrieben und nie mehr geaendert (FIN-06, LEG-01)',
    tg_table_name
    using errcode = 'restrict_violation';
end $$;

create trigger trg_rsn_unveraenderlich
  before update on rechnung_snapshot
  for each row execute function fin.kette_unveraenderlich();
create trigger trg_rh_unveraenderlich
  before update on rechnung_hash
  for each row execute function fin.kette_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 4. RLS und Rechte (§5.1, §5.2, §14)
-- ---------------------------------------------------------------------------

alter table rechnung_snapshot enable row level security;
alter table rechnung_snapshot force  row level security;
alter table rechnung_hash     enable row level security;
alter table rechnung_hash     force  row level security;

/**
 * Lesen ja, schreiben nein — **fuer `cse_app` gibt es hier keine
 * INSERT-Policy** (review B16). Haette sie eine, koennte jeder, der
 * `finanzen.schreiben` haelt, ein Kettenglied faelschen, und die Kette
 * bezeugte dann genau so viel wie das Recht, das am weitesten verbreitet ist.
 */
create policy t_mandant_lesen on rechnung_snapshot for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())));
create policy t_gruppe on rechnung_snapshot for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')));
create policy p_intern_ceiling on rechnung_snapshot as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

create policy t_mandant_lesen on rechnung_hash for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('finanzen.lesen', app.aktiver_mandant())));
create policy t_gruppe on rechnung_hash for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.finanzen.lesen')));
create policy p_intern_ceiling on rechnung_hash as restrictive for all to cse_app
  using (app.portal() = 'intern') with check (app.portal() = 'intern');

grant select on rechnung_snapshot, rechnung_hash to cse_app;
-- Der naechtliche Pruefer liest; schreiben kann er nichts, und genau deshalb
-- ist sein Befund ein Zeugnis und keine Tautologie (§5.7).
grant select on rechnung_snapshot, rechnung_hash to cse_job;
revoke insert, update, delete, truncate on rechnung_snapshot from cse_app, cse_job;
revoke insert, update, delete, truncate on rechnung_hash     from cse_app, cse_job;

/**
 * Die sechs schmalen Policies fuer `cse_definer` (§1.1, §14).
 *
 * Sie sind eine POLICY-GEWAEHRUNG, keine RLS-Ausnahme. K-01 nimmt
 * `cse_definer` nur auf den Tabellen von K-06 und K-08 aus, und keine Tabelle
 * dieser Domaene ist eine davon: FORCE RLS gilt hier fuer ihn wie fuer jeden.
 *
 * `_rechnung_festschreiben` ist das Stueck, auf das es ankommt: `using
 * (status = 'entwurf')` und `with check (status = 'festgeschrieben')` lassen
 * GENAU EINEN Uebergang zu, und nur im Mandanten der aufrufenden Sitzung. Der
 * erhoehte Weg ist damit SCHMALER als der gewoehnliche, nicht breiter.
 */
create policy d_rechnung_lesen on rechnung for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

create policy d_rechnung_festschreiben on rechnung for update to cse_definer
  using      (mandant_id = app.aktiver_mandant() and status = 'entwurf')
  with check (mandant_id = app.aktiver_mandant() and status = 'festgeschrieben');

/**
 * `_lesen` ist innerhalb des Mandanten UNBESCHRAENKT — auch ein Platzhalter
 * und ein geschlossener Kreis sind lesbar. Das ist der Unterschied zwischen
 * „dieser Kreis ist noch nicht bestaetigt" und „es gibt keinen Kreis", und
 * zwei verschiedene Menschen muessen darauf zwei verschiedene Dinge tun.
 *
 * Die Namen weichen von §1.1 ab (`d_kreis_lesen` / `d_kreis_ziehen`): diese
 * beiden Namen sind auf `nummernkreis` seit `0006` an die `cse_app`-Policies
 * vergeben, und ein Policyname ist je Tabelle eindeutig. Umbenannt wird
 * nicht — der `cse_app`-Zug der fuenf uebrigen Kreistypen haengt daran.
 */
create policy d_rechnungskreis_lesen on nummernkreis for select to cse_definer
  using (mandant_id = app.aktiver_mandant()
         and kreis_typ in ('ausgangsrechnung', 'gutschrift'));

create policy d_rechnungskreis_ziehen on nummernkreis for update to cse_definer
  using      (mandant_id = app.aktiver_mandant()
              and kreis_typ in ('ausgangsrechnung', 'gutschrift')
              and geschlossen_am is null
              and not ist_platzhalter)
  with check (mandant_id = app.aktiver_mandant()
              and kreis_typ in ('ausgangsrechnung', 'gutschrift'));

create policy d_snapshot_schreiben on rechnung_snapshot for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant()
              and exists (select 1 from rechnung r
                           where r.id = rechnung_snapshot.rechnung_id
                             and r.mandant_id = rechnung_snapshot.mandant_id
                             and r.status = 'festgeschrieben'));

create policy d_hash_schreiben on rechnung_hash for insert to cse_definer
  with check (mandant_id = app.aktiver_mandant()
              and exists (select 1 from rechnung r
                           where r.id = rechnung_hash.rechnung_id
                             and r.mandant_id = rechnung_hash.mandant_id
                             and r.status = 'festgeschrieben'));

/**
 * **Sechs Policies fuer `cse_definer` in dieser Domaene, und keine siebte.**
 * Insbesondere KEINE Lesepolicy auf den zwei Kettentabellen: Aufruf B muss
 * nicht nachsehen, ob schon ein Kettenglied existiert — `rh_rechnung_uk` sagt
 * es ihm, und der Ausnahmezweig dort macht daraus eine benannte Meldung. Eine
 * Lesepolicy, die nur eine Diagnose verbessert, waere eine siebte Zeile in
 * einer Liste, deren ganzer Wert darin besteht, kurz zu sein.
 */

/**
 * Spaltenlisten statt Tabellen-Grants — die eigentliche Schranke.
 *
 * Was der Definer auf `rechnung` schreiben darf, ist genau die Spaltenmenge
 * aus Schritt 6 des §5.6 und nichts sonst. Selbst wenn seine Policy
 * irgendwann weiter geriete, kaeme er an `netto_gesamt_cent`, `kunde_id` oder
 * `kopftext` nicht heran.
 *
 * `bauabzugsteuer_*` und `einbehalt_bauabzugsteuer_cent` stehen schon hier,
 * obwohl sie erst PR 51 fuellt: sie werden in derselben Anweisung gesetzt,
 * und ein nachgereichter Spalten-Grant waere eine Erweiterung genau des
 * Rechts, das diese Liste einschraenken soll.
 */
grant select on rechnung to cse_definer;
grant update (status, nummernkreis_id, nummer, nummer_laufend, rechnungsdatum,
              rechnungsart_code, faellig_am, zahlungsziel_tage, ist_kleinbetrag,
              bauabzugsteuer_pflichtig, bauabzugsteuer_satz_bp,
              bauabzugsteuer_grundlage_cent, einbehalt_bauabzugsteuer_cent,
              festgeschrieben_am, festgeschrieben_von,
              geaendert_am, geaendert_von, geaendert_von_art)
  on rechnung to cse_definer;

-- `naechste_nummer` und der Auditblock sind seit `0070` gewaehrt; der
-- Kettenkopf fehlte, weil bis hierher nichts ihn fortschrieb. `geschlossen_am`
-- steht ausdruecklich NICHT dabei: einen Kreis zu schliessen ist ein
-- Verwaltungsakt, kein Nebenprodukt einer Festschreibung (siehe Abschnitt 6).
grant update (letzter_hash) on nummernkreis to cse_definer;
grant insert on rechnung_snapshot, rechnung_hash to cse_definer;

-- Der Definer prueft das Recht selbst, also muss er die Pruefung aufrufen
-- duerfen.
grant execute on function app.hat_recht(text, uuid) to cse_definer;

/**
 * Und er muss den NAMEN der Gesellschaft lesen koennen — fuer genau eine
 * Meldung: „Rechnungskreis für CSE Operations nicht freigegeben" (O-01).
 *
 * Ohne Grant UND Policy scheitert die Festschreibung dort mit „permission
 * denied for table mandant" beziehungsweise mit null Zeilen — also mit einer
 * Meldung ueber die Datenbank statt einer ueber die offene Frage. Eine
 * Nummernvergabe, die nicht sagen kann, WELCHE Gesellschaft keinen Kreis hat,
 * schickt jemanden auf die Suche.
 *
 * Eine Zeile, der aktive Mandant, nur lesend. `mandant` gehoert `01-KERN.md`,
 * nicht dieser Domaene — die §14-Aufzaehlung der sechs Definer-Policies
 * bleibt davon unberuehrt.
 */
grant select on mandant to cse_definer;
create policy d_mandant_lesen on mandant for select to cse_definer
  using (id = app.aktiver_mandant());

-- ---------------------------------------------------------------------------
-- 5. Die Maske — an EINER Stelle in SQL aufgeloest
-- ---------------------------------------------------------------------------

/**
 * Dieselbe Aufloesung wie `formatiereNummer` in
 * `src/server/services/finanz/nummernkreis.ts`, und die Doppelung ist die
 * eine, die sich nicht vermeiden laesst: der Zug laeuft in SQL (er braucht
 * die Zeilensperre), die uebrigen fuenf Kreistypen zieht die Anwendung.
 *
 * Deshalb prueft ein Test beide Fassungen gegen DIESELBEN Vektoren. Zwei
 * Fassungen, die niemand vergleicht, sind zwei Rechnungsnummernformate.
 *
 * `{jahr}` ist das Jahr DES KREISES, nicht das heutige — bei `jahr = 0`
 * (fortlaufend) gibt es keines einzusetzen, und das ist ein Fehler statt
 * einer stillen Null.
 */
create function fin.nummer_formatieren(p_maske text, p_nummer bigint, p_jahr integer)
returns text
language plpgsql immutable as $$
declare
  v_ergebnis text := p_maske;
  v_treffer  text[];
  v_breite   integer;
begin
  if p_maske !~ '\{nr(:\d+)?\}' then
    raise exception 'Nummernmaske % enthaelt kein {nr} — jede Nummer waere dieselbe', p_maske
      using errcode = 'invalid_parameter_value';
  end if;

  v_treffer := regexp_match(p_maske, '\{nr(?::(\d+))?\}');
  v_breite := coalesce(v_treffer[1]::integer, 0);
  /**
   * `{nr}` OHNE Breite ist nicht `lpad(…, 0, '0')`.
   *
   * `lpad` mit Laenge 0 SCHNEIDET auf null Zeichen — aus `RE-{jahr}-{nr}`
   * wuerde `RE-2027-`, eine Rechnungsnummer ohne Nummer, und die
   * Eindeutigkeit traefe erst die zweite Rechnung des Jahres. Gefunden hat
   * das der Vektorvergleich gegen `formatiereNummer()`; genau dafuer gibt es
   * ihn.
   */
  v_ergebnis := regexp_replace(v_ergebnis, '\{nr(?::\d+)?\}',
                               case when v_breite > 0
                                    then lpad(p_nummer::text, v_breite, '0')
                                    else p_nummer::text end);

  if v_ergebnis like '%{jahr}%' then
    if p_jahr = 0 then
      raise exception
        'Nummernmaske % verlangt {jahr}, der Kreis laeuft aber fortlaufend (jahr = 0)', p_maske
        using errcode = 'invalid_parameter_value';
    end if;
    v_ergebnis := replace(v_ergebnis, '{jahr}', p_jahr::text);
  end if;

  if v_ergebnis ~ '\{[a-z]+' then
    raise exception 'Nummernmaske %: unbekannter Platzhalter in %', p_maske, v_ergebnis
      using errcode = 'invalid_parameter_value';
  end if;

  return v_ergebnis;
end $$;

comment on function fin.nummer_formatieren(text, bigint, integer) is
  'Die SQL-Haelfte der Maskenaufloesung. Gegen formatiereNummer() in '
  'services/finanz/nummernkreis.ts getestet — zwei Fassungen ohne Vergleich '
  'waeren zwei Nummernformate.';

-- ---------------------------------------------------------------------------
-- 6. Aufruf A — fin.rechnung_nummer_ziehen (§5.6 Schritte 1-6)
-- ---------------------------------------------------------------------------

create function fin.rechnung_nummer_ziehen(p_rechnung uuid, p_bericht jsonb)
returns table (nummer text, nummer_laufend bigint, nummernkreis_id uuid,
               kette_position bigint, rechnungsdatum date)
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  r          record;
  v_kreis    record;
  v_mandant  uuid := app.aktiver_mandant();
  v_heute    date := app.berlin_heute();
  v_jahr     integer := extract(year from v_heute)::integer;
  v_kreis_id uuid;
  v_nummer   bigint;
  v_text     text;
  v_code     text;
  v_klein    boolean := false;
  v_ziel     integer;
begin
  -- 1. Die Rechnung. Der Aufrufer haelt sie bereits gesperrt (§5.6 Schritt 1).
  select * into r from public.rechnung where id = p_rechnung;
  if not found then
    raise exception 'Rechnung % existiert nicht oder ist nicht sichtbar', p_rechnung
      using errcode = 'no_data_found';
  end if;

  -- Die zwei Pruefungen ausdruecklich gegen die Sitzungs-GUCs, nicht ueber
  -- einen Invoker-Helfer: ein Definer, der sich auf den Aufrufer verlaesst,
  -- prueft nichts (§5.6, 01-KERN §3.2).
  if r.mandant_id is distinct from v_mandant then
    raise exception 'Rechnung % gehoert nicht zum aktiven Mandanten (Invariante 3)', p_rechnung
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('finanzen.festschreiben', r.mandant_id) then
    raise exception 'finanzen.festschreiben fehlt' using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'entwurf' then
    raise exception 'Rechnung % ist bereits % — festgeschrieben wird genau einmal', p_rechnung, r.status
      using errcode = 'restrict_violation';
  end if;

  /**
   * §4.2: das Zahlungsziel hat KEINEN Default, und ein erfundener setzte
   * `faellig_am` auf jeder Rechnung, triebe den Mahnlauf und die
   * §288-BGB-Zinsen. Fehlt es, wird nicht geschaetzt, sondern abgewiesen —
   * und die Meldung nennt die drei Stellen, an denen es stehen kann.
   */
  v_ziel := r.zahlungsziel_tage;
  if v_ziel is null then
    raise exception
      'Rechnung %: kein Zahlungsziel hinterlegt — ohne Faelligkeit geht kein Beleg hinaus',
      p_rechnung
      using errcode = 'restrict_violation',
            hint = 'Zu setzen in vertrag_abrechnung.zahlungsziel_tage, in '
                   'kunde.zahlungsziel_tage oder in der Einstellung '
                   'finanzen.zahlungsziel_tage_standard (O-66).';
  end if;

  /**
   * 2. Der Kreis auf dem OFFENEN Schluessel — NIE ueber das heutige Jahr.
   *
   * Das ist die Falle, die §5.6 ausdruecklich benennt: ein Kreis mit
   * `zuruecksetzung = 'nie'` traegt `jahr = 0`; eine Suche nach
   * `jahr = 2026` findet ihn nicht, und die Festschreibung scheitert fuer
   * jede Gesellschaft, die ueber Jahre durchnummeriert — also fuer eine der
   * zwei Antworten, die O-134 haben kann.
   */
  select nk.* into v_kreis
    from public.nummernkreis nk
   where nk.mandant_id = v_mandant
     and nk.kreis_typ = 'ausgangsrechnung'
     and nk.kontext_id is null
     and nk.geschlossen_am is null;

  if not found then
    /**
     * O-01. Eine Abteilung stellt keine Rechnungen aus: `nummernkreis`
     * verlangt beim Anlegen `mandant.eigener_nummernkreis = true` (0006,
     * TEN-02), und solange fuer CSE Operations niemand entschieden hat, ob es
     * eine GmbH oder eine Abteilung ist, gibt es dort keinen Kreis. Die
     * Meldung sagt das, statt „nicht gefunden" zu sagen.
     * // TODO(client, O-01): Ist CSE Operations eine GmbH mit eigenem
     * Rechnungskreis oder eine Abteilung, die ueber eine der drei
     * Gesellschaften fakturiert?
     */
    if not exists (select 1 from public.mandant m
                    where m.id = v_mandant and m.eigener_nummernkreis) then
      raise exception 'Rechnungskreis für % nicht freigegeben',
        (select m.name from public.mandant m where m.id = v_mandant)
        using errcode = 'restrict_violation',
              hint = 'O-01 ist offen: eine Abteilung fakturiert ueber eine der drei '
                     'Gesellschaften, nicht unter eigener Nummer.';
    end if;
    raise exception 'Kein offener Rechnungsnummernkreis in dieser Gesellschaft (FIN-03)'
      using errcode = 'no_data_found',
            hint = 'Anzulegen unter Finanzen → Nummernkreise, mit Maske und '
                   'Ruecksetzungsregel (O-134).';
  end if;

  if v_kreis.ist_platzhalter then
    raise exception
      'Nummernkreis %: noch ein Platzhalter — Maske und Ruecksetzung sind unbestaetigt (O-134)',
      v_kreis.bezeichnung
      using errcode = 'restrict_violation',
            hint = 'Eine Nummer aus einem unbestaetigten Kreis waere eine erfundene.';
  end if;
  if not v_kreis.lueckenlos then
    raise exception 'Nummernkreis %: eine Rechnungsnummer muss lueckenlos sein (§14 Abs. 4 Nr. 4 UStG)',
      v_kreis.bezeichnung using errcode = 'restrict_violation';
  end if;

  /**
   * Die Ruecksetzungsregel — und der Jahreswechsel, an dem sie greift.
   *
   * `nie`       ⇒ jahr = 0, fortlaufend ueber Jahre.
   * `jaehrlich` ⇒ jahr = das laufende Jahr.
   *
   * **Den Nachfolgekreis eroeffnet diese Funktion NICHT, und das ist eine
   * Entscheidung gegen den Wortlaut von §5.6.** Sie kann es nicht: den
   * Vorgaenger zu schliessen ist ein UPDATE auf `nummernkreis`, und der
   * Ausloeser `fin.nummernkreis_pruefen()` aus `0006` laesst jedem, der nur
   * `nummernkreis.ziehen` haelt, ausschliesslich den Zaehler und den
   * Kettenkopf — alles andere, `geschlossen_am` eingeschlossen, verlangt
   * `nummernkreis.verwalten`. Diese Funktion laeuft zwar als `cse_definer`,
   * aber `app.hat_recht` fragt nach dem angemeldeten MENSCHEN, und eine
   * Leitung, die festschreibt, haelt `verwalten` nicht.
   *
   * Die drei denkbaren Auswege sind alle schlechter: dem Festschreibenden
   * `nummernkreis.verwalten` geben hiesse, jedem Rechnungsschreiber die Maske
   * seiner Gesellschaft zu oeffnen; den Ausloeser aufweichen hiesse, den
   * Geltungsbereich eines Kreises nach der ersten Nummer wieder beweglich zu
   * machen (LEG-01); und es stillschweigend zu unterlassen hiesse, am
   * 2. Januar eine Kette zu beginnen, die an keiner haengt.
   *
   * Also: eine BENANNTE Ablehnung, die den Verwaltungsakt nennt. Das Eroeffnen
   * eines Nachfolgekreises ist ohnehin ein Akt mit rechtlicher Wirkung — er
   * kopiert den Kettenkopf in `genesis_hash` und macht damit die Kette ueber
   * die Jahresgrenze zu EINER Linie (§5.4). Ohne diese Kopie beginnt jedes
   * Jahr eine frische Kette, und dann liesse sich ein ganzes Geschaeftsjahr
   * entfernen, waehrend das Folgejahr sauber weiterverifiziert — der
   * wertvollste Manipulationsfall, unsichtbar gemacht.
   */
  if v_kreis.zuruecksetzung = 'nie' and v_kreis.jahr <> 0 then
    raise exception 'Nummernkreis %: fortlaufend, aber jahr = % statt 0',
      v_kreis.bezeichnung, v_kreis.jahr using errcode = 'restrict_violation';
  end if;

  if v_kreis.zuruecksetzung = 'jaehrlich' and v_kreis.jahr <> v_jahr then
    raise exception
      'Nummernkreis % traegt das Jahr %, heute ist % — es fehlt der Nachfolgekreis',
      v_kreis.bezeichnung, v_kreis.jahr, v_jahr
      using errcode = 'restrict_violation',
            hint = 'Unter Finanzen → Nummernkreise schliesst jemand mit '
                   'nummernkreis.verwalten den Kreis und eroeffnet den Nachfolger; '
                   'dabei wird letzter_hash als genesis_hash uebernommen, damit die '
                   'Kette ueber die Jahresgrenze EINE Linie bleibt (§5.4).';
  end if;

  v_kreis_id := v_kreis.id;

  /**
   * 3. DIE SPERRE. Sie serialisiert diesen Kreis bis zum COMMIT — also sind
   * Nummernfolge und Kettenreihenfolge dieselbe Reihenfolge, und zwei
   * gleichzeitige Festschreibungen reihen sich, statt sich zu verschraenken.
   *
   * Erneut gelesen, weil zwischen Diagnose und Sperre eine andere
   * Transaktion den Zaehler bewegt haben kann: die GESPERRTE Zeile ist die
   * massgebliche, nicht die diagnostizierte.
   */
  select nk.* into v_kreis from public.nummernkreis nk where nk.id = v_kreis_id for update;
  if not found then
    raise exception 'Nummernkreis % ist fuer die Festschreibung nicht sperrbar', v_kreis_id
      using errcode = 'insufficient_privilege';
  end if;
  if v_kreis.geschlossen_am is not null then
    raise exception 'Nummernkreis %: geschlossen seit %, vergibt keine Nummern mehr',
      v_kreis.bezeichnung, v_kreis.geschlossen_am using errcode = 'restrict_violation';
  end if;

  -- 4. Ziehen und um genau eins weiterbewegen.
  v_nummer := v_kreis.naechste_nummer;
  update public.nummernkreis
     set naechste_nummer = naechste_nummer + 1
   where id = v_kreis.id;

  -- 5. Die Maske.
  v_text := fin.nummer_formatieren(v_kreis.format_maske, v_nummer, v_kreis.jahr);

  /**
   * UNTDID 1001 (BT-3), abgeleitet und eingefroren. Die Abbildung steht hier
   * und nicht im Renderer: der Renderer liest die eingefrorene Spalte, sonst
   * ergaeben zwei Ausgaben derselben Rechnung nach einer Codelistenpflege
   * zwei verschiedene Dokumente.
   */
  v_code := case r.rechnungsart
              when 'abschlag'  then '386'
              when 'anzahlung' then '386'
              when 'storno'    then '384'
              else '380'
            end;

  /**
   * FIN-13, und zwar nur gegen eine BESTAETIGTE Schwelle. Solange
   * `kleinbetrag_grenze` ein Platzhalter ist (O-175), bleibt
   * `ist_kleinbetrag` falsch — eine Kleinbetragsrechnung auszustellen, ohne
   * dass jemand entschieden hat, ob die Gruppe das ueberhaupt tut, waere eine
   * erfundene Geschaeftsregel. Die vollstaendige §14-Pruefung kommt mit
   * PR 47.
   */
  select abs(r.brutto_cent) <= g.grenze_brutto_cent into v_klein
    from public.kleinbetrag_grenze g
   where not g.ist_platzhalter
     and v_heute >= g.gueltig_von
     and (g.gueltig_bis is null or v_heute <= g.gueltig_bis)
   order by g.gueltig_von desc
   limit 1;

  -- 6. Der Kopf. Genau die Spalten, auf die der Definer einen Grant haelt.
  update public.rechnung
     set status              = 'festgeschrieben',
         nummernkreis_id     = v_kreis.id,
         nummer              = v_text,
         nummer_laufend      = v_nummer,
         rechnungsdatum      = v_heute,
         rechnungsart_code   = v_code,
         faellig_am          = v_heute + v_ziel,
         ist_kleinbetrag     = coalesce(v_klein, false),
         festgeschrieben_am  = now(),
         festgeschrieben_von = app.aktueller_benutzer()
   where id = p_rechnung;

  if not found then
    /**
     * Der Ausfall, den §1.1 beschreibt: unter FORCE RLS trifft ein UPDATE
     * ohne passende Policy NULL Zeilen — geraeuschlos. Ohne diese Pruefung
     * gaebe die Funktion eine Nummer zurueck, die auf keiner Rechnung steht.
     */
    raise exception
      'Rechnung % wurde von keiner Policy erreicht — die Festschreibung hat nichts geschrieben',
      p_rechnung using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere('rechnung.festgeschrieben', 'rechnung', p_rechnung::text,
                            null, jsonb_build_object('nummer', v_text,
                                                     'nummer_laufend', v_nummer,
                                                     'bericht', p_bericht),
                            r.mandant_id);

  return query select v_text, v_nummer, v_kreis.id, v_nummer, v_heute;
end $$;

alter function fin.rechnung_nummer_ziehen(uuid, jsonb) owner to cse_definer;
revoke execute on function fin.rechnung_nummer_ziehen(uuid, jsonb) from public;
grant execute on function fin.rechnung_nummer_ziehen(uuid, jsonb) to cse_app;

comment on function fin.rechnung_nummer_ziehen(uuid, jsonb) is
  'FIN-03 §5.6 Aufruf A: Kreis aufloesen, sperren, Nummer ziehen, Kopf stempeln. '
  'Die Sperre wird bis zum COMMIT gehalten — Aufruf B laeuft in derselben Transaktion.';

-- ---------------------------------------------------------------------------
-- 7. Aufruf B — fin.rechnung_kette_schreiben (§5.6 Schritte 7-9)
-- ---------------------------------------------------------------------------

/**
 * **Die Anwendung liefert das Dokument, die Datenbank liefert die Kette.**
 *
 * Diese Funktion uebernimmt die kanonischen Bytes und rechnet beide Digests
 * SELBST — aus den Bytes und aus dem Kettenkopf des Kreises, den Aufruf A
 * noch gesperrt haelt. Sie nimmt keinen Hash entgegen: ein Aufrufer, der den
 * Hash mitschickt, kann ihn auch waehlen.
 *
 * Und sie prueft, dass die Bytes zu DIESER Rechnung gehoeren — `nummer` und
 * `kette_position` aus der Nutzlast gegen die gespeicherten Werte. Ohne diese
 * Pruefung liesse sich die Nutzlast einer anderen Rechnung einreichen, und
 * die Kette bezeugte danach ein Dokument, das niemand ausgestellt hat.
 */
create function fin.rechnung_kette_schreiben(
  p_rechnung uuid, p_nutzlast_bytes bytea, p_nutzlast jsonb, p_bericht jsonb,
  p_schema_version text, p_regelwerk_version text)
returns text
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  r         record;
  v_kreis   record;
  v_vorher  text;
  v_nutzlast_sha text;
  v_hash    text;
  v_mandant uuid := app.aktiver_mandant();
begin
  select * into r from public.rechnung where id = p_rechnung;
  if not found then
    raise exception 'Rechnung % existiert nicht oder ist nicht sichtbar', p_rechnung
      using errcode = 'no_data_found';
  end if;
  if r.mandant_id is distinct from v_mandant then
    raise exception 'Rechnung % gehoert nicht zum aktiven Mandanten (Invariante 3)', p_rechnung
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('finanzen.festschreiben', r.mandant_id) then
    raise exception 'finanzen.festschreiben fehlt' using errcode = 'insufficient_privilege';
  end if;

  -- 7. Die Voraussetzungen.
  if r.status <> 'festgeschrieben' then
    raise exception 'Rechnung %: die Kette wird nach dem Festschreiben geschrieben, nicht davor',
      p_rechnung using errcode = 'restrict_violation';
  end if;
  if p_nutzlast ->> 'nummer' is distinct from r.nummer
     or (p_nutzlast ->> 'kette_position')::bigint is distinct from r.nummer_laufend then
    raise exception
      'Die eingereichte Nutzlast gehoert zu Rechnung %/% und nicht zu %/%',
      p_nutzlast ->> 'nummer', p_nutzlast ->> 'kette_position', r.nummer, r.nummer_laufend
      using errcode = 'restrict_violation';
  end if;
  if p_schema_version is null or p_schema_version = '' then
    raise exception 'schema_version fehlt — ohne sie waehlt der Pruefer keinen Kanonisierer'
      using errcode = 'invalid_parameter_value';
  end if;

  /**
   * „Genau einmal" steht im INDEX, nicht in einer Vorabfrage.
   *
   * Ein `if exists (…)` davor waere Pruefen-dann-Handeln und damit ein Rennen:
   * zwei gleichzeitige Aufrufe saehen beide nichts und schrieben beide. Die
   * Eindeutigkeitsbedingung entscheidet, der Ausnahmezweig uebersetzt sie in
   * eine Meldung, die ein Mensch lesen kann. Nebenbei braucht `cse_definer`
   * dadurch auf diesen zwei Tabellen gar keine Lesepolicy.
   */
  begin
    insert into public.rechnung_snapshot
      (rechnung_id, mandant_id, schema_version, nutzlast_bytes, nutzlast,
       pflichtfeld_pruefung, regelwerk_version, erzeugt_von, aufbewahrung_bis)
    values
      (p_rechnung, r.mandant_id, p_schema_version, p_nutzlast_bytes, p_nutzlast,
       coalesce(p_bericht, '{}'::jsonb), p_regelwerk_version,
       coalesce(r.festgeschrieben_von, app.aktueller_benutzer()), r.aufbewahrung_bis);
  exception when unique_violation then
    raise exception 'Rechnung % traegt bereits einen Snapshot — festgeschrieben wird einmal',
      coalesce(r.nummer, p_rechnung::text) using errcode = 'unique_violation';
  end;

  /**
   * 8. Der Kettenkopf. `letzter_hash` ist der Kopf DIESES Kreises;
   * `genesis_hash` der letzte Hash des Vorgaengerkreises, beim Eroeffnen
   * kopiert; 64 Nullen nur fuer die allererste Rechnung einer Gesellschaft.
   * Die Reihenfolge des `coalesce` ist die Kette selbst.
   */
  select nk.* into v_kreis from public.nummernkreis nk where nk.id = r.nummernkreis_id;
  v_vorher := coalesce(v_kreis.letzter_hash, v_kreis.genesis_hash, repeat('0', 64));

  v_nutzlast_sha := encode(sha256(p_nutzlast_bytes), 'hex');
  /**
   * `\x1e` — der ASCII-Datensatztrenner. Er ist Teil des Digests, nicht
   * Formatierung: ohne ihn sind Nutzlast und Vorgaenger nicht eindeutig
   * voneinander abgegrenzt, und zwei verschiedene Paare koennen dieselben
   * verketteten Bytes ergeben.
   *
   * Und `decode(v_vorher,'hex')` — die 32 ROHEN Bytes, nicht der Hextext. Ein
   * Digest ueber den Hextext waere ein anderer und verifizierte gegen die
   * TypeScript-Seite nicht, die es richtig macht.
   */
  v_hash := encode(sha256(p_nutzlast_bytes || '\x1e'::bytea || decode(v_vorher, 'hex')), 'hex');

  begin
    insert into public.rechnung_hash
      (rechnung_id, mandant_id, nummernkreis_id, kette_position, vorheriger_hash,
       nutzlast_sha256, hash)
    values
      (p_rechnung, r.mandant_id, r.nummernkreis_id, r.nummer_laufend, v_vorher,
       v_nutzlast_sha, v_hash);
  exception when unique_violation then
    /**
     * `rh_vorgaenger_uk` ist der interessante Fall: zwei Rechnungen koennen
     * nicht denselben Vorgaenger beanspruchen. Ein Nebenlaeufigkeitsfehler
     * wird damit zu einer Eindeutigkeitsverletzung statt zu einem stillen
     * Ast, den erst der naechtliche Lauf Wochen spaeter findet.
     */
    raise exception
      'Kette in Kreis %: Position % oder Vorgaenger % ist bereits belegt (FIN-06)',
      r.nummernkreis_id, r.nummer_laufend, v_vorher
      using errcode = 'unique_violation',
            hint = 'Zwei Festschreibungen haben sich verschraenkt. Das darf die '
                   'Zeilensperre auf dem Nummernkreis nicht zulassen.';
  end;

  -- 9. Derselbe, noch immer gesperrte Kreis — keine zweite Sperre.
  update public.nummernkreis set letzter_hash = v_hash where id = r.nummernkreis_id;
  if not found then
    raise exception 'Der Kettenkopf des Kreises % wurde von keiner Policy erreicht',
      r.nummernkreis_id using errcode = 'insufficient_privilege';
  end if;

  return v_hash;
end $$;

alter function fin.rechnung_kette_schreiben(uuid, bytea, jsonb, jsonb, text, text)
  owner to cse_definer;
revoke execute on function fin.rechnung_kette_schreiben(uuid, bytea, jsonb, jsonb, text, text)
  from public;
grant execute on function fin.rechnung_kette_schreiben(uuid, bytea, jsonb, jsonb, text, text)
  to cse_app;

comment on function fin.rechnung_kette_schreiben(uuid, bytea, jsonb, jsonb, text, text) is
  'FIN-06 §5.6 Aufruf B: Snapshot ablegen, beide Digests SELBST rechnen, Kettenkopf '
  'fortschreiben. Nimmt keinen Hash entgegen — wer ihn mitschickt, kann ihn waehlen.';

-- ---------------------------------------------------------------------------
-- 8. Eine festgeschriebene Rechnung ohne Kette ist unmoeglich (§5.6)
-- ---------------------------------------------------------------------------

create function fin.rechnung_verkettet() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_r record;
begin
  /**
   * Auch hier wird die Zeile NEU GELESEN. `NEW` ist der Stand der
   * ausloesenden Anweisung, nicht der beim COMMIT — und die Festschreibung
   * besteht aus mehreren Anweisungen. Geprueft werden soll der Stand am Ende
   * der Transaktion, und der steht in der Tabelle.
   */
  select r.id, r.status, r.nummer into v_r from public.rechnung r where r.id = new.id;
  if not found or v_r.status <> 'festgeschrieben' then
    return null;
  end if;
  if not exists (select 1 from public.rechnung_snapshot s where s.rechnung_id = v_r.id) then
    raise exception 'Rechnung % ist festgeschrieben, hat aber keinen Snapshot (FIN-06)',
      coalesce(v_r.nummer, v_r.id::text)
      using errcode = 'restrict_violation',
            hint = 'Die Festschreibung hat nach Aufruf A aufgehoert. Es gibt zwei '
                   'Ausgaenge: eine vollstaendig verkettete Rechnung, oder gar keine.';
  end if;
  if not exists (select 1 from public.rechnung_hash h where h.rechnung_id = v_r.id) then
    raise exception 'Rechnung % ist festgeschrieben, hat aber kein Kettenglied (FIN-06, LEG-01)',
      coalesce(v_r.nummer, v_r.id::text)
      using errcode = 'restrict_violation';
  end if;
  return null;
end $$;

create constraint trigger rechnung_verkettet
  after insert or update on rechnung
  deferrable initially deferred
  for each row execute function fin.rechnung_verkettet();

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0077)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- rechnung_snapshot (append): FIN-06, LEG-01, ACC-06. Der Snapshot IST das Dokument; PDF und XRechnung werden aus ihm erzeugt, nie aus lebenden Stammdaten. Ohne ihn verifiziert die Kette gegen nichts.
create trigger trg_rechnung_snapshot_kein_hard_delete
  before delete on rechnung_snapshot
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_snapshot_kein_truncate
  before truncate on rechnung_snapshot
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_snapshot from cse_app, cse_anon, cse_checkin, cse_job;

-- rechnung_hash (append): FIN-06, LEG-01. Ein fehlendes Glied ist genau die Manipulation, gegen die die Kette geschrieben ist. Eine geleerte Kettentabelle laesst den naechtlichen Lauf eine LEERE Kette melden statt einer gebrochenen — und das liest sich wie „nichts zu pruefen".
create trigger trg_rechnung_hash_kein_hard_delete
  before delete on rechnung_hash
  for each row execute function kern.verhindere_loeschung();
create trigger trg_rechnung_hash_kein_truncate
  before truncate on rechnung_hash
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on rechnung_hash from cse_app, cse_anon, cse_checkin, cse_job;


create trigger trg_rechnung_hash_audit
  after insert or update or delete on rechnung_hash
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
