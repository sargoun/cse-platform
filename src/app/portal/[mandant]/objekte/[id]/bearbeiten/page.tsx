import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { OBJEKTE_TEXTE } from '@/lib/i18n/verwaltung/objekte';
import { ObjektFormular, type KundeAuswahl, type ObjektWerte }
  from '../../ObjektFormular';
import { Recht } from '@/components/ui/Recht';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/objekte/[id]/bearbeiten` — ein Objekt ändern oder
 * archivieren (OPS-01, V-020).
 *
 * **Warum das eine eigene Seite ist und kein Formular auf dem Objektblatt.**
 * Das Blatt ist die Übersicht: Anschrift, Kunde, Raumbuch, Einsätze. Ein
 * Formular mitten hinein zu setzen hiesse, dass jeder, der etwas nachschlägt,
 * in einem Änderungsmodus steht — und ein versehentlicher Tastendruck ändert
 * die Anschrift eines Objekts, auf das morgen früh vier Kräfte fahren.
 *
 * **Archivieren steht ganz unten, getrennt, mit eigener Begründung.** Es ist
 * die einzige Handlung hier, die nicht rückgängig zu machen ist, und sie soll
 * nicht neben „Speichern" liegen.
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


export const metadata = { title: 'Objekt bearbeiten' };

interface ObjektZeile {
  readonly id: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly land: string;
  readonly kunde_id: string | null;
  readonly gebaeudetyp: string | null;
  readonly etagen_anzahl: number | null;
  readonly zutritt_hinweis: string | null;
  readonly bemerkung: string | null;
  readonly geo_lat: string | null;
  readonly geo_lon: string | null;
  readonly archiviert: boolean;
}

export default async function ObjektBearbeiten(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id: roh } = await params;
  const id = kennungOder404(roh);
  const pfad = `/portal/${mandant}/objekte/${id}/bearbeiten`;
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
   * Der übersetzte Satz zum Schlüssel, sonst der deutsche Satz des Dienstes
   * (V-170) — nie der Schlüssel selbst.
   */
  const grund = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const satz = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const meldung = eigenerEintrag(t.fehler, grund) ?? satz;

  const geladen = await db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      /*
       * `zutritt_hinweis` und `bemerkung` sind `cse_app` als SPALTE entzogen
       * (0021, K-05): wo der Schluessel liegt, steht nicht in jeder Abfrage.
       * Hier standen sie direkt im `select`, und die Seite endete fuer jeden
       * Aufruf mit „permission denied for table objekt" — gefunden vom
       * Durchlauf durch den Produktionsbau. Gelesen werden sie ueber den
       * K-05-Leser `app.objekt_notiz_lesen`, der Portal, Bereich und
       * `objekt.lesen` selbst prueft.
       */
      const [objekt] = await kontext.abfrage<ObjektZeile>(
        `select o.id, o.objektnummer, o.bezeichnung, o.strasse, o.hausnummer,
                o.adresszusatz, o.plz, o.ort, o.land, o.kunde_id, o.gebaeudetyp,
                o.etagen_anzahl, n.zutritt_hinweis, n.bemerkung,
                o.geo_lat::text as geo_lat, o.geo_lon::text as geo_lon,
                (o.archiviert_am is not null) as archiviert
           from objekt o
           left join lateral app.objekt_notiz_lesen(o.id) n on true
          where o.id = $1::uuid`,
        [id],
      );
      const kunden = await kontext.abfrage<KundeAuswahl>(
        `select id, name from kunde
          where archiviert_am is null and status <> 'inaktiv'
          order by name`,
      );
      return { objekt, kunden };
    })) as { objekt: ObjektZeile | undefined; kunden: readonly KundeAuswahl[] };

  if (geladen.objekt === undefined) notFound();
  const o = geladen.objekt;

  const werte: ObjektWerte = {
    bezeichnung: o.bezeichnung,
    strasse: o.strasse,
    hausnummer: o.hausnummer,
    adresszusatz: o.adresszusatz,
    plz: o.plz,
    ort: o.ort,
    land: o.land,
    kundeId: o.kunde_id,
    gebaeudetyp: o.gebaeudetyp,
    etagenAnzahl: o.etagen_anzahl,
    zutrittHinweis: o.zutritt_hinweis,
    bemerkung: o.bemerkung,
    geoLat: o.geo_lat,
    geoLon: o.geo_lon,
  };

  return (
    <PortalRahmen
      titel={t.bearbeitenTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['objekt.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/objekte/${id}`, text: o.bezeichnung } }
        : {})}
    >
      <h1 className="mb-s2 mt-0 text-h1 text-text">{o.bezeichnung}</h1>
      <p className="mb-s5 mt-0 text-sm text-text-muted">
        {t.objektnummer}{' '}
        <strong className="font-mono">{o.objektnummer}</strong> — {t.nummerBleibt}
      </p>

      {meldung !== null && (
        <Hinweis art="warnung" cse="objekt-meldung" className="mb-s5 max-w-prose">
          {meldung}
        </Hinweis>
      )}

      {o.archiviert && (
        <Hinweis art="hinweis" cse="objekt-archiviert" className="mb-s5 max-w-prose">
          {t.istArchiviert}
        </Hinweis>
      )}

      {darf['objekt.schreiben'] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrechtAendern}{' '}
          <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : o.archiviert ? null : (
        <>
          <ObjektFormular zurueck={pfad} objektId={id} werte={werte}
                          kunden={geladen.kunden} t={t} />

          <Card className="mt-s6 max-w-[56ch] border-danger">
            <h2 className="mb-s3 mt-0 text-h3 text-text">{t.archivieren}</h2>
            <p className="mb-s4 mt-0 text-sm text-text-muted">
              {t.archivierenErklaerung}
            </p>
            <form method="post" action="/api/objekt" data-cse="objekt-archivieren">
              <input type="hidden" name="zurueck" value={pfad} />
              <input type="hidden" name="aktion" value="archivieren" />
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variante="danger">{t.archivierenKnopf}</Button>
            </form>
          </Card>
        </>
      )}
    </PortalRahmen>
  );
}
