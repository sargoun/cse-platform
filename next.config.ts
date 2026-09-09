import type { NextConfig } from 'next';
import { weiterleitungenMitSprachen } from './src/lib/weiterleitungen';

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

  webpack: (konfiguration) => {
    konfiguration.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return konfiguration;
  },
};

export default config;
