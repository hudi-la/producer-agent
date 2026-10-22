import test from 'node:test'
import assert from 'node:assert/strict'
import { renderBody } from './render.js'

test('粗体是粗体，不是四个星号', () => {
  const { html, text } = renderBody('请看**这一句**。')
  assert.match(html, /<strong>这一句<\/strong>/)
  // 纯文本那份原样留着 md —— 纯文本客户端里 **这样** 读得懂，
  // 硬把星号删掉反而丢了强调
  assert.equal(text, '请看**这一句**。')
})

test('单个换行就换行——Fairwind 写的东西是按行分的', () => {
  const { html } = renderBody('第一行\n第二行')
  assert.match(html, /第一行<br>\s*第二行/)
})

test('列表是列表', () => {
  const { html } = renderBody('- 甲\n- 乙')
  assert.match(html, /<ul>[\s\S]*<li>甲<\/li>[\s\S]*<li>乙<\/li>[\s\S]*<\/ul>/)
})

test('链接能点', () => {
  assert.match(renderBody('见 https://hudiworks.com').html, /<a href="https:\/\/hudiworks\.com"/)
})

test('空正文不炸', () => {
  const { text, html } = renderBody('')
  assert.equal(text, '')
  assert.equal(html.trim(), '')
})

test('null / undefined 也不炸——正文是空的该在上一层拦，不该在这儿抛', () => {
  assert.equal(renderBody(null).text, '')
  assert.equal(renderBody(undefined).html.trim(), '')
})

test('渲染是同步的，交出来的是字符串不是 Promise', () => {
  assert.equal(typeof renderBody('一句话').html, 'string')
})

test('信里的 < > & 不会变成标签——收件人名字里带 < 的时候会撞上', () => {
  const { html } = renderBody('条件是 a < b & c > d')
  assert.match(html, /&lt; b &amp; c &gt;/)
  assert.doesNotMatch(html, /<b>/)
})
