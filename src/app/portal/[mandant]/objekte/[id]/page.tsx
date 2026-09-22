import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { haeltRechte } from '../../../rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { OBJEKTE_TEXTE } from '@/lib/i18n/verwaltung/objekte';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../kennung';
import { Hinweis } from '@/components/ui/Hinweis';
import { modulAktiv } from '@/server/registry/modul';
import {
  REITER, istReiter, reiterZeilen, zaehler,
  type ReiterSchluessel, type UmfeldZeile, type Zaehler,
} from '@/server/services/objekt/umfeld';

/**
 * `/portal/[mandant]/objekte/[id]` — die Objektuebersicht (OPS-01, OPS-11).
 *
 * **Die zehn Reiter der Seitenkarte — und warum neun davon fehlten** (V-044).
 *
 * Hier stand: „Gebaut ist der, der in dieser Phase entsteht — das Raumbuch.
 * Die uebrigen haengen an Tabellen aus Phase 5 und 6." Das war richtig, als
 * es geschrieben wurde. Die Tabellen stehen laengst: `revier`, `posten`,
 * `dienstanweisung`, `schluessel`, `auftrag`, `einsatz`, `dokument` und
 * `qualitaetspruefung` tragen alle eine `objekt_id` — und von diesem Blatt
 * aus fuehrte kein Weg zu ihnen. Wer wissen wollte, welche Schluessel zu
 * diesem Haus gehoeren, musste die Schluesselliste oeffnen und dort filtern,
 * also wissen, dass es sie gibt.
 *
 * **Ein Reiter ist ein Recht, kein Vorschlag.** Er steht nur da, wenn das
 * Modul gebucht ist UND die Sitzung sein Leserecht haelt — nicht ausgegraut,
 * nicht mit „kein Zugriff": ein Reiter, der die Existenz dessen verraet, was
 * er nicht zeigen darf, ist derselbe Verstoss gegen AUT-06 wie ein Verweis,
 * der auf 404 fuehrt.
 *
 * **Die internen Notizen stehen NICHT in dieser Abfrage.** `bemerkung` und
 * `zutritt_hinweis` sind `cse_app` entzogen (K-05); sie kommen ueber
 * `app.objekt_notiz_lesen`, das Bereich und Recht selbst prueft.
 */
export const dynamic = 'force-dynamic';

interface ObjektKopf {
  readonly id: string;
  readonly objektnummer: string;
  readonly bezeichnung: string;
  readonly gebaeudetyp: string | null;
  readonly strasse: string;
  readonly hausnummer: string | null;
  readonly adresszusatz: string | null;
  readonly plz: string;
  readonly ort: string;
  readonly etagen_anzahl: number | null;
  readonly kunde: string | null;
  readonly ansprechpartner: string | null;
  readonly flaeche: string | null;
  readonly raeume: string;
  readonly archiviert: boolean;
}

interface Notiz {
  readonly bemerkung: string | null;
  readonly zutritt_hinweis: string | null;
}

function Feld({ label, children }: {
  readonly label: string; readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
      <dd className="m-0 mt-s1 text-sm text-text">{children}</dd>
    </div>
  );
}

export default async function ObjektDetail(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const gewaehlt = typeof suche['reiter'] === 'string' ? suche['reiter'] : null;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/objekte/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  const darf = await haeltRechte(
    sitzung, 'objekt.schreiben',
    ...REITER.map((r) => r.recht).filter((r): r is string => r !== null));
  const tObjekt = nachSprache(OBJEKTE_TEXTE, zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<ObjektKopf>(
        `select o.id, o.objektnummer, o.bezeichnung, o.gebaeudetyp,
                o.strasse, o.hausnummer, o.adresszusatz, o.plz, o.ort, o.etagen_anzahl,
                k.name as kunde,
                nullif(trim(coalesce(ap.vorname,'') || ' ' || ap.nachname), '')
                  as ansprechpartner,
                r.flaeche::text as flaeche, coalesce(r.raeume, 0)::text as raeume,
                (o.archiviert_am is not null) as archiviert
           from objekt o
           left join kunde k on k.id = o.kunde_id
           left join ansprechpartner ap on ap.id = o.ansprechpartner_id
           left join lateral (
                  select sum(flaeche_qm) as flaeche, count(*) as raeume
                    from raum where raum.objekt_id = o.id and raum.archiviert_am is null
                ) r on true
          where o.id = $1`,
        [id],
      );
      if (kopf === undefined) return null;
      /**
       * Nur im internen Portal ueberhaupt FRAGEN.
       *
       * `app.objekt_notiz_lesen` wirft ausserhalb — richtig so, das ist die
       * K-04-Decke in der Funktion selbst. Die Portal-Decke im Tor schickt
       * eine Mitarbeitersitzung schon vorher nach `/portal/mein`, diese Seite
       * also erreicht sie nicht. Sich darauf zu VERLASSEN hiesse, die
       * Korrektheit dieser Datei an einer entfernten Weiterleitung
       * festzumachen: aendert die sich, steht hier ein 500 statt einer Seite
       * ohne Notiz. Die Bedingung steht deshalb da, wo sie gilt.
       */
      const intern = zugang.leiste.startsWith('intern');
      const [notiz] = intern
        ? await kontext.abfrage<Notiz>(
            `select bemerkung, zutritt_hinweis from app.objekt_notiz_lesen($1)`, [id],
          )
        : [];
      /*
       * **Die Modulbuchung in DERSELBEN Transaktion.** Sie entscheidet, ob
       * ein Reiter überhaupt gezeigt wird; eine zweite Rundreise dafür wäre
       * eine auf jedem Aufruf dieser Seite.
       */
      const [m] = await kontext.abfrage<{
        module: readonly string[] | null; module_gepflegt: boolean;
      }>(`select module, module_gepflegt from mandant where id = $1`,
        [sitzung.aktiverMandantId]);
      const buchung = {
        module: m?.module ?? [],
        gepflegt: m?.module_gepflegt ?? false,
      };
      return {
        kopf,
        notiz: notiz ?? null,
        buchung,
        zahlen: await zaehler(kontext, id),
      };
    })) as Promise<{
      kopf: ObjektKopf; notiz: Notiz | null;
      buchung: { module: readonly string[]; gepflegt: boolean };
      zahlen: Zaehler;
    } | null>);

  // Ein fremdes oder unbekanntes Objekt gibt dieselbe Antwort — 404, nie 403.
  if (daten === null) notFound();
  const { kopf, notiz, buchung, zahlen } = daten;

  /*
   * **Sichtbar ist ein Reiter nur mit Modul UND Recht** (AUT-06). Fehlt
   * eines, steht er nicht da — und ein Reiter aus der Adresszeile, den die
   * Sitzung nicht sehen darf, fällt auf die Übersicht zurück statt auf eine
   * Fehlerseite: die Adresse verrät sonst, dass es ihn gibt.
   */
  const sichtbar = REITER.filter(
    (r) => r.recht === null
      || (darf[r.recht] === true && modulAktiv(buchung, r.recht)));
  const aktiv: ReiterSchluessel =
    gewaehlt !== null && istReiter(gewaehlt)
      && sichtbar.some((r) => r.schluessel === gewaehlt)
      ? gewaehlt
      : 'uebersicht';

  const zeilen: readonly UmfeldZeile[] =
    aktiv === 'uebersicht' || aktiv === 'raumbuch'
      ? []
      : await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
        withTenant(tx, sitzung, (kontext) =>
          reiterZeilen(kontext, id, aktiv))) as Promise<readonly UmfeldZeile[]>);

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="objekte"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/objekte`, text: 'Alle Objekte' }}
    >
      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        <StatusPill zustand={kopf.archiviert ? 'Archiviert' : 'Aktiv'} />
        {darf['objekt.schreiben'] === true && !kopf.archiviert && (
          <Link
            href={`/portal/${mandant}/objekte/${id}/bearbeiten`}
            data-cse="objekt-bearbeiten"
            className="ml-auto inline-flex min-h-11 items-center rounded-md
                       border border-line-strong px-s4 text-sm text-text
                       hover:bg-surface-2"
          >
            {tObjekt.bearbeiten}
          </Link>
        )}
      </div>

      {/*
        * ═══════════════════════════════════════════════════════════════════
        * **Die Reiterleiste** (V-044, SEITENKARTE §5.4).
        * ═══════════════════════════════════════════════════════════════════
        *
        * `raumbuch` führt auf seine EIGENE Seite und nicht auf einen
        * Abfrageteil: dort steht die Kalkulation, nicht eine Liste. Die
        * übrigen wechseln den Inhalt dieses Blattes — die Seitenkarte führt
        * für sie keine eigene Route, und eine zu erfinden hiesse, acht
        * Adressen zu bauen, die im Manifest nicht stehen.
        *
        * Ein gewöhnliches `<a>` und kein `next/link`: `typedRoutes` prüft
        * `href` gegen die bekannten Routenmuster, und ein zusammengesetzter
        * Abfrageteil ist für den Typ keines (dieselbe Entscheidung wie im
        * Kachelraster).
        */}
      <nav aria-label={tObjekt.reiter['uebersicht']} className="mb-s5"
           data-cse="objekt-reiter">
        <ul className="m-0 flex list-none flex-wrap gap-s4 border-b border-line p-0 pb-s2">
          {sichtbar.map((r) => {
            const ziel = r.schluessel === 'raumbuch'
              ? `${pfad}/raumbuch`
              : r.schluessel === 'uebersicht' ? pfad : `${pfad}?reiter=${r.schluessel}`;
            const zahl = zahlen[r.schluessel];
            return (
              <li key={r.schluessel}>
                <a
                  href={ziel}
                  aria-current={r.schluessel === aktiv ? 'page' : undefined}
                  data-cse={`objekt-reiter-${r.schluessel}`}
                  className={r.schluessel === aktiv
                    ? 'text-sm font-semibold text-text no-underline'
                    : 'text-sm text-text-muted underline-offset-2 no-underline '
                      + 'hover:text-text hover:underline'}
                >
                  {tObjekt.reiter[r.schluessel] ?? r.schluessel}
                  {zahl === undefined ? null : (
                    <span className="ml-s2 text-xs tabular-nums text-text-subtle">
                      {zahl}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {aktiv !== 'uebersicht' && (
        <section className="mb-s6" data-cse={`objekt-liste-${aktiv}`}>
          <h2 className="mb-s3 mt-0 text-h3 text-text">
            {tObjekt.reiter[aktiv] ?? aktiv}
          </h2>
          {aktiv === 'einsaetze' ? (
            <p className="mb-s3 max-w-prose text-xs text-text-muted">
              {tObjekt.einsaetzeFenster}
            </p>
          ) : null}
          {zeilen.length === 0 ? (
            <Hinweis art="hinweis" cse="reiter-leer" className="max-w-prose">
              {tObjekt.reiterLeer}
            </Hinweis>
          ) : (
            <ul className="m-0 list-none rounded-lg border border-line bg-surface p-0">
              {zeilen.map((z) => (
                <li key={z.id}
                    className="flex flex-wrap items-baseline justify-between gap-s3
                               border-b border-line px-s4 py-s3 last:border-b-0">
                  <span className="text-sm text-text">{z.text}</span>
                  <span className="flex flex-wrap items-baseline gap-s3">
                    {z.neben === null ? null : (
                      <span className="text-xs tabular-nums text-text-muted">{z.neben}</span>
                    )}
                    {z.zustand === null ? null : (
                      <span className="text-xs text-text-subtle">{z.zustand}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {aktiv === 'uebersicht' && (
      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s5 sm:grid-cols-2 lg:grid-cols-3">
        <Feld label="Objektnummer">{kopf.objektnummer}</Feld>
        <Feld label="Anschrift">
          {`${kopf.strasse}${kopf.hausnummer === null ? '' : ` ${kopf.hausnummer}`}`}
          <br />
          {kopf.adresszusatz === null ? null : <>{kopf.adresszusatz}<br /></>}
          {`${kopf.plz} ${kopf.ort}`}
        </Feld>
        <Feld label="Gebäudetyp">
          {kopf.gebaeudetyp ?? <span className="text-text-subtle">nicht angegeben</span>}
        </Feld>
        <Feld label="Kunde">
          {kopf.kunde ?? <span className="text-text-subtle">ohne Kundenbezug</span>}
        </Feld>
        <Feld label="Ansprechpartner vor Ort">
          {kopf.ansprechpartner ?? <span className="text-text-subtle">keiner hinterlegt</span>}
        </Feld>
        <Feld label="Etagen">
          {kopf.etagen_anzahl === null
            ? <span className="text-text-subtle">nicht angegeben</span>
            : String(kopf.etagen_anzahl)}
        </Feld>
      </dl>

      )}

      {aktiv === 'uebersicht' && (
      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5">
        <h2 className="mt-0 text-h3 text-text">Raumbuch</h2>
        <p className="text-sm text-text-muted">
          {kopf.raeume === '0'
            ? 'Noch kein Raum erfasst — ohne Raumbuch lässt sich nichts kalkulieren.'
            : `${kopf.raeume} Räume, ${formatiereMenge(mengeAusPostgresOderNull(kopf.flaeche))} m²`}
        </p>
        <Link
          href={`/portal/${mandant}/objekte/${id}/raumbuch`}
          className="inline-flex min-h-11 items-center rounded-md bg-brand px-s4 text-sm text-white hover:bg-brand-hover"
        >
          Raumbuch und Kalkulation
        </Link>
      </section>

      )}

      {aktiv !== 'uebersicht' || notiz === null
        || (notiz.bemerkung === null && notiz.zutritt_hinweis === null) ? null : (
        <section className="rounded-lg border border-line bg-surface-2 p-s5">
          <h2 className="mt-0 text-h3 text-text">Intern</h2>
          <p className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Nur im internen Portal sichtbar
          </p>
          {notiz.zutritt_hinweis === null ? null : (
            <p className="text-sm text-text">
              <strong>Zutritt:</strong> {notiz.zutritt_hinweis}
            </p>
          )}
          {notiz.bemerkung === null ? null : (
            <p className="text-sm text-text">{notiz.bemerkung}</p>
          )}
        </section>
      )}
    </PortalRahmen>
  );
}
