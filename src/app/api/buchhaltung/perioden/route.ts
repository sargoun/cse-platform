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
  PeriodenschlussFehler, schliessePeriode, type Geschlossen, type SchlussArt,
} from '@/server/services/buchhaltung/periodenschluss';

/**
 * `POST /api/buchhaltung/perioden` — einen Monat vorlaeufig schliessen,
 * schliessen oder wieder oeffnen (ACC-01, PR 65).
 *
 * Duenn: Herkunft, Sitzung, `buchhaltung.festschreiben`, Dienst, zurueck.
 * Was die Datenbank abweist (Zeilen ohne Konto, Buchungen ohne Ausgleich),
 * kommt als Satz zurueck auf die Seite — nicht als 500.
 */
export const dynamic = 'force-dynamic';

const ARTEN: readonly SchlussArt[] = ['vorlaeufig', 'endgueltig', 'oeffnen'];

function zurueck(anfrage: NextRequest, slug: string, jahr: string, such: Readonly<Record<string, string>>): NextResponse {
  const url = new URL(`/portal/${slug}/buchhaltung/perioden`, anfrage.nextUrl.origin);
  url.searchParams.set('jahr', jahr);
  for (const [k, v] of Object.entries(such)) url.searchParams.set(k, v);
  return NextResponse.redirect(url, 303);
}

function istRestriktion(fehler: unknown): fehler is Error & { code: string } {
  return fehler instanceof Error && (fehler as { code?: unknown }).code === '23001';
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
  const jahr = text('jahr') ?? '';
  const monat = text('monat') ?? '';
  const art = text('art');
  if (slug === '' || !/^\d{4}$/u.test(jahr) || !/^\d{1,2}$/u.test(monat)
      || art === null || !ARTEN.includes(art as SchlussArt)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    const g = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'buchhaltung.festschreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return schliessePeriode(kontext, { jahr: Number(jahr), monat: Number(monat), art: art as SchlussArt });
      }))) as Geschlossen;
    const wort = g.periode.status === 'geschlossen' ? 'geschlossen'
      : g.periode.status === 'vorlaeufig_geschlossen' ? 'vorläufig geschlossen' : 'wieder geöffnet';
    return zurueck(anfrage, slug, jahr, {
      geschlossen: `${monat.padStart(2, '0')}/${jahr}`,
      meldung: `Monat ${monat.padStart(2, '0')}/${jahr} ${wort}.`,
    });
  } catch (fehler: unknown) {
    if (fehler instanceof PeriodenschlussFehler) {
      return zurueck(anfrage, slug, jahr, { fehler: fehler.grund, meldung: fehler.message });
    }
    if (istRestriktion(fehler)) {
      return zurueck(anfrage, slug, jahr, { fehler: 'datenbank', meldung: fehler.message });
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
