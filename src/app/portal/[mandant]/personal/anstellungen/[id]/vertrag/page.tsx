import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { haeltRechte } from '@/app/portal/rechte';
import type { BereichSchluessel } from '@/lib/design/theme';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { Recht } from '@/components/ui/Recht';
import { formatiereMenge, mengeAusPostgres, tageAusPostgres } from '@/server/services/finanz/menge';
import {
  findeAnstellung, leseKonditionen,
  type AnstellungZeile, type KonditionZeile,
} from '@/server/services/personal/anstellung';
import { mandantTor, MandantAntwort } from '../../../../../unterseite';
import { kennungOder404 } from '../../../../../kennung';

/**
 * `/portal/[mandant]/personal/anstellungen/[id]/vertrag` — Personalnummer und
 * Eintritt (D-09, EMP-04, §5.12.1).
 *
 * **Zwei Schreibfelder und nicht vier — das ist der Kern dieser Seite.** Die
 * Seitenkarte nennt hier auch Arbeitszeitmodell und Wochenstunden; 01-KERN
 * §6.14 fuehrt beide aber ausdruecklich als **abgeleiteten Spiegel** der
 * datierten `anstellung_kondition` mit genau EINEM Schreiber
 * (`kern.anstellung_kondition_spiegeln`), und 05-API-KARTE fuehrt sie unter
 * `…/konditionen` mit dem strengeren Recht `personal.entgelt_schreiben`. Zwei
 * Schreibflaechen ueber einer Spalte, mit zwei verschiedenen Rechten, sind
 * genau der Defekt, vor dem §5.12.1 bei Zugang und Nachweisen warnt: der
 * schwaechere Weg gewinnt, und niemand merkt es. Deshalb stehen sie hier
 * LESEND, mit dem Verweis auf die Kondition.
 *
 * **Und `austritt` gehoert `/beenden`.** Eine Spalte, ein Schreiber. Ein
 * Austrittsdatum, das hier nebenbei entstuende, entzieht nach K-14 den
 * Portalzugang — ohne Grund, ohne Warnung, ohne den Blick auf die offenen
 * Folgen.
 *
 * **Das Vokabular von `arbeitszeitmodell` ist unentschieden** (O-18). Das Feld
 * bleibt deshalb frei und bekommt keine erfundene Auswahlliste.
 */
export const dynamic = 'force-dynamic';

const STATUS: Readonly<Record<string, PillZustand>> = {
  geplant: 'Geplant', aktiv: 'Aktiv', ruhend: 'Wartet', beendet: 'Abgeschlossen',
};

export default async function Vertragsblatt({
  params, searchParams,
}: {
  params: Promise<{ mandant: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/anstellungen/${id}/vertrag`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /* AUT-06: das Blatt der Beschaeftigung verlangt `personal.lesen`, diese
     Seite `personal.schreiben`; „Entgelt" verlangt `personal.entgelt_lesen`
     und „Beenden" `personal.anstellung_beenden`. Wer nur dieses Recht haelt,
     bekommt hinter einem dieser Verweise ein 404 — und ein Verweis auf 404
     verraet, was er nicht zeigen darf (D-581). */
  const darf = await haeltRechte(
    zugang.sitzung,
    'personal.lesen', 'personal.entgelt_lesen', 'personal.entgelt_schreiben',
    'personal.anstellung_beenden');

  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const zeile = await findeAnstellung(kontext, id);
      if (zeile === null) return { zeile: null, konditionen: [] as readonly KonditionZeile[] };
      return { zeile, konditionen: await leseKonditionen(kontext, id) };
    })) as Promise<{
      zeile: AnstellungZeile | null; konditionen: readonly KonditionZeile[];
    }>);

  if (daten.zeile === null) notFound();
  const { zeile, konditionen } = daten;
  const laufend = konditionen.find((k) => k.giltBis === null) ?? null;

  const verweis = 'inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text';
  const feld = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text';
  const gesperrt = 'min-h-11 w-full rounded-md border border-line bg-surface-2 px-s3 py-s2 text-sm text-text-muted';

  return (
    <PortalRahmen
      titel="Vertrag"
      wurzelTitel="Personal"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="personal"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div data-cse="vertrag-kopf" className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Vertrag — {zeile.personName}</h1>
        <span className="flex items-center gap-s2">
          <StatusPill zustand={STATUS[zeile.status] ?? 'Aktiv'} />
          <span className="text-sm text-text-muted">{zeile.status}</span>
        </span>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        {darf['personal.lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}`} className={verweis}>
            Zur Beschäftigung
          </Link>
        )}
        {darf['personal.entgelt_lesen'] === true && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}/entgelt`} className={verweis}>
            Entgelt und Konditionen
          </Link>
        )}
        {darf['personal.anstellung_beenden'] === true && zeile.status !== 'beendet' && (
          <Link href={`/portal/${mandant}/personal/anstellungen/${id}/beenden`} className={verweis}>
            Beschäftigung beenden
          </Link>
        )}
      </nav>

      {meldung !== null && (
        <Hinweis art="warnung" cse="vertrag-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {meldung}
        </Hinweis>
      )}

      <form
        method="post"
        action={`/api/personal/anstellungen/${id}/vertrag`}
        data-cse="vertrag-formular"
        className="mb-s6 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
      >
        <input type="hidden" name="zurueck" value={pfad} />

        <label className="flex flex-col gap-s2 text-sm text-text">
          Personalnummer
          <input
            name="personalnummer"
            required
            defaultValue={zeile.personalnummer}
            className={feld}
            data-cse="vertrag-personalnummer"
          />
          <span className="text-xs text-text-subtle">
            Eindeutig je Gesellschaft. Jede Entität führt ihre eigene Systematik
            (D-09) — dieselbe Nummer in der Schwestergesellschaft ist in
            Ordnung, hier nicht.
          </span>
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text">
          Eintritt
          <input
            type="date"
            name="eintritt"
            required
            defaultValue={zeile.eintritt}
            className={feld}
            data-cse="vertrag-eintritt"
          />
          <span className="text-xs text-text-subtle">
            Ein Kalendertag, kein Zeitpunkt: eine Beschäftigung beginnt an einem
            Tag (§5.12.1, Invariante 2).
          </span>
        </label>

        <div>
          <Button type="submit" variante="primary" data-cse="vertrag-speichern">
            Speichern
          </Button>
        </div>
      </form>

      <h2 className="mb-s3 text-h2 text-text">Nicht hier zu ändern</h2>
      <section
        data-cse="vertrag-gesperrt"
        className="mb-s6 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
      >
        <label className="flex flex-col gap-s2 text-sm text-text-muted">
          Austritt
          <input type="text" readOnly disabled
                 value={zeile.austritt === null ? 'unbefristet' : tagDeutsch(zeile.austritt)}
                 className={gesperrt} />
          <span className="text-xs text-text-subtle">
            Das Austrittsdatum gehört der Seite „Beschäftigung beenden": dort
            steht der Pflichtgrund daneben, und dort ist sichtbar, was ein
            Austritt offen lässt. Eine Spalte, ein Schreiber.
          </span>
        </label>

        <label className="flex flex-col gap-s2 text-sm text-text-muted">
          Arbeitszeitmodell
          <input
            type="text"
            readOnly
            disabled
            value={zeile.arbeitszeitmodell ?? 'nicht hinterlegt'}
            className={gesperrt}
          />
        </label>
        <label className="flex flex-col gap-s2 text-sm text-text-muted">
          Wochenstunden
          <input
            type="text"
            readOnly
            disabled
            value={zeile.wochenstunden === null
              ? 'nicht hinterlegt' : `${formatiereMenge(mengeAusPostgres(zeile.wochenstunden))} h`}
            className={gesperrt}
          />
        </label>
        <label className="flex flex-col gap-s2 text-sm text-text-muted">
          Arbeitstage pro Woche
          <input
            type="text"
            readOnly
            disabled
            value={zeile.arbeitstageWoche === null
              ? 'nicht hinterlegt' : tageAusPostgres(zeile.arbeitstageWoche)}
            className={gesperrt}
          />
        </label>

        <p className="m-0 text-xs text-text-subtle">
          Arbeitszeitmodell, Wochenstunden und Arbeitstage sind ein{' '}
          <strong className="text-text">Spiegel der heute gültigen Kondition</strong>{' '}
          (01-KERN §6.14) und haben genau einen Schreiber — den Auslöser, der
          sie aus <span className="font-mono">anstellung_kondition</span>
          {' '}ableitet. Geändert werden sie, indem eine neue datierte Kondition
          entsteht; das verlangt <Recht schluessel="personal.entgelt_schreiben" />.
          Der Grund ist nicht Ordnungsliebe: eine Änderung an der Spalte
          bewertete jede vergangene Sollstunden- und Lohnkostenrechnung
          stillschweigend neu.
          {laufend === null
            ? ' Für diese Beschäftigung ist noch keine Kondition hinterlegt.'
            : ` Die laufende Kondition gilt ab ${tagDeutsch(laufend.giltAb)}.`}
        </p>
        {darf['personal.entgelt_schreiben'] === true && (
          <div>
            <Link
              href={`/portal/${mandant}/personal/anstellungen/${id}/entgelt`}
              className={verweis}
            >
              Kondition eintragen
            </Link>
          </div>
        )}
      </section>

      <p className="max-w-prose text-sm text-text-muted">
        Das Vokabular des Arbeitszeitmodells ist{' '}
        <strong className="text-text">nicht entschieden</strong>: welche
        Beschäftigungs- und SV-Kategorien die Gruppe führt und ob sie den Codes
        des Lohnsystems entsprechen müssen, ist offen (O-18). Bis zur Antwort
        ist es ein freies Feld auf der Kondition — eine Auswahlliste hier wäre
        eine erfundene Entscheidung mit Lohnwirkung.
      </p>
    </PortalRahmen>
  );
}
