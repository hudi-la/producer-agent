// Seed mirror of producer.pursuits / producer.pursuit_messages.
// Zero-config fallback so the pipeline + memory render before Supabase is wired.

export const PURSUITS_SEED = [
  { id: 'ars', title: 'Prix Ars Electronica', org: 'Ars Electronica', location: '林茨', funding: '奖金', deadline: '约 6 周', match_stars: 3, why: '多智能体 AI 装置正中他们对 AI/新媒体的偏好；国际开放，不卡签证。', source: 'scout', eligible: true, stage: 'matching', work_title: null },
  { id: 'gallery', title: '某画廊群展', source: 'manual', match_stars: 2, eligible: true, stage: 'matching', work_title: null },
  { id: 'rijks', title: 'Rijksakademie 驻地', org: 'Rijksakademie', location: '阿姆斯特丹', funding: '生活费+工作室', deadline: '约 8 周', match_stars: 3, source: 'scout', eligible: true, stage: 'pending', work_title: null },
  { id: 'transmediale', title: 'transmediale 征件', org: 'transmediale', location: '柏林', funding: '含制作费', deadline: '约 4 周', match_stars: 3, source: 'scout', eligible: true, stage: 'matching', work_title: null },
  { id: 'eyebeam', title: 'Eyebeam 驻地 2027', org: 'Eyebeam', location: '纽约', funding: 'stipend + 工作空间', deadline: '约 8 周', match_stars: 3, why: '重过程与公共性，偏爱把技术当批评对象、有社会性的创作者。', source: 'scout', eligible: true, stage: 'writing', work_title: 'Echo Chamber Realms' },
  { id: 'newinc', title: 'NEW INC', org: 'New Museum', location: '纽约', source: 'manual', match_stars: 2, eligible: true, stage: 'sent', work_title: 'The Garden of Digital Delights' },
  { id: 'grant', title: '某 AI 艺术 grant', source: 'scout', match_stars: 2, deadline: '第 5 天', eligible: true, stage: 'replying', work_title: 'The Persona Commodity' },
  { id: 'groupshow', title: '某 group show', source: 'manual', match_stars: 2, eligible: true, stage: 'won', work_title: 'Peace Talk' },
  { id: 'filmfest', title: '某影像节', source: 'manual', match_stars: 2, eligible: true, stage: 'paused', work_title: 'The Wheels Never Go Backward' },
  { id: 'creativecap', title: 'Creative Capital', org: 'Creative Capital', location: '美国', funding: '资助', match_stars: 3, why: '很对味，但限美国公民/绿卡——你 O-1 现在申不了。', source: 'scout', eligible: false, stage: 'matching', work_title: null },
]

export const MESSAGES_SEED = {
  eyebeam: [
    { role: 'producer', kind: 'brief', content: 'Eyebeam 是纽约老牌的艺术与技术驻地，不要成品、要过程与公共性——正合你"观众即共同作者"的做法。评审偏爱把技术当批评对象、带社会性的创作者。提供 stipend + 工作空间 + 公共项目支持；国际可申（O-1 没问题）；交项目陈述 · 作品集 · 驻地设想；截止约 8 周。' },
    { role: 'producer', kind: 'message', content: '主打 Echo Chamber Realms——多智能体 AI、参与式，正中他们的偏好。他们也吃"AI 如何重塑人的价值"这类议题，而你 The Persona Commodity 正是讲这个。要不要让陈述带一条 Persona 的线，把批判份量压上去？' },
    { role: 'artist', kind: 'decision', content: '主打 Echo Chamber Realms。Persona 那条线保留，别丢。' },
    { role: 'producer', kind: 'message', content: '记下了 ✎ 主打 Echo Chamber Realms，保留 Persona Commodity 线。往下我按这个写。' },
    { role: 'producer', kind: 'draft', content: "My installations begin from a physicist's habit: to take an invisible structure and make it something you can stand inside. In Echo Chamber Realms, I let multi-agent AI systems talk until patterns of attachment, competition, and care surface on their own — then I stage the encounter so a visitor doesn't just watch the pattern, but meets it in themselves. At Eyebeam I want to push this from a scene one witnesses toward one the visitor co-authors…" },
  ],
}
