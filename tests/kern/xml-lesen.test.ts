/**
 * Der geteilte XML-Leser (`finanz/xml-lesen.ts`) — CAMT und E-Rechnung
 * lesen mit demselben. Was er zusichert:
 *
 *  1. Attribute werden gelesen — die Währung eines Betrags steht dort.
 *  2. Namensraum-Präfixe fallen, an Elementen wie an Attributen.
 *  3. DTD und Entitätsdeklarationen werden abgewiesen (XXE).
 *  4. Die fünf Entitäten und numerische Referenzen werden aufgelöst,
 *     `&amp;` zuletzt; CDATA kommt als Text an, ohne Marken zu erfinden.
 *  5. `kind`/`pfad` gehen über DIREKTE Kinder, `tief`/`alle` beliebig tief.
 */
import { describe, expect, it } from 'vitest';
import {
  XmlLeseFehler, alle, kind, kinder, leseXml, pfad, text, tief,
} from '../../src/server/services/finanz/xml-lesen.js';

describe('(1) Attribute', () => {
  it('liest das Währungsattribut eines Betrags', () => {
    const k = leseXml('<Ntry><Amt Ccy="USD">12.00</Amt></Ntry>');
    expect(tief(k, 'Amt')?.attribute['Ccy']).toBe('USD');
    expect(tief(k, 'Amt')?.text).toBe('12.00');
  });

  it('einfache und doppelte Anführungszeichen, Entitäten im Wert', () => {
    const k = leseXml(`<a x='1' y="R&amp;D" z="&#x41;"/>`);
    expect(k.attribute).toEqual({ x: '1', y: 'R&D', z: 'A' });
  });

  it('ein Präfix am Attribut fällt wie am Element; xmlns fällt ganz', () => {
    const k = leseXml('<cbc:ID xmlns:cbc="urn:x" cbc:schemeID="0204">991-1</cbc:ID>');
    expect(k.name).toBe('ID');
    expect(k.attribute).toEqual({ schemeID: '0204' });
  });
});

describe('(2) Struktur', () => {
  it('kind und pfad gehen nur über direkte Kinder, tief beliebig', () => {
    const k = leseXml('<Invoice><Party><Name>A</Name></Party><Name>B</Name></Invoice>');
    expect(text(kind(k, 'Name'))).toBe('B');
    expect(text(tief(k, 'Name'))).toBe('A');
    expect(text(pfad(k, 'Party', 'Name'))).toBe('A');
    expect(pfad(k, 'Party', 'Nichts')).toBeNull();
    expect(alle(k, 'Name').map((n) => n.text)).toEqual(['A', 'B']);
    expect(kinder(k, 'Name')).toHaveLength(1);
  });

  it('ein selbstschliessendes Element ist ein leerer Knoten', () => {
    const k = leseXml('<a><b/><c></c></a>');
    expect(k.kinder.map((c) => c.name)).toEqual(['b', 'c']);
    expect(text(kind(k, 'b'))).toBeNull();
  });

  it('eine Byte-Order-Mark und ein Prolog stören nicht', () => {
    const k = leseXml('﻿<?xml version="1.0"?><!-- x --><a>1</a>');
    expect(k.name).toBe('a');
  });
});

describe('(3) Abwehr', () => {
  it('DTD und ENTITY werden abgewiesen, nicht ignoriert', () => {
    const boese = '<!DOCTYPE a [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><a>&xxe;</a>';
    expect(() => leseXml(boese)).toThrow(XmlLeseFehler);
    expect(() => leseXml(boese)).toThrow(/DTD oder eine Entität/u);
  });

  it('eine nicht geschlossene und eine falsch geschlossene Marke', () => {
    expect(() => leseXml('<a><b></b>')).toThrow(/nicht geschlossen/u);
    expect(() => leseXml('<a><b></a>')).toThrow(/passt zu keiner offenen/u);
    expect(() => leseXml('   ')).toThrow(/kein XML/u);
  });
});

describe('(4) Text', () => {
  it('Entitäten — &amp; zuletzt', () => {
    expect(leseXml('<a>x &amp;lt; y &lt; &#8364; &#x20AC;</a>').text).toBe('x &lt; y < € €');
  });

  it('CDATA kommt als Text an und erfindet keine Marke', () => {
    const k = leseXml('<a><![CDATA[<Ntry>RE & 17 < 20</Ntry>]]></a>');
    expect(k.kinder).toHaveLength(0);
    expect(k.text).toBe('<Ntry>RE & 17 < 20</Ntry>');
  });
});
