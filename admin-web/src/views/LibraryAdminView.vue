<template>
  <div>
    <h2>官方曲库</h2>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <label class="chk"><input v-model="showDisabled" type="checkbox" @change="load" /> 显示已下架</label>
    <div class="card">
      <p v-if="loading">加载中…</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th>标题</th>
            <th>播放</th>
            <th>排序</th>
            <th>状态</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in list" :key="t.id">
            <td>
              <code>{{ t.id }}</code>
              <div>{{ t.title }}</div>
            </td>
            <td>{{ t.plays }}</td>
            <td>
              <input v-model.number="t.librarySortOrder" type="number" class="input-narrow num" />
            </td>
            <td>{{ t.libraryEnabled ? '上架' : '下架' }}</td>
            <td>
              <button type="button" class="secondary small" @click="save(t)">保存</button>
              <button type="button" class="secondary small" @click="toggle(t)">
                {{ t.libraryEnabled ? '下架' : '上架' }}
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
import { listLibraryTracks, patchLibraryTrack } from '../api'

const list = ref([])
const loading = ref(true)
const error = ref('')
const showDisabled = ref(true)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await listLibraryTracks({ includeDisabled: showDisabled.value ? '1' : '0' })
    list.value = data.list || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function save(t) {
  try {
    await patchLibraryTrack(t.id, { librarySortOrder: t.librarySortOrder })
    await load()
  } catch (e) {
    error.value = e.message || '保存失败'
  }
}

async function toggle(t) {
  try {
    await patchLibraryTrack(t.id, { libraryEnabled: !t.libraryEnabled })
    await load()
  } catch (e) {
    error.value = e.message || '操作失败'
  }
}

onMounted(load)
</script>

<style scoped>
h2 {
  margin: 0 0 12px;
}
.chk {
  font-size: 14px;
  display: block;
  margin-bottom: 12px;
}
.small {
  font-size: 12px;
  padding: 4px 8px;
  margin-right: 4px;
}
</style>
