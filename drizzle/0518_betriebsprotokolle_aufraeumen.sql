-- 0518 — Anmeldeversuche und Nachtlauf-Protokoll werden nach ihrer Frist
--        geloescht (V-330, O-92, D-790, D-822).
--
-- kern.anmeldeversuch traegt seit 0007 einen Index fuer genau diesen Zweck
-- (anmeldeversuch_purge_idx) — geloescht hat nie etwas. job_lauf und
-- job_lauf_mandant wachsen ebenso unbegrenzt. Voreinstellung (O-92, D-790):
-- Anmeldeversuche 30 Tage, Nachtlauf-Protokoll ein Jahr; Rechtsgrundlage
-- Art. 6 Abs. 1 Buchst. f DSGVO (Abwehr von Angriffen, Betrieb), danach ist
-- nichts mehr davon erforderlich (Art. 5 Abs. 1 Buchst. e).
--
-- Nicht hier: das Pruefprotokoll (audit_log) bleibt zehn Jahre und kennt
-- keinen Loeschpfad (Invariante 8, GoBD; die Kette 0204/0516 haengt daran).
-- Eine eigene Tabelle fuer Sicherheitsvorfaelle gibt es nicht — Anmeldung,
-- Sperre und zweiter Faktor stehen als Plattformzeilen im Pruefprotokoll —,
-- die drei Jahre aus O-92 haben deshalb keinen Gegenstand.
--
-- (1) Zwei Einstellungen, vorlaeufig und aenderbar ohne Code:
--     datenschutz.anmeldeversuch_tage (30) und betrieb.job_lauf_tage (365).
-- (2) kern.betriebsprotokolle_aufraeumen(): der eine Einstieg, nur fuer
--     cse_job. Loescht Anmeldeversuche aelter als ihre Frist und
--     abgeschlossene Laeufe, die vor ihrer Frist begonnen haben, samt ihren
--     Ergebnissen je Gesellschaft; ein laufender Lauf bleibt. Gibt je Tabelle
--     Frist und Zahl zurueck — der Job schreibt sie ins Protokoll.
-- (3) cse_definer bekommt dafuer delete auf die drei Tabellen, mit Policies,
--     die nur abgeschlossene Laeufe treffen.
--
-- Nur Kommentare mit Doppelstrich.

-- ---------------------------------------------------------------------------
-- 1. Die Fristen
-- ---------------------------------------------------------------------------

insert into plattform_einstellung (schluessel, wert, ist_vorlaeufig, beschreibung)
values
  ('datenschutz.anmeldeversuch_tage', to_jsonb(30), true,
   'V-330, O-92: Tage, nach denen ein Anmeldeversuch geloescht wird. VORLAEUFIG — '
   'Voreinstellung D-790, Art. 6 Abs. 1 Buchst. f DSGVO.'),
  ('betrieb.job_lauf_tage', to_jsonb(365), true,
   'V-330, O-92: Tage, nach denen ein abgeschlossener Nachtlauf samt seinen Ergebnissen '
   'je Gesellschaft geloescht wird. VORLAEUFIG — Voreinstellung D-790.')
on conflict (schluessel) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Was cse_definer dafuer braucht
-- ---------------------------------------------------------------------------

grant select (id, erstellt_am), delete on kern.anmeldeversuch to cse_definer;
create policy d_versuche_aufraeumen on kern.anmeldeversuch for delete to cse_definer
  using (true);

grant select (id, gestartet_am, beendet_am), delete on job_lauf to cse_definer;
create policy d_job_lauf_aufraeumen on job_lauf for delete to cse_definer
  using (beendet_am is not null);
create policy d_job_lauf_aufraeumen_lesen on job_lauf for select to cse_definer
  using (beendet_am is not null);

grant select (id, job_lauf_id), delete on job_lauf_mandant to cse_definer;
create policy d_job_lauf_mandant_aufraeumen on job_lauf_mandant for delete to cse_definer
  using (exists (select 1 from job_lauf l
                  where l.id = job_lauf_mandant.job_lauf_id and l.beendet_am is not null));
create policy d_job_lauf_mandant_aufraeumen_lesen on job_lauf_mandant for select to cse_definer
  using (true);

-- ---------------------------------------------------------------------------
-- 3. Der Einstieg
-- ---------------------------------------------------------------------------

create function kern.betriebsprotokolle_aufraeumen()
returns table (tabelle text, frist_tage integer, geloescht bigint)
language plpgsql security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_versuch_tage integer;
  v_lauf_tage    integer;
  v_n            bigint;
begin
  -- Eine Frist unter einem Tag waere ein Tippfehler, der alles loescht.
  v_versuch_tage := greatest(coalesce(
    (app.plattform_einstellung('datenschutz.anmeldeversuch_tage') #>> '{}')::integer, 30), 1);
  v_lauf_tage := greatest(coalesce(
    (app.plattform_einstellung('betrieb.job_lauf_tage') #>> '{}')::integer, 365), 1);

  delete from kern.anmeldeversuch v
   where v.erstellt_am < now() - make_interval(days => v_versuch_tage);
  get diagnostics v_n = row_count;
  tabelle := 'kern.anmeldeversuch'; frist_tage := v_versuch_tage; geloescht := v_n;
  return next;

  delete from public.job_lauf_mandant m
   using public.job_lauf l
   where l.id = m.job_lauf_id
     and l.beendet_am is not null
     and l.gestartet_am < now() - make_interval(days => v_lauf_tage);
  get diagnostics v_n = row_count;
  tabelle := 'job_lauf_mandant'; frist_tage := v_lauf_tage; geloescht := v_n;
  return next;

  delete from public.job_lauf l
   where l.beendet_am is not null
     and l.gestartet_am < now() - make_interval(days => v_lauf_tage);
  get diagnostics v_n = row_count;
  tabelle := 'job_lauf'; frist_tage := v_lauf_tage; geloescht := v_n;
  return next;
end $$;

comment on function kern.betriebsprotokolle_aufraeumen() is
  'V-330, O-92, D-822: loescht Anmeldeversuche und abgeschlossene Nachtlaeufe nach ihrer '
  'Frist (datenschutz.anmeldeversuch_tage, betrieb.job_lauf_tage) und gibt je Tabelle '
  'Frist und Zahl zurueck. Das Pruefprotokoll bleibt. Nur fuer cse_job.';

alter function kern.betriebsprotokolle_aufraeumen() owner to cse_definer;
revoke all on function kern.betriebsprotokolle_aufraeumen() from public;
grant execute on function kern.betriebsprotokolle_aufraeumen() to cse_job;
