-- ===========================================================================
-- 0031 — Bewacherregister, Einsatzanforderung und die §34a-Hartsperre
--        (SEC-01, SEC-02, SEC-03, SEC-04, SEC-08, LEG-04, D-09)
--
-- Vertrag: `01-KERN.md` §6.18 (bewacher_eintrag), `03-GEWERKE.md` §6.6
-- (einsatzanforderung) und §9 (das dreischichtige Tor). Wo dieser Text und eine
-- Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- **§34a GewO verlangt ZWEI Tatsachen, nicht eine.** Der Entwurf prueft nur den
-- Sachkundenachweis — und ein Mensch kann eine gueltige Sachkundepruefung in der
-- Hand halten und trotzdem nicht eingesetzt werden duerfen: eine negative
-- Zuverlaessigkeitsueberpruefung, eine widerrufene Registrierung. Wer nur
-- `nachweis` prueft, teilt einen Wachmann ein, dessen Eintragung geloescht ist.
-- Deshalb steht `bewacher_eintrag` hier neben dem Tor und nicht in einer
-- spaeteren Migration.
--
-- **Und die Registerpflicht ist eine SPALTE, kein Textvergleich.** Der Entwurf
-- entschied sie mit `qualifikation.rechtsgrundlage ilike '%34a%'` — Freitext,
-- den jemand eintippt. „§ 34 a GewO", „Sachkundepruefung nach GewO" oder ein
-- Leerzeichen am Ende schalten die Registerpruefung lautlos AB, auf der einen
-- Kontrolle, die es gegen einen gesperrten Wachmann gibt. Das Feld bleibt zur
-- Anzeige; entschieden wird an `einsatzanforderung.bewacherregister_pflicht`.
--
-- **Kein Bewacherregister-API.** Es gibt keine Schnittstelle, gegen die sich der
-- Status abfragen liesse. Der Status wird von Hand aus dem Registerauszug
-- erfasst; `bewacher_eintrag.quelle` sagt das an jeder Zeile, damit keine
-- Oberflaeche und keine Auswertung ihn spaeter fuer synchronisiert haelt
-- (CLAUDE.md „No fake integrations").
--
-- NICHT in dieser Migration: `posten`, `veranstaltung`, `wachbuch_eintrag`
-- (PR 41) und `bewacher_meldung` / `bewachertaetigkeit` (§6.19/§6.20 — sie
-- gehoeren zur Meldung an das Register, nicht zur Einsatzsperre).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (01-KERN §4, 03-GEWERKE §3.2)
-- ---------------------------------------------------------------------------

/**
 * PLATZHALTER-Vokabular. SEC-03 sagt „Registrierungsstatus" und nennt keine
 * Werte; diese sechs sind, was ein Registerauszug plausibel enthaelt.
 *
 * Bis zur Antwort gilt im Tor NUR `registriert` als einsetzbar, und jeder
 * andere Wert wird als UNGEPRUEFT behandelt statt als bestanden — die
 * vorsichtige Richtung, und dieselbe, die 03-GEWERKE §6.6 fuer die fehlende
 * mandantenweite Grundanforderung gewaehlt hat.
 * // TODO(client, O-40): Wie lautet das genaue Statusvokabular des
 * Bewacherregisters, so wie es im Registerauszug erscheint?
 */
create type bewacher_status as enum
  ('beantragt','registriert','abgelehnt','erloschen','gesperrt','unbekannt');

/** Der Geltungsbereich einer Anforderung — genau einer je Zeile (§6.6). */
create type einsatzanforderung_bereich as enum
  ('posten','veranstaltung','objekt','mandant');

/**
 * `jeder` — jede eingesetzte Person muss die Qualifikation halten.
 * `mindestens_einer` — die SCHICHT als Ganzes braucht `mindestanzahl` davon
 * („3 Wachen, davon 1 mit Sachkunde §34a", SEC-01).
 */
create type qualifikation_geltung as enum ('jeder','mindestens_einer');

-- ---------------------------------------------------------------------------
-- 2. bewacher_eintrag — die Registeridentitaet eines Menschen (§6.18)
-- ---------------------------------------------------------------------------

create table bewacher_eintrag (
  id            uuid primary key default gen_random_uuid(),
  /**
   * **`person_id`, nie `anstellung_id`.** Die Bewacher-ID folgt dem MENSCHEN,
   * nicht dem Job (D-09). Sie wird vom Register einmal je Mensch vergeben; eine
   * Kopie je Arbeitgeber waere zwei Wahrheiten ueber eine behoerdliche
   * Eintragung.
   */
  person_id     uuid not null references person(id),
  /**
   * // TODO(client, O-40): Exaktes Format und Pruefziffer der Bewacher-ID aus
   * dem Registerauszug. Bis dahin wird KEINE Formatpruefung erfunden — eine
   * geratene Maske weist gueltige IDs ab, und das faellt erst auf, wenn ein
   * Wachmann nicht eingeplant werden kann.
   */
  bewacher_id   text not null
                  check (length(btrim(bewacher_id)) between 1 and 32),
  status        bewacher_status not null default 'unbekannt',
  registriert_seit date,
  gueltig_bis   date,
  -- Zuverlaessigkeitsueberpruefung und Wiedervorlage.
  letzte_pruefung_am date,
  naechste_pruefung_am date,
  registerauszug_dokument_id uuid references dokument(id),
  bemerkung     text,
  /**
   * WOHER der Status stammt. Heute gibt es genau eine Quelle, und die Spalte
   * sagt es ausdruecklich: es existiert keine Registerschnittstelle, gegen die
   * sich das abfragen liesse. Ohne diese Spalte laese jede spaetere Oberflaeche
   * einen handerfassten Status als synchronisierten — und meldete „geprueft",
   * wo niemand geprueft hat.
   */
  quelle        text not null default 'manuell'
                  check (quelle in ('manuell')),
  -- Kein Hard Delete: vergangene Einsaetze standen unter dieser Eintragung.
  erloschen_am  timestamptz,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  constraint bewacher_zeitraum
    check (gueltig_bis is null or registriert_seit is null
           or gueltig_bis >= registriert_seit),
  /**
   * UNBEDINGT eindeutig, auch ueber erloschene Zeilen hinweg: die ID wird vom
   * Register einmal je Mensch vergeben und darf in der Plattform unter keinem
   * Lebenszyklus zweimal auftauchen (§6.18).
   */
  constraint bewacher_eintrag_id_key unique (bewacher_id)
);

/**
 * Eine LEBENDE Zeile je Mensch — teilweise, weil das Erloeschen weich ist.
 *
 * Unbedingt waere es falsch: `gemeldet_von_mandant_id` ist aus dem Entwurf
 * ausdruecklich entfernt worden, weil eine unbedingte Eindeutigkeit den
 * ARBEITGEBERWECHSEL nicht abbilden konnte — das zentrale Ereignis des
 * Registers. Die arbeitgeberspezifischen Tatsachen stehen in `bewacher_meldung`
 * (§6.19, spaetere Migration), die Registeridentitaet hier.
 */
create unique index bewacher_eintrag_person_key on bewacher_eintrag (person_id)
  where erloschen_am is null;
create index bewacher_pruefung_idx on bewacher_eintrag (naechste_pruefung_am)
  where erloschen_am is null;

comment on table bewacher_eintrag is
  'Die Eintragung eines MENSCHEN im Bewacherregister (§6.18, SEC-03). Status '
  'handerfasst — es gibt keine Registerschnittstelle; quelle sagt das je Zeile.';

comment on column bewacher_eintrag.quelle is
  'Immer `manuell`: kein Bewacherregister-API. Die Oberflaeche zeigt den Eintrag '
  'als „nicht verbunden" (CLAUDE.md, No fake integrations).';

-- ---------------------------------------------------------------------------
-- 3. einsatzanforderung — welche Qualifikation eine Zuweisung verlangt (§6.6)
-- ---------------------------------------------------------------------------

/**
 * **Die Anforderung haengt an der ARBEIT, nicht am Planungsartefakt.**
 *
 * Der Entwurf hatte `posten_qualifikation`: eine Anforderung, die nur an einem
 * festen Posten existieren kann. §34a Abs. 1a GewO knuepft aber an den EINSATZ
 * eines Menschen in einer Bewachungstaetigkeit an, nicht an die Existenz einer
 * `posten`-Zeile in dieser Datenbank. SEC-08 ist kurzfristige Eventbesetzung
 * ohne festen Posten — unter dem Entwurf umging ein Planer, der Wachen gegen ein
 * Objekt oder eine blosse Schicht bucht, die §34a-Pruefung und die
 * Registerpruefung VOLLSTAENDIG. Vier Geltungsbereiche loesen das, und sie sind
 * ADDITIV, keine Fallkette: eine Postenanforderung hebt die mandantenweite
 * §34a-Grundanforderung nicht auf, sonst waere eine Grundanforderung, die sich
 * durch Anlegen eines Postens abschalten laesst, keine.
 */
create table einsatzanforderung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  geltungsbereich einsatzanforderung_bereich not null,
  /**
   * `posten` und `veranstaltung` gibt es erst mit PR 41. Die Spalten stehen
   * schon hier, weil der Aufloeser in §9.2 sie liest und weil `einsatz` sie
   * bereits traegt; ihr Fremdschluessel kommt mit ihren Tabellen. Ihn hier
   * gegen eine nicht existierende Tabelle zu schreiben scheiterte an der
   * Migration; ihn zu vergessen faellt nie auf — deshalb steht er hier
   * benannt.
   */
  posten_id     uuid,
  veranstaltung_id uuid,
  objekt_id     uuid,
  /**
   * EINSPALTIGER Fremdschluessel, mit Absicht: der Katalog ist plattformweit,
   * wo `qualifikation.mandant_id is null` (§6.16). Ein zusammengesetzter
   * Schluessel ueber `(mandant_id, qualifikation_id)` koennte eine
   * plattformweite §34a-Zeile gar nicht referenzieren. Das mandantenfremde Loch,
   * das dadurch entstuende, schliesst der Ausloeser unten.
   */
  qualifikation_id uuid not null references qualifikation(id),
  -- `false` = Warnung statt Hartsperre.
  zwingend      boolean not null default true,
  geltung       qualifikation_geltung not null default 'jeder',
  mindestanzahl smallint not null default 1 check (mindestanzahl >= 1),
  -- Die Anforderung gilt ab diesem Tag (Vertragsaenderung). Verglichen wird
  -- gegen den BERLINER Kalendertag des Schichtbeginns (K-11).
  gueltig_ab    date,
  /**
   * Die maschinenlesbare Haelfte von §34a (SEC-03): `true` heisst, der
   * Nachweis allein genuegt nicht — der Mensch muss am Schichtdatum zusaetzlich
   * eine lebende Eintragung im Bewacherregister haben. §9.3 entscheidet den
   * Registerzweig an DIESER Spalte und an nichts sonst.
   */
  bewacherregister_pflicht boolean not null default false,
  -- Klartext zur Anzeige, z. B. „§34a Abs. 1a GewO". NIE gematcht.
  rechtsgrundlage text,
  -- §1.16: ist diese Anforderung eine geratene oder eine bestaetigte?
  ist_platzhalter boolean not null default true,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint einsatzanforderung_mandant_uk unique (mandant_id, id),
  constraint ea_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),

  -- Genau EIN Geltungsbereich, immer. `mandant` traegt keine der drei
  -- Bereichsspalten: es IST der Bereich.
  constraint ea_bereich_posten
    check ((geltungsbereich = 'posten') = (posten_id is not null)),
  constraint ea_bereich_veranstaltung
    check ((geltungsbereich = 'veranstaltung') = (veranstaltung_id is not null)),
  constraint ea_bereich_objekt
    check ((geltungsbereich = 'objekt') = (objekt_id is not null)),
  constraint ea_bereich_mandant
    check (geltungsbereich <> 'mandant'
           or (posten_id is null and veranstaltung_id is null and objekt_id is null)),
  /**
   * ZWISCHENSTAND, und er faellt in dem Moment, in dem die verzoegerte
   * Schichtpruefung aus §9.4 landet.
   *
   * Ohne ihn liesse sich eine harte §34a-Anforderung mit
   * `geltung = 'mindestens_einer'` eintragen — und die wird zur Schreibzeit von
   * NIEMANDEM geprueft: der Zeilenausloeser kennt nur `jeder`, und die
   * Schichtpruefung gibt es noch nicht. SEC-04s Hartsperre gaelte dann
   * stillschweigend nicht.
   */
  constraint ea_geltung_zwischenstand
    check (not zwingend or geltung = 'jeder')
);

/** Eine Anforderung je Bereichsobjekt und Qualifikation. */
create unique index ea_scope_uk on einsatzanforderung
  (coalesce(posten_id, veranstaltung_id, objekt_id, mandant_id), qualifikation_id)
  where archiviert_am is null;
-- Die vier heissen Pfade des Aufloesers (§9.2).
create index ea_gate_posten_idx on einsatzanforderung (posten_id)
  where zwingend and archiviert_am is null;
create index ea_gate_veranstaltung_idx on einsatzanforderung (veranstaltung_id)
  where zwingend and archiviert_am is null;
create index ea_gate_objekt_idx on einsatzanforderung (objekt_id)
  where zwingend and archiviert_am is null;
create index ea_gate_mandant_idx on einsatzanforderung (mandant_id)
  where geltungsbereich = 'mandant' and zwingend and archiviert_am is null;
-- „Welche Zuweisungen kann ich nicht mehr besetzen, wenn dieser Nachweis
-- ablaeuft" — die Rueckwaertsfrage des 60/30/7-Waechters.
create index ea_rueckwaerts_idx on einsatzanforderung (mandant_id, qualifikation_id);
create index ea_register_idx on einsatzanforderung (mandant_id)
  where bewacherregister_pflicht and zwingend and archiviert_am is null;

comment on table einsatzanforderung is
  'Welche Qualifikation eine Zuweisung verlangt (§6.6). Vier Geltungsbereiche, '
  'ADDITIV — eine Postenanforderung hebt die mandantenweite §34a-Grundlage nicht '
  'auf. Die mandantenweite Grundanforderung wird LEER ausgeliefert (O-149).';

/**
 * Das mandantenfremde Loch, das der einspaltige FK offen laesst.
 *
 * `SECURITY DEFINER` mit der Lesepolicy `q_definer` aus `0030`: als Aufrufer
 * gelesen liefert eine mandantenfremde Qualifikation unter FORCE RLS null
 * Zeilen — und `v_mandant is null` saehe dann aus wie „plattformweit, also
 * erlaubt". Die Pruefung liesse genau das durch, was sie verhindern soll.
 */
create function kern.pruefe_qualifikation_mandant() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_gefunden boolean;
  v_mandant  uuid;
begin
  select true, q.mandant_id into v_gefunden, v_mandant
    from public.qualifikation q where q.id = new.qualifikation_id;
  if v_gefunden is not true then
    raise exception 'Unbekannte Qualifikation %.', new.qualifikation_id
      using errcode = 'P0001';
  end if;
  if v_mandant is not null and v_mandant <> new.mandant_id then
    raise exception 'Qualifikation % gehoert Mandant %, die Anforderung aber '
                    'Mandant % — eine mandantenspezifische Qualifikation gilt '
                    'nicht in einer fremden Gesellschaft.',
      new.qualifikation_id, v_mandant, new.mandant_id using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger a_ea_qualifikation_mandant
  before insert or update of qualifikation_id, mandant_id on einsatzanforderung
  for each row execute function kern.pruefe_qualifikation_mandant();

-- ---------------------------------------------------------------------------
-- 4. Zeilenschutz — bewacher_eintrag (§6.18)
-- ---------------------------------------------------------------------------

alter table bewacher_eintrag enable row level security;
alter table bewacher_eintrag force  row level security;

/**
 * Personenabgeleitet wie `nachweis`, plus Recht. **Kein Mandantenbezug auf der
 * Zeile**, weil sie keinem Arbeitgeber gehoert: die Registeridentitaet ist eine
 * Tatsache ueber den Menschen.
 */
create policy be_lesen on bewacher_eintrag for select to cse_app
  using (app.person_sichtbar(person_id)
         and ((select app.hat_recht('personal.nachweis_lesen', app.aktiver_mandant()))
              or person_id = app.aktuelle_person()));

create policy be_schreiben on bewacher_eintrag for insert to cse_app
  with check (app.person_sichtbar(person_id)
              and not app.ist_readonly()
              and (select app.hat_recht('personal.bewacher_verwalten', app.aktiver_mandant())));

create policy be_aendern on bewacher_eintrag for update to cse_app
  using (app.person_sichtbar(person_id)
         and (select app.hat_recht('personal.bewacher_verwalten', app.aktiver_mandant())))
  with check (app.person_sichtbar(person_id)
              and not app.ist_readonly()
              and (select app.hat_recht('personal.bewacher_verwalten', app.aktiver_mandant())));

create policy be_ma_decke on bewacher_eintrag as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter' or person_id = app.aktuelle_person());
create policy be_kunde_decke on bewacher_eintrag as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

-- Das Tor unten liest diese Tabelle als `cse_definer`. Ohne diese Zeile findet
-- es keine Eintragung, der Registerzweig meldet „fehlt" fuer JEDEN — es faellt
-- also geschlossen, laut, und blockiert jede rechtmaessige Zuweisung.
create policy be_definer on bewacher_eintrag for select to cse_definer using (true);

grant select, insert, update on bewacher_eintrag to cse_app;
grant select on bewacher_eintrag to cse_job;
create policy be_job on bewacher_eintrag for select to cse_job using (true);

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz — einsatzanforderung (§6.6, Modul `security`)
-- ---------------------------------------------------------------------------

alter table einsatzanforderung enable row level security;
alter table einsatzanforderung force  row level security;

create policy t_mandant on einsatzanforderung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('security.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('security.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on einsatzanforderung for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.security.lesen')));

-- Welche Qualifikation ein Posten verlangt, ist interne Planung: weder der
-- Arbeiter noch der Kunde hat hier eine Zeile (EMP-13).
create policy p_ma_decke on einsatzanforderung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on einsatzanforderung as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * **Die eine `cse_definer`-Policy, die 03-GEWERKE §9.2 ausdruecklich verlangt.**
 *
 * `app.qualifikationsanforderung` ist `SECURITY DEFINER`, und diese Tabelle
 * traegt `FORCE ROW LEVEL SECURITY`. `cse_definer` passt auf keine der
 * `cse_app`-Policies oben. Ohne diese Zeile liefert der Aufloeser NULL ZEILEN
 * UND KEINEN FEHLER — `v_fehlend` bleibt leer, das Tor antwortet
 * `'erfuellt': true` fuer jede Zuweisung, die je gemacht wurde, und SEC-04
 * beziehungsweise LEG-04 sind schlicht nicht durchgesetzt. Das ist die
 * gefaehrlichere der beiden Ausfallrichtungen: sie faellt nach oben offen, sie
 * ist lautlos, und kein Test mit normal berechtigtem Aufrufer bemerkt sie.
 */
create policy ea_definer on einsatzanforderung for select to cse_definer using (true);

grant select, insert, update on einsatzanforderung to cse_app;
grant select on einsatzanforderung to cse_job;
create policy ea_job on einsatzanforderung for select to cse_job using (true);

-- ---------------------------------------------------------------------------
-- 6. Die Lesepolicies, die das Tor auf FREMDEN Tabellen braucht
-- ---------------------------------------------------------------------------

/**
 * `01-KERN.md` §3.5 / `03-GEWERKE.md` §2.3: der `cse_definer`-Leseregister
 * waechst um `anstellung` und `einsatz`, weil das Tor sie liest.
 *
 * Eine `SECURITY DEFINER`-Funktion liest unter FORCE RLS NICHTS, solange der
 * Eigentuemer keine eigene Policy hat. Fehlte `anstellung`, faende das Tor
 * keine `person_id`, `v_person` bliebe NULL, das `not exists` traefe zu und
 * JEDE Zuweisung waere gesperrt. Fehlte `einsatz`, bliebe `v_stichtag` NULL,
 * jeder Datumsvergleich waere dreiwertig NULL — und eine Compliancefrage von
 * dreiwertiger Logik entscheiden zu lassen ist genau der Fehler, den §9.1
 * beschreibt.
 *
 * Beide sind `SELECT`-only. `cse_definer` haelt auf keiner Mandantentabelle ein
 * Schreibrecht ausser den von K-06 gedeckten.
 */
create policy a_definer on anstellung for select to cse_definer using (true);
create policy e_definer on einsatz for select to cse_definer using (true);

-- ---------------------------------------------------------------------------
-- 7. Schicht 1 — der Aufloeser (03-GEWERKE §9.2)
-- ---------------------------------------------------------------------------

/**
 * Welche Anforderungen gelten fuer DIESE Schicht?
 *
 * Vier Geltungsbereiche, ADDITIV zusammengelesen. Der Mandant wird aus dem
 * `einsatz` abgeleitet und nicht aus der Sitzung — deshalb loest die Funktion in
 * allen vier Leseumfaengen gleich auf (K-20), auch wenn `app.aktiver_mandant()`
 * dort NULL ist.
 *
 * `gueltig_ab` wird gegen den BERLINER Kalendertag des Schichtbeginns
 * verglichen (K-11), nie gegen `(beginn_zeitpunkt)::date` — das waere der
 * UTC-Tag und laege bei einer Nachtschicht um einen Tag daneben.
 */
create function app.qualifikationsanforderung(p_einsatz uuid)
returns setof public.einsatzanforderung
language sql stable security definer set search_path = pg_catalog, public as $$
  with e as (select * from public.einsatz where id = p_einsatz)
  select a.* from public.einsatzanforderung a, e
   where a.archiviert_am is null
     and (a.gueltig_ab is null
          or a.gueltig_ab <= (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date)
     and (   (a.geltungsbereich = 'posten'        and a.posten_id        = e.posten_id)
          or (a.geltungsbereich = 'veranstaltung' and a.veranstaltung_id = e.veranstaltung_id)
          or (a.geltungsbereich = 'objekt'        and a.objekt_id        = e.objekt_id)
          or (a.geltungsbereich = 'mandant'       and a.mandant_id       = e.mandant_id));
$$;

comment on function app.qualifikationsanforderung(uuid) is
  'Aufloeser der Anforderungsmenge einer Schicht (03-GEWERKE §9.2). Vier '
  'Bereiche, additiv. Leitet den Mandanten aus dem Einsatz ab, nicht aus der '
  'Sitzung — loest deshalb in allen vier Leseumfaengen auf (K-20).';

-- ---------------------------------------------------------------------------
-- 8. Schicht 2 — das Tor selbst (03-GEWERKE §9.3)
-- ---------------------------------------------------------------------------

/**
 * Erfuellt DIESE Anstellung die Anforderungen DIESER Schicht?
 *
 * **Der Stichtag ist kein Parameter.** Die Signatur ist zweistellig; die
 * Funktion leitet den Vergleichstag selbst als Berliner Kalendertag des
 * Schichtbeginns ab. Ein dritter Parameter laedt dazu ein, `now()` zu
 * uebergeben — und damit vergangene Schichten rueckwirkend fuer unzulaessig zu
 * erklaeren (Abnahmekriterium 2).
 *
 * **`SECURITY DEFINER`, und zwar aus einem engeren Grund als dem naheliegenden.**
 * Ein mandantenfremder Nachweis ist ohnehin lesbar (§6.17:
 * `erfasst_von_mandant_id` steuert die Sichtbarkeit nicht). Der echte Ausfall
 * ist: ein Aufrufer OHNE `personal.nachweis_lesen` — ein Planer ohne
 * Personalmodul, ein Backfill, eine Konsolensitzung — liest null
 * `nachweis`-Zeilen, das `not exists` trifft zu, und JEDE Zuweisung wird
 * abgewiesen. Geschlossen, also sicher; und rechtmaessige Zuweisungen flaechig
 * blockierend, also nicht hinnehmbar. Als definer ist die Compliancepruefung von
 * den Leserechten des Aufrufers vollstaendig entkoppelt.
 */
create function app.einsatz_qualifikation_erfuellt(p_anstellung uuid, p_einsatz uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_person    uuid;
  v_stichtag  date;
  v_fehlend   jsonb := '[]'::jsonb;
  v_bewachung boolean;
  v_gefunden  integer;
begin
  select a.person_id into v_person
    from public.anstellung a where a.id = p_anstellung;
  select (e.beginn_zeitpunkt at time zone 'Europe/Berlin')::date
    into v_stichtag
    from public.einsatz e where e.id = p_einsatz;

  /**
   * Ohne Person oder ohne Schicht ist nichts pruefbar — und „nicht pruefbar"
   * ist nicht „erfuellt". Die Alternative waere, dass NULL durch jeden
   * Vergleich unten rutscht und das Tor `erfuellt` meldet, weil es nichts
   * gefunden hat, wogegen es haette pruefen koennen.
   */
  if v_person is null or v_stichtag is null then
    raise exception 'SEC-04: Zuordnung nicht pruefbar — Anstellung % oder '
                    'Einsatz % nicht lesbar.', p_anstellung, p_einsatz
      using errcode = 'P0002';
  end if;

  -- 0. Wie viele Anforderungen haben ueberhaupt aufgeloest? `0` ist ein
  --    MELDEPFLICHTIGER Zustand, kein Bestehen (§9.5): die mandantenweite
  --    Grundanforderung wird leer ausgeliefert (O-149), also ist „keine
  --    Anforderung gefunden" heute der Normalfall und muss unterscheidbar
  --    bleiben von „geprueft und bestanden".
  select count(*) into v_gefunden from app.qualifikationsanforderung(p_einsatz);

  -- 1. Jede zwingende Anforderung mit `geltung = 'jeder'` muss AM SCHICHTDATUM
  --    gedeckt sein.
  select coalesce(jsonb_agg(jsonb_build_object(
           'qualifikation_id', a.qualifikation_id,
           'rechtsgrundlage',  a.rechtsgrundlage)), '[]'::jsonb)
    into v_fehlend
    from app.qualifikationsanforderung(p_einsatz) a
   where a.zwingend
     and a.geltung = 'jeder'
     and not exists (
       select 1 from public.nachweis n
        where n.person_id        = v_person          -- Personenkopf (D-09)
          and n.qualifikation_id = a.qualifikation_id
          and n.status           = 'gueltig'         -- Vokabular aus 01-KERN §4
          and n.widerrufen_am is null
          and n.gueltig_ab <= v_stichtag
          and (n.gueltig_bis is null or n.gueltig_bis >= v_stichtag));

  -- 2. SEC-03: ein gueltiger Nachweis genuegt nicht, wenn die Eintragung fehlt.
  --    Entschieden an der BOOLESCHEN SPALTE, nie an Freitext, und ohne eine
  --    zweite Tabelle zu lesen.
  select exists (select 1 from app.qualifikationsanforderung(p_einsatz) a
                  where a.zwingend and a.bewacherregister_pflicht)
    into v_bewachung;

  if v_bewachung and not exists (
       select 1 from public.bewacher_eintrag b
        where b.person_id = v_person
          and b.erloschen_am is null
          -- Nur `registriert` gilt als einsetzbar; jeder andere Wert des
          -- PLATZHALTER-Vokabulars wird als ungeprueft behandelt (O-40).
          and b.status = 'registriert'
          and (b.gueltig_bis is null or b.gueltig_bis >= v_stichtag))
  then
    v_fehlend := v_fehlend || jsonb_build_array(
      jsonb_build_object('bewacherregister', 'fehlt'));
  end if;

  return jsonb_build_object(
    'erfuellt',               jsonb_array_length(v_fehlend) = 0,
    'fehlend',                v_fehlend,
    'anforderungen_gefunden', v_gefunden,
    'stichtag',               v_stichtag,
    'geprueft_am',            now());
end $$;

comment on function app.einsatz_qualifikation_erfuellt(uuid, uuid) is
  'Das SEC-04/LEG-04-Tor (03-GEWERKE §9.3). Bewertet die Gueltigkeit gegen den '
  'Berliner Kalendertag des Schichtbeginns, nie gegen now(). Liest nachweis und '
  'bewacher_eintrag am Personenkopf.';

/** Nur die zwei Rollen, die Zuordnungen schreiben oder pruefen. */
revoke execute on function app.qualifikationsanforderung(uuid) from public;
revoke execute on function app.einsatz_qualifikation_erfuellt(uuid, uuid) from public;
grant execute on function app.qualifikationsanforderung(uuid) to cse_app, cse_job;
grant execute on function app.einsatz_qualifikation_erfuellt(uuid, uuid) to cse_app, cse_job;

-- ---------------------------------------------------------------------------
-- 9. Schicht 2b — die Ausloeserpaarung auf `einsatz_zuordnung` (§9.3)
-- ---------------------------------------------------------------------------

/**
 * **Zwei Ausloeser, weil einer beide Aufgaben nicht kann.**
 *
 * Ein CONSTRAINT-Ausloeser ist immer `AFTER`, und die Zuweisungen eines
 * `AFTER`-Zeilenausloesers an `NEW` werden VERWORFEN — die Zeile steht schon.
 * Der Entwurf hatte genau einen, der `qualifikation_geprueft_am` und
 * `qualifikation_snapshot` in einen Datensatz stempelte, den Postgres wegwirft:
 * beide Spalten blieben NULL, und der CHECK aus §9.4 wies dann genau die Pfade
 * ab, fuer die dieser Abschnitt existiert — Backfill, Migrationsskript,
 * Konsolen-`INSERT`. Der Dienstweg sah nur deshalb heil aus, weil der
 * TypeScript-Dienst die beiden Spalten selbst schreibt; den beworbenen Beweis
 * auf Datenbankebene gab es nicht.
 *
 * Getrennt: der `BEFORE`-Ausloeser besitzt den Stempel — und ueberschreibt,
 * was die Anweisung mitgebracht hat (Invariante 5) —, der verzoegerbare
 * Constraint-Ausloeser liest ihn zurueck und hebt ab.
 */
create function kern.stempel_einsatz_qualifikation() returns trigger
language plpgsql as $$
begin
  -- Eine abgesagte Zuordnung ist ein historischer Datensatz; sie neu zu pruefen
  -- hiesse, eine Absage an einer heutigen Tatsache scheitern zu lassen.
  if new.abgesagt_am is not null then return new; end if;
  new.qualifikation_snapshot    := app.einsatz_qualifikation_erfuellt(
                                     new.anstellung_id, new.einsatz_id);
  new.qualifikation_geprueft_am := now();   -- Serveruhr, Invariante 5
  return new;
end $$;

create trigger a_einsatz_zuordnung_qualifikation_stempeln
  before insert or update of anstellung_id, einsatz_id, abgesagt_am
  on einsatz_zuordnung
  for each row execute function kern.stempel_einsatz_qualifikation();

/** Liest den gestempelten Beweis zurueck und weist ab. Weist nichts zu. */
create function kern.erzwinge_einsatz_qualifikation() returns trigger
language plpgsql as $$
begin
  if new.abgesagt_am is not null then return null; end if;
  if not (new.qualifikation_snapshot->>'erfuellt')::boolean then
    raise exception 'Zuweisung verletzt SEC-04/LEG-04: %',
      new.qualifikation_snapshot->'fehlend' using errcode = 'P0002';
  end if;
  return null;
end $$;

create constraint trigger einsatz_zuordnung_qualifikation
  after insert or update of anstellung_id, einsatz_id, abgesagt_am
  on einsatz_zuordnung
  deferrable initially immediate
  for each row execute function kern.erzwinge_einsatz_qualifikation();

-- ---------------------------------------------------------------------------
-- 10. Schicht 3 — der CHECK auf den BEWEIS der Pruefung (§9.4)
-- ---------------------------------------------------------------------------

/**
 * Eine besetzte Zuordnung OHNE dokumentierte Pruefung ist strukturell nicht
 * darstellbar.
 *
 * Das ist der Teil, der sich als Constraint ausdruecken laesst — und der Teil,
 * den eine Aufsicht tatsaechlich sehen will: nicht nur „irgendwer war
 * qualifiziert", sondern „die Pruefung hat stattgefunden, und hier steht ihr
 * Ergebnis". Die Bedingung haengt an `abgesagt_am` und nicht an `posten_id`:
 * eine Zuweisung gegen ein Objekt oder eine Veranstaltung braucht den Beweis
 * genauso wie eine gegen einen Posten (§9.1, SEC-08).
 */
alter table einsatz_zuordnung add constraint ez_qualifikation_geprueft check (
  abgesagt_am is not null
  or (qualifikation_geprueft_am is not null
      and qualifikation_snapshot is not null
      and qualifikation_snapshot <> '{}'::jsonb)
);

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0031)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- bewacher_eintrag (archiv): SEC-A9, LEG-04, § 34a GewO. Unter dieser Eintragung wurde ein Mensch im Bewachungsgewerbe eingesetzt; sie zu loeschen entfernt den Beleg der Zulaessigkeit und die einmal vergebene Bewacher-ID. Eine erloschene Registrierung bekommt erloschen_am.
create trigger trg_bewacher_eintrag_kein_hard_delete
  before delete on bewacher_eintrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_bewacher_eintrag_kein_truncate
  before truncate on bewacher_eintrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on bewacher_eintrag from cse_app, cse_anon, cse_checkin, cse_job;

-- einsatzanforderung (archiv): LEG-04, § 34a Abs. 1a GewO. Sie sagt, WAS zum Zeitpunkt der Planung verlangt war — die Frage, an der eine Aufsicht eine vergangene Besetzung misst. Geloescht saehe jede damals rechtmaessig besetzte Schicht so aus, als habe nie eine Anforderung bestanden.
create trigger trg_einsatzanforderung_kein_hard_delete
  before delete on einsatzanforderung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_einsatzanforderung_kein_truncate
  before truncate on einsatzanforderung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on einsatzanforderung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_bewacher_eintrag_geaendert_am
  before update on bewacher_eintrag
  for each row execute function kern.setze_geaendert_am();
create trigger trg_einsatzanforderung_geaendert_am
  before update on einsatzanforderung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_bewacher_eintrag_audit
  after insert or update or delete on bewacher_eintrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
