import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler } from '@/server/services/crm/anlegen';
import { halteFest } from '@/server/services/crm/verlauf';

/**
 * `POST /api/crm/notiz` — eine Notiz, einen Anruf, eine E-Mail oder einen
 * Termin am Kunden oder am Ansprechpartner festhalten (CRM-03, V-147, D-641).
 *
 * **Warum eine eigene Route und nicht `/api/lead`.** Jene gehört dem
 * Leadblatt: sie setzt den nächsten Schritt AM LEAD und leitet auf den Lead
 * zurück. Eine Notiz am Bestandskunden hat keinen Lead; sie über dieselbe
 * Route zu schicken, hiesse, jeden ihrer Zweige um „und wenn kein Lead da
 * ist" zu erweitern — auf einer Route, die V-137 gerade erst geradegezogen
 * hat.
 *
 * **Zurück auf das Blatt, mit dem Grund** (D-599, D-562): Formulare im
 * Portal haben kein JavaScript. `?notiz=` trägt den Schlüssel der Abweisung;
 * jeder Schlüssel, den `halteFest` werfen kann, hat auf dem Blatt einen Satz
 * in beiden Sprachen (`crm-verlauf.ts`, geprüft in `crm-verlauf.test.ts`).
 * Ein eigener Name und NICHT `?fehler=` oder `?meldung=`: das Kontaktblatt
 * liest `fehler` für den Sendeweg (V-101) und `meldung` für seine übrigen
 * Formulare — eine Notiz, die scheitert, ist weder eine Nachricht, die nicht
 * hinausging, noch ein Kontakt, der nicht angelegt wurde. Der Anker führt
 * auf den Abschnitt, in dem das Formular steht.
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
  const zurueck = (daten.get('zurueck') as string | null) ?? '/portal';
  const wert = (name: string): string | undefined => {
    const t = String(daten.get(name) ?? '').trim();
    return t === '' ? undefined : t;
  };
  const trenner = zurueck.includes('?') ? '&' : '?';

  try {
    await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'crm.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );
        return halteFest(kontext, {
          kundeId: wert('kundeId'),
          ansprechpartnerId: wert('ansprechpartnerId'),
          art: wert('art') ?? 'notiz',
          richtung: wert('richtung') ?? 'intern',
          zweck: wert('zweck'),
          betreff: wert('betreff'),
          inhalt: String(daten.get('inhalt') ?? ''),
        });
      })) as Promise<string>);
  } catch (fehler) {
    if (fehler instanceof CrmFehler) {
      return NextResponse.redirect(internesZiel(
        `${zurueck}${trenner}notiz=${encodeURIComponent(fehler.grund)}#kommunikation`,
        '/portal', anfrage), 303);
    }
    /* AUT-06 (V-162, D-656): ein fehlendes Recht ist ein 404, kein 500. */
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(
    `${zurueck}${trenner}notiert=1#kommunikation`, '/portal', anfrage), 303);
}
