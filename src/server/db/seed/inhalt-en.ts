/**
 * Die ENGLISCHEN Entwurfstexte der oeffentlichen Seiten (O-207).
 *
 * **Dieselben Aussagen, andere Sprache — nichts dazu.** Eine Uebersetzung ist
 * die Gelegenheit, einen Satz "griffiger" zu machen, und genau das darf hier
 * nicht passieren: was auf der englischen Seite steht und auf der deutschen
 * nicht, hat niemand geprueft. Also keine Zahlen, keine Auszeichnungen, keine
 * Kundennamen und keine Zusagen — wie deutsch.
 *
 * **Deutsche Rechtsbegriffe bleiben stehen.** "§ 34a GewO", "VOB/B",
 * "Leistungsverzeichnis": sie zu uebersetzen wuerde sie ungenau machen. Wo es
 * hilft, steht eine kurze Erklaerung daneben — das ist eine Lesehilfe und
 * keine zweite Bedeutung.
 *
 * // TODO(client): O-207 — bitte auch die englische Fassung durchgehen. Sie
 * // ist so zurückhaltend wie die deutsche und wartet auf dieselben Angaben.
 */
import type { SeitenInhalt } from './inhalt.js';

const TRADE = {
  reinigung: 'Building cleaning',
  security: 'Security and premises protection services',
  bau: 'Structural work, fit-out, demolition',
} as const;

const service = (name: string, beschreibung: string) => ({ name, beschreibung });

export const SEITEN_EN: readonly SeitenInhalt[] = [
  {
    pfad: '/',
    beschreibung:
      'Building cleaning, security services and construction in Berlin — four '
      + 'independent companies, one point of contact.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'Four trades, one',
        text:
          'Cleaning, security and construction in Berlin. Four independent '
          + 'companies that work together when a job needs more than one trade — '
          + 'and separately when it does not.',
      },
      { art: 'markenkarten', ueberschrift: null, text: null },
      {
        art: 'text',
        ueberschrift: 'Why four companies',
        text:
          'Each trade has rules of its own: § 34a GewO for security work, the '
          + 'VOB for construction, separate pay scales and records for cleaning. '
          + 'Separate companies keep those rules cleanly apart. For you nothing '
          + 'changes: you talk to one contact, even when two divisions are '
          + 'involved.',
      },
    ],
  },
  {
    pfad: '/unternehmen',
    beschreibung: 'The four companies of the CSE group at a glance.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Companies', text:
        'Four companies, one location in Berlin.' },
      { art: 'markenkarten', ueberschrift: null, text: null },
      {
        art: 'text',
        ueberschrift: 'Independent, not separate',
        text:
          'Each company runs its own jobs, its own costing and its own '
          + 'invoicing. Where a project touches several trades, the divisions '
          + 'coordinate instead of sending you between three firms.',
      },
    ],
  },
  {
    pfad: '/leistungen',
    beschreibung: 'Cleaning, security services and construction work from Berlin.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Services', text:
        'What the four divisions offer — and which enquiry to send where.' },
      {
        art: 'leistungen',
        ueberschrift: TRADE.reinigung,
        text: null,
        daten: { leistungen: [
          service('Routine cleaning',
            'Recurring cleaning to an agreed schedule of works.'),
          service('Glass and frame cleaning',
            'Windows, façade elements and frames, inside and out.'),
          service('Post-construction cleaning',
            'The clean after building work is finished, before handover.'),
          service('One-off cleaning',
            'Single assignments by arrangement.'),
        ] },
      },
      {
        art: 'leistungen',
        ueberschrift: TRADE.security,
        text: null,
        daten: { leistungen: [
          service('Premises protection',
            'Guarding of buildings and installations under § 34a GewO.'),
          service('Event services',
            'Admission, order and supervision at events.'),
          service('Reception services',
            'Staffing of reception and gate.'),
        ] },
      },
      {
        art: 'leistungen',
        ueberschrift: TRADE.bau,
        text: null,
        daten: { leistungen: [
          service('Structural work', 'Shell construction to a schedule of works.'),
          service('Fit-out', 'Drywall, flooring, painting.'),
          service('Demolition',
            'Strip-out and demolition, with proof of waste disposal.'),
          service('Refurbishment', 'Repair and renewal in existing buildings.'),
        ] },
      },
    ],
  },
  {
    pfad: '/projekte',
    beschreibung: 'Completed projects of the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Projects', text: null },
      {
        art: 'text',
        ueberschrift: 'References will appear here',
        text:
          'Projects appear here once the customer concerned has agreed in '
          + 'writing to being named. Without that consent no project is shown — '
          + 'not a completed one and not a successful one either.',
      },
    ],
  },
  {
    pfad: '/ueber-uns',
    beschreibung: 'Who is behind the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'About us', text: null },
      {
        art: 'text',
        ueberschrift: 'What we do',
        text:
          `The CSE group runs four companies in Berlin: ${TRADE.reinigung.toLowerCase()}, `
          + `${TRADE.security.toLowerCase()} and ${TRADE.bau.toLowerCase()}. `
          + 'Alongside them, CSE Operations is responsible for the group’s '
          + 'digital processes.',
      },
      {
        art: 'text',
        ueberschrift: 'How we work',
        text:
          'Every job has a named person responsible for it. Hours are recorded '
          + 'on site, not estimated afterwards. Proof of work belongs with the '
          + 'invoice, not with the follow-up question.',
      },
    ],
  },
  {
    pfad: '/news',
    beschreibung: 'News from the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'News', text: null },
      {
        art: 'text',
        ueberschrift: 'No posts yet',
        text: 'As soon as there is something to report, it will appear here.',
      },
    ],
  },
  {
    pfad: '/kontakt',
    beschreibung: 'How to reach the four companies of the CSE group.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Contact', text: null },
      {
        art: 'text',
        ueberschrift: 'Send an enquiry',
        text:
          'For a quote, please use the form of the division concerned — it asks '
          + 'for exactly the details we need in order to cost the work. The '
          + 'address and phone number of all four companies are in the footer of '
          + 'every page and in the legal notice.',
      },
    ],
  },
  {
    pfad: '/impressum',
    beschreibung: 'Legal notice under § 5 TMG.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Legal notice', text: null },
      {
        art: 'text',
        ueberschrift: 'Details under § 5 TMG',
        text:
          'The four companies, with their registered name, address and phone '
          + 'number, are listed in the footer of this page. Commercial register '
          + 'entry, VAT identification number and management will be added here '
          + 'per company once those details are confirmed. The German version of '
          + 'this notice is the legally binding one.',
      },
    ],
  },
  {
    pfad: '/datenschutz',
    beschreibung: 'Privacy notice under the GDPR.',
    abschnitte: [
      { art: 'hero', ueberschrift: 'Privacy', text: null },
      {
        art: 'text',
        ueberschrift: 'No third parties on this site',
        text:
          'This website loads no fonts, no analytics and no maps from external '
          + 'servers. That is why there is no cookie banner either: there is '
          + 'nothing to consent to.',
      },
      {
        art: 'text',
        ueberschrift: 'When you submit a form',
        text:
          'We store what you entered, together with the date and time of receipt '
          + 'and a non-reversible check value derived from your IP address, to '
          + 'prevent abuse. The IP address itself is not stored. The legal basis '
          + 'is Art. 6(1)(b) and (f) GDPR — handling your enquiry. The German '
          + 'version of this notice is the legally binding one.',
      },
    ],
  },
  {
    pfad: '/unternehmen/reinigung',
    beschreibung: `CSE Dienstleistungen GmbH — ${TRADE.reinigung.toLowerCase()} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'CSE Dienstleistung', text: TRADE.reinigung },
      // Translated from the company's own site, cse-dienstleistungen.de (D-473).
      {
        art: 'text',
        ueberschrift: 'Your strong service partner',
        text:
          'Our team is made up of motivated, trained staff who know exactly what '
          + 'matters. We deliver every service we offer with the know-how it takes '
          + 'and put particular weight on quality and thoroughness. Our services '
          + 'range from A to Z — demolition work, construction helpers, caretaking '
          + 'or the day-to-day maintenance cleaning of your property — and we '
          + 'always adapt them to what our customers need.',
      },
      {
        art: 'leistungen',
        ueberschrift: 'Our services',
        text: null,
        daten: {
          leistungen: [
            service('Maintenance cleaning',
              'Keep your property and offices in a consistently immaculate condition.'),
            service('Deep cleaning',
              'From removing dust and dirt of every kind, through machine deep cleaning, to special cleaning of surfaces.'),
            service('Window cleaning',
              'A thorough, high-quality clean that gives your windows the shine they deserve.'),
            service('Office cleaning',
              'High-quality office cleaning, including the care of corridors and carpets.'),
            service('Stairwell cleaning',
              'The stairwell is often the first impression of your building.'),
            service('Construction cleaning',
              'Makes sure all materials and waste are fully removed once the project is finished.'),
            service('Demolition / dismantling',
              'Selective dismantling (non-structural) of all fittings down to the shell.'),
            service('Construction helpers',
              'Helpers relieve the skilled trades on site and are hard to do without.'),
            service('Caretaking',
              'A caretaker takes on many tasks for owners and tenants, on schedule or on call.'),
            service('Construction brokering',
              'Access to a network of experienced construction firms and craftsmen.'),
          ],
          faq: [
            {
              frage: 'What do you need in order to quote?',
              antwort:
                'Type of building, area in square metres, number of properties, '
                + 'the frequency you want and your preferred start date. That is '
                + 'exactly what the enquiry form asks for.',
            },
            {
              frage: 'Do you also clean at weekends?',
              antwort:
                'Working times are agreed per property. Please note what you '
                + 'need in the enquiry.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/security',
    beschreibung: `SSE Security — ${TRADE.security.toLowerCase()} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'SSE Security', text: TRADE.security },
      // Translated from the company's own site, select-security.de (D-473).
      {
        art: 'text',
        ueberschrift: 'We keep Berlin safe',
        text:
          'Your partner for professional security solutions — reliable, discreet '
          + 'and ready to deploy. Whether property protection, personal protection '
          + 'or event security: we stand for uncompromising security in every '
          + 'situation.',
      },
      {
        art: 'leistungen',
        ueberschrift: 'Our services',
        text: null,
        daten: {
          leistungen: [
            service('Premises protection', 'Guarding of buildings and installations (§ 34a GewO).'),
            service('Construction-site guarding', 'Protection of sites, materials and equipment.'),
            service('Fire watch', 'Fire safety watch during works and events.'),
            service('Personal protection', 'Close protection for individuals.'),
            service('Patrol and intervention', 'Patrol rounds and response to alarms.'),
            service('Investigation and detective services', 'Investigations within the law.'),
            service('Event security', 'Admission, order and supervision at events.'),
            service('Hostess and reception service', 'Reception, gate and guest care.'),
            service('Doorman service', 'Access control at the entrance.'),
            service('Security technology', 'Technical security systems.'),
          ],
          faq: [
            {
              frage: 'What do you need in order to quote?',
              antwort:
                'The occasion, the period with date and time, the expected '
                + 'number of visitors, the staff required and the location.',
            },
            {
              frage: 'Are your staff instructed under § 34a GewO?',
              antwort:
                'Proof under § 34a GewO — the German trade-law qualification for '
                + 'security work — is a precondition for deployment and is held '
                + 'on file for each member of staff.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/bau',
    beschreibung: `REALTIME Service GmbH — ${TRADE.bau.toLowerCase()} in Berlin.`,
    abschnitte: [
      { art: 'hero', ueberschrift: 'REALTIME Service', text: TRADE.bau },
      {
        art: 'leistungen',
        ueberschrift: 'Our trades',
        text: null,
        daten: {
          leistungen: [
            service('Structural work', 'Shell construction to a schedule of works.'),
            service('Fit-out', 'Drywall, flooring, painting.'),
            service('Demolition', 'Strip-out, with proof of waste disposal.'),
            service('Refurbishment', 'Repair and renewal in existing buildings.'),
          ],
          faq: [
            {
              frage: 'What do you need in order to quote?',
              antwort:
                'The trade, the scope and the completion date you want. If you '
                + 'have a bill of quantities, you can attach it to the enquiry as '
                + 'a PDF or XLSX.',
            },
            {
              frage: 'Do you work to the VOB?',
              antwort:
                'Construction work is handled under VOB/B — the German standard '
                + 'terms for construction contracts — unless something else is '
                + 'agreed.',
            },
          ],
        },
      },
    ],
  },
  {
    pfad: '/unternehmen/operations',
    beschreibung: 'CSE Operations — digital processes, reporting and group management.',
    abschnitte: [
      {
        art: 'hero',
        ueberschrift: 'CSE Operations',
        text: 'Digital processes, reporting and group management.',
      },
      {
        art: 'text',
        ueberschrift: 'What Operations does',
        text:
          'CSE Operations runs the platform the other three companies work on: '
          + 'time recording, rostering, proof of work, reporting. For external '
          + 'customers the division offers the same work — mapping processes, '
          + 'digitising them and making them measurable.',
      },
    ],
  },
];
