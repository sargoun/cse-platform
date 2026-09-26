/**
 * Der Weg zurück steht GENAU EINMAL auf einer Seite (DESIGN §5, D-613,
 * V-108).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund, den diese Datei festnagelt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bis D-613 schrieb jede Seite ihren Rückweg selbst — gemessen zwei von 311,
 * der Rest war eine Sackgasse. D-613 leitet ihn seitdem aus der ADRESSE ab
 * und zeichnet ihn in der Hülle. Beides zusammen ergab das, was der Mandant
 * am Telefon sah:
 *
 *     ← Agenten          (die Hülle, abgeleitet)
 *     ← Agenten          (die Seite, von Hand)
 *     CEO-Assistent
 *
 * Auf **47 Seiten**. Kein Test fiel um, kein Typ beschwerte sich: zwei
 * gültige Verweise auf dasselbe Ziel sind kein Fehler, den eine Maschine von
 * sich aus bemerkt — nur einer, den jeder Mensch sofort sieht.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Regel: der Rumpf zeichnet keinen Rückweg.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Eine Seite, die ein anderes Ziel oder eine bessere Beschriftung braucht
 * (`← RE-2026-00001` statt `← Datensatz`), übergibt `zurueck` an ihre Hülle.
 * Die Hülle ersetzt den abgeleiteten damit, statt sich einen zweiten
 * danebenzustellen — und der Pfeil bekommt dabei umsonst, was ein
 * handgebauter jedes Mal neu brauchte: 44 px Berührungsziel (DESIGN §9), ein
 * `aria-label` in vier Sprachen (`rueckwegLabel`) und dieselbe Stelle wie auf
 * jeder anderen Seite.
 *
 * **Was hier NICHT als Rückweg zählt:** ein Blätterpfeil („← Vorige Woche",
 * „← 2025"), ein `aria-hidden`-Zeichen innerhalb eines Bausteins und ein
 * Pfeil in einem Kommentar. Sie stehen unten in `KEIN_RUECKWEG`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rueckwegFuer } from '../../src/server/registry/rueckweg.js';
import { NAVIGATION } from '../../src/server/registry/navigation.js';

const WURZEL = 'src/app/portal';

function seiten(dir: string, raus: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = `${dir}/${e}`;
    if (statSync(p).isDirectory()) seiten(p, raus);
    else if (e === 'page.tsx') raus.push(p);
  }
  return raus;
}

/** Aus `src/app/portal/[mandant]/agenten/page.tsx` wird `/portal/[mandant]/agenten`. */
function musterVon(datei: string): string {
  return '/' + datei.replace(/^src\/app\//u, '').replace(/\/page\.tsx$/u, '');
}

/**
 * Ein `←`, das KEIN Rückweg ist.
 *
 * Blätterpfeile tragen eine Zahl oder einen Zeitraum und führen auf dieselbe
 * Seite; ein `aria-hidden`-Zeichen gehört zu einem Baustein, der den Namen
 * daneben trägt; und was in einem Kommentar steht, rendert nicht.
 */
const KEIN_RUECKWEG = /aria-hidden|tagePlus|monatPlus|cse-zahl|text=\{?`?←|text="←/u;

/**
 * Kommentare zuerst weg, dann suchen — und zwar als BLOCK, nicht je Zeile.
 *
 * Die erste Fassung prüfte `^\s*\*` je Zeile und fiel über die Mittelzeile
 * eines JSX-Kommentars, die kein `*` am Anfang trägt:
 *
 *     {\/* … diese Route nur
 *         `personal.bewacher_verwalten`. Ohne das erste fuehrte „← Sicherheit"
 *         auf ein 404 (AUT-06). *\/}
 *
 * Ein falscher Alarm in einer Sperrklinke ist teurer als er aussieht: wer ihn
 * zweimal von Hand wegdrückt, hebt beim dritten Mal die Prüfung auf.
 */
function ohneKommentare(inhalt: string): string {
  return inhalt.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
}

function eigenePfeile(inhalt: string): readonly string[] {
  return ohneKommentare(inhalt).split('\n')
    .filter((z) => z.includes('←'))
    .filter((z) => !KEIN_RUECKWEG.test(z))
    .map((z) => z.trim());
}

describe('§1 keine Seite zeichnet ihren Rückweg selbst', () => {
  it('kein Pfeil im Rumpf einer Seite, die einen abgeleiteten bekommt', () => {
    const treffer: string[] = [];
    for (const datei of seiten(WURZEL)) {
      if (rueckwegFuer(musterVon(datei)) === null) continue;
      const pfeile = eigenePfeile(readFileSync(datei, 'utf8'));
      if (pfeile.length > 0) treffer.push(`${datei}\n      ${pfeile.join('\n      ')}`);
    }
    /*
     * Die Meldung nennt Datei UND Zeile, weil die Antwort darauf immer
     * dieselbe ist und in einem Satz steht: den Block löschen und
     * `zurueck={{ ziel, text }}` an die Hülle geben.
     */
    expect(treffer, `Rückweg doppelt — Block löschen, `
      + `\`zurueck={{ ziel, text }}\` an die Hülle:\n    ${treffer.join('\n    ')}`)
      .toEqual([]);
  });
});

describe('§2 jede Seite hat einen sichtbaren Ausgang', () => {
  /**
   * Eine Modulwurzel (`/portal/[mandant]/objekte`) bekommt bewusst KEINEN
   * abgeleiteten Rückweg: über ihr liegt nur die Portalwurzel, und dorthin
   * führt die Kopfzeile. Das gilt aber nur, solange man sie über die
   * Navigation oder die Tableiste erreicht — denn dann führt derselbe Weg
   * auch wieder hinaus.
   *
   * `/portal/[mandant]/benachrichtigungen` ist die Ausnahme: hierher kommt
   * man NUR über die Glocke. Ohne `wurzelTitel` rendert die Hülle die
   * Logo-Form — Zeichen plus Seitenname, die wie eine Überschrift aussieht.
   * Der Mandant tippte auf die Glocke und kam nicht mehr weg.
   */
  it('eine Modulwurzel ausserhalb der Navigation trägt `wurzelTitel`', () => {
    const navSegmente = new Set(
      NAVIGATION.map((n) => n.pfad.split('/').filter((s) => s !== '').at(-1)));
    const ohneAusgang: string[] = [];
    for (const datei of seiten(`${WURZEL}/[mandant]`)) {
      const muster = musterVon(datei);
      const teile = muster.split('/').filter((s) => s !== '');
      // Genau eine Ebene unter der Portalwurzel — tiefer greift §1/die Ableitung.
      if (teile.length !== 3) continue;
      const segment = teile[2]!;
      if (segment.startsWith('[')) continue;
      if (navSegmente.has(segment)) continue;
      if (!/wurzelTitel=/u.test(readFileSync(datei, 'utf8'))) ohneAusgang.push(muster);
    }
    expect(ohneAusgang, 'Modulwurzel ohne Navigationseintrag und ohne '
      + '`wurzelTitel` — die Kopfzeile sieht dort aus wie eine Überschrift, '
      + 'nicht wie ein Weg').toEqual([]);
  });
});

describe('§3 die Ableitung selbst bleibt, wie sie gemeint ist', () => {
  it('eine Modulwurzel bekommt keinen, eine Unterseite schon', () => {
    expect(rueckwegFuer('/portal/reinigung/objekte')).toBeNull();
    expect(rueckwegFuer('/portal/reinigung')).toBeNull();
    expect(rueckwegFuer('/portal/mein')).toBeNull();
    const tief = rueckwegFuer('/portal/reinigung/objekte/abc');
    expect(tief?.ziel).toBe('/portal/reinigung/objekte');
    expect(tief?.segment).toBe('objekte');
  });

  it('das Ziel ist der nächste Vorfahr, DER EINE ROUTE IST', () => {
    /* `…/lv/import` hat `…/lv` als Route, nicht `…/lv/import`. */
    const r = rueckwegFuer('/portal/reinigung/bau/projekte/p1/lv/import');
    expect(r?.ziel).toBe('/portal/reinigung/bau/projekte/p1/lv');
  });
});
