/** GET /pair — a minimal page: connect a wallet, pick a Counsel, sign WorkerAuthorization, register the agent. */
import type { App } from "./app.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function pairPage(app: App, code: string | null): string {
  const cfg = { chainId: app.cfg.chainId, chainHex: `0x${app.cfg.chainId.toString(16)}`, code: code ?? "" };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pair a seat — Company.md</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Silkscreen&display=swap" rel="stylesheet">
<style>
:root{--bg:#000;--panel:#0A0A0A;--rule:#262626;--text:#E9E3D3;--muted:#8C877A;--brass:#C9A227;--ox:#9E2A2B;--verd:#4FA38A}
*{box-sizing:border-box;border-radius:0}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 "IBM Plex Mono",ui-monospace,monospace;padding:16px}
main{max-width:640px;margin:40px auto;border:2px solid var(--rule);background:var(--panel);padding:24px}
h1,h2,button,.label{font-family:Silkscreen,monospace;text-transform:uppercase;letter-spacing:.04em}h1{font-size:22px;margin:0 0 4px;color:var(--brass)}
h2{font-size:14px;margin:24px 0 8px}p{color:var(--muted);margin:6px 0}code{color:var(--text)}
button{background:var(--brass);color:#000;border:2px solid var(--brass);padding:10px 14px;cursor:pointer;font-size:13px;clip-path:polygon(4px 0,calc(100% - 4px) 0,100% 4px,100% calc(100% - 4px),calc(100% - 4px) 100%,4px 100%,0 calc(100% - 4px),0 4px)}
button[disabled]{opacity:.4;cursor:default}select,input{background:#000;color:var(--text);border:2px solid var(--rule);padding:8px;font:inherit;width:100%}
.row{display:flex;gap:8px;align-items:center;margin:8px 0}.ok{color:var(--verd)}.err{color:var(--ox)}#log{white-space:pre-wrap;font-size:13px;border-top:2px solid var(--rule);margin-top:20px;padding-top:12px;min-height:2em}
</style></head><body><main>
<h1>Pair a seat</h1><p>In re: device pairing. Your wallet signs one authorisation binding this device to one Counsel. Nothing is sent on chain at this step.</p>
<h2>01 Code</h2><input id="code" placeholder="ABCD-EFGH" value="${esc(cfg.code)}" maxlength="9">
<h2>02 Wallet</h2><div class="row"><button id="connect">Connect wallet</button><span id="who" class="label"></span></div>
<h2>03 Counsel</h2><select id="seat" disabled><option>Connect first</option></select>
<h2>04 Sign</h2><button id="sign" disabled>Sign authorisation</button>
<h2>05 Register agent</h2><p>An unregistered seat cannot connect. Registration calls the ERC-8004 IdentityRegistry once (gas).</p><button id="register" disabled>Register</button>
<div id="log"></div><p>Company.md · <a href="${esc(app.cfg.publicWebUrl)}">${esc(app.cfg.publicWebUrl.replace(/^https?:\/\//, ""))}</a> · <a href="mailto:${esc(app.cfg.contactEmail)}">${esc(app.cfg.contactEmail)}</a> · Not affiliated with Robinhood.</p>
</main>
<script>
const CFG=${JSON.stringify(cfg)};const $=id=>document.getElementById(id);let account=null,pairing=null,paired=null;
const log=(m,c)=>{const d=document.createElement('div');d.textContent=m;if(c)d.className=c;$('log').appendChild(d)};
const api=async(p,o)=>{const r=await fetch(p,o);const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.detail||j.error||r.status);return j};
$('connect').onclick=async()=>{try{if(!window.ethereum)throw new Error('no wallet in this browser');[account]=await ethereum.request({method:'eth_requestAccounts'});
try{await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:CFG.chainHex}]})}catch(e){log('switch to chain '+CFG.chainId+' in your wallet','err')}
$('who').textContent=account.slice(0,6)+'…'+account.slice(-4);const w=await api('/pair/wallet/'+account+'?fresh=1');const s=$('seat');s.innerHTML='';
if(!w.seats.length){s.innerHTML='<option>No Counsel held by this wallet</option>';return}
for(const x of w.seats){const o=document.createElement('option');o.value=x.tokenId;o.textContent='Counsel #'+String(x.tokenId).padStart(4,'0')+(x.enrolled?' (has a device)':'')+(x.registered?'':' (unregistered)');s.appendChild(o)}
s.disabled=false;$('sign').disabled=false}catch(e){log(e.message,'err')}};
$('sign').onclick=async()=>{try{const code=$('code').value.trim().toUpperCase();pairing=await api('/pair/'+code);if(pairing.consumed)throw new Error('code already used');
const msg={deviceKey:'0x'+pairing.deviceKey,wallet:account,tokenId:$('seat').value,nonce:pairing.nonce,expiresAt:pairing.expiresAt,relayOrigin:pairing.relayOrigin};
const td={domain:{name:'Company.md Worker',version:'1',chainId:CFG.chainId},primaryType:'WorkerAuthorization',types:{EIP712Domain:[{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'}],
WorkerAuthorization:[{name:'deviceKey',type:'bytes32'},{name:'wallet',type:'address'},{name:'tokenId',type:'uint256'},{name:'nonce',type:'bytes32'},{name:'expiresAt',type:'uint64'},{name:'relayOrigin',type:'string'}]},message:msg};
const signature=await ethereum.request({method:'eth_signTypedData_v4',params:[account,JSON.stringify(td)]});
paired=await api('/pair/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,message:msg,signature})});
log('Filed. Device paired to Counsel #'+paired.tokenId+'.','ok');if(!paired.registered){$('register').disabled=false;log('Next: register the agent.')}else log('Already registered as agent '+paired.agentId+'. Return to your terminal.','ok')}catch(e){log(e.message,'err')}};
$('register').onclick=async()=>{try{const it=await api('/agents/register-intent?tokenId='+paired.tokenId);const hash=await ethereum.request({method:'eth_sendTransaction',params:[{from:account,to:it.to,data:it.data}]});
log('Sent '+hash+'. Waiting for the receipt…');let rc=null;for(let i=0;i<90&&!rc;i++){await new Promise(r=>setTimeout(r,2000));rc=await ethereum.request({method:'eth_getTransactionReceipt',params:[hash]})}
if(!rc)throw new Error('no receipt yet; bind later from the CLI');const topic='0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a';
const lg=rc.logs.find(l=>l.address.toLowerCase()===it.to.toLowerCase()&&l.topics.length>1);if(!lg)throw new Error('Registered event not found');const agentId=BigInt(lg.topics[1]).toString();void topic;
const b=await api('/agents/bind',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tokenId:paired.tokenId,agentId})});log(b.bound?'On the record: agent '+agentId+'. Return to your terminal.':'Pending; retry shortly.','ok')}catch(e){log(e.message,'err')}};
</script></body></html>`;
}
