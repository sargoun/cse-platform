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
import { istKennung } from '@/app/portal/kennung';
import {
  antworte, eroeffneFaden, markiereGelesen, oeffneFaden, schliesseFaden,
} from '@/server/services/kern/nachricht';

/**
 * `POST /api/nachrichten` — Faden eröffnen, antworten, stempeln, schliessen
 * (EMP-11, CRM-03, NOT-03).
 *
 * **Nur POST, und das ist die Absicherung des Stempels** (D-504). „Als
 * gelesen markieren" ändert Zustand; als GET-Link hätte ein Vorauslader den
 * Posteingang von allein geleert.
 *
 * **Kein Weg nach draussen in diesem Handler.** Was das Haus verlässt, läuft
 * über `sendeNachAussen`, durch `kern.nachricht_sendetor()` und die
 * Freigabekette (Invariante 7) — und heute über keinen verbundenen Versender
 * (O-36). Zwei Wege mit einem Namen wären der Weg, auf dem eine Werbemail als
 * interne Notiz hinausgeht.
 *
 * **Gelesen-Stempel ohne Recht.** `markiereGelesen` trifft nur die EIGENEN
 * Empfängerzeilen (`t_empfaenger_eigene_stempeln`, 0231); ein Recht davor
 * hiesse, dass jemand eine Nachricht bekommen kann, die er nicht als gelesen
 * markieren darf.
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
  const text = (name: string): string | null => {
    const wert = daten.get(name);
    return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
  };

  const was = text('was') ?? '';
  const id = text('id');
  if (was !== 'eroeffnen' && (id === null || !istKennung(id))) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const akteur = {
          benutzerId: sitzung.benutzerId,
          personId: sitzung.personId,
          aktiverMandantId: sitzung.aktiverMandantId,
          ansicht: sitzung.ansicht,
          aal: sitzung.aal,
          portal: sitzung.portal,
          sitzungId: sitzung.sitzungId,
        };
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));

        if (was === 'gelesen') {
          /*
           * Kein `nachricht.versenden` davor: gestempelt wird die EIGENE
           * Zustellung. Die Policy bindet sie an `app.aktueller_benutzer()`
           * bzw. `app.aktuelle_person()`; ein fremder Faden trifft null
           * Zeilen und antwortet wie ein nicht vorhandener (AUT-06).
           */
          /*
           * Die ZAHL wird durchgereicht, nicht verworfen. Traf der Stempel
           * null eigene Zeilen, hat sich nichts geändert — und dann ist
           * „Gespeichert." eine Behauptung. Die Seite sagt stattdessen, dass
           * schon alles gelesen war.
           */
          const gestempelt = await markiereGelesen(kontext, id as string);
          return {
            art: 'getan' as const,
            was: gestempelt === 0 ? 'gelesen_schon' : 'gelesen',
            ziel: id as string,
          };
        }

        await authorize(akteur, { recht: 'nachricht.versenden', schreibend: true }, pruefer);

        if (was === 'eroeffnen') {
          const koerper = text('koerper');
          const empfaenger = text('empfaenger');
          if (koerper === null || empfaenger === null || !istKennung(empfaenger)) {
            return { art: 'fehler' as const, code: 'unvollstaendig' };
          }
          const threadId = await eroeffneFaden(kontext, {
            betreff: text('betreff'),
            koerper,
            empfaenger: [{ typ: 'benutzer', id: empfaenger, art: 'an' }],
          });
          return { art: 'neu' as const, id: threadId };
        }

        if (was === 'antworten') {
          const koerper = text('koerper');
          if (koerper === null) return { art: 'fehler' as const, code: 'unvollstaendig' };
          const neu = await antworte(kontext, id as string, { koerper });
          return neu === null
            ? { art: 'fehler' as const, code: 'unbekannt' }
            : { art: 'getan' as const, was: 'geantwortet', ziel: id as string };
        }

        if (was === 'schliessen') {
          const ok = await schliesseFaden(kontext, id as string);
          return ok
            ? { art: 'getan' as const, was: 'geschlossen', ziel: id as string }
            : { art: 'fehler' as const, code: 'unbekannt' };
        }

        if (was === 'oeffnen') {
          const ok = await oeffneFaden(kontext, id as string);
          return ok
            ? { art: 'getan' as const, was: 'geoeffnet', ziel: id as string }
            : { art: 'fehler' as const, code: 'unbekannt' };
        }

        return { art: 'fehler' as const, code: 'unbekannter_vorgang' };
      })) as Promise<
        { art: 'neu'; id: string }
        | { art: 'getan'; was: string; ziel: string }
        | { art: 'fehler'; code: string }
      >);

    if (ergebnis.art === 'fehler') {
      return NextResponse.json({ fehler: ergebnis.code },
                               { status: ergebnis.code === 'unbekannt' ? 404 : 400 });
    }
    const ziel = ergebnis.art === 'neu'
      ? `/portal/${slug}/nachrichten/${ergebnis.id}`
      : `/portal/${slug}/nachrichten/${ergebnis.ziel}?getan=${ergebnis.was}`;
    return NextResponse.redirect(new URL(ziel, erwarteterUrsprung(anfrage)), 303);
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
