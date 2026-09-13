/**
 * IBAN und BIC — Gestalt und Pruefziffer (ISO 13616, Modulo 97-10 nach
 * ISO 7064). `05-FINANZEN.md` §3.2.
 *
 * **Warum das hier steht und nicht in einem CHECK.** Die Datenbank prueft die
 * GESTALT — zwei Buchstaben, zwei Ziffern, danach alphanumerisch. Die
 * Pruefziffer rechnet diese Datei, und ein Test rechnet daneben. Ein CHECK mit
 * Modulo-Arithmetik ueber `text` waere nicht lesbar, nicht einzeln testbar,
 * und die naechste Laendervorgabe waere eine Migration statt einer Zeile.
 *
 * **Was eine gueltige Pruefziffer NICHT sagt.** Sie sagt, dass niemand sich
 * vertippt hat. Sie sagt nicht, dass es das Konto gibt, dass es dem
 * angegebenen Inhaber gehoert oder dass die Bank Ueberweisungen annimmt — das
 * sagt nur die Bank, und mit ihr spricht diese Plattform nicht (keine
 * erfundenen Integrationen). Deshalb heisst die Funktion `istIbanGueltig` und
 * nicht `existiert`.
 */

export class IbanFehler extends Error {
  constructor(nachricht: string, readonly grund: 'gestalt' | 'pruefziffer') {
    super(nachricht);
    this.name = 'IbanFehler';
  }
}

const GESTALT = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/u;
const BIC_GESTALT = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/u;

/**
 * Grossbuchstaben, keine Leerzeichen, keine Bindestriche.
 *
 * Ohne diesen Schritt stuenden `DE02 1203 …`, `de021203…` und `DE02-1203-…`
 * als drei Konten nebeneinander, der Eindeutigkeitsindex griffe bei keinem,
 * und der Bankimport (PR 61) faende zu einem Auszug kein Konto.
 */
export function normalisiereIban(eingabe: string): string {
  return eingabe.replace(/[\s-]/gu, '').toUpperCase();
}

/** Buchstabe → Zahl: `A` = 10 … `Z` = 35 (ISO 13616). */
function alsZiffern(text: string): string {
  let ergebnis = '';
  for (const zeichen of text) {
    const code = zeichen.codePointAt(0)!;
    ergebnis += code >= 65 && code <= 90 ? String(code - 55) : zeichen;
  }
  return ergebnis;
}

/**
 * Modulo 97 stueckweise — nie ueber ein `Number`.
 *
 * Eine IBAN wird bis zu 34 Zeichen lang und ergibt als Zahl bis zu 68
 * Stellen. `Number` traegt 15; die Rechnung waere still falsch, und zwar bei
 * genau den langen IBANs, die im Alltag selten sind und im Ernstfall zaehlen.
 * Stueckweise gerechnet bleibt jeder Zwischenwert unter 10^9.
 */
function modulo97(ziffern: string): number {
  let rest = 0;
  for (const ziffer of ziffern) {
    rest = (rest * 10 + Number(ziffer)) % 97;
  }
  return rest;
}

export function istIbanGueltig(eingabe: string): boolean {
  const iban = normalisiereIban(eingabe);
  if (!GESTALT.test(iban)) return false;
  return modulo97(alsZiffern(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** Normalisiert und wirft, statt eine falsche IBAN durchzulassen. */
export function ibanGeprueft(eingabe: string): string {
  const iban = normalisiereIban(eingabe);
  if (!GESTALT.test(iban)) {
    throw new IbanFehler(
      'Die IBAN hat nicht die Gestalt zweier Buchstaben, zweier Ziffern und '
      + 'mindestens elf weiterer Zeichen.', 'gestalt');
  }
  if (!istIbanGueltig(iban)) {
    throw new IbanFehler(
      'Die Pruefziffer der IBAN stimmt nicht — vermutlich ein Zahlendreher.',
      'pruefziffer');
  }
  return iban;
}

export function istBicGueltig(eingabe: string): boolean {
  return BIC_GESTALT.test(eingabe.replace(/\s/gu, '').toUpperCase());
}

/** `DE02120300000000202051` → `DE02 1203 0000 0000 2020 51` (nur Anzeige). */
export function formatiereIban(iban: string): string {
  return (normalisiereIban(iban).match(/.{1,4}/gu) ?? []).join(' ');
}
