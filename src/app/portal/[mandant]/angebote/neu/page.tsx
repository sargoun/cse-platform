import type postgres from 'postgres';
import Link from 'next/link';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { ANGEBOT_HAND_TEXTE } from '@/lib/i18n/verwaltung/angebot-hand';
import { einheiten, steuersaetzeAm } from '@/server/services/angebot/von-hand';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { KETTE_TEXTE } from '@/lib/i18n/verwaltung/crm-kette';
import { istKennung } from '@/server/services/crm/lead-kette';

/**
 * `/portal/[mandant]/angebote/neu` — ein Angebot von Hand (V-005, SEC-01,
 * BAU-01, OPS-08).
 *
 * **Was hier vorher stand.** Ein Platzhalter: „wird noch gebaut". Der einzige
 * Weg zu einem Angebot führte über das Raumbuch eines Objekts — richtig für
 * die Reinigung, wo der Preis aus Flächen entsteht, und für zwei von drei
 * Gesellschaften unbrauchbar. Die Sicherheit und der Bau konnten kein Angebot
 * schreiben. Nicht „umständlich": gar nicht.
 *
 * **Alles auf einem Bildschirm, und erst dann geschrieben.** Eine
 * Angebotsposition lässt sich nicht mehr löschen (`0024`, `revoke delete` —
 * sie ist die Zeile, die später zur Rechnungszeile wird). Ein Formular, das
 * Zeile für Zeile schriebe, hinterliesse bei jedem Fehler eine halbe Fassung,
 * die für immer stehen bliebe. Deshalb prüft der Dienst zuerst alles und
 * schreibt danach.
 *
 * **Der Steuersatz kommt aus dem Katalog, nicht aus dem Formular.** Die Liste
 * zeigt die am heutigen Tag gültigen Sätze aus `steuersatz_gruppe` mit ihrer
 * amtlichen Bezeichnung; das Kennzeichen und der Befreiungsgrund hängen daran.
 * WELCHER Satz für welche Leistung gilt, entscheidet ein Mensch — §13b gilt
 * für Bauleistungen und für Gebäudereinigung an Unternehmer, nicht an jeden
 * Kunden (O-60).
 */
export const dynamic = 'force-dynamic';

const RECHT = 'angebot.schreiben';
const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';
const KLEIN = 'flex flex-col gap-s1 text-xs text-text-muted';

/** Wie viele leere Zeilen ohne Zutun dastehen, und wie viele höchstens. */
const ZEILEN_VORGABE = 8;
const ZEILEN_MAX = 40;
const ZEILEN_SCHRITT = 8;

interface KundeZeile { readonly id: string; readonly name: string; readonly kundennummer: string | null }
interface ObjektZeile { readonly id: string; readonly bezeichnung: string }
interface KontaktZeile {
  readonly id: string; readonly name: string; readonly kunde: string | null;
}
interface AnfrageZeile {
  readonly id: string; readonly leadnummer: string; readonly betreff: string;
  readonly kunde_id: string | null; readonly ansprechpartner_id: string | null;
  /** Der Kunde der Anfrage, SELBST gelesen — nicht aus der begrenzten Auswahlliste (V-142). */
  readonly kunde_name: string | null; readonly kundennummer: string | null;
  readonly kunde_archiviert: boolean;
}

export default async function NeuesAngebot(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const pfad = `/portal/${mandant}/angebote/neu`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const t = nachSprache(ANGEBOT_HAND_TEXTE, zugang.sprache);
  /*
   * `angebot.lesen` wird geholt, WEIL die Seite es verlinkt (AUT-06): die
   * Liste und der Abbruchweg führen auf `/angebote`, und das verlangt es.
   * Eine Rolle mit `angebot.schreiben` und ohne `angebot.lesen` liefe sonst
   * auf ein 404 — ein Menüpunkt, der auf 404 führt, ist schlechter als keiner.
   */
  const darf = await haeltRechte(zugang.sitzung, RECHT, 'angebot.lesen',
    /* V-138: der Verweis zurück auf die Anfrage führt aufs Leadblatt. */
    'crm.lesen');
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  /*
   * `?zeilen=` ist eine Angabe der OBERFLÄCHE, kein Wert aus der Datenbank:
   * sie wird hier auf einen ganzzahligen Bereich gezwungen, und die Route
   * begrenzt sie noch einmal (ein Formular ist das, was ankommt).
   */
  const zeilenRoh = Number(typeof suche['zeilen'] === 'string' ? suche['zeilen'] : '');
  const zeilenZahl = Number.isInteger(zeilenRoh) && zeilenRoh > 0
    ? Math.min(zeilenRoh, ZEILEN_MAX) : ZEILEN_VORGABE;
  /*
   * **Aus einer Anfrage** (V-138, CRM-05): `?lead=` kommt vom Leadblatt. Der
   * Kunde steht dann fest — der der Anfrage —, und das Angebot trägt ihren
   * Bezug bis zum Auftrag. Nur eine Kennung wird überhaupt gelesen; geprüft
   * wird sie unten gegen die Datenbank und im Dienst noch einmal.
   */
  const leadRoh = typeof suche['lead'] === 'string' ? suche['lead'] : '';
  const leadParam = istKennung(leadRoh) ? leadRoh : null;
  const kt = nachSprache(KETTE_TEXTE, zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const [heute] = await kontext.abfrage<{ tag: string }>(
        `select app.berlin_heute()::text as tag`);
      const tag = heute?.tag ?? '';
      return {
        heute: tag,
        kunden: await kontext.abfrage<KundeZeile>(
          `select id, name, kundennummer from kunde
            where mandant_id = app.aktiver_mandant() and archiviert_am is null
            order by name limit 500`),
        objekte: await kontext.abfrage<ObjektZeile>(
          `select id, bezeichnung from objekt
            where archiviert_am is null order by bezeichnung limit 500`),
        kontakte: await kontext.abfrage<KontaktZeile>(
          `select a.id,
                  trim(coalesce(a.vorname, '') || ' ' || a.nachname) as name,
                  k.name as kunde
             from ansprechpartner a
             left join kunde k on k.id = a.kunde_id and k.mandant_id = a.mandant_id
            where a.mandant_id = app.aktiver_mandant() and a.archiviert_am is null
              and a.ausgeschieden_am is null and a.kunde_id is not null
            order by k.name, a.nachname limit 500`),
        saetze: await steuersaetzeAm(kontext, tag),
        einheiten: await einheiten(kontext),
        lead: leadParam === null ? null : (await kontext.abfrage<AnfrageZeile>(
          `select l.id::text as id, l.leadnummer, l.betreff, l.kunde_id::text as kunde_id,
                  l.ansprechpartner_id::text as ansprechpartner_id,
                  k.name as kunde_name, k.kundennummer,
                  coalesce(k.archiviert_am is not null, false) as kunde_archiviert
             from lead l
             left join kunde k on k.id = l.kunde_id and k.mandant_id = l.mandant_id
            where l.id = $1::uuid and l.mandant_id = app.aktiver_mandant()
              and l.archiviert_am is null`, [leadParam]))[0] ?? null,
      };
    })) as Promise<{
      heute: string; kunden: readonly KundeZeile[]; objekte: readonly ObjektZeile[];
      kontakte: readonly KontaktZeile[];
      saetze: Awaited<ReturnType<typeof steuersaetzeAm>>;
      einheiten: Awaited<ReturnType<typeof einheiten>>;
      lead: AnfrageZeile | null;
    }>);
  /*
   * Gebunden wird nur eine Anfrage MIT Kunden, und nur an ihn. Ohne Kunden
   * sagt die Seite, was fehlt, und das Angebot entsteht ohne Bezug — eine
   * stille Zuordnung an den Kunden, den jemand hier wählt, wäre eine
   * Entscheidung, die niemand getroffen hat.
   */
  /*
   * Der Kunde der Anfrage kommt aus IHRER Zeile, nicht aus der Auswahlliste:
   * die endet nach 500 Namen, und ein Kunde jenseits davon hiesse sonst „die
   * Anfrage hat noch keinen Kunden" — ein falscher Grund (V-142). Ein
   * archivierter Kunde bekommt kein neues Angebot und sagt das selbst.
   */
  const lead = daten.lead;
  const anfrageKunde: KundeZeile | null = lead === null || lead.kunde_id === null
    || lead.kunde_name === null || lead.kunde_archiviert ? null
    : { id: lead.kunde_id, name: lead.kunde_name, kundennummer: lead.kundennummer };
  const anfrage = anfrageKunde === null ? null : daten.lead;
  const pfadMitAnfrage = anfrage === null ? pfad : `${pfad}?lead=${anfrage.id}`;

  const liste = `/portal/${mandant}/angebote`;
  const darfListe = darf['angebot.lesen'] === true;
  const knopf = 'inline-flex min-h-11 items-center rounded-md border border-line-strong '
    + 'px-s5 py-s3 text-sm text-text hover:bg-surface-2';
  const mehr = Math.min(zeilenZahl + ZEILEN_SCHRITT, ZEILEN_MAX);
  const zeilen = Array.from({ length: zeilenZahl }, (_, i) => i);

  return (
    <PortalRahmen
      titel={t.titel}
      wurzelTitel={t.modul}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darfListe ? { zurueck: { ziel: liste, text: t.abbrechen } } : {})}
    >
      <div className="mb-s2 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.titel}</h1>
        {darfListe ? (
          <Link href={`/portal/${mandant}/angebote`} className={knopf}>{t.zurListe}</Link>
        ) : null}
      </div>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">{t.untertitel}</p>

      <Hinweis art="hinweis" cse="angebot-hand-warum" className="mb-s6 max-w-prose">
        {t.warum}
      </Hinweis>

      {fehler !== null ? (
        <Hinweis art="warnung" cse="angebot-hand-fehler" className="mb-s5 max-w-prose">
          {t.fehler[fehler] ?? kt.nichtAngelegt}
        </Hinweis>
      ) : null}

      {anfrage !== null ? (
        <Hinweis art="hinweis" cse="angebot-aus-anfrage" className="mb-s5 max-w-prose">
          <strong className="block">{kt.zurAnfrageVorbelegt(anfrage.leadnummer, anfrage.betreff)}</strong>
          {kt.kundeAusAnfrage}
        </Hinweis>
      ) : daten.lead !== null ? (
        <Hinweis art="warnung" cse="angebot-anfrage-ohne-kunde" className="mb-s5 max-w-prose">
          {daten.lead.kunde_archiviert ? kt.anfrageKundeArchiviert : kt.anfrageOhneKunde}
          {darf['crm.lesen'] !== true ? null : (
            <>
              {' '}
              <Link href={`/portal/${mandant}/crm/leads/${daten.lead.id}`}
                    className="underline underline-offset-4">
                {daten.lead.leadnummer}
              </Link>
            </>
          )}
        </Hinweis>
      ) : leadParam !== null ? (
        <Hinweis art="warnung" cse="angebot-anfrage-unbekannt" className="mb-s5 max-w-prose">
          {kt.anfrageUnbekannt}
        </Hinweis>
      ) : null}

      {darf[RECHT] !== true ? (
        <Hinweis art="hinweis" cse="kein-schreibrecht" className="max-w-prose">
          {t.keinSchreibrecht} <Recht schluessel={RECHT} sprache={zugang.sprache} />.
        </Hinweis>
      ) : daten.kunden.length === 0 ? (
        <Hinweis art="warnung" cse="keine-kunden" className="max-w-prose">
          {t.keineKunden}
        </Hinweis>
      ) : daten.saetze.length === 0 ? (
        <Hinweis art="warnung" cse="keine-steuersaetze" className="max-w-prose">
          {t.keineSaetze}
        </Hinweis>
      ) : (
        <Card>
          <form method="post" action="/api/angebot/von-hand"
                data-cse="angebot-hand-formular" className="flex flex-col gap-s5">
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="zurueck" value={pfadMitAnfrage} />
            <input type="hidden" name="zeilen" value={String(zeilenZahl)} />
            {anfrage === null ? null : (
              <input type="hidden" name="lead" value={anfrage.id} data-cse="angebot-lead" />
            )}

            <div className="flex flex-wrap gap-s4">
              {anfrage !== null && anfrageKunde !== null ? (
                <div className="flex min-w-[24ch] flex-1 flex-col gap-s2 text-sm text-text">
                  {t.kunde}
                  <input type="hidden" name="kunde" value={anfrageKunde.id} />
                  <span className={`${FELD} flex items-center`} data-cse="angebot-kunde-fest">
                    {anfrageKunde.name}
                    {anfrageKunde.kundennummer === null ? '' : ` · ${anfrageKunde.kundennummer}`}
                  </span>
                </div>
              ) : (
                <label className="flex min-w-[24ch] flex-1 flex-col gap-s2 text-sm text-text">
                  {t.kunde}
                  <select name="kunde" required className={FELD} defaultValue=""
                          data-cse="angebot-kunde">
                    <option value="" disabled>{t.kundeWaehlen}</option>
                    {daten.kunden.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}{k.kundennummer === null ? '' : ` · ${k.kundennummer}`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex min-w-[24ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.angebotstitel}
                <input type="text" name="titel" required maxLength={200} className={FELD}
                       placeholder={t.titelBeispiel} data-cse="angebot-titel"
                       defaultValue={anfrage?.betreff ?? ''} />
              </label>
            </div>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-[24ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.objekt}
                <select name="objekt" className={FELD} defaultValue=""
                        data-cse="angebot-objekt">
                  <option value="">{t.ohneObjekt}</option>
                  {daten.objekte.map((o) => (
                    <option key={o.id} value={o.id}>{o.bezeichnung}</option>
                  ))}
                </select>
                <span className="text-xs text-text-muted">{t.objektErklaerung}</span>
              </label>
              <label className="flex min-w-[24ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.kontakt}
                <select name="kontakt" className={FELD}
                        defaultValue={anfrage !== null && anfrage.ansprechpartner_id !== null
                          && daten.kontakte.some((kd) => kd.id === anfrage.ansprechpartner_id)
                          ? anfrage.ansprechpartner_id : ''}
                        data-cse="angebot-kontakt">
                  <option value="">{t.ohneKontakt}</option>
                  {daten.kontakte.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.kunde === null ? k.name : `${k.kunde} · ${k.name}`}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-text-muted">{t.kontaktErklaerung}</span>
              </label>
            </div>

            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-[18ch] flex-1 flex-col gap-s2 text-sm text-text">
                {t.gueltigBis}
                <input type="date" name="gueltigBis" min={daten.heute} className={FELD}
                       data-cse="angebot-gueltig-bis" />
                <span className="text-xs text-text-muted">{t.gueltigBisErklaerung}</span>
              </label>
              <label className="flex min-w-[24ch] flex-[2] flex-col gap-s2 text-sm text-text">
                {t.steuersatz}
                <select name="steuersatz" required className={FELD} defaultValue=""
                        data-cse="angebot-steuersatz">
                  <option value="" disabled>{t.steuersatzWaehlen}</option>
                  {daten.saetze.map((s) => (
                    <option key={s.schluessel} value={s.schluessel}>{s.bezeichnung}</option>
                  ))}
                </select>
                <span className="text-xs text-text-muted">{t.steuersatzErklaerung}</span>
              </label>
            </div>

            <Hinweis art="hinweis" cse="steuersatz-offen" className="max-w-prose">
              {t.steuersatzOffen}
            </Hinweis>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.einleitung}
              <textarea name="einleitung" rows={3} maxLength={2000}
                        className={`${FELD} min-h-[6rem]`} data-cse="angebot-einleitung" />
              <span className="text-xs text-text-muted">{t.einleitungErklaerung}</span>
            </label>

            <div className="mt-s4 border-t border-line pt-s5">
              <h2 className="m-0 text-h2 text-text">{t.positionen}</h2>
              <p className="mb-s4 mt-s2 max-w-prose text-sm text-text-muted">
                {t.positionenErklaerung} {t.summeErklaerung}
              </p>

              <div className="flex flex-col gap-s5">
                {zeilen.map((i) => (
                  <fieldset key={i} data-cse="angebot-zeile"
                            className="m-0 flex flex-col gap-s3 rounded-md border
                                       border-line p-s4">
                    <legend className="px-s2 text-xs text-text-muted">
                      {t.zeile} {i + 1}
                    </legend>

                    <label className="flex flex-col gap-s1 text-sm text-text">
                      {t.kurztext}
                      <input type="text" name={`p${String(i)}_kurztext`} maxLength={300}
                             className={FELD} placeholder={i === 0 ? t.kurztextBeispiel : ''}
                             data-cse="zeile-kurztext" />
                    </label>

                    <div className="flex flex-wrap gap-s3">
                      <label className={`${KLEIN} min-w-[10ch] flex-1`}>
                        {t.menge}
                        <input type="text" inputMode="decimal" name={`p${String(i)}_menge`}
                               maxLength={20} className={FELD} data-cse="zeile-menge" />
                      </label>
                      <label className={`${KLEIN} min-w-[10ch] flex-1`}>
                        {t.einheit}
                        <select name={`p${String(i)}_einheit`} className={FELD}
                                defaultValue="" data-cse="zeile-einheit">
                          <option value="" disabled />
                          {daten.einheiten.map((m) => (
                            <option key={m.schluessel} value={m.schluessel}>
                              {m.bezeichnung}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={`${KLEIN} min-w-[12ch] flex-1`}>
                        {t.einzelpreis}
                        <input type="text" inputMode="decimal" name={`p${String(i)}_preis`}
                               maxLength={20} className={FELD}
                               placeholder={i === 0 ? '1.250,00' : ''}
                               data-cse="zeile-preis" />
                      </label>
                      <label className={`${KLEIN} min-w-[16ch] flex-[2]`}>
                        {t.steuersatz}
                        <select name={`p${String(i)}_steuer`} className={FELD}
                                defaultValue="" data-cse="zeile-steuer">
                          <option value="">{t.wieOben}</option>
                          {daten.saetze.map((s) => (
                            <option key={s.schluessel} value={s.schluessel}>
                              {s.bezeichnung}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className={KLEIN}>
                      {t.langtext}
                      <input type="text" name={`p${String(i)}_langtext`} maxLength={2000}
                             className={FELD} data-cse="zeile-langtext" />
                    </label>
                  </fieldset>
                ))}
              </div>

              <p className="mt-s3 max-w-prose text-xs text-text-muted">
                {t.menge}: {t.mengeErklaerung} · {t.einzelpreis}: {t.einzelpreisErklaerung}
              </p>

              {zeilenZahl < ZEILEN_MAX ? (
                <p className="mt-s4 max-w-prose text-xs text-text-muted">
                  <Link href={`/portal/${mandant}/angebote/neu?zeilen=${String(mehr)}`
                    + `${anfrage === null ? '' : `&lead=${anfrage.id}`}`}
                        className="underline underline-offset-2 hover:text-text"
                        data-cse="mehr-zeilen">
                    {t.mehrZeilen}
                  </Link>{' — '}{t.mehrZeilenErklaerung}
                </p>
              ) : (
                <p className="mt-s4 max-w-prose text-xs text-text-muted"
                   data-cse="zeilen-hoechstzahl">
                  {t.hoechstzahlErreicht}
                </p>
              )}
            </div>

            <Hinweis art="hinweis" cse="angebot-entwurf" className="max-w-prose">
              {t.entwurfHinweis}
            </Hinweis>

            <div className="flex flex-wrap gap-s3">
              <Button type="submit" variante="primary" data-cse="angebot-anlegen">
                {t.anlegen}
              </Button>
              {darfListe ? (
                <Link href={`/portal/${mandant}/angebote`} className={knopf}>
                  {t.abbrechen}
                </Link>
              ) : null}
            </div>
          </form>
        </Card>
      )}
    </PortalRahmen>
  );
}
