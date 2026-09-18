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
  alsKontaktLage, leseGrundlage, torAntworten,
  type GrundlageStand, type TorAntwort,
} from '@/server/services/crm/kontakt-grundlage';
import { abweichungVomTor, matrixAntwort } from '@/server/services/crm/uwg-matrix';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { alsRoute } from '@/server/auth/kennwort-anmeldung';

/**
 * `/portal/[mandant]/crm/kontakte/[id]` — das Blatt eines Ansprechpartners
 * (CRM-03, CRM-08, LEG-08).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Nachweisblock steht hinter dem ENGEREN Recht, nicht hinter dem der
 * Route.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Route öffnet mit `crm.lesen` — das hat jede `leitung` gebunden. Der
 * Rechtekatalog führt daneben `crm.rechtsgrundlage_lesen`, für `leitung` nur
 * BINDBAR, und `04-SEITENKARTE.md` §5.25 bewacht mit ihm genau diese Daten
 * (`/portal/[mandant]/datenschutz/widersprueche`). Stünde der Block hier
 * hinter blossem `crm.lesen`, sähe jede Leitung auf diesem Blatt genau das,
 * was ihr der Widerspruchskatalog eine Seite weiter vorenthält — eine stille
 * Ausweitung eines Rechts durch die Wahl der Funktion.
 *
 * Deshalb liest er über `app.kontakt_rechtsgrundlage_blatt` (0247), und die
 * prüft das engere Recht. Fehlt es, steht hier, WAS fehlt (O-661).
 *
 * **Jeder Abruf dieses Blocks schreibt eine Protokollzeile** (LEG-08). Das
 * steht auf der Seite, nicht nur im Quelltext: wer den Einwilligungsnachweis
 * einer Person liest, soll wissen, dass es sichtbar ist.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Es gibt hier keinen Sendeknopf.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `04-SEITENKARTE.md` nennt für CRM-08 ein Sendetor auf jedem Schirm, der
 * eine Ausgangsnachricht starten kann; `POST /api/crm/nachrichten`
 * (05-API-KARTE Zeile 643) ist **nicht gebaut**. Ein Knopf, der nichts tut,
 * ist schlechter als keiner — er verspricht einen Weg. Was hier steht, ist
 * die ANTWORT des Tores je Kanal, damit sichtbar ist, was ginge.
 */
export const dynamic = 'force-dynamic';

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});
const BERLIN_TAG = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium',
});

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  einwilligung: 'Ausdrückliche Einwilligung',
  bestandskunde: 'Bestandskunde (§ 7 Abs. 3 UWG)',
  anfrage: 'Er hat angefragt',
  keine: 'keine',
};

const KANAL_TEXT: Readonly<Record<string, string>> = {
  email: 'E-Mail', telefon: 'Telefon', sms: 'SMS', post: 'Post', whatsapp: 'WhatsApp',
};

interface Kopf {
  readonly id: string;
  readonly anrede: string | null;
  readonly titel: string | null;
  readonly name: string;
  readonly position: string | null;
  readonly abteilung: string | null;
  readonly email: string | null;
  readonly telefon: string | null;
  readonly mobil: string | null;
  readonly sprache: string;
  readonly ist_hauptkontakt: boolean;
  readonly ausgeschieden_am: string | null;
  readonly kunde_id: string | null;
  readonly kunde_name: string | null;
}

interface VerlaufZeile {
  readonly id: string;
  readonly typ: string;
  readonly richtung: string;
  readonly zweck: string;
  readonly kanal: string | null;
  readonly betreff: string;
  readonly geschehen: string;
  readonly akteur: string | null;
}

export default async function Kontaktblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/crm/kontakte/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * Zwei Zusatzrechte, damit kein Knopf auf ein 404 führt (AUT-06): die
   * Unterseite `/rechtsgrundlage` öffnet mit `crm.rechtsgrundlage_setzen`,
   * und der Name des Akteurs im Verlauf kommt aus `benutzer` und damit aus
   * `system.benutzer_lesen`.
   */
  const darf = await haeltRechte(sitzung,
    'crm.rechtsgrundlage_setzen', 'crm.rechtsgrundlage_lesen', 'system.benutzer_lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select ap.id, ap.anrede, ap.titel,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.position, ap.abteilung, ap.email, ap.telefon, ap.mobil,
                ap.sprache::text as sprache, ap.ist_hauptkontakt,
                ap.ausgeschieden_am::text as ausgeschieden_am,
                ap.kunde_id, k.name as kunde_name
           from ansprechpartner ap
           left join kunde k on k.mandant_id = ap.mandant_id and k.id = ap.kunde_id
          where ap.mandant_id = app.aktiver_mandant() and ap.id = $1::uuid
            and ap.archiviert_am is null`, [id]);
      if (kopf === undefined) return null;

      /* Der Nachweis nur mit dem engeren Recht — siehe Kopf dieser Datei. */
      const stand = darf['crm.rechtsgrundlage_lesen'] === true
        ? await leseGrundlage(kontext, id)
        : null;

      const antworten = await torAntworten(kontext, id);

      const verlauf = await kontext.abfrage<VerlaufZeile>(
        `select la.id, la.typ::text as typ, la.richtung::text as richtung,
                la.zweck::text as zweck, la.kanal, la.betreff,
                to_char(la.geschehen_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as geschehen,
                b.name as akteur
           from lead_aktivitaet la
           left join benutzer b on b.id = la.benutzer_id
          where la.mandant_id = app.aktiver_mandant()
            and la.ansprechpartner_id = $1::uuid
          order by la.geschehen_am desc
          limit 50`, [id]);

      return { kopf, stand, antworten, verlauf };
    })) as Promise<{
      kopf: Kopf; stand: GrundlageStand | null;
      antworten: readonly TorAntwort[]; verlauf: readonly VerlaufZeile[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, stand, antworten, verlauf } = daten;
  const abweichung = stand === null ? null : abweichungVomTor(alsKontaktLage(stand));

  const knopf = 'inline-flex min-h-11 items-center rounded-md border '
    + 'border-line-strong px-s5 py-s3 text-sm text-text hover:bg-surface-2';

  return (
    <PortalRahmen
      titel={kopf.name}
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
          href={`/portal/${mandant}/crm/kontakte`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Ansprechpartner
        </Link>
      </nav>

      <div className="mb-s5 flex flex-wrap items-center justify-between gap-s3">
        <div className="flex flex-wrap items-center gap-s3">
          <h1 className="m-0 text-h1 text-text">{kopf.name}</h1>
          {kopf.ist_hauptkontakt ? (
            <span className="text-xs text-text-muted">Hauptkontakt</span>
          ) : null}
          {kopf.ausgeschieden_am === null ? null : (
            <StatusPill zustand="Archiviert" />
          )}
        </div>
        {darf['crm.rechtsgrundlage_setzen'] === true ? (
          <Link href={alsRoute(`${pfad}/rechtsgrundlage`)} className={knopf}
                data-cse="kontakt-grundlage-aendern">
            Rechtsgrundlage ändern
          </Link>
        ) : null}
      </div>

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.kunde_id === null ? '—' : (
              <Link
                href={`/portal/${mandant}/crm/kunden/${kopf.kunde_id}`}
                className="text-text underline-offset-2 hover:text-brand hover:underline"
              >
                {kopf.kunde_name ?? 'Kunde'}
              </Link>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Position
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.position ?? '—'}
            {kopf.abteilung === null ? null : (
              <span className="block text-xs text-text-muted">{kopf.abteilung}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Kontakt
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.email ?? '—'}
            <br />
            {kopf.telefon ?? ''}
            {kopf.mobil === null ? null : (
              <span className="block text-xs text-text-muted">mobil {kopf.mobil}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Anrede und Sprache
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {`${kopf.anrede ?? '—'}${kopf.titel === null ? '' : ` ${kopf.titel}`}`}
            <span className="block text-xs text-text-muted">{kopf.sprache}</span>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="grundlage" className="mb-s7">
        <h2 id="grundlage" className="text-h2 text-text">Rechtsgrundlage</h2>
        {stand === null ? (
          <Hinweis art="hinweis" cse="grundlage-verdeckt" className="mt-s3 max-w-prose">
            <strong>Der Nachweis ist Ihnen nicht sichtbar.</strong> Dafür fehlt
            <code className="text-text"> crm.rechtsgrundlage_lesen</code> — ein
            eigenes Recht neben <code className="text-text">crm.lesen</code>, mit dem
            die Seitenkarte auch den Werbewiderspruchs-Katalog bewacht. Das heisst
            nicht, dass keine Grundlage hinterlegt ist. Die Antwort des Sendetores
            steht darunter und ist von diesem Recht unabhängig.
          </Hinweis>
        ) : (
          <>
            <p className="mt-s2 max-w-prose text-sm text-text-muted">
              Dieser Abruf steht im Prüfprotokoll (LEG-08). Wer einen
              Einwilligungsnachweis liest, hinterlässt eine Spur — das ist der Zweck
              des Nachweises und kein Nebeneffekt.
            </p>
            <dl className="m-0 mt-s4 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
                data-cse="grundlage-block">
              <div>
                <dt className="text-xs text-text-muted">Einstufung</dt>
                <dd className="m-0 mt-s1 text-sm text-text" data-cse="grundlage-wert">
                  {GRUNDLAGE_TEXT[stand.rechtsgrundlage] ?? stand.rechtsgrundlage}
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
                <dt className="text-xs text-text-muted">Belegdokument</dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {stand.belegDokumentId === null ? 'keines hinterlegt' : (
                    <Link
                      href={`/portal/${mandant}/dokumente/${stand.belegDokumentId}`}
                      className="text-text underline-offset-2 hover:text-brand hover:underline"
                    >
                      Dokument öffnen
                    </Link>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Eingewilligte Kanäle</dt>
                <dd className="m-0 mt-s1 text-sm text-text">
                  {stand.einwilligungKanaele.length === 0
                    ? stand.rechtsgrundlage === 'einwilligung'
                      ? 'keiner — die Einwilligung trägt damit nichts'
                      : '—'
                    : stand.einwilligungKanaele
                      .map((k) => KANAL_TEXT[k] ?? k).join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">
                  Ähnliche eigene Leistung (§ 7 Abs. 3 Nr. 2 UWG)
                </dt>
                <dd className="m-0 mt-s1 text-sm text-text" data-cse="grundlage-aehnlich">
                  {stand.aehnlicheLeistung ? 'festgestellt' : 'nicht festgestellt (O-95)'}
                  {stand.aehnlicheBegruendung === null ? null : (
                    <span className="block text-xs text-text-muted">
                      {stand.aehnlicheBegruendung}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Werbewiderspruch</dt>
                <dd className="m-0 mt-s1 text-sm text-text" data-cse="grundlage-werbewiderspruch">
                  {stand.werbewiderspruchAm === null
                    ? 'keiner'
                    : `seit ${BERLIN_TAG.format(stand.werbewiderspruchAm)}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Widerspruch (Art. 21 DSGVO)</dt>
                <dd className="m-0 mt-s1 text-sm text-text" data-cse="grundlage-widerspruch">
                  {stand.widerspruchAm === null
                    ? 'keiner'
                    : `seit ${BERLIN_TAG.format(stand.widerspruchAm)} — jede Werbung ausgeschlossen`}
                </dd>
              </div>
            </dl>

            {abweichung === null ? null : (
              <Hinweis art="warnung" cse="grundlage-abweichung" className="mt-s4 max-w-prose">
                <strong>Vorschrift und wirksames Tor gehen hier auseinander.</strong>{' '}
                {abweichung} Das Tor unten ist das WIRKSAME — es entscheidet, was
                hinausgeht. Die schärfere Fassung des § 7 UWG ist noch nicht
                eingeschaltet, und bis dahin steht dieser Satz hier statt in einem
                Kommentar.
              </Hinweis>
            )}

            <p className="mt-s4 max-w-prose text-xs text-text-muted">
              Der Werbewiderspruch ist eine Einbahnstrasse: der Auslöser
              <code className="text-text"> kern.erzwinge_widerspruch</code> lässt ihn
              nicht wieder leeren. Ein Widerspruch nach Art. 21 DSGVO setzt die
              Grundlage zwingend auf „keine".
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="tor" className="mb-s7">
        <h2 id="tor" className="text-h2 text-text">Was darf hinausgehen?</h2>
        <p className="mt-s2 max-w-prose text-sm text-text-muted">
          Die Antworten kommen aus{' '}
          <code className="text-text">app.darf_kontaktiert_werden</code> — derselben
          Funktion, die der Sendepfad und der Auslöser
          <code className="text-text"> kern.uwg_sendetor</code> fragen. Diese Seite
          formuliert die Regel nicht nach.
        </p>
        <DataTable
          beschriftung="Antwort des Sendetores je Kanal, für Werbung und für vertragliche Kommunikation"
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
              schluessel: 'vorschrift',
              kopf: 'Nach § 7 UWG (noch nicht wirksam)',
              zelle: (z: TorAntwort) => {
                const m = matrixAntwort(alsKontaktLage(stand), 'werbung', z.kanal);
                return (
                  <span title={`${m.norm}: ${m.grund}`} data-cse="matrix-werbung"
                        data-erlaubt={String(m.erlaubt)}>
                    <StatusPill zustand={m.erlaubt ? 'Bereit' : 'Abgelehnt'} />
                  </span>
                );
              },
            }]),
          ]}
        />
        <p className="mt-s3 max-w-prose text-xs text-text-muted">
          <strong>Es gibt hier keinen Sendeknopf.</strong> Der Endpunkt für eine
          Ausgangsnachricht (<code className="text-text">POST /api/crm/nachrichten</code>,
          CRM-08) ist nicht gebaut. Ein Knopf, der nichts tut, verspricht einen Weg,
          den es nicht gibt. Und nichts verlässt das System ohne menschliche Freigabe
          durch <code className="text-text">server/agent/policy.ts</code>.
        </p>
      </section>

      <section aria-labelledby="verlauf">
        <h2 id="verlauf" className="text-h2 text-text">Verlauf</h2>
        {verlauf.length === 0 ? (
          <p className="mt-s3 text-sm text-text-muted">
            Zu diesem Kontakt ist noch keine Kommunikation festgehalten.
          </p>
        ) : (
          <DataTable
            beschriftung="Kommunikation mit diesem Ansprechpartner, neueste zuerst"
            zeilen={verlauf}
            schluessel={(z) => z.id}
            spalten={[
              { schluessel: 'wann', kopf: 'Wann', zelle: (z) => z.geschehen },
              { schluessel: 'betreff', kopf: 'Betreff', zelle: (z) => z.betreff },
              { schluessel: 'typ', kopf: 'Art', zelle: (z) => z.typ },
              {
                schluessel: 'richtung', kopf: 'Richtung',
                zelle: (z) => `${z.richtung}${z.kanal === null ? '' : ` · ${z.kanal}`}`,
              },
              { schluessel: 'zweck', kopf: 'Zweck', zelle: (z) => z.zweck },
              {
                schluessel: 'akteur', kopf: 'Wer',
                zelle: (z) => (z.akteur ?? (
                  darf['system.benutzer_lesen'] === true
                    ? <span className="text-text-subtle">System</span>
                    : <span className="text-text-subtle" data-cse="akteur-verdeckt"
                            title="Dafür fehlt system.benutzer_lesen">—</span>
                )),
              },
            ]}
          />
        )}
        {darf['system.benutzer_lesen'] === true ? null : (
          <p className="mt-s3 max-w-prose text-xs text-text-muted"
             data-cse="verlauf-akteur-hinweis">
            Die Namen der Handelnden sind Ihnen nicht sichtbar — dafür fehlt
            <code className="text-text"> system.benutzer_lesen</code>. Ein „—" in der
            Spalte „Wer" heisst deshalb hier nicht, dass niemand gehandelt hat.
          </p>
        )}
      </section>

      <p className="mt-s6 max-w-prose text-xs text-text-muted">
        Der Werbewiderspruchs-Katalog der Gesellschaft steht unter{' '}
        <code className="text-text">/portal/{mandant}/datenschutz/widersprueche</code>{' '}
        und verlangt ebenfalls <code className="text-text">crm.rechtsgrundlage_lesen</code>.
        Er ist noch nicht gebaut; von hier führt deshalb kein Verweis dorthin, damit
        keiner auf ein 404 zeigt.
      </p>
    </PortalRahmen>
  );
}
