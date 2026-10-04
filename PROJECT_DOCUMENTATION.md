# 米游活动档案馆 (HoYo Event Archive) 项目功能与架构文档

更新日期：2026-10-04。

项目收录原神、崩坏：星穹铁道、绝区零和崩坏3的网页活动、年度报告、回归活动及官方专题页面。网站是静态单页应用；信息维护在本地或 GitHub Actions 中执行，结果写入仓库并重新部署。

线上地址：[hoyo.yeque.top](https://hoyo.yeque.top/)。安装与维护命令见 [README](README.md)。

## 一、系统核心功能

### 1. 首页与游戏专题专区

首页提供四款游戏的专题入口、活动数量统计、最近更新、关键词搜索及热门搜索标签。游戏专题沿用相同的活动列表，按对应游戏筛选。

### 2. 筛选、多视图与路由

活动支持按游戏、版本、类型和状态交叉筛选，以及日期、标题和状态排序。列表提供卡片与表格两种视图；时间轴、年度报告、回归活动、失效页面和收藏页使用同一份活动数据。

导航使用真实 URL，支持分享、刷新恢复、浏览器前进后退和活动详情深链接。路由、详情返回及筛选状态分别由 [app-route.js](src/app-route.js)、[detail-navigation.js](src/detail-navigation.js) 和相关列表模块处理。

### 3. 本地收藏与历史数据兼容

收藏保存在浏览器 LocalStorage，无需登录。历史本地编辑记录仍可读取：保留旧记录迁移、字段覆盖、自定义活动和删除标记的合并逻辑；仓库的新活动及未被覆盖的字段仍可接收更新。

管理后台页面、编辑入口和 Cloudflare 管理员鉴权函数已移除。浏览器不提供写回仓库或服务器的接口；维护者通过同步脚本或直接修改 [events.json](src/events.json) 维护数据。

### 4. 展示状态与日期语义

| 字段或状态 | 含义 |
| --- | --- |
| `date` / `dateType=announcement` | 公告日期，不等同于活动开始日期 |
| `startDate` / `endDate` | 活动规则明确写出的起止日期 |
| 可访问 / 需登录 / 已失效 | 存储的网页访问状态，不能仅由公告日期推断 |
| 已结束 | 已知 `endDate` 早于当前北京时间日期的活动生命周期状态 |

`update-statuses.js` 校验数据并按明确的结束日期更新状态，不做 HTTP 连通性或登录探测。活动结束和网页失效是不同概念；结束的网页仍可能可访问。

### 5. 字体、图标与图片

前端使用系统字体和 [icons.css](src/icons.css) 中实际使用的 45 个本地 SVG 图标，不请求 Google Fonts 或整包 Font Awesome 图标字体。SVG 图标的来源与许可证保存在 [font-awesome.txt](public/licenses/font-awesome.txt)。系统字体的外观会随设备不同。

卡片与列表图片懒加载、异步解码；图片来源统一由 [event-cover.js](src/event-cover.js) 设置，避免模板与 JavaScript 重复设置。失败时依次尝试归档官方封面、官方来源图片、旧网页截图和游戏默认图。

## 二、自动化脚本设计

### 1. 官方新闻 API 同步

入口是 [official-news-crawler.js](scripts/official-news-crawler.js)，使用 [official-news.js](scripts/official-news.js) 请求游戏官网使用的公开 ContentAPI：

| 游戏 | app | 新闻 channel |
| --- | --- | --- |
| 原神 | `16471662a82d418a` | `719` |
| 崩坏：星穹铁道 | `1963de8dc19e461c` | `255` |
| 绝区零 | `706fd13a87294881` | `273` |
| 崩坏3 | `b9d5f96cd69047eb` | `693` |

原神、崩铁、崩坏3使用 `act-api-takumi-static.mihoyo.com`；绝区零使用 `api-takumi-static.mihoyo.com`。

```text
列表：/content_v2_user/app/{app}/getContentList
参数：iPage、iPageSize、iChanId、sLangKey=zh-cn
详情：/content_v2_user/app/{app}/getContent
参数：iInfoId、sLangKey=zh-cn
```

列表正文直接提供活动链接、公告文字和图片信息。同步脚本筛选允许的活动域名，解析短链接，按规范化 URL 去重，保留已有 ID 和人工内容。默认每个游戏读取 5 页、每页 20 条；请求有超时、响应大小和有限重试限制。单个来源失败继续处理其它游戏，全部来源失败时不写入活动库。

官网文章编号保存为 `sourceNewsId`，来源页面保存为 `sourceNewsUrl`。历史 `sourcePostId` 仅保留追溯，不再用于米游社接口请求。官网的 `dtStartTime` 是公告发布时间，`dtEndTime` 是内容展示期限，不能作为活动起止时间。

公开新闻接口没有稳定性承诺，也不是完整的活动目录。仅在社区发布而未同步到官网的活动可能遗漏；已有历史记录不会因接口没有返回而删除。

### 2. 游戏版本识别

[version-evidence.js](scripts/version-evidence.js) 请求官方 HoYoPlay 接口：

```text
https://hyp-api.mihoyo.com/hyp/hyp-connect/api/getGameBranches
参数：launcher_id=jGHBHlcOq1、game_ids[]=游戏编号
版本字段：data.game_branches[].main.tag
```

| 游戏 | game ID |
| --- | --- |
| 原神 | `1Z8W5NHUQb` |
| 崩坏：星穹铁道 | `64kMb5iAWu` |
| 绝区零 | `x6znKlJ0xK` |
| 崩坏3 | `osvnlOc0S8` |

正式分支的 `main.tag` 用于核对当前版本；预下载分支不算当前版本。`getGamePackages` 的下载主包版本可能落后，不用于此项判断。脚本只保留需要的版本信息，不保存分支密码等无关字段，也不下载游戏包。

活动公告明确写出的版本优先，前瞻活动可以指向尚未上线的版本。没有明确版本的部分活动可参考官方更新公告里的维护日期：历史区间需要相邻更新记录；最新区间还需正式分支与已生效更新公告一致，并且活动日期不晚于本次查询日期。

日期仅精确到日的记录在维护当天不做推断；缺失中间版本、接口冲突或缺乏明确维护日期时保留“待确认”。崩坏3的更新公告可能没有明确维护日期，不能根据公告发布时间补造上线日期。原有日期表仅用于已闭合的历史区间，不向未来无限延伸。

版本逻辑已接入自动同步。[enrich-versions.js](scripts/enrich-versions.js) 可单独补全缺失或“待确认”的版本，保留已有有效版本和“通用”等分类。

### 3. 简介与官方封面

[update-descriptions.js](scripts/update-descriptions.js) 从官网新闻详情 API 的正文提炼玩法、参与方式和明确奖励，过滤问候、重复标题、按钮文案及奖品发放说明。`descriptionSource=manual` 的人工简介始终保留；缺少来源或请求失败时保留原文，不读取活动网页或米游社帖子补简介。

[update-covers.js](scripts/update-covers.js) 使用已存官方图片地址或官网新闻详情 API，校验图片格式及下载大小后保存到 `public/images/covers/`。已有有效本地封面默认跳过，已知来源失败时可尝试官方新闻图片；失败不覆盖旧文件。`coverUrl` 记录站内归档地址，`coverSourceUrl` 记录原图地址。

### 4. 活动参与时间

[update-times.js](scripts/update-times.js) 单独核对参与期限，按官方活动配置、官网公告的顺序补充；请求失败不清空已存时间。`npm run times` 处理缺失时间和仍在进行的活动，`--all` 可复查整个档案，`--dry-run` 仅提出变更，`--report=路径` 保存逐条结果。公告列表按游戏共享，URL、活动 ID 及日期附近的明确标题共同用于关联，避免重用活动入口套到另一期。

[activity-time-sources.js](scripts/activity-time-sources.js) 只调用公开 GET，校验活动 ID、官方域名、重定向及响应预算，不登录、不使用 Cookie，不执行远程 JavaScript。主要来源包括：

- 绘画征集 `contributionv2/actInfo`：优先使用 `post_start_time/post_end_time`，完整周期和评奖另存阶段。
- 抽抽乐 `excalibur/skinV2`：读取公开规则中的参与范围，不请求需要登录的个人抽奖信息。
- 崩坏3 `luna/bh3/home`：读取 `short_extra_award` 限时奖励，确认与归档活动对应后才使用，长期签到服务不随奖励期结束。
- 前瞻 `miyolive/index`：实际直播起止只记为直播阶段，不能覆盖讨论或抽奖参与期。
- 独立网页：从 HTML 实际引用的业务脚本静态定位 mi18n 配置，支持 `morax`、`s3` 及旧 SDK 路径。大脚本只读取受限首尾片段，配置无活动期时回查官网公告。

[activity-time-parser.js](scripts/activity-time-parser.js) 识别活动、投稿等限定时间段，支持省略年份、跨年、仅有截止、版本更新后开始及多阶段，不把年度统计、奖品发放或公示区间误作参与期。规则只说某个版本期间时，必须与记录版本相符，再联合正式更新公告明确的持续范围；未知开始时刻保留为日期，不能用维护预估伪造。

时间字段使用 `startDate/endDate` 和可选 `startAt/endAt`，后者带明确时区并保留原有分钟或秒精度。`timeSource/timeSourceUrl` 保存依据，`timeStages` 为分阶段起止。归档结果通过共享 schema 和本地 overlay 兼容检查；详情显示北京时间，精确截止优先于日期截止，支持“未开始”。数据中没有结束时间的常驻服务或内容页不自动推算结束日。

### 5. 截图兜底与其它工具

[capture-screenshots.js](scripts/capture-screenshots.js) 使用独立 Headless Chrome 为没有有效归档封面且缺少截图的非失效活动生成 1024×576 缩略图。它会检查页面加载状态、错误提示和截图质量，不能把“固定等待几秒”作为完整加载的保证；页面不可用时可生成信息兜底图。已有截图保留，指定 `--force=活动ID` 时可重拍。

[download-official-covers.js](scripts/download-official-covers.js) 从配置的官方地址重新下载四款游戏的默认 Logo 图片，不扫描官网找新素材，也不更新活动封面。[summarize-event-updates.js](scripts/summarize-event-updates.js) 生成本轮数据更新摘要，[tg-notify.js](scripts/tg-notify.js) 按运行结果和更新内容发送通知。

## 三、CI/CD 自动同步与通知流

### 1. 定时与手动同步

[auto-crawl.yml](.github/workflows/auto-crawl.yml) 每天 UTC 00:00、12:00运行，对应北京时间 08:00、20:00；GitHub Actions 实际启动可能延迟。也支持手动运行并指定需补充元数据或重拍截图的活动 ID。

工作流按以下顺序执行：

1. 安装 Node.js 24、依赖、截图浏览器及中文字库，检查同步规则。
2. 获取官方新闻与正式分支版本，更新活动数据，再核对官方活动参与时间。
3. 更新生命周期状态、归档官方封面、补充简介及缺失截图。
4. 生成更新摘要；有变化时运行完整测试和生产构建。
5. 验证成功后提交并推送数据及图片到 `main`，调用部署工作流发布该提交。
6. 按同步与部署结果执行 Telegram 通知。

### 2. 通知行为

定时运行成功且无变化时保持静默；手动无变化的运行可发送临时完成通知。有活动更新时可发送活动卡片与摘要，失败时发送失败结果。截图强制重拍也可触发对应卡片通知。不会重复发送任务开始通知。

## 四、项目技术栈与目录结构

使用原生 JavaScript ES Modules、HTML、CSS 和 Vite；运行环境要求 Node.js `>=24 <25`。Puppeteer 只用于截图维护，不作为公告信息抓取依赖。管理后台及其专用模块已移除。

```text
HoYo Event Archive/
├── .github/workflows/
│   ├── auto-crawl.yml              # 官方 API 同步、数据验证、通知
│   ├── deploy-pages.yml            # Cloudflare Pages 构建与部署
│   └── test-tg-notification.yml    # 手动通知验证
├── public/
│   ├── images/covers/              # 官方封面归档
│   ├── images/screenshots/         # 网页截图与兜底图
│   ├── images/*_cover.png          # 游戏默认 Logo
│   └── licenses/font-awesome.txt  # 图标许可说明
├── reports/                       # 内容复核与历史 URL 候选报告
├── scripts/                       # API、版本、封面、简介、状态及通知脚本
├── src/
│   ├── main.js                    # 页面渲染、导航与交互
│   ├── style.css                  # 主题及响应式布局
│   ├── icons.css                  # 使用的本地 SVG 图标
│   ├── events.json                # 构建时导入的活动库
│   ├── event-domain.js            # 数据规范、安全检查与状态规则
│   ├── event-storage.js           # 历史本地数据兼容
│   └── …                          # 路由、封面、筛选及时间轴模块
├── test/                          # 数据、脚本与前端行为测试
├── index.html                     # 静态站点入口
├── vite.config.js
├── package.json
├── README.md                      # 安装及维护速查
└── PROJECT_DOCUMENTATION.md        # 功能、架构及部署说明
```

## 五、部署与维护边界

[deploy-pages.yml](.github/workflows/deploy-pages.yml) 在普通 `main` 推送、手动触发或同步工作流调用时运行。它安装依赖、测试、构建，并使用 Wrangler 将 `dist/` 上传到 Cloudflare Pages 的 `hoyo-event-archive` 项目。自动数据提交不依赖再次触发 push 工作流；同步工作流会直接调用部署流程。

Cloudflare Pages 托管构建后的静态资源，浏览器读取随构建打包的数据。GitHub Actions 使用已配置的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 等 Secrets，文档和仓库不保存其值。当前发布链不是 Cloudflare 直接关联 GitHub 后自行构建的模式；部署问题应先查看 GitHub Actions 的测试、构建与 Wrangler 步骤日志。

`reports/` 中的历史 URL 候选报告用于复核，候选尚未自动合并进活动库；该目录也不自动复制到 `dist/`。可以通过 GitHub 阅读，或使用本地开发服务器查看。活动信息、当前版本、页面可访问性和历史候选的可用性应分别核对，不能因接口有记录或网页返回 HTTP 200 就认定奖励仍可领取。
