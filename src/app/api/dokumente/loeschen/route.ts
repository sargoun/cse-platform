import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { istUuid } from '@/lib/uuid';
import { waehleSpeicher } from '@/server/storage/waehle';
import { LoeschungFehler, loescheDokument } from '@/server/services/dokument/loeschung';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/dokumente/loeschen` — ein Dokument samt Datei entfernen
 * (V-026, DOC-07, LEG-01).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Befund.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `services/dokument/loeschung.ts` ist der EINE Weg, auf dem ein Dokument
 * verschwindet — gebaut, geprüft, mit zwei Auslösern dahinter. Aufgerufen
 * hat ihn genau einer: der Nachtlauf `dokument_aufbewahrung` (V-116). **Ein
 * MENSCH konnte nichts löschen** — auch nicht die Datei, die vor zwei Minuten
 * versehentlich beim falschen Kunden landete. `dokument.archivieren` stand im
 * Katalog, an `super_admin`, `admin` und `leitung` gebunden, und keine Seite
 * und keine Route fragten danach.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Diese Route entscheidet NICHTS über Aufbewahrung — das tut die Datenbank.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `kern.dokument_loeschsperre` (0009) weist ein gesperrtes Dokument ab,
 * `fin.dokument_haengt_an_buchung` (0132) eines, auf das sich eine
 * Buchungszeile beruft — unabhängig von Kategorie und Frist. Beides steht VOR
 * der Zeile und gilt für jeden Weg, auch für diesen. Der Handler prüft es
 * nicht noch einmal nach: ein zweiter Nachbau ginge beim ersten Unterschied
 * auseinander, und dann gälte die bequemere der beiden Fassungen.
 *
 * **Die Frist ist kein Riegel, und das ist eine Beobachtung, keine
 * Entscheidung dieser Datei.** Nur `loeschsperre` sperrt; `aufbewahrung_bis`
 * steuert den Nachtlauf. Ein versehentlich abgelegtes Angebots-PDF sechs
 * Jahre lang stehen lassen zu müssen, wäre keine Aufbewahrung, sondern ein
 * fehlender Weg — die Seite sagt deshalb, wenn die Frist noch läuft, und
 * verlangt denselben Grund wie sonst.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ohne verbundenen Speicher wird NICHT gelöscht.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `loescheDokument` löscht erst die Zeile, dann das Objekt; scheitert das
 * Zweite, rollt die Transaktion das Erste zurück. Das hält — nur bekäme ein
 * Mensch dafür einen 500er. Gefragt wird deshalb vorher, und die Antwort ist
 * ein Satz: eine Zeile ohne ihre Datei wäre ein Dokument, das als gelöscht
 * gilt und im Bucket liegt.
 */
export const dynamic = 'force-dynamic';

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const dokumentId = String(daten.get('dokument') ?? '');
  const grund = String(daten.get('grund') ?? '');
  if (!istUuid(dokumentId)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  let slug = '';
  const blatt = (): string => `/portal/${slug}/dokumente/${dokumentId}`;
  const liste = (): string => `/portal/${slug}/dokumente`;

  const speicher = waehleSpeicher();

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'dokument.archivieren', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const [bereich] = await kontext.abfrage<{ slug: string }>(
          `select m.slug from mandant m where m.id = app.aktiver_mandant()`);
        if (bereich === undefined) throw new NichtGefundenFehler('Bereich ohne Slug');
        slug = bereich.slug;

        if (!speicher.verbunden) {
          throw new LoeschungFehler(
            'Der Dateispeicher ist nicht verbunden. Es wird nichts gelöscht — eine '
            + 'Zeile ohne ihre Datei wäre ein Dokument, das als gelöscht gilt und im '
            + 'Bucket liegt.', 'gesperrt');
        }
        await loescheDokument(kontext, speicher, { dokumentId, grund });
      }));
  } catch (fehler) {
    if (fehler instanceof LoeschungFehler) {
      const ziel = `${blatt()}?fehler=${fehler.grund}`;
      return NextResponse.redirect(internesZiel(ziel, ziel, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  /*
   * Zurück auf die LISTE und nicht auf das Blatt: das Blatt liest
   * `geloescht_am is null` und wäre nach dem Löschen ein 404 — die letzte
   * Antwort auf eine geglückte Handlung darf keine Fehlerseite sein.
   */
  const ziel = `${liste()}?geloescht=1`;
  return NextResponse.redirect(internesZiel(ziel, ziel, anfrage), 303);
}
