import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  istWachbuchArt, korrigiereEintrag, schreibeEintrag,
} from '@/server/services/security/wachbuch';
import { alsAntwort } from '../antwort';

/**
 * `POST /api/sicherheit/wachbuch` — eine Wachbuchseite schreiben oder
 * richtigstellen (SEC-05, TIM-08, TIM-10).
 *
 * **Zwei Vorgänge, eine Adresse, und das ist kein Sammelsurium.** Anlegen und
 * Korrigieren brauchen dieselbe Sitzung, denselben Ursprungscheck, denselben
 * Mandantenkontext und dasselbe Recht — und die Korrektur IST ein Anlegen,
 * nur mit einem Storno daneben. Zwei Adressen wären zwei Stellen, an denen die
 * Prüfung fehlen kann.
 *
 * **Die Zeit kommt nicht von hier.** Der Server stempelt `erfasst_am` im
 * Auslöser (0070); was das Formular mitschickt, ist höchstens
 * `geraete_zeit` — eine Behauptung, die daneben gespeichert wird und nie an
 * die Stelle der Serverzeit tritt (Invariante 5, TIM-08).
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
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
  const betreff = text(daten, 'betreff');
  const eintragstext = text(daten, 'eintragstext');
  const korrigiert = text(daten, 'korrigiert');
  const mandant = String(daten.get('mandant') ?? '');

  if (betreff === null || eintragstext === null) {
    return NextResponse.json({ fehler: 'pflichtfeld_fehlt' }, { status: 400 });
  }

  let neu: string;
  try {
    neu = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung,
          { recht: 'wachbuch.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (korrigiert !== null) {
          const grund = text(daten, 'grund');
          if (grund === null) {
            // Kein Grund, kein Vorgang — dieselbe Regel wie beim Quittieren
            // eines Konflikts.
            throw Object.assign(new Error('Eine Korrektur braucht einen Grund.'), {
              code: 'ungueltige_eingabe', status: 400,
            });
          }
          return korrigiereEintrag(kontext, {
            eintragId: korrigiert, grund, betreff, eintragstext,
          });
        }

        const objektId = text(daten, 'objekt');
        const art = daten.get('art');
        if (objektId === null || !istWachbuchArt(art)) {
          throw Object.assign(new Error('Objekt und Art gehören zu jedem Eintrag.'), {
            code: 'pflichtfeld_fehlt', status: 400,
          });
        }
        return schreibeEintrag(kontext, {
          objektId,
          art,
          betreff,
          eintragstext,
          einsatzId: text(daten, 'einsatz'),
          postenId: text(daten, 'posten'),
          veranstaltungId: text(daten, 'veranstaltung'),
          kontrollpunktId: text(daten, 'kontrollpunkt'),
          praesenzBestaetigt: daten.get('praesenz') === '1',
          polizeiInformiert: daten.get('polizei') === '1',
          /**
           * Die Geräteuhr wird MITGESCHICKT, wenn die Oberfläche sie kennt —
           * und sofort als Abweichung verrechnet (TIM-08). Sie zu verschweigen
           * wäre bequemer und nähme der Auswertung genau die Tatsache, für die
           * invariant 5 die Spalte verlangt.
           */
          geraeteZeit: text(daten, 'geraete_zeit'),
          nachgetragen: daten.get('nachgetragen') === '1',
        });
      })) as Promise<string>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) return antwort;
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(
      daten.get('zurueck') as string | null,
      `/portal/${mandant}/security/wachbuch/${neu}`,
      anfrage,
    ),
    303,
  );
}
