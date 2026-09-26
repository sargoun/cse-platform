import Link from 'next/link';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  ART_TEXT, WEG_TEXT, ZUORDNUNG_TEXT, type AnfrageZeile, type Zuordnung,
} from '@/server/services/datenschutz/anfrage';
import { Recht } from '@/components/ui/Recht';

/**
 * Der Kopf der vier Vorgangsseiten — EINMAL gebaut, nicht viermal.
 *
 * `/datenschutz/[id]`, `…/auskunft`, `…/berichtigung` und `…/loeschung` sind
 * derselbe Vorgang mit vier verschiedenen Körpern. Der Kopf — Art, Frist in
 * Berliner Zeit, Zuordnung, Stand — ist bei allen vier derselbe, und vier
 * Kopien wären vier Gelegenheiten, die Frist unterschiedlich zu rechnen.
 *
 * **Die Frist steht in Berliner Zeit und mit Zahl** (Invariante 2). „Seit 3
 * Tagen überfällig" ist eine andere Nachricht als „überfällig": die erste sagt,
 * wie schlimm es ist. Gerechnet hat sie die Datenbank (`tageBisFrist`) gegen
 * ihre eigene Uhr, nicht diese Datei.
 */

export const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen',
  identitaet_offen: 'Offen',
  in_bearbeitung: 'In Arbeit',
  beantwortet: 'Abgeschlossen',
  abgelehnt: 'Archiviert',
};

export const STATUS_WORT: Readonly<Record<string, string>> = {
  neu: 'Neu',
  identitaet_offen: 'Identität offen',
  in_bearbeitung: 'In Bearbeitung',
  beantwortet: 'Beantwortet',
  abgelehnt: 'Abgelehnt',
};

export const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

export const BERLIN_TAG = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

/** Die drei Unterseiten eines Vorgangs — je nach Art die naheliegende zuerst. */
export const UNTERSEITEN: readonly {
  readonly weg: string; readonly titel: string; readonly recht: string;
}[] = [
  { weg: 'auskunft', titel: 'Auskunft (Art. 15)',
    recht: 'datenschutz.auskunft_erstellen' },
  { weg: 'berichtigung', titel: 'Berichtigung (Art. 16)',
    recht: 'datenschutz.berichtigung_bearbeiten' },
  { weg: 'loeschung', titel: 'Löschung (Art. 17)',
    recht: 'datenschutz.loeschung_pruefen' },
];

export function Feld({ kopf, children }: {
  readonly kopf: string; readonly children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{kopf}</dt>
      <dd className="m-0 mt-s1 text-sm text-text">{children}</dd>
    </div>
  );
}

export function Fristanzeige({ z }: { readonly z: AnfrageZeile }) {
  const erledigt = ['beantwortet', 'abgelehnt'].includes(z.status);
  const wirksam = z.verlaengertBis ?? z.fristAm;
  if (erledigt) {
    return <span className="text-text-muted">{BERLIN_TAG.format(new Date(wirksam))}</span>;
  }
  return (
    <span className={z.tageBisFrist < 0 ? 'text-danger' : 'text-text'}>
      {BERLIN_TAG.format(new Date(wirksam))}
      <span className="block text-xs">
        {z.tageBisFrist < 0
          ? `seit ${String(-z.tageBisFrist)} Tag(en) überfällig`
          : `noch ${String(z.tageBisFrist)} Tag(e)`}
      </span>
      {z.verlaengertBis === null ? null : (
        <span className="block text-xs text-text-muted">
          verlängert (Art. 12 Abs. 3 Satz 3)
        </span>
      )}
    </span>
  );
}

export function Vorgangskopf({ mandant, z, zuordnung, aktiv, darf }: {
  readonly mandant: string;
  readonly z: AnfrageZeile;
  readonly zuordnung: Zuordnung;
  /** Welche Unterseite gerade offen ist — `null` auf der Akte selbst. */
  readonly aktiv: string | null;
  readonly darf: Readonly<Record<string, boolean>>;
}) {
  return (
    <>
      {/*
        * **Der Rückweg steht nicht mehr hier, sondern in der Hülle** (D-613).
        *
        * Er wurde aus der Adresse abgeleitet, gegen die Rechte seines ZIELS
        * geprüft und einmal gezeichnet — oben im `main`, wo er auf jeder
        * Portalseite steht. Zwei Rückwege untereinander waren die Folge davon,
        * dass diese Datei ihren eigenen behielt.
        *
        * **Was bleibt, ist die Auskunft für den Fall ohne Rückweg.** Das Tor
        * des Posteingangs verlangt `datenschutz.auskunft_erstellen` (Register,
        * §5.25) und antwortet sonst mit 404; wer als Träger von
        * `berichtigung_bearbeiten` den VORGANG lesen darf, sieht deshalb keinen
        * Pfeil — ein Menüpunkt, der auf 404 führt, ist schlechter als keiner
        * (AUT-06). Ohne diesen Satz sähe er stattdessen ein Blatt ohne Ausgang
        * und wüsste nicht, warum.
        */}
      {darf['datenschutz.auskunft_erstellen'] === true ? null : (
        <p className="mb-s3 text-sm text-text-subtle" data-cse="ohne-posteingang">
          Der gemeinsame Posteingang verlangt
          {' '}<Recht schluessel="datenschutz.auskunft_erstellen" />.
          Dieser Vorgang ist über seine Adresse erreichbar.
        </p>
      )}

      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{ART_TEXT[z.art].kurz}</h1>
        <StatusPill zustand={STATUS_PILLE[z.status] ?? 'Offen'} />
        <span className="text-sm text-text-muted">
          {STATUS_WORT[z.status] ?? z.status}
        </span>
      </div>

      <dl data-cse="vorgang-kopf"
          className="m-0 mb-s5 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <Feld kopf="Anfragende Person">
          {z.name}
          <span className="block text-xs text-text-muted">{z.email}</span>
        </Feld>
        {/*
          * **Der Eingang nennt seinen WEG** (V-031, Art. 12 Abs. 1).
          *
          * Solange das öffentliche Formular die einzige Quelle war, war der
          * Weg selbstverständlich und musste nirgends stehen. Seit das Büro
          * Brief, Anruf und E-Mail aufnehmen kann, ist er die Angabe, an der
          * die Frist hängt: beim Formular ist der Eingang gemessen, sonst
          * protokolliert — und wer ihn protokolliert hat, steht daneben.
          */}
        <Feld kopf="Eingegangen">
          {BERLIN.format(new Date(z.eingegangenAm))}
          <span className="block text-xs text-text-muted" data-cse="eingangsweg">
            {WEG_TEXT[z.eingangsweg]}
            {z.erfasstVon === null ? null : ` · aufgenommen von ${z.erfasstVon}`}
          </span>
        </Feld>
        <Feld kopf="Frist (Art. 12 Abs. 3)"><Fristanzeige z={z} /></Feld>
        <Feld kopf="Zuordnung">
          {zuordnung.art === 'keine' ? (
            <span className="text-warning">noch nicht zugeordnet</span>
          ) : (
            <>
              {zuordnung.pfad === null || zuordnung.name === null ? (
                zuordnung.name ?? 'nicht lesbar'
              ) : (
                /*
                 * Ein gewoehnliches `<a>` und kein `next/link`: `typedRoutes`
                 * prueft `Link href` gegen die bekannten Routen, und dieses
                 * Ziel entsteht zur Laufzeit im Dienst. Ein Cast haette die
                 * Pruefung ausgeschaltet statt sie zu erfuellen — dieselbe
                 * Entscheidung wie in `KachelRaster.tsx`.
                 */
                <a href={zuordnung.pfad} data-cse="zuordnung-ziel"
                   className="text-text underline-offset-2 hover:text-brand hover:underline">
                  {zuordnung.name}
                </a>
              )}
              <span className="block text-xs text-text-muted">
                {ZUORDNUNG_TEXT[zuordnung.art]}
              </span>
            </>
          )}
        </Feld>
      </dl>

      {z.verlaengertGrund === null ? null : (
        <Hinweis art="hinweis" cse="vorgang-verlaengerung" className="mb-s5 max-w-prose">
          <strong className="block">Frist verlängert.</strong>
          {z.verlaengertGrund}
        </Hinweis>
      )}

      {z.entscheidung === null ? null : (
        <Hinweis art="erfolg" cse="vorgang-entscheidung" className="mb-s5 max-w-prose">
          <strong className="block">
            {`Entschieden am ${z.beantwortetAm === null
              ? '—' : BERLIN.format(new Date(z.beantwortetAm))}`}
          </strong>
          {z.entscheidung}
        </Hinweis>
      )}

      {/*
        * Die drei Wege des Vorgangs — und nur die, die diese Sitzung öffnen
        * darf. Ein Verweis auf ein fehlendes Recht führt auf 404 und verrät
        * damit die Existenz dessen, was er nicht zeigen darf (AUT-06).
        */}
      <nav aria-label="Vorgang" data-cse="vorgang-wege"
           className="mb-s6 flex flex-wrap gap-s3 border-b border-line pb-s3">
        <Link href={`/portal/${mandant}/datenschutz/${z.id}`}
              aria-current={aktiv === null ? 'page' : undefined}
              className={aktiv === null
                ? 'text-sm font-semibold text-text'
                : 'text-sm text-text-muted hover:text-text'}>
          Akte
        </Link>
        {UNTERSEITEN.filter((u) => darf[u.recht] === true).map((u) => (
          <Link key={u.weg} href={`/portal/${mandant}/datenschutz/${z.id}/${u.weg}`}
                aria-current={aktiv === u.weg ? 'page' : undefined}
                className={aktiv === u.weg
                  ? 'text-sm font-semibold text-text'
                  : 'text-sm text-text-muted hover:text-text'}>
            {u.titel}
          </Link>
        ))}
      </nav>
    </>
  );
}
