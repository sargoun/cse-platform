import { describe, expect, it } from 'vitest';
import { ohneKommentare, ohneKommentareMitTexten, ohnePsKommentare } from './hilfen/quelltext.js';

/**
 * Der Kommentarentferner, gegen den Fall, der ihn blind machte.
 *
 * **Der Befund.** Er entfernte erst Kommentare, dann Zeichenketten. In
 *
 *     const marke = 'x//y'; await authorize(...);
 *
 * schlug die `//`-Regel INNERHALB der Zeichenkette zu und frass den Rest der
 * Zeile — samt `authorize`. `routen.test.ts` sucht genau diesen Aufruf, um zu
 * belegen, dass eine Route bewacht ist; sie haette die Zeile nicht mehr
 * gesehen. Eine Sicherheitsprüfung, die eine Zeile nicht sieht, meldet keinen
 * Verstoss — sie meldet gar nichts.
 *
 * Die umgekehrte Reihenfolge hat denselben Fehler spiegelbildlich, deshalb ist
 * die Antwort kein Tausch, sondern ein Durchgang von links nach rechts.
 */
describe('ohneKommentare — Code bleibt, Kommentar und Inhalt gehen', () => {
  it('DER Befund: ein `//` in einer Zeichenkette frisst die Zeile nicht mehr', () => {
    const quelle = `const marke = 'x//y'; await authorize(sitzung, recht);`;
    const rein = ohneKommentare(quelle);
    expect(rein, 'der Aufruf muss stehen bleiben').toContain('authorize');
    // Der INHALT der Zeichenkette ist weg, die Huelle steht.
    expect(rein).not.toContain('x//y');
  });

  it('und dasselbe mit doppelten Quotes und Backticks', () => {
    expect(ohneKommentare(`const a = "//weg"; authorize();`)).toContain('authorize');
    expect(ohneKommentare('const a = `//weg`; authorize();')).toContain('authorize');
    expect(ohneKommentare(`const a = 'a/*b*/c'; authorize();`)).toContain('authorize');
  });

  it('ein Anführungszeichen IM Kommentar reisst nicht die halbe Datei mit', () => {
    const quelle = [
      "// der Kunde's Name steht hier nicht",
      "await authorize(sitzung, 'auftrag.lesen');",
      'const b = 1;',
    ].join('\n');
    const rein = ohneKommentare(quelle);
    expect(rein).toContain('authorize');
    expect(rein).toContain('const b = 1');
    expect(rein).not.toContain('Kunde');
  });

  it('echte Kommentare verschwinden weiterhin — beide Formen', () => {
    expect(ohneKommentare('/* process.env.X */ const a = 1;')).not.toContain('process.env');
    expect(ohneKommentare('// process.env.X\nconst a = 1;')).not.toContain('process.env');
    expect(ohneKommentare('/* a\n b\n c */ x')).toContain('x');
  });

  it('eine URL mitten im Code überlebt — sie ist keine Kommentarzeile', () => {
    /*
     * `https://…` war der Grund für die alte `[^:]`-Sonderregel. Der
     * Durchgang braucht sie nicht: er steht beim `//` schon INNERHALB der
     * Zeichenkette und sieht es gar nicht als Kommentar.
     */
    const rein = ohneKommentare(`const u = 'https://cse.example/x'; authorize();`);
    expect(rein).toContain('authorize');
    expect(rein).toContain('const u =');
  });

  it('eine nicht geschlossene Zeichenkette endet am Zeilenende, nicht an der Datei', () => {
    const rein = ohneKommentare("const a = 'offen\nawait authorize();");
    expect(rein, 'die naechste Zeile ist wieder Code').toContain('authorize');
  });

  it('ein maskiertes Anführungszeichen beendet die Zeichenkette nicht', () => {
    const rein = ohneKommentare(`const a = 'er sagte \\'nein\\' //x'; authorize();`);
    expect(rein).toContain('authorize');
  });

  it('ein nicht geschlossener Blockkommentar frisst den Rest — und sagt es nicht anders', () => {
    // Das ist richtig so: solcher Text ist kein gültiges TypeScript.
    expect(ohneKommentare('/* offen\nauthorize();').trim()).toBe('');
  });
});

describe('ohneKommentareMitTexten — Code samt Texten, ohne jeden Kommentar', () => {
  it('behält den Inhalt der Zeichenketten', () => {
    // Das Gesuchte einer Verdrahtungspruefung IST eine Zeichenkette:
    // `action="/api/zeit/korrektur"` steht in keinem Bezeichner.
    const rein = ohneKommentareMitTexten('const a = "/api/zeit/korrektur";');
    expect(rein).toContain('/api/zeit/korrektur');
  });

  it('wirft den Kommentar trotzdem weg — sonst genügte ein Satz darüber', () => {
    const rein = ohneKommentareMitTexten(
      '/* postet auf /api/zeit/korrektur */\nconst a = "/api/andere";');
    expect(rein).not.toContain('/api/zeit/korrektur');
    expect(rein).toContain('/api/andere');
  });

  it('und hat dieselbe Reihenfolge-Immunität wie die strenge Fassung', () => {
    // `'x//y'` darf den Rest der Zeile nicht fressen (siehe oben).
    const rein = ohneKommentareMitTexten(`const marke = 'x//y'; authorize();`);
    expect(rein).toContain('authorize');
    expect(rein).toContain('x//y');
  });

  it('ein Backtick-Text über mehrere Zeilen bleibt ganz', () => {
    const rein = ohneKommentareMitTexten('const q = `select 1\n  from zeiteintrag`;');
    expect(rein).toContain('from zeiteintrag');
  });
});

describe('ohnePsKommentare — dasselbe für PowerShell', () => {
  it('entfernt Block- und Zeilenkommentare', () => {
    expect(ohnePsKommentare('<# pnpm build #>\npnpm start')).not.toContain('build');
    expect(ohnePsKommentare('# pnpm build\npnpm start')).not.toContain('build');
    expect(ohnePsKommentare('# pnpm build\npnpm start')).toContain('pnpm start');
  });

  it('lässt Zeichenketten stehen — im Skript sind die Befehle oft darin', () => {
    expect(ohnePsKommentare('Write-Host "pnpm build"')).toContain('pnpm build');
  });
});
