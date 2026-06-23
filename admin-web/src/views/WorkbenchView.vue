<template>
  <div>
    <h2>工作台</h2>
    <p v-if="error" class="error-msg">{{ error }}</p>
    <p v-if="loading">加载中…</p>

    <template v-else-if="data">
      <div class="cards">
        <div class="card stat highlight">
          <div class="label">今日 DAU</div>
          <div class="num">{{ data.today.dau }}</div>
          <div class="sub">
            较昨日
            <span :class="changeClass(data.compare?.dauVsYesterday)">
              {{ fmtChange(data.compare?.dauVsYesterday) }}
            </span>
            · 较上周
            <span :class="changeClass(data.compare?.dauVsLastWeek)">
              {{ fmtChange(data.compare?.dauVsLastWeek) }}
            </span>
          </div>
        </div>
        <div class="card stat">
          <div class="label">昨日 DAU</div>
          <div class="num">{{ data.yesterdayDau }}</div>
        </div>
        <div class="card stat warn" v-if="data.pendingFeedback > 0">
          <div class="label">待处理反馈</div>
          <div class="num">{{ data.pendingFeedback }}</div>
          <router-link to="/feedback?status=pending" class="link">去处理 →</router-link>
        </div>
        <div class="card stat" v-else>
          <div class="label">待处理反馈</div>
          <div class="num">0</div>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>待办提醒</h3>
          <div v-if="data.zeroDauChannels.length" class="todo-block">
            <div class="todo-title">近 7 日零 DAU 渠道</div>
            <ul>
              <li v-for="c in data.zeroDauChannels" :key="c.id">
                <router-link :to="`/dashboard/channel/${c.id}`">{{ c.name }}</router-link>
                <code>{{ c.id }}</code>
              </li>
            </ul>
          </div>
          <div v-if="data.expiringContracts.length" class="todo-block">
            <div class="todo-title">30 天内合同到期</div>
            <ul>
              <li v-for="c in data.expiringContracts" :key="c.id">
                {{ c.name }} · {{ c.contractEnd }}
                <router-link :to="`/channels/${c.id}`">编辑</router-link>
              </li>
            </ul>
          </div>
          <p
            v-if="!data.zeroDauChannels.length && !data.expiringContracts.length && !data.pendingFeedback"
            class="empty"
          >
            暂无待办，一切正常
          </p>
        </div>

        <div class="card">
          <h3>快捷入口</h3>
          <div class="shortcuts">
            <router-link to="/channels/new" class="shortcut">新建渠道</router-link>
            <router-link to="/dashboard" class="shortcut">数据看板</router-link>
            <router-link to="/export" class="shortcut">导出月报</router-link>
            <router-link to="/audit" class="shortcut">操作日志</router-link>
            <router-link to="/promo" class="shortcut">运营弹窗</router-link>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { fetchWorkbench } from '../api'

const loading = ref(true)
const error = ref('')
const data = ref(null)

function fmtChange(v) {
  if (v == null || Number.isNaN(v)) return '—'
  const n = Number(v)
  return (n > 0 ? '+' : '') + n + '%'
}

function changeClass(v) {
  const n = Number(v)
  if (n > 0) return 'up'
  if (n < 0) return 'down'
  return 'flat'
}

onMounted(async () => {
  try {
    data.value = await fetchWorkbench()
  } catch (e) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
h2 {
  margin: 0 0 16px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.stat .label {
  font-size: 13px;
  color: var(--muted);
}
.stat .num {
  font-size: 32px;
  font-weight: 600;
  margin-top: 8px;
}
.stat .sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 8px;
}
.highlight {
  border-left: 4px solid var(--primary);
}
.warn {
  border-left: 4px solid #e65100;
}
.link {
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
}
.up {
  color: var(--success);
  font-weight: 600;
}
.down {
  color: var(--danger);
  font-weight: 600;
}
.flat {
  color: var(--muted);
}
.card h3 {
  margin-top: 0;
  font-size: 16px;
}
.todo-block {
  margin-bottom: 16px;
}
.todo-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}
.todo-block ul {
  margin: 0;
  padding-left: 18px;
  font-size: 14px;
}
.todo-block li {
  margin-bottom: 6px;
}
.shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.shortcut {
  display: inline-block;
  padding: 10px 14px;
  background: var(--bg);
  border-radius: 8px;
  font-size: 14px;
}
.empty {
  color: var(--muted);
  font-size: 14px;
}
code {
  font-size: 11px;
  margin-left: 4px;
}
</style>
