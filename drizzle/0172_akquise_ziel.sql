/**
 * 0172 — Die Akquise-Recherche: Firmen finden, bewerten, zuordnen
 * (§12 und §13 der Auftragsbeschreibung, CRM-01…CRM-08, D-01).
 *
 * ════════════════════════════════════════════════════════════════════════
 * WARUM DIESE TABELLE KEINE PERSONENDATEN TRÄGT
 * ════════════════════════════════════════════════════════════════════════
 *
 * Die Auftragsbeschreibung verlangt eine Lead-Datenbank mit „Kontaktdaten,
 * wo rechtlich verfügbar". Der gefährliche Teil daran ist nicht das Senden,
 * sondern das HALTEN: wer personenbezogene Daten aus öffentlichen Quellen
 * sammelt, muss die betroffene Person nach **Art. 14 DSGVO binnen eines
 * Monats** darüber informieren, dass er sie hat. Für eine Datenbank mit
 * tausend recherchierten Ansprechpartnern heisst das tausend Briefe — und wer
 * sie nicht schreibt, hält eine Datenbank, die er nicht halten darf.
 *
 * Deshalb steht hier die FIRMA und nur die Firma: Name, Branche, Ort,
 * Website, allgemeine Anschrift. Eine juristische Person ist keine betroffene
 * Person im Sinne der DSGVO, und eine allgemeine `info@`-Adresse trägt keinen
 * Namen. Ein Ansprechpartner MIT Namen entsteht erst dort, wo es ihn schon
 * geben darf: in `ansprechpartner`, mit einer erfassten `rechtsgrundlage`
 * (0020) — also wenn jemand angefragt hat, eingewilligt hat oder Kunde ist.
 *
 * `akquise_ziel.lead_id` ist die Naht zwischen beiden Welten: solange sie
 * `null` ist, ist das hier Marktbeobachtung über Firmen. Sobald ein Mensch
 * entscheidet, dass daraus ein Vorgang wird, entsteht ein `lead` — und ab da
 * gelten dessen Regeln.
 *
 * ════════════════════════════════════════════════════════════════════════
 * WAS HIER NICHT PASSIERT
 * ════════════════════════════════════════════════════════════════════════
 *
 * Diese Migration legt KEINE Quelle an, die von selbst irgendwo Daten abholt.
 * `akquise_quelle.verbunden` ist überall `false`, bis jemand eine Quelle
 * benennt und ihre Nutzungsbedingungen prüft — CLAUDE.md verbietet das
 * Scrapen ausdrücklich (D-02 für Jobbörsen, dieselbe Begründung hier), und
 * eine Quelle, die „funktioniert", ohne dass jemand sie beauftragt hat, wäre
 * genau die vorgetäuschte Integration, die §32 der Auftragsbeschreibung
 * verbietet.
 */

-- ---------------------------------------------------------------------------
-- 1. Die Quellen der Recherche — sichtbar, benannt, standardmäßig unverbunden
-- ---------------------------------------------------------------------------

create type akquise_quelle_art as enum (
  -- Ein Mensch trägt eine Firma ein, die ihm aufgefallen ist. Immer erlaubt.
  'manuell',
  -- Ein amtliches Verzeichnis mit einer Schnittstelle (Handelsregister,
  -- Unternehmensregister, Branchenverzeichnis mit Vertrag).
  'register',
  -- Eine beauftragte Datenquelle mit Vertrag und Nutzungserlaubnis.
  'dienstleister',
  -- Aus einer Ausschreibung des Vergaberadars: dort steht die Vergabestelle,
  -- und die ist eine Firma, die Leistungen einkauft.
  'vergabe_radar'
);

comment on type akquise_quelle_art is
  '§12. Woher eine recherchierte Firma stammt. Scrapen steht NICHT in dieser Liste — '
  'CLAUDE.md verbietet es, und eine Quelle ohne Nutzungserlaubnis ist keine Quelle.';

create table akquise_quelle (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  art           akquise_quelle_art not null,
  bezeichnung   text not null check (btrim(bezeichnung) <> ''),

  /**
   * **Standardmäßig `false`, und das ist die Aussage.** Eine Quelle gilt erst
   * als verbunden, wenn jemand ihren Vertrag, ihre Nutzungsbedingungen und
   * ihre Schnittstelle geprüft hat. Bis dahin steht sie in der Oberfläche als
   * „nicht verbunden" MIT Grund — eine Liste, in der eine Quelle einfach
   * fehlt, liest sich wie „geht nicht", und die Wahrheit ist „noch nicht
   * beauftragt" (§32).
   */
  verbunden     boolean not null default false,
  hinweis       text,
  basis_url     text,

  aktiv         boolean not null default true,
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,

  constraint akquise_quelle_uk unique (mandant_id, art, bezeichnung),
  -- Eine verbundene Quelle ohne Adresse ist eine Behauptung.
  constraint akquise_quelle_verbunden_hat_url check (
    not verbunden or art = 'manuell' or basis_url is not null)
);

comment on table akquise_quelle is
  '§12. Woher die Akquise-Recherche ihre Firmen bezieht. `manuell` braucht keine '
  'Adresse; alles andere schon, sobald es verbunden ist.';

-- ---------------------------------------------------------------------------
-- 2. Das recherchierte Ziel — eine FIRMA, kein Mensch
-- ---------------------------------------------------------------------------

create type akquise_status as enum (
  'neu',          -- gefunden, noch nicht angesehen
  'geprueft',     -- ein Mensch hat es angesehen und für passend befunden
  'verworfen',    -- passt nicht; der Grund steht daneben
  'uebernommen'   -- daraus ist ein `lead` geworden
);

create table akquise_ziel (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  quelle_id     uuid references akquise_quelle(id),

  -- ─── Firmendaten. Keine Personendaten. Siehe Kopfkommentar. ───
  firmenname    text not null check (btrim(firmenname) <> ''),
  branche       text,
  strasse       text,
  plz           text,
  ort           text,
  land          text not null default 'DE',
  website       text,
  /**
   * Eine ALLGEMEINE Adresse (`info@`, `kontakt@`) — keine mit einem Namen
   * darin. Der CHECK ist kein Stilmittel: `max.mustermann@firma.de` ist ein
   * personenbezogenes Datum, und für das gilt Art. 14 DSGVO.
   */
  allgemeine_email text check (
    allgemeine_email is null or allgemeine_email ~ '^[^@]+@[^@]+\.[a-z]{2,}$'),
  telefon       text,

  -- ─── Was die Bewertung daraus macht (deterministisch, nie ein Modell) ───
  punktzahl     smallint check (punktzahl between 0 and 100),
  punktzahl_begruendung text,
  punktzahl_berechnet_am timestamptz,
  /**
   * Welcher CSE-Bereich passt? Der Slug einer Gesellschaft — oder `null`,
   * wenn die Regeln keinen eindeutigen Treffer ergeben. `null` ist hier eine
   * ehrliche Antwort und kein Fehler: „passt zu keinem" ist ein Ergebnis.
   */
  passender_bereich text,
  bedarf_vermutung text,

  status        akquise_status not null default 'neu',
  verworfen_grund text,
  /**
   * Die Naht zur Lead-Welt. Gesetzt heisst: ein Mensch hat entschieden, dass
   * daraus ein Vorgang wird, und ab da gelten die Regeln von `lead`.
   */
  lead_id       uuid,

  gefunden_am   timestamptz not null default now(),
  angesehen_am  timestamptz,
  angesehen_von uuid references benutzer(id),

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  -- Invariante 8: kein hartes Löschen. Verworfen ist ein Zustand, kein Nichts.
  archiviert_am timestamptz,

  constraint akquise_ziel_mandant_uk unique (mandant_id, id),
  constraint akquise_ziel_verworfen_hat_grund check (
    status <> 'verworfen' or btrim(coalesce(verworfen_grund, '')) <> ''),
  constraint akquise_ziel_uebernommen_hat_lead check (
    status <> 'uebernommen' or lead_id is not null)
);

comment on table akquise_ziel is
  '§12. Eine recherchierte FIRMA — bewusst ohne benannten Ansprechpartner: wer '
  'Personendaten aus oeffentlichen Quellen haelt, schuldet Art. 14 DSGVO eine '
  'Information binnen eines Monats. Ein Mensch mit Namen entsteht erst in '
  'ansprechpartner, mit erfasster rechtsgrundlage.';

comment on column akquise_ziel.allgemeine_email is
  'NUR eine unpersoenliche Adresse (info@, kontakt@). Eine Adresse mit einem Namen '
  'darin waere ein personenbezogenes Datum — und dann gilt Art. 14 DSGVO.';

comment on column akquise_ziel.passender_bereich is
  '§12: „The AI should analyze the company and determine which CSE business area is '
  'most relevant." Deterministisch aus Branche und Stichwoertern (Invariante 6), mit '
  'lesbarer Begruendung in punktzahl_begruendung. NULL heisst „kein eindeutiger Treffer".';

/**
 * **Dieselbe Firma nicht zweimal je Gesellschaft** — als INDEX und nicht als
 * `constraint`: ein `unique constraint` nimmt nur Spalten, und der Ort ist
 * `null`-faehig. Zwei Zeilen mit `ort is null` waeren fuer einen gewoehnlichen
 * eindeutigen Index VERSCHIEDEN (NULL ist nicht gleich NULL) — und dann stuende
 * „Mustermann GmbH" ohne Ort beliebig oft da. `coalesce` macht daraus einen
 * vergleichbaren Wert, und das geht nur im Index.
 */
create unique index akquise_ziel_firma_uk
  on akquise_ziel (mandant_id, lower(firmenname), coalesce(lower(ort), ''))
  where archiviert_am is null;

create index akquise_ziel_offen_idx on akquise_ziel (mandant_id, punktzahl desc nulls last)
  where status in ('neu', 'geprueft') and archiviert_am is null;

create index akquise_ziel_lead_idx on akquise_ziel (lead_id) where lead_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Der Recherchelauf — was wann gefunden wurde
-- ---------------------------------------------------------------------------

create table akquise_lauf (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  quelle_id     uuid references akquise_quelle(id),
  begonnen_am   timestamptz not null default now(),
  beendet_am    timestamptz,
  /**
   * `uebersprungen` ist der Normalfall, solange keine Quelle verbunden ist —
   * und er wird AUFGESCHRIEBEN statt verschwiegen. Ein Lauf, der still nichts
   * tut, sieht am nächsten Morgen aus wie ein Tag ohne Treffer.
   */
  ergebnis      text not null check (ergebnis in ('erfolg', 'uebersprungen', 'fehler')),
  meldung       text,
  gefunden      integer not null default 0 check (gefunden >= 0),
  neu           integer not null default 0 check (neu >= 0),
  erstellt_am   timestamptz not null default now()
);

comment on table akquise_lauf is
  '§12. Ein Recherchelauf. `uebersprungen` heisst: keine Quelle verbunden — '
  'aufgeschrieben, nicht verschwiegen (§32).';

-- ---------------------------------------------------------------------------
-- 4. RLS, Policies, Spaltenrechte
-- ---------------------------------------------------------------------------

alter table akquise_quelle enable row level security;
alter table akquise_quelle force  row level security;
alter table akquise_ziel   enable row level security;
alter table akquise_ziel   force  row level security;
alter table akquise_lauf   enable row level security;
alter table akquise_lauf   force  row level security;

/**
 * Das Recht ist `crm.lesen` bzw. `crm.schreiben` — die Akquise ist der
 * Vertriebsvorlauf und gehoert in dasselbe Modul wie Leads und Kontakte. Ein
 * eigener Schluessel waere einer, den man anschliessend jeder Rolle bindet,
 * die schon `crm.schreiben` hat: er pruefte nichts und behauptete zu pruefen
 * (K-19).
 */
create policy t_akquise_quelle_lesen on akquise_quelle for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('crm.lesen', app.aktiver_mandant())));

create policy t_akquise_quelle_schreiben on akquise_quelle for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('crm.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('crm.schreiben', app.aktiver_mandant())));

create policy t_akquise_ziel_lesen on akquise_ziel for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('crm.lesen', app.aktiver_mandant())));

create policy t_akquise_ziel_gruppe on akquise_ziel for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.crm.lesen')));

create policy t_akquise_ziel_schreiben on akquise_ziel for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('crm.schreiben', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant() and not app.ist_readonly()
              and (select app.hat_recht('crm.schreiben', app.aktiver_mandant())));

create policy t_akquise_lauf_lesen on akquise_lauf for select to cse_app
  using (mandant_id = app.aktiver_mandant()
         and (select app.hat_recht('crm.lesen', app.aktiver_mandant())));

-- Laeufe schreibt der Job, nicht der Mensch.
create policy j_akquise_lauf on akquise_lauf for all to cse_job using (true) with check (true);
create policy j_akquise_ziel on akquise_ziel for all to cse_job using (true) with check (true);
create policy j_akquise_quelle on akquise_quelle for select to cse_job using (true);

grant select, insert, update on akquise_quelle to cse_app;
grant select, insert, update on akquise_ziel   to cse_app;
grant select                  on akquise_lauf  to cse_app;
grant select, insert, update on akquise_ziel, akquise_lauf to cse_job;
grant select on akquise_quelle to cse_job;

/**
 * **Kein hartes Loeschen** (Invariante 8). Ein verworfenes Ziel bleibt mit
 * seinem Grund stehen: sonst findet dieselbe Recherche es naechste Woche
 * wieder, und jemand prueft es ein zweites Mal.
 */
create trigger trg_akquise_ziel_kein_loeschen before delete on akquise_ziel
  for each row execute function kern.verhindere_loeschung();
create trigger trg_akquise_quelle_kein_loeschen before delete on akquise_quelle
  for each row execute function kern.verhindere_loeschung();

create trigger trg_akquise_ziel_geaendert before update on akquise_ziel
  for each row execute function kern.setze_geaendert_am();
create trigger trg_akquise_quelle_geaendert before update on akquise_quelle
  for each row execute function kern.setze_geaendert_am();
