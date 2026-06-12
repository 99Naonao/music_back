const { logInfo } = require('../error-codes');

function getBranding(db, channelService, channelRaw) {
    const channelId = channelService.normalizeChannelId(channelRaw);
    return channelService.getBrandingForChannel(db, channelId);
}

function listChannelThemePresets(channelService) {
    return { presets: channelService.channelThemePresets.listChannelThemePresets() };
}

function bindUserChannel(db, channelService, userId, channelRaw, source) {
    return channelService.bindUserChannel(db, userId, channelRaw, source || 'client');
}

function getActivePromos(getPromoCampaignsForScene, channelService, scene, channelRaw) {
    const channelId = channelService.normalizeChannelId(channelRaw);
    return { list: getPromoCampaignsForScene(scene, channelId) };
}

function recordPromoEvent(body) {
    if (body.promoId && body.action) {
        logInfo('promo/event', `${body.promoId} ${body.action}`, { scene: body.scene || '' });
    }
    return null;
}

module.exports = {
    getBranding,
    listChannelThemePresets,
    bindUserChannel,
    getActivePromos,
    recordPromoEvent
};
