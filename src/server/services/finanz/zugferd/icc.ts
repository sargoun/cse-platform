/**
 * Ein sRGB-ICC-Profil, hier erzeugt statt mitgeliefert (FIN-12, PR 53).
 *
 * **Warum nicht einfach eine `.icc`-Datei ins Repository legen.** PDF/A-3
 * verlangt einen OutputIntent mit eingebettetem Farbprofil — das Profil
 * landet also in JEDER Rechnung, die das Haus verlässt. Die verbreiteten
 * fertigen Profile stehen unter Lizenzen, die das mitregeln wollen (eines
 * unter CC BY-SA, mehrere ohne auffindbaren Lizenztext). Eine
 * Share-Alike-Bedingung an einer Kundenrechnung ist eine Verpflichtung, die
 * niemand eingehen wollte und die niemandem auffällt, bis sie jemandem
 * auffällt.
 *
 * **Was hier steht, ist keine Abschrift, sondern eine Rechnung.** Die Zahlen
 * sind die veröffentlichten Festlegungen aus IEC 61966-2-1 (sRGB) und
 * ISO 15076-1 (ICC.1): die auf D50 adaptierten Primärvalenzen, der
 * Bradford-Adaptionsvektor und die sRGB-Übertragungsfunktion. Aus ihnen
 * entsteht ein vollständiges, gültiges v2-Matrix/TRC-Profil — reproduzierbar,
 * prüfbar und ohne fremde Datei.
 *
 * **Geprüft wird es zweimal.** `tests/kern/icc.test.ts` liest den Kopf und
 * die Tabelle zurück; veraPDF prüft in CI das fertige PDF, in dem es steckt.
 * Ein Profil, das nur „aussieht wie eines", fällt spätestens dort auf — und
 * nicht beim Empfänger.
 */

/** Ein Zeichen-Tag (`acsp`, `mntr`, `rXYZ` …) als vier Bytes. */
function sig(text: string): Uint8Array {
  if (text.length !== 4) throw new Error(`ICC-Signatur muss vier Zeichen haben: ${text}`);
  return new Uint8Array([...text].map((z) => z.charCodeAt(0)));
}

function u32(wert: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, wert >>> 0, false);
  return b;
}

function u16(wert: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, wert & 0xffff, false);
  return b;
}

/**
 * `s15Fixed16Number` — 1.0 ist 0x00010000.
 *
 * Gerundet und nicht abgeschnitten: ein abgeschnittener Wert verschiebt die
 * Primärvalenz um bis zu 1/65536 nach unten, und drei solche Verschiebungen
 * ergeben ein Weiss, das nicht mehr D50 ist.
 */
function s15f16(wert: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, Math.round(wert * 65536), false);
  return b;
}

function verbinde(...teile: readonly Uint8Array[]): Uint8Array {
  const laenge = teile.reduce((s, t) => s + t.length, 0);
  const aus = new Uint8Array(laenge);
  let i = 0;
  for (const t of teile) { aus.set(t, i); i += t.length; }
  return aus;
}

/** Auf ein Vielfaches von vier auffüllen — ICC verlangt ausgerichtete Tags. */
function auffuellen(daten: Uint8Array): Uint8Array {
  const rest = daten.length % 4;
  return rest === 0 ? daten : verbinde(daten, new Uint8Array(4 - rest));
}

/**
 * Die sRGB-Übertragungsfunktion (IEC 61966-2-1) — Kodierung nach linear.
 *
 * Der lineare Fuss unterhalb von 0,04045 ist kein Detail: eine reine
 * Gammakurve 2,2 weicht dort um mehrere Prozent ab, und genau dort liegen
 * die dunklen Flächen einer Rechnung auf weissem Grund.
 */
function sRgbNachLinear(wert: number): number {
  return wert <= 0.04045 ? wert / 12.92 : ((wert + 0.055) / 1.055) ** 2.4;
}

/** `curveType` mit 1024 Stützstellen — dieselbe Kurve für R, G und B. */
function trcTag(): Uint8Array {
  const punkte = 1024;
  const werte = new Uint8Array(punkte * 2);
  const sicht = new DataView(werte.buffer);
  for (let i = 0; i < punkte; i += 1) {
    const linear = sRgbNachLinear(i / (punkte - 1));
    sicht.setUint16(i * 2, Math.round(linear * 65535), false);
  }
  return verbinde(sig('curv'), u32(0), u32(punkte), werte);
}

/** `XYZType` — ein Tristimuluswert. */
function xyzTag(x: number, y: number, z: number): Uint8Array {
  return verbinde(sig('XYZ '), u32(0), s15f16(x), s15f16(y), s15f16(z));
}

/**
 * `textDescriptionType` — in ICC v2 Pflicht für `desc`, und eigenwillig
 * gebaut: ASCII mit Länge INKLUSIVE Nullbyte, danach zwei leere Blöcke für
 * Unicode und ScriptCode, die trotzdem dastehen müssen.
 */
function descTag(text: string): Uint8Array {
  const ascii = new Uint8Array([...text].map((z) => z.charCodeAt(0) & 0x7f));
  return verbinde(
    sig('desc'), u32(0),
    u32(ascii.length + 1), ascii, new Uint8Array(1),
    u32(0), u32(0),                    // Unicode: Sprachcode und Länge
    u16(0), new Uint8Array(1),         // ScriptCode: Code und Länge
    new Uint8Array(67),                // ScriptCode: 67 Bytes Rest, immer da
  );
}

function textTag(text: string): Uint8Array {
  const ascii = new Uint8Array([...text].map((z) => z.charCodeAt(0) & 0x7f));
  return verbinde(sig('text'), u32(0), ascii, new Uint8Array(1));
}

/** `s15Fixed16ArrayType` — die Bradford-Matrix der Adaption auf D50. */
function chadTag(werte: readonly number[]): Uint8Array {
  return verbinde(sig('sf32'), u32(0), ...werte.map((w) => s15f16(w)));
}

export const PROFIL_BESCHREIBUNG = 'sRGB IEC61966-2.1 (CSE, erzeugt)';

/**
 * Das fertige Profil.
 *
 * @param erzeugtAm Der Zeitstempel im Kopf — HEREINGEREICHT, nicht aus der
 *   Uhr gelesen. Ein Profil, das sich bei jedem Aufruf ändert, macht jede
 *   erzeugte Rechnung bytemässig einmalig, und damit lässt sich nicht mehr
 *   zeigen, dass zweimal dasselbe herauskam (K-11, Invariante 5).
 */
export function sRgbProfil(erzeugtAm: Date = new Date(Date.UTC(2026, 0, 1))): Uint8Array {
  /*
   * Die auf D50 adaptierten sRGB-Primärvalenzen und das Weiss — die Werte,
   * die ISO 15076-1 für ein v2-Matrix/TRC-Profil vorsieht.
   */
  const tags: readonly (readonly [string, Uint8Array])[] = [
    ['desc', descTag(PROFIL_BESCHREIBUNG)],
    ['wtpt', xyzTag(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyzTag(0.4360, 0.2225, 0.0139)],
    ['gXYZ', xyzTag(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyzTag(0.1431, 0.0606, 0.7141)],
    ['rTRC', trcTag()],
    ['gTRC', trcTag()],
    ['bTRC', trcTag()],
    ['chad', chadTag([
      1.0478, 0.0229, -0.0502,
      0.0295, 0.9905, -0.0171,
      -0.0092, 0.0150, 0.7521,
    ])],
    ['cprt', textTag('Public Domain — erzeugt aus IEC 61966-2-1')],
  ];

  const kopfLaenge = 128;
  const tabellenLaenge = 4 + tags.length * 12;
  let versatz = kopfLaenge + tabellenLaenge;
  const eintraege: Uint8Array[] = [];
  const bloecke: Uint8Array[] = [];
  /**
   * **Gleiche Daten stehen EINMAL da.**
   *
   * Die drei Tonwertkurven sind Byte für Byte dieselbe; ICC erlaubt
   * ausdrücklich, dass mehrere Tabelleneinträge auf denselben Versatz
   * zeigen, und jedes reale sRGB-Profil macht es so. Drei Kopien wären
   * 6 KB in JEDER erzeugten Rechnung — und drei Stellen, an denen sie
   * auseinanderlaufen könnten.
   */
  const schonDa = new Map<string, { versatz: number; laenge: number }>();
  for (const [name, daten] of tags) {
    const schluessel = Buffer.from(daten).toString('base64');
    const bekannt = schonDa.get(schluessel);
    if (bekannt !== undefined) {
      eintraege.push(verbinde(sig(name), u32(bekannt.versatz), u32(bekannt.laenge)));
      continue;
    }
    const gefuellt = auffuellen(daten);
    eintraege.push(verbinde(sig(name), u32(versatz), u32(daten.length)));
    schonDa.set(schluessel, { versatz, laenge: daten.length });
    bloecke.push(gefuellt);
    versatz += gefuellt.length;
  }

  const gesamt = versatz;
  const kopf = verbinde(
    u32(gesamt),                       // 0   Größe
    new Uint8Array(4),                 // 4   CMM: keines
    u32(0x0210_0000),                  // 8   Version 2.1
    sig('mntr'),                       // 12  Geräteklasse
    sig('RGB '),                       // 16  Datenfarbraum
    sig('XYZ '),                       // 20  Verbindungsfarbraum
    u16(erzeugtAm.getUTCFullYear()), u16(erzeugtAm.getUTCMonth() + 1),
    u16(erzeugtAm.getUTCDate()), u16(erzeugtAm.getUTCHours()),
    u16(erzeugtAm.getUTCMinutes()), u16(erzeugtAm.getUTCSeconds()),
    sig('acsp'),                       // 36  Dateikennung
    new Uint8Array(4),                 // 40  Plattform: keine
    u32(0),                            // 44  Merkmale
    new Uint8Array(4),                 // 48  Hersteller
    new Uint8Array(4),                 // 52  Modell
    new Uint8Array(8),                 // 56  Geräteattribute
    u32(0),                            // 64  Wiedergabeabsicht: perzeptiv
    s15f16(0.9642), s15f16(1.0), s15f16(0.8249),  // 68 PCS-Lichtart D50
    new Uint8Array(4),                 // 80  Ersteller
    new Uint8Array(16),                // 84  Profilkennung (MD5): keine
    new Uint8Array(28),                // 100 Reserve
  );
  if (kopf.length !== kopfLaenge) {
    throw new Error(`ICC-Kopf ist ${String(kopf.length)} Bytes statt 128.`);
  }

  return verbinde(kopf, u32(tags.length), ...eintraege, ...bloecke);
}
