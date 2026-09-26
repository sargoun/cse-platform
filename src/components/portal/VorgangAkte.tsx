import type { ReactNode } from 'react';
import Link from 'next/link';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { VORGANG_AKTE_TEXTE, type AkteArt } from '@/lib/i18n/verwaltung/vorgang-akte';
import type { PortalSprache } from '@/lib/i18n/texte';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { tagInSprache } from '@/lib/datum/kalendertag';
import type { AufgabenAkte } from '@/server/services/kern/aufgabe';
import type { VorgangsDokumente } from '@/server/services/dokument/vorgang';

/**
 * Aufgaben und Dokumente an einem Auftrag — EIN Bauteil für das Auftrags- und
 * das Projektblatt (OPS-11, V-176, D-670).
 *
 * OPS-11 verlangt „Tasks, deadlines, status, documents on every order and
 * project". Beide Blätter zeigten bis V-176 weder das eine noch das andere:
 * Aufgaben liessen sich seit V-096 mit einem Auftrag verknüpfen, erschienen
 * aber nur in der Gesamtliste, und Dokumente kannten keinen Auftrag.
 *
 * **Das Bauteil rechnet nichts.** Zahlen, Fristlage und Fristtext kommen
 * fertig aus `aufgabenAkte` (Dienst, geprüft); hier wird nur gezeigt.
 *
 * **Ein fehlendes Recht ist ein Satz, keine leere Liste.** `null` heisst: die
 * Seite hält das Leserecht nicht — dann steht, welches Recht fehlt, statt
 * „nichts vorhanden" zu behaupten. Verweise stehen nur, wo die Seite das
 * Recht ihres Ziels erhoben hat (AUT-06): die Liste und die Einzelseiten nur
 * mit Leserecht, „Aufgabe anlegen" und „Dokument ablegen" nur mit dem
 * Schreibrecht.
 */

const VERWEIS = 'text-text underline-offset-2 hover:text-brand hover:underline';
const KNOPF = 'inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm '
  + 'text-text hover:bg-surface-2';

export function VorgangAkte({
  art, sprache, mandant, filter, aufgaben, dokumente, auftragId, darf, hinweis,
}: {
  readonly art: AkteArt;
  readonly sprache: PortalSprache | null;
  readonly mandant: string;
  /** Der Filter der Aufgabenliste, `auftrag=<id>` oder `projekt=<id>`. */
  readonly filter: string;
  /** `null`: die Seite hält `aufgabe.lesen` nicht. */
  readonly aufgaben: AufgabenAkte | null;
  /** `null`: die Seite hält `dokument.lesen` nicht. */
  readonly dokumente: VorgangsDokumente | null;
  /**
   * Der Auftrag, an dem die Dokumente hängen und an den ein neues gehängt
   * wird — auf dem Projektblatt der Auftrag des Projekts (jedes hat genau
   * einen, 0071).
   */
  readonly auftragId: string;
  readonly darf: { readonly aufgabeSchreiben: boolean; readonly dokumentSchreiben: boolean };
  /** Ein Satz über beiden Hälften — auf dem Projektblatt: woher die Akte kommt. */
  readonly hinweis?: ReactNode;
}) {
  const t = nachSprache(VORGANG_AKTE_TEXTE, sprache);

  return (
    <section aria-label={`${t.aufgabenTitel} · ${t.dokumenteTitel}`} className="mt-s7"
             data-cse="vorgang-akte" data-art={art}>
      {hinweis === undefined ? null : (
        <p className="mb-s4 max-w-prose text-sm text-text-muted" data-cse="akte-hinweis">
          {hinweis}
        </p>
      )}
      <div className="grid grid-cols-1 gap-s6 lg:grid-cols-2">
        {/* ---------------------------------------------------------- Aufgaben */}
        <section aria-labelledby="akte-aufgaben" data-cse="akte-aufgaben">
          <h2 id="akte-aufgaben" className="mb-s2 text-h3 text-text">{t.aufgabenTitel}</h2>
          <p className="mb-s3 text-sm text-text-muted">{t.aufgabenErklaerung[art]}</p>
          {aufgaben === null ? (
            <Hinweis art="hinweis" cse="akte-aufgaben-ohne-recht">
              {t.aufgabenOhneRecht} <Recht schluessel="aufgabe.lesen" sprache={sprache} />
            </Hinweis>
          ) : (
            <>
              <p className="mb-s3 flex flex-wrap gap-s4 text-sm text-text-muted">
                <span data-cse="akte-aufgaben-offen" data-anzahl={String(aufgaben.offen)}>
                  {t.aufgabenOffen(aufgaben.offen)}
                </span>
                {aufgaben.ueberfaellig > 0 ? (
                  <span className="text-danger" data-cse="akte-aufgaben-ueberfaellig"
                        data-anzahl={String(aufgaben.ueberfaellig)}>
                    {t.aufgabenUeberfaellig(aufgaben.ueberfaellig)}
                  </span>
                ) : null}
              </p>
              {aufgaben.zeilen.length === 0 ? (
                <p className="mb-s3 text-sm text-text-muted" data-cse="akte-aufgaben-leer">
                  {aufgaben.geschlossen === 0
                    ? t.aufgabenLeer[art]
                    : t.aufgabenKeineOffenen(aufgaben.geschlossen)}
                </p>
              ) : (
                <ul className="mb-s3 flex flex-col gap-s2" data-cse="akte-aufgaben-liste">
                  {aufgaben.zeilen.map(({ zeile, lage, frist }) => (
                    <li key={zeile.id} data-cse="akte-aufgabe" data-status={zeile.status}
                        data-lage={lage}
                        className="rounded-md border border-line bg-surface p-s3 text-sm">
                      <Link href={`/portal/${mandant}/aufgaben/${zeile.id}`} className={VERWEIS}>
                        {zeile.titel}
                      </Link>
                      <span className="mt-s1 block text-xs text-text-muted">
                        {/* V-240: ein unbekannter Stand heisst so — nicht „offen". */}
                        {eigenerEintrag(t.zustand, zeile.status) ?? t.zustandUnbekannt}
                        {' · '}
                        <span className={lage === 'ueberfaellig' ? 'text-danger'
                          : lage === 'heute' ? 'text-warning' : ''}>
                          {frist ?? t.ohneFrist}
                          {lage === 'ueberfaellig' ? ` · ${t.ueberfaellig}` : ''}
                        </span>
                        {zeile.zugewiesenAn === null && zeile.team === null
                          ? '' : ` · ${zeile.zugewiesenAn ?? zeile.team ?? ''}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {aufgaben.weitere > 0 ? (
                <p className="mb-s3 text-xs text-text-muted" data-cse="akte-aufgaben-weitere">
                  {t.aufgabenWeitere(aufgaben.weitere)}
                </p>
              ) : null}
              <p className="m-0 flex flex-wrap gap-s3">
                <Link href={alsRoute(`/portal/${mandant}/aufgaben?${filter}&alle=1`)}
                      data-cse="akte-aufgaben-alle" className={KNOPF}>
                  {t.aufgabenAlle[art]}
                </Link>
                {darf.aufgabeSchreiben ? (
                  <Link href={alsRoute(`/portal/${mandant}/aufgaben?${filter}#neue-aufgabe`)}
                        data-cse="akte-aufgabe-anlegen" className={KNOPF}>
                    {t.aufgabeAnlegen}
                  </Link>
                ) : null}
              </p>
            </>
          )}
        </section>

        {/* --------------------------------------------------------- Dokumente */}
        <section aria-labelledby="akte-dokumente" data-cse="akte-dokumente">
          <h2 id="akte-dokumente" className="mb-s2 text-h3 text-text">{t.dokumenteTitel}</h2>
          <p className="mb-s3 text-sm text-text-muted">{t.dokumenteErklaerung[art]}</p>
          {dokumente === null ? (
            <Hinweis art="hinweis" cse="akte-dokumente-ohne-recht">
              {t.dokumenteOhneRecht} <Recht schluessel="dokument.lesen" sprache={sprache} />
            </Hinweis>
          ) : (
            <>
              {dokumente.zeilen.length === 0 ? (
                <p className="mb-s3 text-sm text-text-muted" data-cse="akte-dokumente-leer">
                  {t.dokumenteLeer[art]}
                </p>
              ) : (
                <ul className="mb-s3 flex flex-col gap-s2" data-cse="akte-dokumente-liste">
                  {dokumente.zeilen.map((d) => (
                    <li key={d.id} data-cse="akte-dokument"
                        className="rounded-md border border-line bg-surface p-s3 text-sm">
                      <Link href={`/portal/${mandant}/dokumente/${d.id}`} className={VERWEIS}>
                        {d.titel}
                      </Link>
                      <span className="mt-s1 block text-xs text-text-muted">
                        {eigenerEintrag(t.kategorie, d.kategorie) ?? t.kategorieUnbekannt}
                        {' · '}
                        {t.abgelegtAm(tagInSprache(d.abgelegtAm, sprache))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {dokumente.weitere > 0 ? (
                <p className="mb-s3 text-xs text-text-muted" data-cse="akte-dokumente-weitere">
                  {t.dokumenteWeitere(dokumente.weitere)}
                </p>
              ) : null}
              {darf.dokumentSchreiben ? (
                <p className="m-0">
                  <Link href={alsRoute(`/portal/${mandant}/dokumente/upload?auftrag=${auftragId}`)}
                        data-cse="akte-dokument-ablegen" className={KNOPF}>
                    {t.dokumentAblegen}
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </section>
      </div>
    </section>
  );
}
