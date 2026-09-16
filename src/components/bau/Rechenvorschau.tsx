'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Das **lebende Feld** des Aufmaßformulars (BAU-02).
 *
 * **Warum es diese Datei überhaupt gibt.** `POST /api/bau/aufmasse/vorschau`
 * stand seit BAU-02 im Baum, mit einem Kommentar, der genau dieses Feld
 * beschreibt: „der Polier tippt `3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)` und
 * sieht daneben `30,87 m²`". Gerufen hat die Route niemand — im ganzen
 * Quelltext gab es keinen Aufrufer. Route gebaut, geprüft, bewacht; das Feld
 * daneben fehlte. Dieselbe Sorte Lücke wie D-563 (Wächter ohne Auslöser) und
 * D-574 (Dienst ohne Knopf), und gefunden hat sie derselbe Blick: nicht auf
 * die Teile, sondern auf die Verdrahtung.
 *
 * **Gerechnet wird auf dem SERVER, auch hier.** Die naheliegende Fassung —
 * im Browser rechnen, weil es schneller aussieht — hätte zwei Parser, und der
 * zweite wäre der, den niemand prüft. Dann zeigt das Formular eine Zahl und
 * die Datenbank speichert eine andere, und beide sehen richtig aus. Genau
 * deshalb liegt `versucheRechenansatz` hinter einer Route und nicht in einer
 * `.client.ts`.
 *
 * **Die Vorschau ist eine Auskunft, kein Zwang.** Sie blockiert das Absenden
 * nicht: der Server rechnet beim Speichern ohnehin noch einmal, und ein Feld,
 * das den Absendeknopf sperrt, weil ein Netzhüpfer die Vorschau verschluckt
 * hat, ist schlimmer als eines, das schweigt. Ohne Antwort steht hier nichts —
 * kein „0,00 m²", das nach einem Ergebnis aussieht.
 */

interface Antwort {
  readonly gueltig?: unknown;
  readonly formatiert?: unknown;
  readonly meldung?: unknown;
}

export interface RechenvorschauProps {
  /** Der Feldname der Formel — dieselbe Zeile, dasselbe `name`. */
  readonly name: string;
  readonly einheitName: string;
  readonly platzhalter?: string;
  readonly cse?: string;
}

/** Wie lange nach dem letzten Tastendruck gewartet wird. */
const RUHE_MS = 400;

export function Rechenvorschau(
  { name, einheitName, platzhalter, cse }: RechenvorschauProps,
) {
  const feldId = useId();
  const [ansatz, setAnsatz] = useState('');
  const [einheit, setEinheit] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  /**
   * **Die Nummer der Anfrage, damit eine langsame Antwort keine schnelle
   * überholt.**
   *
   * Wer schnell tippt, hat drei Anfragen unterwegs; kommt die erste zuletzt
   * zurück, stünde im Feld das Ergebnis einer Formel, die es nicht mehr gibt.
   * `AbortController` allein genügt dafür nicht — abgebrochen wird das Netz,
   * nicht der schon laufende `then`.
   */
  const lauf = useRef(0);

  useEffect(() => {
    const roh = ansatz.trim();
    if (roh === '') { setText(null); setFehler(null); return undefined; }

    const meine = lauf.current + 1;
    lauf.current = meine;
    const abbruch = new AbortController();
    const uhr = setTimeout(() => {
      void (async () => {
        try {
          const antwort = await fetch('/api/bau/aufmasse/vorschau', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rechenansatz: roh, einheit }),
            signal: abbruch.signal,
          });
          if (lauf.current !== meine) return;
          if (!antwort.ok) { setText(null); setFehler(null); return; }
          const d = (await antwort.json()) as Antwort;
          if (lauf.current !== meine) return;
          if (d.gueltig === true && typeof d.formatiert === 'string') {
            setText(d.formatiert);
            setFehler(null);
          } else {
            setText(null);
            setFehler(typeof d.meldung === 'string' ? d.meldung : null);
          }
        } catch {
          /*
           * Ein Netzfehler ist hier KEIN Formularfehler. Die Vorschau
           * schweigt; gerechnet wird beim Speichern ohnehin auf dem Server.
           */
          if (lauf.current === meine) { setText(null); setFehler(null); }
        }
      })();
    }, RUHE_MS);

    return () => { clearTimeout(uhr); abbruch.abort(); };
  }, [ansatz, einheit]);

  return (
    <>
      <div className="flex flex-col gap-s2">
        <input
          id={feldId}
          name={name}
          value={ansatz}
          onChange={(e) => { setAnsatz(e.target.value); }}
          placeholder={platzhalter ?? '3 × (4,20 × 2,75)'}
          aria-describedby={`${feldId}-ergebnis`}
          className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 font-mono text-sm text-text"
          data-cse={cse ?? 'zeile-rechenansatz'}
        />
        {/*
          * `aria-live="polite"`: das Ergebnis ändert sich beim Tippen, und
          * eine Vorlesehilfe soll es MITBEKOMMEN, ohne den Menschen mitten im
          * Wort zu unterbrechen (BFSG, DESIGN §9).
          */}
        <p
          id={`${feldId}-ergebnis`}
          aria-live="polite"
          data-cse="rechenvorschau"
          className={`m-0 min-h-[1.25rem] text-xs tabular-nums ${
            fehler === null ? 'text-text-muted' : 'text-warning'}`}
        >
          {text ?? fehler ?? ''}
        </p>
      </div>
      <input
        name={einheitName}
        value={einheit}
        onChange={(e) => { setEinheit(e.target.value); }}
        placeholder="m²"
        className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
        data-cse="zeile-einheit"
      />
    </>
  );
}
