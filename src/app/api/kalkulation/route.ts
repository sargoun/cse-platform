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
import { setzeKostenposition } from '@/server/services/kalkulation/kostenposition';

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
 *
 * **Eine Abweisung fuehrt auf die Kalkulationsseite zurueck** (V-172, D-599):
 * mit dem Grund und dem Feld, das ihn ausloeste. Bis hierher kam jede
 * `KalkulationFehler` — ein unlesbarer Stundensatz, ein Zuschlag ausserhalb
 * des Bereichs — als weisse Seite `{"fehler":…,"text":…}` heraus. JSON bleibt
 * nur fuer keine Sitzung, kein Recht und fremden Ursprung.
 *
 * **Der Bereich kommt aus der SITZUNG** (Invariante 3), nicht aus
 * `?mandant=`.
 *
 * **Zweite Handlung: `aktion=kostenposition`** (V-174, OPS-07) — eine Material-
 * oder Gerätezeile anlegen oder berichtigen und den Preis neu rechnen.
 * Dasselbe Recht, dieselbe Seite, dieselbe Abweisung mit Feld: beides ändert,
 * worauf der Preis ruht. Gelöscht wird nichts (Invariante 8); eine Zeile, die
 * nicht mehr gelten soll, bekommt die Menge null.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

  const roh = text('angebotId');
  const angebotId = roh !== null && UUID.test(roh) ? roh : null;
  const basis = text('gemeinkostenBasis');
  const aktion = text('aktion') ?? 'bestaetigen';

  let slug = '';
  const zurSeite = (grund: string, feld: string | null): NextResponse => {
    const pfad = slug === '' ? '/portal'
      : angebotId === null ? `/portal/${slug}/angebote`
        : `/portal/${slug}/angebote/${angebotId}/kalkulation`;
    const ziel = new URL(pfad, erwarteterUrsprung(anfrage));
    ziel.searchParams.set('fehler', grund);
    if (feld !== null) ziel.searchParams.set('feld', feld);
    return NextResponse.redirect(ziel, 303);
  };

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
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
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;

        if (angebotId === null) {
          throw new KalkulationFehler('Kein Angebot benannt', 'nicht_gefunden');
        }
        if (aktion === 'kostenposition') {
          const positionId = text('positionId');
          if (positionId !== null && !UUID.test(positionId)) {
            throw new KalkulationFehler('Diese Kostenzeile gibt es nicht', 'nicht_gefunden');
          }
          await setzeKostenposition(kontext, angebotId, {
            kostenart: text('kostenart') ?? '',
            bezeichnung: text('bezeichnung') ?? '',
            menge: text('menge') ?? '',
            einheit: text('einheit') ?? '',
            einzelpreisEuro: text('einzelpreis') ?? '',
            positionId,
          });
          return { bestaetigt: false };
        }
        if (basis === null) {
          throw new KalkulationFehler(
            'Die Gemeinkostenbasis fehlt', 'unvollstaendig', 'gemeinkostenBasis');
        }
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

    /* Nach einer Kostenzeile zurück auf die Kalkulation — dort steht, was sie bewirkt hat. */
    const ziel = aktion === 'kostenposition'
      ? `/portal/${slug}/angebote/${String(angebotId)}/kalkulation?kostenposition=1`
      : `/portal/${slug}/angebote/${String(angebotId)}`;
    return NextResponse.redirect(new URL(ziel, erwarteterUrsprung(anfrage)), 303);
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
    if (fehler instanceof KalkulationFehler && slug !== '') {
      return zurSeite(fehler.grund, fehler.feld);
    }
    throw fehler;
  }
}
