import { type NextRequest, type NextResponse } from 'next/server';
import { fuehreUebergangAus, grundAus, UUID } from '../uebergang';
import {
  aenderePosition, KatalogFehler, legeKatalogAn, legePositionAn,
  setzeKatalogStatus, setzePositionAusserKraft, type PositionEingabe,
} from '@/server/services/katalog/index';
import type { Rumpf } from '../rumpf';

/**
 * `POST /api/katalog` — Katalogfassungen und ihre Positionen (OPS-06, CLN-05).
 *
 * Recht: `katalog.schreiben` — und das haelt laut Katalog nur `admin` und
 * `super_admin`, NICHT `leitung`, die `katalog.lesen` hat. Die beiden
 * Katalogseiten zeigen deshalb einer Leitung alles und keinen Knopf; das ist
 * kein Versehen, sondern der Schnitt des Rechtekatalogs, und die Seiten
 * pruefen ihn mit `haeltRechte`, damit kein Knopf auf ein 404 fuehrt (AUT-06).
 *
 * Fuenf Handlungen, ein Recht: eine Fassung anlegen, ihren Status setzen,
 * eine Position anlegen, aendern, ausser Kraft setzen. Sie teilen Sitzung,
 * Ursprungspruefung und Mandantenbindung — fuenf Adressen waeren fuenf
 * Stellen, an denen eines davon fehlen kann.
 */
export const dynamic = 'force-dynamic';

const DATUM = /^\d{4}-\d{2}-\d{2}$/u;

function pflichtDatum(wert: string | undefined, feld: string): string {
  const text = (wert ?? '').trim();
  if (!DATUM.test(text)) {
    throw new KatalogFehler(`${feld} fehlt oder ist kein Datum`, 'unvollstaendig');
  }
  return text;
}

/** Ein optionales Feld: leer heisst „nicht angegeben", nicht „leerer Text". */
function feld(rumpf: Rumpf, name: string): string | null {
  const wert = (rumpf.felder[name] ?? '').trim();
  return wert === '' ? null : wert;
}

function positionAus(rumpf: Rumpf): PositionEingabe {
  const parent = feld(rumpf, 'parentId');
  if (parent !== null && !UUID.test(parent)) {
    throw new KatalogFehler('Unbekannte Elternposition', 'fremder_elternteil');
  }
  const sortierung = Number.parseInt(rumpf.felder['sortierung'] ?? '0', 10);
  return {
    oz: rumpf.felder['oz'] ?? '',
    kurztext: rumpf.felder['kurztext'] ?? '',
    langtext: feld(rumpf, 'langtext'),
    einheit: rumpf.felder['einheit'] ?? '',
    parentId: parent,
    zeitwertMinuten: feld(rumpf, 'zeitwertMinuten'),
    leistungswert: feld(rumpf, 'leistungswert'),
    standardEinzelpreis: feld(rumpf, 'standardEinzelpreis'),
    kostenart: feld(rumpf, 'kostenart'),
    steuerKennzeichen: feld(rumpf, 'steuerKennzeichen'),
    steuerbefreiungGrund: feld(rumpf, 'steuerbefreiungGrund'),
    gueltigAb: pflichtDatum(rumpf.felder['gueltigAb'], 'Gültig ab'),
    /** Ein unlesbares `sortierung` ist 0, nicht `NaN` — `NaN` waere ein 22P02. */
    sortierung: Number.isFinite(sortierung) ? sortierung : 0,
    bestaetigt: (rumpf.felder['bestaetigt'] ?? '') === 'ja',
  };
}

interface Ergebnis {
  readonly katalogId: string;
}

export async function POST(anfrage: NextRequest): Promise<NextResponse> {
  return fuehreUebergangAus<Ergebnis>(anfrage, {
    recht: 'katalog.schreiben',
    grundVon: (f) => grundAus(f, KatalogFehler),
    handle: async (kontext, rumpf): Promise<Ergebnis> => {
      const db = { abfrage: kontext.abfrage.bind(kontext) };
      const aktion = rumpf.felder['aktion'] ?? '';

      if (aktion === 'katalog_anlegen') {
        const angelegt = await legeKatalogAn(db, {
          schluessel: rumpf.felder['schluessel'] ?? '',
          bezeichnung: rumpf.felder['bezeichnung'] ?? '',
          beschreibung: feld(rumpf, 'beschreibung'),
          gueltigAb: pflichtDatum(rumpf.felder['gueltigAb'], 'Gültig ab'),
        });
        return { katalogId: angelegt.id };
      }

      const katalogId = rumpf.felder['katalogId'] ?? '';
      if (!UUID.test(katalogId)) {
        throw new KatalogFehler('Keine Katalogfassung benannt', 'nicht_gefunden');
      }

      if (aktion === 'status') {
        const status = rumpf.felder['status'] ?? '';
        if (status !== 'entwurf' && status !== 'aktiv' && status !== 'archiviert') {
          throw new KatalogFehler(`Unbekannter Status: ${status}`, 'unvollstaendig');
        }
        await setzeKatalogStatus(db, katalogId, status);
        return { katalogId };
      }

      if (aktion === 'position_anlegen') {
        await legePositionAn(db, katalogId, positionAus(rumpf));
        return { katalogId };
      }

      const positionId = rumpf.felder['positionId'] ?? '';
      if (!UUID.test(positionId)) {
        throw new KatalogFehler('Keine Position benannt', 'nicht_gefunden');
      }

      /**
       * BEIDE Kennungen gehen weiter — die Position allein reichte nicht.
       *
       * Die Dienste vergleichen `id = $1 and katalog_id = $2`, wie es
       * `api/raum` mit `objekt_id` macht. Vorher traf das `where id = $1` auch
       * eine Position einer anderen Fassung desselben Mandanten, waehrend die
       * Umleitung auf die Fassung aus dem Formular zeigte.
       */
      if (aktion === 'position_aendern') {
        await aenderePosition(db, katalogId, positionId, positionAus(rumpf));
        return { katalogId };
      }
      if (aktion === 'position_ausser_kraft') {
        await setzePositionAusserKraft(
          db, katalogId, positionId,
          pflichtDatum(rumpf.felder['gueltigBis'], 'Gültig bis'));
        return { katalogId };
      }
      throw new KatalogFehler(`Unbekannte Handlung: ${aktion}`, 'unvollstaendig');
    },
    ziel: (slug, ergebnis) => `/portal/${slug}/leistungskatalog/${ergebnis.katalogId}`,
  });
}
