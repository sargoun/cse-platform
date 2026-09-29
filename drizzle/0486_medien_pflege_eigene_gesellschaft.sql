-- ===========================================================================
-- 0486 — Die Pflege von medien bleibt in der eigenen Gesellschaft und an der
--        Galerie; ein hochgeladenes Bild bleibt, wie es angenommen wurde
--        (SOC-02, SOC-08, DOC-03, Invariante 3, Invariante 7, V-268, D-761)
-- ===========================================================================
-- Ersetzt die Policy t_medien_pflege aus 0014 (ihre einzige Fassung), macht
-- die Zuteilungen aus 0014 (select, insert, update auf die ganze Tabelle) und
-- 0170 (update galerie_rang) enger und ersetzt kern.beitrag_medien_eigen aus
-- 0473 (ihre einzige Fassung).
--
-- **Der Befund.** 0473 macht medien.bucket und medien.objekt_schluessel zu
-- dem Zeiger, auf den /api/beitragsbild/<id> eine signierte Adresse ausstellt;
-- die Freigabe eines Beitrags bindet nur medien_id und Alternativtext. Die
-- neuen Spalten erbten aber das tabellenweite UPDATE aus 0014, und
-- t_medien_pflege pruefte nur app.hat_recht('referenz.schreiben',
-- app.aktiver_mandant()) — ohne jede Bedingung an die ZEILE. Jede Sitzung mit
-- referenz.schreiben in IRGENDEINER Gesellschaft konnte Zeiger, Adresse und
-- Alternativtext jedes Beitragsbilds umschreiben: ein freigegebenes,
-- veroeffentlichtes Bild liess sich auf ein anderes, nie freigegebenes Objekt
-- im selben Ordner umlenken (Invariante 7), ueber Gesellschaftsgrenzen hinweg
-- (Invariante 3). Die Luecke in t_medien_pflege war alt (0014); gefaehrlich
-- wurde sie mit dem Zeiger.
--
-- **Die Behebung — die sicherere von zweien.**
--   1. Zuteilung nur, was ein Weg braucht. Angelegt wird ein medien-Eintrag im
--      Betrieb genau an einer Stelle (legeBeitragsbildAn): diese acht Spalten.
--      Geaendert wird genau eine Spalte (setzeGalerieRang): galerie_rang.
--      Alles andere schreibt nur der Seed als Eigentuemer.
--   2. t_medien_pflege gilt nur noch fuer das UPDATE und nur in der eigenen
--      Gesellschaft (mandant_id = app.aktiver_mandant()); die Gruppenansicht
--      hat keinen aktiven Mandanten und ist nur lesend (Invariante 10).
--      Angelegt wird nur noch ueber t_medien_beitragsbild (0473).
--   3. Ein hochgeladenes Bild bleibt, wie es angenommen wurde — auch fuer den
--      Eigentuemer (Ausloeser): Behaelter und Schluessel aendern sich nie,
--      Gesellschaft, Adresse und Alternativtext eines hochgeladenen Bilds
--      ebenso nicht. Ein anderes Bild ist eine neue Zeile.
--   4. Das Bild eines Beitrags wechselt nur am Entwurf (Ausloeser): sobald ein
--      Beitrag vorgelegt ist, haengt die Freigabe an diesem Bild.
--
-- Die Zweige, die heute schreiben — die Galeriepflege der Website
-- (setzeGalerieRang), das Beitragsbild (legeBeitragsbildAn,
-- setzeBeitragsbild) und der Seed (Eigentuemer) —, bleiben unberuehrt.
--
-- Kein SECURITY DEFINER. Kommentare nur mit --, keine Backticks.
-- ===========================================================================

-- 1. Zuteilung
revoke insert, update on medien from cse_app;
grant insert (id, mandant_id, pfad, alt_text, ist_platzhalter, quelle, bucket, objekt_schluessel)
  on medien to cse_app;
grant update (galerie_rang) on medien to cse_app;

-- 2. Die Pflege: nur UPDATE, nur die eigene Gesellschaft
drop policy t_medien_pflege on medien;
create policy t_medien_pflege on medien for update to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('referenz.schreiben', app.aktiver_mandant()))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and app.hat_recht('referenz.schreiben', app.aktiver_mandant()));

comment on policy t_medien_pflege on medien is
  'PUB-04, V-268, D-761. Die Galeriepflege der Website aendert den Rang eines Bilds der '
  'EIGENEN Gesellschaft (Zuteilung nur galerie_rang). Angelegt wird ueber '
  't_medien_beitragsbild (0473); bis 0486 galt diese Policy fuer alles und jede Zeile.';

-- 3. Ein hochgeladenes Bild bleibt, wie es angenommen wurde
create function kern.medien_bild_fest() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.bucket is distinct from old.bucket
     or new.objekt_schluessel is distinct from old.objekt_schluessel then
    raise exception 'Bild %: Behaelter und Schluessel eines Bilds aendern sich nicht — ein '
                    'anderes Bild ist eine neue Zeile', old.id
      using errcode = 'restrict_violation';
  end if;
  if old.objekt_schluessel is not null
     and (new.mandant_id is distinct from old.mandant_id
          or new.pfad is distinct from old.pfad
          or new.alt_text is distinct from old.alt_text) then
    raise exception 'Bild %: ein hochgeladenes Bild bleibt, wie es angenommen wurde — seine '
                    'Freigabe haengt daran (Invariante 7)', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end $$;

comment on function kern.medien_bild_fest() is
  'SOC-08, V-268, D-761. Ein Bild behaelt Behaelter und Schluessel; ein hochgeladenes '
  'auch Gesellschaft, Adresse und Alternativtext — die Freigabe bindet medien_id.';

create trigger medien_bild_fest
  before update on medien
  for each row execute function kern.medien_bild_fest();

-- 4. Das Bild eines Beitrags wechselt nur am Entwurf
create or replace function kern.beitrag_medien_eigen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_mandant uuid;
begin
  if tg_op = 'UPDATE' and new.medien_id is distinct from old.medien_id
     and old.status <> 'entwurf' then
    raise exception 'Beitrag %: das Bild aendert sich nur am Entwurf — die Freigabe haengt am '
                    'Bild, das vorlag (Invariante 7)', old.id
      using errcode = 'restrict_violation';
  end if;
  if new.medien_id is null then
    return new;
  end if;
  select m.mandant_id into v_mandant from public.medien m where m.id = new.medien_id;
  if v_mandant is not null and v_mandant <> new.mandant_id then
    raise exception 'Beitrag %: das Bild gehoert einer anderen Gesellschaft', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function kern.beitrag_medien_eigen() is
  'SOC-02, SOC-08, V-225, V-268, D-719, D-761. Ein Beitrag zeigt nur ein Bild seiner '
  'Gesellschaft oder der Gruppe (mandant_id null), und es wechselt nur am Entwurf.';
