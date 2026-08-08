import { createContext, useContext } from 'react'
import { supa, DB_CONFIGURED } from './backends.js'

// 「我的档案」——关于你自己的事实。
//
// 这些东西本来就在库里（producer.profile，0001 就有了），但同一批事实被存了两遍：
// 库里一份，Fairwind 的 prompt 里又抄了一份写死的字符串（"美国 O-1，常住 LA / 湾区"），
// 界面上还有第三份（三处硬编码的 'O-1 · 资格搁置'）。三份会飘。
//
// 现在只有库里那一份是真的，另外两处都来读它。而且你能在界面上改 ——
// O-1 变绿卡那天不用改代码、不用开 SQL。

// 连不上库时的兜底。不是「假数据」，是「这个字段的形状」——
// 界面永远渲染得出来，但不会假装知道你的签证。
export const PROFILE_FALLBACK = { id: null, name: null, website: null, data: {}, updated_at: null }

export async function loadProfile() {
  if (!DB_CONFIGURED) return PROFILE_FALLBACK
  try {
    const { data, error } = await supa.from('v_pa_profile').select('*').limit(1)
    if (error || !data?.length) return PROFILE_FALLBACK
    return { ...data[0], data: data[0].data || {} }
  } catch (_) {
    return PROFILE_FALLBACK
  }
}

/**
 * 改档案。
 *   name / website —— 传空字符串 = 不动（不是清空）。这两样清空了没有意义。
 *   data           —— 只合并传进来的键，没传的原样留着；顶层键整个替换，
 *                     所以 location 这种数组传新的就是换掉，不会拼接。
 */
export async function saveProfile({ name = null, website = null, data = null } = {}) {
  if (!supa) throw new Error('没连上数据库（检查 .env.local 里的 VITE_SUPABASE_*）')
  const { error } = await supa.rpc('pa_set_profile', {
    p_name: name, p_website: website, p_data: data,
  })
  if (error) throw new Error(error.message)
}

// 卡片、详情页、档案页都要说「因为什么资格搁置」，但它们隔着三四层组件。
// 与其把 profile 一路当 prop 传下去，不如开一个 context —— 这是个全局事实。
export const ProfileContext = createContext(PROFILE_FALLBACK)
export const useProfile = () => useContext(ProfileContext)

/**
 * 「O-1 · 资格搁置」里那个 O-1。
 * 档案里没填签证就只说「资格搁置」—— 不编一个身份出来。
 */
export function heldLabel(profile) {
  const visa = profile?.data?.visa
  return visa ? `${visa} · 资格搁置` : '资格搁置'
}

/** 给 Fairwind 拼上下文用：把档案里会影响判断的事实摊成几行人话。 */
export function profileLines(profile) {
  const d = profile?.data || {}
  const j = (x) => (Array.isArray(x) ? x.join('、') : x)
  return [
    profile?.name && `艺术家：${profile.name}${profile.website ? `（${profile.website}）` : ''}`,
    d.visa && `身份：${d.visa}`,
    d.location && `常住：${j(d.location)}`,
    d.career_stage && `阶段：${d.career_stage}`,
    d.funding_pref && `资助偏好：${d.funding_pref}`,
    d.exclude_rule && `排除规则：${d.exclude_rule}`,
    d.watch_rule && `关注规则：${d.watch_rule}`,
    d.directions && `创作方向：${j(d.directions)}`,
  ].filter(Boolean).join('\n')
}
