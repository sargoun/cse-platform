import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { schliesseMonatAb } from '@/server/services/zeit/stundenkonto';

/**
 * `POST /api/stundenkonto/[id]/monat-abschliessen` — einen Lohnmonat schliessen
 * (EMP-04, LEG-01; 05-API-KARTE §7.9).
 *
 * **Diese Datei rechnet nichts und sperrt nichts.** Sie autorisiert, ruft
 * `schliesseMonatAb` und uebersetzt dessen Fehler in Antworten. Die Reihenfolge
 * — verweigern, buchen, sperren, praegen — steht im Dienst, weil sie zur Regel
 * gehoert und nicht zum Transport.
 *
 * **Zweiter Faktor.** Der Abschluss ist unumkehrbar und erzeugt den
 * § 17-Nachweis; die API-Karte verlangt dafuer `sitzung+2fa`, und das ist hier
 * durchgesetzt und nicht nur beschrieben. Die Seite davor traegt kein `aal2` —
 * ansehen darf man die Konten mit `zeit.konto_lesen`, schliessen nicht.
 *
 * **POST von einem HTML-Formular**, weil der Monatsabschluss auf jedem Geraet
 * der Personalstelle funktionieren muss: `303` zurueck auf die Seite, die
 * Meldung in der Adresse. Ein JSON-Body waere fuer einen Browser ohne Skript
 * eine weisse Seite mit Text.
 */
export const dynamic = 'force-dynamic';

interface KontoKopf {
  anstellung_id: string;
  jahr: number;
  monat: number;
}

export async function POST(
  anfrage: NextRequest, kontextParam: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id } = await kontextParam.params;
  const daten = await anfrage.formData();
  const mandant = String(daten.get('mandant') ?? '');
  const monatRoh = String(daten.get('monat') ?? '');
  const ziel = `/portal/${mandant}/personal/stundenkonten/abschluss`
    + (/^\d{4}-\d{2}-\d{2}$/u.test(monatRoh) ? `?monat=${monatRoh}` : '');
  const trenner = ziel.includes('?') ? '&' : '?';

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'zeit.konto_abschliessen', schreibend: true, erfordert2fa: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /**
         * Monat und Beschaeftigung kommen aus dem KONTO, nicht aus dem
         * Formular. Sonst liesse sich ein fremder Monat schliessen, indem
         * jemand zwei Felder in der Anfrage vertauscht — und die Zeile, die es
         * traefe, stuende danach gesperrt da, ohne dass irgendetwas gemeldet
         * worden waere.
         */
        const [kopf] = await kontext.abfrage<KontoKopf>(
          `select anstellung_id, jahr, monat from stundenkonto where id = $1`, [id]);
        if (kopf === undefined) throw new NichtGefundenFehler(`Stundenkonto ${id}`);
        await schliesseMonatAb(kontext, {
          anstellungId: kopf.anstellung_id,
          jahr: Number(kopf.jahr),
          monat: Number(kopf.monat),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    const status = (fehler as { status?: number }).status;
    const code = (fehler as { code?: string }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      /**
       * Die fachlichen Fehler tragen ihre Meldung, und sie gehoert auf den
       * Bildschirm: „3 Zeiteintraege in 8/2026 sind nicht freigegeben" sagt,
       * was zu tun ist. Ein generisches „Abschluss fehlgeschlagen" zwaenge die
       * Personalstelle, den Grund zu raten.
       */
      return NextResponse.redirect(
        internesZiel(
          `${ziel}${trenner}fehler=${encodeURIComponent((fehler as Error).message)}`,
          ziel, anfrage),
        303,
      );
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${ziel}${trenner}geschlossen=${id}`, ziel, anfrage), 303,
  );
}
