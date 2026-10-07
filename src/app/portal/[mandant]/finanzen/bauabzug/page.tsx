import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { BAUABZUG_TEXTE } from '@/lib/i18n/verwaltung/finanzen/bauabzug';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { cent, formatiereGeldIn } from '@/server/services/finanz/geld';
import {
  ladeBauabzugUebersicht, type BauabzugUebersicht,
} from '@/server/services/finanz/estg48/anmeldung';

/**
 * `/portal/[mandant]/finanzen/bauabzug` — die Bauabzugsteuer-Anmeldung nach
 * § 48a EStG, vorbereitet (FIN-10, LEG-06, V-315, O-187, D-847).
 *
 * **Die Seite rechnet nicht** (Invariante 6): Anteile, Summen und Fristen
 * kommen aus `estg48/anmeldung.ts` — dieselbe Frist steht im Kalender
 * (`kalender/eintraege.ts`, Quelle `bauabzug`).
 *
 * **Lesen mit `eingang.lesen`** (die Eingangsrechnungen); die Zahlungen
 * verlangen `zahlung.lesen`. Fehlt es, sagt die Seite, warum alles „noch
 * keinem Monat zugeordnet" steht, statt es als Tatsache auszugeben.
 */
export const dynamic = 'force-dynamic';

export default async function Bauabzug(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/finanzen/bauabzug`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(BAUABZUG_TEXTE, zugang.sprache);
  const darf = await haeltRechte(zugang.sitzung, 'zahlung.lesen');

  const lage = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => ladeBauabzugUebersicht(kontext))
  ) as Promise<BauabzugUebersicht>);
  const geld = (betrag: bigint): string => formatiereGeldIn(cent(betrag), zugang.sprache);
  const tag = (d: string): string => tagInSprache(d, zugang.sprache);
  const monatsname = (monat: string): string => {
    const [jahr, m] = monat.split('-').map(Number);
    return new Intl.DateTimeFormat(zugang.sprache === 'en' ? 'en-GB' : 'de-DE', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(jahr ?? 1970, (m ?? 1) - 1, 1)));
  };

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s3 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.einleitung}</p>

      <Hinweis art="warnung" cse="bauabzug-voreinstellung" className="mb-s4 max-w-prose">
        {t.voreinstellung}
      </Hinweis>
      <Hinweis art="hinweis" cse="bauabzug-elster" className="mb-s6 max-w-prose">
        {t.elster}
      </Hinweis>
      {darf['zahlung.lesen'] !== true && (
        <Hinweis art="warnung" cse="bauabzug-ohne-zahlungsrecht" className="mb-s6 max-w-prose">
          {t.ohneZahlungsrecht}
        </Hinweis>
      )}

      <section data-cse="bauabzug-monate" className="mb-s7">
        {lage.zeilen.length === 0 ? (
          <p className="m-0 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            {t.leer}
          </p>
        ) : (
          <DataTable
            beschriftung={t.titel}
            zeilen={lage.zeilen}
            schluessel={(z) => `${z.monat}-${z.lieferantId}`}
            spalten={[
              { schluessel: 'monat', kopf: t.spalteMonat, zelle: (z) => monatsname(z.monat) },
              {
                schluessel: 'lieferant', kopf: t.spalteLieferant,
                zelle: (z) => (
                  <span className="flex flex-col">
                    <span className="text-text">{z.lieferant}</span>
                    {z.steuernummer !== null && (
                      <span className="text-xs text-text-muted">{t.steuernummer(z.steuernummer)}</span>
                    )}
                  </span>
                ),
              },
              {
                schluessel: 'einbehalt', kopf: t.spalteEinbehalt,
                zelle: (z) => <span className="tabular-nums" data-cse="bauabzug-summe">{geld(z.einbehaltCent)}</span>,
              },
              { schluessel: 'rechnungen', kopf: t.spalteRechnungen, zelle: (z) => String(z.rechnungen) },
              {
                schluessel: 'frist', kopf: t.spalteFrist,
                zelle: (z) => (
                  <span className="flex flex-col tabular-nums">
                    <span data-cse="bauabzug-frist">{tag(z.frist)}</span>
                    <span className={`text-xs ${z.frist < lage.heute ? 'text-text-muted'
                      : z.frist === lage.heute ? 'text-warning' : 'text-text-muted'}`}>
                      {z.frist < lage.heute ? t.fristVorbei
                        : z.frist === lage.heute ? t.fristHeute : t.fristOffen}
                    </span>
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      {lage.offen.length > 0 && (
        <section data-cse="bauabzug-offen" className="mb-s7 max-w-[72ch]">
          <h2 className="mb-s2 mt-0 text-h3 text-text">{t.offenTitel}</h2>
          <p className="mb-s4 mt-0 text-sm text-text-muted">{t.offenErklaerung}</p>
          <DataTable
            beschriftung={t.offenTitel}
            zeilen={lage.offen}
            schluessel={(z) => z.rechnungId}
            spalten={[
              { schluessel: 'beleg', kopf: t.spalteBeleg, zelle: (z) => z.beleg },
              { schluessel: 'lieferant', kopf: t.spalteLieferant, zelle: (z) => z.lieferant },
              {
                schluessel: 'offen', kopf: t.spalteOffen,
                zelle: (z) => <span className="tabular-nums">{geld(z.offenCent)}</span>,
              },
            ]}
          />
        </section>
      )}

      <p className="m-0 text-sm">
        <Link href={`/portal/${mandant}/finanzen/eingangsrechnungen`}
              className="text-text-muted underline-offset-2 hover:text-text hover:underline">
          {t.zuDenEingangsrechnungen}
        </Link>
      </p>
    </PortalRahmen>
  );
}
