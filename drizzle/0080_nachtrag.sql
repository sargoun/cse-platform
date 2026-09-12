-- ===========================================================================
-- 0080 — Bau B/1: der Nachtrag nach § 2 VOB/B
--        (BAU-04, BAU-05, 03-GEWERKE.md §7.10, §3.3, §3.5)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md`. Wo dieser Text
-- und eine Konvention (K-nn) auseinandergehen, gilt die Konvention.
--
-- Der PR-Plan nennt fuer PR 44 die Nummern `0061`/`0062`; beide sind seit
-- Phase 5 vergeben (Urlaubskonto, Pausenkorrektur). Diese Migration und
-- `0081` treten an ihre Stelle.
--
-- **Die vier Stellen, an denen hier bewusst NICHT das Naheliegende steht:**
--
--  1. **`grundlage` ist eine KATALOGTABELLE, kein Aufzaehlungstyp.** §3.3
--     nennt `nachtrag_grundlage` als `enum`; der PR-Plan verlangt fuer
--     dieselbe Spalte „a required selection from a config table" und K-17
--     verlangt fuer einen offenen Rechtswert einen sichtbaren Platzhalter.
--     Ein `enum` kann nicht sagen „diese Zeile ist unbestaetigt": er traegt
--     keine Spalte dafuer, und die Oberflaeche haette nichts anzuzeigen.
--     §3.4 hat dieselbe Entscheidung fuer `qualitaetspruefung.verfahren`
--     bereits so getroffen und `pruefverfahren` daraus gemacht — aus genau
--     diesem Grund. Die Liste steht vollstaendig aus dem Gesetzestext und
--     jede Zeile traegt `ist_platzhalter = true`, bis O-23 beantwortet ist.
--  2. **`angemeldet_am` und `eingereicht_am` sind ZWEI Spalten.** Nicht eine
--     mit einem Zustand daneben: ueber den Anspruch entscheidet die
--     rechtzeitige ANKUENDIGUNG vor Ausfuehrungsbeginn (§ 2 Abs. 6 Nr. 1
--     VOB/B), ueber die Faelligkeit die Einreichung der Kalkulation. Wer
--     beides in ein Feld legt, kann im Streit nicht mehr belegen, dass
--     angekuendigt wurde, bevor gebaut wurde.
--  3. **`ueberfaellig_gemeldet_am`.** Die SPEC-§14-Wache „angemeldet, nach 14
--     Tagen nicht eingereicht" soll EINMAL melden. Ohne eine Spalte, die das
--     festhaelt, meldet ein taeglicher Lauf denselben Nachtrag jeden Tag —
--     und eine Wache, die jeden Tag dasselbe sagt, liest nach einer Woche
--     niemand mehr. Sie steht im Indexpraedikat, damit die Abfrage die
--     bereits gemeldeten gar nicht erst anfasst.
--  4. **KEINE Preisbildung.** Die Betragsspalten stehen (§7.10), aber nichts
--     in dieser Migration und nichts in `services/bau/nachtrag.ts` schreibt
--     sie: die Bepreisung ist PR 48. Lesbar sind sie ohnehin nicht — der
--     Spalten-GRANT unten laesst sie aus (K-05, §1.9).
--
-- NICHT in dieser Migration: `behinderung` (0081), `bautagebuch`, `abnahme`,
-- `gewerk` (PR 45), die Nachtragskalkulation (PR 48), der Wachjob selbst
-- (PR 82 — die ABFRAGE steht in `services/bau/nachtrag.ts`).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Aufzaehlungstypen (§3.3)
-- ---------------------------------------------------------------------------

/**
 * Der Lebenslauf eines Nachtrags. `eingereicht` ist der Uebergang, an dem
 * etwas das Haus verlaesst — er traegt deshalb eine Freigabe (Invariante 7).
 */
create type nachtrag_status as enum
  ('angemeldet','kalkuliert','eingereicht','beauftragt','abgelehnt','zurueckgezogen');

/**
 * Wie angeordnet wurde. `muendlich` ist ein Risikomerkmal und kein Detail:
 * § 2 Abs. 5/6 VOB/B knuepft den Anspruch an eine Anordnung des
 * Auftraggebers, und eine muendliche ist die, die im Streit bestritten wird.
 */
create type nachtrag_anordnung_form as enum ('schriftlich','muendlich','e_mail','unbekannt');

-- ---------------------------------------------------------------------------
-- 2. nachtrag_grundlage — der Katalog (K-17, §3.4-Muster)
-- ---------------------------------------------------------------------------

/**
 * Die Anspruchsgrundlage eines Nachtrags, als Zeile.
 *
 * Mandantengebunden wie `pruefverfahren` (0068) und aus demselben Grund:
 * Invariante 3 kennt keine Ausnahme, und welche Grundlagen eine Gesellschaft
 * tatsaechlich verwendet, ist ihre Entscheidung — auch wenn der Gesetzestext
 * fuer alle derselbe ist. Vorbelegt wird sie hier und per Ausloeser fuer
 * jede Gesellschaft, die spaeter entsteht.
 *
 * // TODO(client, O-23): welche §2-VOB/B-Grundlagen (Abs. 3/5/6/7/8) verwendet die Gruppe?
 */
create table nachtrag_grundlage (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /** Stabil, maschinenlesbar — die Oberflaeche zeigt `bezeichnung`. */
  schluessel    text not null,
  bezeichnung   text not null,
  /** Die Fundstelle woertlich: „§ 2 Abs. 6 VOB/B". Sie steht in der Zeile. */
  fundstelle    text not null,
  /** Der Tatbestand in einem Satz, aus dem Gesetzestext. */
  beschreibung  text not null,
  /**
   * § 2 Abs. 6 Nr. 1 VOB/B: der Anspruch auf besondere Verguetung besteht
   * nur, wenn der Auftragnehmer ihn VOR Beginn der Ausfuehrung ankuendigt.
   * Die Spalte steuert nichts — sie erklaert der Bauleitung, warum das
   * Anmeldedatum bei dieser Grundlage das wichtigere ist.
   */
  ankuendigung_erforderlich boolean not null default false,
  reihenfolge   smallint not null default 0,

  /**
   * §1.16: die Zeile sagt selbst, dass sie unbestaetigt ist, und die
   * Oberflaeche zeigt daneben die Pille „Unbestaetigter Wert". Der
   * Gesetzestext ist bestaetigt; unbestaetigt ist, welche dieser Grundlagen
   * die Gruppe verwendet (O-23).
   */
  ist_platzhalter boolean not null default true,

  archiviert_am timestamptz,
  archiviert_von uuid references benutzer(id),
  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint ng_mandant_uk unique (mandant_id, id),
  constraint ng_schluessel_nicht_leer check (btrim(schluessel) <> ''),
  constraint ng_bezeichnung_nicht_leer check (btrim(bezeichnung) <> ''),
  constraint ng_fundstelle_nicht_leer check (btrim(fundstelle) <> ''),
  constraint ng_archiv_paarweise check ((archiviert_am is null) = (archiviert_von is null))
);

/** §1.3: die Eindeutigkeit gilt unter den LEBENDEN Zeilen, nicht ewig. */
create unique index nachtrag_grundlage_schluessel_uk
  on nachtrag_grundlage (mandant_id, schluessel) where archiviert_am is null;
create index nachtrag_grundlage_ordnung_idx
  on nachtrag_grundlage (mandant_id, reihenfolge) where archiviert_am is null;

create trigger trg_nachtrag_grundlage_archivierung
  before insert or update on nachtrag_grundlage
  for each row execute function kern.archivierung_stempeln();

comment on table nachtrag_grundlage is
  'BAU-04, K-17: die Anspruchsgrundlage eines Nachtrags als Katalogzeile — '
  'nie Freitext, nie ein Vorgabewert. Aus dem Gesetzestext befuellt und bis '
  'zur Antwort auf O-23 als Platzhalter markiert.';

-- ---------------------------------------------------------------------------
-- 3. nachtrag (§7.10)
-- ---------------------------------------------------------------------------

create table nachtrag (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),
  projekt_id    uuid not null,
  /** §7.10: der kaufmaennische Kopf und, wo bekannt, die Auftragszeile. */
  auftrag_id    uuid not null,
  auftrag_leistung_id uuid,

  nummer        text not null,
  titel         text not null,

  /**
   * PFLICHTAUSWAHL, ohne Vorgabewert (K-17). `not null` und ein
   * Fremdschluessel auf den Katalog: eine Anspruchsgrundlage, die die
   * Oberflaeche vorbelegt, ist eine Rechtsfolge, die niemand gewaehlt hat.
   */
  grundlage_id  uuid not null,
  begruendung   text not null,
  status        nachtrag_status not null default 'angemeldet',

  /**
   * BAU-04, die beiden Daten. Berliner Kalendertage (K-11) — der Anspruch
   * haengt an einem TAG, nicht an einem Zeitpunkt, und das Einreichen einer
   * Kalkulation um 23:50 Berliner Zeit waere als UTC-Tag der Vortag.
   *
   * Die Seitenkarte (§5.9) nennt beide `timestamptz`; §7.10 nennt beide
   * `date`. Der Schemavertrag gewinnt: § 2 Abs. 6 Nr. 1 VOB/B fragt nach dem
   * Tag der Ankuendigung, und die Wache rechnet in Tagen.
   */
  angemeldet_am date,
  eingereicht_am date,
  beauftragt_am date,
  abgelehnt_am  date,
  zurueckgezogen_am date,
  abgelehnt_grund text,

  /** Wer auf Auftraggeberseite angeordnet hat — und in welcher Form. */
  angeordnet_von text,
  anordnung_form nachtrag_anordnung_form not null default 'unbekannt',
  /** BAU-05: ausgefuehrt, ohne dass je beauftragt wurde. Ein Risikobericht. */
  ausgefuehrt_ohne_beauftragung boolean not null default false,

  /**
   * Die Betraege. GESCHRIEBEN wird hier keiner — die Bepreisung ist PR 48.
   * Ganzzahlige Cent (Invariante 1); der Spalten-GRANT unten laesst beide
   * aus (K-05, §1.9, §7.10).
   */
  betrag_netto_cent bigint,
  beauftragter_betrag_netto_cent bigint,
  bauzeit_verlaengerung_tage integer,

  /** K-13: die Freigabe wird nicht nachgebaut, nur verwiesen und denormalisiert. */
  freigabe_id   uuid,
  freigegeben_am timestamptz,
  freigegeben_von uuid references benutzer(id),

  /**
   * Die SPEC-§14-Wache hat hier ihr Gedaechtnis. NULL heisst „noch nicht
   * gemeldet"; gesetzt wird sie ausschliesslich vom Job (PR 82) ueber
   * `markiereUeberfaelligGemeldet`.
   */
  ueberfaellig_gemeldet_am timestamptz,

  aufbewahrung_bis date,
  loeschsperre  boolean not null default true,
  storniert_am  timestamptz,
  storniert_von uuid references benutzer(id),
  storno_grund  text,
  ersetzt_durch_id uuid,

  erstellt_am   timestamptz not null default now(),
  erstellt_von  uuid references benutzer(id),
  geaendert_am  timestamptz,
  geaendert_von uuid references benutzer(id),

  primary key (id),
  constraint nachtrag_mandant_uk unique (mandant_id, id),
  /** Der Grosselternschluessel (§1.4) fuer `aufmass_zeile` und `behinderung`. */
  constraint nachtrag_projekt_uk unique (mandant_id, projekt_id, id),
  constraint nachtrag_nummer_uk unique (projekt_id, nummer),
  constraint nachtrag_projekt_fk foreign key (mandant_id, projekt_id)
    references projekt (mandant_id, id),
  constraint nachtrag_auftrag_fk foreign key (mandant_id, auftrag_id)
    references auftrag (mandant_id, id),
  constraint nachtrag_leistung_fk foreign key (mandant_id, auftrag_leistung_id)
    references auftrag_leistung (mandant_id, id),
  constraint nachtrag_grundlage_fk foreign key (mandant_id, grundlage_id)
    references nachtrag_grundlage (mandant_id, id),
  constraint nachtrag_freigabe_fk foreign key (mandant_id, freigabe_id)
    references freigabe (mandant_id, id),
  constraint nachtrag_ersatz_fk foreign key (mandant_id, ersetzt_durch_id)
    references nachtrag (mandant_id, id),

  constraint nachtrag_nummer_nicht_leer check (btrim(nummer) <> ''),
  constraint nachtrag_titel_nicht_leer check (btrim(titel) <> ''),
  constraint nachtrag_begruendung_nicht_leer check (btrim(begruendung) <> ''),
  /** Eingereicht werden kann nur, was vorher angekuendigt wurde. */
  constraint nachtrag_reihenfolge_daten check (
    eingereicht_am is null or angemeldet_am is null or eingereicht_am >= angemeldet_am),
  /**
   * **Invariante 7 auf Datenbankebene.** Die Einreichung IST der Ausgang:
   * sie geht an den Auftraggeber. Ohne Freigabe und ohne Datum gibt es diesen
   * Zustand nicht — auch nicht ueber ein zusammengebautes UPDATE.
   */
  constraint nachtrag_eingereicht_freigegeben check (
    status <> 'eingereicht' or (eingereicht_am is not null and freigabe_id is not null)),
  constraint nachtrag_beauftragt_datiert check (
    status <> 'beauftragt' or beauftragt_am is not null),
  constraint nachtrag_abgelehnt_begruendet check (
    abgelehnt_am is null or btrim(coalesce(abgelehnt_grund,'')) <> ''),
  constraint nachtrag_freigabe_paarweise check (
    (freigegeben_am is null) = (freigegeben_von is null)),
  constraint nachtrag_storno_begruendet check (
    storniert_am is null or (storniert_von is not null and btrim(coalesce(storno_grund,'')) <> ''))
);

create index nachtrag_projekt_idx on nachtrag (mandant_id, projekt_id, status);
/**
 * **Die Wache aus SPEC §14** („angemeldet, nach 14 Tagen nicht eingereicht").
 *
 * `ueberfaellig_gemeldet_am is null` steht IM Praedikat und nicht nur in der
 * Abfrage: so schrumpft der Index auf die Zeilen, die noch zu melden sind,
 * und die Abfrage des taeglichen Laufs liest nach der ersten Meldung nichts
 * mehr.
 */
create index nachtrag_watchdog_idx on nachtrag (mandant_id, angemeldet_am)
  where eingereicht_am is null and status = 'angemeldet'
    and storniert_am is null and ueberfaellig_gemeldet_am is null;
create index nachtrag_offen_idx on nachtrag (mandant_id, eingereicht_am)
  where status = 'eingereicht';

comment on table nachtrag is
  'BAU-04: ein Nachtrag nach § 2 VOB/B — mit dem Anmeldedatum getrennt vom '
  'Einreichungsdatum, weil ueber den Anspruch die rechtzeitige Ankuendigung '
  'entscheidet (§ 2 Abs. 6 Nr. 1).';
comment on column nachtrag.angemeldet_am is
  'Die Ankuendigung VOR Ausfuehrungsbeginn (§ 2 Abs. 6 Nr. 1 VOB/B). Nicht '
  'dasselbe wie eingereicht_am — und der Unterschied entscheidet den Anspruch.';
comment on column nachtrag.ueberfaellig_gemeldet_am is
  'Gedaechtnis der SPEC-§14-Wache. Gesetzt heisst: einmal gemeldet, nicht '
  'wieder. Eine Wache, die jeden Tag dasselbe meldet, liest niemand.';

-- ---------------------------------------------------------------------------
-- 4. Die zwei Fremdschluessel, die 0071/0072 offen gelassen haben
-- ---------------------------------------------------------------------------

/**
 * 0071 hat `leistungsverzeichnis.nachtrag_id` woertlich mit dem Vermerk
 * angelegt, der Schluessel komme mit PR 44. Hier kommt er. Ohne ihn koennte
 * eine Nachtragsfassung an einer Nummer haengen, zu der es keinen Nachtrag
 * gibt — und `lv_nachtrag_aktuell_uk` bewachte eine Leere.
 */
alter table leistungsverzeichnis add constraint lv_nachtrag_fk
  foreign key (mandant_id, nachtrag_id) references nachtrag (mandant_id, id);

/**
 * Dasselbe eine Ebene tiefer, und hier mit dem GROSSELTERNSCHLUESSEL (§1.4):
 * eine Aufmasszeile, die auf den Nachtrag eines ANDEREN Projekts zeigt,
 * waere eine Menge, die in einer fremden Abrechnung landet.
 */
alter table aufmass_zeile add constraint az_nachtrag_fk
  foreign key (mandant_id, projekt_id, nachtrag_id)
  references nachtrag (mandant_id, projekt_id, id);

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz (§1.6, §1.8, K-03)
-- ---------------------------------------------------------------------------

alter table nachtrag_grundlage enable row level security;
alter table nachtrag_grundlage force  row level security;

create policy t_mandant on nachtrag_grundlage for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on nachtrag_grundlage for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/**
 * §7.10: `p_intern_ceiling`. Der Katalog ist eine kaufmaennisch-rechtliche
 * Stammdatenliste; weder der Kunde noch die Kraft vor Ort hat damit zu tun.
 */
create policy p_intern_decke on nachtrag_grundlage as restrictive for all to cse_app
  using (app.portal() = 'intern');

grant select, insert, update on nachtrag_grundlage to cse_app;

alter table nachtrag enable row level security;
alter table nachtrag force  row level security;

create policy t_mandant on nachtrag for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('bau.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('bau.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on nachtrag for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.bau.lesen')));

/**
 * §7.10, woertlich: „a Nachtrag is an internal commercial position until it
 * is submitted, and what the customer receives is the submitted document,
 * not the row." Deshalb KEINE Kundenpolicy — auch nicht fuer den Zustand
 * `eingereicht`.
 */
create policy p_intern_decke on nachtrag as restrictive for all to cse_app
  using (app.portal() = 'intern');

-- ---------------------------------------------------------------------------
-- 6. Spaltenrechte (K-05, §1.9, §7.10)
-- ---------------------------------------------------------------------------

/**
 * Die beiden Betragsspalten sind fuer `cse_app` nicht lesbar.
 *
 * K-05: **Spalten-GRANT statt Maskierungssicht** — was hier nicht steht, ist
 * nicht lesbar, auch nicht ueber `select *`, das dann schlicht scheitert. Der
 * Leser dazu entsteht mit der Nachtragskalkulation (PR 48) als
 * `security definer` mit eigener Pruefung auf `bau.preis_lesen`; bis dahin
 * schreibt und liest sie niemand, und das ist der Zustand, den diese
 * Migration herstellen will — nicht ein halber Preisweg.
 *
 * Die Liste ist ERSCHOEPFEND. Eine Auslassung sieht aus wie eine
 * Entscheidung, solange niemand sie aufschreibt.
 */
revoke select on nachtrag from cse_app;
grant  select (id, mandant_id, projekt_id, auftrag_id, auftrag_leistung_id,
               nummer, titel, grundlage_id, begruendung, status,
               angemeldet_am, eingereicht_am, beauftragt_am, abgelehnt_am,
               zurueckgezogen_am, abgelehnt_grund, angeordnet_von, anordnung_form,
               ausgefuehrt_ohne_beauftragung, bauzeit_verlaengerung_tage,
               freigabe_id, freigegeben_am, freigegeben_von,
               ueberfaellig_gemeldet_am, aufbewahrung_bis, loeschsperre,
               storniert_am, storniert_von, storno_grund, ersetzt_durch_id,
               erstellt_am, erstellt_von, geaendert_am, geaendert_von)
       on nachtrag to cse_app;
       -- OMITTED: betrag_netto_cent, beauftragter_betrag_netto_cent

grant insert, update on nachtrag to cse_app;

-- ---------------------------------------------------------------------------
-- 7. Der Katalog wird befuellt — heute und bei jeder kuenftigen Gesellschaft
-- ---------------------------------------------------------------------------

/**
 * Der Gesetzestext, vollstaendig und in seiner eigenen Ordnung.
 *
 * Vollstaendig und nicht ausgewaehlt: welche dieser Grundlagen die Gruppe
 * verwendet, ist genau die offene Frage (O-23). Eine vorab getroffene Auswahl
 * waere ihre stille Beantwortung — und die eine fehlende Grundlage ist die,
 * unter der der teuerste Nachtrag nicht erfasst werden kann.
 */
create function kern.nachtrag_grundlagen_vorbelegen(p_mandant uuid) returns void
language sql security definer set search_path = pg_catalog, public as $$
  insert into public.nachtrag_grundlage
    (mandant_id, schluessel, bezeichnung, fundstelle, beschreibung,
     ankuendigung_erforderlich, reihenfolge, ist_platzhalter)
  values
    (p_mandant, 'p1_abs_3', 'Änderung des Bauentwurfs', '§ 1 Abs. 3 VOB/B',
     'Der Auftraggeber behält sich vor, Änderungen des Bauentwurfs anzuordnen; '
     || 'die Vergütungsfolge richtet sich nach § 2 Abs. 5.', false, 10, true),
    (p_mandant, 'p1_abs_4', 'Zusätzliche Leistung', '§ 1 Abs. 4 VOB/B',
     'Nicht vereinbarte Leistungen, die zur Ausführung der vertraglichen '
     || 'Leistung erforderlich werden; die Vergütungsfolge richtet sich nach '
     || '§ 2 Abs. 6.', false, 20, true),
    (p_mandant, 'p2_abs_3', 'Mengenänderung über 10 v. H.', '§ 2 Abs. 3 VOB/B',
     'Weicht die ausgeführte Menge einer Position um mehr als 10 v. H. von der '
     || 'im Vertrag vorgesehenen ab, ist auf Verlangen ein neuer Einheitspreis '
     || 'zu vereinbaren.', false, 30, true),
    (p_mandant, 'p2_abs_4', 'Vom Auftraggeber übernommene Leistung', '§ 2 Abs. 4 VOB/B',
     'Übernimmt der Auftraggeber Leistungen selbst, die im Vertrag dem '
     || 'Auftragnehmer übertragen waren, gilt § 8 Abs. 1 Nr. 2 entsprechend.',
     false, 40, true),
    (p_mandant, 'p2_abs_5', 'Geänderte Leistung', '§ 2 Abs. 5 VOB/B',
     'Werden durch Änderung des Bauentwurfs oder andere Anordnungen des '
     || 'Auftraggebers die Grundlagen des Preises geändert, ist ein neuer Preis '
     || 'zu vereinbaren — die Vereinbarung soll VOR der Ausführung getroffen '
     || 'werden.', false, 50, true),
    (p_mandant, 'p2_abs_6', 'Zusätzliche Leistung', '§ 2 Abs. 6 VOB/B',
     'Wird eine im Vertrag nicht vorgesehene Leistung gefordert, hat der '
     || 'Auftragnehmer Anspruch auf besondere Vergütung — er muss den Anspruch '
     || 'jedoch dem Auftraggeber ANKÜNDIGEN, bevor er mit der Ausführung '
     || 'beginnt (§ 2 Abs. 6 Nr. 1).', true, 60, true),
    (p_mandant, 'p2_abs_7', 'Pauschalvertrag', '§ 2 Abs. 7 VOB/B',
     'Ist eine Pauschalsumme vereinbart, bleibt die Vergütung unverändert; '
     || 'weicht die ausgeführte Leistung jedoch so erheblich ab, dass ein '
     || 'Festhalten unzumutbar ist, ist ein Ausgleich zu gewähren.', false, 70, true),
    (p_mandant, 'p2_abs_8', 'Leistung ohne Auftrag', '§ 2 Abs. 8 VOB/B',
     'Leistungen, die der Auftragnehmer ohne Auftrag oder unter '
     || 'eigenmächtiger Abweichung ausführt, werden nicht vergütet — es sei '
     || 'denn, sie waren für die Erfüllung des Vertrags notwendig und werden '
     || 'unverzüglich angezeigt.', true, 80, true),
    (p_mandant, 'bgb_650b', 'Änderung des Werks (BGB-Bauvertrag)', '§ 650b BGB',
     'Änderungsbegehren des Bestellers beim BGB-Bauvertrag; die Vergütung '
     || 'richtet sich nach § 650c BGB. Entfällt per Migration, falls die '
     || 'Gruppe ausschließlich VOB/B-Verträge schließt (O-154).', false, 90, true)
  on conflict do nothing;
$$;

select kern.nachtrag_grundlagen_vorbelegen(m.id) from mandant m;

/**
 * Und derselbe Katalog fuer jede Gesellschaft, die SPAETER entsteht —
 * dieselbe Bauart wie `kern.mandant_pruefverfahren_vorbelegen()` (0068).
 *
 * Ohne diesen Ausloeser bekaeme ein neu angelegter Mandant keinen Katalog,
 * und `nachtrag.grundlage_id` ist `not null`: der erste Nachtrag scheiterte
 * mit einem Fremdschluesselfehler, und zwar erst, wenn ihn jemand anlegen
 * will. `security definer`, weil einen Mandanten anlegt, wer Gesellschaften
 * verwaltet — und das ist nicht `bau.schreiben`.
 */
create function kern.mandant_nachtrag_grundlagen_vorbelegen() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform kern.nachtrag_grundlagen_vorbelegen(new.id);
  return null;
end $$;

create trigger trg_mandant_nachtrag_grundlagen_vorbelegen
  after insert on mandant
  for each row execute function kern.mandant_nachtrag_grundlagen_vorbelegen();

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0080)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- nachtrag_grundlage (archiv): BAU-04, K-17. Die Zeile ist die Anspruchsgrundlage, unter der ein Nachtrag angemeldet wurde — im Streit um § 2 VOB/B die Frage selbst. Geloescht bliebe der Nachtrag stehen und niemand wuesste mehr, worauf er gestuetzt war; abgeloest wird sie durch archiviert_am.
create trigger trg_nachtrag_grundlage_kein_hard_delete
  before delete on nachtrag_grundlage
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachtrag_grundlage_kein_truncate
  before truncate on nachtrag_grundlage
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachtrag_grundlage from cse_app, cse_anon, cse_checkin, cse_job;

-- nachtrag (archiv): BAU-04, BAU-05, FIN-07, LEG-01. Am Nachtrag haengen die Ankuendigung (§ 2 Abs. 6 Nr. 1 VOB/B), die eingereichte Kalkulation und spaeter eine Rechnungsposition. Ein zurueckgezogener wird storniert und durch ersetzt_durch_id abgeloest — geloescht fehlte im Werklohnprozess der Beleg, dass rechtzeitig angekuendigt wurde.
create trigger trg_nachtrag_kein_hard_delete
  before delete on nachtrag
  for each row execute function kern.verhindere_loeschung();
create trigger trg_nachtrag_kein_truncate
  before truncate on nachtrag
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on nachtrag from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_nachtrag_grundlage_geaendert_am
  before update on nachtrag_grundlage
  for each row execute function kern.setze_geaendert_am();
create trigger trg_nachtrag_geaendert_am
  before update on nachtrag
  for each row execute function kern.setze_geaendert_am();

create trigger trg_nachtrag_grundlage_audit
  after insert or update or delete on nachtrag_grundlage
  for each row execute function kern.protokolliere_aenderung();
create trigger trg_nachtrag_audit
  after insert or update or delete on nachtrag
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
