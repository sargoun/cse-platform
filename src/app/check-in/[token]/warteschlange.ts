/**
 * Die Warteschlange auf dem Gerät (TIM-09).
 *
 * Ein Telefon im Treppenhaus, im Tiefgeschoss, im Aufzug: kein Netz, und
 * trotzdem Schichtbeginn. Was hier passiert, ist bewusst klein — merken, was
 * getippt wurde, und es senden, sobald wieder Netz da ist.
 *
 * **Fünf Entscheidungen, an denen der naheliegende Entwurf still falsch wäre:**
 *
 *  1. **`localStorage`, nicht `sessionStorage` und nicht der Zustand der
 *     Komponente.** Das Abnahmekriterium verlangt, dass die Schlange einen
 *     Neuladen UND einen Browserneustart übersteht. `sessionStorage` verliert
 *     sie beim Schliessen des Tabs — und genau das tut jemand, der das Telefon
 *     einsteckt und weiterarbeitet.
 *
 *  2. **Jedes Ereignis bekommt beim ANLEGEN eine `client_ereignis_id`, nicht
 *     beim Senden.** Wird beim Senden geprägt, hat dieselbe Stunde nach zwei
 *     Sendeversuchen zwei Kennungen — und die Doppelerkennung des Servers
 *     greift nicht, weil sie genau an dieser Kennung hängt. Ein Funkloch
 *     ergäbe zwei Ansprüche auf eine Schicht.
 *
 *  3. **Ein gesendetes Ereignis wird erst nach der Antwort entfernt.** Wer
 *     vorher aufräumt, verliert die Stunde, sobald die Verbindung mitten im
 *     Senden abbricht — und zwar unbemerkt, denn auf dem Bildschirm stand
 *     „gesendet". Lieber ein zweites Mal senden: dafür gibt es (2).
 *
 *  4. **Die Gerätezeit reist mit, sie entscheidet aber nichts.** Sie wird beim
 *     Antippen festgehalten, damit die Planung später sieht, was das Gerät
 *     behauptet hat. Der massgebliche Zeitpunkt entsteht auf dem Server
 *     (Invariante 5, TIM-08) — und für ein nachgereichtes Ereignis entsteht er
 *     erst, wenn ein Mensch entschieden hat (§9.4).
 *
 *  5. **Die RICHTUNG behauptet das Gerät nicht.** Es weiss sie nicht: eine
 *     Fläche mit einem Knopf, eine Marke, die diese Seite absichtlich nicht
 *     auflöst. Ein gemerkter Stempel heisst `unbekannt`, und der Server setzt
 *     beim Nachreichen ein, was im Zweck der Marke steht (0090). Die frühere
 *     Fassung stellte jeden Stempel als `checkin` an — ein im Funkloch
 *     getipptes Schichtende reiste damit als Schichtbeginn zur Planung. Sie
 *     sah aus wie eine Aufzeichnung und war eine Falschaussage.
 */

/**
 * Was ein gemerkter Vorgang IST — und ausdrücklich nicht, in welche Richtung
 * er zeigt.
 *
 * **Die Richtung weiss das Gerät nicht, und deshalb behauptet es sie nicht.**
 * Die Fläche ist EIN Knopf; ob ein Antippen Beginn oder Ende bedeutet,
 * entscheidet der Zweck der Marke auf dem Server — eine Marke je Bein (0035
 * §5.5 Nr. 3), und `app.checkin_verbrauchen` liest Beginn oder Ende an nichts
 * anderem ab. Diese Seite löst die Marke bewusst nicht auf (AUT-06), sie
 * könnte die Richtung also gar nicht kennen. Ein gemerkter Stempel heisst
 * darum `unbekannt`; beim Nachreichen setzt die Datenbank ein, was in der
 * Marke steht (0090), und wo keine Marke auflöst, bleibt es `unbekannt`.
 *
 * Der naheliegende Entwurf liesse das Gerät die Richtung ableiten — aus der
 * zuletzt bestätigten Richtung plus den seither eingereihten Stempeln. Das
 * wäre eine Vermutung, und sie ist überflüssig: der Server weiss es sicher.
 *
 * `checkin` und `checkout` bleiben im Typ, weil eine ältere Fassung dieser
 * Datei `checkin` in `localStorage` geschrieben hat. Diese Einträge liegen
 * heute auf Telefonen, sie werden noch gesendet, und der Server ordnet sie
 * richtig ein, statt sie zu glauben. Erzeugt werden sie hier nicht mehr.
 */
export type WarteArt = 'unbekannt' | 'checkin' | 'checkout';

export interface WarteEintrag {
  /** Beim ANLEGEN geprägt — sie trägt die Doppelerkennung des Servers. */
  readonly clientEreignisId: string;
  readonly art: WarteArt;
  /** Wann getippt wurde, nach der Uhr des Geräts. Eine Behauptung. */
  readonly behaupteteZeit: string;
  /** Wie oft schon vergeblich gesendet — nur für die Anzeige. */
  readonly versuche: number;
}

const SCHLUESSEL = 'cse.zeit.warteschlange';
/** Nach so vielen Einträgen ist etwas anderes kaputt als das Netz. */
const MAX = 100;

/** Eine UUID, auch auf einem Browser ohne `crypto.randomUUID`. */
export function neueId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c !== undefined) c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  // Version 4, Variante 10xx — sonst weist die Datenbank den Wert als
  // `uuid` zwar nicht ab, aber die Kennung wäre keine erkennbare UUID.
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-`
    + `${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Ein Fehler beim Lesen ist eine LEERE Schlange, kein Absturz.
 *
 * `localStorage` wirft im privaten Modus mancher Browser und bei
 * abgeschalteten Seitendaten schon beim Zugriff. Eine Stempelfläche, die
 * deswegen weiss bleibt, ist schlimmer als eine ohne Warteschlange.
 */
export function lies(): readonly WarteEintrag[] {
  try {
    const roh = globalThis.localStorage?.getItem(SCHLUESSEL);
    if (roh === null || roh === undefined) return [];
    const daten: unknown = JSON.parse(roh);
    if (!Array.isArray(daten)) return [];
    return daten.filter((e): e is WarteEintrag =>
      typeof e === 'object' && e !== null
      && typeof (e as WarteEintrag).clientEreignisId === 'string'
      && typeof (e as WarteEintrag).behaupteteZeit === 'string');
  } catch {
    return [];
  }
}

function schreibe(eintraege: readonly WarteEintrag[]): void {
  try {
    globalThis.localStorage?.setItem(SCHLUESSEL, JSON.stringify(eintraege.slice(0, MAX)));
  } catch {
    // Voller oder gesperrter Speicher. Der Stempelvorgang läuft trotzdem
    // weiter — er wird dann eben sofort gesendet oder geht verloren, und
    // beides ist besser als eine Fläche, die nicht mehr reagiert.
  }
}

/** Legt einen Eintrag an und gibt ihn zurück — mit seiner endgültigen Kennung. */
export function stelleAn(art: WarteArt, jetzt: Date): WarteEintrag {
  const eintrag: WarteEintrag = {
    clientEreignisId: neueId(),
    art,
    behaupteteZeit: jetzt.toISOString(),
    versuche: 0,
  };
  schreibe([...lies(), eintrag]);
  return eintrag;
}

export function entferne(clientEreignisId: string): void {
  schreibe(lies().filter((e) => e.clientEreignisId !== clientEreignisId));
}

export function zaehleVersuch(clientEreignisId: string): void {
  schreibe(lies().map((e) =>
    e.clientEreignisId === clientEreignisId ? { ...e, versuche: e.versuche + 1 } : e));
}

export interface SendeErgebnis {
  readonly gesendet: number;
  readonly verblieben: number;
}

/**
 * Schickt die ganze Schlange in EINER Anfrage.
 *
 * Ein Aufruf je Eintrag wäre auf einer schlechten Verbindung genau die
 * Bauart, die auf halbem Weg abbricht und den Rest liegen lässt. Der Server
 * nimmt eine Liste entgegen und dedupliziert je Eintrag (K-09), also ist ein
 * zweiter Versuch harmlos.
 *
 * **Entfernt wird nur, was der Server BESTÄTIGT hat** — nicht die ganze
 * Schlange, weil die Antwort 202 lautete. Ein Eintrag, den der Server nicht
 * nennt, bleibt stehen und geht beim nächsten Mal wieder mit.
 */
export async function sende(token: string): Promise<SendeErgebnis> {
  const offen = lies();
  if (offen.length === 0) return { gesendet: 0, verblieben: 0 };

  const antwort = await fetch(`/api/check-in/${encodeURIComponent(token)}/offline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ereignisse: offen.map((e) => ({
        client_ereignis_id: e.clientEreignisId,
        art: e.art,
        behauptete_zeit: e.behaupteteZeit,
        geraete_zeit: new Date().toISOString(),
      })),
    }),
  });

  if (!antwort.ok) {
    for (const e of offen) zaehleVersuch(e.clientEreignisId);
    return { gesendet: 0, verblieben: offen.length };
  }

  const daten = (await antwort.json()) as {
    angenommen?: { client_ereignis_id?: string }[];
  };
  const bestaetigt = new Set(
    (daten.angenommen ?? [])
      .map((a) => a.client_ereignis_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  for (const id of bestaetigt) entferne(id);
  return { gesendet: bestaetigt.size, verblieben: lies().length };
}
