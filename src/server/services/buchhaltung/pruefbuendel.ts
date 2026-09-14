import 'server-only';
import { createHash } from 'node:crypto';
import type { Bucket, Speicher } from '../../storage/adapter.js';
import { kanonisiere } from '../finanz/kanonisch.js';
import { alsKanonischerWert } from '../freigabe/diff-json.js';
import { stimmeAb, type Abstimmung } from '../finanz/ausgangsbuch.js';
import { exportPaket, type Abfrage, type Exportpaket } from './exportpaket.js';
import {
  liesWirtschaftsjahr, wirtschaftsjahrZeitraum, type Wirtschaftsjahr,
} from './wirtschaftsjahr.js';
import { schreibeZip } from '../archiv/zip.js';

/**
 * Das Pruefbuendel eines Jahrgangs — jede Rechnung, ihr PDF, ihre
 * Buchungszeilen, gegen das Ausgangsbuch gehalten (DOC-08, ACC-06, PR 64).
 *
 * **Zwei Schritte, mit Absicht getrennt.** `erstellePruefbuendel` liest und
 * rechnet — es entsteht das MANIFEST: welche Rechnungen der Jahrgang hat, ob
 * jede ihren Beleg und ihre Buchung traegt, was das Ausgangsbuch dazu sagt,
 * welche Dateien mit welchem SHA-256 dazugehoeren. Das geht ohne
 * Objektspeicher und ist deshalb immer moeglich; der Bildschirm zeigt es.
 * `packePruefbuendel` holt dann die Bytes, prueft jede Datei gegen ihren
 * SHA-256 und legt alles in ein ZIP — das gibt es nur mit verbundenem
 * Speicher, und es sagt es, statt ein Archiv ohne Dateien zu liefern.
 *
 * **Reproduzierbar.** Das Manifest ist kanonisches JSON ohne Uhr; das ZIP
 * ist STORE mit Nullzeitstempel (`archiv/zip.ts`). Derselbe Jahrgang,
 * zweimal gepackt, ergibt dieselben Bytes — und derselbe Hash im Manifest
 * ist der Beweis, dass ein Buendel von damals dasselbe ist wie eines von
 * heute.
 *
 * **Die Sperre wird gefragt, nicht ausgeloest.** `app.export_sperre_pruefen`
 * wirft; in einer Transaktion waere danach nichts mehr lesbar. Deshalb
 * zaehlt dieser Dienst `app.export_unvollstaendig` und traegt die Zahl als
 * `sperre` ins Manifest: ein Buendel mit offenen Zeilen ist kein Buendel,
 * aber ein Bildschirm, der sagt, welche fehlen.
 *
 * Nichts hier rechnet Steuern oder Loehne (D-06); das steht auch im
 * Manifest.
 */
export interface BuendelKontext extends Abfrage {
  readonly aktiverMandantId: string;
}

export interface BuendelRechnung {
  readonly rechnungId: string;
  readonly nummer: string | null;
  readonly rechnungsdatum: string;
  readonly bruttoCent: bigint;
  readonly storniert: boolean;
  readonly belegId: string | null;
  readonly belegnummer: string | null;
  readonly sha256: string | null;
  readonly buchungszeilen: number;
}

export interface Sperre {
  readonly offen: number;
  readonly satz: string;
}

export interface Pruefbuendel {
  readonly mandantId: string;
  readonly jahr: number;
  readonly von: string;
  readonly bis: string;
  readonly bezeichnung: string;
  readonly wirtschaftsjahr: Wirtschaftsjahr;
  readonly rechnungen: readonly BuendelRechnung[];
  readonly ohneBeleg: number;
  readonly ohneBuchung: number;
  readonly ausgangsbuch: Abstimmung;
  /** `null`: alle Zeilen des Zeitraums tragen Beleg und Konto. */
  readonly sperre: Sperre | null;
  /** Nur ohne Sperre. */
  readonly paket: Exportpaket | null;
  readonly manifest: Uint8Array;
  readonly manifestSha256: string;
}

export class PruefbuendelFehler extends Error {
  constructor(nachricht: string, readonly grund: 'nicht_verbunden' | 'gesperrt' | 'integritaet') {
    super(nachricht);
    this.name = 'PruefbuendelFehler';
  }
}

export const MANIFEST_NAME = 'manifest.json';
export const HINWEIS_D06 =
  'Dieses Bündel sammelt Belege, Buchungszeilen und Prüfsummen. Es enthält keine Berechnung '
  + 'von Steuern oder Löhnen (D-06).';

interface RechnungRoh {
  readonly id: string;
  readonly nummer: string | null;
  readonly rechnungsdatum: string;
  readonly brutto_cent: string;
  readonly storniert: boolean;
  readonly beleg_id: string | null;
  readonly belegnummer: string | null;
  readonly datei_sha256: string | null;
  readonly buchungszeilen: number;
}

export async function erstellePruefbuendel(
  db: BuendelKontext, jahr: number,
): Promise<Pruefbuendel> {
  const wj = await liesWirtschaftsjahr(db);
  const { von, bis, bezeichnung } = wirtschaftsjahrZeitraum(jahr, wj);

  const roh = await db.abfrage<RechnungRoh>(
    `select r.id, r.nummer, r.rechnungsdatum::text as rechnungsdatum,
            r.brutto_cent::text as brutto_cent,
            (r.rechnungsart = 'storno') as storniert,
            r.beleg_id, b.belegnummer, b.datei_sha256,
            (select count(*) from buchungssatz bs
              where bs.rechnung_id = r.id and bs.mandant_id = r.mandant_id)::int as buchungszeilen
       from rechnung r
       left join beleg b on b.id = r.beleg_id and b.mandant_id = r.mandant_id
      where r.mandant_id = $1::uuid
        and r.status = 'festgeschrieben'
        and r.rechnungsdatum between $2::date and $3::date
      order by r.rechnungsdatum, r.nummer_laufend, r.id`,
    [db.aktiverMandantId, von, bis]);
  const rechnungen: BuendelRechnung[] = roh.map((r) => ({
    rechnungId: r.id, nummer: r.nummer, rechnungsdatum: r.rechnungsdatum,
    bruttoCent: BigInt(r.brutto_cent), storniert: r.storniert,
    belegId: r.beleg_id, belegnummer: r.belegnummer, sha256: r.datei_sha256,
    buchungszeilen: r.buchungszeilen,
  }));
  const ohneBeleg = rechnungen.filter((r) => r.belegId === null).length;
  const ohneBuchung = rechnungen.filter((r) => r.buchungszeilen === 0).length;

  /* Das Ausgangsbuch je Kalenderjahr; ein abweichendes Wirtschaftsjahr liest beide. */
  const kalender = wj.beginnMonat === 1 && wj.beginnTag === 1;
  const ausgangsbuch = await stimmeAb(db, { jahr: kalender ? jahr : null });

  const [offen] = await db.abfrage<{ n: number }>(
    `select count(*)::int as n from app.export_unvollstaendig($1::uuid, $2::date, $3::date)`,
    [db.aktiverMandantId, von, bis]);
  const sperre: Sperre | null = offen !== undefined && offen.n > 0
    ? { offen: offen.n,
        satz: `${String(offen.n)} Buchungszeile(n) im Zeitraum ${von} bis ${bis} tragen keinen Beleg `
          + 'oder kein Konto — das Bündel entsteht erst, wenn jede sie hat (ACC-03).' }
    : null;
  const paket = sperre === null ? await exportPaket(db, db.aktiverMandantId, von, bis) : null;

  const manifestWert = {
    art: 'cse-pruefbuendel',
    version: 1,
    mandantId: db.aktiverMandantId,
    jahr, von, bis, bezeichnung,
    wirtschaftsjahr: { beginnMonat: wj.beginnMonat, beginnTag: wj.beginnTag, istPlatzhalter: wj.istPlatzhalter },
    rechnungen: rechnungen.map((r) => ({
      rechnungId: r.rechnungId, nummer: r.nummer, rechnungsdatum: r.rechnungsdatum,
      bruttoCent: r.bruttoCent, storniert: r.storniert, belegId: r.belegId,
      belegnummer: r.belegnummer, sha256: r.sha256, buchungszeilen: r.buchungszeilen,
    })),
    ohneBeleg, ohneBuchung,
    ausgangsbuch: {
      ok: ausgangsbuch.ok,
      kalenderjahr: kalender ? jahr : null,
      kreise: ausgangsbuch.kreise.map((k) => ({
        nummernkreis: k.nummernkreis, anzahl: k.anzahl, ersteNummer: k.ersteNummer,
        letzteNummer: k.letzteNummer, summeBuchCent: k.summeBuchCent,
        summeBelegeCent: k.summeBelegeCent, luecken: [...k.luecken],
        ohneKettenglied: k.ohneKettenglied,
      })),
    },
    sperre,
    buchungszeilen: paket === null ? null : paket.zeilen.length,
    dateien: paket === null ? [] : paket.dateien.map((d) => ({
      pfad: d.pfad, sha256: d.sha256, groesseBytes: d.groesseBytes, mimeTyp: d.mimeTyp,
      belegId: d.belegId, dokumentId: d.dokumentId, zeilen: d.zeilen,
    })),
    buchungen: paket === null ? [] : paket.zeilen.map((z) => ({
      buchungssatzId: z.buchungssatzId, buchungId: z.buchungId, belegdatum: z.belegdatum,
      konto: z.konto, gegenkonto: z.gegenkonto, sollHaben: z.sollHaben, umsatzCent: z.umsatzCent,
      buchungstext: z.buchungstext, belegfeld1: z.belegfeld1, festgeschrieben: z.festgeschrieben,
      dateiPfad: z.dateiPfad, sha256: z.sha256,
    })),
    hinweis: HINWEIS_D06,
  };
  const manifest = kanonisiere(alsKanonischerWert(manifestWert));
  return {
    mandantId: db.aktiverMandantId, jahr, von, bis, bezeichnung, wirtschaftsjahr: wj,
    rechnungen, ohneBeleg, ohneBuchung, ausgangsbuch, sperre, paket, manifest,
    manifestSha256: createHash('sha256').update(manifest).digest('hex'),
  };
}

/** Manifest plus jede Datei, jede gegen ihren SHA-256 geprueft — als ZIP. */
export async function packePruefbuendel(b: Pruefbuendel, speicher: Speicher): Promise<Uint8Array> {
  if (!speicher.verbunden) {
    throw new PruefbuendelFehler(
      'Der Belegspeicher ist nicht verbunden — das Manifest gibt es, die Dateien nicht.', 'nicht_verbunden');
  }
  if (b.sperre !== null || b.paket === null) {
    throw new PruefbuendelFehler(b.sperre?.satz ?? 'Der Zeitraum ist gesperrt.', 'gesperrt');
  }
  const eintraege = [{ pfad: MANIFEST_NAME, bytes: b.manifest }];
  for (const d of b.paket.dateien) {
    const bytes = await speicher.hole(d.bucket as Bucket, d.objektSchluessel);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== d.sha256) {
      throw new PruefbuendelFehler(
        `Die Datei ${d.pfad} hat nicht mehr den SHA-256 ihres Belegs — das Bündel wird nicht gepackt.`,
        'integritaet');
    }
    eintraege.push({ pfad: d.pfad, bytes });
  }
  return schreibeZip(eintraege);
}
