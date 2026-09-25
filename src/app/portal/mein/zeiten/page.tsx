import Link from 'next/link';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { berlinHeute } from '@/server/db/heute';
import { monatsgrenzen, tagInSprache } from '@/lib/datum/kalendertag';
import { stundenMinutenText } from '@/lib/datum/stunden';
import {
  listeEigeneZeiten, type EigenerZeiteintrag,
} from '@/server/services/mitarbeiter/zeiten';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Gesellschaft, Leer, Monatswechsler } from '../bausteine';

/**
 * `/portal/mein/zeiten` — die eigene Aufzeichnung, LESEND (EMP-03, EMP-07,
 * TIM-13, LEG-02).
 *
 * **Auf dieser Seite gibt es kein Bearbeitungsfeld — nirgends.** Kein Stift,
 * kein Formular, kein „speichern". Das ist EMP-07 und der Grund, aus dem die
 * Aufzeichnung im Lohnstreit ueberhaupt etwas wert ist: was die betroffene
 * Person selbst geschrieben hat, ist ihre Behauptung und keine Aufzeichnung
 * mehr. Was sie hat, ist der Einwand — ein Vorgang, ueber den die Planung
 * entscheidet. Der Satz steht deshalb auch sichtbar auf der Seite und nicht
 * nur in diesem Kommentar: eine Kraft, die den Stift sucht, soll lesen, warum
 * es keinen gibt.
 *
 * Die Gegenprobe liegt zwei Ebenen tiefer: `p_ma_kein_update` auf
 * `zeiteintrag` ist `restrictive` und laesst im Mitarbeiterportal kein UPDATE
 * zu — auch nicht mit `zeit.schreiben`, auch nicht an dieser Seite vorbei. Und
 * es gibt keine Route, die einen Zeiteintrag aendert.
 */
export const dynamic = 'force-dynamic';

const TAG = /^\d{4}-\d{2}-\d{2}$/u;

function einzeln(wert: string | string[] | undefined): string | null {
  return typeof wert === 'string' && wert !== '' ? wert : null;
}

export default async function MeineZeiten({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const frage = await searchParams;
  const heute = await berlinHeute();
  const roh = einzeln(frage['monat']);
  const grenzen = monatsgrenzen(roh !== null && TAG.test(roh) ? roh : heute);

  const ergebnis = await meinPortal<readonly EigenerZeiteintrag[]>(
    '/portal/mein/zeiten',
    async (kontext) => listeEigeneZeiten(kontext, { von: grenzen.von, bis: grenzen.bis }),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const summe = daten
    .filter((z) => !z.storniert)
    .reduce((s, z) => s + (z.nettoMinuten ?? 0), 0);

  const spalten: readonly Spalte<EigenerZeiteintrag>[] = [
    {
      schluessel: 'tag',
      kopf: t.datum,
      zelle: (z) => (
        <Link
          href={`/portal/mein/zeiten/${z.id}`}
          data-cse="zeit-zeile"
          className={`inline-flex min-h-11 items-center gap-s2 text-text underline ${
            z.storniert ? 'line-through' : ''}`}
        >
          <span className="cse-zahl">{z.beginnLokal}</span>
        </Link>
      ),
    },
    {
      schluessel: 'gesellschaft',
      kopf: t.gesellschaft,
      zelle: (z) => <Gesellschaft slug={z.mandantSlug} name={z.mandantName} />,
    },
    { schluessel: 'objekt', kopf: t.objekt, zelle: (z) => z.objekt ?? '—' },
    {
      schluessel: 'ende',
      kopf: t.ende,
      numerisch: true,
      zelle: (z) => (
        <>
          {z.endeLokal?.slice(-5) ?? '—'}
          {z.endetAmFolgetag && <span className="ms-s1 text-text-muted">+1</span>}
        </>
      ),
    },
    {
      schluessel: 'pause', kopf: t.pause, numerisch: true,
      zelle: (z) => String(z.pauseMinuten),
    },
    {
      schluessel: 'netto', kopf: t.dauer, numerisch: true,
      zelle: (z) => (z.nettoMinuten === null ? '—' : stundenMinutenText(z.nettoMinuten)),
    },
    {
      schluessel: 'status',
      kopf: t.status,
      zelle: (z) => (
        <StatusPill sprache={basis.sprache}
          zustand={
            z.storniert ? 'Archiviert'
              : z.gesperrt ? 'Abgeschlossen'
                : z.freigegeben ? 'Bereit' : 'Offen'
          }
        />
      ),
    },
  ];

  return (
    <MeinRahmen basis={basis} titel={t.zeiten} aktiverTab="stunden">
      <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.zeiten}</h1>
        <p className="m-0 text-base text-text-muted">
          <span className="cse-zahl">{tagInSprache(grenzen.von, basis.sprache)}</span> –{' '}
          <span className="cse-zahl">{tagInSprache(grenzen.bis, basis.sprache)}</span>
          {' · '}
          <span data-cse="monatssumme" className="cse-zahl">
            {stundenMinutenText(summe)}
          </span>
        </p>
      </div>

      <Monatswechsler pfad="/portal/mein/zeiten" monat={grenzen.von}
                      heute={heute} texte={t} />

      {/* EMP-07 als Satz auf dem Bildschirm, nicht nur als fehlender Knopf. */}
      <p data-cse="kein-bearbeiten" className="mb-s5 max-w-prose text-base text-text-muted">
        {t.keinBearbeiten}
      </p>

      {daten.length === 0 ? <Leer text={t.keineEintraege} /> : (
        <DataTable
          spalten={spalten}
          zeilen={daten}
          schluessel={(z) => z.id}
          beschriftung={t.zeiten}
        />
      )}
    </MeinRahmen>
  );
}
