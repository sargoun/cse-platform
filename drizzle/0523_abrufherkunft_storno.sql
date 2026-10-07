-- 0523 — Eine Abrufherkunft uebersteht das Storno (V-395, D-832)
--
-- Der Befund (gefunden beim Bau von V-356, D-831): eine Rechnung mit einer
-- Zeile aus einem Einzelabruf liess sich nicht stornieren. uebernimmQuellen
-- (finanz/rechnung.ts) kopierte sonderleistung_id nicht mit, die Stornozeile
-- trug damit eine Herkunft vom Typ sonderleistung ohne Abruf, und
-- rpq_genau_eine_quelle (0112) wies sie ab. Behoben ist das im Dienst; hier
-- steht, was die Datenbank dazu beitraegt:
--
-- 1. fin.abrufstatus_nachziehen(p_rechnung) — der Status eines Einzelabrufs
--    folgt seiner Herkunft. Er ist abgerechnet, solange eine WIRKSAME
--    Herkunft auf einem festgeschriebenen Beleg ihn nennt, und sonst wieder
--    erbracht. Nur zwischen diesen beiden Werten: angefragt, beauftragt,
--    geplant und storniert bleiben, wie sie sind. Gerufen von
--    markiereQuellenAbgerechnet (Festschreibung) und gibQuellenFrei (Storno
--    und Verwerfen) in positionsquelle.ts.
--
--    Ein Definer, weil der Status hinter reinigung.schreiben liegt (t_mandant,
--    0067) und eine Festschreibung oder ein Storno dieses Recht nicht
--    voraussetzt. Unter FORCE RLS traf das UPDATE fuer eine solche Rolle
--    null Zeilen, ohne Fehler — der Abruf blieb nach der Rechnung erbracht und
--    damit wieder abrechenbar (nur quelle_sonderleistung_uk stand noch
--    dazwischen), und nach einem Storno bliebe er abgerechnet und kaeme auf
--    keine Rechnung mehr. Die Funktion verlangt eines der drei Finanzrechte,
--    die eine Herkunft beanspruchen oder freigeben, und setzt nur, was die
--    Herkunft ergibt — sie nimmt keinen Status als Eingabe.
--
-- 2. cse_definer liest den Abruf und schreibt seinen Status — beides auf den
--    aktiven Mandanten begrenzt, und nur die Spalten, die die Funktion
--    braucht (K-01, K-05).
--
-- 3. Die Nachholung: ein Abruf, dessen wirksame Herkunft auf einem
--    festgeschriebenen Beleg steht, der aber noch erbracht heisst, wird
--    abgerechnet. Die Gegenrichtung braucht keine Nachholung: ein Storno
--    ueber einen Abruf ist bis hierher nie gelungen.
--
-- Nur Kommentare mit Doppelstrich.

grant select (id, mandant_id, status) on sonderleistung to cse_definer;
grant update (status) on sonderleistung to cse_definer;

create policy d_abrufstatus_lesen on sonderleistung for select to cse_definer
  using (mandant_id = app.aktiver_mandant());

create policy d_abrufstatus_schreiben on sonderleistung for update to cse_definer
  using      (mandant_id = app.aktiver_mandant())
  with check (mandant_id = app.aktiver_mandant());

comment on policy d_abrufstatus_lesen on sonderleistung is
  'V-395 (0523): fin.abrufstatus_nachziehen liest den Status der Abrufe einer Rechnung.';
comment on policy d_abrufstatus_schreiben on sonderleistung is
  'V-395 (0523): fin.abrufstatus_nachziehen setzt abgerechnet oder erbracht, wie die Herkunft es ergibt.';

create function fin.abrufstatus_nachziehen(p_rechnung uuid) returns integer
language plpgsql security definer
set search_path = pg_catalog, public, app as $$
declare
  v_mandant uuid := app.aktiver_mandant();
  v_anzahl integer;
begin
  if v_mandant is null or app.ist_readonly()
     or not (app.hat_recht('finanzen.festschreiben', v_mandant)
             or app.hat_recht('finanzen.stornieren', v_mandant)
             or app.hat_recht('finanzen.entwurf_verwerfen', v_mandant)) then
    raise exception 'Den Abrufstatus zieht nur nach, wer Rechnungen festschreiben, stornieren oder verwerfen darf (V-395)'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.rechnung r
                  where r.mandant_id = v_mandant and r.id = p_rechnung) then
    raise exception 'Rechnung % gehoert nicht zur aktiven Gesellschaft', p_rechnung
      using errcode = 'no_data_found';
  end if;

  with betroffen as (
    select distinct q.sonderleistung_id as id
      from public.rechnungsposition_quelle q
     where q.mandant_id = v_mandant and q.rechnung_id = p_rechnung
       and q.quelle_typ = 'sonderleistung' and q.sonderleistung_id is not null
  ), soll as (
    select b.id,
           exists (select 1
                     from public.rechnungsposition_quelle w
                     join public.rechnung wr
                       on wr.mandant_id = w.mandant_id and wr.id = w.rechnung_id
                    where w.mandant_id = v_mandant and w.sonderleistung_id = b.id
                      and w.quelle_typ = 'sonderleistung' and w.wirksam
                      and wr.status = 'festgeschrieben') as abgerechnet
      from betroffen b
  )
  update public.sonderleistung s
     set status = case when soll.abgerechnet then 'abgerechnet' else 'erbracht' end
                  ::public.sonderleistung_status
    from soll
   where s.mandant_id = v_mandant and s.id = soll.id
     and ((soll.abgerechnet and s.status = 'erbracht')
          or (not soll.abgerechnet and s.status = 'abgerechnet'));
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end $$;

comment on function fin.abrufstatus_nachziehen(uuid) is
  'V-395, D-832. Der Status der Einzelabrufe einer Rechnung folgt ihrer Herkunft: abgerechnet, '
  'solange eine wirksame Herkunft auf einem festgeschriebenen Beleg sie nennt, sonst erbracht. '
  'Gibt die Zahl der geaenderten Abrufe zurueck.';

alter function fin.abrufstatus_nachziehen(uuid) owner to cse_definer;
revoke execute on function fin.abrufstatus_nachziehen(uuid) from public;
grant execute on function fin.abrufstatus_nachziehen(uuid) to cse_app;

-- Die Nachholung (3).
update sonderleistung s
   set status = 'abgerechnet'
 where s.status = 'erbracht'
   and exists (select 1
                 from rechnungsposition_quelle w
                 join rechnung wr on wr.mandant_id = w.mandant_id and wr.id = w.rechnung_id
                where w.mandant_id = s.mandant_id and w.sonderleistung_id = s.id
                  and w.quelle_typ = 'sonderleistung' and w.wirksam
                  and wr.status = 'festgeschrieben');
