# Easel 上手指南（小白版）

Easel 是一个跑在你电脑本地的「无限画布 AI 图像工作站」：在画布上点按钮就能用 AI 出图、改图、出变体、局部重绘，用的是**你自己的图像 API key**。

下面照着做，5 分钟跑起来。命令以 **Windows（PowerShell）** 为主，macOS/Linux 的写法在每步后面附注。

---

## 0. 先准备两样东西

1. **Node.js 20 以上**。终端里输 `node --version` 能看到版本号就行（看不到就去 nodejs.org 装）。
2. **一个 OpenAI 兼容的图像 API key**（例如 g-aisc）。形如 `sk-xxxxxxxx`。Easel 默认接口是 `https://sub.g-aisc.com/v1`、默认模型 `gpt-image-2`。

> 没有 key 也能打开画布，但点「生成」会报错，因为 AI 出图要用你的 key。

---

## 1. 拿到代码并安装

```powershell
git clone https://github.com/lazypay/easel.git "$HOME\plugins\easel"
cd "$HOME\plugins\easel"
npm install
```

> macOS/Linux：`git clone https://github.com/lazypay/easel.git ~/plugins/easel && cd ~/plugins/easel && npm install`

---

## 2. 设置你的 API key（只需一次）

```powershell
setx EASEL_IMAGE_API_KEY "你的_API_KEY"
# 可选（用别的接口/模型时才需要）：
setx EASEL_IMAGE_BASE_URL "https://sub.g-aisc.com/v1"
setx EASEL_IMAGE_MODEL "gpt-image-2"
```

设完**关掉这个 PowerShell 窗口、重新开一个**（`setx` 要新窗口才生效）。

> macOS/Linux：把 `export EASEL_IMAGE_API_KEY="你的_API_KEY"` 加到 `~/.zshrc`，再 `source ~/.zshrc`。
>
> 安全提示：key 不要发给别人、不要提交进 Git。

---

## 3. 启动画布

```powershell
pwsh -File "$HOME\plugins\easel\scripts\start-canvas.ps1" "$HOME\我的项目"
```

把 `$HOME\我的项目` 换成你想保存画布数据的任意文件夹（数据会存到它下面的 `studio\` 里）。

> macOS/Linux：`~/plugins/easel/scripts/start-canvas.sh ~/我的项目`
>
> 或者最简单：在 easel 目录里直接 `npm run dev`。

终端会打印一行地址，浏览器打开它（默认）：

```
http://127.0.0.1:43219/
```

---

## 4. 开始用（右上角的「Easel 图像工作站」面板）

**新建图片**
- 在「新建图片」框写描述（提示词），选一个比例（1:1 / 16:9 / 9:16 …），点 **生成**。
- 点 **4 变体** 一次出 4 张对比。
- 点预设（电商主图 / 竖版海报 / 头像 …）会自动填模板 + 设好比例。
- 想一次出很多张不同的：每行写一句，点 **批量生成（每行一句）**。

**改一张已有的图**（先在画布点选中它）
- **重生成(替换)**：用它的提示词重出一张、原地替换。
- **出变体**：在它右边再出一张，并连一条来源箭头。
- **按描述编辑(图生图)**：写「把背景换成蓝天，其余不变」这类，AI 基于原图改，结果放右边。
- **导出 PNG** / **删除**。

**局部重绘（只改一块）**
1. 选中那张图；
2. 用工具栏的矩形工具，在图上**画一个框**圈住要改的区域；
3. **同时选中图片和这个框**（框选或按住 Shift 点）；
4. 在「局部重绘」框写要改成什么，点 **局部重绘**。只有框内会被重画，框外像素原样保留。

> 也可以画好框、连同图片一起选中后，直接跟 Codex 说「把框里改成一个玩具」，让它来执行（见第 5 步）。

**拼版导出**：按住 Shift 多选 2 张以上图，点 **拼版导出 PNG**，合成一张网格大图下载。

**拖入/粘贴外部图**：把本地图片**拖进画布**，或复制图片后 **Ctrl+V**，就能加进来当参考图，然后对它做图生图/局部重绘。

---

## 5. 在 Codex 里对话驱动（推荐，这才用得上大模型）

把 Easel 装进 Codex（personal marketplace 加一条指向 `./plugins/easel`），然后 `codex plugin add easel@personal`，开新对话。之后你只要说人话，Codex 会补全提示词再生成；要改局部就**画个框、连图一起选中**，跟它说「把框里改成…」，它会只重画框内。详见 [README.md](README.md)。

---

## 常见问题

- **点生成报「No image API key」**：`EASEL_IMAGE_API_KEY` 没设或没生效。设好后开**新终端**重启服务；在 Codex 里用要重装插件。
- **报 401 / Invalid token**：key 不对，或 key 和接口地址不匹配（key 是 A 家的、`EASEL_IMAGE_BASE_URL` 指向 B 家）。
- **打不开 / 端口被占**：43219 被别的程序占了会直接报错。关掉占用程序，或设 `EASEL_PORT` 换端口后重启（同时记得用新端口的地址）。
- **局部重绘**：用"裁出框→重画→贴回"实现，框外像素原样保留，任何尺寸的图都行。框画得太小可能失败，画大一点即可。
- **生成有点慢**：正常。文生图几秒~几十秒，图生图/局部重绘约 30~50 秒。
- **改了 Easel 代码不生效**：浏览器直接用的话刷新页面即可；在 Codex 里用要 `codex plugin remove/add easel@personal` 重装。

---

## 数据存在哪

你启动时指定的项目文件夹下的 `studio/` 里：画布数据在 `studio/pages/<page>/easel-canvas.json`，图片在 `studio/pages/<page>/assets/`。删掉 `studio/` 就清空画布。
