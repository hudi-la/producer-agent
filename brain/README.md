# Fairwind 的后端（brain）

线上版：https://fairwind.hudiworks.com/ ，跑在 Render 上，一个进程替所有账号干活，数据在 Supabase。
本机版和个人 localhost 版已停用（2026-10-05）；旧说明存档在 `docs/history/brain-README-2026-09.md`，只作历史参考。

## 先读这两份

- **[决策地图](../docs/decision-map.md)**：每个决定在什么时候发生、依据什么、是规则还是模型、用哪一档模型、提示词在哪个文件。改提示词、规则或触发条件时同步改它。
- **[部署](../docs/deployment.md)**：怎么发布、怎么验证、怎么回滚。

## 它做什么

| 部分 | 文件 |
|---|---|
| 接口和三个后台循环（收信每 5 分钟、讲懂每 60 秒、找机会每 30 秒看一次排期） | `server.js` |
| 拼聊天和讲懂的提示词 | `prompt.js`、`contextHistory.js`、`stateMove.js`、`studio.js` |
| 模型提议落库前的硬规则（闸门） | `decisions.js` |
| 消息类型表：每种消息算不算事实、谁产生的、进提示词哪一组 | `../src/lib/messageKinds.js` |
| 转移表（状态 × 事件 → 一格一问） | `judge.js`、`judgments.js` |
| 重判、到点 | `rejudge.js`、`timer.js` |
| 收信、认地址、归属、摘要、发信 | `mail/` |
| 找机会 | `scout.js`、`scoutSearch.js`、`reach.js` |
| 按人隔离（每个请求、每个后台任务都带着「替谁干活」） | `tenant.js` |
| 调模型的三种方式（Claude SDK / Codex / OpenAI 兼容） | `engine/`、`models.js` |

## 几条不能破的规矩

- **模型按不了发送键。** 发信是 `mail/send.js` 里的纯 HTTP 函数，不在任何模型的工具里，只有页面上的按钮能触发。
- **只有真实邮件和你亲手记的笔算事实。** 聊天回复、Fairwind 推出来的判断、草稿都不是。
- **后台（你不在场时）提的提醒改动只是建议。**
- **数据库函数的约定由 `local/contract.test.js` 守着**：它把全部迁移在内存数据库里真跑一遍再断言。别用旧函数体覆盖新功能——2026-10 体检查到两次。

## 测试

```sh
npm test          # 在仓库根目录；含数据库契约测试
```
