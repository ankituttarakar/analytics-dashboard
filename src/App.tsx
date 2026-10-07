import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, ArrowDownToLine, CalendarDays, ChevronDown, CircleHelp, Command, Filter, Layers3, RotateCcw, ShoppingBag, Store, Utensils, Wallet } from 'lucide-react'

type Line = { day:string; outlet:string; group:string; item:string; orderType:string; settlement:string; revenue:number; quantity:number; lineItems:number }
type Order = { day:string; outlet:string; orderType:string; settlement:string; groupMask:number; itemMask:number; orders:number; revenue:number; quantity:number; lineItems:number }
type Dataset = { meta:{sourceSheet:string;lineItems:number;orderCount:number;dateMin:string;dateMax:string;outlets:string[];groups:string[];items:string[];orderTypes:string[];settlements:string[];brands:string[];revenue:number;quantity:number;zeroPriceLineItems:number;groupBits:Record<string,number>;itemBits:Record<string,number>}; lines:Line[]; orders:Order[] }
type Filters = { from:string; to:string; outlet:string; group:string; item:string; orderType:string; settlement:string }

const money = new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0})
const number = new Intl.NumberFormat('en-IN')
const compact = new Intl.NumberFormat('en-IN',{notation:'compact',maximumFractionDigits:1})
const dayLabel = (day:string) => new Date(`${day}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'})
const COLORS = ['#5859e8','#2c9b78','#f0a14a','#df6976','#4197b7','#8066c7','#9aa3af']
const initialFilters:Filters = {from:'',to:'',outlet:'',group:'',item:'',orderType:'',settlement:''}

function App(){
  const [data,setData] = useState<Dataset|null>(null)
  const [error,setError] = useState('')
  const [filters,setFilters] = useState<Filters>(initialFilters)
  const [updated,setUpdated] = useState(false)
  useEffect(()=>{ loadDataset().then(setData).catch(e=>{
    const message=e instanceof Error?e.message:'Dashboard data could not be loaded.'
    setError(message==='Failed to fetch'?'Could not reach the dashboard data. Start the dev server from the analytics-dashboard folder, then refresh.':message)
  }) },[])
  const set = (key:keyof Filters,value:string) => {setFilters(v=>({...v,[key]:value,...(key==='group'&&v.item&&!data?.meta.items.includes(v.item)?{item:''}:{})}));setUpdated(true)}
  const reset = () => {setFilters(initialFilters);setUpdated(false)}

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

  const exportCsv=()=>{
    if(!view)return
    const rows=[['Metric','Value'],['Revenue',view.revenue],['Orders',view.orders],['Line items',view.lineItems],['Quantity sold',view.quantity],['Revenue per matching order',view.aov],[],['Group','Revenue'],...view.byGroup.map(x=>[x.name,x.value]),[],['Outlet','Revenue'],...view.byOutlet.map(x=>[x.name,x.value]),[],['Item','Revenue','Quantity'],...view.topItems.map(x=>[x.name,x.revenue,x.quantity]),[],['Date','Revenue'],...view.trend.map(x=>[x.day,x.revenue])]
    const csv=rows.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\r\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='burger-town-filtered-analytics.csv';a.click();URL.revokeObjectURL(url)
  }

  if(error)return <main className="fatal"><div className="error-card"><CircleHelp size={34}/><h1>We couldn’t load this dashboard</h1><p>{error} Try refreshing the page.</p></div></main>
  if(!data||!view)return <main className="loading"><span className="spinner"/><p>Preparing your analytics…</p></main>

  const peak= view.trend.reduce((a,b)=>b.revenue>a.revenue?b:a,view.trend[0]||{day:'',label:'—',revenue:0})
  const lift=view.priorDailyAverage?((view.lastDayRevenue-view.priorDailyAverage)/view.priorDailyAverage)*100:0
  const groupFilterOptions=filters.group ? data.meta.items.filter(i=>data.lines.find(x=>x.item===i)?.group===filters.group) : data.meta.items
  const activeCount=Object.values(filters).filter(Boolean).length

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><div className="brand-mark">B</div><div><strong>Burger Town</strong><span>BUSINESS INTELLIGENCE</span></div></div>
      <div className="sidebar-section"><span className="side-label">WORKSPACE</span><button className="workspace"><div className="workspace-icon">BT</div><span><b>Burger Town</b><small>6 locations · Bengaluru</small></span><ChevronDown size={15}/></button></div>
      <div className="sidebar-section nav-section"><span className="side-label">ANALYTICS</span><button className="nav-item active"><Activity size={17}/>Overview</button><button className="nav-item" onClick={()=>document.getElementById('product-performance')?.scrollIntoView({behavior:'smooth'})}><Layers3 size={17}/>Product performance</button><button className="nav-item" onClick={()=>document.getElementById('channels')?.scrollIntoView({behavior:'smooth'})}><Wallet size={17}/>Sales channels</button></div>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={17}/></div><div><b>Need a hand?</b><p>Explore trends across your business.</p></div></div><div className="profile"><div className="avatar">BT</div><div><b>Analytics team</b><span>Workspace account</span></div><span className="profile-dots">···</span></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Analytics</span><span className="crumb-slash">/</span><b>Overview</b></div><div className="top-actions"><span className="live-status"><i/>Live data</span><span className="top-separator"/><button className="icon-button" aria-label="Help"><CircleHelp size={18}/></button><div className="avatar top-avatar">BT</div></div></header>
      <div className="page-wrap">
        <section className="page-heading"><div><div className="eyebrow"><Store size={14}/> BURGER TOWN <span>·</span> ALL LOCATIONS</div><h1>Business overview</h1><p className="subtitle">A clear view of sales, orders, and what’s moving.</p></div><div className="heading-actions"><div className="period-chip"><CalendarDays size={15}/><span>{filters.from||filters.to?`${filters.from?dayLabel(filters.from):'Start'} – ${filters.to?dayLabel(filters.to):'Today'}`:`${dayLabel(data.meta.dateMin)} – ${dayLabel(data.meta.dateMax)}`}</span></div><button className="export-button" onClick={exportCsv}><ArrowDownToLine size={16}/> Export report</button></div></section>

        <section className="filter-panel"><div className="filter-title"><div className="filter-icon"><Filter size={16}/></div><div><b>Filters</b>{activeCount>0&&<span className="filter-count">{activeCount} active</span>}</div></div><div className="filters-grid">
          <label className="filter-control"><span>Date from</span><input type="date" min={data.meta.dateMin} max={filters.to||data.meta.dateMax} value={filters.from} onChange={e=>set('from',e.target.value)}/></label>
          <label className="filter-control"><span>Date to</span><input type="date" min={filters.from||data.meta.dateMin} max={data.meta.dateMax} value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
          <Select label="Outlet" value={filters.outlet} options={data.meta.outlets} onChange={v=>set('outlet',v)}/>
          <Select label="Category" value={filters.group} options={data.meta.groups} onChange={v=>{setFilters(f=>({...f,group:v,item:''}));setUpdated(true)}}/>
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

        <section className="chart-grid">
          <article className="card trend-card"><CardHeader title="Revenue over time" subtitle="Daily sales for the selected period" badge={peak.day?`Peak · ${peak.label}`:'No data'}/><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={view.trend} margin={{top:8,right:8,left:0,bottom:0}}><defs><linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6465ee" stopOpacity={.2}/><stop offset="96%" stopColor="#6465ee" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#eef0f4"/><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#9399a7'}} minTickGap={30}/><YAxis tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#9399a7'}} tickFormatter={v=>`₹${compact.format(v)}`} width={55}/><Tooltip content={<ChartTooltip currency/>}/><Area type="monotone" dataKey="revenue" stroke="#6263e9" strokeWidth={2.5} fill="url(#revenueFill)" activeDot={{r:4,strokeWidth:0}}/></AreaChart></ResponsiveContainer></div><div className="chart-foot"><span><i className="legend-dot violet-dot"/> Daily revenue</span><span className={`change-pill ${lift>=0?'positive':'negative'}`}>{lift>=0?'↑':'↓'} {Math.abs(lift).toFixed(1)}% <small>vs prior days avg.</small></span></div></article>
          <article className="card category-card"><CardHeader title="Sales by category" subtitle="Revenue contribution"/><div className="donut-wrap">{view.byGroup.length?<><ResponsiveContainer width="58%" height="100%"><PieChart><Pie data={view.byGroup} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="86%" paddingAngle={3} stroke="none">{view.byGroup.map((x,i)=><Cell key={x.name} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip content={<ChartTooltip currency/>}/></PieChart></ResponsiveContainer><div className="donut-center"><b>{compact.format(view.revenue)}</b><span>Total revenue</span></div></>:<Empty/>}<div className="legend-list">{view.byGroup.map((x,i)=><div className="legend-row" key={x.name}><i style={{background:COLORS[i%COLORS.length]}}/><span>{x.name}</span><b>{view.revenue?(x.value/view.revenue*100).toFixed(0):0}%</b></div>)}</div></div><div className="category-highlight"><span>Top category</span><b>{view.bestGroup?.name||'—'}</b><strong>{view.bestGroup?money.format(view.bestGroup.value):'—'}</strong></div></article>
        </section>

        <section className="lower-grid" id="product-performance">
          <article className="card outlet-card"><CardHeader title="Revenue by outlet" subtitle="Compare location performance"/><div className="bar-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={view.byOutlet} layout="vertical" margin={{top:2,right:12,left:0,bottom:0}} barCategoryGap={12}><CartesianGrid horizontal={false} stroke="#eef0f4"/><XAxis type="number" tickLine={false} axisLine={false} tick={{fontSize:10,fill:'#9399a7'}} tickFormatter={v=>`₹${compact.format(v)}`}/><YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={{fontSize:11,fill:'#626979'}} width={92}/><Tooltip content={<ChartTooltip currency/>}/><Bar dataKey="value" name="Revenue" fill="#7778ee" radius={[0,5,5,0]} maxBarSize={22}/></BarChart></ResponsiveContainer></div><div className="simple-table-head"><span>Outlet</span><span>Share of sales</span><span>Revenue</span></div><div className="outlet-list">{view.byOutlet.map((x,i)=><div className="outlet-row" key={x.name}><span className="outlet-name"><i style={{background:COLORS[i%COLORS.length]}}/>{x.name}</span><span>{view.revenue?(x.value/view.revenue*100).toFixed(1):0}%</span><b>{money.format(x.value)}</b></div>)}</div></article>
          <article className="card items-card"><CardHeader title="Top-selling items" subtitle="Ranked by sales revenue"/><div className="items-table"><div className="items-head"><span>ITEM</span><span>UNITS</span><span>REVENUE</span></div>{view.topItems.map((x,i)=><div className="item-row" key={x.name}><span className="item-label"><span className="rank">{String(i+1).padStart(2,'0')}</span><span><b>{x.name}</b><small>{data.lines.find(r=>r.item===x.name)?.group}</small></span></span><span>{number.format(x.quantity)}</span><span className="item-revenue">{money.format(x.revenue)}</span></div>)}{!view.topItems.length&&<Empty/>}</div><div className="list-note">Showing the top 8 by revenue in this selection.</div></article>
        </section>

        <section className="channel-grid" id="channels"><article className="card channel-card"><CardHeader title="Order mix" subtitle="Line items by order type"/><div className="channel-content">{view.byType.map((x,i)=><div className="channel-row" key={x.name}><div className="channel-row-head"><span>{x.name}</span><b>{view.lineItems?(x.value/view.lineItems*100).toFixed(1):0}%</b></div><div className="progress-track"><i style={{width:`${view.lineItems?x.value/view.lineItems*100:0}%`,background:COLORS[i]}}/></div><small>{number.format(x.value)} line items</small></div>)}{!view.byType.length&&<Empty/>}</div></article><article className="card payment-card"><CardHeader title="Payment channels" subtitle="Revenue by settlement method"/><div className="payment-content">{view.bySettlement.map((x,i)=><div className="payment-row" key={x.name}><div className="payment-icon" style={{color:COLORS[i],background:`${COLORS[i]}14`}}><Wallet size={16}/></div><div className="payment-name"><b>{x.name}</b><span>{view.revenue?(x.value/view.revenue*100).toFixed(1):0}% of revenue</span></div><strong>{money.format(x.value)}</strong></div>)}{!view.bySettlement.length&&<Empty/>}</div></article></section>
        <footer className="footer"><span><Command size={13}/> Burger Town Analytics</span><span>300,000 line items · {number.format(data.meta.orderCount)} distinct orders · {data.meta.brands.join(', ')}</span><span>{updated?'Filters updated just now':'Source data: assessment workbook'}</span></footer>
      </div>
    </main>
  </div>
}

function Select({label,value,options,onChange}:{label:string;value:string;options:string[];onChange:(v:string)=>void}){return <label className="filter-control"><span>{label}</span><select value={value} onChange={e=>onChange(e.target.value)}><option value="">All {label.toLowerCase()}s</option>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>}
async function loadDataset():Promise<Dataset>{
  const response=await fetch(`${import.meta.env.BASE_URL}data/dashboard.json.gz`)
  if(!response.ok)throw new Error('Dashboard data could not be loaded.')
  const bytes=await response.arrayBuffer()
  let packed:{meta:Dataset['meta'];days:string[];lines:number[][];orders:number[][]}
  try{
    // HTTP servers may transparently decompress .gz assets before fetch exposes
    // the body. Parse that response directly; only inflate bytes if still zipped.
    packed=JSON.parse(new TextDecoder().decode(bytes))
  }catch{
    if(!('DecompressionStream' in window))throw new Error('This browser cannot decompress the dashboard data. Please use a current browser.')
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    packed=await new Response(stream).json()
  }
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
