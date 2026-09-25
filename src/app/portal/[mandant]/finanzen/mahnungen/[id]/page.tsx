import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { formatiereGeldIn } from '@/server/services/finanz/geld';
import { prozentTextIn } from '@/server/services/finanz/prozent';
import {
  fehlendeBriefkopfangaben, findeMahnung, mahnungstext, type MahnungStatus,
} from '@/server/services/finanz/mahnung/index';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { haeltRechte } from '@/app/portal/rechte';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { MAHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/mahnungen';

/**
 * `/portal/[mandant]/finanzen/mahnungen/[id]` — eine Mahnung, ihre Positionen
 * und die drei Schritte, die ein Mensch auslöst (FIN-15).
 *
 * **Die Herleitung steht auf dem Bildschirm, nicht nur der Betrag.** Zu jeder
 * Position stehen Verzugsbeginn, Tage, Zinssatz p. a. und der daraus
 * gerechnete Zins. Danach fragt der Anwalt des Empfängers — und wer die Zahl
 * ohne Rechenweg zeigt, kann sie nicht verteidigen.
 *
 * **Drei Formulare, drei Zustände.** Ein Entwurf lässt sich freigeben oder
 * verwerfen; eine freigegebene Mahnung lässt sich als versendet
 * dokumentieren. Was nicht dran ist, steht nicht da — ein Knopf, der
 * scheitert, ist schlechter als keiner.
 */
export const dynamic = 'force-dynamic';

const PILLE: Readonly<Record<MahnungStatus, PillZustand>> = {
  entwurf: 'Entwurf',
  freigegeben: 'Bereit',
  versendet: 'Abgeschlossen',
  erledigt: 'Abgeschlossen',
  verworfen: 'Abgelehnt',
};

export default async function MahnungDetail(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const { hinweis } = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/mahnungen`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(MAHNUNGEN_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const vorgang = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => findeMahnung(kontext, id)))
    ) as Awaited<ReturnType<typeof findeMahnung>>;
  if (vorgang === null) notFound();
  const { kopf, positionen } = vorgang;
  /*
   * Das Schreiben, wie es hinausgeht (V-213, V-214) — aus DERSELBEN Funktion,
   * aus der beim Versand das PDF entsteht. Deutsch, auch in englischer
   * Oberfläche: der Brief geht an den Kunden, nicht an den Bildschirm.
   */
  const schreiben = mahnungstext(kopf, positionen);
  const briefkopfLuecken = fehlendeBriefkopfangaben(kopf.absender);
  const darf = await haeltRechte(sitzung, 'dokument.lesen');
  const sp = zugang.sprache;
  const geld = (c: Parameters<typeof formatiereGeldIn>[0]): string => formatiereGeldIn(c, sp);

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';
  const knopf = 'mt-s4 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold '
    + 'text-white hover:bg-brand-hover';
  /*
   * Ein Primary je Ansicht (DESIGN §5): im Entwurf ist es „Freigeben";
   * „Verwerfen" steht daneben als stiller Knopf (V-217) — vorher waren es zwei.
   */
  const knopfStill = 'mt-s4 min-h-11 rounded-md border border-line-strong px-s5 py-s3 '
    + 'text-base text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/finanzen/mahnungen`, text: t.alleMahnungen }}
      titel={`${t.mahnung} ${kopf.nummer ?? t.entwurf}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="mahnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >

      <div className="mb-s5 flex flex-wrap items-baseline gap-s3">
        <h1 className="text-h1 text-text">
          {kopf.bezeichnung} {kopf.nummer ?? ''}
        </h1>
        <StatusPill zustand={PILLE[kopf.status]} sprache={zugang.sprache} />
      </div>

      {typeof hinweis === 'string' && hinweis !== '' ? (
        <p
          data-cse="mahn-hinweis"
          className="mb-s5 rounded-lg border border-line bg-surface-3 p-s4 text-sm text-text"
        >
          {hinweis}
        </p>
      ) : null}

      <dl className="mb-s7 grid grid-cols-1 gap-s4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-text-muted">{g.kunde}</dt>
          <dd className="text-sm text-text">{kopf.kundeName}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.stufe}</dt>
          <dd className="text-sm text-text">{String(kopf.stufe)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.mahndatum}</dt>
          <dd className="text-sm text-text">{tagInSprache(kopf.mahndatum, sp)}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.zahlbarBis}</dt>
          <dd className="text-sm text-text">{tagInSprache(kopf.zahlbarBis, sp)}</dd>
        </div>
      </dl>

      <section aria-labelledby="positionen-titel" className="mb-s7">
        <h2 id="positionen-titel" className="mb-s3 text-h2 text-text">
          {t.positionenTitel}
        </h2>
        <DataTable
          beschriftung={t.tabellePositionen}
          zeilen={[...positionen]}
          schluessel={(p) => `${p.rechnungsnummer ?? '—'}:${p.faelligAm}`}
          spalten={[
            {
              schluessel: 'rechnung', kopf: t.rechnung,
              zelle: (p) => p.rechnungsnummer ?? '—',
            },
            {
              schluessel: 'faellig', kopf: g.faellig,
              zelle: (p) => tagInSprache(p.faelligAm, sp),
            },
            {
              schluessel: 'offen', kopf: t.offen, numerisch: true,
              zelle: (p) => geld(p.offenCent),
            },
            {
              schluessel: 'verzug', kopf: t.verzugAb,
              zelle: (p) => (p.verzugsbeginnAm === null ? '—' : tagInSprache(p.verzugsbeginnAm, sp)),
            },
            {
              schluessel: 'tage', kopf: t.tage, numerisch: true,
              zelle: (p) => String(p.verzugstage),
            },
            {
              schluessel: 'satz', kopf: t.zinssatz, numerisch: true,
              zelle: (p) => prozentTextIn(p.zinsBp, sp),
            },
            {
              schluessel: 'zins', kopf: t.zins, numerisch: true,
              zelle: (p) => geld(p.zinsCent),
            },
          ]}
        />
        <dl className="mt-s4 max-w-sm text-sm">
          <div className="flex justify-between border-t border-line py-s2">
            <dt className="text-text-muted">{t.forderung}</dt>
            <dd className="text-text">{geld(kopf.forderungCent)}</dd>
          </div>
          <div className="flex justify-between py-s2">
            <dt className="text-text-muted">{t.mahngebuehr}</dt>
            <dd className="text-text">{geld(kopf.gebuehrCent)}</dd>
          </div>
          <div className="flex justify-between py-s2">
            <dt className="text-text-muted">{t.verzugszinsen}</dt>
            <dd className="text-text">{geld(kopf.zinsenCent)}</dd>
          </div>
          <div className="flex justify-between border-t border-line py-s2">
            <dt className="text-text">{t.gesamtbetrag}</dt>
            <dd className="text-text"><strong>{geld(kopf.gesamtCent)}</strong></dd>
          </div>
        </dl>
      </section>

      {/*
        * **Das Schreiben** (V-213, V-214).
        *
        * Vorher war vom Brief nur das abgelegte PDF zu haben, und das nur
        * über die Suche unter Dokumente: das Blatt las `dokument_id` nicht.
        * Wer freigab, sah Beträge, aber nicht den Brief, den er freigab —
        * ohne Absender, ohne Anschrift, ohne Mahntext.
        */}
      <section aria-labelledby="schreiben-titel" className="mb-s7" data-cse="mahn-schreiben">
        <h2 id="schreiben-titel" className="mb-s3 text-h2 text-text">{t.schreibenTitel}</h2>
        <p className="mb-s4 max-w-prose text-xs text-text-muted">{t.schreibenErklaerung}</p>
        {briefkopfLuecken.length === 0 ? null : (
          <Hinweis art="warnung" cse="mahn-briefkopf-luecke" className="mb-s4 max-w-prose">
            {t.briefkopfFehlt}{' '}
            {briefkopfLuecken.map((a) => t.briefkopfAngaben[a]).join(', ')}.{' '}
            {t.briefkopfPflege}
          </Hinweis>
        )}
        {/*
          * **Eingefroren oder nicht** (V-217, D-709). Ab der Freigabe steht
          * der Brief in `mahnung.brief`; eine Mahnung, die vor 0449
          * freigegeben wurde, hat keinen, und ihre Vorschau zeigt die
          * heutigen Stammdaten — das sagt der Hinweis, statt die Vorschau
          * als das versendete Schreiben auszugeben.
          */}
        {kopf.status === 'entwurf' || kopf.status === 'verworfen' ? null
          : kopf.briefEingefroren ? (
            <p data-cse="mahn-brief-eingefroren" className="mb-s4 max-w-prose text-xs text-text-muted">
              {t.briefEingefroren}
            </p>
          ) : (
            <Hinweis art="warnung" cse="mahn-brief-nicht-eingefroren" className="mb-s4 max-w-prose">
              {t.briefNichtEingefroren}
            </Hinweis>
          )}
        {kopf.textbaustein === null || kopf.textbaustein.trim() === '' ? (
          <Hinweis cse="mahn-ohne-mahntext" className="mb-s4 max-w-prose">
            {t.mahntextFehlt}
          </Hinweis>
        ) : null}
        <div lang="de"
             className="max-w-prose whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text">
          {schreiben}
        </div>
        {kopf.dokumentId === null ? null : darf['dokument.lesen'] === true ? (
          <p className="mt-s4">
            <a
              href={`/api/dokumente/${kopf.dokumentId}/datei`}
              className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-s4 text-sm text-text hover:bg-surface-2"
              data-cse="mahn-schreiben-oeffnen"
            >
              {t.schreibenOeffnen}
            </a>
            <span className="ml-s3 text-xs text-text-muted">{t.schreibenSigniert}</span>
          </p>
        ) : (
          <p className="mt-s4 text-xs text-text-muted">{t.schreibenOhneRecht}</p>
        )}
      </section>

      {kopf.verworfenGrund === null ? null : (
        <p className="mb-s7 max-w-prose rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.verworfen}: {kopf.verworfenGrund}
        </p>
      )}

      {kopf.status === 'entwurf' ? (
        <div className="grid grid-cols-1 gap-s5 lg:grid-cols-2">
          <section
            aria-labelledby="freigeben-titel"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <h2 id="freigeben-titel" className="text-h2 text-text">{g.freigeben}</h2>
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              {t.freigabeErklaerung}
            </p>
            <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="freigeben" />
              <input type="hidden" name="mahnungId" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="begruendung">
                {t.begruendung}
              </label>
              <input
                id="begruendung" name="begruendung" type="text" required
                minLength={5} className={feld}
                placeholder={t.freigabePlatzhalter}
              />
              <button type="submit" className={knopf}>{g.freigeben}</button>
            </form>
          </section>

          <section
            aria-labelledby="verwerfen-titel"
            className="rounded-lg border border-line bg-surface p-s5"
          >
            <h2 id="verwerfen-titel" className="text-h2 text-text">{t.verwerfen}</h2>
            <p className="mt-s2 max-w-prose text-xs text-text-muted">
              {t.verwerfenErklaerung}
            </p>
            <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
              <input type="hidden" name="aktion" value="verwerfen" />
              <input type="hidden" name="mahnungId" value={kopf.id} />
              <label className="block text-sm text-text" htmlFor="grund">{t.grund}</label>
              <input
                id="grund" name="grund" type="text" required minLength={5} className={feld}
                placeholder={t.verwerfenPlatzhalter}
              />
              <button type="submit" className={knopfStill}>{t.verwerfen}</button>
            </form>
          </section>
        </div>
      ) : null}

      {kopf.status === 'freigegeben' ? (
        <section
          aria-labelledby="versand-titel"
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <h2 id="versand-titel" className="text-h2 text-text">{t.versandTitel}</h2>
          <p className="mt-s2 text-xs text-text-muted">
            {t.versandErklaerung}
          </p>
          <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="versenden" />
            <input type="hidden" name="mahnungId" value={kopf.id} />
            <label className="block text-sm text-text" htmlFor="versandart">{t.weg}</label>
            <select id="versandart" name="versandart" required className={feld}>
              <option value="brief">{t.versandarten.brief}</option>
              <option value="einschreiben">{t.versandarten.einschreiben}</option>
              <option value="bote">{t.versandarten.bote}</option>
            </select>
            <label className="mt-s4 block text-sm text-text" htmlFor="empfaenger">
              {t.empfaenger}
            </label>
            <input
              id="empfaenger" name="empfaenger" type="text" required className={feld}
              placeholder={kopf.kundeName}
            />
            <button type="submit" className={knopf}>{t.versandTitel}</button>
          </form>
        </section>
      ) : null}

      {/*
        * **Abschliessen** (V-084).
        *
        * `mahn_status` kennt `erledigt` seit `0125`, beide Zustandsauslöser
        * lassen `versendet → erledigt` ausdrücklich zu — geschrieben hat ihn
        * nie jemand. Jede jemals versendete Mahnung stand für immer als offen
        * da, und ob eine Sache erledigt war, wusste nur, wer das Bankkonto
        * danebenlegte.
        */}
      {kopf.status === 'versendet' ? (
        <section
          aria-labelledby="erledigt-titel"
          data-cse="mahnung-erledigen"
          className="mt-s5 max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <h2 id="erledigt-titel" className="text-h2 text-text">{t.erledigenTitel}</h2>
          <p className="mt-s2 text-xs text-text-muted">{t.erledigenErklaerung}</p>
          <form method="post" action={`/api/finanzen/mahnungen?mandant=${mandant}`}>
            <input type="hidden" name="aktion" value="erledigen" />
            <input type="hidden" name="mahnungId" value={kopf.id} />
            <button type="submit" className={knopf}>{t.erledigenKnopf}</button>
          </form>
        </section>
      ) : null}
    </PortalRahmen>
  );
}
