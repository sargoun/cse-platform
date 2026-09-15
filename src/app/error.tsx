'use client';

import { useEffect } from 'react';
import { Zustandsseite, ZustandKnopf } from '@/components/ui/Zustandsseite';
import { Button } from '@/components/ui/Button';

/**
 * Die Fehlerseite (DESIGN §5 „Status pages").
 *
 * **`'use client'` ist hier keine Wahl.** Next.js verlangt fuer `error.tsx`
 * eine Client-Komponente: sie bekommt `reset()`, und eine Server-Komponente
 * kann keinen Zustand zuruecksetzen.
 *
 * **Auf dem Bildschirm steht der `digest` und sonst nichts vom Fehler.**
 * Eine Fehlermeldung aus dem Server kann einen Tabellennamen, ein SQL-Fragment
 * oder den Inhalt einer Zeile tragen — alles davon gehoert ins Protokoll, nicht
 * auf einen Bildschirm, den irgendwer sieht. Der `digest` ist die
 * Zeichenkette, die genau diesen Bildschirm mit genau dieser Protokollzeile
 * verbindet; er verraet nichts und macht eine Nachfrage beantwortbar.
 */
export default function Fehlerseite(
  { fehler, reset }: { fehler: Error & { digest?: string }; reset: () => void },
) {
  useEffect(() => {
    // Der Browser sieht die Ursache nie; die Konsole des Servers hat sie schon.
    console.error('[fehlerseite]', fehler);
  }, [fehler]);

  return (
    <Zustandsseite
      cse="seite-fehler"
      code="Fehler"
      titel="Da ist etwas schiefgegangen."
      erklaerung={
        <>
          <p>
            Nicht bei Ihnen — hier. Der Vorgang wurde abgebrochen, bevor etwas
            gespeichert wurde; was Sie vorher eingetragen hatten, ist nicht verloren
            gegangen, sondern nie angekommen.
          </p>
          {fehler.digest === undefined ? null : (
            <p className="mt-s3 text-sm text-text-subtle">
              Kennung für die Nachfrage:{' '}
              <code data-cse="fehler-digest" className="font-mono">{fehler.digest}</code>
            </p>
          )}
        </>
      }
      aktionen={
        <>
          <Button variante="primary" onClick={() => { reset(); }} data-cse="erneut-versuchen">
            Erneut versuchen
          </Button>
          <ZustandKnopf href="/" cse="zu-start">Zur Startseite</ZustandKnopf>
        </>
      }
    />
  );
}
