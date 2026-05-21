import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Frontend component tests. Kept separate from vite.config.ts (which uses the
// opaque @nextcloud/vite-config app builder) so the test setup stays explicit.
export default defineConfig({
	plugins: [vue()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./tests/frontend/setup.ts'],
		include: ['tests/frontend/**/*.spec.ts'],
		// @nextcloud/vue ships CSS side-effect imports; inline it so Vite
		// transforms those instead of Node trying to load .css natively.
		server: {
			deps: {
				inline: [/@nextcloud\/vue/],
			},
		},
	},
})
