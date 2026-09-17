import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { MandantAntwort } from '@/app/portal/unterseite';
import {
  erstelleAuskunft, erteilte,
  type Auskunft, type AuskunftAbschnitt, type AuskunftZeile,
} from '@/server/services/datenschutz/auskunft';
import { ladeVorgang } from '../../vorgang';
import { BERLIN, Vorgangskopf } from '../../Vorgangskopf';

/**
 * `/portal/[mandant]/datenschutz/[id]/auskunft` — die Art.-15-Auskunft,
 * VOLLSTÄNDIG auf dem Bildschirm, bevor sie das Haus verlässt (LEG-09).
 *
 * **Die Seite zeigt, was die Datei enthält — Abschnitt für Abschnitt, mit
 * Zweck, Quelle und Aufbewahrungsfrist.** Ein Export, den niemand vorher
 * gesehen hat, ist eine Aushändigung ohne Prüfung; Invariante 7 verlangt die
 * menschliche Freigabe, und diese Seite ist sie.
 *
 * **Und sie zeigt vor allem, was sie NICHT enthält.**
 * `datenschutz.auskunft_erstellen` ist im Katalog einzeln bindbar; ein Träger
 * dieses einen Rechts sieht `zeiteintrag` nicht (`zeit.lesen`), `abwesenheit`
 * nicht (`zeit.abwesenheit_lesen`), `nachweis` nicht
 * (`personal.nachweis_lesen`), `bewerbung` nicht (`recruiting.bewerbung_lesen`)
 * und `ansprechpartner` nicht (`crm.lesen`). Die Datenbank antwortet auf all
 * das korrekt mit null Zeilen — und eine Seite, die daraus „keine
 * Zeiteinträge" macht, erzeugt eine falsche Auskunft, die aussieht wie eine
 * richtige. Gesperrte Abschnitte stehen deshalb rot da, und der Abruf ist
 * gesperrt, bis sie gelesen sind.
 *
 * **Der Umfang bei Agentenprotokollen, Wissens-Chunks und
 * Freigabe-Snapshots ist offen (O-113)** — und steht als eigener Abschnitt da,
 * statt stillschweigend zu fehlen.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Auskunft (Art. 15) — Datenschutz' };

interface Extra {
  readonly auskunft: Auskunft;
  readonly frueher: readonly AuskunftZeile[];
}

function Abschnitt({ a }: { readonly a: AuskunftAbschnitt }) {
  const zeilen = a.zeilen.map((z, i) => ({ i, z }));
  return (
    <section data-cse="auskunft-abschnitt" data-gesperrt={String(a.gesperrt)}
             className="mb-s7">
      <div className="mb-s1 flex flex-wrap items-baseline gap-s3">
        <h2 className="m-0 text-h3 text-text">{a.titel}</h2>
        {a.gesperrt ? <StatusPill zustand="Fehler" /> : null}
        {a.offen !== null ? <StatusPill zustand="Offen" /> : null}
      </div>
      <p className="mb-s2 text-micro uppercase tracking-[0.08em] text-text-subtle">
        {`Quelle: ${a.quelle} · Aufbewahrung: ${a.frist}`}
      </p>
      <p className="mb-s3 max-w-prose text-sm text-text-muted">{a.zweck}</p>

      {a.offen !== null ? (
        <Hinweis art="warnung" cse="auskunft-offen" className="max-w-prose">
          <strong className="block">{`Der Umfang ist offen (${a.offen}).`}</strong>
          Wie ein Art.-15-Begehren auf Agentenprotokolle, Wissens-Chunks und
          Freigabe-Snapshots wirkt, wenn GoBD und § 147 AO gleichzeitig
          Aufbewahrung verlangen, ist noch nicht entschieden. Dieser Abschnitt
          benennt das und beantwortet es nicht — eine Auskunft, die diese Tabellen
          stillschweigend auslässt, behauptet, es gäbe dort nichts.
        </Hinweis>
      ) : a.gesperrt ? (
        <Hinweis art="warnung" cse="auskunft-gesperrt" className="max-w-prose">
          <strong className="block">Nicht gelesen — Recht fehlt.</strong>
          Dieser Abschnitt braucht
          {' '}<code className="font-mono">{a.recht ?? ''}</code>. Er ist nicht
          leer; er ist ungelesen. Solange er es ist, wird die Auskunft nicht
          ausgeliefert.
        </Hinweis>
      ) : zeilen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Zeile — zu dieser Person ist hier nichts gespeichert. Das ist eine
          Antwort nach Art. 15, keine Lücke.
        </p>
      ) : (
        <DataTable
          beschriftung={a.titel}
          zeilen={zeilen}
          schluessel={(r) => String(r.i)}
          spalten={a.kopf.map((k, s) => ({
            schluessel: `s${String(s)}`,
            kopf: k,
            zelle: (r: { i: number; z: readonly string[] }) => r.z[s] ?? '—',
          }))}
        />
      )}
    </section>
  );
}

export default async function Auskunftsseite(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;

  const geladen = await ladeVorgang<Extra>(
    `/portal/${mandant}/datenschutz/${id}/auskunft`, mandant, id, [],
    async (kontext, v) => ({
      auskunft: await erstelleAuskunft(kontext, v.z.id, v.zuordnung, new Date()),
      frueher: await erteilte(kontext, v.z.id),
    }),
  );
  if (geladen.art !== 'ok') return <MandantAntwort tor={geladen.tor} />;
  const { zugang, z, zuordnung, darf, extra } = geladen;
  const a = extra.auskunft;

  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong '
    + 'px-s5 py-s3 text-sm text-text hover:bg-surface-2';
  const api = `/api/datenschutz/auskunft?anfrage=${z.id}`;

  return (
    <PortalRahmen
      titel="Auskunft (Art. 15)"
      wurzelTitel="Datenschutz"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mehr"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <Vorgangskopf mandant={mandant} z={z} zuordnung={zuordnung} aktiv="auskunft"
                    darf={darf} />

      <h2 className="mb-s2 text-h2 text-text">Was wir über diese Person gespeichert haben</h2>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Zusammengestellt beim Aufruf aus den Tabellen mit Personenbezug — je
        Abschnitt der Zweck aus dem Verarbeitungsverzeichnis, die Quelle und die
        Aufbewahrungsfrist. Nichts davon ist gerechnet und nichts von einem Modell
        erzeugt (Invariante 6): diese Seite liest und faltet.
      </p>

      {zuordnung.art === 'keine' ? (
        <Hinweis art="warnung" cse="auskunft-ohne-zuordnung" className="mb-s6 max-w-prose">
          <strong className="block">Dieser Vorgang ist keinem Datensatz zugeordnet.</strong>
          Ohne Zuordnung weiss niemand, wessen Daten auszugeben sind — und die
          naheliegende Abkürzung über die E-Mail-Adresse ist genau der Fehler, den
          Art. 12 Abs. 6 verhindern soll.{' '}
          <Link href={`/portal/${mandant}/datenschutz/${z.id}`}
                className="underline-offset-2 hover:text-text hover:underline">
            Zuerst zuordnen
          </Link>
        </Hinweis>
      ) : null}

      {a.fehlendeRechte.length > 0 ? (
        <Hinweis art="warnung" cse="auskunft-unvollstaendig" className="mb-s6 max-w-prose">
          <strong className="block">
            {`${String(a.fehlendeRechte.length)} Abschnitt(e) sind nicht lesbar — der Abruf ist gesperrt.`}
          </strong>
          Eine halbe Art.-15-Auskunft ist schlimmer als keine: sie sieht aus wie
          eine Antwort und geht an die betroffene Person. Fehlend:
          <ul className="m-0 mt-s2 list-disc ps-s5">
            {a.fehlendeRechte.map((r) => (
              <li key={r}><code className="font-mono">{r}</code></li>
            ))}
          </ul>
          <span className="mt-s2 block">
            Eine Sitzung mit diesen Rechten erzeugt die Auskunft vollständig. Die
            Frist des Art. 12 Abs. 3 läuft weiter — sie ist oben zu sehen.
          </span>
        </Hinweis>
      ) : null}

      <dl data-cse="auskunft-kopf"
          className="mb-s5 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Erstellt</dt>
        <dd className="text-text">{a.erstelltAm}</dd>
        <dt className="text-text-muted">Abschnitte · Zeilen</dt>
        <dd className="text-text" data-cse="auskunft-umfang">
          {`${String(a.abschnitte.length)} · ${String(a.zeilen)}`}
        </dd>
        <dt className="text-text-muted">Vollständig</dt>
        <dd className="text-text">
          <StatusPill zustand={a.vollstaendig ? 'Aktiv' : 'Fehler'} />
        </dd>
        <dt className="text-text-muted">SHA-256 des Inhalts</dt>
        <dd className="min-w-0 break-all font-mono text-xs text-text" data-cse="auskunft-sha256">
          {a.sha256}
        </dd>
      </dl>

      {a.vollstaendig ? (
        <div data-cse="auskunft-abrufe" className="mb-s6 flex flex-wrap items-center gap-s3">
          <a href={`${api}&format=md`} data-cse="auskunft-markdown" className={knopf}>
            Markdown
          </a>
          <a href={`${api}&format=json`} data-cse="auskunft-json" className={knopf}>
            Struktur (JSON) — auch Art. 20
          </a>
          <span className="text-xs text-text-muted">
            Jeder Abruf wird protokolliert und mit seiner Prüfsumme festgehalten.
            Versendet wird nichts von allein.
          </span>
        </div>
      ) : (
        <p className="mb-s6 text-sm text-text-muted" data-cse="auskunft-kein-abruf">
          Der Abruf ist gesperrt, solange die Auskunft unvollständig wäre.
        </p>
      )}

      {a.abschnitte.map((s) => <Abschnitt key={s.schluessel} a={s} />)}

      <section aria-labelledby="frueher">
        <h2 id="frueher" className="mb-s2 text-h2 text-text">Bereits erteilt</h2>
        {extra.frueher.length === 0 ? (
          <p className="text-sm text-text-muted">
            Zu diesem Vorgang wurde noch keine Auskunft erzeugt.
          </p>
        ) : (
          <DataTable
            beschriftung="Zu diesem Vorgang erteilte Auskünfte"
            zeilen={[...extra.frueher]}
            schluessel={(x) => x.id}
            spalten={[
              {
                schluessel: 'zeit', kopf: 'Erzeugt',
                zelle: (x) => BERLIN.format(new Date(x.erzeugtAm)),
              },
              { schluessel: 'von', kopf: 'Von', zelle: (x) => x.erzeugtVon ?? '—' },
              { schluessel: 'format', kopf: 'Format', zelle: (x) => x.format },
              {
                schluessel: 'sha', kopf: 'SHA-256',
                zelle: (x) => (
                  <span className="min-w-0 break-all font-mono text-xs">{x.sha256}</span>
                ),
              },
            ]}
          />
        )}
      </section>
    </PortalRahmen>
  );
}
