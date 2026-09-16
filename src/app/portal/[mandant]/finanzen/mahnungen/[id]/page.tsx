import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { findeMahnung, type MahnungStatus } from '@/server/services/finanz/mahnung/index';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';

/**
 * `/portal/[mandant]/finanzen/mahnungen/[id]` — eine Mahnung, ihre Positionen
 * und die drei Schritte, die ein Mensch auslöst (FIN-15).
 *
 * **Die Herleitung steht auf dem Bildschirm, nicht nur der Betrag.** Zu jeder
 * Position stehen Verzugsbeginn, Tage, Satz in Basispunkten und der daraus
 * gerechnete Zins. Danach fragt der Anwalt des Empfängers — und wer die Zahl
 * ohne Rechenweg zeigt, kann sie nicht verteidigen.
 *
 * **Drei Formulare, drei Zustände.** Ein Entwurf lässt sich freigeben oder
 * verwerfen; eine freigegebene Mahnung lässt sich als versendet
 * dokumentieren. Was nicht dran ist, steht nicht da — ein Knopf, der
 * scheitert, ist schlechter als keiner.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<MahnungStatus, PillZustand>> = {
  entwurf: 'Entwurf',
  freigegeben: 'Bereit',
  versendet: 'Abgeschlossen',
  erledigt: 'Abgeschlossen',
  verworfen: 'Abgelehnt',
};

export default async function MahnungDetail(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const { hinweis } = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/mahnungen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const vorgang = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => findeMahnung(kontext, id)))
    ) as Awaited<ReturnType<typeof findeMahnung>>;
  if (vorgang === null) notFound();
  const { kopf, positionen } = vorgang;

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const knopf = 'mt-s4 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold '
    + 'text-white hover:bg-brand-hover';

  return (
    <PortalRahmen
      titel={`Mahnung ${kopf.nummer ?? 'Entwurf'}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mahnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <p className="mb-s3 text-sm">
        <Link
          href={`/portal/${mandant}/finanzen/mahnungen`}
          className="text-text-muted underline-offset-2 hover:text-brand hover:underline"
        >
          ← Alle Mahnungen
        </Link>
      </p>

      <div className="mb-s5 flex flex-wrap items-baseline gap-s3">
        <h1 className="text-h1 text-text">
          {kopf.bezeichnung} {kopf.nummer ?? ''}
        </h1>
        <StatusPill zustand={PILLE[kopf.status]} />
      </div>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p
          data-cse="mahn-hinweis"
          className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text"
        >
          {hinweis}
        </p>
      ) : null}

      <dl className="mb-s7 grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">Kunde</dt>
          <dd className="text-sm text-text">{kopf.kundeName}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Stufe</dt>
          <dd className="text-sm text-text">{String(kopf.stufe)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Mahndatum</dt>
          <dd className="text-sm text-text">{kopf.mahndatum}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">Zahlbar bis</dt>
          <dd className="text-sm text-text">{kopf.zahlbarBis}</dd>
        </div>
      </dl>

      <section aria-labelledby="positionen-titel" className="mb-s7">
        <h2 id="positionen-titel" className="mb-s3 text-h2 text-text">
          Geforderte Positionen
        </h2>
        <DataTable
          beschriftung="Positionen der Mahnung mit Rechnung, Betrag, Verzugsbeginn, Tagen, Satz und Zins"
          zeilen={[...positionen]}
          schluessel={(p) => `${p.rechnungsnummer ?? '—'}:${p.faelligAm}`}
          spalten={[
            {
              schluessel: 'rechnung', kopf: 'Rechnung',
              zelle: (p) => p.rechnungsnummer ?? '—',
            },
            { schluessel: 'faellig', kopf: 'Fällig', zelle: (p) => p.faelligAm },
            {
              schluessel: 'offen', kopf: 'Offen', numerisch: true,
              zelle: (p) => formatiereGeld(p.offenCent),
            },
            {
              schluessel: 'verzug', kopf: 'Verzug ab',
              zelle: (p) => p.verzugsbeginnAm ?? '—',
            },
            {
              schluessel: 'tage', kopf: 'Tage', numerisch: true,
              zelle: (p) => String(p.verzugstage),
            },
            {
              schluessel: 'satz', kopf: 'Satz (bp)', numerisch: true,
              zelle: (p) => String(p.zinsBp),
            },
            {
              schluessel: 'zins', kopf: 'Zins', numerisch: true,
              zelle: (p) => formatiereGeld(p.zinsCent),
            },
          ]}
        />
        <dl className="mt-s4 max-w-sm text-sm">
          <div className="flex justify-between border-t border-line py-s2">
            <dt className="text-text-muted">Forderung</dt>
            <dd className="text-text">{formatiereGeld(kopf.forderungCent)}</dd>
          </div>
          <div className="flex justify-between py-s2">
            <dt className="text-text-muted">Mahngebühr</dt>
            <dd className="text-text">{formatiereGeld(kopf.gebuehrCent)}</dd>
          </div>
          <div className="flex justify-between py-s2">
            <dt className="text-text-muted">Verzugszinsen</dt>
            <dd className="text-text">{formatiereGeld(kopf.zinsenCent)}</dd>
          </div>
          <div className="flex justify-between border-t border-line py-s2">
            <dt className="text-text">Gesamtbetrag</dt>
            <dd className="text-text"><strong>{formatiereGeld(kopf.gesamtCent)}</strong></dd>
          </div>
        </dl>
      </section>

      {kopf.verworfenGrund === null ? null : (
        <p className="mb-s7 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Verworfen: {kopf.verworfenGrund}
        </p>
      )}

      {kopf.status === 'entwurf' ? (
        <div className="grid grid-cols-1 gap-s5 lg:grid-cols-2">
          <section
            aria-labelledby="freigeben-titel"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <h2 id="freigeben-titel" className="text-h2 text-text">Freigeben</h2>
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              Die Freigabe hält fest, wer genau diese Beträge genehmigt hat.
              Erst mit ihr zieht die Datenbank die Nummer — ein Entwurf trägt
              keine.
            </p>
            <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="freigeben" />
              <input type="hidden" name="mahnungId" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="begruendung">
                Begründung
              </label>
              <input
                id="begruendung" name="begruendung" type="text" required
                minLength={5} className={feld}
                placeholder="Zahlungserinnerung nach Rücksprache freigegeben"
              />
              <button type="submit" className={knopf}>Freigeben</button>
            </form>
          </section>

          <section
            aria-labelledby="verwerfen-titel"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <h2 id="verwerfen-titel" className="text-h2 text-text">Verwerfen</h2>
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              Der Entwurf bleibt mit seinem Grund stehen — gelöscht wird
              nichts (Invariante 8).
            </p>
            <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="verwerfen" />
              <input type="hidden" name="mahnungId" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="grund">Grund</label>
              <input
                id="grund" name="grund" type="text" required minLength={5} className={feld}
                placeholder="Kunde hat nachweislich am Vortag gezahlt"
              />
              <button type="submit" className={knopf}>Verwerfen</button>
            </form>
          </section>
        </div>
      ) : null}

      {kopf.status === 'freigegeben' ? (
        <section
          aria-labelledby="versand-titel"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <h2 id="versand-titel" className="text-h2 text-text">Versand dokumentieren</h2>
          <p className="mt-s2 text-xs text-text-muted">
            Es gibt keinen automatischen Versand: die Mahnung geht als Brief,
            Einschreiben oder durch Boten hinaus, und hier wird festgehalten,
            dass sie hinausgegangen ist. Erst danach läuft der Verzug — und
            erst dann ist die nächste Stufe möglich.
          </p>
          <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="versenden" />
            <input type="hidden" name="mahnungId" value={kopf.id} />
            <label className="block text-sm text-text" htmlFor="versandart">Weg</label>
            <select id="versandart" name="versandart" required className={feld}>
              <option value="brief">Brief</option>
              <option value="einschreiben">Einschreiben</option>
              <option value="bote">Bote</option>
            </select>
            <label className="mt-s4 block text-sm text-text" htmlFor="empfaenger">
              Empfänger
            </label>
            <input
              id="empfaenger" name="empfaenger" type="text" required className={feld}
              placeholder={kopf.kundeName}
            />
            <button type="submit" className={knopf}>Versand dokumentieren</button>
          </form>
        </section>
      ) : null}
    </PortalRahmen>
  );
}
