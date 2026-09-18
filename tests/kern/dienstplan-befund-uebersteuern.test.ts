/**
 * Eine Uebersteuerung, die null Zeilen geaendert hat, ist keine (TIM-06,
 * § 3/§ 4/§ 5 ArbZG, Invariante 5).
 *
 * **Der Befund.** `app.arbzg_befund_quittieren` aktualisiert
 * `where v.id = p_id and v.hinfaellig_am is null` und protokolliert danach
 * BEDINGUNGSLOS `arbzg.befund_quittiert`. Ein ueberholter Befund traegt aber
 * `hinfaellig_am is not null` bei weiterhin `status = 'offen'` — so schreibt
 * es `app.arbzg_befund_ueberholen`, weil eine Quittierung ihre Begruendung
 * behalten soll. Ohne Nachlese endete das als null geaenderte Zeilen, ein
 * Pruefprotokolleintrag ueber eine Uebersteuerung, die es nicht gibt, und ein
 * gruener Satz „Der Befund ist übersteuert" neben einem ArbZG-Block, der
 * weiter „offen" sagt.
 *
 * Erreichbar ist das durch das Rennen zwischen gerendertem Formular und
 * Nachtlauf (`raeumeAuf` in `arbzg/detektor.ts`) und durch jeden nachgebauten
 * POST.
 */
import { describe, expect, it } from 'vitest';
import {
  BefundNichtMehrAktuell, grenzwertIstMindestwert, uebersteuereBefund,
} from '../../src/server/services/dienstplan/konflikt.js';

function kontext(danach: { status: string; hinfaellig: boolean } | undefined) {
  const gerufen: string[] = [];
  return {
    gerufen,
    schreibe: async <T,>(sql: string): Promise<readonly T[]> => {
      gerufen.push(sql);
      return [] as readonly T[];
    },
    abfrage: async <T,>(): Promise<readonly T[]> => (
      (danach === undefined ? [] : [danach]) as unknown as readonly T[]
    ),
  };
}

describe('uebersteuereBefund liest den Erfolg nach', () => {
  it('ist still, wenn der Befund danach wirklich quittiert ist', async () => {
    const k = kontext({ status: 'quittiert', hinfaellig: false });
    await expect(uebersteuereBefund(k, 'be-1', 'Sonderlage, Ersatz war nicht zu holen'))
      .resolves.toBeUndefined();
    expect(k.gerufen[0]).toContain('app.arbzg_befund_quittieren');
  });

  it('wirft eine 409, wenn der Nachtlauf den Befund inzwischen abgeraeumt hat', async () => {
    /* Genau die Lage aus `app.arbzg_befund_ueberholen`: hinfaellig gesetzt,
       Status weiterhin offen. */
    const versuch = uebersteuereBefund(
      kontext({ status: 'offen', hinfaellig: true }), 'be-1', 'Begruendung lang genug');
    await expect(versuch).rejects.toBeInstanceOf(BefundNichtMehrAktuell);
    await versuch.catch((f: unknown) => {
      expect((f as { status: number }).status).toBe(409);
      expect((f as { message: string }).message).toContain('überholt');
    });
  });

  it('und ebenso, wenn die Zeile gar nicht mehr lesbar ist', async () => {
    await expect(uebersteuereBefund(kontext(undefined), 'be-1', 'Begruendung lang genug'))
      .rejects.toBeInstanceOf(BefundNichtMehrAktuell);
  });
});

describe('die Richtung des Grenzwerts bleibt richtig herum', () => {
  it('Ruhezeit ist eine MINDEST-, keine Hoechstgrenze (§ 5 ArbZG)', () => {
    expect(grenzwertIstMindestwert('ruhezeit_unter_11h')).toBe(true);
    expect(grenzwertIstMindestwert('tagesarbeitszeit_ueber_10h')).toBe(false);
  });
});
