import Link from 'next/link';
import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { berlinHeute } from '@/server/db/heute';
import { nachweislage, type Nachweislage } from '@/server/services/nachweis/uebersicht';
import { kennungOder404 } from '../../../../kennung';
import { haeltRechte } from '../../../../rechte';
import {
  leseAnstellungen, lesePerson, spracheText,
  type AnstellungZeile, type PersonZeile,
} from '../daten';

/**
 * `/portal/[mandant]/personal/personen/[id]` — ein Mensch (D-09, EMP-14,
 * SEC-02, SEC-03).
 *
 * **Die Seite zeigt drei Dinge nebeneinander, und die Trennung ist der Inhalt:**
 * wer der Mensch ist (Sprache, Telefon), was er kann und darf (Nachweise,
 * Bewacherregister — beides am Menschen), und was er in DIESEM Bereich ist
 * (Beschäftigungen — alles Kostenwirksame hängt dort).
 *
 * **Was hier NICHT steht:** das Geburtsdatum (eigenes Recht,
 * `personen/[id]/stammdaten`), der Stundensatz (K-05, als Spaltenrecht
 * entzogen) und die Beschäftigungen der Schwestergesellschaften — die
 * Mandantenwand hat genau eine gesanktionierte Durchlässigkeit, und das ist
 * die ArbZG-Belastung (K-06). Die Frage steht als O-220 offen.
 */
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Readonly<Record<string, string>> = {
  aktiv: 'Aktiv', ruhend: 'Ruhend', beendet: 'Beendet',
};

export default async function Personenblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const pfad = `/portal/${mandant}/personal/personen/${id}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;

  /* AUT-06: ein Knopf, dessen Ziel diese Sitzung nicht oeffnen darf,
     verraet die Existenz dessen, was er nicht zeigen darf. Laut Manifest
     verlangt „Zugang" `personal.zugang_verwalten`, das Register
     `personal.nachweis_lesen`, das Stundenkonto `zeit.konto_lesen` und das
     Nachweisblatt `personal.nachweis_verwalten`; dieses Blatt öffnet mit
     `personal.lesen` allein — die drei letzten führten sonst auf 404
     (Copilot-Runde auf PR 16 / D-581). */
  const darf = await haeltRechte(
    sitzung, 'personal.zugang_verwalten', 'personal.nachweis_lesen',
    'zeit.konto_lesen', 'personal.nachweis_verwalten',
    'personal.stammdaten_lesen', 'personal.zusammenfuehren');
  if (sitzung.aktiverMandantId === null) notFound();

  const heute = await berlinHeute();
  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const kopf = await lesePerson(kontext, heute, id);
      if (kopf === null) return { kopf: null, anstellungen: [], lage: null };
      return {
        kopf,
        anstellungen: await leseAnstellungen(kontext, id),
        lage: await nachweislage(
          { unsafe: (s: string, w?: readonly unknown[]) => kontext.abfrage(s, w) },
          id, heute),
      };
    }),
  ) as Promise<{
    kopf: PersonZeile | null;
    anstellungen: readonly AnstellungZeile[];
    lage: Nachweislage | null;
  }>);

  if (daten.kopf === null || daten.lage === null) notFound();
  const { kopf, anstellungen, lage } = daten;

  return (
    <PortalRahmen
      titel="Person"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{kopf.name}</h1>
        <p className="m-0 text-sm text-text-muted">
          {spracheText(kopf.sprache)}
          {kopf.telefon !== null && (
            <>
              {' · '}
              <span className="tabular-nums">{kopf.telefon}</span>
            </>
          )}
        </p>
      </div>

      <nav className="mb-s5 flex flex-wrap gap-s2">
        <Link
          href={`/portal/${mandant}/personal/personen`}
          className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
        >
          Alle Personen
        </Link>
        {darf['personal.nachweis_lesen'] === true && (
          <Link
            href={`/portal/${mandant}/personal/nachweise`}
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
          >
            Nachweisregister
          </Link>
        )}
        {darf['personal.zugang_verwalten'] === true && (
          <Link
            href={`/portal/${mandant}/personal/personen/${id}/zugang`}
            data-cse="person-zugang"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
          >
            Zugang und Anmeldecode
          </Link>
        )}
        {/*
          * „Stammdaten" verlangt `personal.stammdaten_lesen` (SEC-03, LEG-09),
          * „Dubletten" `personal.zusammenfuehren`. Ohne das jeweilige Recht
          * steht der Knopf nicht — er fuehrte auf 404 und verriete damit, was
          * er nicht zeigen darf (AUT-06, D-581). Und ohne den Knopf waere die
          * Stammdatenseite nur ueber die Adresszeile erreichbar.
          */}
        {darf['personal.stammdaten_lesen'] === true && (
          <Link
            href={`/portal/${mandant}/personal/personen/${id}/stammdaten`}
            data-cse="person-stammdaten"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
          >
            Stammdaten (Bewacherregister)
          </Link>
        )}
        {darf['personal.zusammenfuehren'] === true && (
          <Link
            href={`/portal/${mandant}/personal/zusammenfuehren`}
            data-cse="person-dubletten"
            className="inline-flex min-h-11 items-center rounded-md border border-line px-s3 text-sm text-text-muted transition-colors duration-fast hover:border-line-strong hover:text-text"
          >
            Dubletten zusammenführen
          </Link>
        )}
      </nav>

      <h2 className="mb-s3 text-h3 text-text">
        Beschäftigungen in dieser Gesellschaft
      </h2>
      {anstellungen.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Keine Beschäftigung in diesem Bereich.
        </p>
      ) : (
        <DataTable
          beschriftung="Beschäftigungen dieses Menschen in dieser Gesellschaft"
          zeilen={anstellungen}
          schluessel={(a) => a.anstellungId}
          spalten={[
            {
              schluessel: 'nummer',
              kopf: 'Personalnummer',
              zelle: (a) => (
                <span className="tabular-nums">{a.personalnummer ?? '—'}</span>
              ),
            },
            {
              schluessel: 'zeitraum',
              kopf: 'Zeitraum',
              zelle: (a) => (
                <span className="tabular-nums">
                  {a.eintritt}
                  {a.austritt !== null && ` – ${a.austritt}`}
                </span>
              ),
            },
            {
              schluessel: 'modell',
              kopf: 'Arbeitszeit',
              zelle: (a) => (a.wochenstunden === null
                ? (a.arbeitszeitmodell ?? '—')
                : `${a.wochenstunden.replace('.', ',')} h/Woche`),
            },
            {
              schluessel: 'status',
              kopf: 'Status',
              zelle: (a) => (
                <span className={a.status === 'aktiv' ? 'text-text' : 'text-text-muted'}>
                  {STATUS_TEXT[a.status] ?? a.status}
                </span>
              ),
            },
            // Die Spalte besteht nur aus dem Verweis; ohne `zeit.konto_lesen`
            // entfällt sie ganz — ein leerer Kopf „Stundenkonto" läse sich wie
            // „kein Konto" (AUT-06, s. o.).
            ...(darf['zeit.konto_lesen'] === true ? [{
              schluessel: 'konto',
              kopf: 'Stundenkonto',
              zelle: (a: AnstellungZeile) => (
                <Link
                  href={`/portal/${mandant}/personal/stundenkonten/${a.anstellungId}`}
                  className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                >
                  ansehen
                </Link>
              ),
            }] : []),
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Nachweise</h2>
      {lage.nachweise.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          Für diesen Menschen ist kein Nachweis erfasst. Ob das eine Lücke ist,
          entscheidet die Anforderung der Schicht — nicht diese Seite.
        </p>
      ) : (
        <DataTable
          beschriftung="Nachweislage dieses Menschen"
          zeilen={lage.nachweise}
          schluessel={(n) => n.nachweisId}
          spalten={[
            {
              schluessel: 'bezeichnung',
              kopf: 'Nachweis',
              // Ohne `personal.nachweis_verwalten` bleibt die Bezeichnung — nur
              // der Weg zum Blatt fällt weg (AUT-06, s. o.).
              zelle: (n) => (darf['personal.nachweis_verwalten'] === true
                ? (
                  <Link
                    href={`/portal/${mandant}/personal/nachweise/${n.nachweisId}`}
                    className="text-text underline decoration-line underline-offset-4 hover:decoration-current"
                  >
                    {n.bezeichnung}
                  </Link>
                )
                : <span className="text-text">{n.bezeichnung}</span>),
            },
            {
              schluessel: 'gueltig',
              kopf: 'Gültig',
              zelle: (n) => (
                <span className="tabular-nums">
                  {n.gueltigAb}
                  {' – '}
                  {n.gueltigBis ?? 'unbefristet'}
                </span>
              ),
            },
            {
              schluessel: 'heute',
              kopf: `Deckt ${heute}`,
              zelle: (n) => (n.gueltigAmStichtag
                ? <span className="text-success">Ja</span>
                : (
                  <span className={n.blockiertEinsatz ? 'text-danger' : 'text-warning'}>
                    Nein
                    {n.blockiertEinsatz && ' — sperrt Einsätze'}
                  </span>
                )),
            },
          ]}
        />
      )}

      <h2 className="mb-s3 mt-s6 text-h3 text-text">Bewacherregister</h2>
      <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
        {lage.bewacher.vorhanden
          ? `Bewacher-ID ${lage.bewacher.bewacherId ?? '—'} · Status ${lage.bewacher.status ?? '—'} · gültig bis ${lage.bewacher.gueltigBis ?? 'unbefristet'}.`
          : 'Kein Eintrag erfasst.'}
        {' '}
        <strong className="text-text">Nicht verbunden</strong> — es gibt keine
        Schnittstelle zum Bewacherregister; dieser Stand ist handerfasst
        (SEC-03).
      </p>

      <p className="mt-s5 max-w-prose text-sm text-text-muted">
        Beschäftigungen in anderen Gesellschaften der Gruppe stehen hier nicht.
        Das ist keine Lücke der Seite, sondern die Mandantenwand: sie hat genau
        eine gesanktionierte Durchlässigkeit — die Arbeitszeitbelastung, die
        Dauern und Grenzen zurückgibt und sonst nichts (K-06). Ob die
        Personalstelle mehr sehen darf, ist eine Rechtsfrage und steht als
        O-220 offen.
      </p>
    </PortalRahmen>
  );
}
