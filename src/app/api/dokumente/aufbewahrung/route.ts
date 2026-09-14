import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  AufbewahrungFehler, setzeAufbewahrung, type AufbewahrungZeile,
} from '@/server/services/dokument/aufbewahrung';

/**
 * `POST /api/dokumente/aufbewahrung` — eine Aufbewahrungsregel dieser
 * Gesellschaft setzen (DOC-07, PR 64).
 *
 * Duenn: Herkunft, Sitzung, Recht, Dienst, zurueck. Die Untergrenzen prueft
 * der Dienst und noch einmal die Datenbank; hier wird nur gelesen, was das
 * Formular sagt.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, slug: string, such: Readonly<Record<string, string>>): NextResponse {
  const url = new URL(`/portal/${slug}/dokumente/aufbewahrung`, anfrage.nextUrl.origin);
  for (const [k, v] of Object.entries(such)) url.searchParams.set(k, v);
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
    return zurueck(anfrage, slug, { fehler: 'jahre', meldung: 'Die Frist ist eine ganze Zahl von Jahren.' });
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
    if (fehler instanceof AufbewahrungFehler) {
      return zurueck(anfrage, slug, { fehler: fehler.grund, meldung: fehler.message });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
