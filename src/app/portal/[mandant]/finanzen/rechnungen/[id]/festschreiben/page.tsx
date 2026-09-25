import type postgres from 'postgres';
import Link from 'next/link';
import { alsVerweis } from '@/lib/verweis';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { DataTable } from '@/components/ui/DataTable';
import { Hinweis } from '@/components/ui/Hinweis';
import { cent, formatiereGeld } from '@/server/services/finanz/geld';
import { pruefeRechnung, type PflichtfeldBericht } from '@/server/services/finanz/ustg14';
import {
  FIN18_BEGRUENDUNG_MINDESTLAENGE, pruefeZeiterfassung, type Fin18Befund,
} from '@/server/services/finanz/positionsquelle';
import { offeneAbschlaege, offeneAbschlaegeSatz } from '@/server/services/finanz/abschlag/index';
import { kreise, type Kreis } from '@/server/services/finanz/kreisuebersicht';
import type { BereichSchluessel } from '@/lib/design/theme';
import { mandantTor, MandantAntwort } from '@/app/portal/unterseite';
import { kennungOder404 } from '@/app/portal/kennung';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache } from '@/lib/i18n/verwaltung/basis';
import { RECHNUNG_AKTE_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnung-akte';

/**
 * `/portal/[mandant]/finanzen/rechnungen/[id]/festschreiben` — **das
 * Einwegtor** (04-SEITENKARTE.md §5.14, FIN-02, FIN-03, FIN-06, LEG-01,
 * Invariante 4).
 *
 * **Ein eigener Bildschirm und kein Knopf am Rand.** Was hier passiert, ist
 * unumkehrbar: die Nummer wird aus dem lückenlosen Kreis gezogen, der
 * Kettensatz geschrieben, der Beleg unveränderlich. Danach gibt es nur noch
 * den Storno. Ein Übergang dieser Art gehört auf eine Seite, die nichts
 * anderes tut — und die vorher in Zahlen zeigt, was gleich in die Bücher
 * geht.
 *
 * **Die Seite zeigt KEINE Nummer und keine Vorschau darauf.** Ein Entwurf,
 * der eine reservierte Nummer hielte, ist genau die Konstruktion, durch die
 * Lücken entstehen. Sichtbar ist der Kreis, der sie ziehen WIRD, mit
 * Bezeichnung, Maske und Zähler — die Nummer selbst entsteht erst in der
 * Transaktion, unter `SELECT … FOR UPDATE`.
 *
 * **Jeder `fehler` des §14-Berichts hält an, und zwar hier.** Er wird mit
 * Regel, Feld und Sprungziel genannt; die ganze Liste, nicht der erste
 * Eintrag. Warnungen stehen daneben und halten nicht an — eine Warnung, die
 * wie ein Fehler aussieht, wird entweder ignoriert oder sie hält jemanden
 * auf, der weitergehen darf.
 *
 * **FIN-18 erscheint VOR der Nummernvergabe.** Sie lässt sich nur mit einer
 * protokollierten Begründung von mindestens zehn Zeichen übergehen, und die
 * Begründung steht in DIESEM Formular: ein eigener „Warnung bestätigen"-Knopf
 * wäre ein Klick, den man sich angewöhnt.
 *
 * **Die Seite rechnet nichts selbst.** Summen kommen aus `rechnung` und
 * `rechnung_steuer`, der Bericht aus `services/finanz/ustg14.ts`, die offenen
 * Abschläge aus `services/finanz/abschlag` — dieselben Dienste, die die
 * Festschreibung hinter der Zeilensperre ruft. Eine zweite Rechnung in einer
 * Komponente wäre die, die abweicht.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Festschreiben — Rechnung' };

/*
 * Eine Kennung, kein Wort: der Name der Datenbankfunktion lautet in beiden
 * Sprachen gleich und wird deshalb nicht uebersetzt.
 */
const FN_NUMMER_ZIEHEN = 'fin.rechnung_nummer_ziehen';

interface Kopf {
  readonly id: string;
  readonly nummer: string | null;
  readonly status: string;
  readonly rechnungsart: string;
  readonly kunde: string;
  readonly rechnungsdatum: string | null;
  readonly leistung_von: string | null;
  readonly leistung_bis: string | null;
  readonly netto_gesamt_cent: string;
  readonly steuer_gesamt_cent: string;
  readonly brutto_cent: string;
  readonly abzug_brutto_cent: string;
  readonly einbehalt_bauabzugsteuer_cent: string;
  readonly ueberweisungsbetrag_cent: string;
  readonly zahlbetrag_cent: string;
  readonly bauabzugsteuer_pflichtig: boolean;
  readonly bauabzugsteuer_satz_bp: number | null;
  readonly reverse_charge: boolean;
  readonly steuerhinweis: string | null;
  readonly positionen: number;
}

interface Steuerzeile {
  readonly gruppe: string;
  readonly satz_bp: number;
  readonly netto_cent: string;
  readonly steuer_cent: string;
}

function Befundliste(
  { titel, befunde, ton, leerText, linkText, mandant }: {
    readonly titel: string;
    readonly befunde: PflichtfeldBericht['fehler'];
    readonly ton: 'fehler' | 'warnung';
    readonly leerText: string;
    /* Die Beschriftung des Sprungziels — in der Sprache der Sitzung. */
    readonly linkText: string;
    readonly mandant: string;
  },
) {
  return (
    <section className="mb-s5" data-cse={`festschreiben-${ton}`}>
      <h2 className="mb-s3 text-h3 text-text">{titel}</h2>
      {befunde.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {leerText}
        </p>
      ) : (
        <ul className="m-0 list-none space-y-s3 p-0">
          {befunde.map((b, i) => (
            <li
              key={`${b.feld}-${String(i)}`}
              className="rounded-lg border border-line bg-surface p-s5"
            >
              <p className="m-0 flex flex-wrap items-baseline gap-s3">
                <span
                  className={`text-sm font-semibold ${
                    ton === 'fehler' ? 'text-danger' : 'text-warning'}`}
                >
                  {b.feld}
                </span>
                <span className="text-xs text-text-muted">{b.regel}</span>
              </p>
              <p className="m-0 mt-s2 max-w-prose text-sm text-text">{b.textDe}</p>
              {b.link === null ? null : (
                <p className="m-0 mt-s2">
                  <Link
                    href={alsVerweis(b.link)}
                    className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
                  >
                    {linkText}
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* `mandant` wird nur gebraucht, wenn ein Befund kein Sprungziel trägt
          — dann führt der Weg zurück auf den Entwurf. */}
      <span hidden data-cse="festschreiben-bereich" data-mandant={mandant} />
    </section>
  );
}

export default async function Festschreibeblatt(
  { params }: { params: Promise<{ mandant: string; id: string }> },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const tor = await mandantTor(
    `/portal/${mandant}/finanzen/rechnungen/${id}/festschreiben`, mandant);
  if (tor.art !== 'ok') return <MandantAntwort tor={tor} />;
  const { zugang } = tor;
  const { sitzung } = zugang;

  /*
   * Diese Seite öffnet mit `finanzen.festschreiben`; der Entwurf daneben
   * verlangt `finanzen.lesen`. Wer festschreiben darf, darf nicht
   * zwangsläufig den Beleg öffnen — der Zurück-Verweis führte dann auf 404
   * und verriete, was er verbirgt (AUT-06, D-581).
   */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(RECHNUNG_AKTE_TEXTE, zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const [kopf] = await kontext.abfrage<Kopf>(
        `select r.id, r.nummer, r.status::text as status,
                r.rechnungsart::text as rechnungsart, k.name as kunde,
                to_char(r.rechnungsdatum, 'DD.MM.YYYY') as rechnungsdatum,
                to_char(r.leistung_von, 'DD.MM.YYYY') as leistung_von,
                to_char(r.leistung_bis, 'DD.MM.YYYY') as leistung_bis,
                r.netto_gesamt_cent::text, r.steuer_gesamt_cent::text,
                r.brutto_cent::text, r.abzug_brutto_cent::text,
                r.einbehalt_bauabzugsteuer_cent::text,
                r.ueberweisungsbetrag_cent::text, r.zahlbetrag_cent::text,
                r.bauabzugsteuer_pflichtig, r.bauabzugsteuer_satz_bp,
                r.reverse_charge, r.steuerhinweis,
                (select count(*) from rechnungsposition p
                  where p.mandant_id = r.mandant_id and p.rechnung_id = r.id)::int
                  as positionen
           from rechnung r
           join kunde k on k.mandant_id = r.mandant_id and k.id = r.kunde_id
          where r.id = $1`, [id]);
      if (kopf === undefined) {
        return { kopf: null, steuer: [], bericht: null, fin18: null, offen: null, kreise: [] };
      }
      return {
        kopf,
        steuer: await kontext.abfrage<Steuerzeile>(
          `select g.bezeichnung as gruppe, s.satz_bp,
                  s.netto_cent::text, s.steuer_cent::text
             from rechnung_steuer s
             join steuersatz_gruppe g on g.id = s.steuersatz_gruppe_id
            where s.rechnung_id = $1
            order by s.satz_bp desc, g.bezeichnung`, [id]),
        bericht: await pruefeRechnung(kontext, id),
        fin18: await pruefeZeiterfassung(kontext, id),
        /*
         * FIN-08: eine Schlussrechnung mit einem noch nicht abgezogenen
         * Abschlag wird nicht festgeschrieben. Der Satz nennt die NUMMERN —
         * „es fehlt etwas" ist keine Auskunft, mit der jemand arbeiten kann.
         */
        offen: offeneAbschlaegeSatz(await offeneAbschlaege(kontext, id)),
        kreise: await kreise(kontext),
      };
    })) as Promise<{
      kopf: Kopf | null;
      steuer: readonly Steuerzeile[];
      bericht: PflichtfeldBericht | null;
      fin18: Fin18Befund | null;
      offen: string | null;
      kreise: readonly Kreis[];
    }>);

  const k = daten.kopf;
  const bericht = daten.bericht;
  if (k === null || bericht === null) notFound();

  const entwurf = k.status === 'entwurf';
  /*
   * **Der Kreis, der die Nummer ziehen WIRD — und das ist immer
   * `ausgangsrechnung`.**
   *
   * Hier stand `k.rechnungsart === 'storno' ? 'gutschrift' : 'ausgangsrechnung'`.
   * `fin.rechnung_nummer_ziehen` wählt aber unabhängig von der Rechnungsart:
   *
   *     where nk.kreis_typ = 'ausgangsrechnung'
   *       and nk.kontext_id is null
   *       and nk.geschlossen_am is null
   *
   * Der Seed legt keinen `gutschrift`-Kreis an. Die Seite fand also für jede
   * Stornorechnung `null`, schrieb „für Gutschriften ist kein offener
   * Nummernkreis eingerichtet" und sperrte den Knopf — mit einem Grund, den
   * es nicht gibt, während die Stornoseite daneben das Gegenteil sagt („zieht
   * seine eigene Nummer aus demselben Kreis"). Zwei Stellen mit derselben
   * Regel sind eine zu viel; wenn ein Gutschriftenkreis eingeführt wird,
   * gehört die Wahl in `fin.rechnung_nummer_ziehen`, und diese Seite liest sie
   * von dort.
   *
   * **`kontextId === null` steht ausdrücklich dabei.**
   * `nummernkreis_offen_key` ist `(mandant_id, kreis_typ, kontext_id) where
   * geschlossen_am is null` — mehrere offene Kreise desselben Typs mit
   * verschiedenem `kontext_id` sind also erlaubt. Ohne diese Bedingung zeigte
   * die Seite Maske und Zähler eines Kreises, der die Nummer nicht zieht.
   */
  const kreis = daten.kreise.find(
    (kr) => kr.kreisTyp === 'ausgangsrechnung'
      && kr.kontextId === null && kr.geschlossenAm === null) ?? null;

  const blockierend = bericht.fehler.length > 0;
  const keinePositionen = k.positionen === 0;
  const kreisSperrt = kreis === null || !kreis.vergabeMoeglich;
  const abschlagSperrt = daten.offen !== null;
  const moeglich = entwurf && !blockierend && !keinePositionen && !kreisSperrt
    && !abschlagSperrt;

  const feld = 'mt-s2 block min-h-11 w-full max-w-prose rounded-md border '
    + 'border-line bg-surface-3 p-s3 text-sm text-text';

  return (
    <PortalRahmen
      /* Auch der RUECKWEG steht unter dem Recht seines Ziels (AUT-06):
         ein Pfeil auf eine Seite, die der Benutzer nicht oeffnen darf,
         fuehrt auf ein 404 — und verraet damit, dass es sie gibt. */
      {...(darf['finanzen.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/finanzen/rechnungen/${id}`, text: k.nummer ?? t.entwurfOhneNummer } }
        : {})}
      titel={t.festschreibenTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >

      <h1 className="mb-s3 text-h1 text-text">{t.festschreibenH1}</h1>

      {entwurf ? (
        <Hinweis art="warnung" cse="festschreiben-warnung" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.warnungTeil1}{' '}
            <strong>{t.warnungBetont}</strong> {t.warnungTeil2}{' '}
            <strong className="text-text">{t.danachUnveraenderlich}</strong>{' '}
            {t.warnungTeil3}
          </p>
        </Hinweis>
      ) : (
        <Hinweis art="hinweis" cse="festschreiben-schon-fest" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.belegIst}{' '}
            {k.status === 'verworfen' ? t.zustandVerworfen : t.zustandFestgeschrieben}
            {k.nummer === null ? '' : ` ${t.undTraegtNummer} ${k.nummer}`}
            {t.nichtsMehrFestzuschreiben}
          </p>
        </Hinweis>
      )}

      <h2 className="mb-s3 text-h2 text-text">{t.wasUnumkehrbar}</h2>

      <dl className="mb-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-text-muted">{t.empfaenger}</dt>
          <dd className="text-sm text-text">{k.kunde}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.rechnungsdatum}</dt>
          <dd className="text-sm text-text">{k.rechnungsdatum ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.leistungszeitraum}</dt>
          <dd className="text-sm text-text">
            {k.leistung_von === null && k.leistung_bis === null
              ? '—'
              : `${k.leistung_von ?? '—'} – ${k.leistung_bis ?? '—'}`}
          </dd>
        </div>
      </dl>

      {daten.steuer.length === 0 ? (
        <p className="mb-s5 rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.keineSteuerzeile}
        </p>
      ) : (
        <DataTable
          beschriftung={t.tabelleSteuer}
          zeilen={daten.steuer}
          schluessel={(z) => `${z.gruppe}-${String(z.satz_bp)}`}
          spalten={[
            { schluessel: 'gruppe', kopf: t.steuersatzgruppe, zelle: (z) => z.gruppe },
            {
              schluessel: 'satz', kopf: t.satz, numerisch: true,
              zelle: (z) => `${(z.satz_bp / 100).toLocaleString('de-DE')} %`,
            },
            {
              schluessel: 'netto', kopf: t.netto, numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.netto_cent))),
            },
            {
              schluessel: 'steuer', kopf: 'USt', numerisch: true,
              zelle: (z) => formatiereGeld(cent(BigInt(z.steuer_cent))),
            },
          ]}
        />
      )}

      <dl
        data-cse="festschreiben-summen"
        className="mb-s5 mt-s5 grid grid-cols-1 gap-s4 rounded-lg border border-line bg-surface p-s5 sm:grid-cols-2"
      >
        <div>
          <dt className="text-xs text-text-muted">{t.nettoGesamt}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.netto_gesamt_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.ustGesamt}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.steuer_gesamt_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.brutto}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">
            {t.abzugFrueherer}
          </dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.abzug_brutto_cent)))}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">
            {t.bauabzugsteuer48}
            {k.bauabzugsteuer_satz_bp === null
              ? '' : ` (${String(k.bauabzugsteuer_satz_bp / 100)} %)`}
          </dt>
          <dd className="cse-zahl text-sm text-text">
            {k.bauabzugsteuer_pflichtig
              ? formatiereGeld(cent(BigInt(k.einbehalt_bauabzugsteuer_cent)))
              : t.keinEinbehalt}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t.zahlbetragKunde}</dt>
          <dd className="cse-zahl text-sm text-text">
            {formatiereGeld(cent(BigInt(k.zahlbetrag_cent)))}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-text-muted">
            {t.ueberweisungsbetrag}
          </dt>
          <dd className="cse-zahl text-base text-text">
            {formatiereGeld(cent(BigInt(k.ueberweisungsbetrag_cent)))}
          </dd>
        </div>
        {k.reverse_charge ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-text-muted">{t.steuerhinweis13b}</dt>
            <dd className="max-w-prose text-sm text-text">{k.steuerhinweis ?? '—'}</dd>
          </div>
        ) : null}
      </dl>

      <h2 className="mb-s3 text-h2 text-text">{t.kreisTitel}</h2>
      {kreis === null ? (
        <Hinweis art="warnung" cse="festschreiben-kein-kreis" className="mb-s5">
          <p className="m-0 max-w-prose">
            {t.keinKreisVor} <strong>{t.ausgangsrechnungen}</strong>{' '}
            {t.keinKreisMitte}{' '}
            <code>{FN_NUMMER_ZIEHEN}</code> {t.keinKreisNach}
          </p>
        </Hinweis>
      ) : (
        <div
          data-cse="festschreiben-kreis"
          data-platzhalter={String(kreis.istPlatzhalter)}
          className={`mb-s5 rounded-lg border p-s5 text-sm ${
            kreis.vergabeMoeglich
              ? 'border-line bg-surface text-text'
              : 'border-warning bg-warning-soft text-warning'}`}
        >
          <p className="m-0">
            <strong className="text-text">{kreis.bezeichnung}</strong> · {t.maske}{' '}
            <code className="text-xs">{kreis.formatMaske}</code> · {t.ruecksetzung}{' '}
            {kreis.zuruecksetzung ?? t.nichtFestgelegt} ·{' '}
            {kreis.lueckenlos ? t.lueckenlos : t.nichtLueckenlos} · {t.zaehlerStehtBei}{' '}
            <span className="cse-zahl">{kreis.naechsteNummer}</span>
          </p>
          <p className="m-0 mt-s2 max-w-prose text-text-muted">
            {t.nummerEntstehtSpaeter}
          </p>
          {kreis.vergabeGrund === null ? null : (
            <p className="m-0 mt-s2 max-w-prose">{kreis.vergabeGrund}</p>
          )}
        </div>
      )}

      <Befundliste
        titel={t.blockierendTitel}
        befunde={bericht.fehler}
        ton="fehler"
        leerText={t.keineBlockierenden}
        linkText={t.dortBeheben}
        mandant={mandant}
      />

      <Befundliste
        titel={t.warnungenTitel}
        befunde={bericht.warnungen}
        ton="warnung"
        leerText={t.keineWarnungen}
        linkText={t.dortBeheben}
        mandant={mandant}
      />

      {daten.offen === null ? null : (
        <Hinweis art="warnung" cse="festschreiben-abschlaege-offen" className="mb-s5">
          <p className="m-0 max-w-prose">{daten.offen}</p>
          <p className="m-0 mt-s2">
            <Link
              href={`/portal/${mandant}/finanzen/rechnungen/${id}/abschlaege`}
              className="text-sm underline underline-offset-2"
            >
              {t.abschlaegeAnsehen}
            </Link>
          </p>
        </Hinweis>
      )}

      {!entwurf ? null : (
        <form
          method="post"
          action={`/api/rechnungen/festschreiben?mandant=${mandant}`}
          className="max-w-prose rounded-lg border border-line-strong bg-surface p-s5"
          data-cse="festschreiben-formular"
        >
          <input type="hidden" name="rechnungId" value={k.id} />

          {daten.fin18 === null ? null : (
            <div
              data-cse="festschreiben-fin18"
              className="mb-s5 rounded-md border border-warning bg-warning-soft p-s4 text-sm text-warning"
            >
              <p className="m-0 max-w-prose">
                <strong>{t.fin18Auftrag} {daten.fin18.auftragsnummer}</strong>{' '}
                ({t.zitatAuf}{daten.fin18.bezeichnung}{t.zitatZu}){' '}
                {t.fin18Satz}
              </p>
              <label className="mt-s3 block" htmlFor="fin18Begruendung">
                {t.fin18BegruendungMin}{' '}
                {FIN18_BEGRUENDUNG_MINDESTLAENGE} {t.zeichenKlammer}
              </label>
              <input
                id="fin18Begruendung" name="fin18Begruendung" type="text"
                minLength={FIN18_BEGRUENDUNG_MINDESTLAENGE} className={feld}
              />
              <p className="m-0 mt-s2 text-xs">
                {t.fin18Protokolliert}
              </p>
            </div>
          )}

          {moeglich ? null : (
            <p
              data-cse="festschreiben-gesperrt"
              className="mb-s4 max-w-prose text-sm text-warning"
            >
              {keinePositionen
                ? t.gesperrtKeinePosition
                : blockierend
                  ? `${t.gesperrtBlockiertVor} ${String(bericht.fehler.length)} `
                    + t.gesperrtBlockiertNach
                  : abschlagSperrt
                    ? t.gesperrtAbschlag
                    : t.gesperrtKreis}
            </p>
          )}

          {/*
            * **Kein Knopf, wenn nicht festgeschrieben werden kann** — und
            * nicht ein ausgegrauter.
            *
            * Ein `disabled`-Knopf erklärt nichts: er sieht aus wie ein
            * Vorgang, der gleich geht, und lässt den Grund suchen. Der Grund
            * steht direkt darüber, benannt und einzeln — Platzhalterkreis,
            * geschlossener Kreis, offener Abschlag (FIN-08) oder
            * blockierender §14-Befund. Dasselbe Prinzip hält die
            * Verwerfen-Seite („keine Löschung, kein ausgegrauter Knopf").
            */}
          {moeglich ? (
            <button
              type="submit"
              className="min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
              data-cse="festschreiben-knopf"
            >
              {t.rechnungFestschreiben}
            </button>
          ) : null}
        </form>
      )}

      <p className="mt-s5 max-w-prose text-xs text-text-muted">
        {t.regelwerk} {bericht.regelwerkVersion}{t.regelwerkHinweis}
      </p>
    </PortalRahmen>
  );
}
