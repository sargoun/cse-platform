-- ===========================================================================
-- 0076 — Unveraenderlichkeit: die zwei Uebergaenge, der unbedingte
--        Aenderungsschutz, die Kindsperre und die aufgeschobene
--        Summenpruefung (Invariante 4, Invariante 8, FIN-02, LEG-01)
--
-- Vertrag: `docs/architecture/02-datenmodell/05-FINANZEN.md` §4.1, §4.3,
-- §4.5, §4.8, §4.9, K-12.
--
-- **Der Ausloeser hat KEINE Spaltenliste, und das ist die ganze Migration.**
--
-- Eine Erlaubnisliste in `fin.rechnung_unveraenderlich()` haette Invariante 4
-- auf Datenbankebene ohne jede Deckung gelassen: sie waechst mit jedem
-- Bedarf, der sich vernuenftig anhoert („nur `versendet_am`", „nur der
-- Storno-Verweis", „nur die Mahnstufe"), und nach dem dritten Eintrag ist
-- unveraenderlich eine Behauptung im Kommentar. Deshalb steht auf der
-- Rechnungszeile nichts, was sich nach dem Festschreiben noch aendert (0075,
-- K-12) — und deshalb kann der Vergleich hier ueber ALLE Spalten laufen.
--
-- Ausgenommen sind genau vier Namen, und jeder mit Grund:
--   · `geaendert_am`, `geaendert_von`, `geaendert_von_art` — Buchfuehrung
--     UEBER die Aenderung, nicht Inhalt der Rechnung; sie werden von
--     `kern.setze_geaendert_am()` geschrieben, bevor dieser Ausloeser laeuft.
--   · `aufbewahrung_bis` — eine abgeleitete Frist, die sich aendert, wenn der
--     Steuerberater eine Belegklasse anders einordnet (§1.10, O-25). Sie ist
--     keine Aussage ueber den Geschaeftsvorfall.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die zwei Uebergaenge — und nur sie (§4.1, FIN-02)
-- ---------------------------------------------------------------------------

/**
 * `entwurf → festgeschrieben` und `entwurf → verworfen`. Sonst nichts.
 *
 * Kein `festgeschrieben → storniert`: es gibt den Zustand nicht (0075), und
 * ein Storno ist eine eigene Rechnung mit eigener Nummer. Kein Rueckweg aus
 * `verworfen`: ein verworfener Entwurf, der wieder zum Entwurf wird, waere
 * eine geloeschte Zeile mit Umweg.
 *
 * Die Meldung nennt beide Zustaende, weil der haeufigste Auslesefehler
 * „irgendetwas mit dem Status" ist und ein Mensch danach wissen muss, WAS
 * versucht wurde.
 */
create function fin.rechnung_status_uebergang() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status = 'entwurf' and new.status in ('festgeschrieben', 'verworfen') then
    return new;
  end if;
  raise exception
    'Rechnung: Uebergang % → % gibt es nicht (FIN-02, Invariante 4)', old.status, new.status
    using errcode = 'restrict_violation',
          hint = 'Zulaessig sind entwurf→festgeschrieben und entwurf→verworfen. '
                 'Eine festgeschriebene Rechnung wird durch eine STORNORECHNUNG '
                 'aufgehoben, nicht durch einen Zustandswechsel.';
end $$;

create trigger trg_rechnung_status_uebergang
  before update on rechnung
  for each row execute function fin.rechnung_status_uebergang();

-- ---------------------------------------------------------------------------
-- 2. Der unbedingte Aenderungsschutz (§4.1, K-12, Invariante 4)
-- ---------------------------------------------------------------------------

/**
 * Er feuert fuer `verworfen` genauso wie fuer `festgeschrieben`.
 *
 * Ein verworfener Entwurf mit genanntem Grund ist ein GoBD-Satz: er bezeugt,
 * dass hier keine Rechnung entstanden ist und warum. Waere der Kopf danach
 * weiter beweglich, liesse sich der Grund nachtraeglich umschreiben — und
 * genau dieser Satz ist der, den eine Betriebspruefung liest, wenn sie nach
 * der fehlenden Nummer fragt.
 *
 * Verglichen wird ueber `to_jsonb`, nicht Spalte fuer Spalte: eine spaeter
 * hinzukommende Spalte ist damit automatisch geschuetzt. Eine ausgeschriebene
 * Liste waere am Tag der naechsten Migration unvollstaendig, ohne dass
 * irgendetwas anschlaegt.
 */
create function fin.rechnung_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_alt  jsonb;
  v_neu  jsonb;
  v_feld text;
begin
  if old.status = 'entwurf' then
    return new;
  end if;

  v_alt := to_jsonb(old) - 'geaendert_am' - 'geaendert_von' - 'geaendert_von_art'
                         - 'aufbewahrung_bis';
  v_neu := to_jsonb(new) - 'geaendert_am' - 'geaendert_von' - 'geaendert_von_art'
                         - 'aufbewahrung_bis';

  if v_alt = v_neu then
    return new;
  end if;

  -- Das ERSTE abweichende Feld benennen. „Die Rechnung ist unveraenderlich"
  -- allein laesst den Aufrufer raten, welcher seiner Werte der verbotene war.
  select k into v_feld
    from jsonb_object_keys(v_neu) k
   where v_alt -> k is distinct from v_neu -> k
   order by k
   limit 1;

  raise exception
    'Rechnung %: festgeschriebene und verworfene Belege sind unveraenderlich — % wurde geaendert (Invariante 4, LEG-01)',
    coalesce(old.nummer, old.id::text), coalesce(v_feld, '<Spalte entfernt>')
    using errcode = 'restrict_violation',
          hint = 'Korrigiert wird durch STORNO und Neuausstellung (rechnung_beziehung), '
                 'nie durch Aenderung. Der Versand steht in rechnung_versand.';
end $$;

/**
 * Der Name beginnt mit `trg_rechnung_u`, also laeuft dieser Ausloeser nach
 * `trg_rechnung_aufbewahrung`, `trg_rechnung_geaendert_am` und
 * `trg_rechnung_status_uebergang` — PostgreSQL feuert BEFORE-Ausloeser in
 * ALPHABETISCHER Reihenfolge. Das ist Absicht: die drei davor schreiben
 * genau die Felder, die der Vergleich ausnimmt, und der Vergleich sieht
 * deshalb den Zustand, den der Aufrufer wirklich wollte.
 */
create trigger trg_rechnung_unveraenderlich
  before update on rechnung
  for each row execute function fin.rechnung_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 3. Die Kindsperre (§4.3, §4.5)
-- ---------------------------------------------------------------------------

/**
 * Positionen, Zu- und Abschlaege und die Steueraufschluesselung sind
 * beweglich, solange der KOPF ein Entwurf ist — und ab dem Festschreiben
 * gar nicht mehr.
 *
 * Ohne diese Sperre waere die Rechnungszeile unveraenderlich und ihr Inhalt
 * nicht: jemand koennte eine Position einer festgeschriebenen Rechnung
 * umschreiben, die Kopfsummen blieben stehen, und die aufgeschobene
 * Summenpruefung schluege erst beim naechsten Anfassen des Kopfes an — also
 * womoeglich nie.
 *
 * `security definer`, und zwar aus einem konkreten Grund: der Ausloeser laeuft
 * sonst als der Aufrufer, und in der Festschreibungstransaktion ist das
 * zeitweise `cse_definer`, der auf `rechnung` nur die schmale Policy von
 * 0077 haelt. Ein Lesezugriff auf den Kopf traefe dann null Zeilen und die
 * Sperre liesse alles durch — geraeuschlos.
 */
create function fin.kind_unveraenderlich() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_rechnung uuid := case when tg_op = 'DELETE' then old.rechnung_id else new.rechnung_id end;
  v_status   rechnung_status;
  v_nummer   text;
begin
  select r.status, r.nummer into v_status, v_nummer
    from public.rechnung r where r.id = v_rechnung;

  if v_status is null then
    raise exception 'Rechnung % existiert nicht', v_rechnung using errcode = 'foreign_key_violation';
  end if;
  if v_status = 'entwurf' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'Rechnung %: % ist Teil eines %en Belegs und unveraenderlich (Invariante 4)',
    coalesce(v_nummer, v_rechnung::text), tg_table_name, v_status
    using errcode = 'restrict_violation',
          hint = 'Korrigiert wird durch Storno und Neuausstellung, nie durch Aenderung '
                 'an den Positionen.';
end $$;

create trigger trg_rp_kind_unveraenderlich
  before insert or update or delete on rechnungsposition
  for each row execute function fin.kind_unveraenderlich();
create trigger trg_rz_kind_unveraenderlich
  before insert or update or delete on rechnung_zuschlag
  for each row execute function fin.kind_unveraenderlich();
create trigger trg_rs_kind_unveraenderlich
  before insert or update or delete on rechnung_steuer
  for each row execute function fin.kind_unveraenderlich();

/**
 * `rechnung_beziehung` traegt diese Sperre ausdruecklich NICHT.
 *
 * Sie entsteht NACH dem Festschreiben — das ist der Grund, warum K-12 sie als
 * eigene Tabelle verlangt. Mit der Kindsperre waere sie nie schreibbar, und
 * ein Storno waere unaufzeichenbar.
 */

-- ---------------------------------------------------------------------------
-- 4. Was eine Beziehung sein darf (§4.8)
-- ---------------------------------------------------------------------------

/**
 * Beide Rechnungen festgeschrieben, derselbe Mandant, derselbe Kunde — und
 * beim Vollstorno spiegeln sich die Betraege exakt, JE STEUERGRUPPE.
 *
 * „Je Steuergruppe" und nicht „in der Summe": zwei Gruppen, deren Summen sich
 * aufheben, waeren in der Umsatzsteuervoranmeldung zwei falsche Zeilen, die
 * zusammen null ergeben. Die Voranmeldung meldet aber die Zeilen, nicht die
 * Summe.
 */
create function fin.rechnung_beziehung_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare
  v_von record;
  v_zu  record;
  v_abweichung record;
begin
  select r.status, r.mandant_id, r.kunde_id, r.rechnungsart, r.nummer
    into v_von from public.rechnung r where r.id = new.von_rechnung_id;
  select r.status, r.mandant_id, r.kunde_id, r.rechnungsart, r.nummer
    into v_zu  from public.rechnung r where r.id = new.zu_rechnung_id;

  if v_von.status is distinct from 'festgeschrieben'
     or v_zu.status is distinct from 'festgeschrieben' then
    raise exception 'rechnung_beziehung: beide Belege muessen festgeschrieben sein'
      using errcode = 'restrict_violation',
            hint = 'Ein Entwurf storniert nichts — er hat noch gar keine Nummer.';
  end if;

  if v_von.mandant_id <> new.mandant_id or v_zu.mandant_id <> new.mandant_id then
    raise exception 'rechnung_beziehung: beide Belege gehoeren derselben Gesellschaft (Invariante 3)'
      using errcode = 'restrict_violation';
  end if;

  if v_von.kunde_id <> v_zu.kunde_id then
    raise exception 'rechnung_beziehung: die Belege gehoeren zwei verschiedenen Kunden'
      using errcode = 'restrict_violation';
  end if;

  if new.art = 'storno' then
    if v_von.rechnungsart <> 'storno' then
      raise exception 'rechnung_beziehung: der stornierende Beleg % traegt rechnungsart = %, nicht storno',
        coalesce(v_von.nummer, new.von_rechnung_id::text), v_von.rechnungsart
        using errcode = 'restrict_violation';
    end if;

    if new.storno_art = 'vollstorno' then
      /**
       * Der volle Aussenvergleich: jede Steuergruppe des Originals muss im
       * Storno mit genau dem negierten Netto- UND Steuerbetrag vorkommen, und
       * umgekehrt. `full join` statt `join`, weil sonst eine Gruppe, die im
       * Storno FEHLT, einfach aus dem Vergleich fiele — und das ist der
       * wahrscheinlichste Fehler, nicht der unwahrscheinlichste.
       */
      select coalesce(o.steuersatz_gruppe_id, s.steuersatz_gruppe_id) as gruppe
        into v_abweichung
        from (select steuersatz_gruppe_id, netto_cent, steuer_cent
                from public.rechnung_steuer where rechnung_id = new.zu_rechnung_id) o
        full join
             (select steuersatz_gruppe_id, netto_cent, steuer_cent
                from public.rechnung_steuer where rechnung_id = new.von_rechnung_id) s
          on s.steuersatz_gruppe_id = o.steuersatz_gruppe_id
       where o.steuersatz_gruppe_id is null
          or s.steuersatz_gruppe_id is null
          or s.netto_cent <> -o.netto_cent
          or s.steuer_cent <> -o.steuer_cent
       limit 1;

      if found then
        raise exception
          'Vollstorno: Steuergruppe % spiegelt das Original nicht exakt (§14 Abs. 4 Nr. 8 UStG)',
          v_abweichung.gruppe
          using errcode = 'restrict_violation',
                hint = 'Ein Vollstorno traegt je Steuergruppe genau den negierten Betrag. '
                       'Fuer alles andere ist O-178 offen (Teilstorno).';
      end if;
    end if;
  end if;

  return new;
end $$;

create trigger trg_rechnung_beziehung_pruefen
  before insert on rechnung_beziehung
  for each row execute function fin.rechnung_beziehung_pruefen();

/**
 * Und sie ist anfuegend: eine einmal geschriebene Beziehung aendert sich
 * nicht. Ein umgeschriebener Storno-Grund waere derselbe Verlust wie ein
 * umgeschriebener Verwerfungsgrund.
 */
create function fin.rechnung_beziehung_unveraenderlich() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'rechnung_beziehung ist anfuegend — eine Beziehung wird nicht geaendert (LEG-01)'
    using errcode = 'restrict_violation';
end $$;

create trigger trg_rechnung_beziehung_unveraenderlich
  before update on rechnung_beziehung
  for each row execute function fin.rechnung_beziehung_unveraenderlich();

-- ---------------------------------------------------------------------------
-- 5. Die aufgeschobene Summenpruefung (§4.9)
-- ---------------------------------------------------------------------------

/**
 * Aufgeschoben, weil die Festschreibungstransaktion Kopf und Kinder in EINER
 * Anweisungsfolge schreibt: ein sofortiger Ausloeser feuerte dazwischen und
 * wiese eine Rechnung zurueck, die am Ende der Transaktion stimmt.
 *
 * Geprueft wird gegen die KINDER, nicht gegen sich selbst. Die CHECKs auf der
 * Zeile (0075) sichern nur die innere Stimmigkeit des Kopfes — dass
 * `brutto = netto + steuer` und `zahlbetrag = brutto − abzug`. Sie koennen
 * nicht sehen, ob `netto_gesamt_cent` ueberhaupt die Summe der Positionen
 * ist, und genau das ist die Zahl, die auf dem Papier steht.
 *
 * Drei der vier Summen des §4.9 stehen hier. Die dritte —
 * `abzug_brutto_cent` gegen `abschlagsrechnung_bezug` — kommt mit PR 48, der
 * diese Tabelle bringt; bis dahin bleibt `abzug_brutto_cent` null, und der
 * CHECK auf der Zeile haelt `zahlbetrag = brutto`. Die Luecke steht hier als
 * Kommentar und nicht als stillschweigende Auslassung.
 */
create function fin.rechnung_summen_stimmig() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_r                  record;
  v_netto_positionen   bigint;
  v_zuschlaege         bigint;
  v_netto_soll         bigint;
  v_steuer_summe       bigint;
  v_netto_steuerzeilen bigint;
  v_gruppe             uuid;
begin
  /**
   * **Die Zeile wird NEU GELESEN, nicht aus `NEW` genommen** — und das ist der
   * Unterschied zwischen einer Pruefung und einer Fehlmeldung.
   *
   * Ein aufgeschobener Ausloeser feuert zwar erst beim COMMIT, aber `NEW` ist
   * der Stand DER AUSLOESENDEN ANWEISUNG. Beim Anlegen eines Entwurfs ist das
   * `netto_gesamt_cent = 0`; kommt in derselben Transaktion eine Position
   * hinzu, meldete genau dieses eine aufgeschobene Ereignis beim COMMIT
   * „0 gegen 10000" — obwohl der Kopf laengst stimmt. §4.9 meint den Stand
   * BEIM COMMIT, und der steht in der Tabelle, nicht im Ereignis.
   */
  select r.* into v_r from public.rechnung r where r.id = new.id;
  if not found then
    return null;
  end if;

  -- Eine `zwischensumme` ist reine Anzeige und faellt heraus; eine
  -- `textzeile` traegt ohnehin keinen Betrag.
  select coalesce(sum(p.netto_cent), 0) into v_netto_positionen
    from public.rechnungsposition p
   where p.rechnung_id = v_r.id and p.positionsart = 'leistung';

  -- Σ Zuschlag − Σ Nachlass. `betrag_cent` ist immer positiv, `art` traegt
  -- das Vorzeichen (0075) — genau deshalb steht die Fallunterscheidung hier
  -- und nicht in den Daten.
  select coalesce(sum(case when z.art = 'zuschlag' then z.betrag_cent
                           else -z.betrag_cent end), 0)
    into v_zuschlaege
    from public.rechnung_zuschlag z where z.rechnung_id = v_r.id;

  v_netto_soll := v_netto_positionen + v_zuschlaege;

  if v_r.netto_gesamt_cent <> v_netto_soll then
    raise exception
      'Rechnung %: netto_gesamt_cent ist %, die Positionen und Zuschlaege ergeben % (§4.9)',
      coalesce(v_r.nummer, v_r.id::text), v_r.netto_gesamt_cent, v_netto_soll
      using errcode = 'restrict_violation';
  end if;

  select coalesce(sum(s.steuer_cent), 0), coalesce(sum(s.netto_cent), 0)
    into v_steuer_summe, v_netto_steuerzeilen
    from public.rechnung_steuer s where s.rechnung_id = v_r.id;

  if v_r.steuer_gesamt_cent <> v_steuer_summe then
    raise exception
      'Rechnung %: steuer_gesamt_cent ist %, die Steuerzeilen ergeben % (§14 Abs. 4 Nr. 8 UStG)',
      coalesce(v_r.nummer, v_r.id::text), v_r.steuer_gesamt_cent, v_steuer_summe
      using errcode = 'restrict_violation';
  end if;

  -- Und die Aufschluesselung muss dasselbe Netto tragen wie der Kopf, sonst
  -- weist der Beleg eine Steuer auf eine Bemessungsgrundlage aus, die er
  -- nirgends zeigt.
  if v_netto_steuerzeilen <> v_netto_soll then
    raise exception
      'Rechnung %: die Steuerzeilen tragen Netto %, Positionen und Zuschlaege ergeben % (§4.9)',
      coalesce(v_r.nummer, v_r.id::text), v_netto_steuerzeilen, v_netto_soll
      using errcode = 'restrict_violation';
  end if;

  -- Je Gruppe: das Netto der Steuerzeile IST die Summe ihrer Positionen und
  -- ihrer Zuschlaege. Ohne diese Zeile duerften sich zwei Gruppen gegenseitig
  -- ausgleichen, und die Umsatzsteuervoranmeldung traegt zwei falsche Zeilen,
  -- die zusammen null ergeben.
  select g.steuersatz_gruppe_id into v_gruppe
    from (
      select s.steuersatz_gruppe_id, s.netto_cent as gebucht,
             coalesce((select sum(p.netto_cent) from public.rechnungsposition p
                        where p.rechnung_id = v_r.id and p.positionsart = 'leistung'
                          and p.steuersatz_gruppe_id = s.steuersatz_gruppe_id), 0)
           + coalesce((select sum(case when z.art = 'zuschlag' then z.betrag_cent
                                       else -z.betrag_cent end)
                         from public.rechnung_zuschlag z
                        where z.rechnung_id = v_r.id
                          and z.steuersatz_gruppe_id = s.steuersatz_gruppe_id), 0) as gerechnet
        from public.rechnung_steuer s where s.rechnung_id = v_r.id) g
   where g.gebucht <> g.gerechnet
   limit 1;

  if found then
    raise exception
      'Rechnung %: Steuergruppe % ist mit einem anderen Netto gebucht, als ihre Zeilen ergeben (§4.9)',
      coalesce(v_r.nummer, v_r.id::text), v_gruppe
      using errcode = 'restrict_violation';
  end if;

  /**
   * Der Einbehalt in MAGNITUDEN, nicht als `<=`.
   *
   * `einbehalt <= zahlbetrag` woertlich geschrieben hebt die
   * Vorzeichenstimmigkeit von 0075 eine Datei spaeter wieder auf: auf einem
   * Storno sind beide Werte negativ, `−150 ≤ −1000` ist falsch, und der
   * Ausloeser schluege beim COMMIT genau auf der Zeile an, die eine Korrektur
   * ueberhaupt erst aufzeichnet.
   */
  if abs(v_r.einbehalt_bauabzugsteuer_cent) > abs(v_r.zahlbetrag_cent) then
    raise exception
      'Rechnung %: der Steuerabzug nach §48 EStG (%) uebersteigt den Zahlbetrag (%)',
      coalesce(v_r.nummer, v_r.id::text),
      v_r.einbehalt_bauabzugsteuer_cent, v_r.zahlbetrag_cent
      using errcode = 'restrict_violation';
  end if;

  return null;
end $$;

create constraint trigger rechnung_summen_stimmig
  after insert or update on rechnung
  deferrable initially deferred
  for each row execute function fin.rechnung_summen_stimmig();

comment on function fin.rechnung_summen_stimmig() is
  '§4.9: beim COMMIT wird der Kopf gegen die Kinder nachgerechnet. Aufgeschoben, '
  'weil die Festschreibung Kopf und Kinder in einer Anweisungsfolge schreibt.';
