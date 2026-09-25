import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Monatsplan } from '@/components/portal/Wochenplan';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { ladePlanfenster, monatsgrenzen } from '../daten';
import { berlinHeute } from '@/server/db/heute';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { MONAT_TEXTE } from '@/lib/i18n/verwaltung/dienstplan-monat';

/**
 * `/portal/[mandant]/dienstplan/monat` — TIM-01.
 *
 * **Kein Raster.** Der Monat ist eine Uebersicht, keine Disposition, und ein
 * 31-Spalten-Raster auf einem Telefon ist entweder unlesbar oder scrollt
 * seitwaerts — DESIGN §8 verbietet das zweite ausdruecklich. Stattdessen
 * Karten, die ab 375px einspaltig stehen und mit der Breite mitwachsen.
 *
 * **Keine Schicht bleibt verborgen** (TIM-04, V-186): eine Karte zeigt
 * hoechstens vier Schichten; ihr Kopf und der Verweis „und N weitere" fuehren
 * in die Tagesansicht, die alle zeigt.
 */
export const dynamic = 'force-dynamic';

export default async function Monatsansicht({
  params, searchParams,
}: {
  params: Promise<{ mandant: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/dienstplan/monat`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const frage = await searchParams;
  const roh = typeof frage['monat'] === 'string' ? frage['monat'] : null;
  // Der Berliner Tag kommt aus der Datenbank — siehe `@/server/db/heute`.
  const anker = roh !== null && /^\d{4}-\d{2}-\d{2}$/u.test(roh) ? roh : await berlinHeute();
  const { von, bis } = monatsgrenzen(anker);
  const { tage, schichten, abwesenheitGeprueft } = await ladePlanfenster(sitzung, von, bis);
  const t = nachSprache(MONAT_TEXTE, zugang.sprache);

  return (
    <PortalRahmen
      titel={t.titel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dienstplan"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.titel}</h1>
        <p className="m-0 text-sm text-text-muted">{t.schichten(schichten.length)}</p>
      </div>

      {!abwesenheitGeprueft && (
        <p className="mb-s4 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted">
          {t.abwesenheitNichtGeprueftVor}{' '}
          <Recht schluessel="zeit.abwesenheit_lesen" sprache={zugang.sprache} />
          {t.abwesenheitNichtGeprueftNach} <strong>{t.heisstNicht}</strong>
        </p>
      )}
      <nav aria-label={t.ansichtWechseln} className="mb-s4 flex flex-wrap gap-s2">
        <Link
          href={`/portal/${mandant}/dienstplan/woche?woche=${von}`}
          className="flex min-h-11 items-center rounded-md border border-line px-s3 py-s1 text-sm text-text-muted hover:border-line-strong hover:text-text"
        >
          {t.wochenansicht}
        </Link>
      </nav>

      {schichten.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.nichtsGeplant}
        </p>
      ) : (
        <Monatsplan
          tage={tage}
          schichten={schichten}
          zielFuer={(s) => `/portal/${mandant}/dienstplan/einsatz/${s.id}`}
          tagZiel={(datum) => `/portal/${mandant}/dienstplan/tag?tag=${datum}`}
          texte={t}
        />
      )}
    </PortalRahmen>
  );
}
