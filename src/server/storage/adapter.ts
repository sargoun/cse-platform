/**
 * Der Speicher-Adapter.
 *
 * Zwei Implementierungen, und keine davon tut so als ob:
 *
 *  - `SupabaseSpeicher` spricht mit dem echten Bucket. **Ohne Zugangsdaten
 *    wirft er `NichtVerbundenFehler`** — er simuliert keinen Erfolg. Die
 *    Oberflaeche zeigt "nicht verbunden", und alles andere laeuft weiter.
 *  - `LokalerSpeicher` ist der Testspeicher: eine Map im Prozess. Er ist
 *    kein Ersatz fuer den echten, sondern erfuellt denselben Vertrag, damit
 *    das Verhalten drumherum pruefbar ist.
 */

export class NichtVerbundenFehler extends Error {
  readonly status = 409 as const;
  readonly code = 'KANAL_NICHT_VERBUNDEN' as const;
  constructor(dienst: string) {
    super(`${dienst} ist nicht verbunden. Keine Zugangsdaten konfiguriert.`);
    this.name = 'NichtVerbundenFehler';
  }
}

/**
 * Nur private Buckets. Es gibt keinen oeffentlichen (DOC-03).
 *
 * `einsatz-medien` traegt Schichtfotos und -videos (TIM-10,
 * 07-INTEGRATIONEN §6.4). Er steht bewusst in DERSELBEN Liste und nicht in
 * einer zweiten daneben: eine zweite Liste ist die Stelle, an der irgendwann
 * ein oeffentlicher Bucket auftaucht, weil „das sind ja nur Fotos". Ein frei
 * lesbarer Bucket mit Aufnahmen von Arbeitsplaetzen und den Menschen darauf
 * ist ein Datenschutzvorfall, kein Bequemlichkeitsgewinn.
 */
export const BUCKETS = ['dokumente', 'archiv', 'einsatz-medien'] as const;
export type Bucket = (typeof BUCKETS)[number];

/**
 * 15 Minuten (DOC-03). Eine **Codekonstante**, keine Umgebungsvariable: eine
 * Ablauffrist, die pro Umgebung anders gesetzt werden kann, ist eine, die in
 * der Produktion auf „24 h" steht, weil jemand einmal einen Download debuggen
 * musste. Der Test prueft gegen diese Zahl.
 */
export const SIGNATUR_SEKUNDEN = 15 * 60;

export interface Speicher {
  readonly verbunden: boolean;
  lege(bucket: Bucket, schluessel: string, daten: Uint8Array): Promise<void>;
  hole(bucket: Bucket, schluessel: string): Promise<Uint8Array>;
  entferne(bucket: Bucket, schluessel: string): Promise<void>;
  /**
   * Die einzige Adresse, unter der ein Objekt erreichbar ist (DOC-03, SEC-A6).
   *
   * Es gibt keinen oeffentlichen Pfad — nicht als Ausweichweg, nicht fuer
   * Vorschaubilder. Wer eine Datei zeigen will, laesst sie signieren, und die
   * Signatur laeuft nach `SIGNATUR_SEKUNDEN` ab.
   */
  signierteUrl(bucket: Bucket, schluessel: string, sekunden?: number): Promise<string>;
}

/** Der echte Adapter. Ohne Zugangsdaten: nicht verbunden, und sagt es. */
export class SupabaseSpeicher implements Speicher {
  readonly verbunden: boolean;

  constructor(
    private readonly url = process.env['SUPABASE_URL'] ?? '',
    private readonly schluessel = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '',
  ) {
    this.verbunden = this.url !== '' && this.schluessel !== '';
  }

  private pruefe(): void {
    if (!this.verbunden) throw new NichtVerbundenFehler('Supabase Storage');
  }

  async lege(bucket: Bucket, schluessel: string, daten: Uint8Array): Promise<void> {
    this.pruefe();
    const antwort = await fetch(`${this.url}/storage/v1/object/${bucket}/${schluessel}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.schluessel}`,
        'content-type': 'application/octet-stream',
      },
      // `Uint8Array` traegt einen generischen Puffertyp; fetch will einen
      // konkreten. Eine Kopie ist billiger als ein `as any`.
      body: new Uint8Array(daten).buffer as ArrayBuffer,
    });
    if (!antwort.ok) throw new Error(`Storage lege: ${antwort.status}`);
  }

  async hole(bucket: Bucket, schluessel: string): Promise<Uint8Array> {
    this.pruefe();
    const antwort = await fetch(`${this.url}/storage/v1/object/${bucket}/${schluessel}`, {
      headers: { authorization: `Bearer ${this.schluessel}` },
    });
    if (!antwort.ok) throw new Error(`Storage hole: ${antwort.status}`);
    return new Uint8Array(await antwort.arrayBuffer());
  }

  async entferne(bucket: Bucket, schluessel: string): Promise<void> {
    this.pruefe();
    const antwort = await fetch(`${this.url}/storage/v1/object/${bucket}/${schluessel}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${this.schluessel}` },
    });
    if (!antwort.ok) throw new Error(`Storage entferne: ${antwort.status}`);
  }

  async signierteUrl(
    bucket: Bucket, schluessel: string, sekunden = SIGNATUR_SEKUNDEN,
  ): Promise<string> {
    this.pruefe();
    const antwort = await fetch(`${this.url}/storage/v1/object/sign/${bucket}/${schluessel}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.schluessel}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: sekunden }),
    });
    if (!antwort.ok) throw new Error(`Storage signierteUrl: ${antwort.status}`);
    const daten = (await antwort.json()) as { signedURL?: string };
    if (daten.signedURL === undefined || daten.signedURL === '') {
      // Kein Ausweichen auf einen oeffentlichen Pfad. Konnte nicht signiert
      // werden, ist die Datei nicht abrufbar — und die Oberflaeche sagt das.
      throw new Error('Storage hat keine signierte Adresse geliefert.');
    }
    return `${this.url}/storage/v1${daten.signedURL}`;
  }
}

/** Der Testspeicher — derselbe Vertrag, im Prozess. */
export class LokalerSpeicher implements Speicher {
  readonly verbunden = true;
  private readonly objekte = new Map<string, Uint8Array>();

  private static ort(bucket: Bucket, schluessel: string): string {
    return `${bucket}/${schluessel}`;
  }

  lege(bucket: Bucket, schluessel: string, daten: Uint8Array): Promise<void> {
    this.objekte.set(LokalerSpeicher.ort(bucket, schluessel), daten);
    return Promise.resolve();
  }

  hole(bucket: Bucket, schluessel: string): Promise<Uint8Array> {
    const d = this.objekte.get(LokalerSpeicher.ort(bucket, schluessel));
    if (d === undefined) return Promise.reject(new Error('Objekt nicht gefunden.'));
    return Promise.resolve(d);
  }

  entferne(bucket: Bucket, schluessel: string): Promise<void> {
    this.objekte.delete(LokalerSpeicher.ort(bucket, schluessel));
    return Promise.resolve();
  }

  /**
   * Auch der Testspeicher gibt eine ABLAUFENDE Adresse zurueck, keine, die
   * einfach den Pfad nennt. Ein Doppel, das etwas Einfacheres liefert als das
   * Original, laesst genau die Zusage ungeprueft, um die es geht.
   */
  signierteUrl(
    bucket: Bucket, schluessel: string, sekunden = SIGNATUR_SEKUNDEN,
  ): Promise<string> {
    if (!this.objekte.has(LokalerSpeicher.ort(bucket, schluessel))) {
      return Promise.reject(new Error('Objekt nicht gefunden.'));
    }
    const ablauf = Math.floor(Date.now() / 1000) + sekunden;
    return Promise.resolve(
      `local://${bucket}/${schluessel}?ablauf=${String(ablauf)}`);
  }

  /** Nur fuer Tests: was liegt wirklich im Speicher? */
  rohBytes(bucket: Bucket, schluessel: string): Uint8Array | undefined {
    return this.objekte.get(LokalerSpeicher.ort(bucket, schluessel));
  }
}
