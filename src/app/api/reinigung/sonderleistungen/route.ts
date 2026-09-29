import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { autorisierungsAntwort, ohneSitzungAntwort } from '@/server/auth/antwort';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  erfasseAbruf, setzeStatus, setzeZeitwert, storniereAbruf, SONDERLEISTUNG_STATUS,
  type AbrufFormularGrund, type SonderleistungErfolg, type SonderleistungStatus,
} from '@/server/services/reinigung/sonderleistung';

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
 * Wunsch weiter, und die Absage reist als Schlüssel zurück auf die Seite.
 *
 * **Zurück auf die Seite gehen nur Schlüssel** (V-275, D-773, D-769): ein
 * Erfolg als `?erfolg=<schluessel>`, eine Abweisung als `?fehler=<grund>`;
 * die Seite schlägt beide nach (`SONDERLEISTUNG_TEXTE`). Hier standen vorher
 * die Sätze selbst in `?ok=` und `?fehler=` — der Zustandswechsel samt den
 * Wörtern „vorher/jetzt", ein unbekannter Abruf samt Kennung —, und die
 * Weiche ersetzte JEDE Antwort von `alsAntwort` mit Meldung durch den
 * Rückweg: ein fehlendes Recht wurde „Nicht gefunden" über der Liste statt
 * der byte-gleichen 404 (AUT-06), die Umleitung auf den Faktor-Schritt ein
 * Satz (D-766). Die Anmeldung kommt jetzt zuerst.
 */
export const dynamic = 'force-dynamic';

function text(daten: FormData, feld: string): string | null {
  const wert = daten.get(feld);
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null;
}

class Unvollstaendig extends Error {
  readonly code = 'unvollstaendig';
  readonly status = 400;
  constructor(nachricht: string, readonly grund: AbrufFormularGrund) {
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
    return ohneSitzungAntwort(anfrage, sitzung);
  }

  const daten = await anfrage.formData();
  const mandant = (text(daten, 'mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const roheArt = text(daten, 'art');
  const art: Art | undefined = ARTEN.find((a) => a === roheArt);
  if (art === undefined) {
    return NextResponse.json({ fehler: 'art_unbekannt' }, { status: 400 });
  }
  const liste = `/portal/${mandant}/reinigung/sonderleistungen`;

  let erfolg: SonderleistungErfolg;
  try {
    erfolg = await (db().begin(async (tx: postgres.TransactionSql) =>
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
          if (position === null) {
            throw new Unvollstaendig('Die Katalogposition fehlt.', 'position_fehlt');
          }
          await setzeZeitwert(kontext, {
            id: position,
            zeitwertMinuten: text(daten, 'zeitwert'),
            einheit: text(daten, 'einheit'),
            /* Das Haekchen sagt „bestaetigt"; `ist_platzhalter` ist sein
               Gegenteil. Aus „es steht eine Zahl drin" abgeleitet waere es
               falsch — eine Zahl steht auch im Platzhalter (O-17). */
            istPlatzhalter: daten.get('bestaetigt') !== 'ja',
          });
          return 'zeitwert_gesetzt';
        }

        if (art === 'status') {
          const abruf = text(daten, 'abruf');
          const roherStatus = text(daten, 'status');
          const status: SonderleistungStatus | undefined =
            SONDERLEISTUNG_STATUS.find((s) => s === roherStatus);
          if (abruf === null || status === undefined) {
            throw new Unvollstaendig('Abruf und Zustand sind Pflicht.', 'zustand_unvollstaendig');
          }
          /*
           * Der Satz nannte „jetzt" und „vorher". Beides reist nicht mit: der
           * neue Zustand ist die Eingabe des Formulars, und die Liste darunter
           * zeigt ihn (D-769 Nr. 5).
           */
          await setzeStatus(kontext, { id: abruf, status });
          return 'status_gesetzt';
        }

        if (art === 'storno') {
          const abruf = text(daten, 'abruf');
          const grund = text(daten, 'grund');
          if (abruf === null || grund === null) {
            throw new Unvollstaendig('Abruf und Stornogrund sind Pflicht.', 'storno_unvollstaendig');
          }
          await storniereAbruf(kontext, { id: abruf, grund });
          return 'abruf_storniert';
        }

        const objekt = text(daten, 'objekt');
        const position = text(daten, 'position');
        const bezeichnung = text(daten, 'bezeichnung');
        const beauftragtAm = text(daten, 'beauftragt_am');
        if (objekt === null || position === null || bezeichnung === null
          || beauftragtAm === null) {
          throw new Unvollstaendig(
            'Objekt, Katalogposition, Bezeichnung und „Beauftragt am" sind Pflicht.',
            'abruf_unvollstaendig');
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
            + 'objekt.lesen — ohne das Objekt ist kein Kunde bekannt.', 'objekt_unbekannt');
        }
        if (ziel.kunde_id === null) {
          throw new Unvollstaendig(
            'An diesem Objekt hängt kein Kunde. Ein Abruf ohne Kunde lässt sich nicht '
            + 'abrechnen — bitte zuerst den Kunden am Objekt hinterlegen.', 'objekt_ohne_kunde');
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
        return 'abruf_erfasst';
      })) as Promise<SonderleistungErfolg>);
  } catch (fehler) {
    /*
     * **Die Anmeldung zuerst** (D-766, D-769 Nr. 7): ein fehlendes Recht ist
     * die byte-gleiche 404 (AUT-06), ohne zweiten Faktor geht es auf den
     * Faktor-Schritt — keines davon wird je ein Rückweg auf die Seite.
     */
    const autorisierung = autorisierungsAntwort(fehler, anfrage);
    if (autorisierung !== null) return autorisierung;
    /*
     * Ein fachlicher Fehler trägt `status` und `code` — und seinen GRUND
     * (`SONDERLEISTUNG_GRUENDE`); eine Klasse ohne eigenen Grund reist mit
     * ihrem `code`, und die Seite zeigt dafür ihren allgemeinen Satz. Alles
     * andere bleibt ein Wurf (ein Programmfehler ist ein roter Lauf).
     */
    const status = (fehler as { status?: unknown }).status;
    const code = (fehler as { code?: unknown }).code;
    if (typeof status === 'number' && typeof code === 'string') {
      const grund = (fehler as { grund?: unknown }).grund;
      return zurueckAufDieSeite(anfrage, liste, 'fehler', typeof grund === 'string' ? grund : code);
    }
    throw fehler;
  }

  return zurueckAufDieSeite(anfrage, liste, 'erfolg', erfolg);
}

/** 303 auf die Seite mit genau EINEM Schlüssel — nie einem Satz (V-275, D-769). */
function zurueckAufDieSeite(
  anfrage: NextRequest, liste: string, name: 'erfolg' | 'fehler', schluessel: string,
): NextResponse {
  const ziel = internesZiel(liste, liste, anfrage);
  ziel.searchParams.set(name, schluessel);
  return NextResponse.redirect(ziel, 303);
}
