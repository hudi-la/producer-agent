// 造卡任务归哪个主区。
//
// 判据和主区分法一致：产出的东西有没有 proposal 压力。
//   · 产出机会线的（scout / 你自己丢的 / 盯梢机构 / 邮箱进来的）→ 项目争取
//   · 产出「该找某人说句话了」的 → 人际管理
//
// 单独拎出来放这儿，是因为项目争取的工具条和人际管理那页都要用同一份判断，
// 抄两遍迟早会分叉。
export const PEOPLE_TASK_TYPES = ['relationship_followup']

export const isPeopleTask = (t) => PEOPLE_TASK_TYPES.includes(t.type)
export const isPursuitTask = (t) => !isPeopleTask(t)
