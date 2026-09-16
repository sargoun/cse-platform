import { type NextRequest, type NextResponse } from 'next/server';
import { bewerte, RecruitingFehler } from '@/server/services/recruiting/dienst';
import { fuehreRecruitingAus } from '../../../gemeinsam';
import { UUID } from '../../../../rumpf';

/**
 * `POST /api/recruiting/bewerbungen/[id]/bewertung` — Kriterien festhalten
 * (REC-05, REC-08, LEG-12).
 *
 * **Jedes Kriterium braucht eine Begründung, und das ist keine Formalie.**
 * § 22 AGG kehrt die Beweislast um, sobald Indizien für eine Benachteiligung
 * vorliegen: dann muss die Gesellschaft erklären, warum sie so entschieden
 * hat. „7 von 10" erklärt nichts. Eine Zeile mit Kriterium und ohne Grund
 * wird deshalb abgewiesen — nicht stillschweigend übergangen, denn wer
 * ausfüllt und nichts passiert, füllt beim nächsten Mal weniger aus.
 *
 * **Leere Zeilen sind kein Fehler.** Das Formular bietet fünf an; wer drei
 * braucht, lässt zwei leer. Übergangen wird eine Zeile nur, wenn ALLES leer
 * ist.
 *
 * **Diese Route entscheidet nichts.** Eine Punktzahl ist keine Ablehnung; die
 * trifft ein benannter Mensch auf `…/entscheidung`, und die Datenbank weist
 * jede Entscheidung ab, deren Akteur kein Mensch ist (Art. 22 DSGVO).
 */
export const dynamic = 'force-dynamic';

function zahl(wert: string | undefined): number | null {
  if (wert === undefined || wert.trim() === '') return null;
  const n = Number(wert.trim());
  return Number.isInteger(n) ? n : null;
}

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.bewerbung_bewerten',
    handle: async (kontext, rumpf) => {
      if (!UUID.test(id)) {
        throw new RecruitingFehler('Diese Bewerbung gibt es nicht.', 'nicht_gefunden', 404);
      }
      const namen = rumpf.alle('kriterium');
      const gewichte = rumpf.alle('gewicht');
      const punkte = rumpf.alle('punkte');
      const gruende = rumpf.alle('begruendung');

      const kriterien: {
        kriterium: string; gewicht: number; punkte: number; begruendung: string;
      }[] = [];
      for (const [i, rohName] of namen.entries()) {
        const kriterium = rohName.trim();
        const begruendung = (gruende[i] ?? '').trim();
        const g = zahl(gewichte[i]);
        const p = zahl(punkte[i]);
        /* Ganz leere Zeile: das Formular bietet fünf an, gebraucht werden oft drei. */
        if (kriterium === '' && begruendung === '' && (g ?? 0) === 0 && (p ?? 0) === 0) continue;
        if (kriterium === '') {
          throw new RecruitingFehler(
            'Eine Zeile mit Punkten braucht auch das Kriterium, gegen das geprüft wurde.',
            'unvollstaendig', 400);
        }
        if (begruendung === '') {
          throw new RecruitingFehler(
            `„${kriterium}" hat keine Begründung. Eine Punktzahl ohne Grund ist im `
            + 'AGG-Streit nichts wert — § 22 AGG kehrt die Beweislast um.',
            'ohne_begruendung', 400);
        }
        if (g === null || p === null) {
          throw new RecruitingFehler(
            `„${kriterium}": Gewicht und Punkte müssen ganze Zahlen sein.`,
            'unbrauchbare_bewertung', 400);
        }
        kriterien.push({ kriterium, gewicht: g, punkte: p, begruendung });
      }

      if (kriterien.length === 0) {
        throw new RecruitingFehler(
          'Keine Zeile ausgefüllt. Ohne Kriterium gibt es nichts festzuhalten.',
          'unvollstaendig', 400);
      }
      const n = await bewerte(kontext, id, kriterien);
      return String(n);
    },
    ziel: (slug) => `/portal/${slug}/recruiting/bewerbungen/${id}?bewertet=1`,
  });
}
