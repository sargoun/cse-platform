import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { internesZiel, istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { legeImportAn, uebernimm } from '@/server/services/raumbuch/import';
import {
  istTabellenkalkulation, leseTextDatei, TabellenFehler,
} from '@/server/services/raumbuch/tabelle';

/**
 * `POST /api/raumbuch-import` — hochladen (mit Vorschau) und uebernehmen.
 *
 * Zwei Schritte, zwei Aufrufe, und der zweite ist der einzige, der das
 * lebende Raumbuch aendert. Genau dazwischen sieht ein Mensch, was passieren
 * wird — das ist OPS-04, und ein Formular, das beides in einem tut, hat
 * diese Zusage nicht.
 *
 * **Excel wird ABGEWIESEN — erkannt am Inhalt, erklaert auf der Seite**
 * (V-171, D-665). Eine Excel-Datei ist ein ZIP mit XML; ein halbfertiger Leser
 * dafuer liest die erste Tabelle, uebersieht Formeln und meldet trotzdem
 * Erfolg. Die Plattform bringt keine Bibliothek dafuer mit (O-919). Bis das
 * entschieden ist, nimmt der Import CSV — auch die Windows-1252-Datei, die
 * ein deutsches Excel als „CSV (Trennzeichen-getrennt)" schreibt.
 *
 * **Jede Abweisung fuehrt auf die Importseite zurueck, mit dem Grund** (D-599).
 * Bis hierher antwortete die Route auf ein Formular mit einer weissen Seite
 * (`{"fehler":"kein_csv",…}`, HTTP 415) — und die Auswahl war weg. JSON
 * bleibt nur fuer die Faelle ohne Seite: keine Sitzung, kein Recht, fremder
 * Ursprung, unbekanntes Objekt (AUT-06: 404 statt Auskunft).
 *
 * **Der Bereich kommt aus der SITZUNG** (Invariante 3), nicht aus `?mandant=`:
 * wer in einem zweiten Reiter die Gesellschaft gewechselt hatte, landete
 * nach einem geglueckten Hochladen auf einer fremden Adresse.
 */
export const dynamic = 'force-dynamic';

const GRENZE_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Ergebnis =
  | { readonly art: 'abgewiesen'; readonly grund: string }
  | { readonly art: 'geprueft'; readonly objektId: string; readonly importId: string }
  | { readonly art: 'uebernommen'; readonly objektId: string };

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

  /*
   * Slug, Objekt und Import werden IN der Transaktion bestimmt und nach
   * aussen gereicht: auch der Fehlerzweig braucht sie, und ein Rollback nimmt
   * die Zuweisung an diesen Variablen nicht zurueck (dasselbe Muster wie
   * `api/radar/profil`).
   */
  let slug = '';
  let objekt: string | null = null;
  let importKennung: string | null = null;

  const zurImportseite = (grund: string, zeile: number | null = null): NextResponse => {
    const basis = objekt === null
      ? `/portal/${slug}/objekte`
      : `/portal/${slug}/objekte/${objekt}/raumbuch/import`;
    const q = new URLSearchParams();
    if (importKennung !== null) q.set('import', importKennung);
    q.set('fehler', grund);
    if (zeile !== null) q.set('zeile', String(zeile));
    return NextResponse.redirect(
      new URL(`${basis}?${q.toString()}`, erwarteterUrsprung(anfrage)), 303);
  };

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext): Promise<Ergebnis> => {
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
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;
        const dbSchicht = { abfrage: kontext.abfrage.bind(kontext) };

        if (aktion === 'uebernehmen') {
          const importId = daten.get('importId');
          if (typeof importId !== 'string' || !UUID.test(importId)) {
            return { art: 'abgewiesen', grund: 'unvollstaendig' };
          }
          const [imp] = await kontext.abfrage<{ objekt_id: string }>(
            `select objekt_id::text from raumbuch_import where id = $1`, [importId]);
          if (imp === undefined) throw new NichtGefundenFehler('Import unbekannt');
          objekt = imp.objekt_id;
          importKennung = importId;
          await uebernimm(dbSchicht, importId, sitzung.benutzerId);
          return { art: 'uebernommen', objektId: imp.objekt_id };
        }

        const objektId = daten.get('objektId');
        const datei = daten.get('datei');
        if (typeof objektId !== 'string' || !UUID.test(objektId)) {
          return { art: 'abgewiesen', grund: 'unvollstaendig' };
        }
        /*
         * Unter RLS: ein fremdes oder unbekanntes Objekt gibt es fuer diese
         * Sitzung nicht — 404, nicht „Import angelegt" mit einem
         * Fremdschluesselfehler dahinter.
         */
        const [sichtbar] = await kontext.abfrage<{ id: string }>(
          `select id from objekt where id = $1::uuid`, [objektId]);
        if (sichtbar === undefined) throw new NichtGefundenFehler('Objekt unbekannt');
        objekt = objektId;

        if (!(datei instanceof File) || datei.size === 0) {
          return { art: 'abgewiesen', grund: 'unvollstaendig' };
        }
        if (datei.size > GRENZE_BYTES) return { art: 'abgewiesen', grund: 'zu_gross' };
        const bytes = new Uint8Array(await datei.arrayBuffer());
        if (istTabellenkalkulation(datei.name, bytes.subarray(0, 8))) {
          return { art: 'abgewiesen', grund: 'excel' };
        }

        const { importId } = await legeImportAn(
          dbSchicht, objektId, datei.name, leseTextDatei(bytes), sitzung.benutzerId);
        return { art: 'geprueft', objektId, importId };
      })) as Promise<Ergebnis>);

    if (ergebnis.art === 'abgewiesen') return zurImportseite(ergebnis.grund);

    if (ergebnis.art === 'geprueft') {
      const ziel = `/portal/${slug}/objekte/${ergebnis.objektId}/raumbuch/import`
        + `?import=${ergebnis.importId}`;
      return NextResponse.redirect(new URL(ziel, erwarteterUrsprung(anfrage)), 303);
    }

    /* Ein Rueckweg aus dem Formular darf das Ziel nennen, nie den Bereich (D-562). */
    const zurueck = anfrage.nextUrl.searchParams.get('zurueck');
    return NextResponse.redirect(
      internesZiel(zurueck, `/portal/${slug}/objekte/${ergebnis.objektId}/raumbuch`, anfrage),
      303);
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
    if (fehler instanceof TabellenFehler && slug !== '') {
      return zurImportseite(fehler.grund, fehler.zeile);
    }
    throw fehler;
  }
}
