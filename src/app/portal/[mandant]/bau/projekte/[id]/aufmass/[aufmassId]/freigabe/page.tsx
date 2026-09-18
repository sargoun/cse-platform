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
  pruefeVorlage,
  type AufmassKopfZeile, type AufmassZeileZeile, type FotoZeile, type SignaturZeile,
  type VorlageHindernis, type VorlageStand,
} from '@/server/services/bau/aufmass';
import { ladeAusserhalbLvJeBlatt, type AusserhalbLvWarnung }
  from '@/server/services/bau/ausserhalb-lv';
import { AUFMASS_PILLE, AUFMASS_STATUS_TEXT, ERHEBUNGSART_TEXT }
  from '../../../../../aufmass-anzeige';
import { AufmassZeilenBlock, MessfotoBlock, SignaturBlock } from '../../../../../AufmassTeile';
import { AusserhalbLvWarnungen } from '../../../../../AusserhalbLvWarnungen';
import { AnmeldungNoetig } from '../../../../../../../Anmeldung';
import { portalZugang } from '../../../../../../../zugang';
import { slugTor } from '../../../../../../../unterseite';
import { Wechselblatt } from '@/components/portal/Wechselblatt';
import type { BereichSchluessel } from '@/lib/design/theme';
import { kennungOder404 } from '../../../../../../../kennung';
import { haeltRechte } from '@/app/portal/rechte';

/**
 * `/portal/[mandant]/bau/projekte/[id]/aufmass/[aufmassId]/freigabe` — die
 * Gegenzeichnung (BAU-03, Seitenkarte §5.9).
 *
 * **Warum diese Adresse überhaupt existiert.** Das Formular stand auf der
 * Blattansicht, und die ist mit `bau.lesen` bewacht. Wer nur `bau.lesen`
 * hielt, sah den Knopf „Gegenzeichnen" und bekam beim Abschicken 403 vom
 * Endpunkt, der `bau.aufmass_freigeben` verlangt — genau der Fehler, gegen
 * den `src/app/portal/rechte.ts` angelegt wurde: ein Knopf, dessen Ziel
 * dieselbe Sitzung nicht öffnen darf, ist schlechter als keiner. Diese Route
 * trägt `bau.aufmass_freigeben` an der Tür (Route-Register), und die
 * Blattansicht verweist nur noch dorthin — und zwar nur, wenn das Recht
 * gehalten wird.
 *
 * **Sie zeigt, WAS gegengezeichnet wird, bevor jemand unterschreibt.** Kopf,
 * alle Zeilen mit Rechenansatz und Ergebnis, die Nachweisfotos und die
 * bereits vorhandenen Unterschriften mit ihrem Digest. Eine Freigabeseite, die
 * nur ein Namensfeld zeigt, lädt dazu ein, für etwas zu unterschreiben, das
 * man nicht gesehen hat — und der Digest bezeugt danach genau das.
 *
 * **Der Schnappschuss entsteht weiter auf dem Server.** Dieses Formular
 * schickt einen Namen, eine Funktion und einen Vorbehalt — nie Zeilen. Ein
 * Digest über eine vom Browser gelieferte Fassung beglaubigte die manipulierte
 * (K-12, Review B25).
 */
export const dynamic = 'force-dynamic';

export default async function AufmassFreigabe(
  { params }: { params: Promise<{ mandant: string; id: string; aufmassId: string }> },
) {
  const { mandant, id, aufmassId } = await params;
  kennungOder404(id);
  kennungOder404(aufmassId);
  const pfad = `/portal/${mandant}/bau/projekte/${id}/aufmass/${aufmassId}/freigabe`;
  const zugang = await portalZugang(pfad);
  if (zugang === null) return <AnmeldungNoetig />;

  const tor = await slugTor(zugang, mandant);
  if (tor.art === 'wechsel') {
    return <Wechselblatt aktuell={tor.aktuell} zielTitel={tor.zielName ?? mandant} zielSlug={tor.ziel} zurueck={tor.zurueck} />;
  }
  const { sitzung } = zugang;
  if (sitzung.aktiverMandantId === null) notFound();
  /**
   * **Diese Route traegt `bau.aufmass_freigeben`, nicht `bau.lesen`.**
   * `app.hat_recht` loest jeden Schluessel einzeln auf — Gegenzeichnen
   * schliesst Lesen nicht ein, und AUT-03 erlaubt, `bau.lesen` je Mandant zu
   * entziehen. Beide Wege zurueck auf das Aufmassblatt (der Rueckverweis oben
   * und das `zurueck` des Formulars) brauchen deshalb ihre eigene Bedingung,
   * sonst endet die Unterschrift auf einem 404 (D-567, AUT-06).
   */
  const darf = await haeltRechte(sitzung, 'bau.lesen');

  const daten = await (db().begin(SCHNAPPSCHUSS, async (tx: postgres.TransactionSql) =>
    withTenant(tx, sitzung, async (kontext) => {
      const kopf = await findeAufmass(kontext, aufmassId);
      if (kopf === null) return null;
      // Ein Blatt eines ANDEREN Projekts ist unter dieser Adresse nicht
      // vorhanden — nicht verboten (AUT-06). Ohne diese Zeile zeigte
      // …/projekte/<fremd>/aufmass/<id>/freigabe dasselbe Blatt.
      if (kopf.projekt_id !== id) return null;
      return {
        kopf,
        zeilen: await ladeZeilen(kontext, aufmassId),
        fotos: await ladeFotos(kontext, aufmassId),
        signaturen: await ladeSignaturen(kontext, aufmassId),
        stand: await ladeVorlageStand(kontext, aufmassId),
        ausserhalbLv: await ladeAusserhalbLvJeBlatt(kontext, aufmassId),
      };
    }),
  ) as Promise<{
    kopf: AufmassKopfZeile; zeilen: readonly AufmassZeileZeile[];
    fotos: readonly FotoZeile[]; signaturen: readonly SignaturZeile[];
    stand: VorlageStand | null;
    ausserhalbLv: readonly AusserhalbLvWarnung[];
  } | null>);

  if (daten === null) notFound();

  const gesperrt = daten.kopf.gesperrt_lokal !== null;
  const hindernisse: readonly VorlageHindernis[] = daten.stand === null
    ? []
    : pruefeVorlage(daten.stand).filter((h) => h !== 'nicht_entwurf');
  /*
   * Ohne `bau.lesen` fuehrt der Rueckweg nach der Unterschrift auf diese Seite
   * zurueck — sie zeigt dann den festgeschriebenen Stand. Ein Rueckweg auf ein
   * Blatt, das die Sitzung nicht oeffnen darf, waere ein 404 nach einem
   * gelungenen Vorgang.
   */
  const blattPfad = darf['bau.lesen'] === true
    ? `/portal/${mandant}/bau/projekte/${id}/aufmass/${aufmassId}`
    : pfad;

  return (
    <PortalRahmen
      titel={`Aufmaß ${daten.kopf.nummer} gegenzeichnen`}
      bereich={mandant as BereichSchluessel}
      nurLesen={false}
      leiste={zugang.leiste}
      wurzel={`/portal/${mandant}`}
      aktiverTab="bau"
      sichtbareTabs={zugang.sichtbareTabs}
      navigationsRechte={zugang.navigationsRechte}
    >
      {darf['bau.lesen'] === true && (
        <nav aria-label="Zurück" className="mb-s3">
          <Link
            href={`/portal/${mandant}/bau/projekte/${id}/aufmass/${aufmassId}`}
            className="text-sm text-text-muted underline-offset-2 hover:text-text hover:underline"
          >
            ← Aufmaßblatt
          </Link>
        </nav>
      )}

      <div className="mb-s5 flex flex-wrap items-start justify-between gap-s3">
        <div>
          <h1 className="m-0 text-h1 text-text">
            Gegenzeichnung · Aufmaß {daten.kopf.nummer}
          </h1>
          <p className="m-0 mt-s1 text-sm text-text-muted">
            {daten.kopf.bezeichnung} · {daten.kopf.projekt} · {daten.kopf.kunde}
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

      <p className="mb-s5 max-w-prose text-sm text-text-muted">
        Was hier steht, wird mit der Unterschrift eingefroren und mit SHA-256
        gesiegelt — die Zeilen mit ihren Rechenansätzen, denn genau die erkennt
        der Auftraggeber an (§ 14 VOB/B). Prüfen Sie es, bevor Sie
        gegenzeichnen.
      </p>

      {/* BAU-05: Leistung ausserhalb des LV — vor der Unterschrift benannt. */}
      <AusserhalbLvWarnungen
        warnungen={daten.ausserhalbLv}
        mandant={mandant}
        projektId={id}
      />

      <AufmassZeilenBlock zeilen={daten.zeilen} ueberschrift="Das wird gegengezeichnet" />
      <MessfotoBlock fotos={daten.fotos} />

      <section>
        <h2 className="mb-s3 text-h3 text-text">Unterschriften</h2>
        <SignaturBlock signaturen={daten.signaturen} />

        {gesperrt ? (
          <p
            data-cse="gesperrt"
            className="rounded-lg border border-line bg-surface p-s5 text-sm text-text-muted"
          >
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
            {/*
              * Zurück auf das BLATT und nicht auf diese Seite: nach der
              * Unterschrift ist hier nichts mehr zu tun, und die Signatur mit
              * ihrem Digest steht dort (Playwright prüft genau das).
              */}
            <input type="hidden" name="zurueck" value={blattPfad} />
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
      </section>
    </PortalRahmen>
  );
}
