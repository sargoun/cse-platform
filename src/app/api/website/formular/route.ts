import { type NextRequest, type NextResponse } from 'next/server';
import { RedaktionFehler } from '@/server/services/inhalt/redaktion';
import {
  aendereFormularKopf, legeNeueVersionAn, setzeZustaendigkeit,
  veroeffentlicheFormular, verweigereDienstkonto, zieheFormularZurueck,
} from '@/server/services/inhalt/formular';
import { UUID, fuehreWebsiteAus, leerZuNull, zahlOderNull } from '../gemeinsam';

/**
 * `POST /api/website/formular` — Kopf, Zuständigkeit und Zustand einer
 * Formularversion (REQ-01 … REQ-04).
 *
 * **Fünf Handlungen, EIN Recht.** `formular.schreiben` deckt alle:
 * `t_formular_schreiben` und die `with check` von `t_zustaendigkeit` verlangen
 * genau das. Ein zweites Recht für das Veröffentlichen wäre hier keine
 * Trennung, sondern eine Erfindung — anders als bei `seite`, wo
 * `referenz.veroeffentlichen` im Katalog steht.
 *
 * **Veröffentlichen ist die Handlung eines Menschen und keine Freigabe.** Ein
 * Anfrageformular ist der Auftritt der Gesellschaft über sich selbst; es geht
 * an niemanden HINAUS (Invariante 7 zielt auf E-Mails, Angebote, Beiträge,
 * Bewerbungen). Was hinausgeht, ist die Antwort auf eine Einsendung — und die
 * läuft über `server/agent/policy.ts`.
 *
 * **Die Feldliste steht NICHT unter diesen Handlungen.** Sie ist in einer
 * veröffentlichten Version eingefroren (`kern.formular_definition_unveraenderlich`),
 * und ihre englische Fassung lebt im Code (`lib/i18n/formular-en.ts`, O-680) —
 * ein hier angelegtes Feld stünde auf `/en/angebot` deutsch da.
 */
export const dynamic = 'force-dynamic';

const HANDLUNGEN = [
  'kopf', 'zustaendigkeit', 'veroeffentlichen', 'zurueckziehen', 'neue_version',
] as const;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreWebsiteAus(anfrage, {
    recht: 'formular.schreiben',
    handle: async (kontext, rumpf) => {
      const handlung = rumpf.felder['handlung'] ?? '';
      const id = rumpf.felder['id'] ?? '';
      if (!(HANDLUNGEN as readonly string[]).includes(handlung)) {
        throw new RedaktionFehler(
          'Diese Handlung kennt die Route nicht.', 'unbekannte_handlung');
      }
      if (!UUID.test(id)) {
        throw new RedaktionFehler('Diese Formularversion gibt es hier nicht.', 'nicht_gefunden');
      }
      /*
       * **Vor jeder Handlung, nicht nur vor dem Veröffentlichen.**
       * `formular.schreiben` hält auch der zum Internet offene
       * Annahmeprinzipal `formular_eingang` — ein `ist_dienstkonto`, das
       * Einsendungen speichern soll und nicht das öffentliche Formular ändern
       * (03-AUTH §14.3, O-682). Bis zu dieser Route gab es im Portal keinen
       * Schreibweg auf `formular_definition`; er darf ihn nicht mitbringen.
       */
      await verweigereDienstkonto(kontext);

      switch (handlung) {
        case 'kopf':
          await aendereFormularKopf(kontext, id, {
            titel: rumpf.felder['titel'] ?? '',
            beschreibung: leerZuNull(rumpf.felder['beschreibung']),
          });
          return 'gespeichert=kopf';

        case 'zustaendigkeit':
          await setzeZustaendigkeit(kontext, id, {
            besitzerId: UUID.test(rumpf.felder['besitzer'] ?? '')
              ? (rumpf.felder['besitzer'] as string) : null,
            eskalationId: UUID.test(rumpf.felder['eskalation'] ?? '')
              ? (rumpf.felder['eskalation'] as string) : null,
            slaStunden: zahlOderNull(rumpf.felder['slaStunden']),
          });
          return 'gespeichert=zustaendigkeit';

        case 'veroeffentlichen': {
          const { zurueckgezogeneVersion } = await veroeffentlicheFormular(kontext, id);
          /*
           * Die zweite Wirkung reist als Zahl zurück und nicht als Satz: die
           * Seite bildet den Schlüssel auf ihren Text ab. Wer den Satz aus der
           * Adresszeile nehmen liesse, könnte jemandem einen Link schicken,
           * auf dem im eigenen Portal ein fremder Text steht.
           */
          return zurueckgezogeneVersion === null
            ? 'gespeichert=live'
            : `gespeichert=live&abgeloest=${String(zurueckgezogeneVersion)}`;
        }

        case 'zurueckziehen':
          await zieheFormularZurueck(kontext, id);
          return 'gespeichert=zurueckgezogen';

        default: {
          const neu = await legeNeueVersionAn(kontext, id);
          return `neu=${neu.id}&version=${String(neu.version)}`
            + (neu.zustaendigkeitKopiert ? '' : '&ohne_zustaendigkeit=1');
        }
      }
    },
  });
}
