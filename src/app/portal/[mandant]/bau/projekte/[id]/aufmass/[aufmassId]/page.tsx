import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  HINDERNIS_TEXT, findeAufmass, ladeFotos, ladeSignaturen, ladeVorlageStand, ladeZeilen,
  pruefeVorlage, formatiereErgebnis,
  type AufmassKopfZeile, type AufmassZeileZeile, type FotoZeile, type SignaturZeile,
  type VorlageHindernis, type VorlageStand,
} from '@/server/services/bau/aufmass';
import { ladeAusserhalbLvJeBlatt, type AusserhalbLvWarnung }
  from '@/server/services/bau/ausserhalb-lv';
import { AUFMASS_PILLE, AUFMASS_STATUS_TEXT, ERHEBUNGSART_TEXT } from '../../../../aufmass-anzeige';
import { AusserhalbLvWarnungen } from '../../../../AusserhalbLvWarnungen';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';

/**
 * `/portal/[mandant]/bau/projekte/[id]/aufmass/[aufmassId]` — ein Blatt mit
 * Formel, Ergebnis, Fotos und Gegenzeichnung (BAU-02, BAU-03).
 *
 * **Der Rechenansatz steht NEBEN dem Ergebnis, nicht dahinter.** Das ist die
 * Zusage von BAU-02 und der Grund, warum beide gespeichert werden: ein Pruefer
 * soll sehen, WIE die Menge entstanden ist, ohne sie nachrechnen zu muessen —
 * und wenn er nachrechnet, soll dasselbe herauskommen.
 *
 * **Die Gegenzeichnung erscheint nur, wenn sie moeglich ist.** Fehlt ein
 * Messfoto oder zeigt eine Zeile auf eine ungepruefte, maschinell gelesene
 * LV-Position, steht hier der Satz, WAS fehlt — statt eines Knopfes, der
 * einen Datenbankfehler ausloest.
 */
export const dynamic = 'force-dynamic';

export default async function AufmassBlatt(
  { params }: { params: Promise<{ mandant: string; id: string; aufmassId: string }> },
) {
  const { mandant, id, aufmassId } = await params;
  const pfad = `/portal/${mandant}/bau/projekte/${id}/aufmass/${aufmassId}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={mandant} zielSlug={tor.ziel} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const kopf = await findeAufmass(kontext, aufmassId);
      if (kopf === null) return null;
      return {
        kopf,
        zeilen: await ladeZeilen(kontext, aufmassId),
        fotos: await ladeFotos(kontext, aufmassId),
        signaturen: await ladeSignaturen(kontext, aufmassId),
        stand: await ladeVorlageStand(kontext, aufmassId),
        // BAU-05: welche Zeile dieses Blattes steht in keinem LV und haengt
        // an keinem Nachtrag? Die Frage gehoert hierher, weil das Blatt der
        // Ort ist, an dem sie entsteht.
        ausserhalbLv: await ladeAusserhalbLvJeBlatt(kontext, aufmassId),
      };
    }),
  ) as Promise<{
    kopf: AufmassKopfZeile; zeilen: readonly AufmassZeileZeile[];
    fotos: readonly FotoZeile[]; signaturen: readonly SignaturZeile[];
    stand: VorlageStand | null;
    ausserhalbLv: readonly AusserhalbLvWarnung[];
  } | null>);

  // AUT-06: ein fremdes Blatt ist nicht vorhanden, nicht verboten.
  if (daten === null) notFound();

  const gesperrt = daten.kopf.gesperrt_lokal !== null;
  const hindernisse: readonly VorlageHindernis[] = daten.stand === null
    ? []
    : pruefeVorlage(daten.stand).filter((h) => h !== 'nicht_entwurf');

  return (
    <PortalRahmen
      titel={`Aufmaß ${daten.kopf.nummer}`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      <div className="mb-s5 flex flex-wrap items-start justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">
            Aufmaß {daten.kopf.nummer} · {daten.kopf.bezeichnung}
          </h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.kopf.projekt} · {daten.kopf.kunde}
            {daten.kopf.bereich !== null && ` · ${daten.kopf.bereich}`}
            {' · Messdatum '}{daten.kopf.messdatum_lokal}
            {' · '}{ERHEBUNGSART_TEXT[daten.kopf.erhebungsart] ?? daten.kopf.erhebungsart}
          </p>
        </div>
        <span className="inline-flex items-center gap-s2">
          <StatusPill zustand={AUFMASS_PILLE[daten.kopf.status] ?? 'Entwurf'} />
          <span className="text-sm text-text-muted">
            {AUFMASS_STATUS_TEXT[daten.kopf.status] ?? daten.kopf.status}
          </span>
        </span>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* BAU-05: Leistung ausserhalb des LV — benannt und mit Angebot.       */}
      {/* ------------------------------------------------------------------ */}
      <AusserhalbLvWarnungen
        warnungen={daten.ausserhalbLv}
        mandant={mandant}
        projektId={id}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Formel und Ergebnis — nebeneinander (BAU-02).                       */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Zeilen</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm" data-cse="aufmass-zeilen">
            <caption className="sr-only">
              Aufmaßzeilen mit Rechenansatz und Ergebnis
            </caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">Nr.</th>
                <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">Bezeichnung</th>
                <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">OZ</th>
                <th scope="col" className="px-s4 py-s3 text-micro uppercase tracking-[0.08em] text-text-subtle">Rechenansatz</th>
                <th scope="col" className="px-s4 py-s3 text-right text-micro uppercase tracking-[0.08em] text-text-subtle">Ergebnis</th>
              </tr>
            </thead>
            <tbody>
              {daten.zeilen.map((z) => (
                <tr key={z.id} className="border-b border-line last:border-0" data-cse="aufmass-zeile">
                  <td className="px-s4 py-s3 align-top tabular-nums text-text-muted">{z.reihenfolge}</td>
                  <td className="px-s4 py-s3 align-top text-text">
                    {z.bezeichnung}
                    {z.ausserhalb_lv && (
                      <span className="ml-s2 text-xs text-warning">außerhalb des LV</span>
                    )}
                  </td>
                  <td className="px-s4 py-s3 align-top tabular-nums text-text-muted">{z.oz ?? '—'}</td>
                  {/* Woertlich, wie er aufgeschrieben wurde — nicht normiert. */}
                  <td className="px-s4 py-s3 align-top font-mono text-text-muted" data-cse="rechenansatz">
                    {z.rechenansatz}
                  </td>
                  <td
                    className="px-s4 py-s3 text-right align-top tabular-nums text-text"
                    data-cse="ergebnis"
                    data-skaliert={z.ergebnis_skaliert}
                  >
                    {formatiereErgebnis(z.ergebnis_skaliert, z.einheit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-s2 text-xs text-text-subtle">
          Das Ergebnis wird als ganze Zahl in fester Skala gespeichert
          (10⁻⁴ der Einheit) und aus der Formel berechnet — nicht eingetippt.
          Abzüge nach VOB/C wendet die Anwendung nicht automatisch an (offene
          Frage O-23).
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Fotos (BAU-03).                                                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-s6">
        <h2 className="mb-s3 text-h3 text-text">Messfotos</h2>
        {daten.fotos.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-warning">
            Keine Aufnahme. Ohne Messfoto lässt sich dieses Blatt nicht vorlegen
            und nicht gegenzeichnen (BAU-03).
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {daten.fotos.map((f) => (
              <li
                key={f.id}
                className="mb-s2 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
              >
                <span className="text-text">{f.beschreibung ?? f.mime_typ}</span>
                {' · '}Eingang {f.empfangen_lokal}
                {' · '}Zweck {f.zweck}
                {f.zeitabweichung_sek !== null && Math.abs(f.zeitabweichung_sek) > 60 && (
                  <span className="ml-s2 text-warning">
                    Geräteuhr weicht um {Math.round(f.zeitabweichung_sek / 60)} Min. ab
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-s2 text-xs text-text-subtle">
          Die Aufnahmen liegen ohne Metadaten in einem privaten Speicher. Eine
          Anzeige braucht eine befristet signierte Adresse; ist der Speicher
          nicht verbunden, wird hier nichts angezeigt und nichts vorgetäuscht.
        </p>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Gegenzeichnung (BAU-03).                                            */}
      {/* ------------------------------------------------------------------ */}
      <section>
        <h2 className="mb-s3 text-h3 text-text">Gegenzeichnung</h2>

        {daten.signaturen.length > 0 && (
          <ul className="m-0 mb-s4 list-none p-0">
            {daten.signaturen.map((s) => (
              <li
                key={s.id}
                className="mb-s2 rounded-lg border border-line bg-surface p-s4 text-sm text-text-muted"
                data-cse="signatur"
              >
                <strong className="text-text">{s.unterzeichner_name}</strong>
                {s.unterzeichner_funktion !== null && ` (${s.unterzeichner_funktion})`}
                {' · '}{s.rolle === 'auftraggeber' ? 'Auftraggeber' : 'Auftragnehmer'}
                {' · '}{s.unterzeichnet_lokal}
                {s.vorbehalt !== null && (
                  <span className="ml-s2 text-warning">Vorbehalt: {s.vorbehalt}</span>
                )}
                <span className="mt-s1 block font-mono text-xs text-text-subtle">
                  {/* Der Digest ueber den eingefrorenen Abzug — §10.4. */}
                  SHA-256 {s.snapshot_hash.slice(0, 16)}…
                </span>
              </li>
            ))}
          </ul>
        )}

        {gesperrt ? (
          <p className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted">
            Das Blatt ist seit {daten.kopf.gesperrt_lokal} festgeschrieben und
            unveränderlich. Eine Korrektur ist ein Storno mit Ersatzblatt, keine
            Änderung (§ 14 VOB/B, LEG-01).
          </p>
        ) : hindernisse.length > 0 ? (
          <ul
            className="m-0 list-none rounded-lg border border-line bg-surface p-s5 text-sm text-warning"
            data-cse="hindernisse"
          >
            {hindernisse.map((h) => <li key={h}>{HINDERNIS_TEXT[h]}</li>)}
          </ul>
        ) : (
          <form
            action={`/api/bau/aufmasse/${aufmassId}/gegenzeichnung`}
            method="post"
            className="rounded-lg border border-line bg-surface p-s5"
            data-cse="gegenzeichnung"
          >
            <input type="hidden" name="mandant" value={mandant} />
            <input type="hidden" name="projekt" value={id} />
            <input type="hidden" name="zurueck" value={pfad} />
            <div className="grid gap-s4 md:grid-cols-2">
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Name des Unterzeichners (Auftraggeber)
                </span>
                <input
                  name="unterzeichner_name"
                  required
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
              </label>
              <label>
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Funktion
                </span>
                <input
                  name="unterzeichner_funktion"
                  placeholder="Bauleiter AG"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
              </label>
              <label className="md:col-span-2">
                <span className="mb-s1 block text-micro uppercase tracking-[0.08em] text-text-muted">
                  Vorbehalt (rechtlich erheblich, z. B. „unter Vorbehalt der Prüfung")
                </span>
                <input
                  name="vorbehalt"
                  className="min-h-11 w-full rounded-md border border-line bg-surface-3 px-s3 py-s2 text-sm text-text"
                />
              </label>
            </div>
            <p className="mt-s3 max-w-prose text-xs text-text-subtle">
              Mit der Gegenzeichnung wird das Blatt festgeschrieben: die Zeilen
              werden als Abzug eingefroren und mit SHA-256 gesiegelt. Danach
              ändert sich daran nichts mehr.
            </p>
            <div className="mt-s4">
              <Button type="submit" variante="primary">Gegenzeichnen</Button>
            </div>
          </form>
        )}

        <p className="mt-s4 text-sm">
          <Link
            href={`/portal/${mandant}/bau/projekte/${id}/aufmass`}
            className="text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            Zurück zu den Aufmaßen
          </Link>
        </p>
      </section>
    </PortalRahmen>
  );
}
