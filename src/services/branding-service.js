const { logInfo } = require('../error-codes');
const channelAnalytics = require('./channel-analytics-service');

function getBranding(db, channelService, channelRaw) {
    const channelId = channelService.normalizeChannelId(channelRaw);
    return channelService.getBrandingForChannel(db, channelId);
}

function listChannelThemePresets(channelService) {
    return { presets: channelService.channelThemePresets.listChannelThemePresets() };
}

function bindUserChannel(db, channelService, userId, channelRaw, source) {
    const result = channelService.bindUserChannel(db, userId, channelRaw, source || 'client');
    if (result && result.isNewBinding && !result.cleared) {
        channelAnalytics.recordChannelBind(db, userId, result.channelId, source || 'client', {
            isNewBinding: true
        });
    }
    return result;
}

function recordAppLaunch(db, req, body) {
    return channelAnalytics.recordAppLaunch(db, req, body || {});
}

function getActivePromos(getPromoCampaignsForScene, channelService, scene, channelRaw) {
    const channelId = channelService.normalizeChannelId(channelRaw);
    return { list: getPromoCampaignsForScene(scene, channelId) };
}

function recordPromoEvent(db, body) {
    const promoId = body && body.promoId ? String(body.promoId).trim() : '';
    const action = body && body.action ? String(body.action).trim() : '';
    const scene = body && body.scene ? String(body.scene).trim() : '';
    const channelRaw = body && (body.channel || body.channelId) ? String(body.channel || body.channelId).trim() : '';

    if (promoId && action) {
        logInfo('promo/event', `${promoId} ${action}`, { scene });
        if (db) {
            try {
                const channelAnalytics = require('./channel-analytics-service');
                const channelId = channelRaw
                    ? channelAnalytics.statChannelId(channelRaw)
                    : 'default';
                db.prepare(
                    `INSERT INTO biz_events (event_type, channel_id, payload_json, created_at)
                     VALUES (?, ?, ?, datetime('now', 'localtime'))`
                ).run(
                    `promo.${action}`,
                    channelId,
                    JSON.stringify({ promoId, action, scene })
                );
            } catch (e) {
                /* 统计失败不影响客户端 */
            }
        }
    }
    return null;
}

module.exports = {
    getBranding,
    listChannelThemePresets,
    bindUserChannel,
    getActivePromos,
    recordPromoEvent,
    recordAppLaunch
};
