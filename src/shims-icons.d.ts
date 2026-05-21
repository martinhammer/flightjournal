// vue-material-design-icons ships .d.vue.ts declarations but no package.json
// "exports"/"types" entry, so TS module resolution can't find them. This shim
// declares the component shape for all icon imports.
declare module 'vue-material-design-icons/*.vue' {
	import type { DefineComponent } from 'vue'

	const component: DefineComponent<{
		size?: number | string
		fillColor?: string
		title?: string
	}>
	export default component
}
