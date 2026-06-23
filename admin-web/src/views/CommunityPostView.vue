<template>
  <div>
    <div class="head">
      <router-link to="/community" class="back">← 社区列表</router-link>
      <h2>帖子详情</h2>
    </div>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading">加载中…</p>
    <template v-else-if="detail">
      <div class="card">
        <div class="meta-row">
          <span>{{ detail.post.createdAt }}</span>
          <span>{{ detail.post.author || '—' }}</span>
          <span>👍 {{ detail.post.likeCount }} · 💬 {{ detail.post.commentCount }}</span>
        </div>
        <h3>{{ detail.post.title || '无标题' }}</h3>
        <pre class="content">{{ detail.post.content }}</pre>
        <div v-if="detail.music" class="music-box">
          关联音乐：<code>{{ detail.music.id }}</code> · {{ detail.music.title }}（{{ detail.music.status }}）
        </div>
        <div v-if="detail.post.authorOpenid" class="risk-box">
          <button type="button" class="secondary" @click="loadRisk">查看用户 30 天风控</button>
          <p v-if="risk">{{ risk.riskHint || `近30天发帖 ${risk.postCount30d} · 评论 ${risk.commentCount30d}` }}</p>
        </div>
        <button class="danger-btn" @click="onDeletePost">删除帖子</button>
      </div>

      <div class="card">
        <h3>评论（{{ detail.comments.length }}）</h3>
        <div v-for="c in detail.comments" :key="c.id" class="comment">
          <div class="c-head">
            <strong>{{ c.author || '匿名' }}</strong>
            <span>{{ c.createdAt }}</span>
            <span v-if="c.likes">👍 {{ c.likes }}</span>
          </div>
          <p>{{ c.content }}</p>
          <button type="button" class="secondary small" @click="onDeleteComment(c.id)">删除</button>
        </div>
        <p v-if="!detail.comments.length" class="muted">暂无评论</p>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  deleteCommunityComment,
  deleteCommunityPost,
  fetchCommunityUserRisk,
  getCommunityPost
} from '../api'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref('')
const detail = ref(null)
const risk = ref(null)

async function load() {
  loading.value = true
  error.value = ''
  risk.value = null
  try {
    detail.value = await getCommunityPost(route.params.id)
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadRisk() {
  const openid = detail.value?.post?.authorOpenid
  if (!openid) return
  try {
    risk.value = await fetchCommunityUserRisk(openid)
  } catch (e) {
    error.value = e.message || '风控查询失败'
  }
}

async function onDeletePost() {
  if (!confirm('确定删除帖子？')) return
  try {
    await deleteCommunityPost(route.params.id)
    router.replace('/community')
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

async function onDeleteComment(cid) {
  if (!confirm('删除该评论？')) return
  try {
    await deleteCommunityComment(route.params.id, cid)
    await load()
  } catch (e) {
    error.value = e.message || '删除失败'
  }
}

watch(() => route.params.id, load)
onMounted(load)
</script>

<style scoped>
.head {
  margin-bottom: 16px;
}
.back {
  font-size: 13px;
}
h2 {
  margin: 8px 0 0;
}
.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
  color: var(--muted);
}
.content {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  margin: 12px 0;
}
.music-box,
.risk-box {
  font-size: 14px;
  margin: 12px 0;
}
.comment {
  border-top: 1px solid var(--border, #eee);
  padding: 12px 0;
}
.c-head {
  display: flex;
  gap: 10px;
  font-size: 13px;
  margin-bottom: 6px;
}
.small {
  font-size: 12px;
  padding: 4px 8px;
}
.muted {
  color: var(--muted);
}
.danger-btn {
  background: var(--danger);
  margin-top: 8px;
}
</style>
