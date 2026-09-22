import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { internSprache } from '@/lib/i18n/intern';
import { AUFNAHME_TEXTE } from '@/lib/i18n/verwaltung/datenschutz';
import { AufnahmeFormular } from '../AufnahmeFormular';

/**
 * `/portal/[mandant]/datenschutz/aufnehmen` — eine Betroffenenanfrage
 * protokollieren, die nicht durch das Formular kam (V-031, Art. 12 Abs. 1).
 *
 * **Der Befund.** `betroffenenanfrage` hatte genau einen Erzeuger: das
 * öffentliche Formular. Seine INSERT-Policy verlangt `formular.schreiben`, das
 * Recht des Eingangsprinzipals — wer im Büro den Datenschutz führt, konnte
 * lesen, entscheiden, verlängern, zuordnen und keine Zeile anlegen. Ein Brief
 * blieb damit ein Brief auf einem Schreibtisch, während die Monatsfrist des
 * Art. 12 Abs. 3 seit seinem Eingang lief.
 *
 * **Warum die Seite nach dem Eingangstag fragt und nicht `now()` nimmt.** Das
 * ist der ganze Unterschied zum Formular. Dort ist der Eingang der Augenblick
 * des Absendens; hier ist er der Posteingangsstempel, und er liegt hinter uns.
 * Die Datenbank hält dagegen, was sie halten kann: nach vorn geht es nicht
 * (`kern.betroffenenanfrage_frist`, 0378) — nur diese Richtung verschaffte
 * eine längere Frist.
 */
export const dynamic = 'force-dynamic';

const RECHT = 'datenschutz.auskunft_erstellen';

export const metadata = { title: 'Anfrage aufnehmen' };

export default async function AnfrageAufnehmen(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/datenschutz/aufnehmen`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(AUFNAHME_TEXTE, zugang.sprache);

  const darf = await haeltRechte(zugang.sitzung, RECHT);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/datenschutz`, text: t.modul }}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{t.titel}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="warum-aufnehmen" className="mb-s5 max-w-prose">
        {t.warumErklaerung}
      </Hinweis>

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht}{' '}
          <code className="font-mono">{RECHT}</code>.
        </Hinweis>
      ) : (
        <AufnahmeFormular mandant={mandant}
                          sprache={internSprache(zugang.sprache)} t={t} />
      )}
    </PortalRahmen>
  );
}
