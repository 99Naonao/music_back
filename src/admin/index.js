const express = require('express');
const router = express.Router();
const { sendSuccess } = require('../error-codes');
const { adminAuthMiddleware } = require('./middleware');

router.get('/health', (req, res) => {
    return sendSuccess(
        res,
        {
            service: 'admin',
            publicPath: '/admin',
            apiPrefix: '/api/admin'
        },
        'Admin API 就绪'
    );
});

router.use('/auth', require('./routes/auth'));
router.use(require('./routes/channels'));
try {
    router.use(require('./routes/stats'));
} catch (err) {
    console.error('[Admin] 数据看板路由加载失败（登录/渠道仍可用）:', err.message);
    if (err.stack) console.error(err.stack);
}
router.use(require('./routes/upload'));
router.use(require('./routes/feedback'));
router.use(require('./routes/community'));
router.use(require('./routes/promo'));
router.use(require('./routes/export'));
router.use(require('./routes/workbench'));
router.use(require('./routes/audit'));
router.use(require('./routes/settings'));
router.use(require('./routes/analytics'));
router.use(require('./routes/content'));

router.get('/ping', adminAuthMiddleware, (req, res) => {
    return sendSuccess(
        res,
        {
            ok: true,
            username: req.adminUser.username,
            role: req.adminUser.role
        },
        '鉴权正常'
    );
});

module.exports = router;
