/**
 * Die Rückwege der Formulare kommen an (V-148, D-642, D-562, D-599).
 *
 * **Der Befund.** Drei Muster, dieselbe Lücke: eine Route leitet eine
 * Abweisung mit einem Grund auf die Seite zurück, und die Seite liest ihn
 * nicht.
 *
 *  1. `/crm/kunden/[id]` nahm keine Suchparameter an; `POST /api/crm/kunde`
 *     schickte `?meldung=`. Ein Ansprechpartner mit „Bestandskunde" ohne
 *     Quelle verschwand ohne Satz. (Seit D-772 schickt die Route nur noch den
 *     Grund, `?grund=`; der Satz steht auf dem Blatt.)
 *  2. Vier Recruiting-Seiten schicken `zurueck` auf sich selbst,
 *     `fuehreRecruitingAus` hängt `?fehler=<grund>` an — keine der vier las
 *     ihn.
 *
 * Geprüft wird hier (a), dass die Seiten den Parameter lesen und das
 * Rückmeldebauteil tragen, und (b), dass JEDER Grund, den die jeweilige Route
 * werfen kann, in beiden Sprachen einen Satz hat. Ein Grund ohne Satz fiele
 * auf „Der Vorgang wurde abgewiesen." zurück — ehrlich, aber ohne das, was
 * der Mensch ändern muss.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RECRUITING_RUECKMELDUNG } from '../../src/lib/i18n/verwaltung/recruiting-rueckmeldung.js';
import { KUNDE_RUECKMELDUNG } from '../../src/lib/i18n/verwaltung/crm-kunde.js';
import {
  grundAus, RecruitingRueckmeldung, VERMERKTE_GRUENDE,
} from '../../src/app/portal/[mandant]/recruiting/rueckmeldung.js';
import { NotizKeinRecht } from '../../src/components/portal/Kommunikationsverlauf.js';
import { RECRUITING_GESPRAECH_TEXTE } from '../../src/lib/i18n/verwaltung/recruiting-gespraech.js';
import { RECRUITING_KANDIDAT_TEXTE } from '../../src/lib/i18n/verwaltung/recruiting-kandidat.js';
import { SOCIAL_BILD_TEXTE } from '../../src/lib/i18n/verwaltung/social-bild.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';

const WURZEL = resolve(import.meta.dirname, '../..');
/*
 * Die Bauteile sind `.tsx` mit der klassischen JSX-Umwandlung dieses
 * Testläufers — sie erwarten `React` im Geltungsbereich. Nur für das Rendern
 * der Rückmeldungen unten (V-153).
 */
(globalThis as { React?: typeof React }).React = React;
const lies = (pfad: string): string => readFileSync(resolve(WURZEL, pfad), 'utf8');

/** Die Gründe, die ein Quelltext als `RecruitingFehler`/`CrmFehler` oder als `grund:` nennt. */
function gruende(quelle: string, klasse: 'RecruitingFehler' | 'CrmFehler'): readonly string[] {
  const geworfen = [...quelle.matchAll(
    new RegExp(`new ${klasse}\\([\\s\\S]*?'([a-z_]+)'(?:,\\s*\\d+)?\\)`, 'gu'))]
    .map((m) => m[1] ?? '');
  const zurueck = [...quelle.matchAll(/grund:\s*'([a-z_]+)'/gu)].map((m) => m[1] ?? '');
  return [...new Set([...geworfen, ...zurueck])];
}

/** Der Rumpf EINER exportierten Funktion — bis zur nächsten. */
function funktion(quelle: string, name: string): string {
  const a = quelle.indexOf(`export async function ${name}`);
  expect(a, name).toBeGreaterThan(-1);
  const e = quelle.indexOf('\nexport ', a + 1);
  return quelle.slice(a, e === -1 ? undefined : e);
}

const SEITEN = [
  ['src/app/portal/[mandant]/recruiting/kandidaten/[id]/bewertung/page.tsx', 'bewertung'],
  ['src/app/portal/[mandant]/recruiting/kandidaten/[id]/entscheidung/page.tsx', 'entscheidung'],
  ['src/app/portal/[mandant]/recruiting/stellen/neu/page.tsx', 'stelleNeu'],
  ['src/app/portal/[mandant]/recruiting/stellen/[id]/veroeffentlichung/page.tsx',
    'veroeffentlichung'],
] as const;

describe('(a) die vier Recruiting-Seiten lesen ihren Rückweg', () => {
  it.each(SEITEN)('%s nimmt searchParams und zeigt die Rückmeldung', (pfad, seite) => {
    const quelle = lies(pfad);
    expect(quelle).toContain('searchParams');
    expect(quelle).toContain('grundAus(');
    expect(quelle).toContain(`seite="${seite}"`);
    // Und das Formular schickt `zurueck` wirklich auf DIESE Seite.
    expect(quelle).toMatch(/name="zurueck"/u);
  });

  it('die Veröffentlichung liest auch ihren Erfolg (?gesendet=1)', () => {
    const quelle = lies(SEITEN[3][0]);
    expect(quelle).toContain("suche['gesendet'] === '1'");
    expect(quelle).toContain('VeroeffentlichtHinweis');
    expect(lies('src/app/api/recruiting/stellen/[id]/veroeffentlichen/route.ts'))
      .toContain('?gesendet=1');
  });

  it('V-153: ein vermerkter Versuch heisst „Nicht veröffentlicht." — nicht „Nicht gespeichert."', () => {
    const html = (grund: string, sprache: 'de' | 'en' = 'de'): string => renderToStaticMarkup(
      createElement(RecruitingRueckmeldung, { sprache, seite: 'veroeffentlichung', grund }));
    // Geschrieben ist geschrieben (`api/recruiting/gemeinsam.ts`): der Versuch steht im Vermerk.
    for (const grund of ['kanal_nicht_verbunden', 'veroeffentlichung_fehlgeschlagen']) {
      expect(VERMERKTE_GRUENDE.veroeffentlichung?.has(grund)).toBe(true);
      expect(html(grund)).toContain('Nicht veröffentlicht.');
      expect(html(grund)).not.toContain('Nicht gespeichert.');
      expect(html(grund)).toContain('vermerkt');
      expect(html(grund, 'en')).toContain('Not published.');
    }
    // Eine Abweisung vor dem Schreiben bleibt „Nicht gespeichert.".
    expect(html('geschlossen')).toContain('Nicht gespeichert.');
    expect(renderToStaticMarkup(createElement(RecruitingRueckmeldung,
      { sprache: 'de', seite: 'bewertung', grund: 'ohne_begruendung' })))
      .toContain('Nicht gespeichert.');
  });

  it('grundAus nimmt nur einen Schlüssel — nie Markup oder einen Satz', () => {
    expect(grundAus({ fehler: 'ohne_begruendung' })).toBe('ohne_begruendung');
    expect(grundAus({ fehler: '<b>x</b>' })).toBeNull();
    expect(grundAus({ fehler: 'Ein Satz mit Leerzeichen' })).toBeNull();
    expect(grundAus({ fehler: ['a', 'b'] })).toBeNull();
    expect(grundAus({})).toBeNull();
  });
});

describe('(b) jeder Grund der Route hat einen Satz — de und en', () => {
  const dienst = lies('src/server/services/recruiting/dienst.ts');
  const quellen: Readonly<Record<(typeof SEITEN)[number][1], readonly string[]>> = {
    bewertung: [
      ...gruende(lies('src/app/api/recruiting/bewerbungen/[id]/bewertung/route.ts'),
        'RecruitingFehler'),
      ...gruende(funktion(dienst, 'bewerte'), 'RecruitingFehler'),
      /* `BewertungFehler` trägt genau einen Code (rangfolge.ts). */
      'unbrauchbare_bewertung',
    ],
    entscheidung: [
      ...gruende(lies('src/app/api/recruiting/bewerbungen/[id]/entscheidung/route.ts'),
        'RecruitingFehler'),
      ...gruende(funktion(dienst, 'entscheide'), 'RecruitingFehler'),
    ],
    /*
     * V-222: auf `stellen/neu` kommen zwei Formulare zurück — von Hand und
     * vom Agenten. Die Feldprüfung steht seitdem in `stellen/felder.ts`, und
     * ein gestörter Lauf kommt als `ki_…` aus `kiGrund`.
     */
    stelleNeu: [
      ...gruende(lies('src/app/api/recruiting/stellen/route.ts'), 'RecruitingFehler'),
      ...gruende(lies('src/app/api/recruiting/stellen/felder.ts'), 'RecruitingFehler'),
      ...gruende(lies('src/app/api/recruiting/stellen/entwurf/route.ts'), 'RecruitingFehler'),
      ...gruende(funktion(dienst, 'legeStelleAn'), 'RecruitingFehler'),
      ...gruende(funktion(lies('src/server/services/recruiting/stellenentwurf.ts'),
        'entwirfStellenanzeige'), 'RecruitingFehler'),
      ...[...lies('src/server/services/recruiting/stellenentwurf.ts')
        .matchAll(/return '(ki_[a-z_]+)'/gu)].map((m) => m[1] ?? ''),
    ],
    veroeffentlichung: [
      ...gruende(lies('src/app/api/recruiting/stellen/[id]/veroeffentlichen/route.ts'),
        'RecruitingFehler'),
      ...gruende(funktion(dienst, 'veroeffentlicheAufKarriereseite'), 'RecruitingFehler'),
    ],
  };

  it.each(Object.entries(quellen))('%s', (seite, liste) => {
    expect(liste.length, `${seite}: keine Gründe gefunden — liest der Test noch?`)
      .toBeGreaterThan(0);
    for (const sprache of ['de', 'en'] as const) {
      const tabelle = RECRUITING_RUECKMELDUNG[sprache][seite as (typeof SEITEN)[number][1]];
      for (const g of liste) expect(tabelle[g], `${sprache} ${seite}: ${g}`).toBeTruthy();
    }
  });

  it('der Kanal, der nicht verbunden ist, sagt: nichts ist hinausgegangen', () => {
    expect(RECRUITING_RUECKMELDUNG.de.veroeffentlichung['kanal_nicht_verbunden'])
      .toMatch(/nicht verbunden[\s\S]*nichts/u);
  });
});

/**
 * **(b2) Dieselbe Wache für die Rückwege der Gruppe kalender-dokumente**
 * (V-220, V-223, V-224, V-225; Prüfung der Gruppe). Gespräch, Kandidat,
 * Postfach und Beitragsbild bringen ihren Grund auf ungetypte Karten zurück —
 * heute vollständig, aber ohne Wache gegen den nächsten neuen Grund. Gelesen
 * wird wie in (b): was Route und Dienst werfen, muss in beiden Sprachen einen
 * Satz haben.
 */
describe('(b2) Gespräch, Kandidat, Postfach, Beitragsbild: jeder Grund hat einen Satz — de und en', () => {
  const ki = [...lies('src/server/services/recruiting/stellenentwurf.ts')
    .matchAll(/return '(ki_[a-z_]+)'/gu)].map((m) => m[1] ?? '');
  const quellen: Readonly<Record<string, {
    readonly gruende: readonly string[];
    readonly karte: (sprache: 'de' | 'en') => Readonly<Record<string, string>>;
  }>> = {
    gespraech: {
      gruende: [
        /*
         * Der Wurf mit dem Grund aus `planEingabe` trägt keinen festen Schlüssel
         * — der Ausdruck in `gruende` liefe sonst zum nächsten Literal weiter
         * (`'vermerken'`). Seine Gründe liest die dritte Zeile.
         */
        ...gruende(lies('src/app/api/recruiting/gespraeche/[id]/route.ts')
          .replace('new RecruitingFehler(gelesen.satz, gelesen.grund, 400)', ''),
        'RecruitingFehler'),
        ...gruende(lies('src/server/services/recruiting/gespraech.ts'), 'RecruitingFehler'),
        /* Der neue Termin kommt über `planEingabe`; ihre Gründe reicht die Route durch. */
        ...gruende(lies('src/server/services/zeit/formulareingabe.ts'), 'RecruitingFehler'),
      ],
      karte: (sprache) => RECRUITING_GESPRAECH_TEXTE[sprache].fehler,
    },
    kandidat: {
      gruende: [
        ...gruende(lies('src/app/api/recruiting/bewerbungen/[id]/kandidat/route.ts'),
          'RecruitingFehler'),
        ...gruende(lies('src/app/api/recruiting/bewerbungen/[id]/kandidat/vorschlag/route.ts'),
          'RecruitingFehler'),
        ...[...lies('src/app/api/recruiting/bewerbungen/[id]/kandidat/vorschlag/route.ts')
          .matchAll(/'(ki_[a-z_]+)'/gu)].map((m) => m[1] ?? ''),
        ...gruende(lies('src/server/services/recruiting/kandidat.ts'), 'RecruitingFehler'),
        ...ki,
      ],
      karte: (sprache) => RECRUITING_KANDIDAT_TEXTE[sprache].kFehler,
    },
    postfach: {
      gruende: [
        ...gruende(lies('src/app/api/recruiting/bewerbungen/route.ts'), 'RecruitingFehler'),
        ...gruende(lies('src/server/services/recruiting/postfach.ts'), 'RecruitingFehler'),
      ],
      karte: (sprache) => RECRUITING_KANDIDAT_TEXTE[sprache].pFehler,
    },
    /* Die Gründe von `MedienFehler` (der Vereinigungstyp), als `bild_<grund>` zurück. */
    bild: {
      gruende: (/readonly grund: ([^;]+?),\n\s+nachricht/u
        .exec(lies('src/server/services/social/beitragsbild.ts'))?.[1] ?? '')
        .split('|').map((t) => t.trim().replace(/'/gu, '')).filter((t) => t !== '')
        .map((g) => `bild_${g}`),
      karte: (sprache) => SOCIAL_BILD_TEXTE[sprache].fehler,
    },
  };

  it.each(Object.entries(quellen))('%s', (name, { gruende: liste, karte }) => {
    expect(liste.length, `${name}: keine Gründe gefunden — liest der Test noch?`)
      .toBeGreaterThan(2);
    for (const sprache of ['de', 'en'] as const) {
      for (const g of liste) expect(karte(sprache)[g], `${sprache} ${name}: ${g}`).toBeTruthy();
    }
  });

  /**
   * Die übrigen Abweisungen der Bild-Route (`SocialFehler` aus
   * `haengeNeuesBildAn`, `setzeBeitragsbild`, `schreibeWennNoch`) zeigt der
   * allgemeine Kasten des Beitragsblatts — die Seite steht auf der
   * Ausnahmeliste der Übersetzung und trägt ihre Sätze selbst (`FEHLER`).
   * `unbekannt` ausgenommen: dann gibt es das Blatt nicht, es antwortet 404.
   */
  it('bild: die Gründe des Beitrags stehen im Kasten des Beitragsblatts', () => {
    const dienst = lies('src/server/services/social/dienst.ts');
    const rumpf = (name: string): string => {
      const a = dienst.search(new RegExp(`(?:export )?async function ${name}\\b`, 'u'));
      expect(a, name).toBeGreaterThan(-1);
      return dienst.slice(a, dienst.indexOf('\n}\n', a));
    };
    const geworfen = ['haengeNeuesBildAn', 'setzeBeitragsbild', 'schreibeWennNoch']
      .flatMap((n) => [...rumpf(n).matchAll(/new SocialFehler\([\s\S]*?'([a-z_]+)'\)/gu)]
        .map((m) => m[1] ?? ''))
      .filter((g) => g !== 'unbekannt');
    expect(geworfen.length).toBeGreaterThan(2);
    const seite = lies('src/app/portal/[mandant]/social/posts/[id]/page.tsx');
    const karte = seite.slice(seite.indexOf('const FEHLER'), seite.indexOf('\n};\n', seite.indexOf('const FEHLER')));
    for (const g of geworfen) expect(karte, g).toMatch(new RegExp(`\\n\\s+${g}:`, 'u'));
  });
});

describe('(c) das Kundenblatt liest die Abweisung des Kontaktformulars', () => {
  /*
   * Bis D-772 stand hier: „die Route schickt Satz UND Schlüssel" — geprüft
   * wurde `meldung=${encodeURIComponent(fehler.message)}`. Genau das hebt
   * D-769 auf: ein Satz in der Adresse ist einer, den jeder Link schreiben
   * kann, und er war immer deutsch. Die Route schickt jetzt NUR den Grund;
   * welche Adresse daraus wird, prüft `crm-kunde-rueckweg.test.ts` an der
   * echten Route.
   */
  it('die Route schickt nur den Schlüssel (`?grund=`) — keinen Satz, und nicht als ?fehler=', () => {
    const route = lies('src/app/api/crm/kunde/route.ts');
    expect(route).toContain("zurueckMitSchluessel(anfrage, zurueck, 'grund', fehler.grund)");
    expect(route).not.toContain('meldung=${');
    expect(route).not.toContain('fehler.message');
    // `fehler` liest das Kontaktblatt für den Sendeweg (V-101).
    expect(route).not.toMatch(/[?&]fehler=|'fehler', fehler\.grund/u);
  });

  it('die Seite nimmt searchParams, zeigt die Meldung und öffnet das Formular', () => {
    const seite = lies('src/app/portal/[mandant]/crm/kunden/[id]/page.tsx');
    expect(seite).toContain('searchParams');
    expect(seite).toContain('cse="kunde-meldung"');
    expect(seite).toContain('open={abgewiesen}');
  });

  it('V-153: nie Text aus der Adresse im Warnkasten — ein unbekannter Grund wird ein allgemeiner Satz', () => {
    /*
     * Der Rückfall war `?? meldung`: der Satz aus `?meldung=` stand im
     * Warnkasten des Portals, also jeder Text, den ein Verweis mitbringt.
     *
     * Bis D-772 verlangte dieser Test die Nachschlagung mit eckigen Klammern
     * (`tk.kontaktFehler[meldungGrund]`) — `?grund=__proto__` fand damit
     * `Object.prototype`, und das Blatt antwortete mit 500. Jetzt schlägt der
     * gemeinsame Kasten nur als eigener Eintrag nach (D-728), mit
     * `tk.abgewiesen` als allgemeinem Satz; das Rendern mit `__proto__` prüft
     * `crm-kunde-rueckweg.test.ts`.
     */
    const seite = lies('src/app/portal/[mandant]/crm/kunden/[id]/page.tsx');
    expect(seite).not.toMatch(/\?\?\s*meldung\b/u);
    expect(seite).not.toMatch(/\{meldung\}/u);
    expect(seite).not.toMatch(/kontaktFehler\[/u);
    expect(seite).toContain('fehler: tk.kontaktFehler');
    expect(seite).toContain('sonst: tk.abgewiesen');
    for (const sprache of ['de', 'en'] as const) {
      expect(KUNDE_RUECKMELDUNG[sprache].abgewiesen).toBeTruthy();
    }
  });

  it('jeder Grund von legeKontaktAn hat einen Satz in beiden Sprachen', () => {
    const liste = gruende(funktion(lies('src/server/services/crm/anlegen.ts'), 'legeKontaktAn'),
      'CrmFehler');
    expect(liste).toEqual(expect.arrayContaining(
      ['grundlage_ohne_quelle', 'einwilligung_ohne_kanal']));
    for (const sprache of ['de', 'en'] as const) {
      for (const g of liste) {
        expect(eigenerEintrag(KUNDE_RUECKMELDUNG[sprache].kontaktFehler, g), `${sprache}: ${g}`)
          .toBeTruthy();
      }
    }
  });
});

describe('V-153: ohne `crm.schreiben` steht ein Satz, kein leerer Platz', () => {
  it('Kunden- und Kontaktblatt zeigen den Satz statt des Formulars', () => {
    const html = renderToStaticMarkup(createElement(NotizKeinRecht, { sprache: 'de' }));
    expect(html).toContain('data-cse="notiz-kein-recht"');
    expect(html).toContain('Festhalten kann, wer dieses Recht hält:');
    expect(html).toContain('data-recht="crm.schreiben"');
    expect(renderToStaticMarkup(createElement(NotizKeinRecht, { sprache: 'en' })))
      .toContain('Recording requires this right:');
    expect(lies('src/app/portal/[mandant]/crm/kunden/[id]/page.tsx'))
      .toContain('<NotizKeinRecht sprache={zugang.sprache} />');
    expect(lies('src/app/portal/[mandant]/crm/kontakte/[id]/page.tsx'))
      .toContain('<NotizKeinRecht sprache={zugang.sprache} />');
  });
});
