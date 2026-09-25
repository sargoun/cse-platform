import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  legeModellAn, ModellFehler, setzeFreigabe,
} from '@/server/services/system/modellregister';

/**
 * `POST /api/system/modelle` — ein Sprachmodell freigeben, ohne SQL (V-120).
 *
 * **Der Weg, den `docs/EINRICHTEN-*.md` §9 bis hierher als handgeschriebene
 * `insert`-Anweisung beschreiben musste.** `0154` gab `cse_app` auf
 * `modell_register` nur `select`; die einzige Art, ein Modell freizugeben,
 * war ein Datenbankwerkzeug. Ein Betreiber, der eine RECHTSAUSSAGE eintragen
 * soll und dafür eine Zeile SQL bekommt, bleibt dort stehen — und er hat
 * recht damit.
 *
 * **`geprueft_von` kommt NICHT aus dem Formular.** Der Auslöser
 * `trg_modell_register_zeuge` (0381) setzt `app.aktueller_benutzer()`: ein
 * Name, den jemand über sich selbst eintippt, ist keine Bezeugung.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | undefined => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : undefined;
  };
  const haken = (name: string): boolean => daten.get(name) === 'ja';
  const aktion = text('aktion') ?? 'anlegen';

  const fehlerweg = text('fehlerweg');
  const zurueckAuf = (grund: string): NextResponse | null => {
    if (fehlerweg === undefined) return null;
    const ziel = new URL(internesZiel(fehlerweg, '/portal', anfrage));
    ziel.searchParams.set('fehler', grund);
    return NextResponse.redirect(ziel, 303);
  };

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          {
            benutzerId: sitzung.benutzerId,
            personId: sitzung.personId,
            aktiverMandantId: sitzung.aktiverMandantId,
            ansicht: sitzung.ansicht,
            aal: sitzung.aal,
            portal: sitzung.portal,
            sitzungId: sitzung.sitzungId,
          },
          { recht: 'system.einstellung_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (aktion === 'freigeben' || aktion === 'sperren') {
          const id = text('id');
          if (id === undefined || !UUID.test(id)) {
            throw new ModellFehler('Ohne Kennung keine Handlung.', 'keine_kennung');
          }
          await setzeFreigabe(kontext, id, aktion === 'freigeben');
          return;
        }
        await legeModellAn(kontext, {
          anbieter: text('anbieter') ?? '',
          modell: text('modell') ?? '',
          faehigkeit: text('faehigkeit') ?? '',
          euVerarbeitung: haken('eu_verarbeitung'),
          zeroRetention: haken('zero_retention'),
          freigegeben: haken('freigegeben'),
          nachweisUrl: text('nachweis_url'),
          bemerkung: text('bemerkung'),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof ModellFehler) {
      return zurueckAuf(fehler.grund)
        ?? NextResponse.json({ fehler: fehler.grund, meldung: fehler.message },
                             { status: fehler.status });
    }
    /*
     * `mr_uk` ist `unique (modell, faehigkeit)`: dasselbe Modell zweimal fuer
     * dieselbe Faehigkeit. Das ist keine Ausnahme, sondern der zweite Klick.
     */
    if ((fehler as { code?: string }).code === '23505') {
      return zurueckAuf('schon_vorhanden')
        ?? NextResponse.json({ fehler: 'schon_vorhanden' }, { status: 409 });
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(daten.get('zurueck') as string | null, '/portal', anfrage), 303);
}
