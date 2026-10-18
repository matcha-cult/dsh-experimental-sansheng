# 三省六部 · Sān Shěng Liù Bù

> **读音**：Sān **Shěng** Liù Bù。这里的“省”是官署，读 **shěng**，不是“反省”的 xǐng。
> 英文：Three Departments and Six Ministries。

为 DeepSeek Harness 增加一个 **三省六部模式**：在一个会话内完成“拟旨 → 门下审议 → 派工 → 六部执行 → 刑部取证 → 门下覆核 → 结案回奏”的完整闭环，并提供一个**专属共享任务看板**。

**这个插件不依赖任何共享目录/临时白板。** 所有协调状态（制敕、门禁、任命、证据、结案）都以 append-only 事件写进 **Lead 会话的事件日志**，由 `sansheng` 会话投影折叠出看板。工作区里没有第二个真源，也不存在被外部进程篡改或误删的“任务文件”。

---

## 目录

- [它解决什么问题](#它解决什么问题)
- [与技能的区别](#与技能的区别)
- [安装](#安装)
- [使用流程](#使用流程)
- [工具](#工具)
- [硬门（不是提示词，是工具拒绝）](#硬门)
- [专属看板](#专属看板)
- [状态与持久化](#状态与持久化)
- [与 Agent Teams 的关系](#与-agent-teams-的关系)
- [已知限制](#已知限制)
- [开发与发布](#开发与发布)
- [License](#license)

## 它解决什么问题

多智能体协作最常见的三种事故：

1. **作者自批**：写代码的那个顺手“验证”一下，等于没有复核。
2. **未过门就动手**：计划没人审，返工从第一步开始。
3. **静默停摆 / 进度丢失**：任务存在临时目录里，被清理、被覆盖、被并发写坏。

三省六部模式把这三件事变成**状态机 + 硬门**：

- 计划必须先由**独立门下省**（teammate）审议通过，才能任命六部；
- 复核者不能是 Lead，也不能是被任命的六部成员；
- 结案必须两门都过、每个已完成任务都有刑部证据，否则 `sansheng_close` 直接失败；
- 状态全部在会话日志里，恢复、fork、压缩后仍可重建。

## 与技能的区别

[`three-departments-six-ministries`](https://github.com/matcha-cult/dsh-experimental-sansheng) 技能（同名的 skill）是**流程说明书**：它告诉模型该怎么做，但无法阻止模型偷懒。

本插件是**执行与审计层**：

| | 技能 | 本插件 |
|---|---|---|
| 流程说明 | ✅ | 引用技能，不重复 |
| 工具级硬门 | ❌（靠自觉） | ✅（越权直接报错） |
| 专属看板 | ❌ | ✅（Web 会话页头） |
| 状态持久化 | ❌（可选文件） | ✅（会话事件日志） |

## 安装

发布到 npm 后：

```sh
dsh plugin --profile web add dsh-experimental-sansheng
```

或在 Web/Desktop 的**插件**页搜索 `dsh-experimental-sansheng` 并开启。这是标准 bundle：只要这一行启用，宿主工具、会话投影与浏览器看板同时生效。

本地开发时可以直接从目录安装：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-experimental-sansheng
```

安装后无需额外配置。默认引导文本可以用插件配置覆盖：

```yaml
- id: sansheng
  name: dsh-experimental-sansheng
  config:
    section: |-
      （你的部署版三省六部引导）
    maxExcerptChars: 2000
```

## 使用流程

在任意会话里对 Lead 说“进入三省六部模式”，然后按顺序：

```text
1. 政事堂（Lead）拟旨     sansheng_edict
2. 门下省（独立 teammate）  sansheng_gate { kind: "plan", verdict }
3. 尚书省（Lead）派工     spawn_teammate → sansheng_appoint → team_task_create
4. 六部执行               team_task_* / 文件写入
5. 刑部取证               sansheng_evidence
6. 门下省覆核             sansheng_gate { kind: "result", verdict }
7. 政事堂结案             sansheng_close → 向用户回奏
```

任意成员都可以随时 `sansheng_board` 读当前看板；Lead 可以 `sansheng_mode {action:"status"}` 查看摘要。

## 工具

| 工具 | 调用者 | 作用 |
|---|---|---|
| `sansheng_mode` | Lead（status 任意成员） | 进入/离开/查看模式 |
| `sansheng_edict` | Lead | 拟旨：目标、验收、边界、档位、编制上限、部门 |
| `sansheng_appoint` | Lead | 任命一个 部（一人一部，写作用域仅提示） |
| `sansheng_gate` | 独立 teammate | 计划门 / 成果门：`pass` 或 `reject`（封驳必须带缺陷清单） |
| `sansheng_evidence` | 任意成员（通常刑部） | 登记可复现证据：命令、退出码、digest、有界摘录、关联任务 |
| `sansheng_close` | Lead | 结案/回奏：结论、交付物、残留未知、下一步 |
| `sansheng_board` | 任意成员 | 读紧凑看板状态 |

## 硬门

这些不是提示词约束，而是工具直接抛错：

| 条件 | 错误码 |
|---|---|
| 非 Lead 拟旨/任命/结案 | `LEAD_ONLY` |
| 计划门未过就任命六部 | `PLAN_GATE_NOT_PASSED` |
| 六部成员想复核自己的交付 | `SELF_REVIEW_NOT_ALLOWED` |
| Lead 想当复核者 | `REVIEWER_MUST_BE_TEAMMATE` |
| 成果门先于计划门 | `PLAN_GATE_NOT_PASSED` |
| 封驳但没写缺陷 | `INVALID_FIELD` |
| 通过却带“阻塞缺陷” | `DEFECTS_ON_PASS` |
| 没有证据就要过成果门 | `NO_EVIDENCE_TO_REVIEW` |
| 超编制上限任命 | `ROSTER_CAP_EXCEEDED` |
| 同一成员兼任多个部 | `MEMBER_ALREADY_APPOINTED` |
| 已完成任务缺证据就结案 | `COMPLETED_TASK_WITHOUT_EVIDENCE` |
| 有绝对路径/`..` 的写作用域 | `INVALID_WRITE_SCOPE` |

> 诚实说明：**“任务能不能标完成”本身是 Team 工具（`team_task_update`）的域，本插件拦不住**。  
> 本插件拦的是**“能不能任命、能不能过门、能不能结案”**这三件真正决定交付结论的事；未过门就完成的任务会由看板红区标出。

## 专属看板

会话页头出现 **三省六部** 按钮（只在模式激活时出现），点击打开只读面板：

- **制敕**：目标、档位、编制上限、需要的部门；
- **计划门 / 成果门**：verdict、复核者、缺陷清单；
- **编制**：谁被任命到哪个部、写作用域；
- **证据**：已登记数量、已完成任务数、缺证据任务（红）；
- **结案**：结论、交付物、残留未知；
- **红区**：未拟旨、计划未审、计划被驳、已过门未派工、任务缺证据。

看板读两个会话投影：`sansheng`（本插件发布的看板状态）与 `agentTeam`（Team 名册与任务）。**它是只读投影，不存自己的状态**，因此不会与日志漂移。

## 状态与持久化

六个只追加的日志事件，全部写在 **Lead 会话**：

| 事件 | 语义 |
|---|---|
| `sansheng/mode` | 模式开关（整值替换） |
| `sansheng/edict` | 制敕（整值替换，revision 递增） |
| `sansheng/appoint` | 一条任命 |
| `sansheng/gate` | 一次门禁判定（同一门以后者为准） |
| `sansheng/evidence` | 一条证据（引用执行者会话，不复制大输出） |
| `sansheng/close` | 结案回奏 |

这些事件**不进入模型历史**，只参与投影折叠；压缩（compaction）不会丢失它们。恢复与 fork 后，看板由日志重建。

**没有 `.team/`、没有 `/tmp` 白板、没有可被其他进程改写的任务文件。** 想验证这一点：删掉工作区里所有临时文件，重启会话，看板状态应完全一致。

## 与 Agent Teams 的关系

本插件依赖 DSH 的 Agent Teams（`@deepseek-ai/dsh-experimental-agent-team-profile`）：

- 成员、消息、共享任务板仍然用 Team 的原生工具；
- 三省六部只增加**治理层**（制敕/门禁/证据/编制/结案）；
- 大事档需要 `maxMembers ≥ 9`（官方组合包默认 8），建议在 profile patch 覆盖：

```yaml
- id: agent-team
  config:
    maxMembers: 12
```

## 已知限制

- **模式入口是工具，不是 preset**：目前通过 `sansheng_mode` 进入；后续版本会提供 agent preset 卡片，让新会话直接选择模式。
- **浏览器插件按 profile 加载**：启用/禁用后已有页面可能需要刷新。
- **单进程、共享 checkout**：写作用域只是提示，Bash/格式化工具仍可能越界；Lead 必须做最终 diff 审查。
- **复核者粒度**：目前用“复核者不得是被任命的六部成员”来近似“作者 ≠ 复核者”；更细的任务级作者追踪会在后续版本加入。
- **实验性**：schema 与工具名可能在小版本内调整。

## 开发与发布

```sh
npm install        # 只为本地跑 host 测试
npm run verify     # node --check + node --test
npm pack --dry-run # 检查发布内容
```

发布（需要 npm 登录且拥有该包名）：

```sh
npm login
npm version patch   # 或 minor
npm publish --access public
```

发布物包含：`index.js`（host）、`client.js`（浏览器）、`cordis.patch.yml`（bundle 行）、`src/policy.js`（纯策略层）与文档；`prepack` 会自动跑 `verify`。

目录：

```text
index.js          host 半边：工具 / 投影 / 提示词段落
client.js         浏览器半边：页头按钮 + 看板面板
cordis.patch.yml  bundle 补丁（插入一行）
src/policy.js     纯策略：状态折叠 + 硬门校验（无依赖，可直接单测）
test/             policy 单测 + host 注册冒烟测试
```

## License

MIT
