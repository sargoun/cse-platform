-- ---------------------------------------------------------------------------
-- 0020 — CRM-Identitaet: firma, kunde, ansprechpartner, kunde_zugang
--        und das Tor aus §7 UWG (CRM-08).
--
-- **Der Kern dieser Migration ist nicht die Tabelle, sondern das Tor.**
-- `rechtsgrundlage` steht mit `DEFAULT 'keine'` da — die SPERRENDE Vorgabe.
-- Ein Kontakt, der aus einem Import, einem Formular, einem Agenten oder einer
-- vergessenen Migration entsteht, ist damit nicht ansprechbar, bis ein Mensch
-- eine Grundlage MIT BELEG eintraegt. § 7 UWG verbietet elektronische Werbung
-- ohne vorherige ausdrueckliche Einwilligung — auch im B2B —, und ein System,
-- das im Zweifel sendet, produziert Abmahnungen.
--
-- Zwei Widersprueche werden getrennt gehalten (§5.1) und das ist der Punkt,
-- an dem die meisten Implementierungen falsch liegen:
--   * `widerspruch_am`      — Widerspruch gegen die VERARBEITUNG (Art. 21 DSGVO).
--                             Zwingt `rechtsgrundlage` auf `keine`.
--   * `werbewiderspruch_am` — Widerspruch gegen WERBUNG. Er beendet die Werbung,
--                             NICHT die vertragliche Kommunikation: eine Rechnung
--                             darf weiter zugestellt werden.
-- Sie zusammenzuwerfen heisst entweder Werbung an Widersprechende oder keine
-- Rechnung an Bestandskunden.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Vokabulare (§2).
-- ---------------------------------------------------------------------------

-- `rechtsgrundlage`, `kommunikationszweck` und `aktivitaet_richtung` stehen
-- bereits in 0017 (Lead-Domaene) und werden hier NICHT neu erklaert. Sie dort
-- zu wiederholen waere ein zweiter Name fuer dieselbe Sache — und der erste,
-- der beide aendert, aendert nur einen.
--
-- `kommunikationszweck` traegt in 0017 VIER Werte: `vertraglich`,
-- `transaktional`, `werbung`, `intern`. §5.1 kennt drei. Wie `transaktional`
-- werberechtlich einzuordnen ist, IST die offene Frage O-65, und das Tor unten
-- behandelt ihn deshalb im restriktiven Zweig — sichtbar, nicht stillschweigend.

-- PLACEHOLDER  // TODO(client, O-73): Kundenkategorien bestaetigen; `behoerde`
-- steuert die XRechnungs-Pflicht (FIN-11) und muss stimmen.
create type kunde_typ as enum ('firma','behoerde','privat');

-- PLACEHOLDER  // TODO(client, O-73): Kundenstatus bestaetigen.
create type kunde_status as enum ('aktiv','inaktiv','gesperrt');

-- ---------------------------------------------------------------------------
-- app.rechte_mandanten — in welchen Bereichen haelt der Aufrufer ein Recht?
-- ---------------------------------------------------------------------------

/**
 * Die Bereiche, in denen dieser Benutzer `p_recht` haelt.
 *
 * Die Gruppenpolicy `t_gruppe` braucht genau das: nicht "welche Bereiche sind
 * sichtbar", sondern "in welchen davon darf gelesen werden". Ohne diese
 * Trennung liest eine `leitung`, die in Reinigung UND Security Mitglied ist,
 * in der Gruppenansicht auch die Bereiche, fuer die ihr das Gruppenrecht nie
 * erteilt wurde.
 *
 * `stable`, damit der Planer sie je Anweisung EINMAL auswertet und nicht je
 * Zeile — auf einem Raumbuch mit 4 000 Zeilen ist das der Unterschied zwischen
 * einer Abfrage und einer Minute.
 */
create function app.rechte_mandanten(p_recht text) returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select coalesce(array_agg(m), '{}')
    from unnest(app.sichtbare_mandanten()) as s(m)
   where app.hat_recht(p_recht, m)
$$;

comment on function app.rechte_mandanten(text) is
  'Die sichtbaren Bereiche, in denen der Aufrufer das Recht haelt (K-03, t_gruppe).';

grant execute on function app.rechte_mandanten(text) to cse_app;

-- ---------------------------------------------------------------------------
-- firma — die Rechtseinheit draussen in der Welt, gesellschaftsuebergreifend.
-- ---------------------------------------------------------------------------

/**
 * Die gemeinsame Identitaet hinter derselben Firma, die zwei oder drei
 * Gesellschaften der Gruppe bedienen. Das kundenseitige Gegenstueck zu D-09s
 * Trennung `person` / `anstellung`: CRM-06 zeigt die Historie ueber alle vier
 * Bereiche, ohne dass ein Bereich die Konditionen eines anderen sieht.
 *
 * **Nicht mandantenbezogen und nicht direkt schreibbar.** Ein globales
 * `UNIQUE (ust_id)` plus ein `INSERT` durch die Anwendung waere ein Orakel:
 * ein `23505` sagte einer Reinigungs-Benutzerin, dass SSE Security diese Firma
 * bereits bedient — genau die Auskunft "403 bestaetigt die Existenz", die
 * AUT-06 verhindert, nur als Constraint-Fehler. Angelegt wird deshalb
 * ausschliesslich ueber `app.firma_aufloesen`, die NUR eine id zurueckgibt.
 */
create table firma (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  rechtsform                  text,
  ust_id                      text,
  steuernummer                text,
  handelsregister_gericht     text,
  handelsregister_nummer      text,
  land                        char(2) not null default 'DE',
  zusammengefuehrt_in_firma_id uuid references firma(id),
  erstellt_am                 timestamptz not null default now(),
  erstellt_von                uuid,
  geaendert_am                timestamptz,
  geaendert_von               uuid,

  constraint firma_keine_selbstverschmelzung
    check (zusammengefuehrt_in_firma_id is null or zusammengefuehrt_in_firma_id <> id)
);

create unique index firma_ust_id_uk on firma (ust_id) where ust_id is not null;
create index firma_name_trgm on firma using gin (name gin_trgm_ops);
create index firma_zusammengefuehrt_idx on firma (zusammengefuehrt_in_firma_id)
  where zusammengefuehrt_in_firma_id is not null;

-- ---------------------------------------------------------------------------
-- kunde — die Kundenbeziehung EINER Gesellschaft zu einer Firma.
-- ---------------------------------------------------------------------------

create table kunde (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  firma_id      uuid references firma(id),
  kundennummer  text not null,
  typ           kunde_typ not null default 'firma',
  name          text not null,
  rechtsform    text,
  ust_id        text,
  steuernummer  text,

  -- FIN-11: die XRechnungs-Pflicht haengt am oeffentlichen Auftraggeber, aber
  -- nicht nur — auch private Kaeufer koennen sie verlangen.
  ist_oeffentlicher_auftraggeber boolean not null default false,
  xrechnung_pflicht              boolean not null default false,
  leitweg_id                     text,
  elektronische_adresse          text,
  -- // TODO(client, O-22): Welche elektronische Adresse und welches EAS-Schema
  -- hat jeder oeffentliche Auftraggeber?
  elektronische_adresse_schema   text,
  kaeufer_referenz               text,

  -- K-05: die wirtschaftlichen Spalten sind spaltenweise entzogen (unten).
  debitorennummer   text,
  -- // TODO(client, O-66): Standard-Zahlungsziel je Gesellschaft?
  zahlungsziel_tage smallint,
  mahnsperre_bis    date,
  mahnsperre_grund  text,

  strasse       text,
  hausnummer    text,
  plz           text,
  ort           text,
  land          char(2) not null default 'DE',
  rechnungsadresse_abweichend boolean not null default false,
  rechnung_name       text,
  rechnung_strasse    text,
  rechnung_hausnummer text,
  rechnung_plz        text,
  rechnung_ort        text,
  rechnung_land       char(2),
  rechnung_email      text,
  email_zentral       text,
  telefon_zentral     text,
  webseite            text,

  -- CRM-08. Die Vorgabe ist der sperrende Wert — mit Absicht.
  rechtsgrundlage                  rechtsgrundlage not null default 'keine',
  rechtsgrundlage_quelle           text,
  rechtsgrundlage_erfasst_am       timestamptz,
  rechtsgrundlage_beleg_dokument_id uuid,
  werbewiderspruch_am              timestamptz,
  widerspruch_am                   timestamptz,

  status        kunde_status not null default 'aktiv',
  notiz         text,
  anonymisiert_am timestamptz,
  archiviert_am timestamptz,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  primary key (id),
  constraint kunde_mandant_uk unique (mandant_id, id),

  -- Eine Grundlage OHNE Beleg ist keine Grundlage.
  constraint kunde_grundlage_belegt check (
    rechtsgrundlage = 'keine'
    or (rechtsgrundlage_quelle is not null and rechtsgrundlage_erfasst_am is not null)),
  constraint kunde_widerspruch_sperrt
    check (widerspruch_am is null or rechtsgrundlage = 'keine'),
  constraint kunde_rechnungsadresse_vollstaendig check (
    rechnungsadresse_abweichend = false
    or (rechnung_strasse is not null and rechnung_plz is not null
        and rechnung_ort is not null)),
  -- Eine Definitionsfrage, keine Rechtsregel: eine Behoerde IST ein
  -- oeffentlicher Auftraggeber. Dass die Leitweg-ID existieren MUSS, steht
  -- absichtlich NICHT hier — ein oeffentlicher Kunde wird zu Recht angelegt,
  -- bevor sie bekannt ist. Die Pflicht greift in der §14-UStG-Vorpruefung, die
  -- das Festschreiben blockiert (FIN-04).
  constraint kunde_behoerde_ist_oeffentlich
    check (typ <> 'behoerde' or ist_oeffentlicher_auftraggeber),
  constraint kunde_mahnsperre_begruendet
    check ((mahnsperre_bis is null) = (mahnsperre_grund is null)),
  constraint kunde_zahlungsziel_plausibel
    check (zahlungsziel_tage is null or zahlungsziel_tage between 0 and 180),
  constraint kunde_plz_form check (plz is null or plz ~ '^[0-9A-Za-z \-]{3,10}$'),
  -- Bewusst lose: die strenge Leitweg-Pruefung laeuft im XRechnungs-Validator
  -- gegen die KoSIT-Liste, nicht in einem CHECK, der Dateneingabe blockiert.
  constraint kunde_leitweg_form
    check (leitweg_id is null or leitweg_id ~ '^[0-9A-Za-z][0-9A-Za-z:.\-]{2,45}$')
);

create unique index kunde_nummer_uk on kunde (mandant_id, kundennummer)
  where archiviert_am is null;
create unique index kunde_debitor_uk on kunde (mandant_id, debitorennummer)
  where debitorennummer is not null and archiviert_am is null;
create index kunde_liste_idx on kunde (mandant_id, status, name);
create index kunde_name_trgm on kunde using gin (name gin_trgm_ops);
create index kunde_firma_idx on kunde (firma_id) where firma_id is not null;
create index kunde_grundlage_idx on kunde (mandant_id, rechtsgrundlage)
  where archiviert_am is null;
create index kunde_mandant_idx on kunde (mandant_id) where archiviert_am is null;
-- Die FIN-11-Arbeitsliste: ohne Leitweg-ID ist dieser Kaeufer gar nicht
-- berechenbar.
create index kunde_fin11_luecken_idx on kunde (mandant_id)
  where typ = 'behoerde' and (leitweg_id is null or elektronische_adresse is null);

-- ---------------------------------------------------------------------------
-- ansprechpartner — der benannte Mensch beim Kunden, und die Zeile, auf der
-- das §7-UWG-Tor tatsaechlich sitzt.
-- ---------------------------------------------------------------------------

create table ansprechpartner (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  kunde_id      uuid,
  anrede        text,
  titel         text,
  vorname       text,
  nachname      text not null,
  position      text,
  abteilung     text,
  email         text,
  telefon       text,
  mobil         text,
  sprache       sprache not null default 'de',
  ist_hauptkontakt boolean not null default false,

  rechtsgrundlage                  rechtsgrundlage not null default 'keine',
  rechtsgrundlage_quelle           text,
  rechtsgrundlage_erfasst_am       timestamptz,
  rechtsgrundlage_beleg_dokument_id uuid,
  -- Einwilligung nach §7 UWG ist KANALBEZOGEN: wer per E-Mail eingewilligt
  -- hat, hat nicht per Telefon eingewilligt.
  einwilligung_kanaele  text[],
  werbewiderspruch_am   timestamptz,
  widerspruch_am        timestamptz,

  ausgeschieden_am date,
  anonymisiert_am  timestamptz,
  archiviert_am    timestamptz,
  erstellt_am      timestamptz not null default now(),
  erstellt_von     uuid,
  geaendert_am     timestamptz,
  geaendert_von    uuid,

  primary key (id),
  constraint ansprechpartner_mandant_uk unique (mandant_id, id),
  -- Die zweite, damit `objekt` einen Kontakt an SEINEN Kunden binden kann.
  constraint ansprechpartner_kunde_uk unique (mandant_id, kunde_id, id),
  constraint ansprechpartner_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),

  constraint ansprechpartner_email_form
    check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint ansprechpartner_grundlage_belegt check (
    rechtsgrundlage = 'keine'
    or (rechtsgrundlage_quelle is not null and rechtsgrundlage_erfasst_am is not null)),
  constraint ansprechpartner_widerspruch_sperrt
    check (widerspruch_am is null or rechtsgrundlage = 'keine'),
  -- Kanaleinwilligung ergibt nur unter `einwilligung` einen Sinn.
  constraint ansprechpartner_kanaele_nur_bei_einwilligung
    check (rechtsgrundlage = 'einwilligung' or einwilligung_kanaele is null),
  constraint ansprechpartner_kanaele_bekannt
    check (einwilligung_kanaele is null
           or einwilligung_kanaele <@ array['email','telefon','sms','post','whatsapp'])
);

create index ansprechpartner_liste_idx on ansprechpartner (mandant_id, kunde_id)
  where archiviert_am is null;

/**
 * `NULLS NOT DISTINCT` ist hier der ganze Punkt.
 *
 * Mit der Vorgabe-Semantik (NULLs sind verschieden) beschraenkt dieser Index
 * genau die Population NICHT, fuer die er da ist: jeder Kontakt vor der
 * Umwandlung hat `kunde_id IS NULL`. Zehn Einsendungen von
 * `einkauf@example.de` erzeugten zehn Zeilen mit je eigener `rechtsgrundlage`
 * und eigenem `werbewiderspruch_am` — ein Widerspruch auf einer davon liesse
 * neun ansprechbare Zwillinge stehen, und die Beweiskette aus §7 UWG zerfiele
 * auf zehn ids.
 */
create unique index ansprechpartner_email_uk
  on ansprechpartner (mandant_id, kunde_id, lower(email)) nulls not distinct
  where archiviert_am is null and email is not null;

create index ansprechpartner_email_idx on ansprechpartner (mandant_id, lower(email));
-- Genau ein Hauptkontakt — partiell, sonst blockiert ein archivierter fuer
-- immer die Ernennung eines neuen.
create unique index ansprechpartner_hauptkontakt_uk
  on ansprechpartner (mandant_id, kunde_id)
  where ist_hauptkontakt and archiviert_am is null;
create index ansprechpartner_grundlage_idx on ansprechpartner (mandant_id, rechtsgrundlage)
  where archiviert_am is null;
-- LEG-09: die Auskunft nach Art. 15/20 braucht einen unterstuetzten Weg.
create index ansprechpartner_name_idx
  on ansprechpartner (mandant_id, lower(nachname), lower(vorname));

-- ---------------------------------------------------------------------------
-- kunde_zugang — der Kundenportal-Login (K-18, Scope 4).
-- ---------------------------------------------------------------------------

/**
 * Welcher `benutzer` handelt fuer welchen `kunde` in welchem Bereich.
 *
 * **Ohne diese Tabelle hat die K-04-Kundendecke nichts, woran sie haengt**,
 * und `app.sichtbare_mandanten()` gab im Kunden-Scope die leere Menge zurueck
 * — fail closed und ausdruecklich als "bis das CRM kommt" vermerkt. Es kommt
 * hier.
 *
 * Kein `status`: der Lebenszyklus steht in `aktiviert_am` / `entzogen_am`.
 * Zwei Quellen fuer denselben Zustand laufen auseinander.
 */
create table kunde_zugang (
  id            uuid primary key default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  kunde_id      uuid not null,
  benutzer_id   uuid not null references benutzer(id),
  aktiviert_am  timestamptz not null default now(),
  entzogen_am   timestamptz,
  entzogen_von  uuid,
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid,
  geaendert_am  timestamptz,
  geaendert_von uuid,

  constraint kunde_zugang_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id)
);

create unique index kunde_zugang_uk on kunde_zugang (benutzer_id, mandant_id)
  where entzogen_am is null;
create index kunde_zugang_kunde_idx on kunde_zugang (mandant_id, kunde_id)
  where entzogen_am is null;

/**
 * Die Kunden, fuer die die angemeldete Person handelt.
 *
 * `security definer`, weil sie unter der Kundendecke selbst gelesen wird — sie
 * darf nicht von der Policy abhaengen, die sie traegt.
 */
create function app.aktuelle_kunden() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select coalesce(array_agg(distinct kz.kunde_id), '{}')
    from public.kunde_zugang kz
   where kz.benutzer_id = app.aktueller_benutzer()
     and kz.entzogen_am is null
$$;

comment on function app.aktuelle_kunden() is
  'Die kunde_ids der lebenden kunde_zugang-Zeilen dieser Anmeldung (K-18, K-04).';

grant execute on function app.aktuelle_kunden() to cse_app;

/**
 * Der Kunden-Zweig von `app.sichtbare_mandanten()` — jetzt echt.
 *
 * Er stand auf `'{}'` mit dem Vermerk, dass er entsteht, wenn es
 * `kunde_zugang` gibt. Die uebrigen drei Zweige bleiben Zeichen fuer Zeichen
 * wie in 0004: diese Funktion ist die Wurzel jeder Policy, und sie
 * umzuschreiben, um einen Zweig zu ergaenzen, ist die Gelegenheit, versehentlich
 * einen anderen zu aendern.
 */
create or replace function app.sichtbare_mandanten() returns uuid[]
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select case app.scope()
    when 'mandant' then case when app.aktiver_mandant() is null then '{}'::uuid[]
                             else array[app.aktiver_mandant()] end
    when 'gruppe'  then app.mandant_ids()
    when 'person'  then coalesce((select array_agg(distinct a.mandant_id) from public.anstellung a
                                   where a.person_id = app.aktuelle_person()
                                     and a.geloescht_am is null), '{}')
    when 'kunde'   then coalesce((select array_agg(distinct kz.mandant_id)
                                    from public.kunde_zugang kz
                                   where kz.benutzer_id = app.aktueller_benutzer()
                                     and kz.entzogen_am is null), '{}')
    else '{}'::uuid[]
  end
$$;

-- ---------------------------------------------------------------------------
-- RLS. FORCE ueberall; keine Anwendungsrolle traegt BYPASSRLS.
-- ---------------------------------------------------------------------------

alter table firma           enable row level security;
alter table firma           force  row level security;
alter table kunde           enable row level security;
alter table kunde           force  row level security;
alter table ansprechpartner enable row level security;
alter table ansprechpartner force  row level security;
alter table kunde_zugang    enable row level security;
alter table kunde_zugang    force  row level security;

/**
 * `firma` ist ueber die eigenen `kunde`-Zeilen sichtbar — und nur ueber sie.
 *
 * Kein `INSERT` fuer `cse_app` (siehe `app.firma_aufloesen`), und die
 * Identitaetsspalten sind auch beim `UPDATE` entzogen: `f_aendern` plus das
 * globale `UNIQUE (ust_id)` liesse eine Reinigungs-Benutzerin ihre USt-IdNr.
 * auf einen Wert korrigieren, den nur SSE Security fuehrt, und ein `23505`
 * verriete genau das. Eine Korrektur ist deshalb eine NEU-AUFLOESUNG.
 */
create policy f_lesen on firma for select to cse_app
  using (exists (select 1 from kunde k
                  where k.firma_id = firma.id
                    and (k.mandant_id = app.aktiver_mandant()
                         or (app.ist_gruppenansicht()
                             and k.mandant_id = any (app.rechte_mandanten('gruppe.crm.lesen'))))
                    and (select app.hat_recht('crm.lesen', k.mandant_id))));

create policy f_aendern on firma for update to cse_app
  using (exists (select 1 from kunde k
                  where k.firma_id = firma.id and k.mandant_id = app.aktiver_mandant()
                    and (select app.hat_recht('crm.schreiben', app.aktiver_mandant()))))
  with check (not app.ist_readonly());

create policy f_intern on firma as restrictive for all to cse_app
  using (app.portal() = 'intern');

-- kunde: der Standardsatz (K-03) plus die K-18-Kundenpolicy.
create policy t_mandant on kunde for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('crm.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('crm.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on kunde for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.crm.lesen')));

create policy t_kunde on kunde for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and id = any (app.aktuelle_kunden()));

-- Die K-04-Kundendecke: hoechstens die eigenen Zeilen. Restriktiv, also UND.
create policy p_kunde_decke on kunde as restrictive for all to cse_app
  using (app.portal() <> 'kunde' or id = any (app.aktuelle_kunden()));

create policy t_mandant on ansprechpartner for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('crm.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('crm.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on ansprechpartner for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.crm.lesen')));

create policy t_kunde on ansprechpartner for select to cse_app
  using (app.scope() = 'kunde'
         and mandant_id = any (app.sichtbare_mandanten())
         and kunde_id = any (app.aktuelle_kunden()));

create policy p_kunde_decke on ansprechpartner as restrictive for all to cse_app
  using (app.portal() <> 'kunde' or kunde_id = any (app.aktuelle_kunden()));

/**
 * `kunde_zugang` liest jeder ueber SEINE eigene Zeile — sonst koennte das
 * Kundenportal nicht feststellen, wofuer es zustaendig ist. Verwaltet wird sie
 * mit `system.benutzer_verwalten`, wie jede andere Zugangsvergabe.
 */
create policy t_eigener_zugang on kunde_zugang for select to cse_app
  using (benutzer_id = app.aktueller_benutzer()
         or (mandant_id = app.aktiver_mandant()
             and (select app.hat_recht('system.benutzer_lesen', app.aktiver_mandant()))));

create policy t_zugang_verwalten on kunde_zugang for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('system.benutzer_verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('system.benutzer_verwalten', app.aktiver_mandant())));

-- ---------------------------------------------------------------------------
-- K-05 — Spaltenrechte, wo die ZEILE geteilt wird und die SPALTE nicht.
-- ---------------------------------------------------------------------------

/**
 * K-05 verbietet Maskierungssichten fuer diesen Zweck und schreibt
 * Spalten-GRANTs vor: sie komponieren korrekt mit RLS, eine Sicht tut das
 * nicht. Was hier fehlt, ist nur ueber die schmalen Definer-Leser unten
 * erreichbar — und die schreiben ins `audit_log`.
 */
grant select, insert, update on firma, kunde, ansprechpartner, kunde_zugang to cse_app;

revoke insert on firma from cse_app;   -- nur ueber app.firma_aufloesen
revoke update on firma from cse_app;
grant  update (rechtsform, handelsregister_gericht, handelsregister_nummer,
               geaendert_am, geaendert_von)
       on firma to cse_app;

revoke select on kunde from cse_app;
grant  select (id, mandant_id, firma_id, kundennummer, typ, name, rechtsform, ust_id,
               steuernummer, ist_oeffentlicher_auftraggeber, xrechnung_pflicht, leitweg_id,
               elektronische_adresse, elektronische_adresse_schema, kaeufer_referenz,
               strasse, hausnummer, plz, ort, land,
               rechnungsadresse_abweichend, rechnung_name, rechnung_strasse, rechnung_hausnummer,
               rechnung_plz, rechnung_ort, rechnung_land, rechnung_email, email_zentral,
               telefon_zentral, webseite, rechtsgrundlage, rechtsgrundlage_quelle,
               rechtsgrundlage_erfasst_am, rechtsgrundlage_beleg_dokument_id, werbewiderspruch_am,
               widerspruch_am, status, notiz, anonymisiert_am, archiviert_am,
               erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on kunde to cse_app;   -- zahlungsziel_tage, debitorennummer, mahnsperre_* fehlen

revoke select on ansprechpartner from cse_app;
grant  select (id, mandant_id, kunde_id, anrede, titel, vorname, nachname, position, abteilung,
               email, telefon, mobil, sprache, ist_hauptkontakt, ausgeschieden_am,
               archiviert_am, anonymisiert_am, erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on ansprechpartner to cse_app;   -- der rechtsgrundlage-Block fehlt

-- ---------------------------------------------------------------------------
-- Das Tor: app.darf_kontaktiert_werden (§5.3).
-- ---------------------------------------------------------------------------

/**
 * Darf dieser Kontakt ueber diesen Kanal zu diesem Zweck angesprochen werden?
 *
 * **Eine Frage, eine Funktion, fail closed.** Jede Schicht fragt hierueber, es
 * gibt keine zweite Meinung. Drei Eigenschaften sind nicht kosmetisch:
 *
 *  1. **`coalesce(..., false)`.** Eine unbekannte id, ein fremder Bereich, ein
 *     Wettlauf — alles ergibt `false` und nicht NULL. `IF NOT f(...) THEN
 *     RAISE` feuert bei NULL NICHT, und ein `CHECK`, das zu NULL auswertet,
 *     besteht. Ein Praedikat, dessen Ausfall Geld kostet, darf nicht offen
 *     ausfallen.
 *  2. **`security definer` MIT ausgeschriebener Mandantenpruefung.** Als
 *     Definer erbt sie die RLS des Aufrufers nicht; ohne die Zeile
 *     `ap.mandant_id = app.aktiver_mandant()` koennte jemand aus der Reinigung
 *     eine Security-Kontakt-id durchprobieren und aus der Antwort lernen, dass
 *     es sie gibt — AUT-06 an neuer Stelle.
 *  3. **Der Kanaltest gilt nur fuer die ELEKTRONISCHEN Kanaele**, die §7 UWG
 *     nennt. Ein Vor-Ort-Termin bei einem Kunden, der per E-Mail eingewilligt
 *     hat, ist keine unerlaubte Werbung — ein pauschaler Kanaltest verbot ihn.
 */
create function app.darf_kontaktiert_werden(p_ansprechpartner uuid,
                                            p_kanal text,
                                            p_zweck text default 'werbung')
returns boolean
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select coalesce((
    select case
      when p_zweck = 'intern' then true
      -- Vertragliche Kommunikation haengt NIE an den Werberegeln (§5.1):
      -- eine Rechnung darf zugestellt werden, auch nach Werbewiderspruch.
      --
      -- `transaktional` steht hier ABSICHTLICH NICHT. Ob eine
      -- Terminbestaetigung oder eine Mahnung vertraglich notwendig ist oder
      -- als Werbung gilt, ist die offene Frage O-65 — und §5.1 nennt fuer den
      -- Zweifel den restriktiven Zweig. Die Folge ist gewollt und sichtbar:
      -- bis O-65 beantwortet ist, wird eine transaktionale Nachricht an einen
      -- Kontakt mit Werbewiderspruch abgelehnt, statt lautlos zu gehen.
      -- // TODO(client, O-65): Gilt `transaktional` (Terminbestaetigung,
      -- Leistungsnachweis, Mahnung) als vertraglich notwendig?
      when p_zweck = 'vertraglich' then
           ap.widerspruch_am is null and ap.archiviert_am is null
       and ap.anonymisiert_am is null
      else
           ap.rechtsgrundlage <> 'keine'
       and ap.widerspruch_am is null
       and ap.werbewiderspruch_am is null
       and ap.archiviert_am is null
       and ap.anonymisiert_am is null
       and (ap.rechtsgrundlage <> 'einwilligung'
            or p_kanal not in ('email','telefon','sms','post','whatsapp')
            or p_kanal = any (coalesce(ap.einwilligung_kanaele, array[]::text[])))
       and (ap.kunde_id is null
            or exists (select 1 from public.kunde k
                        where k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
                          and k.rechtsgrundlage <> 'keine'
                          and k.widerspruch_am is null
                          and k.werbewiderspruch_am is null
                          and k.status <> 'gesperrt'
                          and k.archiviert_am is null))
    end
      from public.ansprechpartner ap
     where ap.id = p_ansprechpartner
       and ap.mandant_id = app.aktiver_mandant()
  ), false);
$$;

comment on function app.darf_kontaktiert_werden(uuid, text, text) is
  'CRM-08 / §7 UWG. Fail closed: unbekannt, fremd oder unklar heisst false.';

grant execute on function app.darf_kontaktiert_werden(uuid, text, text) to cse_app;

/**
 * Ein Widerspruch gegen die VERARBEITUNG zwingt die Grundlage auf `keine` —
 * und laesst sie dort.
 *
 * Beide Widersprueche sind schreibbar-einmal: sie zurueckzunehmen ist keine
 * Datenpflege, sondern das Loeschen eines Beweises.
 */
create function kern.erzwinge_widerspruch() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.widerspruch_am is not null then
    new.rechtsgrundlage := 'keine';
    new.rechtsgrundlage_quelle := null;
    new.rechtsgrundlage_erfasst_am := null;
    /**
     * Die Kanaele muessen MIT fallen.
     *
     * `CHECK (rechtsgrundlage = 'einwilligung' OR einwilligung_kanaele IS NULL)`
     * haette den Widerspruch sonst abgewiesen: die Grundlage faellt auf
     * `keine`, die Kanaele blieben stehen, und die Zeile verletzt ihre eigene
     * Bedingung. Ausgerechnet die Eintragung, die IMMER gelingen muss — ein
     * Mensch widerspricht — waere an einer Zusicherung gescheitert, die seine
     * Einwilligung schuetzen sollte. Ein Isolationstest hat das gefunden.
     *
     * Fachlich ist es dieselbe Aussage: die Einwilligung ist fort, also sind
     * ihre Kanaele fort.
     */
    if to_jsonb(new) ? 'einwilligung_kanaele' then
      new.einwilligung_kanaele := null;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.widerspruch_am is not null and new.widerspruch_am is null then
      raise exception 'Ein Widerspruch nach Art. 21 DSGVO wird nicht zurueckgenommen (%.%)',
        tg_table_name, 'widerspruch_am' using errcode = 'restrict_violation';
    end if;
    if old.werbewiderspruch_am is not null and new.werbewiderspruch_am is null then
      raise exception 'Ein Werbewiderspruch wird nicht zurueckgenommen (%.%)',
        tg_table_name, 'werbewiderspruch_am' using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end $$;

create trigger trg_kunde_widerspruch before insert or update on kunde
  for each row execute function kern.erzwinge_widerspruch();
create trigger trg_ansprechpartner_widerspruch before insert or update on ansprechpartner
  for each row execute function kern.erzwinge_widerspruch();

create trigger trg_firma_geaendert before update on firma
  for each row execute function kern.setze_geaendert_am();
create trigger trg_kunde_geaendert before update on kunde
  for each row execute function kern.setze_geaendert_am();
create trigger trg_ansprechpartner_geaendert before update on ansprechpartner
  for each row execute function kern.setze_geaendert_am();
create trigger trg_kunde_zugang_geaendert before update on kunde_zugang
  for each row execute function kern.setze_geaendert_am();

-- Die Loeschsperren stehen NICHT hier von Hand. Sie kommen aus dem erzeugten
-- Block am Dateiende: `src/server/db/schema/rls.ts` ist das Register, und der
-- Isolationstest prueft BEIDE Richtungen — jede registrierte Tabelle traegt
-- die Ausloeser, und keine Tabelle traegt sie ohne Eintrag. Von Hand
-- geschrieben hiessen sie anders (`trg_firma_kein_loeschen` statt
-- `trg_firma_kein_hard_delete`) und der TRUNCATE-Schutz fehlte.

-- ---------------------------------------------------------------------------
-- Die schmalen Definer-Leser fuer die entzogenen Spalten (§1.5).
-- ---------------------------------------------------------------------------

/**
 * Der K-05-Leser fuer den `rechtsgrundlage`-Block.
 *
 * Er prueft das Recht UND den Bereich ausdruecklich — als Definer erbt er
 * beides nicht — und schreibt jeden Zugriff ins `audit_log`: wer die
 * Rechtsgrundlage eines Kontakts liest, tut das im Rahmen einer
 * LEG-08-Auskunft, und diese Auskunft ist selbst nachweispflichtig.
 *
 * Der Rolle `kunde` wird er nie erteilt: ein Kunde liest seine eigenen
 * Kontakte, aber nicht deren werberechtliche Einstufung.
 */
create function app.rechtsgrundlage_lesen(p_ansprechpartner uuid)
returns table (rechtsgrundlage rechtsgrundlage, quelle text, erfasst_am timestamptz,
               beleg_dokument_id uuid, einwilligung_kanaele text[],
               werbewiderspruch_am timestamptz, widerspruch_am timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if app.portal() = 'kunde' then
    raise exception 'Der Rechtsgrundlagen-Block ist im Kundenportal nicht lesbar (K-04)'
      using errcode = 'insufficient_privilege';
  end if;
  if not app.hat_recht('crm.lesen', app.aktiver_mandant()) then
    raise exception 'crm.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere('ansprechpartner.rechtsgrundlage_gelesen', 'ansprechpartner',
                            p_ansprechpartner::text, null, null, app.aktiver_mandant());

  return query
    select ap.rechtsgrundlage, ap.rechtsgrundlage_quelle, ap.rechtsgrundlage_erfasst_am,
           ap.rechtsgrundlage_beleg_dokument_id, ap.einwilligung_kanaele,
           ap.werbewiderspruch_am, ap.widerspruch_am
      from public.ansprechpartner ap
     where ap.id = p_ansprechpartner
       and ap.mandant_id = app.aktiver_mandant();
end $$;

grant execute on function app.rechtsgrundlage_lesen(uuid) to cse_app;

/** Der K-05-Leser fuer die Zahlungskonditionen (Recht `crm_entgelt.lesen`). */
create function app.zahlungskondition_lesen(p_kunde uuid)
returns table (debitorennummer text, zahlungsziel_tage smallint,
               mahnsperre_bis date, mahnsperre_grund text)
language plpgsql stable security definer set search_path = pg_catalog, public, app as $$
begin
  if not app.hat_recht('crm_entgelt.lesen', app.aktiver_mandant()) then
    raise exception 'crm_entgelt.lesen fehlt' using errcode = 'insufficient_privilege';
  end if;

  perform app.protokolliere('kunde.zahlungskondition_gelesen', 'kunde',
                            p_kunde::text, null, null, app.aktiver_mandant());

  return query
    select k.debitorennummer, k.zahlungsziel_tage, k.mahnsperre_bis, k.mahnsperre_grund
      from public.kunde k
     where k.id = p_kunde and k.mandant_id = app.aktiver_mandant();
end $$;

grant execute on function app.zahlungskondition_lesen(uuid) to cse_app;

/**
 * Identitaetsaufloesung — die EINZIGE Stelle, an der eine `firma` entsteht.
 *
 * Sie gibt NUR die id zurueck. Der Aufrufer erfaehrt nie, ob sie neu ist, und
 * nie ein Attribut einer fremden Gesellschaft. Ein Restsignal bleibt und ist
 * benannt: wer eine USt-IdNr. einreicht und eine bereits existierende id
 * bekommt, lernt, dass IRGENDWER in der Gruppe diese Firma kennt — nicht wer,
 * denn die Gesellschaft ist genau das, was `firma` nicht traegt.
 */
create function app.firma_aufloesen(p_ust_id text, p_name text, p_land char(2) default 'DE')
returns uuid
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare
  v_norm text := nullif(upper(regexp_replace(coalesce(p_ust_id, ''), '\s', '', 'g')), '');
  v_id   uuid;
begin
  if not app.hat_recht('crm.schreiben', app.aktiver_mandant()) then
    raise exception 'crm.schreiben fehlt' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Eine Firma ohne Namen ist keine Identitaet'
      using errcode = 'check_violation';
  end if;

  if v_norm is not null then
    select f.id into v_id from public.firma f where f.ust_id = v_norm;
    if v_id is not null then
      perform app.protokolliere('firma.aufgeloest', 'firma', v_id::text, null,
                                jsonb_build_object('treffer', 'ust_id'), app.aktiver_mandant());
      return v_id;
    end if;
  end if;

  insert into public.firma (name, ust_id, land, erstellt_von)
  values (trim(p_name), v_norm, coalesce(p_land, 'DE'), app.aktueller_benutzer())
  returning id into v_id;

  perform app.protokolliere('firma.aufgeloest', 'firma', v_id::text, null,
                            jsonb_build_object('treffer', 'neu'), app.aktiver_mandant());
  return v_id;
end $$;

grant execute on function app.firma_aufloesen(text, text, char) to cse_app;

/**
 * Die Dublettensuche — innerhalb derselben Grenze, und sie gibt nur id und
 * Aehnlichkeit heraus. Ein Name kaeme einer fremden Gesellschaft zu.
 */
create function app.firma_kandidaten(p_name text, p_land char(2) default 'DE')
returns table (firma_id uuid, aehnlichkeit real)
language sql stable security definer set search_path = pg_catalog, public, app as $$
  select f.id, similarity(f.name, p_name)
    from public.firma f
   where app.hat_recht('crm.lesen', app.aktiver_mandant())
     and f.land = coalesce(p_land, 'DE')
     and f.zusammengefuehrt_in_firma_id is null
     and similarity(f.name, p_name) > 0.4
   order by similarity(f.name, p_name) desc
   limit 10
$$;

grant execute on function app.firma_kandidaten(text, char) to cse_app;

-- ---------------------------------------------------------------------------
-- §5.4 — der Sendepfad ist die Aufzeichnung, und die Aufzeichnung ist gebunden.
-- ---------------------------------------------------------------------------

/**
 * Was nicht aufgezeichnet werden kann, kann nicht gesendet werden.
 *
 * Jeder ausgehende elektronische Kontakt schreibt in derselben Transaktion
 * eine `lead_aktivitaet`. Dieser Ausloeser wertet das Tor gegen den LEBENDEN
 * Kontakt neu aus — ein Wert, den ein Agent Minuten vorher gelesen hat, traegt
 * hier nicht mehr. Damit kann eine Genehmigung, die zwischenzeitlich durch
 * einen Widerspruch ueberholt wurde, nicht mehr ausgefuehrt werden.
 */
create function kern.uwg_sendetor() returns trigger
language plpgsql set search_path = pg_catalog, public, app as $$
begin
  if new.richtung <> 'ausgehend' then return new; end if;
  if new.kanal not in ('email','telefon','sms','post','whatsapp') then return new; end if;
  if new.ansprechpartner_id is null then
    raise exception 'Ein ausgehender Kontakt ohne Ansprechpartner ist nicht belegbar (§7 UWG)'
      using errcode = 'check_violation';
  end if;
  if not app.darf_kontaktiert_werden(new.ansprechpartner_id, new.kanal,
                                     coalesce(new.zweck::text, 'werbung')) then
    raise exception 'Kontakt nach § 7 UWG / Art. 21 DSGVO nicht zulaessig (Kanal %, Zweck %)',
      new.kanal, coalesce(new.zweck::text, 'werbung')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

comment on function kern.uwg_sendetor() is
  'BEFORE INSERT auf jeder Ausgangsspur: wertet app.darf_kontaktiert_werden gegen den LEBENDEN Kontakt neu aus (§5.4).';

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0020)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- firma (archiv): CRM-06. Die Firma ist die geteilte Identitaet hinter zwei oder drei Kundenbeziehungen. Sie zu loeschen macht die Historie der anderen Gesellschaften unlesbar — und die verlorene Zeile einer Verschmelzung bleibt fuer die referenzielle Historie stehen.
create trigger trg_firma_kein_hard_delete
  before delete on firma
  for each row execute function kern.verhindere_loeschung();
create trigger trg_firma_kein_truncate
  before truncate on firma
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on firma from cse_app, cse_anon, cse_checkin, cse_job;

-- kunde (archiv): LEG-01 und AO/HGB. An einem Kunden haengen Angebote, Auftraege und Rechnungen mit zehnjaehriger Aufbewahrung; Art. 17 DSGVO wird durch Anonymisierung erfuellt (anonymisiert_am), nicht durch Loeschen.
create trigger trg_kunde_kein_hard_delete
  before delete on kunde
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kunde_kein_truncate
  before truncate on kunde
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kunde from cse_app, cse_anon, cse_checkin, cse_job;

-- ansprechpartner (archiv): CRM-08. Auf dieser Zeile sitzt der Nachweis nach § 7 UWG: Grundlage, Beleg, Widerspruch. Sie zu loeschen loescht den Beweis, mit dem sich eine Abmahnung abwehren laesst — auch die Loeschung nach Art. 17 laeuft deshalb ueber anonymisiert_am.
create trigger trg_ansprechpartner_kein_hard_delete
  before delete on ansprechpartner
  for each row execute function kern.verhindere_loeschung();
create trigger trg_ansprechpartner_kein_truncate
  before truncate on ansprechpartner
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on ansprechpartner from cse_app, cse_anon, cse_checkin, cse_job;

-- kunde_zugang (archiv): AUT-08. Wer wann fuer welchen Kunden ins Portal durfte, ist eine Zugangsentscheidung. Ein entzogener Zugang wird auf entzogen_am gesetzt, nicht entfernt.
create trigger trg_kunde_zugang_kein_hard_delete
  before delete on kunde_zugang
  for each row execute function kern.verhindere_loeschung();
create trigger trg_kunde_zugang_kein_truncate
  before truncate on kunde_zugang
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on kunde_zugang from cse_app, cse_anon, cse_checkin, cse_job;



-- >>> Ende des generierten Blocks
