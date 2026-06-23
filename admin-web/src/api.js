const API_BASE = ''

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  })
  let data = null
  try {
    data = await res.json()
  } catch (e) {
    throw new Error(`响应非 JSON（HTTP ${res.status}）`)
  }
  if (!data || data.code !== 0) {
    const msg = (data && data.message) || `请求失败（HTTP ${res.status}）`
    const err = new Error(msg)
    err.status = res.status
    err.code = data && data.code
    throw err
  }
  return data.data
}

function statsQuery(params) {
  const q = new URLSearchParams()
  Object.keys(params || {}).forEach((k) => {
    if (params[k] != null && params[k] !== '') q.set(k, String(params[k]))
  })
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function login(username, password) {
  return request('/api/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
}

export function logout() {
  return request('/api/admin/auth/logout', { method: 'POST' })
}

export function fetchMe() {
  return request('/api/admin/auth/me')
}

export function fetchStatsOverview(params) {
  return request(`/api/admin/stats/overview${statsQuery(params)}`)
}

export function fetchStatsTimeseries(params) {
  return request(`/api/admin/stats/timeseries${statsQuery(params)}`)
}

export function fetchStatsRanking(params) {
  return request(`/api/admin/stats/channels-ranking${statsQuery(params)}`)
}

export function fetchStatsChannelOptions() {
  return request('/api/admin/stats/channel-options')
}

export function listChannels() {
  return request('/api/admin/channels')
}

export function getChannel(id) {
  return request(`/api/admin/channels/${encodeURIComponent(id)}`)
}

export function createChannel(payload) {
  return request('/api/admin/channels', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export function updateChannel(id, payload) {
  return request(`/api/admin/channels/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export function patchChannelStatus(id, status) {
  return request(`/api/admin/channels/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  })
}

export function updateBranding(id, payload) {
  return request(`/api/admin/channels/${encodeURIComponent(id)}/branding`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export async function uploadImage(file) {
  const form = new FormData()
  form.append('image', file)
  const res = await fetch('/api/admin/upload/image', {
    method: 'POST',
    credentials: 'include',
    body: form
  })
  let data = null
  try {
    data = await res.json()
  } catch (e) {
    throw new Error('上传失败')
  }
  if (!data || data.code !== 0) {
    throw new Error((data && data.message) || '上传失败')
  }
  return data.data.url
}

export function listFeedback(params) {
  return request(`/api/admin/feedback${statsQuery(params)}`)
}

export function patchFeedback(id, body) {
  return request(`/api/admin/feedback/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function fetchWorkbench() {
  return request('/api/admin/workbench')
}

export function listAuditLogs(params) {
  return request(`/api/admin/audit-logs${statsQuery(params)}`)
}

export function fetchChannelStats(id, params) {
  return request(`/api/admin/stats/channel/${encodeURIComponent(id)}${statsQuery(params)}`)
}

export function searchCommunityPosts(params) {
  return request(`/api/admin/community/posts${statsQuery(params)}`)
}

export function deleteCommunityPost(id) {
  return request(`/api/admin/community/posts/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}

export function listPromoCampaigns() {
  return request('/api/admin/promo/campaigns')
}

export function getPromoCampaign(id) {
  return request(`/api/admin/promo/campaigns/${encodeURIComponent(id)}`)
}

export function savePromoCampaign(id, payload) {
  const method = id ? 'PUT' : 'POST'
  const path = id
    ? `/api/admin/promo/campaigns/${encodeURIComponent(id)}`
    : '/api/admin/promo/campaigns'
  return request(path, { method, body: JSON.stringify(payload) })
}

export function patchPromoStatus(id, body) {
  return request(`/api/admin/promo/campaigns/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function fetchPromoMeta() {
  return request('/api/admin/promo/meta')
}

export function simulatePromo(params) {
  return request(`/api/admin/promo/simulate${statsQuery(params)}`)
}

export function fetchPromoStats(id, params) {
  return request(`/api/admin/promo/campaigns/${encodeURIComponent(id)}/stats${statsQuery(params)}`)
}

export function fetchChannelHub(id, params) {
  return request(`/api/admin/channels/${encodeURIComponent(id)}/hub${statsQuery(params)}`)
}

export function copyChannelBranding(id, sourceChannelId) {
  return request(`/api/admin/channels/${encodeURIComponent(id)}/branding/copy`, {
    method: 'POST',
    body: JSON.stringify({ sourceChannelId })
  })
}

export function batchChannelStatus(ids, status) {
  return request('/api/admin/channels/batch-status', {
    method: 'PATCH',
    body: JSON.stringify({ ids, status })
  })
}

export function fetchSystemHealth() {
  return request('/api/admin/settings/health')
}

export function changePassword(currentPassword, newPassword) {
  return request('/api/admin/settings/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword })
  })
}

export function listAdmins() {
  return request('/api/admin/settings/admins')
}

export function createAdmin(payload) {
  return request('/api/admin/settings/admins', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export function patchAdmin(id, payload) {
  return request(`/api/admin/settings/admins/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  })
}

export function previewExport(params) {
  return request(`/api/admin/export/preview${statsQuery(params)}`)
}

export function createExportJob(body) {
  return request('/api/admin/export/jobs', {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

export async function downloadExportJob(jobId) {
  const res = await fetch(`/api/admin/export/jobs/${encodeURIComponent(jobId)}/download`, {
    credentials: 'include'
  })
  if (!res.ok) {
    let msg = `下载失败（HTTP ${res.status}）`
    try {
      const data = await res.json()
      if (data && data.message) msg = data.message
    } catch (e) {
      /* ignore */
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const m = disposition.match(/filename="([^"]+)"/)
  const filename = m ? m[1] : `export_${jobId.slice(0, 8)}.csv`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function fetchFunnel(params) {
  return request(`/api/admin/analytics/funnel${statsQuery(params)}`)
}

export function fetchRetention(params) {
  return request(`/api/admin/analytics/retention${statsQuery(params)}`)
}

export function getCommunityPost(id) {
  return request(`/api/admin/community/posts/${encodeURIComponent(id)}`)
}

export function deleteCommunityComment(postId, commentId) {
  return request(
    `/api/admin/community/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
    { method: 'DELETE' }
  )
}

export function fetchCommunityUserRisk(openid) {
  return request(`/api/admin/community/users/${encodeURIComponent(openid)}/risk`)
}

export function listLibraryTracks(params) {
  return request(`/api/admin/content/library${statsQuery(params)}`)
}

export function patchLibraryTrack(id, body) {
  return request(`/api/admin/content/library/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function listCardTemplates(params) {
  return request(`/api/admin/content/card-templates${statsQuery(params)}`)
}

export function patchCardTemplate(id, body) {
  return request(`/api/admin/content/card-templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  })
}

export function fetchCardSyncInfo() {
  return request('/api/admin/content/card-templates/sync-info')
}

export function syncCardTemplates() {
  return request('/api/admin/content/card-templates/sync', { method: 'POST' })
}

export function listBanners() {
  return request('/api/admin/content/banners')
}

export function saveBanner(id, body) {
  const method = id ? 'PUT' : 'POST'
  const path = id
    ? `/api/admin/content/banners/${encodeURIComponent(id)}`
    : '/api/admin/content/banners'
  return request(path, { method, body: JSON.stringify(body) })
}

export function deleteBanner(id) {
  return request(`/api/admin/content/banners/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
