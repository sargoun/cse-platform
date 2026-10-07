-- 0497 — eine Qualitaetspruefung archivieren: mit Grund, mit Verweis auf die
-- ersetzende Pruefung, und danach endgueltig (V-288, O-704, D-780, D-806).
--
-- qualitaetspruefung traegt seit 0068 archiviert_am und archiviert_von, aber
-- keinen Grund und keinen Verweis — und kein Dienst schrieb sie. Eine falsch
-- erfasste Pruefung liess sich deshalb nur durch eine neue ersetzen, deren
-- Bemerkung die alte nannte; die alte stand weiter gleichrangig daneben.
--
-- Die Voreinstellung zu O-704 (D-780): Archivieren mit Grund, protokolliert,
-- ohne Loeschung (Invariante 8), und ein Verweis auf die ersetzende Pruefung
-- wie im Wachbuch (ersetzt_durch_id, 0070). Der Dienst ist
-- services/reinigung/qualitaet.ts (archivierePruefung); diese Migration haelt
-- die Regeln, die fuer JEDEN Weg gelten:
--
--  1. Ohne Grund kein Archiv. Geprueft am UEBERGANG und nicht als CHECK auf
--     der Zeile: so bleibt eine Zeile ohne Grund, die vor 0497 archiviert
--     wurde, aenderbar (der Aufbewahrungslauf schreibt aufbewahrung_bis).
--  2. Archiviert bleibt archiviert. Zeitpunkt, Person, Grund und Verweis
--     stehen danach fest — wer sich geirrt hat, erfasst eine neue Pruefung.
--  3. Der Verweis zeigt auf eine Pruefung DERSELBEN Gesellschaft und nicht auf
--     sich selbst.

alter table qualitaetspruefung
  add column archiviert_grund text,
  add column ersetzt_durch_id uuid;

alter table qualitaetspruefung
  add constraint qp_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references qualitaetspruefung (mandant_id, id),
  add constraint qp_ersatz_nicht_selbst check (ersetzt_durch_id is distinct from id),
  add constraint qp_grund_nur_im_archiv check (archiviert_grund is null or archiviert_am is not null),
  add constraint qp_ersatz_nur_im_archiv check (ersetzt_durch_id is null or archiviert_am is not null),
  add constraint qp_grund_laenge check (archiviert_grund is null or char_length(archiviert_grund) <= 500);

comment on column qualitaetspruefung.archiviert_grund is
  'V-288, O-704: warum die Pruefung archiviert wurde. Pflicht beim Archivieren, danach fest.';
comment on column qualitaetspruefung.ersetzt_durch_id is
  'V-288, O-704: die Pruefung, die diese ersetzt (wie wachbuch_eintrag.ersetzt_durch_id, 0070).';

create function kern.qualitaetspruefung_archiv_pruefen() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  -- Der INSERT-Zweig zuerst und mit eigenem return: `old` ist dort nicht
  -- zugewiesen (dieselbe Bauart wie kern.archivierung_stempeln, 0029).
  if tg_op = 'INSERT' then
    if new.archiviert_am is not null and coalesce(btrim(new.archiviert_grund), '') = '' then
      raise exception 'Eine Pruefung wird nur mit Grund archiviert (O-704).'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if old.archiviert_am is null and new.archiviert_am is not null
     and coalesce(btrim(new.archiviert_grund), '') = '' then
    raise exception 'Eine Pruefung wird nur mit Grund archiviert (O-704).'
      using errcode = 'check_violation',
            hint = 'Den Grund nennen — er steht spaeter bei jedem, der das Pruefblatt oeffnet.';
  end if;

  if old.archiviert_am is not null
     and (new.archiviert_am is distinct from old.archiviert_am
          or new.archiviert_von is distinct from old.archiviert_von
          or new.archiviert_grund is distinct from old.archiviert_grund
          or new.ersetzt_durch_id is distinct from old.ersetzt_durch_id) then
    raise exception 'Eine archivierte Pruefung bleibt archiviert; Grund und Verweis stehen fest (O-704).'
      using errcode = 'check_violation',
            hint = 'Eine Berichtigung ist eine neue Pruefung.';
  end if;
  return new;
end $$;

comment on function kern.qualitaetspruefung_archiv_pruefen() is
  'V-288, O-704: kein Archiv ohne Grund; danach stehen Zeitpunkt, Person, Grund und Verweis fest.';

-- Vor trg_qualitaetspruefung_archivierung (Namensreihenfolge): die Regel
-- prueft den Uebergang, das Stempeln setzt danach die Serverzeit.
create trigger trg_qualitaetspruefung_archiv_pruefen
  before insert or update on qualitaetspruefung
  for each row execute function kern.qualitaetspruefung_archiv_pruefen();
