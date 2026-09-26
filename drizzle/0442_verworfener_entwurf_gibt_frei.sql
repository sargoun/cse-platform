-- 0442 — ein verworfener Entwurf gibt seine Ansprueche frei (FIN-07, FIN-08, V-207, D-700).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- Die Doppelabrechnungssperre haengt an rechnungsposition_quelle.wirksam
-- (0107): solange eine Herkunft wirksam ist, ist ihre Stunde, ihr Abruf,
-- ihre Ausgabe und — seit V-207 — der Monat ihrer Pauschale beansprucht.
-- 0107 sagt, wann der Anspruch erlischt: "sobald die Rechnung storniert
-- oder der Entwurf verworfen ist". Das Storno tat es (storniere ruft
-- gibQuellenFrei), das Verwerfen nie: verwerfe setzte nur den Zustand.
-- Ein verworfener Entwurf hielt seine Ansprueche damit fuer immer — die
-- Ausgabe liess sich nicht mehr weiterberechnen (quelle_ausgabe_uk), der
-- Abruf nicht mehr abrechnen (quelle_sonderleistung_uk), und die Seite
-- "Entwurf verwerfen" versprach das Gegenteil. Ebenso hielt ein verworfener
-- Schlussrechnungsentwurf seine abgezogenen Abschlaege (arb_abschlag_einmal_uk,
-- 0117) gegen jede naechste Schlussrechnung fest.
--
-- ===========================================================================
-- Was hier steht
-- ===========================================================================
--
-- 1. verwerfe (finanz/rechnung.ts) gibt seit V-207 die Herkunft und die
--    Abzuege frei. Das ist ein UPDATE auf zwei Tabellen, deren Policies
--    (t_mandant aus 0107 und 0117) finanzen.schreiben verlangen — oder bei
--    der Herkunft finanzen.stornieren. Verwerfen darf aber, wer
--    finanzen.entwurf_verwerfen haelt (t_verwerfen, 0075), und das ist fuer
--    leitung bindbar, ohne finanzen.schreiben. Ohne eigene Policy stuende
--    dort ein "new row violates row-level security policy" — das Verwerfen
--    ginge fuer diese Rolle gar nicht mehr.
--
--    Deshalb je eine ENGE Update-Policy: nur fuer das Recht zum Verwerfen,
--    nur an einem VERWORFENEN Beleg, und nur in eine Richtung (wirksam
--    faellt). Was sich sonst an einer Herkunft aendern darf, haelt
--    fin.quelle_unveraenderlich (0107) ohnehin: an einem verworfenen Beleg
--    genau wirksam, und nur nach unten. Die Ruecknahme eines Abzugs prueft
--    fin.abschlag_pruefen seit 0441 nicht mehr gegen die Bedingungen seines
--    Entstehens.
--
-- 2. Die Nachholung: was bis heute verworfen wurde, gibt jetzt frei.
--    Invariante 8 bleibt gewahrt — keine Zeile verschwindet, wirksam faellt.

create policy t_verwerfen_gibt_frei on rechnungsposition_quelle for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and wirksam
              and (select app.hat_recht('finanzen.entwurf_verwerfen', app.aktiver_mandant()))
              and exists (select 1 from rechnung r
                           where r.mandant_id = rechnungsposition_quelle.mandant_id
                             and r.id = rechnungsposition_quelle.rechnung_id
                             and r.status = 'verworfen'))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and not wirksam
              and (select app.hat_recht('finanzen.entwurf_verwerfen', app.aktiver_mandant())));

create policy t_verwerfen_gibt_frei on abschlagsrechnung_bezug for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and wirksam
              and (select app.hat_recht('finanzen.entwurf_verwerfen', app.aktiver_mandant()))
              and exists (select 1 from rechnung r
                           where r.mandant_id = abschlagsrechnung_bezug.mandant_id
                             and r.id = abschlagsrechnung_bezug.schluss_rechnung_id
                             and r.status = 'verworfen'))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and not wirksam
              and (select app.hat_recht('finanzen.entwurf_verwerfen', app.aktiver_mandant())));

comment on policy t_verwerfen_gibt_frei on rechnungsposition_quelle is
  'V-207 (0442): wer einen Entwurf verwerfen darf, gibt dessen Herkunft frei — nur an einem '
  'verworfenen Beleg und nur wirksam nach unten.';
comment on policy t_verwerfen_gibt_frei on abschlagsrechnung_bezug is
  'V-207 (0442): ein verworfener Schlussrechnungsentwurf gibt seine abgezogenen Abschlaege frei.';

-- Die Nachholung fuer alles, was vor dieser Migration verworfen wurde.
update rechnungsposition_quelle q
   set wirksam = false, geaendert_am = now()
  from rechnung r
 where r.mandant_id = q.mandant_id and r.id = q.rechnung_id
   and r.status = 'verworfen' and q.wirksam;

update abschlagsrechnung_bezug b
   set wirksam = false
  from rechnung r
 where r.mandant_id = b.mandant_id and r.id = b.schluss_rechnung_id
   and r.status = 'verworfen' and b.wirksam;
