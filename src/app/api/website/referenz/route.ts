import { type NextRequest, type NextResponse } from 'next/server';
import {
  RedaktionFehler, aendereReferenz, erfasseKundenfreigabe, legeReferenzAn, slugVorschlag,
} from '@/server/services/inhalt/redaktion';
import { UUID, fuehreWebsiteAus, leerZuNull, zahlOderNull } from '../gemeinsam';

/**
 * `POST /api/website/referenz` — eine Referenz anlegen, ihre Felder und ihre
 * Kundenfreigabe (PRO-05, V-154).
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

/**
 * Die kurzen Eingaben des Anlegeformulars, die bei einer Abweisung mit
 * zurückgehen (V-161): Titel, Adresse, Kundenname, Jahr. Die Beschreibung
 * steht nicht im Anlegeformular (sie wird auf dem Blatt der neuen Zeile
 * gepflegt) und reiste als Freitext auch in keiner Adresse mit.
 *
 * Nicht exportiert: eine `route.ts` darf nur die bekannten Namen ausführen.
 */
const ANLEGEN_RUECKGABE = ['titel', 'slug', 'kundeName', 'jahr'] as const;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreWebsiteAus(anfrage, {
    recht: 'referenz.schreiben',
    rueckgabe: (rumpf) => (rumpf.felder['handlung'] === 'anlegen'
      ? Object.fromEntries(ANLEGEN_RUECKGABE.map((n) => [n, rumpf.felder[n] ?? '']))
      : {}),
    handle: async (kontext, rumpf) => {
      const handlung = rumpf.felder['handlung'] ?? '';

      /*
       * **Anlegen (V-154, V-161)** — aus einem abgeschlossenen Auftrag mit
       * geltender Kundenfreigabe (PRO-05). Sie hat noch keine Kennung,
       * deshalb steht sie VOR der Prüfung darunter.
       *
       * Danach geht es auf das Blatt der neuen Zeile und nicht zurück aufs
       * Formular: dort steht der nächste Schritt (Beschreibung, Bild, die
       * Kundenfreigabe der Referenz). Die Herkunft reist NICHT in der Adresse
       * mit — sie steht seit 0410 in der Zeile, und das Blatt schlägt Datum
       * und Beleg aus genau diesem Auftrag vor. Es SCHLÄGT VOR: gespeichert
       * wird die Freigabe erst, wenn ein Mensch es dort tut (Invariante 7).
       * Gab es die Referenz aus demselben Auftrag unter derselben Adresse
       * schon (Doppelklick), führt der Weg auf sie, mit `vorhanden=1`.
       */
      if (handlung === 'anlegen') {
        const neu = await legeReferenzAn(kontext, {
          auftragId: rumpf.felder['auftrag'] ?? '',
          titel: rumpf.felder['titel'] ?? '',
          slug: leerZuNull(rumpf.felder['slug']),
          kundeName: leerZuNull(rumpf.felder['kundeName']),
          beschreibung: leerZuNull(rumpf.felder['beschreibung']),
          jahr: zahlOderNull(rumpf.felder['jahr']),
        });
        return {
          weiter: `/portal/${neu.bereich}/website/referenzen/${neu.id}`
            + `?${neu.vorhanden ? 'vorhanden' : 'angelegt'}=1`,
        };
      }

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
