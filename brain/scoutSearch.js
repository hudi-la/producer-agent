// Durable, bounded search stage. Dependencies are injected so the real runner and
// local mock tests exercise the same code without paid model calls.
import { profileBlock, parseCards, pick, haltKind } from './scout.js'
import { resumeScoutQueue, addCandidates, parseCandidates, queueRemaining } from './scoutQueue.js'

// Each source discovers links, then each candidate is verified in a bounded
// conversation. The queue lives in tasks.config and survives process restarts.
export async function scoutSearch(t, ctx, profile, R, existing, availableCalls, { db, think, readTools, systemFor }) {
  const q = resumeScoutQueue(t.config?.scout_progress, t.prompt)
  q.rechecked = (q.rechecked || 0) + R.checked.length
  q.opened = (q.opened || 0) + R.opened.length
  q.closed = (q.closed || 0) + R.closedNow.length
  q.recheck_pending = false
  if (R.leftToCheck) q.leftToCheck = R.leftToCheck
  const callsCap = Math.max(0, Math.floor(availableCalls))
  const candidatesPerSource = Math.min(8, Math.max(1, Math.floor(Number(t.config?.candidates_per_source) || 4)))
  const resumeMins = Math.min(1440, Math.max(5, Math.floor(Number(t.config?.search_resume_minutes) || 180)))
  const save = async (result = null, delay = null) => {
    q.updated_at = new Date().toISOString()
    const { error } = await db.rpc('pa_scout_checkpoint', {
      p_id: t.id, p_progress: q, p_result: result, p_delay_minutes: delay,
    })
    if (error) throw new Error('保存搜索进度失败：' + error.message)
  }
  const criteria = String(t.prompt || '').split('{{画像}}').join(profileBlock(ctx)).slice(0, 9000)
  const sys = systemFor(profile)
  let calls = 0
  let activeItem = null
  await save()

  // A parsed result is saved before inserting cards. If the process stops
  // between those writes, resume flushes it without another model call.
  const writeVerified = async (candidate) => {
    const parsed = candidate.result
    if (!parsed) return
    const { take, dup } = pick(parsed.cards || [], existing)
    R.dupFound.push(...dup)
    R.skipped.push(...(parsed.skipped || []))
    for (const c of take) {
      const { data, error } = await db.rpc('pa_upsert_opportunity', {
        p_title: c.title, p_org: c.org, p_kind: c.kind, p_location: c.location,
        p_funding: c.funding, p_url: c.url, p_deadline: c.deadline,
        p_deadline_at: c.deadline_at, p_opens_at: c.opens_at, p_status: c.status,
        p_fit_stars: c.match_stars, p_eligible: c.eligible, p_why: c.why, p_notes: c.notes,
        p_source: t.type, p_task_id: t.id,
      })
      if (error) throw new Error(`「${c.title}」进表失败：${error.message}`)
      if (data?.created) { R.found.push(c); q.added++; existing.push(c) }
      else R.dupFound.push(c)
    }
    q.skipped += (parsed.skipped || []).length
    candidate.done = true; candidate.result = null; q.completed++
    await save()
  }

  try {
    for (const c of q.candidates.filter((x) => !x.done && x.result)) await writeVerified(c)
    while (calls < callsCap && queueRemaining(q)) {
      const unit = q.units.find((x) => !x.done)
      if (unit) {
        activeItem = unit
        const prompt = `Discover candidate opportunity URLs from this ONE ${unit.kind}: ${unit.value}. Prioritize the strongest matches. Use WebFetch/WebSearch as needed. Do not judge them yet.\n\nArtist criteria:\n${criteria}\n\nOnly work on ${unit.value} in this call, even if the criteria mention other sources. Return at most ${candidatesPerSource} URLs. Your FINAL line must be [[CANDIDATES]] {"urls":["https://..."]}. An empty array is valid.`
        const { text } = await think(prompt, readTools, sys, null, null, null, 8)
        calls++
        const urls = parseCandidates(text)
        if (!urls) throw new Error(`来源「${unit.value.slice(0, 80)}」没有按候选链接格式返回`)
        addCandidates(q, urls.slice(0, candidatesPerSource), unit.value)
        unit.done = true; q.completed++
        await save()
        activeItem = null
        continue
      }
      const candidate = q.candidates.find((x) => !x.done)
      if (!candidate) break
      activeItem = candidate
      const prompt = `Verify ONE candidate. Open its OFFICIAL page; if this is an aggregator, follow it to the official page. Check the current edition's open status, real deadline, eligibility and required materials. If no official page is accessible, the match is poor, or the scheme is vanity, put it in skipped. Keep high-match closed calls with status=closed and an opens_at date only if supported. Citizenship/work-authorization restrictions should be recorded with eligible=false. Never invent a date. Do not search for other opportunities.\nCandidate: ${candidate.url}\nSource: ${candidate.source}\nToday: ${ctx.today} (${ctx.tz})\nArtist criteria:\n${criteria}\n\nYour FINAL line must be [[CARDS]] {"cards":[{"title":"...","kind":"...","org":"...","location":"...","funding":"...","deadline":"official wording or null","deadline_at":"YYYY-MM-DD or null","opens_at":"YYYY-MM-DD or null","url":"official URL","status":"open or closed","match_stars":3,"why":"...","notes":"required materials","eligible":true}],"skipped":[{"title":"...","why":"..."}]}. Maximum one card; empty arrays are valid.`
      const { text } = await think(prompt, readTools, sys, null, null, null, 8)
      calls++
      const parsed = parseCards(text)
      if (!parsed) throw new Error(`候选「${candidate.url}」没有按机会格式返回`)
      candidate.result = { cards: parsed.cards.slice(0, 1), skipped: parsed.skipped }
      await save()
      await writeVerified(candidate)
      activeItem = null
    }
  } catch (err) {
    const kind = haltKind(err.message)
    if (activeItem) activeItem.failures = (activeItem.failures || 0) + 1
    q.status = kind === 'quota' ? 'paused' : 'failed'
    q.note = err.message
    const delay = kind === 'quota' || kind === 'auth' ? 1440
      : (activeItem?.failures || 0) >= 3 ? 10080 : resumeMins
    await save(`${ctx.today}\n⚠️ 搜索已暂停：${err.message}\n已完成 ${q.completed} 项，新增 ${q.added} 个；剩余 ${queueRemaining(q)} 项。进度已保留，${t.enabled ? '稍后自动继续' : '手动运行后继续'}。`, delay)
    return { paused: true, reason: err.message, remaining: queueRemaining(q), added: q.added, calls }
  }
  if (queueRemaining(q)) {
    q.status = 'paused'; q.note = '本批次模型调用预算已用完'
    await save(`${ctx.today}\n搜索分批暂停：已完成 ${q.completed} 项，新增 ${q.added} 个；剩余 ${queueRemaining(q)} 项。${t.enabled ? `约 ${resumeMins} 分钟后自动继续` : '手动运行后继续'}。`, resumeMins)
    return { paused: true, remaining: queueRemaining(q), added: q.added, calls }
  }
  q.status = 'complete'
  await save()
  return { paused: false, added: q.added, calls, queue: q }
}
