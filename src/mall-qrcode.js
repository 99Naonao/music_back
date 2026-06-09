/**
 * 商品小程序码：images/qrcode/{商品id}.{png|jpg|jpeg|webp}
 * 文件名（不含扩展名）须与商品 id 或 goodsId 一致
 */
const fs = require('fs');
const path = require('path');

const QRCODE_DIR = path.join(__dirname, '..', 'images', 'qrcode');
const QRCODE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CACHE_MS = Number(process.env.MALL_QRCODE_CACHE_MS || 60000);

let cache = { at: 0, map: {} };

function scanQrcodeDir() {
    const map = {};
    if (!fs.existsSync(QRCODE_DIR)) return map;
    for (const file of fs.readdirSync(QRCODE_DIR)) {
        const ext = path.extname(file).toLowerCase();
        if (!QRCODE_EXTS.has(ext)) continue;
        const id = path.basename(file, ext);
        if (!id) continue;
        map[id] = file;
    }
    return map;
}

function getQrcodeIndex() {
    const now = Date.now();
    if (cache.map && now - cache.at < CACHE_MS) {
        return cache.map;
    }
    const map = scanQrcodeDir();
    cache = { at: now, map };
    return map;
}

/** @param {string|number} productId @param {(filename: string) => string} mallImageUrlFn */
function mallQrcodeUrl(productId, mallImageUrlFn) {
    const id = String(productId == null ? '' : productId).trim();
    if (!id) return null;
    const file = getQrcodeIndex()[id];
    if (!file) return null;
    return mallImageUrlFn(`qrcode/${file}`);
}

/** @param {Record<string, unknown>|null|undefined} product @param {(filename: string) => string} mallImageUrlFn */
function attachQrcodeUrl(product, mallImageUrlFn) {
    if (!product) return product;
    const pid = product.goodsId != null ? product.goodsId : product.id;
    const qrcodeUrl = mallQrcodeUrl(pid, mallImageUrlFn);
    if (!qrcodeUrl) return product;
    return { ...product, qrcodeUrl };
}

function attachQrcodeList(list, mallImageUrlFn) {
    if (!Array.isArray(list)) return list;
    return list.map((item) => attachQrcodeUrl(item, mallImageUrlFn));
}

/** 默认向小程序下发 qrcodeUrl；设为 false 可关闭（前端仅在凭证流程中使用） */
function isMallQrcodeExposeEnabled() {
    const raw = String(process.env.MALL_EXPOSE_QRCODE || '').toLowerCase();
    return raw !== 'false';
}

/**
 * 是否在小程序展示「查看领取凭证 / 二维码」入口
 * MALL_VOUCHER_UI_VISIBLE=false 时不下发 showVoucher，前端隐藏入口（仍可保留 qrcodeUrl 供后续扩展）
 */
function isMallVoucherUiVisible() {
    const raw = String(process.env.MALL_VOUCHER_UI_VISIBLE ?? 'false').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

function getMallClientConfig() {
    return {
        voucherUiVisible: isMallVoucherUiVisible(),
        exposeQrcode: isMallQrcodeExposeEnabled()
    };
}

/** 附加 qrcodeUrl，并按配置写入 showVoucher */
function attachVoucherUiFlags(product, mallImageUrlFn) {
    if (!product) return product;
    let next = { ...product };
    if (isMallQrcodeExposeEnabled()) {
        next = attachQrcodeUrl(next, mallImageUrlFn);
    } else {
        delete next.qrcodeUrl;
        delete next.qrcode_url;
    }
    const url = next.qrcodeUrl || null;
    next.showVoucher = !!(isMallVoucherUiVisible() && isMallQrcodeExposeEnabled() && url);
    return next;
}

function attachVoucherUiFlagsList(list, mallImageUrlFn) {
    if (!Array.isArray(list)) return list;
    return list.map((item) => attachVoucherUiFlags(item, mallImageUrlFn));
}

function exposeQrcodeIfEnabled(product, mallImageUrlFn) {
    return attachVoucherUiFlags(product, mallImageUrlFn);
}

function exposeQrcodeListIfEnabled(list, mallImageUrlFn) {
    return attachVoucherUiFlagsList(list, mallImageUrlFn);
}

module.exports = {
    QRCODE_DIR,
    mallQrcodeUrl,
    attachQrcodeUrl,
    attachQrcodeList,
    isMallQrcodeExposeEnabled,
    isMallVoucherUiVisible,
    getMallClientConfig,
    attachVoucherUiFlags,
    attachVoucherUiFlagsList,
    exposeQrcodeIfEnabled,
    exposeQrcodeListIfEnabled,
    scanQrcodeDir,
    getQrcodeIndex
};
