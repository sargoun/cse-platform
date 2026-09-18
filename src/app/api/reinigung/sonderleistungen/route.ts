import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  erfasseAbruf, setzeStatus, setzeZeitwert, storniereAbruf,
  SONDERLEISTUNG_STATUS, STATUS_TEXT, type SonderleistungStatus,
} from '@/server/services/reinigung/sonderleistung';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/reinigung/sonderleistungen` — Abruf erfassen, Zustand setzen,
 * stornieren, Zeitwert pflegen (CLN-05, OPS-06).
 *
 * **Vier Vorgänge, EINE Adresse, ZWEI Rechte.** Die drei Vorgänge auf
 * `sonderleistung` autorisieren auf `reinigung.schreiben` (so steht es in der
 * RLS dieser Tabelle), der Zeitwert einer Katalogzeile auf `katalog.schreiben`
 * (RLS von `leistungskatalog_position`, und das Recht, das das Routenmanifest
 * für diese Seite als Schreibrecht führt). Vier Adressen wären vier Stellen,
 * an denen der Ursprungscheck oder der Mandantenkontext fehlen kann; ein
 * gemeinsames Recht für beide Hälften wäre eine erfundene Vereinfachung.
 *
 * **Der Zustand „abgerechnet" kommt hier nicht durch.** Die Regel steht in
 * `statuswechsel` im Dienst und wird dort geprüft — dieser Handler reicht den
 * Wunsch weiter und übersetzt die Absage in einen Satz, den ein Mensch liest.
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

class Unvollstaendig extends Error {
  readonly code = 'unvollstaendig';
  readonly status = 400;
  constructor(nachricht: string) {
    super(nachricht);
    this.name = 'Unvollstaendig';
  }
}

const ARTEN = ['abruf', 'status', 'storno', 'zeitwert'] as const;
type Art = (typeof ARTEN)[number];

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  if (!istGleicherUrsprung(anfrage)) {
    return NextResponse.json({ fehler: 'fremder_ursprung' }, { status: 403 });
  }
  const sitzung = await aktuelleSitzung();
  if (sitzung === null || sitzung.aktiverMandantId === null) {
    return NextResponse.json({ fehler: 'keine_sitzung' }, { status: 401 });
  }

  const daten = await anfrage.formData();
  const mandant = (text(daten, 'mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const roheArt = text(daten, 'art');
  const art: Art | undefined = ARTEN.find((a) => a === roheArt);
  if (art === undefined) {
    return NextResponse.json({ fehler: 'art_unbekannt' }, { status: 400 });
  }
  const liste = `/portal/${mandant}/reinigung/sonderleistungen`;

  let meldung: string;
  try {
    meldung = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        /*
         * Der Zeitwert gehoert dem Katalog, der Abruf der Reinigung — zwei
         * Tabellen, zwei RLS-Regeln, zwei Rechte. Das hier zu vereinheitlichen
         * hiesse, einem der beiden Rechte eine Wirkung zu geben, die es in der
         * Datenbank nicht hat.
         */
        await authorize(
          sitzung,
          {
            recht: art === 'zeitwert' ? 'katalog.schreiben' : 'reinigung.schreiben',
            schreibend: true,
          },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (art === 'zeitwert') {
          const position = text(daten, 'position');
          if (position === null) throw new Unvollstaendig('Die Katalogposition fehlt.');
          await setzeZeitwert(kontext, {
            id: position,
            zeitwertMinuten: text(daten, 'zeitwert'),
            einheit: text(daten, 'einheit'),
            /* Das Haekchen sagt „bestaetigt"; `ist_platzhalter` ist sein
               Gegenteil. Aus „es steht eine Zahl drin" abgeleitet waere es
               falsch — eine Zahl steht auch im Platzhalter (O-17). */
            istPlatzhalter: daten.get('bestaetigt') !== 'ja',
          });
          return 'Der Zeitwert der Katalogzeile ist gesetzt.';
        }

        if (art === 'status') {
          const abruf = text(daten, 'abruf');
          const roherStatus = text(daten, 'status');
          const status: SonderleistungStatus | undefined =
            SONDERLEISTUNG_STATUS.find((s) => s === roherStatus);
          if (abruf === null || status === undefined) {
            throw new Unvollstaendig('Abruf und Zustand sind Pflicht.');
          }
          const { von, nach } = await setzeStatus(kontext, { id: abruf, status });
          return `Der Abruf steht jetzt auf „${STATUS_TEXT[nach]}" (vorher „${STATUS_TEXT[von]}").`;
        }

        if (art === 'storno') {
          const abruf = text(daten, 'abruf');
          const grund = text(daten, 'grund');
          if (abruf === null || grund === null) {
            throw new Unvollstaendig('Abruf und Stornogrund sind Pflicht.');
          }
          await storniereAbruf(kontext, { id: abruf, grund });
          return 'Der Abruf ist storniert — mit Grund und Urheber, und nicht gelöscht.';
        }

        const objekt = text(daten, 'objekt');
        const position = text(daten, 'position');
        const bezeichnung = text(daten, 'bezeichnung');
        const beauftragtAm = text(daten, 'beauftragt_am');
        if (objekt === null || position === null || bezeichnung === null
          || beauftragtAm === null) {
          throw new Unvollstaendig(
            'Objekt, Katalogposition, Bezeichnung und „Beauftragt am" sind Pflicht.');
        }
        /*
         * Der Kunde kommt vom OBJEKT und nie aus dem Formular: `kunde_id` ist
         * auf `sonderleistung` NOT NULL, und ein aus der Anfrage
         * durchgereichter Kunde waere ein Abruf, den jemand einem anderen
         * Kunden in Rechnung stellt.
         */
        const [ziel] = await kontext.abfrage<{ kunde_id: string | null }>(
          `select kunde_id from objekt where id = $1::uuid`, [objekt],
        );
        if (ziel === undefined) {
          throw new Unvollstaendig(
            'Das Objekt gehört nicht zu dieser Gesellschaft, oder es fehlt das Recht '
            + 'objekt.lesen — ohne das Objekt ist kein Kunde bekannt.');
        }
        if (ziel.kunde_id === null) {
          throw new Unvollstaendig(
            'An diesem Objekt hängt kein Kunde. Ein Abruf ohne Kunde lässt sich nicht '
            + 'abrechnen — bitte zuerst den Kunden am Objekt hinterlegen.');
        }
        const roherStatus = text(daten, 'status');
        const status = SONDERLEISTUNG_STATUS.find((s) => s === roherStatus);
        await erfasseAbruf(kontext, {
          objektId: objekt,
          kundeId: ziel.kunde_id,
          leistungskatalogPositionId: position,
          bezeichnung,
          beauftragtAm,
          revierId: text(daten, 'revier'),
          /*
           * Ohne diese Zeile ist der Abruf nicht abrechenbar:
           * `finanz/abrechnungsart/einzelabruf.ts` verbindet `sonderleistung`
           * per INNER JOIN mit `auftrag_leistung`. Sie bleibt freiwillig — ein
           * Abruf entsteht oft vor dem Nachtrag —, aber sie wird jetzt
           * durchgereicht statt still verworfen. `sl_auftrag_leistung_fk`
           * haelt die Gesellschaft; eine fremde Zeile faellt dort auf.
           */
          auftragLeistungId: text(daten, 'auftrag_leistung'),
          beauftragtDurch: text(daten, 'beauftragt_durch'),
          ausfuehrungVon: text(daten, 'ausfuehrung_von'),
          ausfuehrungBis: text(daten, 'ausfuehrung_bis'),
          menge: text(daten, 'menge'),
          einheit: text(daten, 'einheit'),
          ...(status === undefined ? {} : { status }),
        });
        return 'Der Abruf ist erfasst.';
      })) as Promise<string>);
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) {
      const nachricht = (fehler as { message?: string }).message;
      if (typeof nachricht === 'string' && nachricht !== '') {
        return NextResponse.redirect(
          internesZiel(`${liste}?fehler=${encodeURIComponent(nachricht)}`, liste, anfrage), 303,
        );
      }
      return antwort;
    }
    throw fehler;
  }

  return NextResponse.redirect(
    internesZiel(`${liste}?ok=${encodeURIComponent(meldung)}`, liste, anfrage), 303,
  );
}
