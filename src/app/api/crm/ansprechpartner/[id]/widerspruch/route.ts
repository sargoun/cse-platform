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
  erfasseVollwiderspruch, erfasseWerbewiderspruch,
} from '@/server/services/crm/kontakt-grundlage';
import { zurueckMitSchluessel } from '@/app/api/crm/rueckweg';

/**
 * `POST /api/crm/ansprechpartner/[id]/widerspruch` — einen Widerspruch
 * erfassen (LEG-08, LEG-09, CRM-08, Art. 21 DSGVO, 05-API-KARTE §C.7).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **ZWEI Umfänge, ZWEI Rechte — und der Handler wählt nicht, er leitet.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  · `umfang = 'werbung'`      → `crm.rechtsgrundlage_setzen`, § 7 Abs. 3
 *                                Nr. 3 UWG. Werbung ist gesperrt, Rechnungen
 *                                gehen weiter.
 *  · `umfang = 'verarbeitung'` → `datenschutz.auskunft_erstellen`, Art. 21
 *                                DSGVO. Die Grundlage fällt zwingend auf
 *                                „keine", der Vorgang ist unwiderruflich.
 *
 * Das zweite Recht ist NICHT dasselbe wie das erste, und das ist der Grund,
 * warum dieser Endpunkt den Umfang aus dem Rumpf liest und danach
 * autorisiert: wer täglich Werbewidersprüche einträgt, soll den
 * unwiderruflichen Vollwiderspruch nicht versehentlich auslösen können.
 *
 * Geschrieben wird in beiden Fällen von einer Definer-Funktion, die ihr Recht
 * selbst prüft (0248 bzw. 0222) — `authorize` hier ist die erste Linie, nicht
 * die einzige.
 *
 * **Zurück reisen nur Schlüssel** (D-769, D-772): `?fehler=<grund>` und
 * `?erfolg=werbewiderspruch` bzw. `?erfolg=vollwiderspruch`. Hier reisten
 * der Satz des `CrmFehler`, der Erfolgssatz und — für JEDEN anderen
 * einzeiligen Fehler — dessen roher Text durch die Adresse. Dieser letzte
 * Zweig lief VOR der Übersetzung der Autorisierung: ein fehlendes Recht
 * wurde „Nicht gefunden" im Warnkasten statt der byte-gleichen 404 (AUT-06),
 * eine abgelaufene Sitzung ein Satz statt der Anmeldung (D-766). Die
 * Abweisungen der beiden Definer bildet jetzt der Dienst auf ihren Grund ab
 * (`grundAusWiderspruch`); jeder andere Fehler bleibt ein Fehler.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(
  anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: 'unbekannte_kennung' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const umfang = String(daten.get('umfang') ?? 'werbung');
  if (umfang !== 'werbung' && umfang !== 'verarbeitung') {
    return NextResponse.json({ fehler: 'unbekannter_umfang' }, { status: 400 });
  }
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          {
            recht: umfang === 'werbung'
              ? 'crm.rechtsgrundlage_setzen'
              : 'datenschutz.auskunft_erstellen',
            schreibend: true,
          },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (umfang === 'werbung') {
          await erfasseWerbewiderspruch(kontext, {
            ansprechpartnerId: id,
            kanal: wert('kanal'),
            eingegangenAm: wert('eingegangenAm'),
            bemerkung: wert('bemerkung'),
          });
        } else {
          await erfasseVollwiderspruch(kontext, id, String(daten.get('bemerkung') ?? ''));
        }
      }));
  } catch (fehler) {
    /* Die Anmeldung zuerst (D-766, D-769 Nr. 7) — ein fehlendes Recht bleibt 404. */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    /* Auch die Abweisungen der Definer — als Grund, nie als ihr Text (D-769 Nr. 8). */
    if (fehler instanceof CrmFehler) {
      return zurueckMitSchluessel(anfrage, zurueck, 'fehler', fehler.grund);
    }
    throw fehler;
  }

  return zurueckMitSchluessel(anfrage, zurueck, 'erfolg',
    umfang === 'werbung' ? 'werbewiderspruch' : 'vollwiderspruch');
}
