import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler } from '@/server/services/crm/anlegen';
import {
  anlageSchluessel, erledige, legeWiedervorlageAn, verschiebe, type WiedervorlageErfolg,
} from '@/server/services/crm/wiedervorlage';
import { zurueckMitSchluessel } from '@/app/api/crm/rueckweg';

/**
 * `POST /api/crm/wiedervorlage` — erledigen, verschieben, anlegen (CRM-04).
 *
 * **Drei Vorgänge, ein Recht (`crm.schreiben`), ein Handler.** Sie stehen auf
 * derselben Liste und gehören demselben Menschen; drei Pfade wären dreimal
 * dieselbe Wache.
 *
 * **`anlegen` schreibt in drei Tabellen** — `lead_aktivitaet`, `aufgabe`,
 * `kalender_eintrag` — und nennt in der Rückmeldung, was davon NICHT entstand.
 * Eine Wiedervorlage, die in der Aufgabenliste fehlt, ohne dass jemand es
 * weiss, ist schlimmer als eine, die nur an einer Stelle steht (O-663).
 *
 * **Zurück reisen nur Schlüssel** (D-769, D-772): eine Abweisung als
 * `?wiedervorlage=<grund>`, ein Erfolg als `?erfolg=<schluessel>`
 * (`anlageSchluessel` nennt dabei, was vom Spiegel fehlt). Hier standen der
 * Satz des Dienstes und der Erfolgssatz selbst in der Adresse. Der eigene Name
 * für die Abweisung, weil Lead- und Kontaktblatt `fehler` schon für andere
 * Formulare lesen — derselbe Schlüssel meinte dort anderes.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const was = String(daten.get('was') ?? '');
  if (!['erledigt', 'verschieben', 'anlegen'].includes(was)) {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
  }
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

  let erfolg: WiedervorlageErfolg;
  try {
    erfolg = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext): Promise<WiedervorlageErfolg> => {
        await authorize(
          sitzung, { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'anlegen') {
          const spiegel = await legeWiedervorlageAn(kontext, {
            betreff: String(daten.get('betreff') ?? ''),
            notiz: wert('notiz'),
            faelligAm: String(daten.get('faelligAm') ?? ''),
            erinnerungAm: wert('erinnerungAm'),
            leadId: wert('leadId'),
            kundeId: wert('kundeId'),
            ansprechpartnerId: wert('ansprechpartnerId'),
            zustaendigBenutzerId: wert('zustaendigBenutzerId'),
          });
          return anlageSchluessel(spiegel);
        }

        const id = String(daten.get('id') ?? '');
        if (!UUID.test(id)) {
          throw new CrmFehler('Diese Wiedervorlage gibt es nicht.', 'nicht_gefunden', 404);
        }

        if (was === 'erledigt') {
          await erledige(kontext, id);
          return 'erledigt';
        }

        await verschiebe(
          kontext, id, String(daten.get('faelligAm') ?? ''),
          String(daten.get('grund') ?? ''));
        return 'verschoben';
      })) as Promise<WiedervorlageErfolg>);
  } catch (fehler) {
    /* Die Anmeldung zuerst (D-766, D-769 Nr. 7) — ein fehlendes Recht bleibt 404. */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof CrmFehler) {
      return zurueckMitSchluessel(anfrage, zurueck, 'wiedervorlage', fehler.grund);
    }
    throw fehler;
  }

  return zurueckMitSchluessel(anfrage, zurueck, 'erfolg', erfolg);
}
