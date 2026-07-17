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
   * 分页扫描米游社四款游戏论坛，规范化并去重官方活动 URL；单个来源或页面失败会降级继续，全部来源失败时任务以失败退出。
   * 解析新闻详情，提取包含的 H5 网页链接，并利用 Puppeteer 动态加载解析页面 Meta 标签以自动获取活动标题、描述和关联版本，智能归档入库。

3. **多维筛选与智能搜索 (Advanced Filtering & Search)**
   * 支持按游戏种类、活动类型（年度报告、回归活动、版本前瞻、预约/预抽卡、小游戏等）以及可用状态（可访问、已失效、需登录、已结束）进行交叉筛选。
   * 内置实时输入模糊搜索，并在 Banner 底部提供热门搜索标签快捷引导。

4. **状态数据校验与生命周期更新 (Status Validation)**
   * 提供 [update-statuses.js](file:///s:/Projects/Active/HoYo%20Event%20Archive/scripts/update-statuses.js) 确定性更新脚本。
   * `date` 仅表示展示或公告日期；只有活动提供明确且已过期的 `endDate` 时，脚本才自动标记“已结束”。网页连通性、登录要求和失效状态不再根据活动年龄猜测。
   * 全量事件会在测试和自动提交前检查必填字段、枚举、日期、URL 以及 ID/URL 唯一性。

5. **独立本地管理工具 (Standalone Local Admin Tool)**
   * [admin.html](file:///s:/Projects/Active/HoYo%20Event%20Archive/admin.html) 是纯浏览器本地编辑工具，不具有服务端或仓库写权限。
   * 编辑使用带版本的 localStorage overlay：内置记录保存字段补丁、删除保存 tombstone、自定义记录单独保存；刷新后仍会保留修改，同时能接收仓库新增记录。
   * 支持一键导出合并后的 `events.json`，由维护者审核后替换仓库数据。

6. **本地收藏夹 (Personal Bookmarks)**
   * 采用浏览器 LocalStorage 实现纯前端持久化收藏功能，用户可以收藏喜爱的年度报告或绝版活动网页。

---

## 🛠️ 技术栈 (Technology Stack)

* **核心前端**: HTML5 语义化标签、JavaScript (ES Modules 规范)
* **样式系统**: 原生 CSS3，全面引入 CSS 自定义变量设计系统，适配深色科技感玻璃拟态（Glassmorphism）与微动效。
* **构建/打包**: Vite
* **脚本/自动化**: Node.js 24, Puppeteer (Headless Chrome), GitHub Actions

---

## 🚀 快速上手 (Quick Start)

### 1. 克隆与安装依赖
首先安装 Node.js 24，克隆项目并按锁文件安装依赖：
```bash
npm ci
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

### 4. 运行测试
```bash
npm test
```
测试覆盖爬虫规则、事件数据契约、生命周期状态、自动化失败边界、本地编辑 overlay 以及 HTML/URL 安全规则。

---

## 📁 实用维护脚本 (Maintenance Scripts)

项目在 [scripts/](file:///s:/Projects/Active/HoYo%20Event%20Archive/scripts/) 目录下提供了一系列易于执行的自动化维护脚本：

* **米游社网页爬虫**：
  ```bash
  node scripts/miyoushe-crawler.js
  ```
  执行后会自动扫描米游社官网，获取最新的官方活动信息，更新数据库。
  
* **活动生命周期状态更新**：
  ```bash
  node scripts/update-statuses.js
  ```
  根据明确的 `endDate` 更新生命周期状态；不会从公告日期或活动年龄推断网页是否失效。
  
* **官方封面标志下载**：
  ```bash
  node scripts/download-official-covers.js
  ```
  一键重新从 miHoYo 官方 CDN 下载各游戏官方透明 PNG 高精标志与最新静态资产。

* **生成网页截图封面**：
  ```bash
  node scripts/capture-screenshots.js
  ```
  读取活动数据库，利用 Puppeteer 为缺失预览图的非失效活动生成 1024×576 缩略图，保存至 `public/images/screenshots/`。

自动维护工作流会在生成数据后运行完整测试和生产构建，只有验证成功才提交到 `main`。Cloudflare Pages 的构建与部署统一由 `.github/workflows/deploy-pages.yml` 执行。

---

## 📄 版权声明 (Disclaimer)

1. 本项目为非官方、公益性的个人二创整理项目。
2. 项目所收录的所有网页活动链接、背景图片、美术素材、角色设计以及商标版权，均归属于 **米哈游（miHoYo）**。
3. 本项目仅作学习交流与信息整理之用，严禁任何商业用途。
