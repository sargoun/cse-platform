-- ===========================================================================
-- 0340 — Zwei Definer-Funktionen der Welle gehoerten `postgres` (K-01)
--
-- **Der Befund.** `tests/isolation/definer-eigentum.test.ts` nennt sie beim
-- Namen:
--
--   fin.auftrag_abschluss_befunde(p_auftrag uuid)   — 0299
--   kern.nachricht_kopf_fortschreiben()             — 0255
--
-- Beide sind `security definer` und setzen ihren `search_path` woertlich; 0255
-- schreibt die K-01-Zeile sogar in den Kommentar („`search_path` steht
-- woertlich (K-01)"). Die ZWEITE Haelfte von K-01 fehlt in beiden:
-- `alter function … owner to cse_definer`. Ohne sie gehoert die Funktion dem
-- Konto, das die Migration ausfuehrt — `postgres`, Superuser mit `BYPASSRLS`.
-- Eine `security definer`-Funktion laeuft mit den Rechten IHRES EIGENTUEMERS,
-- also liefen beide an jeder Zeilenpolicy vorbei.
--
-- Das faellt nicht auf, weil nichts dabei kaputtgeht: es funktioniert genau so
-- lange gut, bis eine vergessene `mandant_id` in einer `where`-Klausel nicht
-- an einer Policy scheitert, sondern liest, was sie greifen kann.
--
-- **Warum das Umhaengen hier Arbeit ist und nicht eine Zeile.** Mit dem
-- Eigentum wechselt die Rolle, unter der der Rumpf laeuft. `cse_definer` haelt
-- nicht automatisch, was `postgres` hielt: fehlt ein Tabellenrecht, wirft die
-- Funktion; fehlt eine POLICY, liest sie stillschweigend null Zeilen und
-- schreibt einen falschen Wert ohne Fehlermeldung — der teurere der beiden
-- Faelle. Beide Funktionen sind deshalb Tabelle fuer Tabelle durchgegangen,
-- und was fehlte, steht unten (D-388: Recht UND Policy, nie nur eines).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. fin.auftrag_abschluss_befunde — die zwei fehlenden Lesepfade
-- ---------------------------------------------------------------------------

/**
 * Die Funktion zaehlt ueber neun Tabellen. Sieben davon kann `cse_definer`
 * bereits lesen, mit Recht und Policy:
 *
 *   auftrag                   `d_auftrag_lesen`          (0183)
 *   auftrag_leistung          `d_auftrag_leistung_lesen` (0183)
 *   zeiteintrag               `z_definer_lesen`
 *   leistungsnachweis         `d_medien_bezug`
 *   aufmass                   `d_medien_bezug`
 *   rechnung                  `d_rechnung_lesen`
 *   rechnungsposition_quelle  `d_quelle_lesen`
 *
 * `nachtrag` und `vertrag_abrechnung` fehlten beide — und zwar vollstaendig,
 * Recht und Policy. Unter `postgres` fiel das nicht auf; unter `cse_definer`
 * haette die Pruefliste ab der ersten Zeile geworfen (kein Recht) und, waere
 * nur die Policy gefehlt, schlimmer: `nachtraege_offen = 0` und
 * `ohne_abrechnungsart = 0` gemeldet. Das ist genau der FALSCHE FREISPRUCH,
 * gegen den 0299 geschrieben wurde.
 */

/**
 * Spaltenweise und nicht tabellenweit.
 *
 * `nachtrag` traegt zwei Betragsspalten, die `cse_app` bewusst nicht lesen
 * darf (`betrag_netto_cent`, `beauftragter_betrag_netto_cent`). Ein
 * `grant select on nachtrag to cse_definer` gaebe sie einem Eigentuemer, der
 * sie fuer nichts braucht — die Funktion ZAEHLT Nachtraege, sie summiert
 * keine. Gelesen wird, was in der `where`-Klausel steht, und sonst nichts.
 */
grant select (id, mandant_id, auftrag_id, status, storniert_am)
  on nachtrag to cse_definer;

/**
 * Und dieselbe Enge in der Zeilendimension. `using (true)` waere hier
 * bequemer und die haeufigere Form im Bestand; sie ist es nicht wert:
 * die Funktion laeuft ausschliesslich mit gesetztem `app.aktiver_mandant()`
 * — sie vergleicht ihn oben gegen `auftrag.mandant_id` und weist einen
 * fremden Auftrag ab (Invariante 3). Die Policy sagt dasselbe noch einmal,
 * eine Ebene tiefer, und ist damit die zweite Verteidigungslinie, die
 * Invariante 3 verlangt, statt einer dekorativen Zeile.
 */
create policy d_nachtrag_abschlussbefund on nachtrag for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

comment on policy d_nachtrag_abschlussbefund on nachtrag is
  '0340: Lesepfad fuer fin.auftrag_abschluss_befunde (K-01/D-388). Auf den '
  'aktiven Mandanten begrenzt — die Funktion laeuft nie ohne einen.';

grant select (id, mandant_id, auftrag_id, auftrag_leistung_id)
  on vertrag_abrechnung to cse_definer;

create policy d_vertrag_abrechnung_abschlussbefund on vertrag_abrechnung
  for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

comment on policy d_vertrag_abrechnung_abschlussbefund on vertrag_abrechnung is
  '0340: Lesepfad fuer fin.auftrag_abschluss_befunde (K-01/D-388). Auf den '
  'aktiven Mandanten begrenzt — die Funktion laeuft nie ohne einen.';

/**
 * **Erst die Rechte, dann das Eigentum** — in DIESER Reihenfolge und in
 * derselben Migration. Andersherum gaebe es ein Fenster, in dem die Funktion
 * `cse_definer` gehoert und die Lesepfade noch fehlen.
 */
alter function fin.auftrag_abschluss_befunde(uuid) owner to cse_definer;

-- ---------------------------------------------------------------------------
-- 2. kern.nachricht_kopf_fortschreiben — der Ausloeser auf `nachricht`
-- ---------------------------------------------------------------------------

/**
 * Der Ausloeser schreibt die drei Kopffakten einer Nachricht auf ihre
 * Empfaengerzeilen fort (`kunde_id`, `kopf_richtung`, `kopf_geloescht_am`,
 * 0255). Er MUSS `security definer` sein: `cse_app` darf ueber
 * `t_empfaenger_eigene_stempeln` nur die EIGENE Empfaengerzeile anfassen, und
 * ein Ausloeser unter der Rolle des Schreibenden liesse die uebrigen stumm auf
 * dem alten Stand — mit der Folge, dass die Kundendecke `p_kunde_decke` nach
 * einer veralteten Angabe entscheidet und damit zu WEIT steht.
 *
 * Was `cse_definer` dafuer braucht, und nur das:
 *
 *  · `select (nachricht_id, mandant_id)` auf `nachricht_empfaenger` — die
 *    `where`-Klausel des `update`;
 *  · `update` auf genau den drei Kopfspalten;
 *  · `select (kunde_id, richtung, geloescht_am)` auf `nachricht` — nicht fuer
 *    diese Funktion, sondern fuer `trg_ne_kopf_denormalisieren`, den
 *    `before`-Ausloeser der Empfaengerzeile: er laeuft innerhalb des
 *    `update` und damit ebenfalls als `cse_definer`. Ohne diese drei Spalten
 *    wirft er, und der Fortschritt bliebe aus. `id` und `mandant_id` hat
 *    `cse_definer` auf `nachricht` bereits.
 */
grant select (id, nachricht_id, mandant_id) on nachricht_empfaenger to cse_definer;
grant update (kunde_id, kopf_richtung, kopf_geloescht_am)
  on nachricht_empfaenger to cse_definer;
grant select (kunde_id, richtung, geloescht_am) on nachricht to cse_definer;

/**
 * **Zwei Policies, nicht eine — und die zweite ist die, die man vergisst.**
 *
 * Das `update` traegt eine `where`-Klausel. Postgres wendet auf die
 * gelesenen Zeilen deshalb auch die SELECT-Policies an, nicht nur die des
 * `update`. Ohne `d_ne_kopf_lesen` findet die `where`-Klausel NULL Zeilen,
 * das `update` trifft nichts — und weil ein `update` ohne Treffer kein Fehler
 * ist, bliebe die Empfaengerzeile stumm auf dem alten Stand. Genau der
 * Fehlermodus, den der Kopf von 0255 beschreibt und den
 * `definer-eigentum.test.ts` als den teureren der beiden benennt. Nachgemessen
 * und nicht angenommen: mit dem Eigentumswechsel allein schrieb der Ausloeser
 * nicht mehr fort.
 *
 * Beide Policies tragen dieselbe Bedingung: die Mandantengleichheit von Kopf
 * und Empfaengerzeile — K-16, und nicht `true`.
 *
 * Es ist dieselbe Bedingung, die `trg_ne_kopf_denormalisieren` beim Anlegen
 * erzwingt („Zu dieser Empfaengerzeile gibt es keine Nachricht in dieser
 * Gesellschaft"). Sie kann deshalb keine Zeile aussperren, die es rechtmaessig
 * gibt — die stille Untaetigkeit, vor der der Kopf von 0255 warnt, kann von
 * hier nicht kommen. Was sie ausschliesst, ist der Fall, den es nicht geben
 * darf: eine Empfaengerzeile, die ueber die Mandantengrenze auf einen fremden
 * Kopf zeigt, liesse sich sonst mit diesem Definer-Recht beschreiben.
 *
 * Kein `app.aktiver_mandant()` in der Bedingung: der Ausloeser feuert auch in
 * einer Job- und in einer Kundensitzung, und dort ist kein aktiver Mandant
 * gesetzt. Eine Policy, die dann nicht greift, waere genau die stille
 * Untaetigkeit.
 */
create policy d_ne_kopf_lesen on nachricht_empfaenger
  for select to cse_definer
  using (exists (select 1 from nachricht n
                  where n.id = nachricht_empfaenger.nachricht_id
                    and n.mandant_id = nachricht_empfaenger.mandant_id));

comment on policy d_ne_kopf_lesen on nachricht_empfaenger is
  '0340: die `where`-Klausel von kern.nachricht_kopf_fortschreiben. Ohne sie '
  'traefe das `update` null Zeilen — ohne Fehler und ohne Wirkung.';

create policy d_ne_kopf_fortschreiben on nachricht_empfaenger
  for update to cse_definer
  using (exists (select 1 from nachricht n
                  where n.id = nachricht_empfaenger.nachricht_id
                    and n.mandant_id = nachricht_empfaenger.mandant_id))
  with check (exists (select 1 from nachricht n
                       where n.id = nachricht_empfaenger.nachricht_id
                         and n.mandant_id = nachricht_empfaenger.mandant_id));

comment on policy d_ne_kopf_fortschreiben on nachricht_empfaenger is
  '0340: Schreibpfad fuer kern.nachricht_kopf_fortschreiben (K-01/D-388). '
  'Kopf und Empfaengerzeile muessen derselben Gesellschaft gehoeren (K-16).';

alter function kern.nachricht_kopf_fortschreiben() owner to cse_definer;
