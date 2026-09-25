import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import { istKalendertag } from '@/server/services/zeit/dauer';

/**
 * Die Felder eines Stellenformulars lesen — EINMAL, für die drei Wege, die
 * sie schicken: von Hand anlegen (`api/recruiting/stellen`), vom Agenten
 * entwerfen lassen (`…/entwurf`) und einen Entwurf bearbeiten (`…/[id]`)
 * (REC-02, V-222).
 *
 * Bis V-222 standen Muster und Kalenderprüfung in der Route des Anlegens;
 * zwei weitere Wege mit eigener Fassung wären zwei weitere Wahrheiten über
 * dieselbe halbe Stunde gewesen.
 */

/**
 * `1` bis `60` in halben Stunden.
 *
 * Die erste Fassung war `(?:[1-9]|[1-5][0-9]|60)(?:[.,][05])?` — und liess
 * damit `60,5` durch, also mehr als die eigene Obergrenze. Ein Muster, das
 * seine Grenze um eine halbe Stunde verfehlt, ist schlimmer als keines: es
 * sieht nach einer Prüfung aus. Die `60` steht deshalb ohne Nachkommastelle
 * da, und die Zahl wird unten zusätzlich verglichen.
 */
const STUNDEN = /^(?:(?:[1-9]|[1-5][0-9])(?:[.,][05])?|60)$/u;

/**
 * **Die Form eines Datums ist nicht sein Vorhandensein.**
 *
 * Hier stand nur `/^\d{4}-\d{2}-\d{2}$/`. `2026-02-30` hat diese Form —
 * PostgreSQL hat den Tag nicht, weist `$7::date` ab, und aus einem
 * Formularfehler wurde ein **500**. Geprüft wird deshalb der KALENDER, mit
 * derselben Funktion, die auch die Zeiterfassung fragt (`zeit/dauer.ts`).
 */
function istTag(roh: string): boolean {
  const t = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(roh);
  return t !== null && istKalendertag(Number(t[1]), Number(t[2]), Number(t[3]));
}

export interface Stellenfelder {
  readonly titel: string;
  readonly beschreibung: string;
  readonly anforderungen: readonly string[];
  readonly einsatzort: string | null;
  readonly wochenstunden: number | null;
  readonly bewerbungsfrist: string | null;
}

/**
 * **Anforderungen kommen zeilenweise herein.** Das Formular schickt einen
 * Textblock; hier wird er an den Zeilenumbrüchen getrennt und leergeräumt.
 * Die Bewertung läuft später GEGEN diese Zeilen (REC-05), und ein Fliesstext
 * liesse sich nicht als Kriterium ausweisen.
 */
export function leseStellenfelder(felder: Readonly<Record<string, string>>): Stellenfelder {
  const anforderungen = (felder['anforderungen'] ?? '')
    .split('\n')
    .map((z) => z.trim())
    .filter((z) => z !== '');

  const stundenRoh = (felder['wochenstunden'] ?? '').trim();
  const stunden = stundenRoh === '' ? null : Number(stundenRoh.replace(',', '.'));
  if (stundenRoh !== ''
      && (!STUNDEN.test(stundenRoh) || stunden === null || stunden < 1 || stunden > 60)) {
    throw new RecruitingFehler(
      'Wochenstunden zwischen 1 und 60, in halben Stunden.',
      'unbrauchbare_stunden', 400);
  }
  const fristRoh = (felder['bewerbungsfrist'] ?? '').trim();
  if (fristRoh !== '' && !istTag(fristRoh)) {
    throw new RecruitingFehler(
      'Die Bewerbungsfrist ist kein Tag, den der Kalender kennt.',
      'unbrauchbare_frist', 400);
  }
  const einsatzort = (felder['einsatzort'] ?? '').trim();
  return {
    titel: (felder['titel'] ?? '').trim(),
    beschreibung: (felder['beschreibung'] ?? '').trim(),
    anforderungen,
    einsatzort: einsatzort === '' ? null : einsatzort,
    wochenstunden: stunden,
    bewerbungsfrist: fristRoh === '' ? null : fristRoh,
  };
}
