import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  SchichtFehler, legeEinzelschichtAn, sageEinsatzAb, setzeLeistungsanker,
} from '@/server/services/dienstplan/einzelschicht';

/**
 * `POST /api/dienstplan/einsatz` — eine einzelne Schicht anlegen oder absagen
 * (V-013, TIM-01, TIM-04).
 *
 * **Ein Recht für beides.** `dienstplan.schreiben` deckt Anlegen und Absagen;
 * `t_mandant` auf `einsatz` (0028) prüft es bei jedem Schreibvorgang ein
 * zweites Mal. Es ist dieselbe Disposition, die eine Sonderreinigung ansetzt
 * und sie wieder absagt, wenn der Kunde abwinkt.
 *
 * Nicht zu verwechseln mit `POST /api/einsaetze/[id]/absagen`: dort sagt EINE
 * EINGETEILTE ihre Zuordnung ab, hier fällt die ganze Schicht aus.
 *
 * **Die Leistungszeile** (V-191, TIM-12): beim Anlegen als `auftrag_leistung`,
 * und für eine Einzelschicht ohne erfasste Zeit nachträglich mit
 * `aktion=leistung` — ein leeres Feld löst den Anker. Dasselbe Recht: es ist
 * dieselbe Disposition.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN = ['anlegen', 'absagen', 'leistung'] as const;
type Aktion = typeof AKTIONEN[number];

const RECHT = 'dienstplan.schreiben';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function zurueck(
  anfrage: NextRequest, daten: FormData, hinweis: string | null, ziel?: string,
): NextResponse {
  const roh = ziel ?? String(daten.get('zurueck') ?? '/portal');
  const adresse = new URL(internesZiel(roh, '/portal', anfrage));
  if (hinweis !== null) {
    const weg = String(daten.get('fehlerweg') ?? '');
    const fehlerZiel = weg === ''
      ? adresse
      : new URL(internesZiel(weg, '/portal', anfrage));
    fehlerZiel.searchParams.set('fehler', hinweis);
    return NextResponse.redirect(fehlerZiel, 303);
  }
  return NextResponse.redirect(adresse, 303);
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
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const zahl = (name: string, vorgabe: number): number => {
    const roh = feld(name);
    if (roh === '') return vorgabe;
    const n = Number(roh);
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const aktion = String(daten.get('aktion') ?? '') as Aktion;
  const mandant = feld('mandant').replace(/[^a-z0-9-]/gu, '');

  if (!AKTIONEN.includes(aktion)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }

  let neuerEinsatz: string | null = null;
  try {
    neuerEinsatz = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: RECHT, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        if (aktion === 'absagen') {
          const id = feld('einsatz');
          if (!UUID.test(id)) throw new SchichtFehler('Ohne Schicht keine Absage.', 'nicht_gefunden', 404);
          await sageEinsatzAb(kontext, id, feld('grund'));
          return null;
        }
        if (aktion === 'leistung') {
          const id = feld('einsatz');
          if (!UUID.test(id)) throw new SchichtFehler('Ohne Schicht kein Anker.', 'nicht_gefunden', 404);
          const anker = feld('auftrag_leistung');
          await setzeLeistungsanker(kontext, id, UUID.test(anker) ? anker : null);
          return null;
        }
        const objekt = feld('objekt');
        if (!UUID.test(objekt)) {
          throw new SchichtFehler('Ohne Objekt entsteht keine Schicht.', 'unvollstaendig');
        }
        const revier = feld('revier');
        const auftrag = feld('auftrag');
        const anker = feld('auftrag_leistung');
        const ergebnis = await legeEinzelschichtAn(kontext, {
          objektId: objekt,
          planDatum: feld('datum'),
          beginnLokal: feld('beginn'),
          endeLokal: feld('ende'),
          endetAmFolgetag: daten.get('folgetag') !== null,
          sollBesetzung: zahl('soll', 1),
          minBesetzung: zahl('min', 1),
          pauseMinuten: zahl('pause', 0),
          revierId: UUID.test(revier) ? revier : null,
          auftragId: UUID.test(auftrag) ? auftrag : null,
          auftragLeistungId: UUID.test(anker) ? anker : null,
          notiz: feld('notiz'),
        });
        return ergebnis.einsatzId;
      }))) as string | null;
  } catch (fehler) {
    if (fehler instanceof SchichtFehler) return zurueck(anfrage, daten, fehler.grund);
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  /*
   * Nach dem Anlegen auf das Schichtblatt — dort wird eingeteilt, und genau
   * das ist der nächste Schritt. Ein Rücksprung auf das leere Formular liesse
   * den Menschen raten, ob etwas entstanden ist.
   */
  if (neuerEinsatz !== null && mandant !== '') {
    return zurueck(anfrage, daten, null,
      `/portal/${mandant}/dienstplan/einsatz/${neuerEinsatz}`);
  }
  return zurueck(anfrage, daten, null);
}
