import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { bestaetigeKalkulation, KalkulationFehler }
  from '@/server/services/kalkulation/bestaetigung';

/**
 * `POST /api/kalkulation` — die Werte bestaetigen, auf denen ein Preis ruht.
 *
 * Der Weg, ohne den die Sperre aus `kern.angebot_versand_pruefen` eine
 * Sackgasse waere: ein Angebot aus dem Raumbuch steht auf den Platzhaltern
 * O-16 (Stundenverrechnungssatz, Gemeinkostenbasis, Zuschlaege) und O-17
 * (Leistungswert), und ohne diese Bestaetigung liesse es sich nie versenden.
 *
 * Bestaetigt wird je Kalkulation, nicht global: was gruppenweit gilt, ist
 * genau die offene Frage. Wer hier Zahlen eintraegt, sagt „fuer DIESES
 * Angebot rechnen wir so“ — und die Kalkulation haelt fest, wer das wann
 * gesagt hat.
 */
export const dynamic = 'force-dynamic';

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

  const angebotId = text('angebotId');
  const basis = text('gemeinkostenBasis');
  if (angebotId === null || basis === null) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'kalkulation.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        return bestaetigeKalkulation(kontext, angebotId, {
          stundensatzEuro: text('stundensatz'),
          gemeinkostenBasis: basis,
          gemeinkostenProzent: text('gemeinkosten'),
          wagnisGewinnProzent: text('wagnisGewinn'),
          leistungswerteBestaetigen: text('leistungswerte') === 'ja',
          frequenzFaktor: text('frequenzFaktor'),
          benutzerId: sitzung.benutzerId,
        });
      })) as Promise<{ readonly bestaetigt: boolean }>);

    if (!ergebnis.bestaetigt) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    return NextResponse.redirect(
      new URL(`/portal/${slug}/angebote/${angebotId}`, erwarteterUrsprung(anfrage)), 303);
  } catch (fehler) {
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    if (fehler instanceof KalkulationFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 400 });
    }
    throw fehler;
  }
}
