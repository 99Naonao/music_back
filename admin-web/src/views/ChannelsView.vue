<template>
  <div>
    <div class="head">
      <h2>渠道列表</h2>
      <router-link to="/channels/new" class="btn">新建渠道</router-link>
    </div>

    <div v-if="canWrite && selected.length" class="card batch-bar">
      已选 {{ selected.length }} 项
      <button type="button" class="secondary" @click="onBatch('active')">批量启用</button>
      <button type="button" class="secondary" @click="onBatch('disabled')">批量停用</button>
      <button type="button" class="secondary" @click="selected = []">取消</button>
    </div>

    <div class="card">
      <p v-if="loading">加载中…</p>
      <p v-else-if="error" class="error-msg">{{ error }}</p>
      <table v-else class="table">
        <thead>
          <tr>
            <th v-if="canWrite" class="chk"><input type="checkbox" :checked="allSelected" @change="toggleAll" /></th>
            <th>ID</th>
            <th>名称</th>
            <th>状态</th>
            <th>Branding</th>
            <th>更新于</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in list" :key="item.id">
            <td v-if="canWrite" class="chk">
              <input type="checkbox" :value="item.id" v-model="selected" />
            </td>
            <td><code>{{ item.id }}</code></td>
            <td>{{ item.name }}</td>
            <td><span :class="['badge', item.status]">{{ statusLabel(item.status) }}</span></td>
            <td>v{{ item.brandingVersion || 0 }}</td>
            <td>{{ item.updatedAt || '—' }}</td>
            <td class="actions">
              <router-link :to="`/dashboard/channel/${item.id}`">详情</router-link>
              <router-link :to="`/channels/${item.id}`">编辑</router-link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { batchChannelStatus, fetchMe, listChannels } from '../api'

const list = ref([])
const loading = ref(true)
const error = ref('')
const selected = ref([])
const canWrite = ref(false)

const allSelected = computed(
  () => list.value.length > 0 && selected.value.length === list.value.length
)

function statusLabel(s) {
  if (s === 'active') return '启用'
  if (s === 'disabled') return '停用'
  return '草稿'
}

function toggleAll(ev) {
  selected.value = ev.target.checked ? list.value.map((x) => x.id) : []
}

async function onBatch(status) {
  if (!selected.value.length) return
  error.value = ''
  try {
    const res = await batchChannelStatus(selected.value, status)
    selected.value = []
    const data = await listChannels()
    list.value = data.list || []
    alert(res.message || `已更新 ${res.updated?.length || 0} 个渠道`)
  } catch (e) {
    error.value = e.message || '批量操作失败'
  }
}

onMounted(async () => {
  try {
    const [data, me] = await Promise.all([listChannels(), fetchMe()])
    list.value = data.list || []
    canWrite.value = me.user && ['super', 'operator'].includes(me.user.role)
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
})
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
.head .btn {
  display: inline-block;
  text-decoration: none;
}
.batch-bar {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.chk {
  width: 36px;
}
.actions {
  white-space: nowrap;
}
.actions a {
  margin-right: 10px;
}
</style>
