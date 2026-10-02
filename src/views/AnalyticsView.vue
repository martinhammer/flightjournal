<script setup lang="ts">
/**
 * Analytics: statistics over the user's flights, honouring the same route
 * query filters as the Flights and Map views (`filters.ts`), so a filtered log
 * opens here already filtered and every ranked row links back into the log.
 *
 * The year picker is a `dateFrom`/`dateTo` filter spanning one calendar year;
 * the date chip is hidden while it shows exactly that.
 *
 * Charts are Chart.js on a canvas (time series, weekday, cabin, distance);
 * ranked lists, tiles and records are HTML. Both take their colours from one
 * themed palette — see `chartTheme.ts`.
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter, type LocationQuery } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcChip from '@nextcloud/vue/components/NcChip'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcSelect from '@nextcloud/vue/components/NcSelect'
import ChartBar from 'vue-material-design-icons/ChartBar.vue'
import FormatListBulleted from 'vue-material-design-icons/FormatListBulleted.vue'
import MapIcon from 'vue-material-design-icons/Map.vue'
import { showError } from '@nextcloud/dialogs'
import { getAirportsByCodes } from '../api.ts'
import { applyFilters, buildFilters, type ActiveFilter } from '../filters.ts'
import { useFlightsStore } from '../store/flights.ts'
import { aircraftDisplay, type Airport, type Flight } from '../types.ts'
import {
	DISTANCE_BINS,
	EARTH_CIRCUMFERENCE_KM,
	EARTH_MOON_KM,
	WEEKDAYS,
	airportCodes,
	cabinBreakdown,
	comparisonPeriod,
	dateParts,
	distanceDistribution,
	flightYears,
	indexAirports,
	percentChange,
	periodSeries,
	rankAircraft,
	rankAirlines,
	rankAirports,
	rankManufacturers,
	rankRoutes,
	rankRoutesByDistanceFlown,
	records,
	summarize,
	weekdayCounts,
	yearOfRange,
	yearRange,
	type Summary,
} from '../analytics.ts'
import { themeCssVars, useChartTheme } from '../chartTheme.ts'
import BarChart from '../components/analytics/BarChart.vue'
import BubbleChart from '../components/analytics/BubbleChart.vue'
import PolarChart from '../components/analytics/PolarChart.vue'
import DonutBreakdown, { type BreakdownSegment } from '../components/analytics/DonutBreakdown.vue'
import RankedList, { type RankedRow } from '../components/analytics/RankedList.vue'

const route = useRoute()
const router = useRouter()
const store = useFlightsStore()
const theme = useChartTheme()

const loading = ref(true)
const airports = ref<Airport[]>([])
const airportIndex = computed(() => indexAirports(airports.value))

onMounted(async () => {
	try {
		if (!store.loaded) await store.fetchAll()
	} catch {
		showError('Failed to load flights')
		loading.value = false
		return
	}
	try {
		// Reference rows for countries and city names; everything else works
		// without them.
		const codes = [...airportCodes(store.flights)]
		airports.value = codes.length > 0 ? await getAirportsByCodes(codes) : []
	} catch {
		showError('Failed to load airport details')
	} finally {
		loading.value = false
	}
})

// --- Formatting ------------------------------------------------------------------

const number = new Intl.NumberFormat()
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const fmt = (n: number) => number.format(Math.round(n))
const monthName = (i: number) => new Date(Date.UTC(2000, i, 1)).toLocaleString(undefined, { month: 'long', timeZone: 'UTC' })
const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`

// --- Filters and the year picker -----------------------------------------------------

const allFilters = computed<ActiveFilter[]>(() => buildFilters(route.query, store.flights))
const selectedYear = computed(() => yearOfRange(route.query.dateFrom, route.query.dateTo))
const hasDateFilter = computed(() => allFilters.value.some((f) => f.id === 'date'))

// The picker already shows a whole-year range; any other range keeps its chip.
const chips = computed(() => allFilters.value.filter((f) => !(f.id === 'date' && selectedYear.value !== null)))

const filtered = computed(() => applyFilters(store.flights, allFilters.value))
// Everything but the date range: the population the year picker and the
// year-on-year comparison choose from.
const undated = computed(() => applyFilters(store.flights, allFilters.value.filter((f) => f.id !== 'date')))

interface YearOption { id: string, label: string }

const yearOptions = computed<YearOption[]>(() => {
	const years = flightYears(undated.value)
	if (selectedYear.value !== null && !years.some((y) => y.year === selectedYear.value)) {
		years.push({ year: selectedYear.value, count: 0 })
		years.sort((a, b) => b.year - a.year)
	}
	const options: YearOption[] = [
		{ id: 'all', label: `All years (${plural(undated.value.length, 'flight')})` },
		...years.map((y) => ({ id: String(y.year), label: `${y.year} (${plural(y.count, 'flight')})` })),
	]
	if (hasDateFilter.value && selectedYear.value === null) options.push({ id: 'custom', label: 'Custom date range' })
	return options
})

const yearSelection = computed<YearOption>(() => {
	const id = selectedYear.value !== null ? String(selectedYear.value) : hasDateFilter.value ? 'custom' : 'all'
	return yearOptions.value.find((o) => o.id === id) ?? yearOptions.value[0]
})

function selectYear(option: YearOption | null) {
	if (!option || option.id === 'custom') return
	const query: LocationQuery = { ...route.query }
	delete query.dateFrom
	delete query.dateTo
	if (option.id !== 'all') Object.assign(query, yearRange(Number(option.id)))
	router.push({ name: 'analytics', query })
}

function clearFilter(filter: ActiveFilter) {
	const query: LocationQuery = { ...route.query }
	for (const key of filter.queryKeys) delete query[key]
	router.push({ name: 'analytics', query })
}

const headerCount = computed(() => {
	const total = store.flights.length
	const shown = filtered.value.length
	return allFilters.value.length === 0 || shown === total
		? plural(total, 'flight')
		: `${fmt(shown)} of ${plural(total, 'flight')}`
})

/**
 * A link into the Flights view: the current filters plus the clicked row's.
 * An `undefined` value removes that key, so a click replaces a filter of the
 * same kind outright rather than inheriting half of it.
 *
 * @param {Record<string, string | undefined>} changes The row's own filter.
 */
function logLink(changes: Record<string, string | undefined>) {
	const query: LocationQuery = { ...route.query }
	for (const [key, value] of Object.entries(changes)) {
		if (value === undefined) delete query[key]
		else query[key] = value
	}
	return { name: 'flights', query }
}

/**
 * Drill from a chart element into the log.
 *
 * @param {Record<string, string | undefined>} changes The element's filter.
 */
function drill(changes: Record<string, string | undefined>) {
	router.push(logLink(changes))
}

function viewIn(name: 'flights' | 'map') {
	router.push({ name, query: { ...route.query } })
}

// --- Summary tiles -----------------------------------------------------------------------

const summary = computed(() => summarize(filtered.value, airportIndex.value))

const comparison = computed(() => {
	if (selectedYear.value === null) return null
	const today = new Date()
	const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
	const period = comparisonPeriod(undated.value, selectedYear.value, iso)
	if (period.previous.length === 0) return null
	return {
		label: period.label,
		current: summarize(period.current, airportIndex.value),
		previous: summarize(period.previous, airportIndex.value),
	}
})

const tiles = computed(() => {
	const s = summary.value
	const defs: { label: string, value: string, pick: (x: Summary) => number | null }[] = [
		{ label: 'Flights', value: fmt(s.flights), pick: (x) => x.flights },
		{ label: 'Distance (km)', value: fmt(s.distanceKm), pick: (x) => x.distanceKm },
		{ label: 'Airports', value: fmt(s.airports), pick: (x) => x.airports },
		{ label: 'Countries', value: s.countries === null ? '–' : fmt(s.countries), pick: (x) => x.countries },
		{ label: 'Airlines', value: fmt(s.airlines), pick: (x) => x.airlines },
	]
	return defs.map((d) => {
		const c = comparison.value
		const now = c ? d.pick(c.current) : null
		const before = c ? d.pick(c.previous) : null
		const change = now !== null && before !== null ? percentChange(now, before) : null
		const sign = change === null ? '' : change > 0 ? '+' : change < 0 ? '−' : '±'
		return {
			label: d.label,
			value: d.value,
			delta: change === null ? null : `${sign}${Math.abs(change)}% ${c!.label}`,
		}
	})
})

// --- Flights and distance per period ---------------------------------------------------------

const series = computed(() => periodSeries(filtered.value))

const seriesYear = computed(() => (filtered.value.length > 0
	? dateParts(filtered.value[0].flightDate).year
	: selectedYear.value))

const periodTitle = (i: number) => (series.value.unit === 'month'
	? `${monthName(i)} ${seriesYear.value ?? ''}`.trim()
	: series.value.labels[i])

const perUnit = computed(() => (series.value.unit === 'month' ? 'month' : 'year'))

// A column is a month or a year; either drills as a date range.
function drillPeriod(i: number) {
	if (series.value.unit === 'year') {
		drill(yearRange(Number(series.value.labels[i])))
		return
	}
	const year = seriesYear.value!
	const month = String(i + 1).padStart(2, '0')
	const lastDay = new Date(Date.UTC(year, i + 1, 0)).getUTCDate()
	drill({ dateFrom: `${year}-${month}-01`, dateTo: `${year}-${month}-${lastDay}` })
}

// --- Distance in context -------------------------------------------------------------------

const laps = computed(() => summary.value.distanceKm / EARTH_CIRCUMFERENCE_KM)
const MAX_GLOBES = 12
const globes = computed(() => Array.from(
	{ length: Math.min(MAX_GLOBES, Math.ceil(laps.value)) },
	(_, i) => Math.min(1, laps.value - i),
))
const moon = computed(() => (summary.value.distanceKm / EARTH_MOON_KM) * 100)

// --- Rankings ----------------------------------------------------------------------------------

const airlineRows = computed<RankedRow[]>(() => rankAirlines(filtered.value).map((r) => ({
	key: r.key,
	label: r.label,
	count: r.count,
	to: logLink({ airline: r.key }),
})))

const airportRows = computed<RankedRow[]>(() => rankAirports(filtered.value).map((r) => {
	const a = airportIndex.value.get(r.key)
	const place = a?.city || a?.name || ''
	return {
		key: r.key,
		label: place ? `${r.key} · ${place}` : r.key,
		detail: a?.countryIso2 ?? undefined,
		count: r.count,
		to: logLink({ airport: r.key, airportDir: 'either' }),
	}
}))

const aircraftRanking = computed(() => rankAircraft(filtered.value))
const aircraftRows = computed<RankedRow[]>(() => aircraftRanking.value.map((r) => ({
	key: r.key,
	label: r.label,
	count: r.count,
	to: logLink({ aircraft: r.label }),
})))

// The top few manufacturers by name, the rest as one "Other" slice — a
// doughnut stops being readable past a handful of slices. Manufacturers have no
// natural order, so the shades follow rank — largest takes the page palette's
// strongest step, then the next two down — and every slice is named in the
// legend. "Other" drills into all of its manufacturers at once.
const NAMED_MANUFACTURERS = 3
const manufacturers = computed(() => rankManufacturers(filtered.value))
const manufacturerSegments = computed<BreakdownSegment[]>(() => {
	const named = manufacturers.value.slice(0, NAMED_MANUFACTURERS)
	const rest = manufacturers.value.slice(NAMED_MANUFACTURERS)
	const { palette } = theme.value
	const segments: BreakdownSegment[] = named.map((r, i) => ({
		key: r.key,
		label: r.label,
		count: r.count,
		color: palette[palette.length - 1 - i],
		to: logLink({ manufacturer: r.key }),
	}))
	if (rest.length > 0) {
		segments.push({
			key: '(other)',
			label: `Other (${rest.length})`,
			count: rest.reduce((sum, r) => sum + r.count, 0),
			color: theme.value.neutral,
			to: logLink({ manufacturer: rest.map((r) => r.key).join(',') }),
		})
	}
	return segments
})
const withManufacturer = computed(() => manufacturers.value.reduce((sum, r) => sum + r.count, 0))

// --- Cabin -----------------------------------------------------------------------------------------

const cabins = computed(() => cabinBreakdown(filtered.value))
const cabinLogged = computed(() => filtered.value.length - cabins.value.notLogged)

// Economy → first is ordered, so it climbs the page palette — steps 2 to 5, so
// the usually dominant economy ring isn't the faintest shade. "Other" sits
// outside the scale, in neutral grey.
const CABIN_STEP: Record<string, number> = { economy: 1, premium_economy: 2, business: 3, first: 4 }
const cabinSegments = computed<BreakdownSegment[]>(() => cabins.value.classes
	.filter((c) => c.count > 0)
	.map((c) => ({
		key: c.value,
		label: c.label,
		count: c.count,
		color: c.value in CABIN_STEP ? theme.value.palette[CABIN_STEP[c.value]] : theme.value.neutral,
		to: logLink({ cabin: c.value }),
	})))

// --- Top routes ----------------------------------------------------------------------------------

// By number of flights: a ranked list like Airlines and Airports, showing the
// same number of rows as they do (RankedList's limit); a list row needs no
// distance, so every route qualifies. By distance flown — flights × distance —
// the top 8 as bubbles placed by distance, which leaves out routes without one.
const TOP_ROUTES_BY_DISTANCE = 8
const routes = computed(() => rankRoutes(filtered.value))
const routesWithoutDistance = computed(() => routes.value.filter((r) => r.distanceKm === null).length)

// Styled like Airlines and Airports: a ranked list linking each route to the log.
const routeRows = computed<RankedRow[]>(() => routes.value.map((r) => ({
	key: `${r.a} ${r.b}`,
	label: `${r.a} ↔ ${r.b}`,
	count: r.count,
	to: logLink({ routeA: r.a, routeB: r.b, routeDir: 'both' }),
})))

const topRoutesByDistance = computed(() => rankRoutesByDistanceFlown(filtered.value).slice(0, TOP_ROUTES_BY_DISTANCE))

function drillRouteByDistance(i: number) {
	const { a, b } = topRoutesByDistance.value[i]
	drill({ routeA: a, routeB: b, routeDir: 'both' })
}

// --- Distance distribution and weekdays ----------------------------------------------------------

const distances = computed(() => distanceDistribution(filtered.value))
const weekdays = computed(() => weekdayCounts(filtered.value))

// The bins' own bounds, so the filter returns exactly the bar's count.
function drillDistance(i: number) {
	const below = DISTANCE_BINS[i].below
	drill({
		distanceMin: i === 0 ? undefined : String(DISTANCE_BINS[i - 1].below),
		distanceMax: below === Infinity ? undefined : String(below),
	})
}

const drillWeekday = (i: number) => drill({ weekday: WEEKDAYS[i].toLowerCase() })
// 2024-01-01 was a Monday, matching WEEKDAYS' Monday-first order.
const weekdayName = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleString(undefined, { weekday: 'long', timeZone: 'UTC' })

// --- Records --------------------------------------------------------------------------------------

const best = computed(() => records(filtered.value))

const routeText = (f: Flight) => `${f.originCode || f.originLabel || '?'} → ${f.destinationCode || f.destinationLabel || '?'}`
const flightDetail = (f: Flight) => [
	`${f.airlineCode ?? ''}${f.flightNumber ?? ''}`.trim(),
	aircraftDisplay(f),
	f.flightDate,
].filter(Boolean).join(' · ')

const recordCards = computed(() => {
	const r = best.value
	const cards: { label: string, big: string, detail: string, stat: string, unit: string, to?: object }[] = []
	if (r.longest) {
		cards.push({ label: 'Longest flight', big: routeText(r.longest), detail: flightDetail(r.longest), stat: fmt(r.longest.distanceKm!), unit: 'km', to: logLink({ flight: String(r.longest.id) }) })
	}
	if (r.shortest && r.shortest !== r.longest) {
		cards.push({ label: 'Shortest flight', big: routeText(r.shortest), detail: flightDetail(r.shortest), stat: fmt(r.shortest.distanceKm!), unit: 'km', to: logLink({ flight: String(r.shortest.id) }) })
	}
	if (r.route) {
		cards.push({ label: 'Most-flown route', big: `${r.route.a} ↔ ${r.route.b}`, detail: 'Both directions combined', stat: fmt(r.route.count), unit: 'flights', to: logLink({ routeA: r.route.a, routeB: r.route.b, routeDir: 'both' }) })
	}
	if (r.airframe) {
		const f = r.airframe.flight
		cards.push({ label: 'Most-flown airframe', big: r.airframe.registration, detail: [f.airlineCode, aircraftDisplay(f)].filter(Boolean).join(' · '), stat: fmt(r.airframe.count), unit: 'flights', to: logLink({ registration: r.airframe.registration.toUpperCase() }) })
	}
	return cards
})

const missingDistance = computed(() => summary.value.flights - summary.value.withDistance)

const cssVars = computed(() => themeCssVars(theme.value))
</script>

<template>
	<div class="analytics" :style="cssVars">
		<h2>Analytics</h2>

		<div v-if="loading" class="analytics__loading">
			<NcLoadingIcon :size="44" />
		</div>

		<NcEmptyContent v-else-if="store.flights.length === 0"
			name="No flights yet"
			description="Statistics appear here once you have logged some flights.">
			<template #icon>
				<ChartBar />
			</template>
		</NcEmptyContent>

		<template v-else>
			<div class="toolbar">
				<div class="filter-bar">
					<NcSelect class="toolbar__year"
						:model-value="yearSelection"
						input-label="Period"
						:options="yearOptions"
						:clearable="false"
						:searchable="false"
						label="label"
						@update:model-value="selectYear" />
					<NcChip v-for="filter in chips"
						:key="filter.id"
						:text="filter.label"
						@close="clearFilter(filter)" />
					<span class="muted">{{ headerCount }}</span>
				</div>
				<div v-if="allFilters.length" class="toolbar__actions">
					<NcButton variant="secondary" @click="viewIn('flights')">
						<template #icon>
							<FormatListBulleted :size="20" />
						</template>
						View in log
					</NcButton>
					<NcButton variant="secondary" @click="viewIn('map')">
						<template #icon>
							<MapIcon :size="20" />
						</template>
						View on map
					</NcButton>
				</div>
			</div>

			<NcEmptyContent v-if="filtered.length === 0"
				name="No matching flights"
				description="No flights match the current period and filters.">
				<template #icon>
					<ChartBar />
				</template>
			</NcEmptyContent>

			<div v-else class="analytics__body">
				<section class="tiles" aria-label="Summary">
					<div v-for="tile in tiles" :key="tile.label" class="tile">
						<span class="tile__value">{{ tile.value }}</span>
						<span class="tile__label">{{ tile.label }}</span>
						<span v-if="tile.delta" class="tile__delta">{{ tile.delta }}</span>
					</div>
				</section>

				<section class="block" aria-labelledby="fj-period">
					<div class="block__head">
						<h3 id="fj-period">
							Flights and distance per {{ perUnit }}
						</h3>
					</div>
					<div class="grid">
						<div class="cell">
							<div class="cell__head">
								<h4>Number of flights</h4>
								<span class="muted">{{ plural(summary.flights, 'flight') }}</span>
							</div>
							<div class="cell__body">
								<BarChart :theme="theme"
									:labels="series.labels"
									:values="series.flights"
									name="Flights"
									:format="fmt"
									:tooltip-title="periodTitle"
									:summary="`Flights per ${perUnit}`"
									clickable
									@select="drillPeriod" />
							</div>
						</div>
						<div class="cell">
							<div class="cell__head">
								<h4>Distance flown (km)</h4>
								<span class="muted">{{ fmt(summary.distanceKm) }} km</span>
							</div>
							<div class="cell__body">
								<BarChart :theme="theme"
									:labels="series.labels"
									:values="series.km"
									name="Kilometres"
									:format="(n: number) => compact.format(n)"
									:tooltip-title="periodTitle"
									:summary="`Kilometres flown per ${perUnit}`"
									clickable
									@select="drillPeriod" />
							</div>
						</div>
					</div>
				</section>

				<section class="block" aria-labelledby="fj-routes">
					<div class="block__head">
						<h3 id="fj-routes">
							Top routes
						</h3>
					</div>
					<div class="grid">
						<div class="cell">
							<div class="cell__head">
								<h4>By number of flights</h4>
							</div>
							<div class="cell__body">
								<RankedList v-if="routeRows.length"
									:rows="routeRows"
									name="Most-flown routes by number of flights" />
								<p v-else class="hint">
									No routes between recognised airports.
								</p>
							</div>
						</div>
						<div class="cell">
							<div class="cell__head">
								<h4>By distance flown</h4>
							</div>
							<div class="cell__body">
								<BubbleChart v-if="topRoutesByDistance.length"
									:theme="theme"
									:rows="topRoutesByDistance.map((r) => ({ label: `${r.a} ↔ ${r.b}`, x: r.distanceKm!, value: r.count, note: `${compact.format(r.totalKm)} km` }))"
									summary="Routes with the most distance flown, by distance and number of flights"
									x-name="Distance"
									value-name="Flights"
									note-name="Distance flown"
									:format-x="(km: number) => `${compact.format(km)} km`"
									:format-value="fmt"
									clickable
									@select="drillRouteByDistance" />
								<p class="hint">
									Ranked by distance flown on the route: number of flights × distance. Bubble indicates
									the number of flights.
									<template v-if="routesWithoutDistance > 0">
										{{ plural(routesWithoutDistance, 'route') }} without a distance not shown.
									</template>
								</p>
							</div>
						</div>
					</div>
				</section>

				<section class="grid" aria-label="Distance">
					<div class="block">
						<h3>Distance in context</h3>
						<div class="cell__body">
							<div class="context">
								<h4>Earth circumferences</h4>
								<span class="figure">{{ laps.toFixed(2) }}×</span>
								<div class="globes" aria-hidden="true">
									<span v-for="(fill, i) in globes"
										:key="i"
										class="globe"
										:style="{ '--fill': `${Math.round(fill * 360)}deg` }" />
									<span v-if="laps > MAX_GLOBES" class="muted">+{{ Math.ceil(laps) - MAX_GLOBES }}</span>
								</div>
								<p class="hint">
									One circumference is {{ fmt(EARTH_CIRCUMFERENCE_KM) }} km.
								</p>
							</div>
							<div class="context">
								<h4>Earth–Moon distance</h4>
								<span class="figure">{{ moon.toFixed(1) }}%</span>
								<span class="meter" aria-hidden="true">
									<span class="meter__fill" :style="{ width: `${Math.min(100, moon)}%` }" />
								</span>
								<p class="hint">
									The average Earth–Moon distance is {{ fmt(EARTH_MOON_KM) }} km.
								</p>
							</div>
						</div>
					</div>
					<div class="block">
						<div class="block__head">
							<h3>Distance distribution</h3>
							<span v-if="distances.median !== null" class="muted">median {{ fmt(distances.median) }} km</span>
						</div>
						<div class="cell__body">
							<BarChart :theme="theme"
								:labels="DISTANCE_BINS.map((b) => b.label)"
								:values="distances.counts"
								name="Flights"
								:format="fmt"
								:height="230"
								summary="Flights by great-circle distance"
								horizontal
								clickable
								@select="drillDistance" />
						</div>
					</div>
				</section>

				<section class="grid" aria-label="Airlines and airports">
					<div class="block">
						<div class="block__head">
							<h3>Airlines</h3>
							<span class="muted">{{ airlineRows.length }} total</span>
						</div>
						<div class="cell__body">
							<RankedList :rows="airlineRows" name="Airlines by flights" />
							<p v-if="airlineRows.length === 0" class="hint">
								No airline codes logged.
							</p>
						</div>
					</div>
					<div class="block">
						<div class="block__head">
							<h3>Airports</h3>
							<span class="muted">{{ airportRows.length }} total</span>
						</div>
						<div class="cell__body">
							<RankedList :rows="airportRows" name="Airports by flights" />
							<p v-if="airportRows.length === 0" class="hint">
								No recognised airports.
							</p>
						</div>
					</div>
				</section>

				<section class="block" aria-labelledby="fj-aircraft">
					<div class="block__head">
						<h3 id="fj-aircraft">
							Aircraft
						</h3>
					</div>
					<div class="grid">
						<div class="cell">
							<div class="cell__head">
								<h4>Manufacturers</h4>
								<span class="muted">{{ plural(manufacturers.length, 'manufacturer') }}</span>
							</div>
							<div class="cell__body">
								<DonutBreakdown :theme="theme"
									:segments="manufacturerSegments"
									summary="Flights by aircraft manufacturer" />
								<p class="hint">
									{{ fmt(withManufacturer) }} of {{ plural(filtered.length, 'flight') }} with a known manufacturer.
								</p>
							</div>
						</div>
						<div class="cell">
							<div class="cell__head">
								<h4>Types</h4>
								<span class="muted">{{ plural(aircraftRanking.length, 'type') }}</span>
							</div>
							<div class="cell__body">
								<RankedList :rows="aircraftRows" name="Aircraft types by flights" />
								<p v-if="aircraftRows.length === 0" class="hint">
									No aircraft logged.
								</p>
							</div>
						</div>
					</div>
				</section>

				<section class="grid" aria-label="Cabin class and day of week">
					<div class="block">
						<h3>Cabin class</h3>
						<div class="cell__body">
							<DonutBreakdown :theme="theme"
								:segments="cabinSegments"
								summary="Flights by cabin class" />
							<p class="hint">
								{{ fmt(cabinLogged) }} of {{ plural(filtered.length, 'flight') }} with a cabin class logged.
							</p>
						</div>
					</div>
					<div class="block">
						<h3>Days of week</h3>
						<div class="cell__body">
							<PolarChart :theme="theme"
								:labels="WEEKDAYS"
								:values="weekdays"
								name="Flights"
								:format="fmt"
								:tooltip-title="weekdayName"
								summary="Flights by day of week"
								clickable
								@select="drillWeekday" />
						</div>
					</div>
				</section>

				<section v-if="recordCards.length" class="block" aria-labelledby="fj-records">
					<h3 id="fj-records">
						Records
					</h3>
					<div class="records">
						<component :is="card.to ? RouterLink : 'div'"
							v-for="card in recordCards"
							:key="card.label"
							:to="card.to"
							class="record"
							:class="{ 'record--link': card.to }">
							<span class="record__main">
								<span class="record__label">{{ card.label }}</span>
								<span class="record__big">{{ card.big }}</span>
								<span class="record__detail">{{ card.detail }}</span>
							</span>
							<span class="record__stat">
								<span class="record__value">{{ card.stat }}</span>
								<span class="record__unit">{{ card.unit }}</span>
							</span>
						</component>
					</div>
				</section>

				<p v-if="missingDistance > 0" class="hint">
					{{ fmt(missingDistance) }} of {{ plural(summary.flights, 'flight') }} have no distance (an airport without
					reference coordinates) and are left out of the distance figures.
				</p>
			</div>
		</template>
	</div>
</template>

<style scoped>
.analytics {
	padding: 16px;
	max-width: 1200px;
}

.analytics__loading {
	display: flex;
	justify-content: center;
	padding: 48px 0;
}

.analytics__body {
	display: flex;
	flex-direction: column;
	gap: 36px;
}

.toolbar {
	display: flex;
	flex-direction: column;
	margin-bottom: 24px;
}

/* NcSelect's own block margins would make this row taller than the Flights
   and Map ones; the floating "Period" label overhangs into the margin above. */
.filter-bar .toolbar__year.nc-select {
	flex: 0 1 280px;
	margin-block: 0;
}

.filter-bar,
.toolbar__actions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
}

/* Same height and margins as the Flights and Map filter rows, so the action
   buttons below sit at the same offset from the heading on all three. */
.filter-bar {
	min-height: var(--default-clickable-area);
	margin-top: 8px;
	margin-bottom: 6px;
}

.muted {
	color: var(--color-text-maxcontrast);
}

h3 {
	margin: 0;
	font-size: 17px;
	font-weight: bold;
}

h4 {
	margin: 0;
	font-size: 15px;
	font-weight: 600;
}

.hint {
	margin: 0;
	font-size: 13px;
	color: var(--color-text-maxcontrast);
}

.tiles {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 16px;
}

.tile {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	padding: 20px 12px;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-container, 12px);
	text-align: center;
}

.tile__value {
	font-size: 28px;
	font-weight: 600;
	line-height: 1.2;
}

.tile__label {
	font-size: 13px;
}

.tile__delta {
	font-size: 12px;
	color: var(--color-text-maxcontrast);
}

.block {
	display: flex;
	flex-direction: column;
	gap: 14px;
	min-width: 0;
}

.block__head,
.cell__head {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: baseline;
	gap: 12px;
}

.grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 24px 32px;
}

.cell {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
}

/* Everything under a two-column half's heading. The grid gives both halves the
   taller one's height; the body fills what is left under the heading and centres
   its content in it, so a short chart beside a long list sits in the middle
   rather than leaving all the space at the bottom. Headings stay level across
   the row. Every half of every two-column row uses it. */
.cell__body {
	flex: 1;
	display: flex;
	flex-direction: column;
	justify-content: center;
	gap: 14px;
}

/* One of the stacked "Distance in context" figures: subheading, number, visual, note. */
.context {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.context + .context {
	margin-top: 16px;
}

.figure {
	font-size: 28px;
	font-weight: 600;
}

.globes {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
}

/* A meter per lap: the filled arc in the primary, the track in its light step. */
.globe {
	width: 32px;
	height: 32px;
	border-radius: 50%;
	background:
		radial-gradient(circle, var(--color-main-background) 0 10px, transparent 11px),
		conic-gradient(var(--fj-chart-primary) 0 var(--fill), var(--color-primary-light) var(--fill) 360deg);
}

.meter {
	display: block;
	height: 8px;
	margin: 12px 0;
	border-radius: 4px;
	background: var(--color-primary-light);
}

.meter__fill {
	display: block;
	height: 100%;
	border-radius: 4px;
	background: var(--fj-chart-primary);
}

.records {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
	gap: 16px;
}

.record {
	display: flex;
	min-width: 0;
	border: 1px solid var(--color-border-dark);
	border-radius: var(--border-radius-container, 12px);
	color: var(--color-main-text);
	overflow: hidden;
}

.record--link:hover,
.record--link:focus-visible {
	background: var(--color-background-hover);
}

.record__main {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 14px 16px;
}

.record__label,
.record__detail {
	font-size: 13px;
	color: var(--color-text-maxcontrast);
}

.record__big {
	font-size: 19px;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.record__stat {
	flex: none;
	width: 88px;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 2px;
	border-inline-start: 1px solid var(--color-border-dark);
}

.record__value {
	font-size: 20px;
	font-weight: 600;
}

.record__unit {
	font-size: 12px;
	color: var(--color-text-maxcontrast);
}

@media (max-width: 900px) {
	.grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
