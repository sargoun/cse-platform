-- 0500 — Die Selbstruecknahme einer Abwesenheit meldet sich bei der
--        Personalstelle (V-353, O-895, D-795, D-808, NOT-01, NOT-03).
--
-- `POST /api/mein/abwesenheit/[id]/zurueckziehen` storniert eine eigene,
-- noch unentschiedene Abwesenheit (0386). Davon wusste bis hierher nur das
-- Protokoll. Die Voreinstellung zu O-895 (D-795) laesst die Ruecknahme zu,
-- auch wenn die Tage schon in einem Lohnexport standen, und verlangt dafuer,
-- dass die Personalstelle benachrichtigt wird: sie berichtigt den Monat im
-- Lohnsystem.
--
-- `cse_app` hat auf `benachrichtigung` kein INSERT (0266), und das bleibt so:
-- ein Grant gaebe jeder Route das Recht, jedem Konto jeden Text zuzustellen.
-- Diese Funktion kann genau eines — die EINE Art
-- `personal.abwesenheit_zurueckgenommen` zustellen, und nur fuer die EIGENE,
-- gerade zurueckgenommene Abwesenheit des Aufrufers:
--
--   * aktiver Mandant und angemeldetes Konto, sonst nichts;
--   * die Abwesenheit gehoert dem Menschen der Sitzung (`app.aktuelle_person`
--     ueber `anstellung.person_id`), steht auf `storniert` und wurde von
--     DIESEM Konto storniert;
--   * Titel, Text und Ziel kommen aus dem Register (`erzeuge`, NOT-03) und
--     duerfen nicht leer sein — formuliert wird hier nichts (wie 0266);
--   * das Ziel ist genau das Blatt DIESER Abwesenheit in DIESER Gesellschaft
--     (`/portal/<slug>/personal/abwesenheiten/<id>`), sonst nichts:
--     `/api/benachrichtigungen/[id]/oeffnen` leitet auf das Ziel weiter, und
--     ein frei gewaehltes Ziel schickte die Personalstelle auf eine beliebige
--     Adresse.
--
-- Empfaenger sind die Konten, die in dieser Gesellschaft Abwesenheiten
-- entscheiden UND lesen (`zeit.abwesenheit_genehmigen`,
-- `zeit.abwesenheit_lesen`): wer die Meldung bekommt, kann das Blatt oeffnen,
-- auf das sie zeigt (NOT-03). Der Aufrufer selbst nie. Aufgeloest ueber
-- `kern.traeger_des_rechts` (0149) — dieselbe Aufloesung wie `app.hat_recht`,
-- ohne Dienstkonten.
--
-- Eine Zeile je Empfaenger; zurueck kommt ihre Zahl. Null ist ein Ergebnis,
-- kein Fehler: eine Gesellschaft ohne Personalstelle im Portal bekommt die
-- Ruecknahme dann nur im Protokoll — wie bisher.

create function app.abwesenheit_ruecknahme_melden(
  p_abwesenheit uuid,
  p_titel       text,
  p_text        text,
  p_ziel        text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant  uuid := app.aktiver_mandant();
  v_konto    uuid := app.aktueller_benutzer();
  v_person   uuid := app.aktuelle_person();
  v_ziel     text;
  v_anzahl   integer;
begin
  if v_mandant is null or v_konto is null or v_person is null then
    raise exception 'Gemeldet wird nur aus einer Sitzung mit Gesellschaft, Konto und Mensch'
      using errcode = '42501';
  end if;
  if coalesce(btrim(p_titel), '') = '' or coalesce(btrim(p_text), '') = ''
     or coalesce(btrim(p_ziel), '') = '' then
    raise exception 'Titel, Text und Ziel kommen aus dem Register und sind nicht leer (NOT-03)'
      using errcode = '22023';
  end if;

  perform 1
     from public.abwesenheit a
     join public.anstellung an on an.id = a.anstellung_id and an.mandant_id = a.mandant_id
    where a.id = p_abwesenheit
      and a.mandant_id = v_mandant
      and a.status = 'storniert'
      and a.storniert_von = v_konto
      and an.person_id = v_person;
  if not found then
    raise exception 'Gemeldet wird nur die eigene, zurueckgenommene Abwesenheit'
      using errcode = '42501';
  end if;

  select '/portal/' || m.slug || '/personal/abwesenheiten/' || p_abwesenheit::text
    into v_ziel
    from public.mandant m
   where m.id = v_mandant;
  if p_ziel is distinct from v_ziel then
    raise exception 'Das Ziel ist das Blatt genau dieser Abwesenheit in dieser Gesellschaft'
      using errcode = '22023';
  end if;

  insert into public.benachrichtigung
    (mandant_id, empfaenger_id, art, titel, text, ziel, objekt_typ, objekt_id, sammelbar)
  select v_mandant, e.id, 'personal.abwesenheit_zurueckgenommen',
         p_titel, p_text, p_ziel, 'abwesenheit', p_abwesenheit, false
    from (select unnest(kern.traeger_des_rechts(v_mandant, 'zeit.abwesenheit_genehmigen'))
          intersect
          select unnest(kern.traeger_des_rechts(v_mandant, 'zeit.abwesenheit_lesen'))) as e(id)
   where e.id <> v_konto;
  get diagnostics v_anzahl = row_count;
  return v_anzahl;
end $$;

comment on function app.abwesenheit_ruecknahme_melden(uuid, text, text, text) is
  'V-353, O-895: meldet die eigene Ruecknahme einer Abwesenheit den Konten, die in '
  'der Gesellschaft Abwesenheiten entscheiden und lesen. Genau eine Art, nur die '
  'eigene, gerade stornierte Abwesenheit; Texte aus dem Register (NOT-03), das Ziel '
  'nur das Blatt dieser Abwesenheit.';

alter function app.abwesenheit_ruecknahme_melden(uuid, text, text, text) owner to cse_definer;
revoke all on function app.abwesenheit_ruecknahme_melden(uuid, text, text, text) from public;
grant execute on function app.abwesenheit_ruecknahme_melden(uuid, text, text, text) to cse_app;
