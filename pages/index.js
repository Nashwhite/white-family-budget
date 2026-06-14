import { useState, useEffect, useRef, useCallback } from "react";
import { PlusCircle, Camera, ChevronLeft, ChevronRight, Trash2, Check, X, Receipt, BarChart2, Home, ChevronDown, ChevronUp, Upload, AlertTriangle, Sparkles, MessageSquare, Copy, Bell, Split, Mic } from "lucide-react";

// ── CONSTANTS ──────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = {
  "Gifts & Donations": { icon: "🎁", color: "#e67e22", sub: ["Gifts", "Tithing & Fast Offerings"], rollover: {} },
  "Auto & Transport": { icon: "🚗", color: "#3498db", sub: ["Gas", "Auto Maintenance"], rollover: {} },
  "Housing": { icon: "🏠", color: "#8e44ad", sub: ["Rent"], rollover: {} },
  "Bills & Utilities": { icon: "⚡", color: "#16a085", sub: ["Water", "Electric", "Phone", "Internet", "Gas Energy"], rollover: {} },
  "Food & Dining": { icon: "🍎", color: "#27ae60", sub: ["Groceries", "Restaurants & Bars"], rollover: {} },
  "Travel & Lifestyle": { icon: "✈️", color: "#2980b9", sub: ["Entertainment & Recreation", "Adalyn Fun $", "Nash Fun $", "Date Night"], rollover: { "Adalyn Fun $": true, "Nash Fun $": true, "Date Night": true } },
  "Shopping": { icon: "🛍️", color: "#e74c3c", sub: ["Shopping"], rollover: {} },
  "Children": { icon: "👶", color: "#f39c12", sub: ["Banner", "Rin"], rollover: {} },
  "Health & Wellness": { icon: "💪", color: "#1abc9c", sub: ["Medical", "Fitness", "Haircut"], rollover: {} },
  "Other": { icon: "📦", color: "#95a5a6", sub: ["Subscriptions / Fees"], rollover: {} },
  "Business": { icon: "💼", color: "#34495e", sub: ["Babysitting (Work)"], rollover: {} },
  "Goals": { icon: "🎯", color: "#9b59b6", sub: ["Emergency Fund"], rollover: { "Emergency Fund": true } }
};
const INCOME_SOURCES = ["Adalyn's Income", "Nash's Income", "Other Income"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const EMOJI_OPTIONS = ["🎁","🚗","🏠","⚡","🍎","✈️","🛍️","👶","💪","📦","💼","🎯","🐾","🎓","💊","🏋️","🎮","🍕","☕","🌴","💅","🐶","🎬","🏥","✂️"];

function getMonthKey(y, m) { return `${y}-${String(m+1).padStart(2,"0")}`; }
function fmt(v) { return "$" + Math.abs(v||0).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0}); }
function getCatForSub(sub, cats) { return Object.entries(cats).find(([,v])=>v.sub.includes(sub))?.[0] || "Other"; }

function pctColor(pct) {
  if (pct >= 100) return "#e74c3c";
  if (pct >= 80) return "#f39c12";
  return "#2c5f2e";
}

function ProgressBar({ planned, actual, color }) {
  const pct = planned > 0 ? Math.min((actual/planned)*100, 120) : (actual > 0 ? 100 : 0);
  const c = pctColor(pct);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ width:"100%", height:8, background:"#f0f0f0", borderRadius:4, overflow:"hidden" }}>
        <div style={{ width:`${Math.min(pct,100)}%`, height:"100%", background:c, borderRadius:4, transition:"width 0.5s" }}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:3 }}>
        <div style={{ fontSize:11, color:c, fontFamily:"Arial", fontWeight:"bold" }}>{fmt(actual)} spent</div>
        <div style={{ fontSize:11, color:"#aaa", fontFamily:"Arial" }}>{fmt(planned)} budget</div>
      </div>
    </div>
  );
}

async function callClaude(messages, maxTokens=1000) {
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      messages: messages
    }),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch(e) { throw new Error("Non-JSON response: " + raw.slice(0,200)); }
  if (data.error) throw new Error(data.error.type + ": " + data.error.message);
  if (!data.content) throw new Error("No content in response: " + JSON.stringify(data).slice(0,200));
  return data.content.map(item => item.type === "text" ? item.text : "").filter(Boolean).join("\n");
}

function safeJSON(text, fallback) {
  try { return JSON.parse(text.replace(/```json|```/g,"").trim()); }
  catch(e) { return fallback; }
}

async function toBase64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(file); });
}

// ── MAIN APP ───────────────────────────────────────────────────────────────────
export default function App() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [view, setView] = useState("budget");
  const [allData, setAllData] = useState({});
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [rules, setRules] = useState({});
  const [loading, setLoading] = useState(true);
  const [expandedCats, setExpandedCats] = useState({});

  // Modals
  const [modal, setModal] = useState(null); // 'addTx' | 'editBudget' | 'import' | 'scan' | 'nlEntry' | 'aiSummary' | 'addCat' | 'compare' | 'split'
  const [modalData, setModalData] = useState(null);

  // Toast
  const [toast, setToast] = useState(null);

  const receiptRef = useRef();
  const pdfRef = useRef();
  const monthKey = getMonthKey(year, month);

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [d, c, r] = await Promise.all([
        Promise.resolve({ value: localStorage.getItem("wfb-data") }).catch(()=>null),
        Promise.resolve({ value: localStorage.getItem("wfb-cats") }).catch(()=>null),
        Promise.resolve({ value: localStorage.getItem("wfb-rules") }).catch(()=>null),
      ]);
      if (d?.value) setAllData(JSON.parse(d.value));
      if (c?.value) setCategories(JSON.parse(c.value));
      if (r?.value) setRules(JSON.parse(r.value));
    } catch(e) {}
    setLoading(false);
  }

  async function persist(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
  }

  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null),3000); }
  function openModal(name, data=null) { setModal(name); setModalData(data); }
  function closeModal() { setModal(null); setModalData(null); }

  // ── Data helpers ──
  function getMonthData(key) {
    const d = allData[key];
    const allSubs = Object.values(categories).flatMap(c=>c.sub);
    return {
      budget: d?.budget || { income: Object.fromEntries(INCOME_SOURCES.map(s=>[s,0])), expenses: Object.fromEntries(allSubs.map(s=>[s,0])) },
      transactions: d?.transactions || [],
      notes: d?.notes || ""
    };
  }

  const md = getMonthData(monthKey);
  const txs = md.transactions;
  const budget = md.budget;

  // Rollover balances
  function getRolloverBalance(sub) {
    let balance = 0;
    for (let i = 0; i < 12; i++) {
      let m2 = month - i - 1, y2 = year;
      while (m2 < 0) { m2 += 12; y2--; }
      const key2 = getMonthKey(y2, m2);
      const md2 = getMonthData(key2);
      const planned = md2.budget?.expenses?.[sub] || 0;
      const actual = md2.transactions?.filter(t=>!t.isIncome&&t.subcategory===sub).reduce((a,t)=>a+t.amount,0) || 0;
      balance += planned - actual;
      if (i === 0) break; // just last month for simplicity — can expand
    }
    return balance;
  }

  function isRollover(sub) {
    const cat = Object.values(categories).find(c=>c.sub.includes(sub));
    return cat?.rollover?.[sub] === true;
  }

  const actuals = {}, incActuals = {};
  txs.forEach(tx => {
    if (tx.isIncome) incActuals[tx.subcategory] = (incActuals[tx.subcategory]||0) + tx.amount;
    else actuals[tx.subcategory] = (actuals[tx.subcategory]||0) + tx.amount;
  });

  const totalIncPlan = Object.values(budget.income||{}).reduce((a,b)=>a+b,0);
  const totalIncActual = Object.values(incActuals).reduce((a,b)=>a+b,0);
  const totalExpPlan = Object.values(budget.expenses||{}).reduce((a,b)=>a+b,0);
  const totalExpActual = Object.values(actuals).reduce((a,b)=>a+b,0);
  const leftToSpend = totalIncActual - totalExpActual;

  // Over-budget count
  const overBudgetCount = Object.entries(categories).filter(([,ci])=>
    ci.sub.some(s => (actuals[s]||0) > (budget.expenses?.[s]||0) && (budget.expenses?.[s]||0) > 0)
  ).length;

  function saveMonthData(updates) {
    const newData = { ...allData, [monthKey]: { ...getMonthData(monthKey), ...updates } };
    setAllData(newData);
    persist("wfb-data", newData);
  }

  function addTx(tx) {
    const newTxs = [...txs, { ...tx, id: Date.now()+Math.random(), amount: parseFloat(tx.amount) }];
    saveMonthData({ transactions: newTxs });
  }

  function addTxs(txList) {
    const newTxs = [...txs, ...txList.map(tx=>({ ...tx, id: Date.now()+Math.random(), amount: parseFloat(tx.amount) }))];
    saveMonthData({ transactions: newTxs });
  }

  function deleteTx(id) {
    saveMonthData({ transactions: txs.filter(t=>t.id!==id) });
    showToast("Deleted","error");
  }

  function saveBudget(b) {
    saveMonthData({ budget: b });
    showToast("Budget saved!");
  }

  function saveCats(c) {
    setCategories(c);
    persist("wfb-cats", c);
  }

  function saveRules(r) {
    setRules(r);
    persist("wfb-rules", r);
  }

  function copyLastMonth() {
    let pm = month - 1, py = year;
    if (pm < 0) { pm = 11; py--; }
    const lastMd = getMonthData(getMonthKey(py, pm));
    saveBudget(JSON.parse(JSON.stringify(lastMd.budget)));
    showToast("Copied from last month!");
  }

  function guessCat(desc) {
    if (!desc) return "Shopping";
    const d = desc.toLowerCase();
    const map = [
      [["walmart","kroger","smith","costco","grocery","safeway","target food","albertsons","fry's"],"Groceries"],
      [["mcdonald","chipotle","restaurant","pizza","sushi","cafe","coffee","starbucks","chick","taco","burger","wendy","subway","dine","eat"],"Restaurants & Bars"],
      [["shell","chevron","exxon","fuel","gas station","sinclair","loves","maverick"],"Gas"],
      [["netflix","hulu","spotify","amazon prime","subscription","disney+","hbo","apple tv"],"Subscriptions / Fees"],
      [["rent","mortgage","apartment"],"Rent"],
      [["electric","nv energy","power","rocky mountain"],"Electric"],
      [["water","water bill"],"Water"],
      [["internet","comcast","cox","xfinity","centurylink"],"Internet"],
      [["phone","verizon","att","t-mobile","sprint","cricket"],"Phone"],
      [["planet fitness","gym","fitness","workout","crossfit"],"Fitness"],
      [["doctor","medical","pharmacy","cvs","walgreen","hospital","urgent care","dental","vision"],"Medical"],
      [["tithe","church","donation","fast offering","lds","ward"],"Tithing & Fast Offerings"],
      [["amazon","target","shopping","walmart.com","etsy"],"Shopping"],
    ];
    for (const [keys, cat] of map) { if (keys.some(k=>d.includes(k))) return cat; }
    return "Shopping";
  }

  // ── AI FUNCTIONS ──
  async function runAISummary() {
    openModal("aiSummary", { loading: true, text: null, type: "summary" });
    const allSubs = Object.values(categories).flatMap(c=>c.sub);
    const overSpent = allSubs.filter(s=>(actuals[s]||0)>(budget.expenses?.[s]||0)&&(budget.expenses?.[s]||0)>0)
      .map(s=>({ sub: s, planned: budget.expenses[s], actual: actuals[s] }));
    const underSpent = allSubs.filter(s=>(actuals[s]||0)<(budget.expenses?.[s]||0)&&(budget.expenses?.[s]||0)>0)
      .map(s=>({ sub: s, planned: budget.expenses[s], actual: actuals[s] }));
    const prompt = `You are a friendly personal finance advisor for a married couple (Nash and Adalyn White). Write a warm, plain-English monthly budget summary for ${MONTHS[month]} ${year}. Be specific and conversational, not robotic.

Data:
- Nash's planned income: ${fmt(budget.income?.["Nash's Income"]||0)}, actual: ${fmt(incActuals["Nash's Income"]||0)}
- Adalyn's planned income: ${fmt(budget.income?.["Adalyn's Income"]||0)}, actual: ${fmt(incActuals["Adalyn's Income"]||0)}
- Total planned expenses: ${fmt(totalExpPlan)}, actual spent: ${fmt(totalExpActual)}
- Over budget categories: ${JSON.stringify(overSpent)}
- Under budget categories: ${JSON.stringify(underSpent)}
- Left to spend: ${fmt(leftToSpend)}

Write 3-4 short paragraphs covering: (1) income overview, (2) where they did well, (3) where they overspent and possible reasons why, (4) one encouraging actionable suggestion. Keep it under 200 words. Use their names. Be honest but supportive.`;
    const text = await callClaude([{role:"user",content:prompt}], 500);
    setModalData({ loading: false, text, type: "summary" });
  }

  async function runSmartSuggestions() {
    openModal("aiSummary", { loading: true, text: null, type: "suggestions" });
    // Get last 3 months of data
    const history = [];
    for (let i = 1; i <= 3; i++) {
      let m2 = month - i, y2 = year;
      while (m2 < 0) { m2 += 12; y2--; }
      const md2 = getMonthData(getMonthKey(y2, m2));
      const txs2 = md2.transactions || [];
      const acts = {};
      txs2.filter(t=>!t.isIncome).forEach(t=>{ acts[t.subcategory]=(acts[t.subcategory]||0)+t.amount; });
      history.push({ month: MONTHS[m2], budget: md2.budget?.expenses || {}, actual: acts });
    }
    const prompt = `You are a budget advisor for Nash and Adalyn White. Based on their last 3 months of spending history, give 3-5 specific, actionable budget suggestions. Be direct and friendly.

History: ${JSON.stringify(history)}
Current budget: ${JSON.stringify(budget.expenses)}

Format as a numbered list. Each suggestion should be 1-2 sentences max. If they consistently overspend in a category, say so and suggest a realistic new budget amount. If they consistently underspend, suggest reallocating. Be specific with dollar amounts.`;
    const text = await callClaude([{role:"user",content:prompt}], 400);
    setModalData({ loading: false, text, type: "suggestions" });
  }

  async function checkAnomalies() {
    if (txs.length < 3) { showToast("Need more transactions to check","error"); return; }
    openModal("aiSummary", { loading: true, text: null, type: "anomalies" });
    const history = [];
    for (let i = 1; i <= 3; i++) {
      let m2 = month - i, y2 = year;
      while (m2 < 0) { m2 += 12; y2--; }
      const md2 = getMonthData(getMonthKey(y2, m2));
      history.push(md2.transactions?.filter(t=>!t.isIncome).map(t=>({desc:t.description,amt:t.amount,sub:t.subcategory}))||[]);
    }
    const prompt = `Review these transactions for ${MONTHS[month]} and flag anything unusual. Be brief and specific.

This month: ${JSON.stringify(txs.filter(t=>!t.isIncome).map(t=>({desc:t.description,amt:t.amount,sub:t.subcategory,date:t.date})))}
Past 3 months for context: ${JSON.stringify(history)}

List only genuinely unusual transactions (much higher than normal, unexpected category, duplicate amounts). If nothing unusual, say so. Format as bullet points. Max 5 flags.`;
    const text = await callClaude([{role:"user",content:prompt}], 300);
    setModalData({ loading: false, text, type: "anomalies" });
  }

  async function handleNLEntry(text) {
    const allSubs = Object.values(categories).flatMap(c=>c.sub);
    const prompt = `Parse this natural language expense entry into JSON. Return ONLY a raw JSON object, no markdown, no backticks, no explanation.
Input: "${text}"
Today: ${today.toISOString().split("T")[0]}
Available subcategories: ${allSubs.join(", ")}
Return exactly this shape: {"description":"merchant name","amount":number,"date":"YYYY-MM-DD","subcategory":"best match from list","isIncome":false}
If it sounds like income, set isIncome to true and pick subcategory from: ${INCOME_SOURCES.join(", ")}`;
    try {
      const res = await callClaude([{role:"user",content:prompt}], 300);
      const parsed = safeJSON(res, null);
      if (!parsed || !parsed.amount) { showToast("Couldn't parse — try rephrasing","error"); return null; }
      const k = parsed.description?.toLowerCase().trim();
      if (rules[k]) parsed.subcategory = rules[k];
      parsed.category = getCatForSub(parsed.subcategory, categories);
      return parsed;
    } catch(e) {
      showToast("AI error: " + e.message, "error");
      return null;
    }
  }

  // ── RECEIPT SCAN ──
  async function handleReceipt(e) {
    const file = e.target.files?.[0]; if (!file) return;
    openModal("scan", { loading: true, items: null });
    const base64 = await toBase64(file);
    const allSubs = Object.values(categories).flatMap(c=>c.sub);
    const prompt = `Parse this receipt. Return ONLY a JSON array, no markdown. Each item: {"description":"merchant or item","amount":number,"suggestedCategory":"one of: ${allSubs.join(", ")}","date":"YYYY-MM-DD or empty","splitSuggestions":[{"subcategory":"...","amount":number}]}. If the receipt has multiple departments (like Costco with groceries + household), populate splitSuggestions. Today: ${today.toISOString().split("T")[0]}.`;
    const res = await callClaude([{role:"user",content:[
      {type:"image",source:{type:"base64",media_type:file.type,data:base64}},
      {type:"text",text:prompt}
    ]}]);
    const items = safeJSON(res, []).map(item => {
      const k = item.description?.toLowerCase().trim();
      return rules[k] ? {...item, suggestedCategory: rules[k]} : item;
    });
    setModalData({ loading: false, items });
    e.target.value = "";
  }

  // ── PDF IMPORT ──
  async function handlePDF(e) {
    const file = e.target.files?.[0]; if (!file) return;
    openModal("import", { loading: true, result: null });
    const base64 = await toBase64(file);
    const prompt = `Extract ALL transactions from this bank statement. Return ONLY a JSON array, no markdown. Each: {"description":"merchant","amount":number,"date":"YYYY-MM-DD","type":"debit or credit"}. Ignore headers and balance lines. Today: ${today.toISOString().split("T")[0]}.`;
    const res = await callClaude([{role:"user",content:[
      {type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},
      {type:"text",text:prompt}
    ]}]);
    const stmtTxs = safeJSON(res, []);
    const matched=[], duplicates=[], missing=[];
    stmtTxs.forEach(stx => {
      const amt = parseFloat(stx.amount);
      const exact = txs.find(e=>Math.abs(e.amount-amt)<0.01&&e.date===stx.date);
      const partial = !exact && txs.find(e=>Math.abs(e.amount-amt)<0.01);
      const k = stx.description?.toLowerCase().trim();
      const sugCat = rules[k] || guessCat(stx.description);
      if (exact) matched.push({statement:stx,existing:exact});
      else if (partial) duplicates.push({statement:stx,existing:partial,suggestedCategory:sugCat,selected:true,id:Date.now()+Math.random()});
      else missing.push({...stx,suggestedCategory:sugCat,isIncome:stx.type==="credit",selected:true,id:Date.now()+Math.random()});
    });
    setModalData({ loading: false, result: { matched, duplicates, missing } });
    e.target.value = "";
  }

  // ── TRENDS ──
  function getTrends() {
    return Array.from({length:6},(_,i)=>{
      let m2=month-5+i, y2=year;
      while(m2<0){m2+=12;y2--;}
      const md2=getMonthData(getMonthKey(y2,m2));
      const t2=md2.transactions||[];
      return { label:MONTHS[m2].slice(0,3), income:t2.filter(t=>t.isIncome).reduce((a,t)=>a+t.amount,0), expenses:t2.filter(t=>!t.isIncome).reduce((a,t)=>a+t.amount,0) };
    });
  }
  const trendsData = getTrends();
  const maxTrend = Math.max(...trendsData.flatMap(d=>[d.income,d.expenses]),1);

  if (loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#f8f6f2",fontFamily:"Georgia,serif",fontSize:18,color:"#888"}}>Loading White Family Budget...</div>;

  const allSubs = Object.values(categories).flatMap(c=>c.sub);

  return (
    <div style={{fontFamily:"Georgia,serif",background:"#f8f6f2",minHeight:"100vh",maxWidth:480,margin:"0 auto",paddingBottom:80}}>

      {/* ── HEADER ── */}
      <div style={{background:"linear-gradient(135deg,#2c5f2e,#1a3a1c)",color:"white",padding:"20px 20px 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 4px 20px rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <div style={{fontSize:11,letterSpacing:2,opacity:0.7,textTransform:"uppercase",fontFamily:"Arial"}}>White Family</div>
            <div style={{fontSize:22,fontWeight:"bold"}}>Budget</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,opacity:0.7,fontFamily:"Arial"}}>Left to spend</div>
            <div style={{fontSize:26,fontWeight:"bold",color:leftToSpend>=0?"#7dde82":"#ff6b6b"}}>{fmt(leftToSpend)}</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <button onClick={()=>{if(month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1);}} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 10px",color:"white",cursor:"pointer",display:"flex",alignItems:"center"}}><ChevronLeft size={16}/></button>
          <div style={{fontSize:16,fontWeight:"bold"}}>{MONTHS[month]} {year}</div>
          <button onClick={()=>{if(month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1);}} style={{background:"rgba(255,255,255,0.15)",border:"none",borderRadius:8,padding:"6px 10px",color:"white",cursor:"pointer",display:"flex",alignItems:"center"}}><ChevronRight size={16}/></button>
        </div>
        {overBudgetCount > 0 && (
          <div style={{marginTop:10,background:"rgba(231,76,60,0.25)",borderRadius:8,padding:"6px 12px",display:"flex",alignItems:"center",gap:8}}>
            <AlertTriangle size={14} color="#ff9f9f"/>
            <span style={{fontSize:12,fontFamily:"Arial",color:"#ffcdd2"}}>{overBudgetCount} categor{overBudgetCount>1?"ies":"y"} over budget</span>
          </div>
        )}
      </div>

      {/* ── BUDGET VIEW ── */}
      {view === "budget" && (
        <div style={{padding:"12px 12px 0"}}>
          {/* Summary bar */}
          <div style={{background:"#fff",borderRadius:14,padding:"14px 16px",marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              {[{label:"Planned Income",val:fmt(totalIncPlan),color:"#2c5f2e"},{label:"Actual Income",val:fmt(totalIncActual),color:"#2980b9"},{label:"Spent",val:fmt(totalExpActual),color:totalExpActual>totalExpPlan?"#e74c3c":"#333"}].map((item,i)=>(
                <div key={i} style={{textAlign:"center"}}>
                  <div style={{fontSize:10,color:"#888",fontFamily:"Arial",textTransform:"uppercase",letterSpacing:1}}>{item.label}</div>
                  <div style={{fontSize:17,fontWeight:"bold",color:item.color}}>{item.val}</div>
                </div>
              ))}
            </div>
            {totalExpPlan > 0 && <ProgressBar planned={totalExpPlan} actual={totalExpActual}/>}
          </div>

          {/* Action buttons */}
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            {[
              {label:"Edit Budget",fn:()=>openModal("editBudget"),color:"#2c5f2e"},
              {label:"Copy Last Month",fn:copyLastMonth,color:"#555"},
              {label:"AI Summary",fn:runAISummary,color:"#8e44ad"},
              {label:"Suggestions",fn:runSmartSuggestions,color:"#2980b9"},
              {label:"Anomalies",fn:checkAnomalies,color:"#e67e22"},
            ].map(b=>(
              <button key={b.label} onClick={b.fn} style={{background:b.color,color:"white",border:"none",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"Arial",fontWeight:"bold"}}>{b.label}</button>
            ))}
          </div>

          {/* Notes */}
          <div style={{background:"#fff",borderRadius:14,marginBottom:10,padding:"12px 16px",boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
            <div style={{fontSize:11,color:"#888",fontFamily:"Arial",marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>📝 Month Notes</div>
            <textarea value={md.notes} onChange={e=>saveMonthData({notes:e.target.value})} placeholder="Add notes for this month..." style={{width:"100%",border:"none",outline:"none",resize:"none",fontFamily:"Georgia,serif",fontSize:13,color:"#444",background:"transparent",boxSizing:"border-box"}} rows={2}/>
          </div>

          {/* Income */}
          <div style={{background:"#fff",borderRadius:14,marginBottom:10,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.05)"}}>
            <div onClick={()=>setExpandedCats(e=>({...e,"__inc":!e["__inc"]}))} style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:20}}>💰</span>
                <div>
                  <div style={{fontWeight:"bold",fontSize:15}}>Income</div>
                  <ProgressBar planned={totalIncPlan} actual={totalIncActual}/>
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#aaa",fontFamily:"Arial"}}>Plan / Actual</div><div style={{fontWeight:"bold",fontSize:14}}>{fmt(totalIncPlan)} / <span style={{color:"#2980b9"}}>{fmt(totalIncActual)}</span></div></div>
                {expandedCats["__inc"]?<ChevronUp size={16} color="#aaa"/>:<ChevronDown size={16} color="#aaa"/>}
              </div>
            </div>
            {expandedCats["__inc"] && INCOME_SOURCES.map(src=>(
              <div key={src} style={{padding:"10px 16px 10px 44px",borderTop:"1px solid #f8f8f8"}}>
                <div style={{display:"flex",justifyContent:"space-between"}}>
                  <div style={{fontSize:14,color:"#444"}}>{src}</div>
                  <div style={{fontSize:13,fontWeight:"bold"}}>{fmt(budget.income?.[src]||0)} / <span style={{color:"#2980b9"}}>{fmt(incActuals[src]||0)}</span></div>
                </div>
                <ProgressBar planned={budget.income?.[src]||0} actual={incActuals[src]||0}/>
              </div>
            ))}
          </div>

          {/* Expense categories */}
          {Object.entries(categories).map(([catName,catInfo])=>{
            const catPlan=catInfo.sub.reduce((a,s)=>a+(budget.expenses?.[s]||0),0);
            const catAct=catInfo.sub.reduce((a,s)=>a+(actuals[s]||0),0);
            const over=catAct>catPlan&&catPlan>0;
            return (
              <div key={catName} style={{background:"#fff",borderRadius:14,marginBottom:10,overflow:"hidden",boxShadow:"0 2px 10px rgba(0,0,0,0.05)",border:over?"1.5px solid #e74c3c20":"1.5px solid transparent"}}>
                <div onClick={()=>setExpandedCats(e=>({...e,[catName]:!e[catName]}))} style={{padding:"14px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                    <span style={{fontSize:20}}>{catInfo.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:"bold",fontSize:15,display:"flex",alignItems:"center",gap:6}}>
                        {catName}
                        {over && <AlertTriangle size={13} color="#e74c3c"/>}
                      </div>
                      <ProgressBar planned={catPlan} actual={catAct}/>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginLeft:10}}>
                    <div style={{textAlign:"right",whiteSpace:"nowrap"}}>
                      <div style={{fontSize:11,color:"#aaa",fontFamily:"Arial"}}>Plan / Actual</div>
                      <div style={{fontWeight:"bold",fontSize:13,color:over?"#e74c3c":"#333"}}>{fmt(catPlan)} / {fmt(catAct)}</div>
                    </div>
                    {expandedCats[catName]?<ChevronUp size={16} color="#aaa"/>:<ChevronDown size={16} color="#aaa"/>}
                  </div>
                </div>
                {expandedCats[catName] && catInfo.sub.map(sub=>{
                  const subPlan=budget.expenses?.[sub]||0;
                  const subAct=actuals[sub]||0;
                  const rollover=isRollover(sub);
                  const rollBal=rollover?getRolloverBalance(sub):0;
                  const effectivePlan=subPlan+(rollBal>0?rollBal:0);
                  return (
                    <div key={sub} style={{padding:"10px 16px 12px 44px",borderTop:"1px solid #f8f8f8"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:14,color:"#444",display:"flex",alignItems:"center",gap:6}}>
                          {sub}
                          {rollover && <span style={{fontSize:10,background:"#9b59b620",color:"#9b59b6",borderRadius:4,padding:"1px 5px",fontFamily:"Arial"}}>rollover</span>}
                        </div>
                        <div style={{fontSize:13,fontWeight:"bold",color:subAct>subPlan&&subPlan>0?"#e74c3c":"#333"}}>{fmt(subPlan)} / {fmt(subAct)}</div>
                      </div>
                      <ProgressBar planned={effectivePlan} actual={subAct}/>
                      {rollover && rollBal !== 0 && <div style={{fontSize:11,color:rollBal>0?"#2c5f2e":"#e74c3c",fontFamily:"Arial",marginTop:3}}>{rollBal>0?`+${fmt(rollBal)} rolled over`:fmt(rollBal)+` deficit from last month`}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Add category */}
          <button onClick={()=>openModal("addCat")} style={{width:"100%",padding:"14px",background:"#fff",border:"2px dashed #ddd",borderRadius:14,fontSize:14,color:"#aaa",cursor:"pointer",marginBottom:20,fontFamily:"Georgia,serif"}}>+ Add Category</button>
        </div>
      )}

      {/* ── TRANSACTIONS VIEW ── */}
      {view === "transactions" && (
        <div style={{padding:"12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:16,fontWeight:"bold"}}>{txs.length} Transactions</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
              <button onClick={()=>receiptRef.current.click()} style={{background:"#2c5f2e",color:"white",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:12,fontFamily:"Arial"}}><Camera size={14}/> Scan</button>
              <button onClick={()=>pdfRef.current.click()} style={{background:"#2980b9",color:"white",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:12,fontFamily:"Arial"}}><Upload size={14}/> Statement</button>
              <button onClick={()=>openModal("nlEntry")} style={{background:"#8e44ad",color:"white",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:12,fontFamily:"Arial"}}><MessageSquare size={14}/> Quick Add</button>
              <button onClick={()=>openModal("addTx")} style={{background:"#555",color:"white",border:"none",borderRadius:8,padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:12,fontFamily:"Arial"}}><PlusCircle size={14}/> Manual</button>
            </div>
          </div>
          <input ref={receiptRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleReceipt}/>
          <input ref={pdfRef} type="file" accept="application/pdf" style={{display:"none"}} onChange={handlePDF}/>

          {txs.length===0 ? (
            <div style={{textAlign:"center",padding:"60px 20px",color:"#aaa"}}>
              <Receipt size={48} style={{marginBottom:12,opacity:0.3}}/>
              <div style={{fontSize:16}}>No transactions yet</div>
              <div style={{fontSize:13,marginTop:6}}>Quick Add, scan a receipt, or import your statement</div>
            </div>
          ) : [...txs].reverse().map(tx=>{
            const cat=categories[tx.category];
            const pct=budget.expenses?.[tx.subcategory]>0?(actuals[tx.subcategory]||0)/budget.expenses[tx.subcategory]*100:0;
            return (
              <div key={tx.id} style={{background:"#fff",borderRadius:12,marginBottom:8,padding:"12px 14px",boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:36,height:36,borderRadius:10,background:(cat?.color||"#888")+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{tx.isIncome?"💰":cat?.icon||"📦"}</div>
                    <div>
                      <div style={{fontWeight:"bold",fontSize:14}}>{tx.description||tx.subcategory}</div>
                      <div style={{fontSize:12,color:"#aaa",fontFamily:"Arial"}}>{tx.subcategory} · {tx.date}</div>
                      {tx.note&&<div style={{fontSize:11,color:"#bbb",fontFamily:"Arial"}}>{tx.note}</div>}
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{fontWeight:"bold",fontSize:16,color:tx.isIncome?"#2c5f2e":"#333"}}>{tx.isIncome?"+":"-"}{fmt(tx.amount)}</div>
                    <button onClick={()=>deleteTx(tx.id)} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",padding:4}}><Trash2 size={15}/></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TRENDS VIEW ── */}
      {view === "trends" && (
        <div style={{padding:"12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:16,fontWeight:"bold"}}>Last 6 Months</div>
            <button onClick={()=>openModal("compare")} style={{background:"#2c5f2e",color:"white",border:"none",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"Arial"}}>Compare Months</button>
          </div>
          <div style={{background:"#fff",borderRadius:14,padding:"20px 16px",marginBottom:12,boxShadow:"0 2px 10px rgba(0,0,0,0.05)"}}>
            <div style={{fontSize:13,color:"#888",fontFamily:"Arial",marginBottom:16}}>Income vs Expenses</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:8,height:140}}>
              {trendsData.map((d,i)=>(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center"}}>
                  <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:120}}>
                    <div style={{flex:1,background:"#2c5f2e",borderRadius:"4px 4px 0 0",height:`${(d.income/maxTrend)*100}%`,minHeight:d.income>0?4:0,transition:"height 0.5s"}}/>
                    <div style={{flex:1,background:"#e74c3c",borderRadius:"4px 4px 0 0",height:`${(d.expenses/maxTrend)*100}%`,minHeight:d.expenses>0?4:0,transition:"height 0.5s"}}/>
                  </div>
                  <div style={{fontSize:10,color:"#aaa",fontFamily:"Arial",marginTop:4}}>{d.label}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:16,marginTop:12,justifyContent:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontFamily:"Arial",color:"#555"}}><div style={{width:12,height:12,borderRadius:3,background:"#2c5f2e"}}/> Income</div>
              <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,fontFamily:"Arial",color:"#555"}}><div style={{width:12,height:12,borderRadius:3,background:"#e74c3c"}}/> Expenses</div>
            </div>
          </div>
          <div style={{background:"#fff",borderRadius:14,padding:"16px",boxShadow:"0 2px 10px rgba(0,0,0,0.05)"}}>
            <div style={{fontSize:13,color:"#888",fontFamily:"Arial",marginBottom:12}}>Monthly Net</div>
            {trendsData.map((d,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:i<5?"1px solid #f5f5f5":"none"}}>
                <div style={{fontSize:14,fontWeight:"bold"}}>{d.label}</div>
                <div style={{display:"flex",gap:16}}>
                  <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#aaa",fontFamily:"Arial"}}>Income</div><div style={{fontSize:13,color:"#2c5f2e",fontWeight:"bold"}}>{fmt(d.income)}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#aaa",fontFamily:"Arial"}}>Spent</div><div style={{fontSize:13,color:"#e74c3c",fontWeight:"bold"}}>{fmt(d.expenses)}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:11,color:"#aaa",fontFamily:"Arial"}}>Net</div><div style={{fontSize:13,fontWeight:"bold",color:(d.income-d.expenses)>=0?"#2c5f2e":"#e74c3c"}}>{(d.income-d.expenses)>=0?"+":""}{fmt(d.income-d.expenses)}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── BOTTOM NAV ── */}
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:480,background:"#fff",borderTop:"1px solid #eee",display:"flex",zIndex:100,boxShadow:"0 -4px 20px rgba(0,0,0,0.08)"}}>
        {[{id:"budget",icon:<Home size={20}/>,label:"Budget"},{id:"transactions",icon:<Receipt size={20}/>,label:"Transactions"},{id:"trends",icon:<BarChart2 size={20}/>,label:"Trends"}].map(tab=>(
          <button key={tab.id} onClick={()=>setView(tab.id)} style={{flex:1,padding:"12px 0 10px",border:"none",background:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,color:view===tab.id?"#2c5f2e":"#bbb",position:"relative"}}>
            {tab.icon}
            <span style={{fontSize:10,fontFamily:"Arial",fontWeight:view===tab.id?"bold":"normal"}}>{tab.label}</span>
            {tab.id==="budget"&&overBudgetCount>0&&<div style={{position:"absolute",top:8,right:"25%",width:8,height:8,borderRadius:"50%",background:"#e74c3c"}}/>}
          </button>
        ))}
      </div>

      {/* ── MODALS ── */}
      {modal && <ModalOverlay onClose={closeModal}>
        {modal==="addTx" && <AddTxModal cats={categories} subs={allSubs} today={today} onSave={tx=>{addTx(tx);closeModal();showToast("Added!");}} onClose={closeModal}/>}
        {modal==="nlEntry" && <NLModal onClose={closeModal} onSave={async text=>{const tx=await handleNLEntry(text);if(tx){addTx(tx);closeModal();showToast("Added!");}}} />}
        {modal==="editBudget" && <EditBudgetModal cats={categories} budget={budget} onSave={saveBudget} onClose={closeModal} onSaveCats={saveCats}/>}
        {modal==="scan" && <ScanModal data={modalData} onConfirm={(item,cat)=>{
          const k=item.description?.toLowerCase().trim();
          if(cat!==item.suggestedCategory) saveRules({...rules,[k]:cat});
          addTx({date:item.date||today.toISOString().split("T")[0],description:item.description,amount:item.amount,category:getCatForSub(cat,categories),subcategory:cat,note:"Receipt scan",isIncome:false});
          const remaining=(modalData.items||[]).filter(i=>i!==item);
          if(remaining.length===0){closeModal();showToast("All items added!");}
          else setModalData({...modalData,items:remaining});
          showToast("Added!");
        }} onClose={closeModal}/>}
        {modal==="import" && <ImportModal data={modalData} onConfirm={(toAdd)=>{addTxs(toAdd);closeModal();showToast(`Added ${toAdd.length} transactions!`);}} onClose={closeModal} allSubs={allSubs}/>}
        {modal==="aiSummary" && <AISummaryModal data={modalData} onClose={closeModal}/>}
        {modal==="addCat" && <AddCatModal cats={categories} onSave={c=>{saveCats(c);closeModal();showToast("Category saved!");}} onClose={closeModal}/>}
        {modal==="compare" && <CompareModal allData={allData} cats={categories} getMonthData={getMonthData} onClose={closeModal}/>}
      </ModalOverlay>}

      {/* Toast */}
      {toast&&<div style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:toast.type==="error"?"#e74c3c":"#2c5f2e",color:"white",padding:"12px 24px",borderRadius:12,fontSize:14,fontFamily:"Arial",zIndex:400,boxShadow:"0 4px 20px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>{toast.msg}</div>}
    </div>
  );
}

// ── SHARED MODAL WRAPPER ───────────────────────────────────────────────────────
function ModalOverlay({children,onClose}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:200,display:"flex",alignItems:"flex-end"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"#fff",width:"100%",maxWidth:480,margin:"0 auto",borderRadius:"20px 20px 0 0",maxHeight:"90vh",overflowY:"auto"}}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({title,onClose}) {
  return (
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"22px 20px 0"}}>
      <div style={{fontSize:18,fontWeight:"bold"}}>{title}</div>
      <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:"#aaa"}}><X size={22}/></button>
    </div>
  );
}

// ── ADD TRANSACTION MODAL ──────────────────────────────────────────────────────
function AddTxModal({cats,subs,today,onSave,onClose}) {
  const [tx,setTx]=useState({date:today.toISOString().split("T")[0],description:"",amount:"",category:"Food & Dining",subcategory:"Groceries",note:"",isIncome:false});
  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title="Add Transaction" onClose={onClose}/>
      <div style={{marginTop:16}}>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button onClick={()=>setTx(t=>({...t,isIncome:false}))} style={{flex:1,padding:"10px",borderRadius:10,border:"2px solid",borderColor:!tx.isIncome?"#2c5f2e":"#eee",background:!tx.isIncome?"#2c5f2e10":"#fff",fontWeight:"bold",cursor:"pointer"}}>Expense</button>
          <button onClick={()=>setTx(t=>({...t,isIncome:true,subcategory:"Nash's Income"}))} style={{flex:1,padding:"10px",borderRadius:10,border:"2px solid",borderColor:tx.isIncome?"#2980b9":"#eee",background:tx.isIncome?"#2980b910":"#fff",fontWeight:"bold",cursor:"pointer"}}>Income</button>
        </div>
        {[{label:"Description",key:"description",type:"text",ph:"e.g. Walmart..."},{label:"Amount ($)",key:"amount",type:"number",ph:"0.00"},{label:"Date",key:"date",type:"date"}].map(f=>(
          <div key={f.key} style={{marginBottom:14}}>
            <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>{f.label}</label>
            <input type={f.type} value={tx[f.key]} placeholder={f.ph} onChange={e=>setTx(t=>({...t,[f.key]:e.target.value}))} style={{width:"100%",padding:"12px",borderRadius:10,border:"1px solid #e8e8e8",fontSize:15,fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none"}}/>
          </div>
        ))}
        {!tx.isIncome&&<div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>Category</label>
          <select value={tx.category} onChange={e=>{const c=e.target.value;setTx(t=>({...t,category:c,subcategory:cats[c].sub[0]}));}} style={{width:"100%",padding:"12px",borderRadius:10,border:"1px solid #e8e8e8",fontSize:15,fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none",background:"#fff"}}>
{Object.keys(cats).map(c=><option key={c} value={c}>{cats[c].icon} {c}</option>)}
          </select>
        </div>}
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>{tx.isIncome?"Income Source":"Subcategory"}</label>
          <select value={tx.subcategory} onChange={e=>setTx(t=>({...t,subcategory:e.target.value}))} style={{width:"100%",padding:"12px",borderRadius:10,border:"1px solid #e8e8e8",fontSize:15,fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none",background:"#fff"}}>
            {(tx.isIncome?["Adalyn's Income","Nash's Income","Other Income"]:(cats[tx.category]?.sub||[])).map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>Note (optional)</label>
          <input type="text" value={tx.note} placeholder="Any notes..." onChange={e=>setTx(t=>({...t,note:e.target.value}))} style={{width:"100%",padding:"12px",borderRadius:10,border:"1px solid #e8e8e8",fontSize:15,fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none"}}/>
        </div>
        <button onClick={()=>{if(!tx.amount||!tx.description)return;onSave(tx);}} style={{width:"100%",padding:"16px",background:"#2c5f2e",color:"white",border:"none",borderRadius:12,fontSize:16,fontWeight:"bold",cursor:"pointer",fontFamily:"Georgia,serif"}}>Save Transaction</button>
      </div>
    </div>
  );
}

// ── NATURAL LANGUAGE ENTRY ─────────────────────────────────────────────────────
function NLModal({onClose,onSave}) {
  const [text,setText]=useState("");
  const [loading,setLoading]=useState(false);
  const examples=["spent $47 at Chick-fil-A last Tuesday","$800 groceries at Costco today","Adalyn got paid $1200 yesterday","$85 date night dinner Saturday","paid $150 electric bill"];
  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title="✨ Quick Add" onClose={onClose}/>
      <div style={{marginTop:16}}>
        <p style={{fontSize:13,color:"#888",fontFamily:"Arial",marginBottom:16}}>Just type what you spent naturally — AI will figure out the rest.</p>
        <textarea value={text} onChange={e=>setText(e.target.value)} placeholder='e.g. "spent $47 at Chick-fil-A last Tuesday"' style={{width:"100%",padding:"14px",borderRadius:12,border:"1px solid #e8e8e8",fontSize:15,fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none",resize:"none",minHeight:80}} rows={3}/>
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,color:"#aaa",fontFamily:"Arial",marginBottom:8}}>Examples:</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {examples.map(ex=><button key={ex} onClick={()=>setText(ex)} style={{background:"#f8f6f2",border:"1px solid #eee",borderRadius:8,padding:"5px 10px",fontSize:11,fontFamily:"Arial",cursor:"pointer",color:"#555"}}>{ex}</button>)}
          </div>
        </div>
        <button onClick={async()=>{
          if(!text.trim())return;
          setLoading(true);
          try { await onSave(text); } catch(e) { console.error(e); alert("Error: " + e.message); }
          setLoading(false);
        }} disabled={loading} style={{width:"100%",padding:"16px",background:loading?"#aaa":"#8e44ad",color:"white",border:"none",borderRadius:12,fontSize:16,fontWeight:"bold",cursor:loading?"not-allowed":"pointer",fontFamily:"Georgia,serif"}}>
          {loading?"Parsing...":"Add Transaction"}
        </button>
      </div>
    </div>
  );
}

// ── SCAN ITEM subcomponent (hooks must not be inside .map()) ───────────────────
function ScanItem({item, onConfirm}) {
  const allSubs = Object.values(DEFAULT_CATEGORIES).flatMap(c=>c.sub);
  const [cat, setCat] = useState(item.suggestedCategory || allSubs[0]);
  const hasSplit = item.splitSuggestions?.length > 1;
  return (
    <div style={{background:"#f8f6f2",borderRadius:12,padding:"14px",marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
        <div style={{fontWeight:"bold",fontSize:15}}>{item.description}</div>
        <div style={{fontWeight:"bold",color:"#e74c3c"}}>{fmt(item.amount)}</div>
      </div>
      {hasSplit && <div style={{fontSize:11,color:"#8e44ad",fontFamily:"Arial",marginBottom:8}}>✨ AI suggests splitting across {item.splitSuggestions.length} categories</div>}
      <select value={cat} onChange={e=>setCat(e.target.value)} style={{width:"100%",padding:"8px",borderRadius:8,border:"1px solid #ddd",fontSize:13,marginBottom:10,background:"#fff",outline:"none"}}>
        {allSubs.map(s=><option key={s} value={s}>{s}</option>)}
      </select>
      {hasSplit ? (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:11,color:"#888",fontFamily:"Arial",marginBottom:6}}>Split suggestions:</div>
          {item.splitSuggestions.map((sp,si)=>(
            <div key={si} style={{display:"flex",justifyContent:"space-between",fontSize:13,padding:"4px 0",borderBottom:"1px solid #eee"}}>
              <span style={{color:"#444"}}>{sp.subcategory}</span><span style={{fontWeight:"bold"}}>{fmt(sp.amount)}</span>
            </div>
          ))}
          <button onClick={()=>item.splitSuggestions.forEach(sp=>onConfirm({...item,description:item.description+" (split)",amount:sp.amount,suggestedCategory:sp.subcategory},sp.subcategory))}
            style={{width:"100%",marginTop:8,padding:"9px",background:"#8e44ad",color:"white",border:"none",borderRadius:8,fontSize:13,fontWeight:"bold",cursor:"pointer"}}>
            ✓ Add as Split
          </button>
        </div>
      ) : (
        <button onClick={()=>onConfirm(item,cat)} style={{width:"100%",padding:"10px",background:"#2c5f2e",color:"white",border:"none",borderRadius:8,fontSize:14,fontWeight:"bold",cursor:"pointer"}}>
          ✓ Add to Budget
        </button>
      )}
    </div>
  );
}

// ── SCAN MODAL ─────────────────────────────────────────────────────────────────
function ScanModal({data,onConfirm,onClose}) {
  const [items,setItems] = useState(data?.items||[]);
  useEffect(()=>{ if(data?.items) setItems(data.items); },[data?.items]);

  if(data?.loading) return (
    <div style={{padding:"60px 20px",textAlign:"center"}}>
      <div style={{fontSize:40,marginBottom:12}}>🔍</div>
      <div style={{fontSize:16,fontFamily:"Arial",color:"#888"}}>Reading receipt...</div>
    </div>
  );

  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title="Receipt Scan" onClose={onClose}/>
      <div style={{marginTop:16}}>
        {items.length === 0 && <div style={{textAlign:"center",color:"#aaa",padding:"30px 0",fontFamily:"Arial"}}>No items found. Try a clearer photo.</div>}
        {items.map((item,i)=>(
          <ScanItem key={i} item={item} onConfirm={(it,cat)=>{
            onConfirm(it,cat);
            setItems(prev=>prev.filter((_,xi)=>xi!==i));
          }}/>
        ))}
      </div>
    </div>
  );
}

// ── IMPORT MODAL ───────────────────────────────────────────────────────────────
function ImportModal({data,onConfirm,onClose,allSubs}) {
  const [missing,setMissing]=useState(data?.result?.missing||[]);
  const [dups,setDups]=useState(data?.result?.duplicates||[]);
  useEffect(()=>{ if(data?.result){setMissing(data.result.missing||[]);setDups(data.result.duplicates||[]);} },[data?.result]);

  if(data?.loading) return <div style={{padding:"60px 20px",textAlign:"center"}}><div style={{fontSize:40,marginBottom:12}}>📄</div><div style={{fontSize:16,fontFamily:"Arial",color:"#888"}}>Reading statement...</div></div>;
  if(!data?.result) return null;

  const addCount=missing.filter(m=>m.selected).length+dups.filter(d=>d.selected).length;

  function confirm() {
    const toAdd=[];
    missing.filter(m=>m.selected).forEach(m=>toAdd.push({date:m.date,description:m.description,amount:m.amount,category:getCatForSub(m.suggestedCategory,DEFAULT_CATEGORIES),subcategory:m.suggestedCategory,note:"Imported from statement",isIncome:m.isIncome}));
    dups.filter(d=>d.selected).forEach(d=>toAdd.push({date:d.statement.date,description:d.statement.description,amount:d.statement.amount,category:getCatForSub(d.suggestedCategory,DEFAULT_CATEGORIES),subcategory:d.suggestedCategory,note:"Imported (duplicate reviewed)",isIncome:false}));
    onConfirm(toAdd);
  }

  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title="Statement Review" onClose={onClose}/>
      <div style={{marginTop:16}}>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[{n:data.result.matched?.length||0,label:"✅ Already logged",bg:"#f0fdf4",c:"#2c5f2e"},{n:dups.length,label:"⚠️ Possible dup",bg:"#fffbeb",c:"#d97706"},{n:missing.length,label:"➕ Not logged",bg:"#fef2f2",c:"#e74c3c"}].map((p,i)=>(
            <div key={i} style={{flex:1,background:p.bg,borderRadius:10,padding:"10px",textAlign:"center"}}>
              <div style={{fontSize:22,fontWeight:"bold",color:p.c}}>{p.n}</div>
              <div style={{fontSize:10,color:p.c,fontFamily:"Arial"}}>{p.label}</div>
            </div>
          ))}
        </div>

        {missing.length>0&&<div style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"#e74c3c",fontFamily:"Arial",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>➕ Not Yet Logged</div>
          {missing.map((m,i)=>(
            <div key={m.id} style={{background:m.selected?"#fff8f8":"#fafafa",border:`2px solid ${m.selected?"#e74c3c":"#eee"}`,borderRadius:12,padding:"12px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                <div style={{flex:1}}><div style={{fontWeight:"bold",fontSize:14}}>{m.description}</div><div style={{fontSize:12,color:"#aaa",fontFamily:"Arial"}}>{m.date}</div></div>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{fontWeight:"bold",color:"#e74c3c"}}>{fmt(m.amount)}</div>
                  <button onClick={()=>setMissing(prev=>prev.map((x,xi)=>xi===i?{...x,selected:!x.selected}:x))} style={{width:28,height:28,borderRadius:8,border:`2px solid ${m.selected?"#e74c3c":"#ddd"}`,background:m.selected?"#e74c3c":"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {m.selected&&<Check size={14} color="white"/>}
                  </button>
                </div>
              </div>
              <select value={m.suggestedCategory} onChange={e=>setMissing(prev=>prev.map((x,xi)=>xi===i?{...x,suggestedCategory:e.target.value}:x))} style={{width:"100%",padding:"7px",borderRadius:8,border:"1px solid #e8e8e8",fontSize:13,background:"#fff",outline:"none"}}>
                {allSubs.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>}

        {dups.length>0&&<div style={{marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:"bold",color:"#d97706",fontFamily:"Arial",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>⚠️ Possible Duplicates</div>
          {dups.map((d,i)=>(
            <div key={d.id} style={{background:d.selected?"#fffbeb":"#fafafa",border:`2px solid ${d.selected?"#d97706":"#eee"}`,borderRadius:12,padding:"12px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                <div style={{flex:1}}><div style={{fontWeight:"bold",fontSize:14}}>{d.statement.description}</div><div style={{fontSize:12,color:"#aaa",fontFamily:"Arial"}}>Statement: {d.statement.date} · {fmt(d.statement.amount)}</div><div style={{fontSize:12,color:"#bbb",fontFamily:"Arial"}}>Already logged: {d.existing.description}</div></div>
                <button onClick={()=>setDups(prev=>prev.map((x,xi)=>xi===i?{...x,selected:!x.selected}:x))} style={{width:28,height:28,borderRadius:8,border:`2px solid ${d.selected?"#d97706":"#ddd"}`,background:d.selected?"#d97706":"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginLeft:10}}>
                  {d.selected&&<Check size={14} color="white"/>}
                </button>
              </div>
              <select value={d.suggestedCategory} onChange={e=>setDups(prev=>prev.map((x,xi)=>xi===i?{...x,suggestedCategory:e.target.value}:x))} style={{width:"100%",padding:"7px",borderRadius:8,border:"1px solid #e8e8e8",fontSize:13,background:"#fff",outline:"none"}}>
                {allSubs.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
        </div>}

        {data.result.matched?.length>0&&<div style={{background:"#f0fdf4",borderRadius:12,padding:"12px 14px",marginBottom:20}}><div style={{fontSize:13,color:"#2c5f2e",fontFamily:"Arial",fontWeight:"bold"}}>✅ {data.result.matched.length} transactions already logged — no action needed.</div></div>}

        <button onClick={confirm} style={{width:"100%",padding:"16px",background:"#2c5f2e",color:"white",border:"none",borderRadius:12,fontSize:16,fontWeight:"bold",cursor:"pointer",fontFamily:"Georgia,serif"}}>Add {addCount} Selected Transaction{addCount!==1?"s":""}</button>
      </div>
    </div>
  );
}

// ── EDIT BUDGET MODAL ──────────────────────────────────────────────────────────
function EditBudgetModal({cats,budget,onSave,onClose,onSaveCats}) {
  const [b,setB]=useState(JSON.parse(JSON.stringify(budget)));
  const [localCats,setLocalCats]=useState(JSON.parse(JSON.stringify(cats)));

  function toggleRollover(sub) {
    const catName=Object.entries(localCats).find(([,v])=>v.sub.includes(sub))?.[0];
    if(!catName)return;
    const cur=localCats[catName].rollover?.[sub]===true;
    const nc={...localCats,[catName]:{...localCats[catName],rollover:{...localCats[catName].rollover,[sub]:!cur}}};
    setLocalCats(nc);
  }

  function deleteSub(catName,sub) {
    const nc={...localCats,[catName]:{...localCats[catName],sub:localCats[catName].sub.filter(s=>s!==sub)}};
    setLocalCats(nc);
    const nb={...b,expenses:{...b.expenses}};delete nb.expenses[sub];setB(nb);
  }

  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title={`Edit Budget`} onClose={onClose}/>
      <div style={{marginTop:16}}>
        <div style={{fontSize:13,fontWeight:"bold",color:"#2c5f2e",marginBottom:10,fontFamily:"Arial",textTransform:"uppercase",letterSpacing:1}}>Income</div>
        {["Adalyn's Income","Nash's Income","Other Income"].map(src=>(
          <div key={src} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <label style={{fontSize:14,color:"#444",flex:1}}>{src}</label>
            <input type="number" value={b.income?.[src]||0} onChange={e=>setB(d=>({...d,income:{...d.income,[src]:parseFloat(e.target.value)||0}}))} style={{width:100,padding:"8px 10px",borderRadius:8,border:"1px solid #e8e8e8",fontSize:14,textAlign:"right",outline:"none"}}/>
          </div>
        ))}
        {Object.entries(localCats).map(([catName,catInfo])=>(
          <div key={catName} style={{marginTop:16}}>
            <div style={{fontSize:13,fontWeight:"bold",color:catInfo.color,marginBottom:8,fontFamily:"Arial",textTransform:"uppercase",letterSpacing:1,display:"flex",alignItems:"center",gap:6}}>{catInfo.icon} {catName}</div>
            {catInfo.sub.map(sub=>(
              <div key={sub} style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <label style={{fontSize:14,color:"#444",flex:1}}>{sub}</label>
                <button onClick={()=>toggleRollover(sub)} title="Toggle rollover" style={{fontSize:10,padding:"3px 7px",borderRadius:6,border:"1px solid",borderColor:localCats[catName].rollover?.[sub]?"#9b59b6":"#ddd",background:localCats[catName].rollover?.[sub]?"#9b59b620":"#fff",color:localCats[catName].rollover?.[sub]?"#9b59b6":"#aaa",cursor:"pointer",fontFamily:"Arial",whiteSpace:"nowrap"}}>rollover</button>
                <input type="number" value={b.expenses?.[sub]||0} onChange={e=>setB(d=>({...d,expenses:{...d.expenses,[sub]:parseFloat(e.target.value)||0}}))} style={{width:90,padding:"8px 10px",borderRadius:8,border:"1px solid #e8e8e8",fontSize:14,textAlign:"right",outline:"none"}}/>
                <button onClick={()=>deleteSub(catName,sub)} style={{background:"none",border:"none",cursor:"pointer",color:"#ddd",padding:4}}><Trash2 size={14}/></button>
              </div>
            ))}
          </div>
        ))}
        <button onClick={()=>{onSaveCats(localCats);onSave(b);}} style={{width:"100%",padding:"16px",background:"#2c5f2e",color:"white",border:"none",borderRadius:12,fontSize:16,fontWeight:"bold",cursor:"pointer",marginTop:20,fontFamily:"Georgia,serif"}}>Save Budget</button>
      </div>
    </div>
  );
}

// ── AI SUMMARY MODAL ───────────────────────────────────────────────────────────
function AISummaryModal({data,onClose}) {
  const titles={summary:"📊 Monthly Summary",suggestions:"💡 Smart Suggestions",anomalies:"🔍 Anomaly Check"};
  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title={titles[data?.type]||"AI Insights"} onClose={onClose}/>
      <div style={{marginTop:16}}>
        {data?.loading?(
          <div style={{textAlign:"center",padding:"40px 0"}}>
            <div style={{fontSize:36,marginBottom:12}}>✨</div>
            <div style={{fontFamily:"Arial",fontSize:14,color:"#888"}}>Analyzing your budget...</div>
          </div>
        ):(
          <div style={{background:"#f8f6f2",borderRadius:12,padding:"16px",fontSize:14,lineHeight:1.7,color:"#333",whiteSpace:"pre-wrap",fontFamily:"Georgia,serif"}}>{data?.text}</div>
        )}
      </div>
    </div>
  );
}

// ── ADD CATEGORY MODAL ─────────────────────────────────────────────────────────
function AddCatModal({cats,onSave,onClose}) {
  const [name,setName]=useState("");
  const [icon,setIcon]=useState("📦");
  const [color,setColor]=useState("#95a5a6");
  const [subName,setSubName]=useState("");
  const [subs,setSubs]=useState([]);
  const colors=["#e67e22","#3498db","#8e44ad","#16a085","#27ae60","#2980b9","#e74c3c","#f39c12","#1abc9c","#95a5a6","#34495e","#9b59b6"];
  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title="Add Category" onClose={onClose}/>
      <div style={{marginTop:16}}>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>Category Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Pets, Travel, Hobbies" style={{width:"100%",padding:"12px",borderRadius:10,border:"1px solid #e8e8e8",fontSize:15,fontFamily:"Georgia,serif",boxSizing:"border-box",outline:"none"}}/>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>Icon</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {EMOJI_OPTIONS.map(e=><button key={e} onClick={()=>setIcon(e)} style={{width:36,height:36,borderRadius:8,border:`2px solid ${icon===e?"#2c5f2e":"#eee"}`,background:icon===e?"#2c5f2e10":"#fff",fontSize:18,cursor:"pointer"}}>{e}</button>)}
          </div>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>Color</label>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {colors.map(c=><button key={c} onClick={()=>setColor(c)} style={{width:32,height:32,borderRadius:"50%",background:c,border:`3px solid ${color===c?"#333":"transparent"}`,cursor:"pointer"}}/>)}
          </div>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{fontSize:12,color:"#888",fontFamily:"Arial",display:"block",marginBottom:6}}>Subcategories</label>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <input value={subName} onChange={e=>setSubName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&subName.trim()){setSubs(s=>[...s,subName.trim()]);setSubName("");}}} placeholder="Type and press Enter" style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e8e8e8",fontSize:14,outline:"none"}}/>
            <button onClick={()=>{if(subName.trim()){setSubs(s=>[...s,subName.trim()]);setSubName("");}}} style={{padding:"10px 14px",background:"#2c5f2e",color:"white",border:"none",borderRadius:8,cursor:"pointer"}}><PlusCircle size={16}/></button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {subs.map((s,i)=><div key={i} style={{background:"#f0f0f0",borderRadius:8,padding:"4px 10px",fontSize:13,display:"flex",alignItems:"center",gap:6}}>{s}<button onClick={()=>setSubs(prev=>prev.filter((_,xi)=>xi!==i))} style={{background:"none",border:"none",cursor:"pointer",color:"#aaa",padding:0}}><X size={12}/></button></div>)}
          </div>
        </div>
        <button onClick={()=>{if(!name.trim()||subs.length===0)return;const nc={...cats,[name]:{icon,color,sub:subs,rollover:{}}};onSave(nc);}} style={{width:"100%",padding:"16px",background:"#2c5f2e",color:"white",border:"none",borderRadius:12,fontSize:16,fontWeight:"bold",cursor:"pointer",fontFamily:"Georgia,serif"}}>Add Category</button>
      </div>
    </div>
  );
}

// ── COMPARE MONTHS MODAL ───────────────────────────────────────────────────────
function CompareModal({allData,cats,getMonthData,onClose}) {
  const today=new Date();
  const [m1,setM1]=useState(today.getMonth());
  const [y1,setY1]=useState(today.getFullYear());
  const [m2,setM2]=useState(today.getMonth()===0?11:today.getMonth()-1);
  const [y2,setY2]=useState(today.getMonth()===0?today.getFullYear()-1:today.getFullYear());

  const d1=getMonthData(getMonthKey(y1,m1));
  const d2=getMonthData(getMonthKey(y2,m2));

  function acts(txs) { const a={}; txs.filter(t=>!t.isIncome).forEach(t=>{a[t.subcategory]=(a[t.subcategory]||0)+t.amount;}); return a; }
  const a1=acts(d1.transactions||[]);
  const a2=acts(d2.transactions||[]);

  const monthOpts=[];
  for(let i=0;i<12;i++){let m=today.getMonth()-i,y=today.getFullYear();while(m<0){m+=12;y--;}monthOpts.push({m,y,label:`${MONTHS[m].slice(0,3)} ${y}`});}

  return (
    <div style={{padding:"0 20px 40px"}}>
      <ModalHeader title="Compare Months" onClose={onClose}/>
      <div style={{marginTop:16}}>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <select value={`${y1}-${m1}`} onChange={e=>{const[y,m]=e.target.value.split("-");setY1(+y);setM1(+m);}} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #eee",outline:"none",background:"#fff",fontSize:14}}>
            {monthOpts.map(o=><option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{o.label}</option>)}
          </select>
          <span style={{alignSelf:"center",color:"#aaa",fontFamily:"Arial"}}>vs</span>
          <select value={`${y2}-${m2}`} onChange={e=>{const[y,m]=e.target.value.split("-");setY2(+y);setM2(+m);}} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #eee",outline:"none",background:"#fff",fontSize:14}}>
            {monthOpts.map(o=><option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{o.label}</option>)}
          </select>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,padding:"0 4px"}}>
          <div style={{fontSize:12,fontWeight:"bold",color:"#2c5f2e",fontFamily:"Arial"}}>{MONTHS[m1].slice(0,3)} {y1}</div>
          <div style={{fontSize:12,fontWeight:"bold",color:"#2980b9",fontFamily:"Arial"}}>{MONTHS[m2].slice(0,3)} {y2}</div>
        </div>
        {Object.entries(cats).map(([catName,catInfo])=>{
          const s1=catInfo.sub.reduce((a,s)=>a+(a1[s]||0),0);
          const s2=catInfo.sub.reduce((a,s)=>a+(a2[s]||0),0);
          if(s1===0&&s2===0)return null;
          const diff=s1-s2;
          return (
            <div key={catName} style={{background:"#fff",borderRadius:10,padding:"10px 14px",marginBottom:8,boxShadow:"0 1px 6px rgba(0,0,0,0.05)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}><span>{catInfo.icon}</span><span style={{fontSize:14,fontWeight:"bold"}}>{catName}</span></div>
                <div style={{fontSize:12,color:diff>0?"#e74c3c":diff<0?"#2c5f2e":"#888",fontFamily:"Arial",fontWeight:"bold"}}>{diff>0?"+":""}{fmt(diff)}</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
                <div style={{fontSize:13,color:"#2c5f2e",fontWeight:"bold"}}>{fmt(s1)}</div>
                <div style={{fontSize:13,color:"#2980b9",fontWeight:"bold"}}>{fmt(s2)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
