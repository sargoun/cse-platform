-- 0440 — eine aus dem Entwurf entfernte Angebotsposition sieht der Kunde nicht
-- (OPS-08, V-130/D-626, V-203, D-696).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- Seit 0392 wird eine Position aus einem Angebotsentwurf nicht geloescht,
-- sondern mit entfernt_am markiert (Invariante 8). Die Summen der Datenbank
-- zaehlen nur lebende Zeilen. Die Kundenpolicy t_kunde aus 0024 gibt dem
-- Kunden aber JEDE Zeile eines versendeten Angebots frei — also auch die
-- entfernte, mit Menge und Preis. Das Kundenportal zeigte sie ihm, neben
-- einem Netto ohne sie.
--
-- ===========================================================================
-- Die Aenderung
-- ===========================================================================
--
-- Der Leser im Kundenportal filtert jetzt selbst (kundenportal/angebot.ts,
-- ueber angebot/lebend.ts). Diese Policy ist die zweite Linie dahinter
-- (Invariante 3): eine entfernte Zeile ist ein Arbeitsstand des Hauses, kein
-- Teil des Vertragsangebots, und erreicht den Kunden auf keinem Weg.
--
-- Nach dem Versand aendert sich entfernt_am nicht mehr (ap_unveraenderlich,
-- 0024/0392); die Bedingung ist deshalb fuer jede Zeile, die der Kunde je
-- sehen darf, endgueltig.
--
-- Die restriktive Decke p_kunde_decke (0024) bleibt unveraendert.

drop policy t_kunde on angebotsposition;

create policy t_kunde on angebotsposition for select to cse_app
  using (app.scope() = 'kunde'
         and angebotsposition.entfernt_am is null
         and exists (select 1 from angebot a
                      where a.id = angebotsposition.angebot_id
                        and a.kunde_id = any (app.aktuelle_kunden())
                        and a.versendet_am is not null));
