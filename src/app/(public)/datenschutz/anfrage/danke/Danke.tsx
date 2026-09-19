import type { Metadata } from 'next';
import { basisAusAnfrage } from '@/server/inhalt/seiten-daten';
import { mitSprache, VORGABE_SPRACHE, type Sprache } from '@/lib/sprache';

/**
 * `/datenschutz/anfrage/danke` — die Bestätigung, die die Frist NENNT
 * (LEG-09, Art. 12 Abs. 3 DSGVO).
 *
 * **Warum hier eine Frist steht und auf der Angebots-Dankseite keine.** Bei
 * einem Angebot ist die Antwortzeit eine Zusage des Unternehmens — eine
 * Werbeaussage, an der man gemessen wird, und deshalb eine Entscheidung des
 * Mandanten (O-14). Hier ist sie Gesetz: Art. 12 Abs. 3 nennt einen Monat, und
 * die betroffene Person hat ein Recht darauf, ihn zu kennen. Ihn zu
 * verschweigen wäre nicht Vorsicht, sondern eine vorenthaltene Information.
 *
 * **Und die Verlängerung steht auch da.** Satz 3 desselben Absatzes erlaubt
 * zwei weitere Monate bei komplexen Anträgen — aber nur, wenn die Person binnen
 * eines Monats davon erfährt. Wer das erst im Verlängerungsschreiben liest,
 * hält es für eine Ausrede.
 *
 * **Keine Vorgangsnummer.** Sie wäre praktisch und wäre zugleich ein Schlüssel,
 * mit dem sich der Stand einer fremden Anfrage abfragen liesse, sobald jemand
 * dafür eine Adresse baut. Genannt werden die Frist und die Adresse, an die
 * geantwortet wird — beides weiss der Anfragende ohnehin.
 */

const TEXTE = {
  de: {
    titel: 'Ihre Anfrage ist eingegangen',
    satz: 'Wir haben Ihre Anfrage aufgenommen und melden uns an der E-Mail-Adresse, '
      + 'die Sie angegeben haben.',
    frist: 'Wir antworten innerhalb eines Monats.',
    fristErklaerung:
      'Das ist die gesetzliche Frist aus Art. 12 Abs. 3 DSGVO. Ist Ihr Anliegen '
      + 'umfangreich, dürfen wir sie um zwei Monate verlängern — dann sagen wir '
      + 'Ihnen das innerhalb des ersten Monats und nennen den Grund.',
    identitaet:
      'Sollten wir Ihre Anfrage nicht eindeutig zuordnen können, fragen wir bei '
      + 'Ihnen nach. Wir haben Sie bewusst nicht um Ausweis oder Geburtsdatum '
      + 'gebeten: mehr Daten zu verlangen, als wir herausgeben, wäre das Gegenteil '
      + 'von Datenschutz.',
    zurueck: 'Zur Datenschutzerklärung',
  },
  en: {
    titel: 'Your request has arrived',
    satz: 'We have recorded your request and will reply to the e-mail address you gave.',
    frist: 'We will reply within one month.',
    fristErklaerung:
      'That is the statutory deadline under Art. 12(3) GDPR. If your request is '
      + 'extensive we may extend it by two months — in that case we will tell you '
      + 'within the first month and give the reason.',
    identitaet:
      'If we cannot match your request, we will ask you. We deliberately did not '
      + 'ask for an ID or a date of birth: demanding more data than we hand out '
      + 'would be the opposite of data protection.',
    zurueck: 'To the privacy policy',
  },
} as const;

export async function dankMetadaten(
  sprache: Sprache = VORGABE_SPRACHE,
): Promise<Metadata> {
  const basis = await basisAusAnfrage();
  const t = TEXTE[sprache];
  return {
    title: t.titel,
    description: t.frist,
    robots: { index: false, follow: true },
    alternates: { canonical: `${basis}${mitSprache('/datenschutz/anfrage/danke', sprache)}` },
  };
}

export function DankeSeiteFuer(sprache: Sprache = VORGABE_SPRACHE) {
  const t = TEXTE[sprache];
  return (
    <section data-cse="anfrage-danke"
             className="mx-auto flex max-w-content flex-col gap-s5 px-s5 py-s6">
      <h1 className="text-h1 text-text [hyphens:auto] break-words">{t.titel}</h1>
      <p className="max-w-[72ch] text-base text-text-muted">{t.satz}</p>

      <div data-cse="anfrage-frist"
           className="max-w-[60ch] rounded-lg border border-line bg-surface p-s5">
        <p className="m-0 text-h3 text-text">{t.frist}</p>
        <p className="m-0 mt-s3 text-sm text-text-muted">{t.fristErklaerung}</p>
      </div>

      <p className="max-w-[72ch] text-sm text-text-muted">{t.identitaet}</p>

      <a href={mitSprache('/datenschutz', sprache)}
         className="min-h-11 self-start rounded-md border border-line-strong px-s5 py-s3 text-base text-text hover:bg-surface-2">
        {t.zurueck}
      </a>
    </section>
  );
}
