/**
 * Ein Formular des Arbeiterportals endet auf einer SEITE — nie auf JSON
 * (V-198, D-599, D-692, EMP-07, EMP-09, EMP-10, EMP-11, EMP-12).
 *
 * **Der Befund.** Die Arbeiterseiten schicken echte `<form method="post">`
 * ohne JavaScript; mehrere Routen antworteten darauf mit JSON. Ein Einwand
 * endete auch bei ERFOLG in `{"einwand":"<uuid>"}` (201). Eine Krankmeldung
 * mit ungeklärter Art (O-139) endete in JSON mit dem deutschen Satz des
 * Dienstes. Im Wachbuch führte „Präsenz bestätigt" ohne Kontrollpunkt zu
 * JSON, und ein Urlaubsantrag ohne Datum zu einer 500 ohne Text. Wer Arabisch
 * eingestellt hat, sah JSON oder Deutsch.
 *
 * Geprüft werden: die Weiche selbst (`grundAufsFormularweg`) am echten
 * `NextRequest`, die Übersetzung des Datenbankfehlers am Antrag, die
 * Vollständigkeit der Sätze in vier Sprachen — und am Quelltext, dass keine
 * Schreibroute unter `api/mein` einem Formular mehr mit JSON antwortet, wo sie
 * einen Grund kennt, und jede Formularseite den Grund liest.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { grundAufsFormularweg } from '../../src/app/api/formular-antwort.js';
import {
  FORMULAR_FEHLER_GRUENDE, formularFehlerSatz, MEIN_FORMULAR_TEXTE,
} from '../../src/lib/i18n/mein-formular.js';
import { PORTAL_SPRACHEN } from '../../src/lib/i18n/texte.js';
import { pflichtfeldGrund } from '../../src/server/services/abwesenheit/antrag.js';
import { WachbuchEingabeFehlt } from '../../src/server/services/security/wachbuch.js';
import { dienstFehlerAntwort } from '../../src/app/api/mein/schichten/bruecke.js';

const WURZEL = resolve(import.meta.dirname, '../..');

function quelle(pfad: string): string {
  return readFileSync(join(WURZEL, pfad), 'utf8');
}

function dateien(verzeichnis: string, endung: string): string[] {
  const alle: string[] = [];
  for (const eintrag of readdirSync(verzeichnis)) {
    const voll = join(verzeichnis, eintrag);
    if (statSync(voll).isDirectory()) alle.push(...dateien(voll, endung));
    else if (voll.endsWith(endung)) alle.push(voll);
  }
  return alle;
}

function formular(felder: Readonly<Record<string, string>>): FormData {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.set(k, v);
  return daten;
}

const ANFRAGE = new NextRequest('https://cse.example/api/mein/abwesenheit', {
  method: 'POST', headers: { origin: 'https://cse.example' },
});

describe('grundAufsFormularweg — die Weiche zwischen Seite und JSON', () => {
  it('fehlerweg geht vor zurueck: der Fehlschlag kommt aufs Formular, nicht auf die Liste', () => {
    const r = grundAufsFormularweg(ANFRAGE, formular({
      zurueck: '/portal/mein/antraege', fehlerweg: '/portal/mein/abwesenheit/neu',
    }), 'art_ungeklaert', 409);
    expect(r.status).toBe(303);
    expect(r.headers.get('location'))
      .toBe('https://cse.example/portal/mein/abwesenheit/neu?fehler=art_ungeklaert');
  });

  it('ohne fehlerweg ist zurueck die Seite des Formulars — und eine Frage bleibt', () => {
    const r = grundAufsFormularweg(ANFRAGE, formular({
      zurueck: '/portal/mein/schichten/x/wachbuch?nachweis=1',
    }), 'praesenz_ohne_kontrollpunkt', 400);
    expect(r.headers.get('location')).toBe(
      'https://cse.example/portal/mein/schichten/x/wachbuch?nachweis=1'
      + '&fehler=praesenz_ohne_kontrollpunkt');
  });

  it('ohne beide Felder ist der Aufrufer ein Programm: JSON mit Status', async () => {
    const r = grundAufsFormularweg(ANFRAGE, formular({}), 'kein_datum', 400);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ fehler: 'kein_datum' });
  });

  it('nie nach draussen', () => {
    for (const weg of ['https://boese.example/', '//boese.example', '/.//boese.example']) {
      const r = grundAufsFormularweg(ANFRAGE, formular({ fehlerweg: weg }), 'x', 400);
      expect(new URL(r.headers.get('location') ?? '').origin, weg).toBe('https://cse.example');
    }
  });
});

describe('der Antrag: was die Datenbank abweist, wird ein Grund (0074)', () => {
  const pruefung = (hint: string): unknown =>
    Object.assign(new Error('x'), { code: '23514', hint, constraint_name: null });

  it('das fehlende Feld aus dem Hinweis des Auslösers', () => {
    expect(pflichtfeldGrund(pruefung('Fehlendes Feld: von_datum'))).toBe('fehlt_zeitraum');
    expect(pflichtfeldGrund(pruefung('Fehlendes Feld: abwesenheitsart_id')))
      .toBe('fehlt_abwesenheitsart');
    expect(pflichtfeldGrund(pruefung('Fehlendes Feld: einsatz_id'))).toBe('fehlt_einsatz');
    expect(pflichtfeldGrund(pruefung('Fehlendes Feld: tausch_partner_anstellung_id')))
      .toBe('fehlt_tauschpartner');
  });

  it('„bis vor von" ist die Prüfung an_zeitraum', () => {
    expect(pflichtfeldGrund(Object.assign(new Error('x'),
      { code: '23514', constraint_name: 'an_zeitraum' }))).toBe('zeitraum');
  });

  it('alles andere bleibt ein Fehler, den der Aufrufer weiterwirft', () => {
    expect(pflichtfeldGrund(pruefung('Fehlendes Feld: aenderungswunsch'))).toBeNull();
    expect(pflichtfeldGrund(Object.assign(new Error('x'), { code: '23505' }))).toBeNull();
    expect(pflichtfeldGrund(new Error('kaputt'))).toBeNull();
    expect(pflichtfeldGrund(null)).toBeNull();
  });

  it('jeder Hinweis des Auslösers hat einen Grund — gelesen aus der Migration', () => {
    const felder = [...quelle('drizzle/0074_antrag.sql')
      .matchAll(/hint = 'Fehlendes Feld: (\w+)'/gu)].map((m) => m[1] ?? '');
    expect(felder.length).toBeGreaterThanOrEqual(4);
    for (const feld of felder.filter((f) => f !== 'aenderungswunsch')) {
      expect(pflichtfeldGrund(pruefung(`Fehlendes Feld: ${feld}`)), feld).not.toBeNull();
    }
  });
});

describe('das Wachbuch sagt, WAS fehlt', () => {
  it('der Dienst trägt einen Grund neben dem Satz', () => {
    const f = new WachbuchEingabeFehlt('x', 'praesenz_ohne_kontrollpunkt');
    expect(f.code).toBe('ungueltige_eingabe');
    expect(f.grund).toBe('praesenz_ohne_kontrollpunkt');
    const q = quelle('src/server/services/security/wachbuch.ts');
    const ohneGrund = [...q.matchAll(/new WachbuchEingabeFehlt\(([\s\S]*?)\);/gu)]
      .filter((m) => !/'[a-z_]+',?\s*$/u.test((m[1] ?? '').trim()));
    expect(ohneGrund.map((m) => m[0])).toEqual([]);
  });
});

describe('jeder Grund hat einen Satz — in vier Sprachen', () => {
  it('jede Sprache trägt jeden Grund, und keiner ist leer', () => {
    for (const s of PORTAL_SPRACHEN) {
      const t = MEIN_FORMULAR_TEXTE[s];
      expect(Object.keys(t.gruende).sort(), s).toEqual([...FORMULAR_FEHLER_GRUENDE].sort());
      for (const g of FORMULAR_FEHLER_GRUENDE) expect(t.gruende[g].trim(), `${s}.${g}`).not.toBe('');
      for (const k of [
        'titel', 'sonst', 'einwandGesendetTitel', 'einwandGesendet', 'pflichtBei', 'nichtHier',
      ] as const) {
        expect(t[k].trim(), `${s}.${k}`).not.toBe('');
      }
      expect(t.pflichtBei, s).toContain('{arten}');
    }
  });

  it('keine Sprache ausser Deutsch gibt den deutschen Satz zurück', () => {
    for (const s of PORTAL_SPRACHEN.filter((x) => x !== 'de')) {
      const gleich = FORMULAR_FEHLER_GRUENDE.filter(
        (g) => MEIN_FORMULAR_TEXTE[s].gruende[g] === MEIN_FORMULAR_TEXTE.de.gruende[g]);
      expect(gleich, s).toEqual([]);
    }
  });

  it('ein fremder Grund wird der allgemeine Satz — nie der Schlüssel, nie der Prototyp', () => {
    for (const s of PORTAL_SPRACHEN) {
      for (const k of ['__proto__', 'constructor', 'toString', 'erfunden']) {
        expect(formularFehlerSatz(s, k), `${s}.${k}`).toBe(MEIN_FORMULAR_TEXTE[s].sonst);
      }
      expect(formularFehlerSatz(s, undefined)).toBeNull();
      expect(formularFehlerSatz(s, ['a', 'b'])).toBeNull();
    }
  });

  it('jeder Grund, den eine Route unter api/mein zurückschickt, steht in der Tabelle', () => {
    const quellen = [
      ...dateien(join(WURZEL, 'src/app/api/mein'), '.ts'),
      join(WURZEL, 'src/app/api/zeit/einwand/route.ts'),
    ].map((d) => readFileSync(d, 'utf8')).join('\n');
    const genannt = new Set([
      ...[...quellen.matchAll(/grundAufsFormularweg\(anfrage, daten, '([a-z_]+)'/gu)]
        .map((m) => m[1] ?? ''),
      ...[...quellen.matchAll(/zurueckMit\('([a-z_]+)'\)/gu)].map((m) => m[1] ?? ''),
      ...[...quellen.matchAll(/grund: '([a-z_]+)'/gu)].map((m) => m[1] ?? ''),
    ]);
    expect(genannt.size).toBeGreaterThan(20);
    const bekannt = new Set<string>(FORMULAR_FEHLER_GRUENDE);
    expect([...genannt].filter((g) => !bekannt.has(g))).toEqual([]);
  });
});

describe('am Quelltext: keine Formularroute antwortet mit JSON, wo sie einen Grund kennt', () => {
  const ROUTEN = [
    ...dateien(join(WURZEL, 'src/app/api/mein'), 'route.ts'),
    join(WURZEL, 'src/app/api/zeit/einwand/route.ts'),
  ];

  it('der Einwand leitet auch im Erfolg auf eine Seite', () => {
    const s = quelle('src/app/api/zeit/einwand/route.ts');
    expect(s).toMatch(/NextResponse\.redirect\(internesZiel\(zurueck/u);
  });

  it('… und zwar auf sein eigenes Blatt, das den Eingang bestätigt', () => {
    const s = quelle('src/app/portal/mein/zeiten/[id]/einwand/page.tsx');
    expect(s).toContain('name="zurueck" value={`/portal/mein/zeiten/${z.id}/einwand?gesendet=1`}');
    expect(s).toMatch(/suche\['gesendet'\] === '1'/u);
    expect(s).toContain('<EinwandGesendet sprache={basis.sprache} />');
  });

  it('nach dem Lesen des Formulars steht kein `NextResponse.json({ fehler: … })` mehr', () => {
    const funde: string[] = [];
    for (const datei of ROUTEN) {
      const s = readFileSync(datei, 'utf8');
      const ab = s.indexOf('anfrage.formData()');
      if (ab === -1) continue;
      /* Die Wächter VOR dem Formular (Ursprung, Sitzung, Kennung) bleiben JSON. */
      const rumpf = s.slice(ab);
      for (const m of rumpf.matchAll(/NextResponse\.json\(\s*\{\s*fehler:\s*'([a-z_]+)'/gu)) {
        funde.push(`${relative(WURZEL, datei)}: ${m[1] ?? ''}`);
      }
    }
    /*
     * Was bleibt, ist gewollt: ein fremder Datensatz (404, AUT-06) und die
     * Kennung einer unbekannten Handlung. Beides erreicht kein Formular
     * dieses Portals, nur ein Aufruf von Hand.
     */
    const erlaubt = /: (?:nicht_gefunden|unbekannter_vorgang|zweiter_faktor|keine_sitzung)$/u;
    expect(funde.filter((f) => !erlaubt.test(f))).toEqual([]);
  });

  it('der Dienstfehler der Schichtwege kennt das Formular', () => {
    for (const datei of dateien(join(WURZEL, 'src/app/api/mein/schichten'), 'route.ts')) {
      const s = readFileSync(datei, 'utf8');
      if (!s.includes('dienstFehlerAntwort(')) continue;
      expect(s, relative(WURZEL, datei)).toContain('dienstFehlerAntwort(fehler, { anfrage, daten })');
    }
  });
});

describe('dienstFehlerAntwort — die Weiche der Schichtwege, am Verhalten (V-198)', () => {
  /*
   * Bis hierhin war nur geprüft, dass die Routen den TEXT
   * `dienstFehlerAntwort(fehler, { anfrage, daten })` enthalten. Nähme die
   * Funktion `code` statt `grund`, zeigte die Wachbuchseite den allgemeinen
   * Satz zu `ungueltige_eingabe` statt „Präsenz ohne Kontrollpunkt" — und
   * kein Test schlüge an.
   */
  const WACHBUCH = '/portal/mein/schichten/5b0d6c1e-0a41-4c55-9d1c-1c2f3b4a5d6e/wachbuch';
  const SCHICHT_ANFRAGE = new NextRequest('https://cse.example/api/mein/schichten/x/wachbuch', {
    method: 'POST', headers: { origin: 'https://cse.example' },
  });

  it('ein Grund des Dienstes geht vor seinem Code — als Seite mit `?fehler=`', () => {
    const r = dienstFehlerAntwort(new WachbuchEingabeFehlt('x', 'praesenz_ohne_kontrollpunkt'),
      { anfrage: SCHICHT_ANFRAGE, daten: formular({ zurueck: WACHBUCH }) });
    expect(r?.status).toBe(303);
    expect(r?.headers.get('location'))
      .toBe(`https://cse.example${WACHBUCH}?fehler=praesenz_ohne_kontrollpunkt`);
  });

  it('ohne Grund reist der Code', () => {
    const ohne = Object.assign(new Error('Satz mit Kennung 5b0d6c1e'), {
      code: 'ungueltiger_zustand', status: 409,
    });
    const r = dienstFehlerAntwort(ohne,
      { anfrage: SCHICHT_ANFRAGE, daten: formular({ zurueck: WACHBUCH }) });
    expect(r?.headers.get('location')).toBe(`https://cse.example${WACHBUCH}?fehler=ungueltiger_zustand`);
    /* Ein leerer Grund ist keiner. */
    const leer = Object.assign(new Error('x'), { code: 'konflikt', status: 409, grund: '' });
    expect(dienstFehlerAntwort(leer, { anfrage: SCHICHT_ANFRAGE, daten: formular({ zurueck: WACHBUCH }) })
      ?.headers.get('location')).toBe(`https://cse.example${WACHBUCH}?fehler=konflikt`);
  });

  it('fehlerweg geht vor zurueck, wie bei jedem Formular', () => {
    const r = dienstFehlerAntwort(new WachbuchEingabeFehlt('x', 'kein_text'), {
      anfrage: SCHICHT_ANFRAGE,
      daten: formular({ zurueck: '/portal/mein/schichten', fehlerweg: WACHBUCH }),
    });
    expect(r?.headers.get('location')).toBe(`https://cse.example${WACHBUCH}?fehler=kein_text`);
  });

  it('ohne Formular ist der Aufrufer ein Programm: JSON mit Status und Code', async () => {
    const r = dienstFehlerAntwort(new WachbuchEingabeFehlt('Satz', 'praesenz_ohne_kontrollpunkt'));
    expect(r?.status).toBe(400);
    expect(await r?.json()).toEqual({ fehler: 'ungueltige_eingabe', meldung: 'Satz' });
  });

  it('ein Programmfehler ist keine Aussage für den Menschen: `null`', () => {
    expect(dienstFehlerAntwort(new Error('kaputt'),
      { anfrage: SCHICHT_ANFRAGE, daten: formular({ zurueck: WACHBUCH }) })).toBeNull();
    expect(dienstFehlerAntwort(Object.assign(new Error('x'), { code: '23505' }))).toBeNull();
  });
});

describe('jede Formularseite liest den Grund und zeigt ihn', () => {
  const SEITEN = [
    'src/app/portal/mein/zeiten/[id]/einwand/page.tsx',
    'src/app/portal/mein/abwesenheit/neu/page.tsx',
    'src/app/portal/mein/abwesenheit/[id]/page.tsx',
    'src/app/portal/mein/antraege/neu/page.tsx',
    'src/app/portal/mein/antraege/[id]/page.tsx',
    'src/app/portal/mein/dienstanweisungen/[id]/page.tsx',
    'src/app/portal/mein/nachrichten/[id]/page.tsx',
    'src/app/portal/mein/schichten/[zuordnungId]/wachbuch/page.tsx',
    'src/app/portal/mein/schichten/[zuordnungId]/fotos/page.tsx',
    'src/app/portal/mein/schichten/[zuordnungId]/leistungsnachweis/page.tsx',
    'src/app/portal/mein/schichten/[zuordnungId]/bautagebuch/page.tsx',
  ] as const;

  it.each(SEITEN)('%s', (seite) => {
    const s = quelle(seite);
    expect(s).toContain('<FormularFehler');
    expect(s).toMatch(/\['fehler'\]/u);
  });

  it('ein Formular, dessen Erfolg auf eine Liste führt, kommt im Fehlschlag auf sich selbst zurück', () => {
    for (const seite of [
      'src/app/portal/mein/abwesenheit/neu/page.tsx',
      'src/app/portal/mein/antraege/neu/page.tsx',
      'src/app/portal/mein/zeiten/[id]/einwand/page.tsx',
      'src/app/portal/mein/dienstanweisungen/[id]/page.tsx',
      'src/app/portal/mein/antraege/[id]/page.tsx',
      'src/app/portal/mein/abwesenheit/[id]/page.tsx',
    ]) {
      expect(quelle(seite), seite).toContain('name="fehlerweg"');
    }
  });
});
