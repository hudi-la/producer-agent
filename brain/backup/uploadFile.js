import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'

// Native HTTP preserves backpressure; do not route large bodies through fetch.
export async function putFile(url, file, type) {
  const size = (await stat(file)).size
  const endpoint = new URL(url)
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Invalid storage URL')
  let req
  const response = new Promise((resolve, reject) => {
    req = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(endpoint, {
      method: 'PUT', headers: { 'content-type': type, 'content-length': size, 'cache-control': 'max-age=3600', 'x-upsert': 'true' },
    }, res => {
      res.resume()
      res.on('error', reject)
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`附件上传失败 HTTP ${res.statusCode}`)))
    })
    req.on('error', reject)
    req.setTimeout(120_000, () => req.destroy(new Error('附件上传超时')))
  })
  response.catch(() => {})
  try { await Promise.all([pipeline(createReadStream(file), req), response]) }
  finally { req.destroy() }
}

export async function uploadFile(bucket, key, file, type) {
  if (bucket.createSignedUploadUrl) {
    const { data, error } = await bucket.createSignedUploadUrl(key, { upsert: true })
    if (error) throw new Error(error.message)
    await putFile(data.signedUrl, file, type)
  } else {
    // Local storage adapter and test doubles.
    const body = createReadStream(file)
    try {
      const { error } = await bucket.upload(key, body, { contentType: type, upsert: true, duplex: 'half' })
      if (error) throw new Error(error.message)
    } finally { body.destroy() }
  }
}
