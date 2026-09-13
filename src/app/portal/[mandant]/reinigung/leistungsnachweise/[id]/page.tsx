import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mitLesekontext } from '../../daten';
import {
  findeNachweis, ladePositionen, ladeSignaturen,
} from '@/server/services/reinigung/leistungsnachweis';
import { pruefeSchnappschuss } from '@/server/services/reinigung/schnappschuss';
import type {
  SchnappschussPosition, SchnappschussWert,
} from '@/server/services/reinigung/schnappschuss';

/**
 * `/portal/[mandant]/reinigung/leistungsnachweise/[id]` — der Nachweis, nach
 * der Unterschrift für immer lesend (CLN-04, FIN-07, LEG-01).
 *
 * **Nach der Unterschrift zeigt die Seite den SCHNAPPSCHUSS, nicht die
 * Tabelle.** Das ist der Kern von CLN-04 und sieht aus wie eine Kleinigkeit:
 * wer die Zeilen aus `leistungsnachweis_position` nachlädt, zeigt den heutigen
 * Stand — und der Kunde hat einen anderen gesehen. Erst im Streitfall fällt
 * auf, dass niemand mehr sagen kann, was auf dem Bildschirm stand.
 *
 * **Der Digest steht sichtbar da, samt Probe.** Er ist das, womit sich der
 * Abzug nachrechnen lässt; ihn zu verstecken hiesse, den Beweis zu führen und
 * das Beweismittel wegzuschliessen.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<string, PillZustand>> = {
  entwurf: 'Entwurf',
  vorgelegt: 'Wartet',
  signiert: 'Abgeschlossen',
  abgelehnt: 'Abgelehnt',
  storniert: 'Archiviert',
};

function cent(text: string | null): string {
  if (text === null) return '—';
  const negativ = text.startsWith('-');
  const roh = negativ ? text.slice(1) : text;
  const ganz = roh.length > 2 ? roh.slice(0, -2) : '0';
  const rest = roh.padStart(3, '0').slice(-2);
  // DESIGN §5: deutsches Format, geschütztes Leerzeichen vor dem Zeichen.
  return `${negativ ? '-' : ''}${ganz},${rest} €`;
}

/**
 * Den gespeicherten Abzug lesen — in der Schreibweise, in der er WIRKLICH
 * steht.
 *
 * `baueSchnappschuss` schreibt die kanonische Form mit Unterstrichen
 * (`einzelpreis_cent`, `leistung_von_lokal`, `leistung_bis_lokal`), denn genau
 * über diese Bytes läuft der Digest. Hier stand stattdessen
 * `snapshot.positionen as readonly SchnappschussPosition[]` — eine Zusicherung
 * in Camel-Schreibweise über Daten in Unterstrich-Schreibweise. An einer
 * Zusicherung prüft TypeScript nichts, also kam `einzelpreisCent` zur Laufzeit
 * als `undefined` in `cent()` an: `text === null` war falsch, `text.startsWith`
 * warf, und Next beantwortete JEDEN unterschriebenen Nachweis mit
 * „Application error: a server-side exception has occurred" statt des Abzugs.
 * Der Beweis lag gespeichert in der Datenbank und war über die Oberfläche
 * nicht mehr abrufbar — aufgefallen wäre das erst im Streitfall, also genau
 * dann, wenn ihn jemand braucht.
 *
 * Gelesen wird deshalb GEPRÜFT und nicht behauptet: was keine Zeichenkette
 * ist, wird `null` und steht als „—" da. Ein Abzug in fremder Fassung bringt
 * die Seite nicht mehr zum Umfallen — und die Probe darunter sagt ohnehin rot,
 * dass er nicht zu seiner Prüfsumme passt.
 */
function alsObjekt(
  wert: SchnappschussWert | undefined,
): { readonly [schluessel: string]: SchnappschussWert } | null {
  if (wert === null || wert === undefined) return null;
  if (typeof wert !== 'object') return null;
  if (Array.isArray(wert)) return null;
  return wert as { readonly [schluessel: string]: SchnappschussWert };
}

function alsText(wert: SchnappschussWert | undefined): string | null {
  return typeof wert === 'string' ? wert : null;
}

function abzugZeilen(schnappschuss: SchnappschussWert): readonly SchnappschussPosition[] {
  const roh = alsObjekt(schnappschuss)?.['positionen'];
  if (!Array.isArray(roh)) return [];
  return (roh as readonly SchnappschussWert[]).map((zeile, i) => {
    const f = alsObjekt(zeile) ?? {};
    return {
      // Der Schlüssel der Tabellenzeile. Fehlt die Angabe, steht die Stelle in
      // der Liste da — nie `undefined`, das React still zum Index machen würde.
      reihenfolge: alsText(f['reihenfolge']) ?? String(i + 1),
      bezeichnung: alsText(f['bezeichnung']) ?? '',
      menge: alsText(f['menge']) ?? '',
      einheit: alsText(f['einheit']) ?? '',
      einzelpreisCent: alsText(f['einzelpreis_cent']),
      quelle: alsText(f['quelle']) ?? '',
      leistungVonLokal: alsText(f['leistung_von_lokal']),
      leistungBisLokal: alsText(f['leistung_bis_lokal']),
      bemerkung: alsText(f['bemerkung']),
    };
  });
}

export default async function NachweisBlatt({
  params,
}: {
  params: Promise<{ mandant: string; id: string }>;
}) {
  const { mandant, id } = await params;
  const zugang = await portalZugang(
    `/portal/${mandant}/reinigung/leistungsnachweise/[id]`,
  );
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const { kopf, positionen, signaturen } = await mitLesekontext(sitzung, async (k) => ({
    kopf: await findeNachweis(k, id),
    positionen: await ladePositionen(k, id),
    signaturen: await ladeSignaturen(k, id),
  }));
  // AUT-06: ein fremder Nachweis ist nicht vorhanden, nicht verboten.
  if (kopf === null) notFound();

  const unterschrift = signaturen.find((s) => s.rolle === 'auftraggeber') ?? signaturen[0];
  /**
   * Nach der Unterschrift steht der ABZUG im Blatt, nicht die lebende Tabelle.
   * Die eine Zeile, die das ganze Kriterium trägt.
   */
  const abzug = unterschrift === undefined
    ? null
    : abzugZeilen(unterschrift.snapshot);
  const zeilen: readonly SchnappschussPosition[] = abzug ?? positionen;

  const stimmig = unterschrift !== undefined
    && pruefeSchnappschuss(unterschrift.snapshot, unterschrift.snapshotHash);

  return (
    <PortalRahmen
      titel={kopf.nummer ?? 'Leistungsnachweis'}
      bereich={mandant as BereichSchluessel}
      nurLesen={kopf.status === 'signiert'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="reinigung"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s4">
        <Link
          href={`/portal/${mandant}/reinigung/leistungsnachweise`}
          className="text-sm text-text-muted underline hover:text-text"
        >
          ← Alle Leistungsnachweise
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.nummer ?? 'Ohne Nummer'}</h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Entwurf'} />
      </div>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">Kunde</dt>
          <dd className="m-0 text-base text-text">{kopf.kunde}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">Objekt</dt>
          <dd className="m-0 text-base text-text">{kopf.objekt ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">Revier</dt>
          <dd className="m-0 text-base text-text">{kopf.revier ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
            Leistungszeitraum
          </dt>
          <dd className="m-0 text-base tabular-nums text-text">
            {kopf.leistungszeitraumVon} – {kopf.leistungszeitraumBis}
          </dd>
        </div>
      </dl>

      {kopf.status === 'vorgelegt' && (
        <form
          method="post"
          action="/api/reinigung/leistungsnachweise"
          className="mb-s5 flex flex-wrap items-center gap-s3 rounded-lg border border-line bg-surface p-s4"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="nachweis" value={id} />
          <p className="m-0 grow text-sm text-text-muted">
            Der Nachweis liegt beim Kunden
            {kopf.vorgelegtAmLokal === null ? '' : ` seit ${kopf.vorgelegtAmLokal}`}.
          </p>
          <Link
            href={`/portal/${mandant}/reinigung/leistungsnachweise/${id}/unterschrift`}
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 font-semibold text-white hover:bg-brand-hover"
          >
            Unterschreiben lassen
          </Link>
        </form>
      )}

      {kopf.status === 'entwurf' && (
        <form
          method="post"
          action="/api/reinigung/leistungsnachweise"
          className="mb-s5 flex flex-wrap items-center gap-s3 rounded-lg border border-line bg-surface p-s4"
        >
          <input type="hidden" name="mandant" value={mandant} />
          <input type="hidden" name="nachweis" value={id} />
          <input type="hidden" name="schritt" value="vorlegen" />
          <p className="m-0 grow text-sm text-text-muted">
            Mit dem Vorlegen bekommt der Nachweis seine Nummer und wird für den
            Kunden sichtbar. Danach sind die Zeilen nicht mehr frei.
          </p>
          <Button type="submit" variante="primary">Vorlegen</Button>
        </form>
      )}

      <h2 className="mb-s3 text-h3 text-text">
        {abzug === null ? 'Positionen' : 'Positionen — Abzug der Unterschrift'}
      </h2>
      {abzug !== null && (
        <p className="mb-s4 max-w-prose text-sm text-text-muted">
          Diese Zeilen sind die <strong className="text-text">unveränderliche Kopie</strong>{' '}
          dessen, was zum Zeitpunkt der Unterschrift angezeigt wurde — nicht der
          heutige Stand. Eine spätere Korrektur am Revier oder am Auftrag ändert
          sie nicht.
        </p>
      )}

      <DataTable<SchnappschussPosition>
        beschriftung="Positionen des Leistungsnachweises"
        zeilen={zeilen}
        schluessel={(p) => p.reihenfolge}
        spalten={[
          { schluessel: 'bezeichnung', kopf: 'Leistung', zelle: (p) => p.bezeichnung },
          {
            schluessel: 'menge',
            kopf: 'Menge',
            numerisch: true,
            zelle: (p) => p.menge.replace('.', ','),
          },
          { schluessel: 'einheit', kopf: 'Einheit', zelle: (p) => p.einheit },
          {
            schluessel: 'preis',
            kopf: 'Einzelpreis',
            numerisch: true,
            zelle: (p) => cent(p.einzelpreisCent),
          },
          {
            schluessel: 'zeitraum',
            kopf: 'Ausführung (Berlin)',
            zelle: (p) => (p.leistungVonLokal === null
              ? '—'
              : `${p.leistungVonLokal}${p.leistungBisLokal === null ? '' : ` – ${p.leistungBisLokal}`}`),
          },
          { schluessel: 'bemerkung', kopf: 'Bemerkung', zelle: (p) => p.bemerkung ?? '—' },
        ]}
      />

      {unterschrift !== undefined && (
        <Card className="mt-s5">
          <h2 className="mb-s4 mt-0 text-h3 text-text">Unterschrift</h2>
          <dl className="grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
                Unterzeichnet von
              </dt>
              <dd className="m-0 text-base text-text">
                {unterschrift.unterzeichnerName}
                {unterschrift.unterzeichnerFunktion !== null
                  && ` · ${unterschrift.unterzeichnerFunktion}`}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
                Serverzeit (Europe/Berlin)
              </dt>
              <dd className="m-0 text-base tabular-nums text-text">
                {unterschrift.unterzeichnetAmLokal}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">
                Gerätezeit — getrennt gespeichert
              </dt>
              <dd className="m-0 text-base tabular-nums text-text">
                {unterschrift.geraeteZeitLokal ?? 'keine übermittelt'}
                {unterschrift.zeitabweichungSek !== null && (
                  <span className="ml-s2 text-text-muted">
                    ({unterschrift.zeitabweichungSek} s Abweichung)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-micro uppercase tracking-[0.08em] text-text-muted">Ort</dt>
              <dd className="m-0 text-base tabular-nums text-text">
                {unterschrift.breitengrad === null
                  ? 'nicht erfasst'
                  : `${unterschrift.breitengrad}, ${unterschrift.laengengrad ?? ''}`}
              </dd>
            </div>
          </dl>

          <div className="mt-s4 border-t border-line pt-s4">
            <div className="text-micro uppercase tracking-[0.08em] text-text-muted">
              Prüfsumme des Abzugs (SHA-256)
            </div>
            <p className="m-0 break-all font-mono text-sm text-text">
              {unterschrift.snapshotHash}
            </p>
            <p className="mt-s2 m-0 text-sm">
              <Icon
                name={stimmig ? 'ok' : 'fehler'}
                groesse="sm"
                className={`mr-s2 inline-block align-[-2px] ${stimmig ? 'text-success' : 'text-danger'}`}
              />
              <span className={stimmig ? 'text-text-muted' : 'text-danger'}>
                {stimmig
                  ? 'Nachgerechnet: der gespeicherte Abzug ergibt genau diese Prüfsumme.'
                  : 'Der gespeicherte Abzug ergibt eine ANDERE Prüfsumme. Nicht weiterverwenden.'}
              </span>
            </p>
          </div>

          {/*
            Das Bild bekommt KEINE eingebettete Quelle und keinen Bucket-Pfad.
            Die einzige Adresse, unter der es erreichbar ist, wird auf Abruf
            signiert und läuft nach fünfzehn Minuten ab (DOC-03, SEC-A6); die
            Zeile dahinter wird durch die Sitzung des Aufrufers gelesen, damit
            die Datenbank dieselbe Bedingung ein zweites Mal prüft.
          */}
          <p className="mt-s4 m-0 text-sm text-text-muted">
            {unterschrift.signaturMedienId === null ? (
              'Kein Unterschriftsbild hinterlegt — der Bildspeicher war nicht verbunden.'
            ) : (
              <>
                {/*
                  Ein `<a>`, kein `<Link>`.

                  `/api/medien/[id]` ist ein Endpunkt, keine Seite: er
                  signiert eine Adresse und leitet auf den Speicher um. Die
                  Client-Navigation von `next/link` hat dort nichts zu
                  suchen — und `typedRoutes` sagt das auch, weil eine
                  API-Route in der Routenkarte gar nicht steht. Die
                  Zeitenseite macht es an derselben Stelle schon so.
                */}
                <a
                  href={`/api/medien/${unterschrift.signaturMedienId}`}
                  className="underline hover:text-text"
                >
                  Unterschriftsbild anfordern
                </a>
                {' '}— privater Bucket, Adresse wird auf Abruf signiert und läuft
                nach 15 Minuten ab.
              </>
            )}
          </p>
        </Card>
      )}
    </PortalRahmen>
  );
}
