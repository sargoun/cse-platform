import { type NextRequest, type NextResponse } from 'next/server';
import {
  RedaktionFehler, legeLeistungsAbschnittAn, setzeLeistungen,
} from '@/server/services/inhalt/redaktion';
import type { LeistungEintrag } from '@/server/services/inhalt/jsonld';
import { UUID, fuehreWebsiteAus } from '../gemeinsam';

/**
 * `POST /api/website/leistungen` — die Leistungen einer Bereichsprofilseite
 * (PRO-02, PUB-07, PUB-11).
 *
 * **Die Einträge kommen als PARALLELE Listen an.** Ein Formular ohne
 * JavaScript kann keine verschachtelte Struktur schicken: es schickt
 * `name` und `beschreibung` je einmal pro Zeile, in DOKUMENTREIHENFOLGE.
 * `rumpf.alle(…)` bewahrt diese Reihenfolge, und die beiden Listen werden hier
 * paarweise zusammengesetzt. Sind sie ungleich lang, ist die Einsendung
 * unlesbar — und wird abgewiesen, statt eine Beschreibung an den falschen
 * Namen zu hängen.
 *
 * **Warum das Entfernen ein eigener Knopf ist und kein leeres Feld.** Die
 * Seite schickt bei „Entfernen" die Zeile mit `weg=<nr>`; der Dienst weist
 * einen leeren Namen ausdrücklich ab. Ein leeres Feld als Löschbefehl zu
 * lesen, wäre die teuerste Bedienung: wer versehentlich einen Namen löscht und
 * speichert, hat die Leistung entfernt und liest „gespeichert".
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreWebsiteAus(anfrage, {
    recht: 'referenz.schreiben',
    handle: async (kontext, rumpf) => {
      const handlung = rumpf.felder['handlung'] ?? '';

      if (handlung === 'anlegen') {
        const seiteId = rumpf.felder['seiteId'] ?? '';
        if (!UUID.test(seiteId)) {
          throw new RedaktionFehler('Diese Seite gibt es hier nicht.', 'nicht_gefunden');
        }
        const name = rumpf.felder['name'] ?? '';
        const beschreibung = (rumpf.felder['beschreibung'] ?? '').trim();
        const neu = await legeLeistungsAbschnittAn(kontext, seiteId, {
          name, ...(beschreibung === '' ? {} : { beschreibung }),
        });
        return `neu=${neu}`;
      }

      if (handlung !== 'setzen') {
        throw new RedaktionFehler(
          'Diese Handlung kennt die Route nicht.', 'unbekannte_handlung');
      }

      const id = rumpf.felder['id'] ?? '';
      if (!UUID.test(id)) {
        throw new RedaktionFehler('Diesen Abschnitt gibt es hier nicht.', 'nicht_gefunden');
      }

      const namen = rumpf.alle('name');
      const beschreibungen = rumpf.alle('beschreibung');
      if (namen.length !== beschreibungen.length) {
        throw new RedaktionFehler(
          'Die Einsendung ist unlesbar: zu jedem Namen gehört genau ein '
          + 'Beschreibungsfeld.', 'eintraege_ungueltig');
      }
      /*
       * `weg` trägt die NUMMER der Zeile, die herausfällt. Der Index ist der
       * einzige Bezug, den ein Formular ohne JavaScript hat: zwei Einträge
       * dürfen denselben Namen nicht tragen (der Dienst weist das ab), aber
       * eine noch nicht gespeicherte Zeile hat gar keinen Schlüssel.
       */
      const weg = new Set(
        rumpf.alle('weg').map((w) => Number.parseInt(w, 10)).filter((n) => !Number.isNaN(n)));

      const eintraege: LeistungEintrag[] = [];
      for (const [i, name] of namen.entries()) {
        if (weg.has(i)) continue;
        const b = (beschreibungen[i] ?? '').trim();
        // Eine ganz leere Zeile ist die Anhäng-Zeile, die niemand ausgefüllt
        // hat — sie ist kein Eintrag und kein Fehler.
        if (name.trim() === '' && b === '') continue;
        eintraege.push({ name, ...(b === '' ? {} : { beschreibung: b }) });
      }

      await setzeLeistungen(kontext, id, eintraege);
      return 'gespeichert=1';
    },
  });
}
