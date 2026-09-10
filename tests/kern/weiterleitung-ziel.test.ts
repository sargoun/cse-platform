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

const anfrage = { nextUrl: { origin: 'https://cse.example' } } as unknown as NextRequest;
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
});
