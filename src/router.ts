import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'
import EditFlightLog from './views/EditFlightLog.vue'
import ViewFlightLog from './views/ViewFlightLog.vue'
import MapView from './views/MapView.vue'
import AnalyticsView from './views/AnalyticsView.vue'
import ViewAirports from './views/ViewAirports.vue'

const routes: RouteRecordRaw[] = [
	{ path: '/', redirect: '/flights' },
	{ path: '/flights', name: 'flights', component: ViewFlightLog },
	{ path: '/flights/:id/edit', name: 'flight-edit', component: EditFlightLog, props: true },
	{ path: '/map', name: 'map', component: MapView },
	{ path: '/analytics', name: 'analytics', component: AnalyticsView },
	{ path: '/airports', name: 'airports', component: ViewAirports },
]

export const router = createRouter({
	history: createWebHashHistory(),
	routes,
})
