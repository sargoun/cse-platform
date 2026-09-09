import type { NextConfig } from 'next';

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
  webpack: (konfiguration) => {
    konfiguration.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return konfiguration;
  },
};

export default config;
