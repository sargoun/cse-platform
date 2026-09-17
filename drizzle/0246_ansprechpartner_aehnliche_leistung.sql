-- 0246 — `ansprechpartner.aehnliche_leistung`: die vierte Bedingung des
-- § 7 Abs. 3 UWG, als festgehaltene menschliche Feststellung
-- (CRM-08, LEG-08, 05-API-KARTE §C.7).
--
-- ===========================================================================
-- Warum eine Spalte und nicht ein berechnetes Kennzeichen
-- ===========================================================================
--
-- § 7 Abs. 3 UWG erlaubt Werbung an einen Bestandskunden nur unter VIER
-- Bedingungen zugleich: die Adresse wurde im Zusammenhang mit einem Verkauf
-- erhoben, sie wird fuer Werbung fuer EIGENE AEHNLICHE Waren oder
-- Dienstleistungen verwendet, der Kunde hat nicht widersprochen, und er wurde
-- bei der Erhebung auf sein Widerspruchsrecht hingewiesen.
--
-- Die zweite ist die, die diese Gruppe wirklich trifft: die vier Bereiche sind
-- Reinigung, Sicherheit, Hochbau und Betrieb. Ob das Sicherheitsangebot an
-- einen Reinigungskunden eine „aehnliche eigene Dienstleistung" ist, ist eine
-- RECHTLICHE WERTUNG — und keine, die dieser Quelltext treffen darf
-- (05-API-KARTE §C.7: „a recorded human determination on the contact with its
-- own justification text, not a computed flag").
--
-- Deshalb: eine Spalte mit Vorgabe `false`, eine Pflichtbegruendung, und keine
-- Ableitung aus Bereich oder Branche.
--
-- TODO(client, O-95): Wurde die E-Mail-Adresse jeweils im Rahmen eines
-- Verkaufs erhoben, gilt das Angebot eines anderen Geschaeftsbereichs als
-- „aehnliche eigene Ware oder Dienstleistung", und lag der Hinweis auf das
-- Widerspruchsrecht schon bei der Erhebung vor?
--
-- ===========================================================================
-- Was diese Migration ausdruecklich NICHT tut
-- ===========================================================================
--
-- Sie aendert `app.darf_kontaktiert_werden` NICHT.
--
-- Die Matrix in 05-API-KARTE §C.7 verlangt zwei Verschaerfungen, die das Tor
-- heute nicht kennt: `bestandskunde` duerfte nur mit
-- `aehnliche_leistung = true` bewerben, und `anfrage` gar nicht. Das Tor prueft
-- statt dessen `rechtsgrundlage <> 'keine'` und laesst beides durch.
--
-- Diese Abweichung wird hier SICHTBAR gemacht und nicht heimlich behoben, und
-- zwar aus einem nachpruefbaren Grund: die heutige Semantik ist von
-- Isolationstests einer anderen Domaene festgeschrieben
-- (`tests/isolation/uwg.test.ts` setzt `bestandskunde` und erwartet `true`).
-- Ein Tor, dessen Bedeutung sich zwischen zwei Migrationen aendert, ohne dass
-- die Zusagen darueber mitwandern, ist genau der stille Fehler, den CRM-08
-- verhindern soll. Die Wertung gehoert vor die Verschaerfung.
--
-- Bis dahin: die Spalte wird ERFASST, die Matrix steht als geprueftes,
-- reines Praedikat in `server/services/crm/uwg-matrix.ts`, und die Oberflaeche
-- stellt beide Antworten nebeneinander — die des Tores (wirksam) und die der
-- Matrix (noch nicht wirksam), mit der offenen Nummer daneben.
--
-- TODO(client, O-660): Soll `app.darf_kontaktiert_werden` auf die Matrix des
-- § 7 Abs. 3 UWG umgestellt werden — Werbung an `bestandskunde` nur mit
-- `aehnliche_leistung`, Werbung an `anfrage` gar nicht?

alter table ansprechpartner
  add column aehnliche_leistung boolean not null default false,
  add column aehnliche_leistung_begruendung text;

-- Eine Feststellung ohne Begruendung ist in einer Abmahnung nichts wert —
-- dieselbe Begruendung wie bei `ansprechpartner_grundlage_belegt` (0020).
alter table ansprechpartner
  add constraint ansprechpartner_aehnliche_leistung_begruendet
    check (not aehnliche_leistung
           or (aehnliche_leistung_begruendung is not null
               and btrim(aehnliche_leistung_begruendung) <> ''));

comment on column ansprechpartner.aehnliche_leistung is
  '§ 7 Abs. 3 Nr. 2 UWG: ob die Werbung eigene AEHNLICHE Waren oder '
  'Dienstleistungen betrifft. Eine festgehaltene menschliche Wertung, kein '
  'abgeleitetes Kennzeichen (O-95). Vorgabe false — fail closed.';

comment on column ansprechpartner.aehnliche_leistung_begruendung is
  'Warum die Leistung als aehnlich gilt. Pflicht, sobald das Kennzeichen '
  'gesetzt ist: eine Wertung, die niemand begruendet hat, ist kein Nachweis.';

-- ---------------------------------------------------------------------------
-- Die Rechte — die Spalte gehoert in den K-05-Block
-- ---------------------------------------------------------------------------
--
-- Auf `ansprechpartner` hat `cse_app` kein Tabellen-SELECT; der
-- Rechtsgrundlagen-Block (`rechtsgrundlage`, `.._quelle`, `.._erfasst_am`,
-- `.._beleg_dokument_id`, `einwilligung_kanaele`, `werbewiderspruch_am`,
-- `widerspruch_am`) hat nur INSERT und UPDATE. Diese zwei Spalten gehoeren
-- fachlich in denselben Block: sie sind Teil desselben Nachweises.
--
-- Es wird deshalb KEIN `grant select` erteilt. Gelesen werden sie ueber die
-- Definer aus 0247, die `crm.rechtsgrundlage_lesen` pruefen und den Abruf
-- protokollieren (LEG-08). Geschrieben werden sie ueber 0248.
--
-- Das ist kein Umweg, sondern der Grund, warum der Entzug spaltenweise ist:
-- ein `select *` auf `ansprechpartner` — in einem Export, einem Bericht, einer
-- Fehlermeldung — trug den Einwilligungsnachweis sonst ungeprueft und
-- unprotokolliert mit sich.
--
-- `cse_definer` haelt auf dieser Tabelle ein TABELLEN-select (0222, Zeile 292)
-- und deckt neue Spalten damit von selbst — hier steht deshalb keine zweite
-- Erteilung, sondern nur der Satz, warum keine fehlt.
