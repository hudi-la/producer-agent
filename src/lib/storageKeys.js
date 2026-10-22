// src/lib/storageKeys.js —— 附件桶里的 key 怎么拼(设计稿 2026-10-02 D10)。
//
// 托管配置下桶的策略只认「以自己的 owner 开头」那一段,所以 key 前面要带 owner;
// 本机 / 他自己那份不带前缀,跟以前一个字不差(brainClient 的 /files/<key> 照旧)。
// **已经存下的 key 永远按存的那串读**,这儿只管新传的怎么起名。
export const BUCKET = 'pursuit-files'

/** 文件名里除了字母数字点横线以外的一律换成 -。中文名在 key 里会出事,但 filename 那列原样留着。 */
export const safeName = (name) =>
  (name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file'

/** 盒子里的文件名:留中文,别的怪字符换成 _(跟 Library.jsx 以前那行一样) */
export const boxSafeName = (name) => (name || 'file').replace(/[^\w.\-一-鿿]+/g, '_')

/** owner 有就加在最前面;没有(本机 / 演示)就原样 */
export const withOwner = (owner, key) => (owner ? `${owner}/${key}` : key)

/** 机会线上的附件:<owner>/<pursuitId>/<uuid>-<name> */
export const attachmentKey = ({ owner, pursuitId, uuid, name }) => withOwner(owner, `${pursuitId}/${uuid}-${safeName(name)}`)

/** 档案条目的盒子:<owner>/box/<entryId>/<stamp>-<name> */
export const boxFileKey = ({ owner, entryId, stamp, name }) => withOwner(owner, `box/${entryId}/${stamp}-${boxSafeName(name)}`)
