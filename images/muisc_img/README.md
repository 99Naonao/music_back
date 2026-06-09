# 官方曲库封面

与 `track1.mp3` … `track5.mp3` 一一对应，文件名保持一致：

- `track1.png` — Rain Sutra 寺雨
- `track2.png` — Aurora Nest 极巢
- `track3.png` — Echo Grove 盘林
- `track4.png` — Glass Drizzle 璃雨
- `track5.png` — Stellar Haze 星霭

访问地址：`https://你的域名/images/muisc_img/track1.png`

导入：`node scripts/import-library.js` 会把路径写入数据库 `player_cover_url`。

若改名目录为 `music_img`，在 `.env` 设置：`LIBRARY_COVER_SUBDIR=music_img`
