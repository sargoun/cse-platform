-- ===========================================================================
-- 0085 — Die §14-UStG-Pflichtfelder als BEDINGUNG, nicht als Vorsatz
--        (FIN-04, FIN-05, FIN-13, LEG-05, O-24, Invariante 4)
--
-- Vertrag: `docs/architecture/02-datenmodell/05-FINANZEN.md` §6 (der
-- Vorabpruefer), §4.1, §5.6; `04-SEITENKARTE.md` §5.14.2.
--
-- **Warum hier ueberhaupt SQL steht, obwohl der Validator TypeScript ist.**
--
-- Die Abnahme von PR 47 verlangt beides und meint zwei verschiedene Dinge:
-- der Validator ist EIN reiner Dienst, den Festschreibung, Vorschau und API
-- rufen — und ein Aufrufer, der ihn ueberspringt, kann trotzdem nicht
-- festschreiben. Das zweite kann kein TypeScript halten. `cse_app` darf
-- `fin.rechnung_nummer_ziehen` direkt aufrufen; ein Skript, ein Job, ein
-- spaeterer Dienst oder eine `psql`-Sitzung mit gueltiger Sitzung kaeme damit
-- an der Vorabpruefung vorbei. Also haelt die Datenbank die Bedingung, und
-- der Validator ist das, was einem MENSCHEN vorher sagt, welches Feld fehlt.
--
-- **Keine zweite Regelliste.** Die Meldungen unten sind absichtlich knapp und
-- die Pruefungen absichtlich strukturell: wer die Liste lesen will, liest sie
-- in `src/server/services/finanz/ustg14.ts`. Was hier steht, ist die
-- Teilmenge, die sich ohne Urteil pruefen laesst — Anwesenheit von Namen,
-- Anschrift, Steuernummer, Leistungszeile und Steueraufschluesselung. Regeln,
-- die eine Auslegung brauchen (§14b-Aufbewahrungshinweis, §13b, §48 EStG),
-- stehen NICHT hier: eine halb abgebildete Rechtsregel in einem Ausloeser ist
-- eine Behauptung, die niemand liest.
--
-- **Was schon in `0075` steht und deshalb hier NICHT wiederholt wird:**
--  · `rechnung_leistungszeitpunkt` — §14 Abs. 4 Nr. 6 UStG mit BEIDEN Zweigen
--    (Leistungszeitraum ODER `vereinnahmung_geplant_am` bei
--    `abschlag`/`anzahlung`). Die Bedingung gibt es seit PR 46; PR 47 prueft
--    sie nach, statt sie ein zweites Mal zu schreiben.
--  · `rechnung_festgeschrieben_vollstaendig` — Nummer, Kreis,
--    Ausstellungsdatum, Faelligkeit (§14 Abs. 4 Nr. 3 und Nr. 4).
--  · `rp_leistung_vollstaendig` — Menge, Einheit, `masseinheit_id` und
--    Bezeichnung JE Leistungszeile (§14 Abs. 4 Nr. 5). Was dort fehlt, ist
--    „mindestens EINE Leistungszeile" — das steht unten.
--  · `rs_befreiungsgrund` — eine Kategorie ausserhalb des Regelsatzes traegt
--    ihren gedruckten Grund (§14 Abs. 4 Nr. 8, zweite Alternative).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die §33-UStDV-Erleichterung, an EINER Stelle in SQL (FIN-13)
-- ---------------------------------------------------------------------------

/**
 * `ist_kleinbetrag` auf der Rechnung ist eine TATSACHE, die
 * `fin.rechnung_nummer_ziehen` beim Festschreiben einfriert. Ob die
 * ERLEICHTERUNG greift, ist eine andere Frage, und sie hat drei Teile:
 *
 *  1. **Die Schwelle kommt aus `kleinbetrag_grenze`, nicht aus dem Code.**
 *     Versioniert, gueltig am Ausstellungstag, und eine unbestaetigte Zeile
 *     zaehlt nicht (O-175): ob die Gruppe ueberhaupt Kleinbetragsrechnungen
 *     ausstellt, hat niemand entschieden, und viele gewerbliche Kunden weisen
 *     sie zurueck.
 *
 *  2. **Verglichen wird mit `<`, nicht mit `<=`** (D-322). SPEC FIN-13 sagt
 *     „Kleinbetragsrechnung < €250", §33 UStDV sagt „deren Gesamtbetrag 250
 *     Euro nicht uebersteigt" — und bei genau 250,00 € gehen die beiden
 *     Lesarten um einen Cent auseinander. PR 47 nimmt die STRENGERE: eine
 *     Rechnung mit vollstaendigen Empfaengerangaben ist nie rechtswidrig, eine
 *     zu Unrecht als Kleinbetrag ausgestellte schon.
 *     // TODO(client, O-301): Gilt bei genau 250,00 € brutto die
 *     Erleichterung des §33 UStDV? Der Verordnungstext („nicht uebersteigt")
 *     sagt ja, SPEC FIN-13 („< €250") sagt nein. Bitte mit dem Steuerberater
 *     klaeren; die Antwort ist ein Vergleichsoperator an genau zwei Stellen.
 *
 *  3. **§33 UStDV nimmt die Faelle des §3c, §6a und §13b UStG aus.** Eine
 *     Rechnung mit einer Steuergruppe der Kategorie `AE` (Reverse Charge) oder
 *     `K` (innergemeinschaftlich) traegt die Empfaengerangaben also weiter —
 *     auch wenn sie 40 € gross ist.
 *
 * Die Funktion liest die Schwelle SELBST und nimmt `ist_kleinbetrag` nicht
 * entgegen. Das ist Absicht: `fin.rechnung_nummer_ziehen` vergleicht mit
 * `<=`, und haenge die Erleichterung an dieser Spalte, unterschieden sich
 * Ausloeser und Validator bei genau 250,00 € — der Validator blockierte, die
 * Datenbank liesse durch, und wer den Validator uebergeht, bekaeme die
 * Erleichterung geschenkt. Dieselbe Auslegung steht wortgleich in
 * `kleinbetragLage()` in `services/finanz/ustg14.ts`;
 * `tests/isolation/rechnung-pflichtfelder.test.ts` haelt beide gegeneinander.
 *
 * `stable` und nicht `immutable`: sie liest Zeilen.
 */
create function fin.kleinbetrag_greift(p_rechnung uuid) returns boolean
language sql stable set search_path = pg_catalog, public as $$
  select exists (
    select 1
      from public.rechnung r
      join public.kleinbetrag_grenze g
        on not g.ist_platzhalter
       and r.rechnungsdatum >= g.gueltig_von
       and (g.gueltig_bis is null or r.rechnungsdatum <= g.gueltig_bis)
     where r.id = p_rechnung
       and abs(r.brutto_cent) < g.grenze_brutto_cent
       and g.gueltig_von = (
             select max(g2.gueltig_von) from public.kleinbetrag_grenze g2
              where not g2.ist_platzhalter
                and r.rechnungsdatum >= g2.gueltig_von
                and (g2.gueltig_bis is null or r.rechnungsdatum <= g2.gueltig_bis))
       and not exists (select 1 from public.rechnung_steuer s
                        where s.rechnung_id = r.id
                          and s.kategorie in ('AE', 'K')
                          and (s.netto_cent <> 0 or s.steuer_cent <> 0)))
$$;

comment on function fin.kleinbetrag_greift(uuid) is
  'FIN-13/§33 UStDV: greift die Erleichterung? Schwelle aus kleinbetrag_grenze '
  '(unbestaetigt = nein, O-175), Vergleich mit < (D-322, O-301), und nicht in den '
  'Faellen des §13b und der innergemeinschaftlichen Lieferung (Kategorie AE, K).';

grant execute on function fin.kleinbetrag_greift(uuid) to cse_app, cse_job, cse_definer;

-- ---------------------------------------------------------------------------
-- 2. Der aufgeschobene Pflichtfeld-Ausloeser (§6, FIN-04)
-- ---------------------------------------------------------------------------

/**
 * AUFGESCHOBEN, aus demselben Grund wie `fin.rechnung_summen_stimmig`: die
 * Festschreibungstransaktion schreibt Kopf und Kinder in EINER Anweisungs-
 * folge. Ein sofortiger Ausloeser saehe den Kopf, bevor die Steuerzeilen
 * stehen, und wiese eine Rechnung zurueck, die am Ende der Transaktion
 * vollstaendig ist.
 *
 * Der Name beginnt mit `rechnung_ustg14_…` und liegt damit alphabetisch
 * zwischen `rechnung_summen_stimmig` und `rechnung_verkettet`. PostgreSQL
 * feuert aufgeschobene Ausloeser desselben Ereignisses in Namensreihenfolge,
 * und diese Reihenfolge ist die gewuenschte: erst rechnen die Summen auf,
 * dann sind die Pflichtfelder da, dann haengt die Kette. Eine Rechnung, der
 * das Entgelt fehlt, soll das hoeren und nicht „kein Kettenglied".
 *
 * **SECURITY DEFINER mit Eigentuemer `cse_definer` (K-01) — und der Grund ist
 * gemessen, nicht gewaehlt** (D-321).
 *
 * Die erste Fassung war ein Invoker: sie laeuft beim COMMIT, also lange
 * nachdem die Definer-Aufrufe des §5.6 zurueckgekehrt sind, und sollte
 * deshalb als `cse_app` laufen. Sie tat es nicht. PostgreSQL feuert einen
 * AUFGESCHOBENEN Ausloeser im Sicherheitskontext DER AUSLOESENDEN ANWEISUNG,
 * und die ist hier das `UPDATE` in `fin.rechnung_nummer_ziehen` — also
 * `cse_definer`. Der Ausloeser scheiterte an „permission denied for table
 * rechnungsposition", und zwar bei JEDER Festschreibung.
 *
 * Also ausdruecklich `security definer` und die vier schmalen LESEpolicies
 * unten. `cse_definer` bekommt damit genau das, was diese Pruefung liest, und
 * nichts sonst: `select`, im aktiven Mandanten, auf vier Tabellen, davon auf
 * `kunde` nur die zehn Spalten der Anschrift (K-05). Kein `insert`, kein
 * `update`, keine fuenfte Tabelle.
 *
 * Und `kunde` wird SPALTENWEISE gelesen, nie mit `select *`: die
 * wirtschaftlichen Spalten (`zahlungsziel_tage`, `debitorennummer`,
 * `mahnsperre_*`) sind nach K-05 entzogen, und ein `select *` verlangte einen
 * Grant auf sie — ein Pflichtfeld-Ausloeser, der nebenbei die
 * Zahlungskondition sehen darf, ist eine stillschweigende Rechteerweiterung.
 */
create function fin.rechnung_ustg14_pflichtfelder() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  r            record;
  m            record;
  k            record;
  v_klein      boolean;
  v_name       text;
  v_strasse    text;
  v_plz        text;
  v_ort        text;
  v_zeilen     bigint;
  v_steuer     bigint;
  v_fehlend    text;
begin
  /**
   * Die Zeile wird NEU GELESEN, nicht aus `NEW` genommen. `NEW` ist der Stand
   * der ausloesenden Anweisung; geprueft werden soll der Stand beim COMMIT,
   * und der steht in der Tabelle (dieselbe Falle wie in §4.9).
   */
  select * into r from public.rechnung where id = new.id;
  if not found or r.status <> 'festgeschrieben' then
    return null;
  end if;

  -- 1. Der Leistende: vollstaendiger Name und Anschrift (§14 Abs. 4 Nr. 1).
  select * into m from public.mandant where id = r.mandant_id;
  if not found then
    raise exception
      'Rechnung %: die ausstellende Gesellschaft ist nicht lesbar — §14 Abs. 4 Nr. 1 UStG verlangt ihren Namen und ihre Anschrift',
      coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
  end if;

  v_fehlend := nullif(concat_ws(', ',
    case when nullif(btrim(coalesce(m.firma, '')), '') is null then 'Firma' end,
    case when nullif(btrim(coalesce(m.strasse, '')), '') is null then 'Strasse' end,
    case when nullif(btrim(coalesce(m.plz, '')), '') is null then 'PLZ' end,
    case when nullif(btrim(coalesce(m.ort, '')), '') is null then 'Ort' end), '');
  if v_fehlend is not null then
    raise exception
      'Rechnung %: dem Leistenden fehlt % — §14 Abs. 4 Nr. 1 UStG verlangt den vollstaendigen Namen und die vollstaendige Anschrift',
      coalesce(r.nummer, r.id::text), v_fehlend
      using errcode = 'restrict_violation',
            hint = 'Zu ergaenzen an der Gesellschaft (Einstellungen → Gesellschaft).';
  end if;

  /**
   * 2. Steuernummer ODER USt-IdNr. (§14 Abs. 4 Nr. 2, O-24).
   *
   * Kein Vorgabewert, keine leere Zeichenkette: eine Rechnung ohne diese
   * Angabe berechtigt den Empfaenger nicht zum Vorsteuerabzug, und eine
   * erfundene Nummer ist schlimmer als gar keine. `mandant_ustg14_vollstaendig`
   * (0001) prueft dasselbe, aber nur solange `eigener_nummernkreis` gesetzt
   * ist — wird das Haekchen nach dem Anlegen des Kreises entfernt, faellt der
   * CHECK weg und die Gesellschaft fakturiert weiter. Hier greift es zum
   * Zeitpunkt der Festschreibung und damit immer.
   */
  if nullif(btrim(coalesce(m.ust_id, '')), '') is null
     and nullif(btrim(coalesce(m.steuernummer, '')), '') is null then
    raise exception
      'Rechnung %: die Gesellschaft % fuehrt weder Steuernummer noch USt-IdNr. — §14 Abs. 4 Nr. 2 UStG (O-24)',
      coalesce(r.nummer, r.id::text), m.name
      using errcode = 'restrict_violation',
            hint = 'Ohne eine der beiden Angaben berechtigt der Beleg den Empfaenger '
                   'nicht zum Vorsteuerabzug. Nachzutragen an der Gesellschaft.';
  end if;

  -- 3. Greift die Erleichterung des §33 UStDV? (FIN-13)
  v_klein := fin.kleinbetrag_greift(r.id);

  /**
   * 4. Der Empfaenger: vollstaendiger Name und Anschrift (§14 Abs. 4 Nr. 1) —
   * und genau DIESE Regel laesst §33 UStDV bei der Kleinbetragsrechnung
   * entfallen. Die fortlaufende Nummer entfaellt ausdruecklich NICHT; sie hat
   * keinen empfaengerbezogenen Teil und die Lueckenlosigkeit des §14 Abs. 4
   * Nr. 4 gilt fuer jeden ausgestellten Beleg.
   */
  if not v_klein then
    select kd.name, kd.rechnungsadresse_abweichend, kd.rechnung_name,
           kd.rechnung_strasse, kd.rechnung_plz, kd.rechnung_ort,
           kd.strasse, kd.plz, kd.ort
      into k
      from public.kunde kd
     where kd.mandant_id = r.mandant_id and kd.id = r.kunde_id;
    if not found then
      raise exception
        'Rechnung %: der Leistungsempfaenger ist nicht lesbar — §14 Abs. 4 Nr. 1 UStG verlangt seinen Namen und seine Anschrift',
        coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
    end if;

    if k.rechnungsadresse_abweichend then
      v_name    := coalesce(nullif(btrim(coalesce(k.rechnung_name, '')), ''), k.name);
      v_strasse := k.rechnung_strasse;
      v_plz     := k.rechnung_plz;
      v_ort     := k.rechnung_ort;
    else
      v_name    := k.name;
      v_strasse := k.strasse;
      v_plz     := k.plz;
      v_ort     := k.ort;
    end if;

    v_fehlend := nullif(concat_ws(', ',
      case when nullif(btrim(coalesce(v_name, '')), '') is null then 'Name' end,
      case when nullif(btrim(coalesce(v_strasse, '')), '') is null then 'Strasse' end,
      case when nullif(btrim(coalesce(v_plz, '')), '') is null then 'PLZ' end,
      case when nullif(btrim(coalesce(v_ort, '')), '') is null then 'Ort' end), '');
    if v_fehlend is not null then
      raise exception
        'Rechnung %: dem Leistungsempfaenger fehlt % — §14 Abs. 4 Nr. 1 UStG (keine Kleinbetragsrechnung nach §33 UStDV)',
        coalesce(r.nummer, r.id::text), v_fehlend
        using errcode = 'restrict_violation',
              hint = 'Zu ergaenzen am Kunden. Unterhalb der Kleinbetragsgrenze des '
                     '§33 UStDV entfaellt diese Angabe — die Grenze steht in '
                     'kleinbetrag_grenze und ist noch unbestaetigt (O-175).';
    end if;
  end if;

  -- 5. Mindestens EINE Leistungszeile (§14 Abs. 4 Nr. 5). Was auf der Zeile
  --    stehen muss, haelt `rp_leistung_vollstaendig` aus 0075.
  select count(*) into v_zeilen
    from public.rechnungsposition p
   where p.rechnung_id = r.id and p.positionsart = 'leistung';
  if v_zeilen = 0 then
    raise exception
      'Rechnung %: keine Leistungsposition — §14 Abs. 4 Nr. 5 UStG verlangt Menge und Art der Leistung',
      coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
  end if;

  /**
   * 6. Das Entgelt, nach Steuersaetzen aufgeschluesselt (§14 Abs. 4 Nr. 7 und
   * Nr. 8). Ob die BETRAEGE stimmen, prueft `fin.rechnung_summen_stimmig`;
   * hier geht es nur darum, dass die Aufschluesselung ueberhaupt existiert —
   * eine Rechnung ohne eine einzige Steuerzeile weist keinen Steuersatz aus
   * und traegt auch keinen Befreiungshinweis, weil es keine Zeile gibt, an
   * der er haengen koennte.
   */
  select count(*) into v_steuer
    from public.rechnung_steuer s where s.rechnung_id = r.id;
  if v_steuer = 0 then
    raise exception
      'Rechnung %: keine Steueraufschluesselung — §14 Abs. 4 Nr. 7 und Nr. 8 UStG verlangen das Entgelt je Steuersatz sowie Satz und Steuerbetrag oder den Hinweis auf die Steuerbefreiung',
      coalesce(r.nummer, r.id::text) using errcode = 'restrict_violation';
  end if;

  return null;
end $$;

create constraint trigger rechnung_ustg14_pflichtfelder
  after insert or update on rechnung
  deferrable initially deferred
  for each row execute function fin.rechnung_ustg14_pflichtfelder();

comment on function fin.rechnung_ustg14_pflichtfelder() is
  '§14 Abs. 4 UStG: die Pflichtfelder, die sich OHNE Auslegung pruefen lassen. '
  'Der vollstaendige Befund kommt aus services/finanz/ustg14.ts; diese Bedingung '
  'haelt auch dann, wenn ein Aufrufer den Validator ueberspringt (FIN-04).';

-- ---------------------------------------------------------------------------
-- 3. Die vier schmalen LESEpolicies, die der Ausloeser braucht (K-01, §1.1)
-- ---------------------------------------------------------------------------

/**
 * `0077` zaehlt sechs `cse_definer`-Policies auf und sagt „und keine siebte".
 * Diese vier sind keine Widerlegung, sondern die Fortschreibung derselben
 * Regel (D-321): jene sechs beschreiben, was die zwei SCHREIBENDEN
 * Definer-Aufrufe des §5.6 duerfen. Hier kommt eine PRUEFUNG dazu, sie liest
 * ausschliesslich, und sie liest nur im aktiven Mandanten.
 *
 * Ohne sie greift FORCE RLS und der Ausloeser saehe null Zeilen — also
 * meldete er „dem Leistungsempfaenger fehlt Name, Strasse, PLZ, Ort" auf
 * jeder korrekten Rechnung. Der Grant allein genuegt nicht; beides gehoert
 * zusammen und steht deshalb nebeneinander.
 */
alter function fin.rechnung_ustg14_pflichtfelder() owner to cse_definer;

-- `kunde`: NUR die Spalten der §14-Anschrift (K-05). `zahlungsziel_tage`,
-- `debitorennummer` und `mahnsperre_*` stehen bewusst nicht dabei.
grant select (id, mandant_id, name, strasse, plz, ort,
              rechnungsadresse_abweichend, rechnung_name, rechnung_strasse,
              rechnung_plz, rechnung_ort)
  on kunde to cse_definer;
create policy d_kunde_pflichtfeld on kunde for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

grant select on rechnungsposition, rechnung_steuer to cse_definer;
create policy d_rp_pflichtfeld on rechnungsposition for select to cse_definer
  using (mandant_id = app.aktiver_mandant());
create policy d_rs_pflichtfeld on rechnung_steuer for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

/**
 * `kleinbetrag_grenze` ist eine globale Referenztabelle ohne `mandant_id`
 * (§3.2) — dieselbe Zeile fuer alle vier Gesellschaften. `0075` hat ihr eine
 * Lesepolicy `to cse_app` gegeben und den Grant an `cse_definer` gleich mit;
 * die Policy fehlte, und unter FORCE RLS ist ein Grant ohne Policy kein
 * Lesezugriff. `fin.kleinbetrag_greift` haette die Schwelle deshalb nie
 * gefunden und die Erleichterung des §33 UStDV waere fuer den Ausloeser
 * immer „greift nicht" gewesen — die sichere Richtung, aber aus dem falschen
 * Grund und ohne dass es jemandem aufgefallen waere.
 */
create policy r_definer_lesen on kleinbetrag_grenze for select to cse_definer
  using (true);
