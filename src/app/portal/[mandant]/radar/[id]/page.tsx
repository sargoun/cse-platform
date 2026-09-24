import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../unterseite';
import { leseRadarZeile, type RadarZeile } from '../daten';
import { kennungOder404 } from '../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KETTE_TEXTE } from '@/lib/i18n/verwaltung/crm-kette';
import { RADAR_PLATTFORM_TEXTE } from '@/lib/i18n/verwaltung/radar-plattform';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/radar/[id]` — eine Bekanntmachung (RAD-03, RAD-05,
 * RAD-06, RAD-07, RAD-09).
 *
 * **Die Punktzahl steht hier nicht allein.** Jede Regel, die getroffen oder
 * nicht getroffen hat, steht mit ihrem Beitrag da — genau die
 * Aufschlüsselung, die die Bewertung gerechnet hat. Eine Zahl ohne
 * Begründung wäre eine Behauptung, und über eine Behauptung kann niemand
 * streiten.
 *
 * **Die Rohantwort der Quelle ist abrufbar** (RAD-03). Bei einer Vergabe,
 * die bestritten wird, ist „woher stammt dieses Feld" die erste Frage.
 *
 * **Es gibt keinen Knopf „einreichen"** (D-07). Was es gibt, ist der
 * Statuswechsel: geprüft, verworfen mit Grund, in Bearbeitung.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short',
});

const REGEL_NAME: Readonly<Record<string, string>> = {
  cpv: 'Leistungsart (CPV)', region: 'Ort der Leistung', stichwort: 'Stichwörter',
  wert: 'Auftragswert', frist: 'Restfrist', schwellenwert: 'Schwellenwert',
};

interface Aufschluesselung {
  readonly regel: string;
  readonly treffer: boolean;
  readonly punkte: number;
  readonly gewicht: number;
  readonly text: string;
}

interface Detail {
  readonly quelle: string;
  readonly quellId: string;
  readonly quellUrl: string | null;
  readonly beschreibung: string | null;
  readonly verfahrensart: string | null;
  readonly veroeffentlicht: Date | null;
  readonly fristFragen: Date | null;
  readonly fristTeilnahme: Date | null;
  readonly loseAnzahl: number | null;
  readonly cpvWeitere: readonly string[];
  readonly nuts: readonly string[];
  readonly rohdaten: number;
  readonly letzteRohantwort: Date | null;
  readonly istBerichtigung: boolean;
  readonly aufschluesselung: readonly Aufschluesselung[];
}

export default async function Bekanntmachung(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  if (!UUID.test(id)) notFound();
  const tor = await mandantTor(`/portal/${mandant}/radar/${id}`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const darf = await haeltRechte(zugang.sitzung, 'radar.plattform_verwalten',
    'crm.schreiben', 'crm.lesen');
  const suche = await searchParams;
  const vermerkt = typeof suche['vermerkt'] === 'string' ? suche['vermerkt'] : null;
  const fehlerRoh = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const k = nachSprache(KETTE_TEXTE, zugang.sprache);
  /* Der Registrierungsstand in Worten, nie als Aufzählungswert (V-175). */
  const tp = nachSprache(RADAR_PLATTFORM_TEXTE, zugang.sprache);
  /*
   * Eine Abweisung der Lead-Übernahme (V-139) kommt mit ihrem eigenen
   * Schlüssel zurück und steht bei der Übernahme — nicht als „Nicht
   * geändert" über dem Stand der Bekanntmachung, den sie nicht berührt.
   */
  const leadFehler = eigenerEintrag(k.fehler, fehlerRoh) ?? null;
  const abgewiesen = leadFehler === null ? fehlerRoh : null;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, zugang.sitzung, async (kontext) => {
      const zeilen = await leseRadarZeile(kontext, id);
      const [d] = await kontext.abfrage<Record<string, unknown>>(
        `select a.quelle::text as quelle, a.quell_id, a.quell_url, a.beschreibung,
                a.verfahrensart_roh, a.veroeffentlicht_am, a.frist_fragen, a.frist_teilnahme,
                a.lose_anzahl, a.cpv_weitere, a.ist_berichtigung,
                coalesce((select array_agg(n.nuts_code order by n.nuts_code)
                            from ausschreibung_nuts n where n.ausschreibung_id = a.id), '{}') as nuts,
                (select count(*) from ausschreibung_rohdaten r
                  where r.ausschreibung_id = a.id)::int as rohdaten,
                (select max(r.abgerufen_am) from ausschreibung_rohdaten r
                  where r.ausschreibung_id = a.id) as letzte_rohantwort
           from ausschreibung a where a.id = $1::uuid`, [id]);
      if (d === undefined) return null;
      const [b] = await kontext.abfrage<{ aufschluesselung: Aufschluesselung[] }>(
        `select aufschluesselung from bewertung
          where ausschreibung_id = $1::uuid order by berechnet_am desc limit 1`, [id]);
      /*
       * Das Recht wird GEFRAGT, nicht geraten: `navigationsRechte` ist nach
       * Navigationspunkten geschluesselt, nicht nach Berechtigungen. Die Route
       * prueft ohnehin noch einmal — hier geht es darum, keinen Knopf zu
       * zeigen, der nur zu einer Absage fuehrt.
       */
      /*
       * `/radar/[id]/mappe` verlangt `vergabe.schreiben` (Manifest); diese
       * Seite öffnet mit `radar.lesen` allein. Ein Verweis, der auf 404 führt,
       * verrät, was er nicht zeigen darf (AUT-06). Gemeldet von der
       * Copilot-Runde auf PR 16 / D-581.
       */
      const [r] = await kontext.abfrage<{ darf: boolean; mappe: boolean }>(
        `select app.hat_recht('radar.status_setzen', app.aktiver_mandant()) as darf,
                app.hat_recht('vergabe.schreiben', app.aktiver_mandant()) as mappe`);
      /*
       * Gibt es schon eine Vergabemappe? Wenn ja, fuehrt von hier ein Weg
       * dorthin — sonst waere die Mappe eine Seite, die niemand findet.
       */
      const [mp] = await kontext.abfrage<{ id: string; status: string; offen: number }>(
        `select m.id, m.status::text as status,
                (m.pflichtpositionen_gesamt - m.pflichtpositionen_erledigt) as offen
           from vergabemappe m
           join ausschreibung_vorgang v
             on v.id = m.ausschreibung_vorgang_id and v.mandant_id = m.mandant_id
          where v.ausschreibung_id = $1::uuid and m.geloescht_am is null`, [id]);
      /*
       * Ist die Bekanntmachung in DIESER Gesellschaft schon ein Lead (V-139)?
       * Die Policy auf `lead` verlangt `crm.lesen`; ohne das Recht bleibt die
       * Antwort leer, und die Übernahme weist den zweiten Versuch mit Satz ab.
       */
      /* Nur ein laufender Lead zählt — ein archivierter gibt die Vergabe frei (V-142). */
      const [lead] = await kontext.abfrage<{ id: string; leadnummer: string }>(
        `select id::text as id, leadnummer from lead
          where ausschreibung_id = $1::uuid and mandant_id = app.aktiver_mandant()
            and archiviert_am is null`, [id]);
      return {
        lead: lead ?? null,
        mappe: mp === undefined ? null
          : { id: mp.id, status: mp.status, offen: Number(mp.offen) },
        darfStatus: r?.darf === true,
        darfMappe: r?.mappe === true,
        zeilen,
        detail: {
          quelle: String(d['quelle']),
          quellId: String(d['quell_id']),
          quellUrl: (d['quell_url'] as string | null) ?? null,
          beschreibung: (d['beschreibung'] as string | null) ?? null,
          verfahrensart: (d['verfahrensart_roh'] as string | null) ?? null,
          veroeffentlicht: (d['veroeffentlicht_am'] as Date | null) ?? null,
          fristFragen: (d['frist_fragen'] as Date | null) ?? null,
          fristTeilnahme: (d['frist_teilnahme'] as Date | null) ?? null,
          loseAnzahl: (d['lose_anzahl'] as number | null) ?? null,
          cpvWeitere: (d['cpv_weitere'] as string[] | null) ?? [],
          nuts: (d['nuts'] as string[] | null) ?? [],
          rohdaten: Number(d['rohdaten']),
          letzteRohantwort: (d['letzte_rohantwort'] as Date | null) ?? null,
          istBerichtigung: d['ist_berichtigung'] === true,
          aufschluesselung: b?.aufschluesselung ?? [],
        } satisfies Detail,
      };
    })) as Promise<{
      lead: { id: string; leadnummer: string } | null;
      mappe: { id: string; status: string; offen: number } | null;
      darfStatus: boolean; darfMappe: boolean; zeilen: readonly RadarZeile[]; detail: Detail;
    } | null>);

  if (daten === null) notFound();
  const kopf = daten.zeilen[0];
  if (kopf === undefined) notFound();
  const d = daten.detail;
  const darfStatus = daten.darfStatus;

  return (
    <PortalRahmen
      titel={kopf.titel}
      wurzelTitel="Radar"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="radar"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="text-h1 text-text">{kopf.titel}</h1>
        <Link href={`/portal/${mandant}/radar`}
              className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2">
          Zur Liste
        </Link>
      </div>

      {vermerkt !== null ? (
        <Hinweis art="erfolg" cse="radar-vermerkt" className="mb-s5 max-w-prose">
          <strong>Vermerkt.</strong> Der Stand dieser Bekanntmachung ist jetzt „{vermerkt}".
        </Hinweis>
      ) : null}
      {abgewiesen !== null ? (
        <Hinweis art="warnung" cse="radar-abgewiesen" className="mb-s5 max-w-prose">
          <strong>Nicht geändert.</strong> {abgewiesen === 'grund'
            ? 'Ein Verwerfen braucht einen Grund — RAD-07 verlangt ihn, und in einem halben Jahr erinnert sich niemand mehr ohne ihn.'
            : abgewiesen === 'mappe_recht'
              ? '„In Bearbeitung" legt die Vergabemappe an — dafür fehlt das Recht vergabe.schreiben.'
              : 'Die Handlung wurde abgewiesen.'}
        </Hinweis>
      ) : null}

      {kopf.quellStatus !== 'aktiv' ? (
        <Hinweis art="warnung" cse="radar-quellstatus" className="mb-s5 max-w-prose">
          <strong>{kopf.quellStatus === 'aufgehoben' ? 'Das Verfahren ist aufgehoben.' : 'Die Quelle liefert diese Bekanntmachung nicht mehr.'}</strong>{' '}
          Die Frist zählt nicht weiter, und ein Angebot wäre vergeblich.
        </Hinweis>
      ) : null}
      {d.istBerichtigung ? (
        <Hinweis art="warnung" cse="radar-berichtigung" className="mb-s5 max-w-prose">
          <strong>Änderungsbekanntmachung.</strong> Die Vergabestelle hat nachträglich geändert —
          prüfen Sie Frist und Unterlagen gegen die Quelle.
        </Hinweis>
      ) : null}
      {kopf.plattformName !== null && kopf.registrierung !== 'registriert' ? (
        <Hinweis art="warnung" cse="radar-plattform-warnung" className="mb-s5 max-w-prose">
          <strong>Auf {kopf.plattformName} ist diese Gesellschaft nicht freigeschaltet.</strong>{' '}
          Stand: {eigenerEintrag(tp.stand, kopf.registrierung ?? 'unbekannt')
            ?? tp.stand.unbekannt}. Eine Freischaltung dauert Tage bis Wochen —
          ohne sie ist ein Angebot am Abgabetag nicht abzugeben (RAD-09).
          {/* `/radar/plattformen` verlangt `radar.plattform_verwalten` (Manifest);
            * ohne das Recht fuehrte der Verweis auf 404 (AUT-06; D-581). */}
          {darf['radar.plattform_verwalten'] === true && (
            <>
              {' '}
              <Link href={`/portal/${mandant}/radar/plattformen`} className="underline underline-offset-4">
                Plattformen verwalten
              </Link>.
            </>
          )}
        </Hinweis>
      ) : null}

      <dl data-cse="radar-stammdaten"
          className="mb-s6 grid max-w-prose grid-cols-1 gap-s2 text-sm sm:grid-cols-[12rem_1fr] sm:gap-x-s5">
        <dt className="text-text-muted">Vergabestelle</dt>
        <dd className="text-text">{kopf.vergabestelle ?? '—'}{kopf.ort === null ? '' : `, ${kopf.ort}`}</dd>
        <dt className="text-text-muted">Quelle</dt>
        <dd className="text-text">
          {d.quelle} · <span className="font-mono text-xs">{d.quellId}</span>
          {d.quellUrl === null ? null : (
            <>
              {' '}
              <a href={d.quellUrl} target="_blank" rel="noreferrer noopener"
                 className="underline underline-offset-4" data-cse="radar-quell-url">
                zur Bekanntmachung
              </a>
            </>
          )}
        </dd>
        <dt className="text-text-muted">Verfahrensart</dt>
        <dd className="text-text">{d.verfahrensart ?? 'nicht genannt'}</dd>
        <dt className="text-text-muted">CPV</dt>
        <dd className="text-text">
          {kopf.cpvHaupt ?? '—'}
          {d.cpvWeitere.length === 0 ? '' : ` (auch ${d.cpvWeitere.join(', ')})`}
        </dd>
        <dt className="text-text-muted">Ort (NUTS)</dt>
        <dd className="text-text">{d.nuts.length === 0 ? 'nicht genannt' : d.nuts.join(', ')}</dd>
        <dt className="text-text-muted">Auftragswert</dt>
        <dd className="text-text">
          {kopf.wertCent === null
            ? 'nicht genannt'
            : kopf.wertKriterium === 'fremdwaehrung'
              ? `${kopf.wertCent.toString()} ${kopf.waehrung ?? ''} — nicht umgerechnet (offene Frage O-47)`
              : formatiereGeld(cent(kopf.wertCent))}
        </dd>
        <dt className="text-text-muted">Veröffentlicht</dt>
        <dd className="text-text">{d.veroeffentlicht === null ? '—' : BERLIN.format(d.veroeffentlicht)}</dd>
        <dt className="text-text-muted">Frist Angebot</dt>
        <dd className="text-text" data-cse="radar-frist-angebot">
          {kopf.fristAngebot === null ? 'nicht genannt' : BERLIN.format(kopf.fristAngebot)}
          {kopf.restTage === null ? '' : kopf.restTage < 0 ? ' — abgelaufen' : ` — noch ${String(kopf.restTage)} Tage`}
        </dd>
        <dt className="text-text-muted">Frist Fragen</dt>
        <dd className="text-text">{d.fristFragen === null ? '—' : BERLIN.format(d.fristFragen)}</dd>
        <dt className="text-text-muted">Lose</dt>
        <dd className="text-text">
          {d.loseAnzahl === null ? 'nicht genannt' : String(d.loseAnzahl)}
          {d.loseAnzahl !== null && d.loseAnzahl > 1
            ? ' — ob Lose einzeln beworben werden, ist offen (O-193)' : ''}
        </dd>
      </dl>

      {d.beschreibung === null ? null : (
        <section className="mb-s6 max-w-prose">
          <h2 className="mb-s2 text-h2 text-text">Aus der Bekanntmachung</h2>
          <p className="whitespace-pre-line text-sm text-text-muted">{d.beschreibung}</p>
        </section>
      )}

      <section className="mb-s6">
        <h2 className="mb-s2 text-h2 text-text">Warum diese Punktzahl</h2>
        <p className="mb-s3 max-w-prose text-sm text-text-muted">
          {kopf.ausgeschlossen
            ? 'Ausgeschlossen — die Regel steht unten.'
            : `${String(kopf.punkte)} von ${String(kopf.skalaMax)} Punkten für das Profil „${kopf.profilName}".`}{' '}
          Gerechnet hat das Code, kein Sprachmodell (RAD-05).
          {kopf.istPlatzhalterProfil
            ? ' Die Gewichte dieses Profils sind noch Platzhalter (offene Frage O-15).'
            : ''}
        </p>
        <ul data-cse="radar-aufschluesselung" className="flex flex-col gap-s2">
          {d.aufschluesselung.map((a) => (
            <li key={a.regel} data-cse="radar-regel" data-regel={a.regel}
                className="grid grid-cols-[10rem_1fr_4rem] items-baseline gap-s3 rounded-md border border-line bg-surface p-s3 text-sm">
              <span className="text-text-muted">{REGEL_NAME[a.regel] ?? a.regel}</span>
              <span className="text-text">{a.text}</span>
              <span className={`text-right tabular-nums ${a.punkte > 0 ? 'text-success' : a.punkte < 0 ? 'text-danger' : 'text-text-subtle'}`}>
                {a.punkte > 0 ? `+${String(a.punkte)}` : String(a.punkte)}
              </span>
            </li>
          ))}
        </ul>
        {daten.zeilen.length > 1 ? (
          <p className="mt-s3 text-xs text-text-subtle">
            Diese Bekanntmachung wird gegen {String(daten.zeilen.length)} Profile bewertet:{' '}
            {daten.zeilen.map((z) => `${z.profilName} (${String(z.punkte)})`).join(' · ')}.
          </p>
        ) : null}
      </section>

      <section className="mb-s6 max-w-prose">
        <h2 className="mb-s2 text-h2 text-text">Herkunft</h2>
        <p className="text-sm text-text-muted" data-cse="radar-rohdaten">
          {d.rohdaten === 0
            ? 'Keine Rohantwort gespeichert — diese Zeile wurde nicht über den Einlesejob angelegt.'
            : `${String(d.rohdaten)} gespeicherte Antwort${d.rohdaten === 1 ? '' : 'en'} der Quelle, zuletzt ${
              d.letzteRohantwort === null ? '—' : BERLIN.format(d.letzteRohantwort)}.`}
          {' '}Die Antworten werden unverändert aufbewahrt: bei einer bestrittenen Vergabe ist
          „woher stammt dieses Feld" die erste Frage (RAD-03).
        </p>
      </section>

      {/*
        **Als Lead übernehmen** (V-139, CRM-07). Der Radar war eine der vier
        Leadquellen der Spezifikation und hatte keinen Weg in den Vertrieb:
        die Auswertung beschriftete „Vergaberadar", und der Wert konnte nie
        entstehen. Die Übernahme ändert am Vorgang der Bekanntmachung nichts.
      */}
      {daten.lead !== null && darf['crm.lesen'] === true ? (
        <Hinweis art="hinweis" cse="radar-lead-vorhanden" className="mb-s6 max-w-prose">
          {k.radarSchon(daten.lead.leadnummer)}{' '}
          <Link href={`/portal/${mandant}/crm/leads/${daten.lead.id}`}
                className="underline underline-offset-4" data-cse="radar-zum-lead">
            {k.zumLead}
          </Link>
        </Hinweis>
      ) : darf['crm.schreiben'] === true ? (
        <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="radar-lead">
          <h2 className="mb-s2 text-h2 text-text">{k.radarTitel}</h2>
          <p className="mb-s3 text-sm text-text-muted">{k.radarErklaerung}</p>
          {leadFehler === null ? null : (
            <Hinweis art="warnung" cse="radar-lead-fehler" className="mb-s3">
              {leadFehler}
            </Hinweis>
          )}
          <form method="post" action="/api/crm/lead" data-cse="radar-lead-formular"
                className="flex flex-col gap-s3">
            <input type="hidden" name="was" value="aus_radar" />
            <input type="hidden" name="ausschreibungId" value={id} />
            <input type="hidden" name="zurueck" value={`/portal/${mandant}/radar/${id}`} />
            <label className="flex flex-col gap-s2 text-xs text-text-muted">
              {k.auftraggeber}
              <input type="text" name="auftraggeber" maxLength={300}
                     defaultValue={kopf.vergabestelle ?? ''}
                     className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text"
                     data-cse="radar-lead-auftraggeber" />
            </label>
            <div>
              <Button type="submit" variante="secondary" data-cse="radar-lead-uebernehmen">
                {k.radarUebernehmen}
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {daten.mappe !== null ? (
        <section className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="radar-mappe">
          <h2 className="mb-s2 text-h2 text-text">Vergabemappe</h2>
          <p className="mb-s3 text-sm text-text-muted">
            Stand: <strong>{daten.mappe.status}</strong>.{' '}
            {daten.mappe.offen > 0
              ? `${String(daten.mappe.offen)} Pflichtposition${daten.mappe.offen === 1 ? '' : 'en'} noch offen.`
              : 'Alle Pflichtpositionen geprüft.'}
          </p>
          {daten.darfMappe ? (
            <Link href={`/portal/${mandant}/radar/${id}/mappe`}
                  className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 py-s3 text-sm text-text hover:bg-surface-2"
                  data-cse="radar-zur-mappe">
              Zur Vergabemappe
            </Link>
          ) : null}
        </section>
      ) : null}

      {darfStatus ? (
        <section className="max-w-prose rounded-lg border border-line bg-surface p-s5">
          <h2 className="mb-s2 text-h2 text-text">Stand setzen</h2>
          <p className="mb-s3 text-sm text-text-muted">
            Aktuell: <strong>{kopf.vorgangStatus ?? 'neu'}</strong>. Verwerfen braucht einen Grund
            (RAD-07). „In Bearbeitung" legt die Vergabemappe an — die Prüfliste der geforderten
            Unterlagen. Einreichen geht nicht von hier — die Plattformen bieten dafür keine
            Schnittstelle an (D-07).
          </p>
          {/*
            * **Der Eingang zur Statusseite.** `/radar/[id]/status` wird im
            * Manifest mit demselben `radar.status_setzen` bewacht wie dieses
            * Formular — wer den Verweis sieht, darf die Seite auch oeffnen
            * (AUT-06). Ohne ihn war sie von nirgendwo im Portal erreichbar:
            * gebaut, aber nur ueber die Adresszeile zu finden. Dort steht,
            * was das eingebettete Formular nicht traegt — Fristlage,
            * Quellstand und das Protokoll der bisher gesetzten Staende.
            */}
          <p className="mb-s4 text-sm">
            <Link href={`/portal/${mandant}/radar/${id}/status`}
                  data-cse="radar-zur-statusseite"
                  className="text-brand underline underline-offset-2">
              Stand auf eigener Seite setzen
            </Link>
            <span className="text-text-muted">
              {' '}— mit Fristlage, Quellstand und dem Protokoll der bisher gesetzten Stände.
            </span>
          </p>
          <form method="post" action="/api/radar/vorgang" data-cse="radar-status-formular"
                className="flex flex-col gap-s3">
            {/* Kein verstecktes `mandant`-Feld: den Bereich nimmt die Route
                aus `app.aktiver_mandant()` (Invariante 3). Ein Feld, das der
                Server nicht liest, sieht wie eine Stellschraube aus und ist
                keine. */}
            <input type="hidden" name="ausschreibung" value={id} />
            <input type="hidden" name="profil" value={kopf.profilId} />
            <input type="hidden" name="bewertung" value={kopf.bewertungId} />
            <label className="flex flex-col gap-s2 text-xs text-text-muted">
              Grund (bei „verworfen" verpflichtend)
              <input type="text" name="grund" maxLength={500}
                     className="min-h-11 rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text" />
            </label>
            <div className="flex flex-wrap gap-s2">
              <Button type="submit" name="status" value="geprueft" variante="secondary" data-cse="radar-geprueft">
                Geprüft
              </Button>
              <Button type="submit" name="status" value="in_bearbeitung" variante="primary" data-cse="radar-in-bearbeitung">
                In Bearbeitung
              </Button>
              <Button type="submit" name="status" value="verworfen" variante="danger" data-cse="radar-verworfen">
                Verwerfen
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <p className="max-w-prose text-xs text-text-muted">
          Den Stand setzt, wer <span className="font-mono">radar.status_setzen</span> hält.
        </p>
      )}
    </PortalRahmen>
  );
}
