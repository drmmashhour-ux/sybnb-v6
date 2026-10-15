"""Frontend-only dashboard validation using a simulated injected wallet; no signing."""
import os
from playwright.sync_api import sync_playwright, expect
WALLET = """() => {
const listeners={};
const string = s => '0x'+(32).toString(16).padStart(64,'0')+s.length.toString(16).padStart(64,'0')+Array.from(s).map(c=>c.charCodeAt(0).toString(16)).join('').padEnd(64,'0');
window.mshCheck={chain:'0xaa36a7',account:'0x1cd061108642ae8dbdb446e8ebe59ab714974b94',reject:false,requests:[]};
window.ethereum={on:(e,fn)=>(listeners[e]??=[]).push(fn),removeListener:(e,fn)=>listeners[e]=(listeners[e]||[]).filter(f=>f!==fn),request:async r=>{
 const s=window.mshCheck;s.requests.push(r.method);
 if(r.method==='eth_chainId')return s.chain;
 if(r.method==='eth_requestAccounts'&&s.reject)throw {code:4001};
 if(['eth_accounts','eth_requestAccounts'].includes(r.method))return [s.account];
 if(r.method==='eth_blockNumber')return '0xb5ac00';
 if(r.method==='eth_getCode')return '0x60006000';
 if(r.method==='eth_call'){
 const d=r.params[0].data;
 if(d==='0x06fdde03')return string('MSH Test Token');if(d==='0x95d89b41')return string('MSH');
 if(d==='0x313ce567')return '0x12';if(d==='0x18160ddd')return '0x'+(1000000n*10n**18n).toString(16);
 if(d.startsWith('0x70a08231'))return '0x'+((s.account.startsWith('0x1cd')?999999n:1n)*10n**18n).toString(16);
 }throw Error('Prohibited or unexpected request '+r.method);
}};window.mshEmit=e=>(listeners[e]||[]).forEach(f=>f());
} """
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('MSH_CHROMIUM_PATH','/usr/bin/chromium'))
 anonymous=browser.new_context();anonymous.add_init_script("localStorage.setItem('sybnb_v6_language','en')");anonymous.add_init_script('('+WALLET+')()')
 anonymous.route('**/*',lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5187') else route.abort())
 gate=anonymous.new_page();gate.goto('http://127.0.0.1:5187/#/wallet/msh');expect(gate.get_by_role('heading',name='MSH testnet dashboard')).not_to_be_visible()
 expect(gate.get_by_label('Email',exact=True)).to_be_visible()
 assert gate.evaluate('window.mshCheck.requests')==[]
 anonymous.close()
 context=browser.new_context();context.add_init_script("sessionStorage.setItem('sybnb-v6-guest-token','msh-browser-test-only');sessionStorage.setItem('sybnb.v6.guestSession',JSON.stringify({token:'msh-browser-test-only',user:{id:'msh-browser-test-only',roles:['GUEST'],displayName:'Test visitor'}}))");context.add_init_script("localStorage.setItem('sybnb_v6_language','en')");context.add_init_script('('+WALLET+')()')
 context.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5187') else route.abort())
 page=context.new_page();errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
 page.goto('http://127.0.0.1:5187/#/wallet/msh')
 expect(page.get_by_role('heading',name='MSH testnet dashboard')).to_be_visible()
 expect(page.get_by_role('button',name='Connect test wallet',exact=True)).to_be_disabled()
 page.get_by_role('checkbox').check();page.get_by_role('button',name='Connect test wallet',exact=True).click()
 expect(page.get_by_text('999,999 MSH',exact=True)).to_be_visible()
 assert not any('sign' in r.lower() or 'send' in r.lower() for r in page.evaluate('window.mshCheck.requests'))
 before=page.evaluate('window.mshCheck.requests.filter(r=>r==="eth_requestAccounts").length')
 page.get_by_role('button',name='Refresh balance',exact=True).click();expect(page.get_by_text('999,999 MSH',exact=True)).to_be_visible()
 assert page.evaluate('window.mshCheck.requests.filter(r=>r==="eth_requestAccounts").length')==before
 page.evaluate("window.mshCheck.account='0xe36c2d8b3c622b617111ddbd74b8191ed679cd16';window.mshEmit('accountsChanged')")
 expect(page.get_by_text('999,999 MSH',exact=True)).not_to_be_visible()
 page.get_by_role('button',name='Connect test wallet',exact=True).click();expect(page.get_by_text('1 MSH',exact=True)).to_be_visible()
 page.evaluate("window.mshCheck.chain='0x1';window.mshEmit('chainChanged')")
 page.get_by_role('button',name='Connect test wallet',exact=True).click()
 expect(page.get_by_role('status')).to_contain_text('Select Ethereum Sepolia')
 page.evaluate("window.mshCheck.chain='0xaa36a7';window.mshCheck.reject=true")
 page.get_by_role('button',name='Connect test wallet',exact=True).click();expect(page.get_by_role('status')).to_contain_text('failed')
 page.evaluate('window.mshCheck.reject=false');page.get_by_role('button',name='Connect test wallet',exact=True).click()
 expect(page.get_by_text('1 MSH',exact=True)).to_be_visible()
 page.get_by_role('button',name='AR',exact=True).click();expect(page.get_by_role('heading',name='لوحة MSH التجريبية')).to_be_visible()
 assert page.locator('.msh-dashboard').get_attribute('dir')=='rtl'
 page.set_viewport_size({'width':390,'height':844});assert page.locator('.msh-dashboard').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
 page.screenshot(path='/workspace/artifacts/MSH-Active-V6-Dashboard-Mobile.png',full_page=True)
 page.get_by_role('button',name='FR',exact=True).click();expect(page.get_by_role('heading',name='Tableau de bord MSH de test')).to_be_visible()
 page.get_by_role('button',name='EN',exact=True).click()
 page.get_by_role('link',name='Back to SYBNB wallet').click();expect(page.get_by_role('link',name='View MSH testnet balance — Sepolia')).to_be_visible()
 page.get_by_role('link',name='View MSH testnet balance — Sepolia').click();expect(page.get_by_role('heading',name='MSH testnet dashboard')).to_be_visible()
 assert not errors, errors
 print('PASS: existing sign-in gate, consent, verified balances for both accounts, read-only refresh, account/network changes, mainnet rejection, rejected connection, Arabic RTL, French, mobile width, wallet navigation, and no uncaught errors.')
 browser.close()
