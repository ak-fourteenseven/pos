<script setup>
import SharedLogin from '@shared/views/LoginView.vue';
</script>

<template>
  <SharedLogin
    redirect="/reports"
    heading="POS 後台管理"
    sub="報表統計 · 菜品 / 桌台 / 員工 / 支付 / 時段設定 · 系統維護"
    hint="僅店長帳號可登入後台（收銀員請使用前台收銀系統）"
    manager-only
  />
</template>
