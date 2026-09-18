import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  FACH_TEXT, gruppiere, leseZeitanker, listeWiedervorlagen,
  type Fachgruppe, type WiedervorlageZeile, type Zeitanker,
} from '@/server/services/crm/wiedervorlage';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';

/**
 * `/portal/[mandant]/crm/wiedervorlagen` — die Arbeitsliste des Vertriebs
 * (CRM-03, CRM-04).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Die Fälligkeit wird in BERLINER Kalendertagen gerechnet, und beide Seiten
 * des Vergleichs kommen aus der Datenbank.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `(faellig_am at time zone 'Europe/Berlin')::date` gegen
 * `app.berlin_heute()` — nie gegen `new Date()`. Die Uhr des Node-Prozesses
 * läuft in UTC; zwischen Mitternacht und 02:00 Berliner Zeit ist der UTC-Tag
 * noch der gestrige, und eine Wiedervorlage um 00:30 stünde unter
 * „Überfällig", bevor sie fällig war (K-11, Invariante 2).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Diese Seite ist die SICHT, nicht der Ort der Entstehung.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Angelegt werden Wiedervorlagen dort, wo sie entstehen — am Lead und am
 * Kontakt. Hier stehen zwei Vorgänge: „erledigt" (mit der Serverzeit) und
 * „verschieben" (mit Pflichtnotiz). Beide fassen die gespiegelte
 * `aufgabe`-Zeile mit an, sonst stünde derselbe Vorgang an einer Stelle offen
 * und an der anderen erledigt (O-663).
 */
export const dynamic = 'force-dynamic';

const FELD = 'min-h-11 rounded-md border border-line bg-surface px-s2 py-s1 text-xs '
  + 'text-text';

export default async function Wiedervorlagen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<{ wer?: string; meldung?: string; erfolg?: string }>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  /* `meine` ist die Vorgabe: die Liste beantwortet zuerst „was liegt bei MIR". */
  const nurMeine = suche.wer !== 'alle';
  const pfad = `/portal/${mandant}/crm/wiedervorlagen`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung,
    'crm.schreiben', 'system.benutzer_lesen', 'aufgabe.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      anker: await leseZeitanker(kontext),
      zeilen: await listeWiedervorlagen(kontext, { nurMeine }),
    }))) as Promise<{ anker: Zeitanker; zeilen: readonly WiedervorlageZeile[] }>);

  const gruppen: readonly Fachgruppe[] = gruppiere(daten.zeilen, daten.anker);
  const ueberfaellig = gruppen.find((g) => g.fach === 'ueberfaellig')?.zeilen.length ?? 0;
  const darfSchreiben = darf['crm.schreiben'] === true;

  const spalten = (fach: string) => [
    {
      schluessel: 'faellig', kopf: 'Fällig',
      zelle: (z: WiedervorlageZeile) => (
        <span className={fach === 'ueberfaellig'
          ? 'text-sm text-danger tabular-nums'
          : 'text-sm text-text tabular-nums'}>
          {z.faellig_text}
          {z.erinnerung_text === null ? null : (
            <span className="block text-xs text-text-muted">
              Erinnerung {z.erinnerung_text}
            </span>
          )}
        </span>
      ),
    },
    {
      schluessel: 'betreff', kopf: 'Was',
      zelle: (z: WiedervorlageZeile) => (
        <span>
          {z.betreff}
          {z.inhalt === null ? null : (
            <span className="block text-xs text-text-muted">{z.inhalt}</span>
          )}
        </span>
      ),
    },
    {
      schluessel: 'bezug', kopf: 'Wozu',
      zelle: (z: WiedervorlageZeile) => (z.lead_id !== null ? (
        <Link
          href={`/portal/${mandant}/crm/leads/${z.lead_id}`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          {z.lead_betreff ?? 'Lead'}
        </Link>
      ) : z.kunde_id !== null ? (
        <Link
          href={`/portal/${mandant}/crm/kunden/${z.kunde_id}`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          {z.kunde_name ?? 'Kunde'}
        </Link>
      ) : '—'),
    },
    {
      schluessel: 'kontakt', kopf: 'Mit wem',
      zelle: (z: WiedervorlageZeile) => (z.ansprechpartner_id === null ? '—' : (
        <Link
          href={`/portal/${mandant}/crm/kontakte/${z.ansprechpartner_id}`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          {z.ansprechpartner ?? 'Kontakt'}
        </Link>
      )),
    },
    {
      schluessel: 'wer', kopf: 'Zuständig',
      zelle: (z: WiedervorlageZeile) => (z.zustaendig ?? (
        z.zustaendig_benutzer_id === null
          ? <span className="text-warning">niemand zugewiesen</span>
          : (
            <span className="text-text-subtle" data-cse="zustaendig-verdeckt"
                  title="Dafür fehlt system.benutzer_lesen">—</span>
          )
      )),
    },
    ...(darfSchreiben ? [{
      schluessel: 'vorgang', kopf: 'Vorgang',
      zelle: (z: WiedervorlageZeile) => (
        <span className="flex flex-col gap-s2">
          <form method="post" action="/api/crm/wiedervorlage"
                data-cse="wv-erledigt-formular">
            <input type="hidden" name="was" value="erledigt" />
            <input type="hidden" name="id" value={z.id} />
            <input type="hidden" name="zurueck" value={`${pfad}?wer=${nurMeine ? 'meine' : 'alle'}`} />
            <button
              type="submit" data-cse="wv-erledigt"
              className="min-h-11 rounded-md border border-line-strong px-s3 py-s2 text-xs text-text hover:bg-surface-2"
            >
              Erledigt
            </button>
          </form>
          <form method="post" action="/api/crm/wiedervorlage"
                data-cse="wv-verschieben-formular"
                className="flex flex-wrap items-end gap-s2">
            <input type="hidden" name="was" value="verschieben" />
            <input type="hidden" name="id" value={z.id} />
            <input type="hidden" name="zurueck" value={`${pfad}?wer=${nurMeine ? 'meine' : 'alle'}`} />
            <input type="datetime-local" name="faelligAm" required className={FELD}
                   data-cse="wv-neues-datum" />
            <input name="grund" required placeholder="Grund" className={`${FELD} w-36`}
                   data-cse="wv-grund" />
            <button
              type="submit" data-cse="wv-verschieben"
              className="min-h-11 rounded-md border border-line-strong px-s3 py-s2 text-xs text-text hover:bg-surface-2"
            >
              Verschieben
            </button>
          </form>
        </span>
      ),
    }] : []),
  ];

  return (
    <PortalRahmen
      titel="Wiedervorlagen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s4 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">Wiedervorlagen</h1>
        <p className="m-0 text-sm text-text-muted" data-cse="wv-anzahl">
          {daten.zeilen.length === 1 ? '1 offen' : `${String(daten.zeilen.length)} offen`}
          {ueberfaellig === 0 ? '' : ` · ${String(ueberfaellig)} überfällig`}
        </p>
      </div>

      <p className="mb-s4 max-w-prose text-sm text-text-muted">
        Sortiert nach Fälligkeit, nicht nach Eingang. Heute ist der{' '}
        <span className="tabular-nums">{daten.anker.heute}</span> in Berliner Zeit —
        gerechnet in der Datenbank, nicht im Browser.
      </p>

      {/* Zwei Filter als GET-Verweise; kein JavaScript (wie bei den Nachträgen). */}
      <p className="mb-s5 flex flex-wrap gap-s3 text-sm" data-cse="wv-filter">
        <Link
          href={alsRoute(`${pfad}?wer=meine`)}
          aria-current={nurMeine ? 'page' : undefined}
          data-cse="filter-meine"
          className={nurMeine
            ? 'font-semibold text-text'
            : 'text-text-muted underline-offset-2 hover:text-text hover:underline'}
        >
          Nur meine
        </Link>
        <Link
          href={alsRoute(`${pfad}?wer=alle`)}
          aria-current={nurMeine ? undefined : 'page'}
          data-cse="filter-alle"
          className={nurMeine
            ? 'text-text-muted underline-offset-2 hover:text-text hover:underline'
            : 'font-semibold text-text'}
        >
          Alle im Bereich
        </Link>
      </p>

      {typeof suche.meldung === 'string' && suche.meldung !== '' ? (
        <Hinweis art="warnung" cse="wv-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {suche.meldung}
        </Hinweis>
      ) : null}
      {typeof suche.erfolg === 'string' && suche.erfolg !== '' ? (
        <Hinweis art="erfolg" cse="wv-erfolg" className="mb-s5 max-w-prose">
          {suche.erfolg}
        </Hinweis>
      ) : null}

      {daten.zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
           data-cse="wv-leer">
          {nurMeine
            ? 'Bei Ihnen liegt keine Wiedervorlage. Unter „Alle im Bereich" stehen die '
              + 'der Kollegen.'
            : 'In dieser Gesellschaft liegt keine offene Wiedervorlage. Angelegt werden '
              + 'sie am Lead und am Kontakt — dort, wo sie entstehen.'}
        </p>
      ) : (
        gruppen.map((g) => (
          <section key={g.fach} aria-labelledby={`fach-${g.fach}`} className="mb-s6"
                   data-cse="wv-fach" data-fach={g.fach}>
            <div className="mb-s3 flex flex-wrap items-center gap-s3">
              <h2 id={`fach-${g.fach}`} className="m-0 text-h3 text-text">
                {FACH_TEXT[g.fach]}
              </h2>
              {g.fach === 'ueberfaellig' && g.zeilen.length > 0 ? (
                <StatusPill zustand="Überfällig" />
              ) : null}
              <span className="text-sm text-text-muted" data-cse="wv-fach-anzahl">
                {g.zeilen.length === 0 ? 'keine' : String(g.zeilen.length)}
              </span>
            </div>
            {g.zeilen.length === 0 ? (
              <p className="text-sm text-text-muted">
                {g.fach === 'ueberfaellig'
                  ? 'Nichts liegt über der Frist.'
                  : 'Nichts in diesem Zeitraum.'}
              </p>
            ) : (
              <DataTable
                beschriftung={`Wiedervorlagen: ${FACH_TEXT[g.fach]}`}
                zeilen={g.zeilen}
                schluessel={(z) => z.id}
                spalten={spalten(g.fach)}
              />
            )}
          </section>
        ))
      )}

      {darf['system.benutzer_lesen'] === true ? null : (
        <p className="mt-s5 max-w-prose text-xs text-text-muted" data-cse="wv-namen-hinweis">
          Die Namen der Zuständigen sind Ihnen nicht sichtbar — dafür fehlt
          <code className="text-text"> system.benutzer_lesen</code>. Ein „—" in dieser
          Spalte heisst deshalb nicht „niemand zuständig"; wo wirklich niemand
          eingetragen ist, steht es in Worten.
        </p>
      )}

      {!darfSchreiben ? (
        <p className="mt-s5 max-w-prose text-xs text-text-muted">
          Erledigen und Verschieben brauchen <code className="text-text">crm.schreiben</code>.
        </p>
      ) : (
        <p className="mt-s5 max-w-prose text-xs text-text-muted">
          „Erledigt" stempelt die <strong>Serverzeit</strong> — nie die Uhr dieses
          Geräts (Invariante 5). „Verschieben" verlangt einen Grund und hält die
          Verschiebung als eigene Notiz im Verlauf: sonst stünde später nur das letzte
          Datum da, und dass es das vierte war, wüsste niemand.
          {darf['aufgabe.lesen'] === true ? (
            <>
              {' '}Beide fassen die gespiegelte Aufgabe mit an (O-663) — sonst wäre
              derselbe Vorgang hier erledigt und in{' '}
              <Link href={`/portal/${mandant}/aufgaben`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline">
                den Aufgaben
              </Link>{' '}
              noch offen.
            </>
          ) : null}
        </p>
      )}
    </PortalRahmen>
  );
}
