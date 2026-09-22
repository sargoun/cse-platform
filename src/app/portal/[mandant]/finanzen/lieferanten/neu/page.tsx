import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { LIEFERANTEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/lieferanten';
import { LieferantFormular } from '../LieferantFormular';
import { LIEFERANT_FEHLER } from '../fehler';

/**
 * `/portal/[mandant]/finanzen/lieferanten/neu` — einen Lieferanten anlegen
 * (V-006).
 */
export const dynamic = 'force-dynamic';

const RECHT = 'eingang.schreiben';

export const metadata = { title: 'Neuer Lieferant' };

export default async function LieferantNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/finanzen/lieferanten/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(LIEFERANTEN_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT, 'eingang.lesen');
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const meldungen = nachSprache(LIEFERANT_FEHLER, zugang.sprache);

  return (
    <PortalRahmen
      titel={t.neuTitel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="finanzen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['eingang.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/finanzen/lieferanten`, text: t.modul } }
        : {})}
    >
      <h1 className="mb-s5 mt-0 text-h1 text-text">{t.neuTitel}</h1>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="lieferant-fehler" className="mb-s5 max-w-prose">
          {meldungen[fehler] ?? fehler}
        </Hinweis>
      )}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht}{' '}
          <code className="font-mono">{RECHT}</code>.
        </Hinweis>
      ) : (
        <LieferantFormular
          zurueck={darf['eingang.lesen'] === true
            ? `/portal/${mandant}/finanzen/lieferanten/__ID__`
            : pfad}
          fehlerweg={pfad}
          vorhanden={null}
          t={t}
        />
      )}
    </PortalRahmen>
  );
}
