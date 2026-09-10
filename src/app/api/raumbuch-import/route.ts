import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';

/**
 * Das Ziel nach dem Import — und warum `new URL(zurueck, basis)` nicht reicht.
 *
 * Ein ABSOLUTER Wert ignoriert die Basis: `new URL('https://boese.example',
 * 'https://cse.example')` ergibt `https://boese.example`. Das Feld `zurueck`
 * kommt aus dem Formular, also vom Aufrufer — ein praeparierter POST schickte
 * den angemeldeten Benutzer nach dem Import auf eine fremde Seite, und der
 * Weg dorthin begann sichtbar im eigenen Portal.
 *
 * Genommen wird darum nur der PFAD, und nur, wenn er im eigenen Ursprung
 * landet. Alles andere faellt auf das Standardziel zurueck — still, weil ein
 * Fehler hier dem Angreifer mehr saegte als dem Benutzer.
 */
export function internesZiel(
  zurueck: string | null | undefined, standard: string, anfrage: NextRequest,
): URL {
  const basis = new URL(anfrage.nextUrl.origin);
  if (zurueck === null || zurueck === undefined || zurueck === '') {
    return new URL(standard, basis);
  }
  try {
    const ziel = new URL(zurueck, basis);
    if (ziel.origin !== basis.origin) return new URL(standard, basis);
    // Nur Pfad, Abfrage und Anker uebernehmen — nie Anmeldedaten im Ziel.
    return new URL(`${ziel.pathname}${ziel.search}${ziel.hash}`, basis);
  } catch {
    return new URL(standard, basis);
  }
}
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { legeImportAn, uebernimm } from '@/server/services/raumbuch/import';
import { TabellenFehler } from '@/server/services/raumbuch/tabelle';

/**
 * `POST /api/raumbuch-import` — hochladen (mit Vorschau) und uebernehmen.
 *
 * Zwei Schritte, zwei Aufrufe, und der zweite ist der einzige, der das
 * lebende Raumbuch aendert. Genau dazwischen sieht ein Mensch, was passieren
 * wird — das ist OPS-04, und ein Formular, das beides in einem tut, hat
 * diese Zusage nicht.
 *
 * **`.xlsx` wird ABGEWIESEN.** Eine Excel-Datei ist ein ZIP mit XML; ein
 * halbfertiger Leser dafuer liest die erste Tabelle, uebersieht Formeln und
 * meldet trotzdem Erfolg. Bis eine geprueft Bibliothek eingerichtet ist,
 * nimmt der Import CSV — und sagt das, statt es zu versuchen.
 */
export const dynamic = 'force-dynamic';

const GRENZE_BYTES = 5 * 1024 * 1024;

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const aktion = daten.get('aktion');
  const mandantSlug = anfrage.nextUrl.searchParams.get('mandant') ?? '';

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
          { recht: 'objekt_import.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const dbSchicht = { abfrage: kontext.abfrage.bind(kontext) };

        if (aktion === 'uebernehmen') {
          const importId = daten.get('importId');
          if (typeof importId !== 'string' || importId === '') {
            return { art: 'ungueltig' as const };
          }
          const bilanz = await uebernimm(dbSchicht, importId, sitzung.benutzerId);
          return { art: 'uebernommen' as const, importId, bilanz };
        }

        const objektId = daten.get('objektId');
        const datei = daten.get('datei');
        if (typeof objektId !== 'string' || objektId === '' || !(datei instanceof File)) {
          return { art: 'ungueltig' as const };
        }
        if (datei.size > GRENZE_BYTES) return { art: 'zu_gross' as const };
        if (/\.xlsx?$/iu.test(datei.name)) return { art: 'kein_csv' as const };

        const inhalt = await datei.text();
        const { importId } = await legeImportAn(
          dbSchicht, objektId, datei.name, inhalt, sitzung.benutzerId);
        return { art: 'geprueft' as const, objektId, importId };
      })) as Promise<
        | { art: 'ungueltig' } | { art: 'zu_gross' } | { art: 'kein_csv' }
        | { art: 'geprueft'; objektId: string; importId: string }
        | { art: 'uebernommen'; importId: string; bilanz: unknown }>);

    if (ergebnis.art === 'ungueltig') {
      return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
    }
    if (ergebnis.art === 'zu_gross') {
      return NextResponse.json({ fehler: 'zu_gross' }, { status: 413 });
    }
    if (ergebnis.art === 'kein_csv') {
      return NextResponse.json({
        fehler: 'kein_csv',
        text: 'Excel-Dateien werden noch nicht gelesen. Bitte als CSV speichern '
          + '(Semikolon-getrennt) und erneut hochladen.',
      }, { status: 415 });
    }

    if (ergebnis.art === 'geprueft') {
      const ziel = `/portal/${mandantSlug}/objekte/${ergebnis.objektId}/raumbuch/import`
        + `?import=${ergebnis.importId}`;
      return NextResponse.redirect(new URL(ziel, anfrage.nextUrl.origin), 303);
    }

    const zurueck = anfrage.nextUrl.searchParams.get('zurueck');
    return NextResponse.redirect(
      internesZiel(zurueck, `/portal/${mandantSlug}/objekte`, anfrage), 303);
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
    if (fehler instanceof TabellenFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 400 });
    }
    throw fehler;
  }
}
