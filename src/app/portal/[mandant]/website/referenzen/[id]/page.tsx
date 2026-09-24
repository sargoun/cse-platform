import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { StatusPill } from '@/components/ui/StatusPill';
import type { BereichSchluessel } from '@/lib/design/theme';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  bilderZurWahl, ladeReferenzZurPflege,
  type GaleriePflegeZeile, type ReferenzDetail,
} from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { WebsiteSpruenge } from '../../spruenge';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { WEBSITE_REFERENZ_TEXTE } from '@/lib/i18n/verwaltung/website-referenz';
import { eigenerEintrag } from '@/lib/nachschlagen';
import {
  freigabeGilt, ladeFreigabestand, type Freigabestand,
} from '@/server/services/auftrag/kundenfreigabe';

/**
 * `/portal/[mandant]/website/referenzen/[id]` — eine Referenz bearbeiten
 * (PRO-05).
 *
 * **Die Kundenfreigabe steht in einem EIGENEN Block, nicht zwischen Titel und
 * Jahr.** Ein Kundenname auf einer Website ohne dessen Zustimmung ist nichts,
 * was man durch Löschen ungeschehen macht — er steht dann im Cache einer
 * Suchmaschine, und der Kunde ruft an. Die Zustimmung ist deshalb keine
 * Formatierungsfrage, sondern die Bedingung, unter der diese Zeile überhaupt
 * öffentlich werden darf; `referenz_freigabe_belegt` lässt sie ohne Datum gar
 * nicht in die Tabelle.
 *
 * **Zwei Rechte, und sie sind nicht dieselben.** Die Seite trägt
 * `referenz.schreiben` (Manifest); `t_referenz_pflege` verlangt für JEDEN
 * Schreibvorgang `referenz.kundenfreigabe_erfassen`. Wer nur das erste hält,
 * sähe Formulare, die nichts ändern — deshalb stehen die Knöpfe nur, wo beide
 * Rechte da sind, und der Satz daneben sagt, welches fehlt.
 *
 * **Die Herkunft steht in der Zeile, nicht in der Adresse** (V-161, 0410).
 * Angelegt wird eine Referenz unter `…/referenzen/neu` aus einem
 * abgeschlossenen Auftrag mit geltender Kundenfreigabe, und `auftrag_id` hält
 * fest, aus welchem. Der Freigabeblock schlägt Datum und Beleg aus GENAU
 * diesem Auftrag vor. Vorher kam die Kennung als `?auftrag=<id>` aus der
 * Adresse, und jedes Referenzblatt schlug Datum und Beleg eines BELIEBIGEN
 * Auftrags der Gesellschaft vor, ohne zu wissen, ob die Referenz aus ihm
 * stammt. Der Haken bleibt leer; gespeichert wird erst durch einen Menschen
 * (O-913).
 *
 * **Die ganze Seite spricht die Sprache der Sitzung** (V-161) — vorher stand
 * der englische Hinweis „angelegt" neben deutschen Feldbeschriftungen.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Referenz bearbeiten' };

const BERLIN_TAG = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text focus:border-brand focus:outline-none';

/** `YYYY-MM-DD` in Europe/Berlin — der Wert, den ein `<input type="date">` will. */
function berlinTag(iso: string | null): string {
  if (iso === null) return '';
  const teile = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
  return teile;
}

export default async function WebsiteReferenz(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const referenzId = kennungOder404(id);
  const pfad = `/portal/${mandant}/website/referenzen/${referenzId}`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const sprache = zugang.sprache;

  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.schreiben', 'referenz.kundenfreigabe_erfassen',
    'referenz.veroeffentlichen', 'auftrag.lesen');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const schreibt = darf['referenz.schreiben'] === true
    && darf['referenz.kundenfreigabe_erfassen'] === true && !nurLesen;
  const liestAuftraege = darf['auftrag.lesen'] === true;
  const t = nachSprache(WEBSITE_REFERENZ_TEXTE, sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const referenz = await ladeReferenzZurPflege(kontext, referenzId);
      /*
       * Der Auftrag der HERKUNFT — gelesen nur mit `auftrag.lesen`. Ohne das
       * Recht sagt das Blatt, dass es ihn nicht lesen darf, und schlägt nichts
       * vor; es behauptet nichts über ihn.
       */
      const auftrag = referenz !== null && referenz.auftragId !== null && liestAuftraege
        ? await ladeFreigabestand(kontext, referenz.auftragId) : null;
      return { referenz, auftrag, bilder: await bilderZurWahl(kontext) };
    })) as Promise<{
      referenz: ReferenzDetail | null; auftrag: Freigabestand | null;
      bilder: readonly GaleriePflegeZeile[];
    }>);

  // 404 und nicht 403 (AUT-06).
  if (daten.referenz === null) notFound();
  const r = daten.referenz;
  const herkunft = daten.auftrag;

  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const gespeichert = typeof suche['gespeichert'] === 'string'
    ? suche['gespeichert'] : null;
  const angelegt = suche['angelegt'] === '1';
  const vorhanden = suche['vorhanden'] === '1';
  /*
   * Ein Vorschlag nur aus dem EIGENEN Auftrag und nur, solange dessen Freigabe
   * gilt — ein Widerruf trägt kein Datum mehr in eine neue Zustimmung.
   */
  const vorschlag = !r.freigegeben && herkunft !== null && freigabeGilt(herkunft)
    ? herkunft : null;

  const oeffentlich = `/unternehmen/${mandant}/projekte/${r.slug}`;
  const draussen = r.status === 'veroeffentlicht';
  const verweis = 'text-text underline underline-offset-2 hover:text-brand';

  return (
    <PortalRahmen
      zurueck={{ ziel: `/portal/${mandant}/website/referenzen`, text: t.blattZurueck }}
      titel={r.titel}
      wurzelTitel={t.wurzelTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="referenzen"
                       sitzung={zugang.sitzung} />

      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 min-w-0 text-h1 text-text">{r.titel}</h1>
        <span className="inline-flex flex-wrap items-center gap-s2">
          <StatusPill zustand={draussen ? 'Aktiv' : 'Entwurf'} sprache={sprache} />
          <StatusPill zustand={r.freigegeben ? 'Bereit' : 'Wartet'} sprache={sprache} />
        </span>
      </div>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="referenz-fehler" className="mb-s5 max-w-prose">
          {eigenerEintrag(t.blattFehler, abgewiesen) ?? t.blattFehlerSonst}
        </Hinweis>
      )}
      {gespeichert === null ? null : (
        <Hinweis art="erfolg" cse="referenz-gespeichert" className="mb-s5 max-w-prose">
          {t.gespeichert}
        </Hinweis>
      )}
      {angelegt && (
        <Hinweis art="erfolg" cse="referenz-angelegt" className="mb-s5 max-w-prose">
          <strong className="block">{t.angelegtTitel}</strong>
          {t.angelegtText}
        </Hinweis>
      )}
      {vorhanden && (
        <Hinweis art="hinweis" cse="referenz-vorhanden" className="mb-s5 max-w-prose">
          <strong className="block">{t.vorhandenTitel}</strong>
          {t.vorhandenText}
        </Hinweis>
      )}
      {!schreibt && !nurLesen && (
        <Hinweis art="warnung" cse="ohne-schreibrecht" className="mb-s5 max-w-prose">
          <strong className="block">{t.blattNurLesbarTitel}</strong>
          {t.blattNurLesbarVor}{' '}
          <Recht schluessel="referenz.schreiben" sprache={sprache} />{' '}
          {t.blattNurLesbarUnd}{' '}
          <Recht schluessel="referenz.kundenfreigabe_erfassen" sprache={sprache} />{' '}
          {t.blattNurLesbarNach}
        </Hinweis>
      )}

      {/* ── Herkunft ────────────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.herkunftTitel}</h2>
        <div className="max-w-prose text-sm text-text-muted" data-cse="herkunft"
             data-auftrag={r.auftragId ?? ''}>
          {r.auftragId === null ? (
            <p className="m-0">{t.herkunftAltbestand}</p>
          ) : herkunft === null ? (
            <p className="m-0">{t.herkunftUnlesbar}</p>
          ) : (
            <>
              <p className="m-0 text-text">
                {t.herkunftAuftrag(herkunft.auftragsnummer, herkunft.kunde)}
              </p>
              {herkunft.widerrufen_am !== null && (
                <p className="mb-0 mt-s2">{t.herkunftWiderrufen(herkunft.widerrufen_am)}</p>
              )}
              {darf['referenz.kundenfreigabe_erfassen'] === true && (
                <p className="mb-0 mt-s2">
                  <Link href={`/portal/${mandant}/auftraege/${herkunft.auftrag_id}/kundenfreigabe`}
                        className={verweis} data-cse="zur-herkunft">
                    {t.herkunftZumAuftrag}
                  </Link>
                </p>
              )}
            </>
          )}
        </div>
      </Card>

      {/* ── Die öffentliche Adresse ─────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.adresseTitel}</h2>
        <p className="m-0" data-cse="kanonische-adresse">
          {draussen && r.freigegeben ? (
            <a href={oeffentlich}
               className="font-mono text-sm text-text underline underline-offset-4 hover:text-brand">
              {oeffentlich}
            </a>
          ) : (
            <span className="font-mono text-sm text-text-muted">{oeffentlich}</span>
          )}
        </p>
        <p className="mb-0 mt-s3 max-w-prose text-xs text-text-subtle">
          {draussen && r.freigegeben ? t.adresseOeffentlich : t.adresseNochNicht}
        </p>
      </Card>

      {/* ── Felder ──────────────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.projektTitel}</h2>
        {schreibt ? (
          <form method="post" action="/api/website/referenz"
                className="flex max-w-prose flex-col gap-s4" data-cse="referenz-formular">
            <input type="hidden" name="handlung" value="felder" />
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <FormField label={t.feldTitel} name="titel" defaultValue={r.titel} required
                       maxLength={200} />
            <FormField
              label={t.feldSlug} name="slug"
              defaultValue={r.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*"
              hinweis={t.slugHinweisBlatt}
            />
            <FormField
              label={t.feldKunde} name="kundeName" defaultValue={r.kundeName ?? ''}
              maxLength={200}
              hinweis={t.kundeHinweisBlatt}
            />
            <div className="flex flex-col gap-s2">
              <label htmlFor="beschreibung" className="text-xs text-text-muted">
                {t.feldBeschreibung}
              </label>
              <textarea id="beschreibung" name="beschreibung" rows={6} className={FELD}
                        defaultValue={r.beschreibung ?? ''}
                        aria-describedby="beschreibung-hinweis" />
              <p id="beschreibung-hinweis" className="m-0 text-xs text-text-subtle">
                {t.beschreibungHinweis}
              </p>
            </div>
            <FormField label={t.feldJahr} name="jahr" type="number" min={1990} max={2100}
                       step={1} defaultValue={r.jahr === null ? '' : String(r.jahr)} />
            <FormField label={t.feldSortierung} name="sortierung" type="number" min={0} step={1}
                       defaultValue={String(r.sortierung)}
                       hinweis={t.sortierungHinweis} />

            <div className="flex flex-col gap-s2">
              <label htmlFor="medienId" className="text-xs text-text-muted">
                {t.feldBild}
              </label>
              <select id="medienId" name="medienId" className={FELD}
                      defaultValue={r.medienId ?? ''} data-cse="bild-wahl">
                <option value="">{t.keinBild}</option>
                {daten.bilder.map((b) => (
                  <option key={b.id} value={b.id}>
                    {`${b.alt}${b.platzhalter ? t.platzhalterZusatz : ''}`}
                  </option>
                ))}
              </select>
              <p className="m-0 text-xs text-text-subtle">
                {daten.bilder.length === 0 ? t.keineBilder : t.bilderPlatzhalter}
              </p>
            </div>

            <Button type="submit" variante="secondary" className="self-start"
                    data-cse="referenz-speichern">
              {t.speichern}
            </Button>
          </form>
        ) : (
          <dl className="grid grid-cols-1 gap-s3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-text-muted">{t.spalteKunde}</dt>
              <dd className="m-0 text-sm text-text">{r.kundeName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.feldJahr}</dt>
              <dd className="m-0 text-sm text-text">
                {r.jahr === null ? '—' : String(r.jahr)}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-text-muted">{t.feldBeschreibung}</dt>
              <dd className="m-0 whitespace-pre-line text-sm text-text-muted">
                {r.beschreibung ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">{t.feldBild}</dt>
              <dd className="m-0 text-sm text-text-muted">
                {r.medienAlt ?? t.keinBild}
                {r.medienPlatzhalter === true ? t.platzhalterZusatz : ''}
              </dd>
            </div>
          </dl>
        )}
      </Card>

      {/* ── Kundenfreigabe ──────────────────────────────────────────────── */}
      <Card className="mb-s5">
        <h2 className="mb-s3 mt-0 text-h3 text-text">{t.freigabeTitel}</h2>
        <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
          {t.freigabeErklaerung}
        </p>

        <dl className="mb-s4 grid grid-cols-1 gap-s3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">{t.freigabeStand}</dt>
            <dd className="m-0" data-cse="kundenfreigabe"
                data-freigegeben={r.freigegeben ? 'ja' : 'nein'}>
              <StatusPill zustand={r.freigegeben ? 'Bereit' : 'Wartet'} sprache={sprache} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.erteiltAm}</dt>
            <dd className="m-0 text-sm text-text">
              {r.freigabeAm === null ? '—' : BERLIN_TAG.format(new Date(r.freigabeAm))}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">{t.beleg}</dt>
            <dd className="m-0 text-sm text-text-muted">{r.freigabeBeleg ?? '—'}</dd>
          </div>
        </dl>

        {schreibt && vorschlag !== null && (
          <Hinweis art="hinweis" cse="freigabe-vorschlag" className="mb-s4 max-w-prose">
            <strong className="block">{t.vorschlagTitel(vorschlag.auftragsnummer)}</strong>
            {t.vorschlagText}
          </Hinweis>
        )}
        {schreibt && (
          <form method="post" action="/api/website/referenz"
                className="flex max-w-prose flex-col gap-s4" data-cse="freigabe-formular">
            <input type="hidden" name="handlung" value="freigabe" />
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="zurueck" value={pfad} />

            {/*
              * Der Haken bleibt auch mit Vorschlag LEER: Datum und Beleg aus
              * dem Auftrag sind eine Hilfe beim Tippen, die Aussage „der Kunde
              * hat zugestimmt" trifft der Mensch selbst (O-913).
              */}
            <label className="flex min-h-11 items-center gap-s3 text-sm text-text">
              <input type="checkbox" name="freigegeben" value="1"
                     defaultChecked={r.freigegeben}
                     className="size-4 accent-[var(--brand)]" data-cse="freigabe-haken" />
              <span>{t.freigabeHaken}</span>
            </label>
            <FormField label={t.freigabeDatum} name="freigabeAm" type="date"
                       defaultValue={vorschlag?.freigabe_tag ?? berlinTag(r.freigabeAm)} />
            <div className="flex flex-col gap-s2">
              <label htmlFor="freigabeBeleg" className="text-xs text-text-muted">
                {t.freigabeBelegFrage}
              </label>
              <textarea id="freigabeBeleg" name="freigabeBeleg" rows={3} className={FELD}
                        defaultValue={vorschlag === null
                          ? (r.freigabeBeleg ?? '')
                          : t.belegAusAuftrag(vorschlag.auftragsnummer,
                            vorschlag.ansprechpartner, vorschlag.freigabe_dokument)} />
            </div>
            <Button type="submit" variante="secondary" className="self-start"
                    data-cse="freigabe-speichern">
              {t.freigabeSpeichern}
            </Button>
          </form>
        )}
      </Card>

      {/* ── Weg zur Veröffentlichung ────────────────────────────────────── */}
      {darf['referenz.veroeffentlichen'] === true ? (
        <Card>
          <h2 className="mb-s3 mt-0 text-h3 text-text">{t.veroeffentlichungTitel}</h2>
          <p className="mb-s4 mt-0 max-w-prose text-sm text-text-muted">
            {t.veroeffentlichungVor}
            <Recht schluessel="referenz.veroeffentlichen" sprache={sprache} />
            {t.veroeffentlichungNach}
          </p>
          <Link href={`/portal/${mandant}/website/referenzen/${referenzId}/veroeffentlichen`}
                data-cse="zur-veroeffentlichung"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
            {t.zurVeroeffentlichung}
          </Link>
        </Card>
      ) : (
        <p className="max-w-prose text-xs text-text-subtle">
          {t.nurSuperAdminVor}{' '}
          <Recht schluessel="referenz.veroeffentlichen" sprache={sprache} />{' '}
          {t.nurSuperAdminNach}
        </p>
      )}
    </PortalRahmen>
  );
}
