import { type NextRequest, type NextResponse } from 'next/server';
import {
  RedaktionFehler, aendereReferenz, erfasseKundenfreigabe, slugVorschlag,
} from '@/server/services/inhalt/redaktion';
import { UUID, fuehreWebsiteAus, leerZuNull, zahlOderNull } from '../gemeinsam';

/**
 * `POST /api/website/referenz` — die Felder und die Kundenfreigabe EINER
 * Referenz (PRO-05).
 *
 * **Zwei Rechte, UND-verknüpft, und das ist keine Doppelung.** Die Route und
 * die Seite tragen `referenz.schreiben` (Manifest, Seitenkarte); die Policy
 * `t_referenz_pflege` verlangt in ihrer `with check` aber
 * `referenz.kundenfreigabe_erfassen` — für JEDEN Schreibvorgang auf dieser
 * Tabelle, nicht nur für das Häkchen. Die beiden Mengen sind heute
 * verschieden: `referenz.schreiben` halten `admin` und `super_admin`,
 * `referenz.kundenfreigabe_erfassen` zusätzlich `leitung`. Wer nur das erste
 * hält, sähe Formulare, die nichts ändern; wer nur das zweite hält, käme gar
 * nicht auf die Seite. Deshalb wird das zweite hier ausdrücklich geprüft und
 * mit einem Satz abgewiesen, statt in der RLS zu verschwinden.
 *
 * **Das Veröffentlichen steht NICHT hier.** Es hat sein eigenes Recht
 * (`referenz.veroeffentlichen`) und seine eigene Route
 * (`api/website/referenzen`) — eine zweite Stelle wäre ein zweiter Weg mit
 * einer eigenen Prüfung, und der eine läuft beim nächsten Umbau der Regel
 * hinterher.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreWebsiteAus(anfrage, {
    recht: 'referenz.schreiben',
    handle: async (kontext, rumpf) => {
      const handlung = rumpf.felder['handlung'] ?? '';
      const id = rumpf.felder['id'] ?? '';
      if (!UUID.test(id)) {
        throw new RedaktionFehler('Diese Referenz gibt es hier nicht.', 'nicht_gefunden');
      }

      /*
       * Das zweite Recht (`referenz.kundenfreigabe_erfassen`) prüft der
       * DIENST, vor jedem `update` — und nicht diese Route. Eine
       * `with check`-Bedingung wirft, sie filtert nicht: ohne die Vorprüfung
       * käme „new row violates row-level security policy" als 500 zurück, für
       * eine Handlung, die jemand einfach nicht darf. `kein_freigaberecht` ist
       * der Grund, den die Seite in einen Satz übersetzt.
       */
      if (handlung === 'freigabe') {
        await erfasseKundenfreigabe(kontext, id, {
          freigegeben: (rumpf.felder['freigegeben'] ?? '') === '1',
          am: leerZuNull(rumpf.felder['freigabeAm']),
          beleg: leerZuNull(rumpf.felder['freigabeBeleg']),
        });
        return 'gespeichert=freigabe';
      }
      if (handlung !== 'felder') {
        throw new RedaktionFehler(
          'Diese Handlung kennt die Route nicht.', 'unbekannte_handlung');
      }

      const titel = rumpf.felder['titel'] ?? '';
      /*
       * Ein leeres Slug-Feld heisst „schlag mir einen vor" und nicht „lösche
       * die Adresse": `app.slug_aus_titel` ist dieselbe Funktion, die der
       * Auslöser `trg_referenz_slug` beim Anlegen nimmt. Zwei Verfahren für
       * einen Slug wären zwei Adressen für ein Projekt.
       */
      const rohSlug = (rumpf.felder['slug'] ?? '').trim();
      const slug = rohSlug === '' ? await slugVorschlag(kontext, titel) : rohSlug;

      const medien = rumpf.felder['medienId'] ?? '';
      await aendereReferenz(kontext, id, {
        titel,
        slug,
        kundeName: leerZuNull(rumpf.felder['kundeName']),
        beschreibung: leerZuNull(rumpf.felder['beschreibung']),
        jahr: zahlOderNull(rumpf.felder['jahr']),
        medienId: UUID.test(medien) ? medien : null,
        sortierung: zahlOderNull(rumpf.felder['sortierung']) ?? 0,
      });
      return 'gespeichert=felder';
    },
  });
}
