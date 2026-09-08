/**
 * Signierte URLs mit 15 Minuten Gueltigkeit (DOC-03, SEC-A6).
 *
 * Kein Objekt im Speicher ist ohne Signatur erreichbar: die Buckets sind
 * privat, es gibt keinen oeffentlichen. Eine Signatur bindet Objekt, Mandant,
 * Zweck und Ablauf zusammen — und der Zweck steht in der Audit-Zeile, die ein
 * Pruefer liest, weshalb er ein geschlossenes Vokabular ist und kein Freitext.
 *
 * Die Uhr wird **uebergeben**, nicht gelesen. Invariante 5 gilt hier genauso:
 * ein Ablauf, der von der Uhr des Aufrufers abhaengt, laeuft nie ab, wenn der
 * Aufrufer seine Uhr stellt — und ein Test koennte den Minute-16-Fall gar
 * nicht pruefen, ohne 16 Minuten zu warten.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Die Zwecke aus `05-API-KARTE.md` — geschlossen, weil sie protokolliert werden. */
export const ZWECKE = [
  'anzeigen', 'herunterladen', 'drucken', 'pruefbericht', 'datev_beleg', 'dsgvo_auskunft',
] as const;
export type Zweck = (typeof ZWECKE)[number];

/** 15 Minuten. DOC-03 nennt die Zahl; sie steht hier einmal. */
export const GUELTIG_SEKUNDEN = 15 * 60;

/**
 * ASCII RECORD SEPARATOR als Feldtrenner — derselbe Grund wie in der
 * Hash-Kette: ohne Trenner sind zwei verschiedene Feldkombinationen dieselbe
 * Bytefolge, und wer die Felder geschickt waehlt, signiert etwas anderes als
 * er vorgibt.
 */
const TRENNER = '\u001e';

export class SignaturFehler extends Error {
  constructor(
    nachricht: string,
    readonly grund: 'abgelaufen' | 'ungueltig' | 'fremder_mandant' | 'defekt',
  ) {
    super(nachricht);
    this.name = 'SignaturFehler';
  }
}

export interface SignaturDaten {
  readonly dokumentId: string;
  readonly mandantId: string;
  readonly objektSchluessel: string;
  readonly zweck: Zweck;
  /** Sekunden seit Epoch. */
  readonly ablauf: number;
  /** Wer sie angefordert hat — steht in der Audit-Zeile. */
  readonly benutzerId: string;
}

function nutzlast(d: SignaturDaten): string {
  return [
    d.dokumentId, d.mandantId, d.objektSchluessel, d.zweck,
    String(d.ablauf), d.benutzerId,
  ].join(TRENNER);
}

export function signiere(d: SignaturDaten, geheimnis: string): string {
  return createHmac('sha256', geheimnis).update(nutzlast(d)).digest('base64url');
}

export interface Signiert extends SignaturDaten {
  readonly signatur: string;
}

/** Erzeugt die Signaturdaten. `jetzt` ist Sekunden seit Epoch. */
export function erzeugeSignatur(
  d: Omit<SignaturDaten, 'ablauf'>,
  geheimnis: string,
  jetzt: number,
): Signiert {
  const voll: SignaturDaten = { ...d, ablauf: jetzt + GUELTIG_SEKUNDEN };
  return { ...voll, signatur: signiere(voll, geheimnis) };
}

/**
 * Prueft eine Signatur. Wirft benannt, gibt sonst die Daten zurueck.
 *
 * `mandantErwartet` ist nicht optional: eine Signatur, die nur "echt" ist,
 * aber nicht gegen den Mandanten der Sitzung geprueft wird, ist genau die
 * abgelaufene URL aus einem anderen Bereich, die Akzeptanz (4) meint.
 */
export function pruefeSignatur(
  s: Signiert,
  geheimnis: string,
  jetzt: number,
  mandantErwartet: string,
): SignaturDaten {
  const erwartet = signiere(s, geheimnis);
  const a = Buffer.from(erwartet);
  const b = Buffer.from(s.signatur);
  // Konstante Laufzeit: ein Vergleich, der beim ersten falschen Zeichen
  // abbricht, verraet die Signatur zeichenweise.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SignaturFehler('Signatur ungueltig.', 'ungueltig');
  }
  // Ablauf VOR Mandant: eine abgelaufene URL soll nicht durch ihre
  // Fehlermeldung verraten, ob sie zu einem fremden Bereich gehoerte.
  if (jetzt >= s.ablauf) {
    throw new SignaturFehler('Signatur abgelaufen.', 'abgelaufen');
  }
  if (s.mandantId !== mandantErwartet) {
    throw new SignaturFehler('Signatur gehoert zu einem anderen Bereich.', 'fremder_mandant');
  }
  return s;
}
