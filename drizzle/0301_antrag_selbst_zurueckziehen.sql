-- 0301 — Den eigenen Antrag ZURUECKZIEHEN, solange niemand entschieden hat
--        (EMP-10, AUT-05, AUT-06, K-19).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- `zieheAntragZurueck` gibt es im Dienst seit 0074
-- (`src/server/services/abwesenheit/antrag.ts`), und die Oberflaeche hat ihn
-- nie angeboten. Der Grund steht im Kopfkommentar von
-- `src/app/portal/mein/antraege/page.tsx`: auf `antrag` gab es als UPDATE-
-- Policy nur `t_mandant_entscheiden`, und die verlangt
-- `zeit.antrag_entscheiden` — das Recht der PLANUNG. Die Rolle `mitarbeiter`
-- haelt es nicht.
--
-- Gegen die lebende Datenbank gemessen:
--
--   update antrag set status='zurueckgezogen' where id=… and status in
--     ('eingereicht','in_pruefung') returning id     -> UPDATE 0
--   select count(*) from antrag where id=…           -> 1
--
-- Also: die Zeile ist da, sie ist lesbar (`t_selbst_lesen`), und das Update
-- trifft null Zeilen. `zieheAntragZurueck` wirft dann `AntragNichtGefunden`,
-- und die Route antwortet 404 auf einen Antrag, den der Mensch vor sich sieht.
-- Ein Knopf, der 404 ergibt, ist schlechter als keiner — deshalb stand er
-- nicht da, und deshalb steht hier diese Policy.
--
-- ===========================================================================
-- Warum eine Policy und kein Rechteschluessel
-- ===========================================================================
--
-- „Nur der Betroffene" laesst sich als Recht nicht ausdruecken (K-19,
-- 04-SEITENKARTE §7). Die Ruecknahme ist Selbstzugriff, und die Plattform hat
-- dafuer eine Form: `antrag.t_selbst_einreichen` (INSERT) und
-- `antrag.t_selbst_lesen` (SELECT) sind dieselbe Bauart, an dieselbe
-- Bedingung gebunden — `anstellung_id` gehoert `app.aktuelle_person()`. Diese
-- Zeile ergaenzt das fehlende dritte Verb.
--
-- ===========================================================================
-- Was die Policy NICHT zulaesst
-- ===========================================================================
--
-- Die beiden Haelften sind mit Absicht eng:
--
--   USING       nur `eingereicht` oder `in_pruefung`, und nicht storniert.
--   WITH CHECK  nur `zurueckgezogen`.
--
-- Damit ist diese Policy KEIN allgemeiner Schreibweg auf `antrag`: eine
-- Selbstgenehmigung („status = 'genehmigt'") faellt an der WITH-CHECK-Haelfte,
-- ein Zugriff auf einen entschiedenen Antrag an der USING-Haelfte. Der
-- Ausloeser `kern.antrag_status` (0074) prueft die Uebergangstabelle ein
-- zweites Mal — beide Linien sagen dasselbe, und das ist der Sinn (AUT-05).
--
-- Was ausdruecklich NICHT geprueft wird, ist das Portal: dieselbe Person darf
-- ihren Antrag auch aus dem internen Portal zurueckziehen, wenn sie dort
-- angemeldet ist. Die Zeile bleibt in beiden Faellen ihre. Die restriktive
-- K-04-Decke `p_ma_decke` steht im Mitarbeiterportal ohnehin daneben und
-- verengt auf dieselbe Menge.
--
-- Nach der Ruecknahme ist der Antrag WEG aus dem Posteingang der Planung und
-- steht trotzdem noch da (Invariante 8, kein hartes Loeschen): der Vorgang
-- bleibt lesbar, mit Eingang, Ruecknahme und Zeitpunkt.
-- ===========================================================================

create policy t_selbst_zurueckziehen on antrag for update to cse_app
using (
  mandant_id = app.aktiver_mandant()
  and storniert_am is null
  and status in ('eingereicht', 'in_pruefung')
  and exists (
    select 1 from anstellung a
     where a.mandant_id = antrag.mandant_id
       and a.id = antrag.anstellung_id
       and a.person_id = app.aktuelle_person()
  )
)
with check (
  mandant_id = app.aktiver_mandant()
  and not app.ist_readonly()
  and status = 'zurueckgezogen'
  and exists (
    select 1 from anstellung a
     where a.mandant_id = antrag.mandant_id
       and a.id = antrag.anstellung_id
       and a.person_id = app.aktuelle_person()
  )
);

comment on policy t_selbst_zurueckziehen on antrag is
  'EMP-10 (0301): die eigene Ruecknahme. USING laesst nur eingereicht und '
  'in_pruefung zu, WITH CHECK nur den Zielzustand zurueckgezogen — die Policy '
  'ist damit kein allgemeiner Schreibweg auf antrag. Selbstzugriff ueber '
  'app.aktuelle_person(), kein Rechteschluessel (K-19).';
