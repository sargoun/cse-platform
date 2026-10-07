/**
 * Der Hinweis vor dem Ablauf der EIGENEN Freistellungsbescheinigung als Job
 * (V-388, O-130, D-846): 60, 30 und 7 Tage vorher, an Buchhaltung und
 * Geschäftsführung der Gesellschaft, solange keine Nachfolgerin erfasst ist.
 *
 * **`uebergreifend`, wie die Ablaufwarnungen der Nachweise** (EMP-08): eine
 * Abfrage über alle Gesellschaften, gruppiert je Gesellschaft. Die Empfänger
 * löst `kern.kette_meldung_empfaenger` auf (0507) — dieselben Menschen, die
 * vom Bruch der Rechnungskette erfahren, und nur solche, die das Ziel
 * (`/finanzen/freistellungen`, `finanzen.lesen`) öffnen können.
 *
 * **Einmal je Stufe.** Das Gedächtnis ist `waechter_meldung` (0149) mit der
 * Bescheinigung als Gegenstand und der Stufe als Lage: erst die Quittung,
 * dann die Zustellung, und die Quittung zurück, wenn nichts ankam — dieselbe
 * Reihenfolge wie beim Kettenbruch.
 *
 * Die Plattform beantragt nichts beim Finanzamt (Invariante 7): sie erinnert.
 */
import { registriere, type JobDefinition } from './registry.js';
import { erzeuge } from '../benachrichtigung/registry.js';
import { stelleZuAnKonto, type Abfrage } from '../benachrichtigung/ablage.js';
import {
  ART_FREISTELLUNG_LAEUFT_AB, registriereWaechterArten,
} from '../services/waechter/benachrichtigung.js';
import { gibQuittungZurueck, quittiere } from '../services/waechter/dienstplan.js';
import {
  eigeneAblaeufe, type EigeneBescheinigung,
} from '../services/finanz/freistellung-ablauf.js';
import { tagDeutsch } from '../../lib/datum/kalendertag.js';

export interface AblaufBericht {
  readonly gesellschaften: number;
  readonly faellig: number;
  readonly zugestellt: number;
  readonly schonGemeldet: number;
  /** Fällige Hinweise in einer Gesellschaft, in der niemand die Buchhaltung liest. */
  readonly ohneEmpfaenger: number;
}

interface Zeile extends EigeneBescheinigung {
  readonly mandantId: string;
  readonly slug: string;
}

/** Meldet die fälligen Hinweise am Berliner Tag `heute` — aus der Datenbank. */
export async function meldeFreistellungsAblaeufe(
  db: Abfrage, heute: string,
): Promise<AblaufBericht> {
  registriereWaechterArten();
  /*
   * Alle eigenen Bescheinigungen, die heute oder später noch gelten — auch
   * künftige: eine erfasste Nachfolgerin beendet den Hinweis. Abgelaufene und
   * fremde (Kunde, Lieferant) gehören nicht hierher.
   */
  const zeilen = (await db.unsafe(
    `select f.id::text as id, f.mandant_id::text as "mandantId", m.slug,
            f.bescheinigung_nummer as nummer,
            to_char(f.gueltig_von, 'YYYY-MM-DD') as "gueltigVon",
            to_char(f.gueltig_bis, 'YYYY-MM-DD') as "gueltigBis",
            to_char(f.widerrufen_am, 'YYYY-MM-DD') as "widerrufenAm",
            f.umfang::text as umfang, f.auftrag_id::text as "auftragId"
       from freistellungsbescheinigung f
       join mandant m on m.id = f.mandant_id
      where f.kunde_id is null and f.lieferant_id is null
        and m.archiviert_am is null
        and f.gueltig_bis >= $1::date
      order by f.mandant_id, f.gueltig_bis`, [heute],
  )) as readonly Zeile[];

  const jeGesellschaft = new Map<string, Zeile[]>();
  for (const z of zeilen) {
    jeGesellschaft.set(z.mandantId, [...(jeGesellschaft.get(z.mandantId) ?? []), z]);
  }

  let faellig = 0;
  let zugestellt = 0;
  let schonGemeldet = 0;
  let ohneEmpfaenger = 0;
  for (const [mandantId, eigene] of jeGesellschaft) {
    const lagen = eigeneAblaeufe(eigene, heute);
    if (lagen.length === 0) continue;
    const empfaenger = (await db.unsafe(
      `select benutzer_id::text as benutzer_id from kern.kette_meldung_empfaenger($1::uuid)`,
      [mandantId],
    )) as readonly { benutzer_id: string }[];
    const slug = eigene[0]?.slug ?? '';
    for (const lage of lagen) {
      faellig += 1;
      if (empfaenger.length === 0) { ohneEmpfaenger += 1; continue; }
      const benachrichtigung = erzeuge(ART_FREISTELLUNG_LAEUFT_AB, {
        mandantId, mandantSlug: slug,
        objektTyp: 'freistellungsbescheinigung', objektId: lage.id,
        daten: { nummer: lage.nummer, bis: tagDeutsch(lage.gueltigBis), tage: lage.tage },
      });
      for (const { benutzer_id: benutzerId } of empfaenger) {
        const quittung = await quittiere(db, {
          mandantId, waechter: 'freistellung_ablauf',
          objektTyp: 'freistellungsbescheinigung', objektId: lage.id,
          empfaengerId: benutzerId, kennung: `stufe_${String(lage.stufe)}`,
        });
        if (quittung === null) { schonGemeldet += 1; continue; }
        const e = await stelleZuAnKonto(db, [{
          benachrichtigung, benutzerId,
          objektTyp: 'freistellungsbescheinigung', objektId: lage.id,
        }]);
        if (e.zugestellt === 0) { await gibQuittungZurueck(db, quittung); continue; }
        zugestellt += e.zugestellt;
      }
    }
  }
  return { gesellschaften: jeGesellschaft.size, faellig, zugestellt, schonGemeldet, ohneEmpfaenger };
}

export function registriereFreistellungAblauf(db: Abfrage): JobDefinition {
  registriereWaechterArten();
  return registriere({
    schluessel: 'freistellung_ablauf',
    bezeichnung: 'Hinweis vor dem Ablauf der eigenen § 48b-Freistellungsbescheinigung (60/30/7 Tage)',
    // Nach den Ablaufwarnungen der Nachweise (02:05) — und vor dem Arbeitstag.
    zeitplan: '35 2 * * *',
    bereich: 'uebergreifend',
    versuche: 2,
    ausfuehren: async () => {
      /* Der Stichtag kommt aus der DATENBANK (Invariante 5). */
      const [zeile] = (await db.unsafe(
        `select to_char(app.berlin_heute(), 'YYYY-MM-DD') as tag`,
      )) as readonly { tag: string }[];
      const heute = zeile?.tag ?? '';
      const bericht = await meldeFreistellungsAblaeufe(db, heute);
      return {
        stichtag: heute,
        gesellschaften: bericht.gesellschaften,
        faellig: bericht.faellig,
        zugestellt: bericht.zugestellt,
        schon_gemeldet: bericht.schonGemeldet,
        ohne_empfaenger: bericht.ohneEmpfaenger,
      };
    },
  });
}
