<template>
  <div>
    <div class="head">
      <h2>运营弹窗</h2>
      <router-link to="/promo/new" class="btn">新建活动</router-link>
    </div>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading">加载中…</p>
    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>标题</th>
            <th>优先级</th>
            <th>状态</th>
            <th>场景</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in list" :key="row.id">
            <td><code>{{ row.id }}</code></td>
            <td>{{ row.title }}</td>
            <td>{{ row.priority }}</td>
            <td>
              <span :class="['badge', row.enabled ? 'active' : 'disabled']">
                {{ row.enabled ? '启用' : '停用' }}
              </span>
            </td>
            <td class="scenes">{{ (row.scenes || []).join(', ') }}</td>
            <td>
              <router-link :to="`/promo/${row.id}`">编辑</router-link>
              <button class="linkish" @click="toggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { listPromoCampaigns, patchPromoStatus } from '../api'

const list = ref([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listPromoCampaigns()
    list.value = data.list || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function toggle(row) {
  try {
    await patchPromoStatus(row.id, { enabled: !row.enabled })
    await load()
  } catch (e) {
    error.value = e.message || '操作失败'
  }
}

onMounted(load)
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
h2 {
  margin: 0;
}
.scenes {
  font-size: 12px;
  color: var(--muted);
  max-width: 200px;
}
.linkish {
  background: none;
  color: var(--primary);
  padding: 0 0 0 12px;
  font-size: 14px;
}
</style>
