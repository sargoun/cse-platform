/**
 * `no-client-clock` — invariant 5, R-11.
 *
 * The server clock is the source of truth for a time entry. A service that
 * calls `new Date()` or `Date.now()` reads whatever clock it happens to run
 * on, which means it cannot be tested against a DST transition and cannot be
 * replayed. Time is injected once per request as `ctx.jetzt`.
 *
 * `new Date(<argument>)` is fine — that is parsing a stored instant, not
 * reading a clock.
 */
/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Services take time from ctx.jetzt, never from the ambient clock.' },
    schema: [],
    messages: {
      ambient:
        '{{call}} reads the ambient clock. Services take the instant from `ctx.jetzt`, injected ' +
        'once per request (invariant 5, R-11) — otherwise this code cannot be tested against a ' +
        'DST transition and cannot be replayed.',
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0) {
          context.report({ node, messageId: 'ambient', data: { call: 'new Date()' } });
        }
      },
      CallExpression(node) {
        const c = node.callee;
        if (
          c.type === 'MemberExpression' &&
          c.object.type === 'Identifier' &&
          c.object.name === 'Date' &&
          c.property.type === 'Identifier' &&
          c.property.name === 'now'
        ) {
          context.report({ node, messageId: 'ambient', data: { call: 'Date.now()' } });
        }
      },
    };
  },
};
