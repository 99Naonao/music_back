# 贺卡模板图片（PNG）

## 目录说明

- 所有贺卡 PNG 放在 **`images/card/`** 目录下。
- 清单登记在 **`images/card-templates.json`**。

### `categories` 与 `templates` 分开写

- **`categories`**：小程序顶部 Tab，可先写全（含暂无图的分类）。
- **`templates`**：只登记已有或计划上传的 PNG；某分类下暂时没有条目时，选卡页显示「即将上线」。

| 分类 Tab | id | templates |
|----------|-----|-----------|
| 常规 | `general` | `1.png`…`14.png` + 默认背景 |
| 晚安 | `goodnight` | `goodnight-01.png` … `04`（4 张） |
| 亲子 | `family` | `family-01.png` … `04`（4 张） |
| 亲情 | `mother` | `mother-01.png`、`mother-02.png`（2 张） |
| 音乐贺卡 | `music` | `music-01.png` … `04`（4 张） |
| 治愈、鼓励、节日、雨夜听窗 | `healing` … `rain` | **仅占位**，图做好后再加 `templates` |

以后给占位分类加图，只需在 `templates` 追加，例如：

```json
{ "id": "tpl_mother_01", "categoryId": "mother", "name": "妈妈好梦", "file": "mother-01.png", "sortOrder": 1, "gradientTemplate": 1 }
```

未上传的 PNG 同步时会跳过；上传后 `npm run sync:cards` 或重启服务即可入库。清单中已移除的分类/模板会自动下架。

访问地址：`https://你的域名/images/card/文件名.png`（与 `MALL_IMAGE_BASE` 一致）。

## 操作步骤

1. PNG 放到 **`backend/images/card/`**。
2. 在 `card-templates.json` 的 `templates` 里增加条目，`file` 与文件名一致。
3. `npm run sync:cards` 或重启 Node。

## 祝福语文字区（`textLayout`）

PNG 上空白信纸可能在**上 / 中 / 下**不同位置。在 `templates` 条目里增加：

- `"textLayout": "top"` — 文字区在画面上方  
- `"textLayout": "middle"` — 居中（默认）  
- `"textLayout": "bottom"` — 文字区在画面下方  

也可写精确百分比对象（相对卡片宽高）：

```json
"textLayout": {
  "to": { "top": 8, "left": 20, "right": 20, "padLeft": 12 },
  "message": { "top": 14, "left": 15, "right": 15, "bottom": 48, "padLeft": 12 }
}
```

同步后，体验版/正式版小程序从接口读取 `textLayout`。

### 每行字数（`charsPerLine`，可选）

配图贺卡按固定字数折行（段首仍有「　　」缩进）。在 `templates` 条目增加：

```json
"charsPerLine": 13
```

- 合法范围 **4～30**，省略则用默认 **15**
- 仅对 **配图 PNG 模板** 生效；首行缩进占 2 格，首行正文 = `charsPerLine - 2`
- 同步后正式环境从接口下发；开发阶段也可改小程序 `utils/card-text-layout.js` 的 `TEMPLATE_CHARS_PER_LINE` / `CATEGORY_CHARS_PER_LINE`

### 调坐标（开发 → 手动同步后台）

1. **开发阶段**：改小程序 `utils/card-text-layout.js`（`PRESETS`、`TEMPLATE_PRESET`），用开发者工具 **develop** 编译预览。
2. **调满意后**：把对应配置**手动**写入本仓库 `images/card-templates.json` 里各模板的 `textLayout`（可用预设名如 `"musicTop"`，或写完整百分比对象）。
3. 服务器执行 `npm run sync:cards`（或重启 Node），再部署后端；发体验版/正式版小程序验证。

**正式环境以 `card-templates.json` + 数据库为准**；开发工具里以 `card-text-layout.js` 为准。

### 当前分类布局（写入 json 时参考）

| 区域 | 模板 |
|------|------|
| **top** | 亲子 01–02；音乐 01–02；亲情 01–02 |
| **middle** | 晚安 01–02 |
| **bottom** | 晚安 03–04；亲子 03–04 |
| **常规 01–14** | 见 `card-templates.json` 各条 `textLayout` |

某张仍偏位时，只改该条 `textLayout` 里 `top` / `bottom` ±2 即可。

## 微信小程序

须将 `MALL_IMAGE_BASE` 域名配置为 **downloadFile 合法域名**。
