import test from 'node:test';
import assert from 'node:assert/strict';
import {makeIllustration} from './public/illustration.js';

const square=[[72.57,23.02],[72.571,23.02],[72.571,23.021],[72.57,23.021],[72.57,23.02]];
const polygon={type:'Polygon',coordinates:[square]};
const feature=(geometry,kind,source='Overture')=>({geometry,properties:{kind,source,height_m:null}});
const layers={buildings:[feature({type:'Polygon',coordinates:[[[72.5702,23.0202],[72.5704,23.0202],[72.5704,23.0204],[72.5702,23.0202]]]},'residential')],roads:[feature({type:'LineString',coordinates:[[72.57,23.0205],[72.571,23.0205]]},'primary')],landuse:[feature({type:'Polygon',coordinates:[square]},'park')],trees:[feature({type:'Point',coordinates:[72.5705,23.0205]},'tree')]};

test('graphic presets draw captured geometry and describe the limits of inferred layouts',()=>{
  const figure=makeIllustration({polygon,layers,options:{view:'Top',graphicMode:'figure',visible:{roads:false,landuse:false,trees:false},attribution:'© Overture Maps Foundation'}});
  assert.match(figure,/<g id="buildings"/);
  assert.doesNotMatch(figure,/<g id="roads"/);
  assert.match(figure,/kaniks-studio/);
  const nolli=makeIllustration({polygon,layers,options:{view:'Top',graphicMode:'nolli'}});
  assert.match(nolli,/public interiors and access not surveyed/);
  const streets=makeIllustration({polygon,layers,options:{view:'Top',graphicMode:'streets'}});
  assert.match(streets,/stroke-width="4.00"/);
  assert.match(streets,/do not show footfall or traffic counts/);
  const landuse=makeIllustration({polygon,layers,options:{view:'Top',graphicMode:'landuse'}});
  assert.match(landuse,/fill="#90bc91"/);
  assert.match(landuse,/<g id="trees"/);
});

test('urban SVG exports preserve sightline and walking-reach evidence',()=>{
  const sightline={type:'Feature',geometry:{type:'LineString',coordinates:[[72.5705,23.0205],[72.5709,23.0205]]},properties:{blocked:true}};
  const visible=makeIllustration({polygon,layers,options:{view:'Top',graphicMode:'visibility',sightlines:[sightline],visible:{roads:false}}});
  assert.match(visible,/<g id="plan-sightlines"/);
  assert.match(visible,/stroke="#f39569"/);
  assert.match(visible,/not sky view or an eye-level survey/);
  assert.match(visible,/kaniks-studio/);
  layers.roads[0].properties.id='route-1';
  const reach=makeIllustration({polygon,layers,options:{view:'Top',graphicMode:'reach',roadScores:{'route-1':1}}});
  assert.match(reach,/stroke="#2db77c"/);
  assert.match(reach,/not a walkability score or true isochrone polygon/);
});

test('building selection is preview-only and identified for editing',()=>{
  const paths=[];
  const indexed={...layers,buildings:layers.buildings.map((building,index)=>({...building,_illustrationIndex:index}))};
  const preview=makeIllustration({polygon,layers:indexed,options:{view:'Top',selectedBuildingIndex:0,onBuildingPath:(index,d)=>paths.push({index,d})}});
  assert.match(preview,/<g id="editor-selection"/);
  assert.equal(paths.length,1);
  assert.equal(paths[0].index,0);
  assert.match(paths[0].d,/^M/);
  const exportSvg=makeIllustration({polygon,layers:indexed,options:{view:'Top'}});
  assert.doesNotMatch(exportSvg,/editor-selection/);
  const removed=makeIllustration({polygon,layers:{...indexed,buildings:[]},options:{view:'Top'}});
  assert.match(removed,/<g id="buildings"[^>]*><\/g>/);
});
