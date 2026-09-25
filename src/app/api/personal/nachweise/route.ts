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
  NachweisFehler, bestaetigeNachweis, nimmNachweisAuf, widerrufeNachweis,
} from '@/server/services/nachweis/aufnahme';

/**
 * `POST /api/personal/nachweise` — einen Qualifikationsnachweis aufnehmen,
 * bestätigen oder widerrufen (V-010, SEC-02, SEC-03, EMP-08, § 34a GewO).
 *
 * **Ein Recht für alle drei, und das ist hier richtig.**
 * `personal.nachweis_verwalten` deckt Aufnahme, Bestätigung und Widerruf;
 * `n_schreiben` und `n_aendern` (0030) prüfen es bei jeder. Anders als bei
 * der Ausgabe, wo Erfassen und Entscheiden zwei verschiedene Handlungen
 * sind: hier ist es dieselbe Personalstelle, die die Urkunde in der Hand
 * hält.
 *
 * **Der Nachweis hängt am MENSCHEN** (Invariante 9, D-09) — `person_id`, nie
 * `anstellung_id`. `erfasst_von_mandant_id` setzt die Policy aus der Sitzung
 * und nicht das Formular: wer erfasst, erfasst für seine Gesellschaft.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN = ['aufnehmen', 'bestaetigen', 'widerrufen'] as const;
type Aktion = typeof AKTIONEN[number];

const RECHT = 'personal.nachweis_verwalten';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function zurueck(anfrage: NextRequest, daten: FormData, hinweis: string | null): NextResponse {
  const weg = typeof daten.get('fehlerweg') === 'string' ? String(daten.get('fehlerweg')) : '';
  const roh = hinweis !== null && weg !== ''
    ? weg
    : String(daten.get('zurueck') ?? '/portal');
  const ziel = new URL(internesZiel(roh, '/portal', anfrage));
  if (hinweis !== null) ziel.searchParams.set('fehler', hinweis);
  return NextResponse.redirect(ziel, 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string | undefined => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : undefined;
  };
  const aktion = String(daten.get('aktion') ?? '') as Aktion;
  const id = feld('id');

  if (!AKTIONEN.includes(aktion)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  if (aktion !== 'aufnehmen' && (id === undefined || !UUID.test(id))) {
    return NextResponse.json({ fehler: 'keine_kennung' }, { status: 400 });
  }
  if (aktion === 'aufnehmen') {
    const person = feld('person');
    const quali = feld('qualifikation');
    if (person === undefined || !UUID.test(person)
      || quali === undefined || !UUID.test(quali)) {
      return zurueck(anfrage, daten, 'unvollstaendig');
    }
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        switch (aktion) {
          case 'aufnehmen':
            await nimmNachweisAuf(kontext, {
              personId: feld('person') ?? '',
              qualifikationId: feld('qualifikation') ?? '',
              gueltigAb: feld('gueltig_ab') ?? '',
              gueltigBis: feld('gueltig_bis') ?? null,
              nummer: feld('nummer') ?? null,
              ausstellendeStelle: feld('stelle') ?? null,
              ausgestelltAm: feld('ausgestellt_am') ?? null,
              dokumentId: feld('dokument') ?? null,
            });
            return;
          case 'bestaetigen':
            await bestaetigeNachweis(kontext, id!);
            return;
          case 'widerrufen':
            await widerrufeNachweis(kontext, id!, feld('grund') ?? '');
            return;
        }
      })));
  } catch (fehler) {
    if (fehler instanceof NachweisFehler) return zurueck(anfrage, daten, fehler.grund);
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return zurueck(anfrage, daten, null);
}
