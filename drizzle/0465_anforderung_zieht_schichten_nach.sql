-- ===========================================================================
-- 0465 -- Ein neuer oder archivierter Eintrag in einsatzanforderung zieht die
--         KUENFTIGEN Schichten seines Bereichs nach (V-179, D-673; V-129,
--         D-624, 03-GEWERKE 9.2/9.4, SEC-01, SEC-04)
-- ===========================================================================
--
-- Der Befund (V-179). Fuer einsatzanforderung gab es keinen Schreibweg; ab
-- jetzt traegt die Sicherheitsleitung verlangte Nachweise auf der Seite eines
-- Postens oder einer Veranstaltung ein (services/security/anforderung.ts). Das
-- harte Tor app.einsatz_qualifikation_erfuellt (0031) liest die Tabelle live
-- und greift damit fuer jede NEUE Einteilung sofort.
--
-- Was ohne diese Migration fehlte: die Schichten, die SCHON im Plan stehen.
-- 0394 legt an jede Schicht einen Schnappschuss der Anforderungsmenge und
-- bewertet die Mischung (anforderung_erfuellt) -- nachgezogen wird er aber
-- nur bei einer Besetzungsaenderung. Eine neue Sperre auf einem Posten liesse
-- damit jede schon eingeteilte kuenftige Schicht als erfuellt stehen, auch
-- wenn die Wache darauf keinen Nachweis hat; erst die naechste Einteilung
-- zeigte es. Die Zusage aus 0394 lautet aber: bis zum BEGINN folgt der
-- Schnappschuss dem Katalog.
--
-- Die Entscheidung (D-673):
--
--   1. Ein AFTER-Ausloeser auf einsatzanforderung loest fuer jede Schicht des
--      Bereichs, die noch nicht begonnen hat und nicht storniert ist, die
--      Anforderungsmenge neu auf und bewertet die Mischung neu -- mit
--      denselben zwei Funktionen wie 0394 (kern.anforderung_aufloesen,
--      kern.anforderung_mischung), damit es keine zweite Fassung gibt.
--   2. Eine Schicht, die schon BEGONNEN hat, bleibt unberuehrt: ihr
--      Schnappschuss ist seit 0394 eingefroren, und ein spaeter geaenderter
--      Katalog macht sie nicht rueckwirkend falsch besetzt.
--   3. Beide Bereiche einer Zeile werden nachgezogen, der alte und der neue --
--      heute aendert kein Weg den Bereich einer Anforderung, aber ein Ausloeser,
--      der sich darauf verlaesst, laege beim ersten Import daneben.
--   4. Geschrieben wird nur, was sich aendert (is distinct from), damit ein
--      Eintrag ohne Wirkung keine Protokollzeile je Schicht erzeugt.
--
-- Eigentum (K-01): cse_definer, fester search_path, kein EXECUTE fuer PUBLIC.
-- cse_definer liest einsatz (e_definer), einsatzanforderung (ea_definer),
-- nachweis und bewacher_eintrag (0394) und schreibt auf einsatz genau die zwei
-- Spalten, die 0394 ihm gibt (anforderung_snapshot, anforderung_erfuellt) --
-- ueber die Update-Policies e_definer_besetzung und e_definer_status. Neue
-- Rechte braucht dieser Ausloeser deshalb nicht; die Pruefung steht in
-- tests/isolation/anforderung-pflege.test.ts.
-- ===========================================================================

create function kern.einsatzanforderung_nachziehen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_bereiche jsonb := jsonb_build_array(jsonb_build_object(
    'mandant', new.mandant_id, 'bereich', new.geltungsbereich,
    'posten', new.posten_id, 'veranstaltung', new.veranstaltung_id,
    'objekt', new.objekt_id));
  b jsonb;
begin
  if tg_op = 'UPDATE' and (old.geltungsbereich, old.posten_id, old.veranstaltung_id,
                            old.objekt_id, old.mandant_id)
                          is distinct from
                          (new.geltungsbereich, new.posten_id, new.veranstaltung_id,
                           new.objekt_id, new.mandant_id) then
    v_bereiche := v_bereiche || jsonb_build_array(jsonb_build_object(
      'mandant', old.mandant_id, 'bereich', old.geltungsbereich,
      'posten', old.posten_id, 'veranstaltung', old.veranstaltung_id,
      'objekt', old.objekt_id));
  end if;

  for b in select * from jsonb_array_elements(v_bereiche) loop
    update public.einsatz e
       set anforderung_snapshot = kern.anforderung_aufloesen(
             e.mandant_id, e.objekt_id, e.posten_id, e.veranstaltung_id, e.beginn_zeitpunkt)
     where e.mandant_id = (b->>'mandant')::uuid
       and e.storniert_am is null
       and e.beginn_zeitpunkt > now()
       and (   b->>'bereich' = 'mandant'
            or (b->>'bereich' = 'posten'        and e.posten_id        = (b->>'posten')::uuid)
            or (b->>'bereich' = 'veranstaltung' and e.veranstaltung_id = (b->>'veranstaltung')::uuid)
            or (b->>'bereich' = 'objekt'        and e.objekt_id        = (b->>'objekt')::uuid))
       and e.anforderung_snapshot is distinct from kern.anforderung_aufloesen(
             e.mandant_id, e.objekt_id, e.posten_id, e.veranstaltung_id, e.beginn_zeitpunkt);

    update public.einsatz e
       set anforderung_erfuellt = kern.anforderung_mischung(e.id, e.anforderung_snapshot)
     where e.mandant_id = (b->>'mandant')::uuid
       and e.storniert_am is null
       and e.beginn_zeitpunkt > now()
       and (   b->>'bereich' = 'mandant'
            or (b->>'bereich' = 'posten'        and e.posten_id        = (b->>'posten')::uuid)
            or (b->>'bereich' = 'veranstaltung' and e.veranstaltung_id = (b->>'veranstaltung')::uuid)
            or (b->>'bereich' = 'objekt'        and e.objekt_id        = (b->>'objekt')::uuid))
       and e.anforderung_erfuellt is distinct from
           kern.anforderung_mischung(e.id, e.anforderung_snapshot);
  end loop;
  return null;
end $$;

comment on function kern.einsatzanforderung_nachziehen() is
  'V-179, D-673: ein neuer oder geaenderter Eintrag in einsatzanforderung zieht Schnappschuss und '
  'Mischungsbewertung jeder KUENFTIGEN, nicht stornierten Schicht seines Bereichs nach (0394). '
  'Begonnene Schichten bleiben eingefroren.';

alter function kern.einsatzanforderung_nachziehen() owner to cse_definer;
revoke execute on function kern.einsatzanforderung_nachziehen() from public;

create trigger trg_einsatzanforderung_nachziehen
  after insert or update on einsatzanforderung
  for each row execute function kern.einsatzanforderung_nachziehen();
