import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import {
  aendereAntragsart, archiviereAntragsart, legeAntragsartAn,
  pruefeAntragsartEingabe,
} from '@/server/services/stammdaten/antragsart';
import { StammdatenFehler } from '@/server/services/stammdaten/katalog';

/**
 * `POST /api/stammdaten/antragsarten?was=anlegen|aendern|archivieren` — den
 * Antragsartenkatalog pflegen (EMP-10, K-17, O-142).
 *
 * Der Handler bleibt duenn. Dass eine Systemzeile unveraenderlich ist,
 * entscheidet nicht er: `t_katalog_pflege` und `t_plattform_aendern` (0275)
 * schliessen `ist_system` aus, und der Dienst sagt den Satz dazu.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN: ReadonlySet<string> = new Set(['anlegen', 'aendern', 'archivieren']);

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/stammdaten/antragsarten`, erwarteterUrsprung(anfrage));
  if (hinweis !== undefined) url.searchParams.set('hinweis', hinweis);
  return NextResponse.redirect(url, 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const was = anfrage.nextUrl.searchParams.get('was') ?? '';
  if (!AKTIONEN.has(was)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'stammdaten.verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'archivieren') {
          const id = text('id');
          if (id === null) {
            throw new StammdatenFehler('ungueltig', 'Ohne Art gibt es nichts zu tun.');
          }
          await archiviereAntragsart(kontext, id);
          return zurueck(anfrage,
            'Die Antragsart ist archiviert. Bestehende Anträge bleiben lesbar — '
            + 'gelöscht wird nichts.');
        }

        const eingabe = pruefeAntragsartEingabe(text, text('plattform') === 'ja');

        if (was === 'anlegen') {
          await legeAntragsartAn(kontext, eingabe);
          return zurueck(anfrage,
            `Die Antragsart „${eingabe.bezeichnung}" ist angelegt`
            + `${eingabe.plattform ? ' und gilt für alle vier Gesellschaften' : ''}. `
            + 'Sie erscheint ab jetzt im Antragsformular des Mitarbeiterportals.');
        }

        const id = text('id');
        if (id === null) {
          throw new StammdatenFehler('ungueltig', 'Ohne Art gibt es nichts zu tun.');
        }
        await aendereAntragsart(kontext, id, eingabe);
        return zurueck(anfrage, `„${eingabe.bezeichnung}" ist gespeichert.`);
      }))) as NextResponse;
  } catch (fehler: unknown) {
    if (fehler instanceof StammdatenFehler) return zurueck(anfrage, fehler.message);
    if (fehler instanceof NichtGefundenFehler) {
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
}
