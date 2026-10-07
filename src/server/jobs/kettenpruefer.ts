/**
 * Der naechtliche Hashketten-Pruefer als Job (FIN-06, LEG-01, SPEC §14:
 * „Invoice hash chain broken | nightly | alert immediately").
 *
 * **Warum er so lange nicht registriert war.** Der Dienst
 * (`services/finanz/kettenlauf.ts`) ist seit PR 46 fertig und geprueft —
 * aber nur unter `cse_app`, aus einem Isolationstest heraus. `pruefeKette`
 * filtert ueber `app.aktiver_mandant()`, und ein Job hatte keine Sitzung, in
 * der diese Frage eine Antwort hat. Ihn trotzdem einzutragen haette jede
 * Nacht null Rechnungen geprueft und „keine Abweichung" gemeldet.
 *
 * Beides steht jetzt: `alsJobSitzung` bindet den Mandanten und faehrt unter
 * `cse_job`, und `0108` gibt `cse_job` die beiden fehlenden Leserechte samt
 * Policies — mandantengebunden, nicht `using (true)`, damit der Binder
 * TRAEGT und nicht bloss danebensteht.
 *
 * **`versuche: 0`, und das ist eine Aussage.** Ein gebrochener Hash wird beim
 * zweiten Hinsehen nicht heil. Was ein Wiederholungsversuch hier kaufen
 * wuerde, ist Verzoegerung zwischen Fund und Meldung — bei „alert
 * immediately" genau das Falsche.
 *
 * Nebenbei: bei `bereich: 'je_mandant'` wiederholt der Runner die
 * Mandantenschleife ohnehin nicht (`runner.ts`: der Fehler je Mandant wird
 * gefangen und vermerkt, der Lauf kehrt danach zurueck). `versuche` ist dort
 * heute wirkungslos — die drei bestehenden `je_mandant`-Jobs versprechen
 * also eine Wiederholung, die niemand ausfuehrt. Siehe D-379.
 *
 * **Wie der Alarm aussieht.** Ein Bruch laesst `ausfuehren` werfen. Der
 * Runner traegt den Mandanten mit `ergebnis = 'fehler'` und der VOLLEN
 * Meldung (`meldung(befund)` — Rechnungsnummer, Kreis, Position, Grund) in
 * `job_lauf_mandant` ein und ruft danach `alarm.melde(...)`. Die
 * Alarmzeile selbst nennt nur die Zahl der fehlerhaften Mandanten; die
 * Rechnungsnummer steht eine Ebene tiefer im Protokoll. Vor dem Wurf geht
 * die Meldung an die Menschen (`meldeKettenbruch`, V-286), und der Wurf sagt,
 * wie viele sie erreicht hat.
 *
 * // TODO(client, O-357): Voreinstellung — die Kettenmeldung geht an
 * Buchhaltung (buchhaltung.lesen) und Geschäftsführung (Rolle leitung) der
 * Gesellschaft, in den Posteingang, einmal je Bruch (0507, D-811). Die Art
 * schlägt dazu E-Mail vor; zugestellt wird die erst mit dem Versanddienst
 * (V-367, O-202).
 */
import { registriere, type JobDefinition } from './registry.js';
import { alsJobSitzung, type JobTransaktion, type JobVerbindung } from './sitzung.js';
import { erzeuge } from '../benachrichtigung/registry.js';
import { stelleZuAnKonto } from '../benachrichtigung/ablage.js';
import { meldung, pruefeKette, type KettenBefund } from '../services/finanz/kettenlauf.js';
import {
  ART_KETTE_GEBROCHEN, registriereWaechterArten,
} from '../services/waechter/benachrichtigung.js';
import { gibQuittungZurueck, quittiere } from '../services/waechter/dienstplan.js';

export class KetteGebrochen extends Error {
  constructor(text: string) {
    super(text);
    this.name = 'KetteGebrochen';
  }
}

/** Was die Zustellung eines Bruchs ergab — die Zahlen stehen im Lauf. */
export interface Kettenzustellung {
  readonly empfaenger: number;
  readonly zugestellt: number;
  readonly schonGemeldet: number;
}

/**
 * Den ersten Bruch an Buchhaltung und Geschäftsführung der Gesellschaft
 * melden (V-286, O-357).
 *
 * **Einmal je Bruch, nicht jede Nacht.** Ein gebrochener Hash bleibt
 * gebrochen; derselbe Befund jede Nacht im Posteingang ist Lärm, und Lärm
 * wird überlesen. Das Gedächtnis ist `waechter_meldung` (0149) mit der
 * Rechnung als Gegenstand und dem Grund als Lage — ein neuer Bruch an
 * anderer Stelle meldet sich wieder. Fehlt dem Bruch die Rechnung, ist der
 * Nummernkreis der Gegenstand. Dieselbe Reihenfolge wie bei den
 * Dienstplanwachen: erst die Quittung, dann die Zustellung, und die Quittung
 * zurück, wenn nichts ankam.
 *
 * Läuft in der Transaktion des Aufrufers und ohne Jobsitzung: dieselbe
 * Verbindung, mit der die übrigen Wachen zustellen.
 */
export async function meldeKettenbruch(
  db: JobTransaktion, mandantId: string, befund: KettenBefund,
): Promise<Kettenzustellung> {
  const bruch = befund.ersterBruch;
  const leer = { empfaenger: 0, zugestellt: 0, schonGemeldet: 0 };
  if (befund.ok || bruch === null) return leer;

  const kreis = befund.kreise.find((k) => k.bruch === bruch);
  const objekt = bruch.rechnungId !== ''
    ? { typ: 'rechnung', id: bruch.rechnungId }
    : kreis === undefined ? null : { typ: 'nummernkreis', id: kreis.nummernkreisId };
  if (objekt === null) return leer;

  const [m] = (await db.unsafe(
    `select slug from mandant where id = $1::uuid`, [mandantId],
  )) as readonly { slug: string }[];
  const empfaenger = (await db.unsafe(
    `select benutzer_id from kern.kette_meldung_empfaenger($1::uuid)`, [mandantId],
  )) as readonly { benutzer_id: string }[];

  let benachrichtigung;
  try {
    benachrichtigung = erzeuge(ART_KETTE_GEBROCHEN, {
      mandantId, mandantSlug: m?.slug ?? '',
      objektTyp: objekt.typ, objektId: objekt.id,
      daten: {
        nummer: bruch.nummer, kreis: bruch.nummernkreis,
        position: bruch.position, grund: bruch.grund,
      },
    });
  } catch {
    return { ...leer, empfaenger: empfaenger.length };   // Ohne Ziel keine Meldung (NOT-03).
  }

  let zugestellt = 0;
  let schonGemeldet = 0;
  for (const { benutzer_id: benutzerId } of empfaenger) {
    const quittung = await quittiere(db, {
      mandantId, waechter: 'kette_pruefen', objektTyp: objekt.typ,
      objektId: objekt.id, empfaengerId: benutzerId, kennung: bruch.grund,
    });
    if (quittung === null) { schonGemeldet += 1; continue; }
    const e = await stelleZuAnKonto(db, [{
      benachrichtigung, benutzerId, objektTyp: objekt.typ, objektId: objekt.id,
    }]);
    if (e.zugestellt === 0) { await gibQuittungZurueck(db, quittung); continue; }
    zugestellt += e.zugestellt;
  }
  return { empfaenger: empfaenger.length, zugestellt, schonGemeldet };
}

/** Der Satz, den der Lauf an den Befund hängt. */
function zustellsatz(z: Kettenzustellung): string {
  if (z.empfaenger === 0) {
    return ' Niemand in der Gesellschaft liest die Buchhaltung oder hat die Rolle Leitung — '
      + 'der Befund steht nur im Lauf.';
  }
  return ` Gemeldet an Buchhaltung und Geschäftsführung: ${String(z.zugestellt)} neu, `
    + `${String(z.schonGemeldet)} schon früher gemeldet.`;
}

export function registriereKettenpruefer(sql: JobVerbindung): JobDefinition {
  registriereWaechterArten();
  return registriere({
    schluessel: 'kette_pruefen',
    bezeichnung: 'Nächtliche Prüfung der Rechnungs-Hashkette (FIN-06)',
    /*
     * Nach den schreibenden Nachtlaeufen (Generator 02:15, Konflikte danach)
     * und lange vor dem Arbeitstag: geprueft wird der Stand, mit dem die
     * Buchhaltung morgens anfaengt, nicht einer von mittendrin.
     */
    zeitplan: '20 3 * * *',
    bereich: 'je_mandant',
    versuche: 0,
    ausfuehren: async (kontext): Promise<Record<string, unknown>> => {
      if (kontext.mandantId === null) {
        throw new Error('kette_pruefen ist je_mandant und braucht einen Mandanten.');
      }
      const befund = await alsJobSitzung(
        sql, kontext.mandantId, async (db) => pruefeKette(db),
      );
      if (!befund.ok) {
        /*
         * Erst zustellen, dann werfen: der Wurf trägt den Befund in
         * `job_lauf_mandant` und weckt den Alarm, die Meldung erreicht die
         * Menschen. Scheitert die Zustellung, bleibt der Wurf — mit dem Grund.
         */
        const mandantId = kontext.mandantId;
        let satz: string;
        try {
          satz = zustellsatz(await sql.begin((tx) => meldeKettenbruch(tx, mandantId, befund)));
        } catch (fehler) {
          satz = ` Zustellung gescheitert: ${fehler instanceof Error ? fehler.message : String(fehler)}`;
        }
        throw new KetteGebrochen(meldung(befund) + satz);
      }
      return {
        geprueft: befund.geprueft,
        kreise: befund.kreise.length,
        meldung: meldung(befund),
      };
    },
  });
}
