"""Browser integration with mocked authenticated activity; no database or real tokens."""
import json, os
from playwright.sync_api import sync_playwright, expect
base=os.environ.get('MSH_PREVIEW_URL','http://127.0.0.1:5187')
activity={'mode':'draft','enabled':False,'issuedTokens':0,'redeemableTokens':0,'rule':None,'limitPerService':100,'truncated':False,'entries':[
 {'reference':'stay:paid','kind':'stay','eligibility':'eligible'},
 {'reference':'ride:paid','kind':'ride','eligibility':'eligible'},
 {'reference':'stay:refunded','kind':'stay','eligibility':'refund'},
 {'reference':'ride:unpaid','kind':'ride','eligibility':'payment'}]}
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('MSH_CHROMIUM_PATH','/usr/bin/chromium'))
 context=browser.new_context()
 context.add_init_script("sessionStorage.setItem('sybnb-v6-guest-token','test-only');sessionStorage.setItem('sybnb.v6.guestSession',JSON.stringify({token:'test-only',user:{id:'test-only',roles:['GUEST'],displayName:'Test visitor'}}));localStorage.setItem('sybnb_v6_language','en')")
 requests=[];failure=[False]
 def route(r):
  if '/api/me/msh-rewards-preview' in r.request.url:
   requests.append(r.request)
   r.fulfill(status=503 if failure[0] else 200,content_type='application/json',body=json.dumps({'ok':True,'rewards':activity}))
  elif r.request.url.startswith(base):r.continue_()
  else:r.abort()
 context.route('**/*',route)
 page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/#/wallet/msh')
 section=page.get_by_role('region',name='MSH rewards draft')
 expect(section.get_by_text('Draft only · Rewards disabled')).to_be_visible()
 assert not requests
 section.get_by_role('button',name='Load completed activity').click()
 expect(section.get_by_text('Held: refund',exact=False)).to_be_visible()
 expect(section.get_by_text('Held: payment',exact=False)).to_be_visible()
 stay=section.get_by_label('Test MSH per completed stay');ride=section.get_by_label('Test MSH per completed ride')
 expect(stay).to_have_value('');expect(ride).to_have_value('')
 stay.fill('2');ride.fill('1');section.get_by_role('button',name='Calculate draft preview').click()
 expect(section.get_by_role('status')).to_contain_text('3 test MSH preview units')
 expect(section.get_by_role('status')).to_contain_text('2 eligible activities')
 ride.fill('0');expect(section.get_by_role('status')).not_to_be_visible()
 stay.fill('0');section.get_by_role('button',name='Calculate draft preview').click();expect(section.get_by_role('alert')).to_be_visible()
 stay.fill('4');section.get_by_role('button',name='Calculate draft preview').click();expect(section.get_by_role('status')).to_contain_text('4 test MSH')
 assert len(requests)==1 and requests[0].method=='GET'
 page.evaluate("window.dispatchEvent(new Event('sybnb-session-changed'))")
 expect(section.get_by_role('status')).not_to_be_visible()
 expect(section.get_by_label('Test MSH per completed stay')).not_to_be_visible()
 failure[0]=True;section.get_by_role('button',name='Load completed activity').click()
 expect(section.get_by_role('alert')).to_contain_text('could not be loaded');expect(section.get_by_role('status')).not_to_be_visible()
 failure[0]=False;activity['truncated']=True;section.get_by_role('button',name='Load completed activity').click()
 expect(section.get_by_text('Showing only',exact=False)).to_be_visible()
 page.get_by_role('button',name='AR',exact=True).click()
 expect(page.get_by_role('heading',name='إعداد المكافآت التجريبية')).to_be_visible()
 assert page.locator('.msh-dashboard').get_attribute('dir')=='rtl'
 page.set_viewport_size({'width':390,'height':844})
 assert page.locator('.msh-dashboard').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
 page.screenshot(path='/workspace/artifacts/MSH-Rewards-Draft-Mobile.png',full_page=True)
 page.get_by_role('button',name='FR',exact=True).click()
 expect(page.get_by_role('heading',name='Configurer les récompenses de test')).to_be_visible()
 assert not errors,errors
 assert all(r.method=='GET' for r in requests)
 print('PASS: draft disabled, explicit rules, eligible/held activity, calculation, validation, stale preview clearing, API failure, bounded scope notice, Arabic/French, mobile, GET only, no wallet required.')
 browser.close()
