import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

// 库里的文字**都是 markdown**，一律走这儿渲。
//
// 本来这个组件只活在 PursuitFocus 里，于是名片那一栏是纯文本——Fairwind 写的
// 「**你想请教的到底是哪一类事**」在机会线上是粗体，在名片上就是四个星号
// 明晃晃摆在脸上。同一份内容两个样子，而且丑的那个看起来像坏了。
//
// remark-breaks：单个换行就换行。标准 markdown 里单换行等于空格，
// 可 Fairwind 和 scout 写进库的东西是按行分的（「**流程**：…\n**判断**：…」），
// 不加这个插件，三行会被粘成一坨。
export default function Md({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{ a: (props) => <a target="_blank" rel="noreferrer" {...props} /> }}
    >
      {children || ''}
    </ReactMarkdown>
  )
}
