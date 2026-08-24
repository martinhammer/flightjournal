<script setup lang="ts">
/**
 * One instance-wide reference-data table's admin controls: current count, file
 * upload + import, and delete-all.
 *
 * Every reference table exposes the same three admin endpoints under a common
 * base path (`<base>/count`, `<base>/import`, `DELETE <base>`), so the whole
 * section is parameterised by that base plus its labels rather than duplicated
 * per table. Format-specific guidance goes in the `instructions` slot.
 *
 * Self-contained on purpose: the settings pages are separate small mounts that
 * do not share the SPA bundle's api/store modules.
 */
import { onMounted, ref, useTemplateRef } from 'vue'
import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { showConfirmation, showError, showSuccess } from '@nextcloud/dialogs'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'

interface SkippedRow { key: string; reason: string }
interface ImportResult { imported: number; updated: number; skipped: SkippedRow[] }

const props = defineProps<{
	/** Section heading. */
	name: string
	/** Section subheading. */
	description: string
	/** OCS path shared by the three admin endpoints, e.g. '/api/v1/admin/airports'. */
	basePath: string
	/** `accept` for the file input, e.g. 'application/json,.json'. */
	accept: string
	/** Label on the file-picker button before a file is chosen. */
	choosePrompt: string
	/** Label on the import button. */
	importLabel: string
	/** Noun for counts and toasts, e.g. 'airport'. */
	entity: string
	/** Plural of `entity` — passed explicitly so callers control irregulars. */
	entityPlural: string
}>()

const ocsUrl = (path: string) => {
	const base = generateOcsUrl('apps/flightjournal' + path)
	return base.includes('?') ? `${base}&format=json` : `${base}?format=json`
}
const ocsConfig = {
	headers: {
		'OCS-APIRequest': 'true',
		Accept: 'application/json',
	},
}

const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const selectedFile = ref<File | null>(null)
const importing = ref(false)
const deleting = ref(false)
const lastResult = ref<ImportResult | null>(null)
const count = ref<number | null>(null)

const plural = (n: number) => (n === 1 ? props.entity : props.entityPlural)

async function refreshCount() {
	try {
		const res = await axios.get<{ ocs: { data: { count: number } } }>(
			ocsUrl(`${props.basePath}/count`),
			ocsConfig,
		)
		count.value = res.data.ocs.data.count
	} catch {
		count.value = null
	}
}

onMounted(refreshCount)

function onFilePick() {
	fileInput.value?.click()
}

function onFileChange(event: Event) {
	const target = event.target as HTMLInputElement
	selectedFile.value = target.files?.[0] ?? null
}

/**
 * The OCS envelope has moved between Nextcloud versions and axios adapters, so
 * accept the result at any of the shapes it has been observed in rather than
 * hard-failing on a valid import.
 *
 * @param {unknown} payload The raw axios response body.
 */
function extractImportResult(payload: unknown): ImportResult | null {
	const p = payload as { ocs?: { data?: unknown }; data?: unknown } | null | undefined
	const candidates: unknown[] = [p, p?.ocs?.data, p?.data]
	for (const c of candidates) {
		if (c && typeof c === 'object'
			&& typeof (c as Record<string, unknown>).imported === 'number'
			&& typeof (c as Record<string, unknown>).updated === 'number'
			&& Array.isArray((c as Record<string, unknown>).skipped)) {
			return c as ImportResult
		}
	}
	return null
}

async function runImport() {
	if (!selectedFile.value) {
		showError('Pick a file first.')
		return
	}
	importing.value = true
	lastResult.value = null
	let content: string
	try {
		content = await selectedFile.value.text()
	} catch {
		showError('Could not read the selected file.')
		importing.value = false
		return
	}
	let payload: unknown = null
	try {
		const res = await axios.post(
			ocsUrl(`${props.basePath}/import`),
			{ content },
			ocsConfig,
		)
		payload = res.data
	} catch (e: unknown) {
		const message = (e as { response?: { data?: { ocs?: { meta?: { message?: string } } } } })
			?.response?.data?.ocs?.meta?.message ?? `${props.importLabel} failed`
		showError(message)
		importing.value = false
		return
	}
	importing.value = false
	const result = extractImportResult(payload)
	if (!result) {
		console.error('[FlightJournal] Unexpected import response:', payload)
		showError('Import returned an unexpected response from the server. See the browser console for details.')
		return
	}
	lastResult.value = result
	const { imported, updated, skipped } = result
	showSuccess(`Imported ${imported}, updated ${updated}, skipped ${skipped.length}.`)
	selectedFile.value = null
	if (fileInput.value) fileInput.value.value = ''
	refreshCount()
}

async function runDeleteAll() {
	const confirmed = await showConfirmation({
		name: `Delete all ${props.entityPlural}`,
		text: `This will permanently delete every ${props.entity} record on this Nextcloud instance for all users. This action cannot be undone.`,
		labelConfirm: 'Delete all',
		labelReject: 'Cancel',
		severity: 'warning',
	})
	if (!confirmed) return
	deleting.value = true
	try {
		const res = await axios.delete<{ ocs: { data: { deleted: number } } }>(
			ocsUrl(props.basePath),
			ocsConfig,
		)
		const deleted = res.data.ocs.data.deleted
		showSuccess(`Deleted ${deleted} ${plural(deleted)}.`)
		refreshCount()
	} catch {
		showError(`Failed to delete ${props.entityPlural}`)
	} finally {
		deleting.value = false
	}
}
</script>

<template>
	<NcSettingsSection :name="name" :description="description">
		<p v-if="count === null" class="status">
			Loading current record count…
		</p>
		<p v-else class="status">
			Currently <strong>{{ count }}</strong> {{ plural(count) }} stored.
		</p>

		<h3>Import</h3>
		<slot name="instructions" />
		<input
			ref="fileInput"
			type="file"
			:accept="accept"
			class="hidden-file-input"
			@change="onFileChange">
		<div class="actions">
			<NcButton variant="secondary" :disabled="importing" @click="onFilePick">
				{{ selectedFile ? selectedFile.name : choosePrompt }}
			</NcButton>
			<NcButton variant="primary" :disabled="importing || !selectedFile" @click="runImport">
				{{ importLabel }}
			</NcButton>
		</div>
		<NcNoteCard v-if="lastResult" type="success" class="result">
			<p>
				Imported <strong>{{ lastResult.imported }}</strong>, updated <strong>{{ lastResult.updated }}</strong>, skipped <strong>{{ lastResult.skipped.length }}</strong>.
			</p>
			<details v-if="lastResult.skipped.length">
				<summary>Skipped entries</summary>
				<ul>
					<li v-for="row in lastResult.skipped" :key="row.key">
						<code>{{ row.key }}</code>: {{ row.reason }}
					</li>
				</ul>
			</details>
		</NcNoteCard>

		<h3 class="danger-heading">
			Delete
		</h3>
		<NcNoteCard type="warning" class="instructions">
			<p>This will delete every {{ entity }} record from the shared reference table.</p>
		</NcNoteCard>
		<div class="actions">
			<NcButton variant="error" :disabled="deleting" @click="runDeleteAll">
				Delete all {{ entityPlural }}
			</NcButton>
		</div>
	</NcSettingsSection>
</template>

<style scoped>
.status {
	display: block;
	width: 100%;
	margin: 0 0 12px;
	color: var(--color-text-maxcontrast);
}

.instructions {
	margin-bottom: 12px;
}

.instructions p {
	margin: 0 0 4px 0;
}

.actions {
	display: flex;
	gap: 8px;
	margin-top: 12px;
	align-items: center;
}

.result {
	margin-top: 16px;
}

.danger-heading {
	margin-top: 24px;
}

.hidden-file-input {
	display: none;
}
</style>
