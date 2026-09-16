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

const TYPEN = new Set(['notiz', 'anruf', 'email', 'termin', 'aufgabe']);

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
  if (!TYPEN.has(typ)) return NextResponse.json({ fehler: 'typ' }, { status: 400 });

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

        const notiz = text('inhalt');
        if (notiz !== null) {
          /**
           * `betreff` ist NOT NULL, und das Formular fragt ihn nicht.
           *
           * Ein Pflichtfeld, das die Oberflaeche nicht erhebt, muss VOR dem
           * INSERT einen Wert bekommen — sonst antwortet die Datenbank mit
           * `23502` und der Benutzer sieht eine Fehlerseite fuer eine Notiz,
           * die er geschrieben hat. Fehlt er, traegt der Eintrag die ERSTE
           * ZEILE der Notiz: das ist es, was in einer Liste gelesen wird.
           */
          const ersteZeile = notiz.split('\n')[0] ?? notiz;
          const betreff = text('betreff')
            ?? (ersteZeile.length > 80 ? `${ersteZeile.slice(0, 79)}…` : ersteZeile);
          await kontext.abfrage(
            `insert into lead_aktivitaet
               (mandant_id, lead_id, typ, richtung, betreff, inhalt, geschehen_am,
                benutzer_id, zweck)
             values (app.aktiver_mandant(), $1, $2::aktivitaet_typ, 'intern'::aktivitaet_richtung,
                     $3, $4, now(), $5, 'intern'::kommunikationszweck)`,
            [leadId, typ, betreff, notiz, sitzung.benutzerId],
          );
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
