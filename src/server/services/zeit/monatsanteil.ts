/**
 * Der Monatsanteil (04-PLANUNG-ZEIT §7.3, §7.4; K-11).
 *
 * **Der Zeiteintrag wird nicht geteilt.** Eine Schicht 31.10. 22:00 →
 * 01.11. 06:00 gehoert zwei Monaten an. Zwei Zeilen daraus zu machen ist der
 * naheliegende Entwurf und faelscht genau das, was § 17 Abs. 1 MiLoG
 * verlangt: Beginn, Ende und Dauer, EINMAL und so, wie sie waren. Die
 * Aufteilung ist deshalb eine SICHT (`zeiteintrag_monatsanteil`) und dieser
 * Dienst liest sie, statt eine zweite Zeitrechnung aufzumachen.
 *
 * **Was hier und nicht in SQL steht: die Pause.** Die Sicht liefert
 * Bruttominuten je Anteil — eine Differenz zweier Zeitpunkte, also
 * DST-richtig ohne Sonderfall. Die aufgezeichnete Pause muss dagegen VERTEILT
 * werden, und zwar nach groesstem Rest: jeden Anteil einzeln zu runden
 * erzeugt oder vernichtet an jedem Monatsende eine Minute. Die taucht dann
 * als Centdifferenz auf einer Rechnung wieder auf, und niemand sucht sie am
 * Monatsende. Die Regel ist deshalb eine getestete Funktion
 * (`verteilePausenMinuten` in `dauer.ts`) und keine Formel in einer
 * DDL-Anweisung, die kein Test erreicht.
 *
 * **Die Gegenprobe laeuft immer.** `summiereAnteile` prueft, dass die Teile
 * die aufgezeichnete Dauer EXAKT ergeben, und wirft sonst. Ein Monatssplit,
 * der eine Minute verliert, sieht in jeder einzelnen Zeile plausibel aus —
 * er faellt erst im Jahresvergleich auf, und dann ist der Lohn gezahlt.
 */
import type { LeseKontext } from '../../kontext/index.js';
import {
  berlinMonatsBeginn, dauerMinuten, splitteNachMonat, verteilePausenMinuten, ZeitFehler,
} from './dauer.js';

/** Ein Monatsanteil eines Zeiteintrags, wie ihn die Sicht liefert. */
export interface Monatsanteil {
  readonly zeiteintragId: string;
  readonly mandantId: string;
  readonly anstellungId: string;
  readonly personId: string;
  readonly auftragLeistungId: string | null;
  /** Der erste Tag des BERLINER Monats, `JJJJ-MM-TT`. */
  readonly monat: string;
  readonly anteilBeginn: Date;
  readonly anteilEnde: Date;
  readonly bruttoMinuten: number;
  readonly freigegebenAm: Date | null;
  readonly gesperrtAm: Date | null;
}

export interface MonatsanteilFilter {
  readonly anstellungId?: string;
  readonly personId?: string;
  /** `JJJJ-MM-TT` — der erste Tag des Berliner Monats. */
  readonly monat?: string;
  /** EMP-04/ACC-12 lesen nur Freigegebenes; EMP-03 liest alles (§7.3). */
  readonly nurFreigegeben?: boolean;
}

/** `2026-10` → `2026-10-01`; wirft bei allem anderen. */
export function monatsErster(jahr: number, monat: number): string {
  if (!Number.isInteger(jahr) || !Number.isInteger(monat) || monat < 1 || monat > 12) {
    throw new ZeitFehler(`Kein Monat: ${String(jahr)}-${String(monat)}`);
  }
  return `${String(jahr).padStart(4, '0')}-${String(monat).padStart(2, '0')}-01`;
}

/**
 * Der Zeitpunkt, an dem dieser Berliner Monat beginnt.
 *
 * Ueber `berlinMonatsBeginn` und nicht ueber `new Date(monat + 'T00:00Z')` —
 * das waere UTC-Mitternacht und damit im Winter eine Stunde und im Sommer
 * zwei zu frueh. Genau dieser Fehler verschiebt eine Nachtschicht in den
 * falschen Monat.
 */
export function monatsBeginnInstant(monat: string): Date {
  const treffer = /^(\d{4})-(\d{2})-01$/u.exec(monat.trim());
  if (treffer === null) {
    throw new ZeitFehler(`Kein Monatserster in der Form JJJJ-MM-01: ${JSON.stringify(monat)}`);
  }
  return berlinMonatsBeginn(Number(treffer[1]), Number(treffer[2]));
}

interface AnteilZeile {
  zeiteintrag_id: string;
  mandant_id: string;
  anstellung_id: string;
  person_id: string;
  auftrag_leistung_id: string | null;
  monat: Date | string;
  anteil_beginn: Date;
  anteil_ende: Date;
  brutto_minuten: number;
  freigegeben_am: Date | null;
  gesperrt_am: Date | null;
}

/** `date` kommt je nach Treibereinstellung als `Date` oder als Zeichenkette. */
function alsDatum(wert: Date | string): string {
  if (typeof wert === 'string') return wert.slice(0, 10);
  // `toISOString()` waere UTC — bei einem reinen `date` ist das derselbe Tag,
  // aber die Absicht steht hier ausdruecklich, damit niemand die Zeile spaeter
  // auf einen Zeitstempel umschreibt und sich wundert.
  return `${String(wert.getUTCFullYear()).padStart(4, '0')}-${String(wert.getUTCMonth() + 1).padStart(2, '0')}-${String(wert.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Die Anteile aus der Sicht — nie aus der Tabelle.
 *
 * Die Sicht ist `security_invoker`, erbt also die RLS des Aufrufers. Dieser
 * Dienst schreibt nichts und laeuft deshalb auch in der Gruppen- und in der
 * Personenansicht.
 */
export async function leseMonatsanteile(
  kontext: LeseKontext,
  filter: MonatsanteilFilter = {},
): Promise<readonly Monatsanteil[]> {
  const werte: unknown[] = [];
  const bedingungen: string[] = [];
  if (filter.anstellungId !== undefined) {
    werte.push(filter.anstellungId);
    bedingungen.push(`anstellung_id = $${String(werte.length)}`);
  }
  if (filter.personId !== undefined) {
    werte.push(filter.personId);
    bedingungen.push(`person_id = $${String(werte.length)}`);
  }
  if (filter.monat !== undefined) {
    werte.push(filter.monat);
    bedingungen.push(`monat = $${String(werte.length)}::date`);
  }
  if (filter.nurFreigegeben === true) bedingungen.push('freigegeben_am is not null');
  const wo = bedingungen.length === 0 ? '' : `where ${bedingungen.join(' and ')}`;

  const zeilen = await kontext.abfrage<AnteilZeile>(
    `select zeiteintrag_id, mandant_id, anstellung_id, person_id, auftrag_leistung_id,
            monat, anteil_beginn, anteil_ende, brutto_minuten, freigegeben_am, gesperrt_am
       from zeiteintrag_monatsanteil
       ${wo}
      order by anteil_beginn asc, zeiteintrag_id asc`,
    werte,
  );
  return zeilen.map((z) => ({
    zeiteintragId: z.zeiteintrag_id,
    mandantId: z.mandant_id,
    anstellungId: z.anstellung_id,
    personId: z.person_id,
    auftragLeistungId: z.auftrag_leistung_id,
    monat: alsDatum(z.monat),
    anteilBeginn: z.anteil_beginn,
    anteilEnde: z.anteil_ende,
    bruttoMinuten: Number(z.brutto_minuten),
    freigegebenAm: z.freigegeben_am,
    gesperrtAm: z.gesperrt_am,
  }));
}

/** Ein Anteil mit der auf ihn entfallenden Pause und der Nettodauer. */
export interface AnteilMitPause {
  readonly monat: string;
  readonly bruttoMinuten: number;
  readonly pauseMinuten: number;
  readonly nettoMinuten: number;
}

/**
 * Verteilt die aufgezeichnete Pause EINES Eintrags auf seine Monatsanteile.
 *
 * Die Anteile muessen zu demselben Zeiteintrag gehoeren und in zeitlicher
 * Reihenfolge stehen; die Summe der Bruttominuten muss die Bruttodauer des
 * Eintrags sein. Beides wird geprueft und nicht angenommen: eine Verteilung
 * ueber eine unvollstaendige Teilmenge ergibt Zahlen, die fuer sich stimmig
 * aussehen und in der Summe eine Pause verlieren.
 */
export function verteilePauseAufAnteile(
  anteile: readonly { readonly monat: string; readonly bruttoMinuten: number }[],
  bruttoMinutenGesamt: number,
  pauseMinutenGesamt: number,
): readonly AnteilMitPause[] {
  const summe = anteile.reduce((s, a) => s + a.bruttoMinuten, 0);
  if (summe !== bruttoMinutenGesamt) {
    throw new ZeitFehler(
      `Die Monatsanteile ergeben ${String(summe)} Minuten, der Eintrag hat `
      + `${String(bruttoMinutenGesamt)}.`,
    );
  }
  if (pauseMinutenGesamt > bruttoMinutenGesamt) {
    throw new ZeitFehler('Die Pause ist laenger als die Schicht.');
  }
  const pausen = verteilePausenMinuten(
    anteile.map((a) => ({ jahr: 0, monat: 0, minuten: a.bruttoMinuten })),
    pauseMinutenGesamt,
  );
  return anteile.map((a, i) => {
    const pause = pausen[i] ?? 0;
    return {
      monat: a.monat,
      bruttoMinuten: a.bruttoMinuten,
      pauseMinuten: pause,
      nettoMinuten: a.bruttoMinuten - pause,
    };
  });
}

/**
 * Die Gegenprobe: teilen die Anteile die Schicht vollstaendig auf?
 *
 * Sie rechnet den Split ein zweites Mal — in TypeScript, mit
 * `splitteNachMonat` —, statt der Datenbank zu glauben. Das ist Absicht: die
 * Sicht und die Funktion sind zwei unabhaengige Umsetzungen DERSELBEN Regel
 * (Berliner Monatsgrenze als Zeitpunkt), und eine Abweichung zwischen ihnen
 * ist genau der Fehler, der sonst niemandem auffaellt. Wo beide dasselbe
 * sagen, ist es die Regel und nicht ein Zufall der einen Umsetzung.
 */
export function pruefeAnteileGegenSchicht(
  anteile: readonly { readonly monat: string; readonly bruttoMinuten: number }[],
  beginnUtc: Date,
  endeUtc: Date,
): void {
  const erwartet = splitteNachMonat(beginnUtc, endeUtc);
  if (erwartet.length !== anteile.length) {
    throw new ZeitFehler(
      `Die Sicht liefert ${String(anteile.length)} Anteile, die Rechnung `
      + `${String(erwartet.length)}.`,
    );
  }
  for (const [i, e] of erwartet.entries()) {
    const a = anteile[i];
    const monat = monatsErster(e.jahr, e.monat);
    if (a === undefined || a.monat !== monat || a.bruttoMinuten !== e.minuten) {
      throw new ZeitFehler(
        `Anteil ${String(i)}: Sicht ${a?.monat ?? '—'}/${String(a?.bruttoMinuten ?? 0)} `
        + `≠ Rechnung ${monat}/${String(e.minuten)}.`,
      );
    }
  }
  const summe = anteile.reduce((s, a) => s + a.bruttoMinuten, 0);
  const gesamt = dauerMinuten(beginnUtc, endeUtc);
  if (summe !== gesamt) {
    throw new ZeitFehler(`Die Anteile ergeben ${String(summe)} statt ${String(gesamt)} Minuten.`);
  }
}
