import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { parseGeld } from '@/server/services/finanz/geld';
import {
  AusgabeFehler, bucheAusgabe, erfasseAusgabe, gibAusgabeFrei, lehneAusgabeAb,
  type SteuerEingabe,
} from '@/server/services/finanz/ausgabe-schreiben';
import type { Zahlungsmittel } from '@/server/services/finanz/ausgabe';

/**
 * `POST /api/finanzen/ausgaben` — erfassen, freigeben, ablehnen, buchen
 * (V-011, FIN-14, FIN-17, ACC-01, ACC-03).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Zwei Rechte und nicht eines — und deshalb je Handlung eines.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Erfassen ist Belegarbeit (`eingang.schreiben`). Freigeben, ablehnen und
 * buchen sind Entscheidungen über Geld (`eingang.freigeben`). Ein gemeinsames
 * Recht für beides hiesse: wer eine Quittung eintippen darf, gibt sie auch
 * frei — und das ist genau die Trennung, die ein Vieraugenprinzip ausmacht.
 *
 * Anders als bei `/api/finanzen/lieferanten`, wo alle vier Handlungen
 * dasselbe Recht tragen: dort wäre eine Aufteilung Zierde, hier ist sie die
 * Sache selbst.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN = ['erfassen', 'freigeben', 'ablehnen', 'buchen'] as const;
type Aktion = typeof AKTIONEN[number];

/** Je Handlung ihr Recht — nicht ein Recht für alle (siehe oben). */
const RECHT: Readonly<Record<Aktion, string>> = {
  erfassen: 'eingang.schreiben',
  freigeben: 'eingang.freigeben',
  ablehnen: 'eingang.freigeben',
  buchen: 'eingang.freigeben',
};

/**
 * **Und `buchen` verlangt ein ZWEITES Recht** (V-128).
 *
 * Buchen schreibt ins Hauptbuch: `sicherePeriode` legt den Monat an
 * (`app.buchen_erlaubt` verlangt `finanzen.schreiben` ODER
 * `buchhaltung.schreiben`) und **liest ihn als `cse_app` zurück** — und die
 * Lesepolicy auf `periode` verlangt `buchhaltung.lesen` (0127).
 *
 * Ohne dieses Recht kam der Mensch bis hierher durch und bekam dann eine
 * rohe Ausnahme: „Die Periode zum … liess sich weder anlegen noch lesen".
 * Ein 500 mit einer Fehlermeldung aus der Tiefe ist keine Auskunft — er
 * sagt „mein Fehler", wo „dir fehlt ein Recht" die Wahrheit ist.
 *
 * Gefunden, weil `tests/isolation/ausgabe-schreiben.test.ts` §4 genau daran
 * scheiterte: das Testkonto hielt `eingang.*` und sonst nichts.
 */
const ZWEITES_RECHT: Readonly<Partial<Record<Aktion, string>>> = {
  buchen: 'buchhaltung.schreiben',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ZAHLUNGSMITTEL: readonly string[] =
  ['ueberweisung', 'lastschrift', 'bar', 'karte', 'verrechnung'];

function zurueck(anfrage: NextRequest, daten: FormData, hinweis: string | null): NextResponse {
  const weg = typeof daten.get('fehlerweg') === 'string' ? String(daten.get('fehlerweg')) : '';
  const roh = weg !== '' ? weg : String(daten.get('zurueck') ?? '/portal');
  const ziel = new URL(internesZiel(roh, '/portal', anfrage));
  if (hinweis !== null) ziel.searchParams.set('fehler', hinweis);
  return NextResponse.redirect(ziel, 303);
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
  const feld = (name: string): string | undefined => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : undefined;
  };
  const aktion = String(daten.get('aktion') ?? '') as Aktion;
  const id = feld('id');

  if (!AKTIONEN.includes(aktion)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  if (aktion !== 'erfassen' && (id === undefined || !UUID.test(id))) {
    return NextResponse.json({ fehler: 'keine_kennung' }, { status: 400 });
  }

  /*
   * **Die Steuerzeilen kommen als Paare aus dem Formular.** `steuer_gruppe[]`
   * und `steuer_netto[]` stehen in derselben Reihenfolge; eine Zeile ohne
   * Betrag wird weggelassen statt als Null gespeichert — eine Steuergruppe
   * mit 0,00 € wäre eine Aussage über einen Satz, den es auf diesem Beleg
   * nicht gab.
   */
  let steuer: readonly SteuerEingabe[] = [];
  if (aktion === 'erfassen') {
    const gruppen = daten.getAll('steuer_gruppe').map(String);
    const betraege = daten.getAll('steuer_netto').map(String);
    try {
      steuer = gruppen.flatMap((g, i) => {
        const roh = (betraege[i] ?? '').trim();
        if (g.trim() === '' || roh === '') return [];
        return [{ gruppe: g.trim(), nettoCent: parseGeld(roh) }];
      });
    } catch {
      return zurueck(anfrage, daten, 'betrag_unlesbar');
    }
  }

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
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
          { recht: RECHT[aktion], schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        const zweites = ZWEITES_RECHT[aktion];
        if (zweites !== undefined) {
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
            { recht: zweites, schreibend: true },
            rechtepruefer(kontext.abfrage.bind(kontext)),
          );
        }
        switch (aktion) {
          case 'erfassen': {
            const mittel = feld('zahlungsmittel') ?? '';
            if (!ZAHLUNGSMITTEL.includes(mittel)) {
              throw new AusgabeFehler(
                'Dieses Zahlungsmittel kennt das Haus nicht.', 'unvollstaendig');
            }
            await erfasseAusgabe(kontext, {
              kategorieId: feld('kategorie') ?? '',
              bezeichnung: feld('bezeichnung') ?? '',
              ausgabedatum: feld('ausgabedatum') ?? '',
              zahlungsmittel: mittel as Zahlungsmittel,
              kasseId: feld('kasse') ?? null,
              belegId: feld('beleg') ?? null,
              auftragId: feld('auftrag') ?? null,
              projektId: feld('projekt') ?? null,
              objektId: feld('objekt') ?? null,
              weiterberechenbar: daten.get('weiterberechenbar') === 'ja',
              steuer,
            });
            return;
          }
          case 'freigeben':
            await gibAusgabeFrei(kontext, id!);
            return;
          case 'ablehnen':
            await lehneAusgabeAb(kontext, id!, feld('grund') ?? '');
            return;
          case 'buchen':
            await bucheAusgabe(kontext, id!);
            return;
        }
      })));
  } catch (fehler) {
    /*
     * **Zurück auf das Formular, nicht als JSON.** Die Portalformulare laufen
     * ohne JavaScript; eine weisse Seite mit geschweiften Klammern verlöre
     * alles, was schon getippt war.
     */
    if (fehler instanceof AusgabeFehler) return zurueck(anfrage, daten, fehler.grund);
    throw fehler;
  }

  return zurueck(anfrage, daten, null);
}
