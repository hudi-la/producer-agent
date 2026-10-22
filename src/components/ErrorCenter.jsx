import { useEffect, useState } from 'react'
import ErrorNotice from './ErrorNotice.jsx'
import { errorText } from '../lib/userError.js'
import { t } from '../i18n/index.js'

export default function ErrorCenter() {
  const [items, setItems] = useState([])
  useEffect(() => {
    const receive = ({ detail }) => setItems((current) => {
      const key = detail.context + errorText(detail.error)
      if (current.some((item) => item.key === key)) return current
      return [...current, { ...detail, key }]
    })
    window.addEventListener('fairwind-error', receive)
    return () => window.removeEventListener('fairwind-error', receive)
  }, [])
  if (!items.length) return null
  return <aside className="error-center" aria-label={t('操作错误')}>
    {items.map((item) => <div key={item.key} className="error-center-item">
      <ErrorNotice error={item.error} context={item.context} />
      <button type="button" className="error-center-close" aria-label={t('关闭提示')} onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}>×</button>
    </div>)}
  </aside>
}
