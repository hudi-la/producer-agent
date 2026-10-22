// Shared by rendering and materialization: never assign two letters the same artifact.
const clean = value => String(value ?? '').trim() || null
export function parseLetters(text) {
  const src = String(text ?? ''), tag = '[[LETTER]]', letters = []
  let cursor = 0, search = 0, parts = [], at
  while ((at = src.indexOf(tag, search)) >= 0) {
    const start = at + tag.length
    let i = start
    while (/\s/.test(src[i] || '') && i < src.length) i++
    search = start
    if (src[i] !== '{') continue
    let depth = 0, quoted = false, escaped = false, end = -1
    for (; i < src.length; i++) {
      const c = src[i]
      if (quoted) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') quoted = false
      } else if (c === '"') quoted = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') { if (--depth === 0) { end = i + 1; break } }
    }
    if (end < 0) continue
    try {
      const j = JSON.parse(src.slice(start, end)), to = clean(j.to)?.toLowerCase(), body = clean(j.body)
      search = end
      if (!to?.includes('@') || !body) continue
      letters.push({to, body, subject: clean(j.subject) || '(No subject)', summary: clean(j.summary), reply_to: clean(j.reply_to), thread_id: clean(j.thread_id)})
      parts.push(src.slice(cursor, at)); cursor = end
    } catch { /* Keep malformed envelopes visible rather than losing their content. */ }
  }
  parts.push(src.slice(cursor))
  return { clean: parts.map(s => s.trim()).filter(Boolean).join('\n\n'), letters }
}
export function messageLetters(message) {
  if (message?.role !== 'producer') return { clean: message?.content || '', letters: [] }
  const parsed = parseLetters(message.content)
  const stored = Array.isArray(message.meta?.letters) && message.meta.letters.length
    ? message.meta.letters : message.meta?.letter ? [message.meta.letter] : []
  const letters = [...parsed.letters, ...stored]
  // The formerly supported last letter keeps index 0 and its existing edited draft.
  return { clean: parsed.clean, letters: letters.map((letter, i) => ({ letter, index: i === letters.length - 1 ? 0 : i + 1 })) }
}
export function matchesArtifact(item, messageId, index = 0) {
  return item.meta?.artifact_message_id === messageId && (item.meta?.artifact_index ?? 0) === index
}
