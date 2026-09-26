import { test, expect } from '@playwright/test';

// Real browser, app router/AuthProvider and Supabase SDK. Every backend request
// is intercepted with synthetic data; unknown external calls fail the test.
test('multiple children, truthful match data, failed queries', async ({ page, context }, testInfo) => {
const parent='11111111-1111-4111-8111-111111111111', alex='22222222-2222-4222-8222-222222222222', zara='33333333-3333-4333-8333-333333333333', coach='44444444-4444-4444-8444-444444444444';
const profile={id:parent,user_id:parent,role:'parent',full_name:'Synthetic Parent',nationality:null};
const user={id:parent,email:'parent@example.test',email_confirmed_at:'2026-09-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated',role:'authenticated',created_at:'2026-09-01T00:00:00Z'};
const exp=Math.floor(Date.now()/1000)+3600;
const token=[{alg:'HS256',typ:'JWT'},{sub:parent,exp,role:'authenticated',email:user.email}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.synthetic';
const session={access_token:token,refresh_token:'synthetic-refresh',expires_in:3600,expires_at:exp,token_type:'bearer',user};
await context.addInitScript((s: object)=>localStorage.setItem('sb-xbykbqolvqyqmipikuae-auth-token',JSON.stringify(s)),session);
let failMatches=false;
const failLinks=false, logoutFails=true;
const unexpected: string[] = [], errors: string[] = [], writes: { path: string; method: string }[] = [];
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{
 const req=route.request(), u=new URL(req.url());
 if(u.origin==='http://127.0.0.1:4189') return route.continue();
 const json=(data: unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(u.hostname!=='xbykbqolvqyqmipikuae.supabase.co') { if(!u.hostname.includes('fonts.')) unexpected.push(req.url()); return route.abort(); }
 if(req.method()!=='GET') writes.push({path:u.pathname,method:req.method()});
 if(u.pathname==='/auth/v1/user') return json(user);
 if(u.pathname==='/auth/v1/logout') return logoutFails?json({msg:'Synthetic logout failure'},500):route.fulfill({status:204});
 if(u.pathname==='/rest/v1/telemetry_events') return json(null,201);
 if(u.pathname==='/rest/v1/rpc/get_children_awaiting_consent') return json([]);
 // TRAK-77: Matches also lists the selected child's training (a read, over POST).
 if(u.pathname==='/rest/v1/rpc/family_training_history') return json([]);
 if(u.pathname==='/rest/v1/player_parent_links') return failLinks?json({message:'Synthetic network error'},503):json([{player_user_id:alex},{player_user_id:zara}]);
 if(u.pathname==='/rest/v1/profiles') {
   const filter=u.searchParams.get('user_id')||'';
   const rows=filter===`eq.${parent}`?[profile]:filter.includes(coach)?[{user_id:coach,full_name:'Synthetic Coach'}]:[{user_id:alex,full_name:'Alex Example'},{user_id:zara,full_name:'Zara Example'}];
   return json(req.headers().accept?.includes('vnd.pgrst.object')?rows[0]:rows);
 }
 if(u.pathname==='/rest/v1/player_details') return json([{position:'Midfielder',current_club:'Synthetic Academy',age_group:'U15'}]);
 if(u.pathname==='/rest/v1/squad_players') return json([{id:u.searchParams.get('linked_player_id')?.slice(3)}]);
 if(u.pathname==='/rest/v1/coach_assessments') return json([{id:'assessment',created_at:'2026-09-01T12:00:00Z',coach_user_id:coach,coach_rating:0,work_rate:0,tactical:0,attitude:0,technical:0,physical:0,coachability:0}]);
 if(u.pathname==='/rest/v1/recognition_awards') return json([]);
 if(u.pathname==='/rest/v1/matches') {
   if(failMatches) return json({message:'Synthetic network error'},503);
   return json([{id:'match-'+u.searchParams.get('user_id'),match_date:'2026-09-01',created_at:'2026-09-18T12:00:00Z',opponent:u.searchParams.get('user_id')===`eq.${zara}`?'Zara Opposition':'Alex Opposition',team_score:0,opponent_score:0,computed_rating:0,competition:'Synthetic League',venue:'Test Pitch'}]);
 }
 unexpected.push(req.method()+' '+u.pathname); return json({message:'Unmocked request blocked'},500);
});
 await page.goto('http://127.0.0.1:4189/parent/home');
 await expect(page.getByRole('heading',{name:'Alex Example'})).toBeVisible();
 await expect(page.getByText('Alex Opposition',{exact:true})).toBeVisible();
 await page.getByRole('combobox').selectOption(zara);
 await expect(page.getByRole('heading',{name:'Zara Example'})).toBeVisible();
 await expect(page.getByText('Zara Opposition',{exact:true})).toBeVisible();
 await expect(page.getByText('Alex Opposition',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Matches',exact:true}).click();
 await expect(page.getByRole('combobox')).toHaveValue(zara);
 await expect(page.getByText('D 0–0',{exact:true})).toBeVisible();
 await expect(page.getByText('Difficult',{exact:true})).toBeVisible();
 await expect(page.getByText('1 Sept · Synthetic League · Test Pitch',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('matches-mobile.png'),fullPage:true});
 failMatches=true;
 await page.reload();
 await expect(page.getByText("Couldn't load matches.",{exact:true})).toBeVisible({timeout:10000});
 await expect(page.getByText('No matches yet.',{exact:true})).toHaveCount(0);
 failMatches=false;
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByText('Alex Opposition',{exact:true})).toBeVisible();
 await page.getByRole('combobox').selectOption(zara);
 await page.getByRole('button',{name:'Alerts',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Coming soon'})).toBeVisible();
 await expect(page.getByRole('combobox')).toHaveCount(0);
 await page.getByRole('link',{name:'Back to home'}).click();
 await expect(page.getByRole('combobox')).toHaveValue(zara);
 await expect(page.getByText('Zara Opposition',{exact:true})).toBeVisible();
 await expect(page.getByText('Alex Opposition',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Profile',exact:true}).click();
 await expect(page.getByText('Following Zara Example · 2 children linked',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Account settings/}).click();
 await expect(page.getByRole('list',{name:'Linked children'})).toContainText('Alex Example');
 await expect(page.getByRole('list',{name:'Linked children'})).toContainText('Zara Example');
 await page.screenshot({path:testInfo.outputPath('connections-mobile.png'),fullPage:true});
 expect(errors).toEqual([]);
 expect(unexpected).toEqual([]);
 expect(writes.every(write => ['/rest/v1/telemetry_events', '/rest/v1/rpc/get_children_awaiting_consent', '/rest/v1/rpc/family_training_history', '/auth/v1/logout'].includes(write.path))).toBe(true);
});
