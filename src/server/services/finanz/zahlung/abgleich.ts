import 'server-only';
import { cent, type Cent } from '../geld.js';
import type { Abfrage } from './index.js';

/**
 * Der naechtliche Abgleich der offenen Posten (ACC-07, `05-FINANZEN.md`
 * §7.3, §10).
 *
 * **Warum es ihn gibt.** `offener_posten.bezahlt_cent` ist eine
 * FORTGESCHRIEBENE Zahl: die Ausloeser aus 0121 erhoehen sie bei jeder
 * Zuordnung und jedem Ausgleich. Das ist noetig — der Mahnlauf muss sich
 * erinnern, was er gemahnt hat, und eine Altersliste muss nachtraeglich
 * reproduzierbar sein. Es ist aber auch die Stelle, an der ein Rechenfehler
 * still bleibt: die Zahl steht da, sie sieht plausibel aus, und niemand
 * rechnet sie nach.
 *
 * Dieser Lauf rechnet sie nach — aus den Belegzeilen, ueber die Sicht
 * `offener_posten_berechnet`, also auf einem anderen Weg als der Ausloeser
 * ihn geht. Dieselbe Bauart wie der Kettenlauf (§5.7): zwei Wege zu
 * derselben Zahl.
 *
 * **Er repariert nicht.** `cse_job` haelt auf `offener_posten` genau EIN
 * Schreibrecht: `neu_berechnet_am`, den Stempel „geprueft am". `bezahlt_cent`
 * ist fuer ihn unerreichbar — nicht, weil dieser Code es unterlaesst, sondern
 * weil das Spaltenrecht es verbietet. Ein Pruefer, der reparieren koennte,
 * bezeugt nichts mehr.
 */

export interface PostenAbweichung {
  readonly postenId: string;
  readonly rechnungsnummer: string | null;
  readonly gefuehrtCent: Cent;
  readonly berechnetCent: Cent;
  readonly abweichungCent: Cent;
}

export interface AbgleichBefund {
  readonly ok: boolean;
  readonly geprueft: number;
  /** Nach absteigender Abweichung — die groesste zuerst. */
  readonly abweichungen: readonly PostenAbweichung[];
}

interface AbweichungZeile {
  readonly id: string;
  readonly rechnungsnummer: string | null;
  readonly bezahlt_gefuehrt_cent: string;
  readonly bezahlt_berechnet_cent: string;
  readonly abweichung_cent: string;
}

/**
 * Prueft alle Posten des gebundenen Mandanten und stempelt jeden geprueften.
 *
 * Der Stempel steht auf ALLEN Zeilen, nicht nur auf den unauffaelligen: die
 * Frage, die er beantwortet, ist „wann hat zuletzt jemand hingesehen" — und
 * die ist bei einer abweichenden Zeile die wichtigere.
 */
export async function gleicheOffenePostenAb(db: Abfrage): Promise<AbgleichBefund> {
  const zeilen = await db.abfrage<AbweichungZeile>(
    `select b.id, r.nummer as rechnungsnummer,
            b.bezahlt_gefuehrt_cent::text, b.bezahlt_berechnet_cent::text,
            b.abweichung_cent::text
       from offener_posten_berechnet b
       join offener_posten op on op.id = b.id
       left join rechnung r on r.id = op.rechnung_id and r.mandant_id = op.mandant_id
      where b.abweichung_cent <> 0
      order by abs(b.abweichung_cent) desc, r.nummer nulls last`);

  /**
   * Der Stempel, und die Zahl der geprueften Zeilen in einem Zug: `returning`
   * gibt genau die Zeilen zurueck, die die Policy des Laufs erreicht hat. Ein
   * getrenntes `count(*)` zaehlte eine andere Menge, sobald die Policy oder
   * der Binder einmal nicht traegt — und meldete dann „500 geprueft", ohne
   * eine einzige gesehen zu haben.
   */
  const gestempelt = await db.abfrage<{ id: string }>(
    `update offener_posten set neu_berechnet_am = now() returning id`);

  return {
    ok: zeilen.length === 0,
    geprueft: gestempelt.length,
    abweichungen: zeilen.map((z) => ({
      postenId: z.id,
      rechnungsnummer: z.rechnungsnummer,
      gefuehrtCent: cent(BigInt(z.bezahlt_gefuehrt_cent)),
      berechnetCent: cent(BigInt(z.bezahlt_berechnet_cent)),
      abweichungCent: cent(BigInt(z.abweichung_cent)),
    })),
  };
}

/**
 * Die Meldung nennt die RECHNUNGSNUMMER und den Betrag — nicht „es gibt eine
 * Abweichung". Eine Wache, deren Meldung erst eine Untersuchung ausloest,
 * kostet die Zeit, die sie sparen soll.
 */
export function meldung(befund: AbgleichBefund): string {
  if (befund.ok) {
    return `Offene Posten abgeglichen: ${befund.geprueft} geprüft, keine Abweichung.`;
  }
  const erste = befund.abweichungen.slice(0, 5).map((a) => {
    const wer = a.rechnungsnummer ?? `Posten ${a.postenId.slice(0, 8)}`;
    return `${wer}: geführt ${a.gefuehrtCent} Cent, berechnet ${a.berechnetCent} Cent `
      + `(${a.abweichungCent > 0n ? '+' : ''}${a.abweichungCent})`;
  });
  const rest = befund.abweichungen.length > 5
    ? ` … und ${befund.abweichungen.length - 5} weitere`
    : '';
  return `Offene Posten: ${befund.abweichungen.length} von ${befund.geprueft} weichen ab. `
    + erste.join(' · ') + rest;
}
