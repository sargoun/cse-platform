import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  ladeFreigabestand, ladeZugriffe,
} from '@/server/services/dokument/kundenfreigabe';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { SupabaseSpeicher } from '@/server/storage/adapter';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { formatiereBytes, KATEGORIE } from '../../darstellung';
import { FEHLERTEXT } from './daten';

/**
 * `/portal/[mandant]/dokumente/[id]/kundenfreigabe` — der Schalter
 * `sichtbar_fuer_kunde` (DOC-03, DOC-04).
 *
 * **Was dieser Schalter heute WIRKLICH tut — nachgemessen, nicht angenommen.**
 * Er ist die VORAUSSETZUNG der Kundensicht, nicht die Kundensicht selbst:
 * `dokument` traegt keine permissive `t_kunde`-Policy, und im echten
 * Kundenportal (`app.scope() = 'kunde'`) ist `app.aktiver_mandant()` NULL, so
 * dass `t_mandant` nicht greift. Ein Kundenkonto sieht dort also NULL
 * Dokumente, gleichgueltig wie der Schalter steht. Ob das Kundenportal einen
 * Dokumentweg bekommt, ist O-671 — und die Seite behauptet deshalb nicht, der
 * Kunde sehe das Dokument jetzt.
 *
 * **Und wo er wirkt, wirkte er zu weit.** Fuer ein Konto mit
 * `app.portal() = 'kunde'` im Mandanten-Scope entschied bisher allein
 * `p_kunde_ceiling` — und die kennt kein `kunde_id`. Gemessen gegen die
 * lebende Datenbank: ein Kundenkonto mit Zugang nur auf Kunde A sah das
 * freigegebene Dokument von Kunde B. Seit 0297 schliesst
 * `p_kunde_dokument_zuordnung` das; und darum weist diese Seite eine Freigabe
 * ohne Kundenzuordnung ab, statt sie stillschweigend zu speichern.
 *
 * **Das Zugriffsprotokoll steht MIT auf dieser Seite**, nicht nur auf der
 * Metadatenseite: eine Freigabe zurueckzunehmen bedeutet etwas anderes, wenn
 * schon jemand heruntergeladen hat. Die Datei ist dann draussen, und der
 * Schalter aendert daran nichts mehr.
 */
export const dynamic = 'force-dynamic';

export default async function Dokumentfreigabe(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/dokumente/${id}/kundenfreigabe`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'dokument.lesen', 'crm.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const stand = await ladeFreigabestand(kontext, id);
      if (stand === null) return null;
      const zugriffe = await ladeZugriffe(kontext, id);
      return { stand, zugriffe };
    })) as Promise<{
      stand: NonNullable<Awaited<ReturnType<typeof ladeFreigabestand>>>;
      zugriffe: Awaited<ReturnType<typeof ladeZugriffe>>;
    } | null>);

  if (daten === null) notFound();
  const { stand, zugriffe } = daten;
  const speicher = new SupabaseSpeicher();
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const ohneKunde = stand.kunde_id === null;

  return (
    <PortalRahmen
      titel={`Kundenfreigabe — ${stand.titel}`}
      wurzelTitel="Dokumente"
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['dokument.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/dokumente/${id}`, text: stand.titel } }
        : {})}
    >
      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">Kundenfreigabe</h1>
        <StatusPill zustand={stand.sichtbar_fuer_kunde ? 'Aktiv' : 'Inaktiv'} />
      </div>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="freigabe-fehler" className="mb-s5">
          <strong>Der Schalter wurde nicht umgelegt.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      {/* Was freigegeben wird, und wem ------------------------------------ */}
      <section aria-labelledby="was" className="mb-s6">
        <h2 id="was" className="text-h2 text-text">Was freigegeben wird</h2>
        <dl className="m-0 mt-s4 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3 rounded-lg border border-line bg-surface p-s5">
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Titel</dt>
          <dd className="m-0 text-sm text-text">{stand.titel}</dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Kategorie
          </dt>
          <dd className="m-0 text-sm text-text">
            <strong>{KATEGORIE[stand.kategorie] ?? stand.kategorie}</strong>
            <span className="block text-xs text-text-muted">
              Welche Kategorien einem Kunden überhaupt gezeigt werden dürfen, ist
              nicht entschieden — <strong>offen (O-736)</strong>. Die Datenbank
              prüft nur das Recht; die Kategorie steht deshalb hier groß.
            </span>
          </dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Dateityp</dt>
          <dd className="m-0 text-sm text-text">{stand.mime_typ ?? '—'}</dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Größe</dt>
          <dd className="m-0 cse-zahl text-sm text-text">{formatiereBytes(stand.groesse)}</dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Entstanden
          </dt>
          <dd className="m-0 text-sm text-text">{stand.entstanden}</dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 text-sm text-text">
            {stand.kunde === null || stand.kunde_id === null ? (
              <span className="text-warning">keine Kundenzuordnung</span>
            ) : darf['crm.lesen'] === true ? (
              <Link
                href={`/portal/${mandant}/crm/kunden/${stand.kunde_id}`}
                className="underline underline-offset-2 hover:underline"
              >
                {stand.kunde}
              </Link>
            ) : stand.kunde}
          </dd>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Objekt</dt>
          <dd className="m-0 text-sm text-text">{stand.objekt ?? '—'}</dd>
        </dl>
      </section>

      {/* Der Schalter ---------------------------------------------------- */}
      <section aria-labelledby="schalter" className="mb-s7">
        <h2 id="schalter" className="text-h2 text-text">Der Schalter</h2>

        {ohneKunde ? (
          <Hinweis art="warnung" cse="ohne-kunde" className="mt-s4">
            <strong>Ohne Kundenzuordnung gibt es keinen Kunden, dem dieses
            Dokument gehört.</strong> Die Freigabe wäre auf niemanden gerichtet
            — und ohne die Decke aus 0297 wäre sie auf <em>jeden</em> Kunden
            dieser Gesellschaft gerichtet. Beides ist ein Grund, sie hier
            abzuweisen statt sie zu speichern.
            {darf['dokument.lesen'] === true ? (
              <p className="mt-s3 mb-0">
                <Link
                  href={`/portal/${mandant}/dokumente/${id}`}
                  data-cse="zu-metadaten"
                  className="text-text underline underline-offset-2 hover:text-brand"
                >
                  Erst den Kunden in den Metadaten hinterlegen →
                </Link>
              </p>
            ) : null}
          </Hinweis>
        ) : nurLesen ? (
          <p data-cse="nur-lesen" className="mt-s4 text-sm text-text-muted">
            Die Gruppenansicht liest nur (Invariante 10) — hier wird nichts
            umgelegt.
          </p>
        ) : (
          <form
            method="post"
            action={`/api/dokumente/${id}/kundenfreigabe`}
            data-cse="freigabe-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input
              type="hidden"
              name="frei"
              value={stand.sichtbar_fuer_kunde ? 'nein' : 'ja'}
            />
            <input type="hidden" name="zurueck" value={pfad} />

            <p className="mb-s4 text-sm text-text">
              {stand.sichtbar_fuer_kunde
                ? 'Dieses Dokument ist für den Kunden freigegeben. Die Rücknahme sperrt es wieder — sie holt es nicht zurück, wenn es schon geholt wurde.'
                : 'Dieses Dokument ist nicht freigegeben. Die Freigabe ist die Voraussetzung dafür, dass es ein Kunde je sehen kann.'}
            </p>

            <label className="block text-sm text-text" htmlFor="grund">
              Grund
            </label>
            <textarea
              id="grund"
              name="grund"
              rows={3}
              required
              placeholder={stand.sichtbar_fuer_kunde
                ? 'z. B. falsche Fassung, ersetzt durch Rev. 2'
                : 'z. B. Leistungsnachweis Februar, auf Anforderung des Kunden'}
              className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />
            <p className="mt-s1 text-xs text-text-muted">
              Der Grund landet im <strong>Prüfprotokoll</strong>, nicht in einer
              Spalte: <code>dokument</code> hat kein Feld dafür, und eines zu
              erfinden wäre eine Schemaänderung für etwas, das ins Audit gehört.
            </p>

            <button
              type="submit"
              data-cse={stand.sichtbar_fuer_kunde ? 'freigabe-zurueck' : 'freigabe-setzen'}
              className={stand.sichtbar_fuer_kunde
                ? 'mt-s4 inline-flex min-h-11 items-center rounded-md border border-line px-s5 text-sm text-text hover:bg-surface-2'
                : 'mt-s4 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover'}
            >
              {stand.sichtbar_fuer_kunde
                ? 'Freigabe zurücknehmen'
                : 'Für den Kunden freigeben'}
            </button>
          </form>
        )}

        <Hinweis art="hinweis" cse="o671" className="mt-s4">
          <strong>Was die Freigabe heute bewirkt.</strong> Sie ist die
          Voraussetzung, nicht der Weg: das Kundenportal hat noch keinen
          Dokumentpfad — <code>dokument</code> trägt keine permissive
          Kundenrichtlinie, und ein Konto im Kundenportal sieht deshalb{' '}
          <em>null</em> Dokumente, wie dieser Schalter auch steht. Ob Anlagen
          dort herunterladbar werden, ist <strong>offen (O-671)</strong>. Wo die
          Freigabe wirkt, wirkt sie seit 0297 nur für <strong>diesen</strong>{' '}
          Kunden.
        </Hinweis>
      </section>

      {/* Das Zugriffsprotokoll ------------------------------------------- */}
      <section aria-labelledby="protokoll" className="mb-s6">
        <h2 id="protokoll" className="text-h2 text-text">
          Wer die Datei geholt hat
        </h2>
        <p className="mb-s4 max-w-[72ch] text-sm text-text-muted">
          {Number(stand.zugriffe) === 0
            ? 'Noch kein Abruf vermerkt.'
            : `${stand.zugriffe} Abruf(e) vermerkt.`}{' '}
          Das zählt: eine Freigabe zurückzunehmen bedeutet etwas anderes, wenn
          schon jemand heruntergeladen hat — die Datei ist dann draußen, und der
          Schalter ändert daran nichts mehr.
        </p>
        {zugriffe.length === 0 ? (
          <p
            data-cse="zugriffe-leer"
            className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
          >
            Kein Eintrag. Vermerkt wird beim Abruf über die signierte Adresse;
            {speicher.verbunden
              ? ' der Dateispeicher ist verbunden, es kann also Abrufe geben.'
              : ' der Dateispeicher ist nicht verbunden, es kann deshalb keine geben.'}
          </p>
        ) : (
          <DataTable
            beschriftung="Abrufe dieser Datei, neueste zuerst"
            zeilen={zugriffe}
            schluessel={(z) => z.id}
            spalten={[
              { schluessel: 'wann', kopf: 'Zeitpunkt', zelle: (z) => z.zeitpunkt },
              { schluessel: 'art', kopf: 'Art', zelle: (z) => z.art },
              {
                schluessel: 'wer', kopf: 'Konto',
                zelle: (z) => z.benutzer ?? (
                  <span className="text-text-subtle">ohne Konto</span>
                ),
              },
            ]}
          />
        )}
        <p className="mt-s3 text-xs text-text-muted">
          Zeiten in Europe/Berlin, gespeichert in UTC (Invariante 2).
        </p>
      </section>

      <Hinweis art="hinweis" cse="doc03">
        <strong>Kein Download aus einem öffentlichen Pfad (DOC-03).</strong> Jede
        Datei geht über eine signierte Adresse, die nach 15 Minuten verfällt —
        und zwar <em>nach</em> der Berechtigungsentscheidung, nicht davor. Die
        Freigabe entscheidet, <em>ob</em> jemand fragen darf; die Adresse gibt
        nichts preis, was diese Entscheidung nicht deckt.
      </Hinweis>
    </PortalRahmen>
  );
}
