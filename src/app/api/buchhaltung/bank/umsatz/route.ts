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
import { istUuid } from '@/lib/uuid';
import {
  ImportFehler, bestaetigeZuordnung, markiereOhneBezug, type KlaerungErgebnis,
} from '@/server/services/finanz/bank/import';
import { ZahlungFehler } from '@/server/services/finanz/zahlung/index';

/**
 * `POST /api/buchhaltung/bank/umsatz` — die Klaerung eines Umsatzes (ACC-04).
 *
 * Zwei Handlungen, ein Formular: `zuordnen` bestaetigt einen offenen Posten,
 * `ohne_bezug` sagt, dass der Umsatz zu keiner Rechnung gehoert. Beides ist
 * eine Entscheidung ueber Geld und traegt deshalb `zahlung.schreiben` — das
 * Recht, das auch der Import verlangt, denn beide legen dieselbe Zahlung an.
 *
 * Die Route rechnet nichts: der Betrag ist der der Bank, der Posten der, den
 * der Mensch gewaehlt hat. Sie leitet zurueck auf den Auszug, mit einem Wort
 * darueber, was geschehen ist.
 */
export const dynamic = 'force-dynamic';

function zurueck(
  anfrage: NextRequest, slug: string, auszugId: string, such: Readonly<Record<string, string>>,
): NextResponse {
  const url = new URL(`/portal/${slug}/buchhaltung/bank/${auszugId}`, erwarteterUrsprung(anfrage));
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
  const auszugId = text('auszugId');
  const umsatzId = text('umsatzId');
  const aktion = text('aktion');
  if (slug === '' || !istUuid(auszugId) || !istUuid(umsatzId)
      || (aktion !== 'zuordnen' && aktion !== 'ohne_bezug')) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }
  const postenId = text('postenId');
  if (aktion === 'zuordnen' && !istUuid(postenId)) {
    return zurueck(anfrage, slug, auszugId,
      { fehler: 'klaerung', meldung: 'Bitte einen offenen Posten wählen.' });
  }

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'zahlung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return aktion === 'zuordnen'
          ? bestaetigeZuordnung(kontext, umsatzId, postenId!)
          : markiereOhneBezug(kontext, umsatzId, text('notiz') ?? '');
      }))) as KlaerungErgebnis;
    return zurueck(anfrage, slug, ergebnis.auszugId, {
      meldung: aktion === 'zuordnen' ? 'zugeordnet' : 'ohne_bezug',
      ...(ergebnis.auszugAbgeglichen ? { abgeglichen: '1' } : {}),
    });
  } catch (fehler: unknown) {
    if (fehler instanceof ImportFehler) {
      return zurueck(anfrage, slug, auszugId, { fehler: 'klaerung', meldung: fehler.message });
    }
    /*
     * V-216: ein Ausgang geht über `verbucheZahlungsausgang` — dessen
     * Abweisungen (kein Posten, schon bezahlt) sind ein Satz auf der Seite,
     * kein 500.
     */
    if (fehler instanceof ZahlungFehler) {
      return zurueck(anfrage, slug, auszugId, { fehler: 'klaerung', meldung: fehler.message });
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
