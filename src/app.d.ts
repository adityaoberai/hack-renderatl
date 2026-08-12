// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};

/** Vite's `?worker&url` import suffix — resolves to the bundled worker's URL. */
declare module '*?worker&url' {
	const src: string;
	export default src;
}
