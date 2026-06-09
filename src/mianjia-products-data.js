/**
 * 眠家 / 眠加产品 —— 接口失败时的本地兜底
 * 字段与 goods.txt → getGoodsLists 一致：id / name / description / image
 */
const MIANJIA_PRODUCTS = [
    {
        goodsId: 10020,
        name: '【安然】 复方精油10ml 提高睡眠 居家 薰衣草 香薰 舒缓精神 植物香扩香',
        description: '安神放松 释放压力 平衡情绪',
        image: 'https://oss.zsyl.cc/uploads/images/20251231/20251231132715712387456.jpg'
    },
    {
        goodsId: 10022,
        name: '【倾心】 复方精油10ml 有机天然 居家静心 失眠舒缓 快速入眠 植物扩香',
        description: '有静心养神、平和心绪、去烦除躁的作用',
        image: 'https://oss.zsyl.cc/uploads/images/20251231/202512311350545a4df4644.jpg'
    },
    {
        goodsId: 10029,
        name: '【安·纳悦】 复方精油10ml 提高睡眠 居家 薰衣草 香薰 舒缓精神 植物香扩香',
        description: '安神放松 释放压力 平衡情绪',
        image: 'https://oss.zsyl.cc/uploads/images/20250605/2025060509052863a974209.jpeg'
    },
    {
        goodsId: 10056,
        name: '【甜睡贴】 舒眠体验 晚安贴 快速 古法植物配方',
        description: '宁心安神，舒缓身心，助力快速入睡，提升睡眠深度，改善整体睡眠质量',
        image: 'https://oss.zsyl.cc/uploads/images/20251231/2025123115051595b510099.jpg'
    },
    {
        goodsId: 10063,
        name: '【舒眠枕音播放器】轻巧 长续航 骨传导 蓝牙 音箱 不扰人 音乐睡眠 全家可用',
        description: '骨传导白噪音，物理传音舒缓身心，快速助眠、平复情绪',
        image: 'https://oss.zsyl.cc/uploads/images/20251231/20251231164521e8d0f2345.jpg'
    },
    {
        goodsId: 10055,
        name: '【翼合枕】 护颈 高度可调 慢回弹 记忆棉 提高睡眠 深睡 颈椎 家用枕头',
        description: '人体生理弯曲与人体工程学设计 一枕三高度 解锁四种使用感受',
        image: 'https://oss.zsyl.cc/uploads/images/20251231/2025123115324571d8c2430.jpg'
    },
    {
        goodsId: 10069,
        name: '【观心枕】 护颈 椎枕 实时 测心率呼吸 智能 记忆棉 老年人专用睡觉枕头',
        description: '智能睡眠监测枕，集成生物雷达、压感传感器，专利算法精准监测生命体征、分析睡眠状态',
        image: 'https://oss.zsyl.cc/uploads/images/20251231/20251231153945ac6849772.jpg'
    },
    {
        goodsId: 10083,
        name: '【酸枣仁玫瑰百合茶】养生茶包 独立小包 酸枣仁百合玫瑰配方 温润口感 熬夜常备 便携冲泡',
        description: '宁心安神、疏肝解郁、滋阴养颜、健脾益胃、清热利湿、补养气血',
        image: 'https://oss.zsyl.cc/uploads/images/20251231/20251231184929b4c243994.jpg'
    }
];

module.exports = {
    MIANJIA_PRODUCTS
};
