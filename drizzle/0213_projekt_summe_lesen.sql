-- ===========================================================================
-- 0213 — `app.projekt_summe_lesen`: der Weg zur Vertragssumme (K-05, §1.9)
-- ===========================================================================
--
-- **Der Leser, den 0089 ausdruecklich diesem PR zugewiesen hat.** Dort steht
-- woertlich: „Ein Leser wie `app.lv_preis_lesen` entsteht hier NICHT: heute
-- liest keine einzige Stelle im Anwendungscode diese beiden Spalten […] Er
-- gehoert in den PR, der die Vertragssumme erstmals anzeigt — dort mit
-- `bau.preis_lesen`, Mandantenpruefung und `audit_log`, nach dem Muster von
-- 0071." Das ist dieser PR: die Projektdetailseite
-- (`/portal/[mandant]/bau/projekte/[id]`) zeigt Auftragssumme und
-- Sicherheitseinbehalt.
--
-- Ohne diese Funktion gibt es fuer die Seite nur zwei Wege, und beide sind
-- falsch: `select *` auf `projekt` scheitert hart mit einem Rechtefehler
-- (0089 hat den Spaltenentzug erschoepfend erteilt, nicht maskierend), und
-- die Spalte auszulassen hiesse, dem Bauleiter „0 €" oder gar nichts zu
-- zeigen, wo eine Vertragssumme steht.
--
-- **Zwei Spalten, eine Funktion, ein Recht.** `sicherheitseinbehalt_bp` faehrt
-- in derselben Zeile und ist derselbe Gegenstand: ein mit dem Kunden
-- verhandelter Prozentsatz nach § 17 VOB/B. 0089 hat beide zusammen entzogen
-- und begruendet, warum sie zusammengehoeren; sie hier zu trennen, machte aus
-- einer Entscheidung zwei.
--
-- **Sie WIRFT NICHT, sie gibt nichts zurueck.** `app.projekt_kennzahlen`
-- wirft `insufficient_privilege`, wenn `kalkulation.lesen` fehlt — das ist
-- fuer eine Berichtsfunktion richtig und fuer diese hier falsch: die
-- Projektseite laedt ALLE ihre Abfragen in EINER gebundenen Transaktion
-- (`db().begin(SCHNAPPSCHUSS, …)`), und eine Ausnahme darin bricht die ganze
-- Seite ab. Es erschiene kein Hinweis, sondern ein Fehler. Deshalb dieselbe
-- Form wie `app.lv_preis_lesen`: keine Zeile, und die Seite schreibt den
-- Satz, dass das Recht fehlt.
--
-- **`bau.preis_lesen` und nicht `kalkulation.lesen`.** Die Route traegt
-- `bau.lesen` (Seitenkarte §5.9); der PREIS im Bau haengt durchgehend an
-- `bau.preis_lesen` — dasselbe Recht, das den Einheitspreis der LV-Position
-- oeffnet. `kalkulation.lesen` ist das Recht der eigenen KOSTENSEITE
-- (Deckungsbeitrag, Marge) und bleibt der Berichtsansicht; die Marge des
-- Projekts holt die Seite deshalb weiter aus `app.projekt_kennzahlen` und
-- fragt das Recht dafuer VORHER in SQL ab, statt in eine Ausnahme zu laufen.

create function app.projekt_summe_lesen(p_projekt uuid)
returns table (
  auftragssumme_netto_cent bigint,
  sicherheitseinbehalt_bp integer
)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
declare v_mandant uuid;
begin
  select pr.mandant_id into v_mandant
    from public.projekt pr where pr.id = p_projekt;

  -- Keine Zeile ist keine Zeile — und niemals ein „verboten", das die
  -- Existenz bestaetigt (AUT-06).
  if v_mandant is null then return; end if;
  if v_mandant is distinct from app.aktiver_mandant() then return; end if;
  if not app.hat_recht('bau.preis_lesen', v_mandant) then return; end if;

  perform app.protokolliere('bau.auftragssumme_gelesen', 'projekt', p_projekt::text,
                            null, null, v_mandant);

  return query
    select pr.auftragssumme_netto_cent, pr.sicherheitseinbehalt_bp
      from public.projekt pr
     where pr.id = p_projekt;
end $$;

comment on function app.projekt_summe_lesen(uuid) is
  'K-05/§1.9, angekuendigt in 0089: der eine Weg zu '
  'projekt.auftragssumme_netto_cent und projekt.sicherheitseinbehalt_bp. '
  'Prueft bau.preis_lesen und den aktiven Mandanten, protokolliert jeden '
  'Zugriff und gibt bei fehlendem Recht KEINE Zeile zurueck (nie eine 0).';

/**
 * **`owner to cse_definer`** (K-01). Ohne diese Zeile gehoerte die Funktion
 * der Migrationsrolle — Superuser mit `BYPASSRLS` —, liefe an jeder Policy
 * vorbei, und `d_projekt_kennzahlen` (die `cse_definer`-Leseerlaubnis auf
 * `projekt` aus 0162) waere Zierde. Der Eigentuemer haelt genau die Rechte,
 * die diese Funktion braucht: `select on projekt` und eine Policy dafuer.
 */
alter function app.projekt_summe_lesen(uuid) owner to cse_definer;
revoke all on function app.projekt_summe_lesen(uuid) from public;
grant execute on function app.projekt_summe_lesen(uuid) to cse_app;
