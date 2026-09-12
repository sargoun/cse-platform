import type { Metadata } from 'next';
import { Stempeluhr } from './Stempeluhr';

/**
 * `/check-in/[token]` — die tokenisierte Stempelflaeche (TIM-07, TIM-08).
 *
 * **Diese Seite liest die Marke NICHT.** Der naheliegende Entwurf haette hier
 * Objekt, Schichtfenster und Namen aufgeloest und angezeigt — und waere damit
 * ein Orakel gewesen: eine Seite, die fuer eine gueltige Marke „Objekt
 * Musterstrasse 3, 22:00–06:00" zeigt und fuer eine ungueltige nichts,
 * beantwortet jedem Durchprobierenden genau die Frage, die er stellt (AUT-06,
 * §9.2). Sie braeuchte ausserdem eine sechste Zeile im GESCHLOSSENEN
 * K-08-Register (§9.1) — und dieses Register in einem PR zu erweitern, der es
 * nicht muss, ist der Anfang davon, dass es keins mehr ist.
 *
 * Also: ein Knopf. Was passiert ist, sagt die Antwort auf das Antippen —
 * Serverzeit, Objekt, Gesellschaft. Bis dahin verraet die Adresse nichts.
 *
 * `noindex` und `robots.txt` halten `/check-in/` ohnehin aus jedem Index
 * (04-SEITENKARTE §11): eine Marke in einem Suchindex waere eine
 * veroeffentlichte Inhaberberechtigung.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Einstempeln',
  robots: { index: false, follow: false },
};

export default async function CheckinSeite(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return (
    /**
     * `min-h-dvh` statt `min-h-screen`: auf dem Telefon zaehlt die
     * SICHTBARE Hoehe, und `100vh` liegt unter der eingeblendeten
     * Browserleiste — der Knopf saesse dann unter der Kante, und die Zusage
     * „kein Scrollen" waere genau dort gebrochen, wo sie zaehlt.
     */
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-s6 px-s5 py-s6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-text">Zeiterfassung</h1>
        <p className="mt-s2 text-base text-text-muted">
          Ein Tipp genügt. Die Zeit kommt vom Server.
        </p>
      </header>
      <Stempeluhr token={token} />
    </main>
  );
}
