-- ===========================================================================
-- 0200 — mandant_identitaet: das briefliche und visuelle Erscheinungsbild
--        einer Entitaet (01-KERN §6.2, TEN-07, TEN-10, PUB-03, PUB-09,
--        PUB-14, PRO-01, LEG-07, DESIGN §1/§6/§9/§11, D-10, K-12)
--
-- Vertrag: `docs/architecture/02-datenmodell/01-KERN.md` §6.2 — dort
-- vollstaendig spezifiziert und in keiner der 199 Migrationen davor angelegt.
-- Zwei Seiten haengen daran: `/einstellungen/identitaet` (TEN-07) und die
-- Fusszeilen auf `/einstellungen/vorlagen` (DESIGN §11).
--
-- **Ein TOKEN, kein Hex-Wert — und das ist keine Stilfrage.** Der Entwurf
-- hatte `identitaets_hue text CHECK (~ '^#[0-9A-Fa-f]{6}$')`. Eine freie
-- Hex-Spalte plus Farbwaehler im Verwaltungsbildschirm ist genau der
-- Mechanismus, ueber den ein fuenfter Bereich eine Farbe bekommt, die nicht
-- in `docs/DESIGN.md` steht und die Kontrastregeln von DESIGN §9 bricht.
-- Gespeichert wird der Token-NAME mit `CHECK`; den Wert liefert `globals.css`
-- aus DESIGN §1. Ein fuenfter Bereich braucht damit ZUERST einen
-- DESIGN.md-Eintrag, dann eine Migration, die den `CHECK` erweitert — und
-- genau diese Reihenfolge verlangt CLAUDE.md.
--
-- **Der Alt-Text ist ein CHECK und keine Bitte.** PUB-09 / LEG-07 (BFSG,
-- WCAG 2.1 AA) verlangen `alt` an jedem ausgelieferten Bild. Eine
-- oeffentlich sichtbare Identitaet ohne Alternativtext ist nicht „noch nicht
-- gepflegt", sondern ein Barrierefreiheitsmangel auf der Startseite — und
-- der faellt niemandem auf, der sehen kann.
--
-- **K-12.** `rechnung_fuss` wird bei der Festschreibung in den kanonischen
-- Rechnungs-Payload KOPIERT, nie referenziert. Das Kopieren ist heute NICHT
-- gebaut (`services/finanz/kanonisch.ts` kennt kein Mandanten-Fussfeld;
-- `rechnung.fusstext` ist die freie Spalte aus der Eingabe). Diese Migration
-- legt den Speicherort an und sagt an der Spalte, was noch fehlt — sie
-- behauptet nicht, dass die Kopie schon geschieht.
--
-- **Kein `DELETE`, kein `INSERT` durch Benutzer** (§6.2): die Zeile entsteht
-- mit dem Mandanten (Trigger) und endet nie.
-- ===========================================================================

create table mandant_identitaet (
  id          uuid not null default gen_random_uuid(),
  mandant_id  uuid not null references mandant(id),

  /**
   * Zeile 2 im Switcher (DESIGN §6): `Reinigung`, `Sicherheit`, `Bau`,
   * `Digital & KI`. Der Trigger setzt beim Anlegen `mandant.name` ein — ein
   * vorhandener Wert, keine erfundene Kurzform; die Pflege ist eine
   * Eintragung, kein Ratespiel.
   */
  kurzname    text not null,

  /**
   * **Token-Name, kein Hex** (siehe Kopf). Die vier Werte sind die vier
   * Bereichsfarben aus DESIGN §1.
   */
  identitaets_token text not null,

  /** Speicherschluessel, SVG (O-12). */
  logo_hell_pfad   text,
  logo_dunkel_pfad text,
  logo_druck_pfad  text,
  /** EIN Alternativtext fuer alle Logovarianten (PUB-09, LEG-07, DESIGN §9). */
  logo_alt         text,

  /** 32px-Rundavatar im Switcher und in der Marken-Avatarreihe (DESIGN §6, PUB-14). */
  avatar_pfad text,
  avatar_alt  text,
  /** Titelbild der Profilseite (PRO-01). */
  cover_pfad  text,
  cover_alt   text,

  /** Ein Satz unter dem Logo (PRO-01). */
  claim text,
  /**
   * Kartentext auf der Startseite (PUB-03) und Profiltext (PRO-01).
   *
   * **Achtung, zweiter Ort fuer dieselbe Tatsache.** `unternehmensprofil`
   * (0155 ff.) fuehrt `kurzbeschreibung` und `beschreibung` JE SPRACHE, und
   * D-82 verlangt genau das fuer den oeffentlichen Auftritt. Diese beiden
   * Spalten stehen hier, weil §6.2 sie fuehrt; maßgeblich fuer die
   * oeffentliche Seite ist `unternehmensprofil`, und der Bildschirm
   * `/einstellungen/identitaet` pflegt sie deshalb NICHT — er verweist auf
   * die Website-Pflege. Zwei Editoren auf einem Text waeren ein Defekt.
   */
  kurzbeschreibung text,
  beschreibung     text,

  /** Rechtliche Fusszeilen (DESIGN §11). */
  brief_fuss    text,
  /**
   * K-12: gehoert bei der Festschreibung in den kanonischen Payload KOPIERT.
   * Das Kopieren fehlt noch (siehe Kopf) — eine spaetere Aenderung wirkt
   * deshalb heute auf keine festgeschriebene Rechnung, weil sie dort
   * ueberhaupt nicht ankommt.
   */
  rechnung_fuss text,
  angebot_fuss  text,

  email_absender text,
  email_signatur text,

  /**
   * // TODO(client, O-08): Bekommt jeder Bereich eine eigene Domain, oder laufen alle unter Pfaden einer Gruppendomain?
   */
  domain text,

  /**
   * Steuert die Lesbarkeit auf dem PRINZIPALLOSEN Renderpfad (§6.1) — nicht
   * fuer `cse_anon`, das nirgends einen Grant haelt (K-01). PUB-03, PRO-01.
   */
  oeffentlich_sichtbar boolean not null default false,
  /**
   * D-10 / O-13: die Bilder sind Platzhalter, bis echte Fotografie vorliegt.
   * Die Oberflaeche markiert sie sichtbar; es ist ein Launch-Blocker, kein
   * Schoenheitsfehler.
   * // TODO(client, O-13): Wann liegt echte Fotografie der vier Bereiche vor (Launch-Blocker, D-10)?
   */
  platzhalter_medien boolean not null default true,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  constraint mandant_identitaet_pk primary key (id),
  constraint mandant_identitaet_mandant_key unique (mandant_id),
  constraint mi_kurzname_nicht_leer check (btrim(kurzname) <> ''),
  /**
   * Die vier Tokens aus DESIGN §1. Ein fuenfter Bereich erweitert diesen
   * `CHECK` in einer eigenen Migration — nach dem DESIGN.md-Eintrag.
   */
  constraint mi_token check (identitaets_token in
    ('area-reinigung', 'area-security', 'area-bau', 'area-operations')),
  /**
   * PUB-09 / LEG-07 / DESIGN §9: eine oeffentlich sichtbare Identitaet hat
   * fuer JEDES ausgelieferte Bild einen Alternativtext. Nicht ausgelieferte
   * Bilder (Pfad NULL) brauchen keinen.
   */
  constraint mi_alt_text check (
    not oeffentlich_sichtbar
    or ((cover_pfad  is null or btrim(coalesce(cover_alt, ''))  <> '')
    and (avatar_pfad is null or btrim(coalesce(avatar_alt, '')) <> '')
    and (logo_hell_pfad is null or btrim(coalesce(logo_alt, '')) <> '')))
);

/** §6.2: der Lesepfad der oeffentlichen Seite. */
create index mandant_identitaet_oeffentlich_idx
  on mandant_identitaet (mandant_id) where oeffentlich_sichtbar;

comment on table mandant_identitaet is
  '§6.2: das visuelle und briefliche Erscheinungsbild einer Entitaet. 1:1 zu '
  'mandant, angelegt vom Trigger kern.mandant_identitaet_anlegen, nie geloescht.';
comment on column mandant_identitaet.identitaets_token is
  'Token-NAME aus DESIGN §1, kein Hex-Wert. Den Farbwert liefert globals.css; '
  'ein fuenfter Bereich braucht zuerst einen DESIGN.md-Eintrag (CLAUDE.md).';
comment on column mandant_identitaet.rechnung_fuss is
  'K-12: bei der Festschreibung in den kanonischen Payload zu KOPIEREN. Die '
  'Kopie ist noch nicht gebaut — kanonisch.ts kennt kein Mandanten-Fussfeld.';
comment on column mandant_identitaet.kurzbeschreibung is
  'Zweiter Ort fuer unternehmensprofil.kurzbeschreibung (je Sprache, D-82). '
  'Maßgeblich fuer die oeffentliche Seite ist unternehmensprofil.';

-- ---------------------------------------------------------------------------
-- 2. RLS (§6.2, K-03)
-- ---------------------------------------------------------------------------

alter table mandant_identitaet enable row level security;
alter table mandant_identitaet force  row level security;

/**
 * Lesen: jede Gesellschaft, die diese Sitzung sieht. Kein Fachrecht davor —
 * die Identitaet ist das, was in JEDER Kopfzeile und in jedem Switcher
 * steht; ein Fachrecht hier machte die Marke unsichtbar, nicht sicherer.
 */
create policy t_mi_lesen on mandant_identitaet for select to cse_app
  using (mandant_id = any (app.sichtbare_mandanten()));

/**
 * **Der prinzipallose Renderpfad** (§6.1/§6.2, K-01).
 *
 * Die oeffentliche Seite laeuft serverseitig in einer gewoehnlichen
 * `withTenant`-Transaktion OHNE Prinzipal: `app.mandant_id` aus dem
 * validierten Slug, `app.benutzer_id` ungesetzt, `app.readonly = 'on'`,
 * Rolle `cse_app`. Eine angemeldete Sitzung erfuellt den ersten Konjunkt
 * nie und liest weiterhin ausschliesslich ueber `sichtbare_mandanten()`.
 *
 * Ohne diese Policy koennte die Profilseite die Identitaet nicht lesen, die
 * sie rendern soll — und `m_oeffentlich` auf `mandant` (§6.1) prueft
 * `exists (select 1 from mandant_identitaet …)`, also haette auch der
 * Mandant selbst sich nicht oeffentlich gezeigt.
 */
create policy mi_oeffentlich on mandant_identitaet for select to cse_app
  using (oeffentlich_sichtbar
         and app.aktueller_benutzer() is null
         and mandant_id = app.aktiver_mandant());

/**
 * Schreiben: `system.identitaet_verwalten` im AKTIVEN Bereich, und nie in
 * der Gruppenansicht (Invariante 10, `app.ist_readonly`).
 */
create policy t_mi_schreiben on mandant_identitaet for update to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('system.identitaet_verwalten', app.aktiver_mandant())))
  with check (mandant_id = app.assert_genau_ein_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('system.identitaet_verwalten', app.aktiver_mandant())));

/** Der Anlagetrigger und die Definer-Leser (K-01, §3.5). */
create policy d_mi_lesen on mandant_identitaet for select to cse_definer using (true);
create policy d_mi_schreiben on mandant_identitaet for insert to cse_definer with check (true);

/**
 * KEIN `INSERT` fuer `cse_app` (§6.2): die Zeile entsteht mit dem Mandanten.
 * Ohne diesen Entzug koennte eine zweite Identitaet fuer einen fremden
 * Bereich angelegt werden, und `mandant_identitaet_mandant_key` faellt erst
 * danach auf.
 */
grant select on mandant_identitaet to cse_app;
/**
 * **Der UPDATE-Grant fuehrt genau die Spalten, die auch gepflegt werden.**
 *
 * Er stand einmal weiter: `identitaets_token`, `domain`, `kurzbeschreibung`,
 * `beschreibung` und `platzhalter_medien` waren darin — also genau die fuenf
 * Felder, zu denen `services/mandant/identitaet.ts` schreibt „niemand kann
 * ihn setzen" (das Farbtoken kommt aus DESIGN §1), „O-08 ist offen" (Domain),
 * „maßgeblich ist unternehmensprofil je Sprache, D-82" (die beiden
 * Profiltexte) und „keine Einstellung" (die Platzhaltermarke). Heute schreibt
 * sie kein Pfad — der Grant liesse den NAECHSTEN Pfad sie schreiben, ohne
 * dass jemand die Entscheidung noch einmal liest. Ein Recht, das niemand
 * braucht, ist kein Vorrat, sondern eine offene Tuer.
 *
 * Die uebrigen kommen mit dem Pfad, der sie braucht: der Bildupload
 * (O-12/O-13) bringt die Pfadspalten und `platzhalter_medien` mit, die
 * Domainentscheidung (O-08) bringt `domain` mit.
 */
grant update (kurzname,
              logo_alt, avatar_alt, cover_alt,
              claim,
              brief_fuss, rechnung_fuss, angebot_fuss,
              email_absender, email_signatur,
              oeffentlich_sichtbar,
              geaendert_am, geaendert_von)
      on mandant_identitaet to cse_app;
grant select, insert, update on mandant_identitaet to cse_definer;

-- ---------------------------------------------------------------------------
-- 3. Die Projektions-View des oeffentlichen Pfads (§6.2)
-- ---------------------------------------------------------------------------

/**
 * Eine reine PROJEKTIONS-View, keine Maskierungs-View (K-05 verbietet die
 * zweite, nicht die erste): `email_absender`, `email_signatur` und `domain`
 * stehen nicht darin. `security_invoker = true`, damit die Policies des
 * Aufrufers gelten — eine View mit den Rechten ihres Eigentuemers waere ein
 * zweiter Lesepfad an der RLS vorbei.
 *
 * **Und jetzt die Grenze, die sie IST — und die, die sie NICHT ist.** Die
 * ZEILENgrenze haelt die Policy `mi_oeffentlich`: der prinzipallose Pfad
 * sieht ausschliesslich Zeilen mit `oeffentlich_sichtbar` im aktiven Bereich.
 * Die SPALTENgrenze ist diese View und sonst nichts: `grant select on
 * mandant_identitaet to cse_app` gilt fuer alle Spalten, weil der interne
 * Editor (`/einstellungen/identitaet`) Absender und Signatur zum Pflegen
 * lesen muss, und ein Spaltenrecht nicht nach Prinzipal unterscheiden kann.
 * Wer einen NEUEN prinzipallosen Lesepfad baut, nimmt deshalb diese View und
 * nicht die Tabelle — sonst traegt er die drei Felder mit, ohne dass etwas
 * ihn aufhaelt. Das ist eine Konvention mit einer sichtbaren Stelle, keine
 * Schranke, und es steht hier, damit niemand die View fuer mehr haelt, als
 * sie leistet.
 */
create view mandant_identitaet_oeffentlich
  with (security_invoker = true) as
  select mi.mandant_id, mi.kurzname, mi.identitaets_token,
         mi.logo_hell_pfad, mi.logo_dunkel_pfad, mi.logo_druck_pfad, mi.logo_alt,
         mi.avatar_pfad, mi.avatar_alt, mi.cover_pfad, mi.cover_alt,
         mi.claim, mi.kurzbeschreibung, mi.beschreibung,
         mi.brief_fuss, mi.rechnung_fuss, mi.angebot_fuss,
         mi.oeffentlich_sichtbar, mi.platzhalter_medien
    from mandant_identitaet mi;

grant select on mandant_identitaet_oeffentlich to cse_app;

comment on view mandant_identitaet_oeffentlich is
  '§6.2: die Spaltenauswahl des oeffentlichen Pfads. Ohne email_absender, '
  'email_signatur und domain. security_invoker: die Policies des Aufrufers gelten.';

-- ---------------------------------------------------------------------------
-- 4. kern.mandant_identitaet_anlegen — TEN-07 laeuft nie ohne Wert
-- ---------------------------------------------------------------------------

/**
 * Die 1:1-Zeile entsteht MIT dem Mandanten (§6.1 „Triggers").
 *
 * **Warum das ein Trigger ist und keine Zeile im Anlagedienst.** TEN-07 ist
 * die 3px-Leiste in der Bereichsfarbe; sie laeuft auf JEDER Portalseite. Ein
 * Mandant ohne Identitaetszeile faellt damit nicht beim Anlegen auf, sondern
 * beim ersten Seitenaufruf danach — und dort als fehlender Wert in einer
 * Kopfzeile, nicht als benannter Fehler.
 *
 * **Ein unbekannter Slug ist ein Abbruch mit Anleitung, keine geratene
 * Farbe.** `identitaets_token` traegt den `CHECK` aus DESIGN §1. Ein fuenfter
 * Bereich braucht zuerst einen DESIGN.md-Eintrag und dann eine Migration,
 * die den `CHECK` erweitert (§6.2, CLAUDE.md). Hier eine Ersatzfarbe
 * einzusetzen — etwa `area-operations` — waere genau der erfundene
 * Gestaltungswert, den dieselbe Regel verbietet: der neue Bereich saehe aus
 * wie „Digital & KI", und niemand suchte den Grund in einem Trigger.
 */
create function kern.mandant_identitaet_anlegen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, app as $$
declare v_token text := 'area-' || new.slug;
begin
  if v_token not in ('area-reinigung', 'area-security', 'area-bau', 'area-operations') then
    raise exception
      'Fuer den Bereich % gibt es kein Identitaetstoken in DESIGN §1. Zuerst '
      'einen Eintrag in docs/DESIGN.md, dann eine Migration, die mi_token '
      'erweitert (01-KERN §6.2, CLAUDE.md).', new.slug
      using errcode = '23514';
  end if;

  insert into public.mandant_identitaet (mandant_id, kurzname, identitaets_token)
  values (new.id, new.name, v_token);
  return null;
end $$;

alter function kern.mandant_identitaet_anlegen() owner to cse_definer;

create trigger trg_mandant_identitaet_anlegen
  after insert on mandant
  for each row execute function kern.mandant_identitaet_anlegen();

comment on function kern.mandant_identitaet_anlegen() is
  '§6.1/§6.2: legt die 1:1-Identitaetszeile mit Platzhalterwerten an, damit '
  'TEN-07 nie ohne Wert laeuft. Unbekannter Slug: Abbruch mit Anleitung.';

-- ---------------------------------------------------------------------------
-- 5. Die vorhandenen Bereiche nachtragen
-- ---------------------------------------------------------------------------

/**
 * Der Trigger greift nur beim Anlegen; die Bereiche stehen schon. Ohne diese
 * Zeilen waere die 1:1-Zusage fuer genau den Bestand gebrochen, auf dem
 * gearbeitet wird.
 *
 * Ein Bereich mit einem Slug ausserhalb der vier bekommt KEINE Zeile — und
 * das ist dieselbe Entscheidung wie im Trigger, nur ohne Abbruch: eine
 * laufende Migration soll an einem Datenbestand nicht scheitern, den sie
 * nicht angelegt hat. Der Bildschirm sagt dann „nicht hinterlegt", und
 * `/einstellungen/identitaet` nennt den Grund.
 */
insert into mandant_identitaet (mandant_id, kurzname, identitaets_token)
select m.id, m.name, 'area-' || m.slug
  from mandant m
 where 'area-' || m.slug in
       ('area-reinigung', 'area-security', 'area-bau', 'area-operations')
   and not exists (select 1 from mandant_identitaet mi where mi.mandant_id = m.id);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0200)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- mandant_identitaet (append): §6.2, TEN-07, LEG-01. Die 1:1-Zeile traegt die rechtlichen Fusszeilen, die auf jedem Angebot und jeder Rechnung dieser Entitaet stehen, und den Alternativtext jedes ausgelieferten Bildes (PUB-09, LEG-07). Sie entsteht mit dem Mandanten und endet nie: es gibt keinen Zustand „diese Gesellschaft hat kein Erscheinungsbild", nur Felder ohne Wert. Eine geloeschte Zeile machte TEN-07 wertlos und die Herkunft einer alten Fusszeile unbelegbar.
create trigger trg_mandant_identitaet_kein_hard_delete
  before delete on mandant_identitaet
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mandant_identitaet_kein_truncate
  before truncate on mandant_identitaet
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mandant_identitaet from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_mandant_identitaet_geaendert_am
  before update on mandant_identitaet
  for each row execute function kern.setze_geaendert_am();

create trigger trg_mandant_identitaet_audit
  after insert or update or delete on mandant_identitaet
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
