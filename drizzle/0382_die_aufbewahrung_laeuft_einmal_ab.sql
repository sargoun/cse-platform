-- 0382 — die Aufbewahrung laeuft auch wirklich ab (V-116, DOC-07, LEG-01,
-- § 147 AO, Art. 5 Abs. 1 lit. e DSGVO).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- `services/dokument/loeschung.ts` ist der EINE Weg, auf dem ein Dokument
-- samt Datei verschwindet: Loeschsperre, Buchungsbezug und Grund werden
-- geprueft, Zeile und Objekt fallen zusammen oder gar nicht. Gebaut, mit
-- Pruefungen abgedeckt — und im ganzen Baum **ohne Aufrufer ausser dem
-- Test** (gefunden von `tests/kern/dienst-verdrahtung.test.ts`).
--
-- `/datenschutz/loeschkonzept` nennt derweil je Dokumentklasse eine Frist
-- und ihre Grundlage. Wer das liest, liest eine Zusage: nach dieser Frist
-- ist das Dokument fort. Es war niemand da, der sie einloest — und eine
-- Aufbewahrungsfrist, die nur ABLAEUFT, ohne dass etwas geschieht, ist nach
-- Art. 5 Abs. 1 lit. e DSGVO genau der Zustand, den man nicht haben darf.
--
-- ===========================================================================
-- Warum dieser Lauf KEINE Rechtsregel erfindet
-- ===========================================================================
--
-- Die Fristen je Kategorie sind bis heute grossenteils offen (O-25, O-46).
-- Das ist gerade der Grund, warum dieser Lauf gebaut werden DARF: die
-- Datenbank entscheidet es, nicht er.
--
-- `kern.setze_aufbewahrung` (0009) setzt beim Anlegen:
--
--   * keine Regel fuer die Kategorie  → aufbewahrung_bis = NULL,
--                                       loeschsperre     = true
--   * Regel ist ein Platzhalter       → loeschsperre     = true
--   * entschiedene Regel mit `jahre`  → aufbewahrung_bis = 31.12. (Jahr + n)
--
-- „Keine Regel" heisst nicht „keine Pflicht", sondern „niemand hat
-- entschieden" — und eine unbekannte Pflicht wird als Pflicht behandelt
-- (K-17). `04-SEITENKARTE.md` §5.16 sagt es woertlich: „Until the rest are
-- answered `aufbewahrung_bis` stays NULL, `loeschsperre` stays true, and the
-- purge job considers no row."
--
-- Dieser Lauf ist dieser purge job. Er rechnet keine Frist aus, er liest
-- `aufbewahrung_bis`. Eine Frist, die der Nachtlauf selbst rechnet, aenderte
-- rueckwirkend, was gestern galt.
--
-- ===========================================================================
-- Was dem Lauf gegeben wird — und was ausdruecklich nicht
-- ===========================================================================
--
-- `0139` gibt `cse_job` auf `dokument` nur `select, insert`: er legt
-- Archivbelege ab und liest. Zum Loeschen fehlt ihm das Recht vollstaendig
-- — derselbe Befund wie V-119 eine Tabelle weiter, nur diesmal VOR dem
-- ersten naechtlichen Versuch gefunden.
--
-- Gegeben werden deshalb genau drei Spalten. `grant update on dokument`
-- ohne Spaltenliste machte den Nachtlauf zu dem einen Weg, auf dem sich
-- `bucket`, `objekt_schluessel` oder `loeschsperre` einer archivierten
-- Rechnung nachts aendern lassen.
--
-- `delete` bleibt entzogen (0009:295, Invariante 8). Was hier geschieht,
-- ist ein weiches Loeschen mit Grund; die Datei im Bucket entfernt der
-- Dienst, nachdem die Zeile steht.

grant update (geloescht_am, geloescht_von, loeschgrund) on dokument to cse_job;

-- ---------------------------------------------------------------------------
-- Die Policy traegt die Bedingung ein zweites Mal — mit Absicht
-- ---------------------------------------------------------------------------
--
-- `trg_dokument_loeschsperre` und `fin.dokument_haengt_an_buchung` halten
-- beide schon. Die Policy wiederholt die Frist und die Sperre trotzdem,
-- weil die beiden Ausloeser eine ANDERE Frage beantworten: sie sagen „diese
-- Zeile darf nicht weg". Die Policy sagt, welche Zeilen dieser Lauf
-- ueberhaupt anfassen darf — und das ist die Menge, die eine Pruefung liest,
-- wenn sie wissen will, was ein Nachtlauf im schlimmsten Fall kann.
--
-- `not app.ist_readonly()` steht mit drin (V-119): ein Lauf, der
-- `nurLesen: false` vergisst, scheitert dann sichtbar an der Policy, statt
-- still nichts zu tun.
--
-- `aufbewahrung_bis <= app.berlin_heute()` und nicht `current_date`: der
-- Stichtag ist der Berliner Kalendertag (V-103). Zwischen 00:00 und 02:00
-- Berliner Zeit sind die beiden verschieden, und der Lauf laeuft nachts.

create policy j_dokument_aufbewahrung_abgelaufen on dokument for update to cse_job
  using (
    mandant_id = app.aktiver_mandant()
    and not app.ist_readonly()
    and geloescht_am is null
    and not loeschsperre
    and aufbewahrung_bis is not null
    and aufbewahrung_bis <= app.berlin_heute()
  )
  with check (
    mandant_id = app.aktiver_mandant()
    and not app.ist_readonly()
    and geloescht_am is not null
    and loeschgrund is not null
  );

comment on policy j_dokument_aufbewahrung_abgelaufen on dokument is
  'V-116, DOC-07, LEG-01. `job:dokument_aufbewahrung` loescht weich, was '
  'seine Aufbewahrungsfrist hinter sich hat — und NUR das. Eine offene oder '
  'eine Platzhalter-Frist traegt loeschsperre = true (0009), faellt also '
  'schon aus dem using heraus: der Lauf sieht sie nicht. Das with check '
  'verlangt einen Grund, weil eine Loeschung ohne Grund im Streit wertlos '
  'ist.';

-- ---------------------------------------------------------------------------
-- Und warum der Lauf `je_mandant` ist und nicht `uebergreifend`
-- ---------------------------------------------------------------------------
--
-- `j_dokument_lesen` haengt seit 0139 an `mandant_id = app.aktiver_mandant()`
-- und traegt NICHT `using (true)`. Ein Lauf, der wie `bewerber_loeschung`
-- mit `alsJobRolle` quer ueber alle Gesellschaften suchte, faende hier
-- schlicht null Zeilen — jede Nacht, ohne ein rotes Zeichen.
--
-- Gesucht wird deshalb INNERHALB der gebundenen Sitzung. Was der Lauf
-- findet, ist damit genau das, was er auch anfassen darf; die beiden Mengen
-- koennen nicht auseinanderlaufen.

comment on policy j_dokument_lesen on dokument is
  'An app.aktiver_mandant() gebunden und bewusst NICHT using (true): '
  'job:dokument_aufbewahrung sucht deshalb je Mandant in der gebundenen '
  'Sitzung. Geloescht wird ueber j_dokument_aufbewahrung_abgelaufen, '
  'angelegt ueber j_dokument_anlegen.';
