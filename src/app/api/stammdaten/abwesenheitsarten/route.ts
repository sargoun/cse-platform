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
  aendereAbwesenheitsart, archiviereAbwesenheitsart, legeAbwesenheitsartAn,
  pruefeArtEingabe,
} from '@/server/services/stammdaten/abwesenheitsart';
import { StammdatenFehler } from '@/server/services/stammdaten/katalog';

/**
 * `POST /api/stammdaten/abwesenheitsarten?was=anlegen|aendern|archivieren` —
 * den Abwesenheitskatalog pflegen (EMP-05, K-17, O-139).
 *
 * Der Handler bleibt duenn: Ursprung, Sitzung, Recht, Dienst, Antwort. Ob eine
 * Zeile aenderbar ist, entscheidet nicht er, sondern die Policy
 * (`t_katalog_pflege` fuer eigene Zeilen, `t_plattform_aendern` fuer die
 * Plattformstufe, 0275) — und der Ausloeser `kern.abwesenheitsart_schutz`
 * noch einmal. Der Dienst uebersetzt beides in einen Satz.
 *
 * `stammdaten.verwalten` ist das Recht der Seite UND das der Tabelle: hier gibt
 * es keinen Rechtebruch zu ueberbruecken.
 *
 * **Geloescht wird nie** (Invariante 8). Es gibt deshalb kein `DELETE` und
 * keine Aktion `loeschen`, sondern nur `archivieren`.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN: ReadonlySet<string> = new Set(['anlegen', 'aendern', 'archivieren']);

function zurueck(anfrage: NextRequest, hinweis?: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const url = new URL(
    `/portal/${slug}/stammdaten/abwesenheitsarten`, erwarteterUrsprung(anfrage));
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
            throw new StammdatenFehler('ungueltig', 'Ohne Art gibt es nichts zu tun.');
          }
          await archiviereAbwesenheitsart(kontext, id);
          return zurueck(anfrage,
            'Die Art ist archiviert. Sie steht in keinem Antragsformular mehr und '
            + 'bleibt in jedem bestehenden Nachweis lesbar — gelöscht wird sie nie.');
        }

        const eingabe = pruefeArtEingabe(text, text('plattform') === 'ja');

        if (was === 'anlegen') {
          await legeAbwesenheitsartAn(kontext, eingabe);
          return zurueck(anfrage,
            `Die Art „${eingabe.bezeichnung}" ist angelegt`
            + `${eingabe.plattform ? ' und gilt für alle vier Gesellschaften' : ''}.`
            + (eingabe.bezahlt === null
              ? ' Solange „bezahlt" ungeklärt ist (O-139), weist die Abwesenheitsmeldung '
                + 'sie mit benanntem Grund ab.'
              : ''));
        }

        const id = text('id');
        if (id === null) {
          throw new StammdatenFehler('ungueltig', 'Ohne Art gibt es nichts zu tun.');
        }
        await aendereAbwesenheitsart(kontext, id, eingabe);
        return zurueck(anfrage,
          `„${eingabe.bezeichnung}" ist gespeichert.`
          + (eingabe.bezahlt === null
            ? ' „Bezahlt" bleibt ungeklärt (O-139) — die Art ist damit nicht verwendbar.'
            : ''));
      }))) as NextResponse;
  } catch (fehler: unknown) {
    /*
     * Der Aufrufer ist ein Formular, also bekommt er eine SEITE zurueck. Eine
     * JSON-Antwort mit 422 laesst den Browser eine Datei anzeigen, auf der
     * `{"fehler":"kollision"}` steht — der Mensch hat dann seine Eingabe
     * verloren und weiss nicht, was er tun soll.
     */
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
