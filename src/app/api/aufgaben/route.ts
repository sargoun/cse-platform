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

/**
 * **Das Auswahlfeld des Anlegeformulars auflösen** (V-096).
 *
 * Es schickt EIN Feld, `<typ>:<kennung>` — zwei Felder waeren zwei Zustaende,
 * die auseinanderlaufen koennen (Typ gesetzt, Kennung leer), und genau das
 * weist `aufgabe_bezug_paarweise` in der Datenbank ab.
 *
 * **Fuer die drei Arten mit echtem Fremdschluessel wird BEIDES gesetzt.**
 * `auftrag_id`, `objekt_id` und `lead_id` tragen zusammengesetzte
 * Fremdschluessel und werden von der LISTE ueber Joins gezeigt; das
 * polymorphe Paar traegt die Detailseite (`loeseBezugAuf`). Nur eines zu
 * setzen liesse die jeweils andere Ansicht leer — und zwar still.
 *
 * Ein unbekannter oder verstuemmelter Wert ergibt KEINEN Bezug und keinen
 * Fehler: das Feld ist freiwillig, und `legeAn` prueft den Typ ohnehin noch
 * einmal.
 */
function gewaehlterBezug(roh: string | null): {
  readonly bezugTyp?: string | null;
  readonly bezugId?: string | null;
  readonly auftragId?: string | null;
  readonly objektId?: string | null;
  readonly leadId?: string | null;
} {
  if (roh === null || roh === '') return {};
  const trenner = roh.indexOf(':');
  if (trenner < 1) return {};
  const typ = roh.slice(0, trenner);
  const kennung = roh.slice(trenner + 1);
  if (!istBezugTyp(typ) || !istKennung(kennung)) return {};
  return {
    bezugTyp: typ, bezugId: kennung,
    ...(typ === 'auftrag' ? { auftragId: kennung } : {}),
    ...(typ === 'objekt' ? { objektId: kennung } : {}),
    ...(typ === 'lead' ? { leadId: kennung } : {}),
  };
}
import {
  brichAb, erledige, istBezugTyp, legeAn, setzeStatus, weiseZu,
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

/**
 * Ein Kalendertag — Form UND Gültigkeit.
 *
 * `TAG` allein liess `9999-99-99` durch, und `::date` in der Datenbank
 * antwortete darauf mit „date/time field value out of range" — ein 22008, das
 * keine der drei gefangenen Klassen ist und als 500 endete. Eine
 * unsinnige Eingabe ist eine 400.
 */
function istTag(wert: string): boolean {
  if (!TAG.test(wert)) return false;
  const t = Date.parse(`${wert}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // `Date.parse` normalisiert („2026-02-30" wird der 2. März); der Vergleich
  // mit dem Eingegebenen weist das ab, statt einen anderen Tag zu speichern.
  return new Date(t).toISOString().slice(0, 10) === wert;
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
          if (tag !== null && !istTag(tag)) {
            return { art: 'fehler' as const, code: 'datum' };
          }
          /*
           * **Der polymorphe Bezug ist ein PAAR und wird als Paar geprüft.**
           *
           * `bezugTyp` lief vorher ungeprüft in `$n::bezug_typ` — ein
           * `bezugTyp=foo` endete als 22P02 und damit als 500. Und ein Typ
           * ohne Id verletzt `aufgabe_bezug_paarweise` (23514), also
           * ebenfalls 500. Beides sind Eingaben und beides sind 400er.
           */
          const bezugTyp = text('bezugTyp');
          const bezugId = text('bezugId');
          if (bezugTyp !== null && !istBezugTyp(bezugTyp)) {
            return { art: 'fehler' as const, code: 'bezug_typ' };
          }
          const bezugKennung = istKennung(bezugId ?? undefined) ? bezugId : null;
          if ((bezugTyp === null) !== (bezugKennung === null)) {
            return { art: 'fehler' as const, code: 'bezug_paar' };
          }
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
            bezugTyp,
            bezugId: bezugKennung,
            /*
             * **Das EINE Feld des Formulars** (V-096) — `<typ>:<kennung>`.
             *
             * Es überschreibt die fünf Einzelfelder oben, wenn es kommt: die
             * bleiben für Aufrufer, die einen Bezug schon kennen (ein Knopf
             * auf einem Vorgangsblatt), das Auswahlfeld ist der Weg für den
             * Menschen, der die Aufgabe auf der Aufgabenseite anlegt.
             */
            ...gewaehlterBezug(text('bezug')),
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
