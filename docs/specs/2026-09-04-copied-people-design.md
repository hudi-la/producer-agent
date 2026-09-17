# 被抄送的人、同机构回信的人，自己进通讯录和机会卡（0121）

2026-09-04

## 出了什么事

你给机构发信，机构回信时**抄送了同事 B**，或者**转给 B、B 从自己的地址回你**。
这个 B 在系统里不存在：不在通讯录，不在机会卡的「相关的人」里，也不在「等你点头」。

库里查到的真例（2026-09-04）：

| 谁 | 发生了什么 | 系统现状 |
|---|---|---|
| rachel.masters@arboretum.org | Brooke 8/11 回信时抄送她，之后你回的 4 封都带着她 | 一无所知，任何表里都没有她 |
| meighan@printmuseum.org | Lorna 8/16、8/26 回信时抄送她；**9/4 她自己回了信** | 她的休假自动回复被规则判成「群发」，9/4 那封真回信卡在账本里没进卡片 |
| ipm@printmuseum.org | 你 8/10 写信时抄送过一次 | 一无所知 |
| slapaewa@gmail.com | UCSB 那条线上被抄送 10 次（不同域名） | 一无所知 |

## 为什么会漏

信头里的 To / Cc 从第一天起就存着（`mail_headers.to_emails / cc_emails`），但**整条管线只看 `counterpart_email`**：
判地址、等你点头、认亲、归属，全是按「对面那一个地址」走的。一个只出现在抄送栏里的人，永远轮不到被判。

回信的人（B 从自己地址回）走的是「等你点头」那条路，需要你点一下；而且一次误判（休假自动回复 → 群发）会把这个人的后续真信全堵住。

## 做什么

一条**规则级**的判断，每轮收信后跑，不过模型：

> 一封**在某条线的信串里**的信（`pursuit_threads` 登记过的串），To/Cc 里出现的、或者从中回信的地址，
> 如果**跟这条线上已有的人同一个机构（邮箱域名相同）**，那么这个人就是这条线的人。

满足的 → 自动：建名片 → 认领地址（他名下已有的往来当场归位）→ 挂到这条线上 → 他自己发的信搬进对话表。

不满足「同机构」的（不同域名的抄送）→ 不自动建，写一条判定放进「新联系人」面板，理由写清楚是谁在哪条线抄送的。
看着像共享信箱的（info@ / programs@ 这种，或者没有人名署名）→ 同样进「新联系人」面板，标成机构信箱。

## 来源必须写在人身上

每一个自动收进来的人，三处都写明来路：

- 名片 `contacts.notes`（界面上的「关系记忆」）：`Lorna Turner 8/16 在「工作坊提案 · Book Arts Institute」回信时抄送的（自动收进，0121）`
- 名片 `contacts.meta.source`：结构化的 `{kind, via_email, via_contact_id, pursuit_id, gmail_message_id, at}`，给以后查账用
- 机会卡「相关的人」那一行下面一行小字：`Lorna 8/16 回信时抄送的`（`pursuit_parties.note`，`added_by='rule'`）

「等你点头」里的那些，`why` 一栏就是同一句话。

## 署名从哪来

To/Cc 栏里的显示名以前没存（只存了地址）。这一刀给 `mail_headers` 加一列 `names jsonb`（地址 → 署名），
收信时顺手记；老信没有的，脑子去 Gmail 拿一次信头补上，补完写回库里。
**没有署名就不编名字**：没署名的地址不自动当成人，进「新联系人」面板由你认。

## 动到哪

| 层 | 文件 | 改什么 |
|---|---|---|
| 库 | `supabase/migrations/0121_copied_people_join_the_line.sql` | `mail_headers.names`；`pa_mail_headers_upsert` 存署名；`pa_copied_strangers()` 找候选；`pa_adopt_copied()` 一步建人+认领+挂线；`pa_mail_names_fill()` 回写署名 |
| 脑子 | `brain/mail/addr.js` | `classify()` 输出 `names` |
| 脑子 | `brain/mail/copied.js`（新） | 每轮跑：取候选 → 缺署名的去 Gmail 补 → 判人/信箱 → 同机构的人自动收，其余进等你点头 → 搬他自己的信 |
| 脑子 | `brain/mail/loop.js` | ④.5 之后加 ④.6 |
| 界面 | `src/components/Cast.jsx` | 「相关的人」每行显示来源小字 |

护栏不动：模型不参与这一步；建人只走 `pa_adopt_copied` 一个口；`decided_by='you'` 的判定照旧谁也覆盖不了。

---

# 第二节：一串信里的一伙人（0122）

他的原话：「我在一个机构做事情，这个机构除了我之外，同时还联系了一大堆艺术家。
我也很愿意把他们都收进我的通讯录，并且写清楚是在哪个活动里合作过。」

## 库里长什么样

| 信串 | 发起 | 在场 | 说过话的 | 还没进通讯录 |
|---|---|---|---|---|
| Residency workshop series!（CalArts 驻地） | Cameron Masters 2025-08 | 16 | 6 | 3 |
| XLAB CultureHub LA cohort presentation | Stacy 2026-01 | 11 | 3 | 7 |
| HuDi workshop preparation | Stacy 2026-01 | 11 | 3 | 7 |
| ANTI-FRIEZE FOLLOW UP | Genevieve Fowler 2026-02 | 16 | 3 | 8 |
| Flyers for November 22 | Valeria 2025-11 | 15 | 4 | 4 |
| LAAF meeting online / OpenCall | LAAF 2024-08 | 15 | 3–6 | 8 |

反例：Cevera Yoon 画廊 2026-02 那封发给 121 人的活动通知——只有一个人在说。那是通知，不是一伙人。

## 判据（纯规则，不过模型）

一串信里 **≥2 个人（不算你）说过话、≥5 个人在场、来自 ≥2 个域名、不带群发信头**，其中至少 1 个还没进通讯录。

Gmail 把本地部分里的点当没有（hudicreates@ = hudi.creates@），所以 gmail 地址两种写法都算「我」。

## 不自动收，一伙一格一个按钮

0121 那种「同机构 + 有署名」是规则级证据，可以自动。一伙人是跨机构的十几个陌生人：
收错一伙比漏一伙麻烦，而且「在哪个活动里合作过」那句话该由他定。所以：

- 在「新联系人」面板顶上，每一串一格：主题、谁发起、几个人来回几封、已经认识的是谁、还没进的是谁。
- 「在哪个活动里合作过」预填成信的主题，他改一改。
- 一个按钮「把这 N 个都收进通讯录」：一个个走 `/mail/adopt`（建名片 → 认领地址 → 拉正文写摘要），
  每张名片的「关系记忆」写：`在「活动」里一起合作的人：X 2025-08 发起的信串「主题」，同在收件人里`。
- 同一伙里两个地址一个名字，第二个地址挂到第一张名片上。
- info@ 这种共享信箱不跟着收，留在下面「加人」那格单独认。
- 「这串不算」→ 记在 `thread_marks`，不再出现。收完也记（note 是活动名）。
- 「＋ 新联系人」按钮上带个数：`· 7 伙人等着收`。

## 动到哪

| 层 | 文件 |
|---|---|
| 库 | `0122_a_thread_full_of_people.sql`：`thread_marks` 表、`pa_mark_thread`、`pa_group_threads()` |
| 脑子 | `brain/mail/groups.js`：每轮只做一件事——老信缺的署名去 Gmail 补一次写回来 |
| 界面 | `src/components/Groups.jsx`，挂在 `People.jsx` 的「新联系人」面板顶上；文案在 `src/lib/groupText.js`（有测试） |

## 顺带发现

- `dihu@alum.calarts.edu` 发出过 10 封信，但没登记成「我」的信箱（`mail_accounts` 里只有 gmail）。
  那 10 封现在方向判反了。登记要重算归属，这一刀没动，单独定。
