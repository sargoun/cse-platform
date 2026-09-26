/**
 * Das Stundenkonto (EMP-04, EMP-15; 01-KERN §6.24/§6.25, 04-PLANUNG-ZEIT §12.2).
 *
 * **Ein Stundenkonto ist eine Buchungsreihe, kein Saldo.** Jede Minute auf dem
 * Konto hat eine Zeile mit Herkunft, Datum und Grund; `ist_minuten` ist deren
 * Summe und wird von genau einem Ausloeser geschrieben (`bewegung_summe`,
 * 0060). Dieser Dienst fuehrt deshalb keinen Saldo mit — er bucht, und rechnet
 * beim Lesen. Wo eine gefuehrte Zahl noetig ist, ist sie GEFUEHRT und wird
 * gegen das Journal gehalten (`pruefeAbgleich`, naechtlich); still korrigiert
 * wird nie, weil eine Abweichung, die verschwindet, keine Auskunft mehr gibt.
 *
 * **Es fliesst nur Freigegebenes.** `bucheFreigegebeneZeiten` filtert
 * `freigegeben_am is not null` (§7.3, EMP-04). Ohne diesen Filter liefen
 * ungeprueft erfasste Zeiten in den Lohn — und die Freigabe waere ein
 * Bildschirm ohne Wirkung.
 *
 * **Der Monatsabschluss ist einseitig.** Was gesperrt ist, wird nicht neu
 * gerechnet. Eine spaetere Korrektur erscheint als Ausgleichsbuchung im ERSTEN
 * OFFENEN Monat, mit `korrektur_fuer_stundenkonto_id` auf den gesperrten
 * (§12.2) — nie rueckwirkend. Der bequeme Gegenentwurf waere, den Monat
 * aufzumachen und neu zu rechnen; danach zeigte die Plattform andere Zahlen
 * als der Nachweis, den der Mensch in der Hand haelt, und beide saehen richtig
 * aus.
 *
 * **Die kombinierte Zahl (EMP-15) wird gerechnet, nie gespeichert.**
 * `kombiniereKonten` ist eine reine Funktion ueber die Konten EINES Menschen.
 * Eine gespeicherte Summe ueber zwei Gesellschaften waere eine dritte Wahrheit
 * neben zwei Lohnkonten — und die erste, die bei einer Korrektur veraltet.
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { berlinKalendertag, ZeitFehler } from './dauer.js';
import { praegeNachweis } from './milog.js';
import { monatsErster, verteilePauseAufAnteile } from './monatsanteil.js';

export type KontoStatus = 'offen' | 'vorlaeufig' | 'gesperrt';

export type BewegungArt =
  | 'arbeitszeit' | 'abwesenheit' | 'feiertag' | 'korrektur'
  | 'uebertrag' | 'auszahlung' | 'freizeitausgleich';

export type BewegungQuelle = 'zeiteintrag' | 'abwesenheit' | 'manuell' | 'import' | 'system';

export interface Stundenkonto {
  readonly id: string;
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly jahr: number;
  readonly monat: number;
  /** 0 heisst „nicht hinterlegt" (O-18), nicht „nichts geschuldet". */
  readonly sollMinuten: number;
  readonly istMinuten: number;
  readonly korrekturMinuten: number;
  readonly saldoVortragMinuten: number;
  readonly saldoMinuten: number;
  readonly status: KontoStatus;
  readonly gesperrtAm: Date | null;
}

export interface Bewegung {
  readonly id: string;
  readonly stundenkontoId: string;
  readonly art: BewegungArt;
  readonly minuten: number;
  /** Der BERLINER Kalendertag, `JJJJ-MM-TT`. */
  readonly wirksamAm: string;
  readonly quelle: BewegungQuelle;
  readonly zeiteintragId: string | null;
  readonly begruendung: string | null;
  readonly korrekturFuerStundenkontoId: string | null;
  readonly erstelltAm: Date;
}

/** Ein Monat ist zu, und das ist keine Fehlbedienung, sondern die Regel. */
export class MonatGesperrtFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(jahr: number, monat: number) {
    super(`Der Monat ${String(monat)}/${String(jahr)} ist abgeschlossen (EMP-04).`);
    this.name = 'MonatGesperrtFehler';
  }
}

export class KontoFehltFehler extends Error {
  readonly code = 'nicht_gefunden';
  readonly status = 404;
  constructor(jahr: number, monat: number) {
    super(`Fuer ${String(monat)}/${String(jahr)} gibt es kein Stundenkonto.`);
    this.name = 'KontoFehltFehler';
  }
}

/**
 * Es gibt keinen offenen Monat, in den die Differenz laufen koennte.
 *
 * Der Dienst legt dann KEINEN an. Welcher Monat als naechster aufgemacht wird,
 * entscheidet der Rollover (`job:konten_rollover`) — ein Korrekturlauf, der
 * sich selbst einen Monat anlegt, verschoebe die Differenz in einen Zeitraum,
 * den niemand geplant hat.
 */
export class KeinOffenerMonatFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(anstellungId: string) {
    super(`Beschaeftigung ${anstellungId} hat keinen offenen Monat fuer die Ausgleichsbuchung.`);
    this.name = 'KeinOffenerMonatFehler';
  }
}

/**
 * Der Monat traegt Zeiten, die niemand freigegeben hat.
 *
 * Sperren waere hier der stille Fehler: gebucht wird nur Freigegebenes, und in
 * einen gesperrten Monat laesst sich nicht nachbuchen. Die Minuten waeren aus
 * dem Lohnmonat verschwunden — ohne Fehler, ohne Meldung, mit einer plausiblen
 * Zahl auf dem Nachweis.
 */
export class UnfreigegebeneZeitenFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(readonly anzahl: number, jahr: number, monat: number) {
    super(
      `${String(anzahl)} Zeiteintraege in ${String(monat)}/${String(jahr)} sind nicht `
      + 'freigegeben. Ein gesperrter Monat nimmt sie nicht mehr auf.',
    );
    this.name = 'UnfreigegebeneZeitenFehler';
  }
}

// ---------------------------------------------------------------------------
// Reine Rechnung
// ---------------------------------------------------------------------------

/**
 * Der Saldo — dieselbe Formel wie die GENERATED-Spalte, absichtlich zweimal.
 *
 * Die Spalte rechnet in der Datenbank, diese Funktion in der Anwendung, und
 * ein Test haelt beide gegeneinander. Wo zwei Umsetzungen dasselbe sagen, ist
 * es die Regel und nicht ein Zufall der einen.
 */
export function saldoMinuten(
  saldoVortragMinuten: number, istMinuten: number, sollMinuten: number,
): number {
  return saldoVortragMinuten + istMinuten - sollMinuten;
}

export interface KombinierteStunden {
  readonly sollMinuten: number;
  readonly istMinuten: number;
  readonly saldoMinuten: number;
  /** Die einzelnen Konten bleiben getrennt — EMP-15 verlangt beides. */
  readonly konten: readonly Stundenkonto[];
}

/**
 * Die Zahl ueber alle Beschaeftigungen EINES Menschen in EINEM Monat (EMP-15).
 *
 * Gerechnet, nicht gespeichert — und die Einzelkonten bleiben im Ergebnis
 * stehen. Der Mensch sieht seine Gesamtstunden, sein Arbeitgeber sieht sein
 * Konto, und niemand sieht eine Summe, die keinem Arbeitsverhaeltnis gehoert.
 */
export function kombiniereKonten(konten: readonly Stundenkonto[]): KombinierteStunden {
  const monate = new Set(konten.map((k) => `${String(k.jahr)}-${String(k.monat)}`));
  if (monate.size > 1) {
    // Sonst summierte die Anzeige zwei Monate zu einer Zahl, die es nicht gibt.
    throw new ZeitFehler(`Kombiniert wird EIN Monat, nicht ${String(monate.size)}.`);
  }
  return {
    sollMinuten: konten.reduce((s, k) => s + k.sollMinuten, 0),
    istMinuten: konten.reduce((s, k) => s + k.istMinuten, 0),
    saldoMinuten: konten.reduce((s, k) => s + k.saldoMinuten, 0),
    konten,
  };
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

interface KontoZeile {
  id: string; mandant_id: string; anstellung_id: string;
  jahr: number; monat: number;
  soll_minuten: number; ist_minuten: number; korrektur_minuten: number;
  saldo_vortrag_minuten: number; saldo_minuten: number;
  status: KontoStatus; gesperrt_am: Date | null;
}

function alsKonto(z: KontoZeile): Stundenkonto {
  return {
    id: z.id,
    mandantId: z.mandant_id,
    anstellungId: z.anstellung_id,
    jahr: Number(z.jahr),
    monat: Number(z.monat),
    sollMinuten: Number(z.soll_minuten),
    istMinuten: Number(z.ist_minuten),
    korrekturMinuten: Number(z.korrektur_minuten),
    saldoVortragMinuten: Number(z.saldo_vortrag_minuten),
    saldoMinuten: Number(z.saldo_minuten),
    status: z.status,
    gesperrtAm: z.gesperrt_am,
  };
}

const KONTO_SPALTEN =
  `id, mandant_id, anstellung_id, jahr, monat, soll_minuten, ist_minuten,
   korrektur_minuten, saldo_vortrag_minuten, saldo_minuten, status, gesperrt_am`;

export interface KontoFilter {
  readonly anstellungId?: string;
  readonly personId?: string;
  readonly jahr?: number;
  readonly monat?: number;
  /**
   * Nur die Konten DIESER Gesellschaft (V-073).
   *
   * Für den nächtlichen Abgleich, der unter `cse_job` läuft: dort greift
   * `t_job … using (true)` (0060), die RLS grenzt also NICHT ein. Ein
   * `je_mandant`-Lauf ohne diesen Filter meldete in jedem Durchgang die
   * Abweichungen aller Gesellschaften — N-mal dieselbe, und jede unter dem
   * falschen Namen.
   */
  readonly mandantId?: string;
}

/**
 * Die Konten — durch die RLS des Aufrufers.
 *
 * `personId` geht ueber `anstellung`, weil das Konto die Beschaeftigung kennt
 * und nicht den Menschen (D-09). In der Personenansicht liefert derselbe
 * Aufruf beide Gesellschaften; in der Mandantenansicht nur die eine, und genau
 * das ist der Unterschied, den K-18 beschreibt.
 */
export async function leseKonten(
  kontext: LeseKontext, filter: KontoFilter = {},
): Promise<readonly Stundenkonto[]> {
  const werte: unknown[] = [];
  const wo: string[] = [];
  if (filter.anstellungId !== undefined) {
    werte.push(filter.anstellungId);
    wo.push(`k.anstellung_id = $${String(werte.length)}`);
  }
  if (filter.personId !== undefined) {
    werte.push(filter.personId);
    wo.push(`exists (select 1 from anstellung a
                      where a.id = k.anstellung_id and a.person_id = $${String(werte.length)})`);
  }
  if (filter.jahr !== undefined) {
    werte.push(filter.jahr);
    wo.push(`k.jahr = $${String(werte.length)}`);
  }
  if (filter.monat !== undefined) {
    werte.push(filter.monat);
    wo.push(`k.monat = $${String(werte.length)}`);
  }
  const zeilen = await kontext.abfrage<KontoZeile>(
    `select ${KONTO_SPALTEN} from stundenkonto k
      ${wo.length === 0 ? '' : `where ${wo.join(' and ')}`}
      order by k.jahr asc, k.monat asc, k.anstellung_id asc`,
    werte,
  );
  return zeilen.map(alsKonto);
}

/** Der Kontoauszug — die Buchungen, aus denen die Zahl entstanden ist. */
export async function leseBewegungen(
  kontext: LeseKontext, stundenkontoId: string,
): Promise<readonly Bewegung[]> {
  const zeilen = await kontext.abfrage<{
    id: string; stundenkonto_id: string; art: BewegungArt; minuten: number;
    wirksam_am: Date | string; quelle: BewegungQuelle; zeiteintrag_id: string | null;
    begruendung: string | null; korrektur_fuer_stundenkonto_id: string | null;
    erstellt_am: Date;
  }>(
    `select id, stundenkonto_id, art, minuten, wirksam_am, quelle, zeiteintrag_id,
            begruendung, korrektur_fuer_stundenkonto_id, erstellt_am
       from stundenkonto_bewegung
      where stundenkonto_id = $1
      order by wirksam_am asc, erstellt_am asc`,
    [stundenkontoId],
  );
  return zeilen.map((z) => ({
    id: z.id,
    stundenkontoId: z.stundenkonto_id,
    art: z.art,
    minuten: Number(z.minuten),
    wirksamAm: typeof z.wirksam_am === 'string'
      ? z.wirksam_am.slice(0, 10)
      : berlinKalendertag(z.wirksam_am),
    quelle: z.quelle,
    zeiteintragId: z.zeiteintrag_id,
    begruendung: z.begruendung,
    korrekturFuerStundenkontoId: z.korrektur_fuer_stundenkonto_id,
    erstelltAm: z.erstellt_am,
  }));
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

export interface KontoEroeffnung {
  readonly anstellungId: string;
  readonly jahr: number;
  readonly monat: number;
  /**
   * Die Sollzeit dieses Monats, falls hinterlegt. Ohne Angabe bleibt sie 0 —
   * „nicht hinterlegt" (O-18). Hergeleitet wird sie NICHT: siehe
   * `sollstunden.ts`.
   */
  readonly sollMinuten?: number;
  /** Der Vortrag aus dem Vormonat. Setzt `job:konten_rollover` beim Sperren. */
  readonly saldoVortragMinuten?: number;
}

/**
 * Legt das Konto eines Monats an — idempotent.
 *
 * Ein zweiter Aufruf erzeugt kein zweites Konto. Die Eindeutigkeit
 * `(anstellung_id, jahr, monat)` haelt das auch unter Nebenlaeufigkeit, wo
 * eine Vorabpruefung es nicht taete — zwei gleichzeitige Rollover saehen
 * beide kein Konto.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was ein zweiter Aufruf mit ANGABEN tut — und warum das so sein muss.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die erste Fassung hatte `on conflict do nothing`, und das erzeugte einen
 * stillen Datenverlust, sobald es den Rollover wirklich gab (V-008): der
 * Nachtlauf legt das Konto des Monats mit `soll_minuten = 0` an — die
 * Sollzeit ist offen (O-18) —, und der spaetere Aufruf MIT einer Sollzeit
 * lief ins Leere. Der Monat behielt 0, der Saldo war um die ganze Sollzeit
 * falsch, und nichts wurde rot. Gefunden hat es `stundenkonto.test.ts` §3,
 * die den Vortrag ueber zwoelf Monate auf die Minute nachrechnet.
 *
 * Nachgeschrieben wird deshalb — aber nur, was der Aufrufer AUSDRUECKLICH
 * mitgibt (`!== undefined`) und nur, solange der Monat OFFEN ist. Ein
 * weggelassenes Feld laesst den Bestand in Ruhe, statt ihn auf die Vorgabe 0
 * zurueckzusetzen; ein gesperrter Monat bleibt unberuehrt, weil dort ein
 * gepraegter § 17-Nachweis daranhaengt.
 */
export async function eroeffneKonto(
  kontext: SchreibKontext, eingabe: KontoEroeffnung,
): Promise<Stundenkonto> {
  await kontext.schreibe(
    `insert into stundenkonto
       (mandant_id, anstellung_id, jahr, monat, soll_minuten, saldo_vortrag_minuten,
        erstellt_von)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (anstellung_id, jahr, monat) do update
        set soll_minuten =
              case when $8::boolean and stundenkonto.status <> 'gesperrt'
                   then excluded.soll_minuten else stundenkonto.soll_minuten end,
            saldo_vortrag_minuten =
              case when $9::boolean and stundenkonto.status <> 'gesperrt'
                   then excluded.saldo_vortrag_minuten
                   else stundenkonto.saldo_vortrag_minuten end`,
    [
      kontext.aktiverMandantId, eingabe.anstellungId, eingabe.jahr, eingabe.monat,
      eingabe.sollMinuten ?? 0, eingabe.saldoVortragMinuten ?? 0, kontext.benutzerId,
      eingabe.sollMinuten !== undefined, eingabe.saldoVortragMinuten !== undefined,
    ],
  );
  const konto = await findeKonto(kontext, eingabe.anstellungId, eingabe.jahr, eingabe.monat);
  if (konto === null) throw new KontoFehltFehler(eingabe.jahr, eingabe.monat);
  return konto;
}

async function findeKonto(
  kontext: LeseKontext, anstellungId: string, jahr: number, monat: number,
): Promise<Stundenkonto | null> {
  const [z] = await kontext.abfrage<KontoZeile>(
    `select ${KONTO_SPALTEN} from stundenkonto k
      where k.anstellung_id = $1 and k.jahr = $2 and k.monat = $3`,
    [anstellungId, jahr, monat],
  );
  return z === undefined ? null : alsKonto(z);
}

interface AnteilZeile {
  zeiteintrag_id: string;
  monat: Date | string;
  anteil_beginn: Date;
  brutto_minuten: number;
  dauer_brutto_minuten: number;
  pause_minuten: number;
}

function monatText(wert: Date | string): string {
  if (typeof wert === 'string') return wert.slice(0, 10);
  return `${String(wert.getUTCFullYear()).padStart(4, '0')}-`
    + `${String(wert.getUTCMonth() + 1).padStart(2, '0')}-`
    + `${String(wert.getUTCDate()).padStart(2, '0')}`;
}

export interface BuchungsErgebnis {
  readonly kontoId: string;
  readonly gebucht: number;
  readonly bereitsGebucht: number;
  readonly minuten: number;
  /** Anteile mit null Nettominuten — gebucht wird nichts, gemeldet schon. */
  readonly ohneMinuten: number;
}

/**
 * Bucht die freigegebenen Zeiten eines Monats auf das Konto.
 *
 * Wiederholbar, und das ist keine Bequemlichkeit: Zeiten werden nachtraeglich
 * freigegeben, und niemand merkt sich, welche schon gebucht sind. Die
 * Doppelbuchung verhindert der Schluessel `bewegung_arbeitszeit_uk` in der
 * Datenbank, nicht eine Merkliste im Dienst — eine zweite Buchung waere sonst
 * eine doppelt bezahlte Schicht, die wie eine richtige Zahl aussieht.
 *
 * **Die Pause wird VERTEILT, nicht je Monat neu gerundet** (§7.4). Eine
 * Schicht ueber die Monatsgrenze bekommt ihre Pause nach groesstem Rest auf
 * beide Anteile; `verteilePauseAufAnteile` ist die getestete Regel dafuer und
 * wird hier benutzt, statt eine zweite Rechnung aufzumachen.
 */
export async function bucheFreigegebeneZeiten(
  kontext: SchreibKontext,
  eingabe: { readonly anstellungId: string; readonly jahr: number; readonly monat: number },
): Promise<BuchungsErgebnis> {
  const konto = await findeKonto(kontext, eingabe.anstellungId, eingabe.jahr, eingabe.monat);
  if (konto === null) throw new KontoFehltFehler(eingabe.jahr, eingabe.monat);
  if (konto.status === 'gesperrt') throw new MonatGesperrtFehler(eingabe.jahr, eingabe.monat);

  /**
   * ALLE Anteile der betroffenen Eintraege, nicht nur die des Zielmonats.
   *
   * Die Pausenverteilung braucht die ganze Schicht: wer nur den Oktoberteil
   * einer Nacht vom 31.10. sieht, verteilt eine Pause auf eine halbe Schicht
   * und bucht Minuten, die es nicht gibt. `verteilePauseAufAnteile` prueft das
   * ausdruecklich und wirft — die Abfrage ist deshalb bewusst breiter als der
   * Monat.
   */
  const zeilen = await kontext.abfrage<AnteilZeile>(
    `select m.zeiteintrag_id, m.monat, m.anteil_beginn, m.brutto_minuten,
            z.dauer_brutto_minuten, z.pause_minuten
       from zeiteintrag_monatsanteil m
       join zeiteintrag z on z.mandant_id = m.mandant_id and z.id = m.zeiteintrag_id
      where m.anstellung_id = $1
        and m.freigegeben_am is not null
        and m.zeiteintrag_id in (
              select mm.zeiteintrag_id from zeiteintrag_monatsanteil mm
               where mm.anstellung_id = $1 and mm.monat = $2::date
                 and mm.freigegeben_am is not null)
      order by m.zeiteintrag_id asc, m.anteil_beginn asc`,
    [eingabe.anstellungId, monatsErster(eingabe.jahr, eingabe.monat)],
  );

  const jeEintrag = new Map<string, AnteilZeile[]>();
  for (const z of zeilen) {
    const liste = jeEintrag.get(z.zeiteintrag_id) ?? [];
    liste.push(z);
    jeEintrag.set(z.zeiteintrag_id, liste);
  }

  const ziel = monatsErster(eingabe.jahr, eingabe.monat);
  let gebucht = 0;
  let bereits = 0;
  let ohneMinuten = 0;
  let minuten = 0;

  for (const [zeiteintragId, anteile] of jeEintrag) {
    const erste = anteile[0];
    if (erste === undefined) continue;
    const mitPause = verteilePauseAufAnteile(
      anteile.map((a) => ({ monat: monatText(a.monat), bruttoMinuten: Number(a.brutto_minuten) })),
      Number(erste.dauer_brutto_minuten),
      Number(erste.pause_minuten),
    );

    for (const [i, teil] of mitPause.entries()) {
      if (teil.monat !== ziel) continue;
      const anteil = anteile[i];
      if (anteil === undefined) continue;
      // `CHECK (minuten <> 0)`: eine Buchung ueber null Minuten stuende im
      // Auszug und erklaerte nichts. Gemeldet wird sie trotzdem.
      if (teil.nettoMinuten === 0) { ohneMinuten += 1; continue; }

      const geschrieben = await kontext.schreibe<{ id: string }>(
        `insert into stundenkonto_bewegung
           (mandant_id, stundenkonto_id, art, minuten, wirksam_am, quelle,
            zeiteintrag_id, erstellt_von)
         values ($1, $2, 'arbeitszeit', $3, $4::date, 'zeiteintrag', $5, $6)
         on conflict (stundenkonto_id, zeiteintrag_id) where art = 'arbeitszeit'
           do nothing
         returning id`,
        [
          kontext.aktiverMandantId, konto.id, teil.nettoMinuten,
          berlinKalendertag(anteil.anteil_beginn), zeiteintragId, kontext.benutzerId,
        ],
      );
      if (geschrieben.length === 0) { bereits += 1; continue; }
      gebucht += 1;
      minuten += teil.nettoMinuten;
    }
  }

  return { kontoId: konto.id, gebucht, bereitsGebucht: bereits, minuten, ohneMinuten };
}

export interface KorrekturBuchung {
  readonly anstellungId: string;
  /** Der Monat, den die Korrektur betrifft — nicht der, in den sie faellt. */
  readonly jahr: number;
  readonly monat: number;
  /** Die Differenz. Vorzeichenbehaftet; 0 ist keine Korrektur. */
  readonly minuten: number;
  readonly begruendung: string;
  /** Der korrigierte Eintrag, falls es einen gibt (FIN-07, TIM-12). */
  readonly zeiteintragId?: string | null;
}

export interface KorrekturErgebnis {
  readonly bewegungId: string;
  /** Das Konto, in dem die Differenz gelandet ist. */
  readonly kontoId: string;
  readonly jahr: number;
  readonly monat: number;
  /** Der gesperrte Monat, den sie ausgleicht — oder `null`, wenn er offen war. */
  readonly ausgleichFuerKontoId: string | null;
}

/**
 * Bucht eine Korrektur — in den betroffenen Monat, wenn er offen ist, sonst in
 * den ERSTEN OFFENEN danach (EMP-04, §12.2).
 *
 * Das ist die ganze Regel, und sie steht hier und nicht in einem Ausloeser:
 * welcher Monat der naechste offene ist, welche Begruendung dransteht und
 * worauf sich die Buchung bezieht, ist eine fachliche Entscheidung mit einem
 * Beleg. `bewegung_sperre_pruefen` (0060) haelt die Gegenprobe — sie weist die
 * Buchung in einen gesperrten Monat ab und verlangt, dass ein genannter
 * Ausgleichsmonat wirklich gesperrt ist.
 *
 * Die zurueckgegebene `bewegungId` ist es, die `korrigiereZeiteintrag` als
 * `ausgleichBewegungId` braucht: `zk_sperre_ausgleich` (0036) laesst die
 * Korrekturzeile sonst gar nicht entstehen.
 */
export async function bucheKorrektur(
  kontext: SchreibKontext, eingabe: KorrekturBuchung,
): Promise<KorrekturErgebnis> {
  if (eingabe.minuten === 0) {
    throw new ZeitFehler('Eine Korrektur ueber null Minuten ist keine.');
  }
  const betroffen = await findeKonto(kontext, eingabe.anstellungId, eingabe.jahr, eingabe.monat);
  if (betroffen === null) throw new KontoFehltFehler(eingabe.jahr, eingabe.monat);

  const ziel = betroffen.status === 'gesperrt'
    ? await ersterOffenerMonat(kontext, eingabe.anstellungId, eingabe.jahr, eingabe.monat)
    : betroffen;
  const ausgleichFuer = betroffen.status === 'gesperrt' ? betroffen.id : null;

  /**
   * `wirksam_am` ist der erste Tag des ZIELMONATS, nicht der Tag der
   * korrigierten Schicht.
   *
   * Der Kontoauszug erzaehlt sonst eine Geschichte, die nicht stimmt: eine
   * Buchung mit Maerz-Datum in einem Mai-Konto sieht aus, als sei der Maerz
   * doch noch bewegt worden. Woher sie kommt, steht in
   * `korrektur_fuer_stundenkonto_id` und in der Begruendung.
   */
  const wirksam = monatsErster(ziel.jahr, ziel.monat);
  const [zeile] = await kontext.schreibe<{ id: string }>(
    `insert into stundenkonto_bewegung
       (mandant_id, stundenkonto_id, art, minuten, wirksam_am, quelle,
        zeiteintrag_id, begruendung, korrektur_fuer_stundenkonto_id, erstellt_von)
     values ($1, $2, 'korrektur', $3, $4::date,
             case when $5::uuid is null then 'manuell' else 'zeiteintrag' end::bewegung_quelle,
             $5::uuid, $6, $7::uuid, $8)
     returning id`,
    [
      kontext.aktiverMandantId, ziel.id, eingabe.minuten, wirksam,
      eingabe.zeiteintragId ?? null, eingabe.begruendung, ausgleichFuer, kontext.benutzerId,
    ],
  );
  if (zeile === undefined) throw new ZeitFehler('Die Ausgleichsbuchung wurde nicht geschrieben.');

  return {
    bewegungId: zeile.id,
    kontoId: ziel.id,
    jahr: ziel.jahr,
    monat: ziel.monat,
    ausgleichFuerKontoId: ausgleichFuer,
  };
}

/**
 * Der erste offene Monat ab einem gegebenen — die Zieladresse jeder Korrektur
 * an einem gesperrten Monat.
 *
 * Sortiert nach `(jahr, monat)` und nicht nach `erstellt_am`: Konten entstehen
 * nicht zwingend in der Reihenfolge, in der ihre Monate liegen, und „der erste
 * offene" ist eine Aussage ueber den Kalender.
 */
export async function ersterOffenerMonat(
  kontext: LeseKontext, anstellungId: string, abJahr: number, abMonat: number,
): Promise<Stundenkonto> {
  const [z] = await kontext.abfrage<KontoZeile>(
    `select ${KONTO_SPALTEN} from stundenkonto k
      where k.anstellung_id = $1
        and k.status <> 'gesperrt'
        and (k.jahr * 12 + k.monat) >= ($2::int * 12 + $3::int)
      order by k.jahr asc, k.monat asc
      limit 1`,
    [anstellungId, abJahr, abMonat],
  );
  if (z === undefined) throw new KeinOffenerMonatFehler(anstellungId);
  return alsKonto(z);
}

export interface AbschlussErgebnis {
  readonly kontoId: string;
  readonly istMinuten: number;
  readonly sollMinuten: number;
  readonly saldoMinuten: number;
  readonly gebucht: number;
  /** Der Digest des gepraegten Artefakts, oder `null` bei einem leeren Monat. */
  readonly nachweisHash: string | null;
  /**
   * Ist der Saldo in den Folgemonat gewandert? `false` heisst: der Folgemonat
   * ist selbst schon gesperrt — dann geht die Zahl ueber `bucheKorrektur` in
   * den ersten OFFENEN Monat und nicht rueckwirkend in einen geschlossenen.
   */
  readonly vortragGesetzt: boolean;
}

/**
 * Schliesst einen Monat ab — einmal, unumkehrbar.
 *
 * Die Reihenfolge ist Teil der Regel:
 *
 *   1. **verweigern, solange Zeiten unfreigegeben sind.** Danach koennten sie
 *      nicht mehr gebucht werden, und niemand saehe, dass sie fehlen.
 *   2. **buchen, was freigegeben ist.** Nach der Sperre geht keine Buchung
 *      mehr — `bewegung_sperre_pruefen` weist sie ab.
 *   3. **sperren.** Der Ausloeser `z_monat_sperren` stempelt daraufhin
 *      `zeiteintrag.gesperrt_am` fuer die Eintraege des Monats.
 *   4. **praegen.** Erst jetzt ist der Monat gesperrt, also darf das Artefakt
 *      entstehen (D-152, §7.3): der gesperrte Monat wird EINMAL gerendert und
 *      danach nur noch vorgelegt, nie neu abgefragt.
 *
 * Wer 4 vor 3 setzte, praegte ein Artefakt ueber einen offenen Monat — eine
 * Zusage „so und nicht anders" ueber Zahlen, die sich am naechsten Tag noch
 * aendern.
 */
export async function schliesseMonatAb(
  kontext: SchreibKontext,
  eingabe: { readonly anstellungId: string; readonly jahr: number; readonly monat: number },
): Promise<AbschlussErgebnis> {
  const konto = await findeKonto(kontext, eingabe.anstellungId, eingabe.jahr, eingabe.monat);
  if (konto === null) throw new KontoFehltFehler(eingabe.jahr, eingabe.monat);
  if (konto.status === 'gesperrt') throw new MonatGesperrtFehler(eingabe.jahr, eingabe.monat);

  const monat = monatsErster(eingabe.jahr, eingabe.monat);
  const [offen] = await kontext.abfrage<{ anzahl: string }>(
    `select count(distinct zeiteintrag_id)::text as anzahl
       from zeiteintrag_monatsanteil
      where anstellung_id = $1 and monat = $2::date and freigegeben_am is null`,
    [eingabe.anstellungId, monat],
  );
  const unfreigegeben = Number(offen?.anzahl ?? '0');
  if (unfreigegeben > 0) {
    throw new UnfreigegebeneZeitenFehler(unfreigegeben, eingabe.jahr, eingabe.monat);
  }

  const buchung = await bucheFreigegebeneZeiten(kontext, eingabe);

  await kontext.schreibe(
    `update stundenkonto
        set status = 'gesperrt', gesperrt_von = $2, geaendert_von = $2
      where id = $1`,
    [konto.id, kontext.benutzerId],
  );

  const [zahl] = await kontext.abfrage<{ anzahl: string }>(
    `select count(*)::text as anzahl from zeiteintrag_monatsanteil
      where anstellung_id = $1 and monat = $2::date`,
    [eingabe.anstellungId, monat],
  );

  let nachweisHash: string | null = null;
  if (Number(zahl?.anzahl ?? '0') > 0) {
    // Der Abschluss ERZEUGT den § 17-Nachweis, er liest ihn nicht nur.
    const artefakt = await praegeNachweis(kontext, {
      anstellungId: eingabe.anstellungId, monat,
    });
    nachweisHash = artefakt.hash;
  }

  const danach = await findeKonto(kontext, eingabe.anstellungId, eingabe.jahr, eingabe.monat);
  if (danach === null) throw new KontoFehltFehler(eingabe.jahr, eingabe.monat);

  /*
   * **Und jetzt wandert der Saldo weiter** (V-008). Ohne diese Zeilen bliebe
   * er im gesperrten Monat stehen, und die Summe ueber zwoelf Monate ergaebe
   * nicht das Jahr, sondern zwoelfmal den Monat. Ein gesperrter Folgemonat
   * wird dabei nicht angefasst — dort haengt ein gepraegter Nachweis.
   */
  const naechster = folgemonat(eingabe.jahr, eingabe.monat);
  const vortragGesetzt = await uebertrageSaldo(kontext, {
    anstellungId: eingabe.anstellungId,
    jahr: naechster.jahr,
    monat: naechster.monat,
    vortragMinuten: danach.saldoMinuten,
  });

  return {
    kontoId: danach.id,
    istMinuten: danach.istMinuten,
    sollMinuten: danach.sollMinuten,
    saldoMinuten: danach.saldoMinuten,
    gebucht: buchung.gebucht,
    nachweisHash,
    vortragGesetzt,
  };
}

/**
 * Der VORTRAG in den Folgemonat (V-008, EMP-04, §12.2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund: der Saldo blieb stehen, wo er entstanden ist.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `stundenkonto.saldo_vortrag_minuten` trägt seit je den Kommentar „Der
 * Vortrag aus dem Vormonat. Setzt `job:konten_rollover` beim Sperren." Den
 * Lauf gab es nicht, und `schliesseMonatAb` schrieb den Vortrag nicht. Ein
 * gesperrter März mit +7:30 h Guthaben übergab dem April **null** — das
 * Guthaben existierte nur noch im Blatt des Märzes, und die Summe über zwölf
 * Monate ergab nicht das Jahr, sondern zwölfmal den Monat.
 *
 * **Idempotent, aber NICHT blind.** `eroeffneKonto` hat `on conflict do
 * nothing`: gibt es den Folgemonat schon — und den gibt es nach dem
 * Monatslauf fast immer —, bliebe der Vortrag bei 0. Deshalb legt diese
 * Funktion an ODER schreibt den Wert nach.
 *
 * **Ein GESPERRTER Folgemonat wird nicht angefasst.** Wer im Mai den März
 * nachträglich abschliesst, während der April schon zu ist, darf den April
 * nicht rückwirkend verschieben — dort hängt ein geprägter § 17-Nachweis
 * daran. Die Zahl geht dann über den gewöhnlichen Weg als Korrektur in den
 * ersten offenen Monat (`bucheKorrektur`), und diese Funktion meldet
 * `false`.
 */
export async function uebertrageSaldo(
  kontext: SchreibKontext,
  eingabe: {
    readonly anstellungId: string;
    readonly jahr: number;
    readonly monat: number;
    readonly vortragMinuten: number;
  },
): Promise<boolean> {
  const vorhanden = await findeKonto(
    kontext, eingabe.anstellungId, eingabe.jahr, eingabe.monat);

  if (vorhanden === null) {
    await eroeffneKonto(kontext, {
      anstellungId: eingabe.anstellungId,
      jahr: eingabe.jahr,
      monat: eingabe.monat,
      saldoVortragMinuten: eingabe.vortragMinuten,
    });
    return true;
  }
  if (vorhanden.status === 'gesperrt') return false;

  await kontext.schreibe(
    `update stundenkonto
        set saldo_vortrag_minuten = $2, geaendert_am = now(), geaendert_von = $3
      where id = $1 and status <> 'gesperrt'`,
    [vorhanden.id, eingabe.vortragMinuten, kontext.benutzerId],
  );
  return true;
}

/** Der Monat NACH diesem — mit dem Jahreswechsel, den ein `+ 1` vergisst. */
export function folgemonat(jahr: number, monat: number): { jahr: number; monat: number } {
  return monat === 12 ? { jahr: jahr + 1, monat: 1 } : { jahr, monat: monat + 1 };
}

/**
 * Nur die ABFRAGE — der kleinste Kontext, der für den Abgleich reicht.
 *
 * `LeseKontext` verlangt Scope, Portal, Benutzer und Mandantenliste; ein
 * Nachtlauf hat davon nichts und soll es auch nicht erfinden (V-073). Ein
 * `LeseKontext` erfüllt diese Form ohnehin, der bestehende Aufruf aus der
 * Oberfläche ändert sich also nicht.
 */
export interface NurAbfrage {
  abfrage<T>(anweisung: string, werte?: readonly unknown[]): Promise<readonly T[]>;
}

export interface Drift {
  readonly kontoId: string;
  readonly anstellungId: string;
  readonly jahr: number;
  readonly monat: number;
  readonly istMinutenKonto: number;
  readonly istMinutenJournal: number;
  readonly korrekturMinutenKonto: number;
  readonly korrekturMinutenJournal: number;
}

/**
 * Der naechtliche Abgleich (`job:stundenkonto_abgleich`, analog FIN-06).
 *
 * Er MELDET und korrigiert nicht. Ein Konto, dessen Summe von seinem Journal
 * abweicht, ist ein Befund: entweder hat etwas an `bewegung_summe` vorbei
 * geschrieben, oder eine Buchung fehlt. Beides will man sehen. Ein Lauf, der
 * die Zahl still geradezieht, macht aus dem Befund eine Statistik, die immer
 * sauber ist.
 *
 * Dass die Abweichung heute gar nicht erst entstehen KANN, ist kein Grund, den
 * Abgleich wegzulassen: `stundenkonto_summe` weist sie im laufenden Betrieb
 * ab, aber nicht das, was ein Wartungszugang oder eine kuenftige Migration
 * schreibt.
 */
export async function pruefeAbgleich(
  kontext: NurAbfrage, filter: KontoFilter = {},
): Promise<readonly Drift[]> {
  const werte: unknown[] = [];
  const wo: string[] = [];
  if (filter.anstellungId !== undefined) {
    werte.push(filter.anstellungId);
    wo.push(`k.anstellung_id = $${String(werte.length)}`);
  }
  if (filter.jahr !== undefined) {
    werte.push(filter.jahr);
    wo.push(`k.jahr = $${String(werte.length)}`);
  }
  if (filter.mandantId !== undefined) {
    werte.push(filter.mandantId);
    wo.push(`k.mandant_id = $${String(werte.length)}::uuid`);
  }
  const zeilen = await kontext.abfrage<{
    id: string; anstellung_id: string; jahr: number; monat: number;
    ist_minuten: number; korrektur_minuten: number;
    journal_ist: string; journal_korrektur: string;
  }>(
    `select k.id, k.anstellung_id, k.jahr, k.monat, k.ist_minuten, k.korrektur_minuten,
            coalesce(sum(b.minuten), 0)::text as journal_ist,
            coalesce(sum(b.minuten) filter (where b.art = 'korrektur'), 0)::text
              as journal_korrektur
       from stundenkonto k
       left join stundenkonto_bewegung b on b.stundenkonto_id = k.id
      ${wo.length === 0 ? '' : `where ${wo.join(' and ')}`}
      group by k.id, k.anstellung_id, k.jahr, k.monat, k.ist_minuten, k.korrektur_minuten
     having k.ist_minuten <> coalesce(sum(b.minuten), 0)
         or k.korrektur_minuten
            <> coalesce(sum(b.minuten) filter (where b.art = 'korrektur'), 0)
      order by k.jahr asc, k.monat asc`,
    werte,
  );
  return zeilen.map((z) => ({
    kontoId: z.id,
    anstellungId: z.anstellung_id,
    jahr: Number(z.jahr),
    monat: Number(z.monat),
    istMinutenKonto: Number(z.ist_minuten),
    istMinutenJournal: Number(z.journal_ist),
    korrekturMinutenKonto: Number(z.korrektur_minuten),
    korrekturMinutenJournal: Number(z.journal_korrektur),
  }));
}
