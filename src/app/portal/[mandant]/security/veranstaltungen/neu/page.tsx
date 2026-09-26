import type postgres from 'postgres';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { VERANSTALTUNG_TEXTE } from '@/lib/i18n/verwaltung/security';
import {
  VeranstaltungFormular,
  type KundeAuswahl, type LeistungAuswahl, type LeitungAuswahl, type ObjektAuswahl,
} from '../../VeranstaltungFormular';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/security/veranstaltungen/neu` — eine Veranstaltung
 * erfassen (V-004, SEC-08).
 *
 * **Warum diese Seite fehlte.** `einsatz_quelle` kennt `veranstaltung` als
 * einen von sechs Ursprüngen; eine Zeile entstand aber ausschliesslich im
 * Seed — der dritte Einsatz-Ursprung war tot. Liste, Blatt und
 * Besetzungstafel waren für ein neues Event unerreichbar.
 *
 * **Vier Auswahllisten, drei davon hinter FREMDEN Rechten.** Die Kunden
 * stehen hinter `crm.lesen`, die Objekte hinter `objekt.lesen`, die
 * Wachleitung hinter `personal.lesen`. Diese Seite liegt hinter
 * `security.schreiben`; ohne die anderen bleiben die Listen leer, und leer
 * sieht aus wie „nichts erfasst". Deshalb sagt die Seite je Liste, ob sie
 * leer ist oder ungeprüft (AUT-06).
 */
export const dynamic = 'force-dynamic';

const RECHT_SCHREIBEN = 'security.schreiben';
const RECHT_CRM = 'crm.lesen';
const RECHT_OBJEKT = 'objekt.lesen';

export const metadata = { title: 'Neue Veranstaltung' };

export default async function VeranstaltungNeu(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/security/veranstaltungen/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(VERANSTALTUNG_TEXTE, zugang.sprache);

  const darf = await haeltRechte(
    zugang.sitzung, 'security.schreiben', 'security.lesen',
    'crm.lesen', 'objekt.lesen', 'personal.lesen');
  const suche = await searchParams;
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const kunden = darf['crm.lesen'] !== true ? [] : await kontext.abfrage<KundeAuswahl>(
        `select id, name from kunde
          where archiviert_am is null and status <> 'inaktiv'
          order by name limit 500`);
      const objekte = darf['objekt.lesen'] !== true ? [] : await kontext.abfrage<ObjektAuswahl>(
        `select id, bezeichnung from objekt
          where archiviert_am is null order by bezeichnung limit 500`);
      const leitungen = darf['personal.lesen'] !== true ? []
        : await kontext.abfrage<LeitungAuswahl>(
          `select a.id, (p.nachname || ', ' || p.vorname) as name
             from anstellung a join person p on p.id = a.person_id
            where a.geloescht_am is null and a.status = 'aktiv'
            order by p.nachname, p.vorname limit 500`);
      /*
       * Die Auftragspositionen sind FREIWILLIG (O-703) und liegen hinter
       * `auftrag.lesen` — ein Recht, das diese Seite nicht verlangt. Statt
       * eine sechste Rechtefrage zu stellen, laeuft die Abfrage einfach mit:
       * unter RLS liefert sie ohne das Recht keine Zeile, und „keine
       * Position" ist hier eine gueltige Antwort, weil das Feld leer bleiben
       * darf.
       */
      const leistungen = await kontext.abfrage<LeistungAuswahl>(
        `select al.id, al.bezeichnung, a.auftragsnummer
           from auftrag_leistung al
           join auftrag a on a.id = al.auftrag_id
          where a.status <> 'storniert'
            and (al.gueltig_bis is null or al.gueltig_bis >= app.berlin_heute())
          order by a.auftragsnummer desc, al.position_nr limit 300`);
      return { kunden, objekte, leitungen, leistungen };
    })) as Promise<{
      kunden: readonly KundeAuswahl[];
      objekte: readonly ObjektAuswahl[];
      leitungen: readonly LeitungAuswahl[];
      leistungen: readonly LeistungAuswahl[];
    }>);

  return (
    <PortalRahmen
      titel={t.neuTitel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="security"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['security.lesen'] === true
        ? {
          zurueck: {
            ziel: `/portal/${mandant}/security/veranstaltungen`,
            text: t.alleVeranstaltungen,
          },
        }
        : {})}
    >
      <h1 className="mb-s5 mt-0 text-h1 text-text">{t.neuTitel}</h1>

      {meldung !== null && (
        <Hinweis art="warnung" cse="veranstaltung-meldung" className="mb-s5 max-w-prose">
          {meldung}
        </Hinweis>
      )}

      {darf['security.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrechtAnlegen}{' '}
          <Recht schluessel={RECHT_SCHREIBEN} sprache={zugang.sprache} />.
        </Hinweis>
      ) : daten.kunden.length === 0 ? (
        <Hinweis art="warnung" cse="veranstaltung-ohne-kunde" className="max-w-prose">
          {darf['crm.lesen'] === true ? t.keinKunde : t.keinSchreibrechtAnlegen}{' '}
          {darf['crm.lesen'] !== true && (
            <Recht schluessel={RECHT_CRM} sprache={zugang.sprache} />
          )}
        </Hinweis>
      ) : (
        <>
          {darf['objekt.lesen'] !== true && (
            <Hinweis art="hinweis" cse="ohne-objektrecht" className="mb-s5 max-w-prose">
              {t.ortErklaerung}{' '}
              <Recht schluessel={RECHT_OBJEKT} sprache={zugang.sprache} />
            </Hinweis>
          )}
          <VeranstaltungFormular
            zurueck={pfad}
            kunden={daten.kunden}
            objekte={daten.objekte}
            leitungen={daten.leitungen}
            leistungen={daten.leistungen}
            t={t}
          />
        </>
      )}
    </PortalRahmen>
  );
}
