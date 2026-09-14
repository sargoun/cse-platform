/**
 * Ein ZIP-Schreiber und -Leser ohne Kompression — fuer Pruefbuendel,
 * Z3-Paket und Jahrespaket (DOC-08, ACC-09, ACC-11).
 *
 * **Warum eigener Code und keine Bibliothek.** Ein Pruefbuendel muss
 * REPRODUZIERBAR sein: dieselben Dateien, dieselben Bytes, derselbe Hash —
 * heute und in fuenf Jahren, wenn ein Pruefer das Buendel von damals mit dem
 * von heute vergleicht. Jede ZIP-Bibliothek schreibt die Uhr in den Eintrag
 * und waehlt ihre Kompression nach Version; zwei Laeufe ergeben zwei
 * Dateien, die verschieden sind, ohne verschieden zu sein. Hier steht
 * stattdessen: Methode STORE (die Bytes liegen unveraendert im Container,
 * ein Pruefer sieht sie mit jedem Werkzeug), Zeitstempel 1980-01-01 00:00
 * (der Nullpunkt des Formats — die Uhr ist kein Bestandteil des Inhalts),
 * Eintraege in Byte-Reihenfolge ihrer Pfade.
 *
 * **Grenzen, die Fehler sind.** Kein ZIP64: mehr als 65 535 Eintraege oder
 * 4 GiB sind ein `ZipFehler`, keine stillschweigend kaputte Datei. Pfade
 * mit `..`, fuehrendem `/` oder `\` werden abgewiesen — ein Archiv, das
 * beim Entpacken ausserhalb seines Ordners schreibt, ist ein Angriff, kein
 * Buendel.
 *
 * Der Leser liest nur, was der Schreiber schreibt (STORE, kein ZIP64) und
 * prueft dabei den CRC — er ist die Gegenprobe im Test, nicht ein Entpacker
 * fuer fremde Archive.
 */

export class ZipFehler extends Error {
  constructor(nachricht: string, readonly grund: 'pfad' | 'groesse' | 'anzahl' | 'doppelt' | 'format' | 'pruefsumme') {
    super(nachricht);
    this.name = 'ZipFehler';
  }
}

export interface ZipEintrag {
  readonly pfad: string;
  readonly bytes: Uint8Array;
}

export interface ZipVerzeichnisEintrag {
  readonly pfad: string;
  readonly groesse: number;
  readonly crc32: number;
  readonly methode: number;
  /** Byte-Offset des lokalen Kopfs. */
  readonly offset: number;
}

const TABELLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), wie ZIP und PNG es fuehren. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABELLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIG_LOKAL = 0x04034b50;
const SIG_ZENTRAL = 0x02014b50;
const SIG_ENDE = 0x06054b50;
/** 1980-01-01 00:00 in DOS-Kodierung: Zeit 0, Datum (Jahr 0 << 9) | (Monat 1 << 5) | Tag 1. */
const DOS_ZEIT = 0;
const DOS_DATUM = 0x0021;
const MAX_32 = 0xffffffff;
const MAX_EINTRAEGE = 0xffff;

const kodierer = new TextEncoder();
const dekodierer = new TextDecoder('utf-8', { fatal: true });

function hatSteuerzeichen(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) < 0x20 || s.charCodeAt(i) === 0x7f) return true;
  }
  return false;
}

function pruefePfad(pfad: string): void {
  if (pfad === '' || pfad.startsWith('/') || pfad.includes('\\') || pfad.endsWith('/')) {
    throw new ZipFehler(`Unzulaessiger Pfad im Archiv: „${pfad}"`, 'pfad');
  }
  for (const teil of pfad.split('/')) {
    if (teil === '' || teil === '.' || teil === '..') {
      throw new ZipFehler(`Unzulaessiger Pfad im Archiv: „${pfad}"`, 'pfad');
    }
  }
  if (hatSteuerzeichen(pfad)) throw new ZipFehler(`Steuerzeichen im Pfad „${pfad}"`, 'pfad');
}

function vergleicheBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

export function schreibeZip(eintraege: readonly ZipEintrag[]): Uint8Array {
  if (eintraege.length > MAX_EINTRAEGE) {
    throw new ZipFehler(`${String(eintraege.length)} Eintraege — ohne ZIP64 sind hoechstens 65 535 moeglich`, 'anzahl');
  }
  const sortiert = eintraege
    .map((e) => { pruefePfad(e.pfad); return { ...e, name: kodierer.encode(e.pfad) }; })
    .sort((a, b) => vergleicheBytes(a.name, b.name));
  for (let i = 1; i < sortiert.length; i += 1) {
    if (sortiert[i]!.pfad === sortiert[i - 1]!.pfad) {
      throw new ZipFehler(`Der Pfad „${sortiert[i]!.pfad}" steht zweimal im Archiv`, 'doppelt');
    }
  }

  const teile: Uint8Array[] = [];
  const zentral: Uint8Array[] = [];
  let offset = 0;
  for (const e of sortiert) {
    if (e.bytes.length >= MAX_32 || e.name.length > 0xffff) {
      throw new ZipFehler(`„${e.pfad}" ist zu gross fuer ein ZIP ohne ZIP64`, 'groesse');
    }
    const crc = crc32(e.bytes);
    const lokal = new Uint8Array(30 + e.name.length);
    const l = new DataView(lokal.buffer);
    l.setUint32(0, SIG_LOKAL, true);
    l.setUint16(4, 20, true);          // version needed
    l.setUint16(6, 0x0800, true);      // flags: UTF-8 Namen
    l.setUint16(8, 0, true);           // Methode STORE
    l.setUint16(10, DOS_ZEIT, true);
    l.setUint16(12, DOS_DATUM, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, e.bytes.length, true);
    l.setUint32(22, e.bytes.length, true);
    l.setUint16(26, e.name.length, true);
    l.setUint16(28, 0, true);          // extra
    lokal.set(e.name, 30);
    teile.push(lokal, e.bytes);

    const z = new Uint8Array(46 + e.name.length);
    const v = new DataView(z.buffer);
    v.setUint32(0, SIG_ZENTRAL, true);
    v.setUint16(4, 20, true);          // version made by
    v.setUint16(6, 20, true);          // version needed
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, DOS_ZEIT, true);
    v.setUint16(14, DOS_DATUM, true);
    v.setUint32(16, crc, true);
    v.setUint32(20, e.bytes.length, true);
    v.setUint32(24, e.bytes.length, true);
    v.setUint16(28, e.name.length, true);
    v.setUint16(30, 0, true);          // extra
    v.setUint16(32, 0, true);          // Kommentar
    v.setUint16(34, 0, true);          // Datentraeger
    v.setUint16(36, 0, true);          // interne Attribute
    v.setUint32(38, 0, true);          // externe Attribute
    v.setUint32(42, offset, true);
    z.set(e.name, 46);
    zentral.push(z);

    offset += lokal.length + e.bytes.length;
    if (offset >= MAX_32) throw new ZipFehler('Das Archiv ueberschreitet 4 GiB — kein ZIP64', 'groesse');
  }

  const zentralGroesse = zentral.reduce((s, z) => s + z.length, 0);
  const ende = new Uint8Array(22);
  const ev = new DataView(ende.buffer);
  ev.setUint32(0, SIG_ENDE, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, sortiert.length, true);
  ev.setUint16(10, sortiert.length, true);
  ev.setUint32(12, zentralGroesse, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const gesamt = offset + zentralGroesse + ende.length;
  const aus = new Uint8Array(gesamt);
  let p = 0;
  for (const t of [...teile, ...zentral, ende]) { aus.set(t, p); p += t.length; }
  return aus;
}

/** Das Inhaltsverzeichnis — aus dem zentralen Verzeichnis, nicht aus den lokalen Koepfen. */
export function leseZipVerzeichnis(bytes: Uint8Array): readonly ZipVerzeichnisEintrag[] {
  if (bytes.length < 22) throw new ZipFehler('Kein ZIP: kuerzer als der Endekopf', 'format');
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Der Endekopf ohne Kommentar steht ganz hinten; der Schreiber schreibt keinen Kommentar.
  const endeOffset = bytes.length - 22;
  if (sicht.getUint32(endeOffset, true) !== SIG_ENDE) {
    throw new ZipFehler('Kein ZIP: Endekopf nicht gefunden (Kommentare werden nicht gelesen)', 'format');
  }
  const anzahl = sicht.getUint16(endeOffset + 10, true);
  let p = sicht.getUint32(endeOffset + 16, true);
  const eintraege: ZipVerzeichnisEintrag[] = [];
  for (let i = 0; i < anzahl; i += 1) {
    if (p + 46 > bytes.length || sicht.getUint32(p, true) !== SIG_ZENTRAL) {
      throw new ZipFehler('Zentrales Verzeichnis beschaedigt', 'format');
    }
    const methode = sicht.getUint16(p + 10, true);
    const crc = sicht.getUint32(p + 16, true);
    const groesse = sicht.getUint32(p + 24, true);
    const nameLaenge = sicht.getUint16(p + 28, true);
    const extraLaenge = sicht.getUint16(p + 30, true);
    const kommentarLaenge = sicht.getUint16(p + 32, true);
    const offset = sicht.getUint32(p + 42, true);
    const pfad = dekodierer.decode(bytes.subarray(p + 46, p + 46 + nameLaenge));
    eintraege.push({ pfad, groesse, crc32: crc, methode, offset });
    p += 46 + nameLaenge + extraLaenge + kommentarLaenge;
  }
  return eintraege;
}

/** Die Bytes eines Eintrags — nur STORE, und nur, wenn der CRC stimmt. */
export function leseZipEintrag(bytes: Uint8Array, e: ZipVerzeichnisEintrag): Uint8Array {
  if (e.methode !== 0) throw new ZipFehler(`„${e.pfad}" ist komprimiert — dieser Leser liest nur STORE`, 'format');
  const sicht = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (e.offset + 30 > bytes.length || sicht.getUint32(e.offset, true) !== SIG_LOKAL) {
    throw new ZipFehler(`Lokaler Kopf von „${e.pfad}" nicht gefunden`, 'format');
  }
  const nameLaenge = sicht.getUint16(e.offset + 26, true);
  const extraLaenge = sicht.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLaenge + extraLaenge;
  const daten = bytes.subarray(start, start + e.groesse);
  if (daten.length !== e.groesse) throw new ZipFehler(`„${e.pfad}" ist abgeschnitten`, 'format');
  if (crc32(daten) !== e.crc32) throw new ZipFehler(`CRC von „${e.pfad}" stimmt nicht`, 'pruefsumme');
  return daten;
}
