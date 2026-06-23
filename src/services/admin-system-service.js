const fs = require('fs');
const path = require('path');
const { ErrorCode } = require('../error-codes');
const { getDataDir } = require('../bootstrap/database');

function dbPath() {
    return process.env.DB_PATH || path.join(getDataDir(), 'app.db');
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function getHealth(db, adminUser) {
    if (!adminUser) {
        return { ok: false, error: ErrorCode.FORBIDDEN };
    }

    const dbFile = dbPath();
    let dbSizeBytes = 0;
    try {
        if (fs.existsSync(dbFile)) {
            dbSizeBytes = fs.statSync(dbFile).size;
        }
    } catch (e) {
        /* ignore */
    }

    const tableCounts = {};
    const tables = [
        'channels',
        'channel_branding',
        'daily_channel_stats',
        'user_feedback',
        'community_posts',
        'promo_campaigns',
        'admin_users',
        'admin_audit_logs',
        'biz_events'
    ];
    tables.forEach((t) => {
        try {
            tableCounts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
        } catch (e) {
            tableCounts[t] = null;
        }
    });

    const exportsDir = path.join(getDataDir(), 'exports');
    let exportJobCount = 0;
    try {
        if (fs.existsSync(exportsDir)) {
            exportJobCount = fs
                .readdirSync(exportsDir)
                .filter((f) => f.endsWith('.meta.json')).length;
        }
    } catch (e) {
        /* ignore */
    }

    return {
        ok: true,
        data: {
            nodeVersion: process.version,
            env: process.env.NODE_ENV || 'development',
            dbPath: dbFile,
            dbSizeBytes,
            dbSizeHuman: formatBytes(dbSizeBytes),
            tableCounts,
            exportJobCount,
            uptimeSec: Math.floor(process.uptime())
        }
    };
}

module.exports = { getHealth };
