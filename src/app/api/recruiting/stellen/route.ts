import { type NextRequest, type NextResponse } from 'next/server';
import { legeStelleAn, RecruitingFehler } from '@/server/services/recruiting/dienst';
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

/** `1` bis `60` mit höchstens einer Nachkommastelle — mehr ergibt keine Woche. */
const STUNDEN = /^(?:[1-9]|[1-5][0-9]|60)(?:[.,][05])?$/u;
const DATUM = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;

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
      if (stundenRoh !== '' && !STUNDEN.test(stundenRoh)) {
        throw new RecruitingFehler(
          'Wochenstunden zwischen 1 und 60, in halben Stunden.',
          'unbrauchbare_stunden', 400);
      }
      const fristRoh = (rumpf.felder['bewerbungsfrist'] ?? '').trim();
      if (fristRoh !== '' && !DATUM.test(fristRoh)) {
        throw new RecruitingFehler('Die Bewerbungsfrist ist kein Datum.', 'unbrauchbare_frist', 400);
      }
      const einsatzort = (rumpf.felder['einsatzort'] ?? '').trim();

      return legeStelleAn(kontext, {
        titel,
        beschreibung,
        anforderungen,
        ...(einsatzort === '' ? {} : { einsatzort }),
        ...(stundenRoh === '' ? {} : { wochenstunden: Number(stundenRoh.replace(',', '.')) }),
        ...(fristRoh === '' ? {} : { bewerbungsfrist: fristRoh }),
      });
    },
    ziel: (slug, id) => `/portal/${slug}/recruiting/stellen/${id}?angelegt=1`,
  });
}
