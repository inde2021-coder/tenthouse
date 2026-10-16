const OpenAI = require('openai');
const admin = require('firebase-admin');

const DATASETS = new Set([
  'stockList','customerBookings','vendorStockList','registeredVendors',
  'missingItemsList','vendorMissingItemsList','purchaseLedger','incomeExpenseLedger',
  'masterLedgerData','paymentsRecordList','vendorStockRequests','vendorLedger',
  'vendorPayments','vendorStockDispatchHistory','dispatchHistory','returnHistory',
  'vendorBills','customerPayments','bookingPayments','quotationList'
]);
const arr = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).sort((a,b)=>/^\d+$/.test(a)&&/^\d+$/.test(b)?Number(a)-Number(b):a.localeCompare(b)).map(k=>v[k]) : []);
function dbApp(){
 if(admin.apps.length) return admin.app();
 const raw=process.env.FIREBASE_SERVICE_ACCOUNT;
 if(!raw) throw new Error('Vercel में FIREBASE_SERVICE_ACCOUNT सेट नहीं है');
 let sa; try{sa=JSON.parse(raw)}catch{throw new Error('FIREBASE_SERVICE_ACCOUNT का JSON गलत है')}
 return admin.initializeApp({credential:admin.credential.cert(sa),databaseURL:process.env.FIREBASE_DATABASE_URL||'https://radhe-krishna-online-booking-default-rtdb.firebaseio.com'});
}
function normalizeText(s){return String(s||'').trim().toLowerCase()}
function num(v){const n=Number(v); if(!Number.isFinite(n)) throw new Error('राशि/मात्रा वैध संख्या नहीं है'); return n}
async function verify(req){
 const h=req.headers.authorization||''; const token=h.startsWith('Bearer ')?h.slice(7):'';
 if(!token) throw Object.assign(new Error('पहले अधिकृत Firebase/Google एडमिन से लॉगिन करें'),{status:401});
 const app=dbApp(); const user=await admin.auth(app).verifyIdToken(token);
 const allow=(process.env.JARVIS_ADMIN_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(user.admin!==true && (!user.email||!allow.includes(user.email.toLowerCase()))) throw Object.assign(new Error('इस खाते को JARVIS एडमिन अनुमति नहीं है'),{status:403});
 return {app,user};
}
async function readDataset(db,dataset,limit=100){
 if(!DATASETS.has(dataset)) throw new Error('इस डेटा सेट को पढ़ने की अनुमति नहीं है');
 const snap=await db.ref(dataset).once('value'); const rows=arr(snap.val());
 return {dataset,count:rows.length,rows:rows.slice(0,Math.min(100,Math.max(1,Number(limit)||30)))};
}
async function runAction(db, action){
 const p=action.payload||{}; const now=new Date().toISOString();
 if(action.type==='adjust_stock'){
   const name=String(p.itemName||'').trim(); const delta=num(p.delta);
   if(!name||!Number.isInteger(delta)||delta===0) throw new Error('आइटम नाम और शून्य से अलग पूर्णांक मात्रा चाहिए');
   let result;
   await db.ref('stockList').transaction(current=>{
     const list=arr(current); const i=list.findIndex(x=>normalizeText(x.name)===normalizeText(name));
     if(i<0) return; const qty=num(list[i].qty||0)+delta; if(qty<0) return;
     list[i]={...list[i],qty}; result={itemName:list[i].name,oldQty:qty-delta,newQty:qty,delta}; return list;
   },undefined,false);
   if(!result) throw new Error('स्टॉक आइटम नहीं मिला या मात्रा उपलब्ध नहीं है; कोई बदलाव नहीं किया गया');
   await db.ref('jarvisAudit').push({at:now,action:'adjust_stock',details:result,actor:'jarvis'});
   return {success:true,message:`${result.itemName} का स्टॉक ${result.oldQty} से ${result.newQty} हुआ`,result};
 }
 if(action.type==='add_income_expense'){
   const type=String(p.type||''); const desc=String(p.desc||'').trim(); const amt=num(p.amt); const date=String(p.date||now.slice(0,10));
   if(!['Income','Expense'].includes(type)||!desc||amt<=0) throw new Error('आय/खर्च का प्रकार, विवरण और सकारात्मक राशि आवश्यक हैं');
   const entry={type,desc,amt,date,source:'JARVIS',createdAt:now};
   await db.ref('incomeExpenseLedger').transaction(v=>[...arr(v),entry],undefined,false);
   const category=type==='Income'?'Direct Income':'Direct Expense';
   await db.ref('masterLedgerData').transaction(v=>[...arr(v),{date,category,desc,amount:amt,status:'Recorded',source:'JARVIS',createdAt:now}],undefined,false);
   await db.ref('jarvisAudit').push({at:now,action:'add_income_expense',details:entry,actor:'jarvis'});
   return {success:true,message:`${type==='Income'?'आय':'खर्च'} ₹${amt} की प्रविष्टि दर्ज हुई`,result:entry};
 }
 if(action.type==='update_booking_status'){
   const id=String(p.bookingId||'').trim(), status=String(p.status||'').trim();
   const allowed=['Pending','Confirmed','Dispatched','Returned','Cancelled','Completed'];
   if(!id||!allowed.includes(status)) throw new Error('बुकिंग ID या मान्य status नहीं मिला');
   let found=null;
   await db.ref('customerBookings').transaction(v=>{const list=arr(v);const i=list.findIndex(x=>String(x.bookingId||x.id||'').toLowerCase()===id.toLowerCase());if(i<0)return;found={oldStatus:list[i].status||'',bookingId:id,status};list[i]={...list[i],status,updatedAt:now,updatedBy:'JARVIS'};return list;},undefined,false);
   if(!found) throw new Error('बुकिंग नहीं मिली; कोई बदलाव नहीं किया गया');
   await db.ref('jarvisAudit').push({at:now,action:'update_booking_status',details:found,actor:'jarvis'});
   return {success:true,message:`बुकिंग ${id} का स्टेटस ${status} किया गया`,result:found};
 }
 if(action.type==='create_booking'){
   const customerName=String(p.customerName||'').trim(), mobile=String(p.mobile||'').trim(), bookingId=String(p.bookingId||'').trim();
   const items=Array.isArray(p.items)?p.items:[];
   if(!customerName||!mobile||!bookingId||!items.length) throw new Error('नई बुकिंग के लिए Booking ID, ग्राहक नाम, मोबाइल और कम से कम एक आइटम चाहिए');
   if(items.some(x=>!String(x.name||'').trim()||!Number.isInteger(Number(x.qty))||Number(x.qty)<=0)) throw new Error('हर बुकिंग आइटम में नाम और सकारात्मक पूर्णांक मात्रा चाहिए');
   let duplicate=false;
   await db.ref('customerBookings').transaction(v=>{const list=arr(v);if(list.some(x=>String(x.bookingId||'').toLowerCase()===bookingId.toLowerCase())){duplicate=true;return;}const entry={bookingId,customerName,mobile,functionType:String(p.functionType||''),address:String(p.address||''),dispatchDate:String(p.dispatchDate||''),returnDate:String(p.returnDate||''),status:'Pending',items:items.map(x=>({name:String(x.name).trim(),qty:Number(x.qty),rate:Number(x.rate)||0})),createdAt:now,source:'JARVIS'};list.push(entry);return list;},undefined,false);
   if(duplicate) throw new Error('यह Booking ID पहले से मौजूद है; कोई नई बुकिंग नहीं बनाई');
   await db.ref('jarvisAudit').push({at:now,action:'create_booking',details:{bookingId,customerName,mobile,itemCount:items.length},actor:'jarvis'});
   return {success:true,message:`बुकिंग ${bookingId} बनाई गई। इसे एडमिन पैनल में जाँच लें।`,result:{bookingId,customerName,mobile,items}};
 }
 if(action.type==='add_vendor'){
   const name=String(p.vendorShop||'').trim(), mobile=String(p.mobile||'').trim();
   if(!name||!mobile) throw new Error('वेंडर दुकान/नाम और मोबाइल नंबर आवश्यक हैं');
   let duplicate=false;
   const entry={vendorShop:name,mobile,contactPerson:String(p.contactPerson||''),address:String(p.address||''),createdAt:now,source:'JARVIS'};
   await db.ref('registeredVendors').transaction(v=>{const list=arr(v);if(list.some(x=>normalizeText(x.vendorShop||x.name)===normalizeText(name))){duplicate=true;return;}list.push(entry);return list;},undefined,false);
   if(duplicate) throw new Error('इस नाम का वेंडर पहले से मौजूद है');
   await db.ref('jarvisAudit').push({at:now,action:'add_vendor',details:entry,actor:'jarvis'});
   return {success:true,message:`वेंडर ${name} दर्ज किया गया`,result:entry};
 }
 throw new Error('यह कार्रवाई अभी उपलब्ध/अनुमोदित नहीं है। मौजूदा ऐप का संबंधित फॉर्म इस्तेमाल करें।');
}
const tools=[
 {type:'function',name:'read_business_data',description:'Admin business records read-only for answering factual questions.',strict:true,parameters:{type:'object',properties:{dataset:{type:'string',enum:[...DATASETS]},limit:{type:'integer',minimum:1,maximum:100}},required:['dataset','limit'],additionalProperties:false}},
 {type:'function',name:'propose_business_action',strict:false,description:'Propose a supported write action. Never claim it is done. The server will return it for user confirmation before executing.',parameters:{type:'object',properties:{type:{type:'string',enum:['adjust_stock','add_income_expense','update_booking_status','create_booking','add_vendor']},payload:{type:'object',properties:{itemName:{type:'string'},delta:{type:'integer'},type:{type:'string',enum:['Income','Expense']},desc:{type:'string'},amt:{type:'number'},date:{type:'string'},bookingId:{type:'string'},status:{type:'string',enum:['Pending','Confirmed','Dispatched','Returned','Cancelled','Completed']},customerName:{type:'string'},mobile:{type:'string'},functionType:{type:'string'},address:{type:'string'},dispatchDate:{type:'string'},returnDate:{type:'string'},items:{type:'array',items:{type:'object',properties:{name:{type:'string'},qty:{type:'integer'},rate:{type:'number'}},required:['name','qty','rate'],additionalProperties:false}},vendorShop:{type:'string'},mobile:{type:'string'},contactPerson:{type:'string'}},required:[],additionalProperties:false}},required:['type','payload'],additionalProperties:false}}
];
module.exports=async function(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'POST method required'});}
 try{
   if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Vercel में OPENAI_API_KEY सेट करें'});
   const {app,user}=await verify(req);const db=admin.database(app);const body=req.body||{};
   if(body.confirmAction){
     const a=body.pendingAction;if(!a||!['adjust_stock','add_income_expense','update_booking_status','create_booking','add_vendor'].includes(a.type))return res.status(400).json({error:'पुष्टि करने वाली कार्रवाई वैध नहीं है'});
     const result=await runAction(db,a);return res.status(200).json({reply:result.message,actionResult:result,mode:'action-executed'});
   }
   const message=String(body.message||'').trim().slice(0,2000);if(!message)return res.status(400).json({error:'आवाज़/संदेश खाली है'});
   const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});let input=[{role:'user',content:message}],response,pendingAction=null;
   const instructions=`तुम Radhe Krishn Tent House Manager के हिंदी AI एजेंट श्रद्धा हो। बोलचाल की हिंदी समझो और संक्षिप्त, साफ उत्तर दो। तथ्यात्मक प्रश्नों के लिए read_business_data से वास्तविक Firebase डेटा पढ़ो; डेटा पढ़े बिना रिकॉर्ड/गणना का दावा मत करो। डेटा सेट: stockList, customerBookings, vendorStockList, registeredVendors, missingItemsList, vendorMissingItemsList, purchaseLedger, incomeExpenseLedger, masterLedgerData, paymentsRecordList, vendorStockRequests, vendorLedger, vendorPayments, vendorStockDispatchHistory, dispatchHistory, returnHistory, vendorBills, customerPayments, bookingPayments, quotationList. यदि उपयोगकर्ता कोई supported write action मांगे तो propose_business_action कॉल करो; कभी न कहो कि वह पहले से हो चुका है। Server action को execute करने से पहले user confirmation मांगेगा। समर्थित writes: stock quantity adjustment, income/expense ledger entry, booking status update, new basic booking record, vendor record. Dispatch/return/billing/WhatsApp/payment gateway/printing/OCR को पूर्ण किया हुआ न बताओ; यदि संबंधित existing form/API के साथ direct integration उपलब्ध नहीं है, स्पष्ट बताओ कि यह कार्रवाई अभी JARVIS से सीधे नहीं की जा सकती। किसी रिकॉर्ड का अभाव हो तो साफ बताओ। API key/credentials कभी न माँगो।`;
   for(let step=0;step<5;step++){
     response=await openai.responses.create({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',instructions,input,tools,tool_choice:'auto',max_output_tokens:900});
     const calls=(response.output||[]).filter(x=>x.type==='function_call');if(!calls.length)break;input=input.concat(response.output);
     for(const call of calls){let out;try{const args=JSON.parse(call.arguments||'{}');if(call.name==='read_business_data')out=await readDataset(db,args.dataset,args.limit);else if(call.name==='propose_business_action'){const permitted=['adjust_stock','add_income_expense','update_booking_status','create_booking','add_vendor'];if(!permitted.includes(args.type))throw new Error('यह कार्रवाई अनुमति सूची में नहीं है');pendingAction={type:args.type,payload:args.payload||{}};out={pendingConfirmation:true,action:pendingAction,summary:describeAction(pendingAction)};}else throw new Error('अज्ञात टूल');}catch(e){out={error:e.message||'टूल चलाने में त्रुटि'};}input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(out)});}
     if(pendingAction)break;
   }
   if(pendingAction)return res.status(200).json({reply:'यह बदलाव करने से पहले आपकी स्पष्ट पुष्टि चाहिए।',pendingAction,confirmationText:describeAction(pendingAction),mode:'awaiting-confirmation'});
   return res.status(200).json({reply:String(response&&response.output_text||'मैं सत्यापित जवाब नहीं बना पाया। कृपया सवाल थोड़ा स्पष्ट बोलें।'),mode:'agent',model:process.env.OPENAI_MODEL||'gpt-4.1-mini'});
 }catch(e){const status=e.status===401||e.status===403?e.status:500;console.error('Shraddha API error:',e&&e.message);return res.status(status).json({error:e.message||'JARVIS सर्वर त्रुटि'});}
};
function describeAction(a){const p=a.payload||{};switch(a.type){case'adjust_stock':return `स्टॉक ${p.itemName||''} में ${Number(p.delta)>0?'+':''}${p.delta} की मात्रा बदलनी है।`;case'add_income_expense':return `${p.type==='Income'?'आय':'खर्च'} ₹${p.amt} — ${p.desc||''} (${p.date||'आज'}) दर्ज करना है।`;case'update_booking_status':return `बुकिंग ${p.bookingId||''} का स्टेटस “${p.status||''}” करना है।`;case'create_booking':return `नई बुकिंग ${p.bookingId||''}, ग्राहक ${p.customerName||''}, मोबाइल ${p.mobile||''}, आइटम ${Array.isArray(p.items)?p.items.length:0} दर्ज करने हैं।`;case'add_vendor':return `वेंडर ${p.vendorShop||''} (${p.mobile||''}) जोड़ना है।`;default:return 'यह कार्रवाई करने की पुष्टि चाहिए।';}}
