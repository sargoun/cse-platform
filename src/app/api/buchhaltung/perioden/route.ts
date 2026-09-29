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
  PeriodenschlussFehler, schliessePeriode, type Geschlossen, type SchlussArt,
} from '@/server/services/buchhaltung/periodenschluss';
import type { Periode } from '@/server/services/buchhaltung/periode';
import type {
  PeriodeErfolg, PeriodeFehlerGrund,
} from '@/lib/i18n/verwaltung/buchhaltung-perioden';

/**
 * `POST /api/buchhaltung/perioden` — einen Monat vorlaeufig schliessen,
 * schliessen oder wieder oeffnen (ACC-01, PR 65).
 *
 * Duenn: Herkunft, Sitzung, `buchhaltung.festschreiben`, Dienst, zurueck.
 * Was die Datenbank abweist (Zeilen ohne Konto, Buchungen ohne Ausgleich),
 * kommt als Grund zurueck auf die Seite — nicht als 500.
 *
 * **Zurück reisen Schlüssel und ein geprüfter Monat** (D-769, D-774): der
 * Erfolg als `?erfolg=<zustand>`, eine Abweisung als `?fehler=<grund>`, dazu
 * `?monat=JJJJ-MM`. Bis dahin reiste ein fertiger Satz als `?meldung=` — der
 * Erfolg („Monat 03/2026 vorläufig geschlossen.") ebenso wie der Satz des
 * Dienstes und die Meldung der Datenbank —, und die Seite zeigte ihn roh. Den
 * Monat nennt die Seite jetzt selbst, aus IHREN Monaten: ein Wert, der keiner
 * davon ist, bleibt ungenannt.
 */
export const dynamic = 'force-dynamic';

const ARTEN: readonly SchlussArt[] = ['vorlaeufig', 'endgueltig', 'oeffnen'];

/** Der Erfolg als Schlüssel: der Zustand, in dem der Monat jetzt steht. */
const ERFOLG: Readonly<Record<Periode['status'], PeriodeErfolg>> = {
  vorlaeufig_geschlossen: 'vorlaeufig_geschlossen',
  geschlossen: 'geschlossen',
  offen: 'geoeffnet',
};

function zurueck(
  anfrage: NextRequest, slug: string, jahr: string, monat: string | null,
  such: { readonly erfolg: PeriodeErfolg } | { readonly fehler: PeriodeFehlerGrund },
): NextResponse {
  const url = new URL(`/portal/${slug}/buchhaltung/perioden`, erwarteterUrsprung(anfrage));
  url.searchParams.set('jahr', jahr);
  if (monat !== null) url.searchParams.set('monat', monat);
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
    return ohneSitzungAntwort(anfrage, sitzung);
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
  /* Nur ein Kalendermonat reist mit — gebildet aus den geprüften Feldern, nie weitergereicht. */
  const nummer = Number(monat);
  const monatSchluessel = nummer >= 1 && nummer <= 12 ? `${jahr}-${monat.padStart(2, '0')}` : null;

  try {
    const g = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'buchhaltung.festschreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return schliessePeriode(kontext, { jahr: Number(jahr), monat: Number(monat), art: art as SchlussArt });
      }))) as Geschlossen;
    return zurueck(anfrage, slug, jahr, monatSchluessel, { erfolg: ERFOLG[g.periode.status] });
  } catch (fehler: unknown) {
    /* Anmeldung und Recht zuerst (D-766, AUT-06): ein fehlendes Recht bleibt die byte-gleiche 404. */
    const autorisierung = autorisierungsAntwort(fehler, anfrage, { felder: daten });
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof PeriodenschlussFehler) {
      return zurueck(anfrage, slug, jahr, monatSchluessel, { fehler: fehler.grund });
    }
    /* Die Meldung der Datenbank nennt Monat und Anzahl — die Seite hat beides selbst. */
    if (istRestriktion(fehler)) {
      return zurueck(anfrage, slug, jahr, monatSchluessel, { fehler: 'datenbank' });
    }
    throw fehler;
  }
}
