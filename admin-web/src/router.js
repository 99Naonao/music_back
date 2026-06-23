import { createRouter, createWebHashHistory } from 'vue-router'
import LoginView from './views/LoginView.vue'
import LayoutView from './views/LayoutView.vue'
import ChannelsView from './views/ChannelsView.vue'
import ChannelEditView from './views/ChannelEditView.vue'
import DashboardView from './views/DashboardView.vue'
import FeedbackView from './views/FeedbackView.vue'
import CommunityView from './views/CommunityView.vue'
import PromoView from './views/PromoView.vue'
import PromoEditView from './views/PromoEditView.vue'
import ExportView from './views/ExportView.vue'
import WorkbenchView from './views/WorkbenchView.vue'
import AuditView from './views/AuditView.vue'
import ChannelDashboardView from './views/ChannelDashboardView.vue'
import SettingsAccountView from './views/SettingsAccountView.vue'
import SettingsAdminsView from './views/SettingsAdminsView.vue'
import SettingsHealthView from './views/SettingsHealthView.vue'
import FunnelView from './views/FunnelView.vue'
import CommunityPostView from './views/CommunityPostView.vue'
import LibraryAdminView from './views/LibraryAdminView.vue'
import CardsAdminView from './views/CardsAdminView.vue'
import BannersAdminView from './views/BannersAdminView.vue'
import { fetchMe } from './api'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    {
      path: '/',
      component: LayoutView,
      children: [
        { path: '', redirect: '/workbench' },
        { path: 'workbench', name: 'workbench', component: WorkbenchView },
        { path: 'dashboard', name: 'dashboard', component: DashboardView },
        { path: 'dashboard/channel/:id', name: 'channel-dashboard', component: ChannelDashboardView, props: true },
        { path: 'analytics/funnel', name: 'funnel', component: FunnelView },
        { path: 'feedback', name: 'feedback', component: FeedbackView },
        { path: 'community', name: 'community', component: CommunityView },
        { path: 'community/:id', name: 'community-post', component: CommunityPostView, props: true },
        { path: 'content/library', name: 'content-library', component: LibraryAdminView },
        { path: 'content/cards', name: 'content-cards', component: CardsAdminView },
        { path: 'content/banners', name: 'content-banners', component: BannersAdminView },
        { path: 'promo', name: 'promo', component: PromoView },
        { path: 'promo/new', name: 'promo-new', component: PromoEditView },
        { path: 'promo/:id', name: 'promo-edit', component: PromoEditView, props: true },
        { path: 'export', name: 'export', component: ExportView },
        { path: 'audit', name: 'audit', component: AuditView },
        { path: 'settings/account', name: 'settings-account', component: SettingsAccountView },
        { path: 'settings/admins', name: 'settings-admins', component: SettingsAdminsView },
        { path: 'settings/health', name: 'settings-health', component: SettingsHealthView },
        { path: 'channels', name: 'channels', component: ChannelsView },
        { path: 'channels/new', name: 'channel-new', component: ChannelEditView },
        { path: 'channels/:id', name: 'channel-edit', component: ChannelEditView, props: true }
      ]
    }
  ]
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  try {
    await fetchMe()
    return true
  } catch (e) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
})

export default router
