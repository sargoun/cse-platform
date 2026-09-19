/**
 * **Jeder Verweis in einer Portalseite steht unter dem Recht seines Ziels.**
 *
 * Ein Verweis, dessen ZIEL ein Leserecht verlangt, das die SEITE nicht
 * verlangt, wird auch Menschen gezeigt, die das Ziel nicht öffnen dürfen. Sie
 * bekommen dahinter einen 404 — und ein Verweis, der auf 404 führt, verrät die
 * Existenz dessen, was er nicht zeigen darf (AUT-06). Dass die Seite dahinter
 * richtig sperrt, macht den Knopf davor nicht richtig.
 *
 * Diese Klasse hat das Projekt DREIMAL getroffen, und jedes Mal fand sie eine
 * Durchsicht und keine Prüfung:
 *
 *  - **D-567**: sechs Knöpfe („Budget", „Protokoll", „MiLoG-Nachweise", „Neue
 *    Rechnung", „Prüfdauer", „Zugang") — eine `leitung` sah alle sechs und
 *    bekam hinter jedem ein 404. Daraus entstand `haeltRechte`.
 *  - **Copilot-Runde auf PR 16**: sechs weitere in Social und Recruiting
 *    („Neuer Beitrag", „Neue Stelle", zweimal „Zur Freigabe", …).
 *  - **D-581**: eine Vermessung ALLER Portalseiten gegen das Manifest fand
 *    danach noch 102 Stellen in 73 Dateien.
 *
 * Deshalb steht die Bedingung jetzt als Vergleich da, gegen dieselbe Quelle,
 * die das Tor fragt: das Routenmanifest. Für jede `href={`/portal/${mandant}/…`}`
 * in `src/app/portal/[mandant]/**\/page.tsx` — und ebenso für `/portal/gruppe/…`
 * und `/portal/mein/…` in ihren Bäumen — gilt: jedes Leserecht des Ziels
 * ist entweder ein Leserecht der Seite selbst, oder es steht im Quelltext der
 * Seite als Wächter — `darf['recht']`, `hat_recht('recht'`, `haeltRechte(…
 * 'recht'`. Kommentare zählen nicht: ein Absatz, der das Recht ERKLÄRT, ist
 * kein Wächter (dieselbe Lehre wie in `api-verdrahtung.test.ts`).
 *
 * **Er prüft nicht, ob der Wächter RICHTIG steht** (ob die Bedingung wirklich
 * den Verweis umschliesst) — dafür sind die Browserläufe da. Er prüft, ob es
 * ihn GIBT; und genau das fehlte 114-mal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTEN, leserechte, type RoutenEintrag } from '../../src/server/registry/routen.js';

const PORTAL = fileURLToPath(new URL('../../src/app/portal', import.meta.url));

/**
 * Die drei Portale mit ihrer Wurzel im Dateibaum, ihrem Manifestpräfix und dem
 * Präfix, mit dem ihre Verweise im Quelltext beginnen. Im Mandantenportal ist
 * das Segment eine Vorlage (`${mandant}`), in den beiden anderen ein Wort.
 */
const PORTALE = [
  { name: 'mandant', ordner: '[mandant]', manifest: '/portal/[mandant]', href: '/portal/${mandant}' },
  { name: 'gruppe', ordner: 'gruppe', manifest: '/portal/gruppe', href: '/portal/gruppe' },
  { name: 'mein', ordner: 'mein', manifest: '/portal/mein', href: '/portal/mein' },
] as const;

function seiten(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return seiten(p);
    return e === 'page.tsx' ? [p] : [];
  });
}

/** Block- und Zeilenkommentare heraus — grob und in der sicheren Richtung. */
function ohneKommentare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1');
}

/**
 * Vorlagenpfad → Manifestzeile, segmentweise. Ein `${…}` im Quelltext und ein
 * `[…]` im Manifest sind beide „irgendein Segment"; gesucht wird die FORM.
 *
 * **`[mandant]` ist dabei KEIN Platzhalter, sondern ein Wort.** Es steht im
 * Manifest für die Mandantenportale und im Dateibaum wörtlich so; `gruppe`
 * und `mein` sind eigene Portale mit eigenen Zeilen und anderen Rechten.
 * Liesse man `[mandant]` alles schlucken, fände `/portal/mein/zeiten/[x]` die
 * Zeile `/portal/[mandant]/zeiten/[id]` (Recht `zeit.lesen`) statt der
 * eigenen (`selbst`) — ein Befund, der keiner ist, und umgekehrt eine
 * Gruppenseite, die zufällig sauber aussieht, weil sie an der falschen Zeile
 * gemessen wurde. Genau so ist es beim ersten Lauf passiert.
 */
function finde(vorlage: string): RoutenEintrag | undefined {
  /*
   * **Erst das Wort, dann der Platzhalter.** `/freigaben/[id]` steht im
   * Manifest VOR `/freigaben/erledigt`, und `[id]` schluckt das Wort
   * `erledigt`. Wer nach Form sucht und die erste Zeile nimmt, misst die
   * Seite `erledigt` an den Rechten der Einzelansicht
   * (`freigabe.entscheiden`) statt an ihren eigenen (`freigabe.lesen`) — und
   * meldet dann einen Verweis auf den Posteingang, der keiner ist. Dasselbe
   * gilt fuer `stellen/neu` neben `stellen/[id]`. Deshalb gewinnt die
   * genaue Zeile, und die Form ist nur der Rueckfall fuer Vorlagen mit `[x]`.
   */
  const genau = ROUTEN.find((r) => r.pfad === vorlage);
  if (genau !== undefined) return genau;
  /*
   * **Und unter den Formen gewinnt die wörtlichste.** Eine Vorlage wie
   * `/objekte/[x]/raumbuch/import` passt auf `/objekte/[id]/raumbuch/import`
   * UND auf `/objekte/[id]/raumbuch/[raumId]` — die zweite schluckt `import`
   * mit ihrem Platzhalter. Die erste Zeile im Manifest zu nehmen hiess, den
   * Import an den Rechten der Raumansicht zu messen. Gezählt wird deshalb,
   * wie viele Segmente WÖRTLICH stimmen; mehr Wörter, weniger Platzhalter,
   * bessere Zeile.
   */
  const teile = vorlage.split('/').filter(Boolean);
  let beste: RoutenEintrag | undefined;
  let besteWoerter = -1;
  for (const r of ROUTEN) {
    const m = r.pfad.split('/').filter(Boolean);
    if (m.length !== teile.length) continue;
    if (!m.every((seg, i) => seg === teile[i] || (seg.startsWith('[') && seg !== '[mandant]'))) continue;
    const woerter = m.filter((seg, i) => seg === teile[i]).length;
    if (woerter > besteWoerter) { beste = r; besteWoerter = woerter; }
  }
  return beste;
}

/** Steht das Recht in einem WIRKLICHEN Wächter — nicht bloss irgendwo im Text? */
function bewacht(code: string, recht: string): boolean {
  const r = recht.replace(/\./gu, '\\.');
  return new RegExp(
    `(darf|rechte|hat)\\[\\s*'${r}'\\s*\\]|hat_recht\\('${r}'|haeltRechte\\([^)]*'${r}'`, 'u',
  ).test(code);
}

/**
 * Verweise, die absichtlich OHNE Bedingung stehen — jede Zeile mit Grund.
 * Leer ist der Sollzustand; ein Eintrag hier ist eine Entscheidung, kein
 * Ventil.
 */
const OHNE_BEDINGUNG: Readonly<Record<string, string>> = {
  '[mandant]/zeiten/[id]/page.tsx → /portal/[mandant]/zeiten/[x]/korrektur':
    'Bewacht über `darfKorrigieren()` (`zeiten/daten.ts`), das `zeit.korrigieren` '
    + 'per `app.hat_recht` prüft UND den eigenen Eintrag ausschliesst (EMP-07) — '
    + 'strenger als der blosse Rechtevergleich, für diese Vermessung aber unsichtbar, '
    + 'weil das Recht nicht in der Seite steht, sondern in der Hilfsfunktion.',
  '[mandant]/personal/personen/[id]/stammdaten/page.tsx → /portal/[mandant]/security/bewacherregister':
    'Bewacht über `bewacherregisterErreichbar()` (`services/security/bewacherregister.ts`), '
    + 'das `personal.bewacher_verwalten` per `app.hat_recht` prüft UND zusätzlich verlangt, '
    + 'dass die Gesellschaft das Gewerk Security gebucht hat (D-377) — dieselbe Lage wie bei '
    + '`darfKorrigieren()` darüber: strenger als der blosse Rechtevergleich, für diese '
    + 'Vermessung aber unsichtbar, weil das Recht nicht in der Seite steht, sondern im Dienst. '
    + 'Der Eintrag ist nötig, WEIL der Rechtevergleich hier zu schwach war: '
    + '`tests/e2e/verweise.spec.ts` fand `[admin · reinigung] '
    + '/portal/reinigung/security/bewacherregister → 404`. Die `admin` HÄLT '
    + '`personal.bewacher_verwalten` (nachgemessen), die Reinigung hat Security aber nicht '
    + 'gebucht (`mandant.module = {reinigung}`), und die Zielseite gibt deshalb für jeden 404 '
    + '— auch für die Super-Administration. Ein Wächter, der nur das Recht fragte, zeigte den '
    + 'Verweis trotzdem. Diese Paarung bleibt gemessen, nur von der Prüfung, die sie gefunden '
    + 'hat: dem Browserlauf durch das Portal.',
};

function befundeFuer(portal: typeof PORTALE[number]): readonly string[] {
  const wurzel = join(PORTAL, portal.ordner);
  const dateien = seiten(wurzel);
  /*
   * **Jede Vorlage zaehlt — nicht nur die, die `href` heisst.**
   *
   * Hier stand `href=\{`…`\}`. Eine Kachel gibt ihr Ziel aber als
   * EIGENSCHAFT weiter (`ziel: `/portal/${mandant}/recruiting/stellen``), und
   * `KachelRaster` macht daraus ein `<a>`; ein `zurueck`-Feld wird nach dem
   * Absenden zur Adresse. Beides ist ein Weg mit einem Recht am Ende, und
   * beides sah diese Vermessung nicht: die Copilot-Runde auf PR 16 fand
   * genau so zwei Kacheln mit einem 404 dahinter, mitten in einem Modul, das
   * D-581 schon durchgegangen war.
   *
   * Gesucht wird deshalb die VORLAGE selbst, unter welchem Namen auch immer
   * sie steht. Ein Ziel, das die Seite ohnehin mit ihren eigenen Rechten
   * oeffnet, faellt hinten heraus — es fehlt dann kein Recht.
   */
  const hrefMuster = new RegExp(
    `\`${portal.href.replace(/[${}]/gu, (z) => `\\${z}`)}([^\`]*)\``, 'gu');
  const befunde: string[] = [];
  for (const datei of dateien) {
    const rel = relative(wurzel, datei).split(/[/\\]/u).join('/');
    const seitenPfad = rel === 'page.tsx'
      ? portal.manifest
      : `${portal.manifest}/${rel.replace(/\/page\.tsx$/u, '')}`;
    const seite = finde(seitenPfad);
    if (seite === undefined) continue;
    const seitenRechte = new Set(leserechte(seite));
    const code = ohneKommentare(readFileSync(datei, 'utf8'));
    const gesehen = new Set<string>();
    for (const m of code.matchAll(hrefMuster)) {
      const ziel = `${portal.manifest}${m[1] ?? ''}`
        .replace(/\$\{[^}]+\}/gu, '[x]').replace(/[?#].*$/u, '');
      if (gesehen.has(ziel)) continue;
      gesehen.add(ziel);
      const schluessel = `${portal.ordner}/${rel} → ${ziel}`;
      if (schluessel in OHNE_BEDINGUNG) continue;
      /*
       * **Die Portalwurzel bewacht der RAHMEN, nicht jede Seite.**
       *
       * `wurzel={`/portal/${mandant}`}` steht in jeder der 162 Seiten, und
       * die Uebersicht dahinter traegt ihr eigenes Leserecht. Die Bedingung
       * 162-mal zu wiederholen hiesse, sie 162-mal vergessen zu koennen;
       * `PortalRahmen` fragt stattdessen einmal die Tab-Leiste, die dasselbe
       * Recht in derselben Transaktion bewertet hat, und zeigt den Namen
       * ohne Verweis, wenn er fehlt (D-583). `tests/kern/rahmen-wurzel.test.ts`
       * haelt das fest.
       */
      if (ziel === portal.manifest) continue;
      const route = finde(ziel);
      if (route === undefined) continue;
      const fehlend = leserechte(route)
        .filter((r) => !seitenRechte.has(r) && !bewacht(code, r));
      if (fehlend.length > 0) befunde.push(`${schluessel}  verlangt ${fehlend.join(' + ')}`);
    }
  }
  return befunde;
}

describe('kein Portalverweis ohne das Recht seines Ziels (AUT-06)', () => {
  it('es gibt Seiten zu pruefen', () => {
    expect(seiten(join(PORTAL, '[mandant]')).length).toBeGreaterThan(100);
    expect(seiten(join(PORTAL, 'gruppe')).length).toBeGreaterThan(10);
    expect(seiten(join(PORTAL, 'mein')).length).toBeGreaterThan(10);
  });

  for (const portal of PORTALE) {
    it(`${portal.name}: jedes Leserecht eines Verweisziels ist Seitenrecht oder Waechter`, () => {
      expect(befundeFuer(portal),
        'Verweise, deren Ziel ein Recht verlangt, das die Seite weder hat noch prueft')
        .toEqual([]);
    });
  }

  it('jede Ausnahme betrifft einen Verweis, den es wirklich gibt', () => {
    for (const eintrag of Object.keys(OHNE_BEDINGUNG)) {
      const [rel] = eintrag.split(' → ');
      expect(statSync(join(PORTAL, rel ?? '')).isFile(),
        `Ausnahme fuer eine Seite, die es nicht gibt: ${eintrag}`).toBe(true);
    }
  });
});
