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

/** Nur private Buckets. Es gibt keinen oeffentlichen (DOC-03). */
export const BUCKETS = ['dokumente', 'archiv'] as const;
export type Bucket = (typeof BUCKETS)[number];

export interface Speicher {
  readonly verbunden: boolean;
  lege(bucket: Bucket, schluessel: string, daten: Uint8Array): Promise<void>;
  hole(bucket: Bucket, schluessel: string): Promise<Uint8Array>;
  entferne(bucket: Bucket, schluessel: string): Promise<void>;
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

  /** Nur fuer Tests: was liegt wirklich im Speicher? */
  rohBytes(bucket: Bucket, schluessel: string): Uint8Array | undefined {
    return this.objekte.get(LokalerSpeicher.ort(bucket, schluessel));
  }
}
