import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import PlantsView from '../views/PlantsView.vue';
import PlantDetailView from '../views/PlantDetailView.vue';
import LoginView from '../views/LoginView.vue';
import DevicesView from '../views/DevicesView.vue';
import DeviceDetailView from '../views/DeviceDetailView.vue';
import { getSession, supabase } from '../services/supabase.js';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/plants', name: 'plants', component: PlantsView },
    { path: '/devices', name: 'devices', component: DevicesView },
    { path: '/devices/:id', name: 'device-detail', component: DeviceDetailView },
    { path: '/plants/:id', name: 'plant-detail', component: PlantDetailView },
  ],
});

router.beforeEach(async to => {
  const session = await getSession();
  if (to.name !== 'login' && !session) return { name: 'login' };
  if (to.name === 'login' && session) return { name: 'dashboard' };
});

const subscription = supabase?.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT' && !session) {
    setTimeout(() => { void router.replace('/login'); }, 0);
  }
}).data.subscription;
if (import.meta.hot) import.meta.hot.dispose(() => subscription?.unsubscribe());

export default router;
