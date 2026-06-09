/**
 * DeepSeek AI 祝福语生成服务
 * 由后端代理调用，保护 API Key 不暴露到前端
 */

const axios = require('axios');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com';

const SYSTEM_PROMPT = `你是一位温暖细腻的音乐贺卡祝福语创作助手，擅长为助眠音乐贺卡撰写走心的祝福语。

要求：
1. 语气温暖、真诚、有诗意，不要太商业化
2. 祝福语长度控制在50-100字左右
3. 结合音乐助眠的主题，可以提及夜晚、梦境、宁静、放松等意象
4. 根据收件人的关系（朋友/爱人/家人）调整语气
5. 输出纯文本，不要加引号或额外说明`;

/**
 * 调用 DeepSeek API 生成祝福语
 * @param {string} recipient - 收件人姓名
 * @param {string} relationship - 关系
 * @returns {Promise<string>}
 */
async function generateBlessing(recipient, relationship = '朋友') {
    const prompt = `请为收件人「${recipient}」生成一段助眠音乐贺卡的祝福语。\n关系：${relationship}\n背景：用户为${recipient}创作了一首专属的助眠音乐，想在贺卡上写一段温暖的祝福语。`;

    try {
        const response = await axios.post(
            `${DEEPSEEK_API_URL}/chat/completions`,
            {
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 200
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                },
                timeout: 15000
            }
        );

        if (response.data && response.data.choices && response.data.choices[0]) {
            return response.data.choices[0].message.content.trim();
        }

        throw new Error('AI 响应格式异常');
    } catch (error) {
        console.error('[DeepSeek API 调用失败]', error.message);
        if (error.response) {
            console.error('[DeepSeek 错误详情]', error.response.data);
        }
        throw error;
    }
}

/**
 * 离线兜底：本地模板生成祝福语
 * @param {string} recipient - 收件人姓名
 * @returns {string}
 */
function generateBlessingOffline(recipient) {
    const templates = [
        `在这宁静的夜晚，愿这份专属音乐陪伴${recipient}进入甜美的梦乡，让疲惫的心灵得到最温柔的抚慰。`,
        `送给${recipient}一份特别的礼物，愿每一个音符都能带走烦恼，带来安宁与好眠。`,
        `${recipient}，愿这份音乐如清风拂面，如月光洒落，伴你度过每一个宁静的夜晚。`,
        `深夜的宁静，是给自己的最好礼物。${recipient}，愿这份音乐带你飞向梦境的彼岸。`,
        `忙碌的一天结束了，${recipient}，请收下这份心意，让音乐为你编织最美的梦境。`,
        `愿这份音乐成为${recipient}睡前的温柔仪式，让身心在音乐中慢慢放松，安然入眠。`,
        `${recipient}，这是一份专属于你的安眠曲，愿它能驱散一天的疲惫，带来一夜好梦。`,
        `在星光下，在音乐中，${recipient}，愿你找到内心最深处的宁静与平和。`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

module.exports = {
    generateBlessing,
    generateBlessingOffline
};
