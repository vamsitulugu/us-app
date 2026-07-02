// public/home/event_engine.js
// ════════════════════════════════════════════════
//  Event Engine — Phase 8
//  Weighted probability random event system.
//  No event repeats within its cooldown window.
//  Events: power outage, rain starts, pet attention,
//  partner arrives, doorbell, gift delivery, birthday,
//  festival, sunrise glory, shooting star, lightning,
//  rainbow, first snow, and more.
// ════════════════════════════════════════════════
const HomeEventEngine = (() => {

  // ── Event definitions ───────────────────────────
  // weight: relative probability 0-1
  // cooldown: minimum seconds between repeats
  // periodFilter: only fire during these periods (null = any)
  // weatherFilter: only fire during these weathers (null = any)
  // trigger: fn() — carries out the event
  const EVENTS = {

    rainStarts: {
      label: 'Rain starts', weight: 0.15,
      cooldown: 120,
      periodFilter: ['morning', 'afternoon', 'evening'],
      weatherFilter: ['clear', 'cloudy'],
      trigger() {
        if (window.HomeWeather) HomeWeather.setWeather('rain');
        HomeUtils.toast('🌧️ It\'s starting to rain...', 'info');
      }
    },

    rainClears: {
      label: 'Rain clears', weight: 0.15,
      cooldown: 90,
      weatherFilter: ['rain', 'drizzle'],
      trigger() {
        if (window.HomeWeather) HomeWeather.setWeather('clear');
        HomeUtils.toast('☀️ The rain has stopped!', 'success');
      }
    },

    lightSnow: {
      label: 'Light snow', weight: 0.06,
      cooldown: 300,
      periodFilter: ['night', 'midnight', 'dawn'],
      trigger() {
        if (window.HomeWeather) HomeWeather.setWeather('snow');
        HomeUtils.toast('❄️ It\'s snowing!', 'info');
      }
    },

    shootingStar: {
      label: 'Shooting star', weight: 0.08,
      cooldown: 180,
      periodFilter: ['night', 'midnight'],
      weatherFilter: ['clear'],
      trigger() {
        window.dispatchEvent(new CustomEvent('home:shootingStar'));
        HomeUtils.toast('🌠 A shooting star!', 'success');
        if (window.HomeCameraDirector) HomeCameraDirector.setMode('cinematicIdle', 2.0);
      }
    },

    sunriseGlory: {
      label: 'Sunrise glory', weight: 0.12,
      cooldown: 3600,
      periodFilter: ['dawn'],
      weatherFilter: ['clear'],
      trigger() {
        if (window.HomeSky) HomeSky.setTime(0.18);
        window.dispatchEvent(new CustomEvent('home:sunriseGlory'));
        HomeUtils.toast('🌅 Beautiful sunrise!', 'success');
        if (window.HomeCameraDirector) HomeCameraDirector.setMode('sunrise', 3.0);
      }
    },

    petWantsAttention: {
      label: 'Pet wants attention', weight: 0.18,
      cooldown: 60,
      trigger() {
        if (!window.HomePets) return;
        const pets = HomePets.getAll ? HomePets.getAll() : [];
        if (!pets.length) return;
        const pet = pets[Math.floor(Math.random() * pets.length)];
        if (pet.play) pet.play('beg', 0.2);
        if (window.HomeCameraDirector) HomeCameraDirector.followPet(pet.group || pet);
        HomeUtils.toast(`🐾 ${pet.name || 'Your pet'} wants some attention!`, 'info');
        window.dispatchEvent(new CustomEvent('home:petNeedsAttention', { detail: { petId: pet.id } }));
      }
    },

    doorbell: {
      label: 'Doorbell', weight: 0.06,
      cooldown: 240,
      trigger() {
        if (window.HomeAmbientAudioEngine) HomeAmbientAudioEngine.playSfx('window_slide');
        HomeUtils.toast('🔔 Ding dong! Someone\'s at the door.', 'info');
        window.dispatchEvent(new CustomEvent('home:doorbell'));
      }
    },

    giftDelivery: {
      label: 'Gift delivery', weight: 0.04,
      cooldown: 600,
      trigger() {
        HomeUtils.toast('🎁 A gift has been delivered!', 'success');
        window.dispatchEvent(new CustomEvent('home:giftDelivered', { detail: { ts: Date.now() } }));
      }
    },

    partnerArrives: {
      label: 'Partner arrives', weight: 0.10,
      cooldown: 120,
      trigger() {
        if (window.HomeRealtimeLiving && HomeRealtimeLiving.isPartnerOnline()) return;
        HomeUtils.toast(`${HomeUtils.getPartnerName()} just got home! 🏡`, 'success');
        if (window.HomeCameraDirector) HomeCameraDirector.setMode('arrival', 2.5);
        window.dispatchEvent(new CustomEvent('home:partnerArrives'));
      }
    },

    powerOutage: {
      label: 'Power outage', weight: 0.02,
      cooldown: 600,
      periodFilter: ['evening', 'night'],
      trigger() {
        // Turn off all lights
        if (window.HomeEnvironment) {
          ['living','bedroom','kitchen','garden','gameroom','music','library','petroom','rooftop'].forEach(r => {
            try { HomeEnvironment.setRoomLight(r, false); } catch (_) {}
          });
        }
        HomeUtils.toast('⚡ Power outage! The lights went out...', 'info');
        window.dispatchEvent(new CustomEvent('home:powerOutage'));
        // Restore after 8-15 sec
        const restoreDelay = 8000 + Math.random() * 7000;
        setTimeout(() => {
          if (window.HomeEnvironment) {
            ['living','bedroom'].forEach(r => {
              try { HomeEnvironment.setRoomLight(r, true); } catch (_) {}
            });
          }
          HomeUtils.toast('💡 Power is back!', 'success');
          window.dispatchEvent(new CustomEvent('home:powerRestored'));
        }, restoreDelay);
      }
    },

    lightning: {
      label: 'Lightning', weight: 0.10,
      cooldown: 20,
      weatherFilter: ['thunderstorm'],
      trigger() {
        if (window.HomeWindowSystem) HomeWindowSystem.triggerLightningFlash(1.0);
        if (window.HomeAmbientAudioEngine) HomeAmbientAudioEngine.onThunder();
        window.dispatchEvent(new CustomEvent('home:lightning', { detail: { intensity: 0.8 } }));
      }
    },

    rainbowAfterRain: {
      label: 'Rainbow', weight: 0.05,
      cooldown: 300,
      weatherFilter: ['rain'],
      trigger() {
        HomeUtils.toast('🌈 A beautiful rainbow appears!', 'success');
        window.dispatchEvent(new CustomEvent('home:rainbow'));
      }
    },

    festivalDecorations: {
      label: 'Festival decorations', weight: 0.01,
      cooldown: 3600,
      trigger() {
        HomeUtils.toast('🎉 Festival time! Special decorations are up!', 'success');
        window.dispatchEvent(new CustomEvent('home:festival'));
      }
    }
  };

  // ── State ───────────────────────────────────────
  let _accumulator = 0;
  const TICK_INTERVAL = 15; // evaluate events every 15 sec of sim time
  let _disposed = false;

  // ── Eligibility check ───────────────────────────
  function _isEligible(key, def) {
    const now     = performance.now() / 1000;
    const last    = HomeStateManager.getLastEvent(key);
    if (last > 0 && (now - last / 1000) < def.cooldown) return false;

    const period  = window.HomeDailyRoutine ? HomeDailyRoutine.getPeriod() : null;
    if (def.periodFilter && period && !def.periodFilter.includes(period)) return false;

    const weather = window.HomeStateManager ? HomeStateManager.get('weather') : null;
    if (def.weatherFilter && weather && !def.weatherFilter.includes(weather)) return false;

    return true;
  }

  // ── Weighted random pick from eligible events ───
  function _pickEvent() {
    const eligible = Object.entries(EVENTS).filter(([k, d]) => _isEligible(k, d));
    if (!eligible.length) return null;
    const total = eligible.reduce((s, [, d]) => s + d.weight, 0);
    let r = Math.random() * total;
    for (const [key, def] of eligible) {
      r -= def.weight;
      if (r <= 0) return { key, def };
    }
    return eligible[0] ? { key: eligible[0][0], def: eligible[0][1] } : null;
  }

  // ── Fire an event ───────────────────────────────
  function _fire(key, def) {
    HomeStateManager.setLastEvent(key);
    try { def.trigger(); } catch (e) {
      console.warn('[HomeEventEngine] Event error:', key, e.message);
    }
    window.dispatchEvent(new CustomEvent('home:event', { detail: { key, label: def.label } }));
  }

  // ── Per-frame update ───────────────────────────
  function update(dt) {
    if (_disposed) return;
    _accumulator += dt;
    if (_accumulator < TICK_INTERVAL) return;
    _accumulator = 0;

    // Only fire if random chance passes (reduces event frequency further)
    if (Math.random() > 0.35) return;

    const evt = _pickEvent();
    if (evt) _fire(evt.key, evt.def);
  }

  // ── Manual trigger (for testing/UI) ────────────
  function forceEvent(key) {
    const def = EVENTS[key];
    if (!def) { console.warn('[HomeEventEngine] Unknown event:', key); return; }
    _fire(key, def);
  }

  function listEvents() {
    return Object.entries(EVENTS).map(([key, d]) => ({ key, label: d.label, weight: d.weight }));
  }

  function init() { _disposed = false; }
  function dispose() { _disposed = true; }

  return { init, update, dispose, forceEvent, listEvents, EVENTS };
})();

window.HomeEventEngine = HomeEventEngine;
