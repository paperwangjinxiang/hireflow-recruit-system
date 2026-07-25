# hireflow-store-api（Cloudflare Pages Functions）

教师招聘系统的云存储与云 OCR 后端，部署为 Cloudflare Pages 项目 `hireflow-store-api`。

- `functions/api/jsonBlob/` — JSONBlob 兼容的存储（团队共享数据，**D1**）
- `functions/api/inbox/` — 在线投递箱（D1 原子 INSERT；`POST` 投递、`GET` 拉取、`POST /consume` 删除已入库条目）
- `functions/api/ocr/` — 云 OCR 代理（百度通用文字识别-高精度版，可选，token 仍缓存于 KV）

## 部署

```bash
cd worker-pages
npx wrangler pages deploy public --project-name=hireflow-store-api
```

绑定：
- KV 命名空间 `BLOBS`（仅供 OCR token 缓存使用），见 `wrangler.toml`
- D1 数据库 `hireflow-store` 绑定名 `DB`（jsonBlob / inbox 的存储后端）——Pages 项目的 D1 绑定需在
  Cloudflare Dashboard → Pages → hireflow-store-api → Settings → Bindings 配置
  （或 API `PATCH /accounts/{account_id}/pages/projects/hireflow-store-api` 的
  `deployment_configs.{production,preview}.d1_databases`），`wrangler.toml` 中的声明仅供本地开发

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
