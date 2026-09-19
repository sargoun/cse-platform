import type postgres from 'postgres';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db, SCHNAPPSCHUSS } from '@/server/db/pool';
import { withTenant } from '@/server/kontext/index';
import { PortalRahmen } from '@/components/portal/PortalRahmen';
import { StatusPill } from '@/components/ui/StatusPill';
import {
  HINDERNIS_TEXT, findeAufmass, ladeFotos, ladeSignaturen, ladeVorlageStand, ladeZeilen,
  pruefeVorlage,
  type AufmassKopfZeile, type AufmassZeileZeile, type FotoZeile, type SignaturZeile,
  type VorlageHindernis, type VorlageStand,
} from '@/server/services/bau/aufmass';
import { ladeAusserhalbLvJeBlatt, type AusserhalbLvWarnung }
  from '@/server/services/bau/ausserhalb-lv';
import { AUFMASS_PILLE, AUFMASS_STATUS_TEXT, ERHEBUNGSART_TEXT } from '../../../../aufmass-anzeige';
import { AufmassZeilenBlock, MessfotoBlock, SignaturBlock } from '../../../../AufmassTeile';
import { AusserhalbLvWarnungen } from '../../../../AusserhalbLvWarnungen';
import { AnmeldungNoetig } from '../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../zugang';
import { haeltRechte } from '@/app/portal/rechte';
import { slugTor } from '../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../../kennung';

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
  kennungOder404(id);
  kennungOder404(aufmassId);
  const pfad = `/portal/${mandant}/bau/projekte/${id}/aufmass/${aufmassId}`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  const darf = await haeltRechte(sitzung, 'bau.aufmass_freigeben');

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
        <span className="inline-flex flex-wrap items-center gap-s2">
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
      {/* Formel und Ergebnis — nebeneinander (BAU-02). Der Block steht in     */}
      {/* AufmassTeile.tsx, weil die Freigabeseite denselben zeigen MUSS:      */}
      {/* zwei Abschriften liefen auseinander, und dann zeigte die Seite, auf  */}
      {/* der unterschrieben wird, etwas anderes als die, auf der geprueft     */}
      {/* wird (§10.4).                                                        */}
      {/* ------------------------------------------------------------------ */}
      <AufmassZeilenBlock zeilen={daten.zeilen} />
      <MessfotoBlock fotos={daten.fotos} />

      <section>
        <h2 className="mb-s3 text-h3 text-text">Gegenzeichnung</h2>

        <SignaturBlock signaturen={daten.signaturen} />

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
        ) : darf['bau.aufmass_freigeben'] === true ? (
          /**
           * **Ein Weg und kein Formular.** Das Gegenzeichnungsformular stand
           * hier, und diese Seite ist mit `bau.lesen` bewacht — der Endpunkt
           * dahinter verlangt `bau.aufmass_freigeben`. Wer nur lesen durfte,
           * sah den Knopf und bekam beim Abschicken 403. Genau dagegen ist
           * `haeltRechte` da (AUT-06): ein Menuepunkt, der auf einen Fehler
           * fuehrt, ist schlechter als keiner. Das Formular steht jetzt unter
           * `…/freigabe`, und diese Route traegt das Recht an der Tuer.
           */
          <p
            className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
            data-cse="zur-freigabe"
          >
            Das Blatt ist bereit zur Gegenzeichnung.{' '}
            <Link
              href={`/portal/${mandant}/bau/projekte/${id}/aufmass/${aufmassId}/freigabe`}
              className="text-brand underline-offset-2 hover:underline"
            >
              Zur Gegenzeichnung
            </Link>
            {' '}— dort stehen die Zeilen, die eingefroren werden, und das
            Unterschriftsfeld.
          </p>
        ) : (
          <p
            className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
            data-cse="freigabe-fremd"
          >
            Das Blatt ist bereit zur Gegenzeichnung. Sie feststellen zu lassen
            ist ein eigenes Recht (<code>bau.aufmass_freigeben</code>) — wer ein
            Blatt aufnimmt, stellt damit noch nicht fest, dass der Auftraggeber
            es anerkannt hat.
          </p>
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
