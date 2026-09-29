import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { NichtGefundenFehler } from '@/server/auth/fehler';
import { withTenant } from '@/server/kontext/index';
import {
  aktualisiereEintrag, erfasseEintrag, securityGebucht,
  BEWACHER_STATUS, type BewacherErfolg, type BewacherGrund, type BewacherStatus,
} from '@/server/services/security/bewacherregister';

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
 *
 * **Zurück auf die Liste gehen nur Schlüssel** (V-275, D-773, D-769): ein
 * Erfolg als `?erfolg=erfasst|fortgeschrieben`, eine Abweisung als
 * `?fehler=<grund>`; die Seite schlägt beide nach. Hier standen vorher die
 * Sätze selbst in `?ok=` und `?fehler=` — und die Weiche ersetzte JEDE
 * Antwort von `alsAntwort` mit Meldung durch den Rückweg, auch die Umleitung
 * auf Anmeldung oder Faktor-Schritt (D-766). Die Anmeldung kommt jetzt zuerst.
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

class Unvollstaendig extends Error {
  readonly code = 'unvollstaendig';
  readonly status = 400;
  constructor(nachricht: string, readonly grund: BewacherGrund) {
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
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const mandant = (text(daten, 'mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const art = text(daten, 'art');
  if (art !== 'erfassen' && art !== 'aendern') {
    return NextResponse.json({ fehler: 'art_unbekannt' }, { status: 400 });
  }
  const liste = `/portal/${mandant}/security/bewacherregister`;

  let erfolg: BewacherErfolg;
  try {
    erfolg = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          throw new Unvollstaendig(
            'Person, Bewacher-ID und Status sind Pflicht.', 'pflichtangaben_fehlen');
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
          return 'erfasst';
        }
        const eintragId = text(daten, 'eintrag');
        if (eintragId === null) throw new Unvollstaendig('Der Eintrag fehlt.', 'eintrag_fehlt');
        await aktualisiereEintrag(kontext, { ...felder, id: eintragId });
        return 'fortgeschrieben';
      })) as Promise<BewacherErfolg>);
  } catch (fehler) {
    /*
     * **Die Anmeldung zuerst** (D-766, D-769 Nr. 7): ein fehlendes Recht und
     * ein nicht gebuchtes Security-Modul sind die byte-gleiche 404 (AUT-06),
     * ohne zweiten Faktor geht es auf den Faktor-Schritt — keines davon wird
     * je ein Rückweg auf die Liste.
     */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    /*
     * Ein fachlicher Fehler trägt `status` und `code` — und seinen GRUND
     * (`BEWACHER_GRUENDE`); eine Klasse ohne eigenen Grund reist mit ihrem
     * `code`, und die Seite zeigt dafür ihren allgemeinen Satz. Alles andere
     * bleibt ein Wurf (ein Programmfehler ist ein roter Lauf).
     */
    const status = (fehler as { status?: unknown }).status;
    const code = (fehler as { code?: unknown }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      const grund = (fehler as { grund?: unknown }).grund;
      return zurueckAufDieListe(anfrage, liste, 'fehler', typeof grund === 'string' ? grund : code);
    }
    throw fehler;
  }

  return zurueckAufDieListe(anfrage, liste, 'erfolg', erfolg);
}

/** 303 auf die Liste mit genau EINEM Schlüssel — nie einem Satz (V-275, D-769). */
function zurueckAufDieListe(
  anfrage: NextRequest, liste: string, name: 'erfolg' | 'fehler', schluessel: string,
): NextResponse {
  const ziel = internesZiel(liste, liste, anfrage);
  ziel.searchParams.set(name, schluessel);
  return NextResponse.redirect(ziel, 303);
}
