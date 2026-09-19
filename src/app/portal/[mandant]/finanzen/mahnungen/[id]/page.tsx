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
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { MAHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/mahnungen';

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

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(MAHNUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

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
      titel={`${t.mahnung} ${kopf.nummer ?? t.entwurf}`}
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
          ← {t.alleMahnungen}
        </Link>
      </p>

      <div className="mb-s5 flex flex-wrap items-baseline gap-s3">
        <h1 className="text-h1 text-text">
          {kopf.bezeichnung} {kopf.nummer ?? ''}
        </h1>
        <StatusPill zustand={PILLE[kopf.status]} sprache={zugang.sprache} />
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
          <dt className="text-xs text-text-muted">{g.kunde}</dt>
          <dd className="text-sm text-text">{kopf.kundeName}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.stufe}</dt>
          <dd className="text-sm text-text">{String(kopf.stufe)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.mahndatum}</dt>
          <dd className="text-sm text-text">{kopf.mahndatum}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.zahlbarBis}</dt>
          <dd className="text-sm text-text">{kopf.zahlbarBis}</dd>
        </div>
      </dl>

      <section aria-labelledby="positionen-titel" className="mb-s7">
        <h2 id="positionen-titel" className="mb-s3 text-h2 text-text">
          {t.positionenTitel}
        </h2>
        <DataTable
          beschriftung={t.tabellePositionen}
          zeilen={[...positionen]}
          schluessel={(p) => `${p.rechnungsnummer ?? '—'}:${p.faelligAm}`}
          spalten={[
            {
              schluessel: 'rechnung', kopf: t.rechnung,
              zelle: (p) => p.rechnungsnummer ?? '—',
            },
            { schluessel: 'faellig', kopf: g.faellig, zelle: (p) => p.faelligAm },
            {
              schluessel: 'offen', kopf: t.offen, numerisch: true,
              zelle: (p) => formatiereGeld(p.offenCent),
            },
            {
              schluessel: 'verzug', kopf: t.verzugAb,
              zelle: (p) => p.verzugsbeginnAm ?? '—',
            },
            {
              schluessel: 'tage', kopf: t.tage, numerisch: true,
              zelle: (p) => String(p.verzugstage),
            },
            {
              schluessel: 'satz', kopf: t.satzBp, numerisch: true,
              zelle: (p) => String(p.zinsBp),
            },
            {
              schluessel: 'zins', kopf: t.zins, numerisch: true,
              zelle: (p) => formatiereGeld(p.zinsCent),
            },
          ]}
        />
        <dl className="mt-s4 max-w-sm text-sm">
          <div className="flex justify-between border-t border-line py-s2">
            <dt className="text-text-muted">{t.forderung}</dt>
            <dd className="text-text">{formatiereGeld(kopf.forderungCent)}</dd>
          </div>
          <div className="flex justify-between py-s2">
            <dt className="text-text-muted">{t.mahngebuehr}</dt>
            <dd className="text-text">{formatiereGeld(kopf.gebuehrCent)}</dd>
          </div>
          <div className="flex justify-between py-s2">
            <dt className="text-text-muted">{t.verzugszinsen}</dt>
            <dd className="text-text">{formatiereGeld(kopf.zinsenCent)}</dd>
          </div>
          <div className="flex justify-between border-t border-line py-s2">
            <dt className="text-text">{t.gesamtbetrag}</dt>
            <dd className="text-text"><strong>{formatiereGeld(kopf.gesamtCent)}</strong></dd>
          </div>
        </dl>
      </section>

      {kopf.verworfenGrund === null ? null : (
        <p className="mb-s7 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.verworfen}: {kopf.verworfenGrund}
        </p>
      )}

      {kopf.status === 'entwurf' ? (
        <div className="grid grid-cols-1 gap-s5 lg:grid-cols-2">
          <section
            aria-labelledby="freigeben-titel"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <h2 id="freigeben-titel" className="text-h2 text-text">{g.freigeben}</h2>
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              {t.freigabeErklaerung}
            </p>
            <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="freigeben" />
              <input type="hidden" name="mahnungId" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="begruendung">
                {t.begruendung}
              </label>
              <input
                id="begruendung" name="begruendung" type="text" required
                minLength={5} className={feld}
                placeholder={t.freigabePlatzhalter}
              />
              <button type="submit" className={knopf}>{g.freigeben}</button>
            </form>
          </section>

          <section
            aria-labelledby="verwerfen-titel"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <h2 id="verwerfen-titel" className="text-h2 text-text">{t.verwerfen}</h2>
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              {t.verwerfenErklaerung}
            </p>
            <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="verwerfen" />
              <input type="hidden" name="mahnungId" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="grund">{t.grund}</label>
              <input
                id="grund" name="grund" type="text" required minLength={5} className={feld}
                placeholder={t.verwerfenPlatzhalter}
              />
              <button type="submit" className={knopf}>{t.verwerfen}</button>
            </form>
          </section>
        </div>
      ) : null}

      {kopf.status === 'freigegeben' ? (
        <section
          aria-labelledby="versand-titel"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <h2 id="versand-titel" className="text-h2 text-text">{t.versandTitel}</h2>
          <p className="mt-s2 text-xs text-text-muted">
            {t.versandErklaerung}
          </p>
          <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="versenden" />
            <input type="hidden" name="mahnungId" value={kopf.id} />
            <label className="block text-sm text-text" htmlFor="versandart">{t.weg}</label>
            <select id="versandart" name="versandart" required className={feld}>
              <option value="brief">{t.versandarten.brief}</option>
              <option value="einschreiben">{t.versandarten.einschreiben}</option>
              <option value="bote">{t.versandarten.bote}</option>
            </select>
            <label className="mt-s4 block text-sm text-text" htmlFor="empfaenger">
              {t.empfaenger}
            </label>
            <input
              id="empfaenger" name="empfaenger" type="text" required className={feld}
              placeholder={kopf.kundeName}
            />
            <button type="submit" className={knopf}>{t.versandTitel}</button>
          </form>
        </section>
      ) : null}
    </PortalRahmen>
  );
}
