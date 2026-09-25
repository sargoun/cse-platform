-- ===========================================================================
-- 0449 — Die Freigabe friert den Brief der Mahnung ein (V-217, FIN-15, D-709)
-- ===========================================================================
-- **Der Befund** (Pruefung von V-213). Seit V-213 traegt das Mahnschreiben
-- Absender und Pflichtangaben aus mandant (Firma, Anschrift, Telefon, E-Mail,
-- Web, Registergericht, Registernummer, Geschaeftsfuehrung, Steuernummern,
-- Bank) und die (Rechnungs-)Anschrift des Kunden. Der Dienst las all das
-- LIVE, und die Freigabe bindet es ueber den Abdruck der Nutzlast
-- (Invariante 7). Aus freigegeben fuehrt aber kein Weg zurueck: verworfen wird
-- nur ein Entwurf (0130), und fin.mahnung_uebergang laesst nur
-- freigegeben nach versendet zu. Aenderte jemand nach der Freigabe irgendeine
-- dieser Angaben (die Anschrift des Kunden im CRM, eine neue Telefonnummer,
-- einen neuen Geschaeftsfuehrer), passte die Mahnung nie mehr zu ihrer
-- Freigabe: der Versand wurde abgewiesen, verwerfen und neu freigeben ging
-- nicht, und der Mahnlauf sperrte ihre Posten fuer immer (0125, Posten mit
-- Mahnung in entwurf oder freigegeben). Aus einer Pflege der Stammdaten wurde
-- eine haengende Forderung.
--
-- **Was diese Migration anlegt.** Die Spalte brief: was im Schreiben aus
-- Stammdaten kommt (Kundenname, Bezeichnung der Stufe, Absender mit
-- Pflichtangaben, Empfaengeranschrift, Mahntext, Fusszeile), eingefroren im
-- Augenblick der Freigabe, aus DENSELBEN Werten, ueber die der Abdruck
-- gebildet wurde. Ab da liest der Dienst den Brief aus dieser Spalte: die
-- Freigabe passt, das PDF zeigt genau den freigegebenen Brief, und eine
-- spaetere Pflege der Stammdaten wirkt erst auf die naechste Mahnung. Dasselbe
-- Muster wie der Schnappschuss der Rechnung (K-12).
--
--   1. Ein Entwurf traegt keinen eingefrorenen Brief (Pruefbedingung): er
--      zeigt, was heute in den Stammdaten steht.
--   2. Der Uebergang entwurf nach freigegeben verlangt ihn (Ausloeser): es
--      gibt ab hier keine Freigabe mehr, die den Brief nicht festhaelt.
--   3. Danach aendert er sich nie mehr (Ausloeser), auch nicht zwischen
--      Freigabe und Versand. Ab versendet haelt ohnehin
--      mahnung_3_unveraenderlich (0125) die ganze Zeile fest.
--
-- **Der Bestand.** Eine Mahnung, die vor dieser Migration freigegeben wurde,
-- hat keinen eingefrorenen Brief und wird weiter live gelesen; D-705 Punkt 4
-- gilt fuer sie unveraendert (vor dem Einspielen versenden). Eine versendete
-- ohne eingefrorenen Brief zeigt das Mahnungsblatt mit Hinweis auf das
-- abgelegte PDF.
--
-- Der Ausloeser liest keine Tabelle: kein security definer. Sein Name sortiert
-- hinter mahnung_1_uebergang, damit die Meldungen des Uebergangs (Freigabesatz,
-- genehmigt, Nummernkreis) zuerst kommen. Nur Kommentare mit Doppelstrich und
-- keine Backticks: dieselbe Regel wie in 0392 bis 0422.
-- ===========================================================================

alter table mahnung add column brief jsonb;

comment on column mahnung.brief is
  'V-217, D-709. Der Brief, wie er freigegeben wurde: Kundenname, Stufenbezeichnung, Absender '
  'mit Pflichtangaben, Empfaengeranschrift, Mahntext, Fusszeile. NULL im Entwurf; gesetzt '
  'genau beim Uebergang entwurf nach freigegeben, danach unveraenderlich.';

alter table mahnung add constraint mahnung_brief_erst_mit_freigabe
  check (status <> 'entwurf' or brief is null);

alter table mahnung add constraint mahnung_brief_ist_objekt
  check (brief is null or jsonb_typeof(brief) = 'object');

create function fin.mahnung_brief_eingefroren() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status = 'entwurf' and new.status = 'freigegeben' then
    if new.brief is null then
      raise exception
        'Mahnung %: die Freigabe friert den Brief ein, ohne ihn gibt es keine Freigabe (V-217).',
        old.id using errcode = 'check_violation',
                     hint = 'Freigegeben wird ueber den Dienst gibFrei, der den Brief mitschreibt.';
    end if;
    return new;
  end if;

  if new.brief is distinct from old.brief then
    raise exception
      'Mahnung %: der Brief ist mit der Freigabe eingefroren und aendert sich nicht mehr (V-217).',
      coalesce(old.nummer, old.id::text) using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

revoke all on function fin.mahnung_brief_eingefroren() from public;

comment on function fin.mahnung_brief_eingefroren() is
  'V-217, D-709. mahnung.brief entsteht genau beim Uebergang entwurf nach freigegeben und '
  'aendert sich danach nicht mehr.';

create trigger mahnung_4_brief_eingefroren
  before update on mahnung
  for each row execute function fin.mahnung_brief_eingefroren();
