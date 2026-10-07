import { useEffect, useMemo, useState } from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { Activity, ArrowDownToLine, CalendarDays, ChevronDown, CircleHelp, Filter, Layers3, LogOut, RotateCcw, ShoppingBag, Store, Utensils, Wallet } from 'lucide-react'

type Line = { day:string; outlet:string; group:string; item:string; orderType:string; settlement:string; revenue:number; quantity:number; lineItems:number }
type Order = { day:string; outlet:string; orderType:string; settlement:string; groupMask:number; itemMask:number; orders:number; revenue:number; quantity:number; lineItems:number }
type Dataset = { meta:{sourceSheet:string;lineItems:number;orderCount:number;dateMin:string;dateMax:string;outlets:string[];groups:string[];items:string[];orderTypes:string[];settlements:string[];brands:string[];revenue:number;quantity:number;zeroPriceLineItems:number;groupBits:Record<string,number>;itemBits:Record<string,number>}; lines:Line[]; orders:Order[] }
type Filters = { from:string; to:string; outlet:string; group:string; item:string; orderType:string; settlement:string }
type DashboardSection = 'overview'|'products'|'channels'

const money = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0})
const number = new Intl.NumberFormat('en-IN')
const compact = new Intl.NumberFormat('en-IN',{notation:'compact',maximumFractionDigits:1})
const dayLabel = (day:string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})
const COLORS = ['#5859e8','#2c9b78','#f0a14a','#df6976','#4197b7','#8066c7','#9aa3af']
const initialFilters:Filters = {from:'',to:'',outlet:'',group:'',item:'',orderType:'',settlement:''}
echarts.use([BarChart,LineChart,PieChart,GridComponent,TooltipComponent,CanvasRenderer])

function App(){
  const [data,setData] = useState<Dataset|null>(null)
  const [error,setError] = useState('')
  const [user,setUser] = useState<{email:string;displayName:string}|null>(null)
  const [authReady,setAuthReady] = useState(false)
  const [authRequired,setAuthRequired] = useState(false)
  const [registrationEnabled,setRegistrationEnabled] = useState(false)
  const [demoUsername,setDemoUsername] = useState<string|null>(null)
  const [authServiceUnavailable,setAuthServiceUnavailable] = useState(false)
  const [californiaIntro,setCaliforniaIntro] = useState(false)
  const [authError,setAuthError] = useState('')
  const [filters,setFilters] = useState<Filters>(initialFilters)
  const [activeSection,setActiveSection] = useState<DashboardSection>('overview')
  const [helpOpen,setHelpOpen] = useState(false)
  const [workspaceOpen,setWorkspaceOpen] = useState(false)
  useEffect(()=>{Promise.all([fetch('/api/auth/me',{credentials:'same-origin'}),fetch('/api/auth/config',{credentials:'same-origin'})]).then(async([sessionResponse,configResponse])=>{if(sessionResponse.ok){const result=await sessionResponse.json();setUser(result.user)}else{setAuthRequired(true);if(sessionResponse.status>=500)setAuthServiceUnavailable(true)}if(configResponse.ok){const config=await configResponse.json();setRegistrationEnabled(config.registrationEnabled===true);setDemoUsername(typeof config.demoUsername==='string'?config.demoUsername:null);if(sessionResponse.status<500)setAuthServiceUnavailable(false)}else{setAuthRequired(true);setAuthServiceUnavailable(true)}}).catch(()=>{setAuthRequired(true);setAuthServiceUnavailable(true)}).finally(()=>setAuthReady(true))},[])
  useEffect(()=>{if(!californiaIntro)return;const timer=window.setTimeout(()=>setCaliforniaIntro(false),2800);return()=>window.clearTimeout(timer)},[californiaIntro])
  useEffect(()=>{if(!user)return;loadDataset().then(setData).catch(e=>{if(e?.status===401){setUser(null);setAuthRequired(true);return}const message=e instanceof Error?e.message:'Dashboard data could not be loaded.';setError(message==='Failed to fetch'?'Could not reach the dashboard API. Check that both the Node API and Vite server are running.':message)})},[user])
  const set = (key:keyof Filters,value:string) => {setFilters(v=>({...v,[key]:value,...(key==='group'&&v.item&&!data?.meta.items.includes(v.item)?{item:''}:{})}))}
  const reset = () => setFilters(initialFilters)
  const navigateTo = (section:DashboardSection) => {setActiveSection(section);setHelpOpen(false);setWorkspaceOpen(false);window.scrollTo({top:0,behavior:'smooth'})}

  const view = useMemo(()=>{
    if(!data)return null
    const selectedGroup = filters.group ? data.meta.groupBits[filters.group] : 0
    const selectedItem = filters.item ? data.meta.itemBits[filters.item] : 0
    const base = (r:{day:string;outlet:string;orderType:string;settlement:string}) =>
      (!filters.from||r.day>=filters.from)&&(!filters.to||r.day<=filters.to)&&(!filters.outlet||r.outlet===filters.outlet)&&(!filters.orderType||r.orderType===filters.orderType)&&(!filters.settlement||r.settlement===filters.settlement)
    const matchingLines = data.lines.filter(r=>base(r)&&(!filters.group||r.group===filters.group)&&(!filters.item||r.item===filters.item))
    let revenue=0,quantity=0,lineItems=0
    const daily=new Map<string,number>(),groups=new Map<string,number>(),outlets=new Map<string,number>(),items=new Map<string,{revenue:number;quantity:number}>(),types=new Map<string,number>(),settlements=new Map<string,number>()
    for(const r of matchingLines){revenue+=r.revenue;quantity+=r.quantity;lineItems+=r.lineItems;daily.set(r.day,(daily.get(r.day)||0)+r.revenue);groups.set(r.group,(groups.get(r.group)||0)+r.revenue);outlets.set(r.outlet,(outlets.get(r.outlet)||0)+r.revenue);const it=items.get(r.item)||{revenue:0,quantity:0};it.revenue+=r.revenue;it.quantity+=r.quantity;items.set(r.item,it);types.set(r.orderType,(types.get(r.orderType)||0)+r.lineItems);settlements.set(r.settlement,(settlements.get(r.settlement)||0)+r.revenue)}
    let orders=0
    for(const r of data.orders){if(!base(r))continue;if(selectedGroup&&!(r.groupMask&selectedGroup))continue;if(selectedItem&&!(r.itemMask&selectedItem))continue;orders+=r.orders}
    const trend=[...daily].sort(([a],[b])=>a.localeCompare(b)).map(([day,value])=>({day,label:dayLabel(day),revenue:value}))
    const byGroup=[...groups].sort((a,b)=>b[1]-a[1]).map(([name,value],i)=>({name,value,color:COLORS[i%COLORS.length]}))
    const byOutlet=[...outlets].sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}))
    const topItems=[...items].sort((a,b)=>b[1].revenue-a[1].revenue).slice(0,8).map(([name,v])=>({name,...v}))
    const byType=[...types].map(([name,value])=>({name,value}))
    const bySettlement=[...settlements].sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}))
    const prior=trend.length>1?trend.slice(0,-1).reduce((a,b)=>a+b.revenue,0)/(trend.length-1):0
    const bestOutlet=byOutlet[0], bestGroup=byGroup[0]
    return {revenue,quantity,lineItems,orders,aov:orders?revenue/orders:0,trend,byGroup,byOutlet,topItems,byType,bySettlement,bestOutlet,bestGroup,trendDays:trend.length,dailyAverage:trend.length?revenue/trend.length:0,priorDailyAverage:prior,lastDayRevenue:trend.length?trend[trend.length-1].revenue:0}
  },[data,filters])

  const insights=useMemo(()=>{
    if(!view)return []
    const result:string[]=[]
    if(view.bestOutlet)result.push(`${view.bestOutlet.name} leads the selected outlets with ${view.revenue?Math.round(view.bestOutlet.value/view.revenue*100):0}% of revenue.`)
    if(view.bestGroup)result.push(`${view.bestGroup.name} is the top category at ${view.revenue?Math.round(view.bestGroup.value/view.revenue*100):0}% of sales.`)
    if(view.topItems[0])result.push(`${view.topItems[0].name} is the leading item with ${money.format(view.topItems[0].revenue)} in sales.`)
    if(view.trendDays>1&&view.priorDailyAverage){const change=((view.lastDayRevenue-view.priorDailyAverage)/view.priorDailyAverage)*100;result.push(`Revenue on the latest day was ${Math.abs(change).toFixed(1)}% ${change>=0?'above':'below'} the average of earlier days.`)}
    if(view.orders&&result.length<4)result.push(`Average revenue per order is ${money.format(view.aov)}.`)
    return result.slice(0,4)
  },[view])

  const signOut=async()=>{await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});setUser(null);setData(null);setAuthRequired(true);setAuthError('')}
  const submitAuth=async(mode:'login'|'register',values:{name:string;email:string;password:string})=>{setAuthError('');try{const response=await fetch(`/api/auth/${mode}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const result=await response.json();if(!response.ok){setAuthError(result.error||`Could not ${mode==='login'?'sign in':'create account'}.`);return}if(mode==='login'&&demoUsername&&values.email.trim().toLowerCase()===demoUsername)setCaliforniaIntro(true);setAuthRequired(false);setUser(result.user)}catch{setAuthError(`Could not reach the ${mode==='login'?'sign-in':'sign-up'} service. Check the API server and try again.`)}}

  if(!authReady)return <main className="loading"><span className="spinner"/><p>Checking your sign-in…</p></main>
  if(authRequired)return <LoginScreen onSubmit={submitAuth} error={authError} registrationEnabled={registrationEnabled} demoUsername={demoUsername} serviceUnavailable={authServiceUnavailable}/>

  const exportCsv=()=>{
    if(!view)return
    const rows=[['Metric','Value'],['Revenue',view.revenue],['Orders',view.orders],['Line items',view.lineItems],['Quantity sold',view.quantity],['Revenue per matching order',view.aov],[],['Group','Revenue'],...view.byGroup.map(x=>[x.name,x.value]),[],['Outlet','Revenue'],...view.byOutlet.map(x=>[x.name,x.value]),[],['Item','Revenue','Quantity'],...view.topItems.map(x=>[x.name,x.revenue,x.quantity]),[],['Date','Revenue'],...view.trend.map(x=>[x.day,x.revenue])]
    const csv=rows.map(row=>row.map(v=>{const value=String(v??'');const safe=/^[=+\-@\t\r]/.test(value)?`'${value}`:value;return `"${safe.replaceAll('"','""')}"`}).join(',')).join('\r\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='burger-town-filtered-analytics.csv';a.click();URL.revokeObjectURL(url)
  }

  if(error)return <main className="fatal"><div className="error-card"><CircleHelp size={34}/><h1>We couldn’t load this dashboard</h1><p>{error} Try refreshing the page.</p></div></main>
  if(!data||!view)return <><main className="loading"><span className="spinner"/><p>Preparing your analytics…</p></main>{californiaIntro&&<CaliforniaBurritoIntro/>}</>

  const peak= view.trend.reduce((a,b)=>b.revenue>a.revenue?b:a,view.trend[0]||{day:'',label:'—',revenue:0})
  const lift=view.priorDailyAverage?((view.lastDayRevenue-view.priorDailyAverage)/view.priorDailyAverage)*100:0
  const groupFilterOptions=filters.group ? data.meta.items.filter(i=>data.lines.find(x=>x.item===i)?.group===filters.group) : data.meta.items
  const activeCount=Object.values(filters).filter(Boolean).length

  const sectionTitle = activeSection==='products'?'Product performance':activeSection==='channels'?'Sales channels':'Business overview'
  const sectionSubtitle = activeSection==='products'?'Revenue by location and top-selling menu items.':activeSection==='channels'?'Sales mix across ordering and payment types.':'Revenue and order performance across your locations.'

  return <div className="app-shell">
    {californiaIntro&&<CaliforniaBurritoIntro/>}
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark">B</div><div><strong>Burger Town</strong><span>BUSINESS INTELLIGENCE</span></div></div>
      <div className="sidebar-section"><span className="side-label">WORKSPACE</span><div className="workspace-control"><button className="workspace" aria-expanded={workspaceOpen} onClick={()=>setWorkspaceOpen(value=>!value)}><div className="workspace-icon">BT</div><span><b>Burger Town</b><small>{filters.outlet||`${data.meta.outlets.length} locations · Bengaluru`}</small></span><ChevronDown size={15}/></button>{workspaceOpen&&<div className="workspace-menu" role="menu"><button role="menuitem" onClick={()=>{set('outlet','');setWorkspaceOpen(false)}}>All locations</button>{data.meta.outlets.map(outlet=><button role="menuitem" key={outlet} onClick={()=>{set('outlet',outlet);setWorkspaceOpen(false)}}>{outlet}</button>)}</div>}</div></div>
      <div className="sidebar-section nav-section"><span className="side-label">ANALYTICS</span><button className={`nav-item ${activeSection==='overview'?'active':''}`} aria-current={activeSection==='overview'?'page':undefined} onClick={()=>navigateTo('overview')}><Activity size={17}/>Overview</button><button className={`nav-item ${activeSection==='products'?'active':''}`} aria-current={activeSection==='products'?'page':undefined} onClick={()=>navigateTo('products')}><Layers3 size={17}/>Product performance</button><button className={`nav-item ${activeSection==='channels'?'active':''}`} aria-current={activeSection==='channels'?'page':undefined} onClick={()=>navigateTo('channels')}><Wallet size={17}/>Sales channels</button></div>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={17}/></div><div><b>Need a hand?</b><p>Explore trends across your business.</p></div></div><div className="profile"><div className="avatar">{user?.displayName.slice(0,2).toUpperCase()}</div><div><b>{user?.displayName}</b><span>{user?.email}</span></div></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Analytics</span><span className="crumb-slash">/</span><b>{sectionTitle}</b></div><div className="top-actions"><span className="live-status"><i/>Connected</span><span className="top-separator"/><div className="help-control"><button className="icon-button" aria-label="Help" aria-expanded={helpOpen} onClick={()=>setHelpOpen(value=>!value)}><CircleHelp size={18}/></button>{helpOpen&&<div className="help-popover" role="dialog" aria-label="Dashboard help"><b>Quick guide</b><p>Use the filters to narrow the date range, location, menu items, or payment method. The charts and CSV export follow your selection.</p><button onClick={()=>setHelpOpen(false)}>Got it</button></div>}</div><span className="signed-in-name">{user?.displayName}</span><button className="signout-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={16}/></button></div></header>
      <nav className="mobile-nav" aria-label="Analytics sections"><button className={activeSection==='overview'?'active':''} aria-current={activeSection==='overview'?'page':undefined} onClick={()=>navigateTo('overview')}>Overview</button><button className={activeSection==='products'?'active':''} aria-current={activeSection==='products'?'page':undefined} onClick={()=>navigateTo('products')}>Products</button><button className={activeSection==='channels'?'active':''} aria-current={activeSection==='channels'?'page':undefined} onClick={()=>navigateTo('channels')}>Sales channels</button></nav>
      <div className="page-wrap section-enter" key={activeSection}>
        <section className="page-heading"><div><div className="eyebrow"><Store size={14}/> BURGER TOWN <span>·</span> {filters.outlet||'ALL LOCATIONS'}</div><h1>{sectionTitle}</h1><p className="subtitle">{sectionSubtitle}</p></div><div className="heading-actions"><div className="period-chip"><CalendarDays size={15}/><span>{filters.from||filters.to?`${filters.from?dayLabel(filters.from):'Start'} – ${filters.to?dayLabel(filters.to):'Today'}`:`${dayLabel(data.meta.dateMin)} – ${dayLabel(data.meta.dateMax)}`}</span></div><button className="export-button" onClick={exportCsv}><ArrowDownToLine size={16}/> Export report</button></div></section>

        <section className="filter-panel"><div className="filter-title"><div className="filter-icon"><Filter size={16}/></div><div><b>Filters</b>{activeCount>0&&<span className="filter-count">{activeCount} active</span>}</div></div><div className="filters-grid">
          <label className="filter-control"><span>Date from</span><input type="date" min={data.meta.dateMin} max={filters.to||data.meta.dateMax} value={filters.from} onChange={e=>set('from',e.target.value)}/></label>
          <label className="filter-control"><span>Date to</span><input type="date" min={filters.from||data.meta.dateMin} max={data.meta.dateMax} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
          <Select label="Outlet" value={filters.outlet} options={data.meta.outlets} onChange={v=>set('outlet',v)}/>
          <Select label="Category" value={filters.group} options={data.meta.groups} onChange={v=>setFilters(f=>({...f,group:v,item:''}))}/>
          <Select label="Menu item" value={filters.item} options={groupFilterOptions} onChange={v=>set('item',v)}/>
          <Select label="Order type" value={filters.orderType} options={data.meta.orderTypes} onChange={v=>set('orderType',v)}/>
          <Select label="Payment channel" value={filters.settlement} options={data.meta.settlements} onChange={v=>set('settlement',v)}/>
        </div><button className={`reset-button ${activeCount?'':'muted'}`} onClick={reset}><RotateCcw size={13}/> Reset</button></section>

        <section className="kpi-grid">
          <Kpi title="Total revenue" value={money.format(view.revenue)} note={`${view.trendDays?compact.format(view.dailyAverage):'₹0'} average per day`} icon={<Wallet size={18}/>} accent="violet"/>
          <Kpi title="Orders" value={number.format(view.orders)} note={`${view.orders?money.format(view.aov):'₹0'} revenue per order`} icon={<ShoppingBag size={18}/>} accent="green"/>
          <Kpi title="Line items" value={number.format(view.lineItems)} note={`${number.format(view.quantity)} units sold`} icon={<Utensils size={18}/>} accent="orange"/>
          <Kpi title="Leading outlet" value={view.bestOutlet?.name||'—'} note={view.bestOutlet?`${money.format(view.bestOutlet.value)} in revenue`:'No sales in this range'} icon={<Store size={18}/>} accent="blue" small/>
        </section>

        {activeSection==='overview'&&insights.length>0&&<section className="card insights-card"><div className="insights-heading"><span className="insights-icon"><Activity size={16}/></span><h2>Sales highlights</h2></div><ul>{insights.map((text,i)=><li key={i}>{text}</li>)}</ul></section>}
        {activeSection==='overview'&&<section className="chart-grid">
          <article className="card trend-card"><CardHeader title="Revenue over time" subtitle="Daily sales for the selected period" badge={peak.day?`Peak · ${peak.label}`:'No data'}/><div className="chart-area"><ReactEChartsCore echarts={echarts} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}} option={{animation:true,animationDuration:550,animationEasing:'cubicOut',grid:{left:55,right:12,top:10,bottom:24},tooltip:{trigger:'axis',valueFormatter:(v:number)=>money.format(Number(v))},xAxis:{type:'category',data:view.trend.map(x=>x.label),boundaryGap:false,axisLabel:{color:'#9399a7',fontSize:10},axisLine:{show:false},axisTick:{show:false},splitLine:{show:false}},yAxis:{type:'value',axisLabel:{color:'#9399a7',fontSize:10,formatter:(v:number)=>'₹'+compact.format(v)},splitLine:{lineStyle:{color:'#eef0f4'}},axisLine:{show:false}},series:[{type:'line',data:view.trend.map(x=>x.revenue),smooth:true,symbol:'none',lineStyle:{color:'#6263e9',width:2.5},areaStyle:{color:'#6465ee',opacity:.12}}]}}/></div><div className="chart-foot"><span><i className="legend-dot violet-dot"/> Daily revenue</span><span className={`change-pill ${lift>=0?'positive':'negative'}`}>{lift>=0?'↑':'↓'} {Math.abs(lift).toFixed(1)}% <small>vs prior days avg.</small></span></div></article>
          <article className="card category-card"><CardHeader title="Sales by category" subtitle="Revenue contribution"/><div className="donut-wrap">{view.byGroup.length?<><ReactEChartsCore echarts={echarts} style={{width:'58%',height:'100%'}} opts={{renderer:'canvas'}} option={{animation:true,animationDuration:550,animationEasing:'cubicOut',tooltip:{trigger:'item',formatter:(p:{name:string;value:number;percent:number})=>p.name+' · '+money.format(p.value)+' ('+p.percent+'%)'},series:[{type:'pie',radius:['64%','86%'],center:['50%','50%'],padAngle:3,itemStyle:{borderColor:'#fff',borderWidth:2},label:{show:false},data:view.byGroup.map((x,i)=>({name:x.name,value:x.value,itemStyle:{color:COLORS[i%COLORS.length]}}))}]}}/><div className="donut-center"><b>{compact.format(view.revenue)}</b><span>Total revenue</span></div></>:<Empty/>}<div className="legend-list">{view.byGroup.map((x,i)=><div className="legend-row" key={x.name}><i style={{background:COLORS[i%COLORS.length]}}/><span>{x.name}</span><b>{view.revenue?(x.value/view.revenue*100).toFixed(0):0}%</b></div>)}</div></div><div className="category-highlight"><span>Top category</span><b>{view.bestGroup?.name||'—'}</b><strong>{view.bestGroup?money.format(view.bestGroup.value):'—'}</strong></div></article>
        </section>}

        {(activeSection==='overview'||activeSection==='products')&&<section className="lower-grid" id="product-performance">
          <article className="card outlet-card"><CardHeader title="Revenue by outlet" subtitle="Compare location performance"/><div className="bar-chart"><ReactEChartsCore echarts={echarts} style={{height:'100%',width:'100%'}} opts={{renderer:'canvas'}} option={{animation:true,animationDuration:550,animationEasing:'cubicOut',grid:{left:4,right:18,top:4,bottom:5,containLabel:true},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},valueFormatter:(v:number)=>money.format(Number(v))},xAxis:{type:'value',axisLabel:{color:'#9399a7',fontSize:9,formatter:(v:number)=>'₹'+compact.format(v)},splitLine:{lineStyle:{color:'#eef0f4'}},axisLine:{show:false}},yAxis:{type:'category',inverse:true,data:view.byOutlet.map(x=>x.name),axisLabel:{color:'#626979',fontSize:10},axisLine:{show:false},axisTick:{show:false}},series:[{type:'bar',data:view.byOutlet.map(x=>x.value),barMaxWidth:22,itemStyle:{color:'#7778ee',borderRadius:[0,5,5,0]}}]}}/></div><div className="simple-table-head"><span>Outlet</span><span>Share of sales</span><span>Revenue</span></div><div className="outlet-list">{view.byOutlet.map((x,i)=><div className="outlet-row" key={x.name}><span className="outlet-name"><i style={{background:COLORS[i%COLORS.length]}}/>{x.name}</span><span>{view.revenue?(x.value/view.revenue*100).toFixed(1):0}%</span><b>{money.format(x.value)}</b></div>)}</div></article>
          <article className="card items-card"><CardHeader title="Top-selling items" subtitle="Ranked by sales revenue"/><div className="items-table"><div className="items-head"><span>ITEM</span><span>UNITS</span><span>REVENUE</span></div>{view.topItems.map((x,i)=><div className="item-row" key={x.name}><span className="item-label"><span className="rank">{String(i+1).padStart(2,'0')}</span><span><b>{x.name}</b><small>{data.lines.find(r=>r.item===x.name)?.group}</small></span></span><span>{number.format(x.quantity)}</span><span className="item-revenue">{money.format(x.revenue)}</span></div>)}{!view.topItems.length&&<Empty/>}</div><div className="list-note">Showing the top 8 by revenue in this selection.</div></article>
        </section>}

        {activeSection==='channels'&&<section className="channel-grid" id="channels"><article className="card channel-card"><CardHeader title="Order mix" subtitle="Line items by order type"/><div className="channel-content">{view.byType.map((x,i)=><div className="channel-row" key={x.name}><div className="channel-row-head"><span>{x.name}</span><b>{view.lineItems?(x.value/view.lineItems*100).toFixed(1):0}%</b></div><div className="progress-track"><i style={{width:`${view.lineItems?x.value/view.lineItems*100:0}%`,background:COLORS[i]}}/></div><small>{number.format(x.value)} line items</small></div>)}{!view.byType.length&&<Empty/>}</div></article><article className="card payment-card"><CardHeader title="Payment channels" subtitle="Revenue by settlement method"/><div className="payment-content">{view.bySettlement.map((x,i)=><div className="payment-row" key={x.name}><div className="payment-icon" style={{color:COLORS[i],background:`${COLORS[i]}14`}}><Wallet size={16}/></div><div className="payment-name"><b>{x.name}</b><span>{view.revenue?(x.value/view.revenue*100).toFixed(1):0}% of revenue</span></div><strong>{money.format(x.value)}</strong></div>)}{!view.bySettlement.length&&<Empty/>}</div></article></section>}
      </div>
    </main>
  </div>
}

function LoginScreen({onSubmit,error,registrationEnabled,demoUsername,serviceUnavailable}:{onSubmit:(mode:'login'|'register',values:{name:string;email:string;password:string})=>Promise<void>;error:string;registrationEnabled:boolean;demoUsername:string|null;serviceUnavailable:boolean}){
  const [mode,setMode]=useState<'login'|'register'>('login')
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const registering=mode==='register'
  return <main className="login-page"><section className="login-story" aria-label="Dashboard introduction"><div className="login-story-brand"><span className="brand-mark">B</span><span>BURGER TOWN <b>ANALYTICS</b></span></div><div className="login-story-copy"><span className="login-story-kicker">A clearer view of every order</span><h2>Good decisions<br/>start with <em>good data.</em></h2><p>Explore sales, products, and locations in one simple dashboard.</p><div className="login-story-stats"><span><b>6</b> locations</span><i/><span><b>8</b> menu groups</span></div></div><div className="login-story-art" aria-hidden="true"><span className="story-orbit orbit-one"/><span className="story-orbit orbit-two"/><span className="story-burger">🍔</span><span className="story-spark spark-one">✦</span><span className="story-spark spark-two">✦</span></div><small className="login-story-foot">BURGER TOWN · BUSINESS INTELLIGENCE</small></section><form className="login-card" onSubmit={async e=>{e.preventDefault();setBusy(true);await onSubmit(mode,{name,email,password});setBusy(false)}}>
    <div className="login-card-heading"><div className="brand-mark login-mark">B</div><span className="login-eyebrow">YOUR BUSINESS, AT A GLANCE</span></div>
    <h1>{registering?'Create your account':'Welcome back'}</h1><p>{registering?'Create an account to explore the business dashboard.':'Sign in to view your business dashboard.'}</p>
    {serviceUnavailable&&<div className="service-notice" role="status"><span className="service-indicator"/><span><b>Sign-in service is offline</b><small>The page is available, but its API is not connected. On Vercel, the backend must be deployed as API functions before sign-in can work.</small></span></div>}
    {registrationEnabled&&<div className="auth-mode" role="group" aria-label="Account access"><button type="button" className={!registering?'selected':''} onClick={()=>setMode('login')}>Sign in</button><button type="button" className={registering?'selected':''} onClick={()=>setMode('register')}>Create account</button></div>}
    {demoUsername&&<aside className="burrito-hint"><span className="burrito-hint-title">🌯 California Burrito express lane</span><span>Skip the line with these demo credentials:</span><div><b>Username</b><code>{demoUsername}</code></div><div><b>Password</b><code>{demoUsername}</code></div><small>One burrito-powered shortcut to the dashboard.</small></aside>}
    {registering&&<label>Name<input type="text" autoComplete="name" maxLength={80} required value={name} onChange={e=>setName(e.target.value)}/></label>}
    <label>{registering?'Email':'Username or email'}<input type={registering?'email':'text'} autoComplete={registering?'email':'username'} required value={email} onChange={e=>setEmail(e.target.value)}/></label>
    <label>Password<input type="password" autoComplete={registering?'new-password':'current-password'} minLength={registering?12:undefined} maxLength={256} required value={password} onChange={e=>setPassword(e.target.value)}/>{registering&&<small className="password-hint">Use at least 12 characters.</small>}</label>
    {error&&<div className="login-error" role="alert">{error}</div>}
    <button className="login-submit" disabled={busy}>{busy?(registering?'Creating account…':'Signing in…'):(registering?'Create account':'Sign in')}</button>
    <small>Your session is secured with an HTTP-only cookie.</small>
  </form></main>
}
function CaliforniaBurritoIntro(){return <div className="california-intro" role="status" aria-live="polite"><div className="california-card"><span className="california-sun">☀️</span><div className="california-parade"><span>🌴</span><span className="flying-burrito">🌯</span><span>🌴</span></div><p>CALIFORNIA BURRITO</p><h1>Well, lettuce welcome you!</h1><small>Rolling you into the dashboard…</small></div></div>}
function Select({label,value,options,onChange}:{label:string;value:string;options:string[];onChange:(v:string)=>void}){return <label className="filter-control"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}><option value="">All {label.toLowerCase()}s</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>}
async function loadDataset():Promise<Dataset>{
  const response=await fetch('/api/dashboard',{credentials:'same-origin'})
  if(!response.ok){const failure=new Error(response.status===503?'Dashboard data is not in Neon yet. Run npm run db:seed.':response.status===401?'Sign in to continue.':'Dashboard data could not be loaded.') as Error&{status:number};failure.status=response.status;throw failure}
  const packed=await response.json() as {meta:Dataset['meta'];days:string[];lines:number[][];orders:number[][]}
  const day=(i:number)=>packed.days[i]
  const outlet=(i:number)=>packed.meta.outlets[i]
  const group=(i:number)=>packed.meta.groups[i]
  const item=(i:number)=>packed.meta.items[i]
  const orderType=(i:number)=>packed.meta.orderTypes[i]
  const settlement=(i:number)=>packed.meta.settlements[i]
  const lines:Line[]=packed.lines.map(([d,o,g,it,t,s,revenue,quantity,lineItems])=>({day:day(d),outlet:outlet(o),group:group(g),item:item(it),orderType:orderType(t),settlement:settlement(s),revenue,quantity,lineItems}))
  const orders:Order[]=packed.orders.map(([d,o,t,s,groupMask,itemMask,count,revenue,quantity,lineItems])=>({day:day(d),outlet:outlet(o),orderType:orderType(t),settlement:settlement(s),groupMask,itemMask,orders:count,revenue,quantity,lineItems}))
  return {...packed,lines,orders}
}
function Kpi({title,value,note,icon,accent,small=false}:{title:string;value:string;note:string;icon:React.ReactNode;accent:string;small?:boolean}){return <article className="kpi-card"><div className="kpi-top"><span>{title}</span><i className={`kpi-icon ${accent}`}>{icon}</i></div><b className={`kpi-value ${small?'small-value':''}`}>{value}</b><span className="kpi-note">{note}</span></article>}
function CardHeader({title,subtitle,badge}:{title:string;subtitle:string;badge?:string}){return <div className="card-header"><div><h2>{title}</h2><p>{subtitle}</p></div>{badge&&<span className="chart-badge"><i/> {badge}</span>}</div>}
function ChartTooltip({active,payload,label,currency=false}:{active?:boolean;payload?:Array<{name:string;value:number;payload:{day?:string;label?:string;name?:string}}>;label?:string;currency?:boolean}){if(!active||!payload?.length)return null;const x=payload[0];return <div className="chart-tooltip"><small>{x.payload?.day?dayLabel(x.payload.day):x.payload?.name||label}</small><b>{currency?money.format(x.value):number.format(x.value)}</b></div>}
function Empty(){return <div className="empty-state"><span>No results for these filters</span><small>Try widening the date range or resetting a filter.</small></div>}

export default App
