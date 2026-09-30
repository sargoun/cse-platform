import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  AufbewahrungFehler, setzeAufbewahrung, type AufbewahrungZeile,
} from '@/server/services/dokument/aufbewahrung';
import type { AufbewahrungFehlerGrund } from '@/lib/i18n/verwaltung/dokument-rueckweg';

/**
 * `POST /api/dokumente/aufbewahrung` — eine Aufbewahrungsregel dieser
 * Gesellschaft setzen (DOC-07, PR 64).
 *
 * Duenn: Herkunft, Sitzung, Recht, Dienst, zurueck. Die Untergrenzen prueft
 * der Dienst und noch einmal die Datenbank; hier wird nur gelesen, was das
 * Formular sagt.
 *
 * **Zurück reisen nur Schlüssel** (D-769, D-774): der Erfolg als
 * `?gesetzt=<kategorie>`, eine Abweisung als `?fehler=<grund>`. Bis dahin
 * reiste der Satz des Dienstes als `?meldung=` mit — samt der Kategorie, wie
 * das Formular sie schickte, und der Frist —, und die Seite zog ihn ihrer
 * eigenen Tabelle vor.
 */
export const dynamic = 'force-dynamic';

function zurueck(
  anfrage: NextRequest, slug: string,
  such: { readonly gesetzt: string } | { readonly fehler: AufbewahrungFehlerGrund },
): NextResponse {
  const url = new URL(`/portal/${slug}/dokumente/aufbewahrung`, erwarteterUrsprung(anfrage));
  for (const [k, v] of Object.entries(such)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  const slug = (text('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const kategorie = text('kategorie');
  if (slug === '' || kategorie === null) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const jahreRoh = text('jahre');
  const jahre = jahreRoh === null ? null : Number(jahreRoh);
  if (jahre !== null && !Number.isInteger(jahre)) {
    return zurueck(anfrage, slug, { fehler: 'jahre' });
  }

  try {
    const gesetzt = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'dokument.aufbewahrung_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return setzeAufbewahrung(kontext, {
          kategorie, jahre, loeschsperre: daten.get('loeschsperre') === 'on',
          grundlage: text('grundlage') ?? '',
        });
      }))) as AufbewahrungZeile;
    return zurueck(anfrage, slug, { gesetzt: gesetzt.kategorie });
  } catch (fehler: unknown) {
    /* Anmeldung und Recht zuerst (D-766, AUT-06): ein fehlendes Recht bleibt die byte-gleiche 404. */
    const autorisierung = autorisierungsAntwort(fehler, anfrage, { felder: daten });
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof AufbewahrungFehler) return zurueck(anfrage, slug, { fehler: fehler.grund });
    throw fehler;
  }
}
