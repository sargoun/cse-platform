-- 0361 — Die Abrufspur des Mitarbeiterportals: `dokument_zugriff` aus einer
--        Mitarbeitersitzung (DOC-03, DOC-04, SEC-A6, Art. 15 DSGVO, K-18,
--        AUT-05).
--
-- ===========================================================================
-- Der Befund — nachgemessen, nicht vermutet
-- ===========================================================================
--
-- `/portal/mein/dokumente/[id]` liefert eine Datei so aus, wie DOC-03 es
-- verlangt: ueber eine kurzlebige signierte Adresse aus einem privaten
-- Bucket, nie ueber einen Pfad. Das interne Gegenstueck
-- (`GET /api/dokumente/[id]/datei`, 0139) schreibt dabei VOR der Adresse eine
-- Zeile in `dokument_zugriff` — „Wer eine Datei abruft, hinterlaesst eine
-- Zeile; wer wissen will, wer eine Personalakte gesehen hat (Art. 15 DSGVO),
-- findet sie hier."
--
-- Aus dem Mitarbeiterportal ging genau das nicht:
--
--   t_dokument_zugriff_anlegen (0139)
--     with check (mandant_id = app.aktiver_mandant()
--                 and app.hat_recht('dokument.lesen', mandant_id))
--
-- Die Rolle `mitarbeiter` haelt acht Rechte — aufgabe.schreiben,
-- bau.aufmass_erfassen, dokument.schreiben, nachricht.versenden,
-- nachweis.schreiben, schluessel.schreiben, wachbuch.schreiben,
-- zeit.abwesenheit_melden — und `dokument.lesen` ist keines davon. Das ist
-- richtig so: die Kraft soll nicht die Rechnungsablage sehen, sondern ihre
-- freigegebene Unterlage (0009, `t_person`: der Zugang ist kein Recht,
-- sondern ein Subjektpraedikat).
--
-- Die Folge ist aber nicht „kein Abruf", sondern **Abruf ohne Spur**: die
-- Datei liesse sich ausliefern, und die Datenschutzauskunft saehe davon
-- nichts. Genau diese Lage beschreibt `kundenportal/dokument.ts` fuer den
-- Kunden als O-843 und laesst den Abruf deshalb dort ganz aus. Fuer das
-- Mitarbeiterportal ist das Auslassen keine Antwort: EMP-11 und DOC-04
-- fuehren die Seite, `dokument.t_person` gibt die Zeilen bereits heraus, und
-- eine Seite, die eine freigegebene Unterlage zeigt und nicht oeffnen laesst,
-- ist keine gebaute Seite.
--
-- ===========================================================================
-- Kein neuer Rechteschluessel — dieselbe Begruendung wie 0300
-- ===========================================================================
--
-- „Nur der Betroffene" laesst sich als Recht nicht ausdruecken: ein Recht
-- gehoert einer Rolle und eine Rolle vielen Menschen (K-19, 04-SEITENKARTE §7:
-- „Self-access ... is a policy branch keyed on the server-set `app.person_id`
-- GUC, not a right"). Ein erfundener Schluessel muesste jeder Mitarbeiterrolle
-- gebunden werden, wuerde also nichts pruefen und dabei behaupten, man pruefe
-- — und `super_admin` bekaeme ihn mit.
--
-- Deshalb eine SCHMALE permissive INSERT-Policy mit genau dem Praedikat, das
-- `dokument` selbst schon traegt. Sie kann nicht mehr zulassen, als die
-- Dokumentdecke ohnehin durchlaesst: das `exists` unten laeuft als die
-- aufrufende Rolle und damit durch `p_ma_ceiling` UND `t_person` (0009).
--
-- **Sie erlaubt keinen Abruf, den es nicht schon gibt.** Die Policy schreibt
-- die SPUR; ob die Zeile lesbar ist, entschied `dokument.t_person` vorher.
-- Wer die Spur faelschen wollte, muesste ein Dokument treffen, das er ohnehin
-- sehen darf, und wuerde einen Abruf seiner selbst vermerken.
--
-- **Gelesen wird die Spur hier NICHT.** `t_dokument_zugriff_lesen` bleibt
-- unveraendert an `dokument.lesen` gebunden: wer eine Akte eingesehen hat,
-- ist eine Auskunft fuer die betroffene Person und die Datenschutzstelle
-- (Art. 15), nicht eine Liste, die im Treppenhaus aufgeht. Der Weg dafuer ist
-- die Betroffenenauskunft und nicht dieses Portal.

/**
 * Die Spur des eigenen Abrufs.
 *
 * `art = 'abruf'` und nicht auch `'vorschau'`: das Portal liefert die Datei
 * ueber eine signierte Adresse aus, es zeigt keine Vorschau. Eine Art, die
 * niemand schreibt, ist eine, die irgendwann jemand benutzt, um den Abruf
 * anders zu nennen.
 *
 * `benutzer_id = app.aktueller_benutzer()`: die Zeile nennt DEN, der geholt
 * hat. Ohne diese Bedingung liesse sich eine Spur auf ein fremdes Konto
 * schreiben — eine Auskunft nach Art. 15, die auf die Falsche zeigt, ist
 * schlimmer als keine.
 *
 * `not app.ist_readonly()`: die Gruppenansicht und jeder reine Lesescope
 * schreiben nichts, auch keine Spur (Invariante 10). Sie kaemen ueber
 * `app.portal()` ohnehin nicht herein; die Bedingung steht trotzdem da, weil
 * „nur lesend heisst nur lesend" keine Ausnahme vertraegt, die man begruenden
 * muss.
 */
create policy t_selbst_m1 on dokument_zugriff for insert to cse_app
with check (
  app.portal() = 'mitarbeiter'
  and not app.ist_readonly()
  and mandant_id = app.aktiver_mandant()
  and art = 'abruf'
  and benutzer_id = app.aktueller_benutzer()
  and exists (select 1
                from dokument d
               where d.id = dokument_zugriff.dokument_id
                 and d.mandant_id = dokument_zugriff.mandant_id
                 and d.sichtbar_fuer_mitarbeiter
                 and d.geloescht_am is null)
);

comment on policy t_selbst_m1 on dokument_zugriff is
  'DOC-03, SEC-A6 (0361): die Abrufspur aus dem Mitarbeiterportal. Praedikat '
  'wie dokument.t_person — freigegeben, nicht geloescht, eigene Gesellschaft. '
  'Kein neuer Rechteschluessel: Selbstzugriff ist ein Policy-Zweig (K-19). '
  'Gelesen wird die Spur weiter nur mit dokument.lesen.';
