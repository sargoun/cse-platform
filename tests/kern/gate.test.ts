/**
 * PR 12 Akzeptanz (1)–(5) — Invariante 7.
 *
 * Der wichtigste Test hier ist (5): eine Aufzaehlung des GANZEN
 * Konfigurationsraums, die zeigt, dass keine Einstellung ein Angebot
 * automatisch hinausschickt. Ein Beispieltest zeigte nur, dass die eine
 * Konfiguration, an die jemand gedacht hat, es nicht tut.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AKTIONEN, FreigabeErforderlich, RechtsgrundlageFehlt, gate, nutzlastHash,
  type Freigabe, type Nutzlast, type Rechtsgrundlage, type Richtlinie,
} from '../../src/server/agent/policy.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function nutzlast(teil: Partial<Nutzlast> = {}): Nutzlast {
  return {
    aktion: 'email_senden', mandantId: 'm1',
    empfaengerRechtsgrundlage: 'einwilligung',
    inhalt: { betreff: 'Hallo', text: 'Text' },
    ...teil,
  };
}

function freigabe(teil: Partial<Freigabe> = {}, n: Nutzlast = nutzlast()): Freigabe {
  return {
    id: 'f1', aktion: n.aktion, mandantId: n.mandantId, status: 'genehmigt',
    freigegebenVon: 'mensch-1', nutzlastHash: nutzlastHash(n),
    ...teil,
  };
}

function richtlinie(teil: Partial<Richtlinie> = {}): Richtlinie {
  return {
    mandantId: 'm1', aktion: 'email_senden', autoErlaubt: true,
    maxBetragCent: null, ist_aktiv: true, ...teil,
  };
}

describe('(4) ohne konfigurierte Richtlinie VERWEIGERT das Gate', () => {
  it('fail-closed — eine fehlende Regel ist keine Erlaubnis', () => {
    const e = gate(nutzlast(), null, null);
    expect(e.erlaubt).toBe(false);
    if (e.erlaubt) return;
    expect(e.fehler).toBeInstanceOf(FreigabeErforderlich);
    // Sonst waere der Tag, an dem jemand die Konfiguration loescht, der Tag
    // mit den meisten automatischen Mails.
    expect(e.fehler.message).toMatch(/keine aktive Richtlinie/u);
  });

  it('eine deaktivierte Richtlinie ist dasselbe wie keine', () => {
    expect(gate(nutzlast(), null, richtlinie({ ist_aktiv: false })).erlaubt).toBe(false);
  });

  it('eine Richtlinie ohne auto_erlaubt verlangt eine Freigabe', () => {
    expect(gate(nutzlast(), null, richtlinie({ autoErlaubt: false })).erlaubt).toBe(false);
  });
});

describe('(3) LEG-08 ist ein HARTES Tor — auch eine Freigabe hebt es nicht auf', () => {
  it('ohne Rechtsgrundlage wird abgewiesen, ungeachtet jeder Freigabe', () => {
    const n = nutzlast({ empfaengerRechtsgrundlage: 'keine' });
    const e = gate(n, freigabe({}, n), richtlinie());
    expect(e.erlaubt).toBe(false);
    if (e.erlaubt) return;
    // § 7 UWG ist nicht etwas, das ein Mensch per Klick ausser Kraft setzt.
    expect(e.fehler).toBeInstanceOf(RechtsgrundlageFehlt);
  });

  it('mit jeder anderen Grundlage geht es durch', () => {
    for (const g of ['einwilligung', 'vertrag', 'berechtigtes_interesse', 'bestandskunde'] as const) {
      const n = nutzlast({ empfaengerRechtsgrundlage: g });
      expect(gate(n, freigabe({}, n), null).erlaubt, g).toBe(true);
    }
  });
});

describe('(2) eine nach der Freigabe geaenderte Nutzlast macht sie ungueltig', () => {
  it('Hash-Abweichung: der Versand wird verweigert', () => {
    const original = nutzlast();
    const f = freigabe({}, original);
    const geaendert = nutzlast({ inhalt: { betreff: 'Hallo', text: 'GANZ ANDERER TEXT' } });

    const e = gate(geaendert, f, null);
    expect(e.erlaubt).toBe(false);
    if (e.erlaubt) return;
    expect(e.fehler.message).toMatch(/nach der Freigabe geaendert/u);
  });

  it('die unveraenderte Nutzlast geht durch', () => {
    const n = nutzlast();
    expect(gate(n, freigabe({}, n), null)).toEqual({ erlaubt: true, grund: 'freigabe' });
  });

  it('der Hash ist stabil ueber die Schluesselreihenfolge', () => {
    // Sonst waere jede Freigabe zufaellig ungueltig, je nachdem in welcher
    // Reihenfolge jemand die Felder gesetzt hat.
    const a = nutzlast({ inhalt: { a: 1, b: 2 } });
    const b = nutzlast({ inhalt: { b: 2, a: 1 } });
    expect(nutzlastHash(a)).toBe(nutzlastHash(b));
  });

  it('aber nicht ueber den Inhalt', () => {
    expect(nutzlastHash(nutzlast({ inhalt: { a: 1 } })))
      .not.toBe(nutzlastHash(nutzlast({ inhalt: { a: 2 } })));
  });

  it('eine Freigabe fuer eine ANDERE Aktion traegt nicht', () => {
    const n = nutzlast();
    const fremd = freigabe({ aktion: 'mahnung_senden' }, n);
    expect(gate(n, fremd, null).erlaubt).toBe(false);
  });

  it('eine genehmigte Freigabe OHNE benannten Menschen traegt nicht', () => {
    // Invariante 7 verlangt einen Menschen, nicht einen Zustand.
    const n = nutzlast();
    expect(gate(n, freigabe({ freigegebenVon: null }, n), null).erlaubt).toBe(false);
  });

  it('eine offene oder abgelehnte Freigabe ebenso wenig', () => {
    const n = nutzlast();
    for (const status of ['offen', 'abgelehnt'] as const) {
      expect(gate(n, freigabe({ status }, n), null).erlaubt, status).toBe(false);
    }
  });
});

describe('(5) KEINE Konfiguration sendet ein Angebot automatisch', () => {
  /**
   * Der Aufzaehlungstest. Statt eines Beispiels wird der gesamte
   * Konfigurationsraum durchlaufen: jede Aktion, jede Rechtsgrundlage, jedes
   * auto_erlaubt, jedes Limit, jeder Betrag — und fuer `angebot_senden` darf
   * das Ergebnis nirgends `erlaubt` sein, solange keine Freigabe vorliegt.
   */
  const grundlagen: readonly Rechtsgrundlage[] =
    ['einwilligung', 'vertrag', 'berechtigtes_interesse', 'bestandskunde'];
  const limits: readonly (bigint | null)[] = [null, 0n, 1n, 1_999_999n, 2_000_000n, 999_999_999n];
  const betraege: readonly bigint[] = [0n, 1n, 1_999_999n, 2_000_000n, 2_000_001n, 50_000_000n];

  /**
   * Die drei Aktionen, die im CODE gesperrt sind — nicht in einer Zeile, die
   * jemand in der Oberflaeche umstellen kann.
   *
   * Geprueft wurde hier lange nur `angebot_senden`. `behinderung_senden` trug
   * seine Sperre ungeprueft, und `nachtrag_einreichen` trug ueberhaupt keine:
   * die Aktion stand im Typ, fehlte aber im Register `AKTIONEN`, ueber das
   * diese Schleife laeuft — sie war damit aus dem „ganzen Konfigurationsraum"
   * ausgenommen, den ihr Name verspricht. Unter einer Richtlinie mit
   * `auto_erlaubt` waere ein Nachtrag nach § 2 Abs. 6 VOB/B ohne einen
   * Menschen hinausgegangen (Invariante 7).
   *
   * Die Liste steht deshalb hier und nicht als drittes `if`: eine vierte
   * gesperrte Aktion faellt so nicht durch, sondern muss eingetragen werden.
   */
  const NIE_AUTOMATISCH: readonly string[] = [
    'angebot_senden', 'nachtrag_einreichen', 'behinderung_senden',
  ];

  it('ueber den ganzen Konfigurationsraum: nie automatisch', () => {
    let geprueft = 0;
    for (const aktion of AKTIONEN) {
      for (const grundlage of grundlagen) {
        for (const autoErlaubt of [true, false]) {
          for (const maxBetragCent of limits) {
            for (const betragCent of betraege) {
              for (const ist_aktiv of [true, false]) {
                geprueft += 1;
                const n = nutzlast({
                  aktion, empfaengerRechtsgrundlage: grundlage, betragCent,
                });
                const e = gate(n, null, richtlinie({
                  aktion, autoErlaubt, maxBetragCent, ist_aktiv,
                }));
                if (NIE_AUTOMATISCH.includes(aktion)) {
                  expect(e.erlaubt,
                    `${aktion} auto=${String(autoErlaubt)} limit=${String(maxBetragCent)} `
                    + `betrag=${String(betragCent)}`).toBe(false);
                }
                // Und ueber 20.000 € geht ueberhaupt nichts automatisch,
                // wenn das Limit darunter liegt.
                if (e.erlaubt && maxBetragCent !== null) {
                  expect(betragCent <= maxBetragCent).toBe(true);
                }
              }
            }
          }
        }
      }
    }
    // Die Aufzaehlung muss auch wirklich stattgefunden haben.
    expect(geprueft).toBe(
      AKTIONEN.length * grundlagen.length * 2 * limits.length * betraege.length * 2,
    );
  });

  it('ein Angebot geht mit menschlicher Freigabe raus — die Sperre trifft die AUTOMATIK', () => {
    // Sonst pruefte der Test nur, dass Angebote nie rausgehen.
    const n = nutzlast({ aktion: 'angebot_senden', betragCent: 50_000_000n });
    expect(gate(n, freigabe({ aktion: 'angebot_senden' }, n), null).erlaubt).toBe(true);
  });

  it('Nachtrag und Behinderungsanzeige gehen mit menschlicher Freigabe raus', () => {
    // Ohne diesen Fall pruefte die Schleife oben nur, dass sie NIE rausgehen —
    // und eine Sperre, die auch den Menschen aussperrt, waere kein Tor,
    // sondern eine Mauer.
    for (const aktion of ['nachtrag_einreichen', 'behinderung_senden'] as const) {
      const n = nutzlast({ aktion });
      expect(gate(n, freigabe({ aktion }, n), null).erlaubt, aktion).toBe(true);
    }
  });

  it('ueber dem Limit verweigert die Richtlinie', () => {
    const n = nutzlast({ aktion: 'mahnung_senden', betragCent: 2_000_001n });
    const e = gate(n, null, richtlinie({ aktion: 'mahnung_senden', maxBetragCent: 2_000_000n }));
    expect(e.erlaubt).toBe(false);
  });
});

describe('(1) es gibt genau EINEN Ausgang — der Waechter beweist es', () => {
  it('ein Mailtransport ausserhalb von server/versand bricht den Build', () => {
    const verzeichnis = mkdtempSync(join(tmpdir(), 'cse-ausgang-'));
    const src = join(verzeichnis, 'src', 'server', 'crm');
    execFileSync('mkdir', ['-p', src]);
    writeFileSync(join(src, 'schleichweg.ts'),
      "import nodemailer from 'nodemailer';\nexport const x = nodemailer;\n");
    execFileSync('cp', ['-r', join(WURZEL, 'scripts'), verzeichnis]);
    execFileSync('cp', [join(WURZEL, 'docs', 'DECISIONS.md'), verzeichnis]);
    execFileSync('mkdir', ['-p', join(verzeichnis, 'docs'), join(verzeichnis, 'drizzle'),
                           join(verzeichnis, 'supabase')]);
    execFileSync('cp', [join(WURZEL, 'docs', 'DECISIONS.md'), join(verzeichnis, 'docs')]);
    execFileSync('cp', [join(WURZEL, 'supabase', 'config.toml'), join(verzeichnis, 'supabase')]);

    let ausgabe = '';
    try {
      execFileSync(join(WURZEL, 'node_modules/.bin/tsx'), [join(verzeichnis, 'scripts/guards/run-all.ts')],
        { cwd: verzeichnis, encoding: 'utf8' });
    } catch (f) {
      const e = f as { stdout?: string; stderr?: string };
      ausgabe = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(ausgabe).toMatch(/ein-ausgang/u);
    expect(ausgabe).toMatch(/nodemailer/u);
  }, 120_000);

  it('und der echte Baum ist sauber', () => {
    // Ohne diese Zusage koennte der Waechter kaputt sein und niemand saehe es.
    const ausgabe = execFileSync(join(WURZEL, 'node_modules/.bin/tsx'),
      [join(WURZEL, 'scripts/guards/run-all.ts')], { cwd: WURZEL, encoding: 'utf8' });
    expect(ausgabe).toMatch(/alle sauber/u);
  }, 120_000);
});
