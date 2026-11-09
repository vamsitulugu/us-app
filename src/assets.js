// Optional .glb loader: drop models into /public/models and call tryGLB(import.meta.env.BASE_URL+'models/hall.glb'). Returns null if missing, so procedural fallbacks keep working.
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const L=new GLTFLoader();
export const tryGLB=url=>new Promise(r=>L.load(url,g=>r(g),undefined,()=>r(null)));
