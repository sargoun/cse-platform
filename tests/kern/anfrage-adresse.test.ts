/**
 * Die Adresse einer Anfrage fuer das Pruefprotokoll (SEC-A9, V-163, D-657).
 *
 * Sie landet ueber `app.ip` in JEDER Protokollzeile einer angemeldeten
 * Sitzung. Was hier durchrutscht, steht zehn Jahre im Protokoll — oder, vor
 * 0415, brach es die Transaktion ab. Deshalb: nur eine echte Adresse, sonst
 * `null`.
 */
import { describe, expect, it } from 'vitest';
import { anfrageAdresse } from '../../src/server/auth/adresse.js';

const kopf = (werte: Record<string, string>) => new Headers(werte);

describe('anfrageAdresse', () => {
  it('nimmt den ERSTEN Eintrag aus x-forwarded-for — das Geraet, nicht den Proxy', () => {
    expect(anfrageAdresse(kopf({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' })))
      .toBe('203.0.113.7');
  });

  it('versteht IPv6', () => {
    expect(anfrageAdresse(kopf({ 'x-forwarded-for': '2001:db8::17' }))).toBe('2001:db8::17');
  });

  it('faellt auf x-real-ip zurueck, wenn kein x-forwarded-for da ist', () => {
    expect(anfrageAdresse(kopf({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(anfrageAdresse(kopf({ 'x-forwarded-for': '', 'x-real-ip': '198.51.100.4' })))
      .toBe('198.51.100.4');
  });

  it('was keine Adresse ist, wird null — keine erfundene Herkunft', () => {
    expect(anfrageAdresse(kopf({}))).toBeNull();
    expect(anfrageAdresse(kopf({ 'x-forwarded-for': 'unbekannt' }))).toBeNull();
    expect(anfrageAdresse(kopf({ 'x-forwarded-for': ':::' }))).toBeNull();
    expect(anfrageAdresse(kopf({ 'x-forwarded-for': "1.2.3.4'; drop table audit_log" })))
      .toBeNull();
    expect(anfrageAdresse(kopf({ 'x-real-ip': '999.1.1.1' }))).toBeNull();
  });
});
