import Link from 'next/link';
import { KpiStat } from '@/components/ui/KpiStat';
import { Icon } from '@/components/ui/Icon';
import { berlinHeute } from '@/server/db/heute';
import { monatsgrenzen, montag } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import {
  laufendeOderNaechsteSchicht, type EigeneSchicht,
} from '@/server/services/mitarbeiter/schichten';
import { leseStundenFenster, type StundenFenster }
  from '@/server/services/mitarbeiter/stunden';
import { leseEigeneNachweise, type EigeneNachweislage }
  from '@/server/services/mitarbeiter/nachweise';
import { AnmeldungNoetig } from '../Anmeldung';
import { meinPortal, MeinRahmen } from './rahmen';
import { Gesellschaft, Leer, SchichtKarte } from './bausteine';

/**
 * `/portal/mein` — „Heute" (EMP-02, EMP-03, EMP-08, EMP-12, EMP-14, EMP-15).
 *
 * **Eine Frage, eine Antwort.** Wer um 05:55 im Treppenhaus auf das Telefon
 * sieht, will wissen: laufe ich gerade, und wenn nicht, wann und wo als
 * naechstes. Deshalb steht genau EINE Schicht oben und nicht eine Liste — und
 * sie traegt ihre Gesellschaft, weil diese Kraft morgen frueh bei der einen
 * und abends bei der anderen GmbH steht (EMP-14, D-09).
 *
 * **Die drei Stundenzahlen sind zusammengezaehlt, die Konten nicht.** EMP-15
 * verlangt genau das: eine Person sieht ihre Gesamtstunden, jeder Arbeitgeber
 * sein Konto. Die Kopfzahl entsteht nach derselben Regel wie die Buchung ins
 * Stundenkonto (Monatsgrenze, verteilte Pause, Tag des Anteilsbeginns) — sonst
 * zeigten Kopfzeile und Stundenkonto fuer dieselbe Nachtschicht zwei
 * plausible, verschiedene Zahlen.
 *
 * **Der abgelaufene Nachweis steht hier und nicht nur unter „Nachweise".** Er
 * ist der Grund, aus dem die Planung diese Kraft ab morgen nicht mehr
 * einteilen darf (SEC-04) — eine Warnung, die man suchen muss, ist keine.
 */
export const dynamic = 'force-dynamic';

interface Daten {
  readonly schicht: EigeneSchicht | null;
  readonly stunden: StundenFenster;
  readonly nachweise: EigeneNachweislage;
}

export default async function MeinPortal() {
  /**
   * „Heute" kommt aus der DATENBANK und nicht aus `new Date()`: zwischen
   * Mitternacht und 02:00 Berliner Zeit ist der UTC-Tag noch der gestrige,
   * und die Kraft saehe die Stunden von vorgestern (Invariante 5, K-11).
   */
  const heute = await berlinHeute();
  const wochenBeginn = montag(heute);
  const monatsBeginn = monatsgrenzen(heute).von;

  const ergebnis = await meinPortal<Daten>('/portal/mein', async (kontext, basis) => ({
    schicht: await laufendeOderNaechsteSchicht(kontext),
    stunden: await leseStundenFenster(kontext, { heute, wochenBeginn, monatsBeginn }),
    nachweise: await leseEigeneNachweise(kontext, heute, basis.sprache),
  }));
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const gesperrt = daten.nachweise.nachweise.filter(
    (n) => n.blockiertEinsatz && !n.gueltigAmStichtag,
  );
  const ablaufend = daten.nachweise.nachweise.filter((n) => n.warnlage === 'laeuft_ab');

  return (
    <MeinRahmen basis={basis} titel={t.heute} aktiverTab="heute">
      <h1 className="mb-s5 text-h1 text-text">{t.heute}</h1>

      {/* EMP-08: die Warnung steht oben, nicht in einem Reiter. */}
      {(gesperrt.length > 0 || ablaufend.length > 0) && (
        <section
          data-cse="nachweis-warnung"
          className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4"
        >
          <h2 className="mb-s2 text-h3 text-text">
            <Icon name="warnung" groesse="sm" className="inline-block align-[-3px]" />{' '}
            {t.nachweise}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-s2 p-0">
            {gesperrt.map((n) => (
              <li key={n.nachweisId} data-cse="nachweis-abgelaufen" className="text-base text-text">
                <strong>{n.bezeichnung}</strong> — {t.abgelaufen}
                {n.gueltigBis === null ? '' : ` (${n.gueltigBis})`}. {t.sperrtEinteilung}
              </li>
            ))}
            {ablaufend.map((n) => (
              <li key={n.nachweisId} data-cse="nachweis-laeuft-ab" className="text-base text-text">
                <strong>{n.bezeichnung}</strong> — {t.laeuftAb}
                {n.gueltigBis === null ? '' : ` (${t.gueltigBis} ${n.gueltigBis})`}.
              </li>
            ))}
          </ul>
          <Link
            href="/portal/mein/nachweise"
            className="mt-s3 inline-block text-base text-text underline"
          >
            {t.nachweise}
          </Link>
        </section>
      )}

      {/* EMP-03: heute · Woche · Monat, zusammengezaehlt ueber beide Konten. */}
      <section data-cse="stunden-kopf" className="mb-s5 grid gap-s4 sm:grid-cols-3">
        <KpiStat
          label={t.stundenHeute}
          wert={stundenMinutenText(daten.stunden.heuteMinuten)}
          icon="heute"
          ton="info"
        />
        <KpiStat
          label={t.stundenWoche}
          wert={stundenMinutenText(daten.stunden.wocheMinuten)}
          icon="kalender"
          ton="info"
        />
        <KpiStat
          label={t.stundenMonat}
          wert={stundenMinutenText(daten.stunden.monatMinuten)}
          icon="zeit"
          ton="info"
        />
      </section>

      <section className="mb-s5 flex flex-col gap-s3">
        <h2 className="m-0 text-h3 text-text">
          {daten.schicht?.laeuftJetzt === true ? t.laufendeSchicht : t.naechsteSchicht}
        </h2>
        {daten.schicht === null
          ? <Leer text={t.keineSchicht} />
          : <SchichtKarte schicht={daten.schicht} texte={t} />}
        <Link href="/portal/mein/schichten" className="text-base text-text underline">
          {t.schichten}
        </Link>
      </section>

      {/* EMP-14: welche Arbeitsverhaeltnisse diese eine Anmeldung umfasst. */}
      <section className="flex flex-col gap-s3">
        <h2 className="m-0 text-h3 text-text">{t.jeBeschaeftigung}</h2>
        <ul data-cse="meine-anstellungen" className="m-0 flex list-none flex-col gap-s3 p-0">
          {basis.anstellungen.map((a) => {
            const monat = daten.stunden.jeAnstellung.find(
              (w) => w.anstellungId === a.anstellungId,
            );
            return (
              <li
                key={a.anstellungId}
                data-cse="anstellung"
                data-mandant={a.mandantSlug}
                className="flex flex-wrap items-center justify-between gap-s3
                           rounded-lg border border-line bg-surface p-s4"
              >
                <Gesellschaft slug={a.mandantSlug} name={a.mandantName} />
                <span className="text-base text-text-muted">{a.personalnummer ?? '—'}</span>
                <span data-cse="anstellung-monat" className="cse-zahl text-base text-text">
                  {stundenMinutenText(monat?.monatMinuten ?? 0)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </MeinRahmen>
  );
}
