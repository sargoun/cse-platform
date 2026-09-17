import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import {
  findeLvPosition, ladeAufmasseJePosition, ladeLvPfad, ladeNachtraegeJePosition,
  positionsBetragCent,
  type AufmassAufPosition, type LvAhne, type LvPositionDetail, type NachtragAufPosition,
} from '@/server/services/bau/lv';
import { formatiereErgebnis } from '@/server/services/bau/aufmass';
import { AUFMASS_PILLE, AUFMASS_STATUS_TEXT } from '../../../../aufmass-anzeige';
import { NACHTRAG_PILLE, NACHTRAG_STATUS_TEXT } from '../../../../nachtrag-anzeige';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { haeltRechte } from '@/app/portal/rechte';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../../kennung';

/**
 * `/portal/[mandant]/bau/projekte/[id]/lv/[ozId]` — eine LV-Position im
 * Detail (BAU-01, BAU-05, Seitenkarte §5.9).
 *
 * Drei Dinge stehen hier und nirgends sonst:
 *
 *  1. **Der vollständige Langtext.** Im OZ-Baum steht der Kurztext, weil
 *     vierhundert Langtexte keine Tabelle sind. Der Langtext ist aber das,
 *     was geschuldet ist — im Streit über „war das im Leistungsumfang?" ist
 *     genau er die Antwort.
 *  2. **Aufgemessen gegen Vertragsmenge** (BAU-05). Die Gegenüberstellung mit
 *     den Blättern, die darauf buchen, und eine Warnung, sobald die
 *     Vertragsmenge überschritten ist. Eine Mehrmenge kann nach § 2 Abs. 3
 *     VOB/B einen neuen Einheitspreis begründen — aber nur, wenn sie jemand
 *     bemerkt, solange abgerechnet wird. **Die Seite rechnet keine Schwelle
 *     aus**: sie warnt bei jeder Überschreitung und sagt daneben, dass über
 *     das Ob und das Ab-wann der Vertrag entscheidet. Eine hier eingebaute
 *     Prozentgrenze wäre eine erfundene Vertragsklausel.
 *  3. **Die Herkunft.** Kam die Position aus einem Import, stehen Seite,
 *     Bereich und Konfidenz da, und solange sie unbestätigt ist, trägt kein
 *     Aufmass darauf (APR-03, K-10). Der Knopf, der das behebt, hängt an
 *     `bau.schreiben` — und erscheint nur, wenn dieses Recht gehalten wird
 *     (AUT-06, `haeltRechte`).
 *
 * **Der Einheitspreis kommt über `app.lv_preis_lesen`**, nicht aus der Spalte
 * (K-05, §1.9). Ohne `bau.preis_lesen` steht hier der ausdrückliche Hinweis
 * und nie eine 0 €.
 */
export const dynamic = 'force-dynamic';

const ART_TEXT: Readonly<Record<string, string>> = {
  los: 'Los', titel: 'Titel', untertitel: 'Untertitel',
  position: 'Position', hinweistext: 'Hinweistext',
};

const POSITIONSART_TEXT: Readonly<Record<string, string>> = {
  unbestimmt: 'unbestimmt',
  normalposition: 'Normalposition',
  bedarfsposition: 'Bedarfsposition',
  alternativposition: 'Alternativposition',
  zuschlagsposition: 'Zuschlagsposition',
  grundposition: 'Grundposition',
};

const LV_ART_TEXT: Readonly<Record<string, string>> = {
  hauptauftrag: 'Hauptauftrag', nachtrag: 'Nachtrags-LV',
  ausschreibung: 'Ausschreibung', eigenkalkulation: 'Eigenkalkulation',
};

const BEZUG_TEXT: Readonly<Record<string, string>> = {
  nachtrags_lv: 'Position steht im Nachtrags-LV',
  auftragszeile: 'gleiche Auftragszeile',
  aufmasszeile: 'Aufmaßzeile diesem Nachtrag zugeordnet',
};

/**
 * Zählt diese Positionsart in die Auftragssumme?
 *
 * Dieselbe Aussage wie `zaehltInSumme` im Dienst — hier auf der Positionsart
 * statt auf der Zeile, weil die Detailseite keinen `LvZeile`-Satz baut.
 * **Der Text daneben ist WORTGLEICH mit dem im LV-Baum**: zwei Seiten, die
 * dasselbe Feld verschieden beschriften, sind zwei verschiedene Aussagen über
 * denselben Vertrag.
 * // TODO(client, O-155): Welche Positionsarten kommen vor, und wie geht jede
 * in die Angebots- bzw. Auftragssumme ein?
 */
function zaehltArtInSumme(positionsart: string): boolean {
  return positionsart !== 'bedarfsposition' && positionsart !== 'alternativposition';
}

export default async function LvPositionSeite(
  { params }: { params: Promise<{ mandant: string; id: string; ozId: string }> },
) {
  const { mandant, id, ozId } = await params;
  kennungOder404(id);
  kennungOder404(ozId);
  const pfad = `/portal/${mandant}/bau/projekte/${id}/lv/${ozId}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  const darf = await haeltRechte(sitzung, 'bau.schreiben');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const position = await findeLvPosition(kontext, ozId);
      if (position === null) return null;
      // Eine Position eines ANDEREN Projekts ist unter dieser Adresse nicht
      // vorhanden — nicht verboten (AUT-06).
      if (position.projekt_id !== id) return null;
      return {
        position,
        ahnen: await ladeLvPfad(kontext, ozId),
        aufmasse: await ladeAufmasseJePosition(kontext, ozId),
        nachtraege: await ladeNachtraegeJePosition(kontext, ozId),
      };
    }),
  ) as Promise<{
    position: LvPositionDetail;
    ahnen: readonly LvAhne[];
    aufmasse: readonly AufmassAufPosition[];
    nachtraege: readonly NachtragAufPosition[];
  } | null>);

  if (daten === null) notFound();
  const { position: p } = daten;

  /**
   * `MilliMenge` ist eine SKALIERTE GANZZAHL (`bigint`, 10⁻³ der Einheit) —
   * keine Gleitkommazahl. Verglichen und formatiert wird sie als solche;
   * `25,000` gegen `25,000` entschied über `number` gelegentlich falsch.
   */
  const vertrag = p.menge_vertrag === null
    ? null : mengeAusPostgresOderNull(p.menge_vertrag);
  const aufgemessen = mengeAusPostgresOderNull(p.menge_aufgemessen);
  const betrag = positionsBetragCent(
    p.menge_vertrag, p.einheitspreis_cent === null ? null : BigInt(p.einheitspreis_cent));
  const ungeprueftMaschinell = p.konfidenz !== null && p.geprueft_lokal === null;
  /**
   * Verglichen werden die skalierten Ganzzahlen, nicht ihre Anzeige: die
   * Σ kommt als `numeric(12,3)`-Text aus Postgres, und über
   * JavaScript-Gleitkommazahlen entschied `25,000 > 25,000` gelegentlich
   * falsch — also genau an der Kante, an der die Mehrmenge des § 2 Abs. 3
   * VOB/B beginnt.
   */
  const ueberschritten = vertrag !== null && aufgemessen > vertrag;

  return (
    <PortalRahmen
      titel={`LV-Position ${p.oz}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Pfad im Leistungsverzeichnis" className="mb-s3 text-sm text-text-muted">
        <Link
          href={`/portal/${mandant}/bau/projekte/${id}/lv`}
          className="underline-offset-2 hover:text-text hover:underline"
        >
          ← {p.lv_bezeichnung} · Fassung {String(p.lv_fassung)}
        </Link>
        {daten.ahnen.map((a) => (
          <span key={a.id}>
            {' · '}
            <span className="text-text-subtle">{ART_TEXT[a.art] ?? a.art}</span>{' '}
            {a.oz} {a.kurztext}
          </span>
        ))}
      </nav>

      <div className="mb-s5 flex flex-wrap items-start justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">
            {p.oz} · {p.kurztext}
          </h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {p.projekt_nummer} · {p.projekt} · {LV_ART_TEXT[p.lv_art] ?? p.lv_art}
            {' · '}{ART_TEXT[p.art] ?? p.art}
            {p.art === 'position' && ` · ${POSITIONSART_TEXT[p.positionsart] ?? p.positionsart}`}
          </p>
        </div>
        {ungeprueftMaschinell && (
          <span className="inline-flex flex-wrap items-center gap-s2">
            {/* APR-03: maschinell gelesen, von niemandem bestaetigt. */}
            <StatusPill zustand="In Prüfung" />
            <span className="text-sm text-warning">maschinell gelesen, unbestätigt</span>
          </span>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Vertrag: Menge, Einheit, Preis, Betrag.                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Vertrag</h2>
        <dl className="m-0 grid grid-cols-2 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-4">
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Vertragsmenge</dt>
            <dd className="m-0 mt-s1 tabular-nums text-sm text-text" data-cse="menge-vertrag">
              {vertrag === null ? '—' : `${formatiereMenge(vertrag)} ${p.einheit ?? ''}`}
            </dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Einheit</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{p.einheit ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Einheitspreis</dt>
            <dd className="m-0 mt-s1 tabular-nums text-sm text-text" data-cse="einheitspreis">
              {p.einheitspreis_cent === null
                ? <span className="text-text-subtle">nicht lesbar</span>
                : formatiereGeld(cent(BigInt(p.einheitspreis_cent)))}
            </dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Betrag</dt>
            <dd className="m-0 mt-s1 tabular-nums text-sm text-text" data-cse="betrag">
              {betrag === null
                ? <span className="text-text-subtle">nicht lesbar</span>
                : formatiereGeld(betrag)}
            </dd>
          </div>
        </dl>

        {!p.darf_preis_lesen && (
          <p className="mt-s3 text-sm text-warning">
            Einheitspreis und Betrag sind für Ihre Rolle nicht lesbar (Recht{' '}
            <code>bau.preis_lesen</code>). Es steht hier deshalb „nicht lesbar" und
            keine 0 € — eine Null wäre eine Angabe, und sie wäre falsch.
          </p>
        )}

        {p.art === 'position' && !zaehltArtInSumme(p.positionsart) && (
          <p className="mt-s3 text-sm text-warning" data-cse="nicht-in-summe">
            {/*
              * WORTGLEICH mit dem LV-Baum (`lv/page.tsx`): zwei verschiedene
              * Formulierungen für dieselbe Rechtsfolge wären zwei Aussagen
              * über denselben Vertrag.
              */}
            Diese {POSITIONSART_TEXT[p.positionsart] ?? p.positionsart} ist in der
            Summe nicht enthalten — sie ist angeboten, nicht beauftragt (offene
            Frage O-155).
          </p>
        )}

        {p.steuer_kennzeichen !== null && (
          <p className="mt-s3 text-sm text-text-muted">
            Steuerkennzeichen: <code>{p.steuer_kennzeichen}</code>
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Langtext — das, was geschuldet ist.                                 */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Leistungstext</h2>
        {p.langtext === null || p.langtext.trim() === '' ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Zu dieser Position ist nur der Kurztext hinterlegt. Im Streit über
            den Leistungsumfang ist der Langtext die Antwort — fehlt er, gilt
            der Kurztext, und der ist kurz.
          </p>
        ) : (
          <p
            className="whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text"
            data-cse="langtext"
          >
            {p.langtext}
          </p>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-05: aufgemessen gegen Vertragsmenge.                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6" data-cse="aufmass-gegenueberstellung">
        <h2 className="mb-s3 text-h3 text-text">Aufgemessen</h2>
        <dl className="m-0 mb-s3 grid grid-cols-2 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Vertragsmenge</dt>
            <dd className="m-0 mt-s1 tabular-nums text-sm text-text">
              {vertrag === null ? '—' : `${formatiereMenge(vertrag)} ${p.einheit ?? ''}`}
            </dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Aufgemessen</dt>
            <dd
              className={`m-0 mt-s1 tabular-nums text-sm ${ueberschritten ? 'text-warning' : 'text-text'}`}
              data-cse="menge-aufgemessen"
            >
              {`${formatiereMenge(aufgemessen)} ${p.einheit ?? ''}`}
            </dd>
          </div>
          <div>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Blätter</dt>
            <dd className="m-0 mt-s1 tabular-nums text-sm text-text">
              {String(p.aufmass_blaetter)}
            </dd>
          </div>
        </dl>

        {ueberschritten && (
          <p className="mb-s3 text-sm text-warning" data-cse="mehrmenge">
            Die aufgemessene Menge übersteigt die Vertragsmenge. Eine Mehrmenge
            kann nach § 2 Abs. 3 VOB/B einen neuen Einheitspreis begründen — ob
            und ab welcher Abweichung, entscheidet der Vertrag. Die Anwendung
            rechnet hier nichts um und schlägt keinen Preis vor.
          </p>
        )}

        {daten.aufmasse.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Auf diese Position ist nichts aufgemessen.
          </p>
        ) : (
          <DataTable
            beschriftung="Aufmaßzeilen auf dieser Position"
            zeilen={daten.aufmasse}
            schluessel={(z) => z.zeile_id}
            spalten={[
              {
                schluessel: 'blatt',
                kopf: 'Blatt',
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/bau/projekte/${id}/aufmass/${z.aufmass_id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.nummer} · {z.bezeichnung}
                  </Link>
                ),
              },
              { schluessel: 'messdatum', kopf: 'Messdatum', zelle: (z) => z.messdatum_lokal },
              {
                schluessel: 'rechenansatz',
                kopf: 'Rechenansatz',
                zelle: (z) => (
                  <span className="font-mono text-text-muted">{z.rechenansatz}</span>
                ),
              },
              {
                schluessel: 'menge',
                kopf: 'Menge',
                numerisch: true,
                zelle: (z) => formatiereErgebnis(z.ergebnis_skaliert, z.einheit),
              },
              {
                schluessel: 'status',
                kopf: 'Status',
                zelle: (z) => (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill
                      zustand={z.storniert
                        ? 'Archiviert'
                        : AUFMASS_PILLE[z.status] ?? 'Entwurf'}
                    />
                    <span className="text-xs text-text-muted">
                      {z.storniert
                        ? 'storniert'
                        : AUFMASS_STATUS_TEXT[z.status] ?? z.status}
                    </span>
                  </span>
                ),
              },
            ]}
          />
        )}
        <p className="mt-s2 text-xs text-text-subtle">
          Gezählt wird nur, was auf einem lebenden Blatt steht. Ein storniertes
          Blatt erscheint in der Liste — damit die Korrekturspur sichtbar ist —,
          zählt aber nicht in die aufgemessene Menge.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-04: Nachträge mit Bezug auf diese Position.                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6" data-cse="nachtraege-position">
        <h2 className="mb-s3 text-h3 text-text">Nachträge mit Bezug</h2>
        {daten.nachtraege.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Kein Nachtrag bezieht sich auf diese Position.
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {daten.nachtraege.map((n) => (
              <li
                key={`${n.id}-${n.bezug}`}
                className="mb-s2 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
              >
                <Link
                  href={`/portal/${mandant}/bau/projekte/${n.projekt_id}/nachtraege/${n.id}`}
                  className="text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {n.nummer} · {n.titel}
                </Link>
                <span className="ml-s2 inline-flex items-center gap-s2">
                  <StatusPill zustand={NACHTRAG_PILLE[n.status] ?? 'Offen'} />
                  <span className="text-xs">
                    {NACHTRAG_STATUS_TEXT[n.status] ?? n.status}
                  </span>
                </span>
                <span className="mt-s1 block text-xs text-text-subtle">
                  {BEZUG_TEXT[n.bezug] ?? n.bezug}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* APR-03: Herkunft und Bestätigung.                                   */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-s3 text-h3 text-text">Herkunft</h2>
        {p.konfidenz === null ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Diese Position wurde von Hand erfasst oder aus einer Quelle
            übernommen, die keine maschinelle Lesung war — es gibt keine
            Konfidenz und nichts zu bestätigen.
            {p.gaeb_dp !== null && <> GAEB-Kennung: <code>{p.gaeb_dp}</code>.</>}
          </p>
        ) : (
          <div className="rounded-lg border border-line bg-surface p-s5">
            <dl className="m-0 grid grid-cols-2 gap-s4 sm:grid-cols-4">
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Konfidenz</dt>
                <dd className="m-0 mt-s1 tabular-nums text-sm text-text" data-cse="konfidenz">
                  {p.konfidenz} %
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Quelle: Seite</dt>
                <dd className="m-0 mt-s1 tabular-nums text-sm text-text">
                  {p.quelle_seite === null ? '—' : String(p.quelle_seite)}
                </dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">GAEB-Kennung</dt>
                <dd className="m-0 mt-s1 text-sm text-text">{p.gaeb_dp ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Bestätigt</dt>
                <dd className="m-0 mt-s1 text-sm text-text" data-cse="geprueft">
                  {p.geprueft_lokal === null
                    ? <span className="text-warning">nein</span>
                    : `${p.geprueft_lokal}${p.geprueft_von_name === null ? '' : ` · ${p.geprueft_von_name}`}`}
                </dd>
              </div>
            </dl>

            {ungeprueftMaschinell && (
              <>
                <p className="mt-s4 max-w-prose text-sm text-warning">
                  Solange diese Position unbestätigt ist, lässt sich kein Aufmaß
                  darauf gegenzeichnen (APR-03, K-10): ein Wert, den ein Modell
                  aus einem Dokument gelesen hat, darf keine abrechenbare Menge
                  tragen, bevor ein benannter Mensch ihn bestätigt hat.
                </p>
                {darf['bau.schreiben'] === true ? (
                  <form
                    action={`/api/bau/lv-positionen/${ozId}/bestaetigung`}
                    method="post"
                    className="mt-s4"
                    data-cse="bestaetigung"
                  >
                    <input type="hidden" name="mandant" value={mandant} />
                    <input type="hidden" name="zurueck" value={pfad} />
                    <Button type="submit" variante="primary">
                      Position bestätigen
                    </Button>
                  </form>
                ) : (
                  <p className="mt-s4 text-sm text-text-muted">
                    Bestätigen darf, wer <code>bau.schreiben</code> hält. Die Kraft
                    auf der Baustelle bestätigt keine Vertragsposition — das ist
                    die Bauleitung.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>
    </PortalRahmen>
  );
}
