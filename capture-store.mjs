// Capture jobs, terrain and fetched tiles are temporary process memory only.
export function createMemoryCaptureStore(){
  const terrain=new Map(),tiles=new Map();
  return {
    async save(){},
    async saveTerrain(id,bytes){terrain.set(id,bytes);},
    async readTerrain(id){if(!terrain.has(id))throw Object.assign(new Error('Terrain expired.'),{code:'ENOENT'});return terrain.get(id);},
    async saveTerrainTile(id,key,bytes,source){tiles.set(`${id}:${key}`,{bytes,source});},
    async readTerrainTile(id,key){return tiles.get(`${id}:${key}`)||null;},
    async load(){return [];},
    async remove(id){terrain.delete(id);for(const key of tiles.keys())if(key.startsWith(`${id}:`))tiles.delete(key);}
  };
}
