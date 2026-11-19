import {makeIllustration,illustrationPresets} from './illustration.js';
import {urbanGeometry,localWalkReach,planSightlines,clippedArea,isMappedGreen,isMappedCycle,studyBoundary,pointInsidePolygon} from './urban-analysis.js';
import {squareAt,resizeRectangle,rectangleDimensions} from './area-shapes.js';
const $=id=>document.getElementById(id);
const workspace=document.querySelector('.workspace');
const state={stage:'area',studyLens:'form',captureStatus:'idle',points:[],draftPoints:[],drawMode:'polygon',boundaryMode:'polygon',editingExisting:false,editReturnStage:'data',rectangleHistory:[],polygon:null,aoiLayer:null,previewLayer:null,draftLayer:null,markers:[],data:null,partialStudy:null,currentJob:null,activeRequest:null,requestController:null,mapStyle:'graphite',analysisMode:'context',view:'map',sceneDispose:null,scenePose:null,sceneToken:0,insights:null,roadChoice:null,choicePromise:null,choiceToken:0,massing:false,tiles:null,massingLayer:null,providerKey:null,terrain:null,terrainPoll:false,accountsAvailable:true};
const places={ahmedabad:[23.0225,72.5714],pune:[18.5204,73.8567],bengaluru:[12.9716,77.5946]};
let map,noticeTimer,placeSearchToken=0;
function notice(message){const n=$('notice');n.textContent=message;n.classList.remove('hidden');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.classList.add('hidden'),5500);}
function status(s){$('mapStatus').textContent=s;}
function dialog(title,body){$('dialogContent').innerHTML=`<h2>${title}</h2>${body}`;$('infoDialog').showModal();}
function showStage(stage){
  if((stage==='area'||stage==='data')&&state.view==='3d')showWorkspaceView('map');
  state.stage=stage;for(const name of ['Area','Data','Results','Export'])$(`stage${name}`).classList.toggle('hidden',name.toLowerCase()!==stage);
  $('boundaryAction').classList.toggle('hidden',stage!=='area');
  $('captureAction').classList.toggle('hidden',stage!=='data');
  document.querySelector('.control-panel').dataset.stage=stage;
  document.querySelector('.panel-body').scrollTop=0;
  const current={area:1,data:2,results:3,export:4}[stage];
  for(let i=1;i<=4;i++){$(`step${i}`).classList.toggle('active',i===current);$(`step${i}`).setAttribute('aria-current',i===current?'step':'false');}
  const titles={area:'Choose your boundary.',data:'Choose your layers.',results:'Read your site.',export:'Download your site.'};
  $('panelTitle').textContent=titles[stage];
  workspace.classList.toggle('drawing',stage==='area');
  updateWorkspaceNavigation();
  if(stage==='data')updateCaptureAction();
  if(stage==='results')focusStudy(state.studyLens);
  if(stage==='export')updateExportPreview();
  if(stage==='area')status(state.drawMode==='rectangle'?'Click the map to place a square, then drag its corners':'Click the map to place a boundary point');
  else if(stage==='data')status('Choose layers, then find site data');
  else if(stage==='results')status('Context loaded · select a layer to inspect');
  else status('Your context package is ready to prepare');
}
function updateWorkspaceNavigation(){
  const active=state.stage==='area'?'navCreate':state.stage==='data'?'navLayers':state.stage==='results'?'navStudy':'navExport';
  document.querySelectorAll('.rail-link').forEach(button=>{
    const isActive=button.id===active;
    button.classList.toggle('current',isActive);
    if(button.id!=='navHelp'&&button.id!=='navSettings')button.setAttribute('aria-current',isActive?'page':'false');
  });
  for(const [id,mode] of [['quickPolygon','polygon'],['quickRectangle','rectangle']]){
    $(id).classList.toggle('selected',state.drawMode===mode);
    $(id).setAttribute('aria-pressed',String(state.drawMode===mode));
  }
}
function installNavigationIcons(){
  const icons={navCreate:'<path d="M4 4h16v16H4zM8 2v4M16 2v4M8 18v4M16 18v4M2 8h4M18 8h4M2 16h4M18 16h4"/>',navLayers:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',navUrban:'<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10m-6-8 6 2 6-2"/>',navStudy:'<path d="m2 16 6-3 4 2 5-4 5 2-10 7-10-4Zm4-7 4-3 5 2 4-3m-9 1v7m5-5v7"/>',navExport:'<path d="M5 19 19 5M9 5h10v10"/>',navHelp:'<circle cx="12" cy="12" r="9"/><path d="M9.7 9a2.5 2.5 0 0 1 5 .4c0 1.8-2.7 2.2-2.7 4.4m0 3v.4"/>',navSettings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="11" cy="18" r="2"/>'};
  for(const [id,path] of Object.entries(icons))$(id).querySelector('.rail-icon').innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}
function collapseSitePanel(collapsed){
  workspace.classList.toggle('panel-collapsed',collapsed);
  $('openPanel').setAttribute('aria-expanded',String(!collapsed));
  document.querySelector('.control-panel').inert=collapsed;
  if(!collapsed)map?.invalidateSize();
}
function navigateTo(route,heading,{history=true,focus=true}={}){
  if(route!=='home')document.documentElement.classList.remove('intro-eligible');
  const hash=`#/${route}`;
  if(history&&location.hash!==hash)window.history.pushState({route},'',hash);
  document.title=`${{home:'Kaniks Studio / Site Context',about:'About / Kaniks Studio',study:'Current study / Kaniks Studio',pricing:'Pricing / Kaniks Studio',account:'Account / Kaniks Studio',workspace:'Site Context workspace / Kaniks Studio'}[route]}`;
  const inWorkspace=route==='workspace';
  for(const child of workspace.children){
    if(['heroScreen','aboutScreen','projectsScreen','pricingScreen','accountScreen'].includes(child.id))child.inert=child.id!==({home:'heroScreen',about:'aboutScreen',study:'projectsScreen',pricing:'pricingScreen',account:'accountScreen'}[route]);
    else child.inert=!inWorkspace;
  }
  if(inWorkspace)document.querySelector('.control-panel').inert=workspace.classList.contains('panel-collapsed');
  if(focus)requestAnimationFrame(()=>$(heading)?.focus({preventScroll:true}));
}
function openWorkspace(stage=state.polygon?(state.data?'results':'data'):'area',openPanel=!state.polygon,options={}){
  $('treeReview').classList.add('hidden');
  document.querySelector('.app').classList.remove('screen-home');
  $('heroScreen').classList.add('hidden');$('aboutScreen').classList.add('hidden');$('projectsScreen').classList.add('hidden');$('pricingScreen').classList.add('hidden');$('accountScreen').classList.add('hidden');
  if(state.stage!==stage)showStage(stage);
  collapseSitePanel(!openPanel);
  navigateTo('workspace','panelTitle',options);
  requestAnimationFrame(()=>map?.invalidateSize());
}
function openContentPage(page,options={}){
  if(page==='account'&&!state.accountsAvailable)page='pricing';
  $('treeReview').classList.add('hidden');
  document.querySelector('.app').classList.add('screen-home');
  $('heroScreen').classList.add('hidden');
  $('aboutScreen').classList.toggle('hidden',page!=='about');
  $('projectsScreen').classList.toggle('hidden',page!=='projects');
  $('pricingScreen').classList.toggle('hidden',page!=='pricing');
  $('accountScreen').classList.toggle('hidden',page!=='account');
  if(page==='projects'){
    const area=state.polygon?`${areaFromPoints(state.points).toFixed(2)} km²`:'No boundary selected';
    $('projectCurrentNote').textContent=state.data?`${area} · ${state.data.counts.buildings.toLocaleString()} mapped buildings in this session`:state.polygon?`${area} · boundary ready for data capture`:'Choose an area to begin a study.';
  }
  const route={projects:'study',about:'about',pricing:'pricing',account:'account'}[page];
  navigateTo(route,{projects:'projectsTitle',about:'aboutTitle',pricing:'pricingTitle',account:'accountTitle'}[page],options);
  if(page==='account')void refreshAccount();
}
function openHome(options={}){
  $('treeReview').classList.add('hidden');
  document.querySelector('.app').classList.add('screen-home');
  $('aboutScreen').classList.add('hidden');$('projectsScreen').classList.add('hidden');$('pricingScreen').classList.add('hidden');$('accountScreen').classList.add('hidden');
  $('heroScreen').classList.remove('hidden');collapseSitePanel(true);
  navigateTo('home','heroTitle',options);
}
function showAccount(user){
  $('accountSignedOut').classList.toggle('hidden',Boolean(user));
  $('accountSignedIn').classList.toggle('hidden',!user);
  if(user){
    const name=user.profile?.display_name||'';
    $('accountIdentity').textContent=user.email;
    $('accountDisplayName').textContent=name||'Your profile';
    $('accountPlanName').textContent=user.plan==='free'?'Free beta':user.plan;
    $('accountAvatar').textContent=(name||user.email).slice(0,1).toUpperCase();
    $('accountWorkspaceName').textContent=user.workspace?.name||'Personal workspace';
    $('profileName').value=name;
    $('profileProfession').value=user.profile?.profession||'';
    $('profileBio').value=user.profile?.bio||'';
    $('profileStatus').textContent='';
  }
  else{
    $('accountDeleteForm').classList.add('hidden');
    $('accountIdentity').textContent='';$('profileName').value='';$('profileProfession').value='';$('profileBio').value='';
    $('accountDisplayName').textContent='Your profile';$('accountAvatar').textContent='K';
    $('accountWorkspaceName').textContent='Personal workspace';$('profileStatus').textContent='';
  }
}
async function refreshAccount(){
  try{const response=await fetch('/api/auth/me',{credentials:'same-origin'});if(!response.ok)throw new Error('Account service unavailable.');showAccount((await response.json()).user);$('accountError').classList.add('hidden');}
  catch(error){showAccount(null);$('accountError').textContent=error.message;$('accountError').classList.remove('hidden');}
}
function setupSiteNavigation(){
  document.querySelector('.app').classList.add('screen-home');
  installNavigationIcons();
  $('navHome').onclick=openHome;
  $('heroCity').addEventListener('cityblock:select',event=>{
    event.preventDefault();
    if(event.detail.id==='west-residence')openContentPage('about');
    else if(event.detail.id==='north-tower')openWorkspace();
    else if(event.detail.id==='east-tower')openContentPage('projects');
  });
  $('heroBuildingAbout').onclick=()=>openContentPage('about');
  $('heroBuildingData').onclick=()=>openWorkspace();
  $('heroBuildingProjects').onclick=()=>openContentPage('projects');
  $('heroAbout').onclick=()=>openContentPage('about');$('heroPricing').onclick=()=>openContentPage('pricing');$('heroCurrent').onclick=()=>openContentPage('projects');$('heroAccount').onclick=()=>openContentPage('account');$('heroOpen').onclick=()=>openWorkspace();
  $('aboutBack').onclick=$('projectsBack').onclick=$('pricingBack').onclick=$('accountBack').onclick=openHome;
  $('pricingHome').onclick=openHome;
  $('pricingAccount').onclick=()=>openContentPage('account');$('accountViewPlans').onclick=()=>openContentPage('pricing');
  $('topAccount').onclick=()=>openContentPage('account');
  $('pricingStartFree').onclick=$('pricingOpenTool').onclick=$('pricingNavTool').onclick=()=>openWorkspace();
  for(const [id,period] of [['billingMonthly','monthly'],['billingAnnual','annual']])$(id).onclick=()=>{
    const suffix=period==='annual'?'Annual':'Monthly';
    $('billingMonthly').setAttribute('aria-pressed',String(period==='monthly'));
    $('billingAnnual').setAttribute('aria-pressed',String(period==='annual'));
    document.querySelectorAll('[data-price-monthly]').forEach(node=>node.textContent=node.dataset[`price${suffix}`]);
    document.querySelectorAll('[data-bill-monthly]').forEach(node=>node.textContent=node.dataset[`bill${suffix}`]);
  };
  let accountMode='login';
  const setAccountMode=mode=>{
    accountMode=mode;$('accountLoginTab').setAttribute('aria-pressed',String(mode==='login'));
    $('accountRegisterTab').setAttribute('aria-pressed',String(mode==='register'));
    $('accountFormTitle').textContent=mode==='login'?'Welcome back.':'Start your account.';
    $('accountSubmit').firstChild.textContent=mode==='login'?'Sign in ':'Create account ';
    $('accountConfirmGroup').classList.toggle('hidden',mode!=='register');
    $('accountConfirm').required=mode==='register';
    $('accountPassword').autocomplete=mode==='register'?'new-password':'current-password';
    $('accountError').classList.add('hidden');
  };
  $('accountLoginTab').onclick=()=>setAccountMode('login');$('accountRegisterTab').onclick=()=>setAccountMode('register');
  $('accountForm').onsubmit=async event=>{
    event.preventDefault();
    const email=$('accountEmail').value,password=$('accountPassword').value;
    if(accountMode==='register'&&password!==$('accountConfirm').value){$('accountError').textContent='Passwords do not match.';$('accountError').classList.remove('hidden');return;}
    $('accountSubmit').disabled=true;$('accountError').classList.add('hidden');
    try{
      const response=await fetch(`/api/auth/${accountMode}`,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({email,password})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not continue.');
      $('accountPassword').value='';$('accountConfirm').value='';showAccount(data.user);
    }catch(error){$('accountError').textContent=error.message;$('accountError').classList.remove('hidden');}
    finally{$('accountSubmit').disabled=false;}
  };
  $('accountLogout').onclick=async()=>{
    try{const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'});if(!response.ok)throw new Error('Could not sign out. Try again.');showAccount(null);}
    catch(error){$('profileStatus').textContent=error.message;}
  };
  $('accountContinue').onclick=()=>openWorkspace(state.stage,!workspace.classList.contains('panel-collapsed'));
  $('accountProfileForm').onsubmit=async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button[type=submit]');button.disabled=true;
    try{
      const response=await fetch('/api/auth/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({displayName:$('profileName').value,profession:$('profileProfession').value,bio:$('profileBio').value})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not save profile.');
      showAccount(data.user);$('profileStatus').textContent='Profile saved.';
    }catch(error){$('profileStatus').textContent=error.message;}
    finally{button.disabled=false;}
  };
  $('accountDeleteToggle').onclick=()=>{$('accountDeleteForm').classList.toggle('hidden');};
  $('accountDeleteForm').onsubmit=async event=>{
    event.preventDefault();$('accountDeleteError').classList.add('hidden');
    try{const response=await fetch('/api/auth/account',{method:'DELETE',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({password:$('accountDeletePassword').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not delete account.');$('accountDeletePassword').value='';showAccount(null);}
    catch(error){$('accountDeleteError').textContent=error.message;$('accountDeleteError').classList.remove('hidden');}
  };
  $('aboutToMap').onclick=$('projectsToMap').onclick=()=>openWorkspace();
  $('projectCurrent').onclick=()=>openWorkspace(state.data?'results':state.polygon?'data':'area',true);
  $('projectGraphics').onclick=()=>{if(state.data){openWorkspace('results');$('openIllustration').click();}else{openWorkspace(state.polygon?'data':'area',true);notice('Capture a site to make graphics from its layers.');}};
  $('projectAnalysis').onclick=()=>{if(state.data){openWorkspace('results');$('navUrban').click();}else{openWorkspace(state.polygon?'data':'area',true);notice('Capture a site to explore urban analysis.');}};
  $('panelClose').onclick=()=>collapseSitePanel(true);
  $('openPanel').onclick=()=>{if(!$('heroScreen').classList.contains('hidden'))openWorkspace(state.stage,true);else collapseSitePanel(false);};
  for(const [id,mode] of [['quickPolygon','polygon'],['quickRectangle','rectangle']])$(id).onclick=()=>{
    if(state.stage!=='area')beginBoundaryEdit(true);
    if(state.activeRequest)return;
    setDrawMode(mode);openWorkspace('area');
  };
  const placeInput=$('quickCoordinates'),placeResults=$('placeResults'),placeStatus=$('placeSearchStatus');
  const hidePlaces=()=>{placeResults.replaceChildren();placeResults.classList.add('hidden');placeInput.setAttribute('aria-expanded','false');};
  const showPlaceMessage=message=>{
    placeResults.replaceChildren();const note=document.createElement('p');note.textContent=message;
    placeResults.append(note);placeResults.classList.remove('hidden');placeInput.setAttribute('aria-expanded','true');placeStatus.textContent=message;
  };
  const goToPlace=place=>{
    placeSearchToken++;hidePlaces();placeInput.value=place.label;
    if(state.view==='3d')showWorkspaceView('map');
    requestAnimationFrame(()=>{
      map.invalidateSize();
      const animate=!matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(place.bounds&&(place.bounds[1][0]-place.bounds[0][0]>.0001||place.bounds[1][1]-place.bounds[0][1]>.0001))
        map.fitBounds(place.bounds,{maxZoom:16,padding:[30,30],animate});
      else map.flyTo([place.lat,place.lon],16,{animate,duration:.7});
    });
  };
  $('quickGo').onclick=async()=>{
    const query=placeInput.value.trim();
    if(!query)return showPlaceMessage('Enter a place name or latitude, longitude.');
    const coordinates=query.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:,|\s)\s*([+-]?\d+(?:\.\d+)?)$/);
    if(coordinates){
      const lat=Number(coordinates[1]),lon=Number(coordinates[2]);
      if(Math.abs(lat)>90||Math.abs(lon)>180)return showPlaceMessage('Use latitude −90 to 90 and longitude −180 to 180.');
      goToPlace({label:`${lat}, ${lon}`,lat,lon});return;
    }
    const token=++placeSearchToken;hidePlaces();placeStatus.textContent='Searching places…';
    placeInput.setAttribute('aria-busy','true');$('quickGo').setAttribute('aria-busy','true');
    try{
      const response=await fetch(`/api/places?q=${encodeURIComponent(query)}`);
      const data=await response.json();
      if(token!==placeSearchToken)return;
      if(!response.ok)throw new Error(data.error||'Place search is unavailable.');
      if(!data.results?.length)return showPlaceMessage('No places found. Try a more specific name.');
      placeResults.replaceChildren();
      for(const place of data.results){
        const button=document.createElement('button');button.type='button';button.className='place-result';
        button.textContent=place.label;button.onclick=()=>goToPlace(place);
        button.onkeydown=event=>{
          const options=[...placeResults.querySelectorAll('button')],index=options.indexOf(button);
          if(event.key==='ArrowDown'){event.preventDefault();options[(index+1)%options.length].focus();}
          else if(event.key==='ArrowUp'){event.preventDefault();(index?options[index-1]:placeInput).focus();}
          else if(event.key==='Escape'){hidePlaces();placeInput.focus();}
        };
        placeResults.append(button);
      }
      const credit=document.createElement('small');credit.textContent='Place search © OpenStreetMap contributors';placeResults.append(credit);
      placeResults.classList.remove('hidden');placeInput.setAttribute('aria-expanded','true');
      placeStatus.textContent=`${data.results.length} places found. Press Down Arrow to choose a result.`;
    }catch(error){if(token===placeSearchToken)showPlaceMessage(error.message||'Place search is unavailable.');}
    finally{if(token===placeSearchToken){placeInput.removeAttribute('aria-busy');$('quickGo').removeAttribute('aria-busy');}}
  };
  placeInput.addEventListener('input',()=>{placeSearchToken++;hidePlaces();placeStatus.textContent='';placeInput.removeAttribute('aria-busy');$('quickGo').removeAttribute('aria-busy');});
  placeInput.addEventListener('keydown',event=>{
    if(event.key==='Enter'){$('quickGo').click();event.preventDefault();}
    else if(event.key==='ArrowDown'&&!placeResults.classList.contains('hidden')){const first=placeResults.querySelector('button');if(first){first.focus();event.preventDefault();}}
    else if(event.key==='Escape')hidePlaces();
  });
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.workspace-search, .place-results'))hidePlaces();});
  customElements.whenDefined('reference-city-block').then(()=>requestAnimationFrame(()=>{
    $('heroCity').parentElement.classList.toggle('no-webgl',!$('heroCity').gl);
  }));
  collapseSitePanel(true);
  const initial=location.hash.slice(2);
  if(initial==='workspace')openWorkspace(state.stage,true,{history:false,focus:false});
  else if(initial==='about')openContentPage('about',{history:false,focus:false});
  else if(initial==='study')openContentPage('projects',{history:false,focus:false});
  else if(initial==='pricing')openContentPage('pricing',{history:false,focus:false});
  else if(initial==='account')openContentPage('account',{history:false,focus:false});
  else openHome({history:false,focus:false});
  window.addEventListener('popstate',()=>{
    const route=location.hash.slice(2);
    if(route==='workspace')openWorkspace(state.stage,!workspace.classList.contains('panel-collapsed'),{history:false});
    else if(route==='about')openContentPage('about',{history:false});
    else if(route==='study')openContentPage('projects',{history:false});
    else if(route==='pricing')openContentPage('pricing',{history:false});
    else if(route==='account')openContentPage('account',{history:false});
    else openHome({history:false});
  });
}
function areaFromPoints(points){
  if(points.length<3)return 0;const lat=points.reduce((a,p)=>a+p[0],0)/points.length;
  const metersX=111320*Math.cos(lat*Math.PI/180),metersY=110574;let sum=0;
  for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=(a[1]-points[0][1])*(b[0]-points[0][0])-(b[1]-points[0][1])*(a[0]-points[0][0]);}
  return Math.abs(sum*metersX*metersY/2)/1e6;
}
function updateExportPreview(){
  if(!state.polygon||!state.data)return;
  const ring=state.polygon.coordinates[0],bounds=ring.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
  const [minX,minY,maxX,maxY]=bounds,dx=Math.max(maxX-minX,1e-8),dy=Math.max(maxY-minY,1e-8),scale=Math.min(255/dx,150/dy);
  const project=([x,y])=>`${(150+(x-(minX+maxX)/2)*scale).toFixed(1)},${(95-(y-(minY+maxY)/2)*scale).toFixed(1)}`;
  const outline=coords=>`<polygon points="${coords.map(project).join(' ')}"/>`;
  const buildings=(state.data.layers.buildings||[]).slice(0,220).flatMap(f=>{
    const g=f.geometry;return g?.type==='Polygon'?[outline(g.coordinates[0])]:g?.type==='MultiPolygon'?g.coordinates.map(part=>outline(part[0])):[];
  }).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 190"><rect width="300" height="190" fill="#f5f7fa"/><g fill="#fff" stroke="#245bff" stroke-width="1.6">${outline(ring)}</g><g fill="#dce2ea" stroke="#596675" stroke-width=".45">${buildings}</g></svg>`;
  $('exportThumbnail').src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  $('exportSummary').textContent=`${areaFromPoints(state.points).toFixed(3)} km² · ${state.data.counts.buildings.toLocaleString()} mapped buildings · ${state.terrain?.status==='complete'?'terrain included':'terrain not fetched'}`;
}
function updateSourceNote(){
  $('dataSourceNote').textContent='Each selected layer is fetched from one pinned Overture release and held temporarily in server memory. Reloading loses this study. Large areas can take minutes.';
}
let planSequence=0;
async function updateCapturePlan(){
  if(!state.polygon)return;
  const sequence=++planSequence;
  try{
    const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({polygon:state.polygon,layers:selectedLayers()})});
    const plan=await response.json();if(sequence!==planSequence)return;
    $('capturePlan').textContent=response.ok?`${plan.areaKm2} km² · ${plan.steps} live layer reads · up to ${Number(plan.featureLimit).toLocaleString()} mapped features. Time and feature count depend on the source.`:plan.error;
  }catch{if(sequence===planSequence)$('capturePlan').textContent='Could not estimate the capture. Check the local service.';}
}
function updateDrawingMetrics(){
  const points=state.draftPoints,a=areaFromPoints(points),size=state.drawMode==='rectangle'?rectangleDimensions(points):null;
  $('pointCount').textContent=String(points.length).padStart(2,'0');
  $('areaSize').textContent=points.length>2?`${a<.01?a.toFixed(3):a.toFixed(2)} km²`:'—';
  $('rectangleDimensions').textContent=size?`${Math.round(size.width)} × ${Math.round(size.height)} m`:'Click the map to place a square';
  $('undoPoint').disabled=state.drawMode==='rectangle'?!state.rectangleHistory.length:!points.length;
  $('clearArea').disabled=!points.length;
  $('finishArea').disabled=points.length<3||a<.0001;
  const guidance=points.length<3?(state.drawMode==='rectangle'?'Click the map to place a square; drag a corner to resize it.':'Place at least three points to finish your polygon.'):a<.0001?'Make the selected area at least 100 m².':'Your boundary is ready to use.';
  const progress=points.length?`${points.length} ${state.drawMode==='rectangle'?'corners':'points'}${points.length>2?` · ${$('areaSize').textContent}`:''} · `:'';
  $('finishAreaHelp').textContent=progress+guidance;
}
function updateDrawing(){
  updateDrawingMetrics();
  if(state.draftLayer){map.removeLayer(state.draftLayer);state.draftLayer=null;}
  state.markers.forEach(m=>map.removeLayer(m));state.markers=[];
  const points=state.draftPoints;
  if(!points.length)return;
  state.draftLayer=state.drawMode==='rectangle'&&points.length===4
    ?L.polygon(points,{color:'#245bff',weight:3,dashArray:'8 5',fillColor:'#a5baff',fillOpacity:.14,interactive:false}).addTo(map)
    :L.polyline(points,{color:'#245bff',weight:3,dashArray:'6 6',opacity:.95,interactive:false}).addTo(map);
  points.forEach((p,i)=>{
    const marker=L.marker(p,{icon:L.divIcon({className:'',html:`<div class="vertex-dot ${i===0?'first':''} ${state.drawMode==='rectangle'?'rectangle-handle':''}"></div>`,iconSize:[24,24],iconAnchor:[12,12]}),interactive:true,draggable:true,autoPan:true}).addTo(map);
    marker.on('dragstart',()=>{if(state.drawMode==='rectangle')state.rectangleHistory.push(points.map(c=>[...c]));});
    marker.on('drag',e=>{
      const position=e.target.getLatLng();
      state.draftPoints=state.drawMode==='rectangle'?resizeRectangle(state.draftPoints,i,[position.lat,position.lng]):state.draftPoints.map((point,index)=>index===i?[position.lat,position.lng]:point);
      state.draftLayer?.setLatLngs(state.draftPoints);
      updateDrawingMetrics();
    });
    marker.on('dragend',()=>updateDrawing());
    marker.on('click',e=>{L.DomEvent.stopPropagation(e);if(state.drawMode==='polygon'&&i===0&&state.draftPoints.length>=3)finishArea();});
    state.markers.push(marker);
  });
}
function setDrawMode(mode){
  if(state.drawMode===mode)return;
  state.drawMode=mode;state.draftPoints=[];state.rectangleHistory=[];
  $('shapePolygon').classList.toggle('selected',mode==='polygon');$('shapeRectangle').classList.toggle('selected',mode==='rectangle');
  for(const [id,active] of [['shapePolygon',mode==='polygon'],['shapeRectangle',mode==='rectangle']])$(id).setAttribute('aria-pressed',String(active));
  $('drawInstructions').textContent=mode==='rectangle'?'Click the map once to place a 400 m square. Drag any of its four corners to make a rectangle; the opposite corner stays in place.':'Click to place each dot on the map. Drag a dot to adjust it; finish by clicking the first dot or the button below.';
  $('rectangleDimensions').classList.toggle('hidden',mode!=='rectangle');
  $('pointLabel').textContent=mode==='rectangle'?'CORNERS':'POINTS PLACED';
  $('undoPoint').textContent=mode==='rectangle'?'↶  Undo resize':'↶  Undo point';
  updateDrawing();updateWorkspaceNavigation();status(mode==='rectangle'?'Click the map to place a square, then drag its corners':'Click the map to place a boundary point');
}
function addPoint(latlng){
  if(state.stage!=='area')return;
  if(state.drawMode==='rectangle'){
    if(state.draftPoints.length)return;
    state.draftPoints=squareAt([latlng.lat,latlng.lng]);state.rectangleHistory.push([]);
    status('Square placed · drag a corner to resize, then finish the boundary');
  }else{
    if(state.draftPoints.length>=100)return notice('Choose no more than 100 boundary points.');
    state.draftPoints.push([latlng.lat,latlng.lng]);status(`${state.draftPoints.length} boundary point${state.draftPoints.length===1?'':'s'} placed`);
  }
  updateDrawing();collapseSitePanel(false);
}
function clearDraft(){state.draftPoints=[];state.rectangleHistory=[];updateDrawing();status('Drawing cleared · your existing capture is safe');}
function beginBoundaryEdit(empty=false){
  if(state.activeRequest){notice('Finish, pause or cancel the current data capture before changing its boundary.');return;}
  const alreadyEditing=state.editingExisting;
  state.editingExisting=!!state.polygon;
  if(!alreadyEditing)state.editReturnStage=state.stage;
  state.rectangleHistory=[];
  const mode=empty?'polygon':state.boundaryMode;
  state.drawMode=mode==='rectangle'?'polygon':'rectangle';setDrawMode(mode);
  if(!empty){state.draftPoints=state.points.map(p=>[...p]);updateDrawing();}
  $('cancelAreaEdit').classList.toggle('hidden',!state.editingExisting);
  $('editBoundaryNote').classList.toggle('hidden',!state.editingExisting);
  showStage('area');
}
function cancelBoundaryEdit(){
  if(!state.editingExisting)return clearDraft();
  state.editingExisting=false;state.draftPoints=[];state.rectangleHistory=[];updateDrawing();
  $('cancelAreaEdit').classList.add('hidden');$('editBoundaryNote').classList.add('hidden');
  showStage(state.editReturnStage);notice('Original boundary and captured data kept.');
}
function resetCapturedStudy(){
  $('clearTreeProposals').click();$('treeReview').classList.add('hidden');
  void cancelExtraction();showWorkspaceView('map');state.scenePose=null;illustration.scenePose=null;state.choiceToken++;state.roadChoice=null;state.choicePromise=null;$('show3D').disabled=true;
  state.points=[];state.polygon=null;state.data=null;urban.token++;urban.data=null;urban.choice=null;urban.report=null;urban.reach=null;urban.visibility=null;urban.features?.remove();urban.features=null;urban.scene?.();urban.scene=null;
  state.insights=null;state.analysisMode='context';state.terrain=null;state.partialStudy=null;state.massing=false;massingGeneration++;
  state.captureStatus='idle';updateCaptureAction();
  if(state.aoiLayer)map.removeLayer(state.aoiLayer);if(state.previewLayer)map.removeLayer(state.previewLayer);if(state.massingLayer)map.removeLayer(state.massingLayer);
  state.aoiLayer=state.previewLayer=state.massingLayer=null;
  $('view2D').classList.add('selected');$('viewMassing').classList.remove('selected');
  $('addTerrain').disabled=false;$('addTerrain').textContent='Fetch terrain GeoTIFF ↗';
  $('terrainStatus').textContent='Optional bare-earth terrain. Source and limits will be included in the package.';
  updateUrbanMetrics();
  $('fetchError').classList.add('hidden');
}
function finishArea(){
  const points=state.draftPoints,area=areaFromPoints(points);
  if(points.length<3||area<.0001){notice('Choose an area of at least 100 square metres.');return;}
  const coords=points.map(([lat,lng])=>[lng,lat]);coords.push([...coords[0]]);
  const polygon={type:'Polygon',coordinates:[coords]};
  if(state.polygon&&JSON.stringify(polygon)===JSON.stringify(state.polygon))return cancelBoundaryEdit();
  const changed=!!state.polygon;
  if(changed)resetCapturedStudy();
  state.points=points.map(p=>[...p]);state.polygon=polygon;state.boundaryMode=state.drawMode;
  state.editingExisting=false;state.draftPoints=[];state.rectangleHistory=[];updateDrawing();
  $('cancelAreaEdit').classList.add('hidden');$('editBoundaryNote').classList.add('hidden');
  state.aoiLayer=L.polygon(state.points,{color:'#245bff',weight:3,fillColor:'#a5baff',fillOpacity:.23,lineCap:'round'}).addTo(map);
  $('selectedAreaSummary').textContent=`${area.toFixed(3)} km² · ${state.drawMode==='rectangle'?'adjustable rectangle':`${state.points.length} vertices`}`;
  $('selectedAreaSize').textContent=`${area.toFixed(3)} km²`;
  map.fitBounds(state.aoiLayer.getBounds().pad(.32),{animate:!matchMedia('(prefers-reduced-motion: reduce)').matches});showStage('data');updateSourceNote();void updateCapturePlan();
  if(changed)notice('New boundary applied. Find site data again for its updated area.');
}
function parseMapTilerKey(value){
  const input=(value||'').trim();
  if(/^https?:\/\//i.test(input)){
    try{const url=new URL(input);return url.hostname==='api.maptiler.com'?parseMapTilerKey(url.searchParams.get('key')):'';}catch{return '';}
  }
  return /^[a-zA-Z0-9_-]{12,128}$/.test(input)?input:'';
}
function satelliteSettings(){
  dialog('Detailed imagery is not configured',`<p>This site needs an application imagery account before it can show clear satellite tiles. The owner can set <code>MAPTILER_KEY</code> on the server; visitors will not need to paste a key or URL.</p><p>The free regional overview is much coarser than individual trees.</p><button type="button" id="overviewMap" class="dialog-secondary">Show regional overview</button>`);
  $('overviewMap').onclick=()=>{$('infoDialog').close();tiles('satellite',true);mapFeatures();};
}
function tiles(style,overview=false){
  const key=style==='satellite'&&!overview?parseMapTilerKey(state.providerKey):'';
  if(style==='satellite'&&!key&&!overview){satelliteSettings();return false;}
  if(state.tiles)map.removeLayer(state.tiles);
  const eox='https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg';
  const url=style==='satellite'?(key?`https://api.maptiler.com/maps/hybrid-v4/{z}/{x}/{y}@2x.png?key=${encodeURIComponent(key)}`:eox):'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  state.tiles=L.tileLayer(url,{tileSize:key?512:256,zoomOffset:key?-1:0,maxZoom:key?22:19,maxNativeZoom:style==='satellite'&&!key?14:undefined,attribution:style==='satellite'?(key?'© MapTiler · © OpenStreetMap contributors':'EOxCloudless © EOX IT Services GmbH · modified Copernicus Sentinel data 2016 & 2017'):'© OpenStreetMap contributors',crossOrigin:true}).addTo(map);
  if(key){const layer=state.tiles;const reject=()=>{if(state.mapStyle==='satellite'&&state.tiles===layer){tiles('graphite');$('mapKeyWarning').classList.remove('hidden');notice('Detailed imagery is blocked by the current key settings.');}};
    layer.once('tileerror',reject);
    layer.once('tileload',event=>{if(event.tile.naturalWidth<768)reject();});
  }
  const credit=$('imageryAttribution');credit.href=key?'https://www.maptiler.com/copyright/':'https://cloudless.eox.at';credit.textContent=key?'Imagery © MapTiler':'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)';
  $('maptilerLogo').classList.toggle('hidden',!key);$('overviewQuality').classList.toggle('hidden',style!=='satellite'||!!key);
  if(style==='satellite')$('mapKeyWarning').classList.add('hidden');
  state.mapStyle=style;workspace.classList.toggle('illustrated',style==='illustrated');workspace.classList.toggle('satellite',style==='satellite');$('satelliteCredit').classList.toggle('hidden',style!=='satellite');
  document.querySelectorAll('[data-map-style]').forEach(b=>b.classList.toggle('active',b.dataset.mapStyle===style));return true;
}
function selectedLayers(){return {buildings:$('layerBuildings').checked,roads:$('layerRoads').checked,water:$('layerWater').checked,landuse:$('layerLanduse').checked,trees:$('layerTrees').checked};}
function hash(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function scenario(){return {enabled:$('scenarioEnabled').checked,min:Number($('heightMin').value),max:Number($('heightMax').value),seed:1};}
function heightFor(p){if(Number.isFinite(p.height_m)&&p.height_m>0)return {value:p.height_m,method:p.height_method};if(!scenario().enabled)return {value:null,method:'unknown'};const {min,max,seed}=scenario();if(!Number.isFinite(min)||!Number.isFinite(max)||min<2||max>150||max<min)return {value:null,method:'unknown'};return {value:Math.round((min+hash(`${p.id}:${seed}`)/4294967295*(max-min))*10)/10,method:'scenario'};}
function evidenceKind(p){return (p.height_method==='recorded'||p.height_method==='floor_estimate')&&Number.isFinite(p.height_m)&&p.height_m>0?p.height_method:'unknown';}
function showAnalysisMode(mode){state.analysisMode=mode;for(const [id,value] of [['mapContext','context'],['mapEvidence','evidence'],['mapRoads','roads'],['mapChoice','choice']]){$(id).classList.toggle('selected',mode===value);$(id).setAttribute('aria-pressed',String(mode===value));}document.querySelectorAll('[data-urban]').forEach(b=>{b.classList.toggle('selected',b.dataset.urban===mode);b.setAttribute('aria-pressed',String(b.dataset.urban===mode));});mapFeatures();if(state.view==='3d')void renderWorkspaceScene();}
function updateUrbanMetrics(){
  renderAnalysisCatalog();
}
const analysisCatalog={
  'Form':[['Building heights','evidence','Source height attributes and estimates'],['Building age',null,'Building year attributes from municipal cadastres'],['Built density',null,'Clipped footprints, verified floor areas and a site boundary'],['Blocks & Spacematrix',null,'Street topology, block geometry and reliable floor areas'],['Visibility & sky view',null,'Complete heights and a calibrated visibility model'],['Street canyons',null,'Road widths and verified facing building heights'],['View corridors',null,'Surveyed height geometry and view points'],['Figure–ground','figure','Mapped building footprints']],
  'Use and people':[['Land use','landuse','Mapped land use polygons'],['Activity points',null,'Points of interest with opening times and validation'],['Residents & jobs',null,'Population estimates and employment data at compatible resolution'],['Housing value',null,'Licensed transaction or valuation data'],['15-minute city',null,'Verified amenities, routes and travel times'],['Public spaces',null,'Validated public access and public-space inventory'],['Walkability',null,'Footpaths, crossings, access, slope and route connectivity']],
  'Movement':[['Mapped street network','roads','Clipped mapped road centrelines'],['Network choice · 800 m proxy','choice','Mapped road graph; a length weighted local shortest-path estimate'],['Space syntax · angular R800',null,'A verified walkable intersection graph and angular segment choice model'],['Pedestrian flows',null,'Observed pedestrian counts or a calibrated origin–destination model'],['Car traffic',null,'Traffic counts, trip demand, link capacities and model calibration'],['Public transport',null,'Local GTFS or verified service schedules and stops'],['Cycling',null,'Cycle network, junction access and observed counts for demand'],['Isochrones',null,'Walkable network, access rules and travel-time model'],['Parking',null,'Mapped capacity, restrictions and occupancy surveys']],
  'Environment':[['Trees','trees','Mapped tree points and reviewed canopy proposals'],['Terrain relief','terrain','Bare-earth DEM for the chosen site'],['Insolation & shadows',null,'Reliable building heights, terrain and time-of-year sun model'],['Pedestrian wind',null,'Weather boundary conditions and a calibrated wind model'],['Traffic noise',null,'Measured vehicle volumes, speeds and noise calibration'],['Rain & puddles',null,'Drainage, land cover, rainfall and high-resolution surface'],['Trees & 3-30-300',null,'Verified canopy extents, household views and access to public green space'],['Heat island',null,'Land surface temperature, shade and validated local weather'],['Solar roofs',null,'Roof geometry, obstructions and solar irradiance model']]
};
function renderAnalysisCatalog(){
  const target=$('analysisCatalog');if(!target||!state.data)return;
  target.replaceChildren();
  for(const [category,items] of Object.entries(analysisCatalog)){
    const section=document.createElement('section'),heading=document.createElement('h3'),grid=document.createElement('div');heading.textContent=category;grid.className='catalog-grid';section.append(heading,grid);
    for(const [label,mode,requirement] of items){
      const button=document.createElement('button'),caption=document.createElement('span'),badge=document.createElement('small');
      button.type='button';caption.textContent=label;badge.textContent=mode?'View layer':'Needs data';button.className=mode?'catalog-ready':'catalog-pending';
      if(mode==='landuse'&&!state.data.layers.landuse.length)badge.textContent='No mapped features';
      if(mode==='trees'&&!state.data.layers.trees.length)badge.textContent='No mapped trees';
      if(mode==='terrain'&&state.terrain?.status!=='complete')badge.textContent='Fetch DEM';
      if(mode==='choice'&&state.roadChoice?.status!=='ready')badge.textContent=state.roadChoice?.status==='loading'?'Calculating…':'No connected graph';
      button.append(caption,badge);button.onclick=()=>{
        if(mode==='figure'){openIllustration();applyGraphicPreset('figure');}
        else if(mode==='terrain'){if(state.terrain?.status==='complete')showWorkspaceView('3d');else void addTerrain();}
        else if(mode==='choice'){if(state.roadChoice?.status==='ready'){showAnalysisMode(mode);$('choiceDetails').scrollIntoView({behavior:'smooth',block:'nearest'});}else notice(state.roadChoice?.reason||'Network analysis is still being prepared.');}
        else if(mode){showAnalysisMode(mode);if(mode==='landuse'||mode==='trees')showWorkspaceView('3d');}
        else dialog(label,`<p>This layer needs ${escapeHTML(requirement)}. It is not available in this capture, so no result is shown.</p><p>India-focused sources need coverage, date, access and licensing checks before a model can use them. This capture currently uses the datasets listed in <strong>Sources for this capture</strong>.</p>`);
      };grid.append(button);
    }
    target.append(section);
  }
}
function focusStudy(section){
  if(state.stage!=='results')showStage('results');state.studyLens=section;
  for(const [id,name] of [['lensForm','form'],['lensMovement','movement']]){$(id).classList.toggle('selected',section===name);$(id).setAttribute('aria-pressed',String(section===name));}
  $('analysisTitle').closest('.analysis-card').classList.toggle('hidden',section!=='form');
  $('movementTitle').closest('.analysis-card').classList.toggle('hidden',section!=='movement');
  document.querySelector('.panel-body').scrollTop=0;
}
function updateSceneMetrics(){const report=state.insights,box=$('sceneMetrics');if(!report){box.textContent='Reading height evidence…';return;}box.innerHTML=`<div><strong>${report.heightEvidence.recorded.toLocaleString()} / ${report.footprintCount.toLocaleString()}</strong><span>Source heights</span></div>`;}
function updateSceneSummary(){
  if(!state.data)return;
  const ring=state.polygon.coordinates[0],center=ring.slice(0,-1).reduce((a,p)=>[a[0]+p[0]/(ring.length-1),a[1]+p[1]/(ring.length-1)],[0,0]);
  $('sceneSiteLine').textContent=`${center[1].toFixed(5)}°, ${center[0].toFixed(5)}° · ${areaFromPoints(state.points).toFixed(2)} km² · ${state.data.release||'mapped context'}`;
  $('sceneBuildingCount').textContent=state.data.counts.buildings.toLocaleString();
  $('sceneRoadLength').textContent=state.insights?.movement?.lengthKm?.toLocaleString()??'—';
  const m=state.terrain?.metadata;
  $('sceneRelief').textContent=m?Math.round(m.elevationMaxMeters-m.elevationMinMeters).toLocaleString():'—';
  $('sceneFetchTerrain').hidden=state.terrain?.status==='complete';
  $('sceneFetchTerrain').disabled=state.terrain?.status==='running';
  $('sceneFetchTerrain').textContent=state.terrain?.status==='running'?'Fetching terrain…':state.terrain?.status==='error'?'Retry terrain ↗':'Fetch terrain ↗';
}
function inspectSceneBuilding(feature){
  const p=feature.properties||{},h=heightFor(p),kind={recorded:'Source height',floor_estimate:'Floor estimate',scenario:'Conceptual scenario'}[h.method]||'Unknown height';
  const datasets=p.source_datasets?.filter(Boolean).join(', ')||p.source||'Not specified';
  $('sceneBuildingDetail').innerHTML=`<span class="scene-kicker">SELECTED BUILDING</span><strong>${escapeHTML(p.name||p.kind||'Building footprint')}</strong><dl><div><dt>Height</dt><dd>${h.value!==null?`${h.value.toFixed(1)} m · ${kind}`:'Unknown · shown flat'}</dd></div>${Number.isFinite(p.num_floors)?`<div><dt>Mapped floors</dt><dd>${p.num_floors}</dd></div>`:''}<div><dt>Type</dt><dd>${escapeHTML(p.kind||'Not mapped')}</dd></div>${p.roof_shape?`<div><dt>Mapped roof</dt><dd>${escapeHTML(p.roof_shape)} (not modelled)</dd></div>`:''}${Number.isFinite(p.roof_height)?`<div><dt>Roof height</dt><dd>${p.roof_height.toFixed(1)} m · source</dd></div>`:''}${p.roof_material?`<div><dt>Roof material</dt><dd>${escapeHTML(p.roof_material)}</dd></div>`:''}<div><dt>Dataset</dt><dd>${escapeHTML(datasets)}</dd></div><div><dt>Feature ID</dt><dd title="${escapeHTML(p.id||'')}">${escapeHTML(p.id||'—')}</dd></div></dl><small>Source attributes are mapped evidence, not a site survey.</small>`;
  if(matchMedia('(max-width:700px)').matches){workspace.classList.add('scene-info-open');$('sceneInfoToggle').setAttribute('aria-expanded','true');$('sceneBuildingDetail').scrollIntoView({block:'nearest'});}
}
async function loadInsights(data){
  const body=$('analysisBody');body.textContent='Reading captured building attributes…';state.insights=null;
  if(!data.id){body.textContent='A current capture is needed for this readout.';$('movementBody').textContent='A current capture is needed for this readout.';return;}
  try{
    const response=await fetch(`/api/jobs/${encodeURIComponent(data.id)}/insights`);
    const report=await response.json();if(!response.ok)throw new Error(report.error||'Analysis unavailable.');
    if(state.data?.id!==data.id)return;
    state.insights=report;
    updateSceneMetrics();updateSceneSummary();updateUrbanMetrics();
    const counts=report.heightEvidence,total=report.footprintCount;
    const rawPercentage=total?counts.recorded/total*100:0;
    const percentage=rawPercentage>0&&rawPercentage<1?'<1%':`${Math.round(rawPercentage)}%`;
    const segments=[['recorded','Source height',counts.recorded],['floor_estimate','Floor estimate',counts.floor_estimate],['unknown','Unknown',counts.unknown]];
    body.innerHTML=`<div class="analysis-stats"><strong>${percentage}</strong><span>Source height coverage</span></div><div class="evidence-bar" aria-label="${counts.recorded} source heights, ${counts.floor_estimate} floor estimates, ${counts.unknown} unknown">${segments.map(([key,,count])=>`<span class="${key}" style="width:${total?count/total*100:0}%"></span>`).join('')}</div><div class="evidence-legend">${segments.map(([key,label,count])=>`<div><i class="${key}"></i>${label}<b>${count.toLocaleString()}</b></div>`).join('')}</div><p class="analysis-note">${report.recordedHeightMedianM===null?'No source height median.':`Median source height ${report.recordedHeightMedianM} m.`} Full touching footprints counted; scenarios excluded.</p>`;
    const movement=report.movement,m=$('movementBody');
    m.innerHTML=movement?`<div class="movement-stats"><strong>${movement.lengthKm.toLocaleString()} km</strong><span>Mapped centreline inside site</span></div><div class="movement-list">${movement.byKind.slice(0,4).map(item=>`<div><span>${escapeHTML(item.kind)}</span><b>${item.lengthKm.toLocaleString()} km</b></div>`).join('')}</div><p class="analysis-note">Mapped roads are not observed walking or traffic.</p>`:'Road analysis is unavailable for this capture.';
  }catch(error){if(state.data?.id===data.id){body.textContent=`Could not read the analysis: ${error.message}`;$('movementBody').textContent='Could not read the road summary. The captured layers remain available.';updateUrbanMetrics();}}
}
function mapFeatures(){
  massingGeneration++;
  if(state.previewLayer)map.removeLayer(state.previewLayer);if(state.massingLayer)map.removeLayer(state.massingLayer);state.massingLayer=null;
  if(!state.data)return;const selected=selectedLayers();const f=['landuse','water','roads','buildings','trees'].filter(k=>selected[k]).flatMap(k=>state.data.layers[k]||[]);
  state.previewLayer=L.geoJSON({type:'FeatureCollection',features:f},{pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:state.analysisMode==='trees'?6:4,color:'#387a58',fillColor:state.analysisMode==='trees'?'#46bf70':'#62a575',fillOpacity:.9}),style:feature=>{
    const p=feature.properties;
    if(state.analysisMode==='choice'){
      if(p.layer==='roads'){const score=state.roadChoice?.byId?.[p.id]||0;return {color:score>.65?'#d44f3f':score>.35?'#ed9660':score>.12?'#e7c873':'#626faf',weight:2+score*5,opacity:.92};}
      return {color:'#85918a',weight:.6,opacity:.16,fillOpacity:.02};
    }
    if(state.analysisMode==='roads')return p.layer==='roads'?{color:'#db704c',weight:4,opacity:.95}:{color:'#839287',weight:.7,opacity:.22,fillOpacity:.06};
    if(state.analysisMode==='trees')return p.layer==='trees'?{color:'#16653d',fillColor:'#46bf70',radius:6,fillOpacity:1}:{color:'#839287',weight:.7,opacity:.2,fillOpacity:.04};
    if(state.analysisMode==='landuse'){
      if(p.layer==='landuse'){const kind=String(p.kind||'').toLowerCase(),fill=/residen|housing/.test(kind)?'#e5bb8b':/commercial|retail|business/.test(kind)?'#e9a7a2':/industrial|manufactur/.test(kind)?'#baa3c4':/park|green|forest|recreation|garden/.test(kind)?'#90bc91':/school|education|hospital|civic|institution/.test(kind)?'#a5b9d5':'#c0c5b2';return {color:fill,fillColor:fill,weight:1.1,opacity:.9,fillOpacity:.55};}
      return {color:'#849288',weight:.6,opacity:.3,fillOpacity:.04};
    }
    if(state.analysisMode==='evidence'){
      if(p.layer==='buildings'){
        const color={recorded:'#327755',floor_estimate:'#d49b50',unknown:'#a6b0ac'}[evidenceKind(p)];
        return {color:state.mapStyle==='satellite'?'#fff':color,weight:1.2,fillColor:color,fillOpacity:.76};
      }
      return {color:'#73827a',weight:1,opacity:.35,fillOpacity:.07};
    }
    if(p.layer==='landuse')return {color:'#a29576',weight:.8,fillColor:'#c5b792',fillOpacity:.25};
    if(p.layer==='roads')return {color:state.mapStyle==='satellite'?'#f5deb1':'#ae7859',weight:2.5,opacity:.85};
    if(p.layer==='water')return {color:'#5d919a',weight:1.5,fillColor:'#6babb7',fillOpacity:.5};
    return {color:state.mapStyle==='satellite'?'#f7f8eb':'#41634d',weight:1,fillColor:heightFor(p).method==='scenario'?'#dc975b':'#557b61',fillOpacity:state.mapStyle==='satellite'?.47:.35};
  },onEachFeature:(feature,layer)=>layer.on('click',()=>{
    const p=feature.properties,h=heightFor(p),kind=p.kind||'Mapped feature';dialog('Feature details',`<p><strong>${escapeHTML(kind)}</strong> · ${escapeHTML(p.id)}</p><p>Source: ${escapeHTML(p.source||'Unknown')}${p.source_datasets?.length?` · ${escapeHTML(p.source_datasets.join(', '))}`:''}. ${h.value!==null?`Height: ${h.value} m (${h.method.replace('_',' ')}).`:'No recorded or estimated height.'}${p.confidence!=null?` Model confidence: ${escapeHTML(p.confidence)}.`:''}</p><p>Early design reference. Verify this feature before relying on it.</p>`);
  })}).addTo(map);
  if(state.massing)drawMassing();
}
function escapeHTML(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
let massingGeneration=0;
function drawMassing(){
  const generation=++massingGeneration;
  if(state.massingLayer)map.removeLayer(state.massingLayer);state.massingLayer=L.layerGroup().addTo(map);
  if(!state.data||!selectedLayers().buildings)return;
  const layer=state.massingLayer,renderer=L.canvas({padding:.25}),bounds=map.getBounds().pad(.1);
  const buildings=state.data.layers.buildings.filter(f=>{
    const ring=f.geometry?.coordinates?.[0];if(!ring||ring.length<4)return false;
    let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
    for(const [lng,lat] of ring){west=Math.min(west,lng);east=Math.max(east,lng);south=Math.min(south,lat);north=Math.max(north,lat);}
    return west<=bounds.getEast()&&east>=bounds.getWest()&&south<=bounds.getNorth()&&north>=bounds.getSouth();
  });
  let cursor=0,extruded=0,flat=0;
  function batch(){
    if(generation!==massingGeneration||!state.massing||layer!==state.massingLayer)return;
    const end=Math.min(cursor+100,buildings.length);
    for(;cursor<end;cursor++){
      const f=buildings[cursor],h=heightFor(f.properties),coords=f.geometry.coordinates[0];
      if(!(h.value>0)){flat++;continue;} // The footprint remains visible in the base layer.
      const shift=Math.min(26,h.value*(map.getZoom()/17)*.58),base=coords.map(([lng,lat])=>L.latLng(lat,lng));
      const top=base.map(p=>map.layerPointToLatLng(map.latLngToLayerPoint(p).subtract([shift*.38,shift])));
      for(let i=0;i<base.length-1;i++)L.polygon([base[i],base[i+1],top[i+1],top[i]],{renderer,color:'#273f31',weight:.5,fillColor:'#263a31',fillOpacity:.6,interactive:false}).addTo(layer);
      L.polygon(top,{renderer,color:'#f4f3dc',weight:.8,fillColor:h.method==='scenario'?'#e6a05d':h.method==='recorded'?'#9ac9a1':'#b3c3ab',fillOpacity:.9,interactive:false}).addTo(layer);
      extruded++;
    }
    if(cursor<buildings.length)requestAnimationFrame(batch);
    else notice(`${extruded.toLocaleString()} visible buildings extruded · ${flat.toLocaleString()} without heights shown as flat footprints. Pan to render other buildings.`);
  }
  requestAnimationFrame(batch);
}
async function cancelExtraction(){
  const id=state.currentJob;state.currentJob=null;state.activeRequest=null;
  state.requestController?.abort();state.requestController=null;
  $('fetchProgress').classList.add('hidden');$('capturePaused').classList.add('hidden');$('fetchData').disabled=false;$('editArea').disabled=false;
  state.captureStatus=state.data?'complete':'canceled';updateCaptureAction();
  if(id)try{await fetch(`/api/jobs/${id}`,{method:'DELETE'});}catch{}
}
async function pauseExtraction(){
  if(!state.currentJob)return;
  $('pauseFetch').disabled=true;
  try{
    const response=await fetch(`/api/jobs/${state.currentJob}/pause`,{method:'POST'});
    if(!response.ok)throw new Error('Could not pause this capture.');
    $('fetchProgressText').textContent='Pausing after the current request stops…';
  }catch(error){notice(error.message);$('pauseFetch').disabled=false;}
}
function acceptResult(data){
  state.choiceToken++;state.roadChoice=null;state.choicePromise=null;illustration.scenePose=null;
  state.data=data;state.currentJob=data.id;state.captureStatus='complete';updateCaptureAction();$('capturePaused').classList.add('hidden');
  $('buildingCount').textContent=data.counts.buildings.toLocaleString();$('roadCount').textContent=data.counts.roads.toLocaleString();$('waterCount').textContent=data.counts.water.toLocaleString();$('landuseCount').textContent=data.counts.landuse.toLocaleString();$('treeCount').textContent=(data.counts.trees||0).toLocaleString();$('totalCount').textContent=Object.values(data.counts).reduce((a,b)=>a+b,0).toLocaleString();$('retrievedDate').textContent=new Date(data.retrievedAt).toLocaleDateString();
  $('show3D').disabled=false;showStage('results');focusStudy('form');mapFeatures();updateSceneSummary();updateUrbanMetrics();void loadInsights(data);void refreshTerrain();notice(data.treeLookupError?'Other layers are ready. Tree lookup timed out; you can still review your own aerial image.':'Mapped context is ready. Inspect features and height methods.');
  state.choicePromise=calculateRoadChoice(data);
}
async function calculateRoadChoice(data){
  const token=++state.choiceToken;
  state.roadChoice={status:'loading'};renderAnalysisCatalog();$('choiceDetails').textContent='Calculating mapped road graph…';
  try{
    const {localRoadChoice}=await import('./network-choice.js');
    const result=await localRoadChoice(data.layers.roads||[]);
    if(token!==state.choiceToken||state.data?.id!==data.id)return;
    result.byId=Object.fromEntries((data.layers.roads||[]).map((feature,i)=>[feature.properties?.id,result.scores?.[i]||0]));
    state.roadChoice=result;renderAnalysisCatalog();updateUrbanMetrics();document.querySelector('[data-graphic="choice"]').disabled=result.status!=='ready';
    $('choiceDetails').innerHTML=result.status==='ready'?`<strong>${result.segments.toLocaleString()} links · ${result.nodes.toLocaleString()} junctions</strong><span>800 m · ${result.origins} sampled origins</span><p>Red marks more sampled shortest routes; blue marks fewer. Length-weighted mapped-road proxy, not angular choice or observed footfall; mapping errors affect results.</p>`:`<strong>Network choice unavailable</strong><p>${escapeHTML(result.reason||'Road graph could not be analysed.')}</p>`;
    if(state.analysisMode==='choice'){mapFeatures();if(state.view==='3d')void renderWorkspaceScene();}
  }catch(error){if(token===state.choiceToken){state.roadChoice={status:'error',reason:error.message};$('choiceDetails').textContent='Network calculation could not finish. The mapped streets remain available.';renderAnalysisCatalog();}}
}
function terrainLabel(terrain){
  state.terrain=terrain;
  updateUrbanMetrics();
  const note=$('terrainStatus'),exportNote=$('terrainExportNote'),button=$('addTerrain');
  if(terrain.status==='complete'){
    const m=terrain.metadata;note.textContent=`Terrain ready · ${m.width} × ${m.height} cells · ${m.pixelSizeMeters.toFixed(1)} m output spacing. Source: ${m.sourceTiles.join(', ')||'mixed DEM'}. This spacing is not ground accuracy.`;
    exportNote.textContent='↗ Terrain GeoTIFF · float32 EPSG:3857 (included in ZIP)';
    button.textContent='Terrain ready ✓';button.disabled=true;
  }else if(terrain.status==='running'){
    note.textContent=`Fetching terrain tiles · ${terrain.completed} / ${terrain.total}. Keep this page open to receive the result.`;
    button.textContent='Fetching terrain…';button.disabled=true;
  }else{
    note.textContent=terrain.status==='error'?`${terrain.error} Map data remains available; retry terrain separately.`:'Optional bare-earth terrain. Source and limits will be included in the package.';
    exportNote.textContent='Terrain GeoTIFF appears here after you fetch it from the results step.';
    button.textContent=terrain.status==='error'?'Retry terrain ↗':'Fetch terrain GeoTIFF ↗';button.disabled=false;
  }
  if(state.view==='3d'&&terrain.status==='complete')void renderWorkspaceScene();
  updateSceneSummary();
}
async function refreshTerrain(){
  if(!state.currentJob)return;
  const id=state.currentJob;
  try{const response=await fetch(`/api/jobs/${id}/terrain`);if(!response.ok)return;
    const terrain=await response.json();if(id!==state.currentJob)return;terrainLabel(terrain);
    if(terrain.status==='running')void pollTerrain(id);
  }catch{}
}
async function pollTerrain(id){
  if(state.terrainPoll)return;state.terrainPoll=true;
  try{for(let n=0;n<400&&id===state.currentJob;n++){
    await new Promise(resolve=>setTimeout(resolve,1500));
    const response=await fetch(`/api/jobs/${id}/terrain`);const terrain=await response.json();
    if(!response.ok)throw new Error(terrain.error||'Terrain status unavailable.');
    if(id!==state.currentJob)return;terrainLabel(terrain);
    if(terrain.status!=='running'){if(terrain.status==='complete')notice('Terrain GeoTIFF is ready and will be included in the ZIP.');return;}
  }}catch(error){if(id===state.currentJob){terrainLabel({status:'error',error:error.message});}}
  finally{state.terrainPoll=false;}
}
async function addTerrain(){
  if(!state.currentJob||state.terrain?.status==='running'||state.terrain?.status==='complete')return;
  $('addTerrain').disabled=true;
  try{const response=await fetch(`/api/jobs/${state.currentJob}/terrain`,{method:'POST'});
    const terrain=await response.json();if(!response.ok)throw new Error(terrain.error||'Terrain request failed.');
    terrainLabel(terrain);if(terrain.status==='running')void pollTerrain(state.currentJob);
  }catch(error){terrainLabel({status:'error',error:error.message});}
}
function showWorkspaceView(view){
  if(view==='3d'&&!state.data){notice('Capture a site before opening the 3D view.');return;}
  state.view=view;state.sceneToken++;
  state.scenePose=state.sceneDispose?.getView?.()||state.scenePose;
  state.sceneDispose?.();state.sceneDispose=null;
  $('sceneDock').classList.toggle('hidden',view!=='3d');workspace.classList.toggle('scene-active',view==='3d');
  if(view==='3d'){
    collapseSitePanel(true);
    workspace.classList.remove('panel-expanded','scene-info-open');
    $('panelExpand').setAttribute('aria-expanded','false');$('panelExpand').textContent='Expand study ↑';
    $('sceneInfoToggle').setAttribute('aria-expanded','false');
    document.querySelector('.panel-body').scrollTop=0;
    if(!state.scenePose)$('sceneNote').textContent='Fitting your captured site…';
  }
  for(const [id,value] of [['showMap','map'],['show3D','3d']]){$(id).classList.toggle('active',view===value);$(id).setAttribute('aria-pressed',String(view===value));}
  if(view==='3d')void renderWorkspaceScene();else map?.invalidateSize();
}
async function renderWorkspaceScene(){
  if(state.view!=='3d'||!state.data)return;
  const token=++state.sceneToken,id=state.data.id;
  state.scenePose=state.sceneDispose?.getView?.()||state.scenePose;
  state.sceneDispose?.();state.sceneDispose=null;
  $('sceneCanvas').replaceChildren();
  const visible={buildings:$('sceneBuildings').checked,roads:$('sceneRoads').checked,water:$('sceneWater').checked,landuse:$('sceneLanduse').checked,trees:$('sceneTrees').checked};
  const terrain=state.terrain?.status==='complete'?state.terrain.preview:null;
  $('sceneContours').disabled=!terrain;$('reliefScale').disabled=!terrain;
  $('contourInterval').textContent=terrain?'calculating…':'needs terrain';
  const m=state.terrain?.metadata;
  $('terrainEvidence').textContent=terrain&&m?`DEM ${m.elevationMinMeters.toFixed(1)}–${m.elevationMaxMeters.toFixed(1)} m · ${m.pixelSizeMeters.toFixed(1)} m output grid. Source accuracy varies; the layered cut is illustrative.`:'No DEM yet · level site base.';
  $('terrainPoint').hidden=!terrain;
  updateSceneSummary();
  const total=state.data.layers.buildings.length;
  $('sceneNote').textContent=`${total.toLocaleString()} captured footprints · ${terrain?'terrain':'level site base'} · preparing model…`;
  updateSceneMetrics();
  try{
    const {showScene}=await import('./scene3d.js');
    if(token!==state.sceneToken||state.view!=='3d'||state.data?.id!==id)return;
    const buildings=state.data.layers.buildings.map(f=>{const height=heightFor(f.properties);return {...f,height:height.value,method:height.method};});
    state.sceneDispose=showScene($('sceneCanvas'),{polygon:state.polygon,buildings,
      roads:state.data.layers.roads,water:state.data.layers.water,landuse:state.data.layers.landuse,trees:state.data.layers.trees||[],
      terrain,mode:state.analysisMode,roadScores:state.roadChoice?.scores,reliefScale:Number($('reliefScale').value),visibility:{...visible,contours:$('sceneContours').checked},
      onProgress:({drawn,processed,skipped})=>{if(token===state.sceneToken)$('sceneNote').textContent=`${drawn.toLocaleString()} of ${total.toLocaleString()} footprints drawn${processed<total?' · building model…':''}${skipped?` · ${skipped} invalid geometries excluded`:''} · ${terrain?'DEM terrain':'level site base'}`;},
      onTerrainInfo:interval=>{if(token===state.sceneToken)$('contourInterval').textContent=interval?`${interval} m interval`:'no elevation range';},
      onSelect:feature=>{if(token===state.sceneToken)inspectSceneBuilding(feature);},onGroundSelect:p=>{if(token===state.sceneToken)$('terrainPoint').textContent=`DEM sample ${p.elevation.toFixed(1)} m · ${p.latitude.toFixed(5)}°, ${p.longitude.toFixed(5)}°`;}});
    if(state.scenePose)state.sceneDispose.setView(state.scenePose);
  }catch(error){if(token===state.sceneToken){showWorkspaceView('map');notice(`3D view could not start: ${error.message}`);}}
}
function mergeStudyLayers(target,incoming){
  for(const name of ['buildings','roads','water','landuse','trees']){
    const seen=new Set(target[name].map(feature=>feature.properties.id));
    for(const feature of incoming[name]||[])if(!seen.has(feature.properties.id)){seen.add(feature.properties.id);target[name].push(feature);}
  }
}
async function hostedTiles(plan,token){
  const polygonKey=JSON.stringify(state.polygon);
  let study=state.partialStudy;
  if(!study||study.polygonKey!==polygonKey||study.total!==plan.total){
    study={polygonKey,id:plan.id,mode:'hosted-demo',total:plan.total,areaKm2:plan.areaKm2,completed:0,layers:{buildings:[],roads:[],water:[],landuse:[],trees:[]},providers:[]};
    state.partialStudy=study;
  }
  while(study.completed<study.total){
    if(state.activeRequest!==token)return null;
    const index=study.completed;
    $('fetchProgressText').textContent=`Map requests ${index} / ${study.total} complete`;
    status('Capturing site data');
    state.requestController=new AbortController();
    const response=await fetch('/api/tile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({polygon:state.polygon,index}),signal:state.requestController.signal});
    state.requestController=null;
    const result=await response.json();
    if(!response.ok)throw new Error((result.error||`Map request ${index+1} failed.`)+(result.retryAfterSeconds?` Wait about ${result.retryAfterSeconds} seconds before retrying.`:''));
    if(state.activeRequest!==token)return null;
    if(result.index!==index||result.total!==study.total)throw new Error('The map request returned a mismatched tile. Retry this tile.');
    mergeStudyLayers(study.layers,result.layers);
    if(result.provider&&!study.providers.includes(result.provider))study.providers.push(result.provider);
    study.completed++;study.retrievedAt=!study.retrievedAt||result.retrievedAt<study.retrievedAt?result.retrievedAt:study.retrievedAt;
    if(result.cacheStatus==='stale')study.cacheStatus='stale';
    study.cacheAgeSeconds=Math.max(study.cacheAgeSeconds||0,result.cacheAgeSeconds||0);
    if(Object.values(study.layers).reduce((sum,list)=>sum+list.length,0)>15000){state.partialStudy=null;throw new Error('This area exceeds the phone demo’s 15,000 feature limit. Use the local app or a dedicated data provider.');}
    $('fetchProgressText').textContent=`Map requests ${study.completed} / ${study.total} complete`;
    if(study.completed<study.total)await new Promise(resolve=>setTimeout(resolve,1200));
  }
  const counts=Object.fromEntries(Object.entries(study.layers).map(([name,list])=>[name,list.length]));
  state.partialStudy=null;
  return {...study,status:'complete',counts};
}
function captureProgress(completed,total,message){
  const percent=total?Math.round(Math.max(0,Math.min(total,completed))/total*100):0;
  $('fetchProgressText').textContent=message;
  $('fetchProgressFill').style.width=`${percent}%`;
  $('fetchProgressBar').style.setProperty('--walker-position',`${percent}%`);
  $('fetchProgressBar').setAttribute('aria-valuenow',String(percent));
  $('fetchProgressBar').setAttribute('aria-valuetext',message);
}
function updateCaptureAction(){
  const selected=Object.entries(selectedLayers()).filter(([,on])=>on).map(([name])=>name);
  const unchanged=state.data&&JSON.stringify(state.data.selectedLayers)===JSON.stringify(selected);
  const label=state.captureStatus==='paused'?'Resume capture':state.captureStatus==='error'?'Retry capture':state.data?(unchanged?'View captured study':'Capture updated layers'):'Capture selected layers';
  $('fetchData').textContent=label;
}
async function fetchData(){
  if(!state.polygon||state.activeRequest)return;
  const selected=Object.entries(selectedLayers()).filter(([,on])=>on).map(([name])=>name);
  if(!selected.length){notice('Select at least one layer to capture.');return;}
  if(state.data&&state.captureStatus==='complete'&&JSON.stringify(state.data.selectedLayers)===JSON.stringify(selected)){showStage('results');return;}
  const token=Symbol('extraction');state.activeRequest=token;
  const b=$('fetchData');b.disabled=true;$('editArea').disabled=true;b.textContent='Finding site data…';state.captureStatus='queued';
  $('fetchError').classList.add('hidden');$('capturePaused').classList.add('hidden');
  $('fetchProgress').classList.remove('hidden');$('pauseFetch').disabled=false;captureProgress(0,Object.values(selectedLayers()).filter(Boolean).length,'Preparing site requests…');status('Fetching mapped features');
  try{
    let job=null;
    if(state.currentJob){
      const previous=await fetch(`/api/jobs/${state.currentJob}`);
      if(previous.ok){
        job=await previous.json();
        if(JSON.stringify(job.polygon)!==JSON.stringify(state.polygon)||JSON.stringify(job.selectedLayers)!==JSON.stringify(selected)){
          await fetch(`/api/jobs/${state.currentJob}`,{method:'DELETE'});job=null;state.currentJob=null;
        }else if(job.status==='paused'||job.status==='error'){
          const resumed=await fetch(`/api/jobs/${job.id}/resume`,{method:'POST'});
          job=await resumed.json();if(!resumed.ok)throw new Error(job.error||'Could not resume capture.');
        }
      }else{job=null;state.currentJob=null;}
    }
    if(!job){
      state.requestController=new AbortController();
      const response=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({polygon:state.polygon,layers:selectedLayers()}),signal:state.requestController.signal});
      state.requestController=null;
      job=await response.json();if(!response.ok)throw new Error(job.error||'Could not start extraction.');
    }
    // A Mac LaunchAgent may still be running the previous server after files change.
    if(!job.status&&job.layers&&job.counts)job={...job,status:'complete',completed:1,total:1};
    if(state.activeRequest!==token)return;
    if(job.mode==='hosted-demo'&&job.status==='planned')job=await hostedTiles(job,token);
    else if(job.id){state.currentJob=job.id;}
    let pollFailures=0;
    while(job&&['queued','running','pausing'].includes(job.status)){
      if(state.activeRequest!==token)return;
      state.captureStatus=job.status;
      captureProgress(job.completed,job.total,`${job.status==='pausing'?'Pausing':'Capturing '+(job.currentLayer||'data')} · ${job.completed} of ${job.total} layers ready`);
      status('Capturing site data');
      await new Promise(resolve=>setTimeout(resolve,1400));
      if(state.activeRequest!==token)return;
      let progress;
      try{progress=await fetch(`/api/jobs/${job.id}`);pollFailures=0;}
      catch(error){if(++pollFailures<3)continue;throw error;}
      job=await progress.json();if(!progress.ok)throw new Error(job.error||'This extraction expired.');
    }
    if(state.activeRequest!==token)return;
    if(job?.status==='paused'){
      state.captureStatus='paused';$('capturePausedText').textContent=`${job.completed} of ${job.total} layers ready in this session. Resume to fetch the remaining layers.`;
      $('capturePaused').classList.remove('hidden');status('Capture paused · progress in memory');return;
    }
    if(!job||job.status!=='complete')throw new Error((job?.error||'Extraction stopped.')+(job?.retryAfterSeconds?` Wait about ${job.retryAfterSeconds} seconds before retrying.`:''));
    captureProgress(job.total,job.total,'All selected layers ready');acceptResult(job);
  }catch(err){if(state.activeRequest===token){state.captureStatus='error';
    let message=err instanceof TypeError?'The local site service is offline. Start it again, then retry your boundary.':/^(Load failed|Failed to fetch)$/i.test(err.message)||/returned (?:500|502|503|504|52[0-4])|fetch failed/i.test(err.message)?'The map data provider did not return this layer. Try again. Your boundary remains in this page.':err.message;
    $('fetchErrorText').textContent=state.currentJob?`${message} Retry can resume any layers already loaded in this session.`:message;$('fetchError').classList.remove('hidden');status('Data provider unavailable · boundary remains on this page');
  }}
  finally{if(state.activeRequest===token){state.activeRequest=null;b.disabled=false;$('editArea').disabled=false;updateCaptureAction();$('fetchProgress').classList.add('hidden');}}
}
async function download(){if(!state.data)return;const b=$('downloadPackage');b.disabled=true;b.innerHTML='Preparing files <span>···</span>';
  try{const payload={id:state.data.id,scenario:scenario(),layers:selectedLayers()};if(state.data.mode==='hosted-demo')Object.assign(payload,{polygon:state.polygon,sourceLayers:state.data.layers,retrievedAt:state.data.retrievedAt,total:state.data.total,providers:state.data.providers||[],cacheStatus:state.data.cacheStatus||'live',cacheAgeSeconds:state.data.cacheAgeSeconds||0});
    const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!response.ok){const e=await response.json();throw new Error(e.error||'Export failed.');}
    let blob=await response.blob();const proposals=(state.data.layers.trees||[]).filter(f=>f.properties.source==='Imagery proposal');
    if(proposals.length&&payload.layers.trees){const [{addBrowserTrees},geometry]=await Promise.all([import('./tree-export.js'),import('/geometry.js')]);blob=await addBrowserTrees(blob,proposals,state.polygon,payload,state.terrain?.status==='complete'?state.terrain.preview:null,geometry);}
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='site-context-package.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Your site package downloaded. Check the README before using it.');
  }catch(err){notice(err.message);}finally{b.disabled=false;b.innerHTML='Download site package <span>↓</span>';}
}
const illustration={labels:[],colors:{},svg:'',url:null,renderTimer:null,zoom:1,graphicMode:'context',mode:'map',sceneDispose:null,scenePose:null,sceneToken:0,studyId:null,hiddenBuildings:new Set(),selectedBuilding:null,buildingPaths:[],maxHeight:0};
function updateIllustrationZoom(){
  const board=$('illustrationArtboard'),preview=$('illustrationPreview');
  const fit=Math.min((board.clientWidth-44)/1200,(board.clientHeight-44)/850);
  if(fit<=0)return;
  preview.style.width=`${Math.round(1200*fit*illustration.zoom)}px`;
  preview.style.height=`${Math.round(850*fit*illustration.zoom)}px`;
  $('illustrationZoomLevel').textContent=`${Math.round(illustration.zoom*100)}%`;
}
function zoomIllustration(factor){illustration.zoom=Math.max(.5,Math.min(6,illustration.zoom*factor));updateIllustrationZoom();}
function illustrationOptions(){
  const sources=Object.values(state.data?.sources||{}).join(' ');
  const source=sources.includes('Overture')||state.data?.release?'© Overture Maps Foundation and contributors':sources.includes('OpenStreetMap')?'© OpenStreetMap contributors':'Captured GIS data — see package provenance';
  const terrain=state.terrain?.status==='complete'?' · terrain: Mapzen Terrain Tiles':'';
  return {preset:$('illustrationPreset').value,graphicMode:illustration.graphicMode,view:$('illustrationView').value,relief:Number($('illustrationRelief').value),strokeWeight:Number($('illustrationStroke').value),
    colors:illustration.colors,labels:illustration.labels,attribution:source+terrain,roadScores:state.roadChoice?.byId||null,colorByType:$('illustrationType').checked,outline:$('illustrationOutline').checked,fixedMaxHeight:illustration.maxHeight,
    visible:Object.fromEntries([...document.querySelectorAll('[data-illustration-layer]')].map(input=>[input.dataset.illustrationLayer,input.checked]))};
}
function illustrationLayers(){
  const layers=state.data.layers;
  return {...layers,buildings:(layers.buildings||[]).flatMap((feature,index)=>{if(illustration.hiddenBuildings.has(index))return [];const height=heightFor(feature.properties);return [{...feature,_illustrationIndex:index,properties:{...feature.properties,height_m:height.value,height_method:height.method}}];})};
}
function updateIllustrationBuildingControls(){
  const total=state.data?.layers.buildings?.length||0,removed=illustration.hiddenBuildings.size,selected=illustration.selectedBuilding;
  $('illustrationBuildingNumber').max=String(total);
  $('illustrationBuildingNumber').value=selected===null?'':String(selected+1);
  $('illustrationBuildingStatus').textContent=selected===null?`${(total-removed).toLocaleString()} shown · ${removed.toLocaleString()} removed from this graphic`:`Building ${selected+1} selected · ${removed.toLocaleString()} removed from this graphic`;
  $('illustrationRemoveBuilding').disabled=selected===null;
  $('illustrationRestoreBuildings').disabled=removed===0;
  $('illustrationSummary').textContent=`${(total-removed).toLocaleString()} buildings shown · ${removed.toLocaleString()} removed`;
}
function selectIllustrationBuilding(index){
  const total=state.data?.layers.buildings?.length||0;
  illustration.selectedBuilding=Number.isInteger(index)&&index>=0&&index<total&&!illustration.hiddenBuildings.has(index)?index:null;
  updateIllustrationBuildingControls();
  if(illustration.mode==='map')refreshIllustration();
}
function exportIllustrationSvg(){
  return makeIllustration({polygon:state.polygon,layers:illustrationLayers(),terrain:state.terrain?.status==='complete'?state.terrain.preview:null,options:{...illustrationOptions(),selectedBuildingIndex:null}});
}
function refreshIllustration(){
  if(!$('illustrationDialog').open||!state.data||!state.polygon)return;
  if(illustration.mode==='scheme'){void renderIllustrationScene();return;}
  clearTimeout(illustration.renderTimer);$('illustrationBusy').hidden=false;
  illustration.renderTimer=setTimeout(()=>{
    if(illustration.mode!=='map'||!$('illustrationDialog').open)return;
    try{
      const buildingPaths=[];
      illustration.svg=makeIllustration({polygon:state.polygon,layers:illustrationLayers(),terrain:state.terrain?.status==='complete'?state.terrain.preview:null,options:{...illustrationOptions(),selectedBuildingIndex:illustration.selectedBuilding,onBuildingPath:(index,d)=>buildingPaths.push({index,path:new Path2D(d)})}});
      const next=URL.createObjectURL(new Blob([illustration.svg],{type:'image/svg+xml;charset=utf-8'}));
      $('illustrationPreview').onload=()=>{if(illustration.url)URL.revokeObjectURL(illustration.url);illustration.url=next;illustration.buildingPaths=buildingPaths;if(illustration.mode==='map')$('illustrationBusy').hidden=true;};
      $('illustrationPreview').onerror=()=>{if(illustration.mode==='map')$('illustrationBusy').textContent='Drawing could not render. Try a different view.';};
      $('illustrationPreview').src=next;
    }catch(error){$('illustrationBusy').textContent=`Drawing failed: ${error.message}`;}
  },40);
}
async function renderIllustrationScene(){
  if(illustration.mode!=='scheme'||!$('illustrationDialog').open||!state.data)return;
  const token=++illustration.sceneToken,id=state.data.id;
  illustration.scenePose=illustration.sceneDispose?.getView?.()||illustration.scenePose;
  illustration.sceneDispose?.();illustration.sceneDispose=null;
  const target=$('illustrationSceneCanvas');target.replaceChildren();
  const terrain=state.terrain?.status==='complete'?state.terrain.preview:null;
  const layers=illustrationOptions().visible,buildings=illustrationLayers().buildings.map(feature=>({...feature,height:feature.properties.height_m,method:feature.properties.height_method}));
  $('illustrationBusy').hidden=false;$('illustrationBusy').textContent='Preparing the 3D scheme…';
  try{
    const {showScene}=await import('./scene3d.js');
    if(token!==illustration.sceneToken||!$('illustrationDialog').open||illustration.mode!=='scheme'||state.data?.id!==id)return;
    const model=showScene(target,{polygon:state.polygon,buildings,roads:state.data.layers.roads,water:state.data.layers.water,
      landuse:state.data.layers.landuse,trees:state.data.layers.trees||[],terrain,mode:illustration.graphicMode==='landuse'?'landuse':illustration.graphicMode==='choice'?'choice':'context',roadScores:state.roadChoice?.scores,
      reliefScale:Number($('illustrationRelief').value),visibility:{...layers,contours:layers.contours&&!!terrain},editorFrame:true,
      onSelect:feature=>selectIllustrationBuilding(feature._illustrationIndex),
      onProgress:({processed})=>{if(token===illustration.sceneToken){$('illustrationBusy').hidden=processed>=buildings.length;if(processed<buildings.length)$('illustrationBusy').textContent=`Building model · ${processed.toLocaleString()} / ${buildings.length.toLocaleString()}`;}}});
    if(token!==illustration.sceneToken){model();return;}
    illustration.sceneDispose=model;
    if(illustration.scenePose)model.setView(illustration.scenePose);
    model.setStyle($('sceneStyle').value);model.setExplode(Number($('sceneExplode').value)/100);
    document.querySelectorAll('[data-scene-offset]').forEach(input=>model.setLayerOffset(input.dataset.sceneOffset,Number(input.value)/100));
  }catch(error){if(token===illustration.sceneToken){$('illustrationBusy').hidden=false;$('illustrationBusy').textContent=`3D scheme could not render: ${error.message}`;}}
}
function setGraphicView(mode){
  if(!$('illustrationDialog').open)return;
  const scheme=mode==='scheme';illustration.mode=scheme?'scheme':'map';
  for(const [id,value] of [['graphicMap','map'],['graphicScheme','scheme']]){$(id).classList.toggle('selected',illustration.mode===value);$(id).setAttribute('aria-pressed',String(illustration.mode===value));}
  $('illustrationDialog').classList.toggle('illustration-mode-3d',scheme);
  $('illustrationPreview').classList.toggle('hidden',scheme);$('illustrationSceneFrame').classList.toggle('hidden',!scheme);
  $('graphic3DControls').classList.toggle('hidden',!scheme);$('illustrationPNG').textContent=scheme?'Download 3D PNG ↓':'Download PNG · 4800 × 3400 ↓';
  $('illustrationHint').textContent=scheme?'Tap a building to select · drag to orbit':'Tap a building to select · type a label to place it';
  $('graphicExportNote').textContent=scheme?'The editor frame is excluded from the PNG. Dotted layer guides remain.':'The SVG remains editable; the PNG is 4800 × 3400.';
  if(scheme){clearTimeout(illustration.renderTimer);void renderIllustrationScene();}
  else{illustration.sceneToken++;illustration.sceneDispose?.();illustration.sceneDispose=null;updateIllustrationZoom();refreshIllustration();}
}
function syncIllustrationPalette(){
  const preset=illustrationPresets[$('illustrationPreset').value];
  document.querySelectorAll('[data-illustration-color]').forEach(input=>{input.value=illustration.colors[input.dataset.illustrationColor]||preset[input.dataset.illustrationColor];});
}
function illustrationLabelList(){
  const list=$('illustrationLabelList');list.replaceChildren();
  illustration.labels.forEach((label,index)=>{const item=document.createElement('li'),name=document.createElement('span'),remove=document.createElement('button');name.textContent=label.text;remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label',`Remove ${label.text}`);remove.onclick=()=>{illustration.labels.splice(index,1);illustrationLabelList();refreshIllustration();};item.append(name,remove);list.append(item);});
}
function openIllustration(){
  if(!state.data||!state.polygon)return notice('Capture site data first.');
  if(illustration.studyId!==state.data.id){illustration.studyId=state.data.id;illustration.hiddenBuildings.clear();illustration.selectedBuilding=null;illustration.maxHeight=(state.data.layers.buildings||[]).reduce((max,feature)=>Math.max(max,heightFor(feature.properties).value||0),0);}
  const count=state.data.layers.buildings?.length||0,terrain=state.terrain?.status==='complete';
  $('illustrationEvidence').textContent=`${count.toLocaleString()} captured buildings. ${terrain?'The terrain mesh comes from your downloaded DEM; contours are generated from its preview grid.':'Fetch terrain in the results panel to add relief and contours.'} Missing heights stay flat unless conceptual massing is enabled.`;
  illustration.zoom=1;$('illustrationDialog').showModal();updateIllustrationBuildingControls();syncIllustrationPalette();setGraphicView('map');
}
function applyGraphicPreset(mode){
  const configs={
    masterplan:{style:'Clay',view:'NW',type:true,outline:true,layers:['buildings','roads','water','landuse','trees','contours','boundary'],description:'Massing, land use, water, mapped trees and streets. Building colours use mapped type where present.'},
    figure:{style:'Ink',view:'Top',type:false,outline:false,layers:['buildings','boundary'],description:'Figure–ground from complete mapped building footprints. Missing buildings remain missing.'},
    nolli:{style:'Ink',view:'Top',type:false,outline:false,layers:['buildings','roads','boundary'],description:'Nolli inspired: a building mask and mapped streets. Public interiors and access have not been surveyed.'},
    landuse:{style:'Studio',view:'Top',type:true,outline:true,layers:['buildings','roads','water','landuse','trees','boundary'],description:'Categorised mapped land use and building type. Unclassified features use neutral colours.'},
    streets:{style:'Cobalt',view:'Top',type:false,outline:false,layers:['buildings','roads','boundary'],description:'Street classes are drawn with different line weights. This does not show pedestrian footfall or traffic volume.'},
    choice:{style:'Cobalt',view:'Top',type:false,outline:false,layers:['buildings','roads','boundary'],description:'Relative 800 m local road-network choice, using sampled length weighted shortest paths; this is not measured footfall or angular syntax.'}
  };const config=configs[mode];if(!config)return;
  illustration.graphicMode=mode;illustration.colors={};$('illustrationPreset').value=config.style;$('illustrationView').value=config.view;
  $('sceneStyle').value=config.style==='Clay'?'clay':'context';
  $('illustrationType').checked=config.type;$('illustrationOutline').checked=config.outline;
  document.querySelectorAll('[data-illustration-layer]').forEach(input=>input.checked=config.layers.includes(input.dataset.illustrationLayer));
  document.querySelectorAll('[data-graphic]').forEach(button=>{button.classList.toggle('selected',button.dataset.graphic===mode);button.setAttribute('aria-pressed',String(button.dataset.graphic===mode));});
  const missing=config.layers.filter(name=>name!=='contours'&&name!=='boundary'&&!(state.data?.layers?.[name]?.length));
  $('graphicDescription').textContent=config.description+(missing.length?` No captured ${missing.join(', ')} features for this area.`:'');
  syncIllustrationPalette();refreshIllustration();
}
function downloadIllustrationFile(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function setupIllustration(){
  $('openIllustration').onclick=$('exportIllustration').onclick=openIllustration;
  $('sceneGraphics').onclick=()=>{openIllustration();setGraphicView('scheme');};
  $('graphicMap').onclick=()=>setGraphicView('map');$('graphicScheme').onclick=()=>setGraphicView('scheme');
  document.querySelectorAll('[data-graphic]').forEach(button=>button.onclick=()=>applyGraphicPreset(button.dataset.graphic));
  $('closeIllustration').onclick=()=>$('illustrationDialog').close();
  $('illustrationArtboard').addEventListener('wheel',event=>{if(illustration.mode!=='map')return;event.preventDefault();zoomIllustration(event.deltaY<0?1.15:1/1.15);},{passive:false});
  $('illustrationZoomIn').onclick=()=>zoomIllustration(1.25);
  $('illustrationZoomOut').onclick=()=>zoomIllustration(1/1.25);
  $('illustrationZoomReset').onclick=()=>{illustration.zoom=1;updateIllustrationZoom();};
  window.addEventListener('resize',()=>{if($('illustrationDialog').open)updateIllustrationZoom();});
  $('illustrationDialog').addEventListener('close',()=>{clearTimeout(illustration.renderTimer);illustration.sceneToken++;illustration.sceneDispose?.();illustration.sceneDispose=null;if(illustration.url){URL.revokeObjectURL(illustration.url);illustration.url=null;}$('illustrationPreview').removeAttribute('src');});
  $('sceneStyle').onchange=()=>illustration.sceneDispose?.setStyle($('sceneStyle').value);
  $('sceneExplode').oninput=()=>{$('explodeValue').textContent=`${$('sceneExplode').value}%`;illustration.sceneDispose?.setExplode(Number($('sceneExplode').value)/100);};
  document.querySelectorAll('[data-scene-offset]').forEach(input=>input.oninput=()=>illustration.sceneDispose?.setLayerOffset(input.dataset.sceneOffset,Number(input.value)/100));
  $('illustrationPreset').onchange=()=>{illustration.colors={};syncIllustrationPalette();refreshIllustration();};
  for(const id of ['illustrationView','illustrationType','illustrationOutline'])$(id).onchange=refreshIllustration;
  $('illustrationRelief').oninput=()=>{$('illustrationReliefValue').textContent=`${$('illustrationRelief').value}×`;refreshIllustration();};
  $('illustrationStroke').oninput=()=>{$('illustrationStrokeValue').textContent=`${$('illustrationStroke').value}×`;refreshIllustration();};
  document.querySelectorAll('[data-illustration-layer]').forEach(input=>input.onchange=()=>{if(illustration.mode==='scheme')illustration.sceneDispose?.setLayerVisible(input.dataset.illustrationLayer,input.checked);else refreshIllustration();});
  document.querySelectorAll('[data-illustration-color]').forEach(input=>input.oninput=()=>{illustration.colors[input.dataset.illustrationColor]=input.value;refreshIllustration();});
  $('illustrationReset').onclick=()=>{illustration.colors={};syncIllustrationPalette();refreshIllustration();};
  $('illustrationBuildingNumber').onchange=event=>{const index=Number(event.currentTarget.value)-1;if(Number.isInteger(index)&&index>=0&&index<(state.data?.layers.buildings?.length||0)){if(illustration.hiddenBuildings.has(index))notice('That building has already been removed from this graphic.');else selectIllustrationBuilding(index);}else selectIllustrationBuilding(null);};
  $('illustrationRemoveBuilding').onclick=()=>{const index=illustration.selectedBuilding;if(index===null)return;illustration.hiddenBuildings.add(index);illustration.selectedBuilding=null;updateIllustrationBuildingControls();refreshIllustration();notice(`Building ${index+1} removed from this graphic. Restore all is available below.`);};
  $('illustrationRestoreBuildings').onclick=()=>{illustration.hiddenBuildings.clear();illustration.selectedBuilding=null;updateIllustrationBuildingControls();refreshIllustration();notice('All buildings restored to this graphic.');};
  $('illustrationPreview').onclick=event=>{
    const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*1200,y=(event.clientY-rect.top)/rect.height*850;
    const label=$('illustrationLabel').value.trim();
    if(label){illustration.labels.push({text:label,x:x/1200,y:y/850,color:$('illustrationLabelColor').value});$('illustrationLabel').value='';illustrationLabelList();refreshIllustration();return;}
    const context=document.createElement('canvas').getContext('2d');const hit=context?[...illustration.buildingPaths].reverse().find(item=>context.isPointInPath(item.path,x,y)):null;
    selectIllustrationBuilding(hit?.index??null);
  };
  $('illustrationSVG').onclick=()=>{if(illustration.svg)downloadIllustrationFile(new Blob([exportIllustrationSvg()],{type:'image/svg+xml;charset=utf-8'}),'site-illustration.svg');};
  $('illustrationPNG').onclick=async()=>{if(illustration.mode==='scheme'){
    const model=illustration.sceneDispose;if(!model?.capturePng)return notice('The 3D scheme is still loading. Try again shortly.');
    const button=$('illustrationPNG');button.disabled=true;button.textContent='Rendering 3D PNG…';
    try{const blob=await model.capturePng({caption:`3D scheme · ${areaFromPoints(state.points).toFixed(2)} km² · ${illustration.graphicMode==='context'?'Site context':illustration.graphicMode}`,source:illustrationOptions().attribution});downloadIllustrationFile(blob,'site-graphic-3d.png');}
    catch(error){notice(`Could not export the 3D scheme: ${error.message}`);}finally{button.disabled=false;button.textContent='Download 3D PNG ↓';}
    return;
  }
    if(!illustration.svg)return;const img=new Image(),url=URL.createObjectURL(new Blob([exportIllustrationSvg()],{type:'image/svg+xml;charset=utf-8'})),button=$('illustrationPNG');button.disabled=true;
    img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=4800;canvas.height=3400;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');ctx.drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{URL.revokeObjectURL(url);button.disabled=false;if(blob)downloadIllustrationFile(blob,'site-illustration-4800x3400.png');else notice('PNG conversion failed. Download the SVG instead.');},'image/png');}catch{URL.revokeObjectURL(url);button.disabled=false;notice('This device cannot render a 4800 × 3400 PNG. Download the SVG instead.');}};
    img.onerror=()=>{URL.revokeObjectURL(url);button.disabled=false;notice('PNG conversion failed. Download the SVG instead.');};img.src=url;};
}
const urban={map:null,boundary:null,features:null,scene:null,sceneToken:0,pose:null,data:null,choice:null,report:null,reach:null,visibility:null,viewpoint:null,pickView:false,view:'map',camera:'orbit',lens:'evidence',token:0};
const urbanVisible=()=>Object.fromEntries([...document.querySelectorAll('[data-urban-visible]')].map(input=>[input.dataset.urbanVisible,input.checked&&!input.disabled]));
function syncUrbanLayers(){
  const captured=new Set(urban.data?.selectedLayers||Object.keys(urban.data?.layers||{}));
  for(const input of document.querySelectorAll('[data-urban-visible]')){
    const available=captured.has(input.dataset.urbanVisible);input.disabled=!available;
    input.checked=available;input.parentElement.title=available?'Toggle captured layer':'This layer was not selected for the site capture';
  }
}
function bindUrbanStudy(){
  const data=state.data,polygon=state.polygon;if(!data||!polygon)return;
  const token=++urban.token;
  urban.data=data;urban.boundary=polygon;urban.viewpoint=null;urban.pickView=false;urban.pose=null;
  urban.features?.remove();urban.features=null;urban.scene?.();urban.scene=null;urban.sceneToken++;
  urban.report=urbanGeometry(data.layers,polygon);
  urban.reach=localWalkReach(data.layers.roads||[],polygon);
  urban.reach.byId=Object.fromEntries((data.layers.roads||[]).map((f,i)=>[f.properties?.id,urban.reach.minutesByRoad[i]]));
  urban.visibility=planSightlines(data.layers.buildings||[],polygon);
  urban.viewpoint=urban.visibility.status==='ready'?urban.visibility.viewpoint:null;
  urban.choice=state.roadChoice?.status==='loading'?null:state.roadChoice;
  syncUrbanLayers();
  urban.map.eachLayer(layer=>{if(layer._urbanBoundary)urban.map.removeLayer(layer);});
  const outline=L.geoJSON({type:'Feature',geometry:polygon},{style:{color:'#ef9c54',weight:3,fillColor:'#f4a363',fillOpacity:.13,interactive:false}}).addTo(urban.map);outline._urbanBoundary=true;
  urban.map.fitBounds(outline.getBounds().pad(.16));
  const size=(urban.report.areaM2/1e6).toLocaleString(undefined,{maximumFractionDigits:3});
  $('urbanAreaLabel').textContent=`Your captured polygon · ${size} km² · ${data.counts.buildings.toLocaleString()} buildings · ${data.counts.roads.toLocaleString()} roads`;
  $('urbanProgress').textContent=`Showing ${Object.values(data.counts||{}).reduce((a,b)=>a+b,0).toLocaleString()} captured features · select an analysis layer.`;
  showUrbanLens(urban.lens);
  if(!urban.choice&&data.layers.roads?.length)void (async()=>{
    try{
      let result;
      if(state.choicePromise){await state.choicePromise;result=state.roadChoice;}
      else {const {localRoadChoice}=await import('./network-choice.js');result=await localRoadChoice(data.layers.roads);
        result.byId=Object.fromEntries(data.layers.roads.map((f,i)=>[f.properties?.id,result.scores?.[i]||0]));}
      if(token!==urban.token||urban.data!==data)return;
      urban.choice=result;
      if(urban.lens==='choice')showUrbanLens('choice');
    }catch(error){if(token===urban.token)$('urbanProgress').textContent='Network choice could not calculate: '+error.message;}
  })();
}
function showUrbanLens(lens){
  urban.lens=lens;
  const target=document.querySelector(`[data-urban-tool="${lens}"]`),layer={evidence:'buildings',density:'buildings',visibility:'buildings',landuse:'landuse',publicspaces:'landuse',roads:'roads',choice:'roads',reach:'roads',cycling:'roads',trees:'trees'}[lens];
  const captured=new Set(urban.data?.selectedLayers||Object.keys(urban.data?.layers||{}));
  const needs=target?.dataset.urbanNeeds||(layer&&!captured.has(layer)?`The ${layer} layer was not selected in your site capture. Return to Data, select it and fetch the site again.`:null);
  $('urbanSelectionStatus').textContent=needs?`${target?.textContent?.trim()||'Analysis'}: ${needs}`:'';
  document.querySelectorAll('[data-urban-tool]').forEach(button=>{const selected=button.dataset.urbanTool===lens;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
  if(!urban.data){$('urbanLegend').textContent='Draw and capture a site polygon in the first workspace to explore this layer.';return;}
  const report=urban.report||{},choice=urban.choice,reach=urban.reach,visibility=urban.visibility;
  const f=n=>Number(n||0).toLocaleString(undefined,{maximumFractionDigits:1});
  const info={
    evidence:['Building height evidence',`${f(report.recordedCount)} source heights`,`${f(report.floorEstimateCount)} floor estimates · ${f(report.buildingCount)} footprints. Heights not present in the source remain unknown.`, 'Overture buildings · height and floor attributes'],
    density:['Mapped built coverage',`${f(report.coveragePercent)}% of site`,`${f(report.builtM2/10000)} ha of building footprints clipped to your drawn polygon. Overlapping polygons are not dissolved; no floor-area ratio is inferred.`, 'Captured building geometry · approximate planar area'],
    visibility:['Plan sightlines',visibility?.status==='ready'?`${f(visibility.openPercent)}% open directions`:'No valid viewpoint',visibility?.status==='ready'?`${f(visibility.meanDistanceM)} m mean unobstructed distance · ${visibility.unblocked} of ${visibility.rays} rays reach the boundary. Choose another viewpoint to inspect a street.`:visibility?.reason||'Choose an open mapped point.', 'Overture building footprints · planar ray intersections'],
    landuse:['Mapped land use',`${f(urban.data.counts?.landuse)} areas`,'Polygons colour the mapped land-use categories. Unclassified or missing areas remain unclassified.','Overture land-use geometry'],
    publicspaces:['Mapped green-space candidates',`${f(report.greenM2/10000)} ha`,`${f(report.greenCount)} mapped green or recreation areas intersect your boundary. Access, legal ownership and canopy are not verified.`,'Captured land-use categories · clipped polygons'],
    roads:['Mapped streets',`${f(report.roadM/1000)} km`,`${f(report.roadCount)} road features intersect your boundary. Centreline length is clipped to the polygon; it is not vehicle flow.`, 'Captured road and path geometry'],
    choice:['Local network choice',choice?.status==='ready'?`${f(choice.segments)} links`:'Graph pending',choice?.status==='ready'?`800 m local shortest paths from ${choice.origins} sampled junctions. Red is used more, blue less. This is a relative road graph proxy, not angular R800 or footfall.`:choice?.reason||'Calculating the road graph.','Overture streets · browser network calculation'],
    reach:['Mapped walking reach',reach?.status==='ready'?`${f(reach.roadsWithin10)} roads ≤10 min`:'No connected route',reach?.status==='ready'?`${f(reach.roadsWithin5)} road features ≤5 min · ${f(reach.roadsWithin15)} ≤15 min. Assumes 1.25 m/s from a point inside your boundary; stops at its edge and is not a true isochrone polygon.`:reach?.reason||'A connected road graph is needed.','Captured road centreline graph · assumed walking speed'],
    cycling:['Mapped cycle routes',`${f(report.cycleM/1000)} km`,`${f(report.cycleCount)} explicitly cycle-tagged routes. Missing mapped routes do not mean cycling is impossible; no cycling demand is inferred.`,'Overture road class · explicit cycle tags'],
    trees:['Tree points',`${f(urban.data.counts?.trees)} points`,'Mapped trees and any browser-reviewed imagery candidates remain incomplete; this is not measured canopy cover.','Captured OpenStreetMap points and labelled imagery proposals, if added']
  };
  const item=info[lens];
  if(needs){$('urbanLegend').innerHTML=`<strong>${escapeHTML(target.textContent.trim())}</strong><span class="urban-needs">Needs additional data</span><p>${escapeHTML(needs)}</p><small>No result or invented estimate is shown.</small>`;}
  else if(item){$('urbanLegend').innerHTML=`<strong>${item[0]}</strong><b>${item[1]}</b><p>${item[2]}</p><small>Source / method: ${item[3]}</small>${lens==='visibility'?'<button type="button" id="urbanPickView">Choose viewpoint on the 2D map ↗</button>':''}`;
    if(lens==='visibility')$('urbanPickView').onclick=()=>{urban.pickView=true;setUrbanView('map');$('urbanProgress').textContent='Click an open point inside your boundary to recalculate sightlines.';};}
  if(urban.features)urban.map.removeLayer(urban.features);
  const visible=urbanVisible(),all=['landuse','water','roads','buildings','trees'].filter(key=>visible[key]).flatMap(key=>urban.data.layers[key]||[]),roads=urban.data.layers.roads||[];
  const graphic=L.geoJSON({type:'FeatureCollection',features:all},{pointToLayer:(feature,ll)=>L.circleMarker(ll,{radius:lens==='trees'?5:3,color:'#297a4d',fillColor:'#4bbd69',fillOpacity:.92,bubblingMouseEvents:false}),style:feature=>{
    const p=feature.properties||{},type=p.layer,quiet={color:'#82908b',weight:.6,opacity:.19,fillOpacity:.025};
    if(lens==='visibility')return type==='buildings'?{color:'#1b3131',weight:.8,fillColor:'#394e50',fillOpacity:.74}:quiet;
    if(lens==='density')return type==='buildings'?{color:'#1c2d30',weight:.5,fillColor:'#34454a',fillOpacity:.95}:quiet;
    if(lens==='choice'){
      if(type!=='roads')return quiet;const score=choice?.byId?.[p.id]||0;
      return {color:score>.65?'#db513e':score>.35?'#ec9362':score>.12?'#e7c873':'#626faf',weight:2+score*5,opacity:.95};
    }
    if(lens==='reach'){
      if(type!=='roads')return quiet;const minutes=reach?.byId?.[p.id];
      return {color:minutes==null?'#64717a':minutes<=5?'#2db77c':minutes<=10?'#eabf62':'#8f79be',weight:minutes==null?1:4,opacity:minutes==null ? .35 : .95};
    }
    if(lens==='cycling')return type==='roads'&&isMappedCycle(feature)?{color:'#41ba8c',weight:5,opacity:1}:quiet;
    if(lens==='roads')return type==='roads'?{color:'#e08556',weight:3,opacity:.95}:quiet;
    if(lens==='trees')return type==='trees'?{color:'#43bd77',fillColor:'#38a365',fillOpacity:.95}:quiet;
    if(lens==='publicspaces')return type==='landuse'&&isMappedGreen(feature)?{color:'#28a070',fillColor:'#49c18a',fillOpacity:.68,weight:1.5}:quiet;
    if(lens==='landuse'&&type==='landuse'){
      const kind=String(p.kind||'').toLowerCase(),fill=/park|garden|green/.test(kind)?'#6cbb7e':/residen|housing/.test(kind)?'#d7ad82':/commercial|retail/.test(kind)?'#d68e88':'#8da6b3';
      return {color:fill,fillColor:fill,fillOpacity:.57,weight:1};
    }
    if(lens==='evidence'&&type==='buildings'){const fill={recorded:'#3d8c58',floor_estimate:'#dbab62',unknown:'#a8b1aa'}[evidenceKind(p)];return {color:'#f9f8f1',weight:.5,fillColor:fill,fillOpacity:.86};}
    return {color:type==='water'?'#6796bd':'#788e82',weight:type==='roads'?1.8:.8,opacity:.65,fillColor:type==='water'?'#6796bd':'#a0af9e',fillOpacity:.3};
  },onEachFeature:(feature,layer)=>{layer.options.bubblingMouseEvents=false;layer.on('click',event=>{if(urban.pickView){handleUrbanMapClick(event.latlng);setTimeout(()=>layer.closePopup(),0);}});layer.bindPopup(`<strong>${escapeHTML(feature.properties?.kind||feature.properties?.layer||'Mapped feature')}</strong><br>${escapeHTML(feature.properties?.source||'Source documented in capture')}<br>${escapeHTML(feature.properties?.id||'')}`);}});
  urban.features=L.layerGroup().addTo(urban.map);graphic.addTo(urban.features);
  if(lens==='visibility'&&visibility?.status==='ready'){
    L.geoJSON({type:'FeatureCollection',features:visibility.lines},{style:feature=>({color:feature.properties.blocked?'#f39569':'#36d3a0',weight:2.5,opacity:.87,dashArray:feature.properties.blocked?'3 4':null,interactive:false}),onEachFeature:(_,layer)=>{layer.options.bubblingMouseEvents=false;}}).addTo(urban.features);
    L.circleMarker([visibility.viewpoint[1],visibility.viewpoint[0]],{radius:7,color:'#fafcf7',fillColor:'#ed9067',weight:2,fillOpacity:1,interactive:false}).addTo(urban.features);
  }
  if(urban.view==='3d')void renderUrbanScene();
}
async function renderUrbanScene(){
  if(urban.view!=='3d'||!urban.data||!$('urbanDialog').open)return;
  const token=++urban.sceneToken;urban.pose=urban.scene?.getView?.()||urban.pose;urban.scene?.();urban.scene=null;
  $('urbanScene').replaceChildren();$('urbanProgress').textContent='Preparing mapped site model…';
  try{const {showScene}=await import('./scene3d.js');if(token!==urban.sceneToken||!$('urbanDialog').open)return;
    const roads=urban.data.layers.roads,mode=urban.lens==='reach'?'reach':urban.lens==='cycling'?'cycling':urban.lens==='publicspaces'?'publicspaces':urban.lens,
      scores=mode==='choice'?urban.choice?.scores:mode==='reach'?roads.map(f=>{const minutes=urban.reach?.byId?.[f.properties?.id];return minutes==null?0:minutes<=5?1:minutes<=10 ? .6 : .3;}):mode==='cycling'?roads.map(f=>isMappedCycle(f)?1:0):null;
    urban.scene=showScene($('urbanScene'),{polygon:urban.boundary,buildings:urban.data.layers.buildings.map(f=>{const h=heightFor(f.properties);return {...f,height:h.value,method:h.method};}),roads,water:urban.data.layers.water,landuse:urban.data.layers.landuse,trees:urban.data.layers.trees,terrain:state.terrain?.status==='complete'?state.terrain.preview:null,mode,roadScores:scores,sightlines:mode==='visibility'?urban.visibility?.lines||[]:[],visibility:urbanVisible(),onProgress:({processed})=>{if(token===urban.sceneToken)$('urbanProgress').textContent=processed.toLocaleString()+' of '+urban.data.layers.buildings.length.toLocaleString()+' footprints shown · '+(state.terrain?.status==='complete'?'DEM terrain':'level site base');}});
    if(urban.pose)urban.scene.setView(urban.pose);else urban.scene.preset(urban.camera);
  }catch(error){if(token===urban.sceneToken)$('urbanProgress').textContent=`Could not display 3D: ${error.message}`;}
}
function setUrbanView(view){urban.view=view;const is3D=view==='3d';$('urbanMap').classList.toggle('hidden',is3D);$('urbanScene').classList.toggle('hidden',!is3D);$('urbanMapTab').classList.toggle('selected',!is3D);$('urban3DTab').classList.toggle('selected',is3D);$('urbanCamera').classList.toggle('hidden',!is3D);if(is3D)void renderUrbanScene();else{urban.sceneToken++;urban.pose=urban.scene?.getView?.()||urban.pose;urban.scene?.();urban.scene=null;setTimeout(()=>urban.map?.invalidateSize(),0);}}
function urbanDrawing(){
  if(!urban.data)return null;
  const mode=urban.lens==='choice'?'choice':urban.lens==='reach'?'reach':urban.lens==='cycling'?'cycling':urban.lens==='visibility'?'visibility':urban.lens==='landuse'||urban.lens==='publicspaces'?'landuse':urban.lens==='roads'?'streets':urban.lens==='density'?'figure':'masterplan';
  const reach=urban.reach?.byId||{},scores=mode==='reach'?Object.fromEntries(Object.entries(reach).map(([id,minutes])=>[id,minutes==null?0:minutes<=5?1:minutes<=10 ? .6 : .3])):mode==='cycling'?Object.fromEntries(urban.data.layers.roads.map(f=>[f.properties?.id,isMappedCycle(f)?1:0])):urban.choice?.byId||{};
  return makeIllustration({polygon:urban.boundary,terrain:state.terrain?.status==='complete'?state.terrain.preview:null,layers:{...urban.data.layers,landuse:urban.lens==='publicspaces'?urban.data.layers.landuse.filter(isMappedGreen):urban.data.layers.landuse,buildings:urban.data.layers.buildings.map(f=>({...f,properties:{...f.properties,height_m:f.properties?.height_m||null}}))},options:{preset:urban.lens==='choice'?'Night':'Studio',graphicMode:mode,view:'Top',strokeWeight:1.5,roadScores:scores,sightlines:urban.lens==='visibility'?urban.visibility?.lines:[],attribution:'© Overture Maps Foundation and contributors · OpenStreetMap contributors',visible:{...urbanVisible(),boundary:true}}});
}
async function exportUrban(format){
  if(!urban.data)return $('urbanProgress').textContent='Capture a site polygon before exporting.';
  if(document.querySelector(`[data-urban-tool="${urban.lens}"]`)?.dataset.urbanNeeds&&format!=='geojson')return $('urbanProgress').textContent='This analysis needs additional data. Select a mapped layer for the image export.';
  if(format==='geojson'){
    const features=['buildings','roads','water','landuse','trees'].filter(name=>urbanVisible()[name]).flatMap(name=>(urban.data.layers[name]||[]).map(feature=>({...feature,properties:{...feature.properties,
      ...(name==='roads'?{mapped_cycle_route:isMappedCycle(feature),walking_reach_minutes:urban.reach?.status==='ready'?urban.reach.byId?.[feature.properties?.id]??null:null,...(urban.choice?.status==='ready'?{network_choice_relative:urban.choice.byId?.[feature.properties?.id]||0}:{})}:{}),
      ...(name==='buildings'?{footprint_area_in_site_m2:Math.round(clippedArea(feature,urban.boundary))}:{}),
      ...(name==='landuse'?{mapped_green_candidate:isMappedGreen(feature)}:{})}})));
    if(urban.visibility?.status==='ready')features.push(...urban.visibility.lines);
    const geojson={type:'FeatureCollection',features,metadata:{tool:'kaniks-studio urban analysis',aoi:urban.boundary,area_km2:Number((urban.report.areaM2/1e6).toFixed(4)),sources:urban.data.sources||{},release:urban.data.release||null,retrieved_at:urban.data.retrievedAt||null,geometry_summary:urban.report,network_choice_method:urban.choice?.status==='ready'?urban.choice.method:null,walking_reach_method:urban.reach?.status==='ready'?urban.reach.method:null,visibility_method:urban.visibility?.status==='ready'?urban.visibility.method:null,limitations:['Mapped features may extend outside the drawn boundary; this is not a cadastral clip.','Network choice is a relative road graph proxy; it is not angular segment choice or measured footfall.']}};
    downloadIllustrationFile(new Blob([JSON.stringify(geojson,null,2)],{type:'application/geo+json'}),'urban-analysis-site.geojson');return;
  }
  if(format==='png'&&urban.view==='3d'){
    if(!urban.scene?.capturePng)return $('urbanProgress').textContent='The 3D model is still loading.';
    try{downloadIllustrationFile(await urban.scene.capturePng({caption:`${(urban.report.areaM2/1e6).toFixed(2)} km² · ${urban.lens} · mapped context`,source:'© Overture Maps Foundation and contributors · OpenStreetMap contributors'}),'urban-analysis-3d.png');}
    catch(error){$('urbanProgress').textContent=`PNG could not render: ${error.message}`;}return;
  }
  const svg=urbanDrawing();if(!svg)return;
  if(format==='svg'){downloadIllustrationFile(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}),'urban-analysis-map.svg');return;}
  const img=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  img.onload=()=>{try{const canvas=document.createElement('canvas');canvas.width=3600;canvas.height=2550;canvas.getContext('2d').drawImage(img,0,0,3600,2550);canvas.toBlob(blob=>{URL.revokeObjectURL(url);if(blob)downloadIllustrationFile(blob,'urban-analysis-map.png');else $('urbanProgress').textContent='PNG encoding failed. Download the SVG instead.';},'image/png');}catch(error){URL.revokeObjectURL(url);$('urbanProgress').textContent=`PNG could not render: ${error.message}`;}};
  img.onerror=()=>{URL.revokeObjectURL(url);$('urbanProgress').textContent='Map image could not render. Download the SVG instead.';};img.src=url;
}
function handleUrbanMapClick(latlng){
  if(!urban.pickView||!urban.data)return;
  const selected=[latlng.lng,latlng.lat];
  if(!pointInsidePolygon(selected,urban.boundary)){$('urbanProgress').textContent='Choose a viewpoint inside your drawn boundary.';return;}
  urban.pickView=false;urban.viewpoint=selected;
  urban.visibility=planSightlines(urban.data.layers.buildings||[],urban.boundary,{viewpoint:selected});
  showUrbanLens('visibility');
  $('urbanProgress').textContent=urban.visibility.status==='ready'?'Sightlines updated from your chosen viewpoint.':urban.visibility.reason;
}
function setupUrban(){
  $('navUrban').onclick=()=>{
    $('treeReview').classList.add('hidden');
    if(!state.data||!state.polygon){notice('Draw a polygon and fetch its data first. Urban Analysis will use that capture.');if(state.polygon)showStage('data');return;}
    const panel=$('urbanDialog');panel.showModal();
    if(!urban.map){urban.map=L.map('urbanMap',{zoomControl:false,preferCanvas:true}).setView(map.getCenter(),15);
      L.control.zoom({position:'bottomright'}).addTo(urban.map);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(urban.map);
      urban.map.on('click',event=>handleUrbanMapClick(event.latlng));
    }
    if(urban.data!==state.data||urban.boundary!==state.polygon)bindUrbanStudy();
    else showUrbanLens(urban.lens);
    setUrbanView('map');setTimeout(()=>urban.map.invalidateSize(),50);
  };
  $('urbanClose').onclick=()=>$('urbanDialog').close();
  $('urbanReviewTrees').onclick=()=>{
    $('urbanDialog').close();
    openWorkspace('results',false);
    if(state.view==='3d')showWorkspaceView('map');
    $('treeReview').classList.remove('hidden');
    $('treeImage').focus();
  };
  $('urbanDialog').addEventListener('close',()=>{urban.sceneToken++;urban.pose=urban.scene?.getView?.()||urban.pose;urban.scene?.();urban.scene=null;urban.pickView=false;if(!$('illustrationDialog').open)$('navUrban').focus({preventScroll:true});});
  $('urbanMapTab').onclick=()=>setUrbanView('map');$('urban3DTab').onclick=()=>setUrbanView('3d');
  $('urbanGraphics').onclick=()=>{if(!urban.data)return;$('urbanDialog').close();openIllustration();const preset={density:'figure',landuse:'landuse',publicspaces:'landuse',roads:'streets',choice:'choice'}[urban.lens]||'masterplan';applyGraphicPreset(preset);};
  for(const [id,view] of [['urbanOrbit','orbit'],['urbanIso','iso'],['urbanTop','plan']])$(id).onclick=()=>{
    urban.camera=view;urban.scene?.preset(view);urban.pose=urban.scene?.getView?.()||null;
    for(const [button,preset] of [['urbanOrbit','orbit'],['urbanIso','iso'],['urbanTop','plan']]){
      $(button).classList.toggle('selected',preset===view);$(button).setAttribute('aria-pressed',String(preset===view));
    }
  };
  for(const input of document.querySelectorAll('[data-urban-visible]'))input.onchange=()=>{
    if(urban.data)showUrbanLens(urban.lens);
  };
  $('urbanPng').onclick=()=>void exportUrban('png');$('urbanSvg').onclick=()=>void exportUrban('svg');
  $('urbanGeojson').onclick=()=>void exportUrban('geojson');
  document.querySelectorAll('[data-urban-tool]').forEach(button=>button.onclick=()=>showUrbanLens(button.dataset.urbanTool));
}
function watchForUpdates(){
  const shownVersion=document.querySelector('.app')?.dataset.appVersion;
  const check=async()=>{
    try{const response=await fetch('/api/health',{cache:'no-store'});if(!response.ok)return;
      const latest=await response.json();if(!latest.version||latest.version===shownVersion)return;
      if(!state.points.length&&!state.draftPoints.length&&!state.polygon&&!state.currentJob&&!state.activeRequest&&!$('urbanDialog').open){window.location.reload();return;}
      $('updateBanner').classList.remove('hidden');
    }catch{ /* A temporary local-service restart is not a reason to erase the active site. */ }
  };
  $('reloadUpdate').onclick=()=>window.location.reload();
  setTimeout(()=>void check(),1500);setInterval(()=>void check(),15000);window.addEventListener('focus',()=>void check());
}
function start(){
  if(!window.L){document.body.innerHTML='<div style="padding:2rem;font-family:var(--ui-font)">The map library could not load. Check your internet connection and reload.</div>';return;}
  map=L.map('map',{zoomControl:false,doubleClickZoom:false,preferCanvas:true}).setView(places.ahmedabad,15);tiles('graphite');showStage('area');
  setupIllustration();
  setupUrban();
  setupSiteNavigation();
  watchForUpdates();
  fetch('/api/config').then(r=>r.ok?r.json():null).then(config=>{
    state.providerKey=config?.maptilerKey||null;
    state.accountsAvailable=config?.accountsAvailable!==false;
    if(!state.accountsAvailable){
      for(const id of ['heroAccount','pricingAccount','topAccount'])$(id).classList.add('hidden');
      document.querySelector('.pricing-note p').textContent='Account creation is paused on this temporary free demo. Studies remain session-only, so download the site package before closing the browser.';
      if(location.hash==='#/account')openContentPage('pricing',{history:false});
    }
    updateSourceNote();
  }).catch(()=>{updateSourceNote();});
  map.on('click',e=>addPoint(e.latlng));map.on('mousemove',e=>{$('cursorCoordinates').textContent=`${Math.abs(e.latlng.lat).toFixed(4)}° ${e.latlng.lat>=0?'N':'S'}, ${Math.abs(e.latlng.lng).toFixed(4)}° ${e.latlng.lng>=0?'E':'W'}`;});
  map.on('zoomend moveend',()=>{if(state.massing)drawMassing();});
  $('shapePolygon').onclick=()=>setDrawMode('polygon');$('shapeRectangle').onclick=()=>setDrawMode('rectangle');
  $('undoPoint').onclick=()=>{if(state.drawMode==='rectangle')state.draftPoints=state.rectangleHistory.pop()||[];else state.draftPoints.pop();updateDrawing();};
  $('clearArea').onclick=clearDraft;$('finishArea').onclick=finishArea;$('editArea').onclick=()=>beginBoundaryEdit();$('cancelAreaEdit').onclick=cancelBoundaryEdit;
  $('fetchData').onclick=fetchData;$('retryFetch').onclick=fetchData;$('resumeCapture').onclick=fetchData;$('pauseFetch').onclick=()=>{void pauseExtraction();};$('cancelFetch').onclick=()=>{void cancelExtraction();notice('Extraction stopped. Your boundary is ready to try again.');};
  ['Buildings','Roads','Water','Landuse','Trees'].forEach(x=>$(`layer${x}`).addEventListener('change',()=>{mapFeatures();updateCaptureAction();void updateCapturePlan();}));
  $('scenarioEnabled').onchange=()=>{$('scenarioFields').classList.toggle('hidden',!$('scenarioEnabled').checked);mapFeatures();if(state.view==='3d')void renderWorkspaceScene();};
  for(const id of ['heightMin','heightMax'])$(id).onchange=()=>{mapFeatures();if(state.view==='3d')void renderWorkspaceScene();};
  ['heightMin','heightMax'].forEach(id=>$(id).addEventListener('change',()=>{const s=scenario();if(s.min<2||s.max>150||s.max<s.min){notice('Choose a valid range from 2 to 150 metres.');return;}mapFeatures();}));
  $('view2D').onclick=()=>{state.massing=false;massingGeneration++;$('view2D').classList.add('selected');$('viewMassing').classList.remove('selected');mapFeatures();};
  $('mapContext').onclick=()=>showAnalysisMode('context');$('mapEvidence').onclick=()=>showAnalysisMode('evidence');
  $('viewMassing').onclick=()=>{state.massing=true;$('viewMassing').classList.add('selected');$('view2D').classList.remove('selected');mapFeatures();notice('Schematic massing preview. Download the DAE for a 3D model.');};
  $('open3D').onclick=$('show3D').onclick=()=>showWorkspaceView('3d');$('showMap').onclick=()=>showWorkspaceView('map');$('addTerrain').onclick=()=>{void addTerrain();};
  $('sceneFit').onclick=()=>{state.sceneDispose?.preset(state.scenePose?.mode||'iso');state.scenePose=state.sceneDispose?.getView?.()||null;};
  $('sceneFetchTerrain').onclick=()=>{void addTerrain();};$('sceneExport').onclick=()=>showStage('export');
  for(const [id,name] of [['sceneOrbit','orbit'],['sceneIso','iso'],['scenePlan','plan']])$(id).onclick=()=>{state.sceneDispose?.preset(name);state.scenePose=state.sceneDispose?.getView?.()||null;for(const [button,preset] of [['sceneOrbit','orbit'],['sceneIso','iso'],['scenePlan','plan']]){$(button).classList.toggle('active',preset===name);$(button).setAttribute('aria-pressed',String(preset===name));}};
  $('sceneInfoToggle').onclick=()=>{const open=workspace.classList.toggle('scene-info-open');$('sceneInfoToggle').setAttribute('aria-expanded',String(open));if(open)$('sceneInfo').scrollTop=0;};
  $('panelExpand').onclick=()=>{const open=workspace.classList.toggle('panel-expanded');if(open){workspace.classList.remove('scene-info-open');$('sceneInfoToggle').setAttribute('aria-expanded','false');}$('panelExpand').setAttribute('aria-expanded',String(open));$('panelExpand').textContent=open?'Collapse study ↓':'Expand study ↑';};
  $('mapRoads').onclick=()=>{if(state.view==='3d')showWorkspaceView('map');showAnalysisMode('roads');};
  $('mapChoice').onclick=()=>{if(state.roadChoice?.status!=='ready')return notice(state.roadChoice?.reason||'Calculate mapped road links first.');if(state.view==='3d')showWorkspaceView('map');showAnalysisMode('choice');};
  document.querySelectorAll('[data-urban]').forEach(b=>b.onclick=()=>showAnalysisMode(b.dataset.urban));
  $('urbanDownload').onclick=()=>{
    if(!state.data)return notice('Capture a site before downloading its analysis.');
    const data=state.data,trees=data.layers.trees||[],areaKm2=areaFromPoints(state.points);
    const analysis={schema:'kaniks-studio/urban-analysis/1',areaKm2,areaHa:Number((areaKm2*100).toFixed(2)),capturedAt:data.retrievedAt||null,release:data.release||null,sources:data.sources||{},buildings:{count:data.counts.buildings,method:'Full mapped footprints touching the boundary; not clipped to the site.',heightEvidence:state.insights?.heightEvidence||null,medianRecordedHeightM:state.insights?.recordedHeightMedianM??null},roads:state.insights?.movement||null,trees:{mappedOrProposedPoints:trees.length,imageryProposals:trees.filter(f=>f.properties?.source==='Imagery proposal').length,method:'Mapped OSM points and reviewed browser imagery proposals; not a complete tree census.'},terrain:state.terrain?.status==='complete'?state.terrain.metadata:null,unavailable:{carTraffic:'No observed traffic, origin–destination trips or calibrated road capacities.',residents:'No site-scale verified population data.',buildingAge:'No building-year source in this capture.',FAR:'Unreliable without complete floor area and clipped building footprints.'}};
    downloadIllustrationFile(new Blob([JSON.stringify(analysis,null,2)],{type:'application/json'}),'site-urban-analysis.json');
  };
  $('lensForm').onclick=()=>focusStudy('form');$('lensMovement').onclick=()=>focusStudy('movement');
  for(const [id,name] of [['sceneBuildings','buildings'],['sceneRoads','roads'],['sceneWater','water'],['sceneLanduse','landuse'],['sceneTrees','trees']])$(id).onchange=()=>state.sceneDispose?.setLayerVisible(name,$(id).checked);
  $('sceneContours').onchange=()=>state.sceneDispose?.setLayerVisible('contours',$('sceneContours').checked);
  $('reliefScale').oninput=()=>{$('reliefScaleLabel').textContent=`${$('reliefScale').value}×`;};
  $('reliefScale').onchange=()=>{if(state.view==='3d')void renderWorkspaceScene();};
  $('toExport').onclick=()=>showStage('export');$('backToData').onclick=()=>showStage('data');$('backToHeights').onclick=()=>{showStage('results');$('scenarioEnabled').scrollIntoView({block:'center'});$('scenarioEnabled').focus({preventScroll:true});};$('downloadPackage').onclick=download;
  document.querySelectorAll('[data-map-style]').forEach(b=>b.onclick=()=>{
    if(b.dataset.mapStyle==='illustrated'){
      if(!state.data||!state.polygon){openWorkspace(state.polygon?'data':'area',true);notice('Capture site layers to create an illustrated map.');return;}
      openIllustration();applyGraphicPreset('masterplan');setGraphicView('map');return;
    }
    if(tiles(b.dataset.mapStyle))mapFeatures();
  });
  $('makeDrawing').onclick=()=>{if(!state.data||!state.polygon){openWorkspace(state.polygon?'data':'area',true);notice('Capture site layers to make a drawing.');return;}openIllustration();applyGraphicPreset('masterplan');setGraphicView('map');};
  $('openMapSettings').onclick=satelliteSettings;
  $('zoomIn').onclick=()=>map.zoomIn();$('zoomOut').onclick=()=>map.zoomOut();$('resetBearing').onclick=()=>state.aoiLayer?map.fitBounds(state.aoiLayer.getBounds().pad(.3)):map.setView(places.ahmedabad,15);
  $('navCreate').onclick=()=>{beginBoundaryEdit(true);if(state.activeRequest)return;openWorkspace('area',true);notice(state.editingExisting?'Draw a new site. Cancel editing to return to the captured site.':'Choose a boundary shape, then click the map.');};
  $('navLayers').onclick=()=>{if(state.polygon){if(state.editingExisting)cancelBoundaryEdit();openWorkspace('data',true);}else{openWorkspace('area',true);notice('Draw a site boundary first.');}};
  $('navStudy').onclick=()=>{if(state.data){if(state.editingExisting)cancelBoundaryEdit();openWorkspace('results',true);}else{openWorkspace(state.polygon?'data':'area',true);notice('Find site data to open the study.');}};
  $('navExport').onclick=()=>{if(state.data){if(state.editingExisting)cancelBoundaryEdit();openWorkspace('export',true);}else{openWorkspace(state.polygon?'data':'area',true);notice('Find site data before exporting.');}};
  const help=()=>dialog('Your first site',`<p>1. Choose <strong>Free polygon</strong> to place and adjust dots, or <strong>Square / rectangle</strong> to place a square with one click and drag its four corners. Finish to use the boundary.</p><p>2. Choose buildings, roads and water, then fetch the available mapped data.</p><p>3. Edit a boundary safely: your old capture remains until you apply a change. A changed boundary requires a fresh data capture.</p><p>4. Inspect sources, explore a labelled height scenario, and download files. Verify geometry and scale before relying on it.</p>`);
  $('navHelp').onclick=$('topHelp').onclick=help;
  $('showSources').onclick=()=>{
    const entries=Object.entries(state.data?.sources||{}).map(([name,source])=>`<li><strong>${escapeHTML(name)}:</strong> ${escapeHTML(String(source))}</li>`).join('');
    dialog('Sources & limitations',`<p><strong>Data used in this capture</strong>${state.data?.release?` · release ${escapeHTML(state.data.release)}`:''}</p><ul>${entries||'<li>See the package provenance for the source of imported GIS features.</li>'}</ul><p>Terrain, when fetched, uses Mapzen Terrain Tiles with source credits in the exported manifest. Building footprints crossing the boundary remain whole; known heights can be missing or wrong, and conceptual heights are invented.</p><p><strong>India datasets to assess before adding new analyses:</strong> <a href="https://bhuvan-app1.nrsc.gov.in/2dresources/bhuvanstore2.php" target="_blank" rel="noopener">NRSC Bhuvan urban land use</a> (town coverage and dataset year vary); <a href="https://www.worldpop.org/methods/populations/" target="_blank" rel="noopener">WorldPop gridded population</a> (modelled estimates); <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener">ERA5 via Open-Meteo</a> (regional weather, unsuitable as site-scale wind observations). These datasets are not used in this capture. Traffic and footfall need locally calibrated observations.</p>`);
  };
  $('navSettings').onclick=satelliteSettings;
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&state.stage==='area'){if(state.editingExisting)cancelBoundaryEdit();else if(state.draftPoints.length)clearDraft();}
    if((e.key==='Backspace'||e.key==='Delete')&&state.stage==='area'&&state.draftPoints.length&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){
      e.preventDefault();$('undoPoint').click();
    }
  });
}
start();

let treeProposals=[],treeProposalLayer=null,treeProposalToken=0;
$('detectTrees').onclick=async()=>{const token=++treeProposalToken;try{
 const file=$('treeImage').files[0];if(!file||!$('treeImageAligned').checked||!state.polygon)throw Error('Choose an aligned image and confirm the bounding rectangle.');if(file.size>20_000_000)throw Error('Choose an image under 20 MB.');
 const bitmap=await createImageBitmap(file);if(token!==treeProposalToken||!state.polygon){bitmap.close();return;}const canvas=document.createElement('canvas');canvas.width=Math.min(768,bitmap.width);canvas.height=Math.max(1,Math.round(bitmap.height*canvas.width/bitmap.width));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 const ring=state.polygon.coordinates[0],xs=ring.map(p=>p[0]),ys=ring.map(p=>p[1]),bounds={west:Math.min(...xs),east:Math.max(...xs),south:Math.min(...ys),north:Math.max(...ys)};
 const [{proposeTrees},{pointInside}]=await Promise.all([import('./tree-detection.js'),import('/geometry.js')]);if(token!==treeProposalToken||$('treeReview').classList.contains('hidden'))return;treeProposals=proposeTrees(ctx.getImageData(0,0,canvas.width,canvas.height),bounds).filter(p=>pointInside(p,ring));treeProposalLayer?.remove();
 treeProposalLayer=L.layerGroup(treeProposals.map(p=>{const marker=L.circleMarker([p[1],p[0]],{radius:5,color:'#df772f',fillOpacity:.7}).bindTooltip('Click to remove false match');marker.on('click',()=>{treeProposals=treeProposals.filter(point=>point!==p);treeProposalLayer.removeLayer(marker);$('treeProposalStatus').textContent=`${treeProposals.length} candidates retained. Review every dot before adding.`;$('acceptTreeProposals').hidden=!treeProposals.length;});return marker;})).addTo(map);
 $('treeProposalStatus').textContent=`${treeProposals.length} green canopy candidates inside your area. Click orange dots to remove false matches.`;$('acceptTreeProposals').hidden=!treeProposals.length;$('clearTreeProposals').hidden=!treeProposals.length;
 }catch(e){if(token===treeProposalToken)$('treeProposalStatus').textContent=e.message;}};
$('clearTreeProposals').onclick=()=>{treeProposalToken++;treeProposals=[];treeProposalLayer?.remove();treeProposalLayer=null;$('acceptTreeProposals').hidden=true;$('clearTreeProposals').hidden=true;$('treeProposalStatus').textContent='Discarded.';};
$('acceptTreeProposals').onclick=()=>{if(!state.data||!treeProposals.length)return;
 const mapped=(state.data.layers.trees||[]).filter(f=>f.properties.source!=='Imagery proposal');
 state.data.layers.trees=[...mapped,...treeProposals.map((point,i)=>({type:'Feature',geometry:{type:'Point',coordinates:point},properties:{id:`image-proposal-${i}`,source:'Imagery proposal',layer:'trees',kind:'Possible tree',evidence:'green canopy candidate; manual review required',diameter_crown_m:null}}))];
 state.data.counts.trees=state.data.layers.trees.length;$('treeCount').textContent=String(state.data.counts.trees);$('totalCount').textContent=Object.values(state.data.counts).reduce((a,b)=>a+b,0).toLocaleString();
 treeProposalLayer?.remove();treeProposalLayer=null;treeProposals=[];$('acceptTreeProposals').hidden=true;$('clearTreeProposals').hidden=true;mapFeatures();if(state.view==='3d')void renderWorkspaceScene();
 updateUrbanMetrics();
 $('treeProposalStatus').textContent='Reviewed suggestions are in the tree layer and will be added to your download in this browser.';};
$('treeImage').onchange=()=>{if($('treeImageAligned').checked)$('detectTrees').click();};
$('treeImageAligned').onchange=()=>{if($('treeImageAligned').checked&&$('treeImage').files.length)$('detectTrees').click();};
$('treeReviewClose').onclick=()=>{$('clearTreeProposals').click();$('treeReview').classList.add('hidden');};
$('treeBackAnalysis').onclick=()=>{$('clearTreeProposals').click();$('treeReview').classList.add('hidden');$('navUrban').click();};
