/**
 * 眠家产品列表：优先从 goods.txt 同源接口拉取
 * GET https://zhongshu.xinglu.shop/shopapi/Detection/getGoodsLists
 */
const { getGoodsLists, isShopApiSuccess } = require('./xinglu-shop-api');
const { MIANJIA_PRODUCTS: FALLBACK_PRODUCTS } = require('./mianjia-products-data');

const CACHE_MS = Number(process.env.MIANJIA_PRODUCTS_CACHE_MS || 5 * 60 * 1000);

let cache = { at: 0, list: null };

function mapGoodsRow(row) {
    if (!row || row.id == null) return null;
    const name = String(row.name || row.title_text || '').trim();
    if (!name) return null;
    return {
        goodsId: row.id,
        name,
        description: String(row.description != null ? row.description : '').trim(),
        image: String(row.image || '').trim()
    };
}

async function fetchMianjiaProductsFromShop() {
    const payload = await getGoodsLists();
    if (!isShopApiSuccess(payload)) {
        throw new Error(payload && payload.msg ? String(payload.msg) : 'getGoodsLists failed');
    }
    const lists = payload.data && Array.isArray(payload.data.lists) ? payload.data.lists : [];
    return lists.map(mapGoodsRow).filter(Boolean);
}

async function getMianjiaProducts() {
    const now = Date.now();
    if (cache.list && now - cache.at < CACHE_MS) {
        return cache.list;
    }
    try {
        const list = await fetchMianjiaProductsFromShop();
        if (list.length) {
            cache = { at: now, list };
            return list;
        }
    } catch (e) {
        console.warn('[mianjia-products] shop api fail, use fallback:', e.message || e);
    }
    return FALLBACK_PRODUCTS;
}

module.exports = {
    getMianjiaProducts,
    mapGoodsRow
};
