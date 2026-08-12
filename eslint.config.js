import prettier from 'eslint-config-prettier';
import path from 'node:path';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser
			}
		}
	},
	{
		rules: {
			// `_`-prefixed bindings are intentional throwaways (destructuring a few
			// keys off an object in order to drop them).
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			],

			// Our Map/Set/URLSearchParams instances are deliberately plain: MapView's
			// marker registry and the query-string builders are internal caches that
			// must not drive reactivity. SvelteMap/SvelteSet would add tracking
			// overhead for state nothing renders from.
			'svelte/prefer-svelte-reactivity': 'off',

			// Internal navigation goes through `resolve()` from `$app/paths`. What
			// remains are external, runtime-computed URLs — maps deep-links, OSF,
			// PLOS, OpenStreetMap — which the rule cannot distinguish from routes.
			'svelte/no-navigation-without-resolve': 'off'
		}
	}
);
