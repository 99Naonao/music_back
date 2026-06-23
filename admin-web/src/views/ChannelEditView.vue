<template>
  <div>
    <div class="head">
      <h2>{{ isNew ? '新建渠道' : `编辑渠道 · ${channelId}` }}</h2>
      <router-link to="/channels" class="secondary btn">返回列表</router-link>
    </div>

    <p v-if="loading">加载中…</p>
    <p v-else-if="error" class="error-msg">{{ error }}</p>

    <template v-else>
      <div class="card section">
        <h3>基础信息</h3>
        <div class="grid-2">
          <div class="form-row">
            <label>渠道 ID</label>
            <input v-model="form.id" :disabled="!isNew" placeholder="如 partner_a" />
          </div>
          <div class="form-row">
            <label>名称</label>
            <input v-model="form.name" />
          </div>
          <div class="form-row">
            <label>状态</label>
            <select v-model="form.status">
              <option value="draft">草稿</option>
              <option value="active">启用</option>
              <option value="disabled">停用</option>
            </select>
          </div>
          <div class="form-row">
            <label>合同开始</label>
            <input v-model="form.contractStart" type="date" />
          </div>
          <div class="form-row">
            <label>合同结束</label>
            <input v-model="form.contractEnd" type="date" />
          </div>
        </div>
        <div class="actions">
          <button v-if="isNew" @click="onCreate" :disabled="saving">创建渠道</button>
          <template v-else>
            <button @click="onSaveBasic" :disabled="saving">保存基础信息</button>
            <button class="secondary" @click="onSetStatus('active')" :disabled="saving">启用</button>
            <button class="secondary" @click="onSetStatus('disabled')" :disabled="saving">停用</button>
          </template>
        </div>
        <p v-if="hint" class="hint">{{ hint }}</p>
      </div>

      <div v-if="!isNew" class="card section">
        <h3>换皮 Branding</h3>
        <div class="grid-2">
          <div class="form-row">
            <label>主题预设</label>
            <select v-model="branding.themePresetId">
              <option v-for="p in themePresets" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div class="form-row">
            <label>开屏标题</label>
            <input v-model="branding.splashTitle" />
          </div>
          <div class="form-row">
            <label>开屏副标题</label>
            <input v-model="branding.splashSubtitle" />
          </div>
          <div class="form-row">
            <label>开屏 Slogan</label>
            <input v-model="branding.splashSlogan" />
          </div>
          <div class="form-row">
            <label>开屏图 URL</label>
            <input v-model="branding.splashImageUrl" />
            <input type="file" accept="image/*" @change="(e) => onUpload(e, 'splashImageUrl')" />
          </div>
          <div class="form-row">
            <label>Logo URL</label>
            <input v-model="branding.logoUrl" />
            <input type="file" accept="image/*" @change="(e) => onUpload(e, 'logoUrl')" />
          </div>
          <div class="form-row">
            <label>分享图 URL</label>
            <input v-model="branding.shareImageUrl" />
            <input type="file" accept="image/*" @change="(e) => onUpload(e, 'shareImageUrl')" />
          </div>
        </div>

        <h4>功能开关</h4>
        <div class="flags">
          <label v-for="(val, key) in branding.features" :key="key" class="flag">
            <input type="checkbox" v-model="branding.features[key]" />
            {{ featureLabel(key) }}
          </label>
        </div>

        <div class="actions">
          <button @click="onSaveBranding" :disabled="saving">保存 Branding</button>
        </div>
        <p v-if="branding.version" class="hint">当前 branding 版本：v{{ branding.version }}</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  createChannel,
  getChannel,
  listChannels,
  patchChannelStatus,
  updateBranding,
  updateChannel,
  uploadImage
} from '../api'

const props = defineProps({ id: String })
const route = useRoute()
const router = useRouter()

const channelId = computed(() => props.id || route.params.id)
const isNew = computed(() => route.name === 'channel-new' || !channelId.value || channelId.value === 'new')

const loading = ref(!isNew.value)
const saving = ref(false)
const error = ref('')
const hint = ref('')
const themePresets = ref([])

const form = reactive({
  id: '',
  name: '',
  status: 'draft',
  contractStart: '',
  contractEnd: ''
})

const branding = reactive({
  themePresetId: 'deep_sleep_post',
  splashTitle: '',
  splashSubtitle: '',
  splashSlogan: '',
  splashImageUrl: '',
  logoUrl: '',
  shareImageUrl: '',
  features: {
    hideMall: false,
    hideCommunity: false,
    hidePromo: false,
    hidePoints: false,
    hideTasks: false
  },
  version: 0
})

function featureLabel(key) {
  const map = {
    hideMall: '隐藏商城',
    hideCommunity: '隐藏社区',
    hidePromo: '隐藏运营弹窗',
    hidePoints: '隐藏积分',
    hideTasks: '隐藏任务'
  }
  return map[key] || key
}

async function loadPresets() {
  const data = await listChannels()
  themePresets.value = data.themePresets || []
}

async function loadDetail() {
  if (isNew.value) {
    await loadPresets()
    loading.value = false
    return
  }
  try {
    const data = await getChannel(channelId.value)
    themePresets.value = (await listChannels()).themePresets || []
    form.id = data.channel.id
    form.name = data.channel.name
    form.status = data.channel.status
    form.contractStart = data.channel.contractStart || ''
    form.contractEnd = data.channel.contractEnd || ''
    hint.value = data.miniProgramHint ? `小程序入口：${data.miniProgramHint}` : ''
    Object.assign(branding, {
      themePresetId: data.branding.themePresetId,
      splashTitle: data.branding.splashTitle,
      splashSubtitle: data.branding.splashSubtitle,
      splashSlogan: data.branding.splashSlogan,
      splashImageUrl: data.branding.splashImageUrl,
      logoUrl: data.branding.logoUrl,
      shareImageUrl: data.branding.shareImageUrl,
      features: { ...data.branding.features },
      version: data.branding.version
    })
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadDetail)

async function onCreate() {
  saving.value = true
  error.value = ''
  try {
    await createChannel({
      id: form.id.trim(),
      name: form.name.trim(),
      status: form.status,
      contractStart: form.contractStart || null,
      contractEnd: form.contractEnd || null
    })
    router.replace(`/channels/${form.id.trim()}`)
    await loadDetail()
  } catch (e) {
    error.value = e.message || '创建失败'
  } finally {
    saving.value = false
  }
}

async function onSaveBasic() {
  saving.value = true
  error.value = ''
  try {
    await updateChannel(channelId.value, {
      name: form.name.trim(),
      contractStart: form.contractStart || null,
      contractEnd: form.contractEnd || null
    })
    hint.value = '基础信息已保存'
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function onSetStatus(status) {
  saving.value = true
  try {
    await patchChannelStatus(channelId.value, status)
    form.status = status
    hint.value = `已设为 ${status}`
  } catch (e) {
    error.value = e.message || '操作失败'
  } finally {
    saving.value = false
  }
}

async function onSaveBranding() {
  saving.value = true
  error.value = ''
  try {
    await updateBranding(channelId.value, {
      themePresetId: branding.themePresetId,
      splashTitle: branding.splashTitle,
      splashSubtitle: branding.splashSubtitle,
      splashSlogan: branding.splashSlogan,
      splashImageUrl: branding.splashImageUrl,
      logoUrl: branding.logoUrl,
      shareImageUrl: branding.shareImageUrl,
      features: { ...branding.features }
    })
    await loadDetail()
    hint.value = 'Branding 已保存，小程序拉取 branding 后生效'
  } catch (e) {
    error.value = e.message || '保存失败'
  } finally {
    saving.value = false
  }
}

async function onUpload(e, field) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  saving.value = true
  try {
    branding[field] = await uploadImage(file)
  } catch (err) {
    error.value = err.message || '上传失败'
  } finally {
    saving.value = false
    e.target.value = ''
  }
}
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
.section {
  margin-bottom: 20px;
}
h3 {
  margin-top: 0;
}
h4 {
  margin: 20px 0 12px;
  font-size: 14px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.hint {
  color: var(--muted);
  font-size: 13px;
  margin-top: 12px;
}
.flags {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.flag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text);
}
.flag input {
  width: auto;
}
input[type='file'] {
  margin-top: 6px;
  padding: 4px;
  font-size: 12px;
}
</style>
