<template>

  <div class="layout">

    <aside class="sidebar">

      <div class="brand">眠音盒 Admin</div>

      <nav>

        <div class="nav-group">

          <div class="nav-label">概览</div>

          <router-link to="/workbench" class="nav-item" active-class="active">工作台</router-link>

        </div>

        <div class="nav-group">

          <div class="nav-label">数据</div>

          <router-link to="/dashboard" class="nav-item" active-class="active">数据看板</router-link>

          <router-link to="/analytics/funnel" class="nav-item" active-class="active">漏斗 / 留存</router-link>

          <router-link to="/export" class="nav-item" active-class="active">报表导出</router-link>

        </div>

        <div class="nav-group">

          <div class="nav-label">运营</div>

          <router-link to="/feedback" class="nav-item" active-class="active">用户反馈</router-link>

          <router-link to="/community" class="nav-item" active-class="active">社区审核</router-link>

          <router-link to="/promo" class="nav-item" active-class="active">运营弹窗</router-link>

        </div>

        <div class="nav-group">

          <div class="nav-label">配置</div>

          <router-link to="/channels" class="nav-item" active-class="active">渠道配置</router-link>

          <router-link to="/content/library" class="nav-item" active-class="active">官方曲库</router-link>

          <router-link to="/content/cards" class="nav-item" active-class="active">贺卡模板</router-link>

          <router-link to="/content/banners" class="nav-item" active-class="active">首页 Banner</router-link>

        </div>

        <div class="nav-group">

          <div class="nav-label">系统</div>

          <router-link to="/audit" class="nav-item" active-class="active">操作日志</router-link>

          <router-link to="/settings/account" class="nav-item" active-class="active">修改密码</router-link>

          <router-link v-if="isSuper" to="/settings/admins" class="nav-item" active-class="active">管理员</router-link>

          <router-link to="/settings/health" class="nav-item" active-class="active">系统健康</router-link>

        </div>

      </nav>

      <div class="sidebar-foot">

        <div class="user">{{ userLabel }}</div>

        <button class="secondary" @click="onLogout">退出</button>

      </div>

    </aside>

    <main class="main">

      <router-view />

    </main>

  </div>

</template>



<script setup>

import { onMounted, ref } from 'vue'

import { useRouter } from 'vue-router'

import { fetchMe, logout } from '../api'



const router = useRouter()

const userLabel = ref('')
const isSuper = ref(false)



onMounted(async () => {

  try {

    const data = await fetchMe()

    userLabel.value = `${data.user.username}（${data.user.role}）`
    isSuper.value = data.user.role === 'super'

  } catch (e) {

    router.replace('/login')

  }

})



async function onLogout() {

  try {

    await logout()

  } catch (e) {

    /* ignore */

  }

  router.replace('/login')

}

</script>



<style scoped>

.layout {

  display: flex;

  min-height: 100vh;

}

.sidebar {

  width: 220px;

  background: #2d2438;

  color: #fff;

  display: flex;

  flex-direction: column;

  padding: 20px 16px;

}

.brand {

  font-weight: 600;

  margin-bottom: 20px;

}

.nav-group {

  margin-bottom: 12px;

}

.nav-label {

  font-size: 11px;

  text-transform: uppercase;

  letter-spacing: 0.04em;

  opacity: 0.45;

  padding: 0 12px 6px;

}

.nav-item {

  display: block;

  padding: 10px 12px;

  border-radius: 8px;

  color: rgba(255, 255, 255, 0.85);

  margin-bottom: 2px;

}

.nav-item.active,

.nav-item:hover {

  background: rgba(255, 255, 255, 0.12);

  color: #fff;

}

.sidebar-foot {

  margin-top: auto;

  padding-top: 16px;

  border-top: 1px solid rgba(255, 255, 255, 0.12);

}

.user {

  font-size: 13px;

  margin-bottom: 8px;

  opacity: 0.85;

}

.sidebar-foot button {

  width: 100%;

}

.main {

  flex: 1;

  padding: 24px;

  overflow: auto;

}

</style>

