import type postgres from 'postgres';
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
  ABLEHNUNG_GRUENDE, lehneAnspruchAb, uebernimmAnspruch, type AblehnungGrund,
} from '@/server/services/zeit/offline';

/**
 * `POST /api/offline-ereignis/[id]` — über eine nachgereichte Behauptung
 * entscheiden (TIM-09, TIM-11).
 *
 * **Zwei Übergänge, eine Adresse.** Übernehmen und Ablehnen brauchen dieselbe
 * Sitzung, denselben Ursprungscheck, denselben Mandantenkontext und dasselbe
 * Recht — zwei Adressen wären zwei Stellen, an denen die Prüfung fehlen kann.
 * Dieselbe Entscheidung wie bei den drei Angebotsübergängen.
 *
 * **`zeit.nacherfassung_pruefen`, nicht `zeit.schreiben`.** Wer Zeiten erfasst,
 * befindet damit noch nicht über die Behauptung eines Menschen, dass er
 * gearbeitet hat. Das sind zwei Entscheidungen, und wer die eine darf, darf
 * darum nicht automatisch die andere — dieselbe Trennung wie
 * `dienstplan.konflikt_quittieren` gegen `dienstplan.schreiben`.
 *
 * **Der Beginn wird GENANNT, nicht vorbelegt.** Die Route reicht durch, was
 * ein Mensch eingetragen hat; sie füllt nichts aus `behauptete_zeit` nach. Ein
 * Vorgabewert von dort machte aus der Behauptung des Telefons eine
 * Planerentscheidung, die von einer echten nicht mehr zu unterscheiden wäre
 * (§1.8, Invariante 5).
 */
export const dynamic = 'force-dynamic';

const MINDESTLAENGE = 10;

class AnspruchFehler extends Error {
  constructor(readonly schluessel: string, readonly status: number) {
    super(schluessel);
    this.name = 'AnspruchFehler';
  }
}

function datumAus(wert: FormDataEntryValue | null): Date | null {
  if (typeof wert !== 'string' || wert === '') return null;
  const d = new Date(wert);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(
  anfrage: NextRequest,
  kontextParam: { params: Promise<{ id: string }> },
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
  const aktion = daten.get('aktion');
  const begruendung = daten.get('begruendung');

  if (typeof begruendung !== 'string' || begruendung.trim().length < MINDESTLAENGE) {
    return NextResponse.json(
      { fehler: 'begruendung_zu_kurz', mindestens: MINDESTLAENGE }, { status: 400 },
    );
  }

  try {
    const ergebnis = await db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: 'zeit.nacherfassung_pruefen', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        /**
         * Erst lesen, dann handeln — und das ist hier KEIN Wettlauf im Sinne
         * von K-09: die Zeile wird nicht durch das Lesen beansprucht. Der
         * Lesevorgang existiert nur, damit eine fremde Zeile 404 ergibt statt
         * eines Datenbankfehlers aus der Definerfunktion (AUT-06). Die
         * eigentliche Absicherung gegen die doppelte Entscheidung steht in
         * `oe_unveraenderlich`: ein zweiter Übergang wird dort abgewiesen.
         */
        const [zeile] = await kontext.abfrage<{ status: string }>(
          `select status::text as status from offline_ereignis where id = $1::uuid`, [id]);
        if (zeile === undefined) throw new AnspruchFehler('nicht_gefunden', 404);
        if (zeile.status === 'uebernommen' || zeile.status === 'abgelehnt') {
          throw new AnspruchFehler('bereits_entschieden', 409);
        }

        if (aktion === 'ablehnen') {
          const grund = daten.get('grund');
          if (typeof grund !== 'string'
              || !(ABLEHNUNG_GRUENDE as readonly string[]).includes(grund)) {
            throw new AnspruchFehler('grund_unbekannt', 400);
          }
          await lehneAnspruchAb(kontext, id, grund as AblehnungGrund, begruendung.trim());
          return { abgelehnt: true as const };
        }

        if (aktion !== 'uebernehmen') throw new AnspruchFehler('aktion_unbekannt', 400);

        const beginn = datumAus(daten.get('beginn'));
        if (beginn === null) throw new AnspruchFehler('beginn_fehlt', 400);

        const zeiteintragId = await uebernimmAnspruch(
          kontext, id, beginn, datumAus(daten.get('ende')), begruendung.trim(),
        );
        return { zeiteintragId };
      })) as { abgelehnt: true } | { zeiteintragId: string };

    return NextResponse.json(ergebnis, { status: 200 });
  } catch (fehler) {
    if (fehler instanceof AnspruchFehler) {
      return NextResponse.json({ fehler: fehler.schluessel }, { status: fehler.status });
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
