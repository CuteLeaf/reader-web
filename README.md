<div align="center">

Reader-Web 是一款免费的 Web 平台电子书阅读器

提供本地文件离线阅读和第三方后端连接

</div>


---

## 1. 后端兼容性

依赖「Legado 3.0」的 Web 接口，下面两个主流 Legado 分支都能直接用：

[LegadoTeam/legado](https://github.com/LegadoTeam/legado)

[HapeLee/legado-with-MD3](https://github.com/HapeLee/legado-with-MD3)

---

## 2. 部署

产物就是一个 `dist/` 静态目录，构建命令统一 `pnpm build`，放哪都行：

| 平台 | 构建 / 输出 | 环境变量 | 说明 |
| --- | --- | --- | --- |
| Cloudflare Pages | `pnpm build` / `dist` | `BASE_PATH=/`、`SITE_URL=…`、`NODE_VERSION=24` | 可直接连 Git；也可本地 `pnpm dlx wrangler pages deploy`（仓库带 `wrangler.toml`） |
| 腾讯云 EdgeOne Pages | `pnpm build` / `dist` | `BASE_PATH=/` | Makers → 创建项目 → 导入 Git；框架预设选 Astro |
| 阿里云 ESA Pages | `pnpm build` / `dist` | `BASE_PATH=/` | 控制台「边缘计算 → 函数和 Pages」导入 Git；静态资源目录填 `./dist` |
| GitHub Pages | 用自带 `deploy.yml` | 自动推导 `BASE_PATH=/<repo>/` | 仓库 Settings → Pages 里把 Source 选成 **GitHub Actions** |
| Vercel | `pnpm build` / `dist` | `BASE_PATH=/` | 纯静态，不需要 Serverless 函数 |
| Netlify | `pnpm build` / `dist` | `BASE_PATH=/` | 同上 |
| 对象存储 / Nginx | 上传 `dist/` | 构建时定 `BASE_PATH` | `index.html` 作默认页，hash 路由不用写 rewrite |
| 局域网自建 | `pnpm build && pnpm serve:dist` | — | `http://<内网IP>:4173`，能绕开混合内容限制 |

> **连不上局域网后端？** Chrome 142 起对「公网页面访问局域网设备」启用本地网络访问权限（LNA），该权限只在安全上下文可用：
> 用 `http://` 公网地址打开本站时，浏览器会直接拒绝访问 `192.168.x.x`（报错与 CORS 完全一样，`no-cors` 探测也会失败）；
> 用 HTTPS 打开会弹一次「允许访问本地网络」，允许后即可连接（私有 IP 字面值免于混合内容检查）。
> 最省事的做法仍是局域网自建：页面与后端同为内网地址，不需要任何授权。

---

## 3. 本地开发

> 需要 **Node ≥ 22.23.4**（Astro 7 要求）

```bash
pnpm install
pnpm dev               # http://localhost:4321

# 另开一个终端，起一个模拟的Legado 3.0后端（默认 1122）
pnpm mock

# 打开 http://localhost:4321/?endpoint=http://127.0.0.1:1122 可直接连通
# 或在「扫描 / 连接」里直接填 127.0.0.1:1122
```

`pnpm mock` 提供 2 本书、7 章正文，接口与真实后端一致并带 CORS 头，可完整验证"连接 → 目录 → 正文 → 翻章"。

### 代码风格与检查

| 工具 | 管什么 | 命令 |
| --- | --- | --- |
| **Prettier** + `prettier-plugin-svelte` / `-astro` | 格式：ts / svelte / astro / css / json（`*.md` 不碰，文档保持人工排版） | `pnpm format` · `pnpm format:check` |
| **ESLint 10** + `typescript-eslint` + `eslint-plugin-svelte` | 逻辑问题、Svelte 写法（each 的 key、`$effect` 依赖、a11y 之外的可维护性规则） | `pnpm lint` · `pnpm lint:fix` |
| **astro check** + **svelte-check** | 类型：`.astro` / `.ts` / `.svelte` 全量诊断，含 a11y 与无用 CSS 选择器 | `pnpm check` |

三条一起跑：`pnpm quality`。CI 里的 `quality.yml` 会在 push `main` 与 PR 上依次执行 格式检查 → lint → 类型检查 → 构建。

---

## 4. 用户协议与免责声明

> **【特别提示】**
> 在访问、部署或使用本项目前，请你务必仔细阅读并充分理解本协议与免责声明的全部内容。你一旦使用本项目，即视为已阅读、理解并同意接受本声明的全部内容。

### 一、软件性质说明

1. 本项目是一款用户可自行部署的网页阅读客户端，提供页面展示、正文排版、本地文件导入与数据管理等技术功能。
2. 本项目**不预置、不内置、不提供**任何第三方网站内容、书籍文件或解析规则（书源）；仓库内也不附带任何书源、订阅源或下载地址。
3. 本项目不提供内容运营、内容存储、内容发布或内容传播服务；除你自己选择的静态托管外，没有用于提供内容的自有服务器。
4. 书架里的内容只有两个来源：你自行配置的后端，以及你自行导入的本地文件。

### 二、隐私与数据说明

1. 本项目是纯静态前端，主要功能运行于用户本地浏览器，不设立用于提供网页内容服务的自有内容服务器。
2. 本项目不会主动收集、上传或存储你的书籍文件、书源列表、阅读记录或其他个人隐私数据。
3. 本项目**不接入**任何第三方统计、埋点或崩溃分析服务，不收集设备信息与阅读行为。
4. 书籍、字体、阅读进度、后端地址与访问令牌等数据只保存在本机（IndexedDB / localStorage）；连接局域网后端时，阅读进度会写回该后端。清除浏览器数据会一并丢失，请自行备份。
5. 连接哪个后端，完全由你配置；发往第三方的网络请求由你的浏览器直接发出。

### 三、知识产权保护

1. 作者尊重并保护知识产权权利人的合法权益，反对任何侵犯著作权、商标权或其他合法权益的行为。
2. 用户应确保其使用本项目获取、处理或访问相关内容的行为符合适用法律法规及权利要求的授权范围。
3. 若权利人认为某些第三方规则或内容存在涉嫌侵权情形，可依法向相关内容实际托管方主张权利。
4. 权利人亦可向作者提交包含身份证明、权属证明、具体内容信息及相关说明的有效通知，作者将在合理技术能力范围内采取必要处理措施。
