/**
 * 积分商城商品列表（GET /api/mall/products 下发）
 * - 配图放在项目根目录 images/（与 src 同级），由 app.js 挂载为 https://域名/images/文件名
 * - 完整 URL = MALL_IMAGE_BASE + /images/ + 文件名。服务端可在 .env 设置：
 *   MALL_IMAGE_BASE=https://music.zsyl.cc
 *   （勿尾斜杠；不配则用默认值，便于本地与线上一致）
 * - 微信小程序须将该域名配置为合法域名
 */

/** @returns {string} */
function mallImageUrl(filename) {
    const base = (process.env.MALL_IMAGE_BASE || 'https://music.zsyl.cc').replace(/\/$/, '');
    const name = String(filename || '').replace(/^\//, '');
    return `${base}/images/${name}`;
}

const MALL_PRODUCTS = [
    {
        id: 1,
        name: '安然复方睡眠精油2ml',
        points: 900,
        image: mallImageUrl('mall-anran-fufang-2ml.jpg'),
        desc: '复方调配，睡前涂抹或香薰使用，帮助放松入睡。（规格：2ml）'
    },
    {
        id: 2,
        name: '野橘单方精油5ml',
        points: 1000,
        image: mallImageUrl('mall-yeju-danfang-5ml.jpg'),
        desc: '清新柑橘香型单方精油，可按说明稀释后用于扩香或局部护理。（规格：5ml）'
    },
    {
        id: 3,
        name: '野橘精油10ml',
        points: 1360,
        image: mallImageUrl('mall-yeju-10ml.jpg'),
        desc: '野橘香型，适合日常扩香与睡前氛围营造。（规格：10ml）'
    },
    {
        id: 4,
        name: '安然精油10ml',
        points: 1560,
        image: mallImageUrl('mall-anran-10ml.jpg'),
        desc: '安然系列配方，配合睡前仪式使用更佳。（规格：10ml）'
    },
    {
        id: 5,
        name: '安纳悦精油10ml',
        points: 3960,
        image: mallImageUrl('mall-annayue-10ml.jpg'),
        desc: '安纳悦系列香氛护理。（规格：10ml）'
    },
    {
        id: 6,
        name: '倾心精油10ml',
        points: 3960,
        image: mallImageUrl('mall-qingxin-10ml.jpg'),
        desc: '倾心系列香氛护理。（规格：10ml）'
    },
    {
        id: 7,
        name: '甘霖精油10ml',
        points: 4360,
        image: mallImageUrl('mall-ganlin-10ml.jpg'),
        desc: '甘霖系列香氛护理。（规格：10ml）'
    },
    {
        id: 8,
        name: '甜睡贴体验装',
        points: 780,
        image: mallImageUrl('mall-tianshui-tiyan.jpg'),
        desc: '甜睡贴体验规格，具体用法请见包装说明。'
    },
    {
        id: 9,
        name: '甜睡贴盒装',
        points: 1560,
        image: mallImageUrl('mall-tianshui-hezhuang.jpg'),
        desc: '甜睡贴盒装规格，适合周期使用，详见包装说明。'
    }
];

function getMallProductById(id) {
    const numId = Number(id);
    return MALL_PRODUCTS.find((p) => p.id === numId) || null;
}

module.exports = {
    MALL_PRODUCTS,
    getMallProductById,
    mallImageUrl
};
