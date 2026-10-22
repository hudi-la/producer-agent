import { useEffect, useState } from 'react'
import { logUiError } from '../lib/errorTelemetry.js'
import { errorText } from '../lib/userError.js'
import { describeError } from '../lib/userError.js'
import { t } from '../i18n/index.js'

export default function ErrorNotice({ error, context, onRetry }) {
  const [diagnosticId, setDiagnosticId] = useState(null)
  const message = errorText(error)
  useEffect(() => { setDiagnosticId(message ? logUiError(error, context) : null) }, [message, context])
  if (!error) return null
  const info = describeError(error, context)
  return <div className="error-notice" role="alert" aria-live="polite">
    <div className="error-notice-title"><span aria-hidden="true">!</span><strong>{info.title}</strong></div>
    {context && <p className="error-notice-context">{context}</p>}
    {info.kind === 'unknown' && info.detail && <p>{info.detail}</p>}
    <p>{info.action}</p>
    {info.detail && <details><summary>{t('查看具体原因 / 诊断信息')}</summary><pre>{info.detail}</pre></details>}
    {diagnosticId && <p className="error-notice-id">{t('错误编号：')}<code>{diagnosticId}</code></p>}
    {onRetry && <button type="button" className="b" onClick={onRetry}>{t('重试')}</button>}
  </div>
}
