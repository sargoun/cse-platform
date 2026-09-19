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
import { VorlagenFehler, setzeBehinderungsvorlage }
  from '@/server/services/einstellung/vorlagen';

/**
 * `POST /api/einstellungen/vorlagen` — eine Behinderungsvorlage bestaetigen
 * (BAU-06, § 6 VOB/B).
 *
 * **ZWEI Rechte, und beide werden geprueft.** `system.einstellung_verwalten`
 * ist das Recht der Seite (04-SEITENKARTE §5.24); `bau.schreiben` ist das
 * Recht der TABELLE (`behinderung_vorlage`, Policy `t_mandant`). Nur das
 * erste zu pruefen hiesse, dass die Schreibung durch den Handler kommt und
 * von der Datenbank abgewiesen wird — mit null betroffenen Zeilen und ohne
 * Fehlermeldung, also mit einer Erfolgsmeldung fuer eine Aenderung, die nicht
 * stattgefunden hat. Genau diese Lage meint Invariante 3 mit „RLS ist die
 * zweite Linie, niemals die einzige".
 *
 * Geweitet wird die RLS dafuer nicht: eine Erklaerung nach § 6 VOB/B gehoert
 * dem Bau, nicht der Verwaltung.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/einstellungen/vorlagen`, erwarteterUrsprung(anfrage));
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
  const text = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };

  const schluessel = text('schluessel');
  if (schluessel === '') {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));
        await authorize(
          sitzung, { recht: 'system.einstellung_verwalten', schreibend: true }, pruefer);
        /* Das Recht der TABELLE — sonst weist die RLS still ab (siehe Kopf). */
        await authorize(sitzung, { recht: 'bau.schreiben', schreibend: true }, pruefer);
        await setzeBehinderungsvorlage(kontext, {
          schluessel,
          bezeichnung: text('bezeichnung'),
          fundstelle: text('fundstelle'),
          betreff: text('betreff'),
          rumpf: text('rumpf'),
        });
        return zurueck(anfrage,
          `Die Vorlage „${schluessel}" ist bestätigt. Die bisherige Fassung ist `
          + 'archiviert und bleibt lesbar — eine versendete Anzeige behält ihren '
          + 'damaligen Wortlaut.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /* Der Aufrufer ist ein Formular, also bekommt er eine SEITE mit dem Satz. */
    if (fehler instanceof VorlagenFehler) return zurueck(anfrage, fehler.message);
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
