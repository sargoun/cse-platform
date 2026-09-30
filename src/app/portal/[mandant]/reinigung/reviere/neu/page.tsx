import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { REVIER_FEHLER_TEXTE, REVIER_TEXTE } from '@/lib/i18n/verwaltung/reinigung';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { RevierFormular, type ObjektAuswahl } from '../../RevierFormular';
import { Recht } from '@/components/ui/Recht';

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
  /*
   * Eine Abweisung aus `POST /api/reinigung/reviere` kommt als GRUND
   * (`?fehler=`, V-275, D-769) und wird hier ein Satz in der Sprache der
   * Sitzung — nur als eigener Eintrag nachgeschlagen (D-728). Ein Wort, das
   * die Tabelle nicht kennt, wird der allgemeine Satz, nie das Wort selbst.
   */
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const tF = nachSprache(REVIER_FEHLER_TEXTE, zugang.sprache);
  const fehlerText = fehler === null ? null : (eigenerEintrag(tF.fehler, fehler) ?? tF.sonst);

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
      wurzelTitel={t.modul}
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

      {fehlerText !== null && (
        <Hinweis art="warnung" rolle="alert" cse="revier-fehler" className="mb-s5 max-w-prose">
          <strong>{tF.titel}</strong> {fehlerText}
        </Hinweis>
      )}

      {darf['reinigung.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrechtAnlegen}{' '}
          <Recht schluessel={RECHT_SCHREIBEN} sprache={zugang.sprache} />.
        </Hinweis>
      ) : objekte.length === 0 ? (
        <Hinweis art="warnung" cse="revier-ohne-objekt" className="max-w-prose">
          {darf['objekt.lesen'] === true ? t.keinObjekt : t.objektPflicht}{' '}
          {darf['objekt.lesen'] !== true && (
            <Recht schluessel={RECHT_OBJEKT} sprache={zugang.sprache} />
          )}
        </Hinweis>
      ) : (
        <RevierFormular zurueck={pfad} objekte={objekte} t={t} />
      )}
    </PortalRahmen>
  );
}
