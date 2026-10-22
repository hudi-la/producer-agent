# Google 日历接入

已部署于 https://fairwind.hudiworks.com/?a=ledger （2026-10-08）。

## 用户流程

在日历页点击「连接 Google 日历」，每位用户完成自己的授权。连接 Gmail 不等于已连接日历。
选择显示的日历（最多 12 个），选择可写日历，或创建独立的 Fairwind 日历。
「自动同步已确认的未来会议」默认关闭；开启后每 5 分钟同步未来 180 天内的已确认会议。
待办从日期详情里的「写入 Google 日历」手动加入，作为全天事件。会议在没有时长数据时默认 30 分钟，界面明确说明。
日历事件可以点击在 Google 中查看及修改。Google 修改会在刷新日程后显示；不会反向改写 Fairwind 的邮件事实或状态判断。
Fairwind 检测到 Google 上修改或删除过的事件后停止覆盖并提示冲突。未实现自动删除已结束的安排。
不会添加参会者或发送邀请。

## 实现与运维

- 线上代码：`brain/calendar/service.js`、`brain/calendar/routes.js`、`src/components/GoogleCalendar.jsx`、`src/lib/googleCalendar.js`；Timeline 合并日程。
- 本地变更副本与发布脚本：`fixes/2026-10-08-google-calendar/`。base 是发布前线上源码；work 是变更副本。manifest 只列本次发布文件。
- 复用现有 Google Web OAuth client 及 `/oauth/gmail/callback`，使用独立、一次性、10 分钟过期的 `calendar-` state 和 PKCE。
- scopes：`calendar.events`、`calendar.calendarlist.readonly`、`calendar.calendars`。
- 应用的 Google Cloud 项目需启用 Google Calendar API；OAuth 应用的日历权限需符合 Google 的受众/验证要求。未完成真实用户授权前，不能声称 Google 读写链路已验证。
- 凭据、偏好和事件映射：`FAIRWIND_DATA_DIR/users/<owner>/calendar.json`，0600 文件，原子写入；由已验证的租户 owner 定位，客户端不能指定 owner。
- 写入数据只能来自当前用户的 `v_pa_state`。事件 ID 由 owner、目标日历和事实锚点计算，以避免重试重复创建。
- 修改使用 ETag 条件请求；已在 Google 编辑或删除的事件保留原样并提示冲突。
- 断开连接删除本地日历凭据及映射，不调用共享 OAuth 项目的 Google revoke，以免影响 Gmail。Google 中已有事件保留。
- 服务重启会使进行中的授权失效，用户重新连接即可。

## 验证记录

39 项日历、租户隔离、Gmail 授权、日期与中英文测试通过，生产构建通过。
正式页面与新 JS 返回 200；未登录 `/calendar/status` 返回 401；后端服务正常运行。
浏览器验证停在登录页：未代替用户完成 Google 日历授权，未在真实日历创建测试事件。
回滚目录：`/home/fairwind/releases/google-calendar-20261008-nXNz6X/rollback/`。
