import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { alsProzent, FEHLERTEXT, type Kopf, type SteuerZeile } from './daten';

/**
 * `/portal/[mandant]/angebote/[id]/freigabe` — die Preisfreigabe (OPS-08).
 *
 * **Warum diese Seite ueberhaupt existiert.** Bis zu dieser Runde setzte
 * `versendeAngebot` `freigegeben_von` und `versendet_von` in EINEM update:
 * ein Klick, zwei Entscheidungen. Der Rechtekatalog fuehrt sie getrennt —
 * `angebot.preis_freigeben` haben super_admin und leitung (bindbar an admin),
 * `angebot.versenden` zusaetzlich admin. Eine Administration hat damit den
 * Preis verantwortet, ohne das Recht dafuer zu halten, und zwar auf dem
 * vorgesehenen Weg. Diese Seite ist die eine Haelfte dieser Trennung; der
 * Versand ist die andere.
 *
 * **Sie zeigt den Preis, auf dem die Freigabe ruht, VOR dem Knopf.** Wer
 * freigibt, ohne die Steuersatzgruppen und die Kalkulationskoepfe gesehen zu
 * haben, gibt eine Ueberschrift frei. Steht auch nur ein Wert offen, ist der
 * Knopf gesperrt — mit dem Satz, WARUM, nicht nur ausgegraut.
 *
 * Gerechnet wird hier nichts: jede Zahl kommt aus `angebot`, `angebot_steuer`
 * und `kalkulation`, wo sie von `services/kalkulation` entstanden ist
 * (Invariante 6). Die Seite addiert nicht einmal die Steuer — dafuer gibt es
 * `angebot_steuer`, und die entsteht erst beim Versand.
 */
export const dynamic = 'force-dynamic';

export default async function Preisfreigabe(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/angebote/${id}/freigabe`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /**
   * Drei Rechte, die das Tor dieser Seite NICHT verlangt.
   *
   * Die Seite oeffnet mit `angebot.preis_freigeben` (Manifest). Der Verweis
   * auf das Angebot braucht `angebot.lesen`, der auf den Rechenweg
   * `kalkulation.lesen`, der Versandknopf `angebot.versenden`. Ohne diese
   * Pruefung fuehrte jeder dieser Verweise fuer manche Rollen auf ein 404 —
   * und verriete damit, was er nicht zeigen darf (AUT-06, D-581).
   */
  const darf = await haeltRechte(
    sitzung, 'angebot.lesen', 'kalkulation.lesen', 'angebot.versenden');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select a.id, a.titel, a.status::text as status, a.netto_cent::text,
                a.angebotsnummer, ku.name as kunde,
                to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
                to_char(a.freigegeben_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as freigegeben_am,
                fb.name as freigegeben_von,
                to_char(a.versendet_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as versendet_am,
                (select count(*) from angebotsposition p
                  where p.angebot_id = a.id and p.typ = 'leistung')::text as positionen,
                k.id as kalkulation_id,
                k.stundenverrechnungssatz_cent::text as satz_cent,
                k.gemeinkosten_basis::text as gemeinkosten_basis,
                k.gemeinkosten_bp, k.wagnis_gewinn_bp, k.bemerkung,
                /*
                 * Die drei offenen Werte je EINZELN, nicht als ein Merker.
                 *
                 * Die Sicht kalkulation_platzhalter fuehrt kopf_offen,
                 * frequenz_offen und grundlage_offen getrennt, und genau so
                 * gehoeren sie auf den Bildschirm: "irgendetwas ist offen"
                 * schickt niemanden an die richtige Stelle.
                 */
                coalesce(kp.kopf_offen, false) as kopf_offen,
                coalesce(kp.frequenz_offen, false) as frequenz_offen,
                coalesce(kp.grundlage_offen, false) as grundlage_offen,
                (kp.kalkulation_id is not null) as irgendwas_offen,
                (select app.hat_recht('kalkulation.lesen', app.aktiver_mandant()))
                  as darf_kalkulation_lesen
           from angebot a
           join kunde ku on ku.id = a.kunde_id
           left join benutzer fb on fb.id = a.freigegeben_von
           left join kalkulation k on k.angebot_id = a.id
           left join kalkulation_platzhalter kp on kp.angebot_id = a.id
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      const steuer = await kontext.abfrage<SteuerZeile>(
        `select steuersatz_bp, steuer_kennzeichen::text as steuer_kennzeichen,
                sum(gesamtpreis_cent)::text as netto_cent,
                count(*)::text as zeilen
           from angebotsposition
          where angebot_id = $1 and typ = 'leistung'
          group by steuersatz_bp, steuer_kennzeichen
          order by steuersatz_bp`, [id]);
      return { kopf, steuer };
    })) as Promise<{ kopf: Kopf; steuer: readonly SteuerZeile[] } | null>);

  if (daten === null) notFound();
  const { kopf, steuer } = daten;

  const schonFrei = kopf.freigegeben_am !== null;
  const versendet = kopf.versendet_am !== null;
  const ohnePositionen = Number(kopf.positionen) === 0;
  /**
   * **Fehlende Sicht ist keine Bestaetigung.**
   *
   * Wem `kalkulation.lesen` fehlt, dem antwortet die Datenbank auf
   * `kalkulation_platzhalter` korrekt mit NICHTS — und `irgendwas_offen`
   * waere `false`. Daraus „alles bestaetigt" zu machen, waere eine Aussage
   * ueber die Daten statt ueber die Berechtigung, und sie gaebe genau den
   * Knopf frei, den die Sperre verhindern soll (AUT-05).
   */
  const sichtFehlt = !kopf.darf_kalkulation_lesen;
  const offen = kopf.irgendwas_offen || sichtFehlt;
  const freigabeMoeglich = !schonFrei && !versendet && !ohnePositionen && !offen
    && (kopf.status === 'entwurf' || kopf.status === 'in_pruefung');

  return (
    <PortalRahmen
      titel={`Preisfreigabe — ${kopf.titel}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={versendet}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="angebote"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      {...(darf['angebot.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/angebote/${id}`, text: 'Zum Angebot' } }
        : {})}
    >
      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">Preisfreigabe</h1>
        <StatusPill zustand={schonFrei ? 'Bereit' : offen ? 'Wartet' : 'In Prüfung'} />
      </div>

      <p className="mb-s5 max-w-[72ch] text-base text-text-muted">
        Die Freigabe verantwortet den <strong>Preis</strong> — nicht den Versand.
        Das sind zwei Entscheidungen mit zwei Rechten: wer freigibt, hält{' '}
        <code className="text-text">angebot.preis_freigeben</code>, wer versendet,{' '}
        <code className="text-text">angebot.versenden</code>. Erst beides, dann
        geht das Angebot hinaus.
      </p>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="freigabe-fehler" className="mb-s5">
          <strong>Die Freigabe ist nicht erfolgt.</strong>{' '}
          {FEHLERTEXT[fehler] ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.kunde}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Nummer</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.angebotsnummer ?? (
              <span className="text-text-subtle">entsteht beim Versand</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Gültig bis
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.gueltig_bis ?? <span className="text-text-subtle">—</span>}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Freigegeben
          </dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.freigegeben_am === null
              ? <span className="text-text-subtle">noch nicht</span>
              : `${kopf.freigegeben_am}${kopf.freigegeben_von === null
                  ? '' : ` von ${kopf.freigegeben_von}`}`}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="preis" className="mb-s6">
        <h2 id="preis" className="text-h2 text-text">Der Preis, je Steuersatzgruppe</h2>
        <p className="mb-s4 text-sm text-text-muted">
          Gruppiert nach Steuersatz und Kennzeichen — nie aus einer Bruttosumme
          zurückgerechnet (Invariante 1). Die Umsatzsteuerzeilen selbst
          entstehen beim Versand.
        </p>
        <DataTable
          beschriftung="Nettosumme je Steuersatzgruppe dieses Angebots"
          zeilen={steuer}
          schluessel={(z) => `${String(z.steuersatz_bp)}-${z.steuer_kennzeichen}`}
          spalten={[
            {
              schluessel: 'satz', kopf: 'Steuersatz', numerisch: true,
              zelle: (z) => `${(z.steuersatz_bp / 100).toLocaleString('de-DE')} %`,
            },
            {
              schluessel: 'kz', kopf: 'Kennzeichen',
              zelle: (z) => z.steuer_kennzeichen,
            },
            {
              schluessel: 'zeilen', kopf: 'Positionen', numerisch: true,
              zelle: (z) => z.zeilen,
            },
            {
              schluessel: 'netto', kopf: 'Netto', numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.netto_cent))),
            },
          ]}
        />
        <dl
          data-cse="freigabe-summe"
          className="m-0 mt-s4 grid grid-cols-1 gap-s3 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
        >
          <dt className="text-h3 text-text">Netto insgesamt</dt>
          <dd data-cse="netto" className="m-0 cse-zahl text-h3 text-text">
            {formatiereGeld(cent(BigInt(kopf.netto_cent)))}
          </dd>
        </dl>
      </section>

      <section aria-labelledby="koepfe" className="mb-s6">
        <h2 id="koepfe" className="text-h2 text-text">Worauf der Preis ruht</h2>
        {sichtFehlt ? (
          <Hinweis art="warnung" cse="kalkulation-verdeckt">
            <strong>Der Kalkulationsstand ist Ihnen nicht sichtbar.</strong> Ihnen
            fehlt <code className="text-text">kalkulation.lesen</code>; die
            Datenbank antwortet deshalb mit nichts, und das heißt hier
            ausdrücklich <em>nicht</em> „alles bestätigt". Die Freigabe bleibt
            gesperrt, weil sich ihre Voraussetzung von hier aus nicht prüfen lässt.
          </Hinweis>
        ) : kopf.kalkulation_id === null ? (
          <Hinweis art="hinweis" cse="ohne-kalkulation">
            Zu diesem Angebot gibt es keine Kalkulation — sein Preis steht in den
            Positionen und nicht in einem Rechenweg. Freigeben lässt er sich
            trotzdem; was Sie verantworten, sind die Beträge oben.
          </Hinweis>
        ) : (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-s5 gap-y-s3 rounded-lg border border-line bg-surface p-s5">
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Stundenverrechnungssatz
            </dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {kopf.satz_cent === null
                ? '—' : formatiereGeld(cent(BigInt(kopf.satz_cent)))}
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Gemeinkosten
            </dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {alsProzent(kopf.gemeinkosten_bp)} % auf{' '}
              {kopf.gemeinkosten_basis ?? '—'}
            </dd>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
              Wagnis und Gewinn
            </dt>
            <dd className="m-0 cse-zahl text-sm text-text">
              {alsProzent(kopf.wagnis_gewinn_bp)} %
            </dd>
          </dl>
        )}
      </section>

      {offen && !sichtFehlt ? (
        <Hinweis art="warnung" cse="freigabe-gesperrt" className="mb-s5">
          <strong>Unbestätigter Wert — die Freigabe ist gesperrt.</strong>
          <ul className="mt-s3 mb-0 list-disc pl-s5">
            {kopf.kopf_offen && (
              <li>
                Stundenverrechnungssatz, Gemeinkostenbasis und Zuschläge sind
                nicht bestätigt (O-16).
              </li>
            )}
            {kopf.frequenz_offen && (
              <li>Der Frequenzfaktor ist geschätzt, nicht genannt (O-56).</li>
            )}
            {kopf.grundlage_offen && (
              <li>
                Mindestens ein Reinigungsrichtwert je Belagsart ist ein
                Platzhalter (O-17).
              </li>
            )}
          </ul>
          <p className="mt-s3 mb-0">
            Ein Preis auf offenen Fragen sieht geprüft aus und ist es nicht.
            {kopf.kalkulation_id !== null && darf['kalkulation.lesen'] === true ? (
              <>
                {' '}
                <Link
                  href={`/portal/${mandant}/angebote/${id}/kalkulation`}
                  data-cse="zur-kalkulation"
                  className="text-text underline underline-offset-2 hover:text-brand"
                >
                  Werte bestätigen und den Rechenweg ansehen →
                </Link>
              </>
            ) : null}
          </p>
        </Hinweis>
      ) : null}

      {ohnePositionen ? (
        <Hinweis art="warnung" cse="ohne-positionen" className="mb-s5">
          Dieses Angebot trägt keine Leistungsposition. Ein Preis über nichts
          ist keiner — es gibt hier nichts freizugeben.
        </Hinweis>
      ) : null}

      {schonFrei ? (
        <Hinweis art="erfolg" cse="schon-freigegeben" className="mb-s5">
          <strong>Der Preis ist freigegeben.</strong> Eine erteilte Freigabe ist
          unveränderlich; ob ein Widerruf vorgesehen ist, ist eine offene Frage
          — sichtbar als <strong>offen (O-732)</strong>. Ein anderer Preis
          braucht eine neue Angebotsversion.
          {!versendet && darf['angebot.versenden'] === true ? (
            <p className="mt-s3 mb-0">
              <Link
                href={`/portal/${mandant}/angebote/${id}/versand`}
                data-cse="zum-versand"
                className="text-text underline underline-offset-2 hover:text-brand"
              >
                Weiter zum Versand →
              </Link>
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      {freigabeMoeglich ? (
        <form
          method="post"
          action="/api/angebot/freigabe"
          data-cse="freigabe-form"
          className="max-w-[52ch]"
        >
          <input type="hidden" name="angebotId" value={id} />
          {/*
            * `zurueck` — damit ein abgewiesener Vorgang auf DIESE Seite
            * zurueckkommt und nicht auf eine weisse Seite mit JSON. Das
            * Geruest prueft das Ziel gegen diese Anwendung (D-562).
            */}
          <input type="hidden" name="zurueck" value={pfad} />
          <button
            type="submit"
            data-cse="preis-freigeben"
            className="inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
          >
            Preis freigeben
          </button>
          <p className="mt-s3 text-xs text-text-muted">
            Festgehalten werden Ihr Name und die <strong>Serverzeit</strong> —
            nicht die Ihres Geräts (Invariante 5).
          </p>
        </form>
      ) : schonFrei || versendet ? null : (
        <p data-cse="freigabe-unmoeglich" className="text-sm text-text-muted">
          Solange das oben Genannte offensteht, gibt es hier keinen Knopf. Ein
          gesperrter Knopf ohne Erklärung wäre eine Sackgasse mit Tooltip.
        </p>
      )}
    </PortalRahmen>
  );
}
