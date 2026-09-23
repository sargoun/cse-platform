import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SupabaseSpeicher } from '@/server/storage/adapter';
import { OrdnerSchluesselFehler, OrdnerSpeicher } from '@/server/storage/ordner';
import { vorfuehrOrdner, waehleSpeicher } from '@/server/storage/waehle';

/**
 * V-131, D-623 — der Vorführspeicher.
 *
 * Geprüft wird, was ihn von „tut so als ob" trennt: die Datei liegt wirklich
 * da, sie kommt nur über eine ablaufende, signierte Adresse heraus, kein
 * Schlüssel führt aus dem Ordner, und in einem Deployment gibt es ihn nicht.
 */

const ordner: string[] = [];
function frisch(): string {
  const o = mkdtempSync(join(tmpdir(), 'cse-speicher-'));
  ordner.push(o);
  return o;
}
afterEach(() => { for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true }); });

const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

describe('§1 die Datei liegt wirklich da', () => {
  it('lege → hole gibt dieselben Bytes, und ein zweiter Speicher auf demselben Ordner sieht sie', async () => {
    const o = frisch();
    await new OrdnerSpeicher(o).lege('dokumente', 'm1/2026/a.pdf', BYTES);
    expect(await new OrdnerSpeicher(o).hole('dokumente', 'm1/2026/a.pdf')).toEqual(BYTES);
  });

  it('entferne nimmt sie weg, und hole sagt es', async () => {
    const s = new OrdnerSpeicher(frisch());
    await s.lege('archiv', 'x/y.pdf', BYTES);
    await s.entferne('archiv', 'x/y.pdf');
    await expect(s.hole('archiv', 'x/y.pdf')).rejects.toThrow('Objekt nicht gefunden.');
  });

  it('die Buckets sind getrennte Ordner', async () => {
    const s = new OrdnerSpeicher(frisch());
    await s.lege('dokumente', 'k.pdf', BYTES);
    await expect(s.hole('archiv', 'k.pdf')).rejects.toThrow('Objekt nicht gefunden.');
  });
});

describe('§2 kein Schlüssel führt aus dem Ordner', () => {
  const s = new OrdnerSpeicher('/tmp/cse-nie-angelegt');
  it.each([
    '../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '.geheimnis', 'a\\b', '', 'a/b/',
  ])('%j wird abgewiesen', (schluessel) => {
    expect(() => s.ort('dokumente', schluessel)).toThrow(OrdnerSchluesselFehler);
  });
  it('ein unbekannter Bucket ebenso', () => {
    expect(() => s.ort('oeffentlich' as never, 'a.pdf')).toThrow(OrdnerSchluesselFehler);
  });
});

describe('§3 heraus nur über eine ablaufende, signierte Adresse', () => {
  it('die Adresse nennt Ablauf und Signatur, und sie gilt genau bis zum Ablauf', async () => {
    let jetzt = 1_000_000;
    const s = new OrdnerSpeicher(frisch(), () => jetzt);
    await s.lege('dokumente', 'm/a.pdf', BYTES);
    const url = new URL(await s.signierteUrl('dokumente', 'm/a.pdf', 900), 'http://x');
    expect(url.pathname).toBe('/api/speicher/dokumente/m/a.pdf');
    const ablauf = Number(url.searchParams.get('ablauf'));
    const sig = url.searchParams.get('sig') ?? '';
    expect(ablauf).toBe(1_000_900);
    expect(s.pruefe('dokumente', 'm/a.pdf', ablauf, sig)).toBe(true);
    jetzt = 1_000_900;
    expect(s.pruefe('dokumente', 'm/a.pdf', ablauf, sig)).toBe(true);
    jetzt = 1_000_901;
    expect(s.pruefe('dokumente', 'm/a.pdf', ablauf, sig)).toBe(false);
  });

  it('eine Signatur gilt für GENAU dieses Objekt, diesen Bucket und diesen Ablauf', async () => {
    const s = new OrdnerSpeicher(frisch(), () => 10);
    await s.lege('dokumente', 'm/a.pdf', BYTES);
    const url = new URL(await s.signierteUrl('dokumente', 'm/a.pdf'), 'http://x');
    const ablauf = Number(url.searchParams.get('ablauf'));
    const sig = url.searchParams.get('sig') ?? '';
    expect(s.pruefe('dokumente', 'm/b.pdf', ablauf, sig)).toBe(false);
    expect(s.pruefe('archiv', 'm/a.pdf', ablauf, sig)).toBe(false);
    expect(s.pruefe('dokumente', 'm/a.pdf', ablauf + 1, sig)).toBe(false);
    expect(s.pruefe('dokumente', 'm/a.pdf', ablauf, `${sig}x`)).toBe(false);
    expect(s.pruefe('dokumente', 'm/a.pdf', Number.NaN, sig)).toBe(false);
  });

  it('ein fremder Ordner hat ein fremdes Geheimnis — seine Signatur gilt hier nicht', async () => {
    const a = new OrdnerSpeicher(frisch(), () => 10);
    const b = new OrdnerSpeicher(frisch(), () => 10);
    await a.lege('dokumente', 'k.pdf', BYTES);
    await b.lege('dokumente', 'k.pdf', BYTES);
    const url = new URL(await a.signierteUrl('dokumente', 'k.pdf'), 'http://x');
    expect(b.pruefe('dokumente', 'k.pdf',
      Number(url.searchParams.get('ablauf')), url.searchParams.get('sig') ?? '')).toBe(false);
  });

  it('das Geheimnis übersteht einen Neustart und liegt nur für den Eigentümer lesbar da', async () => {
    const o = frisch();
    const s = new OrdnerSpeicher(o, () => 10);
    await s.lege('dokumente', 'k.pdf', BYTES);
    const url = new URL(await s.signierteUrl('dokumente', 'k.pdf'), 'http://x');
    const neu = new OrdnerSpeicher(o, () => 10);
    expect(neu.pruefe('dokumente', 'k.pdf',
      Number(url.searchParams.get('ablauf')), url.searchParams.get('sig') ?? '')).toBe(true);
    expect(readdirSync(o)).toContain('.geheimnis');
    if (process.platform !== 'win32') {
      expect(statSync(join(o, '.geheimnis')).mode & 0o077).toBe(0);
    }
  });

  it('für ein Objekt, das es nicht gibt, gibt es keine Adresse', async () => {
    const s = new OrdnerSpeicher(frisch());
    await expect(s.signierteUrl('dokumente', 'fehlt.pdf')).rejects.toThrow('Objekt nicht gefunden.');
  });
});

describe('§4 die drei Schranken — in einem Deployment gibt es ihn nicht', () => {
  it('ohne CSE_SPEICHER_ORDNER: keiner', () => {
    expect(vorfuehrOrdner({ CSE_DEV_FLAECHEN: '1' })).toBeNull();
    expect(vorfuehrOrdner({ CSE_DEV_FLAECHEN: '1', CSE_SPEICHER_ORDNER: '  ' })).toBeNull();
  });
  it('im Produktionsbau ohne CSE_DEV_FLAECHEN: keiner', () => {
    expect(vorfuehrOrdner({ NODE_ENV: 'production', CSE_SPEICHER_ORDNER: '/x' })).toBeNull();
  });
  it('auf Vercel: keiner — auch mit beiden Schaltern', () => {
    expect(vorfuehrOrdner({
      NODE_ENV: 'production', CSE_DEV_FLAECHEN: '1', CSE_SPEICHER_ORDNER: '/x', VERCEL: '1',
    })).toBeNull();
  });
  it('der Vorführrechner: Produktionsbau MIT CSE_DEV_FLAECHEN und Ordner', () => {
    expect(vorfuehrOrdner({
      NODE_ENV: 'production', CSE_DEV_FLAECHEN: '1', CSE_SPEICHER_ORDNER: '/x',
    })).toBe('/x');
  });
});

describe('§5 die Wahl — der echte Speicher gewinnt immer', () => {
  it('Supabase verbunden: Supabase, auch wenn ein Ordner eingetragen ist', () => {
    const s = waehleSpeicher({
      CSE_DEV_FLAECHEN: '1', CSE_SPEICHER_ORDNER: '/x',
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k',
    });
    expect(s).toBeInstanceOf(SupabaseSpeicher);
    expect(s.verbunden).toBe(true);
  });
  it('kein Supabase, Ordner erlaubt: der Ordner', () => {
    const s = waehleSpeicher({ CSE_DEV_FLAECHEN: '1', CSE_SPEICHER_ORDNER: '/x' });
    expect(s).toBeInstanceOf(OrdnerSpeicher);
  });
  it('weder noch: Supabase, NICHT verbunden — wie bisher', () => {
    const s = waehleSpeicher({ NODE_ENV: 'production' });
    expect(s).toBeInstanceOf(SupabaseSpeicher);
    expect(s.verbunden).toBe(false);
  });
});

describe('§6 die Auslieferung prüft, was die Adresse trägt', () => {
  const PDF = new Uint8Array([...'%PDF-1.7\n'].map((c) => c.charCodeAt(0)));
  const vorher = { ...process.env };
  afterEach(() => {
    for (const k of ['CSE_SPEICHER_ORDNER', 'CSE_DEV_FLAECHEN', 'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'] as const) {
      if (vorher[k] === undefined) delete process.env[k];
      else process.env[k] = vorher[k];
    }
  });

  async function hole(url: string, bucket: string, schluessel: string[]) {
    const { NextRequest } = await import('next/server');
    const { GET } = await import('@/app/api/speicher/[bucket]/[...schluessel]/route');
    return GET(new NextRequest(new URL(url, 'http://localhost:3001')),
      { params: Promise.resolve({ bucket, schluessel }) });
  }

  it('gültige Adresse: die Bytes, der Typ aus dem Inhalt, nichts ausführbar, nichts zwischengespeichert', async () => {
    const o = frisch();
    process.env['CSE_SPEICHER_ORDNER'] = o;
    process.env['CSE_DEV_FLAECHEN'] = '1';
    delete process.env['SUPABASE_URL'];
    delete process.env['VERCEL'];
    const s = new OrdnerSpeicher(o);
    await s.lege('dokumente', 'm/a.pdf', PDF);
    const url = await s.signierteUrl('dokumente', 'm/a.pdf');
    const antwort = await hole(url, 'dokumente', ['m', 'a.pdf']);
    expect(antwort.status).toBe(200);
    expect(new Uint8Array(await antwort.arrayBuffer())).toEqual(PDF);
    expect(antwort.headers.get('content-type')).toBe('application/pdf');
    expect(antwort.headers.get('cache-control')).toBe('private, no-store');
    expect(antwort.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('eine veränderte Signatur: 403, und die Datei bleibt drin', async () => {
    const o = frisch();
    process.env['CSE_SPEICHER_ORDNER'] = o;
    process.env['CSE_DEV_FLAECHEN'] = '1';
    const s = new OrdnerSpeicher(o);
    await s.lege('dokumente', 'm/a.pdf', PDF);
    const url = (await s.signierteUrl('dokumente', 'm/a.pdf')).replace(/sig=./u, 'sig=X');
    const antwort = await hole(url, 'dokumente', ['m', 'a.pdf']);
    expect(antwort.status).toBe(403);
  });

  it('eine Adresse für ein Objekt, umgebogen auf ein anderes: 403', async () => {
    const o = frisch();
    process.env['CSE_SPEICHER_ORDNER'] = o;
    process.env['CSE_DEV_FLAECHEN'] = '1';
    const s = new OrdnerSpeicher(o);
    await s.lege('dokumente', 'm/a.pdf', PDF);
    await s.lege('dokumente', 'm/b.pdf', PDF);
    const url = (await s.signierteUrl('dokumente', 'm/a.pdf')).replace('/m/a.pdf', '/m/b.pdf');
    expect((await hole(url, 'dokumente', ['m', 'b.pdf'])).status).toBe(403);
  });

  it('kein Vorführordner aktiv — also in jedem Deployment: 404', async () => {
    delete process.env['CSE_SPEICHER_ORDNER'];
    const antwort = await hole('/api/speicher/dokumente/m/a.pdf?ablauf=9999999999&sig=x',
      'dokumente', ['m', 'a.pdf']);
    expect(antwort.status).toBe(404);
  });

  it('ein Ausbruchsversuch über die Pfadteile: 404, nicht 403', async () => {
    const o = frisch();
    process.env['CSE_SPEICHER_ORDNER'] = o;
    process.env['CSE_DEV_FLAECHEN'] = '1';
    const antwort = await hole('/api/speicher/dokumente/x?ablauf=9999999999&sig=x',
      'dokumente', ['..', '.geheimnis']);
    expect(antwort.status).toBe(404);
  });
});
