/**
 * 外观主题预设（16 套 · 8 浅色 + 8 深色）
 * 官方与渠道用户均可选用；渠道商在 channel_branding.theme_preset_id 配置默认套。
 */
const CHANNEL_THEME_PRESETS = {
    deep_sleep_post: {
        id: 'deep_sleep_post',
        name: '深眠驿站',
        desc: '暮紫柔和，静谧安神',
        variant: 'dawn',
        primaryColor: '#7568A8',
        navBg: '#EBE6F4',
        navFront: '#352D4A',
        tabSelected: '#7568A8',
        tabColor: '#9490A0',
        tabBg: '#FCFAFE',
        windowBg: '#F4F0FA'
    },
    morning_dew: {
        id: 'morning_dew',
        name: '晨露清森',
        desc: '青绿晨雾，清新自然',
        variant: 'dawn',
        primaryColor: '#5B8A72',
        navBg: '#E8F2EC',
        navFront: '#2A4035',
        tabSelected: '#5B8A72',
        tabColor: '#7A9485',
        tabBg: '#FAFCFB',
        windowBg: '#F0F7F2'
    },
    ocean_breath: {
        id: 'ocean_breath',
        name: '海息蓝澜',
        desc: '海雾蓝调，呼吸般舒缓',
        variant: 'dawn',
        primaryColor: '#4A8BA8',
        navBg: '#E3EFF5',
        navFront: '#243D4A',
        tabSelected: '#4A8BA8',
        tabColor: '#7A96A5',
        tabBg: '#FAFCFD',
        windowBg: '#EDF5FA'
    },
    amber_glow: {
        id: 'amber_glow',
        name: '琥珀暖光',
        desc: '暖琥珀色，包裹感入眠',
        variant: 'dawn',
        primaryColor: '#B8864E',
        navBg: '#F5EDE3',
        navFront: '#4A3828',
        tabSelected: '#B8864E',
        tabColor: '#9A8878',
        tabBg: '#FDFBF8',
        windowBg: '#FAF5EE'
    },
    celadon_bamboo: {
        id: 'celadon_bamboo',
        name: '青竹雅境',
        desc: '青瓷绿韵，东方清寂',
        variant: 'dawn',
        primaryColor: '#6A9080',
        navBg: '#E6F0EB',
        navFront: '#2C4038',
        tabSelected: '#6A9080',
        tabColor: '#849A90',
        tabBg: '#FAFCFB',
        windowBg: '#F2F8F4'
    },
    rose_twilight: {
        id: 'rose_twilight',
        name: '薄暮豆沙',
        desc: '豆沙暮玫瑰，温柔治愈',
        variant: 'dawn',
        primaryColor: '#A87888',
        navBg: '#F3EAED',
        navFront: '#402830',
        tabSelected: '#A87888',
        tabColor: '#9A8890',
        tabBg: '#FDFAFB',
        windowBg: '#FAF2F4'
    },
    cloud_silk: {
        id: 'cloud_silk',
        name: '云絮素眠',
        desc: '云白极简，轻灵无扰',
        variant: 'dawn',
        primaryColor: '#7A8494',
        navBg: '#EEF0F3',
        navFront: '#3A4048',
        tabSelected: '#6E7888',
        tabColor: '#9AA0A8',
        tabBg: '#FCFCFD',
        windowBg: '#F6F7F9'
    },
    official_dawn: {
        id: 'official_dawn',
        name: '晨雾浅蓝',
        desc: '官方经典浅色',
        variant: 'dawn',
        primaryColor: '#568FD1',
        navBg: '#E1F0FF',
        navFront: '#1E3A5F',
        tabSelected: '#2D5A8E',
        tabColor: '#6B7A8C',
        tabBg: '#FFFFFF',
        windowBg: '#E8F2FC'
    },
    pine_smoke: {
        id: 'pine_smoke',
        name: '松烟静夜',
        desc: '松绿深境，夜阑人静',
        variant: 'night',
        primaryColor: '#6BA896',
        navBg: '#243530',
        navFront: '#E8F2ED',
        tabSelected: '#8BC4B0',
        tabColor: '#8A9A92',
        tabBg: '#1A2420',
        windowBg: '#1E2A26'
    },
    midnight_star: {
        id: 'midnight_star',
        name: '星夜藏蓝',
        desc: '藏蓝星空，深邃安眠',
        variant: 'night',
        primaryColor: '#7B8FD4',
        navBg: '#252D45',
        navFront: '#EAEEF8',
        tabSelected: '#9AADE8',
        tabColor: '#909AAE',
        tabBg: '#1A2030',
        windowBg: '#1E2438'
    },
    violet_dusk: {
        id: 'violet_dusk',
        name: '紫夜沉香',
        desc: '暮紫深境，安神入梦',
        variant: 'night',
        primaryColor: '#9A88C8',
        navBg: '#2A2438',
        navFront: '#EDE8F8',
        tabSelected: '#B8A8E0',
        tabColor: '#9A94AA',
        tabBg: '#1E1828',
        windowBg: '#221C30'
    },
    forest_abyss: {
        id: 'forest_abyss',
        name: '森夜墨绿',
        desc: '深林墨绿，自然沉眠',
        variant: 'night',
        primaryColor: '#5A9A78',
        navBg: '#1C2822',
        navFront: '#E6F2EA',
        tabSelected: '#7CB898',
        tabColor: '#889A90',
        tabBg: '#141C18',
        windowBg: '#182018'
    },
    ember_night: {
        id: 'ember_night',
        name: '余烬夜茶',
        desc: '暖褐余烬，温热安心',
        variant: 'night',
        primaryColor: '#C4926A',
        navBg: '#2A2218',
        navFront: '#F5EDE3',
        tabSelected: '#D8A882',
        tabColor: '#A89888',
        tabBg: '#1E1810',
        windowBg: '#221C14'
    },
    wine_velvet: {
        id: 'wine_velvet',
        name: '醇夜勃艮第',
        desc: '酒红绒夜，微醺放松',
        variant: 'night',
        primaryColor: '#B87A8A',
        navBg: '#301820',
        navFront: '#F5E8EC',
        tabSelected: '#D098A8',
        tabColor: '#A89098',
        tabBg: '#241018',
        windowBg: '#28141C'
    },
    steel_night: {
        id: 'steel_night',
        name: '钢蓝长夜',
        desc: '冷钢蓝调，理性沉静',
        variant: 'night',
        primaryColor: '#6A8AA8',
        navBg: '#1E2630',
        navFront: '#E8EEF5',
        tabSelected: '#88A8C8',
        tabColor: '#889098',
        tabBg: '#161C24',
        windowBg: '#1A2028'
    },
    official_night: {
        id: 'official_night',
        name: '眠夜深蓝',
        desc: '官方经典深色',
        variant: 'night',
        primaryColor: '#7FB3A3',
        navBg: '#1A1A2E',
        navFront: '#FFFDF5',
        tabSelected: '#FFFFFF',
        tabColor: '#C8C8C8',
        tabBg: '#1A1A2E',
        windowBg: '#202B48'
    }
};

const LIGHT_PRESET_IDS = [
    'deep_sleep_post',
    'morning_dew',
    'ocean_breath',
    'amber_glow',
    'celadon_bamboo',
    'rose_twilight',
    'cloud_silk',
    'official_dawn'
];

const DARK_PRESET_IDS = [
    'pine_smoke',
    'midnight_star',
    'violet_dusk',
    'forest_abyss',
    'ember_night',
    'wine_velvet',
    'steel_night',
    'official_night'
];

const ORDERED_PRESET_IDS = LIGHT_PRESET_IDS.concat(DARK_PRESET_IDS);
const DEFAULT_PRESET_ID = 'deep_sleep_post';

/** 仅官方用户可选（渠道 API / branding 不可用） */
const OFFICIAL_ONLY_PRESET_IDS = ['official_dawn', 'official_night'];

const CHANNEL_LIGHT_PRESET_IDS = LIGHT_PRESET_IDS.filter(
    (id) => OFFICIAL_ONLY_PRESET_IDS.indexOf(id) < 0
);
const CHANNEL_DARK_PRESET_IDS = DARK_PRESET_IDS.filter(
    (id) => OFFICIAL_ONLY_PRESET_IDS.indexOf(id) < 0
);
const CHANNEL_ORDERED_PRESET_IDS = CHANNEL_LIGHT_PRESET_IDS.concat(CHANNEL_DARK_PRESET_IDS);

function isOfficialOnlyPreset(presetId) {
    const id = presetId != null ? String(presetId).trim() : '';
    return OFFICIAL_ONLY_PRESET_IDS.indexOf(id) >= 0;
}

function normalizePresetId(raw) {
    const s = raw != null ? String(raw).trim() : '';
    if (s && CHANNEL_THEME_PRESETS[s]) return s;
    return DEFAULT_PRESET_ID;
}

/** 渠道场景：官方经典套无效，回退默认 */
function normalizeChannelPresetId(raw) {
    const s = raw != null ? String(raw).trim() : '';
    if (s && isOfficialOnlyPreset(s)) return DEFAULT_PRESET_ID;
    if (s && CHANNEL_THEME_PRESETS[s]) return s;
    return DEFAULT_PRESET_ID;
}

function getChannelThemePreset(presetId) {
    return CHANNEL_THEME_PRESETS[normalizeChannelPresetId(presetId)];
}

function mapPresetList(ids) {
    return ids.map((id) => {
        const p = CHANNEL_THEME_PRESETS[id];
        return {
            id: p.id,
            name: p.name,
            desc: p.desc,
            variant: p.variant,
            primaryColor: p.primaryColor,
            navBg: p.navBg,
            navFront: p.navFront,
            tabSelected: p.tabSelected,
            tabColor: p.tabColor,
            tabBg: p.tabBg,
            windowBg: p.windowBg
        };
    });
}

/** 渠道用户可选（14 套，不含官方经典） */
function listChannelThemePresets() {
    return mapPresetList(CHANNEL_ORDERED_PRESET_IDS);
}

/** 全部 16 套（含官方经典，运营参考） */
function listAllThemePresets() {
    return mapPresetList(ORDERED_PRESET_IDS);
}

function resolveThemeFromPreset(presetId, rowTheme) {
    const preset = getChannelThemePreset(presetId);
    const row = rowTheme || {};
    const pick = (key, snakeKey) => {
        const fromRow = row[snakeKey] || row[key];
        if (fromRow != null && String(fromRow).trim() !== '') return String(fromRow).trim();
        return preset[key];
    };
    return {
        presetId: preset.id,
        presetName: preset.name,
        presetDesc: preset.desc,
        variant: pick('variant', 'theme_variant') || preset.variant,
        primaryColor: pick('primaryColor', 'primary_color'),
        navBg: pick('navBg', 'nav_bg'),
        navFront: pick('navFront', 'nav_front'),
        tabSelected: pick('tabSelected', 'tab_selected'),
        tabColor: pick('tabColor', 'tab_color'),
        tabBg: pick('tabBg', 'tab_bg'),
        windowBg: pick('windowBg', 'window_bg')
    };
}

module.exports = {
    CHANNEL_THEME_PRESETS,
    LIGHT_PRESET_IDS,
    DARK_PRESET_IDS,
    ORDERED_PRESET_IDS,
    OFFICIAL_ONLY_PRESET_IDS,
    CHANNEL_ORDERED_PRESET_IDS,
    DEFAULT_PRESET_ID,
    isOfficialOnlyPreset,
    normalizePresetId,
    normalizeChannelPresetId,
    getChannelThemePreset,
    listChannelThemePresets,
    listAllThemePresets,
    resolveThemeFromPreset
};
