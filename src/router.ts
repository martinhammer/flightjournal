import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router'
import EditFlightLog from './views/EditFlightLog.vue'
import ViewFlightLog from './views/ViewFlightLog.vue'
import MapView from './views/MapView.vue'
import AnalyticsView from './views/AnalyticsView.vue'

const routes: RouteRecordRaw[] = [
	{ path: '/', redirect: '/view' },
	{ path: '/edit', name: 'edit', component: EditFlightLog },
	{ path: '/edit/:id', name: 'edit-existing', component: EditFlightLog, props: true },
	{ path: '/view', name: 'view', component: ViewFlightLog },
	{ path: '/map', name: 'map', component: MapView },
	{ path: '/analytics', name: 'analytics', component: AnalyticsView },
]

export const router = createRouter({
	history: createWebHashHistory(),
	routes,
})
