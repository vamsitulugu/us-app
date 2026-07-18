/*public/js/globe-adaptive.js



/* ═══════════════════════════════════════════════════════
   ADAPTIVE GLOBE — Phase 1 + Phase 2
   Modular add-on. Does not touch existing globe/camera code.
   Free data only: Natural Earth (countries + admin-1), geoBoundaries.
   ═══════════════════════════════════════════════════════ */
window.AdaptiveGlobe = (function () {
  const NE_110M = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
  const NE_50M  = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
  const GEOBOUNDARIES = iso3 => `https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM1/`;

  // Zoom thresholds (matches host app: MIN_ZOOM=1.6 close, MAX_ZOOM=5 far)
  const Z = { BORDERS: 4.2, LABELS: 3.2, HIRES: 2.6, STATES: 2.3, CITIES: 1.9 };
// ── Web Worker pool for off-main-thread GeoJSON fetch+parse ──
  const WORKER_COUNT = 2;
  let workerPool = [];
  let jobCounter = 0;
  const pendingJobs = new Map();

  function initWorkerPool() {
    if (workerPool.length || typeof Worker === 'undefined') return;
    for (let i = 0; i < WORKER_COUNT; i++) {
      const w = new Worker('/js/geojson-worker.js');
      w.onmessage = (e) => {
        const { jobId, ok, data, error } = e.data;
        const job = pendingJobs.get(jobId);
        if (!job) return;
        pendingJobs.delete(jobId);
        ok ? job.resolve(data) : job.reject(new Error(error));
      };
      w.onerror = (err) => console.warn('AdaptiveGlobe worker error:', err.message);
      workerPool.push(w);
    }
  }

  function fetchGeoJSONViaWorker(url) {
    return new Promise((resolve, reject) => {
      if (!workerPool.length) {
        // Fallback: no Worker support, do it on main thread
        fetch(url).then(r => r.json()).then(resolve).catch(reject);
        return;
      }
      const jobId = ++jobCounter;
      const worker = workerPool[jobId % workerPool.length];
      pendingJobs.set(jobId, { resolve, reject });
      worker.postMessage({ url, jobId });
    });
  }
  let globeRef = null, THREE_ = null;
  let bordersLo = null, bordersHi = null;
  let countryLabels = new THREE.Group();
  let oceanLabels = new THREE.Group();
  let stateBorders = new THREE.Group();
  let cityLabels = new THREE.Group();
  let loadedLo = false, loadedHi = false, hiResSwapped = false;
  let currentBucket = -1, focusedISO = null, statesLoadedFor = null;
  let countryFeatures = [];      // cached NE 110m features (name, iso3, centroid)
  let cityLabelObjs = [];        // {sprite,label,importance}

  function latLngToVec3(lat, lng, r) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lng + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -(r * Math.sin(phi) * Math.cos(theta)),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }

  function ringToVec3s(ring, r) {
    return ring.map(([lng, lat]) => latLngToVec3(lat, lng, r));
  }

  function polygonCentroid(coords) {
    // coords: outer ring of a Polygon (first ring of first polygon for MultiPolygon)
    let x = 0, y = 0, n = 0;
    coords.forEach(([lng, lat]) => { x += lng; y += lat; n++; });
    return [x / n, y / n];
  }

  // ── Merged border geometry — one BufferGeometry per border set instead of
  //    one THREE.Line per country/ring. Cuts draw calls from ~600+ to 1. ──
  function buildBorderGroup(geojson, r, opacity) {
    const positions = [];
    geojson.features.forEach(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly => {
        poly.forEach(ring => {
          const pts = ringToVec3s(ring, r);
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        });
      });
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xbfe0ff, transparent: true, opacity, depthWrite: false
    });
    const mesh = new THREE.LineSegments(geo, mat);
    // Wrap in a Group so existing code that does group.children.forEach(...) / group.add still works —
    // but now it's a single mesh with one material, exposed the same way.
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.singleMesh = mesh; // direct handle for fast opacity updates
    return group;
  }

  function makeTextSprite(text, opts = {}) {
    const fontSize = opts.fontSize || 42;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `600 ${fontSize}px Inter, sans-serif`;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    c.width = w; c.height = fontSize + 20;
    ctx.font = `600 ${fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = opts.color || 'rgba(255,255,255,0.92)';
    ctx.fillText(text, w / 2, c.height / 2);

    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
    const sprite = new THREE.Sprite(mat);
    const scale = (opts.scale || 0.09) * (w / 200);
    sprite.scale.set(scale, scale * (c.height / w), 1);
    sprite.userData.baseScale = { x: sprite.scale.x, y: sprite.scale.y };
    sprite.userData.importance = opts.importance || 1;
    sprite.userData.label = text;
    return sprite;
  }

  // ── Country borders + labels (zoom level 2/3) ──
  async function loadCountriesLo() {
    if (loadedLo) return;
    loadedLo = true;
    try {
      const gj = await fetchGeoJSONViaWorker(NE_110M);   // ← changed
      countryFeatures = gj.features.map(f => ({
        name: f.properties.NAME || f.properties.ADMIN,
        iso3: f.properties.ISO_A3,
        centroid: polygonCentroid(
          f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
        )
      }));
      bordersLo = buildBorderGroup(gj, 1.006, 0);
      globeRef.add(bordersLo);
      countryFeatures.forEach(cf => {
        if (!cf.name) return;
        const sprite = makeTextSpriteCached(cf.name, { fontSize: 30, scale: 0.075, importance: 1 });
        sprite.position.copy(latLngToVec3(cf.centroid[1], cf.centroid[0], 1.03));
        sprite.userData.iso3 = cf.iso3;
        countryLabels.add(sprite);
      });
      globeRef.add(countryLabels);
    } catch (e) { console.warn('AdaptiveGlobe: NE110m load failed', e); loadedLo = false; }
  }

  // ── Ocean labels (static, zoom level 3) ──
  const OCEANS = [
    ['Pacific Ocean', 0, -160], ['Atlantic Ocean', 10, -40],
    ['Indian Ocean', -20, 75], ['Southern Ocean', -65, 0], ['Arctic Ocean', 84, 0]
  ];
  function buildOceanLabels() {
    OCEANS.forEach(([name, lat, lng]) => {
      const sprite = makeTextSprite(name, { fontSize: 26, scale: 0.06, color: 'rgba(140,200,255,0.8)' });
      sprite.position.copy(latLngToVec3(lat, lng, 1.03));
      oceanLabels.add(sprite);
    });
    globeRef.add(oceanLabels);
  }

  // ── City gazetteer — real cities/capitals with population, tiered ──
  // Tier 1 = major capitals/megacities (visible from Z.CITIES)
  // Tier 2 = large cities (visible closer)
  // Tier 3 = notable secondary cities (visible closest only)
  const CITY_DATA = [
    // [name, lat, lng, population, tier]
    ['Tokyo',35.68,139.76,37400000,1],['Delhi',28.61,77.21,32900000,1],['Shanghai',31.23,121.47,29200000,1],
    ['Sao Paulo',-23.55,-46.63,22600000,1],['Mexico City',19.43,-99.13,22200000,1],['Cairo',30.04,31.24,21300000,1],
    ['Mumbai',19.08,72.88,20700000,1],['Beijing',39.90,116.40,20500000,1],['Dhaka',23.81,90.41,21700000,1],
    ['Osaka',34.69,135.50,19100000,1],['New York',40.71,-74.01,18800000,1],['Karachi',24.86,67.01,16800000,1],
    ['Buenos Aires',-34.60,-58.38,15400000,1],['Chongqing',29.56,106.55,16400000,1],['Istanbul',41.01,28.98,15500000,1],
    ['Kolkata',22.57,88.36,14900000,1],['Manila',14.60,120.98,14200000,1],['Lagos',6.52,3.38,15400000,1],
    ['Rio de Janeiro',-22.91,-43.17,13600000,1],['Tianjin',39.13,117.20,13600000,1],['Kinshasa',-4.44,15.27,15600000,1],
    ['Guangzhou',23.13,113.26,13300000,1],['Los Angeles',34.05,-118.24,12400000,1],['Moscow',55.75,37.62,12600000,1],
    ['Shenzhen',22.54,114.06,12500000,1],['Lahore',31.55,74.34,13100000,1],['Bangalore',12.97,77.59,12300000,1],
    ['Paris',48.86,2.35,11000000,1],['Bogota',4.71,-74.07,10800000,1],['Jakarta',-6.21,106.85,10900000,1],
    ['Chennai',13.08,80.27,10900000,1],['Lima',-12.05,-77.04,10700000,1],['Bangkok',13.75,100.50,10700000,1],
    ['Seoul',37.57,126.98,9900000,1],['Nagoya',35.18,136.91,9500000,1],['Hyderabad',17.39,78.49,10300000,1],
    ['London',51.51,-0.13,9500000,1],['Tehran',35.69,51.39,9300000,1],['Chicago',41.88,-87.63,8900000,1],
    ['Chengdu',30.57,104.07,9200000,1],['Nanjing',32.06,118.80,9400000,1],['Wuhan',30.59,114.31,8900000,1],
    ['Ho Chi Minh City',10.82,106.63,9300000,1],['Luanda',-8.84,13.23,8900000,1],['Ahmedabad',23.03,72.59,8400000,1],
    ['Kuala Lumpur',3.14,101.69,8200000,1],['Xian',34.34,108.94,8200000,1],['Hong Kong',22.32,114.17,7500000,1],
    ['Dongguan',23.02,113.75,8300000,1],['Hangzhou',30.27,120.15,8000000,1],['Foshan',23.02,113.12,7900000,1],
    ['Riyadh',24.71,46.68,7500000,1],['Baghdad',33.34,44.40,7500000,1],['Santiago',-33.45,-70.67,6800000,1],
    ['Singapore',1.35,103.82,5900000,1],['St. Petersburg',59.93,30.34,5400000,1],['Toronto',43.65,-79.38,6200000,1],
    ['Dubai',25.20,55.27,3500000,1],['Sydney',-33.87,151.21,5300000,1],['Berlin',52.52,13.40,3700000,1],
    ['Madrid',40.42,-3.70,6600000,1],['Rome',41.90,12.50,4300000,1],['Cape Town',-33.92,18.42,4600000,1],
    ['Johannesburg',-26.20,28.05,5900000,1],['Nairobi',-1.29,36.82,4700000,1],['Casablanca',33.57,-7.59,3700000,1],
    ['Melbourne',-37.81,144.96,5100000,1],['Washington DC',38.91,-77.04,5400000,1],['Amsterdam',52.37,4.90,1150000,2],

    ['Pune',18.52,73.86,6800000,2],['Surat',21.17,72.83,6700000,2],['Jaipur',26.91,75.79,3900000,2],
    ['Lucknow',26.85,80.95,3600000,2],['Kanpur',26.45,80.33,3300000,2],['Bhopal',23.26,77.41,2300000,2],
    ['Bhubaneswar',20.29,85.82,880000,2],['Nagpur',21.15,79.09,2900000,2],['Indore',22.72,75.86,3300000,2],
    ['Barcelona',41.39,2.17,5600000,2],['Milan',45.46,9.19,3100000,2],['Munich',48.14,11.58,1500000,2],
    ['Vienna',48.21,16.37,1900000,2],['Warsaw',52.23,21.01,1800000,2],['Athens',37.98,23.73,3200000,2],
    ['Lisbon',38.72,-9.14,2900000,2],['Dublin',53.35,-6.26,1200000,2],['Brussels',50.85,4.35,2000000,2],
    ['Stockholm',59.33,18.07,1600000,2],['Copenhagen',55.68,12.57,1300000,2],['Oslo',59.91,10.75,1000000,2],
    ['Zurich',47.38,8.54,1400000,2],['Prague',50.08,14.44,1300000,2],['Budapest',47.50,19.04,1750000,2],
    ['Kyiv',50.45,30.52,2900000,2],['Vancouver',49.28,-123.12,2600000,2],['Montreal',45.50,-73.57,4200000,2],
    ['San Francisco',37.77,-122.42,4700000,2],['Miami',25.76,-80.19,6100000,2],['Houston',29.76,-95.37,7100000,2],
    ['Boston',42.36,-71.06,4900000,2],['Dallas',32.78,-96.80,7600000,2],['Seattle',47.61,-122.33,4000000,2],
    ['Atlanta',33.75,-84.39,6100000,2],['Denver',39.74,-104.99,2900000,2],['Phoenix',33.45,-112.07,4900000,2],
    ['Auckland',-36.85,174.76,1700000,2],['Wellington',-41.29,174.78,420000,2],['Perth',-31.95,115.86,2100000,2],
    ['Brisbane',-27.47,153.03,2500000,2],['Ankara',39.93,32.86,5700000,2],['Tel Aviv',32.08,34.78,4400000,2],
    ['Jerusalem',31.77,35.21,940000,2],['Doha',25.29,51.53,2400000,2],['Abu Dhabi',24.45,54.38,1500000,2],
    ['Kuwait City',29.38,47.99,3200000,2],['Amman',31.95,35.93,4000000,2],['Beirut',33.89,35.50,2400000,2],
    ['Colombo',6.93,79.85,750000,2],['Kathmandu',27.72,85.32,1500000,2],['Thimphu',27.47,89.64,115000,2],
    ['Yangon',16.84,96.17,5200000,2],['Phnom Penh',11.56,104.92,2300000,2],['Hanoi',21.03,105.85,5300000,2],
    ['Taipei',25.03,121.56,2600000,2],['Osaka Bay',34.65,135.43,2700000,2],['Busan',35.18,129.08,3400000,2],
    ['Quebec City',46.81,-71.21,800000,2],['Havana',23.13,-82.38,2100000,2],['Panama City',8.98,-79.52,1700000,2],
    ['Quito',-0.18,-78.47,1800000,2],['Caracas',10.49,-66.88,2900000,2],['Montevideo',-34.90,-56.16,1700000,2],

    ['Odessa',46.48,30.73,1000000,3],['Krakow',50.06,19.94,780000,3],['Porto',41.15,-8.61,240000,3],
    ['Florence',43.77,11.26,380000,3],['Venice',45.44,12.33,260000,3],['Marrakesh',31.63,-7.99,930000,3],
    ['Zanzibar City',-6.16,39.20,600000,3],['Reykjavik',64.15,-21.94,130000,3],['Salzburg',47.80,13.04,155000,3],
    ['Kyoto',35.01,135.77,1460000,3],['Chiang Mai',18.79,98.99,130000,3],['Bali (Denpasar)',-8.65,115.22,900000,3],
    ['Cusco',-13.53,-71.97,430000,3],['Queenstown',-45.03,168.66,15000,3],['Banff',51.18,-115.57,8000,3],
    ['Interlaken',46.68,7.87,5700,3],['Santorini',36.39,25.46,15500,3],['Innsbruck',47.27,11.39,132000,3]
  ];

  function buildCityLabels() {
    CITY_DATA.forEach(([name, lat, lng, pop, tier]) => {
      const fontSize = tier === 1 ? 24 : tier === 2 ? 20 : 17;
      const scale = tier === 1 ? 0.055 : tier === 2 ? 0.045 : 0.038;
      const color = tier === 1 ? 'rgba(255,255,255,0.95)' : tier === 2 ? 'rgba(220,230,255,0.85)' : 'rgba(190,205,235,0.75)';
      const sprite = makeTextSprite(name, { fontSize, scale, importance: 4 - tier, color });
      sprite.position.copy(latLngToVec3(lat, lng, 1.035));
      sprite.userData.tier = tier;
      sprite.userData.pop = pop;
      sprite.userData.built = true; // eligible; visibility gated by tier+frustum in update()
      cityLabelObjs.push(sprite);
      cityLabels.add(sprite);
    });
    globeRef.add(cityLabels);
  }

  // Frustum containment check for lazy per-city reveal
  function inFrustum(pos, camera) {
    const frustum = new THREE.Frustum();
    const mat = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(mat);
    const world = pos.clone().applyMatrix4(globeRef.matrixWorld);
    return frustum.containsPoint(world);
  }

  // ── Lazy state/province borders for a focused country (zoom level 4) ──

let statesFeatureBroken = false; // add near other state vars

async function loadStatesForCountry(iso3) {
  if (!iso3 || statesLoadedFor === iso3 || statesFeatureBroken) return;
  statesLoadedFor = iso3;
  stateBorders.children.forEach(c => stateBorders.remove(c));
  try {
    const meta = await fetchGeoJSONViaWorker(GEOBOUNDARIES(iso3));
    let url = meta.gjDownloadURL || (Array.isArray(meta) ? meta[0]?.gjDownloadURL : null);
    if (!url) return;
    url = url.replace('github.com/', 'raw.githubusercontent.com/').replace('/raw/', '/');
    const gj = await fetchGeoJSONViaWorker(url);
    const grp = buildBorderGroup(gj, 1.008, 0.55);
    grp.children.forEach(c => stateBorders.add(c));
  } catch (e) {
    console.warn('AdaptiveGlobe: geoBoundaries unavailable, disabling state borders for this session');
    statesFeatureBroken = true;
    statesLoadedFor = null;
  }
}

  // ── Label overlap culling (screen-space, cheap, recomputed on bucket change) ──
  function cullOverlaps(group, camera, minPx) {
    const w = window.innerWidth, h = window.innerHeight;
    const shown = [];
    const items = group.children
      .map(s => ({ s, imp: s.userData.importance || 1 }))
      .sort((a, b) => b.imp - a.imp);
    items.forEach(({ s }) => {
      const p = s.position.clone().project(camera);
      const sx = (p.x * 0.5 + 0.5) * w, sy = (-p.y * 0.5 + 0.5) * h;
      const behind = p.z > 1;
      let overlap = false;
      for (const o of shown) {
        if (Math.hypot(o.x - sx, o.y - sy) < minPx) { overlap = true; break; }
      }
      s.userData.visible = !behind && !overlap;
      if (!overlap && !behind) shown.push({ x: sx, y: sy });
    });
  }

  function fade(obj, target, dt) {
    obj.traverse ? obj.traverse(n => { if (n.material) n.material.opacity += (target - n.material.opacity) * dt; })
                  : null;
  }
 function fadeGroupMat(group, target, dt) {
    if (group.userData && group.userData.singleMesh) {
      const m = group.userData.singleMesh.material;
      const tgt = group.userData.visible === false ? 0 : target;
      m.opacity += (tgt - m.opacity) * dt;
      return;
    }
    // Fallback for groups that still hold multiple children (labels, city sprites — unchanged)
    group.children.forEach(c => {
      if (!c.material) return;
      const tgt = c.userData.visible === false ? 0 : target;
      c.material.opacity += (tgt - c.material.opacity) * dt;
    });
  }
// ── Rivers & Lakes (Natural Earth, lazy-loaded past Z.STATES) ──
  const NE_RIVERS = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson';
  const NE_LAKES  = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_lakes.geojson';
  let riversGroup = new THREE.Group();
  let lakesGroup = new THREE.Group();
  let loadedWater = false;
  const Z_WATER = 2.4;

  function buildLineFeatureGroup(geojson, r, color, opacity) {
    const positions = [];
    geojson.features.forEach(f => {
      const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : (f.geometry.coordinates || []);
      lines.forEach(line => {
        if (!line || line.length < 2) return;
        const pts = ringToVec3s(line, r);
        for (let i = 0; i < pts.length - 1; i++) {
          positions.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        }
      });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.LineSegments(geo, mat);
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.singleMesh = mesh;
    return group;
  }

  function buildPolyFeatureGroup(geojson, r, color, opacity) {
    const positions = [];
    geojson.features.forEach(f => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly => {
        poly.forEach(ring => {
          const pts = ringToVec3s(ring, r);
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
          }
        });
      });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.LineSegments(geo, mat);
    const group = new THREE.Group();
    group.add(mesh);
    group.userData.singleMesh = mesh;
    return group;
  }

  async function loadWaterFeatures() {
    if (loadedWater) return;
    loadedWater = true;
    try {
      const [rGj, lGj] = await Promise.all([
        fetchGeoJSONViaWorker(NE_RIVERS),   // ← changed
        fetchGeoJSONViaWorker(NE_LAKES)     // ← changed
      ]);
      riversGroup = buildLineFeatureGroup(rGj, 1.006, 0x4fa8ff, 0.5);
      lakesGroup = buildPolyFeatureGroup(lGj, 1.006, 0x4fa8ff, 0.4);
      globeRef.add(riversGroup);
      globeRef.add(lakesGroup);
    } catch (e) { console.warn('AdaptiveGlobe: water features failed', e); loadedWater = false; }
  }

  // ── Mountains (curated peaks — real coordinates + elevation) ──
  const MOUNTAIN_DATA = [
    ['Mt. Everest',27.99,86.93,8849],['K2',35.88,76.51,8611],['Kangchenjunga',27.70,88.15,8586],
    ['Denali',63.07,-151.01,6190],['Aconcagua',-32.65,-70.01,6961],['Kilimanjaro',-3.07,37.35,5895],
    ['Mont Blanc',45.83,6.86,4809],['Matterhorn',45.98,7.66,4478],['Mt. Fuji',35.36,138.73,3776],
    ['Mt. Kenya',-0.15,37.31,5199],['Elbrus',43.35,42.44,5642],['Vinson Massif',-78.53,-85.62,4892],
    ['Puncak Jaya',-4.08,137.16,4884],['Mt. Rainier',46.85,-121.76,4392],['Annapurna',28.60,83.82,8091]
  ];
  let mountainGroup = new THREE.Group();
  const Z_MOUNTAINS = 2.1;

  function buildMountainLabels() {
    MOUNTAIN_DATA.forEach(([name, lat, lng, elev]) => {
      const sprite = makeTextSprite(`▲ ${name}`, { fontSize: 19, scale: 0.042, color: 'rgba(230,220,200,0.85)', importance: 2 });
      sprite.position.copy(latLngToVec3(lat, lng, 1.033));
      sprite.userData.elev = elev;
      mountainGroup.add(sprite);
    });
    globeRef.add(mountainGroup);
  }

  // ── Tile streaming for hi-res borders: split by hemisphere, load on demand ──
  const HEMI_BOUNDS = {
    NW: f => avgLng(f) < 0 && avgLat(f) >= 0,
    NE: f => avgLng(f) >= 0 && avgLat(f) >= 0,
    SW: f => avgLng(f) < 0 && avgLat(f) < 0,
    SE: f => avgLng(f) >= 0 && avgLat(f) < 0
  };
  function avgLng(f) {
    const c = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
    return c.reduce((s, p) => s + p[0], 0) / c.length;
  }
  function avgLat(f) {
    const c = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
    return c.reduce((s, p) => s + p[1], 0) / c.length;
  }
  let hiResTilesLoaded = new Set();
  let hiResGeojsonCache = null;

  async function loadHiResTileForView(camera) {
    if (!hiResGeojsonCache) {
      hiResGeojsonCache = await fetchGeoJSONViaWorker(NE_50M);
    }
    const facingLng = ((-currentRotYGlobal || 0) * 180 / Math.PI) % 360;
    const facingLat = (currentRotXGlobal || 0) * 180 / Math.PI;
    const tile = (facingLng < 0 ? 'W' : 'E') + (facingLat >= 0 ? 'N' : 'S');
    const key = tile === 'WN' ? 'NW' : tile === 'EN' ? 'NE' : tile === 'WS' ? 'SW' : 'SE';
    if (hiResTilesLoaded.has(key)) return;
    hiResTilesLoaded.add(key);

    const subset = { type: 'FeatureCollection', features: hiResGeojsonCache.features.filter(HEMI_BOUNDS[key]) };
    const newGroup = buildBorderGroup(subset, 1.007, 0);
    const newPositions = newGroup.userData.singleMesh.geometry.attributes.position.array;

    if (!bordersHi) {
      bordersHi = newGroup;
      globeRef.add(bordersHi);
    } else {
      // Merge new tile's positions into the existing single mesh geometry
      const oldMesh = bordersHi.userData.singleMesh;
      const oldPositions = oldMesh.geometry.attributes.position.array;
      const merged = new Float32Array(oldPositions.length + newPositions.length);
      merged.set(oldPositions, 0);
      merged.set(newPositions, oldPositions.length);
      oldMesh.geometry.dispose();
      oldMesh.geometry = new THREE.BufferGeometry();
      oldMesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
    }
  }
  let currentRotYGlobal = 0, currentRotXGlobal = 0;

  // ── Texture cache for label sprites (avoid rebuilding canvas textures) ──
  const spriteTexCache = new Map();
  function makeTextSpriteCached(text, opts = {}) {
    const key = text + '|' + JSON.stringify(opts);
    if (spriteTexCache.has(key)) {
      const cached = spriteTexCache.get(key);
      const mat = new THREE.SpriteMaterial({ map: cached.tex, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.copy(cached.scale);
      sprite.userData.importance = opts.importance || 1;
      sprite.userData.label = text;
      return sprite;
    }
    const sprite = makeTextSprite(text, opts);
    spriteTexCache.set(key, { tex: sprite.material.map, scale: sprite.scale.clone() });
    return sprite;
  }
  return {
    init(globe) {
      globeRef = globe;
      initWorkerPool();
      loadCountriesLo();
      buildOceanLabels();
      buildCityLabels();
      buildMountainLabels();
      globeRef.add(stateBorders);
    },

    update(zoom, selectedCountry, rotY, rotX) {
      if (!globeRef) return;
      const dt = 0.08;
      currentRotYGlobal = rotY || 0;
      currentRotXGlobal = rotX || 0;

      const borderTarget = zoom < Z.BORDERS ? 0.5 : 0;
      if (bordersLo) fadeGroupMat(bordersLo, borderTarget, dt);
      if (bordersHi) fadeGroupMat(bordersHi, borderTarget, dt);

      if (zoom < Z.HIRES && !hiResSwapped) { hiResSwapped = true; loadHiResTileForView(window.camera); }
      if (bordersLo) bordersLo.visible = zoom >= Z.HIRES || !hiResTilesLoaded.size;
      if (bordersHi) bordersHi.visible = zoom < Z.HIRES;

      const labelTarget = zoom < Z.LABELS ? 1 : 0;
      countryLabels.children.forEach(s => { s.material.opacity += ((s.userData.visible === false ? 0 : labelTarget) - s.material.opacity) * dt; });
      oceanLabels.children.forEach(s => { s.material.opacity += (labelTarget - s.material.opacity) * dt; });

      const tierAllowed = zoom < 1.75 ? 3 : zoom < Z.CITIES ? 2 : zoom < Z.CITIES + 0.5 ? 1 : 0;
      cityLabels.children.forEach(s => {
        const eligible = s.userData.tier <= tierAllowed && s.userData.visible !== false;
        s.material.opacity += ((eligible ? 1 : 0) - s.material.opacity) * dt;
      });

      if (zoom < Z.STATES && selectedCountry && selectedCountry !== focusedISO) {
        const match = countryFeatures.find(c => c.name === selectedCountry);
        if (match && match.iso3) { focusedISO = selectedCountry; loadStatesForCountry(match.iso3); }
      }
      fadeGroupMat(stateBorders, zoom < Z.STATES ? 0.6 : 0, dt);

      if (zoom < Z_WATER && !loadedWater) loadWaterFeatures();
      fadeGroupMat(riversGroup, zoom < Z_WATER ? 0.45 : 0, dt);
      fadeGroupMat(lakesGroup, zoom < Z_WATER ? 0.4 : 0, dt);

      const mtnTarget = zoom < Z_MOUNTAINS ? 1 : 0;
      mountainGroup.children.forEach(s => { s.material.opacity += ((s.userData.visible === false ? 0 : mtnTarget) - s.material.opacity) * dt; });

      const bucket = Math.round(zoom * 6);
      if (bucket !== currentBucket && window.camera) {
        currentBucket = bucket;
        cullOverlaps(countryLabels, window.camera, 46);
        cullOverlaps(cityLabels, window.camera, 40);
        cityLabels.children.forEach(s => {
          if (s.userData.visible !== false) s.userData.visible = inFrustum(s.position, window.camera);
        });
      }
    }
  };
})();