import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  aktualisiereEintrag, erfasseEintrag, securityGebucht,
  BEWACHER_STATUS, type BewacherStatus,
} from '@/server/services/security/bewacherregister';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/security/bewacherregister` — einen Registereintrag erfassen oder
 * fortschreiben (SEC-03, LEG-04).
 *
 * **Kein Abgleich, kein Abruf, keine simulierte Antwort.** Dieser Handler
 * schreibt, was ein Mensch eingetippt hat, und `bewacher_eintrag.quelle` bleibt
 * per Prüfbedingung `'manuell'`. Es gibt keine Schnittstelle zum behördlichen
 * Register, und diese Adresse tut nicht so.
 *
 * **Das Format der Bewacher-ID wird nicht geprüft (O-40).** Was geprüft wird,
 * sind die Prüfbedingungen der Tabelle — im Dienst, mit einer Meldung, die ein
 * Satz ist.
 *
 * **Die Modulprüfung läuft auch hier.** Die Route trägt als einziges Recht
 * `personal.bewacher_verwalten`, und `personal` ist ein Querschnittsmodul —
 * die zentrale Modulsperre greift also nicht. Ein Schreibweg, der nur auf der
 * Seite geprüft wird, ist keiner: die Adresse ist ohne die Seite erreichbar.
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

class Unvollstaendig extends Error {
  readonly code = 'unvollstaendig';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'Unvollstaendig';
  }
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
  const mandant = (text(daten, 'mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const art = text(daten, 'art');
  if (art !== 'erfassen' && art !== 'aendern') {
    return NextResponse.json({ fehler: 'art_unbekannt' }, { status: 400 });
  }
  const liste = `/portal/${mandant}/security/bewacherregister`;

  let meldung: string;
  try {
    meldung = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'personal.bewacher_verwalten', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /* Nicht gebucht sieht aus wie nicht vorhanden (D-377, AUT-06). */
        if (!(await securityGebucht(kontext))) {
          throw new NichtGefundenFehler('Security ist in dieser Gesellschaft nicht gebucht');
        }

        const personId = text(daten, 'person');
        const bewacherId = text(daten, 'bewacher_id');
        const roherStatus = text(daten, 'status');
        const status: BewacherStatus | undefined =
          BEWACHER_STATUS.find((s) => s === roherStatus);
        if (personId === null || bewacherId === null || status === undefined) {
          throw new Unvollstaendig('Person, Bewacher-ID und Status sind Pflicht.');
        }
        const felder = {
          personId,
          bewacherId,
          status,
          registriertSeit: text(daten, 'registriert_seit'),
          gueltigBis: text(daten, 'gueltig_bis'),
          letztePruefungAm: text(daten, 'letzte_pruefung'),
          /* Wird NICHT aus der letzten Prüfung abgeleitet: in welchem Abstand
             das Register nachzuprüfen ist, steht in der GewO-Durchführung und
             nicht in dieser Anwendung (O-40). */
          naechstePruefungAm: text(daten, 'naechste_pruefung'),
          bemerkung: text(daten, 'bemerkung'),
        };

        if (art === 'erfassen') {
          await erfasseEintrag(kontext, felder);
          return 'Der Registereintrag ist erfasst — handerfasst, ohne Abgleich.';
        }
        const eintragId = text(daten, 'eintrag');
        if (eintragId === null) throw new Unvollstaendig('Der Eintrag fehlt.');
        await aktualisiereEintrag(kontext, { ...felder, id: eintragId });
        return 'Der Registereintrag ist fortgeschrieben; die Änderung steht im Protokoll.';
      })) as Promise<string>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) {
      const nachricht = (fehler as { message?: string }).message;
      if (typeof nachricht === 'string' && nachricht !== ''
        && !(fehler instanceof NichtGefundenFehler)) {
        return NextResponse.redirect(
          internesZiel(`${liste}?fehler=${encodeURIComponent(nachricht)}`, liste, anfrage), 303,
        );
      }
      return antwort;
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${liste}?ok=${encodeURIComponent(meldung)}`, liste, anfrage), 303,
  );
}
