/**
 * Stunden heute · Woche · Monat, das Stundenkonto und der Urlaub — aus der
 * Sicht des Menschen (EMP-03, EMP-04, EMP-05, EMP-15).
 *
 * **Die Kopfzahl ist GERECHNET, die Konten sind GETRENNT.** EMP-15 verlangt
 * beides in einem Satz: „hours shown combined across employments;
 * `stundenkonto` kept separately per employment". Eine gespeicherte Summe ueber
 * zwei Gesellschaften waere eine dritte Wahrheit neben zwei Lohnkonten — und
 * die erste, die bei einer Korrektur veraltet. `kombiniereKonten` aus
 * `zeit/stundenkonto.ts` ist die reine Funktion dafuer; dieser Dienst rechnet
 * sie nicht nach.
 *
 * **Die drei Fensterzahlen folgen EINER Regel**, und sie ist die des
 * Stundenkontos: ein Zeiteintrag wird an der Berliner Monatsgrenze geteilt
 * (`zeiteintrag_monatsanteil`, K-11), die erfasste Pause wird nach groesstem
 * Rest auf die Anteile verteilt (`verteilePauseAufAnteile`, §7.4), und jeder
 * Anteil zaehlt auf den Berliner Kalendertag, an dem er BEGINNT — genauso, wie
 * `bucheFreigegebeneZeiten` ihn bucht. Damit ist die Summe der Tage eines
 * Monats gleich der Summe des Monats, und die Nacht vom 31.10. auf den 01.11.
 * liegt in beiden Zahlen dort, wo das Lohnkonto sie hat.
 *
 * Der bequeme Gegenentwurf — „der Eintrag zaehlt ganz auf den Tag seines
 * Beginns" — kostet keine Zeile weniger und macht aus derselben Nacht in der
 * Kopfzeile eine andere Zahl als im Stundenkonto. Zwei plausible Zahlen fuer
 * dieselbe Schicht sind schlimmer als eine unbequeme Rechnung.
 *
 * **Die Kopfzahl zaehlt ERFASSTE Zeit, das Konto nur FREIGEGEBENE.** Das ist
 * kein Widerspruch, sondern der Unterschied zwischen „was ich gearbeitet habe"
 * und „was verbucht ist" — und er wird angezeigt, nicht weggerechnet.
 */
import type { LeseKontext } from '../../kontext/index.js';
import { verteilePauseAufAnteile } from '../zeit/monatsanteil.js';
import {
  kombiniereKonten, leseKonten, type KombinierteStunden, type Stundenkonto,
} from '../zeit/stundenkonto.js';
import { leseUrlaubskonten, type Urlaubskonto } from '../zeit/urlaubskonto.js';

/** Die drei Zahlen der Kopfzeile (EMP-03). */
export interface StundenFenster {
  readonly heuteMinuten: number;
  readonly wocheMinuten: number;
  readonly monatMinuten: number;
  /** Je Beschaeftigung im Monatsfenster — die Gesellschaft bleibt sichtbar. */
  readonly jeAnstellung: readonly {
    readonly anstellungId: string;
    readonly mandantId: string;
    readonly monatMinuten: number;
  }[];
}

export const STUNDEN_FENSTER_FELDER = [
  'heuteMinuten', 'wocheMinuten', 'monatMinuten', 'jeAnstellung',
] as const;

interface AnteilRoh {
  readonly zeiteintrag_id: string;
  readonly anstellung_id: string;
  readonly mandant_id: string;
  readonly tag: string;
  readonly monat: string;
  readonly brutto_minuten: number;
  readonly dauer_brutto_minuten: number | null;
  readonly pause_minuten: number;
}

export interface FensterEingabe {
  /** Der Berliner Kalendertag „heute" — aus der DATENBANK (`berlinHeute`). */
  readonly heute: string;
  /** Der Montag dieser Woche, `JJJJ-MM-TT`. */
  readonly wochenBeginn: string;
  /** Der Erste dieses Monats, `JJJJ-MM-TT`. */
  readonly monatsBeginn: string;
}

/**
 * Die drei Zahlen — in EINER Abfrage.
 *
 * Die Abfrage holt bewusst ALLE Anteile der betroffenen Eintraege und nicht
 * nur die des Fensters: die Pausenverteilung braucht die ganze Schicht. Wer
 * nur den Novemberteil einer Nacht vom 31.10. sieht, verteilt eine Pause auf
 * eine halbe Schicht und zeigt Minuten an, die es nicht gibt —
 * `verteilePauseAufAnteile` prueft das ausdruecklich und wirft.
 */
export async function leseStundenFenster(
  kontext: LeseKontext, eingabe: FensterEingabe,
): Promise<StundenFenster> {
  const fensterBeginn = eingabe.wochenBeginn < eingabe.monatsBeginn
    ? eingabe.wochenBeginn : eingabe.monatsBeginn;

  const roh = await kontext.abfrage<AnteilRoh>(
    `select m.zeiteintrag_id, m.anstellung_id, m.mandant_id,
            to_char(m.anteil_beginn at time zone 'Europe/Berlin', 'YYYY-MM-DD') as tag,
            to_char(m.monat, 'YYYY-MM-DD')                                      as monat,
            m.brutto_minuten,
            z.dauer_brutto_minuten,
            z.pause_minuten
       from zeiteintrag_monatsanteil m
       join zeiteintrag z on z.mandant_id = m.mandant_id and z.id = m.zeiteintrag_id
      where m.zeiteintrag_id in (
              select mm.zeiteintrag_id from zeiteintrag_monatsanteil mm
               where (mm.anteil_beginn at time zone 'Europe/Berlin')::date
                     between $1::date and $2::date)
      order by m.zeiteintrag_id asc, m.anteil_beginn asc`,
    [fensterBeginn, eingabe.heute],
  );

  const jeEintrag = new Map<string, AnteilRoh[]>();
  for (const z of roh) {
    const liste = jeEintrag.get(z.zeiteintrag_id) ?? [];
    liste.push(z);
    jeEintrag.set(z.zeiteintrag_id, liste);
  }

  let heute = 0;
  let woche = 0;
  let monat = 0;
  const jeAnstellung = new Map<string, { mandantId: string; minuten: number }>();

  for (const anteile of jeEintrag.values()) {
    const erste = anteile[0];
    if (erste === undefined || erste.dauer_brutto_minuten === null) continue;
    const verteilt = verteilePauseAufAnteile(
      anteile.map((a) => ({ monat: a.monat, bruttoMinuten: Number(a.brutto_minuten) })),
      Number(erste.dauer_brutto_minuten),
      Number(erste.pause_minuten),
    );
    for (const [i, teil] of verteilt.entries()) {
      const a = anteile[i];
      if (a === undefined) continue;
      if (a.tag === eingabe.heute) heute += teil.nettoMinuten;
      if (a.tag >= eingabe.wochenBeginn && a.tag <= eingabe.heute) {
        woche += teil.nettoMinuten;
      }
      if (a.tag >= eingabe.monatsBeginn && a.tag <= eingabe.heute) {
        monat += teil.nettoMinuten;
        const eintrag = jeAnstellung.get(a.anstellung_id)
          ?? { mandantId: a.mandant_id, minuten: 0 };
        eintrag.minuten += teil.nettoMinuten;
        jeAnstellung.set(a.anstellung_id, eintrag);
      }
    }
  }

  return {
    heuteMinuten: heute,
    wocheMinuten: woche,
    monatMinuten: monat,
    jeAnstellung: [...jeAnstellung].map(([anstellungId, w]) => ({
      anstellungId, mandantId: w.mandantId, monatMinuten: w.minuten,
    })),
  };
}

/** Ein Stundenkonto, so wie das Portal es zeigt — mit der O-18-Marke. */
export interface KontoAnsicht {
  readonly konto: Stundenkonto;
  readonly mandantSlug: string;
  readonly mandantName: string;
  readonly personalnummer: string | null;
  /**
   * Wahr, solange keine Sollzeit hinterlegt ist (O-18).
   *
   * `soll_minuten = 0` heisst „nicht hinterlegt" und NICHT „nichts
   * geschuldet" — der Unterschied ist im Portal der ganze Punkt. Ohne diese
   * Marke stuende auf dem Bildschirm „Soll: 0:00 h", und der Saldo daneben
   * behauptete, jede geleistete Minute sei eine Ueberstunde.
   */
  readonly sollOffen: boolean;
}

export interface StundenkontoUebersicht {
  readonly monat: { readonly jahr: number; readonly monat: number };
  readonly konten: readonly KontoAnsicht[];
  /** Die kombinierte Zahl (EMP-15) — gerechnet, nie gespeichert. */
  readonly kombiniert: KombinierteStunden | null;
  /**
   * Wahr, sobald EIN Konto keine Sollzeit traegt.
   *
   * Dann wird auch die kombinierte Sollzeit nicht angezeigt: die Summe aus
   * einer bekannten und einer unbekannten Zahl ist keine bekannte Zahl.
   */
  readonly sollOffen: boolean;
}

export const KONTO_ANSICHT_FELDER = [
  'konto', 'mandantSlug', 'mandantName', 'personalnummer', 'sollOffen',
] as const;

/**
 * Die Konten EINES Monats — eines je Beschaeftigung, plus die Summe.
 *
 * Die Beschriftung kommt aus `mandant`, nicht aus `anstellung`: `personalnummer`
 * ist die einzige Spalte der Beschaeftigung, die hier ueberhaupt auftaucht, und
 * ein Entgelt gibt `cse_app` die Tabelle gar nicht erst her (K-05).
 */
export async function leseStundenkonten(
  kontext: LeseKontext, jahr: number, monat: number,
): Promise<StundenkontoUebersicht> {
  const konten = await leseKonten(kontext, { jahr, monat });
  const beschriftung = await leseBeschriftungen(kontext);

  const ansichten = konten.map((k) => {
    const b = beschriftung.get(k.anstellungId);
    return {
      konto: k,
      mandantSlug: b?.slug ?? '',
      mandantName: b?.name ?? '',
      personalnummer: b?.personalnummer ?? null,
      sollOffen: k.sollMinuten === 0,
    } satisfies KontoAnsicht;
  });

  return {
    monat: { jahr, monat },
    konten: ansichten,
    kombiniert: konten.length === 0 ? null : kombiniereKonten(konten),
    sollOffen: ansichten.some((a) => a.sollOffen),
  };
}

export interface UrlaubAnsicht {
  readonly konto: Urlaubskonto;
  readonly mandantSlug: string;
  readonly mandantName: string;
}

export const URLAUB_ANSICHT_FELDER = ['konto', 'mandantSlug', 'mandantName'] as const;

/**
 * Der Urlaub je Beschaeftigung (EMP-05, EMP-15).
 *
 * **Es gibt keine Gesamtzahl.** Zwei Arbeitsverhaeltnisse haben zwei
 * Urlaubsansprueche gegen zwei Arbeitgeber; sie zu addieren ergaebe eine Zahl,
 * gegen die niemand einen Anspruch hat. Und solange `anspruchOffen` gilt
 * (O-18), steht dort ueberhaupt keine Zahl.
 */
export async function leseUrlaub(
  kontext: LeseKontext, jahr: number,
): Promise<readonly UrlaubAnsicht[]> {
  const konten = await leseUrlaubskonten(kontext, { jahr });
  const beschriftung = await leseBeschriftungen(kontext);
  return konten.map((k) => {
    const b = beschriftung.get(k.anstellungId);
    return { konto: k, mandantSlug: b?.slug ?? '', mandantName: b?.name ?? '' };
  });
}

interface BeschriftungRoh {
  readonly anstellung_id: string;
  readonly slug: string;
  readonly name: string;
  readonly personalnummer: string | null;
}

/** Beschaeftigung → Gesellschaft. Die Spaltenliste ist die von K-05. */
async function leseBeschriftungen(
  kontext: LeseKontext,
): Promise<ReadonlyMap<string, { slug: string; name: string; personalnummer: string | null }>> {
  const roh = await kontext.abfrage<BeschriftungRoh>(
    `select a.id as anstellung_id, m.slug, m.name, a.personalnummer
       from anstellung a join mandant m on m.id = a.mandant_id
      where a.geloescht_am is null`,
  );
  return new Map(roh.map((z) => [
    z.anstellung_id, { slug: z.slug, name: z.name, personalnummer: z.personalnummer },
  ]));
}
