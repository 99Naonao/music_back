/**
 * 渠道换皮：branding 配置、用户绑定、source_channel 解析
 */
const path = require('path');
const fs = require('fs');
const channelThemePresets = require('./channel-theme-presets');

const DEFAULT_CHANNEL_ID = 'default';

/** channel_1 渠道皮肤：深眠驿站 · 预设 deep_sleep_post */
const CHANNEL_1_ID = 'channel_1';
const CHANNEL_1_BRANDING_VERSION = 4;

const CHANNEL_1_DESIGN = {
    channelName: '深眠驿站',
    splash: {
        title: '深眠驿站',
        subtitle: 'AI助眠声波定制',
        slogan: '今夜，为自己留一刻宁静'
    },
    theme: {
        presetId: 'deep_sleep_post',
        variant: 'dawn',
        primaryColor: '#7568A8',
        navBg: '#EBE6F4',
        navFront: '#352D4A',
        tabSelected: '#7568A8',
        tabColor: '#9490A0',
        tabBg: '#FCFAFE',
        windowBg: '#F4F0FA'
    },
    features: {
        hideMall: true,
        hideCommunity: false,
        hidePromo: false,
        hidePoints: false,
        hideTasks: false
    },
    copy: {
        homeGreetingSub: '深眠驿站 · 今夜也要好梦',
        homeAiTitle: 'AI定制助眠曲',
        homeAiDesc: '脑波频率与乐器，为你调配专属音景',
        homeBannerTitle: '深睡精选 · 好物相伴',
        homeBannerDesc: '搭配专属音景，探索助眠生活方式',
        completeShareTitlePrefix: '深眠驿站',
        cardWatermark: '—— 深眠驿站',
        cardFooterLine1: '深眠驿站 · AI助眠声波',
        cardFooterLine2: '愿每一晚，都有好梦相伴',
        cardDefaultMessage: '愿这份音景，陪你安然入梦',
        shareTitlePrefix: '深眠驿站',
        shareFallbackTitle: '深眠驿站 · 助眠贺卡'
    },
    contact: {
        phone: '4008085180',
        phoneDisplay: '400-808-5180',
        email: 'zsyl@zsyl.cc'
    }
};

const DEFAULT_FEATURES = {
    hideMall: false,
    hideCommunity: false,
    hidePromo: false,
    hidePoints: false,
    hideTasks: false
};

function getPublicImageBase() {
    return String(
        process.env.MALL_IMAGE_BASE || process.env.PUBLIC_IMAGE_BASE || 'https://music.zsyl.cc'
    ).replace(/\/$/, '');
}

function brandingAssetUrl(channelId, filename) {
    const cid = normalizeChannelId(channelId);
    if (!cid || cid === DEFAULT_CHANNEL_ID) return '';
    return `${getPublicImageBase()}/images/branding/${cid}/${filename}`;
}

function normalizeChannelId(raw) {
    const s = raw != null ? String(raw).trim() : '';
    if (!s || s === DEFAULT_CHANNEL_ID) return DEFAULT_CHANNEL_ID;
    if (!/^[a-zA-Z0-9_-]{2,48}$/.test(s)) return DEFAULT_CHANNEL_ID;
    return s;
}

function parseJsonObject(raw, fallback) {
    if (!raw) return fallback || {};
    if (typeof raw === 'object') return raw;
    try {
        const o = JSON.parse(String(raw));
        return o && typeof o === 'object' ? o : fallback || {};
    } catch (e) {
        return fallback || {};
    }
}

function getDefaultBrandingPayload() {
    return {
        channelId: DEFAULT_CHANNEL_ID,
        status: 'active',
        version: 1,
        splash: {
            imageUrl: '',
            title: '眠音盒',
            subtitle: 'AI声波音乐盒',
            slogan: '让每一夜都被温柔守护'
        },
        logoUrl: '',
        theme: {
            presetId: '',
            variant: 'dawn',
            primaryColor: '',
            navBg: '',
            navFront: '',
            tabSelected: '',
            tabColor: '',
            tabBg: '',
            windowBg: ''
        },
        features: { ...DEFAULT_FEATURES },
        copy: {
            homeGreetingSub: '',
            homeAiTitle: 'AI智能生成',
            homeAiDesc: '为你生成专属助眠音乐',
            homeBannerTitle: '眠家深睡 · 好物推荐',
            homeBannerDesc: '搭配助眠音乐，探索眠加商城精选',
            completeShareTitlePrefix: '眠音盒',
            cardWatermark: '—— 眠音盒',
            cardFooterLine1: '眠音盒 · AI 助眠音乐',
            cardFooterLine2: '让每一晚都有好梦相伴',
            cardDefaultMessage: '',
            shareTitlePrefix: '眠音盒',
            shareFallbackTitle: '眠音盒 · 助眠贺卡'
        },
        contact: {
            phone: '4008085180',
            phoneDisplay: '400-808-5180',
            email: 'zsyl@zsyl.cc'
        },
        share: {
            defaultImageUrl: ''
        }
    };
}

function rowToBrandingPayload(row, brandingRow) {
    const channelId = row ? row.id : DEFAULT_CHANNEL_ID;
    const status = row ? String(row.status || 'draft') : 'active';
    const features = {
        ...DEFAULT_FEATURES,
        ...parseJsonObject(brandingRow && brandingRow.features_json, {})
    };
    const base = getDefaultBrandingPayload();
    const splashImage =
        (brandingRow && brandingRow.splash_image_url) ||
        brandingAssetUrl(channelId, 'splash.png');
    const logoUrl =
        (brandingRow && brandingRow.logo_url) || brandingAssetUrl(channelId, 'logo.png');
    const shareImage =
        (brandingRow && brandingRow.share_image_url) ||
        brandingAssetUrl(channelId, 'share-card.png');

    const copy = {
        ...base.copy,
        ...parseJsonObject(brandingRow && brandingRow.copy_json, {})
    };

    const presetId = channelThemePresets.normalizeChannelPresetId(
        (brandingRow && brandingRow.theme_preset_id) || base.theme.presetId
    );
    const resolvedTheme = channelThemePresets.resolveThemeFromPreset(presetId, {
        theme_variant: brandingRow && brandingRow.theme_variant,
        primary_color: brandingRow && brandingRow.primary_color,
        nav_bg: brandingRow && brandingRow.nav_bg,
        nav_front: brandingRow && brandingRow.nav_front,
        tab_selected: brandingRow && brandingRow.tab_selected,
        tab_color: brandingRow && brandingRow.tab_color,
        tab_bg: brandingRow && brandingRow.tab_bg,
        window_bg: brandingRow && brandingRow.window_bg
    });

    return {
        channelId,
        status,
        version: brandingRow && brandingRow.version != null ? Number(brandingRow.version) : 1,
        name: row ? row.name || channelId : '眠音盒',
        splash: {
            imageUrl: splashImage,
            title: (brandingRow && brandingRow.splash_title) || base.splash.title,
            subtitle: (brandingRow && brandingRow.splash_subtitle) || base.splash.subtitle,
            slogan: (brandingRow && brandingRow.splash_slogan) || base.splash.slogan
        },
        logoUrl,
        theme: resolvedTheme,
        themePresets: channelThemePresets.listChannelThemePresets(),
        features,
        copy,
        contact: {
            phone: (brandingRow && brandingRow.contact_phone) || base.contact.phone,
            phoneDisplay:
                (brandingRow && brandingRow.contact_phone_display) || base.contact.phoneDisplay,
            email: (brandingRow && brandingRow.contact_email) || base.contact.email
        },
        share: {
            defaultImageUrl: shareImage
        }
    };
}

function getBrandingForChannel(db, channelIdRaw) {
    const channelId = normalizeChannelId(channelIdRaw);
    if (channelId === DEFAULT_CHANNEL_ID) {
        return getDefaultBrandingPayload();
    }
    const row = db
        .prepare('SELECT id, name, status FROM channels WHERE id = ?')
        .get(channelId);
    if (!row || row.status === 'disabled') {
        return { ...getDefaultBrandingPayload(), status: 'disabled', channelId };
    }
    const brandingRow = db
        .prepare('SELECT * FROM channel_branding WHERE channel_id = ?')
        .get(channelId);
    return rowToBrandingPayload(row, brandingRow);
}

function getUserChannelId(db, userId) {
    if (!userId) return null;
    const row = db
        .prepare('SELECT channel_id FROM user_channel_bindings WHERE user_id = ?')
        .get(userId);
    return row ? normalizeChannelId(row.channel_id) : null;
}

function bindUserChannel(db, userId, channelIdRaw, source) {
    const channelId = normalizeChannelId(channelIdRaw);
    if (channelId === DEFAULT_CHANNEL_ID) {
        db.prepare('DELETE FROM user_channel_bindings WHERE user_id = ?').run(userId);
        return { channelId: DEFAULT_CHANNEL_ID, cleared: true, isNewBinding: false };
    }
    const ch = db.prepare('SELECT id, status FROM channels WHERE id = ?').get(channelId);
    if (!ch || ch.status !== 'active') {
        const err = new Error('渠道不存在或已停用');
        err.code = 'CHANNEL_INVALID';
        throw err;
    }
    const prev = getUserChannelId(db, userId);
    const isNewBinding = !prev;
    db.prepare(
        `INSERT INTO user_channel_bindings (user_id, channel_id, source, bound_at)
         VALUES (?, ?, ?, datetime('now', 'localtime'))
         ON CONFLICT(user_id) DO UPDATE SET
           channel_id = excluded.channel_id,
           source = excluded.source,
           bound_at = datetime('now', 'localtime')`
    ).run(userId, channelId, source || 'client');
    return { channelId, cleared: false, isNewBinding, channelChanged: prev !== channelId };
}

function resolveSourceChannel(db, req) {
    const hdr = req.headers['x-channel'] || req.headers['X-Channel'];
    if (hdr) {
        const id = normalizeChannelId(hdr);
        if (id !== DEFAULT_CHANNEL_ID) return id;
    }
    if (req.user && req.user.id) {
        const bound = getUserChannelId(db, req.user.id);
        if (bound && bound !== DEFAULT_CHANNEL_ID) return bound;
    }
    return null;
}

function ensureChannelTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS channels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT DEFAULT 'draft',
            contract_start TEXT,
            contract_end TEXT,
            created_at DATETIME DEFAULT (datetime('now', 'localtime')),
            updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS channel_branding (
            channel_id TEXT PRIMARY KEY,
            splash_image_url TEXT,
            splash_title TEXT,
            splash_subtitle TEXT,
            splash_slogan TEXT,
            logo_url TEXT,
            share_image_url TEXT,
            theme_variant TEXT DEFAULT 'dawn',
            theme_preset_id TEXT DEFAULT 'deep_sleep_post',
            primary_color TEXT,
            nav_bg TEXT,
            nav_front TEXT,
            tab_selected TEXT,
            tab_color TEXT,
            tab_bg TEXT,
            window_bg TEXT,
            features_json TEXT,
            copy_json TEXT,
            contact_phone TEXT,
            contact_phone_display TEXT,
            contact_email TEXT,
            version INTEGER DEFAULT 1,
            updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (channel_id) REFERENCES channels(id)
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_channel_bindings (
            user_id TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            source TEXT,
            bound_at DATETIME DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (channel_id) REFERENCES channels(id)
        )
    `);

    const addCol = (table, col, ddl) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.some((c) => c.name === col)) {
            db.exec(ddl);
            console.log(`[DB] 已添加列 ${table}.${col}`);
        }
    };

    addCol('music_tracks', 'source_channel', `ALTER TABLE music_tracks ADD COLUMN source_channel TEXT`);
    addCol('card_shares', 'source_channel', `ALTER TABLE card_shares ADD COLUMN source_channel TEXT`);
    addCol('greeting_cards', 'source_channel', `ALTER TABLE greeting_cards ADD COLUMN source_channel TEXT`);
    addCol('channel_branding', 'theme_preset_id', `ALTER TABLE channel_branding ADD COLUMN theme_preset_id TEXT DEFAULT 'deep_sleep_post'`);
}

function applyChannel1BrandingRow(pilotId) {
    const d = CHANNEL_1_DESIGN;
    return {
        pilotId,
        splashImage: brandingAssetUrl(pilotId, 'splash.png'),
        logo: brandingAssetUrl(pilotId, 'logo.png'),
        shareImage: brandingAssetUrl(pilotId, 'share-card.png'),
        splashTitle: d.splash.title,
        splashSubtitle: d.splash.subtitle,
        splashSlogan: d.splash.slogan,
        themeVariant: d.theme.variant,
        themePresetId: d.theme.presetId || 'deep_sleep_post',
        primaryColor: d.theme.primaryColor,
        navBg: d.theme.navBg,
        navFront: d.theme.navFront,
        tabSelected: d.theme.tabSelected,
        tabColor: d.theme.tabColor,
        tabBg: d.theme.tabBg,
        windowBg: d.theme.windowBg,
        featuresJson: JSON.stringify(d.features),
        copyJson: JSON.stringify(d.copy),
        contactPhone: d.contact.phone,
        contactPhoneDisplay: d.contact.phoneDisplay,
        contactEmail: d.contact.email,
        version: CHANNEL_1_BRANDING_VERSION
    };
}

/** 已存在 channel_1 时同步最新皮肤（升 version 或 FORCE_CHANNEL1_SYNC=1） */
function syncChannel1BrandingDesign(db) {
    const pilotId = CHANNEL_1_ID;
    const row = db
        .prepare('SELECT channel_id, version FROM channel_branding WHERE channel_id = ?')
        .get(pilotId);
    if (!row) return;

    const force = String(process.env.FORCE_CHANNEL1_SYNC || '').trim() === '1';
    const curVer = row.version != null ? Number(row.version) : 0;
    if (!force && curVer >= CHANNEL_1_BRANDING_VERSION) return;

    const b = applyChannel1BrandingRow(pilotId);
    db.prepare(
        `UPDATE channels SET name = ?, status = 'active', updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(CHANNEL_1_DESIGN.channelName, pilotId);

    db.prepare(
        `UPDATE channel_branding SET
            splash_image_url = ?, splash_title = ?, splash_subtitle = ?, splash_slogan = ?,
            logo_url = ?, share_image_url = ?, theme_variant = ?, theme_preset_id = ?,
            primary_color = ?,
            nav_bg = ?, nav_front = ?, tab_selected = ?, tab_color = ?, tab_bg = ?, window_bg = ?,
            features_json = ?, copy_json = ?,
            contact_phone = ?, contact_phone_display = ?, contact_email = ?,
            version = ?, updated_at = datetime('now', 'localtime')
         WHERE channel_id = ?`
    ).run(
        b.splashImage,
        b.splashTitle,
        b.splashSubtitle,
        b.splashSlogan,
        b.logo,
        b.shareImage,
        b.themeVariant,
        b.themePresetId,
        b.primaryColor,
        b.navBg,
        b.navFront,
        b.tabSelected,
        b.tabColor,
        b.tabBg,
        b.windowBg,
        b.featuresJson,
        b.copyJson,
        b.contactPhone,
        b.contactPhoneDisplay,
        b.contactEmail,
        b.version,
        pilotId
    );
    console.log('[DB] 已同步 channel_1 皮肤 · 深眠驿站 v' + CHANNEL_1_BRANDING_VERSION);
}

function seedPilotChannel(db) {
    const pilotId = CHANNEL_1_ID;
    const exists = db.prepare('SELECT id FROM channels WHERE id = ?').get(pilotId);
    if (!exists) {
        db.prepare(
            `INSERT INTO channels (id, name, status, contract_start, updated_at)
             VALUES (?, ?, 'active', date('now'), datetime('now', 'localtime'))`
        ).run(pilotId, CHANNEL_1_DESIGN.channelName);
    }

    const brandingExists = db
        .prepare('SELECT channel_id FROM channel_branding WHERE channel_id = ?')
        .get(pilotId);
    const row = applyChannel1BrandingRow(pilotId);

    if (!brandingExists) {
        db.prepare(
            `INSERT INTO channel_branding (
                channel_id, splash_image_url, splash_title, splash_subtitle, splash_slogan,
                logo_url, share_image_url, theme_variant, theme_preset_id, primary_color, nav_bg, nav_front,
                tab_selected, tab_color, tab_bg, window_bg,
                features_json, copy_json, contact_phone, contact_phone_display, contact_email, version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            row.pilotId,
            row.splashImage,
            row.splashTitle,
            row.splashSubtitle,
            row.splashSlogan,
            row.logo,
            row.shareImage,
            row.themeVariant,
            row.themePresetId,
            row.primaryColor,
            row.navBg,
            row.navFront,
            row.tabSelected,
            row.tabColor,
            row.tabBg,
            row.windowBg,
            row.featuresJson,
            row.copyJson,
            row.contactPhone,
            row.contactPhoneDisplay,
            row.contactEmail,
            row.version
        );
        console.log('[DB] 已种子渠道 channel_1 · 深眠驿站');
    } else {
        syncChannel1BrandingDesign(db);
    }
}

function initChannelModule(db) {
    ensureChannelTables(db);
    seedPilotChannel(db);
}

module.exports = {
    DEFAULT_CHANNEL_ID,
    DEFAULT_FEATURES,
    getPublicImageBase,
    brandingAssetUrl,
    normalizeChannelId,
    getDefaultBrandingPayload,
    getBrandingForChannel,
    getUserChannelId,
    bindUserChannel,
    resolveSourceChannel,
    ensureChannelTables,
    seedPilotChannel,
    syncChannel1BrandingDesign,
    CHANNEL_1_DESIGN,
    initChannelModule,
    channelThemePresets
};
