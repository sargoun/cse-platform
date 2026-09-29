/**
 * Das Agentenblatt ohne Lauf sagt, was ist — und behauptet nichts über den
 * Modellzugang (V-271).
 *
 * **Der Befund.** Ohne Aufgabe stand da: „Dieser Agent hat noch nichts getan.
 * Solange kein Modellzugang eingerichtet ist, bleibt das so — die Laufzeit
 * steht, der Anbieterzugang fehlt." Seit V-229 wird jede Katalogfrage an den
 * CEO-Assistenten eine Aufgabe, ganz ohne Modell; der Seed stellt eine Frage
 * nur in der Reinigung. In Security, Bau und Operations widerlegte ein Klick
 * auf eine Frage den Satz sofort. Die Schwesterstelle in der Schrittkette hat
 * V-231 schon gestrichen.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ohneLaufSatz } from '../../src/app/portal/[mandant]/agenten/darstellung.js';
import { AGENTEN } from '../../src/server/agent/tools/register-werkzeuge.js';

describe('ohneLaufSatz — sagt, was ist', () => {
  it('kein Agent nennt einen fehlenden Modell- oder Anbieterzugang als Grund', () => {
    for (const kennung of AGENTEN) {
      const satz = ohneLaufSatz(kennung);
      expect(satz, kennung).toContain('noch keine Aufgabe');
      expect(satz, kennung).not.toMatch(/Modellzugang|Anbieterzugang|bleibt das so/u);
    }
  });

  it('der CEO-Assistent sagt, wie bei ihm eine Aufgabe entsteht: durch eine Frage, ohne Modell', () => {
    expect(ohneLaufSatz('ceo_assistent')).toMatch(/Jede Frage an den CEO-Assistenten wird eine/u);
    expect(ohneLaufSatz('akquise')).not.toMatch(/Frage/u);
  });
});

describe('das Blatt benutzt ihn', () => {
  const seite = readFileSync('src/app/portal/[mandant]/agenten/[agent]/page.tsx', 'utf8');

  it('der alte Satz steht nicht mehr da', () => {
    expect(seite).toContain('{ohneLaufSatz(kopf.kennung)}');
    expect(seite).not.toMatch(/Solange kein Modellzugang/u);
  });

  it('der Weg zu den Fragen steht nur unter dem Recht der Assistentenseite (AUT-06)', () => {
    expect(seite).toMatch(
      /darf\['agent\.aufgabe_starten'\] === true \? \([\s\S]{0,200}data-cse="agent-zu-den-fragen"/u);
  });
});
