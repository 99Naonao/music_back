/**
 * 在服务器项目根目录执行：node scripts/log-self-test.js
 * 用于确认业务日志能否写入 logs/log/
 */
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '../.env') });
const prod = path.join(__dirname, '../.env.production');
if (fs.existsSync(prod)) {
    require('dotenv').config({ path: prod, override: false });
}

const { getLogger, resolveLogDir } = require('../src/logger');

const logDir = resolveLogDir();
console.log('LOG_DIR env =', process.env.LOG_DIR || '(未设置)');
console.log('DB_PATH env =', process.env.DB_PATH || '(未设置)');
console.log('解析后的业务日志目录 =', logDir);

const logger = getLogger();
logger.info('self-test', 'log-self-test 写入探测', { pid: process.pid });

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
const appFile = path.join(logDir, `app-${today}.log`);
if (fs.existsSync(appFile)) {
    const st = fs.statSync(appFile);
    console.log('OK 已生成', appFile, 'size=', st.size);
} else {
    console.error('FAIL 未找到', appFile);
    console.error('请检查目录权限：chown -R www:www', path.dirname(logDir));
    process.exit(1);
}
