import { type NextRequest, type NextResponse } from 'next/server';
import { legeStelleAn, RecruitingFehler } from '@/server/services/recruiting/dienst';
import { istKalendertag } from '@/server/services/zeit/dauer';
import { fuehreRecruitingAus } from '../gemeinsam';

/**
 * `POST /api/recruiting/stellen` — einen Stellenentwurf anlegen (REC-02,
 * Invariante 7).
 *
 * **Sie entsteht IMMER als Entwurf.** Es gibt keinen Parameter, der sie
 * freigegeben oder veröffentlicht anlegt — ein solcher wäre der kürzeste Weg
 * an der Freigabe vorbei. Die Datenbank hält dieselbe Regel unabhängig
 * (`stelle_freigegeben_hat_freigabe`, 0166): ohne Freigabe-Kennung gibt es
 * den Status gar nicht.
 *
 * **Anforderungen kommen zeilenweise herein.** Das Formular schickt einen
 * Textblock; hier wird er an den Zeilenumbrüchen getrennt und leergeräumt.
 * Der Grund steht in 0166: die Bewertung läuft später GEGEN diese Zeilen
 * (REC-05), und ein Fliesstext liesse sich nicht als Kriterium ausweisen.
 */
export const dynamic = 'force-dynamic';

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
 * derselben Funktion, die auch die Zeiterfassung fragt (`zeit/dauer.ts`,
 * gegen beide Umstellungsnächte geprüft) — eine zweite Fassung hier wäre eine
 * zweite Wahrheit über denselben Kalender.
 */
function frist(roh: string): { jahr: number; monat: number; tag: number } | null {
  const t = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(roh);
  if (t === null) return null;
  const jahr = Number(t[1]);
  const monat = Number(t[2]);
  const tag = Number(t[3]);
  return istKalendertag(jahr, monat, tag) ? { jahr, monat, tag } : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.stelle_schreiben',
    handle: async (kontext, rumpf) => {
      const titel = (rumpf.felder['titel'] ?? '').trim();
      const beschreibung = (rumpf.felder['beschreibung'] ?? '').trim();
      if (titel === '' || beschreibung === '') {
        throw new RecruitingFehler(
          'Eine Stelle braucht einen Titel und eine Beschreibung. Ein leerer Entwurf '
          + 'sähe in der Liste aus wie eine fertige Anzeige.',
          'unvollstaendig', 400);
      }

      const anforderungen = (rumpf.felder['anforderungen'] ?? '')
        .split('\n')
        .map((z) => z.trim())
        .filter((z) => z !== '');

      const stundenRoh = (rumpf.felder['wochenstunden'] ?? '').trim();
      const stunden = stundenRoh === '' ? null : Number(stundenRoh.replace(',', '.'));
      if (stundenRoh !== ''
          && (!STUNDEN.test(stundenRoh) || stunden === null || stunden < 1 || stunden > 60)) {
        throw new RecruitingFehler(
          'Wochenstunden zwischen 1 und 60, in halben Stunden.',
          'unbrauchbare_stunden', 400);
      }
      const fristRoh = (rumpf.felder['bewerbungsfrist'] ?? '').trim();
      if (fristRoh !== '' && frist(fristRoh) === null) {
        throw new RecruitingFehler(
          'Die Bewerbungsfrist ist kein Tag, den der Kalender kennt.',
          'unbrauchbare_frist', 400);
      }
      const einsatzort = (rumpf.felder['einsatzort'] ?? '').trim();

      return legeStelleAn(kontext, {
        titel,
        beschreibung,
        anforderungen,
        ...(einsatzort === '' ? {} : { einsatzort }),
        ...(stunden === null ? {} : { wochenstunden: stunden }),
        ...(fristRoh === '' ? {} : { bewerbungsfrist: fristRoh }),
      });
    },
    ziel: (slug, id) => `/portal/${slug}/recruiting/stellen/${id}?angelegt=1`,
  });
}
