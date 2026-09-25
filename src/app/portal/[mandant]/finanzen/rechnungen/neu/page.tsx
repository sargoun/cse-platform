import type postgres from 'postgres';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Hinweis } from '@/components/ui/Hinweis';
import { Recht } from '@/components/ui/Recht';
import { ZAHLUNGSMITTEL } from '@/server/services/finanz/zahlungsmittel';
import { ENTWURF_RECHNUNGSARTEN } from '@/server/services/finanz/rechnung';
import { auftraegeZurAuswahl, type AuftragAuswahl } from '@/server/services/finanz/entwurf';
import { AnmeldungNoetig } from '../../../../Anmeldung';
import { portalZugang } from '../../../../zugang';
import { slugTor } from '../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { haeltRechte } from '@/app/portal/rechte';
import { nachSprache, verwaltungTexte } from '@/lib/i18n/verwaltung/basis';
import { RECHNUNGEN_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnungen';
import { RECHNUNG_ENTWURF_TEXTE } from '@/lib/i18n/verwaltung/finanzen/rechnung-entwurf';
import { vorbelegt } from '@/lib/formular/maske';
import { eigenerEintrag } from '@/lib/nachschlagen';

/**
 * `/portal/[mandant]/finanzen/rechnungen/neu` — der Entwurf entsteht.
 *
 * **Nichts wird geraten.** Kein vorausgefülltes Zahlungsziel (§4.2, O-66):
 * ein `14`, das hier voreingestellt wäre, setzte `faellig_am` auf jeder
 * Rechnung und triebe damit den Mahnlauf und die §288-BGB-Zinsen — ein
 * Produktionswert, den niemand entschieden hat. Bleibt das Feld leer, löst
 * der Dienst auf; findet er nichts, weist die Festschreibung mit benanntem
 * Grund ab.
 *
 * Der Entwurf bekommt hier auch KEINE Nummer. Die entsteht erst beim
 * Festschreiben, und genau deshalb kostet ein verworfener Entwurf keine.
 *
 * **Auftrag und Rechnungsart** (V-205, D-698). Bis dahin entstand hier jeder
 * Entwurf als `standard` ohne Auftrag — Abschlags- und Schlussrechnungen
 * waren unerreichbar, und FIN-18 griff nie. `?auftrag=<id>` belegt die Maske
 * vom Auftragsblatt aus vor; übernommen wird die Kennung nur, wenn sie in der
 * angebotenen Liste steht.
 */
export const dynamic = 'force-dynamic';

interface Auswahl { readonly id: string; readonly name: string }
interface ObjektAuswahl extends Auswahl { readonly kunde_id: string | null }
interface Kreis { readonly bezeichnung: string; readonly ist_platzhalter: boolean;
  readonly format_maske: string }

export default async function NeueRechnung(
  { params, searchParams }: {
    params: Promise<{ mandant: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const { mandant } = await params;
  const suche = await searchParams;
  const zugang = await portalZugang(`/portal/${mandant}/finanzen/rechnungen/neu`);
  if (zugang === null) return <AnmeldungNoetig />;
  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /*
   * `/finanzen/rechnungen` verlangt laut Manifest `finanzen.lesen`; diese
   * Seite oeffnet mit `finanzen.schreiben`. Wer einen Entwurf anlegen darf,
   * darf nicht zwangslaeufig die Liste oeffnen — der Zurueck-Verweis fuehrte
   * dann auf 404 und verriete, was er nicht zeigen darf (AUT-06,
   * Copilot-Runde auf PR 16 / D-581).
   *
   * `auftrag.lesen` entscheidet, ob es eine Auftragsauswahl gibt: wer
   * zuordnet, muss sehen können, was er zuordnet (V-205).
   */
  const darf = await haeltRechte(sitzung, 'finanzen.lesen', 'auftrag.lesen');

  /* Die Sprache dieser Sitzung — nicht die des Pfades (D-419, D-592). */
  const t = nachSprache(RECHNUNGEN_TEXTE, zugang.sprache);
  const e = nachSprache(RECHNUNG_ENTWURF_TEXTE, zugang.sprache);
  const g = verwaltungTexte(zugang.sprache);

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => ({
      kunden: await kontext.abfrage<Auswahl>(
        `select id, name from kunde where archiviert_am is null order by name`),
      objekte: await kontext.abfrage<ObjektAuswahl>(
        `select id, bezeichnung as name, kunde_id from objekt
          where archiviert_am is null order by bezeichnung`),
      auftraege: darf['auftrag.lesen'] === true
        ? await auftraegeZurAuswahl({ abfrage: kontext.abfrage.bind(kontext) })
        : [],
      kreis: (await kontext.abfrage<Kreis>(
        `select bezeichnung, ist_platzhalter, format_maske from nummernkreis
          where mandant_id = app.aktiver_mandant() and kreis_typ = 'ausgangsrechnung'
            and geschlossen_am is null`))[0] ?? null,
    }))) as Promise<{
      kunden: readonly Auswahl[]; objekte: readonly ObjektAuswahl[];
      auftraege: readonly AuftragAuswahl[]; kreis: Kreis | null;
    }>);

  /*
   * Eine abgewiesene Maske kommt mit ihren Eingaben zurück (D-599, V-240);
   * ohne Abweisung belegt höchstens `?auftrag=` vor. Eine Kennung aus der
   * Adresse zählt nur, wenn sie in der angebotenen Liste steht.
   */
  const fehler = typeof suche['fehler'] === 'string' ? suche['fehler'] : null;
  const zurueck = (name: string): string | undefined =>
    fehler === null ? undefined : vorbelegt(suche, name);
  const ausAdresse = vorbelegt(suche, 'auftrag');
  const auftragVor = daten.auftraege.find(
    (a) => a.id === (zurueck('auftragId') ?? ausAdresse));
  const kundeVor = zurueck('kundeId')
    ?? auftragVor?.kundeId;
  const kundeGewaehlt = daten.kunden.some((k) => k.id === kundeVor) ? kundeVor : undefined;
  const objektVor = daten.objekte.some((o) => o.id === zurueck('objektId'))
    ? zurueck('objektId') : undefined;
  const artVor = ENTWURF_RECHNUNGSARTEN.find((a) => a === zurueck('rechnungsart')) ?? 'standard';
  const zahlungsmittelVor = ZAHLUNGSMITTEL.some((z) => z.code === zurueck('zahlungsmittelCode'))
    ? zurueck('zahlungsmittelCode') : '';

  /* Die Aufträge nach Kunden gruppiert: ohne Skript sieht man so, wem was gehört. */
  const nameJeKunde = new Map(daten.kunden.map((k) => [k.id, k.name]));
  const gruppen = [...new Set(daten.auftraege.map((a) => a.kundeId))]
    .map((kid) => ({
      kundeId: kid,
      name: nameJeKunde.get(kid) ?? '—',
      auftraege: daten.auftraege.filter((a) => a.kundeId === kid),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  /*
   * Die Objekte ebenso (V-209): welcher Leistungsort zu welchem Kunden gehört,
   * steht an der Gruppe. Ob ein fremder überhaupt zulässig ist, ist offen
   * (O-933) — abgewiesen wird nur, was der Mensch nicht sehen darf.
   */
  const objektGruppen = [...new Set(daten.objekte.map((o) => o.kunde_id))]
    .map((kid) => ({
      schluessel: kid ?? 'ohne',
      name: (kid === null ? undefined : nameJeKunde.get(kid)) ?? e.objekteOhneKunde,
      objekte: daten.objekte.filter((o) => o.kunde_id === kid),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const feld = 'mt-s2 min-h-11 w-full rounded-md border border-line bg-surface-3 '
    + 'p-s3 text-sm text-text';

  return (
    <PortalRahmen
      /* Auch der RUECKWEG steht unter dem Recht seines Ziels (AUT-06):
         ein Pfeil auf eine Seite, die der Benutzer nicht oeffnen darf,
         fuehrt auf ein 404 — und verraet damit, dass es sie gibt. */
      {...(darf['finanzen.lesen'] === true
        ? { zurueck: { ziel: `/portal/${mandant}/finanzen/rechnungen`, text: t.alleRechnungen } }
        : {})}
      titel={t.neuTitel}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="rechnungen"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <h1 className="mb-s5 text-h1 text-text">{t.neuTitel}</h1>

      {fehler === null ? null : (
        <Hinweis art="warnung" cse="rechnung-neu-fehler" className="mb-s5 max-w-prose">
          <strong>{e.nichtsGespeichert}</strong>{' '}
          {eigenerEintrag(e.fehler, fehler) ?? e.abgewiesen}
        </Hinweis>
      )}

      {/*
        * Der Zustand des Nummernkreises steht VOR dem Formular und nicht nach
        * dem Fehlschlag: wer einen Entwurf baut, den er anschliessend nicht
        * festschreiben kann, hat die Arbeit umsonst gemacht.
        */}
      {daten.kreis === null ? (
        <p className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          {t.keinNummernkreis}
        </p>
      ) : daten.kreis.ist_platzhalter ? (
        <p className="mb-s5 rounded-lg border border-warning bg-warning-soft p-s4 text-sm text-warning">
          {t.platzhalterVor}{daten.kreis.bezeichnung}{t.platzhalterMitte}{' '}
          <code>{daten.kreis.format_maske}</code>{' '}
          {t.platzhalterEnde}
        </p>
      ) : null}

      {daten.kunden.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
          {t.ohneKunden}
        </p>
      ) : (
        <form
          method="post"
          action={`/api/rechnungen?mandant=${mandant}`}
          className="max-w-prose rounded-lg border border-line bg-surface p-s5"
        >
          <input type="hidden" name="aktion" value="anlegen" />
          <input type="hidden" name="zurueck" value={`/portal/${mandant}/finanzen/rechnungen/neu`} />

          <label className="block text-sm text-text" htmlFor="kundeId">{g.kunde}</label>
          <select
            id="kundeId" name="kundeId" required className={feld}
            defaultValue={kundeGewaehlt ?? daten.kunden[0]?.id}
          >
            {daten.kunden.map((k) => (
              <option key={k.id} value={k.id}>{k.name}</option>
            ))}
          </select>

          <label className="mt-s4 block text-sm text-text" htmlFor="rechnungsart">
            {e.rechnungsart}
          </label>
          <select
            id="rechnungsart" name="rechnungsart" required className={feld}
            defaultValue={artVor} data-cse="rechnungsart"
          >
            {ENTWURF_RECHNUNGSARTEN.map((a) => (
              <option key={a} value={a}>{t.artNamen[a]}</option>
            ))}
          </select>
          <p className="mt-s1 text-xs text-text-muted">{e.rechnungsartHinweis}</p>

          <label className="mt-s4 block text-sm text-text" htmlFor="auftragId">{e.auftrag}</label>
          {darf['auftrag.lesen'] === true ? (
            <>
              <select
                id="auftragId" name="auftragId" className={feld} data-cse="rechnung-auftrag"
                defaultValue={auftragVor?.id ?? ''}
              >
                <option value="">{e.ohneAuftrag}</option>
                {gruppen.map((gr) => (
                  <optgroup key={gr.kundeId} label={gr.name}>
                    {gr.auftraege.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.auftragsnummer} · {a.bezeichnung}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-s1 text-xs text-text-muted">{e.auftragHinweis}</p>
            </>
          ) : (
            <p className="mt-s2 text-sm text-text-muted">
              {e.auftraegeVerdeckt} <Recht schluessel="auftrag.lesen" sprache={zugang.sprache} />.
            </p>
          )}

          <label className="mt-s4 block text-sm text-text" htmlFor="objektId">
            {t.leistungsort}
          </label>
          <select id="objektId" name="objektId" className={feld} defaultValue={objektVor ?? ''}>
            <option value="">{t.ohneFestenOrt}</option>
            {objektGruppen.map((gr) => (
              <optgroup key={gr.schluessel} label={gr.name}>
                {gr.objekte.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <div className="mt-s4 grid grid-cols-1 gap-s4 sm:grid-cols-2">
            <div>
              <label className="block text-sm text-text" htmlFor="leistungVon">
                {t.leistungVon}
              </label>
              <input
                id="leistungVon" name="leistungVon" type="date" className={feld}
                defaultValue={zurueck('leistungVon')}
              />
            </div>
            <div>
              <label className="block text-sm text-text" htmlFor="leistungBis">
                {t.leistungBis}
              </label>
              <input
                id="leistungBis" name="leistungBis" type="date" className={feld}
                defaultValue={zurueck('leistungBis')}
              />
            </div>
          </div>
          <p className="mt-s1 text-xs text-text-muted">{e.leistungszeitraumPflicht}</p>

          <label className="mt-s4 block text-sm text-text" htmlFor="vereinnahmungGeplantAm">
            {e.vereinnahmung}
          </label>
          <input
            id="vereinnahmungGeplantAm" name="vereinnahmungGeplantAm" type="date" className={feld}
            defaultValue={zurueck('vereinnahmungGeplantAm')}
          />
          <p className="mt-s1 text-xs text-text-muted">{e.vereinnahmungHinweis}</p>

          <label className="mt-s4 block text-sm text-text" htmlFor="zahlungszielTage">
            {t.zahlungsziel}
          </label>
          <input
            id="zahlungszielTage" name="zahlungszielTage" type="number" min="0" step="1"
            className={feld} defaultValue={zurueck('zahlungszielTage')}
          />
          <p className="mt-s1 text-xs text-text-muted">
            {t.zahlungszielHinweis}
          </p>

          {/*
            * BT-81 (FIN-11) — und ohne dieses Feld war die XRechnung für einen
            * öffentlichen Auftraggeber gar nicht erreichbar: die Vorprüfung
            * verlangt die Angabe (BR-DE-1), und es gab keine Maske, die sie
            * setzt. Gefunden hat das der erste Browsertest, der einen Beleg an
            * das Bezirksamt führen wollte.
            *
            * Kein Vorgabewert, aus demselben Grund wie beim Zahlungsziel: ein
            * stilles „SEPA-Überweisung" behauptete eine Zahlungsart, die
            * niemand vereinbart hat — und sie stünde unveränderlich im Beleg.
            */}
          <label className="mt-s4 block text-sm text-text" htmlFor="zahlungsmittelCode">
            {t.zahlungsart}
          </label>
          <select
            id="zahlungsmittelCode" name="zahlungsmittelCode" className={feld}
            defaultValue={zahlungsmittelVor}
          >
            <option value="">{t.nichtAngegeben}</option>
            {ZAHLUNGSMITTEL.map((z) => (
              <option key={z.code} value={z.code}>
                {z.bezeichnung} ({z.code})
              </option>
            ))}
          </select>
          <p className="mt-s1 text-xs text-text-muted">
            {t.zahlungsartHinweis}
          </p>

          <label className="mt-s4 block text-sm text-text" htmlFor="kopftext">
            {t.kopftext}
          </label>
          <textarea
            id="kopftext" name="kopftext" rows={3} className={feld}
            defaultValue={zurueck('kopftext')}
          />

          <button
            type="submit"
            className="mt-s5 min-h-11 rounded-md bg-brand px-s5 py-s3 text-base font-semibold text-white hover:bg-brand-hover"
          >
            {t.entwurfAnlegen}
          </button>
        </form>
      )}
    </PortalRahmen>
  );
}
