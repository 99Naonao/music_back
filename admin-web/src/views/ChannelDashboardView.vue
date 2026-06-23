<template>
  <div>
    <div class="head">
      <div>
        <router-link to="/channels" class="back">← 渠道列表</router-link>
        <h2>{{ channelName }}</h2>
        <p v-if="channelMeta" class="meta">
          <code>{{ channelId }}</code>
          · {{ statusLabel(channelMeta.status) }}
          <span v-if="channelMeta.contractStart"> · 合同 {{ channelMeta.contractStart }} 起</span>
          <span v-if="channelMeta.contractEnd"> · 至 {{ channelMeta.contractEnd }}</span>
        </p>
      </div>
      <div class="head-actions">
        <router-link :to="`/channels/${channelId}`" class="btn secondary">编辑配置</router-link>
        <router-link to="/dashboard" class="btn secondary">数据看板</router-link>
      </div>
    </div>

    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <template v-else-if="hub">
      <div class="card exp-link">
        <strong>体验入口</strong>
        <code>{{ hub.miniProgramHint }}</code>
        <p class="hint">小程序启动参数 channel，可在开发者工具或真机扫码测试</p>
      </div>

      <div class="grid-2">
        <div class="card branding-snippet">
          <h3>Branding 摘要</h3>
          <div v-if="hub.branding" class="brand-row">
            <span
              v-if="hub.branding.primaryColor"
              class="swatch"
              :style="{ background: hub.branding.primaryColor }"
            />
            <div>
              <div>{{ hub.branding.splashTitle || '—' }}</div>
              <div class="sub">{{ hub.branding.splashSubtitle }}</div>
              <div class="sub">主题 {{ hub.branding.themePresetId }} / v{{ hub.branding.version }}</div>
            </div>
          </div>
          <div v-if="canWrite" class="copy-row">
            <select v-model="copyFrom">
              <option value="">从其他渠道复制 branding…</option>
              <option v-for="c in otherChannels" :key="c.id" :value="c.id">{{ c.name }} ({{ c.id }})</option>
            </select>
            <button type="button" class="secondary" :disabled="!copyFrom || copying" @click="onCopyBranding">
              {{ copying ? '复制中…' : '复制' }}
            </button>
          </div>
        </div>

        <div class="card">
          <h3>近 30 日 KPI</h3>
          <div class="cards mini">
            <div class="stat">
              <div class="label">今日 DAU</div>
              <div class="num">{{ statsOverview?.today?.dau ?? '—' }}</div>
            </div>
            <div class="stat">
              <div class="label">区间 DAU</div>
              <div class="num">{{ statsOverview?.rangeTotals?.dau ?? '—' }}</div>
            </div>
            <div class="stat">
              <div class="label">音乐完成</div>
              <div class="num">{{ statsOverview?.rangeTotals?.musicCompleted ?? '—' }}</div>
            </div>
            <div class="stat">
              <div class="label">贺卡</div>
              <div class="num">{{ statsOverview?.rangeTotals?.cardsCreated ?? '—' }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>近 30 日 DAU 趋势</h3>
        <LineChart :labels="chartLabels" :values="chartValues" title="DAU" />
      </div>

      <div class="card">
        <h3>最近操作</h3>
        <table v-if="hub.audit?.length" class="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>动作</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in hub.audit" :key="a.id">
              <td>{{ a.createdAt }}</td>
              <td><code>{{ a.action }}</code></td>
              <td>{{ formatDetail(a.detail) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">暂无审计记录</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import LineChart from '../components/LineChart.vue'
import { copyChannelBranding, fetchChannelHub, fetchMe, listChannels } from '../api'

const route = useRoute()
const channelId = computed(() => route.params.id)
const loading = ref(true)
const error = ref('')
const hub = ref(null)
const allChannels = ref([])
const copyFrom = ref('')
const copying = ref(false)
const canWrite = ref(false)

const channelMeta = computed(() => hub.value && hub.value.channel)
const channelName = computed(() => (channelMeta.value && channelMeta.value.name) || channelId.value)
const statsOverview = computed(() => hub.value?.stats?.overview)
const chartLabels = computed(() =>
  (hub.value?.stats?.timeseries?.points || []).map((p) => p.date.slice(5))
)
const chartValues = computed(() =>
  (hub.value?.stats?.timeseries?.points || []).map((p) => p.value || 0)
)
const otherChannels = computed(() =>
  allChannels.value.filter((c) => c.id !== channelId.value)
)

function statusLabel(s) {
  if (s === 'active') return '启用'
  if (s === 'disabled') return '停用'
  return '草稿'
}

function formatDetail(d) {
  if (!d) return '—'
  try {
    return JSON.stringify(d)
  } catch (e) {
    return '—'
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [data, me] = await Promise.all([
      fetchChannelHub(channelId.value, { metric: 'dau' }),
      fetchMe()
    ])
    hub.value = data
    canWrite.value = me.user && ['super', 'operator'].includes(me.user.role)
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadChannels() {
  try {
    const data = await listChannels()
    allChannels.value = data.list || []
  } catch (e) {
    /* ignore */
  }
}

async function onCopyBranding() {
  if (!copyFrom.value) return
  copying.value = true
  error.value = ''
  try {
    await copyChannelBranding(channelId.value, copyFrom.value)
    copyFrom.value = ''
    await load()
  } catch (e) {
    error.value = e.message || '复制失败'
  } finally {
    copying.value = false
  }
}

watch(channelId, load)
onMounted(() => {
  loadChannels()
  load()
})
</script>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.back {
  font-size: 13px;
  display: inline-block;
  margin-bottom: 8px;
}
h2 {
  margin: 0;
}
.meta {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
}
.exp-link code {
  display: block;
  margin-top: 8px;
  word-break: break-all;
}
.hint {
  font-size: 12px;
  color: var(--muted);
  margin: 8px 0 0;
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
@media (max-width: 900px) {
  .grid-2 {
    grid-template-columns: 1fr;
  }
}
.brand-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.swatch {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
}
.sub {
  font-size: 13px;
  color: var(--muted);
}
.copy-row {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
.copy-row select {
  flex: 1;
}
.cards.mini {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.stat .label {
  font-size: 12px;
  color: var(--muted);
}
.stat .num {
  font-size: 22px;
  font-weight: 600;
}
.card h3 {
  margin-top: 0;
}
.muted {
  color: var(--muted);
}
</style>
