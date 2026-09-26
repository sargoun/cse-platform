import {
  leseAbwesenheitsarten, leseAntragsarten,
  type AbwesenheitsartWahl, type AntragsartWahl,
} from '@/server/services/mitarbeiter/antraege';
import {
  artEinreichbar, listeTauschbareSchichten, TAUSCHPARTNER_QUELLE,
  type TauschbareSchicht, type TauschpartnerWahl,
} from '@/server/services/mitarbeiter/tausch';
import { ANTRAG_FORM_TEXTE } from '@/lib/i18n/mein-formulare';
import { eigenerEintrag } from '@/lib/nachschlagen';
import { vorbelegt } from '@/lib/formular/maske';
import { tagDeutsch } from '@/lib/datum/kalendertag';
import { AnmeldungNoetig } from '../../../Anmeldung';
import { meinPortal, MeinRahmen } from '../../rahmen';
import { Abgewiesen, Leer } from '../../bausteine';

/**
 * `/portal/mein/antraege/neu` — Urlaub oder Schichttausch beantragen (EMP-10).
 *
 * **Die Beschaeftigung ist eine PFLICHTWAHL und kein Vorgabewert.** Ein Mensch
 * mit zwei Arbeitsverhaeltnissen beantragt Urlaub bei EINER Gesellschaft; der
 * Anspruch besteht gegen sie, sie genehmigt, ihr Urlaubskonto wird belastet
 * (D-09). Eine geratene Vorauswahl waere ein Antrag bei der falschen GmbH —
 * und er saehe genauso aus wie ein richtiger. Wer nur eine Beschaeftigung hat,
 * sieht trotzdem das Feld: ein Formular, das sich je nach Datenlage anders
 * verhaelt, ist zweimal zu testen und einmal falsch.
 *
 * **Der Mandant steht NICHT im Formular.** Er wird serverseitig aus der
 * gewaehlten Beschaeftigung abgeleitet (K-02, Invariante 3) — ein Feld waere
 * genau die Stelle, an der jemand eine fremde Gesellschaft einsetzt.
 *
 * **Ein echtes `<form method="post">`.** Der Bildschirm muss auf einem alten
 * Diensttelefon funktionieren, also ohne JavaScript (SEITENKARTE §13).
 *
 * **Jedes Feld, das eine Art verlangt, steht da — und sagt, fuer welche Art**
 * (V-187). Vorher bot die Seite den Schichttausch an und fragte weder nach
 * der Schicht noch nach dem Partner; jeder Tauschantrag endete am Ausloeser
 * `antrag_pflichtfelder` als rohe 500, und auch ein Urlaubsantrag ohne
 * Zeitraum. Ohne JavaScript kann die Seite ein Feld nicht erst nach der Wahl
 * der Art zeigen; sie markiert es deshalb als Pflicht, wenn JEDE angebotene
 * Art es verlangt, und sonst mit „Pflicht bei: …". Geprueft wird ohnehin im
 * Dienst (`reicheAntragEin`), und eine Abweisung kommt als Satz auf diese
 * Maske zurueck, mit den gewaehlten Werten.
 *
 * **Eine Art, die hier nicht erfuellbar ist, steht nicht in der Auswahl,
 * sondern als Satz darunter.** Heute ist das der Schichttausch: wen eine
 * Kraft als Tauschpartner sehen darf, ist offen (O-925,
 * `TAUSCHPARTNER_QUELLE`). Eine Auswahl, die an der Datenbank scheitert,
 * waere schlechter als der Satz, an wen man sich wendet.
 */
export const dynamic = 'force-dynamic';

interface Daten {
  readonly antragsarten: readonly AntragsartWahl[];
  readonly abwesenheitsarten: readonly AbwesenheitsartWahl[];
  readonly schichten: readonly TauschbareSchicht[];
  /** Je Gesellschaft die anbietbaren Tauschpartner — leer ohne festgelegte Quelle. */
  readonly partner: readonly { readonly gesellschaft: string; readonly wahl: readonly TauschpartnerWahl[] }[];
}

/** Die Bezeichnungen der Arten, die eine Bedingung erfuellen, als eine Zeile. */
function artenMit(arten: readonly AntragsartWahl[], bedingung: (a: AntragsartWahl) => boolean): string {
  return arten.filter(bedingung).map((a) => a.bezeichnung).join(', ');
}

export default async function NeuerAntrag(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const suche = await searchParams;
  const ergebnis = await meinPortal<Daten>('/portal/mein/antraege/neu',
    async (kontext, basis) => {
      const quelle = TAUSCHPARTNER_QUELLE;
      const partner: { gesellschaft: string; wahl: readonly TauschpartnerWahl[] }[] = [];
      if (quelle.festgelegt) {
        for (const a of basis.anstellungen) {
          partner.push({ gesellschaft: a.mandantName, wahl: await quelle.lese(kontext, a.anstellungId) });
        }
      }
      return {
        antragsarten: await leseAntragsarten(kontext, basis.sprache),
        abwesenheitsarten: await leseAbwesenheitsarten(kontext, basis.sprache),
        schichten: await listeTauschbareSchichten(kontext),
        partner,
      };
    });
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;

  const { basis, daten } = ergebnis;
  const t = basis.texte;
  const ft = ANTRAG_FORM_TEXTE[basis.sprache];
  const eingabe =
    'min-h-11 w-full rounded-md border border-line-strong bg-surface px-s3 py-s2 '
    + 'text-base text-text';

  const fehler = vorbelegt(suche, 'fehler');
  const satz = fehler === undefined ? null : (eigenerEintrag(ft.gruende, fehler) ?? ft.unbekannt);

  const angeboten = daten.antragsarten.filter((a) => artEinreichbar(a));
  const nichtMoeglich = daten.antragsarten.filter((a) => !artEinreichbar(a));
  const jede = (b: (a: AntragsartWahl) => boolean): boolean =>
    angeboten.length > 0 && angeboten.every(b);
  const manche = (b: (a: AntragsartWahl) => boolean): boolean => angeboten.some(b);

  /** Eine Vorbelegung zaehlt nur, wenn die Auswahl den Wert anbietet (D-733). */
  const gewaehlt = (feld: string, angebot: readonly string[]): string | undefined => {
    const wert = vorbelegt(suche, feld);
    return wert !== undefined && angebot.includes(wert) ? wert : undefined;
  };
  const datum = (feld: string): string | undefined => {
    const wert = vorbelegt(suche, feld);
    return wert !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(wert) ? wert : undefined;
  };

  const zeitraumPflicht = jede((a) => a.erfordertZeitraum);
  const zeitraumHinweis = !zeitraumPflicht && manche((a) => a.erfordertZeitraum)
    ? ft.pflichtBei(artenMit(angeboten, (a) => a.erfordertZeitraum)) : null;
  const artPflicht = jede((a) => a.erfordertAbwesenheitsart);
  const artHinweis = !artPflicht && manche((a) => a.erfordertAbwesenheitsart)
    ? ft.pflichtBei(artenMit(angeboten, (a) => a.erfordertAbwesenheitsart)) : null;
  const schichtNoetig = manche((a) => a.erfordertEinsatz);
  const schichtPflicht = jede((a) => a.erfordertEinsatz);
  const partnerNoetig = manche((a) => a.erfordertTauschpartner);
  const partnerPflicht = jede((a) => a.erfordertTauschpartner);

  const pflichtMarke = (
    <>
      {' '}<span aria-hidden="true">*</span>
      <span className="sr-only">{t.pflichtfeld}</span>
    </>
  );

  return (
    <MeinRahmen basis={basis} titel={t.antragNeu} aktiverTab="heute"
      zurueck={{ ziel: "/portal/mein/antraege", text: t.antraege }}
    >
      <h1 className="mb-s5 text-h1 text-text">{t.antragNeu}</h1>

      {satz !== null && (
        <Abgewiesen
          marke="antrag-abgewiesen"
          titel={ft.nichtGesendet}
          text={satz}
          zusatz={vorbelegt(suche, 'nachricht_neu') === 'ja' ? ft.nachrichtErneut : null}
        />
      )}

      {basis.anstellungen.length === 0 || angeboten.length === 0
        ? <Leer text={t.keineEintraege} />
        : (
        <form
          method="post"
          action="/api/mein/antraege"
          data-cse="antrag-formular"
          className="flex max-w-prose flex-col gap-s4"
        >
          <input type="hidden" name="zurueck" value="/portal/mein/antraege" />

          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-anstellung" className="text-base text-text">
              {t.gesellschaft}{pflichtMarke}
            </label>
            <select id="antrag-anstellung" name="anstellung" required className={eingabe}
              defaultValue={gewaehlt('anstellung', basis.anstellungen.map((a) => a.anstellungId)) ?? ''}>
              {/* Keine Vorauswahl (D-09): `required` verlangt die Wahl. */}
              <option value="">{t.gesellschaftWaehlen}</option>
              {basis.anstellungen.map((a) => (
                <option key={a.anstellungId} value={a.anstellungId}>
                  {a.mandantName}
                  {a.personalnummer === null ? '' : ` · ${a.personalnummer}`}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-art" className="text-base text-text">
              {t.antragArt}{pflichtMarke}
            </label>
            <select id="antrag-art" name="antragsart" required className={eingabe}
              defaultValue={gewaehlt('antragsart', angeboten.map((a) => a.id))}>
              {angeboten.map((a) => (
                <option key={a.id} value={a.id}>{a.bezeichnung}</option>
              ))}
            </select>
          </div>

          {/*
            Welche Art welche Felder verlangt, prueft der Dienst und dahinter
            der Ausloeser `antrag_pflichtfelder` (0074). Die Seite SAGT es nur
            — eine Oberflaechenregel, die die Datenbank nicht kennt, waere eine
            Regel, die der zweite Weg umgeht.
          */}
          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-abwesenheitsart" className="text-base text-text">
              {t.abwesenheitArt}{artPflicht && pflichtMarke}
            </label>
            <select id="antrag-abwesenheitsart" name="abwesenheitsart" className={eingabe}
              required={artPflicht}
              defaultValue={gewaehlt('abwesenheitsart', daten.abwesenheitsarten.map((a) => a.id)) ?? ''}>
              <option value="">—</option>
              {daten.abwesenheitsarten.map((a) => (
                <option key={a.id} value={a.id}>{a.bezeichnung}</option>
              ))}
            </select>
            {artHinweis !== null && (
              <p className="m-0 text-base text-text-muted" data-cse="pflicht-abwesenheitsart">{artHinweis}</p>
            )}
          </div>

          <div className="grid gap-s4 sm:grid-cols-2">
            <div className="flex flex-col gap-s2">
              <label htmlFor="antrag-von" className="text-base text-text">
                {t.von}{zeitraumPflicht && pflichtMarke}
              </label>
              <input id="antrag-von" name="von" type="date" className={eingabe}
                required={zeitraumPflicht} defaultValue={datum('von')} />
            </div>
            <div className="flex flex-col gap-s2">
              <label htmlFor="antrag-bis" className="text-base text-text">
                {t.bis}{zeitraumPflicht && pflichtMarke}
              </label>
              <input id="antrag-bis" name="bis" type="date" className={eingabe}
                required={zeitraumPflicht} defaultValue={datum('bis')} />
            </div>
            {zeitraumHinweis !== null && (
              <p className="m-0 text-base text-text-muted sm:col-span-2" data-cse="pflicht-zeitraum">
                {zeitraumHinweis}
              </p>
            )}
          </div>

          {schichtNoetig && (
            <div className="flex flex-col gap-s2">
              <label htmlFor="antrag-einsatz" className="text-base text-text">
                {ft.schicht}{schichtPflicht && pflichtMarke}
              </label>
              {daten.schichten.length === 0 ? (
                <p className="m-0 text-base text-text-muted" data-cse="keine-kommende-schicht">
                  {ft.keineKommendeSchicht}
                </p>
              ) : (
                <select id="antrag-einsatz" name="einsatz" className={eingabe}
                  required={schichtPflicht}
                  defaultValue={gewaehlt('einsatz', daten.schichten.map((s) => s.einsatzId)) ?? ''}>
                  <option value="">{ft.schichtWaehlen}</option>
                  {daten.schichten.map((s) => (
                    <option key={s.einsatzId} value={s.einsatzId}>
                      {tagDeutsch(s.tag)} · {s.beginnUhrzeit}–{s.endeUhrzeit}
                      {s.endetAmFolgetag ? ` ${ft.folgetag}` : ''}
                      {s.objekt === null ? '' : ` · ${s.objekt}`} · {s.mandantName}
                    </option>
                  ))}
                </select>
              )}
              {!schichtPflicht && (
                <p className="m-0 text-base text-text-muted" data-cse="pflicht-schicht">
                  {ft.pflichtBei(artenMit(angeboten, (a) => a.erfordertEinsatz))}
                </p>
              )}
            </div>
          )}

          {partnerNoetig && (
            <div className="flex flex-col gap-s2">
              <label htmlFor="antrag-tauschpartner" className="text-base text-text">
                {ft.tauschpartner}{partnerPflicht && pflichtMarke}
              </label>
              <select id="antrag-tauschpartner" name="tauschpartner" className={eingabe}
                required={partnerPflicht}
                defaultValue={gewaehlt('tauschpartner',
                  daten.partner.flatMap((g) => g.wahl.map((p) => p.anstellungId))) ?? ''}>
                <option value="">{ft.tauschpartnerWaehlen}</option>
                {daten.partner.map((g) => (
                  <optgroup key={g.gesellschaft} label={g.gesellschaft}>
                    {g.wahl.map((p) => (
                      <option key={p.anstellungId} value={p.anstellungId}>{p.anzeigename}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {!partnerPflicht && (
                <p className="m-0 text-base text-text-muted" data-cse="pflicht-tauschpartner">
                  {ft.pflichtBei(artenMit(angeboten, (a) => a.erfordertTauschpartner))}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-s2">
            <label htmlFor="antrag-nachricht" className="text-base text-text">
              {t.nachricht}
            </label>
            <textarea id="antrag-nachricht" name="nachricht" rows={3} className={eingabe} />
          </div>

          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand
                       px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
          >
            {t.absenden}
          </button>
        </form>
      )}

      {nichtMoeglich.length > 0 && (
        <p className="mt-s5 max-w-prose text-base text-text-muted" data-cse="antrag-nicht-moeglich">
          {ft.nichtMoeglich(nichtMoeglich.map((a) => a.bezeichnung).join(', '))}
        </p>
      )}
    </MeinRahmen>
  );
}
