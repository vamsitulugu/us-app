/* ============================================================
   upload-queue.js — shared bounded-concurrency upload helper.

   Root cause this fixes: every bulk-photo surface in the app
   (Memory, Globe Memory, Places Memory, Collection) was uploading
   files one at a time in a `for` loop with `await` on each file,
   so total time scaled linearly with photo count and the network
   round-trip latency of every single file was paid serially.

   This module runs a bounded number of uploads in parallel (good
   for mobile data/CPU — not "upload everything at once"), reports
   per-file progress, and never lets one failed file cancel the
   rest of the batch.

   Usage:
     const result = await UploadQueue.run(files, async (file) => {
       return await uploadOneFile(file); // throw on failure
     }, {
       concurrency: 3,
       onProgress: ({ completed, total, active, failed }) => {}
     });
     // result.succeeded: [{ file, value }]
     // result.failed: [{ file, error }]
   ============================================================ */
(function (global) {
  'use strict';

  function pickConcurrency(fileCount) {
    // Small, mobile-friendly concurrency window. More than ~4
    // parallel uploads on a mobile connection tends to make every
    // individual upload slower (bandwidth contention) without
    // meaningfully reducing wall-clock time.
    if (fileCount <= 1) return 1;
    if (fileCount <= 3) return fileCount;
    return 4;
  }

  async function run(files, worker, opts) {
    opts = opts || {};
    const list = Array.from(files || []);
    const concurrency = opts.concurrency || pickConcurrency(list.length);
    const onProgress = opts.onProgress || function () {};

    const succeeded = [];
    const failed = [];
    let completed = 0;
    let active = 0;
    let nextIndex = 0;

    onProgress({ completed: 0, total: list.length, active: 0, failed: 0 });

    async function worker_() {
      while (nextIndex < list.length) {
        const i = nextIndex++;
        const file = list[i];
        active++;
        onProgress({ completed, total: list.length, active, failed: failed.length, current: file });
        try {
          const value = await worker(file, i);
          succeeded.push({ file, value, index: i });
        } catch (error) {
          failed.push({ file, error, index: i });
        }
        active--;
        completed++;
        onProgress({ completed, total: list.length, active, failed: failed.length, current: file });
      }
    }

    const runners = [];
    const n = Math.max(1, Math.min(concurrency, list.length || 1));
    for (let i = 0; i < n; i++) runners.push(worker_());
    await Promise.all(runners);

    // Preserve original selection order for callers that render results.
    succeeded.sort((a, b) => a.index - b.index);
    failed.sort((a, b) => a.index - b.index);
    return { succeeded, failed, total: list.length };
  }

  global.UploadQueue = { run: run, pickConcurrency: pickConcurrency };
})(window);
