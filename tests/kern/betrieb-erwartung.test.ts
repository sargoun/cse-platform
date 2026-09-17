/**
 * **Der Erwartungsabstand — die Zahl, an der ein Fehlalarm hängt.**
 *
 * Die Betriebsüberwachung nennt einen Lauf ausgeblieben, wenn er länger
 * ausbleibt als das Doppelte seines Abstands. Diese Zahl kommt aus dem Cron
 * des Jobs, und damit hängt alles daran, dass sie NICHT zu klein ist:
 *
 *  - Zu klein heisst Fehlalarm. Ein Bildschirm, der grundlos rot ist, wird
 *    nach zwei Wochen nicht mehr gelesen — und dann steht der echte Ausfall
 *    auch darin. Das ist schlimmer als gar keine Überwachung, weil niemand
 *    mehr nachsieht.
 *  - Zu gross heisst: ein Ausfall fällt später auf. Unangenehm, aber er fällt
 *    auf.
 *
 * Deshalb rundet `erwartungsabstand` nach OBEN und `fensterMinuten` nach
 * UNTEN, und deshalb stehen die beiden hier nebeneinander: es sind zwei
 * Fragen, und eine Funktion für beide wäre für eine davon falsch.
 */
import { describe, expect, it } from 'vitest';
import { alleJobs, vergissRegistrierung } from '../../src/server/jobs/bootstrap.js';
import { leereRegister } from '../../src/server/jobs/registry.js';
import { erwartungsabstand, fensterMinuten } from '../../src/server/jobs/zeitplan.js';
import {
  alterText, ausloeserLage, erwartungText,
} from '../../src/server/services/betrieb/ueberwachung.js';

const nie = (): never => {
  throw new Error('Der Erwartungsabstand stellt keine Abfragen.');
};

function jobs() {
  leereRegister();
  vergissRegistrierung();
  return alleJobs({ unsafe: nie, begin: nie });
}

/** Kurz: den bekannten Abstand in Minuten, sonst `null`. */
function minuten(zeitplan: string): number | null {
  const e = erwartungsabstand(zeitplan);
  return e.art === 'bekannt' ? e.minuten : null;
}

describe('erwartungsabstand — wann ein Lauf spätestens wieder da sein muss', () => {
  it('stündlich, fünfminütlich, täglich', () => {
    expect(minuten('0 * * * *')).toBe(60);
    expect(minuten('*/5 * * * *')).toBe(5);
    expect(minuten('15 2 * * *')).toBe(1440);
    expect(minuten('*/15 */6 * * *')).toBe(6 * 60 - 45);
  });

  /**
   * **Die Stundenspanne ist der Fall, an dem sich die beiden Rundungen
   * trennen.** `30 8-18 * * *` läuft elfmal am Tag, aber zwischen dem letzten
   * Lauf um 18:30 und dem ersten des Folgetages um 08:30 liegen vierzehn
   * Stunden. Wer hier „eine Stunde" annähme — wie `fensterMinuten` es zu
   * Recht tut, weil es die andere Frage stellt —, meldete den Lauf jede Nacht
   * um 09:31 als ausgeblieben.
   */
  it('eine Stundenspanne wird über die Nacht gerechnet, nicht über den Tag', () => {
    expect(minuten('30 8-18 * * *')).toBe(14 * 60);
    expect(fensterMinuten('30 8-18 * * *')).toBe(60);
  });

  it('eine Minutenliste nennt ihren grössten Abstand', () => {
    /* 15 und 45: die Lücke von 45 nach 15 ist die halbe Stunde. */
    expect(minuten('15,45 * * * *')).toBe(30);
    /* 0 und 5: die Lücke von 5 zurück auf 0 ist der Rest der Stunde. */
    expect(minuten('0,5 * * * *')).toBe(55);
  });

  /**
   * **Ein Kalenderfeld macht die Frage unbeantwortbar** — und dann sagt die
   * Funktion das. Der Basiszinssatz läuft am 15. Juni und am 15. Dezember;
   * mit Minute und Stunde allein wäre sein Abstand „ein Tag", und der Wächter
   * stünde ab dem 16. Juni ein halbes Jahr lang auf Rot.
   */
  it('Monatstag, Monat und Wochentag bleiben unbeurteilt — mit Grund', () => {
    for (const plan of ['0 6 15 6,12 *', '0 3 * * 1', '0 3 1 * *']) {
      const e = erwartungsabstand(plan);
      expect(e.art, plan).toBe('unbestimmt');
      if (e.art !== 'unbestimmt') return;
      expect(e.grund).toMatch(/Monatstag|Monat|Wochentag/u);
      expect(e.grund.length).toBeGreaterThan(40);
    }
    const halbjahr = erwartungsabstand('0 6 15 6,12 *');
    expect(halbjahr.art === 'unbestimmt' && halbjahr.grund).toMatch(/Monatstag und Monat/u);
  });

  /**
   * **Was sie nicht liest, behauptet sie nicht** — und anders als
   * `fensterMinuten` wirft sie dabei nicht. Ein unlesbarer Zeitplan darf den
   * Überwachungsbildschirm nicht umwerfen; er darf nur keine Aussage tragen.
   */
  it('ein unlesbares Feld ergibt „unbestimmt" und keinen Absturz', () => {
    for (const plan of ['x * * * *', '0-99 * * * *', '*/0 * * * *', '0 25 * * *', '0 *']) {
      expect(erwartungsabstand(plan).art, plan).toBe('unbestimmt');
    }
  });

  /**
   * **Jeder wirklich registrierte Job bekommt eine Antwort.** Ein neuer Job
   * mit einem Zeitplan, den niemand liest, würde sonst still aus der
   * Überwachung fallen — genau die Sorte Lücke, gegen die sie gebaut ist.
   */
  it('jeder registrierte Job ist entweder beurteilbar oder erklärt begründet, warum nicht', () => {
    const alle = jobs();
    expect(alle.length).toBeGreaterThan(0);
    let beurteilbar = 0;
    for (const j of alle) {
      const e = erwartungsabstand(j.zeitplan);
      if (e.art === 'bekannt') {
        beurteilbar += 1;
        expect(e.minuten, j.schluessel).toBeGreaterThan(0);
        /* Nach oben gerundet: nie kleiner als das Idempotenzfenster. */
        expect(e.minuten, j.schluessel).toBeGreaterThanOrEqual(fensterMinuten(j.zeitplan));
      } else {
        expect(e.grund, j.schluessel).toMatch(/Monatstag|Monat|Wochentag|nicht gelesen/u);
      }
    }
    /* Die grosse Mehrheit muss beurteilbar sein — sonst überwacht sie nichts. */
    expect(beurteilbar).toBeGreaterThan(alle.length * 0.8);
  });
});

describe('die Sätze, die auf dem Bildschirm stehen', () => {
  it('ein Alter wird zum Satz und nicht zu 187 Minuten', () => {
    expect(alterText(0.4)).toBe('gerade eben');
    expect(alterText(42)).toBe('vor 42 Minuten');
    expect(alterText(187)).toBe('vor 3 Stunden');
    expect(alterText(60 * 72)).toBe('vor 3 Tagen');
  });

  it('der Erwartungsabstand ebenso — und ein unbestimmter nennt seinen Grund', () => {
    expect(erwartungText({ art: 'bekannt', minuten: 5 })).toBe('alle 5 Minuten');
    expect(erwartungText({ art: 'bekannt', minuten: 1440 })).toBe('einmal täglich');
    expect(erwartungText({ art: 'bekannt', minuten: 840 })).toBe('alle 14 Stunden');
    expect(erwartungText({ art: 'unbestimmt', grund: 'Weil.' })).toBe('Weil.');
  });
});

/**
 * **Die Frage vor allen anderen: läuft überhaupt etwas?** Ohne `pg_cron`
 * startet kein einziger Wächter (D-540), und dann heisst „noch nie gelaufen"
 * bei siebzehn Jobs nicht siebzehn Fehler, sondern einen.
 */
describe('die Auskunft über den Auslöser', () => {
  it('ohne die Erweiterung nennt sie die Ursache und den Weg dorthin', () => {
    const a = ausloeserLage(false, null, 17);
    expect(a.text).toMatch(/pg_cron/u);
    expect(a.text).toMatch(/jobs:plan/u);
  });

  it('mit Erweiterung, aber ohne Leserecht, behauptet sie nichts', () => {
    const a = ausloeserLage(true, null, 17);
    expect(a.text).toMatch(/nicht lesbar/u);
    expect(a.text).not.toMatch(/Alle 17/u);
  });

  it('zu wenige Einträge sind ein Befund und keine Beruhigung', () => {
    expect(ausloeserLage(true, 9, 17).text).toMatch(/9 von 17/u);
    expect(ausloeserLage(true, 17, 17).text).toMatch(/Alle 17/u);
  });
});
