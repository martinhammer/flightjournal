import { describe, it, expect } from 'vitest'
import { ocsErrorMessage } from '../../src/ocsError.ts'

// Pins where the error text actually lives. Our controllers return
// DataResponse(['message' => …]); Nextcloud's OCS v2 renderer puts that in
// ocs.data.message and sets meta.message to '' — so reading meta.message with
// `??` (as the dialogs used to) produced an empty toast.

const ocsFailure = (meta: unknown, data: unknown) => ({ response: { data: { ocs: { meta, data } } } })

describe('ocsErrorMessage', () => {
	it('reads the message our controllers return, as the server actually renders it', () => {
		const e = ocsFailure({ status: 'failure', statuscode: 400, message: '' }, { message: 'Origin is required' })
		expect(ocsErrorMessage(e, 'fallback')).toBe('Origin is required')
	})

	it('uses meta.message when a thrown OCS exception set it', () => {
		const e = ocsFailure({ status: 'failure', statuscode: 403, message: 'Logged in account must be an admin' }, [])
		expect(ocsErrorMessage(e, 'fallback')).toBe('Logged in account must be an admin')
	})

	it('falls back when meta.message is the empty string', () => {
		expect(ocsErrorMessage(ocsFailure({ message: '' }, null), 'Import failed')).toBe('Import failed')
	})

	it('falls back on a whitespace-only or non-string message', () => {
		expect(ocsErrorMessage(ocsFailure({ message: ' ' }, { message: '  ' }), 'fallback')).toBe('fallback')
		expect(ocsErrorMessage(ocsFailure({ message: 42 }, { message: { nested: true } }), 'fallback')).toBe('fallback')
	})

	it('falls back when there is no OCS body at all', () => {
		expect(ocsErrorMessage(new Error('Network Error'), 'fallback')).toBe('fallback')
		expect(ocsErrorMessage({ response: { data: '<html>500</html>' } }, 'fallback')).toBe('fallback')
		expect(ocsErrorMessage(undefined, 'fallback')).toBe('fallback')
	})
})
