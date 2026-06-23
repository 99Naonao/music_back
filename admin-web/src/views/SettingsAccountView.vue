<template>
  <div>
    <h2>修改密码</h2>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="msg" class="success-msg">{{ msg }}</p>
    <div class="card">
      <div class="form-row">
        <label>当前密码</label>
        <input v-model="currentPassword" type="password" autocomplete="current-password" />
      </div>
      <div class="form-row">
        <label>新密码（至少 8 位）</label>
        <input v-model="newPassword" type="password" autocomplete="new-password" />
      </div>
      <button @click="onSubmit" :disabled="saving">{{ saving ? '提交中…' : '保存' }}</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { changePassword } from '../api'

const currentPassword = ref('')
const newPassword = ref('')
const saving = ref(false)
const error = ref('')
const msg = ref('')

async function onSubmit() {
  saving.value = true
  error.value = ''
  msg.value = ''
  try {
    await changePassword(currentPassword.value, newPassword.value)
    msg.value = '密码已修改'
    currentPassword.value = ''
    newPassword.value = ''
  } catch (e) {
    error.value = e.message || '修改失败'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
h2 {
  margin: 0 0 16px;
}
.success-msg {
  color: var(--success);
}
</style>
