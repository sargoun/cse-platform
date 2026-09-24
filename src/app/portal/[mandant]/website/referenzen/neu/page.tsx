import type postgres from 'postgres';
import Link from 'next/link';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { FormField } from '@/components/ui/FormField';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { WEBSITE_REFERENZ_TEXTE } from '@/lib/i18n/verwaltung/website-referenz';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { istUuid } from '@/lib/uuid';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import {
  ladeFreigabestand, listeAuftraegeMitFreigabe, referenzHindernis,
  type AuftragMitFreigabe, type Freigabestand,
} from '@/server/services/auftrag/kundenfreigabe';
import {
  referenzenAusAuftrag, slugIstVergeben, slugVorschlag, type ReferenzAusAuftrag,
} from '@/server/services/inhalt/redaktion';
import { haeltRechte } from '@/app/portal/rechte';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { WebsiteSpruenge } from '../../spruenge';

/**
 * `/portal/[mandant]/website/referenzen/neu` — eine Referenz anlegen
 * (PRO-05, V-154, V-161).
 *
 * **Der Befund.** Die Kundenfreigabe am Auftrag versprach „die öffentliche
 * Referenz legt danach ein Mensch unter `/website/referenzen` an" — und dort
 * gab es keinen Weg dazu. V-154 baute ihn, aber FREI: Titel, Kunde und Text
 * beliebig. SPEC PRO-05 sagt das Gegenteil — „a reference is a completed
 * `auftrag` with customer release on file, not a marketing entry typed by
 * hand" — und die Seitenkarte (§5.21) ebenso.
 *
 * **Deshalb zuerst der Auftrag** (V-161, D-654). Ohne `?auftrag=` zeigt die
 * Seite die abgeschlossenen Aufträge dieser Gesellschaft mit geltender
 * Kundenfreigabe (und darunter die, die noch laufen). Mit `?auftrag=` steht
 * das Formular — vorbelegt mit Titel und Kundenname, sonst nichts: nie
 * Auftragswert, Ansprechpartner oder Vertragsinhalte (PRO-05). Der Dienst
 * prüft Abschluss und Freigabe beim Anlegen ein zweites Mal und schreibt die
 * Herkunft in die Zeile (`referenz.auftrag_id`, 0410).
 *
 * **Jede Aussage über den Auftrag stimmt.** Ohne `auftrag.lesen` antwortet
 * die Policy mit nichts; die Seite sagt dann, welches Recht fehlt — und
 * nicht „dieser Auftrag trägt keine Kundenfreigabe", was eine Aussage über
 * einen Auftrag wäre, den sie gar nicht gelesen hat. Ein unbekannter Auftrag,
 * einer ohne geltende Freigabe und ein laufender bekommen je ihren Satz.
 *
 * **Nach einer Abweisung ist nichts weg.** Die Route gibt Titel, Slug,
 * Kundenname und Jahr in der Adresse zurück; die Beschreibung steht erst auf
 * dem Blatt der neuen Zeile. Liegt die Adresse aus dem vorbelegten Titel
 * schon fest, sagt die Seite es VOR dem Absenden und verlangt einen eigenen
 * Slug. Ein Doppelklick legt nicht zweimal an: derselbe Auftrag unter
 * derselben Adresse führt auf die vorhandene Referenz.
 *
 * **Zwei Rechte.** Das Tor verlangt `referenz.schreiben` (Manifest);
 * `t_referenz_pflege` verlangt für das `insert` zusätzlich
 * `referenz.kundenfreigabe_erfassen`. Ohne das zweite steht hier kein
 * Formular, sondern der Satz, welches Recht fehlt.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website — Neue Referenz' };

/** Was die Route nach einer Abweisung zurückgibt — höchstens so lang wie die Felder. */
const RUECKGABE_LAENGE = 200;

type Daten =
  | { readonly art: 'auswahl'; readonly auftraege: readonly AuftragMitFreigabe[] }
  | {
    readonly art: 'auftrag';
    readonly stand: Freigabestand | null;
    readonly schon: readonly ReferenzAusAuftrag[];
    readonly slugBelegt: string | null;
  };

export default async function NeueReferenzSeite(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/website/referenzen/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(WEBSITE_REFERENZ_TEXTE, zugang.sprache);
  const basis = verwaltungTexte(zugang.sprache);

  const darf = await haeltRechte(
    zugang.sitzung, 'referenz.schreiben', 'referenz.kundenfreigabe_erfassen',
    'auftrag.lesen');
  const nurLesen = zugang.sitzung.ansicht === 'gruppe';
  const schreibt = !nurLesen && darf['referenz.schreiben'] === true
    && darf['referenz.kundenfreigabe_erfassen'] === true;
  const liestAuftraege = darf['auftrag.lesen'] === true;

  const suche = await searchParams;
  const abgewiesen = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const auftragId = istUuid(suche['auftrag']) ? suche['auftrag'] : null;
  /** Eine Eingabe, die die Route nach einer Abweisung zurückgab — oder `null`. */
  const zurueckgegeben = (name: string): string | null => {
    const wert = suche[name];
    return typeof wert === 'string' ? wert.slice(0, RUECKGABE_LAENGE) : null;
  };

  /*
   * Gelesen wird nur mit `auftrag.lesen`: ohne das Recht gibt die Policy
   * nichts heraus, und „nichts gefunden" wäre eine falsche Aussage über die
   * Aufträge dieser Gesellschaft.
   */
  const daten = !liestAuftraege ? null : await (db().begin(
    SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
      withTenant(tx, zugang.sitzung, async (kontext): Promise<Daten> => {
        if (auftragId === null) {
          return { art: 'auswahl', auftraege: await listeAuftraegeMitFreigabe(kontext) };
        }
        const stand = await ladeFreigabestand(kontext, auftragId);
        if (stand === null) return { art: 'auftrag', stand, schon: [], slugBelegt: null };
        const titel = zurueckgegeben('titel') ?? stand.bezeichnung;
        const eigenerSlug = (zurueckgegeben('slug') ?? '').trim();
        const ausTitel = eigenerSlug === '' ? await slugVorschlag(kontext, titel) : '';
        return {
          art: 'auftrag',
          stand,
          schon: await referenzenAusAuftrag(kontext, auftragId),
          slugBelegt: ausTitel !== '' && await slugIstVergeben(kontext, ausTitel)
            ? ausTitel : null,
        };
      }),
  ) as Promise<Daten>);

  const liste = `/portal/${mandant}/website/referenzen`;
  const stand = daten?.art === 'auftrag' ? daten.stand : null;
  const hindernis = stand === null ? null : referenzHindernis(stand);
  const standText = (status: string): string => eigenerEintrag(t.auftragStand, status) ?? status;
  const auftraege = daten?.art === 'auswahl' ? daten.auftraege : [];
  const bereit = auftraege.filter((a) => referenzHindernis(a) === null);
  const laufend = auftraege.filter((a) => referenzHindernis(a) === 'nicht_abgeschlossen');

  const andereWahl = (
    <span className="mt-s2 block">
      <Link href={`/portal/${mandant}/website/referenzen/neu`}
            className="text-text underline underline-offset-2 hover:text-brand">
        {t.andereWahl}
      </Link>
    </span>
  );
  const zurFreigabe = (id: string) => (darf['referenz.kundenfreigabe_erfassen'] === true ? (
    <span className="mt-s2 block">
      <Link href={`/portal/${mandant}/auftraege/${id}/kundenfreigabe`}
            className="text-text underline underline-offset-2 hover:text-brand">
        {t.zurKundenfreigabe}
      </Link>
    </span>
  ) : null);

  return (
    <PortalRahmen
      zurueck={{ ziel: liste, text: t.zurListe }}
      titel={t.anlegenTitel}
      wurzelTitel={t.wurzelTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={nurLesen}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="website"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <WebsiteSpruenge mandant={mandant} zweig="referenzen" sitzung={zugang.sitzung} />
      <h1 className="mb-s4 mt-0 text-h1 text-text">{t.anlegenTitel}</h1>
      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">{t.anlegenEinleitung}</p>

      {abgewiesen === null ? null : (
        <Hinweis art="warnung" cse="referenz-anlegen-fehler" className="mb-s5 max-w-prose">
          <strong className="block">{t.nichtAngelegt}</strong>
          {eigenerEintrag(t.fehler, abgewiesen) ?? t.fehlerSonst}
        </Hinweis>
      )}

      {nurLesen && (
        <Hinweis art="hinweis" cse="gruppe-nur-lesen" className="mb-s5 max-w-prose">
          {basis.gruppeNurLesen}
        </Hinweis>
      )}

      {!schreibt && !nurLesen ? (
        <Hinweis art="warnung" cse="ohne-anlegerecht" className="mb-s5 max-w-prose">
          <strong className="block">{t.nurLesbarTitel}</strong>
          {t.nurLesbarText}{' '}
          <Recht schluessel="referenz.schreiben" sprache={zugang.sprache} />,{' '}
          <Recht schluessel="referenz.kundenfreigabe_erfassen" sprache={zugang.sprache} />.
        </Hinweis>
      ) : null}

      {!liestAuftraege && (
        <Hinweis art="warnung" cse="ohne-auftragsrecht" className="mb-s5 max-w-prose">
          <strong className="block">{t.ohneAuftragsrechtTitel}</strong>
          {t.ohneAuftragsrechtText}{' '}
          <Recht schluessel="auftrag.lesen" sprache={zugang.sprache} />.
        </Hinweis>
      )}

      {/*
        * ── Ohne Auftrag: die Wahl ─────────────────────────────────────────
        * Die abgeschlossenen mit geltender Kundenfreigabe als Tabelle, die
        * laufenden darunter als Hinweis. Getrennt wird mit `referenzHindernis`,
        * derselben Regel, mit der der Dienst beim Anlegen prüft (D-654).
        */}
      {daten?.art === 'auswahl' && (
        <>
          <h2 className="mb-s3 mt-0 text-h3 text-text">{t.auswahlTitel}</h2>
          {bereit.length === 0 ? (
            <Hinweis art="hinweis" cse="kein-auftrag-bereit" className="mb-s5 max-w-prose">
              <strong className="block">{t.keinerBereitTitel}</strong>
              {t.keinerBereitText}
              <span className="mt-s2 block">
                <Link href={`/portal/${mandant}/auftraege`}
                      className="text-text underline underline-offset-2 hover:text-brand">
                  {t.zuDenAuftraegen}
                </Link>
              </span>
            </Hinweis>
          ) : (
            <div className="mb-s5" data-cse="auftrag-wahl">
              <DataTable
                beschriftung={t.auswahlBeschriftung}
                zeilen={bereit}
                schluessel={(a) => a.auftrag_id}
                spalten={[
                  {
                    schluessel: 'auftrag', kopf: t.spalteAuftrag,
                    zelle: (a) => `${a.auftragsnummer} — ${a.bezeichnung}`,
                  },
                  { schluessel: 'kunde', kopf: t.spalteKunde, zelle: (a) => a.kunde },
                  {
                    schluessel: 'abgeschlossen', kopf: t.spalteAbgeschlossen,
                    zelle: (a) => a.abgeschlossen_am ?? '—',
                  },
                  {
                    schluessel: 'referenzen', kopf: t.spalteReferenzen,
                    zelle: (a) => t.referenzenAnzahl(a.referenzen),
                  },
                  {
                    schluessel: 'weg', kopf: '',
                    zelle: (a) => (schreibt ? (
                      <Link
                        href={`/portal/${mandant}/website/referenzen/neu?auftrag=${a.auftrag_id}`}
                        data-cse="referenz-aus-auftrag"
                        className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2"
                      >
                        {t.ausDiesemAnlegen}
                      </Link>
                    ) : null),
                  },
                ]}
              />
            </div>
          )}
          {laufend.length > 0 && (
            <Hinweis art="hinweis" cse="auftraege-laufend" className="mb-s5 max-w-prose">
              <strong className="block">{t.laufendTitel}</strong>
              {t.laufendText}
              <ul className="m-0 mt-s2 list-none p-0">
                {laufend.map((a) => (
                  <li key={a.auftrag_id}>
                    {`${a.auftragsnummer} — ${a.bezeichnung} (${standText(a.status)})`}
                  </li>
                ))}
              </ul>
            </Hinweis>
          )}
        </>
      )}

      {/* ── Ein bestimmter Auftrag ────────────────────────────────────── */}
      {daten?.art === 'auftrag' && stand === null && (
        <Hinweis art="warnung" cse="auftrag-unbekannt" className="mb-s5 max-w-prose">
          {t.auftragUnbekannt}
          {andereWahl}
        </Hinweis>
      )}
      {stand !== null && hindernis === 'ohne_freigabe' && (
        <Hinweis art="warnung" cse="auftrag-ohne-freigabe" className="mb-s5 max-w-prose">
          {t.auftragOhneFreigabe}
          {zurFreigabe(stand.auftrag_id)}
          {andereWahl}
        </Hinweis>
      )}
      {stand !== null && hindernis === 'storniert' && (
        <Hinweis art="warnung" cse="auftrag-storniert" className="mb-s5 max-w-prose">
          {t.auftragStorniert}
          {andereWahl}
        </Hinweis>
      )}
      {stand !== null && hindernis === 'nicht_abgeschlossen' && (
        <Hinweis art="warnung" cse="auftrag-offen" className="mb-s5 max-w-prose">
          {t.auftragOffen(standText(stand.status))}
          {andereWahl}
        </Hinweis>
      )}

      {stand !== null && hindernis === null && daten?.art === 'auftrag' && (
        <>
          <Hinweis art="hinweis" cse="aus-auftrag" className="mb-s5 max-w-prose">
            <strong className="block">{t.ausAuftragTitel(stand.auftragsnummer)}</strong>
            {t.ausAuftragText}
            {zurFreigabe(stand.auftrag_id)}
          </Hinweis>

          {daten.schon.length > 0 && (
            <Hinweis art="hinweis" cse="schon-aus-auftrag" className="mb-s5 max-w-prose">
              <strong className="block">{t.schonAusAuftrag}</strong>
              <ul className="m-0 mt-s2 list-none p-0">
                {daten.schon.map((r) => (
                  <li key={r.id}>
                    <Link href={`/portal/${mandant}/website/referenzen/${r.id}`}
                          className="text-text underline underline-offset-2 hover:text-brand">
                      {r.titel}
                    </Link>
                    {` — ${eigenerEintrag(t.referenzStand, r.status) ?? r.status}`}
                  </li>
                ))}
              </ul>
            </Hinweis>
          )}

          {schreibt && (
            <Card>
              <form method="post" action="/api/website/referenz"
                    className="flex max-w-prose flex-col gap-s4" data-cse="referenz-anlegen">
                <input type="hidden" name="handlung" value="anlegen" />
                <input type="hidden" name="zurueck" value={`${pfad}?auftrag=${stand.auftrag_id}`} />
                <input type="hidden" name="auftrag" value={stand.auftrag_id} />

                <FormField label={t.feldTitel} name="titel" required maxLength={200}
                           defaultValue={zurueckgegeben('titel') ?? stand.bezeichnung} />
                {/*
                  * Liegt die Adresse aus dem vorbelegten Titel schon fest,
                  * steht es VOR dem Absenden am Feld, und das Feld wird
                  * Pflicht — statt dass „vergeben" erst nach dem Absenden
                  * kommt.
                  */}
                <FormField label={t.feldSlug} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*"
                           maxLength={120} required={daten.slugBelegt !== null}
                           defaultValue={zurueckgegeben('slug') ?? ''}
                           {...(daten.slugBelegt === null
                             ? { hinweis: t.slugHinweis }
                             : { fehler: t.slugBelegt(daten.slugBelegt) })} />
                <FormField label={t.feldKunde} name="kundeName" maxLength={200}
                           defaultValue={zurueckgegeben('kundeName') ?? stand.kunde}
                           hinweis={t.kundeHinweis} />
                <FormField label={t.feldJahr} name="jahr" type="number" min={1990} max={2100}
                           step={1} defaultValue={zurueckgegeben('jahr') ?? ''} />
                <p className="m-0 text-xs text-text-subtle">{t.beschreibungDanach}</p>

                <div className="flex flex-wrap items-center gap-s3">
                  <Button type="submit" variante="primary" data-cse="referenz-anlegen-knopf">
                    {t.anlegen}
                  </Button>
                  <Link href={`/portal/${mandant}/website/referenzen`}
                        className="inline-flex min-h-11 items-center rounded-md px-s4 py-s3 text-sm text-text-muted hover:bg-surface-2 hover:text-text">
                    {t.abbrechen}
                  </Link>
                </div>
              </form>
            </Card>
          )}
        </>
      )}
    </PortalRahmen>
  );
}
