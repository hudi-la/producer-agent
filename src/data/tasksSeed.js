// Seed mirror of producer.tasks — the card-creating tasks that feed 待批准.
export const TASKS_SEED = [
  { id: 'scout', name: '聚合源 scout', type: 'scout_aggregators', enabled: true, schedule: 'weekly', last_result: '上周新增 3 张' },
  { id: 'manual', name: '你自己丢的', type: 'manual', enabled: true, schedule: null, last_result: null },
  { id: 'monitor', name: '盯梢机构', type: 'institution_monitor', enabled: false, schedule: null, last_result: '未接' },
  { id: 'email', name: '邮箱进来的机会', type: 'email_watch', enabled: false, schedule: null, last_result: '未接' },
  { id: 'followup', name: '关系降温提醒', type: 'relationship_followup', enabled: false, schedule: null, last_result: '未接' },
]

export const TASK_DESC = {
  scout_aggregators: '扫 Creative Capital / Colossal / TransArtists…按你的画像筛、查资格、去重',
  manual: '朋友转的、你刷到的——贴链接 / 截图 / 一句话，我写成卡',
  institution_monitor: '专盯某机构，它开下一轮 open call 就造张卡',
  email_watch: '进你信箱的邀约 / open call → 自动造卡',
  relationship_followup: '某联系人久没动静 → 造张"该 nudge 了"的卡',
}
