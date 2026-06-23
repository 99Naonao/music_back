<template>
  <div>
    <h2>管理员账号</h2>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="msg" class="success-msg">{{ msg }}</p>

    <div class="card">
      <h3>新建管理员</h3>
      <div class="form-row grid-2">
        <div>
          <label>用户名</label>
          <input v-model="form.username" />
        </div>
        <div>
          <label>初始密码</label>
          <input v-model="form.password" type="password" />
        </div>
      </div>
      <div class="form-row grid-2">
        <div>
          <label>角色</label>
          <select v-model="form.role">
            <option value="super">super</option>
            <option value="operator">operator</option>
            <option value="readonly">readonly</option>
            <option value="partner">partner</option>
          </select>
        </div>
        <div v-if="form.role === 'partner'">
          <label>绑定渠道 ID</label>
          <input v-model="form.partnerChannelId" />
        </div>
      </div>
      <button @click="onCreate" :disabled="creating">{{ creating ? '创建中…' : '创建' }}</button>
    </div>

    <div class="card">
      <p v-if="loading">加载中…</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>用户名</th>
            <th>角色</th>
            <th>状态</th>
            <th>最近登录</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in list" :key="u.id">
            <td>{{ u.username }}</td>
            <td><code>{{ u.role }}</code></td>
            <td>{{ u.isActive ? '正常' : '已禁用' }}</td>
            <td>{{ u.lastLoginAt || '—' }}</td>
            <td>
              <button type="button" class="secondary small" @click="toggleActive(u)">
                {{ u.isActive ? '禁用' : '启用' }}
              </button>
              <button type="button" class="secondary small" @click="resetPwd(u)">重置密码</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { createAdmin, listAdmins, patchAdmin } from '../api'

const list = ref([])
const loading = ref(true)
const creating = ref(false)
const error = ref('')
const msg = ref('')
const form = reactive({
  username: '',
  password: '',
  role: 'operator',
  partnerChannelId: ''
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listAdmins()
    list.value = data.list || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function onCreate() {
  creating.value = true
  error.value = ''
  msg.value = ''
  try {
    await createAdmin({ ...form })
    msg.value = '已创建'
    form.username = ''
    form.password = ''
    await load()
  } catch (e) {
    error.value = e.message || '创建失败'
  } finally {
    creating.value = false
  }
}

async function toggleActive(u) {
  try {
    await patchAdmin(u.id, { isActive: !u.isActive })
    await load()
  } catch (e) {
    error.value = e.message || '操作失败'
  }
}

async function resetPwd(u) {
  const pwd = window.prompt(`为 ${u.username} 设置新密码（至少 8 位）`)
  if (!pwd) return
  try {
    await patchAdmin(u.id, { password: pwd })
    msg.value = '密码已重置'
  } catch (e) {
    error.value = e.message || '重置失败'
  }
}

onMounted(load)
</script>

<style scoped>
h2 {
  margin: 0 0 16px;
}
h3 {
  margin-top: 0;
}
.small {
  font-size: 12px;
  padding: 4px 8px;
  margin-right: 6px;
}
.success-msg {
  color: var(--success);
}
</style>
