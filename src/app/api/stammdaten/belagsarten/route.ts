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
  datiereBelagsartUm, pruefeBelagsartEingabe, stelleBelagsartRichtig,
} from '@/server/services/stammdaten/belagsart';
import { StammdatenFehler, pflichttext } from '@/server/services/stammdaten/katalog';

/**
 * `POST /api/stammdaten/belagsarten?was=datieren|richtigstellen` — den
 * Leistungswertkatalog pflegen (OPS-03, O-17).
 *
 * **Zwei Aktionen, und die Trennung ist die ganze Aussage.** `datieren` legt
 * eine neue FASSUNG an und schliesst die laufende zum Vortag: der
 * Leistungswert ist eine neue Tatsache ab einem Tag. `richtigstellen` aendert
 * Name, Beschreibung und Quelle der bestehenden Fassung, ohne den Wert
 * anzufassen — ein Tippfehler im Namen ist keine Preisaenderung.
 *
 * Ob sich Zeitraeume ueberschneiden, entscheidet nicht dieser Handler:
 * `belagsart_zeitraum_eindeutig` weist es ab, und der Dienst uebersetzt es.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN: ReadonlySet<string> = new Set(['datieren', 'richtigstellen']);

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/stammdaten/belagsarten`, erwarteterUrsprung(anfrage));
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

        if (was === 'richtigstellen') {
          const id = text('id');
          if (id === null) {
            throw new StammdatenFehler('ungueltig', 'Ohne Fassung gibt es nichts zu tun.');
          }
          const beschreibung = text('beschreibung');
          await stelleBelagsartRichtig(kontext, id, {
            bezeichnung: pflichttext(text('bezeichnung'), 'Bezeichnung'),
            beschreibung,
            quelle: pflichttext(text('quelle'), 'Quelle'),
            bestaetigt: text('bestaetigt') === 'ja',
          });
          return zurueck(anfrage,
            'Die Angaben sind richtiggestellt. Der Leistungswert und sein Zeitraum '
            + 'sind unverändert — dafür gibt es die neue Fassung.');
        }

        const eingabe = pruefeBelagsartEingabe(text);
        await datiereBelagsartUm(kontext, eingabe);
        return zurueck(anfrage,
          `„${eingabe.code}" rechnet ab ${eingabe.gueltigAb} mit `
          + `${eingabe.leistungswert} m²/h. Kalkulationen von davor bleiben, wie sie `
          + 'sind: sie berufen sich auf die Fassung, die damals galt.'
          + (eingabe.bestaetigt
            ? ''
            : ' Der Wert ist als unbestätigt hinterlegt (O-17) — die Kalkulation '
              + 'nennt ihn so.'));
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
