import Link from 'next/link';
import { zeitpunktInSprache } from '@/lib/datum/zeitpunkt';
import { notFound } from 'next/navigation';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { tageAusPostgres } from '@/server/services/finanz/menge';
import {
  findeEigeneAbwesenheit, type EigeneAbwesenheit,
} from '@/server/services/mitarbeiter/antraege';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft } from '../../bausteine';
import { FormularFehler } from '../../FormularAntwort';

/**
 * `/portal/mein/abwesenheit/[id]` — eine einzelne eigene Abwesenheit
 * (V-056, EMP-10).
 *
 * **Der Befund, aus dem diese Seite entstand.** `/portal/mein/antraege`
 * listete die eigenen Abwesenheiten als Kacheln ohne Ziel — kein Verweis,
 * kein Blatt, kein Knopf. Darunter lag mehr als ein fehlender Link:
 * `cse_app` hatte auf `abwesenheit` genau EINE UPDATE-Policy, und die
 * verlangt `zeit.abwesenheit_genehmigen`, ein Recht der Planung. Wer sich um
 * 05:40 krank gemeldet und dabei den falschen Tag getippt hat, konnte das
 * nicht zurücknehmen — nicht über die Oberfläche und auch nicht darunter.
 * `t_selbst_zurueckziehen` (0386) trägt den Weg jetzt, in derselben Form wie
 * `antrag.t_selbst_zurueckziehen` (0301).
 *
 * **Die ART steht hier NICHT** — und der Satz daneben sagt warum.
 * `abwesenheitsart_id`, `au_*`, `dokument_id` und `bemerkung` gibt
 * `abwesenheit` der Anwendungsrolle gar nicht zu lesen (0073, Art. 9 DSGVO),
 * auch nicht für die eigene Zeile. Eine Lücke ohne Erklärung sieht aus wie
 * ein Fehler, und wer sie für einen hält, ruft an.
 *
 * **Eine fremde Abwesenheit ist hier nicht verboten, sondern nicht
 * vorhanden** (AUT-06): `t_person` liefert im Personen-Scope null Zeilen, und
 * diese Seite antwortet 404.
 */
export const dynamic = 'force-dynamic';

function abwesenheitPille(status: string): PillZustand {
  switch (status) {
    case 'beantragt': return 'Wartet';
    case 'genehmigt': return 'Abgeschlossen';
    case 'abgelehnt': return 'Abgelehnt';
    case 'storniert': return 'Archiviert';
    default: return 'In Arbeit';
  }
}

export default async function MeineAbwesenheit(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { id } = await params;
  /* Der Grund einer Abweisung, zurückgeschickt von der Route (V-198, D-692). */
  const fehler = (await searchParams)['fehler'];
  const ergebnis = await meinPortal<EigeneAbwesenheit | null>(
    `/portal/mein/abwesenheit/${id}`,
    async (kontext, teil) => findeEigeneAbwesenheit(kontext, teil.anstellungen, id),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis, daten } = ergebnis;
  const a = daten.abwesenheit;
  const t = basis.texte;

  const halbe = [a.vonHalbtags ? t.halberTagBeginn : null, a.bisHalbtags ? t.halberTagEnde : null]
    .filter((x): x is string => x !== null).join(' · ');

  return (
    <MeinRahmen basis={basis} titel={t.abwesenheitBlatt} aktiverTab="heute">
      <Link
        href="/portal/mein/antraege"
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.antraege}
      </Link>

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.abwesenheitBlatt}</h1>
        <StatusPill sprache={basis.sprache} zustand={abwesenheitPille(a.status)} />
      </div>

      <FormularFehler sprache={basis.sprache} grund={fehler} />

      <section
        data-cse="abwesenheit"
        data-mandant={daten.mandantSlug}
        className="mb-s5 rounded-lg border border-line bg-surface p-s4"
      >
        <Felder>
          <Feld label={t.gesellschaft}>
            <Gesellschaft slug={daten.mandantSlug} name={daten.mandantName} />
          </Feld>
          <Feld label={t.von}>
            <span className="cse-zahl">{tagInSprache(a.von, basis.sprache)}</span>
          </Feld>
          <Feld label={t.bis}>
            <span className="cse-zahl">{tagInSprache(a.bis, basis.sprache)}</span>
          </Feld>
          <Feld label={t.tage}>
            {/*
              `numeric(12,3)` kommt als Text „5.000" — das IST die Zahl (fünf
              Tage), nicht ihre Tausendstel. Hier stand eine Teilung durch
              1000, und jede Krankmeldung über fünf Tage zeigte „0" (V-194).
            */}
            <span className="cse-zahl">{tageAusPostgres(a.tageAngerechnet, basis.sprache)}</span>
          </Feld>
          {halbe !== '' && <Feld label={t.halbeTage}>{halbe}</Feld>}
          <Feld label={t.gemeldetAm}>
            <time dateTime={a.gemeldetAm.toISOString()} className="cse-zahl">
              {/* Berliner Ortszeit, gesetzliche Form (SEITENKARTE §12, V-201). */}
              {zeitpunktInSprache(a.gemeldetAm, basis.sprache)}
            </time>
          </Feld>
          {a.storniertAm !== null && (
            <Feld label={t.storniertAm}>
              <time dateTime={a.storniertAm.toISOString()} className="cse-zahl">
                {zeitpunktInSprache(a.storniertAm, basis.sprache)}
              </time>
            </Feld>
          )}
        </Felder>
      </section>

      <p data-cse="art-verdeckt" className="mb-s5 max-w-prose text-base text-text-muted">
        {t.abwesenheitArtVerdeckt}
      </p>

      {daten.zurueckziehbar ? (
        <section data-cse="abwesenheit-zuruecknehmen">
          <p className="mb-s3 max-w-prose text-base text-text-muted">
            {t.abwesenheitRuecknahmeHinweis}
          </p>
          {/*
            Ein echtes `<form method="post">` ohne JavaScript — die Geräte sind
            alte Diensttelefone (SEITENKARTE §13). Das Ziel kommt aus dem Pfad
            und nicht aus einem Feld.
          */}
          <form method="post" action={`/api/mein/abwesenheit/${a.id}/zurueckziehen`}>
            <input type="hidden" name="zurueck" value="/portal/mein/antraege" />
            {/* Entschieden, während das Blatt offen war? Zurück HIERHER (V-198). */}
            <input type="hidden" name="fehlerweg" value={`/portal/mein/abwesenheit/${a.id}`} />
            <Button type="submit" variante="secondary" data-cse="abwesenheit-zurueckziehen">
              {t.abwesenheitRuecknahme}
            </Button>
          </form>
        </section>
      ) : (
        <p data-cse="nicht-ruecknehmbar" className="m-0 max-w-prose text-base text-text-muted">
          {t.abwesenheitNichtRuecknehmbar}
        </p>
      )}
    </MeinRahmen>
  );
}
