/**
 * `gruppenKalenderZeilen` — welche Quellen überhaupt GEFRAGT werden.
 *
 * Diese Datei prüft keine Zeiten (das tut `kalender-tagesraster.test.ts` mit
 * den beiden DST-Nächten) und keine Rechte (das tut die Isolationssuite). Sie
 * prüft die eine Entscheidung, die dem Gruppenkalender eigen ist: **welche
 * Frage er stellt.**
 *
 * Der Befund dahinter: der Bereichskalender liest sieben Quellen, und die
 * siebte ist `gespraech` mit dem Titel `'Gespräch: ' || bewerbung.name`. In
 * einem gemeinsamen Kalender über vier Gesellschaften ist das der Name einer
 * Bewerberin der Schwestergesellschaft. Dass er nicht erscheint, darf nicht
 * davon abhängen, dass gerade keine Policy ihn freigibt — die Abfrage
 * existiert hier gar nicht, und dieser Test hält das fest.
 */
import { describe, expect, it } from 'vitest';
import type { LeseKontext } from '../../src/server/kontext/index.js';
import {
  GRUPPEN_QUELLEN, gruppenKalenderZeilen, QUELLEN_MIT_PERSONENBEZUG, QUELLEN_RECHT,
  type GruppenKalenderZeile,
} from '../../src/server/services/gruppe/kalender.js';

const R = '11111111-1111-1111-1111-111111111111';
const S = '22222222-2222-2222-2222-222222222222';
const PERSON = 'cccccccc-0000-0000-0000-000000000001';
const TEAM = 'dddddddd-0000-0000-0000-000000000001';

interface Mitschrift {
  readonly sql: readonly string[];
  readonly werte: readonly (readonly unknown[])[];
}

function kontext(
  mitschrift: { sql: string[]; werte: unknown[][] },
  antwort: (sql: string) => readonly Partial<GruppenKalenderZeile>[] = () => [],
): LeseKontext {
  const abfrage = async <T,>(sql: string, werte?: readonly unknown[]): Promise<readonly T[]> => {
    mitschrift.sql.push(sql);
    mitschrift.werte.push([...(werte ?? [])]);
    return antwort(sql) as T[];
  };
  return {
    scope: 'gruppe', portal: 'intern', benutzerId: 'b', aktiverMandantId: null,
    mandantIds: [R, S], abfrage,
  };
}

function neu(): { sql: string[]; werte: unknown[][] } {
  return { sql: [], werte: [] };
}

const LAGE = { von: '2026-09-01', bis: '2026-09-30', mandantIds: [R, S] } as const;

/**
 * Welche QUELLE hat diese Abfrage — aus dem Literal, das sie selbst ausgibt.
 *
 * Nicht aus dem ersten `from`: die Anfragezeile loest ihren Kundennamen in
 * einer Unterabfrage auf (`select k.name from kunde …`), und die stuende dort
 * vor `from lead`. Eine Pruefung, die daran haengt, prueft die Reihenfolge
 * der Zeichen und nicht die Sache.
 */
function quellenGefragt(m: Mitschrift): readonly string[] {
  return m.sql.map((s) => /'([a-z]+)'::text as quelle/u.exec(s)?.[1] ?? '?');
}

/** Und die Tabellen, die eine Abfrage ueberhaupt anfasst. */
function tabellen(m: Mitschrift): readonly string[] {
  return m.sql.flatMap((s) => [...s.matchAll(/\bfrom\s+([a-z_]+)/gu)].map((t) => t[1] ?? '?'));
}

describe('der Gruppenkalender fragt `gespraech` NICHT', () => {
  it('keine der Abfragen berührt eine Bewerbertabelle', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), LAGE);
    const alles = m.sql.join('\n').toLowerCase();
    for (const tabelle of ['gespraech', 'bewerbung', 'kandidat', 'einstellungsentscheidung']) {
      expect(alles, `${tabelle} steht in einer Abfrage des Gruppenkalenders`)
        .not.toContain(tabelle);
    }
  });

  it('und `gespraech` ist keine Quelle, die sich anfordern liesse', () => {
    expect([...GRUPPEN_QUELLEN]).not.toContain('gespraech');
    expect(Object.keys(QUELLEN_RECHT)).not.toContain('gespraech');
  });

  it('die sechs Quellen sind genau die sechs, für die ein Recht benannt ist', () => {
    expect([...GRUPPEN_QUELLEN].sort()).toEqual(Object.keys(QUELLEN_RECHT).sort());
  });
});

describe('welche Abfragen laufen', () => {
  it('ohne Filter: alle sechs', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), LAGE);
    expect(m.sql).toHaveLength(6);
    expect(quellenGefragt(m)).toEqual(
      ['termin', 'einsatz', 'projekt', 'vergabe', 'freigabe', 'lead']);
    expect(tabellen(m)).toContain('kalender_eintrag');
    expect(tabellen(m)).toContain('ausschreibung_vorgang');
    expect(tabellen(m)).toContain('lead');
  });

  it('mit einer Quellenauswahl: nur diese', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), { ...LAGE, nurQuellen: ['termin', 'vergabe'] });
    expect(quellenGefragt(m)).toEqual(['termin', 'vergabe']);
  });

  it('mit Personenfilter: NUR die Schichten — eine Vergabefrist gehört keinem Menschen', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), { ...LAGE, nurPersonId: PERSON });
    expect(quellenGefragt(m)).toEqual(['einsatz']);
    expect(QUELLEN_MIT_PERSONENBEZUG).toEqual(['einsatz']);
  });

  it('mit Teamfilter: dasselbe', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), { ...LAGE, nurTeamId: TEAM });
    expect(quellenGefragt(m)).toEqual(['einsatz']);
  });

  it('Personenfilter UND Quellenauswahl: der Schnitt, nicht die Vereinigung', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), {
      ...LAGE, nurPersonId: PERSON, nurQuellen: ['termin', 'einsatz'],
    });
    expect(quellenGefragt(m)).toEqual(['einsatz']);
  });

  it('Personenfilter auf einer Quelle ohne Personenbezug: KEINE Abfrage, keine leere Halbwahrheit', async () => {
    const m = neu();
    const zeilen = await gruppenKalenderZeilen(kontext(m), {
      ...LAGE, nurPersonId: PERSON, nurQuellen: ['vergabe'],
    });
    expect(m.sql).toEqual([]);
    expect(zeilen).toEqual([]);
  });
});

describe('die Werteliste ist in jeder Abfrage dieselbe', () => {
  it('sechs Parameter, in fester Reihenfolge', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), {
      ...LAGE, nurTeamId: TEAM, nurPersonId: PERSON, grenze: 42,
    });
    for (const w of m.werte) {
      expect(w).toEqual(['2026-09-01', '2026-09-30', [R, S], TEAM, PERSON, 42]);
    }
  });

  it('ohne Filter stehen dort NULL und nicht der leere String', async () => {
    const m = neu();
    await gruppenKalenderZeilen(kontext(m), LAGE);
    expect(m.werte[0]?.[3]).toBeNull();
    expect(m.werte[0]?.[4]).toBeNull();
    // Die Vorgabe der Grenze steht im Dienst, nicht in jeder Abfrage.
    expect(m.werte[0]?.[5]).toBe(1500);
  });

  it('die Mandantenliste wird KOPIERT — der Aufrufer hält keine Referenz in der Abfrage', async () => {
    const m = neu();
    const ids = [R, S];
    await gruppenKalenderZeilen(kontext(m), { ...LAGE, mandantIds: ids });
    expect(m.werte[0]?.[2]).not.toBe(ids);
    expect(m.werte[0]?.[2]).toEqual(ids);
  });
});

describe('die Zeilen', () => {
  const zeile = (teil: Partial<GruppenKalenderZeile>): Partial<GruppenKalenderZeile> => ({
    id: 'x', quelle: 'termin', titel: 'Titel',
    beginn: '2026-09-10T08:00:00.000Z', ende: '2026-09-10T09:00:00.000Z',
    ganztaegig: false, ort: null, beschreibung: null, abgesagt: false,
    geaendert: null, weg: null,
    mandantId: R, bereichSlug: 'reinigung', bereichName: 'CSE Dienstleistungen GmbH',
    ...teil,
  });

  it('tragen ihre Gesellschaft — sonst wäre „Hauptbahnhof" keine Auskunft', async () => {
    const m = neu();
    const zeilen = await gruppenKalenderZeilen(
      kontext(m, (sql) => (sql.includes('from kalender_eintrag')
        ? [zeile({ id: 'a', bereichSlug: 'security', bereichName: 'SSE Security' })]
        : [])),
      { ...LAGE, nurQuellen: ['termin'] },
    );
    expect(zeilen[0]?.bereichSlug).toBe('security');
    expect(zeilen[0]?.bereichName).toBe('SSE Security');
  });

  it('die Herkunft kommt aus dem Abfrageteil und nicht aus der Zeile', async () => {
    // Eine Abfrage, die eine falsche Herkunft zuruecklieferte, koennte einen
    // Eintrag als „Termin" ausgeben, der eine Schicht ist. Der Dienst setzt sie.
    const m = neu();
    const zeilen = await gruppenKalenderZeilen(
      kontext(m, () => [zeile({ id: 'a', quelle: 'termin' })]),
      { ...LAGE, nurQuellen: ['einsatz'] },
    );
    expect(zeilen[0]?.quelle).toBe('einsatz');
  });

  it('sortiert nach Beginn, Ganztägiges zuerst, dann nach Titel', async () => {
    const m = neu();
    const zeilen = await gruppenKalenderZeilen(
      kontext(m, (sql) => (sql.includes('from kalender_eintrag')
        ? [
          zeile({ id: 'spaet', titel: 'Zweite', beginn: '2026-09-10T10:00:00.000Z' }),
          zeile({ id: 'frueh', titel: 'Erste', beginn: '2026-09-10T08:00:00.000Z' }),
          zeile({ id: 'ganz', titel: 'Bandtag', ganztaegig: true,
                  beginn: '2026-09-10T08:00:00.000Z' }),
        ]
        : [])),
      { ...LAGE, nurQuellen: ['termin'] },
    );
    expect(zeilen.map((z) => z.id)).toEqual(['ganz', 'frueh', 'spaet']);
  });

  it('die Reihenfolge geht über QUELLEN hinweg — sechs sortierte Listen sind keine', async () => {
    const m = neu();
    const zeilen = await gruppenKalenderZeilen(
      kontext(m, (sql) => {
        if (sql.includes('from kalender_eintrag')) {
          return [zeile({ id: 'termin-spaet', beginn: '2026-09-10T16:00:00.000Z' })];
        }
        if (sql.includes('from einsatz')) {
          return [zeile({ id: 'schicht-frueh', beginn: '2026-09-10T05:00:00.000Z' })];
        }
        return [];
      }),
      { ...LAGE, nurQuellen: ['termin', 'einsatz'] },
    );
    expect(zeilen.map((z) => z.id)).toEqual(['schicht-frueh', 'termin-spaet']);
  });
});
