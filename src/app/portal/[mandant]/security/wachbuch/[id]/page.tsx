import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { stundenMinutenText } from '@/lib/datum/stunden';
import { kennungOder404 } from '../../../../kennung';
import {
  ART_TEXT, leseEintrag, pruefeKette,
  type EintragZeile, type Kettenbefund,
} from '@/server/services/security/wachbuch';
import { Hinweis } from '@/components/ui/Hinweis';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { WACHBUCH_TEXTE } from '@/lib/i18n/verwaltung/wachbuch';
import { AUFNAHMEN_TEXTE } from '@/lib/i18n/verwaltung/aufnahmen';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { Aufnahmeliste, type Aufnahme } from '@/components/portal/Aufnahmeliste';
import {
  listeSchichtMedien, listeWachbuchMedien,
} from '@/server/services/mitarbeiter/medien';
import { signierteAdressen } from '@/server/services/zeit/medien';
import { waehleSpeicher } from '@/server/storage/waehle';

/**
 * `/portal/[mandant]/security/wachbuch/[id]` — eine Seite, mit Serverzeit,
 * Kettenzustand und dem Weg zur Korrektur (SEC-05, TIM-08, TIM-10, LEG-01).
 *
 * **Es gibt kein Bearbeiten-Formular, und das ist die Aussage.** Ein Eintrag
 * ist geschrieben, sobald er steht; die Datenbank weist jedes UPDATE ausser
 * dem Storno ab (0070). Was hier steht, ist das Formular für die
 * RICHTIGSTELLUNG: sie legt einen neuen Eintrag an, der auf diesen zeigt, und
 * markiert diesen als storniert. Beide bleiben lesbar.
 *
 * **Die Geräteabweichung wird GEZEIGT, nicht verschwiegen.** Zwei Stunden
 * Unterschied zwischen Telefon und Server sind eine Tatsache über die
 * Aufzeichnung, und sie gehört auf die Seite, die als Beweis dient — nicht in
 * eine Auswertung, die jemand später gegen den Menschen richtet (O-06,
 * § 87 Abs. 1 Nr. 6 BetrVG).
 *
 * **Die Fotos stehen an der Seite** (V-181, SEC-05 „with photos"): die der
 * Seite selbst und, getrennt benannt, die Aufnahmen der Schicht, an der sie
 * hängt. Beide als signierte Links, beide nur, soweit diese Anmeldung sie
 * lesen darf. Die Richtigstellung kann Fotos mitbringen — sie ist eine neue
 * Seite; an diese hier hängt niemand nachträglich eines (0467, 0469).
 *
 * **Eine Abweisung steht immer da, auch am stornierten Eintrag** (V-180,
 * D-599). Korrigieren zwei Kräfte dieselbe Seite, scheitert die zweite an
 * `SchonStorniert` (`ungueltiger_zustand`) — und landet auf einem Blatt, das
 * inzwischen storniert ist. Stand der Grund nur im Abschnitt „Richtigstellen",
 * der am stornierten Eintrag fehlt, sah die Seite aus wie ein Erfolg; Text und
 * Fotos der zweiten Kraft waren verworfen. Der Grund steht deshalb über dem
 * Blatt und verweist auf die Seite, an die eine Korrektur jetzt anknüpft.
 *
 * **Das Formular nur für den, der schreiben darf** (`wachbuch.schreiben`).
 * Das Blatt selbst verlangt nur `wachbuch.lesen`; ein Leser bekam trotzdem
 * das Formular und danach einen Grund, den keine Tabelle kannte
 * (`NICHT_GEFUNDEN` aus dem Rechtetor). Eine Wahl, die nur scheitern kann,
 * ist keine — er liest statt ihrer den Satz, warum.
 */
export const dynamic = 'force-dynamic';

export default async function Wachbuchblatt(
  {
    params, searchParams,
  }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/security/wachbuch/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const speicher = waehleSpeicher();
  const daten = await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, sitzung, async (kontext) => {
        const eintrag = await leseEintrag(kontext, id);
        if (eintrag === null) return null;
        /*
         * V-181: die Fotos DIESER Seite (`t_wachbuch_medien_lesen`,
         * wachbuch.lesen) und die Aufnahmen ihrer Schicht (Bezug `einsatz`,
         * `t_mandant` mit zeit.lesen). Was die Anmeldung nicht lesen darf,
         * kommt nicht zurueck — und dann steht hier kein Abschnitt, statt
         * „keine" zu behaupten. Die Adressen sind signiert und einzeln
         * gesichert (`signierteAdressen`).
         */
        const jetzt = Math.floor(Date.now() / 1000);
        const eigene = (await listeWachbuchMedien(kontext, [eintrag.id])).get(eintrag.id) ?? [];
        const schicht = eintrag.einsatzId === null ? []
          : await listeSchichtMedien(kontext, eintrag.einsatzId);
        return {
          eintrag,
          kette: await pruefeKette(kontext, eintrag.objektId),
          fotos: await signierteAdressen(kontext, eigene, speicher, jetzt),
          schichtFotos: await signierteAdressen(kontext, schicht, speicher, jetzt),
        };
      })) as Promise<{
        eintrag: EintragZeile; kette: Kettenbefund;
        fotos: readonly Aufnahme[]; schichtFotos: readonly Aufnahme[];
      } | null>);

  // AUT-06: eine fremde Seite ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();
  const { eintrag, kette, fotos, schichtFotos } = daten;
  const tW = nachSprache(WACHBUCH_TEXTE, zugang.sprache);
  const tA = nachSprache(AUFNAHMEN_TEXTE, zugang.sprache);
  /* D-599/D-728: der Grund einer abgewiesenen Richtigstellung. */
  const fehler = typeof suche['fehler'] === 'string'
    ? (eigenerEintrag(tW.fehler, suche['fehler']) ?? tW.fehlerUnbekannt) : null;
  /* AUT-06: der Verweis auf die Quittung nur, wo ihr Ziel lesbar ist — und
     das Formular der Richtigstellung nur, wo es gelingen kann. */
  const darf = await haeltRechte(sitzung, 'schluessel.lesen', 'wachbuch.schreiben');

  const feld = 'mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted';
  const eingabe = 'min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'px-s3 py-s2 text-sm text-text';

  return (
    <PortalRahmen
      titel={`Wachbuch ${eintrag.nummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="security"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">
          <span className="tabular-nums text-text-muted">{eintrag.nummer}</span>
          {' · '}
          <span className={eintrag.storniert ? 'line-through' : undefined}>
            {eintrag.betreff}
          </span>
        </h1>
        <Link
          href={`/portal/${mandant}/security/wachbuch`}
          className="rounded-md border border-line px-s3 py-s1 text-sm text-text-muted
                     hover:border-line-strong hover:text-text"
        >
          Zum Buch
        </Link>
      </div>

      {fehler !== null && (
        <Hinweis art="warnung" cse="wachbuch-abgewiesen" rolle="alert"
                 className="mb-s5 max-w-prose">
          <strong>{tW.abgewiesen}</strong>{' '}
          {fehler}
          {eintrag.storniert && eintrag.ersetztDurchId !== null && (
            <>
              {' '}
              <Link
                href={`/portal/${mandant}/security/wachbuch/${eintrag.ersetztDurchId}`}
                className="underline-offset-2 hover:underline"
                data-cse="wachbuch-abgewiesen-weiter"
              >
                {tW.zurRichtigstellung}
              </Link>
            </>
          )}
        </Hinweis>
      )}

      <article
        data-cse="wachbuch-blatt"
        data-eintrag={eintrag.id}
        className="mb-s6 rounded-lg border border-line bg-surface p-s5"
      >
        <p className="m-0 text-sm text-text-muted">
          {ART_TEXT[eintrag.art]}
          {' · '}
          {eintrag.objekt}
          {' · '}
          {eintrag.urheber ?? '—'}
        </p>
        <p className="m-0 mt-s2 text-sm tabular-nums text-text-muted">
          Serverzeit {eintrag.erfasstLokal}
          {eintrag.zeitabweichungSek !== null && (
            <span data-cse="zeitabweichung">
              {' · Geräteuhr wich um '}
              {stundenMinutenText(Math.round(Math.abs(eintrag.zeitabweichungSek) / 60))}
              {eintrag.zeitabweichungSek > 0 ? ' vor' : ' nach'}
            </span>
          )}
          {eintrag.nachgetragen && ' · nachgetragen'}
        </p>
        {eintrag.kontrollpunkt !== null && (
          <p className="m-0 mt-s2 text-sm text-text-muted">
            Kontrollpunkt {eintrag.kontrollpunkt}
            {eintrag.praesenzBestaetigt ? ' · Präsenz bestätigt' : ' · ohne Präsenznachweis'}
          </p>
        )}
        {eintrag.polizeiInformiert && (
          <p className="m-0 mt-s2 text-sm text-text">Polizei informiert.</p>
        )}
        {eintrag.schluessel !== null && (
          <p className="m-0 mt-s2 text-sm text-text" data-cse="wachbuch-schluessel">
            {tW.schluesselZeile(eintrag.schluessel)}
            {eintrag.quittungId !== null && eintrag.quittungSchluesselId !== null
              && darf['schluessel.lesen'] === true && (
              <>
                {' · '}
                <Link
                  href={`/portal/${mandant}/security/schluessel/${eintrag.quittungSchluesselId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {tW.quittungVerweis}
                </Link>
              </>
            )}
          </p>
        )}

        <p className="mt-s4 whitespace-pre-wrap text-base text-text">
          {eintrag.eintragstext}
        </p>

        {fotos.length > 0 && (
          <section data-cse="wachbuch-fotos" className="mt-s4">
            <h2 className="m-0 mb-s2 text-sm font-semibold text-text">{tW.fotos}</h2>
            {!speicher.verbunden && (
              <p className="m-0 mb-s2 text-sm text-warning">{tA.speicherFehlt}</p>
            )}
            <Aufnahmeliste aufnahmen={fotos} texte={tA} marke="wachbuch-foto" />
          </section>
        )}

        {eintrag.storniert && (
          <p className="m-0 mt-s4 text-sm text-danger">
            Storniert: {eintrag.stornoGrund}
            {eintrag.ersetztDurchId !== null && (
              <>
                {' · '}
                <Link
                  href={`/portal/${mandant}/security/wachbuch/${eintrag.ersetztDurchId}`}
                  className="underline-offset-2 hover:underline"
                >
                  Zur Richtigstellung
                </Link>
              </>
            )}
          </p>
        )}
        {eintrag.ersetztId !== null && (
          <p className="m-0 mt-s4 text-sm text-text-muted">
            Dieser Eintrag stellt{' '}
            <Link
              href={`/portal/${mandant}/security/wachbuch/${eintrag.ersetztId}`}
              className="underline-offset-2 hover:underline"
            >
              einen früheren Eintrag
            </Link>
            {' '}richtig.
          </p>
        )}
      </article>

      {schichtFotos.length > 0 && (
        <section data-cse="schicht-fotos" className="mb-s6">
          <h2 className="mb-s2 text-h3 text-text">{tA.schichtAufnahmen}</h2>
          <p className="mb-s3 max-w-prose text-sm text-text-muted">{tW.schichtFotosHinweis}</p>
          {!speicher.verbunden && (
            <p className="m-0 mb-s2 text-sm text-warning">{tA.speicherFehlt}</p>
          )}
          <Aufnahmeliste aufnahmen={schichtFotos} texte={tA} marke="schicht-foto" />
        </section>
      )}

      <section data-cse="kettenzustand" className="mb-s6">
        <h2 className="mb-s2 text-h3 text-text">Nachweiskette dieses Objekts</h2>
        <p
          className={`m-0 rounded-lg border border-line bg-surface p-s5 text-sm ${
            kette.intakt ? 'text-success' : 'text-danger'}`}
        >
          {kette.intakt
            ? `Intakt — ${String(kette.geprueft)} Einträge, jeder mit dem Hash seines `
              + 'Vorgängers verkettet.'
            : `${String(kette.brueche.length)} von ${String(kette.geprueft)} Einträgen `
              + 'passen nicht zu ihrer Kette. Das heisst: an der Datenbank vorbei wurde '
              + 'geschrieben oder gelöscht. Diesen Befund bitte melden, nicht beheben.'}
        </p>
      </section>

      {!eintrag.storniert && darf['wachbuch.schreiben'] !== true && (
        <p className="m-0 max-w-prose text-sm text-text-muted" data-cse="richtigstellen-ohne-recht">
          {tW.richtigstellenOhneRecht}
        </p>
      )}

      {!eintrag.storniert && darf['wachbuch.schreiben'] === true && (
        <section>
          <h2 className="mb-s2 text-h3 text-text">Richtigstellen</h2>
          <p className="mb-s4 max-w-prose text-sm text-text-muted">
            Der Eintrag bleibt stehen und wird als storniert gekennzeichnet; die
            Richtigstellung ist ein neuer Eintrag mit eigener Nummer, der auf ihn
            zeigt. Beide sind danach lesbar — genau das ist der Beweiswert.
          </p>
          <form
            action={`/api/sicherheit/wachbuch?zurueck_fehler=${encodeURIComponent(pfad)}`}
            method="post"
            encType="multipart/form-data"
            className="max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="korrigiert" value={eintrag.id} />
            <input type="hidden" name="zurueck_fehler" value={pfad} />

            <label className="mb-s4 block">
              <span className={feld}>Warum war der Eintrag falsch?</span>
              <input name="grund" required minLength={5} maxLength={200}
                className={eingabe} placeholder="Falsches Objekt genannt" />
            </label>

            <label className="mb-s4 block">
              <span className={feld}>Betreff der Richtigstellung</span>
              <input name="betreff" required maxLength={120} className={eingabe}
                defaultValue={eintrag.betreff} />
            </label>

            <label className="mb-s5 block">
              <span className={feld}>Richtiger Text</span>
              <textarea
                name="eintragstext"
                required
                rows={6}
                className="w-full rounded-md border border-line bg-surface-3 px-s3 py-s2
                           text-sm text-text"
                defaultValue={eintrag.eintragstext}
              />
            </label>

            {speicher.verbunden ? (
              <label className="mb-s5 block" data-cse="richtigstellung-fotos">
                <span className={feld}>{tW.fotos}</span>
                <input type="file" name="foto" accept="image/*" multiple className={eingabe} />
                <span className="mt-s1 block text-xs text-text-muted">{tW.fotoHinweis}</span>
              </label>
            ) : (
              <p className="mb-s5 text-sm text-text-muted">{tW.fotoNichtVerbunden}</p>
            )}

            <Button type="submit" variante="secondary">Richtigstellung schreiben</Button>
          </form>
        </section>
      )}
    </PortalRahmen>
  );
}
