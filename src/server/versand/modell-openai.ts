import 'server-only';
import {
  ModellFehler, type EinbettungErgebnis, type ModellPort, type TextAuftrag, type TextErgebnis,
} from '../agent/modell/port.js';
import { EINBETTUNG_DIMENSION } from '../config/rag.js';

/**
 * Der echte Anbieter — **gebaut, nicht verbunden**.
 *
 * **Warum er in `server/versand` steht und nicht bei den Agenten.** Invariante
 * 7 kennt genau einen Ausgang, und ein Modellaufruf ist einer: er schickt
 * Vertragstext, Beträge und Namen an einen Auftragsverarbeiter. Der Radar-
 * Adapter darf daneben in seinem eigenen Verzeichnis stehen, weil er nur LIEST
 * — eine Adresse hinaus, kein Empfänger, kein Inhalt. Hier ist es umgekehrt,
 * also gehört der Aufruf dorthin, wo die Bytes das Haus verlassen. Die
 * Merge-Wache hat genau darauf bestanden, und sie hatte recht.
 *
 * Er steht hier vollständig, damit der Tausch eine Registerzeile und ein
 * Schlüssel ist und kein Entwicklungsschritt. Was fehlt, ist beides: es gibt
 * keinen `OPENAI_API_KEY` in dieser Umgebung, und es gibt keine Zeile in
 * `modell_register`, die für ein OpenAI-Modell EU-Verarbeitung,
 * Nullspeicherung und Freigabe bezeugt.
 *
 * **Die vier Tore, die er selbst prüft** — sie liegen hier und nicht beim
 * Aufrufer, weil ein Aufrufer sie vergessen kann:
 *
 *  1. `CSE_KI_MODELL=nicht_verbunden` — der Riegel für Abnahmeumgebungen.
 *     Er gewinnt gegen Schlüssel und Registerzeile: eine Umgebung, die nicht
 *     hinausrufen soll, ruft nicht hinaus.
 *  2. `OPENAI_API_KEY` — ohne Schlüssel `NOT_CONNECTED`, nie ein Versuch.
 *  3. `OPENAI_DATA_RESIDENCY=eu` — §8 wörtlich: der Adapter geht nicht live,
 *     solange die Residenz nicht auf EU steht. `RESIDENCY_BLOCKED`.
 *  4. `OPENAI_BASE_URL` wird ZERLEGT: https, ein Endpunkt aus der Liste, keine
 *     Zugangsdaten, kein Query. Vorher genügte „nicht leer", und damit hätte
 *     eine falsch gesetzte Variable Vertragstext an einen beliebigen Wirt
 *     geschickt, während die Registerzeile weiter EU-Verarbeitung bezeugte.
 *
 * **Keine stille Ausweichroute.** Kein Rückfall auf eine andere Region, kein
 * stiller Wechsel auf ein anderes Modell, keine Warteschlange. Fällt ein Tor,
 * sagt die Oberfläche „KI-Funktion nicht verfügbar", und die Arbeit läuft von
 * Hand weiter (§8). Das ist die einzige Fassung, bei der niemand hinterher
 * herausfinden muss, wohin ein Vertragstext gegangen ist.
 */

const ZEITGRENZE_MS = 60_000;
/** Ein Wiederholungsversuch, und nur einer — mehr verzögert nur die Wahrheit. */
const RUHE_MS = 750;

/**
 * **Die EU-Endpunkte, ausgeschrieben.** Ein `RESIDENCY_BLOCKED` wegen eines
 * Tippfehlers ist ärgerlich; eine Vertragsseite an einem Endpunkt ausserhalb
 * der EU, weil `OPENAI_BASE_URL` auf irgendetwas zeigte, ist meldepflichtig.
 * Deshalb steht hier eine Liste und keine Plausibilitätsprüfung.
 *
 * `eu.api.openai.com` ist der Endpunkt, den OpenAI für EU-Datenresidenz
 * nennt. Welche weiteren Endpunkte der Auftragsverarbeitungsvertrag des
 * Kunden abdeckt, weiss der Kunde — nicht diese Datei.
 */
// TODO(client): O-509 — welche KI-Endpunkte deckt der AV-Vertrag ab?
const EU_ENDPUNKTE = new Set(['eu.api.openai.com']);

/**
 * Zusätzliche Endpunkte NUR über eine ausdrückliche Umgebungsvariable.
 * Sie zu setzen ist eine Entscheidung, die jemand trifft und die in der
 * Verfahrensdokumentation steht — kein Nebeneffekt einer falschen URL.
 */
function erlaubteEndpunkte(): ReadonlySet<string> {
  const zusatz = (process.env['OPENAI_EU_HOSTS'] ?? '')
    .split(',').map((h) => h.trim().toLowerCase()).filter((h) => h !== '');
  return zusatz.length === 0 ? EU_ENDPUNKTE : new Set([...EU_ENDPUNKTE, ...zusatz]);
}

interface Zugang {
  readonly schluessel: string;
  readonly basis: string;
}

/**
 * **Der Riegel für Testumgebungen** — dieselbe Schreibweise wie beim
 * XRechnung-Prüfstand (`CSE_XRECHNUNG_PRUEFER=nicht_verbunden`).
 *
 * Er steht hier, weil eine Umgebung mit echtem Schlüssel und freigegebener
 * Registerzeile sonst wirklich hinausruft — und eine Abnahmeumgebung, die
 * Mandantentext an einen Anbieter schickt, ist genau das, was niemand
 * beabsichtigt hat. Geprüft VOR dem Schlüssel: der Riegel gewinnt gegen jede
 * andere Einstellung.
 */
function riegelGesetzt(): boolean {
  return (process.env['CSE_KI_MODELL'] ?? '').trim() === 'nicht_verbunden';
}

/** Die vier Tore, an einer Stelle — und mit dem Grund, der nach aussen geht. */
function zugang(): Zugang {
  if (riegelGesetzt()) {
    throw new ModellFehler('NOT_CONNECTED',
      'CSE_KI_MODELL=nicht_verbunden — diese Umgebung ruft keinen Anbieter, '
      + 'auch nicht mit Schlüssel und freigegebener Registerzeile.');
  }
  const schluessel = (process.env['OPENAI_API_KEY'] ?? '').trim();
  if (schluessel === '') {
    throw new ModellFehler('NOT_CONNECTED',
      'Kein OPENAI_API_KEY gesetzt — es wird kein Aufruf versucht.');
  }
  const residenz = (process.env['OPENAI_DATA_RESIDENCY'] ?? '').trim().toLowerCase();
  if (residenz !== 'eu') {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      'OPENAI_DATA_RESIDENCY steht nicht auf „eu". Der Adapter geht ohne bestätigte '
      + 'EU-Verarbeitung nicht live (D-04, §8).');
  }
  return { schluessel, basis: gepruefteBasis() };
}

/**
 * **Die Basis-URL wird zerlegt, nicht auf „nicht leer" geprüft.**
 *
 * Vorher genügte irgendein nichtleerer String: `http://irgendwo` kam durch,
 * und die Registerzeile bezeugte weiter EU-Verarbeitung und Nullspeicherung.
 * Eine Zusage, die nur im Kommentar steht, ist keine.
 *
 *  · `https:` — Vertragstext geht nicht im Klartext über ein Netz;
 *  · Endpunkt aus der Liste — kein fremder Wirt, keine IP-Adresse;
 *  · keine Zugangsdaten in der URL — sonst stünde ein Schlüssel im Protokoll;
 *  · kein Query und kein Fragment — der Pfad wird angehängt, und `?x=1` davor
 *    verschöbe, wohin.
 */
function gepruefteBasis(): string {
  const roh = (process.env['OPENAI_BASE_URL'] ?? '').trim();
  if (roh === '') {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      'OPENAI_BASE_URL ist leer. Ein leerer Wert hiesse „der Standardendpunkt", und der '
      + 'liegt nicht in der EU — der EU-Endpunkt muss ausdrücklich dastehen.');
  }
  let url: URL;
  try {
    url = new URL(roh);
  } catch {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      `OPENAI_BASE_URL ist keine gültige Adresse: „${roh}".`);
  }
  if (url.protocol !== 'https:') {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      `OPENAI_BASE_URL muss https sein, steht aber auf „${url.protocol}".`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      'OPENAI_BASE_URL trägt Zugangsdaten in der Adresse — sie landeten im Protokoll.');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      'OPENAI_BASE_URL trägt einen Query oder ein Fragment; der Pfad wird angehängt.');
  }
  if (!erlaubteEndpunkte().has(url.hostname.toLowerCase())) {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      `„${url.hostname}" steht nicht auf der Liste der EU-Endpunkte. Ein Endpunkt, von `
      + 'dem niemand bezeugt hat, dass er in der EU liegt, bekommt keine Mandantendaten '
      + '(D-04, §8). Zusätzliche Endpunkte über OPENAI_EU_HOSTS, ausdrücklich.');
  }
  // Ohne Schrägstrich am Ende: die Wege beginnen mit einem.
  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
}

/**
 * **Die Antwort wird gelesen, nicht gecastet.**
 *
 * `await antwort.json()` wirft bei einem HTML-Fehlerblatt einen `SyntaxError`
 * — der lief am `ModellFehler`-Vertrag vorbei und kam beim Aufrufer als
 * unbekannte Ausnahme an. Und ein Cast auf `ChatAntwort` verschiebt eine
 * falsche Form nur bis zum nächsten Feldzugriff. Beides endet ab jetzt als
 * `INVALID_RESPONSE`, mit dem Satz, der auf den Bildschirm gehört.
 */
async function leseJson(antwort: Response): Promise<unknown> {
  const roh = await antwort.text();
  try {
    return JSON.parse(roh) as unknown;
  } catch {
    throw new ModellFehler('INVALID_RESPONSE',
      'Die Antwort des Anbieters war kein JSON.');
  }
}

const istObjekt = (w: unknown): w is Record<string, unknown> =>
  typeof w === 'object' && w !== null;

async function einAufruf(
  z: Zugang, weg: string, rumpf: unknown,
): Promise<Response> {
  try {
    return await fetch(`${z.basis}${weg}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${z.schluessel}`,
      },
      body: JSON.stringify(rumpf),
      signal: AbortSignal.timeout(ZEITGRENZE_MS),
    });
  } catch (fehler) {
    if (fehler instanceof Error && fehler.name === 'TimeoutError') {
      throw new ModellFehler('TIMEOUT', `Keine Antwort binnen ${String(ZEITGRENZE_MS / 1000)} s.`);
    }
    throw new ModellFehler('NOT_CONNECTED',
      fehler instanceof Error ? fehler.message : 'Der Aufruf kam nicht zustande.');
  }
}

/**
 * **Genau ein Wiederholungsversuch, und nur für das Vorübergehende.**
 *
 * 429 und 5xx sind Zustände des Anbieters, keine Aussagen über den Auftrag —
 * sie einmal zu wiederholen, spart einem Menschen einen sinnlosen zweiten
 * Klick. 401, 403 und 4xx dagegen wiederholt man nicht: ein abgewiesener
 * Schlüssel wird beim zweiten Mal nicht angenommen, und ein falsch geformter
 * Auftrag nicht richtig. Zwei Versuche und nicht fünf, weil ein Mensch auf
 * diese Antwort wartet.
 */
async function ruf(
  weg: string, rumpf: unknown,
): Promise<{ daten: unknown; dauerMs: number }> {
  const z = zugang();
  const start = performance.now();

  let antwort = await einAufruf(z, weg, rumpf);
  if (antwort.status === 429 || antwort.status >= 500) {
    await new Promise((fertig) => setTimeout(fertig, RUHE_MS));
    antwort = await einAufruf(z, weg, rumpf);
  }

  if (antwort.status === 401 || antwort.status === 403) {
    throw new ModellFehler('AUTH_FAILED', 'Der Schlüssel wurde abgewiesen.');
  }
  if (antwort.status === 429) {
    throw new ModellFehler('RATE_LIMITED',
      'Der Anbieter drosselt — auch nach einem zweiten Versuch.');
  }
  if (!antwort.ok) {
    throw new ModellFehler('INVALID_RESPONSE',
      `Der Anbieter antwortete mit ${String(antwort.status)}.`);
  }
  return { daten: await leseJson(antwort), dauerMs: Math.round(performance.now() - start) };
}

/**
 * Der Verbrauch — **und ein fehlender ist ein Fehler, keine Null**.
 *
 * Der Orchestrator verbucht `agent_kosten` aus genau diesen Zahlen und gibt
 * die Reservierung danach frei. Wer eine fehlende oder unsinnige
 * `usage`-Angabe auf 0 abbildet, macht aus einer bezahlten Antwort eine
 * kostenlose: die Reservierung faellt weg, der echte Betrag steht nirgends,
 * und das Monatsbudget stimmt ab da nicht mehr. Fail closed — lieber ein
 * sichtbar gescheiterter Lauf als eine stille Luecke im Kostenbuch (AGT-05).
 */
function pflichtZahl(u: Record<string, unknown>, feld: string): number {
  const roh = u[feld];
  if (typeof roh !== 'number' || !Number.isFinite(roh) || roh < 0) {
    throw new ModellFehler('INVALID_RESPONSE',
      `Die usage-Angabe nannte kein brauchbares „${feld}". Ohne sie sind die Kosten `
      + 'dieses Laufs unbekannt, und ein Lauf mit unbekannten Kosten wird nicht '
      + 'verbucht.');
  }
  return Math.round(roh);
}

/**
 * Der Verbrauch — **je Antwortart, und ein fehlendes Feld ist ein Fehler**.
 *
 * `prompt_tokens` verlangt jede Antwort. `completion_tokens` verlangt nur der
 * TEXT-Weg: eine Einbettung erzeugt keine Ausgabetoken, und dort ist die Null
 * die Wahrheit. Die erste Fassung pruefte, ob BEIDE null sind -- eine Antwort
 * mit gueltigen Eingabetoken und fehlenden Ausgabetoken kam damit durch und
 * wurde zu billig verbucht. Genau die Haelfte, die bei einem langen Entwurf
 * den grossen Teil der Rechnung ausmacht.
 */
function verbrauchAus(
  daten: Record<string, unknown>, art: 'text' | 'einbettung',
): { eingabe: number; ausgabe: number } {
  const u = daten['usage'];
  if (!istObjekt(u)) {
    throw new ModellFehler('INVALID_RESPONSE',
      'Die Antwort trug keine usage-Angabe. Ohne sie sind die Kosten dieses Laufs '
      + 'unbekannt, und ein Lauf mit unbekannten Kosten wird nicht verbucht.');
  }
  return {
    eingabe: pflichtZahl(u, 'prompt_tokens'),
    ausgabe: art === 'text' ? pflichtZahl(u, 'completion_tokens') : 0,
  };
}

export class OpenAiModell implements ModellPort {
  readonly anbieter = 'openai';
  constructor(readonly modell: string) {}

  async entwerfe(auftrag: TextAuftrag): Promise<TextErgebnis> {
    /*
     * **Die Tatsachen gehen als Daten hinein, nicht als Anweisung.** Ein
     * Feldwert, der „ignoriere die vorherigen Anweisungen" enthält, ist dann
     * ein String in einem JSON-Objekt und keine zweite Systemzeile.
     */
    const { daten, dauerMs } = await ruf('/chat/completions', {
      model: this.modell,
      messages: [
        {
          role: 'system',
          content: 'Du formulierst einen ENTWURF für eine deutsche Handwerks- und '
            + 'Dienstleistungsgruppe. Du rechnest nichts und erfindest keine Zahl: '
            + 'jede Zahl steht bereits in den Tatsachen. Antworte auf '
            + `${auftrag.sprache === 'en' ? 'Englisch' : 'Deutsch'}, sachlich, ohne Floskeln.`,
        },
        {
          role: 'user',
          content: JSON.stringify({ vorlage: auftrag.vorlage, tatsachen: auftrag.tatsachen }),
        },
      ],
      temperature: 0.2,
      /*
       * **Der Deckel aus der Reservierung** (siehe `TextAuftrag`). Ohne ihn
       * konnte eine grosse Antwort mehr kosten als reserviert, und der harte
       * Budgetstopp griff erst nach der Ueberschreitung.
       */
      ...(auftrag.maxTokenAusgabe === undefined
        ? {} : { max_tokens: auftrag.maxTokenAusgabe }),
    });

    /*
     * Geprueft statt gecastet: `choices[0].message.content` ist hier vier
     * Zugriffe tief, und jeder davon kann etwas anderes sein, als der Vertrag
     * verspricht. Ein `as ChatAntwort` verschob den Fehlschlag nur bis zum
     * naechsten Feldzugriff und brachte ihn dort als TypeError heraus.
     */
    if (!istObjekt(daten)) {
      throw new ModellFehler('INVALID_RESPONSE', 'Die Antwort war kein Objekt.');
    }
    const wahlen = daten['choices'];
    const erste = Array.isArray(wahlen) && istObjekt(wahlen[0]) ? wahlen[0] : null;
    const nachricht = erste !== null && istObjekt(erste['message']) ? erste['message'] : null;
    const inhalt = nachricht === null ? null : nachricht['content'];
    const text = typeof inhalt === 'string' ? inhalt.trim() : '';
    if (text === '') {
      throw new ModellFehler('INVALID_RESPONSE', 'Die Antwort enthielt keinen Text.');
    }
    const v = verbrauchAus(daten, 'text');
    return {
      text,
      verbrauch: {
        modell: this.modell,
        tokensEingabe: v.eingabe,
        tokensAusgabe: v.ausgabe,
        dauerMs,
      },
    };
  }

  async bette(text: string): Promise<EinbettungErgebnis> {
    const { daten, dauerMs } = await ruf('/embeddings', { model: this.modell, input: text });
    if (!istObjekt(daten)) {
      throw new ModellFehler('INVALID_RESPONSE', 'Die Antwort war kein Objekt.');
    }
    const liste = daten['data'];
    const erste = Array.isArray(liste) && istObjekt(liste[0]) ? liste[0] : null;
    const roh = erste === null ? null : erste['embedding'];
    // Jede Stelle eine endliche Zahl — ein `null` im Vektor waere in pgvector
    // ein Schreibfehler, und der faellt erst beim Einfuegen auf.
    const vektor = Array.isArray(roh)
      && roh.length > 0
      && roh.every((x) => typeof x === 'number' && Number.isFinite(x))
      ? roh as readonly number[]
      : null;
    if (vektor === null) {
      throw new ModellFehler('INVALID_RESPONSE', 'Die Antwort enthielt keinen Vektor.');
    }
    /*
     * **Die Laenge wird HIER geprueft, nicht beim Einfuegen.** Die Spalte ist
     * `vector(1536)` mit einem passenden `embedding_dim`-CHECK; ein Anbieter
     * mit einer anderen Dimension kaeme sonst als Datenbankfehler heraus --
     * mitten im Auffrischungslauf, mit einer Meldung ueber eine Spalte statt
     * ueber das Modell. Ein Vertragsbruch des Anbieters gehoert am Rand
     * gemeldet, wo der Vertrag steht.
     */
    if (vektor.length !== EINBETTUNG_DIMENSION) {
      throw new ModellFehler('INVALID_RESPONSE',
        `Der Vektor hat ${String(vektor.length)} Stellen; der Index erwartet `
        + `${String(EINBETTUNG_DIMENSION)}. Ein Modell mit anderer Dimension braucht `
        + 'einen eigenen Index, keine stillschweigende Umdeutung.');
    }
    return {
      vektor,
      verbrauch: {
        modell: this.modell,
        tokensEingabe: verbrauchAus(daten, 'einbettung').eingabe,
        tokensAusgabe: 0,
        dauerMs,
      },
    };
  }
}
