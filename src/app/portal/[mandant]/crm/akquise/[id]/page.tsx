import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import { kennungOder404 } from '../../../../kennung';
import { lade, type Ziel } from '@/server/services/akquise/ziel';
import { entwerfe, type Gesellschaft } from '@/server/services/akquise/entwurf';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/crm/akquise/[id]` — eine Firma, und was mit ihr geht (§12).
 *
 * Die Seite beantwortet drei Fragen in dieser Reihenfolge:
 *
 *  1. **Warum steht diese Firma hier?** — die Begründung der Punktzahl, im
 *     Klartext und mit dem Hinweis, dass die Gewichte Platzhalter sind (O-15).
 *  2. **Was könnte man ihr schreiben?** — ein Entwurf, den ein Mensch ändern
 *     kann. Er wird nicht gesendet.
 *  3. **Warum geht er nicht hinaus?** — der Rechtsstand, ohne Beschönigung,
 *     mit den Schritten, die daran etwas ändern würden.
 *
 * Die dritte Frage steht bewusst AUF dieser Seite und nicht in einer
 * Fehlermeldung beim Senden. Ein Knopf, der erst beim Drücken sagt, dass er
 * nicht darf, erzeugt den Eindruck eines Fehlers; ein Text, der vorher sagt,
 * warum nicht, erzeugt Verständnis.
 */
export const dynamic = 'force-dynamic';

/** Berliner Zeit, wie überall im Portal (Invariante 2). */
const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const GEWERK: Readonly<Record<string, string>> = {
  reinigung: 'Gebäudereinigung',
  security: 'Sicherheits- und Objektschutzdienste',
  bau: 'Hochbau, Ausbau und Rückbau',
  operations: 'Digitale Betriebsführung',
};

function Zeile({ kopf, children }: { readonly kopf: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-s2 border-b border-line py-s3 last:border-b-0">
      <dt className="w-40 shrink-0 text-sm text-text-muted">{kopf}</dt>
      <dd className="m-0 min-w-0 flex-1 text-sm text-text">{children}</dd>
    </div>
  );
}

export default async function Akquiseziel(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  /*
   * **Vor allem anderen.** `quellen` ist eine Nachbarroute dieser hier; ohne
   * diese Zeile reicht Next.js das Wort „quellen" als Kennung durch, es landet
   * in einem `$1::uuid` und Postgres antwortet mit einem Serverfehler. Ein 500
   * sagt „mein Fehler", wo „gibt es nicht" die Wahrheit ist.
   */
  const zielId = kennungOder404(id);
  const pfad = `/portal/${mandant}/crm/akquise/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return (
      <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant}
                    zielSlug={tor.ziel} zurueck={tor.zurueck} />
    );
  }
  const { sitzung } = zugang;
  const mandantId = sitzung.aktiverMandantId;
  if (mandantId === null) notFound();

  const daten = await db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const abfrage = { unsafe: (s: string, w?: readonly unknown[]) => kontext.abfrage(s, w) };
      const ziel = await lade(abfrage, mandantId, zielId);
      if (ziel === null) return null;
      const [gesellschaft] = await kontext.abfrage<{ name: string; slug: string }>(
        `select name, slug from mandant where id = $1`, [mandantId]);
      return { ziel, gesellschaft: gesellschaft ?? null };
    })) as { ziel: Ziel; gesellschaft: { name: string; slug: string } | null } | null;

  /*
   * 404 und nicht 403 (AUT-06). Eine Kennung aus einer fremden Gesellschaft
   * darf nicht daran erkennbar sein, dass die Antwort eine andere ist.
   */
  if (daten === null || daten.gesellschaft === null) notFound();
  const { ziel, gesellschaft } = daten;

  const firma: Gesellschaft = {
    name: gesellschaft.name,
    slug: gesellschaft.slug,
    gewerk: GEWERK[gesellschaft.slug] ?? 'unsere Leistungen',
  };
  const entwurf = entwerfe(ziel, firma);
  const zurueck = `/portal/${mandant}/crm/akquise`;

  return (
    <PortalRahmen
      titel={ziel.firmenname}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <p className="mb-s3 text-sm">
        <Link href={`/portal/${mandant}/crm/akquise`}
              className="text-text-muted underline-offset-2 hover:underline">
          ← Akquise
        </Link>
      </p>
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{ziel.firmenname}</h1>
        <StatusPill zustand={ziel.status === 'uebernommen' ? 'Abgeschlossen'
          : ziel.status === 'verworfen' ? 'Archiviert'
          : ziel.status === 'geprueft' ? 'In Arbeit' : 'Offen'} />
      </div>

      <div className="grid gap-s5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-s4 mt-0 text-h3 text-text">Was bekannt ist</h2>
          <dl className="m-0">
            <Zeile kopf="Branche">{ziel.branche ?? <span className="text-text-subtle">nicht erfasst</span>}</Zeile>
            <Zeile kopf="Anschrift">
              {ziel.strasse === null && ziel.ort === null
                ? <span className="text-text-subtle">nicht erfasst</span>
                : [ziel.strasse, [ziel.plz, ziel.ort].filter((t) => t !== null).join(' ')]
                    .filter((t) => t !== null && t !== '').join(', ')}
            </Zeile>
            <Zeile kopf="Website">
              {ziel.website === null ? <span className="text-text-subtle">nicht erfasst</span> : ziel.website}
            </Zeile>
            <Zeile kopf="Allgemeines Postfach">
              {ziel.allgemeineEmail ?? <span className="text-text-subtle">nicht erfasst</span>}
            </Zeile>
            <Zeile kopf="Telefon">
              {ziel.telefon ?? <span className="text-text-subtle">nicht erfasst</span>}
            </Zeile>
            <Zeile kopf="Ansprechpartner">
              {/*
                * Der einzige Wert auf dieser Seite, der NIE gefüllt sein wird —
                * und der Satz daneben sagt warum. Ein leeres Feld ohne
                * Erklärung sieht aus wie eine Lücke in der Recherche.
                */}
              <span className="text-text-subtle">
                wird nicht gespeichert — Art. 14 DSGVO (siehe unten)
              </span>
            </Zeile>
            <Zeile kopf="Quelle">{ziel.quelleBezeichnung ?? 'von Hand erfasst'}</Zeile>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-s4 mt-0 text-h3 text-text">Warum diese Firma</h2>
          <p className="mb-s4 mt-0 text-h1 text-text">
            {ziel.punktzahl === null ? '—' : String(ziel.punktzahl)}
            <span className="ml-s2 text-sm text-text-muted">Punkte</span>
          </p>
          <p className="m-0 whitespace-pre-line text-sm text-text-muted">
            {ziel.punktzahlBegruendung ?? 'Keine Bewertung hinterlegt.'}
          </p>
          {ziel.bedarfVermutung === null ? null : (
            <p className="mb-0 mt-s4 text-sm text-text">{ziel.bedarfVermutung}</p>
          )}
        </Card>
      </div>

      <Card className="mt-s5">
        <h2 className="mb-s4 mt-0 text-h3 text-text">Entwurf einer Ansprache</h2>
        <p className="mb-s4 mt-0 text-sm text-text-muted">
          {`Vorgeschlagener Weg: ${entwurf.kanal === 'post' ? 'Brief'
            : entwurf.kanal === 'telefon' ? 'Telefon' : 'E-Mail'}. `}
          Der Text ist eine Vorlage mit eingesetzten Feldern — kein Modell hat ihn
          geschrieben, und keines rechnet darin. Er enthält bewusst keinen Preis.
        </p>
        <p className="m-0 mb-s4 text-sm font-medium text-text">{entwurf.betreff}</p>
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-s4 font-sans text-sm text-text">
          {entwurf.text}
        </pre>
      </Card>

      <Hinweis art="warnung" cse="akquise-versandstand" className="mt-s5">
        <strong className="block">Dieser Entwurf geht heute nicht hinaus.</strong>
        <p className="mb-s3 mt-s2">{entwurf.hindernis}</p>
        <p className="mb-s2 mt-0">Damit er hinausgehen dürfte, müsste:</p>
        <ol className="m-0 list-decimal pl-s5">
          {entwurf.schritte.map((s) => <li key={s} className="mb-s1">{s}</li>)}
        </ol>
      </Hinweis>

      {ziel.status === 'uebernommen' && ziel.leadId !== null ? (
        <Hinweis art="erfolg" cse="akquise-uebernommen" className="mt-s5">
          Diese Firma ist im Vertrieb.{' '}
          <Link href={`/portal/${mandant}/crm/leads/${ziel.leadId}`}
                className="underline underline-offset-2">Zum Lead</Link>
        </Hinweis>
      ) : ziel.status === 'verworfen' ? (
        <Hinweis art="hinweis" cse="akquise-verworfen" className="mt-s5">
          {`Verworfen: ${ziel.verworfenGrund ?? 'ohne Grund'}`}
        </Hinweis>
      ) : (
        <div className="mt-s5 grid gap-s5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-s3 mt-0 text-h3 text-text">In den Vertrieb übernehmen</h2>
            <p className="mb-s4 mt-0 text-sm text-text-muted">
              Es entsteht ein Lead mit der Quelle „Akquise" und <strong>ohne
              Ansprechpartner</strong> — anschreibbar wird er erst, wenn jemand einen
              Kontakt mit Rechtsgrundlage anlegt.
            </p>
            <form method="post" action="/api/akquise/ziel" className="flex flex-col gap-s3">
              <input type="hidden" name="id" value={ziel.id} />
              <input type="hidden" name="handlung" value="uebernehmen" />
              <input type="hidden" name="zurueck" value={pfad} />
              <label className="text-sm text-text">
                Betreff des Vorgangs
                <input
                  name="betreff"
                  defaultValue={`Akquise: ${ziel.firmenname}`}
                  className="mt-s2 w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text"
                />
              </label>
              <Button type="submit" variante="primary" className="self-start">
                Übernehmen
              </Button>
            </form>
          </Card>

          {/*
            * **Angesehen — und sonst nichts** (V-080).
            *
            * `markiereGeprueft` stempelt seit je `angesehen_am` und
            * `angesehen_von` und hebt `neu` auf `geprueft`; die Route nimmt
            * die Handlung entgegen, und **kein Formular schickte sie**. Der
            * Zustand `geprueft` wurde auf dem Blatt als „In Arbeit"
            * beschriftet und entstand nie.
            *
            * **Warum ein Knopf und nicht der Seitenaufruf.** Der
            * naheliegende Weg wäre, beim Öffnen zu stempeln — „angesehen
            * heisst angesehen". Ein Seitenaufruf ist aber ein GET, und ein
            * GET, der schreibt, wird von jedem Vorschau-Abruf, jedem
            * Linkprüfer und jedem zweiten Reiter ausgelöst. Der Stempel
            * hiesse dann nicht „ein Mensch hat entschieden".
            */}
          {ziel.angesehenAm === null ? (
            <Card>
              <h2 className="mb-s3 mt-0 text-h3 text-text">Als angesehen vermerken</h2>
              <p className="mb-s4 mt-0 text-sm text-text-muted">
                Für den Fall dazwischen: geprüft, aber weder übernommen noch verworfen.
                Die Firma bleibt in der Liste und steht nicht mehr unter „neu" — und es
                ist nachlesbar, wer wann hingesehen hat, damit niemand dieselbe Recherche
                ein zweites Mal macht.
              </p>
              <form method="post" action="/api/akquise/ziel"
                    data-cse="akquise-ansehen"
                    className="flex flex-col gap-s3">
                <input type="hidden" name="id" value={ziel.id} />
                <input type="hidden" name="handlung" value="ansehen" />
                <input type="hidden" name="zurueck" value={pfad} />
                <Button type="submit" variante="secondary" className="self-start">
                  Als angesehen vermerken
                </Button>
              </form>
            </Card>
          ) : (
            <Card>
              <h2 className="mb-s3 mt-0 text-h3 text-text">Angesehen</h2>
              <p className="m-0 text-sm text-text" data-cse="akquise-angesehen">
                {BERLIN.format(ziel.angesehenAm)}
                {ziel.angesehenVon === null ? '' : ` von ${ziel.angesehenVon}`}. Diese
                Firma ist geprüft und wartet auf eine Entscheidung.
              </p>
            </Card>
          )}

          <Card>
            <h2 className="mb-s3 mt-0 text-h3 text-text">Verwerfen</h2>
            <p className="mb-s4 mt-0 text-sm text-text-muted">
              Mit Grund — sonst schlägt dieselbe Firma bei der nächsten Recherche wieder
              oben auf und jemand prüft sie ein zweites Mal.
            </p>
            <form method="post" action="/api/akquise/ziel" className="flex flex-col gap-s3">
              <input type="hidden" name="id" value={ziel.id} />
              <input type="hidden" name="handlung" value="verwerfen" />
              <input type="hidden" name="zurueck" value={zurueck} />
              <label className="text-sm text-text">
                Grund
                <input
                  name="grund"
                  required
                  placeholder="z. B. hat bereits einen Dienstleister"
                  className="mt-s2 w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text"
                />
              </label>
              <Button type="submit" variante="secondary" className="self-start">
                Verwerfen
              </Button>
            </form>
          </Card>
        </div>
      )}
    </PortalRahmen>
  );
}
