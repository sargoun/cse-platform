-- ===========================================================================
-- 0487 — Ein Bild aus einem Social-Beitrag gehoert nicht in den Bildbestand
--        der Website (PUB-04, SOC-02, SOC-08, V-268, D-761)
-- ===========================================================================
-- **Der Befund.** Seit V-225 (0473) liegen in medien auch die hochgeladenen
-- Bilder der Social-Beitraege — privat, ueber /api/beitragsbild/<id>
-- ausgeliefert und fuer den BEITRAG freigegeben, nicht fuer die Website. Die
-- Leser des Website-Bestands filterten sie nicht: die Galeriepflege und die
-- Bildauswahl der Referenzen zeigten sie (als kaputte Kacheln — der
-- Bildoptimierer holt ohne Sitzung und folgt keiner Weiterleitung), und wer
-- referenz.schreiben hielt, konnte ein Entwurfsbild in die oeffentliche
-- Galerie oder an eine Referenz haengen: oeffentlich stuende dann ein
-- kaputtes Bild mit dem Alternativtext eines nie freigegebenen Entwurfs.
--
-- **Die zweite Linie.** Die Dienste filtern (listeGalerie, bilderZurWahl,
-- galerieDerGesellschaft) und weisen ab (setzeGalerieRang, aendereReferenz,
-- Grund bild_beitrag). Hier steht dasselbe fuer jeden Schreiber:
--   1. ein hochgeladenes Bild traegt keinen Galerierang (CHECK);
--   2. eine Referenz zeigt kein hochgeladenes Bild (Ausloeser, als Aufrufer —
--      medien ist fuer cse_app lesbar, t_medien_oeffentlich).
--
-- Kein SECURITY DEFINER. Kommentare nur mit --, keine Backticks.
-- ===========================================================================

-- Eine Zeile, die beides traegt, kann es heute nur geben, wenn jemand ein
-- Beitragsbild ueber die Galeriepflege aufgenommen hat — sie kommt heraus.
update medien set galerie_rang = null
 where objekt_schluessel is not null and galerie_rang is not null;

alter table medien add constraint medien_beitragsbild_nicht_in_galerie check (
  galerie_rang is null or objekt_schluessel is null);

comment on constraint medien_beitragsbild_nicht_in_galerie on medien is
  'PUB-04, V-268, D-761. Ein hochgeladenes Bild eines Social-Beitrags ist fuer den Beitrag '
  'freigegeben, nicht fuer die Galerie der Website.';

create function kern.referenz_bild_der_website() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.medien_id is null
     or (tg_op = 'UPDATE' and new.medien_id is not distinct from old.medien_id) then
    return new;
  end if;
  if exists (select 1 from public.medien m
              where m.id = new.medien_id and m.objekt_schluessel is not null) then
    raise exception 'Referenz %: ein Bild aus einem Social-Beitrag gehoert nicht an eine '
                    'Referenz — es ist fuer den Beitrag freigegeben', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function kern.referenz_bild_der_website() is
  'PUB-04, V-268, D-761. Eine Referenz zeigt ein Bild der Website, nie ein hochgeladenes '
  'Beitragsbild.';

create trigger referenz_bild_der_website
  before insert or update of medien_id on referenz
  for each row execute function kern.referenz_bild_der_website();
