-- ===========================================================================
-- 0446 — Betriebsausgaben zaehlen zum Aufwand, auch in der Gruppe (V-215, FIN-17, ACC-08, D-706)
-- ===========================================================================
-- **Der Befund.** Seit V-011 lassen sich Betriebsausgaben (ausgabe, 0180)
-- erfassen, freigeben und buchen. Jede Auswertung zu Aufwand und Ergebnis las
-- aber nur eingangsrechnung: Monatszahlen, Saldo je Gesellschaft und Gruppe,
-- die beim Periodenschluss eingefrorenen Zahlen und das Jahrespaket wiesen ein
-- Ergebnis aus, das um jede gebuchte Tankquittung zu hoch war.
--
-- **Warum eine Funktion und keine Abfrage im Dienst.** Im Bereich liest
-- cse_app die Ausgaben unter t_mandant, und eine Summe darueber stimmt. In der
-- GRUPPE blendet die Decke p_gruppe_kein_personenbezug (0180) jede Zeile mit
-- anstellung_id aus - die Erstattungen. Eine Gruppensumme ueber dieselbe
-- Tabelle waere damit kleiner als die Summe der Gesellschaften, und genau das
-- darf die Gruppensicht nicht sein (D-475). 0180 hat buchungssatz aus
-- demselben Grund OHNE diese Decke gelassen: sie frisst den Gruppenaufwand.
--
-- Diese Funktion gibt deshalb NUR Summen heraus - je Gesellschaft und Monat
-- Nettobetrag und Anzahl, keine Zeile, keine Kennung, keine Person. Wer eine
-- Erstattung einem Menschen zuordnen will, braucht weiterhin
-- app.ausgabe_erstattung_lesen und personal.erstattung_lesen.
--
-- **Was zaehlt.** Dieselbe Lesart wie bei den Eingangsrechnungen (D-484):
-- freigegeben oder gebucht, nach dem Belegdatum (ausgabedatum), netto. Eine
-- Ausgabe, die aus einer Lieferantenrechnung stammt (eingangsrechnung_id
-- gesetzt), zaehlt dort und hier nicht - sonst stuende derselbe Aufwand
-- zweimal da.
--
-- **Wer was sieht.** Im Bereich: der aktive Mandant, mit eingang.lesen - das
-- Recht, unter dem cse_app die Ausgaben selbst liest. In der Gruppe: jede
-- Gesellschaft, fuer die die Sitzung gruppe.eingang.lesen haelt - das Recht
-- der Policy t_gruppe auf ausgabe. Nur im internen Portal. Der Definer liest
-- unter d_ausgabe_lesen (0180) und dem Tabellenrecht aus 0180; eine neue
-- Policy braucht es nicht.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks: dieselbe Regel wie in
-- 0392 bis 0445.
-- ===========================================================================

create function app.ausgaben_aufwand(p_von date, p_bis date)
returns table (mandant_id uuid, monat text, netto_cent bigint, anzahl integer)
language sql stable security definer
set search_path = pg_catalog, public, app
as $$
  select a.mandant_id,
         to_char(a.ausgabedatum, 'YYYY-MM') as monat,
         sum(a.netto_cent)::bigint as netto_cent,
         count(*)::integer as anzahl
    from public.ausgabe a
   where a.ausgabedatum between p_von and p_bis
     and a.status in ('freigegeben', 'gebucht')
     and a.eingangsrechnung_id is null
     and app.portal() = 'intern'
     and case when app.ist_gruppenansicht()
              then a.mandant_id = any (app.rechte_mandanten('gruppe.eingang.lesen'))
              else a.mandant_id = app.aktiver_mandant()
                   and app.hat_recht('eingang.lesen', a.mandant_id)
         end
   group by a.mandant_id, to_char(a.ausgabedatum, 'YYYY-MM')
$$;

alter function app.ausgaben_aufwand(date, date) owner to cse_definer;
revoke all on function app.ausgaben_aufwand(date, date) from public;
grant execute on function app.ausgaben_aufwand(date, date) to cse_app;

comment on function app.ausgaben_aufwand(date, date) is
  'V-215, FIN-17, ACC-08, D-706. Aufwand aus Betriebsausgaben je Gesellschaft und Monat '
  '(freigegeben/gebucht, netto, ohne Ausgaben aus Eingangsrechnungen) - nur Summen, auch in '
  'der Gruppe einschliesslich der Erstattungen, die die Gruppendecke als Zeilen ausblendet.';
