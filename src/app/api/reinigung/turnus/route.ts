import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { rechteImKontext } from '@/server/auth/kontext-rechte';
import { withTenant } from '@/server/kontext/index';
import { legeTurnusSerieAn, type SerienErgebnis } from '@/server/services/dienstplan/serie';
import {
  legeAusnahmeAn, type AusnahmeArt, AUSNAHME_ARTEN,
} from '@/server/services/reinigung/turnus';
import { alsAntwort } from '../../sicherheit/antwort';
import { LeistungsankerFehler } from '@/server/services/dienstplan/leistungsanker';
import { MASKE_WERT_HOECHSTENS } from '@/lib/formular/maske';

/**
 * `POST /api/reinigung/turnus` — einen Turnus anlegen oder eine Ausnahme
 * erfassen (CLN-02, CLN-03, TIM-02).
 *
 * **Warum dieser Handler neben `api/dienstplan/serien` steht.** Jener
 * autorisiert hart auf `dienstplan.schreiben`. Die Route
 * `/portal/[mandant]/reinigung/turnus/neu` verlangt laut Manifest aber
 * `reinigung.schreiben` — eine Reinigungsleitung ohne Dienstplanrecht sah also
 * eine Seite, die ihr Recht anzeigt, und bekam hinter dem Knopf einen Fehler,
 * der ein anderes Recht nannte. Zwei Oberflächen, zwei Rechte, **ein Dienst**:
 * dieser Handler prüft das Recht der Route und ruft `legeTurnusSerieAn` —
 * dieselbe Funktion, denselben Generator, dasselbe Ergebnis.
 *
 * **Beide Rechte werden gebraucht, und der Handler sagt welches fehlt.** Der
 * Turnus liegt hinter `reinigung.schreiben`, die Planungsserie und die
 * Schichten hinter `dienstplan.schreiben` (RLS, nachgemessen). Ohne das zweite
 * bricht die Transaktion ab — und damit wird auch der Turnus NICHT angelegt.
 * Das ist die richtige Reihenfolge: ein Turnus ohne Serie erzeugt keine
 * Schicht und wäre eine Regel, die aussieht, als gälte sie.
 *
 * **Die Ausnahme braucht kein Dienstplanrecht.** `turnus_ausnahme` liegt hinter
 * `reinigung.schreiben`, und der Generator liest sie beim nächsten Lauf. Sie
 * ist deshalb der Weg, der einer Reinigungsleitung ohne Dienstplanrecht
 * offensteht.
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

/**
 * Ohne `dienstplan.schreiben` entsteht keine Serie und keine Schicht.
 *
 * Ein eigener Fehler und keine 403 aus `authorize`: die Sitzung DARF diese
 * Seite benutzen (sie hält `reinigung.schreiben`), nur diese eine Wirkung
 * bleibt ihr verschlossen. Die Meldung nennt das Recht, weil sie an eine
 * Administration geht, die es vergeben kann — nicht an einen Fremden (AUT-06
 * schützt die EXISTENZ einer Seite, nicht die Begründung einer Sperre auf
 * einer Seite, die man bereits sieht).
 */
class KeinPlanungsrecht extends Error {
  readonly code = 'kein_planungsrecht';
  readonly status = 422;
  constructor() {
    super(
      'Ein Turnus ohne Planungsserie erzeugt keine Schicht, und die Serie verlangt '
      + 'das Recht dienstplan.schreiben. Es wurde deshalb nichts angelegt — auch '
      + 'der Turnus nicht. Eine Ausnahme für einen einzelnen Tag ist ohne dieses '
      + 'Recht möglich.',
    );
    this.name = 'KeinPlanungsrecht';
  }
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
  const mandant = (text(daten, 'mandant') ?? '').replace(/[^a-z0-9-]/gu, '');
  const art = text(daten, 'art');
  if (art !== 'turnus' && art !== 'ausnahme') {
    return NextResponse.json({ fehler: 'art_unbekannt' }, { status: 400 });
  }
  const liste = `/portal/${mandant}/reinigung/turnus`;

  let ziel: string;
  try {
    ziel = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'reinigung.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        if (art === 'ausnahme') {
          const turnusId = text(daten, 'turnus');
          const datum = text(daten, 'datum');
          const roheArt = text(daten, 'ausnahme_art');
          const grund = text(daten, 'grund');
          if (turnusId === null || datum === null || grund === null) {
            throw new Unvollstaendig('Turnus, Datum und Grund sind Pflicht.');
          }
          const ausnahmeArt: AusnahmeArt | undefined =
            AUSNAHME_ARTEN.find((a) => a === roheArt);
          if (ausnahmeArt === undefined) {
            throw new Unvollstaendig('Die Art ist ausfall, zusatz oder verschiebung.');
          }
          const dauerRoh = text(daten, 'dauer');
          const dauer = dauerRoh === null ? null : Number(dauerRoh);
          const relevanzRoh = text(daten, 'abrechnungsrelevant');
          await legeAusnahmeAn(kontext, {
            turnusId,
            datum,
            art: ausnahmeArt,
            ersatzBeginn: text(daten, 'ersatz_beginn'),
            dauerMinuten: dauer === null || !Number.isFinite(dauer) ? null : Math.trunc(dauer),
            grund,
            // Leer heisst UNBEANTWORTET und nicht `false` (O-700).
            abrechnungsrelevant: relevanzRoh === 'ja' ? true
              : relevanzRoh === 'nein' ? false : null,
          });
          return `${liste}/${turnusId}?ausnahme=1`;
        }

        /*
         * Die Serie und die Schichten verlangen `dienstplan.schreiben`. Die
         * Abfrage steht VOR dem ersten Schreibvorgang, damit die Meldung das
         * fehlende Recht nennt statt „der Traeger gehoert nicht zu dieser
         * Gesellschaft" — die Meldung, die der Dienst gibt, wenn die RLS den
         * INSERT verschluckt hat.
         */
        const rechte = await rechteImKontext(kontext, 'dienstplan.schreiben');
        if (rechte['dienstplan.schreiben'] !== true) throw new KeinPlanungsrecht();

        const revierId = text(daten, 'revier');
        const leistungId = text(daten, 'leistung');
        const bezeichnung = text(daten, 'bezeichnung');
        const beginn = text(daten, 'beginn');
        const gueltigAb = text(daten, 'gueltig_ab');
        if (revierId === null || leistungId === null || bezeichnung === null
          || beginn === null || gueltigAb === null) {
          throw new Unvollstaendig(
            'Revier, Leistung, Bezeichnung, Beginn und „Gültig ab" sind Pflicht.');
        }
        const dauer = Number(text(daten, 'dauer') ?? '');
        const interval = Number(text(daten, 'interval') ?? '1');
        const ergebnis: SerienErgebnis = await legeTurnusSerieAn(kontext, {
          revierId,
          leistungskatalogPositionId: leistungId,
          bezeichnung,
          frequenz: text(daten, 'frequenz') === 'monatlich' ? 'monatlich' : 'woechentlich',
          wochentage: daten.getAll('wochentag').map((w) => String(w)),
          monatstage: daten.getAll('monatstag')
            .map((m) => Number(String(m)))
            .filter((m) => Number.isInteger(m)),
          interval: Number.isFinite(interval) ? Math.trunc(interval) : 1,
          beginnLokal: beginn,
          dauerMinuten: Number.isFinite(dauer) ? Math.trunc(dauer) : 0,
          gueltigAb,
          gueltigBis: text(daten, 'gueltig_bis'),
          feiertagsregel: text(daten, 'feiertage') === 'unveraendert' ? 'unveraendert' : 'ausfall',
          // Der Abrechnungsanker (V-191, TIM-12) — freiwillig, geprueft im Dienst.
          auftragLeistungId: text(daten, 'auftrag_leistung'),
        });
        /*
         * Was der Generator uebersprungen hat, steht im Ziel — nicht
         * verschwiegen. „0 Schichten erzeugt" ohne den Grund waere die
         * Meldung, nach der jemand eine Stunde sucht.
         */
        const uebersprungen = ergebnis.uebersprungen.length > 0
          ? `&uebersprungen=${encodeURIComponent(ergebnis.uebersprungen[0]?.grund ?? '')}`
          : '';
        return `${liste}?angelegt=${ergebnis.planungsserieId}`
          + `&erzeugt=${String(ergebnis.erzeugt)}`
          + `${ergebnis.bestandSchon ? '&bestand=1' : ''}${uebersprungen}`;
      })) as Promise<string>);
  } catch (fehler) {
    /*
     * **Ein abgewiesener Anker reist als SCHLÜSSEL** (V-192), nicht als
     * deutscher Satz: die Seite schlägt ihn in der Sprache der Sitzung nach.
     * Zurück geht es in die Vorschau, mit allen Eingaben — der Knopf, der
     * anlegt, steht dort wieder unter der Terminliste. Die übrigen Fehler
     * dieses Wegs reisen weiter als Satz (D-599-Altlast, D-686 Nr. 7).
     */
    if (fehler instanceof LeistungsankerFehler && art === 'turnus') {
      const suche = new URLSearchParams({ vorschau: '1' });
      for (const name of ['revier', 'leistung', 'bezeichnung', 'frequenz', 'interval', 'beginn',
        'dauer', 'gueltig_ab', 'gueltig_bis', 'feiertage', 'auftrag_leistung']) {
        const wert = text(daten, name);
        if (wert !== null) suche.set(name, wert.slice(0, MASKE_WERT_HOECHSTENS));
      }
      for (const w of daten.getAll('wochentag')) suche.append('wochentag', String(w));
      for (const m of daten.getAll('monatstag')) suche.append('monatstag', String(m));
      suche.set('fehler', fehler.grund);
      return NextResponse.redirect(
        internesZiel(`${liste}/neu?${suche.toString()}`, liste, anfrage), 303);
    }
    const antwort = alsAntwort(fehler);
    if (antwort !== null) {
      /*
       * Ein Formular-POST bekommt keine JSON-Antwort ins Gesicht: der Fehler
       * geht als Text zurueck auf die Seite, von der er kam. Nur ein Fehler
       * ohne eigene Meldung bleibt JSON.
       */
      const meldung = (fehler as { message?: string }).message;
      if (typeof meldung === 'string' && meldung !== '') {
        const zurueck = art === 'ausnahme'
          ? `${liste}/${text(daten, 'turnus') ?? ''}?fehler=${encodeURIComponent(meldung)}`
          : `${liste}/neu?fehler=${encodeURIComponent(meldung)}`;
        return NextResponse.redirect(internesZiel(zurueck, liste, anfrage), 303);
      }
      return antwort;
    }
    throw fehler;
  }

  return NextResponse.redirect(internesZiel(ziel, liste, anfrage), 303);
}
