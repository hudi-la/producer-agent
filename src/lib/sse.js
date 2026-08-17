// 读 SSE 的两件小事。单独放这儿是为了能测——它们不碰 fetch、不碰后端配置。
//
// 为什么不用 EventSource：那个只会发 GET，而我们要把一整段话 POST 过去。
// 于是切帧这活得自己干，而自己干最容易错的就是「一帧被拆在两个网络包里」。

/**
 * 把陆续到的字节切成一帧一帧。SSE 里一帧以空行收尾。
 *
 * **半帧不能丢。** 网络包的边界跟帧边界没有任何关系，一个 delta 帧被从中间劈开
 * 是常事；push 只吐完整的帧，剩下的半截留在肚子里等下一块。
 */
export function frameSplitter() {
  let buf = ''
  return {
    push(chunk) {
      buf += String(chunk).replace(/\r\n/g, '\n')
      const out = []
      let i
      while ((i = buf.indexOf('\n\n')) !== -1) {
        out.push(buf.slice(0, i))
        buf = buf.slice(i + 2)
      }
      return out
    },
    /** 流结束了，把肚子里剩的交出来（正常收尾时应该是空的）。 */
    rest() {
      const r = buf
      buf = ''
      return r
    },
  }
}

/**
 * 一帧里的 data: 载荷，解成对象。
 *
 * 解不出来返回 null，调用方直接跳过：注释帧（`:` 开头的心跳）和空行走的就是
 * 这条路，它们不是错误，不该炸掉整条流。
 */
export function frameData(frame) {
  const line = String(frame).split('\n').find((l) => l.startsWith('data:'))
  if (!line) return null
  const raw = line.slice(5).trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}
