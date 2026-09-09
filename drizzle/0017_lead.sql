-- 0017 — Lead und Lead-Aktivitaet (REQ-05, REQ-06, REQ-07, CRM-07, CRM-08).
--
-- Reihenfolge: `formular_eingang` steht in 0016, weil `lead` auf ihn zeigt.
-- Der Rueckverweis `formular_eingang.lead_id` wird hier nachgezogen — ein
-- Kreis laesst sich nicht in einer Anweisung schliessen.
--
-- (Der PR-Plan nennt die Migrationen `0018_lead` und `0019_formular_definition`.
--  Die Nummerierung laeuft seit PR 5 eins hinter dem Plan her, und Formular
--  MUSS vor Lead stehen — sonst zeigt eine Fremdschluesselbedingung auf eine
--  Tabelle, die es noch nicht gibt.)

create type lead_quelle     as enum ('webformular', 'vergabe_radar', 'manuell', 'empfehlung');
create type lead_status     as enum ('neu', 'in_bearbeitung', 'angebot', 'gewonnen', 'verloren', 'kein_bedarf');
create type lead_prioritaet as enum ('niedrig', 'normal', 'hoch');
create type aktivitaet_typ       as enum ('notiz', 'anruf', 'email', 'termin', 'aufgabe', 'system');
create type aktivitaet_richtung  as enum ('eingehend', 'ausgehend', 'intern');
create type kommunikationszweck  as enum ('vertraglich', 'transaktional', 'werbung', 'intern');
create type rechtsgrundlage      as enum ('einwilligung', 'bestandskunde', 'anfrage', 'keine');

-- ---------------------------------------------------------------------------
-- lead
-- ---------------------------------------------------------------------------
create table lead (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  leadnummer    text not null,
  quelle        lead_quelle not null,

  formular_eingang_id uuid,
  -- `ausschreibung` und `kunde` kommen mit ihren Domaenen (Phase 4/8). Die
  -- Spalten stehen hier ohne Fremdschluessel, weil eine Bedingung auf eine
  -- nicht existierende Tabelle die Migration bricht — der CHECK unten haelt
  -- die Herkunft trotzdem konsistent.
  ausschreibung_id uuid,
  empfehlung_von_kunde_id uuid,
  kunde_id      uuid,
  firma_name    text,
  ansprechpartner_id uuid,

  betreff       text not null,
  bedarf_zusammenfassung text,
  status        lead_status not null default 'neu',
  prioritaet    lead_prioritaet not null default 'normal',

  /**
   * Die Punktzahl kommt aus einer deterministischen Funktion, nie aus einem
   * Modell (Invariante 6). Die Skala 0–100 ist eine ERKLAERTE
   * Modellierungsannahme, keine Mandantenregel; Kriterien und Gewichte sind
   * offen (O-15).
   */
  punktzahl     smallint check (punktzahl between 0 and 100),
  punktzahl_begruendung text,
  punktzahl_berechnet_am timestamptz,

  besitzer_benutzer_id uuid not null references benutzer(id),

  /**
   * NULLABLE, und das ist eine Entscheidung.
   *
   * `sla_stunden` existiert nur an einem Formular. Ein manuell erfasster Lead,
   * eine Empfehlung oder ein Radar-Treffer hat keine Frist zu erben — ein
   * `not null` haette den Aufnahmedienst gezwungen, eine zu erfinden, und
   * damit eine Geschaeftsregel per Spaltendefinition gewaehlt (O-14).
   */
  sla_frist_am  timestamptz,
  erste_reaktion_am timestamptz,
  eskalationsstufe smallint not null default 0 check (eskalationsstufe >= 0),
  zuletzt_eskaliert_am timestamptz,

  naechste_aktion_am timestamptz,
  naechste_aktion_text text,
  geschaetzter_wert_cent bigint,

  utm_quelle text, utm_medium text, utm_kampagne text,
  utm_begriff text, utm_inhalt text, referrer text,

  verloren_grund text,
  konvertiert_am timestamptz,
  akteur_art    akteur_art not null default 'mensch',
  agent_aufgabe_id uuid,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  constraint lead_mandant_id_uk unique (mandant_id, id),
  constraint lead_nummer_uk unique (mandant_id, leadnummer),
  constraint lead_eingang_fk
    foreign key (mandant_id, formular_eingang_id)
    references formular_eingang (mandant_id, id),

  -- Eine Herkunft, nicht zwei.
  constraint lead_eine_herkunft check (
    num_nonnulls(formular_eingang_id, ausschreibung_id, empfehlung_von_kunde_id) <= 1),
  constraint lead_herkunft_stimmig check (
    (quelle <> 'webformular'   or formular_eingang_id is not null) and
    (quelle <> 'vergabe_radar' or ausschreibung_id is not null) and
    (quelle <> 'empfehlung'    or empfehlung_von_kunde_id is not null)),
  constraint lead_hat_namen check (kunde_id is not null or firma_name is not null),
  -- BEIDE Verlustzustaende tragen einen Grund: `kein_bedarf` ist fuer die
  -- Auswertung genauso ein Verlust wie `verloren`.
  constraint lead_verlust_begruendet check (
    status not in ('verloren', 'kein_bedarf') or verloren_grund is not null),
  constraint lead_punktzahl_begruendet check (
    punktzahl is null or punktzahl_begruendung is not null)
);

create index lead_pipeline_idx on lead (mandant_id, status, prioritaet, sla_frist_am);
-- Der stuendliche REQ-06-Waechter scannt NUR offene Leads mit Frist.
create index lead_sla_offen_idx on lead (sla_frist_am)
  where sla_frist_am is not null and erste_reaktion_am is null and archiviert_am is null;
create index lead_meine_idx on lead (mandant_id, besitzer_benutzer_id, status);
create index lead_quelle_idx on lead (mandant_id, quelle, erstellt_am);
create index lead_utm_idx on lead (mandant_id, utm_quelle, utm_kampagne);
create index lead_naechste_aktion_idx on lead (mandant_id, naechste_aktion_am)
  where archiviert_am is null;

/**
 * DEFERRABLE — weil Eingang und Lead einander brauchen.
 *
 * Der Eingang traegt `lead_id`, der Lead traegt `formular_eingang_id`, und der
 * CHECK `lead_herkunft_stimmig` verlangt bei `quelle = 'webformular'`, dass er
 * gesetzt ist. Sofort geprueft liesse sich keiner von beiden zuerst einfuegen.
 *
 * Die Alternative waere gewesen, den Eingang erst anzulegen und danach per
 * UPDATE zu verknuepfen — und genau dieser UPDATE braeuchte `formular.lesen`
 * (die `USING`-Bedingung der Schreibpolicy). Der Eingangsprinzipal haelt es
 * nicht und soll es nicht halten: er nimmt Einsendungen entgegen und darf
 * keine zurueckholen. Aufgeschoben geprueft loest beides in einer Transaktion.
 */
alter table formular_eingang add constraint formular_eingang_lead_fk
  foreign key (mandant_id, lead_id) references lead (mandant_id, id)
  deferrable initially deferred;

/**
 * Der Versandbeleg entsteht auf dem ANFRAGEPFAD, nicht in einem Job.
 *
 * 0012 gab `versand` nur `cse_job` einen INSERT — dort entstehen Mahnungen und
 * Rechnungsversand. Die Eingangsbestaetigung aus REQ-01 entsteht dagegen
 * waehrend der Anfrage, und ohne diese Policy haette sie keine Zeile
 * schreiben koennen: das Gate haette entschieden, und niemand haette gesehen,
 * WAS es entschieden hat.
 *
 * `crm.kommunikation_versenden` ist die Bedingung, und sie ist keine Erlaubnis
 * zu senden: `agent/policy.ts` entscheidet weiterhin, ob etwas hinausgeht.
 * Diese Zeile bezeugt nur, dass entschieden wurde — auch das Nein.
 */
create policy t_versand_schreiben on versand for insert to cse_app
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('crm.kommunikation_versenden', mandant_id));

grant insert on versand to cse_app;

/**
 * Der Posteingang der Entwicklungsflaeche — eine Definer-Funktion, kein SELECT.
 *
 * `/dev/leads` zeigt, dass eine Einsendung als Lead mit Frist und Besitzer
 * ankommt (REQ-05). Sie laeuft als Renderer und haelt kein `crm.lesen`; die
 * Policy gaebe ihr null Zeilen, und die Seite waere leer — was aussaehe, als
 * sei nichts angekommen.
 *
 * Statt dem Renderer `crm.lesen` zu geben (womit die oeffentliche Haelfte des
 * Systems die ganze Vertriebspipeline lesen koennte) gibt diese Funktion
 * genau die Uebersichtsspalten heraus: Nummer, Betreff, Firma, Frist, Stufe.
 * KEINE Nachricht, KEINE E-Mail-Adresse, KEIN Formularinhalt.
 */
create function app.lead_posteingang()
returns table (leadnummer text, betreff text, firma_name text,
               sla_frist_am timestamptz, eskalationsstufe smallint,
               erste_reaktion_am timestamptz, mandant text)
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select l.leadnummer, l.betreff, l.firma_name, l.sla_frist_am, l.eskalationsstufe,
         l.erste_reaktion_am, m.slug
    from public.lead l join public.mandant m on m.id = l.mandant_id
   where l.archiviert_am is null
   order by l.erstellt_am desc
   limit 50
$$;

grant execute on function app.lead_posteingang() to cse_app;

-- ---------------------------------------------------------------------------
-- lead_aktivitaet — die Zeitachse UND der § 7 UWG-Beleg.
-- ---------------------------------------------------------------------------
create table lead_aktivitaet (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  lead_id       uuid,
  kunde_id      uuid,
  ansprechpartner_id uuid,
  typ           aktivitaet_typ not null,
  richtung      aktivitaet_richtung not null default 'intern',
  -- Die § 5-Trennlinie: `vertraglich` wird nie gesperrt, `werbung` immer.
  zweck         kommunikationszweck not null default 'intern',
  kanal         text check (kanal is null or kanal in
                  ('email','telefon','sms','post','whatsapp','vor_ort','portal')),
  betreff       text not null,
  inhalt        text,
  geschehen_am  timestamptz not null default now(),
  akteur_art    akteur_art not null default 'mensch',
  benutzer_id   uuid references benutzer(id),
  agent_aufgabe_id uuid,
  -- Die Rechtsgrundlage IM MOMENT DES SENDENS — Beweis, kein lebender Join.
  -- Ein Join zeigte den heutigen Stand und nicht den von damals.
  rechtsgrundlage_snapshot rechtsgrundlage,
  faellig_am    timestamptz,
  erinnerung_am timestamptz,
  zustaendig_benutzer_id uuid references benutzer(id),
  erledigt_am   timestamptz,
  dokument_id   uuid,
  erstellt_am   timestamptz not null default now(),

  constraint lead_aktivitaet_mandant_id_uk unique (mandant_id, id),
  constraint lead_aktivitaet_lead_fk
    foreign key (mandant_id, lead_id) references lead (mandant_id, id),
  constraint lead_aktivitaet_hat_bezug check (lead_id is not null or kunde_id is not null)
);

create index lead_aktivitaet_zeitachse_idx
  on lead_aktivitaet (mandant_id, lead_id, geschehen_am desc) where lead_id is not null;
create index lead_aktivitaet_kunde_idx
  on lead_aktivitaet (mandant_id, kunde_id, geschehen_am desc) where kunde_id is not null;
create index lead_aktivitaet_wiedervorlage_idx
  on lead_aktivitaet (zustaendig_benutzer_id, faellig_am) where erledigt_am is null;
create index lead_aktivitaet_uwg_idx
  on lead_aktivitaet (ansprechpartner_id, geschehen_am desc) where richtung = 'ausgehend';

/**
 * `geschehen_am` gehoert dem Server.
 *
 * Diese Zeile ist der § 7 UWG-Beleg: wann wurde was an wen geschickt. Ein
 * Aufrufer, der den Zeitpunkt mitliefert, schreibt seinen eigenen Beleg — und
 * eine eigene Funktion, weil die Spalte anders heisst als in
 * `formular_eingang` und ein Trigger keine Spaltennamen als Argument nimmt.
 */
create function kern.erzwinge_serverzeit_geschehen() returns trigger
language plpgsql as $$
begin
  new.geschehen_am := now();
  return new;
end $$;

create trigger trg_lead_aktivitaet_serverzeit
  before insert on lead_aktivitaet
  for each row execute function kern.erzwinge_serverzeit_geschehen();

-- ---------------------------------------------------------------------------
-- Die SLA-Uhr laesst sich nicht per Feldbearbeitung anhalten.
-- ---------------------------------------------------------------------------
/**
 * `erste_reaktion_am` wird gestempelt, wenn die erste AUSGEHENDE Aktivitaet
 * geschrieben wird — nicht, wenn jemand ein Feld setzt.
 *
 * Sonst waere die Zusage aus REQ-05 eine Zusage an ein Textfeld: die Frist
 * gilt als eingehalten, weil jemand ein Datum eingetragen hat, und der Kunde
 * hat trotzdem nichts gehoert.
 */
create function kern.setze_erste_reaktion() returns trigger
language plpgsql as $$
begin
  if new.richtung = 'ausgehend' and new.lead_id is not null then
    update public.lead
       set erste_reaktion_am = new.geschehen_am
     where id = new.lead_id and mandant_id = new.mandant_id
       and erste_reaktion_am is null;
  end if;
  return new;
end $$;

create trigger trg_lead_erste_reaktion
  after insert on lead_aktivitaet
  for each row execute function kern.setze_erste_reaktion();

-- `geaendert_am` und das Änderungsprotokoll kommen aus dem generierten
-- Block am Dateiende — eine Liste, ein Erzeuger (rls.ts).

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table lead            enable row level security;
alter table lead            force  row level security;
alter table lead_aktivitaet enable row level security;
alter table lead_aktivitaet force  row level security;

create policy t_lead_lesen on lead for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('crm.lesen', mandant_id));
create policy t_lead_schreiben on lead for all to cse_app
  using (mandant_id = app.aktiver_mandant() and app.hat_recht('crm.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('crm.schreiben', mandant_id));

-- EMP-13: das CRM ist nichts fuer das Mitarbeiter- oder Kundenportal.
create policy p_intern_lead on lead as restrictive for all to cse_app
  using (app.portal() = 'intern');

/**
 * Der stuendliche Eskalationsjob liest als `cse_job`, nicht als Benutzer.
 *
 * Er laeuft ohne Sitzung: es gibt keinen angemeldeten Menschen um drei Uhr
 * nachts, dessen Rechte man pruefen koennte. Deshalb eine eigene Policy fuer
 * genau diese Rolle — und keine Aufweichung der Benutzerpolicy.
 */
create policy t_lead_job on lead for select to cse_job using (true);
create policy t_lead_job_update on lead for update to cse_job
  using (sla_frist_am is not null and erste_reaktion_am is null and archiviert_am is null)
  with check (sla_frist_am is not null and erste_reaktion_am is null);

create policy t_aktivitaet_lesen on lead_aktivitaet for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('crm.lesen', mandant_id));
create policy t_aktivitaet_schreiben on lead_aktivitaet for all to cse_app
  using (mandant_id = app.aktiver_mandant() and app.hat_recht('crm.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('crm.schreiben', mandant_id));
create policy p_intern_aktivitaet on lead_aktivitaet as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy t_aktivitaet_job on lead_aktivitaet for insert to cse_job with check (true);

grant select, insert, update on lead to cse_app;
grant select, update on lead to cse_job;
grant select, insert, update on lead_aktivitaet to cse_app;
grant insert on lead_aktivitaet to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0017)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- lead (archiv): REP-02/REP-03. Die Auswertung von Gewinn und Verlust hängt daran, dass Leads nicht verschwinden — ein gelöschter verlorener Lead macht jede Quote besser, als sie ist. `archiviert_am` beendet ihn.
create trigger trg_lead_kein_hard_delete
  before delete on lead
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lead_kein_truncate
  before truncate on lead
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lead from cse_app, cse_anon, cse_checkin, cse_job;

-- lead_aktivitaet (append): § 7 UWG. Jede ausgehende Zeile trägt Zweck und Rechtsgrundlage zum Zeitpunkt des Sendens — das ist der Beweis, dass gesendet werden durfte. Ein Beweis mit Löschpfad ist keiner, und eine Zeitachse mit Lücken erst recht nicht.
create trigger trg_lead_aktivitaet_kein_hard_delete
  before delete on lead_aktivitaet
  for each row execute function kern.verhindere_loeschung();
create trigger trg_lead_aktivitaet_kein_truncate
  before truncate on lead_aktivitaet
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on lead_aktivitaet from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_lead_geaendert_am
  before update on lead
  for each row execute function kern.setze_geaendert_am();

create trigger trg_lead_audit
  after insert or update or delete on lead
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
