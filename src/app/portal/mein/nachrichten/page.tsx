import Link from 'next/link';
import { zeitpunktInSprache } from '@/lib/datum/zeitpunkt';
import { StatusPill } from '@/components/ui/StatusPill';
import { Button } from '@/components/ui/Button';
import { ladePosteingang, type Eintrag } from '@/server/benachrichtigung/posteingang';
import {
  EIGENER_FADEN_MOEGLICH, listeMeineFaeden, type MeinFadenkopf,
} from '@/server/services/mitarbeiter/nachricht';
import {
  mischePosteingang, zaehleUngelesen, type PosteingangZeile,
} from '@/server/services/mitarbeiter/posteingang';
import { AnmeldungNoetig } from '../../Anmeldung';
import { meinPortal, MeinRahmen } from '../rahmen';
import { Gesellschaft, Hinweis, Leer } from '../bausteine';

/**
 * `/portal/mein/nachrichten` — der persönliche Posteingang (EMP-11, NOT-01,
 * NOT-03).
 *
 * **Der Befund, der diese Fassung nötig machte — ein Nutzerbericht aus dem
 * Betrieb.** Die Gruppenleitung schrieb aus `/portal/[mandant]/nachrichten`
 * eine interne Nachricht an eine Mitarbeiterin. Die Oberfläche meldete
 * „gesendet". In ihrem Konto kam nichts an.
 *
 * Die Ursache war nicht die RLS und nicht die Empfängerart, sondern diese
 * Seite: sie las ausschliesslich `benachrichtigung` (Wächter-, Ablauf- und
 * Fristmeldungen, NOT-01). Die Nachricht steht in `nachricht` +
 * `nachricht_empfaenger` — einer ANDEREN Tabelle. Der Bildschirm konnte sie
 * gar nicht anzeigen. Das Kundenportal las über
 * `services/kundenportal/nachricht` die richtige Tabelle: der Weg zum KUNDEN
 * funktionierte, der zur KRAFT nicht.
 *
 * **Der Bildschirm heisst „Nachrichten", und was ihr geschickt wurde, gehört
 * dorthin.** Beide Quellen stehen jetzt in EINER Liste, nach Zeit sortiert —
 * und klar unterscheidbar: jede Zeile trägt „Systemmeldung" oder „Nachricht",
 * und die zwei Ungelesen-Zahlen stehen getrennt nebeneinander. „3 ungelesene
 * Meldungen" heisst „drei Warnungen warten", „3 ungelesene Nachrichten" heisst
 * „drei Menschen warten auf Antwort" — eine einzige Summe verwischt genau den
 * Unterschied, nach dem die Kraft abends ihre Entscheidung trifft.
 *
 * **Zusammengeführt, nicht zusammengelegt.** Eine Systemmeldung hat ein Ziel
 * und keinen Absender; ein Faden hat einen Absender, einen Verlauf und eine
 * Antwort. Die Mischung leistet `mischePosteingang` — eine reine Funktion, die
 * `tests/kern/mein-posteingang.test.ts` Fall für Fall prüft — und nicht ein
 * `union` in SQL, das eine der beiden Abfragen der anderen angliche.
 *
 * **Die Gesellschaft steht an JEDER Zeile.** Ein Mensch, zwei Beschäftigungen
 * (D-09, EMP-14): ohne sie sähe dieselbe Meldung zweimal gleich aus.
 *
 * **Öffnen einer Meldung ist ein POST**, kein Link: es stempelt `gelesen_am`.
 * Ein Vorauslader oder ein weitergeleiteter Link machte den Posteingang sonst
 * von allein leer (D-504). Beim Faden stempelt ebenfalls nur ein POST — der
 * Knopf steht auf der Fadenseite.
 */
export const dynamic = 'force-dynamic';

/** Eine Systemmeldung als Posteingangszeile. */
function ausMeldung(e: Eintrag): PosteingangZeile {
  return {
    art: 'meldung',
    id: e.id,
    titel: e.titel,
    auszug: e.text,
    absender: null,
    zeitpunkt: e.erstelltAm,
    ungelesen: e.gelesenAm === null ? 1 : 0,
    mandantSlug: e.mandantSlug,
    mandantName: e.mandantName,
    geschlossen: false,
  };
}

/** Und ein Nachrichtenfaden als dieselbe Zeile. */
function ausFaden(f: MeinFadenkopf, ohneBetreff: string): PosteingangZeile {
  return {
    art: 'faden',
    id: f.threadId,
    titel: f.betreff ?? ohneBetreff,
    auszug: f.auszug,
    absender: f.absender,
    zeitpunkt: f.letzteAktivitaet,
    ungelesen: f.ungelesen,
    mandantSlug: f.mandantSlug,
    mandantName: f.mandantName,
    geschlossen: f.geschlossen,
  };
}

export default async function MeineNachrichten() {
  const ergebnis = await meinPortal('/portal/mein/nachrichten', async (kontext) => ({
    meldungen: await ladePosteingang(kontext, { grenze: 100 }),
    faeden: await listeMeineFaeden(kontext),
  }));
  if (ergebnis.art === 'anmeldung') return <AnmeldungNoetig />;
  const { basis, daten } = ergebnis;
  const t = basis.texte;


  const zeilen = mischePosteingang(
    daten.meldungen.map(ausMeldung),
    daten.faeden.map((f) => ausFaden(f, t.nachricht)),
  );
  const offen = zaehleUngelesen(zeilen);

  return (
    <MeinRahmen basis={basis} titel={t.nachrichten} aktiverTab="nachrichten">
      <div className="mb-s5 flex flex-wrap items-baseline justify-between gap-s3">
        <h1 className="m-0 text-h1 text-text">{t.nachrichten}</h1>
        {offen.gesamt > 0 && (
          <p
            data-cse="nachrichten-offen"
            data-meldungen={String(offen.meldungen)}
            data-faeden={String(offen.faeden)}
            className="m-0 text-base text-text-muted"
          >
            {/*
              * Zwei Zahlen, getrennt benannt. Eine Summe stünde da wie eine
              * Auskunft und wäre keine — siehe `zaehleUngelesen`.
              */}
            <span className="tabular-nums">{offen.faeden}</span>{' '}
            {t.nachrichtenFaden} · <span className="tabular-nums">{offen.meldungen}</span>{' '}
            {t.systemmeldung} — {t.ungelesen}
          </p>
        )}
      </div>

      {/*
        * **Der Satz steht da, wo der Knopf stünde** — nicht ausgegraut und
        * nicht weggelassen. Wer schreiben will und nichts findet, hält das
        * Portal für kaputt; wer den Satz liest, weiss, dass geantwortet
        * werden kann und warum das Übrige noch offen ist (O-830).
        */}
      {!EIGENER_FADEN_MOEGLICH && (
        <Hinweis text={t.neuerFadenOffen} marke="neuer-faden-offen" />
      )}

      {zeilen.length === 0 ? (
        <Leer text={t.keineNachrichten} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-s3 p-0">
          {zeilen.map((z) => (
            <li
              key={`${z.art}-${z.id}`}
              data-cse="nachricht"
              data-art={z.art}
              data-gelesen={String(z.ungelesen === 0)}
              className={`rounded-lg border p-s4 ${
                z.ungelesen > 0 ? 'border-brand bg-brand-soft' : 'border-line bg-surface'
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-s2">
                {/*
                  Der Titel führt auf den Eintrag selbst und STEMPELT DABEI
                  NICHT — das tut nur ein POST (D-504). Beide Arten liegen
                  unter derselben Adresse: `[id]` erkennt an der Id, was es
                  ist, und ein alter Verweis auf eine Meldung führt weiter
                  dorthin, wo er immer hinführte.
                */}
                <Link
                  href={`/portal/mein/nachrichten/${z.id}`}
                  data-cse="nachricht-lesen"
                  className="text-h3 text-text underline"
                >
                  {z.titel}
                </Link>
                <span className="flex items-center gap-s2">
                  <span data-cse="eintrag-art" className="text-sm text-text-subtle">
                    {z.art === 'meldung' ? t.systemmeldung : t.nachrichtenFaden}
                  </span>
                  <StatusPill sprache={basis.sprache}
                    zustand={z.geschlossen
                      ? 'Abgeschlossen'
                      : z.ungelesen > 0 ? 'Wartet' : 'Inaktiv'}
                  />
                </span>
              </div>

              {z.mandantSlug !== null && (
                <p className="mt-s2">
                  <Gesellschaft slug={z.mandantSlug} name={z.mandantName ?? z.mandantSlug} />
                </p>
              )}

              {z.absender !== null && (
                <p className="m-0 mt-s2 text-sm text-text-muted">
                  {t.absender}: <span data-cse="absender">{z.absender}</span>
                </p>
              )}

              <p className="mt-s2 max-w-[60ch] text-base text-text-muted">{z.auszug}</p>

              <p className="mt-s2 text-sm text-text-subtle">
                <time dateTime={z.zeitpunkt.toISOString()} className="tabular-nums">
                  {zeitpunktInSprache(z.zeitpunkt, basis.sprache)}
                </time>
                {z.ungelesen === 0
                  ? <> · {t.gelesen}</>
                  : (
                    <> · <span className="tabular-nums">{z.ungelesen}</span> {t.ungelesen}</>
                  )}
              </p>

              {/*
                * Nur die Systemmeldung trägt hier ihren Knopf: er stempelt UND
                * führt auf den Datensatz, dessen Adresse aus der ZEILE kommt
                * (`benachrichtigung.ziel`) — ein `ziel`-Feld im Formular wäre
                * eine offene Weiterleitung mit einer echten Anmeldung davor
                * (D-504). Ein Faden hat kein solches Ziel; bei ihm stehen
                * „Als gelesen markieren" und das Antwortfeld auf der
                * Fadenseite, wo auch der Text steht, um den es geht.
                */}
              {z.art === 'meldung' && (
                <form
                  method="post"
                  action={`/api/benachrichtigungen/${z.id}/oeffnen`}
                  className="mt-s4"
                >
                  <Button type="submit" variante="secondary" data-cse="nachricht-oeffnen">
                    {t.oeffnen}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </MeinRahmen>
  );
}
