import Link from 'next/link';
import { Geraetezeit } from '../../Geraetezeit';
import { notFound } from 'next/navigation';
import {
  findeEigeneDienstanweisung, type EigeneDienstanweisung,
} from '@/server/services/mitarbeiter/dienstanweisungen';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Feld, Felder, Gesellschaft } from '../../bausteine';

/**
 * `/portal/mein/dienstanweisungen/[id]` — lesen und mit EINEM Tipp bestätigen
 * (EMP-09, EMP-12, SEC-06, Abnahme 2).
 *
 * **Ein Knopf, eine Seite, kein Skript.** Das Formular ist ein echtes
 * `<form method="post">`: es funktioniert auf einem alten Diensttelefon ohne
 * JavaScript, und der Knopf ist 44 px hoch und so breit wie die Spalte — die
 * Wache trägt Handschuhe.
 *
 * **Der Text steht ganz, nicht in einem Auszug.** Wer bestätigt, soll gelesen
 * haben, was er bestätigt; ein „mehr anzeigen" wäre die Stelle, an der genau
 * das nicht passiert.
 *
 * **Die Sprache wird BENANNT** (EMP-12). Liegt keine Übersetzung vor, steht
 * die deutsche Fassung da — und darüber der Satz, dass es die deutsche ist.
 * Ein stiller Rückfall hiesse, dass jemand, der kein Deutsch liest, eine
 * Unterschrift unter einen Text setzt, von dem die Oberfläche behauptet, er
 * sei seiner.
 *
 * **Die Prüfsumme steht unter dem Text.** Sie ist der Digest, den die
 * Bestätigung kopiert (`bestaetigter_inhalt_hash`, §6.10) — der Beweis steht
 * damit auf beiden Seiten desselben Vorgangs.
 */
export const dynamic = 'force-dynamic';

export default async function MeineDienstanweisung(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ergebnis = await meinPortal<EigeneDienstanweisung | null>(
    `/portal/mein/dienstanweisungen/${id}`,
    async (kontext, basis) => findeEigeneDienstanweisung(kontext, basis.sprache, id),
  );
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  // Kein 403: eine fremde Anweisung ist für diese Anmeldung nicht vorhanden
  // (AUT-06).
  if (ergebnis.daten === null) notFound();

  const { basis, daten } = ergebnis;
  const t = basis.texte;

  return (
    <MeinRahmen basis={basis} titel={daten.titel} aktiverTab="heute">
      <Link
        href="/portal/mein/dienstanweisungen"
        className="mb-s4 inline-block min-h-11 text-base text-text underline"
      >
        ← {t.dienstanweisungen}
      </Link>

      <div className="mb-s3 flex flex-wrap items-center gap-s3">
        <Gesellschaft slug={daten.mandantSlug} name={daten.mandantName} />
        <span className={`text-base ${daten.offen ? 'text-warning' : 'text-text-muted'}`}>
          {daten.offen
            ? (daten.bestaetigteVersion === null ? t.nichtBestaetigt : t.neueFassung)
            : `${t.bestaetigtAm} ${daten.bestaetigtLokal ?? ''}`}
        </span>
      </div>

      <h1 className="mb-s4 text-h1 text-text">{daten.titel}</h1>

      <section className="mb-s5 rounded-lg border border-line bg-surface p-s4">
        <Felder>
          <Feld label={t.objekt}>{daten.objekt ?? '—'}</Feld>
          <Feld label={t.fassung}>
            <span className="cse-zahl">{daten.version}</span>
          </Feld>
          <Feld label={t.giltAb}>
            <span className="cse-zahl">{daten.gueltigAb}</span>
          </Feld>
          {daten.naechsteSchichtLokal !== null && (
            <Feld label={t.vorNaechsterSchicht}>
              <span className="cse-zahl">{daten.naechsteSchichtLokal}</span>
            </Feld>
          )}
        </Felder>
      </section>

      {!daten.uebersetzt && basis.sprache !== 'de' && (
        <p
          className="mb-s4 rounded-lg border border-line bg-surface p-s4 text-base text-text-muted"
          data-cse="nur-deutsch"
        >
          {t.nurAufDeutsch}
        </p>
      )}

      <article
        lang={daten.angezeigteSprache}
        data-cse="anweisungstext"
        className="mb-s5 whitespace-pre-wrap rounded-lg border border-line bg-surface
                   p-s4 text-base text-text"
      >
        {daten.inhalt ?? '—'}
      </article>

      <p className="mb-s5 break-all text-micro text-text-subtle">
        <span className="mb-s1 block uppercase tracking-[0.08em]">{t.pruefsumme}</span>
        <span className="cse-zahl" data-cse="inhalt-hash">{daten.inhaltHash}</span>
      </p>

      {daten.offen ? (
        <form
          method="post"
          action={`/api/mein/dienstanweisungen/${daten.id}/kenntnisnahme`}
          data-cse="kenntnisnahme-formular"
        >
          <input type="hidden" name="fassung" value={daten.versionId} />
          <input type="hidden" name="sprache" value={daten.angezeigteSprache} />
          <input type="hidden" name="zurueck" value="/portal/mein/dienstanweisungen" />
          {/*
            EIN Tipp — und der Knopf ist so breit wie die Spalte und 44 px hoch
            (DESIGN §8).
          */}
          {/*
            * **Die Gerätezeit fehlte hier ganz** (V-060).
            *
            * `bestaetigeKenntnisnahme` nimmt sie seit je entgegen und legt
            * sie in `geraete_zeit` ab; dieses Formular schickte keine, und
            * darunter stand als Begründung „die Zeit stempelt der Server".
            * Das stimmt — und ist nicht der Punkt: die Serverzeit IST
            * massgeblich, und die Gerätezeit steht daneben, damit eine
            * Abweichung auffällt. Eine Kenntnisnahme, die ein Telefon mit
            * falsch gestellter Uhr um Mitternacht absendet, sieht sonst aus
            * wie jede andere.
            */}
          <Geraetezeit marke="geraetezeit" />
          <button
            type="submit"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md
                       bg-brand px-s5 py-s3 text-base font-semibold text-white
                       hover:bg-brand-hover"
          >
            {t.bestaetigen}
          </button>
        </form>
      ) : (
        <p
          className="rounded-lg border border-line bg-surface p-s4 text-base text-text"
          data-cse="schon-bestaetigt"
        >
          {t.bestaetigtAm} <span className="cse-zahl">{daten.bestaetigtLokal}</span>
          {daten.bestaetigteVersion !== null && (
            <>
              {' · '}
              {t.fassung} <span className="cse-zahl">{daten.bestaetigteVersion}</span>
            </>
          )}
        </p>
      )}
    </MeinRahmen>
  );
}
