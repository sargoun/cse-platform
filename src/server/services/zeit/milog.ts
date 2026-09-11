/**
 * Die § 17-MiLoG-Aufzeichnung (TIM-13, LEG-02, EMP-04; 04-PLANUNG-ZEIT §7.3).
 *
 * § 17 Abs. 1 MiLoG verlangt Beginn, Ende und Dauer der taeglichen
 * Arbeitszeit, aufgezeichnet und **zwei Jahre** aufbewahrt. Diese Datei
 * erzeugt genau das, je Beschaeftigung und Monat — und drei Eigenschaften
 * daran sind wichtiger als der Rest:
 *
 * **1. Beginn und Ende sind die WAHREN Zeitpunkte des Eintrags.** Eine
 * Schicht 31.10. 22:00 → 01.11. 06:00 taucht in zwei Monaten auf, aber sie
 * hat EINEN Beginn und EIN Ende, und die stehen in beiden Monatsblaettern so
 * da, wie sie waren. Nur die Anteilsspalten sind monatsabhaengig. Wer
 * stattdessen die Anteilsgrenzen als Beginn und Ende ausgibt, legt der
 * Aufsicht eine Aufzeichnung vor, die behauptet, um Mitternacht sei
 * Feierabend gewesen — und das ist keine Ungenauigkeit, sondern eine falsche
 * Aufzeichnung.
 *
 * **2. Die Summe stimmt auf die Minute.** Die Anteile werden gegen
 * `splitteNachMonat` geprueft und die Pause nach groesstem Rest verteilt
 * (§7.4). Beides wirft, statt zu runden: eine Aufzeichnung, deren Summe um
 * eine Minute von den Eintraegen abweicht, ist im Lohnstreit wertlos, und die
 * Abweichung entsteht lautlos.
 *
 * **3. Ein gesperrter Monat wird NICHT neu gerechnet.** Das ist die
 * unangenehmste Regel und die wichtigste. Eine Korrektur im Mai praegt eine
 * NEUE Fassung mit Maerz-Zeitpunkten (§15.6). Wer den Maerz danach aus der
 * lebenden Sicht neu rendert, erzeugt ein Dokument, das von dem abweicht, das
 * die Arbeiterin in der Hand hatte — fuer genau den Monat, den EMP-04 stabil
 * halten soll, und ohne dass eines der beiden Dokumente falsch AUSSIEHT.
 * Gesperrt heisst deshalb: einmal praegen, mit Digest, danach byte-gleich
 * wieder ausgeben. Die Korrektur erscheint dort, wo sie hingehoert — in der
 * Korrekturspur (§5.7) und als Ausgleichsbuchung im ersten offenen Monat
 * (§12.2).
 *
 * **Was hier NICHT passiert: Geld.** Diese Domaene traegt keine Geldspalte
 * (§1.5, Invariante 1). Die Aufzeichnung ist Minuten; bewertet wird sie im
 * Lohnlauf, ausserhalb der Plattform (D-06).
 */
import type { LeseKontext, SchreibKontext } from '../../kontext/index.js';
import { nutzlastHash } from '../finanz/hash-chain.js';
import { ZeitFehler } from './dauer.js';
import { pruefeAnteileGegenSchicht, verteilePauseAufAnteile } from './monatsanteil.js';

/** Eine Zeile der Aufzeichnung — ein Zeiteintrag, gesehen aus einem Monat. */
export interface MiLoGZeile {
  readonly zeiteintragId: string;
  /** Der BERLINER Kalendertag des Anteilsbeginns (K-11). */
  readonly kalendertag: string;
  /** Der wahre Beginn des Eintrags, ISO-8601 in UTC. */
  readonly beginn: string;
  /** Das wahre Ende des Eintrags, ISO-8601 in UTC. */
  readonly ende: string;
  readonly pauseMinuten: number;
  readonly bruttoMinuten: number;
  readonly nettoMinuten: number;
  /** Der auf DIESEN Monat entfallende Ausschnitt. */
  readonly anteilBeginn: string;
  readonly anteilEnde: string;
  readonly anteilBruttoMinuten: number;
  readonly anteilNettoMinuten: number;
  readonly nacherfasst: boolean;
}

/** Woher die ausgegebene Aufzeichnung stammt. */
export type NachweisQuelle =
  /** Offener Monat: aus der lebenden Sicht gerechnet, vorlaeufig. */
  | 'live'
  /** Gesperrter Monat: das gepraegte Artefakt, byte-gleich. */
  | 'artefakt'
  /**
   * Gesperrter Monat OHNE Artefakt. Bewusst kein stiller Fallback auf `live`:
   * genau der waere der Fehler, den §7.3 beschreibt.
   */
  | 'ungepraegt';

export interface MiLoGNachweis {
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly personId: string;
  /** `JJJJ-MM-01`, der erste Tag des Berliner Monats. */
  readonly monat: string;
  readonly zeilen: readonly MiLoGZeile[];
  readonly summeBruttoMinuten: number;
  readonly summeNettoMinuten: number;
  /** SHA-256 der kanonischen Zeilen, hex. */
  readonly hash: string;
  readonly quelle: NachweisQuelle;
  readonly gesperrtAm: Date | null;
}

export interface NachweisEingabe {
  readonly anstellungId: string;
  /** `JJJJ-MM-01`. */
  readonly monat: string;
}

export class NachweisVerletztFehler extends Error {
  readonly code = 'nachweis_verletzt';
  readonly status = 409;
  constructor(anstellungId: string, monat: string) {
    super(
      `Das Artefakt fuer ${anstellungId}/${monat} passt nicht zu seinem Digest. `
      + 'Es wurde nach dem Praegen veraendert.',
    );
    this.name = 'NachweisVerletztFehler';
  }
}

export class MonatOffenFehler extends Error {
  readonly code = 'ungueltiger_zustand';
  readonly status = 409;
  constructor(monat: string) {
    super(`Der Monat ${monat} ist nicht gesperrt — ein Artefakt waere vorlaeufig.`);
    this.name = 'MonatOffenFehler';
  }
}

/**
 * Die kanonische Textform der Zeilen — die Bytes, ueber die der Digest laeuft.
 *
 * Sie steht hier als EINE Funktion und mit FESTER Feldreihenfolge, und beides
 * traegt: `jsonb` sortiert seine Schluessel beim Speichern um, also darf der
 * Digest nicht von der Reihenfolge abhaengen, in der irgendwer das Objekt
 * gebaut hat. Der Vergleich beim Wieder-Ausgeben laeuft ueber DIESELBE
 * Funktion, angewandt auf die zurueckgelesenen Zeilen — damit ist das
 * Artefakt nicht nur gespeichert, sondern pruefbar.
 *
 * Das ist ausdruecklich NICHT der RFC-8785-Kanonisierer der Rechnungskette
 * (`05-FINANZEN.md` §5.4): der kommt mit dem Rechnungsmodell und hat eine
 * andere Aufgabe. Hier wird eine Liste gehasht, deren Bytes daneben liegen;
 * dort eine Kette, deren Glieder unabhaengig nachgerechnet werden. Der Digest
 * selbst ist derselbe (`nutzlastHash`), damit es nicht zwei
 * SHA-256-Umsetzungen gibt.
 */
export function kanonischeZeilen(zeilen: readonly MiLoGZeile[]): string {
  const geordnet = [...zeilen].sort(
    (a, b) => a.anteilBeginn.localeCompare(b.anteilBeginn)
      || a.zeiteintragId.localeCompare(b.zeiteintragId),
  );
  return geordnet
    .map((z) => [
      z.zeiteintragId, z.kalendertag, z.beginn, z.ende,
      String(z.pauseMinuten), String(z.bruttoMinuten), String(z.nettoMinuten),
      z.anteilBeginn, z.anteilEnde,
      String(z.anteilBruttoMinuten), String(z.anteilNettoMinuten),
      z.nacherfasst ? '1' : '0',
    ].join(''))
    .join('');
}

export function nachweisHash(zeilen: readonly MiLoGZeile[]): string {
  return nutzlastHash(new TextEncoder().encode(kanonischeZeilen(zeilen)));
}

interface AufzeichnungZeile {
  zeiteintrag_id: string;
  mandant_id: string;
  anstellung_id: string;
  person_id: string;
  monat: Date | string;
  kalendertag: Date | string;
  beginn_zeitpunkt: Date;
  ende_zeitpunkt: Date;
  pause_minuten: number;
  dauer_brutto_minuten: number;
  dauer_netto_minuten: number;
  anteil_beginn: Date;
  anteil_ende: Date;
  anteil_brutto_minuten: number;
  gesperrt_am: Date | null;
  nacherfasst: boolean;
}

function tag(wert: Date | string): string {
  if (typeof wert === 'string') return wert.slice(0, 10);
  return `${String(wert.getUTCFullYear()).padStart(4, '0')}-${String(wert.getUTCMonth() + 1).padStart(2, '0')}-${String(wert.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Alle Anteile der Eintraege, die diesen Monat beruehren — auch die Anteile
 * im NACHBARMONAT.
 *
 * Das ist kein Mehr an Daten, sondern die Voraussetzung: die Pause wird ueber
 * ALLE Anteile eines Eintrags verteilt (§7.4). Wer nur die Anteile des
 * gefragten Monats laedt, verteilt eine ganze Pause auf einen halben Eintrag —
 * und die Summe der beiden Monatsblaetter ist dann groesser als die Schicht.
 */
async function leseAnteile(
  kontext: LeseKontext, eingabe: NachweisEingabe,
): Promise<readonly AufzeichnungZeile[]> {
  return kontext.abfrage<AufzeichnungZeile>(
    `select m.zeiteintrag_id, m.mandant_id, m.anstellung_id, m.person_id, m.monat,
            m.kalendertag, m.beginn_zeitpunkt, m.ende_zeitpunkt, m.pause_minuten,
            m.dauer_brutto_minuten, m.dauer_netto_minuten,
            m.anteil_beginn, m.anteil_ende, m.anteil_brutto_minuten,
            m.gesperrt_am, m.nacherfasst
       from milog_aufzeichnung m
      where m.anstellung_id = $1
        and m.zeiteintrag_id in (
              select z.zeiteintrag_id from milog_aufzeichnung z
               where z.anstellung_id = $1 and z.monat = $2::date)
      order by m.anteil_beginn asc, m.zeiteintrag_id asc`,
    [eingabe.anstellungId, eingabe.monat],
  );
}

/** Baut die Monatszeilen und prueft dabei jede Schicht gegen die Rechnung. */
function baueZeilen(
  alle: readonly AufzeichnungZeile[], monat: string,
): { zeilen: readonly MiLoGZeile[]; gesperrtAm: Date | null } {
  const nachEintrag = new Map<string, AufzeichnungZeile[]>();
  for (const z of alle) {
    const liste = nachEintrag.get(z.zeiteintrag_id) ?? [];
    liste.push(z);
    nachEintrag.set(z.zeiteintrag_id, liste);
  }

  const zeilen: MiLoGZeile[] = [];
  let gesperrtAm: Date | null = null;

  for (const [, teile] of nachEintrag) {
    const erste = teile[0];
    if (erste === undefined) continue;
    const anteile = teile.map((t) => ({
      monat: tag(t.monat),
      bruttoMinuten: Number(t.anteil_brutto_minuten),
    }));
    // Zwei unabhaengige Umsetzungen derselben Regel gegeneinander gehalten:
    // die Sicht in SQL und `splitteNachMonat` in TypeScript (§7.3, K-11).
    pruefeAnteileGegenSchicht(anteile, erste.beginn_zeitpunkt, erste.ende_zeitpunkt);
    const mitPause = verteilePauseAufAnteile(
      anteile, Number(erste.dauer_brutto_minuten), Number(erste.pause_minuten),
    );

    for (const [i, t] of teile.entries()) {
      if (tag(t.monat) !== monat) continue;
      const p = mitPause[i];
      if (p === undefined) throw new ZeitFehler('Die Pausenverteilung hat einen Anteil verloren.');
      if (t.gesperrt_am !== null
          && (gesperrtAm === null || t.gesperrt_am.getTime() > gesperrtAm.getTime())) {
        gesperrtAm = t.gesperrt_am;
      }
      zeilen.push({
        zeiteintragId: t.zeiteintrag_id,
        kalendertag: tag(t.kalendertag),
        beginn: t.beginn_zeitpunkt.toISOString(),
        ende: t.ende_zeitpunkt.toISOString(),
        pauseMinuten: Number(t.pause_minuten),
        bruttoMinuten: Number(t.dauer_brutto_minuten),
        nettoMinuten: Number(t.dauer_netto_minuten),
        anteilBeginn: t.anteil_beginn.toISOString(),
        anteilEnde: t.anteil_ende.toISOString(),
        anteilBruttoMinuten: p.bruttoMinuten,
        anteilNettoMinuten: p.nettoMinuten,
        nacherfasst: t.nacherfasst,
      });
    }
  }

  zeilen.sort((a, b) => a.anteilBeginn.localeCompare(b.anteilBeginn)
    || a.zeiteintragId.localeCompare(b.zeiteintragId));
  return { zeilen, gesperrtAm };
}

function summen(zeilen: readonly MiLoGZeile[]): {
  brutto: number; netto: number;
} {
  return {
    brutto: zeilen.reduce((s, z) => s + z.anteilBruttoMinuten, 0),
    netto: zeilen.reduce((s, z) => s + z.anteilNettoMinuten, 0),
  };
}

interface ArtefaktZeile {
  zeilen: unknown;
  summe_brutto_minuten: number;
  summe_netto_minuten: number;
  hash: string;
  gesperrt_am: Date;
  person_id: string;
  mandant_id: string;
}

async function leseArtefakt(
  kontext: LeseKontext, eingabe: NachweisEingabe,
): Promise<MiLoGNachweis | null> {
  const [a] = await kontext.abfrage<ArtefaktZeile>(
    `select zeilen, summe_brutto_minuten, summe_netto_minuten, hash, gesperrt_am,
            person_id, mandant_id
       from zeitnachweis
      where anstellung_id = $1 and monat = $2::date`,
    [eingabe.anstellungId, eingabe.monat],
  );
  if (a === undefined) return null;

  const zeilen = a.zeilen as readonly MiLoGZeile[];
  /**
   * Der Digest wird NACHGERECHNET, nicht geglaubt. Ein gespeicherter Hash
   * neben gespeicherten Zeilen beweist nichts, solange niemand die beiden
   * gegeneinander haelt — und genau dieses Nachrechnen ist der Unterschied
   * zwischen „abgelegt" und „nachweisbar unveraendert".
   */
  if (nachweisHash(zeilen) !== a.hash) {
    throw new NachweisVerletztFehler(eingabe.anstellungId, eingabe.monat);
  }
  return {
    mandantId: a.mandant_id,
    anstellungId: eingabe.anstellungId,
    personId: a.person_id,
    monat: eingabe.monat,
    zeilen,
    summeBruttoMinuten: Number(a.summe_brutto_minuten),
    summeNettoMinuten: Number(a.summe_netto_minuten),
    hash: a.hash,
    quelle: 'artefakt',
    gesperrtAm: a.gesperrt_am,
  };
}

/**
 * Die Aufzeichnung eines Monats.
 *
 * Ein GESPERRTER Monat wird ausschliesslich aus seinem Artefakt beantwortet.
 * Fehlt es, ist die Antwort `ungepraegt` — und ausdruecklich nicht eine frisch
 * gerechnete Liste, die vielleicht zufaellig dieselbe waere. Der Aufrufer
 * praegt dann ueber `praegeNachweis` und bekommt danach immer dieselbe.
 */
export async function leseNachweis(
  kontext: LeseKontext, eingabe: NachweisEingabe,
): Promise<MiLoGNachweis> {
  const alle = await leseAnteile(kontext, eingabe);
  const { zeilen, gesperrtAm } = baueZeilen(alle, eingabe.monat);
  const erste = alle[0];

  if (gesperrtAm !== null) {
    const artefakt = await leseArtefakt(kontext, eingabe);
    if (artefakt !== null) return artefakt;
  }

  const s = summen(zeilen);
  return {
    mandantId: erste?.mandant_id ?? kontext.aktiverMandantId ?? '',
    anstellungId: eingabe.anstellungId,
    personId: erste?.person_id ?? '',
    monat: eingabe.monat,
    zeilen,
    summeBruttoMinuten: s.brutto,
    summeNettoMinuten: s.netto,
    hash: nachweisHash(zeilen),
    quelle: gesperrtAm === null ? 'live' : 'ungepraegt',
    gesperrtAm,
  };
}

/**
 * Praegt das Artefakt eines gesperrten Monats — genau einmal.
 *
 * Idempotent: ein zweiter Aufruf gibt das vorhandene Artefakt zurueck, statt
 * ein zweites zu schreiben. Die Eindeutigkeit `(mandant_id, anstellung_id,
 * monat)` haelt das auch unter Nebenlaeufigkeit, wo eine Vorabpruefung es
 * nicht taete: zwei gleichzeitige Exporte saehen beide kein Artefakt.
 *
 * Ein OFFENER Monat bekommt keines. Ein Artefakt ist eine Zusage („so und
 * nicht anders"), und eine Zusage ueber einen Monat, in dem noch gebucht
 * wird, waere am naechsten Tag falsch.
 */
export async function praegeNachweis(
  kontext: SchreibKontext, eingabe: NachweisEingabe,
): Promise<MiLoGNachweis> {
  const vorhanden = await leseArtefakt(kontext, eingabe);
  if (vorhanden !== null) return vorhanden;

  const alle = await leseAnteile(kontext, eingabe);
  const { zeilen, gesperrtAm } = baueZeilen(alle, eingabe.monat);
  if (gesperrtAm === null) throw new MonatOffenFehler(eingabe.monat);

  const erste = alle[0];
  if (erste === undefined) throw new MonatOffenFehler(eingabe.monat);
  const s = summen(zeilen);
  const hash = nachweisHash(zeilen);

  await kontext.schreibe(
    `insert into zeitnachweis
       (mandant_id, anstellung_id, person_id, monat, zeilen, zeilen_anzahl,
        summe_brutto_minuten, summe_netto_minuten, hash, gesperrt_am,
        erstellt_von_art, erstellt_von)
     values ($1, $2, $3, $4::date, $5::jsonb, $6, $7, $8, $9, $10::timestamptz,
             'mensch', $11)
     on conflict (mandant_id, anstellung_id, monat) do nothing`,
    /**
     * `zeilen` geht als FELD hinein, nicht als Zeichenkette.
     *
     * Der Treiber kodiert selbst, sobald ein Parameter als `jsonb` gebraucht
     * wird; eine schon kodierte Zeichenkette wuerde ein zweites Mal kodiert
     * und landete als jsonb-ZEICHENKETTE. Die Bedingung `zn_zeilen_gezaehlt`
     * faengt das hier („array length of a scalar") — ohne sie stuende im
     * Artefakt ein Text, der wie ein Nachweis aussieht und keiner ist.
     */
    [
      erste.mandant_id, eingabe.anstellungId, erste.person_id, eingabe.monat,
      zeilen, zeilen.length, s.brutto, s.netto, hash,
      gesperrtAm.toISOString(), kontext.benutzerId,
    ],
  );

  // Und wieder LESEN, nicht das eben Gebaute zurueckgeben: unter
  // Nebenlaeufigkeit hat vielleicht der andere Lauf gepraegt, und massgeblich
  // ist, was in der Tabelle steht — nicht, was dieser Aufruf gerechnet hat.
  const artefakt = await leseArtefakt(kontext, eingabe);
  if (artefakt === null) throw new ZeitFehler('Das Artefakt wurde nicht geschrieben.');
  return artefakt;
}

/**
 * Die Gegenprobe fuer die Abnahme: stimmt die Summe der Aufzeichnung mit der
 * Summe der Eintraege ueberein?
 *
 * Sie liest die Eintraege ein zweites Mal und rechnet unabhaengig vom
 * ausgegebenen Nachweis — der bei einem gesperrten Monat aus dem GEPRAEGTEN
 * Artefakt kommt. Genau dort traegt sie: weicht das Artefakt von den heutigen
 * Eintraegen ab, sagt es diese Zahl und nicht erst der Lohnstreit.
 *
 * **Beide Zahlen liegen auf DEMSELBEN Massstab: dem Monatsanteil.** Vorher
 * kam das Brutto als Anteil aus der Sicht, das Netto dagegen als
 * `z.dauer_netto_minuten` — die volle Schicht. Eine Schicht ueber die
 * Monatsgrenze (31.10. 22:00 → 01.11. 06:00) zaehlte damit in BEIDEN
 * Monatsblaettern mit ihren vollen acht Stunden netto, und die Gegenprobe
 * behauptete eine Abweichung, wo keine war — jeden Monatswechsel, und nur bei
 * den Nachtschichten, an denen § 17 MiLoG haengt.
 *
 * Die Pause wird dafuer ueber `verteilePauseAufAnteile` verteilt, also mit
 * derselben getesteten Regel wie ueberall (§7.4) — nicht mit einer zweiten,
 * die in SQL formuliert waere und an jedem Monatsende eine Minute erzeugte.
 */
export async function summeDerEintraege(
  kontext: LeseKontext, eingabe: NachweisEingabe,
): Promise<{ readonly bruttoMinuten: number; readonly nettoMinuten: number }> {
  const alle = await leseAnteile(kontext, eingabe);
  const nachEintrag = new Map<string, AufzeichnungZeile[]>();
  for (const z of alle) {
    const liste = nachEintrag.get(z.zeiteintrag_id) ?? [];
    liste.push(z);
    nachEintrag.set(z.zeiteintrag_id, liste);
  }

  let brutto = 0;
  let netto = 0;
  for (const teile of nachEintrag.values()) {
    const erste = teile[0];
    if (erste === undefined) continue;
    const mitPause = verteilePauseAufAnteile(
      teile.map((t) => ({
        monat: tag(t.monat), bruttoMinuten: Number(t.anteil_brutto_minuten),
      })),
      Number(erste.dauer_brutto_minuten), Number(erste.pause_minuten),
    );
    for (const anteil of mitPause) {
      if (anteil.monat !== eingabe.monat) continue;
      brutto += anteil.bruttoMinuten;
      netto += anteil.nettoMinuten;
    }
  }
  return { bruttoMinuten: brutto, nettoMinuten: netto };
}
