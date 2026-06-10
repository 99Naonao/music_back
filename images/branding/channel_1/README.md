# channel_1 · 深眠驿站

渠道皮肤 · 预设 `deep_sleep_post`（9 套渠道主题之一）

## 品牌

| 项 | 内容 |
|----|------|
| 渠道 ID | `channel_1` |
| 品牌名 | **深眠驿站** |
| 默认外观预设 | `deep_sleep_post`（深眠驿站 · 暮紫） |

## 渠道主题说明

渠道用户可在设置中从 **9 套渠道预设** 切换，**不含**官方晨雾/眠夜。  
完整目录见：`backend/docs/channel-theme-presets.md`

## 开屏文案

- 主标题：深眠驿站
- 副标题：AI助眠声波定制
- Slogan：今夜，为自己留一刻宁静

## 素材

| 文件 | 说明 |
|------|------|
| `logo.png` | 品牌 Logo（**RGBA 透明底**，正方形 976×976，勿含棋盘格像素） |
| `splash.png` | 开屏主图 |
| `share-card.png` | 分享卡片封面 |

部署路径：`/www/wwwroot/music_sleep_api/images/branding/channel_1/`

**Logo 透明底说明**：须为 PNG-24 带 Alpha 通道；导出时勿把 PS/Cursor 的「透明网格」烘焙进图里。小程序端会通过 `downloadFile` 拉取到本地再显示，避免 HTTPS 直链透明异常。

## 测试

```
pages/splash/splash?channel=channel_1
```

## 同步

重启 Node 后 `version < 4` 自动 UPDATE；或 `FORCE_CHANNEL1_SYNC=1`
