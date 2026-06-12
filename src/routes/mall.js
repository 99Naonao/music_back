/**
 * 路由顺序：固定路径 → 多段路径 → 通配参数（见 迁移计划 §3）
 */
const express = require('express');
const router = express.Router();
const ctx = require('../utils/app-context');
const { getMallClientConfig } = require('../mall-qrcode');
const mallCatalog = require('../services/mall-catalog-service');

const { sendError, sendSuccess, ErrorCode } = ctx;

router.get('/config', (req, res) => {
    return sendSuccess(res, getMallClientConfig(), '操作成功');
});

router.get('/products', (req, res) => {
    return sendSuccess(res, mallCatalog.listProducts(ctx), '操作成功');
});

router.get('/product/:id', (req, res) => {
    const result = mallCatalog.getProductById(ctx, req.params.id);
    if (!result.ok) {
        return sendError(res, result.error);
    }
    return sendSuccess(res, result.data, '操作成功');
});

module.exports = router;
