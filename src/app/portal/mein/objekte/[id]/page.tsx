import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  listeEigeneSchichtenAufObjekt, type EigeneSchicht,
} from '@/server/services/mitarbeiter/schichten';
import {
  anschriftZeile, findeEigenesObjekt, leseObjektZugang, zugangIstLeer,
  type EigenerObjektZugang, type EigenesObjekt,
} from '@/server/services/mitarbeiter/objekte';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { kennungOder404 } from '../../../kennung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft, Hinweis, Leer, SchichtKarte } from '../../bausteine';

/**
 * `/portal/mein/objekte/[id]` — Anschrift, Zutritt und Ansprechpartner
 * (EMP-02, OPS-01, SEC-05, SEC-06, K-05).
 *
 * ===========================================================================
 * Der Zutritt ist der heikle Teil
 * ===========================================================================
 *
 * Ein Schluessel- oder Alarmcode gehoert dem, der dort eingeteilt IST — und
 * nur, solange er es ist. Diese Seite ERFINDET diese Regel nicht, sie benutzt
 * die, die schon in der Datenbank steht:
 *
 *     app.mein_objekt_zugang(objekt)          (0360)
 *       → app.ist_eingesetzt_auf_objekt(o)    (0069)
 *       → eigene, lebende Zuordnung auf einem Einsatz,
 *         der noch nicht zu Ende ist
 *
 * Dieselbe Funktion traegt `objekt.t_selbst_m1` (0300) und
 * `leistungsnachweis.p_portal_decke`. Eine zweite Bedingung in dieser Datei —
 * „ist die naechste Schicht heute?" — waere die, die irgendwann etwas anderes
 * sagt als die Policy: die Kraft saehe einen Code fuer ein Objekt, auf dem die
 * Planung sie nicht mehr fuehrt.
 *
 * **Warum das Ausbleiben einen SATZ bekommt.** Ein leeres Feld liest sich wie
 * „es ist nichts hinterlegt", und mit dieser Auskunft steht jemand vor einer
 * verschlossenen Tuer und sucht nicht weiter. Die Seite unterscheidet deshalb
 * drei Lagen, und zwar in Worten:
 *
 *   · eingeteilt, Hinweis vorhanden       → der Hinweis
 *   · eingeteilt, nichts hinterlegt       → „kein Zutrittshinweis hinterlegt"
 *   · nicht (mehr) eingeteilt             → „nur solange Sie eingeteilt sind"
 *
 * **Kein Kunde, kein Auftrag, kein Preis** (EMP-13, K-05). Der Ansprechpartner
 * steht mit Namen und Telefonnummer da, weil er die Tuer aufmacht — nicht mit
 * seiner Firma, seiner Rolle im Vertrieb oder seiner Mailadresse.
 * // TODO(client, O-853): Welche Kontaktangaben des Objekt-Ansprechpartners
 * darf die eingeteilte Kraft sehen — Name und Festnetz, oder auch die
 * Mobilnummer? Heute zeigt die Seite beide Nummern, sofern hinterlegt.
 *
 * **Ohne JavaScript bedienbar**, 44-px-Ziele, Fliesstext nie unter 16 px: das
 * Diensttelefon im Treppenhaus ist kein schmaler Schreibtisch (SPEC §10,
 * DESIGN §8).
 */
export const dynamic = 'force-dynamic';

interface Blatt {
  readonly objekt: EigenesObjekt;
  readonly zugang: EigenerObjektZugang | null;
  readonly schichten: readonly EigeneSchicht[];
}

export default async function MeinObjektBlatt(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  kennungOder404(id);

  const ergebnis = await meinPortal<Blatt | null>(
    `/portal/mein/objekte/${id}`,
    async (kontext) => {
      const objekt = await findeEigenesObjekt(kontext, id);
      if (objekt === null) return null;
      return {
        objekt,
        zugang: await leseObjektZugang(kontext, id),
        schichten: await listeEigeneSchichtenAufObjekt(kontext, id),
      };
    },
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  // Ein fremdes Objekt gibt dieselbe Antwort wie ein unbekanntes: 404 (AUT-06).
  if (ergebnis.daten === null) notFound();

  const { basis } = ergebnis;
  const { objekt: o, zugang, schichten } = ergebnis.daten;
  const t = basis.texte;

  /*
   * `null` heisst „nicht eingeteilt" (die Funktion gibt dann keine Zeile
   * heraus); eine Zeile mit lauter leeren Feldern heisst „eingeteilt, aber
   * nichts hinterlegt". Das sind zwei verschiedene Auskuenfte, und die
   * Seite gibt sie auch als zwei.
   */
  const darfZutrittSehen = zugang !== null;
  const zutrittLeer = zugang !== null && zugangIstLeer(zugang);

  return (
    <MeinRahmen basis={basis} titel={o.bezeichnung} aktiverTab="heute">
      <Link
        href="/portal/mein/objekte"
        className="mb-s4 inline-flex min-h-11 items-center text-base text-text underline"
      >
        ← {t.objekte}
      </Link>

      <div className="mb-s4 flex flex-wrap items-center gap-s3">
        <Gesellschaft slug={o.mandantSlug} name={o.mandantName} />
        {o.aktuellEingeteilt && (
          <>
            <StatusPill zustand="Aktiv" />
            <span data-cse="eingeteilt" className="text-base text-text">
              {t.aktuellEingeteilt}
            </span>
          </>
        )}
        {o.archiviert && <StatusPill zustand="Archiviert" />}
      </div>

      <h1 className="mb-s5 text-h1 text-text">{o.bezeichnung}</h1>

      <section
        data-cse="objekt-angaben"
        className="mb-s5 rounded-lg border border-line bg-surface p-s4"
      >
        <Felder>
          <Feld label={t.anschrift}>{anschriftZeile(o)}</Feld>
          <Feld label={t.objektnummer}>
            <span className="cse-zahl">{o.objektnummer}</span>
          </Feld>
          {o.gebaeudetyp !== null && <Feld label={t.gebaeudetyp}>{o.gebaeudetyp}</Feld>}
          {o.etagenAnzahl !== null && (
            <Feld label={t.etagen}>
              <span className="cse-zahl">{String(o.etagenAnzahl)}</span>
            </Feld>
          )}
          {o.naechsteSchichtLokal !== null && (
            <Feld label={t.naechsteSchicht}>
              <span className="cse-zahl">{o.naechsteSchichtLokal}</span>
            </Feld>
          )}
          {o.letzteSchichtLokal !== null && (
            <Feld label={t.letzteSchicht}>
              <span className="cse-zahl">{o.letzteSchichtLokal}</span>
            </Feld>
          )}
        </Felder>
      </section>

      <section
        data-cse="zutritt"
        data-sichtbar={darfZutrittSehen ? 'ja' : 'nein'}
        className="mb-s5 rounded-lg border border-line bg-surface-2 p-s4"
      >
        <h2 className="mb-s3 text-h3 text-text">{t.zutritt}</h2>

        {!darfZutrittSehen && (
          <>
            <p data-cse="nicht-eingeteilt" className="m-0 mb-s2 max-w-prose text-base text-text">
              {t.nichtMehrEingeteilt}
            </p>
            <Hinweis text={t.zutrittNurWaehrendEinteilung} marke="zutritt-regel" />
          </>
        )}

        {darfZutrittSehen && zutrittLeer && (
          <Leer text={t.keinZutrittHinterlegt} />
        )}

        {darfZutrittSehen && !zutrittLeer && (
          <>
            {zugang.zutrittHinweis !== null && (
              <p
                data-cse="zutritt-hinweis"
                className="m-0 mb-s4 max-w-prose whitespace-pre-line text-base text-text"
              >
                {zugang.zutrittHinweis}
              </p>
            )}
            {(zugang.ansprechpartnerName !== null
              || zugang.ansprechpartnerTelefon !== null
              || zugang.ansprechpartnerMobil !== null) && (
              <div data-cse="ansprechpartner">
                <h3 className="mb-s2 text-h3 text-text">{t.ansprechpartner}</h3>
                <Felder>
                  {zugang.ansprechpartnerName !== null && (
                    <Feld label={t.ansprechpartner}>{zugang.ansprechpartnerName}</Feld>
                  )}
                  {zugang.ansprechpartnerTelefon !== null && (
                    <Feld label={t.telefon}>
                      {/*
                        * `tel:` und nicht nur Text: auf einem Diensttelefon ist
                        * das der Unterschied zwischen anrufen und abtippen —
                        * und es braucht kein Skript dafuer.
                        */}
                      <a
                        href={`tel:${zugang.ansprechpartnerTelefon.replace(/[^+0-9]/gu, '')}`}
                        className="inline-flex min-h-11 items-center text-text underline"
                      >
                        <span className="cse-zahl">{zugang.ansprechpartnerTelefon}</span>
                      </a>
                    </Feld>
                  )}
                  {zugang.ansprechpartnerMobil !== null && (
                    <Feld label={t.mobil}>
                      <a
                        href={`tel:${zugang.ansprechpartnerMobil.replace(/[^+0-9]/gu, '')}`}
                        className="inline-flex min-h-11 items-center text-text underline"
                      >
                        <span className="cse-zahl">{zugang.ansprechpartnerMobil}</span>
                      </a>
                    </Feld>
                  )}
                </Felder>
              </div>
            )}
            <p className="mt-s4 m-0 max-w-prose text-base text-text-muted">
              {t.zutrittNurWaehrendEinteilung}
            </p>
          </>
        )}
      </section>

      <section data-cse="schichten-hier">
        <h2 className="mb-s3 text-h3 text-text">{t.meineSchichtenHier}</h2>
        {schichten.length === 0 ? <Leer text={t.keineSchicht} /> : (
          <ul className="m-0 flex list-none flex-col gap-s3 p-0">
            {schichten.map((s) => (
              <li key={s.zuordnungId}>
                <SchichtKarte schicht={s} texte={t} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </MeinRahmen>
  );
}
