const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '../..');

function loadEnvFiles() {
    const nodeEnv = process.env.NODE_ENV || 'development';
    const baseEnv = path.join(projectRoot, '.env');
    if (fs.existsSync(baseEnv)) {
        dotenv.config({ path: baseEnv });
    }
    const envSpecific = path.join(projectRoot, `.env.${nodeEnv}`);
    if (fs.existsSync(envSpecific)) {
        dotenv.config({ path: envSpecific, override: true });
    } else if (!fs.existsSync(baseEnv)) {
        dotenv.config();
    }
    const prodEnv = path.join(projectRoot, '.env.production');
    if (fs.existsSync(prodEnv)) {
        if (nodeEnv === 'production') {
            dotenv.config({ path: prodEnv, override: true });
        } else {
            const parsed = dotenv.parse(fs.readFileSync(prodEnv, 'utf8'));
            Object.keys(parsed).forEach((key) => {
                const cur = process.env[key];
                if (cur == null || String(cur).trim() === '') {
                    process.env[key] = parsed[key];
                }
            });
        }
    }
}

function ensureTimezone() {
    if (!process.env.TZ) {
        process.env.TZ = 'Asia/Shanghai';
    }
}

module.exports = { loadEnvFiles, ensureTimezone, projectRoot };
