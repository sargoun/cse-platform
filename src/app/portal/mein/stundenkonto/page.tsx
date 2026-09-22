import Link from 'next/link';
import { KpiStat } from '@/components/ui/KpiStat';
import { StatusPill } from '@/components/ui/StatusPill';
import { berlinHeute } from '@/server/db/heute';
import { stundenMinutenText } from '@/lib/datum/stunden';
import {
  leseStundenkonten, type StundenkontoUebersicht,
} from '@/server/services/mitarbeiter/stunden';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Feld, Felder, Gesellschaft, Leer, Monatswechsler } from '../bausteine';

/**
 * `/portal/mein/stundenkonto` — ein Konto je Beschaeftigung (EMP-04, EMP-15).
 *
 * **Die Summe oben ist gerechnet, die Konten darunter sind getrennt.** EMP-15
 * verlangt beides in einem Satz, und der Grund ist kein Darstellungsgeschmack:
 * ein Stundenkonto ist die Grundlage einer Lohnzeile GEGEN EINE GmbH. Eine
 * gespeicherte Gesamtzahl waere eine dritte Wahrheit neben zwei Lohnkonten und
 * die erste, die bei einer Korrektur veraltet. `kombiniereKonten` rechnet sie
 * bei jedem Aufruf neu und laesst die Einzelkonten im Ergebnis stehen.
 *
 * **Ein abgeschlossener Monat aendert sich nicht mehr** (EMP-04). Eine
 * Korrektur erscheint als Ausgleichsbuchung im ersten OFFENEN Monat, mit
 * Verweis zurueck — nie rueckwirkend. Der Zustand steht deshalb an jedem
 * Konto: „abgeschlossen" heisst, dass die Zahl daneben die endgueltige ist.
 *
 * **Ohne hinterlegte Sollzeit steht hier KEINE Zahl** (O-18). `soll_minuten =
 * 0` heisst „nicht hinterlegt" und nicht „nichts geschuldet"; eine 0 an dieser
 * Stelle machte aus jeder geleisteten Minute eine Ueberstunde, und das saehe
 * jahrelang plausibel aus. Der Saldo wird dann ebenfalls nicht gezeigt — er
 * ist `vortrag + ist − soll`, und eine Rechnung mit einer unbekannten Zahl
 * ergibt keine bekannte.
 */
export const dynamic = 'force-dynamic';

const MONAT = /^(\d{4})-(\d{2})/u;

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

/** Ein Monat als `JJJJ-MM` — fuer die Vor- und Zurueckverweise. */
function verschiebe(jahr: number, monat: number, um: number): string {
  const gesamt = jahr * 12 + (monat - 1) + um;
  const j = Math.floor(gesamt / 12);
  const m = (gesamt % 12) + 1;
  return `${String(j).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export default async function MeinStundenkonto({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const frage = await searchParams;
  const heute = await berlinHeute();
  const roh = einzeln(frage['monat']) ?? heute;
  const treffer = MONAT.exec(roh) ?? MONAT.exec(heute);
  const jahr = Number(treffer?.[1] ?? heute.slice(0, 4));
  const monat = Number(treffer?.[2] ?? heute.slice(5, 7));

  const ergebnis = await meinPortal<StundenkontoUebersicht>(
    '/portal/mein/stundenkonto',
    async (kontext) => leseStundenkonten(kontext, jahr, monat),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const k = daten.kombiniert;

  return (
    <MeinRahmen basis={basis} titel={t.stundenkonto} aktiverTab="stunden">
      <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.stundenkonto}</h1>
        <p className="m-0 text-base text-text-muted">
          {t.monat}{' '}
          <span data-cse="konto-monat" className="cse-zahl">
            {String(monat).padStart(2, '0')}/{String(jahr)}
          </span>
        </p>
      </div>

      <Monatswechsler
        pfad="/portal/mein/stundenkonto"
        monat={`${verschiebe(jahr, monat, 0)}-01`}
        heute={heute}
        texte={t}
      />

      {/* EMP-15, erste Haelfte: die zusammengezaehlte Zahl. */}
      <section data-cse="kombiniert" className="mb-s6 grid gap-s4 sm:grid-cols-3">
        <KpiStat
          label={`${t.kombiniert} · ${t.ist}`}
          wert={stundenMinutenText(k?.istMinuten ?? 0)}
          icon="zeit"
          ton="info"
        />
        <KpiStat
          label={`${t.kombiniert} · ${t.soll}`}
          wert={daten.sollOffen ? t.nichtHinterlegt : stundenMinutenText(k?.sollMinuten ?? 0)}
          icon="kalender"
          ton={daten.sollOffen ? 'muted' : 'info'}
        />
        <KpiStat
          label={`${t.kombiniert} · ${t.saldo}`}
          wert={daten.sollOffen ? t.nichtHinterlegt : stundenMinutenText(k?.saldoMinuten ?? 0)}
          icon="uebersicht"
          ton={daten.sollOffen ? 'muted' : 'info'}
        />
      </section>

      {daten.sollOffen && (
        <p data-cse="soll-offen" className="mb-s5 max-w-prose text-base text-text-muted">
          {t.nichtHinterlegtErklaerung}
        </p>
      )}

      {/* EMP-15, zweite Haelfte: die Konten bleiben getrennt. */}
      <h2 className="mb-s3 text-h3 text-text">{t.jeBeschaeftigung}</h2>
      {daten.konten.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <ul data-cse="konten" className="m-0 flex list-none flex-col gap-s4 p-0">
          {daten.konten.map((a) => (
            <li
              key={a.konto.id}
              data-cse="konto"
              data-mandant={a.mandantSlug}
              className="rounded-lg border border-line bg-surface p-s4"
            >
              <div className="mb-s3 flex flex-wrap items-center gap-s3">
                <Gesellschaft slug={a.mandantSlug} name={a.mandantName} />
                <StatusPill sprache={basis.sprache}
                  zustand={
                    a.konto.status === 'gesperrt' ? 'Abgeschlossen'
                      : a.konto.status === 'vorlaeufig' ? 'In Prüfung' : 'Offen'
                  }
                />
              </div>
              <Felder>
                <Feld label={t.ist}>
                  <span data-cse="konto-ist" className="cse-zahl">
                    {stundenMinutenText(a.konto.istMinuten)}
                  </span>
                </Feld>
                <Feld label={t.soll}>
                  <span data-cse="konto-soll" className="cse-zahl">
                    {a.sollOffen ? t.nichtHinterlegt : stundenMinutenText(a.konto.sollMinuten)}
                  </span>
                </Feld>
                <Feld label={t.vortrag}>
                  <span className="cse-zahl">
                    {stundenMinutenText(a.konto.saldoVortragMinuten)}
                  </span>
                </Feld>
                <Feld label={t.saldo}>
                  <span data-cse="konto-saldo" className="cse-zahl">
                    {a.sollOffen ? t.nichtHinterlegt : stundenMinutenText(a.konto.saldoMinuten)}
                  </span>
                </Feld>
              </Felder>
              <Link
                href={{
                  pathname: '/portal/mein/monatsnachweis',
                  query: {
                    anstellung: a.konto.anstellungId,
                    monat: `${String(jahr)}-${String(monat).padStart(2, '0')}-01`,
                  },
                }}
                data-cse="zum-monatsnachweis"
                className="mt-s3 inline-block min-h-11 text-base text-text underline"
              >
                {t.monatsnachweis}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MeinRahmen>
  );
}
