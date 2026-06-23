# Easel

Easel 是一个面向 Codex 的本地**无限画布 AI 图像创作工作站**，基于 [tldraw](https://github.com/tldraw/tldraw)。在画布上**直接点按钮生成图片**、做图生图编辑、出变体、对比迭代，全部用你自己的图像接口（BYOK，多 provider）。Codex agent 也能读取并驱动画布。画布数据保存在当前项目目录的 `canvas/`，不写进插件仓库。

English: [README.en.md](README.en.md)

## 功能

- 画布右上角 **Inspector 面板**：输入提示词、选比例、点"生成"或"4 变体"，结果作为干净图卡落到画布（可自由移动/缩放，不裁切）。
- **图生图编辑**：选中一张图，输入修改描述，走 `/images/edits` 真·图生图，结果放在原图旁、最大限度保留原图。
- **BYOK 多 provider**：自带 OpenAI 兼容接口的 key 即用，不依赖订阅额度。
- **生图能力下沉到本地服务**：画布按钮直接出图，不必走聊天；Codex agent 通过 MCP 工具作为第二入口。
- 画布与图片资源**本地持久化**，实时热刷新。

## 安装

```bash
mkdir -p ~/plugins
git clone <your-repo-url> ~/plugins/easel
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

1. 在 Codex 中说 “Open the Easel canvas for this project.”，默认地址 `http://127.0.0.1:43219/`。
2. 右上角 Inspector 面板：写提示词 → 选比例 → 点 **生成** / **4 变体**。
3. 想改某张图：在画布选中它 → 在"图生图"框写修改要求 → 点 **按描述编辑选中图**。
4. 也可以让 Codex agent 用 MCP 工具驱动（见下）。

## MCP 工具

- `get_easel_selection`：读取当前选中。
- `generate_easel_image`：按 `ratio`/`size` 生成并作为图卡插入画布（`placeBesideSelection` 放在选中项旁）。
- `edit_easel_image`：对选中图做真·图生图，结果放在原图旁。

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
