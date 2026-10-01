/**
 * The message to show for a failed OCS request.
 *
 * Our controllers report errors by returning `DataResponse(['message' => …])`,
 * which Nextcloud's OCS v2 renderer places in `ocs.data.message`; `meta.message`
 * is only populated for thrown OCS exceptions and is otherwise the *empty
 * string* (not absent). So `data.message` is read first, and `||` rather than
 * `??` lets an empty `meta.message` fall through to the fallback instead of
 * producing a blank toast.
 *
 * Kept out of `api.ts` because many specs replace that module wholesale.
 *
 * @param e The caught error (usually an axios error).
 * @param fallback Shown when the response carries no message (network failure, 500…).
 */
export function ocsErrorMessage(e: unknown, fallback: string): string {
	const ocs = (e as { response?: { data?: { ocs?: { meta?: { message?: unknown }; data?: { message?: unknown } } } } })
		?.response?.data?.ocs
	const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
	return text(ocs?.data?.message) || text(ocs?.meta?.message) || fallback
}
