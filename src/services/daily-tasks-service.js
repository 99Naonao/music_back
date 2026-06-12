const { v4: uuidv4 } = require('uuid');
const pointsRepo = require('../repositories/points');
const pointsLedger = require('./points-ledger-service');
const { ErrorCode } = require('../error-codes');

function cnTodayDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    return `${y}-${m}-${d}`;
}

const DAILY_TASK_KEYS = new Set(['sign_in', 'create_music', 'share_work']);
const DAILY_TASK_POINTS = { sign_in: 1, create_music: 10, share_work: 3 };
const DAILY_TASK_LABELS = { sign_in: '每日签到', create_music: '创作音乐', share_work: '分享作品' };

function getDailyTasks(userId) {
    const claimDate = cnTodayDate();
    const rows = pointsRepo.listDailyClaimsForDate(userId, claimDate);
    const done = new Set(rows.map((r) => r.task_key));
    const tasks = [
        {
            taskKey: 'sign_in',
            icon: '签到',
            name: '每日签到',
            desc: '每日签到一次',
            points: DAILY_TASK_POINTS.sign_in,
            completed: done.has('sign_in')
        },
        {
            taskKey: 'create_music',
            icon: '音乐',
            name: '创作音乐',
            desc: '今日完成一首助眠音乐生成',
            points: DAILY_TASK_POINTS.create_music,
            completed: done.has('create_music')
        },
        {
            taskKey: 'share_work',
            icon: '分享',
            name: '分享作品',
            desc: '今日向好友转发分享贺卡',
            points: DAILY_TASK_POINTS.share_work,
            completed: done.has('share_work')
        }
    ];
    return { ok: true, data: { date: claimDate, tasks } };
}

function claimDailyTaskLocal(userId, taskKey, claimDate, points) {
    pointsLedger.getOrInitPoints(userId);
    pointsRepo.addPointsBalance(userId, points);
    pointsRepo.insertPointsHistory(
        uuidv4(),
        userId,
        points,
        `daily_${taskKey}`,
        `每日任务 ${claimDate}`
    );
    pointsRepo.insertDailyClaim(userId, taskKey, claimDate, points);
    const updated = pointsRepo.getUserPointsRow(userId);
    return {
        ok: true,
        data: {
            taskKey,
            points,
            claimDate,
            channel: 'local',
            currentPoints: updated.points
        }
    };
}

function claimDailyTaskShop(userId, taskKey, claimDate, points) {
    pointsRepo.insertDailyClaim(userId, taskKey, claimDate, points);
    pointsLedger.recordPointsLedger(
        userId,
        points,
        `daily_${taskKey}`,
        DAILY_TASK_LABELS[taskKey] || taskKey
    );
    return {
        ok: true,
        data: { taskKey, points, claimDate, channel: 'shop' }
    };
}

function prepareDailyClaim(userId, taskKey) {
    if (!taskKey || !DAILY_TASK_KEYS.has(taskKey)) {
        return {
            ok: false,
            error: ErrorCode.MISSING_REQUIRED_PARAM,
            message: 'taskKey 须为 sign_in | create_music | share_work'
        };
    }
    const points = DAILY_TASK_POINTS[taskKey];
    const claimDate = cnTodayDate();
    if (pointsRepo.hasDailyClaim(userId, taskKey, claimDate)) {
        return {
            ok: true,
            alreadyClaimed: true,
            data: { taskKey, points: 0, claimDate, alreadyClaimed: true }
        };
    }
    return { ok: true, alreadyClaimed: false, taskKey, points, claimDate };
}

async function claimDailyTaskViaShop(user, shopToken, taskKey, shopApi, callShopWithAutoRefresh) {
    const prep = prepareDailyClaim(user.id, taskKey);
    if (!prep.ok) return prep;
    if (prep.alreadyClaimed) {
        return { ok: true, data: prep.data, message: '今日该任务已完成' };
    }

    const { data } = await callShopWithAutoRefresh(
        user,
        shopToken,
        (tok) => shopApi.thirdGrantIntegral(tok, prep.points),
        '商城发放积分'
    );
    if (!shopApi.isShopApiSuccess(data)) {
        return {
            ok: false,
            error: ErrorCode.MALL_API_ERROR,
            message: (data && (data.msg || data.message)) || '商城发放积分失败'
        };
    }
    const result = claimDailyTaskShop(user.id, prep.taskKey, prep.claimDate, prep.points);
    return {
        ok: true,
        data: result.data,
        message: (data && data.msg) || '领取成功'
    };
}

module.exports = {
    cnTodayDate,
    DAILY_TASK_KEYS,
    DAILY_TASK_POINTS,
    DAILY_TASK_LABELS,
    getDailyTasks,
    claimDailyTaskLocal,
    claimDailyTaskShop,
    prepareDailyClaim,
    claimDailyTaskViaShop
};
