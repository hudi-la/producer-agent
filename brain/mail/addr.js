// 从 Gmail 信头算出「这封信是谁跟谁的」。
//
// 纯函数：不碰网络，不碰库，不过模型。单独成文件是因为这是整条链上**最容易
// 判错、判错了又最伤人**的一步——0033 的教训是归属判错比不判更麻烦：当时的
// 判据是「这条线挂了谁，信就都是谁的」，结果 Mattie 名下 13 封里只有 1 封
// 真是她的，Stacy 的告别信被记到了别人卡上。
//
// 判据只能是信头上的地址。而信头是脏的：名字里有逗号、地址带尖括号、
// 同一个人有大小写不同的写法、你自己也可能给自己发信。这些都得在这儿
// 一次性摆平，而且每一条都要有测试压着。

/** 本地部分一看就是机器的。`+`/`.`/`-` 后缀也算（no-reply+123@…）。 */
const MACHINE_LOCAL =
  /^(no-?reply|do-?not-?reply|notification|notifications|mailer-daemon|bounce|bounces|postmaster|automated|auto-confirm|nepliy)([+.\-]|$)/i

/**
 * 信头数组 → 小写键的字典。
 * Gmail 返回的是 [{name, value}]，大小写不保证（`From` / `FROM` / `from` 都见过）。
 * 同名头只留第一条——我们要的那几个都不该重复，重复的（Received）我们也不要。
 */
export function headerMap(headers = []) {
  const m = {}
  for (const h of headers || []) {
    const k = String(h?.name || '').toLowerCase()
    if (!k || k in m) continue
    m[k] = String(h?.value ?? '')
  }
  return m
}

/**
 * 拆一个地址：`毛 <a@x.com>` / `"Li, Wei" <b@y.com>` / `c@z.com`
 * 认不出地址就返回 null——**不猜**。
 */
export function parseAddr(s) {
  const t = String(s ?? '').trim()
  if (!t) return null

  const m = t.match(/<([^<>]*)>/)
  let email = m ? m[1] : t
  let name = m ? t.slice(0, m.index) : ''

  email = email.replace(/^mailto:/i, '').trim().toLowerCase()
  // 名字外面那对引号是信头语法，不是名字的一部分
  name = name.trim().replace(/^"(.*)"$/s, '$1').replace(/\\(.)/g, '$1').trim()

  // 地址长得不像地址就当没有。半通不通地塞进库，后面每一步都会跟着错。
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return { name: name || null, email }
}

/**
 * 拆一串地址。
 * 不能直接 split(',')：逗号会出现在引号里的名字中（`"Li, Wei" <b@y>`），
 * 也会出现在尖括号里的畸形地址中。所以扫一遍，只在「不在引号里、不在尖
 * 括号里」的逗号上断开。
 */
export function parseAddrList(v) {
  const s = String(v ?? '')
  const parts = []
  let buf = ''
  let inQuote = false
  let inAngle = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && inQuote) { buf += c + (s[i + 1] ?? ''); i++; continue }
    if (c === '"') { inQuote = !inQuote; buf += c; continue }
    if (!inQuote && c === '<') inAngle = true
    if (!inQuote && c === '>') inAngle = false
    if (c === ',' && !inQuote && !inAngle) { parts.push(buf); buf = ''; continue }
    buf += c
  }
  parts.push(buf)

  const out = []
  const seen = new Set()
  for (const p of parts) {
    const a = parseAddr(p)
    if (a && !seen.has(a.email)) { seen.add(a.email); out.push(a) }
  }
  return out
}

/**
 * 这封信是群发/机器发的吗？**只看信头，零成本。**
 * 第一层漏斗全靠它——绝大多数订阅、通知、营销都在这一关就下去了。
 *
 * 注意它只是个标记，不是判决：判决在 pa_mail_rule_pass 里，而且那儿还加了
 * 一条「你回过的一律不自动判掉」。宁可多留几个订阅在待判队列里，也不要
 * 判错一个真人。
 */
export function isBulk(h = {}, fromEmail = '') {
  if (h['list-unsubscribe'] || h['list-id']) return true

  const prec = (h['precedence'] || '').trim().toLowerCase()
  if (prec === 'bulk' || prec === 'list' || prec === 'junk') return true

  const auto = (h['auto-submitted'] || '').trim().toLowerCase()
  if (auto && auto !== 'no') return true

  if (h['x-auto-response-suppress']) return true

  const local = String(fromEmail || '').split('@')[0]
  return MACHINE_LOCAL.test(local)
}

/** 把「我的地址」规整成一个小写 Set。传数组、Set、单个字符串都认。 */
export function mineSet(mine) {
  const xs = mine instanceof Set ? [...mine] : Array.isArray(mine) ? mine : [mine]
  return new Set(xs.filter(Boolean).map((s) => String(s).trim().toLowerCase()))
}

/**
 * 一封 Gmail message（format=metadata 就够）→ 一行 mail_headers。
 *
 * 「对面是谁」的判据：**不是我任何一个地址的那一方**。
 *   · 他发来的（From 不是我）→ 对面就是 From
 *   · 我发出的（From 是我）  → 对面是 To/Cc 里第一个不是我的
 *
 * 两个边角都得有确定答案，不能靠运气：
 *   · 我发给我自己 → 对面就是我，direction 记 'out'。它会被当成一个
 *     普通地址判定，然后归到你自己头上——不炸，也不会污染别人。
 *   · 群发给一堆人 → 取第一个不是我的。这不完美（一封信本来就可能有
 *     多个对面），但**归属必须是单一的**，否则「这个人名下有几封信」
 *     这句话就没有意义了。
 *
 * 认不出发件人、或者时间戳算不出来 → 返回 null，这封不入库。
 * sent_at 在库里是 not null，宁可这一封没进来，也不要一个假日期。
 *
 * **草稿也不入库**，理由见下面那段。
 */
export function classify(msg, mine) {
  // ── 草稿不是信 ──
  //
  // 真事：Ana Herruzo 名下挂了 5 封，可只发过 1 封。那 4 封是在 Gmail 里
  // 改草稿——每存一次生成一个新 message id，四次的 sent_at 是 05:33、05:37、
  // 05:46、05:53，收进来的时间是 05:35、05:40、05:50、05:55：**收信循环
  // 每 5 分钟一轮，一轮抓走一份当时的草稿。**
  //
  // 两条路都会抓到它：listIds 的 `-in:chats` 只排掉了聊天，Gmail 搜索默认
  // 包含草稿；而增量那条路用 historyTypes:['messageAdded']，**草稿每存一次
  // 就是一个 messageAdded 事件**。
  //
  // 堵在这儿是因为 toRows 是那两条路唯一的汇流点——堵一处，两条都堵住。
  //
  // 没写出去的东西不是往来。让它进来，「你发出去 N 天没回音」会把草稿算成
  // 发出，通讯录上「几封」也会跟着虚报。
  // ── 没发生的事，不进账本 ──
  //
  // 全量核过一遍（3519 封逐封问 Gmail 要 labelIds）之后，"我写了但还没发出去"
  // 有两种，都会被当成"我发出去了"：
  //
  //   · **草稿**：改一次存一次，每次一个新 message id。Ana Herruzo 那条线
  //     十二分钟内四封，把「碰过几次」直接顶到「碰满三次，停了」——
  //     那等于劝你放弃一条其实还活着的线。
  //   · **定时发送**：写好排着队，sent_at 是未来的时间。真例：一封 8/25 才发
  //     的「Zoom meeting」，8/18 就已经在账本里算作"发出去了"。
  //
  // 判据是**标签**，不是形态。「没主题就是草稿」那个猜测已经错过一次：
  // 回信的草稿会继承 `Re:` 主题，那一批一条都没被认出来。
  //
  //   我发出去的信一定有 SENT。没有 SENT 又是我发的 → 它还没发出去。
  const labels = Array.isArray(msg?.labelIds) ? msg.labelIds : null
  if (labels?.includes('DRAFT')) return null

  const my = mineSet(mine)
  const h = headerMap(msg?.payload?.headers)

  const from = parseAddr(h['from'])
  if (!from) return null

  const to = parseAddrList(h['to'])
  const cc = parseAddrList(h['cc'])

  // internalDate 优先：那是 Gmail 自己记的收发时间，毫秒 epoch，不会被
  // 发件方伪造，也不受时区写法影响。Date 头只是兜底。
  let sent = null
  if (msg?.internalDate) {
    const t = Number(msg.internalDate)
    if (Number.isFinite(t) && t > 0) sent = new Date(t)
  }
  if (!sent && h['date']) {
    const d = new Date(h['date'])
    if (!Number.isNaN(d.getTime())) sent = d
  }
  if (!sent) return null

  const direction = my.has(from.email) ? 'out' : 'in'
  // 我发的，但 Gmail 没给 SENT —— 还没发出去（定时发送在队列里排着）。
  // 只在拿得到标签时才拦：老数据和测试桩没有 labelIds，不该被误伤。
  if (direction === 'out' && labels && !labels.includes('SENT')) return null
  const counterpart = direction === 'in'
    ? from.email
    : ([...to, ...cc].map((a) => a.email).find((e) => !my.has(e)) || from.email)

  return {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    from_email: from.email,
    from_name: from.name,
    to_emails: to.map((a) => a.email),
    cc_emails: cc.map((a) => a.email),
    subject: h['subject'] ? h['subject'].trim() || null : null,
    sent_at: sent.toISOString(),
    counterpart_email: counterpart,
    direction,
    bulk: isBulk(h, from.email),
    // 标签一起带走：**收信时手里就有，记下来账本就是自审的**。
    // 不记的话，「这封信 Gmail 说它是什么」只能靠事后再扫一遍全库
    // ——而那要靠谁记得去扫。见 docs/dev/mail-classification.md
    labels: labels || null,
    // 认亲用的三个头。没有就是没有——大多数群发根本不带 In-Reply-To。
    message_id: (h['message-id'] || '').trim() || null,
    in_reply_to: (h['in-reply-to'] || '').trim() || null,
    refs: parseRefs(h['references']),
  }
}

/** 拉信头时要 Gmail 回哪几个头。多要一个都是白花流量。 */
export const WANT_HEADERS = [
  'From', 'To', 'Cc', 'Subject', 'Date',
  'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted',
  'X-Auto-Response-Suppress',
  // ↓ 「机构里另一个人回了信」全靠这三个。一封真正点回复发出的邮件，
  //   **无论换成哪个地址发**，都带着 In-Reply-To / References 指向原信的
  //   Message-ID（RFC 5322）。Gmail 自己的 threadId 在跨地址、跨客户端时
  //   并不总是把它们归成一串，这三个头比它可靠。
  'Message-ID', 'In-Reply-To', 'References',
]

/** `<a@b> <c@d>` → ['<a@b>', '<c@d>']。空白分隔，原样保留尖括号好做等值比对。 */
export const parseRefs = (v) => String(v ?? '').trim().split(/\s+/).filter((x) => x.startsWith('<'))
