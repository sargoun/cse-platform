/**
 * **Eine Seite ohne Eingang ist keine Seite.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund (V-125).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Mandant bat um eine Durchsicht „jedes Ein- und Ausgangs" und nannte
 * ausdrücklich „صفحات مخفية" — versteckte Seiten. Nachgemessen: **vier**
 * Portalseiten waren gebaut, bewacht, im Routenmanifest geführt, mit Rechten
 * versehen — und von **keiner** anderen Seite aus erreichbar:
 *
 *  - `/einstellungen/benutzer/einladen` — der erste Schritt nach der
 *    Einrichtung. Wer ein Verwaltungskonto anlegen wollte, musste die Adresse
 *    kennen.
 *  - `/auftraege/[id]/abrechnung` — WIE dieser Auftrag abgerechnet wird
 *    (FIN-16). Die Frage stellt man am Auftrag und sonst nirgends.
 *  - `/bau/projekte/[id]/lv/import` — der GAEB-Import. Ein
 *    Leistungsverzeichnis entsteht im Regelfall nicht von Hand.
 *  - `/reinigung/sonderleistungen` — Glas, Sonder- und Grundreinigung, also
 *    das, was neben dem Turnus separat beauftragt und abgerechnet wird.
 *
 * Das ist die Umkehrung von `verweis-rechte.test.ts`: die prüft, ob ein
 * Verweis zu seinem Ziel PASST, diese hier, ob es ihn überhaupt GIBT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum die Regel vorsichtig ist — und das mit Absicht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Adressen entstehen hier auf mindestens fünf Arten: als vollständige
 * Vorlage (`` `/portal/${mandant}/crm/kunden` ``), relativ zu einer Wurzel
 * (`` `${wurzel}${r.pfad}` ``), als Eintrag in einer Liste (`pfad:
 * 'buchhaltung/konten'`), als Tupel in einem Array (`['/portal/mein/urlaub',
 * …]`) und aus einem Dienst heraus (`WEG('k', '/kalender/')`). Eine Prüfung,
 * die nur eine davon kennt, meldet Dutzende Seiten als versteckt, die es
 * nicht sind — und wird nach dem dritten Fehlalarm abgeschaltet.
 *
 * Gesucht wird deshalb nach dem **längsten wörtlichen Schwanz** der Adresse
 * (höchstens zwei Glieder), irgendwo ausserhalb des eigenen Ordners, mit
 * entfernten Kommentaren: ein Absatz, der eine Adresse ERKLÄRT, ist kein Weg
 * dorthin. Die Prüfung meldet damit eher zu wenig als zu viel. Das ist die
 * richtige Richtung: eine Sperrklinke, die nie falschen Alarm schlägt, bleibt
 * scharf.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WURZEL = fileURLToPath(new URL('../../src', import.meta.url));
const PORTAL = join(WURZEL, 'app', 'portal');
const REGISTRY = join(WURZEL, 'server', 'registry');
const DIENSTE = join(WURZEL, 'server', 'services');

function dateien(dir: string, endung: RegExp): readonly string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return dateien(p, endung);
    return endung.test(e) ? [p] : [];
  });
}

/** Kommentare raus — ein Absatz ÜBER eine Adresse ist kein Weg dorthin. */
function ohneKommentare(q: string): string {
  return q.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/(^|[^:])\/\/[^\n]*/gmu, '$1 ');
}

/**
 * Seiten, die absichtlich keinen Eingang haben.
 *
 * **Die Liste darf schrumpfen, nie wachsen.** Jede Zeile nennt den Grund.
 */
const OHNE_EINGANG: Readonly<Record<string, string>> = {
  'finanzen/mahnungen/vorschlaege':
    'Ein Platzhalter, der nur existiert, damit die Nachbarroute `[id]` nicht '
    + '`vorschlaege` als Kennung in ein `$1::uuid` reicht und mit 500 antwortet. '
    + 'Die Seitenkarte fuehrt die Adresse; gebaut ist das Modul noch nicht. Ein '
    + 'Verweis darauf waere ein Weg zu einer Ankuendigung.',
};

/** Der Pfad einer Seite, ohne das Portalglied, dynamische Glieder als `*`. */
function pfadVon(datei: string): string {
  let teile = relative(PORTAL, datei).replace(/(^|\/)page\.tsx$/u, '').split('/').filter(Boolean);
  if (['[mandant]', 'gruppe', 'mein', 'kunde', 'konto'].includes(teile[0] ?? '')) {
    teile = teile.slice(1);
  }
  return teile.map((t) => (t.startsWith('[') ? '*' : t)).join('/');
}

/**
 * Die Schwänze, nach denen gesucht wird — von lang nach kurz.
 *
 * Eine Adresse steht im Quelltext in mindestens drei Längen: vollständig
 * (`` `/portal/${mandant}/zeiten/freigabe` ``), relativ zu einer Wurzel
 * (`` `${pfad}/checkin-links` ``) und als einzelnes Glied in einer Liste
 * (`pfad: 'profil'` in der Sprungzeile der Website). Gefunden ist die Seite,
 * sobald EINE davon irgendwo steht.
 *
 * **Die bekannte Grenze, damit niemand mehr erwartet, als hier steht:** ein
 * einzelnes Glied, das anderswo im Baum noch einmal vorkommt, deckt seine
 * Seite zu. `bau/projekte/[id]/lv/import` war so ein Fall — `import` steht
 * auch in `objekte/[id]/raumbuch/import` und `buchhaltung/bank/import`.
 * Diese Prüfung hätte ihn nicht gemeldet; gefunden hat ihn die Durchsicht,
 * die zu V-125 führte. Sie meldet lieber zu wenig als zu viel: eine
 * Sperrklinke, die falschen Alarm schlägt, wird nach dem dritten Mal
 * abgeschaltet, und dann meldet sie gar nichts mehr.
 */
function schwaenze(pfad: string): readonly string[] {
  const teile = pfad.split('/');
  const aus: string[] = [];
  for (let n = Math.min(3, teile.length); n >= 1; n -= 1) {
    const stueck = teile.slice(teile.length - n);
    if (stueck.some((t) => t === '*')) continue;
    aus.push(stueck.join('/'));
  }
  return aus;
}

describe('jede Portalseite hat einen Eingang', () => {
  const seiten = dateien(PORTAL, /^page\.tsx$/u);
  /*
   * **Aus den Diensten nur die Zeilen, die eine ADRESSE bauen.**
   *
   * Ein Dienst nennt seinen Gegenstand hundertmal beim Namen
   * (`sonderleistung`), ohne je dorthin zu verweisen. Naehme die Pruefung
   * die ganze Datei, deckte dieses Wort die Seite `reinigung/
   * sonderleistungen` zu — und genau die war versteckt. Gebraucht werden
   * die Dienste nur fuer die eine Form, die es sonst nirgends gibt: der
   * Kalender baut den Weg zu seinem Eintrag in SQL (`WEG('k',
   * '/kalender/')`).
   */
  const nurWege = (q: string): string => q.split('\n')
    .filter((z) => z.includes('/portal/') || z.includes('WEG(')).join('\n');

  const quellen = [
    ...dateien(PORTAL, /\.tsx?$/u).map((f) => ({ f, q: readFileSync(f, 'utf8') })),
    /*
     * **`routen.generiert.ts` ist kein Eingang, sondern das Verzeichnis
     * ALLER Adressen.** Es aus der Quelle zu lassen ist der Kern dieser
     * Pruefung: naehme man es mit, deckte es jede Seite zu, auch die
     * versteckte, und die Sperrklinke meldete auf ewig null. Dasselbe gilt
     * fuer `dienste.ts` — es fuehrt Dienstpfade, keine Wege.
     */
    ...dateien(REGISTRY, /\.ts$/u)
      .filter((f) => !/routen\.generiert\.ts$|dienste\.ts$/u.test(f))
      .map((f) => ({ f, q: readFileSync(f, 'utf8') })),
    ...dateien(DIENSTE, /\.ts$/u).map((f) => ({ f, q: nurWege(readFileSync(f, 'utf8')) })),
  ].map(({ f, q }) => ({ f, q: ohneKommentare(q) }));

  it('es gibt genug Seiten, damit die Messung etwas bedeutet', () => {
    expect(seiten.length).toBeGreaterThan(300);
  });

  it('keine Seite ist nur über die Adresszeile erreichbar', () => {
    const befunde: string[] = [];
    for (const seite of seiten) {
      const pfad = pfadVon(seite);
      if (pfad === '' || pfad.includes('...')) continue;
      if (OHNE_EINGANG[pfad] !== undefined) continue;
      const ziele = schwaenze(pfad);
      if (ziele.length === 0) continue;

      /*
       * Der eigene Ordner zählt nicht: `const pfad = …` in der Seite selbst
       * ist kein Eingang, und eine Unterseite, die auf ihre Mutter verweist,
       * auch nicht.
       */
      const eigener = dirname(seite);
      const gefunden = ziele.some((ziel) => {
        const roh = ziel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const muster = new RegExp(`[/'"\`]${roh}(?=[\`'"?/}\\s])`, 'u');
        return quellen.some(({ f, q }) => !f.startsWith(`${eigener}/`) && muster.test(q));
      });
      if (!gefunden) befunde.push(`${pfad}  (${relative(WURZEL, seite)})`);
    }
    expect(
      befunde,
      'Seiten, auf die nichts verweist — gebaut, bewacht und unerreichbar',
    ).toEqual([]);
  });

  /** Die Gegenprobe: eine Ausnahme, die nicht mehr nötig ist, fällt auf. */
  it('jede Ausnahme in der Liste gibt es noch', () => {
    const alle = new Set(seiten.map(pfadVon));
    const tot = Object.keys(OHNE_EINGANG).filter((p) => !alle.has(p));
    expect(tot, 'Ausnahme ohne Seite — Zeile streichen').toEqual([]);
  });
});
