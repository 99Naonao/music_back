<template>
  <div>
    <h2>漏斗与留存</h2>
    <div class="card filter-card">
      <div class="filter-bar">
        <label class="filter-field">
          <span>开始</span>
          <input v-model="from" type="date" />
        </label>
        <label class="filter-field">
          <span>结束</span>
          <input v-model="to" type="date" />
        </label>
        <label class="filter-field">
          <span>渠道</span>
          <select v-model="channel">
            <option v-for="c in channelOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <button @click="load" :disabled="loading">刷新</button>
      </div>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <template v-else-if="funnel">
      <div class="card">
        <h3>转化漏斗（{{ funnel.from }} ~ {{ funnel.to }}）</h3>
        <FunnelChart :steps="funnel.steps" />
        <table class="table compact">
          <thead>
            <tr>
              <th>步骤</th>
              <th>人数/次数</th>
              <th>占启动比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in funnel.steps" :key="s.key">
              <td>{{ s.label }}</td>
              <td>{{ s.count }}</td>
              <td>{{ s.rateFromLaunch != null ? s.rateFromLaunch + '%' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>7 日留存</h3>
        <div class="form-row inline">
          <label class="filter-field">
            <span>cohort 日期</span>
            <input v-model="cohortDate" type="date" @change="loadRetention" />
          </label>
        </div>
        <p class="meta">D0 启动用户 {{ retention?.cohortSize ?? '—' }} 人（{{ retention?.cohortDate }}）</p>
        <div class="ret-grid" v-if="retention">
          <div class="ret-item">
            <span>D1</span>
            <strong>{{ retention.d1.rate != null ? retention.d1.rate + '%' : '—' }}</strong>
            <small>{{ retention.d1.count }} 人</small>
          </div>
          <div class="ret-item">
            <span>D3</span>
            <strong>{{ retention.d3.rate != null ? retention.d3.rate + '%' : '—' }}</strong>
            <small>{{ retention.d3.count }} 人</small>
          </div>
          <div class="ret-item">
            <span>D7</span>
            <strong>{{ retention.d7.rate != null ? retention.d7.rate + '%' : '—' }}</strong>
            <small>{{ retention.d7.count }} 人</small>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import FunnelChart from '../components/FunnelChart.vue'
import { fetchFunnel, fetchRetention, fetchStatsChannelOptions } from '../api'

const from = ref('')
const to = ref('')
const channel = ref('all')
const cohortDate = ref('')
const channelOptions = ref([{ id: 'all', name: '全部' }])
const funnel = ref(null)
const retention = ref(null)
const loading = ref(false)
const error = ref('')

function query() {
  const q = { from: from.value, to: to.value }
  if (channel.value && channel.value !== 'all') q.channel = channel.value
  return q
}

async function loadRetention() {
  try {
    const q = { channel: channel.value !== 'all' ? channel.value : undefined }
    if (cohortDate.value) q.cohortDate = cohortDate.value
    retention.value = await fetchRetention(q)
    if (!cohortDate.value && retention.value.cohortDate) {
      cohortDate.value = retention.value.cohortDate
    }
  } catch (e) {
    /* ignore retention-only errors */
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    funnel.value = await fetchFunnel(query())
    if (funnel.value.from) from.value = funnel.value.from
    if (funnel.value.to) to.value = funnel.value.to
    await loadRetention()
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const opts = await fetchStatsChannelOptions()
    channelOptions.value = opts.list || channelOptions.value
  } catch (e) {
    /* ignore */
  }
  await load()
})
</script>

<style scoped>
h2 {
  margin: 0 0 16px;
}
.card h3 {
  margin-top: 0;
}
.compact {
  margin-top: 16px;
}
.meta {
  font-size: 14px;
  color: var(--muted);
}
.inline {
  margin-bottom: 12px;
}
.inline :deep(input[type='date']) {
  width: auto;
  min-width: 132px;
  max-width: 168px;
}
.ret-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 12px;
}
.ret-item {
  padding: 16px;
  background: #f6f4f9;
  border-radius: 8px;
  text-align: center;
}
.ret-item span {
  font-size: 12px;
  color: var(--muted);
}
.ret-item strong {
  display: block;
  font-size: 28px;
  margin: 6px 0;
}
.ret-item small {
  color: var(--muted);
}
</style>
