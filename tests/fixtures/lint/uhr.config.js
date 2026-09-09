// Applies no-client-clock to the fixture path, so the rule can be proven to
// fire without moving a deliberately broken file into src/.
import tseslint from 'typescript-eslint';
import noClientClock from '../../../eslint-rules/no-client-clock.js';

export default tseslint.config({
  files: ['**/*.ts'],
  languageOptions: { parser: tseslint.parser },
  plugins: { cse: { rules: { 'no-client-clock': noClientClock } } },
  rules: { 'cse/no-client-clock': 'error' },
});
