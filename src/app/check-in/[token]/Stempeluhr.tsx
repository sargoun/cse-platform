'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Die Stempelflaeche (TIM-07, TIM-08, DESIGN §8).
 *
 * Sie ist die einzige Flaeche der Plattform mit einer harten koerperlichen
 * Bedingung: **ein Bildschirm, ein Hauptknopf, kein Scrollen, mit Handschuhen
 * und einer Hand bedienbar.** Deshalb ist es EINE Route mit Zustaenden und
 * kein Ablauf ueber mehrere Seiten — eine zweite Seite ist eine zweite
 * Gelegenheit, jemanden um 05:55 im Treppenhaus zu verlieren.
 *
 * **Die Uhr, die hier steht, ist die des SERVERS** (Invariante 5, TIM-08). Das
 * Geraet schickt seine eigene mit, sie wird gespeichert und ihre Abweichung
 * festgehalten — angezeigt wird sie nie als Stempelzeit. Wer die Gerauetezeit
 * anzeigte, machte eine verstellte Telefonuhr zur Auskunft ueber die
 * Arbeitszeit.
 *
 * **Kein Ort wird erhoben**, solange O-06 offen ist: der Aufruf von
 * `navigator.geolocation` steht hier nicht, das Feld fehlt im Rumpf, und die
 * Datenbank verwirft einen Punkt zusaetzlich (LEG-10, §9.5). Das ist die
 * Zusage aus dem Abnahmekriterium — nirgends erhoben, nirgends gespeichert.
 * // TODO(client, O-06): Gibt es einen Betriebsrat? § 87 Abs. 1 Nr. 6 BetrVG
 * entscheidet, ob LEG-10 ueberhaupt ausgeliefert wird — und die Frage betrifft
 * neben der Geolokalisierung auch Geraetekennung, Geraeteabweichung,
 * Korrekturstatistik und Nicht-erschienen-Auswertung.
 */

/** Berliner Wanduhr — mit `timeZone`, nie mit der Zone des Geraets. */
const UHR = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  dateStyle: 'short',
  timeStyle: 'short',
});

type Zustand =
  | { readonly art: 'bereit' }
  | { readonly art: 'sendet' }
  | { readonly art: 'bestaetigt'; readonly zeit: string; readonly objekt: string | null;
      readonly ausgestempelt: boolean }
  | { readonly art: 'abgelehnt'; readonly meldung: string };

export function Stempeluhr({ token }: { readonly token: string }) {
  const [zustand, setzeZustand] = useState<Zustand>({ art: 'bereit' });

  const stemple = async (): Promise<void> => {
    setzeZustand({ art: 'sendet' });
    try {
      const antwort = await fetch(`/api/check-in/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Die Geraetezeit reist mit, damit die Abweichung festgehalten werden
        // kann (Invariante 5) — sie wird nie zur Stempelzeit.
        body: JSON.stringify({ geraetezeit: new Date().toISOString() }),
      });
      const daten = (await antwort.json()) as {
        ergebnis?: string; objekt?: string | null; server_zeit?: string;
        error?: { message?: string };
      };
      if (!antwort.ok) {
        setzeZustand({
          art: 'abgelehnt',
          meldung: daten.error?.message ?? 'Dieser Link ist nicht gültig.',
        });
        return;
      }
      setzeZustand({
        art: 'bestaetigt',
        zeit: UHR.format(new Date(daten.server_zeit ?? Date.now())),
        objekt: daten.objekt ?? null,
        ausgestempelt: daten.ergebnis === 'ausgecheckt',
      });
    } catch {
      // Netz weg. Kein Fehlerbildschirm, der nach „kaputt" aussieht: die
      // Warteschlange kommt mit PR 35, bis dahin ist die ehrliche Auskunft,
      // es noch einmal zu versuchen.
      setzeZustand({
        art: 'abgelehnt',
        meldung: 'Keine Verbindung. Bitte noch einmal versuchen.',
      });
    }
  };

  if (zustand.art === 'bestaetigt') {
    return (
      <div className="flex flex-col items-center gap-s4 text-center" aria-live="polite">
        <p className="text-2xl font-semibold text-text">
          {zustand.ausgestempelt ? 'Ausgestempelt' : 'Eingestempelt'}
        </p>
        <p className="text-lg text-text">{zustand.zeit}</p>
        {zustand.objekt !== null && (
          <p className="text-base text-text-muted">{zustand.objekt}</p>
        )}
        <p className="text-sm text-text-subtle">
          Erfasst mit der Uhr des Servers, angezeigt in Berliner Zeit.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-s5 text-center">
      {/* Ein Hauptknopf, 44 px hoch (DESIGN §5, §8) — hier ueber die volle
          Breite, weil eine Hand mit Handschuh nicht zielt. */}
      <Button
        variante="primary"
        className="w-full text-lg"
        onClick={() => { void stemple(); }}
        disabled={zustand.art === 'sendet'}
      >
        {zustand.art === 'sendet' ? 'Wird gesendet …' : 'Einstempeln'}
      </Button>
      <p className="min-h-6 text-base text-danger-strong" aria-live="assertive">
        {zustand.art === 'abgelehnt' ? zustand.meldung : ''}
      </p>
    </div>
  );
}
