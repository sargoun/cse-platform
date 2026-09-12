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
  AnzeigeVeraltet, BereitsUnterschrieben, FalscherZustand, NachweisNichtGefunden,
  legeVor, signiere,
} from '@/server/services/reinigung/leistungsnachweis';

/**
 * `POST /api/reinigung/leistungsnachweise` — **Schritt 2: unterschreiben**
 * (CLN-04, TIM-08, TIM-09, LEG-10).
 *
 * Der Aufruf trägt drei Dinge, die die Route selbst NICHT bestimmt:
 *
 *  - den **Namen** des Unterzeichners, wie er auf dem Papier stünde,
 *  - die **Gerätezeit**, die das Tablet behauptet — gespeichert, nie
 *    maßgeblich (Invariante 5), und
 *  - die **Prüfsumme** des Abzugs, den der Kunde gesehen hat.
 *
 * Die Serverzeit kommt aus `now()` im Auslöser, der Ort aus dem Browser und
 * nur, wenn `geo.erfassung_erlaubt` gesetzt ist (O-06). Stimmt die Prüfsumme
 * nicht mehr, wird NICHTS geschrieben: der Kunde hätte sonst unter etwas
 * unterschrieben, das er nicht gesehen hat.
 *
 * **`vorlegen` läuft über dieselbe Adresse.** Zwei Adressen für zwei Zeilen
 * Unterschied wären zwei Stellen, an denen die Sitzungs-, Ursprungs- und
 * Rechteprüfung fehlen kann — dieselbe Begründung wie bei `api/angebot`.
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
  const text = (feld: string): string | null => {
    const w = daten.get(feld);
    return typeof w === 'string' && w.trim() !== '' ? w.trim() : null;
  };
  const nachweisId = text('nachweis');
  const schritt = text('schritt') ?? 'unterschreiben';
  if (nachweisId === null) {
    return NextResponse.json({ fehler: 'kein_nachweis' }, { status: 400 });
  }

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
          { recht: 'nachweis.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (schritt === 'vorlegen') {
          await legeVor(kontext, nachweisId);
          return;
        }

        const name = text('unterzeichner');
        const pruefsumme = text('pruefsumme');
        if (name === null || pruefsumme === null) {
          throw new UnterschriftUnvollstaendig();
        }
        /**
         * Die Gerätezeit reist als ISO-Zeichenkette und wird NUR geparst,
         * nicht geprüft: eine Uhr, die falsch geht, ist kein Fehler des
         * Absenders, sondern die Tatsache, die TIM-09 festhalten will.
         */
        const geraet = text('geraete_zeit');
        await signiere(kontext, {
          nachweisId,
          rolle: text('rolle') === 'auftragnehmer' ? 'auftragnehmer' : 'auftraggeber',
          unterzeichnerName: name,
          unterzeichnerFunktion: text('funktion'),
          bestaetigtePruefsumme: pruefsumme,
          geraeteZeit: geraet === null ? null : new Date(geraet),
          anstellungId: text('anstellung'),
          signaturMedienId: text('medium'),
          breitengrad: text('lat'),
          laengengrad: text('lon'),
          geoGenauigkeitM: text('genauigkeit'),
          ip: anfrage.headers.get('x-forwarded-for'),
          userAgent: anfrage.headers.get('user-agent'),
        });
      }));
  } catch (fehler) {
    if (fehler instanceof UnterschriftUnvollstaendig) {
      return NextResponse.json({ fehler: 'unvollstaendig' }, { status: 400 });
    }
    if (fehler instanceof AnzeigeVeraltet) {
      return NextResponse.json(
        { fehler: 'anzeige_veraltet', hinweis: fehler.message }, { status: 409 },
      );
    }
    if (fehler instanceof BereitsUnterschrieben || fehler instanceof FalscherZustand) {
      return NextResponse.json(
        { fehler: 'ungueltiger_zustand', hinweis: fehler.message }, { status: 409 },
      );
    }
    // AUT-06: ein fremder Nachweis ist nicht vorhanden, nicht verboten.
    if (fehler instanceof NachweisNichtGefunden || fehler instanceof NichtGefundenFehler) {
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
    `/portal/${mandant}/reinigung/leistungsnachweise/${nachweisId}`,
    anfrage,
  );
  return NextResponse.redirect(ziel, 303);
}

class UnterschriftUnvollstaendig extends Error {
  constructor() {
    super('Ohne Namen und ohne bestätigte Prüfsumme wird nicht unterschrieben.');
    this.name = 'UnterschriftUnvollstaendig';
  }
}
