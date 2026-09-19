import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { formatiereGeld } from '@/server/services/finanz/geld';
import {
  KLASSEN, KLASSE_LABEL, abstimmungOffenePosten, altersstruktur, postenListe,
  type Abstimmung, type Altersstruktur, type PostenArt, type PostenZeile,
} from '@/server/services/buchhaltung/offene-posten';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';

/**
 * `/portal/[mandant]/buchhaltung/offene-posten` — Debitoren und Kreditoren
 * mit Altersstruktur zum Stichtag (ACC-07, FIN-15, PR 65, D-484).
 *
 * Der Stichtag ist ein Berliner Kalendertag aus der Adresse oder das Heute
 * der Datenbank; das Alter ist eine Differenz von Kalendertagen. Die
 * Abstimmung unten rechnet die Summe ein zweites Mal aus den Belegen —
 * und sagt, wenn beide Wege nicht dasselbe ergeben.
 */
export const dynamic = 'force-dynamic';

function deutschesDatum(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

export default async function OffenePosten(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/buchhaltung/offene-posten`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const suche = await searchParams;
  const art: PostenArt = suche['art'] === 'kreditor' ? 'kreditor' : 'debitor';
  const stichtagRoh = typeof suche['stichtag'] === 'string' ? suche['stichtag'] : null;
  const stichtagGewaehlt = stichtagRoh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(stichtagRoh) ? stichtagRoh : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [heute] = await kontext.abfrage<{ tag: string }>(`select app.berlin_heute()::text as tag`);
      const stichtag = stichtagGewaehlt ?? heute?.tag ?? '2026-01-01';
      return {
        alter: await altersstruktur(kontext, stichtag),
        posten: await postenListe(kontext, art, stichtag),
        abstimmung: await abstimmungOffenePosten(kontext),
      };
    })) as Promise<{ alter: Altersstruktur; posten: readonly PostenZeile[]; abstimmung: readonly Abstimmung[] }>);

  const basis = `/portal/${mandant}/buchhaltung/offene-posten`;
  const klassen = daten.alter[art];
  const feld = 'min-h-11 rounded-md border border-line bg-surface-3 px-s3 text-sm text-text';
  const pille = (aktiv: boolean): string => [
    'inline-flex min-h-11 items-center rounded-full px-s4 text-sm transition-colors duration-fast ease-brand',
    aktiv ? 'bg-white text-ink' : 'bg-surface-3 text-text-muted hover:text-text',
  ].join(' ');
  const abst = daten.abstimmung.find((a) => a.art === art);

  return (
    <PortalRahmen
      titel="Offene Posten"
      wurzelTitel="Buchhaltung"
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 text-h1 text-text">Offene Posten</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Stichtag {deutschesDatum(daten.alter.stichtag)}. Das Alter eines Postens ist die Zahl der
        Kalendertage seit Fälligkeit — Kalendertage, keine Stunden: eine Zeitumstellung ändert es nicht.
      </p>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <nav aria-label="Art" data-cse="posten-art" className="flex gap-s2">
          <a href={`${basis}?art=debitor${stichtagGewaehlt === null ? '' : `&stichtag=${stichtagGewaehlt}`}`}
             aria-current={art === 'debitor' ? 'page' : undefined} className={pille(art === 'debitor')}>Debitoren</a>
          <a href={`${basis}?art=kreditor${stichtagGewaehlt === null ? '' : `&stichtag=${stichtagGewaehlt}`}`}
             aria-current={art === 'kreditor' ? 'page' : undefined} className={pille(art === 'kreditor')}>Kreditoren</a>
        </nav>
        <form method="get" action={basis} data-cse="posten-stichtag" className="flex flex-wrap items-center gap-s3">
          <input type="hidden" name="art" value={art} />
          <label htmlFor="stichtag" className="text-sm text-text">Stichtag</label>
          <input id="stichtag" name="stichtag" type="date" defaultValue={daten.alter.stichtag} className={feld} />
          <button type="submit" className="min-h-11 rounded-md border border-line-strong px-s5 text-sm text-text hover:bg-surface-2">
            Anzeigen
          </button>
        </form>
      </div>

      <section aria-labelledby="alter-titel" className="mb-s6">
        <h2 id="alter-titel" className="mb-s3 text-h2 text-text">
          Altersstruktur {art === 'debitor' ? 'Forderungen' : 'Verbindlichkeiten'}
        </h2>
        <DataTable
          beschriftung={`Altersstruktur ${art === 'debitor' ? 'der Forderungen' : 'der Verbindlichkeiten'} zum Stichtag`}
          zeilen={[...KLASSEN.map((k) => ({ k, label: KLASSE_LABEL[k], wert: klassen[k] })),
            { k: 'gesamt' as const, label: 'Gesamt', wert: klassen.gesamt }]}
          schluessel={(z) => z.k}
          spalten={[
            { schluessel: 'klasse', kopf: 'Klasse', zelle: (z) => (z.k === 'gesamt' ? <strong>{z.label}</strong> : z.label) },
            { schluessel: 'betrag', kopf: 'Offen', numerisch: true,
              zelle: (z) => <span data-cse="alter-klasse" data-klasse={z.k} data-cent={z.wert.toString()}>{z.k === 'gesamt' ? <strong>{formatiereGeld(z.wert)}</strong> : formatiereGeld(z.wert)}</span> },
          ]}
        />
        <p className="mt-s2 text-xs text-text-muted">
          {String(klassen.anzahl)} offene(r) Posten; überfällig {formatiereGeld(klassen.ueberfaellig)}.
          {art === 'debitor' && daten.alter.guthaben.debitorCent > 0n
            ? ` Daneben ${formatiereGeld(daten.alter.guthaben.debitorCent)} Kundenguthaben.` : ''}
          {art === 'kreditor' && daten.alter.guthaben.kreditorCent > 0n
            ? ` Daneben ${formatiereGeld(daten.alter.guthaben.kreditorCent)} Lieferantenguthaben.` : ''}
        </p>
      </section>

      {abst === undefined ? null : (
        <Hinweis art={abst.stimmt ? 'erfolg' : 'warnung'} cse="posten-abstimmung" className="mb-s6 max-w-prose">
          <strong>Abstimmung {abst.stimmt ? 'stimmt' : 'weicht ab'}.</strong>{' '}
          Aus den Posten {formatiereGeld(abst.ausPostenCent)}, aus den Belegen{' '}
          {formatiereGeld(abst.ausBelegenCent)} ({abst.quelle}).
        </Hinweis>
      )}

      {daten.posten.length === 0 ? (
        <p data-cse="posten-leer" className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {art === 'debitor' ? 'Keine offene Forderung.' : 'Keine offene Verbindlichkeit.'}
        </p>
      ) : (
        <DataTable
          beschriftung={art === 'debitor' ? 'Offene Forderungen' : 'Offene Verbindlichkeiten'}
          zeilen={daten.posten}
          schluessel={(z) => z.id}
          spalten={[
            { schluessel: 'beleg', kopf: 'Beleg',
              zelle: (z) => (z.zielPfad === null ? (z.belegnummer ?? '—') : (
                <Link href={`/portal/${mandant}/${z.zielPfad}`} className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {z.belegnummer ?? 'ohne Nummer'}
                </Link>
              )) },
            { schluessel: 'gegenpartei', kopf: art === 'debitor' ? 'Kunde' : 'Lieferant', zelle: (z) => z.gegenpartei ?? '—' },
            { schluessel: 'faellig', kopf: 'Fällig', zelle: (z) => deutschesDatum(z.faelligAm) },
            { schluessel: 'alter', kopf: 'Alter',
              zelle: (z) => (
                <span className="inline-flex flex-wrap items-center gap-s2">
                  <StatusPill zustand={z.klasse === 'nicht_faellig' ? 'Offen' : z.klasse === 'bis30' ? 'Wartet' : 'Überfällig'} />
                  <span className="text-xs text-text-muted">{z.tage < 0 ? `in ${String(-z.tage)} Tagen` : `${String(z.tage)} Tage · ${KLASSE_LABEL[z.klasse]}`}</span>
                </span>
              ) },
            { schluessel: 'betrag', kopf: 'Betrag', numerisch: true, zelle: (z) => formatiereGeld(z.betragCent) },
            { schluessel: 'bezahlt', kopf: 'Bezahlt', numerisch: true, zelle: (z) => formatiereGeld(z.bezahltCent) },
            { schluessel: 'offen', kopf: 'Offen', numerisch: true, zelle: (z) => <strong>{formatiereGeld(z.offenCent)}</strong> },
            { schluessel: 'mahnstufe', kopf: 'Mahnstufe', numerisch: true, zelle: (z) => (z.mahnstufe === 0 ? '—' : String(z.mahnstufe)) },
          ]}
        />
      )}
    </PortalRahmen>
  );
}
