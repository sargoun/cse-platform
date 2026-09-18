import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import {
  alsKontaktLage, leseGrundlage, leseKundenLage, torAntworten,
  type GrundlageStand, type TorAntwort,
} from '@/server/services/crm/kontakt-grundlage';
import { matrixAntwort, type KundenLage } from '@/server/services/crm/uwg-matrix';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';

/**
 * `/portal/[mandant]/crm/kontakte/[id]/rechtsgrundlage` — die Grundlage nach
 * § 7 UWG setzen, den Widerspruch erfassen (CRM-08, LEG-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **ZWEI Formulare, nicht eines — und das ist der Kern dieser Seite.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der erste Entwurf faltete den Widerspruch als zwei Häkchen in das
 * Grundlagen-Formular. Drei Gründe, warum das nicht geht:
 *
 *  1. **Der Widerspruch ist EINWEG.** `kern.erzwinge_widerspruch` wirft
 *     `restrict_violation`, sobald `werbewiderspruch_am` oder
 *     `widerspruch_am` wieder geleert wird. Ein abwählbares Häkchen erzeugt
 *     also einen rohen Datenbankfehler für eine Handlung, die niemand
 *     verboten hatte.
 *  2. **Er braucht seinen eigenen Nachweis.** Art. 21 DSGVO ist
 *     nachweispflichtig: Quelle, Eingangsdatum, Umfang. `werbewiderspruch`
 *     (0222) führt genau das — in das Grundlagen-Formular gefaltet wäre der
 *     Nachweis ersatzlos entfallen.
 *  3. **Er hängt an einem anderen Recht.** Der Werbewiderspruch läuft mit
 *     `crm.rechtsgrundlage_setzen` (die täglich Arbeit des Vertriebs), der
 *     Vollwiderspruch nach Art. 21 mit `datenschutz.auskunft_erstellen` (die
 *     Entscheidung der Datenschutzstelle). Wer nur das erste hält, sieht den
 *     zweiten Knopf gar nicht.
 *
 * **Zwei Rechte für einen Vorgang.** Die Route öffnet mit
 * `crm.rechtsgrundlage_setzen`; die `WITH CHECK`-Klausel von `t_mandant` auf
 * `ansprechpartner` verlangt zusätzlich `crm.schreiben`. Wer nur das erste
 * hält, sähe „new row violates row-level security policy" — richtig gesperrt,
 * an der falschen Stelle erklärt. Diese Seite sagt es vor dem Absenden.
 */
export const dynamic = 'force-dynamic';

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

const KANAL_TEXT: Readonly<Record<string, string>> = {
  email: 'E-Mail', telefon: 'Telefon', sms: 'SMS', post: 'Post', whatsapp: 'WhatsApp',
};

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

interface Kopf {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly kunde_id: string | null;
  readonly kunde_name: string | null;
}

export default async function Rechtsgrundlage(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<{ meldung?: string; erfolg?: string }>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/crm/kontakte/${id}/rechtsgrundlage`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung,
    'crm.schreiben', 'crm.rechtsgrundlage_lesen', 'datenschutz.auskunft_erstellen',
    'crm.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select ap.id,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.email, ap.kunde_id, k.name as kunde_name
           from ansprechpartner ap
           left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
          where ap.mandant_id = app.aktiver_mandant() and ap.id = $1::uuid
            and ap.archiviert_am is null`, [id]);
      if (kopf === undefined) return null;

      const stand = darf['crm.rechtsgrundlage_lesen'] === true
        ? await leseGrundlage(kontext, id)
        : null;
      /* Die Ebene des Kunden — das Tor fragt sie mit (siehe uwg-matrix.ts). */
      const kundenLage = await leseKundenLage(kontext, kopf.kunde_id);
      const antworten = await torAntworten(kontext, id);
      const [heute] = await kontext.abfrage<{ tag: string }>(
        `select app.berlin_heute()::text as tag`);
      return { kopf, stand, kundenLage, antworten, heute: heute?.tag ?? '' };
    })) as Promise<{
      kopf: Kopf; stand: GrundlageStand | null; kundenLage: KundenLage | null;
      antworten: readonly TorAntwort[]; heute: string;
    } | null>);

  if (daten === null) notFound();
  const { kopf, stand, kundenLage, antworten, heute } = daten;
  /*
   * `null` und nicht `true`: dieses Blatt sendet nichts, also ist nicht
   * feststellbar, ob eine Nachricht die Abmeldezeile trüge (§ 7 Abs. 3 Nr. 4
   * UWG). Die Matrix antwortet dann „nein" MIT diesem Grund statt „ja" aus
   * einer Annahme.
   */
  const lage = stand === null
    ? null : alsKontaktLage(stand, null, kundenLage);
  const gesperrt = stand !== null && stand.widerspruchAm !== null;
  const darfSchreiben = darf['crm.schreiben'] === true;
  const blatt = `/portal/${mandant}/crm/kontakte/${id}`;

  return (
    <PortalRahmen
      titel="Rechtsgrundlage"
      wurzelTitel="CRM"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <nav aria-label="Zurück" className="mb-s3">
        <Link
          href={alsRoute(blatt)}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← {kopf.name}
        </Link>
      </nav>

      <h1 className="mb-s2 text-h1 text-text">Rechtsgrundlage — {kopf.name}</h1>
      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        {kopf.kunde_id === null ? null : <>Kunde: {kopf.kunde_name ?? '—'}. </>}
        Aus diesem Feld zieht das Sendetor seine Antwort (§ 7 UWG, LEG-08). Jede
        Änderung steht im Prüfprotokoll.
      </p>

      {typeof suche.meldung === 'string' && suche.meldung !== '' ? (
        <Hinweis art="warnung" cse="grundlage-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht gespeichert.</strong> {suche.meldung}
        </Hinweis>
      ) : null}
      {typeof suche.erfolg === 'string' && suche.erfolg !== '' ? (
        <Hinweis art="erfolg" cse="grundlage-erfolg" className="mb-s5 max-w-prose">
          {suche.erfolg}
        </Hinweis>
      ) : null}

      {!darfSchreiben ? (
        <Hinweis art="warnung" cse="grundlage-kein-schreibrecht" className="mb-s5 max-w-prose">
          <strong>Speichern geht so nicht durch.</strong> Diese Seite öffnet mit
          <code className="text-text"> crm.rechtsgrundlage_setzen</code>, die Policy auf
          <code className="text-text"> ansprechpartner</code> verlangt zum Schreiben
          zusätzlich <code className="text-text">crm.schreiben</code>. Beide Rechte
          gehören zusammen erteilt — bis dahin ist das Formular unten nur Anzeige.
        </Hinweis>
      ) : null}

      {gesperrt ? (
        <Hinweis art="warnung" cse="grundlage-widersprochen" className="mb-s5 max-w-prose">
          <strong>Dieser Kontakt hat nach Art. 21 DSGVO widersprochen.</strong> Der
          Widerspruch wird nicht zurückgenommen, und die Grundlage bleibt zwingend
          „keine" — der Auslöser
          <code className="text-text"> kern.erzwinge_widerspruch</code> setzt sie
          zurück, was auch immer hier eingetragen wird. Rechnungen und
          Terminbestätigungen gehen weiter.
        </Hinweis>
      ) : null}

      <div className="grid grid-cols-1 gap-s6 lg:grid-cols-2">
        {/* ------------------------------------------------ Der heutige Stand */}
        <section aria-labelledby="stand">
          <h2 id="stand" className="text-h2 text-text">Heutiger Stand</h2>
          {stand === null ? (
            <Hinweis art="hinweis" cse="stand-verdeckt" className="mt-s3">
              <strong>Der heutige Nachweis ist Ihnen nicht sichtbar.</strong> Dafür
              fehlt <code className="text-text">crm.rechtsgrundlage_lesen</code> — ein
              eigenes Recht neben dem Setzen. Sie können damit eine neue Grundlage
              eintragen, ohne die alte zu sehen; was danach gilt, steht dann in der
              Antwort des Tores darunter.
            </Hinweis>
          ) : (
            <dl className="m-0 mt-s3 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5"
                data-cse="stand-block">
              <div>
                <dt className="text-xs text-text-muted">Einstufung</dt>
                <dd className="m-0 mt-s1 text-sm text-text" data-cse="stand-grundlage">
                  {stand.rechtsgrundlage}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Woher sie stammt</dt>
                <dd className="m-0 mt-s1 text-sm text-text">{stand.quelle ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Seit wann belegt</dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {stand.erfasstAm === null ? '—' : BERLIN.format(stand.erfasstAm)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Eingewilligte Kanäle</dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {stand.einwilligungKanaele.length === 0
                    ? '—'
                    : stand.einwilligungKanaele.map((k) => KANAL_TEXT[k] ?? k).join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Ähnliche eigene Leistung</dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {stand.aehnlicheLeistung ? 'festgestellt' : 'nicht festgestellt'}
                  {stand.aehnlicheBegruendung === null ? null : (
                    <span className="block text-xs text-text-muted">
                      {stand.aehnlicheBegruendung}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Widersprüche</dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {stand.werbewiderspruchAm === null && stand.widerspruchAm === null
                    ? 'keine'
                    : [
                      stand.werbewiderspruchAm === null ? null
                        : `Werbewiderspruch seit ${BERLIN.format(stand.werbewiderspruchAm)}`,
                      stand.widerspruchAm === null ? null
                        : `Art. 21 DSGVO seit ${BERLIN.format(stand.widerspruchAm)}`,
                    ].filter((s) => s !== null).join(' · ')}
                </dd>
              </div>
            </dl>
          )}
        </section>

        {/* -------------------------------------------------- Setzen */}
        <section aria-labelledby="setzen">
          <h2 id="setzen" className="text-h2 text-text">Grundlage setzen</h2>
          <form
            method="post"
            action={`/api/crm/ansprechpartner/${id}/rechtsgrundlage`}
            data-cse="grundlage-formular"
            className="mt-s3 flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="zurueck" value={pfad} />

            <fieldset className="m-0 flex flex-col gap-s2 border-0 p-0" disabled={!darfSchreiben}>
              <legend className="mb-s2 p-0 text-sm font-semibold text-text">
                Dürfen wir ihn bewerben?
              </legend>
              {([
                ['keine', 'Keine — er steht in der Liste und bekommt keine Werbung'],
                ['bestandskunde', 'Bestandskunde (§ 7 Abs. 3 UWG)'],
                ['anfrage', 'Er hat angefragt'],
                ['einwilligung', 'Ausdrückliche Einwilligung'],
              ] as const).map(([wert, text]) => (
                <label key={wert} className="flex items-start gap-s2 text-sm text-text">
                  <input
                    type="radio" name="rechtsgrundlage" value={wert} required
                    defaultChecked={(stand?.rechtsgrundlage ?? 'keine') === wert}
                    data-cse="grundlage-radio"
                  />
                  {text}
                </label>
              ))}
            </fieldset>

            <label className="flex flex-col gap-s2 text-sm text-text">
              Woher stammt sie?
              <input
                name="nachweisQuelle" className={FELD}
                defaultValue={stand?.quelle ?? ''}
                placeholder="Häkchen im Angebotsformular vom 12.03."
                data-cse="grundlage-quelle" disabled={!darfSchreiben}
              />
              <span className="text-xs text-text-muted">
                Pflicht, sobald die Grundlage nicht „keine" ist. Eine Einwilligung, von
                der niemand sagen kann, wann und wo sie erteilt wurde, ist in einer
                Abmahnung nichts wert.
              </span>
            </label>

            <label className="flex flex-col gap-s2 text-sm text-text">
              Seit wann ist sie belegt?
              <input
                type="date" name="nachweisAm" className={FELD} max={heute}
                data-cse="grundlage-datum" disabled={!darfSchreiben}
              />
              <span className="text-xs text-text-muted">
                Leer heisst „jetzt", und „jetzt" ist die Serverzeit — nie die Uhr dieses
                Geräts (Invariante 5). Ein Tag in der Zukunft wird abgewiesen; heute ist
                der {heute}.
              </span>
            </label>

            <fieldset className="m-0 flex flex-col gap-s2 border-0 p-0" disabled={!darfSchreiben}>
              <legend className="mb-s2 p-0 text-sm font-semibold text-text">
                Bei einer Einwilligung: worein?
              </legend>
              <p className="m-0 mb-s2 text-xs text-text-muted">
                Nur bei „Ausdrückliche Einwilligung". Der CHECK
                <code className="text-text"> ansprechpartner_kanaele_nur_bei_einwilligung</code>
                {' '}erzwingt das ohnehin — und ohne Kanal ist eine Einwilligung eine
                Einwilligung in nichts.
              </p>
              <div className="flex flex-wrap gap-s3">
                {(['email', 'telefon', 'sms', 'post', 'whatsapp'] as const).map((k) => (
                  <label key={k} className="flex items-center gap-s2 text-sm text-text">
                    <input
                      type="checkbox" name="kanal" value={k}
                      defaultChecked={stand?.einwilligungKanaele.includes(k) ?? false}
                      data-cse="grundlage-kanal"
                    />
                    {KANAL_TEXT[k]}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="m-0 flex flex-col gap-s2 border-0 p-0" disabled={!darfSchreiben}>
              <legend className="mb-s2 p-0 text-sm font-semibold text-text">
                § 7 Abs. 3 Nr. 2 UWG — ähnliche eigene Leistung
              </legend>
              <p className="m-0 mb-s2 text-xs text-text-muted">
                <strong>Eine rechtliche Wertung, die diese Plattform nicht trifft
                (offen, O-95).</strong> Ob das Sicherheitsangebot an einen
                Reinigungskunden eine „ähnliche eigene Dienstleistung" ist, entscheidet
                ein Mensch — und begründet es hier. Vorgabe ist „nein".
              </p>
              <label className="flex items-center gap-s2 text-sm text-text">
                <input
                  type="checkbox" name="aehnlicheLeistung" value="1"
                  defaultChecked={stand?.aehnlicheLeistung ?? false}
                  data-cse="grundlage-aehnlich"
                />
                Ja, die Werbung betrifft eine ähnliche eigene Leistung
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Begründung
                <input
                  name="aehnlicheBegruendung" className={FELD}
                  defaultValue={stand?.aehnlicheBegruendung ?? ''}
                  placeholder="Reinigung und Objektschutz am selben Objekt, Angebot vom 04.02."
                  data-cse="grundlage-aehnlich-begruendung"
                />
              </label>
            </fieldset>

            <label className="flex flex-col gap-s2 text-sm text-text">
              Belegdokument (Kennung, optional)
              <input
                name="belegDokumentId" className={FELD}
                defaultValue={stand?.belegDokumentId ?? ''}
                data-cse="grundlage-beleg" disabled={!darfSchreiben}
              />
            </label>

            <button
              type="submit" disabled={!darfSchreiben} data-cse="grundlage-speichern"
              className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
            >
              Grundlage speichern
            </button>
          </form>
        </section>
      </div>

      {/* ------------------------------------------------ Widerspruch */}
      <section aria-labelledby="widerspruch" className="mt-s7">
        <h2 id="widerspruch" className="text-h2 text-text">Widerspruch erfassen</h2>
        <p className="mt-s2 max-w-prose text-sm text-text-muted">
          <strong>Ein eigener Vorgang mit eigenem Nachweis — und eine
          Einbahnstrasse.</strong> Was hier erfasst wird, wird nicht
          zurückgenommen: der Auslöser
          <code className="text-text"> kern.erzwinge_widerspruch</code> lässt das Datum
          nicht wieder leeren. Die Nachweiszeile (Quelle, Eingang, Umfang) entsteht in
          <code className="text-text"> werbewiderspruch</code>; ein zweiter Eingang
          verschiebt das Datum nicht nach hinten — das erste „nein" gilt.
        </p>

        <div className="mt-s4 grid grid-cols-1 gap-s6 lg:grid-cols-2">
          <form
            method="post"
            action={`/api/crm/ansprechpartner/${id}/widerspruch`}
            data-cse="widerspruch-werbung-formular"
            className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="zurueck" value={pfad} />
            <input type="hidden" name="umfang" value="werbung" />
            <h3 className="m-0 text-h3 text-text">Werbewiderspruch</h3>
            <p className="m-0 text-xs text-text-muted">
              § 7 Abs. 3 Nr. 3 UWG. Schliesst Werbung aus; Rechnungen,
              Terminbestätigungen und Leistungsnachweise gehen weiter.
            </p>
            <label className="flex flex-col gap-s2 text-sm text-text">
              Wie ist er eingegangen?
              <select name="kanal" className={FELD} data-cse="widerspruch-kanal"
                      disabled={!darfSchreiben}>
                <option value="">nicht angegeben</option>
                {(['email', 'telefon', 'sms', 'post', 'whatsapp'] as const).map((k) => (
                  <option key={k} value={k}>{KANAL_TEXT[k]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              Eingegangen am
              <input type="date" name="eingegangenAm" className={FELD} max={heute}
                     data-cse="widerspruch-datum" disabled={!darfSchreiben} />
              <span className="text-xs text-text-muted">
                Leer heisst „jetzt" (Serverzeit). Ein Brief vom 3. trägt den 3. —
                der Widerspruch wirkt ab Eingang, nicht ab Erfassung.
              </span>
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              Bemerkung
              <input name="bemerkung" className={FELD}
                     placeholder="Anruf am Montag, will keine Angebote mehr"
                     data-cse="widerspruch-bemerkung" disabled={!darfSchreiben} />
            </label>
            <button
              type="submit" disabled={!darfSchreiben || stand?.werbewiderspruchAm != null}
              data-cse="widerspruch-werbung-speichern"
              className="min-h-11 self-start rounded-md border border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2 disabled:opacity-50"
            >
              {stand?.werbewiderspruchAm != null
                ? 'Werbewiderspruch liegt vor'
                : 'Werbewiderspruch erfassen'}
            </button>
          </form>

          {darf['datenschutz.auskunft_erstellen'] === true ? (
            <form
              method="post"
              action={`/api/crm/ansprechpartner/${id}/widerspruch`}
              data-cse="widerspruch-voll-formular"
              className="flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
            >
              <input type="hidden" name="zurueck" value={pfad} />
              <input type="hidden" name="umfang" value="verarbeitung" />
              <h3 className="m-0 text-h3 text-text">Widerspruch nach Art. 21 DSGVO</h3>
              <p className="m-0 text-xs text-text-muted">
                Der Vollwiderspruch. Er setzt die Rechtsgrundlage zwingend auf „keine"
                und ist unwiderruflich. Er läuft über
                <code className="text-text"> datenschutz.auskunft_erstellen</code> —
                die Entscheidung der Datenschutzstelle, nicht des Vertriebs.
              </p>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Begründung und Beleg (Pflicht)
                <textarea
                  name="bemerkung" required rows={3} data-cse="widerspruch-voll-grund"
                  className="w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text"
                  placeholder="Schriftlicher Widerspruch vom 01.09.2026, im Dokumentenarchiv unter …"
                />
              </label>
              <button
                type="submit" disabled={stand?.widerspruchAm != null}
                data-cse="widerspruch-voll-speichern"
                className="min-h-11 self-start rounded-md border border-danger px-s5 py-s3 text-sm text-danger hover:bg-danger-soft disabled:opacity-50"
              >
                {stand?.widerspruchAm != null
                  ? 'Widerspruch liegt vor'
                  : 'Widerspruch nach Art. 21 erfassen'}
              </button>
            </form>
          ) : (
            <Hinweis art="hinweis" cse="widerspruch-voll-verdeckt">
              <strong>Den Vollwiderspruch nach Art. 21 DSGVO erfasst hier niemand.</strong>{' '}
              Dafür braucht es <code className="text-text">datenschutz.auskunft_erstellen</code> —
              ein anderes Recht als das Setzen der Grundlage, weil der Vorgang
              unwiderruflich ist. Er wird von der Datenschutzstelle erfasst.
            </Hinweis>
          )}
        </div>
      </section>

      {/* ------------------------------------------------ Wirkung */}
      <section aria-labelledby="wirkung" className="mt-s7">
        <h2 id="wirkung" className="text-h2 text-text">Was gilt jetzt?</h2>
        <p className="mt-s2 max-w-prose text-sm text-text-muted">
          Die Antwort des WIRKSAMEN Tores, Kanal für Kanal — aus
          <code className="text-text"> app.darf_kontaktiert_werden</code>. Nach dem
          Speichern steht hier der neue Stand, und die Wirkung der Änderung ist sofort
          zu sehen statt versprochen.
        </p>
        <DataTable
          beschriftung="Antwort des Sendetores je Kanal, nach dem heutigen Stand"
          zeilen={[...antworten]}
          schluessel={(z) => z.kanal}
          spalten={[
            {
              schluessel: 'kanal', kopf: 'Kanal',
              zelle: (z) => KANAL_TEXT[z.kanal] ?? z.kanal,
            },
            {
              schluessel: 'werbung', kopf: 'Werbung',
              zelle: (z) => (
                <span data-cse="tor-werbung" data-kanal={z.kanal}
                      data-erlaubt={String(z.werbung)}>
                  <StatusPill zustand={z.werbung ? 'Bereit' : 'Abgelehnt'} />
                </span>
              ),
            },
            {
              schluessel: 'vertraglich', kopf: 'Vertraglich',
              zelle: (z) => (
                <span data-cse="tor-vertraglich" data-kanal={z.kanal}
                      data-erlaubt={String(z.vertraglich)}>
                  <StatusPill zustand={z.vertraglich ? 'Bereit' : 'Abgelehnt'} />
                </span>
              ),
            },
            ...(stand === null ? [] : [{
              schluessel: 'grund',
              kopf: 'Nach § 7 UWG (noch nicht wirksam)',
              zelle: (z: TorAntwort) => {
                const m = lage === null
                  ? { erlaubt: false, grund: '', norm: '' }
                  : matrixAntwort(lage, 'werbung', z.kanal);
                return (
                  <span className="text-xs text-text-muted" data-cse="matrix-grund"
                        data-erlaubt={String(m.erlaubt)}>
                    {m.erlaubt ? 'erlaubt' : m.grund}
                  </span>
                );
              },
            }]),
          ]}
        />
      </section>
    </PortalRahmen>
  );
}
