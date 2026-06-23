<template>

  <div>

    <div class="head">

      <h2>数据看板</h2>

      <div class="filters">

        <input v-model="from" type="date" />

        <span>至</span>

        <input v-model="to" type="date" />

        <select v-model="channel">

          <option v-for="c in channelOptions" :key="c.id" :value="c.id">{{ c.name }}</option>

        </select>

        <select v-model="metric">

          <option value="dau">DAU</option>

          <option value="new_bindings">新增绑定</option>

          <option value="music_completed">音乐完成</option>

          <option value="cards_created">贺卡创建</option>

        </select>

        <button @click="loadAll" :disabled="loading">查询</button>

      </div>

    </div>



    <p v-if="error" class="error-msg">{{ error }}</p>

    <p v-if="loading">加载中…</p>



    <template v-else-if="overview">

      <div class="cards">

        <div class="card stat highlight">

          <div class="label">今日 DAU</div>

          <div class="num">{{ overview.today.dau }}</div>

          <div class="sub" v-if="overview.compare">

            较昨日 <span :class="chg(overview.compare.dauVsYesterday)">{{ fmt(overview.compare.dauVsYesterday) }}</span>

            · 较上周 <span :class="chg(overview.compare.dauVsLastWeek)">{{ fmt(overview.compare.dauVsLastWeek) }}</span>

          </div>

        </div>

        <div class="card stat">

          <div class="label">今日音乐完成</div>

          <div class="num">{{ overview.today.musicCompleted }}</div>

          <div class="sub" v-if="overview.compare">

            较昨日 <span :class="chg(overview.compare.musicCompletedVsYesterday)">{{ fmt(overview.compare.musicCompletedVsYesterday) }}</span>

          </div>

        </div>

        <div class="card stat">

          <div class="label">今日新增绑定</div>

          <div class="num">{{ overview.today.newBindings }}</div>

        </div>

        <div class="card stat">

          <div class="label">今日贺卡</div>

          <div class="num">{{ overview.today.cardsCreated }}</div>

        </div>

        <div class="card stat" :class="{ warn: overview.pendingFeedback > 0 }">

          <div class="label">待处理反馈</div>

          <div class="num">{{ overview.pendingFeedback ?? 0 }}</div>

        </div>

        <div class="card stat">

          <div class="label">区间反馈总数</div>

          <div class="num">{{ overview.feedbackCount }}</div>

        </div>

      </div>



      <div class="card chart-box">

        <h3>{{ metricLabel(metric) }} · 趋势</h3>

        <div v-if="!chartLabels.length" class="empty">暂无数据</div>

        <LineChart

          v-else

          :labels="chartLabels"

          :values="chartValues"

          :title="metricLabel(metric)"

        />

      </div>



      <div class="card">

        <h3>渠道对比</h3>

        <table class="table">

          <thead>

            <tr>

              <th>渠道</th>

              <th>DAU</th>

              <th>新增绑定</th>

              <th>音乐完成</th>

              <th>贺卡</th>

              <th></th>

            </tr>

          </thead>

          <tbody>

            <tr v-for="row in ranking" :key="row.channelId">

              <td>{{ row.channelName }} <code>{{ row.channelId }}</code></td>

              <td>{{ row.dau }}</td>

              <td>{{ row.newBindings }}</td>

              <td>{{ row.musicCompleted }}</td>

              <td>{{ row.cardsCreated }}</td>

              <td>

                <router-link :to="`/dashboard/channel/${row.channelId}`">详情</router-link>

              </td>

            </tr>

          </tbody>

        </table>

        <p v-if="!ranking.length" class="empty">暂无渠道统计</p>

      </div>

    </template>

  </div>

</template>



<script setup>

import { computed, onMounted, ref, watch } from 'vue'

import LineChart from '../components/LineChart.vue'

import {

  fetchStatsOverview,

  fetchStatsRanking,

  fetchStatsTimeseries,

  fetchStatsChannelOptions

} from '../api'



const from = ref('')

const to = ref('')

const channel = ref('all')

const metric = ref('dau')

const loading = ref(false)

const error = ref('')

const overview = ref(null)

const points = ref([])

const ranking = ref([])

const channelOptions = ref([{ id: 'all', name: '全部渠道' }])



const chartLabels = computed(() => points.value.map((p) => p.date.slice(5)))

const chartValues = computed(() => points.value.map((p) => p.value || 0))



function metricLabel(m) {

  const map = {

    dau: 'DAU',

    new_bindings: '新增绑定',

    music_completed: '音乐完成',

    cards_created: '贺卡创建'

  }

  return map[m] || m

}



function fmt(v) {

  if (v == null) return '—'

  const n = Number(v)

  return (n > 0 ? '+' : '') + n + '%'

}



function chg(v) {

  const n = Number(v)

  if (n > 0) return 'up'

  if (n < 0) return 'down'

  return 'flat'

}



function queryParams() {

  const q = { from: from.value, to: to.value }

  if (channel.value && channel.value !== 'all') q.channel = channel.value

  return q

}



async function loadAll() {

  loading.value = true

  error.value = ''

  try {

    const q = queryParams()

    overview.value = await fetchStatsOverview(q)

    const ts = await fetchStatsTimeseries({ ...q, metric: metric.value })

    points.value = ts.points || []

    const rank = await fetchStatsRanking(q)

    ranking.value = rank.list || []

    if (overview.value.from) from.value = overview.value.from

    if (overview.value.to) to.value = overview.value.to

  } catch (e) {

    error.value = e.message || '加载失败'

  } finally {

    loading.value = false

  }

}



watch(metric, () => {

  if (from.value && to.value) loadAll()

})



onMounted(async () => {

  try {

    const opts = await fetchStatsChannelOptions()

    channelOptions.value = opts.list || channelOptions.value

  } catch (e) {

    /* ignore */

  }

  await loadAll()

})

</script>



<style scoped>

.cards {

  display: grid;

  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));

  gap: 12px;

  margin-bottom: 20px;

}

.stat .label {

  font-size: 13px;

  color: var(--muted);

}

.stat .num {

  font-size: 28px;

  font-weight: 600;

  margin-top: 8px;

}

.stat .sub {

  font-size: 12px;

  color: var(--muted);

  margin-top: 6px;

}

.highlight {

  border-left: 4px solid var(--primary);

}

.warn {

  border-left: 4px solid #e65100;

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

.chart-box h3,

.card h3 {

  margin-top: 0;

  font-size: 16px;

}

.empty {

  color: var(--muted);

  font-size: 14px;

}

code {

  font-size: 12px;

}

</style>

