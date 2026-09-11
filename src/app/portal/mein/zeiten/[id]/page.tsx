import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import { stundenMinutenText } from '@/lib/datum/stunden';
import {
  findeEigenenZeiteintrag, type EigenerZeiteintrag,
} from '@/server/services/mitarbeiter/zeiten';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft } from '../../bausteine';

/**
 * `/portal/mein/zeiten/[id]` — ein Eintrag, mit Serverzeit UND Geraetezeit
 * (TIM-08, TIM-11, EMP-07).
 *
 * **Beide Uhren stehen nebeneinander, und die Serveruhr gilt** (Invariante 5).
 * `zeitabweichung_*_sek` ist keine Fehlermeldung, sondern eine Tatsache: ein
 * Telefon in einem Keller geht vor oder nach, und die Plattform dokumentiert
 * das, statt es wegzurechnen. Wer nur eine der beiden Zahlen zeigt, macht aus
 * einer dokumentierten Abweichung eine unsichtbare — und aus einer
 * manipulierten Geraeteuhr einen unbemerkten Zeitgewinn.
 *
 * **Und hier ist ebenfalls kein Bearbeitungsfeld.** Der einzige Knopf fuehrt
 * auf den Einwand.
 */
export const dynamic = 'force-dynamic';

export default async function MeinZeiteintrag(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ergebnis = await meinPortal<EigenerZeiteintrag | null>(
    `/portal/mein/zeiten/${id}`,
    async (kontext) => findeEigenenZeiteintrag(kontext, id),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis, daten: z } = ergebnis;
  const t = basis.texte;

  return (
    <MeinRahmen basis={basis} titel={t.zeiten} aktiverTab="stunden">
      <Link
        href="/portal/mein/zeiten"
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.zeiten}
      </Link>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">
          <span className="cse-zahl">{z.tag}</span>
        </h1>
        <StatusPill
          zustand={
            z.storniert ? 'Archiviert'
              : z.gesperrt ? 'Abgeschlossen'
                : z.freigegeben ? 'Bereit' : 'Offen'
          }
        />
      </div>

      <section className="mb-s5 rounded-lg border border-line bg-surface p-s4">
        <Felder>
          <Feld label={t.gesellschaft}>
            <Gesellschaft slug={z.mandantSlug} name={z.mandantName} />
          </Feld>
          <Feld label={t.objekt}>{z.objekt ?? '—'}</Feld>
          <Feld label={t.beginn}>
            <span className="cse-zahl">{z.beginnLokal}</span>
          </Feld>
          <Feld label={t.ende}>
            <span className="cse-zahl">{z.endeLokal ?? '—'}</span>
            {z.endetAmFolgetag && <span className="ms-s2 text-text-muted">+1</span>}
          </Feld>
          <Feld label={t.pause}>
            <span className="cse-zahl">{z.pauseMinuten}</span> min
          </Feld>
          <Feld label={t.dauer}>
            <span className="cse-zahl">
              {z.nettoMinuten === null ? '—' : stundenMinutenText(z.nettoMinuten)}
            </span>
          </Feld>
        </Felder>
      </section>

      {/* TIM-08: die beiden Uhren, getrennt und beschriftet. */}
      <section
        data-cse="uhren"
        className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4"
      >
        <h2 className="mb-s3 text-h3 text-text">{t.serverZeit}</h2>
        <Felder>
          <Feld label={`${t.serverZeit} · ${t.beginn}`}>
            <span className="cse-zahl">{z.beginnLokal}</span>
          </Feld>
          <Feld label={`${t.geraeteZeit} · ${t.beginn}`}>
            <span data-cse="geraet-beginn" className="cse-zahl">
              {z.geraeteZeitBeginnLokal ?? '—'}
            </span>
          </Feld>
          <Feld label={`${t.abweichung} · ${t.beginn}`}>
            <span data-cse="abweichung-beginn" className="cse-zahl">
              {z.zeitabweichungBeginnSek === null
                ? '—' : `${String(z.zeitabweichungBeginnSek)} s`}
            </span>
          </Feld>
          <Feld label={`${t.geraeteZeit} · ${t.ende}`}>
            <span className="cse-zahl">{z.geraeteZeitEndeLokal ?? '—'}</span>
          </Feld>
          <Feld label={`${t.abweichung} · ${t.ende}`}>
            <span className="cse-zahl">
              {z.zeitabweichungEndeSek === null
                ? '—' : `${String(z.zeitabweichungEndeSek)} s`}
            </span>
          </Feld>
        </Felder>
      </section>

      <p className="mb-s4 max-w-prose text-base text-text-muted">{t.keinBearbeiten}</p>

      {/*
        Der EINZIGE Handlungsweg dieser Seite. Er aendert den Eintrag nicht —
        er legt einen Vorgang an, ueber den die Planung entscheidet (EMP-07).
      */}
      <Link
        href={`/portal/mein/zeiten/${z.id}/einwand`}
        data-cse="einwand-link"
        className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 py-s3
                   text-base font-semibold text-white no-underline hover:bg-brand-hover"
      >
        {t.einwandMelden}
      </Link>
    </MeinRahmen>
  );
}
