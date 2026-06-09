/**
 * CORS 跨域配置
 * 支持多域名、本地开发环境和生产环境
 */

// 从环境变量读取允许的域名
const getAllowedOrigins = () => {
    const origins = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || '*';

    if (origins === '*') {
        return '*';
    }

    // 解析逗号分隔的域名列表
    return origins.split(',').map(origin => origin.trim()).filter(Boolean);
};

// CORS 配置选项
const corsOptions = {
    // 允许的源
    origin: function (origin, callback) {
        const allowedOrigins = getAllowedOrigins();

        // 如果是通配符，允许所有
        if (allowedOrigins === '*') {
            return callback(null, true);
        }

        // 允许没有 origin 的请求（如 Postman、curl）
        if (!origin) {
            return callback(null, true);
        }

        // 检查是否在允许列表中
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        // 拒绝其他来源
        console.warn(`[CORS] 拒绝来自 ${origin} 的请求`);
        console.warn(`[CORS] 允许的域名: ${allowedOrigins.join(', ')}`);
        return callback(new Error('不允许的跨域请求来源'));
    },

    // 允许的 HTTP 方法
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],

    // 允许的请求头
    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-Custom-Header',
        'X-Request-Id',
        'X-WX-App-Id'
    ],

    // 允许携带凭证（cookies、authorization headers）
    credentials: true,

    // 预检请求缓存时间（秒）
    maxAge: 86400, // 24小时

    // 允许暴露的响应头
    exposedHeaders: ['Content-Length', 'X-Request-Id']
};

// 预检请求处理中间件
const handlePreflight = (req, res, next) => {
    if (req.method === 'OPTIONS') {
        const allowedOrigins = getAllowedOrigins();
        const origin = req.headers.origin;

        // 设置 CORS 头
        if (allowedOrigins === '*' || allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin || '*');
        }

        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Custom-Header, X-Request-Id');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Max-Age', '86400');

        return res.sendStatus(204); // No Content
    }
    next();
};

// 调试信息输出
const logCorsConfig = () => {
    const origins = getAllowedOrigins();
    console.log('========================================');
    console.log('🔒 CORS 配置');
    console.log(`📍 允许的域名: ${origins === '*' ? '所有 (*)' : origins.join(', ')}`);
    console.log(`📍 允许的方法: ${corsOptions.methods.join(', ')}`);
    console.log(`📍 允许凭证: ${corsOptions.credentials}`);
    console.log('========================================');
};

module.exports = {
    corsOptions,
    handlePreflight,
    getAllowedOrigins,
    logCorsConfig
};
