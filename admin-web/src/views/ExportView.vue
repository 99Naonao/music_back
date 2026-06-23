<template>
  <div>
    <div class="head">
      <h2>报表导出</h2>
    </div>
    <div class="card filter-card">
      <div class="filter-bar">
        <label class="filter-field">
          <span>开始日期</span>
          <input v-model="from" type="date" />
        </label>
        <label class="filter-field">
          <span>结束日期</span>
          <input v-model="to" type="date" />
        </label>
        <label class="filter-field">
          <span>渠道</span>
          <select v-model="channel">
            <option v-for="c in channelOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label class="filter-field">
          <span>报表类型</span>
          <select v-model="type">
            <option value="channel_stats">渠道日统计</option>
            <option value="feedback">用户反馈</option>
          </select>
        </label>
        <button @click="onPreview" :disabled="loading">预览</button>
        <button @click="onExport('csv')" :disabled="exporting">导出 CSV</button>
        <button @click="onExport('xlsx')" :disabled="exporting">导出 XLSX</button>
      </div>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="msg" class="success-msg">{{ msg }}</p>

    <div v-if="preview" class="card">
      <p class="meta">
        共 {{ preview.totalRows }} 行
        <span v-if="preview.truncated">（预览前 100 行）</span>
      </p>
      <div class="scroll">
        <table class="table">
          <thead>
            <tr>
              <th v-for="col in preview.columns" :key="col">{{ col }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in preview.rows" :key="i">
              <td v-for="col in preview.columns" :key="col">{{ row[col] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import {
  createExportJob,
  downloadExportJob,
  fetchStatsChannelOptions,
  previewExport
} from '../api'

const from = ref('')
const to = ref('')
const channel = ref('all')
const type = ref('channel_stats')
const channelOptions = ref([{ id: 'all', name: '全部渠道' }])
const preview = ref(null)
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const msg = ref('')

function queryBody() {
  const q = { from: from.value, to: to.value, type: type.value }
  if (channel.value && channel.value !== 'all') q.channel = channel.value
  return q
}

async function onPreview() {
  loading.value = true
  error.value = ''
  msg.value = ''
  try {
    preview.value = await previewExport(queryBody())
    if (preview.value.from) from.value = preview.value.from
    if (preview.value.to) to.value = preview.value.to
  } catch (e) {
    error.value = e.message || '预览失败'
  } finally {
    loading.value = false
  }
}

async function onExport(format) {
  exporting.value = true
  error.value = ''
  msg.value = ''
  try {
    const job = await createExportJob({ ...queryBody(), format })
    await downloadExportJob(job.id)
    msg.value = `已导出 ${job.rowCount} 行（${format.toUpperCase()}）`
  } catch (e) {
    error.value = e.message || '导出失败'
  } finally {
    exporting.value = false
  }
}

onMounted(async () => {
  try {
    const opts = await fetchStatsChannelOptions()
    channelOptions.value = opts.list || channelOptions.value
  } catch (e) {
    /* ignore */
  }
  await onPreview()
})
</script>

<style scoped>
.head {
  margin-bottom: 16px;
}
h2 {
  margin: 0;
}
.filters {
  margin-bottom: 16px;
}
.meta {
  font-size: 14px;
  color: var(--muted);
}
.scroll {
  overflow: auto;
  max-height: 420px;
}
.success-msg {
  color: var(--success);
}
</style>
