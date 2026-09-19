import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Unternavigation } from './Unternavigation';

/**
 * `/portal/[mandant]/crm/kunden/[id]` — ein Kunde, seine Kontakte, seine
 * Objekte und Auftraege.
 *
 * **Das UWG-Tor steht hier als ANZEIGE, nicht als Wiederholung der Regel.**
 * Je Kontakt fragt die Seite `app.darf_kontaktiert_werden(kontakt, 'email',
 * 'werbung')` — dieselbe Funktion, die auch der Sendepfad fragt. Eine
 * Oberflaeche, die die Regel selbst noch einmal formuliert, waere eine
 * zweite Wahrheit; hier ist sie ein Fenster auf die eine.
 */
export const dynamic = 'force-dynamic';

const KONTAKT_FELD =
  'w-full rounded-md border border-line bg-surface px-s3 py-s2 text-sm text-text';

const GRUNDLAGE_TEXT: Readonly<Record<string, string>> = {
  einwilligung: 'Einwilligung',
  bestandskunde: 'Bestandskunde',
  anfrage: 'Anfrage',
  keine: 'keine',
};

interface Kopf {
  readonly id: string;
  readonly kundennummer: string;
  readonly name: string;
  readonly rechtsform: string | null;
  readonly typ: string;
  readonly status: string;
  readonly strasse: string | null;
  readonly hausnummer: string | null;
  readonly plz: string | null;
  readonly ort: string | null;
  readonly email_zentral: string | null;
  readonly telefon_zentral: string | null;
  readonly webseite: string | null;
  readonly rechtsgrundlage: string;
  readonly rechtsgrundlage_quelle: string | null;
  readonly widerspruch: boolean;
  readonly ist_oeffentlicher_auftraggeber: boolean;
}

interface KontaktZeile {
  readonly id: string;
  readonly name: string;
  readonly position: string | null;
  readonly email: string | null;
  readonly telefon: string | null;
  readonly darf_email: boolean;
}

interface ObjektZeile { readonly id: string; readonly bezeichnung: string;
  readonly ort: string; }
interface AuftragZeile { readonly id: string; readonly auftragsnummer: string;
  readonly bezeichnung: string; readonly status: string; readonly wert: string | null; }

const AUFTRAG_PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant', aktiv: 'In Arbeit', pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen', storniert: 'Abgelehnt',
};

export default async function KundeDetail(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/crm/kunden/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * Die Rechte der drei Unterseiten — VOR dem Rendern, damit die
   * Unternavigation keinen Reiter zeigt, hinter dem ein 404 steht (AUT-06).
   * Dieselbe eine Abfrage fuer alle drei Schluessel (`app/portal/rechte.ts`).
   */
  const unterrechte = await haeltRechte(sitzung,
    'crm_entgelt.lesen', 'abrechnung.lesen', 'system.benutzer_verwalten');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select k.id, k.kundennummer, k.name, k.rechtsform, k.typ::text as typ,
                k.status::text as status, k.strasse, k.hausnummer, k.plz, k.ort,
                k.email_zentral, k.telefon_zentral, k.webseite,
                k.rechtsgrundlage::text as rechtsgrundlage, k.rechtsgrundlage_quelle,
                (k.widerspruch_am is not null or k.werbewiderspruch_am is not null)
                  as widerspruch,
                k.ist_oeffentlicher_auftraggeber
           from kunde k where k.id = $1`, [id]);
      if (kopf === undefined) return null;

      /**
       * Das Tor wird JE KONTAKT gefragt — in derselben Abfrage, damit die
       * Liste nicht N Rundreisen kostet, und mit derselben Funktion, die
       * auch der Sendepfad fragt.
       */
      const kontakte = await kontext.abfrage<KontaktZeile>(
        `select ap.id,
                trim(coalesce(ap.vorname,'') || ' ' || ap.nachname) as name,
                ap.position, ap.email, ap.telefon,
                app.darf_kontaktiert_werden(ap.id, 'email', 'werbung') as darf_email
           from ansprechpartner ap
          where ap.kunde_id = $1 and ap.archiviert_am is null
          order by ap.nachname, ap.vorname`, [id]);

      /**
       * Zwei Rechte, die das Tor dieser Seite NICHT verlangt.
       *
       * Die Seite steht hinter `crm.lesen`, liest aber `objekt` und `auftrag`
       * — beide mit eigener Policy und eigenem Recht. Wem eines fehlt, dem
       * antwortet die Datenbank korrekt mit null Zeilen. Ohne diese Merker
       * haette die Seite daraus „kein Objekt zugeordnet“ und „noch kein
       * Auftrag“ gemacht: eine Aussage ueber den KUNDEN statt ueber die
       * Berechtigung — und der Vertrieb ruft mit ihr beim Kunden an.
       */
      const [rechte] = await kontext.abfrage<{
        objekt: boolean; auftrag: boolean; schreiben: boolean;
      }>(
        `select app.hat_recht('objekt.lesen', app.aktiver_mandant()) as objekt,
                app.hat_recht('auftrag.lesen', app.aktiver_mandant()) as auftrag,
                app.hat_recht('crm.schreiben', app.aktiver_mandant()) as schreiben`);

      const objekte = await kontext.abfrage<ObjektZeile>(
        `select id, bezeichnung, ort from objekt
          where kunde_id = $1 and archiviert_am is null order by bezeichnung`, [id]);

      const auftraege = await kontext.abfrage<AuftragZeile>(
        `select id, auftragsnummer, bezeichnung, status::text as status,
                auftragswert_netto_cent::text as wert
           from auftrag where kunde_id = $1 order by start_datum desc`, [id]);

      return { kopf, kontakte, objekte, auftraege, rechte };
    })) as Promise<{
      kopf: Kopf; kontakte: readonly KontaktZeile[];
      objekte: readonly ObjektZeile[]; auftraege: readonly AuftragZeile[];
      rechte: { objekt: boolean; auftrag: boolean; schreiben: boolean } | undefined;
    } | null>);

  if (daten === null) notFound();
  const { kopf, kontakte, objekte, auftraege } = daten;
  // Fehlt die Zeile, ist die engste Annahme die sichere: nichts behaupten.
  const darfObjekt = daten.rechte?.objekt === true;
  const darfAuftrag = daten.rechte?.auftrag === true;
  const darfSchreiben = daten.rechte?.schreiben === true;

  return (
    <PortalRahmen
      titel={kopf.name}
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
          href={`/portal/${mandant}/crm/kunden`}
          className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
        >
          ← Alle Kunden
        </Link>
      </nav>

      <Unternavigation
        mandant={mandant}
        kundeId={id}
        aktiv="uebersicht"
        rechte={unterrechte}
      />

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.name}</h1>
        {kopf.ist_oeffentlicher_auftraggeber ? (
          <span className="text-xs text-text-muted">öffentlicher Auftraggeber</span>
        ) : null}
      </div>

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Nummer</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.kundennummer}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Anschrift</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.strasse === null ? '—' : (
              <>
                {`${kopf.strasse}${kopf.hausnummer === null ? '' : ` ${kopf.hausnummer}`}`}
                <br />
                {`${kopf.plz ?? ''} ${kopf.ort ?? ''}`}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kontakt</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.email_zentral ?? '—'}
            <br />
            {kopf.telefon_zentral ?? ''}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Rechtsgrundlage
          </dt>
          <dd data-cse="rechtsgrundlage" className="m-0 mt-s1 text-sm text-text">
            {kopf.widerspruch
              ? 'Widerspruch — keine Werbung'
              : GRUNDLAGE_TEXT[kopf.rechtsgrundlage] ?? kopf.rechtsgrundlage}
            {kopf.rechtsgrundlage_quelle === null ? null : (
              <span className="block text-xs text-text-muted">
                {kopf.rechtsgrundlage_quelle}
              </span>
            )}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="kontakte" className="mb-s7">
        <h2 id="kontakte" className="text-h2 text-text">Ansprechpartner</h2>
        <p className="text-sm text-text-muted">
          Die Spalte „Werbung per E-Mail" ist die Antwort des Tores selbst
          (CRM-08) — dieselbe Funktion, die auch der Sendepfad fragt.
        </p>
        {kontakte.length === 0 ? (
          <p className="text-sm text-text-muted">Kein Ansprechpartner hinterlegt.</p>
        ) : (
          <DataTable
            beschriftung="Ansprechpartner dieses Kunden und ihr Werbestatus"
            zeilen={kontakte}
            schluessel={(z) => z.id}
            spalten={[
              {
                schluessel: 'name',
                kopf: 'Name',
                /* Der Verweis auf das Kontaktblatt: dort steht der
                   Rechtsgrundlagen-Nachweis, der hier absichtlich fehlt. */
                zelle: (z) => (
                  <Link
                    href={`/portal/${mandant}/crm/kontakte/${z.id}`}
                    className="text-text underline-offset-2 hover:text-brand hover:underline"
                  >
                    {z.name}
                  </Link>
                ),
              },
              { schluessel: 'position', kopf: 'Position', zelle: (z) => z.position ?? '—' },
              { schluessel: 'email', kopf: 'E-Mail', zelle: (z) => z.email ?? '—' },
              { schluessel: 'telefon', kopf: 'Telefon', zelle: (z) => z.telefon ?? '—' },
              {
                schluessel: 'werbung',
                kopf: 'Werbung per E-Mail',
                zelle: (z) => (
                  <span data-cse="werbetor" data-erlaubt={String(z.darf_email)}>
                    <StatusPill zustand={z.darf_email ? 'Bereit' : 'Abgelehnt'} />
                  </span>
                ),
              },
            ]}
          />
        )}

        {/*
          * **Das Formular steht HIER und nicht auf einer eigenen Adresse.**
          * Ein Ansprechpartner gehoert zu einem Kunden; ihn auf einer leeren
          * Seite anzulegen hiesse, den Kunden noch einmal auszuwaehlen — aus
          * einer Liste, in der man gerade stand.
          */}
        {darfSchreiben && (
          <details className="mt-s5" data-cse="kontakt-anlegen">
            <summary className="cursor-pointer text-sm text-brand">
              Ansprechpartner hinzufügen
            </summary>
            <form method="post" action="/api/crm/kunde" data-cse="kontakt-formular"
                  className="mt-s4 flex max-w-[48ch] flex-col gap-s3">
              <input type="hidden" name="kundeId" value={id} />
              <input type="hidden" name="zurueck"
                     value={`/portal/${mandant}/crm/kunden/${id}`} />

              <div className="flex gap-s3">
                <label className="flex w-28 flex-col gap-s2 text-sm text-text">
                  Anrede
                  <input name="anrede" className={KONTAKT_FELD} />
                </label>
                <label className="flex flex-1 flex-col gap-s2 text-sm text-text">
                  Vorname
                  <input name="vorname" className={KONTAKT_FELD} autoComplete="given-name" />
                </label>
              </div>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Nachname
                <input name="nachname" required className={KONTAKT_FELD}
                       autoComplete="family-name" data-cse="kontakt-nachname" />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Position
                <input name="position" className={KONTAKT_FELD} />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                E-Mail
                <input name="email" type="email" className={KONTAKT_FELD} />
              </label>
              <label className="flex flex-col gap-s2 text-sm text-text">
                Telefon
                <input name="telefon" className={KONTAKT_FELD} autoComplete="tel" />
              </label>

              <fieldset className="m-0 mt-s3 flex flex-col gap-s2 border-0 p-0">
                <legend className="mb-s2 p-0 text-sm font-semibold text-text">
                  Dürfen wir ihn bewerben?
                </legend>
                <p className="m-0 mb-s2 text-xs text-text-muted">
                  Aus diesem Feld zieht das Tor oben seine Antwort. Ohne Grundlage
                  steht der Kontakt in der Liste und bekommt keine Werbung —
                  Rechnungen und Terminbestätigungen schon.
                </p>
                {([
                  ['keine', 'Keine (Vorgabe)'],
                  ['bestandskunde', 'Bestandskunde'],
                  ['anfrage', 'Er hat angefragt'],
                  ['einwilligung', 'Ausdrückliche Einwilligung'],
                ] as const).map(([w, t], i) => (
                  <label key={w} className="flex items-center gap-s2 text-sm text-text">
                    <input type="radio" name="rechtsgrundlage" value={w} required
                           defaultChecked={i === 0} data-cse="kontakt-grundlage" />
                    {t}
                  </label>
                ))}
                <label className="mt-s2 flex flex-col gap-s2 text-sm text-text">
                  Woher stammt sie?
                  <input name="grundlageQuelle" className={KONTAKT_FELD} />
                </label>
                <p className="m-0 mt-s2 text-xs text-text-muted">
                  Bei einer Einwilligung: wofür genau? Was hier nicht steht, ist
                  gesperrt.
                </p>
                <div className="flex flex-wrap gap-s3">
                  {(['email', 'telefon', 'sms', 'post', 'whatsapp'] as const).map((k) => (
                    <label key={k} className="flex items-center gap-s2 text-sm text-text">
                      <input type="checkbox" name="kanal" value={k} data-cse="kontakt-kanal" />
                      {k}
                    </label>
                  ))}
                </div>
              </fieldset>

              <button type="submit" data-cse="kontakt-speichern"
                      className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover">
                Ansprechpartner anlegen
              </button>
            </form>
          </details>
        )}
      </section>

      <section aria-labelledby="objekte" className="mb-s7">
        <h2 id="objekte" className="text-h2 text-text">Objekte</h2>
        {!darfObjekt ? (
          <p data-cse="objekte-verdeckt" className="text-sm text-text-muted">
            Die Objekte dieses Kunden sind Ihnen nicht sichtbar — dafür fehlt
            <code className="text-text"> objekt.lesen</code>. Das heißt nicht,
            dass es keine gibt.
          </p>
        ) : objekte.length === 0 ? (
          <p className="text-sm text-text-muted">Kein Objekt zugeordnet.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {objekte.map((o) => (
              <li key={o.id} className="border-b border-line py-s3">
                <Link
                  href={`/portal/${mandant}/objekte/${o.id}`}
                  className="text-sm text-text underline-offset-2 hover:text-brand hover:underline"
                >
                  {o.bezeichnung}
                </Link>
                <span className="ml-s3 text-xs text-text-muted">{o.ort}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="auftraege">
        <h2 id="auftraege" className="text-h2 text-text">Aufträge</h2>
        {!darfAuftrag ? (
          <p data-cse="auftraege-verdeckt" className="text-sm text-text-muted">
            Die Aufträge dieses Kunden sind Ihnen nicht sichtbar — dafür fehlt
            <code className="text-text"> auftrag.lesen</code>. Das heißt nicht,
            dass es keine gibt.
          </p>
        ) : auftraege.length === 0 ? (
          <p className="text-sm text-text-muted">Noch kein Auftrag.</p>
        ) : (
          <DataTable
            beschriftung="Aufträge dieses Kunden"
            zeilen={auftraege}
            schluessel={(z) => z.id}
            spalten={[
              { schluessel: 'nummer', kopf: 'Nummer', zelle: (z) => z.auftragsnummer },
              { schluessel: 'bezeichnung', kopf: 'Auftrag', zelle: (z) => z.bezeichnung },
              {
                schluessel: 'wert', kopf: 'Wert netto', numerisch: true,
                zelle: (z) => (z.wert === null
                  ? <span className="text-text-subtle">offen</span>
                  : formatiereGeld(cent(BigInt(z.wert)))),
              },
              {
                schluessel: 'status', kopf: 'Status',
                zelle: (z) => <StatusPill zustand={AUFTRAG_PILLE[z.status] ?? 'Geplant'} />,
              },
            ]}
          />
        )}
      </section>
    </PortalRahmen>
  );
}
