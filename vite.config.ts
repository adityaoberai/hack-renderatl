import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	optimizeDeps: {
		// MapLibre builds its worker URL at runtime from a template literal, which
		// no bundler can statically analyse, so the sibling chunk is never emitted.
		// MapView.svelte hands it an explicit bundled worker URL instead; excluding
		// the package here keeps dev and build resolving the same way.
		exclude: ['maplibre-gl']
	},
	// MapLibre asks for `new Worker(url, { type: 'module' })` first, so emit the
	// worker bundle as ESM rather than Vite's default IIFE.
	worker: { format: 'es' },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node: deployed to DigitalOcean App Platform / Droplet as a Node server.
			adapter: adapter()
		})
	]
});
