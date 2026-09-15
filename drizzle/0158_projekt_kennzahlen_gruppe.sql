-- 0158 — Dieselbe geschützte Zahl, eine Ebene höher: die Gruppenfassung (REP-05).

/**
 * **Die Gruppenansicht stiess auf dieselbe Spaltensperre — und fiel um.**
 *
 * `app.projekt_kennzahlen` (0157) löst K-05 für EINEN Bereich: sie liest
 * `projekt.auftragssumme_netto_cent`, die `cse_app` entzogen ist, und gibt
 * nur die Kennzahl heraus. Die Gruppenfassung las die Spalte weiter direkt —
 * Postgres wies die ganze Anweisung ab, und `/portal/gruppe/berichte/projekte`
 * antwortete mit einem Serverfehler statt mit einer Tabelle. Aufgefallen ist
 * es im Browsertest; in der Entwicklung verbindet der Eigentümer, und dort
 * lief dieselbe Seite.
 *
 * **Warum eine zweite Funktion und nicht ein Parameter an der ersten.**
 * Die erste ist auf `app.aktiver_mandant()` gebaut, und in der Gruppenansicht
 * gibt es den nicht (Invariante 10). Die sichtbare Menge kommt hier aus
 * `app.rechte_mandanten('gruppe.kalkulation.lesen')` — je Gesellschaft
 * geprüft, nicht einmal für alle. Wer die Kalkulation von drei Gesellschaften
 * lesen darf und von der vierten nicht, bekommt drei Zahlen und eine Null,
 * und nicht die Summe von vieren.
 *
 * Aggregiert wird JE MANDANT, nicht je Projekt: eine Gruppenzeile ist eine
 * Gesellschaft. Der Aufrufer verbindet sie links an `mandant`, damit auch
 * eine Gesellschaft ohne Projekte ihre Zeile behält — eine fehlende Zeile
 * liest sich wie eine fehlende Gesellschaft.
 */
create function app.projekt_kennzahlen_gruppe(p_von date, p_bis date)
returns table (
  mandant_id uuid,
  laufend bigint,
  abgeschlossen bigint,
  verspaetet bigint,
  auftragssumme_cent bigint
)
language plpgsql stable security definer
set search_path = pg_catalog, public, app as $$
begin
  if not app.ist_gruppenansicht() then
    raise exception 'Diese Fassung gilt nur in der Gruppenansicht (Invariante 10)'
      using errcode = 'insufficient_privilege';
  end if;
  if app.portal() <> 'intern' then
    raise exception 'Projektkennzahlen sind ausserhalb des internen Portals nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select pr.mandant_id,
           count(*) filter (where pr.status in ('geplant', 'in_arbeit'))::bigint,
           count(*) filter (where pr.status in ('abgenommen', 'abgeschlossen'))::bigint,
           count(*) filter (where pr.soll_ende is not null
                              and pr.ist_ende is not null
                              and pr.ist_ende > pr.soll_ende)::bigint,
           coalesce(sum(pr.auftragssumme_netto_cent), 0)::bigint
      from public.projekt pr
     where pr.archiviert_am is null
       and pr.mandant_id = any (app.rechte_mandanten('gruppe.kalkulation.lesen'))
       and coalesce(pr.ist_beginn, pr.soll_beginn) <= p_bis
       and coalesce(pr.ist_ende, pr.soll_ende, p_bis) >= p_von
     group by pr.mandant_id;
end
$$;

comment on function app.projekt_kennzahlen_gruppe(date, date) is
  'REP-05 in der Gruppenansicht (TEN-05, K-05, D-92). Je Gesellschaft eine Zeile; die '
  'sichtbare Menge kommt aus gruppe.kalkulation.lesen, je Gesellschaft geprueft.';

alter function app.projekt_kennzahlen_gruppe(date, date) owner to cse_definer;
revoke execute on function app.projekt_kennzahlen_gruppe(date, date) from public;
grant execute on function app.projekt_kennzahlen_gruppe(date, date) to cse_app;

grant execute on function app.ist_gruppenansicht() to cse_definer;
grant execute on function app.rechte_mandanten(text) to cse_definer;
