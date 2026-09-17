import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { erwarteterUrsprung, internesZiel, istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  legeLvImportAn, LvImportFehler, uebernimmLvImport, verwerfeLvImport,
} from '@/server/services/bau/lv-import';
import { istLvFormat, LvQuelleFehler } from '@/server/services/bau/lv-quelle';

/**
 * `POST /api/bau/lv-import` — hochladen (mit Vorschau), übernehmen, verwerfen
 * (BAU-01, REQ-04, Muster OPS-04).
 *
 * **Drei Schritte, drei Aufrufe, und nur der zweite ändert ein
 * Leistungsverzeichnis.** Genau dazwischen sieht ein Mensch, was passieren
 * wird — das ist die Zusage von OPS-04, und ein Formular, das beides in einem
 * tut, hat sie nicht.
 *
 * **Geparst wird SERVERSEITIG, aus der Datei.** Die Vorschau kommt aus dem
 * Staging (`lv_import_zeile`) und nicht aus einem versteckten Feld des
 * Browsers: ein Übernehmen, das der Browser mit Daten füttert, übernimmt, was
 * der Browser behauptet (K-12).
 *
 * **`.xlsx` und GAEB werden ABGEWIESEN, nicht versucht.** Welches Format der
 * Auftraggeber schickt, ist offen (O-41); implementiert ist CSV mit
 * Semikolon. Ein halbfertiger GAEB-Leser meldet Erfolg und liefert ein
 * unvollständiges LV — das ist teurer als eine klare Auskunft
 * (`src/server/services/bau/lv-quelle.ts`).
 */
export const dynamic = 'force-dynamic';

/**
 * Fünf Megabyte, dieselbe Grenze wie beim Raumbuch-Import (0026).
 *
 * Ein LV als CSV liegt bei einigen Hundert Kilobyte; fünf MB lassen Luft für
 * ein Grossprojekt mit Langtexten und weisen den versehentlich hochgeladenen
 * Plan ab, bevor er den Prozess belegt.
 */
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
  const feld = (name: string): string => {
    const wert = daten.get(name);
    return typeof wert === 'string' ? wert.trim() : '';
  };
  const aktion = feld('aktion');
  const mandantSlug = feld('mandant');
  const projektId = feld('projekt');

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
          { recht: 'bau.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'uebernehmen') {
          const uebernahme = await uebernimmLvImport(kontext, feld('import'));
          return { art: 'uebernommen' as const, ...uebernahme };
        }
        if (aktion === 'verwerfen') {
          const ok = await verwerfeLvImport(kontext, feld('import'));
          return { art: 'verworfen' as const, ok };
        }

        const datei = daten.get('datei');
        if (!(datei instanceof File) || datei.size === 0) {
          return { art: 'ungueltig' as const, meldung: 'Es ist keine Datei angekommen.' };
        }
        if (datei.size > GRENZE_BYTES) {
          return { art: 'zu_gross' as const };
        }
        const format = feld('format');
        if (!istLvFormat(format)) {
          return {
            art: 'ungueltig' as const,
            meldung: 'Das Format fehlt oder ist keines der bekannten.',
          };
        }

        const angelegt = await legeLvImportAn(kontext, {
          projektId,
          dateiname: datei.name,
          format,
          bezeichnung: feld('bezeichnung') === ''
            ? `LV aus ${datei.name}` : feld('bezeichnung'),
          inhalt: await datei.text(),
        });
        return { art: 'geprueft' as const, ...angelegt };
      }))) as
        | { art: 'ungueltig'; meldung: string }
        | { art: 'zu_gross' }
        | { art: 'geprueft'; importId: string; gueltig: number; fehler: number }
        | { art: 'verworfen'; ok: boolean }
        | {
          art: 'uebernommen'; leistungsverzeichnisId: string; fassung: number;
          angelegt: number;
        };

    if (ergebnis.art === 'ungueltig') {
      return NextResponse.json(
        { fehler: 'unvollstaendig', meldung: ergebnis.meldung }, { status: 400 },
      );
    }
    if (ergebnis.art === 'zu_gross') {
      return NextResponse.json({ fehler: 'zu_gross' }, { status: 413 });
    }
    if (ergebnis.art === 'verworfen' && !ergebnis.ok) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }

    const basis = `/portal/${mandantSlug}/bau/projekte/${projektId}/lv/import`;
    if (ergebnis.art === 'geprueft') {
      if (mandantSlug === '' || projektId === '') return NextResponse.json(ergebnis);
      // Auf DIESELBE Adresse mit `?import=` — ein Vorgang, zwei Zustände.
      return NextResponse.redirect(
        new URL(`${basis}?import=${ergebnis.importId}`, erwarteterUrsprung(anfrage)), 303,
      );
    }

    if (mandantSlug === '' || projektId === '') return NextResponse.json(ergebnis);
    return NextResponse.redirect(internesZiel(
      feld('zurueck') === '' ? null : feld('zurueck'),
      ergebnis.art === 'uebernommen'
        ? `/portal/${mandantSlug}/bau/projekte/${projektId}/lv`
        : basis,
      anfrage,
    ), 303);
  } catch (fehler: unknown) {
    if (fehler instanceof LvQuelleFehler || fehler instanceof LvImportFehler) {
      return NextResponse.json(
        { fehler: fehler.grund, meldung: fehler.message }, { status: fehler.status },
      );
    }
    // AUT-06: ein fehlendes Recht sieht von aussen aus wie eine fehlende Zeile.
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
