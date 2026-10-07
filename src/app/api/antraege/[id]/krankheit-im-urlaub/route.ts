import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { anmeldungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  erfasseKrankheitImUrlaub, KrankheitImUrlaubFehler, type KrankheitImUrlaubErgebnis,
} from '@/server/services/abwesenheit/krankheit-im-urlaub';
import { liesRumpf } from '../../../rumpf';

/**
 * `POST /api/antraege/[id]/krankheit-im-urlaub` — die Krankheit im genehmigten
 * Urlaub erfassen und die Urlaubstage gutschreiben (V-319, O-138, D-853,
 * § 9 BUrlG).
 *
 * **Zwei Rechte, weil es zwei Handlungen in einer Transaktion sind:** die
 * Krankheit aufnehmen (`zeit.abwesenheit_melden`) und ändern, was der
 * genehmigte Urlaub kostet (`zeit.abwesenheit_genehmigen` — dieselbe
 * Entscheidung wie eine Stornierung). Beide fragt auch die Datenbankfunktion.
 *
 * Die Arbeit tut der Dienst; diese Datei autorisiert, ruft und übersetzt.
 * Ein Formular bekommt seine Seite zurück — mit `?krankheit=erfasst` oder
 * `?krankheit_fehler=<grund>`, nie mit einem Satz (D-753).
 */
export const dynamic = 'force-dynamic';

function zurueckMit(
  anfrage: NextRequest, zurueck: string | undefined, feld: string, wert: string,
): NextResponse | null {
  if (zurueck === undefined || zurueck === '') return null;
  const ziel = internesZiel(zurueck, '/portal', anfrage);
  ziel.searchParams.set(feld, wert);
  return NextResponse.redirect(ziel, 303);
}

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const { id } = await kontextParam.params;
  const rumpf = await liesRumpf(anfrage).catch(() => null);
  if (rumpf === null) {
    return NextResponse.json({ fehler: 'unlesbarer_rumpf' }, { status: 400 });
  }
  const f = rumpf.felder;
  const zurueck = f['zurueck'];

  let ergebnis: KrankheitImUrlaubErgebnis;
  try {
    ergebnis = await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));
        const wer = {
          benutzerId: sitzung.benutzerId,
          personId: sitzung.personId,
          aktiverMandantId: sitzung.aktiverMandantId,
          ansicht: sitzung.ansicht,
          aal: sitzung.aal,
          portal: sitzung.portal,
          sitzungId: sitzung.sitzungId,
        };
        await authorize(wer, { recht: 'zeit.abwesenheit_genehmigen', schreibend: true }, pruefer);
        await authorize(wer, { recht: 'zeit.abwesenheit_melden', schreibend: true }, pruefer);
        return erfasseKrankheitImUrlaub(kontext, {
          antragId: id,
          von: (f['von'] ?? '').trim(),
          bis: (f['bis'] ?? '').trim(),
          auVorliegt: f['au'] === 'ja',
          auBis: f['au_bis'] ?? null,
          bemerkung: f['bemerkung'] ?? null,
          abwesenheitsartId: f['art'] ?? null,
        });
      })) as KrankheitImUrlaubErgebnis;
  } catch (fehler) {
    if (fehler instanceof KrankheitImUrlaubFehler) {
      if (!rumpf.json) {
        const seite = zurueckMit(anfrage, zurueck, 'krankheit_fehler', fehler.grund);
        if (seite !== null) return seite;
      }
      return NextResponse.json(
        { fehler: fehler.code, grund: fehler.grund, meldung: fehler.message },
        { status: fehler.status });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    const anmeldung = anmeldungsAntwort(fehler, anfrage);
    if (anmeldung !== null) return anmeldung;
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      if (!rumpf.json) {
        const seite = zurueckMit(anfrage, zurueck, 'krankheit_fehler', code);
        if (seite !== null) return seite;
      }
      return NextResponse.json({ fehler: code }, { status });
    }
    throw fehler;
  }

  if (rumpf.json) {
    return NextResponse.json({ ergebnis: 'ok', ...ergebnis }, { status: 200 });
  }
  return zurueckMit(anfrage, zurueck, 'krankheit', 'erfasst')
    ?? NextResponse.redirect(
      internesZiel(null, `/portal/${f['mandant'] ?? ''}/personal/antraege/${id}`, anfrage), 303);
}
