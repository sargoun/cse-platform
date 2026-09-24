import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, erwarteterUrsprung } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtAngemeldetFehler, NichtGefundenFehler, ZweiterFaktorFehler }
  from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import { berlinTagesZeitpunkt } from '@/server/services/zeit/dauer';
import { CrmFehler } from '@/server/services/crm/anlegen';
import { AKTIVITAET_TYPEN, halteLeadAktivitaetFest } from '@/server/services/crm/lead-kontakt';

/**
 * `POST /api/lead` — eine Notiz festhalten und die naechste Aktion setzen
 * (CRM-04, CRM-06).
 *
 * **Eine Aktivitaet wird angelegt, nie geaendert.** Ein
 * Kommunikationsverlauf, den man nachtraeglich umschreiben kann, ist kein
 * Verlauf; er ist eine Erzaehlung. Deshalb gibt es hier nur INSERT — und
 * `geschehen_am` kommt vom Server.
 *
 * `naechste_aktion_*` steht dagegen auf dem Lead und wird ersetzt: das ist
 * eine Absicht ueber die Zukunft, kein Ereignis der Vergangenheit.
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
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };
  const leadId = text('leadId');
  if (leadId === null) return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });

  const typ = text('typ') ?? 'notiz';
  if (!(AKTIVITAET_TYPEN as readonly string[]).includes(typ)) {
    return NextResponse.json({ fehler: 'typ' }, { status: 400 });
  }

  try {
    const getroffen = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /*
         * **Die Aktivität hält der Dienst fest** (V-141, D-635): welcher Kanal,
         * welcher Ansprechpartner und — seit jeder Lead einen bekommen kann —
         * mit welchem ZWECK sie durch das UWG-Tor geht. Die Route schrieb
         * jede ausgehende Zeile als `vertraglich`; für eine Anfrage, die
         * niemand gestellt hat, wäre das ein Weg am Werbetor vorbei.
         */
        const notiz = text('inhalt');
        if (notiz !== null) {
          await halteLeadAktivitaetFest(kontext, leadId, {
            typ,
            richtung: text('richtung') ?? 'intern',
            inhalt: notiz,
            betreff: text('betreff') ?? undefined,
            benutzerId: sitzung.benutzerId,
          });
        }

        const aktion = text('naechsteAktion');
        const am = text('naechsteAktionAm');
        if (aktion !== null || am !== null) {
          await kontext.abfrage(
            `update lead
                set naechste_aktion_text = $2, naechste_aktion_am = $3::timestamptz
              where id = $1`,
            /**
             * 09:00 EUROPE/BERLIN, nicht 09:00+01:00.
             *
             * Ein fester Versatz ist die halbe Jahreshaelfte richtig: von
             * Ende Maerz bis Ende Oktober gilt +02:00, und die Wiedervorlage
             * laege eine Stunde daneben. Sichtbar ist im Formular nur das
             * Datum — die Erinnerung kaeme trotzdem zur falschen Zeit
             * (Invariante 2).
             */
            [leadId, aktion, am === null ? null : berlinTagesZeitpunkt(am, 9)],
          );
        }

        const [z] = await kontext.abfrage<{ id: string }>(
          `select id from lead where id = $1`, [leadId]);
        return z !== undefined;
      })) as Promise<boolean>);

    if (!getroffen) return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });

    const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
    return NextResponse.redirect(
      new URL(`/portal/${slug}/crm/leads/${leadId}`, erwarteterUrsprung(anfrage)), 303);
  } catch (fehler) {
    /* Ein Fehler, der als Satz auf dem Leadblatt ankommt, nicht als 500. */
    if (fehler instanceof CrmFehler) {
      const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
      return NextResponse.redirect(new URL(
        `/portal/${slug}/crm/leads/${leadId}?fehler=${encodeURIComponent(fehler.grund)}`,
        erwarteterUrsprung(anfrage)), 303);
    }
    if (fehler instanceof NichtAngemeldetFehler) {
      return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
    }
    if (fehler instanceof ZweiterFaktorFehler) {
      return NextResponse.json({ fehler: 'zweiter_faktor' }, { status: 403 });
    }
    if (fehler instanceof NichtGefundenFehler) {
      return NextResponse.json({ fehler: 'unbekannt' }, { status: 404 });
    }
    throw fehler;
  }
}
