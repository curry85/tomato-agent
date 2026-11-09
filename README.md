# 番茄AI农技助手 · 前端 + 后端代理

对接 Coze 智能体（bot 2133432403）的完整前端工程，零依赖，不用 npm install。

## 目录结构
```
tomato-agent/
├── server.js            # 后端代理：静态托管 + 转发 /api/chat 到 Coze SSE 流
├── start.bat            # Windows 一键启动脚本
├── .env.example         # 环境变量示例（复制为 .env 并填入 PAT）
├── public/
│   └── index.html       # 番茄主题前端（六项功能 + 聊天窗）
└── public/assets/
    └── hero-tomato.jpg  # 首页视觉图
```

## 一、配置 PAT（只需一次）

PAT 获取路径：扣子控制台 → 鉴权 → 创建 PAT（勾选 Bot 权限，有效期建议 3 个月）。

**PAT 只放在后端环境变量里，不要写进前端代码或 index.html。**

方式 A（推荐）：新建 `.env` 文件，内容照抄 `.env.example`：
```
COZE_TOKEN=pat_你的令牌
COZE_BOT_ID=2133432403
PORT=3000
```
`start.bat` 会自动读 `.env`。

方式 B：手动设环境变量再启动
- PowerShell：`$env:COZE_TOKEN="pat_你的令牌"; node server.js`
- CMD：`set COZE_TOKEN=pat_你的令牌 && node server.js`

## 二、启动

双击 `start.bat`，或者跑 `node server.js`。
浏览器打开 **http://localhost:3000** 就能看到页面。

## 三、功能说明

- 首页六个功能卡片，点哪个就给智能体发对应的问题
- 聊天窗支持 SSE 流式回复，边想边出字
- 图片上传（病虫害诊断）：点相机图标选一张叶片照片，跟着消息一起发出去
- 语音输入：点麦克风图标说话（需要 Chrome 或 Edge）
- 快捷按钮：水肥方案 / 农事提醒 / 知识测试 / 记事本

## 四、接入原理

```
浏览器 (index.html)
   │  fetch /api/chat
   ▼
server.js ── Authorization: Bearer <PAT> ──► api.coze.cn/v3/chat?stream=true
   │  SSE 流透传
   ▼
浏览器逐段渲染
```

图片以 `object_string` 跟着消息一起发。如果你后端已经接了 YOLO 识别，可以先识别完拼好文本再发给智能体。

## 五、提交仓库前检查

- 确认 `.env` 已经写进 `.gitignore`，不会被提交
- 全局搜一遍 PAT：`grep -r "pat_" .`，确认前端和仓库里没有残留密钥
- 只提交 `server.js` / `index.html` / `assets/` 这些，`.env` 不要提交

## 常见问题

- 聊天报「服务端未配置 COZE_TOKEN」→ 环境变量没设，按第一步配好再重启。
- 报「连接 Coze 失败」→ 检查 PAT 对不对、有没有过期、网络能不能访问 api.coze.cn。
