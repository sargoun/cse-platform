import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Rechenvorschau } from '@/components/bau/Rechenvorschau';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { berlinHeute } from '@/server/db/heute';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { versucheRechenansatz } from '@/server/services/bau/rechenansatz';
import {
  findeProjekt, gruppiereLvAuswahl, ladeLvAuswahl,
  type LvAuswahlZeile, type ProjektZeile,
} from '@/server/services/bau/lv';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../../kennung';
import { haeltRechte } from '../../../../../../rechte';

/**
 * `/portal/[mandant]/bau/projekte/[id]/aufmass/neu` — ein Aufmass aufnehmen
 * (BAU-02, BAU-03).
 *
 * **Formel und Ergebnis stehen nebeneinander, und beide kommen vom Server.**
 * Das Probefeld schickt den Rechenansatz als GET an dieselbe Seite; gerechnet
 * wird in `services/bau/rechenansatz.ts`. Im Browser zu rechnen hiesse, zwei
 * Parser zu haben — und der zweite waere der, den niemand prueft. Dann zeigt
 * das Formular eine Zahl und die Datenbank speichert eine andere, und beide
 * sehen richtig aus.
 *
 * **Ohne Messfoto geht das Blatt nicht weiter.** Die Aufnahme faehrt mit dem
 * Formular, weil der Zustand „Blatt ohne Foto" genau dann entsteht, wenn die
 * Kraft die Baustelle schon verlassen hat (BAU-03).
 *
 * Die Seite kommt ohne JavaScript aus. Das ist keine Sparsamkeit: sie wird auf
 * einem Telefon im Rohbau benutzt, und eine Seite, die erst nach einem
 * Skriptdownload rechnet, rechnet dort gar nicht.
 */
export const dynamic = 'force-dynamic';

export default async function AufmassAufnehmen(
  { params, searchParams }: {
    params: Promise<{ mandant: string; id: string }>;
    searchParams: Promise<{ probe?: string; einheit?: string }>;
  },
) {
  const { mandant, id } = await params;
  kennungOder404(id);
  const { probe = '', einheit = 'm²' } = await searchParams;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/aufmass/neu`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  /* AUT-06: die Blattliste `…/aufmass` verlangt laut Manifest `bau.lesen`,
     dieses Blatt nur `bau.aufmass_erfassen` — eine Kraft vor Ort haelt das
     eine und nicht das andere, und „Abbrechen" fuehrte sie auf ein 404. Ein
     Verweis auf 404 verraet, was er nicht zeigen darf (Copilot-Runde auf
     PR 16 / D-581). */
  const darf = await haeltRechte(sitzung, 'bau.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const projekt = await findeProjekt(kontext, id);
      if (projekt === null) return null;
      return { projekt, positionen: await ladeLvAuswahl(kontext, id) };
    }),
  ) as Promise<{ projekt: ProjektZeile; positionen: readonly LvAuswahlZeile[] } | null>);

  if (daten === null) notFound();

  // „Heute" kommt aus der DATENBANK, nie aus der Uhr des Node-Prozesses:
  // zwischen Mitternacht und 02:00 Berliner Zeit ist der UTC-Tag der gestrige.
  const heute = await berlinHeute();
  const gerechnet = probe.trim() === '' ? null : versucheRechenansatz(probe);
  const gruppen = gruppiereLvAuswahl(daten.positionen);

  return (
    <PortalRahmen
      titel="Aufmaß aufnehmen"
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5">
        <h1 className="m-0 text-h1 text-text">Aufmaß aufnehmen</h1>
        <p className="m-0 mt-s1 text-sm text-text-muted">
          {daten.projekt.nummer} · {daten.projekt.bezeichnung} · {daten.projekt.kunde}
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Das Probefeld: Formel hinein, Ergebnis daneben.                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6 rounded-lg border border-line bg-surface p-s5" data-cse="probe">
        <h2 className="m-0 mb-s2 text-h3 text-text">Rechenansatz prüfen</h2>
        <p className="m-0 mb-s4 max-w-prose text-sm text-text-muted">
          Erlaubt sind Ziffern mit deutschem Dezimalkomma, <code>+</code>,{' '}
          <code>−</code>, <code>×</code> (auch <code>x</code> oder <code>*</code>)
          und Klammern. Alles andere wird abgewiesen — mit der Stelle, an der es
          steht. Abzüge nach VOB/C rechnet die Anwendung <strong>nicht</strong>{' '}
          automatisch: gerechnet wird genau das, was hier steht.
        </p>
        <form method="get" className="flex flex-wrap items-end gap-s3">
          <label className="min-w-[20rem] flex-1">
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Rechenansatz
            </span>
            <input
              name="probe"
              defaultValue={probe}
              placeholder="3 × (4,20 × 2,75) − 2 × (0,90 × 2,10)"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
          </label>
          <label className="w-28">
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Einheit
            </span>
            <input
              name="einheit"
              defaultValue={einheit}
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
          </label>
          <Button type="submit" variante="secondary">Berechnen</Button>
        </form>

        {gerechnet !== null && (
          gerechnet.ok ? (
            <p className="m-0 mt-s4 text-base text-text" data-cse="probe-ergebnis">
              <span className="font-mono text-sm text-text-muted">{gerechnet.ergebnis.formel}</span>
              {' = '}
              <strong className="tabular-nums">
                {gerechnet.ergebnis.anzeige} {einheit}
              </strong>
              <span className="ml-s3 text-xs text-text-subtle">
                gespeichert als {gerechnet.ergebnis.skaliert.toString()} (Skala 10⁻⁴)
              </span>
            </p>
          ) : (
            <p className="m-0 mt-s4 text-sm text-danger" data-cse="probe-fehler">
              {gerechnet.meldung} (Zeichen {gerechnet.offset + 1})
            </p>
          )
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Das Blatt selbst.                                                   */}
      {/* ------------------------------------------------------------------ */}
      <form
        action="/api/bau/aufmasse"
        method="post"
        encType="multipart/form-data"
        className="rounded-lg border border-line bg-surface p-s5"
        data-cse="aufmass-formular"
      >
        <input type="hidden" name="projekt" value={id} />
        <input type="hidden" name="mandant" value={mandant} />

        <div className="grid gap-s4 md:grid-cols-2">
          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Bezeichnung
            </span>
            <input
              name="bezeichnung"
              required
              placeholder="Wand Achse C, OG1"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
          </label>
          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Bereich (Bauteil, Geschoss, Achse)
            </span>
            <input
              name="bereich"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
          </label>
          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Messdatum
            </span>
            <input
              type="date"
              name="messdatum"
              required
              defaultValue={heute}
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            />
          </label>
          <label>
            <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
              Erhebungsart
            </span>
            <select
              name="erhebungsart"
              defaultValue="gemeinsam"
              className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
            >
              <option value="gemeinsam">gemeinsam (§ 14 Abs. 1 VOB/B)</option>
              <option value="einseitig">einseitig (§ 14 Abs. 2 VOB/B)</option>
            </select>
          </label>
        </div>

        <fieldset className="mt-s5 border-0 p-0">
          <legend className="mb-s2 text-h3 text-text">Zeilen</legend>
          <p className="m-0 mb-s3 max-w-prose text-sm text-text-muted">
            Eine Zeile je Messung. Die Menge rechnet der Server aus dem
            Rechenansatz — sie wird nicht eingetippt, damit im Streitfall
            feststeht, dass die Zahl aus der Formel stammt.
          </p>
          {[0, 1, 2].map((n) => (
            <div key={n} className="mb-s3 grid gap-s3 md:grid-cols-[1fr_2fr_6rem_1fr]">
              <input
                name={`zeile_bezeichnung_${String(n)}`}
                placeholder="Bezeichnung"
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              />
              {/*
                * **Das lebende Feld** (BAU-02).
                *
                * `POST /api/bau/aufmasse/vorschau` stand seit BAU-02 im Baum,
                * mit einem Kommentar, der genau dieses Feld beschreibt — und
                * im ganzen Quelltext rief die Route niemand. Der Satz über
                * diesem Block versprach „die Menge rechnet der Server", und
                * sehen konnte man das erst nach dem Absenden. Jetzt steht das
                * Ergebnis daneben, und zwar GERECHNET VOM SERVER: ein zweiter
                * Parser im Browser wäre der, den niemand prüft.
                */}
              <Rechenvorschau
                name={`zeile_rechenansatz_${String(n)}`}
                einheitName={`zeile_einheit_${String(n)}`}
                cse={`zeile-rechenansatz-${String(n)}`}
              />
              <select
                name={`zeile_lv_${String(n)}`}
                defaultValue=""
                className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
              >
                <option value="">außerhalb des LV (BAU-05)</option>
                {/*
                  * Gruppiert nach Verzeichnis und Fassung: eine OZ des
                  * Hauptauftrags und dieselbe OZ eines Nachtrags stehen sonst
                  * als zwei gleich beschriftete Zeilen nebeneinander, und
                  * welche gemeint war, entschied die Reihenfolge.
                  * `ladeLvAuswahl` liefert je Verzeichnis nur die JUENGSTE
                  * lebende Fassung — eine überholte Position ist keine
                  * Buchungsstelle mehr.
                  */}
                {gruppen.map((g) => (
                  <optgroup key={g.schluessel} label={g.beschriftung}>
                    {g.zeilen.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.oz} · {p.kurztext}{p.ungeprueft ? ' (ungeprüft)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          ))}
        </fieldset>

        <label className="mt-s5 block">
          <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
            Messfotos (Pflicht für die Vorlage — BAU-03)
          </span>
          <input
            type="file"
            name="fotos"
            multiple
            accept="image/jpeg,image/png,image/webp,image/heic"
            className="block w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
          />
          <span className="mt-s1 block text-xs text-text-subtle">
            Die Aufnahmen werden ohne Metadaten in einem privaten Speicher
            abgelegt; erreichbar sind sie nur über eine befristete Adresse.
          </span>
        </label>

        <div className="mt-s5 flex flex-wrap items-center gap-s3">
          <Button type="submit" variante="secondary">Aufmaß speichern</Button>
          {darf['bau.lesen'] === true && (
            <Link
              href={`/portal/${mandant}/bau/projekte/${id}/aufmass`}
              className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
            >
              Abbrechen
            </Link>
          )}
        </div>
      </form>
    </PortalRahmen>
  );
}
