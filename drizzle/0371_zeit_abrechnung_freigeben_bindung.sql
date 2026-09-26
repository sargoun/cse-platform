-- ===========================================================================
-- 0371 — Die Bindung, auf die 0366 gewartet hat (TIM-12, FIN-07, EMP-04,
--        D-611, D-612, AUT-06, 03-AUTH §12.4)
--
-- **0366 hat die Tuer gebaut und den Schluessel nicht ausgegeben.** Die
-- Funktion `app.zeit_zur_abrechnung_freigeben` steht seit 0366 vollstaendig
-- da — mit Policy, mit Protokoll, mit einem Ergebnis je Zeile. Ihre erste
-- Bedingung ist `app.hat_recht('zeit.abrechnung_freigeben', v_mandant)`, und
-- die antwortete ueberall `false`, weil das Recht an KEINE Rolle gebunden
-- war. Das war Absicht: O-39 fragte, ob es den Schritt als eigenen
-- menschlichen Akt ueberhaupt gibt, und ein Recht fuer einen unbestaetigten
-- Arbeitsschritt zu seeden hiesse, den Platzhalter tragend zu machen (K-17).
--
-- **O-39 ist beantwortet — D-611.** Der Mandant hat bestaetigt: ja, ein
-- Mensch gibt frei, woechentlich, vor der Fakturierung; die Stunden gehen an
-- den zustaendigen Admin, der bestaetigt, korrigiert oder ablehnt. Damit ist
-- die Antwort eine BINDUNG und kein Umbau — genau so, wie die Seite und die
-- Funktion es vorgesehen hatten.
--
-- **Warum diese Migration ueberhaupt existiert, obwohl 0008 den Katalog
-- seedet.** Der Seed-Block in `0008` wird aus `03-AUTH-BERECHTIGUNGEN.md` §12
-- erzeugt (`pnpm katalog`) und traegt die neue Zeile jetzt mit. Er gilt aber
-- nur fuer eine Datenbank, die 0008 noch VOR sich hat. Jede bereits
-- gewanderte Datenbank — Produktion, Abnahme, jede Entwicklerkopie — hat 0008
-- laengst hinter sich und saehe die Aenderung nie. Zwei Wege, ein Ziel: der
-- Generator fuer die leere Datenbank, diese Migration fuer die gefuellte.
--
-- **`leitung` bekommt sie NICHT per Vorgabe, sondern bindbar — D-612.** Die
-- Freigabe zur Abrechnung ist ein kaufmaennischer Akt, kein Schichtakt: was
-- hier freigegeben wird, fliesst in Stundenkonto (EMP-04) und Rechnung
-- (FIN-07), und beides traegt der Mandant, nicht die Schicht. Die Matrix
-- fuehrt `leitung` deshalb als `○` — jede Gesellschaft kann die Bindung in
-- der Rechte-Oberflaeche selbst anlegen, ausdruecklich und sichtbar, oder es
-- bleiben lassen. Eine Vorgabe daraus zu machen hiesse, die Entscheidung fuer
-- alle vier Gesellschaften zu treffen, die keine von ihnen getroffen hat.
--
-- **Offen bleibt O-861** (Einheit und Ruecknahme der Freigabe) — 0366 nennt
-- sie an ihrer Stelle und diese Migration aendert daran nichts.
-- ===========================================================================

/*
 * Die Plattform-Vorgabe traegt `mandant_id is null` — dieselbe Form wie der
 * Block in 0008, aus dem sie sonst gekommen waere. Ohne `nulls not distinct`
 * auf `rolle_berechtigung_key` wuerde `on conflict` hier nicht greifen; der
 * Index traegt es seit 0008 Zeile 79, und der Lauf ist damit wiederholbar.
 */
insert into rolle_berechtigung (rolle_id, berechtigung_id, mandant_id, gewaehrt)
select r.id, b.id, null, true
  from (values ('super_admin'), ('admin')) as v(rolle)
  join rolle r        on r.schluessel = v.rolle and r.mandant_id is null
  join berechtigung b on b.schluessel = 'zeit.abrechnung_freigeben'
on conflict (rolle_id, berechtigung_id, mandant_id) do nothing;

/*
 * **Die Zusicherung gehoert in dieselbe Migration wie der Einsatz.** Eine
 * Bindung, die still null Zeilen schreibt — weil die Rolle anders heisst, das
 * Recht fehlt oder der Katalog nicht geseedet wurde —, sieht von aussen
 * genauso aus wie eine erfolgreiche. Und der Preis dafuer faellt erst an,
 * wenn ein Mensch vor einem 404 steht, das niemand erklaeren kann.
 */
do $$
declare
  v_anzahl int;
begin
  select count(*) into v_anzahl
    from rolle_berechtigung rb
    join rolle r        on r.id = rb.rolle_id
    join berechtigung b on b.id = rb.berechtigung_id
   where b.schluessel = 'zeit.abrechnung_freigeben'
     and rb.mandant_id is null
     and rb.gewaehrt
     and r.schluessel in ('super_admin', 'admin');

  if v_anzahl <> 2 then
    raise exception
      'D-611: zeit.abrechnung_freigeben muss an super_admin UND admin gebunden sein, gefunden: %',
      v_anzahl;
  end if;
end $$;

comment on index rolle_berechtigung_key is
  'Eine Rolle haelt ein Recht je Mandant genau einmal. `nulls not distinct`, '
  'damit die Plattform-Vorgabe (mandant_id is null) derselben Regel unterliegt '
  'und 0371 wiederholbar bleibt.';
