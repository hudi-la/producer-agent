// brain/backup/zip.test.js —— 自己写的 zip 得让系统的 unzip 认,也得让自己读回来一字不差。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZipWriter, zipAll, readZip, crc32 } from './zip.js'

const HAS_UNZIP = ['/usr/bin/unzip', '/usr/local/bin/unzip', '/opt/homebrew/bin/unzip'].some((p) => existsSync(p))

test('crc32:标准向量', () => {
  assert.equal(crc32(Buffer.from('')), 0)
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
})

test('写 → 自己读回:store 和 deflate 都一字不差,中文名、空文件、二进制都行', () => {
  const bin = Buffer.alloc(5000); for (let i = 0; i < bin.length; i++) bin[i] = (i * 7) & 0xff
  const entries = [
    { name: 'manifest.json', data: JSON.stringify({ version: 1 }), deflate: true },
    { name: 'tables/works.json', data: '[' + '{"a":1},'.repeat(2000).slice(0, -1) + ']', deflate: true },
    { name: 'files/box/作品 一.png', data: bin },
    { name: 'files/empty.txt', data: Buffer.alloc(0) },
  ]
  const zip = zipAll(entries, { now: () => new Date(2026, 9, 2, 12, 34, 56) })
  const back = readZip(zip)
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name))
  for (let i = 0; i < entries.length; i++) {
    const want = Buffer.isBuffer(entries[i].data) ? entries[i].data : Buffer.from(entries[i].data)
    assert.ok(back[i].data.equals(want), `${entries[i].name} 内容变了`)
  }
  // deflate 真压了:两千个重复对象(16KB)压成几十字节;5000 字节的二进制原样存
  assert.ok(zip.length < bin.length + 600, `包太大:${zip.length}`)
})

test('ZipWriter 分段写出的字节拼起来 = zipAll 整包', () => {
  const now = () => new Date(2026, 0, 1)
  const w = new ZipWriter({ now })
  const parts = [w.add('a.txt', 'hello'), w.add('b.json', '{"x":1}', { deflate: true }), w.finish()]
  assert.ok(Buffer.concat(parts).equals(zipAll([{ name: 'a.txt', data: 'hello' }, { name: 'b.json', data: '{"x":1}', deflate: true }], { now })))
})

test('坏包当场报:不是 zip、CRC 对不上', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all, really not')), /不是 zip/)
  const zip = zipAll([{ name: 'a.txt', data: 'hello world' }])
  const i = zip.indexOf('hello world'); zip[i] = 'j'.charCodeAt(0)
  assert.throws(() => readZip(zip), /校验不过/)
})

test('系统 unzip 认得我们写的包(有就跑,没有跳过)', { skip: !HAS_UNZIP && '这台机器没有 unzip' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'fw-zip-'))
  try {
    // 解出来的那一步用 ASCII 名:macOS 自带的 Info-ZIP 6.0 校验 UTF-8 名没问题,落盘时却会把名字写坏(它的老毛病,不是包的)。
    // 中文名的往返由上面纯 JS 读回那条管。
    const zip = zipAll([{ name: 'manifest.json', data: '{"version":1}', deflate: true }, { name: 'files/p1/pic.bin', data: Buffer.from([0, 1, 2, 255]) }])
    writeFileSync(join(dir, 't.zip'), zip)
    const listing = execFileSync('unzip', ['-l', join(dir, 't.zip')], { encoding: 'utf8' })
    assert.match(listing, /manifest\.json/); assert.match(listing, /files\/p1\/pic\.bin/)
    execFileSync('unzip', ['-q', '-o', join(dir, 't.zip'), '-d', join(dir, 'out')])
    assert.equal(readFileSync(join(dir, 'out', 'manifest.json'), 'utf8'), '{"version":1}')
    assert.ok(readFileSync(join(dir, 'out', 'files', 'p1', 'pic.bin')).equals(Buffer.from([0, 1, 2, 255])))
    // unzip -t 校验 CRC
    assert.match(execFileSync('unzip', ['-t', join(dir, 't.zip')], { encoding: 'utf8' }), /No errors/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
