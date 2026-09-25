import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../../uebergang';
import {
  AngebotFehler, entscheideAngebot, wandleInAuftrag,
} from '@/server/services/angebot/index';
import { NummernkreisFehler } from '@/server/services/finanz/nummernkreis';
import {
  AuftragsangabenFehler, pruefeAuftragsangaben,
} from '@/server/services/auftrag/angaben';

/**
 * `POST /api/angebot/entscheidung` — was der Kunde gesagt hat (OPS-09, CRM-05).
 *
 * Drei Ausgaenge, ein Recht (`angebot.annahme_erfassen`): annehmen, ablehnen,
 * zurueckziehen. Dass alle drei dasselbe Recht tragen, ist keine Bequemlichkeit
 * — es ist DIE Entscheidung: wer eine kaufmaennische Zusage in den Datenbestand
 * schreibt, darf auch festhalten, dass sie ausgeblieben ist. Zwei Rechte
 * hiessen, dass jemand nur die guten Nachrichten erfassen darf, und dann
 * bliebe der Vertriebsbestand voll offener Angebote, die niemand mehr will.
 *
 * **Warum eine eigene Adresse und nicht `aktion='in_auftrag'` auf
 * `/api/angebot`.** Jene Adresse bleibt, wie sie ist — die Detailseite wandelt
 * dort weiter mit ihren Vorgaben. Was hier hinzukommt, sind die Angaben, die
 * `wandleInAuftrag` bisher GERATEN bekam: Auftragsart (die Detailseite setzt
 * hart `rahmenvertrag`), Laufzeit und die Notiz, WAS der Kunde zugesagt hat.
 * Und der Ablehnungspfad, den es gar nicht gab.
 */
export const dynamic = 'force-dynamic';

const ARTEN = ['einzelauftrag', 'rahmenvertrag', 'dauerauftrag', 'projekt'] as const;
type Auftragsart = (typeof ARTEN)[number];

/**
 * Ein Waechter, kein `as`.
 *
 * `art as 'einzelauftrag'` ist eine Zusicherung an den Uebersetzer und aendert
 * den Laufzeitwert nicht — gespeichert wuerde also der richtige Wert, aber
 * jede spaetere Aenderung der Aufzaehlung ginge stillschweigend durch.
 * Dieselbe Begruendung wie in `api/angebot/route.ts`.
 */
function istAuftragsart(wert: string): wert is Auftragsart {
  return (ARTEN as readonly string[]).includes(wert);
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

interface Ergebnis {
  readonly angebotId: string;
  readonly auftragId: string | null;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus<Ergebnis>(anfrage, {
    recht: 'angebot.annahme_erfassen',
    grundVon: (f) => grundAus(f, AngebotFehler, NummernkreisFehler, AuftragsangabenFehler),
    /*
     * V-240: eine abgewiesene Annahme bringt ihre Eingaben zurück — sonst
     * standen Personalbedarf, Stunden und Ausstattung nach einem Tippfehler
     * wieder leer da. `ausgang` sagt der Seite, welches der beiden Formulare
     * gemeint war.
     */
    maskeFelder: [
      'ausgang', 'notiz', 'art', 'verantwortlichBenutzerId', 'startDatum', 'laufzeitBis',
      'personalbedarfAnzahl', 'wochenstundenSoll', 'ausstattungHinweis',
    ],
    handle: async (kontext, rumpf): Promise<Ergebnis> => {
      const db = { abfrage: kontext.abfrage.bind(kontext) };
      const dbMitNummern = {
        ...db,
        unsafe: async (s: string, w: readonly unknown[] = []) =>
          kontext.schreibe<unknown>(s, w),
      };
      const angebotId = rumpf.felder['angebotId'] ?? '';
      if (!UUID.test(angebotId)) {
        throw new AngebotFehler('Kein Angebot benannt', 'nicht_gefunden');
      }
      const ausgang = rumpf.felder['ausgang'] ?? '';

      if (ausgang === 'abgelehnt' || ausgang === 'zurueckgezogen') {
        const notiz = (rumpf.felder['notiz'] ?? '').trim();
        if (notiz === '') {
          throw new AngebotFehler(
            'Eine Ablehnung oder ein Rückzug nennt seinen Grund — sonst steht später '
            + 'nur da, dass daraus nichts wurde', 'nicht_entscheidbar');
        }
        await entscheideAngebot(db, angebotId, { ausgang, notiz });
        return { angebotId, auftragId: null };
      }

      if (ausgang !== 'angenommen') {
        throw new AngebotFehler(
          'Unbekannter Ausgang — angenommen, abgelehnt oder zurueckgezogen',
          'nicht_entscheidbar');
      }

      const art = rumpf.felder['art'] ?? '';
      const startDatum = rumpf.felder['startDatum'] ?? '';
      if (!istAuftragsart(art) || !DATUM.test(startDatum)) {
        throw new AngebotFehler(
          'Auftragsart und Startdatum sind Pflicht', 'nicht_entscheidbar');
      }
      const laufzeitBis = (rumpf.felder['laufzeitBis'] ?? '').trim();
      if (laufzeitBis !== '' && !DATUM.test(laufzeitBis)) {
        throw new AngebotFehler('Die Laufzeit ist kein Datum', 'nicht_entscheidbar');
      }
      const verantwortlich = (rumpf.felder['verantwortlichBenutzerId'] ?? '').trim();
      if (verantwortlich !== '' && !UUID.test(verantwortlich)) {
        throw new AngebotFehler('Unbekannte Verantwortliche', 'nicht_entscheidbar');
      }
      const notiz = (rumpf.felder['notiz'] ?? '').trim();
      /*
       * OPS-10 (V-173): Personalbedarf, Stunden, Ausstattung — freiwillig,
       * nie geschätzt, geprüft mit demselben Leser wie im Assistenten. Eine
       * Abweisung kommt als Schlüssel auf die Annahmeseite zurück.
       */
      const angaben = pruefeAuftragsangaben({
        personalbedarf: rumpf.felder['personalbedarfAnzahl'] ?? null,
        wochenstunden: rumpf.felder['wochenstundenSoll'] ?? null,
      });
      if (!angaben.ok) throw new AuftragsangabenFehler(angaben.grund, angaben.felder);
      const ausstattung = (rumpf.felder['ausstattungHinweis'] ?? '').trim();

      const auftrag = await wandleInAuftrag(dbMitNummern, angebotId, {
        art,
        /**
         * Ohne Angabe ist es die SITZUNG — und `kern.auftrag_verantwortlich_
         * im_mandant` weist eine Person ab, die nicht in dieser Gesellschaft
         * arbeitet. Ein Vorgabewert waere hier also kein „irgendwer", sondern
         * der, der geklickt hat, und das ist im Zweifel richtig.
         */
        verantwortlichBenutzerId: verantwortlich === '' ? kontext.benutzerId : verantwortlich,
        startDatum,
        ...(laufzeitBis === '' ? {} : { laufzeitBis }),
        ...(notiz === '' ? {} : { entscheidungNotiz: notiz }),
        personalbedarfAnzahl: angaben.werte.personalbedarf,
        wochenstundenSoll: angaben.werte.wochenstunden,
        ausstattungHinweis: ausstattung === '' ? null : ausstattung,
      });
      return { angebotId, auftragId: auftrag.auftragId };
    },
    ziel: (slug, ergebnis) => (ergebnis.auftragId === null
      ? `/portal/${slug}/angebote/${ergebnis.angebotId}`
      : `/portal/${slug}/auftraege/${ergebnis.auftragId}`),
  });
}
