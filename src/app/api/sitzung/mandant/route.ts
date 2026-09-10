import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { wechsleMandant, type Wechsel, type Wechselziel } from '@/server/auth/switch-mandant';

/**
 * `POST /api/sitzung/mandant` — der einzige Schreiber des aktiven Bereichs
 * (03-AUTH §4.4, SEITENKARTE §10).
 *
 * **Nur POST.** Es gibt bewusst kein `GET`: waere der Wechsel ein GET, WAERE
 * die URL der Mandantenzustand, und ein weitergeleiteter Link versetzte eine
 * Leitung lautlos in eine andere GmbH (D-10, DESIGN §6).
 *
 * **Der Absender wird geprueft.** Das Sitzungscookie ist `sameSite: 'lax'`,
 * ein fremdes Formular kann es also gar nicht erst mitschicken. Der
 * `Origin`-Vergleich ist die zweite Linie — dieselbe Haltung wie ueberall
 * sonst: eine Massnahme, die woanders greift, ersetzt die hiesige nicht.
 *
 * Antwortet auf ein Formular mit `303` auf das Ziel und auf einen
 * JSON-Aufruf mit JSON. Beides derselbe Weg; die Weiche ist nur die Darstellung.
 */
export const dynamic = 'force-dynamic';

async function zielAus(anfrage: NextRequest): Promise<Wechselziel | null> {
  const typ = anfrage.headers.get('content-type') ?? '';
  if (typ.includes('application/json')) {
    const koerper = (await anfrage.json()) as { mandantSlug?: unknown; gruppe?: unknown };
    if (koerper.gruppe === true) return { art: 'gruppe' };
    return typeof koerper.mandantSlug === 'string' && koerper.mandantSlug !== ''
      ? { art: 'mandant', slug: koerper.mandantSlug }
      : null;
  }
  const daten = await anfrage.formData();
  if (daten.get('gruppe') === 'true') return { art: 'gruppe' };
  const slug = daten.get('mandantSlug');
  return typeof slug === 'string' && slug !== '' ? { art: 'mandant', slug } : null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }

  const sitzung = await aktuelleSitzung();
  if (sitzung === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const ziel = await zielAus(anfrage);
  // Ein fehlendes Ziel ist eine kaputte Anfrage und keine fehlende Berechtigung.
  if (ziel === null) return NextResponse.json({ fehler: 'kein_ziel' }, { status: 400 });

  const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
    wechsleMandant(tx, sitzung, ziel)) as Promise<Wechsel>);

  if (ergebnis.art === 'unbekannt') {
    /**
     * 404 und nicht 403 — fuer den unbekannten Slug, fuer die fehlende
     * Mitgliedschaft und fuer die verwehrte Gruppenansicht dieselbe Antwort
     * (AUT-06, SEC-A3). Jede Unterscheidung bestaetigte, dass es die
     * Gesellschaft gibt.
     */
    return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
  }

  const pfad = ziel.art === 'gruppe' ? '/portal/gruppe' : `/portal/${ziel.slug}`;
  const jsonGewuenscht = (anfrage.headers.get('content-type') ?? '')
    .includes('application/json');
  if (jsonGewuenscht) return NextResponse.json({ ziel: pfad }, { status: 200 });

  // 303: die Antwort auf ein POST wird per GET geholt — sonst fragt der
  // Browser beim Zurueckgehen, ob er den Wechsel wiederholen soll.
  return NextResponse.redirect(new URL(pfad, anfrage.nextUrl.origin), 303);
}
