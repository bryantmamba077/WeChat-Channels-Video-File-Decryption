# WeChat Channels Video Decryption API Service

基于 Playwright 浏览器自动化的 WeChat 视频解密 API 服务

## 概述

本项目提供 RESTful API 接口，用于解密 WeChat Channels 加密视频文件。通过 Playwright 在真实浏览器环境中执行微信官方 WASM 模块，实现 **100% 兼容性**。

### 核心特性

- **完美兼容**: 在真实 Chromium 浏览器中执行微信官方 WASM v1.2.46
- **RPC 架构**: Node.js 通过 Playwright 调用浏览器环境中的解密函数
- **RESTful API**: 标准的 HTTP 接口，易于集成
- **Docker 支持**: 开箱即用的容器化部署
- **健康检查**: 内置服务健康监控
- **大文件支持**: 最大支持 500MB 视频文件

## 如何获取 decode_key？（常见问题）

> 对应 issue #1 / #9。**本仓库只负责解密，不负责抓取微信接口。**

`decode_key` 和加密视频 URL 都来自**微信原始接口的响应 JSON**，结构如下：

```json
{
  "data": {
    "object_desc": {
      "media": [{
        "decode_key": "2136343393",   // 解密种子（即本服务的 decode_key）
        "url": "https://...",          // 加密视频下载链接
        "file_size": 14088528
      }]
    }
  }
}
```

获取途径（任选其一）：

1. **第三方接口**：例如 `api.tikhub.io` 的视频号详情接口，响应直接包含
   `decode_key` 与加密视频 URL。
2. **自行抓包**：在 PC 端微信安装 SSL 证书抓包，打开视频号并搜索关键字，
   即可在接口响应 JSON 中找到 `decode_key` 和对应加密视频 URL。
   > 注意：微信部分流量走私有协议 mmtls，普通 HTTPS 抓包不一定能拿到，需视
   > 客户端版本与抓包方案而定。

拿到 `decode_key` 和加密视频文件后，再调用本服务 `POST /api/decrypt` 解密。

## 架构说明

```
┌─────────────────────────────────────────────────────┐
│                   Client Request                     │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│              Express.js API Server                   │
│  (Node.js + Multer + CORS)                          │
└───────────────────┬─────────────────────────────────┘
                    │ ① RPC：仅生成 128KB 密钥流
                    │   page.evaluate(generateKeystream)
                    ▼
┌─────────────────────────────────────────────────────┐
│           Playwright Chromium Browser                │
│  ┌───────────────────────────────────────────┐      │
│  │          worker.html                       │      │
│  │  ┌─────────────────────────────────┐      │      │
│  │  │  WeChat WASM Module v1.2.46     │      │      │
│  │  │  (Isaac64 PRNG Algorithm)       │      │      │
│  │  └─────────────────────────────────┘      │      │
│  │                                            │      │
│  │  RPC Functions:                            │      │
│  │  - generateKeystream(decodeKey)  ← 唯一职责 │      │
│  │  - checkWasmStatus()                       │      │
│  └───────────────────────────────────────────┘      │
└───────────────────┬─────────────────────────────────┘
                    │ ② 返回 128KB 密钥流
                    ▼
┌─────────────────────────────────────────────────────┐
│   ③ Node.js 端 XOR 解密（lib/decrypt.js）           │
│   视频整段 Buffer 不进浏览器 → 规避 CDP 100MB 上限   │
└─────────────────────────────────────────────────────┘
```

> **v2.1 架构变更（修复大文件解密崩溃）**：旧版把整段视频经 CDP 管道
> 传入浏览器做 XOR，base64 膨胀后超过 Chromium DevTools 协议 100MB 单条
> 消息上限，导致 80MB+ 文件解密时页面崩溃（issue #4 / #6 / #8）。现在
> 浏览器只负责生成 128KB 密钥流，XOR 解密改在 Node.js 端用 Buffer 完成，
> 文件大小不再受此限制。

### 为什么选择 Playwright?

WeChat 的 WASM 模块依赖浏览器特定的 API (`fetch`, `self`, `window` 等)，无法直接在 Node.js 环境中运行。Playwright 方案的优势：

1. **完美兼容**: 在真实浏览器中运行，避免环境模拟的兼容性问题
2. **本地优先**: 内置 WASM 文件，优先使用本地加载（速度更快，离线可用）
3. **智能降级**: 本地文件加载失败时自动切换到微信 CDN
4. **可维护性**: 微信更新 WASM 版本时，更新 wechat_files 文件夹即可
5. **稳定性**: 浏览器环境确保 WASM 按预期运行

性能权衡: 虽然通过浏览器调用会增加一些开销，但换来的是完美的兼容性和稳定性。

## 📖 API 文档页面

启动服务后，访问 **http://localhost:3000** 可查看完整的交互式 API 文档，包含：

- 📊 **实时服务状态** - WASM 模块健康检查和服务信息
- 🔌 **完整 API 端点** - 所有接口的详细说明和参数
- 💡 **代码示例** - Python、JavaScript/Node.js 等多种语言
- 🎨 **美观界面** - 渐变色设计、代码高亮、响应式布局

**或使用 JSON 格式查看服务信息：**
```bash
curl http://localhost:3000/api/info
```

## 快速开始

### 方式 1: Docker 部署 (推荐)

```bash
# 1. 构建并启动服务
docker-compose up -d

# 2. 查看日志
docker-compose logs -f

# 3. 健康检查
curl http://localhost:3000/health

# 4. 停止服务
docker-compose down
```

### 方式 2: 本地开发

#### 前置要求

- Node.js >= 16.0.0
- npm >= 7.0.0

#### 安装步骤

```bash
# 1. 安装依赖
npm install

# 2. 安装 Playwright 浏览器
npm run install-browsers

# 3. 启动服务
npm start

# 开发模式 (热重载)
npm run dev
```

服务将在 `http://localhost:3000` 启动。

## API 文档

### 1. 服务信息

```http
GET /
```

返回服务的基本信息和可用端点列表。

**响应示例:**
```json
{
  "service": "WeChat Channels Video Decryption API",
  "version": "2.1.0",
  "engine": "Playwright + Chromium",
  "author": "Evil0ctal",
  "endpoints": {
    "health": "GET /health",
    "decrypt": "POST /api/decrypt",
    "keystream": "POST /api/keystream"
  }
}
```

### 2. 健康检查

```http
GET /health
```

检查服务和 WASM 模块的状态。

**响应示例:**
```json
{
  "status": "ok",
  "service": "wechat-decrypt-api",
  "version": "2.1.0",
  "engine": "playwright",
  "wasm": {
    "loaded": true,
    "timestamp": "2024-01-15T10:30:00.000Z"
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 3. 生成密钥流

```http
POST /api/keystream
Content-Type: application/json
```

**请求体:**
```json
{
  "decode_key": "123456789",
  "format": "hex"
}
```

**参数说明:**
- `decode_key` (必需): 解密密钥，字符串或数字
- `format` (可选): 输出格式，`hex` 或 `base64`，默认 `hex`

**响应示例:**
```json
{
  "decode_key": "123456789",
  "keystream": "a1b2c3d4e5f6...",
  "format": "hex",
  "size": 131072,
  "duration_ms": 45,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**cURL 示例:**
```bash
curl -X POST http://localhost:3000/api/keystream \
  -H "Content-Type: application/json" \
  -d '{"decode_key": "123456789", "format": "hex"}'
```

### 4. 解密视频

```http
POST /api/decrypt
Content-Type: multipart/form-data
```

**表单参数:**
- `decode_key`: 解密密钥 (form field)
- `video`: 加密的视频文件 (file upload)

**响应:**
- Content-Type: `video/mp4`
- 返回解密后的 MP4 视频文件

**cURL 示例:**
```bash
curl -X POST http://localhost:3000/api/decrypt \
  -F "decode_key=123456789" \
  -F "video=@encrypted_video.mp4" \
  -o decrypted_video.mp4
```

**响应头:**
```
Content-Type: video/mp4
Content-Length: 12345678
Content-Disposition: attachment; filename="decrypted_1705315800000.mp4"
X-Decrypt-Duration: 1234
```

**错误响应:**
```json
{
  "error": "解密失败：未找到 MP4 ftyp 签名，请检查 decode_key"
}
```

## 使用示例

### Python 示例

```python
import requests

# 解密视频
with open('encrypted_video.mp4', 'rb') as f:
    files = {'video': f}
    data = {'decode_key': '123456789'}

    response = requests.post(
        'http://localhost:3000/api/decrypt',
        files=files,
        data=data
    )

    if response.status_code == 200:
        with open('decrypted.mp4', 'wb') as out:
            out.write(response.content)
        print('解密成功!')
    else:
        print(f'解密失败: {response.json()}')

# 生成密钥流
response = requests.post(
    'http://localhost:3000/api/keystream',
    json={'decode_key': '123456789', 'format': 'hex'}
)
print(response.json())
```

### JavaScript/Node.js 示例

```javascript
const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

// 解密视频
async function decryptVideo() {
  const form = new FormData();
  form.append('decode_key', '123456789');
  form.append('video', fs.createReadStream('encrypted_video.mp4'));

  const response = await axios.post(
    'http://localhost:3000/api/decrypt',
    form,
    {
      headers: form.getHeaders(),
      responseType: 'stream'
    }
  );

  response.data.pipe(fs.createWriteStream('decrypted.mp4'));
}

// 生成密钥流
async function generateKeystream() {
  const response = await axios.post(
    'http://localhost:3000/api/keystream',
    {
      decode_key: '123456789',
      format: 'hex'
    }
  );

  console.log(response.data);
}
```

## Docker 配置

### 资源限制

在 `docker-compose.yml` 中配置的默认资源限制:

```yaml
deploy:
  resources:
    limits:
      cpus: '2'
      memory: 2G
    reservations:
      cpus: '1'
      memory: 512M
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `NODE_ENV` | Node.js 环境 | `production` |

### 共享内存

Chromium 需要足够的共享内存，已在 docker-compose.yml 中配置:

```yaml
shm_size: '2gb'
```

## 技术栈

- **Node.js**: JavaScript 运行时
- **Express**: Web 框架
- **Playwright**: 浏览器自动化
- **Multer**: 文件上传处理
- **CORS**: 跨域资源共享
- **Docker**: 容器化部署

## 文件结构

```
api-service/
├── server.js              # Express API 服务器
├── worker.html            # RPC Worker 页面 (包含 WASM)
├── docs.html              # 交互式 API 文档页面
├── package.json           # 项目依赖
├── Dockerfile             # Docker 镜像构建
├── docker-compose.yml     # Docker Compose 配置
├── .dockerignore          # Docker 忽略文件
├── .gitignore             # Git 忽略文件
└── README.md              # 本文档
```

## 工作原理

### 1. WASM 模块加载 (本地优先 + CDN 降级)

`worker.html` 实现了智能的双重加载机制:

```html
<script>
    // 优先使用本地文件
    window.VTS_WASM_URL = 'wechat_files/wasm_video_decode.wasm';

    // CDN 备份
    window.VTS_WASM_CDN_URL = "https://aladin.wxqcloud.qq.com/aladin/ffmepeg/video-decode/1.2.46/wasm_video_decode.wasm";

    // 错误处理：本地加载失败时自动切换到 CDN
    function handleWasmScriptError() {
        console.warn('本地 WASM JS 加载失败，切换到微信 CDN...');
        window.WASM_USING_CDN = true;
        // ... 动态加载 CDN 脚本
    }
</script>

<!-- 优先尝试本地文件 -->
<script src="wechat_files/wasm_video_decode.js" onerror="handleWasmScriptError()"></script>
```

**优点:**
- ⚡ 本地加载速度更快（无网络延迟）
- 🔒 离线环境也能工作
- 🛡️ 降低对外部 CDN 的依赖
- ♻️ 自动降级保证可用性

### 2. HTTP 服务与 RPC 调用

Express 服务器提供三个关键端点：

```javascript
// 1. 静态文件服务 - 提供 WASM 文件
app.use('/wechat_files', express.static(path.join(__dirname, 'wechat_files')));

// 2. Worker HTML 页面
app.get('/worker.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'worker.html'));
});

// 3. Playwright 通过 HTTP 加载 worker（支持本地文件加载）
const workerUrl = `http://localhost:${PORT}/worker.html`;
await page.goto(workerUrl);
```

RPC 调用浏览器函数：

```javascript
// 在 Node.js 中调用浏览器中的函数
const keystreamBase64 = await page.evaluate(async (key) => {
    return await window.generateKeystream(key);
}, decode_key);
```

**关键**: 使用 `http://` 而非 `file://` 协议，避免浏览器 CORS 限制，使本地 WASM 文件加载成功。

### 3. 数据传输（v2.1：视频不进浏览器）

浏览器与 Node.js 之间**只传输 128KB 密钥流**，加密视频本身始终留在 Node.js 端：

```javascript
// Browser → Node.js：仅密钥流（base64，约 175KB，远小于 CDP 100MB 上限）
const keystreamBase64 = await page.evaluate(
    async (key) => await window.generateKeystream(key),
    decode_key
);
const keystream = Buffer.from(keystreamBase64, 'base64');
```

> 旧版会把整段视频 `toString('base64')` 传入浏览器，80MB 文件膨胀到约
> 107MB，超过 CDP 管道 100MB 上限而导致页面崩溃。v2.1 不再传输视频数据。

### 4. Isaac64 密钥流生成

WASM 模块实现了微信魔改的 Isaac64 算法:

```javascript
window.wasm_isaac_generate = function(ptr, size) {
    keystreamData = new Uint8Array(size);
    const wasmArray = new Uint8Array(Module.HEAPU8.buffer, ptr, size);
    keystreamData.set(Array.from(wasmArray).reverse()); // 必须反转!
};
```

**重要**: 密钥流必须反转 (`reverse()`) 才能正确解密，这是微信特有的实现细节。

### 5. XOR 解密（v2.1：Node.js 端执行）

微信仅加密文件**前 128KB**，其余为明文。XOR 解密在 Node.js 端用 Buffer 完成
（`lib/decrypt.js` 的 `decryptBuffer`），无需把视频送进浏览器：

```javascript
function decryptBuffer(encrypted, keystream) {
    const decrypted = Buffer.from(encrypted); // 明文部分原样保留
    const decryptLen = Math.min(KEYSTREAM_SIZE, encrypted.length, keystream.length);
    for (let i = 0; i < decryptLen; i++) {
        decrypted[i] = encrypted[i] ^ keystream[i];
    }
    return decrypted;
}
```

该逻辑与 Python CLI（`decrypt_wechat_video_cli.py`）字节级一致，并有单元测试
（`npm test`）覆盖含 120MB 大文件在内的边界场景。

## 故障排除

### 问题: WASM 模块加载超时

**症状**:
```json
{"status": "error", "error": "WASM 模块加载超时"}
```

**解决方案**:
1. 检查网络连接，确保能访问微信 CDN
2. 增加超时时间 (server.js:58)
3. 检查 Playwright 浏览器是否正确安装

### 问题: Docker 容器启动失败

**症状**: 容器持续重启

**解决方案**:
```bash
# 查看详细日志
docker-compose logs -f

# 检查浏览器安装
docker-compose exec wechat-decrypt-api npx playwright --version

# 重新构建镜像
docker-compose build --no-cache
```

### 问题: 解密后的视频无法播放

**症状**: API 返回文件但无法播放

**原因**: `decode_key` 不正确

**解决方案**:
1. 确认 decode_key 与加密视频匹配
2. 检查 API 响应中的错误信息
3. 验证解密文件的前 12 字节应为: `00 00 00 XX 66 74 79 70` (MP4 签名)

### 问题: 大文件（80MB+）解密报错 "Target page... has been closed"

**症状**（issue #4 / #6 / #8）:
```
page.evaluate: Target page, context or browser has been closed
Too large read data is pending: capacity=104857600 ...
```

**原因**: 旧版（≤ v2.0）把整段视频经 CDP 管道传入浏览器做 XOR，base64 膨胀后
超过 Chromium DevTools 协议 100MB 单条消息上限，导致页面崩溃。

**解决方案**: 升级到 **v2.1+**。XOR 解密已移至 Node.js 端，浏览器只生成 128KB
密钥流，文件大小不再受此限制（仅受 multer 500MB 与服务器内存约束）。

### 问题: 文件上传失败 (413 错误)

**症状**:
```json
{"error": "文件过大", "limit": "500MB"}
```

**解决方案**:
修改 server.js:23 中的文件大小限制:
```javascript
limits: { fileSize: 500 * 1024 * 1024 } // 500MB
```

## 性能优化建议

### 1. 复用浏览器实例

当前实现已自动复用浏览器实例，避免每次请求都启动新浏览器。

### 2. 调整资源限制

根据服务器配置调整 docker-compose.yml 中的资源限制:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'      # 增加 CPU 限制
      memory: 4G     # 增加内存限制
```

### 3. 密钥流缓存（v2.1 已内置）

相同 `decode_key` 的密钥流恒定，服务端已内置 LRU 缓存：命中后跳过浏览器 WASM
调用（并发接口连页面池都不占用）。缓存上限可通过环境变量 `KEYSTREAM_CACHE_MAX`
配置（默认 100）。

### 4. 负载均衡

对于高并发场景，可部署多个服务实例并使用负载均衡器。

## 安全建议

1. **API 认证**: 在生产环境中添加 API 密钥认证
2. **速率限制**: 使用 express-rate-limit 限制请求频率
3. **HTTPS**: 使用反向代理 (Nginx/Caddy) 提供 HTTPS 支持
4. **文件验证**: 验证上传文件的类型和内容
5. **日志审计**: 记录所有 API 请求用于审计

## 许可证

MIT License - 详见项目根目录 LICENSE 文件

## 作者

Evil0ctal - evil0ctal1985@gmail.com

## 相关链接

- GitHub: https://github.com/Evil0ctal/WeChat-Channels-Video-File-Decryption
- Playwright: https://playwright.dev/
- WeChat WASM: https://aladin.wxqcloud.qq.com/aladin/ffmepeg/video-decode/1.2.46/

## 更新日志

### v2.1.0 (2026-06-09)
- **修复大文件解密崩溃**（issue #4 / #6 / #8）：XOR 解密从浏览器移至 Node.js 端，
  视频数据不再经 CDP 管道传输，规避 DevTools 协议 100MB 单条消息上限。80MB+ /
  100MB+ / 300MB+ 文件均可正常解密。
- **新增密钥流 LRU 缓存**：相同 `decode_key` 跳过浏览器 WASM 调用，可经
  `KEYSTREAM_CACHE_MAX` 配置上限。
- **解密核心抽离为 `lib/decrypt.js`** 并新增单元测试（`npm test`，含 120MB 边界场景）。

### v2.0.0 (2025-10-17)
- 采用 Playwright + RPC 架构
- 100% 兼容微信官方 WASM v1.2.46
- **内置 WASM 文件**: 本地优先加载，CDN 智能降级
- **HTTP 服务架构**: 避免 file:// 协议的 CORS 限制
- Docker 容器化支持（包含完整 WASM 文件）
- 健康检查和监控（显示 WASM 加载源）
- 交互式 API 文档页面
- 完整的错误处理和降级机制
