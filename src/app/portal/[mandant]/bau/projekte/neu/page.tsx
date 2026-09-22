import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { PROJEKT_TEXTE } from '@/lib/i18n/verwaltung/bau';
import { auftraegeOhneProjekt } from '@/server/services/bau/projekt';
import {
  ProjektFormular, type AuftragAuswahl, type BauleitungAuswahl,
} from '../../ProjektFormular';

/**
 * `/portal/[mandant]/bau/projekte/neu` — ein Bauvorhaben anlegen
 * (V-003, OPS-05, BAU-01).
 *
 * **Warum diese Seite fehlte und was daran teuer war.** Zwanzig gebaute
 * Projektseiten — Leistungsverzeichnis, Aufmass, Nachträge, Bautagebuch,
 * Behinderungsanzeige, Abnahme — hingen an einer Zeile, die ausschliesslich
 * im Seed entstand. Für ein neues Vorhaben war der gesamte Bauteil der
 * Plattform unerreichbar.
 *
 * **Die Auftragsliste ist die eigentliche Aussage dieser Seite.** Sie führt
 * nur Aufträge OHNE Bauakte (`projekt_auftrag_uk`) und keine stornierten. Ist
 * sie leer, ist das keine kaputte Abfrage, sondern die Antwort: erst der
 * Auftrag, dann das Vorhaben — und die Seite sagt es als Satz.
 */
export const dynamic = 'force-dynamic';

/**
 * Die Rechteschlüssel, wie sie dem Menschen ANGEZEIGT werden — Daten, keine
 * Beschriftung. In den Prüfungen unten steht dagegen das Literal, weil
 * `tests/kern/verweis-rechte.test.ts` den Quelltext liest und eine Bewachung
 * nur an `haeltRechte(…, '…')` erkennt.
 */
const RECHT_SCHREIBEN = 'bau.schreiben';

export const metadata = { title: 'Neues Bauvorhaben' };

export default async function ProjektNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/bau/projekte/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(PROJEKT_TEXTE, zugang.sprache);

  /*
   * Zwei Rechte: `bau.schreiben` entscheidet, ob das Formular etwas bewirken
   * kann, `bau.lesen`, ob der Rueckweg auf die Projektliste gezeigt werden
   * darf (AUT-06, D-581).
   */
  const darf = await haeltRechte(zugang.sitzung, 'bau.schreiben', 'bau.lesen');
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const auftraege = await auftraegeOhneProjekt(kontext);
      /*
       * Die Bauleitung aus DIESER Gesellschaft. `projekt.
       * verantwortlich_benutzer_id` zeigt auf `benutzer`; eine Liste ueber
       * alle Konten boete Menschen an, die hier nicht arbeiten.
       */
      const bauleitung = await kontext.abfrage<BauleitungAuswahl>(
        `select b.id, b.name from benutzer b
           join benutzer_mandant bm on bm.benutzer_id = b.id
          where bm.mandant_id = app.aktiver_mandant()
            and bm.entzogen_am is null and b.status = 'aktiv'
          order by b.name`);
      return { auftraege, bauleitung };
    })) as Promise<{
      auftraege: readonly AuftragAuswahl[];
      bauleitung: readonly BauleitungAuswahl[];
    }>);

  return (
    <PortalRahmen
      titel={t.neuTitel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['bau.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/bau/projekte`, text: t.alleProjekte } }
        : {})}
    >
      <h1 className="mb-s5 mt-0 text-h1 text-text">{t.neuTitel}</h1>

      {meldung !== null && (
        <Hinweis art="warnung" cse="projekt-meldung" className="mb-s5 max-w-prose">
          {meldung}
        </Hinweis>
      )}

      {darf['bau.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrechtAnlegen}{' '}
          <code className="font-mono">{RECHT_SCHREIBEN}</code>.
        </Hinweis>
      ) : daten.auftraege.length === 0 ? (
        <Hinweis art="warnung" cse="projekt-ohne-auftrag" className="max-w-prose">
          {t.keinAuftrag}
        </Hinweis>
      ) : (
        <ProjektFormular
          zurueck={pfad}
          auftraege={daten.auftraege}
          bauleitung={daten.bauleitung}
          t={t}
        />
      )}
    </PortalRahmen>
  );
}
