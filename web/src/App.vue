<script setup>
import AppLayout from './layouts/AppLayout.vue';
import { useRoute } from 'vue-router';
const route = useRoute();
</script>

<template>
  <RouterView v-if="route.name === 'login'" />
  <AppLayout v-else>
    <RouterView />
  </AppLayout>
</template>
