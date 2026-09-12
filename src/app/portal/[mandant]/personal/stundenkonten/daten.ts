/**
 * Die Abfragen der Stundenkonten-Seiten — an EINER Stelle (EMP-04, EMP-15).
 *
 * **Warum eine eigene Datei.** Die Liste, das Einzelblatt und der Abschluss
 * fragen dasselbe: welche Beschaeftigung hat in diesem Monat welches Konto,
 * und was steht noch offen. Dreimal geschrieben liefe es dreimal auseinander —
 * und zwar leise: die Liste zeigte dann 14 Konten, der Abschluss 13, und beide
 * saehen richtig aus.
 *
 * **Gerechnet wird hier nichts.** Die Zahlen stehen in `stundenkonto`, gefuehrt
 * von genau einem Ausloeser (`bewegung_summe`, 0060). Diese Datei liest sie und
 * zaehlt daneben, was den Abschluss BLOCKIERT — nicht freigegebene Zeiten. Wer
 * diese Zahl in der Seite ausrechnete, ersetzte den Grund der Sperre durch eine
 * Vermutung darueber.
 */
import type { LeseKontext } from '@/server/kontext/index';

export interface KontoZeile {
  readonly anstellungId: string;
  readonly name: string;
  readonly personalnummer: string | null;
  readonly anstellungStatus: string;
  /** `null`: fuer diesen Monat gibt es noch kein Konto. */
  readonly kontoId: string | null;
  readonly sollMinuten: number;
  readonly istMinuten: number;
  readonly korrekturMinuten: number;
  readonly saldoVortragMinuten: number;
  readonly saldoMinuten: number;
  readonly status: 'offen' | 'vorlaeufig' | 'gesperrt' | null;
  readonly gesperrtAm: Date | null;
  /** Zeiteintraege des Monats, die noch niemand freigegeben hat. */
  readonly offeneZeiten: number;
  /** Erfasste Eintraege des Monats insgesamt — auch die freigegebenen. */
  readonly zeiten: number;
}

interface ZeileRoh {
  anstellung_id: string;
  name: string;
  personalnummer: string | null;
  anstellung_status: string;
  konto_id: string | null;
  soll_minuten: number | null;
  ist_minuten: number | null;
  korrektur_minuten: number | null;
  saldo_vortrag_minuten: number | null;
  saldo_minuten: number | null;
  status: 'offen' | 'vorlaeufig' | 'gesperrt' | null;
  gesperrt_am: Date | null;
  offene_zeiten: number;
  zeiten: number;
}

function alsZeile(z: ZeileRoh): KontoZeile {
  return {
    anstellungId: z.anstellung_id,
    name: z.name,
    personalnummer: z.personalnummer,
    anstellungStatus: z.anstellung_status,
    kontoId: z.konto_id,
    sollMinuten: Number(z.soll_minuten ?? 0),
    istMinuten: Number(z.ist_minuten ?? 0),
    korrekturMinuten: Number(z.korrektur_minuten ?? 0),
    saldoVortragMinuten: Number(z.saldo_vortrag_minuten ?? 0),
    saldoMinuten: Number(z.saldo_minuten ?? 0),
    status: z.status,
    gesperrtAm: z.gesperrt_am,
    offeneZeiten: Number(z.offene_zeiten),
    zeiten: Number(z.zeiten),
  };
}

/**
 * `left join` von der Beschaeftigung auf das Konto — und nicht umgekehrt.
 *
 * Wer ueber `stundenkonto` liefe, saehe nur, wo schon eines existiert. Genau
 * die fehlenden Konten sind aber der Befund: eine Beschaeftigung mit erfassten
 * Zeiten und ohne Konto ist ein Monat, der nie in den Lohn laeuft.
 */
const LISTE = `
  select a.id                                   as anstellung_id,
         (p.vorname || ' ' || p.nachname)        as name,
         a.personalnummer,
         a.status::text                          as anstellung_status,
         k.id                                    as konto_id,
         k.soll_minuten, k.ist_minuten, k.korrektur_minuten,
         k.saldo_vortrag_minuten, k.saldo_minuten,
         k.status::text                          as status,
         k.gesperrt_am,
         (select count(distinct m.zeiteintrag_id) from zeiteintrag_monatsanteil m
           where m.anstellung_id = a.id and m.monat = $1::date
             and m.freigegeben_am is null)::int  as offene_zeiten,
         (select count(distinct m.zeiteintrag_id) from zeiteintrag_monatsanteil m
           where m.anstellung_id = a.id and m.monat = $1::date)::int as zeiten
    from anstellung a
    join person p on p.id = a.person_id
    left join stundenkonto k
           on k.anstellung_id = a.id and k.jahr = $2::int and k.monat = $3::int
   where a.geloescht_am is null`;

/** Alle Beschaeftigungen mit ihrem Konto fuer EINEN Monat. */
export async function leseMonatsliste(
  kontext: LeseKontext, monatsErsterTag: string,
): Promise<readonly KontoZeile[]> {
  const jahr = Number(monatsErsterTag.slice(0, 4));
  const monat = Number(monatsErsterTag.slice(5, 7));
  const zeilen = await kontext.abfrage<ZeileRoh>(
    `${LISTE} order by a.status, p.nachname, p.vorname`,
    [monatsErsterTag, jahr, monat],
  );
  return zeilen.map(alsZeile);
}

/** Dieselbe Zeile fuer EINE Beschaeftigung — derselbe Ausdruck, ein Filter mehr. */
export async function leseKontoZeile(
  kontext: LeseKontext, anstellungId: string, monatsErsterTag: string,
): Promise<KontoZeile | null> {
  const jahr = Number(monatsErsterTag.slice(0, 4));
  const monat = Number(monatsErsterTag.slice(5, 7));
  const [z] = await kontext.abfrage<ZeileRoh>(
    `${LISTE} and a.id = $4`,
    [monatsErsterTag, jahr, monat, anstellungId],
  );
  return z === undefined ? null : alsZeile(z);
}

export interface JahresMonat {
  readonly kontoId: string;
  readonly jahr: number;
  readonly monat: number;
  readonly sollMinuten: number;
  readonly istMinuten: number;
  readonly korrekturMinuten: number;
  readonly saldoVortragMinuten: number;
  readonly saldoMinuten: number;
  readonly status: 'offen' | 'vorlaeufig' | 'gesperrt';
  readonly gesperrtAm: Date | null;
}

/** Die zwoelf Monate eines Jahres, soweit es Konten gibt. */
export async function leseJahr(
  kontext: LeseKontext, anstellungId: string, jahr: number,
): Promise<readonly JahresMonat[]> {
  const zeilen = await kontext.abfrage<{
    id: string; jahr: number; monat: number;
    soll_minuten: number; ist_minuten: number; korrektur_minuten: number;
    saldo_vortrag_minuten: number; saldo_minuten: number;
    status: 'offen' | 'vorlaeufig' | 'gesperrt'; gesperrt_am: Date | null;
  }>(
    `select id, jahr, monat, soll_minuten, ist_minuten, korrektur_minuten,
            saldo_vortrag_minuten, saldo_minuten, status, gesperrt_am
       from stundenkonto
      where anstellung_id = $1 and jahr = $2::int
      order by monat`,
    [anstellungId, jahr],
  );
  return zeilen.map((z) => ({
    kontoId: z.id,
    jahr: Number(z.jahr),
    monat: Number(z.monat),
    sollMinuten: Number(z.soll_minuten),
    istMinuten: Number(z.ist_minuten),
    korrekturMinuten: Number(z.korrektur_minuten),
    saldoVortragMinuten: Number(z.saldo_vortrag_minuten),
    saldoMinuten: Number(z.saldo_minuten),
    status: z.status,
    gesperrtAm: z.gesperrt_am,
  }));
}
