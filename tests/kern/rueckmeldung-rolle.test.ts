/**
 * **Der Ausgang eines Formulars wird angesagt** (DESIGN §5 „Notices", D-710
 * Nr. 6; V-267, Prüfung der Gruppe kalender-dokumente).
 *
 * Ein Kasten, der nach dem Absenden meldet, wie es ausging, trägt `rolle` —
 * `alert` für eine Abweisung, `status` für eine Bestätigung —, damit ein
 * Screenreader ihn nach dem POST-Redirect vorliest. Die Kästen, die diese
 * Gruppe gebaut hat, trugen keine; stumm blieben Abweisung und Bestätigung.
 * Statische Hinweise (etwa „nicht verbunden") bleiben ohne Rolle.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const B = 'src/app/portal/[mandant]/';

/** Seite → [data-cse, erwartete Rolle]. */
const KAESTEN: Readonly<Record<string, readonly (readonly [string, 'alert' | 'status'])[]>> = {
  'kalender/[id]/page.tsx': [['termin-erledigt', 'status'], ['termin-fehler', 'alert']],
  'kalender/neu/page.tsx': [['termin-fehler', 'alert']],
  'dokumente/[id]/page.tsx': [
    ['fassung-erfolg', 'status'], ['fassung-fehler', 'alert'],
    ['mitarbeiterfreigabe-erfolg', 'status'], ['mitarbeiterfreigabe-fehler', 'alert'],
    ['dokument-loeschfehler', 'alert'],
  ],
  'recruiting/bewerbungen/[id]/page.tsx': [
    ['bewerbung-erfasst', 'status'], ['kandidat-erledigt', 'status'],
    ['kandidat-fehler', 'alert'], ['termin-angelegt', 'status'], ['termin-fehler', 'alert'],
  ],
  'recruiting/bewerbungen/neu/page.tsx': [['postfach-fehler', 'alert']],
  'recruiting/gespraeche/[id]/page.tsx': [
    ['gespraech-erledigt', 'status'], ['gespraech-fehler', 'alert'],
  ],
  'recruiting/stellen/[id]/page.tsx': [
    ['stelle-entworfen', 'status'], ['stelle-bearbeitet', 'status'], ['stelle-fehler', 'alert'],
  ],
  'social/posts/[id]/page.tsx': [
    ['beitrag-bild-angehaengt', 'status'], ['beitrag-bild-entfernt', 'status'],
    ['beitrag-bild-fehler', 'alert'], ['beitrag-angelegt', 'status'], ['beitrag-fehler', 'alert'],
  ],
};

/** Jeder öffnende `<Hinweis …>` — auch über mehrere Zeilen — mit cse und rolle. */
function kaesten(quelle: string): { cse: string; rolle: string | null }[] {
  return [...quelle.matchAll(/<Hinweis\b([^>]*)>/gu)].map((m) => {
    const attribute = m[1] ?? '';
    return {
      cse: /\bcse="([^"]+)"/u.exec(attribute)?.[1] ?? '',
      rolle: /\brolle="([^"]+)"/u.exec(attribute)?.[1] ?? null,
    };
  });
}

describe('Rückmeldungen nach dem Absenden tragen ihre Rolle', () => {
  it.each(Object.entries(KAESTEN))('%s', (seite, erwartet) => {
    const gefunden = kaesten(readFileSync(`${B}${seite}`, 'utf8'));
    for (const [cse, rolle] of erwartet) {
      const k = gefunden.filter((g) => g.cse === cse);
      expect(k.length, `${cse} steht genau einmal da`).toBe(1);
      expect(k[0]!.rolle, cse).toBe(rolle);
    }
  });

  it('auf diesen Seiten meldet kein Fehlerkasten stumm', () => {
    for (const seite of Object.keys(KAESTEN)) {
      for (const k of kaesten(readFileSync(`${B}${seite}`, 'utf8'))) {
        if (/fehler$/u.test(k.cse)) expect(k.rolle, `${seite} ${k.cse}`).toBe('alert');
      }
    }
  });

  it('statische Hinweise bleiben ohne Rolle', () => {
    const neu = kaesten(readFileSync(`${B}recruiting/bewerbungen/neu/page.tsx`, 'utf8'));
    expect(neu.find((k) => k.cse === 'postfach-nicht-verbunden')?.rolle).toBeNull();
    const stelle = kaesten(readFileSync(`${B}recruiting/stellen/neu/page.tsx`, 'utf8'));
    expect(stelle.find((k) => k.cse === 'stelle-neu-hinweis')?.rolle).toBeNull();
  });
});
