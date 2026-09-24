import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { berlinKalendertag } from '@/server/services/zeit/dauer';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '../../../../unterseite';
import { haeltRechte } from '@/app/portal/rechte';
import { kennungOder404 } from '../../../../kennung';
import { FELD, FEHLERTEXT, type AnnahmeKopf, type Auswahl } from './daten';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { AUFTRAG_TEXTE } from '@/lib/i18n/verwaltung/auftrag';

/**
 * `/portal/[mandant]/angebote/[id]/annahme` — was der Kunde entschieden hat
 * (OPS-09, CRM-05).
 *
 * **Warum diese Mitarbeiterseite der vorgesehene Weg ist.** O-74
 * (`auth-kunde-schreibrechte`) ist offen: ob ein Kunde im Portal ueberhaupt
 * schreiben darf — ein Angebot rechtswirksam annehmen —, ist unbeantwortet,
 * und jeder kundenseitige Schreibweg bleibt bis dahin zurueckgehalten.
 * Solange das gilt, erfasst DIESE Seite die schriftliche Zusage. Das ist
 * keine Zwischenloesung, sondern die Seitenkarte.
 *
 * **Sie erfasst den BELEG, dann wandelt sie.** Oben steht, was der Kunde
 * gesagt hat: wer es erklaert hat und mit welchem Wortlaut
 * (`entscheidung_notiz` — eine Spalte, die es von Anfang an gab und die keine
 * Funktion beschrieb). Darunter die Auftragsfelder, die `wandleInAuftrag`
 * bisher GERATEN bekam: die Detailseite setzt hart `rahmenvertrag`.
 *
 * **Kein Betrag wird hier eingegeben.** Der Auftragswert kommt aus
 * `angebot.netto_cent` und wird nicht neu gerechnet — ein zweites Mal
 * gerechnet waere er eine zweite Wahrheit ueber denselben Betrag, und die
 * Abweichung faende niemand, weil beide plausibel aussehen.
 *
 * **Und der Gegenfall hat seinen eigenen Block.** Ein abgelehntes Angebot
 * blieb bisher auf `versendet` stehen — mitten in der Liste der offenen
 * Vorgaenge, mit Wiedervorlage, bis es ablief. Der Vertrieb sah einen offenen
 * Vorgang, und der Kunde hatte abgesagt.
 */
export const dynamic = 'force-dynamic';

export default async function Annahme(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const suche = await searchParams;
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;

  const pfad = `/portal/${mandant}/angebote/${id}/annahme`;
  const tor = await mandantTor(pfad, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;
  /**
   * `angebot.lesen` fuer den Rueckverweis auf das Angebot, `auftrag.lesen` fuer
   * den auf den entstandenen Auftrag — und BEIDE werden auch benutzt.
   *
   * `auftrag.lesen` wurde hier geholt und danach ein zweites Mal im SQL
   * gefragt (`select app.hat_recht('auftrag.lesen', …) as darf_auftrag_lesen`).
   * Zwei Quellen fuer dieselbe Frage sind eine zu viel: die eine kann
   * verschwinden, waehrend die andere stehen bleibt, und dann sieht es
   * geprueft aus. Gefragt wird jetzt nur noch hier.
   */
  const darf = await haeltRechte(sitzung, 'angebot.lesen', 'auftrag.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<AnnahmeKopf>(
        `select a.id, a.titel, a.status::text as status, a.netto_cent::text,
                a.angebotsnummer, a.kunde_id, ku.name as kunde,
                a.entscheidung_notiz,
                to_char(a.gueltig_bis, 'DD.MM.YYYY') as gueltig_bis,
                to_char(a.versendet_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as versendet_am,
                to_char(a.entschieden_am at time zone 'Europe/Berlin',
                        'DD.MM.YYYY HH24:MI') as entschieden_am,
                t.id as auftrag_id, t.auftragsnummer,
                exists (select 1 from nummernkreis n
                         where n.mandant_id = a.mandant_id
                           and n.kreis_typ = 'auftrag') as hat_nummernkreis
           from angebot a
           join kunde ku on ku.id = a.kunde_id
           left join auftrag t on t.angebot_id = a.id
          where a.id = $1`, [id]);
      if (kopf === undefined) return null;
      /**
       * Die Verantwortlichen aus DIESER Gesellschaft.
       *
       * `kern.auftrag_verantwortlich_im_mandant` weist eine Person ab, die
       * hier nicht arbeitet. Eine Auswahlliste ueber alle Benutzer boete
       * damit an, was die Datenbank hinterher zurueckweist — ein Formular,
       * das zum Fehler einlaedt.
       */
      const leitungen = await kontext.abfrage<Auswahl>(
        `select b.id, b.name from benutzer b
           join benutzer_mandant bm on bm.benutzer_id = b.id
          where bm.mandant_id = app.aktiver_mandant()
            and bm.entzogen_am is null and b.status = 'aktiv'
          order by b.name`);
      return { kopf, leitungen };
    })) as Promise<{ kopf: AnnahmeKopf; leitungen: readonly Auswahl[] } | null>);

  if (daten === null) notFound();
  const { kopf, leitungen } = daten;

  const gewandelt = kopf.auftrag_id !== null;
  const entschieden = kopf.status === 'abgelehnt' || kopf.status === 'zurueckgezogen'
    || kopf.status === 'angenommen';
  const annahmeMoeglich = kopf.status === 'versendet' && !gewandelt
    && kopf.hat_nummernkreis;

  return (
    <PortalRahmen
      titel={`Annahme — ${kopf.titel}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={entschieden}
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
        <h1 className="m-0 text-h1 text-text">Die Entscheidung des Kunden</h1>
        <StatusPill
          zustand={kopf.status === 'angenommen' ? 'Aktiv'
            : kopf.status === 'abgelehnt' ? 'Abgelehnt'
            : kopf.status === 'zurueckgezogen' ? 'Archiviert' : 'Angebot'}
        />
      </div>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="annahme-fehler" className="mb-s5">
          <strong>Nichts wurde erfasst.</strong>{' '}
          {FEHLERTEXT[fehler]
            ?? nachSprache(AUFTRAG_TEXTE, zugang.sprache).fehler[fehler]
            ?? 'Der Vorgang wurde abgewiesen.'}
        </Hinweis>
      )}

      <dl className="m-0 mb-s6 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Angebot</dt>
          <dd className="m-0 mt-s1 text-sm text-text">
            {kopf.angebotsnummer ?? <span className="text-text-subtle">ohne Nummer</span>}
          </dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">Kunde</dt>
          <dd className="m-0 mt-s1 text-sm text-text">{kopf.kunde}</dd>
        </div>
        <div>
          <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">
            Auftragswert (netto)
          </dt>
          <dd data-cse="netto" className="m-0 mt-s1 cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(kopf.netto_cent)))}
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
      </dl>

      <p className="mb-s5 max-w-[72ch] text-sm text-text-muted">
        Der Auftragswert kommt aus dem Angebot und wird <strong>nicht neu
        gerechnet</strong>. Hier gibt es deshalb kein Betragsfeld: eine zweite
        Rechnung wäre eine zweite Wahrheit über denselben Betrag.
      </p>

      {gewandelt ? (
        <Hinweis art="erfolg" cse="schon-gewandelt" className="mb-s5">
          <strong>Aus diesem Angebot ist bereits ein Auftrag entstanden</strong>
          {kopf.auftragsnummer === null ? '.' : ` — ${kopf.auftragsnummer}.`} Ein
          zweiter entsteht nicht: <code className="text-text">auftrag_angebot_uk</code>{' '}
          lässt genau einen zu.
          {darf['auftrag.lesen'] === true && kopf.auftrag_id !== null ? (
            <p className="mt-s3 mb-0">
              <Link
                href={`/portal/${mandant}/auftraege/${kopf.auftrag_id}`}
                data-cse="zum-auftrag"
                className="text-text underline underline-offset-2 hover:text-brand"
              >
                Zum Auftrag →
              </Link>
            </p>
          ) : null}
        </Hinweis>
      ) : null}

      {kopf.status === 'abgelehnt' || kopf.status === 'zurueckgezogen' ? (
        <Hinweis art="hinweis" cse="schon-entschieden" className="mb-s5">
          <strong>
            {kopf.status === 'abgelehnt'
              ? 'Der Kunde hat abgelehnt'
              : 'Wir haben das Angebot zurückgezogen'}
          </strong>
          {kopf.entschieden_am === null ? '' : ` — ${kopf.entschieden_am}`}.
          {kopf.entscheidung_notiz === null ? null : (
            <p className="mt-s3 mb-0 whitespace-pre-line text-text-muted">
              {kopf.entscheidung_notiz}
            </p>
          )}
        </Hinweis>
      ) : null}

      {kopf.status === 'entwurf' || kopf.status === 'in_pruefung' ? (
        <Hinweis art="warnung" cse="nicht-versendet" className="mb-s5">
          <strong>Dieses Angebot war noch nicht beim Kunden.</strong> Was er nie
          gesehen hat, kann er nicht annehmen und nicht ablehnen. Erst
          versenden — ein Angebot, das ohne Versand als angenommen gebucht wird,
          trägt eine Zusage, die es nie gegeben hat.
        </Hinweis>
      ) : null}

      {kopf.hat_nummernkreis || gewandelt ? null : (
        <Hinweis art="warnung" cse="ohne-nummernkreis" className="mb-s5">
          <strong>Kein Auftragskreis in dieser Gesellschaft.</strong> Ein Auftrag
          trägt eine Nummer aus dem Nummernkreis (FIN-03); ohne Kreis gibt es
          nichts zu ziehen, und die Wandlung würde abgewiesen. Erst einen
          Auftragskreis unter <em>Finanzen › Nummernkreise</em> eröffnen. Die
          Ablehnung unten funktioniert davon unabhängig.
        </Hinweis>
      )}

      {annahmeMoeglich ? (
        <section aria-labelledby="zusage" className="mb-s7">
          <h2 id="zusage" className="text-h2 text-text">Der Kunde hat zugesagt</h2>
          <form
            method="post"
            action="/api/angebot/entscheidung"
            data-cse="annahme-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="angebotId" value={id} />
            <input type="hidden" name="ausgang" value="angenommen" />
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="block text-sm text-text" htmlFor="notiz">
              Was zugesagt wurde, und wie
            </label>
            <textarea
              id="notiz"
              name="notiz"
              rows={3}
              required
              placeholder="z. B. Auftragsbestätigung per Mail vom 14.03., Herr Meyer"
              className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />
            <p className="mt-s1 text-xs text-text-muted">
              Der Beleg der Zusage. Ein <code>angenommen</code> ohne Anlass ist im
              Streit um den Vertragsschluss nichts.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="art">
              Auftragsart
            </label>
            <select id="art" name="art" defaultValue="rahmenvertrag" className={FELD}>
              <option value="einzelauftrag">Einzelauftrag</option>
              <option value="rahmenvertrag">Rahmenvertrag</option>
              <option value="dauerauftrag">Dauerauftrag</option>
              <option value="projekt">Projekt</option>
            </select>
            <p className="mt-s1 text-xs text-text-muted">
              Der Knopf auf der Detailseite setzt hier hart{' '}
              <code>rahmenvertrag</code>. Darum gibt es diese Seite.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="verantwortlichBenutzerId">
              Verantwortliche Leitung
            </label>
            <select
              id="verantwortlichBenutzerId"
              name="verantwortlichBenutzerId"
              required
              className={FELD}
            >
              {leitungen.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>

            <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
              <div>
                <label className="block text-sm text-text" htmlFor="startDatum">
                  Start
                </label>
                <input
                  id="startDatum"
                  name="startDatum"
                  type="date"
                  required
                  /**
                   * Der BERLINER Kalendertag, nicht der von UTC. In den ersten
                   * Stunden eines Berliner Tages liegt toISOString() noch
                   * auf dem Vortag — und der Auftrag begaenne einen Tag zu
                   * frueh (Invariante 2).
                   */
                  defaultValue={berlinKalendertag(new Date())}
                  className={FELD}
                />
              </div>
              <div>
                <label className="block text-sm text-text" htmlFor="laufzeitBis">
                  Laufzeit bis
                </label>
                <input id="laufzeitBis" name="laufzeitBis" type="date" className={FELD} />
                <p className="mt-s1 text-xs text-text-muted">leer = unbefristet</p>
              </div>
            </div>

            {/*
              * V-173 (OPS-10): die Wandlung setzte weder Personalbedarf noch
              * Stunden noch Ausstattung — ein Auftrag aus dem Angebot hatte
              * sie für immer nicht. Freiwillig, nie geschätzt.
              */}
            <fieldset className="mt-s5 border-0 p-0" data-cse="annahme-ops10">
              <legend className="text-sm font-semibold text-text">
                {nachSprache(AUFTRAG_TEXTE, zugang.sprache).ops10Titel}
              </legend>
              <p className="mt-s1 text-xs text-text-muted">
                {nachSprache(AUFTRAG_TEXTE, zugang.sprache).ops10Hinweis}
              </p>
              <div className="mt-s3 grid grid-cols-1 gap-s4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm text-text" htmlFor="personalbedarfAnzahl">
                    {nachSprache(AUFTRAG_TEXTE, zugang.sprache).personalbedarf}
                  </label>
                  <input id="personalbedarfAnzahl" name="personalbedarfAnzahl"
                         inputMode="numeric" className={FELD} />
                </div>
                <div>
                  <label className="block text-sm text-text" htmlFor="wochenstundenSoll">
                    {nachSprache(AUFTRAG_TEXTE, zugang.sprache).wochenstunden}
                  </label>
                  <input id="wochenstundenSoll" name="wochenstundenSoll"
                         inputMode="decimal" className={FELD} />
                </div>
              </div>
              <label className="mt-s4 block text-sm text-text" htmlFor="ausstattungHinweis">
                {nachSprache(AUFTRAG_TEXTE, zugang.sprache).ausstattung}
              </label>
              <textarea id="ausstattungHinweis" name="ausstattungHinweis" rows={2}
                        className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
            </fieldset>

            <button
              type="submit"
              data-cse="annahme-erfassen"
              className="mt-s5 inline-flex min-h-11 items-center rounded-md bg-brand px-s5 text-sm text-white hover:bg-brand-hover"
            >
              Angenommen — Auftrag anlegen
            </button>
          </form>
        </section>
      ) : null}

      {kopf.status === 'versendet' && !gewandelt ? (
        <section aria-labelledby="absage" className="mb-s6">
          <h2 id="absage" className="text-h2 text-text">Es wird nichts daraus</h2>
          <form
            method="post"
            action="/api/angebot/entscheidung"
            data-cse="absage-form"
            className="mt-s4 max-w-prose rounded-lg border border-line bg-surface p-s5"
          >
            <input type="hidden" name="angebotId" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />

            <label className="block text-sm text-text" htmlFor="ausgang">
              Was ist geschehen?
            </label>
            <select id="ausgang" name="ausgang" defaultValue="abgelehnt" className={FELD}>
              <option value="abgelehnt">Der Kunde hat abgelehnt</option>
              <option value="zurueckgezogen">Wir ziehen das Angebot zurück</option>
            </select>
            <p className="mt-s1 text-xs text-text-muted">
              Zwei verschiedene Dinge, und deshalb zwei Werte: abgelehnt hat der
              Kunde, zurückgezogen haben wir. Ein zurückgezogenes Angebot behält
              seinen Freigeber — ein Rückzug löscht nicht, dass der Preis einmal
              verantwortet wurde.
            </p>

            <label className="mt-s4 block text-sm text-text" htmlFor="absageNotiz">
              Grund
            </label>
            <textarea
              id="absageNotiz"
              name="notiz"
              rows={3}
              required
              placeholder="z. B. Preis über Budget; Vergabe an Bestandsdienstleister"
              className="mt-s2 w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text"
            />

            <p className="mt-s4 text-xs text-text-muted">
              Was daraus folgt — Wiedervorlage, Nachfassangebot, Lead-Status —
              ist nicht entschieden und wird deshalb nicht erfunden. Festgehalten
              wird der Ausgang und sein Grund.
            </p>

            <button
              type="submit"
              data-cse="absage-erfassen"
              className="mt-s4 inline-flex min-h-11 items-center rounded-md border border-line px-s5 text-sm text-text hover:bg-surface-2"
            >
              Ausgang festhalten
            </button>
          </form>
        </section>
      ) : null}
    </PortalRahmen>
  );
}
