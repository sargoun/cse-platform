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
import { IdentitaetFehler, setzeIdentitaet }
  from '@/server/services/mandant/identitaet';

/**
 * `POST /api/einstellungen/identitaet` — das Erscheinungsbild einer
 * Gesellschaft pflegen (TEN-07, PUB-09, LEG-07, DESIGN §11).
 *
 * Der Handler bleibt duenn: pruefen, den Dienst rufen, antworten. Welche
 * Felder ueberhaupt pflegbar sind, entscheidet nicht er, sondern
 * `setzeIdentitaet` — Farbe (Token, DESIGN §1), Bildpfade (die setzt
 * `/api/einstellungen/identitaet/bild` mit der Datei, V-100) und Profiltexte
 * (je Sprache in `unternehmensprofil`, D-82) sind bewusst nicht dabei.
 *
 * `system.identitaet_verwalten` und nicht `system.mandant_verwalten`: das
 * Erscheinungsbild ist nicht die Firmierung. Wer das Logo pflegt, aendert
 * damit keine Registernummer — und umgekehrt.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/einstellungen/identitaet`, erwarteterUrsprung(anfrage));
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

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const kurzname = text('kurzname');
  if (kurzname === null) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'system.identitaet_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        await setzeIdentitaet(kontext, {
          kurzname,
          claim: text('claim'),
          logoAlt: text('logoAlt'),
          avatarAlt: text('avatarAlt'),
          coverAlt: text('coverAlt'),
          briefFuss: text('briefFuss'),
          rechnungFuss: text('rechnungFuss'),
          angebotFuss: text('angebotFuss'),
          emailAbsender: text('emailAbsender'),
          emailSignatur: text('emailSignatur'),
          oeffentlichSichtbar: text('oeffentlichSichtbar') === 'ja',
        });
        return zurueck(anfrage,
          'Die Identität ist gespeichert. Auf bereits festgeschriebene Rechnungen '
          + 'wirkt eine geänderte Fusszeile nie (K-12).');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /* Der Aufrufer ist ein Formular, also bekommt er eine SEITE mit dem Satz. */
    if (fehler instanceof IdentitaetFehler) return zurueck(anfrage, fehler.message);
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
