import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { BUCKETS, SIGNATUR_SEKUNDEN, type Bucket, type Speicher } from './adapter.js';

/**
 * **Der Vorführspeicher: ein Ordner auf dem Rechner, auf dem die Plattform
 * läuft** (V-131, D-623).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Warum es ihn gibt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ohne `SUPABASE_URL` lehnt `SupabaseSpeicher` jede Ablage ab — richtig so,
 * er täuscht nichts vor. Auf einem Vorführrechner hiess das aber: jeder
 * Beleg, jedes Baustellenfoto, jede Unterlage, jedes Logo endete bei „nicht
 * verbunden". Die halbe Plattform liess sich zeigen, die andere Hälfte nur
 * beschreiben.
 *
 * Dieser Speicher ist KEIN Vortäuschen: die Datei liegt danach wirklich auf
 * der Platte, sie lässt sich wirklich abrufen, und sie ist nach einem
 * Neustart noch da. Er erfüllt denselben Vertrag wie der echte — und er sagt
 * überall, was er ist (Einstellungen › Integrationen: „Entwicklung").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die drei Schranken, die ihn aus jedem Deployment heraushalten.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  1. `CSE_SPEICHER_ORDNER` muss gesetzt sein — ausdrücklich, mit einem Pfad.
 *  2. `devFlaechenAn()` muss gelten — dieselbe Schranke wie beim
 *     Entwicklungs-SMS-Dienst und der Entwicklungssitzung.
 *  3. Auf Vercel (`VERCEL` gesetzt) gibt es ihn nie. Das Dateisystem einer
 *     Serverless-Funktion ist flüchtig, und die Daten gehörten dann in eine
 *     Region, die niemand gewählt hat (CLAUDE.md, Datenresidenz).
 *
 * Ist Supabase verbunden, gewinnt Supabase — immer (`waehleSpeicher`).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Signierte Adressen auch hier** (DOC-03, SEC-A6).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Ordner liegt nicht unter `public/`, und keine Route liefert ihn frei
 * aus. `signierteUrl` gibt eine Adresse unter `/api/speicher/…` mit Ablauf
 * und HMAC zurück; die Route prüft beides und liefert erst dann. Das
 * Geheimnis liegt im Ordner selbst (`.geheimnis`, einmal zufällig erzeugt):
 * es übersteht einen Neustart, und es verlässt den Rechner nicht.
 */

const TRENNER = '\u001e';
const GEHEIMNIS_DATEI = '.geheimnis';

/** Schlüssel, wie die Plattform sie bildet: Pfadteile aus Buchstaben, Ziffern, `._-`. */
const SCHLUESSEL = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u;

export class OrdnerSchluesselFehler extends Error {
  constructor() {
    super('Unzulässiger Speicherschlüssel.');
    this.name = 'OrdnerSchluesselFehler';
  }
}

export class OrdnerSpeicher implements Speicher {
  readonly verbunden = true;
  private readonly wurzel: string;
  private geheimnisPuffer: Buffer | null = null;

  constructor(
    wurzel: string,
    private readonly jetzt: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.wurzel = resolve(wurzel);
  }

  /** Der Ort einer Datei — oder ein Fehler, wenn der Schlüssel aus dem Ordner führt. */
  ort(bucket: Bucket, schluessel: string): string {
    if (!BUCKETS.includes(bucket) || !SCHLUESSEL.test(schluessel)
      || schluessel.split('/').some((t) => t === '.' || t === '..')) {
      throw new OrdnerSchluesselFehler();
    }
    const basis = join(this.wurzel, bucket);
    const ziel = resolve(basis, schluessel);
    if (!ziel.startsWith(basis + sep)) throw new OrdnerSchluesselFehler();
    return ziel;
  }

  private geheimnis(): Buffer {
    if (this.geheimnisPuffer !== null) return this.geheimnisPuffer;
    const datei = join(this.wurzel, GEHEIMNIS_DATEI);
    try {
      this.geheimnisPuffer = readFileSync(datei);
    } catch {
      mkdirSync(this.wurzel, { recursive: true });
      /* `wx`: legt zwei Prozesse gleichzeitig an, gewinnt einer, der andere liest. */
      try {
        writeFileSync(datei, randomBytes(32), { flag: 'wx', mode: 0o600 });
      } catch { /* schon da — gelesen wird unten */ }
      this.geheimnisPuffer = readFileSync(datei);
    }
    return this.geheimnisPuffer;
  }

  private signatur(bucket: Bucket, schluessel: string, ablauf: number): string {
    return createHmac('sha256', this.geheimnis())
      .update([bucket, schluessel, String(ablauf)].join(TRENNER))
      .digest('base64url');
  }

  async lege(bucket: Bucket, schluessel: string, daten: Uint8Array): Promise<void> {
    const ziel = this.ort(bucket, schluessel);
    await mkdir(dirname(ziel), { recursive: true });
    await writeFile(ziel, daten);
  }

  async hole(bucket: Bucket, schluessel: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.ort(bucket, schluessel)));
    } catch (fehler: unknown) {
      if (fehler instanceof OrdnerSchluesselFehler) throw fehler;
      throw new Error('Objekt nicht gefunden.');
    }
  }

  async entferne(bucket: Bucket, schluessel: string): Promise<void> {
    await rm(this.ort(bucket, schluessel), { force: true });
  }

  /**
   * Eine RELATIVE Adresse — der Speicher kennt den Ursprung der Anfrage nicht,
   * und ein fest eingetragenes `localhost` bräche jedes Telefon im WLAN. Wer
   * weiterleitet, löst sie gegen den eigenen Ursprung auf (`new URL(url, …)`).
   */
  async signierteUrl(
    bucket: Bucket, schluessel: string, sekunden = SIGNATUR_SEKUNDEN,
  ): Promise<string> {
    await stat(this.ort(bucket, schluessel)).catch(() => {
      throw new Error('Objekt nicht gefunden.');
    });
    const ablauf = this.jetzt() + sekunden;
    const sig = this.signatur(bucket, schluessel, ablauf);
    return `/api/speicher/${bucket}/${schluessel}?ablauf=${String(ablauf)}&sig=${sig}`;
  }

  /** Prüft eine Adresse aus `signierteUrl` — Ablauf UND Signatur, zeitkonstant. */
  pruefe(bucket: Bucket, schluessel: string, ablauf: number, sig: string): boolean {
    if (!Number.isSafeInteger(ablauf) || ablauf < this.jetzt()) return false;
    const soll = Buffer.from(this.signatur(bucket, schluessel, ablauf));
    const ist = Buffer.from(sig);
    return soll.length === ist.length && timingSafeEqual(soll, ist);
  }
}
