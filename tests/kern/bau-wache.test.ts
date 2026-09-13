/**
 * Der Waechter vor `next dev` und `next build` — und der Ausfall, den er
 * abfaengt.
 *
 * **Was passiert ist.** Ein `next dev` lief noch, `pnpm build` lief los, und
 * beide schreiben dasselbe `.next`. Danach lieferte der Entwicklungsserver
 * `404` auf sein eigenes `layout.css`; die Seite kam auf dem Telefon an und
 * war voellig ungestaltet — Times New Roman, blaue unterstrichene Verweise,
 * Aufzaehlpunkte im Fuss. Nichts daran sah nach einem Fehler aus, und deshalb
 * hat es niemand als einen gelesen.
 *
 * **Was hier geprueft wird**, ist genau die Erkennung: antwortet auf einem der
 * Haefen ein Server DIESES Projekts, bricht der Befehl ab, bevor er etwas
 * ueberschreibt. Und der Gegenfall: auf einem stillen Hafen darf der Waechter
 * nichts melden — ein Waechter, der bei jedem Bau anschlaegt, wird nach dem
 * dritten Mal mit `CSE_BAU_OHNE_WACHE` stillgelegt und ist dann keiner mehr.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cseServerAufHafen, meldung } from '../../scripts/bau-wache.js';

const WURZEL = resolve(import.meta.dirname, '../..');
const WACHE = resolve(WURZEL, 'scripts/bau-wache.ts');

let server: Server | null = null;
afterEach(async () => {
  if (server !== null) {
    await new Promise<void>((fertig) => { server?.close(() => { fertig(); }); });
    server = null;
  }
});

/** Ein Server, der auf `/healthz` antwortet wie dieses Projekt — oder anders. */
async function starteServer(antwort: string, status = 200): Promise<number> {
  server = createServer((anfrage, ausgabe) => {
    if (anfrage.url === '/healthz') {
      ausgabe.writeHead(status, { 'content-type': 'application/json' });
      ausgabe.end(antwort);
      return;
    }
    ausgabe.writeHead(404).end();
  });
  await new Promise<void>((fertig) => { server?.listen(0, '127.0.0.1', () => { fertig(); }); });
  const adresse = server.address();
  if (adresse === null || typeof adresse === 'string') throw new Error('kein Hafen');
  return adresse.port;
}

/**
 * Der Waechter als Befehl, mit `PORT` auf den Prüfhafen gebogen.
 *
 * **`execFile` und nicht `execFileSync`** — und das ist keine Stilfrage: der
 * Prüfserver lebt in DIESEM Prozess. Ein synchroner Aufruf blockiert die
 * Ereignisschleife, der Server kommt nie dazu zu antworten, der Waechter
 * laeuft in seine Frist und meldet „nichts da". Der Test war damit gruen zu
 * bekommen, indem man das Gegenteil dessen behauptet, was er prueft.
 */
async function wacheMit(
  umgebung: Record<string, string>,
): Promise<{ code: number; ausgabe: string }> {
  const tsx = resolve(WURZEL, 'node_modules/.bin/tsx');
  return new Promise((fertig) => {
    execFile(tsx, [WACHE, 'bau'], {
      cwd: WURZEL, encoding: 'utf8', env: { ...process.env, ...umgebung },
    }, (fehler, ausgabe, fehlerausgabe) => {
      const code = fehler === null ? 0 : ((fehler as { code?: number }).code ?? 1);
      fertig({ code, ausgabe: `${ausgabe}${fehlerausgabe}` });
    });
  });
}

describe('der Waechter vor dev und build', () => {
  it('erkennt einen laufenden Server dieses Projekts', async () => {
    const hafen = await starteServer('{"status":"ok","build_id":"lokal","region":"fra1"}');
    await expect(cseServerAufHafen(hafen)).resolves.toBe(true);
  });

  it('haelt einen FREMDEN Dienst auf demselben Hafen nicht fuer unseren', async () => {
    const hafen = await starteServer('{"ok":true}');
    await expect(cseServerAufHafen(hafen)).resolves.toBe(false);
  });

  it('haelt einen Hafen mit Fehlerantwort nicht fuer unseren', async () => {
    const hafen = await starteServer('{"status":"ok"}', 503);
    await expect(cseServerAufHafen(hafen)).resolves.toBe(false);
  });

  it('meldet einen stillen Hafen nicht', async () => {
    // Einen Hafen oeffnen und sofort wieder schliessen: die Nummer ist dann
    // mit hoher Wahrscheinlichkeit frei, und der Waechter darf dort nichts
    // finden. `expect(false)` waere sonst gruen, ohne je verbunden zu haben.
    const hafen = await starteServer('{"status":"ok"}');
    await new Promise<void>((fertig) => { server?.close(() => { fertig(); }); });
    server = null;
    await expect(cseServerAufHafen(hafen, 300)).resolves.toBe(false);
  });

  it('DER Fall: der Befehl bricht ab, statt `.next` zu ueberschreiben', async () => {
    const hafen = await starteServer('{"status":"ok","build_id":"lokal","region":"fra1"}');
    const { code, ausgabe } = await wacheMit({ PORT: String(hafen) });
    expect(code).toBe(1);
    expect(ausgabe).toContain(`Auf Hafen ${hafen} laeuft bereits ein Server`);
    expect(ausgabe).toContain('ohne CSS');
    // Der Weg nach draussen steht in der Meldung, nicht in einem Wiki.
    expect(ausgabe).toContain('Get-NetTCPConnection');
  });

  it('laesst den Bau durch, wenn kein Server antwortet', async () => {
    /*
     * `PORT` auf einen Hafen, auf dem nichts laeuft — und die Vorgabehaefen
     * 3000/3001 sind auf einem Prüfrechner ebenfalls still. Faende der
     * Waechter hier etwas, waere er ein Fehlalarm.
     */
    const { code } = await wacheMit({ PORT: '59999' });
    expect(code).toBe(0);
  });

  it('der Notausgang laesst durch — und nur er', async () => {
    const hafen = await starteServer('{"status":"ok"}');
    expect((await wacheMit({ PORT: String(hafen) })).code).toBe(1);
    expect((await wacheMit({ PORT: String(hafen), CSE_BAU_OHNE_WACHE: '1' })).code).toBe(0);
  });

  it('die Meldung nennt den Hafen und beide Betriebssysteme', () => {
    const text = meldung('dev', 3001);
    expect(text).toContain('Hafen 3001');
    expect(text).toContain('Get-NetTCPConnection -LocalPort 3001');
    expect(text).toContain('kill $(lsof -t -i :3001)');
  });
});
