module.exports = {
	extends: [
		'@nextcloud',
	],
	rules: {
		'jsdoc/require-jsdoc': 'off',
		'vue/first-attribute-linebreak': 'off',
	},
	globals: {
		// Ambient namespace declared by @types/geojson (type-only use).
		GeoJSON: 'readonly',
	},
	overrides: [
		{
			files: ['**/*.vue'],
			parser: 'vue-eslint-parser',
			parserOptions: {
				parser: '@typescript-eslint/parser',
			},
		},
	],
}
