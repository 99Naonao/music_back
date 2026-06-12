const { getMallClientConfig } = require('../mall-qrcode');

function getConfig() {
    return getMallClientConfig();
}

function listProducts(ctx) {
    const { MALL_PRODUCTS_DATA, exposeQrcodeListIfEnabled, mallImageUrl } = ctx;
    return exposeQrcodeListIfEnabled(MALL_PRODUCTS_DATA, mallImageUrl);
}

function getProductById(ctx, id) {
    const { getMallProductByIdFromStore, exposeQrcodeIfEnabled, mallImageUrl, ErrorCode } = ctx;
    const p = getMallProductByIdFromStore(id);
    if (!p) {
        return { ok: false, error: ErrorCode.MALL_PRODUCT_NOT_FOUND };
    }
    return { ok: true, data: exposeQrcodeIfEnabled(p, mallImageUrl) };
}

module.exports = {
    getConfig,
    listProducts,
    getProductById
};
