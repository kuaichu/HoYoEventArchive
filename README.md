# 米游活动档案馆 (HoYo Event Archive)

米游活动档案馆是一个致力于收录、展示并监测米哈游（miHoYo / HoYoverse）旗下游戏历年网页活动、年度数据报告、限时回归活动与纪念册页面的非官方公益项目。项目支持原神、崩坏：星穹铁道、绝区零和崩坏3四款主流游戏。

---

## 🌟 核心功能 (Core Features)

1. **游戏专题区 (Game Portals)**
   * 采用类似 Steam/PlayStation Store 游戏库的 **250px 纵向精致磁贴设计**。
   * 使用官方超清透明 PNG 标志（Game Logo），并在背景设计了游戏专属的主题微光径向渐变聚光灯（原神：金黄，星铁：靛紫，绝区零：黄绿，崩坏3：粉紫）。
   * 自适应不同比例的标志缩放，防裁剪，Hover 触发平滑上浮和光效膨胀动效。

2. **自动米游社活动爬虫 (Automated Scraper)**
   * 独立的 Node.js 命令行脚本（[miyoushe-crawler.js](file:///s:/Projects/Active/HoYo%20Event%20Archive/scripts/miyoushe-crawler.js)），基于 Puppeteer 无头浏览器。
   * 自动爬取并去重米游社对应游戏的“公告”、“活动”和“资讯”板块。
   * 解析新闻详情，提取包含的 H5 网页链接，并利用 Puppeteer 动态加载解析页面 Meta 标签以自动获取活动标题、描述和关联版本，智能归档入库。

3. **多维筛选与智能搜索 (Advanced Filtering & Search)**
   * 支持按游戏种类、活动类型（年度报告、回归活动、预约/预抽卡、小游戏等）以及可用状态（可访问、已失效、需登录、已结束）进行交叉筛选。
   * 内置实时输入模糊搜索，并在 Banner 底部提供热门搜索标签快捷引导。

4. **网页可用性状态自动监测 (Link Status Checker)**
   * 提供 [update-statuses.js](file:///s:/Projects/Active/HoYo%20Event%20Archive/scripts/update-statuses.js) 定期检测脚本。
   * 发起 HTTP 请求探测网页可用状态，智能判定并标记“可访问（正常）”、“已失效（404等）”、“需登录（重定向至登录页）”及“已结束”。

5. **前后端解耦的独立管理后台 (Standalone Admin Panel)**
   * 将高权限管理功能完全迁移至独立的 [admin.html](file:///s:/Projects/Active/HoYo%20Event%20Archive/admin.html)（`/admin`）。
   * 面向管理员提供可视化 CRUD（增删改查）界面、一键导出最新 `events.json` 数据库，以及清空/重置 localStorage 初始状态的功能。

6. **本地收藏夹 (Personal Bookmarks)**
   * 采用浏览器 LocalStorage 实现纯前端持久化收藏功能，用户可以收藏喜爱的年度报告或绝版活动网页。

---

## 🛠️ 技术栈 (Technology Stack)

* **核心前端**: HTML5 语义化标签、JavaScript (ES Modules 规范)
* **样式系统**: 原生 CSS3，全面引入 CSS 自定义变量设计系统，适配深色科技感玻璃拟态（Glassmorphism）与微动效。
* **构建/打包**: Vite
* **脚本/自动化**: Node.js, Puppeteer (Headless Chrome)

---

## 🚀 快速上手 (Quick Start)

### 1. 克隆与安装依赖
首先克隆本项目到本地，并在项目根目录下安装所需的开发依赖（主要是 Puppeteer）：
```bash
npm install
```

### 2. 运行本地开发服务器
运行以下命令开启热更新开发服务器：
```bash
npm run dev
```
打开浏览器访问控制台输出的本地地址（通常为 `http://localhost:5173/`）。

* 访问首页: `http://localhost:5173/`
* 访问管理后台: `http://localhost:5173/admin.html`

### 3. 项目打包构建
如果需要生成用于静态服务器部署的生产包，运行：
```bash
npm run build
```
打包产物将输出在 `dist/` 目录中。

---

## 📁 实用维护脚本 (Maintenance Scripts)

项目在 [scripts/](file:///s:/Projects/Active/HoYo%20Event%20Archive/scripts/) 目录下提供了一系列易于执行的自动化维护脚本：

* **米游社网页爬虫**：
  ```bash
  node scripts/miyoushe-crawler.js
  ```
  执行后会自动扫描米游社官网，获取最新的官方活动信息，更新数据库。
  
* **活动链接状态检测**：
  ```bash
  node scripts/update-statuses.js
  ```
  定期执行该脚本，可以检测归档链接是否已经不可访问，避免用户踩坑失效网页。
  
* **官方封面标志下载**：
  ```bash
  node scripts/download-official-covers.js
  ```
  一键重新从 miHoYo 官方 CDN 下载各游戏官方透明 PNG 高精标志与最新静态资产。

* **生成网页截图封面**：
  ```bash
  node scripts/capture-screenshots.js
  ```
  读取活动数据库，利用 Puppeteer 对有效的活动进行长网页截图，保存至 `public/images/screenshots/` 目录作为卡片预览图。

---

## 📄 版权声明 (Disclaimer)

1. 本项目为非官方、公益性的个人二创整理项目。
2. 项目所收录的所有网页活动链接、背景图片、美术素材、角色设计以及商标版权，均归属于 **米哈游（miHoYo）**。
3. 本项目仅作学习交流与信息整理之用，严禁任何商业用途。
