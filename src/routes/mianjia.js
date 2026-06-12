/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const mianjiaCatalog = require('../services/mianjia-catalog-service');

const { sendError, sendSuccess } = ctx;

router.get('/products', async (req, res) => {
    const result = await mianjiaCatalog.listProducts(ctx);
    if (!result.ok) {
        return sendError(res, result.error, result.message);
    }
    return sendSuccess(res, result.data, '操作成功');
});

module.exports = router;
