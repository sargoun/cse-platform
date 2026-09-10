-- ===========================================================================
-- 0033 — mandant_einstellung und app.einstellung()
--        (01-KERN.md §6.30 und §3.2, K-21, O-06)
--
-- Vertrag: `02-datenmodell/01-KERN.md` §6.30 (Tabelle), §3.2 (die zwei
-- Signaturen), §3.5 (die Definer-Lesepolicy). Diese Migration gehoert
-- FACHLICH zu 01-KERN; sie steht hier, weil PR 34 der erste Schreiber ist,
-- der sie braucht, und weil eine Tabelle, die vier Dokumente lesen und
-- keines anlegt, genau die Sorte Luecke ist, die niemandem auffaellt:
-- `app.einstellung(...)` gaebe es nicht, jeder Aufrufer fiele auf seinen
-- eigenen Vorgabewert zurueck, und JEDE dieser Einstellungen waere dauerhaft
-- unkonfigurierbar — ohne dass irgendwo ein Fehler entstuende (§6.30).
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **Kein plattformweiter Satz.** `mandant_id` ist NOT NULL. Ein
--     Vorgabewert, der fuer alle vier Gesellschaften gilt, ohne dass jemand
--     ihn je fuer eine davon gesetzt hat, ist genau das, was §87 Abs. 1 Nr. 6
--     BetrVG nicht vertraegt: die Zustimmung eines Betriebsrats gilt einem
--     Betrieb, nicht einer Gruppe. Die plattformweiten Schwellen der
--     Anmeldung stehen deshalb in `plattform_einstellung` (0007) — bewusst
--     ein zweiter Namensraum.
--
--  2. **Zwei Signaturen, ein Rumpf.** Die einargumentige Form ist die
--     zweiargumentige mit `app.aktiver_mandant()`. Postgres ueberlaedt auf
--     der Argumentliste, also ist jede Signatur ein eigener `GRANT` (K-08).
--
--  3. **Die O-06-Schalter sind ZEILEN, keine Spalten von `mandant`** (K-21).
--     Ein Boolean auf `mandant` kann die Granularitaet je Einrichtung nicht
--     ausdruecken, die §87 Abs. 1 Nr. 6 BetrVG verlangt; fuenf verschiedene
--     Einrichtungen unter einem Schalter ist genau die Vermischung, die
--     04-PLANUNG-ZEIT §1.15 aufloest.
--
-- TODO(client, O-06): Gibt es einen Betriebsrat? §87 Abs. 1 Nr. 6 BetrVG
-- entscheidet, ob LEG-10 ueberhaupt ausgeliefert wird — und die Frage betrifft
-- neben der Geolokalisierung auch Geraetekennung, Geraeteabweichung,
-- Korrekturstatistik und Nicht-erschienen-Auswertung.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Die Tabelle (§6.30)
-- ---------------------------------------------------------------------------

create table mandant_einstellung (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  /**
   * Dieselbe Segmentform wie `berechtigung.schluessel`, damit der Namensraum
   * lesbar bleibt: `zeit.geolokalisierung`, `wachbuch.uebergabe_fenster`.
   */
  schluessel    text not null
                  check (schluessel ~ '^[a-z_]+(\.[a-z_]+){1,2}$'),
  /**
   * `jsonb`, nicht `text`: die Werte sind Intervalle, Zahlen, Booleans und
   * Listen. Ein `text` schoebe jede Typpruefung auf den Aufrufer, und der
   * erste, der `'false'` gegen `false` prueft, bekaeme still `true` heraus.
   */
  wert          jsonb not null,
  beschreibung  text,
  /**
   * Warum dieser Wert so steht. Bei mitbestimmungspflichtigen Schaltern
   * (LEG-10) ist die Grundlage TEIL DER ZEILE und nicht des Gedaechtnisses:
   * „O-06 beantwortet 2026-04-12", „Betriebsvereinbarung §4".
   */
  gesetzt_von_grundlage text,

  erstellt_am   timestamptz not null default now(),
  geaendert_am  timestamptz,
  erstellt_von  uuid references benutzer(id),
  geaendert_von uuid references benutzer(id),

  primary key (id),
  -- Der kanonische Lesepfad von `app.einstellung()` (K-21).
  constraint mandant_einstellung_key unique (mandant_id, schluessel),
  -- K-16: fuer zusammengesetzte Fremdschluessel spaeterer Kinder.
  constraint mandant_einstellung_mandant_id_key unique (mandant_id, id)
);

comment on table mandant_einstellung is
  'Betriebliche Stellgroessen EINER Gesellschaft als Schluessel/Wert-Zeilen '
  '(§6.30, K-21). Keine plattformweite Zeile: ein Vorgabewert darf nie '
  'unbemerkt fuer alle vier gelten.';
comment on column mandant_einstellung.gesetzt_von_grundlage is
  'Die Grundlage des Werts — bei mitbestimmungspflichtigen Schaltern (LEG-10) '
  'Teil der Zeile, nicht des Gedaechtnisses.';

-- ---------------------------------------------------------------------------
-- 2. Zeilenschutz (§6.30)
-- ---------------------------------------------------------------------------

alter table mandant_einstellung enable row level security;
alter table mandant_einstellung force  row level security;

/**
 * `system.einstellung_verwalten` und NICHT `system.schreiben` im `WITH CHECK`.
 *
 * Die K-03-Vorlage nennt `<modul>.schreiben`; fuer das Modul `system` fuehrt
 * der Katalog keinen solchen Schluessel, sondern benennt die Schreibakte
 * einzeln (`*_verwalten`). Einen nicht registrierten Schluessel hierher zu
 * schreiben waere die schlechtere Lesart derselben Konvention: `app.hat_recht`
 * antwortet auf einen unbekannten Schluessel dauerhaft `false` (K-19), die
 * Einstellung waere unschreibbar, und zwar ohne Fehlermeldung.
 */
create policy t_mandant on mandant_einstellung for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('system.einstellung_lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('system.einstellung_verwalten', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

/**
 * BEWUSST keine `t_gruppe`-Policy (K-20, §6.30).
 *
 * Eine Einstellung ist die Eigenschaft genau einer Gesellschaft; in der
 * Gruppenansicht gibt es keine. Die einargumentige `app.einstellung()` liefert
 * dort per Konstruktion NULL — das ist der DOKUMENTIERTE Wert und kein leerer
 * Bildschirm.
 */
create policy p_ma_decke on mandant_einstellung as restrictive for all to cse_app
  using (app.portal() <> 'mitarbeiter');
create policy p_kunde_decke on mandant_einstellung as restrictive for all to cse_app
  using (app.portal() <> 'kunde');

/**
 * Die Definer-Lesepolicy aus §3.5 — ohne sie liest `app.einstellung()` unter
 * `FORCE ROW LEVEL SECURITY` NICHTS.
 *
 * Und „nichts" heisst hier nicht „Fehler": die Funktion gaebe NULL zurueck,
 * jeder Aufrufer fiele auf seinen Vorgabewert zurueck, und der
 * LEG-10-Geoschalter waere fuer immer aus — was zufaellig die richtige Antwort
 * ist und trotzdem aus dem falschen Grund entstuende. Der Tag, an dem jemand
 * ihn einschaltet, waere der Tag, an dem niemand versteht, warum nichts
 * geschieht.
 */
create policy m_definer on mandant_einstellung for select to cse_definer using (true);

grant select, insert, update on mandant_einstellung to cse_app;
grant select on mandant_einstellung to cse_definer;
-- `cse_job` liest Betriebswerte in Nachtlaeufen (Nacherfassungsfenster,
-- Aufbewahrung). Geschrieben wird eine Einstellung nur von einem Menschen.
create policy t_job on mandant_einstellung for select to cse_job using (true);
grant select on mandant_einstellung to cse_job;

-- ---------------------------------------------------------------------------
-- 3. app.einstellung — zwei Signaturen, ein Rumpf (§3.2)
-- ---------------------------------------------------------------------------

/**
 * Die zweiargumentige Form ist die, die in mandantenlosen Kontexten gilt.
 *
 * Ein `BEFORE INSERT`-Ausloeser, eine `cse_job`-Policy und jede
 * K-08-Definerfunktion laufen OHNE aktiven Mandanten. Die einargumentige Form
 * loeste dort auf NULL auf, der Aufrufer fiele auf seinen Vorgabewert zurueck,
 * und die Einstellung waere in genau den Kontexten unkonfigurierbar, in denen
 * ueber sie entschieden wird. Wer den Mandanten hat, uebergibt ihn.
 */
create function app.einstellung(p_mandant uuid, p_schluessel text) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select e.wert from public.mandant_einstellung e
   where e.mandant_id = p_mandant and e.schluessel = p_schluessel;
$$;

/**
 * Die einargumentige Form — der aktive Mandant, auf die obige angewandt.
 *
 * Sie gibt NULL zurueck, wenn der Schluessel nicht gesetzt ist ODER die
 * Sitzung keinen Mandanten hat. Beide NULL sind gewollt und dokumentiert
 * (K-20), und jeder Aufrufer nennt seinen eigenen Vorgabewert.
 */
create function app.einstellung(p_schluessel text) returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
  select app.einstellung(app.aktiver_mandant(), p_schluessel);
$$;

comment on function app.einstellung(uuid, text) is
  'Betriebliche Stellgroesse einer Gesellschaft (§3.2, §6.30). Die Form fuer '
  'mandantenlose Kontexte — Ausloeser, Jobs, K-08-Definerfunktionen.';
comment on function app.einstellung(text) is
  'app.einstellung(app.aktiver_mandant(), …). NULL in jedem '
  'mandantenuebergreifenden Scope — der dokumentierte K-20-Wert.';

-- Je Signatur ein eigener Grant: Postgres ueberlaedt auf der Argumentliste,
-- und ein Grant gegen die falsche Form trifft nichts (K-08).
grant execute on function app.einstellung(uuid, text) to cse_app, cse_job;
grant execute on function app.einstellung(text)       to cse_app;

-- ---------------------------------------------------------------------------
-- 4. Die sieben O-06-Schalter, ausgeliefert auf ihrem restriktiven Wert
-- ---------------------------------------------------------------------------

/**
 * Sie sind ZEILEN und werden es fuer jede Gesellschaft — auch fuer jede, die
 * es heute noch nicht gibt.
 *
 * Der naheliegende Entwurf waere gewesen, sie gar nicht anzulegen und sich auf
 * „NULL heisst aus" zu verlassen. Das faellt zwar geschlossen, aber es macht
 * den Unterschied zwischen „nie entschieden" und „bewusst aus" unsichtbar —
 * und genau dieser Unterschied ist es, den ein Betriebsrat und eine
 * Aufsichtsbehoerde sehen wollen. Die Zeile mit `gesetzt_von_grundlage`
 * beantwortet die Frage; ein fehlender Satz beantwortet sie nicht.
 *
 * Zwei Schreiber, weil es zwei Zeitpunkte gibt: das INSERT unten fuer die
 * heute vorhandenen Gesellschaften, der Ausloeser fuer jede kuenftige.
 */
create function kern.mandant_einstellungen_vorbelegen() returns trigger
language plpgsql as $$
begin
  insert into mandant_einstellung (mandant_id, schluessel, wert, beschreibung,
                                   gesetzt_von_grundlage)
  values
    (new.id, 'zeit.geolokalisierung', 'false'::jsonb,
     'LEG-10: ein Punkt bei Beginn, einer bei Ende — nie eine Spur.',
     'O-06 offen (§87 Abs. 1 Nr. 6 BetrVG)'),
    (new.id, 'zeit.geraetekennung', 'false'::jsonb,
     'Stabile Geraetekennung statt Zufallswert je Uebermittlung.',
     'O-06 offen (§87 Abs. 1 Nr. 6 BetrVG)'),
    (new.id, 'zeit.abweichungsauswertung', 'false'::jsonb,
     'zeitabweichung_sek wird IMMER gespeichert (Invariante 5); '
     || 'ausgewertet wird sie je Person nur, wenn dieser Schalter an ist.',
     'O-06 offen (§87 Abs. 1 Nr. 6 BetrVG)'),
    (new.id, 'zeit.korrekturstatistik', 'false'::jsonb,
     'Rangliste „wer korrigiert viele Zeiten" — der Index fuer die '
     || 'Einzelauskunft besteht unabhaengig davon.',
     'O-06 offen (§87 Abs. 1 Nr. 6 BetrVG)'),
    (new.id, 'zeit.nichterschienen_auswertung', 'false'::jsonb,
     'Aggregat „nicht erschienen" je Person; erfasst wird der Wert ohnehin.',
     'O-06 offen (§87 Abs. 1 Nr. 6 BetrVG)'),
    (new.id, 'geo.erfassung_erlaubt', 'false'::jsonb,
     'Der Gegenpart in 03-GEWERKE §1.16.',
     'O-06 offen (§87 Abs. 1 Nr. 6 BetrVG)'),
    (new.id, 'wachbuch.uebergabe_fenster', '{"interval": "PT0S"}'::jsonb,
     'SEC-05: das Fenster, in dem eine Uebergabe quittiert werden kann. '
     || 'PT0S heisst: keines, bis jemand eines nennt.',
     'O-06 offen; Fenster unbestaetigt')
  on conflict (mandant_id, schluessel) do nothing;
  return null;
end $$;

create trigger trg_mandant_einstellungen_vorbelegen
  after insert on mandant
  for each row execute function kern.mandant_einstellungen_vorbelegen();

-- Und fuer die Gesellschaften, die es schon gibt. `do nothing` beim Konflikt:
-- ein bereits gesetzter Wert ist eine Entscheidung und wird nicht ueberschrieben.
insert into mandant_einstellung (mandant_id, schluessel, wert, beschreibung,
                                 gesetzt_von_grundlage)
select m.id, v.schluessel, v.wert, v.beschreibung, 'O-06 offen (§87 Abs. 1 Nr. 6 BetrVG)'
  from mandant m
  cross join (values
    ('zeit.geolokalisierung',           'false'::jsonb, 'LEG-10, gesperrt bis O-06 beantwortet ist.'),
    ('zeit.geraetekennung',             'false'::jsonb, 'Stabile Geraetekennung.'),
    ('zeit.abweichungsauswertung',      'false'::jsonb, 'Auswertung der Geraeteabweichung je Person.'),
    ('zeit.korrekturstatistik',         'false'::jsonb, 'Rangliste der Korrekturen je Benutzer.'),
    ('zeit.nichterschienen_auswertung', 'false'::jsonb, 'Aggregat „nicht erschienen" je Person.'),
    ('geo.erfassung_erlaubt',           'false'::jsonb, 'Gegenpart in 03-GEWERKE §1.16.'),
    ('wachbuch.uebergabe_fenster',      '{"interval": "PT0S"}'::jsonb, 'SEC-05-Uebergabefenster.')
  ) as v(schluessel, wert, beschreibung)
on conflict (mandant_id, schluessel) do nothing;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0033)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- mandant_einstellung (append): LEG-10, § 87 Abs. 1 Nr. 6 BetrVG. Auf diesen Zeilen steht, ob eine Ueberwachungseinrichtung eingeschaltet war und auf welcher Grundlage. Sie zu loeschen loescht den Beleg dafuer, dass die Geolokalisierung im fraglichen Zeitraum AUS war — die Auskunft, auf die es ankommt. `append`, weil eine Einstellung nie endet: ein zurueckgenommener Wert wird auf den Vorgabewert gesetzt, und audit_log traegt den Verlauf.
create trigger trg_mandant_einstellung_kein_hard_delete
  before delete on mandant_einstellung
  for each row execute function kern.verhindere_loeschung();
create trigger trg_mandant_einstellung_kein_truncate
  before truncate on mandant_einstellung
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on mandant_einstellung from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_mandant_einstellung_geaendert_am
  before update on mandant_einstellung
  for each row execute function kern.setze_geaendert_am();

create trigger trg_mandant_einstellung_audit
  after insert or update or delete on mandant_einstellung
  for each row execute function kern.protokolliere_aenderung();

-- >>> Ende des generierten Blocks
