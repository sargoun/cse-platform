import { notFound } from 'next/navigation';
import { StatusPill, type PillZustand } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import {
  findeEigenenAntrag, type EigenerAntrag,
} from '@/server/services/mitarbeiter/antraege';
import { artInSprache } from '@/server/services/abwesenheit/antrag';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft } from '../../bausteine';

/**
 * `/portal/mein/antraege/[id]` — ein einzelner Antrag (EMP-10, EMP-15, NOT-03).
 *
 * **Ein fremder Antrag ist hier nicht verboten, sondern nicht vorhanden**
 * (AUT-06): `antrag.t_person` liefert im Personen-Scope null Zeilen, und diese
 * Seite antwortet 404. Ein 403 bestaetigte, dass es ihn gibt.
 *
 * **Der Grund einer Abwesenheit steht auch hier NICHT.** `abwesenheitsart_id`,
 * `au_*`, `dokument_id` und `bemerkung` gibt die Datenbank der Anwendungsrolle
 * gar nicht zu lesen (0073, Art. 9 DSGVO) — auch nicht fuer die eigene Zeile.
 *
 * **Zurueckziehen wird jetzt angeboten** — und das ist neu. Bis 0301 gab es auf
 * `antrag` als UPDATE-Policy nur `t_mandant_entscheiden` mit
 * `zeit.antrag_entscheiden`, dem Recht der PLANUNG; `zieheAntragZurueck` traf
 * null Zeilen und antwortete 404 auf einen Antrag, den der Mensch vor sich sah.
 * `t_selbst_zurueckziehen` (0301) traegt den Weg: USING nur `eingereicht` und
 * `in_pruefung`, WITH CHECK nur den Zielzustand `zurueckgezogen`.
 *
 * **Der Knopf erscheint nur, solange er etwas tut.** Nach einer Entscheidung
 * ist eine Ruecknahme keine mehr, sondern die stille Entwertung dessen, was
 * jemand entschieden hat — dann steht statt des Knopfes die Entscheidung.
 */
export const dynamic = 'force-dynamic';

function antragPille(status: string): PillZustand {
  switch (status) {
    case 'eingereicht': return 'Wartet';
    case 'in_pruefung': return 'In Prüfung';
    case 'genehmigt': return 'Abgeschlossen';
    case 'abgelehnt': return 'Abgelehnt';
    default: return 'Archiviert';
  }
}

export default async function MeinAntrag(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ergebnis = await meinPortal<EigenerAntrag | null>(
    `/portal/mein/antraege/${id}`,
    async (kontext, teil) => findeEigenenAntrag(kontext, teil.anstellungen, id),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis, daten } = ergebnis;
  const a = daten.antrag;
  /*
   * Die Art in der Sprache DIESES Menschen (V-062).
   *
   * `antragsart.bezeichnung_i18n` liegt seit `0074` da; hier stand die
   * deutsche Bezeichnung — „Urlaubsantrag" auf einem Bildschirm, den jemand
   * auf Arabisch eingestellt hat, weil er kein Deutsch liest.
   */
  const artName = artInSprache(a, basis.sprache);
  const t = basis.texte;

  /*
   * Die Zeitpunkte kommen als `Date` aus dem Dienst und werden HIER in
   * Berliner Ortszeit gezeigt (Invariante 2) — mit derselben Formatierung wie
   * der Posteingang, damit zwei Seiten desselben Portals dieselbe Uhrzeit
   * gleich schreiben.
   */
  const zeitpunkt = new Intl.DateTimeFormat(basis.sprache === 'de' ? 'de-DE' : basis.sprache, {
    timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short',
  });

  return (
    <MeinRahmen basis={basis} titel={t.antraege} aktiverTab="heute"
      zurueck={{ ziel: "/portal/mein/antraege", text: t.antraege }}
    >

      <div className="mb-s5 flex flex-wrap items-center gap-s3">
        <h1 className="m-0 text-h1 text-text">{artName}</h1>
        <StatusPill sprache={basis.sprache} zustand={antragPille(a.status)} />
      </div>

      <section
        data-cse="antrag"
        data-mandant={daten.mandantSlug}
        className="mb-s5 rounded-lg border border-line bg-surface p-s4"
      >
        <Felder>
          <Feld label={t.gesellschaft}>
            <Gesellschaft slug={daten.mandantSlug} name={daten.mandantName} />
          </Feld>
          <Feld label={t.antragArt}>{artName}</Feld>
          <Feld label={t.von}>
            <span className="cse-zahl">{a.vonDatum ?? '—'}</span>
          </Feld>
          <Feld label={t.bis}>
            <span className="cse-zahl">{a.bisDatum ?? '—'}</span>
          </Feld>
          <Feld label={t.nachricht}>{a.nachricht ?? '—'}</Feld>
          <Feld label={t.eingereichtAm}>
            <time dateTime={a.eingereichtAm.toISOString()} className="cse-zahl">
              {zeitpunkt.format(a.eingereichtAm)}
            </time>
          </Feld>
          {a.entschiedenAm !== null && (
            <Feld label={t.entschiedenAm}>
              <time dateTime={a.entschiedenAm.toISOString()} className="cse-zahl">
                {zeitpunkt.format(a.entschiedenAm)}
              </time>
            </Feld>
          )}
          {a.entscheidungKommentar !== null && (
            <Feld label={t.entscheidung}>{a.entscheidungKommentar}</Feld>
          )}
        </Felder>
      </section>

      {daten.zurueckziehbar ? (
        <section data-cse="zurueckziehen">
          <p className="mb-s3 max-w-prose text-base text-text-muted">
            {t.zurueckziehenHinweis}
          </p>
          {/*
            Ein echtes `<form method="post">` ohne JavaScript — die Geraete sind
            alte Diensttelefone (SEITENKARTE §13). Das Ziel kommt aus dem Pfad
            und nicht aus einem Feld.
          */}
          <form method="post" action={`/api/mein/antraege/${a.id}/zurueckziehen`}>
            <input type="hidden" name="zurueck" value="/portal/mein/antraege" />
            <Button type="submit" variante="secondary" data-cse="antrag-zurueckziehen">
              {t.zurueckziehen}
            </Button>
          </form>
        </section>
      ) : (
        <p data-cse="nicht-zurueckziehbar" className="m-0 max-w-prose text-base text-text-muted">
          {a.status === 'zurueckgezogen' ? t.zurueckgezogen : t.keinBearbeiten}
        </p>
      )}
    </MeinRahmen>
  );
}
