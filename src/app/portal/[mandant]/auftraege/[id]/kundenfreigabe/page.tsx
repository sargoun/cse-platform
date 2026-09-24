import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  freigabeGilt, ladeFreigabestand, listeAnsprechpartner, listeKundendokumente,
  referenzfaehig, referenzHindernis,
} from '@/server/services/auftrag/kundenfreigabe';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { WEBSITE_REFERENZ_TEXTE } from '@/lib/i18n/verwaltung/website-referenz';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { FELD, FEHLERTEXT, PLATZHALTER_WORTLAUT } from './daten';
import { Recht } from '@/components/ui/Recht';

/**
 * `/portal/[mandant]/auftraege/[id]/kundenfreigabe` — die schriftliche
 * Erlaubnis des Kunden, das Projekt oeffentlich zu nennen (PRO-05).
 *
 * **Diese Seite veroeffentlicht nichts.** Sie haelt einen BELEG fest, und
 * nichts weiter. PRO-05 trennt zwei Handlungen, und die Trennung ist der
 * ganze Punkt: hier steht, dass der Kunde zugestimmt hat; die oeffentliche
 * `referenz`-Zeile legt danach ein Mensch unter `/website/referenzen` an und
 * kopiert dabei nur Titel, Bereich, Stadt, Beschreibung und freigegebene
 * Fotos. Eine automatische Uebernahme waere eine Veroeffentlichung, die
 * niemand entschieden hat (Invariante 7) — und `referenz` traegt aus genau
 * diesem Grund keinen Fremdschluessel auf `auftrag`.
 *
 * **Drei Angaben sind PFLICHT**, sobald die Freigabe gilt — nicht aus
 * Formstrenge, sondern weil der CHECK
 * `auftrag_referenzfreigabe_vollstaendig` alle drei verlangt: Zeitpunkt,
 * Ansprechpartner und das hinterlegte Schreiben. Das Schreiben ist also kein
 * Beiwerk. **Und das Datum gibt niemand ein:** der Ausloeser
 * `kern.auftrag_freigabe_stempeln` setzt es aus der Serveruhr (Invariante 5).
 */
export const dynamic = 'force-dynamic';

export default async function Kundenfreigabe(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/auftraege/${id}/kundenfreigabe`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;
  const darf = await haeltRechte(
    sitzung, 'auftrag.lesen', 'referenz.schreiben', 'dokument.lesen', 'crm.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const stand = await ladeFreigabestand(kontext, id);
      if (stand === null) return null;
      /**
       * Beide Auswahllisten nur, wenn die Sitzung sie auch lesen darf.
       *
       * Ohne `dokument.lesen` antwortet `dokument` korrekt mit nichts — und
       * eine leere Liste sagte „dieser Kunde hat kein Schreiben" statt „Sie
       * sehen seine Schreiben nicht". Der Unterschied entscheidet, ob jemand
       * ein Dokument hochlaedt oder nach einem Recht fragt (AUT-05).
       */
      const ansprechpartner = await listeAnsprechpartner(kontext, stand.kunde_id);
      const dokumente = stand.darf_dokument_lesen
        ? await listeKundendokumente(kontext, stand.kunde_id)
        : [];
      return { stand, ansprechpartner, dokumente };
    })) as Promise<{
      stand: NonNullable<Awaited<ReturnType<typeof ladeFreigabestand>>>;
      ansprechpartner: Awaited<ReturnType<typeof listeAnsprechpartner>>;
      dokumente: Awaited<ReturnType<typeof listeKundendokumente>>;
    } | null>);

  if (daten === null) notFound();
  const { stand, ansprechpartner, dokumente } = daten;

  const widerrufen = stand.widerrufen_am !== null;
  const gilt = freigabeGilt(stand);
  const tReferenz = nachSprache(WEBSITE_REFERENZ_TEXTE, zugang.sprache);
  /**
   * Erfassen darf, wer KEINE GELTENDE Freigabe vor sich hat — nicht: wer keine
   * Freigabe vor sich hat.
   *
   * Nach einem Widerruf bleibt `freigegeben_vom_kunden` auf `true` stehen (der
   * CHECK verlangt es, solange die drei Pflichtangaben da sind). An
   * `!stand.freigegeben` gehaengt, verschwand das Erfassungsformular damit fuer
   * immer: der Widerruf war eine Sackgasse, und ein Kunde, der seine Meinung
   * ein zweites Mal aendert, hatte im Portal keinen Weg zurueck.
   */
  const kannErfassen = !gilt && ansprechpartner.length > 0
    && dokumente.length > 0;

  return (
    <PortalRahmen
      titel={`Kundenfreigabe — ${stand.auftragsnummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={sitzung.ansicht === 'gruppe'}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['auftrag.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/auftraege/${id}`, text: stand.auftragsnummer } }
        : {})}
    >
      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">Kundenfreigabe</h1>
        <StatusPill
          zustand={gilt ? 'Bereit' : widerrufen ? 'Abgelehnt' : 'Wartet'}
        />
      </div>

      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Der Beleg, dass <strong>{stand.kunde}</strong> schriftlich erlaubt hat,
        dieses Projekt öffentlich zu nennen. Hier wird nichts veröffentlicht —
        das ist der zweite, getrennte Schritt (PRO-05).
      </p>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="freigabe-fehler" className="mb-s5">
          <strong>Nichts wurde erfasst.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Projekt</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{stand.bezeichnung}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{stand.kunde}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Objekt</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {stand.objekt ?? <span className="text-text-subtle">—</span>}
          </dd>
        </div>
      </dl>

      {/* Der erfasste Stand ----------------------------------------------- */}
      {stand.freigegeben ? (
        <Hinweis
          art={widerrufen ? 'warnung' : 'erfolg'}
          cse="freigabe-stand"
          className="mb-s6"
        >
          <strong>
            {widerrufen
              ? `Die Freigabe ist widerrufen — ${stand.widerrufen_am ?? ''}.`
              : `Die Freigabe liegt vor — erteilt ${stand.freigabe_am ?? ''}.`}
          </strong>
          {widerrufen && (
            <p className="mt-s3 mb-0 text-sm">
              Der <strong>Grund</strong> des Widerrufs steht im Prüfprotokoll,
              nicht hier: der Wortlaut unten ist die Erklärung des Kunden und
              bleibt, wie der Kunde sie erklärt hat. Eine neue Erklärung lässt
              sich unten erfassen — sie hebt den Widerruf auf.
            </p>
          )}
          <dl className="m-0 mt-s4 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s2">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Erklärt von
            </dt>
            <dd className="m-0 text-sm">
              {stand.ansprechpartner ?? <span className="text-text-subtle">—</span>}
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Schreiben
            </dt>
            <dd className="m-0 text-sm">
              {stand.freigabe_dokument === null ? (
                <span className="text-text-subtle">
                  {stand.darf_dokument_lesen
                    ? '—'
                    : 'hinterlegt, aber Ihnen nicht sichtbar (dokument.lesen fehlt)'}
                </span>
              ) : darf['dokument.lesen'] === true && stand.freigabe_dokument_id !== null ? (
                <Link
                  href={`/portal/${mandant}/dokumente/${stand.freigabe_dokument_id}`}
                  className="underline underline-offset-2 hover:underline"
                >
                  {stand.freigabe_dokument}
                </Link>
              ) : (
                stand.freigabe_dokument
              )}
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Wortlaut
            </dt>
            <dd className="m-0 whitespace-pre-line text-sm">
              {stand.freigabe_text ?? <span className="text-text-subtle">—</span>}
            </dd>
          </dl>
        </Hinweis>
      ) : null}

      {/* Das Formular ----------------------------------------------------- */}
      {gilt ? null : kannErfassen ? (
        <section aria-labelledby="erfassen" className="mb-s7">
          <h2 id="erfassen" className="text-h2 text-text">
            {widerrufen ? 'Die Erlaubnis erneut festhalten' : 'Die Erlaubnis festhalten'}
          </h2>
          {widerrufen && (
            <p className="mt-s2 max-w-prose text-sm text-text-muted">
              Die frühere Freigabe ist widerrufen. Eine neue Erklärung des
              Kunden hebt den Widerruf auf; der Vorgang steht im Prüfprotokoll,
              mit Grund, Mensch und Zeitpunkt.
            </p>
          )}
          <form
            method="post"
            action="/api/auftrag/kundenfreigabe"
            data-cse="kundenfreigabe-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="auftragId" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="block text-sm text-text" htmlFor="ansprechpartnerId">
              Wer hat sie erklärt?
            </label>
            <select id="ansprechpartnerId" name="ansprechpartnerId" required className={FELD}>
              {ansprechpartner.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? 'ohne Namen'}
                  {a.rolle === null ? '' : ` — ${a.rolle}`}
                </option>
              ))}
            </select>
            <p className="mt-s1 text-xs text-text-muted">
              Nur Ansprechpartner <strong>dieses</strong> Kunden; ausgeschiedene
              und anonymisierte stehen nicht zur Wahl. Ein Name, der im Streitfall
              nicht mehr da ist, ist kein Beleg.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="dokumentId">
              Das hinterlegte Schreiben
            </label>
            <select id="dokumentId" name="dokumentId" required className={FELD}>
              {dokumente.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.titel} ({d.kategorie}, {d.entstanden})
                </option>
              ))}
            </select>
            <p className="mt-s1 text-xs text-text-muted">
              <strong>Pflicht.</strong> Der CHECK{' '}
              <code>auftrag_referenzfreigabe_vollstaendig</code> verlangt es —
              eine Freigabe ohne Beleg ist eine Behauptung. Es muss ein Dokument{' '}
              <em>dieses</em> Kunden sein; das prüft der Dienst, denn die
              Datenbank hat auf dieses Feld keinen Fremdschlüssel.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="text">
              Wortlaut oder Verweis
            </label>
            <textarea
              id="text"
              name="text"
              rows={4}
              required
              placeholder={PLATZHALTER_WORTLAUT}
              className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />

            <p className="mt-s4 text-xs text-text-muted">
              Das <strong>Datum</strong> geben Sie nicht ein: es kommt aus der
              Serveruhr, sobald die Freigabe gilt (Invariante 5). Ein Datum aus
              dem Formular wäre das, was jemand getippt hat.
            </p>

            <button
              type="submit"
              data-cse="freigabe-erfassen"
              className="mt-s4 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              {widerrufen ? 'Freigabe erneut festhalten' : 'Freigabe festhalten'}
            </button>
          </form>
        </section>
      ) : (
        <Hinweis art="warnung" cse="freigabe-unmoeglich" className="mb-s6">
          <strong>Die Freigabe lässt sich hier noch nicht abschließen.</strong>
          <ul className="mt-s3 mb-0 list-disc pl-s5">
            {ansprechpartner.length === 0 && (
              <li>
                Zu {stand.kunde} ist kein Ansprechpartner hinterlegt. Eine
                Erlaubnis, die niemand erklärt hat, gibt es nicht —
                {darf['crm.lesen'] === true ? (
                  <>
                    {' '}erst in der{' '}
                    <Link
                      href={`/portal/${mandant}/crm/kunden/${stand.kunde_id}`}
                      className="text-text underline underline-offset-2 hover:text-brand"
                    >
                      Kundenakte
                    </Link>{' '}
                    einen anlegen.
                  </>
                ) : ' erst einen in der Kundenakte anlegen.'}
              </li>
            )}
            {!stand.darf_dokument_lesen && (
              <li>
                Ihnen fehlt <Recht schluessel="dokument.lesen" />; ob
                ein Schreiben hinterlegt ist, lässt sich von hier aus nicht
                sehen — und das heißt nicht, dass keines da ist.
              </li>
            )}
            {stand.darf_dokument_lesen && dokumente.length === 0 && (
              <li>
                Zu {stand.kunde} ist kein Dokument abgelegt. Das Schreiben ist{' '}
                <strong>Pflicht</strong> (
                <code className="text-text">auftrag_referenzfreigabe_vollstaendig</code>
                ) — erst die Zusage als Datei ablegen und dem Kunden zuordnen,
                dann hier auswählen.
              </li>
            )}
          </ul>
        </Hinweis>
      )}

      {/* Der Widerruf ----------------------------------------------------- */}
      {gilt ? (
        <section aria-labelledby="widerruf" className="mb-s7">
          <h2 id="widerruf" className="text-h2 text-text">Widerruf</h2>
          <form
            method="post"
            action="/api/auftrag/kundenfreigabe"
            data-cse="widerruf-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="auftragId" value={id} />
            <input type="hidden" name="aktion" value="widerrufen" />
            <input type="hidden" name="zurueck" value={pfad} />
            <label className="block text-sm text-text" htmlFor="grund">
              Grund des Widerrufs
            </label>
            <textarea
              id="grund"
              name="grund"
              rows={3}
              required
              className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />
            <p className="mt-s3 text-xs text-text-muted">
              Der Beleg, <em>dass</em> einmal freigegeben wurde, bleibt stehen —
              er zählt im Streit genauso wie der Widerruf. Was ein Widerruf für
              eine <strong>bereits veröffentlichte</strong> Referenz bedeutet, ist
              nicht entschieden: <strong>offen (O-735)</strong>. Diese Seite
              entfernt deshalb keine Referenzzeile.
            </p>
            <button
              type="submit"
              data-cse="freigabe-widerrufen"
              className="mt-s4 inline-flex min-h-11 items-center rounded-md border border-line px-s5 text-sm text-text hover:bg-surface-2"
            >
              Freigabe widerrufen
            </button>
          </form>
        </section>
      ) : null}

      {/* Die Trennung der beiden Handlungen (PRO-05) ---------------------- */}
      <Hinweis art="hinweis" cse="pro05-trennung">
        <strong>Zwei Handlungen, getrennt.</strong> Dies hier ist der Beleg am
        Auftrag. Die öffentliche Referenz legt danach ein Mensch an und
        entscheidet dabei, <em>was</em> öffentlich wird — übernommen werden nur
        Titel, Bereich, Stadt, Beschreibung und freigegebene Fotos, nie
        Auftragswert, Ansprechpartner oder Vertragsinhalte.
        {/*
          * **Der Weg dorthin (V-154, V-161).** Dieser Absatz versprach die
          * Anlage, und es gab sie nicht. Jetzt führt er hin — nur, wenn aus
          * dem Auftrag eine Referenz entstehen DARF (`referenzfaehig`:
          * geltende Freigabe UND abgeschlossen, PRO-05), nur mit
          * `referenz.schreiben` (das Tor der Zielseite) und nicht in der
          * Gruppenansicht. Gilt die Freigabe, läuft der Auftrag aber noch,
          * sagt der Absatz, wann der Weg aufgeht, statt ihn stumm
          * wegzulassen. Vorbelegt werden Titel und Kundenname; die Freigabe
          * der Referenz trägt ein Mensch selbst ein.
          */}
        {referenzfaehig(stand) && darf['referenz.schreiben'] === true
          && sitzung.ansicht !== 'gruppe' && (
          <p className="mt-s3 mb-0">
            <Link
              href={`/portal/${mandant}/website/referenzen/neu?auftrag=${id}`}
              data-cse="referenz-aus-auftrag"
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2"
            >
              {tReferenz.ausAuftragAnlegen}
            </Link>
          </p>
        )}
        {gilt && referenzHindernis(stand) === 'nicht_abgeschlossen' && (
          <p className="mt-s3 mb-0 text-text-muted" data-cse="referenz-erst-nach-abschluss">
            {tReferenz.erstNachAbschluss}
          </p>
        )}
        {stand.darf_referenz_lesen ? (
          <p className="mt-s3 mb-0">
            <span className="block" data-cse="referenzen-aus-auftrag">
              {tReferenz.ausDiesemAuftragAnzahl(Number(stand.referenzen_aus_auftrag))}
            </span>
            Es {Number(stand.referenz_gleichnamig) === 1 ? 'gibt' : 'gibt'}{' '}
            <strong>{stand.referenz_gleichnamig}</strong> Referenz(en) mit dem
            Kundennamen „{stand.kunde}". Das ist ein <em>Hinweis</em>, keine
            Zuordnung: <code>referenz</code> führt den Kundennamen als freien
            Text — zugeordnet ist nur, was aus diesem Auftrag angelegt wurde.
            {darf['referenz.schreiben'] === true ? (
              <>
                {' '}
                <Link
                  href={`/portal/${mandant}/website/referenzen`}
                  data-cse="zu-referenzen"
                  className="text-text underline underline-offset-2 hover:text-brand"
                >
                  Zu den Referenzen →
                </Link>
              </>
            ) : null}
          </p>
        ) : (
          <p className="mt-s3 mb-0 text-text-muted">
            Ob es schon eine öffentliche Referenz gibt, ist Ihnen nicht sichtbar —
            dafür fehlt <Recht schluessel="referenz.lesen" />.
          </p>
        )}
      </Hinweis>
    </PortalRahmen>
  );
}
