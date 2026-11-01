import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ArtifactEditor from '../src/components/ArtifactEditor.jsx'
import { loadAttachment } from '../src/lib/attachmentPreview.js'
import '../src/styles.css'
const samples = [
 { id:'txt',filename:'Processing_Fellowship_2027_Review_v2.txt',mime:'text/plain',storage_key:'txt' },
 { id:'html',filename:'Processing_2027_Submission_Record.html',mime:'text/html',storage_key:'html' },
 { id:'hostile',filename:'安全测试.html',mime:'text/html',storage_key:'hostile' },
 { id:'fail',filename:'失败重试.txt',mime:'text/plain',storage_key:'fail' },
 { id:'other',filename:'未知.bin',mime:'application/octet-stream',storage_key:'other' },
 { id:'slow',filename:'慢请求.txt',mime:'text/plain',storage_key:'slow' },
]
let failCount = 0
const loader = async (file, options) => loadAttachment(file, { ...options, sign: async () => '/attachment-qa/' + file.filename,
 fetcher: async (url, init) => {
   if (file.id==='fail' && failCount++===0) return new Response('', {status:403})
   if (file.id==='fail') return new Response('重试成功：中文正常')
   if (file.id==='other') return new Response('binary')
   if (file.id==='slow') { await new Promise(r=>setTimeout(r,1800)); return new Response('不应覆盖新附件') }
   if (file.id==='hostile') return new Response('<html><head><meta http-equiv="refresh" content="0;url=https://example.com"><style>body{color:green}</style></head><body><h1>安全正文</h1><script>parent.document.body.innerHTML="SCRIPT EXECUTED"</script><a href="https://example.com">外链</a><img src="https://example.com/x" onerror="alert(1)"><form action="https://example.com"><button>发送</button></form></body></html>')
   return fetch(url,init)
 }
})
function QA() {
 const [attachment,setAttachment]=useState(null)
 const [edit,setEdit]=useState(true)
 const [drawer,setDrawer]=useState(false)
 return <><nav>{samples.map(a=><button key={a.id} onClick={()=>setAttachment(a)}>{a.id}</button>)}<button onClick={()=>setDrawer(!drawer)}>切换卡片抽屉</button></nav>
 <div className={'focus '+(drawer?'drawer':'page')}><div className="focus-cols">
 <aside className="fc-l">现有附件入口</aside><div className="fc-m">原卡片内容</div>
 {edit && <ArtifactEditor d={{id:'draft',title:'尚未保存的文档',body:'原草稿'}} hidden={!!attachment} onClose={()=>setEdit(false)} />}
 {attachment && <ArtifactEditor key={attachment.id} attachment={attachment} attachmentLoader={loader} onClose={()=>setAttachment(null)} />}
 </div></div></>
}
createRoot(document.getElementById('root')).render(<QA />)
