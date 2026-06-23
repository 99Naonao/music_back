<template>
  <div ref="el" class="chart-root" />
</template>

<script setup>
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  steps: { type: Array, default: () => [] }
})

const el = ref(null)
let chart = null

function render() {
  if (!el.value) return
  if (!chart) chart = echarts.init(el.value)
  const labels = props.steps.map((s) => s.label)
  const values = props.steps.map((s) => s.count || 0)
  chart.setOption({
    color: ['#7568a8'],
    grid: { left: 120, right: 24, top: 16, bottom: 24 },
    tooltip: {
      trigger: 'axis',
      formatter(params) {
        const p = params[0]
        const step = props.steps[p.dataIndex]
        const rate = step && step.rateFromLaunch != null ? ` · 占启动 ${step.rateFromLaunch}%` : ''
        return `${p.name}<br/>${p.value}${rate}`
      }
    },
    xAxis: { type: 'value', minInterval: 1 },
    yAxis: {
      type: 'category',
      data: [...labels].reverse(),
      axisLabel: { fontSize: 12 }
    },
    series: [
      {
        type: 'bar',
        data: [...values].reverse(),
        barMaxWidth: 28,
        label: { show: true, position: 'right', fontSize: 11 }
      }
    ]
  })
}

watch(() => props.steps, render, { deep: true })
onMounted(render)
onBeforeUnmount(() => {
  if (chart) chart.dispose()
})
</script>

<style scoped>
.chart-root {
  width: 100%;
  height: 320px;
}
</style>
