import Link from 'next/link';
import { KpiStat } from '@/components/ui/KpiStat';
import { Icon } from '@/components/ui/Icon';
import { berlinHeute } from '@/server/db/heute';
import { monatsgrenzen, montag, tagInSprache } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import {
  laufendeOderNaechsteSchicht, type EigeneSchicht,
} from '@/server/services/mitarbeiter/schichten';
import { leseStundenFenster, type StundenFenster }
  from '@/server/services/mitarbeiter/stunden';
import { leseEigeneNachweise, type EigeneNachweislage }
  from '@/server/services/mitarbeiter/nachweise';
import { findeOffenenEintrag, type OffenerEintrag }
  from '@/server/services/mitarbeiter/stempeluhr';
import { AnmeldungNoetig } from '../Anmeldung';
import { meinPortal, MeinRahmen } from './rahmen';
import { Gesellschaft, Leer, SchichtKarte, StempelUhr } from './bausteine';

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
  /** Der laufende Eintrag — `null`, wenn gerade nicht gestempelt ist. */
  readonly offen: OffenerEintrag | null;
  readonly stunden: StundenFenster;
  readonly nachweise: EigeneNachweislage;
}

export default async function MeinPortal(
  { searchParams }: { readonly searchParams?: Promise<Record<string, string | string[] | undefined>> },
) {
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
    offen: await findeOffenenEintrag(kontext),
    stunden: await leseStundenFenster(kontext, { heute, wochenBeginn, monatsBeginn }),
    nachweise: await leseEigeneNachweise(kontext, heute, basis.sprache),
  }));
  /*
   * `angemeldet=1` setzt die Codeseite nach einer erfolgreichen Anmeldung.
   * Steht es hier UND es gibt keine Sitzung, hat der Browser den Keks
   * abgelehnt — ein anderer Fall als „nicht angemeldet" (D-488).
   */
  const kam = searchParams === undefined ? {} : await searchParams;
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig keksAbgelehnt={kam['angemeldet'] === '1'} />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const gesperrt = daten.nachweise.nachweise.filter(
    (n) => n.blockiertEinsatz && !n.gueltigAmStichtag,
  );
  const ablaufend = daten.nachweise.nachweise.filter((n) => n.warnlage === 'laeuft_ab');

  return (
    <MeinRahmen basis={basis} titel={t.heute} aktiverTab="heute">
      <h1 className="mb-s5 text-h1 text-text">{t.heute}</h1>

      {/*
        * **Die Stempeluhr steht GANZ OBEN** (D-618, O-93).
        *
        * Sie ist der haeufigste Handgriff des Tages und war bis hierher gar
        * nicht erreichbar: die Uhr selbst (`src/app/check-in/[token]/`) war
        * fertig, aber nur ueber einen Token-Link, den die Planung ausgibt.
        * Eine Suche nach `check-in` unter `src/app/portal/mein/` lieferte NULL
        * Treffer — wer sich anmeldete, sah `0:00 h` und keinen Weg, daran
        * etwas zu aendern.
        *
        * Oben, nicht unter der Schicht: wer im Treppenhaus das Telefon
        * herausholt, soll nicht scrollen muessen.
        */}
      <StempelUhr
        offen={daten.offen}
        schicht={daten.schicht}
        texte={t}
        meldung={typeof kam['stempel'] === 'string' ? kam['stempel'] : null}
      />

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
                {n.gueltigBis === null ? '' : ` (${tagInSprache(n.gueltigBis, basis.sprache)})`}. {t.sperrtEinteilung}
              </li>
            ))}
            {ablaufend.map((n) => (
              <li key={n.nachweisId} data-cse="nachweis-laeuft-ab" className="text-base text-text">
                <strong>{n.bezeichnung}</strong> — {t.laeuftAb}
                {n.gueltigBis === null ? ''
                  : ` (${t.gueltigBis} ${tagInSprache(n.gueltigBis, basis.sprache)})`}.
              </li>
            ))}
          </ul>
          {/*
            * `inline-flex min-h-11 items-center` und nicht `inline-block`:
            * DESIGN §8 verlangt 44×44 px, und ein `inline-block` mit
            * 16px/26px Zeilenhöhe ist 26 px hoch. Auf einem 390-px-Telefon
            * ist das der Unterschied zwischen „getroffen" und „daneben" —
            * und getroffen wird hier die einzige Stelle, an der jemand
            * nachsieht, warum er nicht mehr eingeteilt wird.
            */}
          <Link
            href="/portal/mein/nachweise"
            className="mt-s3 inline-flex min-h-11 items-center text-base text-text underline"
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
          : <SchichtKarte schicht={daten.schicht} texte={t} sprache={basis.sprache} />}
        <Link
          href="/portal/mein/schichten"
          className="inline-flex min-h-11 items-center text-base text-text underline"
        >
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

      {/*
        * **Sechs gebaute Seiten, zu denen kein Weg führte.**
        *
        * Die Arbeiterleiste trägt fünf Ziele (SEITENKARTE §11.2), und mehr
        * gehört dort auch nicht hin: sie ist für den Einsatz gemacht, nicht
        * für die Verwaltung. Nur waren `mein/zeiten`, `urlaub`, `antraege`,
        * `nachweise`, `dienstanweisungen` und `monatsnachweis` damit von
        * NIRGENDS erreichbar — gebaut, übersetzt, geprüft und für den
        * Menschen davor dasselbe wie nicht vorhanden. `mein/zeiten` trägt
        * dabei den Einwandsweg aus EMP-07: die einzige Stelle, an der eine
        * Kraft einer Aufzeichnung widersprechen kann.
        *
        * `min-h-11` je Zeile: DESIGN §8 verlangt 44×44 px, und diese Liste
        * wird auf einem Telefon mit Handschuhen bedient.
        */}
      <section className="mt-s6 flex flex-col gap-s3">
        <h2 className="m-0 text-h3 text-text">{t.weiteres}</h2>
        <ul data-cse="mein-weiteres" className="m-0 flex list-none flex-col p-0">
          {([
            ['/portal/mein/zeiten', t.zeiten],
            ['/portal/mein/urlaub', t.urlaub],
            ['/portal/mein/antraege', t.antraege],
            ['/portal/mein/nachweise', t.nachweise],
            ['/portal/mein/dienstanweisungen', t.dienstanweisungen],
            ['/portal/mein/monatsnachweis', t.monatsnachweis],
            /*
             * Die zwei Seiten aus §7, die bis zuletzt auf die Auffangseite
             * fuehrten: die eigenen Dokumente (EMP-11, DOC-03) und die eigenen
             * Objekte samt Zutritt (EMP-02, OPS-01). Auch sie waeren ohne
             * diese Zeile von NIRGENDS erreichbar — die Arbeiterleiste traegt
             * fuenf Ziele und nicht mehr (SEITENKARTE §11.2).
             */
            ['/portal/mein/dokumente', t.dokumente],
            ['/portal/mein/objekte', t.objekte],
          ] as const).map(([ziel, text]) => (
            <li key={ziel} className="border-b border-line last:border-b-0">
              <Link
                href={ziel}
                data-cse="mein-weiteres-ziel"
                className="flex min-h-11 items-center py-s2 text-base text-text"
              >
                {text}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </MeinRahmen>
  );
}
