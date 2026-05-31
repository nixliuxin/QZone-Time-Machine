# 数据字段规格 — API 可获取 vs 前端显示

本文档列出引擎从 QQ 空间 API 获取的所有字段，以及 Viewer 前端的显示状态。

> 基于 809166028 用户实际 API 返回验证（2026-05-30）

---

## 说说 (Messages)

| 字段 | 说明 | API 获取 | 前端显示 | 实测备注 |
|------|------|:--------:|:--------:|----------|
| `content` | 正文 | ✅ | ✅ | |
| `pic` / `custom_images` | 图片 | ✅ | ✅ | 259/832 条有图 |
| `custom_videos` | 视频 | ✅ | ✅ | 6/832 条有视频 |
| `commentlist` / `comments` | 评论列表 | ✅ | ✅ | 476/832 条有评论 |
| `cmtnum` | 评论数 | ✅ | ✅ | API list 原生返回 |
| `fwdnum` | 转发数 | ✅ | ✅ | 56/832 条有 |
| `rt_sum` | 转发数(备选) | ✅ | ✅ | 102/832 条有 |
| `lbs` | 地理位置 | ✅ | ✅ | 31/832 条有 |
| `source_name` | 来源设备 | ✅ | ✅ | 185/832 条有 |
| `likenum` | 点赞数 | ❌ | ✅* | **API list 不返回此字段**，仅通过 likes enricher 获取 |
| `likeTotal` | 点赞数(enriched) | ⚠️ | ✅ | `--enrich-likes` 写入，但本用户全部返回 0 |
| `likes` | 点赞人列表 | ⚠️ | ⏳ | `--enrich-likes` 写入，mood 类型 API 对本用户返回空 |
| `created_time` | 发布时间 | ✅ | ✅ | |

**说说 likes 结论**: QQ 空间 messages list API **不包含** likenum 字段。唯一获取途径是 likes enricher (`getLikeList` API + unikey)，但 mood 类型的 likes 对本用户返回空（可能是隐私设置或 API 限制），同一 session 下 blog 类型的 likes 正常返回。

## 日志 (Blogs)

| 字段 | 说明 | API 获取 | 前端显示 | 实测备注 |
|------|------|:--------:|:--------:|----------|
| `title` | 标题 | ✅ | ✅ | |
| `custom_html` | 正文 HTML | ✅ | ✅ | 通过 detail API 获取 |
| `category` / `cate` | 分类 | ✅ | ✅ | |
| `blogType` | 类型(原创/转载) | ✅ | ✅ | 0=原创, 3=转载 |
| `comments` | 评论列表 | ✅ | ✅ | `--enrich-comments` 补全，27/43 有评论 |
| `commentNum` / `replynum` | 评论数 | ✅ | ✅ | API list 原生返回 |
| `readnum` | 阅读数 | ⚠️ | ✅ | **需独立 API 调用** `getReadCount`，已修复但需重新登录验证 |
| `likeTotal` | 点赞数 | ✅ | ✅ | API list 原生返回（值：3~41） |
| `likes` | 点赞人列表 | ✅ | ✅ | `--enrich-likes`，13/43 有数据（含 nick/portrait） |
| `pubTime` | 发布时间 | ✅ | ✅ | |
| `abstract` | 摘要 | ✅ | ✅ | 列表页显示 |

**日志 readnum 结论**: Blog list API 不返回 readnum。引擎有独立的 `getReadCount` API（批量查询），已加入 collector 但需重新登录后验证响应格式。

## 相册 (Albums)

| 字段 | 说明 | API 获取 | 前端显示 | 实测备注 |
|------|------|:--------:|:--------:|----------|
| `name` | 相册名 | ✅ | ✅ | |
| `className` | 分类 | ✅ | ✅ | |
| `desc` | 描述 | ✅ | ✅ | 13/79 有描述 |
| `createtime` | 创建时间 | ✅ | ✅ | |
| `lastuploadtime` | 最后上传时间 | ✅ | ✅ | |
| `total` | 照片总数 | ✅ | ✅ | |
| `cover_url` | 封面 | ✅ | ✅ | |

## 照片 (Photos)

| 字段 | 说明 | API 获取 | 前端显示 | 实测备注 |
|------|------|:--------:|:--------:|----------|
| `name` | 照片名 | ✅ | ✅ | |
| `desc` | 描述文字 | ✅ | ✅ | 393/7891 有描述 |
| `shoottime` | 拍摄时间 | ✅ | ✅ | |
| `uploadtime` | 上传时间 | ✅ | ✅ | |
| `width` / `height` | 尺寸 | ✅ | ✅ | |
| `exif` | EXIF 信息 | ✅ | ✅ | |
| `comments` | 评论列表 | ⚠️ | ✅ | **需 `--enrich-comments`**，已修复加入 enricher（之前遗漏） |
| `poiName` | POI 地点名 | ✅ | ✅ | 9/7891 有 POI |
| `photocubage` | 文件大小 | ✅ | ✅ | |

**照片评论结论**: photo list API 返回 `cmtTotal` 字段标识有多少评论，但不返回评论内容。需要 `--enrich-comments` 逐张调用 `getImageComments` API。此功能之前未接入 CLI，现已修复。

## 留言板 (Boards)

| 字段 | 说明 | API 获取 | 前端显示 | 实测备注 |
|------|------|:--------:|:--------:|----------|
| `htmlContent` | 正文 | ✅ | ✅ | |
| `replyList` / `custom_replies` | 回复 | ✅ | ✅ | |
| `signature` | 签名 | ✅ | ✅ | API 返回字段但本用户全部为空字符串 |
| `pubtime` | 发布时间 | ✅ | ✅ | |
| `nickname` | 昵称 | ✅ | ✅ | 含 emoji 解析 |
| `uin` | QQ 号 | ✅ | ✅ | 可点击跳转 |

## 其他模块

| 模块 | 说明 | 获取 | 前端 |
|------|------|:----:|:----:|
| Friends | 好友列表 | ✅ | ✅ |
| Visitors | 访客记录 | ✅ | ✅ |
| Diaries | 日记 | ✅ | ✅ |
| Favorites | 收藏 | ✅ | ✅ |
| Shares | 分享 | ✅ | ✅ |
| Videos | 视频 | ✅ | ✅ |

---

## Enrichment 选项

| 选项 | 作用 | 覆盖模块 | 实测结果 |
|------|------|----------|----------|
| `--enrich-comments` | 补全完整评论列表 | 说说、日志、**相册照片**、视频、分享 | 说说+9、日志+27，照片已修复接入 |
| `--enrich-likes` | 获取点赞人列表 | 说说、日志 | 日志 13/43 成功，说说全部返回空 |

## 需要重新登录验证的项目

1. **`readnum`** — 已加入 collector 调用 `getReadCount` API，需验证响应格式
2. **说说 likes** — 确认是否为用户隐私设置导致空返回（换用其他用户测试）
3. **照片 comments** — 已修复 enricher 接入，需实际运行验证

## 图例

- ✅ = 已实现且有数据
- ⚠️ = API 存在但需额外调用/enrichment/条件受限
- ⏳ = 代码就绪，等待 API 返回有效数据
- ❌ = API 不返回此字段
