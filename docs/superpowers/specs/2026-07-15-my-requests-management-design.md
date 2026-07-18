# 我的委托管理设计

## 1. 背景

万事广场 V2 已经让用户更容易发现委托，但发布者还缺少一个查看和处理自己委托的入口。用户发布后需要知道审核进度、被拒原因、下架原因、互动热度，也需要在不同状态下做合理操作：撤回待审内容、修改后重新提交、关闭已发布内容、隐藏已关闭内容。

本设计目标是补齐「我的委托 / 我发布的委托管理」闭环，让发布者能低成本管理自己发出的委托，同时不破坏审核、安全追溯和联系申请记录。

## 2. 产品原则

- 管理能力服务发布者，不替代管理员审核。
- 公共可见性必须保守：撤回、关闭、下架、过期、拒绝的委托都不进入万事广场。
- 发布者删除只做用户侧隐藏，不硬删数据库记录。
- 管理员可以彻底删除委托，用于违规、测试数据或明确需要清理的记录。
- 已发布委托不能直接编辑，避免绕过审核修改公共内容。
- 修改后重新提交只允许发生在「已撤回」和「未通过」状态。
- 不做复制重发。

## 3. 范围

本轮包含：

- 新增用户端底部入口「我的委托」。
- 新增发布者自己的委托列表。
- 支持按状态筛选。
- 展示委托状态、审核/下架原因、有效期和互动数据。
- 支持待审核委托撤回。
- 支持已发布委托关闭。
- 支持已关闭委托用户侧删除。
- 支持已撤回、未通过委托修改后重新提交审核。
- 管理后台支持彻底删除委托。

本轮不包含：

- 复制重发。
- 已发布委托直接编辑。
- 已关闭委托重新提交。
- 批量管理。
- 自动通知系统。
- 管理员恢复用户侧隐藏委托。

## 4. 状态机

现有状态继续保留：

- `draft`
- `pending`
- `approved`
- `rejected`
- `taken_down`
- `expired`

新增状态：

- `withdrawn`：发布者在评审前主动撤回。
- `closed`：发布者对已发布委托主动关闭。

状态含义：

- `pending` 待评审：未进入万事广场，发布者可撤回。
- `withdrawn` 已撤回：仅发布者和管理员可见，发布者可修改后重新提交。
- `approved` 已发布：进入万事广场，发布者不可撤回，只能关闭。
- `closed` 已关闭：不进入万事广场，仅发布者和管理员可见，发布者可用户侧删除。
- `rejected` 未通过：仅发布者和管理员可见，发布者可修改后重新提交。
- `taken_down` 已下架：管理员处理结果，仅发布者和管理员可见，发布者不可重新提交。
- `expired` 已过期：历史记录，仅发布者和管理员可见，发布者不可重新提交。
- `draft` 草稿：当前原型不提供草稿编辑入口，本轮不新增草稿流程。

合法状态迁移：

- `pending` -> `withdrawn`
- `pending` -> `approved`
- `pending` -> `rejected`
- `approved` -> `closed`
- `approved` -> `taken_down`
- `approved` -> `expired`
- `withdrawn` -> `pending`
- `rejected` -> `pending`
- `closed` -> user hidden
- any admin-selected request -> hard deleted

非法状态迁移：

- `approved` -> `withdrawn`
- `closed` -> `pending`
- `taken_down` -> `pending`
- `expired` -> `pending`
- `rejected` -> `approved` by publisher

## 5. 可见性规则

万事广场只展示：

- `status = approved`
- owner active
- not expired

我的委托展示：

- 当前登录用户作为 owner 的委托。
- 排除用户侧隐藏的记录。
- 包含 `pending`、`withdrawn`、`approved`、`rejected`、`taken_down`、`expired`、`closed`。

管理员委托列表展示：

- 默认展示所有未硬删除委托。
- 可以看到 `withdrawn`、`closed` 和用户侧隐藏委托。
- 管理员硬删除后记录从数据库移除。

详情页：

- 公共详情仍只允许查看公开有效委托。
- 我的委托页点击自己的非公开委托时，应使用 owner-only 详情能力，不通过公共详情接口绕权限。

## 6. 数据设计

在 `requests` 表增加：

- `ownerHiddenAt TEXT`：发布者用户侧删除时间。为空表示发布者仍可在「我的委托」看到。
- `closedAt TEXT`：发布者关闭时间。
- `withdrawnAt TEXT`：发布者撤回时间。

状态字段 `status` 的 CHECK 增加：

- `withdrawn`
- `closed`

复用现有字段：

- `rejectReason`
- `takedownReason`
- `updatedAt`

硬删除：

- 管理员硬删除直接删除 `requests` 记录。
- 依赖现有外键级联清理 request images、contact applications、favorites、request reactions 等相关数据。

## 7. 用户端页面

新增底部导航入口：

- 标题：`我的委托`
- 图标建议：lucide `ClipboardList` 或 `FileText`

页面结构：

1. 页面标题：`我的委托`
2. 页面短文案：`看审核进度，也管好自己递出去的单。`
3. 状态筛选：
   - 全部
   - 待评审
   - 已发布
   - 已撤回
   - 未通过
   - 已关闭
   - 已下架
   - 已过期
4. 委托卡片列表
5. 空状态

卡片信息：

- 类型
- 标题
- 状态 badge
- 城市 / 远程
- 有效期
- 心形数
- 收藏数
- 联系申请数
- 拒绝原因或下架原因
- 最多三个操作按钮

操作规则：

- `pending`：查看、撤回。
- `withdrawn`：查看、修改后重新提交。
- `approved`：查看、关闭。
- `rejected`：查看、修改后重新提交。
- `closed`：查看、删除。
- `taken_down`：查看。
- `expired`：查看。

文案方向：

- 撤回确认：`撤回后不会进入掌柜审核，可修改后重新提交。`
- 关闭确认：`关闭后不再出现在万事广场，已有联系记录仍会保留。`
- 删除确认：`删除后你将不再看到这份委托，平台仍会保留必要记录用于安全追溯。`

## 8. 修改后重新提交

入口：

- 来自「我的委托」中 `withdrawn` 和 `rejected` 卡片。

表单：

- 复用现有发委托表单的类型字段结构。
- 载入旧委托数据，包括 `details`、城市、远程、行业、回报、有效期。
- 交易图片第一版不做图片编辑；旧图片继续保留，允许提交时不新增图片。

提交行为：

- 更新原委托，而不是创建新委托。
- 将 `status` 改为 `pending`。
- 清空 `rejectReason`。
- 清空 `withdrawnAt`。
- 清空 `closedAt`。
- 清空 `ownerHiddenAt`。
- 更新 `updatedAt`。
- 管理员需要重新审核。

约束：

- 只能编辑 owner 自己的委托。
- 只能编辑 `withdrawn` 或 `rejected`。
- 已发布、已关闭、已下架、已过期都不能编辑后重新提交。

## 9. API 设计

新增用户端 API：

- `GET /api/my/requests`
  - 登录用户必需。
  - query：`status`
  - 返回当前用户未隐藏的委托列表。

- `GET /api/my/requests/:id`
  - 登录用户必需。
  - 只返回 owner 自己的委托。
  - 可以返回非公开状态委托。

- `POST /api/my/requests/:id/withdraw`
  - 只允许 owner。
  - 只允许 `pending`。
  - 返回更新后的委托。

- `POST /api/my/requests/:id/close`
  - 只允许 owner。
  - 只允许 `approved`。
  - 返回更新后的委托。

- `POST /api/my/requests/:id/hide`
  - 只允许 owner。
  - 只允许 `closed`。
  - 设置 `ownerHiddenAt`。
  - 返回 `{ hidden: true }`。

- `PUT /api/my/requests/:id`
  - 只允许 owner。
  - 只允许 `withdrawn` 和 `rejected`。
  - 校验逻辑复用发布委托逻辑。
  - 返回更新后 `pending` 委托。

管理后台 API：

- `DELETE /api/admin/requests/:id`
  - 只允许管理员。
  - 硬删除委托。
  - 返回 `{ deleted: true }`。

## 10. 错误处理

- 未登录：`401 Authentication required`
- 非 owner 操作：`404 Request not found`，避免泄露记录存在性。
- 状态不允许：`409 Request status has changed`
- 字段校验失败：沿用发布委托表单现有 `400` 错误。
- 管理员硬删除不存在记录：`404 Request not found`

前端呈现：

- 操作失败显示页面内 alert。
- 409 使用友好文案：`委托状态已变化，请刷新后再试。`
- 修改提交失败保留表单内容。

## 11. 管理后台设计

委托审核列表增加：

- 支持看到 `withdrawn` 和 `closed` 状态。
- 状态标签展示为：
  - `withdrawn`：已撤回
  - `closed`：已关闭

管理员硬删除入口：

- 在每条委托操作区增加危险按钮：`彻底删除`
- 需要确认理由输入或确认提示。
- 第一版可用浏览器 confirm 或页面内确认输入；推荐页面内确认，避免误触。
- 硬删除成功后刷新列表。

风控边界：

- 管理员硬删除是高风险操作，按钮必须使用 danger 样式。
- 后续可以加操作日志；本轮不新增独立日志表。

## 12. 测试范围

后端测试：

- owner 可以列出自己的各状态委托。
- 公共万事广场不展示 withdrawn / closed / ownerHiddenAt / rejected / taken_down / expired。
- pending 可以撤回。
- approved 不能撤回，只能关闭。
- closed 可以 owner hide。
- hide 后不出现在我的委托列表。
- withdrawn / rejected 可以 PUT 后重新变为 pending。
- closed / approved / taken_down / expired 不能 PUT 重新提交。
- 非 owner 对 my request 返回 404。
- 管理员可以硬删除委托。
- 硬删除级联清理相关 request records。

前端测试：

- 底部导航显示「我的委托」。
- 我的委托列表展示状态筛选和卡片数据。
- pending 卡片显示撤回按钮。
- approved 卡片显示关闭按钮。
- withdrawn / rejected 卡片显示修改后重新提交。
- closed 卡片显示删除按钮。
- 操作成功后列表刷新或本地状态更新。
- 操作失败显示 alert。

端到端测试：

- 登录用户进入我的委托。
- 查看已有委托状态。
- 对待审委托执行撤回。
- 从已撤回委托进入编辑并重新提交。
- 对已发布委托执行关闭。

## 13. 验收标准

- 用户能从底部导航进入「我的委托」。
- 用户能看到自己发布的所有未隐藏委托，包括非公开状态。
- 用户能区分待评审、已发布、已撤回、未通过、已关闭、已下架、已过期。
- 待评审委托可以撤回。
- 已发布委托不能撤回，只能关闭。
- 撤回和关闭后委托不再进入万事广场。
- 撤回和未通过委托可以修改后重新提交审核。
- 关闭委托可以用户侧删除，删除后从我的委托列表消失，但数据库记录保留。
- 管理员可以彻底删除委托。
- 全量测试、build、e2e 通过。

## 14. 后续可做

- 复制重发。
- 操作日志。
- 关闭理由。
- 管理员恢复误隐藏。
- 用户端批量管理。
- 站内消息通知审核结果。

