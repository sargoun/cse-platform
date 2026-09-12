-- ===========================================================================
-- 0065 — revier_raum: die Zuordnung Raumbuch → Revier und ihre Sollzeit
--        (CLN-01, CLN-05, OPS-02, OPS-03, OPS-07)
--
-- Vertrag: `docs/architecture/02-datenmodell/03-GEWERKE.md` §5.2, §2.1, §12.
-- Wo dieser Text und eine Konvention (K-nn) auseinandergehen, gilt die
-- Konvention.
--
-- 0029 hat `revier` angelegt und die Raeume bewusst ausgelassen: die
-- Zuordnung ist die Eingabe der Kalkulation aus OPS-07, und ohne ihren Dienst
-- waere sie eine Tabelle mit einer Spalte, die niemand fuellen kann. Der
-- Dienst existiert jetzt (`src/server/services/reinigung/sollzeit.ts`), also
-- entsteht die Zuordnung hier.
--
--   revier_raum  Welcher Raum des Raumbuchs zu welchem Revier gehoert, in
--                welcher Laufreihenfolge, mit welcher BERECHNETEN Sollzeit
--                und mit den Schnappschuessen der Groessen, aus denen sie
--                entstanden ist (§5.2).
--
-- Drei Stellen, an denen hier bewusst NICHT das Naheliegende steht:
--
--  1. **`sollzeit_minuten` ist `numeric(8,2)`, nicht `integer`** — die
--     K-16(c)-Abweichung, die K-16 namentlich erlaubt und die schon auf
--     `revier.sollzeit_minuten` steht (0029). Beide Traeger fuehren DIESELBE
--     Groesse auf DERSELBEN Skala, damit die OPS-07-Rechnung zwischen ihnen
--     nicht zweimal rundet. Jede GEMESSENE Dauer der Plattform bleibt
--     `integer`, weil sie Beweismittel ist (§1.1).
--
--  2. **Die Schnappschussspalten werden NIE automatisch aufgefrischt.**
--     `flaeche_qm`, `fenster_flaeche_qm` und `leistungswert_qm_pro_stunde`
--     stehen so da, wie sie zum Kalkulationszeitpunkt galten. Ein Ausloeser,
--     der sie dem Raumbuch nachzoege, machte jede abgegebene Kalkulation
--     unnachrechenbar — und zwar rueckwirkend und lautlos. Neu geschrieben
--     werden sie ausschliesslich durch den Kalkulationsdienst.
--
--  3. **Keine Aufbewahrungsspalten.** §1.14 vergibt `aufbewahrung_bis` und
--     `loeschsperre` an die BEWEISFUEHRENDEN Tabellen dieser Domaene; §5.2
--     fuehrt sie in seiner Spaltenliste nicht. Die Zuordnung eines Raums zu
--     einer Zone ist Stammdatenpflege, kein Beleg.
--
-- Ausserdem holt diese Migration eine Zusage aus §2.1 ein, die `raum` selbst
-- schuldig geblieben ist: den objektbezogenen Eindeutigkeitsschluessel, ohne
-- den der zusammengesetzte Fremdschluessel unten gar nicht uebersetzt.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Was `raum` als Elternteil schuldet (§2.1)
-- ---------------------------------------------------------------------------

/**
 * `unique (mandant_id, objekt_id, id)` auf `raum` — VERLANGT von §2.1.
 *
 * `raum` traegt bisher nur `unique (mandant_id, id)` (0021). Der Schluessel
 * von `revier_raum` auf den Raum ist aber DREISPALTIG, und das aus einem
 * Grund, den ein zweispaltiger nicht erfuellt: er soll nicht nur „derselbe
 * Mandant" zusichern, sondern „dasselbe Objekt". Ohne ihn liesse sich ein
 * Raum aus Gebaeude A in ein Revier von Gebaeude B haengen — beide Zeilen
 * fuer sich stimmig, RLS zufrieden, und die Flaeche wandert im Angebot in das
 * falsche Objekt.
 *
 * Die Einschraenkung ist rein additiv: `(mandant_id, id)` ist bereits
 * eindeutig, also kann `(mandant_id, objekt_id, id)` keine bestehende Zeile
 * abweisen.
 */
alter table raum add constraint raum_objekt_uk unique (mandant_id, objekt_id, id);

-- ---------------------------------------------------------------------------
-- 2. revier_raum (§5.2)
-- ---------------------------------------------------------------------------

/**
 * Der Raum in seiner Zone — die Zeile, die aus OPS-02-Stammdaten eine
 * CLN-01-Arbeitsmenge macht.
 *
 * Sie traegt `objekt_id` DENORMALISIERT neben `revier_id`, und das ist keine
 * Bequemlichkeit: nur so kann der Raumschluessel objektbezogen sein (siehe
 * oben). Dass beide zum selben Objekt gehoeren, sichern die zwei
 * zusammengesetzten Schluessel gemeinsam — `revier_raum → revier` traegt den
 * Mandanten, `revier_raum → raum` traegt Mandant UND Objekt, und `revier`
 * selbst haengt an genau einem Objekt (0029).
 */
create table revier_raum (
  id            uuid not null default gen_random_uuid(),
  mandant_id    uuid not null references mandant(id),

  revier_id     uuid not null,
  -- Denormalisiert, damit der Raumschluessel objektbezogen sein kann (§5.2).
  objekt_id     uuid not null,
  raum_id       uuid not null,

  -- Die Laufreihenfolge im Revier — die Liste, die auf dem Telefon steht.
  reihenfolge   smallint not null default 0,

  /**
   * Die BERECHNETE Zielzeit dieses Raums, `numeric(8,2)` — K-16(c), wie auf
   * `revier.sollzeit_minuten` (0029) und auf derselben Skala.
   *
   * Geschrieben wird sie vom Kalkulationsdienst (OPS-07), NIE von der
   * Datenbank: die Rechnung `Σ m² ÷ Leistungswert` hat genau eine
   * Rundungsstelle, und die steht in `src/server/services/kalkulation/
   * richtzeit.ts`. Eine zweite, generierte Spalte hier waere die zweite
   * Rundung, die K-16(c) gerade verhindern soll.
   *
   * NULL heisst „noch nicht kalkuliert", nicht „null Minuten".
   */
  sollzeit_minuten numeric(8,2), -- nicht-geld: Minuten je Durchgang

  /**
   * Der Leistungswert, wie er zur Kalkulationszeit galt — in m² je Stunde.
   *
   * SCHNAPPSCHUSS (§5.2). Der Katalogwert selbst ist zeitversioniert
   * (`belagsart.gueltig_ab/bis`, 0021); hier steht, mit welchem gerechnet
   * wurde. Ohne diese Spalte liesse sich eine abgegebene Kalkulation nach der
   * naechsten Katalogpflege nicht mehr nachrechnen.
   */
  leistungswert_qm_pro_stunde numeric(10,3), -- nicht-geld: m² je Stunde
  -- Schnappschuss der Raumflaeche zur Kalkulationszeit.
  flaeche_qm    numeric(12,3),
  -- Schnappschuss der Glasflaeche: CLN-05 bepreist Glas auf Glasflaeche.
  fenster_flaeche_qm numeric(12,3),

  bemerkung     text,

  -- Auditblock (§1.2)
  erstellt_am       timestamptz not null default now(),
  erstellt_von_art  akteur_art not null default 'mensch',
  erstellt_von      uuid references benutzer(id),
  erstellt_von_person_id uuid references person(id),
  erstellt_von_agent_id  uuid,
  geaendert_am      timestamptz,
  geaendert_von_art akteur_art,
  geaendert_von     uuid references benutzer(id),

  primary key (id),
  /**
   * BEIDE Eindeutigkeiten, und beide werden als Schluesselziel gebraucht
   * (§5.2): `(mandant_id, id)` fuer den gewoehnlichen Mandantenschluessel,
   * `(mandant_id, revier_id, id)` fuer den Schluessel aus
   * `qualitaetspruefung_position` (0068), der zusaetzlich das Revier bindet.
   * Der Entwurf hatte beide ausgelassen, und der spaetere Schluessel haette
   * nicht uebersetzt.
   */
  constraint revier_raum_mandant_uk unique (mandant_id, id),
  constraint revier_raum_revier_uk  unique (mandant_id, revier_id, id),

  constraint revier_raum_revier_fk foreign key (mandant_id, revier_id)
    references revier (mandant_id, id),
  constraint revier_raum_objekt_fk foreign key (mandant_id, objekt_id)
    references objekt (mandant_id, id),
  constraint revier_raum_raum_fk foreign key (mandant_id, objekt_id, raum_id)
    references raum (mandant_id, objekt_id, id),

  -- Eine physikalische Schranke, keine Geschaeftsregel: ein Raum, der null
  -- Minuten kostet, ist keiner. Negativ waere ein Rechenfehler.
  constraint revier_raum_sollzeit_positiv check (
    sollzeit_minuten is null or sollzeit_minuten > 0),
  constraint revier_raum_leistungswert_positiv check (
    leistungswert_qm_pro_stunde is null or leistungswert_qm_pro_stunde > 0),
  constraint revier_raum_flaeche_nicht_negativ check (
    flaeche_qm is null or flaeche_qm >= 0),
  constraint revier_raum_fenster_nicht_negativ check (
    fenster_flaeche_qm is null or fenster_flaeche_qm >= 0),
  constraint revier_raum_akteur_stimmig check (
       (erstellt_von_art = 'mensch' and erstellt_von is not null and erstellt_von_agent_id is null)
    or (erstellt_von_art = 'agent'  and erstellt_von_agent_id is not null)
    or (erstellt_von_art = 'system' and erstellt_von is null and erstellt_von_agent_id is null))
);

/**
 * Ein Raum haengt in einem Revier hoechstens EINMAL.
 *
 * UNPARTIELL, obwohl `revier_raum` keine Lebendigkeitsspalte traegt: die
 * Zuordnung wird geloest, indem die Zeile verschwindet — und weil sie unter
 * Loeschsperre steht, heisst „verschwindet" hier: es gibt keinen Weg dahin.
 * Wer eine Zone neu zuschneidet, archiviert das Revier (0029) und legt ein
 * neues an; die alte Zuordnung bleibt als Rechenweg der alten Kalkulation
 * stehen.
 *
 * Dass ein Raum in ZWEI Revieren steht, ist damit nicht verboten — und das
 * ist Absicht: Unterhaltsreinigung und Glasreinigung sind zwei Reviere ueber
 * derselben Flaeche (CLN-05). Verboten ist nur die doppelte Zeile im selben
 * Revier, die die Flaeche zweimal in dieselbe Rechnung traegt.
 */
create unique index revier_raum_uk on revier_raum (revier_id, raum_id);

-- „Welche Reviere enthalten diesen Raum?" — Raumbuchdetail und die Pruefung
-- auf Doppelzuordnung.
create index revier_raum_raum_idx on revier_raum (mandant_id, raum_id);
-- Die Lauflinie fuer die Anwendung.
create index revier_raum_reihenfolge_idx on revier_raum (revier_id, reihenfolge);

comment on table revier_raum is
  'Zuordnung eines Raumbuchraums zu einem Revier (§5.2), mit berechneter '
  'Sollzeit und den Schnappschuessen, aus denen sie entstanden ist.';
comment on column revier_raum.sollzeit_minuten is
  'BERECHNETE Zielzeit dieses Raums, numeric(8,2) — K-16(c), dieselbe Skala '
  'wie revier.sollzeit_minuten, damit zwischen beiden nie zweimal gerundet '
  'wird. Keine gemessene Dauer; die waere integer.';
comment on column revier_raum.leistungswert_qm_pro_stunde is
  'SCHNAPPSCHUSS des Belagsart-Leistungswerts zur Kalkulationszeit (OPS-03). '
  'Wird nie automatisch aufgefrischt — sonst waere eine abgegebene '
  'Kalkulation nach der naechsten Katalogpflege nicht mehr nachrechenbar.';

-- ---------------------------------------------------------------------------
-- 3. Zusammengesetzte Fremdschluessel dieser Migration (§12)
-- ---------------------------------------------------------------------------

/**
 * Vollstaendig, damit der Schema-Test aus §12 sie findet:
 *
 *   revier_raum (mandant_id, revier_id)            → revier (mandant_id, id)
 *   revier_raum (mandant_id, objekt_id)            → objekt (mandant_id, id)
 *   revier_raum (mandant_id, objekt_id, raum_id)   → raum   (mandant_id, objekt_id, id)
 *
 * Keiner ist einspaltig. Ein einspaltiger Schluessel in eine Tabelle mit
 * `mandant_id` liesse ein Kind entstehen, das zu einem anderen Mandanten
 * gehoert als sein Elternteil — und RLS faende daran nichts auszusetzen, weil
 * beide Zeilen fuer sich stimmig sind (§1.4).
 */

-- ---------------------------------------------------------------------------
-- 4. Ausloeser
-- ---------------------------------------------------------------------------

/**
 * Keiner, der hier stuende — ausser den beiden generierten unten.
 *
 * `revier_raum` hat keine Lebendigkeitsspalte, also nichts zu stempeln, und
 * keine Feldzeit, also keine Abweichung abzuleiten. `geaendert_am` und die
 * Loeschsperre kommen aus dem Register (`src/server/db/schema/rls.ts`), damit
 * sie an EINER Stelle stehen und nicht in jeder Migration neu erfunden werden.
 */

-- ---------------------------------------------------------------------------
-- 5. Zeilenschutz (§1.6, §1.8)
-- ---------------------------------------------------------------------------

alter table revier_raum enable row level security;
alter table revier_raum force  row level security;

create policy t_mandant on revier_raum for all to cse_app
  using      (mandant_id = app.aktiver_mandant()
              and (select app.hat_recht('reinigung.lesen', app.aktiver_mandant())))
  with check (mandant_id = app.aktiver_mandant()
              and not app.ist_readonly()
              and (select app.hat_recht('reinigung.schreiben', app.aktiver_mandant()))
              and exists (select 1 from mandant m
                           where m.id = mandant_id and m.archiviert_am is null));

create policy t_gruppe on revier_raum for select to cse_app
  using (app.ist_gruppenansicht()
         and mandant_id = any (app.rechte_mandanten('gruppe.reinigung.lesen')));

/**
 * Die Decke aus §1.8 — `p_intern_decke`, in diesem Baum seit 0021 so
 * geschrieben, RESTRICTIVE und mit demselben Koerper wie auf `revier` (0029).
 *
 * Warum die Zuordnung weder dem Kunden- noch dem Mitarbeiterportal
 * offensteht: `sollzeit_minuten` und `leistungswert_qm_pro_stunde` sind die
 * Kalkulationsgrundlage. Im Kundenportal sagen sie, mit wie viel Zeit wir
 * gerechnet haben — Verhandlungsstoff gegen uns. Im Mitarbeiterportal sind
 * sie eine Leistungsvorgabe je Raum und je Person, und die waere nach §87
 * Abs. 1 Nr. 6 BetrVG mitbestimmungspflichtig, bevor sie jemand zu sehen
 * bekommt. Die Reinigungskraft sieht ihre SCHICHT (`einsatz`, 0028), nicht
 * den Zeitansatz dahinter.
 */
create policy p_intern_decke on revier_raum as restrictive for all to cse_app
  using (app.portal() = 'intern');

/**
 * Der naechtliche Lauf liest — und schreibt nicht.
 *
 * `FORCE ROW LEVEL SECURITY` gilt auch fuer `cse_job`: ohne Policy liest er
 * null Zeilen, und zwar OHNE Fehler. Ein Revier ohne Raeume saehe dann aus
 * wie eine Zone, die niemand kalkuliert hat.
 */
create policy t_job on revier_raum for select to cse_job using (true);

grant select, insert, update on revier_raum to cse_app;
grant select on revier_raum to cse_job;

-- <<< generiert aus src/server/db/schema/rls.ts — nicht von Hand ändern (0065)
-- Erzeugt von scripts/generate-triggers.ts. `pnpm db:triggers` schreibt neu.

-- revier_raum (append): CLN-01, OPS-07. Die Zeile IST der Rechenweg einer Kalkulation: Flaeche, Leistungswert und die daraus gewonnene Sollzeit, alle drei als Schnappschuss vom Kalkulationszeitpunkt. Geloescht laesst sich ein abgegebenes Angebot nicht mehr nachrechnen, und die Zusage "Σ revier_raum.sollzeit = revier.sollzeit" waere ohne Vorwarnung falsch. Eine neu zugeschnittene Zone entsteht als NEUES Revier; das alte bekommt archiviert_am.
create trigger trg_revier_raum_kein_hard_delete
  before delete on revier_raum
  for each row execute function kern.verhindere_loeschung();
create trigger trg_revier_raum_kein_truncate
  before truncate on revier_raum
  for each statement execute function kern.verhindere_loeschung();
revoke delete, truncate on revier_raum from cse_app, cse_anon, cse_checkin, cse_job;

create trigger trg_revier_raum_geaendert_am
  before update on revier_raum
  for each row execute function kern.setze_geaendert_am();


-- >>> Ende des generierten Blocks
