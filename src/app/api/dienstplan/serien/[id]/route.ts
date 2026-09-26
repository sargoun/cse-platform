import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { autorisierungsAntwort } from '@/server/auth/antwort';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import { ausnahmeSchreibrecht, leseSerie } from '@/server/services/dienstplan/serie';
import { WOCHENTAGE } from '@/lib/datum/rrule';
import {
  SeriePflegeFehler, aendereSerienlauf, aendereTurnus, archiviereSerie, beendeSerie,
  type PflegeErgebnis,
} from '@/server/services/dienstplan/serie-pflege';

/**
 * `POST /api/dienstplan/serien/[id]` — eine Serie ändern, beenden oder
 * archivieren (V-021, TIM-02, TIM-03).
 *
 * **Zwei Rechte, wie bei den Ausnahmen daneben — und aus demselben Grund.**
 * Die Route gehört dem Dienstplan und verlangt `dienstplan.schreiben`. Die
 * Schreibpolicy der TABELLE fragt aber etwas anderes: `turnus` verlangt
 * `reinigung.schreiben` (0029), `posten` verlangt `security.schreiben`
 * (0069). Wer nur das erste prüft, schickt das Formular gegen eine Policy,
 * die null Zeilen trifft — und die Oberfläche sagt „nicht vorhanden", wo
 * „dafür fehlt das Gewerkerecht" die Wahrheit ist.
 *
 * `horizont` und `archivieren` schreiben ausschliesslich auf
 * `planungsserie` und brauchen deshalb NUR `dienstplan.schreiben`: das
 * Ausführungsprotokoll des Generators gehört dem Dienstplan, nicht dem
 * Gewerk.
 */
export const dynamic = 'force-dynamic';

const AKTIONEN = ['lauf', 'regel', 'beenden', 'archivieren'] as const;
type Aktion = typeof AKTIONEN[number];

const KENNUNG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Die vier Handlungen und das Recht, das die TABELLE dahinter verlangt. */
const BRAUCHT_GEWERK: Readonly<Record<Aktion, boolean>> = {
  lauf: false, regel: true, beenden: true, archivieren: false,
};

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

function zahl(daten: FormData, feld: string): number | undefined {
  const roh = text(daten, feld);
  if (roh === null) return undefined;
  const n = Number(roh);
  return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
}

export async function POST(
  anfrage: NextRequest, { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }
  const { id } = await params;
  if (!KENNUNG.test(id)) {
    return NextResponse.json({ fehler: 'nicht_gefunden' }, { status: 404 });
  }

  const daten = await anfrage.formData();
  const mandant = String(daten.get('mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const aktion = String(daten.get('aktion') ?? '') as Aktion;
  if (!AKTIONEN.includes(aktion)) {
    return NextResponse.json({ fehler: 'unbekannte_handlung' }, { status: 400 });
  }
  const blattPfad = `/portal/${mandant}/dienstplan/serien/${id}`;

  const zurueck = (hinweis: string | null, ergebnis: PflegeErgebnis | null): NextResponse => {
    const ziel = new URL(internesZiel(blattPfad, blattPfad, anfrage));
    if (hinweis !== null) ziel.searchParams.set('fehler', hinweis);
    else if (ergebnis !== null) {
      ziel.searchParams.set('gepflegt', aktion);
      ziel.searchParams.set('erzeugt', String(ergebnis.erzeugt));
      ziel.searchParams.set('storniert', String(ergebnis.storniert + ergebnis.abgesagt));
    }
    return NextResponse.redirect(ziel, 303);
  };

  try {
    const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const pruefer = rechtepruefer(kontext.abfrage.bind(kontext));
        await authorize(sitzung, { recht: 'dienstplan.schreiben', schreibend: true }, pruefer);

        if (BRAUCHT_GEWERK[aktion]) {
          /* Der Träger entscheidet, welches Gewerkerecht gilt — er wird
             deshalb gelesen, bevor das zweite `authorize` läuft. */
          const blatt = await leseSerie(kontext, id);
          if (blatt === null) {
            throw new SeriePflegeFehler('Diese Serie gibt es nicht.', 'nicht_gefunden', 404);
          }
          const gewerk = ausnahmeSchreibrecht(blatt);
          if (gewerk === null) {
            throw new SeriePflegeFehler(
              'Eine Veranstaltung trägt keine Regel, die sich ändern oder beenden liesse.',
              'kein_turnus', 409);
          }
          await authorize(sitzung, { recht: gewerk, schreibend: true }, pruefer);
        }

        switch (aktion) {
          case 'lauf':
            return aendereSerienlauf(kontext, id, {
              ...(zahl(daten, 'horizont') === undefined
                ? {} : { horizontTage: zahl(daten, 'horizont') as number }),
              ...(daten.get('feiertage') === null
                ? {} : { feiertageUeberspringen: text(daten, 'feiertage') === 'ausfall' }),
              ...(text(daten, 'bundesland') === null
                ? {} : { bundesland: (text(daten, 'bundesland') as string).toUpperCase() }),
            });
          case 'regel': {
            const tage = daten.getAll('tag')
              .filter((w): w is string => typeof w === 'string')
              .filter((w) => (WOCHENTAGE as readonly string[]).includes(w));
            return aendereTurnus(kontext, id, {
              ...(text(daten, 'bezeichnung') === null
                ? {} : { bezeichnung: text(daten, 'bezeichnung') as string }),
              ...(tage.length > 0 ? { wochentage: tage } : {}),
              ...(text(daten, 'beginn') === null
                ? {} : { beginnLokal: text(daten, 'beginn') as string }),
              ...(zahl(daten, 'dauer') === undefined
                ? {} : { dauerMinuten: zahl(daten, 'dauer') as number }),
              ...(text(daten, 'feiertage') === null
                ? {} : {
                  feiertagsregel: text(daten, 'feiertage') === 'ausfall'
                    ? 'ausfall' as const : 'unveraendert' as const,
                }),
              /*
               * Der Anker (V-191): nur, wenn das Feld GESCHICKT wurde. Eine
               * Maske ohne `auftrag.lesen` zeigt es nicht — und ein fehlendes
               * Feld darf den Anker nicht still loeschen. Leer heisst: loesen.
               */
              ...(daten.has('auftrag_leistung')
                ? { auftragLeistungId: text(daten, 'auftrag_leistung') } : {}),
            });
          }
          case 'beenden':
            return beendeSerie(kontext, id, text(daten, 'bis') ?? '');
          case 'archivieren':
            return archiviereSerie(kontext, id, text(daten, 'grund') ?? '');
        }
      })) as Promise<PflegeErgebnis>);
    return zurueck(null, ergebnis);
  } catch (fehler) {
    if (fehler instanceof SeriePflegeFehler) return zurueck(fehler.grund, null);
    const autorisierung = autorisierungsAntwort(fehler);
    if (autorisierung !== null) return autorisierung;
    throw fehler;
  }
}
