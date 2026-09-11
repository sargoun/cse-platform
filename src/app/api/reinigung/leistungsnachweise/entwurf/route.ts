import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  erstelleEntwurf, FalscherZustand, KundePasstNichtZumObjekt, NachweisNichtGefunden,
  type PositionEingabe,
} from '@/server/services/reinigung/leistungsnachweis';

/**
 * `POST /api/reinigung/leistungsnachweise/entwurf` — **Schritt 1** (CLN-04,
 * TIM-12).
 *
 * Die Zeilen entstehen SERVERSEITIG und werden gespeichert, bevor irgendwer
 * unterschreibt. Das ist die Voraussetzung dafür, dass Schritt 2 überhaupt
 * etwas vergleichen kann: eine Prüfsumme über Zeilen, die nur im Browser
 * existieren, prüft die Behauptung des Browsers.
 *
 * **Die Menge reist als TEXT, nicht als Zahl.** `21.000` durch `Number()` zu
 * schicken und wieder auszugeben, ist der Weg, auf dem aus einer `numeric`
 * eine Gleitkommazahl wird — bei Mengen so falsch wie bei Beträgen
 * (Invariante 1, K-16).
 */
export const dynamic = 'force-dynamic';

/** `12,5` und `12.5` sind dieselbe Menge; die Datenbank liest Punkte. */
const MENGE = /^-?\d{1,9}([.,]\d{1,3})?$/u;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (feld: string): string | null => {
    const w = daten.get(feld);
    return typeof w === 'string' && w.trim() !== '' ? w.trim() : null;
  };
  const objektId = text('objekt');
  const kundeId = text('kunde');
  const von = text('von');
  const bis = text('bis');
  if (objektId === null || kundeId === null || von === null || bis === null) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  /**
   * Die Zeilen kommen als drei gleich lange Listen aus dem Formular. Eine
   * Zeile ohne Bezeichnung oder mit unlesbarer Menge wird VERWORFEN, nicht
   * geraten: eine stillschweigend auf `1` gesetzte Menge ist ein Betrag, den
   * niemand gesetzt hat.
   */
  const bezeichnungen = daten.getAll('bezeichnung').filter((w): w is string => typeof w === 'string');
  const mengen = daten.getAll('menge').filter((w): w is string => typeof w === 'string');
  const einheiten = daten.getAll('einheit').filter((w): w is string => typeof w === 'string');
  const positionen: PositionEingabe[] = [];
  for (const [i, bezeichnung] of bezeichnungen.entries()) {
    const menge = mengen[i] ?? '';
    const einheit = einheiten[i] ?? '';
    if (bezeichnung.trim() === '' || !MENGE.test(menge.trim()) || einheit.trim() === '') continue;
    positionen.push({
      bezeichnung: bezeichnung.trim(),
      menge: menge.trim().replace(',', '.'),
      einheit: einheit.trim(),
      quelle: 'manuell',
    });
  }
  if (positionen.length === 0) {
    return NextResponse.json({ fehler: 'keine_positionen' }, { status: 400 });
  }

  let neu: string | null = null;
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
          { recht: 'nachweis.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        neu = await erstelleEntwurf(kontext, {
          objektId,
          kundeId,
          revierId: text('revier'),
          auftragLeistungId: text('leistung'),
          von,
          bis,
          positionen,
        });
      }));
  } catch (fehler) {
    if (fehler instanceof KundePasstNichtZumObjekt || fehler instanceof FalscherZustand) {
      return NextResponse.json(
        { fehler: 'ungueltiger_zustand', hinweis: fehler.message }, { status: 422 },
      );
    }
    // AUT-06: ein fremdes Objekt ist nicht vorhanden, nicht verboten.
    if (fehler instanceof NachweisNichtGefunden || fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    throw fehler;
  }

  const mandant = String(daten.get('mandant') ?? '');
  const ziel = internesZiel(
    daten.get('zurueck') as string | null,
    `/portal/${mandant}/reinigung/leistungsnachweise/${neu ?? ''}`,
    anfrage,
  );
  return NextResponse.redirect(ziel, 303);
}
