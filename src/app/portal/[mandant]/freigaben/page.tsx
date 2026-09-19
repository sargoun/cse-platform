import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { EINSPRUCH_MINUTEN, FENSTER_OFFENE_FRAGE }
  from '@/server/services/freigabe/fenster.platzhalter';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatiereGeld } from '@/server/services/finanz/geld';
import { ladePosteingang, type PosteingangEintrag } from '@/server/services/freigabe/laden';
import { AnmeldungNoetig } from '../../Anmeldung';
import { portalZugang } from '../../zugang';
import { slugTor } from '../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { RISIKO_LABEL, VORGANG_LABEL, zeitpunkt } from './darstellung';
import { haeltRechte } from '../../rechte';

/**
 * `/portal/[mandant]/freigaben` — der eine Posteingang (APR-01,
 * `04-SEITENKARTE.md` §5.20, D-472).
 *
 * **Die Ordnung kommt nicht aus dieser Datei.** `sortierePosteingang` ordnet
 * nach Frist, Risiko, Betrag und Alter; die Seite zeigt die Spalte, die
 * diese Ordnung erklärt, und sonst nichts. Wer die Reihenfolge ändern will,
 * ändert den Dienst und seinen Test — nicht ein `order by` in einem
 * Bildschirm.
 *
 * **Nur, was wartet und vorzeigbar ist** (`status = 'offen'`, `vorgang_typ`
 * gesetzt, D-468). Eine Freigabe, die ein Dienst in einem Schritt erteilt
 * hat, ist die Aufzeichnung einer Entscheidung und gehört nicht hierher.
 */
export const dynamic = 'force-dynamic';

export default async function Freigaben(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const stapelZahl = typeof suche['stapel'] === 'string' ? Number(suche['stapel']) : null;
  const uebersprungen = typeof suche['uebersprungen'] === 'string'
    ? Number(suche['uebersprungen']) : null;
  const verzoegert = typeof suche['verzoegert'] === 'string' ? Number(suche['verzoegert']) : null;
  const ausgefuehrt = typeof suche['ausgefuehrt'] === 'string' ? Number(suche['ausgefuehrt']) : null;
  const stapelFehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const zugang = await portalZugang(`/portal/${mandant}/freigaben`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;

  /* AUT-06: ein Knopf, dessen Ziel diese Sitzung nicht oeffnen darf,
     verraet die Existenz dessen, was er nicht zeigen darf.
     Dazu `freigabe.entscheiden`: die Pruefseite `/freigaben/[id]` verlangt es
     laut Manifest, dieser Posteingang nur `freigabe.lesen` — der Titel jeder
     Zeile fuehrte sonst auf 404 (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'freigabe.pruefdauer_lesen', 'freigabe.entscheiden');
  if (sitzung.aktiverMandantId === null) notFound();

  const jetzt = new Date();
  /**
   * **Der Stapel ist eine eigene Befugnis** (Katalog:
   * `freigabe.stapel_entscheiden`, an `admin` und `leitung` bindbar). Wer sie
   * nicht hält, bekommt keine Häkchenspalte und keinen Knopf — statt eines
   * Knopfes, der später mit 403 antwortet.
   */
  const { eintraege, darfStapel } = await (db().begin(SCHNAPPSCHUSS,
    async (tx: postgres.TransactionSql) => withTenant(tx, sitzung, async (kontext) => {
      const [recht] = await kontext.abfrage<{ hat: boolean }>(
        `select app.hat_recht('freigabe.stapel_entscheiden', app.aktiver_mandant()) as hat`);
      return {
        eintraege: await ladePosteingang(kontext, jetzt),
        darfStapel: recht?.hat === true,
      };
    }))) as { eintraege: readonly PosteingangEintrag[]; darfStapel: boolean };

  const unsicher = eintraege.filter((e) => e.unsichereFelder > 0).length;
  /**
   * **Was in den Stapel darf** (APR-04): stapelfähig UND ohne unsicheres Feld.
   * Die zweite Bedingung ist APR-03: „uncertain fields highlighted" hiesse
   * nichts, wenn ein Sammelklick sie mitnähme.
   */
  const stapelbar = eintraege.filter((e) => e.stapelFaehig && e.unsichereFelder === 0);

  return (
    <PortalRahmen
      titel="Freigaben"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="freigaben"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">Freigaben</h1>
        {/*
          * Zwei Nachbarseiten, weil sie andere Fragen beantworten: „was geht
          * gleich hinaus" (APR-05/06) und „wie schnell wird hier entschieden"
          * (APR-08). Beide lesen nur.
          */}
        <p className="flex flex-wrap gap-s3 text-sm">
          <Link href={`/portal/${mandant}/freigaben/laufend`}
                data-cse="zu-laufend"
                className="text-text underline underline-offset-2">
            Laufende Fenster
          </Link>
          <Link href={`/portal/${mandant}/freigaben/erledigt`}
                data-cse="zu-erledigt"
                className="text-text underline underline-offset-2">
            Entschieden
          </Link>
          {darf['freigabe.pruefdauer_lesen'] === true && (
            <Link href={`/portal/${mandant}/freigaben/pruefdauer`}
                  data-cse="zu-pruefdauer"
                  className="text-text underline underline-offset-2">
              Prüfdauer
            </Link>
          )}
          {/* Die Stapelmappe zeigt jeden Routinefall EINZELN, mit seinen
              geänderten Feldern (APR-02). Sie verlangt
              `freigabe.stapel_entscheiden` — wer es nicht hält, sähe hinter dem
              Verweis ein 404 (AUT-06, D-581). */}
          {darfStapel && (
            <Link href={`/portal/${mandant}/freigaben/stapel`}
                  data-cse="zur-stapelmappe"
                  className="text-text underline underline-offset-2">
              Stapelmappe
            </Link>
          )}
        </p>
        <p className="text-sm text-text-muted" data-cse="posteingang-zaehler" data-anzahl={String(eintraege.length)}>
          {eintraege.length === 0
            ? 'Nichts wartet.'
            : `${String(eintraege.length)} warten · ${String(unsicher)} mit unsicheren Feldern`}
        </p>
      </div>

      <p className="mb-s6 max-w-prose text-sm text-text-muted">
        Alles, was das Haus verlässt oder Geld bewegt, wartet hier auf einen
        Menschen (Invariante 7). Sortiert nach Frist, dann Risiko, dann Betrag;
        was gleich dringend ist, steht in der Reihenfolge seines Eintreffens.
      </p>

      {stapelZahl !== null ? (
        <Hinweis art="erfolg" cse="stapel-bericht" className="mb-s5 max-w-prose">
          <strong>{stapelZahl} genehmigt.</strong>{' '}
          {uebersprungen === null || uebersprungen === 0
            ? 'Nichts übersprungen.'
            : `${String(uebersprungen)} übersprungen — sie stehen weiter in der Liste und `
              + 'wollen einzeln angesehen werden (APR-04).'}
          {verzoegert !== null && verzoegert > 0 ? (
            <>
              {' '}
              <span data-cse="stapel-verzoegert">
                {verzoegert} davon mit laufendem Einspruchsfenster — bis es abläuft, ist
                nichts ausgelöst (APR-05).
              </span>
            </>
          ) : null}
          {ausgefuehrt !== null && ausgefuehrt > 0 ? (
            <>
              {' '}
              <span data-cse="stapel-ausgefuehrt">
                {ausgefuehrt} Handlung(en) gleich ausgeführt.
              </span>
            </>
          ) : null}
        </Hinweis>
      ) : null}
      {stapelFehler !== null ? (
        <Hinweis art="warnung" cse="stapel-fehler" className="mb-s5 max-w-prose">
          <strong>Nichts genehmigt.</strong>{' '}
          {stapelFehler === 'zu_gross'
            ? 'Mehr als fünfzig auf einmal ist keine Prüfung mehr, sondern ein Häkchen bei „alle".'
            : stapelFehler === 'kein_recht'
              ? 'Stapelweise zu genehmigen ist eine eigene Befugnis („freigabe.stapel_entscheiden"), '
                + 'und dieses Konto hält sie nicht. Einzeln entscheiden geht weiter.'
              : 'Es war nichts ausgewählt.'}
        </Hinweis>
      ) : null}

      {eintraege.length === 0 ? (
        <p
          data-cse="posteingang-leer"
          className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
        >
          Kein Vorschlag wartet auf eine Entscheidung. Neue Vorgänge erscheinen
          hier, sobald ein Agent oder ein Dienst sie vorlegt.
        </p>
      ) : (
        <form method="post" action="/api/freigaben/stapel" data-cse="stapel-formular">
        <input type="hidden" name="mandant" value={mandant} />
        <DataTable
          beschriftung="Wartende Freigaben, sortiert nach Frist und Risiko"
          zeilen={eintraege}
          schluessel={(z) => z.id}
          spalten={[
            {
              schluessel: 'stapel', kopf: 'Stapel',
              zelle: (z) => (darfStapel && z.stapelFaehig && z.unsichereFelder === 0
                ? (
                  <input type="checkbox" name="freigabe" value={z.id}
                         data-cse="stapel-auswahl" className="size-4 rounded border-line"
                         aria-label={`${z.titel} in den Stapel aufnehmen`} />
                )
                : (
                  <span className="text-xs text-text-subtle" data-cse="stapel-gesperrt">
                    {!darfStapel
                      ? 'einzeln'
                      : (z.stapelSperreGrund
                        ?? (z.unsichereFelder > 0
                          ? 'Unsicheres Feld — einzeln prüfen (APR-03)'
                          : 'Einzeln prüfen'))}
                  </span>
                )),
            },
            {
              schluessel: 'frist', kopf: 'Frist',
              zelle: (z) => (
                <span className="inline-flex flex-col gap-s1" data-dringlichkeit={String(z.dringlichkeit)}>
                  {z.dringlichkeit === 5
                    ? <StatusPill zustand="Überfällig" />
                    : <span className="text-sm text-text">{z.dringlichkeitText}</span>}
                  <span className="text-xs text-text-subtle">{zeitpunkt(z.frist)}</span>
                </span>
              ),
            },
            {
              schluessel: 'vorgang', kopf: 'Vorgang',
              zelle: (z) => (
                <span className="flex min-w-0 flex-col gap-s1">
                  {darf['freigabe.entscheiden'] === true ? (
                    <Link
                      href={`/portal/${mandant}/freigaben/${z.id}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      {z.titel}
                    </Link>
                  ) : z.titel}
                  <span className="text-xs text-text-muted">{z.zusammenfassung}</span>
                </span>
              ),
            },
            {
              schluessel: 'art', kopf: 'Art',
              zelle: (z) => VORGANG_LABEL[z.vorgangTyp],
            },
            {
              schluessel: 'risiko', kopf: 'Risiko',
              zelle: (z) => (
                <span data-risiko={z.risiko} className={z.risiko === 'hoch' ? 'text-warning' : 'text-text'}>
                  {RISIKO_LABEL[z.risiko]}
                </span>
              ),
            },
            {
              schluessel: 'betrag', kopf: 'Betrag', numerisch: true,
              zelle: (z) => (z.betragCent === null
                ? <span className="text-text-subtle">—</span>
                : formatiereGeld(z.betragCent)),
            },
            {
              schluessel: 'pruefung', kopf: 'Prüfung',
              zelle: (z) => (z.unsichereFelder > 0
                ? (
                  <span className="inline-flex flex-wrap items-center gap-s2">
                    <StatusPill zustand="Wartet" />
                    <span className="text-xs text-warning">
                      {String(z.unsichereFelder)} unsicher
                    </span>
                  </span>
                )
                : <span className="text-sm text-text-muted">{z.stapelFaehig ? 'Routine' : 'Einzeln'}</span>),
            },
          ]}
        />
        {!darfStapel ? (
          <p className="mt-s4 max-w-prose text-sm text-text-muted" data-cse="stapel-kein-recht">
            Stapelweise zu genehmigen ist eine eigene Befugnis
            („freigabe.stapel_entscheiden"), und dieses Konto hält sie nicht.
            Einzeln entscheiden geht weiter.
          </p>
        ) : stapelbar.length === 0 ? (
          <p className="mt-s4 max-w-prose text-sm text-text-muted" data-cse="stapel-keiner">
            Nichts davon ist Routine — jeder dieser Vorgänge will einzeln angesehen werden.
          </p>
        ) : (
          <div className="mt-s4 flex flex-wrap items-center gap-s3">
            <Button type="submit" variante="primary" data-cse="stapel-genehmigen">
              Ausgewählte genehmigen
            </Button>
            <p className="max-w-prose text-xs text-text-subtle">
              {stapelbar.length} von {eintraege.length} sind als Routine markiert.
              Markierte Vorgänge und solche mit unsicheren Feldern lassen sich nicht ankreuzen
              (APR-03, APR-04); jede Genehmigung bekommt trotzdem ihren eigenen Schnappschuss
              (APR-07). Risikoarme Vorgänge bekommen danach ein Einspruchsfenster von{' '}
              {String(EINSPRUCH_MINUTEN)} Minuten (APR-05, Platzhalter{' '}
              {FENSTER_OFFENE_FRAGE}).
            </p>
          </div>
        )}
        </form>
      )}
    </PortalRahmen>
  );
}
