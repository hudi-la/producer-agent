// src/i18n/en.misc-c.js —— 铃铛(通知面板)、卡片里的对话、档案层零碎。待合并进 en.js。
export default {
  // ── 铃铛 / 通知面板 ──
  '消息': 'Messages', '{n} 件': '{n} due', '收起看板气泡': 'Hide board bubbles', '打开看板气泡': 'Show board bubbles',
  '（没名字）': '(no name)', '已处理 —— 记一笔，留痕迹': 'Handled — logs a note so there is a trace', '已处理': 'Handled',
  '改到点日': 'Change the due date', '改期': 'Reschedule', '打开卡片': 'Open card', '{title}（{n}）': '{title} ({n})',
  '刚刚': 'just now', '{n} 分钟前': '{n} min ago', '{n} 小时前': '{n} h ago',
  '账面截至{ago}收信。': 'Mail is current as of {ago}. ', '你刚发的信要等下一轮': 'A letter you just sent waits for the next round',
  '（≤5 分钟）才会把对应的条目消掉 —— 那不是没记上，是还没收到。': ' (≤5 min) before its entry clears — it was recorded, just not fetched yet.',
  '没连上数据库（.env.local 里的 VITE_SUPABASE_* 没填）。': 'No database connection (VITE_SUPABASE_* in .env.local is empty). ',
  '连上了但查询报错。': 'Connected, but the query failed. ', '这不是「你没有要办的事」。': 'This does not mean you have nothing to do.',
  '正在读近期往来重判…': 'Reading recent exchanges to re-judge…',
  '还有 {n} 条最近有往来的在排队重判（每 5 分钟自动判一批）。': '{n} more with recent exchanges are queued for re-judging (a batch runs every 5 min). ',
  '现在就判': 'Judge now', '今天：': 'Today:', '现在没有到点的。看看新机会吧。': 'Nothing is due right now. Go look at new opportunities.',
  '等待': 'Waiting', '还没到点的。到了那天自动挪到上面 —— 中间对方回了，它自己就没了。': 'Not due yet. On the day it moves up on its own — and if they reply in the meantime, it simply disappears.',
  '还有 {n} 个地址的往来没归到任何线，在': '{n} more addresses have mail not filed to any pursuit. Handle them on the ', '人际管理页': 'People page', '处理。': '.',
  // ── 出事横幅 ──
  '另开一个终端跑 ': 'Open another terminal and run ', '到跑 brain 的那个终端按 Ctrl-C，再 ': 'In the terminal running the brain, press Ctrl-C, then ',
  // ── 对话(机会线 / 名片 / 一起写共用) ──
  'Fairwind 的脑子没开 —— 另开一个终端跑 npm run brain': "Fairwind's brain isn't running — open another terminal and run npm run brain",
  '脑子出错了（{status}）': 'The brain hit an error ({status})', 'Fairwind 那边断了 —— 再说一次让它重想': 'Fairwind got cut off — say it again to let it rethink',
  '还没连上库': 'No database connection yet',
  '没记上：': "Didn't get noted: ", '（你的话还在框里，没丢）': " (your message is still in the box, nothing lost)",
  '（你的话存下了，Fairwind 没想完 —— 再说一次让它重想）': " (your message was saved but Fairwind didn't finish — say it again to let it rethink)",
  '没撤成：': "Couldn't take it back: ", '（你改的字还在，可以再按一次重说）': " (your edit is still there; press Resay again)",
  '在想…': 'Thinking…', '在网上找资料…': 'Searching the web…', '在读一个网页…': 'Reading a web page…',
  '在翻这条线上的文件…': 'Going through the files on this pursuit…', '在看那件作品的图…': 'Looking at the image of that work…', '在翻信箱…': 'Going through the mailbox…',
  // ── 本机模式 ──
  '没有这个文件:{key}': 'No such file: {key}', '本机模式没有登录这回事': 'There is no sign-in in local mode',
}
