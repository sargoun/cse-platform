import type { NextConfig } from 'next';
import { weiterleitungenMitSprachen } from './src/lib/weiterleitungen';
import { MARKENBILD_KOEPFE, SICHERHEITSKOEPFE } from './src/lib/sicherheitskoepfe';

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // D-04: serverless functions run in Frankfurt. Recorded here as well as in
  // the Vercel project so a reviewer can see the intent in the repository.
  env: { VERCEL_REGION: process.env['VERCEL_REGION'] ?? 'fra1' },

  /**
   * `./x.js` in einer `.ts`-Datei zeigt auf `./x.ts`.
   *
   * Das Projekt schreibt relative Importe mit `.js`, weil Node unter ESM eine
   * Endung verlangt — `tsx` und Vitest laufen so ohne Bundler. Webpack loest
   * das von sich aus NICHT auf und meldet stattdessen "Module not found" fuer
   * eine Datei, die es gibt.
   *
   * Die Alternative waere gewesen, in jeder Datei, die je in den Next-Graphen
   * geraet, die Endung wegzulassen — also die Konvention davon abhaengig zu
   * machen, wer eine Datei zufaellig importiert. Diese eine Zeile ist die
   * kleinere Kopplung.
   */
  /**
   * Die 301er aus EINER Tabelle (PUB-08).
   *
   * `WEITERLEITUNGEN` stand bisher nur in einer Datei und wurde von einem Test
   * gelesen — keine Anfrage sah sie je. Eine Liste, die nichts bewirkt, ist
   * schlechter als keine: sie sieht aus, als waere die Sache erledigt.
   *
   * `permanent: true` ist ein 308 und nicht ein 301. Der Unterschied ist die
   * Methode: ein 301 erlaubt einem Client, ein POST in ein GET zu verwandeln,
   * ein 308 verbietet es. Fuer Suchmaschinen zaehlen beide gleich — die
   * Autoritaet geht ueber —, und keine dieser Adressen nimmt je ein POST
   * entgegen. Die strengere ist damit die richtige.
   */
  redirects: () => Promise.resolve(
    weiterleitungenMitSprachen().map(({ quelle, ziel }) => ({
      source: quelle, destination: ziel, permanent: true,
    })),
  ),

  /**
   * SEC-A7 — die Sicherheitskoepfe auf JEDER Antwort.
   *
   * Es gab keine: weder HSTS noch `X-Frame-Options` noch `nosniff`, obwohl
   * SPEC §20 sie als SEC-A7 fuehrt und `ursprung.ts` sich auf HSTS beruft.
   * Die Werte stehen in `src/lib/sicherheitskoepfe.ts`, damit ein Test sie
   * lesen kann, ohne diese Konfiguration zu laden (D-416).
   */
  headers: () => Promise.resolve([
    { source: '/(.*)', headers: [...SICHERHEITSKOEPFE] },
    /* V-100: die strengere Richtlinie der Markenbilder — NACH der allgemeinen, damit sie gewinnt. */
    { source: '/api/marke/:pfad*', headers: [...MARKENBILD_KOEPFE] },
  ]),

  /**
   * Das Telefon im selben WLAN darf den Entwicklungsserver aufrufen.
   *
   * **Warum das eine Zeile Konfiguration braucht.** Seit Next 15.3 weist
   * `next dev` Anfragen nach internen Entwicklungsressourcen ab, wenn ihr
   * Ursprung nicht hier steht — eine Gegenmassnahme gegen Seiten, die den
   * Entwicklungsserver eines Fremden im Hintergrund ausfragen. Die Folge auf
   * dem Telefon ist aber kein Hinweis, sondern eine Seite, die einfach nicht
   * kommt: `http://192.168.x.y:3001` laedt nichts und sagt nicht, warum.
   *
   * Und genau dieses Gerät ist der Prüfstand. Die Stempelfläche, der
   * QR-Zugang, die Tab-Leiste bei 375px, die vier Sprachen des
   * Mitarbeiterportals — das sind Telefonflächen. Sie am Schreibtisch zu
   * beurteilen heisst, sie nicht zu beurteilen.
   *
   * Aufgeführt sind die drei privaten Bereiche aus RFC 1918, also genau das
   * Heim- oder Büronetz, in dem Rechner und Telefon ohnehin nebeneinander
   * stehen. Das Feld gilt AUSSCHLIESSLICH für `next dev`; ein
   * Produktionsbau kennt es nicht und wird davon nicht berührt.
   */
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*', '172.17.*.*', '172.18.*.*', '172.19.*.*',
    '172.2*.*.*', '172.30.*.*', '172.31.*.*',
  ],

  webpack: (konfiguration) => {
    konfiguration.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return konfiguration;
  },
};

export default config;
