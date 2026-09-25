import { notFound } from 'next/navigation';
import { tagInSprache } from '@/lib/datum/kalendertag';
import { StatusPill } from '@/components/ui/StatusPill';
import { waehleSpeicher } from '@/server/storage/waehle';
import { signierteMedienAdresse } from '@/server/services/zeit/medien';
import { findeEigeneSchicht, type EigeneSchicht }
  from '@/server/services/mitarbeiter/schichten';
import {
  listeSchichtMedien, type SchichtMedium,
} from '@/server/services/mitarbeiter/medien';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../../rahmen';
import { Feld, Felder, Hinweis, Leer } from '../../../bausteine';
import { FormularFehler } from '../../../FormularAntwort';

/**
 * `/portal/mein/schichten/[zuordnungId]/fotos` — die Aufnahmen der Schicht
 * (TIM-10, DOC-03, DOC-06, LEG-09, LEG-10).
 *
 * **Jede Adresse ist befristet signiert, keine ist oeffentlich** (DOC-03). Der
 * Bucket `einsatz-medien` ist privat; was hier steht, gilt fuenfzehn Minuten
 * und wird bei jedem Aufruf neu ausgestellt. Ein `src` auf eine feste Adresse
 * waere ein Bild von einem Arbeitsplatz, das jeder mit dem Link sieht.
 *
 * **Ist der Speicher nicht verbunden, sagt die Seite das** — und zeigt keinen
 * toten Bildrahmen und keinen Uploadknopf, der scheitert (CLAUDE.md: keine
 * Schein-Integrationen). Die ZEILEN stehen trotzdem da: dass es die Aufnahme
 * gibt, ist selbst der Nachweis, auch wenn sie gerade nicht abrufbar ist.
 *
 * **Die Aufnahme haengt an der SCHICHT, nicht am Zeiteintrag.** `einsatz` ist
 * ein eingetragener Bezug (`einsatz_medien_bezug`), und eine Schicht hat ihn
 * immer — ein Zeiteintrag entsteht erst mit dem Einstempeln. Wer vor einer
 * verschlossenen Tuer steht, hat noch nicht eingestempelt und braucht das Foto
 * gerade dann.
 *
 * **Ortsdaten werden vor dem Ablegen entfernt** (LEG-10), und zwar auf den
 * Bytes, die gespeichert werden. Das steht auf der Seite, weil TIM-10 es
 * zusagt — eine Zusage, die man nicht liest, ist keine.
 *
 * **Hier wird nichts geloescht.** Eine Aufnahme ist ein Beweis; sie wird
 * archiviert, nie entfernt (Invariante 8). Ist die Datei nach LEG-09 gelöscht
 * worden, bleibt die Zeile als Grabstein stehen und sagt es.
 */
export const dynamic = 'force-dynamic';

interface Aufnahme {
  readonly medium: SchichtMedium;
  readonly adresse: string | null;
}

interface Blatt {
  readonly schicht: EigeneSchicht;
  readonly aufnahmen: readonly Aufnahme[];
  readonly verbunden: boolean;
}

export default async function MeineSchichtfotos(
  { params, searchParams }: {
    params: Promise<{ zuordnungId: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { zuordnungId } = await params;
  /* Der Grund einer abgewiesenen Aufnahme — zu gross, nicht verbunden … (V-198). */
  const fehler = (await searchParams)['fehler'];
  const speicher = waehleSpeicher();

  const ergebnis = await meinPortal<Blatt | null>(
    `/portal/mein/schichten/${zuordnungId}/fotos`,
    async (kontext) => {
      const schicht = await findeEigeneSchicht(kontext, zuordnungId);
      if (schicht === null) return null;
      const medien = await listeSchichtMedien(kontext, schicht.einsatzId);

      const jetzt = Math.floor(Date.now() / 1000);
      const aufnahmen: Aufnahme[] = [];
      for (const medium of medien) {
        if (!speicher.verbunden || medium.entfernt) {
          aufnahmen.push({ medium, adresse: null });
          continue;
        }
        /*
         * Die Adresse wird EINZELN gesichert: eine Datei, die im Bucket fehlt,
         * soll nicht die ganze Liste leeren. Die Zeile bleibt, die Adresse
         * fehlt, und die Seite sagt, was los ist.
         */
        try {
          const adresse = await signierteMedienAdresse(kontext, medium.id, speicher, jetzt);
          aufnahmen.push({ medium, adresse: adresse?.url ?? null });
        } catch {
          aufnahmen.push({ medium, adresse: null });
        }
      }
      return { schicht, aufnahmen, verbunden: speicher.verbunden };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { schicht, aufnahmen, verbunden } = ergebnis.daten;
  const t = basis.texte;
  /*
   * Zwei Gruende, aus denen hier kein Formular steht, und sie sind nicht
   * derselbe wie „kein Speicher verbunden": die Schicht ist vorbei
   * (`app.ist_eingesetzt_auf_objekt` verlangt `ende_zeitpunkt >= now()`, 0004)
   * oder die Einteilung wurde aus dem Plan genommen
   * (`einsatz_zuordnung.t_selbst_m1` verlangt `entfernt_am is null`, 0300).
   * Beide enden im Schreibweg mit `404 nicht_gefunden`; beide gehoeren als
   * Satz auf den Bildschirm (O-740).
   */
  const sperre = schicht.entfernt ? t.schichtEntfernt
    : schicht.beendet ? t.schichtBeendet : null;
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  return (
    <MeinRahmen basis={basis} titel={t.fotos} aktiverTab="schichten"
      zurueck={{ ziel: `/portal/mein/schichten/${zuordnungId}`, text: t.schichten }}
    >

      <h1 className="mb-s2 text-h1 text-text">{t.fotos}</h1>
      <p className="mb-s5 text-base text-text-muted">
        {schicht.objekt ?? '—'} · <span className="cse-zahl">{tagInSprache(schicht.planDatum, basis.sprache)}</span>
      </p>

      <FormularFehler sprache={basis.sprache} grund={fehler} />

      {!verbunden && (
        <p data-cse="speicher-nicht-verbunden" className="mb-s5 max-w-prose text-base text-warning">
          {t.nichtVerbunden}
        </p>
      )}

      <section className="mb-s6" data-cse="aufnahmen">
        {aufnahmen.length === 0 ? <Leer text={t.keineAufnahmen} /> : (
          <ul className="m-0 flex list-none flex-col gap-s3 p-0">
            {aufnahmen.map(({ medium, adresse }) => (
              <li
                key={medium.id}
                data-cse="aufnahme"
                className="rounded-lg border border-line bg-surface p-s4"
              >
                <div className="mb-s3 flex flex-wrap items-center gap-s3">
                  <StatusPill sprache={basis.sprache} zustand={medium.entfernt ? 'Archiviert' : 'Abgeschlossen'} />
                  <span className="text-sm text-text-muted">{medium.mimeTyp}</span>
                </div>
                {adresse !== null && (
                  /*
                    Ein LINK und kein eingebettetes Bild. Zwei Gruende, und
                    beide gehoeren dem Telefon im Treppenhaus: die signierte
                    Adresse gilt fuenfzehn Minuten, ein zwischengespeichertes
                    `src` liefert danach 403 — und eine Liste von zehn
                    Vollbildaufnahmen laedt ueber Mobilfunk laenger als die
                    Pause dauert. Wer hinsehen will, tippt.
                  */
                  <p className="mb-s3">
                    <a
                      href={adresse}
                      data-cse="aufnahme-adresse"
                      className="inline-flex min-h-11 items-center text-base text-text underline"
                    >
                      {t.oeffnen}
                    </a>
                  </p>
                )}
                <Felder>
                  <Feld label={t.beschreibung}>{medium.beschreibung ?? '—'}</Feld>
                  <Feld label={t.erfasstAm}>
                    <span className="cse-zahl">{medium.erfasstLokal}</span>
                  </Feld>
                  <Feld label={t.geraeteZeit}>
                    <span className="cse-zahl">{medium.geraeteZeitLokal ?? '—'}</span>
                  </Feld>
                </Felder>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-cse="aufnahme-formular">
        <h2 className="mb-s3 text-h2 text-text">{t.aufnahmeHinzufuegen}</h2>
        <p className="mb-s4 max-w-prose text-base text-text-muted">{t.ohneOrtsdaten}</p>
        {sperre !== null ? <Hinweis text={sperre} marke="erfassung-zu" />
          : verbunden ? (
          /*
            Ein echtes multipart-`<form>` ohne JavaScript. `capture="environment"`
            oeffnet auf dem Telefon direkt die rueckwaertige Kamera; auf einem
            Rechner bleibt es ein Dateifeld.
          */
          <form
            method="post"
            encType="multipart/form-data"
            action={`/api/mein/schichten/${zuordnungId}/fotos`}
            className="flex max-w-prose flex-col gap-s4"
          >
            <input
              type="hidden"
              name="zurueck"
              value={`/portal/mein/schichten/${zuordnungId}/fotos`}
            />
            <div className="flex flex-col gap-s2">
              <label htmlFor="foto-datei" className="text-base text-text">
                {t.aufnahmeHinzufuegen} <span aria-hidden="true">*</span>
                <span className="sr-only">{t.pflichtfeld}</span>
              </label>
              <input
                id="foto-datei"
                name="datei"
                type="file"
                accept="image/*,video/*"
                capture="environment"
                required
                className={eingabe}
              />
            </div>
            <div className="flex flex-col gap-s2">
              <label htmlFor="foto-beschreibung" className="text-base text-text">
                {t.beschreibung}
              </label>
              <input id="foto-beschreibung" name="beschreibung" className={eingabe} />
            </div>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                         px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
            >
              {t.absenden}
            </button>
          </form>
        ) : (
          /*
            Kein Knopf, der scheitert. Ohne verbundenen Speicher entstuende
            keine Zeile und keine Datei — ein Formular hier waere die
            Behauptung, es koenne klappen.
          */
          <p data-cse="kein-upload" className="m-0 max-w-prose text-base text-text-muted">
            {t.nichtVerbunden}
          </p>
        )}
      </section>
    </MeinRahmen>
  );
}
