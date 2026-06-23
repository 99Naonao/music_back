<template>
  <div>
    <div class="head">
      <h2>贺卡模板</h2>
      <button @click="onSync" :disabled="syncing">{{ syncing ? '同步中…' : '从 manifest 同步' }}</button>
    </div>
    <p v-if="syncInfo" class="meta">{{ syncInfo.syncHint }} · DB {{ syncInfo.dbTemplateCount }} 条</p>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <div class="card">
      <p v-if="loading">加载中…</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>名称</th>
            <th>分类</th>
            <th>排序</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in list" :key="t.id">
            <td><code>{{ t.id }}</code> {{ t.name }}</td>
            <td>{{ t.categoryName || t.categoryId }}</td>
            <td>{{ t.sortOrder }}</td>
            <td>{{ t.enabled ? '启用' : '停用' }}</td>
            <td>
              <button type="button" class="secondary small" @click="toggle(t)">
                {{ t.enabled ? '停用' : '启用' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { fetchCardSyncInfo, listCardTemplates, patchCardTemplate, syncCardTemplates } from '../api'

const list = ref([])
const syncInfo = ref(null)
const loading = ref(true)
const syncing = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  try {
    const [data, info] = await Promise.all([listCardTemplates(), fetchCardSyncInfo()])
    list.value = data.list || []
    syncInfo.value = info
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function toggle(t) {
  try {
    await patchCardTemplate(t.id, { enabled: !t.enabled })
    await load()
  } catch (e) {
    error.value = e.message || '操作失败'
  }
}

async function onSync() {
  syncing.value = true
  try {
    await syncCardTemplates()
    await load()
  } catch (e) {
    error.value = e.message || '同步失败'
  } finally {
    syncing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
h2 {
  margin: 0;
}
.meta {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 12px;
}
.small {
  font-size: 12px;
  padding: 4px 8px;
}
</style>
