-- ===========================================================================
-- 0041 — einsatz_medien und das Elternregister
--        (04-PLANUNG-ZEIT.md §5.8, §5.8.1, §14.4, §15.4; TIM-10, DOC-03,
--         DOC-04, DOC-06, DOC-07, LEG-09, LEG-10, SEC-A6)
--
-- Fotos und Videos, die auf einer Schicht entstehen: Zustand, Schaden,
-- Fertigstellung. Sie liegen in einem PRIVATEN Bucket, sind ausschliesslich
-- ueber eine signierte Adresse erreichbar, und ihre Metadaten sind entfernt,
-- BEVOR das Objekt bestaetigt wird.
--
-- Vier Entscheidungen, an denen der naheliegende Entwurf still falsch waere:
--
--  1. **Der Elternteil wird ADRESSIERT, nicht per Fremdschluessel gebunden**
--     (§5.8.1, §15.4). Der naheliegende Entwurf — je Elternteil eine nullbare
--     Spalte plus `check (num_nonnulls(...) = 1)` — ist referenziell staerker
--     und trotzdem falsch: fuenf Domaenen haengen Medien an diese Tabelle,
--     und jede muesste sie per `ALTER` erweitern und eine Bedingung in einem
--     fremden Dokument mitpflegen. Was wirklich zaehlt, ist nicht der
--     Mechanismus, sondern die Zusage: DER ELTERNTEIL EXISTIERT UND LIEGT IM
--     SELBEN MANDANTEN. Die holt `me_bezug_pruefen` explizit zurueck.
--
--  2. **`kunde_id` wird ABGELEITET, nie eingereicht.** Die Kundendecke und die
--     K-18-Policy muessen auf einer SPALTE DIESER ZEILE aufsetzen, nicht auf
--     einer Unterabfrage ueber eine Tabelle, die eine Kundensitzung gar nicht
--     lesen darf — eine solche Unterabfrage liefert unter RLS null Zeilen, und
--     der Ausfall sieht aus wie eine leere Liste, nicht wie ein Fehler
--     (§16 Nr. 18). NULL ist dabei die geschlossene Richtung: unsichtbar.
--
--  3. **`exif_entfernt` traegt `check (exif_entfernt)`.** Die Zeile kann nicht
--     entstehen, wenn nicht bereinigt wurde. Ein Bereinigungsschritt, der nur
--     im Dienst steht, ist ein Schritt, den der naechste Aufrufer auslaesst —
--     und ein unbereinigtes Foto traegt eine GPS-Spur des arbeitenden
--     Menschen, die diese Plattform nicht ansammeln darf (TIM-10, LEG-10).
--
--  4. **Kein oeffentlicher Bucket, nirgends.** `pfad` besteht ausschliesslich
--     aus UUID-Segmenten, traegt also selbst kein personenbezogenes Datum, und
--     `bucket` ist auf den einen privaten Bucket festgelegt, den
--     07-INTEGRATIONEN §6.4 fuer Schichtmedien nennt.
--
-- **Die Tabelle heisst `einsatz_medien` und nicht `medien`** (D-140). §5.8
-- nennt sie `medien`, aber diesen Namen traegt seit 0014 die Bildablage der
-- Website (`abschnitt.medien_id`, `referenz.medien_id`, zwei laufende Dienste).
-- Zwei Dokumente haben denselben Namen fuer zwei Dinge vergeben; nur eines kann
-- ihn in `public` haben. Der Name hier ist deshalb der, den DIESE Domaene
-- ohnehin schon benutzt: `einsatz_medien` ist ihr Aufbewahrungsklassen-
-- schluessel (§13) und, mit Bindestrich, ihr Bucket (07-INTEGRATIONEN §6.4).
-- Umbenannt wird nichts Bestehendes — „Do not break what works" —, und die
-- fuenf Domaenen, die spaeter Medien anhaengen, adressieren dieselbe Tabelle
-- ueber ihr Register.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstyp (§3.1)
-- ---------------------------------------------------------------------------

-- TIM-10 nennt genau diese zwei.
create type medien_art as enum ('foto','video');

-- ---------------------------------------------------------------------------
-- 2. einsatz_medien_bezug — das Elternregister (§5.8.1)
-- ---------------------------------------------------------------------------

/**
 * Plattform-Referenzdaten, KEINE Mandantentabelle: die Zeile „an einen
 * `einsatz` darf ein Medium haengen" gilt fuer alle vier Gesellschaften
 * gleich. K-16s Mandantenregel gilt fuer sie so wenig wie fuer `feiertag`.
 *
 * `modul` ist der Modulname, unter dem das Recht am ELTERNTEIL haengt — er
 * steht hier, damit ein spaeterer Leseweg ihn nachschlagen kann, statt ihn je
 * Aufrufstelle noch einmal zu behaupten.
 *
 * `kunde_pfad` nennt die Spalte des Elternteils, die den Kunden traegt, oder
 * NULL, wenn er keinen hat. Sie ist der Grund, aus dem `me_bezug_pruefen` die
 * Kundenkennung ableiten kann, ohne dass diese Migration je Elternteil einen
 * Sonderzweig traegt.
 */
create table einsatz_medien_bezug (
  tabelle    text not null,
  modul      text not null,
  kunde_pfad text,

  primary key (tabelle),
  /**
   * Die geschlossene Liste aus §5.8.1. Sie steht als Bedingung und nicht bloss
   * als Konvention, weil `me_bezug_pruefen` den Namen in eine dynamische
   * Anweisung setzt: ein Registereintrag ist damit die einzige Quelle eines
   * Tabellennamens, und es gibt keine Einschleusungsflaeche.
   */
  constraint mb_bekannt check (tabelle in ('zeiteintrag','einsatz','wachbuch_eintrag',
                                           'bautagebuch','leistungsnachweis',
                                           'reklamation','qualitaetspruefung')),
  constraint mb_kunde_pfad_form check (kunde_pfad is null or kunde_pfad ~ '^[a-z_]+$')
);

comment on table einsatz_medien_bezug is
  'Register der Tabellen, an die ein Medium haengen darf (§5.8.1). '
  'Plattform-Referenzdaten ohne mandant_id; Zeilen kommen ausschliesslich per '
  'Migration.';

/**
 * Zwei Zeilen heute, und das ist kein halber Zustand.
 *
 * `wachbuch_eintrag` (PR 41), `bautagebuch` (PR 45), `leistungsnachweis`
 * (PR 40), `reklamation` und `qualitaetspruefung` (PR 40) gibt es noch nicht.
 * Sie hier vorzutragen hiesse, `me_bezug_pruefen` auf eine Tabelle zeigen zu
 * lassen, die es nicht gibt — der Fehler entstuende erst beim ersten Upload,
 * Monate spaeter, als `relation does not exist` mitten in einer Schicht.
 * §5.8.1 sagt es ausdruecklich: ein sechster Elternteil ist EINE Registerzeile
 * und EIN Test, in der Migration der aufnehmenden Domaene.
 */
insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad) values
  ('zeiteintrag', 'zeit',       null),
  ('einsatz',     'dienstplan', 'kunde_id');

alter table einsatz_medien_bezug enable row level security;
alter table einsatz_medien_bezug force  row level security;

/**
 * Lesen darf jede angemeldete Sitzung; SCHREIBEN kann niemand.
 *
 * Es gibt keine `INSERT`-, `UPDATE`- oder `DELETE`-Policy und kein
 * entsprechendes Recht fuer irgendeine Anwendungsrolle. Waere das Register von
 * aussen erweiterbar, koennte ein Aufrufer einen beliebigen Tabellennamen
 * eintragen und ihn damit in die dynamische Anweisung von `me_bezug_pruefen`
 * schieben — genau die Einschleusungsflaeche, die dieses Register schliesst.
 */
create policy t_lesen on einsatz_medien_bezug for select to cse_app using (true);
grant select on einsatz_medien_bezug to cse_app;
grant select on einsatz_medien_bezug to cse_definer;
grant select on einsatz_medien_bezug to cse_job;

-- ---------------------------------------------------------------------------
-- 3. einsatz_medien (§5.8)
-- ---------------------------------------------------------------------------

create table einsatz_medien (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  -- Der Elternteil, adressiert statt verkettet (§5.8.1). `bezug_tabelle` haelt
  -- einen Fremdschluessel ins Register, `bezug_id` prueft der Ausloeser.
  bezug_tabelle text not null,
  bezug_id      uuid not null,

  /**
   * Die erzeugte Bequemlichkeitskopie.
   *
   * Sie steht hier, damit der heisse Index und die K-04-Mitarbeiterdecke ohne
   * `CASE` auskommen. Eine Decke, die eine Fallunterscheidung enthaelt, ist
   * eine Decke, die beim naechsten Elternteil vergessen wird — und eine
   * vergessene Decke faellt niemandem auf, weil sie mehr Zeilen zeigt und
   * nicht weniger.
   */
  zeiteintrag_id uuid
    generated always as (case when bezug_tabelle = 'zeiteintrag' then bezug_id end) stored,

  /**
   * Vom Ausloeser aus dem Elternteil uebernommen, NIE eingereicht (§5.8).
   * NULL, wo der Elternteil keinen Kunden hat — und NULL ist in der
   * Kundensicht unsichtbar, also die geschlossene Richtung.
   */
  kunde_id      uuid,

  art           medien_art not null,

  /**
   * Der eine private Bucket fuer Schichtmedien (07-INTEGRATIONEN §6.4).
   * Als Bedingung und nicht bloss als Vorgabewert: ein Vorgabewert greift nur
   * bei WEGGELASSENER Spalte, und ein Aufrufer, der `'oeffentlich'` mitschickt,
   * legte ein Schichtfoto in einen frei lesbaren Bucket. Das ist kein
   * Konfigurationsfehler, das ist ein Datenschutzvorfall.
   */
  bucket        text not null default 'einsatz-medien',
  /**
   * Ausschliesslich UUID-Segmente. Der Pfad selbst traegt damit kein
   * personenbezogenes Datum — weder einen Namen noch ein Objekt noch ein
   * Datum —, und eine versehentlich weitergegebene Adresse verraet nichts
   * ueber ihren Inhalt.
   */
  pfad          text not null,

  /**
   * SERVERSEITIG aus den Magic Bytes bestimmt, nie aus `Content-Type` und nie
   * aus der Dateiendung (DOC-06). Beides kommt vom Geraet und ist eine
   * Behauptung.
   */
  mime_typ      text not null,
  -- nicht-geld: Bytes
  groesse_bytes bigint not null,
  sha256        text not null,

  breite        integer,
  hoehe         integer,
  dauer_sek     integer,

  /**
   * Die Zeile kann nicht entstehen, wenn nicht bereinigt wurde. Eine Flagge
   * mit Vorgabewert `true` und ohne Bedingung beschriebe eine Absicht; die
   * Bedingung beschreibt eine Tatsache (TIM-10, LEG-10).
   */
  exif_entfernt boolean not null default true,

  -- Die Behauptung des Geraets. Massgeblich ist `erstellt_am`, der
  -- Servereingang (Invariante 5, TIM-08).
  aufgenommen_am_geraet timestamptz,
  beschreibung  text,

  /**
   * Die Binaerdatei wurde entfernt (DSGVO-Loeschung, LEG-09), die Zeile bleibt
   * als Grabstein stehen: das Audit soll weiterhin zeigen, DASS eine Datei
   * existiert hat. Eine geloeschte Zeile behauptete, es habe nie eine gegeben.
   */
  storage_geloescht_am timestamptz,

  -- Die eine Lebendigkeitsspalte (§1.6). Keine zweite daneben.
  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),

  -- §1.13 / §13: Klasse `einsatz_medien`. `aufbewahrung_bis` schreibt
  -- `job:aufbewahrung`, nie ein Vorgabewert.
  -- // TODO(client, O-25): Wie lange werden Schichtfotos und -videos
  -- aufbewahrt, und auf welcher Rechtsgrundlage? DOC-07 verlangt eine Regel je
  -- Kategorie; SPEC nennt fuer diese keine.
  aufbewahrung_bis date,
  loeschsperre     boolean not null default false,

  /**
   * Auditblock (§1.6). `erstellt_von_person_id` beantwortet „welcher Mensch
   * hat dieses Foto gemacht" ohne Verbund — und ist zugleich das Subjekt der
   * `t_person`-Policy weiter unten.
   */
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  constraint medien_mandant_uk unique (mandant_id, id),

  constraint me_bezug_fk foreign key (bezug_tabelle) references einsatz_medien_bezug (tabelle),
  constraint me_kunde_fk foreign key (mandant_id, kunde_id)
    references kunde (mandant_id, id),

  constraint me_bucket check (bucket = 'einsatz-medien'),
  constraint me_pfad_uuid check (pfad ~ '^[0-9a-f-]{36}(/[0-9a-f-]{36})*$'),
  constraint me_mime check (mime_typ in ('image/jpeg','image/png','image/webp','image/heic',
                                         'video/mp4','video/quicktime')),
  /**
   * 100 MiB. Eine TECHNISCHE Obergrenze, gespiegelt aus der Konstanten des
   * Uploaddienstes — keine Geschaeftsregel und deshalb ohne Klientenfrage: sie
   * schuetzt Bucket und Leitung, nicht eine Abrechnung.
   *
   * Der Dienst weist dieselbe Zahl vorher ab, damit ein zu grosses Video gar
   * nicht erst hochgeladen wird; diese Bedingung ist die zweite Linie fuer den
   * Fall, dass jemand am Dienst vorbei schreibt.
   */
  constraint me_groesse check (groesse_bytes > 0 and groesse_bytes <= 104857600),
  constraint me_sha_form check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint me_dauer_nur_video check (art = 'video' or dauer_sek is null),
  constraint me_exif check (exif_entfernt),
  constraint me_archiv_paarweise check ((archiviert_am is null) = (archiviert_von is null)),
  constraint me_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

-- Die Anhaenge EINES Elternteils — der Zugriff, den jede Detailansicht macht.
create index me_bezug_idx on einsatz_medien (mandant_id, bezug_tabelle, bezug_id)
  where archiviert_am is null;
create index me_zeiteintrag_idx on einsatz_medien (mandant_id, zeiteintrag_id)
  where zeiteintrag_id is not null and archiviert_am is null;
/**
 * Ein Objekt liegt genau einmal. Der Index ist UNBEDINGT und nicht partiell:
 * ein archiviertes Medium belegt seinen Speicherplatz weiter, und ein zweites
 * Datenbankobjekt auf denselben Pfad zeigen zu lassen hiesse, dass eine
 * Loeschung des einen die Datei des anderen entfernt.
 */
create unique index me_pfad_uk on einsatz_medien (bucket, pfad);
-- Doppelerkennung beim erneuten Hochladen nach einer wackligen Verbindung.
create index me_sha_idx on einsatz_medien (mandant_id, sha256);
-- „Meine eigenen Aufnahmen" im Mitarbeiterportal.
create index me_person_idx on einsatz_medien (erstellt_von_person_id, erstellt_am);
create index me_aufbewahrung_idx on einsatz_medien (aufbewahrung_bis)
  where loeschsperre = false and aufbewahrung_bis is not null;

comment on table einsatz_medien is
  'Foto und Video von der Schicht (TIM-10). Privater Bucket, signierte Adresse '
  'mit 15 Minuten Gueltigkeit, Metadaten vor der Bestaetigung entfernt.';
comment on column einsatz_medien.pfad is
  'Nur UUID-Segmente — der Pfad selbst traegt kein personenbezogenes Datum.';
comment on column einsatz_medien.exif_entfernt is
  'check (exif_entfernt): die Zeile kann nicht entstehen, wenn nicht bereinigt '
  'wurde. Eine Flagge ohne Bedingung waere eine Absicht, keine Tatsache.';
comment on column einsatz_medien.aufgenommen_am_geraet is
  'Die Behauptung des Geraets. Massgeblich ist erstellt_am, der Servereingang '
  '(Invariante 5, TIM-08).';
comment on column einsatz_medien.storage_geloescht_am is
  'Die Binaerdatei ist weg (LEG-09), die Zeile bleibt als Grabstein — das Audit '
  'zeigt weiterhin, DASS eine Datei existiert hat.';

-- ---------------------------------------------------------------------------
-- 4. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * `me_bezug_pruefen` — der Elternteil existiert, und er liegt im selben
 * Mandanten (§5.8.1).
 *
 * Das ist genau die Zusage, die ein Fremdschluessel gegeben haette, auf
 * anderem Weg geholt. Ohne sie koennte eine Reinigungsaufnahme an einer
 * Security-Schicht haengen, und zwar widerspruchsfrei: die Zeile traegt ja
 * ihren eigenen `mandant_id`, und der stimmt mit der Sitzung ueberein. Erst
 * der Blick auf den Elternteil deckt es auf.
 *
 * **`security definer`, und zwar zwingend.** Der Ausloeser laeuft sonst unter
 * der Rolle, die geschrieben hat. Beim Upload ueber die Marke ist das
 * `cse_definer` (dort geht es gut), bei einem spaeteren Portalpfad `cse_app` —
 * und dessen K-03-Policy auf dem ELTERNTEIL kann enger sein als das Recht auf
 * `einsatz_medien`. Die Pruefung schluege dann fehl, obwohl der Elternteil existiert:
 * ein Foto, das sich nicht anhaengen laesst, ohne dass irgendwo steht, warum.
 *
 * Der Tabellenname kommt aus einer REGISTERZEILE, nie aus der Eingabe — das
 * Register traegt keine Schreibpolicy, also gibt es keinen Weg, einen Namen
 * dort hineinzubekommen (§5.8.1).
 */
create function kern.einsatz_medien_bezug_pruefen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  r        record;
  v_sql    text;
  v_kunde  uuid;
  v_treffer boolean;
begin
  select mb.tabelle, mb.kunde_pfad into r
    from public.einsatz_medien_bezug mb where mb.tabelle = new.bezug_tabelle;
  if not found then
    -- Kann der Fremdschluessel eigentlich nicht zulassen; steht hier, weil ein
    -- `format()` mit NULL eine Anweisung ohne Tabellennamen ergaebe.
    raise exception 'Unbekannte Bezugstabelle %', new.bezug_tabelle
      using errcode = 'foreign_key_violation';
  end if;

  /**
   * `%I` auf dem REGISTRIERTEN Namen und `quote_ident` auf der
   * Kundenspalte — beide stammen aus einer Zeile, die nur eine Migration
   * schreiben kann. Die Kennungen der Zeile selbst reisen als Parameter, nie
   * als Text.
   */
  v_sql := format(
    'select true, %s from public.%I where id = $1 and mandant_id = $2',
    case when r.kunde_pfad is null then 'null::uuid' else quote_ident(r.kunde_pfad) end,
    r.tabelle);

  execute v_sql into v_treffer, v_kunde using new.bezug_id, new.mandant_id;

  if v_treffer is not true then
    raise exception 'Zu diesem Medium gibt es keinen Elternteil in dieser Gesellschaft'
      using errcode = 'foreign_key_violation',
            detail  = format('%s %s im Mandanten %s nicht gefunden.',
                             new.bezug_tabelle, new.bezug_id, new.mandant_id),
            hint    = 'Der Elternteil muss existieren UND denselben mandant_id tragen (§5.8.1).';
  end if;

  -- ABGELEITET, nicht uebernommen: was der Aufrufer geschickt hat, wird
  -- verworfen. Sonst waere die Kundensichtbarkeit eine Eingabe.
  new.kunde_id := v_kunde;
  return new;
end $$;

create trigger trg_medien_1_bezug_pruefen
  before insert or update on einsatz_medien
  for each row execute function kern.einsatz_medien_bezug_pruefen();

/**
 * `me_loeschsperre` — solange der Elternteil unter Loeschsperre steht, wird
 * hier nichts archiviert (DOC-07).
 *
 * Archivieren ist zwar kein Loeschen; der Punkt ist ein anderer: eine
 * Aufnahme, die aus jeder Ansicht verschwindet, ist bei einer Pruefung
 * praktisch nicht mehr da. Die Sperre haengt am ELTERNTEIL, weil dort die
 * Rechtsgrundlage sitzt — bei einer abgerechneten Stunde etwa (FIN-07).
 */
create function kern.einsatz_medien_loeschsperre() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_gesperrt boolean;
begin
  if new.archiviert_am is null or old.archiviert_am is not null then
    return new;
  end if;
  if new.loeschsperre then
    raise exception 'Dieses Medium steht unter Aufbewahrungspflicht'
      using errcode = 'restrict_violation';
  end if;

  execute format('select coalesce(loeschsperre, false) from public.%I where id = $1',
                 new.bezug_tabelle)
    into v_gesperrt using new.bezug_id;

  if coalesce(v_gesperrt, false) then
    raise exception 'Der Vorgang zu diesem Medium steht unter Loeschsperre (DOC-07)'
      using errcode = 'restrict_violation',
            hint = 'Erst wenn die Sperre am Elternteil faellt, kann archiviert werden.';
  end if;
  return new;
end $$;

create trigger trg_medien_2_loeschsperre
  before update of archiviert_am on einsatz_medien
  for each row execute function kern.einsatz_medien_loeschsperre();

/**
 * Ereigniszeitpunkte gehoeren dem Server (Invariante 5). Eigene Funktion je
 * Tabelle, weil `kern.erzwinge_serverzeit()` auf einen festen Spaltennamen
 * geschrieben ist und ein Ausloeser keine Spaltennamen als Argument nimmt.
 *
 * `aufgenommen_am_geraet` bleibt ausdruecklich UNBERUEHRT: es ist die
 * Behauptung des Geraets und soll genau so stehen bleiben, wie sie ankam.
 */
create function kern.einsatz_medien_zeitstempel() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    if new.archiviert_am is not null then new.archiviert_am := now(); end if;
    if new.storage_geloescht_am is not null then new.storage_geloescht_am := now(); end if;
    return new;
  end if;
  if new.archiviert_am is not null and old.archiviert_am is null then
    new.archiviert_am := now();
  end if;
  if new.storage_geloescht_am is not null and old.storage_geloescht_am is null then
    new.storage_geloescht_am := now();
  end if;
  return new;
end $$;

create trigger trg_medien_3_zeitstempel
  before insert or update on einsatz_medien
  for each row execute function kern.einsatz_medien_zeitstempel();

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz — einsatz_medien (§5.8, K-03, K-04, K-18)
-- ---------------------------------------------------------------------------

alter table einsatz_medien enable row level security;
alter table einsatz_medien force  row level security;

create policy t_mandant on einsatz_medien for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('zeit.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('zeit.schreiben', app.aktiver_mandant())));

create policy t_gruppe on einsatz_medien for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.zeit.lesen')));

/**
 * Der Mensch sieht, was er selbst aufgenommen hat — und was an seinem eigenen
 * Zeiteintrag haengt (§5.8, EMP-13).
 *
 * NUR lesend, und dieser Policy laesst sich kein Schreibzweig anfuegen, ohne
 * dass es jemandem auffaellt: das Gegenstueck existiert nicht.
 */
create policy t_person on einsatz_medien for select to cse_app
  using (app.scope() = 'person'
         and mandant_id = any (app.sichtbare_mandanten())
         and (erstellt_von_person_id = app.aktuelle_person()
              or exists (select 1 from zeiteintrag z
                          where z.id = einsatz_medien.zeiteintrag_id
                            and z.person_id = app.aktuelle_person())));

/**
 * Der Kunde sieht die Dokumentation SEINES Objekts (TIM-10).
 *
 * Geschluessel auf `kunde_id` — eine SPALTE dieser Zeile, nie eine
 * Unterabfrage ueber `objekt` oder `einsatz`: unter RLS traefe die naemlich
 * null Zeilen, sobald jene Tabellen richtig geschlossen sind, und der Ausfall
 * saehe aus wie „keine Fotos vorhanden" (§16 Nr. 18). Und die ARRAY-Form
 * `app.aktuelle_kunden()`, nie der Skalar: der liefert im Kundenscope eine
 * Bindung von mehreren, willkuerlich (K-20).
 */
create policy t_kunde on einsatz_medien for select to cse_app
  using (app.scope() = 'kunde'
         and kunde_id is not null
         and kunde_id = any (app.aktuelle_kunden()));

-- Die K-04-Decken. Der Mensch nur seine eigenen, der Kunde nur seine eigenen.
create policy p_ma_decke on einsatz_medien as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter'
         or erstellt_von_person_id = app.aktuelle_person()
         or zeiteintrag_id in (select z.id from zeiteintrag z
                                where z.person_id = app.aktuelle_person()));
create policy p_kunde_decke on einsatz_medien as restrictive for all to cse_app
  using (app.portal() <> 'kunde'
         or (kunde_id is not null and kunde_id = any (app.aktuelle_kunden())));

/**
 * Die Definerpolicy (§1.1, woertlich).
 *
 * `erstellt_von_art` ist die SPALTE; `akteur_art` ist der Aufzaehlungstyp. Eine
 * Policy, die den Typ nennt, entsteht gar nicht erst — und die Migration
 * scheitert. Der Unterschied steht hier, weil er beim Abschreiben verschwindet.
 *
 * Die Bedingung sagt, WAS der Definerpfad schreiben darf: eine Aufnahme, hinter
 * der ein MENSCH steht, mit seiner `person_id`. Damit kann kein Nachtlauf und
 * kein Agent auf diesem Weg ein Medium erzeugen.
 */
create policy me_definer_insert on einsatz_medien as permissive for insert to cse_definer
  with check (erstellt_von_art = 'mensch' and erstellt_von_person_id is not null);

create policy me_definer_lesen on einsatz_medien for select to cse_definer using (true);

/**
 * `job:medien_waisen` liest naechtlich und meldet eine Zeile, deren Elternteil
 * verschwunden ist (§5.8.1) — die Pruefung, die an die Stelle des
 * Fremdschluessels tritt. `job:aufbewahrung` traegt Fristen ein.
 */
create policy t_job on einsatz_medien for select to cse_job using (true);
create policy t_job_frist on einsatz_medien for update to cse_job using (true) with check (true);

grant select, insert, update on einsatz_medien to cse_app;
grant select, insert, update on einsatz_medien to cse_definer;
grant select on einsatz_medien to cse_job;
grant update (aufbewahrung_bis, loeschsperre) on einsatz_medien to cse_job;

-- ---------------------------------------------------------------------------
-- 6. Nachzutragen in einer spaeteren Migration (§19)
-- ---------------------------------------------------------------------------

/**
 * Fuenf Elternteile fehlen noch, und ihre Registerzeile kommt mit ihnen:
 *
 *   -- mit `leistungsnachweis`, `reklamation`, `qualitaetspruefung` (PR 40):
 *   insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad) values
 *     ('leistungsnachweis','reinigung','kunde_id'),
 *     ('reklamation','reinigung','kunde_id'),
 *     ('qualitaetspruefung','qualitaet','kunde_id');
 *   -- mit `wachbuch_eintrag` (PR 41):
 *   insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad) values
 *     ('wachbuch_eintrag','wachbuch','kunde_id');
 *   -- mit `bautagebuch` (PR 45):
 *   insert into einsatz_medien_bezug (tabelle, modul, kunde_pfad) values
 *     ('bautagebuch','bau','kunde_id');
 *
 * Die Modulnamen sind aus dem geschlossenen Modulvokabular (K-19) zu
 * bestaetigen, wenn die Tabelle entsteht — nicht hier zu raten.
 */

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0041)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- einsatz_medien_bezug (append): TIM-10, DOC-06. Das Register entscheidet, an welche Tabelle ein Medium haengen darf, und sein Name geht in die dynamische Anweisung von `me_bezug_pruefen`. Eine geloeschte Zeile machte jedes daran haengende Foto unpruefbar — der Elternteil liesse sich nicht mehr aufloesen —, und eine loeschbare Referenztabelle waere zugleich eine schreibbare.
create trigger trg_einsatz_medien_bezug_kein_hard_delete
  before delete on einsatz_medien_bezug
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_medien_bezug_kein_truncate
  before truncate on einsatz_medien_bezug
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz_medien_bezug from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatz_medien (archiv): TIM-10, DOC-07, LEG-09. Das Foto ist der Zustandsbeweis einer Schicht — die Zeile, die eine Reklamation entscheidet oder ein Aufmass traegt. Geloescht bliebe eine Behauptung ohne Beleg; die DSGVO-Loeschung entfernt die BINAERDATEI (storage_geloescht_am) und laesst die Zeile als Grabstein stehen, damit das Audit weiterhin zeigt, dass es sie gab.
create trigger trg_einsatz_medien_kein_hard_delete
  before delete on einsatz_medien
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatz_medien_kein_truncate
  before truncate on einsatz_medien
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatz_medien from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_einsatz_medien_geaendert_am
  before update on einsatz_medien
  for each row execute function kern.setze_geaendert_am();

create trigger trg_einsatz_medien_audit
  after insert or update or delete on einsatz_medien
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
