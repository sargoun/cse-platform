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
/**
 * **Der Name der Eigenschaft gehoert dem Rahmenwerk, nicht dieser Datei.**
 *
 * Hier stand `{ fehler, reset }`. Next.js reicht aber `error` herein — `fehler`
 * war damit `undefined`, und die erste Zeile, die `fehler.digest` liest, warf
 * erneut. **Die Fehlerseite selbst stuerzte ab**, also sah niemand je diesen
 * Bildschirm: jeder Serverfehler endete auf der nackten Ersatzseite des
 * Rahmenwerks, ohne Kennung, ohne den Satz, ohne den Knopf.
 *
 * Genau die Sorte Fehler, die im Betrieb nie auffaellt: wer sie erlebt, hat
 * ohnehin schon einen Fehler — und haelt den zweiten fuer den ersten. Die
 * uebrige Datei benennt weiter deutsch (`fehler`); umbenannt wird nur an der
 * Naht zum Rahmenwerk, und genau dort steht auch warum.
 */
export default function Fehlerseite(
  { error: fehler, reset }: { error: Error & { digest?: string }; reset: () => void },
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
          {/*
            * **Kein Versprechen ueber die Daten.**
            *
            * Hier stand „der Vorgang wurde abgebrochen, bevor etwas gespeichert
            * wurde". Das kann diese Seite nicht wissen: eine Fehlergrenze faengt
            * auch einen Fehler, der NACH einem festgeschriebenen Schritt
            * auftritt, und sie gilt fuer die ganze Anwendung. Wer den Satz
            * liest und daraufhin noch einmal absendet, loest den Vorgang
            * moeglicherweise ein zweites Mal aus — bei einer Rechnung oder
            * einem Zeiteintrag ist das teurer als die Unsicherheit.
            */}
          <p>
            Nicht bei Ihnen — hier. Ob der Vorgang noch durchgelaufen ist, sagt
            dieser Bildschirm bewusst nicht: bitte laden Sie die Seite neu und
            sehen Sie nach, bevor Sie ihn wiederholen.
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
