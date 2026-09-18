/**
 * Die zwei Grenzen von `legeAusnahmeAn`, die als HTTP 500 endeten (TIM-02,
 * §6.4, 0029, 0069).
 *
 * **Befund 1 — eine Zahl, zwei Aufrufer.** `legeAusnahmeAn` liess
 * `dauerMinuten` bis einschliesslich 1440 zu, `nominalesEnde` wirft aber ab
 * `MAX_DAUER_MINUTEN` (= 1439). Bei `zusatz` und `verschiebung` laeuft der
 * Generator in DERSELBEN Transaktion: `nominalesEnde` warf einen
 * `PlanungsFehler`, der weder `code` noch `status` traegt, `alsAntwort` gab
 * `null` zurueck, die Route warf weiter — HTTP 500, Transaktion
 * zurueckgerollt, kein Hinweis fuer den Planer. Genau dieselbe Inkonsistenz
 * hatte `pruefeTurnusEingabe` schon einmal.
 *
 * **Befund 2 — ein Doppelklick ist kein Serverfehler.**
 * `posten_ausnahme_uk` ist UNBEDINGT `(posten_id, datum)`, auch fuer
 * `zusatz`. Der Unique-Verstoss kam als roher Postgres-Fehler `23505`
 * zurueck; `alsAntwort` erkennt nur Fehler mit `code` UND `status`. Ein
 * zweiter Klick auf „Ausnahme anlegen" produzierte damit eine 500 statt
 * „für diesen Tag gibt es schon eine Ausnahme".
 *
 * Ohne Datenbank: beide Aussagen sind Aussagen ueber den DIENST, und sie
 * muessen auf einem Rechner ohne Postgres fallen.
 */
import { describe, expect, it } from 'vitest';
import {
  AusnahmeNichtTragfaehig, SerieEingabeFehlt, legeAusnahmeAn,
} from '../../src/server/services/dienstplan/serie.js';
import { MAX_DAUER_MINUTEN } from '../../src/server/services/dienstplan/vorkommnisse.js';
import type { SchreibKontext } from '../../src/server/kontext/index.js';

/** Eine Postenserie (Sicherheit) — `posten_ausnahme` traegt das harte UK. */
const SERIE = { turnus_id: null, posten_id: 'po-1', veranstaltung_id: null };

function kontext(schreibt: () => Promise<readonly unknown[]>): SchreibKontext {
  return {
    scope: 'mandant',
    portal: 'intern',
    benutzerId: 'be-1',
    aktiverMandantId: 'ma-1',
    mandantIds: ['ma-1'],
    abfrage: async <T,>() => [SERIE] as unknown as readonly T[],
    schreibe: async <T,>() => (await schreibt()) as readonly T[],
  } as unknown as SchreibKontext;
}

const EINGABE = {
  planungsserieId: 'ps-1',
  datum: '2026-10-03',
  art: 'zusatz' as const,
  ersatzZeit: '22:00',
  grund: 'Sonderlage Tag der Deutschen Einheit',
};

describe('legeAusnahmeAn kennt dieselbe Dauergrenze wie der Generator', () => {
  it('weist 1440 Minuten mit einer Meldung ab, nicht mit einem Serverfehler', async () => {
    const versuch = legeAusnahmeAn(
      kontext(async () => { throw new Error('darf nicht geschrieben werden'); }),
      { ...EINGABE, dauerMinuten: 1440 });
    await expect(versuch).rejects.toBeInstanceOf(SerieEingabeFehlt);
  });

  it('und laesst genau MAX_DAUER_MINUTEN durch — die Grenze liegt bei 1439', async () => {
    expect(MAX_DAUER_MINUTEN).toBe(1439);
    /* Bis zum `insert` kommt der Aufruf; dort endet dieser Test mit einer
       erkennbaren Marke, statt eine Datenbank zu brauchen. */
    const marke = new Error('bis zum insert gekommen');
    const versuch = legeAusnahmeAn(
      kontext(async () => { throw marke; }),
      { ...EINGABE, dauerMinuten: MAX_DAUER_MINUTEN });
    await expect(versuch).rejects.toBe(marke);
  });
});

describe('ein Unique-Verstoss wird uebersetzt, nicht durchgereicht', () => {
  const pgFehler = (code: string): Error => Object.assign(new Error('pg'), { code });

  it('23505 wird zu AusnahmeNichtTragfaehig (409) statt zu einer 500', async () => {
    const versuch = legeAusnahmeAn(
      kontext(async () => { throw pgFehler('23505'); }), EINGABE);
    await expect(versuch).rejects.toBeInstanceOf(AusnahmeNichtTragfaehig);
    await versuch.catch((f: unknown) => {
      expect((f as { status: number }).status).toBe(409);
      expect((f as { code: string }).code).toBe('nicht_tragfaehig');
    });
  });

  it('23514 ebenso — eine verletzte Pruefbedingung ist eine Eingabe, kein Absturz',
    async () => {
      const versuch = legeAusnahmeAn(
        kontext(async () => { throw pgFehler('23514'); }), EINGABE);
      await expect(versuch).rejects.toBeInstanceOf(AusnahmeNichtTragfaehig);
    });

  it('jeder andere Fehler bleibt ein roter Lauf', async () => {
    const fremd = pgFehler('42P01');
    const versuch = legeAusnahmeAn(kontext(async () => { throw fremd; }), EINGABE);
    await expect(versuch).rejects.toBe(fremd);
  });
});
