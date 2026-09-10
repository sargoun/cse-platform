-- ---------------------------------------------------------------------------
-- 0019 — Das Unternehmensprofil bekommt eine Sprache (D-82).
--
-- Die Markenkarten unter `/en` und der Bereichswaehler unter `/en/angebot`
-- zeigten die DEUTSCHE `kurzbeschreibung`: eine englische Seite mit vier
-- deutschen Saetzen mittendrin. `seite` loest dasselbe Problem seit 0014 so —
-- `sprache` in der Zeile, Eindeutigkeit ueber `(pfad, sprache)` — und ein
-- zweites Muster fuer dieselbe Frage waere die Stelle, an der eine der beiden
-- Sprachen beim naechsten Feld vergessen wird.
--
-- **Eine eigene Zeile je Sprache, kein Spaltenpaar.** `kurzbeschreibung_en`
-- neben `kurzbeschreibung` haette bei jeder weiteren Sprache eine Migration
-- verlangt, und `status` liesse sich nicht je Sprache setzen: eine
-- Uebersetzung, die noch geprueft wird, waere veroeffentlicht, sobald die
-- deutsche es ist.
-- ---------------------------------------------------------------------------

alter table unternehmensprofil
  add column sprache text not null default 'de'
    check (sprache in ('de','en','ar','tr'));

-- Die alte Eindeutigkeit liess genau eine Zeile je Mandant zu — also genau
-- eine Sprache. Sie wird zur Eindeutigkeit je Mandant UND Sprache.
alter table unternehmensprofil drop constraint unternehmensprofil_uk;

create unique index unternehmensprofil_uk
  on unternehmensprofil (mandant_id, sprache) where geloescht_am is null;

comment on column unternehmensprofil.sprache is
  'D-82. Eine Zeile je Sprache, wie bei `seite` — nicht ein Spaltenpaar.';
