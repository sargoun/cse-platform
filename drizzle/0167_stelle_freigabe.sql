/**
 * 0167 — Eine Stellenanzeige geht nur mit einer GENEHMIGTEN Freigabe hinaus
 * (REC-02, Invariante 7).
 *
 * **Was 0166 hatte und was fehlte.** Die Bedingung
 * `stelle_freigegeben_hat_freigabe` verlangte ab `freigegeben` eine
 * Freigabe-Kennung — irgendeine. Ein `check` kann keine andere Tabelle lesen,
 * also stand dort nur `freigabe_id is not null`, und damit liess sich eine
 * Stelle mit einer OFFENEN, einer ABGELEHNTEN oder der Freigabe eines
 * Social-Beitrags auf `veroeffentlicht` setzen. Die Zierde war die Kennung,
 * nicht die Entscheidung. Gemeldet hat das die Copilot-Runde auf PR 16.
 *
 * **Und es fehlte der Weg dorthin.** `stelle.status` kannte `freigegeben`, aber
 * im ganzen Baum gab es keine Route, die ihn setzt: eine Stelle konnte den
 * Entwurf nie verlassen, `/stellen/[id]/veroeffentlichung` war damit
 * unerreichbar und REC-09 unausführbar. Die Anwendung bekommt den Weg
 * (`legeStelleVor`); hier steht, was die Datenbank davon unabhängig erzwingt.
 *
 * Beides ist dieselbe Mechanik wie in `0163` beim Beitrag, und das ist
 * Absicht: zwei verschiedene Arten, „ohne Freigabe geht nichts hinaus"
 * durchzusetzen, wären eine zu viel.
 */

-- ---------------------------------------------------------------------------
-- 1. Der Riegel: freigegeben und veroeffentlicht brauchen eine GENEHMIGUNG
-- ---------------------------------------------------------------------------

/**
 * **Die AKTION geht mit** (0130 §6). Ohne sie oeffnete die Zustimmung zu einem
 * Mahnbrief eine Stellenanzeige: dieselbe Kennung, derselbe Mandant, derselbe
 * Status — und eine voellig andere Entscheidung. `stelle_veroeffentlichen` ist
 * derselbe Wert, den `legeStelleVor` (services/recruiting/dienst.ts) einsetzt.
 *
 * Der Ausloeser liest die Freigabe NICHT selbst, sondern fragt
 * `app.freigabe_genehmigt` — dieselbe Frage, die schon der Kreditor, die
 * Mahnung und der Beitrag stellen, und mit einem schmaleren Spaltenrecht, als
 * ein eigenes `select … from freigabe` braeuchte (K-01).
 */
create function app.stelle_braucht_genehmigung() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.status not in ('freigegeben', 'veroeffentlicht') then
    return new;
  end if;
  if new.freigabe_id is null
     or not app.freigabe_genehmigt(new.freigabe_id, new.mandant_id,
                                   'stelle_veroeffentlichen') then
    raise exception using
      errcode = 'check_violation',
      message = 'Eine Stelle wird freigegeben oder veroeffentlicht nur mit einer '
              || 'GENEHMIGTEN Freigabe (Invariante 7, REC-02).',
      detail  = format('Stelle %s, Freigabe %s.', new.id,
                       coalesce(new.freigabe_id::text, 'keine'));
  end if;
  /*
   * **Und sie muss zu DIESER Stelle gehoeren.**
   *
   * Die Pruefung darueber sagt: genehmigt, dieser Mandant, diese Aktion. Sie
   * sagt NICHT, fuer welche Stelle. `stelle.freigabe_id` ist eine
   * beschreibbare Spalte -- wer zwei Anzeigen fuehrt und fuer die eine eine
   * Genehmigung hat, konnte dieselbe Kennung an die andere haengen und sie
   * damit veroeffentlichen. Die Genehmigung gilt aber einem TEXT, nicht einer
   * Gattung: genau dafuer schreibt `legeStelleVor` den Nutzlast-Hash mit.
   * Gemeldet hat das die Copilot-Runde auf PR 16 -- derselbe Befund wie der
   * erste, eine Ebene tiefer.
   *
   * `legeStelleVor` setzt `bezug_typ = 'stelle'` und `bezug_id` seit jeher;
   * gefehlt hat nur, sie zu lesen.
   */
  if not exists (
    select 1 from public.freigabe f
     where f.id = new.freigabe_id
       and f.mandant_id = new.mandant_id
       and f.bezug_typ = 'stelle'
       and f.bezug_id  = new.id) then
    raise exception using
      errcode = 'check_violation',
      message = 'Diese Freigabe gehoert zu einer anderen Stelle (Invariante 7, REC-02).',
      detail  = format('Stelle %s, Freigabe %s.', new.id, new.freigabe_id);
  end if;
  return new;
end;
$$;

comment on function app.stelle_braucht_genehmigung() is
  'REC-02, Invariante 7. Die check-Bedingung aus 0166 pruefte nur, DASS eine '
  'Freigabe-Kennung dasteht — nicht, dass sie genehmigt ist und zu dieser '
  'Aktion gehoert.';

/**
 * **Spaltenrechte, sonst liest der Definer ins Leere.**
 *
 * `cse_definer` hat auf `freigabe` bisher `select (id, mandant_id, status)`
 * (0123) und `(aktion)` (0130) -- `bezug_typ`/`bezug_id` waren nicht dabei.
 * Ohne diese Zeile scheitert der Ausloeser oben an der Berechtigung, und zwar
 * bei JEDER Freigabe: die Pruefung wuerde nicht milder, sie ginge gar nicht.
 * Recht UND Policy, wie immer (D-388) -- `d_freigabe_lesen` aus 0123 gilt fuer
 * die Zeile und bleibt unveraendert.
 */
grant select (bezug_typ, bezug_id) on freigabe to cse_definer;

alter function app.stelle_braucht_genehmigung() owner to cse_definer;
revoke all on function app.stelle_braucht_genehmigung() from public;

create trigger stelle_braucht_genehmigung
  before insert or update of status, freigabe_id on stelle
  for each row execute function app.stelle_braucht_genehmigung();

-- ---------------------------------------------------------------------------
-- 2. Die Entscheidung zieht die Stelle nach — in BEIDE Richtungen
-- ---------------------------------------------------------------------------

/**
 * **Die Stelle folgt ihrer Freigabe, in der Datenbank.**
 *
 * Der naheliegende Ort waere ein Ausfuehrer in `freigabe/ausfuehrung.ts`. Er
 * waere die halbe Loesung: `fuehreAus` laeuft nur bei `genehmigt`. Bei einer
 * ABLEHNUNG liefe er nicht, und die Stelle bliebe auf „In Prüfung" stehen,
 * waehrend ihre Freigabe abgelehnt ist — zwei Bildschirme, zwei Antworten,
 * und niemand sucht danach. Dieselbe Ueberlegung wie bei
 * `app.beitrag_folgt_freigabe` (0163), und derselbe Aufbau.
 *
 * **`veroeffentlicht_am` setzt dieser Ausloeser NICHT.** Freigegeben heisst
 * „darf hinaus", nicht „ist draussen"; den Zeitpunkt setzt der Weg nach
 * draussen (`/stellen/[id]/veroeffentlichung`), und zwar dann, wenn wirklich
 * etwas hinausgegangen ist. Eine Anzeige, die sich selbst als veroeffentlicht
 * fuehrt, ohne dass ein Kanal sie genommen hat, ist genau die Falschaussage,
 * gegen die SOC-07 und REC-09 gebaut sind.
 */
create function app.stelle_folgt_freigabe() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'genehmigt' then
    update public.stelle set status = 'freigegeben'
     where freigabe_id = new.id and status = 'entwurf';
  elsif new.status in ('abgelehnt', 'zurueckgezogen') then
    /*
     * Zurueck in den Entwurf UND die Kennung loesen: eine abgelehnte Freigabe
     * an einer Stelle haengen zu lassen hiesse, dass der naechste Versuch
     * aussieht, als laege schon eine Entscheidung vor.
     */
    update public.stelle set status = 'entwurf', freigabe_id = null
     where freigabe_id = new.id and status = 'entwurf';
  end if;

  return new;
end;
$$;

comment on function app.stelle_folgt_freigabe() is
  'REC-02, Invariante 7. Zieht die Stelle nach, wenn ihre Freigabe entschieden '
  'wird — auch bei einer ABLEHNUNG, die kein Ausfuehrer je sieht.';

alter function app.stelle_folgt_freigabe() owner to cse_definer;

/**
 * Eine Triggerfunktion ruft niemand von Hand — also darf es auch niemand.
 * Bei einer SECURITY-DEFINER-Funktion hiesse PUBLIC-EXECUTE: jeder Aufrufer
 * koennte sie mit den Rechten von `cse_definer` ausfuehren.
 * `definer-eigentum.test.ts` zaehlt mit.
 */
revoke all on function app.stelle_folgt_freigabe() from public;

/**
 * **Zuteilung UND Policy** — `cse_definer` steht unter FORCE RLS und saehe
 * ohne eigene Policy null Zeilen, schweigend. Genau dieser Fehler hat in 0162
 * einen Browserlauf gekostet.
 */
grant select, update on public.stelle to cse_definer;
create policy d_stelle_folgt on stelle for select to cse_definer using (true);
create policy d_stelle_nachzug on stelle as permissive for update to cse_definer
  using (true) with check (true);

create trigger freigabe_zieht_stelle_nach
  after update of status on freigabe
  for each row execute function app.stelle_folgt_freigabe();
