# 米游活动档案馆 (HoYo Event Archive)

米游活动档案馆是一个致力于收录、展示并监测米哈游（miHoYo / HoYoverse）旗下游戏历年网页活动、年度数据报告、限时回归活动与纪念册页面的非官方公益项目。项目支持原神、崩坏：星穹铁道、绝区零和崩坏3四款主流游戏。

线上网站：[hoyo.yeque.top](https://hoyo.yeque.top/)。项目采用静态前端与离线 API 同步脚本，管理后台及其鉴权接口已移除。实现细节见[项目功能与架构文档](PROJECT_DOCUMENTATION.md)。

---

## 🌟 核心功能 (Core Features)

1. **游戏专题区 (Game Portals)**
   * 采用类似 Steam/PlayStation Store 游戏库的 **250px 纵向精致磁贴设计**。
   * 使用官方超清透明 PNG 标志（Game Logo），并在背景设计了游戏专属的主题微光径向渐变聚光灯（原神：金黄，星铁：靛紫，绝区零：黄绿，崩坏3：粉紫）。
   * 自适应不同比例的标志缩放，防裁剪，Hover 触发平滑上浮和光效膨胀动效。

2. **官方新闻 API 同步**
   * [official-news-crawler.js](scripts/official-news-crawler.js) 直接请求四款游戏官网使用的公开 JSON 接口，从公告正文提取网页活动链接、简介、明确的活动时间与奖励，并使用官方封面。
   * 不再请求米游社论坛或帖子详情，也不再用浏览器加载活动页来获取标题与简介。按规范化 URL 去重，保留人工简介和已有封面；单个游戏失败继续，其余游戏也全部失败时任务报错且保留原数据。
   * [official-news.js](scripts/official-news.js) 管理各游戏的 app/channel 配置、分页、响应大小与超时限制。`sourceNewsId` / `sourceNewsUrl` 记录官网公告来源；历史 `sourcePostId` 仅保留追溯。

3. **多维筛选与智能搜索 (Advanced Filtering & Search)**
   * 支持按游戏种类、活动类型（年度报告、回归活动、版本前瞻、预约/预抽卡、小游戏等）以及可用状态（可访问、未开始、已失效、需登录、已结束）进行交叉筛选。
   * 内置实时输入模糊搜索，并在 Banner 底部提供热门搜索标签快捷引导。

4. **状态数据校验与生命周期更新 (Status Validation)**
   * 提供 [update-statuses.js](scripts/update-statuses.js) 确定性更新脚本。
   * `date` 仅表示展示或公告日期；活动提供明确且已过期的 `endAt` 或 `endDate` 时才自动标记“已结束”，明确的未来开始时间显示“未开始”。网页连通性、登录要求和失效状态不根据活动年龄猜测。
   * 全量事件会在测试和自动提交前检查必填字段、枚举、日期、URL 以及 ID/URL 唯一性。

5. **本地收藏夹 (Personal Bookmarks)**
   * 采用浏览器 LocalStorage 实现纯前端持久化收藏功能，用户可以收藏喜爱的年度报告或绝版活动网页。

---

## 🛠️ 技术栈 (Technology Stack)

* **核心前端**: HTML5 语义化标签、JavaScript (ES Modules 规范)
* **样式系统**: 原生 CSS3，全面引入 CSS 自定义变量设计系统，适配深色科技感玻璃拟态（Glassmorphism）与微动效。
* **字体与图标**: 使用系统字体；`src/icons.css` 只包含实际使用的 Font Awesome SVG 图标，不加载外部网页字体或整包图标字体。新增图标需同步加入本地子集，许可文件位于 `public/licenses/font-awesome.txt`。
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

项目在 [scripts/](scripts/) 目录下提供了一系列易于执行的自动化维护脚本：

* **官方新闻 API 同步**：
  ```bash
  npm run crawl
  ```
  默认每款游戏读取最近 5 页、每页 20 条公告；从正文筛选网页活动并更新数据库。`npm run crawl -- --dry-run` 仅预览，不写入数据。可用 `--games=sr` 定向崩铁，`--max-pages=1` / `--page-size=20` 限制范围，`--enrich-ids=sr-52` 仅为指定已有活动补缺失的时间、奖励等字段。

  | 游戏 | 官方 API app | 新闻 channel |
  | --- | --- | --- |
  | 原神 | `16471662a82d418a` | `719` |
  | 崩坏：星穹铁道 | `1963de8dc19e461c` | `255` |
  | 绝区零 | `706fd13a87294881` | `273` |
  | 崩坏3 | `b9d5f96cd69047eb` | `693` |

  原神、崩铁、崩坏3 使用 `https://act-api-takumi-static.mihoyo.com/content_v2_user/app/{app}/getContentList`；绝区零使用 `https://api-takumi-static.mihoyo.com/content_v2_user/app/{app}/getContentList`。参数为 `iPage`、`iPageSize`、`sLangKey=zh-cn`、`iChanId`。单篇公告使用同路径下的 `getContent?iInfoId={id}&sLangKey=zh-cn`。

  这些是官网当前使用的公开接口，没有对外稳定性承诺，也不是完整的网页活动目录。接口内的 `dtStartTime` 是公告发布时间，`dtEndTime` 是内容展示期限，不作为活动起止日期。活动时间由下述专用脚本获取。只发在社区而未同步到官网的活动可能遗漏，原有历史记录不会删除。

  同步时同时读取 HoYoPlay 的 `https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGameBranches`，使用 `main.tag` 正式分支版本，不把预下载分支当成当前版本。`getGamePackages` 的主包版本可能落后于实际版本，不再用于判断。官网正式更新公告提供明确的维护日期；正式分支与最新已生效公告匹配且已知上线日期时才允许近期活动按当前版本期间补缺，二者冲突时记录冲突并停止此项推断。公告明确写出的活动版本始终优先，前瞻可以指向尚未上线的版本。

* **补全待确认的活动版本**：
  ```bash
  npm run versions -- --dry-run
  npm run versions
  ```
  根据活动公告、官方更新公告和启动器接口补全缺失或“待确认”的版本，保留已有有效版本及“通用”等分类。`--ids=zzz-16,sr-52` 可限制处理记录。没有可靠依据时不改；不会把历史活动统一改成当前版本。已有日期表仅用于两次已知更新之间的历史区间，缺失中间版本、更新当天只有日期而无时刻、最新区间未获接口与公告共同确认时均不推断。此项逻辑也已接入 `npm run crawl` 的自动同步。

* **核对活动参与时间**：
  ```bash
  npm run times -- --dry-run
  npm run times
  npm run times -- --all --dry-run --news-pages=50 --report=reports/activity-time-review.json
  ```
  [update-times.js](scripts/update-times.js) 优先读取官方活动 API 和网页实际使用的公开规则配置，缺失时查对应官网公告。支持绘画投稿、抽抽乐、限时签到、直播及不同年代的网页配置；只用公开 GET，不需要登录或 Cookie，也不执行远程 JavaScript。`--ids=ys-58,bh3-12` 可缩小核对范围；`--all` 包括已归档的完整时间，`--news-pages` 设置公告回查深度，报告区分完整、部分、缺失、冲突及常驻服务。

  `date` 仍表示相关日期或公告日期；参与起止用 `startDate/endDate`，带时刻时另存 `startAt/endAt`（明确时区，保留分钟或秒精度）。`timeSource/timeSourceUrl` 保存依据，`timeStages` 区分整体周期、投稿、评奖、直播等阶段。投稿截止不等于公示结束；直播时间不代替评论抽奖截止，年度统计区间不当成活动期。规则明确限定某个版本时，可联合官方版本持续时间补全日期，不把预计维护结束当真实开服时刻。旧接口失效或依据冲突时保留已归档时间；`timeSource=manual` 的人工确认时间不覆盖。

  前端详情展示参与时间及阶段，并根据精确起止显示“未开始”或“已结束”。只写到日的结束日期仍按北京时间次日判定；精确到分钟的截止包含该分钟，精确到秒的截止在该时刻生效。自动同步会在更新状态前运行此脚本。

* **浏览器交互核验**：先构建并启动本地预览，再运行：
  ```bash
  npm run build
  npm run preview -- --host 127.0.0.1 --port 4187
  npm run test:browser -- --url=http://127.0.0.1:4187 --chrome="Chrome可执行文件路径"
  ```
  使用项目已有 Puppeteer 启动独立无头 Chrome，60 秒总超时，结束后关闭，不复用个人浏览器会话。覆盖桌面和 390px 手机尺寸下的筛选、详情、阶段、收藏、搜索、导航和精确时间边界。`--screenshots=目录` 可保存核验截图；该测试仅访问本地站点，未加入需要浏览器环境的默认单元测试。
  
* **活动生命周期状态更新**：
  ```bash
  node scripts/update-statuses.js
  ```
  根据明确的 `endDate` 更新生命周期状态；不会从公告日期或活动年龄推断网页是否失效。
  
* **官方封面标志下载**：
  ```bash
  node scripts/download-official-covers.js
  ```
  从脚本中配置的官方地址重新下载四款游戏的默认 Logo 图片；不会扫描官网查找新素材，也不更新活动封面。

* **归档活动官方封面**：
  ```bash
  npm run covers
  ```
  从已记录的官方图片地址或官网新闻详情 API 获取封面。图片校验后保存到 `public/images/covers/`，`events.json` 记录本地 `coverUrl` 和原始 `coverSourceUrl`；抓取失败保留已有封面和截图，不再请求米游社或活动页面 Meta 信息。

  可用 `-- --ids=ys-56,sr-52` 定向补图、`-- --force` 重新归档、`-- --dry-run` 查看处理范围。前端按官方封面、来源原图、网页截图、游戏默认图逐级降级。

* **更新活动简介**：
  ```bash
  npm run descriptions
  ```
  从官网新闻详情 API 的正文提炼活动玩法、参与方式和明确奖励，过滤问候、重复标题、链接按钮和奖品发放说明。已有简介只在空白、通用占位、与旧自动简介精确匹配或明确为自动生成时更新；人工简介保留。没有官网新闻来源或接口不可用时保留原文。

  `descriptionSource` 记录 `announcement`、历史 `page` 或 `manual`；`manual` 不会被同步脚本覆盖。默认复用已有有效简介，减少重复请求。可用 `-- --dry-run` 预览、`-- --ids=ys-56,sr-52` 定向处理或 `-- --refresh` 重新检查自动简介。简介更新只修改简介和来源，不改活动状态、日期、奖励字段或链接；单条失败保留原文。

* **生成网页截图封面**：
  ```bash
  node scripts/capture-screenshots.js
  ```
  读取活动数据库，利用 Puppeteer 为没有有效归档封面且缺少截图的非失效活动生成 1024×576 缩略图，保存至 `public/images/screenshots/`。已有截图继续作为兜底保留；`--force=活动ID` 可强制重拍。自动维护先归档官方封面，再补截图，并安装中文字库用于截图。

自动维护工作流会在生成数据后运行完整测试和生产构建，只有验证成功才提交到 `main`。Cloudflare Pages 的构建与部署统一由 `.github/workflows/deploy-pages.yml` 执行。

定时同步配置为每天 UTC 00:00、12:00，即北京时间 08:00、20:00，实际启动时间由 GitHub Actions 调度决定。手动推送 `main` 会触发部署工作流；自动同步产生的数据提交则由同步工作流直接调用部署工作流。发布使用 Wrangler 上传 `dist/` 到 Cloudflare Pages，不依赖 Cloudflare 直接连接 GitHub 后自行构建。

---

## 📄 版权声明 (Disclaimer)

1. 本项目为非官方、公益性的个人二创整理项目。
2. 项目所收录的所有网页活动链接、背景图片、美术素材、角色设计以及商标版权，均归属于 **米哈游（miHoYo）**。
3. 本项目仅作学习交流与信息整理之用，严禁任何商业用途。
