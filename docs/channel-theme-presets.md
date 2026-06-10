# 外观主题预设（16 套 · 8 浅色 + 8 深色）

**官方用户**可在 **设置 → 外观主题** 中切换全部 **16 套**（含晨雾浅蓝 / 眠夜深蓝）。  
**渠道用户**仅可选 **14 套**渠道主题，**不可**使用 `official_dawn` / `official_night` 官方经典皮肤。

未自选时：官方用户沿用旧版 `mbAppTheme`（晨雾浅蓝 / 眠夜深蓝）；渠道用户沿用渠道商在 `channel_branding.theme_preset_id` 配置的默认套。

## 浅色（8）

| ID | 名称 | 气质 | 主色 | 渠道可用 |
|----|------|------|------|----------|
| `deep_sleep_post` | 深眠驿站 | 暮紫柔和，静谧安神 | `#7568A8` | ✓ |
| `morning_dew` | 晨露清森 | 青绿晨雾，清新自然 | `#5B8A72` | ✓ |
| `ocean_breath` | 海息蓝澜 | 海雾蓝调，呼吸般舒缓 | `#4A8BA8` | ✓ |
| `amber_glow` | 琥珀暖光 | 暖琥珀色，包裹感入眠 | `#B8864E` | ✓ |
| `celadon_bamboo` | 青竹雅境 | 青瓷绿韵，东方清寂 | `#6A9080` | ✓ |
| `rose_twilight` | 薄暮豆沙 | 豆沙暮玫瑰，温柔治愈 | `#A87888` | ✓ |
| `cloud_silk` | 云絮素眠 | 云白极简，轻灵无扰 | `#7A8494` | ✓ |
| `official_dawn` | 晨雾浅蓝 | 官方经典浅色 | `#568FD1` | 仅官方 |

## 深色（8）

| ID | 名称 | 气质 | 主色 | 渠道可用 |
|----|------|------|------|----------|
| `pine_smoke` | 松烟静夜 | 松绿深境，夜阑人静 | `#6BA896` | ✓ |
| `midnight_star` | 星夜藏蓝 | 藏蓝星空，深邃安眠 | `#7B8FD4` | ✓ |
| `violet_dusk` | 紫夜沉香 | 暮紫深境，安神入梦 | `#9A88C8` | ✓ |
| `forest_abyss` | 森夜墨绿 | 深林墨绿，自然沉眠 | `#5A9A78` | ✓ |
| `ember_night` | 余烬夜茶 | 暖褐余烬，温热安心 | `#C4926A` | ✓ |
| `wine_velvet` | 醇夜勃艮第 | 酒红绒夜，微醺放松 | `#B87A8A` | ✓ |
| `steel_night` | 钢蓝长夜 | 冷钢蓝调，理性沉静 | `#6A8AA8` | ✓ |
| `official_night` | 眠夜深蓝 | 官方经典深色 | `#7FB3A3` | 仅官方 |

## 渠道商配置默认主题

```sql
UPDATE channel_branding
SET theme_preset_id = 'ocean_breath', version = version + 1
WHERE channel_id = 'channel_2';
```

可选 ID 为上表「渠道可用」列。不可设为 `official_dawn` / `official_night`（会自动回退为 `deep_sleep_post`）。

重启 Node 后 `GET /api/branding?channel=xxx` 的 `themePresets` 仅返回 14 套。

## API

- `GET /api/branding?channel=channel_1` → `data.theme.presetId`、`data.themePresets[]`（14 套）
- `GET /api/channel-theme-presets` → 渠道可选 14 套

## 代码位置

- 后端定义：`backend/src/channel-theme-presets.js`
- 小程序定义：`music/utils/channel-theme-presets.js`（须与后端保持一致）
- 用户本地选择 Storage key：`mbChannelThemePreset`
