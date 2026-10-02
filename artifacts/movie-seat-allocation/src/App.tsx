import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Link, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { AllocationResult } from '@/lib/allocationStrategy';
import {
  loadTheaterData, createMovie, createScreen, createShow, createGroupRequest,
  allocateGroup, releaseAllocation,
} from '@/lib/theaterData';
import type { Allocation, GroupInput, MovieInput, ScreenInput, SessionMode, ShowInput, TheaterData } from '@/lib/types';
import {
  Activity, Armchair, ArrowDownLeft, ArrowRight, BadgeCheck, CalendarDays, Check, ChevronDown,
  Clapperboard, Clock3, Film, LayoutDashboard, LogOut, Plus, RefreshCw, ScreenShare,
  Search, Settings2, Ticket, Users, X, Zap,
} from 'lucide-react';

const queryClient = new QueryClient();
type Session = { mode: SessionMode; name: string; email?: string };
type AppContextValue = { session: Session; data: TheaterData | null; refresh: (quiet?: boolean) => Promise<void>; busy: boolean; mutate: (work: () => Promise<unknown>, success: string | ((result: unknown) => string)) => Promise<boolean>; notice: { kind: 'success' | 'error'; text: string } | null; dismissNotice: () => void };

import { createContext, useContext } from 'react';
const AppContext = createContext<AppContextValue | null>(null);
function useApp() { const value = useContext(AppContext); if (!value) throw new Error('App context unavailable'); return value; }

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/shows', label: 'Shows', icon: CalendarDays },
  { href: '/requests', label: 'Group Queue', icon: Users },
  { href: '/movies', label: 'Movies', icon: Film },
  { href: '/screens', label: 'Screens', icon: ScreenShare },
];

function AppRoot() {
  const [, setLocation] = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<TheaterData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AppContextValue['notice']>(null);
  const refresh = useCallback(async (quiet = false) => {
    if (!session) return;
    if (!quiet) setBusy(true);
    setLoadError(null);
    try { setData(await loadTheaterData(session.mode)); }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'Could not load theater data.';
      setData(current => {
        if (!current) setLoadError(detail);
        return current;
      });
      if (!quiet) setNotice({ kind: 'error', text: detail });
    }
    finally { if (!quiet) setBusy(false); }
  }, [session]);
  useEffect(() => {
    let live = true;
    if (supabase) {
      supabase.auth.getSession().then(({ data: result }) => {
        if (live && result.session) setSession({ mode: 'supabase', name: result.session.user.user_metadata.full_name || result.session.user.email?.split('@')[0] || 'Staff', email: result.session.user.email });
        if (live) setAuthReady(true);
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
        if (!live) return;
        setSession(authSession ? { mode: 'supabase', name: authSession.user.user_metadata.full_name || authSession.user.email?.split('@')[0] || 'Staff', email: authSession.user.email } : null);
        setAuthReady(true);
      });
      return () => { live = false; listener.subscription.unsubscribe(); };
    }
    if (localStorage.getItem('cinema-demo-session') === 'active') setSession({ mode: 'demo', name: 'Demo staff' });
    setAuthReady(true);
    return () => { live = false; };
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (session?.mode !== 'supabase') return;
    const timer = window.setInterval(() => { void refresh(true); }, 12000);
    const onFocus = () => {
      if (document.visibilityState === 'visible') void refresh(true);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [session, refresh]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4600);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const mutate = useCallback(async (work: () => Promise<unknown>, success: string | ((result: unknown) => string)) => {
    setBusy(true);
    try { const result = await work(); await refresh(); setNotice({ kind: 'success', text: typeof success === 'function' ? success(result) : success }); return true; }
    catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Something went wrong. Please try again.' }); return false; }
    finally { setBusy(false); }
  }, [refresh]);
  const enterDemo = () => { localStorage.setItem('cinema-demo-session', 'active'); setSession({ mode: 'demo', name: 'Demo staff' }); setLocation('/dashboard'); };
  const signOut = async () => {
    if (session?.mode === 'supabase' && supabase) await supabase.auth.signOut();
    localStorage.removeItem('cinema-demo-session'); setData(null); setSession(null); setLocation('/auth');
  };
  if (!authReady) return <LoadingScreen label="Connecting to the box office" />;
  const value: AppContextValue = { session: session ?? { mode: 'demo', name: '' }, data, refresh, busy, mutate, notice, dismissNotice: () => setNotice(null) };
  return <AppContext.Provider value={value}>
    {!session ? <Switch><Route path="/auth" component={() => <AuthPage onDemo={enterDemo} />}/><Route><AuthPage onDemo={enterDemo}/></Route></Switch> :
      <Shell onSignOut={signOut}>{loadError && !data ? <DataLoadError detail={loadError} onRetry={() => void refresh()}/> : <Switch>
        <Route path="/"><DashboardPage/></Route><Route path="/dashboard"><DashboardPage/></Route>
        <Route path="/shows"><ShowsPage/></Route><Route path="/shows/:id"><ShowDetailPage/></Route>
        <Route path="/requests"><RequestsPage/></Route><Route path="/movies"><MoviesPage/></Route><Route path="/screens"><ScreensPage/></Route>
        <Route component={NotFound}/>
      </Switch>}</Shell>}
  </AppContext.Provider>;
}

function Shell({ children, onSignOut }: { children: ReactNode; onSignOut: () => void }) {
  const [location] = useLocation();
  const { session, notice, busy, dismissNotice } = useApp();
  const [mobileNav, setMobileNav] = useState(false);
  const title = navItems.find((item) => location === item.href || (item.href === '/shows' && location.startsWith('/shows/')))?.label ?? 'Overview';
  return <div className="app-shell min-h-[100dvh]">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <Link href="/dashboard" className="brand-lockup" data-testid="link-home"><span className="brand-mark"><Clapperboard size={20}/></span><span><b>KINETIC CINE</b><small>SMART SEAT ENGINE</small></span></Link>
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav">{navItems.map(({href,label,icon:Icon})=><Link key={href} href={href} onClick={()=>setMobileNav(false)} className={`nav-link ${(location===href || (href==='/shows'&&location.startsWith('/shows/'))) ? 'nav-active':''}`} data-testid={`link-nav-${label==='Group Queue'?'group-requests':label.toLowerCase().replaceAll(' ','-')}`}><Icon size={17}/><span>{label}</span>{label==='Group Queue'&&<span className="nav-marker">LIVE</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="venue-card"><span className="venue-dot"/><div><b>Rialto Cinema</b><small>Front of house</small></div><ChevronDown size={15}/></div><div className="staff-row"><div className="staff-avatar">{session.name.slice(0,1).toUpperCase()}</div><div className="staff-meta"><b>{session.name}</b><small>{session.mode==='demo'?'Local demo':'Staff account'}</small></div><button className="icon-button staff-exit" onClick={onSignOut} aria-label="Sign out" data-testid="button-sign-out"><LogOut size={16}/></button></div></div>
    </aside>
    {mobileNav&&<button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-column"><header className="topbar"><button className="mobile-menu" onClick={()=>setMobileNav(!mobileNav)} aria-label="Toggle navigation" data-testid="button-menu"><span/><span/></button><div className="breadcrumb"><span>Kinetic Cine</span><span className="crumb-slash">/</span><b>{title}</b></div><div className="topbar-right"><span className={`connection ${session.mode}`}><i/>{session.mode==='demo'?'LOCAL DEMO':'SYNCED'}</span><span className="current-date">{new Intl.DateTimeFormat('en',{weekday:'short',month:'short',day:'numeric'}).format(new Date())}</span></div></header>
      {session.mode==='demo'&&<div className="demo-banner"><span><Zap size={14}/> Local demo mode <span className="demo-explainer">Changes stay in this browser and are not shared.</span></span><span>DEMO</span></div>}
      <div className="page-content">{busy&&!notice&&<div className="refresh-strip"><span/> Saving changes…</div>}{children}</div>
    </main>
    {notice&&<div className={`toast-message ${notice.kind}`} role="status" data-testid={`status-${notice.kind}`}><span className="toast-symbol">{notice.kind==='success'?<Check size={16}/>:<X size={16}/>}</span>{notice.text}<button onClick={dismissNotice} aria-label="Dismiss notification" className="toast-close" data-testid="button-dismiss-toast"><X size={15}/></button></div>}
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action&&<div className="heading-action">{action}</div>}</div>;
}
function LoadingScreen({label}:{label:string}) { return <div className="loading-screen"><div className="loading-brand"><Clapperboard size={23}/><span>KINETIC CINE</span></div><div className="skeleton-line"/><p>{label}</p></div>; }
function LoadingBlock() { return <div className="loading-block" aria-label="Loading theater data"><div/><div/><div/></div>; }
function DataLoadError({detail,onRetry}:{detail:string;onRetry:()=>void}) { return <section className="data-load-error" role="alert" data-testid="error-load-data"><span className="empty-icon"><RefreshCw size={21}/></span><h1>Couldn’t load theater data</h1><p>{detail}</p><Btn onClick={onRetry} testid="button-retry-data"><RefreshCw size={15}/> Try again</Btn></section>; }
function EmptyState({ icon:Icon=Ticket,title,body,action }: { icon?: typeof Ticket; title:string; body:string; action?:ReactNode }) { return <div className="empty-state"><span className="empty-icon"><Icon size={23}/></span><h3>{title}</h3><p>{body}</p>{action}</div>; }
function Field({ label,children, hint }: {label:string;children:ReactNode;hint?:string}) { return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>; }
function Btn({children,onClick,type='button',kind='primary',disabled=false,testid,className=''}:{children:ReactNode;onClick?:()=>void;type?:'button'|'submit';kind?:'primary'|'secondary'|'quiet'|'danger';disabled?:boolean;testid:string;className?:string}) { return <button type={type} onClick={onClick} disabled={disabled} data-testid={testid} className={`btn btn-${kind} ${className}`}>{children}</button>; }
function showMovie(data: TheaterData, showId: string) { const show=data.shows.find((s)=>s.id===showId); return show ? data.movies.find((m)=>m.id===show.movieId)?.title ?? 'Untitled film' : 'Unknown show'; }
function showTime(value:string, withDate=false) { const d=new Date(value); if(Number.isNaN(d.getTime())) return value; return new Intl.DateTimeFormat('en',{...(withDate?{weekday:'short',month:'short',day:'numeric'}:{}),hour:'numeric',minute:'2-digit'}).format(d); }
function activeAllocations(data:TheaterData, showId:string) { return data.allocations.filter(a=>a.showId===showId&&!a.releasedAt); }
function allocationSuccess(result: unknown) {
  const allocation = result as AllocationResult;
  return allocation.explanation || 'Seats allocated successfully.';
}
function DashboardPage() {
  const {data,refresh,session,mutate,busy}=useApp();
  const [autoProgress,setAutoProgress]=useState('');
  if(!data)return <><PageHeading eyebrow="KINETIC CINE / TONIGHT" title="FILL EVERY SEAT IN THE HOUSE." description="Live allocation command for tonight's scheduled program."/><LoadingBlock/></>;
  const today=new Date().toDateString();
  const todays=data.shows.filter(s=>new Date(s.startsAt).toDateString()===today&&s.status==='scheduled').sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  const lead=todays[0];
  const pending=data.groups.filter(g=>g.status==='pending'&&todays.some(s=>s.id===g.showId));
  const capacity=todays.reduce((sum,show)=>sum+data.seats.filter(seat=>seat.screenId===show.screenId).length,0);
  const occupied=todays.reduce((sum,show)=>sum+activeAllocations(data,show.id).length,0);
  const available=Math.max(0,capacity-occupied);
  const groupsSeated=data.groups.filter(g=>g.status==='allocated'&&todays.some(s=>s.id===g.showId)).length;
  const orphan=todays.reduce((sum,show)=>{
    const seats=data.seats.filter(seat=>seat.screenId===show.screenId);
    const taken=new Set(activeAllocations(data,show.id).map(a=>a.seatId));
    return sum+seats.filter(seat=>!taken.has(seat.id)&&
      !seats.some(other=>other.rowLabel===seat.rowLabel&&Math.abs(other.seatNumber-seat.seatNumber)===1&&!taken.has(other.id))).length;
  },0);
  const fillRate=capacity?Math.round(occupied/capacity*100):0;
  const autoAllocate=async()=>{
    if(!pending.length)return;
    setAutoProgress(`0 / ${pending.length} groups processed`);
    await mutate(async()=>{
      let success=0;const failures:string[]=[];
      for(let i=0;i<pending.length;i+=1){
        const group=pending[i];
        setAutoProgress(`${i+1} / ${pending.length} · ${group.label}`);
        try { await allocateGroup(session.mode,group.id); success+=1; }
        catch(error){ failures.push(`${group.label}: ${error instanceof Error?error.message:'Allocation failed'}`); }
      }
      return {success,failures};
    },result=>{
      const summary=result as {success:number;failures:string[]};
      setAutoProgress('');
      return `${summary.success} group${summary.success===1?'':'s'} seated${summary.failures.length?` · ${summary.failures.length} could not be placed`:''}. ${summary.failures.slice(0,2).join(' ')}`;
    });
    setAutoProgress('');
  };
  const featuredScreen=lead&&data.screens.find(s=>s.id===lead.screenId);
  const featuredSeats=lead?data.seats.filter(s=>s.screenId===lead.screenId).sort((a,b)=>a.rowLabel.localeCompare(b.rowLabel)||a.seatNumber-b.seatNumber):[];
  const featuredRows=Array.from(new Set(featuredSeats.map(s=>s.rowLabel))).sort((a,b)=>a.localeCompare(b));
  const occupiedIds=new Set(lead?activeAllocations(data,lead.id).map(a=>a.seatId):[]);
  const queue=pending.slice(0,4);
  return <div className="dashboard-page">
    <div className="dashboard-head"><div><div className="eyebrow">KINETIC CINE / SMART SEAT ENGINE</div><h1>FILL EVERY SEAT<br/><span>IN THE HOUSE.</span></h1><p>Tonight’s floor, live. Every allocation stays real, atomic, and reversible.</p></div><div className="dashboard-head-meta"><span className="live-indicator"><i/> LIVE OPERATIONS</span><span>{new Intl.DateTimeFormat('en',{weekday:'long',month:'long',day:'numeric'}).format(new Date())}</span><button className="icon-button" onClick={()=>void refresh()} aria-label="Refresh dashboard" data-testid="button-refresh-dashboard"><RefreshCw size={16}/></button></div></div>
    <section className="dashboard-hero">
      <div className="hero-topline"><span><Activity size={15}/> TONIGHT’S FLOOR</span><Link href="/shows" className="text-link" data-testid="link-all-shows">Schedule <ArrowRight size={15}/></Link></div>
      {lead?<div className="hero-show-layout">
        <div className="hero-seat-area">
          <Link href={`/shows/${lead.id}`} className="hero-featured-show" data-testid={`card-show-${lead.id}`}>
            <span className={`movie-swatch tone-${data.movies.find(m=>m.id===lead.movieId)?.posterTone||'rose'}`}><Film size={18}/></span>
            <span className="hero-film-copy"><small>FIRST SHOW · {showTime(lead.startsAt)}</small><b>{showMovie(data,lead.id)}</b><em>{featuredScreen?.name||'Screen'} <i/> {lead.format} <i/> {lead.language}</em></span>
            <ArrowRight size={18}/>
          </Link>
          <div className="hero-map">
            <div className="hero-screen"><span>SCREEN</span></div>
            <div className="hero-seats" data-testid="dashboard-seat-map">{featuredRows.map(row=><div className="hero-seat-row" key={row}><span>{row}</span><div>{featuredSeats.filter(s=>s.rowLabel===row).map(seat=><i key={seat.id} className={occupiedIds.has(seat.id)?'occupied':`zone-${seat.zone}`} title={`${seat.rowLabel}${seat.seatNumber} ${occupiedIds.has(seat.id)?'allocated':'available'}`} data-testid={`dashboard-seat-${seat.id}`}/>)}</div><span>{row}</span></div>)}</div>
            <div className="hero-map-legend"><span><i className="free-dot"/> Available</span><span><i className="taken-dot"/> Allocated</span><b>{featuredSeats.length-occupiedIds.size} AVAILABLE IN THIS SHOW</b></div>
          </div>
          <Link href={`/shows/${lead.id}`} className="map-open-link" data-testid="link-featured-show-map">Open full seat map <ArrowRight size={14}/></Link>
        </div>
        <aside className="hero-action-panel">
          <span className="eyebrow">AUTOMATION / TONIGHT</span><div className="action-count">{pending.length.toString().padStart(2,'0')}<small> PENDING</small></div>
          <h2>Let the engine<br/>find the seats.</h2>
          <p>Process every pending party across tonight’s shows, in queue order. Each group is placed using the live seat plan.</p>
          <Btn onClick={()=>void autoAllocate()} disabled={busy||pending.length===0} testid="button-auto-allocate"><Zap size={16}/>{busy&&autoProgress?'PROCESSING…':'AUTO-ALLOCATE TONIGHT'}<ArrowRight size={15}/></Btn>
          {pending.length===0?<small className="action-hint">No pending requests for tonight’s scheduled shows.</small>:<small className="action-hint">{autoProgress||`${pending.length} pending group${pending.length===1?'':'s'} across ${todays.length} show${todays.length===1?'':'s'}`}</small>}
          <div className="action-foot"><BadgeCheck size={15}/> No fake placements. Every seat uses the allocation engine.</div>
        </aside>
      </div>:<EmptyState icon={CalendarDays} title="No scheduled shows tonight" body="When tonight’s program is scheduled, the live seat map and allocation controls will appear here." action={<Link className="btn btn-secondary" href="/shows" data-testid="link-create-show">Open schedule</Link>}/>}
    </section>
    <section className="metric-grid" aria-label="Tonight's live metrics">
      <article className="live-metric"><span>FILL RATE <i>TONIGHT</i></span><strong>{fillRate}<small>%</small></strong><div className="metric-meter"><i style={{width:`${fillRate}%`}}/></div><p>{occupied} occupied of {capacity} seats</p></article>
      <article className="live-metric"><span>GROUPS SEATED <i>TONIGHT</i></span><strong>{groupsSeated.toString().padStart(2,'0')}</strong><p>Allocated parties across tonight’s schedule</p></article>
      <article className="live-metric"><span>AVAILABLE SEATS <i>TONIGHT</i></span><strong>{available.toString().padStart(3,'0')}</strong><p>Ready for live group placement</p></article>
      <article className="live-metric magenta-metric"><span>ORPHAN SEATS <i>TONIGHT</i></span><strong>{orphan.toString().padStart(2,'0')}</strong><p>Available seats without an available neighbor</p></article>
    </section>
    <div className="dashboard-lower">
      <section className="utilization-panel"><div className="section-intro"><div><div className="eyebrow">LIVE UTILIZATION</div><h2>Every show, in view</h2></div><span className="live-indicator"><i/> UPDATED LIVE</span></div>
        {todays.length? <div className="utilization-list">{todays.map(show=>{const used=activeAllocations(data,show.id).length;const total=data.seats.filter(s=>s.screenId===show.screenId).length;const percent=total?Math.round(used/total*100):0;return <Link href={`/shows/${show.id}`} key={show.id} className="utilization-row" data-testid={`utilization-show-${show.id}`}><span className="utilization-time">{showTime(show.startsAt)}</span><span className="utilization-title"><b>{showMovie(data,show.id)}</b><small>{data.screens.find(s=>s.id===show.screenId)?.name||'Screen'}</small></span><span className="utilization-bar"><i style={{width:`${percent}%`}}/></span><b className="utilization-percent">{percent}%</b></Link>})}</div>:<p className="quiet-empty">No live show utilization to report.</p>}
      </section>
      <section className="queue-panel"><div className="section-intro"><div><div className="eyebrow">FRONT OF HOUSE</div><h2>Group Queue</h2></div><Link href="/requests" className="text-link" data-testid="link-pending-requests">Full queue <ArrowRight size={14}/></Link></div>
        {queue.length?<div className="dashboard-queue">{queue.map(group=><div className="dashboard-queue-row" key={group.id}><span className="queue-avatar">{group.label.slice(0,1).toUpperCase()}</span><div><b>{group.label}</b><small>{group.groupSize} guests · {showMovie(data,group.showId)} · {showTime(data.shows.find(s=>s.id===group.showId)?.startsAt||'')}</small></div><Btn kind="secondary" onClick={()=>void mutate(()=>allocateGroup(session.mode,group.id),allocationSuccess)} disabled={busy} testid={`button-allocate-${group.id}`}>Allocate</Btn></div>)}</div>:<EmptyState icon={Users} title="Queue is clear" body="New group requests for tonight will appear here." action={<Link href="/requests" className="text-link">Open requests <ArrowRight size={14}/></Link>}/>}
      </section>
    </div>
  </div>;
}

function ShowsPage() {
  const {data,session}=useApp();const[query,setQuery]=useState('');const[form,setForm]=useState(false);
  const {mutate,busy}=useApp();
  if(!data)return <><PageHeading eyebrow="PROGRAMMING" title="Shows" description="Choose a show to view its seat map and group allocations."/><LoadingBlock/></>;
  const sorted=[...data.shows].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
  const filtered=sorted.filter(s=>`${showMovie(data,s.id)} ${s.language} ${s.format} ${data.screens.find(x=>x.id===s.screenId)?.name}`.toLowerCase().includes(query.toLowerCase()));
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const startsAt=new Date(String(f.get('startsAt'))).toISOString();const input:ShowInput={movieId:String(f.get('movieId')),screenId:String(f.get('screenId')),startsAt,language:String(f.get('language')),format:String(f.get('format'))};if(await mutate(()=>createShow(session.mode,input),'Show added to the schedule.'))setForm(false);}
  return <><PageHeading eyebrow="PROGRAMMING" title="Shows" description="Choose a show to view its seat map and group allocations." action={<Btn onClick={()=>setForm(!form)} testid="button-add-show"><Plus size={16}/> Add a show</Btn>}/>
    {form&&<div className="form-card"><div className="form-card-heading"><div><div className="eyebrow">NEW LISTING</div><h2>Schedule a show</h2></div><button className="icon-button" onClick={()=>setForm(false)} aria-label="Close form" data-testid="button-close-show-form"><X size={17}/></button></div>
      <form className="inline-form show-form" onSubmit={submit}><Field label="Movie"><select name="movieId" required data-testid="select-show-movie"><option value="">Choose a movie</option>{data.movies.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}</select></Field><Field label="Screen"><select name="screenId" required data-testid="select-show-screen"><option value="">Choose a screen</option>{data.screens.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Start time"><input type="datetime-local" name="startsAt" required data-testid="input-show-starts-at"/></Field><Field label="Language"><input name="language" defaultValue="English" required data-testid="input-show-language"/></Field><Field label="Format"><select name="format" data-testid="select-show-format"><option>2D</option><option>3D</option><option>IMAX</option><option>4DX</option></select></Field><div className="form-actions"><Btn kind="secondary" onClick={()=>setForm(false)} testid="button-cancel-show">Cancel</Btn><Btn type="submit" disabled={busy||data.movies.length===0||data.screens.length===0} testid="button-submit-show">{busy?'Adding…':'Add show'}</Btn></div></form></div>}
    <div className="toolbar"><div className="searchbox"><Search size={16}/><input placeholder="Search shows, films, screens…" value={query} onChange={e=>setQuery(e.target.value)} data-testid="input-search-shows"/></div><span className="result-count">{filtered.length} SHOW{filtered.length===1?'':'S'}</span></div>
    {filtered.length===0?<EmptyState icon={CalendarDays} title={query?'No matching shows':'No shows on the schedule'} body={query?'Try a different film, format, or screen.':'Add a show to begin allocating seats for your cinema.'} action={!query&&<Btn onClick={()=>setForm(true)} testid="button-empty-add-show"><Plus size={15}/> Add a show</Btn>}/>:<div className="table-wrap"><table><thead><tr><th>FILM</th><th>STARTS</th><th>SCREEN</th><th>FORMAT</th><th>SEATS PLACED</th><th/></tr></thead><tbody>{filtered.map(show=>{const m=data.movies.find(x=>x.id===show.movieId);const s=data.screens.find(x=>x.id===show.screenId);const used=activeAllocations(data,show.id).length;const total=data.seats.filter(x=>x.screenId===show.screenId).length;return <tr key={show.id} data-testid={`row-show-${show.id}`}><td><Link href={`/shows/${show.id}`} className="table-film" data-testid={`link-show-${show.id}`}><span className={`mini-poster tone-${m?.posterTone||'rose'}`}><Film size={14}/></span><span><b>{m?.title||'Unknown film'}</b><small>{show.language}</small></span></Link></td><td><span className="table-strong">{showTime(show.startsAt,true)}</span><small className="cell-sub">{showTime(show.startsAt)}</small></td><td>{s?.name||'—'}</td><td><span className="pill">{show.format}</span></td><td><span className="mono-count">{used}<small> / {total}</small></span></td><td><Link href={`/shows/${show.id}`} className="table-arrow" aria-label={`Open ${m?.title||'show'}`} data-testid={`button-open-show-${show.id}`}><ArrowRight size={17}/></Link></td></tr>})}</tbody></table></div>}
  </>;
}
function ShowDetailPage() {
  const params=useParams<{id:string}>();const {data,mutate,session,busy}=useApp();const [,setLocation]=useLocation();const[chosenGroup,setChosenGroup]=useState('');
  if(!data)return <LoadingBlock/>;
  const show=data.shows.find(x=>x.id===params.id);
  if(!show)return <div className="not-found-inline"><EmptyState icon={CalendarDays} title="Show not found" body="This show may have been removed from the schedule." action={<Link className="btn btn-secondary" href="/shows" data-testid="link-back-shows">Back to shows</Link>}/></div>;
  const movie=data.movies.find(x=>x.id===show.movieId);const screen=data.screens.find(x=>x.id===show.screenId);const seats=data.seats.filter(x=>x.screenId===show.screenId).sort((a,b)=>a.rowLabel.localeCompare(b.rowLabel)||a.seatNumber-b.seatNumber);
  const active=activeAllocations(data,show.id);const occupied=new Map(active.map(a=>[a.seatId,a]));const groups=data.groups.filter(g=>g.showId===show.id);
  const seatGroups=Array.from(new Set(seats.map(s=>s.rowLabel))).sort((a,b)=>a.localeCompare(b));
  const release=async(a:Allocation)=>{await mutate(()=>releaseAllocation(session.mode,a.id),'Seat released and returned to availability.');};
  const allocate=async()=>{if(!chosenGroup)return;const ok=await mutate(()=>allocateGroup(session.mode,chosenGroup),allocationSuccess);if(ok)setChosenGroup('');};
  return <><div className="detail-back"><Link href="/shows" data-testid="link-back-to-shows"><ArrowDownLeft size={15}/> All shows</Link><span> / SEAT MAP</span></div><PageHeading eyebrow={`${screen?.name||'SCREEN'} / ${showTime(show.startsAt,true).toUpperCase()}`} title={movie?.title||'Show details'} description={`${show.format} · ${show.language} · Starts ${showTime(show.startsAt)}`} action={<span className="live-status"><i/>{show.status}</span>}/>
    <div className="show-meta-strip"><span><CalendarDays size={15}/>{showTime(show.startsAt,true)} · {showTime(show.startsAt)}</span><span><ScreenShare size={15}/>{screen?.name} · {screen?.rowCount} rows</span><span><Armchair size={15}/>{active.length} / {seats.length} seats allocated</span></div>
    <div className="detail-layout"><section className="seatmap-panel"><div className="panel-heading"><div><div className="eyebrow">LIVE SEAT MAP</div><h2>Choose your seats</h2></div><span className="zone-legend"><i className="legend-free"/> Available <i className="legend-taken"/> Allocated</span></div>
       <div className="screen-front"><span>SCREEN</span></div><div className="seat-map-scroll"><div className="seat-map">{seatGroups.map(row=><div className="seat-row" key={row}><span className="row-label">{row}</span><div className="seat-row-chairs">{seats.filter(s=>s.rowLabel===row).map(seat=>{const a=occupied.get(seat.id);const group=a&&data.groups.find(g=>g.id===a.groupRequestId);return <span className={`seat ${a?'seat-taken':`seat-${seat.zone}`}`} key={seat.id} title={`${row}${seat.seatNumber} · ${a?`Allocated to ${group?.label||'group'}`:`Available · ${seat.zone}`}`} aria-label={`${row}${seat.seatNumber}, ${a?'allocated':'available'}`} role="img" data-testid={`seat-${row.toLowerCase()}-${seat.seatNumber}`}>{seat.seatNumber}</span>})}</div><span className="row-label">{row}</span></div>)}</div></div>
      <div className="seatmap-foot"><span>SEATS ARE ASSIGNED BY THE ALLOCATION ENGINE</span><span>{seats.length-active.length} AVAILABLE</span></div>
    </section><aside className="allocation-panel"><div className="panel-heading"><div><div className="eyebrow">GROUP PLACEMENT</div><h2>Allocate a party</h2></div><span className="count-badge">{groups.filter(g=>g.status==='pending').length}</span></div>
      {groups.filter(g=>g.status==='pending').length===0?<EmptyState icon={Users} title="Queue is clear" body="There are no pending groups for this show." action={<Link href="/requests" className="text-link" data-testid="link-add-show-request">Create a group request <ArrowRight size={14}/></Link>}/>:<><Field label="Pending group"><select value={chosenGroup} onChange={e=>setChosenGroup(e.target.value)} data-testid="select-pending-group"><option value="">Select a group request</option>{groups.filter(g=>g.status==='pending').map(g=><option value={g.id} key={g.id}>{g.label} · {g.groupSize} {g.groupSize===1?'seat':'seats'}</option>)}</select></Field>{chosenGroup&&(()=>{const g=groups.find(x=>x.id===chosenGroup)!;return <div className="selected-group"><span className="group-avatar">{g.label.slice(0,1).toUpperCase()}</span><div><b>{g.label}</b><small>{g.groupSize} guests · {g.preferredZone==='any'?'Any zone':`${g.preferredZone} zone`} · {g.preferTogether?'Together preferred':'Any seating'}</small></div></div>})()}<Btn onClick={()=>void allocate()} disabled={!chosenGroup||busy} testid="button-allocate-group"><Zap size={15}/>{busy?'Allocating…':'Find best available seats'}</Btn><p className="allocation-note"><BadgeCheck size={14}/> The seat planner prioritizes the requested zone and adjacent seats. Availability is checked again before placement.</p></>}
      <div className="allocated-section"><div className="allocated-heading"><h3>Placed groups</h3><span>{groups.filter(g=>g.status==='allocated').length}</span></div>{groups.filter(g=>g.status==='allocated').length===0?<p className="quiet-empty">No groups allocated yet.</p>:groups.filter(g=>g.status==='allocated').map(g=>{const allocs=active.filter(a=>a.groupRequestId===g.id);const names=allocs.map(a=>{const seat=seats.find(s=>s.id===a.seatId);return seat?`${seat.rowLabel}${seat.seatNumber}`:''}).filter(Boolean);return <div className="placed-group" key={g.id} data-testid={`placed-group-${g.id}`}><div className="placed-head"><b>{g.label}</b><span>{allocs.length} seats</span></div><p>{names.join(' · ')||'Seats unavailable'}</p><div className="release-list">{allocs.map(a=><button key={a.id} onClick={()=>void release(a)} disabled={busy} title="Release this seat" data-testid={`button-release-${a.id}`}>Release {(()=>{const seat=seats.find(s=>s.id===a.seatId);return seat?`${seat.rowLabel}${seat.seatNumber}`:'seat'})()}</button>)}</div></div>})}</div>
    </aside></div></>;
}

function RequestsPage() {
  const {data,session,mutate,busy}=useApp();const[form,setForm]=useState(false);const[filter,setFilter]=useState<'all'|'pending'|'allocated'>('all');const[showFilter,setShowFilter]=useState('all');
  if(!data)return <><PageHeading eyebrow="FRONT OF HOUSE" title="Group Queue" description="Coordinate parties and place them without overlap."/><LoadingBlock/></>;
  const visible=data.groups.filter(g=>(filter==='all'||g.status===filter)&&(showFilter==='all'||g.showId===showFilter)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const groupSize=Number(f.get('groupSize'));if(groupSize<1||groupSize>30)return;const input:GroupInput={showId:String(f.get('showId')),label:String(f.get('label')).trim(),groupSize,preferredZone:String(f.get('preferredZone')) as GroupInput['preferredZone'],preferTogether:f.get('preferTogether')==='on'};if(await mutate(()=>createGroupRequest(session.mode,input),'Group request created.'))setForm(false);}
  const alloc=async(id:string)=>{await mutate(()=>allocateGroup(session.mode,id),allocationSuccess);};
  return <><PageHeading eyebrow="FRONT OF HOUSE" title="Group Queue" description="Coordinate parties and place them without overlap." action={<Btn onClick={()=>setForm(!form)} testid="button-new-request"><Plus size={16}/> New request</Btn>}/>
    {form&&<div className="form-card"><div className="form-card-heading"><div><div className="eyebrow">PARTY DETAILS</div><h2>New group request</h2></div><button className="icon-button" onClick={()=>setForm(false)} aria-label="Close form" data-testid="button-close-request-form"><X size={17}/></button></div>{data.shows.length===0?<div className="inline-warning">Add a show before creating a group request.</div>:<form className="inline-form request-form" onSubmit={submit}><Field label="Show"><select name="showId" required defaultValue="" data-testid="select-request-show"><option value="" disabled>Choose a show</option>{data.shows.filter(s=>s.status==='scheduled').map(s=><option key={s.id} value={s.id}>{showMovie(data,s.id)} · {showTime(s.startsAt,true)} {showTime(s.startsAt)}</option>)}</select></Field><Field label="Group or customer name"><input name="label" required minLength={2} maxLength={60} placeholder="e.g. Harper birthday party" data-testid="input-request-label"/></Field><Field label="Party size"><input name="groupSize" type="number" required min="1" max="30" defaultValue="4" data-testid="input-request-size"/></Field><Field label="Preferred zone"><select name="preferredZone" defaultValue="any" data-testid="select-request-zone"><option value="any">Any zone</option><option value="premium">Premium</option><option value="standard">Standard</option><option value="front">Front</option><option value="accessible">Accessible</option></select></Field><label className="check-field"><input type="checkbox" name="preferTogether" defaultChecked data-testid="checkbox-request-together"/><span><b>Keep the group together</b><small>Try to find adjoining seats first.</small></span></label><div className="form-actions"><Btn kind="secondary" onClick={()=>setForm(false)} testid="button-cancel-request">Cancel</Btn><Btn type="submit" disabled={busy} testid="button-submit-request">{busy?'Creating…':'Create request'}</Btn></div></form>}</div>}
    <div className="filters-row"><div className="segmented" role="tablist">{(['all','pending','allocated'] as const).map(status=><button key={status} onClick={()=>setFilter(status)} className={filter===status?'segment-active':''} role="tab" aria-selected={filter===status} data-testid={`tab-requests-${status}`}>{status==='all'?'All requests':status==='pending'?'Pending':'Allocated'} <span>{status==='all'?data.groups.length:data.groups.filter(g=>g.status===status).length}</span></button>)}</div><select value={showFilter} onChange={e=>setShowFilter(e.target.value)} className="filter-select" aria-label="Filter by show" data-testid="select-filter-request-show"><option value="all">All shows</option>{data.shows.map(s=><option key={s.id} value={s.id}>{showMovie(data,s.id)} · {showTime(s.startsAt)}</option>)}</select></div>
    {visible.length===0?<EmptyState icon={Users} title={filter==='all'?'No group requests yet':`No ${filter} groups`} body={filter==='all'?'Create a request to start placing a party on a show.':'There are no requests in this view right now.'} action={filter==='all'&&<Btn onClick={()=>setForm(true)} testid="button-empty-request"><Plus size={15}/> New request</Btn>}/>:<div className="request-list">{visible.map(group=>{const show=data.shows.find(s=>s.id===group.showId);const movie=showMovie(data,group.showId);const active=activeAllocations(data,group.showId).filter(a=>a.groupRequestId===group.id);const screen=show&&data.screens.find(s=>s.id===show.screenId);const seatNames=active.map(a=>{const seat=data.seats.find(s=>s.id===a.seatId);return seat?`${seat.rowLabel}${seat.seatNumber}`:''}).filter(Boolean);return <article className="request-card" key={group.id} data-testid={`card-request-${group.id}`}><div className="request-card-main"><div className={`request-initial ${group.status==='allocated'?'initial-green':''}`}>{group.label.slice(0,1).toUpperCase()}</div><div className="request-content"><div className="request-title-line"><h3>{group.label}</h3><span className={`status-pill ${group.status}`}>{group.status==='pending'?'Needs seats':'Allocated'}</span></div><p>{movie} <span>·</span> {show?showTime(show.startsAt,true):'Show removed'} <span>·</span> {screen?.name||'Screen'}</p><div className="request-tags"><span><Users size={13}/>{group.groupSize} guests</span><span><Armchair size={13}/>{group.preferredZone==='any'?'Any zone':group.preferredZone}</span><span>{group.preferTogether?'Keep together':'Flexible seating'}</span></div>{group.status==='allocated'&&<div className="allocated-seats"><BadgeCheck size={14}/>{seatNames.join(' · ')||'Seats placed'}</div>}</div></div><div className="request-actions">{group.status==='pending'?<Btn onClick={()=>void alloc(group.id)} disabled={busy||!show} testid={`button-allocate-${group.id}`}>Allocate <ArrowRight size={15}/></Btn>:<Link className="btn btn-secondary" href={`/shows/${group.showId}`} data-testid={`link-request-show-${group.id}`}>View map <ArrowRight size={15}/></Link>}</div></article>})}</div>}
  </>;
}

function MoviesPage() {
  const {data,mutate,busy,session}=useApp();const[form,setForm]=useState(false);const[query,setQuery]=useState('');
  if(!data)return <><PageHeading eyebrow="CATALOG" title="Movies" description="The films on your cinema's current program."/><LoadingBlock/></>;
  const filtered=data.movies.filter(m=>`${m.title} ${m.genre} ${m.rating}`.toLowerCase().includes(query.toLowerCase()));
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const minutes=Number(f.get('durationMinutes'));if(!Number.isFinite(minutes)||minutes<1)return;const input:MovieInput={title:String(f.get('title')).trim(),genre:String(f.get('genre')).trim(),rating:String(f.get('rating')),durationMinutes:minutes,posterTone:String(f.get('posterTone'))};if(await mutate(()=>createMovie(session.mode,input),'Movie added to the catalog.'))setForm(false);}
  return <><PageHeading eyebrow="CATALOG" title="Movies" description="The films on your cinema's current program." action={<Btn onClick={()=>setForm(!form)} testid="button-add-movie"><Plus size={16}/> Add a movie</Btn>}/>
    {form&&<div className="form-card"><div className="form-card-heading"><div><div className="eyebrow">CATALOG ENTRY</div><h2>Add a movie</h2></div><button className="icon-button" onClick={()=>setForm(false)} aria-label="Close form" data-testid="button-close-movie-form"><X size={17}/></button></div><form className="inline-form movie-form" onSubmit={submit}><Field label="Film title"><input name="title" required minLength={2} maxLength={100} placeholder="The film's title" data-testid="input-movie-title"/></Field><Field label="Genre"><input name="genre" required placeholder="Drama, comedy…" data-testid="input-movie-genre"/></Field><Field label="Rating"><select name="rating" defaultValue="PG-13" data-testid="select-movie-rating"><option>G</option><option>PG</option><option>PG-13</option><option>R</option><option>NC-17</option><option>NR</option></select></Field><Field label="Runtime (minutes)"><input type="number" name="durationMinutes" min="1" max="600" required placeholder="112" data-testid="input-movie-duration"/></Field><Field label="Poster tone"><select name="posterTone" defaultValue="rose" data-testid="select-movie-tone"><option value="rose">Carmine</option><option value="teal">Sea glass</option><option value="amber">Marigold</option><option value="plum">Mulberry</option><option value="blue">Midnight</option></select></Field><div className="form-actions"><Btn kind="secondary" onClick={()=>setForm(false)} testid="button-cancel-movie">Cancel</Btn><Btn type="submit" disabled={busy} testid="button-submit-movie">{busy?'Adding…':'Add movie'}</Btn></div></form></div>}
    <div className="toolbar"><div className="searchbox"><Search size={16}/><input placeholder="Find a film…" value={query} onChange={e=>setQuery(e.target.value)} data-testid="input-search-movies"/></div><span className="result-count">{filtered.length} FILM{filtered.length===1?'':'S'}</span></div>
    {filtered.length===0?<EmptyState icon={Film} title={query?'No matching films':'Your catalog is waiting'} body={query?'Try searching with another title or genre.':'Add films to the catalog before scheduling shows.'} action={!query&&<Btn onClick={()=>setForm(true)} testid="button-empty-add-movie"><Plus size={15}/> Add a movie</Btn>}/>:<div className="movie-grid">{filtered.map((movie,index)=><article className="movie-card" key={movie.id} data-testid={`card-movie-${movie.id}`}><div className={`movie-art tone-${movie.posterTone||'rose'}`}><span className="poster-index">{String(index+1).padStart(2,'0')}</span><div className="poster-orbit"/><Film size={26}/><span className="poster-rating">{movie.rating}</span></div><div className="movie-card-body"><span className="movie-genre">{movie.genre}</span><h2>{movie.title}</h2><span className="movie-runtime"><Clock3 size={14}/>{movie.durationMinutes} min</span></div></article>)}</div>}
  </>;
}

function ScreensPage() {
  const {data,mutate,busy,session}=useApp();const[form,setForm]=useState(false);
  if(!data)return <><PageHeading eyebrow="VENUE" title="Screens" description="Auditorium layouts and seat capacity."/><LoadingBlock/></>;
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const input:ScreenInput={name:String(f.get('name')).trim(),rowCount:Number(f.get('rowCount')),seatsPerRow:Number(f.get('seatsPerRow'))};if(input.rowCount<1||input.rowCount>26||input.seatsPerRow<1||input.seatsPerRow>40)return;if(await mutate(()=>createScreen(session.mode,input),'Screen created with its seat map.'))setForm(false);}
  return <><PageHeading eyebrow="VENUE" title="Screens" description="Auditorium layouts and seat capacity." action={<Btn onClick={()=>setForm(!form)} testid="button-add-screen"><Plus size={16}/> Add a screen</Btn>}/>
    {form&&<div className="form-card"><div className="form-card-heading"><div><div className="eyebrow">NEW AUDITORIUM</div><h2>Create a screen</h2></div><button className="icon-button" onClick={()=>setForm(false)} aria-label="Close form" data-testid="button-close-screen-form"><X size={17}/></button></div><form className="inline-form screen-form" onSubmit={submit}><Field label="Screen name"><input name="name" required minLength={2} maxLength={40} placeholder="e.g. Screen 4" data-testid="input-screen-name"/></Field><Field label="Rows" hint="Up to 26 rows (A–Z)."><input name="rowCount" type="number" min="1" max="26" required placeholder="12" data-testid="input-screen-rows"/></Field><Field label="Seats per row"><input name="seatsPerRow" type="number" min="1" max="40" required placeholder="16" data-testid="input-screen-seats-per-row"/></Field><div className="form-actions"><Btn kind="secondary" onClick={()=>setForm(false)} testid="button-cancel-screen">Cancel</Btn><Btn type="submit" disabled={busy} testid="button-submit-screen">{busy?'Creating…':'Create screen'}</Btn></div></form><p className="screen-hint"><Settings2 size={14}/> Seats will be generated automatically. Rows toward the rear are marked premium.</p></div>}
    {data.screens.length===0?<EmptyState icon={ScreenShare} title="No screens configured" body="Add an auditorium to create shows and start placing groups." action={<Btn onClick={()=>setForm(true)} testid="button-empty-add-screen"><Plus size={15}/> Add a screen</Btn>}/>:<div className="screen-grid">{data.screens.map((screen,index)=>{const seats=data.seats.filter(s=>s.screenId===screen.id);const shows=data.shows.filter(s=>s.screenId===screen.id&&s.status==='scheduled');const fill=Math.round(seats.length?data.allocations.filter(a=>!a.releasedAt&&a.showId&&shows.some(s=>s.id===a.showId)).length/seats.length*100:0);return <article className="screen-card" key={screen.id} data-testid={`card-screen-${screen.id}`}><div className="screen-card-top"><span className="screen-icon"><ScreenShare size={18}/></span><span className="screen-count">AUDITORIUM {String(index+1).padStart(2,'0')}</span></div><h2>{screen.name}</h2><div className="screen-specs"><span><b>{screen.rowCount}</b> rows</span><i/><span><b>{screen.seatsPerRow}</b> seats / row</span></div><div className="capacity-line"><span>Total capacity</span><b>{seats.length} seats</b></div><div className="screen-graphic">{Array.from({length:Math.min(screen.rowCount,8)},(_,row)=><div className="graphic-row" key={row}><span style={{width:`${Math.max(36, 100-row*5)}%`}}/></div>)}</div><div className="screen-card-bottom"><span><CalendarDays size={14}/>{shows.length} scheduled {shows.length===1?'show':'shows'}</span><span>{fill}% allocated</span></div></article>})}</div>}
  </>;
}

function AuthPage({onDemo}:{onDemo:()=>void}) {
  const[,setLocation]=useLocation();const[mode,setMode]=useState<'signin'|'register'>('signin');const[loading,setLoading]=useState(false);const[error,setError]=useState('');const[success,setSuccess]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError('');setSuccess('');if(!supabase){setError('Sign-in is unavailable because Supabase is not configured. Use the clearly marked local demo instead.');return;}const form=new FormData(e.currentTarget);const email=String(form.get('email')).trim();const password=String(form.get('password'));if(!email||!password){setError('Enter your email and password.');return;}setLoading(true);try{if(mode==='signin'){const{error:authError}=await supabase.auth.signInWithPassword({email,password});if(authError)throw authError;setLocation('/dashboard');}else{const fullName=String(form.get('fullName')).trim();if(fullName.length<2){setError('Enter your full name.');return;}const{data:result,error:authError}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName}}});if(authError)throw authError;if(result.session)setLocation('/dashboard');else setSuccess('Account created. Check your inbox to confirm your email, then sign in.');}}catch(err){setError(err instanceof Error?err.message:'Authentication failed. Please try again.');}finally{setLoading(false);}}
  return <div className="auth-layout"><section className="auth-art"><div className="auth-art-top"><span className="brand-mark"><Clapperboard size={20}/></span><span>KINETIC CINE <small>SMART SEAT ENGINE</small></span></div><div className="auth-art-copy"><div className="eyebrow">FRONT OF HOUSE / STAFF ACCESS</div><h1>Every seat<br/>has a <em>story.</em></h1><p>A live operations cockpit for the people who make every screening run smoothly. Route groups into the best available seats, without a second guess.</p><div className="auth-art-details"><span><i/> REAL-TIME SEAT PLACEMENT</span><span>01 — 03</span></div><div className="auth-illustration"><div className="curtain-line"/><div className="auth-seat-row">{Array.from({length:9},(_,i)=><i className={i===4?'seat-lit':''} key={i}/>)}</div><div className="auth-seat-row secondary">{Array.from({length:9},(_,i)=><i key={i}/>)}</div><div className="auth-screen-line"/></div></div><div className="auth-art-foot"><span>BUILT FOR THE MOMENT BEFORE THE LIGHTS GO DOWN</span><span>EST. 2024</span></div></section><section className="auth-main"><div className="auth-card"><div className="auth-mobile-brand"><Clapperboard size={20}/> KINETIC CINE</div><div className="eyebrow">{isSupabaseConfigured?'STAFF PORTAL':'LOCAL WORKSPACE'}</div><h2>{mode==='signin'?'Welcome back.':'Join your team.'}</h2><p className="auth-description">{mode==='signin'?'Sign in to your theater workspace.':'Create an account for your theater team.'}</p>
      {isSupabaseConfigured?<><div className="auth-tabs"><button onClick={()=>{setMode('signin');setError('');setSuccess('');}} className={mode==='signin'?'auth-tab-active':''} data-testid="tab-sign-in">Sign in</button><button onClick={()=>{setMode('register');setError('');setSuccess('');}} className={mode==='register'?'auth-tab-active':''} data-testid="tab-register">Create account</button></div><form onSubmit={submit} className="auth-form">{mode==='register'&&<Field label="Full name"><input name="fullName" autoComplete="name" required minLength={2} placeholder="Your name" data-testid="input-auth-name"/></Field>}<Field label="Email address"><input name="email" type="email" autoComplete="email" required placeholder="you@cinema.com" data-testid="input-auth-email"/></Field><Field label="Password"><input name="password" type="password" minLength={6} autoComplete={mode==='signin'?'current-password':'new-password'} required placeholder="At least 6 characters" data-testid="input-auth-password"/></Field>{error&&<div className="form-feedback error" role="alert" data-testid="error-auth">{error}</div>}{success&&<div className="form-feedback success" role="status" data-testid="success-auth">{success}</div>}<Btn type="submit" disabled={loading} testid="button-auth-submit" className="auth-submit">{loading?'Please wait…':mode==='signin'?'Sign in to workspace':'Create account'} <ArrowRight size={16}/></Btn></form><div className="auth-divider"><span>OR</span></div><div className="demo-entry"><span className="demo-icon"><Zap size={17}/></span><div><b>Need a quick look around?</b><small>Try a private demo stored in this browser.</small></div><Btn kind="secondary" onClick={onDemo} testid="button-enter-demo">Enter demo</Btn></div></>:<><div className="local-note"><span className="demo-icon"><Zap size={17}/></span><div><b>Supabase isn't connected</b><small>Sign-in and shared staff accounts activate when project settings are present.</small></div></div><button className="demo-entry-button" onClick={onDemo} data-testid="button-enter-demo"><span><b>Enter local demo</b><small>Explore the full allocation workflow on this device.</small></span><ArrowRight size={18}/></button><p className="local-privacy">Demo changes are saved only to this browser. They are not shared with other staff.</p></>}</div><div className="auth-bottom">KINETIC CINE · SMART SEAT ENGINE <span>·</span> {new Date().getFullYear()}</div></section></div>;
}

function Router() {
  return <RoutedErrorBoundary><AppRoot/></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({children}:{children:ReactNode}) { const[location]=useLocation();return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/,'')}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>; }
export default App;