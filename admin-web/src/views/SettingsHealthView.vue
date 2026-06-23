<template>
  <div>
    <h2>系统健康</h2>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading">加载中…</p>
    <template v-else-if="health">
      <div class="cards">
        <div class="card stat">
          <div class="label">Node</div>
          <div class="val">{{ health.nodeVersion }}</div>
        </div>
        <div class="card stat">
          <div class="label">环境</div>
          <div class="val">{{ health.env }}</div>
        </div>
        <div class="card stat">
          <div class="label">数据库大小</div>
          <div class="val">{{ health.dbSizeHuman }}</div>
        </div>
        <div class="card stat">
          <div class="label">运行时长</div>
          <div class="val">{{ uptimeLabel }}</div>
        </div>
      </div>
      <div class="card">
        <h3>表记录数</h3>
        <table class="table">
          <thead>
            <tr>
              <th>表</th>
              <th>行数</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(cnt, name) in health.tableCounts" :key="name">
              <td><code>{{ name }}</code></td>
              <td>{{ cnt ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p class="meta">导出任务缓存：{{ health.exportJobCount }} 个（24h 自动清理）</p>
        <p class="meta path">DB：{{ health.dbPath }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { fetchSystemHealth } from '../api'

const health = ref(null)
const loading = ref(true)
const error = ref('')

const uptimeLabel = computed(() => {
  const s = health.value?.uptimeSec || 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
})

onMounted(async () => {
  try {
    health.value = await fetchSystemHealth()
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
h2 {
  margin: 0 0 16px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat .label {
  font-size: 13px;
  color: var(--muted);
}
.stat .val {
  font-size: 20px;
  font-weight: 600;
  margin-top: 6px;
}
.meta {
  font-size: 13px;
  color: var(--muted);
}
.path {
  word-break: break-all;
}
</style>
