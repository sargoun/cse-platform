-- 0531 — Die eigene Freistellungsbescheinigung der Gesellschaft hat einen Ort
--        (V-388, O-130, D-803, D-846, Paragraph 48, 48b EStG)
--
-- Der Befund: freistellungsbescheinigung (0118) verlangt genau einen Traeger,
-- einen Kunden ODER einen Lieferanten (fsb_genau_ein_traeger). Die
-- Bescheinigung, auf die es bei einer AUSGANGSrechnung ueber eine Bauleistung
-- ankommt, ist aber keine von beiden: es ist die der Gesellschaft selbst.
-- Paragraph 48 Abs. 2 EStG: der Leistungsempfaenger (der Kunde) muss nicht
-- einbehalten, wenn der LEISTENDE (die Gesellschaft) ihm eine gueltige
-- Bescheinigung vorlegt. Die des Kunden befreit ihn, wenn er selbst baut —
-- nicht uns. Bisher las die Ausgangsrechnung die Bescheinigung des Kunden
-- (steuerfall.ts) und schrieb im Beleg freistellungsbescheinigung: null.
--
-- 1. Eine Zeile ohne Kunde und ohne Lieferant ist die eigene Bescheinigung
--    der Gesellschaft (ausgestellt von ihrem Finanzamt). Die Pruefung wird
--    von „genau einer" zu „hoechstens einer".
-- 2. Alles andere bleibt: Nummer je Gesellschaft einmal, Zeitraum, Umfang
--    mit Auftrag (eine auftragsbezogene eigene Bescheinigung gilt fuer den
--    Auftrag, fuer den das Finanzamt sie ausgestellt hat), Widerruf nie
--    rueckwirkend, und 0530 haelt auch sie nach dem Anlegen fest.
--
-- Ob eine Gesellschaft eine haelt und bis wann, traegt der Betreiber ein
-- (O-130, D-803); die Plattform erfindet keine.
--
-- Nur Kommentare mit Doppelstrich.

alter table freistellungsbescheinigung
  drop constraint fsb_genau_ein_traeger,
  add constraint fsb_hoechstens_ein_traeger check (num_nonnulls(kunde_id, lieferant_id) <= 1);

create index fsb_eigene_idx on freistellungsbescheinigung (mandant_id, gueltig_bis desc)
  where kunde_id is null and lieferant_id is null;

comment on constraint fsb_hoechstens_ein_traeger on freistellungsbescheinigung is
  'V-388, D-846: Kunde ODER Lieferant ODER keiner von beiden — dann ist es die eigene '
  'Bescheinigung der Gesellschaft, die bei Ausgangsrechnungen ueber Bauleistungen zaehlt '
  '(Paragraph 48 Abs. 2 EStG).';

-- 3. Der Nachtlauf freistellung_ablauf (V-388, O-130) liest die eigenen
--    Bescheinigungen ueber alle Gesellschaften als cse_job (alsJobRolle,
--    nur lesend) — nicht unter der Rolle, die in DATABASE_URL steht (D-378).
--    Er bekommt genau die Spalten, die der Hinweis braucht, und nur die
--    eigenen Bescheinigungen: die eines Kunden oder Lieferanten sieht er nicht.
grant select (id, mandant_id, kunde_id, lieferant_id, bescheinigung_nummer, gueltig_von,
              gueltig_bis, widerrufen_am, umfang, auftrag_id)
  on freistellungsbescheinigung to cse_job;

create policy j_eigene_freistellung_lesen on freistellungsbescheinigung for select to cse_job
  using (kunde_id is null and lieferant_id is null);

-- Von der Gesellschaft liest er Kennung und Slug schon (j_mandant_lesen);
-- dazu, ob sie archiviert ist — eine archivierte erinnert er nicht.
grant select (archiviert_am) on mandant to cse_job;

comment on policy j_eigene_freistellung_lesen on freistellungsbescheinigung is
  'V-388, D-846: der Nachtlauf freistellung_ablauf liest die eigenen Bescheinigungen aller '
  'Gesellschaften (Kunde und Lieferant leer) — und nur sie.';
