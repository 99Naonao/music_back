const { ErrorCode } = require('../error-codes');

async function listProducts(ctx) {
    const { getMianjiaProducts, exposeQrcodeListIfEnabled, mallImageUrl } = ctx;
    try {
        const list = exposeQrcodeListIfEnabled(await getMianjiaProducts(), mallImageUrl);
        return { ok: true, data: list };
    } catch (e) {
        console.error('[mianjia/products]', e);
        return { ok: false, error: ErrorCode.INTERNAL_ERROR, message: '获取商品列表失败' };
    }
}

module.exports = { listProducts };
