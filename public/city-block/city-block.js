import { buildings, selectableIds, createScene, palette } from './scene.js';

const destinations = {
  'west-residence': {number:'01',title:'About',detail:'The thinking behind the tool'},
  'north-tower': {number:'02',title:'Open site tool',detail:'Map · study · draw'},
  'east-tower': {number:'03',title:'Current study',detail:'Return to this session’s work'}
};
const vertexSource = `attribute vec3 a_position;attribute vec3 a_normal;attribute vec3 a_color;attribute float a_id;attribute float a_motion;attribute float a_unlit;attribute float a_glow;attribute float a_ground;
uniform float u_yaw;uniform float u_pitch;uniform float u_scale;uniform float u_time;uniform float u_center;uniform vec2 u_size;
varying vec3 v_color;varying vec3 v_world;varying float v_id;varying float v_unlit;varying float v_glow;varying float v_ground;
void main(){
  vec3 p=a_position;
  if(a_motion>.5&&a_motion<2.5){float phase=a_motion<1.5?0.0:38.0;p.x+=mod(u_time*2.7+phase,86.0)-phase;}
  else if(a_motion<4.5&&a_motion>2.5){float phase=a_motion<3.5?0.0:20.0;p.z+=mod(u_time*1.8+phase,40.0)-phase;}
  else if(a_motion>4.5){p.x+=(sin(u_time*.7+a_motion)-sin(a_motion))*1.25;p.z+=(cos(u_time*.5+a_motion)-cos(a_motion))*.45;}
  float c=cos(u_yaw),s=sin(u_yaw),cp=cos(u_pitch),sp=sin(u_pitch);
  float toward=s*p.x+c*p.z;
  float sx=u_size.x*.5+(c*p.x-s*p.z)*u_scale;
  float sy=u_size.y*u_center+(sp*toward-cp*(p.y-8.0))*u_scale;
  float depth=cp*toward+sp*p.y;
  gl_Position=vec4(2.0*sx/u_size.x-1.0,1.0-2.0*sy/u_size.y,-depth/145.0,1.0);
  float shade=a_unlit>.5?1.0:clamp(.86+.2*dot(a_normal,normalize(vec3(.36,.82,.44))),.73,1.06);
  v_color=a_color*shade;v_id=a_id;v_world=p;v_unlit=a_unlit;v_glow=a_glow;v_ground=a_ground;
}`;
const fragmentSource = `precision mediump float;uniform float u_picking;uniform float u_selected;uniform float u_hover;
varying vec3 v_color;varying vec3 v_world;varying float v_id;varying float v_unlit;varying float v_glow;varying float v_ground;
void main(){
  if(u_picking>.5){gl_FragColor=vec4(v_id/255.0,0.0,0.0,1.0);return;}
  vec3 color=v_color;
  if(v_id>.5&&(abs(v_id-u_selected)<.5||abs(v_id-u_hover)<.5))color=mix(color,vec3(.33,.56,.94),.60);
  gl_FragColor=vec4(color,1.0);
}`;

function faceNormal(a,b,c){
  const u=b.map((v,i)=>v-a[i]),v=c.map((q,i)=>q-a[i]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  const length=Math.hypot(...n)||1;
  return n.map(q=>q/length);
}
function sceneBuffer(){
  const data=[];
  for(const face of createScene()){
    const n=faceNormal(...face.p),hex=palette[face.material];
    const color=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const id=face.buildingId?selectableIds.indexOf(face.buildingId)+1:0;
    const glow=['glass','glassLight'].includes(face.material)?1:face.material==='lampGlow'?2:face.material==='carLight'?3:0;
    const ground=['ground','road','path'].includes(face.material)?1:0;
    for(const p of face.p)data.push(...p,...n,...color,id,face.motion,face.material==='person'?1:0,glow,ground);
  }
  return new Float32Array(data);
}
const geometry=sceneBuffer();

class ReferenceCityBlock extends HTMLElement {
  connectedCallback(){
    if(this.shadowRoot){this.observer?.observe(this);this.start();return;}
    const root=this.attachShadow({mode:'open'});
    const css=new URL('./city-block.css',import.meta.url);
    root.innerHTML=`<link rel="stylesheet" href="${css}"><div class="frame">
      <canvas tabindex="0" aria-label="Interactive 3D city block. Move pointer or drag to orbit; click a highlighted building. Arrow keys rotate; keys 1, 2, 3 activate About me, site tool, and Current study."></canvas>
      <div class="hover-label" role="tooltip" hidden></div>
      <div class="building-labels" aria-label="City destinations"></div>
    </div>`;
    this.canvas=root.querySelector('canvas');
    this.hoverLabel=root.querySelector('.hover-label');
    this.buildingLabels=new Map(selectableIds.map(id=>{
      const label=document.createElement('button');label.type='button';label.className='building-label';
      const {number,title,detail}=destinations[id];
      label.innerHTML=`<small>${number} / DESTINATION</small><strong>${title}</strong><em>${detail}</em>`;
      label.setAttribute('aria-label',`${title}: ${detail}`);
      label.addEventListener('click',()=>this.select(id));
      root.querySelector('.building-labels').append(label);return [id,label];
    }));
    this.gl=this.canvas.getContext('webgl',{antialias:true,preserveDrawingBuffer:true});
    this.yaw=.77;this.pitch=.60;this.targetYaw=.77;this.targetPitch=.60;this.anchorYaw=.77;this.anchorPitch=.60;this.zoom=1;this.hovered=0;this.flashIndex=0;this.flashUntil=0;this.time=0;this.drag=null;this.pointer=null;this.lastPick=0;
    this.paused=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!this.gl){this.markUnavailable();return;}
    this.canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.stop();this.markUnavailable();});
    try{this.setupGL();}catch(error){console.error('City model could not start:',error);this.markUnavailable();return;}
    this.bindInteraction();
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this);
    this.resize();this.start();
  }
  disconnectedCallback(){this.stop();this.observer?.disconnect();}
  markUnavailable(){
    if(this.dataset.unavailable)return;
    this.dataset.unavailable='true';
    const frame=this.shadowRoot.querySelector('.frame');
    frame.classList.add('no-webgl');
    frame.insertAdjacentHTML('beforeend','<p class="city-unavailable">3D city unavailable. Use the page links to continue.</p>');
    this.dispatchEvent(new CustomEvent('cityblock:error',{bubbles:true,composed:true}));
  }
  setupGL(){
    const gl=this.gl;
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertexSource));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragmentSource));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,geometry,gl.STATIC_DRAW);
    for(const [name,size,offset] of [['a_position',3,0],['a_normal',3,12],['a_color',3,24],['a_id',1,36],['a_motion',1,40],['a_unlit',1,44],['a_glow',1,48],['a_ground',1,52]]){
      const index=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,56,offset);
    }
    this.uniforms=Object.fromEntries(['u_yaw','u_pitch','u_scale','u_center','u_size','u_time','u_picking','u_selected','u_hover'].map(name=>[name,gl.getUniformLocation(program,name)]));
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect();this.width=rect.width;this.height=rect.height;
    this.dpr=Math.min(devicePixelRatio||1,2);
    this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);
    this.draw();
  }
  layoutScale(){return Math.min(this.width/148,this.height/116)*this.zoom*(this.width<500?1.05:1.1);}
  centerY(){return this.width<500?.60:.53;}
  positionLabels(){
    if(!this.width||!this.height)return;
    const c=Math.cos(this.yaw),s=Math.sin(this.yaw),sp=Math.sin(this.pitch),cp=Math.cos(this.pitch);
    const scale=this.layoutScale(),compact=this.width<500,mobile=matchMedia('(max-width:700px)').matches;
    for(const [id,label] of this.buildingLabels){
      if(mobile){label.style.left='';label.style.top='';label.style.width='';label.hidden=false;continue;}
      const b=buildings.find(item=>item.id===id),toward=s*b.x+c*b.z;
      const x=this.width*.5+(c*b.x-s*b.z)*scale;
      const y=this.height*this.centerY()+(sp*toward-cp*(b.h-8))*scale;
      const index=selectableIds.indexOf(id),column=this.width/3;
      const labelX=compact?index*column+8:id==='west-residence'?8:id==='north-tower'?this.width*.32:this.width-135;
      const labelY=compact?4:id==='west-residence'?Math.max(12,this.height*.20):4;
      label.style.left=`${labelX}px`;label.style.top=`${labelY}px`;
      label.style.width=compact?`${column-12}px`:id==='north-tower'?'150px':'130px';
      label.hidden=x<0||x>this.width||y<0||y>this.height;
    }
  }
  render(picking=false){
    const gl=this.gl;if(!gl||!this.width||!this.height)return;
    const u=this.uniforms;gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(picking?0:245/255,picking?0:247/255,picking?0:250/255,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(u.u_yaw,this.yaw);gl.uniform1f(u.u_pitch,this.pitch);
    gl.uniform1f(u.u_scale,this.layoutScale()*this.dpr);
    gl.uniform1f(u.u_center,this.centerY());
    gl.uniform2f(u.u_size,this.canvas.width,this.canvas.height);
    gl.uniform1f(u.u_time,this.time);gl.uniform1f(u.u_picking,picking?1:0);gl.uniform1f(u.u_selected,performance.now()<this.flashUntil?this.flashIndex:0);gl.uniform1f(u.u_hover,this.hovered);
    gl.drawArrays(gl.TRIANGLES,0,geometry.length/14);
  }
  draw(){this.render(false);this.positionLabels();}
  hit(event){
    const rect=this.canvas.getBoundingClientRect();
    const x=Math.max(0,Math.min(this.canvas.width-1,Math.floor((event.clientX-rect.left)*this.dpr)));
    const y=Math.max(0,Math.min(this.canvas.height-1,Math.floor((rect.bottom-event.clientY)*this.dpr)));
    this.render(true);const pixel=new Uint8Array(4);this.gl.readPixels(x,y,1,1,this.gl.RGBA,this.gl.UNSIGNED_BYTE,pixel);
    return selectableIds[pixel[0]-1]||null;
  }
  hoverHit(event){
    const rect=this.canvas.getBoundingClientRect();
    const pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};
    const c=Math.cos(this.yaw),s=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);
    const scale=this.layoutScale();
    const project=([x,y,z])=>{
      const toward=s*x+c*z;
      return {x:this.width*.5+(c*x-s*z)*scale,y:this.height*this.centerY()+(sp*toward-cp*(y-8))*scale,depth:cp*toward+sp*y};
    };
    const inside=(p,a,b,c)=>{
      const cross=(u,v,w)=>(u.x-w.x)*(v.y-w.y)-(v.x-w.x)*(u.y-w.y);
      const q=[cross(p,a,b),cross(p,b,c),cross(p,c,a)];
      return q.every(v=>v>=0)||q.every(v=>v<=0);
    };
    let match=null,nearest=-Infinity;
    for(const id of selectableIds){
      const b=buildings.find(item=>item.id===id),x0=b.x-b.w/2,x1=b.x+b.w/2,z0=b.z-b.d/2,z1=b.z+b.d/2,h=b.h;
      const faces=[
        {n:[0,1,0],p:[[x0,h,z0],[x1,h,z0],[x1,h,z1],[x0,h,z1]]},
        {n:[0,0,1],p:[[x0,0,z1],[x1,0,z1],[x1,h,z1],[x0,h,z1]]},
        {n:[0,0,-1],p:[[x1,0,z0],[x0,0,z0],[x0,h,z0],[x1,h,z0]]},
        {n:[1,0,0],p:[[x1,0,z1],[x1,0,z0],[x1,h,z0],[x1,h,z1]]},
        {n:[-1,0,0],p:[[x0,0,z0],[x0,0,z1],[x0,h,z1],[x0,h,z0]]}
      ];
      for(const face of faces){
        const [nx,ny,nz]=face.n;
        if(nx*s*cp+ny*sp+nz*c*cp<=0)continue;
        const p=face.p.map(project);
        if(!inside(pointer,p[0],p[1],p[2])&&!inside(pointer,p[0],p[2],p[3]))continue;
        const depth=p.reduce((total,item)=>total+item.depth,0)/4;
        if(depth>nearest){nearest=depth;match=id;}
      }
    }
    return match;
  }
  setHover(id,event){
    this.hovered=id?selectableIds.indexOf(id)+1:0;
    if(id&&event){
      const rect=this.canvas.getBoundingClientRect();
      this.hoverLabel.textContent=destinations[id].title;
      this.hoverLabel.style.left=`${Math.max(8,Math.min(event.clientX-rect.left+13,rect.width-160))}px`;
      this.hoverLabel.style.top=`${Math.max(8,event.clientY-rect.top-38)}px`;
      this.hoverLabel.hidden=false;
    }else this.hoverLabel.hidden=true;
  }
  select(id){
    if(!selectableIds.includes(id))return;
    this.setHover(null);
    this.flashIndex=selectableIds.indexOf(id)+1;
    this.flashUntil=performance.now()+650;
    this.draw();
    const event=new CustomEvent('cityblock:select',{bubbles:true,composed:true,cancelable:true,detail:{id,name:destinations[id].title}});
    this.dispatchEvent(event);
    const href=this.getAttribute(`${id}-href`);
    if(href&&!event.defaultPrevented)location.assign(href);
  }
  bindInteraction(){
    const c=this.canvas;
    c.addEventListener('pointerdown',e=>{c.setPointerCapture(e.pointerId);this.drag={x:e.clientX,y:e.clientY,yaw:this.targetYaw,pitch:this.targetPitch,moved:false};this.pointer=null;this.setHover(null);c.classList.add('dragging');});
    c.addEventListener('pointermove',e=>{
      if(this.drag){const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(Math.hypot(dx,dy)>4)this.drag.moved=true;
        if(this.drag.moved){this.targetYaw=this.drag.yaw+dx*.008;this.targetPitch=Math.max(.16,Math.min(1.25,this.drag.pitch+dy*.005));}return;}
      const rect=c.getBoundingClientRect();
      this.targetYaw=this.paused?this.anchorYaw:this.anchorYaw+((e.clientX-rect.left)/rect.width-.5)*.38;
      this.targetPitch=this.paused?this.anchorPitch:Math.max(.16,Math.min(1.25,this.anchorPitch+((e.clientY-rect.top)/rect.height-.5)*.17));
      this.pointer={clientX:e.clientX,clientY:e.clientY};
      if(this.hovered)this.setHover(selectableIds[this.hovered-1],e);
    });
    c.addEventListener('pointerup',e=>{if(this.drag&&!this.drag.moved){const id=this.hit(e);if(id)this.select(id);}else if(this.drag){this.anchorYaw=this.targetYaw;this.anchorPitch=this.targetPitch;}this.drag=null;c.classList.remove('dragging');});
    c.addEventListener('pointercancel',()=>{this.drag=null;c.classList.remove('dragging');});
    c.addEventListener('pointerleave',()=>{if(!this.drag){this.pointer=null;this.setHover(null);this.targetYaw=this.anchorYaw;this.targetPitch=this.anchorPitch;}});
    // The landing model always stays at the same scale; orbiting and navigation remain interactive.
    c.addEventListener('keydown',e=>{
      if(['1','2','3'].includes(e.key)){this.select(selectableIds[Number(e.key)-1]);e.preventDefault();return;}
      if(e.key.toLowerCase()==='p'){this.setPaused(!this.paused);e.preventDefault();return;}
      if(e.key==='ArrowLeft')this.anchorYaw-=.12;else if(e.key==='ArrowRight')this.anchorYaw+=.12;else if(e.key==='ArrowUp')this.anchorPitch=Math.max(.16,this.anchorPitch-.1);else if(e.key==='ArrowDown')this.anchorPitch=Math.min(1.25,this.anchorPitch+.1);else return;
      e.preventDefault();this.targetYaw=this.anchorYaw;this.targetPitch=this.anchorPitch;
    });
  }
  setPaused(paused){this.paused=paused;}
  start(){
    if(!this.gl||this.frame)return;
    this.lastFrame=0;
    const tick=timestamp=>{
      const dt=this.lastFrame?Math.min((timestamp-this.lastFrame)/1000,.05):0;
      this.lastFrame=timestamp;
      if(!this.paused)this.time+=dt;
      const ease=this.paused?1:1-Math.exp(-dt*9);
      this.yaw+=(this.targetYaw-this.yaw)*ease;
      this.pitch+=(this.targetPitch-this.pitch)*ease;
      if(this.pointer&&!this.drag&&timestamp-this.lastPick>70){
        this.lastPick=timestamp;
        const id=this.hoverHit(this.pointer);
        if((id?selectableIds.indexOf(id)+1:0)!==this.hovered){
          this.setHover(id,this.pointer);
          this.canvas.style.cursor=id?'pointer':'grab';
        }
      }
      this.draw();
      if(this.width&&this.height&&!this.dataset.ready){
        if(this.firstFramePainted){this.dataset.ready='true';this.dispatchEvent(new CustomEvent('cityblock:ready',{bubbles:true,composed:true}));}
        else this.firstFramePainted=true;
      }
      this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);
  }
  stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.lastFrame=0;}
}
customElements.define('reference-city-block',ReferenceCityBlock);
