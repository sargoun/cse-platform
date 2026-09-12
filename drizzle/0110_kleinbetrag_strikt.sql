/**
 * Die Kleinbetragsgrenze galt an drei Stellen und an einer davon anders.
 *
 * `ustg14.ts` (`kleinbetragLage`) und `fin.kleinbetrag_greift` (0104) pruefen
 * `brutto < grenze` — die STRENGERE der beiden Lesarten, und zwar bewusst:
 * SPEC FIN-13 sagt „< €250", §33 UStDV sagt „nicht uebersteigt", und bei genau
 * 250,00 EUR gehen sie um einen Cent auseinander (D-322, O-301). Eine Rechnung
 * mit vollstaendigen Empfaengerangaben ist nie rechtswidrig; eine zu Unrecht
 * als Kleinbetrag ausgestellte schon.
 *
 * `fin.rechnung_nummer_ziehen` (0077) friert `ist_kleinbetrag` dagegen mit
 * `<=` ein. Bei GENAU der Schwelle liess die Vorpruefung den Beleg also nur
 * mit vollstaendiger Empfaengeranschrift durch — und schrieb ihm im selben
 * Vorgang dauerhaft „Kleinbetrag" auf die Stirn. Der Beleg widerspricht damit
 * der Pruefung, die ihn durchgelassen hat, und das ist nach dem Festschreiben
 * nicht mehr zu aendern: die Korrektur waere Storno plus Neuausstellung.
 *
 * Gefunden hat es der Copilot-Durchgang auf PR #7. Auffallen konnte es nicht:
 * beide Seiten sind fuer sich stimmig, der Unterschied betrifft genau einen
 * Cent-Wert, und kein Test lag darauf.
 *
 * **Die Funktion wird unveraendert uebernommen — bis auf dieses eine Zeichen.**
 * Sie ist 248 Zeilen lang; sie neu zu schreiben hiesse, 247 Zeilen zu
 * riskieren, um eine zu korrigieren. Der Rumpf ist woertlich der aus 0077,
 * erweitert nur um den Kommentar an der geaenderten Stelle.
 */
create or replace function fin.rechnung_nummer_ziehen(p_rechnung uuid, p_bericht jsonb)
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
   * erfundene Geschaeftsregel.
   *
   * **`<` und nicht `<=` (0110).** Hier stand `<=`, waehrend `ustg14.ts` und
   * `fin.kleinbetrag_greift` (0104) mit `<` rechnen. Bei GENAU der Schwelle
   * gingen die drei auseinander: die Vorpruefung verlangte die vollen
   * §14-Angaben, und derselbe Beleg trug danach dauerhaft das Kennzeichen
   * „Kleinbetrag". Ein unveraenderlicher Beleg, der seiner eigenen Pruefung
   * widerspricht, ist der teuerste Fall — korrigierbar waere er nur durch
   * Storno und Neuausstellung. D-322 nennt die Auslegung; sie gilt jetzt an
   * allen drei Stellen.
   */
  select abs(r.brutto_cent) < g.grenze_brutto_cent into v_klein
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
