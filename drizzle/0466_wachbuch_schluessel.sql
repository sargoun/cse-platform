-- ===========================================================================
-- 0466 -- Das Wachbuch nimmt Schluesseleintraege an (V-180, D-674; SEC-05
--         Eintragsart key, SEC-07, 0070, 0079, 0300)
-- ===========================================================================
--
-- Der Befund (V-180). SEC-05 nennt fuenf Eintragsarten, darunter key. Der
-- Wachbuchdienst wies die Art schluessel grundsaetzlich ab -- mit dem Satz,
-- die Schluesselverwaltung sei "noch nicht gebaut". Sie war gebaut (0079):
-- schluessel, schluessel_quittung, der Fremdschluessel wachbuch_schluessel_fk
-- und die Spalte schluessel_quittung.wachbuch_eintrag_id standen da. Keine
-- Route las eine Schluesselkennung, und keine Quittung zeigte je auf eine
-- Wachbuchseite.
--
-- Was diese Migration dazugibt, ist klein und genau zwei Dinge:
--
--   1. schluessel.t_selbst_m1 -- die Wache liest die Schluessel des Objekts,
--      auf dem sie eingesetzt ist, auch im M1-Scope des Mitarbeiterportals.
--      Dort schreibt sie ihre Wachbuchseite (0300), und der Dienst haelt die
--      Schluesselkennung aus dem Formular vor dem Schreiben gegen das Objekt
--      der Seite (K-02). Ohne diese Zeile faende die Pruefung null Zeilen und
--      wiese den EIGENEN Schluessel als "gehoert zu einem anderen Objekt" ab --
--      derselbe AUT-05-Fehler, den 0300 fuer Objekt, Schicht und
--      Kontrollpunkt behoben hat. Praedikat wortgleich mit
--      kontrollpunkt.t_selbst_m1 und mit dem Mitarbeiterzweig von
--      schluessel.p_intern_einsatz_decke (0079): der Schluessel des Objekts,
--      auf dem ich eingesetzt bin. Nur lesend; geschrieben wird der
--      Schluessel weiter von der Leitung.
--   2. Ein Index auf schluessel_quittung.wachbuch_eintrag_id -- das
--      Wachbuchblatt fragt "welche Quittung hat diese Seite geschrieben", und
--      ohne Index waere das je Seite ein Durchlauf ueber das ganze Journal.
--
-- Keine Definer-Funktion, kein neues Recht: der Schreibweg der Seite bleibt
-- wachbuch_eintrag.t_mandant (wachbuch.schreiben), der der Quittung
-- schluessel_quittung.t_mandant (schluessel.schreiben).
-- ===========================================================================

create policy t_selbst_m1 on schluessel for select to cse_app
using (
  app.portal() = 'mitarbeiter'
  and mandant_id = app.aktiver_mandant()
  and app.ist_eingesetzt_auf_objekt(objekt_id)
);

comment on policy t_selbst_m1 on schluessel is
  'SEC-05, SEC-07 (0466, V-180): der Schluessel des eigenen Objekts im M1-Scope des '
  'Mitarbeiterportals. Er traegt die Vorpruefung in schreibeEintrag, die die '
  'Schluesselkennung aus dem Formular gegen das Objekt der Seite haelt (K-02). Nur lesend.';

create index sq_wachbuch_idx on schluessel_quittung (wachbuch_eintrag_id)
  where wachbuch_eintrag_id is not null;
