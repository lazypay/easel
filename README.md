# Easel

Easel 是一个面向 Codex 的本地**无限画布 AI 图像创作工作站**，基于 [tldraw](https://github.com/tldraw/tldraw)。在画布上**直接点按钮生成图片**、做图生图编辑、出变体、对比迭代，全部用你自己的图像接口（BYOK，多 provider）。Codex agent 也能读取并驱动画布。画布数据保存在当前项目目录的 `studio/`，不写进插件仓库。

> 🚀 新手请看 **[上手指南 GETTING-STARTED.md](GETTING-STARTED.md)**（照着做 5 分钟跑起来）。

English: [README.en.md](README.en.md)

## 功能

- 画布右上角 **Inspector 面板**：输入提示词、选比例、点"生成"或"4 变体"，结果作为干净图卡落到画布（可自由移动/缩放，不裁切）。
- **图生图编辑**：选中一张图，输入修改描述，走 `/images/edits` 真·图生图，结果放在原图旁、最大限度保留原图。
- **局部区域重绘**：在图上画矩形框住要改的地方，只重画框内、其余像素原样保留（裁→重画→回贴，不依赖被忽略的 provider mask）。
- **BYOK 多 provider**：自带 OpenAI 兼容接口的 key 即用，不依赖订阅额度。
- **生图能力下沉到本地服务**：画布按钮直接出图，不必走聊天；Codex agent 通过 MCP 工具作为第二入口。
- 画布与图片资源**本地持久化**，实时热刷新。

## 安装

```bash
mkdir -p ~/plugins
git clone https://github.com/lazypay/easel.git ~/plugins/easel
cd ~/plugins/easel
npm install
npm run build
```

确保 `~/.agents/plugins/marketplace.json` 里有 Easel 条目（`source.path` 指向 `./plugins/easel`），然后：

```bash
codex plugin add easel@personal
```

安装后建议开启一个新的 Codex 对话，让技能与 MCP 工具完整加载。

## 配置生图接口

Easel 通过一个 OpenAI 兼容的图像接口生图（默认地址 `https://sub.g-aisc.com/v1`，默认模型 `gpt-image-2`）。把 API key 设为本地环境变量即可，密钥不会写入仓库：

| 环境变量 | 说明 | 默认值 |
| --- | --- | --- |
| `EASEL_IMAGE_API_KEY` | 生图 API key（也兼容 `COWART_IMAGE_API_KEY` / `OPENAI_API_KEY`） | 无，必填 |
| `EASEL_IMAGE_BASE_URL` | OpenAI 兼容接口地址 | `https://sub.g-aisc.com/v1` |
| `EASEL_IMAGE_MODEL` | 图像模型 | `gpt-image-2` |

设置（Windows PowerShell，持久化到用户环境）：

```powershell
setx EASEL_IMAGE_API_KEY "你的_API_KEY"
# 可选
setx EASEL_IMAGE_BASE_URL "https://sub.g-aisc.com/v1"
setx EASEL_IMAGE_MODEL "gpt-image-2"
```

macOS / Linux 用 `export ... >> ~/.zshrc` 后 `source`。设置后重新加载 Codex 插件即可生效（Windows 上 Easel 也会从注册表兜底读取）。

## 使用

推荐在 Codex 里**对话驱动**——这才用得上大模型的理解、补全与迭代：

1. 让 Codex “Open the Easel canvas for this project.”（默认 `http://127.0.0.1:43219/`）。
2. 直接说想要什么。给一句话也行，Codex 会结合画布上下文把提示词补全后再生成。
3. 想**一次改多处**：用箭头/文字在图上标注（如箭头指向头发写“短发”、指向上衣写“短T”、指向手写“ipad”），连同图片一起选中，跟 Codex 说“按标注修改”。它读懂后整图改一版（`edit_easel_image`），保留人物与构图——这种"指着说"最省事、最发挥大模型。
4. 想**精修一小块**、其余绝对不动：用矩形工具画个框，连图选中，说“把框里改成…”，只重画框内（`edit_easel_region`）。
5. 右上角 Inspector 面板有「**发给 Codex 执行**」开关（默认开）：开启时点按钮不直接出图，而是把任务（连同要改的那张图 / 那个框，点击瞬间就钉死了）加入队列；你在对话里说一句"**执行画布请求**"，Codex 就补全提示词后逐条执行。关掉开关则按钮直接出图（不经过 Codex）。

## MCP 工具

- `get_easel_selection`：读取当前选中（含几何信息，供算区域）。
- `generate_easel_image`：按 `ratio`/`size` 生成并作为图卡插入画布（`placeBesideSelection` 放在选中项旁）。
- `edit_easel_image`：对选中图做整图图生图，结果放在原图旁。
- `edit_easel_region`：只重画矩形框内区域并**原地替换**（真·区域重绘，不依赖 provider mask）。
- `regenerate_easel_image`：用新生成的图原地替换选中图。
- `get_easel_requests` / `complete_easel_request`：读取 / 清除画布按钮发来的待执行队列。

## 技能

- `easel:easel-open-canvas`：打开 Easel 本地画布。
- `easel:easel-image`：通过 MCP 工具生成/编辑画布上的图片。

## 本地开发

```bash
npm install
npm run dev      # 本地服务，默认端口 43219
npm run build
```

常用环境变量：`EASEL_PORT`、`EASEL_PROJECT_DIR`、`EASEL_CANVAS_DIR`，以及上文的 `EASEL_IMAGE_*`。

## 致谢

画布能力基于 [tldraw/tldraw](https://github.com/tldraw/tldraw)。Easel 的早期实现参考了 [zhongerxin/Cowart](https://github.com/zhongerxin/Cowart) 的本地画布思路。
