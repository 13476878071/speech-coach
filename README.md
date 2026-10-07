# Speech Coach V0.3

一个无需框架或账号的英语语流练习网页。输入一句英文，页面会优先通过服务端 AI 分析可能的重读、连读、弱读、缩读和节奏；AI 请求失败时自动使用本地规则分析。

## 本地运行

在 Windows PowerShell 中运行：

```powershell
cd D:\Project.zhe\speech-coach
$env:KIMI_API_KEY = Read-Host "Kimi API key"
node server.mjs
```

然后打开 `http://127.0.0.1:8000`。`server.mjs` 同时提供网页和 `/api/analyze` 接口；页面使用 JavaScript 模块，因此不要直接双击 `index.html`。

API Key 只放在服务端环境变量 `KIMI_API_KEY` 中。不要把 API Key 写进前端代码、README 或提交到 Git。

试试以下句子：

- `I want to go to the store.`：可看到重读与 `want to → wanna`。
- `Pick it up.`：可看到相邻词的连读线索。
- `I am going to call you.` 与 `I am going to the store.`：对比什么时候提示 `gonna`。

结果页有 `Natural` 和 `Slow` 两个 Audio Preview 按钮。它们使用浏览器内置语音合成，不需要付费 API。声音和可用性取决于浏览器及系统，并不保证遵循页面分析出的重读、弱读或连读，不能当作准确的母语发音参考。

## 文件和数据流

1. `index.html` 提供输入框和结果区域，`styles.css` 控制外观。
2. 分析链路：browser → `analysis-service.js` → `POST /api/analyze` → `server.mjs` → Kimi K2.6 → AI annotation → server assembly → `AnalysisResult` → `app.js`。服务端校验 AI 注释，并组装句子、词语位置和最终结果；`app.js` 将结果显示在页面上。
3. AI 请求失败或返回无效结果时，`analysis-service.js` 自动 fallback 到 `analyzer.js` 的本地分析。它同样产生词语位置、三级重读、弱读、缩读、连读、节奏和解释。
4. `audio.js` 负责浏览器语音预览，与分析结果分开。以后如使用生成音频，可以替换这一层。

当前服务端 Kimi 配置：model 为 `kimi-k2.6`，thinking 为 `disabled`，`max_tokens` 为 `2048`，AI 请求 timeout 为 120 秒。

`stress` 有 `primary`（主要重读）、`secondary`（次要重读）和 `unstressed`（不重读）三个值。所有提示都指向句子里的词语位置，页面不必从一段文字中猜测该标记哪个词。

## 当前边界

AI 分析是语流练习提示，具体重读和连读仍取决于语境与说话人。fallback 使用的本地规则只提供学习线索，并不能真正理解说话人的意图；连读提示尤其是基于拼写的粗略判断。若要让音频严格匹配页面分析结果，还需要额外的音频生成方案。
