// @ts-check
import parser from '@babel/eslint-parser';
import preact from 'eslint-config-preact';

/** @type {import('eslint').Linter.Config[]} */
export default [
	// Base Preact flat config (JS / JSX files)
	...preact,

	// Explicit rule overrides for JS/JSX
	{
		files: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
		languageOptions: {
			parser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
				ecmaFeatures: { jsx: true, modules: true, impliedStrict: true },
				requireConfigFile: false,
				babelOptions: {
					plugins: [
						'@babel/plugin-syntax-class-properties',
						'@babel/plugin-syntax-jsx',
					],
				},
			},
		},
		rules: {
			'quotes': ['warn', 'single', { avoidEscape: true }],
		},
	},

	{
		ignores: ['node_modules/**', 'dist/**'],
	},
];
