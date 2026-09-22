import type postgres from 'postgres';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { anbieter } from '@/server/auth/kennwort-anmeldung';
import {
  EINLADUNG_COOKIE, ZUGANG_UMFANG, leseZugaenge, type ZugangZeile,
} from '@/server/services/crm/kundenzugang';
import { AnmeldungNoetig } from '../../../../../Anmeldung';
import { portalZugang } from '../../../../../zugang';
import { slugTor } from '../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { Unternavigation } from '../Unternavigation';

/**
 * `/portal/[mandant]/crm/kunden/[id]/zugang` — den Portalzugang eines Kunden
 * ausstellen, neu einladen, entziehen (AUT-01, AUT-04, DOC-04, K-04).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Der Einladungslink steht GENAU EINMAL da und wird von Hand übergeben.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Es ist kein EU-Mailanbieter verbunden (O-501). Eine Einladung kann deshalb
 * nicht versendet werden — und diese Seite täuscht keinen Versand vor. Sie
 * nimmt denselben Weg wie der Mitarbeiter-Anmeldecode (D-487): der Klartext
 * kommt über einen kurzlebigen Keks, steht einmal auf dem Bildschirm,
 * gespeichert ist nur sein SHA-256. Nie in der Adresse — ein Token in der URL
 * steht in jedem Zugriffsprotokoll.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * **Keine Zeile verschwindet. Ein Entzug ist ein Datum.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wer wann Zugang zu welchen Vorgängen hatte, ist die Frage, die nach einem
 * Vorfall gestellt wird. Eine Tabelle, aus der ein Entzug die Zeile entfernt,
 * beantwortet sie nicht.
 *
 * **Der zweite Faktor ist hier Pflicht**, auch wenn das Manifest für diese
 * Route `aal2: false` führt: `benutzer_mandant` trägt die restriktive Policy
 * `p_bm_aal2`, und `app.kundenzugang_ausstellen` (0249) prüft `app.aal()`
 * selbst. Das steht vor dem Knopf und nicht in der Fehlermeldung danach.
 */
export const dynamic = 'force-dynamic';

const FELD = 'min-h-11 w-full rounded-md border border-line bg-surface px-s3 py-s2 '
  + 'text-sm text-text';

const BERLIN = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
});

interface Kopf {
  readonly id: string;
  readonly name: string;
  readonly kundennummer: string;
}

export default async function Kundenzugang(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<{ meldung?: string; erfolg?: string }>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const pfad = `/portal/${mandant}/crm/kunden/${id}/zugang`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const darf = await haeltRechte(sitzung,
    'crm.lesen', 'crm_entgelt.lesen', 'abrechnung.lesen', 'system.benutzer_verwalten');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select k.id, k.name, k.kundennummer
           from kunde k
          where k.mandant_id = app.aktiver_mandant() and k.id = $1::uuid
            and k.archiviert_am is null`, [id]);
      if (kopf === undefined) return null;
      /*
       * Die Ansprechpartner dieses Kunden als Vorschlag: ein Zugang gehört
       * einem Menschen, der schon erfasst ist — und eine frei getippte
       * Adresse ist die häufigste Quelle eines Kontos, das niemandem gehört.
       */
      const kontakte = await kontext.abfrage<{
        id: string; name: string; email: string | null;
      }>(
        `select ap.id,
                btrim(coalesce(ap.vorname, '') || ' ' || ap.nachname) as name,
                ap.email
           from ansprechpartner ap
          where ap.mandant_id = app.aktiver_mandant() and ap.kunde_id = $1::uuid
            and ap.archiviert_am is null and ap.email is not null
          order by ap.nachname`, [id]);
      return { kopf, zugaenge: await leseZugaenge(kontext, id), kontakte };
    })) as Promise<{
      kopf: Kopf; zugaenge: readonly ZugangZeile[];
      kontakte: readonly { id: string; name: string; email: string | null }[];
    } | null>);

  if (daten === null) notFound();
  const { kopf, zugaenge, kontakte } = daten;
  const offen = zugaenge.filter((z) => z.entzogen_am === null);
  const link = (await cookies()).get(EINLADUNG_COOKIE)?.value ?? null;
  const aal2 = sitzung.aal === 'aal2';
  const hausintern = anbieter() === 'demo';

  return (
    <PortalRahmen
      titel="Portalzugang"
      wurzelTitel="CRM"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="dashboard"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/crm/kunden`, text: 'Alle Kunden' }}
    >
      <h1 className="mb-s3 text-h1 text-text">{kopf.name}</h1>
      <Unternavigation mandant={mandant} kundeId={id} aktiv="zugang" rechte={darf} />

      {typeof suche.meldung === 'string' && suche.meldung !== '' ? (
        <Hinweis art="warnung" cse="zugang-meldung" className="mb-s5 max-w-prose">
          <strong>Nicht ausgestellt.</strong> {suche.meldung}
        </Hinweis>
      ) : null}
      {typeof suche.erfolg === 'string' && suche.erfolg !== '' ? (
        <Hinweis art="erfolg" cse="zugang-erfolg" className="mb-s5 max-w-prose">
          {suche.erfolg}
        </Hinweis>
      ) : null}

      {/* -------------------------------------------- Der Link, einmalig */}
      {link !== null ? (
        <Hinweis art="erfolg" cse="zugang-link" className="mb-s6 max-w-prose">
          <strong>Einladungslink — er steht hier genau einmal.</strong>
          <code data-cse="zugang-link-wert"
                className="mt-s3 block break-all rounded-md bg-surface-3 px-s3 py-s2 font-mono text-sm text-text">
            /auth/einladung/{link}
          </code>
          <span className="mt-s3 block text-xs">
            <strong>Übergeben Sie ihn von Hand</strong> — am Telefon, im Termin, über
            einen Weg, den Sie mit dem Kunden schon haben. Es ist kein Postausgang
            verbunden (O-501), und diese Plattform verschickt ihn deshalb nicht. Nach
            dem Verlassen dieser Seite ist er nicht wieder abrufbar; gespeichert ist nur
            sein Hash. Verloren? Dann „Neu einladen" — der alte verfällt dabei.
          </span>
        </Hinweis>
      ) : null}

      {/* -------------------------------------------- Die Zugänge */}
      <section aria-labelledby="bestand" className="mb-s7">
        <h2 id="bestand" className="text-h2 text-text">Zugänge dieses Kunden</h2>
        <p className="mt-s2 max-w-prose text-sm text-text-muted">
          {offen.length === 0
            ? 'Kein aktiver Zugang. Dieser Kunde sieht seine Vorgänge nicht im Portal.'
            : offen.length === 1
              ? 'Ein aktiver Zugang.'
              : `${String(offen.length)} aktive Zugänge.`}{' '}
          Entzogene Zeilen bleiben stehen: wer wann Zugang hatte, ist die Frage, die
          nach einem Vorfall gestellt wird.
        </p>

        {zugaenge.length === 0 ? (
          <p className="mt-s3 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Für diesen Kunden ist noch kein Zugang ausgestellt.
          </p>
        ) : (
          <div className="mt-s3">
            <DataTable
              beschriftung="Portalzugänge dieses Kunden, aktive zuerst"
              zeilen={zugaenge}
              schluessel={(z) => z.zugang_id}
              spalten={[
                {
                  schluessel: 'konto', kopf: 'Konto',
                  zelle: (z) => (
                    <span>
                      {z.name}
                      <span className="block text-xs text-text-muted">
                        {z.email ?? '—'}
                      </span>
                    </span>
                  ),
                },
                {
                  schluessel: 'zustand', kopf: 'Zustand',
                  zelle: (z) => (
                    <span className="inline-flex flex-wrap items-center gap-s2"
                          data-cse="zugang-zustand"
                          data-entzogen={String(z.entzogen_am !== null)}>
                      <StatusPill zustand={z.entzogen_am !== null
                        ? 'Archiviert'
                        : z.einladung_offen ? 'Wartet' : 'Aktiv'} />
                      <span className="text-xs text-text-muted">
                        {z.entzogen_am !== null
                          ? 'entzogen'
                          : z.einladung_offen
                            ? 'eingeladen, Kennwort noch nicht gesetzt'
                            : z.konto_status}
                      </span>
                    </span>
                  ),
                },
                {
                  schluessel: 'aktiviert', kopf: 'Aktiviert',
                  zelle: (z) => BERLIN.format(z.aktiviert_am),
                },
                {
                  schluessel: 'anmeldung', kopf: 'Letzte Anmeldung',
                  zelle: (z) => (z.letzte_anmeldung === null
                    ? <span className="text-text-subtle">noch keine</span>
                    : BERLIN.format(z.letzte_anmeldung)),
                },
                {
                  schluessel: 'entzogen', kopf: 'Entzogen',
                  zelle: (z) => (z.entzogen_am === null ? '—' : (
                    <span>
                      {BERLIN.format(z.entzogen_am)}
                      <span className="block text-xs text-text-muted">
                        {z.entzogen_von ?? 'von unbekannt'}
                      </span>
                    </span>
                  )),
                },
                {
                  schluessel: 'vorgang', kopf: 'Vorgang',
                  zelle: (z) => (z.entzogen_am !== null
                    ? <span className="text-text-subtle">—</span>
                    : (
                      <span className="flex flex-col gap-s2">
                        <form method="post" action="/api/crm/kunde/zugang"
                              data-cse="zugang-neu-formular">
                          <input type="hidden" name="was" value="neu_einladen" />
                          <input type="hidden" name="kundeId" value={id} />
                          <input type="hidden" name="zugangId" value={z.zugang_id} />
                          <input type="hidden" name="zurueck" value={pfad} />
                          <button
                            type="submit" disabled={!aal2 || !hausintern}
                            data-cse="zugang-neu-einladen"
                            className="min-h-11 rounded-md border border-line-strong px-s3 py-s2 text-xs text-text hover:bg-surface-2 disabled:opacity-50"
                          >
                            Neu einladen
                          </button>
                        </form>
                        <form method="post" action="/api/crm/kunde/zugang"
                              data-cse="zugang-entziehen-formular"
                              className="flex flex-wrap items-end gap-s2">
                          <input type="hidden" name="was" value="entziehen" />
                          <input type="hidden" name="kundeId" value={id} />
                          <input type="hidden" name="zugangId" value={z.zugang_id} />
                          <input type="hidden" name="zurueck" value={pfad} />
                          <input
                            name="grund" required placeholder="Grund"
                            data-cse="zugang-entziehen-grund"
                            className="min-h-11 w-40 rounded-md border border-line bg-surface px-s2 py-s1 text-xs text-text"
                          />
                          <button
                            type="submit" data-cse="zugang-entziehen"
                            className="min-h-11 rounded-md border border-danger px-s3 py-s2 text-xs text-danger hover:bg-danger-soft"
                          >
                            Entziehen
                          </button>
                        </form>
                      </span>
                    )),
                },
              ]}
            />
            <p className="mt-s3 max-w-prose text-xs text-text-muted">
              Ein Entzug beendet auch die LAUFENDEN Sitzungen dieses Kontos. Ohne das
              wirkte er erst, wenn die Sitzung von allein abläuft — und ein Entzug, der
              morgen wirkt, ist kein Entzug.
            </p>
          </div>
        )}
      </section>

      {/* -------------------------------------------- Ausstellen */}
      <section aria-labelledby="ausstellen" className="mb-s7 max-w-prose">
        <h2 id="ausstellen" className="text-h2 text-text">Zugang ausstellen</h2>

        {!hausintern ? (
          <Hinweis art="warnung" cse="zugang-anbieter" className="mt-s3">
            <strong>Supabase Auth ist als Anbieter aktiv — hier entsteht kein Konto.</strong>{' '}
            Ein Konto entsteht dort über die Admin-API, nicht in dieser Datenbank; ein
            hier angelegtes könnte sich nicht anmelden. Der Weg dafür ist nicht gebaut
            (O-501, O-662). Bestehende Zugänge lassen sich weiterhin entziehen.
          </Hinweis>
        ) : !aal2 ? (
          <Hinweis art="warnung" cse="zugang-kein-aal2" className="mt-s3">
            <strong>Dafür fehlt der zweite Faktor.</strong> Einen Portalzugang für einen
            Externen auszustellen heisst, ein Konto anzulegen und ihm eine
            Mitgliedschaft zu geben — <code className="text-text">benutzer_mandant</code>
            {' '}trägt dafür die Policy <code className="text-text">p_bm_aal2</code>, und
            die Definer-Funktion prüft es selbst. Melden Sie sich mit zweitem Faktor an;
            danach steht das Formular hier.
          </Hinweis>
        ) : (
          <form
            method="post" action="/api/crm/kunde/zugang" data-cse="zugang-formular"
            className="mt-s3 flex flex-col gap-s4 rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="was" value="ausstellen" />
            <input type="hidden" name="kundeId" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="flex flex-col gap-s2 text-sm text-text">
              E-Mail des Ansprechpartners
              <input type="email" name="email" required className={FELD}
                     list="kontakt-adressen" data-cse="zugang-email" />
              <datalist id="kontakt-adressen">
                {kontakte.map((k) => (
                  <option key={k.id} value={k.email ?? ''}>{k.name}</option>
                ))}
              </datalist>
              <span className="text-xs text-text-muted">
                {kontakte.length === 0
                  ? 'An diesem Kunden ist kein Ansprechpartner mit E-Mail-Adresse '
                    + 'erfasst. Tragen Sie ihn zuerst auf dem Kundenblatt ein — dann '
                    + 'gehört das Konto einem Menschen, den die Akte kennt.'
                  : 'Vorgeschlagen sind die Ansprechpartner dieses Kunden. Eine frei '
                    + 'getippte Adresse ist die häufigste Quelle eines Kontos, das '
                    + 'niemandem gehört.'}
              </span>
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              Name
              <input name="name" required className={FELD} data-cse="zugang-name" />
              <span className="text-xs text-text-muted">
                Er steht später in jeder Unterschrift und in jedem Protokolleintrag.
              </span>
            </label>

            <div className="rounded-md border border-line bg-surface-2 p-s4">
              <p className="m-0 text-sm font-semibold text-text">
                Was dieser Zugang öffnet
              </p>
              <ul className="m-0 mt-s2 list-disc space-y-s1 pl-s5 text-xs text-text-muted">
                {ZUGANG_UMFANG.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <p className="m-0 mt-s3 text-xs text-text-muted">
                Die Grenze ist keine Einstellung, sondern die K-04-Decke: zwei
                restriktive Policies auf jeder Tabelle und
                <code className="text-text"> app.aktuelle_kunden()</code> als Filter.
                Dasselbe Konto sieht nichts von anderen Kunden — auch nicht durch einen
                Tippfehler in einer Adresse.
              </p>
            </div>

            <button
              type="submit" data-cse="zugang-ausstellen"
              className="min-h-11 self-start rounded-md bg-brand px-s5 py-s3 text-sm font-semibold text-white hover:bg-brand-hover"
            >
              Zugang ausstellen
            </button>
            <p className="m-0 text-xs text-text-muted">
              Danach steht der Einladungslink oben — einmal. Der Kunde setzt darüber
              sein Kennwort unter <code className="text-text">/auth/einladung/…</code>;
              die Einladung gilt eine Woche.
            </p>
          </form>
        )}
      </section>

      <p className="max-w-prose text-xs text-text-muted">
        Ein internes Konto wird nie zum Kundenkonto: die Definer-Funktion weist eine
        Adresse ab, die schon zu einer internen Mitgliedschaft gehört. Hätte dasselbe
        Konto beides, entschiede die Reihenfolge der Mitgliedschaften, welche
        K-04-Decke gilt — und im schlechteren Fall sähe die Sachbearbeitung das Portal
        ihres Kunden.
      </p>
    </PortalRahmen>
  );
}
