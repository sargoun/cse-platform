-- ===========================================================================
-- 0410 — Eine Referenz weiss, aus welchem Auftrag sie stammt (V-161, PRO-05)
-- ===========================================================================
-- **Der Befund.** SPEC PRO-05: eine Referenz ist ein ABGESCHLOSSENER Auftrag
-- mit Kundenfreigabe, kein von Hand getippter Werbeeintrag. V-154 legte sie
-- frei an: Titel, Kunde und Text beliebig, der Verweis von der
-- Kundenfreigabe am Auftrag verlangte nur eine geltende Freigabe und keinen
-- Abschluss. Und das Referenzblatt nahm die Kennung des Auftrags aus der
-- Adresse (?auftrag=...) und schlug Datum und Beleg IRGENDEINES Auftrags der
-- Gesellschaft vor, ohne zu wissen, ob die Referenz aus ihm stammt.
--
-- **Die Entscheidung (D-654).** Eine neue Referenz entsteht nur noch aus
-- einem abgeschlossenen Auftrag mit geltender Kundenfreigabe, und sie haelt
-- fest, aus WELCHEM: referenz.auftrag_id. Die Pruefung auf Abschluss und
-- Freigabe steht im Dienst (services/inhalt/redaktion.ts, legeReferenzAn),
-- weil sie nur beim Anlegen gilt; die Tabelle haelt die Herkunft und ihre
-- Unveraenderlichkeit.
--
-- **Herkunft ist keine Kopplung.** O-735 und der Kommentar an
-- ladeFreigabestand hielten fest, dass referenz bewusst keinen Fremdschluessel
-- auf auftrag traegt: PRO-05 trennt den Beleg (am Auftrag) von der
-- Veroeffentlichung (die Referenz mit eigener Freigabe), ein Widerruf am
-- Auftrag entfernt keine Referenz, und der Kunde heisst oeffentlich manchmal
-- anders als in der Kundenakte. Nichts davon aendert sich: der Schluessel
-- kaskadiert nicht, kein Ausloeser auf auftrag liest ihn, und die Referenz
-- traegt weiter ihre eigene Freigabe mit Datum und Beleg. Er sagt nur, woher
-- sie kommt.
--
-- **Zusammengesetzt, damit die Gesellschaft stimmt.** (mandant_id,
-- auftrag_id) zeigt auf auftrag (mandant_id, id), den Schluessel
-- auftrag_mandant_uk aus 0025. Eine Referenz der Reinigung kann damit nicht
-- auf einen Auftrag von Bau zeigen, auch nicht ueber einen praeparierten
-- POST und auch nicht in einer Sitzung, die beide Gesellschaften lesen darf.
--
-- **Altbestand.** Zeilen aus der Zeit vor V-161 (die Demoreferenzen aus
-- seed/social.ts, D-537) tragen null. Sie bleiben, wie sie sind; eine
-- nachtraegliche Zuordnung gibt es nicht, weil sie eine Behauptung ueber
-- einen Auftrag waere, die beim Anlegen niemand geprueft hat.
--
-- Nur Kommentare mit Doppelstrich und keine Backticks, wie 0392 bis 0396.
-- ===========================================================================

alter table referenz add column auftrag_id uuid;

comment on column referenz.auftrag_id is
  'PRO-05, V-161, D-654. Der abgeschlossene Auftrag mit geltender '
  'Kundenfreigabe, aus dem diese Referenz angelegt wurde. Herkunft, keine '
  'Kopplung: kein Kaskadieren, und ein Widerruf am Auftrag entfernt keine '
  'Referenz (O-735). Null nur im Altbestand vor V-161. Unveraenderlich '
  '(kern.referenz_herkunft_fest).';

alter table referenz
  add constraint referenz_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id);

create index referenz_auftrag_idx on referenz (auftrag_id)
  where auftrag_id is not null;

-- ---------------------------------------------------------------------------
-- Die Herkunft ist fest
-- ---------------------------------------------------------------------------
-- cse_app haelt update auf referenz auf Tabellenebene (0015). Ohne diesen
-- Ausloeser liesse sich die Herkunft einer Referenz nachtraeglich auf einen
-- anderen Auftrag umhaengen, und das Blatt schluege dann Datum und Beleg
-- eines Auftrags vor, aus dem sie nie entstand: genau der Befund, gegen den
-- die Spalte steht. Kein Dienst schreibt sie nach dem Anlegen; wer eine
-- falsche Herkunft korrigieren muss, legt die Referenz neu an.

create function kern.referenz_herkunft_fest() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.auftrag_id is distinct from old.auftrag_id then
    raise exception 'Die Herkunft einer Referenz aendert sich nicht'
      using errcode = 'check_violation',
            detail  = 'referenz.auftrag_id haelt fest, aus welchem Auftrag die '
                      || 'Referenz angelegt wurde (PRO-05, D-654).',
            hint    = 'Eine Referenz mit anderer Herkunft wird neu angelegt.';
  end if;
  return new;
end $$;

comment on function kern.referenz_herkunft_fest() is
  'PRO-05, V-161. Haelt referenz.auftrag_id nach dem Anlegen fest.';

create trigger trg_referenz_herkunft_fest
  before update of auftrag_id on referenz
  for each row execute function kern.referenz_herkunft_fest();
