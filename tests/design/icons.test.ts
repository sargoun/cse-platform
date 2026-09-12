/**
 * Der Iconsatz (DESIGN §5 "Icons").
 *
 * Die Zusagen, die still brechen, wenn niemand sie prueft:
 *
 * 1. Ein Name in einem Register, den der Satz nicht kennt, zeichnet NICHTS.
 *    `ICON_PFADE[name]` ist dann `undefined`, `<path d={undefined}>` wirft
 *    nicht, und der Navigationspunkt steht ohne Bild da — auf jedem Geraet,
 *    ohne Fehler in der Konsole.
 * 2. Ein Pfad, der ueber `0 … 24` hinauslaeuft, wird an der Kante
 *    abgeschnitten. Bei Strich 1.75 faellt schon 23.5 auf.
 * 3. Ein `fill` im Pfad macht aus einer Linienzeichnung einen schwarzen
 *    Klecks, sobald `currentColor` dunkel ist.
 */
import { describe, expect, it } from 'vitest';
import { ICON_GROESSEN, ICON_PFADE, istIconName, type IconName } from '@/lib/design/icons';
import { NAVIGATION } from '@/server/registry/navigation';
import { TABLEISTEN } from '@/server/registry/tableiste';

const NAMEN = Object.keys(ICON_PFADE) as readonly IconName[];

/**
 * Die Ankerpunkte eines Pfads — der Punkt, auf dem der Stift nach jedem
 * Befehl steht. Genug fuer die Frage "steht etwas ausserhalb des Feldes";
 * Kontrollpunkte einer Kurve duerfen das legitim, der Anker nicht.
 *
 * Unterstuetzt genau, was der Satz benutzt: M/m L/l H/h V/v C/c Q/q A/a Z/z.
 */
function ankerpunkte(d: string): readonly (readonly [number, number])[] {
  const punkte: (readonly [number, number])[] = [];
  const teile = d.match(/[MmLlHhVvCcQqAaZz]|-?\d*\.?\d+/g) ?? [];
  const argzahl: Record<string, number> = {
    M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, Z: 0,
  };
  let x = 0, y = 0, sx = 0, sy = 0, befehl = 'M';
  let i = 0;
  while (i < teile.length) {
    const stueck = teile[i] as string;
    if (/[A-Za-z]/.test(stueck)) { befehl = stueck; i += 1; }
    const gross = befehl.toUpperCase();
    const rel = befehl !== gross;
    const n = argzahl[gross] ?? 0;
    const args = teile.slice(i, i + n).map(Number);
    i += n;
    if (gross === 'Z') { x = sx; y = sy; }
    else if (gross === 'H') { x = rel ? x + (args[0] as number) : (args[0] as number); }
    else if (gross === 'V') { y = rel ? y + (args[0] as number) : (args[0] as number); }
    else {
      // Der Endpunkt steht bei C, Q und A am Schluss der Argumente.
      const ex = args[n - 2] as number;
      const ey = args[n - 1] as number;
      x = rel ? x + ex : ex;
      y = rel ? y + ey : ey;
      if (gross === 'M') { sx = x; sy = y; }
    }
    punkte.push([x, y]);
    // Nach einem M gelten weitere Zahlenpaare als L (SVG-Regel).
    if (gross === 'M') befehl = rel ? 'l' : 'L';
  }
  return punkte;
}


describe('der Iconsatz ist geschlossen und vollstaendig', () => {
  it('jeder Registereintrag nennt ein Icon, das es gibt', () => {
    for (const n of NAVIGATION) {
      expect(istIconName(n.icon), `navigation.${n.schluessel}: ${n.icon}`).toBe(true);
    }
    for (const l of TABLEISTEN) {
      for (const z of l.ziele) {
        expect(istIconName(z.icon), `${l.schluessel}.${z.schluessel}: ${z.icon}`).toBe(true);
      }
    }
  });

  it('kein Pfad ist leer, und jeder faengt mit einem Absolutbefehl an', () => {
    for (const name of NAMEN) {
      const d = ICON_PFADE[name];
      expect(d.length, name).toBeGreaterThan(8);
      expect(d.startsWith('M'), `${name}: ${d.slice(0, 12)}`).toBe(true);
    }
  });

  it('jede Figur bleibt im Feld 0 … 24', () => {
    // Die Pfade tragen RELATIVE Befehle (`h-7`), und `-7` ist dort kein Punkt,
    // sondern eine Strecke. Ein Test, der die Zahlen nur herausgreift, misst
    // deshalb das Falsche und schlaegt an, wo nichts ist. Gemessen werden die
    // ANKERPUNKTE — nach jedem Befehl der erreichte Punkt.
    for (const name of NAMEN) {
      for (const [px, py] of ankerpunkte(ICON_PFADE[name])) {
        expect(px, `${name}: x=${px}`).toBeGreaterThanOrEqual(-0.01);
        expect(px, `${name}: x=${px}`).toBeLessThanOrEqual(24.01);
        expect(py, `${name}: y=${py}`).toBeGreaterThanOrEqual(-0.01);
        expect(py, `${name}: y=${py}`).toBeLessThanOrEqual(24.01);
      }
    }
  });

  it('kein Pfad benutzt einen Befehl, den die Pruefung nicht liest', () => {
    // Ohne diese Zusage ist die Feldpruefung oben eine Hoffnung: ein `s`
    // faellt aus dem Muster, seine Zahlen werden als etwas anderes gelesen,
    // und der Test schweigt genau da, wo er messen sollte.
    for (const name of NAMEN) {
      const befehle = ICON_PFADE[name].match(/[A-Za-z]/g) ?? [];
      for (const b of befehle) {
        expect('MmLlHhVvCcQqAaZz'.includes(b), `${name}: ${b}`).toBe(true);
      }
    }
  });

  it('kein Pfad bringt seine eigene Fuellung oder Farbe mit', () => {
    for (const name of NAMEN) {
      expect(ICON_PFADE[name]).not.toMatch(/fill|stroke|#/);
    }
  });

  it('die vier Groessen sind die aus DESIGN §5', () => {
    expect(ICON_GROESSEN).toEqual({ sm: 16, md: 18, lg: 24, xl: 32 });
  });

  it('istIconName weist alles ab, was nicht im Satz steht', () => {
    expect(istIconName('uebersicht')).toBe(true);
    expect(istIconName('gibt-es-nicht')).toBe(false);
    expect(istIconName(undefined)).toBe(false);
    expect(istIconName(42)).toBe(false);
    // Kein Zugriff ueber die Prototypenkette: `toString` ist kein Icon.
    expect(istIconName('toString')).toBe(false);
  });
});
