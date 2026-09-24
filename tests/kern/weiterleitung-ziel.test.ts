/**
 * Das Rueckkehrziel nach dem Raumbuch-Import — und warum `new URL` allein
 * eine offene Weiterleitung ist.
 *
 * `new URL(wert, basis)` ignoriert die Basis, sobald `wert` ABSOLUT ist:
 * `new URL('https://boese.example', 'https://cse.example')` ergibt
 * `https://boese.example`. Das Feld `zurueck` kommt aus dem Formular, also vom
 * Aufrufer. Ein praeparierter POST schickte den angemeldeten Benutzer nach dem
 * Import auf eine fremde Seite — und der Weg dorthin begann sichtbar im
 * eigenen Portal, was genau die Gutglaeubigkeit ist, auf die es ankommt.
 */
import { describe, expect, it } from 'vitest';
import { internesZiel } from '@/server/auth/ursprung';
import type { NextRequest } from 'next/server';

function anfrageMit(origin: string, weitergeleitet?: string): NextRequest {
  const u = new URL(origin);
  const koepfe = new Map<string, string>();
  if (weitergeleitet !== undefined) koepfe.set('x-forwarded-proto', weitergeleitet);
  return {
    headers: { get: (n: string) => koepfe.get(n.toLowerCase()) ?? null },
    nextUrl: { origin, host: u.host, protocol: u.protocol },
  } as unknown as NextRequest;
}

const anfrage = anfrageMit('https://cse.example');
const STANDARD = '/portal/reinigung/objekte';

describe('internesZiel', () => {
  it('nimmt einen internen Pfad', () => {
    expect(internesZiel('/portal/reinigung/objekte/7', STANDARD, anfrage).toString())
      .toBe('https://cse.example/portal/reinigung/objekte/7');
  });

  it('behaelt Abfrage und Anker', () => {
    expect(internesZiel('/portal/x?a=1#b', STANDARD, anfrage).toString())
      .toBe('https://cse.example/portal/x?a=1#b');
  });

  it('weist eine fremde absolute URL ab — der Kern des Befundes', () => {
    expect(internesZiel('https://boese.example/phish', STANDARD, anfrage).toString())
      .toBe(`https://cse.example${STANDARD}`);
  });

  it('weist auch ein schemaloses //host ab', () => {
    // `//boese.example` erbt das Schema und ist trotzdem ein fremder Ursprung.
    expect(internesZiel('//boese.example/phish', STANDARD, anfrage).toString())
      .toBe(`https://cse.example${STANDARD}`);
  });

  it('weist ein fremdes Schema auf demselben Namen ab', () => {
    expect(internesZiel('http://cse.example/portal', STANDARD, anfrage).toString())
      .toBe(`https://cse.example${STANDARD}`);
  });

  it('faellt bei leer, null und unlesbar auf das Standardziel zurueck', () => {
    for (const wert of ['', null, undefined, 'http://['] as const) {
      expect(internesZiel(wert, STANDARD, anfrage).toString())
        .toBe(`https://cse.example${STANDARD}`);
    }
  });

  /**
   * **Ein Pfad, den erst die Normalisierung zu `//host` macht** (V-159, D-653).
   *
   * `/.//boese.example` IST ein Pfad dieser Anwendung — die erste Pruefung
   * sieht den eigenen Ursprung. `new URL` normalisiert ihn aber zu
   * `//boese.example`, und das zweite Einlesen (`new URL(pfad, basis)`) las
   * daraus eine schemalose Adresse: die Umleitung ging nach
   * `https://boese.example/`. Jede dieser Formen zeigte vorher nach draussen.
   */
  it('weist Pfade ab, die erst nach dem Normalisieren mit // beginnen', () => {
    for (const wert of [
      '/.//boese.example', '/portal/..//boese.example', '/%2e//boese.example',
      '/%2E%2E//boese.example', '/./\\boese.example', '/.\\/boese.example',
      '/.///boese.example', '/a/../..//boese.example/x?y=1#z',
    ]) {
      expect(internesZiel(wert, STANDARD, anfrage).toString(), wert)
        .toBe(`https://cse.example${STANDARD}`);
    }
  });

  it('ein kodierter Schraegstrich bleibt ein Pfad im eigenen Ursprung', () => {
    // `%2f` wird nicht aufgeloest — der Pfad heisst woertlich so und bleibt hier.
    expect(internesZiel('/./%2fboese.example', STANDARD, anfrage).toString())
      .toBe('https://cse.example/%2fboese.example');
  });

  it('behaelt einen ordentlich normalisierten Pfad', () => {
    expect(internesZiel('/portal/a/../b/./c?x=1', STANDARD, anfrage).toString())
      .toBe('https://cse.example/portal/b/c?x=1');
  });
});

/**
 * Hinter einem TLS-beendenden Proxy sieht die Anwendung `http`. Nahm
 * `internesZiel` `nextUrl.origin` als Basis, zeigte jeder interne Redirect
 * anschliessend auf `http://…` — ein Downgrade auf dem Rueckweg aus dem
 * Portal, ausgeloest von der Funktion, die Ziele absichern soll.
 */
describe('internesZiel hinter einem Proxy', () => {
  it('baut das Ziel mit dem Schema aus x-forwarded-proto', () => {
    const a = anfrageMit('http://cse.example', 'https');
    expect(internesZiel('/portal/x', STANDARD, a).toString())
      .toBe('https://cse.example/portal/x');
  });

  it('und das Standardziel ebenso', () => {
    const a = anfrageMit('http://cse.example', 'https');
    expect(internesZiel(null, STANDARD, a).toString())
      .toBe(`https://cse.example${STANDARD}`);
  });

  /**
   * **Der RUECKFALL wird genauso geprueft wie das Ziel.**
   *
   * Zwei Aufrufer reichten `zurueck` in BEIDE Argumente — und hoben die
   * Pruefung damit auf: ein absolutes `https://boese.example` fiel als Ziel
   * durch und kam als Rueckfall unveraendert zurueck. Nach einem gueltigen
   * POST aus dem eigenen Portal ging die Umleitung nach draussen. Gemeldet hat
   * das die Copilot-Runde auf PR 16.
   *
   * Die Aufrufer sind korrigiert; dieser Fall haelt fest, dass die FUNKTION
   * auch dann schuetzt, wenn der naechste Aufrufer denselben Fehler macht.
   */
  it('ein fremder RUECKFALL landet auf `/`, nicht draussen', () => {
    expect(internesZiel('https://boese.example/phish', 'https://boese.example/phish', anfrage)
      .toString()).toBe('https://cse.example/');
  });

  it('auch wenn nur der Rueckfall fremd ist und `zurueck` fehlt', () => {
    expect(internesZiel(null, 'https://boese.example/', anfrage).toString())
      .toBe('https://cse.example/');
    expect(internesZiel('', '//boese.example/pfad', anfrage).toString())
      .toBe('https://cse.example/');
  });

  /**
   * `//host` ist protokollrelativ und damit ABSOLUT — `new URL('//boese.example',
   * 'https://cse.example')` ergibt `https://boese.example`. Die Form sieht aus
   * wie ein Pfad und ist keiner; genau deshalb steht sie hier.
   */
  it('ein protokollrelatives Ziel ist kein interner Pfad', () => {
    expect(internesZiel('//boese.example/phish', STANDARD, anfrage).toString())
      .toBe(`https://cse.example${STANDARD}`);
  });
});
