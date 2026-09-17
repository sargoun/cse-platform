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
  brichAb, erledige, legeAn, setzeStatus, weiseZu,
} from '@/server/services/kern/aufgabe';

/**
 * `POST /api/aufgaben` — anlegen, Stand setzen, zuweisen, erledigen,
 * abbrechen (OPS-11).
 *
 * **Ein Handler, fünf Vorgänge, EIN Recht davor plus eines daneben.**
 * `aufgabe.schreiben` trägt alle fünf; `zuweisen` verlangt zusätzlich
 * `aufgabe.zuweisen`, und das wird hier geprüft und nicht in der Seite: die
 * Seite entscheidet, was sie ZEIGT, der Handler, was er TUT (AUT-04).
 *
 * **Der Handler bleibt dünn**: autorisieren → Dienst rufen → 303 zurück. Die
 * Fristenrechnung, die Zustandsregeln und die Serverzeitstempel stehen im
 * Dienst, wo sie geprüft sind.
 *
 * **Nichts wird gelöscht.** Es gibt keinen `loeschen`-Vorgang: `aufgabe` trägt
 * die Löschsperre aus 0230, und Abbrechen mit Grund ist die Antwort auf „das
 * ist nicht mehr nötig".
 */
export const dynamic = 'force-dynamic';

const STAENDE = new Set(['offen', 'in_arbeit', 'wartend']);
const PRIORITAETEN = new Set(['niedrig', 'normal', 'hoch', 'dringend']);
const TAG = /^\d{4}-\d{2}-\d{2}$/u;

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
  if (was !== 'anlegen' && (id === null || !istKennung(id))) {
    return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
  }

  const slug = anfrage.nextUrl.searchParams.get('mandant') ?? '';
  const zurueck = (ziel: string): NextResponse => NextResponse.redirect(
    new URL(ziel, erwarteterUrsprung(anfrage)), 303);

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const sitzungsdaten = {
          benutzerId: sitzung.benutzerId,
          personId: sitzung.personId,
          aktiverMandantId: sitzung.aktiverMandantId,
          ansicht: sitzung.ansicht,
          aal: sitzung.aal,
          portal: sitzung.portal,
          sitzungId: sitzung.sitzungId,
        };
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));
        await authorize(sitzungsdaten, { recht: 'aufgabe.schreiben', schreibend: true },
                        pruefer);

        if (was === 'anlegen') {
          const titel = text('titel');
          if (titel === null) return { art: 'fehler' as const, code: 'unvollstaendig' };
          const prioritaet = text('prioritaet');
          if (prioritaet !== null && !PRIORITAETEN.has(prioritaet)) {
            return { art: 'fehler' as const, code: 'prioritaet' };
          }
          const tag = text('faelligDatum');
          if (tag !== null && !TAG.test(tag)) {
            return { art: 'fehler' as const, code: 'datum' };
          }
          const bezugId = text('bezugId');
          const neueId = await legeAn(kontext, {
            titel,
            beschreibung: text('beschreibung'),
            ...(prioritaet === null
              ? {} : { prioritaet: prioritaet as 'niedrig' | 'normal' | 'hoch' | 'dringend' }),
            faelligDatum: tag,
            /*
             * Die drei eigenen Schluessel kommen aus dem Rumpf, aber nur als
             * KENNUNG: der zusammengesetzte Fremdschluessel in 0230 weist
             * eine Zeile ab, die einer anderen Gesellschaft gehoert.
             */
            auftragId: istKennung(text('auftragId') ?? undefined) ? text('auftragId') : null,
            objektId: istKennung(text('objektId') ?? undefined) ? text('objektId') : null,
            leadId: istKennung(text('leadId') ?? undefined) ? text('leadId') : null,
            bezugTyp: text('bezugTyp'),
            bezugId: istKennung(bezugId ?? undefined) ? bezugId : null,
          });
          return { art: 'neu' as const, id: neueId };
        }

        const kennung = id as string;

        if (was === 'status') {
          const stand = text('status') ?? '';
          if (!STAENDE.has(stand)) return { art: 'fehler' as const, code: 'status' };
          const ok = await setzeStatus(kontext, kennung,
                                       stand as 'offen' | 'in_arbeit' | 'wartend');
          return ok ? { art: 'getan' as const, was: 'status' }
                    : { art: 'fehler' as const, code: 'unbekannt' };
        }

        if (was === 'zuweisen') {
          // Das zweite Recht, und es wird hier geprueft: die Seite entscheidet,
          // was sie zeigt, der Handler, was er tut.
          await authorize(sitzungsdaten, { recht: 'aufgabe.zuweisen', schreibend: true },
                          pruefer);
          const benutzerId = text('benutzerId');
          const teamId = text('teamId');
          const ok = await weiseZu(kontext, kennung, {
            benutzerId: istKennung(benutzerId ?? undefined) ? benutzerId : null,
            teamId: istKennung(teamId ?? undefined) ? teamId : null,
          });
          return ok ? { art: 'getan' as const, was: 'zuweisen' }
                    : { art: 'fehler' as const, code: 'unbekannt' };
        }

        if (was === 'erledigen') {
          const ok = await erledige(kontext, kennung);
          return ok ? { art: 'getan' as const, was: 'erledigt' }
                    : { art: 'fehler' as const, code: 'unbekannt' };
        }

        if (was === 'abbrechen') {
          const grund = text('grund');
          if (grund === null) return { art: 'fehler' as const, code: 'grund' };
          const ok = await brichAb(kontext, kennung, grund);
          return ok ? { art: 'getan' as const, was: 'abgebrochen' }
                    : { art: 'fehler' as const, code: 'unbekannt' };
        }

        return { art: 'fehler' as const, code: 'unbekannter_vorgang' };
      })) as Promise<
        { art: 'neu'; id: string }
        | { art: 'getan'; was: string }
        | { art: 'fehler'; code: string }
      >);

    if (ergebnis.art === 'fehler') {
      const status = ergebnis.code === 'unbekannt' ? 404 : 400;
      return NextResponse.json({ fehler: ergebnis.code }, { status });
    }
    if (ergebnis.art === 'neu') {
      return zurueck(`/portal/${slug}/aufgaben/${ergebnis.id}`);
    }
    return zurueck(`/portal/${slug}/aufgaben/${String(id)}?getan=${ergebnis.was}`);
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
