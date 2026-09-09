import tseslint from 'typescript-eslint';
import noRawColor from '../../../eslint-rules/no-raw-color.js';

export default tseslint.config({
  files: ['**/*.tsx', '**/*.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { cse: { rules: { 'no-raw-color': noRawColor } } },
  rules: { 'cse/no-raw-color': 'error' },
});
