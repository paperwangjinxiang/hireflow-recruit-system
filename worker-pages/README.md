# hireflow-store-api（Cloudflare Pages Functions）

教师招聘系统的云存储与云 OCR 后端，部署为 Cloudflare Pages 项目 `hireflow-store-api`。

- `functions/api/jsonBlob/` — JSONBlob 兼容的存储（团队共享数据，**D1**）
- `functions/api/inbox/` — 在线投递箱（D1 原子 INSERT；`POST` 投递、`GET` 拉取、`POST /consume` 删除已入库条目）
- `functions/api/ocr/` — 云 OCR 代理（百度通用文字识别-高精度版，可选，token 仍缓存于 KV）
- `functions/api/candidates/` — 候选人分表存储（D1 `candidates` 表 + FTS5 全文检索，支撑 5 万份简历规模）
- `functions/api/files/` — 简历附件存储（可插拔存储层：OSS → R2 → KV 兜底，见下文）
- `functions/api/files-stats.js` — 附件存储统计（对账用）

## candidates API（候选人分表）

存储设计：完整简历 JSON 由客户端用现有信封密钥加密后放入 `doc` 列（服务端零知识）；
姓名、教资学段/学科、学校、毕业年份、招聘阶段、锁定负责人等非敏感字段作为明文索引列，用于列表/筛选/搜索。
**手机号、身份证等敏感字段只在加密 doc 内，不进任何明文列。**

D1 表结构见 `migrations/0001_candidates.sql`（`candidates` + 4 个索引 + FTS5 虚表 `candidates_fts`）。

**FTS5 探测结论：D1 支持 FTS5 虚表**（`CREATE VIRTUAL TABLE ... USING fts5` 可用，中文按 unicode61
整词分词匹配）。搜索采用「FTS5 整词匹配 ∪ search_text LIKE 子串匹配」并集，兼顾中文部分匹配；
写入/更新/删除时同步维护 `candidates_fts`。

端点：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/candidates` | 分页列表（不含 doc）。参数：`page`(1) `size`(50,≤200) `stage` `owner`(`owner=none`=总库未锁定) `status`(active) `cert_subject` `cert_level` `q`(搜索) `sort`(updated_at_desc/updated_at_asc/name)。返回 `{total,page,size,items}` |
| POST | `/api/candidates` | 创建 `{id, doc, index:{...}}` → 201 `{id, ok:true}`。`index.created_at/updated_at`（毫秒）可选，用于迁移保留原始时间戳 |
| POST | `/api/candidates/bulk` | 批量 upsert `{items:[{id,doc,index}]}`，单批 ≤100，D1 batch 原子提交 → `{upserted:n}`（迁移/批量导入用，幂等可重跑） |
| GET | `/api/candidates/{id}` | 完整记录（含加密 doc） |
| PUT | `/api/candidates/{id}` | 更新 doc + 索引列 |
| DELETE | `/api/candidates/{id}` | 删除（同步清 FTS） |

迁移脚本：`网站开发/migrate_candidates.py`（只读整库信封 → 逐候选人加密 doc + 索引 → bulk 写入 → 对账）。
首次迁移已完成：信封 59 份 = D1 59 行 ✅。双写期信封保持原样作为回滚保障。

## files API（可插拔附件存储：OSS → R2 → KV）

- `POST /api/files`：`{name, mime, data_b64}`（base64，解码后 ≤4MB；内容为客户端加密密文）→ 201 `{key, ok:true, store}`，key 形如 `resumes/{uuid}-{安全文件名}`
- `GET /api/files/{key}`：按存储的 Content-Type 返回（PDF 可预览，catch-all 路由 `[[key]].js` 支持 key 内斜杠），响应头 `X-HF-Store` 报告实际驱动
- `DELETE /api/files/{key}`：删除 → `{deleted:true, store}`
- `GET /api/files-stats`：存储统计。`oss`/`r2` 返回 `{store, count, totalBytes, byMonth}`；
  `kv` 返回 `{store:"kv", count:null, totalBytes:null, note}`（函数内无账号凭证无法列举 KV 键，
  对账用 `网站开发/migrate_files_to_oss.py --list-only`）

**存储驱动优先级**（`functions/api/_storage.js`，统一接口 `put/get/del`）：

1. KV `config:oss` 存在且 `enabled !== false` → **阿里云 OSS**（REST 直连，V1 签名，桶私有）
2. `env.BUCKET` 绑定 → R2
3. `env.BLOBS` → KV 兜底（key 加 `file:` 前缀，metadata 存 mime/name/size/created）

OSS 模式下请求失败（签名错/网络错/配置不完整）返回 **502 可读错误**，**不静默降级 KV**（避免双写分裂）。
`config:oss` 读取带 60s 模块级缓存，写入/修改后最长 60s 生效。

**config:oss 格式**（密钥只存服务端 KV，绝不进客户端/前端仓库）：

```json
{"provider":"aliyun","enabled":true,"bucket":"...","endpoint":"oss-cn-hangzhou.aliyuncs.com",
 "accessKeyId":"...","accessKeySecret":"...","prefix":"hireflow-attachments/"}
```

OSS 对象名 = `prefix + 逻辑key`（如 `hireflow-attachments/resumes/uuid-xxx.pdf`），逻辑 key 不变，
切换/回滚时候选人 doc 里的附件引用不失效。

**切换到 OSS 的步骤**（拿到密钥后，在 `网站开发` 目录）：

1. 复制 `oss-config.example.json` 为 `oss-config.json` 填入密钥（已加入 `.gitignore`，不落 git）
2. `python migrate_files_to_oss.py` —— KV 存量附件按原 key 直传 OSS + 抽样校验（幂等，默认不删 KV）
3. `python set_oss_config.py` —— 写 KV `config:oss` 并验证 `files-stats` 显示 `store=oss`
4. 观察无误后 `python migrate_files_to_oss.py --delete-kv` 清理 KV 存量（可选）
5. 回滚：`python set_oss_config.py --disable`（60s 内回退 KV/R2）

**R2 备选**：开通 R2 后按原步骤绑定 `BUCKET`（见下）；若 `config:oss` 存在则 OSS 优先。

1. Cloudflare Dashboard → R2 → 按提示开通（需绑定支付方式，含免费额度；API 返回 10042，无法脚本代办）
2. `npx wrangler r2 bucket create hireflow-files`
3. `python recruit-system/worker-pages/scripts/bind_r2.py`（GET 现有 deployment_configs，合并 PATCH 在
   production/preview 加 `r2_buckets: {"BUCKET": {"name": "hireflow-files"}}`，保留 DB/BLOBS 绑定）
4. 取消 `wrangler.toml` 中 `r2_buckets` 的注释，重新 `pages deploy`

## 部署

```bash
cd worker-pages
npx wrangler pages deploy public --project-name=hireflow-store-api
```

绑定：
- KV 命名空间 `BLOBS`（files 的 KV 兜底存储 + `config:oss`/`config:api-token` 等配置 + OCR token 缓存），见 `wrangler.toml`
- D1 数据库 `hireflow-store` 绑定名 `DB`（jsonBlob / inbox / candidates 的存储后端）——Pages 项目的 D1 绑定需在
  Cloudflare Dashboard → Pages → hireflow-store-api → Settings → Bindings 配置
  （或 API `PATCH /accounts/{account_id}/pages/projects/hireflow-store-api` 的
  `deployment_configs.{production,preview}.d1_databases`），`wrangler.toml` 中的声明仅供本地开发
- R2 bucket `hireflow-files` 绑定名 `BUCKET`（files 附件存储，待开通，同上通过 API 配置）

D1 表结构变更通过 `migrations/` 下 SQL 文件执行：
```bash
npx wrangler d1 execute hireflow-store --remote --file migrations/0001_candidates.sql
```

## 配置云 OCR（百度智能云）

前端扫描件 OCR 顺序为：视觉大模型（用户自配）→ 云 OCR（本代理）→ 本地 Tesseract。
云 OCR 识别率远高于本地 Tesseract；**未配置密钥时接口返回 501，前端自动回退本地识别，不影响使用**。

### 1. 领取百度 OCR 密钥（有免费额度）

1. 登录 [百度智能云](https://cloud.baidu.com/)，进入「文字识别」产品并开通。
2. 通用文字识别-标准版有免费额度（约 1000 次/月）；高精度版按量计费、新用户有体验额度。
3. 在「应用列表」创建应用，得到 **API Key** 和 **Secret Key**。

### 2. 配置服务端密钥（密钥只存服务端，绝不进客户端代码）

```bash
cd worker-pages
npx wrangler pages secret put BAIDU_OCR_API_KEY --project-name=hireflow-store-api
npx wrangler pages secret put BAIDU_OCR_SECRET_KEY --project-name=hireflow-store-api
```

（也可以在 Cloudflare Dashboard → Pages → hireflow-store-api → Settings → Environment variables 中添加。）

配置后**需要重新部署一次**（`npx wrangler pages deploy ...`）让密钥生效。

### 3. 验证

```bash
curl -X POST https://hireflow-store-api.pages.dev/api/ocr \
  -H "Content-Type: application/json" \
  -d '{"image":"<一页图片的 base64>"}'
```

- 未配置密钥：`501 {"error":"cloud_ocr_not_configured"}`
- 成功：`200 {"text":"识别出的文字"}`

### 实现说明

- 前端固定调用 `https://hireflow-store-api.pages.dev/api/ocr`（前端在 GitHub Pages，属跨域绝对 URL，CORS 已放行）。
- 百度 `access_token`（有效期约 30 天）缓存在 KV（key: `baidu_ocr_token`），避免每次识别都换 token。
- 单请求体上限 4MB；前端逐页发送 scale 2.5、质量 0.92 的 JPEG base64，正常 <1MB。
