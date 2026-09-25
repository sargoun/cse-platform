import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { OBJEKTE_TEXTE } from '@/lib/i18n/verwaltung/objekte';
import { ObjektFormular, type KundeAuswahl } from '../ObjektFormular';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/objekte/neu` — ein Objekt anlegen (OPS-01, V-001).
 *
 * **Diese Datei war bis hierher ein Platzhalter**, und der Platzhalter war
 * ehrlich: es gab keinen Dienst, keine Route und keinen Knopf. Jede
 * Objektzeile der Plattform entstand im Seed. Wer am Montag ein neues Gebäude
 * übernahm, hatte keinen Weg hinein.
 *
 * Der alte Kommentar an dieser Stelle begründete, warum eine Datei für eine
 * Seite existiert, die es nicht gibt: ohne sie griffe Next.js die
 * Nachbarroute `[id]`, reichte `neu` als Kennung in ein `$1::uuid` und
 * antwortete **500**. Diese Begründung gilt weiter — nur trägt die Datei
 * jetzt die Seite selbst, und der Umweg erübrigt sich.
 */
export const dynamic = 'force-dynamic';

/**
 * Der Rechteschluessel, wie er dem Menschen ANGEZEIGT wird.
 *
 * Er ist **Daten, keine Beschriftung**: dieselbe Zeichenkette steht in
 * `katalog.generiert.ts` und in jedem Protokolleintrag. Uebersetzt waere sie
 * falsch, und als Literal im JSX-Text zaehlte die Uebersetzungswache sie zu
 * Recht als deutsches Wort mit — deshalb die Konstante.
 *
 * In den PRUEFUNGEN darunter steht dagegen das Literal, und zwar mit Absicht:
 * `tests/kern/verweis-rechte.test.ts` liest den Quelltext und erkennt eine
 * Bewachung nur an `darf['…']` beziehungsweise `haeltRechte(…, '…')`. Eine
 * Konstante dort waere fuer diese Pruefung unsichtbar — und eine Pruefung, die
 * ihren Gegenstand nicht mehr sieht, meldet still nichts.
 */
const RECHT = 'objekt.schreiben';


export const metadata = { title: 'Neues Objekt' };

export default async function ObjektNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/objekte/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(OBJEKTE_TEXTE, zugang.sprache);
  /*
   * Zwei Rechte, und das zweite ist der RUECKWEG. Er haengt am Recht seines
   * ZIELS, nicht am Recht dieser Seite (AUT-06, D-581): die Objektliste
   * verlangt `objekt.lesen`; wer es nicht haelt, bekommt dort 404 — und ein
   * Pfeil auf eine 404 verraet, was er nicht zeigen darf. In der Praxis haelt
   * jede Rolle mit `objekt.schreiben` auch `objekt.lesen`; „in der Praxis" ist
   * aber keine Pruefung.
   */
  const darf = await haeltRechte(zugang.sitzung, 'objekt.schreiben', 'objekt.lesen');
  const suche = await searchParams;
  /*
   * Der übersetzte Satz zum Schlüssel, sonst ein allgemeiner Satz — nie der
   * Schlüssel und nie Text aus der Adresse (V-153, V-240).
   */
  const grund = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const meldung = grund === null ? null : eigenerEintrag(t.fehler, grund) ?? t.fehlerSonst;

  /*
   * Die Kundenliste kommt aus derselben Gesellschaft und nur ungesperrt: ein
   * Objekt einem Kunden zuzuordnen, dem nichts mehr hinausgehen darf, waere
   * kein Fehler — aber ein Auswahlfeld, das JEDEN je erfassten Kunden fuehrt,
   * ist nach zwei Jahren unbenutzbar.
   */
  const kunden = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => kontext.abfrage<KundeAuswahl>(
      `select id, name from kunde
        where archiviert_am is null and status <> 'inaktiv'
        order by name`,
    ))) as Promise<readonly KundeAuswahl[]>);

  return (
    <PortalRahmen
      titel={t.neuTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['objekt.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/objekte`, text: t.alleObjekte } }
        : {})}
    >
      <h1 className="mb-s5 mt-0 text-h1 text-text">{t.neuTitel}</h1>

      {meldung !== null && (
        <Hinweis art="warnung" cse="objekt-meldung" className="mb-s5 max-w-prose">
          {meldung}
        </Hinweis>
      )}

      {darf['objekt.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrechtAnlegen}{' '}
          <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : (
        <ObjektFormular zurueck={pfad} kunden={kunden} t={t} />
      )}
    </PortalRahmen>
  );
}
