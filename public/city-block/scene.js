// Original, image-led geometry. Coordinates are illustration units, with Y up.
export const palette = {
  base: '#d8ddd5', ground: '#eff1eb', path: '#e5e9e1', road: '#8aaff3',
  wall: '#eaede6', wallSide: '#dfe4db', roof: '#f7f8f3',
  trim: '#d4dbd0', glass: '#bcc5bb', glassLight: '#d9e0d6',
  tree: '#bddbb4', trunk: '#c5d3bd', car: '#f7f8f4',
  wheel: '#aeb8ac', person: '#0036ff', shadow: '#cbd2c8',
  pole: '#c5cec4', lampGlow: '#fff4cc', carLight: '#fff6dd'
};

export const buildings = [
  { id: 'west-residence', name: 'West residence', x: -37, z: 3, w: 22, d: 19, h: 31, floors: 6, type: 'residence' },
  { id: 'north-pavilion', name: 'North pavilion', x: -19, z: -24, w: 13, d: 11, h: 11, floors: 2, type: 'pavilion' },
  { id: 'central-office', name: 'Central office', x: -11, z: -2, w: 26, d: 21, h: 19, floors: 4, type: 'office' },
  { id: 'north-tower', name: 'North tower', x: 3, z: -29, w: 25, d: 22, h: 47, floors: 8, type: 'tower' },
  { id: 'east-tower', name: 'East tower', x: 32, z: -9, w: 20, d: 24, h: 40, floors: 9, type: 'tower' },
  { id: 'center-hall', name: 'Center hall', x: -2, z: 18, w: 22, d: 14, h: 12, floors: 2, type: 'hall' },
  { id: 'south-studio', name: 'South studio', x: -28, z: 29, w: 15, d: 12, h: 10, floors: 2, type: 'studio' },
  { id: 'east-wing', name: 'East wing', x: 23, z: 27, w: 24, d: 15, h: 15, floors: 3, type: 'wing' },
];
export const selectableIds = ['west-residence', 'north-tower', 'east-tower'];
export const streetLamps = [[-47,33],[-13,33],[8,33],[38,35],[47,-18]];

export function createScene() {
  const faces = [];
  let motion = 0;
  const tri = (a, b, c, material, buildingId = null) => faces.push({ p: [a, b, c], material, buildingId, motion });
  const quad = (a, b, c, d, material, id) => { tri(a,b,c,material,id); tri(a,c,d,material,id); };
  function box(x, y, z, w, h, d, material, id = null) {
    const x0=x-w/2, x1=x+w/2, y0=y, y1=y+h, z0=z-d/2, z1=z+d/2;
    quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],material,id);
    quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],material,id);
    quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],material,id);
    quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],material,id);
    quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],material,id);
    quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],material,id);
  }
  function cone(x, y, z, radius, height, material, id = null, sides = 7) {
    for (let i=0; i<sides; i++) {
      const a=i*Math.PI*2/sides, b=(i+1)*Math.PI*2/sides;
      tri([x+Math.cos(b)*radius,y,z+Math.sin(b)*radius],
          [x+Math.cos(a)*radius,y,z+Math.sin(a)*radius],
          [x,y+height,z], material,id);
    }
  }
  function roof(b) {
    const id=b.id, y=b.h;
    box(b.x,y,b.z,b.w+.6,.52,b.d+.6,'roof',id);
    const t=.45;
    box(b.x,y+.5,b.z-b.d/2,b.w+1,.65,t,'trim',id);
    box(b.x,y+.5,b.z+b.d/2,b.w+1,.65,t,'trim',id);
    box(b.x-b.w/2,y+.5,b.z,t,.65,b.d+1,'trim',id);
    box(b.x+b.w/2,y+.5,b.z,t,.65,b.d+1,'trim',id);
    if (b.type==='pavilion') {
      box(b.x,y+.5,b.z,b.w*.57,4,b.d*.6,'wall',id);
      box(b.x,y+4.5,b.z,b.w*.67,.5,b.d*.72,'roof',id);
    } else if (b.type==='tower') {
      box(b.x+b.w*.22,y+.5,b.z-b.d*.1,b.w*.25,2.4,b.d*.25,'wall',id);
      box(b.x+b.w*.22,y+2.9,b.z-b.d*.1,b.w*.28,.45,b.d*.28,'roof',id);
    } else {
      box(b.x-b.w*.2,y+.5,b.z-b.d*.13,b.w*.25,2.5,b.d*.3,'wall',id);
      box(b.x-b.w*.2,y+3,b.z-b.d*.13,b.w*.29,.4,b.d*.34,'roof',id);
    }
  }
  function facade(b) {
    const id=b.id;
    box(b.x,0,b.z,b.w,b.h,b.d,'wall',id);
    // Shadowed side gives the ivory massing its readable depth.
    box(b.x+b.w/2+.035,.35,b.z,.07,b.h-.7,b.d-.5,'wallSide',id);
    const level=b.h/b.floors;
    const frontCount=Math.max(3,Math.floor((b.w-3)/3.1));
    const sideCount=Math.max(2,Math.floor((b.d-3)/3.2));
    for(let f=0;f<b.floors;f++) {
      const wy=1.65+f*level;
      const wh=Math.min(2.25,level*.48);
      for(let j=0;j<frontCount;j++) {
        const wx=b.x-b.w/2+(j+1)*b.w/(frontCount+1);
        box(wx,wy,b.z+b.d/2+.11,1.22,wh,.18,'trim',id);
        box(wx,wy+.18,b.z+b.d/2+.23,.78,wh-.35,.08,'glass',id);
      }
      for(let j=0;j<sideCount;j++) {
        const wz=b.z-b.d/2+(j+1)*b.d/(sideCount+1);
        box(b.x+b.w/2+.11,wy,wz,.18,wh,1.2,'trim',id);
        box(b.x+b.w/2+.23,wy+.18,wz,.08,wh-.35,.76,'glassLight',id);
      }
      if(f>0 && (b.type==='tower'||b.type==='office')) {
        box(b.x,.2+f*level,b.z+b.d/2+.18,b.w+.35,.21,.55,'trim',id);
      }
    }
    if(b.type==='tower') {
      // Projecting ledges on the main tower echo the three offset volumes in the reference.
      if(b.id==='north-tower') for(const f of [3,5,7]) {
        box(b.x-b.w*.25, f*level-.15, b.z+b.d/2+1.2, b.w*.52, .8, 2.7,'roof',id);
        box(b.x-b.w*.25, f*level-.7, b.z+b.d/2+1.2, b.w*.52,.55,2.7,'wallSide',id);
      }
      if(b.id==='east-tower') {
        for(let i=0;i<4;i++) box(b.x+b.w/2+.27,1,b.z-b.d*.3+i*b.d*.2,.42,b.h-2,.55,'trim',id);
      }
    }
    if (b.type==='office'||b.type==='wing') {
      for(let f=1;f<b.floors;f++) box(b.x,f*level,b.z+b.d/2+.22,b.w+.2,.33,.65,'trim',id);
    }
    roof(b);
  }

  // Blue streets sit on the white display plinth.
  box(0,-2.6,0,104,2.6,83,'base');
  box(0,-.02,0,101,.06,80,'ground');
  box(0,.04,38.2,96,.055,3.6,'road');
  box(18,.045,0,5.5,.055,73,'road');
  box(-32,.045,18,8,.055,40,'path');
  for(const b of buildings) facade(b);

  const trees = [
    [-47,-9,5],[-39,20,4],[-44,35,4],[-13,-31,5],[20,-37,5],[21,-30,4],
    [47,-28,5],[47,11,4],[47,35,5],[33,42,5],[9,39,4],[-8,40,5],
    [-16,26,4],[-34,-18,4],[7,-10,4],[12,12,4],
    [-47,-30,4],[-48,17,4],[-40,-31,4],[-30,-26,4],[-16,-38,4],
    [-14,-39,4],[28,-34,4],[46,-6,4],[45,24,4],[40,35,4],
    [21,13,4],[13,9,4],[-17,17,4]
  ];
  for(const [x,z,h] of trees) {
    box(x,0,z,.48,1.1,.48,'trunk');
    cone(x,1.0,z,1.55,h,'tree');
  }
  function streetLamp(x,z) {
    box(x,0,z,.3,6.7,.3,'pole');
    box(x,6.4,z+1.2,.25,.25,2.4,'pole');
    box(x,6.12,z+2.4,1.05,.5,.85,'lampGlow');
  }
  for(const [x,z] of streetLamps) streetLamp(x,z);
  function car(x,z,axis='x',motionId=0) {
    motion=motionId;
    const alongX=axis==='x', w=alongX?6.4:2.9, d=alongX?2.9:6.4;
    box(x,.18,z,w,1.35,d,'car');
    box(x,.98,z,w*.58,.86,d*.74,'roof');
    if(alongX) for(const dx of [-w*.3,w*.3]) for(const side of [-1,1]) {
      box(x+dx,.12,z+side*d*.47,.9,.72,.25,'wheel');
    } else for(const dz of [-d*.3,d*.3]) for(const side of [-1,1]) {
      box(x+side*w*.47,.12,z+dz,.25,.72,.9,'wheel');
    }
    if(alongX) for(const side of [-1,1]) box(x+w/2+.08,.66,z+side*d*.27,.22,.34,.48,'carLight');
    else for(const side of [-1,1]) box(x+side*w*.27,.66,z+d/2+.08,.48,.34,.22,'carLight');
    motion=0;
  }
  car(-43,38.2,'x',1); car(-5,38.2,'x',2);
  car(18,-32,'z',3); car(18,-12,'z',4);
  function person(x,z,motionId) {
    motion=motionId;
    box(x,0,z,.43,1.1,.35,'person');
    box(x,1.07,z,.65,.7,.43,'person');
    cone(x,1.77,z,.34,.53,'person',null,8);
    box(x-.35,.9,z,.19,.65,.19,'person');
    box(x+.35,.9,z,.19,.65,.19,'person');
    motion=0;
  }
  const walkers = [
    [-43,16],[-44,30],[-10,30],[3,29],[10,13],[38,35.2],[48,3],[17,-15],
    [-46,-15],[-39,-22],[-28,17],[-19,10],[-15,34],[5,7],[42,16],[28,-32]
  ];
  const groups = [
    [[-45,18],[-43,19],[-46,21]],
    [[7,-8],[9,-6],[11,-9]],
    [[-8,28],[-6,30],[-5,27]],
    [[39,28],[41,30],[43,28]]
  ];
  [...walkers,...groups.flat()].forEach(([x,z],i)=>person(x,z,5+i));
  return faces;
}
