import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { RADAR_PLATTFORM_TEXTE } from '@/lib/i18n/verwaltung/radar-plattform';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { REGISTRIERUNG_STAENDE } from '@/server/services/radar/plattform';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { lesePlattformen, type PlattformZeile } from '../daten';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/radar/plattformen` — wo diese Gesellschaft bieten darf
 * (RAD-09, D-07, O-07, V-175, D-669).
 *
 * **Die Tatsache, deren Fehlen am Abgabetag die Chance kostet.** Eine
 * Freischaltung auf einer Vergabeplattform dauert Tage bis Wochen; wer erst
 * beim Hochladen merkt, dass sein Haus dort kein Konto hat, hat die
 * Ausschreibung verloren, obwohl er sie gewonnen hätte.
 *
 * **Hier wird beides gepflegt, was die Warnung braucht** (V-175): den
 * Katalog (nur die Super-Administration — er gilt für die Gruppe) und den
 * Registrierungsstand DIESER Gesellschaft (`radar.plattform_verwalten`). Bis
 * V-175 versprach diese Seite, „die Super-Administration trägt die
 * Plattformen ein", und es gab keinen Weg dafür — die Warnung „nicht
 * freigeschaltet" konnte deshalb nie auslösen.
 *
 * **Vorgabe ist `unbekannt`, nicht „nicht registriert".** Niemand hat diese
 * Frage bisher beantwortet (O-07), und eine Oberfläche, die „nicht
 * registriert" behauptet, behauptet etwas über die Konten eines Betriebs,
 * das sie nicht weiss.
 *
 * **Kein Kennwort, nirgends.** Gefragt wird die Anmeldekennung (SEC-A5).
 */
export const dynamic = 'force-dynamic';

/** Der Stand als Pille — Darstellung, keine Regel. */
const PILLE: Readonly<Record<string, 'Aktiv' | 'Wartet' | 'Überfällig' | 'Inaktiv'>> = {
  registriert: 'Aktiv',
  beantragt: 'Wartet',
  nicht_registriert: 'Überfällig',
  abgelaufen: 'Überfällig',
  unbekannt: 'Inaktiv',
};

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

/** `JJJJ-MM-TT` → `TT.MM.JJJJ` — ein Kalendertag ist eine Beschriftung, kein Zeitpunkt. */
function tag(wert: string): string {
  return wert.split('-').reverse().join('.');
}

const FELD = 'mt-s1 block min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 '
  + 'text-sm text-text';

interface Auswahl { readonly id: string; readonly name: string }

export default async function Plattformen(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const tor = await mandantTor(`/portal/${mandant}/radar/plattformen`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(RADAR_PLATTFORM_TEXTE, zugang.sprache);
  const darf = await haeltRechte(zugang.sitzung, 'radar.lesen');

  const fehler = eigenerEintrag(t.fehler, suche['fehler']);
  const fehlerDa = typeof suche['fehler'] === 'string';
  const vermerkt = eigenerEintrag(t.vermerkt, suche['vermerkt']);
  const zugeordnetRoh = suche['zugeordnet'];
  const zugeordnet = typeof zugeordnetRoh === 'string' && /^\d{1,9}$/u.test(zugeordnetRoh)
    ? Number(zugeordnetRoh) : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [admin] = await kontext.abfrage<{ ja: boolean }>(
        `select app.ist_super_admin() as ja`);
      return {
        zeilen: await lesePlattformen(kontext),
        superAdmin: admin?.ja === true,
        personen: await kontext.abfrage<Auswahl>(
          `select b.id::text as id, b.name from benutzer b
             join benutzer_mandant bm on bm.benutzer_id = b.id
            where bm.mandant_id = app.aktiver_mandant() and b.status = 'aktiv'
              and bm.entzogen_am is null
            order by b.name`),
      };
    })) as Promise<{
      zeilen: readonly PlattformZeile[]; superAdmin: boolean; personen: readonly Auswahl[];
    }>);
  const { zeilen, superAdmin, personen } = daten;

  const offeneOhneKonto = zeilen
    .filter((z) => z.registrierung !== 'registriert')
    .reduce((summe, z) => summe + z.offeneBekanntmachungen, 0);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.wurzelTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="radar"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{t.titel}</h1>
        {/*
          * `/radar` öffnet mit `radar.lesen` (Manifest); diese Seite mit
          * `radar.plattform_verwalten`. Ohne das Recht führte der Verweis auf
          * 404 und verriet damit, was er nicht zeigen darf (AUT-06; D-581).
          */}
        {darf['radar.lesen'] === true && (
          <Link href={`/portal/${mandant}/radar`}
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            {t.zumRadar}
          </Link>
        )}
      </div>

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {t.einleitung} <strong>{t.frageDavor}</strong>
      </p>

      {fehlerDa ? (
        <Hinweis art="warnung" cse="plattform-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{t.nichtGespeichert}</strong>
          {fehler ?? t.fehlerSonst}
        </Hinweis>
      ) : vermerkt !== undefined ? (
        <Hinweis art="erfolg" cse="plattform-vermerkt" className="mb-s5 max-w-prose">
          {vermerkt}
          {zugeordnet === null ? null : <> {t.zugeordnet(zugeordnet)}</>}
        </Hinweis>
      ) : null}

      {offeneOhneKonto > 0 ? (
        <Hinweis art="warnung" cse="plattform-warnung" className="mb-s5 max-w-prose">
          <strong>{t.warnungOffene(offeneOhneKonto)}</strong> {t.warnungOffeneDauer}
        </Hinweis>
      ) : null}

      {zeilen.length === 0 ? (
        <Hinweis art="hinweis" cse="plattform-leer" className="mb-s6 max-w-prose">
          <strong>{t.leerTitel}</strong> {t.leerText}
          {superAdmin ? <> {t.leerSuperAdmin}</> : null}
        </Hinweis>
      ) : (
        <ul data-cse="plattform-liste" className="mb-s6 flex flex-col gap-s3">
          {zeilen.map((z) => {
            const stand = eigenerEintrag(t.stand, z.registrierung) ?? t.stand.unbekannt;
            return (
              <li key={z.id} data-cse="plattform" data-stand={z.registrierung}
                  className="rounded-lg border border-line bg-surface p-s4">
                <div className="grid grid-cols-1 gap-s3 md:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-text">{z.name}</div>
                    <div className="mt-s1 text-xs text-text-subtle">
                      {z.betreiber ?? t.betreiberFehlt}
                      {z.benutzerkennung === null ? '' : ` · ${t.kennung(z.benutzerkennung)}`}
                      {z.registriertAm === null ? '' : ` · ${t.seit(tag(z.registriertAm))}`}
                      {z.gueltigBis === null ? '' : ` · ${t.gueltigBisText(tag(z.gueltigBis))}`}
                    </div>
                    <div className="mt-s2 text-sm text-text-muted">
                      {stand}
                      {z.hinweis === null ? '' : ` · ${z.hinweis}`}
                      {z.registrierungErforderlich ? '' : ` · ${t.ohneRegistrierungspflicht}`}
                    </div>
                    <div className="mt-s1 text-xs text-text-subtle" data-cse="plattform-hosts">
                      {z.hostMuster.length === 0 ? t.keineHosts : t.hostsText(z.hostMuster.join(', '))}
                    </div>
                    {z.zuletztBestaetigtAm === null ? null : (
                      <div className="mt-s1 text-xs text-text-subtle">
                        {t.zuletztBestaetigt(BERLIN.format(z.zuletztBestaetigtAm))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-start gap-s2 md:items-end">
                    <StatusPill zustand={PILLE[z.registrierung] ?? 'Inaktiv'} sprache={zugang.sprache} />
                    <span className="text-xs text-text-subtle" data-cse="plattform-offene">
                      {t.offene(z.offeneBekanntmachungen)}
                    </span>
                    {z.istPlatzhalter ? (
                      <span className="text-xs text-warning">{t.unbestaetigt}</span>
                    ) : null}
                  </div>
                </div>

                {z.registrierung === 'registriert' && z.gueltigkeitVorbei && z.gueltigBis !== null ? (
                  <Hinweis art="warnung" cse="plattform-gueltigkeit" className="mt-s3">
                    {t.gueltigkeitAbgelaufen(tag(z.gueltigBis))}
                  </Hinweis>
                ) : null}

                {/* ---------------------------- der Stand dieser Gesellschaft */}
                <details className="mt-s3" data-cse="plattform-registrierung">
                  <summary className="cursor-pointer text-sm text-text">{t.registrierungTitel}</summary>
                  <form method="post" action="/api/radar/plattform"
                        className="mt-s3 grid grid-cols-1 gap-s3 sm:grid-cols-2">
                    <input type="hidden" name="was" value="registrierung" />
                    <input type="hidden" name="plattform" value={z.id} />
                    <label className="block text-sm text-text">
                      {t.feldStand}
                      <select name="status" defaultValue={z.registrierung} className={FELD}
                              data-cse="registrierung-stand">
                        {REGISTRIERUNG_STAENDE.map((s) => (
                          <option key={s} value={s}>{t.stand[s]}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-text">
                      {t.feldKennung}
                      <input name="benutzerkennung" maxLength={200} autoComplete="off"
                             defaultValue={z.benutzerkennung ?? ''} className={FELD} />
                      <span className="mt-s1 block text-xs text-text-muted">{t.feldKennungHinweis}</span>
                    </label>
                    <label className="block text-sm text-text">
                      {t.feldRegistriertAm}
                      <input name="registriertAm" type="date" defaultValue={z.registriertAm ?? ''}
                             className={FELD} />
                    </label>
                    <label className="block text-sm text-text">
                      {t.feldGueltigBis}
                      <input name="gueltigBis" type="date" defaultValue={z.gueltigBis ?? ''}
                             className={FELD} />
                    </label>
                    <label className="block text-sm text-text">
                      {t.feldVerantwortlich}
                      <select name="verantwortlichBenutzerId"
                              defaultValue={z.verantwortlichBenutzerId ?? ''} className={FELD}>
                        <option value="">{t.niemand}</option>
                        {personen.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-sm text-text sm:col-span-2">
                      {t.feldNotiz}
                      <textarea name="notiz" rows={2} maxLength={2000} defaultValue={z.notiz ?? ''}
                                className="mt-s1 block w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
                    </label>
                    <div className="sm:col-span-2">
                      <Button type="submit" variante="secondary" data-cse="registrierung-speichern">
                        {t.registrierungSpeichern}
                      </Button>
                    </div>
                  </form>
                </details>

                {/* ---------------------- der Eintrag (Super-Administration) */}
                {superAdmin ? (
                  <details className="mt-s3" data-cse="plattform-eintrag">
                    <summary className="cursor-pointer text-sm text-text">{t.eintragAendern}</summary>
                    <form method="post" action="/api/radar/plattform"
                          className="mt-s3 grid grid-cols-1 gap-s3 sm:grid-cols-2">
                      <input type="hidden" name="was" value="plattform_aendern" />
                      <input type="hidden" name="plattform" value={z.id} />
                      <label className="block text-sm text-text">
                        {t.feldName}
                        <input name="name" required maxLength={200} defaultValue={z.name}
                               className={FELD} />
                      </label>
                      <label className="block text-sm text-text">
                        {t.feldSlug}
                        <input name="slug" maxLength={60} defaultValue={z.slug} className={FELD} />
                      </label>
                      <label className="block text-sm text-text">
                        {t.feldBetreiber}
                        <input name="betreiber" maxLength={200} defaultValue={z.betreiber ?? ''}
                               className={FELD} />
                      </label>
                      <label className="block text-sm text-text">
                        {t.feldBasisUrl}
                        <input name="basisUrl" type="url" maxLength={500}
                               defaultValue={z.basisUrl ?? ''} className={FELD} />
                      </label>
                      <label className="block text-sm text-text sm:col-span-2">
                        {t.feldHosts}
                        <textarea name="hostMuster" rows={2} defaultValue={z.hostMuster.join('\n')}
                                  className="mt-s1 block w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
                        <span className="mt-s1 block text-xs text-text-muted">{t.feldHostsHinweis}</span>
                      </label>
                      <label className="block text-sm text-text">
                        {t.feldDauer}
                        <input name="registrierungDauerHinweis" maxLength={200}
                               defaultValue={z.hinweis ?? ''} className={FELD} />
                      </label>
                      <label className="flex items-start gap-s3 text-sm text-text sm:mt-s5">
                        <input type="checkbox" name="registrierungErforderlich" value="ja"
                               defaultChecked={z.registrierungErforderlich}
                               className="mt-1 min-h-5 min-w-5" />
                        <span>{t.feldPflicht}</span>
                      </label>
                      <div className="sm:col-span-2">
                        <Button type="submit" variante="secondary">{t.speichern}</Button>
                      </div>
                    </form>
                    <div className="mt-s3 flex flex-wrap gap-s3">
                      {z.istPlatzhalter ? (
                        <form method="post" action="/api/radar/plattform" className="flex flex-col gap-s1">
                          <input type="hidden" name="was" value="plattform_bestaetigen" />
                          <input type="hidden" name="plattform" value={z.id} />
                          <Button type="submit" variante="secondary" data-cse="plattform-bestaetigen">
                            {t.bestaetigen}
                          </Button>
                          <span className="text-xs text-text-muted">{t.bestaetigenHinweis}</span>
                        </form>
                      ) : null}
                      <form method="post" action="/api/radar/plattform" className="flex flex-col gap-s1">
                        <input type="hidden" name="was" value="plattform_archivieren" />
                        <input type="hidden" name="plattform" value={z.id} />
                        <Button type="submit" variante="ghost" data-cse="plattform-archivieren">
                          {t.archivieren}
                        </Button>
                        <span className="text-xs text-text-muted">{t.archivierenHinweis}</span>
                      </form>
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* -------------------------------- der Katalog (Super-Administration) */}
      {superAdmin ? (
        <section aria-labelledby="katalog" className="mb-s6 max-w-prose" data-cse="plattform-katalog">
          <h2 id="katalog" className="text-h2 text-text">{t.katalogTitel}</h2>
          <p className="mb-s4 text-sm text-text-muted">{t.katalogErklaerung}</p>
          <form method="post" action="/api/radar/plattform"
                className="grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2">
            <input type="hidden" name="was" value="plattform_anlegen" />
            <label className="block text-sm text-text">
              {t.feldName}
              <input name="name" required maxLength={200} className={FELD}
                     data-cse="plattform-name" />
            </label>
            <label className="block text-sm text-text">
              {t.feldSlug}
              <input name="slug" maxLength={60} className={FELD} />
              <span className="mt-s1 block text-xs text-text-muted">{t.feldSlugHinweis}</span>
            </label>
            <label className="block text-sm text-text">
              {t.feldBetreiber}
              <input name="betreiber" maxLength={200} className={FELD} />
            </label>
            <label className="block text-sm text-text">
              {t.feldBasisUrl}
              <input name="basisUrl" type="url" maxLength={500} className={FELD} />
            </label>
            <label className="block text-sm text-text sm:col-span-2">
              {t.feldHosts}
              <textarea name="hostMuster" rows={2} data-cse="plattform-hosts-eingabe"
                        className="mt-s1 block w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
              <span className="mt-s1 block text-xs text-text-muted">{t.feldHostsHinweis}</span>
            </label>
            <label className="block text-sm text-text">
              {t.feldDauer}
              <input name="registrierungDauerHinweis" maxLength={200} className={FELD} />
              <span className="mt-s1 block text-xs text-text-muted">{t.feldDauerHinweis}</span>
            </label>
            <label className="flex items-start gap-s3 text-sm text-text sm:mt-s5">
              <input type="checkbox" name="registrierungErforderlich" value="ja" defaultChecked
                     className="mt-1 min-h-5 min-w-5" />
              <span>{t.feldPflicht}</span>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" variante="primary" data-cse="plattform-eintragen">
                {t.eintragen}
              </Button>
            </div>
          </form>
        </section>
      ) : zeilen.length === 0 ? null : (
        <p className="mb-s6 max-w-prose text-sm text-text-muted" data-cse="plattform-nur-stand">
          {t.nurSuperAdmin}
        </p>
      )}

      <p className="mt-s6 max-w-prose text-xs text-text-muted">{t.keinKennwort}</p>
    </PortalRahmen>
  );
}
