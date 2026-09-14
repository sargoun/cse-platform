import type postgres from 'postgres';
import { isIP } from 'node:net';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  entscheideFreigabe, FreigabeAbgewiesen, type Entschieden, type EntscheidungsArt,
} from '@/server/services/freigabe/entscheiden';
import { AusfuehrungAbgewiesen, fuehreAus, type Ausgefuehrt }
  from '@/server/services/freigabe/ausfuehrung';
import { armiereRuecknahme } from '@/server/services/freigabe/stapel';

/**
 * `POST /api/freigaben/[id]/entscheidung` — genehmigen oder ablehnen (APR-07,
 * APR-08, K-13).
 *
 * **POST und kein GET.** Ein Uebergang, den ein weitergeleiteter Link
 * ausloesen kann, ist keiner, den jemand entschieden hat. Der Ursprung wird
 * geprueft wie bei jedem schreibenden Handler; die Sitzung muss genau einen
 * aktiven Mandanten haben (Invariante 10) und `freigabe.entscheiden` halten —
 * das Recht der ANFRAGE prueft der Definer noch einmal selbst.
 *
 * **`geoeffnet_am` im Rumpf ist ein 400** (T-36). Die Pruefdauer misst der
 * Server aus `freigabe_ansicht`; ein Zeitstempel des Clients ist nicht
 * „ueberfluessig", sondern der Versuch, den APR-08 abwehren soll.
 *
 * Zwei Antwortformen: ein Formular (die Seite) bekommt 303 zurueck auf die
 * Freigabe, ein JSON-Aufrufer die Kettennummer und den Hash. Abweisungen
 * der Datenbank, die ein Mensch lesen soll, sind 409 — kein 500.
 */
export const dynamic = 'force-dynamic';

/** Ein Wort ist keine Kennung — ohne die Wache waere `where id = $1` ein 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const ARTEN: readonly EntscheidungsArt[] = ['genehmigt', 'abgelehnt'];

interface Eingabe {
  readonly entscheidung: string | null;
  readonly begruendung: string | null;
  readonly geoeffnetAmGesendet: boolean;
  readonly json: boolean;
}

async function liesEingabe(anfrage: NextRequest): Promise<Eingabe> {
  const typ = anfrage.headers.get('content-type') ?? '';
  const text = (wert: unknown): string | null =>
    (typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null);
  if (typ.includes('application/json')) {
    const rumpf = (await anfrage.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      entscheidung: text(rumpf['entscheidung']),
      begruendung: text(rumpf['begruendung'] ?? rumpf['kommentar']),
      geoeffnetAmGesendet: 'geoeffnet_am' in rumpf,
      json: true,
    };
  }
  const daten = await anfrage.formData();
  return {
    entscheidung: text(daten.get('entscheidung')),
    begruendung: text(daten.get('begruendung') ?? daten.get('kommentar')),
    geoeffnetAmGesendet: daten.has('geoeffnet_am'),
    json: false,
  };
}

/** Die erste Adresse in `x-forwarded-for`, wenn sie eine ist — sonst nichts. */
function herkunftsAdresse(anfrage: NextRequest): string | null {
  const roh = anfrage.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? anfrage.headers.get('x-real-ip')?.trim() ?? '';
  return isIP(roh) === 0 ? null : roh;
}

function codeVersion(): string {
  return process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['CSE_CODE_VERSION'] ?? 'entwicklung';
}

export async function POST(
  anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const eingabe = await liesEingabe(anfrage);
  if (eingabe.geoeffnetAmGesendet) {
    return NextResponse.json(
      { fehler: 'geoeffnet_am_nicht_erlaubt',
        meldung: 'Die Pruefdauer misst der Server (APR-08); geoeffnet_am gehoert in keinen Rumpf.' },
      { status: 400 });
  }
  if (eingabe.entscheidung === null
      || !ARTEN.includes(eingabe.entscheidung as EntscheidungsArt)) {
    return NextResponse.json({ fehler: 'entscheidung_fehlt' }, { status: 400 });
  }
  const art = eingabe.entscheidung as EntscheidungsArt;

  let slug = '';
  try {
    const ergebnis = await (db().begin(
      async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
        await authorize(sitzung, { recht: 'freigabe.entscheiden', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)));
        const [m] = await kontext.abfrage<{ slug: string; aktion: string }>(
          `select m.slug, f.aktion from mandant m
             join freigabe f on f.mandant_id = m.id
            where m.id = $1 and f.id = $2::uuid`, [kontext.aktiverMandantId, id]);
        slug = m?.slug ?? '';
        const entschieden = await entscheideFreigabe(kontext, {
          freigabeId: id,
          art,
          begruendung: eingabe.begruendung,
          ip: herkunftsAdresse(anfrage),
          userAgent: anfrage.headers.get('user-agent'),
          codeVersion: codeVersion(),
        });
        /*
         * **Die Handlung folgt der Genehmigung — hier, in derselben
         * Transaktion** (§4.8). Was der Vorschlag angekuendigt hat, geschieht
         * jetzt; scheitert es, rollt die Entscheidung mit zurueck, und der
         * Vorschlag steht wieder offen.
         */
        const ausgefuehrt: Ausgefuehrt = art === 'genehmigt'
          ? await fuehreAus(kontext, id, m?.aktion ?? '')
          : { art: 'keine', bezugId: null };

        /**
         * **Das Ruecknahmefenster (APR-06) — und nur, wo es etwas zurueckzunehmen
         * gibt.** Ein Knopf „rueckgaengig", der bei einem versendeten E-Mail
         * nichts tut, ist schlimmer als keiner: jemand drueckt ihn und glaubt,
         * es sei zurueckgeholt.
         */
        if (ausgefuehrt.art !== 'keine') await armiereRuecknahme(kontext, id);
        return { entschieden, ausgefuehrt };
      }))) as { entschieden: Entschieden; ausgefuehrt: Ausgefuehrt };

    if (eingabe.json) {
      return NextResponse.json({
        snapshot_id: ergebnis.entschieden.snapshotId,
        kette_nr: ergebnis.entschieden.ketteNr.toString(),
        hash: ergebnis.entschieden.hash,
        ausgefuehrt: ergebnis.ausgefuehrt.art,
        bezug_id: ergebnis.ausgefuehrt.bezugId,
      });
    }
    const ziel = new URL(`/portal/${slug}/freigaben/${id}`, anfrage.nextUrl.origin);
    ziel.searchParams.set('entschieden', art);
    if (ergebnis.ausgefuehrt.art !== 'keine') ziel.searchParams.set('ausgefuehrt', ergebnis.ausgefuehrt.art);
    return NextResponse.redirect(ziel, 303);
  } catch (fehler: unknown) {
    if (fehler instanceof AusfuehrungAbgewiesen) {
      if (eingabe.json) {
        return NextResponse.json(
          { fehler: 'ausfuehrung', grund: fehler.grund, meldung: fehler.message }, { status: 409 });
      }
      const ziel = new URL(`/portal/${slug}/freigaben/${id}`, anfrage.nextUrl.origin);
      ziel.searchParams.set('fehler', 'ausfuehrung');
      ziel.searchParams.set('meldung', fehler.message);
      return NextResponse.redirect(ziel, 303);
    }
    if (fehler instanceof FreigabeAbgewiesen) {
      if (eingabe.json) {
        return NextResponse.json(
          { fehler: fehler.grund, meldung: fehler.message, hinweis: fehler.hinweis },
          { status: 409 });
      }
      return NextResponse.redirect(
        new URL(`/portal/${slug}/freigaben/${id}?fehler=${fehler.grund}`, anfrage.nextUrl.origin),
        303);
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    throw fehler;
  }
}
