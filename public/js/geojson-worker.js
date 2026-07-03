/*public/js/geojson-worker.js

/* Web Worker — offloads GeoJSON fetch + parse off the main thread */
self.onmessage = async function (e) {
  const { url, jobId } = e.data;
  try {
    const res = await fetch(url);
    const text = await res.text();
    // Parse happens here, on the worker thread, not main thread
    const json = JSON.parse(text);
    self.postMessage({ jobId, ok: true, data: json });
  } catch (err) {
    self.postMessage({ jobId, ok: false, error: err.message });
  }
};