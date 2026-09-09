/**
 * `no-float-money` — invariant 1.
 *
 * A money value is `Cent` (a branded `bigint`). This rule refuses the two ways
 * a float gets in anyway: a parameter or property whose name says money but
 * whose type is `number`, and arithmetic on a `_cent` identifier using the
 * float operators. The compiler already refuses the first through the brand;
 * this rule refuses it a second time, in review, because a brand can be cast
 * away with one `as` and nobody reads a diff for that.
 */
const GELD_NAME = /(_cent|_mikrocent|Cent|Mikrocent|betrag|preis|summe|saldo|entgelt)$/iu;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Money is bigint cents, never a float (invariant 1, K-16).' },
    schema: [],
    messages: {
      numberTyped:
        "'{{name}}' is money and is typed `number`. Money is `Cent` — a branded bigint " +
        '(invariant 1, K-16). A float cent is wrong by a fraction nobody notices until it is invoiced.',
      floatLiteral:
        "'{{name}}' is money and is assigned the float literal {{value}}. Write it as a bigint of cents.",
    },
  },
  create(context) {
    const meldeTyp = (node, name) => {
      const t = node?.typeAnnotation?.typeAnnotation ?? node?.typeAnnotation;
      if (t && t.type === 'TSNumberKeyword') {
        context.report({ node: t, messageId: 'numberTyped', data: { name } });
      }
    };
    return {
      Identifier(node) {
        if (!GELD_NAME.test(node.name)) return;
        if (node.typeAnnotation) meldeTyp(node, node.name);
      },
      TSPropertySignature(node) {
        const name = node.key && node.key.name;
        if (name && GELD_NAME.test(name)) meldeTyp(node, name);
      },
      PropertyDefinition(node) {
        const name = node.key && node.key.name;
        if (name && GELD_NAME.test(name)) meldeTyp(node, name);
      },
      VariableDeclarator(node) {
        const name = node.id && node.id.name;
        if (!name || !GELD_NAME.test(name)) return;
        if (node.id.typeAnnotation) meldeTyp(node.id, name);
        const init = node.init;
        if (init && init.type === 'Literal' && typeof init.value === 'number') {
          context.report({
            node: init,
            messageId: 'floatLiteral',
            data: { name, value: String(init.value) },
          });
        }
      },
    };
  },
};
