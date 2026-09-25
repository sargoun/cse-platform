import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { withTenant } from '@/server/kontext/index';
import { CrmFehler, legeLeadAn, setzeLeadPflege, setzeLeadStatus }
  from '@/server/services/crm/anlegen';
import { ordneLeadKundeZu, uebernehmeLeadAlsKunde } from '@/server/services/crm/lead-kette';
import { legeLeadKontaktAn, waehleLeadKontakt } from '@/server/services/crm/lead-kontakt';
import { uebernimmAusschreibungAlsLead } from '@/server/services/crm/lead-radar';

/**
 * `POST /api/crm/lead` — einen Lead anlegen oder seinen Stand ändern (CRM-02,
 * CRM-07).
 *
 * Seit V-138/V-139 dazu, unter demselben Recht `crm.schreiben`: die Anfrage
 * als Kunden übernehmen oder einem Kunden zuordnen (`was=kunde_uebernehmen`,
 * `was=kunde_zuordnen`) und einen Treffer des Vergaberadars als Lead
 * übernehmen (`was=aus_radar`). Seit V-141 den Ansprechpartner der Anfrage
 * wählen oder anlegen (`was=kontakt_waehlen`, `was=kontakt_anlegen`). Jede
 * dieser Handlungen legt einen Lead an oder schreibt an einem — ein eigenes
 * Tor je Knopf wäre eine Stelle mehr, an der jemand das `authorize` vergisst.
 *
 * **Der Besitzer ist, wer anlegt.** Kein Auswahlfeld und kein Vorgabekonto: wer
 * einen Lead einträgt, hat das Gespräch geführt. Ein Vorgabebesitzer wäre eine
 * Zuweisung, die niemand getroffen hat — und ein Lead, für den sich niemand
 * zuständig fühlt, ist ein verlorener.
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

  let ziel = zurueck;
  try {
    ziel = await db().begin(async (tx: postgres.TransactionSql) =>
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
         * Die Kette (V-138, CRM-05): die Anfrage bekommt ihren Kunden — als
         * neuer Kunde übernommen oder einem bestehenden zugeordnet.
         */
        if (wert('was') === 'kunde_uebernehmen') {
          const typ = wert('typ');
          await uebernehmeLeadAlsKunde(kontext, String(daten.get('id') ?? ''), {
            name: wert('name'),
            typ: typ === 'behoerde' || typ === 'privat' ? typ : 'firma',
            ustId: wert('ustId'),
          });
          return zurueck;
        }
        if (wert('was') === 'kunde_zuordnen') {
          await ordneLeadKundeZu(kontext, String(daten.get('id') ?? ''),
            wert('kundeId') ?? '');
          return zurueck;
        }

        /*
         * Der Ansprechpartner der Anfrage (V-141, D-635): einen Kontakt des
         * Kunden wählen oder einen neuen anlegen. Bis hierher liess sich
         * `lead.ansprechpartner_id` nach der Anlage nicht setzen, und jeder
         * ausgehende Anruf eines Leads ohne Webformular brach ab.
         */
        if (wert('was') === 'kontakt_waehlen') {
          await waehleLeadKontakt(kontext, String(daten.get('id') ?? ''),
            wert('ansprechpartnerId') ?? '');
          return zurueck;
        }
        if (wert('was') === 'kontakt_anlegen') {
          const kontakt = await legeLeadKontaktAn(kontext, String(daten.get('id') ?? ''), {
            vorname: wert('vorname'),
            nachname: wert('nachname') ?? '',
            email: wert('email'),
            telefon: wert('telefon'),
          });
          /* Ein bekannter Mensch wird nicht verdoppelt — die Seite sagt, dass er es war. */
          if (!kontakt.vorhanden) return zurueck;
          return `${zurueck}${zurueck.includes('?') ? '&' : '?'}hinweis=kontakt_vorhanden`;
        }

        /*
         * Ein Treffer des Vergaberadars wird zum Lead (V-139, CRM-07). Der
         * Besitzer ist, wer übernimmt — dieselbe Regel wie beim Anlegen von
         * Hand.
         */
        if (wert('was') === 'aus_radar') {
          const neu = await uebernimmAusschreibungAlsLead(
            kontext, wert('ausschreibungId') ?? '', {
              auftraggeber: wert('auftraggeber'),
              besitzerBenutzerId: sitzung.benutzerId,
            });
          const bereich = zurueck.split('/')[2] ?? '';
          return `/portal/${bereich}/crm/leads/${neu.id}`;
        }

        /* Priorität und Besitzer (V-137, CRM-02). */
        if (wert('was') === 'pflege') {
          await setzeLeadPflege(kontext, String(daten.get('id') ?? ''), {
            prioritaet: wert('prioritaet'),
            besitzerBenutzerId: wert('besitzerBenutzerId'),
          });
          return zurueck;
        }

        const status = wert('status');
        if (status !== undefined) {
          await setzeLeadStatus(kontext, String(daten.get('id') ?? ''), status,
                                wert('grund'));
          return zurueck;
        }

        /*
         * Die Herkunft folgt der Angabe: wer einen empfehlenden Kunden wählt,
         * erfasst eine Empfehlung (V-139, CRM-07). Ein eigenes Auswahlfeld
         * „Herkunft" daneben könnte dem widersprechen — ohne Javascript
         * stünden dann zwei Angaben im Formular, die nicht zusammenpassen.
         */
        const empfehlungVonKundeId = wert('empfehlungVonKundeId');
        const neu = await legeLeadAn(kontext, {
          betreff: String(daten.get('betreff') ?? ''),
          firmaName: wert('firmaName'),
          kundeId: wert('kundeId'),
          bedarf: wert('bedarf'),
          besitzerBenutzerId: sitzung.benutzerId,
          quelle: empfehlungVonKundeId === undefined ? 'manuell' : 'empfehlung',
          empfehlungVonKundeId,
        });
        const bereich = zurueck.split('/')[2] ?? '';
        return `/portal/${bereich}/crm/leads/${neu.id}`;
      }));
  } catch (fehler) {
    if (fehler instanceof CrmFehler) {
      const trenner = zurueck.includes('?') ? '&' : '?';
      return NextResponse.redirect(internesZiel(
        // Schlüssel UND Satz: die Seite übersetzt den Schlüssel, der Satz
        // bleibt der Rückfall für Seiten, die nur `meldung` lesen.
        `${zurueck}${trenner}meldung=${encodeURIComponent(fehler.message)}`
          + `&fehler=${encodeURIComponent(fehler.grund)}`,
        '/portal', anfrage), 303);
    }
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, '/portal', anfrage), 303);
}
