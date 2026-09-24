/**
 * Der Kommunikationsverlauf und das Festhalten am Kunden — was sich ohne
 * Datenbank beweisen lässt (CRM-03, V-147, D-641).
 *
 * Die Abfragen selbst (Aktivitäten UND Nachrichten, Mandantengrenze, das
 * UWG-Tor beim Festhalten) prüft `tests/isolation/crm-verlauf.test.ts` an
 * echten Zeilen.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CrmFehler } from '../../src/server/services/crm/anlegen.js';
import { planeNotiz } from '../../src/server/services/crm/verlauf.js';
import { VERLAUF_TEXTE } from '../../src/lib/i18n/verwaltung/crm-verlauf.js';

const WURZEL = resolve(import.meta.dirname, '../..');

/** Die Werte einer Aufzählung, so wie die Migration sie anlegt. */
function aufzaehlung(datei: string, typ: string): readonly string[] {
  const sql = readFileSync(resolve(WURZEL, 'drizzle', datei), 'utf8');
  const treffer = new RegExp(`create type ${typ}\\s+as enum\\s*\\(([^)]*)\\)`, 'u').exec(sql);
  expect(treffer, `${typ} in ${datei}`).not.toBeNull();
  return [...(treffer?.[1] ?? '').matchAll(/'([a-z_]+)'/gu)].map((m) => m[1] ?? '');
}

function grundVon(fn: () => unknown): string {
  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof CrmFehler) return e.grund;
    throw e;
  }
  throw new Error('kein Fehler');
}

describe('planeNotiz — aus der Eingabe wird eine Zeile', () => {
  it('eine Notiz bleibt intern, gleich was das Formular schickt', () => {
    const p = planeNotiz({ art: 'notiz', richtung: 'ausgehend', zweck: 'werbung',
      inhalt: 'Rückruf vereinbart' });
    expect(p.richtung).toBe('intern');
    expect(p.kanal).toBeNull();
    expect(p.zweck).toBe('intern');
  });

  it('ein ausgehender Anruf geht übers Telefon, mit dem gewählten Zweck', () => {
    const p = planeNotiz({ art: 'anruf', richtung: 'ausgehend', zweck: 'vertraglich',
      inhalt: 'Termin bestätigt' });
    expect(p).toMatchObject({ richtung: 'ausgehend', kanal: 'telefon', zweck: 'vertraglich' });
  });

  it('ein interner Anruf hat keinen Kanal und keinen Zweck nach draussen', () => {
    const p = planeNotiz({ art: 'anruf', richtung: 'intern', zweck: 'werbung', inhalt: 'x' });
    expect(p).toMatchObject({ richtung: 'intern', kanal: null, zweck: 'intern' });
  });

  it('V-153: ohne Zweck kein ein- oder ausgehender Eintrag — keine Vorgabe entscheidet ihn', () => {
    /*
     * Hier galt ohne Zweck `vertraglich` — die Klasse, die das UWG-Tor nie
     * sperrt. Wer nicht aktiv „Werbung" wählte, erzeugte einen § 7-Beleg
     * „vertraglich". Jetzt muss der Mensch wählen.
     */
    expect(grundVon(() => planeNotiz({ art: 'email', richtung: 'eingehend',
      inhalt: 'Anfrage per Mail' }))).toBe('ohne_zweck');
    expect(grundVon(() => planeNotiz({ art: 'anruf', richtung: 'ausgehend',
      inhalt: 'Rückruf' }))).toBe('ohne_zweck');
    // Gewählt, gilt die Wahl — und nie `intern` für etwas, das das Haus verlässt.
    const p = planeNotiz({ art: 'email', richtung: 'eingehend', zweck: 'transaktional',
      inhalt: 'Anfrage per Mail' });
    expect(p).toMatchObject({ zweck: 'transaktional', kanal: 'email' });
    // Eine interne Notiz braucht keinen Zweck; das leere Feld des Formulars reicht.
    expect(planeNotiz({ art: 'notiz', richtung: 'intern', inhalt: 'x' }).zweck).toBe('intern');
    expect(planeNotiz({ art: 'anruf', richtung: 'intern', inhalt: 'x' }).zweck).toBe('intern');
  });

  it('V-153: das Formular wählt keinen Zweck vor', () => {
    const bauteil = readFileSync(
      resolve(WURZEL, 'src/components/portal/Kommunikationsverlauf.tsx'), 'utf8');
    expect(bauteil).toContain('<select name="zweck" defaultValue=""');
    expect(bauteil).not.toContain('defaultValue="vertraglich"');
  });

  it('ohne Betreff steht die erste Zeile, gekürzt auf 80 Zeichen', () => {
    const lang = 'A'.repeat(120);
    expect(planeNotiz({ art: 'notiz', richtung: 'intern', inhalt: `Erste\nZweite` }).betreff)
      .toBe('Erste');
    expect(planeNotiz({ art: 'notiz', richtung: 'intern', inhalt: lang }).betreff)
      .toHaveLength(80);
    expect(planeNotiz({ art: 'notiz', richtung: 'intern', betreff: ' Eigener ',
      inhalt: 'x' }).betreff).toBe('Eigener');
  });

  it('weist ab, was ein Mensch lesen können muss', () => {
    expect(grundVon(() => planeNotiz({ art: 'notiz', richtung: 'intern', inhalt: '  ' })))
      .toBe('ohne_inhalt');
    expect(grundVon(() => planeNotiz({ art: 'fax', richtung: 'intern', inhalt: 'x' })))
      .toBe('unbekannte_art');
    expect(grundVon(() => planeNotiz({ art: 'anruf', richtung: 'quer', inhalt: 'x' })))
      .toBe('unbekannte_richtung');
    expect(grundVon(() => planeNotiz({ art: 'anruf', richtung: 'ausgehend', zweck: 'intern',
      inhalt: 'x' }))).toBe('unbekannter_zweck');
  });
});

describe('die Texte kennen jeden Wert — keine rohen Schlüssel (D-592)', () => {
  const sprachen = ['de', 'en'] as const;

  it('jede Art, Richtung, jeder Zweck und jede Grundlage aus 0017', () => {
    const arten = [...aufzaehlung('0017_lead.sql', 'aktivitaet_typ'), 'nachricht'];
    const richtungen = aufzaehlung('0017_lead.sql', 'aktivitaet_richtung');
    const zwecke = aufzaehlung('0017_lead.sql', 'kommunikationszweck');
    const grundlagen = aufzaehlung('0017_lead.sql', 'rechtsgrundlage');
    for (const s of sprachen) {
      const t = VERLAUF_TEXTE[s];
      for (const w of arten) expect(t.arten[w], `${s} art ${w}`).toBeTruthy();
      for (const w of richtungen) expect(t.richtungen[w], `${s} richtung ${w}`).toBeTruthy();
      for (const w of zwecke) expect(t.zwecke[w], `${s} zweck ${w}`).toBeTruthy();
      for (const w of grundlagen) expect(t.grundlagen[w], `${s} grundlage ${w}`).toBeTruthy();
    }
  });

  it('jeder Kanal beider Tabellen und jeder Zustellstand aus 0231', () => {
    const kanaele = [
      'email', 'telefon', 'sms', 'post', 'whatsapp', 'vor_ort', 'portal',
      ...aufzaehlung('0231_nachricht_faden.sql', 'nachricht_kanal'),
    ];
    const zustellung = aufzaehlung('0231_nachricht_faden.sql', 'zustell_status');
    for (const s of sprachen) {
      const t = VERLAUF_TEXTE[s];
      for (const w of kanaele) expect(t.kanaele[w], `${s} kanal ${w}`).toBeTruthy();
      for (const w of zustellung) expect(t.zustellung[w], `${s} zustellung ${w}`).toBeTruthy();
    }
  });

  it('jeder Grund, den der Dienst werfen kann, hat einen Satz in beiden Sprachen', () => {
    /*
     * Die Route schickt nur den Schlüssel (`?notiz=`). Ein Schlüssel ohne
     * Satz käme als „Nicht festgehalten." ohne Grund an — gelesen wird die
     * Quelle, damit ein neuer Wurf ohne Übersetzung hier auffällt.
     */
    const quelle = readFileSync(
      resolve(WURZEL, 'src/server/services/crm/verlauf.ts'), 'utf8');
    const gruende = [...quelle.matchAll(/new CrmFehler\([\s\S]*?'([a-z_]+)'(?:,\s*\d+)?\)/gu)]
      .map((m) => m[1] ?? '');
    expect(gruende.length).toBeGreaterThanOrEqual(8);
    for (const s of sprachen) {
      for (const g of gruende) {
        expect(VERLAUF_TEXTE[s].notizFehler[g], `${s}: ${g}`).toBeTruthy();
      }
    }
  });
});
