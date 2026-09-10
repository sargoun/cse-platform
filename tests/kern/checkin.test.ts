/**
 * PR 34 — die Teile des Check-in-Dienstes, die ohne Datenbank pruefbar sind.
 *
 * Die Entscheidung faellt in der Datenbank (K-09), und dort wird sie auch
 * geprueft (`tests/isolation/zeiteintrag.test.ts`). Was HIER haengt, ist die
 * Uebersetzung an der Grenze — und zwei Fehler in dieser Uebersetzung sind
 * lautlos:
 *
 *  - eine falsche Hashform: die Marke findet ihre Zeile nie, jeder Check-in
 *    wird abgelehnt, und die Antwort ist dieselbe wie bei einer echten
 *    Ablehnung;
 *  - ein doppelt kodierter Geo-Parameter: der Check-in gelingt, und der Punkt
 *    fehlt. Kein Fehler, keine Meldung, nur eine Erfassung, die nie etwas
 *    erfasst. Genau das stand hier, und der Isolationstest hat es gefunden.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  KeinBenutzerkontoFehler, KeinOffenerEintragFehler, TokenAbgelehntFehler, tokenHash,
} from '../../src/server/services/zeit/checkin.js';

const WURZEL = resolve(import.meta.dirname, '../..');

describe('der Markenhash ist die Form, die checkin_token traegt', () => {
  it('64 hexadezimale Zeichen — die Form, die `ct_hash_form` erzwingt', () => {
    expect(tokenHash('irgendeine-marke')).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('und es ist SHA-256 der Marke, nicht irgendein Digest', () => {
    // Gegen die Standardbibliothek gerechnet, nicht gegen einen abgetippten
    // Wert: ein abgetippter Wert prueft, dass sich nichts geaendert hat, nicht
    // dass es richtig ist. Die Datenbank rechnet
    // `encode(digest(token,'sha256'),'hex')` — dieselbe Zahl.
    const marke = 'aaaabbbbcccc';
    expect(tokenHash(marke)).toBe(createHash('sha256').update(marke, 'utf8').digest('hex'));
  });

  it('zwei verschiedene Marken ergeben zwei verschiedene Hashes', () => {
    expect(tokenHash('a')).not.toBe(tokenHash('b'));
  });
});

describe('jede Ablehnung sieht gleich aus (AUT-06, D-131)', () => {
  it('409 `ungueltiger_zustand`, und der Text nennt keinen Grund', () => {
    const fehler = new TokenAbgelehntFehler();
    expect(fehler.status).toBe(409);
    expect(fehler.code).toBe('ungueltiger_zustand');
    /**
     * Der Text darf nicht verraten, WARUM. „Abgelaufen", „bereits benutzt" und
     * „unbekannt" sind drei Auskuenfte, die das Durchprobieren von Marken
     * lohnend machen.
     */
    expect(fehler.message).not.toMatch(/abgelaufen|benutzt|unbekannt|widerrufen|frueh|früh/iu);
  });

  it('ein fehlendes Benutzerkonto ist KEINE Ablehnung — die Marke bleibt heil', () => {
    /**
     * Der Unterschied ist der ganze Punkt: die Datenbankfunktion WIRFT (P0003),
     * die Transaktion faellt zurueck, und die Marke ist unverbraucht. Diesen
     * Fall in `TokenAbgelehntFehler` zu schlucken hiesse, dass die erste
     * Schicht eines neuen Menschen als „Link kaputt" erscheint — nachdem der
     * Link verbrannt wurde.
     */
    const fehler = new KeinBenutzerkontoFehler();
    expect(fehler.code).toBe('kein_benutzerkonto');
    expect(fehler.code).not.toBe(new TokenAbgelehntFehler().code);
    expect(new KeinOffenerEintragFehler().name).toBe('KeinOffenerEintragFehler');
  });
});

describe('der Geo-Parameter reist als OBJEKT, nicht als Zeichenkette', () => {
  it('der Dienst reicht kein `JSON.stringify` an die jsonb-Stelle weiter', () => {
    /**
     * **Der Fehler, der diesen Test erzwungen hat.** Der Treiber serialisiert
     * selbst; eine bereits erzeugte Zeichenkette wird ein ZWEITES Mal kodiert
     * und landet als jsonb-ZEICHENKETTE statt als jsonb-Objekt. `p_geo ->>
     * 'lat'` ist dann NULL — der Check-in gelingt, und der Punkt fehlt. Kein
     * Fehler, keine Meldung.
     *
     * Geprueft wird die QUELLE und nicht das Verhalten, weil das Verhalten
     * eine Datenbank braucht: dort steht der Fall in
     * `tests/isolation/zeiteintrag.test.ts` („das Tor ist echt"). Hier haelt
     * die Prueflinie fest, dass niemand die Zeile beim naechsten Aufraeumen
     * „vereinfacht".
     */
    const quelle = readFileSync(
      join(WURZEL, 'src/server/services/zeit/checkin.ts'), 'utf8');
    const ohneKommentare = quelle.replace(/\/\*[\s\S]*?\*\//gu, ' ');
    expect(ohneKommentare).not.toMatch(/JSON\.stringify/u);
    // Und die Schluessel sind die, die `app.checkin_verbrauchen` liest.
    expect(ohneKommentare).toMatch(/genauigkeit_m/u);
  });

  it('die Marke wird nirgends im Klartext protokolliert', () => {
    const quelle = readFileSync(
      join(WURZEL, 'src/server/services/zeit/checkin.ts'), 'utf8');
    // Kein `console.*` auf diesem Pfad: eine Marke in einem Protokoll ist eine
    // veroeffentlichte Inhaberberechtigung.
    expect(quelle).not.toMatch(/console\./u);
  });
});
