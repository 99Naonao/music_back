/**
 * 运营弹窗活动配置（GET /api/promo/active）
 * 与小程序 utils/promo-fallback.js 字段对齐
 */
const PROMO_INACTIVE_DAYS = 7;

const ACTIVE_CAMPAIGNS = [
    {
        id: 'inactive_visit',
        type: 'rich',
        category: 'retention',
        priority: 100,
        rule: 'inactive_visit',
        minInactiveDays: PROMO_INACTIVE_DAYS,
        scenes: ['home_show', 'mine_show'],
        badge: '好久不见',
        title: '已经 {{days}} 天没来了',
        subtitle: '今晚做一张助眠贺卡，或听一段专属音乐放松一下？',
        buttonText: '去首页看看',
        secondaryText: '7天内不再提示',
        linkPath: '/pages/create/create',
        linkType: 'switchTab',
        enabled: true
    },
    {
        id: 'inactive_login',
        type: 'rich',
        category: 'retention',
        priority: 95,
        rule: 'inactive_login',
        minInactiveDays: PROMO_INACTIVE_DAYS,
        scenes: ['home_show', 'mine_show', 'complete_show'],
        badge: '登录有礼',
        title: '登录后体验更完整',
        subtitle: '分享贺卡得积分、同步作品与任务进度',
        buttonText: '去登录',
        secondaryText: '7天内不再提示',
        linkPath: '/pages/mine/mine',
        linkType: 'switchTab',
        enabled: true
    },
    {
        id: 'inactive_card',
        type: 'rich',
        category: 'retention',
        priority: 90,
        rule: 'inactive_card',
        minInactiveDays: PROMO_INACTIVE_DAYS,
        scenes: ['home_show', 'complete_show', 'player_show'],
        badge: '晚安贺卡',
        title: '距离上次制作贺卡已 {{days}} 天',
        subtitle: '换一首曲子、换一句祝福，再给 TA 一份新的助眠礼',
        buttonText: '制作贺卡',
        secondaryText: '7天内不再提示',
        linkPath: '/pages/create/card-pick',
        linkType: 'navigate',
        enabled: true
    },
    {
        id: 'inactive_music',
        type: 'rich',
        category: 'retention',
        priority: 85,
        rule: 'inactive_music',
        minInactiveDays: PROMO_INACTIVE_DAYS,
        scenes: ['home_show', 'complete_show', 'player_show'],
        badge: 'AI 助眠曲',
        title: '已经 {{days}} 天没生成音乐了',
        subtitle: '用 AI 配一段新音景，睡眠仪式常换常新',
        buttonText: '开始生成',
        secondaryText: '7天内不再提示',
        linkPath: '/pages/create/config',
        linkType: 'switchTab',
        enabled: true
    },
    {
        id: 'inactive_community',
        type: 'rich',
        category: 'retention',
        priority: 80,
        rule: 'inactive_community',
        minInactiveDays: PROMO_INACTIVE_DAYS,
        scenes: ['home_show', 'community_show'],
        badge: '盒友圈',
        title: '好久没在盒友圈分享了',
        subtitle: '分享你的助眠心得或作品，和更多眠友互相陪伴',
        buttonText: '去盒友圈',
        secondaryText: '7天内不再提示',
        linkPath: '/pages/communites/communites',
        linkType: 'switchTab',
        enabled: true
    },
    // 暂时关闭：分享后伴手礼弹窗（与小程序 share.js 同步恢复）
    // {
    //     id: 'after_card_share_gift',
    //     type: 'rich',
    //     category: 'conversion',
    //     priority: 75,
    //     rule: 'always',
    //     scenes: ['after_card_share'],
    //     badge: '伴手礼',
    //     title: '再送一份眠家伴手礼？',
    //     subtitle: '贺卡已准备好，可搭配深睡好物，让 TA 睡得更稳',
    //     buttonText: '去挑选好物',
    //     secondaryText: '7天内不再提示',
    //     linkPath: '/package-mall/pages/mianjia/index',
    //     linkType: 'navigate',
    //     enabled: true
    // },
    {
        id: 'after_generate_card',
        type: 'rich',
        category: 'conversion',
        priority: 70,
        rule: 'always',
        scenes: ['after_generate'],
        badge: '生成成功',
        title: '音乐已就绪，做张贺卡吧',
        subtitle: '把这首专属助眠曲配上祝福，送给在乎的人',
        buttonText: '制作贺卡',
        secondaryText: '7天内不再提示',
        linkPath: '/pages/create/card-pick',
        linkType: 'navigate',
        enabled: true
    },
    // mianjia_goods 已下线（首页横条入口保留，不再弹居中运营窗）
];

function getPromoCampaignsForScene(scene) {
    const list = ACTIVE_CAMPAIGNS.filter((c) => c.enabled !== false);
    if (!scene) return list;
    return list.filter((c) => Array.isArray(c.scenes) && c.scenes.includes(scene));
}

module.exports = {
    PROMO_INACTIVE_DAYS,
    ACTIVE_CAMPAIGNS,
    getPromoCampaignsForScene
};
