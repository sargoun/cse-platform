/**
 * Die Einladung eines Verwaltungskontos kommt mit einem SCHLÜSSEL zurück —
 * Erfolg und Abweisung getrennt, nie ein Satz der Datenbank (D-769, D-774).
 *
 * **Der Befund.** `POST /api/system/verwaltungskonto` schickte alles als
 * `?meldung=`: den ERFOLG (`eingeladen`, derselbe Parameter wie ein Fehler —
 * ohne das Link-Cookie stand „eingeladen" im Warnkasten), einen festen Satz
 * mit Backticks, den Satz von `EinladungFehler`, die deutschen `grund`-Sätze
 * aus `app.verwaltungskonto_einladen` (0372) und den rohen Text JEDES
 * einzeiligen Fehlers — auch den von `authorize`: ein fehlendes Recht wurde
 * `?meldung=Nicht gefunden` statt der byte-gleichen 404 (AUT-06), und ein
 * Verbindungsabbruch eine erfundene Abweisung.
 *
 * Geprüft wird die ECHTE Route mit dem echten Dienst (ersetzt sind nur
 * Sitzung, Datenbank, Tor, Keks und der Anbieter), die Tabelle der Sätze in
 * beiden Sprachen der Seite und am Quelltext, dass die Seite `meldung` nicht
 * mehr liest.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eigenerEintrag } from '../../src/lib/nachschlagen.js';
import {
  VERWALTUNGSKONTO_FEHLER_GRUENDE, VERWALTUNGSKONTO_TEXTE,
} from '../../src/lib/i18n/verwaltung/einstellungen/verwaltungskonto.js';

const zustand = vi.hoisted(() => ({
  sitzung: null as null | Record<string, unknown>,
  authorize: vi.fn(),
  schreibe: vi.fn(),
  anbieter: 'demo' as 'demo' | 'supabase',
  gesetzt: [] as { name: string; wert: string; optionen: Record<string, unknown> }[],
  geloescht: [] as string[],
}));

vi.mock('@/server/auth/anfrage-sitzung', () => ({
  aktuelleSitzung: () => Promise.resolve(zustand.sitzung),
}));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    set: (name: string, wert: string, optionen: Record<string, unknown>) => {
      zustand.gesetzt.push({ name, wert, optionen });
    },
    /* Mit Pfad: ein Löschkeks ohne `Path` träfe den Keks unter dem Pfad der Seite nicht. */
    delete: (arg: string | { name: string; path?: string }) => {
      zustand.geloescht.push(typeof arg === 'string' ? arg : `${arg.name}@${arg.path ?? ''}`);
    },
  }),
}));
vi.mock('@/server/db/pool', () => ({
  db: () => ({ begin: <T,>(fn: (tx: unknown) => Promise<T>) => fn({}) }),
}));
vi.mock('@/server/kontext/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  withTenant: <T,>(_tx: unknown, _s: unknown, fn: (k: unknown) => Promise<T>) => fn({
    abfrage: () => Promise.resolve([]),
    schreibe: zustand.schreibe,
  }),
}));
vi.mock('@/server/auth/authorize', () => ({ authorize: zustand.authorize }));
vi.mock('@/server/auth/zugang', () => ({ rechtepruefer: () => ({}) }));
vi.mock('@/server/auth/kennwort-anmeldung', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  anbieter: () => zustand.anbieter,
}));

const {
  EINLADUNG_COOKIE, EinladungFehler, einladungsGrund,
} = await import('../../src/server/services/system/verwaltungskonto.js');
const { NichtGefundenFehler, ZweiterFaktorFehler } = await import('../../src/server/auth/fehler.js');
const route = await import('../../src/app/api/system/verwaltungskonto/route.js');

const WURZEL = resolve(import.meta.dirname, '../..');
const HIER = 'http://localhost:3001';
const SEITE = '/portal/reinigung/einstellungen/benutzer/einladen';

function formular(felder: Record<string, string>): NextRequest {
  const daten = new FormData();
  for (const [k, v] of Object.entries({ zurueck: SEITE, email: 'neu@cse.test', name: 'Neu', rolle: 'admin', ...felder })) {
    daten.append(k, v);
  }
  return new NextRequest(new URL('/api/system/verwaltungskonto', HIER), {
    method: 'POST', body: daten,
    headers: new Headers({ host: 'localhost:3001', origin: HIER }),
  });
}

/** Die Zeile, die `app.verwaltungskonto_einladen` zurückgibt. */
const zeile = (ok: boolean, grund: string) =>
  [{ ok, grund, konto_id: ok ? '00000000-0000-4000-8000-0000000000aa' : null, neues_konto: ok }];

beforeEach(() => {
  zustand.sitzung = {
    benutzerId: '00000000-0000-4000-8000-000000000001',
    aktiverMandantId: '00000000-0000-4000-8000-000000000002',
    personId: null, ansicht: 'mandant', aal: 'aal2', portal: 'intern',
    sitzungId: '00000000-0000-4000-8000-000000000003',
  };
  zustand.authorize.mockReset().mockResolvedValue(zustand.sitzung);
  zustand.schreibe.mockReset();
  zustand.anbieter = 'demo';
  zustand.gesetzt = [];
  zustand.geloescht = [];
});

async function ort(r: Response): Promise<string> {
  expect(r.status).toBe(303);
  const o = r.headers.get('location') ?? '';
  expect(o).not.toContain('meldung=');
  return o;
}

describe('POST /api/system/verwaltungskonto — Erfolg und Abweisung als Schlüssel', () => {
  it('Erfolg: `?erfolg=eingeladen` — nicht mehr als `meldung`, und der Link im Keks', async () => {
    zustand.schreibe.mockResolvedValue(zeile(true, 'eingeladen'));
    const o = await ort(await route.POST(formular({})));
    expect(o).toBe(`${HIER}${SEITE}?erfolg=eingeladen`);
    expect(zustand.gesetzt).toHaveLength(1);
    expect(zustand.gesetzt[0]).toMatchObject({
      name: EINLADUNG_COOKIE, optionen: { httpOnly: true, path: SEITE, maxAge: 300 },
    });
  });

  /* Die Sätze, die 0372 zurückgibt — Wort für Wort, wie die Datenbank sie liefert. */
  it.each([
    ['gesellschaft_fehlt', 'Diese Gesellschaft gibt es nicht.'],
    ['email_ungueltig', 'Ohne gueltige E-Mail-Adresse gibt es kein Konto.'],
    ['name_fehlt', 'Ein Konto braucht einen Namen — er steht in jeder Freigabe und in jedem '
      + 'Protokolleintrag.'],
    ['rolle_unzulaessig', 'Ueber diesen Weg werden nur `admin` und `leitung` eingeladen. '
      + 'Mitarbeiter- und Kundenzugaenge haben eigene Wege; ein Super-Admin entsteht nur ueber '
      + 'die Umgebung (D-617).'],
    ['kundenkonto', 'Diese Adresse gehoert einem Kundenkonto. Ein Verwaltungszugang dafuer '
      + 'wuerde die Trennung der Portale aufheben (K-04).'],
    ['schon_eingetragen', 'Dieses Konto ist in dieser Gesellschaft schon eingetragen. Aendern '
      + 'Sie seine Rolle, statt es erneut einzuladen.'],
  ] as const)('der Satz der Datenbank für %s wird sein Schlüssel', async (grund, satz) => {
    zustand.schreibe.mockResolvedValue(zeile(false, satz));
    expect(await ort(await route.POST(formular({})))).toBe(`${HIER}${SEITE}?fehler=${grund}`);
    expect(zustand.gesetzt).toEqual([]);
    expect(zustand.geloescht).toEqual([`${EINLADUNG_COOKIE}@${SEITE}`]);
  });

  it('ein Satz der Datenbank, den der Dienst nicht kennt, wird der allgemeine Schlüssel — nie der Text', async () => {
    zustand.schreibe.mockResolvedValue(zeile(false, 'Ein ganz neuer Satz <b>mit</b> Markup.'));
    expect(await ort(await route.POST(formular({}))))
      .toBe(`${HIER}${SEITE}?fehler=nicht_ausgestellt`);
    zustand.schreibe.mockResolvedValue([]);
    expect(await ort(await route.POST(formular({}))))
      .toBe(`${HIER}${SEITE}?fehler=nicht_ausgestellt`);
  });

  it('die eigene Rollenprüfung der Route: `rolle_unzulaessig`, ohne die Datenbank zu fragen', async () => {
    expect(await ort(await route.POST(formular({ rolle: 'super_admin' }))))
      .toBe(`${HIER}${SEITE}?fehler=rolle_unzulaessig`);
    expect(zustand.schreibe).not.toHaveBeenCalled();
    /* Auch diese Abweisung nimmt einen Link aus einem früheren Versuch mit weg. */
    expect(zustand.geloescht).toEqual([`${EINLADUNG_COOKIE}@${SEITE}`]);
  });

  it('ein anderer Anbieter: `anbieter_fremd`', async () => {
    zustand.anbieter = 'supabase';
    expect(await ort(await route.POST(formular({}))))
      .toBe(`${HIER}${SEITE}?fehler=anbieter_fremd`);
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('die Datenbank sagt „darf nicht" (42501): `nicht_erlaubt` — nicht ihr Satz', async () => {
    zustand.schreibe.mockRejectedValue(Object.assign(
      new Error('system.verwaltungskonto_erstellen fehlt (D-610: nur der Super-Admin)'),
      { code: '42501' }));
    const o = await ort(await route.POST(formular({})));
    expect(o).toBe(`${HIER}${SEITE}?fehler=nicht_erlaubt`);
    expect(decodeURIComponent(o)).not.toContain('Super-Admin');
  });

  it('jede Fehlerklasse des Dienstes trägt einen Grund, den die Seite kennt', () => {
    for (const g of ['anbieter_fremd', 'nicht_erlaubt'] as const) {
      expect(VERWALTUNGSKONTO_FEHLER_GRUENDE).toContain(new EinladungFehler('x', g).grund);
    }
    for (const satz of ['Diese Gesellschaft gibt es nicht.', 'irgendwas', '']) {
      expect(VERWALTUNGSKONTO_FEHLER_GRUENDE).toContain(einladungsGrund(satz));
    }
  });
});

describe('Anmeldung und Recht zuerst (AUT-06, D-766)', () => {
  it('ein fehlendes Recht bleibt die byte-gleiche 404 — nicht `?meldung=Nicht gefunden`', async () => {
    zustand.authorize.mockRejectedValue(new NichtGefundenFehler('Recht fehlt'));
    const r = await route.POST(formular({}));
    expect(r.status).toBe(404);
    expect(await r.text()).toBe('{"fehler":"nicht_gefunden"}');
    expect(zustand.schreibe).not.toHaveBeenCalled();
  });

  it('ohne zweiten Faktor geht es zum Faktor-Schritt, zurück auf die Seite', async () => {
    zustand.authorize.mockRejectedValue(new ZweiterFaktorFehler());
    expect(await ort(await route.POST(formular({}))))
      .toBe(`${HIER}/auth/zwei-faktor/einrichten?weiter=${encodeURIComponent(SEITE)}`);
  });

  it('ein unbekannter Fehler bleibt ein Fehler — keine erfundene Abweisung', async () => {
    zustand.schreibe.mockRejectedValue(new Error('Verbindung weg'));
    await expect(route.POST(formular({}))).rejects.toThrow('Verbindung weg');
  });
});

/**
 * **Der Satz zum Link verspricht keinen Weg, den es nicht gibt** (D-774
 * Nachrunde, O-980, O-981). `linkEinmal` sagte „wenn Sie ihn verlieren,
 * stellen Sie einen neuen aus — der alte verfällt dabei"; eine zweite
 * Einladung derselben Adresse ergibt aber `schon_eingetragen`, und dessen
 * Satz riet, die Rolle zu ändern — auch dafür gibt es keinen Weg. Einen
 * neuen Link für eine offene Einladung stellt beim Kundenzugang
 * `app.kundenzugang_neu_einladen` aus (0249); für ein Verwaltungskonto gibt
 * es nichts Entsprechendes.
 */
describe('der Satz zum Einladungslink sagt, was wirklich geht', () => {
  const lies = (datei: string): string => readFileSync(join(WURZEL, datei), 'utf8');

  it.each(['de', 'en'] as const)('%s: kein Versprechen eines neuen Links, dafür die offene Frage', (sprache) => {
    const t = VERWALTUNGSKONTO_TEXTE[sprache];
    expect(t.linkEinmal).not.toMatch(/stellen Sie einen neuen aus|verfällt dabei|issue a new one|expires in the process/u);
    expect(t.linkEinmal).toContain('O-980');
    expect(t.fehler.schon_eingetragen).not.toMatch(/Ändern Sie seine Rolle|Change its role/u);
    expect(t.fehler.schon_eingetragen).toContain('O-980');
    expect(t.fehler.schon_eingetragen).toContain('O-981');
  });

  it('der Satz bleibt wahr: die Datenbank weist eine zweite Einladung ab, und kein Dienst stellt neu aus', () => {
    /* 0372: eine Mitgliedschaft in dieser Gesellschaft → „schon eingetragen", kein neuer Token. */
    const einladung = lies('drizzle/0372_verwaltungskonto_einladung.sql');
    expect(einladung).toMatch(/and bm\.entzogen_am is null\) then\s+return query select false, 'Dieses Konto ist in dieser Gesellschaft schon '/u);
    /* Baut jemand den Weg, fällt dieser Test — und erinnert an die zwei Sätze und O-980. */
    const dienst = lies('src/server/services/system/verwaltungskonto.ts');
    expect(dienst).not.toMatch(/neu_einladen|neuEinladen|ladeNeuEin|linkNeu/u);
    expect(lies('src/app/api/system/verwaltungskonto/route.ts')).not.toMatch(/neu_einladen|ladeNeuEin/u);
  });

  it.each(['O-980', 'O-981'])('%s steht im Register, und sein TODO steht an dem Satz, den die Antwort ändert', (frage) => {
    const register = lies('docs/DECISIONS.md');
    const start = register.indexOf('## Open — ask, do not guess');
    const offen = register.slice(start, register.indexOf('\n## ', start + 1));
    const zeile = offen.split('\n').find((z) => z.startsWith(`| ${frage} |`));
    expect(zeile, `${frage} im Abschnitt „Open"`).toBeDefined();
    expect(zeile).toContain('`src/lib/i18n/verwaltung/einstellungen/verwaltungskonto.ts`');
    expect(lies('src/lib/i18n/verwaltung/einstellungen/verwaltungskonto.ts'))
      .toContain(`TODO(client, ${frage})`);
  });
});

describe('die Sätze der Seite — de und en', () => {
  it('jeder Grund hat in beiden Sprachen einen Satz, ohne Kennung und ohne Platzhalter', () => {
    for (const sprache of ['de', 'en'] as const) {
      const t = VERWALTUNGSKONTO_TEXTE[sprache];
      expect(t.fehlerSonst.trim()).not.toBe('');
      expect(eigenerEintrag(t.erfolg, 'eingeladen')).toBeTruthy();
      for (const g of VERWALTUNGSKONTO_FEHLER_GRUENDE) {
        const satz = eigenerEintrag(t.fehler, g);
        expect(satz, `${sprache}.${g}`).toBeTruthy();
        expect(satz, `${sprache}.${g}`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|\{\w+\}|`/u);
        if (sprache === 'en') expect(satz).not.toBe(VERWALTUNGSKONTO_TEXTE.de.fehler[g]);
      }
    }
  });

  it('ein fremder Schlüssel aus der Adresse findet nichts — auch keinen Prototyp', () => {
    for (const k of ['__proto__', 'constructor', 'toString', 'eingeladen', 'Hallo Welt']) {
      expect(eigenerEintrag(VERWALTUNGSKONTO_TEXTE.de.fehler, k), k).toBeUndefined();
    }
    for (const k of ['__proto__', 'constructor', 'nicht_erlaubt']) {
      expect(eigenerEintrag(VERWALTUNGSKONTO_TEXTE.de.erfolg, k), k).toBeUndefined();
    }
  });

  it('die Seite liest `meldung` nicht mehr und schlägt beide Schlüssel nach', () => {
    const seite = readFileSync(
      join(WURZEL, 'src/app/portal/[mandant]/einstellungen/benutzer/einladen/page.tsx'), 'utf8');
    expect(seite).not.toMatch(/\['meldung'\]/u);
    expect(seite).toContain('eigenerEintrag(t.fehler, fehler) ?? t.fehlerSonst');
    expect(seite).toContain('eigenerEintrag(t.erfolg, erfolg)');
    expect(seite).toMatch(/rolle="alert" cse="vk-meldung"/u);
    expect(seite).toMatch(/rolle="status" cse="vk-link"/u);
  });
});
