/**
 * 积分服务 - 与眠加商城积分系统对接
 * 商城技术栈: uni-app + PHP + MySQL
 * 对接方式: HTTP API
 */

const axios = require('axios');

// 商城API配置
const MALL_API_CONFIG = {
    baseUrl: process.env.MALL_API_URL || 'https://your-mall-domain.com/api',
    appKey: process.env.MALL_APP_KEY || 'your-app-key',
    appSecret: process.env.MALL_APP_SECRET || 'your-app-secret'
};

/**
 * 生成API签名
 */
function generateSign(params) {
    const crypto = require('crypto');
    const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
    return crypto.createHash('md5').update(sortedParams + MALL_API_CONFIG.appSecret).digest('hex');
}

/**
 * 获取用户积分
 * @param {string} openid - 微信openid
 */
async function getUserPoints(openid) {
    try {
        const params = {
            appKey: MALL_API_CONFIG.appKey,
            openid: openid,
            timestamp: Date.now()
        };
        params.sign = generateSign(params);

        const response = await axios.get(`${MALL_API_CONFIG.baseUrl}/points/get`, { params });

        if (response.data.code === 0) {
            return {
                success: true,
                points: response.data.data.points,
                totalPoints: response.data.data.total_points
            };
        } else {
            throw new Error(response.data.message);
        }
    } catch (error) {
        console.error('获取用户积分失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 增加用户积分
 * @param {string} openid - 微信openid
 * @param {number} points - 积分数量
 * @param {string} type - 积分类型: share_music|daily_task|invite|purchase
 * @param {string} description - 积分描述
 */
async function addPoints(openid, points, type, description) {
    try {
        const params = {
            appKey: MALL_API_CONFIG.appKey,
            openid: openid,
            points: points,
            type: type,
            description: description,
            timestamp: Date.now()
        };
        params.sign = generateSign(params);

        const response = await axios.post(`${MALL_API_CONFIG.baseUrl}/points/add`, params);

        if (response.data.code === 0) {
            return {
                success: true,
                currentPoints: response.data.data.current_points,
                addedPoints: points
            };
        } else {
            throw new Error(response.data.message);
        }
    } catch (error) {
        console.error('增加积分失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 扣除用户积分
 * @param {string} openid - 微信openid
 * @param {number} points - 积分数量
 * @param {string} type - 消费类型: generate_music|unlock_template|exchange_coupon
 * @param {string} description - 消费描述
 */
async function deductPoints(openid, points, type, description) {
    try {
        const params = {
            appKey: MALL_API_CONFIG.appKey,
            openid: openid,
            points: points,
            type: type,
            description: description,
            timestamp: Date.now()
        };
        params.sign = generateSign(params);

        const response = await axios.post(`${MALL_API_CONFIG.baseUrl}/points/deduct`, params);

        if (response.data.code === 0) {
            return {
                success: true,
                currentPoints: response.data.data.current_points,
                deductedPoints: points
            };
        } else {
            throw new Error(response.data.message);
        }
    } catch (error) {
        console.error('扣除积分失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 获取积分记录
 * @param {string} openid - 微信openid
 * @param {number} page - 页码
 * @param {number} limit - 每页数量
 */
async function getPointsHistory(openid, page = 1, limit = 20) {
    try {
        const params = {
            appKey: MALL_API_CONFIG.appKey,
            openid: openid,
            page: page,
            limit: limit,
            timestamp: Date.now()
        };
        params.sign = generateSign(params);

        const response = await axios.get(`${MALL_API_CONFIG.baseUrl}/points/history`, { params });

        if (response.data.code === 0) {
            return {
                success: true,
                list: response.data.data.list,
                total: response.data.data.total
            };
        } else {
            throw new Error(response.data.message);
        }
    } catch (error) {
        console.error('获取积分记录失败:', error);
        return { success: false, error: error.message };
    }
}

/**
 * 积分类型定义
 */
const POINTS_TYPE = {
    // 获得积分
    EARN: {
        SHARE_MUSIC: { type: 'share_music', points: 20, desc: '首次分享音乐' },
        MUSIC_PLAYED: { type: 'music_played', points: 2, desc: '音乐被播放' },
        MUSIC_LIKED: { type: 'music_liked', points: 5, desc: '音乐被点赞' },
        MUSIC_SHARED: { type: 'music_shared', points: 10, desc: '音乐被转发' },
        POST_COMMENT: { type: 'post_comment', points: 3, desc: '发表评论' },
        DAILY_SIGN: { type: 'daily_sign', points: 5, desc: '每日签到' },
        INVITE_FRIEND: { type: 'invite_friend', points: 50, desc: '邀请好友' },
        PURCHASE: { type: 'purchase', points: 1, desc: '购物消费' } // 1元=1积分
    },
    // 消耗积分
    SPEND: {
        GENERATE_MUSIC: { type: 'generate_music', points: 30, desc: 'AI生成音乐' },
        UNLOCK_TEMPLATE: { type: 'unlock_template', points: 50, desc: '解锁高级模板' },
        EXCHANGE_COUPON: { type: 'exchange_coupon', points: 100, desc: '兑换优惠券' }
    }
};

module.exports = {
    getUserPoints,
    addPoints,
    deductPoints,
    getPointsHistory,
    POINTS_TYPE,
    MALL_API_CONFIG
};
