import 'server-only';

/**
 * Der Weg zwischen dem Enum `agent_kennung` und dem Stück URL.
 *
 * Vier Werte, beide Richtungen, EINE Stelle. Die Seitenkarte (§5.19) legt die
 * Schreibweise fest: `ceo-assistent` mit Bindestrich, die drei anderen wie das
 * Enum. Ein `replace('_', '-')` täte hier fast dasselbe und wäre genau deshalb
 * gefährlich — es erfände die Regel neu, statt sie zu lesen, und beim fünften
 * Agenten stünde sie an zwei Stellen verschieden da.
 */
export const AGENT_KENNUNGEN = [
  'ceo_assistent', 'akquise', 'backoffice', 'finanzen',
] as const;

export type AgentKennung = (typeof AGENT_KENNUNGEN)[number];

const SLUG: Readonly<Record<AgentKennung, string>> = {
  ceo_assistent: 'ceo-assistent',
  akquise: 'akquise',
  backoffice: 'backoffice',
  finanzen: 'finanzen',
};

export function slugFuer(kennung: string): string {
  return SLUG[kennung as AgentKennung] ?? kennung;
}

/** `undefined` für alles, was kein Agent ist — der Aufrufer macht daraus 404. */
export function kennungFuer(slug: string): AgentKennung | undefined {
  return AGENT_KENNUNGEN.find((k) => SLUG[k] === slug);
}
