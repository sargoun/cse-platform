import { type NextRequest, type NextResponse } from 'next/server';
import { RecruitingFehler } from '@/server/services/recruiting/dienst';
import { entwirfStellenanzeige, kiGrund } from '@/server/services/recruiting/stellenentwurf';
import { fuehreRecruitingAus } from '../../gemeinsam';
import { UUID } from '../../../rumpf';
import { leseStellenfelder } from '../felder';

/**
 * `POST /api/recruiting/stellen/entwurf` — den Back-office-Agenten eine
 * Stellenanzeige entwerfen lassen (REC-02, SPEC §17, V-222, D-716).
 *
 * **Zwei Rechte.** `recruiting.stelle_schreiben`, weil am Ende ein
 * Stellenentwurf entsteht, und `agent.aufgabe_starten`, weil dafür ein
 * Agentenlauf beginnt — dieselbe Schranke wie `POST /api/agenten/lauf` und
 * wie `t_mandant` auf `agent_aufgabe` im WITH CHECK.
 *
 * **Das Ergebnis ist ein ENTWURF** (Invariante 7): er erscheint nirgends,
 * bevor ein Mensch ihn bearbeitet, vorgelegt und freigegeben hat. Ohne
 * freigegebenes Modell bleibt die Aufgabe als fehlgeschlagen im
 * Agentenzentrum stehen (§8) und die Seite sagt es — geschrieben ist
 * geschrieben, der Rumpf antwortet danach.
 *
 * **Ein Doppelklick legt keine zweite Stelle an.** Das Formular trägt einen
 * Schlüssel, der Lauf trägt ihn als `idempotenzSchluessel`.
 */
export const dynamic = 'force-dynamic';

function codeVersion(): string {
  return process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['CSE_CODE_VERSION'] ?? 'entwicklung';
}

function zeilen(roh: string | undefined): string[] {
  return (roh ?? '').split('\n').map((z) => z.trim()).filter((z) => z !== '');
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreRecruitingAus(anfrage, {
    recht: 'recruiting.stelle_schreiben',
    weitereRechte: ['agent.aufgabe_starten'],
    handle: async (kontext, rumpf) => {
      const schluessel = (rumpf.felder['schluessel'] ?? '')
        .replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 64);
      if (schluessel === '') {
        throw new RecruitingFehler('Das Formular trug keinen Schlüssel — bitte neu laden.',
          'kein_schluessel', 400);
      }
      const felder = leseStellenfelder(rumpf.felder);
      const objekt = (rumpf.felder['objekt'] ?? '').trim();
      if (objekt !== '' && !UUID.test(objekt)) {
        throw new RecruitingFehler('Dieses Objekt gibt es nicht.', 'kein_bedarf', 400);
      }
      const ergebnis = await entwirfStellenanzeige(kontext, {
        titel: rumpf.felder['titel'] ?? '',
        einsatzort: rumpf.felder['einsatzort'] ?? '',
        beginn: rumpf.felder['beginn'] ?? '',
        aufgaben: zeilen(rumpf.felder['aufgaben']),
        objektId: objekt === '' ? null : objekt,
        anforderungen: felder.anforderungen,
        wochenstunden: felder.wochenstunden,
        bewerbungsfrist: felder.bewerbungsfrist,
      }, { schluessel, codeVersion: codeVersion() });
      if ('gestoert' in ergebnis) {
        return {
          ergebnis: '',
          fehler: {
            grund: kiGrund(ergebnis.gestoert.code),
            meldung: ergebnis.gestoert.nachricht,
            status: 409,
          },
        };
      }
      return ergebnis.stelleId;
    },
    ziel: (slug, id) => `/portal/${slug}/recruiting/stellen/${id}?entworfen=1`,
  });
}
