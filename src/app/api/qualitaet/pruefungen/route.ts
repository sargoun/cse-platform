import type postgres from 'postgres';
import { NextResponse, type NextRequest } from 'next/server';
import { istGleicherUrsprung, internesZiel } from '@/server/auth/ursprung';
import { db } from '@/server/db/pool';
import { aktuelleSitzung } from '@/server/auth/anfrage-sitzung';
import { authorize } from '@/server/auth/authorize';
import { rechtepruefer } from '@/server/auth/zugang';
import { withTenant } from '@/server/kontext/index';
import {
  erfassePruefung, PRUEFERGEBNISSE, type PruefungEingabe,
} from '@/server/services/reinigung/qualitaet';
import { alsAntwort } from '../../sicherheit/antwort';

/**
 * `POST /api/qualitaet/pruefungen` — eine Qualitätsprüfung samt Befunden
 * erfassen (OPS-11, SPEC §22).
 *
 * **`qualitaet.schreiben`, nicht `reinigung.schreiben`.** Qualität ist ein
 * Querschnittsmodul: eine Prüfung an einem Wachobjekt ist dieselbe Zeile wie
 * eine an einem Reinigungsrevier (04-SEITENKARTE.md §5.6). Dasselbe Recht wie
 * bei den Reklamationen daneben.
 *
 * **Nummer und Zeit kommen vom Dienst, nicht aus dem Formular.** Die Nummer
 * vergibt `erfassePruefung` (QP-JJJJ-NNNN), den Prüfzeitpunkt setzt der
 * Auslöser `kern.qualitaetspruefung_feldzeit` auf `now()`. Eine Zeit aus der
 * Anfrage wäre eine rückdatierbare Prüfung (Invariante 5).
 *
 * **Der KUNDE kommt vom Objekt.** Ein Kunde aus dem Formular wäre ein
 * Prüfprotokoll, das jemand einem anderen Kunden zuordnet — und `mit_kunde`
 * entscheidet über die Sichtbarkeit im Kundenportal (`t_kunde` auf
 * `qualitaetspruefung`).
 *
 * **Der PRÜFER kommt aus der Sitzung.** Eine `anstellung_id` aus dem Formular
 * wäre ein Protokoll, das jemand einem Kollegen unterschiebt — dieselbe Regel,
 * die das Wachbuch trägt (§10.5). Ein EXTERNER Prüfer ist ein Name, keine
 * Anstellung.
 *
 * **Die Gerätezeit wird getrennt gespeichert und nie bevorzugt.** Kommt sie
 * leer, bleibt `geraete_zeit` NULL und `zeitabweichung_sek` ebenfalls; die
 * Serverzeit gilt in jedem Fall.
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

const DEZIMAL = /^\d{1,6}(?:[.,]\d{1,2})?$/u;

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
  const liste = `/portal/${mandant}/qualitaet/pruefungen`;

  let nummer: string;
  let neueId: string;
  try {
    const aus = await (db().begin(async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        await authorize(
          sitzung, { recht: 'qualitaet.schreiben', schreibend: true },
          rechtepruefer(kontext.abfrage.bind(kontext)),
        );

        const objektId = text(daten, 'objekt');
        const verfahrenId = text(daten, 'verfahren');
        if (objektId === null || verfahrenId === null) {
          throw new Unvollstaendig('Objekt und Prüfverfahren sind Pflicht.');
        }

        /*
         * Der Kunde kommt vom OBJEKT. `mit_kunde` entscheidet zusammen mit
         * `kunde_id` ueber die Sichtbarkeit im Kundenportal — ein Kunde aus
         * dem Formular waere ein Protokoll im falschen Kundenkonto.
         */
        const [objekt] = await kontext.abfrage<{ kunde_id: string | null }>(
          `select kunde_id from objekt where id = $1::uuid`, [objektId],
        );
        if (objekt === undefined) {
          throw new Unvollstaendig(
            'Das Objekt gehört nicht zu dieser Gesellschaft, oder es fehlt das Recht '
            + 'objekt.lesen.');
        }

        /*
         * Der Pruefer: die EIGENE Anstellung, aufgeloest in der Datenbank, oder
         * ein externer Name. Nie eine Kennung aus der Anfrage.
         */
        const prueferArt = text(daten, 'pruefer_art');
        const externName = text(daten, 'pruefer_extern');
        let prueferAnstellungId: string | null = null;
        if (prueferArt !== 'extern') {
          const [eigene] = await kontext.abfrage<{ id: string }>(
            `select a.id from anstellung a
              where a.mandant_id = app.aktiver_mandant()
                and a.person_id = app.aktuelle_person()
                and a.geloescht_am is null and a.status <> 'beendet'
              limit 1`,
          );
          prueferAnstellungId = eigene?.id ?? null;
          if (prueferAnstellungId === null && externName === null) {
            throw new Unvollstaendig(
              'Dieses Konto hat in dieser Gesellschaft keine Anstellung — dann braucht '
              + 'die Prüfung den Namen eines externen Prüfers.');
          }
        } else if (externName === null) {
          throw new Unvollstaendig('Ein externer Prüfer braucht einen Namen.');
        }

        /*
         * Die Befunde: indizierte Felder, leere Zeilen werden verworfen. Die
         * Reihenfolge ist die des Formulars — `erfassePruefung` setzt
         * `reihenfolge` daraus, und der eindeutige Index auf (Pruefung,
         * Reihenfolge) haelt sie fest.
         */
        const positionen: PruefungEingabe['positionen'][number][] = [];
        for (let i = 0; i < 60; i += 1) {
          const kriterium = text(daten, `kriterium_${String(i)}`);
          if (kriterium === null) continue;
          const rohesErgebnis = text(daten, `ergebnis_${String(i)}`);
          const ergebnis = PRUEFERGEBNISSE.find((e) => e === rohesErgebnis);
          if (ergebnis === undefined) {
            throw new Unvollstaendig(
              `Befund ${String(i + 1)}: das Ergebnis ist io, nio oder nicht_pruefbar.`);
          }
          const mangel = text(daten, `mangel_${String(i)}`);
          if (ergebnis === 'nio' && mangel === null) {
            throw new Unvollstaendig(
              `Befund ${String(i + 1)} („${kriterium}") ist „nicht in Ordnung" und braucht `
              + 'eine Mangelbeschreibung — die Datenbank lässt es nicht anders zu, und ein '
              + 'Mangel ohne Beschreibung belegt nichts.');
          }
          const rohePunkte = text(daten, `punkte_${String(i)}`);
          if (rohePunkte !== null && !DEZIMAL.test(rohePunkte)) {
            throw new Unvollstaendig(
              `Befund ${String(i + 1)}: Punkte sind eine Zahl mit höchstens zwei `
              + 'Dezimalstellen.');
          }
          positionen.push({
            kriterium,
            ergebnis,
            /* Als TEXT weitergegeben, nie als `number`: eine Punktzahl geht in
               den Erfuellungsgrad und damit in eine Vertragsstrafe (K-16). */
            punkte: rohePunkte === null ? null : rohePunkte.replace(',', '.'),
            revierRaumId: text(daten, `revierraum_${String(i)}`),
            mangelBeschreibung: mangel,
            fristAm: text(daten, `frist_${String(i)}`),
          });
        }
        if (positionen.length === 0) {
          throw new Unvollstaendig(
            'Eine Prüfung ohne Befund belegt nichts — mindestens ein Kriterium ist Pflicht.');
        }

        const geraet = text(daten, 'geraete_zeit');
        const geraeteZeit = geraet === null ? null : new Date(geraet);
        if (geraeteZeit !== null && Number.isNaN(geraeteZeit.getTime())) {
          throw new Unvollstaendig('Die mitgeschickte Gerätezeit ist kein Zeitpunkt.');
        }

        return erfassePruefung(kontext, {
          objektId,
          revierId: text(daten, 'revier'),
          kundeId: objekt.kunde_id,
          pruefverfahrenId: verfahrenId,
          prueferAnstellungId,
          /*
           * Der externe Name zaehlt auch dann, wenn `pruefer_art` nicht
           * `extern` sagt — naemlich genau dann, wenn dieses Konto keine
           * eigene Anstellung hat. Die Bedingung oben laesst den Vorgang in
           * dem Fall durch, weil ein Name da ist; ihn danach an
           * `pruefer_art` zu binden hiesse, ihn zu verwerfen und eine Pruefung
           * OHNE jeden Pruefer zu speichern. Die Tabelle faengt das nicht ab
           * (`qp_akteur_stimmig` prueft den Erfasser, nicht den Pruefer),
           * ueber die Oberflaeche ist der Fall nicht erreichbar, ueber einen
           * gleich-Ursprung-POST schon.
           */
          prueferExternName: prueferAnstellungId === null ? externName : null,
          mitKunde: daten.get('mit_kunde') === 'ja',
          geraeteZeit,
          bemerkung: text(daten, 'bemerkung'),
          positionen,
        });
      })) as Promise<{ id: string; nummer: string }>);
    nummer = aus.nummer;
    neueId = aus.id;
  } catch (fehler) {
    const antwort = alsAntwort(fehler);
    if (antwort !== null) {
      const nachricht = (fehler as { message?: string }).message;
      if (typeof nachricht === 'string' && nachricht !== '') {
        const zurueck = `${liste}/neu?fehler=${encodeURIComponent(nachricht)}`;
        return NextResponse.redirect(internesZiel(zurueck, liste, anfrage), 303);
      }
      return antwort;
    }
    throw fehler;
  }

  const ziel = `${liste}/${neueId}?angelegt=${encodeURIComponent(nummer)}`;
  return NextResponse.redirect(internesZiel(ziel, liste, anfrage), 303);
}
