-- ===========================================================================
-- 0473 — Ein Beitrag traegt ein Bild (SOC-02, SOC-05, DOC-03, V-225, D-719)
-- ===========================================================================
-- **Der Befund.** 0163 haengt Bilder als beitrag.medien_id an jeden Beitrag
-- (Kommentar zu beitrag_art), und keine Zeile Code schrieb oder las die
-- Spalte. Fuer medien gab es ueberhaupt keinen Annahmeweg: die Tabelle traegt
-- die statischen Bilder der Website (0014, pfad), geschrieben nur vom Seed.
--
-- **Was diese Migration bringt.**
--   1. Ein hochgeladenes Bild liegt im PRIVATEN Behaelter marke und wird ueber
--      /api/beitragsbild/<id> auf eine signierte Adresse ausgeliefert. Die Zeile
--      traegt dafuer Behaelter und Schluessel; der pfad zeigt auf die Tuer,
--      nie auf die Datei. Ein CHECK haelt den Schluessel im eigenen Ordner der
--      Gesellschaft und im Format des Dienstes (Inhalt als Name) — dieselbe
--      Regel wie mi_bildpfad_eigen (0393). RLS schuetzt die Zeile, nicht den
--      Inhalt einer Spalte.
--   2. Wer Beitraege schreibt (social.schreiben), legt Bilder fuer die eigene
--      Gesellschaft an. Bisher durfte das nur referenz.schreiben
--      (t_medien_pflege) — zwei Rechte fuer einen Beitrag mit Bild waeren eine
--      Voraussetzung, die niemand vermutet.
--   3. Ein Beitrag zeigt nur ein Bild SEINER Gesellschaft (Ausloeser): der
--      Fremdschluessel auf medien(id) kennt keinen Mandanten, und medien ist
--      oeffentlich lesbar — ohne diese Pruefung haenge ein Beitrag der
--      Reinigung das Bild der Bau-Gesellschaft an.
--   4. Der Veroeffentlichungslauf (cse_job) liest medien, um den Kanaelen das
--      Bild zu nennen — dieselbe Lesefreiheit, die medien fuer cse_app ohnehin
--      hat (t_medien_oeffentlich).
--
-- Kein SECURITY DEFINER: der Ausloeser liest medien, und medien ist lesbar.
-- Kommentare nur mit --, keine Backticks.
-- ===========================================================================

alter table medien
  add column bucket            text,
  add column objekt_schluessel text;

alter table medien add constraint medien_hochgeladen_eigen check (
  (bucket is null) = (objekt_schluessel is null)
  and (objekt_schluessel is null or (
        bucket = 'marke'
    and mandant_id is not null
    and objekt_schluessel ~ ('^' || mandant_id::text || '/beitrag/[0-9a-f]{64}\.(png|jpg)$')
    and pfad = '/api/beitragsbild/' || id::text)));

comment on constraint medien_hochgeladen_eigen on medien is
  'SOC-02, V-225, D-719. Ein hochgeladenes Bild liegt im privaten Behaelter marke, im Ordner '
  'seiner Gesellschaft, mit dem Inhalt als Namen; ausgeliefert wird ueber /api/beitragsbild/<id>.';

create policy t_medien_beitragsbild on medien for insert to cse_app
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and bucket is not null
              and app.hat_recht('social.schreiben', app.aktiver_mandant()));

comment on policy t_medien_beitragsbild on medien is
  'SOC-02, V-225. Wer Beitraege schreibt, legt Bilder fuer die eigene Gesellschaft an — nur '
  'hochgeladene (bucket gesetzt), nie einen statischen Pfad der Website.';

grant select on medien to cse_job;
create policy j_medien_lesen on medien for select to cse_job using (true);

create function kern.beitrag_medien_eigen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare v_mandant uuid;
begin
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
  'SOC-02, V-225, D-719. Ein Beitrag zeigt nur ein Bild seiner Gesellschaft oder ein Bild '
  'der Gruppe (mandant_id null).';

create trigger beitrag_medien_eigen
  before insert or update of medien_id on beitrag
  for each row execute function kern.beitrag_medien_eigen();
