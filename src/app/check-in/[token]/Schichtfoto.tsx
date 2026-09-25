'use client';

import { useRef, useState } from 'react';
import { fotoMeldung, type StempelTexte } from '@/lib/i18n/vor-anmeldung';
import { neueId } from './warteschlange';

/**
 * Das Foto von der Schicht (TIM-10, DOC-06).
 *
 * **Warum es diese Datei überhaupt gibt.** `POST /api/check-in/[token]/medien`
 * stand seit TIM-10 im Baum — mit Magic-Bytes-Prüfung, EXIF-Entfernung,
 * privatem Bucket und dem Aufräumen des Objekts, wenn die Zeile scheitert. Im
 * ganzen Quelltext rief die Route niemand. Die Stempelfläche hatte keinen
 * Aufnahmeknopf; TIM-10 war gebaut und unerreichbar, wie D-563 die Wächter
 * und D-574 den Gesprächstermin.
 *
 * **Die Fläche bleibt ein Bildschirm** (DESIGN §8). Der Knopf erscheint erst
 * NACH dem Stempeln, unter der Bestätigung, und er ist sekundär: die
 * Stempelfläche hat genau einen Hauptknopf, und das bleibt so. Wer um 05:55
 * mit Handschuhen im Treppenhaus steht, soll nicht zwischen zwei gleich
 * grossen Knöpfen wählen.
 *
 * **Die Zusage steht auf dem Bildschirm, nicht nur im Datenschutztext.** Die
 * Route antwortet `exif_entfernt: true`, und genau das wird angezeigt: ein
 * Foto vom Bau trägt sonst die Koordinaten des Objekts, und LEG-10 ist offen
 * (O-06). Wer aufnimmt, soll lesen, dass der Ort nicht mitgeht.
 *
 * **Ohne Netz gibt es hier KEINE Warteschlange.** Der Stempel wird gemerkt,
 * weil eine Uhrzeit klein ist und zählt; ein Video von 80 MB im
 * `localStorage` wäre der sichere Weg, den Speicher des Geräts zu sprengen
 * und den Stempel gleich mit zu verlieren. Der Fehlschlag sagt das — statt
 * „gespeichert" zu behaupten.
 */

/** Was die Route annimmt (`pruefeMedienGroesse`, services/zeit/medien.ts). */
const MAX_BYTES = 104_857_600;

type Zustand =
  | { readonly art: 'bereit' }
  | { readonly art: 'sendet' }
  | { readonly art: 'fertig'; readonly exifEntfernt: boolean }
  | { readonly art: 'fehler'; readonly meldung: string };

interface Antwort {
  readonly exif_entfernt?: unknown;
  readonly error?: { readonly code?: unknown };
}

/** Die erlaubte Grösse in MB — für den Satz, nicht für die Prüfung. */
const MAX_MB = MAX_BYTES / 1_048_576;

export function Schichtfoto(
  { token, texte }: { readonly token: string; readonly texte: StempelTexte },
) {
  const [zustand, setzeZustand] = useState<Zustand>({ art: 'bereit' });
  const feld = useRef<HTMLInputElement | null>(null);

  const sende = async (datei: File): Promise<void> => {
    if (datei.size > MAX_BYTES) {
      setzeZustand({ art: 'fehler', meldung: fotoMeldung(texte, 'zu_gross', MAX_MB) });
      return;
    }
    setzeZustand({ art: 'sendet' });

    const rumpf = new FormData();
    rumpf.append('datei', datei);
    /*
     * **Die Kennung entsteht auf dem GERÄT** — dieselbe Doppelerkennung wie
     * bei der Warteschlange: wer bei wackligem Netz zweimal absendet, legt
     * nicht zwei Aufnahmen ab.
     */
    rumpf.append('client_ereignis_id', neueId());
    rumpf.append('aufgenommen_am', new Date().toISOString());

    try {
      /*
       * Die Adresse steht in DERSELBEN Zeile wie `fetch(`, so wie in
       * `warteschlange.ts`: die Ein-Ausgang-Wache (Invariante 7) erkennt den
       * Ruf an die EIGENE API daran, dass das erste Argument mit `/` beginnt —
       * ein Umbruch dazwischen macht aus dem erlaubten Ruf einen Verstoss.
       *
       * **Kein `content-type` von Hand.** Bei `FormData` setzt ihn der Browser
       * samt `boundary`; ein eigener Kopf ohne Grenze macht den Rumpf
       * unlesbar, und die Route antwortete mit „keine Datei".
       */
      const antwort = await fetch(`/api/check-in/${encodeURIComponent(token)}/medien`, {
        method: 'POST',
        body: rumpf,
      });
      const daten = (await antwort.json().catch(() => ({}))) as Antwort;
      if (!antwort.ok) {
        /* Der Satz aus dem CODE, in der Sprache des Geräts (V-200) — die
           `message` der Route ist deutsch. */
        setzeZustand({
          art: 'fehler', meldung: fotoMeldung(texte, daten.error?.code, MAX_MB),
        });
        return;
      }
      setzeZustand({ art: 'fertig', exifEntfernt: daten.exif_entfernt === true });
    } catch {
      /*
       * Kein Netz. Es wird NICHTS gemerkt und nichts behauptet — siehe oben.
       */
      setzeZustand({ art: 'fehler', meldung: texte.fotoKeineVerbindung });
    } finally {
      if (feld.current !== null) feld.current.value = '';
    }
  };

  if (zustand.art === 'fertig') {
    return (
      <p className="m-0 text-base text-text-muted" aria-live="polite" data-cse="foto-fertig">
        {zustand.exifEntfernt ? `${texte.fotoFertig} ${texte.fotoOhneOrt}` : `${texte.fotoFertig}.`}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-s2">
      {/*
        * `<label>` statt Knopf: ein `<input type="file">` lässt sich nicht
        * beschriften wie ein Knopf, und ein Knopf, der ein verstecktes Feld
        * anklickt, verliert die Tastaturbedienung. Die Beschriftung IST die
        * Fläche — 44 px hoch, wie jede Bedienfläche (DESIGN §5).
        */}
      <label
        className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center
                   rounded-md border border-line-strong px-s5 text-base text-text
                   hover:bg-surface-2"
        data-cse="foto-aufnehmen"
      >
        {zustand.art === 'sendet' ? texte.fotoSendet : texte.fotoAufnehmen}
        <input
          ref={feld}
          type="file"
          accept="image/*,video/*"
          /* `environment`: die Kamera hinten, nicht die Selbstaufnahme. */
          capture="environment"
          className="sr-only"
          disabled={zustand.art === 'sendet'}
          onChange={(e) => {
            const d = e.target.files?.[0];
            if (d !== undefined) void sende(d);
          }}
        />
      </label>
      <p className="m-0 min-h-6 text-base text-text-subtle" aria-live="polite">
        {zustand.art === 'fehler' ? zustand.meldung : texte.fotoHinweis}
      </p>
    </div>
  );
}
