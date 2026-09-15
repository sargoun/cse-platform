import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/server/db/pool';
import { bindeAnfrage, type Scope } from '@/server/kontext/index';
import { loeseTokenAuf, type FeedBereich } from '@/server/kalender/feed';
import { kalenderZeilen } from '@/server/services/kalender/eintraege';
import { alsIcal, type Termin } from '@/server/services/kalender/ical';

/**
 * `GET /api/kalender/[token]` — der lesende iCal-Feed (CAL-03).
 *
 * **Die einzige Route der Plattform ohne Sitzung, die Mandantendaten
 * herausgibt** — und deshalb die, bei der jede Zeile eine Begründung hat.
 *
 * **Der Token ersetzt die Anmeldung, nicht die Rechte.** Er sagt, WER liest;
 * was dieser Mensch sehen darf, entscheiden danach dieselben Policies wie im
 * Portal. Ein zweiter Lesepfad „für den Feed" wäre der erste, der bei einer
 * Policy-Änderung vergessen wird.
 *
 * **Und die Sitzung wird nicht erfunden** (0161). Portal, Person und
 * Bereichsliste kommen aus `app.kalender_feed_aufloesen` — derselben Quelle,
 * aus der `app.sitzung_aufloesen` sie nimmt. Vorher stand hier
 * `portal: 'intern', personId: null` für jeden Tokenträger, und das war
 * zweimal falsch: es hob die restriktive K-04-Decke `p_ma_decke`, und es
 * schnitt den einzigen Lesepfad ab, über den ein Arbeiter seine eigenen
 * Schichten überhaupt sieht — der Feed war für die Leute leer, für die er
 * gebaut wurde.
 *
 * **Das Portal bestimmt den Scope**, weil die Policies daran hängen:
 *
 * | Portal | Scope | Warum |
 * |---|---|---|
 * | `intern` | `mandant`, je Bereich | `t_mandant` prüft `app.aktiver_mandant()` und das Recht |
 * | `mitarbeiter` | `person`, EINMAL | `t_person` sieht über `anstellung` alle Gesellschaften dieses Menschen |
 * | `kunde` | `kunde`, EINMAL | `t_kunde` sieht über `kunde_zugang` |
 *
 * Wer beides ist — Leitung in der einen Gesellschaft, eingeteilt in der
 * anderen — bekommt beide Durchgänge; doppelte Zeilen fängt die UID ab.
 *
 * **Nur die eigenen Einträge.** `nurBenutzerId` ist gesetzt, immer: der Feed
 * ist ein persönlicher Kalender, und ein Token, der den ganzen Dienstplan
 * herausgäbe, wäre eine andere Sache als der, um den jemand gebeten hat.
 *
 * **Ein falscher Token ist 404, kein 401.** Ein 401 lüde zum zweiten Versuch
 * ein; 404 sagt dasselbe wie für jede Adresse, die es nicht gibt. Und ein
 * widerrufener verhält sich wie ein nie vergebener.
 *
 * **Kein Schnappschuss.** Die Auflösung ZÄHLT den Abruf, also schreibt diese
 * Transaktion. Unter `repeatable read` brechen zwei überlappende Abrufe
 * desselben Kalenders mit `40001` ab — und zwei überlappende Abrufe sind bei
 * einem Feed der Normalfall: ein Telefon und ein Rechner fragen im selben
 * Takt. Read committed ist hier richtig; die Datei ist ohnehin eine Momentaufnahme.
 *
 * **Kein Zwischenspeicher.** `no-store`: die Datei enthält Termine, und sie
 * ist morgen anders.
 */
export const dynamic = 'force-dynamic';

/** Vier Wochen zurück, ein Jahr voraus — was ein Kalenderprogramm braucht. */
const RUECKBLICK_TAGE = 28;
const VORSCHAU_TAGE = 365;

/** Das Portal bestimmt den Scope — siehe die Tabelle oben. */
function scopeFuer(portal: FeedBereich['portal']): Scope {
  return portal === 'intern' ? 'mandant' : portal === 'kunde' ? 'kunde' : 'person';
}

export async function GET(
  _anfrage: NextRequest, { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  const ergebnis = await (db().begin(async (tx: postgres.TransactionSql) => {
    const roh = async <T,>(s: string, w?: readonly unknown[]): Promise<readonly T[]> =>
      (await tx.unsafe(s, (w ?? []) as never[])) as unknown as readonly T[];

    const zugang = await loeseTokenAuf({ abfrage: roh }, token);
    if (zugang === null) return null;

    const [uhr] = await roh<{ von: string; bis: string; jetzt: string }>(
      `select (app.berlin_heute() - $1::int)::text as von,
              (app.berlin_heute() + $2::int)::text as bis,
              now()::text as jetzt`, [RUECKBLICK_TAGE, VORSCHAU_TAGE]);

    /*
     * Ein Durchgang je Bereich für `intern`; für die beiden anderen Scopes
     * EINER, weil `app.sichtbare_mandanten()` dort schon alle Gesellschaften
     * dieses Menschen liefert (`anstellung` bzw. `kunde_zugang`). Je Bereich
     * zu binden gäbe dort dieselben Zeilen mehrfach.
     */
    const laeufe: { scope: Scope; mandantId: string | null }[] = [];
    for (const b of zugang.bereiche) {
      const scope = scopeFuer(b.portal);
      if (scope === 'mandant') laeufe.push({ scope, mandantId: b.mandantId });
      else if (!laeufe.some((l) => l.scope === scope)) {
        laeufe.push({ scope, mandantId: null });
      }
    }

    const gesehen = new Set<string>();
    const termine: Termin[] = [];
    for (const lauf of laeufe) {
      /*
       * Ein Personen- oder Kundenscope ohne Person bzw. ohne Zugang liefert
       * `sichtbare_mandanten() = {}` und damit nichts — er wird gar nicht
       * erst gebunden, statt eine Sitzung zu stellen, die niemanden meint.
       */
      if (lauf.scope === 'person' && zugang.personId === null) continue;
      await bindeAnfrage(tx, {
        benutzerId: zugang.benutzerId,
        personId: zugang.personId,
        aktiverMandantId: lauf.mandantId,
        ansicht: lauf.scope,
        aal: 'aal1',
        portal: lauf.scope === 'mandant' ? 'intern'
          : lauf.scope === 'kunde' ? 'kunde' : 'mitarbeiter',
        sitzungId: '00000000-0000-0000-0000-000000000000',
      });
      const zeilen = await kalenderZeilen({ abfrage: roh }, {
        zeitraum: { von: uhr!.von, bis: uhr!.bis, bezeichnung: 'Feed' },
        nurBenutzerId: zugang.benutzerId,
      });
      for (const z of zeilen) {
        /*
         * Die UID traegt die QUELLE mit: derselbe Zaehler koennte in zwei
         * Tabellen dieselbe UUID haben, und zwei VEVENTs mit gleicher UID
         * sind fuer ein Kalenderprogramm ein Termin, der sich selbst
         * ueberschreibt. Sie ist damit auch der Schluessel, an dem zwei
         * Durchgaenge dieselbe Zeile als dieselbe erkennen.
         */
        const uid = `${z.quelle}-${z.id}@cse-gruppe.de`;
        if (gesehen.has(uid)) continue;
        gesehen.add(uid);
        termine.push({
          uid,
          titel: z.titel,
          beginn: new Date(z.beginn),
          ende: new Date(z.ende),
          ganztaegig: z.ganztaegig,
          beschreibung: z.beschreibung,
          ort: z.ort,
          abgesagt: z.abgesagt,
          geaendert: z.geaendert === null ? null : new Date(z.geaendert),
        });
      }
    }
    return { name: 'CSE Gruppe', termine, jetzt: new Date(uhr!.jetzt) };
  })) as { name: string; termine: Termin[]; jetzt: Date } | null;

  if (ergebnis === null) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const ics = alsIcal({ name: ergebnis.name, jetzt: ergebnis.jetzt }, ergebnis.termine);
  return new NextResponse(ics, {
    status: 200,
    headers: {
      /*
       * Ohne `method=` — die Datei trägt kein `METHOD` (siehe `alsIcal`), und
       * RFC 5545 §8.1 verlangt, dass beide dasselbe sagen oder keines von
       * beiden da ist.
       */
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="cse-kalender.ics"',
      'cache-control': 'no-store',
      // Der Feed ist kein Dokument fuer andere Herkuenfte (SEC-A7).
      'x-content-type-options': 'nosniff',
    },
  });
}
