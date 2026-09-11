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
import {
  erstelleReklamation, schreibeAbstellung,
  MassnahmeFehlt, NachweisPasstNicht, ReklamationNichtGefunden,
  type ReklamationPrioritaet, type ReklamationQuelle, type ReklamationStatus,
} from '@/server/services/reinigung/reklamation';

/**
 * `POST /api/qualitaet/reklamationen` — anlegen und fortschreiben (OPS-11).
 *
 * **`qualitaet.schreiben`, nicht `reinigung.schreiben`:** eine Beschwerde über
 * einen Wachmann ist dieselbe Zeile wie eine über eine Reinigungsrunde, und
 * das Modul ist für drei Bereiche freigeschaltet (04-SEITENKARTE.md §5.6).
 *
 * **Eine Adresse für beide Schritte.** Anlegen und Abstellen brauchen
 * dieselbe Sitzung, denselben Ursprungscheck und denselben Mandantenkontext;
 * zwei Adressen wären zwei Stellen, an denen die Prüfung fehlen kann. Welcher
 * Schritt gemeint ist, sagt das Feld `reklamation`: fehlt es, wird angelegt.
 *
 * **Keine Frist wird hier gesetzt.** `faellig_am` bleibt NULL, solange O-14
 * offen ist — eine aus der Priorität abgeleitete Frist wäre ein Versprechen
 * an den Kunden, das niemand gegeben hat.
 */
export const dynamic = 'force-dynamic';

const QUELLEN: readonly ReklamationQuelle[] =
  ['kunde', 'eigenkontrolle', 'qualitaetspruefung', 'mitarbeiter'];
const PRIORITAETEN: readonly ReklamationPrioritaet[] = ['niedrig', 'mittel', 'hoch'];
const STATUS: readonly ReklamationStatus[] =
  ['offen', 'in_arbeit', 'behoben', 'abgelehnt', 'geschlossen'];

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const text = (feld: string): string | null => {
    const w = daten.get(feld);
    return typeof w === 'string' && w.trim() !== '' ? w.trim() : null;
  };
  let ziel = text('reklamation');

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
          { recht: 'qualitaet.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (ziel === null) {
          const objektId = text('objekt');
          const beschreibung = text('beschreibung');
          if (objektId === null || beschreibung === null) throw new Unvollstaendig();
          const roheQuelle = text('quelle');
          const rohePrio = text('prioritaet');
          const { id } = await erstelleReklamation(kontext, {
            objektId,
            kundeId: text('kunde'),
            revierId: text('revier'),
            // Der Nachweis, den die Beanstandung bestreitet (Abnahme 4).
            leistungsnachweisId: text('nachweis'),
            // Ein unbekannter Wert wird VERWORFEN, nicht durchgereicht.
            quelle: QUELLEN.find((q) => q === roheQuelle) ?? 'kunde',
            prioritaet: PRIORITAETEN.find((p) => p === rohePrio) ?? 'mittel',
            beschreibung,
            gemeldetVonName: text('gemeldet_von'),
            wiederholungVonId: text('wiederholung_von'),
          });
          ziel = id;
          return;
        }

        const roherStatus = text('status');
        const status = STATUS.find((s) => s === roherStatus);
        if (status === undefined) throw new Unvollstaendig();
        await schreibeAbstellung(kontext, {
          id: ziel,
          status,
          ursache: text('ursache'),
          massnahme: text('massnahme'),
          // Die Schicht, die nacharbeitet (Abnahme 4).
          nacharbeitEinsatzId: text('nacharbeit'),
          verantwortlichBenutzerId: text('verantwortlich'),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof Unvollstaendig) {
      return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
    }
    if (fehler instanceof MassnahmeFehlt || fehler instanceof NachweisPasstNicht) {
      return NextResponse.json(
        { fehler: 'ungueltiger_zustand', hinweis: fehler.message }, { status: 422 },
      );
    }
    // AUT-06: eine fremde Zeile ist nicht vorhanden, nicht verboten.
    if (fehler instanceof ReklamationNichtGefunden || fehler instanceof NichtGefundenFehler) {
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

  const mandant = String(daten.get('mandant') ?? '');
  const zurueck = internesZiel(
    daten.get('zurueck') as string | null,
    `/portal/${mandant}/qualitaet/reklamationen/${ziel ?? ''}`,
    anfrage,
  );
  return NextResponse.redirect(zurueck, 303);
}

class Unvollstaendig extends Error {
  constructor() {
    super('Objekt und Beschreibung sind Pflicht; ein Statuswechsel braucht einen Status.');
    this.name = 'Unvollstaendig';
  }
}
