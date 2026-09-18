import 'server-only';
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { rechteImKontext } from '../../auth/kontext-rechte.js';

/**
 * Die Sonderleistung — der einzeln beauftragte Abruf neben dem laufenden
 * Vertrag (CLN-05, OPS-06, FIN-01).
 *
 * **Zwei Dinge heissen hier fast gleich und sind es nicht.**
 * `leistungskatalog_position` ist die KATALOGZEILE (Glasreinigung, Zeitwert,
 * Einheit, Listenpreis); `sonderleistung` ist der einzelne ABRUF (wer wann was
 * beauftragt hat, Menge, Status, Nachweis). Die Seitenkarte beschreibt für
 * `/reinigung/sonderleistungen` „Katalogeinträge mit eigenen Zeitwerten" und
 * vergibt `katalog.schreiben` — welche der beiden Hälften diese Seite pflegt,
 * steht damit nicht fest, und `/leistungskatalog` (Phase 4) gibt es noch
 * nicht.
 *
 * // TODO(client, O-702): Pflegt die Seite „Sonderleistungen" die Katalogzeilen (Glas, Sonderreinigung, Warenräumung mit ihren Zeitwerten) oder die einzelnen Abrufe je Objekt — oder beides, und wer pflegt dann den Leistungskatalog?
 *
 * Solange das offen ist, liest und schreibt dieser Dienst **beide Hälften**,
 * jede hinter ihrem eigenen Recht, und die Oberfläche trennt sie sichtbar.
 *
 * ## Der Preis gehört NICHT auf die Abrufzeile
 *
 * `sonderleistung` hat keine Preisspalte, und das ist Absicht (0067): bepreist
 * wird über `auftrag_leistung.einzelpreis_cent` — der mit DIESEM Kunden
 * vereinbarte Preis, nicht der Listenpreis. Ein Preisfeld hier wäre eine
 * dritte Zahl für denselben Betrag.
 *
 * ## Der Status ist finanzwirksam, und deshalb ist er nicht frei
 *
 * `positionsquelle.ts` stempelt bei der Rechnungsübernahme `erbracht` →
 * `abgerechnet`, und `einzelabruf.ts` liest ausschliesslich `erbracht` als
 * abrechenbar. Ein frei bedienbares `setzeStatus` könnte einen bereits
 * abgerechneten Abruf zurück auf `erbracht` stellen — dann wäre er ein
 * zweites Mal abrechenbar, und nur der Sperrindex `quelle_sonderleistung_uk`
 * (0112) stünde noch dazwischen. Ein Eindeutigkeitsfehler ist die
 * schlechteste Art, eine Doppelabrechnung zu erfahren.
 *
 * Deshalb ist die Regel eine **getestete Funktion** (`statuswechsel`) und
 * keine Bedingung in einem Formular.
 */

export const SONDERLEISTUNG_STATUS = [
  'angefragt', 'beauftragt', 'geplant', 'erbracht', 'abgerechnet', 'storniert',
] as const;
export type SonderleistungStatus = (typeof SONDERLEISTUNG_STATUS)[number];

export const STATUS_TEXT: Readonly<Record<SonderleistungStatus, string>> = {
  angefragt: 'Angefragt',
  beauftragt: 'Beauftragt',
  geplant: 'Geplant',
  erbracht: 'Erbracht',
  abgerechnet: 'Abgerechnet',
  storniert: 'Storniert',
};

/**
 * Zustände, aus denen es keinen Weg zurück gibt.
 *
 * `abgerechnet`: der Abruf steht in einer festgeschriebenen Rechnung
 * (Invariante 4 — festgeschrieben ist unveränderlich, korrigiert wird durch
 * Storno der RECHNUNG). `storniert`: Invariante 8 — nicht gelöscht, also auch
 * nicht wiederbelebt; ein neuer Abruf ist ein neuer Abruf.
 */
export const ENDZUSTAENDE: readonly SonderleistungStatus[] = ['abgerechnet', 'storniert'];

/** Was ein Mensch auf dieser Seite setzen darf. */
export const PFLEGBARE_STATUS: readonly SonderleistungStatus[] = [
  'angefragt', 'beauftragt', 'geplant', 'erbracht',
];

export interface Statusbefund {
  readonly erlaubt: boolean;
  /** Warum nicht — in dem Satz, den die Oberfläche anzeigt. */
  readonly grund: string | null;
}

/**
 * Darf dieser Statuswechsel von Hand gemacht werden?
 *
 * **Es wird KEINE Reihenfolge erfunden.** 0067 legt für die sechs Werte keinen
 * gerichteten Pfad fest, und in der Praxis geht ein Abruf durchaus von
 * `geplant` zurück auf `beauftragt` (Termin abgesagt). Was diese Funktion
 * verhindert, ist genau dreierlei — und jedes davon steht woanders
 * geschrieben, nicht hier:
 *
 *  1. **Kein Weg aus einem Endzustand.** `abgerechnet` hängt an einer
 *     festgeschriebenen Rechnung, `storniert` an Invariante 8.
 *  2. **`abgerechnet` setzt niemand von Hand.** Diesen Stempel setzt die
 *     Rechnungsübernahme (`positionsquelle.ts`) und nur sie; von Hand gesetzt
 *     wäre er die Behauptung, es gäbe eine Rechnung.
 *  3. **`storniert` läuft über `storniereAbruf`.** Die Tabelle verlangt
 *     `storniert_am`, `storniert_von` und `storno_grund` gemeinsam
 *     (`sl_storno_paarweise`); ein Status ohne die drei wäre ein Storno ohne
 *     Begründung und ohne Urheber.
 */
export function statuswechsel(
  von: SonderleistungStatus, nach: SonderleistungStatus,
): Statusbefund {
  if (von === nach) {
    return { erlaubt: false, grund: `Der Abruf steht schon auf „${STATUS_TEXT[von]}".` };
  }
  if (ENDZUSTAENDE.includes(von)) {
    return {
      erlaubt: false,
      grund: von === 'abgerechnet'
        ? 'Ein abgerechneter Abruf ist unveränderlich — er steht in einer '
          + 'festgeschriebenen Rechnung. Korrigiert wird die Rechnung (Storno), '
          + 'nicht der Abruf.'
        : 'Ein stornierter Abruf wird nicht wiederbelebt. Für eine erneute '
          + 'Beauftragung entsteht ein neuer Abruf.',
    };
  }
  if (nach === 'abgerechnet') {
    return {
      erlaubt: false,
      grund: 'Den Stempel „Abgerechnet" setzt die Rechnungsübernahme und nur sie. '
        + 'Von Hand gesetzt behauptete er eine Rechnung, die es nicht gibt.',
    };
  }
  if (nach === 'storniert') {
    return {
      erlaubt: false,
      grund: 'Ein Storno braucht einen Grund und einen Urheber — es läuft über '
        + '„Abruf stornieren", nicht über den Status.',
    };
  }
  return { erlaubt: true, grund: null };
}

export class AbrufNichtGefunden extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(id: string) {
    super(`Den Abruf ${id} gibt es in dieser Gesellschaft nicht.`);
    this.name = 'AbrufNichtGefunden';
  }
}

export class StatusNichtErlaubt extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 422;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'StatusNichtErlaubt';
  }
}

export class AbrufEingabeFehlt extends Error {
  readonly code = 'ungueltige_eingabe';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'AbrufEingabeFehlt';
  }
}

/* ===========================================================================
 * Die Abrufe (`sonderleistung`) — hinter `reinigung.lesen`
 * ======================================================================== */

export interface AbrufZeile {
  readonly id: string;
  readonly bezeichnung: string;
  readonly objektId: string;
  /** `null` heisst: `objekt.lesen` fehlt — nicht „kein Objekt". */
  readonly objekt: string | null;
  readonly kundeId: string;
  /** `null` heisst: `crm.lesen` fehlt — nicht „kein Kunde". */
  readonly kunde: string | null;
  readonly revier: string | null;
  /** `null` heisst: `katalog.lesen` fehlt. */
  readonly katalogKurztext: string | null;
  readonly beauftragtAm: string;
  readonly beauftragtDurch: string | null;
  readonly ausfuehrungVon: string | null;
  readonly ausfuehrungBis: string | null;
  /** `numeric(12,3)` als Text — nie durch einen Double (Invariante 1/K-16). */
  readonly menge: string | null;
  readonly einheit: string | null;
  readonly status: SonderleistungStatus;
  readonly leistungsnachweisId: string | null;
  readonly leistungsnachweisNummer: string | null;
  readonly storniertAmLokal: string | null;
  readonly stornoGrund: string | null;
  readonly hatVertragszeile: boolean;
}

interface AbrufRoh {
  id: string;
  bezeichnung: string;
  objekt_id: string;
  objekt: string | null;
  kunde_id: string;
  kunde: string | null;
  revier: string | null;
  katalog_kurztext: string | null;
  beauftragt_am: string;
  beauftragt_durch: string | null;
  ausfuehrung_von: string | null;
  ausfuehrung_bis: string | null;
  menge: string | null;
  einheit: string | null;
  status: string;
  leistungsnachweis_id: string | null;
  leistungsnachweis_nummer: string | null;
  storniert_lokal: string | null;
  storno_grund: string | null;
  hat_vertragszeile: boolean;
}

/**
 * Jede fremdberechtigte Tabelle als LEFT JOIN.
 *
 * `objekt` (`objekt.lesen`), `kunde` (`crm.lesen`),
 * `leistungskatalog_position` (`katalog.lesen`) und `leistungsnachweis`
 * (`nachweis.lesen`) liegen alle hinter anderen Rechten als `sonderleistung`
 * (`reinigung.lesen`). Ein Innenverbund liesse die halbe Liste
 * VERSCHWINDEN — ohne Fehlermeldung, und mit dem Anschein, es gäbe keine
 * Abrufe.
 */
const ABRUF_QUELLE = `
  from sonderleistung s
  left join objekt o on o.mandant_id = s.mandant_id and o.id = s.objekt_id
  left join kunde  k on k.mandant_id = s.mandant_id and k.id = s.kunde_id
  left join revier r on r.mandant_id = s.mandant_id and r.id = s.revier_id
  left join leistungskatalog_position lkp
         on lkp.mandant_id = s.mandant_id and lkp.id = s.leistungskatalog_position_id
  left join leistungsnachweis ln
         on ln.mandant_id = s.mandant_id and ln.id = s.leistungsnachweis_id`;

const ABRUF_SPALTEN = `
  s.id, s.bezeichnung, s.objekt_id, o.bezeichnung as objekt,
  s.kunde_id, k.name as kunde, r.bezeichnung as revier,
  lkp.kurztext as katalog_kurztext,
  to_char(s.beauftragt_am, 'YYYY-MM-DD')    as beauftragt_am,
  s.beauftragt_durch,
  to_char(s.ausfuehrung_von, 'YYYY-MM-DD')  as ausfuehrung_von,
  to_char(s.ausfuehrung_bis, 'YYYY-MM-DD')  as ausfuehrung_bis,
  s.menge::text                             as menge,
  s.einheit,
  s.status::text                            as status,
  s.leistungsnachweis_id,
  ln.nummer                                 as leistungsnachweis_nummer,
  to_char(s.storniert_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                                            as storniert_lokal,
  s.storno_grund,
  (s.auftrag_leistung_id is not null)       as hat_vertragszeile`;

function alsAbruf(z: AbrufRoh): AbrufZeile {
  return {
    id: z.id,
    bezeichnung: z.bezeichnung,
    objektId: z.objekt_id,
    objekt: z.objekt,
    kundeId: z.kunde_id,
    kunde: z.kunde,
    revier: z.revier,
    katalogKurztext: z.katalog_kurztext,
    beauftragtAm: z.beauftragt_am,
    beauftragtDurch: z.beauftragt_durch,
    ausfuehrungVon: z.ausfuehrung_von,
    ausfuehrungBis: z.ausfuehrung_bis,
    menge: z.menge,
    einheit: z.einheit,
    status: SONDERLEISTUNG_STATUS.find((s) => s === z.status) ?? 'angefragt',
    leistungsnachweisId: z.leistungsnachweis_id,
    leistungsnachweisNummer: z.leistungsnachweis_nummer,
    storniertAmLokal: z.storniert_lokal,
    stornoGrund: z.storno_grund,
    hatVertragszeile: z.hat_vertragszeile,
  };
}

export interface AbrufFilter {
  readonly status?: SonderleistungStatus | null;
  readonly objektId?: string | null;
  readonly grenze?: number;
}

export async function listeAbrufe(
  kontext: LeseKontext, filter: AbrufFilter = {},
): Promise<readonly AbrufZeile[]> {
  const zeilen = await kontext.abfrage<AbrufRoh>(
    `select ${ABRUF_SPALTEN} ${ABRUF_QUELLE}
      where ($1::text is null or s.status::text = $1::text)
        and ($2::uuid is null or s.objekt_id = $2::uuid)
      order by s.beauftragt_am desc, s.bezeichnung
      limit $3::integer`,
    [filter.status ?? null, filter.objektId ?? null, filter.grenze ?? 200],
  );
  return zeilen.map(alsAbruf);
}

export async function findeAbruf(
  kontext: LeseKontext, id: string,
): Promise<AbrufZeile | null> {
  const [z] = await kontext.abfrage<AbrufRoh>(
    `select ${ABRUF_SPALTEN} ${ABRUF_QUELLE} where s.id = $1::uuid`, [id],
  );
  return z === undefined ? null : alsAbruf(z);
}

export interface AbrufEingabe {
  readonly objektId: string;
  readonly kundeId: string;
  readonly leistungskatalogPositionId: string;
  readonly bezeichnung: string;
  readonly beauftragtAm: string;
  readonly revierId?: string | null;
  /**
   * Die Vertragszeile, unter der abgerechnet wird — freiwillig beim Erfassen,
   * aber die Voraussetzung dafuer, dass der Abruf ueberhaupt in eine Rechnung
   * kommt (INNER JOIN in `finanz/abrechnungsart/einzelabruf.ts`).
   *
   * Ein Abruf entsteht oft VOR dem Nachtrag, der die Zeile schafft. Ob und bis
   * wann sich die Zuordnung nachtragen laesst, ist nicht entschieden — und
   * eine still gewaehlte Antwort hiesse, einen bereits abgerechneten Abruf
   * einer anderen Vertragszeile zuzuschlagen.
   */
  // TODO(client, O-708): Darf die Vertragszeile eines bereits erfassten Abrufs nachtraeglich zugeordnet oder geaendert werden, und ist das nach `abgerechnet` noch zulaessig?
  readonly auftragLeistungId?: string | null;
  readonly beauftragtDurch?: string | null;
  readonly ausfuehrungVon?: string | null;
  readonly ausfuehrungBis?: string | null;
  /** Dezimaltext, nie eine Gleitkommazahl. Menge und Einheit nur GEMEINSAM. */
  readonly menge?: string | null;
  readonly einheit?: string | null;
  /** Vorgabe `angefragt` — die Spaltenvorgabe, keine Erfindung. */
  readonly status?: SonderleistungStatus;
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;
const MENGE = /^\d{1,9}(?:[.,]\d{1,3})?$/u;

/**
 * Einen Abruf erfassen.
 *
 * **Die Menge bleibt ein TEXT bis in die Anweisung.** `numeric(12,3)` durch
 * einen Double geschickt und wieder ausgegeben ist der Weg, auf dem aus 0,7
 * Stunden 0,6999999999 werden — und die Menge geht in eine Rechnung
 * (Invariante 1, K-16).
 *
 * `menge` und `einheit` gehen nur zusammen: `sl_menge_paarweise` verlangt es,
 * und eine Menge ohne Einheit ist keine Menge.
 */
export async function erfasseAbruf(
  kontext: SchreibKontext, e: AbrufEingabe,
): Promise<{ readonly id: string }> {
  if (e.bezeichnung.trim() === '') {
    throw new AbrufEingabeFehlt('Ein Abruf braucht eine Bezeichnung.');
  }
  if (!DATUM.test(e.beauftragtAm)) {
    throw new AbrufEingabeFehlt('„Beauftragt am" ist ein Kalendertag.');
  }
  for (const [wert, feld] of [
    [e.ausfuehrungVon, 'Ausführung von'], [e.ausfuehrungBis, 'Ausführung bis'],
  ] as const) {
    if (wert !== undefined && wert !== null && wert !== '' && !DATUM.test(wert)) {
      throw new AbrufEingabeFehlt(`„${feld}" ist ein Kalendertag.`);
    }
  }
  const von = e.ausfuehrungVon === undefined || e.ausfuehrungVon === '' ? null : e.ausfuehrungVon;
  const bis = e.ausfuehrungBis === undefined || e.ausfuehrungBis === '' ? null : e.ausfuehrungBis;
  if (von !== null && bis !== null && bis < von) {
    throw new AbrufEingabeFehlt('Das Ausführungsende liegt vor dem Beginn.');
  }
  const mengeRoh = e.menge === undefined || e.menge === null || e.menge.trim() === ''
    ? null : e.menge.trim().replace(',', '.');
  const einheit = e.einheit === undefined || e.einheit === null || e.einheit.trim() === ''
    ? null : e.einheit.trim();
  if ((mengeRoh === null) !== (einheit === null)) {
    throw new AbrufEingabeFehlt(
      'Menge und Einheit gehören zusammen — eine Menge ohne Einheit ist keine Menge.');
  }
  if (mengeRoh !== null && !MENGE.test(mengeRoh)) {
    throw new AbrufEingabeFehlt('Die Menge ist eine Zahl mit höchstens drei Dezimalstellen.');
  }
  const status = e.status ?? 'angefragt';
  if (!PFLEGBARE_STATUS.includes(status)) {
    throw new StatusNichtErlaubt(statuswechsel('angefragt', status).grund
      ?? 'Dieser Zustand lässt sich beim Erfassen nicht setzen.');
  }

  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into sonderleistung
       (mandant_id, objekt_id, revier_id, auftrag_leistung_id,
        leistungskatalog_position_id, kunde_id, bezeichnung, beauftragt_am,
        beauftragt_durch, ausfuehrung_von, ausfuehrung_bis, menge, einheit,
        status, erstellt_von_art, erstellt_von)
     values (app.aktiver_mandant(), $1::uuid, $2::uuid, $3::uuid,
             $4::uuid, $5::uuid, $6, $7::date,
             $8, $9::date, $10::date, $11::numeric, $12,
             $13::sonderleistung_status, 'mensch', app.aktueller_benutzer())
     returning id`,
    [
      e.objektId, e.revierId ?? null, e.auftragLeistungId ?? null,
      e.leistungskatalogPositionId, e.kundeId, e.bezeichnung.trim(), e.beauftragtAm,
      e.beauftragtDurch ?? null, von, bis, mengeRoh, einheit, status,
    ],
  );
  if (zeile === undefined) {
    throw new AbrufEingabeFehlt(
      'Der Abruf wurde nicht angelegt — Objekt, Kunde, Revier oder Katalogposition '
      + 'gehört nicht zu dieser Gesellschaft, oder die Sitzung darf hier nicht schreiben.');
  }
  return { id: zeile.id };
}

/**
 * Den Status eines Abrufs setzen — mit der Sperre aus `statuswechsel`.
 *
 * Der alte Status wird `for update` gelesen: zwei gleichzeitige Klicks auf
 * „Erbracht" und die Rechnungsübernahme in derselben Sekunde sind kein
 * Sonderfall, und ohne die Sperre entschiede die Reihenfolge, ob der
 * Abrechnungsstempel überschrieben wird.
 */
export async function setzeStatus(
  kontext: SchreibKontext, e: { readonly id: string; readonly status: SonderleistungStatus },
): Promise<{ readonly von: SonderleistungStatus; readonly nach: SonderleistungStatus }> {
  const [vorher] = await kontext.schreibe<{ status: string }>(
    `select status::text as status from sonderleistung where id = $1::uuid for update`,
    [e.id],
  );
  if (vorher === undefined) throw new AbrufNichtGefunden(e.id);
  const von = SONDERLEISTUNG_STATUS.find((s) => s === vorher.status) ?? 'angefragt';
  const befund = statuswechsel(von, e.status);
  if (!befund.erlaubt) throw new StatusNichtErlaubt(befund.grund ?? 'Nicht erlaubt.');

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update sonderleistung
        set status = $2::sonderleistung_status
      where id = $1::uuid and status::text = $3
     returning id`,
    [e.id, e.status, von],
  );
  if (zeilen.length === 0) throw new AbrufNichtGefunden(e.id);
  return { von, nach: e.status };
}

/**
 * Einen Abruf stornieren — **nie löschen** (Invariante 8, `loeschsperre`
 * steht auf `true`).
 *
 * Die drei Stornofelder gehen gemeinsam (`sl_storno_paarweise`), der Zeitpunkt
 * kommt vom Auslöser `kern.sonderleistung_zeitstempel` und damit von der
 * SERVERUHR (Invariante 5) — `now()` steht hier nur, damit die Spalte nicht
 * NULL ist.
 */
export async function storniereAbruf(
  kontext: SchreibKontext, e: { readonly id: string; readonly grund: string },
): Promise<void> {
  if (e.grund.trim() === '') {
    throw new AbrufEingabeFehlt('Ein Storno braucht einen Grund.');
  }
  const [vorher] = await kontext.schreibe<{ status: string; storniert: boolean }>(
    `select status::text as status, (storniert_am is not null) as storniert
       from sonderleistung where id = $1::uuid for update`,
    [e.id],
  );
  if (vorher === undefined) throw new AbrufNichtGefunden(e.id);
  if (vorher.storniert) {
    throw new StatusNichtErlaubt('Dieser Abruf ist bereits storniert.');
  }
  if (vorher.status === 'abgerechnet') {
    throw new StatusNichtErlaubt(
      'Ein abgerechneter Abruf lässt sich nicht stornieren — er steht in einer '
      + 'festgeschriebenen Rechnung. Korrigiert wird durch Storno der Rechnung '
      + '(Invariante 4).');
  }
  await kontext.schreibe(
    `update sonderleistung
        set status = 'storniert', storniert_am = now(),
            storniert_von = app.aktueller_benutzer(), storno_grund = $2
      where id = $1::uuid and storniert_am is null`,
    [e.id, e.grund.trim()],
  );
}

/* ===========================================================================
 * Die Katalogzeilen (`leistungskatalog_position`) — hinter `katalog.lesen`
 * ======================================================================== */

export interface KatalogZeile {
  readonly id: string;
  readonly oz: string;
  readonly kurztext: string;
  readonly langtext: string | null;
  readonly einheit: string;
  /** `numeric(10,3)` als Text — der Zeitwert je Einheit. */
  readonly zeitwertMinuten: string | null;
  readonly leistungswert: string | null;
  /** Ganzzahltext in CENT. Nie ein `number` (Invariante 1). */
  readonly standardEinzelpreisCent: string | null;
  readonly istPlatzhalter: boolean;
  readonly gueltigAb: string;
  readonly gueltigBis: string | null;
  /** Wie oft diese Zeile von einem Abruf benutzt wird. */
  readonly abrufe: number;
}

export interface KatalogAusschnitt {
  readonly zeilen: readonly KatalogZeile[];
  /** `false` heisst: `katalog.lesen` fehlt — nicht „leerer Katalog". */
  readonly geprueft: boolean;
}

/**
 * Die Katalogzeilen, sofern die Sitzung `katalog.lesen` hält.
 *
 * **Diese Route hält das Recht nicht zwingend.** Sie ist lesend auf
 * `reinigung.lesen` bewacht; `leistungskatalog_position` liegt hinter
 * `katalog.lesen`. Deshalb fragt der Dienst das Recht selbst und gibt
 * `geprueft: false` zurück — eine leere Liste ohne diese Auskunft läse sich
 * als „es gibt keine Katalogzeilen für Sonderleistungen", und das ist eine
 * andere Aussage.
 */
export async function ladeKatalogzeilen(
  kontext: LeseKontext,
): Promise<KatalogAusschnitt> {
  const rechte = await rechteImKontext(kontext, 'katalog.lesen');
  if (rechte['katalog.lesen'] !== true) return { zeilen: [], geprueft: false };
  const zeilen = await kontext.abfrage<{
    id: string; oz: string; kurztext: string; langtext: string | null;
    einheit: string; zeitwert: string | null; leistungswert: string | null;
    preis: string | null; ist_platzhalter: boolean;
    gueltig_ab: string; gueltig_bis: string | null; abrufe: string;
  }>(
    `select lkp.id, lkp.oz, lkp.kurztext, lkp.langtext, lkp.einheit,
            lkp.zeitwert_minuten::text            as zeitwert,
            lkp.leistungswert_qm_pro_stunde::text as leistungswert,
            lkp.standard_einzelpreis_cent::text   as preis,
            lkp.ist_platzhalter,
            to_char(lkp.gueltig_ab, 'YYYY-MM-DD')  as gueltig_ab,
            to_char(lkp.gueltig_bis, 'YYYY-MM-DD') as gueltig_bis,
            (select count(*) from sonderleistung s
              where s.leistungskatalog_position_id = lkp.id)::text as abrufe
       from leistungskatalog_position lkp
      where lkp.gueltig_bis is null
      order by lkp.sortierung, lkp.oz, lkp.kurztext
      limit 300`,
  );
  return {
    geprueft: true,
    zeilen: zeilen.map((z) => ({
      id: z.id,
      oz: z.oz,
      kurztext: z.kurztext,
      langtext: z.langtext,
      einheit: z.einheit,
      zeitwertMinuten: z.zeitwert,
      leistungswert: z.leistungswert,
      standardEinzelpreisCent: z.preis,
      istPlatzhalter: z.ist_platzhalter,
      gueltigAb: z.gueltig_ab,
      gueltigBis: z.gueltig_bis,
      abrufe: Number(z.abrufe),
    })),
  };
}

export interface ZeitwertEingabe {
  readonly id: string;
  /** Dezimaltext in MINUTEN je Einheit, oder `null`. */
  readonly zeitwertMinuten: string | null;
  readonly einheit?: string | null;
  /**
   * Ist der Wert jetzt bestätigt?
   *
   * `ist_platzhalter` von `true` auf `false` zu setzen ist die eigentliche
   * Aussage dieser Seite: jemand hat den Zeitwert für Glas, Sonderreinigung
   * oder Warenräumung bestätigt. Automatisch aus „es steht eine Zahl drin"
   * abzuleiten wäre falsch — eine Zahl steht auch im Platzhalter.
   */
  readonly istPlatzhalter?: boolean;
}

const ZEITWERT = /^\d{1,7}(?:[.,]\d{1,3})?$/u;

/**
 * Den Zeitwert einer Katalogzeile pflegen — hinter `katalog.schreiben`.
 *
 * **Der PREIS wird hier nicht angefasst.** `standard_einzelpreis_cent` ist ein
 * Betrag, er geht in Angebote und Rechnungen, und die Seite, die den
 * Leistungskatalog pflegt (`/leistungskatalog`, Phase 4), gibt es noch nicht.
 * Ihn hier nebenbei mitzupflegen hiesse, zwei Seiten dieselbe Preisspalte
 * schreiben zu lassen, bevor entschieden ist, welche sie besitzt (O-702).
 */
export async function setzeZeitwert(
  kontext: SchreibKontext, e: ZeitwertEingabe,
): Promise<void> {
  const wert = e.zeitwertMinuten === null || e.zeitwertMinuten.trim() === ''
    ? null : e.zeitwertMinuten.trim().replace(',', '.');
  if (wert !== null && !ZEITWERT.test(wert)) {
    throw new AbrufEingabeFehlt(
      'Der Zeitwert ist eine Zahl in Minuten mit höchstens drei Dezimalstellen.');
  }
  if (wert !== null && Number(wert) <= 0) {
    throw new AbrufEingabeFehlt('Der Zeitwert ist grösser als null (lkp_zeitwert_positiv).');
  }
  const einheit = e.einheit === undefined || e.einheit === null || e.einheit.trim() === ''
    ? null : e.einheit.trim();

  const zeilen = await kontext.schreibe<{ id: string }>(
    `update leistungskatalog_position
        set zeitwert_minuten = $2::numeric,
            einheit          = coalesce($3, einheit),
            ist_platzhalter  = coalesce($4::boolean, ist_platzhalter)
      where id = $1::uuid
     returning id`,
    [e.id, wert, einheit, e.istPlatzhalter ?? null],
  );
  if (zeilen.length === 0) {
    throw new AbrufNichtGefunden(e.id);
  }
}

/* ===========================================================================
 * Die Auswahllisten des Erfassungsformulars
 * ======================================================================== */

export interface AbrufAuswahl {
  readonly objekte: readonly {
    readonly id: string; readonly bezeichnung: string;
    readonly kundeId: string | null; readonly kunde: string | null;
  }[];
  readonly reviere: readonly {
    readonly id: string; readonly bezeichnung: string; readonly objektId: string;
  }[];
  readonly katalog: readonly {
    readonly id: string; readonly oz: string; readonly kurztext: string;
    readonly einheit: string; readonly istPlatzhalter: boolean;
  }[];
  /**
   * Die lebenden Vertragszeilen — **ohne sie ist ein Abruf nicht abrechenbar.**
   *
   * `ladeAbrufe` in der Rechnungsuebernahme verbindet `sonderleistung` per
   * INNER JOIN mit `auftrag_leistung`
   * (`finanz/abrechnungsart/einzelabruf.ts`); ein Abruf ohne
   * `auftrag_leistung_id` faellt dort lautlos heraus und ist damit tote
   * Arbeit. Deshalb bietet das Formular die Zeilen an, statt den Fehler
   * hinterher zu melden.
   *
   * `objektId` ist NULLABLE: eine Rahmenzeile ohne Objektbezug gilt fuer den
   * ganzen Auftrag. Sie gehoert deshalb in die Auswahl, nur in eine eigene
   * Gruppe — sie wegzulassen hiesse, genau die Zeilen zu verstecken, unter
   * denen ein Abruf ueblicherweise laeuft.
   */
  readonly vertragszeilen: readonly {
    readonly id: string; readonly auftragNummer: string; readonly positionNr: number;
    readonly bezeichnung: string; readonly einheit: string | null;
    readonly objektId: string | null;
  }[];
  readonly geprueft: Readonly<Record<string, boolean>>;
}

/**
 * Was das Formular zur Auswahl braucht — und was davon geprüft werden konnte.
 *
 * Ein Abruf verlangt `objekt_id`, `kunde_id` und
 * `leistungskatalog_position_id` als NOT NULL. Die drei Tabellen liegen hinter
 * `objekt.lesen`, `crm.lesen` und `katalog.lesen`. Fehlt eines, ist die
 * betreffende Liste leer — und dann sagt die Seite, dass ein Recht fehlt,
 * statt ein Formular zu zeigen, das beim Absenden scheitert.
 */
export async function ladeAbrufAuswahl(kontext: LeseKontext): Promise<AbrufAuswahl> {
  const geprueft = await rechteImKontext(
    kontext, 'objekt.lesen', 'crm.lesen', 'katalog.lesen', 'auftrag.lesen',
  );
  const objekte = geprueft['objekt.lesen'] === true
    ? await kontext.abfrage<{
      id: string; bezeichnung: string; kundeId: string | null; kunde: string | null;
    }>(
      `select o.id, o.bezeichnung, o.kunde_id as "kundeId", k.name as kunde
         from objekt o
         left join kunde k on k.mandant_id = o.mandant_id and k.id = o.kunde_id
        where o.archiviert_am is null
        order by o.bezeichnung
        limit 300`,
    )
    : [];
  /* `revier` liegt hinter `reinigung.lesen` — dem Recht dieser Route. Hier
     braucht es deshalb keine Bedingung; eine leere Liste heisst hier wirklich
     „kein Revier angelegt". */
  const reviere = await kontext.abfrage<{
    id: string; bezeichnung: string; objektId: string;
  }>(
    `select r.id, r.bezeichnung, r.objekt_id as "objektId"
       from revier r where r.archiviert_am is null
      order by r.bezeichnung limit 300`,
  );
  const katalog = geprueft['katalog.lesen'] === true
    ? await kontext.abfrage<{
      id: string; oz: string; kurztext: string; einheit: string; istPlatzhalter: boolean;
    }>(
      `select id, oz, kurztext, einheit, ist_platzhalter as "istPlatzhalter"
         from leistungskatalog_position
        where gueltig_bis is null
        order by sortierung, oz limit 300`,
    )
    : [];
  /*
   * `auftrag_leistung` liegt hinter `auftrag.lesen` (pg_policies: t_mandant),
   * diese Route haelt `reinigung.lesen`. Ohne das Recht filtert RLS still —
   * eine leere Auswahl hiesse dann „dieser Auftrag hat keine Zeilen", und der
   * Bedienende legte weiter Abrufe an, die niemand abrechnen kann. Deshalb
   * traegt `geprueft` das Recht mit, und die Seite sagt „nicht geprueft".
   */
  const vertragszeilen = geprueft['auftrag.lesen'] === true
    ? await kontext.abfrage<{
      id: string; auftragNummer: string; positionNr: number;
      bezeichnung: string; einheit: string | null; objektId: string | null;
    }>(
      `select al.id,
              a.auftragsnummer             as "auftragNummer",
              al.position_nr::int          as "positionNr",
              al.bezeichnung,
              al.einheit,
              al.objekt_id                 as "objektId"
         from auftrag_leistung al
         join auftrag a on a.mandant_id = al.mandant_id and a.id = al.auftrag_id
        where al.gueltig_bis is null
        order by a.auftragsnummer, al.position_nr
        limit 500`,
    )
    : [];
  return { objekte, reviere, katalog, vertragszeilen, geprueft };
}
