<template>
  <div class="login-page">
    <div class="login-card card">
      <h1>眠音盒 · 运营后台</h1>
      <p class="sub">渠道换皮与配置管理</p>
      <form @submit.prevent="onSubmit">
        <div class="form-row">
          <label>用户名</label>
          <input v-model="username" autocomplete="username" required />
        </div>
        <div class="form-row">
          <label>密码</label>
          <input v-model="password" type="password" autocomplete="current-password" required />
        </div>
        <p v-if="error" class="error-msg">{{ error }}</p>
        <button type="submit" :disabled="loading">{{ loading ? '登录中…' : '登录' }}</button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { login } from '../api'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    await login(username.value, password.value)
    const redirect = route.query.redirect || '/channels'
    router.replace(String(redirect))
  } catch (e) {
    error.value = e.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 400px;
}
h1 {
  margin: 0 0 8px;
  font-size: 22px;
}
.sub {
  margin: 0 0 24px;
  color: var(--muted);
  font-size: 14px;
}
button {
  width: 100%;
  margin-top: 8px;
}
</style>
