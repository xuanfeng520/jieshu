# 界书 JieShu

**手机上的私人设定集** —— 在一台离线的安卓手机上，写世界观、写人设、和 AI 一起把故事演下去。

> 所有内容都保存在本机：不上传、不注册；AI 能力由你自己填的 API Key 提供。

## 功能

- **世界观**：新建 / AI 一句话生成 / AI 导入（Word、文本、PDF）/ 六要素（名称、概述、地区、货币、主要 NPC、基础规则）
- **AI 共写**：填写空白、优化文字、扩写细节；整份世界观可导出 Word（直接发给 AI 就能开玩）或 JSON（可再导入）
- **人设库**：分「用户人设」和「NPC 人设」，含外貌、性格、身材、内心、过往、特殊能力；支持 AI 一句话写人
- **对话**：世界观 × 用户人设，或用户人设 × NPC 两种开局；AI 扮演 DM 或角色，用户与 NPC 用（）写动作
- **状态面板**：货币（可自定义多级与汇率）、生命值 / 精神值等自定义数值，AI 会自己改并说明原因
- **备份**：整机备份 / 只存人设 / 只存世界观 / 只存对话，可选是否带上 API Key；AI 导入把文档变成设定
- **界面**：深色 + 金线的液态玻璃质感，全面屏适配，输入框跟随键盘上移

## 下载

最新安装包：**[JieShu-v1.5.0.apk](https://github.com/xuanfeng520/jieshu/releases/download/v1.5.0/JieShu-v1.5.0.apk)**（见 [Releases](https://github.com/xuanfeng520/jieshu/releases)）

覆盖安装即可升级，数据保留。

## 构建

需要 JDK 17 与 Android SDK（build-tools 34、platform 34）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build_apk.ps1
```

产物在 `dist\JieShu-v<版本>.apk`。签名使用 `signing\jieshu-release.jks`（不随仓库分发，请自行生成并修改脚本里的路径与密码）。

## 技术

原生 Android 壳 + 单个 WebView，界面（HTML/CSS/JS）在 `app/src/main/assets/`，无第三方前端依赖，完全离线运行；
`MainActivity.java` 负责安全区、键盘高度、文件选择、通知、快捷方式、AI 请求等原生桥。

```
app/src/main/assets/   index.html / app.js / style.css
app/src/main/java/     com.jieshu.app.MainActivity
app/src/main/res/      图标、字符串
build_apk.ps1          aapt2 → javac → d8 → zipalign → apksigner
```

## 说明

- 应用本身不联网，只有你在设置里配置了 API Key 并主动使用 AI 功能时才会请求对应服务商。
- PDF 导入只读取文字层；扫描件（图片版 PDF）读不出字，会提示改用 Word 或文本。
