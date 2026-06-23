<template>
  <div>
    <div class="head">
      <h2>社区审核</h2>
      <div class="filters">
        <input
          v-model="keyword"
          type="text"
          placeholder="搜索标题/内容"
          @keyup.enter="load"
        />
        <button @click="load" :disabled="loading">搜索</button>
      </div>
    </div>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="msg" class="success-msg">{{ msg }}</p>
    <p v-if="loading">加载中…</p>
    <div v-else class="card">
      <table class="table">
        <thead>
          <tr>
            <th>时间</th>
            <th>作者</th>
            <th>标题</th>
            <th>内容</th>
            <th>互动</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in list" :key="row.id">
            <td class="nowrap">{{ formatTime(row) }}</td>
            <td>{{ row.author || '—' }}</td>
            <td>{{ row.title || row.topic || '—' }}</td>
            <td class="content">{{ preview(row.content) }}</td>
            <td class="nowrap stats">👍 {{ row.likeCount ?? 0 }} · 💬 {{ row.commentCount ?? 0 }}</td>
            <td class="actions">
              <router-link :to="`/community/${row.id}`">详情</router-link>
              <button class="danger-btn" :disabled="deleting === row.id" @click="onDelete(row.id)">
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!list.length" class="empty">暂无帖子</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { deleteCommunityPost, searchCommunityPosts } from '../api'

const list = ref([])
const loading = ref(true)
const error = ref('')
const msg = ref('')
const keyword = ref('')
const deleting = ref('')

function formatTime(row) {
  const raw = row.createdAt || row.created_at
  if (!raw) return '—'
  const s = String(raw)
  return s.length >= 16 ? s.slice(0, 16) : s
}

function preview(text) {
  const s = String(text || '')
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}

async function load() {
  loading.value = true
  error.value = ''
  msg.value = ''
  try {
    const data = await searchCommunityPosts({
      q: keyword.value.trim(),
      limit: 30
    })
    list.value = data.list || []
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function onDelete(id) {
  if (!confirm('确定删除该帖子？此操作不可恢复。')) return
  deleting.value = id
  error.value = ''
  try {
    await deleteCommunityPost(id)
    msg.value = '帖子已删除'
    await load()
  } catch (e) {
    error.value = e.message || '删除失败'
  } finally {
    deleting.value = ''
  }
}

onMounted(load)
</script>

<style scoped>
.content {
  max-width: 320px;
  white-space: pre-wrap;
  word-break: break-word;
}
.stats {
  font-size: 13px;
  color: var(--muted);
}
.actions {
  white-space: nowrap;
}
.actions a {
  margin-right: 10px;
}
.danger-btn {
  background: var(--danger);
  padding: 6px 12px;
  font-size: 13px;
}
.success-msg {
  color: var(--success);
  font-size: 14px;
}
.empty {
  color: var(--muted);
}
</style>
