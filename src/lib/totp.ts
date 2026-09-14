import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP nach RFC 6238 — sechs Ziffern, dreissig Sekunden, HMAC-SHA1.
 *
 * **Keine Abhaengigkeit, weil es keine braucht.** Der Algorithmus ist ein
 * HMAC ueber einen Zaehler und eine Kuerzung; `node:crypto` kann beides. Ein
 * Paket dafuer waere eine weitere Lieferkette fuer dreissig Zeilen.
 *
 * **Warum in `lib` und nicht in `server/auth`.** Es ist reine Rechnung —
 * dieselbe Begruendung wie bei `lib/qr.ts`. Sie stand zuerst unter
 * `server/auth` und trug `server-only`; die Browsersuite konnte den Code fuer
 * einen Testlauf damit nicht bilden und haette ihn nachbauen muessen. Ein
 * zweiter TOTP-Rechner neben dem echten prueft den echten gerade nicht.
 *
 * **SHA1 ist hier kein Versehen.** RFC 6238 nennt SHA-256 und SHA-512 als
 * erlaubt, aber Google Authenticator, Aegis, 1Password und der Rest der Welt
 * lesen `otpauth://`-Adressen mit SHA1. Ein staerkerer Hash, den keine App
 * unterstuetzt, ist ein zweiter Faktor, den niemand einrichten kann. Die
 * Sicherheit von TOTP haengt am Geheimnis, nicht an der Hashfunktion: der
 * Angreifer sieht sechs Ziffern und hat dreissig Sekunden.
 */

/** Die Schrittweite in Sekunden. RFC 6238 §4 nennt 30 als Vorgabe. */
export const SCHRITT_SEK = 30;

/** Wie viele Schritte davor und danach noch gelten (Uhrendrift). */
export const TOLERANZ = 1;

const ZIFFERN = 6;
const BASIS32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Ein neues Geheimnis: 20 Byte, wie RFC 4226 §4 R6 verlangt. */
export function neuesGeheimnis(): string {
  return base32(randomBytes(20));
}

export function base32(bytes: Buffer): string {
  let bits = 0;
  let wert = 0;
  let aus = '';
  for (const b of bytes) {
    wert = (wert << 8) | b;
    bits += 8;
    while (bits >= 5) {
      aus += BASIS32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += BASIS32[(wert << (5 - bits)) & 31];
  return aus;
}

export function base32Zurueck(text: string): Buffer {
  let bits = 0;
  let wert = 0;
  const aus: number[] = [];
  for (const z of text.toUpperCase().replace(/[^A-Z2-7]/gu, '')) {
    const i = BASIS32.indexOf(z);
    if (i < 0) continue;
    wert = (wert << 5) | i;
    bits += 5;
    if (bits >= 8) {
      aus.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(aus);
}

/** Der Zeitschritt zu einem Zeitpunkt — die Zahl, die HMAC-Eingabe wird. */
export function schritt(zeitpunkt: Date): number {
  return Math.floor(zeitpunkt.getTime() / 1000 / SCHRITT_SEK);
}

/** Der Code fuer genau einen Schritt. */
export function codeFuer(geheimnis: string, s: number): string {
  const zaehler = Buffer.alloc(8);
  zaehler.writeBigUInt64BE(BigInt(s));
  const hmac = createHmac('sha1', base32Zurueck(geheimnis)).update(zaehler).digest();
  // Dynamic Truncation, RFC 4226 §5.4: die letzten vier Bit zeigen auf den
  // Anfang der vier Bytes, aus denen die Ziffern kommen.
  const versatz = hmac[hmac.length - 1]! & 0x0f;
  const zahl = ((hmac[versatz]! & 0x7f) << 24)
    | ((hmac[versatz + 1]! & 0xff) << 16)
    | ((hmac[versatz + 2]! & 0xff) << 8)
    | (hmac[versatz + 3]! & 0xff);
  return String(zahl % 10 ** ZIFFERN).padStart(ZIFFERN, '0');
}

/**
 * Pruefen — und den verbrauchten Schritt zurueckgeben, nicht nur ja/nein.
 *
 * Der Aufrufer muss ihn festhalten (`app.faktor_schritt_verbrauchen`), sonst
 * gilt derselbe Code innerhalb seines Fensters ein zweites Mal. Ein blosses
 * `true` liesse gar nicht erkennen, WELCHER Schritt gemeint war.
 *
 * Der Vergleich laeuft ueber `timingSafeEqual`: sechs Ziffern sind wenig
 * genug, dass ein Laufzeitunterschied je Stelle messbar waere.
 */
export function pruefe(
  geheimnis: string,
  eingabe: string,
  jetzt: Date,
  zuletzt: number | null = null,
): number | null {
  const sauber = eingabe.replace(/\D/gu, '');
  if (sauber.length !== ZIFFERN) return null;
  const jetztSchritt = schritt(jetzt);
  for (let d = -TOLERANZ; d <= TOLERANZ; d += 1) {
    const s = jetztSchritt + d;
    if (zuletzt !== null && s <= zuletzt) continue;
    const erwartet = Buffer.from(codeFuer(geheimnis, s));
    const gegeben = Buffer.from(sauber);
    if (erwartet.length === gegeben.length && timingSafeEqual(erwartet, gegeben)) return s;
  }
  return null;
}

/**
 * Die `otpauth://`-Adresse fuer den QR-Code.
 *
 * `issuer` steht zweimal drin — einmal als Praefix des Labels, einmal als
 * Parameter. Das ist nicht doppelt gemoppelt, sondern die Key-Uri-Spezifikation:
 * aeltere Apps lesen nur das Praefix, neuere nur den Parameter.
 */
export function otpauth(geheimnis: string, konto: string, herausgeber = 'CSE Gruppe'): string {
  const label = encodeURIComponent(`${herausgeber}:${konto}`);
  const p = new URLSearchParams({
    secret: geheimnis, issuer: herausgeber, algorithm: 'SHA1',
    digits: String(ZIFFERN), period: String(SCHRITT_SEK),
  });
  return `otpauth://totp/${label}?${p.toString()}`;
}

/** Ein Wiederherstellungscode: 10 Zeichen aus Base32, in zwei Gruppen. */
export function neuerWiederherstellungscode(): string {
  const roh = base32(randomBytes(7)).slice(0, 10);
  return `${roh.slice(0, 5)}-${roh.slice(5)}`;
}
