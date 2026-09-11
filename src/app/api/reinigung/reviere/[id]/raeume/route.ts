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
  RaumNichtEntfernbar, RevierNichtGefunden, setzeRaeume, SollzeitUneinig,
} from '@/server/services/reinigung/revier';
import { SollzeitFehler } from '@/server/services/reinigung/sollzeit';

/**
 * `POST /api/reinigung/reviere/[id]/raeume` — Räume einer Zone zuordnen und
 * ihre Sollzeit neu rechnen (CLN-01, OPS-02, OPS-03, OPS-07).
 *
 * **`POST` statt `PUT`, obwohl die API-Karte `PUT` nennt.** Der Aufrufer ist
 * ein gewöhnliches HTML-Formular, und ein Formular kann nur `GET` und `POST`.
 * Ein zweiter Weg allein für das Verb wäre eine zweite Stelle, an der die
 * Prüfung fehlen kann; dieselbe Entscheidung wie bei
 * `api/einsaetze/[id]/besetzen`.
 *
 * **Gerechnet wird im Dienst, nicht hier** (CLAUDE.md: authorize → Dienst →
 * zurück). Die Route liest Formularfelder, prüft das Recht und gibt das
 * Ergebnis weiter; `Σ m² ÷ Leistungswert` steht in
 * `services/reinigung/sollzeit.ts` und hat dort genau eine Rundungsstelle.
 *
 * **Räume lassen sich nicht abziehen.** `revier_raum` steht unter Löschsperre
 * (§5.2), und kein Quelldokument beschreibt einen Weg, eine Zuordnung wieder
 * zu lösen. Der Dienst wirft dafür `RaumNichtEntfernbar`, und diese Route
 * meldet es als `409` mit den betroffenen Räumen — nicht als stiller Erfolg,
 * bei dem die Hälfte passiert.
 */
export const dynamic = 'force-dynamic';

export async function POST(
  anfrage: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const { id } = await params;
  const daten = await anfrage.formData();
  const raumIds = daten.getAll('raum').filter((w): w is string => typeof w === 'string');

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
          { recht: 'reinigung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        /**
         * Der Stichtag ist JETZT — und er reist als Zeitpunkt, nicht als
         * Datum: welcher Leistungswert gilt, entscheidet der Berliner
         * Kalendertag, und den bildet der Dienst (K-11).
         */
        await setzeRaeume(kontext, id, raumIds, new Date());
      }));
  } catch (fehler) {
    if (fehler instanceof RaumNichtEntfernbar) {
      return NextResponse.json(
        { fehler: 'raum_nicht_entfernbar', raeume: fehler.raumIds, hinweis: fehler.message },
        { status: 409 },
      );
    }
    if (fehler instanceof SollzeitFehler) {
      return NextResponse.json(
        { fehler: 'sollzeit_unberechenbar', grund: fehler.grund, hinweis: fehler.message },
        { status: 422 },
      );
    }
    if (fehler instanceof SollzeitUneinig) {
      return NextResponse.json({ fehler: 'sollzeit_uneinig' }, { status: 500 });
    }
    // AUT-06: ein fremdes Revier ist nicht vorhanden, nicht verboten.
    if (fehler instanceof RevierNichtGefunden || fehler instanceof NichtGefundenFehler) {
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
  const ziel = internesZiel(
    daten.get('zurueck') as string | null,
    `/portal/${mandant}/reinigung/reviere/${id}`,
    anfrage,
  );
  return NextResponse.redirect(ziel, 303);
}
