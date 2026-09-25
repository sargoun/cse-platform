import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import {
  SteuerFehler, legeBescheinigungAn, legeZeitscheibeAn, setzeERechnung,
  widerrufeBescheinigung,
} from '@/server/services/finanz/kunde-steuer';
import type { Bauleistungsart } from '@/server/services/finanz/steuer/nachweis';

/**
 * `POST /api/crm/kunde/steuer` — die vier Vorgänge des Steuerblatts
 * (FIN-09, FIN-10, FIN-11, LEG-05, LEG-06).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Ein Endpunkt, vier Vorgänge — und ZWEI verschiedene Rechte.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  · `was = 'erechnung'`      → `crm.schreiben` (Kundenstamm)
 *  · `was = 'bauleistender'`  → `finanzen.schreiben` (§13b-Zeitscheibe)
 *  · `was = 'bescheinigung'`  → `finanzen.schreiben` (§48b)
 *  · `was = 'widerruf'`       → `finanzen.schreiben`
 *
 * Das ist kein Sammelendpunkt aus Bequemlichkeit: alle vier stehen auf
 * derselben Seite, und ein getrennter Pfad je Formular wäre viermal dieselbe
 * Wache mit vier Gelegenheiten, eine zu vergessen. Das RECHT kommt aber aus
 * dem Vorgang und nicht aus dem Pfad — wer den Kundenstamm pflegen darf, darf
 * damit keinen §13b-Status setzen.
 *
 * Die Dienste prüfen ihr Recht zusätzlich selbst (`kunde-steuer.ts`);
 * `authorize` hier ist die erste Linie, nicht die einzige.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const RECHT: Readonly<Record<string, string>> = {
  erechnung: 'crm.schreiben',
  bauleistender: 'finanzen.schreiben',
  bescheinigung: 'finanzen.schreiben',
  widerruf: 'finanzen.schreiben',
};

const ERFOLG: Readonly<Record<string, string>> = {
  erechnung: 'Die Rechnungsangaben sind gespeichert. Ob damit versendet werden kann, '
    + 'steht oben im Versandstand.',
  bauleistender: 'Die Zeitscheibe ist angelegt. Die Antwort zum Stichtag oben ist '
    + 'damit neu berechnet — aus der geprüften Funktion, nicht aus dieser Seite.',
  bescheinigung: 'Die Freistellungsbescheinigung ist erfasst. Geprüft wird sie am '
    + 'Leistungsdatum, nicht heute.',
  widerruf: 'Der Widerruf ist eingetragen. Die Bescheinigung bleibt lesbar — jede '
    + 'Rechnung, die sich auf sie beruft, muss herleitbar bleiben.',
};

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const was = String(daten.get('was') ?? '');
  const recht = RECHT[was];
  if (recht === undefined) {
    return NextResponse.json({ fehler: 'unbekannter_vorgang' }, { status: 400 });
  }
  const kundeId = String(daten.get('kundeId') ?? '');
  if (!UUID.test(kundeId)) {
    return NextResponse.json({ fehler: 'unbekannte_kennung' }, { status: 404 });
  }
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };

  try {
    await db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht, schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (was === 'erechnung') {
          await setzeERechnung(kontext, {
            kundeId,
            leitwegId: wert('leitwegId'),
            kaeuferReferenz: wert('kaeuferReferenz'),
            elektronischeAdresse: wert('elektronischeAdresse'),
            elektronischeAdresseSchema: wert('elektronischeAdresseSchema'),
            uebertragungsweg: wert('uebertragungsweg'),
            rechnungsformat: wert('rechnungsformat'),
            xrechnungPflicht: String(daten.get('xrechnungPflicht') ?? '') === '1',
          });
          return;
        }

        if (was === 'bauleistender') {
          const art = String(daten.get('leistungsart') ?? '');
          if (art !== 'bau' && art !== 'gebaeudereinigung') {
            throw new SteuerFehler('Diese Leistungsart gibt es nicht.', 'art_unbekannt');
          }
          await legeZeitscheibeAn(kontext, {
            kundeId,
            leistungsart: art as Bauleistungsart,
            istBauleistender: String(daten.get('istBauleistender') ?? '') === '1',
            giltAb: String(daten.get('giltAb') ?? ''),
            giltBis: wert('giltBis'),
            grundlage: String(daten.get('grundlage') ?? ''),
            dokumentId: wert('dokumentId'),
          });
          return;
        }

        if (was === 'bescheinigung') {
          const umfang = String(daten.get('umfang') ?? '');
          if (umfang !== 'unbeschraenkt' && umfang !== 'auftragsbezogen') {
            throw new SteuerFehler('Diesen Umfang gibt es nicht.', 'umfang_unbekannt');
          }
          await legeBescheinigungAn(kontext, {
            kundeId,
            nummer: String(daten.get('nummer') ?? ''),
            finanzamt: String(daten.get('finanzamt') ?? ''),
            gueltigVon: String(daten.get('gueltigVon') ?? ''),
            gueltigBis: String(daten.get('gueltigBis') ?? ''),
            umfang,
            auftragId: wert('auftragId'),
            dokumentId: wert('dokumentId'),
          });
          return;
        }

        const bescheinigungId = String(daten.get('bescheinigungId') ?? '');
        if (!UUID.test(bescheinigungId)) {
          throw new SteuerFehler('Diese Bescheinigung gibt es nicht.', 'nicht_gefunden', 404);
        }
        await widerrufeBescheinigung(
          kontext, bescheinigungId, String(daten.get('widerrufenAm') ?? ''));
      }));
  } catch (fehler) {
    if (fehler instanceof SteuerFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`,
        '/portal', anfrage), 303);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  const trenner = zurueck.includes('?') ? '&' : '?';
  return NextResponse.redirect(internesZiel(
    `${zurueck}${trenner}erfolg=${encodeURIComponent(ERFOLG[was] ?? 'Gespeichert.')}`,
    '/portal', anfrage), 303);
}
