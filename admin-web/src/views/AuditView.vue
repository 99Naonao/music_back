<template>
  <div>
    <div class="head">
      <h2>操作日志</h2>
      <div class="filters">
        <input v-model="from" type="date" />
        <span>至</span>
        <input v-model="to" type="date" />
        <input v-model="action" placeholder="动作关键词" />
        <button @click="load" :disabled="loading">查询</button>
      </div>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>动作</th>
            <th>目标</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in list" :key="row.id">
            <td class="nowrap">{{ row.createdAt }}</td>
            <td>{{ row.username }}</td>
            <td><code>{{ row.action }}</code></td>
            <td>{{ row.targetType }} / {{ row.targetId || '—' }}</td>
            <td>{{ row.ip || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!list.length" class="empty">暂无日志</p>
      <div class="pager" v-if="totalPages > 1">
        <button class="secondary" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
        <span>{{ page }} / {{ totalPages }}</span>
        <button class="secondary" :disabled="page >= totalPages" @click="go(page + 1)">下一页</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { listAuditLogs } from '../api'

const list = ref([])
const loading = ref(true)
const error = ref('')
const page = ref(1)
const total = ref(0)
const limit = ref(30)
const from = ref('')
const to = ref('')
const action = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listAuditLogs({
      page: page.value,
      limit: limit.value,
      from: from.value,
      to: to.value,
      action: action.value.trim()
    })
    list.value = data.list || []
    total.value = data.total || 0
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function go(p) {
  page.value = p
  load()
}

onMounted(load)
</script>

<style scoped>
.nowrap {
  white-space: nowrap;
}
.pager {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
}
.empty {
  color: var(--muted);
}
code {
  font-size: 12px;
}
</style>
