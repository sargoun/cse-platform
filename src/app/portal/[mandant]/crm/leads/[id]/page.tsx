import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { LEAD_TEXTE } from '@/lib/i18n/verwaltung/crm-lead';
import { Felder } from '@/lib/formular/schema';
import { einsendungLesbar, type EinsendungsZeile } from '@/server/services/lead/einsendung';

/**
 * `/portal/[mandant]/crm/leads/[id]` — eine Anfrage, ihr Verlauf und ihr
 * naechster Schritt (CRM-04, CRM-06).
 *
 * **Der Verlauf waechst, er wird nicht bearbeitet.** Eine Aktivitaet, die
 * sich nachtraeglich umschreiben laesst, ist kein Verlauf, sondern eine
 * Erzaehlung — deshalb gibt es hier ein Formular zum Anlegen und keines zum
 * Aendern.
 *
 * Der **naechste Schritt** steht dagegen auf dem Lead und wird ersetzt: er
 * ist eine Absicht ueber die Zukunft, kein Ereignis der Vergangenheit. Eine
 * Anfrage ohne naechsten Schritt sagt das ausdruecklich, statt still zu
 * liegen — genau so verliert man sie.
 */
export const dynamic = 'force-dynamic';

/** Die sechs Werte von `lead_status` (0017) — in der Reihenfolge des Vorgangs. */
const STAENDE: readonly string[] = [
  'neu', 'in_bearbeitung', 'angebot', 'gewonnen', 'verloren', 'kein_bedarf',
];

const CRM_FELD = 'min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 '
  + 'text-sm text-text';

const STATUS_PILLE: Readonly<Record<string, PillZustand>> = {
  neu: 'Offen', in_bearbeitung: 'In Arbeit', qualifiziert: 'Bereit',
  angebot: 'Angebot', gewonnen: 'Abgeschlossen', verloren: 'Abgelehnt',
  kein_bedarf: 'Archiviert',
};

const TYP_TEXT: Readonly<Record<string, string>> = {
  notiz: 'Notiz', anruf: 'Anruf', email: 'E-Mail', termin: 'Termin',
  aufgabe: 'Aufgabe', system: 'System',
};

interface Kopf {
  readonly id: string;
  readonly leadnummer: string;
  readonly betreff: string | null;
  readonly bedarf: string | null;
  readonly firma_name: string | null;
  readonly quelle: string;
  readonly status: string;
  readonly prioritaet: string;
  readonly punktzahl: number | null;
  readonly punktzahl_begruendung: string | null;
  readonly wert: string | null;
  readonly frist: string | null;
  readonly erste_reaktion: string | null;
  readonly naechste_aktion_text: string | null;
  readonly naechste_aktion_am: string | null;
  /** Dasselbe Datum zum LESEN (TT.MM.JJJJ) — das obere ist der Wert des Datumsfelds. */
  readonly naechste_aktion_anzeige: string | null;
  readonly besitzer: string | null;
  readonly besitzer_benutzer_id: string;
  readonly kunde_id: string | null;
  readonly ansprechpartner_id: string | null;
  readonly formular_eingang_id: string | null;
  readonly utm_quelle: string | null;
  readonly utm_medium: string | null;
  readonly utm_kampagne: string | null;
  readonly referrer: string | null;
}

interface Kontakt {
  readonly id: string;
  readonly vorname: string | null;
  readonly nachname: string;
  readonly email: string | null;
  readonly telefon: string | null;
  readonly kunde_id: string | null;
}

interface Eingang {
  readonly daten: Readonly<Record<string, unknown>>;
  readonly felder: unknown;
  readonly landing_page: string | null;
  readonly eingegangen: string;
}

interface AktivitaetZeile {
  readonly id: string;
  readonly typ: string;
  readonly richtung: string;
  readonly betreff: string | null;
  readonly inhalt: string | null;
  readonly geschehen: string;
  readonly wer: string | null;
}

export default async function LeadDetail(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/crm/leads/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung, 'crm.schreiben', 'system.benutzer_lesen',
    'formular.lesen', 'dokument.lesen');
  const darfSchreiben = darf['crm.schreiben'] === true;
  const darfNamen = darf['system.benutzer_lesen'] === true;
  const darfFormular = darf['formular.lesen'] === true;
  const darfDokument = darf['dokument.lesen'] === true;
  const t = nachSprache(LEAD_TEXTE, zugang.sprache);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  /*
   * `?meldung=` trägt den SATZ, `?fehler=` einen Schlüssel (V-137). Die Route
   * `/api/crm/lead` schickte immer `meldung`, die Seite las nur `fehler` —
   * jede Abweisung beim Setzen des Stands verschwand still.
   */
  const meldung = typeof suche['meldung'] === 'string' ? suche['meldung'] : null;
  const pfad = `/portal/${mandant}/crm/leads/${id}`;

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select l.id, l.leadnummer, l.betreff, l.bedarf_zusammenfassung as bedarf,
                l.firma_name, l.quelle::text as quelle, l.status::text as status,
                l.prioritaet::text as prioritaet, l.punktzahl, l.punktzahl_begruendung,
                l.geschaetzter_wert_cent::text as wert,
                to_char(l.sla_frist_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as frist,
                to_char(l.erste_reaktion_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as erste_reaktion,
                l.naechste_aktion_text,
                to_char(l.naechste_aktion_am at time zone 'Europe/Berlin', 'YYYY-MM-DD')
                  as naechste_aktion_am,
                to_char(l.naechste_aktion_am at time zone 'Europe/Berlin', 'DD.MM.YYYY')
                  as naechste_aktion_anzeige,
                b.name as besitzer, l.besitzer_benutzer_id::text as besitzer_benutzer_id,
                l.kunde_id, l.ansprechpartner_id, l.formular_eingang_id,
                l.utm_quelle, l.utm_medium, l.utm_kampagne, l.referrer
           from lead l
           left join benutzer b on b.id = l.besitzer_benutzer_id
          where l.id = $1`, [id]);
      if (kopf === undefined) return null;

      const verlauf = await kontext.abfrage<AktivitaetZeile>(
        `select a.id, a.typ::text as typ, a.richtung::text as richtung, a.betreff, a.inhalt,
                to_char(a.geschehen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
                  as geschehen,
                b.name as wer
           from lead_aktivitaet a
           left join benutzer b on b.id = a.benutzer_id
          where a.lead_id = $1
          order by a.geschehen_am desc`, [id]);
      /*
       * **Die Auswahl der Zuständigen nur mit `system.benutzer_lesen`**
       * (V-079). Eine Liste, die Namen nennt, IST die Auskunft — AUT-06 gilt
       * auch für ein `<select>`. Ohne das Recht bleibt „mir selbst zuweisen",
       * und dafür braucht es keinen fremden Namen.
       */
      const benutzer = darfNamen
        ? await kontext.abfrage<{ id: string; name: string }>(
          `select distinct b.id, b.name
             from benutzer b
             join benutzer_mandant bm on bm.benutzer_id = b.id
            where bm.mandant_id = app.aktiver_mandant()
              and b.status = 'aktiv' and b.deaktiviert_am is null
              and not b.ist_dienstkonto
            order by b.name limit 200`)
        : [];
      /*
       * **Der Mensch hinter der Anfrage** (V-137). Die Annahme legt ihn seit
       * 0396 als Ansprechpartner an; ohne ihn liess sich keine ausgehende
       * Reaktion belegen. Nur die frei lesbaren Spalten — der
       * Rechtsgrundlage-Block ist `cse_app` entzogen (0020).
       */
      const [kontakt] = kopf.ansprechpartner_id === null ? [] : await kontext.abfrage<Kontakt>(
        `select id, vorname, nachname, email, telefon, kunde_id
           from ansprechpartner where id = $1`, [kopf.ansprechpartner_id]);

      /*
       * **Die Einsendung, gegen die Felder IHRER Version** (V-137, REQ-02 …
       * REQ-04). Nur mit `formular.lesen` — die Policy auf `formular_eingang`
       * verlangt es ohnehin, und die Seite sagt, was fehlt, statt leer zu
       * bleiben.
       */
      const [eingang] = !darfFormular || kopf.formular_eingang_id === null ? []
        : await kontext.abfrage<Eingang>(
          `select e.daten, d.felder, e.landing_page,
                  to_char(e.eingegangen_am at time zone 'Europe/Berlin', 'DD.MM.YYYY, HH24:MI')
                    as eingegangen
             from formular_eingang e
             join formular_definition d on d.id = e.formular_definition_id
            where e.id = $1`, [kopf.formular_eingang_id]);
      const lv = !darfDokument || kopf.formular_eingang_id === null ? []
        : await kontext.abfrage<{ id: string; titel: string }>(
          `select id, titel from dokument
            where formular_eingang_id = $1 and mandant_id = app.aktiver_mandant()
            order by erstellt_am`, [kopf.formular_eingang_id]);
      return { kopf, verlauf, benutzer, kontakt: kontakt ?? null, eingang: eingang ?? null, lv };
    })) as Promise<{
      kopf: Kopf; verlauf: readonly AktivitaetZeile[];
      benutzer: readonly { id: string; name: string }[];
      kontakt: Kontakt | null; eingang: Eingang | null;
      lv: readonly { id: string; titel: string }[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, verlauf, benutzer, kontakt, eingang, lv } = daten;
  const felder = eingang === null ? null : Felder.safeParse(eingang.felder);
  const einsendung: readonly EinsendungsZeile[] = eingang === null ? []
    : einsendungLesbar(felder?.success === true ? felder.data : [], eingang.daten);
  const utm = [kopf.utm_quelle, kopf.utm_medium, kopf.utm_kampagne]
    .filter((w): w is string => w !== null && w !== '').join(' · ');

  return (
    <PortalRahmen
      titel={kopf.betreff ?? kopf.leadnummer}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="crm"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/crm/leads`, text: 'Alle Leads' }}
    >
      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.betreff ?? 'Anfrage'}</h1>
        <StatusPill zustand={STATUS_PILLE[kopf.status] ?? 'Offen'} />
      </div>

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{t.nummer}</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.leadnummer}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{t.firma}</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.firma_name ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            {t.ersteReaktion}
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text" data-cse="lead-erste-reaktion">
            {kopf.erste_reaktion ?? (
              <span className="text-warning">
                {kopf.frist === null ? t.offen : t.offenFrist(kopf.frist)}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{t.besitzer}</dt>
          <dd className="m-0 mt-s1 text-sm text-text" data-cse="lead-besitzer">
            {kopf.besitzer ?? t.niemand}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{t.prioritaet}</dt>
          <dd className="m-0 mt-s1 text-sm text-text" data-cse="lead-prioritaet">
            {t.prioritaetWerte[kopf.prioritaet] ?? kopf.prioritaet}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            {t.geschaetzterWert}
          </dt>
          <dd className="m-0 mt-s1 cse-zahl text-sm text-text">
            {kopf.wert === null ? '—' : formatiereGeld(cent(BigInt(kopf.wert)))}
          </dd>
        </div>
      </dl>

      {kopf.bedarf === null ? null : (
        <p className="mb-s6 max-w-prose whitespace-pre-line rounded-lg border border-line bg-surface p-s5 text-sm text-text">
          {kopf.bedarf}
        </p>
      )}

      {/*
        **Wer angefragt hat, und wie man ihn erreicht** (V-137). Bis hierher
        stand auf diesem Blatt weder E-Mail noch Telefon: die Annahme übernahm
        nur Firma und Nachricht, und niemand konnte zurückrufen.
      */}
      <section aria-labelledby="kontakt" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
               data-cse="lead-kontakt">
        <h2 id="kontakt" className="m-0 text-h3 text-text">{t.kontaktTitel}</h2>
        {kontakt === null ? (
          <p className="m-0 mt-s2 text-sm text-warning">{t.kontaktKeiner}</p>
        ) : (
          <dl className="m-0 mt-s3 grid grid-cols-1 gap-s2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-s4">
            <dt className="text-text-muted">{t.kontaktTitel}</dt>
            <dd className="m-0 text-text">
              {[kontakt.vorname, kontakt.nachname].filter((x) => x !== null && x !== '').join(' ')}
            </dd>
            {kontakt.email === null ? null : (
              <>
                <dt className="text-text-muted">E-Mail</dt>
                <dd className="m-0 text-text">
                  <a href={`mailto:${kontakt.email}`} className="underline underline-offset-4"
                     data-cse="lead-kontakt-email">{kontakt.email}</a>
                </dd>
              </>
            )}
            {kontakt.telefon === null ? null : (
              <>
                <dt className="text-text-muted">Telefon</dt>
                <dd className="m-0 text-text">
                  <a href={`tel:${kontakt.telefon.replace(/[^+0-9]/gu, '')}`}
                     className="underline underline-offset-4"
                     data-cse="lead-kontakt-telefon">{kontakt.telefon}</a>
                </dd>
              </>
            )}
          </dl>
        )}
      </section>

      {kopf.formular_eingang_id === null ? null : (
        <section aria-labelledby="einsendung" className="mb-s6 max-w-prose rounded-lg border border-line bg-surface p-s5"
                 data-cse="lead-einsendung">
          <h2 id="einsendung" className="m-0 text-h3 text-text">{t.einsendungTitel}</h2>
          {!darfFormular ? (
            <p className="m-0 mt-s2 text-sm text-text-muted">
              {t.einsendungOhneRecht} <Recht schluessel="formular.lesen" sprache={zugang.sprache} />.
            </p>
          ) : eingang === null ? null : (
            <>
              <p className="m-0 mt-s2 text-sm text-text-muted">
                {t.einsendungErklaerung(eingang.eingegangen)}
              </p>
              <dl className="m-0 mt-s3 grid grid-cols-1 gap-s2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-x-s4">
                {einsendung.map((z) => (
                  <div key={z.schluessel} className="contents" data-cse="einsendung-feld"
                       data-feld={z.schluessel}>
                    <dt className="text-text-muted">{z.label}</dt>
                    <dd className={`m-0 text-text ${z.art === 'mehrzeilig' ? 'whitespace-pre-line' : ''}`}>
                      {z.art === 'email' ? (
                        <a href={`mailto:${z.wert}`} className="underline underline-offset-4">{z.wert}</a>
                      ) : z.art === 'telefon' ? (
                        <a href={`tel:${z.wert.replace(/[^+0-9]/gu, '')}`}
                           className="underline underline-offset-4">{z.wert}</a>
                      ) : z.wert}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          <h3 className="m-0 mt-s5 text-base text-text">{t.lvTitel}</h3>
          {!darfDokument ? (
            <p className="m-0 mt-s2 text-sm text-text-muted">
              {t.lvOhneRecht} <Recht schluessel="dokument.lesen" sprache={zugang.sprache} />.
            </p>
          ) : lv.length === 0 ? (
            <p className="m-0 mt-s2 text-sm text-text-muted">—</p>
          ) : (
            <ul className="m-0 mt-s2 list-none p-0 text-sm">
              {lv.map((d) => (
                <li key={d.id}>
                  <a href={`/portal/${mandant}/dokumente/${d.id}`} data-cse="lead-lv"
                     className="underline underline-offset-4">{d.titel}</a>
                </li>
              ))}
            </ul>
          )}

          <h3 className="m-0 mt-s5 text-base text-text">{t.herkunftTitel}</h3>
          {utm === '' && kopf.referrer === null && (eingang?.landing_page ?? null) === null ? (
            <p className="m-0 mt-s2 text-sm text-text-muted">{t.herkunftKeine}</p>
          ) : (
            <dl className="m-0 mt-s2 grid grid-cols-1 gap-s2 text-sm sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-x-s4"
                data-cse="lead-herkunft">
              {utm === '' ? null : (
                <><dt className="text-text-muted">{t.herkunftUtm}</dt><dd className="m-0 break-all text-text">{utm}</dd></>
              )}
              {kopf.referrer === null ? null : (
                <><dt className="text-text-muted">{t.herkunftReferrer}</dt><dd className="m-0 break-all text-text">{kopf.referrer}</dd></>
              )}
              {(eingang?.landing_page ?? null) === null ? null : (
                <><dt className="text-text-muted">{t.herkunftEinstieg}</dt><dd className="m-0 break-all text-text">{eingang?.landing_page}</dd></>
              )}
            </dl>
          )}
        </section>
      )}

      <section aria-labelledby="naechster" className="mb-s7">
        <h2 id="naechster" className="text-h2 text-text">Nächster Schritt</h2>
        {kopf.naechste_aktion_text === null ? (
          <p data-cse="ohne-naechsten-schritt" className="text-sm text-warning">
            Nicht festgelegt. Eine Anfrage ohne nächsten Schritt liegt still —
            und genau so verliert man sie.
          </p>
        ) : (
          <p data-cse="naechster-schritt" className="text-sm text-text">
            {kopf.naechste_aktion_text}
            {kopf.naechste_aktion_anzeige === null ? null : (
              <span className="ml-s2 text-text-muted">({kopf.naechste_aktion_anzeige})</span>
            )}
          </p>
        )}

        {/* Der Schlüssel gewinnt, weil er übersetzt ist; der Satz der Route
            ist deutsch und nur der Rückfall. Ein unbekannter Schlüssel ist nie
            selbst der Text — `unbekannte_prioritaet` sagt niemandem etwas. */}
        {(fehler !== null || meldung !== null) && (
          <Hinweis art="warnung" cse="lead-fehler" className="mt-s4 max-w-prose">
            {(fehler === null ? undefined : t.fehler[fehler]) ?? meldung ?? t.nichtGespeichert}
          </Hinweis>
        )}

        {/*
          **Priorität und Besitzer** (V-137, CRM-02). Beides stand in der
          Tabelle und ließ sich nirgends setzen: die Priorität blieb für immer
          „normal", und wer eine Anfrage übernahm, stand nicht daran.
        */}
        {darfSchreiben && (
          <form method="post" action="/api/crm/lead" data-cse="lead-pflege-formular"
                className="mt-s4 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="was" value="pflege" />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <h3 className="m-0 text-base text-text">{t.pflegeTitel}</h3>
            <p className="m-0 text-sm text-text-muted">{t.pflegeErklaerung}</p>
            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.prioritaet}
                <select name="prioritaet" defaultValue={kopf.prioritaet} className={CRM_FELD}
                        data-cse="lead-pflege-prioritaet">
                  {['niedrig', 'normal', 'hoch'].map((w) => (
                    <option key={w} value={w}>{t.prioritaetWerte[w] ?? w}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.besitzer}
                {darfNamen ? (
                  <select name="besitzerBenutzerId" defaultValue={kopf.besitzer_benutzer_id}
                          className={CRM_FELD} data-cse="lead-pflege-besitzer">
                    {benutzer.some((b) => b.id === kopf.besitzer_benutzer_id) ? null : (
                      <option value={kopf.besitzer_benutzer_id}>{kopf.besitzer ?? t.niemand}</option>
                    )}
                    {benutzer.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <span className="flex items-center gap-s3">
                      <input type="checkbox" name="besitzerBenutzerId" value={sitzung.benutzerId}
                             className="min-h-5 min-w-5" data-cse="lead-pflege-mir" />
                      {t.wvMirSelbst}
                    </span>
                    <span className="text-xs text-text-muted">{t.pflegeBesitzerOhneNamensrecht}</span>
                  </>
                )}
              </label>
            </div>
            <div>
              <button type="submit" data-cse="lead-pflege-speichern"
                      className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 text-sm text-text hover:bg-surface-2">
                {t.pflegeSpeichern}
              </button>
            </div>
          </form>
        )}

        {/*
          **Der Stand liess sich nirgends setzen** (V-077). `setzeLeadStatus`
          steht seit `crm/anlegen.ts` da, `POST /api/crm/lead` nimmt `status`
          entgegen — und kein Formular schickte ihn. Eine Anfrage, die niemand
          weiterstellt, bleibt fuer immer „neu", und die Auswertung nach
          gewonnen/verloren zaehlt eine leere Menge.
        */}
        {darfSchreiben ? (
          <form method="post" action="/api/crm/lead" data-cse="lead-stand-formular"
                className="mt-s4 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <h3 className="m-0 text-base text-text">{t.standTitel}</h3>
            <p className="m-0 text-sm text-text-muted">{t.standErklaerung}</p>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.stand}
              <select name="status" defaultValue={kopf.status} className={CRM_FELD}
                      data-cse="lead-stand">
                {STAENDE.map((w) => (
                  <option key={w} value={w}>{t.standWerte[w] ?? w}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.verlustGrund}
              <input name="grund" maxLength={300} className={CRM_FELD} data-cse="lead-grund" />
              <span className="text-xs text-text-muted">{t.verlustGrundErklaerung}</span>
            </label>
            <div>
              <button type="submit" data-cse="lead-stand-speichern"
                      className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover">
                {t.standSpeichern}
              </button>
            </div>
          </form>
        ) : (
          <Hinweis art="hinweis" cse="lead-kein-recht" className="mt-s4 max-w-prose">
            {t.keinSchreibrecht} <Recht schluessel="crm.schreiben" sprache={zugang.sprache} />.
          </Hinweis>
        )}

        {/*
          **Eine Wiedervorlage liess sich niemandem zuweisen** (V-079). Die
          Route liest `zustaendigBenutzerId` und `leadId` — und das einzige
          Anlegeformular stand auf dem Kontaktblatt und schickte weder das eine
          noch das andere. Eine Wiedervorlage ohne Zustaendigen steht in der
          Liste mit „niemand zugewiesen" und wartet auf niemanden.
        */}
        {darfSchreiben && (
          <form method="post" action="/api/crm/wiedervorlage" data-cse="lead-wv-formular"
                className="mt-s4 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="was" value="anlegen" />
            <input type="hidden" name="leadId" value={id} />
            {kopf.kunde_id !== null && (
              <input type="hidden" name="kundeId" value={kopf.kunde_id} />
            )}
            <input type="hidden" name="zurueck" value={pfad} />
            <h3 className="m-0 text-base text-text">{t.wvTitel}</h3>
            <p className="m-0 text-sm text-text-muted">{t.wvErklaerung}</p>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.wvBetreff}
              <input name="betreff" required maxLength={200} className={CRM_FELD}
                     defaultValue={kopf.betreff ?? ''} data-cse="lead-wv-betreff" />
            </label>
            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.wvFaellig}
                <input type="datetime-local" name="faelligAm" required className={CRM_FELD}
                       data-cse="lead-wv-faellig" />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.wvErinnerung} <span className="text-text-muted">{t.freiwillig}</span>
                <input type="datetime-local" name="erinnerungAm" className={CRM_FELD}
                       data-cse="lead-wv-erinnerung" />
              </label>
            </div>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.wvZustaendig}
              {darfNamen ? (
                <select name="zustaendigBenutzerId" defaultValue="" className={CRM_FELD}
                        data-cse="lead-wv-zustaendig">
                  <option value="">{t.wvNiemand}</option>
                  {benutzer.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              ) : (
                <>
                  <span className="flex items-center gap-s3">
                    <input type="checkbox" name="zustaendigBenutzerId"
                           value={sitzung.benutzerId} className="min-h-5 min-w-5"
                           data-cse="lead-wv-mir" />
                    {t.wvMirSelbst}
                  </span>
                  <span className="text-xs text-text-muted">{t.wvOhneNamensrecht}</span>
                </>
              )}
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.wvNotiz} <span className="text-text-muted">{t.freiwillig}</span>
              <textarea name="notiz" rows={2} maxLength={500} className={CRM_FELD}
                        data-cse="lead-wv-notiz" />
            </label>
            <div>
              <button type="submit" data-cse="lead-wv-anlegen"
                      className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-s5 text-sm text-text hover:bg-surface-2">
                {t.wvAnlegen}
              </button>
            </div>
          </form>
        )}

        {darfSchreiben && (
          <form
            method="post"
            action={`/api/lead?mandant=${mandant}`}
            data-cse="lead-aktivitaet-formular"
            className="mt-s4 flex max-w-prose flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="leadId" value={id} />
            <h3 className="m-0 text-base text-text">{t.aktivitaetTitel}</h3>
            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.aktivitaetArt}
                <select name="typ" defaultValue="notiz" className={CRM_FELD} data-cse="lead-aktivitaet-typ">
                  {['notiz', 'anruf', 'email', 'termin', 'aufgabe'].map((w) => (
                    <option key={w} value={w}>{t.aktivitaetArten[w] ?? w}</option>
                  ))}
                </select>
              </label>
              {/*
                **Die Richtung** (V-137). Anruf und E-Mail wurden fest als
                „intern" gespeichert — die SLA-Uhr stoppt aber nur an einer
                AUSGEHENDEN Aktivität (0017). Niemand konnte die erste Reaktion
                belegen, und jede Webanfrage eskalierte stündlich weiter.
              */}
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.richtung}
                <select name="richtung" defaultValue="intern" className={CRM_FELD}
                        data-cse="lead-aktivitaet-richtung">
                  {['intern', 'ausgehend', 'eingehend'].map((w) => (
                    <option key={w} value={w}>{t.richtungWerte[w] ?? w}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="m-0 text-xs text-text-muted">{t.richtungErklaerung}</p>

            <label className="flex flex-col gap-s2 text-sm text-text">
              {t.wasPassiert}
              <textarea name="inhalt" rows={3} className={CRM_FELD} data-cse="lead-aktivitaet-inhalt" />
            </label>
            <div className="flex flex-wrap gap-s4">
              <label className="flex min-w-0 flex-[2] flex-col gap-s2 text-sm text-text">
                {t.naechsterSchritt}
                <input name="naechsteAktion" type="text" defaultValue={kopf.naechste_aktion_text ?? ''}
                       className={CRM_FELD} />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-s2 text-sm text-text">
                {t.wann}
                <input name="naechsteAktionAm" type="date" defaultValue={kopf.naechste_aktion_am ?? ''}
                       className={CRM_FELD} />
              </label>
            </div>
            <div>
              <button type="submit" data-cse="lead-notieren"
                      className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover">
                {t.festhalten}
              </button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="verlauf">
        <h2 id="verlauf" className="text-h2 text-text">Verlauf</h2>
        {verlauf.length === 0 ? (
          <p className="text-sm text-text-muted">Noch nichts festgehalten.</p>
        ) : (
          <ol data-cse="verlauf" className="m-0 list-none p-0">
            {verlauf.map((a) => (
              <li key={a.id} className="border-b border-line py-s4">
                <p className="m-0 text-micro uppercase tracking-[0.08em] text-text-subtle">
                  {`${TYP_TEXT[a.typ] ?? a.typ} · ${a.geschehen}`}
                  {a.wer === null ? '' : ` · ${a.wer}`}
                </p>
                {a.betreff === null ? null : (
                  <p className="m-0 mt-s1 text-sm text-text">{a.betreff}</p>
                )}
                {a.inhalt === null ? null : (
                  <p className="m-0 mt-s1 whitespace-pre-line text-sm text-text-muted">
                    {a.inhalt}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </PortalRahmen>
  );
}
