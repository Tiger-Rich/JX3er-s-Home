# 番薯万事屋

面向剑网 3 老玩家的身份信任型资源对接原型。

「番薯万事屋」不是攻略社区，而是一个让散落在各行各业的番薯低成本找到彼此的小工具。当前版本聚焦轻量互助场景：求职内推、行业咨询、买卖交易、约稿委托、本地互助、追星互助和其他资源对接。

## 当前形态

- React + Vite 前端原型
- Express API 服务
- SQLite 本地数据库
- 管理后台
- Vitest 单元/API/组件测试
- Playwright 端到端冒烟测试

第一阶段目标是可运行、可演示、可继续迭代的 MVP，不是正式微信小程序包。

## MVP 功能

- 登录与注册
- 我的名片：城市、区服、游戏 ID、门派、入坑年份、行业职业、可提供资源、正在寻找的资源
- 需求发布：求职内推、行业咨询、买卖交易、约稿委托、本地互助、追星互助、其他
- 信息流：精选需求、类型/城市/行业筛选、详情查看
- 联系申请：申请人提交一句话说明，发布者确认后才展示联系方式
- 轻量认证：待认证/已认证状态，要求补全区服、游戏 ID 和联系方式
- 管理后台：认证审核、需求审核/下架、用户列表和禁用

## 产品边界

- 不做账号交易、代练、外挂、私服相关内容
- 不收集游戏账号密码
- 不承诺求职成功，也不提供交易担保
- 联系方式默认不公开，通过申请制流转
- 当前认证是 MVP 流程，后续需要接入更完整的审核、举报和风控机制

## 本地启动

需要 Node.js 20.19+、22.13+ 或 24+。

```bash
npm install
npm run dev:all
```

默认地址：

- 前端：http://127.0.0.1:5173
- API：http://127.0.0.1:8787

开发模式会创建本地 SQLite 文件 `fanshu.db`，并写入演示数据。

## 演示账号

普通用户：

```text
账号：qixiu
密码：test123
```

```text
账号：wanhua
密码：test123
```

管理员：

```text
账号：admin
密码：admin123
```

登录管理员账号后会进入后台，可查看认证审核、委托审核和用户列表。

## 常用命令

```bash
npm run dev
npm run api
npm run dev:all
npm test
npm run build
npm run e2e
```

说明：

- `npm run dev` 只启动前端
- `npm run api` 只启动 API
- `npm run dev:all` 同时启动前端和 API
- `npm test` 运行 Vitest 测试
- `npm run e2e` 运行 Playwright 冒烟测试

## 环境变量

API 服务支持以下环境变量：

```text
FANSHU_DB_FILENAME       SQLite 数据库路径，默认 ./fanshu.db
FANSHU_DB_RESET          设置为 1 或 true 时重置数据库文件
FANSHU_HOST              API 监听地址，默认 127.0.0.1
FANSHU_PORT              API 端口，默认 8787
FANSHU_PROTOTYPE_TOKEN_SECRET  原型登录 token 签名密钥
```

共享或部署环境中应显式设置 `FANSHU_PROTOTYPE_TOKEN_SECRET`，不要依赖本地原型默认值。

## 验证状态

当前 MVP 分支已通过：

- `npm test`
- `npm run build`
- `npm run e2e`

## 下一阶段建议

- 微信小程序技术选型与页面迁移
- 真实微信登录与手机号/联系方式保护策略
- 持久化数据库和部署方案
- 举报、拉黑、审核日志和敏感内容规则
- 认证材料上传与人工审核工作台
- 小程序广告与后续付费点设计

