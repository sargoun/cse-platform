-- 0175 — die Löschsperre der Akquisetabellen, nachgezogen (Invariante 8, §12).
--
-- **Was hier repariert wird.** 0172 setzte je einen BEFORE-DELETE-Auslöser von
-- Hand — und damit zwei Dinge falsch:
--
--  1. **Der Name stimmte nicht.** Er hiess `trg_akquise_ziel_kein_loeschen`
--     statt `trg_akquise_ziel_kein_hard_delete`, und damit fand ihn das
--     Register in `src/server/db/schema/rls.ts` nicht. Ein Auslöser, den das
--     Register nicht kennt, ist keine Zusage, sondern ein Zufall.
--  2. **TRUNCATE lief daran vorbei.** Ein BEFORE-DELETE-Auslöser feuert bei
--     `truncate` NICHT — eine einzige Wartungsanweisung hätte die Tabelle
--     geleert, an einer Sperre vorbei, die genau das verhindern soll. Gefunden
--     hat das `tests/isolation/unveraenderbarkeit.test.ts`, der die Datenbank
--     gegen das Register zählt, in BEIDE Richtungen.
--
-- Der Block unten ist erzeugt, nicht geschrieben: `pnpm db:triggers` liest das
-- Register und schreibt ihn. Von Hand gesetzte Auslöser sind genau der Weg,
-- auf dem 0172 danebenlag.

drop trigger if exists trg_akquise_ziel_kein_loeschen   on akquise_ziel;
drop trigger if exists trg_akquise_quelle_kein_loeschen on akquise_quelle;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0175)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- akquise_ziel (archiv): §12. Eine recherchierte Firma, die jemand mit Grund verworfen hat, muss verworfen BLEIBEN — sonst findet dieselbe Recherche sie naechste Woche wieder, und der Vertrieb telefoniert ein zweites Mal hinterher. `archiviert_am` beendet sie.
create trigger trg_akquise_ziel_kein_hard_delete
  before delete on akquise_ziel
  for each row execute function kern.verhindere_loeschung();
create trigger trg_akquise_ziel_kein_truncate
  before truncate on akquise_ziel
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on akquise_ziel from cse_app, cse_anon, cse_checkin, cse_job;

-- akquise_quelle (archiv): §12. Die Quelle traegt die Herkunft jeder Zeile, die ueber sie kam. Sie zu loeschen hiesse, bei hunderten Firmen nicht mehr sagen zu koennen, woher sie stammen — und genau das fragt eine Datenschutzpruefung als erstes. `aktiv = false` legt sie still.
create trigger trg_akquise_quelle_kein_hard_delete
  before delete on akquise_quelle
  for each row execute function kern.verhindere_loeschung();
create trigger trg_akquise_quelle_kein_truncate
  before truncate on akquise_quelle
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on akquise_quelle from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
