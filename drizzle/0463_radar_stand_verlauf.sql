-- 0463 -- app.radar_stand_verlauf(uuid): die Statushistorie eines
--         Radar-Vorgangs ueber einen Definer-Leser (V-241, RAD-06, REP-06).
--
-- ===========================================================================
-- Der Befund
-- ===========================================================================
--
-- Die Seite /portal/[mandant]/radar/[id]/status zeigt, wann ein Vorgang
-- welchen Stand bekam. Die Quelle ist das Protokoll: ausschreibung_vorgang
-- fuehrt eine Zeile je Bekanntmachung und ueberschreibt sie bei jedem Stand,
-- der Dienst setzeVorgangsstand schreibt dafuer je Stand eine Zeile
-- radar.stand_gesetzt mit nachher = { status, ausschreibungId, mitGrund }.
--
-- Gelesen hat die Seite diese Zeilen DIREKT als cse_app, mit
-- nachher ->> 'status'. Genau diese Spalte haelt cse_app nicht: 0005 gibt
-- cse_app auf audit_log ein Spaltenrecht OHNE vorher und nachher, und das mit
-- Absicht -- die Nutzlast einer Protokollzeile kann Werte tragen, die die
-- Tabelle selbst ihrem Leser vorenthaelt. Die Folge war zur Laufzeit
-- "permission denied for table audit_log" und eine Fehlerseite, sobald ein
-- Vorgang ueberhaupt einen Stand hatte. Aufgefallen ist es erst, als der Seed
-- einen Vorgang mit Stand anlegte (der Verweislauf der Browsersuite traf die
-- Seite dann als 500).
--
-- ===========================================================================
-- Die Entscheidung (D-735)
-- ===========================================================================
--
-- Kein weiteres Spaltenrecht fuer cse_app auf audit_log: das oeffnete die
-- Nutzlast JEDER Protokollzeile, nicht nur dieser. Stattdessen ein Leser, der
-- genau die zwei Felder herausgibt, die die Seite braucht -- den Stand und ob
-- ein Grund dabei war --, und nur fuer diese eine Aktion.
--
--  1. Eigentuemer cse_definer, nicht die Migrationsrolle (K-01). cse_definer
--     liest audit_log ueber d_audit_lesen (0204) mit vollem Spaltenrecht.
--  2. Mandantenbindung: gelesen werden nur Zeilen mit
--     mandant_id = app.aktiver_mandant(). Die Zeile schreibt der Dienst mit
--     genau diesem Mandanten; eine fremde Gesellschaft bekommt fuer dieselbe
--     Vorgangskennung nichts.
--  3. Rechtepruefung wie die Lesepolicy t_lesen auf ausschreibung_vorgang:
--     internes Portal (p_intern_ceiling), ein aktiver Mandant und
--     radar.lesen in ihm. Fehlt eines davon, gibt es eine Abweisung und keine
--     leere Liste -- eine leere Historie hiesse "nie ein Stand gesetzt".
--  4. Der Name des Handelnden kommt NICHT aus dieser Funktion. Sie gibt die
--     akteur_id heraus, und der Aufrufer verbindet sie als cse_app mit
--     benutzer: ob ein Name sichtbar ist, entscheidet dort weiter die Policy
--     auf benutzer und nicht ein Definer.
--  5. Der Wortlaut eines Grundes steht nicht im Protokoll (nur mitGrund), und
--     diese Funktion erfindet ihn nicht dazu.
--  6. Schreibt NICHT ins Protokoll: das Lesen der eigenen Statushistorie ist
--     kein Zugriff auf eine sensible Nutzlast, und eine Zeile je Seitenaufruf
--     ertraenkte das Protokoll, aus dem sie liest.
-- ===========================================================================

create function app.radar_stand_verlauf(p_vorgang uuid)
returns table (
  audit_id    bigint,
  erstellt_am timestamptz,
  akteur_typ  akteur_art,
  akteur_id   uuid,
  status      text,
  mit_grund   boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_mandant uuid := app.aktiver_mandant();
begin
  if app.portal() is distinct from 'intern' then
    raise exception 'Die Statushistorie des Radars ist nur im internen Portal lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_mandant is null or not app.hat_recht('radar.lesen', v_mandant) then
    raise exception 'Die Statushistorie liest, wer das Radar lesen darf (radar.lesen)'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select a.id, a.erstellt_am, a.akteur_typ, a.akteur_id,
           a.nachher ->> 'status',
           coalesce((a.nachher -> 'mitGrund') = 'true'::jsonb, false)
      from public.audit_log a
     where a.mandant_id = v_mandant
       and a.aktion = 'radar.stand_gesetzt'
       and a.objekt_typ = 'ausschreibung_vorgang'
       and a.objekt_id = p_vorgang::text
     order by a.erstellt_am desc, a.id desc
     limit 50;
end $$;

comment on function app.radar_stand_verlauf(uuid) is
  'Statushistorie eines Radar-Vorgangs aus audit_log (radar.stand_gesetzt): Stand und ob ein '
  'Grund dabei war, nur fuer den aktiven Mandanten, nur im internen Portal und nur unter '
  'radar.lesen. Der Name des Handelnden wird beim Aufrufer ueber benutzer gelesen (0463, D-735).';

alter function app.radar_stand_verlauf(uuid) owner to cse_definer;
revoke execute on function app.radar_stand_verlauf(uuid) from public;
grant execute on function app.radar_stand_verlauf(uuid) to cse_app;
