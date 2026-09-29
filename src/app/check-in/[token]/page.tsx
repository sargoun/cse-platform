import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { GeraeteSprachwahl } from '@/components/sprache/GeraeteSprachwahl';
import { geraeteSprache, SPRACH_KEKS } from '@/lib/i18n/geraetesprache';
import { PORTAL_BCP47, PORTAL_RICHTUNG, type PortalSprache } from '@/lib/i18n/texte';
import { STEMPEL_TEXTE } from '@/lib/i18n/vor-anmeldung';
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
 * **Und deshalb kommt die Sprache vom GERÄT, nicht aus der Marke** (V-200,
 * D-694, EMP-12). SEITENKARTE §12 zählt diese Fläche zu den vier Sprachen —
 * und bis hierhin war sie fest deutsch. `person.sprache` über die Marke zu
 * lesen, hiesse, die Marke vor dem Antippen aufzulösen: eine Seite, die für
 * eine gültige Marke Arabisch zeigt und für eine ungültige Deutsch, ist
 * dasselbe Orakel wie oben. Gelesen wird deshalb der Sprachkeks (gesetzt von
 * der Wahl unten und beim Speichern der Sprache im Profil), dann
 * `Accept-Language`, dann Deutsch — und die Uhrzeit bleibt in jeder Sprache
 * die Berliner Zeit in deutscher Form (SEITENKARTE §12).
 *
 * `noindex` und `robots.txt` halten `/check-in/` ohnehin aus jedem Index
 * (04-SEITENKARTE §11): eine Marke in einem Suchindex waere eine
 * veroeffentlichte Inhaberberechtigung.
 */
export const dynamic = 'force-dynamic';

async function spracheDesGeraets(): Promise<PortalSprache> {
  const keks = (await cookies()).get(SPRACH_KEKS)?.value;
  return geraeteSprache(keks, (await headers()).get('accept-language'));
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: STEMPEL_TEXTE[await spracheDesGeraets()].seitentitel,
    robots: { index: false, follow: false },
  };
}

export default async function CheckinSeite(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const sprache = await spracheDesGeraets();
  const t = STEMPEL_TEXTE[sprache];
  return (
    /**
     * `min-h-dvh` statt `min-h-screen`: auf dem Telefon zaehlt die
     * SICHTBARE Hoehe, und `100vh` liegt unter der eingeblendeten
     * Browserleiste — der Knopf saesse dann unter der Kante, und die Zusage
     * „kein Scrollen" waere genau dort gebrochen, wo sie zaehlt.
     *
     * `lang` und `dir` am Inhalt (WCAG 3.1.2): Arabisch läuft von rechts, und
     * ein Screenreader liest den Text in seiner Sprache.
     */
    <main lang={PORTAL_BCP47[sprache]} dir={PORTAL_RICHTUNG[sprache]}
          data-cse="checkin" data-sprache={sprache}
          className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-s6 px-s5 py-s6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold text-text">{t.titel}</h1>
        <p className="mt-s2 text-base text-text-muted">{t.untertitel}</p>
      </header>
      <Stempeluhr token={token} texte={t} />
      {/*
        * Die Wahl steht UNTER dem Knopf: wer die Seite lesen kann, braucht sie
        * nicht, und der Knopf bleibt das Erste, was die Hand trifft. Verweise,
        * keine Knöpfe — diese Fläche hat genau einen (DESIGN §8).
        */}
      <GeraeteSprachwahl aktiv={sprache} label={t.sprachwahl}
                         zurueck={`/check-in/${encodeURIComponent(token)}`} />
    </main>
  );
}
