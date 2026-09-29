import { BCP47, istSprache, VORGABE_SPRACHE } from '../sprache.js';
import { geraeteSprache } from './geraetesprache.js';
import { PORTAL_BCP47, PORTAL_RICHTUNG } from './texte.js';

/**
 * Was am `<html>` steht: `lang` und — wo die Seite es weiss — `dir`
 * (WCAG 3.1.1; D-767, V-257).
 *
 * **Drei Arten von Seiten, drei Quellen.**
 *
 *  1. Die öffentliche Website und alles ohne eigene Sprache: der Pfad
 *     (`/en/…` englisch, sonst deutsch), wie ihn die Middleware als Kopf
 *     setzt (D-82). Das war schon so und bleibt so.
 *  2. Die Flächen der Beschäftigten OHNE Sitzung — die Anmeldung
 *     (`/auth/mitarbeiter`, `/auth/mitarbeiter/code`) und die Stempeluhr
 *     (`/check-in/…`): sie sprechen die Sprache des GERÄTS (D-694), und die
 *     steht in Keks und `Accept-Language`, ohne Datenbank. Bisher sagte nur
 *     ihre Hülle sie an (`AuthSchale`, die Stempeluhr), `<html>` blieb
 *     `de-DE` — und damit der Seitentitel, den ein Screenreader zuerst
 *     vorliest. Jetzt steht dieselbe Sprache auch hier, samt `dir="rtl"` für
 *     Arabisch, damit auch Bildlaufleiste und Seitenrand spiegeln.
 *  3. Das Portal: seine Sprache hängt an der SITZUNG, und die kennt erst die
 *     Pforte der Seite (Datenbank). Das Layout lässt sie deshalb beim Pfad;
 *     angesagt wird sie an der Hülle, die den ganzen Inhalt umschliesst
 *     (`PortalRahmen`, `MeinRahmen`, die Kontoseiten).
 */
export interface HtmlSprache {
  readonly lang: string;
  readonly dir?: 'ltr' | 'rtl';
}

/**
 * Die Seiten, die die Sprache des Geräts sprechen (D-694) — genau diese drei
 * Adressen, keine Präfixe: eine Adresse daneben, die es nicht gibt, zeigt die
 * deutsche 404-Seite und soll nicht als Arabisch angesagt werden.
 * `tests/kern/html-sprache.test.ts` hält die Liste gegen jede Seite, die
 * `geraeteSprache(` ruft.
 */
export const GERAETE_FLAECHEN: readonly RegExp[] = [
  /^\/auth\/mitarbeiter$/u,
  /^\/auth\/mitarbeiter\/code$/u,
  /^\/check-in\/[^/]+$/u,
];

/** Liegt `pfad` (ohne Sprachpräfix) auf einer Fläche mit Gerätesprache? */
export function sprichtGeraetesprache(pfad: string): boolean {
  const ohneAbfrage = pfad.split('?')[0] ?? pfad;
  return GERAETE_FLAECHEN.some((f) => f.test(ohneAbfrage));
}

export function htmlSprache(eingabe: {
  /** Der Pfad ohne Sprachpräfix (`KOPF_PFAD`). */
  readonly pfad: string | null;
  /** Die Sprache des Pfads (`KOPF_SPRACHE`). */
  readonly pfadSprache: string | null;
  /** Der Sprachkeks (`SPRACH_KEKS`). */
  readonly keks: string | null | undefined;
  readonly acceptLanguage: string | null;
}): HtmlSprache {
  if (eingabe.pfad !== null && sprichtGeraetesprache(eingabe.pfad)) {
    const s = geraeteSprache(eingabe.keks, eingabe.acceptLanguage);
    return { lang: PORTAL_BCP47[s], dir: PORTAL_RICHTUNG[s] };
  }
  const roh = eingabe.pfadSprache ?? '';
  return { lang: BCP47[istSprache(roh) ? roh : VORGABE_SPRACHE] };
}
