-- =========================================================================
-- 0119 — Der Rechnungskontakt der Gesellschaft (BT-41, BR-DE-6). PR 52.
--
-- **Eine Spalte, und sie schliesst eine Luecke, die erst beim Empfaenger
-- auffaellt.** Die XRechnung-CIUS macht die Gruppe SELLER CONTACT (BG-6) zur
-- Pflicht und darin drei Felder: die Stelle (BT-41), eine Rufnummer (BT-42)
-- und eine E-Mail (BT-43). Zwei davon stehen laengst auf `mandant`
-- (`telefon`, `email`). Das dritte gab es nicht.
--
-- Erfinden liesse es sich leicht — „Buchhaltung" ist in neun von zehn
-- Faellen richtig. Genau deshalb steht es hier NICHT als Vorgabewert: was
-- der oeffentliche Auftraggeber auf der Rechnung liest und wen er anruft,
-- entscheidet die Gesellschaft, nicht die Migration. Bis der Wert gepflegt
-- ist, erzeugt `xrechnung/index.ts` KEIN Dokument und nennt das fehlende
-- Feld beim Namen. Das ist der laute Ausfall; der leise waere ein Dokument,
-- das der Pruefer des Empfaengers ablehnt, nachdem die Rechnung
-- festgeschrieben und damit unveraenderlich ist.
--
-- Kein `not null`: die Spalte gilt fuer vier Gesellschaften, von denen heute
-- keine sie hat, und ein `not null default 'Buchhaltung'` waere dieselbe
-- Erfindung in anderer Schreibweise.
-- =========================================================================

alter table mandant
  add column rechnung_kontakt_name text;

comment on column mandant.rechnung_kontakt_name is
  'BT-41, XRechnung BR-DE-6: die Kontaktstelle auf der Rechnung. NULL, '
  'solange die Gesellschaft sie nicht gepflegt hat — dann entsteht keine '
  'XRechnung, und der Bauer nennt dieses Feld. BT-42 und BT-43 sind '
  'mandant.telefon und mandant.email.';

-- KEIN GRANT. `mandant` traegt seit 0004 ein TABELLENrecht
-- (`grant select on mandant to cse_app`, seit 0077 ebenso fuer
-- `cse_definer`), und ein Tabellenrecht deckt auch spaeter hinzukommende
-- Spalten. Ein zusaetzliches `grant select (rechnung_kontakt_name)` waere
-- wirkungslos und liesse kuenftige Leser glauben, hier gelte K-05 spaltenweise
-- — dann fehlte beim naechsten `alter table` ein Recht, das nie noetig war.
--
-- Auch kein `grant update`: eine Pflegemaske fuer Stammdaten der Gesellschaft
-- gibt es noch nicht (`/einstellungen/mandant`, Phase 7), und `cse_app` haelt
-- auf `mandant` heute KEIN Schreibrecht. Eines allein fuer diese Spalte zu
-- vergeben, oeffnete einen Schreibweg, den niemand geprueft hat.
