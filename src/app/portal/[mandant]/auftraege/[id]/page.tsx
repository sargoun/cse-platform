import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Hinweis } from '@/components/ui/Hinweis';
import { Button } from '@/components/ui/Button';
import { Recht } from '@/components/ui/Recht';
import { WEGE, ZUSTAND_TEXT, type Auftragszustand } from '@/server/services/auftrag/status';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { formatiereMenge, mengeAusPostgresOderNull } from '@/server/services/finanz/menge';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { portalZugang } from '../../../zugang';
import { slugTor } from '../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../kennung';
import { haeltRechte } from '../../../rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { KETTE_TEXTE } from '@/lib/i18n/verwaltung/crm-kette';

/**
 * `/portal/[mandant]/auftraege/[id]` — ein Auftrag mit dem, was OPS-10
 * verlangt.
 *
 * **Und sein ZUSTAND lässt sich setzen** (V-081). `auftrag_status` kennt seit
 * `0025` fünf Werte; geschrieben wurde genau einer — `abgeschlossen`, vom
 * Abschlussvorgang. Jeder Auftrag stand von seiner Anlage bis zu seinem Ende
 * auf `angelegt`, während diese Seite vier weitere Etiketten kannte, die nie
 * jemand sah.
 *
 * Die Auswahl zeigt nur, was von HIER aus offensteht: `WEGE` ist dieselbe
 * Tabelle, die der Dienst liest, und `kern.auftrag_status_pruefen` (`0389`)
 * hält sie ein drittes Mal. Ein Knopf, der etwas anbietet und danach „geht
 * nicht" sagt, ist schlechter als einer, der gar nicht erst da ist.
 */
export const dynamic = 'force-dynamic';

const STATUS_FEHLER: Readonly<Record<string, string>> = {
  ohne_begruendung: 'Ein Auftrag ruht oder wird storniert nicht ohne Grund — der Satz '
    + 'steht später allein da, wenn jemand fragt, seit wann und weshalb hier nichts '
    + 'läuft.',
  kein_weg: 'Dieser Weg steht am Auftrag nicht offen. Ein stornierter wird nicht wieder '
    + 'aufgenommen, ein abgeschlossener nicht wieder geöffnet (O-734) — wer sich geirrt '
    + 'hat, legt einen neuen an.',
  unveraendert: 'Der Auftrag steht bereits auf diesem Zustand.',
  unbekannter_zustand: 'Diesen Zustand gibt es hier nicht. Abgeschlossen wird über den '
    + 'Abschlussvorgang mit eigenem Recht (OPS-05).',
  nicht_gefunden: 'Diesen Auftrag gibt es nicht — oder diese Sitzung darf ihn nicht '
    + 'ändern.',
  abgewiesen: 'Der Auftragsstatus liess sich nicht setzen.',
};

const PILLE: Readonly<Record<string, PillZustand>> = {
  angelegt: 'Geplant', aktiv: 'In Arbeit', pausiert: 'Wartet',
  abgeschlossen: 'Abgeschlossen', storniert: 'Abgelehnt',
};

interface Kopf {
  readonly id: string;
  readonly auftragsnummer: string;
  readonly bezeichnung: string;
  readonly beschreibung: string | null;
  readonly art: string;
  readonly status: string;
  readonly kunde: string;
  readonly kunde_id: string;
  readonly objekt: string | null;
  readonly objekt_id: string | null;
  readonly leitung: string | null;
  readonly start: string;
  readonly laufzeit_bis: string | null;
  readonly personalbedarf: number | null;
  readonly wochenstunden: string | null;
  readonly ausstattung: string | null;
  readonly wert: string | null;
  readonly angebotsnummer: string | null;
  readonly angebot_id: string | null;
  /**
   * Die Anfrage, aus der der Auftrag kam (V-138, REQ-07): der Bezug, über
   * den der Herkunftsbericht zählt. Die Nummer liest nur, wer `crm.lesen`
   * hält (Policy auf `lead`).
   */
  readonly lead_id: string | null;
  readonly leadnummer: string | null;
  readonly freigegeben: boolean;
  /** Warum der Auftrag ruht oder storniert wurde (V-081). */
  readonly status_grund: string | null;
  readonly status_seit: string | null;
}

export default async function AuftragDetail(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant, id } = await params;
  const suche = await searchParams;
  const statusFehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  kennungOder404(id);
  const zugang = await portalZugang(`/portal/${mandant}/auftraege/${id}`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * Kunde, Objekt und Angebot verlangen laut Manifest `crm.lesen`,
   * `objekt.lesen` bzw. `angebot.lesen`; diese Seite oeffnet mit
   * `auftrag.lesen` allein. Wer den Auftrag lesen darf, darf nicht
   * zwangslaeufig den Kunden, das Objekt oder das Angebot oeffnen — der
   * Verweis fuehrte dann auf 404 und verriet, was er nicht zeigen darf
   * (AUT-06, Copilot-Runde auf PR 16 / D-581). Ohne Recht steht der
   * blosse Name.
   */
  /**
   * Die beiden neuen Nachbarseiten tragen EIGENE Rechte, nicht
   * `auftrag.schreiben`: der Abschluss `auftrag.abschliessen` (er stellt nach
   * D-366 die FIN-18-Warnung im Rechnungsweg scharf), die Kundenfreigabe
   * `referenz.kundenfreigabe_erfassen` (sie entscheidet ueber eine
   * Veroeffentlichung). Ohne diese Pruefung fuehrte jeder Verweis fuer manche
   * Rollen auf 404 und verriete damit, was er nicht zeigen darf (AUT-06).
   */
  const darf = await haeltRechte(
    sitzung, 'crm.lesen', 'objekt.lesen', 'angebot.lesen',
    'auftrag.abschliessen', 'referenz.kundenfreigabe_erfassen',
    'abrechnung.schreiben',
    /*
     * V-081: Pausieren und Stornieren sind Auftragspflege
     * (`auftrag.schreiben`) und ausdrücklich nicht der Abschluss — der trägt
     * sein eigenes Recht, weil er nach D-366 die FIN-18-Warnung scharf stellt.
     */
    'auftrag.schreiben');

  const [kopf] = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => kontext.abfrage<Kopf>(
      `select a.id, a.auftragsnummer, a.bezeichnung, a.beschreibung,
              a.art::text as art, a.status::text as status,
              k.name as kunde, a.kunde_id, o.bezeichnung as objekt, a.objekt_id,
              b.name as leitung,
              to_char(a.start_datum, 'DD.MM.YYYY') as start,
              to_char(a.laufzeit_bis, 'DD.MM.YYYY') as laufzeit_bis,
              a.personalbedarf_anzahl as personalbedarf,
              a.wochenstunden_soll::text as wochenstunden,
              a.ausstattung_hinweis as ausstattung,
              a.auftragswert_netto_cent::text as wert,
              ang.angebotsnummer, a.angebot_id,
              a.lead_id::text as lead_id,
              (select l.leadnummer from lead l where l.id = a.lead_id) as leadnummer,
              a.freigegeben_vom_kunden as freigegeben,
              a.status_grund,
              to_char(a.status_geaendert_am at time zone 'Europe/Berlin',
                      'DD.MM.YYYY HH24:MI') as status_seit
         from auftrag a
         join kunde k on k.id = a.kunde_id
         left join objekt o on o.id = a.objekt_id
         left join benutzer b on b.id = a.verantwortlich_benutzer_id
         left join angebot ang on ang.id = a.angebot_id
        where a.id = $1`, [id],
    ))) as Promise<readonly Kopf[]>);

  if (kopf === undefined) notFound();

  /*
   * **Dieselbe Tabelle wie im Dienst und im Auslöser.** Sie steht in
   * `services/auftrag/status.ts` und wird hier gelesen, nicht abgeschrieben:
   * eine zweite Liste gewänne beim ersten Unterschied, ohne dass es jemand
   * sieht — und die Oberfläche böte einen Weg an, den die Datenbank abweist.
   */
  const offeneWege: readonly Auftragszustand[] = WEGE[kopf.status] ?? [];

  const felder: readonly (readonly [string, React.ReactNode])[] = [
    ['Nummer', kopf.auftragsnummer],
    ['Kunde', darf['crm.lesen'] === true ? (
      <Link
        href={`/portal/${mandant}/crm/kunden/${kopf.kunde_id}`}
        className="text-text underline-offset-2 hover:text-brand hover:underline"
      >
        {kopf.kunde}
      </Link>
    ) : kopf.kunde],
    ['Ort', kopf.objekt === null || kopf.objekt_id === null
      ? 'ohne festen Ort'
      : darf['objekt.lesen'] === true ? (
        <Link
          href={`/portal/${mandant}/objekte/${kopf.objekt_id}`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          {kopf.objekt}
        </Link>
      ) : kopf.objekt],
    ['Verantwortlich', kopf.leitung ?? '—'],
    ['Start', kopf.start],
    ['Laufzeit bis', kopf.laufzeit_bis ?? 'unbefristet'],
    ['Personalbedarf', kopf.personalbedarf === null
      ? <span className="text-text-subtle">nicht angegeben</span>
      : `${String(kopf.personalbedarf)} Personen`],
    ['Wochenstunden', kopf.wochenstunden === null
      ? <span className="text-text-subtle">nicht angegeben</span>
      : formatiereMenge(mengeAusPostgresOderNull(kopf.wochenstunden))],
    ['Wert netto', kopf.wert === null
      ? <span className="text-text-subtle">offen</span>
      : formatiereGeld(cent(BigInt(kopf.wert)))],
    ['Aus Angebot', kopf.angebotsnummer === null || kopf.angebot_id === null
      ? '—'
      : darf['angebot.lesen'] === true ? (
        <Link
          href={`/portal/${mandant}/angebote/${kopf.angebot_id}`}
          className="text-text underline-offset-2 hover:text-brand hover:underline"
        >
          {kopf.angebotsnummer}
        </Link>
      ) : kopf.angebotsnummer],
    ...(kopf.lead_id === null || kopf.leadnummer === null
      || darf['crm.lesen'] !== true ? [] : [[
      nachSprache(KETTE_TEXTE, zugang.sprache).anfrage,
      <Link
        key="anfrage"
        href={`/portal/${mandant}/crm/leads/${kopf.lead_id}`}
        data-cse="auftrag-anfrage"
        className="text-text underline-offset-2 hover:text-brand hover:underline"
      >
        {kopf.leadnummer}
      </Link>,
    ] as const]),
  ];

  return (
    <PortalRahmen
      titel={kopf.bezeichnung}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="auftraege"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
      zurueck={{ ziel: `/portal/${mandant}/auftraege`, text: 'Alle Aufträge' }}
    >
      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.bezeichnung}</h1>
        <StatusPill zustand={PILLE[kopf.status] ?? 'Geplant'} />
      </div>

      {/*
        * Die zwei Wege, die es von hier aus bisher nicht gab: der Abschluss
        * (OPS-05, mit der FIN-18-Pruefliste davor) und die Kundenfreigabe
        * (PRO-05, der Beleg fuer eine oeffentliche Referenz). Beide sind
        * eigene Vorgaenge mit eigenem Recht, und beide stehen hier als Weg —
        * nicht als Knopf: was sie tun, gehoert auf ihre Seite, mit dem, was
        * dagegen spricht.
        */}
      <nav aria-label="Vorgänge" className="mb-s6 flex flex-wrap gap-s3">
        {darf['auftrag.abschliessen'] === true && (
          <Link
            href={`/portal/${mandant}/auftraege/${id}/abschluss`}
            data-cse="zum-abschluss"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
          >
            {kopf.status === 'abgeschlossen' ? 'Abschluss ansehen' : 'Auftrag abschließen'}
          </Link>
        )}
        {darf['referenz.kundenfreigabe_erfassen'] === true && (
          <Link
            href={`/portal/${mandant}/auftraege/${id}/kundenfreigabe`}
            data-cse="zur-kundenfreigabe"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
          >
            Kundenfreigabe (Referenz)
          </Link>
        )}
        {/*
          * **Der dritte Weg — und er fehlte ganz** (V-125).
          * `…/auftraege/[id]/abrechnung` war gebaut, bewacht und im Manifest
          * geführt und von keiner Seite aus erreichbar. Er beantwortet die
          * Frage, WIE dieser Auftrag abgerechnet wird (eine der fünf Arten,
          * FIN-16) — eine Frage, die man am Auftrag stellt und sonst
          * nirgends. `abrechnung.schreiben` ist das Recht der Zielseite; das
          * Auftragsblatt selbst trägt nur `auftrag.lesen`.
          */}
        {darf['abrechnung.schreiben'] === true && (
          <Link
            href={`/portal/${mandant}/auftraege/${id}/abrechnung`}
            data-cse="zur-abrechnung"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s4 text-sm text-text hover:bg-surface-2"
          >
            Abrechnung
          </Link>
        )}
      </nav>

      <dl
        data-cse="auftrag-felder"
        className="m-0 grid grid-cols-1 gap-s4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {felder.map(([label, wert]) => (
          <div key={label}>
            <dt className="text-micro uppercase tracking-[0.08em] text-text-subtle">{label}</dt>
            <dd className="m-0 mt-s1 text-sm text-text">{wert}</dd>
          </div>
        ))}
      </dl>

      {kopf.ausstattung === null ? null : (
        <section className="mt-s6">
          <h2 className="text-h3 text-text">Ausstattung</h2>
          <p className="whitespace-pre-line text-sm text-text">{kopf.ausstattung}</p>
        </section>
      )}

      {kopf.beschreibung === null ? null : (
        <section className="mt-s6">
          <h2 className="text-h3 text-text">Beschreibung</h2>
          <p className="whitespace-pre-line text-sm text-text">{kopf.beschreibung}</p>
        </section>
      )}

      {/* ---------------------------------------- Der Zustand (V-081) */}
      <section aria-labelledby="zustand" className="mt-s7 max-w-prose">
        <h2 id="zustand" className="mb-s3 text-h3 text-text">Zustand des Auftrags</h2>

        {kopf.status_grund === null ? null : (
          <p data-cse="auftrag-statusgrund"
             className="mb-s4 rounded-lg border border-line bg-surface-2 p-s4 text-sm text-text">
            <strong>{kopf.status === 'storniert' ? 'Storniert' : 'Vermerk'}</strong>
            {kopf.status_seit === null ? '' : ` am ${kopf.status_seit}`} —{' '}
            {kopf.status_grund}
          </p>
        )}

        {statusFehler !== null ? (
          <Hinweis art="warnung" cse="auftrag-statusfehler" className="mb-s4">
            <strong>Nicht gesetzt.</strong>{' '}
            {STATUS_FEHLER[statusFehler] ?? 'Die Änderung wurde abgewiesen.'}
          </Hinweis>
        ) : null}

        {darf['auftrag.schreiben'] !== true ? (
          <p className="text-sm text-text-muted" data-cse="zustand-ohne-recht">
            Den Zustand setzt eine Sitzung mit{' '}
            <Recht schluessel="auftrag.schreiben" />.
          </p>
        ) : offeneWege.length === 0 ? (
          <p className="text-sm text-text-muted" data-cse="zustand-endstation">
            {kopf.status === 'storniert'
              ? 'Ein stornierter Auftrag wird nicht wieder aufgenommen. Wer sich geirrt '
                + 'hat, legt einen neuen an — dieselbe Antwort, die der Abschluss gibt.'
              : 'Ein abgeschlossener Auftrag wird nicht wieder geöffnet (O-734). '
                + 'Korrigiert wird über einen Nachtrag oder einen neuen Auftrag.'}
          </p>
        ) : (
          <form method="post" action="/api/auftrag/status"
                data-cse="auftrag-zustand"
                className="flex flex-col gap-s3 rounded-lg border border-line bg-surface p-s5">
            <input type="hidden" name="auftragId" value={kopf.id} />
            <input type="hidden" name="zurueck"
                   value={`/portal/${mandant}/auftraege/${kopf.id}`} />
            <label className="flex flex-col gap-s2 text-sm text-text">
              Neuer Zustand
              <select name="zustand" required data-cse="zustand-wahl"
                      className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s4 py-s3 text-base text-text">
                {offeneWege.map((z) => (
                  <option key={z} value={z}>{ZUSTAND_TEXT[z]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-s2 text-sm text-text">
              Grund — Pflicht beim Ruhen und beim Stornieren
              <textarea name="grund" rows={3} data-cse="zustand-grund"
                        placeholder="z. B. Objekt bis 30.06. geschlossen; Kunde hat unterbrochen"
                        className="w-full rounded-md border border-line bg-surface-3 p-s3 text-sm text-text" />
            </label>
            <div>
              <Button type="submit" variante="secondary" data-cse="zustand-setzen">
                Zustand setzen
              </Button>
            </div>
            <p className="m-0 text-xs text-text-muted">
              <strong>Abgeschlossen wird hier nicht.</strong> Der Abschluss ist ein
              eigener Vorgang mit eigenem Recht und einer eigenen Seite, auf der die
              Prüfliste steht (OPS-05, FIN-18). <strong>Und storniert ist endgültig:</strong>{' '}
              das Storno ist die Aussage, dass dieser Vertrag nicht zustande kommt — sie
              steht in der Kundenakte und nimmt den Auftrag von der Prüfliste der
              Buchhaltung. Der Grund gehört dem AKTUELLEN Zustand: wer einen ruhenden
              Auftrag wieder aufnimmt, ohne etwas zu schreiben, räumt ihn; im Protokoll
              bleibt er.
            </p>
          </form>
        )}
      </section>

      <p className="mt-s6 max-w-prose text-xs text-text-muted">
        {kopf.freigegeben
          ? 'Der Kunde hat diesen Auftrag als Referenz freigegeben (PRO-05).'
          : 'Nicht als öffentliche Referenz freigegeben. Ohne schriftliche '
            + 'Freigabe des Kunden erscheint kein Auftrag auf der Website (PRO-05).'}
      </p>
    </PortalRahmen>
  );
}
