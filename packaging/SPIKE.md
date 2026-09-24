# ① 打包验证 · 结论

2026-09-16 · node v24.21.0（darwin-arm64，自带）· esbuild 0.28.2 · bytenode 1.6.0 · @electric-sql/pglite 0.5.8 · @anthropic-ai/claude-agent-sdk 0.3.x

| 要验的 | 结果 |
|---|---|
| esbuild 把 ESM 打成 CJS，bytenode 编成字节码，用自带 node 跑 | ✓ |
| PGlite 在字节码里开库；前言（`create role` / `auth` schema / `auth.uid()`）能跑 | ✓ |
| 跑一支真迁移（0001），`set_config` → `auth.uid()` 回得来 | ✓ |
| Agent SDK 从字节码里起子进程、答一句 | ✓（`它说:好`） |

**全部通过。** 打包形状按设计稿 D9：文件夹应用（自带 node + 字节码 + dist + node_modules）。

## 坑和绕法（写进代码规矩）

1. **`import.meta.url` 在 CJS 里没有** —— esbuild `define` 成一个标识符，banner 里用 `pathToFileURL(__filename)` 造出来。`brain/dbauth.js`、`mail/auth.js`、`mail/authorize.js` 都靠它找文件，都能过。
2. **bytenode 跑在 `vm.Script` 里，没有动态 `import()` 的回调** —— 代码里对**外部包**一律静态 `import`，不许 `await import('pkg')`。Node 24 的 `require(esm)` 能同步装 SDK 那种 ESM 包，esbuild 把静态 import 翻成 `require` 正好。内部模块的 `import()` esbuild 会翻成 `Promise.resolve().then(() => require(...))`，没事。
3. **CJS 不能有顶层 `await`** —— `server.js` 启动段要搬进 `main()`（施工计划 Task 7）。
4. **非 JS 的资源（前言 SQL、迁移 SQL）不进 bundle** —— 放在字节码旁边，运行时按 `import.meta.url` 相对找。`build-brain.mjs` 负责拷。
5. **字节码必须由将来跑它的那个 node 编**（V8 版本一致）—— 构建脚本用 `packaging/runtime/` 里那份 node 跑，不用本机的。

## 没验、留给 ⑤

- Windows（`node-win-x64`）同一套流程
- SDK 的平台二进制（`@anthropic-ai/claude-agent-sdk-<平台>`，约 256MB）跟着 node_modules 一起打包后能不能被找到
- `brain/server.js` 整个打包（现在只验了 `local/spike.js` 这个小入口）


## Intel 包(2026-09-25)

同一台 Apple 芯片的机器借 Rosetta 出 mac-x64:
```
cd packaging/runtime && curl -fsSL -o x.tgz https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-x64.tar.gz && tar xzf x.tgz && mv node-v24.21.0-darwin-x64 node-darwin-x64 && rm x.tgz
npm install --no-save --force @esbuild/darwin-x64@<esbuild 版本>   # build-brain 在 x64 node 里 import esbuild,要它的 x64 二进制
```
之后 `packaging/release.mjs` 看见 `node-darwin-x64` 就自动多出一份;build.mjs 里 npm 用自带 node 跑,SDK 的平台二进制才是 x64 的。
包起来验过:解开后 `arch -x86_64 ./Fairwind/node ./Fairwind/launcher.cjs` → /health 正常。
