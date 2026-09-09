/**
 * `no-raw-color` — DESIGN.md is authoritative.
 *
 * "Do not invent colours, sizes or spacing — everything is defined here. If
 * something is missing, add it here first, then use it." A hex in a component
 * file is how a design system stops being one: it looks right on the screen
 * that introduced it and drifts everywhere else.
 *
 * `src/lib/design/theme.ts` and `globals.css` are the two places that may hold
 * literal values, because they ARE the mirror of DESIGN.md.
 */
const HEX = /#[0-9a-fA-F]{3,8}\b/u;
const FUNKTION = /\b(rgb|rgba|hsl|hsla|oklch|color-mix)\s*\(/u;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Colours come from the design tokens, never from a literal.' },
    schema: [],
    messages: {
      roh:
        'Literal colour {{wert}}. DESIGN.md is authoritative: use a token ' +
        '(`var(--…)` or a Tailwind class). If the value is missing, add it to ' +
        'docs/DESIGN.md first, then to src/lib/design/theme.ts.',
    },
  },
  create(context) {
    const pruefe = (node, wert) => {
      if (typeof wert !== 'string') return;
      if (HEX.test(wert) || FUNKTION.test(wert)) {
        context.report({ node, messageId: 'roh', data: { wert: wert.slice(0, 40) } });
      }
    };
    return {
      Literal(node) {
        pruefe(node, node.value);
      },
      TemplateElement(node) {
        pruefe(node, node.value.raw);
      },
    };
  },
};
