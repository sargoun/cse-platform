import type { ReactNode } from 'react';

/**
 * Eine Nutzlast als LESBARES Blatt — nicht als JSON.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund (Nutzerbericht, Bild aus dem Freigabeposteingang).**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `/portal/[mandant]/freigaben/[id]` zeigte unter „Vorschau der Nutzlast"
 * `JSON.stringify(…, null, 2)`:
 *
 *     {
 *       "termin": "2026-09-22T09:00:00+02:00",
 *       "objektId": "9cb69ac9-fc66-4176-bc46-765061232ffb",
 *       "protokoll": "§ 12 VOB/B",
 *       "teilnehmer": ["Bauleitung", "Auftraggeber"]
 *     }
 *
 * Das ist der Bildschirm, auf dem ein Mensch **entscheidet**, ob etwas
 * geschehen darf. Er liest dort geschweifte Klammern, einen Zeitstempel in
 * UTC-Schreibweise und eine 36-stellige Kennung — und soll auf „Freigeben"
 * drücken. Wer das nicht lesen kann, drückt trotzdem; das ist die teure
 * Richtung, und genau sie macht die Freigabe wertlos.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Was diese Datei NICHT tut: Felder weglassen.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die naheliegende Lösung wäre eine Auswahl der „wichtigen" Felder. Sie wäre
 * falsch: eine Freigabe ist die Zusage, dass der Mensch gesehen hat, was er
 * freigibt. Ein Feld, das die Oberfläche für unwichtig hält und verschweigt,
 * ist genau das Feld, mit dem sich später etwas anderes belegen lässt, als
 * gemeint war.
 *
 * Geändert wird deshalb nur die DARSTELLUNG:
 *
 *  * Der Feldname wird zum Wort — `objektId` → „Objekt", `teilnehmer` →
 *    „Teilnehmer". Ein unbekannter Name wird lesbar gemacht und nicht
 *    versteckt (`liefer_datum` → „Liefer Datum"), damit ein neues Feld
 *    auffällt statt zu verschwinden.
 *  * Ein Zeitpunkt steht in Berliner Zeit mit Wochentag (Invariante 2).
 *  * Eine Kennung steht als Kennung da, gekürzt, mit dem vollen Wert im
 *    `title` — sie ist für den Entscheider kein Inhalt, aber für die
 *    Rückfrage der Beleg.
 *  * `true`/`false` werden zu „Ja"/„Nein", `null` zu „nicht angegeben".
 *  * Eine Liste wird zur Aufzählung, eine verschachtelte Struktur zu einem
 *    eingerückten Block mit eigener Überschrift.
 *
 * **Und die Prüfsumme bleibt** — als Satz mit Wert daneben, nicht als nackte
 * Zeile Hexadezimal. Sie ist der Beleg, dass genau diese Nutzlast entschieden
 * wurde (Invariante 4, Hashkette); wegzulassen wäre sie nur bequemer.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ISO_ZEITPUNKT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([.]\d+)?(Z|[+-]\d{2}:\d{2})$/u;
const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/u;

export interface NutzlastTexte {
  readonly ja: string;
  readonly nein: string;
  readonly leer: string;
  readonly nichtsDrin: string;
  readonly kennung: string;
  readonly pruefsumme: string;
  readonly pruefsummeErklaerung: string;
  readonly eintrag: string;
  /** Bekannte Feldnamen in der Sprache des Lesers. */
  readonly felder: Readonly<Record<string, string>>;
}

/**
 * Aus `objektId` wird „Objekt Id", aus `liefer_datum` „Liefer Datum".
 *
 * Der Rückfall, wenn ein Feld nicht in der Tabelle steht. Er macht den Namen
 * lesbar, ohne ihn zu erfinden — und er lässt erkennen, dass die Übersetzung
 * fehlt, statt das Feld stillschweigend zu verstecken.
 */
export function feldname(schluessel: string, texte: NutzlastTexte): string {
  const bekannt = texte.felder[schluessel];
  if (bekannt !== undefined) return bekannt;
  return schluessel
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .replace(/^./u, (z) => z.toUpperCase())
    .trim();
}

function Zeitpunkt({ wert, sprache }: { readonly wert: string; readonly sprache: string }) {
  /*
   * **Berliner Zeit, mit Wochentag** (Invariante 2). `2026-09-22T09:00:00+02:00`
   * sagt einem Menschen nichts; „Dienstag, 22. September 2026 um 09:00" sagt
   * ihm, ob er an dem Tag kann.
   */
  const format = new Intl.DateTimeFormat(sprache === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric',
    month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return <span className="text-text">{format.format(new Date(wert))}</span>;
}

function Tag({ wert, sprache }: { readonly wert: string; readonly sprache: string }) {
  const format = new Intl.DateTimeFormat(sprache === 'en' ? 'en-GB' : 'de-DE', {
    timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric',
    month: 'long', year: 'numeric',
  });
  return <span className="text-text">{format.format(new Date(`${wert}T12:00:00Z`))}</span>;
}

function Kennung({ wert, texte }: { readonly wert: string; readonly texte: NutzlastTexte }) {
  /*
   * Gekuerzt, benannt, und der volle Wert im `title`. Fuer den Entscheider ist
   * eine UUID kein Inhalt; fuer die Rueckfrage ist sie der Beleg, und deshalb
   * verschwindet sie nicht.
   */
  return (
    <span className="text-text-muted" title={wert}>
      {texte.kennung}{' '}
      <span className="font-mono text-xs">{wert.slice(0, 8)}…</span>
    </span>
  );
}

function Wert({ wert, sprache, texte }: {
  readonly wert: unknown;
  readonly sprache: string;
  readonly texte: NutzlastTexte;
}): ReactNode {
  if (wert === null || wert === undefined) {
    return <span className="text-text-subtle">{texte.leer}</span>;
  }
  if (typeof wert === 'boolean') {
    return <span className="text-text">{wert ? texte.ja : texte.nein}</span>;
  }
  if (typeof wert === 'number') {
    return <span className="tabular-nums text-text">{String(wert)}</span>;
  }
  if (typeof wert === 'string') {
    if (ISO_ZEITPUNKT.test(wert)) return <Zeitpunkt wert={wert} sprache={sprache} />;
    if (ISO_TAG.test(wert)) return <Tag wert={wert} sprache={sprache} />;
    if (UUID.test(wert)) return <Kennung wert={wert} texte={texte} />;
    if (wert.trim() === '') return <span className="text-text-subtle">{texte.leer}</span>;
    return <span className="whitespace-pre-wrap break-words text-text">{wert}</span>;
  }
  if (Array.isArray(wert)) {
    if (wert.length === 0) return <span className="text-text-subtle">{texte.leer}</span>;
    /*
     * Eine Liste einfacher Werte wird zur Aufzaehlung in einer Zeile —
     * „Bauleitung · Auftraggeber". Eine Liste von Bloecken bekommt je Eintrag
     * eine eigene Ueberschrift, damit sich die Felder nicht vermischen.
     */
    const einfach = wert.every(
      (x) => x === null || ['string', 'number', 'boolean'].includes(typeof x));
    if (einfach) {
      return (
        <span className="text-text">
          {wert.map((x, i) => (
            <span key={`${String(x)}-${String(i)}`}>
              {i === 0 ? '' : ' · '}
              <Wert wert={x} sprache={sprache} texte={texte} />
            </span>
          ))}
        </span>
      );
    }
    return (
      <div className="flex flex-col gap-s3">
        {wert.map((x, i) => (
          <div key={String(i)} className="border-l-2 border-line pl-s3">
            <p className="m-0 mb-s1 text-micro uppercase tracking-[0.08em] text-text-subtle">
              {`${texte.eintrag} ${String(i + 1)}`}
            </p>
            <Wert wert={x} sprache={sprache} texte={texte} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof wert === 'object') {
    return <Felderliste daten={wert as Record<string, unknown>}
                        sprache={sprache} texte={texte} eingerueckt />;
  }
  return <span className="text-text">{String(wert)}</span>;
}

function Felderliste({ daten, sprache, texte, eingerueckt = false }: {
  readonly daten: Record<string, unknown>;
  readonly sprache: string;
  readonly texte: NutzlastTexte;
  readonly eingerueckt?: boolean;
}) {
  const paare = Object.entries(daten);
  if (paare.length === 0) {
    return <p className="m-0 text-sm text-text-subtle">{texte.nichtsDrin}</p>;
  }
  return (
    <dl className={`m-0 grid grid-cols-1 gap-x-s5 gap-y-s3 sm:grid-cols-[minmax(8rem,auto)_1fr] ${
      eingerueckt ? 'mt-s2' : ''}`}>
      {paare.map(([schluessel, wert]) => (
        <div key={schluessel} className="contents" data-cse="nutzlast-feld" data-feld={schluessel}>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            {feldname(schluessel, texte)}
          </dt>
          <dd className="m-0 min-w-0 text-sm">
            <Wert wert={wert} sprache={sprache} texte={texte} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Nutzlastblatt({ nutzlast, pruefsumme = null, sprache, texte, cse }: {
  readonly nutzlast: unknown;
  /** Der SHA-256 der Nutzlast — als Satz, nicht als nackte Zeile Hexadezimal. */
  readonly pruefsumme?: string | null;
  readonly sprache: string;
  readonly texte: NutzlastTexte;
  readonly cse?: string;
}) {
  const istObjekt = typeof nutzlast === 'object' && nutzlast !== null
    && !Array.isArray(nutzlast);

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-s5"
         data-cse={cse ?? 'nutzlastblatt'}>
      {istObjekt
        ? <Felderliste daten={nutzlast as Record<string, unknown>}
                       sprache={sprache} texte={texte} />
        : <Wert wert={nutzlast} sprache={sprache} texte={texte} />}

      {pruefsumme === null ? null : (
        <p className="m-0 mt-s5 border-t border-line pt-s3 text-xs text-text-subtle"
           data-cse="nutzlast-pruefsumme">
          {texte.pruefsummeErklaerung}{' '}
          <span className="break-all font-mono" title={pruefsumme}>
            {pruefsumme.slice(0, 16)}…
          </span>
        </p>
      )}
    </div>
  );
}
