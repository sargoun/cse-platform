import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { anmeldungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import {
  aendereReinigungsklasse, archiviereReinigungsklasse, legeReinigungsklasseAn,
  pruefeKlasseEingabe,
} from '@/server/services/stammdaten/reinigungsklasse';
import { StammdatenFehler } from '@/server/services/stammdaten/katalog';
import { mitHinweis } from '@/server/rueckmeldung/hinweis-keks';
import { portalPfad, slugDesAktivenMandanten } from '@/server/auth/aktiver-slug';

/**
 * `POST /api/stammdaten/reinigungsklassen?was=anlegen|aendern|archivieren` —
 * den Reinigungsklassenkatalog pflegen (OPS-02, O-55).
 *
 * Der Handler bleibt duenn. Dass ein Code nur einmal AKTIV vorkommt,
 * entscheidet `reinigungsklasse_code_uk`; geloescht wird nie
 * (`kern.verhindere_loeschung`, Invariante 8), das Ende einer Klasse ist
 * `archiviert_am`.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN: ReadonlySet<string> = new Set(['anlegen', 'aendern', 'archivieren']);

function zurueck(anfrage: NextRequest, slug: string, hinweis?: string): NextResponse {
  const url = new URL(
    portalPfad(slug, `/stammdaten/reinigungsklassen`), erwarteterUrsprung(anfrage));
  return mitHinweis(NextResponse.redirect(url, 303), url, hinweis);
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }
  const slug = await slugDesAktivenMandanten(sitzung);
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
            throw new StammdatenFehler('ungueltig', 'Ohne Klasse gibt es nichts zu tun.');
          }
          await archiviereReinigungsklasse(kontext, id);
          return zurueck(anfrage, slug,
            'Die Klasse ist archiviert; ihr Code ist damit wieder frei. Die Räume '
            + 'behalten ihre Einstufung — umgestuft wird im Raumbuch, von einem '
            + 'Menschen (O-693).');
        }

        const eingabe = pruefeKlasseEingabe(text);

        if (was === 'anlegen') {
          await legeReinigungsklasseAn(kontext, eingabe);
          return zurueck(anfrage, slug,
            `Die Klasse „${eingabe.code}" ist angelegt.`
            + (eingabe.bestaetigt
              ? ''
              : ' Sie ist als Voreinstellung hinterlegt (O-55) und steht im Raumbuch mit '
                + 'dieser Marke.'));
        }

        const id = text('id');
        if (id === null) {
          throw new StammdatenFehler('ungueltig', 'Ohne Klasse gibt es nichts zu tun.');
        }
        await aendereReinigungsklasse(kontext, id, eingabe);
        return zurueck(anfrage, slug,
          `„${eingabe.code}" ist gespeichert. Bereits zugeordnete Räume hängen an der `
          + 'Zeile und nicht am Code — sie bleiben zugeordnet.');
      }))) as NextResponse;
  } catch (fehler: unknown) {
    if (fehler instanceof StammdatenFehler) return zurueck(anfrage, slug, fehler.message);
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    const anmeldung = anmeldungsAntwort(fehler, anfrage);
    if (anmeldung !== null) return anmeldung;
    throw fehler;
  }
}
