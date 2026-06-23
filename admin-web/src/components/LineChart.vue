<template>
  <div ref="el" class="chart-root" />
</template>

<script setup>
import * as echarts from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  labels: { type: Array, default: () => [] },
  values: { type: Array, default: () => [] },
  title: { type: String, default: '' },
  color: { type: String, default: '#7568a8' }
})

const el = ref(null)
let chart = null

function render() {
  if (!el.value) return
  if (!chart) chart = echarts.init(el.value)
  chart.setOption({
    color: [props.color],
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: props.labels,
      axisLabel: { fontSize: 11, color: '#8a8494' }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { fontSize: 11, color: '#8a8494' },
      splitLine: { lineStyle: { color: '#e8e2f0' } }
    },
    series: [
      {
        name: props.title,
        type: 'line',
        smooth: true,
        areaStyle: { opacity: 0.12 },
        data: props.values
      }
    ]
  })
}

function onResize() {
  chart && chart.resize()
}

watch(() => [props.labels, props.values, props.title], render, { deep: true })

onMounted(() => {
  render()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  if (chart) {
    chart.dispose()
    chart = null
  }
})
</script>

<style scoped>
.chart-root {
  width: 100%;
  height: 280px;
}
</style>
