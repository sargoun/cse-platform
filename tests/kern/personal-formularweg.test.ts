/**
 * Kein Personalformular bekommt JSON — auch nicht für einen frühen
 * Eingabefehler (V-273, D-771 Nr. 15, D-599, D-766).
 *
 * **Der Befund.** `POST /api/personal/nachweise` und `POST /api/personal/zugang`
 * prüften Handlung und Kennung vor allem anderen und antworteten darauf mit
 * `{"fehler":…}` — auch dem Formular der Seite, auf der ohne JavaScript dann
 * eine weisse Seite mit geschweiften Klammern stand. Jetzt führt
 * `grundAufsFormularweg` ein Formular (`fehlerweg`, sonst `zurueck`) mit dem
 * Grund zurück; ein Programm ohne beide Felder bekommt weiter JSON mit 400.
 *
 * Geprüft werden die ECHTEN Routen; ersetzt sind nur Sitzung und Datenbank —
 * die frühen Prüfungen kommen vor beidem.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NACHWEIS_ERFASSEN_TEXTE } from '../../src/lib/i18n/verwaltung/personal-nachweis.js';
import { ZUGANG_TEXTE } from '../../src/lib/i18n/verwaltung/personal-zugang.js';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  datenbank: vi.fn(),
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: zustand.datenbank }),
}));

const { POST: nachweis } = await import('../../src/app/api/personal/nachweise/route.js');
const { POST: zugang } = await import('../../src/app/api/personal/zugang/route.js');

const HIER = 'http://localhost:3001';
const PERSON = '6c1e5b0d-0a41-4c55-9d1c-1c2f3b4a5d6f';
const NACHWEIS = '7d2f6c1e-0a41-4c55-9d1c-1c2f3b4a5d70';

function anfrage(pfad: string, felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries(felder)) daten.append(k, v);
  const kopf = new Headers({ host: 'localhost:3001', origin: HIER });
  return new NextRequest(new URL(pfad, HIER), { method: 'POST', body: daten, headers: kopf });
}

function ziel(antwort: Response): URL {
  return new URL(antwort.headers.get('location') ?? '');
}

/** Dieselben Felder ohne `zurueck` und `fehlerweg` — so ruft ein Programm, kein Formular (D-599). */
function alsProgramm(felder: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(felder).filter(([k]) => k !== 'zurueck' && k !== 'fehlerweg'));
}

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.datenbank.mockReset();
  zustand.datenbank.mockRejectedValue(new Error('Datenbank verboten — die Prüfung kommt vorher.'));
});

describe('POST /api/personal/nachweise — Handlung und Kennung', () => {
  const BLATT = `/portal/reinigung/personal/nachweise/${NACHWEIS}`;
  const FORMULAR = { aktion: 'bestaetigen', id: NACHWEIS, zurueck: BLATT, fehlerweg: BLATT };

  it.each([
    [{ aktion: 'loeschen' }, 'unbekannte_handlung'],
    [{ id: 'nicht-uuid' }, 'keine_kennung'],
    [{ aktion: 'widerrufen', id: '' }, 'keine_kennung'],
  ] as const)('%o → Formular: zurück mit %s; Programm: JSON 400', async (anders, grund) => {
    const formular = await nachweis(anfrage('/api/personal/nachweise', { ...FORMULAR, ...anders }));
    expect(formular.status).toBe(303);
    expect(ziel(formular).pathname).toBe(BLATT);
    expect(ziel(formular).searchParams.get('fehler')).toBe(grund);

    const programm = await nachweis(anfrage('/api/personal/nachweise',
      alsProgramm({ ...FORMULAR, ...anders })));
    expect(programm.status).toBe(400);
    expect(await programm.json()).toEqual({ fehler: grund });

    expect(zustand.datenbank).not.toHaveBeenCalled();
    for (const sprache of ['de', 'en'] as const) {
      expect(eigenerEintrag(NACHWEIS_ERFASSEN_TEXTE[sprache].fehler, grund), sprache).toBeTruthy();
    }
  });
});

describe('POST /api/personal/zugang — Handlung und Kennung', () => {
  const SEITE = `/portal/reinigung/personal/personen/${PERSON}/zugang`;
  /* Die Formulare der Zugangsseite schicken nur `zurueck` — die Seite selbst. */
  const FORMULAR = { aktion: 'sperren', person: PERSON, grund: 'Telefon verloren', zurueck: SEITE };

  it.each([
    [{ aktion: 'loeschen' }, 'unbekannte_handlung'],
    [{ person: 'nicht-uuid' }, 'keine_kennung'],
  ] as const)('%o → Formular: zurück mit %s; Programm: JSON 400', async (anders, grund) => {
    const formular = await zugang(anfrage('/api/personal/zugang', { ...FORMULAR, ...anders }));
    expect(formular.status).toBe(303);
    expect(ziel(formular).pathname).toBe(SEITE);
    expect(ziel(formular).searchParams.get('fehler')).toBe(grund);
    // Nur der Grund reist — nicht der Sperrgrund, den jemand getippt hat.
    expect(ziel(formular).toString()).not.toContain('Telefon');

    const programm = await zugang(anfrage('/api/personal/zugang',
      alsProgramm({ ...FORMULAR, ...anders })));
    expect(programm.status).toBe(400);
    expect(await programm.json()).toEqual({ fehler: grund });

    expect(zustand.datenbank).not.toHaveBeenCalled();
    for (const sprache of ['de', 'en'] as const) {
      expect(eigenerEintrag(ZUGANG_TEXTE[sprache].fehler, grund), sprache).toBeTruthy();
    }
  });
});
