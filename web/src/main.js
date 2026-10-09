import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import { initTheme } from './composables/useTheme.js';
import './style.css';

initTheme();
createApp(App).use(router).mount('#app');
