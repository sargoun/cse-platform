/**
 * Die Herkunft einer Rechnungszeile (FIN-07, FIN-18, TIM-12, CRM-05).
 *
 * `05-FINANZEN.md` §4.4, §5.6 Schritt 6. Drei Zusagen, und jede hat hier genau
 * eine Stelle:
 *
 *  1. **Jede Leistungszeile nennt ihren Beleg.** Erzwungen wird das von der
 *     Datenbank (`rp_hat_quelle`, 0088), nicht von diesem Dienst — ein
 *     zweiter Schreibweg, der die Pruefung vergisst, ist damit nicht moeglich.
 *     Dieser Dienst ist der bequeme Weg, nicht der einzige.
 *
 *  2. **Eine Stunde wird einmal abgerechnet.** Der Anspruch ist der partielle
 *     Unique-Index `quelle_zeiteintrag_uk`; `zeiteintrag.abgerechnet_am` ist
 *     sein SPIEGEL auf der Quellseite und beantwortet dieselbe Frage ohne
 *     Join. Geschrieben wird der Spiegel von `markiereQuellenAbgerechnet()`
 *     in der Festschreibungstransaktion — beide existieren, keiner ersetzt den
 *     anderen (§4.4).
 *
 *  3. **Ein Aufmass wird anteilig abgerechnet.** Kein Unique-Index, sondern
 *     eine aufgeschobene Summe ueber `menge_anteil` (§ 16 VOB/B, review B11).
 *
 * **Gerechnet wird hier nichts, was nicht gerechnet werden muss.** Der
 * Cent-Betrag einer Quelle ist eine VERTEILUNG des Zeilenbetrags und keine
 * eigene Multiplikation: `verteileAufQuellen` gibt Restbetraege weiter, statt
 * jede Quelle einzeln zu runden. Zweihundert einzeln gerundete Zeiteintraege
 * ergaeben sonst eine Summe, die die Rechnungszeile um Cents verfehlt — und
 * DSH-04 verspricht, dass jede Zahl auf die Saetze dahinter fuehrt.
 */
import { cent, type Cent } from './geld.js';
import { mengeAusPostgres, mengeNachPostgres, type MilliMenge } from './menge.js';

/** Derselbe schmale Treiberausschnitt, den jeder Dienst hier benutzt. */
export interface Abfrage {
  abfrage<T>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

/**
 * Der Diskriminator aus §4.4 — dieselben sieben Werte wie der Enum `quelle_typ`
 * in `0088`. FIN-07 nennt die ersten vier woertlich.
 */
export type QuelleTyp =
  | 'zeiteintrag' | 'aufmass' | 'vertrag' | 'material'
  | 'leistungsnachweis' | 'nachtrag' | 'manuell';

export class QuellenFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund:
      | 'ohne_quelle'
      | 'quelle_fehlt'
      | 'schon_abgerechnet'
      | 'anteil_fehlt'
      | 'nicht_uebernommen',
  ) {
    super(nachricht);
    this.name = 'QuellenFehler';
  }
}

/**
 * Eine Quellangabe, wie sie ein Aufrufer schreibt.
 *
 * `id` ist der Schluessel der Quelle — welcher, sagt `typ`. Die Zuordnung
 * Typ → Spalte steht an EINER Stelle (`SPALTE_JE_TYP`), damit ein neuer Typ
 * eine Zeile ist und keine Suche durch den Dienst.
 */
export interface QuelleEingabe {
  readonly typ: QuelleTyp;
  /** NULL genau dann, wenn `typ === 'manuell'`. */
  readonly id?: string | null;
  /** Die aus der Quelle entnommene Menge. Pflicht fuer `aufmass` (§4.4). */
  readonly mengeAnteil?: MilliMenge | null;
  /** Pflicht fuer `manuell` — die Begruendung einer beleglosen Zeile. */
  readonly notiz?: string | null;
}

/**
 * Typ → typisierte Fremdschluesselspalte (§4.4).
 *
 * `vertrag` zeigt auf `auftrag_leistung`, `material` auf `ausgabe`. Die zwei
 * Namen gehen auseinander, weil der Diskriminator die FACHLICHE Herkunft nennt
 * und die Spalte die Tabelle — und beide Vokabulare gehoeren jemand anderem.
 */
const SPALTE_JE_TYP: Readonly<Record<Exclude<QuelleTyp, 'manuell'>, string>> = {
  zeiteintrag: 'zeiteintrag_id',
  aufmass: 'aufmass_id',
  vertrag: 'auftrag_leistung_id',
  material: 'ausgabe_id',
  leistungsnachweis: 'leistungsnachweis_id',
  nachtrag: 'nachtrag_id',
};

const SPALTEN: readonly string[] = [
  'zeiteintrag_id', 'aufmass_id', 'auftrag_leistung_id', 'ausgabe_id',
  'leistungsnachweis_id', 'nachtrag_id',
];

/**
 * Eine Herkunftszeile schreiben.
 *
 * `rechnung_id` wird NICHT uebergeben: sie steht denormalisiert auf der Zeile
 * (§4.4, damit „ist diese Stunde abgerechnet?" ohne Join auskommt) und wird
 * deshalb aus der Position gelesen. Ein Aufrufer, der sie mitgaebe, koennte
 * sie falsch mitgeben — der Ausloeser `trg_rpq_1_elternzeile` weist das zwar
 * ab, aber eine Angabe, die nur richtig sein kann, gehoert nicht in eine
 * Signatur.
 */
export async function fuegeQuelleHinzu(
  db: Abfrage, positionId: string, eingabe: QuelleEingabe,
): Promise<string> {
  if (eingabe.typ === 'manuell') {
    if ((eingabe.notiz ?? '').trim().length < 3) {
      throw new QuellenFehler(
        'Eine von Hand getippte Zeile braucht eine Begruendung — „manuell" allein ist keine.',
        'ohne_quelle',
      );
    }
  } else if ((eingabe.id ?? '') === '') {
    throw new QuellenFehler(
      `Quelle „${eingabe.typ}" ohne Schluessel — der Beleg fehlt.`, 'quelle_fehlt',
    );
  }
  if (eingabe.typ === 'aufmass' && (eingabe.mengeAnteil ?? null) === null) {
    throw new QuellenFehler(
      'Ein Aufmass wird anteilig abgerechnet (§ 16 VOB/B) — `mengeAnteil` ist Pflicht.',
      'anteil_fehlt',
    );
  }

  const spalte = eingabe.typ === 'manuell' ? null : SPALTE_JE_TYP[eingabe.typ];
  const werte = SPALTEN.map((s) => (s === spalte ? (eingabe.id ?? null) : null));

  const [zeile] = await db.abfrage<{ id: string }>(
    `insert into rechnungsposition_quelle
       (mandant_id, rechnungsposition_id, rechnung_id, quelle_typ,
        zeiteintrag_id, aufmass_id, auftrag_leistung_id, ausgabe_id,
        leistungsnachweis_id, nachtrag_id, menge_anteil, notiz,
        erstellt_von_art, erstellt_von)
     select app.aktiver_mandant(), p.id, p.rechnung_id, $2::quelle_typ,
            $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
            $9::numeric, $10, 'mensch', app.aktueller_benutzer()
       from rechnungsposition p
      where p.id = $1
     returning id`,
    [positionId, eingabe.typ, ...werte,
     eingabe.mengeAnteil == null ? null : mengeNachPostgres(eingabe.mengeAnteil),
     eingabe.notiz ?? null],
  );
  if (zeile === undefined) {
    throw new QuellenFehler(
      `Position ${positionId} nicht gefunden — die Herkunft wurde nicht geschrieben.`,
      'quelle_fehlt',
    );
  }
  return zeile.id;
}

// ---------------------------------------------------------------------------
// Die Verteilung — „auf den Cent" (Abnahme 2, DSH-04)
// ---------------------------------------------------------------------------

/**
 * Den Zeilenbetrag auf seine Quellen verteilen, OHNE einen Cent zu verlieren.
 *
 * Groesster-Rest-Verfahren: jede Quelle bekommt den abgerundeten Anteil, und
 * die verbleibenden Cents gehen an die Quellen mit dem groessten Rest —
 * `ties` nach Reihenfolge. Die Summe ist damit **exakt** der Zeilenbetrag,
 * nicht „ungefaehr".
 *
 * Warum nicht jede Quelle einzeln rechnen: 187 Minuten × 42,50 €/h gerundet,
 * dreimal, ergibt nicht denselben Betrag wie 494 Minuten × 42,50 €/h gerundet.
 * Der Unterschied sind ein bis zwei Cent — genug, damit die Detailansicht
 * einer Rechnungszeile ihrer eigenen Summe widerspricht, und genau das
 * verspricht DSH-04 nicht zu tun.
 *
 * Gewichte duerfen negativ sein (Storno, Rueckbauzeile). Ist die Summe der
 * Gewichte null, faellt alles auf die erste Quelle — anders liesse sich der
 * Betrag nicht verteilen, und ihn zu verschweigen waere schlimmer.
 */
export function verteileAufQuellen(
  netto: Cent, gewichte: readonly bigint[],
): readonly Cent[] {
  if (gewichte.length === 0) return [];
  if (gewichte.length === 1) return [netto];

  let summe = gewichte.reduce((a, b) => a + b, 0n);
  if (summe === 0n) {
    // Kein Gewicht laesst sich verteilen. Den Betrag dann zu verschweigen
    // waere schlimmer als ihn ganz der ersten Quelle zuzuschreiben — und die
    // Anzeige sagt daneben, dass kein Anteil hinterlegt ist.
    return gewichte.map((_, i) => cent(i === 0 ? netto : 0n));
  }

  /**
   * Auf eine POSITIVE Summe normiert. `netto·g/summe` aendert sich nicht,
   * wenn Zaehlergewicht und Nenner zugleich das Vorzeichen wechseln — und nur
   * mit positivem Nenner ist „der groesste Rest" ueberhaupt eine wohldefinierte
   * Ordnung.
   */
  const normiert = summe < 0n ? gewichte.map((g) => -g) : [...gewichte];
  if (summe < 0n) summe = -summe;

  /** Abrunden Richtung minus Unendlich — damit jeder Rest in [0, summe) liegt. */
  const abrunden = (zaehler: bigint): bigint => {
    const q = zaehler / summe;
    return zaehler % summe !== 0n && zaehler < 0n ? q - 1n : q;
  };

  const basis = normiert.map((g) => abrunden(netto * g));
  const reste = normiert.map((g, i) => netto * g - (basis[i] ?? 0n) * summe);

  /**
   * Der Nachschlag: groesster Rest zuerst, bei Gleichstand die frueheste
   * Quelle. Deterministisch, weil zwei Ausgaben derselben Rechnung sonst zwei
   * verschiedene Aufteilungen zeigten. Es sind hoechstens `n − 1` Cents.
   */
  const ordnung = reste
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : (b.r > a.r ? 1 : -1)));

  let fehlend = netto - basis.reduce((a, b) => a + b, 0n);
  for (const { i } of ordnung) {
    if (fehlend <= 0n) break;
    basis[i] = (basis[i] ?? 0n) + 1n;
    fehlend -= 1n;
  }

  const verteilt = basis.reduce((a, b) => a + b, 0n);
  if (verteilt !== netto) {
    throw new QuellenFehler(
      `Die Verteilung ergab ${String(verteilt)} statt ${String(netto)} Cent.`,
      'nicht_uebernommen',
    );
  }
  return basis.map((b) => cent(b));
}

// ---------------------------------------------------------------------------
// Lesen — der Weg von der Zeile zum Beleg (Abnahme 2, DSH-04)
// ---------------------------------------------------------------------------

export interface QuelleZeile {
  readonly id: string;
  readonly positionId: string;
  readonly positionNr: number;
  readonly typ: QuelleTyp;
  readonly quelleId: string | null;
  readonly mengeAnteil: string | null;
  readonly notiz: string | null;
  readonly wirksam: boolean;
  /** Was ein Mensch liest — „Schicht 16.08. 22:00–06:00", „Aufmass AM-0007". */
  readonly bezeichnung: string;
  /**
   * Der Pfad UNTER `/portal/[mandant]`, ohne fuehrenden Schraegstrich; NULL,
   * wo es (noch) keine Seite gibt. Er wird HIER gebildet und nicht in der
   * Seite: dieselbe Zeile fuehrt aus der Rechnung, aus dem Bericht und aus
   * dem Kundenexport an dieselbe Stelle, und drei Kopien eines Pfades driften.
   */
  readonly ziel: string | null;
  /** Der auf diese Quelle entfallende Anteil des Zeilenbetrags (Cent). */
  readonly anteilCent: Cent;
}

interface QuelleRoh {
  readonly id: string;
  readonly rechnungsposition_id: string;
  readonly position_nr: number;
  readonly quelle_typ: QuelleTyp;
  readonly quelle_id: string | null;
  readonly menge_anteil: string | null;
  readonly notiz: string | null;
  readonly wirksam: boolean;
  readonly netto_cent: string | null;
  readonly bezeichnung: string | null;
  readonly ziel: string | null;
}

/**
 * Alles, was hinter den Zeilen einer Rechnung steht — mit Beschriftung und
 * Ziel, fertig zum Anzeigen.
 *
 * Ein `left join` je Quellart und kein `union`: die Quellarten haben nichts
 * gemeinsam ausser dem Schluessel, und ein `union` ueber sechs Tabellen mit
 * je eigener Beschriftung waere sechsmal dieselbe Projektion.
 */
export async function ladeQuellen(
  db: Abfrage, rechnungId: string,
): Promise<readonly QuelleZeile[]> {
  const roh = await db.abfrage<QuelleRoh>(
    `select q.id, q.rechnungsposition_id, p.position_nr,
            q.quelle_typ::text as quelle_typ,
            coalesce(q.zeiteintrag_id, q.aufmass_id, q.auftrag_leistung_id, q.ausgabe_id,
                     q.leistungsnachweis_id, q.nachtrag_id)::text as quelle_id,
            q.menge_anteil::text, q.notiz, q.wirksam, p.netto_cent::text,
            case q.quelle_typ
              when 'zeiteintrag' then
                coalesce('Schicht ' || to_char(z.beginn_zeitpunkt at time zone 'Europe/Berlin',
                                               'DD.MM.YYYY HH24:MI'), 'Zeiteintrag')
              when 'aufmass' then coalesce('Aufmaß ' || a.nummer, 'Aufmaß')
              when 'vertrag' then coalesce(al.bezeichnung, 'Vertragsposition')
              when 'leistungsnachweis' then coalesce('Leistungsnachweis ' || ln.nummer,
                                                     'Leistungsnachweis')
              when 'nachtrag' then coalesce('Nachtrag ' || n.nummer, 'Nachtrag')
              when 'material' then 'Ausgabe'
              else coalesce(q.notiz, 'Von Hand erfasst')
            end as bezeichnung,
            case q.quelle_typ
              when 'zeiteintrag' then 'zeiten/' || z.id::text
              when 'aufmass' then 'bau/projekte/' || a.projekt_id::text
                                || '/aufmass/' || a.id::text
              when 'vertrag' then 'auftraege/' || al.auftrag_id::text
              when 'nachtrag' then 'bau/projekte/' || n.projekt_id::text
                                || '/nachtraege/' || n.id::text
              when 'leistungsnachweis' then 'reinigung/leistungsnachweise'
              else null
            end as ziel
       from rechnungsposition_quelle q
       join rechnungsposition p
         on p.mandant_id = q.mandant_id and p.id = q.rechnungsposition_id
       left join zeiteintrag z on z.mandant_id = q.mandant_id and z.id = q.zeiteintrag_id
       left join aufmass a on a.mandant_id = q.mandant_id and a.id = q.aufmass_id
       left join auftrag_leistung al
         on al.mandant_id = q.mandant_id and al.id = q.auftrag_leistung_id
       left join leistungsnachweis ln
         on ln.mandant_id = q.mandant_id and ln.id = q.leistungsnachweis_id
       left join nachtrag n on n.mandant_id = q.mandant_id and n.id = q.nachtrag_id
      where q.rechnung_id = $1
      order by p.position_nr, q.quelle_typ, q.erstellt_am, q.id`,
    [rechnungId],
  );

  /**
   * Die Verteilung laeuft JE POSITION, nicht ueber die ganze Rechnung: der
   * Betrag, der aufgehen muss, ist der der Zeile (Abnahme 2).
   */
  const jePosition = new Map<string, QuelleRoh[]>();
  for (const r of roh) {
    const liste = jePosition.get(r.rechnungsposition_id) ?? [];
    liste.push(r);
    jePosition.set(r.rechnungsposition_id, liste);
  }

  const ergebnis: QuelleZeile[] = [];
  for (const [, liste] of jePosition) {
    const netto = cent(BigInt(liste[0]?.netto_cent ?? '0'));
    /**
     * Ohne `menge_anteil` gibt es kein Gewicht — dann wird gleichmaessig
     * verteilt. Das ist ehrlicher als eine erfundene Gewichtung: „die ganze
     * Quelle" heisst genau, dass niemand einen Anteil genannt hat.
     */
    const gewichte = liste.map((r) =>
      r.menge_anteil === null
        ? (1_000n as bigint)
        // `mengeAusPostgres` und nicht selbst geparst: die eine Umkehrung von
        // `numeric(12,3)` steht in `menge.ts` (K-16), und eine zweite hier
        // waere die, die den vierten Dezimalplatz still wegrundet.
        : (mengeAusPostgres(r.menge_anteil) as bigint));
    const anteile = verteileAufQuellen(netto, gewichte);
    liste.forEach((r, i) => {
      ergebnis.push({
        id: r.id,
        positionId: r.rechnungsposition_id,
        positionNr: Number(r.position_nr),
        typ: r.quelle_typ,
        quelleId: r.quelle_id,
        mengeAnteil: r.menge_anteil,
        notiz: r.notiz,
        wirksam: r.wirksam,
        bezeichnung: r.bezeichnung ?? 'Beleg',
        ziel: r.ziel,
        anteilCent: anteile[i] ?? cent(0n),
      });
    });
  }
  return ergebnis.sort((a, b) => a.positionNr - b.positionNr);
}

// ---------------------------------------------------------------------------
// §5.6 Schritt 6 — der Spiegel auf der Quellseite
// ---------------------------------------------------------------------------

/**
 * `zeiteintrag.abgerechnet_am` und `.abrechnung_referenz` setzen — **in der
 * Festschreibungstransaktion**, nicht in einem Nachlauf (§5.6 Schritt 6).
 *
 * In einem Nachlauf gaebe es festgeschriebene Rechnungen, deren Stunden noch
 * als offen gelten; der naechste Abrechnungslauf nimmt sie ein zweites Mal
 * auf, und der Unique-Index — der dann greift — meldet einen Fehler an einer
 * Stelle, an der niemand nach der Ursache sucht.
 *
 * **Die Zeit kommt aus der Datenbank** (`now()`), nie aus dem Prozess
 * (Invariante 5, `cse/no-client-clock`).
 *
 * Die Zahl der getroffenen Zeilen wird geprueft. Unter FORCE RLS trifft ein
 * UPDATE ohne passende Policy NULL Zeilen — geraeuschlos —, und genau dieser
 * Ausfall liesse die Doppelabrechnungssperre halb offen.
 */
export async function markiereQuellenAbgerechnet(
  db: Abfrage, rechnungId: string,
): Promise<number> {
  const [soll] = await db.abfrage<{ n: string }>(
    `select count(*)::text as n
       from rechnungsposition_quelle q
       join zeiteintrag z on z.mandant_id = q.mandant_id and z.id = q.zeiteintrag_id
      where q.rechnung_id = $1 and q.quelle_typ = 'zeiteintrag' and q.wirksam
        and z.abgerechnet_am is null`,
    [rechnungId],
  );

  const getroffen = await db.abfrage<{ id: string }>(
    `update zeiteintrag z
        set abgerechnet_am = now(), abrechnung_referenz = q.rechnungsposition_id
       from rechnungsposition_quelle q
      where q.rechnung_id = $1 and q.quelle_typ = 'zeiteintrag' and q.wirksam
        and z.mandant_id = q.mandant_id and z.id = q.zeiteintrag_id
        and z.abgerechnet_am is null
      returning z.id`,
    [rechnungId],
  );

  if (getroffen.length !== Number(soll?.n ?? '0')) {
    throw new QuellenFehler(
      `Der Abrechnungsstempel traf ${String(getroffen.length)} von ${soll?.n ?? '0'} `
      + 'Zeiteintraegen — ohne ihn steht die Doppelabrechnungssperre nur halb.',
      'nicht_uebernommen',
    );
  }
  return getroffen.length;
}

/**
 * Die Gegenrichtung: der Storno gibt die Quellen wieder frei (§4.4).
 *
 * `wirksam` faellt auf `false` — die Zeile bleibt stehen (Invariante 8), der
 * partielle Unique-Index laesst die Quelle wieder zu, und der aufgeschobene
 * Aufmass-Ausloeser schreibt die aufgelaufene Menge zurueck. Der Spiegel auf
 * `zeiteintrag` wird im selben Zug geloescht; bliebe er stehen, waere die
 * Stunde nach dem Storno immer noch „abgerechnet" und tauchte in keiner
 * Arbeitsliste mehr auf.
 */
export async function gibQuellenFrei(db: Abfrage, rechnungId: string): Promise<number> {
  await db.abfrage(
    `update zeiteintrag z
        set abgerechnet_am = null, abrechnung_referenz = null
       from rechnungsposition_quelle q
      where q.rechnung_id = $1 and q.quelle_typ = 'zeiteintrag' and q.wirksam
        and z.mandant_id = q.mandant_id and z.id = q.zeiteintrag_id
        and z.abgerechnet_am is not null`,
    [rechnungId],
  );
  const zeilen = await db.abfrage<{ id: string }>(
    `update rechnungsposition_quelle set wirksam = false
      where rechnung_id = $1 and wirksam
      returning id`,
    [rechnungId],
  );
  return zeilen.length;
}

// ---------------------------------------------------------------------------
// FIN-18 — der abgeschlossene Auftrag ohne eine einzige erfasste Minute
// ---------------------------------------------------------------------------

export interface Fin18Befund {
  readonly auftragId: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly erfassteMinuten: number;
}

/**
 * Der Fehler, der die Festschreibung anhaelt — **bevor eine Nummer gezogen
 * wird** (Abnahme 3).
 *
 * Danach waere er wertlos: die Nummer ist gezogen, der Zaehler steht weiter,
 * und der einzige Weg zurueck waere ein Storno auf einen Beleg, den niemand
 * ausstellen wollte.
 */
export class Fin18Fehler extends Error {
  constructor(readonly befund: Fin18Befund) {
    super(
      `Auftrag ${befund.auftragsnummer} („${befund.bezeichnung}") ist abgeschlossen, `
      + 'aber es ist keine einzige Minute erfasst (FIN-18). '
      + 'Festschreiben nur mit protokollierter Begründung.',
    );
    this.name = 'Fin18Fehler';
  }
}

/**
 * FIN-18: „Warnung — abgeschlossener Auftrag ohne erfasste Zeit, vor der
 * Rechnungsstellung."
 *
 * Gefragt wird `fin.auftrag_erfasste_minuten()` und nicht die Sicht
 * `zeiteintrag_auftrag`: die laeuft mit `security_invoker` (0051), und eine
 * Buchhaltung ohne `zeit.lesen` bekaeme dort null Minuten — die Warnung
 * schluege dann bei JEDEM Auftrag an. Eine Warnung, die immer kommt, wird nach
 * dem dritten Mal ungelesen weggeklickt, und dann ist die eine echte auch weg.
 *
 * Die Funktion gibt eine ZAHL zurueck, keine Zeile: die Buchhaltung erfaehrt,
 * DASS Zeit erfasst wurde, nicht von wem (EMP-13).
 *
 * `null` heisst: nichts zu melden — keine Auftragsbindung, der Auftrag laeuft
 * noch, oder es sind Minuten erfasst.
 */
export async function pruefeZeiterfassung(
  db: Abfrage, rechnungId: string,
): Promise<Fin18Befund | null> {
  const [auftrag] = await db.abfrage<{
    id: string; auftragsnummer: string; bezeichnung: string;
  }>(
    `select a.id::text as id, a.auftragsnummer, a.bezeichnung
       from rechnung r
       join auftrag a on a.mandant_id = r.mandant_id and a.id = r.auftrag_id
      where r.id = $1
        /**
         * **Ein Storno wird nie an FIN-18 gehindert.**
         *
         * Er hebt einen Beleg auf, der schon draussen ist. Ihn zu blockieren,
         * weil auf dem Auftrag keine Zeit erfasst ist, sperrte genau den
         * Vorgang, mit dem man eine zu Unrecht gestellte Rechnung wieder
         * loswird — und die Warnung traefe den, der den Fehler behebt, statt
         * den, der ihn gemacht hat.
         */
        and r.rechnungsart <> 'storno'
        and (a.status = 'abgeschlossen' or a.abgeschlossen_am is not null)`,
    [rechnungId],
  );
  if (auftrag === undefined) return null;

  const [zeile] = await db.abfrage<{ minuten: string }>(
    `select fin.auftrag_erfasste_minuten($1::uuid)::text as minuten`, [auftrag.id],
  );
  const minuten = Number(zeile?.minuten ?? '0');
  if (minuten > 0) return null;

  return {
    auftragId: auftrag.id,
    auftragsnummer: auftrag.auftragsnummer,
    bezeichnung: auftrag.bezeichnung,
    erfassteMinuten: minuten,
  };
}

/**
 * Das Uebergehen — und sein Protokoll.
 *
 * Es gibt keinen Weg an FIN-18 vorbei, der keine Spur hinterlaesst. Die
 * Begruendung steht zweimal: im `audit_log` (wer, wann, warum) und im
 * Pflichtfeldbericht, der mit `rechnung_snapshot` unveraenderlich wird
 * (§5.1). Ein Vermerk, den man spaeter noch aendern kann, ist keiner.
 */
export async function protokolliereFin18Uebergehung(
  db: Abfrage, rechnungId: string, befund: Fin18Befund, begruendung: string,
): Promise<void> {
  await db.abfrage(
    `select app.protokolliere('rechnung.fin18_uebergangen', 'rechnung', $1,
                              null, ($2::text)::jsonb, app.aktiver_mandant())`,
    [rechnungId, JSON.stringify({
      auftrag_id: befund.auftragId,
      auftragsnummer: befund.auftragsnummer,
      erfasste_minuten: befund.erfassteMinuten,
      begruendung,
    })],
  );
}

export const FIN18_BEGRUENDUNG_MINDESTLAENGE = 10;
