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
import {
  aendereQualifikation, archiviereQualifikation, legeQualifikationAn,
  pruefeQualifikationEingabe,
} from '@/server/services/stammdaten/qualifikation';
import { StammdatenFehler } from '@/server/services/stammdaten/katalog';

/**
 * `POST /api/stammdaten/qualifikationen?was=anlegen|aendern|archivieren` — den
 * Qualifikationskatalog pflegen (SEC-01, SEC-04, EMP-08).
 *
 * Der Handler bleibt duenn. Dass eine plattformweite Zeile nur dem Super-Admin
 * offensteht, entscheidet `q_schreiben`/`q_aendern` (0030, §6.16) — nicht
 * dieser Handler; der Dienst uebersetzt die Abweisung in einen Satz.
 *
 * **`blockiert_einsatz` geht durch dieselbe Pruefung wie jedes andere Feld.**
 * Kein zweites Recht, keine zusaetzliche Freigabe — aber eine Protokollzeile
 * je Aenderung (`stammdaten.qualifikation_geaendert`), denn „seit wann sperrt
 * das" ist eine Frage, die im Streitfall gestellt wird.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN: ReadonlySet<string> = new Set(['anlegen', 'aendern', 'archivieren']);

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/stammdaten/qualifikationen`, erwarteterUrsprung(anfrage));
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
  const was = anfrage.nextUrl.searchParams.get('was') ?? '';
  if (!AKTIONEN.has(was)) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  const daten = await anfrage.formData();
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  try {
    return await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'stammdaten.verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'archivieren') {
          const id = text('id');
          if (id === null) {
            throw new StammdatenFehler('ungueltig',
              'Ohne Qualifikation gibt es nichts zu tun.');
          }
          await archiviereQualifikation(kontext, id);
          return zurueck(anfrage,
            'Die Qualifikation ist archiviert. Die erfassten Nachweise bleiben — ein '
            + 'abgelaufener Nachweis von vorletztem Jahr ist die Zeile, mit der eine '
            + 'Aufsicht einen vergangenen Einsatz prüft.');
        }

        const eingabe = pruefeQualifikationEingabe(text, text('plattform') === 'ja');

        if (was === 'anlegen') {
          await legeQualifikationAn(kontext, eingabe);
          return zurueck(anfrage,
            `„${eingabe.bezeichnung}" ist angelegt`
            + `${eingabe.plattform ? ' und gilt für alle vier Gesellschaften' : ''}.`
            + (eingabe.blockiertEinsatz
              ? ' Sie sperrt ab jetzt Einteilungen auf Posten, die sie verlangen, '
                + 'wenn kein gültiger Nachweis vorliegt (SEC-04).'
              : ''));
        }

        const id = text('id');
        if (id === null) {
          throw new StammdatenFehler('ungueltig',
            'Ohne Qualifikation gibt es nichts zu tun.');
        }
        await aendereQualifikation(kontext, id, eingabe);
        return zurueck(anfrage,
          `„${eingabe.bezeichnung}" ist gespeichert.`
          + (eingabe.blockiertEinsatz
            ? ' Die Einsatzsperre gilt ab sofort, auch für bereits geplante Schichten '
              + '— der Dienstplan weist die Zuweisung dann mit benanntem Grund ab.'
            : ''));
      }))) as NextResponse;
  } catch (fehler: unknown) {
    if (fehler instanceof StammdatenFehler) return zurueck(anfrage, fehler.message);
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
