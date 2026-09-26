import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable, type Spalte } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  type FormularZustand, ZUSTAND_TEXT, reaktionszeitText,
} from '@/lib/formular/pflege';
import { listeFormulare, type FormularZeile } from '@/server/services/inhalt/formular';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { WebsiteSpruenge } from '../spruenge';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/website/formulare` — die Anfrageformulare dieser
 * Gesellschaft (REQ-01 … REQ-04, §5.21).
 *
 * **Warum die Liste Versionen zeigt und nicht Formulare.**
 * `formular_definition_live_uk` lässt je Schlüssel genau EINE lebende Version
 * zu, und `formular_eingang` zeigt per Fremdschlüssel auf genau die Version,
 * die der Besucher ausgefüllt hat. Eine Liste, die nur „das Formular" führte,
 * verschwiege, was eine alte Einsendung eigentlich beantwortet hat — und
 * verleitete dazu, eine lebende Feldliste an ihrem Platz zu ändern.
 *
 * **Kein Löschknopf.** Eine Definition, auf die Eingänge zeigen, wird
 * zurückgezogen und nicht entfernt (Invariante 8, `verhindere_loeschung`).
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Formulare' };

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const PILLE: Readonly<Record<FormularZustand, PillZustand>> = {
  entwurf: 'Entwurf', live: 'Aktiv', zurueckgezogen: 'Archiviert',
};

export default async function WebsiteFormulare(
  { params }: { params: Promise<{ mandant: string }> },
) {
  const { mandant } = await params;
  const tor = await mandantTor(`/portal/${mandant}/website/formulare`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;

  /*
   * **`formular.lesen` ist NICHT dasselbe wie `formular.schreiben`, und diese
   * Seite hängt an beiden.** Die Route ist im Manifest mit
   * `formular.schreiben` bewacht; `t_formular_schreiben` ist `for all`, also
   * sieht diese Sitzung die Definitionen. Die Zuständigkeit
   * (`t_zustaendigkeit`) und die Eingänge (`t_eingang_lesen`) verlangen
   * dagegen `formular.lesen` — und die Rolle `formular_eingang` hält das
   * erste ausdrücklich ohne das zweite. Für sie käme die Reaktionszeit als
   * `null` und die Zahl der Eingänge als `0` zurück. „0 Anfragen" wäre dann
   * eine falsche Auskunft, und zwar eine beruhigende.
   */
  const darf = await haeltRechte(zugang.sitzung, 'formular.lesen');
  const liest = darf['formular.lesen'] === true;

  const zeilen = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, (kontext) => listeFormulare(kontext))
  ) as Promise<readonly FormularZeile[]>);

  const spalten: readonly Spalte<FormularZeile>[] = [
    {
      schluessel: 'schluessel', kopf: 'Formular',
      zelle: (z) => (
        <Link
          href={`/portal/${mandant}/website/formulare/${z.id}`}
          data-cse="formular"
          data-schluessel={z.schluessel}
          className="block min-w-0"
        >
          <span className="font-mono text-sm text-text underline underline-offset-4 hover:text-brand">
            {z.schluessel}
          </span>
          <span className="mt-s1 block text-xs text-text-subtle">{z.titel}</span>
        </Link>
      ),
    },
    {
      schluessel: 'version', kopf: 'Version', numerisch: true,
      zelle: (z) => z.version,
    },
    {
      schluessel: 'felder', kopf: 'Felder', numerisch: true,
      zelle: (z) => z.felderZahl,
    },
    {
      schluessel: 'zustand', kopf: 'Zustand',
      zelle: (z) => (
        <span className="inline-flex flex-wrap items-center gap-s2"
              data-cse="formular-zustand" data-zustand={z.zustand}>
          <StatusPill zustand={PILLE[z.zustand]} />
          {z.veroeffentlichtAm === null ? null : (
            /*
             * `veroeffentlicht_am` ist der ERSTE Zeitpunkt, nicht der letzte:
             * der Auslöser `kern.erzwinge_serverzeit_veroeffentlichung` friert
             * ihn nach dem ersten Mal ein. Eine Version, die zurückgezogen und
             * wieder live gestellt wurde, trägt hier weiter ihr Datum von
             * vorher — deshalb steht das Wort daneben und nicht nur die Zahl.
             */
            <span className="text-xs text-text-muted" data-cse="erstmals-live">
              {`erstmals ${BERLIN.format(new Date(z.veroeffentlichtAm))}`}
            </span>
          )}
        </span>
      ),
    },
    {
      schluessel: 'datenschutz', kopf: 'Datenschutzhinweis',
      zelle: (z) => (
        <span className="font-mono text-xs text-text-muted">{z.datenschutzVersion}</span>
      ),
    },
    {
      schluessel: 'zustaendig', kopf: 'Zuständig',
      zelle: (z) => {
        if (!liest) {
          return <span className="text-xs text-text-subtle">nicht lesbar</span>;
        }
        if (!z.hatZustaendigkeit) {
          return (
            <span className="text-xs text-warning" data-cse="ohne-zustaendigkeit">
              keine Zuständigkeit
            </span>
          );
        }
        return (
          <span className="block min-w-0 text-xs text-text-muted">
            <span className="block text-text">
              {z.besitzerName ?? (z.besitzerId === null ? '—' : 'nicht lesbar')}
            </span>
            <span className="block">{reaktionszeitText(z.slaStunden)}</span>
          </span>
        );
      },
    },
    {
      schluessel: 'eingaenge', kopf: 'Eingänge', numerisch: true,
      zelle: (z) => (liest
        ? z.eingaenge
        : <span className="text-xs text-text-subtle">—</span>),
    },
  ];

  return (
    <PortalRahmen
      titel="Formulare"
      wurzelTitel="Website"
      bereich={mandant as BereichSchluessel}
      nurLesen={zugang.sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="formulare"
                       sitzung={zugang.sitzung} />
      <h1 className="mb-s4 text-h1 text-text">Formulare</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Was hier live steht, füllt ein Besucher auf <code className="font-mono">/angebot</code>{' '}
        aus. Eine lebende Version wird nicht an ihrem Platz geändert: jede Einsendung
        zeigt auf genau die Version, die sie gesehen hat — samt dem
        Datenschutzhinweis, den sie bestätigt hat.
      </p>

      {!liest && (
        <Hinweis art="warnung" cse="ohne-formular-lesen" className="mb-s5 max-w-prose">
          <strong className="block">Zuständigkeit und Eingänge sind hier nicht lesbar.</strong>
          Sie hängen am Recht <Recht schluessel="formular.lesen" />; diese
          Sitzung hält nur <Recht schluessel="formular.schreiben" />. Die
          Spalten stehen deshalb leer — nicht auf null.
        </Hinweis>
      )}

      {zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="keine-formulare">
          Für diese Gesellschaft ist kein Anfrageformular angelegt.{' '}
          <code className="font-mono">pnpm db:seed</code> legt den Erstbestand an; danach
          wird hier gepflegt. Ohne lebende Version antwortet{' '}
          <code className="font-mono">/angebot/{mandant}</code> mit 404.
        </Hinweis>
      ) : (
        <DataTable
          beschriftung="Formularversionen dieser Gesellschaft"
          zeilen={zeilen}
          schluessel={(z) => z.id}
          spalten={spalten}
        />
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-subtle">
        Die Reaktionszeit ist <strong>vorläufig</strong> (O-14): ob sie in Kalender- oder
        Werktagsstunden zählt und wann sie an einem Freitagabend anläuft, ist nicht
        entschieden. Die Zustände heissen{' '}
        {Object.values(ZUSTAND_TEXT).join(' · ')}.
      </p>
    </PortalRahmen>
  );
}
