/**
 * **Der Weg zur neuen Referenz ist verdrahtet — von der Liste, vom Auftrag, bis
 * auf das Blatt der neuen Zeile** (V-154, V-161, D-648, D-654, PRO-05).
 *
 * Was die Datenbank tut, prüft `tests/isolation/referenz-anlegen.test.ts`.
 * Hier steht, dass ein Mensch dorthin KOMMT: vorher gab es keinen Knopf, keine
 * Seite, keine Handlung in der Route — und der Hinweis an der Kundenfreigabe
 * versprach einen Weg, den es nicht gab. Und seit V-161: dass der Weg über
 * einen abgeschlossenen Auftrag führt, und dass die Antwort der Route wirklich
 * dorthin zeigt, wo sie hinzeigen soll — geprüft am Verhalten, nicht am Text.
 */
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { routeMitPfad } from '../../src/server/registry/routen.js';
import { WEBSITE_REFERENZ_TEXTE } from '../../src/lib/i18n/verwaltung/website-referenz.js';
import {
  RUECKGABE_LAENGE, antwortNachAbweisung, antwortNachHandlung,
} from '../../src/app/api/website/gemeinsam.js';
import { RedaktionFehler } from '../../src/server/services/inhalt/redaktion.js';
import {
  REFERENZFAEHIGE_ZUSTAENDE, referenzHindernis, referenzfaehig,
} from '../../src/server/services/auftrag/kundenfreigabe.js';

const lies = (pfad: string): string => readFileSync(pfad, 'utf8');

function formularPost(url: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST', body: new FormData(), headers: { origin: new URL(url).origin },
  });
}

const ANFRAGE = formularPost('https://cse.example/api/website/referenz');
const ort = (antwort: Response): URL => new URL(antwort.headers.get('location') ?? '');

describe('die Liste bietet das Anlegen an — auch im Leerzustand', () => {
  const liste = lies('src/app/portal/[mandant]/website/referenzen/page.tsx');

  it('der Knopf führt auf /neu und steht nur mit BEIDEN Rechten', () => {
    expect(liste).toContain('/website/referenzen/neu');
    expect(liste).toMatch(/darfAnlegen = !nurLesen && darf\['referenz\.schreiben'\] === true\s+&& darf\['referenz\.kundenfreigabe_erfassen'\] === true/u);
  });

  it('der Leerzustand trägt ihn — dort fehlte er am meisten', () => {
    const leer = /cse="keine-referenzen">([\s\S]*?)<\/Hinweis>/u.exec(liste)?.[1] ?? '';
    expect(leer).toContain('anlegenKnopf');
  });
});

describe('die Seite und die Route', () => {
  it('/neu steht in der Seitenkarte, mit dem Tor der übrigen Referenzseiten', () => {
    const r = routeMitPfad('/portal/[mandant]/website/referenzen/neu');
    expect(r).toBeDefined();
    expect(r?.bewachung).toEqual({
      art: 'recht', lesen: ['referenz.schreiben'], schreiben: [], aal2: false,
    });
  });

  it('die Route kennt „anlegen" — VOR der Kennungsprüfung, mit dem Auftrag', () => {
    const route = lies('src/app/api/website/referenz/route.ts');
    const anlegen = route.indexOf("handlung === 'anlegen'");
    const kennung = route.indexOf('UUID.test(id)');
    expect(anlegen).toBeGreaterThan(-1);
    expect(anlegen).toBeLessThan(kennung);
    expect(route).toContain('legeReferenzAn(kontext');
    expect(route).toContain("auftragId: rumpf.felder['auftrag']");
    // Die Herkunft reist NICHT mehr in der Adresse mit (0410).
    expect(route).not.toContain('&auftrag=');
    // Die kurzen Eingaben gehen bei einer Abweisung zurück — nie die Beschreibung.
    expect(route).toContain("['titel', 'slug', 'kundeName', 'jahr']");
    expect(route).toMatch(/rueckgabe: \(rumpf\) => \(rumpf\.felder\['handlung'\] === 'anlegen'/u);
  });

  it('jeder Grund des Anlegens hat einen Satz — in beiden Sprachen', () => {
    for (const grund of ['titel_fehlt', 'slug_form', 'slug_vergeben', 'jahr_ungueltig',
      'kein_freigaberecht', 'nicht_angelegt', 'auftrag_fehlt', 'auftrag_ohne_freigabe',
      'auftrag_offen', 'auftrag_storniert']) {
      expect(WEBSITE_REFERENZ_TEXTE.de.fehler[grund], `de.${grund}`).toBeDefined();
      expect(WEBSITE_REFERENZ_TEXTE.en.fehler[grund], `en.${grund}`).toBeDefined();
    }
    expect(WEBSITE_REFERENZ_TEXTE.en.anlegen).not.toBe(WEBSITE_REFERENZ_TEXTE.de.anlegen);
  });
});

/**
 * **Die Weiche des Gerüsts, am Verhalten geprüft** (V-161).
 *
 * Die erste Fassung prüfte `{ weiter }` nur am Quelltext
 * (`toContain('ergebnis.weiter')`). Hier läuft die Funktion, die
 * `fuehreWebsiteAus` nach der Handlung aufruft, mit einer echten Anfrage.
 */
describe('antwortNachHandlung: wohin es nach der Handlung geht', () => {
  const form = (zurueck?: string) => ({
    json: false, felder: zurueck === undefined ? {} : { zurueck },
  });

  it('{ weiter } führt auf das Blatt der neuen Zeile — mit 303', () => {
    const antwort = antwortNachHandlung(ANFRAGE, form('/portal/reinigung/website/referenzen/neu'),
      { weiter: '/portal/reinigung/website/referenzen/3f2a8c1e-0b7d-4e59-9a61-2d4c8e7f1a0b?angelegt=1' });
    expect(antwort.status).toBe(303);
    const ziel = ort(antwort);
    expect(ziel.origin).toBe('https://cse.example');
    expect(ziel.pathname)
      .toBe('/portal/reinigung/website/referenzen/3f2a8c1e-0b7d-4e59-9a61-2d4c8e7f1a0b');
    expect(ziel.searchParams.get('angelegt')).toBe('1');
    // Nicht zurück aufs Formular: dort entstünde beim zweiten Klick die zweite.
    expect(ziel.pathname).not.toContain('/neu');
  });

  it('{ weiter } nach draussen bleibt im eigenen Ursprung', () => {
    for (const weiter of ['https://boese.example/x', '//boese.example', '/.//boese.example']) {
      expect(ort(antwortNachHandlung(ANFRAGE, form('/portal'), { weiter })).origin, weiter)
        .toBe('https://cse.example');
    }
  });

  it('eine Zeichenkette hängt an den Rückweg, null führt nur zurück', () => {
    expect(ort(antwortNachHandlung(ANFRAGE, form('/portal/x?a=1'), 'gespeichert=felder')).search)
      .toBe('?a=1&gespeichert=felder');
    expect(ort(antwortNachHandlung(ANFRAGE, form('/portal/x'), null)).pathname).toBe('/portal/x');
  });

  it('ein JSON-Aufrufer bekommt das Ergebnis — keinen Umweg', async () => {
    const antwort = antwortNachHandlung(ANFRAGE, { json: true, felder: {} }, { weiter: '/portal' });
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ ergebnis: { weiter: '/portal' } });
  });
});

describe('antwortNachAbweisung: der Grund und die kurzen Eingaben gehen zurück', () => {
  const fehler = new RedaktionFehler('Adresse vergeben', 'slug_vergeben');

  it('zurück aufs Formular mit ?fehler= und den Eingaben — nichts ist weg', () => {
    const antwort = antwortNachAbweisung(ANFRAGE,
      { json: false, felder: { zurueck: '/portal/reinigung/website/referenzen/neu?auftrag=a' } },
      fehler, { titel: 'Büroreinigung Mitte', slug: '', kundeName: 'Muster & Söhne', jahr: '2025' });
    expect(antwort.status).toBe(303);
    const ziel = ort(antwort);
    expect(ziel.pathname).toBe('/portal/reinigung/website/referenzen/neu');
    expect(ziel.searchParams.get('auftrag')).toBe('a');
    expect(ziel.searchParams.get('fehler')).toBe('slug_vergeben');
    expect(ziel.searchParams.get('titel')).toBe('Büroreinigung Mitte');
    expect(ziel.searchParams.get('kundeName')).toBe('Muster & Söhne');
    expect(ziel.searchParams.get('jahr')).toBe('2025');
    // Ein leerer Wert reist nicht mit.
    expect(ziel.searchParams.has('slug')).toBe(false);
  });

  it('kein Wert ist länger als ein Feld — und keiner überschreibt den Grund', () => {
    const lang = 'x'.repeat(5000);
    const ziel = ort(antwortNachAbweisung(ANFRAGE,
      { json: false, felder: { zurueck: '/portal/x' } }, fehler,
      { titel: lang, fehler: 'etwas_anderes' }));
    expect(ziel.searchParams.get('titel')).toHaveLength(RUECKGABE_LAENGE);
    expect(ziel.searchParams.getAll('fehler')).toEqual(['slug_vergeben']);
  });

  it('ohne Rückweg JSON mit Satz — 404 nur für nicht_gefunden', async () => {
    const antwort = antwortNachAbweisung(ANFRAGE, { json: false, felder: {} }, fehler);
    expect(antwort.status).toBe(400);
    expect(await antwort.json()).toEqual({ fehler: 'slug_vergeben', meldung: 'Adresse vergeben' });
    expect(antwortNachAbweisung(ANFRAGE, { json: true, felder: { zurueck: '/portal' } },
      new RedaktionFehler('weg', 'nicht_gefunden')).status).toBe(404);
  });

  it('ein Rückweg nach draussen bleibt im eigenen Ursprung', () => {
    expect(ort(antwortNachAbweisung(ANFRAGE,
      { json: false, felder: { zurueck: '/.//boese.example' } }, fehler)).origin)
      .toBe('https://cse.example');
  });

  it('das Gerüst benutzt genau diese beiden Antworten', () => {
    const geruest = lies('src/app/api/website/gemeinsam.ts');
    expect(geruest).toContain('return antwortNachHandlung(anfrage, rumpf, ergebnis);');
    expect(geruest).toContain('antwortNachAbweisung(anfrage, rumpf, fehler, lauf.rueckgabe?.(rumpf) ?? {})');
  });
});

/**
 * **Eine Referenz ist ein ABGESCHLOSSENER Auftrag mit geltender Freigabe**
 * (SPEC PRO-05, V-161, D-654) — und die Regel steht an EINER Stelle.
 */
describe('referenzHindernis: wann aus einem Auftrag eine Referenz entstehen darf', () => {
  const stand = (status: string, freigegeben = true, widerrufen_am: string | null = null) =>
    ({ status, freigegeben, widerrufen_am });

  it('abgeschlossen und freigegeben: bereit', () => {
    expect(referenzHindernis(stand('abgeschlossen'))).toBeNull();
    expect(referenzfaehig(stand('abgeschlossen'))).toBe(true);
    expect(REFERENZFAEHIGE_ZUSTAENDE).toEqual(['abgeschlossen']);
  });

  it('ohne Freigabe oder nach einem Widerruf: nie — auch abgeschlossen nicht', () => {
    expect(referenzHindernis(stand('abgeschlossen', false))).toBe('ohne_freigabe');
    expect(referenzHindernis(stand('abgeschlossen', true, '01.04.2026 10:00')))
      .toBe('ohne_freigabe');
  });

  it('laufend, ruhend, nicht begonnen: noch nicht (O-914) — storniert: gar nicht', () => {
    for (const s of ['angelegt', 'aktiv', 'pausiert']) {
      expect(referenzHindernis(stand(s)), s).toBe('nicht_abgeschlossen');
      expect(referenzfaehig(stand(s)), s).toBe(false);
    }
    expect(referenzHindernis(stand('storniert'))).toBe('storniert');
  });
});

describe('vom Auftrag aus — nur aus einem abgeschlossenen, nur als Vorschlag', () => {
  it('die Kundenfreigabe am Auftrag verlinkt die Anlage nur, wenn eine Referenz entstehen darf', () => {
    const seite = lies('src/app/portal/[mandant]/auftraege/[id]/kundenfreigabe/page.tsx');
    expect(seite).toContain('const gilt = freigabeGilt(stand)');
    expect(seite).toMatch(/referenzfaehig\(stand\) && darf\['referenz\.schreiben'\] === true\s+&& sitzung\.ansicht !== 'gruppe'/u);
    expect(seite).toContain('/website/referenzen/neu?auftrag=${id}');
    // Läuft der Auftrag noch, sagt der Absatz, wann der Weg aufgeht.
    expect(seite).toContain("referenzHindernis(stand) === 'nicht_abgeschlossen'");
    // Und der alte Satz „keinen Verweis auf den Auftrag" stimmt seit 0410 nicht mehr.
    expect(seite).not.toContain('keinen Verweis auf den Auftrag');
  });

  it('das Anlegeformular belegt nur Titel und Kunde vor — aus einem bereiten Auftrag', () => {
    const neu = lies('src/app/portal/[mandant]/website/referenzen/neu/page.tsx');
    expect(neu).toContain('referenzHindernis(stand)');
    expect(neu).toContain("defaultValue={zurueckgegeben('titel') ?? stand.bezeichnung}");
    expect(neu).toContain("defaultValue={zurueckgegeben('kundeName') ?? stand.kunde}");
    // Kein Auftragswert, kein Ansprechpartner, kein Wortlaut im Formular.
    expect(neu).not.toMatch(/stand\.(ansprechpartner|freigabe_text)/u);
    // Die Beschreibung steht erst auf dem Blatt — sie reist in keiner Adresse.
    expect(neu).not.toContain('name="beschreibung"');
  });

  it('ohne auftrag.lesen sagt die Seite, welches Recht fehlt — nichts über den Auftrag', () => {
    const neu = lies('src/app/portal/[mandant]/website/referenzen/neu/page.tsx');
    expect(neu).toContain('<Recht schluessel="auftrag.lesen"');
    expect(neu).toMatch(/const daten = !liestAuftraege \? null/u);
    // Die Aussage „keine geltende Freigabe" steht nur, wo der Auftrag gelesen wurde.
    expect(neu).toMatch(/stand !== null && hindernis === 'ohne_freigabe'/u);
  });

  it('das Blatt schlägt aus der EIGENEN Herkunft vor — nicht aus der Adresse', () => {
    const blatt = lies('src/app/portal/[mandant]/website/referenzen/[id]/page.tsx');
    expect(blatt).toContain('vorschlag?.freigabe_tag');
    expect(blatt).toContain('defaultChecked={r.freigegeben}');
    expect(blatt).not.toMatch(/defaultChecked=\{[^}]*vorschlag/u);
    expect(blatt).toContain('ladeFreigabestand(kontext, referenz.auftragId)');
    expect(blatt).not.toContain("suche['auftrag']");
  });
});

describe('Veröffentlichen: eine Abweisung ist ein Satz, kein JSON', () => {
  it('die Route leitet mit dem Grund zurück, und beide Seiten lesen ihn', () => {
    expect(lies('src/app/api/website/referenzen/route.ts')).toContain('grundAufsFormular(');
    for (const seite of ['src/app/portal/[mandant]/website/referenzen/page.tsx',
      'src/app/portal/[mandant]/website/referenzen/[id]/veroeffentlichen/page.tsx']) {
      // Nur ein EIGENER Schlüssel (V-159): `?fehler=__proto__` ist kein Grund.
      expect(lies(seite), seite)
        .toContain('eigenerEintrag(t.statusFehler, abgewiesen) ?? t.statusFehlerSonst');
    }
    for (const s of ['de', 'en'] as const) {
      expect(WEBSITE_REFERENZ_TEXTE[s].statusFehler['ohne_kundenfreigabe']).toBeDefined();
    }
  });
});

/**
 * **Die vier Seiten sprechen EINE Sprache** (V-161). V-154 hatte nur die neuen
 * Sätze übersetzt; in einer englischen Sitzung standen „Referenzen" und „Für
 * diese Gesellschaft ist noch kein Projekt erfasst." neben dem englischen
 * Knopf. Die Sprachwache (`seite-ohne-uebersetzung`) führt die Seiten jetzt
 * nicht mehr als Ausnahme — sie fände jede neue feste Beschriftung.
 */
describe('die Referenzseiten stehen nicht mehr in der Ausnahmeliste der Sprachwache', () => {
  it('Liste, Blatt und Veröffentlichen sind gestrichen', () => {
    const ausnahmen = lies('scripts/guards/uebersetzung-ausnahmen.ts');
    for (const seite of ['website/referenzen/page.tsx', 'website/referenzen/[id]/page.tsx',
      'website/referenzen/[id]/veroeffentlichen/page.tsx']) {
      expect(ausnahmen, seite).not.toContain(`src/app/portal/[mandant]/${seite}`);
    }
  });

  it('beide Sprachen haben dieselben Schlüssel — und keine leeren Sätze', () => {
    const de = WEBSITE_REFERENZ_TEXTE.de;
    const en = WEBSITE_REFERENZ_TEXTE.en;
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    for (const [schluessel, wert] of Object.entries(de)) {
      if (typeof wert === 'string') {
        expect(wert, `de.${schluessel}`).not.toBe('');
        expect((en as unknown as Record<string, unknown>)[schluessel], `en.${schluessel}`)
          .not.toBe('');
      }
    }
    for (const tabelle of ['fehler', 'blattFehler', 'statusFehler', 'auftragStand',
      'referenzStand'] as const) {
      expect(Object.keys(en[tabelle]).sort(), tabelle).toEqual(Object.keys(de[tabelle]).sort());
    }
  });
});
