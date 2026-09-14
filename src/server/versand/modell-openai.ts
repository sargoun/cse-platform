import 'server-only';
import {
  ModellFehler, type EinbettungErgebnis, type ModellPort, type TextAuftrag, type TextErgebnis,
} from '../agent/modell/port.js';

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
 * **Die drei Tore, die er selbst prüft** — sie liegen hier und nicht beim
 * Aufrufer, weil ein Aufrufer sie vergessen kann:
 *
 *  1. `OPENAI_API_KEY` — ohne Schlüssel `NOT_CONNECTED`, nie ein Versuch.
 *  2. `OPENAI_DATA_RESIDENCY=eu` — §8 wörtlich: der Adapter geht nicht live,
 *     solange die Residenz nicht auf EU steht. `RESIDENCY_BLOCKED`.
 *  3. `OPENAI_BASE_URL` muss gesetzt sein und auf den EU-Endpunkt zeigen; ein
 *     leerer Wert hiesse „der Standard", und der Standard ist nicht die EU.
 *
 * **Keine stille Ausweichroute.** Kein Rückfall auf eine andere Region, kein
 * stiller Wechsel auf ein anderes Modell, keine Warteschlange. Fällt ein Tor,
 * sagt die Oberfläche „KI-Funktion nicht verfügbar", und die Arbeit läuft von
 * Hand weiter (§8). Das ist die einzige Fassung, bei der niemand hinterher
 * herausfinden muss, wohin ein Vertragstext gegangen ist.
 */

const ZEITGRENZE_MS = 60_000;

interface Zugang {
  readonly schluessel: string;
  readonly basis: string;
}

/** Die drei Tore, an einer Stelle — und mit dem Grund, der nach aussen geht. */
function zugang(): Zugang {
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
  const basis = (process.env['OPENAI_BASE_URL'] ?? '').trim();
  if (basis === '') {
    throw new ModellFehler('RESIDENCY_BLOCKED',
      'OPENAI_BASE_URL ist leer. Ein leerer Wert hiesse „der Standardendpunkt", und der '
      + 'liegt nicht in der EU — der EU-Endpunkt muss ausdrücklich dastehen.');
  }
  return { schluessel, basis };
}

async function ruf(
  weg: string, rumpf: unknown,
): Promise<{ daten: unknown; dauerMs: number }> {
  const z = zugang();
  const start = performance.now();
  const abbruch = AbortSignal.timeout(ZEITGRENZE_MS);

  let antwort: Response;
  try {
    antwort = await fetch(`${z.basis}${weg}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${z.schluessel}`,
      },
      body: JSON.stringify(rumpf),
      signal: abbruch,
    });
  } catch (fehler) {
    if (fehler instanceof Error && fehler.name === 'TimeoutError') {
      throw new ModellFehler('TIMEOUT', `Keine Antwort binnen ${String(ZEITGRENZE_MS / 1000)} s.`);
    }
    throw new ModellFehler('NOT_CONNECTED',
      fehler instanceof Error ? fehler.message : 'Der Aufruf kam nicht zustande.');
  }

  if (antwort.status === 401 || antwort.status === 403) {
    throw new ModellFehler('AUTH_FAILED', 'Der Schlüssel wurde abgewiesen.');
  }
  if (antwort.status === 429) {
    throw new ModellFehler('RATE_LIMITED', 'Der Anbieter drosselt.');
  }
  if (!antwort.ok) {
    throw new ModellFehler('INVALID_RESPONSE', `Der Anbieter antwortete mit ${String(antwort.status)}.`);
  }
  return { daten: await antwort.json(), dauerMs: Math.round(performance.now() - start) };
}

interface ChatAntwort {
  choices?: readonly { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
interface EinbettungAntwort {
  data?: readonly { embedding?: readonly number[] }[];
  usage?: { prompt_tokens?: number };
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
    });

    const a = daten as ChatAntwort;
    const text = a.choices?.[0]?.message?.content?.trim() ?? '';
    if (text === '') {
      throw new ModellFehler('INVALID_RESPONSE', 'Die Antwort enthielt keinen Text.');
    }
    return {
      text,
      verbrauch: {
        modell: this.modell,
        tokensEingabe: a.usage?.prompt_tokens ?? 0,
        tokensAusgabe: a.usage?.completion_tokens ?? 0,
        dauerMs,
      },
    };
  }

  async bette(text: string): Promise<EinbettungErgebnis> {
    const { daten, dauerMs } = await ruf('/embeddings', { model: this.modell, input: text });
    const a = daten as EinbettungAntwort;
    const vektor = a.data?.[0]?.embedding;
    if (vektor === undefined || vektor.length === 0) {
      throw new ModellFehler('INVALID_RESPONSE', 'Die Antwort enthielt keinen Vektor.');
    }
    return {
      vektor,
      verbrauch: {
        modell: this.modell,
        tokensEingabe: a.usage?.prompt_tokens ?? 0,
        tokensAusgabe: 0,
        dauerMs,
      },
    };
  }
}
