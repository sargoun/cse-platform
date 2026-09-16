import 'server-only';

/**
 * Die vier Jobbörsen — **gebaut, nicht verbunden** (REC-09, D-02).
 *
 * **Warum diese Datei in `server/versand` liegt.** Eine Stellenanzeige geht
 * nach draussen: Firmenname, Einsatzort, Konditionen. Das ist der eine Ausgang
 * aus Invariante 7, und die Merge-Wache `ein-ausgang` besteht darauf, dass
 * jeder Sender hier steht — auch einer, der heute nichts sendet.
 *
 * **Was hier NICHT steht.** Kein `fetch` mit einer erratenen Adresse, kein
 * Wiederholen, keine Warteschlange. Zwei der vier sind darüber hinaus
 * grundsätzlich anders gelagert und das steht ausdrücklich dabei:
 *
 *  - **Indeed und StepStone** stehen in CLAUDE.md unter „Out of scope": das
 *    SCRAPEN ist es, was dort verboten ist. Eine Anzeige über eine offizielle
 *    Arbeitgeber-API zu schalten wäre etwas anderes — nur gibt es die für
 *    diesen Mandanten weder als Vertrag noch als Zugang. Sie bleiben deshalb
 *    als Ziel sichtbar und dauerhaft `nicht_verbunden`, statt still zu fehlen:
 *    eine Liste, in der zwei Ziele einfach nicht auftauchen, liest sich wie
 *    „geht nicht", und die Frage ist eine andere — nämlich „noch nicht
 *    beauftragt".
 *  - **Die Bundesagentur für Arbeit** hat eine echte Arbeitgeber-Schnittstelle,
 *    aber sie setzt eine Betriebsnummer und eine freigeschaltete Kennung
 *    voraus (O-374).
 *
 * **Die eigene Karriereseite ist kein Ziel.** Sie verlässt das Haus nicht, sie
 * IST das Haus: eine veröffentlichte Stelle steht dort, weil `stelle.status`
 * es sagt und die öffentliche Policy sie durchlässt — nicht, weil ein Adapter
 * `true` zurückgegeben hat. Dieselbe Trennung wie bei Social (0163, D-546).
 */

export type Boerse = 'bundesagentur' | 'indeed' | 'stepstone' | 'linkedin';

export const BOERSE_NAME: Readonly<Record<Boerse, string>> = {
  bundesagentur: 'Bundesagentur für Arbeit',
  indeed: 'Indeed',
  stepstone: 'StepStone',
  linkedin: 'LinkedIn Jobs',
};

/**
 * Welche Börse welche Zugangsdaten braucht.
 *
 * Die Namen stehen hier und nicht in der Datenbank, weil sie keine Einstellung
 * sind, sondern eine Eigenschaft des Anbieters: die Bundesagentur verlangt
 * eine Betriebsnummer, LinkedIn eine Organisations-URN.
 */
const ZUGANG: Readonly<Record<Boerse, readonly string[]>> = {
  bundesagentur: ['CSE_BA_BETRIEBSNUMMER', 'CSE_BA_TOKEN'],
  indeed: ['CSE_INDEED_ARBEITGEBER_ID', 'CSE_INDEED_TOKEN'],
  stepstone: ['CSE_STEPSTONE_KUNDENNUMMER', 'CSE_STEPSTONE_TOKEN'],
  linkedin: ['CSE_LINKEDIN_ORG_URN', 'CSE_LINKEDIN_TOKEN'],
};

export type Umgebung = Readonly<Record<string, string | undefined>>;

/** Sind ALLE Schlüssel dieser Börse gesetzt? Einer allein reicht nie. */
export function zugangVollstaendig(
  boerse: Boerse, umgebung: Umgebung = process.env,
): boolean {
  return ZUGANG[boerse].every((name) => {
    const wert = umgebung[name];
    return wert !== undefined && wert.trim() !== '';
  });
}

/** Welche Schlüssel fehlen — namentlich, damit der Bildschirm sie nennen kann. */
export function fehlendeSchluessel(
  boerse: Boerse, umgebung: Umgebung = process.env,
): readonly string[] {
  return ZUGANG[boerse].filter((name) => {
    const wert = umgebung[name];
    return wert === undefined || wert.trim() === '';
  });
}

export interface BoersenStand {
  readonly boerse: Boerse;
  readonly name: string;
  readonly verbunden: boolean;
  /** Ein Satz für den Bildschirm — nie nur ein Häkchen. */
  readonly grund: string;
}

export const BOERSEN: readonly Boerse[] =
  ['bundesagentur', 'indeed', 'stepstone', 'linkedin'];

/**
 * Der Stand je Börse — und der GRUND steht daneben.
 *
 * **Vollständige Schlüssel machen noch keinen Anschluss.** Auch mit allen
 * Werten gibt es hier keinen Sender: es fehlt der Vertrag, die
 * Arbeitgeberfreischaltung und ein geprüfter Adapter. Der Satz sagt das, statt
 * eine fehlende Zugangsdatei zu behaupten, die es gar nicht ist — derselbe
 * Fehler, den D-546 bei den Social-Plattformen abgeräumt hat.
 */
export function stand(umgebung: Umgebung = process.env): readonly BoersenStand[] {
  return BOERSEN.map((boerse) => {
    const fehlt = fehlendeSchluessel(boerse, umgebung);
    return {
      boerse,
      name: BOERSE_NAME[boerse],
      verbunden: false,
      grund: fehlt.length > 0
        ? `nicht verbunden — es fehlen ${fehlt.join(', ')} (O-374)`
        : 'nicht verbunden — die Zugangsdaten sind gesetzt, aber es gibt weder '
          + 'einen Arbeitgebervertrag noch einen geprüften Adapter (O-374)',
    };
  });
}

export class BoerseNichtVerbundenFehler extends Error {
  readonly code = 'nicht_verbunden';
  constructor(readonly boerse: Boerse, grund: string) {
    super(`${BOERSE_NAME[boerse]}: ${grund}`);
    this.name = 'BoerseNichtVerbundenFehler';
  }
}

export interface StellenAuftrag {
  readonly stelleId: string;
  readonly titel: string;
  readonly beschreibung: string;
  readonly einsatzort: string | null;
}

/**
 * Der Port, den ein echter Anbieter eines Tages erfüllt.
 *
 * `verbunden` und `hinweis` stehen am Port und nicht erst am Fehler: die
 * Oberfläche muss sagen können, WARUM ein Ziel nicht geht, ohne es vorher
 * versucht zu haben. Dieselbe Form trägt `social-plattform.ts` (SOC-06/07) —
 * zwei Anschlüsse mit zwei Formen wären zwei Arten, dasselbe zu erklären.
 */
export interface StellenboersenPort {
  readonly verbunden: boolean;
  readonly hinweis: string;
  veroeffentliche(auftrag: StellenAuftrag): Promise<{ readonly externeRef: string }>;
}

/**
 * Der Adapter, solange nichts hinterlegt ist.
 *
 * **Er wirft, statt eine Kennung zu erfinden.** Eine erfundene `externeRef`
 * wäre ein Beleg für etwas, das nie geschah — und die Stelle sähe im Portal
 * veröffentlicht aus. Die Route bildet das auf `409 kanal_nicht_verbunden`
 * ab (R-17); es gibt keinen Demo-Zweig und keinen halben Erfolg (D-02).
 */
export class NichtVerbundeneBoerse implements StellenboersenPort {
  readonly verbunden = false;
  readonly hinweis: string;

  constructor(readonly boerse: Boerse, umgebung: Umgebung = process.env) {
    const fehlt = fehlendeSchluessel(boerse, umgebung);
    /*
     * Der Satz muss auch stimmen, wenn NICHTS fehlt — sonst stünde dort „es
     * fehlen ." und wer das liest, sucht einen Schlüssel, der nicht fehlt.
     * Derselbe Fall wie in `social-plattform.ts`.
     */
    const grund = fehlt.length === 0
      ? 'die Zugangsdaten liegen vor, aber es gibt noch keinen sendenden Adapter'
      : `es fehlen ${fehlt.join(' und ')}`;
    this.hinweis = `${BOERSE_NAME[boerse]}: nicht verbunden — ${grund}. `
      + 'Ohne Vertrag und freigeschaltete Kennung geht keine Anzeige hinaus '
      + '(O-374).';
  }

  veroeffentliche(auftrag: StellenAuftrag): Promise<{ readonly externeRef: string }> {
    void auftrag;
    return Promise.reject(new BoerseNichtVerbundenFehler(this.boerse, this.hinweis));
  }
}

/**
 * Der Anschluss für eine Börse.
 *
 * Heute immer `NichtVerbundeneBoerse` — und die Verzweigung steht trotzdem
 * schon hier, weil sie die Stelle ist, an die der erste echte Adapter kommt.
 *
 * // TODO(client): O-374 — welche Jobbörse wird beauftragt, mit welchem
 * // Vertrag, und liegt für die Bundesagentur eine freigeschaltete
 * // Betriebsnummer vor? Ohne Antwort bleibt jedes Ziel unverbunden; eine
 * // geratene Kennung veröffentlichte im Namen der falschen Gesellschaft.
 */
export function boersenPort(boerse: Boerse, umgebung: Umgebung = process.env): StellenboersenPort {
  return new NichtVerbundeneBoerse(boerse, umgebung);
}
