/**
 * Die Sprache der Flächen OHNE Sitzung — Stempeluhr und Anmeldung der
 * Beschäftigten (EMP-12, SEITENKARTE §12, V-200, D-694).
 *
 * **Warum nicht `person.sprache`.** Im Portal gilt die Sprache des Menschen
 * (D-09); sie steht in seiner Zeile, und die Sitzung sagt, wessen Zeile es
 * ist. Vor der Anmeldung gibt es keine Sitzung. Und die Stempeluhr unter
 * `/check-in/[token]` löst ihre Marke vor dem Antippen absichtlich NICHT auf
 * (AUT-06): eine Seite, die für eine gültige Marke Arabisch und für eine
 * ungültige Deutsch zeigte, beantwortete jedem Durchprobierenden die Frage,
 * die er stellt. Die Sprache dieser Flächen hängt deshalb am GERÄT.
 *
 * **Die Reihenfolge**: der Sprachkeks (gesetzt von der Sprachwahl auf diesen
 * Flächen und beim Speichern der Sprache im Profil), dann `Accept-Language`
 * — die Sprache, auf die das Telefon eingestellt ist —, dann Deutsch.
 *
 * Diese Datei ist rein: sie liest keinen Keks und keinen Kopf selbst. Die
 * Seiten reichen beides herein; so lässt sich die Regel ohne Next prüfen
 * (`tests/kern/geraetesprache.test.ts`).
 */
import { istPortalSprache, type PortalSprache } from './texte.js';

/** Der Name des Kekses — ein Wert aus vier, kein Personenbezug. */
export const SPRACH_KEKS = 'cse_sprache';

/** Ein Jahr: eine Spracheinstellung ist keine Sitzung. */
export const SPRACH_KEKS_SEKUNDEN = 365 * 24 * 60 * 60;

interface Angebot {
  readonly tag: string;
  readonly gewicht: number;
  readonly stelle: number;
}

/**
 * Die erste der vier Portalsprachen, die der Browser nennt — nach Gewicht.
 *
 * `Accept-Language: tr-TR,tr;q=0.9,en;q=0.8` ergibt `tr`; `ar-EG` ergibt `ar`;
 * `fr-FR,en;q=0.5` ergibt `en`; `*` und `q=0` zählen nicht. Bei gleichem
 * Gewicht gewinnt, was zuerst steht (RFC 9110 §12.5.4).
 */
export function spracheAusKopf(kopf: string | null | undefined): PortalSprache | null {
  if (typeof kopf !== 'string' || kopf.trim() === '') return null;
  const angebote: Angebot[] = [];
  kopf.split(',').forEach((teil, stelle) => {
    const [roh = '', ...parameter] = teil.split(';');
    const tag = roh.trim().toLowerCase();
    if (tag === '' || tag === '*') return;
    const q = parameter.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const gewicht = q === undefined ? 1 : Number(q.slice(2));
    if (!Number.isFinite(gewicht) || gewicht <= 0) return;
    angebote.push({ tag, gewicht, stelle });
  });
  angebote.sort((a, b) => b.gewicht - a.gewicht || a.stelle - b.stelle);
  for (const a of angebote) {
    const haupt = a.tag.split('-')[0] ?? '';
    if (istPortalSprache(haupt)) return haupt;
  }
  return null;
}

/** Keks, dann `Accept-Language`, dann Deutsch. */
export function geraeteSprache(
  keks: string | null | undefined, kopf: string | null | undefined,
): PortalSprache {
  if (typeof keks === 'string' && istPortalSprache(keks)) return keks;
  return spracheAusKopf(kopf) ?? 'de';
}

/** Die Vorlagenfunktion steht ohne Einfuhr in `vorlage.ts` — die Stempeluhr braucht sie im Browser. */
export { setzeEin } from './vorlage.js';
