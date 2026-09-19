-- 0370 — Die Gruppendecke auf den Bewerberbezug (TEN-05, SEC-A3, REC-07).

/**
 * **Der Befund.** `/portal/gruppe/kalender` wurde gebaut, und der zentrale
 * Kalender liest sieben Quellen — darunter `gespraech`, und dessen Titel ist
 * `'Gespräch: ' || bewerbung.name`. Die Prüfung, ob die Gruppenansicht diesen
 * Namen sehen kann, fand daneben etwas anderes:
 *
 *   `create policy t_bewerbung_gruppe on bewerbung for select to cse_app
 *      using (app.ist_gruppenansicht()
 *             and mandant_id = any (app.rechte_mandanten('gruppe.recruiting.lesen')));`
 *
 * Eine Gruppensitzung mit `gruppe.recruiting.lesen` las damit die vollen
 * Bewerbungszeilen der Schwestergesellschaften — Name, E-Mail, Telefon,
 * Anschreiben, Status.
 *
 * **Warum das falsch ist, und zwar nicht nur unschön.**
 * `02-datenmodell/06-RADAR-KI-INHALT.md` §6.2 sagt es ausdrücklich: die
 * Bewerbertische tragen **keine** `t_gruppe`-Policy, und zusätzlich die
 * restriktive Decke aus §1.4. Zwei Gründe, beide juristisch:
 *
 *   1. Die vier Bereiche sind eigene Verantwortliche im Sinne der DSGVO. Eine
 *      Bewerberin hat keine Beschäftigung und damit keine Rechtsgrundlage
 *      dafür, dass ihre Daten den anderen drei Gesellschaften gezeigt werden.
 *      Bewirbt sich derselbe Mensch bei zweien, sind das zwei `kandidat`-
 *      Zeilen — das ist keine Redundanz, das ist die richtige Trennung.
 *   2. Aufbewahrung: Bewerberdaten fallen unter REC-07/LEG-11 und müssen
 *      gelöscht werden; Beschäftigtendaten unter Handels- und Steuerrecht und
 *      dürfen es nicht.
 *
 * `gruppe.recruiting.lesen` existiert im Katalog — aber für die
 * STELLEN-Hälfte des Moduls (`stelle`, `stelle_veroeffentlichung`, beide mit
 * ihrer Gruppenpolicy in 0166). Eine Stellenanzeige ist öffentlich; eine
 * Bewerbung darauf ist es nicht. Der Schlüssel taugt deshalb nicht als
 * Unterscheidung — und genau deshalb steht die Trennung als POLICY da und
 * nicht als Rechtevergabe, die jemand versehentlich weiter sät.
 *
 * **Zwei Linien, wie überall** (AUT-05):
 *
 *   1. `t_bewerbung_gruppe` fällt weg — die Tür ist zu.
 *   2. `p_gruppe_kein_personenbezug` als RESTRIKTIVE Decke auf allen sechs
 *      Bewerbertischen — sie hält die Tür zu, falls jemand die permissive
 *      Policy je wieder anlegt. Restriktiv heisst UND: sie kann nichts
 *      öffnen, nur schliessen.
 *
 * **Warum keine Decke auf `bewerbung` in der Bauart von `p_kandidat_decke`.**
 * Die vier Geschwistertische tragen `p_*_decke` mit
 * `app.portal() = 'intern'`. `bewerbung` trägt sie mit Absicht NICHT: das
 * öffentliche Bewerbungsformular schreibt über `t_bewerbung_eingang` als
 * Prinzipal ohne internes Portal (REC-03, 0168). Eine Portaldecke hier
 * schlösse den Eingang. Die Gruppendecke tut das nicht — `ist_gruppenansicht()`
 * ist im Formularpfad falsch, also ist die Decke dort wahr.
 *
 * **Was NICHT mitwandert.** §1.4 nennt dieselbe Decke auch für `nachricht`,
 * `nachricht_anhang`, `nachricht_empfaenger`, `wissens_chunk`, `agent_schritt`,
 * `agent_schritt_beleg`, `agent_artefakt` und `freigabe_feld`. Für die drei
 * Nachrichtentische ist das **O-651** — eine offene Frage an den Auftraggeber,
 * die 0231 bewusst offen gelassen hat; sie hier zu entscheiden wäre dasselbe
 * Vorgreifen in die andere Richtung. Die übrigen gehören anderen Modulen und
 * werden dort geprüft.
 */

-- ---------------------------------------------------------------------------
-- (1) Die permissive Gruppenpolicy auf `bewerbung` fällt weg
-- ---------------------------------------------------------------------------

drop policy if exists t_bewerbung_gruppe on bewerbung;

-- ---------------------------------------------------------------------------
-- (2) Die restriktive Decke — auf allen sechs Tischen
-- ---------------------------------------------------------------------------

/**
 * `for all`, nicht `for select`: eine Gruppensitzung schreibt ohnehin nicht
 * (Invariante 10), aber eine Decke, die nur das Lesen deckt, ist eine halbe
 * Decke — und die halbe ist die, die jemand findet.
 */
do $$
declare t text;
begin
  foreach t in array array['bewerbung', 'kandidat', 'bewerbung_bewertung',
                           'einstellungsentscheidung', 'gespraech', 'bewerbung_antwort']
  loop
    execute format($p$
      create policy p_gruppe_kein_personenbezug on %I as restrictive for all to cse_app
        using (not app.ist_gruppenansicht())
        with check (not app.ist_gruppenansicht())$p$, t);
  end loop;
end $$;

comment on policy p_gruppe_kein_personenbezug on bewerbung is
  '06-RADAR-KI-INHALT.md §1.4/§6.2. Die Gruppenansicht sieht null Bewerberzeilen — '
  'unabhaengig davon, wie gruppe.recruiting.lesen gesaet ist. TEN-05 gibt der Gruppe '
  'verdichtete Zahlen, nicht die Namen der Bewerberinnen einer Schwestergesellschaft.';

comment on policy p_gruppe_kein_personenbezug on gespraech is
  'Der zentrale Kalender (CAL-01) liest gespraech als Quelle; sein Titel traegt den Namen '
  'aus bewerbung. In der Gruppenansicht ist diese Quelle damit leer — und zwar durch die '
  'Policy, nicht durch eine Entscheidung im Anzeigecode.';
