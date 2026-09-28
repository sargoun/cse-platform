'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { stempelMeldung, type StempelTexte } from '@/lib/i18n/vor-anmeldung';
import { setzeEin } from '@/lib/i18n/vorlage';
import { lies, sende, stelleAn } from './warteschlange';
import { Schichtfoto } from './Schichtfoto';

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
 *
 * **Die Wörter kommen als Eigenschaft** (V-200, EMP-12): die Seite liest die
 * Sprache des Geräts und reicht die passenden Texte herein. Die Uhrzeit bleibt
 * in jeder Sprache `TT.MM.JJ HH:MM` in Berliner Zeit — dieselbe Form wie im
 * Monatsnachweis (SEITENKARTE §12).
 */

/** Berliner Wanduhr — mit `timeZone`, nie mit der Zone des Geraets; in JEDER Sprache deutsch (§12). */
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
  /**
   * Kein Netz: der Vorgang liegt in der Warteschlange und wird nachgereicht.
   *
   * Das ist BEWUSST kein Erfolg und bewusst kein Fehler. „Gespeichert" waere
   * gelogen — es entsteht kein Zeiteintrag, bis ein Mensch entschieden hat
   * (§9.4) —, „kaputt" waere es auch: die Zeit ist festgehalten. Also die
   * dritte, ehrliche Auskunft.
   */
  | { readonly art: 'gemerkt'; readonly zeit: string; readonly offen: number }
  | { readonly art: 'abgelehnt'; readonly meldung: string };

export function Stempeluhr(
  { token, texte }: { readonly token: string; readonly texte: StempelTexte },
) {
  const [zustand, setzeZustand] = useState<Zustand>({ art: 'bereit' });
  const [offen, setzeOffen] = useState(0);

  /**
   * Beim Laden und bei jeder wiedergewonnenen Verbindung leeren.
   *
   * `online` allein genuegt nicht: der Browser meldet es auch fuer ein WLAN
   * ohne Weg nach draussen. Deshalb ZUSAETZLICH beim Aufbau der Seite — und
   * das ist zugleich die Zusage aus dem Abnahmekriterium, dass die Schlange
   * einen Neustart uebersteht: sie wird beim naechsten Oeffnen der Adresse
   * gesendet, nicht nur beim naechsten Antippen.
   */
  const leere = useCallback(() => {
    void sende(token)
      .then((e) => { setzeOffen(e.verblieben); })
      .catch(() => { setzeOffen(lies().length); });
  }, [token]);

  useEffect(() => {
    setzeOffen(lies().length);
    leere();
    globalThis.addEventListener('online', leere);
    return () => { globalThis.removeEventListener('online', leere); };
  }, [leere]);

  const stemple = async (): Promise<void> => {
    setzeZustand({ art: 'sendet' });
    const getipptAm = new Date();
    /**
     * **Nur ein Fehlschlag der UEBERTRAGUNG gehoert in die Warteschlange.**
     *
     * Der `fetch`-Aufruf und das Lesen der Antwort standen bis hierhin in
     * EINEM `try`. Damit landete auch ein Stempel in der Schlange, auf den der
     * Server geantwortet hatte — ein 500 mit HTML-Rumpf genuegt, damit
     * `antwort.json()` wirft. Die Marke war dann womoeglich verbraucht und der
     * `zeiteintrag` geschrieben, und die Nachreichung legte daneben einen
     * zweiten Anspruch auf dieselbe Stunde. Doppelt erfasste Zeit ist doppelt
     * abgerechnete Zeit (FIN-07) und ein doppelter § 17-Nachweis — genau das,
     * wogegen K-09 gebaut ist.
     *
     * Ab der Antwort gibt es deshalb kein Merken mehr: hat der Server
     * gesprochen, entscheidet er.
     */
    let antwort: Response;
    try {
      antwort = await fetch(`/api/check-in/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Die Geraetezeit reist mit, damit die Abweichung festgehalten werden
        // kann (Invariante 5) — sie wird nie zur Stempelzeit.
        body: JSON.stringify({ geraetezeit: getipptAm.toISOString() }),
      });
    } catch {
      /**
       * Netz weg — und genau dafuer ist die Warteschlange da (TIM-09).
       *
       * Gemerkt wird der Zeitpunkt des ANTIPPENS, nicht der des spaeteren
       * Sendens: die Kraft hat um 05:55 getippt, und das ist die Behauptung,
       * ueber die die Planung entscheidet. Wer stattdessen die Sendezeit
       * mitschickte, verschoebe jede Nachtschicht auf den Moment, in dem das
       * Telefon wieder Empfang hatte — und zwar plausibel und unauffaellig.
       *
       * **`unbekannt`, nicht `checkin`.** Ob dieses Antippen ein Beginn oder
       * ein Ende ist, entscheidet der ZWECK DER MARKE auf dem Server — der
       * Online-Pfad weiter oben liest es ja auch erst an der Antwort ab
       * (`ergebnis === 'ausgecheckt'`). Diese Flaeche hat einen
       * Knopf und loest die Marke absichtlich nicht auf (AUT-06); sie KANN
       * die Richtung nicht wissen. Bis hierhin stand trotzdem `checkin` da:
       * ein im Funkloch getipptes SchichtENDE reiste damit als SchichtBEGINN
       * zur Planung, und niemand sah einen Fehler — nur einen falschen
       * Beginn. Eine geratene Richtung ist genau die stille Falschaussage,
       * gegen die Invariante 5 geschrieben ist. Die Datenbank setzt beim
       * Nachreichen ein, was in der Marke steht (0090); loest keine Marke
       * auf, bleibt `unbekannt` stehen, und ein Mensch entscheidet.
       */
      const eintrag = stelleAn('unbekannt', getipptAm, token);
      setzeZustand({
        art: 'gemerkt',
        zeit: UHR.format(new Date(eintrag.behaupteteZeit)),
        offen: lies().length,
      });
      setzeOffen(lies().length);
      leere();
      return;
    }

    /**
     * Ein unlesbarer Rumpf ist hier KEIN Netzfehler mehr, sondern eine
     * Ablehnung ohne Grund — dieselbe Auskunft, die jede andere Ablehnung
     * bekommt (AUT-06). Was der Server getan hat, wiederholt diese Flaeche
     * nicht auf eigene Faust.
     */
    const daten = (await antwort.json().catch(() => ({}))) as {
      ergebnis?: string; objekt?: string | null; server_zeit?: string;
      error?: { code?: string };
    };
    if (!antwort.ok) {
      /*
       * Der Satz kommt aus dem CODE, nicht aus der `message` des Servers — die
       * ist deutsch und stand hier auch auf einem arabischen Bildschirm
       * (V-200). Jede Ablehnung ausser dem fehlenden Zugang ergibt denselben
       * Satz (AUT-06).
       */
      setzeZustand({ art: 'abgelehnt', meldung: stempelMeldung(texte, daten.error?.code) });
      return;
    }
    setzeZustand({
      art: 'bestaetigt',
      zeit: UHR.format(new Date(daten.server_zeit ?? Date.now())),
      objekt: daten.objekt ?? null,
      ausgestempelt: daten.ergebnis === 'ausgecheckt',
    });
  };

  if (zustand.art === 'bestaetigt') {
    return (
      <div className="flex flex-col items-center gap-s4 text-center" aria-live="polite">
        <p className="text-2xl font-semibold text-text">
          {zustand.ausgestempelt ? texte.ausgestempelt : texte.eingestempelt}
        </p>
        <p className="text-lg text-text">{zustand.zeit}</p>
        {zustand.objekt !== null && (
          <p className="text-base text-text-muted">{zustand.objekt}</p>
        )}
        <p className="text-base text-text-subtle">{texte.serverUhr}</p>
        {/*
          * **Das Foto steht HIER und nirgendwo sonst** (TIM-10, DOC-06).
          *
          * Erst nach dem Stempeln, unter der Bestaetigung, und sekundaer: die
          * Stempelflaeche hat genau EINEN Hauptknopf (DESIGN §8), und wer um
          * 05:55 mit Handschuhen davorsteht, soll nicht zwischen zwei gleich
          * grossen waehlen. Vorher gab es die Aufnahme gar nicht — die Route
          * `…/medien` war gebaut, geprueft und ohne Aufrufer.
          */}
        <Schichtfoto token={token} texte={texte} />
      </div>
    );
  }

  /**
   * Der ehrliche Zwischenzustand: festgehalten, aber noch nicht erfasst.
   *
   * Er sagt ausdruecklich, dass die Zeit erst nach einer Pruefung im Nachweis
   * steht. Der naheliegende Entwurf zeigte hier „Eingestempelt" mit einem
   * kleinen Wolkensymbol — und damit glaubte die Kraft, ihre Stunde sei
   * gezaehlt, waehrend sie in einer Warteschlange auf einen Menschen wartet.
   */
  if (zustand.art === 'gemerkt') {
    return (
      <div className="flex flex-col items-center gap-s4 text-center" aria-live="polite">
        <p className="text-2xl font-semibold text-text">{texte.gemerkt}</p>
        <p className="text-lg text-text">{zustand.zeit}</p>
        <p className="text-base text-text-muted">{texte.gemerktText}</p>
        <p className="text-base text-text-subtle">
          {zustand.offen === 1
            ? texte.wartetEiner
            : setzeEin(texte.wartenMehrere, { anzahl: String(zustand.offen) })}
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
        {zustand.art === 'sendet' ? texte.sendet : texte.einstempeln}
      </Button>
      <p className="min-h-6 text-base text-danger-strong" aria-live="assertive">
        {zustand.art === 'abgelehnt' ? zustand.meldung : ''}
      </p>
      {offen > 0 && (
        <p className="text-base text-text-subtle" aria-live="polite">
          {offen === 1
            ? texte.uebertragungEiner
            : setzeEin(texte.uebertragungMehrere, { anzahl: String(offen) })}
        </p>
      )}
    </div>
  );
}
