<template>
  <div>
    <div class="head">
      <h2>{{ isNew ? '新建弹窗活动' : `编辑 · ${id}` }}</h2>
      <router-link to="/promo" class="secondary btn">返回列表</router-link>
    </div>
    <p v-if="error" class="error-msg">{{ error }}</p>

    <div class="card">
      <div class="form-row grid-2">
        <div>
          <label>活动 ID</label>
          <input v-model="campaignId" :disabled="!isNew" placeholder="如 inactive_visit" />
        </div>
        <div>
          <label>优先级</label>
          <input v-model.number="priority" type="number" />
        </div>
      </div>
      <div class="form-row">
        <label><input v-model="enabled" type="checkbox" /> 启用</label>
      </div>

      <div class="tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          :class="['tab', { active: tab === t.id }]"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-show="tab === 'basic'" class="tab-panel">
        <div class="form-row grid-2">
          <div>
            <label>类型</label>
            <select v-model="form.type">
              <option v-for="t in meta.types" :key="t.id" :value="t.id">{{ t.label }}</option>
            </select>
          </div>
          <div>
            <label>分类</label>
            <input v-model="form.category" placeholder="retention / growth" />
          </div>
        </div>
        <div class="form-row">
          <label>展示场景</label>
          <div class="checks">
            <label v-for="s in meta.scenes" :key="s.id" class="check-item">
              <input type="checkbox" :value="s.id" v-model="form.scenes" />
              {{ s.label }} <code>{{ s.id }}</code>
            </label>
          </div>
        </div>
        <div class="form-row grid-2">
          <div>
            <label>允许渠道（留空=全渠道，逗号分隔）</label>
            <input v-model="channelIdsText" placeholder="partner_a, partner_b" />
          </div>
          <div>
            <label>排除渠道</label>
            <input v-model="channelDenyText" placeholder="test_channel" />
          </div>
        </div>
      </div>

      <div v-show="tab === 'copy'" class="tab-panel">
        <div class="form-row">
          <label>角标 badge</label>
          <input v-model="form.badge" />
        </div>
        <div class="form-row">
          <label>标题 title</label>
          <input v-model="form.title" />
        </div>
        <div class="form-row">
          <label>副标题 subtitle</label>
          <textarea v-model="form.subtitle" rows="3" />
        </div>
        <div class="form-row grid-2">
          <div>
            <label>主按钮文案</label>
            <input v-model="form.buttonText" />
          </div>
          <div>
            <label>次按钮文案</label>
            <input v-model="form.secondaryText" />
          </div>
        </div>
        <div class="form-row grid-2">
          <div>
            <label>跳转路径 linkPath</label>
            <input v-model="form.linkPath" placeholder="/pages/create/create" />
          </div>
          <div>
            <label>跳转类型</label>
            <select v-model="form.linkType">
              <option v-for="l in meta.linkTypes" :key="l.id" :value="l.id">{{ l.label }}</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <label>图片 URL（可选）</label>
          <input v-model="form.imageUrl" />
        </div>
      </div>

      <div v-show="tab === 'rule'" class="tab-panel">
        <div class="form-row">
          <label>触发规则</label>
          <select v-model="form.rule">
            <option v-for="r in meta.rules" :key="r.id" :value="r.id">{{ r.label }}</option>
          </select>
        </div>
        <div class="form-row grid-2">
          <div>
            <label>最小未活跃天数</label>
            <input v-model.number="form.minInactiveDays" type="number" min="0" />
          </div>
          <div>
            <label>频控间隔（天，可选）</label>
            <input v-model.number="form.minIntervalDays" type="number" min="0" />
          </div>
        </div>
      </div>

      <div v-show="tab === 'preview'" class="tab-panel">
        <div class="filter-bar sim-bar">
          <label class="filter-field">
            <span>模拟场景</span>
            <select v-model="simScene">
              <option v-for="s in meta.scenes" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </label>
          <label class="filter-field">
            <span>模拟渠道</span>
            <input v-model="simChannel" type="text" class="filter-input" placeholder="default" />
          </label>
          <button type="button" class="secondary" @click="onSimulate" :disabled="simulating">
            {{ simulating ? '模拟中…' : '预览命中' }}
          </button>
        </div>
        <div v-if="simResult" class="sim-box">
          <p>命中 {{ simResult.matchedCount }} 条，当前展示：<strong>{{ simResult.winner?.title || simResult.winner?.id || '无' }}</strong></p>
          <ul v-if="simResult.candidates?.length">
            <li v-for="c in simResult.candidates" :key="c.id">{{ c.id }} · {{ c.title }} (p={{ c.priority }})</li>
          </ul>
        </div>
        <div class="phone-preview" v-if="form.title">
          <div class="phone-inner">
            <span v-if="form.badge" class="pv-badge">{{ form.badge }}</span>
            <div class="pv-title">{{ form.title }}</div>
            <div class="pv-sub">{{ form.subtitle }}</div>
            <div class="pv-btns">
              <span class="pv-primary">{{ form.buttonText || '确定' }}</span>
              <span class="pv-secondary">{{ form.secondaryText || '关闭' }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-show="tab === 'stats'" class="tab-panel">
        <p v-if="isNew" class="muted">保存后可查看效果统计</p>
        <template v-else>
          <button type="button" class="secondary" @click="loadStats" :disabled="statsLoading">刷新统计（近 30 天）</button>
          <div v-if="stats" class="stats-grid">
            <div class="stat"><span>曝光</span><strong>{{ stats.exposures }}</strong></div>
            <div class="stat"><span>点击</span><strong>{{ stats.clicks }}</strong></div>
            <div class="stat"><span>关闭</span><strong>{{ stats.dismisses }}</strong></div>
            <div class="stat"><span>CTR</span><strong>{{ stats.ctr != null ? stats.ctr + '%' : '—' }}</strong></div>
          </div>
        </template>
      </div>

      <div v-show="tab === 'json'" class="tab-panel">
        <div class="form-row">
          <label>高级 JSON（与表单双向同步）</label>
          <textarea v-model="jsonText" rows="14" spellcheck="false" @blur="syncFromJson" />
        </div>
      </div>

      <div class="actions">
        <button @click="onSave" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchPromoMeta,
  fetchPromoStats,
  getPromoCampaign,
  savePromoCampaign,
  simulatePromo
} from '../api'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id)
const isNew = computed(() => route.name === 'promo-new')

const tabs = [
  { id: 'basic', label: '基础' },
  { id: 'copy', label: '文案' },
  { id: 'rule', label: '规则' },
  { id: 'preview', label: '预览' },
  { id: 'stats', label: '效果' },
  { id: 'json', label: '高级 JSON' }
]

const tab = ref('basic')
const campaignId = ref('')
const priority = ref(0)
const enabled = ref(true)
const saving = ref(false)
const error = ref('')
const meta = ref({ scenes: [], types: [], rules: [], linkTypes: [] })

const form = reactive({
  type: 'rich',
  category: 'retention',
  scenes: ['home_show'],
  badge: '',
  title: '',
  subtitle: '',
  buttonText: '',
  secondaryText: '',
  linkPath: '',
  linkType: 'switchTab',
  imageUrl: '',
  rule: '',
  minInactiveDays: 7,
  minIntervalDays: null
})

const channelIdsText = ref('')
const channelDenyText = ref('')
const jsonText = ref('{}')

const simScene = ref('home_show')
const simChannel = ref('default')
const simulating = ref(false)
const simResult = ref(null)

const stats = ref(null)
const statsLoading = ref(false)

function splitCsv(s) {
  return String(s || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

function formToPayload() {
  const p = {
    type: form.type,
    category: form.category,
    scenes: [...form.scenes],
    badge: form.badge,
    title: form.title,
    subtitle: form.subtitle,
    buttonText: form.buttonText,
    secondaryText: form.secondaryText,
    linkPath: form.linkPath,
    linkType: form.linkType
  }
  if (form.imageUrl) p.imageUrl = form.imageUrl
  if (form.rule) {
    p.rule = form.rule
    if (form.minInactiveDays != null) p.minInactiveDays = form.minInactiveDays
  }
  if (form.minIntervalDays != null && form.minIntervalDays !== '') {
    p.minIntervalDays = form.minIntervalDays
  }
  const allow = splitCsv(channelIdsText.value)
  const deny = splitCsv(channelDenyText.value)
  if (allow.length) p.channelIds = allow
  if (deny.length) p.channelDeny = deny
  return p
}

function payloadToForm(payload) {
  form.type = payload.type || 'rich'
  form.category = payload.category || ''
  form.scenes = Array.isArray(payload.scenes) ? [...payload.scenes] : ['home_show']
  form.badge = payload.badge || ''
  form.title = payload.title || ''
  form.subtitle = payload.subtitle || ''
  form.buttonText = payload.buttonText || ''
  form.secondaryText = payload.secondaryText || ''
  form.linkPath = payload.linkPath || ''
  form.linkType = payload.linkType || 'switchTab'
  form.imageUrl = payload.imageUrl || ''
  form.rule = payload.rule || ''
  form.minInactiveDays = payload.minInactiveDays != null ? payload.minInactiveDays : 7
  form.minIntervalDays = payload.minIntervalDays != null ? payload.minIntervalDays : null
  channelIdsText.value = (payload.channelIds || []).join(', ')
  channelDenyText.value = (payload.channelDeny || []).join(', ')
  jsonText.value = JSON.stringify(payload, null, 2)
}

function syncJsonFromForm() {
  jsonText.value = JSON.stringify(formToPayload(), null, 2)
}

function syncFromJson() {
  try {
    const p = JSON.parse(jsonText.value)
    payloadToForm(p)
  } catch (e) {
    error.value = 'JSON 格式无效'
  }
}

watch(form, syncJsonFromForm, { deep: true })
watch([channelIdsText, channelDenyText], syncJsonFromForm)

async function load() {
  try {
    meta.value = await fetchPromoMeta()
  } catch (e) {
    meta.value = {
      scenes: [{ id: 'home_show', label: '首页' }],
      types: [{ id: 'rich', label: '富文本' }],
      rules: [{ id: '', label: '无' }],
      linkTypes: [{ id: 'switchTab', label: 'switchTab' }]
    }
  }
  if (isNew.value) {
    syncJsonFromForm()
    return
  }
  error.value = ''
  try {
    const data = await getPromoCampaign(id.value)
    campaignId.value = data.id
    priority.value = data.priority
    enabled.value = data.enabled
    payloadToForm(data.payload || {})
    if (!isNew.value) loadStats()
  } catch (e) {
    error.value = e.message || '加载失败'
  }
}

async function onSave() {
  saving.value = true
  error.value = ''
  try {
    syncFromJson()
    const payload = JSON.parse(jsonText.value)
    const cid = isNew.value ? campaignId.value.trim() : id.value
    if (!cid) throw new Error('请填写活动 ID')
    await savePromoCampaign(isNew.value ? null : cid, {
      id: cid,
      enabled: enabled.value,
      priority: priority.value,
      payload
    })
    router.replace(`/promo/${cid}`)
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function onSimulate() {
  simulating.value = true
  try {
    simResult.value = await simulatePromo({ scene: simScene.value, channel: simChannel.value })
  } catch (e) {
    error.value = e.message || '模拟失败'
  } finally {
    simulating.value = false
  }
}

async function loadStats() {
  if (isNew.value) return
  statsLoading.value = true
  try {
    stats.value = await fetchPromoStats(id.value, { days: 30 })
  } catch (e) {
    stats.value = null
  } finally {
    statsLoading.value = false
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
.sim-bar {
  margin-bottom: 12px;
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 16px 0 12px;
}
.tab {
  border: 1px solid var(--border, #ddd);
  background: #fff;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.tab.active {
  background: var(--primary, #6b4fa0);
  color: #fff;
  border-color: transparent;
}
.checks {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.check-item code {
  font-size: 11px;
  opacity: 0.7;
}
.actions {
  margin-top: 16px;
}
.sim-box {
  margin-top: 12px;
  padding: 12px;
  background: #f6f4f9;
  border-radius: 8px;
  font-size: 14px;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 12px;
}
.stat {
  padding: 12px;
  background: #f6f4f9;
  border-radius: 8px;
}
.stat span {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.stat strong {
  font-size: 22px;
}
.phone-preview {
  margin-top: 16px;
  max-width: 280px;
  border: 8px solid #333;
  border-radius: 24px;
  padding: 16px;
  background: #1a1520;
}
.phone-inner {
  background: #2d2438;
  color: #fff;
  border-radius: 12px;
  padding: 16px;
}
.pv-badge {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.15);
  padding: 2px 8px;
  border-radius: 999px;
}
.pv-title {
  font-weight: 600;
  margin-top: 10px;
}
.pv-sub {
  font-size: 13px;
  opacity: 0.85;
  margin-top: 8px;
}
.pv-btns {
  margin-top: 16px;
  display: flex;
  gap: 8px;
  font-size: 13px;
}
.pv-primary {
  background: #9b7fd4;
  padding: 6px 12px;
  border-radius: 8px;
}
.pv-secondary {
  opacity: 0.6;
  padding: 6px 0;
}
.muted {
  color: var(--muted);
}
textarea {
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
</style>
