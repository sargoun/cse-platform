import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant, type SchreibKontext } from '@/server/kontext/index';
import { cent } from '@/server/services/finanz/geld';
import {
  AbrechnungFehler, beendeKonfiguration, legeKonfigurationAn,
} from '@/server/services/finanz/abrechnungsart/index';

/**
 * `POST /api/abrechnung` — die Abrechnungsart eines Auftrags festlegen oder
 * beenden (FIN-01, O-04).
 *
 * **Das ist der Weg, auf dem O-04 eine Datenänderung wird statt einer
 * Codeänderung.** Die fünf Arten stehen im Register; ihre offenen Regeln
 * stehen als Parameter auf `vertrag_abrechnung`, und bis sie dort stehen,
 * rechnet keine Strategie. Wer sie einträgt, beantwortet die Frage für DIESEN
 * Vertrag — das ist die Stelle, an der sie beantwortbar ist, denn verhandelt
 * wird sie je Vertrag.
 *
 * Beide Handlungen tragen `abrechnung.schreiben` — dasselbe Recht, mit dem die
 * Seitenkarte die Seite bewacht. Eine bestehende Konfiguration wird NICHT
 * überschrieben, sondern beendet und durch eine neue abgelöst: die Grundlage
 * einer bereits festgeschriebenen Rechnung bleibt sonst nicht erklärbar
 * (FIN-06, K-12).
 *
 * Der Handler bleibt dünn: prüfen, den Dienst rufen, antworten.
 */
export const dynamic = 'force-dynamic';

function zurueck(anfrage: NextRequest, auftragId: string): NextResponse {
  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  return NextResponse.redirect(
    new URL(`/portal/${slug}/auftraege/${auftragId}/abrechnung`, anfrage.nextUrl.origin), 303);
}

/**
 * Die Parameter kommen als `schluessel=wert`-Zeilen, eine je Zeile.
 *
 * Kein freies JSON aus dem Formular: ein `jsonb`, das ein Browser schickt,
 * könnte jede Form haben — auch einen Geldbetrag, und genau der gehört nicht
 * hinein (0086). Zahlen werden als Zahlen übernommen, `null` als `null`, eine
 * Liste als kommagetrennte Werte. Alles andere bleibt Text.
 */
function leseParameter(roh: string | null): Record<string, unknown> {
  const parameter: Record<string, unknown> = {};
  for (const zeile of (roh ?? '').split('\n')) {
    const trennung = zeile.indexOf('=');
    if (trennung < 0) continue;
    const schluessel = zeile.slice(0, trennung).trim();
    const wert = zeile.slice(trennung + 1).trim();
    if (schluessel === '') continue;
    if (wert === 'null') { parameter[schluessel] = null; continue; }
    if (/^-?\d+$/u.test(wert)) { parameter[schluessel] = Number(wert); continue; }
    if (wert.includes(',')) {
      parameter[schluessel] = wert.split(',').map((w) => w.trim()).filter((w) => w !== '');
      continue;
    }
    parameter[schluessel] = wert;
  }
  return parameter;
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
  const centOderNull = (name: string) => {
    const wert = text(name);
    return wert === null ? null : cent(BigInt(wert));
  };

  const aktion = text('aktion') ?? 'anlegen';
  const auftragId = text('auftragId');
  if (auftragId === null) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext: SchreibKontext) => {
        await authorize(
          sitzung,
          { recht: 'abrechnung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (aktion === 'beenden') {
          const id = text('konfigurationId');
          const bis = text('gueltigBis');
          if (id === null || bis === null) return;
          await beendeKonfiguration(kontext, id, bis);
          return;
        }

        const art = text('abrechnungsart');
        const intervall = text('abrechnungsintervall');
        const modus = text('leistungszeitraumModus');
        const ab = text('gueltigAb');
        // Kein Vorgabewert für Art, Rhythmus und Leistungszeitraum (0086):
        // fehlt eines davon, wird nichts angelegt und nichts geraten.
        if (art === null || intervall === null || modus === null || ab === null) return;

        const ziel = text('zahlungszielTage');
        await legeKonfigurationAn(kontext, {
          auftragId,
          auftragLeistungId: text('auftragLeistungId'),
          abrechnungsart: art,
          parameter: leseParameter(text('parameter')),
          pauschaleNettoCent: centOderNull('pauschaleNettoCent'),
          stundensatzCent: centOderNull('stundensatzCent'),
          festpreisNettoCent: centOderNull('festpreisNettoCent'),
          abrechnungsintervall: intervall,
          leistungszeitraumModus: modus,
          zahlungszielTage: ziel === null ? null : Number(ziel),
          gueltigAb: ab,
          gueltigBis: text('gueltigBis'),
        });
      })));

    return zurueck(anfrage, auftragId);
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
    /**
     * Ein offener Parameter oder eine unbekannte Abrechnungsart ist eine
     * Abweisung, kein Programmfehler: 409 mit dem Text, der die offene Frage
     * nennt — und nicht 500.
     */
    if (fehler instanceof AbrechnungFehler) {
      return NextResponse.json({ fehler: fehler.grund, text: fehler.message }, { status: 409 });
    }
    throw fehler;
  }
}
