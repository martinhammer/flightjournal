import { vi } from 'vitest'

// @nextcloud/* browser-runtime modules have no meaningful behaviour under
// jsdom; stub them so component tests stay focused on our own code.

vi.mock('@nextcloud/dialogs', () => ({
	showError: vi.fn(),
	showSuccess: vi.fn(),
	showWarning: vi.fn(),
	showInfo: vi.fn(),
	showConfirmation: vi.fn().mockResolvedValue(true),
}))

vi.mock('@nextcloud/router', () => ({
	generateOcsUrl: (path: string) => `/ocs/${path}`,
	generateUrl: (path: string) => `/${path}`,
}))
