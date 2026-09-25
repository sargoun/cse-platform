'use client';

import { useEffect, useState } from 'react';

/**
 * Der laufende Zaehler der Stempeluhr — ANZEIGE, nie Grundlage.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Uhr des Geraets zaehlt hier nicht, und das ist der ganze Punkt.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Invariante 5: die Serveruhr ist die Wahrheit. Ein Zaehler, der schlicht
 * `Date.now() - beginn` rechnet, uebernimmt still die Uhr des Telefons — und
 * ein Telefon, das zehn Minuten vorgeht, zeigte dann zehn Minuten mehr
 * Arbeit, als die Abrechnung kennt. Der Mensch glaubt dem Bildschirm vor
 * sich, nicht einer Tabelle am Monatsende.
 *
 * Deshalb kommt mit dem Beginn auch die SERVERZEIT desselben Augenblicks.
 * Einmal beim Laden wird die Differenz zur Geraeteuhr gebildet; danach laeuft
 * der Zaehler lokal weiter, aber von einem Nullpunkt, der vom Server stammt.
 *
 * **Und selbst dann entscheidet er nichts.** Die abgerechnete Dauer entsteht
 * beim Ausstempeln in der Datenbank, aus der Differenz zweier UTC-Instants
 * (Invariante 2). Was hier steht, ist eine Auskunft fuer den Menschen im
 * Treppenhaus — „laeuft seit 3:42" — und kein Beleg.
 *
 * **Ohne JavaScript steht hier die Startzeit.** Die Seite rendert den Wert
 * serverseitig als Text; dieser Baustein ersetzt ihn durch einen Zaehler,
 * sobald er laeuft. Wer kein JavaScript hat, sieht „seit 06:12" — weniger
 * bequem, aber nie falsch. Und der Stempelknopf selbst ist ein gewoehnliches
 * Formular: er braucht diesen Baustein nicht.
 */
export interface LaufzeitProps {
  /** Der Beginn aus `zeiteintrag.beginn_zeitpunkt` — ISO mit Zone. */
  readonly beginnIso: string;
  /** Die Serverzeit im selben Augenblick — der Nullpunkt des Abgleichs. */
  readonly serverIso: string;
  /** Was davorsteht, uebersetzt („Läuft" / „Running" / „جارٍ"). */
  readonly label: string;
}

/** `H:MM:SS` — Stunden ohne fuehrende Null, der Rest zweistellig. */
function alsDauer(sekunden: number): string {
  const s = Math.max(0, Math.floor(sekunden));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${String(h)}:${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function Laufzeit({ beginnIso, serverIso, label }: LaufzeitProps) {
  const beginn = Date.parse(beginnIso);
  const server = Date.parse(serverIso);

  /*
   * Der Versatz zwischen Server- und Geraeteuhr, EINMAL gebildet. Er wird
   * nicht nachgefuehrt: eine Uhr, die waehrend der Schicht springt, ist ein
   * seltener Fall, und ihn zu verfolgen hiesse, den Server jede Minute zu
   * fragen — fuer eine Anzeige.
   */
  const [versatz] = useState(() => server - Date.now());
  const [jetzt, setJetzt] = useState(() => server);

  useEffect(() => {
    const takt = setInterval(() => { setJetzt(Date.now() + versatz); }, 1000);
    return () => { clearInterval(takt); };
  }, [versatz]);

  if (Number.isNaN(beginn) || Number.isNaN(server)) return null;

  return (
    <p data-cse="laufzeit" className="m-0 flex flex-wrap items-baseline gap-s2">
      <span className="text-base text-text-muted">{label}</span>
      <span
        className="cse-zahl text-h1 text-text"
        /* Ein Zaehler, der jede Sekunde vorgelesen wird, ist unbenutzbar. */
        aria-live="off"
        data-cse="laufzeit-wert"
      >
        {alsDauer((jetzt - beginn) / 1000)}
      </span>
    </p>
  );
}
