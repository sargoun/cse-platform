-- 0529 — Eine Betroffenenanfrage kommt auch ohne E-Mail-Adresse
--        (V-370, O-892, D-798, D-844, Art. 12 Abs. 1 DSGVO)
--
-- Der Befund: betroffenenanfrage.email ist not null (0176). Seit 0378 nimmt
-- das Buero auch Brief, Anruf und persoenliche Vorsprache auf — aber wer nur
-- eine Anschrift hat, musste trotzdem eine E-Mail-Adresse eintragen, und die
-- Anschrift stand in der Nachricht. Eine erfundene Adresse ist kein Weg, die
-- Antwort zuzustellen, und eine Anschrift im Freitext laesst sich nicht als
-- Empfaenger der Antwort festhalten.
--
-- Die Voreinstellung zu O-892 (D-798): eine rein postalische Anfrage ist ohne
-- E-Mail-Adresse erfassbar, mit Anschrift, und die Antwort geht auf dem Weg,
-- auf dem die Anfrage kam.
--
-- 1. email wird nullbar. Der CHECK aus 0176 (die Form der Adresse) bleibt und
--    gilt weiter fuer jede Adresse, die da ist.
-- 2. anschrift — die Postanschrift der anfragenden Person, wie sie auf dem
--    Brief steht: freier Text in Zeilen, nicht leer, hoechstens 500 Zeichen.
-- 3. Erreichbar ist jede Anfrage: E-Mail ODER Anschrift
--    (betroffenenanfrage_erreichbar).
-- 4. Das oeffentliche Formular verlangt die E-Mail weiter
--    (betroffenenanfrage_formular_mit_email): an sie geht dort die Bestaetigung,
--    und der Eingangsprinzipal kennt keinen anderen Weg.
-- 5. antwortweg — auf welchem Weg die Antwort hinausging, festgehalten bei
--    der Entscheidung: email oder brief. Er muss zur Anfrage passen
--    (betroffenenanfrage_antwortweg_erreichbar): per E-Mail nur mit Adresse,
--    per Brief nur mit Anschrift. Leer bleibt er bei Vorgaengen, die vor
--    dieser Migration entschieden wurden: dort wurde der Weg nicht
--    festgehalten, und ihn nachzutragen hiesse, ihn zu erfinden. Neue
--    Entscheidungen setzt der Dienst immer (datenschutz/anfrage.ts,
--    entscheide).
--
-- Die Plattform versendet nichts (Invariante 7): der Antwortweg ist der
-- Vermerk, wie ein Mensch geantwortet hat.
--
-- Nur Kommentare mit Doppelstrich.

alter table betroffenenanfrage alter column email drop not null;

alter table betroffenenanfrage
  add column anschrift text,
  add column antwortweg text;

alter table betroffenenanfrage
  add constraint betroffenenanfrage_anschrift_form check (
    anschrift is null or (btrim(anschrift) <> '' and length(anschrift) <= 500)),
  add constraint betroffenenanfrage_erreichbar check (
    email is not null or anschrift is not null),
  add constraint betroffenenanfrage_formular_mit_email check (
    eingangsweg <> 'formular' or email is not null),
  add constraint betroffenenanfrage_antwortweg_bekannt check (
    antwortweg is null or antwortweg in ('email', 'brief')),
  add constraint betroffenenanfrage_antwortweg_erreichbar check (
    antwortweg is null
    or (antwortweg = 'email' and email is not null)
    or (antwortweg = 'brief' and anschrift is not null)),
  add constraint betroffenenanfrage_antwortweg_nur_entschieden check (
    antwortweg is null or status in ('beantwortet', 'abgelehnt'));

comment on column betroffenenanfrage.anschrift is
  'V-370, O-892: die Postanschrift der anfragenden Person, wie sie auf dem Brief steht. '
  'Mit ihr ist eine Anfrage auch ohne E-Mail-Adresse erfassbar.';

comment on column betroffenenanfrage.antwortweg is
  'V-370, O-892: auf welchem Weg die Antwort hinausging (email oder brief), '
  'festgehalten bei der Entscheidung. Leer bei Vorgaengen vor 0529.';
