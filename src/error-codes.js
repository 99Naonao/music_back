/**
 * 错误码统一定义模块
 * 规范：
 * - 0: 成功
 * - 1000-1999: 通用错误
 * - 2000-2999: 用户相关错误
 * - 3000-3999: 音乐相关错误
 * - 4000-4999: 社区/内容相关错误
 * - 4200-4299: 积分相关错误
 * - 5000-5999: 数据库错误
 * - 6000-6999: 外部API错误
 * - 7000-7999: 文件/音频处理错误
 * - 9000-9999: 系统错误
 */

const ErrorCode = {
    // ==================== 成功 ====================
    SUCCESS: { code: 0, message: '操作成功', httpStatus: 200 },

    // ==================== 通用错误 (1000-1999) ====================
    UNKNOWN_ERROR: { code: 1000, message: '未知错误', httpStatus: 500 },
    INVALID_PARAMS: { code: 1001, message: '参数错误', httpStatus: 400 },
    MISSING_REQUIRED_PARAM: { code: 1002, message: '缺少必填参数', httpStatus: 400 },
    INVALID_FORMAT: { code: 1003, message: '数据格式错误', httpStatus: 400 },
    PARAM_TOO_LONG: { code: 1004, message: '参数长度超出限制', httpStatus: 400 },
    PARAM_TYPE_ERROR: { code: 1005, message: '参数类型错误', httpStatus: 400 },
    INVALID_JSON: { code: 1006, message: 'JSON格式错误', httpStatus: 400 },
    PAGE_PARAM_ERROR: { code: 1007, message: '分页参数错误', httpStatus: 400 },

    // ==================== 用户相关错误 (2000-2999) ====================
    USER_NOT_FOUND: { code: 2000, message: '用户不存在', httpStatus: 404 },
    USER_ALREADY_EXISTS: { code: 2001, message: '用户已存在', httpStatus: 409 },
    LOGIN_FAILED: { code: 2002, message: '登录失败', httpStatus: 401 },
    UNAUTHORIZED: { code: 2003, message: '未授权，请先登录', httpStatus: 401 },
    TOKEN_EXPIRED: { code: 2004, message: '登录已过期，请重新登录', httpStatus: 401 },
    TOKEN_INVALID: { code: 2005, message: '无效的登录凭证', httpStatus: 401 },
    USER_BANNED: { code: 2006, message: '账号已被禁用', httpStatus: 403 },
    FORBIDDEN: { code: 2007, message: '无权访问该资源', httpStatus: 403 },
    INVALID_CREDENTIALS: { code: 2008, message: '用户名或密码错误', httpStatus: 401 },
    WX_LOGIN_FAILED: { code: 2009, message: '微信登录失败', httpStatus: 401 },
    WX_CODE_INVALID: { code: 2010, message: '微信登录凭证无效', httpStatus: 400 },
    ACCOUNT_DELETE_FAILED: { code: 2011, message: '账号注销失败', httpStatus: 500 },

    // ==================== 音乐相关错误 (3000-3999) ====================
    MUSIC_NOT_FOUND: { code: 3000, message: '音乐不存在', httpStatus: 404 },
    MUSIC_GENERATION_FAILED: { code: 3001, message: '音乐生成失败', httpStatus: 500 },
    MUSIC_GENERATION_TIMEOUT: { code: 3002, message: '音乐生成超时', httpStatus: 504 },
    INVALID_MUSIC_PARAMS: { code: 3003, message: '音乐参数错误', httpStatus: 400 },
    MUSIC_NOT_READY: { code: 3004, message: '音乐尚未生成完成', httpStatus: 400 },
    MUSIC_ALREADY_EXISTS: { code: 3005, message: '音乐作品已存在', httpStatus: 409 },
    INVALID_INSTRUMENT: { code: 3006, message: '无效的乐器类型', httpStatus: 400 },
    INVALID_FREQUENCY: { code: 3007, message: '无效的脑波频率类型', httpStatus: 400 },
    MUSIC_SAVE_FAILED: { code: 3008, message: '音乐保存失败', httpStatus: 500 },
    MUSIC_CREATE_FAILED: { code: 3009, message: '音乐创建失败', httpStatus: 500 },

    // ==================== 社区/内容相关错误 (4000-4199) ====================
    POST_NOT_FOUND: { code: 4000, message: '帖子不存在或已被删除', httpStatus: 404 },
    POST_CREATE_FAILED: { code: 4001, message: '发布帖子失败', httpStatus: 500 },
    COMMENT_CREATE_FAILED: { code: 4002, message: '发布评论失败', httpStatus: 500 },
    ALREADY_LIKED: { code: 4003, message: '已经点赞过了', httpStatus: 409 },
    LIKE_FAILED: { code: 4004, message: '点赞操作失败', httpStatus: 500 },
    UNAUTHORIZED_POST_DELETE: { code: 4005, message: '无权删除该帖子', httpStatus: 403 },
    UNAUTHORIZED_COMMENT_DELETE: { code: 4006, message: '无权删除该评论', httpStatus: 403 },
    COMMENT_NOT_FOUND: { code: 4007, message: '评论不存在', httpStatus: 404 },
    CONTENT_TOO_LONG: { code: 4008, message: '内容长度超出限制', httpStatus: 400 },
    CONTENT_EMPTY: { code: 4009, message: '内容不能为空', httpStatus: 400 },
    CONTENT_SENSITIVE: { code: 4010, message: '所发布内容含违规信息', httpStatus: 400 },
    NOT_LIKED_YET: { code: 4011, message: '尚未点赞', httpStatus: 400 },

    // ==================== 贺卡相关错误 (4100-4199) ====================
    CARD_NOT_FOUND: { code: 4100, message: '贺卡不存在或已过期', httpStatus: 404 },
    CARD_CREATE_FAILED: { code: 4101, message: '创建贺卡失败', httpStatus: 500 },
    SHARE_NOT_FOUND: { code: 4102, message: '分享内容不存在', httpStatus: 404 },
    CARD_TEMPLATE_INVALID: { code: 4103, message: '无效的贺卡模板', httpStatus: 400 },
    CARD_EXPIRED: { code: 4104, message: '贺卡链接已过期', httpStatus: 410 },
    RECIPIENT_EMPTY: { code: 4105, message: '收件人不能为空', httpStatus: 400 },

    // ==================== 积分相关错误 (4200-4299) ====================
    INSUFFICIENT_POINTS: { code: 4200, message: '积分不足', httpStatus: 402 },
    POINTS_OPERATION_FAILED: { code: 4201, message: '积分操作失败', httpStatus: 500 },
    POINTS_TYPE_INVALID: { code: 4202, message: '无效的积分类型', httpStatus: 400 },
    POINTS_DEDUCT_FAILED: { code: 4203, message: '积分扣除失败', httpStatus: 500 },
    POINTS_ADD_FAILED: { code: 4204, message: '积分添加失败', httpStatus: 500 },
    POINTS_RECORD_NOT_FOUND: { code: 4205, message: '积分记录不存在', httpStatus: 404 },
    MALL_PRODUCT_NOT_FOUND: { code: 4210, message: '商品不存在', httpStatus: 404 },

    // ==================== 数据库错误 (5000-5999) ====================
    DB_ERROR: { code: 5000, message: '数据库操作失败', httpStatus: 500 },
    DB_CONNECTION_ERROR: { code: 5001, message: '数据库连接失败', httpStatus: 503 },
    DB_QUERY_ERROR: { code: 5002, message: '数据查询失败', httpStatus: 500 },
    DB_INSERT_ERROR: { code: 5003, message: '数据写入失败', httpStatus: 500 },
    DB_UPDATE_ERROR: { code: 5004, message: '数据更新失败', httpStatus: 500 },
    DB_DELETE_ERROR: { code: 5005, message: '数据删除失败', httpStatus: 500 },
    DB_UNIQUE_VIOLATION: { code: 5006, message: '数据已存在，不能重复', httpStatus: 409 },
    DB_FOREIGN_KEY_ERROR: { code: 5007, message: '关联数据不存在', httpStatus: 400 },

    // ==================== 外部API错误 (6000-6999) ====================
    // 小程序端（wx.request / wx.uploadFile）应读 body.code / body.message，勿依赖 HTTP 502/504
    AI_SERVICE_ERROR: { code: 6000, message: 'AI服务调用失败', httpStatus: 200 },
    MINIMAX_API_ERROR: { code: 6001, message: 'MiniMax API调用失败', httpStatus: 200 },
    DEEPSEEK_API_ERROR: { code: 6002, message: 'DeepSeek API调用失败', httpStatus: 200 },
    WECHAT_API_ERROR: { code: 6003, message: '微信API调用失败', httpStatus: 200 },
    EXTERNAL_API_TIMEOUT: { code: 6004, message: '外部服务请求超时', httpStatus: 200 },
    MALL_API_ERROR: { code: 6005, message: '商城系统接口调用失败', httpStatus: 200 },
    API_RATE_LIMITED: { code: 6006, message: '第三方API调用频率受限', httpStatus: 429 },
    API_KEY_INVALID: { code: 6007, message: 'API密钥无效或已过期', httpStatus: 401 },

    // ==================== 文件/音频处理错误 (7000-7999) ====================
    FILE_NOT_FOUND: { code: 7000, message: '文件不存在', httpStatus: 404 },
    FILE_UPLOAD_FAILED: { code: 7001, message: '文件上传失败', httpStatus: 500 },
    FILE_TOO_LARGE: { code: 7002, message: '文件大小超出限制', httpStatus: 413 },
    FILE_TYPE_INVALID: { code: 7003, message: '不支持的文件类型', httpStatus: 415 },
    AUDIO_MIX_FAILED: { code: 7004, message: '音频混音失败', httpStatus: 500 },
    AUDIO_PROCESS_ERROR: { code: 7005, message: '音频处理失败', httpStatus: 500 },
    AUDIO_DOWNLOAD_FAILED: { code: 7006, message: '音频下载失败', httpStatus: 500 },

    // ==================== 系统错误 (9000-9999) ====================
    SYSTEM_ERROR: { code: 9000, message: '系统错误', httpStatus: 500 },
    SERVICE_UNAVAILABLE: { code: 9001, message: '服务暂时不可用', httpStatus: 503 },
    RATE_LIMIT_EXCEEDED: { code: 9002, message: '请求过于频繁，请稍后再试', httpStatus: 429 },
    CONFIG_ERROR: { code: 9003, message: '系统配置错误', httpStatus: 500 },
    INTERNAL_ERROR: { code: 9004, message: '内部服务器错误', httpStatus: 500 }
};

const { getLogger, formatConsoleTimestampCn } = require('./logger');

/**
 * 统一成功响应
 * @param {any} data - 响应数据
 * @param {string} message - 提示信息
 * @returns {Object}
 */
function successResponse(data = null, message = '操作成功') {
    return {
        code: 0,
        message,
        data,
        timestamp: Date.now()
    };
}

/**
 * 统一错误响应
 * @param {Object} errorCode - 错误码定义对象
 * @param {string} extraMessage - 额外错误信息
 * @param {any} details - 详细错误信息（调试用，生产环境建议不返回）
 * @returns {Object}
 */
function errorResponse(errorCode, extraMessage = '', details = null) {
    const response = {
        code: errorCode.code,
        message: extraMessage ? `${errorCode.message}: ${extraMessage}` : errorCode.message,
        data: null,
        timestamp: Date.now()
    };

    // 仅在开发环境或特定情况下返回详细信息
    if (details && process.env.NODE_ENV === 'development') {
        response.details = details;
    }

    return response;
}

/**
 * Express错误响应快捷方法
 * @param {Object} res - Express响应对象
 * @param {Object} errorCode - 错误码定义
 * @param {string} extraMessage - 额外错误信息
 * @param {any} details - 详细错误信息
 */
function sendError(res, errorCode, extraMessage = '', details = null) {
    const response = errorResponse(errorCode, extraMessage, details);
    return res.status(errorCode.httpStatus || 500).json(response);
}

/**
 * 小程序 API 业务错误：固定 HTTP 200 + { code, message }
 * 避免前端只能看到「HTTP 502」而读不到 message
 */
function sendMiniError(res, errorCode, extraMessage = '', details = null) {
    const response = errorResponse(errorCode, extraMessage, details);
    return res.status(200).json(response);
}

/**
 * Express成功响应快捷方法
 * @param {Object} res - Express响应对象
 * @param {any} data - 响应数据
 * @param {string} message - 提示信息
 */
function sendSuccess(res, data = null, message = '操作成功') {
    return res.json(successResponse(data, message));
}

/**
 * 日志记录辅助函数
 * @param {string} context - 错误上下文
 * @param {Error} error - 错误对象
 * @param {Object} extraInfo - 额外信息
 */
function logError(context, error, extraInfo = {}) {
    const err = error instanceof Error ? error : null;
    getLogger().error(context, err ? err.message : String(error || ''), {
        stack: err ? err.stack : undefined,
        ...extraInfo
    });
}

/**
 * 日志记录辅助函数（警告级别）
 * @param {string} context - 上下文
 * @param {string} message - 警告信息
 * @param {Object} extraInfo - 额外信息
 */
function logWarn(context, message, extraInfo = {}) {
    getLogger().warn(context, message, extraInfo);
}

/**
 * 日志记录辅助函数（信息级别）
 * @param {string} context - 上下文
 * @param {string} message - 信息
 * @param {Object} extraInfo - 额外信息
 */
function logInfo(context, message, extraInfo = {}) {
    getLogger().info(context, message, extraInfo);
}

/**
 * 数据库错误转换
 * 将SQLite错误转换为标准错误码
 * @param {Error} dbError - 数据库错误对象
 * @returns {Object} - 对应的错误码
 */
function convertDbError(dbError) {
    if (!dbError) return ErrorCode.DB_ERROR;

    const message = dbError.message || '';
    const code = dbError.code || '';

    // SQLite错误码处理
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || message.includes('UNIQUE constraint failed')) {
        return ErrorCode.DB_UNIQUE_VIOLATION;
    }
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || message.includes('FOREIGN KEY constraint failed')) {
        return ErrorCode.DB_FOREIGN_KEY_ERROR;
    }
    if (code === 'SQLITE_ERROR' && message.includes('no such table')) {
        return ErrorCode.DB_QUERY_ERROR;
    }
    if (code === 'SQLITE_CONSTRAINT_NOTNULL' || message.includes('NOT NULL constraint failed')) {
        return ErrorCode.MISSING_REQUIRED_PARAM;
    }

    return ErrorCode.DB_ERROR;
}

/**
 * 网络/外部API错误转换
 * @param {Error} apiError - API错误对象
 * @param {string} serviceName - 服务名称
 * @returns {Object} - 对应的错误码
 */
function convertApiError(apiError, serviceName = 'EXTERNAL') {
    if (!apiError) return ErrorCode.EXTERNAL_API_TIMEOUT;

    const status = apiError.response?.status;

    // 根据HTTP状态码映射
    if (status === 401 || status === 403) {
        return ErrorCode.API_KEY_INVALID;
    }
    if (status === 429) {
        return ErrorCode.API_RATE_LIMITED;
    }
    if (status === 408 || apiError.code === 'ECONNABORTED' || apiError.code === 'ETIMEDOUT') {
        return ErrorCode.EXTERNAL_API_TIMEOUT;
    }

    // 根据服务名称返回特定错误码
    const serviceMap = {
        'MINIMAX': ErrorCode.MINIMAX_API_ERROR,
        'DEEPSEEK': ErrorCode.DEEPSEEK_API_ERROR,
        'AI': ErrorCode.AI_SERVICE_ERROR,
        'WECHAT': ErrorCode.WECHAT_API_ERROR,
        'MALL': ErrorCode.MALL_API_ERROR
    };

    return serviceMap[serviceName.toUpperCase()] || ErrorCode.EXTERNAL_API_TIMEOUT;
}

module.exports = {
    ErrorCode,
    successResponse,
    errorResponse,
    sendError,
    sendMiniError,
    sendSuccess,
    logError,
    logWarn,
    logInfo,
    formatConsoleTimestampCn,
    convertDbError,
    convertApiError
};
