import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { INTERN_BESCHRIFTUNGEN, internSprache } from '@/lib/i18n/intern';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { REVIER_TEXTE } from '@/lib/i18n/verwaltung/reinigung';
import { RevierFormular, type ObjektAuswahl } from '../../RevierFormular';

/**
 * `/portal/[mandant]/reinigung/reviere/neu` — ein Revier zuschneiden
 * (V-002, CLN-01, OPS-02).
 *
 * **Diese Datei war ein Platzhalter, und der Platzhalter war ehrlich.** Es gab
 * keinen Dienst, keine Route und keinen Knopf; jede Revierzeile der Plattform
 * entstand im Seed. Damit war der gesamte Reinigungsdienstplan für neue
 * Flächen zu — ein Turnus hängt am Revier, ein Einsatz am Turnus, ein
 * Leistungsnachweis am Einsatz. Die Fehlermeldung `RaumNichtEntfernbar`
 * verwies ihrerseits auf zwei Wege („neu anlegen", „archivieren"), die es
 * beide nicht gab.
 *
 * **Die Objektauswahl hängt an `objekt.lesen`, und die Seite sagt es.** Ohne
 * das Recht bleibt die Liste leer; das ist dann kein Haus ohne Gebäude,
 * sondern ein fehlendes Leserecht — und der Unterschied gehört auf den
 * Bildschirm, nicht in eine leere Auswahlliste (AUT-06).
 */
export const dynamic = 'force-dynamic';

/**
 * Die beiden Rechteschluessel, wie sie dem Menschen ANGEZEIGT werden.
 *
 * Sie sind **Daten, keine Beschriftung**: dieselbe Zeichenkette steht in
 * `katalog.generiert.ts` und in jedem Protokolleintrag. Uebersetzt waere sie
 * falsch, und als Literal im JSX-Text zaehlte die Uebersetzungswache sie zu
 * Recht als deutsches Wort mit. In den PRUEFUNGEN unten steht dagegen das
 * Literal, weil `tests/kern/verweis-rechte.test.ts` den Quelltext liest und
 * eine Bewachung nur an `haeltRechte(…, '…')` erkennt.
 */
const RECHT_SCHREIBEN = 'reinigung.schreiben';
const RECHT_OBJEKT = 'objekt.lesen';

export const metadata = { title: 'Neues Revier' };

export default async function RevierNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/reinigung/reviere/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(REVIER_TEXTE, zugang.sprache);

  /*
   * Drei Rechte, und jedes beantwortet eine andere Frage: `reinigung.schreiben`
   * ob das Formular ueberhaupt etwas bewirken kann, `reinigung.lesen` ob der
   * Rueckweg auf die Revierliste gezeigt werden darf (AUT-06, D-581), und
   * `objekt.lesen`, ob die Auswahlliste gefuellt werden kann.
   */
  const darf = await haeltRechte(
    zugang.sitzung, 'reinigung.schreiben', 'reinigung.lesen', 'objekt.lesen');
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const objekte = darf['objekt.lesen'] !== true ? [] : await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext) => kontext.abfrage<ObjektAuswahl>(
        `select id, bezeichnung from objekt
          where archiviert_am is null
          order by bezeichnung
          limit 500`,
      ))) as Promise<readonly ObjektAuswahl[]>);

  return (
    <PortalRahmen
      titel={t.neuTitel}
      wurzelTitel={INTERN_BESCHRIFTUNGEN[internSprache(zugang.sprache)].reinigung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
        {...(darf['reinigung.lesen'] === true
          ? { zurueck: { ziel: `/portal/${mandant}/reinigung/reviere`, text: t.alleReviere } }
          : {})}
    >
      <h1 className="mb-s5 mt-0 text-h1 text-text">{t.neuTitel}</h1>

      {meldung !== null && (
        <Hinweis art="warnung" cse="revier-meldung" className="mb-s5 max-w-prose">
          {meldung}
        </Hinweis>
      )}

      {darf['reinigung.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrechtAnlegen}{' '}
          <code className="font-mono">{RECHT_SCHREIBEN}</code>.
        </Hinweis>
      ) : objekte.length === 0 ? (
        <Hinweis art="warnung" cse="revier-ohne-objekt" className="max-w-prose">
          {darf['objekt.lesen'] === true ? t.keinObjekt : t.objektPflicht}{' '}
          {darf['objekt.lesen'] !== true && (
            <code className="font-mono">{RECHT_OBJEKT}</code>
          )}
        </Hinweis>
      ) : (
        <RevierFormular zurueck={pfad} objekte={objekte} t={t} />
      )}
    </PortalRahmen>
  );
}
