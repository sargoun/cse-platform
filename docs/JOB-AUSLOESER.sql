-- ERZEUGT aus dem Job-Register (`src/server/jobs/zeitplan.ts`).
-- Nicht von Hand ändern: `pnpm jobs:plan` schreibt diese Datei neu.
--
-- Vorher EINMAL, und nicht in einer Migration (das Token gehört nicht in
-- die Versionsgeschichte):
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   alter database postgres set cse.job_token = '<das Geheimnis aus JOB_TOKEN>';
-- Akquise: Firmenrecherche je Gesellschaft (§12) — ohne verbundene Quelle ein protokollierter Leerlauf, kein stiller (je_mandant)
select cron.unschedule('cse_akquise_recherche')
  where exists (select 1 from cron.job where jobname = 'cse_akquise_recherche');
select cron.schedule('cse_akquise_recherche', '10 5 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/akquise_recherche',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Versendete Angebote nach Fristablauf auf „abgelaufen" setzen (OPS-08) (uebergreifend)
select cron.unschedule('cse_angebot_ablauf')
  where exists (select 1 from cron.job where jobname = 'cse_angebot_ablauf');
select cron.schedule('cse_angebot_ablauf', '10 2 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/angebot_ablauf',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Deckt ein Basiszinssatz die kommende Jahreshälfte? (§ 247 BGB) (plattform)
select cron.unschedule('cse_basiszinssatz_pruefen')
  where exists (select 1 from cron.job where jobname = 'cse_basiszinssatz_pruefen');
select cron.schedule('cse_basiszinssatz_pruefen', '0 6 15 6,12 *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/basiszinssatz_pruefen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Ausgangsrechnungen als PDF archivieren (ACC-03) (je_mandant)
select cron.unschedule('cse_belegarchiv_ausgangsrechnung')
  where exists (select 1 from cron.job where jobname = 'cse_belegarchiv_ausgangsrechnung');
select cron.schedule('cse_belegarchiv_ausgangsrechnung', '50 3 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/belegarchiv_ausgangsrechnung',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Bewerberdaten nach Ablauf der Aufbewahrung löschen (REC-07) (uebergreifend)
select cron.unschedule('cse_bewerber_loeschung')
  where exists (select 1 from cron.job where jobname = 'cse_bewerber_loeschung');
select cron.schedule('cse_bewerber_loeschung', '0 4 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/bewerber_loeschung',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Dokumente nach Ablauf der Aufbewahrungsfrist löschen (DOC-07, LEG-01) (je_mandant)
select cron.unschedule('cse_dokument_aufbewahrung')
  where exists (select 1 from cron.job where jobname = 'cse_dokument_aufbewahrung');
select cron.schedule('cse_dokument_aufbewahrung', '10 5 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/dokument_aufbewahrung',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Dienstplan aus den Serien materialisieren (acht Wochen) (je_mandant)
select cron.unschedule('cse_einsaetze_generieren')
  where exists (select 1 from cron.job where jobname = 'cse_einsaetze_generieren');
select cron.schedule('cse_einsaetze_generieren', '15 2 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/einsaetze_generieren',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Abgelaufene Einspruchsfenster freigeben (APR-05) (uebergreifend)
select cron.unschedule('cse_freigabe_fenster')
  where exists (select 1 from cron.job where jobname = 'cse_freigabe_fenster');
select cron.schedule('cse_freigabe_fenster', '*/5 * * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/freigabe_fenster',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Nächtliche Prüfung der Rechnungs-Hashkette (FIN-06) (je_mandant)
select cron.unschedule('cse_kette_pruefen')
  where exists (select 1 from cron.job where jobname = 'cse_kette_pruefen');
select cron.schedule('cse_kette_pruefen', '20 3 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/kette_pruefen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Arbeitszeit- und Planungskonflikte der kommenden vier Wochen erkennen (je_mandant)
select cron.unschedule('cse_konflikte_erkennen')
  where exists (select 1 from cron.job where jobname = 'cse_konflikte_erkennen');
select cron.schedule('cse_konflikte_erkennen', '45 2 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/konflikte_erkennen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Stundenkonten des laufenden Monats öffnen und Vortrag setzen (EMP-04) (uebergreifend)
select cron.unschedule('cse_konten_rollover')
  where exists (select 1 from cron.job where jobname = 'cse_konten_rollover');
select cron.schedule('cse_konten_rollover', '30 0 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/konten_rollover',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- SLA-Fristen offener Leads prüfen und eskalieren (je_mandant)
select cron.unschedule('cse_lead_sla_eskalation')
  where exists (select 1 from cron.job where jobname = 'cse_lead_sla_eskalation');
select cron.schedule('cse_lead_sla_eskalation', '0 * * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/lead_sla_eskalation',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Nächtlicher Mahnlauf — Vorschläge, keine Briefe (FIN-15) (je_mandant)
select cron.unschedule('cse_mahnvorschlaege_erzeugen')
  where exists (select 1 from cron.job where jobname = 'cse_mahnvorschlaege_erzeugen');
select cron.schedule('cse_mahnvorschlaege_erzeugen', '10 4 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/mahnvorschlaege_erzeugen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Morgen unbesetzte Schichten — dringende Meldung (SPEC §14) (uebergreifend)
select cron.unschedule('cse_morgen_unbesetzt')
  where exists (select 1 from cron.job where jobname = 'cse_morgen_unbesetzt');
select cron.schedule('cse_morgen_unbesetzt', '0 * * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/morgen_unbesetzt',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Nachtrag angemeldet, nach 14 Tagen nicht eingereicht (SPEC §14, BAU-04) (uebergreifend)
select cron.unschedule('cse_nachtrag_ueberfaellig')
  where exists (select 1 from cron.job where jobname = 'cse_nachtrag_ueberfaellig');
select cron.schedule('cse_nachtrag_ueberfaellig', '0 * * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/nachtrag_ueberfaellig',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Nachweise nach Fristablauf auf „abgelaufen" setzen (§12.3, EMP-08) (uebergreifend)
select cron.unschedule('cse_nachweis_ablauf')
  where exists (select 1 from cron.job where jobname = 'cse_nachweis_ablauf');
select cron.schedule('cse_nachweis_ablauf', '10 2 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/nachweis_ablauf',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Ablaufwarnungen für Nachweise (60/30/7 Tage, EMP-08) (uebergreifend)
select cron.unschedule('cse_nachweis_warnungen')
  where exists (select 1 from cron.job where jobname = 'cse_nachweis_warnungen');
select cron.schedule('cse_nachweis_warnungen', '5 2 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/nachweis_warnungen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Nächtlicher Abgleich der offenen Posten (ACC-07) (je_mandant)
select cron.unschedule('cse_offene_posten_abgleichen')
  where exists (select 1 from cron.job where jobname = 'cse_offene_posten_abgleichen');
select cron.schedule('cse_offene_posten_abgleichen', '40 3 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/offene_posten_abgleichen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Vergaberadar: Bekanntmachungen einlesen und bewerten (RAD-01, RAD-02, RAD-05) (uebergreifend)
select cron.unschedule('cse_radar_einlesen')
  where exists (select 1 from cron.job where jobname = 'cse_radar_einlesen');
select cron.schedule('cse_radar_einlesen', '20 4 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/radar_einlesen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Radar: knappe Abgabefristen und Treffer über der Schwelle (SPEC §14, RAD-08) (uebergreifend)
select cron.unschedule('cse_radar_warnungen')
  where exists (select 1 from cron.job where jobname = 'cse_radar_warnungen');
select cron.schedule('cse_radar_warnungen', '0 * * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/radar_warnungen',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Schicht beendet, kein Zeiteintrag — Planer benachrichtigen (SPEC §14) (uebergreifend)
select cron.unschedule('cse_schicht_ohne_zeiteintrag')
  where exists (select 1 from cron.job where jobname = 'cse_schicht_ohne_zeiteintrag');
select cron.schedule('cse_schicht_ohne_zeiteintrag', '30 * * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/schicht_ohne_zeiteintrag',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Geplante Beiträge veröffentlichen (SOC-03) (uebergreifend)
select cron.unschedule('cse_social_plan')
  where exists (select 1 from cron.job where jobname = 'cse_social_plan');
select cron.schedule('cse_social_plan', '*/5 * * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/social_plan',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Nächtlicher Abgleich Stundenkonto ↔ Journal (EMP-04, §12.2) (je_mandant)
select cron.unschedule('cse_stundenkonto_abgleich')
  where exists (select 1 from cron.job where jobname = 'cse_stundenkonto_abgleich');
select cron.schedule('cse_stundenkonto_abgleich', '40 3 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/stundenkonto_abgleich',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);

-- Urlaubskonten des laufenden Jahres öffnen (EMP-05, § 3 BUrlG) (uebergreifend)
select cron.unschedule('cse_urlaubskonten_jahr')
  where exists (select 1 from cron.job where jobname = 'cse_urlaubskonten_jahr');
select cron.schedule('cse_urlaubskonten_jahr', '45 0 * * *', $cse$
  select net.http_post(
    url     := 'https://basis-einsetzen.invalid/api/jobs/urlaubskonten_jahr',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-job-token', current_setting('cse.job_token')),
    body    := '{}'::jsonb
  );
$cse$);
