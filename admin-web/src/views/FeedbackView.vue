<template>

  <div>

    <div class="head">

      <h2>用户反馈</h2>

      <div class="toolbar">

        <select v-model="statusFilter" @change="onFilterChange">

          <option value="">全部</option>

          <option value="pending">待处理</option>

          <option value="processing">处理中</option>

          <option value="resolved">已解决</option>

          <option value="ignored">已忽略</option>

        </select>

        <span v-if="pendingCount > 0" class="badge-warn">待办 {{ pendingCount }}</span>

        <div class="pager">

          <button class="secondary" :disabled="page <= 1 || loading" @click="goPage(page - 1)">上一页</button>

          <span>{{ page }} / {{ totalPages }}</span>

          <button class="secondary" :disabled="page >= totalPages || loading" @click="goPage(page + 1)">下一页</button>

        </div>

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

            <th>状态</th>

            <th>类型</th>

            <th>用户</th>

            <th>内容</th>

            <th>操作</th>

          </tr>

        </thead>

        <tbody>

          <tr v-for="row in list" :key="row.id">

            <td class="nowrap">{{ row.created_at }}</td>

            <td><span :class="['badge', statusClass(row.status)]">{{ statusLabel(row.status) }}</span></td>

            <td>{{ row.feedback_type }}</td>

            <td>{{ row.nickname || row.wx_openid || '—' }}</td>

            <td class="content">{{ row.content }}</td>

            <td class="actions">

              <select

                :value="row.status || 'pending'"

                :disabled="saving === row.id"

                @change="onStatusChange(row, $event.target.value)"

              >

                <option value="pending">待处理</option>

                <option value="processing">处理中</option>

                <option value="resolved">已解决</option>

                <option value="ignored">已忽略</option>

              </select>

            </td>

          </tr>

        </tbody>

      </table>

      <p v-if="!list.length" class="empty">暂无反馈</p>

    </div>

  </div>

</template>



<script setup>

import { computed, onMounted, ref } from 'vue'

import { useRoute } from 'vue-router'

import { listFeedback, patchFeedback } from '../api'



const route = useRoute()

const list = ref([])

const loading = ref(true)

const error = ref('')

const msg = ref('')

const page = ref(1)

const limit = ref(20)

const total = ref(0)

const pendingCount = ref(0)

const statusFilter = ref('')

const saving = ref('')



const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))



function statusLabel(s) {

  const map = {

    pending: '待处理',

    processing: '处理中',

    resolved: '已解决',

    ignored: '已忽略'

  }

  return map[s] || s || '待处理'

}



function statusClass(s) {

  if (s === 'resolved') return 'active'

  if (s === 'ignored') return 'disabled'

  if (s === 'processing') return 'draft'

  return 'draft'

}



async function load() {

  loading.value = true

  error.value = ''

  msg.value = ''

  try {

    const params = { page: page.value, limit: limit.value }

    if (statusFilter.value) params.status = statusFilter.value

    const data = await listFeedback(params)

    list.value = data.list || []

    total.value = data.total || 0

    pendingCount.value = data.pendingCount || 0

    page.value = data.page || page.value

  } catch (e) {

    error.value = e.message || '加载失败'

  } finally {

    loading.value = false

  }

}



function onFilterChange() {

  page.value = 1

  load()

}



function goPage(p) {

  page.value = p

  load()

}



async function onStatusChange(row, status) {

  saving.value = row.id

  error.value = ''

  try {

    await patchFeedback(row.id, { status })

    msg.value = '状态已更新'

    await load()

  } catch (e) {

    error.value = e.message || '更新失败'

  } finally {

    saving.value = ''

  }

}



onMounted(() => {

  if (route.query.status) statusFilter.value = String(route.query.status)

  load()

})

</script>



<style scoped>

.pager {

  display: flex;

  align-items: center;

  gap: 10px;

  font-size: 14px;

}

.badge-warn {

  background: #fff3e0;

  color: #e65100;

  padding: 4px 10px;

  border-radius: 999px;

  font-size: 12px;

}

.content {

  max-width: 280px;

  white-space: pre-wrap;

  word-break: break-word;

}

.actions select {

  width: auto;

  min-width: 100px;

  padding: 6px 8px;

  font-size: 13px;

}

.nowrap {

  white-space: nowrap;

}

.empty {

  color: var(--muted);

  font-size: 14px;

}

.success-msg {

  color: var(--success);

  font-size: 14px;

}

</style>

