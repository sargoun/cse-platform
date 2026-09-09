-- 0016 — Angebotsanfrage-Formulare (REQ-01 … REQ-04, REQ-07, LEG-09).
--
-- Drei Tabellen und eine Trennlinie, die der ganze Grund fuer drei ist:
--
--   formular_definition     — was die Website ZEIGT. Oeffentlich lesbar.
--   formular_zustaendigkeit — SLA, Besitzer, Eskalationsziel. NIE oeffentlich.
--   formular_eingang        — was ankam, unveraendert. Beweis, kein Arbeitsblatt.
--
-- Waeren SLA und Besitzer Spalten der Definition, muesste die oeffentliche
-- Policy auf Spaltenebene filtern — und eine vergessene Spalte in einem
-- `select *` haette den internen Eskalationsempfaenger im Quelltext der
-- Website stehen.

create type formular_eingang_status as enum ('neu', 'verarbeitet', 'spam', 'verworfen');

-- ---------------------------------------------------------------------------
-- formular_definition — ein Formular je Bereich, versioniert.
-- ---------------------------------------------------------------------------
create table formular_definition (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  schluessel    text not null check (schluessel ~ '^[a-z][a-z0-9_]{2,63}$'),
  version       integer not null default 1 check (version > 0),
  titel         text not null,
  beschreibung  text,
  -- Geordnete Feldliste, gegen `src/lib/formular/schema.ts` validiert.
  felder        jsonb not null,
  -- Welcher Datenschutztext gezeigt wurde. Wird auf jede Einsendung kopiert:
  -- ein Beweis, der auf den heutigen Text zeigt, beweist nichts ueber gestern.
  datenschutz_hinweis_version text not null,
  veroeffentlicht_am timestamptz,
  zurueckgezogen_am  timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  constraint formular_definition_mandant_id_uk unique (mandant_id, id),
  constraint formular_definition_version_uk unique (mandant_id, schluessel, version)
);

-- Genau EINE lebende Version je Formular. Zwei waeren zwei Feldmengen, und
-- eine Einsendung wuesste nicht, gegen welche sie validiert wurde.
create unique index formular_definition_live_uk
  on formular_definition (mandant_id, schluessel)
  where veroeffentlicht_am is not null and zurueckgezogen_am is null;

create index formular_definition_oeffentlich_idx
  on formular_definition (mandant_id)
  where veroeffentlicht_am is not null and zurueckgezogen_am is null;

-- ---------------------------------------------------------------------------
-- formular_zustaendigkeit — die interne Haelfte.
-- ---------------------------------------------------------------------------
create table formular_zustaendigkeit (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  formular_definition_id uuid not null,
  /**
   * NULLABLE und ohne DEFAULT.
   *
   * O-14 ist offen: ob die Reaktionszeit in Kalender- oder Werktagsstunden
   * laeuft und wann sie an einem Freitagabend anfaengt, hat der Mandant nicht
   * gesagt. Ein `not null default 24` haette diese Frage per Spaltendefinition
   * beantwortet — eine erfundene Geschaeftsregel, die spaeter niemand als
   * Entscheidung wiederfindet.
   */
  sla_stunden   integer check (sla_stunden is null or sla_stunden > 0),
  standard_besitzer_benutzer_id uuid not null references benutzer(id),
  eskalation_benutzer_id        uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  constraint formular_zustaendigkeit_uk unique (formular_definition_id),
  constraint formular_zustaendigkeit_def_fk
    foreign key (mandant_id, formular_definition_id)
    references formular_definition (mandant_id, id)
);

-- ---------------------------------------------------------------------------
-- formular_eingang — was ankam.
-- ---------------------------------------------------------------------------
create table formular_eingang (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  -- Die exakte VERSION, die gerendert wurde.
  formular_definition_id uuid not null,
  daten         jsonb not null,

  utm_quelle    text,
  utm_medium    text,
  utm_kampagne  text,
  utm_begriff   text,
  utm_inhalt    text,
  referrer      text,
  landing_page  text,

  -- SHA-256 aus IP + serverseitigem Pfeffer. Die rohe IP wird NICHT
  -- gespeichert: sie ist personenbezogen, und die Missbrauchsabwehr braucht
  -- nur Gleichheit (LEG-09).
  ip_hash       text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent    text,
  spam_punkte   smallint not null default 0 check (spam_punkte between 0 and 100),

  /**
   * BESTAETIGUNG, nicht Einwilligung.
   *
   * Eine Anfrage zu bearbeiten stuetzt sich auf Art. 6(1)(b)/(f) DSGVO und
   * nicht auf Einwilligung; eine Einwilligung, die man nicht verweigern kann,
   * ist keine. Das Pflichthaekchen sagt deshalb: der Hinweis wurde GEZEIGT.
   * Die einzige echte Einwilligung ist die freiwillige fuer Werbung.
   */
  datenschutz_hinweis_bestaetigt boolean not null
    check (datenschutz_hinweis_bestaetigt),
  datenschutz_hinweis_version    text not null,
  einwilligung_werbung boolean not null default false,

  eingegangen_am timestamptz not null default now(),
  status        formular_eingang_status not null default 'neu',
  -- FK folgt in 0017: `lead` verweist zurueck auf diese Tabelle.
  lead_id       uuid,
  verarbeitet_am timestamptz,
  verarbeitet_von uuid,
  erstellt_am   timestamptz not null default now(),

  constraint formular_eingang_mandant_id_uk unique (mandant_id, id),
  constraint formular_eingang_def_fk
    foreign key (mandant_id, formular_definition_id)
    references formular_definition (mandant_id, id)
);

create index formular_eingang_arbeitsliste_idx
  on formular_eingang (mandant_id, status, eingegangen_am desc);
create index formular_eingang_def_idx on formular_eingang (formular_definition_id);
create index formular_eingang_lead_idx on formular_eingang (lead_id) where lead_id is not null;
create index formular_eingang_utm_idx
  on formular_eingang (mandant_id, utm_quelle, utm_kampagne, eingegangen_am);
create index formular_eingang_ip_idx
  on formular_eingang (ip_hash, eingegangen_am) where ip_hash is not null;
create index formular_eingang_daten_idx on formular_eingang using gin (daten jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Serverzeit und Unveraenderlichkeit.
-- ---------------------------------------------------------------------------

/**
 * `eingegangen_am` gehoert dem Server, nicht dem Aufrufer.
 *
 * `DEFAULT now()` greift nur, wenn die Spalte WEGGELASSEN wird — ein INSERT,
 * der einen Wert mitschickt, schreibt einen beliebigen Zeitpunkt, und der
 * Unveraenderlichkeits-Trigger unten macht ihn dann dauerhaft. Bei einem
 * Formular aus dem offenen Internet ist genau das der Angriff.
 */
create function kern.erzwinge_serverzeit() returns trigger
language plpgsql as $$
begin
  new.eingegangen_am := now();
  return new;
end $$;

create trigger trg_formular_eingang_serverzeit
  before insert on formular_eingang
  for each row execute function kern.erzwinge_serverzeit();

/**
 * Was ankam, bleibt wie es ankam.
 *
 * `daten`, die Attribution und die Datenschutz-Belege sind schreibgeschuetzt;
 * beweglich sind nur `status`, `lead_id` und `verarbeitet_*`. Ein Vertrieb,
 * der die Anfrage nachtraeglich "praezisiert", vernichtet den LEG-09-Beleg —
 * und niemand koennte danach sagen, was der Besucher wirklich geschickt hat.
 */
create function kern.formular_eingang_unveraenderlich() returns trigger
language plpgsql as $$
begin
  if new.daten is distinct from old.daten
     or new.utm_quelle is distinct from old.utm_quelle
     or new.utm_medium is distinct from old.utm_medium
     or new.utm_kampagne is distinct from old.utm_kampagne
     or new.utm_begriff is distinct from old.utm_begriff
     or new.utm_inhalt is distinct from old.utm_inhalt
     or new.referrer is distinct from old.referrer
     or new.landing_page is distinct from old.landing_page
     or new.ip_hash is distinct from old.ip_hash
     or new.datenschutz_hinweis_bestaetigt is distinct from old.datenschutz_hinweis_bestaetigt
     or new.datenschutz_hinweis_version is distinct from old.datenschutz_hinweis_version
     or new.einwilligung_werbung is distinct from old.einwilligung_werbung
     or new.eingegangen_am is distinct from old.eingegangen_am then
    raise exception 'Ein Formulareingang ist Beweis, kein Arbeitsblatt: nur status, lead_id und verarbeitet_* sind änderbar'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_formular_eingang_unveraenderlich
  before update on formular_eingang
  for each row execute function kern.formular_eingang_unveraenderlich();

/**
 * Eine veroeffentlichte Definition friert ihre Feldmenge ein.
 *
 * Sonst wird eine vor sechs Monaten gespeicherte Einsendung uninterpretierbar
 * und der Datenschutzbeleg zeigt auf einen Text, der so nie gezeigt wurde.
 * Eine Aenderung erzeugt `version + 1`.
 */
create function kern.formular_definition_unveraenderlich() returns trigger
language plpgsql as $$
begin
  if old.veroeffentlicht_am is not null
     and (new.felder is distinct from old.felder
          or new.datenschutz_hinweis_version is distinct from old.datenschutz_hinweis_version
          or new.schluessel is distinct from old.schluessel
          or new.version is distinct from old.version) then
    raise exception 'Eine veröffentlichte Formularversion ist eingefroren — eine Änderung ist version + 1'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger trg_formular_definition_unveraenderlich
  before update on formular_definition
  for each row execute function kern.formular_definition_unveraenderlich();

/**
 * `veroeffentlicht_am` ist ein EREIGNIS, kein Anlagedatum.
 *
 * Die unbedingte Serverzeit-Form wuerde jedes Formular im Moment des Anlegens
 * veroeffentlichen — und der `formular_definition_live_uk`-Index wiese dann
 * die zweite Version jedes Formulars mit einem 23505 ab.
 */
create function kern.erzwinge_serverzeit_veroeffentlichung() returns trigger
language plpgsql as $$
begin
  if new.veroeffentlicht_am is not null
     and (tg_op = 'INSERT' or old.veroeffentlicht_am is null) then
    new.veroeffentlicht_am := now();
  elsif tg_op = 'UPDATE' and old.veroeffentlicht_am is not null then
    new.veroeffentlicht_am := old.veroeffentlicht_am;
  end if;
  return new;
end $$;

create trigger trg_formular_definition_veroeffentlicht
  before insert or update on formular_definition
  for each row execute function kern.erzwinge_serverzeit_veroeffentlichung();

-- `geaendert_am` und das Änderungsprotokoll kommen aus dem generierten
-- Block am Dateiende — eine Liste, ein Erzeuger (rls.ts).

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------
alter table formular_definition     enable row level security;
alter table formular_definition     force  row level security;
alter table formular_zustaendigkeit enable row level security;
alter table formular_zustaendigkeit force  row level security;
alter table formular_eingang        enable row level security;
alter table formular_eingang        force  row level security;

create policy t_formular_lesen on formular_definition for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('formular.lesen', mandant_id));
create policy t_formular_schreiben on formular_definition for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('formular.schreiben', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('formular.schreiben', mandant_id));

/**
 * Die DRITTE permissive Policy auf `cse_app` — eine ausdrueckliche Ausnahme.
 *
 * K-03 legt die Menge auf zwei fest. Hier stehen drei, und der Grund ist
 * K-01: die Rollenmenge ist auf sechs festgeschrieben, also gibt es keine
 * siebte Postgres-Rolle fuer den oeffentlichen Lesepfad — das Praedikat muss
 * in einer Policy auf `cse_app` leben. Registriert in
 * `src/server/db/schema/rls.ts`, und ein Test besteht darauf, dass keine
 * zweite Tabelle dieser Domaene drei hat.
 *
 * Sicher ist das nur, weil diese Tabelle KEINE interne Spalte traegt: SLA,
 * Besitzer und Eskalationsziel stehen in `formular_zustaendigkeit`.
 */
create policy t_formular_oeffentlich on formular_definition for select to cse_app
  using (veroeffentlicht_am is not null and zurueckgezogen_am is null
         and app.hat_recht('oeffentlich.lesen', mandant_id));

create policy t_zustaendigkeit on formular_zustaendigkeit for all to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('formular.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('formular.schreiben', mandant_id));

-- Interne Decke: SLA und Eskalationsziel sind nichts fuer Mitarbeiter- oder
-- Kundenportal.
create policy p_intern_zustaendigkeit on formular_zustaendigkeit
  as restrictive for all to cse_app
  using (app.portal() = 'intern');

create policy t_eingang_lesen on formular_eingang for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten())
         and app.hat_recht('formular.lesen', mandant_id));
create policy t_eingang_schreiben on formular_eingang for all to cse_app
  using (mandant_id = app.aktiver_mandant()
         and app.hat_recht('formular.lesen', mandant_id))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and app.hat_recht('formular.schreiben', mandant_id));

/**
 * Die interne Decke hier ist `for select, update, delete` — NICHT `for all`.
 *
 * Eine restriktive Policy ohne `WITH CHECK` benutzt ihren `USING`-Ausdruck
 * auch fuer INSERT. Eine `for all`-Decke haette also jede oeffentliche
 * Einsendung abgewiesen, weil der Formular-Eingangsprinzipal nicht auf
 * `portal = 'intern'` laeuft — und REQ-01 … REQ-07 haetten ueberhaupt keinen
 * Schreibweg gehabt.
 *
 * Lesen, Bearbeiten und Loeschen bleiben intern. Der INSERT wird allein von
 * K-03s `WITH CHECK` bewacht, und der verlangt weiterhin `formular.schreiben`
 * und `not app.ist_readonly()`.
 */
-- Postgres kennt je Policy GENAU EIN Kommando — deshalb drei Zeilen und
-- nicht eine Liste. Dass INSERT fehlt, ist der ganze Punkt.
create policy p_intern_eingang_select on formular_eingang
  as restrictive for select to cse_app using (app.portal() = 'intern');
create policy p_intern_eingang_update on formular_eingang
  as restrictive for update to cse_app using (app.portal() = 'intern');
create policy p_intern_eingang_delete on formular_eingang
  as restrictive for delete to cse_app using (app.portal() = 'intern');

/**
 * Die Zustaendigkeit fuer die ANNAHME — als Definer-Funktion, nicht als Policy.
 *
 * Der Formular-Eingangsprinzipal braucht zwei Werte, um einen Lead anzulegen:
 * die Frist und den benannten Besitzer. Er haelt aber ausdruecklich **kein**
 * `formular.lesen` (03-AUTH §14.3) — sonst koennte er auch fremde Einsendungen
 * zurueckholen, und er ist die zum Internet offene Haelfte des Systems.
 *
 * Ihm dafuer `formular.lesen` zu geben waere der bequeme Weg und der falsche:
 * er oeffnete `formular_eingang` gleich mit. Diese Funktion gibt stattdessen
 * GENAU die zwei Felder heraus, die die Annahme braucht, und nichts sonst —
 * kein Eskalationsempfaenger, keine Einsendung, keine Zeile einer anderen
 * Tabelle.
 */
create function app.formular_zustaendigkeit(p_formular uuid)
returns table (sla_stunden integer, besitzer uuid)
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select z.sla_stunden, z.standard_besitzer_benutzer_id
    from public.formular_zustaendigkeit z
    join public.formular_definition d on d.id = z.formular_definition_id
   where z.formular_definition_id = p_formular
     and d.veroeffentlicht_am is not null and d.zurueckgezogen_am is null
$$;

grant execute on function app.formular_zustaendigkeit(uuid) to cse_app;

/**
 * Das Ratenlimit ZAEHLT — es liest nicht.
 *
 * Der erste Entwurf zaehlte mit einem gewoehnlichen `select count(*)` auf
 * `formular_eingang`. Der Eingangsprinzipal haelt kein `formular.lesen`, die
 * Policy gab null Zeilen frei, und die Zaehlung ergab immer 0: das Limit war
 * eingebaut und wirkungslos, und nichts daran war zu sehen. Ein Schutz, der
 * still nichts tut, ist schlechter als keiner — er wird geglaubt.
 *
 * Diese Funktion gibt eine ZAHL heraus und keine Zeile. Wer sie aufruft,
 * erfaehrt, wie oft dieselbe Verbindung eingesendet hat, und nichts darueber,
 * WAS eingesendet wurde.
 */
create function app.formular_eingang_zaehlen(p_ip_hash text, p_seit timestamptz)
returns integer
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select count(*)::int from public.formular_eingang e
   where e.ip_hash = p_ip_hash and e.eingegangen_am > p_seit
$$;

grant execute on function app.formular_eingang_zaehlen(text, timestamptz) to cse_app;

grant select, insert, update on formular_definition to cse_app;
grant select, insert, update on formular_zustaendigkeit to cse_app;
grant select, insert, update on formular_eingang to cse_app;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0016)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- formular_definition (archiv): REQ-01. Eine gespeicherte Einsendung verweist auf die Version, gegen die sie validiert wurde. Wird die Definition gelöscht, ist die Einsendung nicht mehr lesbar und der LEG-09-Datenschutzbeleg zeigt ins Leere. Zurückziehen heisst `zurueckgezogen_am`, nicht DELETE.
create trigger trg_formular_definition_kein_hard_delete
  before delete on formular_definition
  for each row execute function kern.verhindere_loeschung();
create trigger trg_formular_definition_kein_truncate
  before truncate on formular_definition
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on formular_definition from cse_app, cse_anon, cse_checkin, cse_job;

-- formular_zustaendigkeit (archiv): REQ-05/REQ-06. Sie hält die SLA und den benannten Besitzer eines Formulars; ohne sie lässt sich im Nachhinein nicht sagen, welche Frist für einen Lead galt. Sie endet mit ihrer Definition, nicht für sich.
create trigger trg_formular_zustaendigkeit_kein_hard_delete
  before delete on formular_zustaendigkeit
  for each row execute function kern.verhindere_loeschung();
create trigger trg_formular_zustaendigkeit_kein_truncate
  before truncate on formular_zustaendigkeit
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on formular_zustaendigkeit from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_formular_definition_geaendert_am
  before update on formular_definition
  for each row execute function kern.setze_geaendert_am();
create trigger trg_formular_zustaendigkeit_geaendert_am
  before update on formular_zustaendigkeit
  for each row execute function kern.setze_geaendert_am();

create trigger trg_formular_definition_audit
  after insert or update or delete on formular_definition
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_formular_zustaendigkeit_audit
  after insert or update or delete on formular_zustaendigkeit
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
