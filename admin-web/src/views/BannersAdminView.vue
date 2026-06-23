<template>
  <div>
    <div class="head">
      <h2>首页 Banner</h2>
      <button @click="startNew">新建</button>
    </div>
    <p class="meta">公开 API：<code>GET /api/home/banners?channel=xxx</code></p>
    <p v-if="error" class="error-msg">{{ error }}</p>

    <div v-if="editing" class="card">
      <h3>{{ form.id ? '编辑' : '新建' }} Banner</h3>
      <div class="form-row">
        <label>ID</label>
        <input v-model="form.id" :disabled="!!form._existing" />
      </div>
      <div class="form-row">
        <label>标题</label>
        <input v-model="form.title" />
      </div>
      <div class="form-row">
        <label>图片 URL</label>
        <input v-model="form.imageUrl" />
      </div>
      <div class="form-row grid-2">
        <div>
          <label>跳转路径</label>
          <input v-model="form.linkPath" />
        </div>
        <div>
          <label>排序</label>
          <input v-model.number="form.sortOrder" type="number" class="input-narrow" />
        </div>
      </div>
      <label><input v-model="form.enabled" type="checkbox" /> 启用</label>
      <div class="actions">
        <button @click="onSave">保存</button>
        <button class="secondary" @click="editing = false">取消</button>
      </div>
    </div>

    <div class="card">
      <p v-if="loading">加载中…</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>标题</th>
            <th>排序</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in list" :key="b.id">
            <td>
              <code>{{ b.id }}</code>
              <div>{{ b.title || '—' }}</div>
            </td>
            <td>{{ b.sortOrder }}</td>
            <td>{{ b.enabled ? '启用' : '停用' }}</td>
            <td>
              <button type="button" class="secondary small" @click="edit(b)">编辑</button>
              <button type="button" class="secondary small" @click="onDelete(b.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { deleteBanner, listBanners, saveBanner } from '../api'

const list = ref([])
const loading = ref(true)
const error = ref('')
const editing = ref(false)
const form = reactive({
  id: '',
  title: '',
  imageUrl: '',
  linkPath: '',
  linkType: 'navigateTo',
  sortOrder: 0,
  enabled: true,
  _existing: false
})

function startNew() {
  Object.assign(form, {
    id: `banner_${Date.now().toString(36)}`,
    title: '',
    imageUrl: '',
    linkPath: '',
    linkType: 'navigateTo',
    sortOrder: 0,
    enabled: true,
    _existing: false
  })
  editing.value = true
}

function edit(b) {
  Object.assign(form, {
    id: b.id,
    title: b.title,
    imageUrl: b.imageUrl,
    linkPath: b.linkPath,
    linkType: b.linkType,
    sortOrder: b.sortOrder,
    enabled: b.enabled,
    _existing: true
  })
  editing.value = true
}

async function load() {
  loading.value = true
  try {
    const data = await listBanners()
    list.value = data.list || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function onSave() {
  error.value = ''
  try {
    const payload = {
      id: form.id,
      title: form.title,
      imageUrl: form.imageUrl,
      linkPath: form.linkPath,
      linkType: form.linkType,
      sortOrder: form.sortOrder,
      enabled: form.enabled
    }
    await saveBanner(form._existing ? form.id : null, payload)
    editing.value = false
    await load()
  } catch (e) {
    error.value = e.message || '保存失败'
  }
}

async function onDelete(id) {
  if (!confirm('删除该 Banner？')) return
  try {
    await deleteBanner(id)
    await load()
  } catch (e) {
    error.value = e.message || '删除失败'
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
.actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.small {
  font-size: 12px;
  padding: 4px 8px;
  margin-right: 4px;
}
</style>
