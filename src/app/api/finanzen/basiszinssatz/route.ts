import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  BasiszinsFehler, pruefeHalbjahr, pruefeQuelle, prozentInBasispunkte, setzeBasiszinssatz,
} from '@/server/services/finanz/mahnung/basiszinssatz';

/**
 * `POST /api/finanzen/basiszinssatz` — den Basiszinssatz nach § 247 BGB für
 * ein Kalenderhalbjahr eintragen oder korrigieren (V-299, O-358, FIN-15,
 * D-809).
 *
 * **`system.referenzdaten_verwalten` mit zweitem Faktor** — das Recht, das
 * die Policies von `basiszinssatz` verlangen (0125), dazu eine
 * Super-Administration: der Satz gehört keiner Gesellschaft. Der Dienst fragt
 * sie selbst, bevor die Policy es mit einer Ausnahme ohne Grund täte.
 *
 * **Zurück geht nur ein Schlüssel** (V-275, D-769): `?basiszins=<schlüssel>`
 * auf Einstellungen › Mahnwesen; die Seite schlägt den Satz nach. Der Slug
 * kommt aus der SITZUNG (Invariante 3). Das späteste Jahr der Eingabe liest
 * die Route aus der Datenbank (`app.berlin_heute()`), nicht aus der Uhr des
 * Node-Prozesses (K-11).
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert : '';
  };
  let ziel = '/portal';

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'system.referenzdaten_verwalten', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [aktiv] = await kontext.abfrage<{ slug: string; jahr: number }>(
          `select m.slug, extract(year from app.berlin_heute())::int as jahr
             from mandant m where m.id = app.aktiver_mandant()`);
        if (aktiv !== undefined) ziel = `/portal/${aktiv.slug}/einstellungen/mahnwesen`;
        const bisJahr = (aktiv?.jahr ?? 0) + 1;
        return setzeBasiszinssatz(kontext, {
          halbjahr: pruefeHalbjahr(feld('jahr'), feld('haelfte'), bisJahr),
          satzBp: prozentInBasispunkte(feld('satz')),
          quelle: pruefeQuelle(feld('quelle')),
        });
      })) as Promise<string>);
    return zurueck(anfrage, ziel, ergebnis);
  } catch (fehler) {
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    if (fehler instanceof BasiszinsFehler) return zurueck(anfrage, ziel, fehler.grund);
    throw fehler;
  }
}

/** 303 auf das Mahnwesen mit genau EINEM Schlüssel — nie einem Satz (V-275, D-769). */
function zurueck(anfrage: NextRequest, ziel: string, schluessel: string): NextResponse {
  const adresse = internesZiel(ziel, ziel, anfrage);
  adresse.searchParams.set('basiszins', schluessel);
  adresse.hash = 'basiszins';
  return NextResponse.redirect(adresse, 303);
}
